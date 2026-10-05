import type { Env } from "./env";

const MAX_SYNC_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_CLOVA_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_CLOVA_ERROR_BYTES = 4096;

type JsonRecord = Record<string, unknown>;

export interface SttSegment {
  speaker?: string;
  start?: number;
  end?: number;
  text: string;
}

export interface SttResult {
  text: string;
  segments: SttSegment[];
  provider: "clova";
  language?: string;
}

export class SttError extends Error {
  constructor(public status: number, message: string, public code = "STT_ERROR") {
    super(message);
    this.name = "SttError";
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function getString(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function getNumber(record: JsonRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cleanText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function buildClovaUploadUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new SttError(503, "Clova Speech Invoke URL 설정이 올바르지 않습니다.", "STT_CONFIG_INVALID");
  }

  if (!/\/recognizer\//.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/recognizer/upload`;
  }
  url.searchParams.set("completion", "sync");
  return url.toString();
}

function parseParams(entry: unknown): JsonRecord {
  if (typeof entry !== "string" || !entry.trim()) return {};
  try {
    return asRecord(JSON.parse(entry)) ?? {};
  } catch {
    throw new SttError(400, "STT params는 JSON object여야 합니다.", "STT_BAD_PARAMS");
  }
}

function paramsFromForm(form: FormData): JsonRecord {
  const raw = parseParams(form.get("params"));
  const params: JsonRecord = {
    language: "ko-KR",
    completion: "sync",
    fullText: true,
  };
  for (const key of ["language", "fullText", "wordAlignment", "diarization", "speakerCount", "noiseFiltering"]) {
    if (raw[key] !== undefined) params[key] = raw[key];
  }
  const language = form.get("language");
  if (typeof language === "string" && language.trim()) params.language = language.trim();
  params.completion = "sync";
  return params;
}

function getFormEntry(form: FormData, name: string): unknown {
  // The installed Workers types declare FormData.get() as string|null, but multipart
  // file parts are File objects at runtime.
  return (form as { get(name: string): unknown }).get(name);
}

async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SttError(502, "Clova Speech 응답이 너무 큽니다. 더 짧은 녹음 파일로 다시 시도해주세요.", "STT_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function normalizeSpeaker(segment: JsonRecord): string | undefined {
  const direct = getString(segment, "speaker");
  if (direct) return direct;
  const speaker = asRecord(segment.speaker);
  if (!speaker) return undefined;
  return getString(speaker, "label") || getString(speaker, "name") || getString(speaker, "id");
}

function normalizeSegment(value: unknown): SttSegment | null {
  const segment = asRecord(value);
  if (!segment) return null;
  const text = cleanText(getString(segment, "text") || getString(segment, "utterance") || "");
  if (!text) return null;

  const out: SttSegment = { text };
  const speaker = normalizeSpeaker(segment);
  const start = getNumber(segment, "start") ?? getNumber(segment, "startTime");
  const end = getNumber(segment, "end") ?? getNumber(segment, "endTime");
  if (speaker) out.speaker = speaker;
  if (start !== undefined) out.start = start;
  if (end !== undefined) out.end = end;
  return out;
}

function normalizeClovaResponse(data: unknown): SttResult {
  const record = asRecord(data);
  if (!record) throw new SttError(502, "Clova Speech 응답 형식이 올바르지 않습니다.", "STT_BAD_RESPONSE");

  const segmentValues = Array.isArray(record.segments) ? record.segments : [];
  const segments = segmentValues.map(normalizeSegment).filter((segment): segment is SttSegment => segment !== null);
  const text = cleanText(
    getString(record, "text") ||
    getString(record, "fullText") ||
    segments.map((segment) => segment.text).join("\n")
  );
  if (!text) throw new SttError(502, "Clova Speech 전사 결과가 비어 있습니다.", "STT_EMPTY_RESULT");

  const result: SttResult = { text, segments, provider: "clova" };
  const language = getString(record, "language");
  if (language) result.language = language;
  return result;
}

function mapClovaError(status: number): SttError {
  if (status === 401 || status === 403) {
    return new SttError(502, "Clova Speech 인증에 실패했습니다. Invoke URL과 Secret 설정을 확인해주세요.", "STT_PROVIDER_AUTH");
  }
  if (status === 413) {
    return new SttError(413, "녹음 파일이 너무 큽니다. 짧게 나누거나 자막 파일로 업로드해주세요.", "STT_MEDIA_TOO_LARGE");
  }
  if (status >= 500) {
    return new SttError(502, "Clova Speech 서비스가 일시적으로 실패했습니다. 잠시 후 다시 시도해주세요.", "STT_PROVIDER_FAILED");
  }
  return new SttError(502, `Clova Speech 요청이 실패했습니다. (HTTP ${status})`, "STT_PROVIDER_FAILED");
}

export async function transcribeClovaForm(env: Env, form: FormData): Promise<SttResult> {
  if (!env.CLOVA_SPEECH_INVOKE_URL || !env.CLOVA_SPEECH_SECRET_KEY) {
    throw new SttError(503, "Clova Speech 설정이 필요합니다. CLOVA_SPEECH_INVOKE_URL과 CLOVA_SPEECH_SECRET_KEY를 Worker secret으로 등록해주세요.", "STT_CONFIG_MISSING");
  }

  if (!form) throw new SttError(400, "multipart/form-data 요청이 필요합니다.", "STT_BAD_REQUEST");

  const media = getFormEntry(form, "media");
  if (!(media instanceof File) || media.size === 0) {
    throw new SttError(400, "media 오디오 파일이 필요합니다.", "STT_MEDIA_MISSING");
  }
  if (media.size > MAX_SYNC_MEDIA_BYTES) {
    throw new SttError(413, "녹음 파일이 너무 큽니다. 짧게 나누거나 자막 파일로 업로드해주세요.", "STT_MEDIA_TOO_LARGE");
  }

  const uploadUrl = buildClovaUploadUrl(env.CLOVA_SPEECH_INVOKE_URL);
  const body = new FormData();
  body.append("media", media, media.name || "audio");
  body.append("params", JSON.stringify(paramsFromForm(form)));

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-CLOVASPEECH-API-KEY": env.CLOVA_SPEECH_SECRET_KEY },
    body,
  });

  if (!response.ok) {
    await readTextLimited(response, MAX_CLOVA_ERROR_BYTES).catch(() => "");
    throw mapClovaError(response.status);
  }

  const responseText = await readTextLimited(response, MAX_CLOVA_RESPONSE_BYTES);
  let data: unknown;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new SttError(502, "Clova Speech 응답을 JSON으로 해석할 수 없습니다.", "STT_BAD_RESPONSE");
  }
  return normalizeClovaResponse(data);
}

export async function transcribeClova(env: Env, request: Request): Promise<SttResult> {
  const form = await request.formData().catch(() => null);
  if (!form) throw new SttError(400, "multipart/form-data request is required.", "STT_BAD_REQUEST");
  return transcribeClovaForm(env, form);
}
