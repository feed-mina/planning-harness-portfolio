import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { signJWT } from "../src/core/auth";
import {
  CONNECTED_APP_RESUME_PATH,
  connectedAppLoginContinuation,
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
const issuer = "https://harness.example";
const redirectUri = "https://auto-media.example/auth/harness/callback";
const clientId = "auto-media-web";
const audience = "https://auto-media.example";
const scope = "auto-media:session";
const environment = "staging";
const jwtSecret = "connected-app-runtime-jwt-secret-0123456789";
const backchannelSecret = "connected-app-runtime-backchannel-secret-0123456789";
const verifier = "correct-horse-battery-staple-connected-app-verifier-1234567890";
const state = "connected-app-state-0123456789";

function connectedEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...workerEnv,
    APP_BASE_URL: issuer,
    ANALYTICS_ENVIRONMENT: environment,
    JWT_SECRET: jwtSecret,
    CONNECTED_APP_AUTH_ENABLED: "true",
    CONNECTED_APP_CLIENT_ID: clientId,
    CONNECTED_APP_AUDIENCE: audience,
    CONNECTED_APP_SCOPE: scope,
    CONNECTED_APP_REDIRECT_URI: redirectUri,
    CONNECTED_APP_BACKCHANNEL_SECRET: backchannelSecret,
    ...overrides,
  };
}

async function addUser(): Promise<string> {
  const userId = `email:connected-${crypto.randomUUID()}@example.test`;
  await workerEnv.DB.prepare(
    "INSERT INTO users (id, github_login, github_id, created_at) VALUES (?1, ?2, NULL, ?3)",
  ).bind(userId, userId, new Date().toISOString()).run();
  return userId;
}

async function pkceChallenge(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function authorizeUrl(overrides: Record<string, string> = {}): Promise<string> {
  const url = new URL("/api/auth/connected-app/authorize", issuer);
  const values = {
    response_type: "code",
    client_id: clientId,
    audience,
    scope,
    redirect_uri: redirectUri,
    issuer,
    environment,
    state,
    code_challenge: await pkceChallenge(),
    code_challenge_method: "S256",
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) url.searchParams.set(name, value);
  return url.toString();
}

async function issueCode(userId: string): Promise<{ code: string; authorizationId: string }> {
  const sid = await signJWT({ sub: userId, login: userId }, jwtSecret);
  const response = await worker.fetch(new Request(await authorizeUrl(), {
    headers: { cookie: `sid=${sid}` },
  }), connectedEnv(), executionContext);
  expect(response.status).toBe(302);
  const callback = new URL(response.headers.get("location") || "");
  const code = callback.searchParams.get("code") || "";
  expect(callback.origin + callback.pathname).toBe(redirectUri);
  expect(callback.searchParams.get("state")).toBe(state);
  expect(callback.searchParams.get("iss")).toBe(issuer);
  const row = await workerEnv.DB.prepare(
    "SELECT id FROM connected_app_authorization_codes WHERE user_id=?1 ORDER BY created_at DESC LIMIT 1",
  ).bind(userId).first<{ id: string }>();
  return { code, authorizationId: row?.id || "" };
}

function exchangeBody(code: string, exchangeId: string): Record<string, string> {
  return {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    exchange_id: exchangeId,
    client_id: clientId,
    audience,
    scope,
    redirect_uri: redirectUri,
    issuer,
    environment,
  };
}

function tokenRequest(
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  return new Request(new URL("/api/auth/connected-app/token", issuer), {
    method: "POST",
    headers: {
      authorization: `Bearer ${backchannelSecret}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("connected application authorize", () => {
  it("is disabled by default", async () => {
    const response = await worker.fetch(
      new Request(await authorizeUrl()),
      { ...workerEnv, CONNECTED_APP_AUTH_ENABLED: "false" },
      executionContext,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "connected_app_auth_disabled" });
  });

  it("issues a 120 second hash-only code for an exact request", async () => {
    const userId = await addUser();
    const { code, authorizationId } = await issueCode(userId);
    expect(code).toMatch(/^ph_ca_ac_[A-Za-z0-9_-]+$/);
    expect(authorizationId).toMatch(/^[0-9a-f-]{36}$/);

    const row = await workerEnv.DB.prepare(
      `SELECT code_hash, client_id, audience, scope, redirect_uri, issuer, environment,
              created_at, expires_at, consumed_at
       FROM connected_app_authorization_codes WHERE id=?1`,
    ).bind(authorizationId).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      client_id: clientId,
      audience,
      scope,
      redirect_uri: redirectUri,
      issuer,
      environment,
      consumed_at: null,
    });
    expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(row?.expires_at) - Number(row?.created_at)).toBe(120);
    expect(JSON.stringify(row)).not.toContain(code);
  });

  it("rejects environment, redirect, PKCE, duplicate, and unknown parameter mismatches", async () => {
    const userId = await addUser();
    const sid = await signJWT({ sub: userId }, jwtSecret);
    for (const url of [
      await authorizeUrl({ environment: "production" }),
      await authorizeUrl({ redirect_uri: `${redirectUri}/` }),
      await authorizeUrl({ code_challenge_method: "plain" }),
      `${await authorizeUrl()}&client_id=duplicate`,
      `${await authorizeUrl()}&next=https%3A%2F%2Fevil.example`,
    ]) {
      const response = await worker.fetch(new Request(url, {
        headers: { cookie: `sid=${sid}` },
      }), connectedEnv(), executionContext);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_request" });
    }
  });

  it("resumes only through the signed host-only fixed endpoint after login", async () => {
    const first = await worker.fetch(
      new Request(await authorizeUrl()),
      connectedEnv(),
      executionContext,
    );
    expect(first.status).toBe(302);
    const login = new URL(first.headers.get("location") || "");
    expect(login.origin + login.pathname).toBe(`${issuer}/mypage/`);
    expect(login.searchParams.get("next")).toBe(CONNECTED_APP_RESUME_PATH);

    const setCookie = first.headers.get("set-cookie") || "";
    expect(setCookie).toContain("__Host-harness_connected_app_resume=");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).not.toContain("Domain=");
    const resumeCookie = setCookie.split(";", 1)[0];
    expect(await connectedAppLoginContinuation(
      new Request(new URL("/mypage/", issuer), { headers: { cookie: resumeCookie } }),
      connectedEnv(),
    )).toBe(CONNECTED_APP_RESUME_PATH);
    const tamperedCookie = `${resumeCookie.slice(0, -1)}${resumeCookie.endsWith("a") ? "b" : "a"}`;
    expect(await connectedAppLoginContinuation(
      new Request(new URL("/mypage/", issuer), { headers: { cookie: tamperedCookie } }),
      connectedEnv(),
    )).toBeNull();

    const userId = await addUser();
    const sid = await signJWT({ sub: userId }, jwtSecret);
    const resumed = await worker.fetch(
      new Request(new URL(CONNECTED_APP_RESUME_PATH, issuer), {
        headers: { cookie: `${resumeCookie}; sid=${sid}` },
      }),
      connectedEnv(),
      executionContext,
    );
    expect(resumed.status).toBe(302);
    expect(new URL(resumed.headers.get("location") || "").searchParams.get("state")).toBe(state);
    expect(resumed.headers.get("set-cookie")).toContain("Max-Age=0");

    const forged = await worker.fetch(
      new Request(new URL(`${CONNECTED_APP_RESUME_PATH}?next=https://evil.example`, issuer)),
      connectedEnv(),
      executionContext,
    );
    expect(forged.status).toBe(400);
    expect(await forged.json()).toMatchObject({ code: "invalid_resume" });

    const xhr = await worker.fetch(new Request(await authorizeUrl(), {
      headers: { "sec-fetch-mode": "cors" },
    }), connectedEnv(), executionContext);
    expect(xhr.status).toBe(403);
    expect(await xhr.json()).toMatchObject({ code: "browser_navigation_required" });

    const framedAuthorize = await worker.fetch(new Request(await authorizeUrl(), {
      headers: {
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "iframe",
      },
    }), connectedEnv(), executionContext);
    expect(framedAuthorize.status).toBe(403);
    expect(await framedAuthorize.json()).toMatchObject({ code: "browser_navigation_required" });

    const framedResume = await worker.fetch(
      new Request(new URL(CONNECTED_APP_RESUME_PATH, issuer), {
        headers: {
          cookie: resumeCookie,
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "iframe",
        },
      }),
      connectedEnv(),
      executionContext,
    );
    expect(framedResume.status).toBe(403);
    expect(await framedResume.json()).toMatchObject({ code: "browser_navigation_required" });
  });
});

describe("connected application server-only exchange", () => {
  it("returns a minimal deterministic assertion and permits only the same exchange ID retry", async () => {
    const userId = await addUser();
    const { code, authorizationId } = await issueCode(userId);
    const body = exchangeBody(code, "exchange-id-0123456789abcdef");

    const first = await worker.fetch(tokenRequest(body), connectedEnv(), executionContext);
    expect(first.status).toBe(200);
    expect(first.headers.get("access-control-allow-origin")).toBeNull();
    const assertion = await first.json();
    expect(assertion).toEqual({
      issuer,
      subject: userId,
      client_id: clientId,
      audience,
      scope,
      environment,
      authorization_id: authorizationId,
      issued_at: expect.any(Number),
      expires_at: expect.any(Number),
    });
    expect(assertion.expires_at - assertion.issued_at).toBe(120);

    const retry = await worker.fetch(tokenRequest(body), connectedEnv(), executionContext);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(assertion);

    const replay = await worker.fetch(
      tokenRequest(exchangeBody(code, "different-exchange-0123456789")),
      connectedEnv(),
      executionContext,
    );
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ code: "invalid_grant" });

    const row = await workerEnv.DB.prepare(
      "SELECT code_hash, exchange_id_hash, consume_nonce FROM connected_app_authorization_codes WHERE id=?1",
    ).bind(authorizationId).first<Record<string, unknown>>();
    expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.exchange_id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.consume_nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(row)).not.toContain(code);
    expect(JSON.stringify(row)).not.toContain(body.exchange_id);
  });

  it("allows concurrent retries with one exchange ID but rejects a competing exchange", async () => {
    const userId = await addUser();
    const sameCode = (await issueCode(userId)).code;
    const sameBody = exchangeBody(sameCode, "same-concurrent-exchange-id-012345");
    const same = await Promise.all([
      worker.fetch(tokenRequest(sameBody), connectedEnv(), executionContext),
      worker.fetch(tokenRequest(sameBody), connectedEnv(), executionContext),
    ]);
    expect(same.map((response) => response.status)).toEqual([200, 200]);
    expect(await same[0].json()).toEqual(await same[1].json());

    const racedCode = (await issueCode(userId)).code;
    const raced = await Promise.all([
      worker.fetch(
        tokenRequest(exchangeBody(racedCode, "race-exchange-id-one-0123456789")),
        connectedEnv(),
        executionContext,
      ),
      worker.fetch(
        tokenRequest(exchangeBody(racedCode, "race-exchange-id-two-0123456789")),
        connectedEnv(),
        executionContext,
      ),
    ]);
    expect(raced.map((response) => response.status).sort()).toEqual([200, 400]);
  });

  it("requires the separate secret, rejects browser requests, and emits no CORS headers", async () => {
    const userId = await addUser();
    const { code } = await issueCode(userId);
    const body = exchangeBody(code, "server-only-exchange-id-0123456789");

    const unauthorized = await worker.fetch(tokenRequest(body, {
      authorization: "Bearer wrong-backchannel-secret-0123456789",
    }), connectedEnv(), executionContext);
    expect(unauthorized.status).toBe(401);

    const browser = await worker.fetch(tokenRequest(body, {
      origin: "https://localhost",
    }), connectedEnv(), executionContext);
    expect(browser.status).toBe(403);
    expect(browser.headers.get("access-control-allow-origin")).toBeNull();

    const preflight = await worker.fetch(new Request(new URL("/api/auth/connected-app/token", issuer), {
      method: "OPTIONS",
      headers: {
        origin: "https://localhost",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type",
      },
    }), connectedEnv(), executionContext);
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects expired codes and exact-contract mismatches", async () => {
    const userId = await addUser();
    const expired = await issueCode(userId);
    await workerEnv.DB.prepare(
      "UPDATE connected_app_authorization_codes SET created_at=1, expires_at=2 WHERE id=?1",
    ).bind(expired.authorizationId).run();
    const expiredResponse = await worker.fetch(
      tokenRequest(exchangeBody(expired.code, "expired-exchange-id-0123456789")),
      connectedEnv(),
      executionContext,
    );
    expect(expiredResponse.status).toBe(400);
    expect(await expiredResponse.json()).toMatchObject({ code: "invalid_grant" });

    const exact = await issueCode(userId);
    const wrongEnvironment = exchangeBody(exact.code, "wrong-environment-exchange-012345");
    wrongEnvironment.environment = "production";
    const mismatch = await worker.fetch(
      tokenRequest(wrongEnvironment),
      connectedEnv(),
      executionContext,
    );
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({ code: "invalid_grant" });
  });

  it("fails the Auto Media production navigation closed until both flags are enabled", async () => {
    const url = new URL("/api/connected-apps/auto-media/readiness", issuer);
    const disabled = await worker.fetch(
      new Request(url),
      connectedEnv({ AUTO_MEDIA_NAV_ENABLED: "false" }),
      executionContext,
    );
    expect(await disabled.json()).toEqual({ ready: false });

    const authDisabled = await worker.fetch(
      new Request(url),
      connectedEnv({
        AUTO_MEDIA_NAV_ENABLED: "true",
        CONNECTED_APP_AUTH_ENABLED: "false",
      }),
      executionContext,
    );
    expect(await authDisabled.json()).toEqual({ ready: false });

    const enabled = await worker.fetch(
      new Request(url),
      connectedEnv({ AUTO_MEDIA_NAV_ENABLED: "true" }),
      executionContext,
    );
    expect(await enabled.json()).toEqual({
      ready: true,
      href: "https://auto-media.kibayerin.workers.dev/",
    });
    expect(enabled.headers.get("cache-control")).toBe("no-store");
  });
});
