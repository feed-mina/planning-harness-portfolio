// 통계 — 오늘 요약 + Chart.js(경량 CDN) 일자별 비용 막대 + provider 도넛.
(() => {
  "use strict";
  function bootStats() {
  const PURPLE = "#7c5cff";
  const PROVIDER_COLOR = { gemini: "#16a34a", claude: "#7c5cff", openai: "#ef8a8a" };
  const PERIOD_DAYS = { day: 1, week: 7, month: 30 };
  const PERIOD_LABEL = { day: "일", week: "주", month: "월" };
  const charts = {};

  // 오늘 요약
  window.apiFetch("/api/usage").then((r) => r.json()).then((d) => {
    document.getElementById("todayCost").textContent = Math.round(d.used_krw) + "원";
    document.getElementById("remain").textContent = Math.round(d.remaining_krw) + "원";
  }).catch(() => {});

  setupPeriodToggle();
  loadPeriod("day");

  window.apiFetch("/api/usage/subjects?days=30").then((r) => r.json()).then((s) => {
    renderSubjectRows(s.subjects || []);
  }).catch(() => {});

  window.apiFetch("/api/usage/requests?days=30&limit=50").then((r) => r.json()).then((s) => {
    renderRequestRows(s.requests || []);
  }).catch(() => {});

  function setupPeriodToggle() {
    const wrap = document.getElementById("costPeriodToggle");
    if (!wrap) return;
    wrap.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const btn = target?.closest("[data-period]");
      if (!btn) return;
      const period = btn.dataset.period || "day";
      wrap.querySelectorAll("[data-period]").forEach((item) => {
        const active = item === btn;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      loadPeriod(period);
    });
  }

  function loadPeriod(period) {
    const safePeriod = PERIOD_DAYS[period] ? period : "day";
    window.apiFetch(`/api/usage/cost-dashboard?period=${encodeURIComponent(safePeriod)}`).then((r) => r.json()).then((data) => {
      renderCostDashboard(data);
      renderDaily(data.days_series || []);
      renderProviders(data.providers || []);
    }).catch(() => {});

    window.apiFetch(`/api/usage/breakdown?days=${PERIOD_DAYS[safePeriod]}`).then((r) => r.json()).then((s) => {
      renderBreakdown(s, safePeriod);
    }).catch(() => {});
  }

  function destroyChart(name) {
    if (charts[name]) {
      charts[name].destroy();
      charts[name] = null;
    }
  }

  function renderDaily(days) {
    const total = days.reduce((a, d) => a + d.cost, 0);
    document.getElementById("dailyEmpty").hidden = !!total;
    destroyChart("daily");
    if (!total || typeof Chart === "undefined") return;
    charts.daily = new Chart(document.getElementById("dailyChart"), {
      type: "bar",
      data: {
        labels: days.map((d) => d.day.slice(5)), // MM-DD
        datasets: [{ label: "AI 사용액(원)", data: days.map((d) => Math.round(d.cost * 100) / 100),
          backgroundColor: PURPLE, borderRadius: 6 }],
      },
      options: { responsive: true, plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => v + "원" } } } },
    });
  }

  function renderProviders(providers) {
    const nonzero = providers.filter((p) => costOf(p) > 0);
    document.getElementById("provEmpty").hidden = !!nonzero.length;
    destroyChart("provider");
    if (!nonzero.length || typeof Chart === "undefined") return;
    charts.provider = new Chart(document.getElementById("providerChart"), {
      type: "doughnut",
      data: {
        labels: nonzero.map((p) => p.provider),
        datasets: [{ data: nonzero.map((p) => Math.round(costOf(p) * 100) / 100),
          backgroundColor: nonzero.map((p) => PROVIDER_COLOR[p.provider] || "#b9a9f2") }],
      },
      options: { responsive: true, plugins: { legend: { position: "bottom" } } },
    });
  }

  function fmtNum(value) {
    return Math.round(Number(value) || 0).toLocaleString("ko-KR");
  }

  function costOf(row) {
    return Number(row?.cost_krw ?? row?.cost) || 0;
  }

  function fmtCost(value) {
    const n = Number(value) || 0;
    return `${n < 1 ? n.toFixed(3) : n.toFixed(2)}원`;
  }

  function fmtPercent(value) {
    const n = Math.max(0, Number(value) || 0) * 100;
    return `${n >= 10 ? n.toFixed(1) : n.toFixed(2)}%`;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function fmtDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function renderCostDashboard(data) {
    const period = data?.period || "day";
    const totals = data?.totals || {};
    const budget = data?.budget || {};
    const burnRate = Math.max(0, Number(budget.burn_rate) || 0);
    const periodCost = document.getElementById("periodCost");
    const periodBudget = document.getElementById("periodBudget");
    const budgetRate = document.getElementById("budgetRate");
    const budgetFill = document.getElementById("budgetFill");
    const summary = document.getElementById("periodSummary");
    if (periodCost) periodCost.textContent = fmtCost(totals.cost_krw);
    if (periodBudget) periodBudget.textContent = fmtCost(budget.period_limit_krw);
    if (budgetRate) budgetRate.textContent = fmtPercent(burnRate);
    if (budgetFill) budgetFill.style.width = `${Math.min(100, burnRate * 100)}%`;
    if (summary) {
      summary.textContent = `${PERIOD_LABEL[period] || "일"} 기준 요청 ${fmtNum(totals.requests)}건, 토큰 ${fmtNum(totals.total_tokens)}개, 잔여 예산 ${fmtCost(budget.remaining_krw)}.`;
    }
  }

  function renderBreakdown(data, period = "day") {
    const totals = data?.totals || {};
    const models = data?.models || [];
    renderTokenChart(totals, period);
    renderModelChart(models);
    renderModelRows(models);
  }

  function renderTokenChart(totals, period) {
    const values = [
      Number(totals.input_tokens) || 0,
      Number(totals.output_tokens) || 0,
      Number(totals.cache_tokens) || 0,
    ];
    document.getElementById("tokenEmpty").hidden = values.some(Boolean);
    destroyChart("token");
    if (!values.some(Boolean)) {
      return;
    }
    if (typeof Chart === "undefined") return;
    charts.token = new Chart(document.getElementById("tokenChart"), {
      type: "bar",
      data: {
        labels: [`최근 ${PERIOD_LABEL[period] || "일"}`],
        datasets: [
          { label: "입력", data: [values[0]], backgroundColor: "#2f6fed", borderRadius: 5 },
          { label: "출력", data: [values[1]], backgroundColor: "#16a34a", borderRadius: 5 },
          { label: "캐시", data: [values[2]], backgroundColor: "#f59e0b", borderRadius: 5 },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom" } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => `${v} tok` } } },
      },
    });
  }

  function renderModelChart(models) {
    const rows = models.filter((row) => Number(row.cost_krw) > 0 || Number(row.total_tokens) > 0);
    document.getElementById("modelEmpty").hidden = !!rows.length;
    destroyChart("model");
    if (!rows.length) {
      return;
    }
    if (typeof Chart === "undefined") return;
    charts.model = new Chart(document.getElementById("modelChart"), {
      type: "doughnut",
      data: {
        labels: rows.map((row) => `${row.provider}/${row.model}`),
        datasets: [{
          data: rows.map((row) => Number(row.cost_krw) || Number(row.total_tokens) || 0),
          backgroundColor: rows.map((row) => PROVIDER_COLOR[row.provider] || "#2f6fed"),
        }],
      },
      options: { responsive: true, plugins: { legend: { position: "bottom" } } },
    });
  }

  function renderModelRows(models) {
    const body = document.getElementById("modelRows");
    if (!body) return;
    body.innerHTML = models.map((row) => `<tr>
      <td>${esc(row.provider)}/${esc(row.model)}</td>
      <td>${fmtNum(row.requests)}</td>
      <td>${fmtNum(row.input_tokens)}</td>
      <td>${fmtNum(row.output_tokens)}</td>
      <td>${fmtNum(row.cache_tokens)}</td>
      <td>${fmtCost(row.cost_krw)}</td>
    </tr>`).join("") || `<tr><td colspan="6">아직 모델별 기록이 없습니다.</td></tr>`;
  }

  function renderSubjectRows(subjects) {
    const body = document.getElementById("subjectRows");
    if (!body) return;
    body.innerHTML = subjects.map((row) => `<tr>
      <td>${esc(row.label || (row.subject_type === "device" ? "익명 기기" : "계정"))}</td>
      <td>${fmtNum(row.requests)}</td>
      <td>${fmtNum(row.total_tokens)}</td>
      <td>${fmtCost(row.cost_krw)}</td>
      <td>${fmtDateTime(row.latest_at)}</td>
    </tr>`).join("") || `<tr><td colspan="5">아직 계정·기기별 기록이 없습니다.</td></tr>`;
  }

  function renderRequestRows(requests) {
    const body = document.getElementById("requestRows");
    if (!body) return;
    body.innerHTML = requests.map((row) => `<tr>
      <td>${fmtDateTime(row.created_at)}</td>
      <td>${esc(row.provider)}/${esc(row.model)}</td>
      <td>${fmtNum(row.input_tokens)}</td>
      <td>${fmtNum(row.output_tokens)}</td>
      <td>${fmtNum(row.cache_tokens)}</td>
      <td>${fmtCost(row.cost_krw)}</td>
    </tr>`).join("") || `<tr><td colspan="6">아직 요청 이력이 없습니다.</td></tr>`;
  }
  }
  if (window.__sduiRegisterBoot) window.__sduiRegisterBoot("stats", bootStats);
  else bootStats();
})();
