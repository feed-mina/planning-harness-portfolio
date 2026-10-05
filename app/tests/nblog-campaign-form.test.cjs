const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const read = (relativePath) => fs.readFileSync(path.join(publicDir, relativePath), "utf8");

/**
 * 새 캠페인 모달 — 마케팅 담당자가 채우지 않는 칸은 숨기고, 누른 뒤 바로 닫는다.
 *
 * 업로드가 몇 분씩 걸리는데 모달이 떠 있으면 안 눌린 줄 알고 다시 누른다는 보고가 있었다.
 */
test("담당자가 채우지 않는 칸은 숨긴다", () => {
  const html = read("nblog-automation/index.html");

  assert.match(html, /<label hidden><span>캠페인 ID<\/span>/);
  assert.match(html, /<label hidden><span>캠페인별 프롬프트 재정의<\/span>/);
});

test("숨긴 캠페인 ID 에는 required 가 없다", () => {
  const html = read("nblog-automation/index.html");
  const field = /<label hidden><span>캠페인 ID<\/span>(.*?)<\/label>/s.exec(html)[1];

  // 숨은 required 필드는 브라우저 검증이 포커스를 못 줘서 아무 메시지 없이 제출을 막는다.
  assert.doesNotMatch(field, /required/);
});

test("display:grid 가 hidden 을 덮어쓰지 않도록 되돌린다", () => {
  const css = read("assets/nblog-automation.css");

  assert.match(css, /\.nblog-dialog label\[hidden\]\s*{\s*display:\s*none\s*!important/);
});

test("캠페인 ID 가 비면 자동으로 만든다", () => {
  const script = read("assets/nblog-automation.js");

  assert.match(script, /function autoCampaignId\(/);
  // 링크의 id 파라미터를 우선 쓰고, 없으면 방문일 + 난수로 만든다.
  assert.match(script, /\[\?&\]id=/);
  assert.match(script, /campaign_id: String\(formData\.get\("campaignId"\)[^;]*\|\|\s*\n?\s*autoCampaignId\(/);
});

test("캠페인이 만들어지면 업로드를 기다리지 않고 모달을 닫는다", () => {
  const script = read("assets/nblog-automation.js");
  const createdAt = script.indexOf("createdId = String(created?.campaign_id");
  const closedAt = script.indexOf("refs.dialog.close()", createdAt);
  const uploadAt = script.indexOf("await uploadMedia(createdId, files)", createdAt);

  assert.ok(createdAt >= 0 && closedAt >= 0 && uploadAt >= 0);
  assert.ok(closedAt < uploadAt, "모달은 업로드 전에 닫혀야 한다");
});

test("제출 중에는 버튼을 잠가 두 번 눌리지 않게 한다", () => {
  const script = read("assets/nblog-automation.js");

  assert.match(script, /if \(refs\.formSubmit\.disabled\) return;/);
  assert.match(script, /refs\.formSubmit\.disabled = true;/);
  assert.match(script, /formSubmit: document\.getElementById\("campaignFormSubmit"\)/);
});

test("모달을 닫은 뒤의 업로드 실패는 토스트로 알린다", () => {
  const script = read("assets/nblog-automation.js");

  // formError 는 닫힌 모달 안에 있어 보이지 않는다.
  assert.match(script, /showToast\(`\$\{createdId\} 업로드 실패: \$\{error\.message\}`, true\)/);
});
