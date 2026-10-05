// 마이페이지 — 설정 + 통합 히스토리 통계.
(() => {
  "use strict";
  function bootMypage() {
  const $ = (id) => document.getElementById(id);
  const DEFAULT_MODEL_CATALOG = {
    analysis: {
      gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
      claude: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
      openai: ["gpt-5", "gpt-5-mini"],
    },
    search: {
      gemini: ["gemini-2.5-pro"],
      claude: ["claude-sonnet-4-6"],
      openai: ["gpt-5"],
    },
  };
  const PROVIDERS = ["gemini", "claude", "openai"];
  const PROVIDER_LABEL = { gemini: "Gemini API", claude: "Claude (Anthropic)", openai: "codex (OpenAI)" };
  const PURPOSE_LABEL = { analysis: "분석용", search: "인터넷서치용" };

  let defaultPrompt = "";
  let modelCatalog = DEFAULT_MODEL_CATALOG;
  let stageDefs = [];
  let historyLoaded = false;
  let historyLoadError = "";
  let historyItems = [];
  let historyPage = 1;
  let evalLoaded = false;
  let evalData = { cases: [], aggregates: [], recent_runs: [], summary: {} };
  let orgLoaded = false;
  let orgs = [];
  let selectedOrgId = "";
  let currentOrgDetail = null;
  let activeScheduleFeedbackCard = null;
  let activeScheduleAssets = [];
  let canUseGitHubFeatures = false;
  let authProvider = null;
  let clovaLoaded = false;
  let clovaRecordings = [];
  let selectedClovaRecording = null;
  let kanbanLoaded = false;
  let kanbanLoadError = "";
  let kanbanBoards = [];
  let kanbanCards = [];
  let priorityMatrixPlacements = {};
  let scheduleBoardOpen = false;
  let scheduleBoardCounts = { next: 0, doing: 0, done: 0 };
  let scheduleBlocks = [];
  let scheduleServerNow = "";
  let scheduleTimezone = "Asia/Seoul";
  let scheduleView = "week";
  let scheduleCursor = "";
  let scheduleSelectedDate = "";
  let scheduleTab = "upcoming";
  let scheduleKind = "all";
  let scheduleProject = "all";
  let scheduleRepository = "all";
  let scheduleLoadedRange = "";
  let scheduleBlocksLoading = false;
  let scheduleSources = [];
  let scheduleGithubItems = [];
  let scheduleGithubLoaded = false;
  let scheduleGithubLoadError = "";
  let gitRepoOptions = [];
  let gitProjectOptions = [];
  let kanbanProject = "all";
  let kanbanRepositories = new Set();
  const historyDetails = new Map();
  const selectedHistory = new Set();
  const HISTORY_PAGE_SIZE = 5;
  const SCHEDULE_LIMIT = 18;
  const PRIORITY_MATRIX_STORAGE_KEY = "planning-harness.priority-matrix.v1";
  const GENERAL_DEMO_MODEL = "gemini-2.5-pro";
  const CONNECTED_APP_RESUME_PATH = "/api/auth/connected-app/authorize/resume";

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }
  const attr = (value) => esc(value).replace(/"/g, "&quot;");

  function connectedAppResumePath(value) {
    if (value !== CONNECTED_APP_RESUME_PATH) return null;
    return CONNECTED_APP_RESUME_PATH;
  }

  function requestedLoginContinuation() {
    return connectedAppResumePath(new URLSearchParams(location.search).get("next"));
  }

  function textBlob(content, type) {
    return new Blob(["\uFEFF", String(content ?? "")], { type });
  }

  function repairLatin1Mojibake(text) {
    const value = String(text ?? "");
    if (!/[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/.test(value)) return value;
    const bytes = [];
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code > 255) return value;
      bytes.push(code);
    }
    try {
      const decoded = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
      return looksMojibake(decoded) ? value : decoded;
    } catch {
      return value;
    }
  }

  function looksMojibake(text) {
    const sample = String(text ?? "").slice(0, 2000);
    if (sample.length < 4) return false;
    const replacement = (sample.match(/[�占]/g) || []).length;
    const latin1 = (sample.match(/[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/g) || []).length;
    const cp949Like = (sample.match(/[遺洹寃곗젙댁슜뚯씪씠덉뒪좊━꾩꽍ㅽ뙣몄쟻쒕떎쓬룄섏꽭]/g) || []).length;
    if (replacement >= 2 || latin1 >= 3) return true;
    return cp949Like >= 6 && cp949Like / sample.length > 0.08;
  }

  function displayText(value, fallback = "") {
    const repaired = repairLatin1Mojibake(value);
    return looksMojibake(repaired) ? fallback : repaired;
  }

  // 과거에 바이너리(xlsx/pdf 등)를 텍스트로 잘못 저장한 발췌가 그대로 노출되지 않도록 방어한다.
  // 제어문자·치환문자(�), CP949/Latin-1 mojibake가 높으면 사람이 읽을 수 없는 본문으로 보고 숨긴다.
  function readableExcerpt(text) {
    if (!text) return null;
    const value = repairLatin1Mojibake(text);
    if (looksMojibake(value)) return null;
    const sample = String(value).slice(0, 2000);
    if (!sample) return null;
    let bad = 0;
    for (const ch of sample) {
      const code = ch.codePointAt(0);
      if (ch === "�" || (code < 32 && code !== 9 && code !== 10 && code !== 13)) bad++;
    }
    if (bad / sample.length > 0.1) return null;
    return String(value);
  }

  function fmtFileSize(size) {
    const bytes = Number(size) || 0;
    if (!bytes) return "크기 정보 없음";
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function fileKindLabel(file) {
    const name = String(file?.name || "").toLowerCase();
    const type = String(file?.type || "").toLowerCase();
    if (/\.pdf$/.test(name) || type.includes("pdf")) return "PDF";
    if (/\.(xlsx|xls)$/.test(name) || /spreadsheet|excel/.test(type)) return "엑셀";
    if (/\.(docx|doc)$/.test(name) || /word/.test(type)) return "워드";
    if (/\.(pptx|ppt)$/.test(name) || /powerpoint|presentation/.test(type)) return "파워포인트";
    if (/\.csv$/.test(name) || type.includes("csv")) return "CSV";
    if (/\.txt$/.test(name) || type.startsWith("text/")) return "텍스트";
    return "첨부파일";
  }

  function fileUseLabel(file) {
    if (readableExcerpt(file?.text_excerpt)) return "분석에 반영";
    return "첨부됨";
  }

  function renderSimpleFileList(files, print = false) {
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return print ? "<p>등록된 분석파일 없음</p>" : '<p class="hint">등록된 분석파일이 없습니다.</p>';
    const cls = print ? "report-file-list" : "simple-file-list";
    return `<ul class="${cls}">${list.map((file) => `
      <li>
        <strong>${esc(displayText(file.name, "파일명 없음"))}</strong>
        <span>${fileKindLabel(file)} · ${fmtFileSize(file.size)} · ${fileUseLabel(file)}</span>
      </li>`).join("")}</ul>`;
  }

  function reEscape(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function replaceFileRefs(text, files) {
    let out = displayText(text);
    (Array.isArray(files) ? files : []).forEach((file) => {
      const id = file?.id;
      const name = displayText(file?.name, "분석파일");
      if (!id) return;
      const escaped = reEscape(id);
      const label = (chunk) => chunk ? `${name} · 청크 ${Number(chunk) + 1}` : name;
      out = out
        .replace(new RegExp(`\\(?\\bfile_id=${escaped}(?::(?:${escaped}:)?(\\d+))?\\)?`, "g"), (_match, chunk) => label(chunk))
        .replace(new RegExp(`\\(?\\bchunk_id=${escaped}:(\\d+)\\)?`, "g"), (_match, chunk) => label(chunk))
        .replace(new RegExp(`${escaped}:(?:${escaped}:)?(\\d+)`, "g"), (_match, chunk) => label(chunk));
    });
    return out;
  }

  function analysisHref(item) {
    // 통합 히스토리에서 재열기는 항상 분석설계 - (수정중) 화면으로 이동한다.
    return `/analysis-edit2/?session=${encodeURIComponent(item.id)}`;
  }

  function renderMarkdownPreview(md) {
    const lines = esc(md || "").split(/\r?\n/);
    let html = "", inList = false, cls = "";
    const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
    const openList = (c) => { if (!inList || cls !== c) { closeList(); html += `<ul${c ? ` class="${c}"` : ""}>`; inList = true; cls = c; } };
    for (const raw of lines) {
      const line = raw.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
      let m;
      if (/^#\s+/.test(line)) { closeList(); html += `<div class="mp-h1">${line.replace(/^#\s+/, "")}</div>`; }
      else if (/^##\s+/.test(line)) { closeList(); html += `<div class="mp-h2">${line.replace(/^##\s+/, "")}</div>`; }
      else if (/^###\s+/.test(line)) { closeList(); html += `<h4>${line.replace(/^###\s+/, "")}</h4>`; }
      else if ((m = line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/))) {
        openList("mp-tasks");
        html += `<li class="${m[1].toLowerCase() === "x" ? "done" : ""}"><input type="checkbox" disabled ${m[1].toLowerCase() === "x" ? "checked" : ""}><span>${m[2]}</span></li>`;
      } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
        openList("");
        html += `<li>${m[1]}</li>`;
      } else if (line.trim() === "") {
        closeList();
      } else {
        closeList();
        html += `<p>${line}</p>`;
      }
    }
    closeList();
    return html || '<p class="hint">본문 없음</p>';
  }

  function meetingMarkdownFromModal() {
    const editor = document.querySelector("[data-meeting-editor]");
    return editor ? editor.value : "";
  }

  function downloadMarkdownText(markdown, title, date) {
    const blob = textBlob(markdown, "text/markdown;charset=utf-8");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${date || new Date().toISOString().slice(0, 10)}_${title || "meeting"}.md`.replace(/[\\/:*?"<>|]+/g, "_");
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function printHtmlDocument(html, title) {
    const frame = document.createElement("iframe");
    frame.title = `${title || "보고서"} PDF`;
    frame.style.position = "fixed";
    frame.style.right = "100vw";
    frame.style.bottom = "100vh";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.border = "0";
    document.body.appendChild(frame);
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return;
      win.focus();
      win.print();
      setTimeout(() => frame.remove(), 1200);
    };
    frame.srcdoc = html;
  }

  function printMarkdownAsPdf(markdown, title) {
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${esc(title || "회의록")}</title>` +
      `<style>body{font-family:-apple-system,"Malgun Gothic",sans-serif;margin:32px;color:#202939;line-height:1.6}` +
      `h1,.mp-h1{font-size:26px;font-weight:800;border-bottom:2px solid #d8dee8;padding-bottom:8px}.mp-h2{font-size:19px;color:#172033;margin-top:22px}` +
      `h4{font-size:16px}li{margin:4px 0}code{background:#f9fafb;border:1px solid #d8dee8;padding:2px 5px;border-radius:4px}</style></head><body>` +
      `<h1>${esc(title || "회의록")}</h1>${renderMarkdownPreview(markdown)}</body></html>`;
    printHtmlDocument(html, `${title || "회의록"} PDF`);
  }

  function keyOf(item) {
    return `${item.kind}:${item.id}`;
  }

  function fmtDate(value) {
    return value ? String(value).slice(0, 10) : "-";
  }

  function uniqueTags(...groups) {
    const seen = new Set();
    const out = [];
    for (const group of groups) {
      for (const raw of group || []) {
        const tag = String(raw || "").trim();
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        out.push(tag);
      }
    }
    return out;
  }

  function normalizeHistoryTag(tag) {
    const value = displayText(tag).trim();
    return value === "회의" || value === "회의록연계" ? "회의록" : value;
  }

  function historyTagGroups(item) {
    const custom = new Set(item.custom_tags || []);
    const groups = new Map();
    for (const raw of item.tags || []) {
      const label = normalizeHistoryTag(raw);
      if (!label) continue;
      if (!groups.has(label)) groups.set(label, { label, customTags: [] });
      if (custom.has(raw)) groups.get(label).customTags.push(raw);
    }
    return [...groups.values()];
  }

  function historyTags(item) {
    return historyTagGroups(item).map((group) => group.label);
  }

  function historyTagChips(item, options = {}) {
    const limit = Number.isFinite(options.limit) ? options.limit : Infinity;
    return historyTagGroups(item).slice(0, limit).map((group) => {
      const removeTag = options.removable ? group.customTags[0] : "";
      const removeButton = removeTag
        ? ` <button type="button" data-action="remove-tag" data-tag="${attr(removeTag)}" aria-label="${attr(group.label)} 태그 제거">×</button>`
        : "";
      return `<span class="tag-chip">${esc(group.label)}${removeButton}</span>`;
    }).join("");
  }

  function modelsFor(provider, purpose) {
    const mode = purpose === "search" ? "search" : "analysis";
    return modelCatalog?.[mode]?.[provider] || modelCatalog?.analysis?.[provider] || DEFAULT_MODEL_CATALOG.analysis[provider] || [];
  }

  function fillModels(provider, selected, target, purpose) {
    const sel = target || $("model");
    const list = modelsFor(provider, purpose || "analysis");
    sel.innerHTML = list.map((m) => `<option value="${m}">${m}</option>`).join("");
    const fallback = provider === "gemini" ? GENERAL_DEMO_MODEL : list[0];
    if (selected) {
      if (!list.includes(selected)) sel.insertAdjacentHTML("afterbegin", `<option value="${selected}">${selected}</option>`);
      sel.value = selected;
    } else if (fallback) {
      if (!list.includes(fallback)) sel.insertAdjacentHTML("afterbegin", `<option value="${fallback}">${fallback}</option>`);
      sel.value = fallback;
    }
  }

  function renderStageSettings(stageModels) {
    const wrap = $("stageSettings");
    if (!wrap) return;
    if (!stageDefs.length) {
      wrap.innerHTML = '<p class="hint">단계별 모델 정보를 불러오지 못했습니다.</p>';
      return;
    }
    wrap.innerHTML = stageDefs.map((stage) => {
      const current = stageModels?.[stage.id] || {};
      const purpose = current.purpose || stage.default_purpose || "analysis";
      return `<div class="stage-row" data-stage-row data-stage-id="${esc(stage.id)}">
        <div class="stage-copy">
          <strong>${esc(stage.label)}</strong>
          <span>${esc(stage.description || "")}</span>
        </div>
        <label>용도
          <select data-stage-purpose>
            <option value="analysis" ${purpose !== "search" ? "selected" : ""}>${PURPOSE_LABEL.analysis}</option>
            <option value="search" ${purpose === "search" ? "selected" : ""}>${PURPOSE_LABEL.search}</option>
          </select>
        </label>
        <label>provider
          <select data-stage-provider>${PROVIDERS.map((provider) =>
            `<option value="${provider}" ${provider === (current.provider || stage.default_provider) ? "selected" : ""}>${PROVIDER_LABEL[provider]}</option>`
          ).join("")}</select>
        </label>
        <label>모델 <select data-stage-model></select></label>
      </div>`;
    }).join("");

    wrap.querySelectorAll("[data-stage-row]").forEach((row) => {
      const stage = stageDefs.find((item) => item.id === row.dataset.stageId);
      const current = stageModels?.[row.dataset.stageId] || {};
      const purposeSel = row.querySelector("[data-stage-purpose]");
      const providerSel = row.querySelector("[data-stage-provider]");
      const modelSel = row.querySelector("[data-stage-model]");
      const refresh = (selected) => fillModels(providerSel.value, selected, modelSel, purposeSel.value);
      refresh(current.model || stage?.default_model);
      purposeSel.addEventListener("change", () => refresh(modelSel.value));
      providerSel.addEventListener("change", () => refresh());
    });
  }

  function collectStageSettings() {
    const out = {};
    document.querySelectorAll("[data-stage-row]").forEach((row) => {
      const id = row.dataset.stageId;
      if (!id) return;
      out[id] = {
        purpose: row.querySelector("[data-stage-purpose]").value,
        provider: row.querySelector("[data-stage-provider]").value,
        model: row.querySelector("[data-stage-model]").value,
      };
    });
    return out;
  }

  window.apiFetch("/api/me").then((r) => r.json()).then((me) => {
    $(me.loggedIn ? "member" : "guest").hidden = false;
    if (!me.loggedIn) {
      initEmailAuth();
      return;
    }
    const continuation = requestedLoginContinuation();
    if (continuation) {
      location.replace(continuation);
      return;
    }
    authProvider = me.provider || null;
    canUseGitHubFeatures = authProvider === "github" && !!me.github_enabled;
    applyGitHubFeatureVisibility();
    applyAccountLinkState(me);
    bindAccountLinkEvents();
    renderAccountLinkStatus();
    $("login").textContent = "@" + (me.login || "me");
    initTabs();
    initHistoryControls();
    initScheduleControls();
    initKanbanControls();
    return window.apiFetch("/api/settings").then((r) => r.json()).then((s) => {
      defaultPrompt = s.default_prompt || "";
      modelCatalog = s.model_catalog || DEFAULT_MODEL_CATALOG;
      stageDefs = s.ai_stages || [];
      $("provider").value = s.provider || "gemini";
      fillModels($("provider").value, s.model);
      $("prompt").value = s.custom_prompt || defaultPrompt;
      $("provider").addEventListener("change", () => fillModels($("provider").value));
      renderStageSettings(s.stage_models || {});
      initSettingsAccordions();
      renderEvalModelChecks();
      $("btnResetPrompt").addEventListener("click", () => { $("prompt").value = defaultPrompt; });
      $("btnSaveSettings").addEventListener("click", save);
      if (canUseGitHubFeatures) initGit();
      initBudget();
      initAgentSubscriptions();
      initClovaRecordings();
      initOrgControls();
      initOrgInviteFromUrl();
      initProxyDevices();
    });
  }).catch(() => { $("guest").hidden = false; });

  function applyGitHubFeatureVisibility() {
    const gitPanel = $("gitDefaultsPanel");
    if (gitPanel) gitPanel.hidden = !canUseGitHubFeatures;
    const statsPanel = $("tabStats");
    if (!canUseGitHubFeatures) {
      $("scheduleModal")?.remove();
      $("scheduleModalBackdrop")?.remove();
    }
  }

  function initSettingsAccordions() {
    document.querySelectorAll(".settings-accordion").forEach((details) => {
      const label = details.querySelector(":scope > summary [data-accordion-label]");
      const sync = () => {
        if (label) label.textContent = details.open ? "접기" : "열기";
      };
      details.addEventListener("toggle", sync);
      sync();
    });
  }

  function initEmailAuth() {
    $("btnEmailLogin")?.addEventListener("click", () => submitEmailAuth("login"));
    $("btnEmailRegister")?.addEventListener("click", () => submitEmailAuth("register"));
    $("btnEmailResetRequest")?.addEventListener("click", requestEmailPasswordReset);
    $("btnEmailResetConfirm")?.addEventListener("click", confirmEmailPasswordReset);
    $("btnGuestClaimDeviceCode")?.addEventListener("click", () => claimDeviceCode("guestDeviceCode", "guestDeviceName", "guestDeviceStatus", "guestProxySetupGuide"));
    const params = new URLSearchParams(location.search);
    const verifyToken = params.get("verify_email");
    const resetToken = params.get("reset_token");
    if (verifyToken) verifyEmailToken(verifyToken);
    if (resetToken && $("emailResetPanel")) $("emailResetPanel").hidden = false;
    const code = params.get("device_code");
    if (code && $("guestDeviceCode")) $("guestDeviceCode").value = code;
  }

  async function submitEmailAuth(mode) {
    const status = $("emailAuthStatus");
    const email = $("emailAuthEmail").value.trim();
    const password = $("emailAuthPassword").value;
    const displayName = $("emailAuthName").value.trim();
    status.textContent = mode === "register" ? "가입 중..." : "로그인 중...";
    status.classList.remove("danger");
    try {
      const res = await window.apiFetch(`/api/auth/email/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, display_name: displayName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.verification_required) {
        status.textContent = "인증 메일을 보냈습니다. 1시간 안에 링크를 확인해 주세요.";
        return;
      }
      status.textContent = "로그인되었습니다. 이동 중...";
      location.href = connectedAppResumePath(data.next)
        || "/mypage/?analytics_auth=login&analytics_method=email";
    } catch (err) {
      status.textContent = "실패: " + err.message;
      status.classList.add("danger");
    }
  }

  async function verifyEmailToken(token) {
    const status = $("emailAuthStatus");
    if (status) {
      status.textContent = "이메일 인증 중...";
      status.classList.remove("danger");
    }
    try {
      const res = await window.apiFetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (status) status.textContent = "인증되었습니다. 이동 중...";
      history.replaceState(null, "", "/mypage/");
      location.href = connectedAppResumePath(data.next)
        || "/mypage/?analytics_auth=sign_up&analytics_method=email";
    } catch (err) {
      if (status) {
        status.textContent = "인증 실패: " + err.message;
        status.classList.add("danger");
      }
    }
  }

  async function requestEmailPasswordReset() {
    const status = $("emailAuthStatus");
    const email = $("emailAuthEmail")?.value.trim();
    if (!email) {
      status.textContent = "재설정 메일을 받을 이메일을 입력해 주세요.";
      status.classList.add("danger");
      return;
    }
    status.textContent = "재설정 메일 전송 중...";
    status.classList.remove("danger");
    try {
      const res = await window.apiFetch("/api/auth/email/reset/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      status.textContent = "계정이 있으면 비밀번호 재설정 메일을 보냈습니다. 링크는 7일 동안 유효합니다.";
    } catch (err) {
      status.textContent = "재설정 요청 실패: " + err.message;
      status.classList.add("danger");
    }
  }

  async function confirmEmailPasswordReset() {
    const status = $("emailResetStatus");
    const token = new URLSearchParams(location.search).get("reset_token");
    const password = $("emailResetPassword")?.value || "";
    status.textContent = "비밀번호 변경 중...";
    status.classList.remove("danger");
    try {
      const res = await window.apiFetch("/api/auth/email/reset/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      status.textContent = "비밀번호가 변경되었습니다. 이동 중...";
      history.replaceState(null, "", "/mypage/");
      location.href = connectedAppResumePath(data.next) || "/mypage/";
    } catch (err) {
      status.textContent = "변경 실패: " + err.message;
      status.classList.add("danger");
    }
  }

  function initClovaRecordings() {
    if (!$("clovaRecordingsPanel")) return;
    $("btnReloadClovaRecordings")?.addEventListener("click", () => loadClovaRecordings(true));
    $("btnImportClovaRecording")?.addEventListener("click", importClovaRecording);
    $("btnUseClovaRecording")?.addEventListener("click", useSelectedClovaRecording);
    $("clovaRecordingList")?.addEventListener("click", onClovaRecordingClick);
    if ($("clovaRecordingDate") && !$("clovaRecordingDate").value) {
      $("clovaRecordingDate").value = new Date().toISOString().slice(0, 10);
    }
    loadClovaRecordings(false);
  }

  function clovaStatus(message, isError) {
    const status = $("clovaRecordingStatus");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("danger", !!isError);
  }

  function clovaDateText(recording) {
    return [recording.recorded_at ? String(recording.recorded_at).slice(0, 10) : "", recording.duration_sec ? `${Math.round(recording.duration_sec / 60)}분` : ""]
      .filter(Boolean)
      .join(" · ") || "날짜 없음";
  }

  function clovaStatusLabel(recording) {
    if (recording.transcript_status === "ready" && recording.transcript_text) return "텍스트 준비";
    if (recording.transcript_status === "failed") return "변환 실패";
    if (recording.transcript_status === "transcribing") return "변환 중";
    return "텍스트 필요";
  }

  function renderClovaRecordings() {
    const list = $("clovaRecordingList");
    if (!list) return;
    if (!clovaRecordings.length) {
      list.innerHTML = '<p class="hint">불러온 클로바 녹음이 없습니다. 텍스트 파일이나 오디오 파일을 선택해 가져오세요.</p>';
      return;
    }
    list.innerHTML = clovaRecordings.map((recording) => {
      const ready = recording.transcript_status === "ready" && recording.transcript_text;
      const preview = recording.transcript_preview || recording.transcript_text || "";
      return `<article class="clova-recording-item">
        <div>
          <button class="clova-recording-title" type="button" data-clova-select="${attr(recording.id)}">${esc(recording.title || "Clova recording")}</button>
          <div class="clova-recording-meta">${esc(clovaDateText(recording))}</div>
          ${preview ? `<p class="clova-recording-preview">${esc(preview)}${preview.length >= 240 ? "..." : ""}</p>` : '<p class="clova-recording-preview">아직 변환된 텍스트가 없습니다.</p>'}
        </div>
        <span class="clova-recording-badge ${ready ? "" : "needs"}">${esc(clovaStatusLabel(recording))}</span>
      </article>`;
    }).join("");
  }

  async function loadClovaRecordings(force) {
    if (clovaLoaded && !force) return;
    clovaStatus("클로바 녹음 목록을 불러오는 중...");
    try {
      const res = await window.apiFetch("/api/me/clova/recordings?limit=30");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      clovaLoaded = true;
      clovaRecordings = data.recordings || [];
      renderClovaRecordings();
      clovaStatus(clovaRecordings.length ? `녹음 ${clovaRecordings.length}개를 불러왔습니다.` : "불러온 녹음이 없습니다.");
    } catch (err) {
      clovaStatus("클로바 녹음 목록 로드 실패: " + err.message, true);
    }
  }

  function isTextRecordingFile(file) {
    return !!file && (/(\.txt|\.md|\.srt|\.vtt)$/i.test(file.name || "") || String(file.type || "").startsWith("text/"));
  }

  async function importClovaRecording() {
    const file = $("clovaRecordingFile")?.files?.[0] || null;
    const title = $("clovaRecordingTitle")?.value.trim() || file?.name || "Clova recording";
    const recordedAt = $("clovaRecordingDate")?.value || null;
    let transcript = $("clovaRecordingTranscript")?.value.trim() || "";
    const btn = $("btnImportClovaRecording");
    if (!file && !transcript) {
      clovaStatus("가져올 녹음 파일 또는 텍스트를 입력하세요.", true);
      return;
    }

    if (btn) btn.disabled = true;
    clovaStatus(file && !isTextRecordingFile(file) && !transcript ? "Clova Speech로 녹음 텍스트를 변환하는 중..." : "녹음 내역을 저장하는 중...");
    try {
      let res;
      if (file && !isTextRecordingFile(file) && !transcript) {
        const form = new FormData();
        form.append("media", file, file.name || "audio");
        form.append("title", title);
        if (recordedAt) form.append("recorded_at", recordedAt);
        res = await window.apiFetch("/api/me/clova/recordings/import", { method: "POST", body: form });
      } else {
        if (file && isTextRecordingFile(file) && !transcript) transcript = (await file.text()).trim();
        res = await window.apiFetch("/api/me/clova/recordings/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, recorded_at: recordedAt, transcript_text: transcript }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      clovaLoaded = false;
      await loadClovaRecordings(true);
      if (data.recording) selectClovaRecording(data.recording);
      clovaStatus("클로바 녹음 내역을 가져왔습니다.");
    } catch (err) {
      clovaStatus("녹음 가져오기 실패: " + err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function selectClovaRecording(recording) {
    selectedClovaRecording = recording || null;
    if ($("clovaRecordingTitle") && recording?.title) $("clovaRecordingTitle").value = recording.title;
    if ($("clovaRecordingDate") && recording?.recorded_at) $("clovaRecordingDate").value = String(recording.recorded_at).slice(0, 10);
    if ($("clovaRecordingTranscript")) $("clovaRecordingTranscript").value = recording?.transcript_text || "";
    if ($("btnUseClovaRecording")) $("btnUseClovaRecording").disabled = !(recording?.id && recording?.transcript_text);
    clovaStatus(recording?.transcript_text ? `"${recording.title}" 텍스트를 반영했습니다.` : "선택한 녹음에 변환된 텍스트가 없습니다.", !recording?.transcript_text);
  }

  async function onClovaRecordingClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const btn = target?.closest("[data-clova-select]");
    if (!btn) return;
    const id = btn.dataset.clovaSelect;
    const cached = clovaRecordings.find((recording) => recording.id === id);
    if (cached?.transcript_text) {
      selectClovaRecording(cached);
      return;
    }
    clovaStatus("녹음 텍스트를 불러오는 중...");
    try {
      const res = await window.apiFetch(`/api/me/clova/recordings/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      selectClovaRecording(data.recording);
    } catch (err) {
      clovaStatus("녹음 텍스트 불러오기 실패: " + err.message, true);
    }
  }

  async function useSelectedClovaRecording() {
    const recording = selectedClovaRecording;
    if (!recording?.id) {
      clovaStatus("먼저 녹음 제목을 선택하세요.", true);
      return;
    }
    const transcriptText = $("clovaRecordingTranscript")?.value.trim() || recording.transcript_text || "";
    if (!transcriptText) {
      clovaStatus("회의록 생성으로 보낼 녹음 텍스트가 없습니다.", true);
      return;
    }
    const btn = $("btnUseClovaRecording");
    if (btn) btn.disabled = true;
    clovaStatus("회의록 생성 입력으로 연결하는 중...");
    try {
      const res = await window.apiFetch("/api/meetings/from-recording", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recording_id: recording.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const payload = {
        recording_id: recording.id,
        title: data.subject || recording.title,
        date: data.date || (recording.recorded_at ? String(recording.recorded_at).slice(0, 10) : ""),
        transcript: transcriptText,
      };
      sessionStorage.setItem("analysisEdit2.prefillTranscript", JSON.stringify(payload));
      location.href = `/analysis-edit2/?source=clova_recording&recording=${encodeURIComponent(recording.id)}`;
    } catch (err) {
      clovaStatus("회의록 생성 연결 실패: " + err.message, true);
      if (btn) btn.disabled = false;
    }
  }

  function initProxyDevices() {
    $("btnReloadProxyDevices")?.addEventListener("click", loadProxyDevices);
    $("btnCreateProxyDevice")?.addEventListener("click", createProxyDevice);
    $("btnCreateDeviceCode")?.addEventListener("click", createDeviceCode);
    $("btnClaimDeviceCode")?.addEventListener("click", () => claimDeviceCode("proxyDeviceCode", "proxyDeviceName", "proxyDeviceStatus", "proxySetupGuide", true));
    $("proxyDeviceRows")?.addEventListener("click", onProxyDeviceClick);
    const code = new URLSearchParams(location.search).get("device_code");
    if (code && $("proxyDeviceCode")) $("proxyDeviceCode").value = code;
    loadProxyDevices();
  }

  function renderProxySetupGuide(data, targetId) {
    const setup = data.setup || {};
    const box = $(targetId);
    if (!box) return;
    const lines = [
      "프록시 키는 지금 한 번만 표시됩니다.",
      "",
      `PROXY_KEY=${data.proxy_key || setup.key || ""}`,
      "",
      "PowerShell 설정:",
      ...(setup.shell || []),
      "",
      "Claude Code CLI:",
      `ANTHROPIC_BASE_URL=${setup.anthropic?.ANTHROPIC_BASE_URL || ""}`,
      "ANTHROPIC_API_KEY=<위 PROXY_KEY>",
      "",
      "OpenAI 호환 클라이언트:",
      `OPENAI_BASE_URL=${setup.openai?.OPENAI_BASE_URL || ""}`,
      "OPENAI_API_KEY=<위 PROXY_KEY>",
      "",
      "Gemini API:",
      `GEMINI_BASE_URL=${setup.gemini?.GEMINI_BASE_URL || ""}`,
      "GEMINI_API_KEY=<위 PROXY_KEY>",
    ];
    box.textContent = lines.join("\n");
    box.style.display = "block";
  }

  async function loadProxyDevices() {
    const status = $("proxyDeviceStatus");
    if (status) {
      status.textContent = "기기 목록을 불러오는 중...";
      status.classList.remove("danger");
    }
    try {
      const res = await window.apiFetch("/api/proxy/devices");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      renderProxyDevices(data.devices || []);
      if (status) status.textContent = "";
    } catch (err) {
      if (status) {
        status.textContent = "기기 목록 실패: " + err.message;
        status.classList.add("danger");
      }
    }
  }

  function renderProxyDevices(devices) {
    const body = $("proxyDeviceRows");
    if (!body) return;
    body.innerHTML = devices.map((device) => `<tr>
      <td>${esc(device.name || device.device_id)}</td>
      <td><code>${esc(device.key_prefix || "-")}</code></td>
      <td>${esc(device.status)}</td>
      <td>${device.last_used_at ? esc(fmtDate(device.last_used_at)) : "-"}</td>
      <td>${device.status === "active" ? `<button class="btn btn-ghost btn-small" type="button" data-proxy-revoke="${attr(device.id)}">폐기</button>` : "-"}</td>
    </tr>`).join("") || `<tr><td colspan="5">등록된 프록시 기기가 없습니다.</td></tr>`;
  }

  async function createProxyDevice() {
    const status = $("proxyDeviceStatus");
    status.textContent = "키 발급 중...";
    status.classList.remove("danger");
    try {
      const res = await window.apiFetch("/api/proxy/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: $("proxyDeviceName").value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      status.textContent = "프록시 키를 발급했습니다.";
      renderProxySetupGuide(data, "proxySetupGuide");
      await loadProxyDevices();
    } catch (err) {
      status.textContent = "키 발급 실패: " + err.message;
      status.classList.add("danger");
    }
  }

  async function createDeviceCode() {
    const status = $("proxyDeviceStatus");
    status.textContent = "등록 코드 생성 중...";
    status.classList.remove("danger");
    try {
      const res = await window.apiFetch("/api/proxy/device-codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: $("proxyDeviceName").value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      status.textContent = `등록 코드 ${data.code} · ${data.expires_at.slice(11, 16)}까지 유효합니다. 다른 컴퓨터에서 코드를 입력해 등록하세요.`;
    } catch (err) {
      status.textContent = "등록 코드 실패: " + err.message;
      status.classList.add("danger");
    }
  }

  async function claimDeviceCode(codeId, nameId, statusId, guideId, reload = false) {
    const status = $(statusId);
    const code = $(codeId).value.trim().toUpperCase();
    status.textContent = "등록 중...";
    status.classList.remove("danger");
    try {
      const res = await window.apiFetch(`/api/proxy/device-codes/${encodeURIComponent(code)}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: $(nameId).value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      status.textContent = "프록시 키를 발급했습니다.";
      renderProxySetupGuide(data, guideId);
      if (reload) await loadProxyDevices();
    } catch (err) {
      status.textContent = "등록 실패: " + err.message;
      status.classList.add("danger");
    }
  }

  async function onProxyDeviceClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const btn = target?.closest("[data-proxy-revoke]");
    if (!btn) return;
    btn.disabled = true;
    const status = $("proxyDeviceStatus");
    try {
      const res = await window.apiFetch(`/api/proxy/devices/${encodeURIComponent(btn.dataset.proxyRevoke)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "폐기할 키를 찾을 수 없습니다.");
      status.textContent = "프록시 키를 폐기했습니다.";
      await loadProxyDevices();
    } catch (err) {
      status.textContent = "폐기 실패: " + err.message;
      status.classList.add("danger");
      btn.disabled = false;
    }
  }

  function initTabs() {
    document.querySelectorAll("[data-mypage-tab]").forEach((btn) => {
      btn.addEventListener("click", () => setTab(btn.dataset.mypageTab, true));
    });
    const requested = new URLSearchParams(location.search).get("tab");
    const initial = requested === "stats" || requested === "schedule" || requested === "org" || requested === "kanban" ? requested : "settings";
    setTab(initial, false);
  }

  function setTab(tab, push) {
    let next = tab === "stats" || tab === "schedule" || tab === "org" || tab === "kanban" ? tab : "settings";
    document.querySelectorAll("[data-mypage-tab]").forEach((btn) => {
      const active = btn.dataset.mypageTab === next;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    $("tabSettings").hidden = next !== "settings";
    if ($("tabOrg")) $("tabOrg").hidden = next !== "org";
    $("tabStats").hidden = next !== "stats";
    if ($("tabSchedule")) $("tabSchedule").hidden = next !== "schedule";
    if ($("tabKanban")) $("tabKanban").hidden = next !== "kanban";
    if (push) history.replaceState(null, "", next === "settings" ? "/mypage/" : `/mypage/?tab=${next}`);
    if (next === "org" && !orgLoaded) loadOrganizations();
    if (next === "stats") {
      if (!historyLoaded) loadHistory();
      if (!evalLoaded) loadEvalDashboard();
    }
    if (next === "schedule") {
      loadScheduleData(false);
    }
    if (next === "kanban") {
      loadPriorityMatrix(false);
    }
  }

  function initKanbanControls() {
    priorityMatrixPlacements = readPriorityMatrixPlacements();
    $("btnReloadKanban")?.addEventListener("click", () => loadPriorityMatrix(true));
    $("kanbanProject")?.addEventListener("change", (event) => {
      kanbanProject = event.target.value || "all";
      renderKanbanMatrix();
    });
    $("kanbanRepositoryOptions")?.addEventListener("click", (event) => {
      const option = event.target instanceof Element ? event.target.closest("[data-kanban-repository-option]") : null;
      if (!option) return;
      const repo = option.dataset.kanbanRepositoryOption || "";
      if (!repo) return;
      if (kanbanRepositories.has(repo)) kanbanRepositories.delete(repo);
      else kanbanRepositories.add(repo);
      kanbanMatrixSelectedCardId = null;
      renderKanbanMatrix();
    });
    $("kanbanRepositoryChips")?.addEventListener("click", (event) => {
      const chip = event.target instanceof Element ? event.target.closest("[data-kanban-repository-remove]") : null;
      if (!chip) return;
      kanbanRepositories.delete(chip.dataset.kanbanRepositoryRemove || "");
      kanbanMatrixSelectedCardId = null;
      renderKanbanMatrix();
    });
    $("btnClearKanbanRepositories")?.addEventListener("click", () => {
      if (!kanbanRepositories.size) return;
      kanbanRepositories.clear();
      kanbanMatrixSelectedCardId = null;
      renderKanbanMatrix();
    });
    [$("scheduleMatrix"), $("scheduleMatrixExtras")].filter(Boolean).forEach((container) => {
      container.addEventListener("dragstart", onKanbanMatrixDragStart);
      container.addEventListener("dragend", onKanbanMatrixDragEnd);
      container.addEventListener("dragover", onKanbanMatrixDragOver);
      container.addEventListener("dragleave", onKanbanMatrixDragLeave);
      container.addEventListener("drop", onKanbanMatrixDrop);
      container.addEventListener("click", onKanbanMatrixClick);
    });
    // toggle 이벤트는 버블링되지 않으므로 캡처 단계에서 받아 접힘 상태를 저장한다.
    $("scheduleMatrixExtras")?.addEventListener("toggle", (event) => {
      const fold = event.target instanceof HTMLElement ? event.target : null;
      const key = fold?.dataset.kanbanExtraFold;
      if (!key || !(key in kanbanExtrasOpen)) return;
      kanbanExtrasOpen[key] = !!fold.open;
      persistKanbanExtrasFold();
    }, true);
    $("kanbanBoard")?.addEventListener("click", onKanbanClick);
    $("kanbanBoard")?.addEventListener("change", onKanbanChange);
  }

  async function loadPriorityMatrix(force) {
    const status = $("kanbanPriorityStatus");
    if (status) {
      status.textContent = force ? "업무 카드를 새로고침하는 중..." : "업무 카드를 불러오는 중...";
      status.classList.remove("danger");
    }
    await Promise.all([
      !historyLoaded || force ? loadHistory(force) : Promise.resolve(),
      !kanbanLoaded || force ? loadKanban(force) : Promise.resolve(),
      !scheduleGithubLoaded || force ? loadScheduleGithubItems(force) : Promise.resolve(),
    ]);
    renderKanbanMatrix();
  }

  async function loadKanban(force) {
    if (kanbanLoaded && !force) return;
    kanbanLoadError = "";
    const status = $("kanbanPriorityStatus");
    if (status) {
      status.textContent = "칸반 데이터를 불러오는 중...";
      status.classList.remove("danger");
    }
    try {
      const [boardsRes, cardsRes] = await Promise.all([
        window.apiFetch("/api/kanban/boards?limit=50"),
        window.apiFetch("/api/kanban/cards"),
      ]);
      const boardsData = await boardsRes.json();
      const cardsData = await cardsRes.json();
      if (!boardsRes.ok) throw new Error(boardsData.error || `HTTP ${boardsRes.status}`);
      if (!cardsRes.ok) throw new Error(cardsData.error || `HTTP ${cardsRes.status}`);
      kanbanBoards = boardsData.boards || [];
      kanbanCards = cardsData.cards || [];
      kanbanLoaded = true;
      renderKanbanMatrix();
      renderKanban();
    } catch (err) {
      kanbanLoadError = err.message;
      if (status) {
        status.textContent = "칸반 데이터 불러오기 실패: " + err.message;
        status.classList.add("danger");
      }
    }
  }

  function kanbanStatusLabel(status) {
    if (status === "doing") return "Doing";
    if (status === "done") return "Done";
    return "To do";
  }

  function kanbanPriorityLabel(priority) {
    if (priority === "high") return "높음";
    if (priority === "low") return "낮음";
    return "보통";
  }

  function renderKanbanBoardList() {
    const list = $("kanbanBoardList");
    if (!list) return;
    list.innerHTML = kanbanBoards.slice(0, 8).map((board) => `
      <article class="post-list-item">
        <strong>${esc(displayText(board.title, "회의록 칸반"))}</strong>
        <span>${Number(board.card_count || 0)}개 카드 · ${esc(String(board.updated_at || "").slice(0, 10))}</span>
      </article>
    `).join("");
  }

  function kanbanCard(card) {
    return `<article class="schedule-week-card is-${esc(card.status)}">
      <span class="schedule-state ${esc(card.status)}">${kanbanStatusLabel(card.status)}</span>
      <h4>${esc(displayText(card.title, "할 일"))}</h4>
      <p>${esc(displayText(card.description || card.source_raw, ""))}</p>
      <div class="schedule-card-meta">
        <span>${esc(displayText(card.board_title, "회의록 칸반"))}</span>
        ${card.assignee ? `<span>@${esc(card.assignee)}</span>` : ""}
        ${card.due_date ? `<span>${esc(card.due_date)}</span>` : ""}
        <span>${kanbanPriorityLabel(card.priority)}</span>
      </div>
      <label class="compact-label">상태
        <select data-kanban-card="${attr(card.id)}">
          <option value="todo" ${card.status === "todo" ? "selected" : ""}>To do</option>
          <option value="doing" ${card.status === "doing" ? "selected" : ""}>Doing</option>
          <option value="done" ${card.status === "done" ? "selected" : ""}>Done</option>
        </select>
      </label>
      <div class="kanban-github-link">
        <label>GitHub 저장소
          <input type="text" data-kanban-repo="${attr(card.id)}" value="${attr(card.github_repo || "")}" placeholder="owner/repo" />
        </label>
        <label>이슈 번호
          <input type="number" data-kanban-issue="${attr(card.id)}" value="${card.github_issue_number || ""}" min="1" placeholder="123" />
        </label>
        <button class="btn btn-ghost btn-small" type="button" data-kanban-link-save="${attr(card.id)}">연결 저장</button>
        ${card.github_issue_url ? `<a href="${attr(card.github_issue_url)}" target="_blank" rel="noopener">이슈 열기</a>` : ""}
      </div>
      <button class="btn btn-danger btn-small" type="button" data-kanban-delete="${attr(card.id)}">카드 삭제</button>
    </article>`;
  }

  function renderKanban() {
    const status = $("kanbanStatus");
    const board = $("kanbanBoard");
    if (!board) return;
    renderKanbanBoardList();
    if (status) {
      status.classList.remove("danger");
      status.textContent = `${kanbanCards.length}개 카드 · ${kanbanBoards.length}개 보드`;
    }
    if (!kanbanCards.length) {
      board.innerHTML = `<p class="hint">회의록 생성 화면에서 액션 아이템을 칸반 카드로 변환하면 여기에 표시됩니다.</p>`;
      return;
    }
    const lanes = [
      ["todo", "To do", "검토하거나 시작할 카드"],
      ["doing", "Doing", "진행 중인 카드"],
      ["done", "Done", "완료된 카드"],
    ];
    board.innerHTML = lanes.map(([key, title, help]) => {
      const cards = kanbanCards.filter((card) => card.status === key).map(kanbanCard).join("");
      return `<section class="schedule-lane ${key}">
        <div class="schedule-lane-head"><h4>${title}</h4><span>${kanbanCards.filter((card) => card.status === key).length}</span></div>
        <p class="hint">${help}</p>
        <div class="schedule-lane-list">${cards || `<p class="hint">카드가 없습니다.</p>`}</div>
      </section>`;
    }).join("");
  }

  const KANBAN_MATRIX_LABELS = {
    q1: ["즉시 처리", "중요 · 긴급", "high", "high"],
    q2: ["전략적 계획", "중요 · 여유", "high", "low"],
    q3: ["축소·위임", "덜중요 · 긴급", "low", "high"],
    q4: ["취소·연기", "덜중요 · 여유", "low", "low"],
  };

  const PRIORITY_MATRIX_DESTINATIONS = new Set(["q1", "q2", "q3", "q4", "done", "unclassified"]);

  function readPriorityMatrixPlacements() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PRIORITY_MATRIX_STORAGE_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([, destination]) => PRIORITY_MATRIX_DESTINATIONS.has(destination)));
    } catch {
      return {};
    }
  }

  function persistPriorityMatrixPlacements() {
    try {
      localStorage.setItem(PRIORITY_MATRIX_STORAGE_KEY, JSON.stringify(priorityMatrixPlacements));
      return true;
    } catch {
      return false;
    }
  }

  // 완료·미분류 카드가 쌓이면 세로가 길어진다 — 접힘 상태를 브라우저에 저장해 유지한다.
  const KANBAN_EXTRAS_FOLD_KEY = "planning-harness.kanban-extras-fold.v1";

  function readKanbanExtrasFold() {
    const fallback = { done: false, unclassified: true };
    try {
      const parsed = JSON.parse(localStorage.getItem(KANBAN_EXTRAS_FOLD_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
      return {
        done: typeof parsed.done === "boolean" ? parsed.done : fallback.done,
        unclassified: typeof parsed.unclassified === "boolean" ? parsed.unclassified : fallback.unclassified,
      };
    } catch {
      return fallback;
    }
  }

  const kanbanExtrasOpen = readKanbanExtrasFold();

  function persistKanbanExtrasFold() {
    try {
      localStorage.setItem(KANBAN_EXTRAS_FOLD_KEY, JSON.stringify(kanbanExtrasOpen));
    } catch {
      /* 브라우저 저장소를 못 쓰면 접힘 상태는 세션 동안만 유지된다. */
    }
  }

  function setLocalMatrixPlacement(key, destination) {
    priorityMatrixPlacements[key] = destination;
    return persistPriorityMatrixPlacements();
  }

  function clearLocalMatrixPlacement(key) {
    if (!Object.prototype.hasOwnProperty.call(priorityMatrixPlacements, key)) return;
    delete priorityMatrixPlacements[key];
    persistPriorityMatrixPlacements();
  }

  function setPriorityMatrixStatus(message, danger = false) {
    const status = $("kanbanPriorityStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("danger", danger);
  }

  function matrixKey(card) {
    if (card.importance === "none" || card.urgency === "none") return "unclassified";
    const importance = card.importance === "high" ? "high" : "low";
    const urgency = card.urgency === "high" ? "high" : "low";
    return Object.entries(KANBAN_MATRIX_LABELS).find(([, values]) => values[2] === importance && values[3] === urgency)?.[0] || "q4";
  }

  function priorityMatrixEntries(historyMetas = historyLoaded ? scheduleItems() : []) {
    const cardEntries = kanbanCards.map((card) => {
      const key = `kanban:${card.id}`;
      const linked = !!(card.github_repo && card.github_issue_number);
      const fallback = card.status === "done" ? "done" : matrixKey(card);
      const destination = linked ? fallback : priorityMatrixPlacements[key] || fallback;
      return {
        key,
        kind: "kanban",
        title: displayText(card.title, "업무"),
        detail: linked ? `${card.github_repo}#${card.github_issue_number}` : displayText(card.board_title, "보드 과업"),
        badge: linked ? `#${card.github_issue_number}` : "브라우저 저장",
        destination: PRIORITY_MATRIX_DESTINATIONS.has(destination) ? destination : fallback,
        linked,
        card,
      };
    });
    const historyEntries = historyMetas.map((meta) => {
      const item = meta.item;
      const key = `history:${item.kind}:${item.id}`;
      const destination = priorityMatrixPlacements[key] || meta.quadrant;
      return {
        key,
        kind: "history",
        title: displayText(item.title, "업무"),
        detail: scheduleDetail(item),
        badge: `${scheduleKindLabel(item)} · 브라우저`,
        destination: PRIORITY_MATRIX_DESTINATIONS.has(destination) ? destination : meta.quadrant,
        linked: false,
        meta,
      };
    });
    const githubEntries = scheduleGithubItems
      .filter((item) => kanbanProject === "all" || item.project_id === kanbanProject)
      .filter((item) => !kanbanRepositories.size || kanbanRepositories.has(item.repo))
      .map((item) => {
        const labels = new Set(item.labels || []);
        const importance = labels.has("importance:high") ? "high" : labels.has("importance:low") ? "low" : "none";
        const urgency = labels.has("urgency:high") ? "high" : labels.has("urgency:low") ? "low" : "none";
        const closed = item.state === "closed" || item.state === "merged";
        const destination = closed
          ? "done"
          : importance === "none" || urgency === "none"
            ? "unclassified"
            : Object.entries(KANBAN_MATRIX_LABELS).find(([, values]) => values[2] === importance && values[3] === urgency)?.[0] || "unclassified";
        return {
          key: `github:${item.project_id}:${item.repo}:${item.number}`,
          kind: "github",
          title: displayText(item.title, "GitHub 업무"),
          detail: `${item.project_title} · ${item.repo}#${item.number}`,
          badge: `${item.project_title} · #${item.number}`,
          destination,
          linked: true,
          editable: item.kind === "issue",
          item,
          importance,
          urgency,
        };
      });
    return [...githubEntries, ...cardEntries, ...historyEntries];
  }

  function renderKanbanProjectFilter() {
    const select = $("kanbanProject");
    if (!select) return;
    const projects = Array.from(new Map(
      scheduleSources.map((source) => [source.project_id, source.project_title])
    ));
    select.innerHTML = '<option value="all">전체 Project</option>' +
      projects.map(([id, title]) => `<option value="${attr(id)}">${esc(title)}</option>`).join("");
    if (projects.some(([id]) => id === kanbanProject)) select.value = kanbanProject;
    else kanbanProject = "all";
  }

  function kanbanRepositoryChoices() {
    const counts = new Map();
    for (const source of scheduleSources) {
      const repo = String(source.repo || "").trim();
      if (repo && !counts.has(repo)) counts.set(repo, 0);
    }
    for (const item of scheduleGithubItems) {
      const repo = String(item.repo || "").trim();
      if (repo) counts.set(repo, (counts.get(repo) || 0) + 1);
    }
    return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right));
  }

  function renderKanbanRepositoryFilter() {
    const summary = $("kanbanRepositorySummary");
    const options = $("kanbanRepositoryOptions");
    const chips = $("kanbanRepositoryChips");
    const clearButton = $("btnClearKanbanRepositories");
    if (!summary || !options || !chips || !clearButton) return;
    const choices = kanbanRepositoryChoices();
    const available = new Set(choices.map(([repo]) => repo));
    kanbanRepositories = new Set(Array.from(kanbanRepositories).filter((repo) => available.has(repo)));
    summary.textContent = kanbanRepositories.size
      ? `Repository ${kanbanRepositories.size}개 선택`
      : "전체 Repository";
    clearButton.disabled = !kanbanRepositories.size;
    options.innerHTML = choices.length
      ? choices.map(([repo, count]) => {
        const selected = kanbanRepositories.has(repo);
        return `<button type="button" data-kanban-repository-option="${attr(repo)}" aria-pressed="${selected ? "true" : "false"}">
          <span>${esc(repo)}</span><small>${count}개</small>
        </button>`;
      }).join("")
      : '<p class="hint">선택 가능한 Repository가 없습니다.</p>';
    chips.hidden = !kanbanRepositories.size;
    chips.innerHTML = Array.from(kanbanRepositories).sort().map((repo) =>
      `<button type="button" data-kanban-repository-remove="${attr(repo)}" aria-label="${attr(`${repo} 필터 제거`)}">
        <span>${esc(repo)}</span><b aria-hidden="true">×</b>
      </button>`
    ).join("");
  }

  function priorityMatrixChip(entry) {
    const selected = kanbanMatrixSelectedCardId === entry.key;
    const editable = entry.editable !== false;
    const title = editable
      ? `${entry.detail || entry.badge} · 클릭한 뒤 목적지 영역을 클릭하거나 끌어서 이동하세요`
      : `${entry.detail || entry.badge} · Pull Request는 이 화면에서 읽기 전용입니다`;
    const actionLabel = entry.kind === "github" ? (editable ? "이슈 닫기" : "") : entry.kind === "history" ? "기록 삭제" : "카드 삭제";
    return `<div class="schedule-chip-shell">
      <button class="schedule-chip ${entry.destination}${selected ? " is-selected" : ""}${editable ? "" : " is-readonly"}" type="button" draggable="${editable ? "true" : "false"}" data-kanban-matrix-card="${attr(entry.key)}" aria-pressed="${selected ? "true" : "false"}" aria-disabled="${editable ? "false" : "true"}" title="${attr(title)}">
        <span>${esc(entry.title)}</span><small>${esc(entry.badge)}</small>
      </button>
      ${actionLabel ? `<button class="btn-link danger-link" type="button" data-kanban-matrix-delete="${attr(entry.key)}">${actionLabel}</button>` : ""}
    </div>`;
  }

  function renderKanbanMatrix(historyMetas = historyLoaded ? scheduleItems() : []) {
    const matrix = $("scheduleMatrix");
    const extras = $("scheduleMatrixExtras");
    if (!matrix || !extras) return;
    renderKanbanProjectFilter();
    renderKanbanRepositoryFilter();
    const entries = priorityMatrixEntries(historyMetas);
    matrix.innerHTML = Object.entries(KANBAN_MATRIX_LABELS).map(([key, values]) => {
      const cards = entries.filter((entry) => entry.destination === key).map(priorityMatrixChip).join("");
      return `<section class="schedule-quad ${key}" data-kanban-matrix-zone="${key}">
        <div class="schedule-quad-head"><strong>${values[0]}</strong><span>${values[1]}</span></div>
        <div class="schedule-chip-list">${cards || `<p class="hint">해당 카드 없음</p>`}</div>
      </section>`;
    }).join("");
    const extraGroups = [
      ["done", "완료", "GitHub 연결 카드는 이슈를 닫고, 연결되지 않은 카드는 이 브라우저에 완료 위치를 저장합니다."],
      ["unclassified", "미분류", "GitHub 연결 카드는 중요도·긴급도 라벨을 해제하고, 연결되지 않은 카드는 이 브라우저에 위치를 저장합니다."],
    ];
    extras.innerHTML = extraGroups.map(([key, title, help]) => {
      const group = entries.filter((entry) => entry.destination === key);
      return `<details class="schedule-extra ${key}" data-kanban-matrix-zone="${key}" data-kanban-extra-fold="${key}"${kanbanExtrasOpen[key] ? " open" : ""}>
        <summary class="schedule-extra-head" title="누르면 접거나 펼칩니다. 접힌 상태에서도 카드를 끌어다 놓을 수 있습니다."><strong>${title}</strong><span>${group.length}개</span></summary>
        <p class="hint">${help}</p>
        <div class="schedule-chip-list">${group.map(priorityMatrixChip).join("") || `<p class="hint">해당 카드 없음</p>`}</div>
      </details>`;
    }).join("");
    if (kanbanMatrixSelectedCardId) {
      setPriorityMatrixStatus("선택한 카드를 옮길 사분면·완료·미분류 영역을 클릭하세요.");
    } else if (kanbanLoadError && historyLoadError) {
      setPriorityMatrixStatus(`보드 과업과 기존 일정을 불러오지 못했습니다: 보드 과업 ${kanbanLoadError} · 기존 일정 ${historyLoadError}`, true);
    } else if (kanbanLoadError) {
      setPriorityMatrixStatus(`기존 일정은 표시했지만 보드 과업을 불러오지 못했습니다: ${kanbanLoadError}`, true);
    } else if (historyLoadError) {
      setPriorityMatrixStatus(`보드 과업은 표시했지만 기존 일정을 불러오지 못했습니다: ${historyLoadError}`, true);
    } else {
      const historyCount = entries.filter((entry) => entry.kind === "history").length;
      const linkedCount = entries.filter((entry) => entry.linked).length;
      const projectCount = entries.filter((entry) => entry.kind === "github").length;
      const repositoryStatus = kanbanRepositories.size ? ` · Repository ${kanbanRepositories.size}개 선택` : "";
      setPriorityMatrixStatus(`GitHub Project 업무 ${projectCount}개 · 보드 과업 ${kanbanCards.length}개 · 기존 일정 ${historyCount}개 · GitHub 연결 ${linkedCount}개${repositoryStatus}. 카드를 클릭한 뒤 목적지 영역을 클릭하거나 끌어서 이동하세요.`);
    }
  }

  let kanbanMatrixDragCardId = null;
  let kanbanMatrixSelectedCardId = null;
  function onKanbanMatrixDragStart(event) {
    const chip = event.target instanceof Element ? event.target.closest("[data-kanban-matrix-card]") : null;
    if (!chip) return;
    const entry = priorityMatrixEntries().find((item) => item.key === chip.dataset.kanbanMatrixCard);
    if (entry?.editable === false) {
      event.preventDefault();
      setPriorityMatrixStatus("Pull Request는 칸반에서 읽기 전용입니다. GitHub에서 상태를 변경해 주세요.");
      return;
    }
    kanbanMatrixDragCardId = chip.dataset.kanbanMatrixCard;
    event.dataTransfer?.setData("text/plain", kanbanMatrixDragCardId || "");
    event.dataTransfer.effectAllowed = "move";
  }
  function onKanbanMatrixDragEnd() {
    kanbanMatrixDragCardId = null;
    document.querySelectorAll("[data-kanban-matrix-zone].is-drop-target").forEach((zone) => zone.classList.remove("is-drop-target"));
  }
  function onKanbanMatrixDragOver(event) {
    const zone = event.target instanceof Element ? event.target.closest("[data-kanban-matrix-zone]") : null;
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("is-drop-target");
    event.dataTransfer.dropEffect = "move";
  }
  function onKanbanMatrixDragLeave(event) {
    const zone = event.target instanceof Element ? event.target.closest("[data-kanban-matrix-zone]") : null;
    zone?.classList.remove("is-drop-target");
  }
  async function onKanbanMatrixDrop(event) {
    const zone = event.target instanceof Element ? event.target.closest("[data-kanban-matrix-zone]") : null;
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-drop-target");
    const cardId = kanbanMatrixDragCardId || event.dataTransfer?.getData("text/plain");
    kanbanMatrixDragCardId = null;
    const destination = zone.dataset.kanbanMatrixZone;
    await moveKanbanMatrixCard(cardId, destination);
  }

  async function onKanbanMatrixClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const deleteButton = target?.closest("[data-kanban-matrix-delete]");
    if (deleteButton) {
      const entry = priorityMatrixEntries().find((item) => item.key === deleteButton.dataset.kanbanMatrixDelete);
      if (!entry) return;
      if (entry.kind === "github") {
        await closeScheduleGithubItem(entry.item, deleteButton, setPriorityMatrixStatus);
      } else if (entry.kind === "history") {
        await deleteHistory(entry.meta.item, deleteButton, setPriorityMatrixStatus);
      } else {
        await deleteKanban(entry.card, deleteButton);
      }
      return;
    }
    const chip = target?.closest("[data-kanban-matrix-card]");
    if (chip) {
      const cardId = chip.dataset.kanbanMatrixCard || null;
      const entry = priorityMatrixEntries().find((item) => item.key === cardId);
      if (entry?.editable === false) {
        kanbanMatrixSelectedCardId = null;
        setPriorityMatrixStatus("Pull Request는 칸반에서 읽기 전용입니다. GitHub에서 상태를 변경해 주세요.");
        return;
      }
      kanbanMatrixSelectedCardId = kanbanMatrixSelectedCardId === cardId ? null : cardId;
      renderKanbanMatrix();
      return;
    }
    const zone = target?.closest("[data-kanban-matrix-zone]");
    if (!zone || !kanbanMatrixSelectedCardId) return;
    // 카드 이동을 위한 영역 클릭이 완료·미분류 <summary> 접힘 토글로 번지지 않게 한다.
    event.preventDefault();
    await moveKanbanMatrixCard(kanbanMatrixSelectedCardId, zone.dataset.kanbanMatrixZone);
  }

  async function moveKanbanMatrixCard(cardId, destination) {
    if (!cardId || !PRIORITY_MATRIX_DESTINATIONS.has(destination)) return;
    const entry = priorityMatrixEntries().find((item) => item.key === cardId);
    if (!entry) return;
    if (entry.editable === false) {
      setPriorityMatrixStatus("Pull Request는 칸반에서 읽기 전용입니다. GitHub에서 상태를 변경해 주세요.");
      return;
    }
    if (entry.kind === "github") {
      const item = entry.item;
      const values = KANBAN_MATRIX_LABELS[destination];
      const body = destination === "done"
        ? { kind: item.kind, repo: item.repo, number: item.number, state: "closed", importance: entry.importance === "none" ? "low" : entry.importance, urgency: entry.urgency === "none" ? "low" : entry.urgency }
        : destination === "unclassified"
          ? { kind: item.kind, repo: item.repo, number: item.number, state: "open", importance: "none", urgency: "none" }
          : { kind: item.kind, repo: item.repo, number: item.number, state: "open", importance: values[2], urgency: values[3] };
      setPriorityMatrixStatus(`${entry.title} GitHub 이슈를 동기화하는 중...`);
      try {
        const res = await window.apiFetch("/api/schedule/github-items", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        scheduleGithubLoaded = false;
        kanbanMatrixSelectedCardId = null;
        await loadScheduleGithubItems(true);
        setPriorityMatrixStatus(`${item.repo}#${item.number} GitHub 상태와 우선순위를 동기화했습니다.`);
      } catch (err) {
        setPriorityMatrixStatus("GitHub Project 업무 이동 실패: " + err.message, true);
      }
      return;
    }
    if (entry.kind !== "kanban" || !entry.linked) {
      const saved = setLocalMatrixPlacement(entry.key, destination);
      kanbanMatrixSelectedCardId = null;
      renderKanbanMatrix();
      setPriorityMatrixStatus(saved
        ? `“${entry.title}” 위치를 이 브라우저에 저장했습니다.`
        : "브라우저 저장소를 사용할 수 없어 위치를 저장하지 못했습니다.", !saved);
      return;
    }
    const card = entry.card;
    const values = KANBAN_MATRIX_LABELS[destination];
    const body = destination === "done"
      ? { status: "done", importance: card.importance || "low", urgency: card.urgency || "low" }
      : destination === "unclassified"
        ? { status: card.status === "done" ? "todo" : card.status, importance: "none", urgency: "none" }
        : { status: card.status === "done" ? "todo" : card.status, importance: values[2], urgency: values[3] };
    setPriorityMatrixStatus(`“${entry.title}” GitHub 이슈를 동기화하는 중...`);
    try {
      const res = await window.apiFetch(`/api/kanban/cards/${encodeURIComponent(card.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const index = kanbanCards.findIndex((item) => item.id === card.id);
      if (index >= 0 && data.card) kanbanCards[index] = data.card;
      clearLocalMatrixPlacement(entry.key);
      kanbanMatrixSelectedCardId = null;
      renderKanbanMatrix();
      const action = destination === "unclassified"
        ? "중요도·긴급도 라벨을 해제했습니다."
        : destination === "done"
          ? "완료 처리하고 이슈를 닫았습니다."
          : "중요도·긴급도 라벨과 이슈 상태를 동기화했습니다.";
      setPriorityMatrixStatus(`GitHub 이슈 #${card.github_issue_number}: ${action}`);
    } catch (err) {
      setPriorityMatrixStatus("우선순위 이동 실패: " + err.message, true);
    }
  }

  async function onKanbanChange(event) {
    const target = event.target instanceof Element ? event.target : null;
    const select = target?.closest("[data-kanban-card]");
    if (!select) return;
    const cardId = select.dataset.kanbanCard;
    const nextStatus = select.value;
    select.disabled = true;
    try {
      const res = await window.apiFetch(`/api/kanban/cards/${encodeURIComponent(cardId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const idx = kanbanCards.findIndex((card) => card.id === cardId);
      if (idx >= 0 && data.card) kanbanCards[idx] = data.card;
      renderKanban();
    } catch (err) {
      const status = $("kanbanStatus");
      if (status) {
        status.textContent = "칸반 카드 상태 변경 실패: " + err.message;
        status.classList.add("danger");
      }
      select.disabled = false;
    }
  }

  function initHistoryControls() {
    ["historySearch", "historyKind", "historyProject", "historyFile", "historyTag", "historyFavoriteOnly"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", () => {
        historyPage = 1;
        renderHistory();
      });
    });
    $("btnReloadHistory").addEventListener("click", () => loadHistory(true));
    $("btnHistoryReport").addEventListener("click", downloadHistoryReport);
    $("btnHistoryReportPdf")?.addEventListener("click", () => downloadHistoryReport(null, "pdf"));
    $("historyList").addEventListener("click", onHistoryClick);
    $("historyList").addEventListener("change", onHistoryChange);
    $("historyPagination")?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-history-page]");
      if (!button || button.disabled) return;
      historyPage = Number(button.dataset.historyPage) || 1;
      renderHistory();
      $("historyList")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("btnCloseHistoryModal").addEventListener("click", closeHistoryModal);
    $("historyModalBackdrop").addEventListener("click", closeHistoryModal);
    $("btnReloadEval")?.addEventListener("click", () => loadEvalDashboard(true));
    $("btnRunEval")?.addEventListener("click", runSelectedEval);
    $("btnEvalHtml")?.addEventListener("click", () => downloadEvalReport("pdf"));
    $("btnEvalMd")?.addEventListener("click", () => downloadEvalReport("md"));
    $("btnEvalCsv")?.addEventListener("click", () => downloadEvalReport("xlsx"));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeHistoryModal();
        closeScheduleDayModal();
        closeScheduleFeedbackModal();
      }
    });
  }

  function pct(value) {
    const n = Number(value || 0);
    return `${(n * 100).toFixed(1)}%`;
  }

  function fmtCost(value) {
    const n = Number(value || 0);
    return n < 1 ? n.toFixed(3) : n.toFixed(2);
  }

  // 실행별 DagsHub(MLflow) 동기화 결과를 작은 배지로 표시한다.
  function dagBadge(run) {
    const status = run.dagshub_sync_status;
    if (run.dagshub_run_url) {
      return `<br><a class="src" href="${esc(run.dagshub_run_url)}" target="_blank" rel="noopener">DagsHub ↗</a>`;
    }
    if (status === "synced") return `<br><span class="src">DagsHub ✓</span>`;
    if (status === "failed") return `<br><span class="src">DagsHub ✗</span>`;
    return "";
  }

  // 히스토리 상세의 각 항목 제목 옆에 붙이는 DagsHub 기록 하이퍼링크(없으면 빈 문자열).
  function dagLinkText(url) {
    return url ? ` <a class="src dag-link" href="${esc(url)}" target="_blank" rel="noopener">DagsHub 기록 ↗</a>` : "";
  }

  function evalCombinations() {
    return [...document.querySelectorAll("[data-eval-model]:checked")].map((input) => {
      const [provider, model] = input.value.split("::");
      return { provider, model, prompt_version: "default" };
    });
  }

  function renderEvalModelChecks() {
    const wrap = $("evalModelChecks");
    if (!wrap) return;
    const picks = [
      ["gemini", "gemini-2.5-flash"],
      ["gemini", "gemini-2.5-pro"],
      ["claude", "claude-sonnet-4-6"],
      ["claude", "claude-opus-4-8"],
      ["openai", "gpt-5-mini"],
      ["openai", "gpt-5"],
    ].filter(([provider, model]) => modelsFor(provider, "analysis").includes(model));
    wrap.innerHTML = picks.map(([provider, model], index) => `
      <label class="check-row">
        <input type="checkbox" data-eval-model value="${esc(provider)}::${esc(model)}" ${index < 2 ? "checked" : ""} />
        ${esc(PROVIDER_LABEL[provider] || provider)}/${esc(model)}
      </label>`).join("");
  }

  async function loadEvalDashboard(force) {
    const status = $("evalStatus");
    if (!status) return;
    status.textContent = force ? "AI 성능 새로고침 중..." : "AI 성능 데이터를 불러오는 중...";
    status.classList.remove("danger");
    try {
      const res = await window.apiFetch("/api/ai/evals");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      evalLoaded = true;
      evalData = data;
      renderEvalModelChecks();
      renderEvalDashboard();
    } catch (err) {
      status.textContent = "AI 성능 데이터 로드 실패: " + err.message;
      status.classList.add("danger");
    }
  }

  function renderEvalDashboard() {
    const summary = evalData.summary || {};
    $("evalCaseCount").textContent = String(summary.case_count || 0);
    $("evalRunCount").textContent = String(summary.run_count || 0);
    $("evalSuccessCount").textContent = String(summary.success_count || 0);
    $("evalFallbackCount").textContent = String(summary.fallback_count || 0);

    const caseSel = $("evalCaseSelect");
    const current = caseSel.value;
    caseSel.innerHTML = (evalData.cases || []).map((item) =>
      `<option value="${esc(item.id)}">${esc(item.stage)} · ${esc(item.name)}</option>`
    ).join("");
    if (current && (evalData.cases || []).some((item) => item.id === current)) caseSel.value = current;

    const rows = $("evalPerfRows");
    const aggregates = evalData.aggregates || [];
    rows.innerHTML = aggregates.length ? aggregates.map((row) => `<tr>
      <td>${esc(row.stage)}</td>
      <td>${esc(row.prompt_version)}</td>
      <td>${esc(row.provider)}/${esc(row.model)}<br><span class="src">${row.runs || 0} runs</span></td>
      <td class="num">${pct(row.judge_score_avg)}</td>
      <td class="num">${pct(row.schema_pass_rate)} / ${pct(row.source_citation_hit_rate)}</td>
      <td class="num">${Math.round(row.latency_p50_ms || 0)} / ${Math.round(row.latency_p95_ms || 0)} ms</td>
      <td class="num">${Math.round(row.avg_tokens || 0)} / ${fmtCost(row.avg_cost_krw)}원</td>
      <td class="num">${row.failure_count || 0} / ${row.fallback_count || 0}</td>
    </tr>`).join("") : '<tr><td colspan="8" class="src">아직 평가 실행이 없습니다. 케이스와 모델을 선택해 실행하세요.</td></tr>';

    const recent = $("evalRecentRows");
    const runs = evalData.recent_runs || [];
    recent.innerHTML = runs.length ? runs.map((run) => `<tr>
      <td>${esc(run.case_name || run.case_id)}<br><span class="src">${esc(run.stage)} · ${esc((run.created_at || "").slice(0, 19).replace("T", " "))}</span></td>
      <td>${esc(run.provider)}/${esc(run.model)}${run.fallback_from ? `<br><span class="src">fallback: ${esc(run.fallback_from)}</span>` : ""}${dagBadge(run)}</td>
      <td class="num">${run.success ? "OK" : "FAIL"}</td>
      <td class="num">${pct(run.judge_score)} · JSON ${run.json_parse_ok ? "Y" : "N"} · schema ${run.schema_ok ? "Y" : "N"} · source ${run.source_citation_hit ? "Y" : "N"}</td>
      <td class="num">${Math.round(run.latency_ms || 0)} ms / ${fmtCost(run.cost_krw)}원</td>
    </tr>`).join("") : '<tr><td colspan="5" class="src">최근 평가 실행 없음</td></tr>';

    const dag = evalData.dagshub || {};
    const dagLabel = dag.configured
      ? (dag.repo ? `<a class="dag-link" href="https://dagshub.com/${esc(dag.repo)}/experiments" target="_blank" rel="noopener">연동 설정됨 ↗</a>` : "연동 설정됨")
      : "연동 미설정";
    $("evalStatus").innerHTML = `평가 케이스 ${summary.case_count || 0}개 · 실행 ${summary.run_count || 0}회 · DagsHub ${dagLabel}`;
    $("evalStatus").classList.remove("danger");
  }

  async function runSelectedEval() {
    const status = $("evalStatus");
    const caseId = $("evalCaseSelect").value;
    const combinations = evalCombinations();
    if (!caseId || !combinations.length) {
      status.textContent = "평가 케이스와 모델을 선택하세요.";
      status.classList.add("danger");
      return;
    }
    $("btnRunEval").disabled = true;
    status.textContent = `평가 실행 중... (${combinations.length}개 모델)`;
    status.classList.remove("danger");
    try {
      const res = await window.apiFetch("/api/ai/evals/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          case_ids: [caseId],
          combinations,
          repeat: Number($("evalRepeat").value) || 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      evalData = data.dashboard || evalData;
      evalLoaded = true;
      renderEvalDashboard();
      status.textContent = `평가 완료 · ${data.runs?.length || 0}회 실행 저장`;
    } catch (err) {
      status.textContent = "평가 실행 실패: " + err.message;
      status.classList.add("danger");
    } finally {
      $("btnRunEval").disabled = false;
    }
  }

  async function downloadEvalReport(format) {
    const status = $("evalStatus");
    try {
      if (format === "pdf") {
        const res = await window.apiFetch("/api/ai/evals/report?format=html");
        const html = await res.text();
        if (!res.ok) throw new Error(html);
        printHtmlDocument(html, "AI 성능 보고서");
        status.textContent = "PDF 저장 창을 열었습니다.";
        status.classList.remove("danger");
        return;
      }
      if (format === "xlsx") {
        if (!window.XLSX) throw new Error("Excel 파일 생성 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.");
        const res = await window.apiFetch("/api/ai/evals/report?format=csv");
        const csv = await res.text();
        if (!res.ok) throw new Error(csv);
        const wb = XLSX.read(csv, { type: "string" });
        if (wb.SheetNames[0] && wb.SheetNames[0] !== "AI 성능") {
          wb.Sheets["AI 성능"] = wb.Sheets[wb.SheetNames[0]];
          delete wb.Sheets[wb.SheetNames[0]];
          wb.SheetNames[0] = "AI 성능";
        }
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (ws) ws["!cols"] = [{ wch: 16 }, { wch: 20 }, { wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
        const data = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${new Date().toISOString().slice(0, 10)}_ai_eval_report.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
        status.textContent = "Excel 리포트 다운로드 완료";
        status.classList.remove("danger");
        return;
      }
      const res = await window.apiFetch(`/api/ai/evals/report?format=${encodeURIComponent(format)}`);
      const blob = await res.blob();
      if (!res.ok) throw new Error(await blob.text());
      const ext = format === "md" ? "md" : format;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${new Date().toISOString().slice(0, 10)}_ai_eval_report.${ext}`;
      a.click();
      URL.revokeObjectURL(a.href);
      status.textContent = `${format.toUpperCase()} 리포트 다운로드 완료`;
      status.classList.remove("danger");
    } catch (err) {
      status.textContent = "리포트 다운로드 실패: " + err.message;
      status.classList.add("danger");
    }
  }

  async function loadHistory(force) {
    historyLoadError = "";
    const status = $("historyStatus");
    status.textContent = force ? "새로고침 중..." : "불러오는 중...";
    status.classList.remove("danger");
    historyLoadError = "";
    try {
      const res = await window.apiFetch("/api/history?limit=200");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      historyItems = data.items || [];
      if (data.server_now) scheduleServerNow = data.server_now;
      if (!scheduleCursor) scheduleCursor = scheduleToday();
      historyPage = 1;
      historyDetails.clear();
      selectedHistory.clear();
      historyLoaded = true;
      historyLoadError = "";
      renderTagOptions(data.tags || []);
      renderHistory();
      renderSchedule();
      return true;
    } catch (err) {
      historyLoadError = err.message;
      status.textContent = "불러오기 실패: " + err.message;
      status.classList.add("danger");
      $("historyList").innerHTML = "";
      if ($("scheduleStatus")) {
        $("scheduleStatus").textContent = "스케줄 불러오기 실패: " + err.message;
        $("scheduleStatus").classList.add("danger");
      }
      return false;
    }
  }

  function renderTagOptions(tags) {
    const sel = $("historyTag");
    const current = normalizeHistoryTag(sel.value);
    const sourceTags = tags.length ? tags : uniqueTags(...historyItems.map((item) => item.tags || []));
    const allTags = uniqueTags(sourceTags.map(normalizeHistoryTag), ["수정"])
      .sort((a, b) => a.localeCompare(b, "ko"));
    sel.innerHTML = '<option value="">전체 태그</option>' +
      allTags.map((tag) => `<option value="${esc(tag)}">${esc(tag)}</option>`).join("");
    if (current && allTags.includes(current)) sel.value = current;
  }

  function filteredHistory() {
    const query = $("historySearch").value.trim().toLowerCase();
    const kind = $("historyKind").value;
    const project = $("historyProject").value.trim().toLowerCase();
    const file = $("historyFile").value.trim().toLowerCase();
    const tag = $("historyTag").value;
    const favoriteOnly = $("historyFavoriteOnly").checked;
    return historyItems.filter((item) => {
      const haystack = [
        item.title, item.source, item.project, item.subject,
        ...(item.file_names || []), ...(item.tags || []), ...historyTags(item),
      ].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (kind && item.kind !== kind) return false;
      if (favoriteOnly && !item.favorite) return false;
      if (project && ![item.project, item.subject, item.title].join(" ").toLowerCase().includes(project)) return false;
      if (file && !(item.file_names || []).join(" ").toLowerCase().includes(file)) return false;
      if (tag && !historyTags(item).includes(tag)) return false;
      return true;
    });
  }

  function renderHistory() {
    const list = $("historyList");
    const items = filteredHistory();
    const pagination = $("historyPagination");
    const pageCount = Math.max(1, Math.ceil(items.length / HISTORY_PAGE_SIZE));
    historyPage = Math.min(Math.max(1, historyPage), pageCount);
    const pageStart = (historyPage - 1) * HISTORY_PAGE_SIZE;
    const pageItems = items.slice(pageStart, pageStart + HISTORY_PAGE_SIZE);
    const validKeys = new Set(historyItems.map(keyOf));
    for (const key of [...selectedHistory]) {
      if (!validKeys.has(key)) selectedHistory.delete(key);
    }

    $("histTotal").textContent = String(historyItems.length);
    $("histMeetings").textContent = String(historyItems.filter((item) => item.kind === "meeting").length);
    $("histAnalysis").textContent = String(historyItems.filter((item) => item.kind === "analysis").length);
    $("histFavorites").textContent = String(historyItems.filter((item) => item.favorite).length);
    $("historyStatus").textContent = `${items.length}개 중 ${items.length ? pageStart + 1 : 0}–${Math.min(pageStart + HISTORY_PAGE_SIZE, items.length)}개 표시 · ${selectedHistory.size}개 선택`;
    $("historyStatus").classList.remove("danger");
    $("btnHistoryReport").disabled = selectedHistory.size === 0;
    $("btnHistoryReportPdf").disabled = selectedHistory.size === 0;

    if (!items.length) {
      list.innerHTML = '<p class="hint">조건에 맞는 히스토리가 없습니다.</p>';
      if (pagination) {
        pagination.hidden = true;
        pagination.innerHTML = "";
      }
      return;
    }

    list.innerHTML = pageItems.map((item) => {
      const key = keyOf(item);
      const fileText = item.file_names?.length
        ? item.file_names.slice(0, 3).map(esc).join(", ") + (item.file_names.length > 3 ? ` 외 ${item.file_names.length - 3}개` : "")
        : "파일 없음";
      const tagChips = historyTagChips(item, { removable: true });
      return `<article class="history-item" data-kind="${item.kind}" data-id="${item.id}">
        <label class="history-select"><input type="checkbox" data-action="select" ${selectedHistory.has(key) ? "checked" : ""} /> 선택</label>
        <div class="history-main">
          <div class="history-title-row">
            <span class="source-badge ${item.kind}">${esc(item.source)}</span>
            <strong>${esc(item.title)}</strong>
            <button class="fav-btn ${item.favorite ? "active" : ""}" type="button" data-action="favorite">${item.favorite ? "고정됨" : "고정"}</button>
          </div>
          <div class="history-meta">
            <span>${fmtDate(item.date || item.created_at)}</span>
            <span>프로젝트: ${esc(item.project || "-")}</span>
            <span>파일: ${item.file_count || 0}개</span>
            <span>${esc(fileText)}</span>
          </div>
          <div class="tag-row">${tagChips || '<span class="hint">태그 없음</span>'}</div>
          <div class="history-tag-editor">
            <input type="text" data-tag-input placeholder="태그 추가" maxlength="24" />
            <button class="btn btn-ghost btn-small" type="button" data-action="add-tag">추가</button>
            <button class="btn btn-ghost btn-small" type="button" data-action="detail">상세</button>
            ${item.kind === "analysis" ? `<button class="btn btn-ghost btn-small" type="button" data-action="reopen-analysis">재열기</button>` : ""}
            ${item.kind === "meeting" ? `<button class="btn btn-ghost btn-small md-download-control" type="button" data-action="download-meeting" style="display:none">.md</button>` : ""}
            ${item.kind === "meeting" ? `<button class="btn btn-ghost btn-small" type="button" data-action="pdf-meeting">PDF</button>` : ""}
            <button class="btn btn-danger btn-small" type="button" data-action="delete">삭제</button>
          </div>
        </div>
      </article>`;
    }).join("");

    if (pagination) {
      pagination.hidden = pageCount <= 1;
      pagination.innerHTML = pageCount <= 1 ? "" : `
        <button class="btn btn-ghost btn-small" type="button" data-history-page="${historyPage - 1}" ${historyPage === 1 ? "disabled" : ""}>이전</button>
        <div class="history-page-numbers">
          ${Array.from({ length: pageCount }, (_, index) => {
            const page = index + 1;
            return `<button class="btn btn-small ${page === historyPage ? "btn-primary" : "btn-ghost"}" type="button" data-history-page="${page}" aria-label="${page}페이지" ${page === historyPage ? 'aria-current="page"' : ""}>${page}</button>`;
          }).join("")}
        </div>
        <button class="btn btn-ghost btn-small" type="button" data-history-page="${historyPage + 1}" ${historyPage === pageCount ? "disabled" : ""}>다음</button>`;
    }
  }

  function findHistoryItem(el) {
    const itemEl = el.closest(".history-item");
    if (!itemEl) return null;
    return historyItems.find((item) => item.kind === itemEl.dataset.kind && item.id === itemEl.dataset.id) || null;
  }

  async function patchHistory(item, payload) {
    const res = await window.apiFetch(`/api/history/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    item.favorite = !!data.favorite;
    item.custom_tags = data.custom_tags || [];
    item.tags = uniqueTags(item.custom_tags, item.auto_tags || []);
    renderTagOptions([]);
    renderHistory();
  }

  async function deleteHistory(item, button, statusWriter) {
    if (!window.confirm(`“${displayText(item.title, "기록")}”을 휴지통으로 이동할까요?\n원본과 산출물은 즉시 파기되지 않으며 복구 API로 되돌릴 수 있습니다.`)) return false;
    if (button) button.disabled = true;
    try {
      const res = await window.apiFetch(`/api/history/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      historyItems = historyItems.filter((candidate) => keyOf(candidate) !== keyOf(item));
      selectedHistory.delete(keyOf(item));
      historyDetails.delete(keyOf(item));
      clearLocalMatrixPlacement(`history:${item.kind}:${item.id}`);
      closeHistoryModal();
      closeScheduleDayModal();
      renderTagOptions([]);
      renderHistory();
      renderSchedule();
      renderKanbanMatrix();
      const message = "기록을 휴지통으로 이동했습니다.";
      if (statusWriter) statusWriter(message);
      else {
        $("historyStatus").textContent = message;
        $("historyStatus").classList.remove("danger");
      }
      return true;
    } catch (err) {
      const message = "기록 삭제 실패: " + err.message;
      if (statusWriter) statusWriter(message, true);
      else {
        $("historyStatus").textContent = message;
        $("historyStatus").classList.add("danger");
      }
      if (button) button.disabled = false;
      return false;
    }
  }

  async function fetchHistoryDetail(item) {
    const key = keyOf(item);
    if (historyDetails.has(key)) return historyDetails.get(key);
    const res = await window.apiFetch(`/api/history/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    historyDetails.set(key, data);
    return data;
  }

  function planRunStatusLabel(status) {
    if (status === "success") return "확인";
    if (status === "error") return "오류";
    return "검토 필요";
  }

  function evidenceLabel(item) {
    const parts = [
      displayText(item?.file_name || item?.file || item?.source, "근거 자료"),
      item?.page ? `p.${item.page}` : "",
      item?.sheet ? `시트 ${item.sheet}` : "",
      item?.range || item?.cell || "",
    ].filter(Boolean);
    return parts.join(" · ");
  }

  function resultKindLabel(kind) {
    if (kind === "calculation") return "계산 결과";
    if (kind === "comparison") return "비교표";
    if (kind === "report") return "보고서";
    if (kind === "procedure") return "실행 체크리스트";
    return "요약 판단";
  }

  function resultStatusLabel(status) {
    if (status === "ready") return "결과 확인";
    if (status === "needs_input") return "입력 필요";
    if (status === "needs_user_action") return "직접 실행 필요";
    return "근거 보완";
  }

  function resultContractHtml(contract) {
    if (!contract) return "";
    const value = contract.result_value?.value ? `<br><strong>결과값:</strong> ${esc(displayText(contract.result_value.value))}` : "";
    const formula = contract.formula?.expression ? `<br><span class="hint">수식: ${esc(displayText(contract.formula.expression))}</span>` : "";
    const sections = Array.isArray(contract.report_sections) && contract.report_sections.length
      ? `<ul>${contract.report_sections.slice(0, 3).map((section) => `<li><strong>${esc(displayText(section.heading))}</strong> — ${esc(displayText(section.body))}</li>`).join("")}</ul>`
      : "";
    const comparison = Array.isArray(contract.comparison_rows) && contract.comparison_rows.length
      ? `<ul>${contract.comparison_rows.slice(0, 5).map((row) => `<li><strong>${esc(displayText(row.item))}</strong> — ${esc(displayText(row.result))}</li>`).join("")}</ul>`
      : "";
    const checklist = Array.isArray(contract.checklist) && contract.checklist.length
      ? `<ul>${contract.checklist.slice(0, 6).map((todo) => `<li>□ ${esc(displayText(todo.label))}</li>`).join("")}</ul>`
      : "";
    return `<li><strong>${esc(displayText(contract.title, "검토 작업"))}</strong> <span class="tag-chip">${esc(resultKindLabel(contract.kind))}</span> <span class="tag-chip">${esc(resultStatusLabel(contract.status))}</span>` +
      `<br>${esc(displayText(contract.answer, "결과 요약 없음"))}${value}${formula}${sections}${comparison}${checklist}</li>`;
  }

  function resultContractsFromOutputs(outputs) {
    const direct = outputs?.plan_runs?.result_contracts || outputs?.executions?.result_contracts || [];
    const runs = outputs?.plan_runs?.runs || outputs?.executions?.plan_runs?.runs || outputs?.executions?.plan_runs || [];
    if (Array.isArray(direct) && direct.length) return direct;
    if (Array.isArray(runs)) return runs.map((run) => run?.result_contract || run?.resultContract).filter(Boolean);
    return [];
  }

  function outputSummaryHtml(outputs, meta, files = []) {
    const parts = [];
    const summaries = outputs?.summaries || {};
    if (summaries.overall || Array.isArray(summaries.summaries)) {
      const overall = replaceFileRefs(summaries.overall, files);
      parts.push(`<h3>분석파일 요약</h3>${overall ? `<p>${esc(overall)}</p>` : ""}`);
      const items = Array.isArray(summaries.summaries) ? summaries.summaries : [];
      if (items.length) {
        parts.push(`<ul>${items.map((it) => `<li><strong>${esc(displayText(it.name, "분석파일"))}</strong> — ${esc(replaceFileRefs(it.summary, files))}</li>`).join("")}</ul>`);
      }
    }
    const ideas = outputs?.ideas?.questions;
    if (Array.isArray(ideas) && ideas.length) {
      parts.push(`<h3>아이디어 질문</h3><ul>${ideas.map((q) => {
        const rationale = replaceFileRefs(q.rationale, files);
        return `<li><strong>${esc(replaceFileRefs(q.question, files))}</strong>${rationale ? `<br><span class="hint">${esc(rationale)}</span>` : ""}</li>`;
      }).join("")}</ul>`);
    }
    const plans = outputs?.plans?.plans;
    if (Array.isArray(plans) && plans.length) {
      parts.push(`<h3>분석 플랜</h3><ul>${plans.map((p) => {
        const detail = replaceFileRefs(p.detail, files);
        return `<li><strong>${esc(replaceFileRefs(p.title, files))}</strong>${detail ? `<br><span class="hint">${esc(detail)}</span>` : ""}</li>`;
      }).join("")}</ul>`);
    }
    const planRuns = outputs?.plan_runs?.runs || outputs?.executions?.plan_runs?.runs || outputs?.executions?.plan_runs || [];
    if (Array.isArray(planRuns) && planRuns.length) {
      parts.push(`<h3>플랜별 검토 결과</h3><ul>${planRuns.map((run) => {
        const evidence = Array.isArray(run.evidence) && run.evidence.length
          ? `<br><span class="hint">근거: ${run.evidence.slice(0, 3).map((ev) => esc(evidenceLabel(ev))).join(", ")}</span>`
          : "";
        const findings = Array.isArray(run.findings) && run.findings.length
          ? `<br><span class="hint">${esc(run.findings.slice(0, 3).join(" · "))}</span>`
          : "";
        return `<li><strong>${esc(displayText(run.title, "검토 작업"))}</strong> <span class="tag-chip">${esc(planRunStatusLabel(run.status))}</span>` +
          `${run.summary ? `<br>${esc(displayText(run.summary))}` : ""}${findings}${evidence}</li>`;
      }).join("")}</ul>`);
    }
    const resultContracts = resultContractsFromOutputs(outputs);
    if (resultContracts.length) {
      parts.push(`<h3>AI 결과값</h3><ul>${resultContracts.map(resultContractHtml).join("")}</ul>`);
    }
    const execution = outputs?.executions || {};
    const artifacts = Array.isArray(execution.artifacts) ? execution.artifacts : [];
    if (artifacts.length) {
      parts.push(`<h3>서버 보관 파일</h3><ul>${artifacts.map((artifact) => {
        const name = displayText(artifact.name, "보고서 파일");
        const label = artifact.download_url
          ? `<a href="${attr(artifact.download_url)}" target="_blank" rel="noopener">${esc(name)}</a>`
          : esc(name);
        return `<li>${label}${artifact.description ? `<br><span class="hint">${esc(displayText(artifact.description))}</span>` : ""}</li>`;
      }).join("")}</ul>`);
    }
    return parts.join("") || '<p class="hint">저장된 분석 산출물이 없습니다.</p>';
  }

  function detailHtml(detail) {
    const item = detail.item || {};
    const tags = historyTagChips(item);
    const meta = `<div class="history-detail-meta">
      <div><strong>일자</strong><br>${fmtDate(item.date || item.created_at)}</div>
      <div><strong>생성</strong><br>${fmtDate(item.created_at)}</div>
      ${item.updated_at ? `<div><strong>수정</strong><br>${fmtDate(item.updated_at)}</div>` : ""}
      ${item.file_count != null ? `<div><strong>파일</strong><br>${item.file_count}개</div>` : ""}
    </div>`;
    if (detail.kind === "meeting") {
      const markdown = displayText(detail.markdown, "본문 없음");
      return `${meta}<div class="tag-row">${tags || '<span class="hint">태그 없음</span>'}</div>
        <div class="result-head history-meeting-head">
          <span class="field-label">회의록${dagLinkText(detail.dagshub_run_url)} <span class="editable-tag">(직접 수정 가능)</span></span>
          <div class="view-toggle">
            <button class="tab-btn active" type="button" data-modal-action="meeting-preview">👁 미리보기</button>
            <button class="tab-btn" type="button" data-modal-action="meeting-edit">✏️ 편집</button>
          </div>
        </div>
        <div class="md-preview history-md-preview" data-meeting-preview>${renderMarkdownPreview(markdown)}</div>
        <textarea class="history-md-editor" data-meeting-editor rows="14" spellcheck="false" hidden>${esc(markdown)}</textarea>`;
    }
    const files = renderSimpleFileList(detail.files);
    return `${meta}<div class="tag-row">${tags || '<span class="hint">태그 없음</span>'}</div>
      ${item.subject ? `<p><strong>주제</strong>: ${esc(displayText(item.subject))}</p>` : ""}
      ${item.etc_url ? `<p><strong>참고 URL</strong>: ${esc(item.etc_url)}</p>` : ""}
      ${item.etc_note ? `<h3>분석 메모</h3><pre class="history-pre small">${esc(displayText(item.etc_note))}</pre>` : ""}
      <h3>분석파일</h3>${files}
      <h3>회의록 참고자료</h3><pre class="history-pre small">${esc(displayText(detail.meeting_markdown, "연결된 회의록 없음"))}</pre>
      <h3>분석 산출물</h3>${outputSummaryHtml(detail.outputs || {}, detail.output_meta || {}, detail.files || [])}`;
  }

  function updateMeetingModalPreview() {
    const editor = document.querySelector("[data-meeting-editor]");
    const preview = document.querySelector("[data-meeting-preview]");
    if (editor && preview) preview.innerHTML = renderMarkdownPreview(editor.value);
  }

  function setMeetingModalView(edit) {
    const editor = document.querySelector("[data-meeting-editor]");
    const preview = document.querySelector("[data-meeting-preview]");
    if (!editor || !preview) return;
    editor.hidden = !edit;
    preview.hidden = edit;
    document.querySelectorAll("[data-modal-action='meeting-edit']").forEach((btn) => btn.classList.toggle("active", edit));
    document.querySelectorAll("[data-modal-action='meeting-preview']").forEach((btn) => btn.classList.toggle("active", !edit));
    if (!edit) updateMeetingModalPreview();
  }

  async function openHistoryDetail(item) {
    const modal = $("historyModal");
    const backdrop = $("historyModalBackdrop");
    $("historyModalTitle").textContent = item.title || "상세";
    $("historyModalSource").textContent = item.source || "히스토리";
    $("historyModalSource").className = `source-badge ${item.kind}`;
    $("historyModalBody").innerHTML = '<p class="hint">불러오는 중...</p>';
    $("historyModalBody").onclick = null;
    $("historyModalBody").oninput = null;
    $("historyModalActions").innerHTML =
      `<button class="btn btn-ghost btn-small" type="button" data-modal-action="report-one">이 항목 보고서 PDF</button>` +
      (item.kind === "analysis" ? `<a class="btn btn-primary btn-small" href="${analysisHref(item)}">분석설계 재열기</a>` : "") +
      (item.kind === "meeting" ? `<button class="btn btn-ghost btn-small" type="button" data-modal-action="copy-meeting">복사</button>` : "") +
      (item.kind === "meeting" ? `<button class="btn btn-ghost btn-small md-download-control" type="button" data-modal-action="download-meeting" style="display:none">.md 내려받기</button>` : "") +
      (item.kind === "meeting" ? `<button class="btn btn-primary btn-small" type="button" data-modal-action="pdf-meeting">PDF</button>` : "") +
      `<button class="btn btn-danger btn-small" type="button" data-modal-action="delete-history">삭제</button>`;
    modal.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add("modal-open");
    try {
      const detail = await fetchHistoryDetail(item);
      $("historyModalBody").innerHTML = detailHtml(detail);
      $("historyModalBody").onclick = (e) => {
        const action = e.target.closest("[data-modal-action]")?.dataset.modalAction;
        if (action === "meeting-preview") setMeetingModalView(false);
        if (action === "meeting-edit") setMeetingModalView(true);
      };
      $("historyModalBody").oninput = (e) => {
        if (e.target.closest("[data-meeting-editor]")) updateMeetingModalPreview();
      };
      $("historyModalActions").onclick = async (e) => {
        const action = e.target.closest("[data-modal-action]")?.dataset.modalAction;
        if (action === "report-one") downloadHistoryReport([item], "pdf");
        if (action === "copy-meeting") {
          try {
            await navigator.clipboard.writeText(meetingMarkdownFromModal());
            $("historyStatus").textContent = "회의록을 복사했습니다.";
            $("historyStatus").classList.remove("danger");
          } catch {
            $("historyStatus").textContent = "복사 실패 — 편집 영역에서 직접 선택해 복사하세요.";
            $("historyStatus").classList.add("danger");
          }
        }
        if (action === "download-meeting") {
          const md = meetingMarkdownFromModal();
          if (md) downloadMarkdownText(md, item.title, item.date);
          else if (window.downloadMeeting) window.downloadMeeting(item.id, item.title);
        }
        if (action === "pdf-meeting") printMarkdownAsPdf(meetingMarkdownFromModal() || detail.markdown || "", item.title);
        if (action === "delete-history") await deleteHistory(item, e.target.closest("[data-modal-action]"));
      };
    } catch (err) {
      $("historyModalBody").innerHTML = `<p class="hint danger">상세 불러오기 실패: ${esc(err.message)}</p>`;
    }
  }

  function closeHistoryModal() {
    $("historyModal").hidden = true;
    $("historyModalBackdrop").hidden = true;
    document.body.classList.remove("modal-open");
  }

  function onHistoryClick(e) {
    const actionEl = e.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === "select") return;
    const item = findHistoryItem(actionEl);
    if (!item) return;

    if (action === "favorite") {
      actionEl.disabled = true;
      patchHistory(item, { favorite: !item.favorite }).catch((err) => {
        $("historyStatus").textContent = "저장 실패: " + err.message;
        $("historyStatus").classList.add("danger");
      });
      return;
    }

    if (action === "add-tag") {
      const input = actionEl.closest(".history-item").querySelector("[data-tag-input]");
      const tag = input.value.trim();
      if (!tag) return;
      input.value = "";
      patchHistory(item, { tags: uniqueTags(item.custom_tags || [], [tag]), favorite: item.favorite }).catch((err) => {
        $("historyStatus").textContent = "태그 저장 실패: " + err.message;
        $("historyStatus").classList.add("danger");
      });
      return;
    }

    if (action === "remove-tag") {
      const tag = actionEl.dataset.tag;
      patchHistory(item, { tags: (item.custom_tags || []).filter((t) => t !== tag), favorite: item.favorite }).catch((err) => {
        $("historyStatus").textContent = "태그 삭제 실패: " + err.message;
        $("historyStatus").classList.add("danger");
      });
      return;
    }

    if (action === "detail") {
      openHistoryDetail(item);
      return;
    }

    if (action === "delete") {
      deleteHistory(item, actionEl);
      return;
    }

    if (action === "reopen-analysis") {
      location.href = analysisHref(item);
      return;
    }

    if (action === "download-meeting" && (window.downloadMeetingPdf || window.downloadMeeting)) {
      actionEl.disabled = true;
      (window.downloadMeetingPdf || window.downloadMeeting)(item.id, item.title).finally(() => { actionEl.disabled = false; });
      return;
    }

    if (action === "pdf-meeting") {
      actionEl.disabled = true;
      fetchHistoryDetail(item)
        .then((detail) => printMarkdownAsPdf(displayText(detail.markdown, ""), item.title))
        .catch((err) => {
          $("historyStatus").textContent = "PDF 준비 실패: " + err.message;
          $("historyStatus").classList.add("danger");
        })
        .finally(() => { actionEl.disabled = false; });
    }
  }

  function onHistoryChange(e) {
    const input = e.target.closest('[data-action="select"]');
    if (!input) return;
    const item = findHistoryItem(input);
    if (!item) return;
    if (input.checked) selectedHistory.add(keyOf(item));
    else selectedHistory.delete(keyOf(item));
    renderHistory();
  }

  function initScheduleControls() {
    $("btnReloadSchedule")?.addEventListener("click", () => loadScheduleData(true));
    $("tabSchedule")?.addEventListener("click", onScheduleClick);
    $("scheduleProject")?.addEventListener("change", (event) => {
      scheduleProject = event.target.value;
      renderSchedule();
    });
    $("scheduleRepository")?.addEventListener("change", (event) => {
      scheduleRepository = event.target.value;
      renderSchedule();
    });
    $("scheduleDayModal")?.addEventListener("click", onScheduleClick);
    $("btnCloseScheduleDayModal")?.addEventListener("click", closeScheduleDayModal);
    $("scheduleDayModalBackdrop")?.addEventListener("click", closeScheduleDayModal);
    $("scheduleBoardFold")?.addEventListener("toggle", (event) => {
      scheduleBoardOpen = !!event.currentTarget.open;
      updateScheduleBoardSummary();
    });
    $("btnCloseScheduleModal")?.addEventListener("click", closeScheduleFeedbackModal);
    $("scheduleModalBackdrop")?.addEventListener("click", closeScheduleFeedbackModal);
    $("btnScheduleSubmit")?.addEventListener("click", submitScheduleFeedback);
    $("btnScheduleUpload")?.addEventListener("click", () => uploadScheduleFiles(false));
    $("btnScheduleCopy")?.addEventListener("click", copyScheduleFeedbackBody);
    $("btnScheduleReloadAssets")?.addEventListener("click", () => loadScheduleAssets(true));
    $("scheduleIssueNumber")?.addEventListener("change", () => loadScheduleAssets(true));
  }

  function latestTime(item) {
    return item.latest_activity_at || item.updated_at || item.created_at || item.date || "";
  }

  function daysSince(value) {
    if (!value) return 999;
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return 999;
    return Math.max(0, Math.floor((Date.now() - time) / 86400000));
  }

  function scheduleText(item) {
    return [
      item.title, item.project, item.subject, item.source,
      ...(item.tags || []), ...historyTags(item), ...(item.file_names || []),
    ].join(" ");
  }

  function scheduleMeta(item) {
    const text = scheduleText(item);
    const age = daysSince(latestTime(item));
    const done = item.kind === "analysis" && !!item.latest_output_at;
    const important = !!item.favorite || item.kind === "analysis" || /원가|비용|수문|분석|보고서|정책|산업|계산|법령|근거|검증/i.test(text);
    const urgent = age <= 3 || /긴급|오늘|이번 주|검토|확인|입력|마감|즉시|필요/i.test(text);
    const unclassified = !done && item.kind === "meeting" && !item.favorite && !(item.tags || []).length;
    const quadrant = done ? "done" : unclassified ? "unclassified" : important && urgent ? "q1" : important ? "q2" : urgent ? "q3" : "q4";
    const lane = done ? "done" : urgent ? "doing" : "next";
    const status = done ? "완료" : urgent ? "확인 중" : "다음";
    const progress = done ? "완료" : item.kind === "analysis" ? `${item.file_count || 0}개 자료` : "회의록";
    return { item, age, important, urgent, done, unclassified, quadrant, lane, status, progress };
  }

  function scheduleItems() {
    return historyItems
      .slice()
      .sort((a, b) => String(latestTime(b)).localeCompare(String(latestTime(a))))
      .slice(0, SCHEDULE_LIMIT)
      .map(scheduleMeta);
  }

  function startOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d;
  }

  function isThisWeek(item) {
    const raw = latestTime(item);
    if (!raw) return false;
    const time = new Date(raw);
    if (!Number.isFinite(time.getTime())) return false;
    return time >= startOfWeek(new Date());
  }

  function scheduleKindLabel(item) {
    return item.kind === "analysis" ? "분석설계" : "회의록";
  }

  function scheduleDetail(item) {
    const fileText = item.file_names?.length ? item.file_names.slice(0, 2).join(", ") : "";
    const parts = [
      scheduleKindLabel(item),
      fmtDate(item.date || item.created_at),
      item.project && item.project !== item.title ? item.project : "",
      fileText,
    ].filter(Boolean);
    return parts.join(" · ");
  }

  function scheduleDataAttrs(item) {
    return `data-schedule-kind="${esc(item.kind)}" data-schedule-id="${esc(item.id)}"`;
  }

  function scheduleChip(meta) {
    const item = meta.item;
    return `<button class="schedule-chip ${meta.quadrant}" type="button" data-schedule-action="detail" ${scheduleDataAttrs(item)} title="${esc(scheduleDetail(item))}">
      <span>${esc(item.title || "업무")}</span><small>${esc(scheduleKindLabel(item))}</small>
    </button>`;
  }

  function scheduleCard(meta, compact = false) {
    const item = meta.item;
    const tags = historyTagChips(item, { limit: compact ? 2 : 4 });
    const action = item.kind === "analysis"
      ? `<a class="btn btn-ghost btn-small" href="/analysis-edit2/?session=${encodeURIComponent(item.id)}">열기</a>`
      : `<button class="btn btn-ghost btn-small" type="button" data-schedule-action="download-meeting" ${scheduleDataAttrs(item)}>PDF</button>`;
    const feedbackAction = canUseGitHubFeatures
      ? `<button class="btn btn-ghost btn-small" type="button" data-schedule-action="feedback" ${scheduleDataAttrs(item)}>피드백</button>`
      : "";
    return `<article class="schedule-task-card ${meta.lane}" ${scheduleDataAttrs(item)}>
      <div class="schedule-card-top">
        <span class="schedule-state ${meta.lane}">${esc(meta.status)}</span>
        <span class="schedule-date">${esc(fmtDate(latestTime(item)))}</span>
      </div>
      <h4>${esc(item.title || "업무")}</h4>
      <p>${esc(scheduleDetail(item) || "마이페이지 히스토리에서 자동 구성")}</p>
      <div class="schedule-card-tags">${tags || `<span class="hint">태그 없음</span>`}</div>
      <div class="schedule-card-actions">
        <button class="btn btn-primary btn-small" type="button" data-schedule-action="detail" ${scheduleDataAttrs(item)}>상세</button>
        ${feedbackAction}
        ${action}
      </div>
    </article>`;
  }

  function updateScheduleBoardSummary() {
    const fold = $("scheduleBoardFold");
    const summary = $("scheduleBoardSummary");
    if (!summary) return;
    const counts = `다음 ${scheduleBoardCounts.next} · 확인 ${scheduleBoardCounts.doing} · 완료 ${scheduleBoardCounts.done}`;
    summary.textContent = fold?.open ? `칸반 접기 · ${counts}` : `칸반 열기 · ${counts}`;
  }

  function setScheduleBoardOpen(open) {
    const fold = $("scheduleBoardFold");
    if (!fold) return;
    fold.open = !!open;
    scheduleBoardOpen = !!open;
    updateScheduleBoardSummary();
  }

  function scheduleWeekRow(meta) {
    const item = meta.item;
    const tags = historyTagChips(item, { limit: 6 });
    const action = item.kind === "analysis"
      ? `<a class="btn btn-ghost btn-small" href="/analysis-edit2/?session=${encodeURIComponent(item.id)}">열기</a>`
      : `<button class="btn btn-ghost btn-small" type="button" data-schedule-action="download-meeting" ${scheduleDataAttrs(item)}>PDF</button>`;
    const feedbackAction = canUseGitHubFeatures
      ? `<button class="btn btn-ghost btn-small" type="button" data-schedule-action="feedback" ${scheduleDataAttrs(item)}>피드백</button>`
      : "";
    return `<article class="schedule-week-row is-${meta.lane}" data-schedule-action="toggle-board" ${scheduleDataAttrs(item)} title="목록을 누르면 아래 칸반이 펼쳐집니다.">
      <span class="schedule-row-check" aria-hidden="true"></span>
      <div class="schedule-row-main">
        <div class="schedule-card-top">
          <span class="schedule-state ${meta.lane}">${esc(meta.status)}</span>
          <span class="schedule-date">${esc(fmtDate(latestTime(item)))}</span>
        </div>
        <h4>${esc(item.title || "업무")}</h4>
        <p>${esc(scheduleDetail(item) || "마이페이지 히스토리에서 자동 구성")}</p>
        <div class="schedule-card-tags">${tags || `<span class="hint">태그 없음</span>`}</div>
      </div>
      <div class="schedule-card-actions">
        <button class="btn btn-primary btn-small" type="button" data-schedule-action="detail" ${scheduleDataAttrs(item)}>상세</button>
        ${feedbackAction}
        ${action}
      </div>
    </article>`;
  }

  function renderScheduleMatrix(items) {
    renderKanbanMatrix(items);
  }

  function renderScheduleBoard(items) {
    const board = $("scheduleBoard");
    if (!board) return;
    scheduleBoardCounts = {
      next: items.filter((meta) => meta.lane === "next").length,
      doing: items.filter((meta) => meta.lane === "doing").length,
      done: items.filter((meta) => meta.lane === "done").length,
    };
    const lanes = [
      ["next", "다음에 할 일", "아직 시작하지 않았지만 다음으로 진행할 일"],
      ["doing", "지금 하는 중", "현재 확인하거나 진행하고 있는 일"],
      ["done", "끝난 일", "결과나 산출물이 만들어진 일"],
    ];
    board.innerHTML = lanes.map(([key, title, help]) => {
      const cards = items.filter((meta) => meta.lane === key).slice(0, 4).map((meta) => scheduleCard(meta, true)).join("");
      return `<section class="schedule-lane ${key}">
        <div class="schedule-lane-head"><h4>${title}</h4><span>${items.filter((meta) => meta.lane === key).length}</span></div>
        <p class="hint">${help}</p>
        <div class="schedule-lane-list">${cards || `<p class="hint">표시할 항목이 없습니다.</p>`}</div>
      </section>`;
    }).join("");
    setScheduleBoardOpen(scheduleBoardOpen);
  }

  function renderScheduleWeek(items) {
    const week = $("scheduleWeek");
    if (!week) return;
    const weekly = items.filter((meta) => isThisWeek(meta.item)).slice(0, 14);
    const source = weekly.length ? weekly : items.slice(0, 14);
    week.classList.add("schedule-week-list");
    week.innerHTML = source.map(scheduleWeekRow).join("") || `<p class="hint">이번 주 진행 항목이 아직 없습니다.</p>`;
  }

  function renderScheduleTodo(items) {
    const todo = $("scheduleTodo");
    if (!todo) return;
    const openItems = items.filter((meta) => !meta.done).slice(0, 8);
    const doneItems = items.filter((meta) => meta.done).slice(0, 8);
    const openHtml = openItems.map((meta) => scheduleCard(meta)).join("") || `<p class="hint">열린 자동 Todo 후보가 없습니다.</p>`;
    const doneHtml = doneItems.length
      ? `<details class="schedule-done-fold"><summary>완료된 항목 ${doneItems.length}개</summary><div class="schedule-todo-grid">${doneItems.map((meta) => scheduleCard(meta, true)).join("")}</div></details>`
      : "";
    todo.innerHTML = `<div class="schedule-todo-grid">${openHtml}</div>${doneHtml}`;
  }

  function renderLegacySchedule() {
    const status = $("scheduleStatus");
    if (!status) return;
    if (!historyLoaded) {
      status.textContent = "스케줄 데이터를 불러오는 중...";
      return;
    }
    const items = scheduleItems();
    status.classList.remove("danger");
    status.textContent = `${items.length}개 히스토리 기준 · 마지막 갱신 ${new Date().toLocaleString("ko-KR")}`;
    if (!items.length) {
      const linkBox = $("scheduleAccountLink");
      const canLinkExistingAccount = authProvider === "google" || authProvider === "kakao";
      if (linkBox) {
        linkBox.hidden = !canLinkExistingAccount;
        linkBox.innerHTML = canLinkExistingAccount
          ? `<div class="panel"><strong>이 계정에는 아직 이력이 없습니다.</strong><p class="hint">기존 GitHub 계정에 회의록·스케줄·칸반이 있다면 기존 계정을 연결하세요.</p><a class="btn btn-primary btn-small" href="/api/auth/github">기존 GitHub 계정으로 로그인해 연결</a></div>`
          : "";
      }
      renderKanbanMatrix([]);
      $("scheduleBoard").innerHTML = "";
      scheduleBoardCounts = { next: 0, doing: 0, done: 0 };
      setScheduleBoardOpen(false);
      return;
    }
    if ($("scheduleAccountLink")) $("scheduleAccountLink").hidden = true;
    renderScheduleMatrix(items);
    renderScheduleBoard(items);
  }

  function scheduleDate(key) {
    return new Date(`${key}T00:00:00Z`);
  }

  function scheduleDateKey(date) {
    return date.toISOString().slice(0, 10);
  }

  function scheduleAddDays(key, amount) {
    const date = scheduleDate(key);
    date.setUTCDate(date.getUTCDate() + amount);
    return scheduleDateKey(date);
  }

  function scheduleStartOfWeek(key) {
    const date = scheduleDate(key);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    return scheduleDateKey(date);
  }

  function scheduleZonedParts(value) {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: scheduleTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).reduce((out, part) => {
      if (part.type !== "literal") out[part.type] = part.value;
      return out;
    }, {});
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
      minutes: Number(parts.hour) * 60 + Number(parts.minute),
    };
  }

  function scheduleToday() {
    return scheduleZonedParts(scheduleServerNow)?.date || "";
  }

  function scheduleVisibleRange() {
    const cursor = scheduleCursor || scheduleToday();
    if (!cursor) return null;
    if (scheduleView === "week") {
      const from = scheduleStartOfWeek(cursor);
      return { from, to: scheduleAddDays(from, 6) };
    }
    const first = `${cursor.slice(0, 7)}-01`;
    const from = scheduleStartOfWeek(first);
    return { from, to: scheduleAddDays(from, 41) };
  }

  async function loadScheduleData(force) {
    if (!historyLoaded || force) await loadHistory(!!force);
    await Promise.all([
      loadScheduleRange(!!force),
      loadScheduleGithubItems(!!force),
    ]);
  }

  async function loadScheduleRange(force) {
    const range = scheduleVisibleRange();
    if (!range) return;
    const key = `${range.from}:${range.to}`;
    if (!force && scheduleLoadedRange === key) {
      renderSchedule();
      return;
    }
    scheduleBlocksLoading = true;
    renderSchedule();
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      const res = await window.apiFetch(`/api/time-blocks?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      scheduleBlocks = (data.days || []).flatMap((day) => (
        (day.blocks || []).map((block) => ({ ...block, date: day.date }))
      ));
      if (data.server_now) scheduleServerNow = data.server_now;
      if (data.timezone) scheduleTimezone = data.timezone;
      if (!scheduleCursor) scheduleCursor = scheduleToday();
      scheduleLoadedRange = key;
      scheduleBlocksLoading = false;
      renderSchedule();
    } catch (err) {
      scheduleBlocksLoading = false;
      const status = $("scheduleStatus");
      if (status) {
        status.textContent = `시간 블록을 불러오지 못했습니다: ${err.message}`;
        status.classList.add("danger");
      }
    }
  }

  async function loadScheduleGithubItems(force) {
    if (scheduleGithubLoaded && !force) return;
    scheduleGithubLoadError = "";
    try {
      const res = await window.apiFetch("/api/schedule/github-items");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      scheduleSources = data.sources || [];
      scheduleGithubItems = data.items || [];
      if (data.server_now) scheduleServerNow = data.server_now;
      scheduleGithubLoaded = true;
      renderSchedule();
      renderKanbanMatrix();
    } catch (err) {
      scheduleGithubLoadError = err.message;
      scheduleGithubItems = [];
      scheduleGithubLoaded = true;
      renderSchedule();
      renderKanbanMatrix();
    }
  }

  function scheduleClock() {
    return scheduleZonedParts(scheduleServerNow);
  }

  function scheduleBlockPhase(block) {
    const clock = scheduleClock();
    if (!clock) return "upcoming";
    if (block.date < clock.date) return "past";
    if (block.date > clock.date) return "upcoming";
    const start = Number(block.start_time.slice(0, 2)) * 60 + Number(block.start_time.slice(3, 5));
    const end = Number(block.end_time.slice(0, 2)) * 60 + Number(block.end_time.slice(3, 5));
    if (clock.minutes >= end) return "past";
    if (clock.minutes >= start) return "active";
    return "upcoming";
  }

  function scheduleHistoryEvent(item) {
    const raw = item.date || latestTime(item);
    const explicitDate = /^\d{4}-\d{2}-\d{2}/.test(String(raw || "")) ? String(raw).slice(0, 10) : "";
    const parts = scheduleZonedParts(latestTime(item));
    return {
      key: `history:${item.kind}:${item.id}`,
      source: "history",
      item,
      date: explicitDate || parts?.date || "",
      start: String(raw || "").includes("T") ? (scheduleZonedParts(raw)?.time || "") : (parts?.time || ""),
      end: "",
      kind: "history",
      phase: "past",
      title: item.title || (item.kind === "analysis" ? "분석설계" : "회의록"),
      note: scheduleDetail(item),
      project: item.project || "",
      tags: item.tags || [],
    };
  }

  function scheduleBlockEvent(block) {
    return {
      key: `block:${block.id}:${block.date}`,
      source: "block",
      block,
      date: block.date,
      start: block.start_time,
      end: block.end_time,
      kind: block.kind,
      phase: scheduleBlockPhase(block),
      title: block.note || ({
        available: "가능 시간",
        busy: "바쁜 시간",
        focus: "집중 시간",
        meeting: "회의",
      }[block.kind] || "시간 블록"),
      note: block.source === "rule" ? "반복 시간 블록" : "시간 설정에서 등록한 블록",
      project: "",
      tags: [],
    };
  }

  function scheduleGithubEvent(item) {
    const closed = item.state === "closed" || item.state === "merged";
    // due date 필드가 없는 이슈·PR 은 생성일 기준으로 달력에 올린다.
    const createdDate = item.created_at
      ? (scheduleZonedParts(item.created_at)?.date || String(item.created_at).slice(0, 10))
      : "";
    return {
      key: `github:${item.project_id}:${item.repo}:${item.number}`,
      source: "github",
      item,
      date: item.due_date || createdDate,
      start: "",
      end: "",
      kind: "github",
      phase: closed || (item.due_date && item.due_date < scheduleToday()) ? "past" : "upcoming",
      title: item.title,
      note: `${item.repo}#${item.number}${!item.due_date && createdDate ? ` · 생성 ${createdDate}` : ""}`,
      project: item.project_title || item.repo,
      repository: item.repo || "",
      tags: item.labels || [],
      url: item.url,
    };
  }

  function scheduleEvents() {
    const range = scheduleVisibleRange();
    if (!range) return [];
    return [
      ...scheduleBlocks.map(scheduleBlockEvent),
      ...historyItems.map(scheduleHistoryEvent),
      ...scheduleGithubItems.map(scheduleGithubEvent),
    ].filter((event) => event.date && event.date >= range.from && event.date <= range.to)
      .sort((a, b) => (
        a.date === b.date
          ? `${a.start || "99:99"}:${a.title}`.localeCompare(`${b.start || "99:99"}:${b.title}`, "ko")
          : a.date.localeCompare(b.date)
      ));
  }

  function schedulePhaseLabel(event) {
    if (event.source === "history") return "완료 기록";
    if (event.phase === "active") return "진행 중";
    return event.phase === "past" ? "지난 블록" : "예정";
  }

  function scheduleKindLabelV2(kind) {
    return ({
      all: "전체",
      available: "가능",
      busy: "바쁨",
      focus: "집중",
      meeting: "회의",
      history: "완료 기록",
      github: "GitHub",
    })[kind] || kind;
  }

  function scheduleFilteredEvents() {
    const visibleEvents = scheduleEvents();
    const includeUndatedGithub = !scheduleSelectedDate
      && (scheduleKind === "github" || scheduleRepository !== "all");
    const undatedGithub = includeUndatedGithub
      ? scheduleGithubItems.map(scheduleGithubEvent).filter((event) => !event.date)
      : [];
    return [...visibleEvents, ...undatedGithub].filter((event) => {
      const inTab = scheduleTab === "upcoming" ? event.phase !== "past" : event.phase === "past";
      const kind = scheduleKind === "all" || event.kind === scheduleKind;
      const project = scheduleProject === "all"
        || (scheduleProject === "none" ? !event.project : event.project === scheduleProject);
      const repository = scheduleRepository === "all"
        || (event.source === "github" && event.repository === scheduleRepository);
      const date = !scheduleSelectedDate || event.date === scheduleSelectedDate;
      return inTab && kind && project && repository && date;
    }).sort((a, b) => {
      if (!a.date && b.date) return 1;
      if (a.date && !b.date) return -1;
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return `${a.start || "99:99"}:${a.title}`.localeCompare(`${b.start || "99:99"}:${b.title}`, "ko");
    });
  }

  function scheduleFormatDate(key, long = false) {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "UTC",
      month: long ? "long" : "short",
      day: "numeric",
      weekday: "short",
    }).format(scheduleDate(key));
  }

  function renderScheduleSummary(events) {
    const host = $("scheduleSummary");
    if (!host) return;
    const today = scheduleToday();
    const upcoming = events.filter((event) => event.phase !== "past").length;
    const active = events.filter((event) => event.phase === "active").length;
    const todayCount = events.filter((event) => event.date === today).length;
    const historyCount = events.filter((event) => event.source === "history").length;
    host.innerHTML = [
      ["현재 범위 예정", upcoming],
      ["진행 중", active],
      ["오늘", todayCount],
      ["완료 기록", historyCount],
    ].map(([label, value]) => `<div class="schedule-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  }

  function renderScheduleCalendar(events) {
    const host = $("scheduleCalendar");
    const title = $("scheduleCalendarTitle");
    if (!host || !title) return;
    const range = scheduleVisibleRange();
    if (!range) return;
    const cursor = scheduleDate(scheduleCursor);
    title.textContent = scheduleView === "week"
      ? `${scheduleFormatDate(range.from, true)} – ${scheduleFormatDate(range.to, true)}`
      : new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", year: "numeric", month: "long" }).format(cursor);
    const eventsByDate = events.reduce((map, event) => {
      (map[event.date] ||= []).push(event);
      return map;
    }, {});
    const days = [];
    for (let date = range.from; date <= range.to; date = scheduleAddDays(date, 1)) days.push(date);
    const weekdays = scheduleView === "month"
      ? `<div class="schedule-calendar-weekdays">${["월", "화", "수", "목", "금", "토", "일"].map((day) => `<span>${day}</span>`).join("")}</div>`
      : "";
    host.innerHTML = weekdays + `<div class="schedule-calendar-grid is-${scheduleView}">${days.map((date) => {
      const outside = scheduleView === "month" && date.slice(0, 7) !== scheduleCursor.slice(0, 7);
      const selected = scheduleSelectedDate === date;
      const today = scheduleToday() === date;
      const dayEvents = eventsByDate[date] || [];
      const previews = scheduleView === "month" && dayEvents.length
        ? `<span class="schedule-day-previews">${dayEvents.slice(0, 2).map((event) => (
            `<span class="schedule-day-preview is-${esc(event.source)}" title="${attr(event.title)}">${esc(event.title)}</span>`
          )).join("")}${dayEvents.length > 2 ? `<span class="schedule-day-more">외 ${dayEvents.length - 2}개</span>` : ""}</span>`
        : "";
      return `<button type="button" class="schedule-day${outside ? " is-outside" : ""}${selected ? " is-selected" : ""}${today ? " is-today" : ""}" data-schedule-date="${date}" aria-pressed="${selected ? "true" : "false"}">
        <span class="schedule-day-number">${scheduleView === "week" ? scheduleFormatDate(date) : Number(date.slice(8))}</span>
        ${previews}
        <small class="schedule-day-count">${dayEvents.length ? `${dayEvents.length}개` : "일정 없음"}</small>
      </button>`;
    }).join("")}</div>`;
  }

  function renderScheduleFilters(events) {
    const project = $("scheduleProject");
    if (project) {
      const projects = Array.from(new Set([
        ...events.map((event) => event.project),
        ...scheduleGithubItems.map((item) => item.project_title || item.repo),
      ].filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
      project.innerHTML = `<option value="all">전체 프로젝트</option><option value="none">프로젝트 없음</option>` +
        projects.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
      if ([...project.options].some((option) => option.value === scheduleProject)) project.value = scheduleProject;
      else scheduleProject = "all";
    }
    const repository = $("scheduleRepository");
    if (repository) {
      const repositories = Array.from(new Set([
        ...scheduleSources.map((source) => source.repo),
        ...scheduleGithubItems.map((item) => item.repo),
      ].filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
      repository.innerHTML = `<option value="all">전체 Repository</option>` +
        repositories.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
      if ([...repository.options].some((option) => option.value === scheduleRepository)) repository.value = scheduleRepository;
      else scheduleRepository = "all";
    }
    document.querySelectorAll("[data-schedule-kind]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.scheduleKind === scheduleKind);
      button.setAttribute("aria-pressed", button.dataset.scheduleKind === scheduleKind ? "true" : "false");
    });
    document.querySelectorAll("[data-schedule-tab]").forEach((button) => {
      const active = button.dataset.scheduleTab === scheduleTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-schedule-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.scheduleView === scheduleView);
    });
    const summary = $("scheduleFilterSummary");
    if (summary) {
      const values = [
        scheduleKind !== "all" ? scheduleKindLabelV2(scheduleKind) : "",
        scheduleProject !== "all" ? (scheduleProject === "none" ? "프로젝트 없음" : scheduleProject) : "",
        scheduleRepository !== "all" ? scheduleRepository : "",
        scheduleSelectedDate ? scheduleFormatDate(scheduleSelectedDate) : "",
      ].filter(Boolean);
      summary.textContent = values.length ? values.join(" · ") : "전체 유형 · 전체 프로젝트 · 전체 Repository · 날짜 전체";
    }
  }

  function openScheduleDayModal(date) {
    const modal = $("scheduleDayModal");
    const backdrop = $("scheduleDayModalBackdrop");
    const title = $("scheduleDayModalTitle");
    const body = $("scheduleDayModalBody");
    if (!modal || !backdrop || !title || !body) return;
    const events = scheduleEvents().filter((event) => event.date === date);
    title.textContent = scheduleFormatDate(date, true);
    body.innerHTML = events.length
      ? `<p class="hint schedule-day-modal-summary">이날 일정 ${events.length}개</p>${events.map(scheduleEventCard).join("")}`
      : '<div class="schedule-empty"><strong>이날 일정이 없어요</strong><p>다른 날짜를 선택해 주세요.</p></div>';
    backdrop.hidden = false;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    modal.focus();
  }

  function closeScheduleDayModal() {
    const modal = $("scheduleDayModal");
    const backdrop = $("scheduleDayModalBackdrop");
    if (modal) modal.hidden = true;
    if (backdrop) backdrop.hidden = true;
    if ($("historyModal")?.hidden !== false && $("scheduleModal")?.hidden !== false) {
      document.body.classList.remove("modal-open");
    }
  }

  function scheduleEventCard(event) {
    const time = event.start ? `${event.start}${event.end ? `–${event.end}` : ""}` : "시간 미지정";
    const subtitle = event.source === "github"
      ? [event.project, event.note].filter(Boolean).join(" · ")
      : event.project || event.note || scheduleKindLabelV2(event.kind);
    const tags = event.source === "history"
      ? historyTagChips(event.item, { limit: 6 })
      : event.source === "github"
        ? (event.tags || []).slice(0, 6).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")
        : `<span class="tag">${esc(scheduleKindLabelV2(event.kind))}</span>${event.block.source === "rule" ? '<span class="tag">반복</span>' : ""}`;
    let actions = "";
    if (event.source === "history") {
      const item = event.item;
      actions = `<button class="btn btn-primary btn-small" type="button" data-schedule-action="detail" ${scheduleDataAttrs(item)}>상세</button>` +
        (item.kind === "analysis"
          ? `<a class="btn btn-ghost btn-small" href="/analysis-edit2/?session=${encodeURIComponent(item.id)}">열기</a>`
          : `<button class="btn btn-ghost btn-small" type="button" data-schedule-action="download-meeting" ${scheduleDataAttrs(item)}>PDF</button>`) +
        `<button class="btn btn-danger btn-small" type="button" data-schedule-action="delete-history" ${scheduleDataAttrs(item)}>삭제</button>`;
    } else if (event.source === "github") {
      actions = `<a class="btn btn-primary btn-small" href="${attr(event.url)}" target="_blank" rel="noopener">GitHub에서 열기</a>` +
        (event.item.kind === "issue" && event.item.state !== "closed"
          ? `<button class="btn btn-danger btn-small" type="button" data-schedule-action="close-github" data-github-repo="${attr(event.item.repo)}" data-github-number="${event.item.number}">이슈 닫기</button>`
          : "");
    } else {
      actions = '<a class="btn btn-ghost btn-small" href="/time-settings/">시간 블록 관리</a>' +
        `<button class="btn btn-danger btn-small" type="button" data-schedule-action="delete-block" data-block-id="${attr(event.block.id)}" data-block-date="${attr(event.date)}" data-block-source="${attr(event.block.source || "block")}">삭제</button>`;
    }
    return `<details class="schedule-event-card is-${event.phase}">
      <summary>
        <span class="schedule-event-time">${esc(time)}</span>
        <span class="schedule-event-main"><strong>${esc(event.title)}</strong><small>${esc(subtitle)}</small></span>
        <span class="schedule-event-badge">${esc(schedulePhaseLabel(event))}</span>
      </summary>
      <div class="schedule-event-detail">
        <div class="schedule-card-tags">${tags || '<span class="hint">태그 없음</span>'}</div>
        <div class="schedule-card-actions">${actions}</div>
      </div>
    </details>`;
  }

  function renderScheduleTimeline() {
    const host = $("scheduleTimeline");
    if (!host) return;
    const events = scheduleFilteredEvents();
    if (!events.length) {
      const filtered = scheduleKind !== "all" || scheduleProject !== "all" || scheduleRepository !== "all" || scheduleSelectedDate;
      const title = filtered
        ? "조건에 맞는 일정이 없어요"
        : scheduleTab === "upcoming" ? "예정된 일정이 없어요" : "지난 일정이 없어요";
      const description = filtered
        ? "날짜나 필터를 지우면 다른 일정을 확인할 수 있어요."
        : scheduleTab === "upcoming"
          ? "시간 설정에서 가능·집중·회의 블록을 추가하면 여기에 표시됩니다."
          : "완료된 시간 블록과 히스토리가 생기면 여기에 쌓입니다.";
      host.innerHTML = `<div class="schedule-empty"><strong>${title}</strong><p>${description}</p>${
        filtered
          ? '<button class="btn btn-ghost btn-small" type="button" data-schedule-clear>필터 초기화</button>'
          : scheduleTab === "upcoming" ? '<a class="btn btn-primary btn-small" href="/time-settings/">시간 블록 추가</a>' : ""
      }</div>`;
      return;
    }
    let current = null;
    host.innerHTML = events.map((event) => {
      const headerLabel = event.date
        ? `${scheduleFormatDate(event.date, true)}${event.date === scheduleToday() ? " · 오늘" : ""}`
        : "날짜 미지정";
      const header = event.date === current ? "" : `<h3 class="schedule-date-heading">${headerLabel}</h3>`;
      current = event.date;
      return header + scheduleEventCard(event);
    }).join("");
  }

  function renderSchedule() {
    const status = $("scheduleStatus");
    if (!status) return;
    if (!historyLoaded || scheduleBlocksLoading) {
      status.textContent = "스케줄 데이터를 불러오는 중...";
      status.classList.remove("danger");
      return;
    }
    if (historyLoadError) {
      status.textContent = `히스토리를 불러오지 못했습니다: ${historyLoadError}`;
      status.classList.add("danger");
      return;
    }
    const clock = scheduleClock();
    status.classList.remove("danger");
    const baseStatus = clock
      ? `서버 기준 ${scheduleFormatDate(clock.date, true)} ${clock.time} · ${scheduleTimezone}`
      : "서버 시간을 확인하는 중...";
    status.textContent = scheduleGithubLoadError
      ? `${baseStatus} · GitHub Project: ${scheduleGithubLoadError}`
      : `${baseStatus} · GitHub Project ${scheduleSources.length}개 연결`;
    const events = scheduleEvents();
    renderScheduleSummary(events);
    renderScheduleCalendar(events);
    renderScheduleFilters(events);
    renderScheduleTimeline();
  }

  function findScheduleItem(el) {
    const target = el.closest("[data-schedule-kind][data-schedule-id]");
    if (!target) return null;
    return historyItems.find((item) => item.kind === target.dataset.scheduleKind && item.id === target.dataset.scheduleId) || null;
  }

  function onScheduleClick(e) {
    const control = e.target.closest("[data-schedule-view], [data-schedule-nav], [data-schedule-tab], [data-schedule-kind], [data-schedule-date], [data-schedule-clear]");
    if (control) {
      if (control.dataset.scheduleView) {
        scheduleView = control.dataset.scheduleView;
        scheduleCursor = scheduleSelectedDate || scheduleCursor || scheduleToday();
        scheduleLoadedRange = "";
        loadScheduleRange(false);
        return;
      }
      if (control.dataset.scheduleNav) {
        const direction = control.dataset.scheduleNav;
        if (direction === "today") {
          scheduleCursor = scheduleToday();
          scheduleSelectedDate = "";
        } else if (scheduleView === "week") {
          scheduleCursor = scheduleAddDays(scheduleCursor, direction === "next" ? 7 : -7);
        } else {
          const cursor = scheduleDate(`${scheduleCursor.slice(0, 7)}-01`);
          cursor.setUTCMonth(cursor.getUTCMonth() + (direction === "next" ? 1 : -1));
          scheduleCursor = scheduleDateKey(cursor);
        }
        scheduleLoadedRange = "";
        loadScheduleRange(false);
        return;
      }
      if (control.dataset.scheduleTab) {
        scheduleTab = control.dataset.scheduleTab;
        renderSchedule();
        return;
      }
      if (control.dataset.scheduleKind) {
        scheduleKind = control.dataset.scheduleKind;
        renderSchedule();
        return;
      }
      if (control.dataset.scheduleDate) {
        if (scheduleView === "month") {
          openScheduleDayModal(control.dataset.scheduleDate);
          return;
        }
        scheduleSelectedDate = scheduleSelectedDate === control.dataset.scheduleDate ? "" : control.dataset.scheduleDate;
        renderSchedule();
        return;
      }
      if (control.hasAttribute("data-schedule-clear")) {
        scheduleKind = "all";
        scheduleProject = "all";
        scheduleRepository = "all";
        scheduleSelectedDate = "";
        renderSchedule();
        return;
      }
    }
    const actionEl = e.target.closest("[data-schedule-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.scheduleAction;
    if (action === "toggle-board") {
      if (e.target.closest("button, a, input, select, textarea")) return;
      setScheduleBoardOpen(!scheduleBoardOpen);
      return;
    }
    if (action === "delete-block") {
      deleteScheduleBlock(actionEl);
      return;
    }
    if (action === "close-github") {
      const githubItem = scheduleGithubItems.find((candidate) => (
        candidate.repo === actionEl.dataset.githubRepo &&
        Number(candidate.number) === Number(actionEl.dataset.githubNumber)
      ));
      if (githubItem) closeScheduleGithubItem(githubItem, actionEl, (message, danger) => {
        $("scheduleStatus").textContent = message;
        $("scheduleStatus").classList.toggle("danger", !!danger);
      });
      return;
    }
    const item = findScheduleItem(actionEl);
    if (!item) return;
    if (action === "detail") {
      closeScheduleDayModal();
      openHistoryDetail(item);
      return;
    }
    if (action === "delete-history") {
      deleteHistory(item, actionEl, (message, danger) => {
        $("scheduleStatus").textContent = message;
        $("scheduleStatus").classList.toggle("danger", !!danger);
      });
      return;
    }
    if (action === "feedback") {
      if (!canUseGitHubFeatures) return;
      openScheduleFeedbackModal(item);
      return;
    }
    if (action === "download-meeting" && (window.downloadMeetingPdf || window.downloadMeeting)) {
      actionEl.disabled = true;
      (window.downloadMeetingPdf || window.downloadMeeting)(item.id, item.title).finally(() => { actionEl.disabled = false; });
    }
  }

  async function deleteScheduleBlock(button) {
    const id = button.dataset.blockId;
    const date = button.dataset.blockDate;
    const occurrenceOnly = button.dataset.blockSource === "rule";
    const label = occurrenceOnly ? `${date} 반복 일정 한 건` : `${date} 일정`;
    if (!window.confirm(`${label}을 삭제할까요?${occurrenceOnly ? "\n반복 규칙 전체가 아니라 선택한 날짜만 제외됩니다." : ""}`)) return;
    button.disabled = true;
    try {
      const query = occurrenceOnly ? `?date=${encodeURIComponent(date)}` : "";
      const res = await window.apiFetch(`/api/time-blocks/${encodeURIComponent(id)}${query}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "일정을 찾을 수 없습니다.");
      closeScheduleDayModal();
      scheduleLoadedRange = "";
      await loadScheduleRange(true);
      $("scheduleStatus").textContent = occurrenceOnly ? "선택한 반복 일정을 제외했습니다." : "일정을 삭제했습니다.";
      $("scheduleStatus").classList.remove("danger");
    } catch (err) {
      $("scheduleStatus").textContent = "일정 삭제 실패: " + err.message;
      $("scheduleStatus").classList.add("danger");
      button.disabled = false;
    }
  }

  async function closeScheduleGithubItem(item, button, statusWriter) {
    if (!item || item.kind !== "issue") return false;
    if (!window.confirm(`${item.repo}#${item.number} 이슈를 닫을까요?\nGitHub 원격 상태가 closed로 변경됩니다.`)) return false;
    if (button) button.disabled = true;
    try {
      const res = await window.apiFetch("/api/schedule/github-items", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "issue",
          repo: item.repo,
          number: item.number,
          state: "closed",
          importance: (item.labels || []).includes("importance:high")
            ? "high"
            : (item.labels || []).includes("importance:low") ? "low" : "none",
          urgency: (item.labels || []).includes("urgency:high")
            ? "high"
            : (item.labels || []).includes("urgency:low") ? "low" : "none",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      scheduleGithubLoaded = false;
      closeScheduleDayModal();
      await loadScheduleGithubItems(true);
      statusWriter?.(`${item.repo}#${item.number} 이슈를 닫았습니다.`);
      return true;
    } catch (err) {
      statusWriter?.("GitHub 이슈 닫기 실패: " + err.message, true);
      if (button) button.disabled = false;
      return false;
    }
  }

  function scheduleFeedbackCardId(item) {
    return `history-${item.kind}-${item.id}`.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60);
  }

  function scheduleFeedbackRepo() {
    return window.__gitDefaults?.default_repo || "feed-mina/planning-harness";
  }

  function setScheduleFeedbackStatus(message, danger) {
    const el = $("scheduleModalStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("danger", !!danger);
  }

  function currentScheduleIssueNumber() {
    const raw = $("scheduleIssueNumber")?.value || "";
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function openScheduleFeedbackModal(item) {
    activeScheduleFeedbackCard = {
      id: scheduleFeedbackCardId(item),
      repo: scheduleFeedbackRepo(),
      title: displayText(item.title, "스케줄 카드"),
      issue_title: `[마이페이지 스케줄] ${displayText(item.title, "스케줄 카드")}`.slice(0, 200),
      item,
    };
    activeScheduleAssets = [];
    $("scheduleModalTitle").textContent = activeScheduleFeedbackCard.title;
    $("scheduleModalRepo").textContent = activeScheduleFeedbackCard.repo;
    $("scheduleIssueNumber").value = "";
    $("scheduleIssueTitle").value = activeScheduleFeedbackCard.issue_title;
    $("scheduleFeedbackText").value = "";
    $("scheduleFiles").value = "";
    $("scheduleAssetList").innerHTML = '<p class="hint">자료를 불러오는 중...</p>';
    setScheduleFeedbackStatus("");
    $("scheduleModal").hidden = false;
    $("scheduleModalBackdrop").hidden = false;
    document.body.classList.add("modal-open");
    loadScheduleAssets(false);
    setTimeout(() => $("scheduleFeedbackText")?.focus(), 0);
  }

  function closeScheduleFeedbackModal() {
    const modal = $("scheduleModal");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    $("scheduleModalBackdrop").hidden = true;
    activeScheduleFeedbackCard = null;
    activeScheduleAssets = [];
    document.body.classList.remove("modal-open");
  }

  function renderScheduleAssets() {
    const box = $("scheduleAssetList");
    if (!box) return;
    if (!activeScheduleAssets.length) {
      box.innerHTML = '<p class="hint">등록된 자료가 없습니다.</p>';
      return;
    }
    box.innerHTML = `<ul>${activeScheduleAssets.map((asset) => `
      <li>
        <a href="${esc(asset.download_url)}" target="_blank" rel="noreferrer">${esc(asset.name)}</a>
        <span>${esc(asset.type || "file")} · ${fmtFileSize(asset.size)} · ${fmtDate(asset.created_at)}</span>
      </li>
    `).join("")}</ul>`;
  }

  async function loadScheduleAssets(force) {
    if (!activeScheduleFeedbackCard) return;
    const params = new URLSearchParams({
      cardId: activeScheduleFeedbackCard.id,
      repo: activeScheduleFeedbackCard.repo,
    });
    const issueNumber = currentScheduleIssueNumber();
    if (issueNumber) params.set("issueNumber", String(issueNumber));
    try {
      const res = await window.apiFetch(`/api/schedule/assets?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      activeScheduleAssets = data.assets || [];
      renderScheduleAssets();
      if (force) setScheduleFeedbackStatus("자료 목록을 갱신했습니다.");
    } catch (err) {
      $("scheduleAssetList").innerHTML = `<p class="hint danger">자료 불러오기 실패: ${esc(err.message)}</p>`;
    }
  }

  async function uploadScheduleFiles(showDone) {
    if (!activeScheduleFeedbackCard) return [];
    const input = $("scheduleFiles");
    const files = Array.from(input?.files || []);
    if (!files.length) {
      if (showDone) setScheduleFeedbackStatus("선택된 파일이 없습니다.", true);
      return [];
    }
    const form = new FormData();
    form.set("cardId", activeScheduleFeedbackCard.id);
    form.set("repo", activeScheduleFeedbackCard.repo);
    form.set("issueTitle", $("scheduleIssueTitle").value || activeScheduleFeedbackCard.issue_title);
    const issueNumber = currentScheduleIssueNumber();
    if (issueNumber) form.set("issueNumber", String(issueNumber));
    files.forEach((file) => form.append("files", file));
    setScheduleFeedbackStatus("자료를 R2에 등록하는 중...");
    try {
      const res = await window.apiFetch("/api/schedule/assets", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      input.value = "";
      await loadScheduleAssets(false);
      if (showDone) setScheduleFeedbackStatus(`자료 ${data.count || data.assets?.length || 0}개 등록 완료`);
      return data.assets || [];
    } catch (err) {
      setScheduleFeedbackStatus("자료 등록 실패: " + err.message, true);
      throw err;
    }
  }

  async function submitScheduleFeedback() {
    if (!activeScheduleFeedbackCard) return;
    const message = $("scheduleFeedbackText").value.trim();
    if (!message) {
      setScheduleFeedbackStatus("피드백 내용을 입력하세요.", true);
      return;
    }
    const btn = $("btnScheduleSubmit");
    btn.disabled = true;
    setScheduleFeedbackStatus("GitHub 이슈에 등록하는 중...");
    try {
      const uploaded = await uploadScheduleFiles(false);
      const issueNumber = currentScheduleIssueNumber();
      const res = await window.apiFetch("/api/schedule/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cardId: activeScheduleFeedbackCard.id,
          repo: activeScheduleFeedbackCard.repo,
          issueNumber,
          issueTitle: $("scheduleIssueTitle").value,
          message,
          assetIds: uploaded.map((asset) => asset.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      $("scheduleIssueNumber").value = data.issue_number || "";
      $("scheduleFeedbackText").value = "";
      setScheduleFeedbackStatus(`등록 완료 · Issue #${data.issue_number}`);
      await loadScheduleAssets(false);
    } catch (err) {
      setScheduleFeedbackStatus("이슈 등록 실패: " + err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  async function copyScheduleFeedbackBody() {
    const text = $("scheduleFeedbackText")?.value || "";
    if (!text.trim()) {
      setScheduleFeedbackStatus("복사할 본문이 없습니다.", true);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setScheduleFeedbackStatus("본문을 복사했습니다.");
    } catch {
      setScheduleFeedbackStatus("브라우저에서 복사를 허용하지 않았습니다.", true);
    }
  }

  async function downloadHistoryReport(itemsOverride, format = "html") {
    const items = Array.isArray(itemsOverride) ? itemsOverride : historyItems.filter((item) => selectedHistory.has(keyOf(item)));
    if (!items.length) return;
    const status = $("historyStatus");
    if (status && !Array.isArray(itemsOverride)) status.textContent = "보고서 상세 내용을 불러오는 중...";
    const details = [];
    for (const item of items) {
      try {
        details.push({ item, detail: await fetchHistoryDetail(item) });
      } catch (err) {
        details.push({ item, error: err.message });
      }
    }
    const rows = details.map(({ item, detail, error }) => {
      if (error || !detail) {
        return `<section>
          <h2>${esc(displayText(item.title, "인코딩 오류 항목"))}</h2>
          <p class="danger">상세 불러오기 실패: ${esc(error || "unknown")}</p>
        </section>`;
      }
      const common = `
      <h2>${esc(displayText(item.title, "인코딩 오류 항목"))}</h2>
      <p><strong>출처</strong>: ${esc(item.source)} · <strong>일자</strong>: ${fmtDate(item.date || item.created_at)}</p>
      <p><strong>프로젝트/주제</strong>: ${esc(displayText(item.project || item.subject, "-"))}</p>
      <p><strong>태그</strong>: ${esc(historyTags(item).join(", ") || "-")}</p>
      <p><strong>파일</strong>: ${item.file_count || 0}개 ${item.file_names?.length ? `- ${esc(item.file_names.join(", "))}` : ""}</p>`;
      if (detail.kind === "meeting") {
        return `<section>${common}<h3>회의록 본문${dagLinkText(detail.dagshub_run_url)}</h3><pre>${esc(displayText(detail.markdown, "본문 없음"))}</pre></section>`;
      }
      const outputsHtml = outputSummaryHtml(detail.outputs || {}, detail.output_meta || {}, detail.files || []);
      const filesHtml = renderSimpleFileList(detail.files, true);
      return `<section>${common}
        ${detail.item?.etc_note ? `<h3>분석 메모</h3><pre>${esc(displayText(detail.item.etc_note))}</pre>` : ""}
        <h3>회의록 참고자료</h3><pre>${esc(displayText(detail.meeting_markdown, "연결된 회의록 없음"))}</pre>
        <h3>분석파일</h3>${filesHtml}
        <h3>분석 산출물 요약</h3>${outputsHtml}
      </section>`;
    }).join("\n");
    const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>히스토리 보고서</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.6; color: #1f2937; margin: 40px; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; margin-bottom: 6px; }
    h3 { font-size: 15px; margin: 14px 0 4px; }
    section { border-top: 1px solid #e5e7eb; padding: 18px 0; }
    p { margin: 4px 0; }
    pre { white-space: pre-wrap; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; font-size: 13px; }
    .report-file-list { list-style: none; padding: 0; margin: 8px 0; display: grid; gap: 6px; }
    .report-file-list li { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; }
    .report-file-list strong { display: block; overflow-wrap: anywhere; }
    .report-file-list span { color: #6b7280; font-size: 12px; }
    .danger { color: #c0392b; }
  </style>
</head>
<body>
  <h1>히스토리 보고서</h1>
  <p>생성일: ${new Date().toLocaleString("ko-KR")} · 선택 항목: ${items.length}개</p>
  ${rows}
</body>
</html>`;
    if (format === "pdf") {
      printHtmlDocument(html, "히스토리 보고서 PDF");
      if (status && !Array.isArray(itemsOverride)) {
        status.textContent = `PDF 저장 창을 열었습니다 · ${items.length}개 항목`;
        status.classList.remove("danger");
      }
      return;
    }
    const blob = textBlob(html, "text/html;charset=utf-8");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${new Date().toISOString().slice(0, 10)}_history_report.html`;
    a.click();
    URL.revokeObjectURL(a.href);
    if (status && !Array.isArray(itemsOverride)) {
      status.textContent = `보고서 생성 완료 · ${items.length}개 항목`;
      status.classList.remove("danger");
    }
  }

  function fillSelect(sel, items, valueOf, labelOf, selectedVal) {
    const opts = ['<option value="">(선택 안 함)</option>']
      .concat(items.map((it) => `<option value="${valueOf(it)}">${labelOf(it)}</option>`));
    sel.innerHTML = opts.join("");
    if (selectedVal) sel.value = selectedVal;
  }

  async function initGit() {
    const gs = $("gitStatus");
    $("btnSaveGit").addEventListener("click", saveGit);
    $("btnReloadGit").addEventListener("click", () => loadGitLists(true));
    $("btnAddScheduleSource")?.addEventListener("click", () => {
      scheduleSources.push({
        id: "",
        repo: $("gitRepo")?.value || gitRepoOptions[0]?.full_name || "",
        project_id: $("gitProject")?.value || gitProjectOptions[0]?.id || "",
        project_title: $("gitProject")?.selectedOptions?.[0]?.textContent || gitProjectOptions[0]?.title || "",
        enabled: true,
      });
      renderScheduleSourceRows();
    });
    $("btnSaveScheduleSources")?.addEventListener("click", saveScheduleSources);
    $("scheduleSourceRows")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-schedule-source]");
      if (!button) return;
      scheduleSources.splice(Number(button.dataset.removeScheduleSource), 1);
      renderScheduleSourceRows();
    });
    let defaults = { default_repo: "", default_project_id: "", default_project_title: "" };
    try { defaults = await window.apiFetch("/api/git/defaults").then((r) => r.json()); } catch {}
    if (defaults.default_repo) $("gitRepo").innerHTML = `<option value="${defaults.default_repo}">${defaults.default_repo}</option>`;
    if (defaults.default_project_id) $("gitProject").innerHTML = `<option value="${defaults.default_project_id}">${defaults.default_project_title || defaults.default_project_id}</option>`;
    window.__gitDefaults = defaults;
    await loadScheduleSources();
    loadGitLists(false);

    async function loadGitLists(force) {
      gs.textContent = "목록 불러오는 중..."; gs.classList.remove("danger");
      try {
        const [rp, pj] = await Promise.all([
          window.apiFetch("/api/git/repos").then((r) => r.json()),
          window.apiFetch("/api/git/projects").then((r) => r.json()),
        ]);
        if (rp.relogin || pj.relogin || rp.error || pj.error) {
          gs.textContent = "GitHub 권한이 없습니다. 로그아웃 후 다시 로그인하세요.";
          gs.classList.add("danger"); return;
        }
        gitRepoOptions = rp.repos || [];
        gitProjectOptions = pj.projects || [];
        fillSelect($("gitRepo"), rp.repos || [], (r) => r.full_name, (r) => r.full_name + (r.private ? " 🔒" : ""), window.__gitDefaults.default_repo);
        fillSelect($("gitProject"), pj.projects || [], (p) => p.id, (p) => `${p.title} (#${p.number})`, window.__gitDefaults.default_project_id);
        renderScheduleSourceRows();
        gs.textContent = force ? "목록 갱신됨." : "";
      } catch (e) {
        gs.textContent = "목록 불러오기 실패: " + e.message; gs.classList.add("danger");
      }
    }
  }

  async function loadScheduleSources() {
    const status = $("scheduleSourceStatus");
    try {
      const res = await window.apiFetch("/api/schedule/sources");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      scheduleSources = data.sources || [];
      renderScheduleSourceRows();
      if (status) status.textContent = scheduleSources.length ? `${scheduleSources.length}개 연결됨` : "연결된 repo/Project가 없습니다.";
    } catch (err) {
      if (status) {
        status.textContent = "연결 목록 불러오기 실패: " + err.message;
        status.classList.add("danger");
      }
    }
  }

  function renderScheduleSourceRows() {
    const host = $("scheduleSourceRows");
    if (!host) return;
    if (!scheduleSources.length) {
      host.innerHTML = '<p class="hint">연결 추가를 눌러 일정과 칸반에서 사용할 repo/Project를 선택하세요.</p>';
      return;
    }
    host.innerHTML = scheduleSources.map((source, index) => {
      const repos = gitRepoOptions.length ? gitRepoOptions : (source.repo ? [{ full_name: source.repo }] : []);
      const projects = gitProjectOptions.length ? gitProjectOptions : (source.project_id ? [{
        id: source.project_id,
        title: source.project_title,
        number: "",
      }] : []);
      return `<div class="schedule-source-row" data-schedule-source-row="${index}">
        <label>repo
          <select data-schedule-source-repo>
            ${repos.map((repo) => `<option value="${attr(repo.full_name)}"${repo.full_name === source.repo ? " selected" : ""}>${esc(repo.full_name)}${repo.private ? " 🔒" : ""}</option>`).join("")}
          </select>
        </label>
        <label>Project
          <select data-schedule-source-project>
            ${projects.map((project) => `<option value="${attr(project.id)}"${project.id === source.project_id ? " selected" : ""}>${esc(project.title)}${project.number ? ` (#${project.number})` : ""}</option>`).join("")}
          </select>
        </label>
        <button class="btn btn-ghost btn-small" type="button" data-remove-schedule-source="${index}">연결 제거</button>
      </div>`;
    }).join("");
  }

  async function saveScheduleSources() {
    const status = $("scheduleSourceStatus");
    const sources = [...document.querySelectorAll("[data-schedule-source-row]")].map((row) => {
      const repo = row.querySelector("[data-schedule-source-repo]");
      const project = row.querySelector("[data-schedule-source-project]");
      return {
        repo: repo?.value || "",
        project_id: project?.value || "",
        project_title: project?.selectedOptions?.[0]?.textContent?.replace(/\s+\(#\d+\)$/, "") || "",
      };
    });
    if (status) {
      status.textContent = "저장 중...";
      status.classList.remove("danger");
    }
    try {
      const res = await window.apiFetch("/api/schedule/sources", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      scheduleSources = data.sources || [];
      scheduleGithubLoaded = false;
      renderScheduleSourceRows();
      if (status) status.textContent = `${scheduleSources.length}개 repo/Project 연결을 저장했습니다.`;
      await loadScheduleGithubItems(true);
    } catch (err) {
      if (status) {
        status.textContent = "연결 저장 실패: " + err.message;
        status.classList.add("danger");
      }
    }
  }

  async function saveGit() {
    const gs = $("gitStatus");
    gs.textContent = "저장 중..."; gs.classList.remove("danger");
    const projSel = $("gitProject");
    const body = {
      default_repo: $("gitRepo").value || null,
      default_project_id: projSel.value || null,
      default_project_title: projSel.value ? projSel.options[projSel.selectedIndex].text : null,
    };
    try {
      const res = await window.apiFetch("/api/git/defaults", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      window.__gitDefaults = data;
      gs.textContent = `저장됨 (${data.default_repo || "repo 없음"}${data.default_project_title ? " · " + data.default_project_title : ""})`;
    } catch (err) {
      gs.textContent = "실패: " + err.message; gs.classList.add("danger");
    }
  }

  function initOrgControls() {
    $("btnReloadOrgs")?.addEventListener("click", () => loadOrganizations(true));
    $("btnCreateOrg")?.addEventListener("click", createOrg);
    $("orgSelect")?.addEventListener("change", () => {
      selectedOrgId = $("orgSelect").value;
      loadOrgDetail();
    });
    $("orgUsagePeriod")?.addEventListener("change", loadOrgUsage);
    $("btnReloadOrgGardens")?.addEventListener("click", loadOrgGardens);
    $("btnExportOrgUsage")?.addEventListener("click", exportOrgUsage);
    $("btnSaveOrgPolicy")?.addEventListener("click", saveOrgPolicy);
    $("btnReloadOrgAudit")?.addEventListener("click", loadOrgAudit);
    $("btnInviteOrgMember")?.addEventListener("click", inviteOrgMember);
    $("orgMemberRows")?.addEventListener("click", onOrgMemberClick);
    $("orgMemberRows")?.addEventListener("change", onOrgMemberChange);
  }

  async function initOrgInviteFromUrl() {
    const token = new URLSearchParams(location.search).get("invite");
    if (!token) return;
    setTab("org", false);
    const status = $("orgStatus");
    if (status) status.textContent = "초대 수락 중...";
    try {
      const res = await window.apiFetch(`/api/org-invites/${encodeURIComponent(token)}/accept`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      selectedOrgId = data.org_id;
      if (status) status.textContent = "초대를 수락했습니다.";
      history.replaceState(null, "", "/mypage/?tab=org");
      await loadOrganizations(true);
    } catch (err) {
      if (status) {
        status.textContent = "초대 수락 실패: " + err.message;
        status.classList.add("danger");
      }
    }
  }

  function orgMoney(value) {
    return `${fmtCost(value)}원`;
  }

  function orgPercent(value) {
    const n = Math.max(0, Number(value) || 0) * 100;
    return `${n >= 10 ? n.toFixed(1) : n.toFixed(2)}%`;
  }

  function orgIsAdmin() {
    return currentOrgDetail?.organization?.role === "admin";
  }

  async function loadOrganizations(force = false) {
    if (orgLoaded && !force) return;
    const status = $("orgStatus");
    if (status) {
      status.textContent = "조직 정보를 불러오는 중...";
      status.classList.remove("danger");
    }
    try {
      const res = await window.apiFetch("/api/orgs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      orgLoaded = true;
      orgs = data.organizations || [];
      renderOrgSelect();
      if (!selectedOrgId && orgs.length) selectedOrgId = orgs[0].id;
      if ($("orgSelect")) $("orgSelect").value = selectedOrgId;
      if (selectedOrgId) await loadOrgDetail();
      else {
        $("orgDetailPanel").hidden = true;
        if (status) status.textContent = "아직 조직이 없습니다. 새 조직을 생성하세요.";
      }
    } catch (err) {
      if (status) {
        status.textContent = "조직 정보 불러오기 실패: " + err.message;
        status.classList.add("danger");
      }
    }
  }

  function renderOrgSelect() {
    const select = $("orgSelect");
    if (!select) return;
    select.innerHTML = orgs.length
      ? orgs.map((org) => `<option value="${attr(org.id)}">${esc(org.name)} · ${esc(org.role === "admin" ? "관리자" : "일반")}</option>`).join("")
      : '<option value="">조직 없음</option>';
  }

  async function createOrg() {
    const status = $("orgStatus");
    const name = $("orgName").value.trim();
    if (!name) {
      status.textContent = "조직 이름을 입력하세요.";
      status.classList.add("danger");
      return;
    }
    status.textContent = "조직 생성 중...";
    status.classList.remove("danger");
    try {
      const res = await window.apiFetch("/api/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      $("orgName").value = "";
      selectedOrgId = data.id;
      orgLoaded = false;
      status.textContent = "조직을 생성했습니다.";
      await loadOrganizations(true);
    } catch (err) {
      status.textContent = "조직 생성 실패: " + err.message;
      status.classList.add("danger");
    }
  }

  async function loadOrgDetail() {
    if (!selectedOrgId) return;
    const status = $("orgStatus");
    if (status) status.textContent = "조직 상세를 불러오는 중...";
    try {
      const res = await window.apiFetch(`/api/orgs/${encodeURIComponent(selectedOrgId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      currentOrgDetail = data;
      renderOrgDetail(data);
      await loadOrgGardens();
      await loadOrgUsage();
      if (orgIsAdmin()) await loadOrgAudit();
      if (status) status.textContent = "";
    } catch (err) {
      if (status) {
        status.textContent = "조직 상세 불러오기 실패: " + err.message;
        status.classList.add("danger");
      }
    }
  }

  function renderAccountLinkStatus() {
    const status = $("accountLinkStatus");
    if (!status) return;
    const result = new URLSearchParams(location.search).get("account_link");
    if (result === "success") status.textContent = "계정이 연결되었습니다. 이제 연결한 로그인으로도 같은 데이터를 볼 수 있습니다.";
    else if (result === "already_linked") {
      status.textContent = "이 로그인 계정은 이미 다른 계정에 연결되어 있습니다.";
      status.classList.add("danger");
    } else if (result === "failed") {
      status.textContent = "계정 연결에 실패했습니다. 다시 시도해 주세요.";
      status.classList.add("danger");
    } else if (result === "login_required") {
      status.textContent = "계정 연결은 로그인한 상태에서만 할 수 있습니다.";
      status.classList.add("danger");
    }
  }

  const ACCOUNT_LINK_PROVIDERS = ["github", "google", "kakao", "naver"];
  const ACCOUNT_LINK_LABEL = { github: "GitHub", google: "Google", kakao: "카카오", naver: "네이버" };
  const ACCOUNT_LINK_HREF = {
    github: "/api/auth/github/link",
    google: "/api/auth/google/link",
    kakao: "/api/auth/kakao/link",
    naver: "/api/auth/naver/link",
  };
  const accountLinkState = { identities: [], emailLoginAvailable: false, busyProvider: null };

  function renderAccountLinkList() {
    const container = $("accountLinkList");
    if (!container) return;
    const identityByProvider = new Map(accountLinkState.identities.map((row) => [row.provider, row]));
    const connectedCount = identityByProvider.size;
    container.innerHTML = ACCOUNT_LINK_PROVIDERS.map((provider) => {
      const identity = identityByProvider.get(provider);
      const isConnected = !!identity;
      const isLastMethod = isConnected && connectedCount === 1 && !accountLinkState.emailLoginAvailable;
      const busy = accountLinkState.busyProvider === provider;
      const label = ACCOUNT_LINK_LABEL[provider];
      const accountName = identity && identity.display_name ? esc(identity.display_name) : "";

      let actionHtml;
      if (!isConnected) {
        actionHtml = `<a class="btn btn-ghost btn-small" href="${ACCOUNT_LINK_HREF[provider]}">계정 연결</a>`;
      } else if (isLastMethod) {
        actionHtml = '<button class="btn btn-ghost btn-small" type="button" disabled aria-disabled="true">연결 해제</button>';
      } else {
        actionHtml = `<button class="btn btn-ghost btn-small" type="button" data-action="unlink-provider" data-provider="${provider}" ${busy ? "disabled" : ""}>${busy ? "해제 중..." : "연결 해제"}</button>`;
      }

      return `<div class="account-link-row">
        <div class="account-link-info">
          <strong>${label}</strong>
          ${isConnected ? `<span class="account-link-name">${accountName || "연결됨"}</span>` : '<span class="hint">연결되지 않음</span>'}
        </div>
        ${actionHtml}
        ${isLastMethod ? '<p class="hint danger account-link-last-method">마지막 로그인 방법은 연결 해제할 수 없습니다. 다른 소셜 계정을 연결하거나 이메일 로그인을 설정해 주세요.</p>' : ""}
      </div>`;
    }).join("");
  }

  function applyAccountLinkState(me) {
    accountLinkState.identities = Array.isArray(me && me.identities) ? me.identities : [];
    accountLinkState.emailLoginAvailable = !!(me && me.email_login_available);
    renderAccountLinkList();
  }

  async function refreshAccountLinkState() {
    try {
      const res = await window.apiFetch("/api/me");
      const me = await res.json();
      applyAccountLinkState(me);
    } catch {
      renderAccountLinkList();
    }
  }

  function bindAccountLinkEvents() {
    const container = $("accountLinkList");
    if (!container || container.dataset.bound) return;
    container.dataset.bound = "1";
    container.addEventListener("click", async (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-action='unlink-provider']") : null;
      if (!button || button.disabled) return;
      const provider = button.dataset.provider;
      const label = ACCOUNT_LINK_LABEL[provider] || provider;
      const statusEl = $("accountLinkStatus");
      if (!window.confirm(`${label} 계정 연결을 해제하시겠습니까? 연결을 해제하면 이 계정으로 현재 계정에 로그인할 수 없습니다.`)) return;

      accountLinkState.busyProvider = provider;
      renderAccountLinkList();
      try {
        const res = await window.apiFetch(`/api/auth/identities/${encodeURIComponent(provider)}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          if (statusEl) {
            statusEl.classList.add("danger");
            if (data.code === "last_login_method") statusEl.textContent = data.message || "다른 로그인 방법을 먼저 연결해 주세요.";
            else if (data.code === "identity_not_found") statusEl.textContent = "이미 연결이 해제된 계정입니다.";
            else statusEl.textContent = `${label} 연결 해제에 실패했습니다. 다시 시도해 주세요.`;
          }
          await refreshAccountLinkState();
          return;
        }
        if (statusEl) {
          statusEl.classList.remove("danger");
          statusEl.textContent = data.revoke_status === "failed"
            ? `${label} 계정 연결을 해제했습니다. 외부 서비스 연동 해제는 실패해 잠시 후 자동으로 다시 시도합니다.`
            : provider === "github"
              ? "GitHub 계정 연결을 해제했습니다. GitHub 이슈·Project 연동 기능도 함께 꺼졌습니다. 다시 쓰려면 GitHub를 재연결하세요."
              : `${label} 계정 연결을 해제했습니다.`;
        }
        await refreshAccountLinkState();
      } catch (err) {
        if (statusEl) {
          statusEl.classList.add("danger");
          statusEl.textContent = `${label} 연결 해제 실패: ${err.message}`;
        }
      } finally {
        accountLinkState.busyProvider = null;
        renderAccountLinkList();
      }
    });
  }

  async function onKanbanClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const deleteButton = target?.closest("[data-kanban-delete]");
    if (deleteButton) {
      const card = kanbanCards.find((item) => item.id === deleteButton.dataset.kanbanDelete);
      if (card) await deleteKanban(card, deleteButton);
      return;
    }
    const button = target?.closest("[data-kanban-link-save]");
    if (!button) return;
    const cardId = button.dataset.kanbanLinkSave;
    const repo = document.querySelector(`[data-kanban-repo="${CSS.escape(cardId)}"]`)?.value.trim() || "";
    const issueNumber = Number(document.querySelector(`[data-kanban-issue="${CSS.escape(cardId)}"]`)?.value || 0) || null;
    button.disabled = true;
    try {
      const res = await window.apiFetch(`/api/kanban/cards/${encodeURIComponent(cardId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ github_repo: repo, github_issue_number: issueNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const idx = kanbanCards.findIndex((card) => card.id === cardId);
      if (idx >= 0 && data.card) kanbanCards[idx] = data.card;
      renderKanban();
      if (data.github_sync && $("kanbanStatus")) {
        $("kanbanStatus").textContent = data.github_sync.state === "closed"
          ? "칸반 완료 및 GitHub 이슈 닫기 완료"
          : "칸반 재개 및 GitHub 이슈 다시 열기 완료";
      } else if ($("kanbanStatus")) {
        $("kanbanStatus").textContent = repo ? `GitHub ${repo}#${issueNumber} 연결 완료` : "GitHub 이슈 연결 해제";
      }
    } catch (err) {
      if ($("kanbanStatus")) {
        $("kanbanStatus").textContent = "GitHub 이슈 연결 실패: " + err.message;
        $("kanbanStatus").classList.add("danger");
      }
      button.disabled = false;
    }
  }

  async function deleteKanban(card, button) {
    if (!window.confirm(`“${displayText(card.title, "카드")}” 카드를 삭제할까요?\n연결된 GitHub 이슈가 있어도 원격 이슈는 닫히지 않습니다.`)) return false;
    button.disabled = true;
    try {
      const res = await window.apiFetch(`/api/kanban/cards/${encodeURIComponent(card.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "카드를 찾을 수 없습니다.");
      kanbanCards = kanbanCards.filter((item) => item.id !== card.id);
      clearLocalMatrixPlacement(`kanban:${card.id}`);
      kanbanMatrixSelectedCardId = null;
      renderKanban();
      renderKanbanMatrix();
      setPriorityMatrixStatus("칸반 카드를 삭제했습니다. 연결된 GitHub 이슈 상태는 변경하지 않았습니다.");
      return true;
    } catch (err) {
      setPriorityMatrixStatus("칸반 카드 삭제 실패: " + err.message, true);
      button.disabled = false;
      return false;
    }
  }

  function safeGardenUrl(value) {
    try {
      const raw = String(value || "").trim();
      if (!raw) return "";
      const url = new URL(raw, location.origin);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  }

  async function loadOrgGardens() {
    const body = $("orgGardenRows");
    const status = $("orgGardenStatus");
    if (!selectedOrgId || !body) return;
    if (status) {
      status.textContent = "조직 Garden을 불러오는 중...";
      status.classList.remove("danger");
    }
    try {
      const res = await window.apiFetch(`/api/orgs/${encodeURIComponent(selectedOrgId)}/gardens`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      renderOrgGardens(data.gardens || []);
      if (status) status.textContent = data.gardens?.length ? "" : "연결된 Garden이 없습니다.";
    } catch (err) {
      if (status) {
        status.textContent = "조직 Garden 불러오기 실패: " + err.message;
        status.classList.add("danger");
      }
    }
  }

  function renderOrgGardens(gardens) {
    const body = $("orgGardenRows");
    if (!body) return;
    body.innerHTML = gardens.map((garden) => {
      const siteUrl = safeGardenUrl(garden.site_url);
      const open = siteUrl
        ? `<a class="btn btn-ghost btn-small" href="${attr(siteUrl)}" target="_blank" rel="noopener">사이트 열기</a>`
        : `<span class="hint">아직 배포 URL 없음</span>`;
      return `<div class="result-head garden-org-row">
        <div>
          <strong>${esc(garden.title || "Garden")}</strong>
          <p class="hint">${esc(garden.visibility === "org_private" ? "조직 전용 연결 · Pages Access 정책 확인 필요" : garden.visibility)} · ${esc(garden.status || "draft")}</p>
        </div>
        ${open}
      </div>`;
    }).join("") || `<p class="hint">연결된 Garden이 없습니다.</p>`;
  }

  async function loadOrgUsage() {
    if (!selectedOrgId) return;
    const period = $("orgUsagePeriod")?.value || "month";
    try {
      const res = await window.apiFetch(`/api/orgs/${encodeURIComponent(selectedOrgId)}/usage?period=${encodeURIComponent(period)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      renderOrgUsage(data);
    } catch (err) {
      const status = $("orgStatus");
      if (status) {
        status.textContent = "조직 비용 불러오기 실패: " + err.message;
        status.classList.add("danger");
      }
    }
  }

  function renderOrgDetail(data) {
    const org = data.organization || {};
    $("orgDetailPanel").hidden = false;
    $("orgTitle").textContent = org.name || "조직";
    $("orgRoleHint").textContent = org.role === "admin"
      ? "관리자 권한으로 멤버·초대·조직 전체 비용을 관리합니다."
      : "일반 멤버 권한으로 본인 사용량만 조회합니다.";
    $("orgInvitePanel").hidden = !orgIsAdmin();
    $("orgInviteTableWrap").hidden = !orgIsAdmin() || !(data.invites || []).length;
    renderOrgPolicy(data.settings || {});
    renderOrgMembers(data.members || []);
    renderOrgInvites(data.invites || []);
  }

  function renderOrgPolicy(settings) {
    const visible = orgIsAdmin();
    const panel = $("orgPolicyPanel");
    const rawWrap = $("orgExportRawWrap");
    if (panel) panel.hidden = !visible;
    if (rawWrap) rawWrap.hidden = !visible;
    if (!visible) return;
    $("orgRevealIdentifiers").checked = settings.reveal_member_identifiers !== false;
    $("orgRawExport").checked = settings.allow_raw_usage_export === true;
    $("orgAdminOverageEmail").checked = settings.admin_overage_email_enabled !== false;
    $("orgAuditRetentionDays").value = settings.audit_log_retention_days || 90;
    if ($("orgExportRawIdentifiers")) {
      $("orgExportRawIdentifiers").checked = false;
      $("orgExportRawIdentifiers").disabled = settings.allow_raw_usage_export !== true;
    }
  }

  async function saveOrgPolicy() {
    if (!selectedOrgId) return;
    const status = $("orgPolicyStatus");
    status.textContent = "정책 저장 중...";
    status.classList.remove("danger");
    const body = {
      reveal_member_identifiers: $("orgRevealIdentifiers").checked,
      allow_raw_usage_export: $("orgRawExport").checked,
      admin_overage_email_enabled: $("orgAdminOverageEmail").checked,
      audit_log_retention_days: Number($("orgAuditRetentionDays").value) || 90,
    };
    try {
      const res = await window.apiFetch(`/api/orgs/${encodeURIComponent(selectedOrgId)}/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (currentOrgDetail) currentOrgDetail.settings = data;
      renderOrgPolicy(data);
      await loadOrgDetail();
      status.textContent = "정책이 저장되었습니다.";
    } catch (err) {
      status.textContent = "정책 저장 실패: " + err.message;
      status.classList.add("danger");
    }
  }

  async function loadOrgAudit() {
    if (!selectedOrgId || !orgIsAdmin()) return;
    try {
      const res = await window.apiFetch(`/api/orgs/${encodeURIComponent(selectedOrgId)}/audit-logs`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      renderOrgAudit(data.logs || []);
    } catch (err) {
      const status = $("orgPolicyStatus");
      if (status) {
        status.textContent = "감사 로그 불러오기 실패: " + err.message;
        status.classList.add("danger");
      }
    }
  }

  function renderOrgAudit(logs) {
    const body = $("orgAuditRows");
    if (!body) return;
    body.innerHTML = (logs || []).map((log) => `<tr>
      <td>${esc(log.created_at ? new Date(log.created_at).toLocaleString("ko-KR") : "-")}</td>
      <td>${esc(log.action || "-")}</td>
      <td>${esc(log.target_user_id || "-")}</td>
      <td>${esc(log.actor_user_id || "-")}</td>
    </tr>`).join("") || `<tr><td colspan="4">감사 로그가 없습니다.</td></tr>`;
  }

  function renderOrgUsage(data) {
    const totals = data.totals || {};
    const budget = data.budget || {};
    $("orgCostTotal").textContent = orgMoney(totals.cost_krw);
    $("orgBudgetTotal").textContent = orgMoney(budget.period_limit_krw);
    $("orgBudgetRate").textContent = orgPercent(budget.burn_rate);
    $("orgBudgetFill").style.width = `${Math.min(100, Math.max(0, Number(budget.burn_rate) || 0) * 100)}%`;
    const exportBtn = $("btnExportOrgUsage");
    if (exportBtn) exportBtn.hidden = data.role !== "admin";
    if ($("orgExportRawWrap")) $("orgExportRawWrap").hidden = data.role !== "admin";
    if ($("orgExportRawIdentifiers")) $("orgExportRawIdentifiers").disabled = data.settings?.allow_raw_usage_export !== true;
    renderOrgMembers(data.members || currentOrgDetail?.members || []);
    renderOrgDevices(data.devices || [], data.role === "admin");
  }

  function renderOrgDevices(devices, visible) {
    const wrap = $("orgDeviceUsageWrap");
    const body = $("orgDeviceRows");
    if (!wrap || !body) return;
    wrap.hidden = !visible;
    if (!visible) {
      body.innerHTML = "";
      return;
    }
    body.innerHTML = devices.map((device) => `<tr>
      <td>${esc(device.label || device.device_id_masked || "Device")}${device.device_id_raw ? `<br><small>${esc(device.device_id_raw)}</small>` : ""}</td>
      <td>${esc(device.owner_label || "-")}${device.owner_identifier_raw ? `<br><small>${esc(device.owner_identifier_raw)}</small>` : ""}</td>
      <td>${Math.round(Number(device.requests || 0)).toLocaleString("ko-KR")}</td>
      <td>${Math.round(Number(device.total_tokens || 0)).toLocaleString("ko-KR")}</td>
      <td>${orgMoney(device.cost_krw)}</td>
      <td>${esc(device.latest_at ? new Date(device.latest_at).toLocaleString("ko-KR") : "-")}</td>
    </tr>`).join("") || `<tr><td colspan="6">기기 사용량이 없습니다.</td></tr>`;
  }

  function exportOrgUsage() {
    if (!selectedOrgId) return;
    const period = $("orgUsagePeriod")?.value || "month";
    const raw = $("orgExportRawIdentifiers")?.checked ? "&raw=1" : "";
    location.href = `/api/orgs/${encodeURIComponent(selectedOrgId)}/usage/export?period=${encodeURIComponent(period)}${raw}`;
  }

  function renderOrgMembers(members) {
    const body = $("orgMemberRows");
    if (!body) return;
    const admin = orgIsAdmin();
    const viewerUserId = currentOrgDetail?.viewer_user_id;
    body.innerHTML = members.map((member) => {
      const isViewer = member.user_id === viewerUserId;
      const roleControl = admin
        ? `<select data-org-role="${attr(member.user_id)}">
             <option value="member" ${member.role !== "admin" ? "selected" : ""}>일반</option>
             <option value="admin" ${member.role === "admin" ? "selected" : ""}>관리자</option>
           </select>`
        : esc(member.role_label || member.role);
      const actions = admin
        ? (isViewer
          ? `<button class="btn btn-ghost btn-small" type="button" disabled title="본인 계정은 이 화면에서 제거할 수 없습니다.">제거</button><small class="hint">본인</small>`
          : `<button class="btn btn-ghost btn-small" type="button" data-org-remove="${attr(member.user_id)}">제거</button>`)
        : "";
      return `<tr>
        <td>${esc(member.display_name || member.user_id)}${member.account_identifier_raw ? `<br><small>${esc(member.account_identifier_raw)}</small>` : ""}</td>
        <td>${roleControl}</td>
        <td>${Math.round(Number(member.requests || 0)).toLocaleString("ko-KR")}</td>
        <td>${Math.round(Number(member.total_tokens || 0)).toLocaleString("ko-KR")}</td>
        <td>${orgMoney(member.cost_krw)}</td>
        <td>${actions}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="6">멤버가 없습니다.</td></tr>`;
  }

  function renderOrgInvites(invites) {
    const body = $("orgInviteRows");
    if (!body) return;
    body.innerHTML = invites.map((invite) => `<tr>
      <td>${esc(invite.email)}</td>
      <td>${esc(invite.role === "admin" ? "관리자" : "일반")}</td>
      <td>${esc(invite.status)}</td>
      <td>${invite.status === "pending" ? `<a class="btn btn-ghost btn-small" href="${attr(invite.accept_url)}">초대 열기</a>` : "-"}</td>
    </tr>`).join("") || `<tr><td colspan="4">초대가 없습니다.</td></tr>`;
  }

  async function inviteOrgMember() {
    if (!selectedOrgId) return;
    const status = $("orgInviteStatus");
    status.textContent = "초대 생성 중...";
    status.classList.remove("danger");
    try {
      const res = await window.apiFetch(`/api/orgs/${encodeURIComponent(selectedOrgId)}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: $("orgInviteEmail").value, role: $("orgInviteRole").value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      $("orgInviteEmail").value = "";
      status.textContent = "초대를 생성했습니다. 아래 ‘초대 열기’에서 초대 화면을 확인하거나 링크를 전달하세요.";
      await loadOrgDetail();
    } catch (err) {
      status.textContent = "초대 실패: " + err.message;
      status.classList.add("danger");
    }
  }

  async function onOrgMemberChange(event) {
    const target = event.target instanceof Element ? event.target : null;
    const select = target?.closest("[data-org-role]");
    if (!select || !selectedOrgId) return;
    const memberUserId = select.dataset.orgRole;
    try {
      const res = await window.apiFetch(`/api/orgs/${encodeURIComponent(selectedOrgId)}/members/${encodeURIComponent(memberUserId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: select.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await loadOrgDetail();
    } catch (err) {
      $("orgStatus").textContent = "역할 변경 실패: " + err.message;
      $("orgStatus").classList.add("danger");
      await loadOrgDetail();
    }
  }

  async function onOrgMemberClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const btn = target?.closest("[data-org-remove]");
    if (!btn || !selectedOrgId) return;
    const memberUserId = btn.dataset.orgRemove;
    if (memberUserId === currentOrgDetail?.viewer_user_id) {
      $("orgStatus").textContent = "본인 계정은 이 화면에서 제거할 수 없습니다.";
      $("orgStatus").classList.add("danger");
      return;
    }
    btn.disabled = true;
    try {
      const res = await window.apiFetch(`/api/orgs/${encodeURIComponent(selectedOrgId)}/members/${encodeURIComponent(memberUserId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await loadOrgDetail();
    } catch (err) {
      $("orgStatus").textContent = "멤버 제거 실패: " + err.message;
      $("orgStatus").classList.add("danger");
      btn.disabled = false;
    }
  }

  const AGENT_STATUS_LABELS = {
    fresh: "최신",
    stale: "오래됨",
    unsupported: "미지원",
    unconfigured: "미입력",
    error: "오류",
  };
  const AGENT_UNIT_LABELS = {
    percent: "%",
    requests: "요청",
    messages: "메시지",
    credits: "크레딧",
    tokens: "토큰",
    unknown: "단위 미상",
  };

  function agentStatusLabel(value) {
    return AGENT_STATUS_LABELS[value] || value || "미입력";
  }

  function agentDateTimeLocal(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return "";
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  function agentDisplayDateTime(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return "시각 미입력";
    return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  }

  function agentNumberValue(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function agentWindowSummary(windowData) {
    if (windowData.status === "fresh") {
      const total = windowData.limit_value === null ? "한도 미입력" : `${windowData.limit_value}${AGENT_UNIT_LABELS[windowData.unit] || windowData.unit}`;
      return `현재 잔여 ${windowData.remaining_value}${AGENT_UNIT_LABELS[windowData.unit] || windowData.unit} / ${total} · 리셋 ${agentDisplayDateTime(windowData.resets_at)}`;
    }
    if (windowData.status === "stale") {
      const recorded = windowData.recorded_remaining_value === null
        ? "마지막 값 없음"
        : `마지막 관측 ${windowData.recorded_remaining_value}${AGENT_UNIT_LABELS[windowData.unit] || windowData.unit}`;
      return `현재 잔여량 알 수 없음 · ${recorded}. 새 관측이 필요합니다.`;
    }
    return windowData.message || "현재 잔여량을 알 수 없습니다.";
  }

  function agentWindowCompactSummary(windowData, subscriptionConfigured) {
    const unit = AGENT_UNIT_LABELS[windowData.unit] || windowData.unit || "";
    if (!subscriptionConfigured) {
      return {
        primary: `${windowData.label} 확인 전`,
        secondary: "구독 정보 저장 필요",
        status: "unconfigured",
      };
    }
    if (windowData.status === "fresh") {
      return {
        primary: `${windowData.label} ${windowData.remaining_value}${unit} 남음`,
        secondary: `리셋 ${agentDisplayDateTime(windowData.resets_at)}`,
        status: "fresh",
      };
    }
    if (windowData.status === "stale") {
      const recorded = windowData.recorded_remaining_value === null
        ? "현재 잔여량 알 수 없음"
        : `마지막 관측 ${windowData.recorded_remaining_value}${unit}`;
      return { primary: `${windowData.label} 새 값 필요`, secondary: recorded, status: "stale" };
    }
    if (windowData.status === "error") {
      return {
        primary: `${windowData.label} 가져오기 오류`,
        secondary: windowData.message || "다시 확인하세요",
        status: "error",
      };
    }
    return {
      primary: `${windowData.label} 확인 전`,
      secondary: windowData.message || "사용량을 가져오세요",
      status: windowData.status || "unconfigured",
    };
  }

  function agentProviderUsageSummary(providerData, subscriptionConfigured) {
    const supported = (providerData.windows || []).filter((windowData) => windowData.input_supported);
    if (!supported.length) return '<span class="agent-provider-usage-empty">표시할 수 있는 잔여량이 없습니다.</span>';
    return supported.map((windowData) => {
      const summary = agentWindowCompactSummary(windowData, subscriptionConfigured);
      return `<span class="agent-provider-usage-item" data-status="${attr(summary.status)}">
        <strong>${esc(summary.primary)}</strong>
        <small>${esc(summary.secondary)}</small>
      </span>`;
    }).join("");
  }

  function updateAgentSubscriptionOverview(providers) {
    const overview = $("agentSubscriptionOverview");
    if (!overview) return;
    const configured = providers.filter((providerData) => !!providerData.subscription).length;
    const fresh = providers.flatMap((providerData) => providerData.windows || [])
      .filter((windowData) => windowData.input_supported && windowData.status === "fresh").length;
    overview.textContent = configured
      ? `${providers.length}개 제공자 · 구독 ${configured}개 · 최신값 ${fresh}개`
      : `${providers.length}개 제공자 · 구독 정보 저장 필요`;
  }

  function agentStatusOptions(selected) {
    return ["fresh", "unconfigured", "unsupported", "error", "stale"].map((status) =>
      `<option value="${status}" ${selected === status ? "selected" : ""}>${agentStatusLabel(status)}</option>`
    ).join("");
  }

  function agentUnitOptions(selected) {
    return Object.entries(AGENT_UNIT_LABELS).map(([unit, label]) =>
      `<option value="${unit}" ${selected === unit ? "selected" : ""}>${esc(label)}</option>`
    ).join("");
  }

  function agentWindowCard(windowData, subscriptionConfigured) {
    const current = windowData.input_supported && windowData.status === "fresh";
    const editable = subscriptionConfigured && windowData.input_supported;
    const disabled = current ? "" : "disabled";
    return `<div class="agent-window-card" data-agent-window-row data-agent-window="${attr(windowData.window_kind)}" data-agent-window-editable="${windowData.input_supported ? "1" : "0"}" data-status="${attr(windowData.status)}">
      <div class="agent-window-head">
        <strong>${esc(windowData.label)}</strong>
        <span class="agent-status-badge" data-status="${attr(windowData.status)}">${esc(agentStatusLabel(windowData.status))}</span>
      </div>
      <p class="agent-window-meta">${esc(agentWindowSummary(windowData))}</p>
      <div class="agent-window-fields">
        <label>상태
          <select data-agent-window-field="status" ${windowData.input_supported ? "" : "disabled"}>${agentStatusOptions(windowData.status)}</select>
        </label>
        <label>잔여량
          <input data-agent-window-field="remaining_value" data-agent-current type="number" min="0" step="any" value="${attr(agentNumberValue(windowData.remaining_value))}" ${disabled} />
        </label>
        <label>전체 한도 (선택)
          <input data-agent-window-field="limit_value" data-agent-current type="number" min="0" step="any" value="${attr(agentNumberValue(windowData.limit_value))}" ${disabled} />
        </label>
        <label>단위
          <select data-agent-window-field="unit" data-agent-current ${disabled}>${agentUnitOptions(windowData.unit)}</select>
        </label>
        <label>다음 리셋 (현재 기기 시간)
          <input data-agent-window-field="resets_at" data-agent-current type="datetime-local" value="${attr(agentDateTimeLocal(windowData.resets_at))}" ${disabled} />
        </label>
        <label>안내·오류 메모 (선택)
          <input data-agent-window-field="message" type="text" maxlength="240" value="${attr(windowData.message || "")}" ${windowData.input_supported ? "" : "disabled"} />
        </label>
      </div>
      <p class="agent-window-meta">출처 ${esc(windowData.source || "미입력")} · 관측 ${esc(agentDisplayDateTime(windowData.observed_at))}</p>
      <div class="agent-subscription-actions">
        <button class="btn btn-ghost" type="button" data-agent-action="save-window" data-agent-window="${attr(windowData.window_kind)}" ${editable ? "" : "disabled"}>${windowData.input_supported ? "이 윈도우 저장" : "제공자 미지원"}</button>
      </div>
    </div>`;
  }

  function agentCredentialSection(providerData) {
    const credential = providerData.credential;
    if (!credential) return "";
    if (!credential.configured) {
      return `<div class="agent-credential" data-agent-credential>
        <strong>자동 수집 (GitHub billing API)</strong>
        <p class="agent-window-meta">fine-grained PAT(권한: Plan 읽기)를 등록하면 월간 premium request 사용량을 서버가 자동 수집합니다. PAT는 암호화되어 저장되며 화면에 다시 표시되지 않습니다.</p>
        <div class="agent-subscription-fields">
          <label>GitHub PAT
            <input data-agent-credential-field="pat" type="password" autocomplete="off" placeholder="github_pat_… 또는 ghp_…" />
          </label>
          <label>월 포함량 (premium requests)
            <input data-agent-credential-field="monthly_included_requests" type="number" min="0" step="1" placeholder="예: 300" />
          </label>
        </div>
        <div class="agent-subscription-actions">
          <button class="btn btn-primary" type="button" data-agent-action="save-credential">PAT 등록·검증</button>
        </div>
      </div>`;
    }
    const syncBadge = credential.last_sync_status === "ok"
      ? `마지막 동기화 ${agentDisplayDateTime(credential.last_sync_at)}`
      : credential.last_sync_status === "error"
        ? `동기화 오류 · ${credential.last_sync_message || "원인 미상"}`
        : "아직 동기화하지 않았습니다";
    return `<div class="agent-credential" data-agent-credential>
      <strong>자동 수집 연결됨</strong>
      <p class="agent-window-meta">GitHub 계정 ${esc(credential.account_login)} · 월 포함량 ${credential.monthly_included_requests === null ? "미설정 (잔여 계산 불가)" : esc(String(credential.monthly_included_requests)) + "건"}</p>
      <p class="agent-window-meta" data-status="${attr(credential.last_sync_status)}">${esc(syncBadge)}</p>
      <div class="agent-subscription-actions">
        <button class="btn btn-primary" type="button" data-agent-action="sync-credential">지금 동기화</button>
        <button class="btn btn-ghost" type="button" data-agent-action="delete-credential">PAT 삭제</button>
      </div>
    </div>`;
  }

  function renderAgentSubscriptions(data) {
    const cards = $("agentSubscriptionCards");
    if (!cards) return;
    const openProviders = new Set(Array.from(cards.querySelectorAll("[data-agent-provider-card][open]"))
      .map((row) => row.dataset.agentProvider));
    const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul";
    const providerOrder = { claude: 0, codex: 1, copilot: 2 };
    const providers = [...(data.providers || [])].sort((left, right) =>
      (providerOrder[left.provider] ?? 99) - (providerOrder[right.provider] ?? 99));
    cards.innerHTML = providers.map((providerData) => {
      const subscription = providerData.subscription;
      const cardStatus = subscription?.renewal_status || (subscription ? "fresh" : "unconfigured");
      const renewalCopy = !subscription?.next_renewal_on
        ? "갱신일 미입력"
        : subscription.renewal_status === "stale"
          ? `${subscription.next_renewal_on} (다시 확인 필요)`
          : `${subscription.next_renewal_on} (${subscription.days_until_renewal === 0 ? "오늘" : `D-${subscription.days_until_renewal}`})`;
      const detailsId = `agentProviderDetail-${providerData.provider}`;
      const isOpen = openProviders.has(providerData.provider);
      return `<details class="agent-subscription-card agent-provider-row" data-agent-provider-card data-agent-provider="${attr(providerData.provider)}" ${isOpen ? "open" : ""}>
        <summary class="agent-provider-summary">
          <span class="agent-provider-identity">
            <strong>${esc(providerData.label)}</strong>
            <small>${esc(subscription?.plan_label || "구독 정보 저장 필요")}</small>
          </span>
          <span class="agent-provider-renewal">
            <small>다음 갱신</small>
            <span class="agent-status-badge" data-status="${attr(cardStatus)}">${esc(subscription ? renewalCopy : "구독 미입력")}</span>
          </span>
          <span class="agent-provider-usage-summary">
            ${agentProviderUsageSummary(providerData, !!subscription)}
          </span>
          <span class="agent-provider-toggle" aria-hidden="true">상세 설정</span>
        </summary>
        <div class="agent-provider-detail" id="${attr(detailsId)}">
          <div class="agent-subscription-head">
          <div>
            <strong>${esc(providerData.label)} 구독 설정</strong>
            <a href="${attr(providerData.verification_url)}" target="_blank" rel="noopener noreferrer">공식 확인 안내 ↗</a>
          </div>
          </div>
          <p class="agent-window-meta">${esc(providerData.verification_guidance)}</p>
          <div class="agent-subscription-fields">
            <label>플랜명
              <input data-agent-subscription-field="plan_label" type="text" maxlength="80" placeholder="예: Pro" value="${attr(subscription?.plan_label || "")}" />
            </label>
            <label>결제 주기
              <select data-agent-subscription-field="billing_interval">
                <option value="unknown" ${!subscription || subscription.billing_interval === "unknown" ? "selected" : ""}>모름</option>
                <option value="monthly" ${subscription?.billing_interval === "monthly" ? "selected" : ""}>월간</option>
                <option value="yearly" ${subscription?.billing_interval === "yearly" ? "selected" : ""}>연간</option>
              </select>
            </label>
            <label>다음 갱신일
              <input data-agent-subscription-field="next_renewal_on" type="date" value="${attr(subscription?.next_renewal_on || "")}" />
            </label>
            <label>시간대
              <input data-agent-subscription-field="timezone" type="text" maxlength="64" value="${attr(subscription?.timezone || localTimezone)}" />
            </label>
          </div>
          <div class="agent-subscription-actions">
            <button class="btn btn-primary" type="button" data-agent-action="save-subscription">구독 저장</button>
            <button class="btn btn-ghost" type="button" data-agent-action="delete-subscription" ${subscription ? "" : "disabled"}>구독 삭제</button>
          </div>
          ${agentCredentialSection(providerData)}
          <div class="agent-window-list">
            ${(providerData.windows || []).map((windowData) => agentWindowCard(windowData, !!subscription)).join("")}
          </div>
        </div>
      </details>`;
    }).join("");
    updateAgentSubscriptionOverview(providers);
  }

  function setAgentSubscriptionStatus(message, danger = false) {
    const status = $("agentSubscriptionStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("danger", danger);
  }

  async function agentSubscriptionRequest(path, options) {
    const response = await window.apiFetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  async function loadAgentSubscriptions() {
    const button = $("btnReloadAgentSubscriptions");
    if (button) button.disabled = true;
    setAgentSubscriptionStatus("구독 정보를 불러오는 중...");
    try {
      const data = await agentSubscriptionRequest("/api/agent-subscriptions");
      renderAgentSubscriptions(data);
      setAgentSubscriptionStatus(data.automatic_sync
        ? "수동 확인값과 자동 수집 상태를 표시했습니다."
        : "수동 확인값을 표시했습니다. Copilot 카드에서 PAT를 등록하면 자동 수집을 켤 수 있습니다.");
    } catch (error) {
      setAgentSubscriptionStatus("구독 정보 불러오기 실패: " + error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function agentField(container, selector) {
    return container.querySelector(selector);
  }

  function agentOptionalNumber(input) {
    const value = input?.value?.trim();
    return value ? Number(value) : null;
  }

  async function saveAgentSubscription(button, card) {
    const provider = card.dataset.agentProvider;
    const value = (name) => agentField(card, `[data-agent-subscription-field="${name}"]`)?.value || "";
    button.disabled = true;
    setAgentSubscriptionStatus(`${provider} 구독 저장 중...`);
    try {
      const result = await agentSubscriptionRequest(`/api/agent-subscriptions/${encodeURIComponent(provider)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan_label: value("plan_label"),
          billing_interval: value("billing_interval"),
          next_renewal_on: value("next_renewal_on") || null,
          timezone: value("timezone"),
          renewal_source: "manual",
          verified_at: new Date().toISOString(),
        }),
      });
      renderAgentSubscriptions(result.dashboard);
      setAgentSubscriptionStatus(result.applied ? `${provider} 구독을 저장했습니다.` : "더 최신 확인값이 있어 이 입력은 적용하지 않았습니다.");
    } catch (error) {
      setAgentSubscriptionStatus(`${provider} 구독 저장 실패: ${error.message}`, true);
      button.disabled = false;
    }
  }

  async function saveAgentWindow(button, card, row) {
    const provider = card.dataset.agentProvider;
    const windowKind = row.dataset.agentWindow;
    const value = (name) => agentField(row, `[data-agent-window-field="${name}"]`)?.value || "";
    const status = value("status");
    const fresh = status === "fresh";
    let resetsAt = null;
    if (fresh && value("resets_at")) {
      const parsed = new Date(value("resets_at"));
      if (Number.isFinite(parsed.getTime())) resetsAt = parsed.toISOString();
    }
    button.disabled = true;
    setAgentSubscriptionStatus(`${provider} ${windowKind} 저장 중...`);
    try {
      const result = await agentSubscriptionRequest(
        `/api/agent-subscriptions/${encodeURIComponent(provider)}/windows/${encodeURIComponent(windowKind)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status,
            remaining_value: fresh ? agentOptionalNumber(agentField(row, '[data-agent-window-field="remaining_value"]')) : null,
            limit_value: fresh ? agentOptionalNumber(agentField(row, '[data-agent-window-field="limit_value"]')) : null,
            unit: fresh ? value("unit") : "unknown",
            resets_at: resetsAt,
            message: value("message"),
            source: "manual",
            observed_at: new Date().toISOString(),
          }),
        },
      );
      renderAgentSubscriptions(result.dashboard);
      setAgentSubscriptionStatus(result.applied ? `${provider} ${windowKind} 관측값을 저장했습니다.` : "더 최신 관측값이 있어 이 입력은 적용하지 않았습니다.");
    } catch (error) {
      setAgentSubscriptionStatus(`${provider} ${windowKind} 저장 실패: ${error.message}`, true);
      button.disabled = false;
    }
  }

  async function deleteAgentSubscriptionFromCard(button, card) {
    const provider = card.dataset.agentProvider;
    if (!window.confirm(`${provider} 구독과 해당 사용량 관측값을 삭제할까요?`)) return;
    button.disabled = true;
    setAgentSubscriptionStatus(`${provider} 구독 삭제 중...`);
    try {
      const result = await agentSubscriptionRequest(`/api/agent-subscriptions/${encodeURIComponent(provider)}`, { method: "DELETE" });
      renderAgentSubscriptions(result.dashboard);
      setAgentSubscriptionStatus(result.deleted ? `${provider} 구독을 삭제했습니다.` : "삭제할 구독이 없습니다.");
    } catch (error) {
      setAgentSubscriptionStatus(`${provider} 구독 삭제 실패: ${error.message}`, true);
      button.disabled = false;
    }
  }

  function syncAgentWindowFields(row) {
    if (row.dataset.agentWindowEditable !== "1") return;
    const fresh = agentField(row, '[data-agent-window-field="status"]')?.value === "fresh";
    row.dataset.status = fresh ? "fresh" : (agentField(row, '[data-agent-window-field="status"]')?.value || "unconfigured");
    row.querySelectorAll("[data-agent-current]").forEach((input) => { input.disabled = !fresh; });
  }

  async function saveAgentCredential(button, card) {
    const provider = card.dataset.agentProvider;
    const section = button.closest("[data-agent-credential]");
    const patInput = section?.querySelector('[data-agent-credential-field="pat"]');
    const includedInput = section?.querySelector('[data-agent-credential-field="monthly_included_requests"]');
    const pat = patInput?.value?.trim() || "";
    if (!pat) {
      setAgentSubscriptionStatus("PAT를 입력하세요.", true);
      return;
    }
    button.disabled = true;
    setAgentSubscriptionStatus(`${provider} PAT 검증·등록 중...`);
    try {
      const result = await agentSubscriptionRequest(`/api/agent-subscriptions/${encodeURIComponent(provider)}/credential`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pat,
          monthly_included_requests: agentOptionalNumber(includedInput),
        }),
      });
      if (patInput) patInput.value = "";
      renderAgentSubscriptions(result.dashboard);
      setAgentSubscriptionStatus(result.sync?.synced
        ? `PAT를 등록하고 자동 수집을 시작했습니다 (이번 달 사용 ${result.sync.used_requests}건).`
        : `PAT를 등록했지만 첫 동기화에 문제가 있습니다: ${result.sync?.unknown_reason || "원인 미상"}`,
        !result.sync?.synced);
    } catch (error) {
      setAgentSubscriptionStatus(`PAT 등록 실패: ${error.message}`, true);
      button.disabled = false;
    }
  }

  async function syncAgentCredential(button, card) {
    const provider = card.dataset.agentProvider;
    button.disabled = true;
    setAgentSubscriptionStatus(`${provider} 자동 수집 실행 중...`);
    try {
      const result = await agentSubscriptionRequest(`/api/agent-subscriptions/${encodeURIComponent(provider)}/sync`, { method: "POST" });
      renderAgentSubscriptions(result.dashboard);
      setAgentSubscriptionStatus(result.sync?.synced
        ? `자동 수집 완료 — 이번 달 사용 ${result.sync.used_requests}건, 잔여 ${result.sync.remaining_value}건.`
        : `자동 수집 실패: ${result.sync?.unknown_reason || "원인 미상"}`,
        !result.sync?.synced);
    } catch (error) {
      setAgentSubscriptionStatus(`자동 수집 실패: ${error.message}`, true);
      button.disabled = false;
    }
  }

  async function deleteAgentCredential(button, card) {
    const provider = card.dataset.agentProvider;
    if (!window.confirm(`${provider}에 등록된 PAT를 삭제할까요? 자동 수집이 중단됩니다.`)) return;
    button.disabled = true;
    setAgentSubscriptionStatus(`${provider} PAT 삭제 중...`);
    try {
      const result = await agentSubscriptionRequest(`/api/agent-subscriptions/${encodeURIComponent(provider)}/credential`, { method: "DELETE" });
      renderAgentSubscriptions(result.dashboard);
      setAgentSubscriptionStatus(result.deleted ? "PAT를 삭제했습니다." : "삭제할 PAT가 없습니다.");
    } catch (error) {
      setAgentSubscriptionStatus(`PAT 삭제 실패: ${error.message}`, true);
      button.disabled = false;
    }
  }

  function onAgentSubscriptionClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("[data-agent-action]");
    const card = button?.closest("[data-agent-provider-card]");
    if (!button || !card) return;
    if (button.dataset.agentAction === "save-subscription") saveAgentSubscription(button, card);
    if (button.dataset.agentAction === "delete-subscription") deleteAgentSubscriptionFromCard(button, card);
    if (button.dataset.agentAction === "save-credential") saveAgentCredential(button, card);
    if (button.dataset.agentAction === "sync-credential") syncAgentCredential(button, card);
    if (button.dataset.agentAction === "delete-credential") deleteAgentCredential(button, card);
    if (button.dataset.agentAction === "save-window") {
      const row = button.closest("[data-agent-window-row]");
      if (row) saveAgentWindow(button, card, row);
    }
  }

  function initAgentSubscriptions() {
    const cards = $("agentSubscriptionCards");
    if (!cards) return;
    cards.addEventListener("click", onAgentSubscriptionClick);
    cards.addEventListener("change", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.matches('[data-agent-window-field="status"]')) return;
      const row = target.closest("[data-agent-window-row]");
      if (row) syncAgentWindowFields(row);
    });
    $("btnReloadAgentSubscriptions")?.addEventListener("click", loadAgentSubscriptions);
    loadAgentSubscriptions();
  }

  function renderBudget(data) {
    const daily = $("budgetDailyLimit");
    const warn = $("budgetWarnThreshold");
    const mode = $("budgetBlockMode");
    const email = $("budgetEmailAlerts");
    if (!daily || !warn || !mode) return;
    daily.value = Math.round(Number(data.daily_limit_krw || data.limit_krw || 500));
    warn.value = Math.round(Number(data.warn_threshold_krw || Math.round(Number(daily.value) * 0.8)));
    mode.value = data.block_on_exceed === false ? "warn" : "block";
    if (email) email.checked = data.alert_email_enabled !== false;
    const status = $("budgetStatus");
    if (status) {
      status.classList.toggle("danger", !!data.warning);
      status.textContent = data.warning?.message || `잔여 ${Math.max(0, Math.round(Number(data.remaining_krw || 0))).toLocaleString("ko-KR")}원`;
    }
  }

  async function initBudget() {
    const btn = $("btnSaveBudget");
    if (!btn) return;
    btn.addEventListener("click", saveBudget);
    $("btnResetUsageBudget")?.addEventListener("click", resetUsageBudget);
    if (window.refreshUsage) window.refreshUsage().catch(() => {});
    try {
      const res = await window.apiFetch("/api/usage/limits");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      renderBudget(data);
    } catch (err) {
      const status = $("budgetStatus");
      if (status) {
        status.textContent = "한도 설정 불러오기 실패: " + err.message;
        status.classList.add("danger");
      }
    }
  }

  async function resetUsageBudget() {
    const btn = $("btnResetUsageBudget");
    const status = $("usageResetStatus");
    if (!btn || !status) return;
    const confirmed = window.confirm(
      "현재 AI 사용 구간을 마감하고 일 한도를 다시 채울까요?\n\n사용 기록과 오늘 누적 금액은 삭제되지 않습니다."
    );
    if (!confirmed) return;
    btn.disabled = true;
    status.classList.remove("danger");
    status.textContent = "리셋 중...";
    try {
      const res = await window.apiFetch("/api/usage/reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (window.renderUsageSummary) window.renderUsageSummary(data);
      status.textContent = `리셋 ${Math.max(0, Number(data.reset_count) || 0)}회 · 이전 사용금액 ${Math.round(Number(data.previous_used_krw) || 0).toLocaleString("ko-KR")}원 · 잔여 ${Math.round(Number(data.remaining_krw) || 0).toLocaleString("ko-KR")}원`;
      const budgetStatus = $("budgetStatus");
      if (budgetStatus) {
        budgetStatus.classList.remove("danger");
        budgetStatus.textContent = `잔여 ${Math.round(Number(data.remaining_krw) || 0).toLocaleString("ko-KR")}원`;
      }
    } catch (err) {
      status.textContent = "리셋 실패: " + err.message;
      status.classList.add("danger");
    } finally {
      btn.disabled = false;
    }
  }

  async function saveBudget() {
    const status = $("budgetStatus");
    const btn = $("btnSaveBudget");
    const body = {
      daily_limit_krw: Number($("budgetDailyLimit").value),
      warn_threshold_krw: Number($("budgetWarnThreshold").value),
      block_on_exceed: $("budgetBlockMode").value !== "warn",
      alert_email_enabled: $("budgetEmailAlerts")?.checked !== false,
    };
    status.textContent = "저장 중...";
    status.classList.remove("danger");
    btn.disabled = true;
    try {
      const res = await window.apiFetch("/api/usage/limits", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      renderBudget(data);
      status.textContent = `저장됨 · 일 한도 ${Math.round(data.daily_limit_krw).toLocaleString("ko-KR")}원 · 알림 ${Math.round(data.warn_threshold_krw).toLocaleString("ko-KR")}원 · 이메일 ${data.alert_email_enabled === false ? "끔" : "켬"}`;
      if (window.refreshUsage) window.refreshUsage().catch(() => {});
    } catch (err) {
      status.textContent = "실패: " + err.message;
      status.classList.add("danger");
    } finally {
      btn.disabled = false;
    }
  }

  async function save() {
    const status = $("saveStatus");
    status.textContent = "저장 중..."; status.classList.remove("danger");
    const prompt = $("prompt").value.trim();
    const body = {
      provider: $("provider").value,
      model: $("model").value,
      custom_prompt: prompt && prompt !== defaultPrompt.trim() ? prompt : null,
      stage_models: collectStageSettings(),
    };
    try {
      const res = await window.apiFetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const stageCount = Object.keys(data.stage_models || {}).length;
      status.textContent = `저장됨 (${data.provider}/${data.model}${data.custom_prompt ? ", 커스텀 프롬프트" : ", 기본 프롬프트"} · 단계 ${stageCount}개)`;
    } catch (err) {
      status.textContent = "실패: " + err.message; status.classList.add("danger");
    }
  }
  }
  if (window.__sduiRegisterBoot) window.__sduiRegisterBoot("mypage", bootMypage);
  else bootMypage();
})();
