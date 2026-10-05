const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const read = (relativePath) => fs.readFileSync(path.join(publicDir, relativePath), "utf8");

test("NBlog automation is linked between Garden and mypage in the shared sidebar", () => {
  const common = read("assets/common.js");
  const garden = common.indexOf('id: "garden"');
  const nblog = common.indexOf('id: "nblog-automation"');
  const mypage = common.indexOf('id: "mypage"');

  assert.ok(garden >= 0, "Garden menu must exist");
  assert.ok(nblog > garden, "NBlog automation must follow Garden");
  assert.ok(mypage > nblog, "NBlog automation must precede mypage");
  assert.match(common, /href: "\/nblog-automation\/"/);
});

test("sidebar accordions start closed, toggle on one click, and use a polished scrollbar", () => {
  const common = read("assets/common.js");
  const styles = read("assets/styles.css");

  assert.match(common, /<div class="side-children" hidden>/);
  assert.match(common, /data-nav-parent="\$\{tab\.id\}" aria-expanded="false"/);
  assert.match(common, /const nextExpanded = !expanded/);
  assert.match(common, /children\.hidden = !nextExpanded/);
  assert.doesNotMatch(common, /classList\.toggle\("hidden"/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(styles, /scrollbar-gutter:\s*stable/);
  assert.match(styles, /\.side-nav::\-webkit-scrollbar-thumb/);
  assert.match(styles, /\.side-nav::\-webkit-scrollbar-button/);
});

test("the connection notice obeys the shared hidden contract after the API reconnects", () => {
  const html = read("nblog-automation/index.html");
  const script = read("assets/nblog-automation.js");
  const styles = read("assets/styles.css");

  assert.match(html, /id="handoffNotice"[^>]*hidden/);
  assert.match(script, /notice\.hidden = connected/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test("the operations page exposes the real API queue, scheduling, handoff, and audit surfaces", () => {
  const html = read("nblog-automation/index.html");

  assert.match(html, /data-page="nblog-automation"/);
  assert.match(html, /내 캠페인/);
  assert.match(html, /올릴 예정/);
  assert.match(html, /연결을 확인하고 있습니다/);
  assert.match(html, /한 번에 두 개까지/);
  assert.match(html, /지금까지 한 일/);
  assert.match(html, /auto-marketing-Nblog\/issues\/1/);
  assert.match(html, /auto-marketing-Nblog\/issues\/15/);
  assert.match(html, /name="campaignUrl"/);
  assert.match(html, /name="placeUrl"/);
  assert.match(html, /name="visitNotes"/);
  assert.match(html, /name="userTag"/);
  assert.match(html, /name="promptOverride"/);
  assert.match(html, /id="campaignImportUrl"/);
  assert.match(html, /id="inspectCampaignButton"/);
  assert.match(html, /사진·영상 올리고 글 만들기/);
  assert.match(html, /name="media"[^>]+multiple/);
  assert.doesNotMatch(html, /type="password"/);
});

test("the dashboard uses real APIs, preserves approval gates, and has no browser seed store", () => {
  const script = read("assets/nblog-automation.js");

  // 상태 라벨은 마케팅 담당자 기준 문구로 바꿨다(#185 후속). 내부 용어를 노출하지 않는다.
  for (const label of ["사진 기다리는 중", "글 만드는 중", "글 확인하기", "올릴 준비 완료", "블로그에 올림", "다시 만들어야 함", "블로그에 올릴 차례"]) {
    assert.ok(script.includes(label), `missing queue state: ${label}`);
  }
  assert.match(script, /!campaign\.validationPassed \|\| campaign\.phase !== "approval"/);
  assert.match(script, /apiRequest\(API_BASE\)/);
  assert.match(script, /\/validation`/);
  assert.match(script, /\/approve`/);
  assert.match(script, /\/retry`/);
  assert.match(script, /\/media\/upload-init`/);
  assert.match(script, /\/media\/upload-complete`/);
  assert.match(script, /id=\"detailsMediaInput\"/);
  assert.match(script, /data-detail-action=\"exclude-media\"/);
  // 생성 버튼은 generate-draft 하나로 통합했다 (#184). 이전에는 regenerate-content 가
  // 같은 API 를 부르면서 화면에 둘 다 떠 있었다.
  assert.match(script, /data-detail-action=\"generate-draft\"/);
  assert.doesNotMatch(script, /data-detail-action=\"regenerate-content\"/);
  assert.match(script, /새 파일을 먼저 올린 뒤 문제가 있는 기존 파일을 빼면/);
  assert.match(script, /\/api\/nblog\/campaign-imports\/inspect/);
  assert.match(script, /encodeURIComponent\(campaignUrl\)/);
  assert.doesNotMatch(script, /seedCampaigns|seedAudits|localStorage|STORAGE_KEY/);
  assert.match(script, /서버에 연결되지 않았습니다/);
  assert.doesNotMatch(script, /password|accessToken|refreshToken|authToken/);
});

test("the operations layout has responsive desktop and mobile rules", () => {
  const styles = read("assets/nblog-automation.css");

  assert.match(styles, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /\.nblog-campaign-card/);
  assert.match(styles, /:root\[data-theme="dark"\]/);
});

test("issue 11 allows assisted input but keeps login, media, review, and publish manual", () => {
  const html = read("nblog-automation/index.html");
  const script = read("assets/nblog-automation.js");

  assert.match(html, /data-browser-policy="assisted_input_manual_publish"/);
  assert.match(html, /네이버 정책상 마지막 등록은 사람이 합니다/);
  assert.match(script, /data-policy-gate="assisted_input_manual_publish"/);
  assert.match(script, /자동입력 범위/);
  assert.match(script, /네이버 로그인과 사진·영상·장소·미리보기·최종 발행은 직접 진행합니다/);
  assert.match(script, /자동입력 도우미는 발행 버튼을 누르지 않습니다/);
  assert.match(script, /\/downloads\/nblog-smarteditor-helper\.zip/);
  assert.match(script, /\/nblog-handoff\/bookmarklet\.js/);
  assert.match(script, /연결 코드 복사/);
  assert.match(script, /북마클릿용 초안 복사/);
  assert.match(script, /SmartEditor 열기/);
  assert.doesNotMatch(script, /chrome\.scripting|automated_publish|captcha_bypass|data-detail-action="publish"/);
});

test("handoff secrets are copied from memory and never rendered or persisted", () => {
  const script = read("assets/nblog-automation.js");

  assert.match(script, /NBLOG_HANDOFF_V1\./);
  assert.match(script, /claim_token: String\(issued\.claim_token\)/);
  assert.match(script, /copyText\(handoffConnectionCode\(state\.handoff\?\.handoff_session_issue\)\)/);
  assert.doesNotMatch(script, /issuedHandoffToken|esc\(issuedHandoff\.claim_token\)|localStorage/);
  assert.match(script, /delete payload\.handoff_session_issue\.claim_token/);
});

test("bookmarklet fallback copies a javascript URL and a versioned offline draft", () => {
  const script = read("assets/nblog-automation.js");

  assert.match(script, /NBLOG_DRAFT_V1\./);
  assert.match(script, /fetch\(BOOKMARKLET_SOURCE_URL, \{ cache: "no-store", credentials: "same-origin" \}\)/);
  assert.match(script, /source\.startsWith\("javascript:"\) \? source : `javascript:\$\{source\}`/);
  for (const field of ["title", "body", "tags", "place_name", "target_blog", "category"]) {
    assert.ok(script.includes(`${field}:`), `draft payload field missing: ${field}`);
  }
});
