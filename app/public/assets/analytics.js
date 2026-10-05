(() => {
  "use strict";

  const CONSENT_KEY = "harness.analytics-consent.v1";
  const AUTH_EVENT_KEY = "harness.analytics-auth-event.v1";
  const publicPageConfig = window.HarnessPublicPageConfig || {};
  const PUBLIC_PATHS = new Set(Array.isArray(publicPageConfig.publicPaths) ? publicPageConfig.publicPaths : []);
  const REPLAY_SAFE_PATHS = new Set(Array.isArray(publicPageConfig.replaySafePaths) ? publicPageConfig.replaySafePaths : []);
  const EVENT_PARAMS = Object.freeze({
    page_view: ["page_type"],
    cta_click: ["page_type", "cta_id"],
    file_download: ["asset_type"],
    sign_up: ["method"],
    login: ["method"],
    meeting_input_start: ["input_method"],
    meeting_generate_success: ["input_method"],
    meeting_generate_error: ["error_category"],
    kanban_create_success: [],
    github_issue_create_success: [],
  });
  const ALLOWED_AUTH_EVENTS = new Set(["sign_up", "login"]);
  const ALLOWED_AUTH_METHODS = new Set(["github", "google", "kakao", "email"]);
  const state = {
    config: null,
    consent: readStorage("localStorage", CONSENT_KEY),
    loggedIn: null,
    initialized: false,
    pageViewSent: false,
    queue: [],
    preferenceHosts: new Set(),
  };

  function readStorage(storageName, key) {
    try { return window[storageName]?.getItem(key) || null; } catch { return null; }
  }

  function writeStorage(storageName, key, value) {
    try { window[storageName]?.setItem(key, value); } catch {}
  }

  function removeStorage(storageName, key) {
    try { window[storageName]?.removeItem(key); } catch {}
  }

  function normalizedPath() {
    const path = location.pathname || "/";
    if (path === "/") return path;
    return path.endsWith("/") ? path : `${path}/`;
  }

  function pageType() {
    return normalizedPath().replace(/^\//, "").replace(/\/$/, "") || "home";
  }

  function safeValue(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
  }

  function sanitizeEvent(name, params = {}) {
    if (!Object.prototype.hasOwnProperty.call(EVENT_PARAMS, name)) return null;
    const clean = {};
    for (const key of EVENT_PARAMS[name]) {
      const value = safeValue(params[key]);
      if (value) clean[key] = value;
    }
    return { name, params: clean };
  }

  function rememberAuthCallback() {
    const url = new URL(location.href);
    const eventName = url.searchParams.get("analytics_auth");
    const method = url.searchParams.get("analytics_method");
    if (!eventName && !method) return;
    if (ALLOWED_AUTH_EVENTS.has(eventName) && ALLOWED_AUTH_METHODS.has(method)) {
      writeStorage("sessionStorage", AUTH_EVENT_KEY, JSON.stringify({ eventName, method }));
    }
    url.searchParams.delete("analytics_auth");
    url.searchParams.delete("analytics_method");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function setDefaultConsentMode() {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
    window.gtag("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      wait_for_update: 500,
    });
  }

  function updateGoogleConsent(granted) {
    if (!window.gtag) return;
    window.gtag("consent", "update", {
      analytics_storage: granted ? "granted" : "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  }

  function appendScript(src, attributes = {}) {
    if (document.querySelector(`script[src="${src}"]`)) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    Object.entries(attributes).forEach(([key, value]) => script.setAttribute(key, value));
    document.head.appendChild(script);
  }

  function loadGoogleAnalytics() {
    const id = state.config.ga4MeasurementId;
    if (!id) return;
    appendScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
    window.gtag("js", new Date());
    window.gtag("config", id, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
  }

  function loadGoogleTagManager() {
    const id = state.config.gtmContainerId;
    if (!id || !PUBLIC_PATHS.has(normalizedPath())) return;
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    appendScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`);
  }

  function loadCloudflareAnalytics() {
    const token = state.config.cloudflareWebAnalyticsToken;
    if (!token || !PUBLIC_PATHS.has(normalizedPath())) return;
    appendScript("https://static.cloudflareinsights.com/beacon.min.js", {
      "data-cf-beacon": JSON.stringify({ token, spa: false }),
    });
  }

  function loadClarityIfSafe() {
    const id = state.config?.clarityProjectId;
    if (!id || state.loggedIn !== false || !REPLAY_SAFE_PATHS.has(normalizedPath()) || window.clarity) return;
    window.clarity = function clarity() { (window.clarity.q = window.clarity.q || []).push(arguments); };
    window.clarity.t = Date.now();
    appendScript(`https://www.clarity.ms/tag/${encodeURIComponent(id)}`);
  }

  function dispatch(event) {
    const payload = {
      ...event.params,
      environment: safeValue(state.config.environment || "production"),
    };
    if (window.gtag && state.config.ga4MeasurementId) {
      window.gtag("event", event.name, payload);
    }
    if (window.dataLayer && state.config.gtmContainerId) {
      window.dataLayer.push({ event: `harness_${event.name}`, ...payload });
    }
  }

  function sendPageView() {
    if (state.pageViewSent || !PUBLIC_PATHS.has(normalizedPath())) return;
    state.pageViewSent = true;
    const event = sanitizeEvent("page_view", { page_type: pageType() });
    if (window.gtag && state.config.ga4MeasurementId) {
      window.gtag("event", "page_view", {
        page_title: document.title.slice(0, 100),
        page_location: `${location.origin}${location.pathname}`,
        page_path: location.pathname,
        page_type: pageType(),
        environment: safeValue(state.config.environment || "production"),
      });
    }
    if (window.dataLayer && state.config.gtmContainerId) {
      window.dataLayer.push({ event: "harness_page_view", ...event.params });
    }
  }

  function initialize() {
    if (state.initialized || state.consent !== "accepted" || !state.config?.enabled) return;
    state.initialized = true;
    updateGoogleConsent(true);
    loadGoogleAnalytics();
    loadGoogleTagManager();
    loadCloudflareAnalytics();
    loadClarityIfSafe();
    sendPageView();
    state.queue.splice(0).forEach(dispatch);
  }

  function track(name, params = {}) {
    const event = sanitizeEvent(name, params);
    if (!event || state.consent !== "accepted") return false;
    if (state.config && !state.config.enabled) return false;
    if (!state.config?.enabled || !state.initialized) {
      state.queue.push(event);
      initialize();
      return true;
    }
    dispatch(event);
    return true;
  }

  function closeDialog() {
    document.getElementById("analyticsConsentDialog")?.remove();
  }

  function chooseConsent(choice) {
    const wasAccepted = state.consent === "accepted";
    state.consent = choice;
    writeStorage("localStorage", CONSENT_KEY, choice);
    updateGoogleConsent(choice === "accepted");
    closeDialog();
    renderPreferenceControls();
    if (choice === "accepted") initialize();
    else {
      state.queue.length = 0;
      if (wasAccepted && state.initialized) location.reload();
    }
  }

  function openPreferences() {
    if (!state.config?.enabled || document.getElementById("analyticsConsentDialog")) return;
    const dialog = document.createElement("section");
    dialog.id = "analyticsConsentDialog";
    dialog.className = "analytics-consent";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "analyticsConsentTitle");
    dialog.innerHTML = `
      <div class="analytics-consent-card">
        <h2 id="analyticsConsentTitle">선택적 방문 통계</h2>
        <p>서비스 개선을 위해 익명화된 페이지·기능 이용 이벤트만 수집합니다. 회의 원문, 이메일, 검색어와 URL의 쿼리 값은 보내지 않습니다.</p>
        <div class="analytics-consent-actions">
          <button type="button" class="analytics-reject">거부</button>
          <button type="button" class="analytics-accept">동의</button>
        </div>
      </div>`;
    dialog.querySelector(".analytics-reject").addEventListener("click", () => chooseConsent("rejected"));
    dialog.querySelector(".analytics-accept").addEventListener("click", () => chooseConsent("accepted"));
    document.body.appendChild(dialog);
    dialog.querySelector(state.consent === "accepted" ? ".analytics-accept" : ".analytics-reject")?.focus();
  }

  function renderPreferenceControls() {
    state.preferenceHosts.forEach((host) => {
      host.querySelector("[data-analytics-preferences]")?.remove();
      if (!state.config?.enabled) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "analytics-preferences";
      button.dataset.analyticsPreferences = "true";
      button.textContent = `방문 통계 설정 · ${state.consent === "accepted" ? "동의" : state.consent === "rejected" ? "거부" : "미설정"}`;
      button.addEventListener("click", openPreferences);
      host.appendChild(button);
    });
  }

  function mountPreferencesControl(host) {
    if (!(host instanceof Element)) return;
    state.preferenceHosts.add(host);
    renderPreferenceControls();
  }

  function setUserContext(context = {}) {
    state.loggedIn = context.loggedIn === true;
    loadClarityIfSafe();
    const raw = readStorage("sessionStorage", AUTH_EVENT_KEY);
    if (!raw || !state.loggedIn) return;
    removeStorage("sessionStorage", AUTH_EVENT_KEY);
    try {
      const pending = JSON.parse(raw);
      if (ALLOWED_AUTH_EVENTS.has(pending.eventName) && ALLOWED_AUTH_METHODS.has(pending.method)) {
        track(pending.eventName, { method: pending.method });
      }
    } catch {}
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("a,button") : null;
    if (!target) return;
    const analyticsId = target.getAttribute("data-analytics-id");
    if (analyticsId) track("cta_click", { page_type: pageType(), cta_id: analyticsId });
    const assetType = target.getAttribute("data-analytics-download");
    if (assetType) track("file_download", { asset_type: assetType });
    const authMatch = target.getAttribute("href")?.match(/^\/api\/auth\/(github|google|kakao)$/);
    if (authMatch) writeStorage("sessionStorage", AUTH_EVENT_KEY, JSON.stringify({ eventName: "login", method: authMatch[1] }));
  });

  rememberAuthCallback();
  setDefaultConsentMode();
  window.HarnessAnalytics = Object.freeze({ track, setUserContext, mountPreferencesControl, openPreferences });

  window.apiFetch("/api/analytics/config", { credentials: "same-origin", cache: "no-store" })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("analytics config unavailable")))
    .then((config) => {
      state.config = config && config.version === 1 ? config : { enabled: false };
      renderPreferenceControls();
      if (!state.config.enabled) return;
      if (!state.consent && PUBLIC_PATHS.has(normalizedPath())) openPreferences();
      initialize();
    })
    .catch(() => { state.config = { enabled: false }; });
})();
