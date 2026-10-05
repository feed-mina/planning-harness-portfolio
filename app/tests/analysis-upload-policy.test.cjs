const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const policy = require("../public/assets/analysis-upload-policy.js");

const MB = 1024 * 1024;
const appRoot = path.resolve(__dirname, "..");

function file(name, size, type = "") {
  return { name, size, type };
}

test("client limits mirror the Worker upload limits", () => {
  const server = fs.readFileSync(path.join(appRoot, "src/domains/analysis/analysis.ts"), "utf8");
  const read = (constant) => {
    const match = server.match(new RegExp(`const ${constant} = ([^;]+);`));
    assert.ok(match, `${constant} not found in analysis.ts`);
    // eslint-disable-next-line no-new-func
    return Function(`return (${match[1]})`)();
  };
  assert.equal(policy.LIMITS.maxUploadBytes, read("MAX_UPLOAD_BYTES"));
  assert.equal(policy.LIMITS.maxFileBytes, read("MAX_FILE_BYTES"));
  assert.equal(policy.LIMITS.maxFilesPerSession, read("MAX_FILES_PER_SESSION"));
});

test("files within the per-file limit are uploaded untouched", () => {
  const plan = policy.planUpload([file("meeting.txt", 2 * MB, "text/plain")]);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.entries[0].action, "keep");
  assert.equal(plan.batches.length, 1);
});

test("oversized text files upload a head excerpt instead of failing with 413", () => {
  const plan = policy.planUpload([file("cycles_260428.jsonl", 19.2 * MB, "")]);
  assert.deepEqual(plan.errors, []);
  const [entry] = plan.entries;
  assert.equal(entry.action, "text_head");
  assert.equal(entry.uploadBytes, policy.TEXT_HEAD_BYTES);
  assert.match(entry.note, /앞부분/);
});

test("oversized PDF and spreadsheet fall back to the browser-extracted excerpt", () => {
  const plan = policy.planUpload([
    file("report.pdf", 30 * MB, "application/pdf"),
    file("costs.xlsx", 9 * MB, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  ]);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.entries.map((entry) => entry.action), ["client_excerpt", "client_excerpt"]);
});

test("oversized binaries without any text path are rejected with a readable reason", () => {
  const plan = policy.planUpload([file("scan.zip", 40 * MB, "application/zip")]);
  assert.equal(plan.entries[0].action, "reject");
  assert.equal(plan.batches.length, 0);
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /scan\.zip/);
  assert.match(plan.errors[0], /6\.0 MB/);
});

test("a set that exceeds the request limit is split into several requests", () => {
  const files = Array.from({ length: 6 }, (_, i) => file(`chunk-${i}.bin`, 5 * MB, "application/octet-stream"));
  const plan = policy.planUpload(files);
  assert.deepEqual(plan.errors, []);
  assert.ok(plan.batches.length > 1);
  for (const batch of plan.batches) {
    const bytes = batch.reduce((sum, entry) => sum + entry.uploadBytes, 0);
    assert.ok(bytes <= policy.LIMITS.maxUploadBytes, `batch of ${bytes} bytes exceeds the request limit`);
  }
  assert.deepEqual(
    plan.batches.flat().map((entry) => entry.index),
    files.map((_, i) => i),
  );
});

test("the per-session file count is checked before anything is sent", () => {
  const plan = policy.planUpload([file("a.txt", 10, "text/plain")], { alreadyUploaded: 15 });
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /최대 15개/);
});

test("text detection matches the Worker's isLikelyText for OOXML mime types", () => {
  assert.equal(policy.isTextLike("data.jsonl", ""), true);
  // 서버 isLikelyText 와 동일하게, octet-stream 으로 올라온 파일은 텍스트로 보지 않는다.
  assert.equal(policy.isTextLike("data.jsonl", "application/octet-stream"), false);
  assert.equal(policy.isTextLike("notes.md", ""), true);
  assert.equal(policy.isTextLike("book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), false);
  assert.equal(policy.isTextLike("report.pdf", "application/pdf"), false);
});

test("analysis pages load the shared upload policy before their page script", () => {
  for (const page of ["analysis", "analysis-edit2"]) {
    const html = fs.readFileSync(path.join(appRoot, "public", page, "index.html"), "utf8");
    const policyAt = html.indexOf("/assets/analysis-upload-policy.js");
    const pageAt = html.indexOf(`/assets/${page}.js`);
    assert.ok(policyAt > -1, `${page} does not load analysis-upload-policy.js`);
    assert.ok(policyAt < pageAt, `${page} loads its page script before the upload policy`);
  }
});
