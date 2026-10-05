(() => {
  const API_BASE = "/api/nblog/campaigns";
  const CONTRACT_VERSION = "1.1";
  const PROMPT_API = "/api/nblog/prompt-profiles";
  const HANDOFF_CODE_PREFIX = "NBLOG_HANDOFF_V1.";
  const DRAFT_PAYLOAD_PREFIX = "NBLOG_DRAFT_V1.";
  const BOOKMARKLET_SOURCE_URL = "/nblog-handoff/bookmarklet.js";
  const HELPER_DOWNLOAD_URL = "/downloads/nblog-smarteditor-helper.zip";
  const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  // 마케팅 담당자가 바로 이해하는 말로 씁니다. 내부 용어(인계·산출물·검증)를 그대로
  // 노출하지 않습니다.
  const PHASE_LABELS = {
    queued: "사진 기다리는 중",
    analysis: "글 만드는 중",
    validation: "글 확인하기",
    approval: "올릴 준비 완료",
    scheduled: "올릴 준비 완료",
    published: "블로그에 올림",
    failed: "다시 만들어야 함",
    handoff: "블로그에 올릴 차례",
    archived: "보관됨",
  };
  const PHASE_INDEX = { queued: 0, analysis: 1, validation: 2, approval: 3, scheduled: 4, published: 5, failed: 2, handoff: 4, archived: 0 };
  const PHASE_ALIASES = {
    scanning: "analysis",
    generating: "analysis",
    validating: "validation",
    awaiting_approval: "approval",
    approved: "scheduled",
    needs_handoff: "handoff",
  };

  const refs = {
    list: document.getElementById("campaignList"),
    empty: document.getElementById("campaignEmpty"),
    filters: document.getElementById("campaignFilters"),
    search: document.getElementById("campaignSearch"),
    scheduleList: document.getElementById("scheduleList"),
    scheduleEmpty: document.getElementById("scheduleEmpty"),
    auditBody: document.getElementById("auditTableBody"),
    refresh: document.getElementById("refreshCampaigns"),
    retryConnection: document.getElementById("retryConnection"),
    syncLabel: document.getElementById("syncLabel"),
    backendTitle: document.getElementById("backendStatusTitle"),
    backendMessage: document.getElementById("backendStatusMessage"),
    backendHealth: document.getElementById("backendHealth"),
    dialog: document.getElementById("campaignDialog"),
    form: document.getElementById("campaignForm"),
    formError: document.getElementById("campaignFormError"),
    formSubmit: document.getElementById("campaignFormSubmit"),
    detailsDialog: document.getElementById("campaignDetailsDialog"),
    detailsTitle: document.getElementById("campaignDetailsTitle"),
    detailsBody: document.getElementById("campaignDetailsBody"),
    publishDialog: document.getElementById("campaignPublishDialog"),
    publishTitle: document.getElementById("campaignPublishTitle"),
    publishBody: document.getElementById("campaignPublishBody"),
    promptProfile: document.getElementById("newCampaignPromptProfile"),
    mediaInput: document.getElementById("newCampaignMedia"),
    importUrl: document.getElementById("campaignImportUrl"),
    inspectCampaignButton: document.getElementById("inspectCampaignButton"),
    promptProfilesButton: document.getElementById("promptProfilesButton"),
    syncTokenButton: document.getElementById("syncTokenButton"),
    currentDateChip: document.getElementById("currentDateChip"),
    toast: document.getElementById("nblogToast"),
  };
  if (!refs.list || !refs.filters || !refs.search || !refs.form) return;

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
  const state = { campaigns: [], archived: [], audits: [], connected: false, loading: false, error: "", handoff: null, manage: null, promptProfiles: [] };
  let activeFilter = "all";
  let toastTimer = 0;

  class ApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.status = status;
      this.payload = payload;
    }
  }

  async function apiRequest(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const requestId = globalThis.crypto?.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const headers = {
      Accept: "application/json",
      "X-NBlog-Contract-Version": CONTRACT_VERSION,
      "X-Request-Id": requestId,
      ...(!["GET", "HEAD"].includes(method) ? { "Idempotency-Key": requestId } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    };
    const response = await fetch(url, { ...options, headers });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { throw new ApiError("API가 JSON이 아닌 응답을 반환했습니다.", response.status, text.slice(0, 300)); }
    }
    if (!response.ok) {
      const message = payload?.message || payload?.error?.message || `API 요청 실패 (${response.status})`;
      throw new ApiError(message, response.status, payload);
    }
    return payload;
  }

  const normalizePhase = (value) => {
    const phase = PHASE_ALIASES[value] || value;
    return PHASE_LABELS[phase] ? phase : "queued";
  };

  const isPublishedPostUrl = (value) => {
    try {
      const url = new URL(value);
      if (!["blog.naver.com", "m.blog.naver.com"].includes(url.hostname)) return false;
      return url.pathname.split("/").filter(Boolean).length >= 2;
    } catch { return false; }
  };

  const normalizeCampaign = (item) => ({
    id: String(item.campaign_id || item.id || "").slice(0, 64),
    name: String(item.campaign_name || item.name || "").slice(0, 120),
    visitDate: String(item.visit_date || item.visitDate || "").slice(0, 10),
    phase: normalizePhase(item.status || item.phase),
    scheduledDate: String(item.scheduled_date || item.scheduledDate || "").slice(0, 10),
    scheduledTime: String(item.scheduled_time || item.scheduledTime || "").slice(0, 5),
    publishedAt: String(item.published_at || item.publishedAt || "").slice(0, 30),
    publishedUrl: isPublishedPostUrl(item.published_url || item.publishedUrl) ? String(item.published_url || item.publishedUrl) : "",
    validationPassed: item.validation_passed === true || item.validationPassed === true || item.validation?.status === "passed",
    approved: item.approved === true,
    retryCount: Math.max(0, Number(item.retry_count ?? item.retryCount) || 0),
    retryLimit: Math.max(1, Number(item.retry_limit ?? item.retryLimit) || 3),
    failureStage: String(item.failure_stage || item.failureStage || "").slice(0, 80),
    failureReason: String(item.failure_reason || item.failureReason || "").slice(0, 180),
    resumePoint: String(item.resume_point || item.resumePoint || "").slice(0, 120),
    profile: String(item.tone_profile || item.profile || "규칙 미지정").slice(0, 80),
    requirementVersion: String(item.requirement_version || item.requirementVersion || "요구사항 없음").slice(0, 40),
    draftVersion: String(item.draft_version || item.draftVersion || "글 없음").slice(0, 40),
    note: String(item.note || item.status_message || "").slice(0, 200),
    updatedAt: String(item.updated_at || item.updatedAt || "").slice(0, 40),
    version: Math.max(1, Number(item.version) || 1),
    artifactVersion: Math.max(0, Number(item.artifact_version || item.artifactVersion) || 0),
    generationStatus: String(item.generation_status || item.generationStatus || "not_started"),
    validationVersion: String(item.validation_version || item.validationVersion || "확인 전").slice(0, 120),
    lastSyncAt: String(item.last_sync_at || item.lastSyncAt || "").slice(0, 40),
  });

  const normalizeAudit = (item) => ({
    campaignId: String(item.campaign_id || item.campaignId || "").slice(0, 64),
    campaignName: String(item.campaign_name || item.campaignName || "").slice(0, 120),
    result: ["success", "failed", "waiting"].includes(item.result) ? item.result : "waiting",
    resultLabel: String(item.result_label || item.resultLabel || item.action || "기록").slice(0, 60),
    processedAt: String(item.processed_at || item.processedAt || "").slice(0, 40),
    requirementVersion: String(item.requirement_version || item.requirementVersion || "요구사항 없음").slice(0, 40),
    draftVersion: String(item.draft_version || item.draftVersion || "글 없음").slice(0, 40),
    profile: String(item.profile_version || item.profile || "규칙 없음").slice(0, 40),
    nextAction: String(item.next_action || item.nextAction || "열어보기").slice(0, 100),
    url: isPublishedPostUrl(item.url || item.published_url) ? String(item.url || item.published_url) : "",
  });

  function showToast(message, isError = false) {
    window.clearTimeout(toastTimer);
    refs.toast.textContent = message;
    refs.toast.style.background = isError ? "#8f2e2a" : "#242b54";
    refs.toast.hidden = false;
    toastTimer = window.setTimeout(() => { refs.toast.hidden = true; }, 5000);
  }

  function setConnection(connected, message = "") {
    state.connected = connected;
    state.error = connected ? "" : message;
    // 정상일 때는 배너를 숨긴다 — 잘 되고 있다는 알림은 화면만 차지한다.
    const notice = document.getElementById("handoffNotice");
    if (notice) notice.hidden = connected;
    refs.backendTitle.textContent = connected ? "연결됨" : "서버에 연결되지 않았습니다";
    refs.backendMessage.textContent = connected
      ? ""
      : `${message || "잠시 후 다시 시도해주세요."}`;
    refs.backendHealth.classList.toggle("is-disconnected", !connected);
    refs.backendHealth.lastChild.textContent = connected ? " 연결됨" : " 미연결";
    refs.syncLabel.textContent = connected ? "새로고침" : "연결 안 됨";
  }

  const formatDate = (date) => {
    const match = String(date || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
    return match ? `${Number(match[1])}월 ${Number(match[2])}일` : "날짜 미정";
  };
  const shortProfile = (profile) => String(profile || "").replace(" 리뷰", "").replace(" 체험", "");
  const filterMatches = (item, filter) => {
    if (filter === "active") return ["queued", "analysis", "validation"].includes(item.phase);
    if (filter === "approval") return item.phase === "approval";
    if (filter === "scheduled") return item.phase === "scheduled";
    if (filter === "attention") return ["failed", "handoff"].includes(item.phase);
    if (filter === "archived") return item.phase === "archived";
    return true;
  };
  const phaseNote = (item) => {
    if (item.phase === "failed") return [item.failureStage, item.failureReason].filter(Boolean).join(" · ") || "실패 원인 확인 필요";
    if (item.phase === "handoff") return item.resumePoint || "사용자 인계 지점 확인 필요";
    return item.note || PHASE_LABELS[item.phase];
  };
  const progressHtml = (item) => {
    const currentIndex = PHASE_INDEX[item.phase] ?? 0;
    const bars = Array.from({ length: 6 }, (_, index) => `<i class="${index < currentIndex ? "is-done" : index === currentIndex ? "is-current" : ""}"></i>`).join("");
    return `<div class="nblog-progress-track${item.phase === "failed" ? " is-failed" : ""}" aria-hidden="true">${bars}</div>`;
  };
  const whenHtml = (item) => {
    if (item.phase === "scheduled") return `<strong>${esc(item.scheduledTime || "시간 미정")} 예약</strong><span>${esc(formatDate(item.scheduledDate))}</span>`;
    if (item.phase === "published") return `<strong>발행 완료</strong><span>${esc(item.publishedAt || "시각 미기록")}</span>`;
    if (item.phase === "failed") return `<strong>재개 지점</strong><span>${esc(item.resumePoint || item.failureStage || "확인 필요")}</span>`;
    if (item.phase === "handoff") return `<strong>인계 필요</strong><span>${esc(item.resumePoint || "확인 필요")}</span>`;
    return `<strong>${esc(formatDate(item.visitDate))}</strong><span>방문일</span>`;
  };
  const actionFor = (item) => {
    if (item.phase === "archived") return { label: "복원하기", action: "restore", style: "" };
    if (item.generationStatus === "awaiting_content_review") return { label: "글 확인", action: "review-content", style: "is-primary" };
    if (item.generationStatus === "content_confirmed") return { label: "승인 확인", action: "handoff", style: "is-primary" };
    if (item.phase === "approval") return { label: "올릴 준비 완료로 표시", action: "approve", style: "is-primary", disabled: !item.validationPassed };
    // 글 생성 실패는 산출물 재동기화(retry)가 아니라 다시 생성해야 풀린다.
    // 상세 화면으로 보내 사진·영상을 고치고 다시 만들 수 있게 한다.
    if (item.generationStatus === "generation_failed") return { label: "다시 만들기", action: "handoff", style: "is-danger" };
    if (item.phase === "failed") return { label: item.retryCount >= item.retryLimit ? "다시 시도 불가" : `재시도 ${item.retryCount}/${item.retryLimit}`, action: "retry", style: "is-danger", disabled: item.retryCount >= item.retryLimit };
    if (item.phase === "handoff") return { label: "블로그에 올리기", action: "handoff", style: "is-primary" };
    if (item.phase === "published") return { label: "올린 글 열기", action: "open", style: "", disabled: !item.publishedUrl };
    if (item.phase === "scheduled") return { label: "글 보기", action: "handoff", style: "is-primary" };
    if (item.phase === "validation") return { label: "확인하기", action: "details", style: "" };
    // 비활성 버튼은 "지금 왜 눌러지지 않는지" 원인을 보여준다(REQ-7). 사진은 새 캠페인
    // 다이얼로그에서, 방문일 수정·보관은 카드의 관리(⋯) 버튼에서 한다.
    if (item.phase === "queued") return { label: state.connected ? "사진 올리기 기다리는 중" : "연결 안 됨", action: "", style: "", disabled: true };
    return { label: state.connected ? "잠시만요" : "연결 안 됨", action: "", style: "", disabled: true };
  };

  function renderCampaigns() {
    const query = refs.search.value.trim().toLocaleLowerCase("ko-KR");
    // 보관함 탭은 별도로 조회한 보관 목록을 보여준다. 그 외에는 활성 캠페인만.
    const source = activeFilter === "archived" ? state.archived : state.campaigns;
    const visible = source.filter((item) => (!query || `${item.id} ${item.name}`.toLocaleLowerCase("ko-KR").includes(query)) && filterMatches(item, activeFilter));
    refs.list.innerHTML = visible.map((item) => {
      const action = actionFor(item);
      const note = phaseNote(item);
      // 상태 배지와 같은 말을 두 번 쓰지 않는다(REQ-6). 배지와 다른 정보(실패 원인·재개 지점)일 때만 덧붙인다.
      const showNote = note && note !== PHASE_LABELS[item.phase];
      // 보관 항목이 아니면 방문일 수정·보관을 여는 관리(⋯) 버튼을 둔다(REQ-1·2·3 진입점).
      const manage = item.phase === "archived" ? "" : `<button class="nblog-card-manage" type="button" data-action="manage" data-campaign-id="${esc(item.id)}" aria-label="${esc(item.name)} 관리" title="방문일 수정·보관">⋯</button>`;
      return `<article class="nblog-campaign-card" data-phase="${esc(item.phase)}">
        <div class="nblog-campaign-meta"><span class="nblog-campaign-id">${esc(item.id)} · ${esc(formatDate(item.visitDate))}</span><h3 title="${esc(item.name)}">${esc(item.name)}</h3><p class="nblog-campaign-profile" title="${esc(item.profile)}">${esc(item.profile)}</p></div>
        <div class="nblog-progress"><div class="nblog-progress-head"><span class="nblog-status-badge" data-phase="${esc(item.phase)}">${esc(PHASE_LABELS[item.phase])}</span>${showNote ? `<span class="nblog-progress-note" title="${esc(note)}">${esc(note)}</span>` : ""}</div>${progressHtml(item)}</div>
        <div class="nblog-campaign-when">${whenHtml(item)}</div>
        <div class="nblog-card-actions">${manage}<button class="nblog-card-action ${esc(action.style)}" type="button" data-action="${esc(action.action)}" data-campaign-id="${esc(item.id)}" ${action.disabled ? "disabled" : ""}>${esc(action.label)}</button></div>
      </article>`;
    }).join("");
    refs.empty.hidden = visible.length > 0;
    if (!visible.length) refs.empty.textContent = state.connected ? (activeFilter === "archived" ? "보관한 캠페인이 없습니다." : "찾는 캠페인이 없습니다.") : "서버에 연결되지 않아 캠페인을 불러오지 못했습니다.";
  }

  function renderKpis() {
    const counts = {
      all: state.campaigns.length,
      active: state.campaigns.filter((item) => ["queued", "analysis", "validation"].includes(item.phase)).length,
      approval: state.campaigns.filter((item) => item.phase === "approval").length,
      scheduled: state.campaigns.filter((item) => item.phase === "scheduled" && item.scheduledDate === TODAY).length,
      attention: state.campaigns.filter((item) => ["failed", "handoff"].includes(item.phase)).length,
    };
    for (const [key, value] of Object.entries(counts)) document.getElementById(`kpi${key[0].toUpperCase()}${key.slice(1)}`).textContent = String(value);
  }

  function renderSchedule() {
    const scheduled = state.campaigns.filter((item) => item.phase === "scheduled" && item.scheduledDate === TODAY).sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
    refs.scheduleList.innerHTML = scheduled.map((item) => `<li><time class="nblog-schedule-time">${esc(item.scheduledTime || "미정")}</time><div class="nblog-schedule-copy"><strong>${esc(item.name)}</strong><span>${esc(item.id)} · ${esc(shortProfile(item.profile))}</span></div></li>`).join("");
    refs.scheduleEmpty.hidden = scheduled.length > 0;
  }

  function renderAudits() {
    if (!state.audits.length) {
      refs.auditBody.innerHTML = `<tr><td colspan="5">${state.connected ? "저장된 실제 감사 이력이 없습니다." : "서버에 연결되지 않았습니다로 감사 이력을 조회할 수 없습니다."}</td></tr>`;
      return;
    }
    refs.auditBody.innerHTML = state.audits.slice(0, 8).map((item) => {
      const resultClass = item.result === "success" ? "is-success" : item.result === "failed" ? "is-failed" : "";
      const action = item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.nextAction)}</a>` : esc(item.nextAction);
      return `<tr><td>${esc(item.campaignId)} · ${esc(item.campaignName)}</td><td><span class="nblog-audit-result ${resultClass}"><i></i>${esc(item.resultLabel)}</span></td><td>${esc(item.processedAt || "미기록")}</td><td><div class="nblog-version-stack"><span>${esc(item.requirementVersion)}</span><span>${esc(item.draftVersion)}</span><span>${esc(item.profile)}</span></div></td><td>${action}</td></tr>`;
    }).join("");
  }

  function render() {
    renderCampaigns();
    renderKpis();
    renderSchedule();
    renderAudits();
  }

  async function loadPromptProfiles() {
    refs.promptProfile.innerHTML = '<option value="">시스템 기본 프롬프트</option>';
    if (!state.connected) return;
    try {
      const payload = await apiRequest(PROMPT_API);
      const profiles = Array.isArray(payload) ? payload : payload?.profiles || [];
      for (const profile of profiles.filter((item) => item.is_active !== false)) {
        const option = document.createElement("option");
        option.value = String(profile.prompt_profile_id || profile.id || "");
        option.textContent = `${profile.name || option.value} · v${profile.version || 1}`;
        refs.promptProfile.append(option);
      }
    } catch (error) {
      showToast(`프롬프트 프로필 조회 실패: ${error.message}`, true);
    }
  }

  async function loadCampaigns({ notify = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    refs.refresh.classList.add("is-spinning");
    refs.syncLabel.textContent = "실제 API 조회 중";
    try {
      const payload = await apiRequest(API_BASE);
      const campaigns = Array.isArray(payload) ? payload : payload?.campaigns;
      if (!Array.isArray(campaigns)) throw new ApiError("캠페인 배열이 없는 API 응답입니다.", 502, payload);
      state.campaigns = campaigns.map(normalizeCampaign).filter((item) => item.id && item.name);
      state.audits = (Array.isArray(payload?.audits) ? payload.audits : []).map(normalizeAudit).filter((item) => item.campaignId);
      // 보관함은 별도 조회. 실패해도 기본 목록·연결 상태에는 영향 주지 않는다.
      try {
        const archivedPayload = await apiRequest(`${API_BASE}?view=archived`);
        const archived = Array.isArray(archivedPayload) ? archivedPayload : archivedPayload?.campaigns;
        state.archived = (Array.isArray(archived) ? archived : []).map(normalizeCampaign).filter((item) => item.id && item.name);
      } catch { state.archived = []; }
      setConnection(true);
      await loadPromptProfiles();
      if (notify) showToast("실제 API에서 캠페인 상태를 다시 불러왔습니다.");
    } catch (error) {
      state.campaigns = [];
      state.archived = [];
      state.audits = [];
      refs.promptProfile.innerHTML = '<option value="">시스템 기본 프롬프트</option>';
      setConnection(false, error.message);
      if (notify) showToast(`불러오기 실패: ${error.message}`, true);
    } finally {
      state.loading = false;
      refs.refresh.classList.remove("is-spinning");
      render();
    }
  }

  function setFilter(filter) {
    activeFilter = filter;
    refs.filters.querySelectorAll("[data-filter]").forEach((button) => {
      const active = button.dataset.filter === filter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-kpi-filter]").forEach((button) => {
      const active = button.dataset.kpiFilter === filter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    renderCampaigns();
  }

  function showDetails(title, payload) {
    refs.detailsTitle.textContent = title;
    const checks = Array.isArray(payload?.checks) ? payload.checks : [];
    const summary = payload?.summary || {};
    refs.detailsBody.innerHTML = `<div class="nblog-details-summary"><strong>${esc(payload?.status || "상태 미기록")}</strong><span>오류 ${esc(summary.errors ?? "-")} · 경고 ${esc(summary.warnings ?? "-")} · 통과 ${esc(summary.passed ?? "-")}</span></div>${checks.length ? checks.map((check) => `<div class="nblog-details-check ${check.status === "error" ? "is-error" : check.status === "warning" ? "is-warning" : ""}"><strong>${esc(check.rule)}</strong><span>${esc(check.message)}</span><small>기대 ${esc(JSON.stringify(check.expected))} · 실제 ${esc(JSON.stringify(check.actual))} · ${esc(check.location || "위치 미기록")}</small></div>`).join("") : `<div class="nblog-details-summary"><span>표시할 구조화 항목이 없습니다.</span><pre>${esc(JSON.stringify(payload, null, 2))}</pre></div>`}`;
    if (!refs.detailsDialog.open) refs.detailsDialog.showModal();
  }

  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); }
    catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  }

  function base64UrlJson(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function handoffConnectionCode(issued) {
    const session = issued?.handoff_session || {};
    if (!issued?.claim_token || !session.id || !issued.claim_path) {
      throw new Error("자동입력 연결 정보가 없습니다. 새 연결 코드를 만들어주세요.");
    }
    return HANDOFF_CODE_PREFIX + base64UrlJson({
      version: 1,
      api_origin: location.origin,
      session_id: String(session.id),
      claim_path: String(issued.claim_path),
      claim_token: String(issued.claim_token),
      contract_version: String(issued.contract_version || CONTRACT_VERSION),
      expires_at: String(session.expires_at || ""),
    });
  }

  function draftTransferPayload(payload) {
    const copy = handoffCopyValues(payload || {});
    return DRAFT_PAYLOAD_PREFIX + base64UrlJson({
      version: 1,
      title: copy.title,
      body: copy.body,
      tags: copy.tags,
      place_name: copy.placeName,
      target_blog: String(payload?.smart_editor?.blog_url || ""),
      category: String(payload?.smart_editor?.category || ""),
    });
  }

  function clearHandoffSecret(payload = state.handoff) {
    if (payload?.handoff_session_issue?.claim_token) delete payload.handoff_session_issue.claim_token;
  }

  const checkClass = (status) => status === "error" ? "is-error" : status === "warning" ? "is-warning" : "is-passed";
  function validationDetailsHtml(validation) {
    if (!validation) return '<div class="nblog-details-summary is-warning"><strong>검증 데이터 없음</strong><span>로컬에서 nblog run 후 sync를 실행하세요.</span></div>';
    const checks = Array.isArray(validation.checks) ? validation.checks : [];
    return `<div class="nblog-details-summary"><strong>${esc(validation.status || "상태 미기록")}</strong><span>오류 ${esc(validation.summary?.errors ?? "-")} · 경고 ${esc(validation.summary?.warnings ?? "-")} · 통과 ${esc(validation.summary?.passed ?? "-")}</span></div>
      <div class="nblog-validation-list">${checks.map((check) => `<article class="nblog-details-check ${checkClass(check.status)}" data-location="${esc(check.location || "")}"><strong>${esc(check.rule)}</strong><span>${esc(check.message || "")}</span><small>기대 ${esc(JSON.stringify(check.expected))} · 실제 ${esc(JSON.stringify(check.actual))}</small><code>${esc(check.location || "근거 위치 미기록")}</code></article>`).join("") || '<p>구조화된 검증 항목이 없습니다.</p>'}</div>`;
  }

  /** 네이버 로그인 연결 상태 (#194 Phase 2). 자동입력 도우미 상단에 붙는다. */
  function accountConnectionHtml(payload) {
    const conn = payload.account_connections || {};
    const naver = conn.naver_login || {};
    const naverLinked = naver.linked === true;
    const naverText = naverLinked
      ? `연결됨${naver.display_name ? ` · ${esc(naver.display_name)}` : ""}`
      : `연결 안 됨 · <a href="/api/auth/naver">네이버 계정 연결</a>`;
    const browserNote = esc(conn.browser_session?.note || "SmartEditor 탭의 로그인 상태는 자동입력 도우미가 브라우저에서 확인합니다.");
    return `<div class="nblog-account-status">
      <p><strong>네이버 로그인 연결</strong> <span class="${naverLinked ? "is-ok" : "is-warn"}">${naverText}</span> <small>(Planning Harness 서버 계정)</small></p>
      <p><strong>SmartEditor 로그인</strong> <span class="is-muted">도우미에서 확인</span> <small>${browserNote}</small></p>
    </div>`;
  }

  /**
   * 초안 모양이 둘이다. 로컬 CLI(evidence-draft-v3)는 selected_title·tags.final 을
   * 주고, Worker 생성은 title 과 markdown 만 준다(태그는 본문 마지막 줄의 해시태그).
   * 어느 쪽이든 제목·본문·태그가 채워지도록 읽는다.
   */
  function handoffCopyValues(handoff) {
    const draft = handoff.draft || {};
    const title = String(draft.selected_title || draft.title_candidates?.[0] || draft.title || "");
    const rawBody = String(draft.markdown || (draft.body_blocks || []).map((block) => block.markdown || "").join("\n\n"));
    const listed = (draft.tags?.final || []).map((tag) => `#${tag}`).join(" ");

    // Worker 초안은 태그가 본문 끝에 붙어 있다. 떼어내 태그 칸으로 옮긴다.
    const lines = rawBody.split("\n");
    let lastText = lines.length - 1;
    while (lastText >= 0 && !lines[lastText].trim()) lastText -= 1;
    const trailing = lastText >= 0 ? lines[lastText].trim() : "";
    const isTagLine = trailing.startsWith("#") && !trailing.startsWith("##") && /#[^\s#]+/.test(trailing);

    const tags = listed || (isTagLine ? trailing : "");
    const body = !listed && isTagLine ? lines.slice(0, lastText).join("\n").trimEnd() : rawBody;
    // 장소는 스마트에디터 장소 버튼으로 넣는다. 링크가 아니라 검색어(가게 이름)를 준다 —
    // naver.me 날링크는 장소 카드로 안 바뀌지만, 이름으로 검색하면 바로 붙는다.
    const placeName = String(handoff.campaign?.campaign_name || "");
    return { title, body, tags, placeName, all: `${title}\n\n${body}\n\n${tags}`.trim() };
  }

  // ── 섹션 렌더러 ────────────────────────────────────────────────────────────
  // 하나의 거대한 템플릿 리터럴이던 것을 섹션 단위로 나눈다. 각 함수는 view 객체만
  // 읽고 HTML 문자열을 돌려주므로, #184 에서 SOURCE/PREVIEW 로 재배치할 때 순서만
  // 바꾸면 된다. 출력은 분해 전과 동일하다.
  const section = (title, inner, attrs = "") =>
    `<section class="nblog-workspace-section"${attrs}><h3>${title}</h3>${inner}</section>`;

  /** 평소엔 요약만 보이고 필요할 때 펴는 섹션. 세로 길이를 줄인다. */
  const collapsible = (title, summary, inner, open = false) =>
    `<section class="nblog-workspace-section is-collapsible"><details${open ? " open" : ""}><summary><h3>${title}</h3><span class="nblog-collapse-summary">${summary}</span></summary><div class="nblog-collapse-body">${inner}</div></details></section>`;

  function handoffView(payload) {
    const campaign = payload.campaign || {};
    const media = Array.isArray(payload.media) ? payload.media : [];
    return {
      payload,
      campaign,
      media,
      draft: payload.draft,
      copy: handoffCopyValues(payload),
      remaining: payload.handoff?.remaining_steps || [],
      voiceNotes: Array.isArray(payload.voice_notes) ? payload.voice_notes : [],
      canPublish: campaign.validation_passed === true && campaign.approved === true,
      issuedHandoff: payload.handoff_session_issue || null,
      localNow: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
    };
  }

  /**
   * 초안을 블로그에 올라간 모습에 가깝게 그린다 (REQ-4).
   *
   * 서버가 만든 preview.html 은 `frame-ancestors 'none'` 이라 iframe 에 넣을 수 없다.
   * 그 헤더를 풀어 모델이 만든 HTML 을 우리 화면에 끼워 넣느니, 마크다운을 여기서
   * 직접 그린다 — 전부 이스케이프한 뒤 아는 문법만 태그로 바꾸므로 주입 여지가 없다.
   */
  function renderDraftPreview(markdown) {
    const blocks = [];
    let paragraph = [];
    const flush = () => {
      if (paragraph.length) blocks.push(`<p>${paragraph.join("<br>")}</p>`);
      paragraph = [];
    };
    for (const raw of String(markdown).split("\n")) {
      const line = raw.trim();
      const safe = esc(line);
      if (!line) { flush(); continue; }

      const marker = /^\[(IMAGE|VIDEO):(\d{3})\]$/.exec(line);
      if (marker) {
        flush();
        // 사진이 들어갈 자리를 눈에 보이게 둔다 — 스마트에디터에서 이 자리에 파일을 넣는다.
        blocks.push(`<div class="nblog-preview-slot">${marker[1] === "VIDEO" ? "영상" : "사진"} ${esc(marker[2])} 자리</div>`);
        continue;
      }
      if (/^##\s+/.test(line)) { flush(); blocks.push(`<h4>${esc(line.replace(/^##\s+/, ""))}</h4>`); continue; }
      if (/^#\s+/.test(line)) { flush(); blocks.push(`<h3>${esc(line.replace(/^#\s+/, ""))}</h3>`); continue; }
      // 태그 줄은 # 뒤에 공백이 없어 제목과 구분된다.
      if (/^#[^\s#]/.test(line)) {
        flush();
        const tags = line.match(/#[^\s#]+/g) || [];
        blocks.push(`<div class="nblog-preview-tags">${tags.map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>`);
        continue;
      }
      if (/^[-*]\s+/.test(line)) { flush(); blocks.push(`<li>${esc(line.replace(/^[-*]\s+/, ""))}</li>`); continue; }
      paragraph.push(safe);
    }
    flush();
    return blocks.join("");
  }

  function sectionDraftCopy({ draft, copy, payload }) {
    if (!draft) {
      return section("생성된 글", `<p class="nblog-workspace-warning">초안이 없습니다. ${esc((payload.prerequisites || []).join(" → "))}</p>`);
    }
    // 한 필드가 비었다고 모달 전체가 렌더링에 실패하면 안 된다 — 그러면 같은 화면의
    // '다시 만들기' 버튼까지 함께 사라져 사용자가 빠져나갈 방법이 없어진다.
    const title = String(copy.title || "");
    const body = String(copy.body || "");
    const tagText = String(copy.tags || "");
    const chars = body.replace(/\s/g, "").length;
    const tags = tagText.match(/#[^\s#]+/g) || [];
    const tagCount = tags.length;
    // 올라간 모습을 기본으로 보여주고, 붙여넣을 원문은 접어 둔다 (REQ-4).
    const inner = `<div class="nblog-copy-actions"><button class="nblog-primary-button" type="button" data-copy-kind="all">전체 글 복사</button><button type="button" data-copy-kind="title">제목</button><button type="button" data-copy-kind="body">본문</button><button type="button" data-copy-kind="tags">태그</button></div>`
      + `<article class="nblog-preview-paper"><h3>${esc(title)}</h3>${renderDraftPreview(body)}<div class="nblog-preview-tags">${tags.map((tag) => `<span>${esc(tag)}</span>`).join("")}</div></article>`
      + `<p class="nblog-field-meta">공백 제외 ${chars}자 · 태그 ${tagCount}개 · 사진 자리는 스마트에디터에서 파일로 교체</p>`
      + `<details class="nblog-preview-raw"><summary>붙여넣을 원문 보기</summary><label>제목<textarea readonly rows="2">${esc(title)}</textarea></label><label>본문<textarea class="nblog-body-field" readonly>${esc(body)}</textarea></label><label>태그<textarea readonly rows="2">${esc(tagText)}</textarea></label></details>`;
    return section("생성된 글", inner);
  }

  function sectionValidation({ payload }) {
    const validation = payload.validation || {};
    const checks = Array.isArray(validation.checks) ? validation.checks : [];
    const warnings = checks.filter((item) => item.status === "warning").length;
    const errors = checks.filter((item) => item.status === "failed" || item.status === "error").length;
    const summary = `${esc(validation.status || "-")}${errors ? ` · 오류 ${errors}` : ""}${warnings ? ` · 경고 ${warnings}` : ""}`;
    // 오류가 있으면 펼친 채로 연다.
    return collapsible("글 확인 결과", summary, validationDetailsHtml(payload.validation), errors > 0);
  }

  function sectionCampaignStatus({ campaign, payload, remaining }) {
    const grid = `<div class="nblog-workspace-grid">
        <dl><dt>캠페인</dt><dd>${esc(campaign.campaign_name || "-")} · ${esc(campaign.campaign_id || "-")}</dd></dl>
        <dl><dt>현재 상태</dt><dd>${esc(PHASE_LABELS[normalizePhase(campaign.status)] || campaign.status || "-")}</dd></dl>
        <dl><dt>다음 할 일</dt><dd>${esc(payload.handoff?.resume_stage || "-")} · ${esc(payload.handoff?.resume_point || "-")}</dd></dl>
        <dl><dt>만든 글</dt><dd>${esc(payload.artifact_version || 0)}번째 · 마지막 갱신 ${esc(campaign.last_sync_at || "없음")}</dd></dl>
      </div>`;
    const steps = remaining.length
      ? `<ol class="nblog-step-list">${remaining.map((step) => `<li><label><input type="checkbox" name="handoffStep" value="${esc(step)}" /> ${esc(step)}</label></li>`).join("")}</ol><button class="nblog-link-button" type="button" data-detail-action="save-checkpoint">선택 작업 체크포인트 저장</button>`
      : "";
    const summary = `${esc(PHASE_LABELS[normalizePhase(campaign.status)] || campaign.status || "-")} · ${esc(payload.artifact_version || 0)}번째 글`;
    return collapsible("진행 상황", summary, `${grid}${steps}`);
  }

  /**
   * 미디어 카드. 파일명·상태 문구를 title 속성으로 내리고 썸네일 중심으로 줄였다 —
   * 7장이 넘어가면 카드 하나하나의 설명이 화면 대부분을 먹는다.
   */
  function mediaCard(item, index, total) {
    const thumb = item.type === "image" && item.content_url
      ? `<img src="${esc(item.content_url)}" alt="${esc(item.original_name)}" loading="lazy" />`
      : `<div class="nblog-video-placeholder">${item.type === "video" ? "VIDEO" : "IMAGE"}</div>`;
    const pending = item.status !== "ready";
    return `<article class="nblog-media-item${pending ? " is-pending" : ""}" data-media-id="${esc(item.media_id)}" title="${esc(item.original_name)} · ${esc(item.status)}"><span class="nblog-media-order">${esc(item.order || index + 1)}</span>${thumb}<strong>${esc(item.original_name)}</strong>${pending ? `<small>${esc(item.status)}</small>` : ""}<div><button type="button" data-detail-action="media-up" data-media-index="${index}" ${index === 0 ? "disabled" : ""} title="글에서 한 칸 앞으로">← 앞으로</button><button type="button" data-detail-action="media-down" data-media-index="${index}" ${index === total - 1 ? "disabled" : ""} title="글에서 한 칸 뒤로">뒤로 →</button><button class="is-danger" type="button" data-detail-action="exclude-media" data-media-id="${esc(item.media_id)}" data-media-name="${esc(item.original_name)}">제외</button></div></article>`;
  }

  /**
   * 음성메모 (#186). 사진에 없는 맛·서비스·감상은 여기 말한 내용이 있어야 쓸 수 있다.
   * 전사가 틀리면 고칠 수 있고, 고치면 다시 만들기 대상이 된다.
   */
  function sectionVoiceNotes({ voiceNotes, campaign }) {
    // 글을 확인한 뒤에는 음성메모를 더 올려도 확정된 초안에 반영되지 않는다(다시 만들기를
    // 해야 반영되고 그러면 확정이 풀림). 혼란을 막으려고 확정 후에는 올리기를 잠근다.
    const locked = campaign?.generation_status === "content_confirmed";
    const rows = voiceNotes.map((note) => {
      const failed = note.transcript_status !== "ready";
      return `<article class="nblog-voice-note" data-note-id="${esc(note.note_id)}"><div class="nblog-voice-head"><strong>${esc(note.original_name)}</strong><button class="is-danger" type="button" data-detail-action="delete-voice-note" data-note-id="${esc(note.note_id)}" data-note-name="${esc(note.original_name)}">삭제</button></div>${failed ? `<p class="nblog-workspace-warning">${esc(note.transcript_error || "받아쓰기에 실패했습니다.")} 아래에 직접 적어주세요.</p>` : ""}<label><span class="sr-only">받아쓴 내용</span><textarea rows="3" data-voice-transcript="${esc(note.note_id)}" placeholder="말한 내용이 여기 적힙니다. 틀린 곳은 고쳐주세요.">${esc(note.transcript || "")}</textarea></label><button class="nblog-link-button" type="button" data-detail-action="save-voice-note" data-note-id="${esc(note.note_id)}">고친 내용 저장</button></article>`;
    }).join("");
    const toolbar = locked
      ? `<p class="nblog-workspace-warning">글을 확인해서 음성메모 올리기가 잠겼습니다. 더 반영하려면 글을 다시 만들어야 합니다.</p>`
      : `<div class="nblog-media-toolbar"><label class="nblog-media-upload">음성 고르기<input id="voiceNoteInput" type="file" accept="audio/mpeg,audio/mp4,audio/m4a,audio/x-m4a,audio/wav,audio/webm,audio/ogg,audio/flac" /></label><button class="nblog-primary-button" type="button" data-detail-action="upload-voice-note">올리고 받아쓰기</button></div>`;
    const summary = voiceNotes.length ? `${voiceNotes.length}개${locked ? " · 잠김" : ""}` : locked ? "잠김" : "없음";
    const body = `<p>다녀와서 느낀 걸 말로 남기면 글에 반영됩니다. 사진만으로는 알 수 없는 맛·분위기·서비스가 여기서 나옵니다.</p>${toolbar}${rows || "<p>아직 올린 음성메모가 없습니다.</p>"}`;
    return collapsible("말로 남긴 메모", summary, body, voiceNotes.length === 0);
  }

  function sectionMedia({ media }) {
    // 다시 만들기 버튼은 sectionGenerate 로 통합했다 (#184).
    const toolbar = `<div class="nblog-media-toolbar"><label class="nblog-media-upload">파일 고르기<input id="detailsMediaInput" type="file" accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm" multiple /></label><button class="nblog-primary-button" type="button" data-detail-action="upload-detail-media">고른 파일 올리기</button></div>`;
    const grid = media.map((item, index) => mediaCard(item, index, media.length)).join("")
      || "<p>아직 올린 사진이나 영상이 없습니다. 위에서 파일을 골라 올려주세요.</p>";
    const photos = media.filter((item) => item.type === "image").length;
    const videos = media.length - photos;
    // 첨부는 평소엔 개수만 보이고, 순서를 바꾸거나 뺄 때만 펴면 된다.
    const summary = media.length ? `사진 ${photos}장 · 영상 ${videos}개` : "아직 없음";
    const body = `<p>새 파일을 먼저 올린 뒤 문제가 있는 기존 파일을 빼면 안전하게 바꿀 수 있습니다. 바꾼 뒤 글을 다시 만들면 최신 사진으로 씁니다.</p>${toolbar}<div class="nblog-media-grid">${grid}</div>`;
    return collapsible("올린 사진·영상", summary, body, media.length === 0);
  }

  function sectionAutoInputHelper({ issuedHandoff, canPublish, payload, draft }) {
    // 일회성 인계 토큰은 JS 메모리에만 둔다. DOM·URL·영구 브라우저 저장소에는 원문을 쓰지 않고
    // 사용자가 누른 순간 NBLOG_HANDOFF_V1 연결 코드로 직렬화해 클립보드에만 전달한다.
    const connectionReady = Boolean(issuedHandoff?.claim_token && issuedHandoff?.handoff_session?.id);
    const connectionStatus = connectionReady
      ? `<div class="nblog-helper-status is-ready" role="status" aria-live="polite" aria-atomic="true" data-helper-state="ready"><span aria-hidden="true">●</span><div><strong>자동입력 연결 준비됨</strong><small>10분 안에 확장 프로그램에 연결 코드를 붙여넣으세요. 만료 ${esc(issuedHandoff.handoff_session?.expires_at || "시각 미확인")}</small></div></div>`
      : `<div class="nblog-helper-status" role="status" aria-live="polite" aria-atomic="true" data-helper-state="${canPublish ? "not-connected" : "approval-required"}"><span aria-hidden="true">○</span><div><strong>${canPublish ? "확장 프로그램 연결 전" : "글 확인이 먼저 필요함"}</strong><small>${canPublish ? "확장 프로그램을 설치한 뒤 이 글 전용 연결 코드를 만드세요." : "글을 확인하고 올릴 준비 완료로 표시하면 자동입력 연결을 만들 수 있습니다."}</small></div></div>`;
    const connectionAction = canPublish
      ? connectionReady
        ? `<button class="nblog-primary-button" type="button" data-detail-action="copy-handoff-code">연결 코드 복사</button><button class="nblog-link-button" type="button" data-detail-action="issue-handoff-session">새 연결 코드 만들기</button>`
        : `<button class="nblog-primary-button" type="button" data-detail-action="issue-handoff-session">자동입력 연결 코드 만들기</button>`
      : `<button class="nblog-primary-button" type="button" disabled aria-disabled="true">자동입력 연결 코드 만들기</button>`;
    const draftAction = draft && canPublish
      ? `<button class="nblog-link-button" type="button" data-detail-action="copy-draft-payload">북마클릿용 초안 복사</button>`
      : `<button class="nblog-link-button" type="button" disabled aria-disabled="true">북마클릿용 초안 복사</button>`;
    const inner = `${accountConnectionHtml(payload)}
      <p class="nblog-helper-safety"><strong>자동입력 범위</strong> 제목·본문·태그까지만 넣습니다. 네이버 로그인과 사진·영상·장소·미리보기·최종 발행은 직접 진행합니다.</p>
      <div class="nblog-helper-choice">
        <article>
          <span class="nblog-helper-label">권장</span>
          <h4>Chrome 확장 프로그램</h4>
          <p>10분짜리 일회성 연결 코드로 확인한 글만 안전하게 전달합니다.</p>
          <div class="nblog-helper-actions"><a class="nblog-link-button nblog-helper-download" href="${HELPER_DOWNLOAD_URL}" download>Chrome 자동입력 도우미 받기</a>${connectionAction}</div>
          ${connectionStatus}
        </article>
        <article>
          <span class="nblog-helper-label is-secondary">설치 없이</span>
          <h4>즐겨찾기 도우미 <small>(북마클릿)</small></h4>
          <p>즐겨찾기에 도우미를 한 번 등록하고, SmartEditor에서 복사한 초안 코드를 붙여넣습니다.</p>
          <div class="nblog-helper-actions"><button class="nblog-link-button" type="button" data-detail-action="copy-bookmarklet-source">즐겨찾기 도우미 코드 복사</button>${draftAction}</div>
        </article>
      </div>
      <details class="nblog-helper-guide"><summary>설치와 사용 방법</summary><div class="nblog-helper-guide-body"><ol class="nblog-step-list"><li><strong>확장 프로그램:</strong> ZIP을 풀고 Chrome 확장 프로그램 화면에서 압축해제된 폴더를 불러옵니다.</li><li><strong>연결:</strong> 연결 코드를 복사해 확장 프로그램에 붙여넣은 뒤 SmartEditor를 엽니다.</li><li><strong>즐겨찾기 도우미:</strong> 복사한 <code>javascript:</code> 코드를 새 즐겨찾기의 주소에 붙여넣습니다.</li><li><strong>북마클릿 사용:</strong> 북마클릿용 초안을 복사한 뒤 SmartEditor에서 즐겨찾기 도우미를 누르고 요청 창에 붙여넣습니다.</li></ol><small>연결 코드와 초안은 주소창이나 웹페이지에 저장하지 않습니다. 비밀번호·쿠키·네이버 세션도 수집하지 않습니다.</small></div></details>`;
    return section("자동입력 도우미", inner, ' data-policy-gate="assisted_input_manual_publish"');
  }

  function sectionSmartEditor({ payload, campaign }) {
    const url = esc(payload.smart_editor?.url || "https://blog.naver.com/GoBlogWrite.naver");
    // 장소는 링크가 아니라 이름으로 넣는다 — 장소 버튼에 이 검색어를 붙여넣으면 카드로 붙는다.
    const placeName = String(campaign?.campaign_name || "").trim();
    const placeStep = placeName
      ? `<li><strong>장소 넣기</strong>: 장소(📍) 버튼 → 검색창에 <code>${esc(placeName)}</code> 붙여넣기 → 목록에서 선택 <button type="button" class="nblog-link-button" data-copy-kind="placeName">장소 이름 복사</button><br><small>본문에 링크를 넣지 마세요 — 링크는 장소 카드로 바뀌지 않습니다.</small></li>`
      : `<li><strong>장소 넣기</strong>: 장소(📍) 버튼으로 가게를 검색해 추가 <small>(본문 링크는 장소 카드로 바뀌지 않습니다)</small></li>`;
    const inner = `<p>대상 블로그: ${esc(payload.smart_editor?.blog_url || "미지정")} · 카테고리: ${esc(payload.smart_editor?.category || "미지정")}</p><ol class="nblog-step-list"><li>위에서 확장 프로그램 연결 코드 또는 북마클릿용 초안을 복사</li><li>SmartEditor 열기 → 네이버 로그인 → 자동입력 도우미 실행</li><li>제목·본문·태그가 정확히 들어갔는지 직접 확인</li><li><code>[IMAGE:001]</code>·<code>[VIDEO:002]</code> 표시 자리에 사진·영상을 순서대로 넣고 표시 줄은 지우기</li>${placeStep}<li>광고 표기와 태그 확인 → 미리보기 → 직접 발행</li></ol><div class="nblog-helper-actions"><button class="nblog-primary-button" type="button" data-detail-action="open-editor" data-editor-url="${url}">SmartEditor 열기</button><a class="nblog-direct-link" href="${url}" target="_blank" rel="noopener noreferrer">직접 열기 링크</a></div><small>자동입력 도우미는 발행 버튼을 누르지 않습니다. 로그인·CAPTCHA·보안 확인·미디어 업로드·장소 선택·미리보기·최종 발행은 사용자가 직접 처리합니다.</small>`;
    return section("SmartEditor에서 직접 확인", inner);
  }

  function sectionPublication({ canPublish, localNow }) {
    const checks = [["title", "제목"], ["sponsor_disclosure", "광고 표기"], ["map", "지도/플레이스"], ["media", "미디어"], ["tags", "태그"]]
      .map(([name, label]) => `<label><input type="checkbox" name="${name}" required /> ${label} 확인</label>`).join("");
    const inner = canPublish
      ? `<form id="publicationForm"><label>실제 게시물 URL<input name="publishedUrl" type="url" placeholder="https://blog.naver.com/blogId/123456789" required /></label><label>발행 시각<input name="publishedAt" type="datetime-local" value="${localNow}" required /></label><fieldset><legend>최종 확인</legend>${checks}</fieldset><button class="nblog-primary-button" type="submit">발행 완료로 기록</button></form>`
      : `<p class="nblog-workspace-warning">글을 확인하고 올릴 준비 완료로 표시해야 발행 결과를 기록할 수 있습니다.</p>`;
    return section("발행 결과 등록", inner);
  }

  /**
   * 생성 진입점. 초안 유무와 무관하게 **버튼 하나**로 통합했다 (#184).
   * 이전에는 '사진·영상으로 글 만들기'(generate-draft)와 '변경 반영해 글 다시
   * 만들기'(regenerate-content)가 같은 API 를 부르면서 화면에 둘 다 떠 있었다.
   */
  function sectionGenerate({ campaign, media }) {
    const readyMedia = media.filter((item) => item.status === "ready");
    const generating = campaign.generation_status === "generating";
    const hasDraft = campaign.generation_status === "awaiting_content_review"
      || Number(campaign.artifact_version || 0) > 0;
    if (!readyMedia.length) {
      return section("글 만들기", `<p class="nblog-workspace-warning">업로드가 끝난 사진이나 영상이 있어야 글을 만들 수 있습니다.</p>`);
    }
    const label = generating ? "만드는 중…" : hasDraft ? "변경 반영해 다시 만들기" : "사진·영상으로 글 만들기";
    return section("글 만들기", `<p>올린 사진과 영상에서 보이는 내용으로 초안을 만듭니다. 영상은 대표 장면을 뽑아 함께 씁니다.</p><button class="nblog-primary-button" type="button" data-detail-action="generate-draft" ${generating ? "disabled" : ""}>${label}</button><small>업로드 완료된 미디어 ${readyMedia.length}개를 근거로 씁니다.${generating ? " 완료되면 오른쪽에 글이 나타납니다." : ""}</small>`);
  }

  /** 생성된 글을 확인 처리하는 버튼. PREVIEW 패널 하단에 붙는다. */
  function sectionConfirm({ campaign, payload }) {
    if (campaign.generation_status !== "awaiting_content_review") return "";
    return section("글 확인", `<p>사진과 캠페인 정보로 생성된 최신 글을 읽고 확인해주세요.</p><button class="nblog-primary-button" type="button" data-detail-action="confirm-content" data-artifact-version="${esc(payload.artifact_version || 0)}">이 글을 확인했습니다</button>`);
  }

  /** 만들기 화면에서 발행 화면으로 넘어가는 유일한 진입점. */
  function sectionPublishEntry({ canPublish, draft }) {
    const inner = draft
      ? `<p>글이 준비되면 여기서 발행 화면으로 넘어갑니다. 복사·스마트에디터·발행 결과 등록이 그 화면에 모여 있습니다.</p><button class="nblog-primary-button" type="button" data-detail-action="open-publish">발행 준비하기</button>${canPublish ? "" : `<small>글을 확인하기 전에는 발행 기록이 잠겨 있습니다. 글 복사와 스마트에디터 열기는 지금도 가능합니다.</small>`}`
      : `<p class="nblog-workspace-warning">초안이 있어야 발행 화면으로 넘어갈 수 있습니다.</p>`;
    return section("발행", inner);
  }

  const panel = (kicker, title, sections, view) =>
    `<div class="nblog-panel"><header class="nblog-panel-head"><span class="nblog-section-kicker">${kicker}</span><h4>${title}</h4></header>${sections.map((render) => render(view)).join("")}</div>`;

  /**
   * 만들기 화면 — 입력(SOURCE)과 결과(PREVIEW)를 좌우로 둔다 (#184).
   * 왼쪽에서 사진을 바꾸고 오른쪽에서 글이 어떻게 달라지는지 바로 보이는 것이
   * 이 재배치의 목적이다. 발행 3섹션은 별도 화면으로 나가 있다 (#182).
   */
  function renderHandoffWorkspace(payload) {
    state.handoff = payload;
    const view = handoffView(payload);
    refs.detailsTitle.textContent = `${view.campaign.campaign_id || "캠페인"} 글 보기`;
    // 액션을 미디어 위에 둔다 — 사진이 여러 장이면 아래에 있는 버튼은 스크롤해야 보인다.
    const source = panel("01 · SOURCE", "사진·영상과 만들기", [sectionGenerate, sectionMedia, sectionVoiceNotes], view);
    const preview = panel("02 · PREVIEW", "생성된 글", [sectionConfirm, sectionDraftCopy], view);
    // 검증·상태·발행 진입은 좌우 아래에 전체 폭으로 둔다.
    const below = [sectionValidation, sectionCampaignStatus, sectionPublishEntry]
      .map((render) => render(view)).join("");
    refs.detailsBody.innerHTML = `<div class="nblog-workspace"><div class="nblog-split">${source}${preview}</div>${below}</div>`;
    refs.detailsDialog.showModal();
  }

  function renderPublishWorkspace(payload) {
    state.handoff = payload;
    const view = handoffView(payload);
    refs.publishTitle.textContent = `${view.campaign.campaign_id || "캠페인"} 발행 준비`;
    // 주 동선은 초안 확인 → 확장/북마클릿 자동입력 → SmartEditor 수동 확인 →
    // 발행 결과 등록이다. 자동입력 도우미는 최종 발행을 수행하지 않는다.
    const sections = [
      sectionDraftCopy,
      sectionAutoInputHelper,
      sectionSmartEditor,
      sectionPublication,
    ];
    refs.publishBody.innerHTML = `<div class="nblog-workspace">${sections.map((render) => render(view)).join("")}</div>`;
    if (!refs.publishDialog.open) refs.publishDialog.showModal();
  }

  async function showPublish(campaignId) {
    const payload = await apiRequest(`${API_BASE}/${encodeURIComponent(campaignId)}/handoff`);
    renderPublishWorkspace(payload);
  }

  async function showHandoff(campaignId) {
    const payload = await apiRequest(`${API_BASE}/${encodeURIComponent(campaignId)}/handoff`);
    renderHandoffWorkspace(payload);
  }

  async function showSyncTokens(issued = null) {
    const payload = await apiRequest("/api/nblog/sync-tokens");
    refs.detailsTitle.textContent = "로컬 CLI 연결";
    refs.detailsBody.innerHTML = `<div class="nblog-workspace"><section class="nblog-workspace-section"><h3>내 PC 연결</h3><p>내 PC 프로그램이 이 계정으로 캠페인을 보낼 때 씁니다.</p>${issued ? `<div class="nblog-token-once"><strong>지금 한 번만 표시됩니다.</strong><code id="issuedSyncToken">${esc(issued.token)}</code><button type="button" data-detail-action="copy-sync-token">연결 코드 복사</button></div><pre>NBLOG_API_BASE_URL=${esc(location.origin)}\nNBLOG_API_TOKEN=&lt;복사한 토큰&gt;</pre>` : ""}<button class="nblog-primary-button" type="button" data-detail-action="issue-sync-token">새 연결 코드 만들기</button><ul class="nblog-token-list">${(payload.tokens || []).map((token) => `<li><strong>${esc(token.label)}</strong><small>생성 ${esc(token.created_at)} · 마지막 사용 ${esc(token.last_used_at || "없음")} · ${token.revoked_at ? "폐기됨" : "활성"}</small>${token.revoked_at ? "" : `<button type="button" data-detail-action="revoke-sync-token" data-token-id="${esc(token.id)}">폐기</button>`}</li>`).join("") || '<li>만든 연결 코드가 없습니다.</li>'}</ul></section></div>`;
    if (!refs.detailsDialog.open) refs.detailsDialog.showModal();
  }

  function renderPromptManager(profiles) {
    state.promptProfiles = profiles;
    const system = profiles.find((profile) => profile.system) || {};
    refs.detailsTitle.textContent = "커스텀 AI 프롬프트";
    refs.detailsBody.innerHTML = `<div class="nblog-workspace"><section class="nblog-workspace-section"><h3>프로필과 버전</h3><div class="nblog-profile-list">${profiles.map((profile) => `<article><strong>${esc(profile.name)} · v${esc(profile.version)}</strong><small>${profile.system ? "시스템 기본" : `${esc(profile.scope)} · ${profile.is_active ? "활성" : "비활성"}`}</small><button type="button" data-detail-action="edit-prompt" data-profile-id="${esc(profile.prompt_profile_id)}">${profile.system ? "기본값으로 작성" : "편집"}</button>${(profile.versions || []).slice(1).map((version) => `<button type="button" data-detail-action="restore-prompt" data-profile-id="${esc(profile.prompt_profile_id)}" data-prompt-version="${esc(version.version)}">v${esc(version.version)} 복원</button>`).join("")}</article>`).join("")}</div></section><section class="nblog-workspace-section"><h3>프로필 저장</h3><form id="promptProfileForm"><input type="hidden" name="profileId" /><label>이름<input name="name" maxlength="120" required /></label><label>템플릿<textarea name="template" rows="16" maxlength="20000" required>${esc(system.template || "")}</textarea></label><label>변경 사유<input name="changeReason" maxlength="500" value="체험단 후기 프롬프트 설정" required /></label><div class="nblog-dialog-actions"><button class="nblog-link-button" type="button" data-detail-action="reset-system-prompt">시스템 기본값</button><button class="nblog-link-button" type="button" data-detail-action="preview-prompt">입력 미리보기</button><button class="nblog-primary-button" type="submit">저장</button></div><div id="promptValidationResult"></div></form></section></div>`;
    refs.detailsBody.dataset.systemPrompt = system.template || "";
    if (!refs.detailsDialog.open) refs.detailsDialog.showModal();
  }

  async function showPromptManager() {
    const payload = await apiRequest(PROMPT_API);
    renderPromptManager(payload.profiles || []);
  }

  // 방문일 수정(REQ-1)과 보관(REQ-2·3)을 한곳에 모은 관리 화면. 카드의 ⋯ 버튼으로 연다.
  // detailsDialog 를 재사용하므로 버튼의 data-detail-action 은 onWorkspaceClick 이 처리한다.
  function openManageDialog(campaign) {
    state.manage = campaign;
    refs.detailsTitle.textContent = `${campaign.id} 관리`;
    const editable = ["queued", "analysis", "validation", "failed"].includes(campaign.phase);
    const dateSection = editable
      ? `<label class="nblog-manage-field">방문일<input type="date" id="manageVisitDate" value="${esc(campaign.visitDate)}" /></label><button class="nblog-primary-button" type="button" data-detail-action="save-visit-date">방문일 저장</button><small>발행 전이라 방문일을 바꿔도 안전합니다. 잘못 넣은 날짜는 여기서 고치세요.</small>`
      : `<p class="nblog-workspace-warning">이미 진행된 캠페인은 방문일을 바꿀 수 없습니다. 현재 방문일: ${esc(formatDate(campaign.visitDate))}</p>`;
    const archiveSection = campaign.phase === "published"
      ? `<p class="nblog-workspace-warning">이미 블로그에 올린 캠페인은 보관할 수 없습니다.</p>`
      : `<p>보관하면 목록에서 사라지고 올린 사진 사본은 정리됩니다. 되돌릴 수 있지만 사진은 복구되지 않습니다.</p><label class="nblog-manage-field">확인을 위해 캠페인 이름을 그대로 입력<input type="text" id="manageArchiveConfirm" placeholder="${esc(campaign.name)}" autocomplete="off" /></label><button class="nblog-card-action is-danger" type="button" data-detail-action="archive-campaign">이 캠페인 보관</button>`;
    refs.detailsBody.innerHTML = `<div class="nblog-workspace"><section class="nblog-workspace-section"><h3>방문일 수정</h3>${dateSection}</section><section class="nblog-workspace-section"><h3>캠페인 보관</h3>${archiveSection}</section></div>`;
    if (!refs.detailsDialog.open) refs.detailsDialog.showModal();
  }

  async function handleAction(action, campaignId) {
    const campaign = state.campaigns.find((item) => item.id === campaignId) || state.archived.find((item) => item.id === campaignId);
    if (!campaign) return;
    if (action === "open") {
      if (campaign.publishedUrl) window.open(campaign.publishedUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (!state.connected) {
      showToast("서버에 연결되지 않아 실행할 수 없습니다.", true);
      return;
    }
    try {
      if (action === "manage") {
        openManageDialog(campaign);
        return;
      }
      if (action === "restore") {
        await apiRequest(`${API_BASE}/${encodeURIComponent(campaignId)}/restore`, { method: "POST", body: JSON.stringify({ expected_version: campaign.version, expected_updated_at: campaign.updatedAt }) });
        await loadCampaigns();
        showToast("보관을 취소해 목록으로 되돌렸습니다. 삭제된 사진은 복구되지 않습니다.");
        return;
      }
      if (action === "details") {
        const validation = await apiRequest(`${API_BASE}/${encodeURIComponent(campaignId)}/validation`);
        showDetails(`${campaign.id} 검증 결과`, validation);
        return;
      }
      if (action === "handoff") {
        await showHandoff(campaignId);
        return;
      }
      if (action === "review-content") {
        await showHandoff(campaignId);
        return;
      }
      if (action === "approve") {
        if (!campaign.validationPassed || campaign.phase !== "approval") throw new Error("검증 통과와 승인 대기 상태가 모두 필요합니다.");
        if (!window.confirm("이 글을 확인했고 블로그에 올릴 준비가 됐다고 표시할까요? 네이버에 자동으로 올리지는 않습니다.")) return;
        await apiRequest(`${API_BASE}/${encodeURIComponent(campaignId)}/approve`, { method: "POST", body: JSON.stringify({ expected_updated_at: campaign.updatedAt, expected_version: campaign.version, confirmed: true }) });
        await loadCampaigns();
        showToast("서버가 캠페인을 올릴 준비 완료로 표시했습니다. 네이버 예약 발행 연동 완료를 뜻하지 않습니다.");
        return;
      }
      if (action === "retry") {
        await apiRequest(`${API_BASE}/${encodeURIComponent(campaignId)}/retry`, { method: "POST", body: JSON.stringify({ expected_updated_at: campaign.updatedAt, expected_version: campaign.version, resume_point: campaign.resumePoint }) });
        await loadCampaigns();
        showToast("서버가 재시도 요청을 수락했습니다. 실제 진행 상태를 다시 조회합니다.");
      }
    } catch (error) {
      showToast(`작업 실패: ${error.message}`, true);
    }
  }

  const normalizeTag = (value) => String(value || "").trim().replace(/^#+/, "").replace(/[\s,]+/g, "");
  async function checksumFile(file) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  // 영상 길이를 브라우저에서 읽어 업로드 정보에 담는다. 서버는 이 값으로 대표
  // 프레임을 뽑을 지점을 정하므로, 없으면 0초 한 장만 뽑히게 된다.
  function readVideoDuration(file) {
    if (!String(file.type || "").startsWith("video/")) return Promise.resolve(null);
    return new Promise((resolve) => {
      const element = document.createElement("video");
      const objectUrl = URL.createObjectURL(file);
      const finish = (value) => { URL.revokeObjectURL(objectUrl); element.removeAttribute("src"); resolve(value); };
      const timer = setTimeout(() => finish(null), 5000);
      element.preload = "metadata";
      element.onloadedmetadata = () => { clearTimeout(timer); finish(Number.isFinite(element.duration) && element.duration > 0 ? Number(element.duration.toFixed(3)) : null); };
      element.onerror = () => { clearTimeout(timer); finish(null); };
      element.src = objectUrl;
    });
  }

  /**
   * 촬영 시각을 알아낸다. 휴대폰이 붙이는 `20260712_192901` 형태의 파일명을 먼저 보고,
   * 없으면 파일 수정 시각을 쓴다. 둘 다 없으면 고른 순서를 유지한다.
   */
  function captureTimeOf(file, fallbackIndex) {
    const stamp = /(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/.exec(file.name);
    if (stamp) {
      const [, year, month, day, hour, minute, second] = stamp;
      const parsed = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return Number.isFinite(file.lastModified) && file.lastModified > 0 ? file.lastModified : fallbackIndex;
  }

  /**
   * 파일 고르기 순서는 탐색기 정렬을 그대로 따라와서 찍은 차례와 어긋난다.
   * 글에 들어갈 차례는 찍은 차례가 기본이어야 하므로 올리기 전에 정렬한다.
   */
  function sortByCaptureTime(files) {
    return [...files]
      .map((file, index) => ({ file, index, at: captureTimeOf(file, index) }))
      .sort((left, right) => left.at - right.at || left.index - right.index)
      .map((entry) => entry.file);
  }

  async function uploadMedia(campaignId, selected) {
    const files = sortByCaptureTime(selected);
    const prepared = [];
    for (const [index, file] of files.entries()) prepared.push({
      client_id: `media-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${index + 1}`}`,
      original_name: file.name,
      content_type: file.type || "application/octet-stream",
      size: file.size,
      checksum: await checksumFile(file),
      duration: await readVideoDuration(file),
      order: index + 1,
    });
    const initialized = await apiRequest(`${API_BASE}/${encodeURIComponent(campaignId)}/media/upload-init`, { method: "POST", body: JSON.stringify({ files: prepared }) });
    if (!Array.isArray(initialized?.uploads) || initialized.uploads.length !== files.length) throw new Error("업로드 초기화 응답이 파일 수와 일치하지 않습니다.");
    for (const [index, upload] of initialized.uploads.entries()) {
      const response = await fetch(upload.upload_url, { method: upload.method || "PUT", headers: upload.headers || { "Content-Type": files[index].type }, body: files[index] });
      if (!response.ok) throw new Error(`${files[index].name} 업로드 실패 (${response.status})`);
    }
    await apiRequest(`${API_BASE}/${encodeURIComponent(campaignId)}/media/upload-complete`, {
      method: "POST",
      body: JSON.stringify({ files: prepared.map((file, index) => ({ ...file, object_key: initialized.uploads[index].object_key })) }),
    });
  }

  function openDialog() {
    refs.form.reset();
    document.getElementById("newCampaignDate").value = TODAY;
    const imported = new URLSearchParams(location.search);
    const importedFields = {
      campaignId: imported.get("campaign_id"), campaignName: imported.get("campaign_name"),
      campaignUrl: imported.get("campaign_url"), placeUrl: imported.get("place_url"),
      visitDate: imported.get("visit_date"), toneProfile: imported.get("tone_profile"),
      visitNotes: imported.get("visit_notes"), promptOverride: imported.get("prompt"),
    };
    for (const [name, value] of Object.entries(importedFields)) {
      if (value && refs.form.elements[name]) refs.form.elements[name].value = value;
    }
    const importedTags = imported.getAll("tag");
    [...refs.form.querySelectorAll('[name="userTag"]')].forEach((input, index) => { input.value = importedTags[index] || ""; });
    refs.formError.hidden = true;
    refs.dialog.showModal();
    window.setTimeout(() => document.getElementById("newCampaignId").focus(), 0);
  }

  async function inspectCampaignLink() {
    const campaignUrl = refs.importUrl?.value.trim();
    if (!campaignUrl) {
      refs.formError.textContent = "블로그 체험단 링크를 입력해 주세요.";
      refs.formError.hidden = false;
      refs.importUrl?.focus();
      return;
    }
    refs.formError.hidden = true;
    refs.inspectCampaignButton.disabled = true;
    refs.inspectCampaignButton.textContent = "가져오는 중…";
    try {
      const imported = await apiRequest(`/api/nblog/campaign-imports/inspect?campaign_url=${encodeURIComponent(campaignUrl)}`);
      const campaign = imported?.campaign || {};
      const values = {
        campaignId: campaign.id ? `NB-${campaign.id}` : "",
        campaignName: campaign.name,
        campaignUrl: campaign.campaign_url,
        placeUrl: campaign.place_url,
        // 링크에서 긁어온 가이드라인을 지금까지는 화면에만 채우고 버렸다. 이제 저장한다.
        requirements: campaign.requirements,
        toneProfile: imported?.defaults?.tone_profile,
        promptProfileId: imported?.defaults?.prompt_profile_id,
      };
      for (const [name, value] of Object.entries(values)) {
        if (value && refs.form.elements[name]) refs.form.elements[name].value = value;
      }
      [...refs.form.querySelectorAll('[name="userTag"]')].forEach((input, index) => {
        input.value = campaign.tags?.[index] || "";
      });
      showToast(`${campaign.id || "캠페인"} 공개 정보를 가져왔습니다. 방문일과 첨부 파일을 확인해 주세요.`);
    } catch (error) {
      refs.formError.textContent = `링크 가져오기 실패: ${error.message}`;
      refs.formError.hidden = false;
    } finally {
      refs.inspectCampaignButton.disabled = false;
      refs.inspectCampaignButton.textContent = "체험단 링크 가져오기";
    }
  }

  /**
   * 캠페인 ID 는 화면에서 숨겼으므로 비어 있으면 여기서 만든다.
   * 체험단 링크의 id 파라미터가 있으면 그걸 쓰고(링크 가져오기와 같은 NB-<번호> 형태),
   * 없으면 방문일과 난수를 섞는다. 서버는 [A-Z0-9_-] 만 받는다.
   */
  function autoCampaignId(campaignUrl, visitDate) {
    const fromUrl = /[?&]id=(\d+)/.exec(campaignUrl || "")?.[1];
    if (fromUrl) return `NB-${fromUrl}`;
    const day = (visitDate || TODAY).replace(/-/g, "");
    return `NB-${day}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }

  refs.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    refs.formError.hidden = true;
    // 업로드가 길어서 모달이 그대로 있으면 안 눌린 줄 알고 다시 누른다. 버튼을 잠근다.
    if (refs.formSubmit.disabled) return;
    const formData = new FormData(refs.form);
    const rawTags = formData.getAll("userTag").map(String).filter((tag) => tag.trim());
    const tags = rawTags.map(normalizeTag).filter(Boolean);
    if (new Set(tags.map((tag) => tag.toLocaleLowerCase())).size !== tags.length) {
      refs.formError.textContent = "중복 태그를 제거해 주세요.";
      refs.formError.hidden = false;
      return;
    }
    const payload = {
      campaign_id: String(formData.get("campaignId") || "").trim().toUpperCase()
        || autoCampaignId(String(formData.get("campaignUrl") || ""), String(formData.get("visitDate") || "")),
      campaign_name: String(formData.get("campaignName") || "").trim(),
      campaign_url: String(formData.get("campaignUrl") || "").trim(),
      place_url: String(formData.get("placeUrl") || "").trim(),
      visit_date: String(formData.get("visitDate") || ""),
      visit_notes: String(formData.get("visitNotes") || "").trim(),
      requirements: String(formData.get("requirements") || "").trim(),
      tone_profile: String(formData.get("toneProfile") || "").trim(),
      user_tags: tags,
      prompt_profile_id: String(formData.get("promptProfileId") || "") || null,
      prompt_override: String(formData.get("promptOverride") || "").trim() || null,
      source_folder: String(formData.get("sourceFolder") || "").trim() || null,
    };
    if (payload.source_folder && (/^[A-Za-z]:[\\/]/.test(payload.source_folder) || payload.source_folder.startsWith("/") || payload.source_folder.split(/[\\/]/).includes(".."))) {
      refs.formError.textContent = "source 폴더는 로컬 절대 경로가 아닌 저장소 내부 상대 경로로 입력해 주세요.";
      refs.formError.hidden = false;
      return;
    }
    const files = [...(refs.mediaInput.files || [])];
    const submitLabel = refs.formSubmit.textContent;
    refs.formSubmit.disabled = true;
    refs.formSubmit.textContent = "저장하는 중…";
    let createdId = "";
    try {
      const created = await apiRequest(API_BASE, { method: "POST", body: JSON.stringify(payload) });
      createdId = String(created?.campaign_id || created?.id || payload.campaign_id);
    } catch (error) {
      refs.formError.textContent = `저장 실패: ${error.message}`;
      refs.formError.hidden = false;
      refs.formSubmit.disabled = false;
      refs.formSubmit.textContent = submitLabel;
      return;
    }

    // 캠페인이 만들어진 시점에 모달을 닫는다. 업로드는 파일 수에 따라 몇 분씩 걸려서
    // 그동안 모달이 떠 있으면 눌리지 않은 줄 알고 다시 누르게 된다.
    refs.dialog.close();
    refs.formSubmit.disabled = false;
    refs.formSubmit.textContent = submitLabel;
    await loadCampaigns();

    if (!files.length) {
      showToast(`${createdId} 캠페인을 저장했습니다.`);
      return;
    }
    showToast(`${createdId} 저장 완료 — 사진·영상 ${files.length}개를 올리는 중입니다…`);
    try {
      await uploadMedia(createdId, files);
      await loadCampaigns();
      showToast(`${createdId} 사진·영상 ${files.length}개를 올렸습니다.`);
    } catch (error) {
      // 모달이 이미 닫혀 formError 를 볼 수 없으므로 토스트로 알린다.
      showToast(`${createdId} 업로드 실패: ${error.message}`, true);
    }
  });

  refs.filters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (button) setFilter(button.dataset.filter);
  });
  document.querySelectorAll("[data-kpi-filter]").forEach((button) => button.addEventListener("click", () => setFilter(button.dataset.kpiFilter)));
  refs.search.addEventListener("input", renderCampaigns);
  refs.list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (button?.dataset.action) handleAction(button.dataset.action, button.dataset.campaignId);
  });
  refs.refresh.addEventListener("click", () => loadCampaigns({ notify: true }));
  refs.retryConnection.addEventListener("click", () => loadCampaigns({ notify: true }));
  document.getElementById("newCampaignButton").addEventListener("click", openDialog);
  refs.inspectCampaignButton?.addEventListener("click", inspectCampaignLink);
  document.getElementById("closeCampaignDialog").addEventListener("click", () => refs.dialog.close());
  document.getElementById("cancelCampaignDialog").addEventListener("click", () => refs.dialog.close());
  document.getElementById("closeCampaignDetails").addEventListener("click", () => refs.detailsDialog.close());
  refs.promptProfilesButton?.addEventListener("click", () => showPromptManager().catch((error) => showToast(`프롬프트 조회 실패: ${error.message}`, true)));
  refs.syncTokenButton?.addEventListener("click", () => showSyncTokens().catch((error) => showToast(`CLI 연결 정보 조회 실패: ${error.message}`, true)));
  // 상세 모달과 발행 화면이 같은 섹션 렌더러를 쓰므로 액션 처리도 공유한다 (#182).
  const onWorkspaceClick = async (event) => {
    const button = event.target.closest("[data-detail-action], [data-copy-kind]");
    if (!button) return;
    try {
      if (button.dataset.copyKind) {
        const value = handoffCopyValues(state.handoff || {})[button.dataset.copyKind] || "";
        await copyText(value);
        showToast(`${button.textContent.trim()} 완료`);
        return;
      }
      const action = button.dataset.detailAction;
      if (action === "save-visit-date") {
        const campaign = state.manage;
        if (!campaign) return;
        const value = document.getElementById("manageVisitDate")?.value || "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { showToast("올바른 방문일을 골라주세요.", true); return; }
        await apiRequest(`${API_BASE}/${encodeURIComponent(campaign.id)}/visit-date`, {
          method: "PATCH",
          body: JSON.stringify({ visit_date: value, expected_version: campaign.version, expected_updated_at: campaign.updatedAt }),
        });
        refs.detailsDialog.close();
        await loadCampaigns();
        showToast("방문일을 바꿨습니다. 이제 사진을 올려 글을 만들 수 있습니다.");
        return;
      }
      if (action === "archive-campaign") {
        const campaign = state.manage;
        if (!campaign) return;
        const typed = (document.getElementById("manageArchiveConfirm")?.value || "").trim();
        if (typed !== campaign.name.trim()) { showToast("캠페인 이름을 정확히 입력해야 보관할 수 있습니다.", true); return; }
        if (!window.confirm(`'${campaign.name}'을(를) 보관할까요? 목록에서 사라지고 사진 사본이 정리됩니다. 보관함에서 되돌릴 수 있습니다.`)) return;
        await apiRequest(`${API_BASE}/${encodeURIComponent(campaign.id)}/archive`, {
          method: "POST",
          body: JSON.stringify({ confirm_name: typed, expected_version: campaign.version, expected_updated_at: campaign.updatedAt }),
        });
        refs.detailsDialog.close();
        await loadCampaigns();
        showToast("캠페인을 보관했습니다. 보관함에서 되돌릴 수 있습니다.");
        return;
      }
      if (action === "upload-voice-note") {
        const payload = state.handoff;
        // 화면이 오래돼 버튼이 남아 있어도 확정 후에는 올리지 않는다(버튼 숨김과 동일한 이유).
        if (payload?.campaign?.generation_status === "content_confirmed") {
          showToast("글을 확인해서 음성메모 올리기가 잠겼습니다. 다시 만들면 다시 열립니다.", true);
          return;
        }
        const input = document.getElementById("voiceNoteInput");
        const file = input?.files?.[0];
        if (!file) { showToast("올릴 음성 파일을 먼저 골라주세요.", true); return; }
        button.disabled = true;
        button.textContent = "받아쓰는 중…";
        try {
          await apiRequest(`${API_BASE}/${encodeURIComponent(payload.campaign.campaign_id)}/voice-notes`, {
            method: "POST",
            headers: { "Content-Type": file.type, "X-Original-Name": encodeURIComponent(file.name) },
            body: file,
          });
          await showHandoff(payload.campaign.campaign_id);
          showToast("음성을 받아썼습니다. 틀린 곳이 있으면 고쳐주세요.");
        } finally {
          button.disabled = false;
          button.textContent = "올리고 받아쓰기";
        }
        return;
      }
      if (action === "save-voice-note") {
        const payload = state.handoff;
        const field = document.querySelector(`[data-voice-transcript="${CSS.escape(button.dataset.noteId)}"]`);
        await apiRequest(`${API_BASE}/${encodeURIComponent(payload.campaign.campaign_id)}/voice-notes/${encodeURIComponent(button.dataset.noteId)}`, {
          method: "PATCH",
          body: JSON.stringify({ transcript: field?.value || "" }),
        });
        showToast("고친 내용을 저장했습니다. 글을 다시 만들면 반영됩니다.");
        return;
      }
      if (action === "delete-voice-note") {
        const payload = state.handoff;
        if (!window.confirm(`${button.dataset.noteName || "이 음성메모"}를 지울까요?`)) return;
        await apiRequest(`${API_BASE}/${encodeURIComponent(payload.campaign.campaign_id)}/voice-notes/${encodeURIComponent(button.dataset.noteId)}`, { method: "DELETE" });
        await showHandoff(payload.campaign.campaign_id);
        showToast("음성메모를 지웠습니다.");
        return;
      }
      if (action === "open-publish") {
        const payload = state.handoff;
        refs.detailsDialog.close();
        await showPublish(payload.campaign.campaign_id);
        return;
      }
      if (action === "generate-draft") {
        const payload = state.handoff;
        button.disabled = true;
        try {
          await apiRequest(`${API_BASE}/${encodeURIComponent(payload.campaign.campaign_id)}/generate`, { method: "POST", body: JSON.stringify({}) });
          refs.detailsDialog.close();
          await loadCampaigns();
          showToast("글을 만들고 있습니다. 잠시 후 목록에서 확인해주세요.");
        } catch (error) {
          button.disabled = false;
          throw error;
        }
        return;
      }
      if (action === "confirm-content") {
        const payload = state.handoff;
        if (!window.confirm("현재 표시된 글을 모두 읽었으며 이 버전을 승인 확인 상태로 변경할까요?")) return;
        await apiRequest(`${API_BASE}/${encodeURIComponent(payload.campaign.campaign_id)}/content-confirmations`, {
          method: "POST",
          body: JSON.stringify({ confirmed: true, expected_artifact_version: Number(button.dataset.artifactVersion) }),
        });
        refs.detailsDialog.close();
        await loadCampaigns();
        showToast("글 확인이 완료되어 승인 확인 상태로 변경되었습니다.");
        return;
      }
      if (action === "issue-handoff-session") {
        const payload = state.handoff;
        if (!window.confirm("확인한 글로 10분짜리 자동입력 연결 코드를 만들까요? 최종 발행은 직접 해야 합니다.")) return;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        try {
          // 세션 발급과 브라우저 체크포인트도 캠페인 version을 올린다. 오래 열린
          // 발행 화면의 version으로 재발급하면 충돌하므로 먼저 최신 상태를 읽는다.
          const latest = await apiRequest(`${API_BASE}/${encodeURIComponent(payload.campaign.campaign_id)}/handoff`);
          Object.assign(payload, latest);
          const issued = await apiRequest(`${API_BASE}/${encodeURIComponent(payload.campaign.campaign_id)}/handoff-sessions`, {
            method: "POST",
            body: JSON.stringify({ expected_version: payload.campaign.version, expected_updated_at: payload.campaign.updated_at, expires_in_seconds: 600 }),
          });
          const refreshed = await apiRequest(`${API_BASE}/${encodeURIComponent(payload.campaign.campaign_id)}/handoff`);
          Object.assign(payload, refreshed);
          payload.handoff_session_issue = issued;
          renderPublishWorkspace(payload);
          showToast("자동입력 연결이 준비되었습니다. 10분 안에 연결 코드를 복사해주세요.");
        } finally {
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }
        return;
      }
      if (action === "copy-handoff-code") {
        await copyText(handoffConnectionCode(state.handoff?.handoff_session_issue));
        showToast("연결 코드를 복사했습니다. 확장 프로그램에 붙여넣어주세요.");
        return;
      }
      if (action === "copy-draft-payload") {
        if (!state.handoff?.draft) throw new Error("복사할 초안이 없습니다.");
        await copyText(draftTransferPayload(state.handoff));
        showToast("북마클릿용 초안을 복사했습니다. SmartEditor에서 즐겨찾기 도우미를 실행해주세요.");
        return;
      }
      if (action === "copy-bookmarklet-source") {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        try {
          const response = await fetch(BOOKMARKLET_SOURCE_URL, { cache: "no-store", credentials: "same-origin" });
          if (!response.ok) throw new Error(`즐겨찾기 도우미를 불러오지 못했습니다. (${response.status})`);
          const source = (await response.text()).trim();
          if (!source) throw new Error("즐겨찾기 도우미 코드가 비어 있습니다.");
          const bookmarkletUrl = source.startsWith("javascript:") ? source : `javascript:${source}`;
          await copyText(bookmarkletUrl);
          showToast("즐겨찾기 도우미 코드를 복사했습니다. 새 즐겨찾기의 주소에 붙여넣어주세요.");
        } finally {
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }
        return;
      }
      if (action === "open-editor") {
        const opened = window.open(button.dataset.editorUrl, "_blank", "noopener,noreferrer");
        if (!opened) showToast("팝업이 차단되었습니다. 직접 열기 링크를 사용하세요.", true);
        return;
      }
      if (action === "save-checkpoint") {
        const payload = state.handoff;
        const completed = [...refs.detailsBody.querySelectorAll('input[name="handoffStep"]:checked')].map((input) => input.value);
        const remaining = (payload.handoff?.remaining_steps || []).filter((step) => !completed.includes(step));
        await apiRequest(`${API_BASE}/${encodeURIComponent(payload.campaign.campaign_id)}/handoff/checkpoint`, {
          method: "POST",
          body: JSON.stringify({ expected_updated_at: payload.campaign.updated_at, expected_version: payload.campaign.version, resume_stage: "manual_handoff", resume_point: remaining[0] || "발행 결과 등록", completed_steps: completed, remaining_steps: remaining, note: "운영 화면 수동 인계 체크포인트" }),
        });
        await loadCampaigns();
        await showHandoff(payload.campaign.campaign_id);
        showToast("수동 인계 체크포인트를 서버에 저장했습니다.");
        return;
      }
      if (action === "media-up" || action === "media-down") {
        const payload = state.handoff;
        const index = Number(button.dataset.mediaIndex);
        const target = action === "media-up" ? index - 1 : index + 1;
        if (!payload?.media?.[index] || !payload.media[target]) return;
        [payload.media[index], payload.media[target]] = [payload.media[target], payload.media[index]];
        const items = payload.media.map((item, order) => ({ media_id: item.media_id, order: order + 1, included: item.included, is_cover: item.is_cover }));
        await apiRequest(`${API_BASE}/${encodeURIComponent(payload.campaign.campaign_id)}/media/order`, { method: "PATCH", body: JSON.stringify({ items }) });
        await showHandoff(payload.campaign.campaign_id);
        // 로컬 생성 경로는 #174 로 막혔다. 다시 만들기는 이 화면에서 한다.
        showToast("순서를 저장했습니다. 글을 다시 만들면 이 순서로 들어갑니다.");
        return;
      }
      if (action === "upload-detail-media") {
        const payload = state.handoff;
        const input = document.getElementById("detailsMediaInput");
        const files = [...(input?.files || [])];
        if (!files.length) {
          showToast("추가할 사진이나 영상을 먼저 선택해 주세요.", true);
          return;
        }
        button.disabled = true;
        button.textContent = "업로드 중…";
        await uploadMedia(payload.campaign.campaign_id, files);
        await loadCampaigns();
        await showHandoff(payload.campaign.campaign_id);
        showToast(`${files.length}개 파일을 추가했고 새 글 생성을 시작했습니다.`);
        return;
      }
      if (action === "exclude-media") {
        const payload = state.handoff;
        if (!window.confirm(`${button.dataset.mediaName || "이 파일"}을 현재 글과 다음 생성 대상에서 제외할까요? 서버 사본은 삭제되지만 로컬 원본은 유지됩니다.`)) return;
        await apiRequest(`${API_BASE}/${encodeURIComponent(payload.campaign.campaign_id)}/media/${encodeURIComponent(button.dataset.mediaId)}`, { method: "DELETE" });
        await showHandoff(payload.campaign.campaign_id);
        showToast("파일을 제외했습니다. 변경을 마치면 글을 다시 만들어 주세요.");
        return;
      }
      if (action === "issue-sync-token") {
        if (!window.confirm("새 연결 코드를 만들까요? 코드는 한 번만 보입니다.")) return;
        const issued = await apiRequest("/api/nblog/sync-tokens", { method: "POST", body: JSON.stringify({ label: `NBlog CLI · ${new Date().toLocaleDateString("ko-KR")}` }) });
        await showSyncTokens(issued);
        return;
      }
      if (action === "copy-sync-token") {
        await copyText(document.getElementById("issuedSyncToken")?.textContent || "");
        showToast("동기화 토큰을 복사했습니다.");
        return;
      }
      if (action === "revoke-sync-token") {
        if (!window.confirm("이 CLI 동기화 토큰을 폐기할까요?")) return;
        await apiRequest(`/api/nblog/sync-tokens/${encodeURIComponent(button.dataset.tokenId)}`, { method: "DELETE" });
        await showSyncTokens();
        showToast("동기화 토큰을 폐기했습니다.");
        return;
      }
      if (action === "edit-prompt") {
        const profile = state.promptProfiles.find((item) => item.prompt_profile_id === button.dataset.profileId);
        const form = document.getElementById("promptProfileForm");
        if (!profile || !form) return;
        form.elements.profileId.value = profile.system ? "" : profile.prompt_profile_id;
        form.elements.name.value = profile.system ? "체험단 후기 커스텀" : profile.name;
        form.elements.template.value = profile.template || "";
        form.elements.changeReason.value = profile.system ? "시스템 기본 프롬프트에서 생성" : "프롬프트 내용 수정";
        form.elements.name.focus();
        return;
      }
      if (action === "reset-system-prompt") {
        const form = document.getElementById("promptProfileForm");
        form.elements.profileId.value = "";
        form.elements.name.value = "체험단 후기 커스텀";
        form.elements.template.value = refs.detailsBody.dataset.systemPrompt || "";
        form.elements.changeReason.value = "시스템 기본값으로 복원";
        return;
      }
      if (action === "preview-prompt") {
        const form = document.getElementById("promptProfileForm");
        const result = await apiRequest(`${PROMPT_API}/validate`, { method: "POST", body: JSON.stringify({ template: form.elements.template.value }) });
        document.getElementById("promptValidationResult").innerHTML = result.valid ? `<strong class="nblog-prompt-valid">플레이스홀더 검증 통과</strong><pre>${esc(result.preview)}</pre>` : `<div class="nblog-workspace-warning">${(result.errors || []).map((error) => esc(error.message)).join("<br>")}</div>`;
        return;
      }
      if (action === "restore-prompt") {
        const profile = state.promptProfiles.find((item) => item.prompt_profile_id === button.dataset.profileId);
        await apiRequest(`${PROMPT_API}/${encodeURIComponent(button.dataset.profileId)}/restore`, { method: "POST", body: JSON.stringify({ version: Number(button.dataset.promptVersion), name: profile?.name, change_reason: `운영 화면에서 v${button.dataset.promptVersion} 복원` }) });
        await showPromptManager();
        await loadPromptProfiles();
        showToast("선택한 과거 프롬프트를 새 버전으로 복원했습니다.");
      }
    } catch (error) {
      showToast(`작업 실패: ${error.message}`, true);
    }
  };
  refs.detailsBody.addEventListener("click", onWorkspaceClick);
  refs.publishBody?.addEventListener("click", onWorkspaceClick);

  const onWorkspaceSubmit = async (event) => {
    event.preventDefault();
    try {
      if (event.target.id === "publicationForm") {
        const data = new FormData(event.target);
        const displayed = state.handoff;
        const campaignId = displayed.campaign.campaign_id;
        // 확장 프로그램의 연결·입력 체크포인트도 version을 올린다. 초안 버전은
        // 그대로인지 확인하되 최신 operation version으로 발행 결과를 기록한다.
        const latest = await apiRequest(`${API_BASE}/${encodeURIComponent(campaignId)}/handoff`);
        if (Number(latest.artifact_version || 0) !== Number(displayed.artifact_version || 0)) {
          throw new Error("발행 준비 중 글이 바뀌었습니다. 최신 글을 다시 확인해주세요.");
        }
        const campaign = latest.campaign;
        await apiRequest(`${API_BASE}/${encodeURIComponent(campaign.campaign_id)}/publish-result`, {
          method: "POST",
          body: JSON.stringify({
            expected_updated_at: campaign.updated_at,
            expected_version: campaign.version,
            published_url: data.get("publishedUrl"),
            published_at: new Date(String(data.get("publishedAt"))).toISOString(),
            checklist: { title: data.has("title"), sponsor_disclosure: data.has("sponsor_disclosure"), map: data.has("map"), media: data.has("media"), tags: data.has("tags") },
          }),
        });
        refs.publishDialog?.close();
        refs.detailsDialog.close();
        await loadCampaigns();
        showToast("발행 URL과 시각을 감사 이력에 저장했습니다.");
        return;
      }
      if (event.target.id === "promptProfileForm") {
        const data = new FormData(event.target);
        const id = String(data.get("profileId") || "");
        const body = JSON.stringify({ name: data.get("name"), template: data.get("template"), change_reason: data.get("changeReason") });
        await apiRequest(id ? `${PROMPT_API}/${encodeURIComponent(id)}` : PROMPT_API, { method: id ? "PUT" : "POST", body });
        await showPromptManager();
        await loadPromptProfiles();
        showToast(id ? "프롬프트 새 버전을 저장했습니다." : "프롬프트 프로필을 만들었습니다.");
      }
    } catch (error) {
      showToast(`저장 실패: ${error.message}`, true);
    }
  };
  refs.detailsBody.addEventListener("submit", onWorkspaceSubmit);
  refs.publishBody?.addEventListener("submit", onWorkspaceSubmit);

  refs.dialog.addEventListener("click", (event) => { if (event.target === refs.dialog) refs.dialog.close(); });
  refs.detailsDialog.addEventListener("click", (event) => { if (event.target === refs.detailsDialog) refs.detailsDialog.close(); });
  refs.publishDialog?.addEventListener("click", (event) => { if (event.target === refs.publishDialog) refs.publishDialog.close(); });
  refs.publishDialog?.addEventListener("close", () => clearHandoffSecret());
  document.getElementById("closeCampaignPublish")?.addEventListener("click", () => refs.publishDialog.close());

  setConnection(false, "연결을 시작합니다.");
  if (new URLSearchParams(location.search).get("new_campaign") === "1") openDialog();
  refs.currentDateChip.textContent = formatDate(TODAY);
  render();
  loadCampaigns();
})();
