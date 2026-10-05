(function initHarnessApi(global) {
  "use strict";

  const DEFAULT_TIMEOUT_MS = 30000;
  // AI 생성·전사처럼 모델 응답을 기다리는 경로는 30초 안에 끝나지 않는다.
  // (서버는 provider 실패 시 fallback 까지 순차 재시도하므로 한 요청이 수 분까지 걸릴 수 있다.)
  const LONG_RUNNING_TIMEOUT_MS = 300000;
  const LONG_RUNNING_PATHS = [
    /^\/api\/ai\/summarize\b/,
    /^\/api\/ai\/evals\/runs\b/,
    /^\/api\/stt\//,
    /^\/api\/analysis\/[^/]+\/stream$/,
    /^\/api\/analysis\/sessions\/[^/]+\/(?:summaries|ideas|plans|manual|field-candidates)\b/,
    /^\/api\/meetings\/from-recording\b/,
    /^\/api\/kanban\/cards\/from-meeting\b/,
  ];
  let accessTokenProvider = null;

  function defaultTimeoutFor(path) {
    const value = String(path || "").split("?")[0];
    return LONG_RUNNING_PATHS.some((pattern) => pattern.test(value)) ? LONG_RUNNING_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  }

  class HarnessApiError extends Error {
    constructor(message, details) {
      super(message);
      this.name = "HarnessApiError";
      Object.assign(this, details || {});
    }
  }

  function normalizedBaseUrl() {
    const raw = global.HarnessRuntimeConfig?.apiBaseUrl;
    if (!raw) return "";
    const url = new URL(String(raw));
    if (url.protocol !== "https:") throw new HarnessApiError("API origin must use HTTPS", { code: "invalid_api_origin" });
    return url.origin;
  }

  function apiUrl(path) {
    const value = String(path || "");
    if (!value.startsWith("/api/")) {
      throw new HarnessApiError("API path must start with /api/", { code: "invalid_api_path" });
    }
    return `${normalizedBaseUrl()}${value}`;
  }

  function setApiAccessTokenProvider(provider) {
    if (provider !== null && typeof provider !== "function") {
      throw new HarnessApiError("Access token provider must be a function or null", { code: "invalid_token_provider" });
    }
    accessTokenProvider = provider;
  }

  function accessTokenWithAbort(signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve()
        .then(() => accessTokenProvider())
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  async function authHeaders(inputHeaders, signal, includeProviderToken) {
    const headers = new global.Headers(inputHeaders || undefined);
    if (!includeProviderToken || !accessTokenProvider || headers.has("authorization")) return headers;
    let token;
    try {
      token = await accessTokenWithAbort(signal);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new HarnessApiError("Unable to read the mobile access token", { code: "auth_token_error", cause: error });
    }
    if (token === null || token === undefined || token === "") return headers;
    if (typeof token !== "string" || !/^ph_mob_at_[A-Za-z0-9._~-]+$/.test(token)) {
      throw new HarnessApiError("Access token provider returned an invalid token", { code: "invalid_access_token" });
    }
    headers.set("authorization", `Bearer ${token}`);
    return headers;
  }

  async function apiFetch(path, options) {
    const input = options || {};
    const timeoutMs = Number.isFinite(input.timeoutMs) ? Math.max(1, input.timeoutMs) : defaultTimeoutFor(path);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort("timeout");
    }, timeoutMs);
    const upstreamSignal = input.signal;
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal) {
      if (upstreamSignal.aborted) abortFromUpstream();
      else upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    }

    const { timeoutMs: _timeoutMs, ...fetchOptions } = input;
    try {
      const headers = await authHeaders(
        fetchOptions.headers,
        controller.signal,
        path !== "/api/auth/mobile/revoke",
      );
      return await global.fetch(apiUrl(path), {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof HarnessApiError) throw error;
      if (controller.signal.aborted) {
        if (timedOut) throw new HarnessApiError("API request timed out", { code: "timeout", cause: error });
        throw new HarnessApiError("API request was cancelled", { code: "cancelled", cause: error });
      }
      const offline = global.navigator && global.navigator.onLine === false;
      throw new HarnessApiError(offline ? "Network is offline" : "API request failed", {
        code: offline ? "offline" : "network_error",
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener?.("abort", abortFromUpstream);
    }
  }

  async function apiFetchJson(path, options) {
    const response = await apiFetch(path, options);
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new HarnessApiError("API returned invalid JSON", {
          code: "invalid_json",
          status: response.status,
          response,
          cause: error,
        });
      }
    }
    if (!response.ok) {
      const message = data && typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
      throw new HarnessApiError(message, {
        code: response.status === 401 ? "unauthorized" : "http_error",
        status: response.status,
        data,
        response,
      });
    }
    return data;
  }

  // 화면에 그대로 붙일 수 있는 한국어 실패 사유. 원인을 알 수 없으면 원문 메시지를 그대로 돌려준다.
  function apiErrorMessage(error, context) {
    const fallback = error && error.message ? String(error.message) : "알 수 없는 오류";
    const what = context ? `${context} ` : "";
    switch (error && error.code) {
      case "timeout":
        return `${what}요청이 시간 안에 끝나지 않았습니다. 입력(전사/자료) 양을 줄이거나 잠시 후 다시 시도하세요.`;
      case "cancelled":
        return `${what}요청이 취소되었습니다.`;
      case "offline":
        return "네트워크가 끊겼습니다. 연결을 확인한 뒤 다시 시도하세요.";
      case "network_error":
        return `${what}서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.`;
      case "unauthorized":
        return "로그인이 필요합니다. 다시 로그인한 뒤 시도하세요.";
      default:
        if (error && error.status === 413) return "보낸 데이터가 서버 한도를 넘었습니다. 파일 수나 크기를 줄여 다시 시도하세요.";
        return fallback;
    }
  }

  global.HarnessApiError = HarnessApiError;
  global.apiUrl = apiUrl;
  global.apiFetch = apiFetch;
  global.apiFetchJson = apiFetchJson;
  global.apiErrorMessage = apiErrorMessage;
  global.setApiAccessTokenProvider = setApiAccessTokenProvider;
  global.apiTimeoutPolicy = { defaultTimeoutFor, DEFAULT_TIMEOUT_MS, LONG_RUNNING_TIMEOUT_MS };
})(window);
