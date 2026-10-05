import type { Env } from "../../env";
import type { RetrievedChunk } from "./rag";

interface ChunkRow {
  id: string;
  file_id: string;
  chunk_index: number;
  text: string;
  name: string | null;
}

const STOP_WORDS = new Set([
  "그리고", "그러나", "대한", "위한", "관련", "있는", "없는", "한다", "합니다", "이번", "해당",
  "the", "and", "for", "with", "from", "that", "this", "into", "are", "was", "were",
]);

function normalizeTerm(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}./%-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function chunkTerms(text: string): string[] {
  const counts = new Map<string, number>();
  const tokens = normalizeTerm(text).split(" ");
  for (const token of tokens) {
    if (token.length < 2 || token.length > 40 || STOP_WORDS.has(token) || /^\d+$/.test(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 10)
    .map(([term]) => term);
}

async function stableId(prefix: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}:${hex}`;
}

export async function deleteFileGraph(env: Env, userId: string, sessionId: string, fileId: string): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM analysis_graph_edges WHERE session_id=? AND user_id=? AND file_id=?"
  ).bind(sessionId, userId, fileId).run();
  await env.DB.prepare(
    `DELETE FROM analysis_graph_nodes
     WHERE session_id=? AND user_id=? AND file_id=?
       AND id NOT IN (
         SELECT source_node_id FROM analysis_graph_edges WHERE session_id=? AND user_id=?
         UNION SELECT target_node_id FROM analysis_graph_edges WHERE session_id=? AND user_id=?
       )`
  ).bind(sessionId, userId, fileId, sessionId, userId, sessionId, userId).run();
}

export async function deleteSessionGraph(env: Env, userId: string, sessionId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM analysis_graph_edges WHERE session_id=? AND user_id=?").bind(sessionId, userId),
    env.DB.prepare("DELETE FROM analysis_graph_nodes WHERE session_id=? AND user_id=?").bind(sessionId, userId),
  ]);
}

export async function syncFileGraph(env: Env, userId: string, sessionId: string, fileId: string): Promise<{ nodes: number; edges: number }> {
  await deleteFileGraph(env, userId, sessionId, fileId);
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.file_id, c.chunk_index, c.text, f.name
     FROM analysis_chunks c
     LEFT JOIN analysis_files f ON f.id=c.file_id AND f.user_id=c.user_id
     WHERE c.session_id=? AND c.user_id=? AND c.file_id=?
     ORDER BY c.chunk_index LIMIT 24`
  ).bind(sessionId, userId, fileId).all<ChunkRow>();
  const now = new Date().toISOString();
  const seenNodes = new Set<string>();
  let edgeCount = 0;
  for (const chunk of results || []) {
    const terms = chunkTerms(chunk.text).slice(0, 7);
    const nodes: { id: string; term: string }[] = [];
    for (const term of terms) {
      nodes.push({ id: await stableId("gn", `${sessionId}:${userId}:${term}`), term });
      seenNodes.add(term);
    }
    const statements: D1PreparedStatement[] = nodes.map((node) => env.DB.prepare(
      `INSERT INTO analysis_graph_nodes
         (id, session_id, user_id, file_id, name, normalized_name, mention_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(session_id, user_id, normalized_name)
       DO UPDATE SET mention_count=mention_count+1, updated_at=excluded.updated_at`
    ).bind(node.id, sessionId, userId, fileId, node.term, node.term, now, now));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < Math.min(nodes.length, i + 5); j++) {
        const [source, target] = nodes[i].id < nodes[j].id ? [nodes[i], nodes[j]] : [nodes[j], nodes[i]];
        const edgeId = `ge:${chunk.id}:${i}:${j}`;
        statements.push(env.DB.prepare(
          `INSERT INTO analysis_graph_edges
             (id, session_id, user_id, file_id, source_node_id, target_node_id, source_chunk_id, weight, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(session_id, user_id, source_node_id, target_node_id, source_chunk_id)
           DO UPDATE SET weight=weight+1, updated_at=excluded.updated_at`
        ).bind(edgeId, sessionId, userId, fileId, source.id, target.id, chunk.id, now, now));
        edgeCount += 1;
      }
    }
    if (statements.length) await env.DB.batch(statements);
  }
  return { nodes: seenNodes.size, edges: edgeCount };
}

export async function retrieveGraphChunks(env: Env, userId: string, sessionId: string, query: string, limit = 4): Promise<RetrievedChunk[]> {
  const terms = chunkTerms(query).slice(0, 12);
  if (!terms.length) return [];
  const placeholders = terms.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.file_id, c.chunk_index, c.text, f.name,
            SUM(e.weight) AS graph_score
     FROM analysis_graph_nodes n
     JOIN analysis_graph_edges e ON e.session_id=n.session_id AND e.user_id=n.user_id
       AND (e.source_node_id=n.id OR e.target_node_id=n.id)
     JOIN analysis_chunks c ON c.id=e.source_chunk_id AND c.user_id=e.user_id
     LEFT JOIN analysis_files f ON f.id=c.file_id AND f.user_id=c.user_id
     WHERE n.session_id=? AND n.user_id=? AND n.normalized_name IN (${placeholders})
     GROUP BY c.id, c.file_id, c.chunk_index, c.text, f.name
     ORDER BY graph_score DESC, c.chunk_index ASC LIMIT ?`
  ).bind(sessionId, userId, ...terms, Math.min(12, Math.max(1, limit))).all<ChunkRow & { graph_score: number }>();
  return (results || []).map((row) => ({
    id: row.id,
    file_id: row.file_id,
    name: row.name || "분석파일",
    chunk_index: row.chunk_index,
    text: row.text,
    score: Number(row.graph_score || 0),
    source: `graph:${row.file_id}:${row.id}`,
  }));
}
