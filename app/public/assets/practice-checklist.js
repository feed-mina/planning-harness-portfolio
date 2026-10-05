// 기획 하네스 루프 — 업무 실천 체크리스트 (localStorage 기반, 서버 전송 없음).
(() => {
  "use strict";
  const root = document.getElementById("sections");
  if (!root) return;

  // <checklist:sections> 생성됨 — checklist/checklist-items.json 을 고치고 npm run build:checklist
  const SECTIONS = [
    {
      id: "morning", icon: "🌅", title: "하루 시작할 때",
      groups: [
      { items: [
        "누적 피드백과 오늘 범위를 다시 확인했다",
        "\"오늘 판단 가능하게 만들 결과물 하나\"를 정했다",
        "그 결과물이 레벨 1인지 확인했다 (레벨 5로 키우지 않기)",
        "구형 자료·장기 고도화·부가 기능은 후순위로 미뤘다",
      ] },
      ],
    },
    {
      id: "intake", icon: "📥", title: "새 업무·회의를 받았을 때",
      groups: [
      { label: "AI에 넣기 전, 직접 4분류", items: [
        "① 직접 요청 을 분리했다",
        "② 확정된 결정 을 분리했다",
        "③ 보류된 내용 을 분리했다",
        "④ 도메인 설명 을 분리했다 (요구사항 아님!)",
      ] },
      { label: "범위 고정", items: [
        "이번에 반드시 구현 / 확인 필요 / 후순위 / 제외 로 나눴다",
        "설명 중 언급됐다는 이유만으로 기능화하지 않았다",
        "합의 안 된 기능은 구현 전에 \"제안\"으로 확인했다",
        "내 방식을 주장할 땐 고집 대신 작은 비교 실험으로 먼저 증명했다",
      ] },
      ],
    },
    {
      id: "ai", icon: "🤖", title: "AI 사용할 때",
      groups: [
      { label: "요청해도 되는 것", items: [
        "구현 후보·대안과 장단점을 요청했다",
        "위험 요소·실패 가능성을 물었다",
        "테스트 케이스 / 가장 작은 실험 방법을 요청했다",
      ] },
      { label: "AI에 맡기지 않을 것", neg: true, items: [
        "최종 요구사항을 AI가 결정하게 두지 않았다",
        "미확인 임계값을 AI 말대로 확정하지 않았다",
        "현장 매핑을 추정으로 넣지 않았다",
        "\"테스트 통과 = 검증 완료\"로 넘어가지 않았다",
      ] },
      { label: "결과를 받은 후", items: [
        "AI 계획을 원문 요구와 1:1로 대조했다",
        "요청하지 않은 기능을 삭제했다",
        "미확정 임계값을 제거했다",
      ] },
      ],
    },
    {
      id: "layers", icon: "🔍", title: "결과 정리 — 5층 분리",
      groups: [
      { items: [
        "① 확인된 사실 (데이터로 검증됨)",
        "② 계산된 결과",
        "③ 가설",
        "④ 현장 확인 필요",
        "⑤ AI 제안",
        "위 다섯 가지를 섞어 쓰지 않았다",
      ] },
      ],
    },
    {
      id: "verify", icon: "✅", title: "구현·검증할 때",
      groups: [
      { items: [
        "기능·계산 먼저, GUI는 나중에 했다",
        "비교 변수 A/B가 서로 독립적인지 확인했다",
        "판정 조건이 코드에 정확히 들어갔는지 봤다",
        "계산값 → 화면 출력까지 연결을 확인했다",
        "원본 데이터와 화면 데이터가 일치하는지 대조했다",
        "테스트가 잘못된 구현을 승인하고 있지 않은지 의심했다",
        "핵심 코드와 데이터 흐름을 내 말로 설명할 수 있다",
        "원본을 보존하고 독립 경로로 대조했다",
      ] },
      ],
    },
    {
      id: "ask", icon: "❓", title: "질문할 때",
      tpl: { name: "질문 4줄 템플릿", text: "확인 필요한 것:\n왜 필요한가:\n확인 전까지 무엇을 보류할 것인가:\n내가 권하는 선택:" },
      groups: [
      { items: [
        "몇 시간 혼자 고민하지 않고 바로 질문했다",
        "\"모른다\"만 말하지 않고 이유 + 임시 처리안 + 제안을 붙였다",
        "복잡해짐·지연 가능성을 숨기지 않고 조기 공유했다",
      ] },
      ],
    },
    {
      id: "report", icon: "📋", title: "보고할 때",
      tpl: { name: "보고 5줄 템플릿", text: "목표: 오늘 무엇을 판단할 수 있게 했는지\n결과물: 화면·표·링크·파일\n확인된 사실: 데이터로 검증된 내용\n미확인 사항: 현장 확인·대표 결정 필요\n다음 단계: 가장 중요한 1~2개" },
      groups: [
      { items: [
        "\"열심히 했다\"가 아니라 \"무엇을 판단 가능하게 했는지\"로 보고했다",
        "완성품 대신 검토 가능한 중간 결과를 먼저 공유했다",
        "산출물 단계를 명시했다 (초안 / 검증본 / 시연본 / 배포본)",
      ] },
      ],
    },
    {
      id: "night", icon: "🌙", title: "하루 마무리할 때",
      groups: [
      { items: [
        "오늘의 최소 범위를 정규 업무시간 안에 닫았다",
        "야근으로 범위 초과를 메우지 않았다",
        "내일 닫을 것 1~2개만 정해뒀다",
        "반복해서 지킬 규칙이 생겼다면 프로젝트 MD 지침에 기록했다",
      ] },
      ],
    },
  ];
  // </checklist:sections>

  const KEY = "planning-harness.practice-checklist";
  let state = {
    checked: {}, open: { morning: true }, startedAt: null, startedDate: null,
    history: [], edits: { removed: {}, text: {}, added: {} }, nextItemId: 1, view: "checklist",
  };
  let editMode = false;

  const DEFAULT_TEXT = {};
  SECTIONS.forEach((sec) => {
    let i = 0;
    sec.groups.forEach((g) => g.items.forEach((t) => { DEFAULT_TEXT[`${sec.id}-${i++}`] = t; }));
  });

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));

  // 기본 항목(SECTIONS) 위에 사용자 편집(삭제·문구 수정·추가)을 겹쳐 실제 목록을 만든다.
  // 기본 항목 id는 정의 순서 기준으로 고정 — 항목을 지워도 남은 항목의 체크 기록이 밀리지 않는다.
  const effectiveSections = () => SECTIONS.map((sec) => {
    let i = 0;
    return {
      id: sec.id, icon: sec.icon, title: sec.title, tpl: sec.tpl,
      groups: sec.groups.map((g, gi) => {
        const items = [];
        g.items.forEach((t) => {
          const id = `${sec.id}-${i++}`;
          if (!state.edits.removed[id]) {
            items.push({ id, text: state.edits.text[id] !== undefined ? state.edits.text[id] : t });
          }
        });
        (state.edits.added[`${sec.id}:${gi}`] || []).forEach((it) => items.push({ id: it.id, text: it.text }));
        return { label: g.label, neg: g.neg, gi, items };
      }),
    };
  });

  const computeCounts = () => {
    let total = 0, done = 0;
    const sec = {};
    effectiveSections().forEach((s) => {
      let t = 0, d = 0;
      s.groups.forEach((g) => g.items.forEach((it) => { t++; if (state.checked[it.id]) d++; }));
      sec[s.id] = [d, t]; total += t; done += d;
    });
    return { done, total, sec };
  };

  const renderSections = () => {
    root.innerHTML = effectiveSections().map((sec) => {
      const groups = sec.groups.map((g) => {
        const label = g.label ? `<div class="practice-group${g.neg ? " is-neg" : ""}">${esc(g.label)}</div>` : "";
        const items = g.items.map((it) => (editMode
          ? `<div class="practice-edit-row"><button class="practice-del" type="button" data-del="${it.id}" aria-label="항목 삭제">✕</button><button class="practice-txt" type="button" data-edit="${it.id}">${esc(it.text)}</button></div>`
          : `<label class="practice-item${g.neg ? " is-neg" : ""}"><input type="checkbox" data-id="${it.id}" /><span>${esc(it.text)}</span></label>`
        )).join("");
        const add = editMode ? `<button class="practice-add" type="button" data-add="${sec.id}:${g.gi}">＋ 항목 추가</button>` : "";
        return label + items + add;
      }).join("");
      const tpl = sec.tpl
        ? `<div class="practice-tpl"><div class="practice-tpl-head"><b>${esc(sec.tpl.name)}</b><button class="btn btn-ghost" type="button" data-copy="${esc(sec.tpl.text)}">복사</button></div><pre>${esc(sec.tpl.text)}</pre></div>`
        : "";
      return `<div class="practice-sec" id="sec-${sec.id}">
        <button class="practice-sec-head" type="button" data-sec="${sec.id}" aria-expanded="false">
          <span class="practice-sec-ico" aria-hidden="true">${sec.icon}</span>
          <span class="practice-sec-title">${esc(sec.title)}</span>
          <span class="practice-sec-count" data-count="${sec.id}"></span>
          <span class="practice-chev" aria-hidden="true">⌄</span>
        </button>
        <div class="practice-sec-body">${groups}${tpl}</div>
      </div>`;
    }).join("");
  };

  const refresh = () => {
    const c = computeCounts();
    SECTIONS.forEach((sec) => {
      const [d, t] = c.sec[sec.id];
      const el = document.getElementById(`sec-${sec.id}`);
      if (!el) return;
      el.querySelectorAll("input[type=checkbox]").forEach((b) => { b.checked = !!state.checked[b.dataset.id]; });
      el.classList.toggle("is-done", t > 0 && d === t);
      el.classList.toggle("is-open", !!state.open[sec.id]);
      el.querySelector(".practice-sec-head").setAttribute("aria-expanded", String(!!state.open[sec.id]));
      el.querySelector(`[data-count="${sec.id}"]`).textContent = `${d}/${t}`;
    });
    const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
    document.getElementById("overallBar").style.width = `${pct}%`;
    document.getElementById("overallPct").textContent = `${pct}%`;
    document.getElementById("status").textContent = state.startedAt
      ? `${state.startedAt} 시작 · ${c.done}/${c.total} 완료`
      : `${c.done}/${c.total} 완료`;
    renderHistory();
  };

  // ── 날짜별 히스토리 ──
  const todayKey = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  };
  // 체크가 하나라도 있어야 기록하고, 같은 날짜엔 최대 진행률만 남긴다
  // — "새 하루 시작" 직후의 0% 저장이 그날 기록을 지우지 않게 하기 위함.
  const updateHistory = () => {
    const c = computeCounts();
    if (!c.done) return;
    const date = state.startedDate || todayKey();
    const prev = state.history.find((h) => h.date === date);
    if (prev) {
      if (c.done >= prev.done) { prev.done = c.done; prev.total = c.total; prev.sec = c.sec; }
    } else {
      state.history.push({ date, done: c.done, total: c.total, sec: c.sec });
    }
    if (state.history.length > 120) state.history = state.history.slice(-120);
  };
  const dateLabel = (key) => {
    const p = String(key).split("-").map(Number);
    if (p.length !== 3 || p.some(Number.isNaN)) return key;
    const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(p[0], p[1] - 1, p[2]).getDay()];
    return `${p[1]}/${p[2]} (${wd})`;
  };
  const renderHistory = () => {
    const el = document.getElementById("secHistory");
    el.classList.toggle("is-open", !!state.open.history);
    document.getElementById("historyHead").setAttribute("aria-expanded", String(!!state.open.history));
    document.getElementById("historyCount").textContent = `${state.history.length}일`;
    const body = document.getElementById("historyBody");
    if (!state.history.length) {
      body.innerHTML = `<div class="practice-empty">아직 기록이 없어요 — 체크하면 날짜별로 자동 저장됩니다.</div>`;
      return;
    }
    const cur = state.startedDate || todayKey();
    body.innerHTML = state.history.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((h) => {
      const pct = h.total ? Math.round((h.done / h.total) * 100) : 0;
      const badge = h.date === todayKey()
        ? `<span class="practice-badge">오늘</span>`
        : h.date === cur ? `<span class="practice-badge">진행 중</span>` : "";
      return `<div class="practice-hrow">
        <div class="practice-hdate">${esc(dateLabel(h.date))}${badge}</div>
        <div class="practice-hbar"><i style="width:${pct}%"></i></div>
        <div class="practice-hcount">${h.done}/${h.total} · ${pct}%</div>
      </div>`;
    }).join("");
  };

  // ── 항목 편집 ──
  const findAdded = (id) => {
    for (const k in state.edits.added) {
      const it = state.edits.added[k].find((x) => x.id === id);
      if (it) return it;
    }
    return null;
  };
  const addItem = (groupKey) => {
    const input = prompt("추가할 항목 내용을 입력하세요");
    if (input === null) return;
    const text = input.trim();
    if (!text) return;
    if (!state.edits.added[groupKey]) state.edits.added[groupKey] = [];
    state.edits.added[groupKey].push({ id: `u${state.nextItemId++}`, text });
    renderSections(); refresh(); save();
  };
  const editItem = (id) => {
    const isDefault = DEFAULT_TEXT[id] !== undefined;
    const current = isDefault
      ? (state.edits.text[id] !== undefined ? state.edits.text[id] : DEFAULT_TEXT[id])
      : (findAdded(id) || {}).text;
    if (current === undefined) return;
    const input = prompt("항목 내용을 수정하세요", current);
    if (input === null) return;
    const text = input.trim();
    if (!text) return;
    if (isDefault) {
      if (text === DEFAULT_TEXT[id]) delete state.edits.text[id];
      else state.edits.text[id] = text;
    } else {
      const it = findAdded(id);
      if (it) it.text = text;
    }
    renderSections(); refresh(); save();
  };
  const removeItem = (id) => {
    if (DEFAULT_TEXT[id] !== undefined) {
      state.edits.removed[id] = true;
    } else {
      for (const k in state.edits.added) {
        const i = state.edits.added[k].findIndex((x) => x.id === id);
        if (i >= 0) { state.edits.added[k].splice(i, 1); break; }
      }
    }
    delete state.checked[id];
    renderSections(); refresh(); save();
  };
  const setEditMode = (on) => {
    editMode = on;
    document.getElementById("editBtn").textContent = on ? "완료" : "편집";
    document.getElementById("restoreBtn").hidden = !on;
    document.getElementById("resetBtn").hidden = on;
    renderSections(); refresh();
    if (on) toast("항목을 눌러 수정하고, ✕로 삭제할 수 있어요");
  };

  // ── 보기 전환 ──
  const setView = (view) => {
    const next = view === "guide" ? "guide" : "checklist";
    state.view = next;
    document.getElementById("viewChecklist").hidden = next !== "checklist";
    document.getElementById("viewGuide").hidden = next !== "guide";
    document.querySelectorAll(".practice-tabs button").forEach((b) => {
      const on = b.dataset.view === next;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    });
  };

  let toastTimer;
  function toast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-show"), 1800);
  }

  function save() {
    try {
      updateHistory();
      renderHistory();
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* 저장 불가(프라이빗 모드 등) — 화면 동작은 유지 */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state = Object.assign(state, JSON.parse(raw));
    } catch (e) { /* 첫 실행 또는 손상된 저장값 */ }
    if (!Array.isArray(state.history)) state.history = [];
    if (!state.edits || typeof state.edits !== "object") state.edits = {};
    if (!state.edits.removed) state.edits.removed = {};
    if (!state.edits.text) state.edits.text = {};
    if (!state.edits.added) state.edits.added = {};
    if (!(state.nextItemId >= 1)) state.nextItemId = 1;
    for (const k in state.edits.added) {
      state.edits.added[k].forEach((it) => {
        const m = /^u(\d+)$/.exec(it.id);
        if (m && Number(m[1]) >= state.nextItemId) state.nextItemId = Number(m[1]) + 1;
      });
    }
  }

  root.addEventListener("change", (e) => {
    const box = e.target.closest("input[type=checkbox]");
    if (!box) return;
    state.checked[box.dataset.id] = box.checked;
    if (!box.checked) delete state.checked[box.dataset.id];
    refresh(); save();
  });
  root.addEventListener("click", (e) => {
    const head = e.target.closest("[data-sec]");
    if (head) {
      const id = head.dataset.sec;
      state.open[id] = !state.open[id];
      refresh(); save(); return;
    }
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      navigator.clipboard.writeText(copy.dataset.copy)
        .then(() => toast("템플릿을 복사했어요"))
        .catch(() => toast("복사에 실패했어요 — 길게 눌러 복사해 주세요"));
      return;
    }
    const add = e.target.closest("[data-add]");
    if (add) { addItem(add.dataset.add); return; }
    const ed = e.target.closest("[data-edit]");
    if (ed) { editItem(ed.dataset.edit); return; }
    const del = e.target.closest("[data-del]");
    if (del) { removeItem(del.dataset.del); }
  });

  document.getElementById("historyHead").addEventListener("click", () => {
    state.open.history = !state.open.history;
    renderHistory(); save();
  });
  document.getElementById("editBtn").addEventListener("click", () => setEditMode(!editMode));
  document.getElementById("restoreBtn").addEventListener("click", () => {
    if (!confirm("삭제하거나 문구를 수정한 기본 항목을 모두 되돌릴까요?\n(직접 추가한 항목은 그대로 유지됩니다)")) return;
    state.edits.removed = {};
    state.edits.text = {};
    renderSections(); refresh(); save();
    toast("기본 항목을 복원했어요");
  });
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!confirm("체크를 모두 지우고 새 하루를 시작할까요?")) return;
    const now = new Date();
    state.checked = {};
    state.startedAt = `${now.getMonth() + 1}/${now.getDate()}`;
    state.startedDate = todayKey();
    state.open = { morning: true, history: state.open.history };
    refresh(); save();
    toast("새 하루를 시작했어요 🌅");
    window.scrollTo({ top: 0 });
  });
  document.querySelectorAll(".practice-tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      setView(b.dataset.view);
      const url = new URL(location.href);
      if (b.dataset.view === "guide") url.searchParams.set("tab", "guide");
      else url.searchParams.delete("tab");
      history.replaceState(null, "", url);
      save();
    });
  });

  load();
  renderSections();
  setView(new URLSearchParams(location.search).get("tab") || state.view);
  refresh();
})();
