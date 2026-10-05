// Quick Log — 헤더 시계 칩, 퀵 기록 모달(대시보드), 이력 탭(time-settings) 연결.
// 이슈 #207 P1~P4: 시계 칩/모달 셸, 버튼 CRUD, 기록 흐름(원탭/항목선택/자유입력), 주간 스트릭·이력.
(() => {
  "use strict";

  const MAX_BUTTONS = 8;
  const JSON_HEADERS = { "content-type": "application/json" };
  const DAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];
  const EMOJI_PRESETS = [
    { value: "😀", label: "기분 좋음" },
    { value: "🔥", label: "집중" },
    { value: "💪", label: "운동" },
    { value: "📚", label: "공부" },
    { value: "💧", label: "물" },
    { value: "💊", label: "영양제" },
    { value: "😴", label: "수면" },
    { value: "📝", label: "메모" },
  ];

  const INPUT_MODES = [
    { value: "one_tap", label: "원탭", hint: "누르면 즉시 기록" },
    { value: "pick_item", label: "항목 선택", hint: "등록한 항목 중에서 고르기" },
    { value: "free_text", label: "자유 입력", hint: "그때그때 내용을 입력" },
  ];

  // 빈 상태에서 폼을 다 채우지 않고도 첫 기록까지 갈 수 있게 하는 프리셋 (#250).
  const PRESET_BUTTONS = [
    { emoji: "💧", label: "물 마시기", goal_count: 8 },
    { emoji: "💊", label: "영양제", goal_count: 1 },
    { emoji: "💪", label: "운동", goal_count: 1 },
    { emoji: "😴", label: "수면", goal_count: 1 },
  ];

  const UNDO_WINDOW_MS = 6000;

  const state = {
    overview: null,
    activeButtonId: null,
    selectedItemLabel: null,
    editingButtonId: null,
    formItems: [],
    formOpen: false,
    manageMode: false,
    clockTimer: null,
    snackTimer: null,
    pulseTimer: null,
    pulseButtonId: null,
    lastTrigger: null,
    panelTrigger: null,
    undoHandler: null,
    confirmHandler: null,
    busy: false,
  };

  const $ = (id) => document.getElementById(id);

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  async function api(path, options = {}) {
    const response = await window.apiFetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || "요청에 실패했습니다.");
      err.status = response.status;
      throw err;
    }
    return data;
  }

  function formatClockTime(iso, timezone) {
    try {
      return new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: timezone || "Asia/Seoul",
      }).format(new Date(iso));
    } catch {
      return String(iso || "").slice(11, 16);
    }
  }

  function photoUrl(photoKey) {
    return `/api/quick-log/photos?key=${encodeURIComponent(photoKey)}`;
  }

  function photoThumbHtml(photoKey) {
    if (!photoKey) return "";
    return `<img class="quick-log-thumb" src="${esc(photoUrl(photoKey))}" alt="첨부 사진" loading="lazy" />`;
  }

  function todayDateString() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  // 상태를 색으로만 구분하지 않는다 (#249):
  // 달성=채움+●, 부분=테두리+◐, 미달=빈칸+○ 로 형태까지 함께 인코딩하고,
  // 오늘 칸은 별도 클래스로 강조한다. 툴팁(title)은 터치 기기에서 뜨지 않으므로
  // 같은 내용을 aria-label 로도 제공한다.
  function dayDotsHtml(days) {
    const today = todayDateString();
    return `<div class="quick-log-week-dots" role="list">${(days || []).map((d) => {
      const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay();
      const level = d.hit ? "hit" : (d.count > 0 ? "partial" : "miss");
      const mark = { hit: "●", partial: "◐", miss: "○" }[level];
      const statusText = { hit: "목표 달성", partial: "일부 기록", miss: "기록 없음" }[level];
      const isToday = d.date === today;
      const label = `${d.date} ${DAY_LABEL[dow]}요일 ${d.count}회 · ${statusText}${isToday ? " · 오늘" : ""}`;
      return `<span class="quick-log-week-dot ${level}${isToday ? " is-today" : ""}" role="listitem" aria-label="${esc(label)}" title="${esc(label)}">
        <span class="quick-log-week-dot-day" aria-hidden="true">${DAY_LABEL[dow]}</span>
        <span class="quick-log-week-dot-mark" aria-hidden="true">${mark}</span>
      </span>`;
    }).join("")}</div>`;
  }

  function findButton(buttonId) {
    return (state.overview?.buttons || []).find((b) => b.id === buttonId) || null;
  }

  // ---- 스낵바 (성공·오류 피드백 + 실행 취소) ----
  // 기존에는 모달 최상단 텍스트로만 알려서, 아래로 스크롤한 상태에서는 기록 결과가 보이지 않았다 (#248).

  function hideSnackbar() {
    window.clearTimeout(state.snackTimer);
    state.undoHandler = null;
    const el = $("quickLogSnackbar");
    if (!el) return;
    el.hidden = true;
    el.classList.remove("danger");
    const action = $("quickLogSnackbarAction");
    if (action) action.hidden = true;
  }

  function showSnackbar(message, options = {}) {
    const el = $("quickLogSnackbar");
    const text = $("quickLogSnackbarText");
    const action = $("quickLogSnackbarAction");
    if (!el || !text) return;
    window.clearTimeout(state.snackTimer);
    state.undoHandler = typeof options.onUndo === "function" ? options.onUndo : null;
    text.textContent = message;
    el.classList.toggle("danger", !!options.isError);
    el.hidden = false;
    if (action) {
      action.hidden = !state.undoHandler;
      action.textContent = options.undoLabel || "실행 취소";
    }
    const duration = options.duration || (state.undoHandler ? UNDO_WINDOW_MS : 3500);
    state.snackTimer = window.setTimeout(hideSnackbar, duration);
  }

  // ---- 인앱 확인 다이얼로그 (window.confirm 대체) ----

  function isConfirmOpen() {
    const root = $("quickLogConfirm");
    return !!root && !root.hidden;
  }

  function closeConfirm() {
    const root = $("quickLogConfirm");
    if (root) root.hidden = true;
    state.confirmHandler = null;
    const back = state.confirmTrigger && document.contains(state.confirmTrigger) ? state.confirmTrigger : null;
    state.confirmTrigger = null;
    back?.focus?.();
  }

  function openConfirm({ title, message, confirmLabel, onConfirm }) {
    const root = $("quickLogConfirm");
    if (!root) {
      // 공통 셸이 아직 없는 페이지를 위한 최소 폴백.
      if (window.confirm(message)) void onConfirm();
      return;
    }
    const titleEl = $("quickLogConfirmTitle");
    const descEl = $("quickLogConfirmDesc");
    const okEl = $("quickLogConfirmOk");
    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = message;
    if (okEl) okEl.textContent = confirmLabel || "삭제";
    state.confirmHandler = onConfirm;
    state.confirmTrigger = document.activeElement;
    root.hidden = false;
    $("quickLogConfirmCancel")?.focus();
  }

  // 오류를 폼 하단 한 곳에만 표시하면 스크린리더는 어느 필드가 잘못됐는지 알 수 없다 (#249).
  // 오류 문구를 해당 필드에 aria-describedby 로 묶고 aria-invalid 를 세운 뒤 포커스를 옮긴다.
  function clearFieldError(fieldId) {
    const field = $(fieldId);
    if (!field) return;
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-describedby");
  }

  function bindFieldError(fieldId, errorId) {
    const field = $(fieldId);
    if (!field) return false;
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", errorId);
    field.focus();
    return true;
  }

  function recordError(message, fieldId) {
    const el = $("quickLogRecordError");
    if (el) {
      el.textContent = message;
      el.hidden = false;
    }
    if (fieldId) bindFieldError(fieldId, "quickLogRecordError");
  }

  function formError(message, fieldId) {
    const el = $("qlfFormError");
    if (fieldId) bindFieldError(fieldId, "qlfFormError");
    if (el) {
      el.textContent = message;
      el.hidden = false;
    }
  }

  // ---- 대시보드 시계 칩 + 모달 ----

  function tickClock() {
    const now = new Date();
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const chipTime = $("quickLogClockTime");
    const chipDate = $("quickLogClockDate");
    if (chipTime) chipTime.textContent = hhmm;
    if (chipDate) chipDate.textContent = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
    // 칩은 시각 텍스트만 읽혀서 "누르면 무슨 일이 생기는지"를 알 수 없었다 (#249).
    const chip = $("quickLogClockChip");
    if (chip) chip.setAttribute("aria-label", `퀵 기록 열기 (현재 ${hhmm})`);
    const modalClock = $("quickLogModalClock");
    if (modalClock) modalClock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  // ---- 포커스 관리 (#249) ----

  const FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "summary",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  function visibleFocusables(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => {
      if (el.hidden || el.closest("[hidden]")) return false;
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    });
  }

  function focusFirst(root) {
    const target = visibleFocusables(root)[0];
    if (target) target.focus();
    return !!target;
  }

  // Tab 이 모달 밖 배경 요소로 빠져나가지 않도록 순환시킨다.
  function trapFocus(e) {
    if (e.key !== "Tab" || !isModalOpen()) return;
    const scope = isConfirmOpen() ? $("quickLogConfirm") : $("quickLogModal");
    const items = visibleFocusables(scope);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!scope.contains(active)) {
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
      return;
    }
    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function isModalOpen() {
    const modal = $("quickLogModal");
    return !!modal && !modal.hidden;
  }

  // 시계 칩이 "누를 수 있는 것"임을 첫 방문 1회만 알려준다 (#251).
  const COACHMARK_KEY = "quickLogCoachmarkSeen";

  function dismissCoachmark() {
    const el = $("quickLogCoachmark");
    if (el) el.hidden = true;
    try {
      window.localStorage.setItem(COACHMARK_KEY, "1");
    } catch {
      // 프라이빗 모드 등에서 저장이 막혀도 화면 동작에는 영향이 없다.
    }
  }

  function initCoachmark() {
    const el = $("quickLogCoachmark");
    if (!el) return;
    let seen = true;
    try {
      seen = window.localStorage.getItem(COACHMARK_KEY) === "1";
    } catch {
      seen = true;
    }
    if (seen) return;
    el.hidden = false;
    $("quickLogCoachmarkClose")?.addEventListener("click", dismissCoachmark);
  }

  function openModal() {
    const modal = $("quickLogModal");
    const backdrop = $("quickLogModalBackdrop");
    if (!modal || !backdrop) return;
    dismissCoachmark();
    state.lastTrigger = document.activeElement;
    modal.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add("modal-open");
    $("btnCloseQuickLogModal")?.focus();
    void loadOverview();
  }

  function closeModal() {
    const modal = $("quickLogModal");
    const backdrop = $("quickLogModalBackdrop");
    if (modal) modal.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove("modal-open");
    hideRecordPanel();
    hideButtonForm();
    closeConfirm();
    hideSnackbar();
    // 닫은 뒤 포커스를 원래 자리(보통 헤더 시계 칩)로 돌려준다.
    const back = state.lastTrigger && document.contains(state.lastTrigger)
      ? state.lastTrigger
      : $("quickLogClockChip");
    state.lastTrigger = null;
    back?.focus?.();
  }

  async function loadOverview(opts = {}) {
    const container = $("quickLogButtons");
    if (!opts.silent && container) container.innerHTML = '<p class="hint">불러오는 중...</p>';
    try {
      const overview = await api("/api/quick-log/overview");
      state.overview = overview;
      renderSummary(overview.summary);
      renderButtons(overview.buttons);
      renderTodayList(overview.logs, overview.timezone);
    } catch (err) {
      if (err && err.status === 401) {
        const loginButton = window.oauthLoginButtonsHtml
          ? window.oauthLoginButtonsHtml("account-btn account-login account-login-inline")
          : '<a class="account-btn account-login account-login-inline" href="/api/auth/github"><span>GitHub 로그인</span></a>';
        if (container) container.innerHTML = `<p class="hint">로그인하면 퀵 기록을 사용할 수 있습니다.</p>${loginButton}`;
        const summaryEl = $("quickLogSummary");
        if (summaryEl) summaryEl.innerHTML = "";
        renderManageToggle(0);
        renderTodayList([], "Asia/Seoul");
        return;
      }
      if (container) container.innerHTML = `<p class="hint danger">불러오기 실패: ${esc(err.message)}</p>`;
    }
  }

  function renderSummary(summary) {
    const el = $("quickLogSummary");
    if (!el || !summary) return;
    // 분자·분모 모두 "버튼 수" 단위 (#248). 서버는 goal_total 로 횟수 합을 따로 준다.
    el.innerHTML = `<span class="quick-log-summary-item">오늘 진행 ${summary.achieved}/${summary.target} 버튼</span>` +
      `<span class="quick-log-summary-item">오늘 기록 ${summary.log_count}건</span>`;
  }

  function renderManageToggle(buttonCount) {
    const toggle = $("quickLogManageToggle");
    if (!toggle) return;
    toggle.hidden = buttonCount === 0;
    if (toggle.hidden && state.manageMode) state.manageMode = false;
    toggle.textContent = state.manageMode ? "완료" : "편집";
    toggle.setAttribute("aria-pressed", String(state.manageMode));
  }

  function buttonCardHtml(b) {
    // 편집 모드에서는 카드 본문이 "수정", 별도 버튼이 "삭제"가 된다.
    // 기본 모드에서는 파괴적 액션을 노출하지 않아 기록 중 오탭을 막는다 (#248).
    const main = state.manageMode
      ? `<button type="button" class="quick-log-button-main" data-action="edit-button" data-button-id="${esc(b.id)}" aria-label="${esc(b.label)} 버튼 수정">`
      : `<button type="button" class="quick-log-button-main" data-action="use-button" data-button-id="${esc(b.id)}" aria-label="${esc(b.label)} 기록하기">`;
    const tools = state.manageMode
      ? `<span class="quick-log-button-tools">
          <button type="button" class="btn btn-danger btn-small" data-action="delete-button" data-button-id="${esc(b.id)}">삭제</button>
        </span>`
      : "";
    const streak = b.streak > 0
      ? `<span class="quick-log-streak">🔥 ${b.streak}일 연속</span>`
      : '<span class="quick-log-streak is-idle">오늘 시작해요</span>';
    // 기록 직후 강조는 overview 재조회로 카드가 다시 그려져도 유지되어야 한다.
    const pulse = state.pulseButtonId === b.id ? " just-logged" : "";
    return `
      <div class="quick-log-button-card${state.manageMode ? " is-managing" : ""}${pulse}" data-card-id="${esc(b.id)}">
        ${main}
          <span class="quick-log-button-emoji">${esc(b.emoji || "⭐")}</span>
          <span class="quick-log-button-label">${esc(b.label)}</span>
          <span class="quick-log-button-progress">${b.today_count}/${b.goal_count_value}</span>
        </button>
        ${dayDotsHtml(b.week)}
        <div class="quick-log-button-foot">
          ${streak}
          ${tools}
        </div>
      </div>`;
  }

  function renderButtons(buttons) {
    const container = $("quickLogButtons");
    if (!container) return;
    renderManageToggle(buttons.length);
    const cards = buttons.map(buttonCardHtml).join("");
    const canAddMore = buttons.length < MAX_BUTTONS;
    // 생성/수정 폼이 열려 있는 동안에는 같은 일을 하는 추가 카드를 숨긴다.
    const addCard = state.formOpen ? "" : `
      <div class="quick-log-button-card quick-log-button-add">
        <button type="button" class="btn btn-ghost btn-block" data-action="new-button" ${canAddMore ? "" : "disabled"}>
          ${canAddMore ? "+ 새 버튼 만들기" : "버튼은 최대 8개까지 만들 수 있어요"}
        </button>
      </div>`;
    const empty = buttons.length ? "" : presetOnboardingHtml();
    const manageHint = state.manageMode && buttons.length
      ? '<p class="hint quick-log-manage-hint">카드를 누르면 수정할 수 있어요.</p>'
      : "";
    container.innerHTML = `${empty}${manageHint}<div class="quick-log-buttons">${cards}${addCard}</div>`;
  }

  // 첫 버튼까지 폼 전체를 통과해야 했던 빈 상태를 프리셋 1탭으로 줄인다 (#250).
  function presetOnboardingHtml() {
    const chips = PRESET_BUTTONS.map((preset, index) => `
      <button type="button" class="quick-log-preset-chip" data-action="use-preset" data-preset-index="${index}">
        <span class="quick-log-preset-emoji" aria-hidden="true">${preset.emoji}</span>
        <span>${esc(preset.label)}</span>
      </button>`).join("");
    return `<div class="quick-log-onboarding">
      <p class="hint">아직 버튼이 없어요. 자주 쓰는 것부터 눌러 바로 만들어 보세요.</p>
      <div class="quick-log-preset-chips">${chips}</div>
    </div>`;
  }

  async function createPresetButton(index, triggerEl) {
    const preset = PRESET_BUTTONS[index];
    if (!preset || state.busy) return;
    state.busy = true;
    setBusyButton(triggerEl, true, "만드는 중...");
    try {
      await api("/api/quick-log/buttons", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          label: preset.label,
          emoji: preset.emoji,
          category: "",
          input_mode: "one_tap",
          goal_count: preset.goal_count,
          reminder_time: null,
          items: [],
        }),
      });
      showSnackbar(`${preset.emoji} ${preset.label} 버튼을 만들었어요. 눌러서 기록해 보세요.`);
      await loadOverview({ silent: true });
      findCardMain(state.overview?.buttons?.find((b) => b.label === preset.label)?.id)?.focus();
    } catch (err) {
      showSnackbar(err.message || "버튼을 만들지 못했습니다.", { isError: true });
    } finally {
      state.busy = false;
      setBusyButton(triggerEl, false);
    }
  }

  function findCardMain(buttonId) {
    const nodes = document.querySelectorAll(".quick-log-button-main");
    for (const node of nodes) {
      if (node.dataset.buttonId === buttonId) return node;
    }
    return null;
  }

  function setPulse(buttonId) {
    window.clearTimeout(state.pulseTimer);
    state.pulseButtonId = buttonId;
    if (!buttonId) {
      document.querySelectorAll(".quick-log-button-card.just-logged")
        .forEach((card) => card.classList.remove("just-logged"));
      return;
    }
    state.pulseTimer = window.setTimeout(() => setPulse(null), 700);
  }

  // 서버 응답을 기다리지 않고 카운트를 먼저 올린다. 실패하면 반환된 함수로 되돌린다.
  function applyOptimisticCount(buttonId, delta) {
    const button = findButton(buttonId);
    if (!button) return () => {};
    const previous = button.today_count;
    const paint = (value, pulse) => {
      button.today_count = value;
      setPulse(pulse ? buttonId : null);
      const main = findCardMain(buttonId);
      if (!main) return;
      const progress = main.querySelector(".quick-log-button-progress");
      if (progress) progress.textContent = `${value}/${button.goal_count_value}`;
      main.closest(".quick-log-button-card")?.classList.toggle("just-logged", !!pulse);
    };
    paint(Math.max(0, previous + delta), delta > 0);
    return () => paint(previous, false);
  }

  function setCardSaving(triggerEl, saving) {
    const card = triggerEl?.closest?.(".quick-log-button-card");
    if (card) card.classList.toggle("is-saving", !!saving);
    if (triggerEl && "disabled" in triggerEl) triggerEl.disabled = !!saving;
  }

  const TODAY_LIST_LIMIT = 5;

  function renderTodayList(logs, timezone) {
    const el = $("quickLogTodayList");
    const more = $("quickLogTodayMore");
    if (!el) return;
    if (!logs || !logs.length) {
      el.innerHTML = '<li class="hint">기록이 없습니다.</li>';
      if (more) more.hidden = true;
      return;
    }
    // 기록이 쌓일수록 모달이 끝없이 길어져서 최근 것만 보여주고 나머지는 이력 탭으로 넘긴다 (#251).
    const visible = logs.slice(0, TODAY_LIST_LIMIT);
    if (more) {
      more.hidden = logs.length <= TODAY_LIST_LIMIT;
      const count = $("quickLogTodayMoreCount");
      if (count) count.textContent = String(logs.length - TODAY_LIST_LIMIT);
    }
    el.innerHTML = visible.map((row) => `
      <li class="quick-log-today-item">
        ${photoThumbHtml(row.photo_key)}
        <span class="quick-log-today-time">${formatClockTime(row.logged_at, timezone)}</span>
        <span class="quick-log-today-label">${esc(row.button_label)}${row.item_label ? ` · ${esc(row.item_label)}` : ""}</span>
        ${row.note ? `<span class="quick-log-today-note">${esc(row.note)}</span>` : ""}
        ${row.location ? `<span class="quick-log-today-location">📍 ${esc(row.location)}</span>` : ""}
        <button type="button" class="btn btn-ghost btn-small" data-action="delete-log" data-log-id="${esc(row.id)}" aria-label="${formatClockTime(row.logged_at, timezone)} ${esc(row.button_label)} 기록 삭제">삭제</button>
      </li>`).join("");
  }

  // ---- 기록 흐름 (원탭 · 항목선택 · 자유입력) ----

  async function handleUseButton(buttonId, triggerEl) {
    const button = findButton(buttonId);
    if (!button) return;
    if (button.input_mode === "one_tap") {
      await recordLog(button, {}, triggerEl);
      return;
    }
    openRecordPanel(button, triggerEl);
  }

  function extraFieldsHtml() {
    return `
      <label class="quick-log-field">위치(선택)
        <input type="text" id="quickLogLocationInput" maxlength="120" placeholder="예: 집, 회사" />
      </label>
      <label class="quick-log-field">사진(선택, 최대 5MB)
        <input type="file" id="quickLogPhotoInput" accept="image/*" />
      </label>`;
  }

  function recordPanelHtml(button) {
    const head = `<div class="field-label">${esc(button.emoji || "⭐")} ${esc(button.label)} 기록</div>`;
    if (button.input_mode === "pick_item") {
      if (!button.items.length) {
        return `<div class="panel quick-log-record">
          ${head}
          <p class="hint">이 버튼에 등록된 항목이 없습니다. 먼저 버튼을 수정해 항목을 추가하세요.</p>
          <div class="quick-log-record-actions">
            <button type="button" class="btn btn-ghost btn-small" data-action="cancel-record">닫기</button>
            <button type="button" class="btn btn-primary btn-small" data-action="edit-button" data-button-id="${esc(button.id)}">버튼 수정</button>
          </div>
        </div>`;
      }
      return `<div class="panel quick-log-record">
        ${head}
        <div class="quick-log-item-chips">
          ${button.items.map((i) => `<button type="button" class="chip-btn" data-action="select-item" data-item="${esc(i.label)}" aria-pressed="false">${esc(i.label)}</button>`).join("")}
        </div>
        <details class="quick-log-extra">
          <summary>추가 정보(선택)</summary>
          <textarea id="quickLogNoteInput" maxlength="240" placeholder="메모"></textarea>
          ${extraFieldsHtml()}
        </details>
        <p class="hint danger" id="quickLogRecordError" hidden></p>
        <div class="quick-log-record-actions">
          <button type="button" class="btn btn-ghost btn-small" data-action="cancel-record">취소</button>
          <button type="button" class="btn btn-primary" data-action="save-record">기록하기</button>
        </div>
      </div>`;
    }
    return `<div class="panel quick-log-record">
      ${head}
      <textarea id="quickLogNoteInput" maxlength="240" placeholder="지금 기록할 내용을 입력하세요"></textarea>
      <details class="quick-log-extra">
        <summary>추가 정보(선택)</summary>
        ${extraFieldsHtml()}
      </details>
      <p class="hint danger" id="quickLogRecordError" hidden></p>
      <div class="quick-log-record-actions">
        <button type="button" class="btn btn-ghost btn-small" data-action="cancel-record">취소</button>
        <button type="button" class="btn btn-primary" data-action="save-record">기록하기</button>
      </div>
    </div>`;
  }

  function openRecordPanel(button, triggerEl) {
    hideButtonForm();
    state.activeButtonId = button.id;
    state.selectedItemLabel = null;
    const container = $("quickLogRecordPanel");
    if (!container) return;
    container.innerHTML = recordPanelHtml(button);
    container.hidden = false;
    state.panelTrigger = triggerEl || document.activeElement;
    // scrollIntoView 만으로는 긴 모달에서 패널이 화면 밖에 남을 수 있어 포커스로 이동시킨다.
    container.scrollIntoView({ block: "nearest" });
    focusFirst(container);
  }

  function hideRecordPanel() {
    const container = $("quickLogRecordPanel");
    const wasOpen = container && !container.hidden;
    if (container) {
      container.hidden = true;
      container.innerHTML = "";
    }
    state.activeButtonId = null;
    state.selectedItemLabel = null;
    if (wasOpen) returnPanelFocus();
  }

  // 패널을 연 버튼은 재렌더로 사라졌을 수 있으므로 같은 버튼 카드를 다시 찾는다.
  function returnPanelFocus() {
    const trigger = state.panelTrigger;
    state.panelTrigger = null;
    if (!trigger || !isModalOpen()) return;
    if (document.contains(trigger)) {
      trigger.focus?.();
      return;
    }
    const buttonId = trigger.dataset?.buttonId;
    const replacement = buttonId ? findCardMain(buttonId) : null;
    (replacement || $("quickLogManageToggle") || $("btnCloseQuickLogModal"))?.focus?.();
  }

  function selectItemChip(el) {
    const parent = el.parentElement;
    if (parent) {
      parent.querySelectorAll(".chip-btn").forEach((c) => {
        c.classList.remove("selected");
        c.setAttribute("aria-pressed", "false");
      });
    }
    el.classList.add("selected");
    el.setAttribute("aria-pressed", "true");
    state.selectedItemLabel = el.dataset.item;
  }

  async function uploadPhoto(file) {
    const form = new FormData();
    form.append("photo", file);
    const response = await window.apiFetch("/api/quick-log/photos", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || "사진 업로드에 실패했습니다.");
      err.status = response.status;
      throw err;
    }
    return data;
  }

  async function undoRecord(logId, label) {
    try {
      await api(`/api/quick-log/logs/${encodeURIComponent(logId)}`, { method: "DELETE" });
      showSnackbar(`${label} 기록을 취소했습니다.`);
      await loadOverview({ silent: true });
    } catch (err) {
      showSnackbar(err.message || "실행 취소에 실패했습니다.", { isError: true });
    }
  }

  async function submitLogPayload(button, extra) {
    // id 를 클라이언트에서 만들기 때문에 그대로 실행 취소(DELETE) 대상으로 쓸 수 있다.
    const logId = crypto.randomUUID();
    const payload = { id: logId, button_id: button.id, button_label: button.label, ...extra };
    const result = await api("/api/quick-log/logs", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
    if (result.idempotent) {
      showSnackbar("이미 기록되어 있어요.");
    } else {
      showSnackbar(`${button.emoji || ""} ${button.label} 기록했습니다.`.trim(), {
        onUndo: () => undoRecord(logId, button.label),
      });
    }
    hideRecordPanel();
    await loadOverview({ silent: true });
  }

  // 저장/삭제 중임을 버튼에서 바로 보여준다. 이전에는 state.busy 가 내부 플래그뿐이라
  // 연타해도 아무 반응이 없는 것처럼 보였다 (#248).
  function setBusyButton(el, busy, busyLabel) {
    if (!el) return;
    if (busy) {
      el.dataset.idleLabel = el.textContent;
      el.textContent = busyLabel || "저장 중...";
      el.disabled = true;
      el.classList.add("is-busy");
      return;
    }
    if (el.dataset.idleLabel) {
      el.textContent = el.dataset.idleLabel;
      delete el.dataset.idleLabel;
    }
    el.disabled = false;
    el.classList.remove("is-busy");
  }

  async function saveRecord(triggerEl) {
    const button = findButton(state.activeButtonId);
    if (!button || state.busy) return;
    const noteEl = $("quickLogNoteInput");
    const note = noteEl ? noteEl.value.trim() : "";
    const locationEl = $("quickLogLocationInput");
    const location = locationEl ? locationEl.value.trim() : "";
    const photoInput = $("quickLogPhotoInput");
    const photoFile = photoInput && photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;

    const extra = {};
    if (button.input_mode === "pick_item") {
      if (!state.selectedItemLabel) {
        recordError("항목을 선택하세요.");
        document.querySelector(".quick-log-item-chips .chip-btn")?.focus();
        return;
      }
      extra.item_label = state.selectedItemLabel;
      if (note) extra.note = note;
    } else {
      if (!note) {
        recordError("내용을 입력하세요.", "quickLogNoteInput");
        return;
      }
      clearFieldError("quickLogNoteInput");
      extra.note = note;
    }
    if (location) extra.location = location;

    state.busy = true;
    setBusyButton(triggerEl, true, "기록 중...");
    try {
      if (photoFile) {
        const uploaded = await uploadPhoto(photoFile);
        extra.photo_key = uploaded.photo_key;
      }
      await submitLogPayload(button, extra);
    } catch (err) {
      recordError(err.message || "기록에 실패했습니다.");
    } finally {
      state.busy = false;
      setBusyButton(triggerEl, false);
    }
  }

  async function recordLog(button, extra, triggerEl) {
    if (state.busy) return;
    state.busy = true;
    setCardSaving(triggerEl, true);
    const revert = applyOptimisticCount(button.id, 1);
    try {
      await submitLogPayload(button, extra);
    } catch (err) {
      revert();
      showSnackbar(err.message || "기록에 실패했습니다.", { isError: true });
    } finally {
      state.busy = false;
      setCardSaving(triggerEl, false);
    }
  }

  async function undoDeleteLog(logId) {
    try {
      await api(`/api/quick-log/logs/${encodeURIComponent(logId)}/restore`, { method: "POST" });
      showSnackbar("기록을 되살렸습니다.");
      await loadOverview({ silent: true });
    } catch (err) {
      showSnackbar(err.message || "되돌리기에 실패했습니다.", { isError: true });
    }
  }

  // 서버가 soft delete 를 지원하므로(#252) 확인 다이얼로그 없이 지우고 되돌릴 수 있다.
  // 복구는 logged_at 을 그대로 두기 때문에 기록 시각이 바뀌지 않는다.
  async function handleDeleteLog(logId) {
    if (state.busy) return;
    state.busy = true;
    try {
      await api(`/api/quick-log/logs/${encodeURIComponent(logId)}`, { method: "DELETE" });
      showSnackbar("기록을 삭제했습니다.", { onUndo: () => undoDeleteLog(logId) });
      await loadOverview({ silent: true });
    } catch (err) {
      showSnackbar(err.message || "삭제에 실패했습니다.", { isError: true });
    } finally {
      state.busy = false;
    }
  }

  // ---- 버튼 CRUD ----

  function renderFormItems() {
    const list = $("qlfItemsList");
    if (!list) return;
    // span 이었을 때는 포커스가 가지 않아 키보드·스크린리더로 항목을 지울 수 없었다 (#249).
    list.innerHTML = state.formItems.length
      ? state.formItems.map((label, idx) => (
        `<button type="button" class="chip-btn quick-log-item-chip" data-action="remove-item" data-index="${idx}" aria-label="'${esc(label)}' 항목 제거">${esc(label)} <span aria-hidden="true">✕</span></button>`
      )).join("")
      : '<p class="hint">등록된 항목이 없습니다.</p>';
  }

  function addFormItem() {
    const input = $("qlfItemInput");
    if (!input) return;
    const value = input.value.trim().slice(0, 120);
    if (!value) return;
    if (state.formItems.includes(value)) {
      input.value = "";
      return;
    }
    if (state.formItems.length >= 12) {
      formError("항목은 최대 12개까지 추가할 수 있습니다.", "qlfItemInput");
      return;
    }
    clearFieldError("qlfItemInput");
    state.formItems.push(value);
    input.value = "";
    renderFormItems();
  }

  // 기록 방식은 버튼의 성격 자체라 접힘 뒤에 두지 않는다 (#250).
  // 네이티브 radio 를 쓰면 방향키 이동·그룹 읽기가 브라우저 기본 동작으로 따라온다.
  function modeOptionsHtml(mode) {
    return INPUT_MODES.map((m) => `
      <label class="quick-log-mode-option">
        <input type="radio" name="qlfMode" value="${m.value}" ${mode === m.value ? "checked" : ""} />
        <span class="quick-log-mode-option-body">
          <strong>${esc(m.label)}</strong>
          <small>${esc(m.hint)}</small>
        </span>
      </label>`).join("");
  }

  // 이모지 입력 경로를 하나로 합친다 (#250).
  // 이전에는 프리셋 select 와 텍스트 입력이 따로 있어 어느 값이 저장되는지 알 수 없었다.
  // 이제 저장 값의 유일한 출처는 #qlfEmoji 이고, 프리셋 버튼은 그 값을 채우는 단축키다.
  function emojiPickerHtml(currentEmoji) {
    const normalized = String(currentEmoji || "").trim();
    const presets = EMOJI_PRESETS.map((preset) => `
      <button type="button" class="quick-log-emoji-preset" data-action="select-emoji" data-emoji="${esc(preset.value)}"
        aria-pressed="${preset.value === normalized}" aria-label="${esc(preset.label)} ${esc(preset.value)}" title="${esc(preset.label)}">
        ${preset.value}
      </button>`).join("");
    return `<div class="quick-log-emoji-picker">
      <div class="field-label" id="qlfEmojiLabel">이모지</div>
      <div class="quick-log-emoji-grid" role="group" aria-labelledby="qlfEmojiLabel">${presets}</div>
      <label class="quick-log-field quick-log-emoji-direct">직접 입력
        <input type="text" id="qlfEmoji" maxlength="8" value="${esc(normalized)}" placeholder="🙂" />
      </label>
    </div>`;
  }

  function buttonFormHtml(existing) {
    const mode = existing?.input_mode || "one_tap";
    return `<div class="panel quick-log-form-panel">
      <div class="field-label">${existing ? "버튼 수정" : "새 버튼 만들기"}</div>
      <label class="quick-log-field">이름*
        <input type="text" id="qlfLabel" maxlength="60" value="${esc(existing?.label || "")}" />
      </label>
      <fieldset class="quick-log-mode-fieldset">
        <legend>기록 방식</legend>
        <div class="quick-log-mode-options">${modeOptionsHtml(mode)}</div>
      </fieldset>
      <div class="quick-log-items-editor" id="qlfItemsEditor" ${mode === "pick_item" ? "" : "hidden"}>
        <div class="field-label">항목 (최대 12개)</div>
        <div class="quick-log-items-list" id="qlfItemsList"></div>
        <div class="quick-log-item-add-row">
          <input type="text" id="qlfItemInput" maxlength="120" placeholder="항목 이름" />
          <button type="button" class="btn btn-ghost btn-small" data-action="add-item">추가</button>
        </div>
      </div>
      ${emojiPickerHtml(existing?.emoji || "")}
      <details class="quick-log-form-accordion">
        <summary>
          <span>
            <strong>카테고리, 하루 목표, 알림</strong>
            <small>선택사항</small>
          </span>
          <em aria-hidden="true"></em>
        </summary>
        <div class="quick-log-form-accordion-body">
          <div class="quick-log-form-row">
            <label class="quick-log-field">카테고리
              <input type="text" id="qlfCategory" maxlength="40" value="${esc(existing?.category || "")}" placeholder="예: 건강" />
            </label>
            <label class="quick-log-field">하루 목표 횟수
              <input type="number" id="qlfGoal" min="1" max="99" value="${existing?.goal_count ?? ""}" placeholder="예: 1" />
            </label>
          </div>
          <label class="quick-log-field quick-log-field-pending">
            <span class="quick-log-field-head">알림 시간 <span class="quick-log-pending-badge">준비 중</span></span>
            <input type="time" id="qlfReminder" value="${existing?.reminder_time || ""}" disabled aria-describedby="qlfReminderHint" />
          </label>
          <p class="hint" id="qlfReminderHint">카카오 알림 연동 후 발송됩니다. 지금은 설정할 수 없어요.</p>
        </div>
      </details>
      <p class="hint danger" id="qlfFormError" hidden></p>
      <div class="quick-log-record-actions">
        <button type="button" class="btn btn-ghost btn-small" data-action="cancel-button-form">취소</button>
        <button type="button" class="btn btn-primary" data-action="save-button-form">${existing ? "저장" : "만들기"}</button>
      </div>
    </div>`;
  }

  function openButtonForm(existing) {
    hideRecordPanel();
    state.editingButtonId = existing ? existing.id : null;
    state.formItems = existing && existing.input_mode === "pick_item" ? existing.items.map((i) => i.label) : [];
    const container = $("quickLogButtonForm");
    if (!container) return;
    state.panelTrigger = document.activeElement;
    container.innerHTML = buttonFormHtml(existing);
    container.hidden = false;
    state.formOpen = true;
    if (state.overview) renderButtons(state.overview.buttons);
    renderFormItems();
    container.scrollIntoView({ block: "nearest" });
    $("qlfLabel")?.focus();
  }

  function hideButtonForm() {
    const container = $("quickLogButtonForm");
    if (container) {
      container.hidden = true;
      container.innerHTML = "";
    }
    const wasOpen = state.formOpen;
    state.editingButtonId = null;
    state.formItems = [];
    state.formOpen = false;
    if (wasOpen && state.overview) renderButtons(state.overview.buttons);
    if (wasOpen) returnPanelFocus();
  }

  async function saveButtonForm(triggerEl) {
    const labelEl = $("qlfLabel");
    const label = labelEl ? labelEl.value.trim() : "";
    if (!label) {
      formError("이름을 입력하세요.", "qlfLabel");
      return;
    }
    clearFieldError("qlfLabel");
    const mode = currentFormMode();
    if (mode === "pick_item" && !state.formItems.length) {
      formError("항목을 1개 이상 추가하세요.", "qlfItemInput");
      return;
    }
    const goalRaw = $("qlfGoal")?.value.trim() || "";
    const reminderRaw = $("qlfReminder")?.value.trim() || "";
    const payload = {
      label,
      emoji: $("qlfEmoji")?.value.trim() || "",
      category: $("qlfCategory")?.value.trim() || "",
      input_mode: mode,
      goal_count: goalRaw ? Number(goalRaw) : null,
      reminder_time: reminderRaw || null,
      items: mode === "pick_item" ? state.formItems : [],
    };
    if (state.busy) return;
    state.busy = true;
    setBusyButton(triggerEl, true, "저장 중...");
    try {
      if (state.editingButtonId) {
        await api(`/api/quick-log/buttons/${encodeURIComponent(state.editingButtonId)}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(payload) });
        showSnackbar("버튼을 수정했습니다.");
      } else {
        await api("/api/quick-log/buttons", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
        showSnackbar("버튼을 만들었습니다.");
      }
      hideButtonForm();
      await loadOverview({ silent: true });
    } catch (err) {
      formError(err.message || "저장에 실패했습니다.");
    } finally {
      state.busy = false;
      setBusyButton(triggerEl, false);
    }
  }

  function handleDeleteButton(buttonId) {
    const button = findButton(buttonId);
    if (!button) return;
    openConfirm({
      title: `'${button.label}' 버튼을 삭제할까요?`,
      message: "버튼만 사라지고, 이미 남긴 기록은 그대로 유지됩니다.",
      confirmLabel: "버튼 삭제",
      onConfirm: async () => {
        try {
          await api(`/api/quick-log/buttons/${encodeURIComponent(buttonId)}`, { method: "DELETE" });
          showSnackbar("버튼을 삭제했습니다.");
          if (state.activeButtonId === buttonId) hideRecordPanel();
          if (state.editingButtonId === buttonId) hideButtonForm();
          await loadOverview({ silent: true });
        } catch (err) {
          showSnackbar(err.message || "삭제에 실패했습니다.", { isError: true });
        }
      },
    });
  }

  // ---- 모달 이벤트 위임 ----

  function onModalClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    if (action === "use-button") { void handleUseButton(el.dataset.buttonId, el); return; }
    if (action === "edit-button") { openButtonForm(findButton(el.dataset.buttonId)); return; }
    if (action === "delete-button") { handleDeleteButton(el.dataset.buttonId); return; }
    if (action === "new-button") { openButtonForm(null); return; }
    if (action === "use-preset") { void createPresetButton(Number(el.dataset.presetIndex), el); return; }
    if (action === "select-emoji") {
      const input = $("qlfEmoji");
      if (input) {
        // 이미 선택된 프리셋을 다시 누르면 해제한다.
        input.value = input.value.trim() === el.dataset.emoji ? "" : el.dataset.emoji;
        syncEmojiPresets();
      }
      return;
    }
    if (action === "select-item") { selectItemChip(el); return; }
    if (action === "cancel-record") { hideRecordPanel(); return; }
    if (action === "save-record") { void saveRecord(el); return; }
    if (action === "cancel-button-form") { hideButtonForm(); return; }
    if (action === "save-button-form") { void saveButtonForm(el); return; }
    if (action === "add-item") { addFormItem(); return; }
    if (action === "delete-log") { void handleDeleteLog(el.dataset.logId); return; }
    if (action === "remove-item") {
      const index = Number(el.dataset.index);
      state.formItems.splice(index, 1);
      renderFormItems();
      // 지운 칩은 DOM 에서 사라지므로 포커스를 다음 칩(없으면 입력창)으로 넘긴다.
      const chips = $("qlfItemsList")?.querySelectorAll(".quick-log-item-chip") || [];
      (chips[Math.min(index, chips.length - 1)] || $("qlfItemInput"))?.focus();
    }
  }

  function currentFormMode() {
    return document.querySelector('input[name="qlfMode"]:checked')?.value || "one_tap";
  }

  function syncEmojiPresets() {
    const value = ($("qlfEmoji")?.value || "").trim();
    document.querySelectorAll(".quick-log-emoji-preset").forEach((el) => {
      el.setAttribute("aria-pressed", String(el.dataset.emoji === value));
    });
  }

  function onModalChange(e) {
    if (e.target && e.target.name === "qlfMode") {
      const editor = $("qlfItemsEditor");
      if (editor) editor.hidden = currentFormMode() !== "pick_item";
      // 항목 선택으로 바꾸면 곧바로 항목을 넣을 수 있게 입력창으로 보낸다.
      if (currentFormMode() === "pick_item") $("qlfItemInput")?.focus();
    }
  }

  function onModalInput(e) {
    if (e.target && e.target.id === "qlfEmoji") syncEmojiPresets();
  }

  function onModalKeydown(e) {
    if (e.key === "Enter" && e.target && e.target.id === "qlfItemInput") {
      e.preventDefault();
      addFormItem();
    }
  }

  function bindModalEvents() {
    const modal = $("quickLogModal");
    if (!modal || modal.dataset.quickLogBound) return;
    modal.dataset.quickLogBound = "1";
    modal.addEventListener("click", onModalClick);
    modal.addEventListener("change", onModalChange);
    modal.addEventListener("input", onModalInput);
    modal.addEventListener("keydown", onModalKeydown);
  }

  function init() {
    const chip = $("quickLogClockChip");
    if (!chip || chip.dataset.quickLogBound) return;
    chip.dataset.quickLogBound = "1";
    // common.js 가 시작한 공통 헤더 시계 타이머를 정리하고 자체 interval 로 교체한다.
    if (window.__harnessClockTimer) {
      window.clearInterval(window.__harnessClockTimer);
      window.__harnessClockTimer = null;
    }
    tickClock();
    if (state.clockTimer) window.clearInterval(state.clockTimer);
    state.clockTimer = window.setInterval(tickClock, 1000);
    chip.addEventListener("click", openModal);
    initCoachmark();
    $("btnCloseQuickLogModal")?.addEventListener("click", closeModal);
    $("quickLogModalBackdrop")?.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Tab") { trapFocus(e); return; }
      if (e.key !== "Escape") return;
      // 확인 다이얼로그가 떠 있으면 그것만 닫는다.
      if (isConfirmOpen()) { closeConfirm(); return; }
      if (isModalOpen()) closeModal();
    });
    $("quickLogManageToggle")?.addEventListener("click", () => {
      state.manageMode = !state.manageMode;
      hideRecordPanel();
      if (state.overview) renderButtons(state.overview.buttons);
      else renderManageToggle(0);
    });
    $("quickLogSnackbarAction")?.addEventListener("click", () => {
      const handler = state.undoHandler;
      hideSnackbar();
      if (handler) void handler();
    });
    $("quickLogConfirmCancel")?.addEventListener("click", closeConfirm);
    $("quickLogConfirmOk")?.addEventListener("click", () => {
      const handler = state.confirmHandler;
      closeConfirm();
      if (handler) void handler();
    });
    $("quickLogConfirm")?.addEventListener("click", (e) => {
      if (e.target && e.target.id === "quickLogConfirm") closeConfirm();
    });
    bindModalEvents();
  }

  // ---- /time-settings 이력 탭 (P4) ----
  // 참고: 기존 time-settings 화면은 서버 SDUI 컴포넌트 트리로 렌더되므로,
  // 이력 탭은 그 트리를 건드리지 않고 정적 sibling 패널 + 자체 탭 전환으로 연결한다
  // (generic SDUI 스키마 변경 없이 REQ-11 기능 요건을 충족하기 위한 결정 — 진행 보고에 명시).

  function shiftDateStr(dateStr, delta) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + delta);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  function defaultHistoryRange() {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 6);
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { from: fmt(from), to: fmt(to) };
  }

  function computeDayBuckets(logs, from, to) {
    const counts = new Map();
    for (const row of logs) counts.set(row.logged_date, (counts.get(row.logged_date) || 0) + 1);
    const days = [];
    let cursor = from;
    let guard = 0;
    while (cursor <= to && guard < 60) {
      days.push({ date: cursor, count: counts.get(cursor) || 0, hit: (counts.get(cursor) || 0) > 0 });
      cursor = shiftDateStr(cursor, 1);
      guard += 1;
    }
    return days;
  }

  function renderHistoryList(container, logs) {
    if (!container) return;
    if (!logs.length) {
      container.innerHTML = '<li class="hint">해당 기간에 기록이 없습니다.</li>';
      return;
    }
    const grouped = new Map();
    for (const row of logs) {
      const list = grouped.get(row.logged_date) || [];
      list.push(row);
      grouped.set(row.logged_date, list);
    }
    const dates = Array.from(grouped.keys()).sort().reverse();
    container.innerHTML = dates.map((date) => `
      <li class="quick-log-history-day">
        <div class="quick-log-history-day-head">${esc(date)}</div>
        <ul class="quick-log-today-list">
          ${grouped.get(date).map((row) => `
            <li class="quick-log-today-item">
              ${photoThumbHtml(row.photo_key)}
              <span class="quick-log-today-time">${formatClockTime(row.logged_at, row.timezone)}</span>
              <span class="quick-log-today-label">${esc(row.button_label)}${row.item_label ? ` · ${esc(row.item_label)}` : ""}</span>
              ${row.note ? `<span class="quick-log-today-note">${esc(row.note)}</span>` : ""}
              ${row.location ? `<span class="quick-log-today-location">📍 ${esc(row.location)}</span>` : ""}
            </li>`).join("")}
        </ul>
      </li>`).join("");
  }

  function initHistoryTab() {
    const fromInput = $("qlHistoryFrom");
    const toInput = $("qlHistoryTo");
    const loadBtn = $("qlHistoryLoad");
    const weekBtn = $("qlHistoryThisWeek");
    const range = defaultHistoryRange();
    if (fromInput && !fromInput.value) fromInput.value = range.from;
    if (toInput && !toInput.value) toInput.value = range.to;

    async function loadHistory() {
      const list = $("quickLogHistoryList");
      const dots = $("quickLogHistoryDots");
      if (list) list.innerHTML = '<li class="hint">불러오는 중...</li>';
      try {
        const from = fromInput?.value || range.from;
        const to = toInput?.value || range.to;
        const data = await api(`/api/quick-log/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        if (dots) dots.innerHTML = dayDotsHtml(computeDayBuckets(data.logs, from, to));
        renderHistoryList(list, data.logs);
      } catch (err) {
        if (err && err.status === 401) {
          if (list) list.innerHTML = '<li class="hint">로그인하면 퀵 기록 이력을 볼 수 있습니다.</li>';
          if (dots) dots.innerHTML = "";
          return;
        }
        if (list) list.innerHTML = `<li class="hint danger">불러오기 실패: ${esc(err.message)}</li>`;
      }
    }

    loadBtn?.addEventListener("click", () => void loadHistory());
    weekBtn?.addEventListener("click", () => {
      const r = defaultHistoryRange();
      if (fromInput) fromInput.value = r.from;
      if (toInput) toInput.value = r.to;
      void loadHistory();
    });
    void loadHistory();
  }

  function initTimeSettingsTabs() {
    const tabSettings = $("timeSettingsTabSettings");
    const tabHistory = $("timeSettingsTabHistory");
    const root = $("root");
    const historyPanel = $("quickLogHistoryPanel");
    if (!tabSettings || !tabHistory || !root || !historyPanel) return;
    let historyLoaded = false;
    function activate(tab) {
      const isHistory = tab === "history";
      tabSettings.classList.toggle("active", !isHistory);
      tabSettings.setAttribute("aria-selected", String(!isHistory));
      tabHistory.classList.toggle("active", isHistory);
      tabHistory.setAttribute("aria-selected", String(isHistory));
      root.hidden = isHistory;
      historyPanel.hidden = !isHistory;
      if (isHistory && !historyLoaded) {
        historyLoaded = true;
        initHistoryTab();
      }
    }
    tabSettings.addEventListener("click", () => activate("settings"));
    tabHistory.addEventListener("click", () => activate("history"));
    // 모달의 "전체 보기"가 곧바로 이력 탭을 열 수 있도록 해시를 지원한다 (#251).
    if (window.location.hash === "#quick-log-history") activate("history");
    window.addEventListener("hashchange", () => {
      if (window.location.hash === "#quick-log-history") activate("history");
    });
  }

  if (document.body && document.body.dataset.page === "time-settings") {
    initTimeSettingsTabs();
  }

  // SDUI 엔진 boot 성공 여부와 무관하게 시계 칩 클릭 핸들러를 바인딩한다.
  // (공유 헤더에 배치된 시계 칩은 모든 페이지에서 동작해야 하므로 페이지 제한 없이 초기화)
  function bootstrapQuickLogInit() {
    const run = () => init();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
      return;
    }
    run();
  }

  bootstrapQuickLogInit();
  window.QuickLog = { init };
})();
