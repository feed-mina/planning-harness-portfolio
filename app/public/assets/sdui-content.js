(() => {
  "use strict";

  const state = {
    posts: [],
    selectedPostId: "",
    sleepHours: new Set(),
    sourceRefs: [],
    sourceOptions: [],
    topicOptions: [],
    page: 1,
    pageSize: 8,
    total: 0,
    listNotice: "",
    listNoticeDanger: false,
  };
  let detailReturnFocus = null;

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

  function status(ctx, text, danger = false) {
    const el = ref(ctx, "postStatus");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("danger", danger);
  }

  function applyA11yLabels(ctx) {
    const labels = {
      postBody: "본문",
      postAssets: "첨부 파일",
    };
    Object.entries(labels).forEach(([id, label]) => {
      const el = ref(ctx, id);
      if (el && !el.getAttribute("aria-label")) el.setAttribute("aria-label", label);
    });
  }

  function tagText(tags) {
    return (Array.isArray(tags) ? tags : []).join(", ");
  }

  function parseTags(value) {
    return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
  }

  function visibilityLabel(value) {
    if (value === "public") return "공개";
    if (value === "team") return "팀 공개";
    return "비공개";
  }

  function emotionLabel(value) {
    return ({ happy: "기쁨", calm: "평온", tired: "피곤", sad: "슬픔", angry: "화남" })[value] || "기록 없음";
  }

  function formatContentDate(value) {
    const date = new Date(value || "");
    return Number.isFinite(date.getTime()) ? date.toLocaleString("ko-KR") : "기록 없음";
  }

  function setListNotice(text, danger = false) {
    state.listNotice = text || "";
    state.listNoticeDanger = !!danger;
  }

  function values(ctx) {
    const read = (id) => ref(ctx, id)?.value || "";
    return {
      project_id: read("postProject") || null,
      topic_id: read("postTopic") || null,
      source_refs: state.sourceRefs,
      sleep_hours: Array.from(state.sleepHours).sort((a, b) => a - b),
      daily_slots: {
        morning: read("dailyMorning"),
        lunch: read("dailyLunch"),
        evening: read("dailyEvening"),
      },
      emotion: read("postEmotion") || null,
    };
  }

  function setValue(ctx, id, value) {
    const el = ref(ctx, id);
    if (el) el.value = value || "";
  }

  function renderSourceChips(ctx) {
    const host = ref(ctx, "sourceChips");
    if (!host) return;
    host.innerHTML = state.sourceRefs.map((source) => `
      <span class="source-chip"><b>${esc(source.source_type === "meeting" ? "회의록" : "분석·설계")}</b>
      ${esc(source.source_title)}<select data-source-mode="${esc(source.source_id)}" aria-label="${esc(source.source_title)} 가져오기 방식"><option value="reference" ${source.import_mode === "reference" ? "selected" : ""}>출처</option><option value="summary" ${source.import_mode === "summary" ? "selected" : ""}>요약</option><option value="quote" ${source.import_mode === "quote" ? "selected" : ""}>인용</option></select><button type="button" data-source-remove="${esc(source.source_id)}" aria-label="${esc(source.source_title)} 제거">×</button></span>`).join("");
  }

  function textFromAnalysis(data, mode) {
    const outputs = data.outputs || {};
    const preferred = outputs.summaries?.content || outputs.plans?.content || outputs.ideas?.content || {};
    if (typeof preferred === "string") return preferred;
    if (mode === "quote" && data.session?.meeting_markdown) return data.session.meeting_markdown;
    return JSON.stringify(preferred, null, 2).replace(/^\{\s*\}|^\[\s*\]$/s, "");
  }

  async function importSelectedSources(ctx) {
    if (!state.sourceRefs.length) return status(ctx, "가져올 분석·설계 또는 회의록을 선택하세요.", true);
    status(ctx, "자료를 가져오는 중...");
    try {
      const sections = [];
      for (const source of state.sourceRefs) {
        if (source.import_mode === "reference") {
          sections.push(`\n\n[출처: ${source.source_title}]`);
          continue;
        }
        const data = source.source_type === "meeting"
          ? await api(`/api/meetings/${encodeURIComponent(source.source_id)}`)
          : await api(`/api/analysis/sessions/${encodeURIComponent(source.source_id)}`);
        const raw = source.source_type === "meeting" ? (data.markdown || "") : textFromAnalysis(data, source.import_mode);
        const content = String(raw || "").trim();
        sections.push(`\n\n## ${source.source_title}\n${source.import_mode === "quote" ? `> ${content.replace(/\n/g, "\n> ")}` : content}\n\n[출처 연결]`);
      }
      const body = ref(ctx, "postBody");
      body.value = `${body.value.trim()}${sections.join("")}`.trim();
      status(ctx, `${state.sourceRefs.length}개 자료를 본문에 반영했습니다.`);
    } catch (err) {
      status(ctx, err instanceof Error ? err.message : "자료 가져오기에 실패했습니다.", true);
    }
  }

  function renderSleepHours(ctx) {
    const track = ref(ctx, "sleepHourTrack");
    if (!track) return;
    track.querySelectorAll("[data-sleep-hour]").forEach((button) => {
      const active = state.sleepHours.has(Number(button.dataset.sleepHour));
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateCarouselButtons(ctx) {
    const track = ref(ctx, "sleepHourTrack");
    if (!track) return;
    const prev = ref(ctx, "sleepPrev");
    const next = ref(ctx, "sleepNext");
    if (prev) prev.disabled = track.scrollLeft <= 2;
    if (next) next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
  }

  function scrollSleep(ctx, direction) {
    const track = ref(ctx, "sleepHourTrack");
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(240, track.clientWidth * 0.75), behavior: "smooth" });
  }

  async function loadContextOptions(ctx) {
    const [analysis, meetings] = await Promise.all([
      api("/api/analysis/sessions?limit=200").catch(() => ({ sessions: [] })),
      api("/api/meetings?limit=200").catch(() => ({ meetings: [] })),
    ]);
    const sessions = analysis.sessions || [];
    const meetingRows = meetings.meetings || [];
    state.sourceOptions = [
      ...sessions.map((item) => ({ source_type: "analysis", source_id: item.id, source_title: item.title || item.subject || "분석·설계", date: item.date || item.updated_at || "" })),
      ...meetingRows.map((item) => ({ source_type: "meeting", source_id: item.id, source_title: item.title || "회의록", date: item.date || item.created_at || "" })),
    ];
    const project = ref(ctx, "postProject");
    if (project) {
      const subjects = Array.from(new Set(sessions.map((item) => item.subject).filter(Boolean)));
      project.innerHTML = `<option value="">프로젝트 없음</option>${subjects.map((subject) => `<option value="${esc(subject)}">${esc(subject)}</option>`).join("")}`;
    }
    state.topicOptions = sessions;
    updateTopicOptions(ctx);
    const picker = ref(ctx, "sourcePicker");
    if (picker) {
      picker.innerHTML = `<option value="">분석·설계 또는 회의록 선택</option>${state.sourceOptions.map((item) => `<option value="${esc(item.source_id)}">[${item.source_type === "meeting" ? "회의록" : "분석·설계"}] ${esc(item.source_title)}</option>`).join("")}`;
    }
  }

  function updateTopicOptions(ctx, selected = "") {
    const topic = ref(ctx, "postTopic");
    if (!topic) return;
    const project = ref(ctx, "postProject")?.value || "";
    const options = (state.topicOptions || []).filter((item) => !project || item.subject === project);
    topic.innerHTML = `<option value="">주제 없음</option>${options.map((item) => `<option value="${esc(item.id)}">${esc(item.title || item.subject || "주제")}</option>`).join("")}`;
    if (selected && options.some((item) => item.id === selected)) topic.value = selected;
  }

  const widgets = {
    content_context(ctx, node, host) {
      host.innerHTML = `<div class="content-section-title">작성 컨텍스트</div><div class="content-context-grid">
        <label><span>프로젝트</span><select id="postProject"><option value="">프로젝트 없음</option></select></label>
        <label><span>주제</span><select id="postTopic" disabled><option value="">프로젝트를 먼저 선택하세요</option></select></label>
        <label class="source-picker-field"><span>분석·설계·회의록</span><select id="sourcePicker"><option value="">자료 선택</option></select></label>
      </div><div id="sourceChips" class="source-chips" aria-live="polite"></div><button id="importSources" class="btn btn-ghost btn-small source-import-btn" type="button">선택 자료 본문에 가져오기</button>`;
      ["postProject", "postTopic", "sourcePicker", "sourceChips", "importSources"].forEach((id) => { ctx.refs[id] = host.querySelector(`#${id}`); });
      ref(ctx, "postProject").addEventListener("change", () => {
        ref(ctx, "postTopic").disabled = !ref(ctx, "postProject").value;
        updateTopicOptions(ctx);
      });
      ref(ctx, "sourcePicker").addEventListener("change", (event) => {
        const found = state.sourceOptions.find((item) => item.source_id === event.target.value);
        if (found && !state.sourceRefs.some((item) => item.source_id === found.source_id)) state.sourceRefs.push({ ...found, import_mode: "reference" });
        event.target.value = "";
        renderSourceChips(ctx);
      });
      ref(ctx, "sourceChips").addEventListener("click", (event) => {
        const button = event.target.closest("[data-source-remove]");
        if (!button) return;
        state.sourceRefs = state.sourceRefs.filter((item) => item.source_id !== button.dataset.sourceRemove);
        renderSourceChips(ctx);
      });
      ref(ctx, "sourceChips").addEventListener("change", (event) => {
        const select = event.target.closest("[data-source-mode]");
        if (!select) return;
        const source = state.sourceRefs.find((item) => item.source_id === select.dataset.sourceMode);
        if (source) source.import_mode = select.value;
      });
      ref(ctx, "importSources").addEventListener("click", () => void importSelectedSources(ctx));
    },
    content_tags(ctx, node, host) {
      host.innerHTML = `<div class="field-label">하루태그</div><div class="content-tag-grid">${[1,2,3].map((n) => `<label><span>태그 ${n}</span><input id="postTag${n}" type="text" maxlength="32" placeholder="태그 ${n}을 입력하세요"></label>`).join("")}</div>`;
      [1,2,3].forEach((n) => { ctx.refs[`postTag${n}`] = host.querySelector(`#postTag${n}`); });
    },
    content_assets(ctx, node, host) {
      host.innerHTML = `<label class="content-file-drop"><span class="field-label">첨부파일</span><strong>파일을 끌어놓거나 선택하세요</strong><small>파일당 최대 12MB, 한 번에 8개</small><span class="btn btn-ghost file-select-button">파일 선택</span><input id="postAssets" type="file" multiple></label><div id="pendingFiles" class="pending-files" aria-live="polite"></div>`;
      ctx.refs.postAssets = host.querySelector("#postAssets");
      ctx.refs.pendingFiles = host.querySelector("#pendingFiles");
      ctx.refs.postAssets.addEventListener("change", () => {
        ctx.refs.pendingFiles.textContent = Array.from(ctx.refs.postAssets.files || []).map((file) => file.name).join(" · ");
      });
    },
    sleep_hour_carousel(ctx, node, host) {
      host.innerHTML = `<div class="sleep-carousel-head"><span>수면 시간 기록</span><small>시간을 눌러 수면 상태를 선택하세요</small></div><div class="sleep-carousel-shell">
        <button id="sleepPrev" class="sleep-nav" type="button" aria-label="이전 시간">‹</button>
        <div id="sleepHourTrack" class="sleep-hour-track" role="region" aria-label="수면 시간 선택" tabindex="0">${Array.from({length:24}, (_, hour) => `<button type="button" class="sleep-hour" data-sleep-hour="${hour}" aria-pressed="false" aria-label="${hour}시 수면 선택">${hour}</button>`).join("")}</div>
        <button id="sleepNext" class="sleep-nav" type="button" aria-label="다음 시간">›</button></div><div class="sleep-legend"><span><i></i>수면 시간</span><span><i class="awake"></i>활동 시간</span></div>`;
      ["sleepPrev", "sleepNext", "sleepHourTrack"].forEach((id) => { ctx.refs[id] = host.querySelector(`#${id}`); });
      ref(ctx, "sleepPrev").addEventListener("click", () => scrollSleep(ctx, -1));
      ref(ctx, "sleepNext").addEventListener("click", () => scrollSleep(ctx, 1));
      ref(ctx, "sleepHourTrack").addEventListener("click", (event) => {
        const button = event.target.closest("[data-sleep-hour]");
        if (!button) return;
        const hour = Number(button.dataset.sleepHour);
        state.sleepHours.has(hour) ? state.sleepHours.delete(hour) : state.sleepHours.add(hour);
        renderSleepHours(ctx);
      });
      ref(ctx, "sleepHourTrack").addEventListener("scroll", () => updateCarouselButtons(ctx), { passive: true });
      requestAnimationFrame(() => updateCarouselButtons(ctx));
    },
    daily_slots(ctx, node, host) {
      host.innerHTML = `<div class="daily-slot-grid">${[["dailyMorning","아침"],["dailyLunch","점심"],["dailyEvening","저녁"]].map(([id,label]) => `<label><span>${label}</span><input id="${id}" type="text" maxlength="500" placeholder="${label} 기록"></label>`).join("")}</div>`;
      ["dailyMorning","dailyLunch","dailyEvening"].forEach((id) => { ctx.refs[id] = host.querySelector(`#${id}`); });
    },
    content_emotion(ctx, node, host) {
      host.innerHTML = `<label><span>감정</span><select id="postEmotion"><option value="">감정을 선택하세요</option><option value="happy">기쁨</option><option value="calm">평온</option><option value="tired">피곤</option><option value="sad">슬픔</option><option value="angry">화남</option></select></label>`;
      ctx.refs.postEmotion = host.querySelector("#postEmotion");
    },
  };

  function renderPosts(ctx) {
    const list = ref(ctx, "postList");
    if (!list) return;
    const notice = state.listNotice
      ? `<p id="contentListNotice" class="content-list-notice${state.listNoticeDanger ? " danger" : ""}" role="status">${esc(state.listNotice)}</p>`
      : `<p id="contentListNotice" class="content-list-guide">제목 또는 <strong>상세보기</strong>를 누르면 본문과 첨부파일을 확인할 수 있습니다.</p>`;
    if (!state.posts.length) {
      list.innerHTML = notice + `<div class="content-empty"><strong>아직 저장된 콘텐츠가 없습니다.</strong><span>새 콘텐츠를 작성하면 여기에 표시됩니다.</span></div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    list.innerHTML = notice + state.posts.map((post) => `
      <article class="post-list-item ${post.id === state.selectedPostId ? "active" : ""}">
        <button class="post-list-main" type="button" data-post-detail="${esc(post.id)}" aria-label="${esc(post.title)} 상세 보기">
          <strong>${esc(post.title)}</strong>
          <span>${esc(visibilityLabel(post.visibility))} · 첨부 ${Number(post.asset_count) || 0}개 · ${esc((post.updated_at || "").slice(0, 10))}</span>
        </button>
        <div class="post-list-actions">
          <button class="btn btn-ghost btn-small" type="button" data-post-detail="${esc(post.id)}">상세보기</button>
          <button class="btn btn-ghost btn-small" type="button" data-post-edit="${esc(post.id)}">편집</button>
          <button class="btn btn-danger btn-small" type="button" data-post-delete="${esc(post.id)}">삭제</button>
        </div>
      </article>`).join("") + `
      <nav class="content-pagination" aria-label="콘텐츠 목록 페이지">
        <button class="btn btn-ghost btn-small" type="button" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>이전</button>
        <span><strong>${state.page}</strong> / ${pages} 페이지 · 총 ${state.total}개</span>
        <button class="btn btn-ghost btn-small" type="button" data-page="${state.page + 1}" ${state.page >= pages ? "disabled" : ""}>다음</button>
      </nav>`;
    bindPostListActions(ctx, list);
  }

  function bindPostListActions(ctx, list) {
    list.querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        state.page = Number(button.dataset.page) || 1;
        void loadPosts(ctx);
      });
    });
    list.querySelectorAll("[data-post-detail]").forEach((button) => {
      button.addEventListener("click", () => void openPostDetail(ctx, button.dataset.postDetail));
    });
    list.querySelectorAll("[data-post-edit]").forEach((button) => {
      button.addEventListener("click", () => void editPost(ctx, button.dataset.postEdit));
    });
    list.querySelectorAll("[data-post-delete]").forEach((button) => {
      button.addEventListener("click", () => void confirmPostDelete(ctx, button.dataset.postDelete));
    });
  }
  function renderAssets(ctx, assets) {
    const panel = ref(ctx, "assetPanel");
    const list = ref(ctx, "assetList");
    if (!panel || !list) return;
    panel.hidden = false;
    if (!assets.length) {
      list.innerHTML = `<p class="hint">첨부 파일이 없습니다.</p>`;
      return;
    }
    list.innerHTML = assets.map((asset) => `
      <div class="asset-row">
        <a href="/api/content/posts/${encodeURIComponent(asset.post_id)}/assets/${encodeURIComponent(asset.id)}">${esc(asset.name)}</a>
        <span>${Math.max(1, Math.round((Number(asset.size) || 0) / 1024)).toLocaleString("ko-KR")} KB</span>
        <button class="btn btn-ghost btn-small" type="button" data-asset-delete="${esc(asset.id)}">삭제</button>
      </div>`).join("");
  }

  function resetForm(ctx) {
    state.selectedPostId = "";
    ref(ctx, "formTitle").textContent = "새 콘텐츠";
    ref(ctx, "postTitle").value = "";
    ref(ctx, "postVisibility").value = "private";
    [1,2,3].forEach((n) => setValue(ctx, `postTag${n}`, ""));
    ref(ctx, "postBody").value = "";
    ref(ctx, "postAssets").value = "";
    state.sleepHours = new Set();
    state.sourceRefs = [];
    ["postProject","postTopic","dailyMorning","dailyLunch","dailyEvening","postEmotion"].forEach((id) => setValue(ctx, id, ""));
    if (ref(ctx, "postTopic")) {
      ref(ctx, "postTopic").disabled = true;
      updateTopicOptions(ctx);
    }
    renderSleepHours(ctx);
    renderSourceChips(ctx);
    ref(ctx, "btnDeletePost").disabled = true;
    ref(ctx, "assetPanel").hidden = true;
    ref(ctx, "assetList").innerHTML = "";
    status(ctx, "");
    renderPosts(ctx);
  }

  function newPost(ctx) {
    setListNotice("");
    resetForm(ctx);
    ref(ctx, "formTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
    ref(ctx, "postTitle")?.focus({ preventScroll: true });
  }

  async function loadPosts(ctx) {
    const offset = (state.page - 1) * state.pageSize;
    const data = await api(`/api/content/posts?limit=${state.pageSize}&offset=${offset}`);
    state.posts = data.posts || [];
    state.total = Number(data.pagination?.total) || 0;
    if (!state.posts.length && state.page > 1) { state.page -= 1; return loadPosts(ctx); }
    renderPosts(ctx);
    if (state.selectedPostId && !state.posts.some((post) => post.id === state.selectedPostId)) resetForm(ctx);
  }

  async function selectPost(ctx, id) {
    status(ctx, "불러오는 중...");
    try {
      const data = await api(`/api/content/posts/${encodeURIComponent(id)}`);
      const post = data.post || {};
      state.selectedPostId = post.id;
      ref(ctx, "formTitle").textContent = "콘텐츠 수정";
      ref(ctx, "postTitle").value = post.title || "";
      ref(ctx, "postVisibility").value = post.visibility || "private";
      (post.tags || []).slice(0, 3).forEach((tag, index) => setValue(ctx, `postTag${index + 1}`, tag));
      [1,2,3].slice((post.tags || []).length).forEach((n) => setValue(ctx, `postTag${n}`, ""));
      ref(ctx, "postBody").value = post.body || "";
      ref(ctx, "postAssets").value = "";
      setValue(ctx, "postProject", post.project_id);
      ref(ctx, "postTopic").disabled = !post.project_id;
      updateTopicOptions(ctx, post.topic_id || "");
      setValue(ctx, "dailyMorning", post.daily_slots?.morning);
      setValue(ctx, "dailyLunch", post.daily_slots?.lunch);
      setValue(ctx, "dailyEvening", post.daily_slots?.evening);
      setValue(ctx, "postEmotion", post.emotion);
      state.sleepHours = new Set(post.sleep_hours || []);
      state.sourceRefs = post.source_refs || [];
      renderSleepHours(ctx);
      renderSourceChips(ctx);
      ref(ctx, "btnDeletePost").disabled = false;
      renderAssets(ctx, data.assets || []);
      renderPosts(ctx);
      status(ctx, "");
      return true;
    } catch (err) {
      status(ctx, err instanceof Error ? err.message : "불러오기 실패", true);
      return false;
    }
  }

  async function editPost(ctx, id) {
    const loaded = await selectPost(ctx, id);
    if (!loaded) return;
    status(ctx, "편집할 콘텐츠를 불러왔습니다. 내용을 수정한 뒤 저장을 누르세요.");
    ref(ctx, "formTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
    ref(ctx, "postTitle")?.focus({ preventScroll: true });
  }

  function closePostDetail(restoreFocus = true) {
    document.getElementById("contentDetailModal")?.remove();
    document.getElementById("contentDetailBackdrop")?.remove();
    const target = detailReturnFocus;
    detailReturnFocus = null;
    if (restoreFocus && target?.isConnected) target.focus({ preventScroll: true });
  }

  function showPostDetail(ctx, data) {
    closePostDetail(false);
    detailReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const post = data.post || {};
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const tags = Array.isArray(post.tags) ? post.tags : [];
    const sources = Array.isArray(post.source_refs) ? post.source_refs : [];
    const sleepHours = Array.isArray(post.sleep_hours) ? post.sleep_hours : [];
    const dailySlots = post.daily_slots && typeof post.daily_slots === "object" ? post.daily_slots : {};
    const topic = state.topicOptions.find((item) => item.id === post.topic_id);
    const topicLabel = topic?.title || topic?.subject || (post.topic_id ? "연결된 주제" : "없음");
    const dailyItems = [["아침", dailySlots.morning], ["점심", dailySlots.lunch], ["저녁", dailySlots.evening]].filter(([, value]) => value);
    const metaItems = [
      ["공개 범위", visibilityLabel(post.visibility)],
      ["프로젝트", post.project_id || "없음"],
      ["주제", topicLabel],
      ["감정", emotionLabel(post.emotion)],
      ["생성", formatContentDate(post.created_at)],
      ["수정", formatContentDate(post.updated_at)],
    ];
    const backdrop = document.createElement("div");
    backdrop.id = "contentDetailBackdrop";
    backdrop.className = "content-detail-backdrop";
    const modal = document.createElement("section");
    modal.id = "contentDetailModal";
    modal.className = "content-detail-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "contentDetailTitle");
    modal.innerHTML = `
      <div class="content-detail-head">
        <div><span class="hint">${esc(visibilityLabel(post.visibility))} · ${esc((post.updated_at || "").slice(0, 10))}</span><h2 id="contentDetailTitle">${esc(post.title || "콘텐츠")}</h2></div>
        <button class="btn btn-ghost btn-small" type="button" data-detail-close>닫기</button>
      </div>
      <dl class="content-detail-meta">${metaItems.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>
      <section class="content-detail-section"><h3>본문</h3><div class="content-detail-body">${esc(post.body || "본문이 없습니다.")}</div></section>
      ${tags.length ? `<div class="tag-row">${tags.map((tag) => `<span class="tag-chip">${esc(tag)}</span>`).join("")}</div>` : ""}
      ${dailyItems.length ? `<section class="content-detail-section"><h3>하루 기록</h3><div class="content-detail-daily">${dailyItems.map(([label, value]) => `<div><strong>${label}</strong><span>${esc(value)}</span></div>`).join("")}</div></section>` : ""}
      <section class="content-detail-section"><h3>수면 시간</h3><p>${sleepHours.length ? sleepHours.map((hour) => `${esc(hour)}시`).join(" · ") : "기록 없음"}</p></section>
      ${sources.length ? `<section class="content-detail-section"><h3>연결 자료</h3><div class="content-detail-sources">${sources.map((source) => `<span><strong>${esc(source.source_type === "meeting" ? "회의록" : "분석·설계")}</strong>${esc(source.source_title || "제목 없음")}</span>`).join("")}</div></section>` : ""}
      <div class="content-detail-assets"><strong>첨부파일</strong>${assets.length ? assets.map((asset) => `<a href="/api/content/posts/${encodeURIComponent(asset.post_id)}/assets/${encodeURIComponent(asset.id)}">${esc(asset.name)}</a>`).join("") : `<span class="hint">첨부파일 없음</span>`}</div>
      <div class="result-actions content-detail-actions">
        <button class="btn btn-primary" type="button" data-detail-edit="${esc(post.id)}">편집</button>
        <button class="btn btn-danger" type="button" data-detail-delete="${esc(post.id)}">삭제</button>
        <button class="btn btn-ghost" type="button" data-detail-close>닫기</button>
      </div>`;
    document.body.append(backdrop, modal);
    backdrop.addEventListener("click", closePostDetail);
    modal.querySelectorAll("[data-detail-close]").forEach((button) => button.addEventListener("click", closePostDetail));
    modal.querySelector("[data-detail-edit]")?.addEventListener("click", () => {
      closePostDetail(false);
      void editPost(ctx, post.id);
    });
    modal.querySelector("[data-detail-delete]")?.addEventListener("click", () => {
      void confirmPostDelete(ctx, post.id).then((deleted) => { if (deleted) closePostDetail(false); });
    });
    modal.querySelector("[data-detail-close]")?.focus();
  }

  async function openPostDetail(ctx, id) {
    status(ctx, "상세 내용을 불러오는 중...");
    try {
      const data = await api(`/api/content/posts/${encodeURIComponent(id)}`);
      showPostDetail(ctx, data);
      status(ctx, "");
    } catch (err) {
      status(ctx, err instanceof Error ? err.message : "상세 보기 실패", true);
    }
  }

  async function uploadAssets(ctx, postId) {
    const input = ref(ctx, "postAssets");
    if (!input?.files || !input.files.length) return;
    const form = new FormData();
    Array.from(input.files).forEach((file) => form.append("assets", file));
    await window.apiFetch(`/api/content/posts/${encodeURIComponent(postId)}/assets`, { method: "POST", body: form }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "첨부 업로드에 실패했습니다.");
      return data;
    });
  }

  async function savePost(ctx) {
    status(ctx, "저장 중...");
    try {
      const payload = {
        title: ref(ctx, "postTitle").value,
        visibility: ref(ctx, "postVisibility").value,
        tags: [1,2,3].map((n) => ref(ctx, `postTag${n}`).value.trim()).filter(Boolean),
        body: ref(ctx, "postBody").value,
        ...values(ctx),
      };
      const path = state.selectedPostId ? `/api/content/posts/${encodeURIComponent(state.selectedPostId)}` : "/api/content/posts";
      const data = await api(path, {
        method: state.selectedPostId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const postId = data.post?.id || state.selectedPostId;
      await uploadAssets(ctx, postId);
      state.selectedPostId = postId;
      setListNotice(`“${payload.title.trim()}” 콘텐츠를 저장했습니다.`);
      status(ctx, "저장했습니다.");
      await loadPosts(ctx);
      await selectPost(ctx, postId);
    } catch (err) {
      status(ctx, err instanceof Error ? err.message : "저장 실패", true);
    }
  }

  function postTitleById(ctx, postId) {
    const listed = state.posts.find((post) => post.id === postId);
    if (listed?.title) return listed.title;
    if (postId === state.selectedPostId) return ref(ctx, "postTitle")?.value.trim() || "이 콘텐츠";
    return "이 콘텐츠";
  }

  async function deletePost(ctx, postId = state.selectedPostId) {
    if (!postId) return false;
    const title = postTitleById(ctx, postId);
    const deletingSelectedPost = state.selectedPostId === postId;
    status(ctx, "삭제 중...");
    try {
      await api(`/api/content/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
      if (deletingSelectedPost) resetForm(ctx);
      setListNotice(`“${title}” 콘텐츠를 삭제했습니다.`);
      await loadPosts(ctx);
      status(ctx, "");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "삭제 실패";
      setListNotice(message, true);
      renderPosts(ctx);
      status(ctx, message, true);
      return false;
    }
  }

  function confirmPostDelete(ctx, postId = state.selectedPostId) {
    if (!postId) return Promise.resolve(false);
    const title = postTitleById(ctx, postId);
    const confirmed = window.confirm(`“${title}” 콘텐츠를 삭제할까요?\n삭제하면 목록에서 사라지며 현재 화면에서는 되돌릴 수 없습니다.`);
    return confirmed ? deletePost(ctx, postId) : Promise.resolve(false);
  }

  function confirmSelectedPostDelete(ctx) {
    return confirmPostDelete(ctx, state.selectedPostId);
  }

  async function deleteAsset(ctx, assetId) {
    if (!state.selectedPostId) return;
    status(ctx, "첨부 삭제 중...");
    try {
      await api(`/api/content/posts/${encodeURIComponent(state.selectedPostId)}/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
      await selectPost(ctx, state.selectedPostId);
      await loadPosts(ctx);
      status(ctx, "첨부를 삭제했습니다.");
    } catch (err) {
      status(ctx, err instanceof Error ? err.message : "첨부 삭제 실패", true);
    }
  }

  window.sduiPages = window.sduiPages || {};
  window.sduiPages.content = {
    state: () => state,
    actions: {
      NEW_CONTENT_POST: newPost,
      LOAD_CONTENT_POSTS: loadPosts,
      SAVE_CONTENT_POST: savePost,
      DELETE_CONTENT_POST: confirmSelectedPostDelete,
    },
    widgets,
    async init(ctx) {
      applyA11yLabels(ctx);
      document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePostDetail(); });
      ref(ctx, "assetList").addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest("[data-asset-delete]");
        if (button) void deleteAsset(ctx, button.dataset.assetDelete);
      });

      try {
        const me = await api("/api/me");
        if (!me.loggedIn) {
          ref(ctx, "guest").hidden = false;
          ref(ctx, "guestLogin").innerHTML = window.oauthLoginButtonsHtml ? window.oauthLoginButtonsHtml() : "";
          return;
        }
        ref(ctx, "member").hidden = false;
        await loadContextOptions(ctx);
        await loadPosts(ctx);
      } catch {
        ref(ctx, "guest").hidden = false;
        ref(ctx, "guestLogin").innerHTML = window.oauthLoginButtonsHtml ? window.oauthLoginButtonsHtml() : "";
      }
    },
  };
})();
