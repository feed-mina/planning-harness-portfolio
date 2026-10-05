const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const skillRoot = path.join(repoRoot, "skills", "generate-sdui");
const validator = path.join(skillRoot, "scripts", "validate_ai_sdui.mjs");
const validFixture = path.join(skillRoot, "references", "example-valid.json");
const rejectedFixture = path.join(skillRoot, "references", "example-rejected.json");

test("generate-sdui is an auto-discovered plugin skill without a duplicate command", () => {
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const plugin = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin", "plugin.json"), "utf8"));

  assert.match(skill, /^---\r?\nname: generate-sdui\r?\ndescription:/);
  assert.match(skill, /AI 생성 JSON|model response as untrusted input/);
  assert.match(skill, /server-issued dry-run job/);
  assert.match(skill, /\.\.\/\.\.\/app\/contracts\/ai-sdui\.v1\.schema\.json/);
  assert.equal(fs.existsSync(path.join(repoRoot, ".claude", "commands", "generate-sdui.md")), false);
  assert.equal(plugin.version, "0.5.0");
});

test("bundled validator accepts the canonical example and rejects a direct risky action", () => {
  const accepted = spawnSync(process.execPath, [validator, validFixture], { encoding: "utf8" });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /VALID planning-harness\.ai-sdui\.v1/);

  const rejected = spawnSync(process.execPath, [validator, rejectedFixture], { encoding: "utf8" });
  assert.equal(rejected.status, 1, rejected.stdout);
  assert.match(rejected.stderr, /REJECTED/);
  assert.match(rejected.stderr, /\$\.card\.actions\[0\]\.type/);

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-sdui-skill-"));
  try {
    for (const [name, timestamp] of [
      ["missing-seconds", "2026-07-19T13:05Z"],
      ["impossible-date", "2026-02-30T13:05:00Z"],
      ["excessive-fraction", "2026-07-19T13:05:00.1234Z"],
    ]) {
      const invalidTimestamp = JSON.parse(fs.readFileSync(validFixture, "utf8"));
      invalidTimestamp.generated_at = timestamp;
      const invalidTimestampPath = path.join(tempDirectory, `${name}.json`);
      fs.writeFileSync(invalidTimestampPath, JSON.stringify(invalidTimestamp), "utf8");
      const timestampRejected = spawnSync(process.execPath, [validator, invalidTimestampPath], { encoding: "utf8" });
      assert.equal(timestampRejected.status, 1, timestampRejected.stdout);
      assert.match(timestampRejected.stderr, /\$\.generated_at: (invalid date-time|does not match)/);
    }
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("Claude guidance keeps volatile model data dated and links primary documentation", () => {
  const guide = fs.readFileSync(path.join(repoRoot, "docs", "claude-ai-sdui-guide.md"), "utf8");
  assert.match(guide, /확인 기준일: 2026-07-19/);
  assert.match(guide, /https:\/\/platform\.claude\.com\/docs\/en\/build-with-claude\/structured-outputs/);
  assert.match(guide, /https:\/\/platform\.claude\.com\/docs\/en\/build-with-claude\/prompt-caching/);
  assert.match(guide, /raw 모델 응답이나 비밀은 저장하지 않는다/);
});
