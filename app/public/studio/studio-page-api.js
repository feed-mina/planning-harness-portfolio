(function initStudioApiPage() {
  "use strict";

  const script = document.currentScript;
  const page = (script?.dataset?.page || "").trim().toLowerCase();
  const root = document.querySelector("#studio-page-root");

  const escapeHtml = (value) => {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  const showFallback = (message) => {
    if (!root) return;
    const text = escapeHtml(message || "페이지 내용을 불러오지 못했습니다.");
    root.innerHTML = `<main><p style="padding:20px;">${text}</p></main>`;
  };

  if (!root || !page) {
    showFallback("페이지 정보가 없습니다.");
    return;
  }

  const endpoint = `/api/studio/pages/${encodeURIComponent(page)}`;

  fetch(endpoint, { method: "GET", credentials: "same-origin" })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload && typeof payload.error === "string" ? payload.error : `API 오류 (${response.status})`;
        throw new Error(message);
      }
      return payload;
    })
    .then((payload) => {
      if (!payload || typeof payload.bodyHtml !== "string") {
        throw new Error("페이지 본문 응답이 유효하지 않습니다.");
      }
      if (payload.title) document.title = payload.title;
      if (payload.bodyClass) {
        document.body.className = payload.bodyClass;
      }
      root.innerHTML = payload.bodyHtml;
    })
    .catch((error) => {
      showFallback(error instanceof Error ? error.message : "페이지 로드 실패");
    });
})();
