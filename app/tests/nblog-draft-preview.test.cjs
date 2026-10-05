const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const read = (p) => fs.readFileSync(path.join(publicDir, p), "utf8");
const script = read("assets/nblog-automation.js");

/** 번들에서 렌더러만 떼어 온다. esc 는 테스트용으로 최소 구현을 주입한다. */
const renderDraftPreview = new Function(
  "esc",
  `${/\n  function renderDraftPreview\([\s\S]*?\n  \}/.exec(script)[0]}; return renderDraftPreview;`,
)((value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));

/**
 * REQ-4 — 초안을 블로그에 올라간 모습으로 보여준다.
 *
 * 서버가 만든 preview.html 은 `frame-ancestors 'none'` 이라 iframe 에 넣을 수 없다.
 * 그 헤더를 푸는 대신 마크다운을 직접 그리므로, 이스케이프가 이 화면의 안전선이다.
 */
test("소제목과 문단을 태그로 바꾼다", () => {
  const html = renderDraftPreview("# 인계동술집 방문기\n\n## 첫 잔\n시원했어요.");

  assert.match(html, /<h3>인계동술집 방문기<\/h3>/);
  assert.match(html, /<h4>첫 잔<\/h4>/);
  assert.match(html, /<p>시원했어요\.<\/p>/);
});

test("사진 자리를 눈에 보이게 그린다", () => {
  const html = renderDraftPreview("문단\n\n[IMAGE:001]\n\n[VIDEO:002]");

  assert.match(html, /<div class="nblog-preview-slot">사진 001 자리<\/div>/);
  assert.match(html, /<div class="nblog-preview-slot">영상 002 자리<\/div>/);
});

test("태그 줄을 칩으로 그린다", () => {
  const html = renderDraftPreview("#미생맥주 #인계동술집");

  assert.match(html, /<div class="nblog-preview-tags"><span>#미생맥주<\/span><span>#인계동술집<\/span><\/div>/);
});

test("목록을 항목으로 그린다", () => {
  assert.match(renderDraftPreview("- 장소: 미생맥주"), /<li>장소: 미생맥주<\/li>/);
});

test("HTML 을 넣어도 태그로 살아나지 않는다", () => {
  // 본문은 모델이 만든 문자열이라 신뢰하지 않는다.
  const html = renderDraftPreview('<img src=x onerror=alert(1)>\n\n## <script>alert(2)</script>');

  assert.ok(!html.includes("<img"), "img 가 살아있다");
  assert.ok(!html.includes("<script"), "script 가 살아있다");
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
});

test("실제 v9 초안을 그려도 스크립트가 남지 않는다", () => {
  const draft = [
    "# 인계동술집 방문기", "", "이 글은 업체로부터 서비스를 제공받아 솔직하게 작성한 후기입니다.", "",
    "## 들어가서 자리 잡기", "간판이 눈에 띄어서 발걸음을 멈췄다.", "[IMAGE:001]", "",
    "## 첫 잔과 분위기", "시원하게 넘어갔다.", "[VIDEO:002]", "",
    "#미생맥주 #인계동술집 #수원맛집",
  ].join("\n");

  const html = renderDraftPreview(draft);

  assert.ok(!/<(script|img|iframe|style)\b/i.test(html));
  assert.equal((html.match(/nblog-preview-slot/g) || []).length, 2);
  assert.match(html, /<h4>첫 잔과 분위기<\/h4>/);
});

test("올라간 모습이 기본이고 원문은 접혀 있다", () => {
  assert.match(script, /<article class="nblog-preview-paper">/);
  assert.match(script, /<details class="nblog-preview-raw"><summary>붙여넣을 원문 보기<\/summary>/);
});

test("필드가 비어도 렌더링이 죽지 않는다", () => {
  // 같은 화면에 '다시 만들기' 버튼이 있어, 여기서 예외가 나면 모달 전체가 안 그려지고
  // 사용자가 빠져나갈 방법이 없어진다.
  const section = (title, inner) => `<section><h3>${title}</h3>${inner}</section>`;
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const build = new Function(
    "esc", "section",
    `${/\n  function renderDraftPreview\([\s\S]*?\n  \}/.exec(script)[0]}\n`
    + `${/\n  function sectionDraftCopy\([\s\S]*?\n  \}/.exec(script)[0]}; return sectionDraftCopy;`,
  )(esc, section);

  for (const copy of [{}, { title: "제목" }, { body: "본문" }, { tags: "#가" }]) {
    assert.doesNotThrow(() => build({ draft: {}, copy, payload: {} }), JSON.stringify(copy));
  }
});

test("미리보기 스타일이 정의되어 있다", () => {
  const css = read("assets/nblog-automation.css");

  for (const rule of ["nblog-preview-paper", "nblog-preview-slot", "nblog-preview-tags", "nblog-preview-raw"]) {
    assert.match(css, new RegExp(`\\.${rule}`), `${rule} 규칙 없음`);
  }
});
