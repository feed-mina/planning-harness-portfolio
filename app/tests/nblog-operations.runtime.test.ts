import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  authenticateNBlogBearer,
  handleNBlogApi,
  handleNBlogHandoffSessionApi,
  handleNBlogUpload,
  NBLOG_CONTRACT_VERSION,
  nblogErrorResponse,
  runNBlogWorkflowReconciliation,
  stableStringify,
  withNBlogResponseHeaders,
  type NBlogActor,
  type NBlogEnv,
} from "../src/domains/nblog";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      R2: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const actor: NBlogActor = { userId: "qa-user", label: "QA operator", viaToken: false };
const syncActor: NBlogActor = { userId: "qa-user", label: "QA CLI", viaToken: true };
const workerEnv = env as unknown as NBlogEnv;

async function dispatch(request: Request, requestActor: NBlogActor = actor, requestEnv: NBlogEnv = workerEnv): Promise<Response> {
  try {
    const response = await handleNBlogApi(request, requestEnv, requestActor);
    if (!response) return new Response("not found", { status: 404 });
    return withNBlogResponseHeaders(response, request);
  } catch (error) {
    return nblogErrorResponse(error, request);
  }
}

async function dispatchUpload(request: Request, requestEnv: NBlogEnv = workerEnv): Promise<Response> {
  try {
    const response = await handleNBlogUpload(request, requestEnv);
    if (!response) return new Response("not found", { status: 404 });
    return withNBlogResponseHeaders(response, request);
  } catch (error) {
    return nblogErrorResponse(error, request);
  }
}

async function dispatchHandoff(request: Request): Promise<Response> {
  try {
    const response = await handleNBlogHandoffSessionApi(request, workerEnv);
    if (!response) return new Response("not found", { status: 404 });
    return withNBlogResponseHeaders(response, request);
  } catch (error) {
    return nblogErrorResponse(error, request);
  }
}

function apiRequest(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      "x-nblog-contract-version": NBLOG_CONTRACT_VERSION,
      "x-request-id": "runtime-test-request",
      ...(!["GET", "HEAD"].includes(method.toUpperCase()) ? { "idempotency-key": "runtime-test-request" } : {}),
      ...(!["GET", "HEAD"].includes(method.toUpperCase()) ? { origin: "https://example.test" } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function campaignInput(id: string) {
  return {
    campaign_id: id,
    campaign_name: "Runtime QA campaign",
    campaign_url: "https://example.com/campaign",
    place_url: "https://map.naver.com/p/example",
    visit_date: "2026-07-15",
    visit_notes: "Visited for the runtime integration test.",
    tone_profile: "honest reviewer",
    user_tags: ["체험단", "런타임QA"],
    source_folder: "source/runtime-qa",
  };
}

async function createCampaign(id: string): Promise<Record<string, unknown>> {
  const response = await dispatch(apiRequest("/api/nblog/campaigns", "POST", campaignInput(id)));
  expect(response.status).toBe(201);
  expect(response.headers.get("x-nblog-contract-version")).toBe(NBLOG_CONTRACT_VERSION);
  return response.json() as Promise<Record<string, unknown>>;
}

async function syncCampaign(
  id: string,
  passed: boolean,
  requestActor: NBlogActor = actor,
  expectedStatus = 201,
  hashCase: "lower" | "upper" = "lower",
  draftOverrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const draft = {
    campaign_id: id,
    draft_version: "draft-v1",
    markdown: "# Runtime QA",
    prompt: { profile_version: "profile-v1", rendered_hash: "prompt-v1" },
    ...draftOverrides,
  };
  const draftMarkdown = typeof draftOverrides.markdown === "string"
    ? draftOverrides.markdown
    : "# Runtime QA\n\nUser-confirmed content only.";
  const artifacts = {
    manifest: { campaign_id: id, media: [] },
    requirements: { campaign_id: id, snapshot_hash: "requirements-v1" },
    draft,
    draft_markdown: draftMarkdown,
    validation: {
      campaign_id: id,
      status: passed ? "passed" : "failed",
      approval_allowed: passed,
      validator_version: "validator-v1",
      checks: passed ? [] : [{ rule: "minimum_images", status: "error", message: "At least 15 images are required." }],
    },
    preview_html: "<!doctype html><title>Runtime QA</title><script>fetch('/api/nblog/campaigns')</script>",
  };
  const canonicalContentHash = `sha256:${await sha256(stableStringify(artifacts))}`;
  const contentHash = hashCase === "upper" ? canonicalContentHash.toUpperCase() : canonicalContentHash;
  const response = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/artifacts`, "POST", {
    contract_version: NBLOG_CONTRACT_VERSION,
    schema_version: "1.0",
    content_hash: contentHash,
    idempotency_key: `${id}:2026-07-15`,
    artifacts,
  }, { "idempotency-key": `${id}:2026-07-15` }), requestActor);
  expect(response.status).toBe(expectedStatus);
  return response.json() as Promise<Record<string, unknown>>;
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("NBlog issue #18 runtime contract", () => {
  it("confirms exactly the generated artifact version after the user reviews the draft", async () => {
    const id = "NB-WORKER-CONFIRM";
    await createCampaign(id);
    const synced = await syncCampaign(id, true);
    await workerEnv.DB.prepare(
      "UPDATE nblog_campaigns SET generation_status='awaiting_content_review',generation_input_hash='sha256:test-input' WHERE user_id=?1 AND campaign_id=?2"
    ).bind(actor.userId, id).run();

    const stale = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/content-confirmations`, "POST", {
      confirmed: true,
      expected_artifact_version: Number(synced.artifact_version) + 1,
    }));
    expect(stale.status).toBe(409);
    expect((await stale.json() as { error: { code: string } }).error.code).toBe("artifact_version_conflict");

    const confirmed = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/content-confirmations`, "POST", {
      confirmed: true,
      expected_artifact_version: synced.artifact_version,
    }));
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      campaign_id: id,
      generation_status: "content_confirmed",
      operation_status: "approved_for_handoff",
      artifact_version: synced.artifact_version,
    });
    const persisted = await workerEnv.DB.prepare(
      "SELECT generation_status,content_confirmed_artifact_version FROM nblog_campaigns WHERE user_id=?1 AND campaign_id=?2"
    ).bind(actor.userId, id).first<{ generation_status: string; content_confirmed_artifact_version: number }>();
    expect(persisted).toEqual({ generation_status: "content_confirmed", content_confirmed_artifact_version: synced.artifact_version });
  });

  it("runs create, sync, approval, one-time handoff claim, and checkpoint on real D1/R2 bindings", async () => {
    const id = "NB-RUNTIME-001";
    await createCampaign(id);
    const synced = await syncCampaign(id, true);
    expect(synced.operation_status).toBe("approval_waiting");

    const approval = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/approve`, "POST", {
      confirmed: true,
      expected_version: synced.version,
    }));
    expect(approval.status).toBe(200);
    const approved = await approval.json() as Record<string, unknown>;
    expect(approved.operation_status).toBe("approved_for_handoff");

    const issuedResponse = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/handoff-sessions`, "POST", {
      expected_version: approved.version,
      expires_in_seconds: 900,
    }));
    expect(issuedResponse.status).toBe(201);
    const issued = await issuedResponse.json() as {
      claim_token: string;
      handoff_session: { id: string; artifact_version: number };
    };
    expect(issued.claim_token).toMatch(/^nbh_/);
    expect(issued.handoff_session.artifact_version).toBe(1);
    const persistedSession = await workerEnv.DB.prepare(
      "SELECT created_at, expires_at FROM nblog_handoff_sessions WHERE id=?1"
    ).bind(issued.handoff_session.id).first<{ created_at: string; expires_at: string }>();
    expect(Date.parse(persistedSession!.expires_at) - Date.parse(persistedSession!.created_at)).toBe(600_000);

    const claimPath = `/api/nblog/handoff-sessions/${issued.handoff_session.id}/claim`;
    const claimResponse = await dispatchHandoff(apiRequest(claimPath, "POST", undefined, { authorization: `Bearer ${issued.claim_token}` }));
    expect(claimResponse.status).toBe(200);
    const claimed = await claimResponse.json() as {
      session_token: string;
      handoff_session: { status: string };
      bundle: { campaign_version: number; bundle_checksum: string };
      safety: {
        automatic_input_allowed: string[];
        manual_user_actions_required: string[];
        final_publish_requires_user_action: boolean;
      };
    };
    expect(claimed.session_token).toMatch(/^nbhs_/);
    expect(claimed.handoff_session.status).toBe("browser_connected");
    expect(claimed.bundle.bundle_checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(claimed.safety.automatic_input_allowed).toEqual(["title", "body", "tags"]);
    expect(claimed.safety.manual_user_actions_required).toEqual(["login", "captcha", "media", "place", "preview", "publish"]);
    expect(claimed.safety.final_publish_requires_user_action).toBe(true);

    const replay = await dispatchHandoff(apiRequest(claimPath, "POST", undefined, { authorization: `Bearer ${issued.claim_token}` }));
    expect(replay.status).toBe(401);
    expect((await replay.json() as { error: { retryable: boolean } }).error.retryable).toBe(false);

    const checkpointResponse = await dispatchHandoff(apiRequest(
      `/api/nblog/handoff-sessions/${issued.handoff_session.id}/checkpoints`,
      "POST",
      {
        status: "input_in_progress",
        resume_stage: "smart-editor",
        resume_point: "Insert approved draft",
        completed_steps: ["browser_connected"],
        remaining_steps: ["insert_content", "user_review", "user_publish"],
        expected_version: claimed.bundle.campaign_version,
      },
      { authorization: `Bearer ${claimed.session_token}` },
    ));
    expect(checkpointResponse.status).toBe(201);
    expect((await checkpointResponse.json() as { handoff_session: { status: string } }).handoff_session.status).toBe("input_in_progress");
  });

  it("canonicalizes Worker draft fallbacks, trailing tags, place data, and media markers", async () => {
    const id = "NB-RUNTIME-HANDOFF-BUNDLE";
    await createCampaign(id);
    const synced = await syncCampaign(id, true, actor, 201, "lower", {
      title: "Worker draft title",
      markdown: "Approved body\n\n#태그",
    });
    const approvalResponse = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/approve`, "POST", {
      confirmed: true,
      expected_version: synced.version,
    }));
    const approved = await approvalResponse.json() as Record<string, unknown>;
    const now = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT INTO nblog_media_assets
       (user_id, campaign_id, media_id, type, original_name, object_key, content_type, size,
        checksum, sort_order, included, is_cover, status, updated_at)
       VALUES (?1, ?2, ?3, 'image', 'photo.jpg', ?4, 'image/jpeg', 3456, ?5, 1, 1, 0, 'ready', ?6)`
    ).bind(actor.userId, id, "media-1", `nblog/runtime/${id}/photo.jpg`, `sha256:${"a".repeat(64)}`, now).run();

    const issueResponse = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/handoff-sessions`, "POST", {
      expected_version: approved.version,
    }));
    const issued = await issueResponse.json() as { claim_token: string; handoff_session: { id: string } };
    const claimResponse = await dispatchHandoff(apiRequest(
      `/api/nblog/handoff-sessions/${issued.handoff_session.id}/claim`,
      "POST",
      undefined,
      { authorization: `Bearer ${issued.claim_token}` },
    ));
    expect(claimResponse.status).toBe(200);
    const claimed = await claimResponse.json() as {
      bundle: {
        content: {
          selected_title: string;
          markdown: string;
          body: string;
          tags: string[];
          place: Record<string, unknown>;
        };
        media_plan: Array<Record<string, unknown>>;
      };
    };
    expect(claimed.bundle.content).toMatchObject({
      selected_title: "Worker draft title",
      markdown: "Approved body\n\n#태그",
      body: "Approved body",
      tags: ["태그"],
      place: {
        campaign_name: "Runtime QA campaign",
        address: null,
        place_url: "https://map.naver.com/p/example",
        automatic_selection_allowed: false,
        user_selection_required: true,
      },
    });
    expect(claimed.bundle.media_plan).toEqual([
      expect.objectContaining({
        media_id: "media-1",
        content_type: "image/jpeg",
        size: 3456,
        status: "ready",
        marker: "[IMAGE:001]",
        ready: true,
      }),
    ]);
  });

  it("enforces every persisted handoff action and blocks browser publication states", async () => {
    const id = "NB-RUNTIME-HANDOFF-SCOPE";
    await createCampaign(id);
    const synced = await syncCampaign(id, true);
    const approvalResponse = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/approve`, "POST", {
      confirmed: true,
      expected_version: synced.version,
    }));
    const approved = await approvalResponse.json() as Record<string, unknown>;
    const issueResponse = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/handoff-sessions`, "POST", {
      expected_version: approved.version,
    }));
    expect(issueResponse.status).toBe(201);
    const issued = await issueResponse.json() as { claim_token: string; handoff_session: { id: string } };
    const sessionId = issued.handoff_session.id;
    const claimPath = `/api/nblog/handoff-sessions/${sessionId}/claim`;

    await workerEnv.DB.prepare("UPDATE nblog_handoff_sessions SET allowed_actions_json=?1 WHERE id=?2")
      .bind(JSON.stringify(["read_bundle", "read_media", "write_checkpoint"]), sessionId).run();
    const forbiddenClaim = await dispatchHandoff(apiRequest(
      claimPath,
      "POST",
      undefined,
      { authorization: `Bearer ${issued.claim_token}` },
    ));
    expect(forbiddenClaim.status).toBe(403);
    expect(await forbiddenClaim.json()).toMatchObject({
      error: { code: "handoff_action_forbidden", requested_action: "claim" },
    });

    await workerEnv.DB.prepare("UPDATE nblog_handoff_sessions SET allowed_actions_json=?1 WHERE id=?2")
      .bind(JSON.stringify(["claim", "read_bundle", "read_media", "write_checkpoint"]), sessionId).run();
    const claimResponse = await dispatchHandoff(apiRequest(
      claimPath,
      "POST",
      undefined,
      { authorization: `Bearer ${issued.claim_token}` },
    ));
    expect(claimResponse.status).toBe(200);
    const claimed = await claimResponse.json() as {
      session_token: string;
      bundle: { campaign_version: number };
    };
    const authorization = { authorization: `Bearer ${claimed.session_token}` };

    await workerEnv.DB.prepare("UPDATE nblog_handoff_sessions SET allowed_actions_json=?1 WHERE id=?2")
      .bind(JSON.stringify(["read_media", "write_checkpoint"]), sessionId).run();
    const forbiddenBundle = await dispatchHandoff(apiRequest(
      `/api/nblog/handoff-sessions/${sessionId}`,
      "GET",
      undefined,
      authorization,
    ));
    expect(forbiddenBundle.status).toBe(403);
    expect(await forbiddenBundle.json()).toMatchObject({
      error: { code: "handoff_action_forbidden", requested_action: "read_bundle" },
    });

    await workerEnv.DB.prepare("UPDATE nblog_handoff_sessions SET allowed_actions_json=?1 WHERE id=?2")
      .bind(JSON.stringify(["read_bundle", "write_checkpoint"]), sessionId).run();
    const forbiddenMedia = await dispatchHandoff(apiRequest(
      `/api/nblog/handoff-sessions/${sessionId}/media/missing-media`,
      "GET",
      undefined,
      authorization,
    ));
    expect(forbiddenMedia.status).toBe(403);
    expect(await forbiddenMedia.json()).toMatchObject({
      error: { code: "handoff_action_forbidden", requested_action: "read_media" },
    });

    await workerEnv.DB.prepare("UPDATE nblog_handoff_sessions SET allowed_actions_json=?1 WHERE id=?2")
      .bind(JSON.stringify(["read_bundle", "read_media"]), sessionId).run();
    const forbiddenCheckpoint = await dispatchHandoff(apiRequest(
      `/api/nblog/handoff-sessions/${sessionId}/checkpoints`,
      "POST",
      {
        status: "input_in_progress",
        resume_stage: "smart-editor",
        resume_point: "Insert approved draft",
        completed_steps: ["browser_connected"],
        remaining_steps: ["insert_content", "user_review", "user_publish"],
        expected_version: claimed.bundle.campaign_version,
      },
      authorization,
    ));
    expect(forbiddenCheckpoint.status).toBe(403);
    expect(await forbiddenCheckpoint.json()).toMatchObject({
      error: { code: "handoff_action_forbidden", requested_action: "write_checkpoint" },
    });

    await workerEnv.DB.prepare("UPDATE nblog_handoff_sessions SET allowed_actions_json=?1 WHERE id=?2")
      .bind(JSON.stringify(["read_bundle", "read_media", "write_checkpoint"]), sessionId).run();
    for (const status of ["draft_saved", "publishing", "publish_result_unknown", "published"]) {
      const response = await dispatchHandoff(apiRequest(
        `/api/nblog/handoff-sessions/${sessionId}/checkpoints`,
        "POST",
        {
          status,
          resume_stage: "smart-editor",
          resume_point: "User review required",
          completed_steps: ["browser_connected"],
          remaining_steps: ["user_review", "user_publish"],
          expected_version: claimed.bundle.campaign_version,
        },
        authorization,
      ));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_handoff_status" } });
    }
  });

  it("blocks approval and handoff when validation fails", async () => {
    const id = "NB-RUNTIME-FAIL";
    await createCampaign(id);
    const synced = await syncCampaign(id, false);
    expect(synced.operation_status).toBe("validation_failed");

    const approval = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/approve`, "POST", {
      confirmed: true,
      expected_version: synced.version,
    }));
    expect(approval.status).toBe(409);
    const error = await approval.json() as { request_id: string; error: { code: string; retryable: boolean; resume_point: string | null } };
    expect(error.request_id).toBe("runtime-test-request");
    expect(error.error.code).toBe("validation_required");
    expect(error.error.retryable).toBe(false);
    expect(error.error.resume_point).toBeNull();

    const handoff = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/handoff-sessions`, "POST", {
      expected_version: synced.version,
    }));
    expect(handoff.status).toBe(409);
    const handoffError = await handoff.json() as { error: { code: string; retryable: boolean } };
    expect(handoffError.error.code).toBe("handoff_gate_blocked");
    expect(handoffError.error.retryable).toBe(false);
  });

  it("expires an unclaimed handoff token and marks the session non-retryable", async () => {
    const id = "NB-RUNTIME-EXPIRED-CLAIM";
    await createCampaign(id);
    const synced = await syncCampaign(id, true);
    const approvalResponse = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/approve`, "POST", {
      confirmed: true,
      expected_version: synced.version,
    }));
    const approved = await approvalResponse.json() as Record<string, unknown>;
    const issueResponse = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/handoff-sessions`, "POST", {
      expected_version: approved.version,
    }));
    expect(issueResponse.status).toBe(201);
    const issued = await issueResponse.json() as { claim_token: string; handoff_session: { id: string } };
    await workerEnv.DB.prepare("UPDATE nblog_handoff_sessions SET expires_at=?1 WHERE id=?2")
      .bind("2020-01-01T00:00:00.000Z", issued.handoff_session.id).run();

    const claimResponse = await dispatchHandoff(apiRequest(
      `/api/nblog/handoff-sessions/${issued.handoff_session.id}/claim`,
      "POST",
      undefined,
      { authorization: `Bearer ${issued.claim_token}` },
    ));
    expect(claimResponse.status).toBe(410);
    const claimError = await claimResponse.json() as { error: { code: string; retryable: boolean } };
    expect(claimError.error).toMatchObject({ code: "handoff_session_expired", retryable: false });
    const session = await workerEnv.DB.prepare("SELECT status FROM nblog_handoff_sessions WHERE id=?1")
      .bind(issued.handoff_session.id).first<{ status: string }>();
    expect(session?.status).toBe("expired");
  });

  it("reuses an identical artifact sync without adding another D1 version row", async () => {
    const id = "NB-RUNTIME-ARTIFACT-REUSE";
    await createCampaign(id);
    const first = await syncCampaign(id, true);
    const replay = await syncCampaign(id, true, actor, 200, "upper");

    expect(first.artifact_version).toBe(1);
    expect(replay).toMatchObject({ artifact_version: 1, reused: true });
    expect(replay.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    const count = await workerEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM nblog_artifact_versions WHERE user_id=?1 AND campaign_id=?2"
    ).bind(actor.userId, id).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("canonicalizes actual Naver post URLs and rejects base or legacy duplicates", async () => {
    const firstId = "NB-RUNTIME-PUBLICATION-A";
    const secondId = "NB-RUNTIME-PUBLICATION-B";
    await createCampaign(firstId);
    const firstSynced = await syncCampaign(firstId, true);
    const firstApprovalResponse = await dispatch(apiRequest(`/api/nblog/campaigns/${firstId}/approve`, "POST", {
      confirmed: true,
      expected_version: firstSynced.version,
    }));
    const firstApproved = await firstApprovalResponse.json() as Record<string, unknown>;
    const checklist = { title: true, sponsor_disclosure: true, map: true, media: true, tags: true };

    const baseUrl = await dispatch(apiRequest(`/api/nblog/campaigns/${firstId}/publish-result`, "POST", {
      expected_version: firstApproved.version,
      published_url: "https://blog.naver.com/myelin24",
      published_at: "2026-07-18T01:00:00.000Z",
      checklist,
    }));
    expect(baseUrl.status).toBe(400);
    expect((await baseUrl.json() as { error: { code: string } }).error.code).toBe("invalid_published_url");

    const firstPublication = await dispatch(apiRequest(`/api/nblog/campaigns/${firstId}/publish-result`, "POST", {
      expected_version: firstApproved.version,
      published_url: "https://m.blog.naver.com/PostView.naver?blogId=Myelin24&logNo=000223999000111&utm_source=qa#fragment",
      published_at: "2026-07-18T01:00:00.000Z",
      checklist,
    }));
    expect(firstPublication.status).toBe(201);
    expect((await firstPublication.json() as { published_url: string }).published_url)
      .toBe("https://blog.naver.com/myelin24/223999000111");

    // Simulate a pre-canonicalization row. Duplicate checks must normalize
    // existing history, not only compare newly stored canonical strings.
    await workerEnv.DB.batch([
      workerEnv.DB.prepare("UPDATE nblog_publication_history SET published_url=?1 WHERE user_id=?2 AND campaign_id=?3")
        .bind("https://m.blog.naver.com/Myelin24/000223999000111?legacy=1#saved", actor.userId, firstId),
      workerEnv.DB.prepare("UPDATE nblog_campaigns SET published_url=NULL WHERE user_id=?1 AND campaign_id=?2")
        .bind(actor.userId, firstId),
    ]);

    await createCampaign(secondId);
    const secondSynced = await syncCampaign(secondId, true);
    const secondApprovalResponse = await dispatch(apiRequest(`/api/nblog/campaigns/${secondId}/approve`, "POST", {
      confirmed: true,
      expected_version: secondSynced.version,
    }));
    const secondApproved = await secondApprovalResponse.json() as Record<string, unknown>;
    const duplicate = await dispatch(apiRequest(`/api/nblog/campaigns/${secondId}/publish-result`, "POST", {
      expected_version: secondApproved.version,
      published_url: "https://blog.naver.com/myelin24/223999000111?from=duplicate#fragment",
      published_at: "2026-07-18T01:05:00.000Z",
      checklist,
    }));
    expect(duplicate.status).toBe(409);
    const duplicateError = await duplicate.json() as { error: { code: string; campaign_id: string } };
    expect(duplicateError.error).toMatchObject({ code: "duplicate_published_url", campaign_id: firstId });
  });

  it("rejects absolute local paths and mismatched contract versions", async () => {
    const unsafe = await dispatch(apiRequest("/api/nblog/campaigns", "POST", {
      ...campaignInput("NB-RUNTIME-PATH"),
      source_folder: "D:\\private\\source",
    }));
    expect(unsafe.status).toBe(400);
    expect((await unsafe.json() as { error: { code: string } }).error.code).toBe("absolute_path_rejected");

    const mismatch = await dispatch(apiRequest("/api/nblog/campaigns", "GET", undefined, {
      "x-nblog-contract-version": "2.0",
    }));
    expect(mismatch.status).toBe(409);
    const body = await mismatch.json() as { contract_version: string; error: { code: string; expected_contract_version: string } };
    expect(body.contract_version).toBe(NBLOG_CONTRACT_VERSION);
    expect(body.error.code).toBe("contract_version_mismatch");
    expect(body.error.expected_contract_version).toBe(NBLOG_CONTRACT_VERSION);
  });

  it("replays safe mutations for the same idempotency key and rejects payload conflicts", async () => {
    const id = "NB-RUNTIME-IDEMPOTENT";
    const first = await dispatch(apiRequest("/api/nblog/campaigns", "POST", campaignInput(id), { "idempotency-key": "create-idempotent" }));
    expect(first.status).toBe(201);
    const original = await first.json() as { version: number };

    const replay = await dispatch(apiRequest("/api/nblog/campaigns", "POST", campaignInput(id), { "idempotency-key": "create-idempotent" }));
    expect(replay.status).toBe(201);
    expect(replay.headers.get("x-idempotent-replay")).toBe("true");
    expect((await replay.json() as { version: number }).version).toBe(original.version);

    const conflict = await dispatch(apiRequest("/api/nblog/campaigns", "POST", {
      ...campaignInput(id),
      campaign_name: "Different payload",
    }, { "idempotency-key": "create-idempotent" }));
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as { error: { code: string } }).error.code).toBe("idempotency_key_conflict");
  });

  it("limits CLI sync tokens to synchronization writes", async () => {
    const id = "NB-RUNTIME-SCOPE";
    const rawToken = `nbs_${"a".repeat(48)}`;
    await workerEnv.DB.prepare(
      "INSERT INTO nblog_sync_tokens (id, user_id, token_hash, label, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
    ).bind(crypto.randomUUID(), syncActor.userId, await sha256(rawToken), syncActor.label, new Date().toISOString()).run();
    const authenticated = await authenticateNBlogBearer(new Request("https://example.test/api/campaigns", {
      headers: { authorization: `Bearer ${rawToken}` },
    }), workerEnv);
    expect(authenticated).toMatchObject(syncActor);

    const created = await dispatch(apiRequest("/api/nblog/campaigns", "POST", campaignInput(id)), authenticated!);
    expect(created.status).toBe(201);
    const synced = await syncCampaign(id, true, syncActor);
    expect(synced.artifact_version).toBe(1);

    const bytes = new TextEncoder().encode("abc");
    const checksum = `sha256:${await sha256("abc")}`;
    const initializedResponse = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/media/upload-init`, "POST", {
      files: [{ media_id: "media-1", original_name: "photo.jpg", content_type: "image/jpeg", size: bytes.byteLength, checksum, order: 1 }],
    }), syncActor);
    expect(initializedResponse.status).toBe(201);
    const initialized = await initializedResponse.json() as { uploads: Array<{ upload_url: string; object_key: string; headers: Record<string, string> }> };
    const upload = initialized.uploads[0];
    expect(new URL(upload.upload_url).search).toBe("");
    expect(upload.headers.Authorization).toMatch(/^Bearer nbu_/);

    const queryOnly = new URL(upload.upload_url);
    queryOnly.searchParams.set("token", upload.headers.Authorization.replace(/^Bearer\s+/, ""));
    const queryOnlyResponse = await dispatchUpload(new Request(queryOnly, { method: "PUT" }));
    expect(queryOnlyResponse.status).toBe(401);

    const uploadResponse = await dispatchUpload(new Request(upload.upload_url, {
      method: "PUT",
      headers: { ...upload.headers, "content-length": String(bytes.byteLength) },
      body: bytes,
    }));
    expect(uploadResponse.status).toBe(200);
    const completedResponse = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/media/upload-complete`, "POST", {
      files: [{ media_id: "media-1", object_key: upload.object_key }],
    }), syncActor);
    expect(completedResponse.status).toBe(200);

    const forbiddenRoutes = [
      apiRequest("/api/nblog/campaigns", "GET"),
      apiRequest(`/api/nblog/campaigns/${id}`, "GET"),
      apiRequest(`/api/nblog/campaigns/${id}/validation`, "GET"),
      apiRequest(`/api/nblog/campaigns/${id}/preview`, "GET"),
      apiRequest(`/api/nblog/campaigns/${id}/handoff`, "GET"),
      apiRequest(`/api/nblog/campaigns/${id}/approve`, "POST", { confirmed: true, expected_version: 1 }),
      apiRequest(`/api/nblog/campaigns/${id}/retry`, "POST", {}),
      apiRequest(`/api/nblog/campaigns/${id}/generate`, "POST", {}),
      apiRequest(`/api/nblog/campaigns/${id}/publish-result`, "POST", {}),
      apiRequest(`/api/nblog/campaigns/${id}/publication`, "PATCH", {}),
      apiRequest(`/api/nblog/campaigns/${id}/handoff/checkpoint`, "POST", {}),
      apiRequest(`/api/nblog/campaigns/${id}/handoff-sessions`, "POST", {}),
      apiRequest(`/api/nblog/campaigns/${id}/media/media-1`, "DELETE"),
      apiRequest(`/api/nblog/campaigns/${id}/media/order`, "PATCH", {}),
      apiRequest("/api/nblog/prompt-profiles", "GET"),
      apiRequest("/api/nblog/prompt-profiles", "POST", {}),
      apiRequest("/api/nblog/prompt-profiles/validate", "POST", { template: "test" }),
      apiRequest("/api/nblog/sync-tokens", "GET"),
      apiRequest("/api/nblog/sync-tokens", "POST", {}),
    ];
    for (const request of forbiddenRoutes) {
      const response = await dispatch(request, syncActor);
      expect(response.status).toBe(403);
      const body = await response.json() as { error: { code: string; allowed_scope: string; retryable: boolean } };
      expect(body.error.code).toBe("sync_token_scope_forbidden");
      expect(body.error.allowed_scope).toBe("sync:write");
      expect(body.error.retryable).toBe(false);
    }

    const secondInit = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/media/upload-init`, "POST", {
      files: [{ media_id: "media-2", original_name: "photo-2.jpg", content_type: "image/jpeg", size: bytes.byteLength, checksum, order: 2 }],
    }), syncActor);
    const secondUpload = (await secondInit.json() as { uploads: Array<{ upload_url: string; object_key: string; headers: Record<string, string> }> }).uploads[0];
    const oversizedRequest = new Request(secondUpload.upload_url, {
      method: "PUT",
      headers: { ...secondUpload.headers, "content-length": "4" },
    });
    const oversized = await dispatchUpload(oversizedRequest);
    expect(oversized.status).toBe(413);
    expect((await oversized.json() as { error: { code: string } }).error.code).toBe("upload_too_large");
    expect(await workerEnv.R2.head(secondUpload.object_key)).toBeNull();
  });

  it("rejects cross-origin and origin-less browser mutations", async () => {
    const foreign = apiRequest("/api/nblog/campaigns", "POST", campaignInput("NB-RUNTIME-CSRF-1"), {
      origin: "https://attacker.example",
    });
    const foreignResponse = await dispatch(foreign);
    expect(foreignResponse.status).toBe(403);
    expect((await foreignResponse.json() as { error: { code: string } }).error.code).toBe("csrf_origin_mismatch");

    const missing = apiRequest("/api/nblog/campaigns", "POST", campaignInput("NB-RUNTIME-CSRF-2"));
    missing.headers.delete("origin");
    const missingResponse = await dispatch(missing);
    expect(missingResponse.status).toBe(403);
    expect((await missingResponse.json() as { error: { code: string } }).error.code).toBe("csrf_origin_mismatch");
  });

  it("isolates synchronized previews and rejects sensitive checkpoint text", async () => {
    const id = "NB-RUNTIME-PREVIEW";
    await createCampaign(id);
    await syncCampaign(id, true);
    const preview = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/preview`, "GET"));
    expect(preview.status).toBe(200);
    const csp = preview.headers.get("content-security-policy") || "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");

    const checkpoint = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/handoff/checkpoint`, "POST", {
      resume_stage: "manual-review",
      resume_point: "Review approved content",
      completed_steps: [],
      remaining_steps: ["publish"],
      note: `Bearer nbs_${"x".repeat(40)}`,
    }));
    expect(checkpoint.status).toBe(400);
    expect((await checkpoint.json() as { error: { code: string } }).error.code).toBe("sensitive_content_rejected");
  });

  it("removes credentials, prompts, and local paths from persisted audit rows", async () => {
    const id = "NB-RUNTIME-AUDIT-REDACTION";
    const rawToken = `nbs_${"s".repeat(40)}`;
    const unsafeActor: NBlogActor = {
      userId: "audit-redaction-user",
      label: `Operator Bearer ${rawToken} D:\\private\\operator-profile`,
      viaToken: false,
    };
    const created = await dispatch(apiRequest("/api/nblog/campaigns", "POST", campaignInput(id)), unsafeActor);
    expect(created.status).toBe(201);
    await syncCampaign(id, true, unsafeActor);

    await runNBlogWorkflowReconciliation(workerEnv, {
      user_id: unsafeActor.userId,
      campaign_id: id,
      requested_by: "C:\\Users\\Samsung\\browser-profile",
      reason: "system prompt {{campaign_name}} D:\\private\\source",
    });

    const audit = await workerEnv.DB.prepare(
      "SELECT action, actor, reason, metadata_json FROM nblog_audit_logs WHERE user_id=?1 AND campaign_id=?2 ORDER BY created_at"
    ).bind(unsafeActor.userId, id).all<{ action: string; actor: string; reason: string; metadata_json: string }>();
    const persisted = JSON.stringify(audit.results);
    expect(persisted).not.toContain(rawToken);
    expect(persisted).not.toContain("D:\\\\private");
    expect(persisted).not.toContain("C:\\\\Users");
    expect(persisted).not.toContain("campaign_name");
    const reconciliation = audit.results.find((row) => row.action === "workflow_reconciled");
    expect(reconciliation?.actor).toBe("[redacted-path]");
    expect(JSON.parse(reconciliation?.metadata_json || "{}")).toEqual({ missing: [], trigger: "workflow_retry" });
  });

  it("edits the visit date in place without tripping the create-time conflict guardrail", async () => {
    const id = "NB-RUNTIME-VISIT-DATE";
    const created = await createCampaign(id);
    expect(created.visit_date).toBe("2026-07-15");

    // 잘못 넣은 날짜를 그대로 다시 저장하려 하면 createCampaign 가드레일이 막는다(원인 재현).
    const conflict = await dispatch(apiRequest("/api/nblog/campaigns", "POST", {
      ...campaignInput(id),
      visit_date: "2026-07-20",
    }, { "idempotency-key": "visit-date-create-conflict" }));
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as { error: { code: string } }).error.code).toBe("campaign_id_conflict");

    // 전용 방문일 수정 경로는 같은 행을 직접 갱신하므로 성공한다.
    const patched = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/visit-date`, "PATCH", {
      visit_date: "2026-07-20",
      expected_version: created.version,
    }, { "idempotency-key": "visit-date-patch" }));
    expect(patched.status).toBe(200);
    expect((await patched.json() as { visit_date: string }).visit_date).toBe("2026-07-20");

    // 발행된 캠페인은 방문일을 못 바꾼다.
    await workerEnv.DB.prepare("UPDATE nblog_campaigns SET status='published' WHERE user_id=?1 AND campaign_id=?2")
      .bind(actor.userId, id).run();
    const blocked = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/visit-date`, "PATCH", {
      visit_date: "2026-07-25",
    }, { "idempotency-key": "visit-date-blocked" }));
    expect(blocked.status).toBe(409);
    expect((await blocked.json() as { error: { code: string } }).error.code).toBe("invalid_state");
  });

  it("archives a campaign, purges its R2 copies, hides it from the default list, and restores it", async () => {
    const id = "NB-RUNTIME-ARCHIVE";
    const created = await createCampaign(id);
    const objectKey = `qa/${id}/photo.jpg`;
    await workerEnv.R2.put(objectKey, new Uint8Array([1, 2, 3]));
    await workerEnv.DB.prepare(
      `INSERT INTO nblog_media_assets (user_id, campaign_id, media_id, type, original_name, object_key, checksum, sort_order, status, updated_at)
       VALUES (?1, ?2, 'media-1', 'image', 'photo.jpg', ?3, 'sha256:abc', 1, 'ready', ?4)`
    ).bind(actor.userId, id, objectKey, new Date().toISOString()).run();

    // 이름을 틀리면 보관하지 않는다.
    const wrongName = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/archive`, "POST", {
      confirm_name: "wrong name",
      expected_version: created.version,
    }, { "idempotency-key": "archive-wrong" }));
    expect(wrongName.status).toBe(400);
    expect((await wrongName.json() as { error: { code: string } }).error.code).toBe("confirmation_required");

    const archived = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/archive`, "POST", {
      confirm_name: "Runtime QA campaign",
      expected_version: created.version,
    }, { "idempotency-key": "archive-ok" }));
    expect(archived.status).toBe(200);
    expect((await archived.json() as { status: string }).status).toBe("archived");
    expect(await workerEnv.R2.head(objectKey)).toBeNull();

    const defaultList = await dispatch(apiRequest("/api/nblog/campaigns", "GET"));
    expect((await defaultList.json() as { campaigns: Array<{ campaign_id: string }> }).campaigns.some((c) => c.campaign_id === id)).toBe(false);

    const archivedList = await dispatch(apiRequest("/api/nblog/campaigns?view=archived", "GET"));
    expect((await archivedList.json() as { campaigns: Array<{ campaign_id: string }> }).campaigns.some((c) => c.campaign_id === id)).toBe(true);

    const current = await workerEnv.DB.prepare("SELECT version FROM nblog_campaigns WHERE user_id=?1 AND campaign_id=?2")
      .bind(actor.userId, id).first<{ version: number }>();
    const restored = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/restore`, "POST", {
      expected_version: current!.version,
    }, { "idempotency-key": "restore-ok" }));
    expect(restored.status).toBe(200);
    // 복원은 보관 전 실제 status(생성 직후 queued)를 그대로 되살린다.
    expect((await restored.json() as { status: string }).status).toBe("queued");
    const defaultAfter = await dispatch(apiRequest("/api/nblog/campaigns", "GET"));
    expect((await defaultAfter.json() as { campaigns: Array<{ campaign_id: string }> }).campaigns.some((c) => c.campaign_id === id)).toBe(true);
  });

  it("refuses to archive an already published campaign", async () => {
    const id = "NB-RUNTIME-ARCHIVE-PUBLISHED";
    const created = await createCampaign(id);
    await workerEnv.DB.prepare("UPDATE nblog_campaigns SET status='published' WHERE user_id=?1 AND campaign_id=?2")
      .bind(actor.userId, id).run();
    const response = await dispatch(apiRequest(`/api/nblog/campaigns/${id}/archive`, "POST", {
      confirm_name: "Runtime QA campaign",
      expected_version: created.version,
    }));
    expect(response.status).toBe(409);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("invalid_state");
  });

  it("returns 429 before mutating state when a write rate limit is exhausted", async () => {
    const limitedEnv: NBlogEnv = {
      DB: workerEnv.DB,
      R2: workerEnv.R2,
      NBLOG_UI_RATE_LIMITER: { limit: async () => ({ success: false }) } as RateLimit,
    };
    const id = "NB-RUNTIME-RATE-LIMIT";
    const response = await dispatch(apiRequest("/api/nblog/campaigns", "POST", campaignInput(id)), actor, limitedEnv);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect((await response.json() as { error: { code: string; retryable: boolean } }).error).toMatchObject({
      code: "rate_limited",
      retryable: true,
    });
    const row = await workerEnv.DB.prepare("SELECT campaign_id FROM nblog_campaigns WHERE user_id=?1 AND campaign_id=?2")
      .bind(actor.userId, id).first();
    expect(row).toBeNull();
  });
});
