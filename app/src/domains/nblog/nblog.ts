import { confirmNBlogContent, startNBlogGeneration } from "./nblogGeneration";
import {
  isAllowedAudioType, listVoiceNotes, MAX_TRANSCRIPT_CHARS, MAX_VOICE_BYTES,
  sanitizeTranscript, transcribeAudio,
} from "./nblogVoiceNotes";

export interface NBlogWorkflowParams {
  user_id: string;
  campaign_id: string;
  requested_by: string;
  reason: string;
  generation_run_id?: string;
  input_hash?: string;
}

export interface NBlogEnv {
  DB: D1Database;
  R2: R2Bucket;
  MEDIA?: MediaBinding;
  IMAGES?: ImagesBinding;
  NBLOG_WORKFLOW?: Workflow<NBlogWorkflowParams>;
  NBLOG_SYNC_RATE_LIMITER?: RateLimit;
  NBLOG_UI_RATE_LIMITER?: RateLimit;
  NBLOG_TOKEN_RATE_LIMITER?: RateLimit;
  APP_BASE_URL?: string;
  NBLOG_MEDIA_MAX_BYTES?: string;
  NBLOG_HANDOFF_ENABLED?: string;
  OPENAI_API_KEY?: string;
  NBLOG_GENERATION_MODEL?: string;
  NBLOG_MAX_VIDEO_FRAMES?: string;
  NBLOG_TRANSCRIBE_MODEL?: string;
}

export interface NBlogActor {
  userId: string;
  label: string;
  viaToken: boolean;
}

interface CampaignRow {
  user_id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_url: string;
  place_url: string;
  visit_date: string;
  visit_notes: string;
  requirements: string;
  tone_profile: string;
  user_tags_json: string;
  prompt_profile_id: string | null;
  prompt_override: string | null;
  prompt_snapshot_hash: string | null;
  source_folder: string | null;
  blog_url: string | null;
  category: string | null;
  status: string;
  contract_version: string;
  operation_status: string;
  validation_passed: number;
  approved_at: string | null;
  approved_by: string | null;
  scheduled_at: string | null;
  published_url: string | null;
  published_at: string | null;
  confirmed_by: string | null;
  requirement_version: string | null;
  draft_version: string | null;
  validation_version: string | null;
  profile_version: string | null;
  artifact_version: number;
  artifact_content_hash: string | null;
  last_sync_at: string | null;
  failure_stage: string | null;
  failure_reason: string | null;
  resume_stage: string | null;
  resume_point: string | null;
  remaining_steps_json: string;
  last_checkpoint_at: string | null;
  retry_count: number;
  retry_limit: number;
  retryable: number;
  workflow_instance_id: string | null;
  generation_status: string;
  generation_input_hash: string | null;
  content_confirmed_at: string | null;
  content_confirmed_by: string | null;
  content_confirmed_artifact_version: number | null;
  archived_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ArtifactVersionRow {
  artifact_version: number;
  content_hash: string;
  idempotency_key: string;
  object_keys_json: string;
  validation_passed: number;
  created_at: string;
}

interface HandoffSessionRow {
  id: string;
  token_hash: string;
  user_id: string;
  campaign_id: string;
  artifact_version: number;
  requirement_version: string | null;
  draft_version: string | null;
  validation_version: string | null;
  profile_version: string | null;
  contract_version: string;
  status: string;
  allowed_actions_json: string;
  expires_at: string;
  used_at: string | null;
  cancelled_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const NBLOG_CONTRACT_VERSION = "1.1";
const ALLOWED_STATUSES = new Set(["queued", "analysis", "validation", "approval", "scheduled", "published", "failed", "handoff"]);
const HANDOFF_SESSION_STATUSES = new Set([
  "handoff_ready", "browser_connected", "input_in_progress", "user_action_required",
  "review_required", "draft_saved", "publishing", "published",
  "publish_result_unknown", "failed",
]);
const BROWSER_CHECKPOINT_STATUSES = new Set([
  "browser_connected", "input_in_progress", "user_action_required", "review_required", "failed",
]);
type HandoffSessionAction = "claim" | "read_bundle" | "read_media" | "write_checkpoint";
const OPERATION_STATUS_TRANSITIONS: Record<string, Set<string>> = {
  handoff_ready: new Set(["browser_connected", "failed"]),
  browser_connected: new Set(["input_in_progress", "user_action_required", "failed"]),
  input_in_progress: new Set(["user_action_required", "review_required", "draft_saved", "failed"]),
  user_action_required: new Set(["input_in_progress", "review_required", "draft_saved", "failed"]),
  review_required: new Set(["input_in_progress", "draft_saved", "publishing", "failed"]),
  draft_saved: new Set(["review_required", "publishing", "failed"]),
  publishing: new Set(["published", "publish_result_unknown", "failed"]),
  publish_result_unknown: new Set(["review_required", "published", "failed"]),
  failed: new Set(["browser_connected", "input_in_progress", "user_action_required"]),
  published: new Set(),
};
const ALLOWED_PLACEHOLDERS = new Set([
  "campaign_id", "campaign_name", "campaign_url", "place_url", "visit_date",
  "requirements", "visit_notes", "tone_profile", "user_tags", "media_manifest",
  "image_summaries", "video_summaries", "sponsor_disclosure", "map_or_place_block",
  "unconfirmed_items", "category", "voice_notes",
]);
const REQUIRED_PLACEHOLDERS = new Set([
  "campaign_name", "requirements", "visit_notes", "user_tags", "image_summaries",
  "video_summaries", "tone_profile", "unconfirmed_items",
]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CAMPAIGN_IMPORT_HOSTS = new Set(["강남맛집.net", "xn--939au0g4vj8sq.net"]);
const SYNC_TOKEN_WRITE_ROUTES = [
  /^\/api\/campaigns$/,
  /^\/api\/campaigns\/[^/]+\/artifacts$/,
  /^\/api\/campaigns\/[^/]+\/media\/(?:upload-init|upload-complete)$/,
];
const SENSITIVE_TEXT_PATTERN = /(?:\b(?:nbs|nbu|nbh|nbhs)_[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:cookie|password|authorization)\s*[:=]\s*\S+|\bsid=[^;\s]{8,})/gi;
const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|prompt|source[_-]?(?:path|folder)|local[_-]?path|absolute[_-]?path|file[_-]?path)/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\r\n]*/g;
const UNIX_ABSOLUTE_PATH_PATTERN = /(^|[\s("'=])(\/(?:Users|home|workspace|workspaces|mnt|Volumes|tmp|var\/tmp|private\/var\/folders)\/[^\r\n,;)"']+)/gm;
const PROMPT_MARKER_PATTERN = /(?:\b(?:system|developer|assistant)\s+prompt\b|ignore\s+(?:all\s+)?previous\s+instructions|<\|(?:system|assistant|user)\|>|\{\{(?:campaign_name|requirements|visit_notes|user_tags|image_summaries|video_summaries|tone_profile|unconfirmed_items)\}\})/i;
/**
 * 실제 생성이 쓰는 기본 템플릿 (#188).
 *
 * 지금까지 이 상수는 프롬프트 편집 UI 에만 쓰이고 생성은 별도 인라인 문자열을 썼다.
 * 사용자가 '글 작성 규칙'을 고쳐도 결과가 그대로였다. 이제 이 템플릿이 생성 프롬프트의
 * 앞부분이 되고, 뒤에 시스템이 강제하는 규칙(출력 형식·사진 표시·협찬 표기·금액 금지)이
 * 붙는다. 편집으로 깨지면 안 되는 것은 코드에 남긴다.
 */
const SYSTEM_PROMPT = `캠페인: {{campaign_name}}
방문일: {{visit_date}}
업종·분류: {{category}}
플레이스 링크: {{place_url}}
문체: {{tone_profile}}
사용자 지정 태그: {{user_tags}}
방문 메모: {{visit_notes}}
음성메모(직접 말한 내용): {{voice_notes}}
체험단 요구사항: {{requirements}}
첨부: {{image_summaries}}
영상에서 뽑은 장면: {{video_summaries}}
확인이 필요한 항목: {{unconfirmed_items}}

그 자리에 있었던 사람이 그날을 이야기하듯 쓰세요. 이미지는 방문 순서대로 들어오니 그 흐름을 따라갑니다.

보이는 것에서 자연히 이어지는 행동과 그 자리에서 느낀 인상은 써도 됩니다 — 들어가고 앉고 잔을 받는 동작, 그리고 '아늑했다', '북적였다' 같은 분위기 표현입니다. 다만 검증 가능한 사실은 근거가 있어야 합니다: 가격·메뉴명·주소·영업시간·날짜는 위 자료에 적힌 것만 쓰고, 없으면 쓰지 마세요.

사진·영상 자체를 언급하지 마세요. '사진에는', '영상 장면', '장면이 이어졌다', '찍혀 있습니다', '클로즈업으로' 같은 표현을 쓰지 마세요. 촬영물을 설명하는 글이 아니라 방문기입니다.

소제목(## )을 반드시 넣고, 사진 목록이 아니라 그 순간의 이름으로 붙이세요.

위 캠페인 정보와 체험단 요구사항은 등록된 사실이니 그대로 쓸 수 있습니다. 요구사항에 영업시간·주소·필수 키워드가 있으면 본문에 자연스럽게 넣으세요.

본문 1,000자를 목표로 하되, 보이지 않는 것으로 채우지 말고 보이는 것을 더 자세히 묘사하세요. 근거가 부족하면 짧아도 됩니다.`;

export class NBlogError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const nowIso = () => new Date().toISOString();
const jsonResponse = (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), {
  ...init,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
    ...(init?.headers || {}),
  },
});

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function objectValue(value: unknown, field = "요청 본문"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NBlogError(400, "invalid_payload", `${field}이 올바른 JSON 객체가 아닙니다.`);
  }
  return value as Record<string, unknown>;
}

async function requestJson(request: Request, maxBytes = 12 * 1024 * 1024): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new NBlogError(413, "payload_too_large", "요청 본문이 허용 크기를 초과했습니다.");
  if (!request.body) throw new NBlogError(400, "invalid_payload", "JSON request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new NBlogError(413, "payload_too_large", "Request body exceeds the allowed size.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown = null;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new NBlogError(400, "invalid_payload", "Request body must be a valid JSON object."); }
  return objectValue(value);
}

function assertContractVersion(request: Request): void {
  const supplied = request.headers.get("x-nblog-contract-version");
  if (supplied && supplied !== NBLOG_CONTRACT_VERSION) {
    throw new NBlogError(409, "contract_version_mismatch", "The NBlog contract version is not supported.", {
      expected_contract_version: NBLOG_CONTRACT_VERSION,
      received_contract_version: supplied,
      retryable: false,
    });
  }
}

async function enforceNBlogRateLimit(limiter: RateLimit | undefined, key: string, scope: string): Promise<void> {
  if (!limiter) return;
  const { success } = await limiter.limit({ key: await sha256(`${scope}:${key}`) });
  if (!success) {
    throw new NBlogError(429, "rate_limited", "Too many NBlog requests were received. Try again shortly.", {
      rate_limit_scope: scope,
      retry_after_seconds: 60,
      retryable: true,
    });
  }
}

async function assertNBlogActorBoundary(request: Request, env: NBlogEnv, actor: NBlogActor, path: string): Promise<void> {
  const method = request.method.toUpperCase();
  if (actor.viaToken) {
    const allowed = method === "POST" && SYNC_TOKEN_WRITE_ROUTES.some((route) => route.test(path));
    if (!allowed) {
      throw new NBlogError(403, "sync_token_scope_forbidden", "CLI sync tokens can only synchronize campaign artifacts and media.", {
        allowed_scope: "sync:write",
        retryable: false,
      });
    }
    await enforceNBlogRateLimit(env.NBLOG_SYNC_RATE_LIMITER, actor.userId, "sync");
    return;
  }
  if (!MUTATING_METHODS.has(method)) return;
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new NBlogError(403, "csrf_origin_mismatch", "This operation requires a same-origin browser request.", {
      retryable: false,
    });
  }
  await enforceNBlogRateLimit(env.NBLOG_UI_RATE_LIMITER, actor.userId, "ui");
}

function requestId(request?: Request): string {
  return request?.headers.get("x-request-id")?.slice(0, 128) || crypto.randomUUID();
}

export function withNBlogResponseHeaders(response: Response, request?: Request): Response {
  response.headers.set("x-nblog-contract-version", NBLOG_CONTRACT_VERSION);
  response.headers.set("x-request-id", requestId(request));
  return response;
}

function stringField(value: unknown, field: string, max: number, required = true): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new NBlogError(400, "invalid_field", `${field} 값이 필요합니다.`, { field });
  if (text.length > max) throw new NBlogError(400, "invalid_field", `${field} 값이 너무 깁니다.`, { field, maximum: max });
  return text;
}

function optionalString(value: unknown, field: string, max: number): string | null {
  const text = stringField(value, field, max, false);
  return text || null;
}

function validHttpUrl(value: string, field: string, hosts?: Set<string>): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new NBlogError(400, "invalid_url", `${field} URL 형식이 올바르지 않습니다.`, { field }); }
  if (parsed.protocol !== "https:") throw new NBlogError(400, "invalid_url", `${field}은 https URL이어야 합니다.`, { field });
  if (hosts && !hosts.has(parsed.hostname)) throw new NBlogError(400, "invalid_url", `${field}의 허용되지 않은 호스트입니다.`, { field });
  return parsed.toString();
}

/**
 * 플레이스 링크가 특정 장소를 가리키는지 확인한다 (#190).
 *
 * `https://map.naver.com/` 처럼 지도 홈만 등록된 캠페인이 있었고, 모델은 지시대로 그
 * 값을 본문에 그대로 썼다. 형식만 보는 validHttpUrl 로는 걸러지지 않는다.
 */
export function isPlaceholderPlaceUrl(value: string): boolean {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return true; }
  const host = parsed.hostname.replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, "");
  const query = parsed.search;
  // 단축 링크는 경로에 식별자가 있어야 한다: naver.me/FDjil0KT
  if (host === "naver.me") return path.length <= 1;
  // 지도·플레이스는 경로나 질의로 장소를 특정해야 한다
  if (host === "map.naver.com" || host === "m.map.naver.com" || host === "place.naver.com" || host === "m.place.naver.com") {
    return !path && !query;
  }
  // 그 외 호스트는 루트만 있으면 장소를 가리킨다고 볼 수 없다
  return !path && !query;
}

function placeUrlField(value: unknown): string {
  const url = validHttpUrl(stringField(value, "place_url", 500), "place_url");
  if (isPlaceholderPlaceUrl(url)) {
    throw new NBlogError(400, "invalid_place_url", "특정 장소를 가리키는 플레이스 링크가 필요합니다. 지도 홈 주소는 사용할 수 없습니다.", {
      field: "place_url",
      example: "https://naver.me/XXXXXXXX",
    });
  }
  return url;
}

function campaignId(value: unknown): string {
  const id = stringField(value, "campaign_id", 64).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(id)) throw new NBlogError(400, "invalid_campaign_id", "campaign_id는 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.");
  return id;
}

function dateField(value: unknown, field: string): string {
  const text = stringField(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new NBlogError(400, "invalid_date", `${field}은 YYYY-MM-DD 형식이어야 합니다.`, { field });
  }
  return text;
}

function relativeSourceFolder(value: unknown): string | null {
  const text = optionalString(value, "source_folder", 240);
  if (!text) return null;
  if (/^[A-Za-z]:[\\/]/.test(text) || text.startsWith("/") || text.split(/[\\/]/).includes("..")) {
    throw new NBlogError(400, "absolute_path_rejected", "source_folder에는 저장소 내부 상대 경로만 사용할 수 있습니다.");
  }
  return text.replace(/\\/g, "/");
}

function normalizedTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new NBlogError(400, "invalid_tags", "user_tags는 배열이어야 합니다.");
  const tags = value.map((item) => String(item ?? "").trim().replace(/^#+/, "").replace(/[\s,]+/g, "")).filter(Boolean);
  if (tags.length > 40 || tags.some((tag) => tag.length > 40)) throw new NBlogError(400, "invalid_tags", "태그 수 또는 길이가 허용 범위를 초과했습니다.");
  if (new Set(tags.map((tag) => tag.toLocaleLowerCase())).size !== tags.length) throw new NBlogError(400, "duplicate_tags", "중복 태그를 제거해 주세요.");
  return tags;
}

function safeFileName(value: string): string {
  const name = value.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 120);
  return name || "file";
}

function isSha256(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/i.test(value);
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableNormalize(item)]));
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function idempotentMutation(
  request: Request,
  env: NBlogEnv,
  actor: NBlogActor,
  scope: string,
  body: Record<string, unknown>,
  run: () => Promise<Response>,
): Promise<Response> {
  const key = request.headers.get("idempotency-key")?.trim() || "";
  if (!key) return run(); // Compatibility window for clients predating contract 1.0.
  if (key.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new NBlogError(400, "invalid_idempotency_key", "Idempotency-Key contains unsupported characters or is too long.", { retryable: false });
  }
  const requestHash = `sha256:${await sha256(stableStringify(body))}`;
  const load = () => env.DB.prepare(
    `SELECT request_hash, response_json, status_code FROM nblog_idempotency_records
     WHERE user_id=?1 AND scope=?2 AND idempotency_key=?3 AND expires_at>?4`
  ).bind(actor.userId, scope, key, nowIso()).first<{ request_hash: string; response_json: string; status_code: number }>();
  const replay = (row: { request_hash: string; response_json: string; status_code: number }): Response => {
    if (row.request_hash !== requestHash) {
      throw new NBlogError(409, "idempotency_key_conflict", "The Idempotency-Key was already used with a different request.", { retryable: false });
    }
    return jsonResponse(parseJson<unknown>(row.response_json, {}), { status: row.status_code, headers: { "x-idempotent-replay": "true" } });
  };
  const existing = await load();
  if (existing) return replay(existing);

  const response = await run();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response;
  const responseBody = await response.clone().json();
  const now = nowIso();
  try {
    await env.DB.prepare(
      `INSERT INTO nblog_idempotency_records
       (user_id, scope, idempotency_key, request_hash, response_json, status_code, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(actor.userId, scope, key, requestHash, JSON.stringify(responseBody), response.status,
      now, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()).run();
  } catch (error) {
    const raced = await load();
    if (raced) return replay(raced);
    throw error;
  }
  return response;
}

function randomToken(bytes = 32): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function secretTextFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(nbs_[A-Za-z0-9_-]{32,})$/i);
  return match?.[1] || null;
}

export async function authenticateNBlogBearer(request: Request, env: NBlogEnv): Promise<NBlogActor | null> {
  const token = secretTextFromRequest(request);
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT id, user_id, label FROM nblog_sync_tokens WHERE token_hash=?1 AND revoked_at IS NULL LIMIT 1"
  ).bind(hash).first<{ id: string; user_id: string; label: string }>();
  if (!row) throw new NBlogError(401, "invalid_sync_token", "동기화 토큰이 올바르지 않거나 폐기되었습니다.");
  await env.DB.prepare("UPDATE nblog_sync_tokens SET last_used_at=?1 WHERE id=?2").bind(nowIso(), row.id).run();
  return { userId: row.user_id, label: row.label || "local-cli", viaToken: true };
}

export function validatePromptTemplate(templateValue: unknown): {
  valid: boolean;
  placeholders: string[];
  unknown: string[];
  missing: string[];
  errors: Array<{ field: string; code: string; message: string }>;
} {
  const template = typeof templateValue === "string" ? templateValue : "";
  const placeholders = [...new Set([...template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((match) => match[1]))];
  const unknown = placeholders.filter((name) => !ALLOWED_PLACEHOLDERS.has(name));
  const missing = [...REQUIRED_PLACEHOLDERS].filter((name) => !placeholders.includes(name));
  const errors: Array<{ field: string; code: string; message: string }> = [];
  if (!template.trim()) errors.push({ field: "template", code: "required", message: "프롬프트 템플릿이 필요합니다." });
  if (template.length > 20_000) errors.push({ field: "template", code: "too_long", message: "프롬프트는 20,000자를 초과할 수 없습니다." });
  if (/<script\b|javascript:/i.test(template)) errors.push({ field: "template", code: "unsafe_markup", message: "script 또는 javascript: 입력은 사용할 수 없습니다." });
  if (unknown.length) errors.push({ field: "template", code: "unknown_placeholders", message: `알 수 없는 플레이스홀더: ${unknown.join(", ")}` });
  if (missing.length) errors.push({ field: "template", code: "missing_placeholders", message: `필수 플레이스홀더 누락: ${missing.join(", ")}` });
  return { valid: errors.length === 0, placeholders, unknown, missing, errors };
}

export function canonicalPublishedNaverPostUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.port
      || url.username
      || url.password
      || !new Set(["blog.naver.com", "m.blog.naver.com"]).has(url.hostname)
    ) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    let blogId = "";
    let logNo = "";
    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      blogId = decodeURIComponent(parts[0]);
      logNo = parts[1];
    } else if (parts.length === 1 && parts[0].toLowerCase() === "postview.naver") {
      blogId = url.searchParams.get("blogId") || "";
      logNo = url.searchParams.get("logNo") || "";
    }
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(blogId) || !/^\d{1,30}$/.test(logNo)) return null;

    const canonicalLogNo = logNo.replace(/^0+(?=\d)/, "");
    return `https://blog.naver.com/${blogId.toLowerCase()}/${canonicalLogNo}`;
  } catch { return null; }
}

export function isPublishedNaverPostUrl(value: unknown): boolean {
  return canonicalPublishedNaverPostUrl(value) !== null;
}

function campaignFromRow(row: CampaignRow) {
  const scheduled = row.scheduled_at ? new Date(row.scheduled_at) : null;
  return {
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    campaign_url: row.campaign_url,
    place_url: row.place_url,
    visit_date: row.visit_date,
    visit_notes: row.visit_notes,
    requirements: row.requirements,
    tone_profile: row.tone_profile,
    user_tags: parseJson<string[]>(row.user_tags_json, []),
    prompt_profile_id: row.prompt_profile_id,
    prompt_snapshot_hash: row.prompt_snapshot_hash,
    blog_url: row.blog_url,
    category: row.category,
    // 보관된 캠페인은 화면에서 별도 상태로 보여준다. 실제 status 는 그대로 보존한다.
    status: row.archived_at ? "archived" : row.status,
    archived: !!row.archived_at,
    contract_version: row.contract_version || NBLOG_CONTRACT_VERSION,
    operation_status: row.operation_status || "local_ready",
    validation_passed: row.validation_passed === 1,
    approved: !!row.approved_at,
    scheduled_date: scheduled ? scheduled.toISOString().slice(0, 10) : "",
    scheduled_time: scheduled ? scheduled.toISOString().slice(11, 16) : "",
    published_url: row.published_url,
    published_at: row.published_at,
    requirement_version: row.requirement_version,
    draft_version: row.draft_version,
    validation_version: row.validation_version,
    profile_version: row.profile_version,
    artifact_version: row.artifact_version,
    artifact_content_hash: row.artifact_content_hash,
    last_sync_at: row.last_sync_at,
    failure_stage: row.failure_stage,
    failure_reason: row.failure_reason,
    resume_stage: row.resume_stage,
    resume_point: row.resume_point,
    remaining_steps: parseJson<string[]>(row.remaining_steps_json, []),
    last_checkpoint_at: row.last_checkpoint_at,
    retry_count: row.retry_count,
    retry_limit: row.retry_limit,
    retryable: row.retryable === 1,
    workflow_instance_id: row.workflow_instance_id,
    generation_status: row.generation_status || "not_started",
    generation_input_hash: row.generation_input_hash,
    content_confirmed_at: row.content_confirmed_at,
    content_confirmed_by: row.content_confirmed_by,
    content_confirmed_artifact_version: row.content_confirmed_artifact_version,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findCampaign(env: NBlogEnv, userId: string, id: string): Promise<CampaignRow | null> {
  return env.DB.prepare("SELECT * FROM nblog_campaigns WHERE user_id=?1 AND campaign_id=?2")
    .bind(userId, id).first<CampaignRow>();
}

async function requireCampaign(env: NBlogEnv, userId: string, id: string): Promise<CampaignRow> {
  const row = await findCampaign(env, userId, id);
  if (!row) throw new NBlogError(404, "campaign_not_found", "캠페인을 찾을 수 없습니다.");
  return row;
}

async function insertAudit(
  env: NBlogEnv,
  actor: NBlogActor,
  campaign: Pick<CampaignRow, "campaign_id" | "requirement_version" | "draft_version" | "validation_version" | "profile_version">,
  action: string,
  result: "success" | "failed" | "waiting",
  fromStatus: string | null,
  toStatus: string | null,
  reason: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const safeActor = redactSensitiveText(actor.label);
  const safeReason = redactSensitiveText(reason);
  const safeMetadata = redactSensitiveValue(metadata);
  await env.DB.prepare(
    `INSERT INTO nblog_audit_logs
      (id, user_id, campaign_id, action, result, from_status, to_status, actor, reason,
       requirement_version, draft_version, validation_version, profile_version, metadata_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`
  ).bind(
    crypto.randomUUID(), actor.userId, campaign.campaign_id, action, result, fromStatus, toStatus,
    safeActor, safeReason, campaign.requirement_version, campaign.draft_version,
    campaign.validation_version, campaign.profile_version, JSON.stringify(safeMetadata), nowIso(),
  ).run();
}

function redactSensitiveText(value: string): string {
  if (PROMPT_MARKER_PATTERN.test(value)) return "[redacted-prompt]";
  return value
    .replace(SENSITIVE_TEXT_PATTERN, "[redacted]")
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, "[redacted-path]")
    .replace(UNIX_ABSOLUTE_PATH_PATTERN, "$1[redacted-path]");
}

function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redactSensitiveValue(item),
  ]));
}

function assertNoSensitiveText(value: unknown, field: string): void {
  if (typeof value === "string" && redactSensitiveText(value) !== value) {
    throw new NBlogError(400, "sensitive_content_rejected", `${field} must not contain credentials, cookies, prompts, or local paths.`, {
      field,
      retryable: false,
    });
  }
}

function assertOptimisticVersion(row: CampaignRow, body: Record<string, unknown>): void {
  const expectedUpdatedAt = typeof body.expected_updated_at === "string" ? body.expected_updated_at : "";
  const expectedVersion = Number(body.expected_version || 0);
  if ((expectedUpdatedAt && expectedUpdatedAt !== row.updated_at) || (expectedVersion && expectedVersion !== row.version)) {
    throw new NBlogError(409, "campaign_conflict", "다른 화면에서 캠페인이 먼저 변경되었습니다. 최신 상태를 다시 불러오세요.", {
      current_updated_at: row.updated_at,
      current_version: row.version,
    });
  }
}

function campaignInput(body: Record<string, unknown>) {
  const id = campaignId(body.campaign_id || body.id);
  const name = stringField(body.campaign_name || body.name, "campaign_name", 120);
  const campaignUrl = validHttpUrl(stringField(body.campaign_url, "campaign_url", 500), "campaign_url");
  const placeUrl = placeUrlField(body.place_url);
  const visitDate = dateField(body.visit_date, "visit_date");
  const promptOverride = optionalString(body.prompt_override, "prompt_override", 20_000);
  if (promptOverride) {
    const checked = validatePromptTemplate(promptOverride);
    if (!checked.valid) throw new NBlogError(400, "invalid_prompt", "캠페인 프롬프트를 저장할 수 없습니다.", { field_errors: checked.errors });
  }
  return {
    id,
    name,
    campaignUrl,
    placeUrl,
    visitDate,
    visitNotes: stringField(body.visit_notes, "visit_notes", 8_000, false),
    // 체험단 가이드라인 원문. 키워드·필수 문구·영업시간 같은 "확인된 사실"이 여기 담긴다.
    requirements: stringField(body.requirements, "requirements", 8_000, false),
    toneProfile: stringField(body.tone_profile, "tone_profile", 120, false),
    userTags: normalizedTags(body.user_tags),
    promptProfileId: optionalString(body.prompt_profile_id, "prompt_profile_id", 80),
    promptOverride,
    sourceFolder: relativeSourceFolder(body.source_folder),
    blogUrl: body.blog_url ? validHttpUrl(stringField(body.blog_url, "blog_url", 500), "blog_url", new Set(["blog.naver.com", "m.blog.naver.com"])) : null,
    category: optionalString(body.category, "category", 120),
  };
}

async function listCampaigns(env: NBlogEnv, actor: NBlogActor, archivedOnly = false): Promise<Response> {
  // 기본 목록은 보관 항목을 숨긴다. 보관함(view=archived)에서만 보관된 캠페인을 조회한다.
  const statusClause = archivedOnly ? "AND archived_at IS NOT NULL" : "AND archived_at IS NULL";
  const [campaignRows, auditRows] = await Promise.all([
    env.DB.prepare(`SELECT * FROM nblog_campaigns WHERE user_id=?1 ${statusClause} ORDER BY updated_at DESC LIMIT 200`)
      .bind(actor.userId).all<CampaignRow>(),
    env.DB.prepare(
      `SELECT a.*, c.campaign_name
       FROM nblog_audit_logs a
       LEFT JOIN nblog_campaigns c ON c.user_id=a.user_id AND c.campaign_id=a.campaign_id
       WHERE a.user_id=?1 ORDER BY a.created_at DESC LIMIT 50`
    ).bind(actor.userId).all<Record<string, unknown>>(),
  ]);
  const audits = (auditRows.results || []).map((row) => ({
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    result: row.result,
    result_label: row.action,
    processed_at: row.created_at,
    requirement_version: row.requirement_version,
    draft_version: row.draft_version,
    validation_version: row.validation_version,
    profile_version: row.profile_version,
    next_action: row.to_status === "published" ? "게시물 열기" : String(row.reason || "상세 확인"),
    published_url: parseJson<Record<string, unknown>>(String(row.metadata_json || "{}"), {}).published_url || null,
  }));
  return jsonResponse({ campaigns: (campaignRows.results || []).map(campaignFromRow), audits });
}

async function createCampaign(env: NBlogEnv, actor: NBlogActor, body: Record<string, unknown>): Promise<Response> {
  const input = campaignInput(body);
  const existing = await findCampaign(env, actor.userId, input.id);
  const now = nowIso();
  if (existing && existing.visit_date !== input.visitDate) {
    throw new NBlogError(409, "campaign_id_conflict", "같은 캠페인 ID가 다른 방문일에 이미 사용되었습니다.", {
      existing_visit_date: existing.visit_date,
    });
  }
  await env.DB.prepare(
    `INSERT INTO nblog_campaigns
      (user_id, campaign_id, campaign_name, campaign_url, place_url, visit_date, visit_notes,
       requirements, tone_profile, user_tags_json, prompt_profile_id, prompt_override, source_folder,
       blog_url, category, status, contract_version, operation_status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
       'queued', '${NBLOG_CONTRACT_VERSION}', 'local_ready', ?16, ?16)
     ON CONFLICT(user_id, campaign_id) DO UPDATE SET
       campaign_name=excluded.campaign_name, campaign_url=excluded.campaign_url,
       place_url=excluded.place_url, visit_notes=excluded.visit_notes,
       requirements=excluded.requirements,
       tone_profile=excluded.tone_profile, user_tags_json=excluded.user_tags_json,
       prompt_profile_id=excluded.prompt_profile_id, prompt_override=excluded.prompt_override,
       source_folder=excluded.source_folder, blog_url=excluded.blog_url, category=excluded.category,
       contract_version=excluded.contract_version,
       version=nblog_campaigns.version+1, updated_at=excluded.updated_at`
  ).bind(
    actor.userId, input.id, input.name, input.campaignUrl, input.placeUrl, input.visitDate,
    input.visitNotes, input.requirements, input.toneProfile, JSON.stringify(input.userTags),
    input.promptProfileId, input.promptOverride, input.sourceFolder, input.blogUrl, input.category, now,
  ).run();
  const saved = await requireCampaign(env, actor.userId, input.id);
  await insertAudit(env, actor, saved, existing ? "campaign_updated" : "campaign_created", "success", existing?.status || null, saved.status, existing ? "캠페인 입력 정보를 갱신했습니다." : "캠페인을 작업 큐에 등록했습니다.");
  return jsonResponse(campaignFromRow(saved), { status: existing ? 200 : 201 });
}

// 발행 전 단계에서만 방문일을 고칠 수 있다. createCampaign 의 conflict 가드레일(같은 ID·다른
// 날짜 = 409)을 우회하지 않고, 이미 존재하는 그 행의 visit_date 만 직접 갱신한다.
const VISIT_DATE_EDITABLE_STATUSES = new Set(["queued", "analysis", "validation", "failed"]);

async function updateVisitDate(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>): Promise<Response> {
  const campaign = await requireCampaign(env, actor.userId, id);
  assertOptimisticVersion(campaign, body);
  if (campaign.archived_at || !VISIT_DATE_EDITABLE_STATUSES.has(campaign.status)) {
    throw new NBlogError(409, "invalid_state", "발행 전(사진 대기·글 작성·검증·실패) 캠페인만 방문일을 바꿀 수 있습니다.", { current_status: campaign.archived_at ? "archived" : campaign.status });
  }
  const visitDate = dateField(body.visit_date, "visit_date");
  if (visitDate === campaign.visit_date) return jsonResponse(campaignFromRow(campaign));
  const now = nowIso();
  const result = await env.DB.prepare(
    `UPDATE nblog_campaigns SET visit_date=?1, version=version+1, updated_at=?2
     WHERE user_id=?3 AND campaign_id=?4 AND version=?5`
  ).bind(visitDate, now, actor.userId, id, campaign.version).run();
  if (!result.meta.changes) {
    throw new NBlogError(409, "campaign_conflict", "다른 화면에서 캠페인이 먼저 변경되었습니다. 최신 상태를 다시 불러오세요.", { retryable: false });
  }
  const saved = await requireCampaign(env, actor.userId, id);
  await insertAudit(env, actor, saved, "visit_date_updated", "success", campaign.status, saved.status,
    `방문일을 ${campaign.visit_date} → ${visitDate} 로 변경했습니다.`, { from_visit_date: campaign.visit_date, to_visit_date: visitDate });
  return jsonResponse(campaignFromRow(saved));
}

// 하드 삭제 대신 소프트 보관. 발행물은 이력 보존을 위해 보관 금지. R2 사진 사본은 정리하되
// (기존 deleteMedia 정리 패턴 재사용) 로컬 원본은 건드리지 않는다.
async function archiveCampaign(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>): Promise<Response> {
  const campaign = await requireCampaign(env, actor.userId, id);
  assertOptimisticVersion(campaign, body);
  if (campaign.archived_at) return jsonResponse(campaignFromRow(campaign));
  if (campaign.status === "published") {
    throw new NBlogError(409, "invalid_state", "이미 블로그에 올린 캠페인은 보관할 수 없습니다.", { current_status: campaign.status });
  }
  if (typeof body.confirm_name !== "string" || body.confirm_name.trim() !== campaign.campaign_name.trim()) {
    throw new NBlogError(400, "confirmation_required", "캠페인 이름을 정확히 입력해야 보관할 수 있습니다.", { retryable: false });
  }
  const now = nowIso();
  const media = await env.DB.prepare(
    "SELECT object_key FROM nblog_media_assets WHERE user_id=?1 AND campaign_id=?2 AND object_key IS NOT NULL"
  ).bind(actor.userId, id).all<{ object_key: string }>();
  for (const row of media.results || []) {
    if (row.object_key) await env.R2.delete(row.object_key);
  }
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE nblog_media_assets SET object_key=NULL, included=0, is_cover=0, status='excluded', updated_at=?1 WHERE user_id=?2 AND campaign_id=?3")
      .bind(now, actor.userId, id),
    env.DB.prepare("UPDATE nblog_campaigns SET archived_at=?1, version=version+1, updated_at=?1 WHERE user_id=?2 AND campaign_id=?3 AND version=?4")
      .bind(now, actor.userId, id, campaign.version),
  ]);
  if (!result[1].meta.changes) {
    throw new NBlogError(409, "campaign_conflict", "다른 화면에서 캠페인이 먼저 변경되었습니다. 최신 상태를 다시 불러오세요.", { retryable: false });
  }
  const saved = await requireCampaign(env, actor.userId, id);
  await insertAudit(env, actor, saved, "campaign_archived", "success", campaign.status, "archived",
    "캠페인을 보관하고 R2 사진 사본을 정리했습니다. 로컬 원본은 변경하지 않았습니다.", { previous_status: campaign.status });
  return jsonResponse(campaignFromRow(saved));
}

// 보관 취소. 실제 status 는 보관 전 그대로 보존돼 있으므로 archived_at 만 지운다.
// 사진 사본은 보관 때 정리됐으므로 복구되지 않는다.
async function restoreCampaign(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>): Promise<Response> {
  const campaign = await requireCampaign(env, actor.userId, id);
  assertOptimisticVersion(campaign, body);
  if (!campaign.archived_at) return jsonResponse(campaignFromRow(campaign));
  const now = nowIso();
  const result = await env.DB.prepare(
    "UPDATE nblog_campaigns SET archived_at=NULL, version=version+1, updated_at=?1 WHERE user_id=?2 AND campaign_id=?3 AND version=?4"
  ).bind(now, actor.userId, id, campaign.version).run();
  if (!result.meta.changes) {
    throw new NBlogError(409, "campaign_conflict", "다른 화면에서 캠페인이 먼저 변경되었습니다. 최신 상태를 다시 불러오세요.", { retryable: false });
  }
  const saved = await requireCampaign(env, actor.userId, id);
  await insertAudit(env, actor, saved, "campaign_restored", "success", "archived", saved.status,
    "보관을 취소해 목록으로 되돌렸습니다. 삭제된 사진 사본은 복구되지 않습니다.", {});
  return jsonResponse(campaignFromRow(saved));
}

const FORBIDDEN_KEY = /(password|cookie|session(?:_token)?|access_token|refresh_token|authorization|browser_profile)/i;
const PATH_KEY = /(path|folder|directory)$/i;

function inspectArtifactSafety(value: unknown, pathParts: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectArtifactSafety(item, [...pathParts, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new NBlogError(400, "sensitive_field_rejected", "인증정보 또는 브라우저 상태 필드는 동기화할 수 없습니다.", { field: [...pathParts, key].join(".") });
    if (PATH_KEY.test(key) && typeof item === "string" && (/^[A-Za-z]:[\\/]/.test(item) || /^\/(Users|home|root)\//.test(item))) {
      throw new NBlogError(400, "absolute_path_rejected", "로컬 절대 경로는 동기화할 수 없습니다.", { field: [...pathParts, key].join(".") });
    }
    inspectArtifactSafety(item, [...pathParts, key]);
  }
}

const ARTIFACT_FILES: Record<string, { file: string; contentType: string; json: boolean; required: boolean }> = {
  manifest: { file: "manifest.json", contentType: "application/json", json: true, required: true },
  media_analysis: { file: "media-analysis.json", contentType: "application/json", json: true, required: false },
  requirements: { file: "requirements.json", contentType: "application/json", json: true, required: true },
  draft: { file: "draft.json", contentType: "application/json", json: true, required: true },
  draft_markdown: { file: "draft.md", contentType: "text/markdown; charset=utf-8", json: false, required: true },
  validation: { file: "validation.json", contentType: "application/json", json: true, required: true },
  preview_html: { file: "preview.html", contentType: "text/html; charset=utf-8", json: false, required: true },
};

function artifactInput(body: Record<string, unknown>, id: string) {
  const contractVersion = optionalString(body.contract_version, "contract_version", 20) || NBLOG_CONTRACT_VERSION;
  if (contractVersion !== NBLOG_CONTRACT_VERSION) {
    throw new NBlogError(409, "contract_version_mismatch", "The artifact contract version is not supported.", {
      expected_contract_version: NBLOG_CONTRACT_VERSION,
      received_contract_version: contractVersion,
      retryable: false,
    });
  }
  const schemaVersion = stringField(body.schema_version, "schema_version", 20);
  const contentHash = stringField(body.content_hash, "content_hash", 80);
  if (!isSha256(contentHash)) throw new NBlogError(400, "invalid_content_hash", "content_hash는 sha256:<64자리 hex> 형식이어야 합니다.");
  const canonicalContentHash = contentHash.toLowerCase();
  const idempotencyKey = stringField(body.idempotency_key, "idempotency_key", 160);
  const artifacts = objectValue(body.artifacts, "artifacts");
  for (const [name, contract] of Object.entries(ARTIFACT_FILES)) {
    if (contract.required && artifacts[name] === undefined) throw new NBlogError(400, "missing_artifact", `${contract.file} 산출물이 필요합니다.`, { artifact: name });
    const value = artifacts[name];
    if (value === undefined) continue;
    if (contract.json && (!value || typeof value !== "object" || Array.isArray(value))) throw new NBlogError(400, "invalid_artifact", `${contract.file} 산출물이 JSON 객체가 아닙니다.`);
    if (!contract.json && typeof value !== "string") throw new NBlogError(400, "invalid_artifact", `${contract.file} 산출물이 문자열이 아닙니다.`);
  }
  const manifest = objectValue(artifacts.manifest, "manifest.json");
  const requirements = objectValue(artifacts.requirements, "requirements.json");
  const draft = objectValue(artifacts.draft, "draft.json");
  const validation = objectValue(artifacts.validation, "validation.json");
  for (const artifact of Object.values(artifacts)) inspectArtifactSafety(artifact);
  if (String(manifest.campaign_id || "") !== id || String(requirements.campaign_id || "") !== id || String(draft.campaign_id || "") !== id || String(validation.campaign_id || "") !== id) {
    throw new NBlogError(409, "artifact_campaign_mismatch", "산출물의 campaign_id가 요청 경로와 일치하지 않습니다.");
  }
  return { contractVersion, schemaVersion, contentHash: canonicalContentHash, idempotencyKey, artifacts, manifest, requirements, draft, validation };
}

function errorMessages(validation: Record<string, unknown>): string[] {
  const checks = Array.isArray(validation.checks) ? validation.checks : [];
  return checks.filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).status === "error")
    .map((item) => String((item as Record<string, unknown>).message || (item as Record<string, unknown>).rule || "검증 오류"))
    .slice(0, 20);
}

async function latestArtifact(env: NBlogEnv, userId: string, id: string): Promise<ArtifactVersionRow | null> {
  return env.DB.prepare(
    "SELECT artifact_version, content_hash, idempotency_key, object_keys_json, validation_passed, created_at FROM nblog_artifact_versions WHERE user_id=?1 AND campaign_id=?2 ORDER BY artifact_version DESC LIMIT 1"
  ).bind(userId, id).first<ArtifactVersionRow>();
}

async function syncArtifacts(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>): Promise<Response> {
  const campaign = await requireCampaign(env, actor.userId, id);
  const input = artifactInput(body, id);
  const expectedIdempotencyKey = `${id}:${campaign.visit_date}`;
  if (input.idempotencyKey !== expectedIdempotencyKey) {
    throw new NBlogError(409, "idempotency_key_mismatch", "idempotency_key는 캠페인 ID와 방문일로 구성해야 합니다.", { expected: expectedIdempotencyKey });
  }
  const canonicalHash = `sha256:${await sha256(stableStringify(input.artifacts))}`;
  if (canonicalHash !== input.contentHash.toLowerCase()) {
    throw new NBlogError(422, "content_hash_mismatch", "산출물 콘텐츠 체크섬이 실제 요청과 일치하지 않습니다.", { expected: canonicalHash });
  }
  const reused = await env.DB.prepare(
    "SELECT artifact_version, content_hash, idempotency_key, object_keys_json, validation_passed, created_at FROM nblog_artifact_versions WHERE user_id=?1 AND campaign_id=?2 AND content_hash=?3 LIMIT 1"
  ).bind(actor.userId, id, input.contentHash).first<ArtifactVersionRow>();
  if (reused) {
    return jsonResponse({ contract_version: NBLOG_CONTRACT_VERSION, campaign_id: id, artifact_version: reused.artifact_version, content_hash: reused.content_hash, reused: true, validation_passed: reused.validation_passed === 1 });
  }
  const previous = await latestArtifact(env, actor.userId, id);
  const artifactVersion = (previous?.artifact_version || 0) + 1;
  const userPrefix = (await sha256(actor.userId)).slice(0, 16);
  const baseKey = `nblog/${userPrefix}/${safeFileName(id)}/v${artifactVersion}`;
  const objectKeys: Record<string, string> = {};
  for (const [name, contract] of Object.entries(ARTIFACT_FILES)) {
    const value = input.artifacts[name];
    if (value === undefined) continue;
    const key = `${baseKey}/${contract.file}`;
    const contents = contract.json ? `${JSON.stringify(value, null, 2)}\n` : String(value);
    await env.R2.put(key, contents, {
      httpMetadata: { contentType: contract.contentType },
      customMetadata: { campaign_id: id, artifact_version: String(artifactVersion), content_hash: input.contentHash },
    });
    objectKeys[name] = key;
  }
  const validationPassed = input.validation.status === "passed" && input.validation.approval_allowed === true;
  const nextStatus = validationPassed ? "approval" : "handoff";
  const nextOperationStatus = validationPassed ? "approval_waiting" : "validation_failed";
  const errors = errorMessages(input.validation);
  const requirementVersion = String(input.requirements.snapshot_hash || input.validation.input_versions && objectValue(input.validation.input_versions).requirements || "").slice(0, 120) || null;
  const draftVersion = String(input.draft.draft_version || input.draft.snapshot_hash || "").slice(0, 120) || null;
  const validationVersion = String(input.validation.validator_version || input.validation.input_hash || "").slice(0, 120) || null;
  const prompt = input.draft.prompt && typeof input.draft.prompt === "object" ? input.draft.prompt as Record<string, unknown> : {};
  const profileVersion = String(prompt.profile_version || "").slice(0, 120) || null;
  const promptHash = String(prompt.rendered_hash || "").slice(0, 120) || null;
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO nblog_artifact_versions
        (user_id, campaign_id, artifact_version, schema_version, content_hash, idempotency_key,
         object_keys_json, requirement_version, draft_version, validation_version, profile_version,
         validation_passed, created_at, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
    ).bind(actor.userId, id, artifactVersion, input.schemaVersion, input.contentHash, input.idempotencyKey,
      JSON.stringify(objectKeys), requirementVersion, draftVersion, validationVersion, profileVersion,
      validationPassed ? 1 : 0, now, actor.label),
    env.DB.prepare(
      `UPDATE nblog_campaigns SET status=?1, operation_status=?19,
       contract_version='${NBLOG_CONTRACT_VERSION}', validation_passed=?2, artifact_version=?3,
       artifact_content_hash=?4, requirement_version=?5, draft_version=?6, validation_version=?7,
       profile_version=?8, prompt_snapshot_hash=?9, last_sync_at=?10,
       failure_stage=?11, failure_reason=?12, resume_stage=?13, resume_point=?14,
       remaining_steps_json=?15, retryable=?16, version=version+1, updated_at=?10
       WHERE user_id=?17 AND campaign_id=?18`
    ).bind(nextStatus, validationPassed ? 1 : 0, artifactVersion, input.contentHash,
      requirementVersion, draftVersion, validationVersion, profileVersion, promptHash, now,
      validationPassed ? null : "validation", validationPassed ? null : errors.join(" · ").slice(0, 1000),
      validationPassed ? "approval" : "local_source", validationPassed ? "사용자 승인" : "필수 검증 오류 수정 후 다시 동기화",
      JSON.stringify(validationPassed ? ["상세 검증 확인", "사용자 승인", "스마트에디터 수동 인계", "발행 결과 등록"] : errors),
      validationPassed ? 1 : 0, actor.userId, id, nextOperationStatus),
  ]);
  const saved = await requireCampaign(env, actor.userId, id);
  await insertAudit(env, actor, saved, "artifacts_synced", validationPassed ? "success" : "waiting", campaign.status, nextStatus,
    validationPassed ? "산출물 동기화와 검증 통과를 확인했습니다." : "산출물은 저장했지만 필수 검증 오류가 남아 있습니다.",
    { artifact_version: artifactVersion, content_hash: input.contentHash, validation_errors: errors });
  return jsonResponse({ ...campaignFromRow(saved), object_keys: objectKeys, reused: false }, { status: 201 });
}

async function readArtifactJson(env: NBlogEnv, key: string | undefined): Promise<Record<string, unknown> | null> {
  if (!key) return null;
  const object = await env.R2.get(key);
  if (!object) return null;
  if (object.size > 8 * 1024 * 1024) throw new NBlogError(413, "artifact_too_large", "저장된 JSON 산출물이 읽기 한도를 초과했습니다.");
  try { return objectValue(JSON.parse(await object.text()), "저장된 산출물"); }
  catch (error) {
    if (error instanceof NBlogError) throw error;
    throw new NBlogError(500, "artifact_invalid", "저장된 JSON 산출물을 읽을 수 없습니다.");
  }
}

async function readArtifactText(env: NBlogEnv, key: string | undefined, maxBytes = 4 * 1024 * 1024): Promise<string | null> {
  if (!key) return null;
  const object = await env.R2.get(key);
  if (!object) return null;
  if (object.size > maxBytes) throw new NBlogError(413, "artifact_too_large", "저장된 텍스트 산출물이 읽기 한도를 초과했습니다.");
  return object.text();
}

async function artifactBundle(env: NBlogEnv, userId: string, id: string) {
  const version = await latestArtifact(env, userId, id);
  if (!version) return { version: null, keys: {} as Record<string, string> };
  return { version, keys: parseJson<Record<string, string>>(version.object_keys_json, {}) };
}

async function getCampaignDetail(env: NBlogEnv, actor: NBlogActor, id: string): Promise<Response> {
  const campaign = await requireCampaign(env, actor.userId, id);
  const { version, keys } = await artifactBundle(env, actor.userId, id);
  return jsonResponse({ ...campaignFromRow(campaign), artifact: version ? { ...version, object_keys: keys } : null });
}

async function getValidation(env: NBlogEnv, actor: NBlogActor, id: string): Promise<Response> {
  await requireCampaign(env, actor.userId, id);
  const { version, keys } = await artifactBundle(env, actor.userId, id);
  if (!version) throw new NBlogError(404, "validation_missing", "검증 산출물이 없습니다. 로컬에서 nblog run 후 sync를 실행하세요.", { required_command: `nblog sync output/${id}` });
  const validation = await readArtifactJson(env, keys.validation);
  if (!validation) throw new NBlogError(404, "validation_object_missing", "검증 객체가 R2에 없습니다. 산출물을 다시 동기화하세요.");
  return jsonResponse({ ...validation, artifact_version: version.artifact_version });
}

async function getPreview(env: NBlogEnv, actor: NBlogActor, id: string): Promise<Response> {
  await requireCampaign(env, actor.userId, id);
  const { keys } = await artifactBundle(env, actor.userId, id);
  if (!keys.preview_html) throw new NBlogError(404, "preview_missing", "미리보기 산출물이 없습니다.");
  const object = await env.R2.get(keys.preview_html);
  if (!object || !object.body) throw new NBlogError(404, "preview_object_missing", "미리보기 객체가 R2에 없습니다.");
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "content-security-policy": "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

async function approveCampaign(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>): Promise<Response> {
  const campaign = await requireCampaign(env, actor.userId, id);
  if (campaign.generation_status === "awaiting_content_review") {
    throw new NBlogError(409, "content_confirmation_required", "생성된 글을 먼저 읽고 ‘글 확인’ 버튼을 눌러주세요.", { retryable: false });
  }
  assertOptimisticVersion(campaign, body);
  if (!campaign.validation_passed) throw new NBlogError(409, "validation_required", "필수 검증을 통과한 캠페인만 승인할 수 있습니다.");
  if (campaign.status !== "approval") throw new NBlogError(409, "invalid_state", "승인 대기 상태의 캠페인만 승인할 수 있습니다.", { current_status: campaign.status });
  if (body.confirmed !== true) throw new NBlogError(400, "confirmation_required", "검증 결과를 확인했다는 명시적 동의가 필요합니다.");
  const now = nowIso();
  const scheduledAt = typeof body.scheduled_at === "string" && body.scheduled_at ? new Date(body.scheduled_at).toISOString() : null;
  const approvalResults = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO nblog_approvals
       (id, user_id, campaign_id, artifact_version, requirement_version, draft_version,
        validation_version, profile_version, approved_by, approved_at, confirmation_json)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
       FROM nblog_campaigns WHERE user_id=?12 AND campaign_id=?13 AND version=?14`
    ).bind(crypto.randomUUID(), actor.userId, id, campaign.artifact_version, campaign.requirement_version,
      campaign.draft_version, campaign.validation_version, campaign.profile_version, actor.label, now,
      JSON.stringify({ confirmed: true, scheduled_at: scheduledAt }), actor.userId, id, campaign.version),
    env.DB.prepare(
      `UPDATE nblog_campaigns SET status='scheduled', operation_status='approved_for_handoff', approved_at=?1, approved_by=?2,
       scheduled_at=?3, resume_stage='handoff', resume_point='스마트에디터 수동 인계',
       remaining_steps_json=?4, last_checkpoint_at=?1, version=version+1, updated_at=?1
       WHERE user_id=?5 AND campaign_id=?6 AND version=?7`
    ).bind(now, actor.label, scheduledAt, JSON.stringify(["스마트에디터 열기", "콘텐츠와 미디어 수동 입력", "최종 검토", "발행 결과 등록"]), actor.userId, id, campaign.version),
  ]);
  if (!approvalResults[1].meta.changes) {
    throw new NBlogError(409, "campaign_conflict", "The campaign changed before approval was committed. Reload and review the latest version.", { retryable: false });
  }
  const saved = await requireCampaign(env, actor.userId, id);
  await insertAudit(env, actor, saved, "campaign_approved", "success", campaign.status, saved.status,
    "검증 통과 산출물을 내부 예약 상태로 승인했습니다. 네이버 예약 발행 완료를 뜻하지 않습니다.", { scheduled_at: scheduledAt });
  return jsonResponse(campaignFromRow(saved));
}

async function retryCampaign(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>): Promise<Response> {
  const campaign = await requireCampaign(env, actor.userId, id);
  assertOptimisticVersion(campaign, body);
  if (campaign.status !== "failed") throw new NBlogError(409, "invalid_state", "실패 상태의 캠페인만 재시도할 수 있습니다.", { current_status: campaign.status });
  if (!campaign.retryable) throw new NBlogError(409, "retry_not_allowed", "이 실패는 로컬 입력을 수정하고 산출물을 다시 동기화해야 합니다.");
  if (campaign.retry_count >= campaign.retry_limit) throw new NBlogError(409, "retry_limit_reached", "재시도 한도에 도달했습니다.");
  if (!env.NBLOG_WORKFLOW) throw new NBlogError(503, "workflow_unconfigured", "NBlog Workflow 바인딩이 구성되지 않았습니다.", { retryable: true, resume_point: campaign.resume_point });
  const attempt = campaign.retry_count + 1;
  const suffix = (campaign.artifact_content_hash || "no-artifact").replace(/[^a-z0-9]/gi, "").slice(-12);
  const instanceId = `${safeFileName(id).slice(0, 50)}-retry-${attempt}-${suffix}`;
  let instance: WorkflowInstance;
  try {
    instance = await env.NBLOG_WORKFLOW.create({ id: instanceId, params: { user_id: actor.userId, campaign_id: id, requested_by: actor.label, reason: "retry" } });
  } catch {
    instance = await env.NBLOG_WORKFLOW.get(instanceId);
    await instance.restart();
  }
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE nblog_campaigns SET status='analysis', operation_status='syncing', retry_count=?1, workflow_instance_id=?2,
     failure_stage=NULL, failure_reason=NULL, resume_stage='workflow', resume_point='산출물 무결성 확인',
     last_checkpoint_at=?3, version=version+1, updated_at=?3
     WHERE user_id=?4 AND campaign_id=?5 AND version=?6`
  ).bind(attempt, instance.id, now, actor.userId, id, campaign.version).run();
  const saved = await requireCampaign(env, actor.userId, id);
  await insertAudit(env, actor, saved, "retry_requested", "waiting", campaign.status, saved.status, "Workflow가 저장된 체크포인트부터 재검사를 시작했습니다.", { workflow_instance_id: instance.id, attempt });
  return jsonResponse({ ...campaignFromRow(saved), workflow: { id: instance.id, status: await instance.status() } }, { status: 202 });
}

export interface NBlogAccountConnections {
  // Planning Harness 서버가 아는 진실: 네이버 OAuth identity 연결 여부.
  naver_login: { linked: boolean; display_name: string | null; linked_at: string | null };
  // 브라우저 내부의 네이버 로그인·블로그 선택 상태는 서버가 알 수 없다(확장 프로그램이 클라이언트에서 확인).
  browser_session: { source: "browser_extension"; server_verifiable: false; note: string };
}

// 네이버 "로그인 연결"(서버측 identity)과 "브라우저 세션"(확장 프로그램 확인)을 명시적으로 분리해 돌려준다.
// #194 Phase 2: 발행 화면이 두 상태를 별도로 표시하기 위한 계약.
export async function nblogAccountConnections(env: NBlogEnv, userId: string): Promise<NBlogAccountConnections> {
  const naver = await env.DB.prepare(
    "SELECT display_name, created_at FROM user_identities WHERE user_id=?1 AND provider='naver' LIMIT 1"
  ).bind(userId).first<{ display_name: string | null; created_at: string | null }>();
  return {
    naver_login: {
      linked: !!naver,
      display_name: naver?.display_name ?? null,
      linked_at: naver?.created_at ?? null,
    },
    browser_session: {
      source: "browser_extension",
      server_verifiable: false,
      note: "네이버 브라우저 로그인·블로그 선택 상태는 서버가 알 수 없습니다. 확장 프로그램이 사용자 브라우저에서 확인합니다.",
    },
  };
}

async function getHandoff(env: NBlogEnv, actor: NBlogActor, id: string): Promise<Response> {
  const campaign = await requireCampaign(env, actor.userId, id);
  const { version, keys } = await artifactBundle(env, actor.userId, id);
  const [draft, validation, manifest, mediaRows, checkpoints] = await Promise.all([
    readArtifactJson(env, keys.draft),
    readArtifactJson(env, keys.validation),
    readArtifactJson(env, keys.manifest),
    env.DB.prepare("SELECT * FROM nblog_media_assets WHERE user_id=?1 AND campaign_id=?2 ORDER BY sort_order").bind(actor.userId, id).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM nblog_handoff_checkpoints WHERE user_id=?1 AND campaign_id=?2 ORDER BY created_at DESC LIMIT 20").bind(actor.userId, id).all<Record<string, unknown>>(),
  ]);
  const draftMarkdown = draft ? await readArtifactText(env, keys.draft_markdown) : null;
  const accountConnections = await nblogAccountConnections(env, actor.userId);
  const media = (mediaRows.results || []).map((row, index) => {
    const type = String(row.type || "");
    const order = Number.isSafeInteger(Number(row.sort_order)) && Number(row.sort_order) > 0
      ? Number(row.sort_order)
      : index + 1;
    const included = row.included === 1;
    const status = String(row.status || "");
    return {
      media_id: row.media_id,
      type,
      original_name: row.original_name,
      content_type: row.content_type,
      size: row.size,
      checksum: row.checksum,
      width: row.width,
      height: row.height,
      duration: row.duration,
      order,
      marker: `[${type === "video" ? "VIDEO" : "IMAGE"}:${String(order).padStart(3, "0")}]`,
      included,
      ready: included && status === "ready",
      is_cover: row.is_cover === 1,
      analysis_summary: row.analysis_summary,
      warnings: parseJson<string[]>(String(row.warnings_json || "[]"), []),
      status,
      content_url: row.object_key ? `/api/nblog/campaigns/${encodeURIComponent(id)}/media/${encodeURIComponent(String(row.media_id))}` : null,
    };
  });
  return jsonResponse({
    campaign: campaignFromRow(campaign),
    artifact_version: version?.artifact_version || 0,
    draft: draft ? { ...draft, markdown: draftMarkdown || String(draft.markdown || "") } : null,
    validation,
    manifest,
    media,
    account_connections: accountConnections,
    handoff: {
      resume_stage: campaign.resume_stage,
      resume_point: campaign.resume_point,
      remaining_steps: parseJson<string[]>(campaign.remaining_steps_json, []),
      last_checkpoint_at: campaign.last_checkpoint_at,
      checkpoints: (checkpoints.results || []).map((row) => ({
        id: row.id,
        resume_stage: row.resume_stage,
        resume_point: row.resume_point,
        completed_steps: parseJson<string[]>(String(row.completed_steps_json || "[]"), []),
        remaining_steps: parseJson<string[]>(String(row.remaining_steps_json || "[]"), []),
        artifact_version: row.artifact_version,
        note: row.note,
        created_by: row.created_by,
        created_at: row.created_at,
      })),
    },
    smart_editor: {
      url: "https://blog.naver.com/GoBlogWrite.naver",
      blog_url: campaign.blog_url,
      category: campaign.category,
      stores_credentials: false,
      checklist: ["광고 문구 또는 스폰서 배너를 최상단에 입력", "이미지를 계획 순서대로 업로드", "영상은 별도 업로드하고 처리 완료 확인", "본문·태그·지도 입력", "최종 미리보기 확인 후 사용자가 직접 발행"],
    },
    prerequisites: version ? [] : [`node ./src/cli.js run source/<campaign>`, `node ./src/cli.js sync output/<campaign>`],
  });
}

function handoffSessionView(row: HandoffSessionRow) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    artifact_version: row.artifact_version,
    requirement_version: row.requirement_version,
    draft_version: row.draft_version,
    validation_version: row.validation_version,
    profile_version: row.profile_version,
    contract_version: row.contract_version,
    status: row.status,
    allowed_actions: parseJson<string[]>(row.allowed_actions_json, []),
    expires_at: row.expires_at,
    connected_at: row.used_at,
    created_at: row.created_at,
  };
}

async function issueHandoffSession(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>): Promise<Response> {
  if (env.NBLOG_HANDOFF_ENABLED === "false") {
    throw new NBlogError(503, "handoff_temporarily_disabled", "Browser handoff is temporarily disabled by the operations safety switch.", { retryable: true });
  }
  if (actor.viaToken) throw new NBlogError(403, "interactive_login_required", "Browser handoff sessions must be created from the signed-in operations UI.");
  const campaign = await requireCampaign(env, actor.userId, id);
  assertOptimisticVersion(campaign, body);
  const reissuableStatuses = new Set(["approved_for_handoff", "handoff_ready", "failed"]);
  if (!campaign.validation_passed || !campaign.approved_at || !reissuableStatuses.has(campaign.operation_status)) {
    throw new NBlogError(409, "handoff_gate_blocked", "Validation and explicit approval are required before browser handoff.", {
      operation_status: campaign.operation_status,
      validation_passed: campaign.validation_passed === 1,
      approved: !!campaign.approved_at,
      retryable: false,
    });
  }
  const latest = await latestArtifact(env, actor.userId, id);
  if (!latest || latest.artifact_version !== campaign.artifact_version) {
    throw new NBlogError(409, "artifact_version_conflict", "The approved artifact version is not the latest synchronized version.", { retryable: false });
  }
  // Claim credentials are deliberately fixed to a ten-minute lifetime. A caller
  // cannot extend this window by supplying expires_in_seconds.
  const ttlSeconds = 600;
  const sessionId = crypto.randomUUID();
  const claimToken = `nbh_${randomToken(36)}`;
  const now = nowIso();
  const expiresAt = new Date(Date.parse(now) + ttlSeconds * 1000).toISOString();
  const allowedActions = ["claim", "read_bundle", "read_media", "write_checkpoint"];
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE nblog_handoff_sessions SET status='cancelled', cancelled_at=?1, updated_at=?1
       WHERE user_id=?2 AND campaign_id=?3 AND status NOT IN ('published', 'expired', 'cancelled')`
    ).bind(now, actor.userId, id),
    env.DB.prepare(
      `INSERT INTO nblog_handoff_sessions
       (id, token_hash, user_id, campaign_id, artifact_version, requirement_version,
        draft_version, validation_version, profile_version, contract_version, status,
        allowed_actions_json, expires_at, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'handoff_ready', ?11, ?12, ?13, ?14, ?14)`
    ).bind(sessionId, await sha256(claimToken), actor.userId, id, campaign.artifact_version,
      campaign.requirement_version, campaign.draft_version, campaign.validation_version,
      campaign.profile_version, NBLOG_CONTRACT_VERSION, JSON.stringify(allowedActions), expiresAt, actor.label, now),
    env.DB.prepare(
      `UPDATE nblog_campaigns SET operation_status='handoff_ready', resume_stage='handoff',
       resume_point='Claim browser handoff session', last_checkpoint_at=?1,
       version=version+1, updated_at=?1 WHERE user_id=?2 AND campaign_id=?3 AND version=?4`
    ).bind(now, actor.userId, id, campaign.version),
  ]);
  const saved = await requireCampaign(env, actor.userId, id);
  await insertAudit(env, actor, saved, "handoff_session_created", "waiting", campaign.operation_status, "handoff_ready",
    "A short-lived one-time browser handoff claim was created.", { session_id: sessionId, artifact_version: campaign.artifact_version, expires_at: expiresAt });
  return jsonResponse({
    contract_version: NBLOG_CONTRACT_VERSION,
    handoff_session: {
      id: sessionId,
      campaign_id: id,
      artifact_version: campaign.artifact_version,
      status: "handoff_ready",
      expires_at: expiresAt,
      allowed_actions: allowedActions,
    },
    claim_token: claimToken,
    claim_path: `/api/nblog/handoff-sessions/${encodeURIComponent(sessionId)}/claim`,
    warning: "The claim token is displayed once and is rotated when claimed.",
  }, { status: 201 });
}

async function requireHandoffSessionToken(
  request: Request,
  env: NBlogEnv,
  sessionId: string,
  action: HandoffSessionAction,
): Promise<HandoffSessionRow> {
  const claim = action === "claim";
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(\S+)$/i)?.[1] || "";
  const expectedPrefix = claim ? "nbh_" : "nbhs_";
  if (!token.startsWith(expectedPrefix)) {
    throw new NBlogError(401, claim ? "handoff_claim_token_required" : "handoff_session_token_required", "A valid handoff bearer token is required.", { retryable: false });
  }
  const row = await env.DB.prepare("SELECT * FROM nblog_handoff_sessions WHERE id=?1 AND token_hash=?2")
    .bind(sessionId, await sha256(token)).first<HandoffSessionRow>();
  if (!row || row.cancelled_at) throw new NBlogError(401, "handoff_token_invalid", "The handoff token is invalid or no longer active.", { retryable: false });
  if (Date.parse(row.expires_at) <= Date.now()) {
    await env.DB.prepare("UPDATE nblog_handoff_sessions SET status='expired', updated_at=?1 WHERE id=?2")
      .bind(nowIso(), row.id).run();
    throw new NBlogError(410, "handoff_session_expired", "The handoff session has expired. Create a new session from the operations UI.", { retryable: false });
  }
  if (claim && row.used_at) throw new NBlogError(409, "handoff_token_already_claimed", "The one-time handoff token has already been claimed.", { retryable: false });
  if (!claim && !row.used_at) throw new NBlogError(409, "handoff_session_not_claimed", "Claim the handoff session before using it.", { retryable: false });
  const allowedActions = parseJson<string[]>(row.allowed_actions_json, []);
  if (!allowedActions.includes(action)) {
    throw new NBlogError(403, "handoff_action_forbidden", "The handoff token does not allow this action.", {
      requested_action: action,
      allowed_actions: allowedActions,
      retryable: false,
    });
  }
  return row;
}

function optionalBundleText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function canonicalTagList(value: unknown): string[] {
  const source: unknown[] = [];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const tagGroups = value as Record<string, unknown>;
    source.push(tagGroups.final, tagGroups.fixed);
  } else {
    source.push(value);
  }
  const tags: string[] = [];
  const seen = new Set<string>();
  const append = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(append);
      return;
    }
    if (typeof item !== "string") return;
    for (const part of item.split(/[\s,]+/u)) {
      const tag = part.trim().replace(/^#+/, "");
      if (!tag) continue;
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
  };
  source.forEach(append);
  return tags;
}

function canonicalMarkdownBody(markdown: string): { body: string; trailingTags: string[] } {
  const lines = markdown.split(/\r?\n/);
  let lastContent = lines.length - 1;
  while (lastContent >= 0 && !lines[lastContent].trim()) lastContent -= 1;
  if (lastContent < 0) return { body: "", trailingTags: [] };
  const candidate = lines[lastContent].trim();
  if (!/^(?:#[^\s#]+)(?:[ \t]+#[^\s#]+)*$/u.test(candidate)) {
    return { body: markdown, trailingTags: [] };
  }
  return {
    body: lines.slice(0, lastContent).join("\n").trimEnd(),
    trailingTags: canonicalTagList(candidate),
  };
}

async function handoffSessionBundle(env: NBlogEnv, row: HandoffSessionRow): Promise<Record<string, unknown>> {
  const actor: NBlogActor = { userId: row.user_id, label: "browser-handoff", viaToken: true };
  const response = await getHandoff(env, actor, row.campaign_id);
  const payload = await response.json() as Record<string, unknown>;
  const campaign = objectValue(payload.campaign, "campaign");
  const draft = payload.draft && typeof payload.draft === "object" ? payload.draft as Record<string, unknown> : {};
  const validation = payload.validation && typeof payload.validation === "object" ? payload.validation as Record<string, unknown> : {};
  const media = Array.isArray(payload.media) ? payload.media as Array<Record<string, unknown>> : [];
  const titleCandidates = Array.isArray(draft.title_candidates) ? draft.title_candidates : [];
  const markdown = typeof draft.markdown === "string" ? draft.markdown : "";
  const canonicalMarkdown = canonicalMarkdownBody(markdown);
  const explicitTags = canonicalTagList(draft.tags);
  const draftPlace = draft.place && typeof draft.place === "object" && !Array.isArray(draft.place)
    ? draft.place as Record<string, unknown>
    : {};
  const place = {
    campaign_name: optionalBundleText(campaign.campaign_name),
    address: optionalBundleText(campaign.address) ?? optionalBundleText(draft.address) ?? optionalBundleText(draftPlace.address),
    place_url: optionalBundleText(campaign.place_url),
    automatic_selection_allowed: false,
    user_selection_required: true,
  };
  const content = {
    selected_title: optionalBundleText(draft.selected_title)
      ?? optionalBundleText(draft.title)
      ?? optionalBundleText(titleCandidates[0])
      ?? optionalBundleText(campaign.campaign_name),
    markdown,
    body: canonicalMarkdown.body,
    body_blocks: Array.isArray(draft.body_blocks) ? draft.body_blocks : [],
    tags: explicitTags.length ? explicitTags : canonicalMarkdown.trailingTags,
    sponsor_disclosure: draft.sponsor_disclosure || null,
    place_url: campaign.place_url || null,
    place,
  };
  const bundle = {
    schema_version: NBLOG_CONTRACT_VERSION,
    handoff_session_id: row.id,
    campaign_id: row.campaign_id,
    visit_date: campaign.visit_date,
    target: { blog_url: campaign.blog_url || null, category: campaign.category || null },
    versions: {
      artifact: row.artifact_version,
      requirements: row.requirement_version,
      draft: row.draft_version,
      validation: row.validation_version,
      profile: row.profile_version,
    },
    campaign_version: campaign.version,
    campaign_updated_at: campaign.updated_at,
    content,
    media_plan: media.map((item) => ({
      media_id: item.media_id,
      type: item.type,
      original_name: item.original_name,
      content_type: item.content_type,
      size: item.size,
      checksum: item.checksum,
      order: item.order,
      marker: item.marker,
      included: item.included,
      ready: item.ready,
      is_cover: item.is_cover,
      status: item.status,
      content_url: item.content_url
        ? `/api/nblog/handoff-sessions/${encodeURIComponent(row.id)}/media/${encodeURIComponent(String(item.media_id))}`
        : null,
    })),
    validation: { status: validation.status || null, approval_allowed: validation.approval_allowed === true },
    unconfirmed_items: Array.isArray(draft.unconfirmed_items) ? draft.unconfirmed_items : [],
    expires_at: row.expires_at,
  };
  return { ...bundle, bundle_checksum: `sha256:${await sha256(stableStringify(bundle))}` };
}

async function claimHandoffSession(request: Request, env: NBlogEnv, sessionId: string): Promise<Response> {
  const row = await requireHandoffSessionToken(request, env, sessionId, "claim");
  const sessionToken = `nbhs_${randomToken(36)}`;
  const sessionTokenHash = await sha256(sessionToken);
  const now = nowIso();
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE nblog_handoff_sessions SET token_hash=?1, used_at=?2, status='browser_connected',
       allowed_actions_json=?3, updated_at=?2
       WHERE id=?4 AND token_hash=?5 AND used_at IS NULL
         AND status='handoff_ready' AND cancelled_at IS NULL AND expires_at>?6`
    ).bind(sessionTokenHash, now, JSON.stringify(["read_bundle", "read_media", "write_checkpoint"]), row.id, row.token_hash, now),
    env.DB.prepare(
      `UPDATE nblog_campaigns SET operation_status='browser_connected', resume_stage='browser',
       resume_point='Browser helper connected', last_checkpoint_at=?1, version=version+1,
       updated_at=?1 WHERE user_id=?2 AND campaign_id=?3 AND artifact_version=?4
       AND EXISTS (
         SELECT 1 FROM nblog_handoff_sessions
          WHERE id=?5 AND token_hash=?6 AND used_at=?1 AND status='browser_connected'
       )`
    ).bind(now, row.user_id, row.campaign_id, row.artifact_version, row.id, sessionTokenHash),
  ]);
  if (!result[0].meta.changes) {
    const current = await requireHandoffSessionToken(request, env, sessionId, "claim");
    throw new NBlogError(409, "handoff_session_not_claimable", "The handoff session is no longer ready to be claimed.", {
      status: current.status,
      retryable: false,
    });
  }
  const claimed = await env.DB.prepare("SELECT * FROM nblog_handoff_sessions WHERE id=?1").bind(row.id).first<HandoffSessionRow>();
  if (!claimed) throw new NBlogError(500, "handoff_session_missing", "The claimed handoff session could not be loaded.");
  return jsonResponse({
    contract_version: NBLOG_CONTRACT_VERSION,
    handoff_session: handoffSessionView(claimed),
    session_token: sessionToken,
    bundle: await handoffSessionBundle(env, claimed),
    safety: {
      stores_naver_credentials: false,
      automatic_input_allowed: ["title", "body", "tags"],
      manual_user_actions_required: ["login", "captcha", "media", "place", "preview", "publish"],
      final_publish_requires_user_action: true,
    },
  });
}

async function getHandoffSession(request: Request, env: NBlogEnv, sessionId: string): Promise<Response> {
  const row = await requireHandoffSessionToken(request, env, sessionId, "read_bundle");
  return jsonResponse({ contract_version: NBLOG_CONTRACT_VERSION, handoff_session: handoffSessionView(row), bundle: await handoffSessionBundle(env, row) });
}

async function saveHandoffSessionCheckpoint(request: Request, env: NBlogEnv, sessionId: string, body: Record<string, unknown>): Promise<Response> {
  const row = await requireHandoffSessionToken(request, env, sessionId, "write_checkpoint");
  const nextStatus = stringField(body.status, "status", 80);
  if (!BROWSER_CHECKPOINT_STATUSES.has(nextStatus)) {
    throw new NBlogError(400, "invalid_handoff_status", "The requested handoff status is not allowed for a browser checkpoint.", { retryable: false });
  }
  if (nextStatus !== row.status && !OPERATION_STATUS_TRANSITIONS[row.status]?.has(nextStatus)) {
    throw new NBlogError(409, "invalid_status_transition", "The handoff status transition is not allowed.", { from: row.status, to: nextStatus, retryable: false });
  }
  const actor: NBlogActor = { userId: row.user_id, label: "browser-handoff", viaToken: true };
  const checkpointResponse = await saveCheckpoint(env, actor, row.campaign_id, body);
  const now = nowIso();
  await env.DB.prepare("UPDATE nblog_handoff_sessions SET status=?1, updated_at=?2 WHERE id=?3")
    .bind(nextStatus, now, row.id).run();
  return jsonResponse({
    contract_version: NBLOG_CONTRACT_VERSION,
    handoff_session: { ...handoffSessionView(row), status: nextStatus, updated_at: now },
    checkpoint: await checkpointResponse.json(),
  }, { status: 201 });
}

async function saveCheckpoint(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>): Promise<Response> {
  const campaign = await requireCampaign(env, actor.userId, id);
  assertOptimisticVersion(campaign, body);
  const resumeStage = stringField(body.resume_stage, "resume_stage", 80);
  const resumePoint = stringField(body.resume_point, "resume_point", 200);
  const completed = Array.isArray(body.completed_steps) ? body.completed_steps.map(String).slice(0, 30) : [];
  const remaining = Array.isArray(body.remaining_steps) ? body.remaining_steps.map(String).slice(0, 30) : [];
  const note = optionalString(body.note, "note", 1000);
  assertNoSensitiveText(resumePoint, "resume_point");
  if (note) assertNoSensitiveText(note, "note");
  completed.forEach((step, index) => assertNoSensitiveText(step, `completed_steps[${index}]`));
  remaining.forEach((step, index) => assertNoSensitiveText(step, `remaining_steps[${index}]`));
  const requestedOperationStatus = typeof body.status === "string" && HANDOFF_SESSION_STATUSES.has(body.status) ? body.status : null;
  const now = nowIso();
  const checkpointId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO nblog_handoff_checkpoints
       (id, user_id, campaign_id, resume_stage, resume_point, completed_steps_json,
        remaining_steps_json, artifact_version, note, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
    ).bind(checkpointId, actor.userId, id, resumeStage, resumePoint, JSON.stringify(completed), JSON.stringify(remaining), campaign.artifact_version, note, actor.label, now),
    env.DB.prepare(
      `UPDATE nblog_campaigns SET resume_stage=?1, resume_point=?2, remaining_steps_json=?3,
       last_checkpoint_at=?4, operation_status=COALESCE(?8, operation_status),
       version=version+1, updated_at=?4 WHERE user_id=?5 AND campaign_id=?6 AND version=?7`
    ).bind(resumeStage, resumePoint, JSON.stringify(remaining), now, actor.userId, id, campaign.version, requestedOperationStatus),
  ]);
  const saved = await requireCampaign(env, actor.userId, id);
  await insertAudit(env, actor, saved, "handoff_checkpoint_saved", "waiting", campaign.status, saved.status, "A manual handoff checkpoint was saved.", { checkpoint_id: checkpointId, completed_steps: completed });
  return jsonResponse({ checkpoint_id: checkpointId, campaign: campaignFromRow(saved) }, { status: 201 });
}

function publicationInput(body: Record<string, unknown>) {
  const publishedUrl = stringField(body.published_url, "published_url", 500);
  const canonicalPublishedUrl = canonicalPublishedNaverPostUrl(publishedUrl);
  if (!canonicalPublishedUrl) throw new NBlogError(400, "invalid_published_url", "네이버 블로그의 실제 게시물 URL을 입력하세요. 블로그 홈 주소는 사용할 수 없습니다.");
  const publishedAtValue = stringField(body.published_at, "published_at", 40);
  const parsedAt = new Date(publishedAtValue);
  if (Number.isNaN(parsedAt.getTime())) throw new NBlogError(400, "invalid_published_at", "발행 시각이 올바르지 않습니다.");
  const checklist = objectValue(body.checklist, "checklist");
  const requiredChecks = ["title", "sponsor_disclosure", "map", "media", "tags"];
  const missing = requiredChecks.filter((key) => checklist[key] !== true);
  if (missing.length) throw new NBlogError(400, "publication_checklist_required", "최종 발행 확인 항목을 모두 완료해야 합니다.", { missing });
  const confirmedBy = optionalString(body.confirmed_by, "confirmed_by", 120);
  const reason = stringField(body.reason, "reason", 500, false) || "사용자 발행 결과 등록";
  if (confirmedBy) assertNoSensitiveText(confirmedBy, "confirmed_by");
  assertNoSensitiveText(reason, "reason");
  return { publishedUrl: canonicalPublishedUrl, publishedAt: parsedAt.toISOString(), confirmedBy, reason };
}

async function savePublication(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>, correction: boolean): Promise<Response> {
  const campaign = await requireCampaign(env, actor.userId, id);
  assertOptimisticVersion(campaign, body);
  if (!campaign.validation_passed || !campaign.approved_at) throw new NBlogError(409, "publication_gate_blocked", "검증 통과와 사용자 승인이 모두 있어야 발행 완료로 기록할 수 있습니다.");
  if (!correction && campaign.status === "published") throw new NBlogError(409, "already_published", "이미 발행 완료된 캠페인입니다. 수정 API를 사용하세요.");
  const input = publicationInput(body);
  const publicationRows = await env.DB.prepare(
    `SELECT campaign_id, published_url FROM nblog_publication_history
       WHERE user_id=?1 AND campaign_id<>?2
     UNION ALL
     SELECT campaign_id, published_url FROM nblog_campaigns
       WHERE user_id=?1 AND campaign_id<>?2 AND published_url IS NOT NULL`
  ).bind(actor.userId, id).all<{ campaign_id: string; published_url: string }>();
  const duplicate = publicationRows.results.find((row) =>
    canonicalPublishedNaverPostUrl(row.published_url) === input.publishedUrl
  );
  if (duplicate) throw new NBlogError(409, "duplicate_published_url", "이 게시물 URL은 다른 캠페인에 이미 등록되어 있습니다.", { campaign_id: duplicate.campaign_id });
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO nblog_publication_history
       (id, user_id, campaign_id, published_url, published_at, confirmed_by,
        requirement_version, draft_version, validation_version, profile_version, reason, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
    ).bind(crypto.randomUUID(), actor.userId, id, input.publishedUrl, input.publishedAt, input.confirmedBy || actor.label,
      campaign.requirement_version, campaign.draft_version, campaign.validation_version, campaign.profile_version, input.reason, now),
    env.DB.prepare(
      `UPDATE nblog_campaigns SET status='published', operation_status='published', published_url=?1, published_at=?2,
       confirmed_by=?3, resume_stage='complete', resume_point='발행 완료', remaining_steps_json='[]',
       last_checkpoint_at=?4, version=version+1, updated_at=?4 WHERE user_id=?5 AND campaign_id=?6 AND version=?7`
    ).bind(input.publishedUrl, input.publishedAt, input.confirmedBy || actor.label, now, actor.userId, id, campaign.version),
  ]);
  const saved = await requireCampaign(env, actor.userId, id);
  await insertAudit(env, actor, saved, correction ? "publication_corrected" : "publication_recorded", "success", campaign.status, saved.status,
    input.reason, { published_url: input.publishedUrl, published_at: input.publishedAt, previous_url: campaign.published_url, previous_at: campaign.published_at });
  return jsonResponse(campaignFromRow(saved), { status: correction ? 200 : 201 });
}

function mediaType(contentType: string, originalName: string): "image" | "video" {
  const normalized = contentType.toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  const extension = originalName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || "";
  if ([".jpg", ".jpeg", ".png", ".webp", ".heic"].includes(extension)) return "image";
  if ([".mp4", ".mov", ".webm"].includes(extension)) return "video";
  throw new NBlogError(400, "unsupported_media", `${originalName} 파일 형식은 지원하지 않습니다.`);
}

async function initMediaUploads(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>, request: Request): Promise<Response> {
  await requireCampaign(env, actor.userId, id);
  if (!Array.isArray(body.files) || !body.files.length || body.files.length > 100) throw new NBlogError(400, "invalid_files", "1~100개의 업로드 파일 정보가 필요합니다.");
  const maximumBytes = Math.max(1, Number(env.NBLOG_MEDIA_MAX_BYTES || 104_857_600));
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const userPrefix = (await sha256(actor.userId)).slice(0, 16);
  const uploads = [];
  for (const [index, raw] of body.files.entries()) {
    const file = objectValue(raw, `files[${index}]`);
    const originalName = stringField(file.original_name, `files[${index}].original_name`, 240);
    const contentType = stringField(file.content_type, `files[${index}].content_type`, 120, false) || "application/octet-stream";
    const type = mediaType(contentType, originalName);
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size <= 0) throw new NBlogError(400, "invalid_file_size", `${originalName} 파일 크기가 올바르지 않습니다.`);
    if (size > maximumBytes) throw new NBlogError(413, "media_too_large", `${originalName} 파일이 현재 업로드 한도를 초과했습니다. 로컬 처리 또는 multipart 경로를 사용하세요.`, { maximum_bytes: maximumBytes });
    const checksum = stringField(file.checksum, `files[${index}].checksum`, 80);
    if (!isSha256(checksum)) throw new NBlogError(400, "invalid_checksum", `${originalName} 체크섬이 올바르지 않습니다.`);
    // 영상 길이 — 대표 프레임을 어느 지점에서 뽑을지 정하는 데 쓴다 (#170, #171).
    // 클라이언트가 주지 않으면 null 로 두고, 프레임은 0초 한 장만 뽑는다.
    const rawDuration = Number(file.duration);
    const duration = type === "video" && Number.isFinite(rawDuration) && rawDuration > 0 && rawDuration <= 86_400 ? rawDuration : null;
    const mediaId = stringField(file.media_id || file.client_id || `${type}-${checksum.slice(7, 19)}`, `files[${index}].media_id`, 100).replace(/[^\p{L}\p{N}._-]/gu, "-");
    const order = Number.isSafeInteger(Number(file.order)) && Number(file.order) > 0 ? Number(file.order) : index + 1;
    const uploadId = crypto.randomUUID();
    const uploadSecret = `nbu_${randomToken()}`;
    const tokenHash = await sha256(uploadSecret);
    const objectKey = `nblog/${userPrefix}/${safeFileName(id)}/media/${safeFileName(mediaId)}-${safeFileName(originalName)}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO nblog_upload_sessions
         (upload_id, token_hash, user_id, campaign_id, media_id, object_key, content_type,
          expected_size, checksum, status, expires_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'initialized', ?10, ?11, ?11)`
      ).bind(uploadId, tokenHash, actor.userId, id, mediaId, objectKey, contentType, size, checksum, expiresAt, now),
      env.DB.prepare(
        `INSERT INTO nblog_media_assets
         (user_id, campaign_id, media_id, type, original_name, object_key, content_type, size,
          checksum, duration, sort_order, included, is_cover, status, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, 0, 'uploading', ?12)
         ON CONFLICT(user_id, campaign_id, media_id) DO UPDATE SET
          type=excluded.type, original_name=excluded.original_name, object_key=excluded.object_key,
          content_type=excluded.content_type, size=excluded.size, checksum=excluded.checksum,
          duration=excluded.duration, sort_order=excluded.sort_order, status='uploading', updated_at=excluded.updated_at`
      ).bind(actor.userId, id, mediaId, type, originalName, objectKey, contentType, size, checksum, duration, order, now),
    ]);
    const uploadUrl = new URL(`/api/nblog/uploads/${uploadId}`, request.url);
    uploads.push({
      client_id: file.client_id || null,
      media_id: mediaId,
      object_key: objectKey,
      upload_url: uploadUrl.toString(),
      method: "PUT",
      headers: { "Content-Type": contentType, "Authorization": `Bearer ${uploadSecret}` },
      expires_at: expiresAt,
    });
  }
  return jsonResponse({ uploads }, { status: 201 });
}

export async function handleNBlogUpload(request: Request, env: NBlogEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/nblog\/uploads\/([a-f0-9-]+)$/i);
  if (!match) return null;
  if (request.method !== "PUT") return jsonResponse({ error: { code: "method_not_allowed", message: "PUT 요청만 허용됩니다." } }, { status: 405, headers: { allow: "PUT" } });
  await enforceNBlogRateLimit(env.NBLOG_TOKEN_RATE_LIMITER, match[1], "upload-token");
  const token = (request.headers.get("authorization") || "").match(/^Bearer\s+(nbu_[A-Za-z0-9_-]{32,})$/i)?.[1] || "";
  if (!token) return jsonResponse({ error: { code: "upload_token_required", message: "업로드 토큰이 필요합니다." } }, { status: 401 });
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT * FROM nblog_upload_sessions WHERE upload_id=?1 AND token_hash=?2 LIMIT 1"
  ).bind(match[1], tokenHash).first<Record<string, unknown>>();
  if (!row) return jsonResponse({ error: { code: "invalid_upload_token", message: "업로드 토큰이 올바르지 않습니다." } }, { status: 401 });
  if (String(row.status) !== "initialized" && String(row.status) !== "uploading") return jsonResponse({ error: { code: "upload_already_used", message: "이미 완료되거나 사용할 수 없는 업로드입니다." } }, { status: 409 });
  if (Date.parse(String(row.expires_at)) <= Date.now()) {
    await env.DB.prepare("UPDATE nblog_upload_sessions SET status='expired', updated_at=?1 WHERE upload_id=?2").bind(nowIso(), match[1]).run();
    return jsonResponse({ error: { code: "upload_expired", message: "업로드 토큰이 만료되었습니다." } }, { status: 410 });
  }
  const expectedSize = Number(row.expected_size);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > expectedSize) return jsonResponse({ error: { code: "upload_too_large", message: "The upload exceeds the initialized size." } }, { status: 413 });
  if (contentLength && contentLength < expectedSize) return jsonResponse({ error: { code: "upload_size_mismatch", message: "업로드 크기가 초기화 정보와 일치하지 않습니다." } }, { status: 400 });
  if (!request.body) return jsonResponse({ error: { code: "upload_body_required", message: "업로드 본문이 필요합니다." } }, { status: 400 });
  const now = nowIso();
  await env.DB.prepare("UPDATE nblog_upload_sessions SET status='uploading', updated_at=?1 WHERE upload_id=?2").bind(now, match[1]).run();
  let uploadSizeError: NBlogError | null = null;
  try {
    let streamedBytes = 0;
    const boundedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        streamedBytes += chunk.byteLength;
        if (streamedBytes > expectedSize) {
          uploadSizeError = new NBlogError(413, "upload_too_large", "The upload exceeds the initialized size.", { retryable: false });
          controller.error(uploadSizeError);
          return;
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (streamedBytes !== expectedSize) {
          uploadSizeError = new NBlogError(400, "upload_size_mismatch", "The uploaded byte count does not match the initialized size.", { retryable: false });
          throw uploadSizeError;
        }
      },
    }));
    const fixedLength = new FixedLengthStream(expectedSize);
    const pump = boundedBody.pipeTo(fixedLength.writable);
    const [stored] = await Promise.all([env.R2.put(String(row.object_key), fixedLength.readable, {
      sha256: String(row.checksum).replace(/^sha256:/, ""),
      httpMetadata: { contentType: String(row.content_type) },
      customMetadata: { campaign_id: String(row.campaign_id), media_id: String(row.media_id), checksum: String(row.checksum) },
    }), pump]);
    if (!stored || stored.size !== expectedSize) {
      await env.R2.delete(String(row.object_key));
      throw new Error("stored size mismatch");
    }
    await env.DB.prepare("UPDATE nblog_upload_sessions SET status='uploaded', updated_at=?1 WHERE upload_id=?2").bind(nowIso(), match[1]).run();
    return jsonResponse({ upload_id: match[1], object_key: row.object_key, size: stored.size, checksum: row.checksum });
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare("UPDATE nblog_upload_sessions SET status='failed', updated_at=?1 WHERE upload_id=?2").bind(nowIso(), match[1]),
      env.DB.prepare("UPDATE nblog_media_assets SET status='failed', updated_at=?1 WHERE user_id=?2 AND campaign_id=?3 AND media_id=?4").bind(nowIso(), row.user_id, row.campaign_id, row.media_id),
    ]);
    if (uploadSizeError) throw uploadSizeError;
    if (error instanceof NBlogError) throw error;
    return jsonResponse({ error: { code: "upload_failed", message: "R2 업로드 또는 체크섬 검증에 실패했습니다." } }, { status: 502 });
  }
}

async function completeMediaUploads(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>): Promise<Response> {
  await requireCampaign(env, actor.userId, id);
  if (!Array.isArray(body.files) || !body.files.length) throw new NBlogError(400, "invalid_files", "완료할 파일 정보가 필요합니다.");
  const completed = [];
  for (const raw of body.files) {
    const file = objectValue(raw, "files[]");
    const objectKey = stringField(file.object_key, "object_key", 800);
    const session = await env.DB.prepare(
      "SELECT * FROM nblog_upload_sessions WHERE user_id=?1 AND campaign_id=?2 AND object_key=?3 ORDER BY created_at DESC LIMIT 1"
    ).bind(actor.userId, id, objectKey).first<Record<string, unknown>>();
    if (!session || !["uploaded", "completed"].includes(String(session.status))) throw new NBlogError(409, "upload_not_ready", "업로드가 성공한 파일만 완료 처리할 수 있습니다.", { object_key: objectKey });
    const object = await env.R2.head(objectKey);
    if (!object || object.size !== Number(session.expected_size)) throw new NBlogError(409, "r2_object_missing", "R2 객체가 없거나 크기가 일치하지 않습니다.", { object_key: objectKey });
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare("UPDATE nblog_upload_sessions SET status='completed', updated_at=?1 WHERE upload_id=?2").bind(now, session.upload_id),
      env.DB.prepare("UPDATE nblog_media_assets SET status='ready', updated_at=?1 WHERE user_id=?2 AND campaign_id=?3 AND media_id=?4").bind(now, actor.userId, id, session.media_id),
    ]);
    completed.push({ media_id: session.media_id, object_key: objectKey, size: object.size, status: "ready" });
  }
  const campaign = await requireCampaign(env, actor.userId, id);
  await insertAudit(env, actor, campaign, "media_upload_completed", "success", campaign.status, campaign.status, `${completed.length}개 미디어 업로드를 완료했습니다.`, { media_ids: completed.map((item) => item.media_id) });
  if (actor.viaToken) return jsonResponse({ files: completed });
  const generation = await startNBlogGeneration(env, actor, id);
  return jsonResponse({ files: completed, generation }, { status: 202 });
}

function plainCampaignText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
}

async function inspectCampaignImport(body: Record<string, unknown>): Promise<Response> {
  const source = stringField(body.campaign_url, "campaign_url", 500);
  let url: URL;
  try { url = new URL(source); } catch { throw new NBlogError(400, "invalid_campaign_url", "올바른 체험단 링크를 입력해주세요."); }
  if (url.protocol !== "https:" || !CAMPAIGN_IMPORT_HOSTS.has(url.hostname)) {
    throw new NBlogError(400, "campaign_host_not_allowed", "현재 강남맛집 체험단 링크만 안전하게 가져올 수 있습니다.");
  }
  const id = url.searchParams.get("id")?.trim() || "";
  if (!/^\d{1,30}$/.test(id)) throw new NBlogError(400, "campaign_id_missing", "체험단 링크에서 캠페인 ID를 찾을 수 없습니다.");
  url.hostname = "xn--939au0g4vj8sq.net";
  url.pathname = "/cp/";
  url.search = `?id=${id}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "text/html" }, redirect: "follow" });
  } catch (error) {
    throw new NBlogError(502, "campaign_fetch_failed", "체험단 공개 페이지에 접속하지 못했습니다.", {
      cause: error instanceof Error ? error.message.slice(0, 200) : "fetch_failed",
    });
  }
  let finalUrl: URL;
  try { finalUrl = new URL(response.url); } catch { finalUrl = url; }
  if (!CAMPAIGN_IMPORT_HOSTS.has(finalUrl.hostname)) {
    throw new NBlogError(502, "campaign_redirect_not_allowed", "허용되지 않은 주소로 이동되어 가져오기를 중단했습니다.");
  }
  if (!response.ok) throw new NBlogError(502, "campaign_fetch_failed", "체험단 공개 페이지를 가져오지 못했습니다.", { status: response.status });
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 2 * 1024 * 1024) throw new NBlogError(413, "campaign_page_too_large", "체험단 페이지가 너무 큽니다.");
  const html = (await response.text()).slice(0, 2 * 1024 * 1024);
  const text = plainCampaignText(html);
  const title = text.match(/\[(?:[^\]]+)\]\s*([^\n]{2,120})/)?.[1]?.trim()
    || html.match(/<title[^>]*>([^<]{2,160})<\/title>/i)?.[1]?.trim() || `캠페인 ${id}`;
  const placeUrl = html.match(/href=["'](https:\/\/(?:naver\.me|map\.naver\.com)[^"']+)["']/i)?.[1] || "";
  const keywordsBlock = text.match(/키워드\s+([\s\S]{1,800}?)\s+플레이스 URL/i)?.[1] || "";
  const tags = [...new Set(keywordsBlock.split(/[\s,|/]+/).map((item) => item.replace(/^#/, "").trim()).filter((item) => /^[가-힣A-Za-z0-9_-]{2,40}$/.test(item)).slice(0, 10))];
  const guideline = text.match(/가이드라인\s+([\s\S]{1,2500}?)\s+(?:방문 및 예약|리뷰 시 주의사항)/i)?.[1]?.trim() || "";
  return jsonResponse({
    source: { url: url.toString(), host: url.hostname, fetched_at: nowIso() },
    campaign: { id, name: title.replace(/\s+/g, " "), campaign_url: url.toString(), place_url: placeUrl, tags, requirements: guideline },
    defaults: { tone_profile: "직접 방문한 하루를 담은 자연스러운 일기·브이로그체", prompt_profile_id: "system-default" },
  });
}

// ── 음성메모 (#186) ────────────────────────────────────────────────────────────

async function listCampaignVoiceNotes(env: NBlogEnv, actor: NBlogActor, id: string): Promise<Response> {
  await requireCampaign(env, actor.userId, id);
  return jsonResponse({ voice_notes: await listVoiceNotes(env, actor.userId, id) });
}

/**
 * 음성 파일을 받아 R2 에 저장하고 바로 전사한다. 전사 실패가 업로드를 되돌리지는
 * 않는다 — 파일은 남기고 상태만 failed 로 두어 사용자가 직접 받아쓸 수 있게 한다.
 */
async function addVoiceNote(env: NBlogEnv, actor: NBlogActor, id: string, request: Request): Promise<Response> {
  await requireCampaign(env, actor.userId, id);
  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim();
  if (!isAllowedAudioType(contentType)) {
    throw new NBlogError(400, "unsupported_audio_type", "지원하지 않는 오디오 형식입니다.", { content_type: contentType });
  }
  const originalName = stringField(request.headers.get("x-original-name") || "voice-memo", "original_name", 240);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) throw new NBlogError(400, "empty_audio", "음성 파일이 비어 있습니다.");
  if (bytes.byteLength > MAX_VOICE_BYTES) {
    throw new NBlogError(413, "audio_too_large", "음성 파일이 너무 큽니다.", { maximum_bytes: MAX_VOICE_BYTES });
  }

  const noteId = crypto.randomUUID();
  const userPrefix = (await sha256(actor.userId)).slice(0, 16);
  const objectKey = `nblog/${userPrefix}/${safeFileName(id)}/voice/${noteId}-${safeFileName(originalName)}`;
  const checksum = `sha256:${await sha256(String(bytes.byteLength))}`;
  const now = nowIso();

  await env.R2.put(objectKey, bytes, { httpMetadata: { contentType }, customMetadata: { campaign_id: id, note_id: noteId } });

  let transcript = "";
  let status: "ready" | "failed" = "ready";
  let error: string | null = null;
  try {
    transcript = sanitizeTranscript(await transcribeAudio(env, bytes, originalName, contentType)).text;
    if (!transcript) { status = "failed"; error = "전사 결과가 비어 있습니다."; }
  } catch (cause) {
    status = "failed";
    error = String(cause).slice(0, 300);
  }

  await env.DB.prepare(
    `INSERT INTO nblog_voice_notes
      (user_id,campaign_id,note_id,object_key,original_name,content_type,size,checksum,
       transcript,transcript_status,transcript_error,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)`
  ).bind(actor.userId, id, noteId, objectKey, originalName, contentType, bytes.byteLength, checksum,
    transcript, status, error, now).run();

  return jsonResponse({ note_id: noteId, transcript, transcript_status: status, transcript_error: error }, { status: 201 });
}

/** 전사가 틀렸을 때 사용자가 고친다. 고친 뒤에는 재전사로 덮어쓰지 않는다. */
async function editVoiceNote(env: NBlogEnv, actor: NBlogActor, id: string, noteId: string, body: Record<string, unknown>): Promise<Response> {
  await requireCampaign(env, actor.userId, id);
  const { text } = sanitizeTranscript(stringField(body.transcript, "transcript", MAX_TRANSCRIPT_CHARS, false));
  const now = nowIso();
  const result = await env.DB.prepare(
    `UPDATE nblog_voice_notes
     SET transcript=?1, transcript_status=CASE WHEN ?1='' THEN 'failed' ELSE 'ready' END,
         transcript_error=NULL, edited=1, updated_at=?2
     WHERE user_id=?3 AND campaign_id=?4 AND note_id=?5`
  ).bind(text, now, actor.userId, id, noteId).run();
  if (!result.meta.changes) throw new NBlogError(404, "voice_note_not_found", "음성메모를 찾을 수 없습니다.");
  return jsonResponse({ note_id: noteId, transcript: text, transcript_status: text ? "ready" : "failed", edited: 1 });
}

async function deleteVoiceNote(env: NBlogEnv, actor: NBlogActor, id: string, noteId: string): Promise<Response> {
  await requireCampaign(env, actor.userId, id);
  const row = await env.DB.prepare("SELECT object_key FROM nblog_voice_notes WHERE user_id=?1 AND campaign_id=?2 AND note_id=?3")
    .bind(actor.userId, id, noteId).first<{ object_key: string }>();
  if (!row) throw new NBlogError(404, "voice_note_not_found", "음성메모를 찾을 수 없습니다.");
  await env.R2.delete(row.object_key);
  await env.DB.prepare("DELETE FROM nblog_voice_notes WHERE user_id=?1 AND campaign_id=?2 AND note_id=?3")
    .bind(actor.userId, id, noteId).run();
  return jsonResponse({ note_id: noteId, deleted: true });
}

async function reorderMedia(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>): Promise<Response> {
  await requireCampaign(env, actor.userId, id);
  if (!Array.isArray(body.items) || !body.items.length) throw new NBlogError(400, "invalid_media_order", "미디어 순서 항목이 필요합니다.");
  const seen = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  for (const [index, raw] of body.items.entries()) {
    const item = objectValue(raw, `items[${index}]`);
    const mediaId = stringField(item.media_id, `items[${index}].media_id`, 100);
    if (seen.has(mediaId)) throw new NBlogError(400, "duplicate_media", "미디어 순서에 중복 ID가 있습니다.");
    seen.add(mediaId);
    const order = Number(item.order ?? index + 1);
    if (!Number.isSafeInteger(order) || order < 1) throw new NBlogError(400, "invalid_media_order", "미디어 순서는 1 이상의 정수여야 합니다.");
    statements.push(env.DB.prepare(
      "UPDATE nblog_media_assets SET sort_order=?1, included=?2, is_cover=?3, updated_at=?4 WHERE user_id=?5 AND campaign_id=?6 AND media_id=?7"
    ).bind(order, item.included === false ? 0 : 1, item.is_cover === true ? 1 : 0, nowIso(), actor.userId, id, mediaId));
  }
  await env.DB.batch(statements);
  const campaign = await requireCampaign(env, actor.userId, id);
  await insertAudit(env, actor, campaign, "media_order_updated", "waiting", campaign.status, campaign.status, "미디어 순서와 포함 여부를 변경했습니다. 새 초안 생성과 동기화가 필요합니다.", { media_ids: [...seen] });
  return jsonResponse({ updated: statements.length });
}

async function deleteMedia(env: NBlogEnv, actor: NBlogActor, id: string, mediaId: string): Promise<Response> {
  const campaign = await requireCampaign(env, actor.userId, id);
  const row = await env.DB.prepare("SELECT object_key FROM nblog_media_assets WHERE user_id=?1 AND campaign_id=?2 AND media_id=?3").bind(actor.userId, id, mediaId).first<{ object_key: string | null }>();
  if (!row) throw new NBlogError(404, "media_not_found", "미디어를 찾을 수 없습니다.");
  if (row.object_key) await env.R2.delete(row.object_key);
  await env.DB.prepare("UPDATE nblog_media_assets SET object_key=NULL, included=0, is_cover=0, status='excluded', updated_at=?1 WHERE user_id=?2 AND campaign_id=?3 AND media_id=?4")
    .bind(nowIso(), actor.userId, id, mediaId).run();
  await insertAudit(env, actor, campaign, "media_excluded", "waiting", campaign.status, campaign.status, "R2 사본을 삭제하고 캠페인 포함 대상에서 제외했습니다. 로컬 원본은 변경하지 않았습니다.", { media_id: mediaId });
  return jsonResponse({ media_id: mediaId, status: "excluded" });
}

async function getMedia(env: NBlogEnv, actor: NBlogActor, id: string, mediaId: string): Promise<Response> {
  await requireCampaign(env, actor.userId, id);
  const row = await env.DB.prepare("SELECT object_key, content_type, original_name FROM nblog_media_assets WHERE user_id=?1 AND campaign_id=?2 AND media_id=?3 AND status='ready'")
    .bind(actor.userId, id, mediaId).first<{ object_key: string | null; content_type: string | null; original_name: string }>();
  if (!row?.object_key) throw new NBlogError(404, "media_not_ready", "사용 가능한 미디어 객체가 없습니다.");
  const object = await env.R2.get(row.object_key);
  if (!object?.body) throw new NBlogError(404, "media_object_missing", "R2 미디어 객체가 없습니다.");
  return new Response(object.body, { headers: {
    "content-type": row.content_type || object.httpMetadata?.contentType || "application/octet-stream",
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow",
  } });
}

function renderPromptPreview(template: string): string {
  const samples: Record<string, string> = {
    campaign_id: "NB-SAMPLE", campaign_name: "샘플 체험단", campaign_url: "https://campaign.example/sample",
    place_url: "https://map.naver.com/sample", visit_date: "2026-07-16", requirements: "최소 사진 15장, 영상 1개",
    visit_notes: "사용자가 직접 기록한 방문 메모", tone_profile: "짧은 문단과 편안한 구어체",
    user_tags: "샘플태그, 체험단후기", media_manifest: "이미지 15, 영상 1", image_summaries: "image-1: 외관 사진",
    video_summaries: "video-1: 공간 영상", sponsor_disclosure: "서비스를 제공받아 작성한 후기입니다.",
    map_or_place_block: "https://map.naver.com/sample", unconfirmed_items: "가격과 메뉴명 확인 필요",
    voice_notes: "짬뽕탕이 얼큰하니 좋았고 직원분도 친절했어요",
    category: "주점",
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => samples[name] || "");
}

/** 템플릿의 {{자리표시자}}를 실제 값으로 채운다. 값이 없으면 빈 문자열로 둔다. */
export function renderPromptTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => values[name] ?? "");
}

/**
 * 생성에 쓸 템플릿을 고른다 (#188).
 * 캠페인별 prompt_override → 지정된 프로필의 현재 버전 → 기본 템플릿 순.
 */
export async function resolvePromptTemplate(
  env: NBlogEnv,
  userId: string,
  campaign: { prompt_override?: string | null; prompt_profile_id?: string | null },
): Promise<{ template: string; source: string }> {
  const override = String(campaign.prompt_override || "").trim();
  if (override) return { template: override, source: "campaign-override" };

  const profileId = String(campaign.prompt_profile_id || "").trim();
  if (profileId) {
    const row = await env.DB.prepare(
      `SELECT v.template FROM nblog_prompt_profiles p
       JOIN nblog_prompt_profile_versions v
         ON v.user_id=p.user_id AND v.prompt_profile_id=p.prompt_profile_id AND v.version=p.current_version
       WHERE p.user_id=?1 AND p.prompt_profile_id=?2 AND p.is_active=1`
    ).bind(userId, profileId).first<{ template: string }>();
    if (row?.template) return { template: row.template, source: `profile:${profileId}` };
  }
  return { template: SYSTEM_PROMPT, source: "system-default" };
}

async function listPromptProfiles(env: NBlogEnv, actor: NBlogActor): Promise<Response> {
  const [rows, versionRows] = await Promise.all([env.DB.prepare(
    `SELECT p.*, v.template, v.allowed_placeholders, v.change_reason, v.created_by AS version_created_by, v.created_at AS version_created_at
     FROM nblog_prompt_profiles p
     JOIN nblog_prompt_profile_versions v ON v.user_id=p.user_id AND v.prompt_profile_id=p.prompt_profile_id AND v.version=p.current_version
     WHERE p.user_id=?1 ORDER BY p.updated_at DESC`
  ).bind(actor.userId).all<Record<string, unknown>>(), env.DB.prepare(
    `SELECT prompt_profile_id, version, change_reason, created_by, created_at
     FROM nblog_prompt_profile_versions WHERE user_id=?1 ORDER BY prompt_profile_id, version DESC`
  ).bind(actor.userId).all<Record<string, unknown>>()]);
  const versionsByProfile = new Map<string, Array<Record<string, unknown>>>();
  for (const version of versionRows.results || []) {
    const id = String(version.prompt_profile_id);
    const items = versionsByProfile.get(id) || [];
    items.push({ version: version.version, change_reason: version.change_reason, created_by: version.created_by, created_at: version.created_at });
    versionsByProfile.set(id, items);
  }
  const systemValidation = validatePromptTemplate(SYSTEM_PROMPT);
  const profiles = [{
    prompt_profile_id: "system-default", name: "체험단 후기 시스템 기본", version: 1,
    template: SYSTEM_PROMPT, allowed_placeholders: [...ALLOWED_PLACEHOLDERS], scope: "account",
    is_active: true, system: true, validation: systemValidation,
  }, ...(rows.results || []).map((row) => ({
    prompt_profile_id: row.prompt_profile_id,
    name: row.name,
    version: row.current_version,
    template: row.template,
    allowed_placeholders: parseJson<string[]>(String(row.allowed_placeholders || "[]"), []),
    scope: row.scope,
    is_active: row.is_active === 1,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    change_reason: row.change_reason,
    versions: versionsByProfile.get(String(row.prompt_profile_id)) || [],
    system: false,
  }))];
  return jsonResponse({ profiles });
}

async function createPromptProfile(env: NBlogEnv, actor: NBlogActor, body: Record<string, unknown>): Promise<Response> {
  const name = stringField(body.name, "name", 120);
  const template = stringField(body.template, "template", 20_000);
  const validation = validatePromptTemplate(template);
  if (!validation.valid) throw new NBlogError(400, "invalid_prompt", "프롬프트를 저장할 수 없습니다.", { field_errors: validation.errors });
  const id = optionalString(body.prompt_profile_id, "prompt_profile_id", 80) || `prompt-${crypto.randomUUID()}`;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new NBlogError(400, "invalid_prompt_profile_id", "프롬프트 ID는 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.");
  const scope = body.scope === "campaign" ? "campaign" : "account";
  const reason = stringField(body.change_reason, "change_reason", 500, false) || "프롬프트 프로필 생성";
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO nblog_prompt_profiles
       (user_id, prompt_profile_id, name, current_version, scope, is_active, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, 1, ?4, 1, ?5, ?6, ?6)`
    ).bind(actor.userId, id, name, scope, actor.label, now),
    env.DB.prepare(
      `INSERT INTO nblog_prompt_profile_versions
       (user_id, prompt_profile_id, version, template, allowed_placeholders, change_reason, created_by, created_at)
       VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7)`
    ).bind(actor.userId, id, template, JSON.stringify(validation.placeholders), reason, actor.label, now),
  ]);
  return jsonResponse({ prompt_profile_id: id, name, version: 1, template, scope, is_active: true, change_reason: reason, created_at: now }, { status: 201 });
}

async function updatePromptProfile(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>): Promise<Response> {
  if (id === "system-default") throw new NBlogError(409, "system_prompt_immutable", "시스템 기본 프롬프트는 직접 수정할 수 없습니다. 새 프로필을 만드세요.");
  const current = await env.DB.prepare("SELECT * FROM nblog_prompt_profiles WHERE user_id=?1 AND prompt_profile_id=?2")
    .bind(actor.userId, id).first<Record<string, unknown>>();
  if (!current) throw new NBlogError(404, "prompt_profile_not_found", "프롬프트 프로필을 찾을 수 없습니다.");
  const name = stringField(body.name ?? current.name, "name", 120);
  const template = stringField(body.template, "template", 20_000);
  const validation = validatePromptTemplate(template);
  if (!validation.valid) throw new NBlogError(400, "invalid_prompt", "프롬프트를 저장할 수 없습니다.", { field_errors: validation.errors });
  const reason = stringField(body.change_reason, "change_reason", 500);
  const version = Number(current.current_version) + 1;
  const now = nowIso();
  const active = body.is_active === false ? 0 : 1;
  await env.DB.batch([
    env.DB.prepare("UPDATE nblog_prompt_profiles SET name=?1, current_version=?2, is_active=?3, updated_at=?4 WHERE user_id=?5 AND prompt_profile_id=?6")
      .bind(name, version, active, now, actor.userId, id),
    env.DB.prepare(
      `INSERT INTO nblog_prompt_profile_versions
       (user_id, prompt_profile_id, version, template, allowed_placeholders, change_reason, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(actor.userId, id, version, template, JSON.stringify(validation.placeholders), reason, actor.label, now),
  ]);
  return jsonResponse({ prompt_profile_id: id, name, version, template, is_active: active === 1, change_reason: reason, updated_at: now });
}

async function restorePromptProfile(env: NBlogEnv, actor: NBlogActor, id: string, body: Record<string, unknown>): Promise<Response> {
  const targetVersion = Number(body.version);
  if (!Number.isSafeInteger(targetVersion) || targetVersion < 1) throw new NBlogError(400, "invalid_prompt_version", "복원할 프롬프트 버전이 필요합니다.");
  const old = await env.DB.prepare("SELECT template FROM nblog_prompt_profile_versions WHERE user_id=?1 AND prompt_profile_id=?2 AND version=?3")
    .bind(actor.userId, id, targetVersion).first<{ template: string }>();
  if (!old) throw new NBlogError(404, "prompt_version_not_found", "복원할 과거 프롬프트 버전을 찾을 수 없습니다.");
  return updatePromptProfile(env, actor, id, {
    name: body.name,
    template: old.template,
    is_active: true,
    change_reason: stringField(body.change_reason, "change_reason", 500, false) || `버전 ${targetVersion} 복원`,
  });
}

async function validatePromptResponse(body: Record<string, unknown>): Promise<Response> {
  const template = typeof body.template === "string" && body.template.trim() ? body.template : SYSTEM_PROMPT;
  const validation = validatePromptTemplate(template);
  return jsonResponse({ ...validation, preview: validation.valid ? renderPromptPreview(template) : null, uses_system_default: !body.template });
}

async function issueSyncToken(env: NBlogEnv, actor: NBlogActor, body: Record<string, unknown>): Promise<Response> {
  if (actor.viaToken) throw new NBlogError(403, "interactive_login_required", "동기화 토큰 발급은 로그인된 운영 화면에서만 가능합니다.");
  const label = stringField(body.label, "label", 120, false) || "NBlog local CLI";
  const token = `nbs_${randomToken(36)}`;
  const id = crypto.randomUUID();
  const now = nowIso();
  await env.DB.prepare("INSERT INTO nblog_sync_tokens (id, user_id, token_hash, label, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(id, actor.userId, await sha256(token), label, now).run();
  return jsonResponse({ id, token, label, created_at: now, warning: "이 토큰은 다시 표시되지 않습니다. NBLOG_API_TOKEN에 안전하게 저장하세요." }, { status: 201 });
}

async function listSyncTokens(env: NBlogEnv, actor: NBlogActor): Promise<Response> {
  if (actor.viaToken) throw new NBlogError(403, "interactive_login_required", "동기화 토큰 관리는 운영 화면 로그인이 필요합니다.");
  const rows = await env.DB.prepare("SELECT id, label, created_at, last_used_at, revoked_at FROM nblog_sync_tokens WHERE user_id=?1 ORDER BY created_at DESC")
    .bind(actor.userId).all<Record<string, unknown>>();
  return jsonResponse({ tokens: rows.results || [] });
}

async function revokeSyncToken(env: NBlogEnv, actor: NBlogActor, tokenId: string): Promise<Response> {
  if (actor.viaToken) throw new NBlogError(403, "interactive_login_required", "동기화 토큰 폐기는 운영 화면 로그인이 필요합니다.");
  const result = await env.DB.prepare("UPDATE nblog_sync_tokens SET revoked_at=?1 WHERE id=?2 AND user_id=?3 AND revoked_at IS NULL")
    .bind(nowIso(), tokenId, actor.userId).run();
  if (!result.meta.changes) throw new NBlogError(404, "sync_token_not_found", "활성 동기화 토큰을 찾을 수 없습니다.");
  return jsonResponse({ id: tokenId, revoked: true });
}

export async function runNBlogWorkflowReconciliation(env: NBlogEnv, params: NBlogWorkflowParams): Promise<{ status: string; missing: string[] }> {
  const campaign = await requireCampaign(env, params.user_id, params.campaign_id);
  const { version, keys } = await artifactBundle(env, params.user_id, params.campaign_id);
  const requiredKeys = ["manifest", "requirements", "draft", "draft_markdown", "validation", "preview_html"];
  const missing: string[] = [];
  if (!version) missing.push(...requiredKeys);
  else {
    for (const name of requiredKeys) {
      const key = keys[name];
      if (!key || !(await env.R2.head(key))) missing.push(name);
    }
  }
  const now = nowIso();
  if (missing.length) {
    await env.DB.prepare(
      `UPDATE nblog_campaigns SET status='failed', operation_status='failed', failure_stage='artifact_reconciliation',
       failure_reason=?1, resume_stage='sync', resume_point='누락 산출물 다시 동기화',
       remaining_steps_json=?2, retryable=1, last_checkpoint_at=?3, version=version+1, updated_at=?3
       WHERE user_id=?4 AND campaign_id=?5`
    ).bind(`R2 산출물 누락: ${missing.join(", ")}`, JSON.stringify(missing.map((name) => `${name} 다시 업로드`)), now, params.user_id, params.campaign_id).run();
  } else {
    const nextStatus = version?.validation_passed ? "approval" : "handoff";
    await env.DB.prepare(
      `UPDATE nblog_campaigns SET status=?1, operation_status=?8, failure_stage=NULL, failure_reason=NULL,
       resume_stage=?2, resume_point=?3, retryable=?4, last_checkpoint_at=?5,
       version=version+1, updated_at=?5 WHERE user_id=?6 AND campaign_id=?7`
    ).bind(nextStatus, nextStatus === "approval" ? "approval" : "local_source",
      nextStatus === "approval" ? "사용자 승인" : "검증 오류 수정 후 다시 동기화",
      nextStatus === "approval" ? 1 : 0, now, params.user_id, params.campaign_id,
      nextStatus === "approval" ? "approval_waiting" : "validation_failed").run();
  }
  const saved = await requireCampaign(env, params.user_id, params.campaign_id);
  const actor: NBlogActor = { userId: params.user_id, label: params.requested_by, viaToken: false };
  await insertAudit(env, actor, saved, "workflow_reconciled", missing.length ? "failed" : "success", campaign.status, saved.status,
    missing.length ? "저장 산출물 무결성 확인에 실패했습니다." : "저장 산출물과 체크포인트를 확인해 다음 상태로 복원했습니다.", { missing, trigger: "workflow_retry" });
  return { status: saved.status, missing };
}

async function generateCampaign(env: NBlogEnv, actor: NBlogActor, id: string): Promise<Response> {
  return jsonResponse({ generation: await startNBlogGeneration(env, actor, id) }, { status: 202 });
}

export async function handleNBlogHandoffSessionApi(request: Request, env: NBlogEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/nblog/handoff-sessions/")) return null;
  assertContractVersion(request);
  const sessionId = path.match(/^\/api\/nblog\/handoff-sessions\/([a-f0-9-]+)/i)?.[1];
  if (sessionId) await enforceNBlogRateLimit(env.NBLOG_TOKEN_RATE_LIMITER, sessionId, "handoff-token");

  const mediaMatch = path.match(/^\/api\/nblog\/handoff-sessions\/([a-f0-9-]+)\/media\/([^/]+)$/i);
  if (mediaMatch && request.method === "GET") {
    const row = await requireHandoffSessionToken(request, env, mediaMatch[1], "read_media");
    const actor: NBlogActor = { userId: row.user_id, label: "browser-handoff", viaToken: true };
    return getMedia(env, actor, row.campaign_id, stringField(decodeURIComponent(mediaMatch[2]), "media_id", 100));
  }

  const actionMatch = path.match(/^\/api\/nblog\/handoff-sessions\/([a-f0-9-]+)\/(claim|checkpoints)$/i);
  if (actionMatch) {
    if (actionMatch[2] === "claim" && request.method === "POST") return claimHandoffSession(request, env, actionMatch[1]);
    if (actionMatch[2] === "checkpoints" && request.method === "POST") {
      return saveHandoffSessionCheckpoint(request, env, actionMatch[1], await requestJson(request, 32 * 1024));
    }
  }

  const sessionMatch = path.match(/^\/api\/nblog\/handoff-sessions\/([a-f0-9-]+)$/i);
  if (sessionMatch && request.method === "GET") return getHandoffSession(request, env, sessionMatch[1]);
  return jsonResponse({ error: { code: "not_found", message: "NBlog handoff session route not found." } }, { status: 404 });
}

export async function handleNBlogApi(request: Request, env: NBlogEnv, actor: NBlogActor): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/nblog\/campaigns(?=\/|$)/, "/api/campaigns");
  assertContractVersion(request);
  await assertNBlogActorBoundary(request, env, actor, path);

  if (path === "/api/nblog/campaign-imports/inspect" && request.method === "GET") {
    try {
      return await inspectCampaignImport({ campaign_url: new URL(request.url).searchParams.get("campaign_url") });
    } catch (error) {
      if (error instanceof NBlogError) throw error;
      throw new NBlogError(500, "campaign_import_failed", "체험단 정보를 해석하지 못했습니다.", {
        cause: error instanceof Error ? error.message.slice(0, 200) : "import_failed",
      });
    }
  }

  if (path === "/api/campaigns") {
    if (request.method === "GET") return listCampaigns(env, actor, new URL(request.url).searchParams.get("view") === "archived");
    if (request.method === "POST") {
      const body = await requestJson(request);
      return idempotentMutation(request, env, actor, `campaign:${campaignId(body.campaign_id || body.id)}:upsert`, body,
        () => createCampaign(env, actor, body));
    }
    return jsonResponse({ error: { code: "method_not_allowed", message: "GET 또는 POST 요청만 허용됩니다." } }, { status: 405, headers: { allow: "GET, POST" } });
  }

  if (path === "/api/nblog/prompt-profiles/validate" && request.method === "POST") return validatePromptResponse(await requestJson(request, 32 * 1024));
  if (path === "/api/nblog/prompt-profiles") {
    if (request.method === "GET") return listPromptProfiles(env, actor);
    if (request.method === "POST") return createPromptProfile(env, actor, await requestJson(request, 32 * 1024));
    return jsonResponse({ error: { code: "method_not_allowed", message: "GET 또는 POST 요청만 허용됩니다." } }, { status: 405, headers: { allow: "GET, POST" } });
  }
  const promptRestore = path.match(/^\/api\/nblog\/prompt-profiles\/([A-Za-z0-9_-]+)\/restore$/);
  if (promptRestore && request.method === "POST") return restorePromptProfile(env, actor, promptRestore[1], await requestJson(request, 32 * 1024));
  const promptMatch = path.match(/^\/api\/nblog\/prompt-profiles\/([A-Za-z0-9_-]+)$/);
  if (promptMatch && request.method === "PUT") return updatePromptProfile(env, actor, promptMatch[1], await requestJson(request, 32 * 1024));

  if (path === "/api/nblog/sync-tokens") {
    if (request.method === "GET") return listSyncTokens(env, actor);
    if (request.method === "POST") return issueSyncToken(env, actor, await requestJson(request, 8 * 1024));
    return jsonResponse({ error: { code: "method_not_allowed", message: "GET 또는 POST 요청만 허용됩니다." } }, { status: 405, headers: { allow: "GET, POST" } });
  }
  const tokenMatch = path.match(/^\/api\/nblog\/sync-tokens\/([a-f0-9-]+)$/i);
  if (tokenMatch && request.method === "DELETE") return revokeSyncToken(env, actor, tokenMatch[1]);

  const mediaObjectMatch = path.match(/^\/api\/campaigns\/([^/]+)\/media\/([^/]+)$/);
  if (mediaObjectMatch) {
    const id = campaignId(decodeURIComponent(mediaObjectMatch[1]));
    const mediaId = stringField(decodeURIComponent(mediaObjectMatch[2]), "media_id", 100);
    if (request.method === "GET") return getMedia(env, actor, id, mediaId);
    if (request.method === "DELETE") return deleteMedia(env, actor, id, mediaId);
  }

  const actionMatch = path.match(/^\/api\/campaigns\/([^/]+)\/(validation|preview|approve|content-confirmations|retry|artifacts|handoff|publish-result|publication|generate|visit-date|archive|restore)$/);
  if (actionMatch) {
    const id = campaignId(decodeURIComponent(actionMatch[1]));
    const action = actionMatch[2];
    if (action === "validation" && request.method === "GET") return getValidation(env, actor, id);
    if (action === "preview" && request.method === "GET") return getPreview(env, actor, id);
    if (action === "handoff" && request.method === "GET") return getHandoff(env, actor, id);
    if (action === "approve" && request.method === "POST") {
      const body = await requestJson(request, 16 * 1024);
      return idempotentMutation(request, env, actor, `campaign:${id}:approve`, body, () => approveCampaign(env, actor, id, body));
    }
    if (action === "content-confirmations" && request.method === "POST") {
      const body = await requestJson(request, 16 * 1024);
      return idempotentMutation(request, env, actor, `campaign:${id}:content-confirmation`, body,
        async () => jsonResponse(await confirmNBlogContent(env, actor, id, body)));
    }
    if (action === "retry" && request.method === "POST") return retryCampaign(env, actor, id, await requestJson(request, 16 * 1024));
    if (action === "artifacts" && request.method === "POST") return syncArtifacts(env, actor, id, await requestJson(request));
    if (action === "publish-result" && request.method === "POST") {
      const body = await requestJson(request, 32 * 1024);
      return idempotentMutation(request, env, actor, `campaign:${id}:publish-result`, body, () => savePublication(env, actor, id, body, false));
    }
    if (action === "publication" && request.method === "PATCH") {
      const body = await requestJson(request, 32 * 1024);
      return idempotentMutation(request, env, actor, `campaign:${id}:publication`, body, () => savePublication(env, actor, id, body, true));
    }
    if (action === "generate" && request.method === "POST") return generateCampaign(env, actor, id);
    if (action === "visit-date" && request.method === "PATCH") {
      const body = await requestJson(request, 8 * 1024);
      return idempotentMutation(request, env, actor, `campaign:${id}:visit-date`, body, () => updateVisitDate(env, actor, id, body));
    }
    if (action === "archive" && request.method === "POST") {
      const body = await requestJson(request, 8 * 1024);
      return idempotentMutation(request, env, actor, `campaign:${id}:archive`, body, () => archiveCampaign(env, actor, id, body));
    }
    if (action === "restore" && request.method === "POST") {
      const body = await requestJson(request, 8 * 1024);
      return idempotentMutation(request, env, actor, `campaign:${id}:restore`, body, () => restoreCampaign(env, actor, id, body));
    }
  }

  const checkpointMatch = path.match(/^\/api\/campaigns\/([^/]+)\/handoff\/checkpoint$/);
  if (checkpointMatch && request.method === "POST") {
    const id = campaignId(decodeURIComponent(checkpointMatch[1]));
    const body = await requestJson(request, 32 * 1024);
    return idempotentMutation(request, env, actor, `campaign:${id}:manual-checkpoint`, body, () => saveCheckpoint(env, actor, id, body));
  }

  const handoffSessionMatch = path.match(/^\/api\/campaigns\/([^/]+)\/handoff-sessions$/);
  if (handoffSessionMatch && request.method === "POST") {
    return issueHandoffSession(env, actor, campaignId(decodeURIComponent(handoffSessionMatch[1])), await requestJson(request, 16 * 1024));
  }

  // 음성메모 (#186) — 파일이 작아 업로드 세션 없이 바로 받는다.
  const voiceMatch = path.match(/^\/api\/campaigns\/([^/]+)\/voice-notes(?:\/([^/]+))?$/);
  if (voiceMatch) {
    const id = campaignId(decodeURIComponent(voiceMatch[1]));
    const noteId = voiceMatch[2] ? decodeURIComponent(voiceMatch[2]) : null;
    if (!noteId && request.method === "GET") return listCampaignVoiceNotes(env, actor, id);
    if (!noteId && request.method === "POST") return addVoiceNote(env, actor, id, request);
    if (noteId && request.method === "PATCH") return editVoiceNote(env, actor, id, noteId, await requestJson(request, 64 * 1024));
    if (noteId && request.method === "DELETE") return deleteVoiceNote(env, actor, id, noteId);
  }

  const uploadActionMatch = path.match(/^\/api\/campaigns\/([^/]+)\/media\/(upload-init|upload-complete|order)$/);
  if (uploadActionMatch) {
    const id = campaignId(decodeURIComponent(uploadActionMatch[1]));
    const action = uploadActionMatch[2];
    const body = await requestJson(request, 256 * 1024);
    if (action === "upload-init" && request.method === "POST") return initMediaUploads(env, actor, id, body, request);
    if (action === "upload-complete" && request.method === "POST") return completeMediaUploads(env, actor, id, body);
    if (action === "order" && request.method === "PATCH") {
      return idempotentMutation(request, env, actor, `campaign:${id}:media-order`, body, () => reorderMedia(env, actor, id, body));
    }
  }

  const campaignMatch = path.match(/^\/api\/campaigns\/([^/]+)$/);
  if (campaignMatch && request.method === "GET") return getCampaignDetail(env, actor, campaignId(decodeURIComponent(campaignMatch[1])));

  if (path.startsWith("/api/campaigns") || path.startsWith("/api/nblog/")) {
    return jsonResponse({ error: { code: "not_found", message: "NBlog API 경로를 찾을 수 없습니다." } }, { status: 404 });
  }
  return null;
}

export function nblogErrorResponse(error: unknown, request?: Request): Response {
  const id = requestId(request);
  if (error instanceof NBlogError) {
    const retryable = typeof error.details.retryable === "boolean"
      ? error.details.retryable
      : error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
    const response = jsonResponse({
      contract_version: NBLOG_CONTRACT_VERSION,
      request_id: id,
      error: {
        code: error.code,
        message: error.message,
        ...error.details,
        retryable,
        resume_point: error.details.resume_point || null,
      },
    }, { status: error.status });
    response.headers.set("x-nblog-contract-version", NBLOG_CONTRACT_VERSION);
    response.headers.set("x-request-id", id);
    if (error.status === 429) response.headers.set("retry-after", String(error.details.retry_after_seconds || 60));
    return response;
  }
  const response = jsonResponse({
    contract_version: NBLOG_CONTRACT_VERSION,
    request_id: id,
    error: { code: "nblog_server_error", message: "The NBlog API could not complete the request.", retryable: true, resume_point: null },
  }, { status: 500 });
  response.headers.set("x-nblog-contract-version", NBLOG_CONTRACT_VERSION);
  response.headers.set("x-request-id", id);
  return response;
}
