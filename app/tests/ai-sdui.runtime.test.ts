import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { signJWT } from "../src/core/auth";

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
const executionContext = {} as ExecutionContext;
const jwtSecret = "ai-sdui-runtime-test-secret";
const defaultHash = "a".repeat(64);
const alternateHash = "b".repeat(64);
const future = "2099-01-01T00:00:00.000Z";
const past = "2020-01-01T00:00:00.000Z";

function basicEnvelope() {
  return {
    schema: "planning-harness.ai-sdui.v1",
    result_id: "result-1",
    generated_at: "2026-07-19T12:00:00+09:00",
    source: { provider: "claude", model: "claude-test" },
    card: {
      id: "result-card",
      type: "aiResultCard",
      props: { title: " Result ", summary: " Safe summary ", status: "completed" },
      children: [
        { id: "summary", type: "textBlock", props: { text: "Validated content" } },
        { id: "status", type: "statusBadge", props: { status: "completed", label: "Done" } },
      ],
      actions: [
        { id: "requirements", type: "OPEN_REQUIREMENTS", label: "Open requirements", ref_id: "req-156" },
      ],
    },
  };
}

function approvalComponent(jobId: string, payloadHash = defaultHash, expiresAt = future) {
  return {
    id: `approval-${jobId}`,
    type: "approvalCard",
    props: {
      title: "Approve deployment",
      summary: "Dry-run evidence is ready.",
      job_id: jobId,
      operation: "DEPLOY",
      payload_hash: payloadHash,
      dry_run: true,
      server_check_required: true,
      expires_at: expiresAt,
    },
    actions: [{
      id: `approve-${jobId}`,
      type: "APPROVE_JOB",
      label: "Approve",
      job_id: jobId,
      operation: "DEPLOY",
      payload_hash: payloadHash,
    }],
  };
}

async function sessionCookie(userId: string): Promise<string> {
  return `sid=${await signJWT({ sub: userId, login: userId }, jwtSecret)}`;
}

async function apiRequest(
  userId: string | null,
  path: string,
  body: unknown,
  contentType = "application/json",
): Promise<Response> {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  if (userId) headers.set("cookie", await sessionCookie(userId));
  return worker.fetch(new Request(`https://example.test${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), { ...workerEnv, JWT_SECRET: jwtSecret }, executionContext);
}

async function createApprovalJob(
  id: string,
  userId: string,
  payloadHash = defaultHash,
  expiresAt = future,
): Promise<void> {
  await workerEnv.DB.prepare(
    `INSERT INTO ai_sdui_approval_jobs
       (id, user_id, operation, payload_hash, status, dry_run, server_check_required, expires_at, created_at)
     VALUES (?, ?, 'DEPLOY', ?, 'pending', 1, 1, ?, ?)`
  ).bind(id, userId, payloadHash, expiresAt, "2026-07-19T00:00:00.000Z").run();
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await workerEnv.DB.batch([
    workerEnv.DB.prepare("DELETE FROM ai_sdui_validation_events"),
    workerEnv.DB.prepare("DELETE FROM ai_sdui_approval_jobs"),
  ]);
  for (const userId of ["alice", "bob"]) {
    await workerEnv.DB.prepare(
      "INSERT OR IGNORE INTO users (id, github_login, github_id, created_at) VALUES (?, ?, NULL, ?)"
    ).bind(userId, userId, "2026-07-19T00:00:00.000Z").run();
  }
});

describe("AI SDUI authenticated ingestion", () => {
  it("rejects anonymous requests before reading or auditing AI JSON", async () => {
    const response = await apiRequest(null, "/api/ai-sdui/validate", basicEnvelope());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "login required" });
    const count = await workerEnv.DB.prepare("SELECT COUNT(*) AS count FROM ai_sdui_validation_events").first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("returns only normalized, server-marked data with no-store", async () => {
    const response = await apiRequest("alice", "/api/ai-sdui/validate", basicEnvelope());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-ai-sdui-validated")).toBe("planning-harness.ai-sdui.v1");
    const body = await response.json() as {
      ok: boolean;
      validation: { validated: boolean };
      result: ReturnType<typeof basicEnvelope>;
    };
    expect(body.ok).toBe(true);
    expect(body.validation.validated).toBe(true);
    expect(body.result.generated_at).toBe("2026-07-19T03:00:00.000Z");
    expect(body.result.card.props.title).toBe("Result");
    expect(body.result.source.provider).toBe("claude");
  });

  it.each(["claude", "codex", "copilot", "other"])("normalizes %s into the same aiResultCard contract", async (provider) => {
    const payload = basicEnvelope();
    payload.source.provider = provider;
    const response = await apiRequest("alice", "/api/ai-sdui/validate", payload);
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { source: { provider: string }; card: { type: string } } };
    expect(body.result.source.provider).toBe(provider);
    expect(body.result.card.type).toBe("aiResultCard");
  });

  it("enforces media type and a streaming 64 KiB body limit", async () => {
    const wrongType = await apiRequest("alice", "/api/ai-sdui/validate", basicEnvelope(), "text/plain");
    expect(wrongType.status).toBe(415);
    expect(await wrongType.json()).toMatchObject({ error: { code: "unsupported_media_type", stage: "request" } });

    const oversized = await apiRequest("alice", "/api/ai-sdui/validate", `{"padding":"${"x".repeat(70 * 1024)}"}`);
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: "payload_too_large", stage: "request" } });
  });

  it("rejects in structure -> component catalog -> action order and logs fixed reasons", async () => {
    const invalidStructure = basicEnvelope();
    delete (invalidStructure as Partial<ReturnType<typeof basicEnvelope>>).card;
    expect((await apiRequest("alice", "/api/ai-sdui/validate", invalidStructure)).status).toBe(400);

    const unknownComponent = basicEnvelope();
    unknownComponent.card.children[0].type = "scriptTag";
    const componentResponse = await apiRequest("alice", "/api/ai-sdui/validate", unknownComponent);
    expect(componentResponse.status).toBe(422);
    expect(await componentResponse.json()).toMatchObject({ error: { code: "unknown_component", stage: "catalog" } });

    const unknownAction = basicEnvelope();
    unknownAction.card.actions[0].type = "OPEN_URL";
    const actionResponse = await apiRequest("alice", "/api/ai-sdui/validate", unknownAction);
    expect(actionResponse.status).toBe(422);
    expect(await actionResponse.json()).toMatchObject({ error: { code: "unknown_action", stage: "action" } });

    const rows = await workerEnv.DB.prepare(
      "SELECT stage, reason_code FROM ai_sdui_validation_events WHERE user_id='alice' ORDER BY rowid"
    ).all<{ stage: string; reason_code: string }>();
    expect(rows.results).toEqual([
      { stage: "structure", reason_code: "invalid_structure" },
      { stage: "catalog", reason_code: "unknown_component" },
      { stage: "action", reason_code: "unknown_action" },
    ]);
  });

  it("never accepts a risky operation as a directly executable action", async () => {
    const payload = basicEnvelope();
    payload.card.actions = [{
      id: "deploy-now",
      type: "DEPLOY",
      label: "Deploy now",
      ref_id: "release-1",
    }];
    const response = await apiRequest("alice", "/api/ai-sdui/validate", payload);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_action", stage: "action" } });
  });
});

describe("AI SDUI server-backed approval gate", () => {
  it("rejects missing and cross-user approval jobs without leaking ownership", async () => {
    const missing = basicEnvelope();
    missing.card.children.push(approvalComponent("missing-job"));
    const missingResponse = await apiRequest("alice", "/api/ai-sdui/validate", missing);
    expect(missingResponse.status).toBe(422);
    expect(await missingResponse.json()).toMatchObject({ error: { code: "approval_job_not_found" } });

    await createApprovalJob("alice-job", "alice");
    const crossUser = basicEnvelope();
    crossUser.card.children.push(approvalComponent("alice-job"));
    const crossResponse = await apiRequest("bob", "/api/ai-sdui/validate", crossUser);
    expect(crossResponse.status).toBe(422);
    expect(await crossResponse.json()).toMatchObject({ error: { code: "approval_job_not_found" } });
  });

  it("rejects expired and payload-hash-mismatched jobs", async () => {
    await createApprovalJob("expired-job", "alice", defaultHash, past);
    const expired = basicEnvelope();
    expired.card.children.push(approvalComponent("expired-job", defaultHash, past));
    const expiredResponse = await apiRequest("alice", "/api/ai-sdui/validate", expired);
    expect(expiredResponse.status).toBe(410);
    expect(await expiredResponse.json()).toMatchObject({ error: { code: "approval_job_expired" } });

    await createApprovalJob("hash-job", "alice", defaultHash, future);
    const mismatch = basicEnvelope();
    mismatch.card.children.push(approvalComponent("hash-job", alternateHash, future));
    const mismatchResponse = await apiRequest("alice", "/api/ai-sdui/validate", mismatch);
    expect(mismatchResponse.status).toBe(409);
    expect(await mismatchResponse.json()).toMatchObject({ error: { code: "approval_job_mismatch" } });
  });

  it("requires approvalCard + APPROVE_JOB + dry-run + server check", async () => {
    await createApprovalJob("guard-job", "alice");
    const payload = basicEnvelope();
    const card = approvalComponent("guard-job");
    card.actions = [];
    payload.card.children.push(card);
    const response = await apiRequest("alice", "/api/ai-sdui/validate", payload);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "approval_action_required", stage: "action" } });

    const withoutDryRun = basicEnvelope();
    const dryRunCard = approvalComponent("guard-job");
    dryRunCard.props.dry_run = false;
    withoutDryRun.card.children.push(dryRunCard);
    const dryRunResponse = await apiRequest("alice", "/api/ai-sdui/validate", withoutDryRun);
    expect(dryRunResponse.status).toBe(422);
    expect(await dryRunResponse.json()).toMatchObject({ error: { code: "dry_run_required", stage: "action" } });

    const withoutServerCheck = basicEnvelope();
    const serverCheckCard = approvalComponent("guard-job");
    serverCheckCard.props.server_check_required = false;
    withoutServerCheck.card.children.push(serverCheckCard);
    const serverCheckResponse = await apiRequest("alice", "/api/ai-sdui/validate", withoutServerCheck);
    expect(serverCheckResponse.status).toBe(422);
    expect(await serverCheckResponse.json()).toMatchObject({ error: { code: "server_check_required", stage: "action" } });
  });

  it("rejects missing, cross-user, expired, and hash-mismatched approval requests", async () => {
    const body = { operation: "DEPLOY", payload_hash: defaultHash };
    const missing = await apiRequest("alice", "/api/ai-sdui/approval-jobs/missing-job/approve", body);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "approval_job_not_found" } });

    await createApprovalJob("owned-job", "alice");
    const crossUser = await apiRequest("bob", "/api/ai-sdui/approval-jobs/owned-job/approve", body);
    expect(crossUser.status).toBe(404);
    expect(await crossUser.json()).toMatchObject({ error: { code: "approval_job_not_found" } });

    await createApprovalJob("expired-approval", "alice", defaultHash, past);
    const expired = await apiRequest("alice", "/api/ai-sdui/approval-jobs/expired-approval/approve", body);
    expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({ error: { code: "approval_job_expired" } });

    await createApprovalJob("mismatched-approval", "alice");
    const mismatched = await apiRequest("alice", "/api/ai-sdui/approval-jobs/mismatched-approval/approve", {
      operation: "DEPLOY",
      payload_hash: alternateHash,
    });
    expect(mismatched.status).toBe(409);
    expect(await mismatched.json()).toMatchObject({ error: { code: "approval_job_mismatch" } });
  });

  it("atomically approves exactly once under concurrent requests and never starts a dangerous executor", async () => {
    await createApprovalJob("atomic:job", "alice");
    const payload = basicEnvelope();
    payload.card.children.push(approvalComponent("atomic:job"));
    expect((await apiRequest("alice", "/api/ai-sdui/validate", payload)).status).toBe(200);

    const approvalBody = { operation: "DEPLOY", payload_hash: defaultHash };
    const responses = await Promise.all([
      apiRequest("alice", "/api/ai-sdui/approval-jobs/atomic%3Ajob/approve", approvalBody),
      apiRequest("alice", "/api/ai-sdui/approval-jobs/atomic%3Ajob/approve", approvalBody),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const approved = responses.find((response) => response.status === 200);
    const rejected = responses.find((response) => response.status === 409);
    expect(approved?.headers.get("x-ai-sdui-approved")).toBe("1");
    expect(await approved?.json()).toMatchObject({
      approval: { job_id: "atomic:job", status: "approved", operation: "DEPLOY" },
      execution: { started: false, endpoint_available: false },
    });
    expect(await rejected?.json()).toMatchObject({ error: { code: "approval_job_not_pending" } });
    const row = await workerEnv.DB.prepare(
      "SELECT status, approved_at FROM ai_sdui_approval_jobs WHERE id='atomic:job'"
    ).first<{ status: string; approved_at: string | null }>();
    expect(row?.status).toBe("approved");
    expect(row?.approved_at).toBeTruthy();
    const grants = await workerEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM ai_sdui_validation_events WHERE reason_code='approval_granted'"
    ).first<{ count: number }>();
    expect(grants?.count).toBe(1);
  });

  it("rolls back approval state when the grant audit insert fails", async () => {
    await createApprovalJob("audit-failure-job", "alice");
    await workerEnv.DB.prepare(
      `CREATE TRIGGER reject_ai_sdui_grant_audit
         BEFORE INSERT ON ai_sdui_validation_events
         WHEN NEW.reason_code='approval_granted'
       BEGIN
         SELECT RAISE(ABORT, 'forced approval audit failure');
       END;`
    ).run();
    try {
      const response = await apiRequest(
        "alice",
        "/api/ai-sdui/approval-jobs/audit-failure-job/approve",
        { operation: "DEPLOY", payload_hash: defaultHash },
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: "internal_error" } });
      const row = await workerEnv.DB.prepare(
        "SELECT status, approved_at FROM ai_sdui_approval_jobs WHERE id='audit-failure-job'"
      ).first<{ status: string; approved_at: string | null }>();
      expect(row).toEqual({ status: "pending", approved_at: null });
      const grants = await workerEnv.DB.prepare(
        "SELECT COUNT(*) AS count FROM ai_sdui_validation_events WHERE reason_code='approval_granted'"
      ).first<{ count: number }>();
      expect(grants?.count).toBe(0);
    } finally {
      await workerEnv.DB.prepare("DROP TRIGGER IF EXISTS reject_ai_sdui_grant_audit").run();
    }
  });

  it("audit schema has no raw-payload column and stores only a digest", async () => {
    const response = await apiRequest("alice", "/api/ai-sdui/validate", basicEnvelope());
    expect(response.status).toBe(200);
    const columns = await workerEnv.DB.prepare("PRAGMA table_info(ai_sdui_validation_events)").all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).not.toContain("raw_payload");
    expect(columns.results.map((column) => column.name)).not.toContain("payload_json");
    const event = await workerEnv.DB.prepare(
      "SELECT payload_sha256, reason_code FROM ai_sdui_validation_events ORDER BY rowid DESC LIMIT 1"
    ).first<{ payload_sha256: string; reason_code: string }>();
    expect(event?.payload_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(event?.reason_code).toBe("accepted");
  });

  it("removes per-user audit events beyond the explicit retention period", async () => {
    await workerEnv.DB.prepare(
      `INSERT INTO ai_sdui_validation_events
         (id, user_id, result_id, schema_id, accepted, stage, reason_code, payload_sha256, created_at)
       VALUES ('old-event', 'alice', NULL, NULL, 0, 'request', 'old_test_event', NULL, '2020-01-01T00:00:00.000Z')`
    ).run();
    expect((await apiRequest("alice", "/api/ai-sdui/validate", basicEnvelope())).status).toBe(200);
    const old = await workerEnv.DB.prepare(
      "SELECT id FROM ai_sdui_validation_events WHERE id='old-event'"
    ).first<{ id: string }>();
    expect(old).toBeNull();
  });
});
