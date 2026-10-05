import type { Env } from "../../env";
import { encryptToken } from "../../core/auth/crypto";
import { saveOAuthIntegrationToken } from "../../integrations";
import { parseCookies, sessionCookie, signJWT, verifyJWT } from "../../core/auth/jwt";
import { sendTransactionalEmail } from "../../mail";
import { escapeHtml } from "../../html";
import { connectedAppLoginContinuation } from "./connectedAppAuth";

type OAuthProvider = "github" | "google" | "kakao" | "naver";
type OAuthIntent = "google_calendar" | "kakao_message" | "account_link";

interface OAuthProfile {
  provider: OAuthProvider;
  subject: string;
  login: string;
  email?: string | null;
  avatarUrl?: string | null;
}

const GITHUB_SCOPE = "read:user repo project";
const PASSWORD_ITERATIONS = 120_000;
const EMAIL_VERIFICATION_TTL_MS = 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_MAX_FAILED_ATTEMPTS = 3;
const AUTH_LOCK_MS = 15 * 60 * 1000;

const redirect = (loc: string, cookie?: string | string[]) => {
  const headers = new Headers({ location: loc });
  if (Array.isArray(cookie)) {
    for (const item of cookie) headers.append("set-cookie", item);
  } else if (cookie) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
};

const stateCookieName = (provider: OAuthProvider) => `oauth_state_${provider}`;
const intentCookieName = (provider: OAuthProvider) => `oauth_intent_${provider}`;

function oauthRedirectUri(env: Env, provider: OAuthProvider): string {
  if (provider === "github") return `${env.APP_BASE_URL}/api/auth/callback`;
  return `${env.APP_BASE_URL}/api/auth/${provider}/callback`;
}

function oauthStateCookie(provider: OAuthProvider, state: string): string {
  return `${stateCookieName(provider)}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

function oauthIntentCookie(provider: OAuthProvider, intent: OAuthIntent): string {
  return `${intentCookieName(provider)}=${intent}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

function clearOAuthState(provider: OAuthProvider): string {
  return `${stateCookieName(provider)}=; Path=/; Max-Age=0`;
}

function clearOAuthIntent(provider: OAuthProvider): string {
  return `${intentCookieName(provider)}=; Path=/; Max-Age=0`;
}

function readOAuthIntent(request: Request, provider: OAuthProvider): OAuthIntent | null {
  const intent = parseCookies(request.headers.get("cookie"))[intentCookieName(provider)];
  return intent === "google_calendar" || intent === "kakao_message" || intent === "account_link" ? intent : null;
}

async function currentSessionUserId(request: Request, env: Env): Promise<string | null> {
  const cookies = parseCookies(request.headers.get("cookie"));
  if (!cookies.sid || !env.JWT_SECRET) return null;
  const payload = await verifyJWT(cookies.sid, env.JWT_SECRET);
  return payload?.sub ? String(payload.sub) : null;
}

function readAndValidateState(request: Request, provider: OAuthProvider): { code: string; state: string } | Response {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(request.headers.get("cookie"));
  if (!code || !state || state !== cookies[stateCookieName(provider)]) {
    return new Response("OAuth state verification failed", { status: 400 });
  }
  return { code, state };
}

function formBody(data: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers || {}) },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function normalizeEmail(value: unknown): string {
  const email = String(value || "").trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("이메일 형식이 올바르지 않습니다."), { status: 400 });
  return email;
}

function normalizePassword(value: unknown): string {
  const password = String(value || "");
  if (password.length < 8) throw Object.assign(new Error("비밀번호는 8자 이상이어야 합니다."), { status: 400 });
  if (password.length > 200) throw Object.assign(new Error("비밀번호가 너무 깁니다."), { status: 400 });
  return password;
}

async function passwordHash(password: string, saltBytes?: Uint8Array): Promise<{ hash: string; salt: string }> {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return { hash: bytesToBase64(new Uint8Array(bits)), salt: bytesToBase64(salt) };
}

async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const actual = await passwordHash(password, base64ToBytes(salt));
  if (actual.hash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.hash.length; i++) diff |= actual.hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return diff === 0;
}

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return base64Url(new Uint8Array(digest));
}

function isoAfter(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function isFuture(value?: string | null): boolean {
  return !!value && Date.parse(value) > Date.now();
}

function authError(message: string, status: number, extra?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { status, ...(extra || {}) });
}

function assertNotLocked(lockedUntil?: string | null): void {
  if (!isFuture(lockedUntil)) return;
  const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(lockedUntil || "") - Date.now()) / 1000));
  throw authError("Too many failed attempts. Try again later.", 429, { retry_after_seconds: retryAfterSeconds });
}

function authLink(env: Env, param: "verify_email" | "reset_token", token: string): string {
  const url = new URL("/mypage/", env.APP_BASE_URL || "https://example.com");
  url.searchParams.set(param, token);
  return url.toString();
}

interface EmailCredentialRow {
  email: string;
  user_id: string;
  password_hash: string;
  salt: string;
  display_name: string | null;
  email_verified: number;
  verification_expires_at: string | null;
  verification_failed_count: number;
  verification_locked_until: string | null;
  reset_expires_at: string | null;
  reset_failed_count: number;
  reset_locked_until: string | null;
  login_failed_count: number;
  login_locked_until: string | null;
}

async function issueVerificationToken(env: Env, email: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const hash = await tokenHash(token);
  const ts = new Date().toISOString();
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();
  await env.DB.prepare(
    `UPDATE email_credentials
     SET verification_token_hash=?,
         verification_expires_at=?,
         verification_sent_at=?,
         verification_failed_count=0,
         verification_locked_until=NULL,
         updated_at=?
     WHERE email=?`
  ).bind(hash, expiresAt, ts, ts, email).run();
  return { token, expiresAt };
}

async function issueResetToken(env: Env, email: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const hash = await tokenHash(token);
  const ts = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
  await env.DB.prepare(
    `UPDATE email_credentials
     SET reset_token_hash=?,
         reset_expires_at=?,
         reset_sent_at=?,
         reset_failed_count=0,
         reset_locked_until=NULL,
         updated_at=?
     WHERE email=?`
  ).bind(hash, expiresAt, ts, ts, email).run();
  return { token, expiresAt };
}

async function sendVerificationEmail(env: Env, email: string, displayName: string, token: string, expiresAt: string): Promise<void> {
  const link = authLink(env, "verify_email", token);
  const text = [
    `Hello ${displayName || email},`,
    "",
    "Verify your Planning Harness email address with the link below.",
    link,
    "",
    `This verification link expires at ${expiresAt}.`,
  ].join("\n");
  const html = `<h1>Verify your email</h1><p>Hello ${escapeHtml(displayName || email)},</p><p><a href="${escapeHtml(link)}">Verify email address</a></p><p>This link expires at ${escapeHtml(expiresAt)}.</p>`;
  await sendTransactionalEmail(env, email, "[Planning Harness] Verify your email", text, html, [
    "planning-harness",
    "email-verification",
  ]);
}

async function sendResetEmail(env: Env, email: string, displayName: string, token: string, expiresAt: string): Promise<void> {
  const link = authLink(env, "reset_token", token);
  const text = [
    `Hello ${displayName || email},`,
    "",
    "Reset your Planning Harness password with the link below.",
    link,
    "",
    `This reset link expires at ${expiresAt}.`,
  ].join("\n");
  const html = `<h1>Reset your password</h1><p>Hello ${escapeHtml(displayName || email)},</p><p><a href="${escapeHtml(link)}">Reset password</a></p><p>This link expires at ${escapeHtml(expiresAt)}.</p>`;
  await sendTransactionalEmail(env, email, "[Planning Harness] Reset your password", text, html, [
    "planning-harness",
    "password-reset",
  ]);
}

async function recordLoginFailure(env: Env, email: string, currentCount: number): Promise<never> {
  const nextCount = currentCount + 1;
  const lockedUntil = nextCount >= AUTH_MAX_FAILED_ATTEMPTS ? isoAfter(AUTH_LOCK_MS) : null;
  await env.DB.prepare(
    `UPDATE email_credentials
     SET login_failed_count=?,
         login_locked_until=?,
         updated_at=?
     WHERE email=?`
  ).bind(nextCount, lockedUntil, new Date().toISOString(), email).run();
  throw authError(
    lockedUntil ? "Too many failed attempts. Try again later." : "Invalid email or password.",
    lockedUntil ? 429 : 401,
    lockedUntil ? { retry_after_seconds: Math.ceil(AUTH_LOCK_MS / 1000) } : undefined
  );
}

async function recordTokenFailure(
  env: Env,
  email: string,
  flow: "verification" | "reset",
  currentCount: number,
  message: string,
  status: number
): Promise<never> {
  const nextCount = currentCount + 1;
  const lockedUntil = nextCount >= AUTH_MAX_FAILED_ATTEMPTS ? isoAfter(AUTH_LOCK_MS) : null;
  const prefix = flow === "verification" ? "verification" : "reset";
  await env.DB.prepare(
    `UPDATE email_credentials
     SET ${prefix}_failed_count=?,
         ${prefix}_locked_until=?,
         updated_at=?
     WHERE email=?`
  ).bind(nextCount, lockedUntil, new Date().toISOString(), email).run();
  if (lockedUntil) {
    throw authError("Too many failed attempts. Try again later.", 429, { retry_after_seconds: Math.ceil(AUTH_LOCK_MS / 1000) });
  }
  throw authError(message, status);
}

async function claimAnonymousDevice(env: Env, request: Request, userId: string): Promise<void> {
  const aid = parseCookies(request.headers.get("cookie")).aid;
  if (!aid) return;
  const anonUserId = `anon:${aid}`;
  if (anonUserId === userId) return;
  const ts = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user_devices (device_id, user_id, first_seen_at, linked_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         user_id=excluded.user_id,
         linked_at=excluded.linked_at,
         last_seen_at=excluded.last_seen_at`
    ).bind(aid, userId, ts, ts, ts),
    env.DB.prepare("UPDATE usage_events SET user_id=? WHERE user_id=?").bind(userId, anonUserId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO usage_limits (user_id, daily_limit_krw, warn_threshold_krw, block_on_exceed, updated_at)
       SELECT ?, daily_limit_krw, warn_threshold_krw, block_on_exceed, ? FROM usage_limits WHERE user_id=?`
    ).bind(userId, ts, anonUserId),
    env.DB.prepare("DELETE FROM usage_limits WHERE user_id=?").bind(anonUserId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO usage_alerts (user_id, day, kind, threshold_krw, used_krw, created_at)
       SELECT ?, day, kind, threshold_krw, used_krw, created_at FROM usage_alerts WHERE user_id=?`
    ).bind(userId, anonUserId),
    env.DB.prepare("DELETE FROM usage_alerts WHERE user_id=?").bind(anonUserId),
    env.DB.prepare("UPDATE analysis_sessions SET user_id=? WHERE user_id=?").bind(userId, anonUserId),
    env.DB.prepare("UPDATE analysis_files SET user_id=? WHERE user_id=?").bind(userId, anonUserId),
    env.DB.prepare("UPDATE analysis_outputs SET user_id=? WHERE user_id=?").bind(userId, anonUserId),
    env.DB.prepare("UPDATE meetings SET user_id=? WHERE user_id=?").bind(userId, anonUserId),
    env.DB.prepare("UPDATE history_marks SET user_id=? WHERE user_id=?").bind(userId, anonUserId),
  ]);
}

async function upsertIdentity(env: Env, profile: OAuthProfile, accessToken?: string, scope?: string): Promise<void> {
  const now = new Date().toISOString();
  const userId = profile.provider === "github" ? `gh:${profile.subject}` : `${profile.provider}:${profile.subject}`;
  const login = profile.login || profile.email || `${profile.provider}:${profile.subject}`;

  if (profile.provider === "github") {
    const encToken = env.JWT_SECRET && accessToken ? await encryptToken(accessToken, env.JWT_SECRET) : null;
    await env.DB.prepare(
      `INSERT INTO users (id, github_login, github_id, gh_token, gh_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         github_login=excluded.github_login,
         gh_token=excluded.gh_token,
         gh_scope=excluded.gh_scope`
    ).bind(userId, login, Number(profile.subject), encToken, scope || GITHUB_SCOPE, now).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO users (id, github_login, github_id, created_at)
       VALUES (?, ?, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET github_login=excluded.github_login`
    ).bind(userId, login, now).run();
  }

  await env.DB.prepare(
    `INSERT INTO user_identities
       (provider, provider_subject, user_id, email, display_name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_subject) DO UPDATE SET
       user_id=excluded.user_id,
       email=excluded.email,
       display_name=excluded.display_name,
       avatar_url=excluded.avatar_url,
       updated_at=excluded.updated_at`
  ).bind(profile.provider, profile.subject, userId, profile.email || null, login, profile.avatarUrl || null, now, now).run();
}

async function linkedUserId(env: Env, profile: OAuthProfile): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT user_id FROM user_identities WHERE provider=? AND provider_subject=?"
  ).bind(profile.provider, profile.subject).first<{ user_id: string }>();
  return row?.user_id || null;
}

async function canonicalLoginForUser(env: Env, userId: string, fallback: string): Promise<string> {
  const github = await env.DB.prepare(
    "SELECT display_name FROM user_identities WHERE user_id=? AND provider='github' LIMIT 1"
  ).bind(userId).first<{ display_name: string | null }>();
  if (github?.display_name) return github.display_name;
  const user = await env.DB.prepare(
    "SELECT github_login FROM users WHERE id=?"
  ).bind(userId).first<{ github_login: string | null }>();
  return user?.github_login || fallback;
}

async function linkIdentityToCurrentUser(env: Env, request: Request, profile: OAuthProfile): Promise<string | null> {
  const userId = await currentSessionUserId(request, env);
  if (!userId) return null;
  const existing = await linkedUserId(env, profile);
  if (existing && existing !== userId) {
    // A provider may have been used once just to inspect the app, leaving an empty
    // account behind. Reattach only that empty identity; never discard real work.
    const activity = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM (
         SELECT id FROM meetings WHERE user_id=?
         UNION ALL SELECT id FROM analysis_sessions WHERE user_id=?
         UNION ALL SELECT id FROM kanban_boards WHERE user_id=?
       )`
    ).bind(existing, existing, existing).first<{ count: number }>();
    if (Number(activity?.count || 0) > 0) {
      throw Object.assign(new Error("이 로그인 계정은 이미 다른 계정에 연결되어 있습니다."), { status: 409 });
    }
    await env.DB.prepare(
      "UPDATE user_identities SET user_id=?, updated_at=? WHERE provider=? AND provider_subject=?"
    ).bind(userId, new Date().toISOString(), profile.provider, profile.subject).run();
  }
  if (!existing) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO user_identities
         (provider, provider_subject, user_id, email, display_name, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(profile.provider, profile.subject, userId, profile.email || null, profile.login, profile.avatarUrl || null, now, now).run();
  }
  return userId;
}

async function finishLogin(env: Env, request: Request, profile: OAuthProfile, accessToken?: string, scope?: string): Promise<Response> {
  const existingUserId = await linkedUserId(env, profile);
  if (!existingUserId || profile.provider === "github") await upsertIdentity(env, profile, accessToken, scope);
  const userId = existingUserId || (profile.provider === "github" ? `gh:${profile.subject}` : `${profile.provider}:${profile.subject}`);
  await claimAnonymousDevice(env, request, userId);
  const canonicalLogin = await canonicalLoginForUser(env, userId, profile.login);
  const jwt = await signJWT({ sub: userId, login: canonicalLogin }, env.JWT_SECRET);
  const analyticsAuth = existingUserId ? "login" : "sign_up";
  const continuation = await connectedAppLoginContinuation(request, env);
  const headers = new Headers({
    location: continuation || `/mypage/?analytics_auth=${analyticsAuth}&analytics_method=${encodeURIComponent(profile.provider)}`,
  });
  headers.append("set-cookie", sessionCookie(jwt));
  headers.append("set-cookie", clearOAuthState(profile.provider));
  headers.append("set-cookie", clearOAuthIntent(profile.provider));
  return new Response(null, { status: 302, headers });
}

async function finishAccountLink(env: Env, request: Request, profile: OAuthProfile, accessToken?: string, scope?: string): Promise<Response> {
  try {
    const userId = await linkIdentityToCurrentUser(env, request, profile);
    if (!userId) return redirect("/mypage/?account_link=login_required", [clearOAuthState(profile.provider), clearOAuthIntent(profile.provider)]);
    if (profile.provider === "github") {
      const encToken = env.JWT_SECRET && accessToken ? await encryptToken(accessToken, env.JWT_SECRET) : null;
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE users SET github_id=NULL, gh_token=NULL, gh_scope=NULL WHERE github_id=? AND id<>?"
        ).bind(Number(profile.subject), userId),
        env.DB.prepare(
          `UPDATE users SET github_login=?, github_id=?, gh_token=?, gh_scope=? WHERE id=?`
        ).bind(profile.login, Number(profile.subject), encToken, scope || GITHUB_SCOPE, userId),
      ]);
    }
    const canonicalLogin = await canonicalLoginForUser(env, userId, profile.login);
    const jwt = await signJWT({ sub: userId, login: canonicalLogin }, env.JWT_SECRET);
    return redirect("/mypage/?account_link=success", [sessionCookie(jwt), clearOAuthState(profile.provider), clearOAuthIntent(profile.provider)]);
  } catch (err: any) {
    return redirect(`/mypage/?account_link=${err?.status === 409 ? "already_linked" : "failed"}`, [clearOAuthState(profile.provider), clearOAuthIntent(profile.provider)]);
  }
}

async function finishJsonLogin(env: Env, request: Request, userId: string, login: string): Promise<Response> {
  await claimAnonymousDevice(env, request, userId);
  const jwt = await signJWT({ sub: userId, login }, env.JWT_SECRET);
  const next = await connectedAppLoginContinuation(request, env);
  return json(
    { ok: true, userId, login, ...(next ? { next } : {}) },
    { headers: { "set-cookie": sessionCookie(jwt) } },
  );
}

export function startGithubLogin(_request: Request, env: Env): Response {
  if (!env.GITHUB_OAUTH_CLIENT_ID) return new Response("GITHUB_OAUTH_CLIENT_ID is not configured", { status: 500 });
  const state = crypto.randomUUID();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", oauthRedirectUri(env, "github"));
  url.searchParams.set("scope", GITHUB_SCOPE);
  url.searchParams.set("state", state);
  return redirect(url.toString(), oauthStateCookie("github", state));
}

export async function startGithubAccountLink(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_OAUTH_CLIENT_ID) return new Response("GITHUB_OAUTH_CLIENT_ID is not configured", { status: 500 });
  if (!(await currentSessionUserId(request, env))) return redirect("/mypage/?account_link=login_required");
  const state = crypto.randomUUID();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", oauthRedirectUri(env, "github"));
  url.searchParams.set("scope", GITHUB_SCOPE);
  url.searchParams.set("state", state);
  return redirect(url.toString(), [oauthStateCookie("github", state), oauthIntentCookie("github", "account_link")]);
}

export async function handleGithubCallback(request: Request, env: Env): Promise<Response> {
  const checked = readAndValidateState(request, "github");
  if (checked instanceof Response) return checked;

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code: checked.code,
      redirect_uri: oauthRedirectUri(env, "github"),
    }),
  });
  const token = await tokenResponse.json() as { access_token?: string; scope?: string };
  if (!token.access_token) return new Response("GitHub token exchange failed", { status: 400 });

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${token.access_token}`,
      accept: "application/vnd.github+json",
      "user-agent": "harness-meeting-app",
    },
  });
  const user = await userResponse.json() as { id?: number; login?: string; avatar_url?: string; email?: string | null };
  if (!user.id) return new Response("GitHub profile request failed", { status: 400 });

  const loginProfile: OAuthProfile = {
    provider: "github",
    subject: String(user.id),
    login: user.login || `github:${user.id}`,
    email: user.email || null,
    avatarUrl: user.avatar_url || null,
  };
  if (readOAuthIntent(request, "github") === "account_link") {
    return finishAccountLink(env, request, loginProfile, token.access_token, token.scope || GITHUB_SCOPE);
  }
  return finishLogin(env, request, loginProfile, token.access_token, token.scope || GITHUB_SCOPE);
}

export function startGoogleLogin(_request: Request, env: Env): Response {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) return new Response("GOOGLE_OAUTH_CLIENT_ID is not configured", { status: 500 });
  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", oauthRedirectUri(env, "google"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);
  return redirect(url.toString(), oauthStateCookie("google", state));
}

export async function startGoogleAccountLink(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) return new Response("GOOGLE_OAUTH_CLIENT_ID is not configured", { status: 500 });
  if (!(await currentSessionUserId(request, env))) return redirect("/mypage/?account_link=login_required");
  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", oauthRedirectUri(env, "google"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);
  return redirect(url.toString(), [oauthStateCookie("google", state), oauthIntentCookie("google", "account_link")]);
}

export function startGoogleCalendarConnect(_request: Request, env: Env): Response {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) return new Response("GOOGLE_OAUTH_CLIENT_ID is not configured", { status: 500 });
  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", oauthRedirectUri(env, "google"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile https://www.googleapis.com/auth/calendar.events");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return redirect(url.toString(), [oauthStateCookie("google", state), oauthIntentCookie("google", "google_calendar")]);
}

export async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return new Response("Google OAuth is not configured", { status: 500 });
  }
  const checked = readAndValidateState(request, "google");
  if (checked instanceof Response) return checked;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: formBody({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      code: checked.code,
      redirect_uri: oauthRedirectUri(env, "google"),
      grant_type: "authorization_code",
    }),
  });
  const token = await tokenResponse.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
  if (!token.access_token) return new Response("Google token exchange failed", { status: 400 });

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
  });
  const profile = await profileResponse.json() as { sub?: string; email?: string; name?: string; picture?: string };
  if (!profile.sub) return new Response("Google profile request failed", { status: 400 });

  const loginProfile: OAuthProfile = {
    provider: "google",
    subject: profile.sub,
    login: profile.name || profile.email || `google:${profile.sub}`,
    email: profile.email || null,
    avatarUrl: profile.picture || null,
  };

  if (readOAuthIntent(request, "google") === "google_calendar") {
    const sessionUserId = await currentSessionUserId(request, env);
    if (!sessionUserId) {
      return redirect("/mypage/?next=%2Ftime-settings%2F", [clearOAuthState("google"), clearOAuthIntent("google")]);
    }
    await saveOAuthIntegrationToken(env, sessionUserId, "google_calendar", {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      scope: token.scope,
      tokenType: token.token_type,
      expiresIn: token.expires_in,
    });
    return redirect("/time-settings/?integration=google_calendar&status=connected", [clearOAuthState("google"), clearOAuthIntent("google")]);
  }
  if (readOAuthIntent(request, "google") === "account_link") return finishAccountLink(env, request, loginProfile);
  return finishLogin(env, request, loginProfile);
}

export function startKakaoLogin(_request: Request, env: Env): Response {
  if (!env.KAKAO_REST_API_KEY) return new Response("KAKAO_REST_API_KEY is not configured", { status: 500 });
  const state = crypto.randomUUID();
  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  url.searchParams.set("client_id", env.KAKAO_REST_API_KEY);
  url.searchParams.set("redirect_uri", oauthRedirectUri(env, "kakao"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return redirect(url.toString(), oauthStateCookie("kakao", state));
}

export async function startKakaoAccountLink(request: Request, env: Env): Promise<Response> {
  if (!env.KAKAO_REST_API_KEY) return new Response("KAKAO_REST_API_KEY is not configured", { status: 500 });
  if (!(await currentSessionUserId(request, env))) return redirect("/mypage/?account_link=login_required");
  const state = crypto.randomUUID();
  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  url.searchParams.set("client_id", env.KAKAO_REST_API_KEY);
  url.searchParams.set("redirect_uri", oauthRedirectUri(env, "kakao"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return redirect(url.toString(), [oauthStateCookie("kakao", state), oauthIntentCookie("kakao", "account_link")]);
}

export function startKakaoMessageConnect(_request: Request, env: Env): Response {
  if (!env.KAKAO_REST_API_KEY) return new Response("KAKAO_REST_API_KEY is not configured", { status: 500 });
  const state = crypto.randomUUID();
  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  url.searchParams.set("client_id", env.KAKAO_REST_API_KEY);
  url.searchParams.set("redirect_uri", oauthRedirectUri(env, "kakao"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "talk_message");
  url.searchParams.set("state", state);
  return redirect(url.toString(), [oauthStateCookie("kakao", state), oauthIntentCookie("kakao", "kakao_message")]);
}

export async function handleKakaoCallback(request: Request, env: Env): Promise<Response> {
  if (!env.KAKAO_REST_API_KEY) return new Response("Kakao OAuth is not configured", { status: 500 });
  const checked = readAndValidateState(request, "kakao");
  if (checked instanceof Response) return checked;

  const tokenResponse = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: formBody({
      grant_type: "authorization_code",
      client_id: env.KAKAO_REST_API_KEY,
      client_secret: env.KAKAO_CLIENT_SECRET,
      redirect_uri: oauthRedirectUri(env, "kakao"),
      code: checked.code,
    }),
  });
  const token = await tokenResponse.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
  if (!token.access_token) return new Response("Kakao token exchange failed", { status: 400 });

  const profileResponse = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
  });
  const profile = await profileResponse.json() as {
    id?: number | string;
    kakao_account?: { email?: string; profile?: { nickname?: string; profile_image_url?: string } };
    properties?: { nickname?: string; profile_image?: string };
  };
  if (!profile.id) return new Response("Kakao profile request failed", { status: 400 });
  const account = profile.kakao_account || {};
  const kakaoProfile = account.profile || {};
  const loginProfile: OAuthProfile = {
    provider: "kakao",
    subject: String(profile.id),
    login: kakaoProfile.nickname || profile.properties?.nickname || account.email || `kakao:${profile.id}`,
    email: account.email || null,
    avatarUrl: kakaoProfile.profile_image_url || profile.properties?.profile_image || null,
  };

  if (readOAuthIntent(request, "kakao") === "kakao_message") {
    const sessionUserId = await currentSessionUserId(request, env);
    if (!sessionUserId) {
      return redirect("/mypage/?next=%2Ftime-settings%2F", [clearOAuthState("kakao"), clearOAuthIntent("kakao")]);
    }
    await saveOAuthIntegrationToken(env, sessionUserId, "kakao_message", {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      scope: token.scope,
      tokenType: token.token_type,
      expiresIn: token.expires_in,
    });
    return redirect("/time-settings/?integration=kakao_message&status=connected", [clearOAuthState("kakao"), clearOAuthIntent("kakao")]);
  }
  if (readOAuthIntent(request, "kakao") === "account_link") return finishAccountLink(env, request, loginProfile);
  return finishLogin(env, request, loginProfile);
}

export function startNaverLogin(_request: Request, env: Env): Response {
  if (!env.NAVER_OAUTH_CLIENT_ID) return new Response("NAVER_OAUTH_CLIENT_ID is not configured", { status: 500 });
  const state = crypto.randomUUID();
  const url = new URL("https://nid.naver.com/oauth2.0/authorize");
  url.searchParams.set("client_id", env.NAVER_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", oauthRedirectUri(env, "naver"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return redirect(url.toString(), oauthStateCookie("naver", state));
}

export async function startNaverAccountLink(request: Request, env: Env): Promise<Response> {
  if (!env.NAVER_OAUTH_CLIENT_ID) return new Response("NAVER_OAUTH_CLIENT_ID is not configured", { status: 500 });
  if (!(await currentSessionUserId(request, env))) return redirect("/mypage/?account_link=login_required");
  const state = crypto.randomUUID();
  const url = new URL("https://nid.naver.com/oauth2.0/authorize");
  url.searchParams.set("client_id", env.NAVER_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", oauthRedirectUri(env, "naver"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return redirect(url.toString(), [oauthStateCookie("naver", state), oauthIntentCookie("naver", "account_link")]);
}

export async function handleNaverCallback(request: Request, env: Env): Promise<Response> {
  if (!env.NAVER_OAUTH_CLIENT_ID || !env.NAVER_OAUTH_CLIENT_SECRET) {
    return new Response("Naver OAuth is not configured", { status: 500 });
  }
  const checked = readAndValidateState(request, "naver");
  if (checked instanceof Response) return checked;

  // Naver 토큰 교환은 redirect_uri 대신 state 를 필수로 요구한다.
  const tokenResponse = await fetch("https://nid.naver.com/oauth2.0/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: formBody({
      grant_type: "authorization_code",
      client_id: env.NAVER_OAUTH_CLIENT_ID,
      client_secret: env.NAVER_OAUTH_CLIENT_SECRET,
      code: checked.code,
      state: checked.state,
    }),
  });
  const token = await tokenResponse.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
  };
  if (!token.access_token) return new Response("Naver token exchange failed", { status: 400 });

  // 프로필은 response 객체 안에 담겨 온다. 안정 식별자는 response.id.
  const profileResponse = await fetch("https://openapi.naver.com/v1/nid/me", {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
  });
  const profile = await profileResponse.json() as {
    resultcode?: string;
    message?: string;
    response?: { id?: string; nickname?: string; name?: string; email?: string; profile_image?: string };
  };
  const naverProfile = profile.response;
  if (!naverProfile?.id) return new Response("Naver profile request failed", { status: 400 });
  // 이름·이메일·프로필사진은 사용자가 제공에 동의한 경우에만 채운다(미제공 시 최소 identity).
  const loginProfile: OAuthProfile = {
    provider: "naver",
    subject: String(naverProfile.id),
    login: naverProfile.nickname || naverProfile.name || naverProfile.email || `naver:${naverProfile.id}`,
    email: naverProfile.email || null,
    avatarUrl: naverProfile.profile_image || null,
  };

  if (readOAuthIntent(request, "naver") === "account_link") return finishAccountLink(env, request, loginProfile);
  return finishLogin(env, request, loginProfile);
}

export async function registerEmail(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);
  const displayName = String(body.display_name || email.split("@")[0]).trim().slice(0, 80) || email;
  const existing = await env.DB.prepare(
    "SELECT email, user_id, email_verified FROM email_credentials WHERE email=?"
  ).bind(email).first<{ email: string; user_id: string; email_verified: number }>();
  if (existing?.email_verified === 1) throw authError("This email is already registered.", 409);

  const hashed = await passwordHash(password);
  const ts = new Date().toISOString();

  if (existing) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE email_credentials
         SET password_hash=?,
             salt=?,
             display_name=?,
             updated_at=?
         WHERE email=?`
      ).bind(hashed.hash, hashed.salt, displayName, ts, email),
      env.DB.prepare("UPDATE users SET github_login=? WHERE id=?").bind(displayName, existing.user_id),
      env.DB.prepare(
        `UPDATE user_identities
         SET email=?,
             display_name=?,
             updated_at=?
         WHERE provider='email' AND provider_subject=?`
      ).bind(email, displayName, ts, email),
    ]);
    const issued = await issueVerificationToken(env, email);
    await sendVerificationEmail(env, email, displayName, issued.token, issued.expiresAt);
    return json({ ok: true, verification_required: true, expires_at: issued.expiresAt });
  }

  const userId = `email:${crypto.randomUUID()}`;
  const token = randomToken();
  const digest = await tokenHash(token);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, github_login, github_id, created_at) VALUES (?, ?, NULL, ?)"
    ).bind(userId, displayName, ts),
    env.DB.prepare(
      `INSERT INTO email_credentials (
         email, user_id, password_hash, salt, display_name, created_at, updated_at,
         email_verified, verification_token_hash, verification_expires_at, verification_sent_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).bind(email, userId, hashed.hash, hashed.salt, displayName, ts, ts, digest, expiresAt, ts),
    env.DB.prepare(
      `INSERT INTO user_identities
         (provider, provider_subject, user_id, email, display_name, avatar_url, created_at, updated_at)
       VALUES ('email', ?, ?, ?, ?, NULL, ?, ?)`
    ).bind(email, userId, email, displayName, ts, ts),
  ]);
  await sendVerificationEmail(env, email, displayName, token, expiresAt);
  return json({ ok: true, verification_required: true, expires_at: expiresAt });
}

export async function loginEmail(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const row = await env.DB.prepare(
    `SELECT email, user_id, password_hash, salt, display_name, email_verified,
            verification_expires_at, verification_failed_count, verification_locked_until,
            reset_expires_at, reset_failed_count, reset_locked_until,
            login_failed_count, login_locked_until
     FROM email_credentials WHERE email=?`
  ).bind(email).first<EmailCredentialRow>();
  if (!row) throw authError("Invalid email or password.", 401);
  assertNotLocked(row.login_locked_until);
  if (!(await verifyPassword(password, row.salt, row.password_hash))) {
    return recordLoginFailure(env, email, Number(row.login_failed_count) || 0);
  }
  if (row.email_verified !== 1) {
    const issued = await issueVerificationToken(env, email);
    await sendVerificationEmail(env, email, row.display_name || email.split("@")[0], issued.token, issued.expiresAt);
    return json({ ok: false, verification_required: true, expires_at: issued.expiresAt, error: "Email verification is required." }, { status: 403 });
  }
  const login = row.display_name || email.split("@")[0];
  const ts = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE email_credentials
     SET login_failed_count=0,
         login_locked_until=NULL,
         last_login_at=?,
         updated_at=?
     WHERE email=?`
  ).bind(ts, ts, email).run();
  return finishJsonLogin(env, request, row.user_id, login);
}

export async function verifyEmail(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const token = String(body.token || "").trim();
  if (!token) throw authError("Verification token is required.", 400);
  const digest = await tokenHash(token);
  const row = await env.DB.prepare(
    `SELECT email, user_id, password_hash, salt, display_name, email_verified,
            verification_expires_at, verification_failed_count, verification_locked_until,
            reset_expires_at, reset_failed_count, reset_locked_until,
            login_failed_count, login_locked_until
     FROM email_credentials WHERE verification_token_hash=?`
  ).bind(digest).first<EmailCredentialRow>();
  if (!row) throw authError("Invalid or expired verification token.", 400);
  assertNotLocked(row.verification_locked_until);
  if (!row.verification_expires_at || Date.parse(row.verification_expires_at) < Date.now()) {
    return recordTokenFailure(env, row.email, "verification", Number(row.verification_failed_count) || 0, "Verification token expired.", 410);
  }
  const ts = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE email_credentials
     SET email_verified=1,
         verification_token_hash=NULL,
         verification_expires_at=NULL,
         verification_failed_count=0,
         verification_locked_until=NULL,
         login_failed_count=0,
         login_locked_until=NULL,
         last_login_at=?,
         updated_at=?
     WHERE email=?`
  ).bind(ts, ts, row.email).run();
  return finishJsonLogin(env, request, row.user_id, row.display_name || row.email.split("@")[0]);
}

export async function resendVerificationEmail(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const row = await env.DB.prepare(
    "SELECT email, display_name, email_verified FROM email_credentials WHERE email=?"
  ).bind(email).first<{ email: string; display_name: string | null; email_verified: number }>();
  if (row && row.email_verified !== 1) {
    const issued = await issueVerificationToken(env, email);
    await sendVerificationEmail(env, email, row.display_name || email.split("@")[0], issued.token, issued.expiresAt);
    return json({ ok: true, verification_required: true, expires_at: issued.expiresAt });
  }
  return json({ ok: true });
}

export async function requestPasswordReset(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const row = await env.DB.prepare(
    "SELECT email, display_name FROM email_credentials WHERE email=?"
  ).bind(email).first<{ email: string; display_name: string | null }>();
  if (row) {
    try {
      const issued = await issueResetToken(env, email);
      await sendResetEmail(env, email, row.display_name || email.split("@")[0], issued.token, issued.expiresAt);
    } catch {
      // Return a consistent response to avoid account enumeration.
    }
  }
  return json({ ok: true });
}

export async function confirmPasswordReset(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const token = String(body.token || "").trim();
  const password = normalizePassword(body.password);
  if (!token) throw authError("Reset token is required.", 400);
  const digest = await tokenHash(token);
  const row = await env.DB.prepare(
    `SELECT email, user_id, password_hash, salt, display_name, email_verified,
            verification_expires_at, verification_failed_count, verification_locked_until,
            reset_expires_at, reset_failed_count, reset_locked_until,
            login_failed_count, login_locked_until
     FROM email_credentials WHERE reset_token_hash=?`
  ).bind(digest).first<EmailCredentialRow>();
  if (!row) throw authError("Invalid or expired reset token.", 400);
  assertNotLocked(row.reset_locked_until);
  if (!row.reset_expires_at || Date.parse(row.reset_expires_at) < Date.now()) {
    return recordTokenFailure(env, row.email, "reset", Number(row.reset_failed_count) || 0, "Reset token expired.", 410);
  }
  const hashed = await passwordHash(password);
  const ts = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE email_credentials
     SET password_hash=?,
         salt=?,
         email_verified=1,
         reset_token_hash=NULL,
         reset_expires_at=NULL,
         reset_failed_count=0,
         reset_locked_until=NULL,
         login_failed_count=0,
         login_locked_until=NULL,
         last_login_at=?,
         updated_at=?
     WHERE email=?`
  ).bind(hashed.hash, hashed.salt, ts, ts, row.email).run();
  return finishJsonLogin(env, request, row.user_id, row.display_name || row.email.split("@")[0]);
}

export function logout(): Response {
  return redirect("/", "sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
}
