"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const read = (relPath) => fs.readFileSync(path.join(appRoot, relPath), "utf8");

test("quick-log script bootstraps init on load for header clock modal binding", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /function bootstrapQuickLogInit\(\)/);
  assert.match(source, /document\.addEventListener\("DOMContentLoaded", run, \{ once: true \}\)/);
  assert.match(source, /bootstrapQuickLogInit\(\);/);
});

test("dashboard boot calls QuickLog init before recentMeetings guard", () => {
  const source = read("public/assets/dashboard.js");
  const initIndex = source.indexOf("window.QuickLog?.init();");
  const guardIndex = source.indexOf("if (!box) return;");
  assert.ok(initIndex >= 0, "QuickLog init call should exist");
  assert.ok(guardIndex >= 0, "recentMeetings guard should exist");
  assert.ok(initIndex < guardIndex, "QuickLog init should run before early return guard");
});

// --- #248 UI/UX P1 ---

test("common shell mounts snackbar, confirm dialog and manage toggle in the quick log modal", () => {
  const source = read("public/assets/common.js");
  assert.match(source, /id="quickLogSnackbar"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(source, /id="quickLogSnackbarAction"/);
  assert.match(source, /id="quickLogConfirm"/);
  assert.match(source, /role="alertdialog"/);
  assert.match(source, /id="quickLogManageToggle"[^>]*aria-pressed="false"/);
  assert.doesNotMatch(source, /id="quickLogStatus"/, "상단 텍스트 상태 영역은 스낵바로 대체되었다");
});

test("summary is rendered in a single unit (buttons), never mixing goal counts", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /오늘 진행 \$\{summary\.achieved\}\/\$\{summary\.target\} 버튼/);
});

test("overview summary exposes button-unit target plus a separate goal_total", () => {
  const source = read("src/domains/planning/quickLog/quickLog.ts");
  assert.match(source, /const target = buttons\.length;/);
  assert.match(source, /const goalTotal = buttons\.reduce/);
  assert.match(source, /goal_total: goalTotal,/);
});

test("record flow paints optimistically and offers undo on success", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /function applyOptimisticCount\(buttonId, delta\)/);
  assert.match(source, /const revert = applyOptimisticCount\(button\.id, 1\);/);
  assert.match(source, /revert\(\);/, "실패 시 낙관적 업데이트를 되돌려야 한다");
  assert.match(source, /onUndo: \(\) => undoRecord\(logId, button\.label\)/);
  assert.match(source, /UNDO_WINDOW_MS = 6000/);
});

test("destructive actions are gated behind manage mode and an in-app confirm", () => {
  const source = read("public/assets/quick-log.js");
  assert.doesNotMatch(source, /window\.confirm\(`/, "버튼 삭제는 인앱 다이얼로그를 사용한다");
  assert.match(source, /state\.manageMode\s*$/m);
  assert.match(source, /const tools = state\.manageMode/);
  assert.match(source, /openConfirm\(\{/);
});

test("buttons show a non-negative streak copy and hide the add card while the form is open", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /오늘 시작해요/);
  assert.match(source, /const addCard = state\.formOpen \? "" :/);
});

test("saving state is reflected on the pressed control", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /function setBusyButton\(el, busy, busyLabel\)/);
  assert.match(source, /function setCardSaving\(triggerEl, saving\)/);
});

// --- #249 UI/UX P2 (접근성) ---

test("modal traps Tab and restores focus to the trigger on close", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /function trapFocus\(e\)/);
  assert.match(source, /if \(e\.key === "Tab"\) \{ trapFocus\(e\); return; \}/);
  assert.match(source, /state\.lastTrigger = document\.activeElement;/);
  assert.match(source, /\$\("btnCloseQuickLogModal"\)\?\.focus\(\);/);
  assert.match(source, /back\?\.focus\?\.\(\);/);
});

test("focus trap scope follows the confirm dialog when it is open", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /const scope = isConfirmOpen\(\) \? \$\("quickLogConfirm"\) : \$\("quickLogModal"\);/);
});

test("panels move focus in on open and hand it back on close", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /focusFirst\(container\);/);
  assert.match(source, /function returnPanelFocus\(\)/);
  assert.match(source, /\$\("qlfLabel"\)\?\.focus\(\);/);
});

test("item chips are real buttons with labels, not spans", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /class="chip-btn quick-log-item-chip" data-action="remove-item"/);
  assert.match(source, /aria-label="'\$\{esc\(label\)\}' 항목 제거"/);
  assert.doesNotMatch(source, /<span class="chip-btn" data-action="remove-item"/);
  assert.match(source, /data-action="select-item"[^`]*aria-pressed="false"/);
  assert.match(source, /el\.setAttribute\("aria-pressed", "true"\);/);
});

test("form errors are bound to the offending field", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /function bindFieldError\(fieldId, errorId\)/);
  assert.match(source, /field\.setAttribute\("aria-invalid", "true"\);/);
  assert.match(source, /field\.setAttribute\("aria-describedby", errorId\);/);
  assert.match(source, /formError\("이름을 입력하세요\.", "qlfLabel"\);/);
});

test("week dots encode status by shape as well as colour and mark today", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /hit: "●", partial: "◐", miss: "○"/);
  assert.match(source, /isToday \? " is-today" : ""/);
  assert.match(source, /aria-label="\$\{esc\(label\)\}"/);
  const css = read("public/assets/styles.css");
  assert.match(css, /\.quick-log-week-dot\.is-today/);
});

test("clock chip announces what it opens", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /chip\.setAttribute\("aria-label", `퀵 기록 열기 \(현재 \$\{hhmm\}\)`\)/);
});

// --- #250 UI/UX P3 (폼 정보구조 · 온보딩) ---

test("input mode is a top-level radio group, not buried in an accordion", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /const INPUT_MODES = \[/);
  assert.match(source, /<fieldset class="quick-log-mode-fieldset">/);
  assert.match(source, /<input type="radio" name="qlfMode"/);
  // 폼 본문에서 기록 방식이 <details> 보다 먼저 나와야 한다
  const form = source.slice(source.indexOf("function buttonFormHtml(existing)"));
  const modeIndex = form.indexOf("quick-log-mode-fieldset");
  const detailsIndex = form.indexOf("<details");
  assert.ok(modeIndex >= 0 && detailsIndex >= 0 && modeIndex < detailsIndex, "기록 방식이 접힘 영역보다 앞에 있어야 한다");
});

test("nested accordion is gone and the summary copy is user-facing", () => {
  const source = read("public/assets/quick-log.js");
  assert.doesNotMatch(source, /quick-log-form-accordion-nested/);
  assert.doesNotMatch(source, /이모지부터 접은 상태로 시작/);
  assert.match(source, /카테고리, 하루 목표, 알림/);
});

test("emoji has a single stored value fed by preset shortcuts", () => {
  const source = read("public/assets/quick-log.js");
  assert.doesNotMatch(source, /qlfEmojiPreset/, "select 기반 중복 입력은 제거되었다");
  assert.match(source, /function emojiPickerHtml\(currentEmoji\)/);
  assert.match(source, /data-action="select-emoji"/);
  assert.match(source, /function syncEmojiPresets\(\)/);
});

test("reminder field is disabled and labelled as pending", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /id="qlfReminder"[^>]*disabled/);
  assert.match(source, /quick-log-pending-badge">준비 중</);
  assert.match(source, /카카오 알림 연동 후 발송됩니다/);
  assert.doesNotMatch(source, /알림 시간은 저장만 됩니다/);
});

test("empty state offers one-tap presets", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /const PRESET_BUTTONS = \[/);
  assert.match(source, /function presetOnboardingHtml\(\)/);
  assert.match(source, /data-action="use-preset"/);
  assert.match(source, /async function createPresetButton\(index, triggerEl\)/);
  assert.match(source, /input_mode: "one_tap"/);
  assert.doesNotMatch(source, /등록된 버튼이 없습니다\. 아래에서 첫 버튼을 만들어보세요\./);
});

test("form mode is read from the checked radio", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /function currentFormMode\(\)/);
  assert.match(source, /input\[name="qlfMode"\]:checked/);
  assert.match(source, /const mode = currentFormMode\(\);/);
});

// --- #251 UI/UX P4 (진입점 · 레이아웃) ---

test("clock chip carries an affordance icon that survives the mobile breakpoint", () => {
  const shell = read("public/assets/common.js");
  assert.match(shell, /quick-log-clock-icon/);
  assert.match(shell, /quick-log-chip-wrap/);
  const css = read("public/assets/styles.css");
  assert.match(css, /\.quick-log-clock-chip--header \.quick-log-clock-date \{ display: none; \}/);
  assert.match(css, /\.quick-log-clock-icon \{[^}]*background: var\(--loop-indigo\)/);
  assert.doesNotMatch(css, /\.quick-log-clock-icon \{[^}]*display: none/, "아이콘은 좁은 화면에서도 남아야 한다");
});

test("first visit coachmark is shown once and remembered", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /const COACHMARK_KEY = "quickLogCoachmarkSeen"/);
  assert.match(source, /function initCoachmark\(\)/);
  assert.match(source, /window\.localStorage\.setItem\(COACHMARK_KEY, "1"\)/);
  assert.match(source, /dismissCoachmark\(\);\s*state\.lastTrigger/, "모달을 열면 코치마크도 종료된다");
  const shell = read("public/assets/common.js");
  assert.match(shell, /id="quickLogCoachmark"/);
});

test("modal widens on desktop and becomes a bottom sheet on mobile", () => {
  const css = read("public/assets/styles.css");
  assert.match(css, /\.quick-log-modal \{ width: min\(720px, 92vw\)/);
  assert.match(css, /\.quick-log-buttons \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(210px, 1fr\)\)/);
  // 바텀시트 규칙은 반드시 모바일 미디어쿼리 안에 있어야 한다
  const sheetBlock = css.split("@media (max-width: 640px)").slice(1)
    .find((block) => block.slice(0, block.indexOf("\n}")).includes(".quick-log-modal {"));
  assert.ok(sheetBlock, "바텀시트 블록이 모바일 미디어쿼리 안에 있어야 한다");
  assert.match(sheetBlock, /top: auto; bottom: 0/);
  assert.match(sheetBlock, /transform: none/);
  assert.match(sheetBlock, /border-radius: 16px 16px 0 0/);
});

// --- #252 soft delete ---

test("log delete drops the confirm dialog and offers restore-based undo", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /async function undoDeleteLog\(logId\)/);
  assert.match(source, /\/restore`, \{ method: "POST" \}/);
  assert.match(source, /showSnackbar\("기록을 삭제했습니다\.", \{ onUndo: \(\) => undoDeleteLog\(logId\) \}\)/);
  // 버튼 삭제는 파급이 커서 확인 다이얼로그를 유지한다
  assert.match(source, /title: `'\$\{button\.label\}' 버튼을 삭제할까요\?`/);
});

test("server soft-deletes logs and restores without touching logged_at", () => {
  const source = read("src/domains/planning/quickLog/quickLog.ts");
  assert.match(source, /UPDATE user_quick_logs SET deleted_at=\? WHERE id=\? AND user_id=\? AND deleted_at IS NULL/);
  assert.match(source, /export async function restoreQuickLogEntry/);
  assert.match(source, /UPDATE user_quick_logs SET deleted_at=NULL WHERE id=\? AND user_id=\? AND deleted_at IS NOT NULL/);
  assert.doesNotMatch(source, /DELETE FROM user_quick_logs/, "물리 삭제 경로가 남아 있으면 복구할 수 없다");
  // 활성 기록만 읽는 쿼리
  const activeFilters = source.match(/AND deleted_at IS NULL/g) || [];
  assert.ok(activeFilters.length >= 4, `활성 필터가 부족하다: ${activeFilters.length}`);
});

test("restore endpoint is routed and matched before the delete route", () => {
  const router = read("src/router.ts");
  assert.match(router, /restoreQuickLogEntry,/);
  assert.match(router, /\^\\\/api\\\/quick-log\\\/logs\\\/\(\[\\w-\]\+\)\\\/restore\$/);
  const restoreIndex = router.indexOf("quickLogRestoreMatch");
  const deleteIndex = router.indexOf("quickLogLogMatch");
  assert.ok(restoreIndex >= 0 && deleteIndex >= 0 && restoreIndex < deleteIndex);
});

test("migration adds deleted_at without breaking existing rows", () => {
  const sql = read("migrations/0092_quick_log_soft_delete.sql");
  assert.match(sql, /ALTER TABLE user_quick_logs ADD COLUMN deleted_at TEXT;/);
  assert.doesNotMatch(sql, /NOT NULL/, "기존 행이 있으므로 기본값 없는 NOT NULL 은 실패한다");
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_user_quick_logs_active/);
});

test("today list is capped and links out to the history tab", () => {
  const source = read("public/assets/quick-log.js");
  assert.match(source, /const TODAY_LIST_LIMIT = 5;/);
  assert.match(source, /const visible = logs\.slice\(0, TODAY_LIST_LIMIT\);/);
  assert.match(source, /more\.hidden = logs\.length <= TODAY_LIST_LIMIT;/);
  assert.match(source, /window\.location\.hash === "#quick-log-history"/);
  const shell = read("public/assets/common.js");
  assert.match(shell, /href="\/time-settings\/#quick-log-history"/);
});
