import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerEmail } from "../src/domains/auth";
import { timingSafeEqual } from "../src/core/auth";
import { escapeHtml } from "../src/html";
import { sendOrganizationOverageAdminEmails } from "../src/domains/organization";
import { handleProxyGateway } from "../src/proxyGateway";
import { authenticateProxyKey, createDeviceRegistrationCode, createProxyDevice } from "../src/proxyKeys";
import { saveUsageLimitSettings, today } from "../src/domains/usage";
import type { Env } from "../src/index";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      R2: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const workerEnv = env as unknown as Env;
const timestamp = "2026-07-16T00:00:00.000Z";

async function addOrganization(orgId: string, name = "Security QA") {
  await workerEnv.DB.prepare(
    "INSERT INTO organizations (id, name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(orgId, name, "owner", timestamp, timestamp).run();
}

async function addMember(orgId: string, userId: string, role: "admin" | "member" = "member") {
  await workerEnv.DB.prepare(
    "INSERT OR IGNORE INTO users (id, github_login, github_id, created_at) VALUES (?, ?, NULL, ?)"
  ).bind(userId, userId, timestamp).run();
  await workerEnv.DB.prepare(
    "INSERT INTO organization_members (org_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)"
  ).bind(orgId, userId, role, timestamp, timestamp).run();
}

async function addUsage(userId: string, cost: number, orgId: string | null = null) {
  await workerEnv.DB.prepare(
    `INSERT INTO usage_events
       (user_id, day, provider, model, input_tokens, output_tokens, cost_krw, created_at, org_id)
     VALUES (?, ?, 'openai', 'gpt-5-mini', 0, 0, ?, ?, ?)`
  ).bind(userId, today(), cost, new Date().toISOString(), orgId).run();
}

function upstreamResponse() {
  return new Response(JSON.stringify({
    model: "gpt-5-mini",
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("security issues #117 and #120: proxy boundaries", () => {
  it("returns 429 before contacting the upstream provider when the account budget is exhausted", async () => {
    const userId = "proxy-blocked-user";
    await saveUsageLimitSettings(workerEnv, userId, {
      daily_limit_krw: 1,
      warn_threshold_krw: 1,
      block_on_exceed: true,
      alert_email_enabled: false,
    });
    await addUsage(userId, 1);
    const { proxy_key: key } = await createProxyDevice(workerEnv, userId, { name: "blocked" });
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstreamResponse());

    const response = await handleProxyGateway(
      { ...workerEnv, OPENAI_API_KEY: "upstream-secret" },
      new Request("https://example.test/api/proxy/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-5-mini", messages: [] }),
      }),
      "openai",
      "v1/chat/completions",
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ scope: "account", used_krw: 1, limit_krw: 1 });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards normal requests and exposes a warning header when blocking is disabled", async () => {
    const userId = "proxy-warning-user";
    await saveUsageLimitSettings(workerEnv, userId, {
      daily_limit_krw: 1,
      warn_threshold_krw: 1,
      block_on_exceed: false,
      alert_email_enabled: false,
    });
    await addUsage(userId, 1);
    const { proxy_key: key } = await createProxyDevice(workerEnv, userId, { name: "warning" });
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstreamResponse());

    const response = await handleProxyGateway(
      { ...workerEnv, OPENAI_API_KEY: "upstream-secret" },
      new Request("https://example.test/api/proxy/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-5-mini", messages: [] }),
      }),
      "openai",
      "v1/chat/completions",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-harness-budget-warning")).toBe("limit");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("enforces the aggregate organization budget for organization-scoped keys", async () => {
    const orgId = "org-budget";
    const owner = "org-budget-owner";
    const member = "org-budget-member";
    await addOrganization(orgId);
    await addMember(orgId, owner, "admin");
    await addMember(orgId, member);
    await saveUsageLimitSettings(workerEnv, owner, { daily_limit_krw: 1, warn_threshold_krw: 1, block_on_exceed: true });
    await saveUsageLimitSettings(workerEnv, member, { daily_limit_krw: 1, warn_threshold_krw: 1, block_on_exceed: true });
    await addUsage(member, 2, orgId);
    const { proxy_key: key } = await createProxyDevice(workerEnv, owner, { name: "org", org_id: orgId });
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstreamResponse());

    const response = await handleProxyGateway(
      { ...workerEnv, OPENAI_API_KEY: "upstream-secret" },
      new Request("https://example.test/api/proxy/openai/v1/chat/completions", {
        headers: { authorization: `Bearer ${key}` },
      }),
      "openai",
      "v1/chat/completions",
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ scope: "organization", org_id: orgId, used_krw: 2, limit_krw: 2 });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("does not accept a proxy key from the URL query string", async () => {
    const { proxy_key: key } = await createProxyDevice(workerEnv, "query-key-user", { name: "query" });
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstreamResponse());
    const response = await handleProxyGateway(
      { ...workerEnv, OPENAI_API_KEY: "upstream-secret" },
      new Request(`https://example.test/api/proxy/openai/v1/models?key=${encodeURIComponent(key)}`),
      "openai",
      "v1/models",
    );
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("authenticates existing keys whose base64url prefix contains an underscore", async () => {
    const key = `ph_live_ab_cdEF_${"x".repeat(32)}`;
    await workerEnv.DB.prepare(
      `INSERT INTO proxy_keys
         (id, user_id, org_id, device_id, name, key_prefix, key_hash, status, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'active', ?)`
    ).bind("underscore-key", "underscore-user", "underscore-device", "underscore", "ab_cdEF", await sha256(key), timestamp).run();
    expect(await authenticateProxyKey(workerEnv, key)).toMatchObject({
      userId: "underscore-user",
      deviceId: "underscore-device",
      keyId: "underscore-key",
    });
  });
});

describe("security issue #118: organization attribution", () => {
  it("rejects unknown memberships and preserves valid organization attribution", async () => {
    const orgId = "org-membership";
    const userId = "org-member";
    await addOrganization(orgId);

    await expect(createProxyDevice(workerEnv, userId, { org_id: orgId })).rejects.toMatchObject({
      status: 403,
      code: "org_forbidden",
    });
    await expect(createDeviceRegistrationCode(workerEnv, userId, { org_id: orgId })).rejects.toMatchObject({
      status: 403,
      code: "org_forbidden",
    });

    await addMember(orgId, userId);
    const device = await createProxyDevice(workerEnv, userId, { name: "valid", org_id: ` ${orgId} ` });
    const registration = await createDeviceRegistrationCode(workerEnv, userId, { name: "valid", org_id: orgId });
    expect(device.device.status).toBe("active");
    expect(registration.code).toMatch(/^[A-Z2-9]{8}$/);
    expect((await workerEnv.DB.prepare("SELECT org_id FROM proxy_keys WHERE id=?").bind(device.device.id).first<{ org_id: string }>())?.org_id).toBe(orgId);
    expect((await workerEnv.DB.prepare("SELECT org_id FROM device_registration_codes WHERE code=?").bind(registration.code).first<{ org_id: string }>())?.org_id).toBe(orgId);
  });
});

describe("security issues #119 and #120: output and comparison hardening", () => {
  it("escapes all HTML-significant characters", () => {
    expect(escapeHtml(`<img src=x onerror="boom">&'`)).toBe("&lt;img src=x onerror=&quot;boom&quot;&gt;&amp;&#39;");
  });

  it("escapes organization-controlled values in outbound email HTML", async () => {
    const orgId = "org-email";
    const member = "member-email";
    const admin = "admin-email";
    await addOrganization(orgId, `<img src=x onerror="boom">`);
    await addMember(orgId, member);
    await addMember(orgId, admin, "admin");
    await saveUsageLimitSettings(workerEnv, member, { daily_limit_krw: 10, warn_threshold_krw: 5, alert_email_enabled: true });
    await workerEnv.DB.prepare(
      `INSERT INTO user_identities
         (provider, provider_subject, user_id, email, display_name, avatar_url, created_at, updated_at)
       VALUES ('email', ?, ?, ?, ?, NULL, ?, ?)`
    ).bind("admin@example.test", admin, "admin@example.test", "Admin", timestamp, timestamp).run();
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    await sendOrganizationOverageAdminEmails(
      { ...workerEnv, SENDGRID_API_KEY: "sendgrid", ALERT_EMAIL_FROM: "noreply@example.test" },
      member,
      "2026-07-16",
      "warning",
      5,
      6,
    );

    const payload = JSON.parse(String((send.mock.calls[0][1] as RequestInit).body));
    const html = payload.content.find((item: { type: string }) => item.type === "text/html").value;
    expect(html).toContain("&lt;img src=x onerror=&quot;boom&quot;&gt;");
    expect(html).not.toContain("<img src=x");
  });

  it("escapes a user-controlled display name in verification email HTML", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const response = await registerEmail(new Request("https://example.test/api/auth/email/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "html-test@example.test",
        password: "StrongPassword!123",
        display_name: `<img src=x onerror="boom">`,
      }),
    }), {
      ...workerEnv,
      APP_BASE_URL: "https://example.test",
      SENDGRID_API_KEY: "sendgrid",
      ALERT_EMAIL_FROM: "noreply@example.test",
    });

    expect(response.status).toBe(200);
    const payload = JSON.parse(String((send.mock.calls[0][1] as RequestInit).body));
    const html = payload.content.find((item: { type: string }) => item.type === "text/html").value;
    expect(html).toContain("&lt;img src=x onerror=&quot;boom&quot;&gt;");
    expect(html).not.toContain("<img src=x");
  });

  it("uses a constant-work comparison for equal and unequal inputs", async () => {
    expect(await timingSafeEqual("runner-secret", "runner-secret")).toBe(true);
    expect(await timingSafeEqual("runner-secret", "runner-secrex")).toBe(false);
    expect(await timingSafeEqual("short", "a-much-longer-secret")).toBe(false);
  });
});
