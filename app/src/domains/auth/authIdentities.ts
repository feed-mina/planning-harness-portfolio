// 소셜 계정(GitHub/Google/Kakao/Naver) 연결 해제(unlink).
// link(INSERT)는 auth.ts의 linkIdentityToCurrentUser, unlink(DELETE)는 이 모듈이 담당한다.
//
// 토큰 저장 현황(코드 조사 결과, 이슈에도 기록):
// - GitHub: 로그인/계정연결 시 항상 users.gh_token(암호화)에 저장됨 → 실제 revoke 가능.
// - Google/Kakao: "로그인"만으로는 토큰을 저장하지 않는다. 별도 통합(캘린더/카카오 메시지,
//   integrations.ts)을 연결한 사용자만 integration_tokens에 토큰이 있어 그걸 재사용해 revoke 시도.
// - Naver: 로그인 토큰을 저장하는 경로 자체가 없어 현재 아키텍처로는 외부 revoke가 항상 불가능.
// 저장된 토큰이 없는 경우는 "실패"가 아니라 "not_applicable"로 구분해, 되돌릴 게 없는데도
// provider_revoke_failed로 잘못 표시되지 않게 한다.
import type { Env } from "../../env";
import { decryptToken, encryptToken } from "../../core/auth/crypto";
import { parseCookies } from "../../core/auth/jwt";

export class IdentityUnlinkError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const PROVIDERS = new Set(["github", "google", "kakao", "naver"]);
type Provider = "github" | "google" | "kakao" | "naver";
type RevokeStatus = "revoked" | "not_applicable" | "failed";

const MAX_REVOKE_ATTEMPTS = 5;

function isProvider(value: string): value is Provider {
  return PROVIDERS.has(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isFuture(value?: string | null): boolean {
  return !!value && Date.parse(value) > Date.now();
}

async function hasValidEmailLogin(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT password_hash, email_verified, login_locked_until FROM email_credentials WHERE user_id=?`,
  ).bind(userId).first<{ password_hash: string | null; email_verified: number; login_locked_until: string | null }>();
  if (!row || !row.password_hash) return false;
  if (row.email_verified !== 1) return false;
  if (isFuture(row.login_locked_until)) return false;
  return true;
}

export async function getIdentitySummary(env: Env, userId: string) {
  const identities = (await env.DB.prepare(
    `SELECT provider, display_name FROM user_identities WHERE user_id=? ORDER BY provider`,
  ).bind(userId).all<{ provider: string; display_name: string | null }>()).results || [];
  const emailLoginAvailable = await hasValidEmailLogin(env, userId);
  return { identities, email_login_available: emailLoginAvailable };
}

// ---- provider별 외부 토큰 폐기 ----

async function revokeGithubToken(env: Env, token: string): Promise<boolean> {
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET) return false;
  try {
    const basic = btoa(`${env.GITHUB_OAUTH_CLIENT_ID}:${env.GITHUB_OAUTH_CLIENT_SECRET}`);
    const response = await fetch(`https://api.github.com/applications/${env.GITHUB_OAUTH_CLIENT_ID}/token`, {
      method: "DELETE",
      headers: {
        authorization: `Basic ${basic}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "harness-meeting-app",
      },
      body: JSON.stringify({ access_token: token }),
    });
    // 404 = GitHub이 이미 무효로 보는 토큰 — 폐기 목적은 이미 달성된 상태이므로 성공으로 본다.
    return response.status === 204 || response.status === 404;
  } catch {
    return false;
  }
}

async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `token=${encodeURIComponent(token)}`,
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function revokeKakaoToken(token: string): Promise<boolean> {
  try {
    const response = await fetch("https://kapi.kakao.com/v1/user/unlink", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function revokeNaverToken(env: Env, token: string): Promise<boolean> {
  if (!env.NAVER_OAUTH_CLIENT_ID || !env.NAVER_OAUTH_CLIENT_SECRET) return false;
  try {
    const url = new URL("https://nid.naver.com/oauth2.0/token");
    url.searchParams.set("grant_type", "delete");
    url.searchParams.set("client_id", env.NAVER_OAUTH_CLIENT_ID);
    url.searchParams.set("client_secret", env.NAVER_OAUTH_CLIENT_SECRET);
    url.searchParams.set("access_token", token);
    url.searchParams.set("service_provider", "NAVER");
    const response = await fetch(url.toString());
    if (!response.ok) return false;
    const data = await response.json().catch(() => ({})) as { result?: string };
    return data.result === "success";
  } catch {
    return false;
  }
}

async function revokeByProvider(env: Env, provider: Provider, token: string): Promise<boolean> {
  if (provider === "github") return revokeGithubToken(env, token);
  if (provider === "google") return revokeGoogleToken(token);
  if (provider === "kakao") return revokeKakaoToken(token);
  return revokeNaverToken(env, token);
}

async function findRevocableToken(env: Env, userId: string, provider: Provider): Promise<string | null> {
  if (!env.JWT_SECRET) return null;
  if (provider === "github") {
    const row = await env.DB.prepare(`SELECT gh_token FROM users WHERE id=?`).bind(userId).first<{ gh_token: string | null }>();
    return row?.gh_token ? decryptToken(row.gh_token, env.JWT_SECRET) : null;
  }
  // 로그인만으로는 google/kakao 토큰을 저장하지 않는다. 사용자가 별도로 캘린더/카카오 메시지
  // 통합을 연결했을 때만 integration_tokens에 남아 있어 재사용할 수 있다. naver는 저장 경로가 없다.
  const integrationProvider = provider === "google" ? "google_calendar" : provider === "kakao" ? "kakao_message" : null;
  if (!integrationProvider) return null;
  const row = await env.DB.prepare(
    `SELECT access_token_enc, refresh_token_enc FROM integration_tokens WHERE user_id=? AND provider=?`,
  ).bind(userId, integrationProvider).first<{ access_token_enc: string | null; refresh_token_enc: string | null }>();
  const enc = row?.access_token_enc || row?.refresh_token_enc;
  return enc ? decryptToken(enc, env.JWT_SECRET) : null;
}

async function attemptExternalRevoke(
  env: Env,
  userId: string,
  provider: Provider,
): Promise<{ status: RevokeStatus; token?: string }> {
  const token = await findRevocableToken(env, userId, provider);
  if (!token) return { status: "not_applicable" };
  const ok = await revokeByProvider(env, provider, token);
  return ok ? { status: "revoked" } : { status: "failed", token };
}

async function recordUnlinkAudit(env: Env, request: Request, info: {
  userId: string;
  provider: Provider;
  providerSubject: string;
  localDeleteOk: boolean;
  externalRevokeStatus: RevokeStatus;
  failureCode: string | null;
}): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") || null;
  const cookies = parseCookies(request.headers.get("cookie"));
  const sessionIdHash = cookies.sid ? await sha256Hex(cookies.sid) : null;
  await env.DB.prepare(
    `INSERT INTO identity_unlink_audit
       (id, user_id, provider, provider_subject, occurred_at, local_delete_ok, external_revoke_status, failure_code, ip, session_id_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    info.userId,
    info.provider,
    info.providerSubject,
    new Date().toISOString(),
    info.localDeleteOk ? 1 : 0,
    info.externalRevokeStatus,
    info.failureCode,
    ip,
    sessionIdHash,
  ).run();
}

export async function unlinkIdentity(
  env: Env,
  request: Request,
  userId: string,
  providerRaw: string,
): Promise<{ ok: true; provider: Provider; token_revoked: boolean; revoke_status: RevokeStatus }> {
  if (!isProvider(providerRaw)) {
    throw new IdentityUnlinkError(400, "지원하지 않는 provider입니다.", "unsupported_provider");
  }
  const provider = providerRaw;

  const identity = await env.DB.prepare(
    `SELECT provider_subject FROM user_identities WHERE user_id=? AND provider=?`,
  ).bind(userId, provider).first<{ provider_subject: string }>();
  if (!identity) {
    throw new IdentityUnlinkError(404, "연결된 계정을 찾을 수 없습니다.", "identity_not_found");
  }

  const otherIdentity = await env.DB.prepare(
    `SELECT 1 FROM user_identities WHERE user_id=? AND provider<>? LIMIT 1`,
  ).bind(userId, provider).first();
  if (!otherIdentity && !(await hasValidEmailLogin(env, userId))) {
    throw new IdentityUnlinkError(409, "다른 로그인 방법을 먼저 연결해 주세요.", "last_login_method");
  }

  const revoke = await attemptExternalRevoke(env, userId, provider);

  const deleteResult = await env.DB.prepare(
    `DELETE FROM user_identities WHERE user_id=? AND provider=?`,
  ).bind(userId, provider).run();
  const localDeleteOk = (deleteResult.meta?.changes || 0) > 0;
  if (!localDeleteOk) {
    // 조회와 삭제 사이에 이미 지워진 경쟁 상태 — 성공 처리하지 않는다(스펙 요구사항 6).
    throw new IdentityUnlinkError(404, "연결된 계정을 찾을 수 없습니다.", "identity_not_found");
  }

  if (provider === "github") {
    await env.DB.prepare(
      `UPDATE users SET github_id=NULL, gh_token=NULL, gh_scope=NULL WHERE id=?`,
    ).bind(userId).run();
  }

  if (revoke.status === "failed" && revoke.token && env.JWT_SECRET) {
    const tokenEnc = await encryptToken(revoke.token, env.JWT_SECRET);
    const ts = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO identity_revoke_pending (id, user_id, provider, token_enc, attempts, created_at, last_attempt_at, resolved_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, NULL)`,
    ).bind(crypto.randomUUID(), userId, provider, tokenEnc, ts, ts).run();
  }

  await recordUnlinkAudit(env, request, {
    userId,
    provider,
    providerSubject: identity.provider_subject,
    localDeleteOk,
    externalRevokeStatus: revoke.status,
    failureCode: revoke.status === "failed" ? "provider_revoke_failed" : null,
  });

  return { ok: true, provider, token_revoked: revoke.status === "revoked", revoke_status: revoke.status };
}

export async function processPendingIdentityRevocations(env: Env): Promise<{ retried: number; resolved: number }> {
  if (!env.JWT_SECRET) return { retried: 0, resolved: 0 };
  const rows = (await env.DB.prepare(
    `SELECT id, user_id, provider, token_enc FROM identity_revoke_pending
      WHERE resolved_at IS NULL AND attempts < ?`,
  ).bind(MAX_REVOKE_ATTEMPTS).all<{ id: string; user_id: string; provider: Provider; token_enc: string }>()).results || [];

  let retried = 0;
  let resolved = 0;
  for (const row of rows) {
    retried += 1;
    const ts = new Date().toISOString();
    const token = await decryptToken(row.token_enc, env.JWT_SECRET);
    const ok = token ? await revokeByProvider(env, row.provider, token) : false;
    if (ok) {
      await env.DB.prepare(
        `UPDATE identity_revoke_pending SET resolved_at=?, last_attempt_at=? WHERE id=?`,
      ).bind(ts, ts, row.id).run();
      resolved += 1;
    } else {
      await env.DB.prepare(
        `UPDATE identity_revoke_pending SET attempts=attempts+1, last_attempt_at=? WHERE id=?`,
      ).bind(ts, row.id).run();
    }
  }
  return { retried, resolved };
}
