const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(appRoot, "src/aiSdui.ts"), "utf8");
const indexSource = fs.readFileSync(path.join(appRoot, "src/router.ts"), "utf8");
const schema = JSON.parse(fs.readFileSync(path.join(appRoot, "contracts/ai-sdui.v1.schema.json"), "utf8"));
const migration = fs.readFileSync(path.join(appRoot, "migrations/0080_ai_sdui_validation.sql"), "utf8");
const runtime = fs.readFileSync(path.join(appRoot, "public/assets/ai-sdui-runtime.js"), "utf8");
const genericEngine = fs.readFileSync(path.join(appRoot, "public/assets/sdui-engine.js"), "utf8");

function constArray(name) {
  const match = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  assert.ok(match, `${name} must be exported as a const array`);
  return JSON.parse(`[${match[1].replace(/,\s*$/, "")}]`);
}

test("JSON Schema catalog cannot drift from the server validator", () => {
  assert.equal(schema.properties.schema.const, "planning-harness.ai-sdui.v1");
  assert.deepEqual(schema.$defs.componentType.enum, constArray("AI_SDUI_COMPONENT_TYPES"));
  assert.deepEqual(schema.$defs.actionType.enum, constArray("AI_SDUI_ACTION_TYPES"));
  assert.deepEqual(schema.$defs.riskyOperation.enum, constArray("AI_SDUI_RISKY_OPERATIONS"));
  assert.deepEqual(schema.$defs.provider.enum, constArray("AI_SDUI_PROVIDERS"));
  assert.deepEqual(schema.$defs.queueStatus.enum, constArray("AI_SDUI_QUEUE_STATUSES"));
});

test("action catalog has no arbitrary URL or generic executor entry", () => {
  const actions = schema.$defs.actionType.enum;
  assert.ok(actions.includes("APPROVE_JOB"));
  assert.ok(actions.includes("MODIFY_CODE"));
  assert.ok(actions.includes("DELETE_RESOURCE"));
  assert.ok(!actions.includes("OPEN_URL"));
  assert.ok(!actions.includes("ENQUEUE_JOB"));
  assert.match(JSON.stringify(schema.$defs.referenceAction), /ref_id/);
  assert.doesNotMatch(JSON.stringify(schema.$defs.referenceAction), /url|target|executor/i);
});

test("validation order is structure, component catalog, action catalog, then server approval", () => {
  const structure = source.indexOf("const envelope = validateStructure(parsed)");
  const catalog = source.indexOf("validateCatalog(envelope)", structure);
  const actions = source.indexOf("validateActions(envelope)", catalog);
  const approval = source.indexOf("validateApprovalJobs(env, userId, envelope, now)", actions);
  assert.ok(structure > 0 && structure < catalog && catalog < actions && actions < approval);
});

test("routes are authenticated ingestion and atomic approval only", () => {
  assert.match(indexSource, /path === "\/api\/ai-sdui\/validate"/);
  assert.match(indexSource, /requireLogin\(\)[\s\S]*handleAiSduiValidate/);
  assert.match(indexSource, /ai-sdui\\\/approval-jobs/);
  assert.match(source, /SET status='approved', approved_at=\?1[\s\S]*WHERE id=\?2[\s\S]*status='pending'/);
  assert.doesNotMatch(indexSource, /ai-sdui\/(?:execute|approval-jobs\/create)/);
});

test("D1 audit stores fixed reasons and hashes, never raw AI payloads", () => {
  assert.match(migration, /CREATE TABLE ai_sdui_validation_events/);
  assert.match(migration, /reason_code/);
  assert.match(migration, /payload_sha256/);
  assert.doesNotMatch(migration, /raw_payload|payload_json|request_body|response_body/i);
  assert.match(migration, /CREATE TABLE ai_sdui_approval_jobs/);
  assert.match(migration, /dry_run\s+INTEGER NOT NULL CHECK \(dry_run = 1\)/);
  assert.match(migration, /server_check_required\s+INTEGER NOT NULL CHECK \(server_check_required = 1\)/);
  assert.match(source, /AI_SDUI_AUDIT_RETENTION_DAYS = 30/);
  assert.match(source, /AI_SDUI_AUDIT_MAX_PER_USER = 1000/);
  assert.match(source, /LIMIT -1 OFFSET \?3/);
});

test("separate browser runtime renders only marked server-validated results and never executes code", () => {
  assert.match(runtime, /\/api\/ai-sdui\/validate/);
  assert.match(runtime, /x-ai-sdui-validated/);
  assert.match(runtime, /data\.validation\.validated !== true/);
  assert.doesNotMatch(runtime, /innerHTML|insertAdjacentHTML|eval\(|new Function|\.execute\(/);
  assert.doesNotMatch(genericEngine, /aiResultCard|HarnessAiSduiRuntime|ai-sdui/);
});
