import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { signJWT } from "../src/core/auth";
import {
  MOBILE_AUTH_RATE_LIMITS,
  MobileAuthError,
  authenticateMobileAccessToken,
  cancelMobileAuthorizationCode,
  enforceMobileAuthRateLimits,
  exchangeMobileAuthorizationCode,
  hashMobileToken,
  issueMobileAuthorizationCode,
  pkceS256,
  revokeMobileToken,
  rotateMobileRefreshToken,
} from "../src/domains/auth";

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
const verifier = "correct-horse-battery-staple-mobile-pkce-verifier-1234567890";
const redirectUri = "io.github.feedmina.aifeedyerin:/oauth/callback";
const alternateRedirectUri = "io.github.feedmina.aifeedyerin:/oauth/alternate";

function mobileEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...workerEnv,
    MOBILE_AUTH_ENABLED: "true",
    MOBILE_AUTH_REDIRECT_URIS: JSON.stringify([redirectUri, alternateRedirectUri]),
    ...overrides,
  };
}

async function addUser(): Promise<string> {
  const userId = `email:mobile-${crypto.randomUUID()}@example.test`;
  await workerEnv.DB.prepare(
    "INSERT INTO users (id, github_login, github_id, created_at) VALUES (?1, ?2, NULL, ?3)",
  ).bind(userId, userId, new Date().toISOString()).run();
  return userId;
}

async function newCode(userId: string) {
  return issueMobileAuthorizationCode(mobileEnv(), userId, {
    code_challenge: await pkceS256(verifier),
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
  });
}

async function exchange(code: string) {
  return exchangeMobileAuthorizationCode(mobileEnv(), {
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("mobile auth operational gates", () => {
  it("is disabled unless explicitly enabled", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/auth/mobile/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: `ph_mob_rt_${"a".repeat(43)}` }),
    }), workerEnv, executionContext);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "mobile authentication is disabled", code: "mobile_auth_disabled" });

    const bearer = await worker.fetch(new Request("https://example.test/api/me", {
      headers: { authorization: `Bearer ph_mob_at_${"a".repeat(43)}` },
    }), workerEnv, executionContext);
    expect(bearer.status).toBe(404);
    expect(await bearer.json()).toMatchObject({ code: "mobile_auth_disabled" });
  });

  it("uses an exact environment allowlist and keeps code lifetime at 120 seconds", async () => {
    const userId = await addUser();
    const exactEnv = mobileEnv({ MOBILE_AUTH_REDIRECT_URIS: JSON.stringify([redirectUri]) });
    const issued = await issueMobileAuthorizationCode(exactEnv, userId, {
      code_challenge: await pkceS256(verifier),
      code_challenge_method: "S256",
      redirect_uri: redirectUri,
    });
    expect(issued).toMatchObject({ redirect_uri: redirectUri, expires_in: 120 });

    for (const rejectedUri of ["https://example.test/callback", `${redirectUri}/`]) {
      await expect(issueMobileAuthorizationCode(exactEnv, userId, {
        code_challenge: await pkceS256(verifier),
        code_challenge_method: "S256",
        redirect_uri: rejectedUri,
      })).rejects.toMatchObject({ status: 400, code: "redirect_uri_not_allowed" });
    }

    await expect(issueMobileAuthorizationCode(
      mobileEnv({ MOBILE_AUTH_REDIRECT_URIS: "[]" }),
      userId,
      {
        code_challenge: await pkceS256(verifier),
        code_challenge_method: "S256",
        redirect_uri: redirectUri,
      },
    )).rejects.toMatchObject({ status: 503, code: "mobile_auth_misconfigured" });
  });
});

describe("mobile PKCE authorization code", () => {
  it("stores only lowercase SHA-256 hashes and authenticates the issued access token", async () => {
    const userId = await addUser();
    const authorization = await newCode(userId);
    const codeRow = await workerEnv.DB.prepare(
      "SELECT code_hash, expires_at, consumed_at FROM mobile_auth_codes WHERE user_id=?1",
    ).bind(userId).first<{ code_hash: string; expires_at: number; consumed_at: number | null }>();

    expect(codeRow?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(codeRow?.code_hash).toBe(await hashMobileToken(authorization.code));
    expect(JSON.stringify(codeRow)).not.toContain(authorization.code);

    const tokens = await exchange(authorization.code);
    const session = await workerEnv.DB.prepare(
      `SELECT access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at
       FROM mobile_sessions WHERE id=?1`,
    ).bind(tokens.session_id).first<{
      access_token_hash: string;
      refresh_token_hash: string;
      access_expires_at: number;
      refresh_expires_at: number;
    }>();

    expect(session?.access_token_hash).toBe(await hashMobileToken(tokens.access_token));
    expect(session?.refresh_token_hash).toBe(await hashMobileToken(tokens.refresh_token));
    expect(session?.access_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(session?.refresh_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(session)).not.toContain(tokens.access_token);
    expect(JSON.stringify(session)).not.toContain(tokens.refresh_token);
    expect(session!.access_expires_at).toBeLessThanOrEqual(session!.refresh_expires_at);
    expect(await authenticateMobileAccessToken(mobileEnv(), tokens.access_token)).toMatchObject({ userId });
  });

  it("lets exactly one concurrent exchange consume a code", async () => {
    const userId = await addUser();
    const authorization = await newCode(userId);
    const results = await Promise.allSettled([
      exchange(authorization.code),
      exchange(authorization.code),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "invalid_grant" });
    const count = await workerEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM mobile_sessions WHERE user_id=?1",
    ).bind(userId).first<{ count: number }>();
    expect(Number(count?.count)).toBe(1);
  });

  it("rejects cancelled, expired, mismatched redirect, and wrong verifier grants", async () => {
    const userId = await addUser();
    const cancelled = await newCode(userId);
    expect(await cancelMobileAuthorizationCode(mobileEnv(), userId, { code: cancelled.code }))
      .toEqual({ ok: true, cancelled: true });
    await expect(exchange(cancelled.code)).rejects.toMatchObject({ code: "invalid_grant" });

    const expired = await newCode(userId);
    await workerEnv.DB.prepare(
      "UPDATE mobile_auth_codes SET created_at=1, expires_at=2 WHERE code_hash=?1",
    ).bind(await hashMobileToken(expired.code)).run();
    await expect(exchange(expired.code)).rejects.toMatchObject({ code: "invalid_grant" });

    const redirectMismatch = await newCode(userId);
    await expect(exchangeMobileAuthorizationCode(mobileEnv(), {
      code: redirectMismatch.code,
      code_verifier: verifier,
      redirect_uri: alternateRedirectUri,
    })).rejects.toMatchObject({ code: "invalid_grant" });

    const verifierMismatch = await newCode(userId);
    await expect(exchangeMobileAuthorizationCode(mobileEnv(), {
      code: verifierMismatch.code,
      code_verifier: "x".repeat(64),
      redirect_uri: redirectUri,
    })).rejects.toMatchObject({ code: "invalid_grant" });
  });
});

describe("mobile refresh rotation and revocation", () => {
  it("rotates once, preserves the absolute expiry, and revokes the family on reuse", async () => {
    const userId = await addUser();
    const initial = await exchange((await newCode(userId)).code);
    const rotated = await rotateMobileRefreshToken(mobileEnv(), { refresh_token: initial.refresh_token });

    expect(rotated.refresh_token).not.toBe(initial.refresh_token);
    expect(await authenticateMobileAccessToken(mobileEnv(), initial.access_token)).toBeNull();
    expect(await authenticateMobileAccessToken(mobileEnv(), rotated.access_token)).toMatchObject({ userId });

    const expiries = await workerEnv.DB.prepare(
      "SELECT refresh_expires_at FROM mobile_sessions WHERE family_id=?1 ORDER BY created_at, id",
    ).bind(initial.session_id).all<{ refresh_expires_at: number }>();
    expect(new Set(expiries.results.map((row) => row.refresh_expires_at)).size).toBe(1);

    await expect(rotateMobileRefreshToken(mobileEnv(), { refresh_token: initial.refresh_token }))
      .rejects.toMatchObject({ code: "invalid_grant" });
    expect(await authenticateMobileAccessToken(mobileEnv(), rotated.access_token)).toBeNull();
    const family = await workerEnv.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active,
              MAX(reuse_detected_at) AS reuse_detected_at
       FROM mobile_sessions WHERE family_id=?1`,
    ).bind(initial.session_id).first<{ total: number; active: number; reuse_detected_at: number | null }>();
    expect(Number(family?.total)).toBe(2);
    expect(Number(family?.active)).toBe(0);
    expect(family?.reuse_detected_at).not.toBeNull();
  });

  it("rejects expired refresh tokens and supports idempotent family revocation", async () => {
    const userId = await addUser();
    const expired = await exchange((await newCode(userId)).code);
    await workerEnv.DB.prepare(
      `UPDATE mobile_sessions
       SET created_at=1, access_expires_at=2, refresh_expires_at=2
       WHERE id=?1`,
    ).bind(expired.session_id).run();
    await expect(rotateMobileRefreshToken(mobileEnv(), { refresh_token: expired.refresh_token }))
      .rejects.toMatchObject({ code: "invalid_grant" });

    const active = await exchange((await newCode(userId)).code);
    expect(await revokeMobileToken(mobileEnv(), active.refresh_token, "refresh_token")).toBe(true);
    expect(await revokeMobileToken(mobileEnv(), active.refresh_token, "refresh_token")).toBe(true);
    expect(await authenticateMobileAccessToken(mobileEnv(), active.access_token)).toBeNull();
  });

  it("revokes only the explicitly typed JSON token and ignores an Authorization bearer", async () => {
    const userId = await addUser();
    const bearerFamily = await exchange((await newCode(userId)).code);
    const targetFamily = await exchange((await newCode(userId)).code);

    const response = await worker.fetch(new Request("https://example.test/api/auth/mobile/revoke", {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearerFamily.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: targetFamily.refresh_token, token_type_hint: "refresh_token" }),
    }), mobileEnv(), executionContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await authenticateMobileAccessToken(mobileEnv(), bearerFamily.access_token)).toMatchObject({ userId });
    expect(await authenticateMobileAccessToken(mobileEnv(), targetFamily.access_token)).toBeNull();

    const untouched = await exchange((await newCode(userId)).code);
    const missingHint = await worker.fetch(new Request("https://example.test/api/auth/mobile/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: untouched.refresh_token }),
    }), mobileEnv(), executionContext);
    expect(missingHint.status).toBe(400);

    const mismatchedHint = await worker.fetch(new Request("https://example.test/api/auth/mobile/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: untouched.refresh_token, token_type_hint: "access_token" }),
    }), mobileEnv(), executionContext);
    expect(mismatchedHint.status).toBe(200);
    expect(await authenticateMobileAccessToken(mobileEnv(), untouched.access_token)).toMatchObject({ userId });
  });

  it("allows one concurrent refresh rotation and then revokes the raced family", async () => {
    const userId = await addUser();
    const initial = await exchange((await newCode(userId)).code);
    const results = await Promise.allSettled([
      rotateMobileRefreshToken(mobileEnv(), { refresh_token: initial.refresh_token }),
      rotateMobileRefreshToken(mobileEnv(), { refresh_token: initial.refresh_token }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "invalid_grant" });
    const family = await workerEnv.DB.prepare(
      `SELECT SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active,
              MAX(reuse_detected_at) AS reuse_detected_at
       FROM mobile_sessions WHERE family_id=?1`,
    ).bind(initial.session_id).first<{ active: number; reuse_detected_at: number | null }>();
    expect(Number(family?.active)).toBe(0);
    expect(family?.reuse_detected_at).not.toBeNull();
  });
});

describe("mobile auth rate limiting", () => {
  it("atomically enforces user and IP limits under concurrent requests", async () => {
    const authEnv = mobileEnv();
    const entitySubject = `user:${crypto.randomUUID()}`;
    const entityLimit = MOBILE_AUTH_RATE_LIMITS.code_issue.entity;
    const entityResults = await Promise.allSettled(Array.from({ length: entityLimit + 1 }, (_, index) => (
      enforceMobileAuthRateLimits(authEnv, new Request("https://example.test/api/auth/mobile/code", {
        headers: { "cf-connecting-ip": `192.0.2.${index + 1}` },
      }), "code_issue", entitySubject)
    )));
    expect(entityResults.filter((result) => result.status === "fulfilled")).toHaveLength(entityLimit);
    const entityRejected = entityResults.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(entityRejected.reason).toMatchObject({
      status: 429,
      code: "rate_limited",
      details: { rate_limit_scope: "code_issue:entity" },
    });

    const ipLimit = MOBILE_AUTH_RATE_LIMITS.code_issue.ip;
    const sharedIp = "198.51.100.88";
    const ipResults = await Promise.allSettled(Array.from({ length: ipLimit + 1 }, (_, index) => (
      enforceMobileAuthRateLimits(authEnv, new Request("https://example.test/api/auth/mobile/code", {
        headers: { "cf-connecting-ip": sharedIp },
      }), "code_issue", `user:${crypto.randomUUID()}:${index}`)
    )));
    expect(ipResults.filter((result) => result.status === "fulfilled")).toHaveLength(ipLimit);
    const ipRejected = ipResults.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(ipRejected.reason).toMatchObject({
      status: 429,
      code: "rate_limited",
      details: { rate_limit_scope: "code_issue:ip" },
    });
  });

  it("records separate counters for issue, exchange, refresh, and revoke", async () => {
    const userId = await addUser();
    const secret = "mobile-rate-scope-cookie-secret";
    const sid = await signJWT({ sub: userId, login: userId }, secret);
    const authEnv = mobileEnv({ JWT_SECRET: secret });
    const requestHeaders = {
      "cf-connecting-ip": "203.0.113.30",
      "content-type": "application/json",
    };
    const issueResponse = await worker.fetch(new Request("https://example.test/api/auth/mobile/code", {
      method: "POST",
      headers: { ...requestHeaders, cookie: `sid=${sid}` },
      body: JSON.stringify({
        code_challenge: await pkceS256(verifier),
        code_challenge_method: "S256",
        redirect_uri: redirectUri,
      }),
    }), authEnv, executionContext);
    expect(issueResponse.status).toBe(200);
    const issued = await issueResponse.json() as { code: string };

    const exchangeResponse = await worker.fetch(new Request("https://example.test/api/auth/mobile/token", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: issued.code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    }), authEnv, executionContext);
    expect(exchangeResponse.status).toBe(200);
    const exchanged = await exchangeResponse.json() as { refresh_token: string };

    const refreshResponse = await worker.fetch(new Request("https://example.test/api/auth/mobile/token", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: exchanged.refresh_token }),
    }), authEnv, executionContext);
    expect(refreshResponse.status).toBe(200);
    const refreshed = await refreshResponse.json() as { refresh_token: string };

    const revokeResponse = await worker.fetch(new Request("https://example.test/api/auth/mobile/revoke", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ token: refreshed.refresh_token, token_type_hint: "refresh_token" }),
    }), authEnv, executionContext);
    expect(revokeResponse.status).toBe(200);

    const scopes = await workerEnv.DB.prepare(
      "SELECT DISTINCT scope FROM mobile_auth_rate_limits ORDER BY scope",
    ).all<{ scope: string }>();
    expect(scopes.results.map((row) => row.scope)).toEqual(expect.arrayContaining([
      "code_issue:ip",
      "code_issue:entity",
      "code_exchange:ip",
      "code_exchange:entity",
      "refresh:ip",
      "refresh:entity",
      "revoke:ip",
      "revoke:entity",
    ]));
  });

  it("returns a stable 429 body and Retry-After header", async () => {
    const userId = await addUser();
    const secret = "mobile-rate-limit-cookie-secret";
    const authEnv = mobileEnv({ JWT_SECRET: secret });
    for (let index = 0; index < MOBILE_AUTH_RATE_LIMITS.code_issue.entity; index += 1) {
      await enforceMobileAuthRateLimits(authEnv, new Request("https://example.test/api/auth/mobile/code", {
        headers: { "cf-connecting-ip": `192.0.2.${100 + index}` },
      }), "code_issue", `user:${userId}`);
    }
    const sid = await signJWT({ sub: userId, login: userId }, secret);
    const response = await worker.fetch(new Request("https://example.test/api/auth/mobile/code", {
      method: "POST",
      headers: {
        "cf-connecting-ip": "198.51.100.200",
        "content-type": "application/json",
        cookie: `sid=${sid}`,
      },
      body: JSON.stringify({
        code_challenge: await pkceS256(verifier),
        code_challenge_method: "S256",
        redirect_uri: redirectUri,
      }),
    }), authEnv, executionContext);

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await response.json()).toMatchObject({
      code: "rate_limited",
      rate_limit_scope: "code_issue:entity",
      retry_after_seconds: expect.any(Number),
    });
  });
});

describe("mobile bearer Worker contract", () => {
  it("identifies /api/me from bearer auth and returns CORS-visible JSON errors", async () => {
    const userId = await addUser();
    const tokens = await exchange((await newCode(userId)).code);
    const origin = "capacitor://localhost";

    const me = await worker.fetch(new Request("https://example.test/api/me", {
      headers: { authorization: `Bearer ${tokens.access_token}`, origin },
    }), mobileEnv(), executionContext);
    expect(me.status).toBe(200);
    expect(me.headers.get("access-control-allow-origin")).toBe(origin);
    expect(await me.json()).toMatchObject({ userId, loggedIn: true });

    const invalid = await worker.fetch(new Request("https://example.test/api/me", {
      headers: { authorization: `Bearer ph_mob_at_${"z".repeat(43)}`, origin },
    }), mobileEnv(), executionContext);
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("access-control-allow-origin")).toBe(origin);
    expect(invalid.headers.get("set-cookie")).toBeNull();
    expect(await invalid.json()).toEqual({ error: "bearer token is expired, revoked, or invalid", code: "invalid_token" });
  });

  it("returns a stable JSON error contract for malformed token requests", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/auth/mobile/token", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://localhost" },
      body: JSON.stringify({ grant_type: "authorization_code" }),
    }), mobileEnv(), executionContext);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(await response.json()).toMatchObject({ error: "invalid token", code: "invalid_grant" });
  });

  it("does not let a mobile access token mint a new refresh family", async () => {
    const userId = await addUser();
    const tokens = await exchange((await newCode(userId)).code);
    const body = JSON.stringify({
      code_challenge: await pkceS256(verifier),
      code_challenge_method: "S256",
      redirect_uri: redirectUri,
    });

    const denied = await worker.fetch(new Request("https://example.test/api/auth/mobile/code", {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        origin: "capacitor://localhost",
      },
      body,
    }), mobileEnv(), executionContext);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "login required", code: "login_required" });

    const secret = "mobile-auth-cookie-session-secret";
    const sid = await signJWT({ sub: userId, login: userId }, secret);
    const allowed = await worker.fetch(new Request("https://example.test/api/auth/mobile/code", {
      method: "POST",
      headers: { cookie: `sid=${sid}`, "content-type": "application/json" },
      body,
    }), mobileEnv({ JWT_SECRET: secret }), executionContext);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ code_challenge_method: "S256", expires_in: 120 });
  });

  it("preserves the existing Garden runner Bearer token contract", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/garden-runner/builds/next", {
      method: "POST",
      headers: { authorization: "Bearer garden-runner-secret", "content-type": "application/json" },
      body: "{}",
    }), { ...workerEnv, GARDEN_RUNNER_TOKEN: "garden-runner-secret" }, executionContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, build: null });
  });

  it("enforces the JSON byte limit without trusting Content-Length", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/auth/mobile/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", padding: "x".repeat(20_000) }),
    }), mobileEnv(), executionContext);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "request body is too large", code: "request_too_large" });
  });

  it("uses typed MobileAuthError values for client-safe failures", () => {
    const error = new MobileAuthError(401, "invalid_token", "invalid bearer token");
    expect(error).toMatchObject({ status: 401, code: "invalid_token" });
  });
});
