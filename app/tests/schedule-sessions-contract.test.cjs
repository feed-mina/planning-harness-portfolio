const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(appRoot, file), "utf8");

test("issue 242 migration defines session evidence and multi-project sources", () => {
  const sql = read("migrations/0093_schedule_sessions.sql");
  for (const table of [
    "github_schedule_sources",
    "schedule_sessions",
    "schedule_session_links",
    "schedule_session_reports",
    "schedule_session_entries",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /idx_schedule_sessions_user_starts/);
  assert.match(sql, /idx_schedule_session_links_session/);
  assert.match(sql, /idx_schedule_session_links_repo_number/);
  assert.match(sql, /CHECK \(status IN \('scheduled', 'done', 'canceled'\)\)/);
  assert.match(sql, /meeting_url IS NULL OR meeting_url LIKE 'https:\/\/%'/);
  assert.match(sql, /외부 meeting_url 로 직접 참여한 경우에는 입장 근거가 생성되지 않는다/);
});

test("schedule APIs expose sources, session mutations, reports, attendance, and GitHub items", () => {
  const router = read("src/router.ts");
  const implementation = read("src/domains/planning/scheduleSessions.ts");
  for (const route of [
    "/api/schedule/sources",
    "/api/schedule/sessions",
    "/api/schedule/github-items",
  ]) {
    assert.match(router, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(implementation, /MAX_SOURCES = 20/);
  assert.match(implementation, /createScheduleSession/);
  assert.match(implementation, /updateScheduleSession/);
  assert.match(implementation, /upsertScheduleSessionReport/);
  assert.match(implementation, /enterScheduleSession/);
  assert.match(implementation, /leaveScheduleSession/);
  assert.match(router, /scheduleSessionReportMatch/);
  assert.match(router, /scheduleSessionEntriesMatch/);
  assert.match(implementation, /listProjectItems/);
  assert.match(implementation, /updateIssuePriorityMatrix/);
  assert.match(router, /scheduleSessionMatch && request\.method === "DELETE"/);
});

test("deletion APIs keep history recoverable and local kanban deletion scoped", () => {
  const migration = read("migrations/0095_history_soft_delete.sql");
  const router = read("src/router.ts");
  const history = read("src/history.ts");
  const kanban = read("src/domains/planning/kanban.ts");
  assert.match(migration, /ALTER TABLE history_marks ADD COLUMN deleted_at TEXT/);
  assert.match(history, /deleteHistoryItem/);
  assert.match(history, /restoreHistoryItem/);
  assert.match(history, /recoverable: true/);
  assert.match(router, /historyRestoreMatch/);
  assert.match(kanban, /deleteKanbanCard/);
  assert.match(kanban, /github_issue_closed: false/);
});

test("mypage connects multiple repo Projects to schedule and project-filtered kanban", () => {
  const html = read("public/assets/sdui-fragments/mypage.html");
  const script = read("public/assets/mypage.js");
  assert.match(html, /id="scheduleSourceRows"/);
  assert.match(html, /id="btnAddScheduleSource"/);
  assert.match(html, /id="btnSaveScheduleSources"/);
  assert.match(html, /id="kanbanProject"/);
  assert.match(html, /data-schedule-kind="github"/);
  assert.match(script, /loadScheduleGithubItems/);
  assert.match(script, /scheduleGithubEvent/);
  assert.match(script, /GitHub Project 업무/);
  assert.match(script, /\/api\/schedule\/github-items/);
  assert.match(script, /Pull Request는 칸반에서 읽기 전용/);
});

test("kanban repository picker adds removable chips and intersects with the Project filter", () => {
  const html = read("public/assets/sdui-fragments/mypage.html");
  const script = read("public/assets/mypage.js");
  const css = read("public/assets/styles.css");
  for (const id of [
    "kanbanRepositoryPicker",
    "kanbanRepositorySummary",
    "kanbanRepositoryOptions",
    "kanbanRepositoryChips",
    "btnClearKanbanRepositories",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /aria-live="polite"/);
  assert.match(script, /let kanbanRepositories = new Set\(\)/);
  assert.match(script, /kanbanProject === "all" \|\| item\.project_id === kanbanProject/);
  assert.match(script, /!kanbanRepositories\.size \|\| kanbanRepositories\.has\(item\.repo\)/);
  assert.match(script, /data-kanban-repository-option/);
  assert.match(script, /data-kanban-repository-remove/);
  assert.match(script, /aria-pressed=/);
  assert.match(script, /clearButton\.disabled = !kanbanRepositories\.size/);
  assert.match(css, /\.kanban-filter-grid/);
  assert.match(css, /\.kanban-repository-chips/);
});

test("compatible historical migrations needed for fresh and staging databases remain present", () => {
  for (const file of [
    "migrations/0010_dagshub_session_run.sql",
    "migrations/0012_analysis_result_contracts.sql",
    "migrations/0087_studio_pages_actions.sql",
  ]) {
    assert.equal(fs.existsSync(path.join(appRoot, file)), true, `${file} should exist`);
  }
});

test("deployment repair aligns legacy and current GraphRAG schemas", () => {
  const sql = read("migrations/0094_analysis_graph_schema_alignment.sql");
  assert.match(sql, /DROP TABLE IF EXISTS analysis_graph_edges/);
  assert.match(sql, /DROP TABLE IF EXISTS analysis_graph_nodes/);
  assert.match(sql, /source_node_id TEXT NOT NULL/);
  assert.match(sql, /target_node_id TEXT NOT NULL/);
  assert.match(sql, /UNIQUE\(session_id, user_id, normalized_name\)/);
  assert.doesNotMatch(sql, /\bsrc_node_id\b|\bdst_node_id\b/);
});
