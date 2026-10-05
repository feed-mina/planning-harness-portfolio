(() => {
  "use strict";

  const KIND_LABEL = { available: "가능", busy: "바쁨", focus: "집중", meeting: "회의" };
  const REPEAT_DAY_LABEL = { 0: "일", 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토" };
  const QUICK_MINUTES = [10, 30, 60, 180];
  const TIMEZONE_LABEL = {
    "Asia/Seoul": "서울",
    "Asia/Tokyo": "도쿄",
    "Europe/London": "런던",
    "America/New_York": "뉴욕",
    "America/Los_Angeles": "로스앤젤레스",
  };
  const state = {
    currentDate: localDateString(),
    me: null,
    integrations: null,
    mode: "quick_from_now",
    // On first load the target is exactly now; only quick buttons add time.
    quickMinutes: 0,
    manualSaved: false,
    nowTimer: null,
  };

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));

  async function api(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
    return data;
  }

  function ref(ctx, id) {
    return ctx.refs[id] || document.getElementById(id);
  }

  function selectedTimezone(ctx) {
    return ref(ctx, "timezone")?.value || "Asia/Seoul";
  }

  function status(ctx, id, text, danger = false) {
    const el = ref(ctx, id);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("danger", danger);
  }

  function selectedWeekdays(ctx) {
    const row = ref(ctx, "weekdayRow");
    if (!row) return [];
    return Array.from(row.querySelectorAll("input:checked")).map((input) => Number(input.value));
  }

  function zonedDateTimeParts(date = new Date(), timezone) {
    if (!timezone) {
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds(),
      };
    }
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(date);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour),
        minute: Number(values.minute),
        second: Number(values.second),
      };
    } catch {
      return zonedDateTimeParts(date);
    }
  }

  function localDateString(date = new Date(), timezone) {
    const parts = zonedDateTimeParts(date, timezone);
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function timeString(date = new Date(), timezone, includeSeconds = false) {
    const parts = zonedDateTimeParts(date, timezone);
    const base = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
    return includeSeconds ? `${base}:${String(parts.second).padStart(2, "0")}` : base;
  }

  function timezoneOffsetLabel(date, timezone) {
    try {
      const zone = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        timeZoneName: "longOffset",
      }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
      return String(zone || timezone).replace("GMT", "UTC");
    } catch {
      return timezone;
    }
  }

  function formatKoreanTime(value) {
    const [hourRaw, minuteRaw] = String(value || "00:00").split(":").map(Number);
    const hour = Number.isFinite(hourRaw) ? hourRaw : 0;
    const minute = Number.isFinite(minuteRaw) ? minuteRaw : 0;
    const period = hour < 12 ? "오전" : "오후";
    const displayHour = hour % 12 || 12;
    return `${period} ${String(displayHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function addMinutes(date, minutes) {
    return new Date(date.getTime() + Number(minutes || 0) * 60000);
  }

  function durationLabel(minutes) {
    const value = Math.max(0, Number(minutes) || 0);
    const hours = Math.floor(value / 60);
    const remainder = value % 60;
    if (hours && remainder) return `+${hours}시간 ${remainder}분`;
    if (hours) return `+${hours}시간`;
    return `+${remainder}분`;
  }

  function setWeekdays(ctx, days) {
    const row = ref(ctx, "weekdayRow");
    if (!row) {
      setRepeatWeekdays(ctx, days);
      return;
    }
    const selected = new Set((Array.isArray(days) ? days : [1, 2, 3, 4, 5]).map(Number));
    row.querySelectorAll("input").forEach((input) => {
      input.checked = selected.has(Number(input.value));
    });
    setRepeatWeekdays(ctx, Array.from(selected));
  }

  function repeatWeekdays(ctx) {
    const row = ref(ctx, "repeatWeekdayRow");
    if (!row) return [];
    return Array.from(row.querySelectorAll("input:checked")).map((input) => Number(input.value));
  }

  function setRepeatWeekdays(ctx, days) {
    const row = ref(ctx, "repeatWeekdayRow");
    if (!row) return;
    const selected = new Set((Array.isArray(days) ? days : [1, 2, 3, 4, 5]).map(Number));
    row.querySelectorAll("input").forEach((input) => {
      input.checked = selected.has(Number(input.value));
    });
  }

  function repeatDayText(days) {
    return days.map((day) => REPEAT_DAY_LABEL[day]).filter(Boolean).join(", ");
  }

  function selectedReminderMinutes(ctx) {
    const row = ref(ctx, "reminderMinuteRow");
    if (!row) return [30];
    const minutes = Array.from(row.querySelectorAll("input:checked")).map((input) => Number(input.value));
    return minutes.length ? minutes : [30];
  }

  function quickSelection(ctx) {
    const now = new Date();
    const timezone = selectedTimezone(ctx);
    const target = addMinutes(now, state.quickMinutes);
    const crossesDay = localDateString(now, timezone) !== localDateString(target, timezone);
    return {
      start_time: timeString(now, timezone),
      end_time: crossesDay ? "23:59" : timeString(target, timezone),
      now,
      target,
      timezone,
      crossesDay,
    };
  }

  function manualSelection(ctx) {
    return {
      start_time: ref(ctx, "blockStart")?.value || "09:00",
      end_time: ref(ctx, "blockEnd")?.value || "10:00",
    };
  }

  function activeSelection(ctx) {
    if (state.mode === "manual_range") return manualSelection(ctx);
    return quickSelection(ctx);
  }

  function setMode(ctx, mode) {
    state.mode = mode === "manual_range" ? "manual_range" : "quick_from_now";
    syncTimeSelectionUi(ctx);
  }

  function syncTimeSelectionUi(ctx) {
    const manual = state.mode === "manual_range";
    ctx.root?.classList.toggle("manual-time-mode", manual);
    ctx.root?.classList.toggle("quick-time-mode", !manual);

    document.querySelectorAll("[data-quick-minutes]").forEach((button) => {
      button.classList.remove("active");
      button.removeAttribute("aria-pressed");
    });

    const toggle = ref(ctx, "btnManualTimeToggle");
    const panel = ref(ctx, "manualTimePanel");
    if (toggle && panel) {
      const open = !panel.hidden;
      toggle.classList.toggle("active", manual);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = manual && state.manualSaved ? "시작·종료 시간 직접 지정 사용 중" : "시작·종료 시간 직접 지정";
    }
    updateTimeSummary(ctx);
    syncIntegrationButtons(ctx);
  }

  function updateTimeSummary(ctx) {
    const date = ref(ctx, "blockDate")?.value || state.currentDate;
    const now = new Date();
    const timezone = selectedTimezone(ctx);
    const quick = quickSelection(ctx);
    const selection = state.mode === "manual_range" ? manualSelection(ctx) : quick;
    const currentTimeText = ref(ctx, "currentTimeText");
    const currentTimezoneText = ref(ctx, "currentTimezoneText");
    const targetTimeText = ref(ctx, "targetTimeText");
    const targetModeText = ref(ctx, "targetModeText");
    const dateSummary = ref(ctx, "dateSummaryText");
    const manualSummary = ref(ctx, "manualTimeSummary");
    if (currentTimeText) currentTimeText.textContent = timeString(now, timezone, true);
    if (currentTimezoneText) {
      currentTimezoneText.textContent = `${TIMEZONE_LABEL[timezone] || timezone} · ${timezoneOffsetLabel(now, timezone)}`;
    }
    if (targetTimeText) targetTimeText.textContent = `목표 시간 ${formatKoreanTime(selection.end_time)}`;
    if (targetModeText) {
      targetModeText.textContent = state.mode === "manual_range"
        ? `${formatKoreanTime(selection.start_time)} - ${formatKoreanTime(selection.end_time)} 직접 지정`
        : quick.crossesDay ? "오늘 23:59까지" : `${durationLabel(state.quickMinutes)} 후`;
    }
    if (dateSummary) dateSummary.textContent = `${date === localDateString(now, timezone) ? "오늘 " : ""}${date}`;
    if (manualSummary) manualSummary.textContent = `${formatKoreanTime(manualSelection(ctx).start_time)} - ${formatKoreanTime(manualSelection(ctx).end_time)}`;
  }

  function setQuickDuration(ctx, node, event) {
    const button = event?.currentTarget;
    const minutes = Number(button?.dataset.quickMinutes || node?.props?.dataset?.quickMinutes || 0);
    const increment = QUICK_MINUTES.includes(minutes) ? minutes : 0;
    state.quickMinutes += increment;
    state.manualSaved = false;
    const manualPanel = ref(ctx, "manualTimePanel");
    if (manualPanel) manualPanel.hidden = true;
    setMode(ctx, "quick_from_now");
    status(ctx, "blockStatus", `${durationLabel(increment)}을 더해 목표 시간을 ${durationLabel(state.quickMinutes)}으로 계산했습니다.`);
  }

  function toggleManualTime(ctx, _node, event) {
    const panel = ref(ctx, "manualTimePanel");
    if (!panel) return;
    const open = panel.hidden;
    panel.hidden = !open;
    if (event?.currentTarget) event.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      setMode(ctx, "manual_range");
      state.manualSaved = false;
      status(ctx, "blockStatus", "시작·종료 시간을 직접 지정합니다.");
    } else {
      syncTimeSelectionUi(ctx);
      status(ctx, "blockStatus", "");
    }
  }

  function toggleRepeatBlock(ctx, _node, event) {
    const panel = ref(ctx, "repeatPanel");
    if (!panel) return;
    const open = panel.hidden;
    panel.hidden = !open;
    const button = event?.currentTarget || ref(ctx, "btnRepeatBlock");
    if (button) {
      button.classList.toggle("active", open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (open && !repeatWeekdays(ctx).length) setRepeatWeekdays(ctx, selectedWeekdays(ctx));
    status(ctx, "blockStatus", open ? "반복 요일을 선택할 수 있습니다." : "");
  }

  function showIntegrationStatus(ctx, text, danger = false) {
    status(ctx, "integrationStatus", text, danger);
  }

  function integrationConnected(provider) {
    return !!state.integrations?.[provider]?.connected;
  }

  function syncControlTooltip(control, message, align = "center") {
    if (!control) return;
    // 브라우저 기본 title 툴팁은 스타일링할 수 없고 본문을 가리므로 커스텀 말풍선으로 통일한다.
    control.removeAttribute("title");
    const descriptionId = `${control.id || "integrationControl"}TooltipDescription`;
    let description = document.getElementById(descriptionId);
    if (!message) {
      delete control.dataset.uiTooltip;
      delete control.dataset.tooltipAlign;
      if (control.getAttribute("aria-describedby") === descriptionId) control.removeAttribute("aria-describedby");
      description?.remove();
      return;
    }
    control.dataset.uiTooltip = message;
    control.dataset.tooltipAlign = align;
    if (!description) {
      description = document.createElement("span");
      description.id = descriptionId;
      description.className = "sr-only";
      control.insertAdjacentElement("afterend", description);
    }
    description.textContent = message;
    control.setAttribute("aria-describedby", descriptionId);
  }

  function syncIntegrationButtons(ctx) {
    const google = ref(ctx, "btnGoogleCalendarConnect");
    const kakao = ref(ctx, "btnKakaoNoticeConnect");
    const addCalendar = ref(ctx, "btnCreateGoogleCalendarEvent");
    const sendKakao = ref(ctx, "btnSendKakaoNotice");
    const scheduleKakao = ref(ctx, "btnScheduleKakaoReminders");
    const manualCalendar = ref(ctx, "btnManualGoogleCalendar");
    const manualKakao = ref(ctx, "btnManualKakaoReminders");
    const active = activeSelection(ctx);
    const manual = manualSelection(ctx);
    const activeRangeValid = active.start_time < active.end_time;
    const manualRangeValid = manual.start_time < manual.end_time;
    if (google) google.textContent = integrationConnected("google_calendar") ? "구글 캘린더 연결됨" : "구글 캘린더 연결";
    if (kakao) kakao.textContent = integrationConnected("kakao_message") ? "카카오 메시지 연결됨" : "카카오 메시지 알림 연결";
    if (addCalendar) addCalendar.disabled = !integrationConnected("google_calendar") || !activeRangeValid;
    if (sendKakao) sendKakao.disabled = !integrationConnected("kakao_message") || !activeRangeValid;
    if (scheduleKakao) scheduleKakao.disabled = !integrationConnected("kakao_message") || !activeRangeValid;
    if (manualCalendar) manualCalendar.disabled = !integrationConnected("google_calendar") || !manualRangeValid;
    if (manualKakao) manualKakao.disabled = !integrationConnected("kakao_message") || !manualRangeValid;
    syncControlTooltip(
      google,
      integrationConnected("google_calendar")
        ? "Google Calendar 연결이 완료되었습니다."
        : "연결이 안 되면 Google Cloud의 OAuth 테스트 사용자 등록 여부를 확인해 주세요.",
      "start",
    );
    syncControlTooltip(
      kakao,
      integrationConnected("kakao_message") ? "카카오 메시지 연결이 완료되었습니다." : "연결하려면 카카오 메시지 권한 동의가 필요합니다.",
    );
    syncControlTooltip(
      addCalendar,
      addCalendar?.disabled
        ? (integrationConnected("google_calendar") ? "먼저 빠른 시간을 더하거나 시작·종료 시간을 직접 지정해 주세요." : "먼저 Google Calendar를 연결해 주세요.")
        : "",
    );
    syncControlTooltip(
      sendKakao,
      sendKakao?.disabled
        ? (integrationConnected("kakao_message") ? "먼저 빠른 시간을 더하거나 시작·종료 시간을 직접 지정해 주세요." : "먼저 카카오 메시지 알림을 연결해 주세요.")
        : "",
      "end",
    );
    syncControlTooltip(
      scheduleKakao,
      scheduleKakao?.disabled
        ? (integrationConnected("kakao_message") ? "먼저 빠른 시간을 더하거나 시작·종료 시간을 직접 지정해 주세요." : "먼저 카카오 메시지 알림을 연결해 주세요.")
        : "",
      "end",
    );
    syncControlTooltip(
      manualCalendar,
      manualCalendar?.disabled ? (manualRangeValid ? "먼저 Google Calendar를 연결해 주세요." : "시작 시간은 종료 시간보다 빨라야 합니다.") : "",
      "start",
    );
    syncControlTooltip(
      manualKakao,
      manualKakao?.disabled ? (manualRangeValid ? "먼저 카카오 메시지 알림을 연결해 주세요." : "시작 시간은 종료 시간보다 빨라야 합니다.") : "",
      "end",
    );
    const statusEl = ref(ctx, "integrationStatus");
    if (statusEl && !statusEl.textContent.trim()) statusEl.textContent = "";
  }

  function ensureManualIntegrationActions(ctx) {
    const panel = ref(ctx, "manualTimePanel");
    if (!panel || ref(ctx, "manualIntegrationActions")) return;
    const section = document.createElement("section");
    section.id = "manualIntegrationActions";
    section.className = "manual-integration-actions";
    section.innerHTML = `
      <div>
        <strong>직접 지정 시간 연동</strong>
        <p class="hint">위 시작·종료 시간을 그대로 Google Calendar와 카카오 예약 알림에 사용합니다.</p>
      </div>
      <div class="manual-integration-buttons">
        <button id="btnManualGoogleCalendar" class="btn btn-ghost" type="button">구글 캘린더에 추가</button>
        <button id="btnManualKakaoReminders" class="btn btn-primary" type="button">카카오 예약 알림 등록</button>
      </div>`;
    panel.appendChild(section);
    ref(ctx, "btnManualGoogleCalendar")?.addEventListener("click", () => void createManualCalendarEvent(ctx));
    ref(ctx, "btnManualKakaoReminders")?.addEventListener("click", () => void scheduleManualKakaoReminders(ctx));
    syncIntegrationButtons(ctx);
  }

  async function loadIntegrationState(ctx) {
    try {
      const data = await api("/api/integrations/status");
      state.integrations = data.integrations || {};
      syncIntegrationButtons(ctx);
    } catch {
      state.integrations = {};
      syncIntegrationButtons(ctx);
    }
  }

  function schedulePayload(ctx, forceManual = false) {
    const repeatPanel = ref(ctx, "repeatPanel");
    const selection = forceManual ? manualSelection(ctx) : activeSelection(ctx);
    if (selection.start_time >= selection.end_time) {
      throw new Error(forceManual || state.mode === "manual_range"
        ? "직접 지정한 시작 시간은 종료 시간보다 빨라야 합니다."
        : "먼저 +10분·+30분·+1시간·+3시간을 선택하거나 시작·종료 시간을 직접 지정해 주세요.");
    }
    return {
      date: ref(ctx, "blockDate")?.value || state.currentDate,
      start_time: selection.start_time,
      end_time: selection.end_time,
      timezone: ref(ctx, "timezone")?.value || "Asia/Seoul",
      kind: ref(ctx, "blockKind")?.value || "available",
      note: ref(ctx, "blockNote")?.value || "",
      repeat_weekdays: repeatPanel && !repeatPanel.hidden ? repeatWeekdays(ctx) : [],
      reminder_minutes: selectedReminderMinutes(ctx),
    };
  }

  function connectGoogleCalendar(ctx) {
    showIntegrationStatus(ctx, "Google OAuth 화면으로 이동합니다. 403 access_denied가 보이면 관리자에게 테스트 사용자 등록을 요청해 주세요.");
    location.href = "/api/integrations/google/calendar/connect";
  }

  function connectKakaoNotice(ctx) {
    showIntegrationStatus(ctx, "Kakao 메시지 권한 동의 화면으로 이동합니다.");
    location.href = "/api/integrations/kakao/message/connect";
  }

  async function createCalendarEvent(ctx) {
    showIntegrationStatus(ctx, "Google Calendar에 일정을 추가하는 중입니다.");
    try {
      const data = await api("/api/integrations/google/calendar/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schedulePayload(ctx)),
      });
      showIntegrationStatus(ctx, data.event?.html_link ? "Google Calendar에 일정을 추가했습니다." : "Google Calendar에 일정을 추가했습니다.");
    } catch (err) {
      showIntegrationStatus(ctx, err instanceof Error ? err.message : "Google Calendar 일정 추가 실패", true);
      await loadIntegrationState(ctx);
    }
  }

  async function createManualCalendarEvent(ctx) {
    setMode(ctx, "manual_range");
    showIntegrationStatus(ctx, "직접 지정 시간을 Google Calendar에 추가하는 중입니다.");
    try {
      const data = await api("/api/integrations/google/calendar/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schedulePayload(ctx, true)),
      });
      showIntegrationStatus(ctx, data.event?.html_link
        ? "직접 지정 시간을 Google Calendar에 추가했습니다."
        : "직접 지정 시간을 Google Calendar에 추가했습니다.");
    } catch (err) {
      showIntegrationStatus(ctx, err instanceof Error ? err.message : "Google Calendar 일정 추가 실패", true);
      await loadIntegrationState(ctx);
    }
  }

  async function sendKakaoNotice(ctx) {
    showIntegrationStatus(ctx, "Kakao 메시지를 보내는 중입니다.");
    try {
      await api("/api/integrations/kakao/message/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schedulePayload(ctx)),
      });
      showIntegrationStatus(ctx, "Kakao 나에게 보내기 메시지를 발송했습니다.");
    } catch (err) {
      showIntegrationStatus(ctx, err instanceof Error ? err.message : "Kakao 메시지 발송 실패", true);
      await loadIntegrationState(ctx);
    }
  }

  async function scheduleKakaoReminders(ctx) {
    const minutes = selectedReminderMinutes(ctx);
    showIntegrationStatus(ctx, "Kakao 예약 알림을 등록하는 중입니다.");
    try {
      const data = await api("/api/integrations/kakao/message/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schedulePayload(ctx)),
      });
      const labels = (data.jobs || []).map((job) => job.label).join(", ");
      showIntegrationStatus(ctx, `Kakao 예약 알림 ${data.scheduled_count || minutes.length}개를 등록했습니다.${labels ? ` (${labels})` : ""}`);
    } catch (err) {
      showIntegrationStatus(ctx, err instanceof Error ? err.message : "Kakao 예약 알림 등록 실패", true);
      await loadIntegrationState(ctx);
    }
  }

  async function scheduleManualKakaoReminders(ctx) {
    setMode(ctx, "manual_range");
    const minutes = selectedReminderMinutes(ctx);
    showIntegrationStatus(ctx, "직접 지정 시간의 Kakao 예약 알림을 등록하는 중입니다.");
    try {
      const data = await api("/api/integrations/kakao/message/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schedulePayload(ctx, true)),
      });
      const labels = (data.jobs || []).map((job) => job.label).join(", ");
      showIntegrationStatus(ctx, `직접 지정 시간의 Kakao 예약 알림 ${data.scheduled_count || minutes.length}개를 등록했습니다.${labels ? ` (${labels})` : ""}`);
    } catch (err) {
      showIntegrationStatus(ctx, err instanceof Error ? err.message : "Kakao 예약 알림 등록 실패", true);
      await loadIntegrationState(ctx);
    }
  }

  function showRedirectStatus(ctx) {
    const params = new URLSearchParams(location.search);
    const integration = params.get("integration");
    const result = params.get("status");
    if (integration === "google_calendar" && result === "connected") {
      showIntegrationStatus(ctx, "Google Calendar 연결이 완료되었습니다.");
    } else if (integration === "kakao_message" && result === "connected") {
      showIntegrationStatus(ctx, "Kakao 메시지 연결이 완료되었습니다.");
    }
  }

  function renderBlocks(ctx, blocks) {
    const rows = ref(ctx, "blockRows");
    if (!rows) return;
    if (!blocks.length) {
      rows.innerHTML = `<tr><td colspan="3"><div class="schedule-empty"><span>📅</span><strong>이 날짜에는 등록된 일정이 없습니다.</strong><small>위에서 시간을 선택해 첫 일정을 추가해 보세요.</small></div></td></tr>`;
      return;
    }
    rows.innerHTML = blocks.map((block) => {
      const repeat = block.source === "rule";
      const badge = repeat
        ? `<span class="schedule-repeat-badge" title="반복 요일: ${esc(repeatDayText(block.repeat_weekdays || []))}">반복</span>`
        : "";
      return `
      <tr class="schedule-row">
        <td><span class="schedule-time"><strong>${esc(block.start_time)}</strong><i></i><strong>${esc(block.end_time)}</strong></span>${badge}</td>
        <td><span class="schedule-note">${esc(block.note || "메모 없음")}</span></td>
        <td><button class="btn btn-ghost btn-small" type="button" data-delete="${esc(block.id)}"${repeat ? ' data-repeat="1"' : ""}>삭제</button></td>
      </tr>`;
    }).join("");
  }

  async function loadSettings(ctx) {
    const data = await api("/api/time-settings");
    const settings = data.settings || {};
    const timezone = settings.timezone || "Asia/Seoul";
    ref(ctx, "timezone").value = timezone;
    state.currentDate = localDateString(new Date(), timezone);
    ref(ctx, "blockDate").value = state.currentDate;
    if (ref(ctx, "workdayStart")) ref(ctx, "workdayStart").value = settings.workday_start || "09:00";
    if (ref(ctx, "workdayEnd")) ref(ctx, "workdayEnd").value = settings.workday_end || "18:00";
    setWeekdays(ctx, settings.weekdays);
    updateTimeSummary(ctx);
  }

  async function saveSettings(ctx) {
    status(ctx, "settingsStatus", "저장 중...");
    try {
      const payload = {
        timezone: ref(ctx, "timezone").value,
        workday_start: ref(ctx, "workdayStart")?.value || "09:00",
        workday_end: ref(ctx, "workdayEnd")?.value || "18:00",
        weekdays: selectedWeekdays(ctx),
      };
      await api("/api/time-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      status(ctx, "settingsStatus", "저장했습니다.");
    } catch (err) {
      status(ctx, "settingsStatus", err instanceof Error ? err.message : "저장 실패", true);
    }
  }

  async function loadBlocks(ctx) {
    state.currentDate = ref(ctx, "blockDate").value || state.currentDate;
    status(ctx, "blockStatus", "");
    try {
      const data = await api(`/api/time-blocks?date=${encodeURIComponent(state.currentDate)}`);
      renderBlocks(ctx, data.blocks || []);
    } catch (err) {
      status(ctx, "blockStatus", err instanceof Error ? err.message : "일정 조회 실패", true);
    }
  }

  async function addBlock(ctx) {
    status(ctx, "blockStatus", "추가 중...");
    try {
      const data = await api("/api/time-blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schedulePayload(ctx)),
      });
      if (ref(ctx, "blockNote")) ref(ctx, "blockNote").value = "";
      if (state.mode === "manual_range") {
        state.manualSaved = true;
        syncTimeSelectionUi(ctx);
      }
      // 반복 문구는 서버가 실제로 규칙을 만들었을 때만 보여준다.
      status(ctx, "blockStatus", data.rule
        ? `반복 일정을 등록했습니다. 반복 요일: ${repeatDayText(data.rule.weekdays || [])}`
        : "추가했습니다.");
      await loadBlocks(ctx);
    } catch (err) {
      status(ctx, "blockStatus", err instanceof Error ? err.message : "블록 추가 실패", true);
    }
  }

  async function deleteBlock(ctx, id, isRepeat) {
    let query = "";
    if (isRepeat) {
      const wholeRule = window.confirm(
        "반복 일정입니다.\n\n확인: 이 반복 일정을 모든 요일에서 삭제합니다.\n취소: 선택한 날짜만 건너뜁니다."
      );
      if (!wholeRule) query = `?date=${encodeURIComponent(state.currentDate)}`;
    }
    status(ctx, "blockStatus", "삭제 중...");
    try {
      const data = await api(`/api/time-blocks/${encodeURIComponent(id)}${query}`, { method: "DELETE" });
      status(ctx, "blockStatus", data.scope === "occurrence"
        ? "선택한 날짜만 반복에서 제외했습니다."
        : data.scope === "rule" ? "반복 일정을 삭제했습니다." : "삭제했습니다.");
      await loadBlocks(ctx);
    } catch (err) {
      status(ctx, "blockStatus", err instanceof Error ? err.message : "삭제 실패", true);
    }
  }

  window.sduiPages = window.sduiPages || {};
  window.sduiPages["time-settings"] = {
    state: () => state,
    actions: {
      SAVE_TIME_SETTINGS: saveSettings,
      LOAD_TIME_BLOCKS: loadBlocks,
      CREATE_TIME_BLOCK: addBlock,
      TOGGLE_REPEAT_BLOCK: toggleRepeatBlock,
      SET_QUICK_DURATION: setQuickDuration,
      TOGGLE_MANUAL_TIME: toggleManualTime,
      CONNECT_GOOGLE_CALENDAR: connectGoogleCalendar,
      CONNECT_KAKAO_NOTICE: connectKakaoNotice,
      CREATE_GOOGLE_CALENDAR_EVENT: createCalendarEvent,
      SEND_KAKAO_NOTICE: sendKakaoNotice,
      SCHEDULE_KAKAO_REMINDERS: scheduleKakaoReminders,
    },
    async init(ctx) {
      ref(ctx, "blockDate").value = state.currentDate;
      ref(ctx, "blockDate").addEventListener("change", () => {
        updateTimeSummary(ctx);
        void loadBlocks(ctx);
      });
      ref(ctx, "timezone")?.addEventListener("change", () => {
        state.currentDate = localDateString(new Date(), selectedTimezone(ctx));
        ref(ctx, "blockDate").value = state.currentDate;
        updateTimeSummary(ctx);
        void loadBlocks(ctx);
      });
      ["blockStart", "blockEnd"].forEach((id) => {
        ref(ctx, id)?.addEventListener("change", () => {
          const panel = ref(ctx, "manualTimePanel");
          if (panel) panel.hidden = false;
          state.manualSaved = false;
          setMode(ctx, "manual_range");
        });
      });
      ref(ctx, "blockRows").addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest("[data-delete]");
        if (button) void deleteBlock(ctx, button.dataset.delete, button.dataset.repeat === "1");
      });

      try {
        const me = await api("/api/me");
        state.me = me;
        if (!me.loggedIn) {
          ref(ctx, "guest").hidden = false;
          ref(ctx, "guestLogin").innerHTML = window.oauthLoginButtonsHtml ? window.oauthLoginButtonsHtml() : "";
          return;
        }
        ref(ctx, "member").hidden = false;
        ensureManualIntegrationActions(ctx);
        await loadSettings(ctx);
        await loadBlocks(ctx);
        await loadIntegrationState(ctx);
        showRedirectStatus(ctx);
        syncTimeSelectionUi(ctx);
        if (state.nowTimer) window.clearInterval(state.nowTimer);
        state.nowTimer = window.setInterval(() => updateTimeSummary(ctx), 1000);
      } catch {
        ref(ctx, "guest").hidden = false;
        ref(ctx, "guestLogin").innerHTML = window.oauthLoginButtonsHtml ? window.oauthLoginButtonsHtml() : "";
      }
    },
  };
})();
