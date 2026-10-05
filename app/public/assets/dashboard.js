// 대시보드 — 최근 회의록(최대 3건). 로그인 시 목록, 아니면 로그인 유도.
(() => {
  "use strict";
  function bootDashboard() {
    window.QuickLog?.init();
    const box = document.getElementById("recentMeetings");
    if (!box) return;
    window.apiFetch("/api/me").then((r) => r.json()).then((me) => {
      if (!me.loggedIn) {
        const loginButton = window.oauthLoginButtonsHtml
          ? window.oauthLoginButtonsHtml("account-btn account-login account-login-inline")
          : '<a class="account-btn account-login account-login-inline" href="/api/auth/github"><span>GitHub 로그인</span></a>';
        box.innerHTML = `<div class="empty-login"><p class="hint">로그인하면 최근 회의록이 여기에 표시됩니다.</p>${loginButton}</div>`;
        return;
      }
      return window.apiFetch("/api/meetings?limit=3").then((r) => r.json()).then((d) => {
        if (d.error) { box.innerHTML = `<p class="hint danger">${d.error}</p>`; return; }
        window.renderMeetingList(box, d.meetings);
      });
    }).catch(() => { box.innerHTML = '<p class="hint danger">불러오기 실패</p>'; });
  }
  if (window.__sduiRegisterBoot) window.__sduiRegisterBoot("dashboard", bootDashboard);
  else bootDashboard();
})();
