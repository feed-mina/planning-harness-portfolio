import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  handleAgentSubscriptionsRequest,
  listAgentSubscriptions,
  upsertAgentSubscription,
  upsertAgentUsageWindow,
} from "../src/domains/usage";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      R2: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const workerEnv = env as unknown as { DB: D1Database };
const NOW = Date.parse("2026-07-19T12:00:00.000Z");

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

async function dispatch(path: string, method = "GET", body?: unknown, userId = "agent-user", nowMs = NOW) {
  const response = await handleAgentSubscriptionsRequest(request(path, method, body), workerEnv, userId, nowMs);
  if (!response) throw new Error(`route was not handled: ${path}`);
  return response;
}

function subscriptionInput(overrides: Record<string, unknown> = {}) {
  return {
    plan_label: "Pro",
    billing_interval: "monthly",
    next_renewal_on: "2026-08-19",
    timezone: "Asia/Seoul",
    renewal_source: "manual",
    verified_at: "2026-07-19T11:00:00.000Z",
    ...overrides,
  };
}

function windowInput(overrides: Record<string, unknown> = {}) {
  return {
    status: "fresh",
    remaining_value: 40,
    limit_value: 100,
    unit: "percent",
    resets_at: "2026-07-19T15:00:00.000Z",
    source: "manual",
    observed_at: "2026-07-19T11:00:00.000Z",
    message: "Claude /usage에서 확인",
    ...overrides,
  };
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await workerEnv.DB.batch([
    workerEnv.DB.prepare("DELETE FROM agent_usage_windows"),
    workerEnv.DB.prepare("DELETE FROM agent_subscriptions"),
    workerEnv.DB.prepare("DELETE FROM users WHERE id IN ('agent-user', 'other-user')"),
  ]);
});

describe("issue #151 agent subscription runtime contract", () => {
  it("requires authentication and always returns non-cacheable API responses", async () => {
    const response = await dispatch("/api/agent-subscriptions", "GET", undefined, "anon:browser");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ code: "login_required" });
  });

  it("returns three fixed provider cards with null, never zero, for unknown values", async () => {
    await addUser("agent-user");
    const dashboard = await listAgentSubscriptions(workerEnv, "agent-user", NOW);

    expect(dashboard.collection_mode).toBe("manual");
    expect(dashboard.automatic_sync).toBe(false);
    expect(dashboard.reset_policy).toBe("observation_required");
    expect(dashboard.required_usage_slots).toEqual(["daily", "weekly"]);
    expect(dashboard.sensitive_credentials_collected).toBe(false);
    expect(dashboard.providers.map((provider) => provider.provider)).toEqual(["claude", "codex", "copilot"]);
    expect(dashboard.providers.map((provider) => provider.supported_windows)).toEqual([
      ["weekly", "rolling_5h"],
      ["weekly", "rolling_5h"],
      ["monthly"],
    ]);
    for (const provider of dashboard.providers) {
      expect(provider.subscription).toBeNull();
      for (const requiredSlot of ["daily", "weekly"]) {
        const window = provider.windows.find((item) => item.window_kind === requiredSlot);
        expect(window, `${provider.provider} ${requiredSlot} slot`).toBeDefined();
        expect(["unconfigured", "unsupported"]).toContain(window!.status);
        expect(window!.remaining_value).toBeNull();
      }
    }
    expect(dashboard.providers[0].windows.find((window) => window.window_kind === "daily")).toMatchObject({
      status: "unsupported",
      input_supported: false,
    });
    expect(dashboard.providers[2].windows.find((window) => window.window_kind === "weekly")).toMatchObject({
      status: "unsupported",
      input_supported: false,
    });
  });

  it("runs authenticated CRUD and rejects equal or older observations without overwriting newer data", async () => {
    await addUser("agent-user");
    const subscriptionResponse = await dispatch(
      "/api/agent-subscriptions/claude",
      "PUT",
      subscriptionInput(),
    );
    expect(subscriptionResponse.status).toBe(200);
    expect((await subscriptionResponse.json() as { applied: boolean }).applied).toBe(true);

    const firstWindow = await dispatch(
      "/api/agent-subscriptions/claude/windows/rolling_5h",
      "PUT",
      windowInput(),
    );
    expect((await firstWindow.json() as { applied: boolean }).applied).toBe(true);

    const sameObservation = await upsertAgentUsageWindow(
      workerEnv,
      "agent-user",
      "claude",
      "rolling_5h",
      windowInput({ remaining_value: 99 }),
      NOW,
    );
    expect(sameObservation.applied).toBe(false);

    const olderObservation = await upsertAgentUsageWindow(
      workerEnv,
      "agent-user",
      "claude",
      "rolling_5h",
      windowInput({ remaining_value: 88, observed_at: "2026-07-19T10:00:00.000Z" }),
      NOW,
    );
    expect(olderObservation.applied).toBe(false);

    const staleSubscription = await upsertAgentSubscription(
      workerEnv,
      "agent-user",
      "claude",
      subscriptionInput({ plan_label: "Should not win", verified_at: "2026-07-19T10:00:00.000Z" }),
      NOW,
    );
    expect(staleSubscription.applied).toBe(false);

    const dashboard = await listAgentSubscriptions(workerEnv, "agent-user", NOW);
    const claude = dashboard.providers[0];
    expect(claude.subscription?.plan_label).toBe("Pro");
    expect(claude.windows.find((window) => window.window_kind === "rolling_5h")).toMatchObject({
      status: "fresh",
      remaining_value: 40,
      limit_value: 100,
    });
  });

  it("marks an expired window stale and does not estimate a full allowance after reset", async () => {
    await addUser("agent-user");
    await upsertAgentSubscription(workerEnv, "agent-user", "codex", subscriptionInput(), NOW);
    await upsertAgentUsageWindow(workerEnv, "agent-user", "codex", "weekly", windowInput({
      remaining_value: 25,
      resets_at: "2026-07-19T12:30:00.000Z",
    }), NOW);

    const dashboard = await listAgentSubscriptions(workerEnv, "agent-user", Date.parse("2026-07-19T13:00:00.000Z"));
    const weekly = dashboard.providers.find((provider) => provider.provider === "codex")!.windows
      .find((window) => window.window_kind === "weekly")!;
    expect(weekly.status).toBe("stale");
    expect(weekly.remaining_value).toBeNull();
    expect(weekly.recorded_remaining_value).toBe(25);
    expect(weekly.message).toContain("새 값을 확인");
  });

  it("validates provider windows, renewal dates, timezones, unknown values, and sensitive fields", async () => {
    await addUser("agent-user");

    const oversized = await dispatch(
      "/api/agent-subscriptions/claude",
      "PUT",
      subscriptionInput({ note: "x".repeat(33 * 1024) }),
    );
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ code: "payload_too_large" });

    const malformedPath = await dispatch(
      "/api/agent-subscriptions/%E0%A4%A",
      "PUT",
      subscriptionInput(),
    );
    expect(malformedPath.status).toBe(400);
    expect(await malformedPath.json()).toMatchObject({ code: "invalid_path_encoding" });

    const badTimezone = await dispatch("/api/agent-subscriptions/claude", "PUT", subscriptionInput({ timezone: "Moon/Base" }));
    expect(badTimezone.status).toBe(400);
    expect(await badTimezone.json()).toMatchObject({ code: "invalid_timezone" });

    const pastRenewal = await dispatch("/api/agent-subscriptions/claude", "PUT", subscriptionInput({ next_renewal_on: "2026-07-18" }));
    expect(pastRenewal.status).toBe(400);
    expect(await pastRenewal.json()).toMatchObject({ code: "past_renewal_date" });

    const secret = await dispatch("/api/agent-subscriptions/claude", "PUT", subscriptionInput({ access_token: "never-store-this" }));
    expect(secret.status).toBe(400);
    expect(await secret.json()).toMatchObject({ code: "sensitive_field_forbidden" });

    const forgedRenewalSource = await dispatch(
      "/api/agent-subscriptions/claude",
      "PUT",
      subscriptionInput({ renewal_source: "provider_api" }),
    );
    expect(forgedRenewalSource.status).toBe(400);
    expect(await forgedRenewalSource.json()).toMatchObject({ code: "untrusted_source" });

    await upsertAgentSubscription(workerEnv, "agent-user", "codex", subscriptionInput(), NOW);
    const inventedWindow = await dispatch(
      "/api/agent-subscriptions/codex/windows/monthly",
      "PUT",
      windowInput(),
    );
    expect(inventedWindow.status).toBe(400);
    expect(await inventedWindow.json()).toMatchObject({ code: "unsupported_window" });

    const explicitlyUnsupportedDaily = await dispatch(
      "/api/agent-subscriptions/codex/windows/daily",
      "PUT",
      windowInput(),
    );
    expect(explicitlyUnsupportedDaily.status).toBe(400);
    expect(await explicitlyUnsupportedDaily.json()).toMatchObject({ code: "unsupported_window" });

    // REQ-205 이원화(#160): 로그인 사용자의 로컬 브리지 push(source=local_bridge)는 수용하고,
    // provider_api는 서버 내부 어댑터 전용으로 계속 차단한다.
    const forgedWindowSource = await dispatch(
      "/api/agent-subscriptions/codex/windows/weekly",
      "PUT",
      windowInput({ source: "provider_api" }),
    );
    expect(forgedWindowSource.status).toBe(400);
    expect(await forgedWindowSource.json()).toMatchObject({ code: "untrusted_source" });

    const localBridgeWindow = await dispatch(
      "/api/agent-subscriptions/codex/windows/weekly",
      "PUT",
      windowInput({ source: "local_bridge" }),
    );
    expect(localBridgeWindow.status).toBe(200);
    const localBridgeBody = await localBridgeWindow.json();
    expect(localBridgeBody.applied).toBe(true);
    const codexDashboard = localBridgeBody.dashboard.providers.find((item: { provider: string }) => item.provider === "codex");
    expect(codexDashboard.windows.find((item: { window_kind: string }) => item.window_kind === "weekly").source).toBe("local_bridge");

    await expect(workerEnv.DB.prepare(
      `INSERT INTO agent_usage_windows
         (id, user_id, provider, window_kind, remaining_value, limit_value, unit, resets_at,
          source, status, observed_at, message, created_at, updated_at)
       VALUES ('hidden-invalid-window', 'agent-user', 'codex', 'monthly', NULL, NULL, 'unknown', NULL,
               'manual', 'unconfigured', ?1, NULL, ?1, ?1)`
    ).bind(new Date(NOW).toISOString()).run()).rejects.toThrow();

    const unknownAsZero = await dispatch(
      "/api/agent-subscriptions/codex/windows/weekly",
      "PUT",
      windowInput({ status: "unconfigured", remaining_value: 0, resets_at: null }),
    );
    expect(unknownAsZero.status).toBe(400);
    expect(await unknownAsZero.json()).toMatchObject({ code: "unknown_must_be_null" });

    expect(await workerEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM agent_subscriptions WHERE user_id='agent-user' AND provider='claude'"
    ).first<{ count: number }>()).toMatchObject({ count: 0 });
  });

  it("isolates users and cascades window deletion only for the selected subscription", async () => {
    await addUser("agent-user");
    await addUser("other-user");
    for (const userId of ["agent-user", "other-user"]) {
      await upsertAgentSubscription(workerEnv, userId, "copilot", subscriptionInput({ plan_label: userId }), NOW);
      await upsertAgentUsageWindow(workerEnv, userId, "copilot", "monthly", windowInput({
        unit: "requests",
        remaining_value: userId === "agent-user" ? 10 : 20,
        limit_value: 300,
      }), NOW);
    }

    const ownDashboard = await listAgentSubscriptions(workerEnv, "agent-user", NOW);
    expect(ownDashboard.providers[2].subscription?.plan_label).toBe("agent-user");
    expect(ownDashboard.providers[2].windows.find((window) => window.window_kind === "monthly")?.remaining_value).toBe(10);

    const deleted = await dispatch("/api/agent-subscriptions/copilot", "DELETE");
    expect((await deleted.json() as { deleted: boolean }).deleted).toBe(true);
    expect(await workerEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM agent_usage_windows WHERE user_id='agent-user'"
    ).first<{ count: number }>()).toMatchObject({ count: 0 });
    expect(await workerEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM agent_usage_windows WHERE user_id='other-user'"
    ).first<{ count: number }>()).toMatchObject({ count: 1 });
  });
});
