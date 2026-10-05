import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertAgentSubscription, listAgentSubscriptions } from "../src/domains/usage";
import {
  handleAgentUsageAdapterRequest,
  processAgentUsageAutoSync,
  syncCopilotUsageForUser,
} from "../src/domains/usage";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const workerEnv = { DB: env.DB as D1Database, JWT_SECRET: "runtime-test-secret" };
const NOW = Date.parse("2026-07-19T12:00:00.000Z");
const PAT = "github_pat_TESTTOKEN1234567890abcdef";

async function addUser(userId: string) {
  await workerEnv.DB.prepare(
    "INSERT INTO users (id, github_login, github_id, created_at) VALUES (?1, ?2, NULL, ?3)"
  ).bind(userId, userId, new Date(NOW).toISOString()).run();
}

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function dispatch(path: string, method: string, body?: unknown, userId = "agent-user", nowMs = NOW) {
  const response = await handleAgentUsageAdapterRequest(request(path, method, body), workerEnv, userId, nowMs);
  if (!response) throw new Error(`route was not handled: ${path}`);
  return response;
}

function githubOk(usedRequests: number) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/user")) {
      return new Response(JSON.stringify({ login: "agent-user" }), { status: 200 });
    }
    if (url.includes("/settings/billing/premium_request/usage")) {
      return new Response(JSON.stringify({
        usageItems: [
          { product: "Copilot", sku: "Copilot Premium Request", unitType: "requests", grossQuantity: usedRequests },
          { product: "Actions", sku: "Compute", grossQuantity: 999 },
        ],
      }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await workerEnv.DB.batch([
    workerEnv.DB.prepare("DELETE FROM agent_provider_credentials"),
    workerEnv.DB.prepare("DELETE FROM agent_usage_windows"),
    workerEnv.DB.prepare("DELETE FROM agent_subscriptions"),
    workerEnv.DB.prepare("DELETE FROM users WHERE id IN ('agent-user', 'other-user')"),
  ]);
  await addUser("agent-user");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("issue #160 copilot pull adapter runtime contract", () => {
  it("requires login, a copilot subscription, and a copilot-only adapter boundary", async () => {
    const anonymous = await handleAgentUsageAdapterRequest(
      request("/api/agent-subscriptions/copilot/credential", "PUT", { pat: PAT }),
      workerEnv,
      "anon:visitor",
      NOW,
    );
    expect(anonymous?.status).toBe(401);

    const noAdapter = await dispatch("/api/agent-subscriptions/claude/sync", "POST");
    expect(noAdapter.status).toBe(400);
    expect(await noAdapter.json()).toMatchObject({ code: "adapter_unavailable" });

    vi.stubGlobal("fetch", githubOk(10));
    const withoutSubscription = await dispatch("/api/agent-subscriptions/copilot/credential", "PUT", { pat: PAT });
    expect(withoutSubscription.status).toBe(409);
    expect(await withoutSubscription.json()).toMatchObject({ code: "subscription_required" });
  });

  it("registers an encrypted PAT, runs the first sync, and never echoes the token", async () => {
    await upsertAgentSubscription(workerEnv, "agent-user", "copilot", {
      plan_label: "Pro",
      billing_interval: "monthly",
      next_renewal_on: "2026-08-19",
      timezone: "Asia/Seoul",
      renewal_source: "manual",
      verified_at: "2026-07-19T11:00:00.000Z",
    }, NOW);

    vi.stubGlobal("fetch", githubOk(120));
    const response = await dispatch("/api/agent-subscriptions/copilot/credential", "PUT", {
      pat: PAT,
      monthly_included_requests: 300,
    });
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.clone().json());
    expect(serialized).not.toContain(PAT);
    const body = await response.json() as {
      credential: { configured: boolean; account_login: string; last_sync_status: string };
      sync: { synced: boolean; used_requests: number; remaining_value: number };
      dashboard: { automatic_sync: boolean; providers: Array<Record<string, unknown>> };
    };
    expect(body.credential).toMatchObject({ configured: true, account_login: "agent-user", last_sync_status: "ok" });
    expect(body.sync).toMatchObject({ synced: true, used_requests: 120, remaining_value: 180 });
    expect(body.dashboard.automatic_sync).toBe(true);

    const stored = await workerEnv.DB.prepare(
      "SELECT credential_enc FROM agent_provider_credentials WHERE user_id='agent-user' AND provider='copilot'"
    ).first<{ credential_enc: string }>();
    expect(stored?.credential_enc).toBeTruthy();
    expect(stored?.credential_enc).not.toContain(PAT);

    const window = await workerEnv.DB.prepare(
      "SELECT status, source, remaining_value, limit_value, unit, resets_at FROM agent_usage_windows WHERE user_id='agent-user' AND provider='copilot' AND window_kind='monthly'"
    ).first<Record<string, unknown>>();
    expect(window).toMatchObject({
      status: "fresh",
      source: "provider_api",
      remaining_value: 180,
      limit_value: 300,
      unit: "requests",
      resets_at: "2026-08-01T00:00:00.000Z",
    });
  });

  it("maps provider failures to unknownReason without throwing and records the error window", async () => {
    await upsertAgentSubscription(workerEnv, "agent-user", "copilot", {
      plan_label: "Pro",
      billing_interval: "monthly",
      timezone: "Asia/Seoul",
      renewal_source: "manual",
      verified_at: "2026-07-19T11:00:00.000Z",
    }, NOW);
    vi.stubGlobal("fetch", githubOk(0));
    await dispatch("/api/agent-subscriptions/copilot/credential", "PUT", { pat: PAT, monthly_included_requests: 300 });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })));
    const result = await syncCopilotUsageForUser(workerEnv, "agent-user", NOW + 60_000);
    expect(result.synced).toBe(false);
    expect(String((result as { unknown_reason: string }).unknown_reason)).toContain("권한");

    const window = await workerEnv.DB.prepare(
      "SELECT status, remaining_value, source FROM agent_usage_windows WHERE user_id='agent-user' AND provider='copilot' AND window_kind='monthly'"
    ).first<Record<string, unknown>>();
    expect(window).toMatchObject({ status: "error", remaining_value: null, source: "provider_api" });

    const dashboard = await listAgentSubscriptions(workerEnv, "agent-user", NOW + 60_000);
    const copilot = dashboard.providers.find((item) => item.provider === "copilot") as {
      credential: { last_sync_status: string };
    };
    expect(copilot.credential.last_sync_status).toBe("error");
  });

  it("auto-sync cron only picks up stale credentials and deletion turns automatic sync off", async () => {
    await upsertAgentSubscription(workerEnv, "agent-user", "copilot", {
      plan_label: "Pro",
      billing_interval: "monthly",
      timezone: "Asia/Seoul",
      renewal_source: "manual",
      verified_at: "2026-07-19T11:00:00.000Z",
    }, NOW);
    vi.stubGlobal("fetch", githubOk(30));
    await dispatch("/api/agent-subscriptions/copilot/credential", "PUT", { pat: PAT, monthly_included_requests: 300 });

    // 방금 동기화됨 → 6시간 이내 재실행은 no-op
    const fetchSpy = githubOk(60);
    vi.stubGlobal("fetch", fetchSpy);
    await processAgentUsageAutoSync(workerEnv, NOW + 60_000);
    expect(fetchSpy).not.toHaveBeenCalled();

    // 6시간 경과 → 재수집
    await processAgentUsageAutoSync(workerEnv, NOW + 7 * 60 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalled();
    const window = await workerEnv.DB.prepare(
      "SELECT remaining_value FROM agent_usage_windows WHERE user_id='agent-user' AND provider='copilot' AND window_kind='monthly'"
    ).first<{ remaining_value: number }>();
    expect(window?.remaining_value).toBe(240);

    const deletion = await dispatch("/api/agent-subscriptions/copilot/credential", "DELETE");
    const deletionBody = await deletion.json() as { deleted: boolean; dashboard: { automatic_sync: boolean } };
    expect(deletionBody.deleted).toBe(true);
    expect(deletionBody.dashboard.automatic_sync).toBe(false);
  });
});
