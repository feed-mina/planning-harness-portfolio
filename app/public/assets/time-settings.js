(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const KIND_LABEL = { available: "가능", busy: "바쁨", focus: "집중", meeting: "회의" };
  let currentDate = new Date().toISOString().slice(0, 10);

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  async function api(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
    return data;
  }

  function status(id, text, danger = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("danger", danger);
  }

  function selectedWeekdays() {
    return Array.from(document.querySelectorAll("#weekdayRow input:checked")).map((input) => Number(input.value));
  }

  function setWeekdays(days) {
    const selected = new Set((Array.isArray(days) ? days : [1, 2, 3, 4, 5]).map(Number));
    document.querySelectorAll("#weekdayRow input").forEach((input) => {
      input.checked = selected.has(Number(input.value));
    });
  }

  async function loadSettings() {
    const data = await api("/api/time-settings");
    const settings = data.settings || {};
    $("timezone").value = settings.timezone || "Asia/Seoul";
    $("workdayStart").value = settings.workday_start || "09:00";
    $("workdayEnd").value = settings.workday_end || "18:00";
    setWeekdays(settings.weekdays);
  }

  async function saveSettings() {
    status("settingsStatus", "저장 중...");
    try {
      const payload = {
        timezone: $("timezone").value,
        workday_start: $("workdayStart").value,
        workday_end: $("workdayEnd").value,
        weekdays: selectedWeekdays(),
      };
      await api("/api/time-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      status("settingsStatus", "저장했습니다.");
    } catch (err) {
      status("settingsStatus", err.message, true);
    }
  }

  async function loadBlocks() {
    currentDate = $("blockDate").value || currentDate;
    status("blockStatus", "");
    try {
      const data = await api(`/api/time-blocks?date=${encodeURIComponent(currentDate)}`);
      renderBlocks(data.blocks || []);
    } catch (err) {
      status("blockStatus", err.message, true);
    }
  }

  function renderBlocks(blocks) {
    const rows = $("blockRows");
    if (!blocks.length) {
      rows.innerHTML = `<tr><td colspan="4" class="src">등록된 블록이 없습니다.</td></tr>`;
      return;
    }
    rows.innerHTML = blocks.map((block) => `
      <tr>
        <td><strong>${esc(block.start_time)}-${esc(block.end_time)}</strong></td>
        <td>${esc(KIND_LABEL[block.kind] || block.kind)}</td>
        <td>${esc(block.note || "")}</td>
        <td><button class="btn btn-ghost btn-small" type="button" data-delete="${esc(block.id)}">삭제</button></td>
      </tr>`).join("");
  }

  async function addBlock() {
    status("blockStatus", "추가 중...");
    try {
      await api("/api/time-blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: $("blockDate").value,
          start_time: $("blockStart").value,
          end_time: $("blockEnd").value,
          kind: $("blockKind").value,
          note: $("blockNote").value,
        }),
      });
      $("blockNote").value = "";
      status("blockStatus", "추가했습니다.");
      await loadBlocks();
    } catch (err) {
      status("blockStatus", err.message, true);
    }
  }

  async function deleteBlock(id) {
    status("blockStatus", "삭제 중...");
    try {
      await api(`/api/time-blocks/${encodeURIComponent(id)}`, { method: "DELETE" });
      status("blockStatus", "삭제했습니다.");
      await loadBlocks();
    } catch (err) {
      status("blockStatus", err.message, true);
    }
  }

  async function init() {
    $("blockDate").value = currentDate;
    $("btnSaveSettings").addEventListener("click", saveSettings);
    $("btnAddBlock").addEventListener("click", addBlock);
    $("btnReloadBlocks").addEventListener("click", loadBlocks);
    $("blockDate").addEventListener("change", loadBlocks);
    $("blockRows").addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("[data-delete]");
      if (button) deleteBlock(button.dataset.delete);
    });

    try {
      const me = await api("/api/me");
      if (!me.loggedIn) {
        $("guest").hidden = false;
        $("guestLogin").innerHTML = window.oauthLoginButtonsHtml ? window.oauthLoginButtonsHtml() : "";
        return;
      }
      $("member").hidden = false;
      await loadSettings();
      await loadBlocks();
    } catch (err) {
      $("guest").hidden = false;
      $("guestLogin").innerHTML = window.oauthLoginButtonsHtml ? window.oauthLoginButtonsHtml() : "";
    }
  }

  init();
})();
