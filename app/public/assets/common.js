// 공통: 네비 렌더 + 로그인 상태 + 오늘 사용량 pill.
(() => {
  const AUTO_MEDIA_PRODUCTION_URL = "https://auto-media.kibayerin.workers.dev/";
  const page = document.body.dataset.page || "";
  const variant = document.body.dataset.variant || "";
  const tabParam = new URLSearchParams(location.search).get("tab");
  const studioPathMatch = location.pathname.match(/^\/studio\/([^/?#]+)\.html$/);
  const studioPageFromPath = studioPathMatch ? `studio-${studioPathMatch[1]}` : "";
  const activePage = variant || (
    page === "studio" && studioPageFromPath
      ? studioPageFromPath
      : page === "mypage" && tabParam === "stats"
        ? "stats"
        : page === "mypage" && tabParam === "schedule"
          ? "schedule"
          : page === "ai-harness"
            ? (tabParam === "guide" ? "ai-harness-guide" : "ai-harness-checklist")
            : page
  );
  const navIcon = (body) =>
    `<svg class="side-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  const icons = {
    dashboard: navIcon('<path d="M3.5 11.5 12 4.5l8.5 7"/><path d="M5.5 10.5V20h5v-5h3v5h5v-9.5"/>'),
    meeting: navIcon('<path d="M6 3.5h8l4 4V20.5H6z"/><path d="M14 3.5v5h4"/><path d="m9 15.5 5.6-5.6 1.8 1.8-5.6 5.6H9z"/>'),
    analysis: navIcon('<circle cx="11" cy="11" r="5.5"/><path d="m15.2 15.2 4.3 4.3"/>'),
    user: navIcon('<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>'),
    stats: navIcon('<path d="M4 19.5h16"/><path d="M6.5 19.5v-8"/><path d="M12 19.5v-13"/><path d="M17.5 19.5v-5"/>'),
    schedule: navIcon('<rect x="4.5" y="5.5" width="15" height="14" rx="2"/><path d="M8 3.5v4"/><path d="M16 3.5v4"/><path d="M4.5 10h15"/>'),
    setup: navIcon('<path d="M14.7 6.3a4 4 0 0 0-5 5L4.5 16.5l3 3 5.2-5.2a4 4 0 0 0 5-5l-2.3 2.3-3-3z"/>'),
    todo: navIcon('<path d="M5 14V6.5h14V14"/><path d="M4 14h4l2 3h4l2-3h4"/><path d="m9 10.5 2 2 4-4"/>'),
    time: navIcon('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'),
    content: navIcon('<path d="M5.5 4.5h9l4 4v11h-13z"/><path d="M14.5 4.5v5h4"/><path d="M8.5 13h7"/><path d="M8.5 16h5"/>'),
    garden: navIcon('<path d="M12 20V9"/><path d="M8 13c-2.5 0-4-1.7-4-4.5V5h3.5C10.3 5 12 6.7 12 9.5V13z"/><path d="M16 13c2.5 0 4-1.7 4-4.5V5h-3.5C13.7 5 12 6.7 12 9.5V13z"/>'),
    automation: navIcon('<path d="M6 7.5h12"/><path d="M8 4.5h8l1 3H7z"/><rect x="5" y="7.5" width="14" height="12" rx="2"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M9 16.5h6"/>'),
    stock: navIcon('<path d="M4 19h16"/><path d="m4 15 4-4 3 3 5-6"/><path d="M16 8h3v3"/>'),
    harness: navIcon('<rect x="6" y="9" width="12" height="9" rx="2"/><path d="M12 9V5"/><circle cx="12" cy="4" r="1.3"/><path d="M9.5 13h.01M14.5 13h.01"/><path d="M4 12.5h2M18 12.5h2"/>'),
  };
  const tabs = [
    { id: "dashboard", href: "/", label: "대시보드", icon: icons.dashboard },
    // 회의록 만들기는 publicPaths에 등록된 검색 공개 페이지라 로그아웃 상태에서도 노출한다.
    { id: "feature", href: "/feature/", label: "회의록 만들기", icon: icons.meeting },
    { id: "analysis-edit2", href: "/analysis-edit2/", label: "분석설계 - (수정중)", icon: icons.analysis, requiresLogin: true },
    {
      id: "plan-settings",
      href: "/time-settings/",
      label: "계획설정",
      icon: icons.time,
      requiresLogin: true,
      children: [
        { id: "time-settings", href: "/time-settings/", label: "시간 설정", icon: icons.time },
        { id: "content", href: "/content/", label: "하루 기록", icon: icons.content },
      ],
    },
    {
      id: "studio",
      href: "/studio/",
      label: "화면 템플릿 편집기",
      icon: icons.content,
      requiresLogin: true,
      children: [
        { id: "studio", href: "/studio/", label: "템플릿 편집기", icon: icons.content },
        { id: "studio-branding", href: "/studio/branding.html", label: "Studio 브랜드 설정", icon: icons.content },
        { id: "studio-native-build", href: "/studio/native-build.html", label: "Studio Native Build", icon: icons.content },
        { id: "studio-operations", href: "/studio/operations.html", label: "Studio 운영 기록", icon: icons.content },
        { id: "studio-plans", href: "/studio/plans.html", label: "Studio 플랜·사용량", icon: icons.content },
      ],
    },
    {
      id: "automation-list",
      href: "/garden/",
      label: "자동화 목록",
      icon: icons.automation,
      requiresLogin: true,
      children: [
        { id: "garden", href: "/garden/", label: "연구문서 템플릿", icon: icons.garden },
        { id: "nblog-automation", href: "/nblog-automation/", label: "NBlog 자동화", icon: icons.automation },
        { id: "auto-media", readinessEndpoint: "/api/connected-apps/auto-media/readiness", label: "영상 자동화", icon: icons.automation },
      ],
    },
    {
      id: "ai-harness",
      href: "/ai-harness/",
      label: "기획 하네스 루프",
      icon: icons.harness,
      requiresLogin: true,
      children: [
        { id: "ai-harness-checklist", href: "/ai-harness/", label: "업무 실천 체크리스트", icon: icons.todo },
        { id: "ai-harness-guide", href: "/ai-harness/?tab=guide", label: "AI 협업 운영 가이드", icon: icons.content },
      ],
    },
    {
      id: "mypage",
      href: "/mypage/",
      label: "마이페이지",
      icon: icons.user,
      requiresLogin: true,
      children: [
        { id: "stats", href: "/mypage/?tab=stats", label: "통계", icon: icons.stats },
        { id: "schedule", href: "/mypage/?tab=schedule", label: "스케줄", icon: icons.schedule },
      ],
    },
  ];
  const utilityTabs = [
    { id: "dev-setup", href: "/dev-setup/", label: "개발환경 세팅도구", icon: icons.setup, caption: "Issue #37 · 설치 스크립트" },
    { id: "ask-todo-hub", href: "/ask-todo-hub/", label: "에이전트 일일기록", icon: icons.todo, caption: "ASK/Todo 기록 설치" },
    { id: "stock-gui", href: "/stock/", label: "주식 관리 GUI", icon: icons.stock, caption: "dad-stock-bot 설치" },
  ];
  const githubIcon = '<svg class="account-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 .5A11.5 11.5 0 0 0 8.36 22.9c.58.1.79-.25.79-.56v-2.02c-3.22.7-3.9-1.39-3.9-1.39-.53-1.33-1.3-1.69-1.3-1.69-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.78 2.73 1.27 3.4.97.1-.75.41-1.27.74-1.56-2.57-.29-5.28-1.29-5.28-5.73 0-1.27.45-2.3 1.2-3.11-.12-.29-.52-1.47.11-3.07 0 0 .98-.31 3.2 1.19a11.1 11.1 0 0 1 5.82 0c2.22-1.5 3.2-1.19 3.2-1.19.63 1.6.23 2.78.11 3.07.75.81 1.2 1.84 1.2 3.11 0 4.45-2.71 5.43-5.29 5.72.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>';
  const googleIcon = '<span class="account-icon account-letter account-google" aria-hidden="true">G</span>';
  const kakaoIcon = '<span class="account-icon account-letter account-kakao" aria-hidden="true">K</span>';
  const naverIcon = '<span class="account-icon account-letter account-naver" aria-hidden="true">N</span>';
  const emailIcon = '<span class="account-icon account-letter account-email" aria-hidden="true">E</span>';
  const loginProviders = {
    github: { href: "/api/auth/github", label: "GitHub", icon: githubIcon },
    google: { href: "/api/auth/google", label: "Google", icon: googleIcon },
    kakao: { href: "/api/auth/kakao", label: "Kakao", icon: kakaoIcon },
    naver: { href: "/api/auth/naver", label: "Naver", icon: naverIcon },
  };
  const accountProviders = {
    ...loginProviders,
    email: { href: "/mypage/", label: "Email", icon: emailIcon },
  };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
  const providerForAccount = (provider) => accountProviders[String(provider || "").toLowerCase()] || accountProviders.email;
  const themeStorageKey = "planning-harness.theme";
  const systemDarkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const getStoredTheme = () => {
    try { return localStorage.getItem(themeStorageKey) || "auto"; } catch { return "auto"; }
  };
  const setStoredTheme = (value) => {
    try { localStorage.setItem(themeStorageKey, value); } catch {}
  };
  const resolvedTheme = (choice) => (
    choice === "dark" || choice === "light"
      ? choice
      : systemDarkQuery?.matches ? "dark" : "light"
  );
  const applyTheme = (choice = getStoredTheme()) => {
    const theme = resolvedTheme(choice);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeChoice = choice || "auto";
    document.documentElement.style.colorScheme = theme;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.content = theme === "dark" ? "#111827" : "#2f6fed";
    const button = document.getElementById("themeToggle");
    if (!button) return;
    const dark = theme === "dark";
    button.setAttribute("aria-pressed", dark ? "true" : "false");
    button.setAttribute("aria-label", dark ? "라이트 모드로 전환" : "다크 모드로 전환");
    button.title = dark ? "라이트 모드로 전환" : "다크 모드로 전환";
    const icon = button.querySelector(".theme-icon");
    if (icon) icon.textContent = dark ? "☀" : "☾";
  };
  applyTheme();
  if (systemDarkQuery) {
    const syncSystemTheme = () => { if (getStoredTheme() === "auto") applyTheme("auto"); };
    if (systemDarkQuery.addEventListener) systemDarkQuery.addEventListener("change", syncSystemTheme);
    else systemDarkQuery.addListener(syncSystemTheme);
  }
  const setupAccountMenu = () => {
    const menu = document.getElementById("accountMenu");
    const button = document.getElementById("accountMenuButton");
    const list = document.getElementById("accountMenuList");
    if (!menu || !button || !list) return;
    const setOpen = (open) => {
      list.hidden = !open;
      button.setAttribute("aria-expanded", open ? "true" : "false");
    };
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(list.hidden);
    });
    list.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", (event) => {
      if (event.target instanceof Node && !menu.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });
  };
  window.githubLoginButtonHtml = (className = "account-btn account-login", label = "로그인") =>
    `<a class="${className}" href="/api/auth/github">${githubIcon}<span>${label}</span></a>`;
  window.oauthLoginButtonHtml = (provider, className = "account-btn account-login", label) => {
    const item = loginProviders[provider] || loginProviders.github;
    const text = label || item.label;
    return `<a class="${className} account-login-${provider}" href="${item.href}" aria-label="${escapeHtml(text)}" title="${escapeHtml(text)}">${item.icon}<span>${escapeHtml(text)}</span></a>`;
  };
  window.oauthLoginButtonsHtml = (className = "account-btn account-login") =>
    `<span class="account-login-group">` +
    Object.keys(loginProviders).map((provider) => window.oauthLoginButtonHtml(provider, className)).join("") +
    `</span>`;

  const renderTab = (tab, depth = 0) => {
    const content = `<span class="side-ico">${tab.icon}</span><span class="side-label">${tab.label}</span>`;
    const className = `side-tab ${depth ? "side-subtab" : ""} ${tab.id === activePage ? "active" : ""}`;
    if (tab.readinessEndpoint) {
      return `<span class="${className}" data-depth="2" data-tab-id="${tab.id}" data-readiness-endpoint="${tab.readinessEndpoint}" aria-hidden="true" hidden>${content}</span>`;
    }
    return `<a class="${className}" href="${tab.href}" ${depth ? 'data-depth="2"' : ""}${tab.requiresGithub ? ' data-github-only-nav hidden' : ""}${tab.id === activePage ? ' aria-current="page"' : ""}>${content}</a>`;
  };
  const renderNav = () => tabs.map((tab) => {
    const childActive = (tab.children || []).some((child) => child.id === activePage);
    const parentActive = tab.id === activePage || childActive;
    const groupClass = tab.children?.length ? ` side-group ${childActive ? "child-active" : ""}` : "";
    const children = tab.children?.length
      ? `<div class="side-children" hidden>${tab.children.map((child) => renderTab(child, 1)).join("")}</div>`
      : "";
    const parent = tab.children?.length
      ? `<button class="side-tab side-parent ${parentActive ? "active" : ""}" type="button" data-nav-parent="${tab.id}" aria-expanded="false"><span class="side-ico">${tab.icon}</span><span class="side-label">${tab.label}</span><span class="side-parent-chevron" aria-hidden="true">⌄</span></button>`
      : renderTab(tab);
    // 로그인 전용 항목은 기본을 숨김으로 두고 /api/me 확인 후 노출한다.
    // (기본을 노출로 두면 로그아웃 상태에서 잠깐 보였다 사라지는 깜빡임이 생긴다)
    const loginGate = tab.requiresLogin ? ' data-login-only-nav hidden' : "";
    return `<div class="side-item${groupClass}"${loginGate}>${parent}${children}</div>`;
  }).join("");

  // 상단 바(햄버거) + 좌측 off-canvas 사이드바 + backdrop — 전 페이지 공통.
  const bar = document.createElement("header");
  bar.className = "topbar";
  bar.innerHTML =
    `<button class="hamburger" id="navToggle" aria-label="메뉴 열기" aria-expanded="false" aria-controls="sidebar">☰</button>
     <a class="brand" href="/"><img class="brand-logo" src="/assets/loopdev-logo-1024.png" alt="" width="28" height="28" />AI FeedYERIN</a>
     <span class="quick-log-chip-wrap">
       <button type="button" class="quick-log-clock-chip quick-log-clock-chip--header" id="quickLogClockChip" aria-haspopup="dialog" aria-controls="quickLogModal" data-analytics-id="header_open_quick_log">
         <span class="quick-log-clock-body">
           <span class="quick-log-clock-time" id="quickLogClockTime">--:--</span>
           <span class="quick-log-clock-date" id="quickLogClockDate">----.--.--</span>
         </span>
         <span class="quick-log-clock-icon" aria-hidden="true">＋</span>
       </button>
       <span class="quick-log-coachmark" id="quickLogCoachmark" role="note" hidden>
         <span>여기를 눌러 지금을 기록하세요.</span>
         <button type="button" class="quick-log-coachmark-close" id="quickLogCoachmarkClose">알겠어요</button>
       </span>
     </span>
     <span class="spacer"></span>
     <button class="theme-toggle" id="themeToggle" type="button" aria-pressed="false" aria-label="다크 모드로 전환" title="다크 모드로 전환"><span class="theme-icon" aria-hidden="true">☾</span></button>
     <span class="who" id="whoami">…</span>`;

  const side = document.createElement("aside");
  side.className = "sidebar";
  side.id = "sidebar";
  side.setAttribute("aria-label", "주 메뉴");
  side.setAttribute("aria-hidden", "true");
  side.innerHTML =
    `<div class="sidebar-head">
       <a class="brand" href="/"><img class="brand-logo" src="/assets/loopdev-logo-1024.png" alt="" width="28" height="28" />AI FeedYERIN</a>
       <button class="side-close" id="navClose" aria-label="메뉴 닫기">✕</button>
     </div>
     <nav class="side-nav">
       ${renderNav()}
     </nav>
     <div class="side-footer">
       ${utilityTabs.map((tab) => `
       <a class="side-utility ${tab.id === activePage ? "active" : ""}" href="${tab.href}" aria-label="${tab.label}"${tab.id === activePage ? ' aria-current="page"' : ""}>
         <span class="side-utility-ico">${tab.icon}</span>
         <span class="side-utility-copy"><strong>${tab.label}</strong><small>${tab.caption}</small></span>
       </a>`).join("")}
     </div>`;

  const backdrop = document.createElement("div");
  backdrop.className = "nav-backdrop";
  backdrop.id = "navBackdrop";

  document.body.prepend(backdrop);
  document.body.prepend(side);
  document.body.prepend(bar);

  const activateReadinessTabs = async () => {
    const pending = side.querySelector('[data-tab-id="auto-media"]');
    if (!pending) return;
    const endpoint = pending.getAttribute("data-readiness-endpoint");
    if (!endpoint) return;
    try {
      const response = await fetch(endpoint, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json();
      if (
        !response.ok ||
        payload?.ready !== true ||
        payload.href !== AUTO_MEDIA_PRODUCTION_URL
      ) return;
      const link = document.createElement("a");
      link.className = pending.className;
      link.href = payload.href;
      link.dataset.depth = "2";
      link.innerHTML = pending.innerHTML;
      pending.replaceWith(link);
    } catch {
      // Fail closed: a missing/invalid readiness response never exposes the link.
    }
  };
  void activateReadinessTabs();
  // quick-log 모달/백드롭은 공통 셸에서 단일 인스턴스로만 마운트한다.
  // (dashboard fragment 내 기존 동명 ID 노드는 제거되어야 한다.)
  if (!document.getElementById("quickLogModal")) {
    document.body.insertAdjacentHTML("beforeend", `
      <div class="modal-backdrop" id="quickLogModalBackdrop" hidden></div>
      <section class="history-modal quick-log-modal" id="quickLogModal" role="dialog" aria-modal="true" aria-labelledby="quickLogModalTitle" hidden>
        <div class="history-modal-head">
          <div>
            <span class="source-badge" id="quickLogModalClock">--:--:--</span>
            <h2 id="quickLogModalTitle">퀵 기록</h2>
          </div>
          <button class="side-close" id="btnCloseQuickLogModal" type="button" aria-label="퀵 기록 닫기">✕</button>
        </div>
        <div class="history-modal-body quick-log-body">
          <div class="quick-log-summary-row">
            <div class="quick-log-summary" id="quickLogSummary"></div>
            <button type="button" class="btn btn-ghost btn-small quick-log-manage-toggle" id="quickLogManageToggle" aria-pressed="false" hidden>편집</button>
          </div>
          <div class="quick-log-buttons" id="quickLogButtons"><p class="hint">불러오는 중...</p></div>
          <div class="quick-log-record-panel" id="quickLogRecordPanel" hidden></div>
          <div class="quick-log-button-form" id="quickLogButtonForm" hidden></div>
          <div class="quick-log-today">
            <div class="result-head">
              <div class="field-label">오늘 기록</div>
            </div>
            <ul class="quick-log-today-list" id="quickLogTodayList"><li class="hint">기록이 없습니다.</li></ul>
            <a class="quick-log-today-more" id="quickLogTodayMore" href="/time-settings/#quick-log-history" hidden>
              전체 보기 (<span id="quickLogTodayMoreCount">0</span>건 더)
            </a>
          </div>
        </div>
        <div class="quick-log-snackbar" id="quickLogSnackbar" role="status" aria-live="polite" hidden>
          <span class="quick-log-snackbar-text" id="quickLogSnackbarText"></span>
          <button type="button" class="quick-log-snackbar-action" id="quickLogSnackbarAction" hidden>실행 취소</button>
        </div>
        <div class="quick-log-confirm" id="quickLogConfirm" hidden>
          <div class="quick-log-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="quickLogConfirmTitle" aria-describedby="quickLogConfirmDesc">
            <h3 id="quickLogConfirmTitle">삭제할까요?</h3>
            <p id="quickLogConfirmDesc"></p>
            <div class="quick-log-confirm-actions">
              <button type="button" class="btn btn-ghost btn-small" id="quickLogConfirmCancel">취소</button>
              <button type="button" class="btn btn-danger btn-small" id="quickLogConfirmOk">삭제</button>
            </div>
          </div>
        </div>
      </section>`);
  }
  // 헤더 시계 칩 — quick-log.js 가 없는 페이지에서도 현재 시각을 표시한다.
  // quick-log.js 가 로드된 페이지(대시보드·time-settings)에서는 init() 이 이 타이머를
  // 정리하고 자체 interval 로 교체하므로 중복 업데이트가 발생하지 않는다.
  (function startHeaderClock() {
    const pad = (n) => String(n).padStart(2, "0");
    function tickHeaderClock() {
      const now = new Date();
      const t = document.getElementById("quickLogClockTime");
      const d = document.getElementById("quickLogClockDate");
      if (t) t.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      if (d) d.textContent = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
    }
    tickHeaderClock();
    window.__harnessClockTimer = window.setInterval(tickHeaderClock, 1000);
  }());
  window.HarnessAnalytics?.mountPreferencesControl(side.querySelector(".side-footer"));

  const focusableNavSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");
  let lastNavFocus = null;
  let touchStartX = 0;
  let touchStartY = 0;
  const focusableNavItems = () => Array.from(side.querySelectorAll(focusableNavSelector))
    .filter((item) => {
      if (!(item instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(item);
      return style.display !== "none" && style.visibility !== "hidden";
    });
  const setSidebarFocusable = (open) => {
    focusableNavItems().forEach((item) => {
      if (!(item instanceof HTMLElement)) return;
      if (open) {
        const previous = item.dataset.prevTabindex;
        if (previous === "none") item.removeAttribute("tabindex");
        else if (previous != null) item.setAttribute("tabindex", previous);
        delete item.dataset.prevTabindex;
      } else {
        if (!Object.prototype.hasOwnProperty.call(item.dataset, "prevTabindex")) {
          item.dataset.prevTabindex = item.hasAttribute("tabindex") ? item.getAttribute("tabindex") || "" : "none";
        }
        item.setAttribute("tabindex", "-1");
      }
    });
  };
  const setOpen = (open, restoreFocus = true) => {
    if (open) lastNavFocus = document.activeElement;
    side.classList.toggle("open", open);
    backdrop.classList.toggle("open", open);
    side.setAttribute("aria-hidden", open ? "false" : "true");
    setSidebarFocusable(open);
    document.body.classList.toggle("nav-open", open);
    const t = document.getElementById("navToggle");
    if (t) t.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      window.setTimeout(() => {
        const first = document.getElementById("navClose") || focusableNavItems()[0];
        if (first instanceof HTMLElement) first.focus();
      }, 0);
    } else if (restoreFocus && lastNavFocus instanceof HTMLElement) {
      lastNavFocus.focus();
    }
  };
  document.getElementById("navToggle").addEventListener("click", () => setOpen(!side.classList.contains("open")));
  document.getElementById("navClose").addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  side.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const parent = target?.closest("[data-nav-parent]");
    if (parent) {
      const group = parent.closest(".side-item");
      const children = group?.querySelector(".side-children");
      const expanded = parent.getAttribute("aria-expanded") === "true";
      const nextExpanded = !expanded;
      parent.setAttribute("aria-expanded", String(nextExpanded));
      if (children) children.hidden = !nextExpanded;
      return;
    }
    if (target?.closest("a[href]")) setOpen(false, false);
  });
  side.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    touchStartX = touch?.clientX || 0;
    touchStartY = touch?.clientY || 0;
  }, { passive: true });
  side.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    if (!touchStartX || !touch) return;
    const dx = touch.clientX - touchStartX;
    const dy = Math.abs(touch.clientY - touchStartY);
    if (dx < -56 && dy < 80) setOpen(false);
    touchStartX = 0;
    touchStartY = 0;
  }, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && side.classList.contains("open")) {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key !== "Tab" || !side.classList.contains("open")) return;
    const items = focusableNavItems();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  document.getElementById("themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setStoredTheme(next);
    applyTheme(next);
  });
  setSidebarFocusable(false);

  // 로그인 전용 네비 항목 노출/숨김.
  // 노출 후에는 tabindex 상태를 다시 맞춘다 — 그러지 않으면 사이드바가 닫힌 상태에서도
  // 새로 나타난 항목이 Tab 키로 접근된다.
  const applyLoginOnlyNav = (loggedIn) => {
    document.querySelectorAll("[data-login-only-nav]").forEach((item) => {
      item.hidden = !loggedIn;
    });
    setSidebarFocusable(side.classList.contains("open"));
  };

  // 로그인 상태
  window.apiFetch("/api/me").then(r => r.json()).then(d => {
    window.HarnessAnalytics?.setUserContext({ loggedIn: !!d.loggedIn });
    applyLoginOnlyNav(!!d.loggedIn);
    const who = document.getElementById("whoami");
    if (!who) return;
    const canShowGithubOnly = !!d.loggedIn && d.provider === "github" && !!d.github_enabled;
    document.querySelectorAll("[data-github-only-nav]").forEach((item) => {
      item.hidden = !canShowGithubOnly;
    });
    if (d.loggedIn) {
      const provider = providerForAccount(d.provider);
      const providerLabel = escapeHtml(provider.label);
      const login = escapeHtml(d.login || "me");
      who.innerHTML = `
        <span class="account-menu" id="accountMenu">
          <button class="account-btn account-current" id="accountMenuButton" type="button" aria-haspopup="menu" aria-expanded="false" title="${providerLabel} 로그인">
            ${provider.icon}<span class="account-provider-label">${providerLabel}</span><span class="account-chip">@${login}</span>
          </button>
          <span class="account-menu-list" id="accountMenuList" role="menu" hidden>
            <a href="/mypage/" role="menuitem">마이페이지</a>
            <a href="/api/auth/logout" role="menuitem">로그아웃</a>
          </span>
        </span>`;
      setupAccountMenu();
    } else {
      who.innerHTML = window.oauthLoginButtonsHtml();
    }
  }).catch(() => {
    // 확인 실패 시에는 노출하지 않는다(기본 숨김 유지).
    window.HarnessAnalytics?.setUserContext({ loggedIn: false });
    applyLoginOnlyNav(false);
    const who = document.getElementById("whoami");
    if (who) who.innerHTML = window.oauthLoginButtonsHtml();
  });

  if (!document.querySelector('link[rel="manifest"]')) {
    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = "/manifest.webmanifest";
    document.head.appendChild(manifest);
  }
  if (!document.querySelector('meta[name="theme-color"]')) {
    const theme = document.createElement("meta");
    theme.name = "theme-color";
    theme.content = "#2f6fed";
    document.head.appendChild(theme);
  }
  applyTheme();
  const isNativeShell = typeof window.Capacitor?.isNativePlatform === "function"
    && window.Capacitor.isNativePlatform();
  if (!isNativeShell && "serviceWorker" in navigator && window.isSecureContext) {
    const registerServiceWorker = () => {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => {});
    };
    if (document.readyState === "complete") registerServiceWorker();
    else window.addEventListener("load", registerServiceWorker, { once: true });
  }

  // 오늘 사용량 pill (요소가 있으면 채움)
  const money = (value) => `${Math.round(Number(value) || 0).toLocaleString("ko-KR")}원`;
  window.renderUsageSummary = (d) => {
    document.querySelectorAll("[data-usage]").forEach(el => {
      el.textContent = `AI 사용액 ${money(d.used_krw)} / 일 한도 ${money(d.limit_krw)} · 잔여 ${money(d.remaining_krw)}`;
      el.classList.toggle("danger", !!d.warning);
      el.title = d.warning?.message || "";
    });
    document.querySelectorAll("[data-usage-reset-count]").forEach((el) => {
      el.textContent = String(Math.max(0, Number(d.reset_count) || 0));
    });
    document.querySelectorAll("[data-usage-previous]").forEach((el) => {
      el.textContent = money(d.previous_used_krw);
    });
    document.querySelectorAll("[data-usage-previous-wrap]").forEach((el) => {
      el.hidden = !(Number(d.reset_count) > 0);
    });
    document.querySelectorAll("[data-usage-day-total]").forEach((el) => {
      el.textContent = money(d.day_used_krw);
    });

    const defaults = [
      { provider: "gemini", label: "Gemini", used_krw: 0, day_used_krw: 0 },
      { provider: "openai", label: "GPT", used_krw: 0, day_used_krw: 0 },
      { provider: "claude", label: "Claude", used_krw: 0, day_used_krw: 0 },
    ];
    const providers = Array.isArray(d.providers) && d.providers.length ? d.providers : defaults;
    document.querySelectorAll("[data-usage-providers]").forEach((list) => {
      const cards = providers.map((provider) => {
        const card = document.createElement("div");
        card.className = "usage-provider-card";
        const label = document.createElement("span");
        label.textContent = provider.label || provider.provider || "AI";
        const current = document.createElement("strong");
        current.textContent = money(provider.used_krw);
        const total = document.createElement("small");
        total.textContent = `오늘 누적 ${money(provider.day_used_krw)}`;
        card.append(label, current, total);
        return card;
      });
      list.replaceChildren(...cards);
    });
    return d;
  };
  window.refreshUsage = () => window.apiFetch("/api/usage", { cache: "no-store" })
    .then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return window.renderUsageSummary(d);
    })
    .catch(() => null);
  window.refreshUsage();

  // ---- 회의록 이력(M3) 공통 헬퍼: 대시보드·마이페이지에서 재사용 ----
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
  const meetingMarkdownHtml = (markdown) => {
    const lines = String(markdown || "").split(/\r?\n/);
    let html = "", inList = false;
    const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
    for (const line of lines) {
      const text = line.trim();
      if (!text) { closeList(); continue; }
      if (text.startsWith("# ")) { closeList(); html += `<h1>${esc(text.slice(2))}</h1>`; continue; }
      if (text.startsWith("## ")) { closeList(); html += `<h2>${esc(text.slice(3))}</h2>`; continue; }
      const bullet = text.match(/^[-*]\s+(.*)$/);
      if (bullet) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += `<li>${esc(bullet[1])}</li>`;
        continue;
      }
      closeList();
      html += `<p>${esc(text)}</p>`;
    }
    closeList();
    return html || "<p>회의록 본문이 없습니다.</p>";
  };
  const printMeetingPdf = (meeting) => {
    const title = esc(meeting.title || meeting.date || "회의록");
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8" />` +
      `<title>${title}</title><style>
        body{font-family:"Malgun Gothic","맑은 고딕",Arial,sans-serif;color:#172033;line-height:1.65;margin:28px}
        main{max-width:820px;margin:0 auto} h1{font-size:1.55rem;border-bottom:2px solid #d8dee8;padding-bottom:10px}
        h2{font-size:1.08rem;margin-top:22px;color:#111827} p,li{font-size:.95rem} ul{padding-left:22px}
        .meta{color:#667085;font-size:.86rem;margin-bottom:18px}
      </style></head><body><main><h1>${title}</h1><p class="meta">${esc(meeting.date || "")}</p>${meetingMarkdownHtml(meeting.markdown)}</main></body></html>`;
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.left = "-10000px";
    frame.style.top = "0";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.border = "0";
    document.body.appendChild(frame);
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return;
      const cleanup = () => setTimeout(() => frame.remove(), 600);
      win.addEventListener("afterprint", cleanup, { once: true });
      win.requestAnimationFrame(() => setTimeout(() => { win.focus(); win.print(); setTimeout(cleanup, 2200); }, 120));
    };
    frame.srcdoc = html;
  };
  window.downloadMeeting = async (id, fallbackName) => {
    const r = await window.apiFetch("/api/meetings/" + encodeURIComponent(id));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "불러오기 실패");
    const blob = new Blob(["\uFEFF", d.markdown], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${d.date || fallbackName || "meeting"}_meeting.md`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  window.downloadMeetingPdf = async (id) => {
    const r = await window.apiFetch("/api/meetings/" + encodeURIComponent(id));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "불러오기 실패");
    printMeetingPdf(d);
  };

  window.renderMeetingList = (container, meetings) => {
    if (!meetings || !meetings.length) {
      container.innerHTML = '<p class="hint">아직 저장된 회의록이 없습니다. <a href="/feature/">회의록 만들기</a>에서 생성하면 자동 저장됩니다.</p>';
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "meeting-list";
    for (const m of meetings) {
      const when = (m.date || (m.created_at || "").slice(0, 10)) || "";
      const li = document.createElement("li");
      li.innerHTML = `<span class="mt-title"></span><span class="mt-date">${when}</span>` +
        `<button class="btn btn-ghost btn-small" data-pdf="${m.id}">⬇ PDF</button>`;
      li.querySelector(".mt-title").textContent = m.title || "회의록";
      ul.appendChild(li);
    }
    container.innerHTML = "";
    container.appendChild(ul);
    ul.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-pdf]");
      if (!btn) return;
      btn.disabled = true; const t = btn.textContent; btn.textContent = "…";
      window.downloadMeetingPdf(btn.dataset.pdf).catch(() => {}).finally(() => { btn.disabled = false; btn.textContent = t; });
    });
  };
})();
