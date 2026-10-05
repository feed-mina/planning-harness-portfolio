import type { Env } from "../../env";

type MobileAuthEnv = Pick<Env, "DB" | "MOBILE_AUTH_ENABLED" | "MOBILE_AUTH_REDIRECT_URIS">;
type JsonObject = Record<string, unknown>;

const AUTH_CODE_PREFIX = "ph_mob_ac_";
const ACCESS_TOKEN_PREFIX = "ph_mob_at_";
const REFRESH_TOKEN_PREFIX = "ph_mob_rt_";
const AUTH_CODE_TTL_SECONDS = 2 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_JSON_BODY_BYTES = 16 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]+$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export type MobileAuthRateOperation = "code_issue" | "code_exchange" | "refresh" | "revoke";

export const MOBILE_AUTH_RATE_LIMITS: Record<MobileAuthRateOperation, { ip: number; entity: number }> = {
  code_issue: { ip: 12, entity: 6 },
  code_exchange: { ip: 30, entity: 10 },
  refresh: { ip: 30, entity: 12 },
  revoke: { ip: 30, entity: 12 },
};

export class MobileAuthError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "MobileAuthError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface MobileAccessIdentity {
  userId: string;
  sessionId: string;
  familyId: string;
}

export interface MobileAuthorizationCodeResult {
  code: string;
  code_challenge_method: "S256";
  redirect_uri: string;
  expires_in: number;
}

export interface MobileTokenResult {
  token_type: "Bearer";
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  session_id: string;
}

interface MobileSessionRow {
  id: string;
  family_id: string;
  user_id: string;
  refresh_expires_at: number;
  revoked_at: number | null;
  revoke_reason: string | null;
}

function fail(status: number, code: string, message: string, details?: Record<string, unknown>): never {
  throw new MobileAuthError(status, code, message, details);
}

function epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function assertMobileAuthEnabled(env: MobileAuthEnv): void {
  if (env.MOBILE_AUTH_ENABLED !== "true") {
    fail(404, "mobile_auth_disabled", "mobile authentication is disabled");
  }
}

function configuredRedirectUris(env: MobileAuthEnv): Set<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.MOBILE_AUTH_REDIRECT_URIS || "[]");
  } catch {
    fail(503, "mobile_auth_misconfigured", "mobile redirect allowlist is not valid JSON");
  }
  if (!isNonEmptyRedirectList(parsed)) {
    fail(503, "mobile_auth_misconfigured", "mobile redirect allowlist is empty or invalid");
  }
  const redirects = new Set<string>();
  for (const value of parsed) {
    try {
      const url = new URL(value);
      if (url.username || url.password || url.hash) throw new Error("unsafe redirect URI");
    } catch {
      fail(503, "mobile_auth_misconfigured", "mobile redirect allowlist contains an invalid URI");
    }
    redirects.add(value);
  }
  return redirects;
}

function isNonEmptyRedirectList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 20
    && value.every((item: unknown) => typeof item === "string" && item.length > 0 && item.length <= 2048);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomOpaqueToken(prefix: string): string {
  return `${prefix}${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

function requiredString(body: JsonObject, name: string, maxLength = 2048): string {
  const value = body[name];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    fail(400, "invalid_request", `${name} is required`);
  }
  return value;
}

function requireOpaqueToken(value: unknown, prefix: string, errorCode = "invalid_grant"): string {
  if (
    typeof value !== "string"
    || value.length <= prefix.length
    || value.length > 512
    || !value.startsWith(prefix)
    || !TOKEN_PATTERN.test(value)
  ) {
    fail(400, errorCode, "invalid token");
  }
  return value;
}

function requireAllowedRedirectUri(env: MobileAuthEnv, value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    fail(400, "invalid_request", "redirect_uri is required");
  }
  if (!configuredRedirectUris(env).has(value)) fail(400, "redirect_uri_not_allowed", "redirect_uri is not allowed");
  return value;
}

function requirePkceChallenge(value: unknown): string {
  if (typeof value !== "string" || !PKCE_CHALLENGE_PATTERN.test(value)) {
    fail(400, "invalid_request", "code_challenge must be a PKCE S256 value");
  }
  return value;
}

function requirePkceVerifier(value: unknown): string {
  if (typeof value !== "string" || !PKCE_VERIFIER_PATTERN.test(value)) {
    fail(400, "invalid_grant", "invalid authorization code or PKCE verifier");
  }
  return value;
}

export async function hashMobileToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").toLowerCase();
}

function clientIpSubject(request: Request): string {
  const value = (request.headers.get("cf-connecting-ip") || "unknown").trim().toLowerCase();
  return value && value.length <= 128 ? value : "unknown";
}

export async function enforceMobileAuthRateLimits(
  env: MobileAuthEnv,
  request: Request,
  operation: MobileAuthRateOperation,
  entitySubject: string,
): Promise<void> {
  assertMobileAuthEnabled(env);
  const limits = MOBILE_AUTH_RATE_LIMITS[operation];
  const [ipHash, entityHash] = await Promise.all([
    hashMobileToken(`mobile-auth:ip:${clientIpSubject(request)}`),
    hashMobileToken(`mobile-auth:entity:${entitySubject}`),
  ]);
  const now = epochSeconds();
  const windowStartedAt = Math.floor(now / RATE_LIMIT_WINDOW_SECONDS) * RATE_LIMIT_WINDOW_SECONDS;
  const expiresAt = windowStartedAt + (2 * RATE_LIMIT_WINDOW_SECONDS);
  const upsert = `INSERT INTO mobile_auth_rate_limits
       (scope, subject_hash, window_started_at, request_count, expires_at)
     VALUES (?1, ?2, ?3, 1, ?4)
     ON CONFLICT(scope, subject_hash, window_started_at) DO UPDATE SET
       request_count=mobile_auth_rate_limits.request_count + 1,
       expires_at=excluded.expires_at
     RETURNING request_count`;
  const [ipResult, entityResult] = await env.DB.batch<{ request_count?: number }>([
    env.DB.prepare(upsert).bind(`${operation}:ip`, ipHash, windowStartedAt, expiresAt),
    env.DB.prepare(upsert).bind(`${operation}:entity`, entityHash, windowStartedAt, expiresAt),
    env.DB.prepare("DELETE FROM mobile_auth_rate_limits WHERE expires_at<=?1").bind(now),
  ]);
  const ipCount = Number(ipResult.results[0]?.request_count || 0);
  const entityCount = Number(entityResult.results[0]?.request_count || 0);
  if (!ipCount || !entityCount) throw new Error("mobile auth rate limiter did not return a counter");
  const retryAfterSeconds = Math.max(1, windowStartedAt + RATE_LIMIT_WINDOW_SECONDS - now);
  if (ipCount > limits.ip) {
    fail(429, "rate_limited", "too many mobile authentication requests", {
      rate_limit_scope: `${operation}:ip`,
      retry_after_seconds: retryAfterSeconds,
    });
  }
  if (entityCount > limits.entity) {
    fail(429, "rate_limited", "too many mobile authentication requests", {
      rate_limit_scope: `${operation}:entity`,
      retry_after_seconds: retryAfterSeconds,
    });
  }
}

async function opaqueRateSubject(value: unknown, prefix: string, label: string): Promise<string> {
  if (typeof value !== "string" || !value.startsWith(prefix) || !TOKEN_PATTERN.test(value) || value.length > 512) {
    return `${label}:invalid`;
  }
  return `${label}:${await hashMobileToken(value)}`;
}

async function authorizationCodeRateSubject(env: MobileAuthEnv, value: unknown): Promise<string> {
  const fallback = await opaqueRateSubject(value, AUTH_CODE_PREFIX, "code");
  if (!fallback.startsWith("code:") || fallback === "code:invalid") return fallback;
  const codeHash = fallback.slice("code:".length);
  const row = await env.DB.prepare("SELECT user_id FROM mobile_auth_codes WHERE code_hash=?1 LIMIT 1")
    .bind(codeHash)
    .first<{ user_id: string }>();
  return row ? `user:${row.user_id}` : fallback;
}

async function refreshRateSubject(env: MobileAuthEnv, value: unknown): Promise<string> {
  const fallback = await opaqueRateSubject(value, REFRESH_TOKEN_PREFIX, "refresh");
  if (fallback === "refresh:invalid") return fallback;
  const tokenHash = fallback.slice("refresh:".length);
  const row = await env.DB.prepare("SELECT family_id FROM mobile_sessions WHERE refresh_token_hash=?1 LIMIT 1")
    .bind(tokenHash)
    .first<{ family_id: string }>();
  return row ? `family:${row.family_id}` : fallback;
}

async function revokeRateSubject(
  env: MobileAuthEnv,
  token: unknown,
  tokenType: unknown,
): Promise<string> {
  const type = tokenType === "access_token" ? "access_token" : tokenType === "refresh_token" ? "refresh_token" : null;
  if (!type) return "revoke:invalid";
  const prefix = type === "access_token" ? ACCESS_TOKEN_PREFIX : REFRESH_TOKEN_PREFIX;
  const label = type === "access_token" ? "access" : "refresh";
  const fallback = await opaqueRateSubject(token, prefix, label);
  if (fallback === `${label}:invalid`) return fallback;
  const tokenHash = fallback.slice(label.length + 1);
  const query = type === "access_token"
    ? "SELECT family_id FROM mobile_sessions WHERE access_token_hash=?1 LIMIT 1"
    : "SELECT family_id FROM mobile_sessions WHERE refresh_token_hash=?1 LIMIT 1";
  const row = await env.DB.prepare(query)
    .bind(tokenHash)
    .first<{ family_id: string }>();
  return row ? `family:${row.family_id}` : fallback;
}

export async function pkceS256(verifier: string): Promise<string> {
  const validVerifier = requirePkceVerifier(verifier);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(validVerifier));
  return base64Url(new Uint8Array(digest));
}

export async function readMobileAuthJson(request: Request): Promise<JsonObject> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    fail(415, "invalid_request", "content-type must be application/json");
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    fail(413, "request_too_large", "request body is too large");
  }
  if (!request.body) fail(400, "invalid_json", "request body must be valid JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_JSON_BODY_BYTES) {
        await reader.cancel("request body is too large");
        fail(413, "request_too_large", "request body is too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof MobileAuthError) throw error;
    fail(400, "invalid_json", "request body must be valid JSON");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail(400, "invalid_json", "request body must be valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(400, "invalid_request", "request body must be a JSON object");
  }
  return body as JsonObject;
}

export async function issueMobileAuthorizationCode(
  env: MobileAuthEnv,
  userId: string,
  input: JsonObject,
): Promise<MobileAuthorizationCodeResult> {
  assertMobileAuthEnabled(env);
  const codeChallenge = requirePkceChallenge(input.code_challenge);
  if (input.code_challenge_method !== "S256") {
    fail(400, "invalid_request", "code_challenge_method must be S256");
  }
  const redirectUri = requireAllowedRedirectUri(env, input.redirect_uri);
  const user = await env.DB.prepare("SELECT 1 AS present FROM users WHERE id=?1 LIMIT 1")
    .bind(userId)
    .first<{ present: number }>();
  if (!user) fail(401, "login_required", "login required");

  const code = randomOpaqueToken(AUTH_CODE_PREFIX);
  const codeHash = await hashMobileToken(code);
  const now = epochSeconds();
  await env.DB.prepare(
    `INSERT INTO mobile_auth_codes
       (id, code_hash, user_id, code_challenge, code_challenge_method, redirect_uri, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, 'S256', ?5, ?6, ?7)`,
  ).bind(crypto.randomUUID(), codeHash, userId, codeChallenge, redirectUri, now, now + AUTH_CODE_TTL_SECONDS).run();

  return {
    code,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    expires_in: AUTH_CODE_TTL_SECONDS,
  };
}

export async function cancelMobileAuthorizationCode(
  env: MobileAuthEnv,
  userId: string,
  input: JsonObject,
): Promise<{ ok: true; cancelled: boolean }> {
  assertMobileAuthEnabled(env);
  const code = requireOpaqueToken(input.code, AUTH_CODE_PREFIX);
  const codeHash = await hashMobileToken(code);
  const now = epochSeconds();
  const result = await env.DB.prepare(
    `UPDATE mobile_auth_codes
     SET cancelled_at=?1
     WHERE code_hash=?2
       AND user_id=?3
       AND consumed_at IS NULL
       AND cancelled_at IS NULL
       AND expires_at>?1`,
  ).bind(now, codeHash, userId).run();
  return { ok: true, cancelled: result.meta.changes === 1 };
}

function tokenResult(
  sessionId: string,
  accessToken: string,
  refreshToken: string,
  accessExpiresAt: number,
  refreshExpiresAt: number,
  now: number,
): MobileTokenResult {
  return {
    token_type: "Bearer",
    access_token: accessToken,
    expires_in: Math.max(0, accessExpiresAt - now),
    refresh_token: refreshToken,
    refresh_expires_in: Math.max(0, refreshExpiresAt - now),
    session_id: sessionId,
  };
}

export async function exchangeMobileAuthorizationCode(
  env: MobileAuthEnv,
  input: JsonObject,
): Promise<MobileTokenResult> {
  assertMobileAuthEnabled(env);
  const code = requireOpaqueToken(input.code, AUTH_CODE_PREFIX);
  const verifier = requirePkceVerifier(input.code_verifier);
  const redirectUri = requireAllowedRedirectUri(env, input.redirect_uri);
  const [codeHash, challenge] = await Promise.all([hashMobileToken(code), pkceS256(verifier)]);
  const accessToken = randomOpaqueToken(ACCESS_TOKEN_PREFIX);
  const refreshToken = randomOpaqueToken(REFRESH_TOKEN_PREFIX);
  const [accessHash, refreshHash] = await Promise.all([
    hashMobileToken(accessToken),
    hashMobileToken(refreshToken),
  ]);
  const sessionId = crypto.randomUUID();
  const consumeNonce = crypto.randomUUID();
  const now = epochSeconds();
  const accessExpiresAt = now + ACCESS_TOKEN_TTL_SECONDS;
  const refreshExpiresAt = now + REFRESH_TOKEN_TTL_SECONDS;

  // D1 batch is transactional. The unique consume nonce makes the session
  // INSERT visible only to the request whose conditional UPDATE won.
  const [consumeResult, sessionResult] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE mobile_auth_codes
       SET consumed_at=?1, consume_nonce=?2
       WHERE code_hash=?3
         AND code_challenge=?4
         AND redirect_uri=?5
         AND code_challenge_method='S256'
         AND consumed_at IS NULL
         AND cancelled_at IS NULL
         AND expires_at>?1`,
    ).bind(now, consumeNonce, codeHash, challenge, redirectUri),
    env.DB.prepare(
      `INSERT INTO mobile_sessions
         (id, family_id, parent_session_id, user_id, access_token_hash, refresh_token_hash,
          access_expires_at, refresh_expires_at, created_at, updated_at)
       SELECT ?1, ?1, NULL, user_id, ?2, ?3, ?4, ?5, ?6, ?6
       FROM mobile_auth_codes
       WHERE code_hash=?7 AND consume_nonce=?8`,
    ).bind(sessionId, accessHash, refreshHash, accessExpiresAt, refreshExpiresAt, now, codeHash, consumeNonce),
  ]);

  if (consumeResult.meta.changes !== 1 || sessionResult.meta.changes !== 1) {
    fail(400, "invalid_grant", "invalid, expired, cancelled, or already-used authorization code");
  }
  return tokenResult(sessionId, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, now);
}

async function revokeFamily(
  env: MobileAuthEnv,
  familyId: string,
  reason: "refresh_reuse" | "revoked",
  now: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE mobile_sessions
     SET revoked_at=COALESCE(revoked_at, ?1),
         revoke_reason=CASE WHEN revoked_at IS NULL THEN ?2 ELSE revoke_reason END,
         reuse_detected_at=CASE WHEN ?2='refresh_reuse' THEN COALESCE(reuse_detected_at, ?1) ELSE reuse_detected_at END,
         updated_at=?1
     WHERE family_id=?3`,
  ).bind(now, reason, familyId).run();
}

export async function rotateMobileRefreshToken(
  env: MobileAuthEnv,
  input: JsonObject,
): Promise<MobileTokenResult> {
  assertMobileAuthEnabled(env);
  const refreshToken = requireOpaqueToken(input.refresh_token, REFRESH_TOKEN_PREFIX);
  const refreshHash = await hashMobileToken(refreshToken);
  const current = await env.DB.prepare(
    `SELECT id, family_id, user_id, refresh_expires_at, revoked_at, revoke_reason
     FROM mobile_sessions WHERE refresh_token_hash=?1 LIMIT 1`,
  ).bind(refreshHash).first<MobileSessionRow>();
  const now = epochSeconds();
  if (!current) fail(400, "invalid_grant", "invalid refresh token");

  if (current.revoked_at !== null) {
    if (current.revoke_reason === "rotated") {
      await revokeFamily(env, current.family_id, "refresh_reuse", now);
    }
    fail(400, "invalid_grant", "refresh token is no longer valid");
  }
  if (current.refresh_expires_at <= now) {
    await env.DB.prepare(
      `UPDATE mobile_sessions
       SET revoked_at=?1, revoke_reason='expired', updated_at=?1
       WHERE id=?2 AND revoked_at IS NULL`,
    ).bind(now, current.id).run();
    fail(400, "invalid_grant", "refresh token has expired");
  }

  const accessToken = randomOpaqueToken(ACCESS_TOKEN_PREFIX);
  const nextRefreshToken = randomOpaqueToken(REFRESH_TOKEN_PREFIX);
  const [accessHash, nextRefreshHash] = await Promise.all([
    hashMobileToken(accessToken),
    hashMobileToken(nextRefreshToken),
  ]);
  const nextSessionId = crypto.randomUUID();
  const rotationNonce = crypto.randomUUID();
  const accessExpiresAt = Math.min(now + ACCESS_TOKEN_TTL_SECONDS, current.refresh_expires_at);
  // The old generation is conditionally revoked first; only its unique
  // rotation nonce can create the next generation in the same D1 transaction.
  const [rotateResult, insertResult] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE mobile_sessions
       SET revoked_at=?1,
           revoke_reason='rotated',
           rotated_to_session_id=?2,
           rotation_nonce=?3,
           updated_at=?1
       WHERE id=?4
         AND refresh_token_hash=?5
         AND revoked_at IS NULL
         AND refresh_expires_at>?1`,
    ).bind(now, nextSessionId, rotationNonce, current.id, refreshHash),
    env.DB.prepare(
      `INSERT INTO mobile_sessions
         (id, family_id, parent_session_id, user_id, access_token_hash, refresh_token_hash,
          access_expires_at, refresh_expires_at, created_at, updated_at)
       SELECT ?1, family_id, id, user_id, ?2, ?3, ?4, refresh_expires_at, ?5, ?5
       FROM mobile_sessions
       WHERE id=?6
         AND rotation_nonce=?7
         AND rotated_to_session_id=?1
         AND revoke_reason='rotated'`,
    ).bind(nextSessionId, accessHash, nextRefreshHash, accessExpiresAt, now, current.id, rotationNonce),
  ]);

  if (rotateResult.meta.changes !== 1 || insertResult.meta.changes !== 1) {
    // A concurrent rotation won. Treat the second presentation as refresh-token
    // reuse and invalidate every active descendant in the token family.
    await revokeFamily(env, current.family_id, "refresh_reuse", now);
    fail(400, "invalid_grant", "refresh token reuse detected");
  }

  return tokenResult(
    nextSessionId,
    accessToken,
    nextRefreshToken,
    accessExpiresAt,
    current.refresh_expires_at,
    now,
  );
}

export async function authenticateMobileAccessToken(
  env: MobileAuthEnv,
  accessToken: string,
): Promise<MobileAccessIdentity | null> {
  assertMobileAuthEnabled(env);
  if (
    !accessToken.startsWith(ACCESS_TOKEN_PREFIX)
    || accessToken.length > 512
    || !TOKEN_PATTERN.test(accessToken)
  ) {
    return null;
  }
  const accessHash = await hashMobileToken(accessToken);
  const now = epochSeconds();
  const row = await env.DB.prepare(
    `SELECT id, family_id, user_id
     FROM mobile_sessions
     WHERE access_token_hash=?1
       AND revoked_at IS NULL
       AND access_expires_at>?2
       AND refresh_expires_at>?2
     LIMIT 1`,
  ).bind(accessHash, now).first<{ id: string; family_id: string; user_id: string }>();
  return row ? { userId: row.user_id, sessionId: row.id, familyId: row.family_id } : null;
}

function bearerValue(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer ([A-Za-z0-9._~-]+)$/i);
  return match?.[1] || null;
}

export async function authenticateMobileBearer(
  request: Request,
  env: MobileAuthEnv,
  allowOtherAuthorization = false,
): Promise<MobileAccessIdentity | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const token = bearerValue(request);
  if (!token || !token.startsWith(ACCESS_TOKEN_PREFIX)) {
    if (allowOtherAuthorization) return null;
    fail(401, "invalid_token", "invalid bearer token");
  }
  assertMobileAuthEnabled(env);
  const identity = await authenticateMobileAccessToken(env, token);
  if (!identity) fail(401, "invalid_token", "bearer token is expired, revoked, or invalid");
  return identity;
}

export async function revokeMobileToken(
  env: MobileAuthEnv,
  token: string,
  tokenType: "access_token" | "refresh_token",
): Promise<boolean> {
  assertMobileAuthEnabled(env);
  const requiredPrefix = tokenType === "access_token" ? ACCESS_TOKEN_PREFIX : REFRESH_TOKEN_PREFIX;
  if (
    token.length > 512
    || !TOKEN_PATTERN.test(token)
    || !token.startsWith(requiredPrefix)
  ) {
    return false;
  }
  const tokenHash = await hashMobileToken(token);
  const query = tokenType === "access_token"
    ? "SELECT family_id FROM mobile_sessions WHERE access_token_hash=?1 LIMIT 1"
    : "SELECT family_id FROM mobile_sessions WHERE refresh_token_hash=?1 LIMIT 1";
  const row = await env.DB.prepare(query).bind(tokenHash).first<{ family_id: string }>();
  if (!row) return false;
  await revokeFamily(env, row.family_id, "revoked", epochSeconds());
  return true;
}

export async function handleMobileTokenRequest(
  request: Request,
  env: MobileAuthEnv,
): Promise<MobileTokenResult> {
  assertMobileAuthEnabled(env);
  const body = await readMobileAuthJson(request);
  const grantType = requiredString(body, "grant_type", 64);
  if (grantType === "authorization_code") {
    await enforceMobileAuthRateLimits(env, request, "code_exchange", await authorizationCodeRateSubject(env, body.code));
    return exchangeMobileAuthorizationCode(env, body);
  }
  if (grantType === "refresh_token") {
    await enforceMobileAuthRateLimits(env, request, "refresh", await refreshRateSubject(env, body.refresh_token));
    return rotateMobileRefreshToken(env, body);
  }
  fail(400, "unsupported_grant_type", "grant_type is not supported");
}

export async function handleMobileRevokeRequest(
  request: Request,
  env: MobileAuthEnv,
): Promise<{ ok: true }> {
  assertMobileAuthEnabled(env);
  const body = await readMobileAuthJson(request);
  const token = requiredString(body, "token", 512);
  const tokenType = requiredString(body, "token_type_hint", 32);
  if (tokenType !== "access_token" && tokenType !== "refresh_token") {
    fail(400, "invalid_request", "token_type_hint must be access_token or refresh_token");
  }
  await enforceMobileAuthRateLimits(env, request, "revoke", await revokeRateSubject(env, token, tokenType));
  await revokeMobileToken(env, token, tokenType);
  // Revocation is intentionally idempotent and does not disclose token presence.
  return { ok: true };
}
