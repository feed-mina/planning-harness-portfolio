// 분석설계페이지 — 분석-only/회의록 기반 흐름 + Mermaid 연동 + 자료 준비 게이트 + AI 요약/아이디어/플랜 + PDF.
(() => {
  "use strict";
  function bootAnalysis() {
  const $ = (id) => document.getElementById(id);
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const REPORT_FONT_STACK = '"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans CJK KR","Noto Sans KR",Arial,sans-serif';
  const REPORT_NOTE = "기획 하네스 루프 · 모든 자동 산출물은 원본과 출처를 함께 검증해야 합니다.";

  /* ---------- 아코디언 ---------- */
  function setActiveFlow(n) {
    const key = String(n).toLowerCase();
    document.querySelectorAll("[data-flow-step]").forEach((step) => {
      step.classList.toggle("is-active", String(step.dataset.flowStep).toLowerCase() === key);
    });
  }
  function setFlowDone(n, done) {
    const step = document.querySelector(`[data-flow-step="${CSS.escape(String(n).toLowerCase())}"]`);
    if (step) step.classList.toggle("is-done", !!done);
  }
  function setFlowLocked(n, locked) {
    const step = document.querySelector(`[data-flow-step="${CSS.escape(String(n).toLowerCase())}"]`);
    if (step) step.classList.toggle("is-locked", !!locked);
  }
  function markStepDone(n) {
    const card = $(`card-${n}`);
    if (card) card.classList.add("done");
    setFlowDone(n, true);
  }
  function openCard(n, scroll) {
    const card = $(`card-${n}`);
    if (!card) return;
    card.classList.add("open");
    setActiveFlow(n);
    const head = card.querySelector(".acc-head");
    if (head) head.setAttribute("aria-expanded", "true");
    if (scroll) {
      card.classList.add("flash");
      setTimeout(() => card.classList.remove("flash"), 1000);
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  document.querySelectorAll(".acc-head").forEach((head) => {
    head.addEventListener("click", () => {
      const card = head.closest(".acc");
      const open = card.classList.toggle("open");
      head.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) setActiveFlow(card.dataset.card);
    });
  });

  /* ---------- 흐름도 버튼 → 카드 열기 ---------- */
  window.openStep = (nodeId) => {
    const key = String(nodeId).replace(/^S/i, "").toLowerCase();
    if (key) openCard(key, true);
  };
  document.querySelectorAll("[data-flow-step]").forEach((step) => {
    step.addEventListener("click", () => openCard(step.dataset.flowStep, true));
  });

  /* ---------- 1~2. 녹음텍스트 입력/보기 ---------- */
  const transcript = $("transcript"), dateEl = $("meetingDate"), timeEl = $("meetingTime"),
    attendees = $("attendees"), subject = $("subject"), genStatus = $("genStatus"), pageStatus = $("pageStatus");
  dateEl.value = todayISO();
  const status = (msg, err) => {
    genStatus.textContent = msg; genStatus.classList.toggle("danger", !!err);
    if (pageStatus) { pageStatus.textContent = msg; pageStatus.classList.toggle("danger", !!err); }
  };
  let sttClientLoadPromise = null;

  function ensureSttClient() {
    if (window.transcribeClovaAudio) return Promise.resolve(true);
    if (sttClientLoadPromise) return sttClientLoadPromise;
    sttClientLoadPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = `/assets/stt-client.js?v=${Date.now()}`;
      script.async = true;
      script.onload = () => resolve(!!window.transcribeClovaAudio);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
    return sttClientLoadPromise;
  }
  const startAnalysis = $("btnStartAnalysis"), startMeeting = $("btnStartMeeting");
  if (startAnalysis) startAnalysis.addEventListener("click", () => openCard(5, true));
  if (startMeeting) startMeeting.addEventListener("click", () => showMeetingPicker(true));
  const meetingPicker = $("meetingPicker"), meetingPickList = $("meetingPickList"), meetingPickStatus = $("meetingPickStatus");
  let meetingsLoaded = false;
  let selectedMeetingId = null;

  function meetingStatus(msg, err) {
    if (!meetingPickStatus) return;
    meetingPickStatus.innerHTML = msg;
    meetingPickStatus.classList.toggle("danger", !!err);
  }

  function meetingDateText(item) {
    return [item.date, item.created_at ? `생성 ${String(item.created_at).slice(0, 10)}` : ""].filter(Boolean).join(" · ") || "-";
  }

  function renderMeetingChoices(meetings) {
    if (!meetingPickList) return;
    if (!meetings.length) {
      meetingPickList.innerHTML = '<p class="hint">저장된 회의록이 없습니다. 새 회의록을 작성하거나 분석만 시작하세요.</p>';
      return;
    }
    meetingPickList.innerHTML = meetings.map((item) => `
      <article class="meeting-pick-item">
        <div>
          <div class="meeting-pick-title">${esc(item.title || "회의록")}</div>
          <div class="meeting-pick-meta">${esc(meetingDateText(item))}</div>
        </div>
        <button class="btn btn-primary btn-small" type="button" data-meeting-pick="${esc(item.id)}">이 회의록으로 분석</button>
      </article>`).join("");
  }

  async function loadMeetingChoices(force) {
    if (!meetingPicker || (!force && meetingsLoaded)) return;
    meetingStatus("회의록 목록을 불러오는 중...");
    meetingPickList.innerHTML = "";
    try {
      const res = await window.apiFetch("/api/meetings?limit=200");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          meetingStatus('기존 회의록을 불러오려면 <a href="/api/auth/github">GitHub 로그인</a>이 필요합니다.', true);
          return;
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      meetingsLoaded = true;
      const meetings = data.meetings || [];
      renderMeetingChoices(meetings);
      meetingStatus(meetings.length ? `저장된 회의록 ${meetings.length}개` : "저장된 회의록이 없습니다.");
    } catch (err) {
      meetingStatus("회의록 목록 로드 실패: " + err.message, true);
    }
  }

  function showMeetingPicker(load) {
    if (!meetingPicker) return;
    meetingPicker.hidden = false;
    meetingPicker.scrollIntoView({ behavior: "smooth", block: "start" });
    if (load) loadMeetingChoices(false);
  }

  function fillAnalysisFromMeeting(meeting) {
    selectedMeetingId = meeting.id || null;
    const title = String(meeting.title || "").trim();
    const date = String(meeting.date || "").trim();
    markdown.value = String(meeting.markdown || "").trim() + "\n";
    if (date) dateEl.value = date;
    if (title && !subject.value.trim()) subject.value = title;
    if (title && !projectName.value.trim()) projectName.value = title;
    if (title && !analysisTopic.value.trim()) analysisTopic.value = title;
    fname.textContent = `${date || dateEl.value || todayISO()}_meeting.md`;
    setView(false);
    markStepDone(4);
    prepLocalStatus("회의록 참고자료가 연결되었습니다. 분석파일을 추가하거나 자료 준비 완료를 체크해 다음 단계로 진행하세요.", false);
    status(`✅ 회의록을 가져왔습니다: ${title || "회의록"}`);
    openCard(5, true);
  }

  async function pickMeeting(id, button) {
    if (!id) return;
    const original = button?.textContent;
    if (button) { button.disabled = true; button.textContent = "불러오는 중..."; }
    meetingStatus("회의록 본문을 불러오는 중...");
    try {
      const res = await window.apiFetch(`/api/meetings/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      fillAnalysisFromMeeting(data);
      if (analysisSessionId) {
        await window.apiFetch(`/api/analysis/sessions/${encodeURIComponent(analysisSessionId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(analysisContext()),
        }).catch(() => {});
      }
      meetingStatus(`선택됨: ${esc(data.title || "회의록")}`);
    } catch (err) {
      meetingStatus("회의록 불러오기 실패: " + err.message, true);
    } finally {
      if (button) { button.disabled = false; button.textContent = original || "이 회의록으로 분석"; }
    }
  }

  $("btnReloadMeetings")?.addEventListener("click", () => loadMeetingChoices(true));
  $("btnNewMeetingFlow")?.addEventListener("click", () => openCard(1, true));
  meetingPickList?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-meeting-pick]");
    if (btn) pickMeeting(btn.dataset.meetingPick, btn);
  });
  const examples = {
    generic: {
      projectName: "범용 프로젝트 분석",
      analysisTopic: "업로드한 자료에서 핵심 쟁점과 다음 실행안을 빠르게 도출",
      outputGoal: "1분 요약보드, 주요 근거 목록, 실행 체크리스트",
      decisionCriteria: "원본 파일에 근거가 있는 내용만 사용하고 추정은 확인 필요로 분리",
      etcNote: "프로젝트 종류와 파일 형식에 상관없이 전체 자료의 구조를 먼저 파악하고, 중요한 수치·문장·의사결정 포인트를 분리하고 싶다.",
    },
    hydro: {
      projectName: "수문조사 분석 테스트",
      analysisTopic: "수문조사 사업 자료에서 조사 단위, 인원, 시간, 비용 구조 파악",
      outputGoal: "1개 강/수문 조사 단위당 인원·시간·비용의 단순 산식 후보와 검증표",
      decisionCriteria: "지점 수·조사 단위·단가처럼 원본에서 확인되는 feature만 사용",
      etcNote: "수문분석은 예시 테스트다. 처음에는 복잡한 회귀보다 지점 수 또는 조사 단위 수 하나만 쓰는 heuristic 산식으로 시작하고, 오차와 확인 필요 항목을 명시해 달라.",
    },
    cost: {
      projectName: "원가분석 테스트",
      analysisTopic: "예산/단가/회계 자료에서 큰 금액 흐름과 근거 셀 파악",
      outputGoal: "1분 요약보드, 10분 상세 HTML 리포트 초안, 확인 필요 금액 목록",
      decisionCriteria: "모든 수치는 파일·시트·셀 출처를 보존하고 법령/근거가 불명확하면 추정하지 않음",
      etcNote: "원가분석은 예시 테스트다. 예산 카테고리가 많아 전체 파악이 어렵기 때문에 상위 금액, 반복 단가, 근거 셀, 확인 필요 법령/기준을 분리해 달라.",
    },
  };
  document.querySelectorAll("[data-example]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = examples[btn.dataset.example];
      if (!preset) return;
      $("projectName").value = preset.projectName;
      $("analysisTopic").value = preset.analysisTopic;
      $("outputGoal").value = preset.outputGoal;
      $("decisionCriteria").value = preset.decisionCriteria;
      $("etcNote").value = preset.etcNote;
      if (!subject.value) subject.value = preset.analysisTopic;
      status(`예시 테스트 입력을 채웠습니다: ${preset.projectName}`);
      openCard(5, true);
    });
  });

  function parseSubtitle(text, name) {
    if ((name || "").toLowerCase().endsWith(".txt")) return cleanup(text.split(/\r?\n/));
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || /^WEBVTT/i.test(line) || /^NOTE\b/i.test(line) || /-->/.test(line)
        || /^\d+$/.test(line) || /^(STYLE|REGION)\b/i.test(line)) continue;
      const t = line.replace(/<v\s+([^>]+)>/gi, "$1: ").replace(/<\/v>/gi, "").replace(/<[^>]+>/g, "").trim();
      if (t) out.push(t);
    }
    return cleanup(out);
  }
  function cleanup(arr) {
    const out = []; let prev = "";
    for (const l of arr) { const t = l.trim(); if (t && t !== prev) { out.push(t); prev = t; } }
    return out.join("\n");
  }
  const dropzone = $("dropzone"), fileInput = $("fileInput");
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
  ["dragover", "dragenter"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove("drag")));
  dropzone.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  async function handleFile(file) {
    const name = file.name.toLowerCase();
    if (/\.(vtt|srt|txt)$/.test(name) || file.type.startsWith("text")) {
      transcript.value = parseSubtitle(await file.text(), name);
      status(`📄 '${file.name}' 자막을 불러왔습니다.`); openCard(2);
    } else {
      if (window.transcribeClovaAudio || await ensureSttClient()) {
        if (await window.transcribeClovaAudio(file, { transcript, status })) openCard(2);
        return;
      }
      status("🎧 오디오 전사는 준비 중입니다. 자막(.vtt/.srt) 또는 실시간 녹음을 이용하세요.", true);
    }
  }

  // Web Speech 실시간 녹음
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recStart = $("btnRecStart"), recStop = $("btnRecStop"), timer = $("timer"), recDot = $("recDot"), speechSupport = $("speechSupport");
  let recog = null, recording = false, tSec = 0, tInt = null;
  if (!SR) { recStart.disabled = true; speechSupport.textContent = "이 브라우저는 실시간 음성인식 미지원(Chrome/Edge 권장). 자막 파일은 사용 가능."; }
  const fmt = (s) => `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  recStart.addEventListener("click", () => {
    if (!SR || recording) return;
    recog = new SR(); recog.lang = "ko-KR"; recog.continuous = true; recog.interimResults = true;
    let finals = transcript.value ? transcript.value + "\n" : "";
    recog.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]; if (r.isFinal) finals += r[0].transcript.trim() + "\n"; else interim += r[0].transcript;
      }
      transcript.value = finals + interim;
    };
    recog.onend = () => { if (recording) recog.start(); };
    recording = true; recog.start(); tSec = 0; timer.textContent = "00:00";
    tInt = setInterval(() => { timer.textContent = fmt(++tSec); }, 1000);
    recStart.disabled = true; recStop.disabled = false; recDot.hidden = false; status("🎙️ 녹음 중…");
  });
  recStop.addEventListener("click", () => {
    recording = false; if (recog) recog.stop(); clearInterval(tInt);
    recStart.disabled = false; recStop.disabled = true; recDot.hidden = true; status("⏹️ 녹음 종료. 3번에서 회의록으로 변환하세요.");
  });

  /* ---------- 3. 회의록 변환 (서버 프록시, 마이페이지 단계별 설정 사용) ---------- */

  const markdown = $("markdown"), mdPreview = $("mdPreview"), fname = $("fname");
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const attr = (s) => esc(s).replace(/"/g, "&quot;");
  function renderMarkdown(md) {
    const lines = esc(md).split(/\r?\n/); let html = "", inList = false, cls = "";
    const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
    const openList = (c) => { if (!inList || cls !== c) { closeList(); html += `<ul${c ? ` class="${c}"` : ""}>`; inList = true; cls = c; } };
    for (const raw of lines) {
      const line = raw.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
      let m;
      if (/^#\s+/.test(line)) { closeList(); html += `<div class="mp-h1">${line.replace(/^#\s+/, "")}</div>`; }
      else if (/^##\s+/.test(line)) { closeList(); html += `<div class="mp-h2">${line.replace(/^##\s+/, "")}</div>`; }
      else if (/^###\s+/.test(line)) { closeList(); html += `<h4>${line.replace(/^###\s+/, "")}</h4>`; }
      else if ((m = line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/))) {
        openList("mp-tasks"); const done = m[1].toLowerCase() === "x";
        html += `<li class="${done ? "done" : ""}"><input type="checkbox" disabled ${done ? "checked" : ""}><span>${m[2]}</span></li>`;
      } else if ((m = line.match(/^[-*]\s+(.*)$/))) { openList(""); html += `<li>${m[1]}</li>`; }
      else if (line.trim() === "") { closeList(); }
      else { closeList(); html += `<p>${line}</p>`; }
    }
    closeList(); return html;
  }
  const updatePreview = () => { mdPreview.innerHTML = renderMarkdown(markdown.value); };
  function setView(edit) {
    markdown.hidden = !edit; mdPreview.hidden = edit;
    $("tabEdit").classList.toggle("active", edit); $("tabPreview").classList.toggle("active", !edit);
    if (!edit) updatePreview();
  }
  $("tabEdit").addEventListener("click", () => setView(true));
  $("tabPreview").addEventListener("click", () => setView(false));
  markdown.addEventListener("input", updatePreview);
  function download() {
    const blob = new Blob(["\uFEFF", markdown.value], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${dateEl.value || todayISO()}_meeting.md`;
    a.click(); URL.revokeObjectURL(a.href);
  }
  $("btnDownload").addEventListener("click", download);
  $("btnCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(markdown.value); status("📋 복사했습니다."); }
    catch { status("복사 실패 — 직접 선택해 복사하세요.", true); }
  });

  $("btnAI").addEventListener("click", async () => {
    const text = transcript.value.trim();
    if (!text) { status("먼저 자막을 불러오거나 녹음하세요.", true); openCard(1, true); return; }
    if (!dateEl.value) { status("회의 날짜는 필수입니다.", true); dateEl.focus(); return; }
    const btn = $("btnAI"); btn.disabled = true; status("🤖 AI 요약 중…");
    try {
      const res = await window.apiFetch("/api/ai/summarize", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcript: text, date: dateEl.value, time: timeEl.value,
          attendees: attendees.value, subject: subject.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      markdown.value = data.markdown.trim() + "\n";
      fname.textContent = `${dateEl.value || todayISO()}_meeting.md`;
      setView(false);
      if (window.refreshUsage) window.refreshUsage();
      const cost = data.cost_krw != null ? ` · ${data.cost_krw.toFixed(2)}원` : "";
      status(`✅ 회의록 생성 완료 (${data.provider}/${data.model})${cost}`);
      openCard(4, true);
    } catch (err) {
      status("❌ 실패: " + (window.apiErrorMessage ? window.apiErrorMessage(err, "회의록 생성") : err.message), true);
    } finally { btn.disabled = false; }
  });

  /* ---------- 5. 프로젝트·자료 준비 (R2 업로드 + 게이트) ---------- */
  const analysisFiles = []; // { localId, id?, name, size, type, file?, costFile?, uploaded, textAvailable }
  let analysisSessionId = null;
  let analysisSummaries = [];
  let analysisQuestions = [];
  let analysisPlans = [];
  const projectName = $("projectName"), analysisTopic = $("analysisTopic"), outputGoal = $("outputGoal"), decisionCriteria = $("decisionCriteria");
  const fileListEl = $("analysisFileList"), fileEmpty = $("analysisFileEmpty"), prepStatus = $("prepStatus");
  const analysisDrop = $("analysisDrop"), analysisFileInput = $("analysisFileInput");
  const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

  function prepLocalStatus(msg, err) {
    if (!prepStatus) return;
    prepStatus.hidden = !msg;
    prepStatus.textContent = msg || "";
    prepStatus.classList.toggle("danger", !!err);
  }

  function fallbackTextExtractReason(file) {
    const name = String(file.name || "").toLowerCase();
    const type = String(file.type || "").toLowerCase();
    if (name.endsWith(".pdf") || type.includes("pdf")) return "PDF에서 텍스트를 추출하지 못했습니다(스캔 이미지이거나 파싱 실패). 파일명·메모만 참고됩니다.";
    if (/\.(xlsx|xls|csv)$/.test(name) || type.includes("spreadsheet") || type.includes("excel") || type.includes("csv"))
      return "엑셀에서 텍스트를 추출하지 못했습니다(파싱 실패). 파일명·메모만 참고됩니다.";
    return "이 파일 형식은 서버 텍스트 발췌 대상이 아닙니다.";
  }

  function textExtractionState(file) {
    if (!file.uploaded) return { label: "업로드 대기", reason: "", title: "" };
    if (file.textAvailable) {
      return {
        label: file.truncatedNote ? "R2 저장 · 발췌본" : "R2 저장 · 텍스트 분석 가능",
        reason: file.truncatedNote || "",
        title: file.truncatedNote || "서버가 텍스트 발췌를 만들어 AI 요약에 사용할 수 있습니다.",
      };
    }
    const reason = file.textExtractReason || fallbackTextExtractReason(file);
    return { label: "R2 저장 · 텍스트 추출 불가", reason, title: reason };
  }

  function combinedAnalysisNote() {
    const lines = [];
    if (outputGoal.value.trim()) lines.push(`기대 산출물: ${outputGoal.value.trim()}`);
    if (decisionCriteria.value.trim()) lines.push(`의사결정 기준: ${decisionCriteria.value.trim()}`);
    if ($("etcNote").value.trim()) lines.push(`메모: ${$("etcNote").value.trim()}`);
    return lines.join("\n");
  }

  function analysisContext(extra) {
    return {
      title: projectName.value,
      date: dateEl.value,
      subject: analysisTopic.value || subject.value,
      meetingMarkdown: markdown.value,
      etcUrl: $("etcUrl").value,
      etcNote: combinedAnalysisNote(),
      ...(extra || {}),
    };
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function ensureAnalysisSession() {
    if (analysisSessionId) return analysisSessionId;
    const data = await postJSON("/api/analysis/sessions", analysisContext());
    analysisSessionId = data.id;
    return analysisSessionId;
  }

  // PDF/엑셀 텍스트 추출(브라우저) — 서버에 파서가 없으므로 클라이언트에서 뽑아 text_excerpt 로 전달한다.
  const PDF_MAX_PAGES = 100, PDF_MAX_CHARS = 60000;
  const SHEET_MAX_ROWS = 120, SHEET_MAX_COLS = 24, SHEET_MAX_CHARS = 60000;
  function isPdf(name, type) {
    return /\.pdf$/i.test(String(name || "")) || /pdf/i.test(String(type || ""));
  }
  function isSpreadsheet(name, type) {
    return /\.(xlsx|xls|csv)$/i.test(String(name || "")) || /spreadsheet|excel|csv/i.test(String(type || ""));
  }
  async function parsePdfText(file) {
    if (!window.pdfjsLib) throw new Error("PDF 파서 로드 실패(pdf.js). 네트워크를 확인하세요.");
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js";
    }
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const parts = [];
    const maxPages = Math.min(pdf.numPages, PDF_MAX_PAGES);
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const text = content.items.map((it) => it.str || "").join(" ").replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
      if (parts.join("\n").length > PDF_MAX_CHARS) break;
    }
    return parts.join("\n").slice(0, PDF_MAX_CHARS).trim();
  }
  async function parseSpreadsheetText(file) {
    if (!window.XLSX) throw new Error("엑셀 파서 로드 실패(XLSX). 네트워크를 확인하세요.");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const parts = [];
    wb.SheetNames.forEach((sheetName) => {
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
      const lines = rows.slice(0, SHEET_MAX_ROWS).map((row) =>
        row.slice(0, SHEET_MAX_COLS).map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" | ")
      ).filter(Boolean);
      if (lines.length) parts.push(`[시트: ${sheetName}]\n${lines.join("\n")}`);
    });
    return parts.join("\n\n").slice(0, SHEET_MAX_CHARS).trim();
  }

  // 서버 한도(파일 6MB / 요청 15MB)를 넘기지 않도록 파일별 전송 형태와 요청 묶음을 미리 정한다.
  const uploadPolicy = window.AnalysisUploadPolicy;

  async function clientExtractedText(f) {
    if (isPdf(f.name, f.type)) {
      try { return await parsePdfText(f.file); }
      catch (err) { console.warn("PDF 파싱 실패:", f.name, err); }
    } else if (isSpreadsheet(f.name, f.type)) {
      try { return await parseSpreadsheetText(f.file); }
      catch (err) { console.warn("엑셀 파싱 실패:", f.name, err); }
    }
    return null;
  }

  // 전송할 Blob + 서버가 text_excerpt 로 쓸 클라이언트 추출 텍스트를 만든다.
  async function uploadPayload(f, entry) {
    // 앞부분만 보내는 텍스트 파일은 서버가 원본 바이트에서 발췌를 만들므로 클라이언트 파싱이 필요 없다.
    const text = entry.action === "text_head" ? null : await clientExtractedText(f);
    if (entry.action === "text_head") {
      const head = f.file.slice(0, uploadPolicy.TEXT_HEAD_BYTES);
      const marker = `\n\n[잘림: 원본 ${f.name} ${uploadPolicy.fmtBytes(f.size)} 중 앞부분만 등록]\n`;
      return { blob: new Blob([head, marker], { type: f.type || "text/plain" }), name: f.name, text };
    }
    if (entry.action === "client_excerpt") {
      if (!text) {
        throw new Error(`${f.name}: ${uploadPolicy.fmtBytes(f.size)} 파일이라 원본을 등록할 수 없는데 텍스트 추출도 실패했습니다. 필요한 페이지·시트만 남겨 다시 올려주세요.`);
      }
      return { blob: new Blob([text], { type: "text/plain" }), name: `${f.name}.excerpt.txt`, text };
    }
    return { blob: f.file, name: f.name, text };
  }

  async function uploadFileBatch(sessionId, batch) {
    const form = new FormData();
    // client_texts[i] 는 files[i] 와 순서를 맞춰 전송(서버가 비텍스트 파일의 text_excerpt 로 사용).
    const clientTexts = [];
    for (const entry of batch) {
      const payload = await uploadPayload(entry.file, entry);
      form.append("files", payload.blob, payload.name);
      clientTexts.push(payload.text || null);
    }
    form.append("client_texts", JSON.stringify(clientTexts));
    const res = await window.apiFetch(`/api/analysis/sessions/${sessionId}/files`, { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 413 은 엣지에서 잘려 본문이 비어 오기도 하므로 상태 코드만으로도 설명 가능한 문구를 만든다.
      const reason = data.error
        || (res.status === 413 ? `요청이 서버 한도(${uploadPolicy.fmtBytes(uploadPolicy.LIMITS.maxUploadBytes)})를 넘었습니다. 파일을 나눠 등록해 주세요.` : `HTTP ${res.status}`);
      throw new Error(reason);
    }
    (data.files || []).forEach((saved, i) => {
      const target = batch[i]?.file;
      if (!target) return;
      target.id = saved.id;
      target.uploaded = true;
      target.textAvailable = !!saved.text_available;
      target.textExtractReason = saved.text_extract_reason || batch[i].note || "";
      target.truncatedNote = batch[i].note || "";
      target.file = null;
    });
  }

  async function uploadPendingFiles() {
    const pending = analysisFiles.filter((f) => !f.uploaded && f.file);
    if (!pending.length) return;
    const uploadedCount = analysisFiles.length - pending.length;
    if (!uploadPolicy) throw new Error("업로드 정책 스크립트(analysis-upload-policy.js)를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.");
    const plan = uploadPolicy.planUpload(pending, { alreadyUploaded: uploadedCount });
    if (plan.errors.length) throw new Error(plan.errors.join(" / "));

    const sessionId = await ensureAnalysisSession();
    for (const batch of plan.batches) {
      // 서버 한도를 넘지 않는 묶음 단위로 순차 전송한다(한 요청에 몰아 보내면 413).
      await uploadFileBatch(sessionId, batch.map((entry) => ({ ...entry, file: pending[entry.index] })));
      renderFileList();
    }
    const truncated = plan.accepted.filter((entry) => entry.action !== "keep");
    if (truncated.length) {
      status(`ℹ️ 용량이 큰 파일 ${truncated.length}개는 발췌본으로 등록했습니다: ${truncated.map((entry) => entry.name).join(", ")}`);
    }
    renderFileList();
  }

  async function ensureAnalysisReady() {
    if (!analysisFiles.length && !markdown.value.trim()) throw new Error("먼저 5번에서 분석파일을 등록하거나 회의록을 선택하세요.");
    await ensureAnalysisSession();
    await uploadPendingFiles();
  }

  function renderFileList() {
    fileListEl.innerHTML = "";
    analysisFiles.forEach((f, i) => {
      const li = document.createElement("li");
      const state = textExtractionState(f);
      const reason = state.reason ? `<span class="fl-reason">${esc(state.reason)}</span>` : "";
      li.innerHTML = `<span class="fl-main"><span class="fl-name"></span>${reason}</span><span class="fl-size">${fmtSize(f.size)}</span>` +
        `<span class="fl-state" title="${attr(state.title)}">${esc(state.label)}</span><button class="btn btn-ghost btn-small" data-rm="${i}">빼기</button>`;
      li.querySelector(".fl-name").textContent = f.name;
      fileListEl.appendChild(li);
    });
    fileEmpty.hidden = analysisFiles.length > 0;
  }
  fileListEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-rm]");
    if (!btn) return;
    const idx = Number(btn.dataset.rm);
    const file = analysisFiles[idx];
    btn.disabled = true;
    try {
      if (file?.uploaded && analysisSessionId && file.id) {
        const res = await window.apiFetch(`/api/analysis/sessions/${analysisSessionId}/files/${file.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      }
      analysisFiles.splice(idx, 1);
      if (file?.costFile) removeParsedCostFile(file.costFile);
      renderFileList();
    } catch (err) {
      status("❌ 파일 제거 실패: " + err.message, true);
      btn.disabled = false;
    }
  });
  analysisDrop.addEventListener("click", () => analysisFileInput.click());
  analysisDrop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") analysisFileInput.click(); });
  ["dragover", "dragenter"].forEach((ev) => analysisDrop.addEventListener(ev, (e) => { e.preventDefault(); analysisDrop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => analysisDrop.addEventListener(ev, () => analysisDrop.classList.remove("drag")));
  function addAnalysisFiles(files) {
    for (const file of files) {
      analysisFiles.push({
        localId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${analysisFiles.length}`,
        name: file.name || "analysis-file",
        size: file.size,
        type: file.type || "",
        file,
        costFile: isSpreadsheet(file.name, file.type) ? file : null,
        uploaded: false,
        textAvailable: false,
        textExtractReason: "",
      });
    }
    renderFileList();
    if ($("prepDone").checked) {
      prepLocalStatus("", false);
      uploadPendingFiles().then(async () => {
        const reused = await parseAnalysisCostFiles({ silentNoFiles: true });
        if (reused === null) status("☁️ 추가 파일은 R2에 저장됐지만 Excel 자동 반영은 실패했습니다.", true);
        else status(reused ? `☁️ 추가 파일을 R2에 저장했고, Excel ${reused}개를 6-A에 자동 반영했습니다.` : "☁️ 추가 파일을 R2에 저장했습니다.");
      }).catch((err) => {
        const msg = "업로드 실패: " + err.message;
        status("❌ " + msg, true);
        prepLocalStatus(msg, true);
      });
    }
  }
  analysisDrop.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files.length) addAnalysisFiles(e.dataTransfer.files); });
  analysisFileInput.addEventListener("change", (e) => { if (e.target.files.length) addAnalysisFiles(e.target.files); e.target.value = ""; });

  // 게이트: 5번 완료 체크 → 업로드 완료 후 6~9(+표/수치 6A/6B) 잠금 해제
  const GATED = [6, "6a", "6b", "6c", "6d", "6e", "6f", 7, 8, "8b", 9];
  function setGate(on) {
    $("card-5").classList.toggle("done", on);
    setFlowDone(5, on);
    GATED.forEach((n) => {
      const card = $(`card-${n}`);
      card.classList.toggle("locked", !on);
      setFlowLocked(n, !on);
      const lock = card.querySelector("[data-lock]");
      if (lock) lock.textContent = on ? "✅ 열림" : "🔒 5번 완료 필요";
    });
  }
  $("prepDone").addEventListener("change", async (e) => {
    const on = e.target.checked;
    if (!on) { setGate(false); prepLocalStatus("", false); return; }
    e.target.disabled = true;
    prepLocalStatus("", false);
    status("☁️ 프로젝트 자료를 R2에 저장하는 중…");
    try {
      await ensureAnalysisReady();
      setGate(true);
      const reused = await parseAnalysisCostFiles({ silentNoFiles: true });
      if (reused === null) status("🔓 프로젝트 자료 저장 완료. 6~9번 단계는 열렸지만 Excel 자동 반영은 실패했습니다.", true);
      else status(reused ? `🔓 프로젝트 자료 저장 완료. Excel ${reused}개를 6-A에 자동 반영했습니다.` : "🔓 프로젝트 자료 저장 완료. 6~9번 단계가 열렸습니다.");
      openCard(6, true);
    } catch (err) {
      e.target.checked = false;
      setGate(false);
      const msg = "프로젝트·자료 준비 실패: " + err.message;
      status("❌ " + msg, true);
      prepLocalStatus(msg, true);
    } finally {
      e.target.disabled = false;
    }
  });

  /* ---------- 6. 분석파일 요약 (AI) ---------- */
  function renderSummaries(summaries) {
    const list = $("summaryList");
    analysisSummaries = summaries || [];
    if (!analysisSummaries.length) {
      list.innerHTML = '<p class="hint danger">요약 결과가 없습니다.</p>';
      return;
    }
    list.innerHTML = analysisSummaries.map((item) => {
      const points = (item.key_points || []).length
        ? `<ul>${item.key_points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "";
      const sources = (item.sources || []).length
        ? `<div class="hint si-sources">근거: ${item.sources.map((source) => `<code>${esc(source)}</code>`).join(" ")}</div>` : "";
      return `<div class="summary-item" data-file-id="${attr(item.file_id)}"><div class="si-name">📄 ${esc(item.name)}</div>` +
        `<div class="si-text">${esc(item.summary)}</div>${points}${sources}</div>`;
    }).join("");
  }
  $("btnSummarize").addEventListener("click", async () => {
    const btn = $("btnSummarize"); btn.disabled = true;
    status("🤖 분석파일 요약 중…");
    try {
      await ensureAnalysisReady();
      const data = await postJSON(`/api/analysis/sessions/${analysisSessionId}/summaries`, analysisContext());
      renderSummaries(data.summaries);
      markStepDone(6);
      if (window.refreshUsage) window.refreshUsage();
      const cost = data.cost_krw != null ? ` · ${data.cost_krw.toFixed(2)}원` : "";
      status(`✅ 분석파일 요약 완료 (${data.provider}/${data.model})${cost}`);
      openCard(7, true);
    } catch (err) {
      $("summaryList").innerHTML = `<p class="hint danger">${esc(err.message)}</p>`;
      status("❌ 분석파일 요약 실패: " + err.message, true);
    } finally { btn.disabled = false; }
  });

  /* ---------- 7. 아이디어 도출 (AI 객관식 2~4개) ---------- */
  function renderIdeas(questions) {
    analysisQuestions = questions || [];
    const box = $("ideaQuestions");
    if (!analysisQuestions.length) {
      box.innerHTML = '<p class="hint danger">아이디어 질문 결과가 없습니다.</p>';
      return;
    }
    box.innerHTML = analysisQuestions.map((item, qi) => {
      const qid = item.id || `q${qi + 1}`;
      const opts = (item.options || []).map((o) =>
        `<li><label><input type="radio" name="idea-${attr(qid)}" value="${attr(o)}"><span>${esc(o)}</span></label></li>`).join("");
      const why = item.rationale ? `<p class="hint">${esc(item.rationale)}</p>` : "";
      return `<div class="mc-q">Q${qi + 1}. ${esc(item.question)}</div><ul class="opt-list">${opts}</ul>${why}`;
    }).join("");
  }
  $("btnIdeas").addEventListener("click", async () => {
    const btn = $("btnIdeas"); btn.disabled = true;
    status("🤖 아이디어 질문 생성 중…");
    try {
      await ensureAnalysisReady();
      const data = await postJSON(`/api/analysis/sessions/${analysisSessionId}/ideas`, analysisContext());
      renderIdeas(data.questions);
      markStepDone(7);
      if (window.refreshUsage) window.refreshUsage();
      const cost = data.cost_krw != null ? ` · ${data.cost_krw.toFixed(2)}원` : "";
      status(`✅ 아이디어 질문 생성 완료 (${data.provider}/${data.model})${cost}`);
      openCard(8, true);
    } catch (err) {
      $("ideaQuestions").innerHTML = `<p class="hint danger">${esc(err.message)}</p>`;
      status("❌ 아이디어 생성 실패: " + err.message, true);
    } finally { btn.disabled = false; }
  });

  /* ---------- 8. 분석 플랜 도출 (AI 체크박스 선택) ---------- */
  function selectedIdeaAnswers() {
    return analysisQuestions.map((item, qi) => {
      const qid = item.id || `q${qi + 1}`;
      const selected = document.querySelector(`input[name="idea-${CSS.escape(qid)}"]:checked`);
      return selected ? { question: item.question, answer: selected.value } : null;
    }).filter(Boolean);
  }
  function renderPlans(plans) {
    analysisPlans = plans || [];
    if (!analysisPlans.length) {
      $("planList").innerHTML = '<li class="hint danger">플랜 결과가 없습니다.</li>';
      return;
    }
    $("planList").innerHTML = analysisPlans.map((p, i) =>
      `<li><label><input type="checkbox" class="plan-chk" value="${attr(p.title)}" data-detail="${attr(p.detail || "")}" ${p.checked ? "checked" : ""}>` +
      `<span>${esc(p.title)}${p.detail ? `<small>${esc(p.detail)}</small>` : ""}</span></label></li>`).join("");
  }
  $("btnPlans").addEventListener("click", async () => {
    const btn = $("btnPlans"); btn.disabled = true;
    status("🤖 분석 플랜 생성 중…");
    try {
      await ensureAnalysisReady();
      const data = await postJSON(`/api/analysis/sessions/${analysisSessionId}/plans`, analysisContext({ answers: selectedIdeaAnswers() }));
      renderPlans(data.plans);
      markStepDone(8);
      if (window.refreshUsage) window.refreshUsage();
      const cost = data.cost_krw != null ? ` · ${data.cost_krw.toFixed(2)}원` : "";
      status(`✅ 분석 플랜 생성 완료 (${data.provider}/${data.model})${cost}`);
      openCard(9, true);
    } catch (err) {
      $("planList").innerHTML = `<li class="hint danger">${esc(err.message)}</li>`;
      status("❌ 플랜 생성 실패: " + err.message, true);
    } finally { btn.disabled = false; }
  });

  /* ---------- 8-B. 매뉴얼/메모 산출 ---------- */
  let lastManualHtml = "";
  function manualBody(m) {
    if (!m) return "";
    const purpose = m.purpose ? `<div class="callout">${esc(m.purpose)}</div>` : "";
    const meta = [];
    if (m.audience) meta.push(`<li><strong>대상:</strong> ${esc(m.audience)}</li>`);
    const metaHtml = meta.length ? `<ul>${meta.join("")}</ul>` : "";
    const prereq = (m.prerequisites || []).length
      ? `<h2>시작 전 확인</h2><ul class="check-list">${m.prerequisites.map((p) => `<li><span class="check-box" aria-hidden="true"></span>${esc(p)}</li>`).join("")}</ul>` : "";
    const steps = (m.steps || []).map((s, i) => {
      const actions = (s.actions || []).length ? `<ol>${s.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>` : "";
      const shot = s.screenshot_caption ? `<div class="shot"><strong>스크린샷 자리</strong><br>${esc(s.screenshot_caption)}</div>` : "";
      const warn = s.warning ? `<div class="warn"><strong>주의</strong> ${esc(s.warning)}</div>` : "";
      return `<h2>${i + 1}. ${esc(s.title)}</h2>${actions}${shot}${warn}`;
    }).join("");
    const checklist = (m.checklist || []).length
      ? `<h2>완료 확인 체크리스트</h2><ul class="check-list">${m.checklist.map((c) => `<li><span class="check-box" aria-hidden="true"></span>${esc(c)}</li>`).join("")}</ul>` : "";
    const faq = (m.faq || []).length
      ? `<h2>자주 묻는 질문</h2><table class="cost-table"><tr><th>질문</th><th>답변</th></tr>${m.faq.map((f) => `<tr><td>${esc(f.q)}</td><td>${esc(f.a)}</td></tr>`).join("")}</table>` : "";
    const note = m.note ? `<p class="muted"><strong>검토 메모</strong> ${esc(m.note)}</p>` : "";
    return `${purpose}${metaHtml}${prereq}${steps}${checklist}${faq}${note}`;
  }
  function renderManual(m) {
    const body = manualBody(m);
    if (!body) { $("manualArea").innerHTML = '<p class="hint danger">문서 결과가 없습니다.</p>'; return; }
    $("manualArea").innerHTML = `<div class="print-area manual-doc"><div class="mp-h1">${esc(m.title || "매뉴얼")}</div>${body}</div>`;
    lastManualHtml = fullHtml(m.title || "매뉴얼", body, m.note || "이 문서는 회의록 기반 초안입니다. 실제 정책과 대조 후 확정하세요.");
    $("btnManualHtml").disabled = false;
    $("btnManualPdf").disabled = false;
  }
  $("btnManual").addEventListener("click", async () => {
    const btn = $("btnManual"); btn.disabled = true;
    const docType = $("manualDocType")?.value === "memo" ? "memo" : "manual";
    status(`🤖 ${docType === "memo" ? "메모" : "매뉴얼"} 생성 중…`);
    try {
      await ensureAnalysisReady();
      const data = await postJSON(`/api/analysis/sessions/${analysisSessionId}/manual`, analysisContext({ docType }));
      renderManual(data);
      markStepDone("8b");
      if (window.refreshUsage) window.refreshUsage();
      const cost = data.cost_krw != null ? ` · ${data.cost_krw.toFixed(2)}원` : "";
      status(`✅ ${docType === "memo" ? "메모" : "매뉴얼"} 생성 완료 (${data.provider}/${data.model})${cost}`);
    } catch (err) {
      $("manualArea").innerHTML = `<p class="hint danger">${esc(err.message)}</p>`;
      status("❌ 매뉴얼 생성 실패: " + err.message, true);
    } finally { btn.disabled = false; }
  });
  $("btnManualHtml").addEventListener("click", () => {
    if (!lastManualHtml) return;
    const blob = new Blob(["﻿", lastManualHtml], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${dateEl.value || todayISO()}_manual.html`;
    a.click(); URL.revokeObjectURL(a.href);
  });
  $("btnManualPdf").addEventListener("click", () => {
    printHtmlReport(lastManualHtml, "매뉴얼 PDF");
  });

  /* ---------- 9. 결과 정리 & 내보내기 (PDF) ---------- */
  let lastResultHtml = "";
  function buildResult() {
    const files = analysisFiles.length
      ? `<ul>${analysisFiles.map((f) => `<li>${esc(f.name)} (${fmtSize(f.size)})</li>`).join("")}</ul>`
      : '<p class="hint">등록된 분석파일 없음</p>';

    const summaries = Array.from(document.querySelectorAll("#summaryList .summary-item")).map((it) => {
      const name = it.querySelector(".si-name")?.textContent || "";
      const txt = it.querySelector(".si-text")?.textContent || "";
      return `<li><strong>${esc(name)}</strong> — ${esc(txt)}</li>`;
    });
    const summaryHtml = summaries.length ? `<ul>${summaries.join("")}</ul>` : '<p class="hint">요약 없음 (6번에서 생성)</p>';

    const ideas = analysisQuestions.map((item, qi) => {
      const qid = item.id || `q${qi + 1}`;
      const sel = document.querySelector(`input[name="idea-${CSS.escape(qid)}"]:checked`);
      return sel ? `<li><strong>Q${qi + 1}. ${esc(item.question)}</strong><br>→ ${esc(sel.value)}</li>` : null;
    }).filter(Boolean);
    const ideaHtml = ideas.length ? `<ul>${ideas.join("")}</ul>` : '<p class="hint">선택한 아이디어 없음 (7번에서 선택)</p>';

    const plans = Array.from(document.querySelectorAll(".plan-chk:checked")).map((c) => {
      const detail = c.dataset.detail ? `<br><span class="hint">${esc(c.dataset.detail)}</span>` : "";
      return `<li>${esc(c.value)}${detail}</li>`;
    });
    const planHtml = plans.length ? `<ul>${plans.join("")}</ul>` : '<p class="hint">선택한 플랜 없음 (8번에서 선택)</p>';
    const boardContent = document.querySelector("#boardArea .board-print")?.innerHTML || '<p class="hint">1분 보드 없음 (6-B에서 생성)</p>';
    const heuristicHtml = lastHeuristic ? heuristicBody(lastHeuristic, false) : '<p class="hint">heuristic 산정 없음 (6-C에서 생성)</p>';
    const deepContent = document.querySelector("#deepReportArea .print-area")?.innerHTML || '<p class="hint">10분 상세 리포트 없음 (6-D에서 생성)</p>';
    const evidenceContent = document.querySelector("#evidenceArea .print-area")?.innerHTML || '<p class="hint">법령·근거 매핑 없음 (6-E에서 생성)</p>';
    const validationHtml = validationSummary?.length
      ? `<ul>${validationSummary.map((item) => `<li><strong>${esc(item.verdict)}</strong> — ${esc(item.title)} (${esc(item.value)})${item.note ? `<br><span class="hint">${esc(item.note)}</span>` : ""}</li>`).join("")}</ul>`
      : '<p class="hint">validation 요약 없음 (6-F에서 반영)</p>';

    const etcUrl = $("etcUrl").value.trim(), etcNote = combinedAnalysisNote();
    const scope = [
      projectName.value.trim() ? `<li>프로젝트명: ${esc(projectName.value.trim())}</li>` : "",
      (analysisTopic.value || subject.value).trim() ? `<li>분석 주제: ${esc((analysisTopic.value || subject.value).trim())}</li>` : "",
      outputGoal.value.trim() ? `<li>기대 산출물: ${esc(outputGoal.value.trim())}</li>` : "",
      decisionCriteria.value.trim() ? `<li>의사결정 기준: ${esc(decisionCriteria.value.trim())}</li>` : "",
    ].filter(Boolean).join("");
    const scopeHtml = scope ? `<ul>${scope}</ul>` : '<p class="hint">프로젝트 범위 입력 없음</p>';
    const etcHtml = (etcUrl || etcNote)
      ? `<ul>${etcUrl ? `<li>URL: ${esc(etcUrl)}</li>` : ""}${etcNote ? `<li>${esc(etcNote).replace(/\n/g, "<br>")}</li>` : ""}</ul>`
      : '<p class="hint">보충 입력 없음</p>';

    const topic = (analysisTopic.value || subject.value || "").trim();
    const title = `${dateEl.value || todayISO()} 분석설계 결과${topic ? " — " + topic : ""}`;
    const resultBody =
      `<h2>1. 프로젝트 범위</h2>${scopeHtml}` +
      `<h2>2. 분석파일</h2>${files}` +
      `<h2>3. 분석파일 요약</h2>${summaryHtml}` +
      `<h2>4. 1분 요약보드</h2>${boardContent}` +
      `<h2>5. 단위 수 × 단가 단순 산식(heuristic)</h2>${heuristicHtml}` +
      `<h2>6. 10분 상세 리포트</h2>${deepContent}` +
      `<h2>7. 법령·근거 매핑</h2>${evidenceContent}` +
      `<h2>8. Validation 요약</h2>${validationHtml}` +
      `<h2>9. 보충 입력</h2>${etcHtml}` +
      `<h2>10. 선택한 아이디어</h2>${ideaHtml}` +
      `<h2>11. 선택한 분석 플랜</h2>${planHtml}`;
    $("printArea").innerHTML = `<div class="mp-h1">${esc(title)}</div>${resultBody}`;
    lastResultHtml = fullHtml(title, resultBody, "PDF 저장 전 원본 근거와 수치를 함께 확인하세요.");
    $("btnPrint").disabled = false;
  }
  $("btnBuildResult").addEventListener("click", () => { buildResult(); markStepDone(9); status("🧾 결과 정리 완료 — ‘PDF로 인쇄’를 누르세요."); });
  $("btnPrint").addEventListener("click", () => {
    if (!lastResultHtml) buildResult();
    printHtmlReport(lastResultHtml, "분석설계 결과 PDF");
  });

  /* ---------- 6-A. 표·수치 정규화 & 근거 매핑 (클라이언트 xlsx 파싱) ---------- */
  // 단가는 특정 도메인 매직넘버가 아니라 데이터에서 추정한다(detectUnitPrice 참고).
  let costAll = []; // 모든 숫자 셀 { label, category, value, file, sheet, cell }
  let evidenceAll = []; // 법령/지침/품셈/단가표 등 문자 근거 후보 { type, text, file, sheet, cell }
  let evidenceLinks = [];
  let lastHeuristic = null;
  let lastHeuristicHtml = "";
  let lastDeepReportHtml = "";
  let validationItems = [];
  let validationSummary = null;
  const costDrop = $("costDrop"), costFileInput = $("costFileInput");
  const costTableWrap = $("costTableWrap"), costCount = $("costCount"), costMinValue = $("costMinValue");
  const fmtWon = (n) => Number(n).toLocaleString("ko-KR");
  const sourceOf = (r) => `${r.file} · ${r.sheet} · ${r.cell}`;
  const parsedCostFileKeys = new Set();

  function costFileKey(file) {
    return [file.name || "", file.size || 0, file.lastModified || 0].join("|");
  }

  function unparsedAnalysisCostFiles() {
    return analysisFiles
      .map((item) => item.costFile)
      .filter((file) => file && isSpreadsheet(file.name, file.type) && !parsedCostFileKeys.has(costFileKey(file)));
  }

  function removeParsedCostFile(file) {
    const key = costFileKey(file);
    if (!parsedCostFileKeys.has(key)) return;
    parsedCostFileKeys.delete(key);
    costAll = costAll.filter((row) => row.fileKey !== key);
    evidenceAll = evidenceAll.filter((row) => row.fileKey !== key);
    evidenceLinks = [];
    renderCostTable();
  }

  function categoryFor(text) {
    const s = String(text || "");
    if (/인건|노무|노임|인력|임금|급여/i.test(s)) return "인건비";
    if (/여비|교통|숙박|출장|운반/i.test(s)) return "여비·교통";
    if (/장비|기기|계측|측정|소프트웨어|SW|시스템/i.test(s)) return "장비·시스템";
    if (/용역|위탁|외주|조사|분석|검사|검정/i.test(s)) return "용역·조사";
    if (/간접|관리|제경비|일반관리|이윤|수수료/i.test(s)) return "간접비";
    if (/재료|소모|시약|부품|물품/i.test(s)) return "재료·소모품";
    if (/부가세|VAT|세금|예비|보험/i.test(s)) return "세금·예비";
    return "기타";
  }

  function evidenceType(text) {
    const s = String(text || "");
    if (/법|령|시행령|시행규칙|조례|규칙/i.test(s)) return "법령";
    if (/고시|공고|훈령|예규/i.test(s)) return "고시·예규";
    if (/지침|기준|준칙|규정|매뉴얼/i.test(s)) return "지침·기준";
    if (/품셈|노임|단가|원가|계산|요율/i.test(s)) return "품셈·단가";
    return "";
  }

  function reportStyles() {
    return `
      @page { size: A4; margin: 18mm 16mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; }
      body {
        color: #241f35;
        font-family: ${REPORT_FONT_STACK};
        font-size: 14px;
        line-height: 1.62;
        letter-spacing: 0;
        word-break: keep-all;
        overflow-wrap: anywhere;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .report-shell { max-width: 780px; margin: 0 auto; padding: 0; }
      h1 { color: #241f35; font-size: 25px; line-height: 1.28; margin: 0 0 22px; }
      h2 { color: #5b3fd6; font-size: 17px; line-height: 1.35; margin: 24px 0 8px; }
      h3, h4 { color: #2a2340; margin: 18px 0 8px; }
      h1, h2, h3, h4 { letter-spacing: 0; break-after: avoid; page-break-after: avoid; }
      p { margin: 8px 0 10px; }
      ol, ul { margin: 6px 0 12px; padding-left: 22px; }
      li { margin: 4px 0; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; margin: 8px 0 14px; }
      th, td { border-bottom: 1px solid #e7e3f2; padding: 8px 10px; text-align: left; vertical-align: top; word-break: break-word; overflow-wrap: anywhere; }
      th { position: static !important; background: #f2effb; color: #5b3fd6; font-weight: 800; }
      tr, .kpi, .callout, .warn, .shot { break-inside: avoid; page-break-inside: avoid; }
      .cost-table-wrap { max-height: none; overflow: visible; border: 0; }
      .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; white-space: normal; }
      .src { color: #8a8499; font-size: 12px; }
      .kpis, .board-kpis { display: flex; gap: 12px; flex-wrap: wrap; margin: 6px 0 8px; }
      .kpi { border: 1px solid #e7e3f2; border-radius: 8px; padding: 12px 14px; min-width: 128px; background: #fcfbff; }
      .kpi-v { font-size: 20px; font-weight: 800; color: #5b3fd6; }
      .kpi-l { color: #8a8499; font-size: 12px; }
      .callout { background: #eef2fb; border-radius: 8px; padding: 12px 14px; margin: 8px 0; }
      .warn { color: #9f2d22; background: #fdecea; border-radius: 8px; padding: 8px 12px; margin: 8px 0; }
      .shot { border: 1px dashed #b3b0c0; background: #f6f5fa; border-radius: 8px; padding: 16px; text-align: center; color: #6f697e; margin: 8px 0; }
      .muted, .hint, .report-note { color: #7d758f; font-size: 12px; }
      .check-list { list-style: none; padding-left: 0; }
      .check-list li { display: flex; gap: 8px; align-items: flex-start; }
      .check-box { flex: 0 0 auto; width: 12px; height: 12px; border: 1.5px solid #8a8499; border-radius: 2px; margin-top: 5px; }
      a { color: #4f35c9; overflow-wrap: anywhere; }
      @media print {
        .report-shell { max-width: none; }
        a { color: inherit; text-decoration: none; }
      }
    `;
  }

  function fullHtml(title, body, note) {
    const safeTitle = esc(title || "보고서");
    const safeNote = esc(note || REPORT_NOTE);
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${safeTitle}</title><style>${reportStyles()}</style></head><body>` +
      `<main class="report-shell"><h1>${safeTitle}</h1>${body}<p class="muted report-note">${safeNote}</p></main></body></html>`;
  }

  function printHtmlReport(html, title) {
    if (!html) return;
    const frame = document.createElement("iframe");
    frame.title = title || "PDF report";
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
      const cleanup = () => setTimeout(() => frame.remove(), 500);
      win.addEventListener("afterprint", cleanup, { once: true });
      win.requestAnimationFrame(() => {
        setTimeout(() => {
          win.focus();
          win.print();
          setTimeout(cleanup, 2000);
        }, 120);
      });
    };
    frame.srcdoc = html;
    status("PDF 저장 창을 열었습니다. 대상에서 PDF로 저장을 선택하세요.");
  }

  function nearestLabel(ws, r, c, range) {
    let rowLabel = "", colHeader = "";
    for (let cc = c - 1; cc >= range.s.c; cc--) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: cc })];
      if (cell && cell.t === "s" && String(cell.v).trim()) { rowLabel = String(cell.v).trim(); break; }
    }
    for (let rr = r - 1; rr >= range.s.r; rr--) {
      const cell = ws[XLSX.utils.encode_cell({ r: rr, c })];
      if (cell && cell.t === "s" && String(cell.v).trim()) { colHeader = String(cell.v).trim(); break; }
    }
    return [rowLabel, colHeader].filter(Boolean).join(" / ") || "(라벨 없음)";
  }

  async function parseCostFile(file) {
    const fileKey = costFileKey(file);
    if (parsedCostFileKeys.has(fileKey)) return false;
    if (!window.XLSX) throw new Error("엑셀 파서 로드 실패(XLSX). 네트워크를 확인하세요.");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const seenEvidence = new Set();
    const addEvidence = (type, text, sheet, cell) => {
      const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 240);
      if (!type || !clean) return;
      const key = `${file.name}|${sheet}|${cell}|${clean}`;
      if (seenEvidence.has(key)) return;
      seenEvidence.add(key);
      evidenceAll.push({ type, text: clean, file: file.name, sheet, cell, fileKey });
    };
    wb.SheetNames.forEach((sheet) => {
      const ws = wb.Sheets[sheet];
      if (!ws || !ws["!ref"]) return;
      addEvidence(evidenceType(`${file.name} ${sheet}`), `${file.name} / ${sheet}`, sheet, "시트명");
      const range = XLSX.utils.decode_range(ws["!ref"]);
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (!cell) continue;
          if (cell.t === "n" && typeof cell.v === "number" && isFinite(cell.v)) {
            const label = nearestLabel(ws, r, c, range);
            const basisText = `${label} ${file.name} ${sheet}`;
            costAll.push({ label, category: categoryFor(basisText), value: cell.v, file: file.name, sheet, cell: addr, fileKey });
          } else if (cell.v != null) {
            const text = String(cell.v);
            addEvidence(evidenceType(`${text} ${file.name} ${sheet}`), text, sheet, addr);
          }
        }
      }
    });
    parsedCostFileKeys.add(fileKey);
    return true;
  }

  const filteredRows = () => {
    const min = Number(costMinValue.value) || 0;
    return costAll.filter((r) => Math.abs(r.value) >= min).sort((a, b) => b.value - a.value);
  };

  function renderCostTable() {
    const rows = filteredRows();
    costCount.textContent = `추출된 항목: ${rows.length} (전체 숫자셀 ${costAll.length})`;
    if (!rows.length) { costTableWrap.innerHTML = '<p class="hint">표시할 항목이 없습니다. 파일을 등록하거나 최소 절대값을 낮추세요.</p>'; return; }
    const head = "<tr><th>카테고리</th><th>항목</th><th>값</th><th>출처(파일 · 시트 · 셀)</th></tr>";
    const body = rows.slice(0, 200).map((r) =>
      `<tr><td>${esc(r.category)}</td><td>${esc(r.label)}</td><td class="num">${fmtWon(r.value)}</td>` +
      `<td class="src">${esc(sourceOf(r))}</td></tr>`).join("");
    const more = rows.length > 200 ? `<p class="hint">상위 200개만 표시 (총 ${rows.length}개).</p>` : "";
    costTableWrap.innerHTML = `<table class="cost-table">${head}${body}</table>${more}`;
  }

  async function parseAnalysisCostFiles(options) {
    const files = unparsedAnalysisCostFiles();
    if (!files.length) {
      if (!options?.silentNoFiles) status("5번 분석파일에 새로 반영할 Excel 파일이 없습니다.");
      return 0;
    }
    status("📊 5번에 등록한 Excel 파일을 6-A 표·수치 정규화에 반영하는 중…");
    try {
      let parsed = 0;
      for (const file of files) {
        if (await parseCostFile(file)) parsed += 1;
      }
      renderCostTable();
      if (parsed) {
        markStepDone("6a");
        evidenceLinks = [];
      }
      return parsed;
    } catch (err) {
      status("❌ 5번 Excel 자동 반영 실패: " + err.message, true);
      return null;
    }
  }

  costDrop.addEventListener("click", () => costFileInput.click());
  costDrop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") costFileInput.click(); });
  ["dragover", "dragenter"].forEach((ev) => costDrop.addEventListener(ev, (e) => { e.preventDefault(); costDrop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => costDrop.addEventListener(ev, () => costDrop.classList.remove("drag")));
  async function handleCostFiles(files) {
    status("📊 표/수치 파일 파싱 중…");
    try {
      let parsed = 0;
      for (const f of files) {
        if (await parseCostFile(f)) parsed += 1;
      }
      renderCostTable();
      markStepDone("6a");
      status(parsed ? `✅ 표·수치 정규화 완료 — ${costAll.length}개 숫자셀 추출(출처 보존).` : "✅ 이미 반영된 파일입니다. 기존 표·수치 결과를 유지합니다.");
      openCard("6b");
    } catch (err) {
      status("❌ 표/수치 파싱 실패: " + err.message, true);
    }
  }
  costDrop.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files.length) handleCostFiles(e.dataTransfer.files); });
  costFileInput.addEventListener("change", (e) => { if (e.target.files.length) handleCostFiles(e.target.files); e.target.value = ""; });
  costMinValue.addEventListener("input", () => { if (costAll.length) renderCostTable(); });

  /* ---------- 6-B. 1분 요약보드 (heuristic 집계 + 인사이트) ---------- */
  let lastBoardHtml = "";
  function computeBoard() {
    const rows = filteredRows().filter((r) => r.value > 0);
    if (!rows.length) return null;
    const sum = rows.reduce((a, r) => a + r.value, 0);
    const top = rows.slice(0, 5);
    const unit = detectUnitPrice(rows);
    const multiples = unit ? rows.filter((r) => isMultipleOf(r, unit.unit)) : [];
    const files = [...new Set(rows.map((r) => r.file))];
    return { count: rows.length, sum, top, multiples, files, unit };
  }
  function boardHtml(b) {
    const kpis =
      `<div class="board-kpis">
        <div class="kpi"><div class="kpi-v">${fmtWon(b.count)}</div><div class="kpi-l">추출 항목 수</div></div>
        <div class="kpi"><div class="kpi-v">${fmtWon(b.sum)}</div><div class="kpi-l">값 합계 <small>(단위 혼재 주의)</small></div></div>
        <div class="kpi"><div class="kpi-v">${fmtWon(b.top[0].value)}</div><div class="kpi-l">최대 값</div></div>
        <div class="kpi"><div class="kpi-v">${b.files.length}</div><div class="kpi-l">파일 수</div></div>
      </div>`;
    const topRows = b.top.map((r) =>
      `<li><strong>[${esc(r.category)}] ${esc(r.label)}</strong> — ${fmtWon(r.value)} <span class="src">(${esc(sourceOf(r))})</span></li>`).join("");
    const insights = [];
    insights.push(`최대 값 항목은 <strong>${esc(b.top[0].label)}</strong> (${fmtWon(b.top[0].value)}) — 출처 ${esc(sourceOf(b.top[0]))}.`);
    if (b.multiples.length && b.unit) insights.push(`데이터에서 찾은 ${esc(b.unit.reason)} 후보 <strong>${fmtWon(b.unit.unit)}</strong>의 <strong>배수</strong>인 항목 ${b.multiples.length}개 → '단위 수 × 단가' 구조 후보 <span class="hint" style="display:inline">(추정·검증필요)</span>.`);
    insights.push(`상위 5개 항목이 합계의 ${Math.round(b.top.reduce((a, r) => a + r.value, 0) / b.sum * 100)}%를 차지.`);
    const insightHtml = `<ul>${insights.map((t) => `<li>${t}</li>`).join("")}</ul>`;
    return `<h2>핵심 수치 (1분)</h2>${kpis}<h2>상위 5개 항목</h2><ul class="board-top">${topRows}</ul><h2>인사이트</h2>${insightHtml}`;
  }
  $("btnBoard").addEventListener("click", () => {
    const b = computeBoard();
    if (!b) { $("boardArea").innerHTML = '<p class="hint danger">6-A에서 표/수치 파일을 먼저 등록하세요.</p>'; return; }
    const inner = boardHtml(b);
    $("boardArea").innerHTML = `<div class="print-area board-print">${inner}</div>`;
    lastBoardHtml = fullHtml(
      `1분 요약보드 — ${dateEl.value || todayISO()}`,
      inner,
      "기획 하네스 루프 · 모든 수치는 원본 셀에서 추출(AI 생성 아님)"
    );
    $("btnBoardHtml").disabled = false;
    $("btnBoardPdf").disabled = false;
    markStepDone("6b");
    status("⚡ 1분 보드 생성 완료.");
  });
  $("btnBoardHtml").addEventListener("click", () => {
    if (!lastBoardHtml) return;
    const blob = new Blob(["\uFEFF", lastBoardHtml], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${dateEl.value || todayISO()}_1min-board.html`;
    a.click(); URL.revokeObjectURL(a.href);
  });
  $("btnBoardPdf").addEventListener("click", () => {
    printHtmlReport(lastBoardHtml, "1분 요약보드 PDF");
  });

  /* ---------- 기존 분석설계 세션 복원 ---------- */
  function parseRestoredNote(note) {
    const rest = [];
    String(note || "").split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("기대 산출물:")) outputGoal.value = trimmed.replace("기대 산출물:", "").trim();
      else if (trimmed.startsWith("의사결정 기준:")) decisionCriteria.value = trimmed.replace("의사결정 기준:", "").trim();
      else if (trimmed.startsWith("메모:")) rest.push(trimmed.replace("메모:", "").trim());
      else if (trimmed) rest.push(trimmed);
    });
    $("etcNote").value = rest.join("\n");
  }

  async function restoreAnalysisSession(sessionId) {
    status("📂 분석설계 세션을 불러오는 중...");
    try {
      const res = await window.apiFetch(`/api/analysis/sessions/${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const s = data.session || {};
      analysisSessionId = sessionId;
      projectName.value = s.title || "";
      analysisTopic.value = s.subject || "";
      dateEl.value = s.date || dateEl.value || todayISO();
      $("etcUrl").value = s.etc_url || "";
      parseRestoredNote(s.etc_note || "");
      markdown.value = s.meeting_markdown || "";
      if (markdown.value) {
        fname.textContent = `${s.date || todayISO()}_meeting.md`;
        setView(false);
      }
      analysisFiles.splice(0, analysisFiles.length);
      (data.files || []).forEach((file) => analysisFiles.push({
        localId: file.id,
        id: file.id,
        name: file.name,
        size: file.size || 0,
        type: file.type || "",
        file: null,
        uploaded: true,
        textAvailable: !!file.text_available,
        textExtractReason: file.text_extract_reason || "",
      }));
      renderFileList();
      $("prepDone").checked = true;
      setGate(true);
      const outputs = data.outputs || {};
      if (outputs.summaries?.content?.summaries) { renderSummaries(outputs.summaries.content.summaries); markStepDone(6); }
      if (outputs.ideas?.content?.questions) { renderIdeas(outputs.ideas.content.questions); markStepDone(7); }
      if (outputs.plans?.content?.plans) { renderPlans(outputs.plans.content.plans); markStepDone(8); }
      if (outputs.manual?.content?.steps) { renderManual(outputs.manual.content); markStepDone("8b"); }
      status(`✅ 분석설계 세션을 복원했습니다: ${s.title || sessionId}`);
      openCard(5, true);
    } catch (err) {
      status("❌ 분석설계 세션 복원 실패: " + err.message, true);
      openCard(5, true);
    }
  }

  /* ---------- 6-C~6-F. 상세 리포트/heuristic/근거/검증 ---------- */
  function positiveRows(limit) {
    const rows = filteredRows().filter((r) => r.value > 0);
    return limit ? rows.slice(0, limit) : rows;
  }

  function groupSummary(rows, keyFn) {
    const map = new Map();
    rows.forEach((r) => {
      const key = keyFn(r) || "기타";
      const g = map.get(key) || { key, count: 0, sum: 0, max: 0, top: null };
      g.count += 1;
      g.sum += r.value;
      if (!g.top || r.value > g.max) { g.max = r.value; g.top = r; }
      map.set(key, g);
    });
    return [...map.values()].sort((a, b) => b.sum - a.sum);
  }

  function repeatedValues(rows) {
    const map = new Map();
    rows.forEach((r) => {
      const key = String(Math.round(r.value));
      const group = map.get(key) || { value: Math.round(r.value), rows: [] };
      group.rows.push(r);
      map.set(key, group);
    });
    return [...map.values()].filter((g) => g.rows.length >= 2).sort((a, b) => b.rows.length - a.rows.length || b.value - a.value).slice(0, 12);
  }

  function isMultipleOf(row, unit) {
    const q = row.value / unit;
    return row.value > 0 && Math.abs(q - Math.round(q)) < 0.000001 && Math.round(q) >= 1;
  }

  // 값 하나를 '정수 개수 × 깔끔한 단가'로 표현할 수 있는 가장 큰 10의 거듭제곱 단가를 찾는다.
  // 예: 1,200,000 → 100,000(×12). 어떤 라운드 단가로도 안 나뉘면 null.
  function roundUnitFor(value) {
    if (!(value > 0)) return null;
    for (let p = Math.pow(10, Math.floor(Math.log10(value))); p >= 1; p /= 10) {
      if (value % p === 0 && value / p >= 2) return p;
    }
    return null;
  }

  // 데이터에서 '단가' 후보를 스스로 추정 — 도메인(수문/원가 등)에 종속되지 않는다.
  // 1순위: 여러 항목에 반복되는 값(같은 단가가 여러 줄에 등장) — 최댓값보다 작아야 단가로 의미가 있다.
  // 2순위: 반복이 없으면 최댓값을 라운드 단가로 분해.
  function detectUnitPrice(rows) {
    const positive = (rows || []).filter((r) => r.value > 0);
    if (!positive.length) return null;
    const maxV = Math.max(...positive.map((r) => r.value));
    const repeated = repeatedValues(positive).find((g) => g.value > 0 && g.value < maxV);
    if (repeated) return { unit: repeated.value, reason: "반복 단가", strength: "중" };
    const round = roundUnitFor(maxV);
    if (round) return { unit: round, reason: "라운드 단가", strength: "낮음" };
    return null;
  }

  // 라벨에서 '무엇의 개수'인지 힌트를 뽑아 지배 변수명으로 쓴다. 없으면 일반 명칭.
  // (사용자가 편집 가능하므로 감지가 애매하면 기본값으로 둔다.)
  const DRIVER_HINTS = ["인원", "시간", "일수", "지점", "건수", "횟수", "면적", "거리", "대수", "수량", "개수", "단위"];
  function deriveDriver(label) {
    const s = String(label || "");
    const hit = DRIVER_HINTS.find((k) => s.includes(k));
    return hit ? `${hit} 기준 단위 수` : "대표 단위 수";
  }

  function scoreEvidence(row, ev) {
    let score = 0;
    if (row.file === ev.file) score += 2;
    if (row.sheet === ev.sheet) score += 3;
    if (ev.text.includes(row.category)) score += 1;
    const labelTokens = String(row.label).split(/[\/\s·:_-]+/).filter((t) => t.length >= 2).slice(0, 6);
    labelTokens.forEach((t) => { if (ev.text.includes(t)) score += 1; });
    return score;
  }

  function buildEvidenceLinks() {
    const rows = positiveRows(60);
    evidenceLinks = rows.map((row) => {
      const ranked = evidenceAll.map((ev) => ({ ev, score: scoreEvidence(row, ev) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      const best = ranked[0]?.ev || null;
      const confidence = !best ? "낮음" : (row.sheet === best.sheet && row.file === best.file ? "상" : "중");
      return {
        row,
        evidence: best,
        confidence,
        status: best ? "근거 후보" : "근거 없음",
      };
    });
    return evidenceLinks;
  }

  function tableFromRows(headers, rows) {
    return `<table class="cost-table"><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${rows.join("")}</table>`;
  }

  function heuristicBody(model, editable) {
    const inputBlock = editable ? `<div class="heuristic-editor">
      <label>지배 변수<input type="text" id="heuristicDriver" value="${attr(model.driver)}" /></label>
      <label>단위 수<input type="number" id="heuristicUnitCount" value="${attr(model.unitCount)}" step="1" /></label>
      <label>단위 단가<input type="number" id="heuristicUnitCost" value="${attr(model.unitCost)}" step="1000" /></label>
      <button id="btnHeuristicRecalc" class="btn btn-ghost btn-small" type="button">다시 계산</button>
    </div>` : "";
    return `${inputBlock}
      <div class="heuristic-card">
        <div class="heuristic-formula">${esc(model.driver)} ${fmtWon(model.unitCount)} × 단위 단가 ${fmtWon(model.unitCost)} = <strong>${fmtWon(model.total)}</strong></div>
        <div class="hint">신뢰도: <strong>${esc(model.confidence)}</strong> · ${esc(model.note)}</div>
        <div class="src">대표 출처: ${model.source ? esc(sourceOf(model.source)) : "출처 없음"}</div>
      </div>`;
  }

  function buildHeuristicModel(overrides) {
    const rows = positiveRows();
    if (!rows.length) return null;
    const detected = detectUnitPrice(rows);
    const multiples = detected ? rows.filter((r) => isMultipleOf(r, detected.unit)) : [];
    const source = multiples[0] || rows[0];
    const unitCost = overrides?.unitCost || detected?.unit || source.value;
    const rawCount = source.value / unitCost;
    const unitCount = overrides?.unitCount || (Number.isFinite(rawCount) ? Math.max(1, Math.round(rawCount)) : 1);
    const driver = overrides?.driver || deriveDriver(source.label);
    const exact = Math.abs(source.value - unitCost * unitCount) <= Math.max(1, Math.abs(source.value) * 0.01);
    const confidence = detected ? (detected.strength === "중" ? "중" : "낮음~중") : "낮음";
    const note = exact
      ? "원본 값이 '단위 수 × 단가'로 거의 맞아떨어집니다. 실제 단위 정의와 단가 근거를 확인하세요."
      : "단순 1-feature 산식 후보입니다. 실제 세부 항목으로 분해·검증하기 전 참고용으로만 쓰세요.";
    return { driver, unitCount, unitCost, total: unitCount * unitCost, source, confidence, note };
  }

  function renderHeuristic(model) {
    lastHeuristic = model;
    $("heuristicArea").innerHTML = `<div class="print-area">${heuristicBody(model, true)}</div>`;
    lastHeuristicHtml = fullHtml("단위 수 × 단가 단순 산식(heuristic) 추정", heuristicBody(model, false), "단순 산식은 검증 출발점입니다. 원본 근거(단가표·기준·규정 등) 확인 전 확정값으로 쓰지 마세요.");
    $("btnHeuristicHtml").disabled = false;
    $("btnHeuristicPdf").disabled = false;
    const recalc = $("btnHeuristicRecalc");
    if (recalc) recalc.addEventListener("click", () => {
      const next = buildHeuristicModel({
        driver: $("heuristicDriver").value.trim() || "대표 작업 단위 수",
        unitCount: Number($("heuristicUnitCount").value) || 1,
        unitCost: Number($("heuristicUnitCost").value) || 0,
      });
      if (!next) return;
      next.confidence = "사용자 검토";
      next.note = "사용자가 산식 입력값을 조정했습니다. 원본 근거와 비교해 validation에서 확정하세요.";
      renderHeuristic(next);
    });
  }

  $("btnHeuristic").addEventListener("click", () => {
    const model = buildHeuristicModel();
    if (!model) { $("heuristicArea").innerHTML = '<p class="hint danger">6-A에서 표/수치 파일을 먼저 등록하세요.</p>'; return; }
    renderHeuristic(model);
    markStepDone("6c");
    status("🧮 단일 feature heuristic 산정 후보를 만들었습니다.");
    openCard("6d");
  });
  $("btnHeuristicHtml").addEventListener("click", () => {
    if (!lastHeuristicHtml) return;
    const blob = new Blob(["\uFEFF", lastHeuristicHtml], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${dateEl.value || todayISO()}_heuristic.html`;
    a.click(); URL.revokeObjectURL(a.href);
  });
  $("btnHeuristicPdf").addEventListener("click", () => {
    printHtmlReport(lastHeuristicHtml, "heuristic 산정 PDF");
  });

  function deepReportBody() {
    const rows = positiveRows();
    if (!rows.length) return "";
    const sum = rows.reduce((a, r) => a + r.value, 0);
    const cats = groupSummary(rows, (r) => r.category);
    const files = groupSummary(rows, (r) => r.file);
    const repeats = repeatedValues(rows);
    const links = evidenceLinks.length ? evidenceLinks : buildEvidenceLinks();
    const evidenceMap = new Map(links.map((link) => [sourceOf(link.row), link]));
    const needs = rows.filter((r) => r.category === "기타" || !evidenceMap.get(sourceOf(r))?.evidence).slice(0, 12);
    const kpis = `<div class="board-kpis">
      <div class="kpi"><div class="kpi-v">${fmtWon(rows.length)}</div><div class="kpi-l">분석 수치 셀</div></div>
      <div class="kpi"><div class="kpi-v">${fmtWon(sum)}</div><div class="kpi-l">양수 합계</div></div>
      <div class="kpi"><div class="kpi-v">${cats.length}</div><div class="kpi-l">카테고리</div></div>
      <div class="kpi"><div class="kpi-v">${evidenceAll.length}</div><div class="kpi-l">근거 후보 셀</div></div>
    </div>`;
    const catRows = cats.map((g) => `<tr><td>${esc(g.key)}</td><td class="num">${fmtWon(g.sum)}</td><td class="num">${g.count}</td><td>${esc(g.top?.label || "-")}<br><span class="src">${g.top ? esc(sourceOf(g.top)) : ""}</span></td></tr>`);
    const fileRows = files.map((g) => `<tr><td>${esc(g.key)}</td><td class="num">${fmtWon(g.sum)}</td><td class="num">${g.count}</td><td>${esc(g.top?.label || "-")}</td></tr>`);
    const topRows = rows.slice(0, 10).map((r) => `<tr><td>${esc(r.category)}</td><td>${esc(r.label)}</td><td class="num">${fmtWon(r.value)}</td><td class="src">${esc(sourceOf(r))}</td></tr>`);
    const repeatRows = repeats.length ? repeats.map((g) => `<tr><td class="num">${fmtWon(g.value)}</td><td class="num">${g.rows.length}</td><td>${g.rows.slice(0, 4).map((r) => `${esc(r.label)} <span class="src">(${esc(sourceOf(r))})</span>`).join("<br>")}</td></tr>`) : ['<tr><td colspan="3" class="src">반복 값 후보가 없습니다.</td></tr>'];
    const needRows = needs.length ? needs.map((r) => `<tr><td>${esc(r.category)}</td><td>${esc(r.label)}</td><td class="num">${fmtWon(r.value)}</td><td class="src">${esc(sourceOf(r))}</td></tr>`) : ['<tr><td colspan="4" class="src">현재 필터 기준 확인 필요 항목이 없습니다.</td></tr>'];
    return `${kpis}
      <h2>1. 카테고리별 구조</h2>${tableFromRows(["카테고리", "합계", "항목 수", "대표 항목"], catRows)}
      <h2>2. 파일별 구조</h2>${tableFromRows(["파일", "합계", "항목 수", "최대 항목"], fileRows)}
      <h2>3. 상위 10개 수치</h2>${tableFromRows(["카테고리", "항목", "값", "출처"], topRows)}
      <h2>4. 반복 단가 후보</h2>${tableFromRows(["값", "반복 수", "대표 출처"], repeatRows)}
      <h2>5. 확인 필요 항목</h2>${tableFromRows(["카테고리", "항목", "값", "출처"], needRows)}`;
  }

  $("btnDeepReport").addEventListener("click", () => {
    const body = deepReportBody();
    if (!body) { $("deepReportArea").innerHTML = '<p class="hint danger">6-A에서 표/수치 파일을 먼저 등록하세요.</p>'; return; }
    $("deepReportArea").innerHTML = `<div class="print-area">${body}</div>`;
    lastDeepReportHtml = fullHtml("10분 상세 HTML 리포트", body, "이 리포트는 구조 파악용입니다. 단위가 혼재된 합계는 확정 원가로 사용하지 마세요.");
    $("btnDeepReportHtml").disabled = false;
    $("btnDeepReportPdf").disabled = false;
    markStepDone("6d");
    status("📘 10분 상세 리포트를 만들었습니다.");
    openCard("6e");
  });
  $("btnDeepReportHtml").addEventListener("click", () => {
    if (!lastDeepReportHtml) return;
    const blob = new Blob(["\uFEFF", lastDeepReportHtml], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${dateEl.value || todayISO()}_10min-detail.html`;
    a.click(); URL.revokeObjectURL(a.href);
  });
  $("btnDeepReportPdf").addEventListener("click", () => {
    printHtmlReport(lastDeepReportHtml, "10분 상세 리포트 PDF");
  });

  function renderEvidenceLinks() {
    const links = buildEvidenceLinks();
    const rows = links.slice(0, 40).map((link) => `<tr>
      <td>${esc(link.row.category)}</td>
      <td>${esc(link.row.label)}<br><span class="src">${esc(sourceOf(link.row))}</span></td>
      <td class="num">${fmtWon(link.row.value)}</td>
      <td>${link.evidence ? `<strong>${esc(link.evidence.type)}</strong><br>${esc(link.evidence.text)}<br><span class="src">${esc(sourceOf(link.evidence))}</span>` : '<span class="danger">근거 후보 없음</span>'}</td>
      <td>${esc(link.confidence)}</td>
    </tr>`);
    const evidenceList = evidenceAll.length
      ? `<h2>감지된 근거 후보 셀</h2><ul>${evidenceAll.slice(0, 20).map((ev) => `<li><strong>${esc(ev.type)}</strong> ${esc(ev.text)} <span class="src">(${esc(sourceOf(ev))})</span></li>`).join("")}</ul>`
      : '<p class="hint danger">법령·지침·품셈·단가표로 보이는 문자 셀을 찾지 못했습니다. 파일명/시트명 기준 매핑만 가능합니다.</p>';
    $("evidenceArea").innerHTML = `<div class="print-area">${evidenceList}<h2>수치-근거 매핑 후보</h2>${tableFromRows(["카테고리", "수치 항목", "값", "근거 후보", "신뢰도"], rows)}</div>`;
  }
  $("btnEvidence").addEventListener("click", () => {
    if (!positiveRows().length) { $("evidenceArea").innerHTML = '<p class="hint danger">6-A에서 표/수치 파일을 먼저 등록하세요.</p>'; return; }
    renderEvidenceLinks();
    markStepDone("6e");
    status("⚖ 법령·근거 후보 매핑을 만들었습니다.");
    openCard("6f");
  });

  function makeValidationItems() {
    const rows = positiveRows(10).map((r, i) => ({
      id: `num-${i}`,
      type: "수치",
      title: `[${r.category}] ${r.label}`,
      value: fmtWon(r.value),
      source: sourceOf(r),
      evidence: evidenceLinks.find((link) => sourceOf(link.row) === sourceOf(r))?.evidence?.text || "근거 후보 없음",
    }));
    if (lastHeuristic) rows.unshift({
      id: "heuristic",
      type: "산식",
      title: `${lastHeuristic.driver} × 단위 단가`,
      value: fmtWon(lastHeuristic.total),
      source: lastHeuristic.source ? sourceOf(lastHeuristic.source) : "출처 없음",
      evidence: lastHeuristic.note,
    });
    return rows;
  }

  function renderValidation() {
    if (!evidenceLinks.length) buildEvidenceLinks();
    validationItems = makeValidationItems();
    if (!validationItems.length) { $("validationArea").innerHTML = '<p class="hint danger">검증할 항목이 없습니다. 6-A를 먼저 실행하세요.</p>'; return; }
    const rows = validationItems.map((item) => `<tr data-val-id="${attr(item.id)}">
      <td>${esc(item.type)}</td><td>${esc(item.title)}<br><span class="src">${esc(item.source)}</span></td>
      <td class="num">${esc(item.value)}</td><td>${esc(item.evidence)}</td>
      <td><select data-val-status><option>검증 대기</option><option>맞음</option><option>수정 필요</option><option>제외</option></select></td>
      <td><input type="text" data-val-note placeholder="검증 메모" /></td>
    </tr>`);
    $("validationArea").innerHTML = `<div class="validation-summary" id="validationLiveSummary"></div><div class="cost-table-wrap">${tableFromRows(["유형", "항목", "값", "근거", "판정", "메모"], rows)}</div>`;
    $("btnValidationSummary").disabled = false;
  }
  $("btnValidation").addEventListener("click", () => {
    renderValidation();
    markStepDone("6f");
    status("✅ validation 표를 만들었습니다. 판정 후 검증 요약을 반영하세요.");
  });
  $("btnValidationSummary").addEventListener("click", () => {
    const rows = Array.from(document.querySelectorAll("#validationArea [data-val-id]"));
    const counts = { ok: 0, fix: 0, drop: 0, pending: 0 };
    validationSummary = rows.map((tr) => {
      const id = tr.dataset.valId;
      const base = validationItems.find((item) => item.id === id);
      const verdict = tr.querySelector("[data-val-status]").value;
      const note = tr.querySelector("[data-val-note]").value.trim();
      if (verdict === "맞음") counts.ok += 1;
      else if (verdict === "수정 필요") counts.fix += 1;
      else if (verdict === "제외") counts.drop += 1;
      else counts.pending += 1;
      return { ...base, verdict, note };
    });
    $("validationLiveSummary").innerHTML = `<div class="board-kpis">
      <div class="kpi"><div class="kpi-v">${counts.ok}</div><div class="kpi-l">맞음</div></div>
      <div class="kpi"><div class="kpi-v">${counts.fix}</div><div class="kpi-l">수정 필요</div></div>
      <div class="kpi"><div class="kpi-v">${counts.drop}</div><div class="kpi-l">제외</div></div>
      <div class="kpi"><div class="kpi-v">${counts.pending}</div><div class="kpi-l">대기</div></div>
    </div>`;
    status("✅ validation 요약을 결과 정리에 반영했습니다.");
  });

  // 분석-only 작업이 자연스럽게 시작되도록 프로젝트·자료 준비를 기본으로 펼친다.
  const restoreId = new URLSearchParams(location.search).get("session");
  if (restoreId) restoreAnalysisSession(restoreId);
  else openCard(5);
  }
  if (window.__sduiRegisterBoot) window.__sduiRegisterBoot("analysis", bootAnalysis);
  else bootAnalysis();
})();
