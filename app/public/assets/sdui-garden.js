(() => {
  "use strict";

  const state = {
    me: null,
    repos: [],
    gardens: [],
    selectedGardenId: "",
    sourceRefs: [],
    sourceOptions: [],
    sourceOptionsHtml: "",
    sourceOptionsLoadedAt: 0,
    sourceOptionsLoading: null,
    publishSections: [],
    availableSections: [],
    organizations: [],
    gardenOrganizations: [],
    pendingLogo: null,
    logoUrl: "",
    deleteMode: false,
    deleteIds: new Set(),
  };

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));

  function safeExternalUrl(value) {
    try {
      const raw = String(value || "").trim();
      if (!raw) return "";
      const url = new URL(raw, location.origin);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
    return data;
  }

  function ref(ctx, id) {
    return ctx.refs[id] || document.getElementById(id);
  }

  function setStatus(ctx, message, danger = false) {
    const el = ref(ctx, "gardenStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("danger", danger);
  }

  function setGardenButtonTooltips(ctx) {
    const tooltips = {
      btnSaveGarden: "현재 입력한 제목·자료·주제·로고 설정만 저장합니다. 사이트를 배포하지는 않습니다.",
      btnRunGardenBuild: "저장된 설정으로 콘텐츠를 만들고 Garden Runner 대기열에 넣어 Pages 배포를 시작합니다.",
      btnReloadGardens: "저장된 Garden 목록과 최근 빌드 요청 상태를 다시 불러옵니다.",
    };
    Object.entries(tooltips).forEach(([id, message]) => {
      const button = ref(ctx, id);
      if (!button) return;
      button.title = message;
      button.setAttribute("aria-label", message);
    });
  }

  function setYamlPreviewVisibility(ctx, visible) {
    const preview = ref(ctx, "gardenConfigPreviewWrap");
    const panel = preview?.closest("[data-sdui-node=\"garden.preview.panel\"]")
      || document.querySelector("[data-sdui-node=\"garden.preview.panel\"]");
    if (panel) panel.hidden = !visible;
  }

  function setProviderFieldVisibility(ctx, nodeId, inputId, visible) {
    const field = document.querySelector(`[data-sdui-node="${nodeId}"]`)
      || ref(ctx, inputId)?.closest("label")
      || ref(ctx, inputId)?.parentElement;
    if (field) field.hidden = !visible;
  }

  function q(value) {
    return JSON.stringify(String(value ?? ""));
  }

  function recordToLines(record) {
    return Object.entries(record || {}).map(([key, value]) => `${key}: ${value}`).join("\n");
  }

  function linesToRecord(value) {
    const out = {};
    String(value || "").split(/\r?\n/).forEach((line) => {
      const text = line.trim();
      if (!text) return;
      const idx = text.indexOf(":");
      const key = (idx >= 0 ? text.slice(0, idx) : text).trim();
      const desc = (idx >= 0 ? text.slice(idx + 1) : text).trim();
      if (key && desc) out[key.slice(0, 80)] = desc.slice(0, 360);
    });
    return out;
  }

  function taxonomySuggestions(source) {
    const title = String(source?.source_title || "").trim();
    const topicMatch = title.match(/^\[([^\]]+)\]|^(.{2,28}?)(?=\s*(?:관련|자료|분석|조사|설계|회의|$))/);
    const topic = (topicMatch?.[1] || topicMatch?.[2] || (source?.source_type === "meeting" ? "회의·협업" : "분석·설계")).trim();
    const activities = [];
    if (/자동|모니터링|감지|연동/.test(title)) activities.push(["자동화·모니터링", "새 자료와 변경을 자동으로 수집하고 확인합니다."]);
    if (/조사|분석|검토|수문|데이터/.test(title)) activities.push(["분석·검토", "선택한 자료를 조사하고 근거를 분석합니다."]);
    if (/설계|기획|계획/.test(title)) activities.push(["기획·설계", "요구사항을 정리하고 실행 방식을 설계합니다."]);
    if (/회의|협업|논의/.test(title) || source?.source_type === "meeting") activities.push(["회의·협업", "회의 결과와 후속 작업을 정리합니다."]);
    if (!activities.length) activities.push([source?.source_type === "meeting" ? "회의·협업" : "분석·검토", source?.source_type === "meeting" ? "회의 결과와 후속 작업을 정리합니다." : "선택한 자료를 검토하고 결과를 정리합니다."]);
    return {
      topics: topic ? [[topic.slice(0, 80), `${title || topic} 관련 자료를 지식베이스 주제로 정리합니다.`]] : [],
      activities,
    };
  }

  function applySourceTaxonomy(ctx, source) {
    const suggested = taxonomySuggestions(source);
    const topics = linesToRecord(ref(ctx, "gardenTopics")?.value || "");
    const activities = linesToRecord(ref(ctx, "gardenActivities")?.value || "");
    suggested.topics.forEach(([key, value]) => { if (!topics[key]) topics[key] = value; });
    suggested.activities.forEach(([key, value]) => { if (!activities[key]) activities[key] = value; });
    ref(ctx, "gardenTopics").value = recordToLines(topics);
    ref(ctx, "gardenActivities").value = recordToLines(activities);
  }

  function buildValidationErrors(ctx) {
    const payload = currentPayload(ctx);
    const errors = [];
    if (payload.source_mode === "github" && !payload.repo) errors.push("GitHub repo");
    if (!String(payload.title || "").trim()) errors.push("사이트 제목");
    if (payload.source_mode === "github" && !String(payload.publishLabel || "").trim()) errors.push("공개 기준 label");
    if (payload.source_mode === "github" && !String(payload.issuesDir || "").trim()) errors.push("Issues 경로");
    if (!payload.source_refs.length && !String(payload.direct_content || "").trim()) errors.push("분석·설계·회의록 자료 또는 직접 작성 콘텐츠");
    if (!Object.keys(payload.topics).length) errors.push("업무 주제 topics");
    if (!Object.keys(payload.activities).length) errors.push("일하는 방식 activities");
    return errors;
  }

  function fallbackTitle(repo) {
    const name = String(repo || "").split("/")[1] || "repo";
    return `${name} 지식베이스`;
  }

  function currentPayload(ctx) {
    const repo = ref(ctx, "gardenRepo")?.value || "";
    const selectedRepo = state.repos.find((item) => item.full_name === repo);
    const title = ref(ctx, "gardenTitle")?.value || fallbackTitle(repo);
    const directContent = String(ref(ctx, "gardenDirectContent")?.value || "").trim();
    const sourceMode = state.me?.provider === "github" && repo
      ? "github"
      : (state.sourceRefs.length ? "analysis" : (directContent ? "direct" : "analysis"));
    return {
      repo,
      title,
      source_mode: sourceMode,
      sourceVisibility: selectedRepo?.private ? "private" : "public",
      publishLabel: ref(ctx, "gardenPublishLabel")?.value || "audience:business",
      publishSections: state.publishSections,
      issuesDir: ref(ctx, "gardenIssuesDir")?.value || "Knowledge/Issues",
      deploy_target: "cloudflare_pages",
      source_refs: state.sourceRefs,
      direct_content: directContent,
      topics: linesToRecord(ref(ctx, "gardenTopics")?.value || ""),
      activities: linesToRecord(ref(ctx, "gardenActivities")?.value || ""),
    };
  }

  function configFromPayload(payload) {
    return {
      source: {
        repo: payload.repo,
        mode: payload.source_mode || "analysis",
        issuesDir: payload.issuesDir || "Knowledge/Issues",
        visibility: payload.sourceVisibility || "public",
      },
      publish: {
        label: payload.publishLabel || "audience:business",
        sections: payload.publishSections || [],
      },
      site: {
        title: payload.title || fallbackTitle(payload.repo),
        baseUrl: "",
        logo: "",
      },
      taxonomy: {
        topics: payload.topics || {},
        activities: payload.activities || {},
      },
      sourceRefs: payload.source_refs || [],
      directContent: payload.direct_content || "",
    };
  }

  function yamlFromConfig(config) {
    const lines = [
      "source:",
      `  repo: ${q(config.source.repo)}`,
      `  mode: ${q(config.source.mode)}`,
      `  issuesDir: ${q(config.source.issuesDir)}`,
      "publish:",
      `  label: ${q(config.publish.label)}`,
      `  sections: [${(config.publish.sections || []).map(q).join(", ")}]`,
      "site:",
      `  title: ${q(config.site.title)}`,
      `  baseUrl: ${q(config.site.baseUrl)}`,
      `  logo: ${q(config.site.logo)}`,
      "taxonomy:",
      "  topics:",
    ];
    const topics = Object.entries(config.taxonomy.topics || {});
    if (!topics.length) lines.push("    {}");
    else topics.forEach(([key, value]) => lines.push(`    ${q(key)}: ${q(value)}`));
    lines.push("  activities:");
    const activities = Object.entries(config.taxonomy.activities || {});
    if (!activities.length) lines.push("    {}");
    else activities.forEach(([key, value]) => lines.push(`    ${q(key)}: ${q(value)}`));
    return `${lines.join("\n")}\n`;
  }

  function refreshPreview(ctx, yaml) {
    const pre = ref(ctx, "gardenConfigPreview");
    if (!pre) return;
    pre.textContent = yaml || yamlFromConfig(configFromPayload(currentPayload(ctx)));
  }

  function setGeneratedUrl(ctx, value) {
    const el = ref(ctx, "gardenBaseUrl");
    if (!el) return;
    el.textContent = value || "저장 후 자동 생성됩니다";
    el.dataset.ready = value ? "true" : "false";
  }

  function renderGardenSources(ctx) {
    const chips = ref(ctx, "gardenSourceChips");
    if (!chips) return;
    chips.innerHTML = state.sourceRefs.map((item) => `<span class="source-chip"><b>${item.source_type === "meeting" ? "회의록" : "분석·설계"}</b>${esc(item.source_title)}<button type="button" data-garden-source-remove="${esc(item.source_id)}" aria-label="${esc(item.source_title)} 제거">×</button></span>`).join("");
  }

  function renderLogoPreview(ctx, logo) {
    const preview = ref(ctx, "gardenLogoPreview");
    if (!preview) return;
    const title = ref(ctx, "gardenTitle")?.value || "Garden";
    preview.innerHTML = logo ? `<img src="${esc(logo)}" alt="${esc(title)} 로고"><span>${esc(title)}</span>` : `<strong>${esc(title)}</strong><small>로고가 없으면 사이트 제목 표시</small>`;
  }

  // 분석·설계·회의록 연결 드롭다운 — 서버 목록 clamp(200)와 같은 값이어야 최근 자료가 잘리지 않는다.
  const SOURCE_OPTION_FETCH_LIMIT = 200;
  const SOURCE_OPTION_REFRESH_MS = 5000;

  function sourceOptionLabel(item) {
    const kind = item.source_type === "meeting" ? "회의록" : "분석·설계";
    const date = String(item.date || item.updated_at || item.created_at || "").slice(0, 10);
    return `[${kind}] ${item.source_title}${date ? ` · ${date}` : ""}`;
  }

  function renderSourceOptions(ctx) {
    const select = ref(ctx, "gardenSourceSelect");
    if (!select) return;
    const html = `<option value="">자료를 선택하세요</option>${state.sourceOptions.map((item) => `<option value="${esc(item.source_id)}">${esc(sourceOptionLabel(item))}</option>`).join("")}`;
    if (state.sourceOptionsHtml === html) return;
    state.sourceOptionsHtml = html;
    select.innerHTML = html;
  }

  function loadSourceOptions(ctx) {
    if (state.sourceOptionsLoading) return state.sourceOptionsLoading;
    state.sourceOptionsLoading = (async () => {
      const [analysis, meetings] = await Promise.all([
        api(`/api/analysis/sessions?limit=${SOURCE_OPTION_FETCH_LIMIT}`).catch(() => null),
        api(`/api/meetings?limit=${SOURCE_OPTION_FETCH_LIMIT}`).catch(() => null),
      ]);
      // 갱신 실패 시 기존 목록을 비우지 않고 유지한다.
      const keep = (type) => state.sourceOptions.filter((item) => item.source_type === type);
      state.sourceOptions = [
        ...(analysis
          ? (analysis.sessions || []).map((item) => ({ ...item, source_type: "analysis", source_id: item.id, source_title: item.title || item.subject || "분석·설계" }))
          : keep("analysis")),
        ...(meetings
          ? (meetings.meetings || []).map((item) => ({ ...item, source_type: "meeting", source_id: item.id, source_title: item.title || "회의록" }))
          : keep("meeting")),
      ];
      state.sourceOptionsLoadedAt = Date.now();
      renderSourceOptions(ctx);
    })().finally(() => { state.sourceOptionsLoading = null; });
    return state.sourceOptionsLoading;
  }

  function refreshSourceOptionsSoon(ctx) {
    if (Date.now() - state.sourceOptionsLoadedAt < SOURCE_OPTION_REFRESH_MS) return;
    void loadSourceOptions(ctx);
  }

  function fillRepoOptions(ctx) {
    const select = ref(ctx, "gardenRepo");
    if (!select) return;
    const selected = select.value;
    select.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = state.repos.length ? "repo를 선택하세요" : "GitHub repo 없음";
    select.appendChild(empty);
    state.repos.forEach((repo) => {
      const option = document.createElement("option");
      option.value = repo.full_name;
      option.textContent = `${repo.full_name}${repo.private ? " 🔒" : ""}`;
      select.appendChild(option);
    });
    if (selected && state.repos.some((repo) => repo.full_name === selected)) select.value = selected;
  }

  function renderGardenList(ctx) {
    const list = ref(ctx, "gardenList");
    if (!list) return;
    if (!state.gardens.length) {
      list.innerHTML = '<div class="garden-list-toolbar"><strong>Garden 목록</strong></div><p class="hint">아직 저장된 Garden이 없습니다.</p>';
      return;
    }
    list.innerHTML = `<div class="garden-list-toolbar">
      <strong>Garden 목록</strong>
      <span class="result-actions">
        ${state.deleteMode ? '<button class="btn btn-danger btn-small" type="button" data-garden-list-action="delete-selected">선택 삭제</button><button class="btn btn-ghost btn-small" type="button" data-garden-list-action="cancel-delete">취소</button>' : '<button class="btn btn-ghost btn-small" type="button" data-garden-list-action="start-delete">삭제</button>'}
      </span>
    </div>${state.gardens.map((garden) => `
      <div class="garden-list-row ${garden.id === state.selectedGardenId ? "active" : ""}">
        ${state.deleteMode ? `<label class="garden-delete-check"><input type="checkbox" data-garden-delete-id="${esc(garden.id)}" ${state.deleteIds.has(garden.id) ? "checked" : ""}><span class="sr-only">${esc(garden.title)} 선택</span></label>` : ""}
        <button class="garden-list-main" type="button" data-garden-id="${esc(garden.id)}">
          <strong>${esc(garden.title)}</strong>
          <span>${esc(garden.repo)} · ${esc(garden.status)} · ${esc((garden.updated_at || "").slice(0, 10))}</span>
        </button>
        ${safeExternalUrl(garden.site_url) ? `<a class="btn btn-ghost btn-small garden-site-link" href="${esc(safeExternalUrl(garden.site_url))}" target="_blank" rel="noopener">사이트 열기</a>` : ""}
        <button class="btn btn-ghost btn-small" type="button" data-garden-edit-id="${esc(garden.id)}">편집</button>
      </div>`).join("")}`;
  }

  function renderPublishSections(ctx) {
    const host = ref(ctx, "gardenPublishSections");
    if (!host) return;
    if (!state.availableSections.length) {
      host.innerHTML = '<p class="hint">분석 산출물이 있으면 공개할 섹션을 선택할 수 있습니다. 선택 항목이 없으면 전체 섹션을 공개합니다.</p>';
      return;
    }
    host.innerHTML = `<span class="field-label">공개 섹션</span><p class="hint">선택하지 않으면 전체 공개합니다.</p><div class="source-chips">${state.availableSections.map((kind) => `<label class="source-chip"><input type="checkbox" value="${esc(kind)}" ${state.publishSections.includes(kind) ? "checked" : ""}> ${esc(kind)}</label>`).join("")}</div>`;
  }

  async function refreshPublishSections(ctx) {
    const analysisRefs = state.sourceRefs.filter((item) => item.source_type !== "meeting");
    const details = await Promise.all(analysisRefs.map((item) => api(`/api/analysis/sessions/${encodeURIComponent(item.source_id)}`).catch(() => ({ outputs: {} }))));
    state.availableSections = [...new Set(details.flatMap((detail) => Object.keys(detail.outputs || {})))].sort();
    if (state.availableSections.length) state.publishSections = state.publishSections.filter((kind) => state.availableSections.includes(kind));
    renderPublishSections(ctx);
  }

  function textLogoSvg(text) {
    const safe = String(text || "Garden").trim().slice(0, 40).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="180" viewBox="0 0 720 180"><rect width="720" height="180" rx="28" fill="#fff"/><text x="360" y="108" text-anchor="middle" font-family="Arial, 'Noto Sans KR', sans-serif" font-size="64" font-weight="800" fill="#172033">${safe}</text></svg>`;
  }

  async function deleteSelectedGardens(ctx) {
    const ids = [...state.deleteIds];
    if (!ids.length) {
      setStatus(ctx, "삭제할 Garden을 선택하세요.", true);
      return;
    }
    if (!window.confirm(`선택한 Garden ${ids.length}개와 빌드 기록을 삭제할까요? 배포 사이트는 3일 뒤 자동으로 제거되며, 이 작업은 되돌릴 수 없습니다.`)) return;
    setStatus(ctx, `Garden ${ids.length}개를 삭제하는 중입니다.`);
    try {
      for (const id of ids) await api(`/api/gardens/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (ids.includes(state.selectedGardenId)) newGardenForm(ctx);
      state.deleteIds.clear();
      state.deleteMode = false;
      await loadGardens(ctx);
      setStatus(ctx, `Garden ${ids.length}개를 삭제했습니다. 배포 사이트는 3일 뒤 자동으로 제거됩니다.`);
    } catch (err) {
      setStatus(ctx, err instanceof Error ? err.message : "Garden 삭제에 실패했습니다.", true);
    }
  }

  function renderBuilds(ctx, builds = []) {
    const box = ref(ctx, "gardenBuilds");
    if (!box) return;
    if (!state.selectedGardenId) {
      box.innerHTML = '<p class="hint">Garden을 선택하면 빌드 요청 이력이 표시됩니다.</p>';
      return;
    }
    if (!builds.length) {
      box.innerHTML = '<p class="hint">아직 빌드 요청 이력이 없습니다.</p>';
      return;
    }
    box.innerHTML = [
      '<div class="result-actions"><button class="btn btn-ghost btn-small" type="button" data-garden-force-build="true">강제 재빌드</button></div>',
      '<div class="field-label">최근 빌드 요청</div>',
      '<div class="asset-list">',
      ...builds.map((build) => {
        const terminal = build.status === "succeeded" || build.status === "failed";
        return `
          <div class="asset-row garden-build-row">
            <strong>${esc(build.status)}</strong>
            <span>${esc((build.started_at || "").replace("T", " ").slice(0, 16))}</span>
            <span class="result-actions">
              ${safeExternalUrl(build.manifest_url) ? `<a class="btn btn-ghost btn-small" href="${esc(safeExternalUrl(build.manifest_url))}" target="_blank" rel="noopener">manifest</a>` : ""}
              ${safeExternalUrl(build.config_url) ? `<a class="btn btn-ghost btn-small" href="${esc(safeExternalUrl(build.config_url))}" target="_blank" rel="noopener">config</a>` : ""}
              ${terminal && safeExternalUrl(build.result_url) ? `<a class="btn btn-ghost btn-small" href="${esc(safeExternalUrl(build.result_url))}" target="_blank" rel="noopener">result</a>` : ""}
              ${safeExternalUrl(build.site_url) ? `<a class="btn btn-ghost btn-small" href="${esc(safeExternalUrl(build.site_url))}" target="_blank" rel="noopener">site</a>` : ""}
              <button class="btn btn-ghost btn-small" type="button" data-garden-build-delete="${esc(build.id)}">삭제</button>
            </span>
          </div>
          ${build.message ? `<p class="hint">${esc(build.message)}</p>` : ""}
          ${build.error_message ? `<p class="hint danger">${esc(build.error_message)}</p>` : ""}`;
      }),
      "</div>",
    ].join("");
  }

  async function loadRepos(ctx) {
    try {
      const data = await api("/api/git/repos");
      state.repos = data.repos || [];
      fillRepoOptions(ctx);
    } catch (err) {
      state.repos = [];
      fillRepoOptions(ctx);
      setStatus(ctx, err instanceof Error ? err.message : "GitHub repo 목록을 불러오지 못했습니다.", true);
    }
  }

  async function loadGardens(ctx) {
    const data = await api("/api/gardens?limit=100");
    state.gardens = data.gardens || [];
    renderGardenList(ctx);
    if (state.selectedGardenId && !state.gardens.some((garden) => garden.id === state.selectedGardenId)) {
      state.selectedGardenId = "";
      renderBuilds(ctx);
    }
  }

  async function loadBuilds(ctx) {
    if (!state.selectedGardenId) {
      renderBuilds(ctx);
      return;
    }
    const data = await api(`/api/gardens/${encodeURIComponent(state.selectedGardenId)}/builds?limit=10`);
    renderBuilds(ctx, data.builds || []);
  }

  function setForm(ctx, garden) {
    const config = garden?.config || {};
    const source = config.source || {};
    const publish = config.publish || {};
    const site = config.site || {};
    const taxonomy = config.taxonomy || {};
    state.selectedGardenId = garden?.id || "";

    ref(ctx, "gardenRepo").value = source.repo || garden?.repo || "";
    ref(ctx, "gardenTitle").value = site.title || garden?.title || "";
    ref(ctx, "gardenPublishLabel").value = publish.label || "audience:business";
    ref(ctx, "gardenIssuesDir").value = source.issuesDir || "Knowledge/Issues";
    ref(ctx, "gardenDeployTarget").value = "cloudflare_pages";
    if (ref(ctx, "gardenDirectContent")) ref(ctx, "gardenDirectContent").value = config.directContent || "";
    setGeneratedUrl(ctx, site.baseUrl || garden?.site_url || "");
    state.sourceRefs = config.sourceRefs || [];
    state.publishSections = publish.sections || [];
    state.pendingLogo = null;
    state.logoUrl = site.logo || "";
    renderGardenSources(ctx);
    void refreshPublishSections(ctx);
    renderLogoPreview(ctx, state.logoUrl);
    ref(ctx, "gardenTopics").value = recordToLines(taxonomy.topics || {});
    ref(ctx, "gardenActivities").value = recordToLines(taxonomy.activities || {});
    ref(ctx, "btnRunGardenBuild").disabled = false;
    refreshPreview(ctx, garden?.config_yaml);
    renderGardenList(ctx);
    void loadGardenOrganizations(ctx);
  }

  function newGardenForm(ctx) {
    state.selectedGardenId = "";
    ref(ctx, "gardenRepo").value = "";
    ref(ctx, "gardenTitle").value = "";
    ref(ctx, "gardenPublishLabel").value = "audience:business";
    ref(ctx, "gardenIssuesDir").value = "Knowledge/Issues";
    ref(ctx, "gardenDeployTarget").value = "cloudflare_pages";
    if (ref(ctx, "gardenDirectContent")) ref(ctx, "gardenDirectContent").value = "";
    setGeneratedUrl(ctx, "");
    state.sourceRefs = [];
    state.publishSections = [];
    state.availableSections = [];
    state.pendingLogo = null;
    state.logoUrl = "";
    renderGardenSources(ctx);
    renderPublishSections(ctx);
    renderLogoPreview(ctx, "");
    ref(ctx, "gardenTopics").value = "";
    ref(ctx, "gardenActivities").value = "";
    ref(ctx, "btnRunGardenBuild").disabled = false;
    setStatus(ctx, "");
    state.gardenOrganizations = [];
    renderGardenOrganizationLinker(ctx);
    renderBuilds(ctx);
    refreshPreview(ctx);
    renderGardenList(ctx);
  }

  async function selectGarden(ctx, id) {
    setStatus(ctx, "Garden 설정을 불러오는 중입니다.");
    try {
      const data = await api(`/api/gardens/${encodeURIComponent(id)}`);
      setForm(ctx, data.garden);
      await loadBuilds(ctx);
      setStatus(ctx, "");
    } catch (err) {
      setStatus(ctx, err instanceof Error ? err.message : "Garden을 불러오지 못했습니다.", true);
    }
  }

  async function saveGarden(ctx, options = {}) {
    const payload = currentPayload(ctx);
    if (payload.source_mode === "github" && !payload.repo) {
      setStatus(ctx, "GitHub repo를 선택하거나 분석자료 기반 모드를 사용하세요.", true);
      return null;
    }
    setStatus(ctx, "Garden 설정을 저장하는 중입니다.");
    const path = state.selectedGardenId ? `/api/gardens/${encodeURIComponent(state.selectedGardenId)}` : "/api/gardens";
    try {
      const data = await api(path, {
        method: state.selectedGardenId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const gardenId = data.garden?.id || state.selectedGardenId;
      if (state.pendingLogo && gardenId) {
        const form = new FormData();
        form.append("logo", state.pendingLogo);
        const response = await window.apiFetch(`/api/gardens/${encodeURIComponent(gardenId)}/logo`, { method: "POST", body: form });
        const logoData = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(logoData.error || "로고 업로드에 실패했습니다.");
        data.garden = logoData.garden || data.garden;
        state.pendingLogo = null;
      }
      await loadGardens(ctx);
      setForm(ctx, data.garden);
      await loadBuilds(ctx);
      setStatus(ctx, options.forBuild ? "최신 설정을 저장했습니다. 빌드를 요청합니다." : "저장되었습니다.");
      return data.garden;
    } catch (err) {
      setStatus(ctx, err instanceof Error ? err.message : "저장에 실패했습니다.", true);
      return null;
    }
  }

  function gardenSourcePicker(ctx, _node, el) {
    el.innerHTML = `<div class="field-label">분석·설계·회의록 연결</div><p class="hint">한 개 이상 여러 자료를 함께 선택할 수 있습니다.</p><select id="gardenSourceSelect"><option value="">자료를 선택하세요</option></select><div id="gardenSourceChips" class="source-chips"></div>`;
    ctx.refs.gardenSourceSelect = el.querySelector("#gardenSourceSelect");
    ctx.refs.gardenSourceChips = el.querySelector("#gardenSourceChips");
    state.sourceOptionsHtml = "";
    renderSourceOptions(ctx);
    // 드롭다운을 다시 열 때 최근에 만든 분석·회의록도 목록에 반영한다.
    ["pointerdown", "focus"].forEach((type) => ctx.refs.gardenSourceSelect.addEventListener(type, () => refreshSourceOptionsSoon(ctx)));
    ctx.refs.gardenSourceSelect.addEventListener("change", (event) => {
      const found = state.sourceOptions.find((item) => item.source_id === event.target.value);
      if (found && !state.sourceRefs.some((item) => item.source_id === found.source_id)) {
        state.sourceRefs.push({ source_type: found.source_type, source_id: found.source_id, source_title: found.source_title });
        applySourceTaxonomy(ctx, found);
      }
      event.target.value = "";
      renderGardenSources(ctx);
      void refreshPublishSections(ctx);
      refreshPreview(ctx);
    });
    ctx.refs.gardenSourceChips.addEventListener("click", (event) => {
      const button = event.target.closest("[data-garden-source-remove]");
      if (!button) return;
      state.sourceRefs = state.sourceRefs.filter((item) => item.source_id !== button.dataset.gardenSourceRemove);
      renderGardenSources(ctx);
      void refreshPublishSections(ctx);
      refreshPreview(ctx);
    });
  }

  function gardenDirectContent(ctx, _node, el) {
    el.innerHTML = `<label><span class="field-label">직접 작성 콘텐츠</span><p class="hint">분석자료나 회의록 없이도 공개할 본문을 직접 작성할 수 있습니다.</p><textarea id="gardenDirectContent" rows="8" maxlength="120000" placeholder="Garden에 공개할 내용을 입력하세요."></textarea></label>`;
    ctx.refs.gardenDirectContent = el.querySelector("#gardenDirectContent");
    ctx.refs.gardenDirectContent.addEventListener("input", () => refreshPreview(ctx));
  }

  function gardenOrganizationLinker(ctx, _node, el) {
    el.id = "gardenOrganizationLinker";
    ctx.refs.gardenOrganizationLinker = el;
    renderGardenOrganizationLinker(ctx);
  }

  function renderGardenOrganizationLinker(ctx) {
    const host = ref(ctx, "gardenOrganizationLinker");
    if (!host) return;
    const options = state.organizations.length
      ? state.organizations.map((org) => `<option value="${esc(org.id)}">${esc(org.name)} · ${esc(org.role === "admin" ? "관리자" : "일반")}</option>`).join("")
      : '<option value="">먼저 마이페이지에서 조직을 만드세요</option>';
    const links = state.gardenOrganizations.map((org) => `<span class="source-chip"><span>${esc(org.name)} · 조직 전용</span><button type="button" class="btn btn-ghost btn-small" data-garden-org-unlink="${esc(org.id)}">해제</button></span>`).join("");
    host.innerHTML = `<span class="field-label">조직 연결</span><p class="hint">저장 후 조직에 연결하면 마이페이지 조직 탭에서 이 Garden을 볼 수 있습니다. 실제 문서 보호는 Cloudflare Access 정책이 담당합니다.</p><div class="result-actions"><select id="gardenOrganizationSelect" ${state.organizations.length && state.selectedGardenId ? "" : "disabled"}><option value="">조직을 선택하세요</option>${options}</select><button id="gardenOrganizationLink" class="btn btn-ghost btn-small" type="button" ${state.selectedGardenId && state.organizations.length ? "" : "disabled"}>조직에 연결</button></div><div class="source-chips" id="gardenOrganizationChips">${links || '<span class="hint">아직 연결된 조직이 없습니다.</span>'}</div>`;
    ctx.refs.gardenOrganizationSelect = host.querySelector("#gardenOrganizationSelect");
    ctx.refs.gardenOrganizationLink = host.querySelector("#gardenOrganizationLink");
    ctx.refs.gardenOrganizationLink?.addEventListener("click", () => void linkSelectedOrganization(ctx));
    host.querySelectorAll("[data-garden-org-unlink]").forEach((button) => button.addEventListener("click", () => void unlinkOrganization(ctx, button.dataset.gardenOrgUnlink)));
  }

  async function loadOrganizations(ctx) {
    try {
      const data = await api("/api/orgs");
      state.organizations = data.organizations || [];
    } catch {
      state.organizations = [];
    }
    renderGardenOrganizationLinker(ctx);
  }

  async function loadGardenOrganizations(ctx) {
    if (!state.selectedGardenId) {
      state.gardenOrganizations = [];
      renderGardenOrganizationLinker(ctx);
      return;
    }
    try {
      const data = await api(`/api/gardens/${encodeURIComponent(state.selectedGardenId)}/organizations`);
      state.gardenOrganizations = data.organizations || [];
    } catch {
      state.gardenOrganizations = [];
    }
    renderGardenOrganizationLinker(ctx);
  }

  async function linkSelectedOrganization(ctx) {
    const orgId = ref(ctx, "gardenOrganizationSelect")?.value;
    if (!state.selectedGardenId || !orgId) {
      setStatus(ctx, "Garden을 먼저 저장하고 조직을 선택하세요.", true);
      return;
    }
    try {
      await api(`/api/gardens/${encodeURIComponent(state.selectedGardenId)}/organizations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      await loadGardenOrganizations(ctx);
      setStatus(ctx, "조직에 Garden을 연결했습니다.");
    } catch (err) {
      setStatus(ctx, err instanceof Error ? err.message : "조직 연결에 실패했습니다.", true);
    }
  }

  async function unlinkOrganization(ctx, orgId) {
    if (!state.selectedGardenId || !orgId) return;
    if (!window.confirm("이 조직에서 Garden 연결을 해제할까요?")) return;
    try {
      await api(`/api/gardens/${encodeURIComponent(state.selectedGardenId)}/organizations/${encodeURIComponent(orgId)}`, { method: "DELETE" });
      await loadGardenOrganizations(ctx);
      setStatus(ctx, "조직 연결을 해제했습니다.");
    } catch (err) {
      setStatus(ctx, err instanceof Error ? err.message : "조직 연결 해제에 실패했습니다.", true);
    }
  }

  function gardenLogoPicker(ctx, _node, el) {
    el.innerHTML = `<span class="field-label">사이트 로고</span><p class="hint">텍스트를 입력하면 명함처럼 바로 로고로 만들어집니다.</p><div id="gardenLogoPreview" class="garden-logo-preview"></div><div id="gardenLogoTextEditor" class="garden-logo-text-editor" hidden><label><span class="field-label">로고 문구</span><input id="gardenLogoText" type="text" maxlength="40" placeholder="예: 기획 하네스 루프"></label><div class="garden-logo-actions"><button id="gardenLogoTextDone" class="btn btn-primary btn-small" type="button">완료</button><button id="gardenLogoTextCancel" class="btn btn-ghost btn-small" type="button">취소</button></div></div><div class="garden-logo-actions"><button id="gardenLogoEdit" class="btn btn-ghost btn-small" type="button">로고 편집</button><button id="gardenLogoDelete" class="btn btn-ghost btn-small" type="button">로고 제거</button></div>`;
    ["gardenLogoPreview", "gardenLogoTextEditor", "gardenLogoText", "gardenLogoTextDone", "gardenLogoTextCancel", "gardenLogoEdit", "gardenLogoDelete"].forEach((id) => { ctx.refs[id] = el.querySelector(`#${id}`); });
    const previewTextLogo = () => {
      const svg = textLogoSvg(ctx.refs.gardenLogoText.value || ref(ctx, "gardenTitle")?.value);
      renderLogoPreview(ctx, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    };
    ctx.refs.gardenLogoEdit.addEventListener("click", () => {
      ctx.refs.gardenLogoText.value = ref(ctx, "gardenTitle")?.value || "Garden";
      ctx.refs.gardenLogoTextEditor.hidden = false;
      ctx.refs.gardenLogoText.focus();
      previewTextLogo();
    });
    ctx.refs.gardenLogoText.addEventListener("input", previewTextLogo);
    ctx.refs.gardenLogoTextDone.addEventListener("click", () => {
      const svg = textLogoSvg(ctx.refs.gardenLogoText.value);
      state.pendingLogo = new File([svg], "text-logo.svg", { type: "image/svg+xml" });
      state.logoUrl = URL.createObjectURL(state.pendingLogo);
      ctx.refs.gardenLogoTextEditor.hidden = true;
      renderLogoPreview(ctx, state.logoUrl);
      setStatus(ctx, "텍스트 로고가 준비되었습니다. 설정 저장을 누르면 저장됩니다.");
    });
    ctx.refs.gardenLogoTextCancel.addEventListener("click", () => { ctx.refs.gardenLogoTextEditor.hidden = true; renderLogoPreview(ctx, state.logoUrl); });
    ctx.refs.gardenLogoDelete.addEventListener("click", async () => {
      state.pendingLogo = null;
      state.logoUrl = "";
      if (state.selectedGardenId) await api(`/api/gardens/${encodeURIComponent(state.selectedGardenId)}/logo`, { method: "DELETE" }).catch(() => ({}));
      renderLogoPreview(ctx, "");
    });
    renderLogoPreview(ctx, "");
  }

  function gardenPublishSections(ctx, _node, el) {
    el.id = "gardenPublishSections";
    ctx.refs.gardenPublishSections = el;
    el.addEventListener("change", () => {
      state.publishSections = [...el.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
      refreshPreview(ctx);
    });
    renderPublishSections(ctx);
  }

  async function runBuild(ctx, force = false) {
    const errors = buildValidationErrors(ctx);
    if (errors.length) {
      setStatus(ctx, `빌드 전에 필수 항목을 입력하세요: ${errors.join(", ")}`, true);
      return;
    }
    const saved = await saveGarden(ctx, { forBuild: true });
    if (!saved?.id) return;
    setStatus(ctx, "최신 설정으로 빌드 요청을 기록하는 중입니다.");
    try {
      const data = await api(`/api/gardens/${encodeURIComponent(saved.id)}/build${force ? "?force=true" : ""}`, { method: "POST" });
      await loadGardens(ctx);
      setForm(ctx, data.garden);
      await loadBuilds(ctx);
      setStatus(ctx, "빌드 요청을 기록했습니다.");
    } catch (err) {
      setStatus(ctx, err instanceof Error ? err.message : "빌드 요청에 실패했습니다.", true);
    }
  }

  function taxonomyEditor(ctx, _node, el) {
    el.className = `${el.className || ""} taxonomy-editor`.trim();
    el.innerHTML = `
      <label>
        <span class="field-label">업무 주제 topics</span>
        <textarea id="gardenTopics" rows="6" placeholder="인력관리: 엔지니어링 협회 등록에 필요한 인력 정보를 정리합니다."></textarea>
      </label>
      <label>
        <span class="field-label">일하는 방식 activities</span>
        <textarea id="gardenActivities" rows="6" placeholder="자동수집·모니터링: 새 자료와 변경을 자동 감지합니다."></textarea>
      </label>`;
    ctx.refs.gardenTopics = el.querySelector("#gardenTopics");
    ctx.refs.gardenActivities = el.querySelector("#gardenActivities");
  }

  function configPreview(ctx, _node, el) {
    const pre = document.createElement("pre");
    pre.id = "gardenConfigPreview";
    pre.className = "script-preview";
    pre.textContent = "repo를 선택하면 garden.config.yaml 미리보기가 표시됩니다.";
    el.appendChild(pre);
    ctx.refs.gardenConfigPreview = pre;
  }

  function leaveGarden() {
    location.replace("/");
  }

  window.sduiPages = window.sduiPages || {};
  window.sduiPages.garden = {
    state: () => state,
    actions: {
      NEW_GARDEN_FORM: newGardenForm,
      LOAD_GARDENS: loadGardens,
      PREVIEW_GARDEN_CONFIG: refreshPreview,
      SAVE_GARDEN_CONFIG: saveGarden,
      RUN_GARDEN_BUILD: runBuild,
      REFRESH_GARDEN_STATUS: loadBuilds,
    },
    widgets: {
      taxonomy_editor: taxonomyEditor,
      config_preview: configPreview,
      garden_source_picker: gardenSourcePicker,
      garden_direct_content: gardenDirectContent,
      garden_organization_linker: gardenOrganizationLinker,
      garden_logo_picker: gardenLogoPicker,
      garden_publish_sections: gardenPublishSections,
      garden_list: renderGardenList,
      garden_builds: renderBuilds,
    },
    async init(ctx) {
      try {
        const me = await api("/api/me");
        state.me = me;
        if (!me.loggedIn) return;

        ref(ctx, "member").hidden = false;
        const developer = me.provider === "github" && me.github_enabled;
        setGardenButtonTooltips(ctx);
        await loadOrganizations(ctx);
        setYamlPreviewVisibility(ctx, me.provider === "github");
        setProviderFieldVisibility(ctx, "garden.form.repoLabel", "gardenRepo", developer);
        setProviderFieldVisibility(ctx, "garden.form.labelLabel", "gardenPublishLabel", developer);
        setProviderFieldVisibility(ctx, "garden.form.pathLabel", "gardenIssuesDir", developer);
        if (ref(ctx, "gardenDeployTarget")) {
          ref(ctx, "gardenDeployTarget").value = "cloudflare_pages";
          const field = ref(ctx, "gardenDeployTarget").closest("label");
          if (field) field.hidden = true;
        }
        ref(ctx, "gardenRepo").addEventListener("change", () => {
          if (!ref(ctx, "gardenTitle").value.trim()) ref(ctx, "gardenTitle").value = fallbackTitle(ref(ctx, "gardenRepo").value);
          renderLogoPreview(ctx, state.logoUrl);
          refreshPreview(ctx);
        });
        ref(ctx, "gardenTitle").addEventListener("input", () => renderLogoPreview(ctx, state.logoUrl));
        ["gardenTitle", "gardenPublishLabel", "gardenIssuesDir", "gardenDeployTarget", "gardenTopics", "gardenActivities"]
          .forEach((id) => ref(ctx, id)?.addEventListener("input", () => refreshPreview(ctx)));
        ref(ctx, "gardenList").addEventListener("click", (event) => {
          const target = event.target instanceof Element ? event.target : null;
          const action = target?.closest("[data-garden-list-action]")?.dataset.gardenListAction;
          if (action === "start-delete") {
            state.deleteMode = true;
            state.deleteIds.clear();
            renderGardenList(ctx);
            return;
          }
          if (action === "cancel-delete") {
            state.deleteMode = false;
            state.deleteIds.clear();
            renderGardenList(ctx);
            return;
          }
          if (action === "delete-selected") {
            void deleteSelectedGardens(ctx);
            return;
          }
          const checkbox = target?.closest("[data-garden-delete-id]");
          if (checkbox) {
            if (checkbox.checked) state.deleteIds.add(checkbox.dataset.gardenDeleteId);
            else state.deleteIds.delete(checkbox.dataset.gardenDeleteId);
            return;
          }
          const edit = target?.closest("[data-garden-edit-id]");
          if (edit) {
            void selectGarden(ctx, edit.dataset.gardenEditId).then(() => ref(ctx, "gardenRepo")?.scrollIntoView({ behavior: "smooth", block: "start" }));
            return;
          }
          const button = target?.closest("[data-garden-id]");
          if (button) void selectGarden(ctx, button.dataset.gardenId);
        });
        ref(ctx, "gardenBuilds").addEventListener("click", (event) => {
          const forceBuild = event.target instanceof Element ? event.target.closest("[data-garden-force-build]") : null;
          if (forceBuild) { void runBuild(ctx, true); return; }
          const target = event.target instanceof Element ? event.target.closest("[data-garden-build-delete]") : null;
          const buildId = target?.dataset.gardenBuildDelete;
          if (!buildId || !state.selectedGardenId) return;
          if (!window.confirm("이 빌드 요청과 저장된 빌드 파일을 삭제할까요?")) return;
          void api(`/api/gardens/${encodeURIComponent(state.selectedGardenId)}/builds/${encodeURIComponent(buildId)}`, { method: "DELETE" })
            .then(async () => { await loadGardens(ctx); await loadBuilds(ctx); setStatus(ctx, "빌드 요청을 삭제했습니다."); })
            .catch((err) => setStatus(ctx, err instanceof Error ? err.message : "빌드 요청 삭제에 실패했습니다.", true));
        });
        document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshSourceOptionsSoon(ctx); });
        window.addEventListener("pageshow", (event) => { if (event.persisted) refreshSourceOptionsSoon(ctx); });

        if (developer) await loadRepos(ctx);
        await loadSourceOptions(ctx);
        await loadGardens(ctx);
        if (state.gardens[0]) await selectGarden(ctx, state.gardens[0].id);
        else newGardenForm(ctx);
        window.setInterval(() => { if (state.selectedGardenId) void loadBuilds(ctx); }, 10000);
      } catch (err) {
        ref(ctx, "member").hidden = false;
        setStatus(ctx, err instanceof Error ? err.message : "Garden 화면을 준비하지 못했습니다.", true);
      }
    },
  };
})();
