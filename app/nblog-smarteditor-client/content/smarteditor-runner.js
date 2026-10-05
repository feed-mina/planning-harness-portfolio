(function installNBlogSmartEditorRunner() {
  "use strict";

  if (globalThis.__nblogSmartEditorRunnerV1Installed) return;
  globalThis.__nblogSmartEditorRunnerV1Installed = true;

  const MANUAL_BOUNDARIES = Object.freeze({
    login: "manual",
    captcha: "manual",
    media: "manual",
    place: "manual",
    preview: "manual",
    publish: "manual",
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "NBLOG_EDITOR_APPLY_V1") return undefined;
    if (location.protocol !== "https:" || location.hostname !== "blog.naver.com") {
      sendResponse({ ok: false, code: "not_naver_blog", manual: MANUAL_BOUNDARIES });
      return false;
    }
    try {
      const result = globalThis.NBlogSmartEditorAdapter.applyDraft(document, message.draft);
      sendResponse({ ...result, manual: MANUAL_BOUNDARIES });
    } catch {
      sendResponse({ ok: false, code: "adapter_failed", manual: MANUAL_BOUNDARIES });
    }
    return false;
  });
})();
