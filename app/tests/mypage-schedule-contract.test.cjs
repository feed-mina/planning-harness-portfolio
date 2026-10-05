const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(appRoot, "public/assets/sdui-fragments/mypage.html"), "utf8");
const script = fs.readFileSync(path.join(appRoot, "public/assets/mypage.js"), "utf8");
const legacyScript = fs.readFileSync(path.join(appRoot, "public/assets/sdui-legacy.js"), "utf8");
const serviceWorker = fs.readFileSync(path.join(appRoot, "public/sw.js"), "utf8");

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start marker: ${start}`);
  assert.ok(to > from, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test("mypage schedule exposes calendar modes, folded filters and cards, and empty states", () => {
  const section = between(html, 'id="tabSchedule"', 'id="tabKanban"');
  assert.match(section, /data-schedule-view="week"/);
  assert.match(section, /data-schedule-view="month"/);
  assert.match(section, /<details class="schedule-filter-fold">/);
  assert.match(section, /data-schedule-tab="upcoming"/);
  assert.match(section, /data-schedule-tab="past"/);
  assert.match(section, /id="scheduleTimeline"/);
  assert.match(section, /id="scheduleRepository"/);
  assert.match(html, /id="scheduleDayModal"/);
  assert.match(html, /id="scheduleDayModalBody"/);

  const implementation = between(script, "function scheduleDate(key)", "function findScheduleItem(el)");
  assert.match(implementation, /<details class="schedule-event-card/);
  assert.match(implementation, /schedule-day-preview/);
  assert.match(implementation, /function openScheduleDayModal\(date\)/);
  assert.match(implementation, /scheduleView === "month"/);
  assert.match(implementation, /예정된 일정이 없어요/);
  assert.match(implementation, /지난 일정이 없어요/);
  assert.match(implementation, /조건에 맞는 일정이 없어요/);
});

test("GitHub schedule filter supports repositories and keeps undated project items visible", () => {
  const implementation = between(script, "function scheduleDate(key)", "function findScheduleItem(el)");
  assert.match(implementation, /scheduleRepository/);
  assert.match(implementation, /scheduleGithubItems\.map\(scheduleGithubEvent\)\.filter\(\(event\) => !event\.date\)/);
  assert.match(implementation, /repository: item\.repo \|\| ""/);
  assert.match(implementation, /\[event\.project, event\.note\]\.filter\(Boolean\)\.join\(" · "\)/);
  assert.match(implementation, /날짜 미지정/);
});

test("GitHub issues land on the calendar by due date, falling back to creation date", () => {
  const git = fs.readFileSync(path.join(appRoot, "src/git.ts"), "utf8");
  // GraphQL 이 createdAt 을 가져와야 생성일 기준 표시가 가능하다.
  assert.match(git, /\.\.\. on Issue \{\s*\n\s*id number title url state createdAt/);
  assert.match(git, /\.\.\. on PullRequest \{\s*\n\s*id number title url state isDraft createdAt/);
  assert.match(git, /created_at: content\.createdAt \? String\(content\.createdAt\) : null/);
  assert.match(git, /created_at: string \| null;/);

  const implementation = between(script, "function scheduleDate(key)", "function findScheduleItem(el)");
  assert.match(implementation, /scheduleZonedParts\(item\.created_at\)/, "생성일은 서버 타임존 기준 날짜로 변환한다");
  assert.match(implementation, /date: item\.due_date \|\| createdDate/);
  assert.match(implementation, /생성 \$\{createdDate\}/, "생성일 기준 배치임을 카드에 표시한다");
});

test("project item fetch paginates so items past the first 100 still appear", () => {
  const git = fs.readFileSync(path.join(appRoot, "src/git.ts"), "utf8");
  // 보드 순서는 오래된 항목부터라 첫 페이지만 읽으면 최근 이슈가 잘린다.
  assert.match(git, /items\(first:\$\{PROJECT_ITEM_PAGE_SIZE\}, after:\$after\)/);
  assert.match(git, /pageInfo \{ hasNextPage endCursor \}/);
  assert.match(git, /MAX_PROJECT_ITEM_PAGES = 5/);
  assert.match(git, /GitHub Project item limit exceeded/);
  assert.match(git, /GitHub Project pagination cursor was missing/);
  assert.match(git, /after = pageInfo\.endCursor;/);
});

test("done and unclassified kanban zones fold as accordions with persisted state", () => {
  assert.match(script, /<details class="schedule-extra \$\{key\}" data-kanban-matrix-zone="\$\{key\}" data-kanban-extra-fold="\$\{key\}"\$\{kanbanExtrasOpen\[key\] \? " open" : ""\}>/);
  assert.match(script, /<summary class="schedule-extra-head"/);
  assert.match(script, /KANBAN_EXTRAS_FOLD_KEY = "planning-harness\.kanban-extras-fold\.v1"/);
  assert.match(script, /function readKanbanExtrasFold\(\)/);
  assert.match(script, /function persistKanbanExtrasFold\(\)/);
  // toggle 은 버블링되지 않으므로 캡처 단계 리스너로 저장한다.
  assert.match(script, /addEventListener\("toggle", \(event\) => \{[\s\S]*?persistKanbanExtrasFold\(\);\s*\}, true\)/);
  // 카드 이동 클릭이 summary 접힘 토글로 번지면 안 된다.
  assert.match(script, /event\.preventDefault\(\);\s*\n\s*await moveKanbanMatrixCard\(kanbanMatrixSelectedCardId/);
  const css = fs.readFileSync(path.join(appRoot, "public/assets/styles.css"), "utf8");
  assert.match(css, /summary\.schedule-extra-head \{ cursor: pointer; list-style: none;/);
  assert.match(css, /\.schedule-extra:not\(\[open\]\) \{ min-height: 0; \}/);
});

test("legacy page fragments bypass stale service-worker cache after a deploy", () => {
  assert.match(legacyScript, /fetch\(fragmentUrl,\s*\{\s*cache: "no-store"/);
  assert.match(serviceWorker, /request\.cache === "no-store"/);
  assert.match(serviceWorker, /event\.respondWith\(networkFirst\(request\)\)/);
  assert.match(serviceWorker, /shell-v7/);
});

test("schedule reuses history and time-block APIs and classifies with server time", () => {
  const implementation = between(script, "function scheduleDate(key)", "function findScheduleItem(el)");
  assert.match(script, /\/api\/history\?limit=200/);
  assert.match(implementation, /\/api\/time-blocks\?\$\{params\.toString\(\)\}/);
  assert.match(implementation, /data\.server_now/);
  assert.match(implementation, /scheduleBlockPhase/);
  assert.doesNotMatch(implementation, /Date\.now\(\)/);
});

test("schedule and history expose confirmed source-specific deletion actions", () => {
  assert.match(script, /data-schedule-action="delete-block"/);
  assert.match(script, /data-schedule-action="delete-history"/);
  assert.match(script, /data-schedule-action="close-github"/);
  assert.match(script, /\/api\/time-blocks\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(script, /\/api\/history\/\$\{encodeURIComponent\(item\.kind\)\}/);
  assert.match(script, /원본과 산출물은 즉시 파기되지 않으며 복구 API/);
  assert.match(script, /반복 규칙 전체가 아니라 선택한 날짜만 제외/);
});

test("self-hosted sessions and external meeting link UI stay out of scope", () => {
  const section = between(html, 'id="tabSchedule"', 'id="tabKanban"');
  assert.doesNotMatch(section, /입장하기|외부 회의 링크|meeting link/i);
  const implementation = between(script, "function scheduleDate(key)", "function findScheduleItem(el)");
  assert.doesNotMatch(implementation, /meet-open|meet-edit|세션 룸|입장하기/);
});
