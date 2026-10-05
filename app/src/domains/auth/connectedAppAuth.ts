import { deployEnvironment, type Env } from "../../env";
import { timingSafeEqual } from "../../core/auth/crypto";
import { parseCookies, signJWT, verifyJWT } from "../../core/auth/jwt";

type ConnectedAppEnv = Pick<
  Env,
  | "DB"
  | "APP_BASE_URL"
  | "JWT_SECRET"
  | "ANALYTICS_ENVIRONMENT"
  | "CONNECTED_APP_AUTH_ENABLED"
  | "CONNECTED_APP_CLIENT_ID"
  | "CONNECTED_APP_AUDIENCE"
  | "CONNECTED_APP_SCOPE"
  | "CONNECTED_APP_REDIRECT_URI"
  | "CONNECTED_APP_BACKCHANNEL_SECRET"
>;

type JsonObject = Record<string, unknown>;

interface ConnectedAppConfig {
  clientId: string;
  audience: string;
  scope: string;
  redirectUri: string;
  issuer: string;
  environment: string;
}

interface AuthorizationRequest extends ConnectedAppConfig {
  responseType: "code";
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

interface ConnectedAppCodeRow {
  id: string;
  user_id: string;
  client_id: string;
  audience: string;
  scope: string;
  redirect_uri: string;
  issuer: string;
  environment: string;
  consumed_at: number;
}

export interface ConnectedAppIdentityAssertion {
  issuer: string;
  subject: string;
  client_id: string;
  audience: string;
  scope: string;
  environment: string;
  authorization_id: string;
  issued_at: number;
  expires_at: number;
}

const AUTHORIZATION_CODE_PREFIX = "ph_ca_ac_";
const AUTHORIZATION_CODE_TTL_SECONDS = 120;
const ASSERTION_TTL_SECONDS = 120;
const RESUME_COOKIE_TTL_SECONDS = 10 * 60;
const MAX_JSON_BODY_BYTES = 16 * 1024;
const MAX_RESUME_QUERY_BYTES = 2 * 1024;
const RESUME_COOKIE_NAME = "__Host-harness_connected_app_resume";
const RESUME_PATH = "/api/auth/connected-app/authorize/resume";
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]+$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const STATE_PATTERN = /^[A-Za-z0-9._~-]{16,512}$/;
const EXCHANGE_ID_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;
const AUTHORIZATION_PARAMETER_NAMES = new Set([
  "response_type",
  "client_id",
  "audience",
  "scope",
  "redirect_uri",
  "issuer",
  "environment",
  "state",
  "code_challenge",
  "code_challenge_method",
]);

export class ConnectedAppAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ConnectedAppAuthError";
    this.status = status;
    this.code = code;
  }
}

function fail(status: number, code: string, message: string): never {
  throw new ConnectedAppAuthError(status, code, message);
}

function epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomOpaqueToken(prefix: string): string {
  return `${prefix}${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pkceS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function requiredConfigValue(
  value: string | undefined,
  name: string,
  maxLength: number,
): string {
  const normalized = value?.trim() || "";
  if (!normalized || normalized.length > maxLength) {
    fail(503, "connected_app_misconfigured", `${name} is not configured`);
  }
  return normalized;
}

export function assertConnectedAppAuthEnabled(env: ConnectedAppEnv): void {
  if (env.CONNECTED_APP_AUTH_ENABLED !== "true") {
    fail(404, "connected_app_auth_disabled", "connected application authentication is disabled");
  }
}

function connectedAppConfig(env: ConnectedAppEnv): ConnectedAppConfig {
  assertConnectedAppAuthEnabled(env);
  const appBaseUrl = requiredConfigValue(env.APP_BASE_URL, "APP_BASE_URL", 2048);
  const redirectUri = requiredConfigValue(
    env.CONNECTED_APP_REDIRECT_URI,
    "CONNECTED_APP_REDIRECT_URI",
    1024,
  );
  let issuer: string;
  let parsedRedirect: URL;
  try {
    const parsedBase = new URL(appBaseUrl);
    parsedRedirect = new URL(redirectUri);
    issuer = parsedBase.origin;
    if (
      parsedBase.username
      || parsedBase.password
      || parsedBase.hash
      || parsedBase.search
      || (parsedBase.pathname !== "/" && parsedBase.pathname !== "")
    ) {
      fail(503, "connected_app_misconfigured", "APP_BASE_URL must be an HTTPS origin");
    }
  } catch {
    fail(503, "connected_app_misconfigured", "connected application URLs are invalid");
  }
  if (
    issuer === "null"
    || !issuer.startsWith("https://")
    || parsedRedirect.protocol !== "https:"
    || parsedRedirect.username
    || parsedRedirect.password
    || parsedRedirect.hash
    || ["code", "state", "iss", "error"].some((name) => parsedRedirect.searchParams.has(name))
  ) {
    fail(503, "connected_app_misconfigured", "connected application URLs are unsafe");
  }
  requiredConfigValue(env.JWT_SECRET, "JWT_SECRET", 512);
  if (
    requiredConfigValue(
      env.CONNECTED_APP_BACKCHANNEL_SECRET,
      "CONNECTED_APP_BACKCHANNEL_SECRET",
      512,
    ).length < 32
  ) {
    fail(
      503,
      "connected_app_misconfigured",
      "CONNECTED_APP_BACKCHANNEL_SECRET must contain at least 32 characters",
    );
  }
  return {
    clientId: requiredConfigValue(env.CONNECTED_APP_CLIENT_ID, "CONNECTED_APP_CLIENT_ID", 128),
    audience: requiredConfigValue(env.CONNECTED_APP_AUDIENCE, "CONNECTED_APP_AUDIENCE", 256),
    scope: requiredConfigValue(env.CONNECTED_APP_SCOPE, "CONNECTED_APP_SCOPE", 256),
    redirectUri,
    issuer,
    environment: requiredConfigValue(deployEnvironment(env), "ANALYTICS_ENVIRONMENT", 64),
  };
}

function exactParameter(url: URL, name: string, maxLength: number): string {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1 || !values[0] || values[0].length > maxLength) {
    fail(400, "invalid_request", `${name} must be provided exactly once`);
  }
  return values[0];
}

function parseAuthorizationRequest(url: URL, config: ConnectedAppConfig): AuthorizationRequest {
  for (const [name] of url.searchParams) {
    if (!AUTHORIZATION_PARAMETER_NAMES.has(name)) {
      fail(400, "invalid_request", `unsupported authorization parameter: ${name}`);
    }
  }
  const responseType = exactParameter(url, "response_type", 16);
  const clientId = exactParameter(url, "client_id", 128);
  const audience = exactParameter(url, "audience", 256);
  const scope = exactParameter(url, "scope", 256);
  const redirectUri = exactParameter(url, "redirect_uri", 1024);
  const issuer = exactParameter(url, "issuer", 2048);
  const environment = exactParameter(url, "environment", 64);
  const state = exactParameter(url, "state", 512);
  const codeChallenge = exactParameter(url, "code_challenge", 128);
  const codeChallengeMethod = exactParameter(url, "code_challenge_method", 16);

  if (
    responseType !== "code"
    || clientId !== config.clientId
    || audience !== config.audience
    || scope !== config.scope
    || redirectUri !== config.redirectUri
    || issuer !== config.issuer
    || environment !== config.environment
  ) {
    fail(400, "invalid_request", "authorization request does not match the configured application");
  }
  if (!STATE_PATTERN.test(state)) {
    fail(400, "invalid_request", "state must be an opaque value between 16 and 512 characters");
  }
  if (!PKCE_CHALLENGE_PATTERN.test(codeChallenge) || codeChallengeMethod !== "S256") {
    fail(400, "invalid_request", "PKCE S256 is required");
  }
  return {
    ...config,
    responseType: "code",
    state,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}

function authorizationQuery(input: AuthorizationRequest): string {
  const params = new URLSearchParams();
  params.set("response_type", input.responseType);
  params.set("client_id", input.clientId);
  params.set("audience", input.audience);
  params.set("scope", input.scope);
  params.set("redirect_uri", input.redirectUri);
  params.set("issuer", input.issuer);
  params.set("environment", input.environment);
  params.set("state", input.state);
  params.set("code_challenge", input.codeChallenge);
  params.set("code_challenge_method", input.codeChallengeMethod);
  const query = params.toString();
  if (new TextEncoder().encode(query).byteLength > MAX_RESUME_QUERY_BYTES) {
    fail(400, "invalid_request", "authorization request is too large");
  }
  return query;
}

function redirectResponse(location: string, cookies: string[] = []): Response {
  const headers = new Headers({
    location,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow",
  });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function resumeCookie(token: string): string {
  return `${RESUME_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${RESUME_COOKIE_TTL_SECONDS}`;
}

export function clearConnectedAppResumeCookie(): string {
  return `${RESUME_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function createResumeCookie(
  env: ConnectedAppEnv,
  input: AuthorizationRequest,
): Promise<string> {
  const token = await signJWT({
    purpose: "connected_app_authorize_resume",
    query: authorizationQuery(input),
    issuer: input.issuer,
    environment: input.environment,
    nonce: crypto.randomUUID(),
  }, env.JWT_SECRET, RESUME_COOKIE_TTL_SECONDS);
  return resumeCookie(token);
}

function readCookieValue(request: Request, name: string): string | null {
  try {
    return parseCookies(request.headers.get("cookie"))[name] || null;
  } catch {
    return null;
  }
}

async function readResumeRequest(
  request: Request,
  env: ConnectedAppEnv,
): Promise<AuthorizationRequest | null> {
  const token = readCookieValue(request, RESUME_COOKIE_NAME);
  if (!token || !env.JWT_SECRET) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (
    payload?.purpose !== "connected_app_authorize_resume"
    || typeof payload.query !== "string"
    || payload.query.length > MAX_RESUME_QUERY_BYTES
  ) {
    return null;
  }
  const config = connectedAppConfig(env);
  if (payload.issuer !== config.issuer || payload.environment !== config.environment) return null;
  return parseAuthorizationRequest(new URL(`/authorize?${payload.query}`, config.issuer), config);
}

export async function connectedAppLoginContinuation(
  request: Request,
  env: ConnectedAppEnv,
): Promise<string | null> {
  if (env.CONNECTED_APP_AUTH_ENABLED !== "true") return null;
  try {
    return await readResumeRequest(request, env) ? RESUME_PATH : null;
  } catch (error) {
    if (error instanceof ConnectedAppAuthError) return null;
    throw error;
  }
}

function requireTopLevelNavigation(request: Request, action: string): void {
  const fetchMode = request.headers.get("sec-fetch-mode");
  const fetchDestination = request.headers.get("sec-fetch-dest");
  if (
    (fetchMode && fetchMode !== "navigate")
    || (fetchDestination && fetchDestination !== "document")
  ) {
    fail(
      403,
      "browser_navigation_required",
      `${action} must use a top-level browser navigation`,
    );
  }
}

async function issueAuthorizationCode(
  env: ConnectedAppEnv,
  userId: string,
  input: AuthorizationRequest,
): Promise<Response> {
  const user = await env.DB.prepare("SELECT 1 AS present FROM users WHERE id=?1 LIMIT 1")
    .bind(userId)
    .first<{ present: number }>();
  if (!user) fail(401, "login_required", "login required");

  const code = randomOpaqueToken(AUTHORIZATION_CODE_PREFIX);
  const codeHash = await sha256Hex(code);
  const authorizationId = crypto.randomUUID();
  const now = epochSeconds();
  await env.DB.prepare(
    `INSERT INTO connected_app_authorization_codes
       (id, code_hash, user_id, client_id, audience, scope, redirect_uri, issuer, environment,
        code_challenge, code_challenge_method, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'S256', ?11, ?12)`,
  ).bind(
    authorizationId,
    codeHash,
    userId,
    input.clientId,
    input.audience,
    input.scope,
    input.redirectUri,
    input.issuer,
    input.environment,
    input.codeChallenge,
    now,
    now + AUTHORIZATION_CODE_TTL_SECONDS,
  ).run();

  const callback = new URL(input.redirectUri);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", input.state);
  callback.searchParams.set("iss", input.issuer);
  return redirectResponse(callback.toString());
}

export async function handleConnectedAppAuthorize(
  request: Request,
  env: ConnectedAppEnv,
  userId: string | null,
): Promise<Response> {
  requireTopLevelNavigation(request, "authorization");
  const config = connectedAppConfig(env);
  const input = parseAuthorizationRequest(new URL(request.url), config);
  if (userId) {
    const response = await issueAuthorizationCode(env, userId, input);
    response.headers.append("set-cookie", clearConnectedAppResumeCookie());
    return response;
  }

  const login = new URL("/mypage/", config.issuer);
  login.searchParams.set("next", RESUME_PATH);
  return redirectResponse(login.toString(), [await createResumeCookie(env, input)]);
}

export async function handleConnectedAppAuthorizeResume(
  request: Request,
  env: ConnectedAppEnv,
  userId: string | null,
): Promise<Response> {
  requireTopLevelNavigation(request, "authorization resume");
  const input = await readResumeRequest(request, env);
  if (!input) fail(400, "invalid_resume", "connected application login resume is invalid or expired");
  if (!userId) {
    const login = new URL("/mypage/", input.issuer);
    login.searchParams.set("next", RESUME_PATH);
    return redirectResponse(login.toString());
  }
  const response = await issueAuthorizationCode(env, userId, input);
  response.headers.append("set-cookie", clearConnectedAppResumeCookie());
  return response;
}

async function readJson(request: Request): Promise<JsonObject> {
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
    if (error instanceof ConnectedAppAuthError) throw error;
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

function bodyString(body: JsonObject, name: string, maxLength: number): string {
  const value = body[name];
  if (typeof value !== "string" || !value || value.length > maxLength) {
    fail(400, "invalid_request", `${name} is required`);
  }
  return value;
}

async function authenticateBackchannel(request: Request, env: ConnectedAppEnv): Promise<void> {
  const expected = env.CONNECTED_APP_BACKCHANNEL_SECRET || "";
  if (expected.length < 32) {
    fail(503, "connected_app_misconfigured", "connected application backchannel is not configured");
  }
  if (request.headers.has("origin")) {
    fail(403, "browser_request_not_allowed", "browser token exchange is not allowed");
  }
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer ([^\s]{32,512})$/);
  if (!match || !(await timingSafeEqual(match[1], expected))) {
    fail(401, "invalid_client", "backchannel authentication failed");
  }
}

function assertionFromRow(row: ConnectedAppCodeRow): ConnectedAppIdentityAssertion {
  return {
    issuer: row.issuer,
    subject: row.user_id,
    client_id: row.client_id,
    audience: row.audience,
    scope: row.scope,
    environment: row.environment,
    authorization_id: row.id,
    issued_at: row.consumed_at,
    expires_at: row.consumed_at + ASSERTION_TTL_SECONDS,
  };
}

export async function handleConnectedAppTokenRequest(
  request: Request,
  env: ConnectedAppEnv,
): Promise<ConnectedAppIdentityAssertion> {
  const config = connectedAppConfig(env);
  await authenticateBackchannel(request, env);
  const body = await readJson(request);
  const grantType = bodyString(body, "grant_type", 64);
  const code = bodyString(body, "code", 512);
  const verifier = bodyString(body, "code_verifier", 128);
  const exchangeId = bodyString(body, "exchange_id", 128);
  const clientId = bodyString(body, "client_id", 128);
  const audience = bodyString(body, "audience", 256);
  const scope = bodyString(body, "scope", 256);
  const redirectUri = bodyString(body, "redirect_uri", 1024);
  const issuer = bodyString(body, "issuer", 2048);
  const environment = bodyString(body, "environment", 64);
  if (
    grantType !== "authorization_code"
    || !code.startsWith(AUTHORIZATION_CODE_PREFIX)
    || !TOKEN_PATTERN.test(code)
    || !PKCE_VERIFIER_PATTERN.test(verifier)
    || !EXCHANGE_ID_PATTERN.test(exchangeId)
    || clientId !== config.clientId
    || audience !== config.audience
    || scope !== config.scope
    || redirectUri !== config.redirectUri
    || issuer !== config.issuer
    || environment !== config.environment
  ) {
    fail(400, "invalid_grant", "authorization code exchange is invalid");
  }

  const [codeHash, challenge, exchangeIdHash] = await Promise.all([
    sha256Hex(code),
    pkceS256(verifier),
    sha256Hex(exchangeId),
  ]);
  const now = epochSeconds();
  const consumeNonce = crypto.randomUUID();
  const selectSql = `
    SELECT id, user_id, client_id, audience, scope, redirect_uri, issuer, environment, consumed_at
    FROM connected_app_authorization_codes
    WHERE code_hash=?1
      AND exchange_id_hash=?2
      AND code_challenge=?3
      AND code_challenge_method='S256'
      AND client_id=?4
      AND audience=?5
      AND scope=?6
      AND redirect_uri=?7
      AND issuer=?8
      AND environment=?9
      AND consumed_at IS NOT NULL
      AND consumed_at + ?10 > ?11
    LIMIT 1`;

  try {
    const results = await env.DB.batch<ConnectedAppCodeRow>([
      env.DB.prepare(
        `UPDATE connected_app_authorization_codes
         SET consumed_at=?1, exchange_id_hash=?2, consume_nonce=?3
         WHERE code_hash=?4
           AND code_challenge=?5
           AND code_challenge_method='S256'
           AND client_id=?6
           AND audience=?7
           AND scope=?8
           AND redirect_uri=?9
           AND issuer=?10
           AND environment=?11
           AND consumed_at IS NULL
           AND expires_at>?1`,
      ).bind(
        now,
        exchangeIdHash,
        consumeNonce,
        codeHash,
        challenge,
        config.clientId,
        config.audience,
        config.scope,
        config.redirectUri,
        config.issuer,
        config.environment,
      ),
      env.DB.prepare(selectSql).bind(
        codeHash,
        exchangeIdHash,
        challenge,
        config.clientId,
        config.audience,
        config.scope,
        config.redirectUri,
        config.issuer,
        config.environment,
        ASSERTION_TTL_SECONDS,
        now,
      ),
    ]);
    const row = results[1].results[0];
    if (!row || (results[0].meta.changes !== 0 && results[0].meta.changes !== 1)) {
      fail(400, "invalid_grant", "authorization code is invalid, expired, or already used");
    }
    return assertionFromRow(row);
  } catch (error) {
    if (error instanceof ConnectedAppAuthError) throw error;
    // A concurrent retry can observe a UNIQUE constraint while the first
    // exchange commits. Only the exact same code, verifier and exchange ID is
    // allowed to recover the deterministic assertion.
    if (!String(error).toLowerCase().includes("unique constraint")) throw error;
    const row = await env.DB.prepare(selectSql).bind(
      codeHash,
      exchangeIdHash,
      challenge,
      config.clientId,
      config.audience,
      config.scope,
      config.redirectUri,
      config.issuer,
      config.environment,
      ASSERTION_TTL_SECONDS,
      now,
    ).first<ConnectedAppCodeRow>();
    if (row) return assertionFromRow(row);
    fail(400, "invalid_grant", "authorization code is invalid, expired, or already used");
  }
}

export const CONNECTED_APP_RESUME_PATH = RESUME_PATH;
