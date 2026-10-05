const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appDir = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(appDir, relativePath), "utf8");

test("NBlog Worker routes cover sync, validation, approval, retry, handoff, media, and publication", () => {
  const source = read("src/domains/nblog/nblog.ts");
  for (const route of [
    "/api/campaigns", "validation", "preview", "approve", "retry", "artifacts",
    "handoff", "publish-result", "publication", "upload-init", "upload-complete",
    "prompt-profiles", "sync-tokens",
  ]) assert.ok(source.includes(route), `missing route contract: ${route}`);
  assert.match(source, /validation_passed/);
  assert.match(source, /expected_updated_at/);
  assert.match(source, /duplicate_published_url/);
  assert.doesNotMatch(source, /local_generation_required|required_commands/);
  assert.doesNotMatch(source, /Math\.random\(/);
});

test("NBlog persistence separates D1 state, R2 artifacts, Workflow retries, and audit history", () => {
  const migration = read("migrations/0076_nblog_operations.sql");
  const config = read("wrangler.jsonc");
  const workflow = read("src/domains/nblog/nblogWorkflow.ts");
  for (const table of [
    "nblog_campaigns", "nblog_artifact_versions", "nblog_media_assets", "nblog_upload_sessions",
    "nblog_prompt_profiles", "nblog_handoff_checkpoints", "nblog_publication_history",
    "nblog_audit_logs", "nblog_sync_tokens",
  ]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(config, /"binding": "NBLOG_WORKFLOW"/);
  for (const binding of ["NBLOG_SYNC_RATE_LIMITER", "NBLOG_UI_RATE_LIMITER", "NBLOG_TOKEN_RATE_LIMITER"]) {
    assert.equal((config.match(new RegExp(`"name": "${binding}"`, "g")) || []).length, 2, `${binding} must be isolated in production and staging`);
  }
  assert.match(config, /"head_sampling_rate": 1/);
  assert.match(workflow, /extends WorkflowEntrypoint/);
  assert.match(workflow, /step\.do\("reconcile-artifact-checkpoint"/);
});

test("operations UI exposes the complete manual handoff and CLI token flow", () => {
  const script = read("public/assets/nblog-automation.js");
  const html = read("public/nblog-automation/index.html");
  for (const marker of [
    // 복사 버튼 라벨은 2단 재구성에서 짧아졌다(#184). 동작 마커인 data-copy-kind 로 본다.
    "renderHandoffWorkspace", 'data-copy-kind="title"', "올린 사진·영상", "스마트에디터 열기",
    "발행 완료로 기록", "save-checkpoint", "issue-sync-token", "promptProfileForm",
  ]) assert.ok(script.includes(marker), `missing handoff marker: ${marker}`);
  assert.match(html, /id="promptProfilesButton"/);
  assert.match(html, /id="syncTokenButton"/);
  assert.doesNotMatch(`${script}\n${html}`, /type="password"/);
});

test("issue 18 adds versioned operations status and a rotating browser handoff contract", () => {
  const source = read("src/domains/nblog/nblog.ts");
  const migration = read("migrations/0077_nblog_contract_and_handoff.sql");
  const script = read("public/assets/nblog-automation.js");
  const runbook = read("docs/nblog-issue-18-release-runbook.md");
  for (const table of ["nblog_approvals", "nblog_handoff_sessions", "nblog_idempotency_records"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const marker of [
    "NBLOG_CONTRACT_VERSION", "x-nblog-contract-version", "x-request-id",
    "nbh_", "nbhs_", "nbu_", "handoff_token_already_claimed", "final_publish_requires_user_action",
    "sync_token_scope_forbidden", "csrf_origin_mismatch", "sensitive_content_rejected",
    "sandbox allow-scripts", "connect-src 'none'", "form-action 'none'",
  ]) assert.ok(source.includes(marker), `missing issue 18 contract marker: ${marker}`);
  assert.match(script, /\/api\/nblog\/campaigns/);
  assert.match(script, /issue-handoff-session/);
  assert.match(script, /일회성 인계 토큰/);
  assert.match(runbook, /NBLOG_HANDOFF_ENABLED=false/);
  assert.match(runbook, /최종 검토와 발행은 사용자 동작/);
});

test("production deployment requires commit-matched live staging evidence", () => {
  const workflow = read("../.github/workflows/worker-deploy.yml");
  const smoke = read("scripts/verify-nblog-security-smoke.mjs");
  for (const marker of [
    "deploy_staging:", "verify_staging:", "needs: deploy_staging", "staging_verified_commit", "STAGING_VERIFIED_COMMIT",
    "Apply staging D1 migrations", "d1 migrations apply harness-meeting-db-staging --remote --env staging",
    "Apply production D1 migrations", "d1 migrations apply harness-meeting-db --remote",
  ]) {
    assert.match(workflow, new RegExp(marker));
  }
  assert.ok(workflow.indexOf("deploy_staging:") < workflow.indexOf("verify_staging:"));
  assert.ok(workflow.indexOf("verify_staging:") < workflow.lastIndexOf("deploy:"));
  assert.ok(workflow.indexOf("Apply staging D1 migrations") < workflow.indexOf("Deploy staging Worker"));
  assert.ok(workflow.indexOf("Apply production D1 migrations") < workflow.indexOf("Deploy production Worker"));
  assert.equal(workflow.split("secrets.CLOUDFLARE_D1_API_TOKEN").length - 1, 2);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.target == 'production'/);
  assert.match(workflow, /test "\$STAGING_VERIFIED_COMMIT" = "\$GITHUB_SHA"/);
  assert.doesNotMatch(workflow, /secrets\.NBLOG_STAGING_SYNC_TOKEN/);
  assert.match(smoke, /invalid_sync_token/);
  assert.match(smoke, /sync_token_scope_forbidden/);
  assert.match(smoke, /upload_token_required/);
  assert.match(smoke, /\/api\/nblog\/uploads\/00000000-0000-4000-8000-000000000000\?token=/);
  assert.match(smoke, /NBLOG_STAGING_SYNC_TOKEN/);
});

test("issue 24 generates in a Worker and requires confirmation of the exact draft version", () => {
  const source = read("src/domains/nblog/nblog.ts");
  const generation = read("src/domains/nblog/nblogGeneration.ts");
  const workflow = read("src/domains/nblog/nblogWorkflow.ts");
  const migration = read("migrations/0082_nblog_worker_generation.sql");
  const script = read("public/assets/nblog-automation.js");
  for (const marker of ["nblog_generation_runs", "nblog_content_confirmations", "awaiting_content_review", "content_confirmed"]) {
    assert.ok(migration.includes(marker), `missing generation persistence marker: ${marker}`);
  }
  assert.match(source, /content-confirmations/);
  assert.match(generation, /api\.openai\.com\/v1\/responses/);
  assert.match(generation, /minimum_image_count[\s\S]+status: "warning"/);
  assert.match(generation, /expected_artifact_version/);
  assert.match(workflow, /generate-draft-from-media/);
  assert.match(script, /new_campaign/);
  assert.match(script, /campaign_url/);
  assert.match(script, /data-detail-action="confirm-content"/);
  assert.match(script, /CONTRACT_VERSION = "1\.1"/);
});
