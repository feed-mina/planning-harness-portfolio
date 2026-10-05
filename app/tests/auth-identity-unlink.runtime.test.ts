// 소셜 계정(GitHub/Google/Kakao/Naver) 연결 해제 통합 테스트 (#221).
// 실제 HTTP 라우트(worker.fetch)를 통해 DELETE /api/auth/identities/{provider}를 검증한다.
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { signJWT, encryptToken } from "../src/core/auth";
import { processPendingIdentityRevocations } from "../src/domains/auth";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const workerEnv = env as unknown as Env;
const executionContext = {} as ExecutionContext;
const JWT_SECRET = "auth-unlink-test-secret";
const GITHUB_CLIENT_ID = "test-github-client-id";
const GITHUB_CLIENT_SECRET = "test-github-client-secret";

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...workerEnv,
    JWT_SECRET,
    GITHUB_OAUTH_CLIENT_ID: GITHUB_CLIENT_ID,
    GITHUB_OAUTH_CLIENT_SECRET: GITHUB_CLIENT_SECRET,
    ...overrides,
  };
}

async function addUser(userId: string): Promise<void> {
  const ts = new Date().toISOString();
  await workerEnv.DB.prepare(
    "INSERT INTO users (id, github_login, github_id, created_at) VALUES (?1, ?2, NULL, ?3)",
  ).bind(userId, userId, ts).run();
}

async function addIdentity(userId: string, provider: string, subject: string, displayName?: string): Promise<void> {
  const ts = new Date().toISOString();
  await workerEnv.DB.prepare(
    `INSERT INTO user_identities (provider, provider_subject, user_id, email, display_name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, NULL, ?, ?)`,
  ).bind(provider, subject, userId, displayName || `${provider}-name`, ts, ts).run();
}

async function setGithubToken(userId: string, rawToken: string): Promise<void> {
  const enc = await encryptToken(rawToken, JWT_SECRET);
  await workerEnv.DB.prepare(
    "UPDATE users SET github_id=?, gh_token=?, gh_scope=? WHERE id=?",
  ).bind(12345, enc, "read:user", userId).run();
}

async function addIntegrationToken(userId: string, provider: "google_calendar" | "kakao_message", rawToken: string): Promise<void> {
  const enc = await encryptToken(rawToken, JWT_SECRET);
  const ts = new Date().toISOString();
  await workerEnv.DB.prepare(
    `INSERT INTO integration_tokens (id, user_id, provider, access_token_enc, refresh_token_enc, scope, token_type, expires_at, connected_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, 'Bearer', NULL, ?, ?)`,
  ).bind(crypto.randomUUID(), userId, provider, enc, ts, ts).run();
}

async function addValidEmailLogin(userId: string, email: string): Promise<void> {
  const ts = new Date().toISOString();
  await workerEnv.DB.prepare(
    `INSERT INTO email_credentials (email, user_id, password_hash, salt, display_name, email_verified, login_locked_until, created_at, updated_at)
     VALUES (?, ?, 'hash', 'salt', ?, 1, NULL, ?, ?)`,
  ).bind(email, userId, email, ts, ts).run();
}

async function addUnverifiedEmailLogin(userId: string, email: string): Promise<void> {
  const ts = new Date().toISOString();
  await workerEnv.DB.prepare(
    `INSERT INTO email_credentials (email, user_id, password_hash, salt, display_name, email_verified, login_locked_until, created_at, updated_at)
     VALUES (?, ?, 'hash', 'salt', ?, 0, NULL, ?, ?)`,
  ).bind(email, userId, email, ts, ts).run();
}

async function sidCookie(userId: string): Promise<string> {
  const jwt = await signJWT({ sub: userId, login: userId }, JWT_SECRET);
  return `sid=${jwt}`;
}

async function deleteIdentity(provider: string, cookie: string | null, envOverride?: Env) {
  return worker.fetch(new Request(`https://example.test/api/auth/identities/${provider}`, {
    method: "DELETE",
    headers: cookie ? { cookie } : {},
  }), envOverride || testEnv(), executionContext);
}

async function identityRow(userId: string, provider: string) {
  return workerEnv.DB.prepare(
    "SELECT * FROM user_identities WHERE user_id=? AND provider=?",
  ).bind(userId, provider).first();
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await workerEnv.DB.prepare("DELETE FROM user_identities").run();
  await workerEnv.DB.prepare("DELETE FROM users").run();
  await workerEnv.DB.prepare("DELETE FROM email_credentials").run();
  await workerEnv.DB.prepare("DELETE FROM integration_tokens").run();
  await workerEnv.DB.prepare("DELETE FROM identity_unlink_audit").run();
  await workerEnv.DB.prepare("DELETE FROM identity_revoke_pending").run();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DELETE /api/auth/identities/{provider}", () => {
  it("정상 해제: 200 ok:true, 해당 provider의 user_identities 행이 삭제된다", async () => {
    const userId = "google:unlink-1";
    await addUser(userId);
    await addIdentity(userId, "google", "g-1");
    await addIdentity(userId, "kakao", "k-1"); // 마지막 수단 방지에 걸리지 않도록 다른 identity 하나 더

    const res = await deleteIdentity("google", await sidCookie(userId));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; provider: string };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("google");
    expect(await identityRow(userId, "google")).toBeNull();
  });

  it("다른 provider의 identity는 그대로 유지된다", async () => {
    const userId = "google:unlink-2";
    await addUser(userId);
    await addIdentity(userId, "google", "g-2");
    await addIdentity(userId, "kakao", "k-2");

    await deleteIdentity("google", await sidCookie(userId));
    expect(await identityRow(userId, "kakao")).not.toBeNull();
  });

  it("미로그인 요청은 401을 반환한다", async () => {
    const res = await deleteIdentity("google", null);
    expect(res.status).toBe(401);
  });

  it("화이트리스트에 없는 provider는 400 unsupported_provider를 반환한다", async () => {
    const userId = "google:unlink-3";
    await addUser(userId);
    await addIdentity(userId, "google", "g-3");
    await addIdentity(userId, "kakao", "k-3");

    const res = await deleteIdentity("facebook", await sidCookie(userId));
    expect(res.status).toBe(400);
    expect((await res.json() as { code: string }).code).toBe("unsupported_provider");
  });

  it("연결되지 않은 provider는 404 identity_not_found를 반환한다", async () => {
    const userId = "google:unlink-4";
    await addUser(userId);
    await addIdentity(userId, "google", "g-4");
    await addIdentity(userId, "kakao", "k-4");

    const res = await deleteIdentity("naver", await sidCookie(userId));
    expect(res.status).toBe(404);
    expect((await res.json() as { code: string }).code).toBe("identity_not_found");
  });

  it("타인의 identity는 해제할 수 없고, 그대로 유지된다", async () => {
    const owner = "google:owner";
    const attacker = "kakao:attacker";
    await addUser(owner);
    await addUser(attacker);
    await addIdentity(owner, "google", "g-owner");
    await addIdentity(owner, "kakao", "k-owner");
    await addIdentity(attacker, "naver", "n-attacker");
    await addIdentity(attacker, "kakao", "k-attacker");

    const res = await deleteIdentity("google", await sidCookie(attacker));
    expect(res.status).toBe(404);
    expect(await identityRow(owner, "google")).not.toBeNull();
  });

  it("마지막 로그인 수단이면 409 last_login_method를 반환하고 삭제하지 않는다", async () => {
    const userId = "google:only-method";
    await addUser(userId);
    await addIdentity(userId, "google", "g-only");

    const res = await deleteIdentity("google", await sidCookie(userId));
    expect(res.status).toBe(409);
    const body = await res.json() as { code: string; message: string };
    expect(body.code).toBe("last_login_method");
    expect(body.message).toContain("다른 로그인 방법");
    expect(await identityRow(userId, "google")).not.toBeNull();
  });

  it("다른 소셜 identity가 있으면 마지막 수단이 아니므로 해제가 허용된다", async () => {
    const userId = "google:two-methods";
    await addUser(userId);
    await addIdentity(userId, "google", "g-two");
    await addIdentity(userId, "naver", "n-two");

    const res = await deleteIdentity("google", await sidCookie(userId));
    expect(res.status).toBe(200);
  });

  it("유효한 이메일 로그인(인증완료+비밀번호+잠금아님)이 있으면 마지막 소셜도 해제할 수 있다", async () => {
    const userId = "google:with-email";
    await addUser(userId);
    await addIdentity(userId, "google", "g-email");
    await addValidEmailLogin(userId, "with-email@example.test");

    const res = await deleteIdentity("google", await sidCookie(userId));
    expect(res.status).toBe(200);
  });

  it("이메일 인증이 안 된 자격증명은 유효한 로그인 방법으로 계산하지 않는다(409 유지)", async () => {
    const userId = "google:unverified-email";
    await addUser(userId);
    await addIdentity(userId, "google", "g-unverified");
    await addUnverifiedEmailLogin(userId, "unverified@example.test");

    const res = await deleteIdentity("google", await sidCookie(userId));
    expect(res.status).toBe(409);
  });

  it("GitHub 해제: 외부 revoke 함수가 저장된 토큰으로 호출된다", async () => {
    const userId = "gh:revoke-call";
    await addUser(userId);
    await addIdentity(userId, "github", "999");
    await addIdentity(userId, "kakao", "k-revoke-call");
    await setGithubToken(userId, "raw-gh-token-abc");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      expect(url).toBe(`https://api.github.com/applications/${GITHUB_CLIENT_ID}/token`);
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await deleteIdentity("github", await sidCookie(userId));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = await res.json() as { token_revoked: boolean; revoke_status: string };
    expect(body.token_revoked).toBe(true);
    expect(body.revoke_status).toBe("revoked");
  });

  it("외부 폐기 실패 정책: revoke 실패해도 로컬 unlink는 그대로 성공한다", async () => {
    const userId = "gh:revoke-fail";
    await addUser(userId);
    await addIdentity(userId, "github", "888");
    await addIdentity(userId, "kakao", "k-revoke-fail");
    await setGithubToken(userId, "raw-gh-token-will-fail");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("server error", { status: 500 })));

    const res = await deleteIdentity("github", await sidCookie(userId));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; token_revoked: boolean; revoke_status: string };
    expect(body.ok).toBe(true);
    expect(body.token_revoked).toBe(false);
    expect(body.revoke_status).toBe("failed");
    // 로컬 삭제는 실패와 무관하게 이미 반영돼 있어야 한다.
    expect(await identityRow(userId, "github")).toBeNull();
  });

  it("폐기 실패는 감사 로그와 재시도 큐에 기록된다", async () => {
    const userId = "gh:revoke-pending";
    await addUser(userId);
    await addIdentity(userId, "github", "777");
    await addIdentity(userId, "kakao", "k-revoke-pending");
    await setGithubToken(userId, "raw-gh-token-pending");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("server error", { status: 500 })));
    await deleteIdentity("github", await sidCookie(userId));

    const audit = await workerEnv.DB.prepare(
      "SELECT * FROM identity_unlink_audit WHERE user_id=? AND provider='github'",
    ).bind(userId).first<{ local_delete_ok: number; external_revoke_status: string; failure_code: string | null }>();
    expect(audit?.local_delete_ok).toBe(1);
    expect(audit?.external_revoke_status).toBe("failed");
    expect(audit?.failure_code).toBe("provider_revoke_failed");

    const pending = await workerEnv.DB.prepare(
      "SELECT * FROM identity_revoke_pending WHERE user_id=? AND provider='github'",
    ).bind(userId).first<{ resolved_at: string | null; attempts: number }>();
    expect(pending).not.toBeNull();
    expect(pending?.resolved_at).toBeNull();
    expect(pending?.attempts).toBe(1);
  });

  it("토큰이 애초에 저장되지 않은 provider(순수 로그인만 한 naver)는 not_applicable로 표시되고 실패로 취급하지 않는다", async () => {
    const userId = "naver:no-token";
    await addUser(userId);
    await addIdentity(userId, "naver", "n-no-token");
    await addIdentity(userId, "kakao", "k-no-token");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await deleteIdentity("naver", await sidCookie(userId));
    expect(res.status).toBe(200);
    const body = await res.json() as { revoke_status: string };
    expect(body.revoke_status).toBe("not_applicable");
    expect(fetchMock).not.toHaveBeenCalled();

    const audit = await workerEnv.DB.prepare(
      "SELECT external_revoke_status FROM identity_unlink_audit WHERE user_id=? AND provider='naver'",
    ).bind(userId).first<{ external_revoke_status: string }>();
    expect(audit?.external_revoke_status).toBe("not_applicable");
  });

  it("별도로 연결한 카카오 메시지 통합의 토큰이 있으면 kakao 로그인 해제 시 재사용해 revoke를 시도한다", async () => {
    const userId = "kakao:with-integration";
    await addUser(userId);
    await addIdentity(userId, "kakao", "k-integ");
    await addIdentity(userId, "naver", "n-integ");
    await addIntegrationToken(userId, "kakao_message", "raw-kakao-integration-token");

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await deleteIdentity("kakao", await sidCookie(userId));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [urlArg] = fetchMock.mock.calls[0];
    expect(String(urlArg)).toBe("https://kapi.kakao.com/v1/user/unlink");
    const body = await res.json() as { revoke_status: string };
    expect(body.revoke_status).toBe("revoked");
  });

  it("멱등성: 같은 provider를 두 번 해제 요청하면 두 번째는 성공 처리하지 않는다", async () => {
    const userId = "google:idempotent";
    await addUser(userId);
    await addIdentity(userId, "google", "g-idem");
    await addIdentity(userId, "kakao", "k-idem");

    const first = await deleteIdentity("google", await sidCookie(userId));
    expect(first.status).toBe(200);
    const second = await deleteIdentity("google", await sidCookie(userId));
    expect(second.status).toBe(404);
    expect((await second.json() as { code: string }).code).toBe("identity_not_found");
  });

  it("GitHub 해제 시 users.github_id/gh_token/gh_scope가 함께 정리된다", async () => {
    const userId = "gh:field-cleanup";
    await addUser(userId);
    await addIdentity(userId, "github", "555");
    await addIdentity(userId, "kakao", "k-field-cleanup");
    await setGithubToken(userId, "raw-gh-cleanup-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    await deleteIdentity("github", await sidCookie(userId));

    const row = await workerEnv.DB.prepare(
      "SELECT github_id, gh_token, gh_scope FROM users WHERE id=?",
    ).bind(userId).first<{ github_id: number | null; gh_token: string | null; gh_scope: string | null }>();
    expect(row?.github_id).toBeNull();
    expect(row?.gh_token).toBeNull();
    expect(row?.gh_scope).toBeNull();
  });

  it("GitHub 해제 후 /api/me의 github_enabled가 false로 전환된다(프론트 재연결 안내 기준)", async () => {
    const userId = "gh:feature-flag";
    await addUser(userId);
    await addIdentity(userId, "github", "444");
    await addIdentity(userId, "kakao", "k-feature-flag");
    await setGithubToken(userId, "raw-gh-feature-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    await deleteIdentity("github", await sidCookie(userId));

    const meRes = await worker.fetch(new Request("https://example.test/api/me", {
      headers: { cookie: await sidCookie(userId) },
    }), testEnv(), executionContext);
    const me = await meRes.json() as { github_enabled: boolean; connected_providers: string[] };
    expect(me.github_enabled).toBe(false);
    expect(me.connected_providers).not.toContain("github");
  });
});

describe("processPendingIdentityRevocations (재시도 스케줄러)", () => {
  it("대기 중인 revoke를 다시 시도해 성공하면 resolved_at을 채운다", async () => {
    const userId = "gh:retry-success";
    await addUser(userId);
    await workerEnv.DB.prepare(
      `INSERT INTO identity_revoke_pending (id, user_id, provider, token_enc, attempts, created_at, last_attempt_at, resolved_at)
       VALUES (?, ?, 'github', ?, 1, ?, ?, NULL)`,
    ).bind(crypto.randomUUID(), userId, await encryptToken("raw-retry-token", JWT_SECRET), new Date().toISOString(), new Date().toISOString()).run();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const result = await processPendingIdentityRevocations(testEnv());
    expect(result.retried).toBe(1);
    expect(result.resolved).toBe(1);

    const row = await workerEnv.DB.prepare(
      "SELECT resolved_at FROM identity_revoke_pending WHERE user_id=?",
    ).bind(userId).first<{ resolved_at: string | null }>();
    expect(row?.resolved_at).not.toBeNull();
  });

  it("재시도도 실패하면 attempts만 증가하고 resolved_at은 비워둔다", async () => {
    const userId = "gh:retry-fail";
    await addUser(userId);
    await workerEnv.DB.prepare(
      `INSERT INTO identity_revoke_pending (id, user_id, provider, token_enc, attempts, created_at, last_attempt_at, resolved_at)
       VALUES (?, ?, 'github', ?, 1, ?, ?, NULL)`,
    ).bind(crypto.randomUUID(), userId, await encryptToken("raw-retry-token-2", JWT_SECRET), new Date().toISOString(), new Date().toISOString()).run();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("still down", { status: 500 })));
    const result = await processPendingIdentityRevocations(testEnv());
    expect(result.resolved).toBe(0);

    const row = await workerEnv.DB.prepare(
      "SELECT resolved_at, attempts FROM identity_revoke_pending WHERE user_id=?",
    ).bind(userId).first<{ resolved_at: string | null; attempts: number }>();
    expect(row?.resolved_at).toBeNull();
    expect(row?.attempts).toBe(2);
  });
});
