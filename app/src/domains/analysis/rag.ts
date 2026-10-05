import type { AnalysisFileRow } from "./analysis";
import { getVertexToken, parseServiceAccount } from "../../ai";
import type { Env } from "../../env";

const MAX_CHUNK_CHARS = 1400;
const CHUNK_OVERLAP_CHARS = 180;
const MAX_CHUNKS_PER_FILE = 48;
const MAX_QUERY_CHARS = 4000;
const MAX_RAG_CONTEXT_CHARS = 36000;
const VECTOR_METADATA_TEXT_CHARS = 1100;
const DEFAULT_EMBEDDING_PROVIDER = "gemini";
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

type EmbeddingTask = "document" | "query";

interface AnalysisChunkRow {
  id: string;
  session_id: string;
  user_id: string;
  file_id: string;
  chunk_index: number;
  text: string;
  embedding_provider: string | null;
  embedding_model: string | null;
  vector_id: string | null;
  created_at: string;
  name?: string | null;
}

interface EmbeddingBatch {
  provider: string;
  model: string;
  vectors: number[][];
}

export interface RetrievedChunk {
  id: string;
  file_id: string;
  name: string;
  chunk_index: number;
  text: string;
  score: number;
  source: string;
}

function normalizeText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimContext(text: string, max = MAX_RAG_CONTEXT_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n[이후 RAG 근거 청크는 길이 제한으로 생략]";
}

function pushChunk(chunks: string[], text: string) {
  const clean = normalizeText(text);
  if (clean) chunks.push(clean.slice(0, MAX_CHUNK_CHARS));
}

export function chunkText(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (!current) return;
    pushChunk(chunks, current);
    current = current.slice(-CHUNK_OVERLAP_CHARS).trim();
  };

  for (const paragraph of paragraphs) {
    if (chunks.length >= MAX_CHUNKS_PER_FILE) break;
    if (paragraph.length > MAX_CHUNK_CHARS) {
      flush();
      for (let start = 0; start < paragraph.length && chunks.length < MAX_CHUNKS_PER_FILE; start += MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS) {
        pushChunk(chunks, paragraph.slice(start, start + MAX_CHUNK_CHARS));
      }
      current = paragraph.slice(-CHUNK_OVERLAP_CHARS).trim();
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > MAX_CHUNK_CHARS) {
      flush();
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      if (current.length > MAX_CHUNK_CHARS) flush();
    } else {
      current = candidate;
    }
  }
  if (chunks.length < MAX_CHUNKS_PER_FILE) pushChunk(chunks, current);
  return chunks.slice(0, MAX_CHUNKS_PER_FILE);
}

function embeddingProvider(env: Env): string {
  return (env.RAG_EMBEDDING_PROVIDER || DEFAULT_EMBEDDING_PROVIDER).trim().toLowerCase();
}

function embeddingModel(env: Env, provider: string): string {
  const configured = (env.RAG_EMBEDDING_MODEL || "").trim();
  if (provider === "openai") {
    return configured.startsWith("text-embedding") ? configured : DEFAULT_OPENAI_EMBEDDING_MODEL;
  }
  if (provider === "gemini") {
    return configured.startsWith("gemini-embedding") ? configured : DEFAULT_GEMINI_EMBEDDING_MODEL;
  }
  return configured || DEFAULT_GEMINI_EMBEDDING_MODEL;
}

function embeddingDimensions(env: Env): number {
  const parsed = Number(env.RAG_EMBEDDING_DIMENSIONS || DEFAULT_EMBEDDING_DIMENSIONS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_EMBEDDING_DIMENSIONS;
}

function hasGeminiEmbeddingConfig(env: Env): boolean {
  return !!env.GEMINI_API_KEY || !!env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return vector;
  return vector.map((value) => value / magnitude);
}

function assertEmbeddingDimensions(env: Env, provider: string, model: string, vector: number[]): number[] {
  const expected = embeddingDimensions(env);
  if (vector.length !== expected) {
    throw new Error(`${provider}/${model} embeddings dimension mismatch: expected ${expected}, got ${vector.length}`);
  }
  return provider === "gemini" ? normalizeVector(vector) : vector;
}

async function createOpenAIEmbeddings(env: Env, inputs: string[]): Promise<EmbeddingBatch> {
  const provider = "openai";
  if (!env.OPENAI_API_KEY || !inputs.length) throw new Error("OpenAI embeddings 설정 없음(OPENAI_API_KEY)");
  const model = embeddingModel(env, provider);
  const body: { model: string; input: string[]; dimensions?: number } = {
    model,
    input: inputs.map((input) => input.slice(0, MAX_QUERY_CHARS)),
  };
  if (model.startsWith("text-embedding-3")) body.dimensions = embeddingDimensions(env);
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const parsed = await res.json<{
    data?: { embedding?: number[]; index?: number }[];
  }>();
  const vectors = (parsed.data || [])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding || [])
    .map((vector) => assertEmbeddingDimensions(env, provider, model, vector));
  if (vectors.length !== inputs.length || vectors.some((vector) => !vector.length)) {
    throw new Error("OpenAI embeddings 응답이 입력 개수와 일치하지 않습니다.");
  }
  return { provider, model, vectors };
}

function geminiTaskType(task: EmbeddingTask): string {
  return task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
}

function geminiInput(input: string, task: EmbeddingTask, model: string): string {
  const text = normalizeText(input).slice(0, MAX_QUERY_CHARS);
  if (model !== "gemini-embedding-2") return text;
  return task === "query"
    ? `task: search result | query: ${text}`
    : `title: analysis chunk | text: ${text}`;
}

function parseGeminiVector(parsed: {
  embedding?: { values?: number[] };
  embeddings?: { values?: number[] }[];
  predictions?: { embeddings?: { values?: number[] } }[];
}): number[] {
  return parsed.embedding?.values
    || parsed.embeddings?.[0]?.values
    || parsed.predictions?.[0]?.embeddings?.values
    || [];
}

async function createGeminiStudioEmbedding(env: Env, model: string, input: string, task: EmbeddingTask): Promise<number[]> {
  if (!env.GEMINI_API_KEY) throw new Error("Gemini embeddings 설정 없음(GEMINI_API_KEY)");
  const body: Record<string, unknown> = {
    content: { parts: [{ text: geminiInput(input, task, model) }] },
    output_dimensionality: embeddingDimensions(env),
  };
  if (model === "gemini-embedding-001") {
    body.taskType = geminiTaskType(task);
  } else {
    body.model = `models/${model}`;
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseGeminiVector(await res.json());
}

async function createGeminiVertexEmbedding(env: Env, model: string, input: string, task: EmbeddingTask): Promise<number[]> {
  const sa = parseServiceAccount(env);
  if (!sa) throw new Error("Vertex embeddings 설정 없음(GOOGLE_SERVICE_ACCOUNT_JSON)");
  const project = env.GOOGLE_CLOUD_PROJECT_ID || sa.project_id;
  if (!project) throw new Error("Vertex project id 없음(GOOGLE_CLOUD_PROJECT_ID 또는 서비스계정 project_id)");
  const location = env.GOOGLE_CLOUD_LOCATION || "us-central1";
  const token = await getVertexToken(sa);
  const res = await fetch(`https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      instances: [{
        content: normalizeText(input).slice(0, MAX_QUERY_CHARS),
        task_type: geminiTaskType(task),
        ...(task === "document" ? { title: "analysis chunk" } : {}),
      }],
      parameters: {
        autoTruncate: true,
        outputDimensionality: embeddingDimensions(env),
      },
    }),
  });
  if (!res.ok) throw new Error(`Vertex embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseGeminiVector(await res.json());
}

async function createGeminiEmbeddings(env: Env, inputs: string[], task: EmbeddingTask): Promise<EmbeddingBatch> {
  const provider = "gemini";
  const configuredModel = embeddingModel(env, provider);
  const useStudio = configuredModel === "gemini-embedding-2" || !env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const model = useStudio ? configuredModel : DEFAULT_GEMINI_EMBEDDING_MODEL;
  const vectors: number[][] = [];

  for (const input of inputs) {
    const vector = useStudio
      ? await createGeminiStudioEmbedding(env, model, input, task)
      : await createGeminiVertexEmbedding(env, model, input, task);
    vectors.push(assertEmbeddingDimensions(env, provider, model, vector));
  }

  if (vectors.length !== inputs.length || vectors.some((vector) => !vector.length)) {
    throw new Error("Gemini embeddings 응답이 입력 개수와 일치하지 않습니다.");
  }
  return { provider, model, vectors };
}

async function createEmbeddings(env: Env, inputs: string[], task: EmbeddingTask = "document"): Promise<EmbeddingBatch | null> {
  const provider = embeddingProvider(env);
  if (!inputs.length) return null;
  if (provider === "openai") {
    if (env.OPENAI_API_KEY) return createOpenAIEmbeddings(env, inputs);
    if (hasGeminiEmbeddingConfig(env)) return createGeminiEmbeddings(env, inputs, task);
    return null;
  }
  if (provider === "gemini") {
    if (hasGeminiEmbeddingConfig(env)) return createGeminiEmbeddings(env, inputs, task);
    if (env.OPENAI_API_KEY) return createOpenAIEmbeddings(env, inputs);
    return null;
  }
  return null;
}

function vectorId(fileId: string, chunkIndex: number): string {
  return `${fileId}:${String(chunkIndex).padStart(4, "0")}`;
}

export async function deleteFileChunks(env: Env, userId: string, sessionId: string, fileId: string) {
  const { results } = await env.DB.prepare(
    `SELECT vector_id FROM analysis_chunks
     WHERE session_id=? AND user_id=? AND file_id=? AND vector_id IS NOT NULL`
  ).bind(sessionId, userId, fileId).all<{ vector_id: string }>();
  const ids = (results || []).map((row) => row.vector_id).filter(Boolean);
  if (ids.length && env.VECTORIZE) {
    try { await env.VECTORIZE.deleteByIds(ids); } catch { /* D1 삭제는 계속 진행 */ }
  }
  await env.DB.prepare(
    "DELETE FROM analysis_chunks WHERE session_id=? AND user_id=? AND file_id=?"
  ).bind(sessionId, userId, fileId).run();
}

export async function deleteSessionChunks(
  env: Env,
  userId: string,
  sessionId: string,
  options: { failOnVectorizeError?: boolean } = {},
) {
  const { results } = await env.DB.prepare(
    `SELECT vector_id FROM analysis_chunks
     WHERE session_id=? AND user_id=? AND vector_id IS NOT NULL`
  ).bind(sessionId, userId).all<{ vector_id: string }>();
  const ids = (results || []).map((row) => row.vector_id).filter(Boolean);
  if (ids.length && !env.VECTORIZE && options.failOnVectorizeError) {
    throw new Error("Vectorize 바인딩이 없어 분석 벡터를 안전하게 정리할 수 없습니다.");
  }
  if (ids.length && env.VECTORIZE) {
    try {
      for (let index = 0; index < ids.length; index += 1000) {
        await env.VECTORIZE.deleteByIds(ids.slice(index, index + 1000));
      }
    } catch (error) {
      if (options.failOnVectorizeError) throw error;
      // 사용자 직접 삭제는 기존 동작대로 D1 정리를 계속한다.
    }
  }
  await env.DB.prepare("DELETE FROM analysis_chunks WHERE session_id=? AND user_id=?").bind(sessionId, userId).run();
}

export interface SyncFileChunksOptions {
  failOnVectorizeError?: boolean;
}

export async function syncFileChunks(
  env: Env,
  userId: string,
  sessionId: string,
  file: AnalysisFileRow,
  options: SyncFileChunksOptions = {},
) {
  await deleteFileChunks(env, userId, sessionId, file.id);
  const chunks = chunkText(file.text_excerpt || "");
  if (!chunks.length) return { chunks: 0, vectorized: 0 };

  const now = new Date().toISOString();
  for (let i = 0; i < chunks.length; i++) {
    await env.DB.prepare(
      `INSERT INTO analysis_chunks (id, session_id, user_id, file_id, chunk_index, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(vectorId(file.id, i), sessionId, userId, file.id, i, chunks[i], now).run();
  }

  if (!env.VECTORIZE) return { chunks: chunks.length, vectorized: 0 };

  let embeddings: EmbeddingBatch | null = null;
  try {
    embeddings = await createEmbeddings(env, chunks, "document");
  } catch (error) {
    if (options.failOnVectorizeError) throw error;
    embeddings = null;
  }
  if (!embeddings) {
    if (options.failOnVectorizeError) throw new Error("Vectorize 임베딩을 생성하지 못했습니다.");
    return { chunks: chunks.length, vectorized: 0 };
  }

  const vectors: VectorizeVector[] = chunks.map((text, index) => ({
    id: vectorId(file.id, index),
    values: embeddings?.vectors[index] || [],
    namespace: sessionId,
    metadata: {
      user_id: userId,
      session_id: sessionId,
      file_id: file.id,
      chunk_id: vectorId(file.id, index),
      chunk_index: index,
      name: file.name,
      text: text.slice(0, VECTOR_METADATA_TEXT_CHARS),
    },
  }));

  try {
    await env.VECTORIZE.upsert(vectors);
    for (const vector of vectors) {
      await env.DB.prepare(
        `UPDATE analysis_chunks
         SET embedding_provider=?, embedding_model=?, vector_id=?
         WHERE id=? AND session_id=? AND user_id=?`
      ).bind(embeddings.provider, embeddings.model, vector.id, vector.id, sessionId, userId).run();
    }
    return { chunks: chunks.length, vectorized: vectors.length };
  } catch (error) {
    if (options.failOnVectorizeError) throw error;
    return { chunks: chunks.length, vectorized: 0 };
  }
}

function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms = normalizeText(query).toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 2 && term.length <= 40);
  return terms.filter((term) => {
    if (seen.has(term)) return false;
    seen.add(term);
    return true;
  }).slice(0, 32);
}

function scoreKeywordChunk(chunk: AnalysisChunkRow, terms: string[]): number {
  if (!terms.length) return 0.1;
  const haystack = `${chunk.name || ""}\n${chunk.text}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    let pos = haystack.indexOf(term);
    while (pos >= 0) {
      score += term.length >= 4 ? 1.4 : 1;
      pos = haystack.indexOf(term, pos + term.length);
    }
  }
  return score;
}

async function keywordRetrieve(env: Env, userId: string, sessionId: string, query: string, topK: number): Promise<RetrievedChunk[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.session_id, c.user_id, c.file_id, c.chunk_index, c.text,
            c.embedding_provider, c.embedding_model, c.vector_id, c.created_at, f.name
     FROM analysis_chunks c
     LEFT JOIN analysis_files f ON f.id=c.file_id AND f.user_id=c.user_id
     WHERE c.session_id=? AND c.user_id=?
     ORDER BY c.created_at, c.chunk_index
     LIMIT 500`
  ).bind(sessionId, userId).all<AnalysisChunkRow>();
  const terms = queryTerms(query);
  return (results || [])
    .map((chunk) => ({ chunk, score: scoreKeywordChunk(chunk, terms) }))
    .filter((item) => item.score > 0 || !terms.length)
    .sort((a, b) => b.score - a.score || a.chunk.chunk_index - b.chunk.chunk_index)
    .slice(0, topK)
    .map(({ chunk, score }) => ({
      id: chunk.id,
      file_id: chunk.file_id,
      name: chunk.name || "분석파일",
      chunk_index: chunk.chunk_index,
      text: chunk.text,
      score,
      source: `${chunk.file_id}:${chunk.id}`,
    }));
}

function metadataString(meta: Record<string, VectorizeVectorMetadata> | undefined, key: string): string {
  const value = meta?.[key];
  return typeof value === "string" ? value : "";
}

function metadataNumber(meta: Record<string, VectorizeVectorMetadata> | undefined, key: string): number {
  const value = meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function retrieveRelevantChunks(env: Env, userId: string, sessionId: string, query: string, topK = 8): Promise<RetrievedChunk[]> {
  const cleanQuery = normalizeText(query).slice(0, MAX_QUERY_CHARS);
  if (env.VECTORIZE && cleanQuery) {
    try {
      const embeddings = await createEmbeddings(env, [cleanQuery], "query");
      if (embeddings?.vectors[0]) {
        const matches = await env.VECTORIZE.query(embeddings.vectors[0], {
          topK,
          namespace: sessionId,
          returnValues: false,
          returnMetadata: "all",
        });
        const chunks = matches.matches.map((match) => {
          const meta = match.metadata;
          if (metadataString(meta, "user_id") !== userId || metadataString(meta, "session_id") !== sessionId) return null;
          const id = metadataString(meta, "chunk_id") || match.id;
          const fileId = metadataString(meta, "file_id");
          const text = metadataString(meta, "text");
          if (!id || !fileId || !text) return null;
          return {
            id,
            file_id: fileId,
            name: metadataString(meta, "name") || "분석파일",
            chunk_index: metadataNumber(meta, "chunk_index"),
            text,
            score: match.score,
            source: `${fileId}:${id}`,
          };
        }).filter((item): item is RetrievedChunk => !!item);
        if (chunks.length) return chunks;
      }
    } catch {
      // Vectorize/embedding이 실패하면 D1 키워드 검색으로 폴백한다.
    }
  }
  return keywordRetrieve(env, userId, sessionId, cleanQuery, topK);
}

export function formatRetrievedContext(chunks: RetrievedChunk[]): string | null {
  if (!chunks.length) return null;
  return trimContext(chunks.map((chunk) => [
    `출처: ${chunk.name} (file_id=${chunk.file_id}, chunk_id=${chunk.id}, chunk=${chunk.chunk_index + 1}, score=${chunk.score.toFixed(3)})`,
    chunk.text,
  ].join("\n")).join("\n\n---\n\n"));
}
