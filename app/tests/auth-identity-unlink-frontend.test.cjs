// 소셜 계정 연결 해제 프론트(mypage) 계약 테스트 (#221).
// 실제 브라우저 없이 mypage.js/mypage.html 소스를 정적으로 검증한다(기존 nblog-publish-screen.test.cjs 패턴).
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const read = (relative) => readFileSync(path.join(__dirname, "..", "public", relative), "utf8");
const script = read("assets/mypage.js");
const html = read("assets/sdui-fragments/mypage.html");

function section(name) {
  const match = script.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`));
  assert.ok(match, `${name} 함수를 찾지 못했습니다`);
  return match[0];
}

test("연결 상태 컨테이너가 정적 4버튼 대신 동적 렌더 대상으로 바뀌었다", () => {
  assert.match(html, /id="accountLinkList"/);
  assert.match(html, /id="accountLinkStatus"/);
  assert.doesNotMatch(html, /id="btnLinkGithubAccount"/, "정적 버튼이 남아있으면 안 됩니다(동적 렌더로 대체)");
});

test("provider별 연결 상태에 따라 [계정 연결]/[연결 해제] 버튼을 표시한다", () => {
  const render = section("renderAccountLinkList");
  assert.match(render, /계정 연결/);
  assert.match(render, /data-action="unlink-provider"/);
  assert.match(render, /data-provider="\$\{provider\}"/);
  assert.match(render, /연결 해제/);
});

test("마지막 로그인 수단은 버튼을 비활성화하고 정확한 안내 문구를 보여준다", () => {
  const render = section("renderAccountLinkList");
  assert.match(render, /isLastMethod/);
  assert.match(render, /disabled aria-disabled="true"/);
  assert.match(render, /마지막 로그인 방법은 연결 해제할 수 없습니다\. 다른 소셜 계정을 연결하거나 이메일 로그인을 설정해 주세요\./);
});

test("연결 해제 전 확인 모달 문구가 스펙과 일치한다", () => {
  assert.match(script, /window\.confirm\(`\$\{label\} 계정 연결을 해제하시겠습니까\? 연결을 해제하면 이 계정으로 현재 계정에 로그인할 수 없습니다\.`\)/);
});

test("요청 중에는 버튼이 비활성화되고 '해제 중...' 문구를 보여주며, 이미 처리 중이면 다시 클릭해도 무시한다", () => {
  const render = section("renderAccountLinkList");
  assert.match(render, /해제 중\.\.\./);
  assert.match(render, /\$\{busy \? "disabled" : ""\}/);

  const bind = section("bindAccountLinkEvents");
  assert.match(bind, /if \(!button \|\| button\.disabled\) return;/);
});

test("성공하면 서버를 다시 조회해 연결 상태를 즉시 반영한다", () => {
  const bind = section("bindAccountLinkEvents");
  assert.match(bind, /await refreshAccountLinkState\(\);/);
  const refresh = section("refreshAccountLinkState");
  assert.match(refresh, /apiFetch\("\/api\/me"\)/);
  assert.match(refresh, /applyAccountLinkState\(me\)/);
});

test("실패 코드별로 다른 안내를 보여준다 (last_login_method / identity_not_found / 그 외)", () => {
  const bind = section("bindAccountLinkEvents");
  assert.match(bind, /data\.code === "last_login_method"/);
  assert.match(bind, /data\.code === "identity_not_found"/);
  assert.match(bind, /이미 연결이 해제된 계정입니다\./);
});

test("로컬 해제는 성공했지만 외부 폐기가 실패한 부분 실패 상태를 별도로 안내한다", () => {
  const bind = section("bindAccountLinkEvents");
  assert.match(bind, /data\.revoke_status === "failed"/);
  assert.match(bind, /외부 서비스 연동 해제는 실패해 잠시 후 자동으로 다시 시도합니다/);
  // GitHub는 부가로 git-project-sync류 기능이 함께 꺼진다는 점도 안내한다.
  assert.match(bind, /GitHub 이슈·Project 연동 기능도 함께 꺼졌습니다/);
});

test("칸반 우선순위 매트릭스는 히스토리 로드 실패를 별도 에러 상태로 기록한다 (#236)", () => {
  assert.match(script, /let historyLoadError = "";/);
  const loadHistory = section("loadHistory");
  assert.match(loadHistory, /historyLoadError = "";/);
  assert.match(loadHistory, /historyLoadError = err\.message;/);
});

test("칸반 상태 문구는 history/kanban 동시 실패와 단일 실패를 구분해 노출한다 (#236)", () => {
  const render = section("renderKanbanMatrix");
  assert.match(render, /kanbanLoadError && historyLoadError/);
  assert.match(render, /보드 과업과 기존 일정을 불러오지 못했습니다/);
  assert.match(render, /기존 일정은 표시했지만 보드 과업을 불러오지 못했습니다/);
  assert.match(render, /보드 과업은 표시했지만 기존 일정을 불러오지 못했습니다/);
});
