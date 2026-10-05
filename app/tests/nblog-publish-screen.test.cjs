const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const read = (relative) => readFileSync(path.join(__dirname, "..", "public", relative), "utf8");
const script = read("assets/nblog-automation.js");
const html = read("nblog-automation/index.html");

test("발행 화면이 상세 모달과 분리되어 있다 (#182)", () => {
  assert.match(html, /id="campaignPublishDialog"/);
  assert.match(html, /id="campaignPublishBody"/);
  assert.match(script, /function renderPublishWorkspace/);
  assert.match(script, /async function showPublish/);
});

test("만들기 화면에는 발행 섹션이 없고 진입점만 있다", () => {
  const handoff = script.match(/function renderHandoffWorkspace[\s\S]*?refs\.detailsDialog\.showModal\(\);/);
  assert.ok(handoff, "renderHandoffWorkspace 를 찾지 못했습니다");
  const body = handoff[0];
  for (const moved of ["sectionAutoInputHelper", "sectionSmartEditor", "sectionPublication"]) {
    assert.ok(!body.includes(moved), `발행 섹션이 만들기 화면에 남아 있습니다: ${moved}`);
  }
  assert.ok(body.includes("sectionPublishEntry"), "발행 화면 진입점이 없습니다");
});

test("발행 화면은 복사, 자동입력, SmartEditor 확인, 결과 등록 순서다", () => {
  const publish = script.match(/function renderPublishWorkspace[\s\S]*?refs\.publishDialog\.open\) refs\.publishDialog\.showModal\(\);/);
  assert.ok(publish, "renderPublishWorkspace 를 찾지 못했습니다");
  const order = ["sectionDraftCopy", "sectionAutoInputHelper", "sectionSmartEditor", "sectionPublication"]
    .map((name) => publish[0].indexOf(name));
  assert.ok(order.every((index) => index >= 0), "발행 화면에 필요한 섹션이 빠졌습니다");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "복사 → 자동입력 → SmartEditor 확인 → 결과 등록 순서가 아닙니다");
});

test("승인 게이트가 화면 분리 후에도 유지된다 (#183 선반영)", () => {
  // 인계 세션 발급과 발행 결과 등록은 canPublish 안에서만 렌더된다.
  const handoffSection = script.match(/function sectionAutoInputHelper[\s\S]*?\n  \}/)[0];
  assert.match(handoffSection, /canPublish\s*\?/);
  assert.match(handoffSection, /올릴 준비 완료로 표시하면 자동입력 연결을 만들 수 있습니다/);
  assert.match(handoffSection, /disabled aria-disabled="true"/);

  const publicationSection = script.match(/function sectionPublication[\s\S]*?\n  \}/)[0];
  assert.match(publicationSection, /canPublish\s*\?/);
  assert.match(publicationSection, /올릴 준비 완료로 표시해야 발행 결과를 기록할 수 있습니다/);
});

test("발행 화면에서도 기존 액션이 동작하도록 핸들러를 공유한다", () => {
  assert.match(script, /const onWorkspaceClick = async/);
  assert.match(script, /const onWorkspaceSubmit = async/);
  assert.match(script, /refs\.publishBody\?\.addEventListener\("click", onWorkspaceClick\)/);
  assert.match(script, /refs\.publishBody\?\.addEventListener\("submit", onWorkspaceSubmit\)/);
});

test("자동입력 도우미는 확장 프로그램을 기본으로 하고 북마클릿을 대안으로 둔다", () => {
  const helperSection = script.match(/function sectionAutoInputHelper[\s\S]*?\n  \}/)[0];
  assert.match(helperSection, /Chrome 자동입력 도우미 받기/);
  assert.match(helperSection, /즐겨찾기 도우미/);
  assert.match(helperSection, /연결 코드 복사/);
  assert.match(helperSection, /북마클릿용 초안 복사/);
  assert.match(helperSection, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(helperSection, /제목·본문·태그까지만 넣습니다/);
  assert.doesNotMatch(helperSection, /issuedHandoffToken|esc\(issuedHandoff\.claim_token\)/);
});

test("세션 발급 뒤 발행 모달을 다시 그려 연결 코드 버튼을 표시한다", () => {
  const handler = script.match(/if \(action === "issue-handoff-session"\)[\s\S]*?\n        return;/);
  assert.ok(handler, "issue-handoff-session 처리기를 찾지 못했습니다");
  assert.match(handler[0], /payload\.handoff_session_issue = issued;/);
  assert.match(handler[0], /renderPublishWorkspace\(payload\);/);
  assert.doesNotMatch(handler[0], /renderHandoffWorkspace\(payload\);/);
  assert.match(script, /if \(!refs\.publishDialog\.open\) refs\.publishDialog\.showModal\(\);/);
});

test("연결 코드는 raw 토큰을 DOM에 렌더하지 않고 복사할 때만 만든다", () => {
  const codeFn = script.match(/function handoffConnectionCode[\s\S]*?\n  \}/)[0];
  assert.match(script, /const HANDOFF_CODE_PREFIX = "NBLOG_HANDOFF_V1\."/);
  assert.match(codeFn, /return HANDOFF_CODE_PREFIX \+ base64UrlJson/);
  for (const field of ["api_origin", "session_id", "claim_path", "claim_token", "contract_version", "expires_at"]) {
    assert.ok(codeFn.includes(`${field}:`), `connection code field missing: ${field}`);
  }
  assert.match(script, /copyText\(handoffConnectionCode\(state\.handoff\?\.handoff_session_issue\)\)/);
  assert.doesNotMatch(script, /id="issuedHandoffToken"|esc\(issuedHandoff\.claim_token\)|localStorage/);
});

test("연결 코드가 UTF-8 base64url 계약 필드를 정확히 담는다", () => {
  const base64Fn = script.match(/function base64UrlJson[\s\S]*?\n  \}/)[0];
  const codeFn = script.match(/function handoffConnectionCode[\s\S]*?\n  \}/)[0];
  const build = new Function(`
    const HANDOFF_CODE_PREFIX = "NBLOG_HANDOFF_V1.";
    const CONTRACT_VERSION = "1.1";
    const location = { origin: "https://staging.example" };
    ${base64Fn}
    ${codeFn}
    return handoffConnectionCode;
  `)();
  const code = build({
    contract_version: "1.1",
    claim_path: "/api/nblog/handoff-sessions/session-1/claim",
    claim_token: "nbh_비밀값",
    handoff_session: { id: "session-1", expires_at: "2026-07-23T12:00:00.000Z" },
  });
  const decoded = JSON.parse(Buffer.from(code.slice("NBLOG_HANDOFF_V1.".length), "base64url").toString("utf8"));

  assert.equal(code.startsWith("NBLOG_HANDOFF_V1."), true);
  assert.equal(code.includes("nbh_비밀값"), false);
  assert.deepEqual(decoded, {
    version: 1,
    api_origin: "https://staging.example",
    session_id: "session-1",
    claim_path: "/api/nblog/handoff-sessions/session-1/claim",
    claim_token: "nbh_비밀값",
    contract_version: "1.1",
    expires_at: "2026-07-23T12:00:00.000Z",
  });
});

test("북마클릿용 초안 payload가 한국어와 대상 정보를 보존한다", () => {
  const base64Fn = script.match(/function base64UrlJson[\s\S]*?\n  \}/)[0];
  const copyFn = script.match(/function handoffCopyValues[\s\S]*?\n  \}/)[0];
  const draftFn = script.match(/function draftTransferPayload[\s\S]*?\n  \}/)[0];
  const build = new Function(`
    const DRAFT_PAYLOAD_PREFIX = "NBLOG_DRAFT_V1.";
    ${base64Fn}
    ${copyFn}
    ${draftFn}
    return draftTransferPayload;
  `)();
  const code = build({
    campaign: { campaign_name: "미생맥주 수원권선점" },
    draft: { title: "한글 제목", markdown: "한글 본문\n\n#맛집 #수원" },
    smart_editor: { blog_url: "https://blog.naver.com/example", category: "맛집" },
  });
  const decoded = JSON.parse(Buffer.from(code.slice("NBLOG_DRAFT_V1.".length), "base64url").toString("utf8"));

  assert.deepEqual(decoded, {
    version: 1,
    title: "한글 제목",
    body: "한글 본문",
    tags: "#맛집 #수원",
    place_name: "미생맥주 수원권선점",
    target_blog: "https://blog.naver.com/example",
    category: "맛집",
  });
});

test("자동입력 정책에서도 최종 발행은 직접 수행한다", () => {
  const smartEditor = script.match(/function sectionSmartEditor[\s\S]*?\n  \}/)[0];
  assert.match(smartEditor, /로그인·CAPTCHA·보안 확인·미디어 업로드·장소 선택·미리보기·최종 발행은 사용자가 직접 처리합니다/);
  assert.match(smartEditor, /자동입력 도우미는 발행 버튼을 누르지 않습니다/);
  assert.doesNotMatch(script, /automated_publish|captcha_bypass|data-detail-action="publish"/);
});

test("도우미 체크포인트 뒤에는 최신 version을 읽되 바뀐 초안은 발행 기록하지 않는다", () => {
  const submit = script.match(/if \(event\.target\.id === "publicationForm"\)[\s\S]*?\n        return;/)[0];
  assert.match(submit, /const latest = await apiRequest\(`\$\{API_BASE\}\/\$\{encodeURIComponent\(campaignId\)\}\/handoff`\)/);
  assert.match(submit, /latest\.artifact_version/);
  assert.match(submit, /displayed\.artifact_version/);
  assert.match(submit, /발행 준비 중 글이 바뀌었습니다/);
  assert.match(submit, /expected_version: campaign\.version/);
});

test("초안 모양 두 가지에서 제목·태그를 모두 읽는다 (#184)", () => {
  // 화면에서 제목·태그가 비어 있던 원인: UI 가 로컬 CLI 모양(selected_title,
  // tags.final)만 읽는데 Worker 는 title 과 markdown 만 준다.
  const copyFn = script.match(/function handoffCopyValues[\s\S]*?\n  \}/)[0];
  assert.match(copyFn, /draft\.selected_title/);
  assert.match(copyFn, /draft\.title\b/);
  assert.match(copyFn, /tags\?\.final/);
  // Worker 초안은 태그가 본문 끝 해시태그 줄로 온다 — 떼어내 태그 칸으로 옮긴다.
  assert.match(copyFn, /startsWith\("#"\)/);
  assert.match(copyFn, /startsWith\("##"\)/);
});

test("검증과 캠페인 상태는 접힌 섹션으로 렌더한다 (#184)", () => {
  assert.match(script, /const collapsible = /);
  const validation = script.match(/function sectionValidation[\s\S]*?\n  \}/)[0];
  assert.match(validation, /collapsible\(/);
  const status = script.match(/function sectionCampaignStatus[\s\S]*?\n  \}/)[0];
  assert.match(status, /collapsible\(/);
});

test("SOURCE 는 액션이 미디어보다 위에 온다 (#184)", () => {
  const render = script.match(/function renderHandoffWorkspace[\s\S]*?refs\.detailsDialog\.showModal\(\);/)[0];
  // 주의: JS 에서 [^] 는 "임의 문자" 라 [^\]] 로 써야 ] 앞까지만 잡는다.
  const source = render.match(/panel\("01 · SOURCE"[^\]]*\]/)[0];
  assert.ok(
    source.indexOf("sectionGenerate") < source.indexOf("sectionMedia"),
    "사진이 여러 장이면 아래에 있는 생성 버튼은 스크롤해야 보인다",
  );
});

/**
 * 장소는 날링크가 아니라 이름으로 넣는다 (Task #2).
 *
 * naver.me 날링크는 스마트에디터에서 장소 카드로 안 바뀐다. 장소 버튼에 가게 이름을
 * 붙여넣어야 카드로 붙으므로, 체크리스트가 검색어를 복사로 준다.
 */
test("스마트에디터 체크리스트가 장소를 이름으로 넣게 안내한다", () => {
  const fn = script.match(/function sectionSmartEditor[\s\S]*?\n  \}/)[0];

  assert.match(fn, /장소 넣기/);
  assert.match(fn, /data-copy-kind="placeName"/);
  // 본문에 링크를 넣지 말라고 안내한다.
  assert.match(fn, /링크/);
});

test("복사값에 장소 이름이 캠페인명으로 들어간다", () => {
  const fn = script.match(/function handoffCopyValues[\s\S]*?\n  \}/)[0];
  const build = new Function(`${fn}; return handoffCopyValues;`)();

  const copy = build({ campaign: { campaign_name: "미생맥주 수원권선점" }, draft: { title: "제목", markdown: "본문\n\n#가 #나" } });

  assert.equal(copy.placeName, "미생맥주 수원권선점");
});

test("캠페인명이 없어도 복사값 계산이 죽지 않는다", () => {
  const fn = script.match(/function handoffCopyValues[\s\S]*?\n  \}/)[0];
  const build = new Function(`${fn}; return handoffCopyValues;`)();

  assert.doesNotThrow(() => build({ draft: { markdown: "본문" } }));
  assert.equal(build({ draft: { markdown: "본문" } }).placeName, "");
});
