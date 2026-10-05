/* 녹음·자막 → 회의록(Markdown) 생성기 — 기획 하네스 프론트엔드.
   전부 브라우저에서 동작. Claude/Clova 호출은 사용자가 키를 넣은 경우에만, 서버 경유 없이 직접.
   출력 Markdown 은 harness meetings/summary 포맷( ## 할 일 + `- [ ] ... — @담당자 ~날짜 [priority:X]` ). */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const el = {
    recStart: $("btnRecStart"), recStop: $("btnRecStop"), timer: $("timer"), recDot: $("recDot"),
    clova: $("btnClova"), speechSupport: $("speechSupport"),
    dropzone: $("dropzone"), fileInput: $("fileInput"),
    transcript: $("transcript"), meetingDate: $("meetingDate"), attendees: $("attendees"),
    draft: $("btnDraft"), ai: $("btnAI"), genStatus: $("genStatus"),
    anthropicKey: $("anthropicKey"), model: $("model"), clovaUrl: $("clovaUrl"), clovaKey: $("clovaKey"),
    saveKeys: $("btnSaveKeys"), clearKeys: $("btnClearKeys"),
    resultPanel: $("resultPanel"), markdown: $("markdown"), download: $("btnDownload"),
    copy: $("btnCopy"), fname: $("fname"),
    mdPreview: $("mdPreview"), tabPreview: $("tabPreview"), tabEdit: $("tabEdit"),
  };

  // ---------- 초기값 ----------
  const todayISO = () => new Date().toISOString().slice(0, 10);
  el.meetingDate.value = todayISO();

  const LS = "harness-meeting-keys";
  function loadKeys() {
    try {
      const k = JSON.parse(localStorage.getItem(LS) || "{}");
      if (k.anthropicKey) el.anthropicKey.value = k.anthropicKey;
      if (k.model) el.model.value = k.model;
      if (k.clovaUrl) el.clovaUrl.value = k.clovaUrl;
      if (k.clovaKey) el.clovaKey.value = k.clovaKey;
    } catch (_) {}
  }
  function saveKeys() {
    localStorage.setItem(LS, JSON.stringify({
      anthropicKey: el.anthropicKey.value.trim(), model: el.model.value,
      clovaUrl: el.clovaUrl.value.trim(), clovaKey: el.clovaKey.value.trim(),
    }));
    status(el.genStatus, "✅ 키를 이 브라우저에 저장했습니다.");
  }
  el.saveKeys.addEventListener("click", saveKeys);
  el.clearKeys.addEventListener("click", () => {
    localStorage.removeItem(LS);
    el.anthropicKey.value = el.clovaUrl.value = el.clovaKey.value = "";
    status(el.genStatus, "🧹 저장된 키를 지웠습니다.");
  });
  loadKeys();

  function status(node, msg, isErr) {
    node.textContent = msg;
    node.classList.toggle("danger", !!isErr);
  }

  // ---------- 자막/텍스트 파싱 ----------
  function parseSubtitle(text, name) {
    const lower = (name || "").toLowerCase();
    if (lower.endsWith(".txt")) return cleanupLines(text.split(/\r?\n/));
    // VTT / SRT 공통 처리
    const lines = text.split(/\r?\n/);
    const out = [];
    for (let raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (/^WEBVTT/i.test(line)) continue;
      if (/^NOTE\b/i.test(line)) continue;
      if (/-->/.test(line)) continue;              // 타임코드
      if (/^\d+$/.test(line)) continue;            // 큐 번호
      if (/^(STYLE|REGION)\b/i.test(line)) continue;
      // <v 화자>텍스트</v>  또는  <00:00:00.000> 인라인 태그 제거
      let t = line.replace(/<v\s+([^>]+)>/gi, "$1: ").replace(/<\/v>/gi, "");
      t = t.replace(/<[^>]+>/g, "").trim();
      if (t) out.push(t);
    }
    return cleanupLines(out);
  }
  function cleanupLines(arr) {
    const out = [];
    let prev = "";
    for (const l of arr) {
      const t = l.trim();
      if (!t || t === prev) continue;               // 연속 중복 제거(자막 흔한 패턴)
      out.push(t); prev = t;
    }
    return out.join("\n");
  }

  // ---------- 파일 선택 ----------
  el.dropzone.addEventListener("click", () => el.fileInput.click());
  el.dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") el.fileInput.click(); });
  ["dragover", "dragenter"].forEach(ev => el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(ev => el.dropzone.addEventListener(ev, () => el.dropzone.classList.remove("drag")));
  el.dropzone.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  el.fileInput.addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  async function handleFile(file) {
    const name = file.name.toLowerCase();
    const isText = /\.(vtt|srt|txt)$/.test(name) || file.type.startsWith("text");
    if (isText) {
      const text = await file.text();
      el.transcript.value = parseSubtitle(text, name);
      status(el.genStatus, `📄 '${file.name}' 자막을 전사 결과로 불러왔습니다. 회의록을 생성하세요.`);
    } else {
      // 오디오 → Clova/외부 STT
      status(el.genStatus, `🎧 '${file.name}' 오디오는 Clova/외부 STT로 전사합니다…`);
      await transcribeAudio(file);
    }
  }

  // ---------- Web Speech 실시간 녹음 ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null, recording = false, tSec = 0, tInt = null;
  if (!SR) {
    el.recStart.disabled = true;
    status(el.speechSupport, "이 브라우저는 실시간 음성인식을 지원하지 않습니다(Chrome/Edge 권장). 자막 파일은 그대로 사용 가능합니다.");
  }
  function fmt(s) { const m = String((s / 60) | 0).padStart(2, "0"); const ss = String(s % 60).padStart(2, "0"); return `${m}:${ss}`; }
  function startTimer() { tSec = 0; el.timer.textContent = "00:00"; tInt = setInterval(() => { el.timer.textContent = fmt(++tSec); }, 1000); }
  function stopTimer() { clearInterval(tInt); }

  el.recStart.addEventListener("click", () => {
    if (!SR || recording) return;
    recog = new SR();
    recog.lang = "ko-KR"; recog.continuous = true; recog.interimResults = true;
    let finals = el.transcript.value ? el.transcript.value + "\n" : "";
    recog.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += r[0].transcript.trim() + "\n";
        else interim += r[0].transcript;
      }
      el.transcript.value = finals + interim;
    };
    recog.onerror = (e) => status(el.speechSupport, "음성인식 오류: " + e.error, true);
    recog.onend = () => { if (recording) recog.start(); };  // Chrome 무음 자동종료 → 재시작
    recording = true;
    recog.start(); startTimer();
    el.recStart.disabled = true; el.recStop.disabled = false; el.recDot.hidden = false;
    status(el.speechSupport, "🎙️ 녹음 중… 말한 내용이 전사 결과에 실시간으로 채워집니다.");
  });
  el.recStop.addEventListener("click", () => {
    recording = false;
    if (recog) recog.stop();
    stopTimer();
    el.recStart.disabled = false; el.recStop.disabled = true; el.recDot.hidden = true;
    status(el.speechSupport, "⏹️ 녹음을 마쳤습니다. 회의록을 생성하세요.");
  });

  // ---------- Clova/외부 STT ----------
  el.clova.addEventListener("click", () => el.fileInput.click());
  async function transcribeAudio(file) {
    const url = el.clovaUrl.value.trim(), key = el.clovaKey.value.trim();
    if (!url || !key) {
      status(el.genStatus, "⚙️ 오디오 전사에는 'API 키 설정'에서 Clova/외부 STT Invoke URL 과 Secret 키가 필요합니다.", true);
      return;
    }
    try {
      const fd = new FormData();
      fd.append("media", file);
      fd.append("params", JSON.stringify({ language: "ko-KR", completion: "sync", fullText: true }));
      const res = await fetch(url, { method: "POST", headers: { "X-CLOVASPEECH-API-KEY": key }, body: fd });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      el.transcript.value = data.text || (data.segments || []).map(s => s.text).join("\n") || "";
      status(el.genStatus, "✅ 오디오 전사 완료. 회의록을 생성하세요.");
    } catch (err) {
      status(el.genStatus, "❌ STT 호출 실패: " + err.message +
        " — 브라우저 CORS 로 막혔을 수 있습니다. 자막(.vtt/.srt) 또는 실시간 녹음을 쓰거나, 프록시가 필요합니다.", true);
    }
  }

  // ---------- Markdown 빌드 (harness meetings/summary 포맷) ----------
  function attendeesBlock() {
    const raw = el.attendees.value.trim();
    if (!raw) return "- @담당자1";
    return raw.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
      .map(s => "- " + (s.startsWith("@") ? s : "@" + s)).join("\n");
  }

  function heuristicMarkdown() {
    const lines = el.transcript.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const date = el.meetingDate.value || todayISO();
    const decRe = /(결정|하기로|합의|확정|정했|승인|채택)/;
    const actRe = /(해야|담당|까지|준비|작성|공유|확인|처리|검토|todo|액션|다음\s*주|내일)/i;
    const decisions = lines.filter(l => decRe.test(l)).slice(0, 12);
    const actions = lines.filter(l => actRe.test(l)).slice(0, 15);
    const summary = lines.slice(0, 3).join(" ").slice(0, 200);

    const decBlock = decisions.length ? decisions.map(d => "- " + d).join("\n") : "- (초안: 결정사항을 채워주세요)";
    const actBlock = actions.length
      ? actions.map(a => `- [ ] ${a} — @담당자 ~${date} [priority:Medium]`).join("\n")
      : "- [ ] (초안: 할 일을 채워주세요) — @담당자 ~" + date + " [priority:Medium]";

    return `# ${date} 회의

## 참석자
${attendeesBlock()}

## 안건
- (전사 기반 초안)

## 결정사항 (Decisions)
${decBlock}

## 요약
${summary || "(요약을 채워주세요)"}

## 할 일 (Action Items)
${actBlock}

## 참고 / 링크
- 전사 원문 ${lines.length}줄 기반 (규칙기반 초안 — 검토 필요)
`;
  }

  // ---------- 미리보기 렌더 (의존성 없는 최소 Markdown 렌더러) ----------
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function renderMarkdown(md) {
    const lines = esc(md).split(/\r?\n/);
    let html = "", inList = false, listCls = "";
    const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
    const openList = (cls) => { if (!inList || listCls !== cls) { closeList(); html += `<ul${cls ? ` class="${cls}"` : ""}>`; inList = true; listCls = cls; } };
    for (let raw of lines) {
      const line = raw.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
      let m;
      if (/^#\s+/.test(line)) { closeList(); html += `<div class="mp-h1">${line.replace(/^#\s+/, "")}</div>`; }
      else if (/^##\s+/.test(line)) { closeList(); html += `<div class="mp-h2">${line.replace(/^##\s+/, "")}</div>`; }
      else if (/^###\s+/.test(line)) { closeList(); html += `<h4>${line.replace(/^###\s+/, "")}</h4>`; }
      else if ((m = line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/))) {
        openList("mp-tasks");
        const done = m[1].toLowerCase() === "x";
        html += `<li class="${done ? "done" : ""}"><input type="checkbox" disabled ${done ? "checked" : ""}><span>${m[2]}</span></li>`;
      }
      else if ((m = line.match(/^[-*]\s+(.*)$/))) { openList(""); html += `<li>${m[1]}</li>`; }
      else if (line.trim() === "") { closeList(); }
      else { closeList(); html += `<p>${line}</p>`; }
    }
    closeList();
    return html;
  }
  function updatePreview() { el.mdPreview.innerHTML = renderMarkdown(el.markdown.value); }

  // 편집 ↔ 미리보기 토글
  function setView(edit) {
    el.markdown.hidden = !edit;
    el.mdPreview.hidden = edit;
    el.tabEdit.classList.toggle("active", edit);
    el.tabPreview.classList.toggle("active", !edit);
    if (!edit) updatePreview();
  }
  el.tabEdit.addEventListener("click", () => setView(true));
  el.tabPreview.addEventListener("click", () => setView(false));
  el.markdown.addEventListener("input", updatePreview);

  function showResult(md) {
    const date = el.meetingDate.value || todayISO();
    el.markdown.value = md.trim() + "\n";
    el.resultPanel.hidden = false;
    el.fname.textContent = `${date}_meeting.md`;
    setView(false);           // 기본은 미리보기(읽기 좋게), 편집 탭으로 직접 수정
    el.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  el.draft.addEventListener("click", () => {
    if (!el.transcript.value.trim()) { status(el.genStatus, "먼저 자막을 불러오거나 녹음하세요.", true); return; }
    showResult(heuristicMarkdown());
    status(el.genStatus, "📝 규칙기반 초안 생성. 담당·마감·우선순위를 다듬은 뒤 내려받으세요.");
  });

  // ---------- Claude AI 요약 ----------
  el.ai.addEventListener("click", async () => {
    const transcript = el.transcript.value.trim();
    if (!transcript) { status(el.genStatus, "먼저 자막을 불러오거나 녹음하세요.", true); return; }
    const key = el.anthropicKey.value.trim();
    if (!key) { status(el.genStatus, "⚙️ 'API 키 설정'에서 Anthropic API 키를 입력하세요.", true); return; }
    const date = el.meetingDate.value || todayISO();
    el.ai.disabled = true;
    status(el.genStatus, "🤖 Claude 로 회의록 요약 중…");
    const prompt =
`아래 회의 전사 텍스트를 한국어 회의록 Markdown 으로 정리해줘.
반드시 아래 형식과 섹션을 그대로 지켜(추가 설명·코드펜스 없이 Markdown 본문만 출력):

# ${date} 회의

## 참석자
${attendeesBlock()}

## 안건
- (핵심 안건들)

## 결정사항 (Decisions)
- (합의/결정된 것)

## 요약
(3~5문장 요약)

## 할 일 (Action Items)
- [ ] <할 일> — @담당자 ~YYYY-MM-DD [priority:High|Medium|Low]

## 참고 / 링크
- (있으면)

규칙:
- 할 일은 반드시 위 라인 형식(구분자는 " — ", @담당자, ~마감일, [priority:...])을 지켜라. 담당/마감이 불명확하면 @담당자 / ~${date} 로 두어라.
- 전사에 없는 내용을 지어내지 마라.

[전사 텍스트]
${transcript}`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: el.model.value,
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error("HTTP " + res.status + " " + t.slice(0, 160));
      }
      const data = await res.json();
      const md = (data.content || []).map(b => b.text || "").join("").trim();
      if (!md) throw new Error("빈 응답");
      showResult(md);
      status(el.genStatus, "✅ Claude 요약 완료. 검토 후 내려받으세요.");
    } catch (err) {
      status(el.genStatus, "❌ AI 요약 실패: " + err.message, true);
    } finally {
      el.ai.disabled = false;
    }
  });

  // ---------- 내려받기 / 복사 ----------
  el.download.addEventListener("click", () => {
    const date = el.meetingDate.value || todayISO();
    const blob = new Blob([el.markdown.value], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${date}_meeting.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  el.copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(el.markdown.value); status(el.genStatus, "📋 복사했습니다."); }
    catch (_) { status(el.genStatus, "복사 실패 — 텍스트를 직접 선택해 복사하세요.", true); }
  });
})();
