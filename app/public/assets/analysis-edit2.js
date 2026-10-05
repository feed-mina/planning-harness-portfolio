// 분석설계페이지 — 분석-only/회의록 기반 흐름 + Mermaid 연동 + 자료 준비 게이트 + AI 요약/아이디어/플랜 + PDF.
(() => {
  "use strict";
  const TEMPLATE_OPTIONS = [
    ["generic", "일반 자료 분석"],
    ["manufacturing-purchase", "제조·구매 원가 검토"],
    ["construction-cost", "공사비 내역 검토"],
    ["academic-service", "학술·연구용역 산정"],
    ["software-fee", "SW 사업비 산정"],
    ["policy", "정책·법령 검토"],
    ["budget", "예산 비교"],
  ];
  const TEMPLATE_BUTTONS = [
    ["manufacturing-purchase", "제조구매"],
    ["construction-cost", "공사비"],
    ["academic-service", "학술용역"],
    ["software-fee", "SW 사업비"],
    ["policy", "정책/법령"],
    ["budget", "예산 비교"],
  ];

  function renderAnalysisScopeInputWidget(_ctx, _node, host) {
    if (!host) return;
    host.classList.add("sub-block", "analysis-sdui-scope");
    host.setAttribute("aria-label", "분석 입력");
    host.innerHTML = "";

    const label = document.createElement("div");
    label.className = "sub-label";
    label.textContent = "분석 입력";
    host.appendChild(label);

    const panel = document.createElement("div");
    panel.className = "analysis-template-panel";
    panel.setAttribute("aria-label", "분석 유형");

    const selectLabel = document.createElement("label");
    selectLabel.className = "analysis-template-select";
    selectLabel.setAttribute("for", "analysisTemplate");
    selectLabel.appendChild(document.createTextNode("분석 유형"));
    const select = document.createElement("select");
    select.id = "analysisTemplate";
    TEMPLATE_OPTIONS.forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    });
    selectLabel.appendChild(select);
    panel.appendChild(selectLabel);

    const summary = document.createElement("div");
    summary.id = "analysisTemplateSummary";
    summary.className = "analysis-template-summary";
    summary.setAttribute("aria-live", "polite");
    panel.appendChild(summary);

    const presets = document.createElement("div");
    presets.className = "office-presets";
    presets.setAttribute("aria-label", "빠른 템플릿");
    TEMPLATE_BUTTONS.forEach(([value, text]) => {
      const button = document.createElement("button");
      button.className = "btn btn-ghost btn-small";
      button.type = "button";
      button.dataset.template = value;
      button.textContent = text;
      presets.appendChild(button);
    });
    panel.appendChild(presets);
    host.appendChild(panel);

    const grid = document.createElement("div");
    grid.className = "analysis-scope-grid";

    const githubFields = document.createElement("div");
    githubFields.id = "githubScopeFields";
    githubFields.className = "analysis-github-fields";
    grid.appendChild(githubFields);

    const outputLabel = document.createElement("label");
    outputLabel.appendChild(document.createTextNode("기대 산출물"));
    const outputInput = document.createElement("input");
    outputInput.type = "text";
    outputInput.id = "outputGoal";
    outputInput.placeholder = "예: 갤럭시 s25 제조원가, 계산 확인표, 근거 목록";
    outputLabel.appendChild(outputInput);
    grid.appendChild(outputLabel);

    const criteriaLabel = document.createElement("label");
    criteriaLabel.appendChild(document.createTextNode("의사결정 기준"));
    const criteriaInput = document.createElement("input");
    criteriaInput.type = "text";
    criteriaInput.id = "decisionCriteria";
    criteriaInput.value = "근거 있는 수치, 법령/출처 명시, 원가 산정식, 담당자 확인 항목 표시";
    criteriaLabel.appendChild(criteriaInput);
    grid.appendChild(criteriaLabel);

    host.appendChild(grid);
  }

  function renderCostStructureTableWidget(_ctx, _node, host) {
    if (!host) return;
    host.classList.add("analysis-cost-structure-widget");
    host.innerHTML = "";
    const toolbar = document.createElement("div");
    toolbar.className = "cost-toolbar";

    const label = document.createElement("label");
    label.className = "hint";
    label.appendChild(document.createTextNode("최소 절대값 필터 "));
    const min = document.createElement("input");
    min.type = "number";
    min.id = "costMinValue";
    min.value = "10000";
    min.step = "1000";
    min.style.width = "120px";
    label.appendChild(min);
    toolbar.appendChild(label);

    const count = document.createElement("span");
    count.className = "hint";
    count.id = "costCount";
    count.textContent = "추출된 항목: 0";
    toolbar.appendChild(count);

    const table = document.createElement("div");
    table.id = "costTableWrap";
    table.className = "cost-table-wrap";

    const engine = document.createElement("section");
    engine.id = "unitCostEngine";
    engine.className = "unit-cost-engine";
    engine.hidden = true;

    host.append(toolbar, engine, table);
  }

  function renderCostUploadShellWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "costUploadShellSdui";
    host.innerHTML = `
      <p class="hint">5번 분석파일에 등록한 엑셀은 이 단계에서 자동으로 재사용합니다. 엑셀(xlsx/xls)의 숫자 셀을 <strong>브라우저에서 추출</strong>해 <em>항목·값·출처(파일·시트·셀)</em>로 정규화합니다.
        원가·예산·수문 조사표·운영지표처럼 수치 근거가 중요한 자료를 빠르게 검토할 수 있습니다.</p>
      <section class="dropzone" id="costDrop" tabindex="0" role="button">
        <div class="mic">📊</div>
        <div class="dz-title">추가 표/수치 파일 선택 (.xlsx · .xls)</div>
        <div class="dz-sub">5번에 없는 파일만 추가하세요. 예: 예산·단가·수문 조사표·운영지표.</div>
        <input type="file" id="costFileInput" accept=".xlsx,.xls" multiple hidden />
      </section>
      <div id="costStructureSduiMount"></div>`;
  }

  function renderResultContractCardsWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "editResultContracts";
    host.classList.add("edit-result-contracts", "analysis-result-contracts-widget");
    host.setAttribute("aria-live", "polite");
    if (!host.textContent.trim()) {
      host.innerHTML = '<p class="hint">자동 분석 후 실제 결과값, 보고서 초안, 실행 체크리스트가 표시됩니다.</p>';
    }
  }

  function renderEvidenceViewerWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "evidenceViewer";
    host.className = "evidence-viewer evidence-viewer-enhanced";
    host.hidden = true;
    host.innerHTML = `
      <div class="evidence-viewer-head">
        <div><span class="edit-eyebrow">원본근거 확인</span><h3 id="evidenceViewerTitle">근거 자료</h3></div>
        <button class="btn btn-ghost btn-small" type="button" data-close-evidence-viewer>닫기</button>
      </div>
      <div id="evidenceViewerBody" class="evidence-viewer-body"></div>`;
  }

  function renderReportViewToggleWidget(_ctx, _node, host) {
    if (!host) return;
    host.classList.add("result-view-toggle", "analysis-report-toggle-widget");
    host.setAttribute("aria-label", "결과 보기 방식");
    host.innerHTML = "";
    [
      ["summary", "요약 보기", true],
      ["deep", "근거 상세", false],
    ].forEach(([value, label, active]) => {
      const button = document.createElement("button");
      button.className = `btn btn-ghost btn-small${active ? " active" : ""}`;
      button.type = "button";
      button.dataset.resultView = value;
      button.textContent = label;
      host.appendChild(button);
    });
  }

  function renderAnalysisFileUploaderWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "analysisFileUploaderSdui";
    host.className = "sub-block analysis-file-uploader-widget";
    host.dataset.githubOnly = "true";
    host.innerHTML = `
      <div class="sub-label">분석파일 등록 <span class="hint" style="display:inline">— 원가표, 정책자료, 계약서, 회의록 근거자료를 함께 올릴 수 있습니다</span></div>
      <section class="dropzone" id="analysisDrop" tabindex="0" role="button">
        <div class="mic">📄</div>
        <div class="dz-title">분석할 파일 선택</div>
        <div class="dz-sub">여기를 누르면 폴더가 열립니다. 여러 개 선택 가능.</div>
        <input type="file" id="analysisFileInput" multiple hidden />
        <div class="analysis-drop-files">
          <ul class="file-list" id="analysisFileList"></ul>
          <p class="hint" id="analysisFileEmpty">아직 등록된 분석파일이 없습니다.</p>
        </div>
      </section>`;
  }

  function renderAnalysisSupplementInputWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "analysisSupplementSdui";
    host.className = "sub-block analysis-supplement-widget";
    host.dataset.githubOnly = "true";
    host.innerHTML = `
      <div class="sub-label">보충 입력 <span class="hint" style="display:inline">— 참고 URL, 분석 대상/의도, 연구원 메모</span></div>
      <label class="field-label" for="etcUrl" style="font-size:.85rem">참고 URL (선택)</label>
      <input type="text" id="etcUrl" placeholder="https://…" />
      <label class="field-label" for="etcNote" style="font-size:.85rem;margin-top:10px">메모 / 무엇을 분석하고 싶은지</label>
      <textarea id="etcNote" rows="4" placeholder="예: 전체 자료를 빠르게 파악한 뒤, 근거가 있는 수치와 확인 필요한 가정을 분리하고 싶다."></textarea>`;
  }

  function renderAnalysisRunControlsWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "analysisRunControlsSdui";
    host.innerHTML = `
      <p class="hint">자동 분석 시작을 누르면 AI가 계산식, 근거, 작업 목록, 리포트를 순서대로 정리합니다.</p>
      <div class="edit-run-head">
        <button id="btnRunAnalysisEdit" class="btn btn-dark edit-run-only">자동 분석 시작</button>
        <button id="btnSummarize" class="btn btn-dark edit-internal-action">🤖 분석파일 요약 실행</button>
        <div id="editRunProgress" class="edit-run-progress" aria-live="polite"></div>
      </div>
      <div class="edit-status-strip" aria-label="AI 분석 진행 상태">
        <span data-edit-step="formula">계산식 만들기</span>
        <span data-edit-step="evidence">근거 연결</span>
        <span data-edit-step="plans">작업 목록 반영</span>
        <span data-edit-step="report">리포트 작성</span>
      </div>
      <div class="analysis-pipeline-strip" aria-label="멀티스테이지 분석 진행 상태">
        <span data-pipeline-stage="summary">1. 요약</span>
        <span data-pipeline-stage="questions">2. 확인 질문</span>
        <span data-pipeline-stage="plans">3. 분석 플랜</span>
        <span data-pipeline-stage="manual">4. 매뉴얼</span>
      </div>`;
  }

  function renderReportActionButtonsWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "reportActionsSdui";
    host.className = "print-actions result-actions";
    host.innerHTML = `
      <button id="btnBuildResult" class="btn btn-dark">리포트 새로고침</button>
      <button id="btnOpenEvidenceGuide" class="btn btn-primary" type="button">AI 결과 원본근거 확인</button>
      <button id="btnSaveExecution" class="btn btn-primary" type="button">서버에 검토 기록 보관</button>
      <button id="btnPrint" class="btn btn-primary" disabled>현재 화면 초안 PDF 저장</button>
      <button id="btnExportReportCsv" class="btn btn-ghost" type="button" disabled>초안 Excel 다운로드</button>`;
  }

  function renderReviewFilterControlsWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "reviewFilterControlsSdui";
    host.className = "review-filter-actions";
    host.setAttribute("aria-label", "검토 항목 필터");
    host.innerHTML = `
      <button class="btn btn-ghost btn-small active" type="button" data-review-filter="all">전체 보기</button>
      <button class="btn btn-ghost btn-small" type="button" data-review-filter="needs">확인 필요만 보기</button>
      <button class="btn btn-ghost btn-small" type="button" data-review-filter="input">입력 필요한 항목</button>
      <button class="btn btn-ghost btn-small" type="button" data-review-filter="evidence">근거 부족 항목</button>`;
  }

  function renderEditReviewSummaryWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "editReviewSummarySdui";
    host.innerHTML = `
      <div class="edit-kpis" id="editCalcKpis">
        <div><strong>0건</strong><span>등록 자료</span></div>
        <div><strong>0건</strong><span>담당자 확인</span></div>
        <div><strong>대기</strong><span>리포트</span></div>
      </div>
      <div id="editActionSummary" class="edit-action-summary">자동 분석 후 다음 확인 작업이 표시됩니다.</div>`;
  }

  function renderEditOutputCardsWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "editOutputCardsSdui";
    host.innerHTML = `
      <details class="edit-output-card edit-internal-output">
        <summary>분석파일 요약</summary>
        <div id="summaryList" style="margin-top:12px"></div>
      </details>
      <details class="edit-output-card edit-internal-output">
        <summary>간단 요약</summary>
        <div id="editBoardMount"></div>
      </details>
      <details class="edit-output-card edit-internal-output">
        <summary>단가 산식</summary>
        <div id="editHeuristicMount"></div>
      </details>
      <details class="edit-output-card edit-internal-output">
        <summary>상세 보고서</summary>
        <div id="editDeepReportMount"></div>
      </details>
      <details class="edit-output-card edit-internal-output">
        <summary>법령·근거 매핑</summary>
        <div id="editEvidenceMount"></div>
      </details>`;
  }

  function renderBoardSummaryShellWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "boardSummaryShellSdui";
    host.innerHTML = `
      <p class="hint">6-A에서 추출한 값으로 빠르게 파악할 수 있는 핵심 수치·인사이트를 만듭니다. 모든 수치에 원본 셀 출처가 붙습니다.</p>
      <div class="print-actions result-actions">
        <button id="btnBoard" class="btn btn-dark">⚡ 간단 요약 생성</button>
        <button id="btnBoardHtml" class="btn btn-primary" type="button" hidden disabled>⬇ 인사이트 PDF로 저장</button>
        <button id="btnBoardPdf" class="btn btn-ghost" disabled>⬇ 인사이트 PDF 내려받기</button>
      </div>
      <div id="boardArea" style="margin-top:14px"></div>`;
  }

  function renderHeuristicShellWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "heuristicShellSdui";
    host.innerHTML = `
      <p class="hint">복잡한 모델 전에 <strong>단일 feature</strong>만 쓰는 산정식을 만듭니다. 예: 단위 수 × 단위 단가(인원 수·건수·지점 수·수량 등 어떤 도메인이든). 단가 후보는 <strong>데이터에서 자동 추정</strong>하며, 신뢰도와 원본 셀 출처를 함께 표시합니다.</p>
      <div class="print-actions result-actions">
        <button id="btnHeuristic" class="btn btn-dark">🧮 단가 산식 생성</button>
        <button id="btnHeuristicHtml" class="btn btn-primary" type="button" hidden disabled>⬇ 산정 PDF로 저장</button>
        <button id="btnHeuristicPdf" class="btn btn-ghost" disabled>⬇ 산정 PDF 내려받기</button>
      </div>
      <div id="heuristicArea" style="margin-top:14px"></div>`;
  }

  function renderDeepReportShellWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "deepReportShellSdui";
    host.innerHTML = `
      <p class="hint">간단 요약보다 긴 상세판입니다. 카테고리별 합계, 파일별 구조, 상위 항목, 반복 단가 후보, 확인 필요 항목을 보고서로 정리합니다.</p>
      <div class="print-actions result-actions">
        <button id="btnDeepReport" class="btn btn-dark">📘 상세 보고서 생성</button>
        <button id="btnDeepReportHtml" class="btn btn-primary" type="button" hidden disabled>⬇ 상세 보고서 PDF로 저장</button>
        <button id="btnDeepReportPdf" class="btn btn-ghost" disabled>⬇ 상세 PDF 내려받기</button>
      </div>
      <div id="deepReportArea" style="margin-top:14px"></div>`;
  }

  function renderEvidenceMappingShellWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "evidenceMappingShellSdui";
    host.innerHTML = `
      <p class="hint">파일명·시트명·문자 셀에서 법령, 고시, 지침, 품셈, 단가표 같은 근거 후보를 찾고 수치 항목과 연결합니다.</p>
      <button id="btnEvidence" class="btn btn-dark">⚖ 근거 후보 매핑</button>
      <div id="evidenceArea" style="margin-top:14px"></div>`;
  }

  function renderValidationShellWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "validationShellSdui";
    host.innerHTML = `
      <p class="hint">상위 수치, 단가 산식, 근거 매핑을 사용자가 검증합니다. \`맞음/수정/제외\` 표시는 최종 결과 정리에 반영됩니다.</p>
      <div class="print-actions result-actions">
        <button id="btnValidation" class="btn btn-dark">✅ 검증표 생성</button>
        <button id="btnValidationSummary" class="btn btn-primary" disabled>검증 요약 반영</button>
      </div>
      <div id="validationArea" style="margin-top:14px"></div>`;
  }

  function renderIdeaShellWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "ideaShellSdui";
    host.innerHTML = `
      <p class="hint">분석 자료를 바탕으로 아이디어 확장을 돕는 객관식 질문(2~4개)을 제시합니다.</p>
      <button id="btnIdeas" class="btn btn-dark">🤖 아이디어 질문 생성</button>
      <div id="ideaQuestions" style="margin-top:12px"></div>`;
  }

  function renderPlanShellWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "planShellSdui";
    host.innerHTML = `
      <p class="hint">선택한 아이디어 답변과 분석자료를 바탕으로 진행할 분석 플랜을 생성합니다.</p>
      <button id="btnPlans" class="btn btn-dark">분석 플랜 생성</button>
      <ul class="opt-list" id="planList"></ul>`;
  }

  function renderReportOutputShellWidget(_ctx, _node, host) {
    if (!host) return;
    host.id = "reportOutputShellSdui";
    host.innerHTML = `
      <p class="hint">AI가 정리한 검토 작업과 계산 확인 내용을 리포트로 정리합니다. 오른쪽 원본근거 패널에서 PDF/엑셀 근거를 하이라이트로 확인할 수 있습니다.</p>
      <div id="reportActionsSduiMount"></div>
      <div id="reportViewToggleSduiMount"></div>
      <div id="printArea" class="print-area" style="margin-top:14px"><p class="hint">‘자동 분석 시작’을 누르면 검토 결과가 표시됩니다.</p></div>`;
  }

  function registerAnalysisEditSduiPlugin() {
    window.sduiPages = window.sduiPages || {};
    const current = window.sduiPages["analysis-edit"] || {};
    window.sduiPages["analysis-edit"] = {
      ...current,
      widgets: {
        ...(current.widgets || {}),
        analysis_scope_input: renderAnalysisScopeInputWidget,
        cost_upload_shell: renderCostUploadShellWidget,
        cost_structure_table: renderCostStructureTableWidget,
        result_contract_cards: renderResultContractCardsWidget,
        evidence_viewer: renderEvidenceViewerWidget,
        report_view_toggle: renderReportViewToggleWidget,
        analysis_file_uploader: renderAnalysisFileUploaderWidget,
        analysis_supplement_input: renderAnalysisSupplementInputWidget,
        analysis_run_controls: renderAnalysisRunControlsWidget,
        report_action_buttons: renderReportActionButtonsWidget,
        review_filter_controls: renderReviewFilterControlsWidget,
        edit_review_summary: renderEditReviewSummaryWidget,
        edit_output_cards: renderEditOutputCardsWidget,
        board_summary_shell: renderBoardSummaryShellWidget,
        heuristic_shell: renderHeuristicShellWidget,
        deep_report_shell: renderDeepReportShellWidget,
        evidence_mapping_shell: renderEvidenceMappingShellWidget,
        validation_shell: renderValidationShellWidget,
        idea_shell: renderIdeaShellWidget,
        plan_shell: renderPlanShellWidget,
        report_output_shell: renderReportOutputShellWidget,
      },
    };
  }

  registerAnalysisEditSduiPlugin();

  function bootAnalysisEdit2() {
  const $ = (id) => document.getElementById(id);
  const pageMode = document.body.dataset.page === "analysis-edit" ? "edit" : "default";
  const pageVariant = document.body.dataset.variant || "";
  const isEdit2Page = pageVariant === "analysis-edit2";
  const resultPolicy = globalThis.AnalysisResultPolicy || null;
  const resultPolicyReady = [
    "classifyPlan",
    "parseManualNumber",
    "isHumanFieldResolved",
    "manualAmount",
    "authoritativePlanAmount",
    "aggregateRowAmount",
    "selectEffectiveAmount",
    "summarizeCosts",
    "contractBlockers",
    "reportReadiness",
    "resultKind",
  ].every((name) => typeof resultPolicy?.[name] === "function");
  if (!resultPolicyReady) {
    throw new Error("분석 결과 판정 정책을 불러오지 못했습니다. 페이지를 새로고침해 주세요.");
  }
  if (window.pdfjsLib?.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js";
  }
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const fmtWon = (n) => Number(n).toLocaleString("ko-KR");
  const fmtCurrency = (n) => Math.round(Number(n)).toLocaleString("ko-KR");
  const sourceOf = (r) => `${r.file} · ${r.sheet} · ${r.cell}`;
  const sourceCellAddress = (r) => `${r.sheet || "시트"}!${r.cell || "셀"}`;

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
  document.querySelectorAll("[data-flow-picker]").forEach((step) => {
    step.addEventListener("click", () => showMeetingPicker(true));
  });

  function mountAnalysisScopeInputWidget() {
    let widget = $("analysisScopeSdui");
    if (!widget) {
      widget = document.createElement("div");
      widget.id = "analysisScopeSdui";
      renderAnalysisScopeInputWidget(null, null, widget);
    }
    const mount = $("analysisScopeSduiMount");
    if (mount && widget !== mount) mount.replaceWith(widget);
  }
  mountAnalysisScopeInputWidget();

  function mountCostUploadShellWidget() {
    let widget = $("costUploadShellSdui");
    if (!widget) {
      widget = document.createElement("div");
      renderCostUploadShellWidget(null, null, widget);
    }
    const mount = $("costUploadShellSduiMount");
    if (mount && widget !== mount) mount.replaceWith(widget);
  }
  mountCostUploadShellWidget();

  function mountCostStructureTableWidget() {
    let widget = $("costStructureSdui");
    if (!widget) {
      widget = document.createElement("div");
      widget.id = "costStructureSdui";
      renderCostStructureTableWidget(null, null, widget);
    }
    const mount = $("costStructureSduiMount");
    if (mount && widget !== mount) mount.replaceWith(widget);
  }
  mountCostStructureTableWidget();

  function mountResultContractCardsWidget() {
    let widget = $("editResultContracts");
    if (!widget) {
      widget = document.createElement("div");
      renderResultContractCardsWidget(null, null, widget);
    }
    const mount = $("editResultContractsSduiMount");
    if (mount && widget !== mount) mount.replaceWith(widget);
  }
  mountResultContractCardsWidget();

  function mountEvidenceViewerWidget() {
    let widget = $("evidenceViewer");
    if (!widget) {
      widget = document.createElement("aside");
      renderEvidenceViewerWidget(null, null, widget);
    }
    if (!widget.parentNode) document.body.appendChild(widget);
  }
  mountEvidenceViewerWidget();

  function mountReportOutputShellWidget() {
    let widget = $("reportOutputShellSdui");
    if (!widget) {
      widget = document.createElement("div");
      renderReportOutputShellWidget(null, null, widget);
    }
    const mount = $("reportOutputShellSduiMount");
    if (mount && widget !== mount) mount.replaceWith(widget);
  }
  mountReportOutputShellWidget();

  function mountReportViewToggleWidget() {
    let widget = $("reportViewToggleSdui");
    if (!widget) {
      widget = document.createElement("div");
      widget.id = "reportViewToggleSdui";
      renderReportViewToggleWidget(null, null, widget);
    }
    const mount = $("reportViewToggleSduiMount");
    if (mount && widget !== mount) mount.replaceWith(widget);
  }
  mountReportViewToggleWidget();

  function mountAnalysisFileUploaderWidget(options = {}) {
    let widget = $("analysisFileUploaderSdui");
    if (!widget && options.create) {
      widget = document.createElement("div");
      renderAnalysisFileUploaderWidget(null, null, widget);
    }
    const mount = $("analysisFileUploaderSduiMount");
    if (mount && widget && widget !== mount) mount.replaceWith(widget);
    return widget || null;
  }
  mountAnalysisFileUploaderWidget();

  function mountAnalysisSupplementInputWidget(options = {}) {
    let widget = $("analysisSupplementSdui");
    if (!widget && options.create) {
      widget = document.createElement("div");
      renderAnalysisSupplementInputWidget(null, null, widget);
    }
    const mount = $("analysisSupplementSduiMount");
    if (mount && widget && widget !== mount) mount.replaceWith(widget);
    return widget || null;
  }
  mountAnalysisSupplementInputWidget();

  function mountAnalysisRunControlsWidget() {
    let widget = $("analysisRunControlsSdui");
    if (!widget) {
      widget = document.createElement("div");
      renderAnalysisRunControlsWidget(null, null, widget);
    }
    const mount = $("analysisRunControlsSduiMount");
    if (mount && widget !== mount) mount.replaceWith(widget);
  }
  mountAnalysisRunControlsWidget();

  function mountReportActionButtonsWidget() {
    let widget = $("reportActionsSdui");
    if (!widget) {
      widget = document.createElement("div");
      renderReportActionButtonsWidget(null, null, widget);
    }
    const mount = $("reportActionsSduiMount");
    if (mount && widget !== mount) mount.replaceWith(widget);
  }
  mountReportActionButtonsWidget();

  function mountReviewFilterControlsWidget() {
    let widget = $("reviewFilterControlsSdui");
    if (!widget) {
      widget = document.createElement("div");
      renderReviewFilterControlsWidget(null, null, widget);
    }
    const mount = $("reviewFilterControlsSduiMount");
    if (mount && widget !== mount) mount.replaceWith(widget);
  }
  mountReviewFilterControlsWidget();

  function mountEditReviewSummaryWidget() {
    let widget = $("editReviewSummarySdui");
    if (!widget) {
      widget = document.createElement("div");
      renderEditReviewSummaryWidget(null, null, widget);
    }
    const mount = $("editReviewSummarySduiMount");
    if (mount && widget !== mount) mount.replaceWith(widget);
  }
  mountEditReviewSummaryWidget();

  function mountEditOutputCardsWidget() {
    let widget = $("editOutputCardsSdui");
    if (!widget) {
      widget = document.createElement("div");
      renderEditOutputCardsWidget(null, null, widget);
    }
    const mount = $("editOutputCardsSduiMount");
    if (mount && widget !== mount) mount.replaceWith(widget);
  }
  mountEditOutputCardsWidget();

  function mountStaticShellWidget(widgetId, mountId, render) {
    let widget = $(widgetId);
    if (!widget) {
      widget = document.createElement("div");
      render(null, null, widget);
    }
    const mount = $(mountId);
    if (mount && widget !== mount) mount.replaceWith(widget);
  }
  mountStaticShellWidget("boardSummaryShellSdui", "boardSummaryShellSduiMount", renderBoardSummaryShellWidget);
  mountStaticShellWidget("heuristicShellSdui", "heuristicShellSduiMount", renderHeuristicShellWidget);
  mountStaticShellWidget("deepReportShellSdui", "deepReportShellSduiMount", renderDeepReportShellWidget);
  mountStaticShellWidget("evidenceMappingShellSdui", "evidenceMappingShellSduiMount", renderEvidenceMappingShellWidget);
  mountStaticShellWidget("validationShellSdui", "validationShellSduiMount", renderValidationShellWidget);
  mountStaticShellWidget("ideaShellSdui", "ideaShellSduiMount", renderIdeaShellWidget);
  mountStaticShellWidget("planShellSdui", "planShellSduiMount", renderPlanShellWidget);

  function setupEditModeLayout() {
    if (pageMode !== "edit") return;
    const moveChildren = (cardId, mountId) => {
      const mount = $(mountId);
      const body = document.querySelector(`#${cardId} .acc-real`);
      if (!mount || !body) return;
      while (body.firstChild) mount.appendChild(body.firstChild);
    };
    moveChildren("card-6b", "editBoardMount");
    moveChildren("card-6c", "editHeuristicMount");
    moveChildren("card-6d", "editDeepReportMount");
    moveChildren("card-6e", "editEvidenceMount");
    moveChildren("card-7", "editIdeaMount");
    moveChildren("card-8", "editPlanMount");
  }
  setupEditModeLayout();

  /* ---------- 1~2. 녹음텍스트 입력/보기 ---------- */
  const transcript = $("transcript"), dateEl = $("meetingDate"), timeEl = $("meetingTime"),
    attendees = $("attendees"), subject = $("subject"), genStatus = $("genStatus"), pageStatus = $("pageStatus");
  dateEl.value = todayISO();
  const DEFAULT_DECISION_CRITERIA = "근거 있는 수치, 구체적인 요구사항, 법령/출처 명시, 원가 산정식, 분석한 원가 수치";
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
  const meetingResultPanel = $("meetingResultPanel");
  const meetingPicker = $("meetingPicker"), meetingPickList = $("meetingPickList"), meetingPickStatus = $("meetingPickStatus"), meetingPickFilter = $("meetingPickFilter");
  let meetingsLoaded = false;
  let selectedMeetingId = null;
  let meetingChoices = [];

  function meetingStatus(msg, err) {
    if (!meetingPickStatus) return;
    meetingPickStatus.innerHTML = msg;
    meetingPickStatus.classList.toggle("danger", !!err);
  }

  function friendlyMeetingTitle(item) {
    const date = String(item?.date || "").trim();
    const raw = String(item?.title || "").trim();
    if (!raw) return date ? `${date} 회의` : "회의록";
    return raw
      .replace(/\.md$/i, "")
      .replace(/^(\d{4}-\d{2}-\d{2})[_\s-]*meeting$/i, "$1 회의");
  }

  function meetingDateText(item) {
    return [item.date, item.created_at ? `생성 ${String(item.created_at).slice(0, 10)}` : ""].filter(Boolean).join(" · ") || "-";
  }

  function filteredMeetingChoices() {
    const q = String(meetingPickFilter?.value || "").trim().toLowerCase();
    if (!q) return meetingChoices;
    return meetingChoices.filter((item) => [
      friendlyMeetingTitle(item),
      item.title,
      item.date,
      item.created_at,
    ].filter(Boolean).join(" ").toLowerCase().includes(q));
  }

  function renderMeetingChoices(meetings) {
    if (!meetingPickList) return;
    if (!meetings.length) {
      meetingPickList.innerHTML = '<p class="hint">조건에 맞는 회의록이 없습니다. 검색어를 줄이거나 새로고침하세요.</p>';
      return;
    }
    meetingPickList.innerHTML = meetings.map((item) => `
      <article class="meeting-pick-item">
        <div>
          <div class="meeting-pick-title">${esc(friendlyMeetingTitle(item))}</div>
          <div class="meeting-pick-meta">${esc(meetingDateText(item))}</div>
        </div>
        <button class="btn btn-primary btn-small" type="button" data-meeting-pick="${esc(item.id)}">선택</button>
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
          const loginButton = window.githubLoginButtonHtml
            ? window.githubLoginButtonHtml("github-login-btn github-login-btn-inline", "GitHub로 로그인")
            : '<a class="github-login-btn github-login-btn-inline" href="/api/auth/github">GitHub로 로그인</a>';
          meetingStatus(`기존 회의록을 불러오려면 ${loginButton}이 필요합니다.`, true);
          return;
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      meetingsLoaded = true;
      meetingChoices = data.meetings || [];
      renderMeetingChoices(filteredMeetingChoices());
      meetingStatus(meetingChoices.length ? `저장된 회의록 ${meetingChoices.length}개` : "저장된 회의록이 없습니다.");
    } catch (err) {
      meetingStatus("회의록 목록 로드 실패: " + err.message, true);
    }
  }

  function showMeetingPicker(load) {
    if (!meetingPicker) return;
    $("card-4").hidden = false;
    if (pageMode === "edit") openCard(4, false);
    meetingPicker.hidden = false;
    if (meetingResultPanel && !markdown.value.trim()) meetingResultPanel.hidden = true;
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
    if (title && projectName && !controlValue(projectName)) setFormControlValue(projectName, title);
    if (title && analysisTopic && !controlValue(analysisTopic)) setFormControlValue(analysisTopic, title);
    $("card-4").hidden = false;
    fname.textContent = friendlyMeetingTitle({ title, date: date || dateEl.value || todayISO() });
    if (meetingResultPanel) meetingResultPanel.hidden = false;
    setView(false);
    markStepDone(4);
    prepLocalStatus("회의록이 연결되었습니다. 분석파일을 추가하거나 자료 준비 완료를 체크해 다음 단계로 진행하세요.", false);
    status(`✅ 회의록을 가져왔습니다: ${friendlyMeetingTitle({ title, date })}`);
    openCard(pageMode === "edit" ? 4 : 5, true);
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
      meetingStatus(`선택됨: ${esc(friendlyMeetingTitle(data))}`);
    } catch (err) {
      meetingStatus("회의록 불러오기 실패: " + err.message, true);
    } finally {
      if (button) { button.disabled = false; button.textContent = original || "선택"; }
    }
  }

  $("btnReloadMeetings")?.addEventListener("click", () => loadMeetingChoices(true));
  $("btnNewMeetingFlow")?.addEventListener("click", () => { location.href = "/feature/"; });
  meetingPickFilter?.addEventListener("input", () => renderMeetingChoices(filteredMeetingChoices()));
  meetingPickList?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-meeting-pick]");
    if (btn) pickMeeting(btn.dataset.meetingPick, btn);
  });

  function applyPrefillTranscript() {
    let payload = null;
    try {
      const raw = sessionStorage.getItem("analysisEdit2.prefillTranscript");
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    if (!payload?.transcript) return;
    transcript.value = String(payload.transcript || "").trim();
    if (payload.date) dateEl.value = String(payload.date).slice(0, 10);
    if (payload.title && !subject.value.trim()) subject.value = String(payload.title).slice(0, 180);
    transcript.dispatchEvent(new Event("input", { bubbles: true }));
    sessionStorage.removeItem("analysisEdit2.prefillTranscript");
    ["card-1", "card-2", "card-3"].forEach((id) => {
      const card = $(id);
      if (card) card.hidden = false;
    });
    status(`클로바 녹음 텍스트를 불러왔습니다. ${payload.title || ""}`.trim());
    openCard(2, true);
  }
  applyPrefillTranscript();

  const analysisTemplates = {
    generic: {
      id: "generic",
      label: "일반 자료 분석",
      projectName: "범용 프로젝트 분석",
      analysisTopic: "업로드한 자료에서 핵심 쟁점과 다음 실행안을 빠르게 도출",
      outputGoal: "간단 요약, 주요 근거 목록, 실행 체크리스트",
      decisionCriteria: DEFAULT_DECISION_CRITERIA,
      etcNote: "프로젝트 종류와 파일 형식에 상관없이 전체 자료의 구조를 먼저 파악하고, 중요한 수치·문장·의사결정 포인트를 분리하고 싶다.",
      requiredDocs: ["회의록", "보고서", "정책자료"],
      checks: ["핵심 쟁점", "근거 출처", "다음 실행"],
    },
    "manufacturing-purchase": {
      id: "manufacturing-purchase",
      label: "제조·구매 원가 검토",
      projectName: "제조·구매 원가 검토",
      analysisTopic: "구매 견적서와 원가 자료에서 단가·수량·금액 근거 확인",
      outputGoal: "품목별 단가/수량/금액 검증표, 기준 대비 차이, 담당자 확인 항목",
      decisionCriteria: "내역서/단가대비표 원본 셀, 수량×단가 산식, 기준 단가 대비 잔차·오차율, 공급사/품목별 근거 표시",
      etcNote: "제조·구매 원가 검토입니다. 품목명, 규격, 수량, 적용단가, 산출금액을 원본 셀과 함께 분리하고 기준값 대비 차이를 표시해 달라.",
      requiredDocs: ["내역서", "단가대비표", "견적서"],
      checks: ["수량×단가", "기준 단가", "차액/오차율"],
    },
    "construction-cost": {
      id: "construction-cost",
      label: "공사비 내역 검토",
      projectName: "공사비 내역 검토",
      analysisTopic: "공사 내역서에서 재료비·노무비·경비·합계 구조 확인",
      outputGoal: "공종/품목별 재료비·노무비·경비 산식, 합계 검증, 이상 금액 목록",
      decisionCriteria: "공종·품목·규격·단위별 원본 셀, 수량×단가×금액 관계, 합계/총계 검산, 기준 단가 출처",
      etcNote: "공사비 내역 검토입니다. 내역서의 공종, 품명, 규격, 단위, 수량, 재료비/노무비/경비 단가와 금액을 구조화해 달라.",
      requiredDocs: ["공사 내역서", "일위대가", "단가표"],
      checks: ["공종 구조", "금액 합계", "일위대가"],
    },
    "academic-service": {
      id: "academic-service",
      label: "학술·연구용역 산정",
      projectName: "학술·연구용역 산정",
      analysisTopic: "연구용역 예산에서 인건비·경비·일반관리비·부가세 구조 검토",
      outputGoal: "인력/기간/단가 기반 산정식, 비목별 합계, 증빙·확인 필요 항목",
      decisionCriteria: "참여율·기간·단가 근거, 비목별 합계, 일반관리비/이윤/부가세 적용 기준, 담당자 확인 항목 표시",
      etcNote: "학술·연구용역 산정입니다. 인력 투입량과 기간, 적용 단가, 일반관리비·부가세 적용 여부를 분리하고 계산 근거를 확인해 달라.",
      requiredDocs: ["산출내역서", "인력 투입계획", "단가기준"],
      checks: ["인력×기간", "비목 합계", "요율 적용"],
    },
    "software-fee": {
      id: "software-fee",
      label: "SW 사업비 산정",
      projectName: "SW 사업비 산정",
      analysisTopic: "SW 개발/운영 사업비에서 기능점수·투입공수·라이선스 비용 확인",
      outputGoal: "기능/공수/단가 기반 산정식, 라이선스·운영비 목록, 검증 필요 항목",
      decisionCriteria: "기능점수·공수·단가 출처, 라이선스 수량/단가, 유지보수 요율, 원본 셀/페이지 근거 표시",
      etcNote: "SW 사업비 산정입니다. 개발비, 라이선스, 유지보수, 운영비를 구분하고 산식과 근거 자료 위치를 함께 보여 달라.",
      requiredDocs: ["SW 사업비 산정표", "기능목록", "라이선스 견적"],
      checks: ["기능/공수", "단가 출처", "유지보수 요율"],
    },
    policy: {
      id: "policy",
      label: "정책·법령 검토",
      projectName: "정책·법령 검토",
      analysisTopic: "정책자료와 법령/고시 문서에서 적용 기준과 예외 조건 확인",
      outputGoal: "근거 조항 목록, 검토 필요 쟁점, 보고서 초안",
      decisionCriteria: "법령/고시 출처, 적용 기준, 예외 조건, 담당자 확인 항목 표시",
      etcNote: "정책/법령 검토입니다. 문서별 기준이 다를 수 있으므로 근거 문구와 적용 조건을 분리하고, 불명확한 항목은 검토 필요로 표시해 달라.",
      requiredDocs: ["정책자료", "법령", "고시/지침"],
      checks: ["근거 조항", "적용 조건", "예외"],
    },
    budget: {
      id: "budget",
      label: "예산 비교",
      projectName: "예산 비교 검토",
      analysisTopic: "기존 예산과 변경 예산의 차이, 큰 금액 항목, 근거 자료 확인",
      outputGoal: "예산 차이 표, 주요 증감 사유, 근거 파일 위치",
      decisionCriteria: "큰 금액 우선, 증감 사유, 원본 셀/페이지 근거, 담당자 확인 항목 표시",
      etcNote: "예산 비교입니다. 기존/변경 금액의 차이를 먼저 찾고, 차이가 큰 항목의 근거 셀과 설명 문구를 함께 보여 달라.",
      requiredDocs: ["기존 예산", "변경 예산", "증감 사유서"],
      checks: ["차액", "증감 사유", "근거 셀"],
    },
    hydro: {
      id: "hydro",
      label: "수문조사 분석",
      projectName: "수문조사 분석 테스트",
      analysisTopic: "수문조사 사업 자료에서 조사 단위, 인원, 시간, 비용 구조 파악",
      outputGoal: "1개 강/수문 조사 단위당 인원·시간·비용의 단순 산식 후보와 검증표",
      decisionCriteria: DEFAULT_DECISION_CRITERIA,
      etcNote: "수문분석 예시입니다. 처음에는 복잡한 회귀보다 지점 수 또는 조사 단위 수 하나만 쓰는 단가 산식으로 시작하고, 오차와 담당자 확인 항목을 명시해 달라.",
      requiredDocs: ["수문조사 계획서", "비용 내역서", "조사 단위 자료"],
      checks: ["지점수", "단가", "오차율"],
    },
  };
  const exampleAliases = {
    cost: "manufacturing-purchase",
    generic: "generic",
    policy: "policy",
    budget: "budget",
    hydro: "hydro",
  };
  const examples = Object.fromEntries(Object.entries(exampleAliases).map(([key, id]) => [key, analysisTemplates[id]]));

  function currentAnalysisTemplate() {
    return analysisTemplates[selectedAnalysisTemplateId] || analysisTemplates.generic;
  }

  function templateIdFromText(text) {
    const query = String(text || "").trim();
    if (!query) return "";
    return Object.values(analysisTemplates).find((template) => template.id === query || template.label === query)?.id || "";
  }

  function renderAnalysisTemplateSummary(template = currentAnalysisTemplate()) {
    if (!analysisTemplateSummary || !template) return;
    const required = (template.requiredDocs || []).map((item) => `<span>${esc(item)}</span>`).join("");
    const checks = (template.checks || []).map((item) => `<span>${esc(item)}</span>`).join("");
    analysisTemplateSummary.innerHTML = `
      <strong>${esc(template.label)}</strong>
      <p>${esc(template.outputGoal)}</p>
      <div class="analysis-template-chips">${required ? `<b>필요 자료</b>${required}` : ""}</div>
      <div class="analysis-template-chips">${checks ? `<b>검증 관점</b>${checks}` : ""}</div>`;
    document.querySelectorAll("[data-template]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.template === template.id);
    });
  }

  function setFieldValue(el, value, preserveExisting) {
    if (!el) return;
    if (preserveExisting && String(el.value || "").trim()) return;
    el.value = value || "";
  }

  function syncSupplementInputs() {
    const urlEl = $("etcUrl");
    const noteEl = $("etcNote");
    if (urlEl) {
      if (supplementalEtcUrl && !urlEl.value) urlEl.value = supplementalEtcUrl;
      supplementalEtcUrl = urlEl.value || "";
    }
    if (noteEl) {
      if (supplementalEtcNote && !noteEl.value) noteEl.value = supplementalEtcNote;
      supplementalEtcNote = noteEl.value || "";
    }
  }

  function getEtcUrlValue() {
    const el = $("etcUrl");
    return String(el?.value ?? supplementalEtcUrl ?? "").trim();
  }

  function getEtcNoteValue() {
    const el = $("etcNote");
    return String(el?.value ?? supplementalEtcNote ?? "");
  }

  function setEtcUrlValue(value, cacheWhenMissing = true) {
    const text = String(value || "");
    const el = $("etcUrl");
    if (el) el.value = text;
    if (el || cacheWhenMissing) supplementalEtcUrl = text;
  }

  function setEtcNoteValue(value, preserveExisting, cacheWhenMissing = true) {
    const text = String(value || "");
    const el = $("etcNote");
    if (el) {
      if (preserveExisting && String(el.value || "").trim()) {
        supplementalEtcNote = el.value;
        return;
      }
      el.value = text;
      supplementalEtcNote = text;
      return;
    }
    if (cacheWhenMissing && !(preserveExisting && supplementalEtcNote.trim())) supplementalEtcNote = text;
  }

  function applyAnalysisTemplate(id, options = {}) {
    const template = analysisTemplates[id] || analysisTemplates[exampleAliases[id]] || analysisTemplates.generic;
    selectedAnalysisTemplateId = template.id;
    if (analysisTemplateEl) analysisTemplateEl.value = template.id;
    const preserve = !!options.preserveExisting;
    if (!options.summaryOnly) {
      setFormControlValue(projectName, preserve && controlValue(projectName) ? controlValue(projectName) : template.projectName);
      setFormControlValue(analysisTopic, preserve && controlValue(analysisTopic) ? controlValue(analysisTopic) : template.analysisTopic);
      setFieldValue(outputGoal, template.outputGoal, preserve);
      setFieldValue(decisionCriteria, template.decisionCriteria, preserve);
      setEtcNoteValue(template.etcNote, preserve, false);
      if (subject && (!subject.value.trim() || options.forceSubject)) subject.value = template.analysisTopic;
    }
    renderAnalysisTemplateSummary(template);
    if (options.announce) status(`분석 유형을 적용했습니다: ${template.label}`);
    return template;
  }

  document.querySelectorAll("[data-office-jump]").forEach((btn) => {
    btn.addEventListener("click", () => openCard(btn.dataset.officeJump, true));
  });
  document.querySelectorAll("[data-example], [data-template]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.template || btn.dataset.example;
      if (!id) return;
      applyAnalysisTemplate(id, { announce: true, forceSubject: false });
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
    if (!markdown.value.trim()) return;
    const html = fullHtml("회의록", renderMarkdown(markdown.value), "회의록을 PDF로 저장합니다.");
    printHtmlReport(html, "회의록 PDF");
  }
  $("btnDownload")?.addEventListener("click", download);
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
      $("card-4").hidden = false;
      fname.textContent = friendlyMeetingTitle({ title: subject.value, date: dateEl.value || todayISO() });
      if (meetingResultPanel) meetingResultPanel.hidden = false;
      setView(false);
      if (window.refreshUsage) window.refreshUsage();
      const cost = data.cost_krw != null ? ` · ${data.cost_krw.toFixed(2)}원` : "";
      status(`✅ 회의록 생성 완료 (${data.provider}/${data.model})${cost}`);
      openCard(4, true);
    } catch (err) {
      status("❌ 실패: " + (window.apiErrorMessage ? window.apiErrorMessage(err, "회의록 생성") : err.message), true);
    } finally { btn.disabled = false; }
  });

  /* ---------- 5. 작업공간·자료 준비 (R2 업로드 + 게이트) ---------- */
  const analysisFiles = []; // { localId, id?, name, size, type, file?, costFile?, uploaded, textAvailable }
  let analysisSessionId = null;
  let analysisSummaries = [];
  let analysisQuestions = [];
  let analysisPlans = [];
  let analysisExecution = null;
  let analysisPlanRuns = null;
  let planExecutionResults = [];
  let reportStorageState = "idle";
  let reportStorageError = "";
  let reviewFilter = "all";
  let resultViewMode = "summary";
  let activeEvidencePopover = null;
  let projectName = $("projectName"), analysisTopic = $("analysisTopic");
  const outputGoal = $("outputGoal"), decisionCriteria = $("decisionCriteria");
  const analysisTemplateEl = $("analysisTemplate"), analysisTemplateSummary = $("analysisTemplateSummary");
  let selectedAnalysisTemplateId = analysisTemplateEl?.value || "generic";
  let supplementalEtcUrl = "";
  let supplementalEtcNote = "";
  if (decisionCriteria && !decisionCriteria.value.trim()) decisionCriteria.value = DEFAULT_DECISION_CRITERIA;

  function isSelectControl(el) {
    return !!el && el.tagName === "SELECT";
  }

  function setFormControlValue(el, value, label) {
    if (!el) return;
    const text = String(value || "").trim();
    if (isSelectControl(el) && text && !Array.from(el.options).some((option) => option.value === text)) {
      const option = document.createElement("option");
      option.value = text;
      option.textContent = label || text;
      el.appendChild(option);
    }
    el.value = text;
  }

  function controlValue(el) {
    return String(el?.value || "").trim();
  }

  function resetSelectOptions(select, placeholder) {
    if (!isSelectControl(select)) return;
    select.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    select.appendChild(option);
  }

  function addSelectOption(select, value, label, dataset = {}) {
    if (!isSelectControl(select) || !value) return;
    if (Array.from(select.options).some((option) => option.value === value)) return;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label || value;
    Object.entries(dataset).forEach(([key, dataValue]) => {
      if (dataValue != null) option.dataset[key] = String(dataValue);
    });
    select.appendChild(option);
  }

  function ensureGithubScopeControls() {
    if (projectName && analysisTopic) return;
    const host = $("githubScopeFields");
    if (!host) return;
    if (!projectName) {
      const projectLabel = document.createElement("label");
      projectLabel.id = "githubProjectField";
      projectLabel.dataset.githubOnly = "true";
      projectLabel.hidden = true;
      projectLabel.appendChild(document.createTextNode("GitHub 프로젝트"));
      const select = document.createElement("select");
      select.id = "projectName";
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "GitHub Project 선택";
      select.appendChild(option);
      projectLabel.appendChild(select);
      host.appendChild(projectLabel);
      projectName = select;
    }
    if (!analysisTopic) {
      const workspaceLabel = document.createElement("label");
      workspaceLabel.id = "githubWorkspaceField";
      workspaceLabel.dataset.githubOnly = "true";
      workspaceLabel.hidden = true;
      workspaceLabel.appendChild(document.createTextNode("작업공간"));
      const select = document.createElement("select");
      select.id = "analysisTopic";
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "GitHub repo 선택";
      select.appendChild(option);
      workspaceLabel.appendChild(select);
      host.appendChild(workspaceLabel);
      analysisTopic = select;
    }
  }

  analysisTemplateEl?.addEventListener("change", () => {
    applyAnalysisTemplate(analysisTemplateEl.value, { announce: true, forceSubject: false });
  });
  applyAnalysisTemplate(selectedAnalysisTemplateId, { preserveExisting: true });

  async function fetchJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function setGithubOnlyVisible(visible) {
    if (!isEdit2Page) return;
    document.querySelectorAll("[data-github-only]").forEach((el) => {
      el.hidden = !visible;
    });
  }

  function populateGithubProjects(projects, defaultTitle) {
    if (!isSelectControl(projectName)) return;
    const current = projectName.value;
    resetSelectOptions(projectName, "GitHub Project 선택");
    (projects || []).forEach((project) => {
      const title = String(project.title || "").trim();
      if (!title) return;
      const number = project.number ? ` #${project.number}` : "";
      addSelectOption(projectName, title, `${title}${number}`, { projectId: project.id || "", projectNumber: project.number || "" });
    });
    if (!projects?.length) addSelectOption(projectName, "", "연결된 GitHub Project 없음");
    setFormControlValue(projectName, current || defaultTitle || "");
  }

  function populateGithubRepos(repos, defaultRepo) {
    if (!isSelectControl(analysisTopic)) return;
    const current = analysisTopic.value;
    resetSelectOptions(analysisTopic, "GitHub repo 선택");
    (repos || []).forEach((repo) => {
      const fullName = String(repo.full_name || "").trim();
      if (!fullName) return;
      addSelectOption(analysisTopic, fullName, repo.private ? `${fullName} · private` : fullName);
    });
    if (!repos?.length) addSelectOption(analysisTopic, "", "선택 가능한 repo 없음");
    setFormControlValue(analysisTopic, current || defaultRepo || "");
  }

  async function loadGithubPrepOptions() {
    const [defaultsResult, reposResult, projectsResult] = await Promise.allSettled([
      fetchJson("/api/git/defaults"),
      fetchJson("/api/git/repos"),
      fetchJson("/api/git/projects"),
    ]);
    const defaults = defaultsResult.status === "fulfilled" ? defaultsResult.value : {};
    if (projectsResult.status === "fulfilled") {
      populateGithubProjects(projectsResult.value.projects || [], defaults.default_project_title || "");
    }
    if (reposResult.status === "fulfilled") {
      populateGithubRepos(reposResult.value.repos || [], defaults.default_repo || "");
    }
    const errors = [reposResult, projectsResult]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || "목록 로드 실패");
    if (errors.length) {
      prepLocalStatus(`GitHub 프로젝트/작업공간 목록 로드 실패: ${errors.join(" / ")}`, true);
    } else {
      prepLocalStatus("GitHub 프로젝트와 작업공간 목록을 불러왔습니다. 자료 없이도 기대 산출물 기준 검색형 분석을 시작할 수 있습니다.", false);
    }
  }

  async function initIdentityScopedPrep() {
    if (!isEdit2Page) return;
    try {
      const me = await fetchJson("/api/me");
      const githubUser = !!me.loggedIn && (me.provider === "github" || String(me.userId || "").startsWith("gh:"));
      if (githubUser) {
        ensureGithubScopeControls();
        mountAnalysisFileUploaderWidget({ create: true });
        mountAnalysisSupplementInputWidget({ create: true });
        syncSupplementInputs();
        bindAnalysisFileUploader();
      }
      setGithubOnlyVisible(githubUser);
      if (!githubUser) {
        setFormControlValue(projectName, "");
        setFormControlValue(analysisTopic, "");
        prepLocalStatus("기대 산출물과 의사결정 기준만 입력해 검색형 분석을 진행합니다.", false);
        return;
      }
      await loadGithubPrepOptions();
    } catch {
      setGithubOnlyVisible(false);
      prepLocalStatus("로그인 정보를 확인하지 못했습니다. 기대 산출물과 의사결정 기준만으로 검색형 분석을 진행할 수 있습니다.", false);
    }
  }

  function cleanFileTitle(text) {
    return String(text || "")
      .replace(/\.(pdf|xlsx?|docx?|html?|md|csv)$/i, "")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function reportBaseTitleText() {
    const base = cleanFileTitle(controlValue(analysisTopic) || subject?.value || controlValue(projectName) || "분석설계 결과");
    return base || "분석설계 결과";
  }

  function reportTitleText() {
    const base = reportBaseTitleText();
    if (/보고서$/i.test(base)) return base;
    return /분석/.test(base) ? `${base} 보고서` : `${base} 분석 보고서`;
  }

  function reportDownloadName(ext, suffix = "") {
    const title = suffix ? `${reportTitleText()} - ${suffix}` : reportTitleText();
    return `${cleanFileTitle(title) || "분석 보고서"}.${String(ext || "pdf").replace(/^\./, "")}`;
  }

  function artifactDownloadName(ext, suffix = "") {
    const label = suffix ? `${reportBaseTitleText()} ${suffix}` : reportBaseTitleText();
    return `${cleanFileTitle(label) || "분석설계 산출물"}.${String(ext || "pdf").replace(/^\./, "")}`;
  }

  function officeLabel(text) {
    return sanitizeTechnicalText(text)
      .replace(/`?\bhuman_todos\b`?/gi, "추가 확인 사항")
      .replace(/`?\bneeds_human_action\b`?/gi, "담당자 확인 필요")
      .replace(/`?\bartifact_markdown\b`?/gi, "보고서 본문")
      .replace(/`?\bexecuted\b`?/gi, "처리 결과");
  }

  function sanitizeTechnicalText(text) {
    return String(text || "")
      .replace(/\bR2\b/gi, "서버 저장소")
      .replace(/\b(?:application|text|image)\/[a-z0-9.+_/-]+/gi, "등록 파일")
      .replace(/\b(?:file_id|chunk_id)\s*=\s*[^\s,)]+/gi, "등록 자료")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "등록 자료");
  }

  function hasOpaqueSourceId(text) {
    return /\b(?:file_id|chunk_id)\s*=|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(String(text || ""));
  }

  function friendlyFileType(file) {
    const name = String(file?.name || "");
    const type = String(file?.type || "");
    if (/\.pdf$/i.test(name) || /pdf/i.test(type)) return "PDF";
    if (/\.(xlsx?|csv)$/i.test(name) || /spreadsheet|excel|csv/i.test(type)) return "Excel";
    if (/\.docx?$/i.test(name) || /word/i.test(type)) return "문서";
    if (/\.(png|jpe?g|gif|webp)$/i.test(name) || /^image\//i.test(type)) return "이미지";
    return "파일";
  }

  function uniqueLines(lines) {
    const seen = new Set();
    return lines.map((line) => String(line || "").trim()).filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
  }

  function stripAutoPreferenceLines(text) {
    return uniqueLines(String(text || "").split(/\r?\n/).filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("이번 분석의 중요 기준:") && !trimmed.startsWith("보고서 우선 결과:");
    })).join("\n");
  }

  function setThoughtCriteriaFromText(text) {
    const values = String(text || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (!values.length) return;
    document.querySelectorAll("[data-thought-criteria]").forEach((input) => {
      input.checked = values.includes(input.value);
    });
  }

  function setReportFocusFromText(text) {
    const value = String(text || "").trim();
    if (!value) return;
    const input = Array.from(document.querySelectorAll('input[name="reportFocus"]')).find((item) => item.value === value);
    if (input) input.checked = true;
  }
  let fileListEl = $("analysisFileList"), fileEmpty = $("analysisFileEmpty");
  const prepStatus = $("prepStatus");
  let analysisDrop = $("analysisDrop"), analysisFileInput = $("analysisFileInput");
  let analysisFileEventsBound = false;
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
        label: file.truncatedNote ? "서버 등록 완료 · 발췌본" : "서버 등록 완료 · 텍스트 분석 가능",
        reason: file.truncatedNote || "",
        title: file.truncatedNote || "서버가 텍스트 발췌를 만들어 AI 요약에 사용할 수 있습니다.",
      };
    }
    const reason = file.textExtractReason || fallbackTextExtractReason(file);
    return { label: "서버 등록 완료 · 텍스트 추출 불가", reason, title: reason };
  }

  function combinedAnalysisNote() {
    const lines = [];
    const template = currentAnalysisTemplate();
    if (template?.label) lines.push(`분석 유형: ${template.label}`);
    if (template?.requiredDocs?.length) lines.push(`필요 자료: ${template.requiredDocs.join(", ")}`);
    if (template?.checks?.length) lines.push(`검증 관점: ${template.checks.join(", ")}`);
    if (outputGoal.value.trim()) lines.push(`기대 산출물: ${outputGoal.value.trim()}`);
    if (decisionCriteria.value.trim()) lines.push(`의사결정 기준: ${decisionCriteria.value.trim()}`);
    if (pageMode === "edit") {
      const selectedCriteria = Array.from(document.querySelectorAll("[data-thought-criteria]:checked"))
        .map((el) => el.value)
        .filter(Boolean);
      const criteria = selectedCriteria.length ? selectedCriteria : ["비용/단가 중심", "법령·근거 중심"];
      const reportFocus = document.querySelector('input[name="reportFocus"]:checked')?.value || "";
      if (criteria.length) lines.push(`이번 분석의 중요 기준: ${criteria.join(", ")}`);
      lines.push(`보고서 우선 결과: ${reportFocus || "간단 요약"}`);
    }
    const memo = stripAutoPreferenceLines(getEtcNoteValue());
    if (memo.trim()) lines.push(`메모: ${memo.trim()}`);
    return uniqueLines(lines).join("\n");
  }

  function analysisContext(extra) {
    return {
      title: controlValue(projectName),
      date: dateEl.value,
      subject: controlValue(analysisTopic) || subject.value,
      meetingMarkdown: markdown.value,
      etcUrl: getEtcUrlValue(),
      etcNote: combinedAnalysisNote(),
      analysisTemplate: currentAnalysisTemplate()?.id || selectedAnalysisTemplateId,
      sourceMode: pageMode,
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
    if (!res.ok) {
      const error = new Error(data.error || `HTTP ${res.status}`);
      error.code = data.code || "";
      error.pendingInputs = Array.isArray(data.pending_inputs) ? data.pending_inputs : [];
      throw error;
    }
    return data;
  }

  async function ensureAnalysisSession() {
    if (analysisSessionId) return analysisSessionId;
    const data = await postJSON("/api/analysis/sessions", analysisContext());
    analysisSessionId = data.id;
    return analysisSessionId;
  }

  const uploadPolicy = window.AnalysisUploadPolicy;

  // PDF/엑셀 텍스트 추출(브라우저) — 서버에 파서가 없으므로 클라이언트에서 뽑아 text_excerpt 로 전달한다.
  const PDF_MAX_PAGES = 90, PDF_MAX_CHARS = 60000;
  const SHEET_MAX_ROWS = 180, SHEET_MAX_COLS = 24, SHEET_MAX_CHARS = 60000;
  function isPdf(name, type) {
    return /\.pdf$/i.test(String(name || "")) || /pdf/i.test(String(type || ""));
  }
  function isSpreadsheet(name, type) {
    return /\.(xlsx|xls|csv)$/i.test(String(name || "")) || /spreadsheet|excel|csv/i.test(String(type || ""));
  }
  function sampledIndexes(total, limit) {
    const count = Number(total) || 0;
    if (count <= 0) return [];
    if (count <= limit) return Array.from({ length: count }, (_, i) => i);
    const each = Math.max(1, Math.floor(limit / 3));
    const starts = [0, Math.max(0, Math.floor(count / 2) - Math.floor(each / 2)), Math.max(0, count - each)];
    const picked = new Set();
    starts.forEach((start) => {
      for (let i = start; i < Math.min(count, start + each); i++) picked.add(i);
    });
    return [...picked].sort((a, b) => a - b).slice(0, limit);
  }
  function rangeSummary(indexes) {
    if (!indexes.length) return "-";
    const ranges = [];
    let start = indexes[0], prev = indexes[0];
    for (let i = 1; i < indexes.length; i++) {
      if (indexes[i] === prev + 1) { prev = indexes[i]; continue; }
      ranges.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
      start = prev = indexes[i];
    }
    ranges.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
    return ranges.join(", ");
  }
  async function parsePdfText(file) {
    if (!window.pdfjsLib) throw new Error("PDF 파서 로드 실패(pdf.js). 네트워크를 확인하세요.");
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js";
    }
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const parts = [];
    const pageIndexes = sampledIndexes(pdf.numPages, PDF_MAX_PAGES);
    parts.push(`[PDF: ${file.name} | 전체 페이지 ${pdf.numPages} | 발췌 페이지 ${rangeSummary(pageIndexes)}]`);
    for (const pageIndex of pageIndexes) {
      const page = await pdf.getPage(pageIndex + 1);
      const content = await page.getTextContent();
      const text = content.items.map((it) => it.str || "").join(" ").replace(/\s+/g, " ").trim();
      if (text) parts.push(`[page ${pageIndex + 1}]\n${text}`);
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
      const indexes = sampledIndexes(rows.length, SHEET_MAX_ROWS);
      const lines = indexes.map((rowIndex) => {
        const row = rows[rowIndex] || [];
        const text = row
          .slice(0, SHEET_MAX_COLS)
          .map((cell) => String(cell ?? "").trim())
          .filter(Boolean)
          .join(" | ");
        return text ? `[row ${rowIndex + 1}] ${text}` : "";
      }
      ).filter(Boolean);
      if (lines.length) parts.push(`[시트: ${sheetName} | 전체 행 ${rows.length} | 발췌 행 ${rangeSummary(indexes)}]\n${lines.join("\n")}`);
    });
    return parts.join("\n\n").slice(0, SHEET_MAX_CHARS).trim();
  }

  // 서버 한도(파일 6MB / 요청 15MB)를 넘기지 않도록 파일별 전송 형태와 요청 묶음을 미리 정한다.
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
      return {
        blob: new Blob([text], { type: "text/plain" }),
        name: `${f.name}.excerpt.txt`,
        text,
      };
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

  function hasSourceMaterial() {
    return analysisFiles.length > 0 || !!markdown.value.trim();
  }

  async function ensureAnalysisReady() {
    const searchOnly = !hasSourceMaterial();
    await ensureAnalysisSession();
    await uploadPendingFiles();
    if (searchOnly) prepLocalStatus("분석파일·회의록 없이 리트리버 검색 모드로 진행합니다. 기대 산출물을 검색 질의로 사용합니다.", false);
  }

  function renderFileList() {
    fileListEl = fileListEl || $("analysisFileList");
    fileEmpty = fileEmpty || $("analysisFileEmpty");
    if (!fileListEl || !fileEmpty) {
      if (pageMode === "edit") renderEditCalculationReview();
      return;
    }
    fileListEl.innerHTML = "";
    analysisFiles.forEach((f, i) => {
      const li = document.createElement("li");
      const state = textExtractionState(f);
      const stateLabel = pageMode === "edit"
        ? (!f.uploaded ? "등록 대기" : (state.reason ? "확인 필요" : "등록됨"))
        : state.label;
      const reason = state.reason ? `<span class="fl-reason">${esc(state.reason)}</span>` : "";
      li.innerHTML = `<span class="fl-main"><span class="fl-name"></span>${reason}</span><span class="fl-size">${fmtSize(f.size)}</span>` +
        `<span class="fl-state" title="${attr(state.title)}">${esc(stateLabel)}</span><button class="btn btn-ghost btn-small" data-rm="${i}">빼기</button>`;
      li.querySelector(".fl-name").textContent = f.name;
      fileListEl.appendChild(li);
    });
    fileEmpty.hidden = analysisFiles.length > 0;
    if (pageMode === "edit") renderEditCalculationReview();
  }
  function bindAnalysisFileUploader() {
    fileListEl = $("analysisFileList");
    fileEmpty = $("analysisFileEmpty");
    analysisDrop = $("analysisDrop");
    analysisFileInput = $("analysisFileInput");
    if (!fileListEl || !analysisDrop || !analysisFileInput || analysisFileEventsBound) return !!analysisFileEventsBound;
    analysisFileEventsBound = true;
    fileListEl.addEventListener("click", async (e) => {
      e.stopPropagation();
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
    analysisDrop.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files.length) addAnalysisFiles(e.dataTransfer.files); });
    analysisFileInput.addEventListener("change", (e) => { if (e.target.files.length) addAnalysisFiles(e.target.files); e.target.value = ""; });
    renderFileList();
    return true;
  }
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
        if (reused === null) status("☁️ 추가 파일은 서버에 등록됐지만 Excel 자동 반영은 실패했습니다.", true);
        else status(reused ? `☁️ 추가 파일을 서버에 등록했고, Excel ${reused}개를 6-A에 자동 반영했습니다.` : "☁️ 추가 파일을 서버에 등록했습니다.");
      }).catch((err) => {
        const msg = "업로드 실패: " + (window.apiErrorMessage ? window.apiErrorMessage(err, "자료 등록") : err.message);
        status("❌ " + msg, true);
        prepLocalStatus(msg, true);
      });
    }
  }
  bindAnalysisFileUploader();

  // 게이트: 5번 완료 체크 → 업로드 완료 후 6~9(+표/수치 6A/6B) 잠금 해제
  const GATED = [6, "6a", "6b", "6c", "6d", "6e", "6f", 7, 8, 9];
  function setGate(on) {
    $("card-5").classList.toggle("done", on);
    setFlowDone(5, on);
    GATED.forEach((n) => {
      const card = $(`card-${n}`);
      card.classList.toggle("locked", !on);
      setFlowLocked(n, !on);
      const lock = card.querySelector("[data-lock]");
      if (lock) lock.textContent = on ? "✅ 열림" : "🔒 자료 준비 필요";
    });
  }
  $("prepDone").addEventListener("change", async (e) => {
    const on = e.target.checked;
    if (!on) { setGate(false); prepLocalStatus("", false); return; }
    e.target.disabled = true;
    prepLocalStatus("", false);
    status(hasSourceMaterial() ? "☁️ 프로젝트 자료를 서버에 등록하는 중…" : "🔎 기대 산출물 기준 검색형 분석을 준비하는 중…");
    try {
      await ensureAnalysisReady();
      setGate(true);
      const reused = await parseAnalysisCostFiles({ silentNoFiles: true });
      const gateLabel = pageMode === "edit" ? "분석 실행" : "6~9번 단계";
      if (!hasSourceMaterial()) status(`🔓 자료 없이 검색형 분석 모드로 ${gateLabel}이 열렸습니다.`);
      else if (reused === null) status(`🔓 프로젝트 자료 저장 완료. ${gateLabel}은 열렸지만 Excel 자동 반영은 실패했습니다.`, true);
      else status(reused ? `🔓 프로젝트 자료 저장 완료. Excel ${reused}개를 6-A에 자동 반영했습니다.` : `🔓 프로젝트 자료 저장 완료. ${gateLabel}이 열렸습니다.`);
      openCard(6, true);
    } catch (err) {
      e.target.checked = false;
      setGate(false);
      const msg = "작업공간·자료 준비 실패: " + (window.apiErrorMessage ? window.apiErrorMessage(err, "자료 등록") : err.message);
      status("❌ " + msg, true);
      prepLocalStatus(msg, true);
    } finally {
      e.target.disabled = false;
    }
  });

  /* ---------- 6. 분석파일 요약 (AI) ---------- */
  function reEscape(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function sourceLabel(source) {
    const raw = String(source || "").trim();
    if (!raw) return "";
    const parts = raw.split(":").filter(Boolean);
    const chunk = parts.at(-1) || "";
    const fileId = parts.length >= 3 && parts[0] === parts[1]
      ? parts[0]
      : (parts.length >= 2 ? parts.slice(0, -1).join(":") : raw);
    const file = analysisFiles.find((item) => item.id === fileId || item.localId === fileId);
    if (!file) return hasOpaqueSourceId(raw) ? "등록 자료 · 출처 위치 확인 필요" : sanitizeTechnicalText(raw);
    return /^\d+$/.test(chunk) ? `${file.name} · 청크 ${Number(chunk) + 1}` : file.name;
  }

  function replaceSourceRefs(text) {
    let out = String(text || "");
    analysisFiles.forEach((file) => {
      const id = file.id || file.localId;
      if (!id) return;
      const escaped = reEscape(id);
      const label = (chunk) => chunk ? `${file.name} · 청크 ${Number(chunk) + 1}` : file.name;
      out = out
        .replace(new RegExp(`\\(?\\bfile_id=${escaped}(?::(?:${escaped}:)?(\\d+))?\\)?`, "g"), (_match, chunk) => label(chunk))
        .replace(new RegExp(`\\(?\\bchunk_id=${escaped}:(\\d+)\\)?`, "g"), (_match, chunk) => label(chunk))
        .replace(new RegExp(`${escaped}:(?:${escaped}:)?(\\d+)`, "g"), (_match, chunk) => label(chunk));
    });
    return sanitizeTechnicalText(out);
  }

  function renderSummaries(summaries) {
    const list = $("summaryList");
    analysisSummaries = summaries || [];
    if (!analysisSummaries.length) {
      list.innerHTML = '<p class="hint danger">요약 결과가 없습니다.</p>';
      return;
    }
    list.innerHTML = analysisSummaries.map((item, index) => {
      const points = (item.key_points || []).length
        ? `<ul>${item.key_points.map((p) => `<li>${esc(replaceSourceRefs(p))}</li>`).join("")}</ul>` : "";
      const sources = (item.sources || []).length
        ? `<div class="hint si-sources">근거: ${item.sources.map((source) => {
            const label = sourceLabel(source);
            return `<code title="${attr(label)}">${esc(label)}</code>`;
          }).join(" ")}</div>` : "";
      return `<div class="summary-item" data-file-index="${index}"><div class="si-name">📄 ${esc(item.name)}</div>` +
        `<div class="si-text">${esc(replaceSourceRefs(item.summary))}</div>${points}${sources}</div>`;
    }).join("");
  }
  async function runSummaryStep(options = {}) {
    await ensureAnalysisReady();
    const data = await postJSON(`/api/analysis/sessions/${analysisSessionId}/summaries`, analysisContext());
    renderSummaries(data.summaries);
    markStepDone(6);
    if (window.refreshUsage) window.refreshUsage();
    const cost = data.cost_krw != null ? ` · ${data.cost_krw.toFixed(2)}원` : "";
    const fallback = data.fallback_from ? ` · 대체 실행 ${data.fallback_from} → ${data.provider}/${data.model}` : "";
    const summaryLabel = hasSourceMaterial() ? "분석파일 요약" : "검색형 조사 요약";
    if (!options.quiet) status(`✅ ${summaryLabel} 완료 (${data.provider}/${data.model})${fallback}${cost}`);
    if (options.openNext !== false) openCard(pageMode === "edit" ? 6 : 7, true);
    return data;
  }
  $("btnSummarize").addEventListener("click", async () => {
    const btn = $("btnSummarize"); btn.disabled = true;
    status("🤖 분석파일 요약 중…");
    try {
      await runSummaryStep();
    } catch (err) {
      $("summaryList").innerHTML = `<p class="hint danger">${esc(err.message)}</p>`;
      status("❌ 분석파일 요약 실패: " + err.message, true);
    } finally { btn.disabled = false; }
  });

  /* ---------- 7. 아이디어 도출 (AI 객관식 2~4개) ---------- */
  function renderIdeas(questions) {
    analysisQuestions = pageMode === "edit" ? (questions || []).slice(0, 2) : (questions || []);
    const box = $("ideaQuestions");
    if (pageMode === "edit") {
      box.replaceChildren();
      return;
    }
    if (!analysisQuestions.length) {
      box.innerHTML = '<p class="hint danger">확인 질문 결과가 없습니다.</p>';
      return;
    }
    box.innerHTML = analysisQuestions.map((item, qi) => {
      const qid = item.id || `q${qi + 1}`;
      const opts = (item.options || []).map((o, oi) =>
        `<li><label><input type="radio" name="idea-${attr(qid)}" value="${attr(o)}" ${pageMode === "edit" && oi === 0 ? "checked" : ""}><span>${esc(replaceSourceRefs(o))}</span></label></li>`).join("");
      const rationale = replaceSourceRefs(item.rationale || "");
      const why = rationale ? `<button class="evidence-help" type="button" title="${attr(rationale)}">근거</button>` : "";
      return `<div class="mc-q">질문 ${qi + 1}. ${esc(replaceSourceRefs(item.question))}${why}</div><ul class="opt-list">${opts}</ul>`;
    }).join("");
  }
  async function runIdeasStep(options = {}) {
    await ensureAnalysisReady();
    const data = await postJSON(`/api/analysis/sessions/${analysisSessionId}/ideas`, analysisContext());
    renderIdeas(data.questions);
    markStepDone(7);
    if (window.refreshUsage) window.refreshUsage();
    const cost = data.cost_krw != null ? ` · ${data.cost_krw.toFixed(2)}원` : "";
    const fallback = data.fallback_from ? ` · 대체 실행 ${data.fallback_from} → ${data.provider}/${data.model}` : "";
    if (!options.quiet) status(`✅ 빠른 확인 질문 생성 완료 (${data.provider}/${data.model})${fallback}${cost}`);
    if (options.openNext !== false) openCard(8, true);
    return data;
  }
  $("btnIdeas").addEventListener("click", async () => {
    const btn = $("btnIdeas"); btn.disabled = true;
    status("🤖 아이디어 질문 생성 중…");
    try {
      await runIdeasStep();
    } catch (err) {
      $("ideaQuestions").innerHTML = `<p class="hint danger">${esc(err.message)}</p>`;
      status("❌ 아이디어 생성 실패: " + err.message, true);
    } finally { btn.disabled = false; }
  });

  /* ---------- 8. 분석 플랜 도출 (AI 체크박스 선택) ---------- */
  function selectedIdeaAnswers() {
    return analysisQuestions.map((item, qi) => {
      if (pageMode === "edit" && item.options?.length) {
        return { question: item.question, answer: item.options[0], assumed: true };
      }
      const qid = item.id || `q${qi + 1}`;
      const selected = document.querySelector(`input[name="idea-${CSS.escape(qid)}"]:checked`);
      if (selected) return { question: item.question, answer: selected.value };
      return null;
    }).filter(Boolean);
  }

  function planEvidenceChunks(plan) {
    return Array.isArray(plan?.evidence_chunks) ? plan.evidence_chunks : [];
  }

  function evidenceStatusLabel(status) {
    if (status === "confirmed") return "확인";
    if (status === "missing_evidence") return "근거 부족";
    return "담당자 확인";
  }

  function evidenceChunkLabel(chunk) {
    const name = chunk?.file_name || "근거 자료";
    const index = Number(chunk?.chunk_index);
    return `${name}${Number.isFinite(index) ? ` · 근거 ${index + 1}` : ""}`;
  }

  function planEvidenceSummary(plan) {
    const chunks = planEvidenceChunks(plan);
    const label = evidenceStatusLabel(plan?.evidence_status);
    const refs = chunks.slice(0, 2).map(evidenceChunkLabel).join(", ");
    const flags = Array.isArray(plan?.review_flags) && plan.review_flags.length
      ? ` · ${plan.review_flags.slice(0, 2).join(", ")}`
      : "";
    return chunks.length ? `근거 검색: ${label} · ${refs}${flags}` : `근거 검색: ${label}`;
  }

  function planTooltip(plan) {
    return [
      replaceSourceRefs(plan?.detail || ""),
      planEvidenceSummary(plan),
      ...(Array.isArray(plan?.review_flags) ? plan.review_flags : []),
    ].filter(Boolean).join("\n");
  }

  function renderPlans(plans) {
    analysisPlans = plans || [];
    if (!analysisPlans.length) {
      $("planList").innerHTML = '<li class="hint danger">플랜 결과가 없습니다.</li>';
      return;
    }
    $("planList").innerHTML = analysisPlans.map((p, i) =>
      `<li><label><input type="checkbox" class="plan-chk" value="${attr(replaceSourceRefs(p.title))}" data-detail="${attr(replaceSourceRefs(p.detail || ""))}" data-plan-id="${attr(p.id || `p${i + 1}`)}" data-plan-index="${i}" ${p.checked ? "checked" : ""}>` +
      `<span>${esc(replaceSourceRefs(p.title))}</span></label><button class="evidence-help" type="button" title="${attr(planTooltip(p))}">근거</button></li>`).join("");
  }
  async function runPlansStep(options = {}) {
    await ensureAnalysisReady();
    const data = await postJSON(`/api/analysis/sessions/${analysisSessionId}/plans`, analysisContext({ answers: selectedIdeaAnswers() }));
    renderPlans(data.plans);
    markStepDone(8);
    if (window.refreshUsage) window.refreshUsage();
    const cost = data.cost_krw != null ? ` · ${data.cost_krw.toFixed(2)}원` : "";
    const fallback = data.fallback_from ? ` · 대체 실행 ${data.fallback_from} → ${data.provider}/${data.model}` : "";
    if (!options.quiet) status(`✅ 분석 플랜 생성 완료 (${data.provider}/${data.model})${fallback}${cost}`);
    const shouldOpenNext = options.openNext !== false;
    if (pageMode === "edit" && options.autoApply !== false) {
      const applied = applySelectedPlanResults({ quiet: true, openResult: shouldOpenNext });
      if (!applied && shouldOpenNext) openCard(9, true);
    } else if (shouldOpenNext) {
      openCard(9, true);
    }
    return data;
  }
  $("btnPlans").addEventListener("click", async () => {
    const btn = $("btnPlans"); btn.disabled = true;
    status("🤖 분석 플랜 생성 중…");
    try {
      await runPlansStep();
    } catch (err) {
      $("planList").innerHTML = `<li class="hint danger">${esc(err.message)}</li>`;
      status("❌ 플랜 생성 실패: " + err.message, true);
    } finally { btn.disabled = false; }
  });
  $("planList").addEventListener("change", (e) => {
    if (pageMode !== "edit" || !e.target.closest(".plan-chk")) return;
    const hasResult = $("printArea")?.querySelector(".mp-h1");
    if (hasResult && planExecutionResults.length) {
      planExecutionResults = calculateSelectedPlanResults();
      reportStorageState = "idle";
      reportStorageError = "";
      renderEditCalculationReview();
      runBuildResultStep({ quiet: true });
    }
  });

  /* ---------- 9. 결과 정리 & 내보내기 (PDF) ---------- */
  function selectedPlanControls() {
    return Array.from(document.querySelectorAll(".plan-chk:checked"));
  }

  function normalizedPlanText(text) {
    return String(text || "").toLowerCase().replace(/\s+/g, "");
  }

  function planKeywords(text) {
    const stop = new Set(["분석", "검토", "도출", "수행", "진행", "계획", "플랜", "기반", "구축", "정의", "추출", "확인", "자료", "파일", "원본", "항목", "기본", "결과"]);
    return String(text || "")
      .toLowerCase()
      .split(/[^0-9a-z가-힣]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !stop.has(t))
      .slice(0, 16);
  }

  function classifyPlan(title, detail, plan) {
    if (resultPolicy?.classifyPlan) return resultPolicy.classifyPlan({ title, detail, plan });
    const text = `${title || ""} ${detail || ""}`;
    const isLaw = /법규|법령|법률|시행령|고시|규정|근거|절차|출처/i.test(text);
    const isClassification = /관측소|조사지점|대상\s*강|유형|분류|목록|확정/i.test(text);
    const isCost = /비용|원가|단가|예산|금액|합계|산출|산정|계산|인건비|교통비|장비|임대|유지보수|품셈|인.?일|빈도|주기|조정/i.test(text);
    if (isCost) {
      let subtype = "cost";
      if (/인력|인건비|노무|품셈|인.?일/i.test(text)) subtype = "staffing";
      else if (/교통|여비|출장|차량/i.test(text)) subtype = "transport";
      else if (/장비|임대|유지보수|감가|시설/i.test(text)) subtype = "equipment";
      else if (/단가|단위\s*비용|항목별/i.test(text)) subtype = "unit_cost";
      else if (/주기|빈도|정기점검|횟수|조정/i.test(text)) subtype = "frequency";
      return { group: "cost", subtype, label: "비용 계산" };
    }
    if (isLaw) return { group: "review", subtype: "law", label: "법규 검토" };
    if (isClassification) return { group: "checklist", subtype: "classification", label: "대상 분류" };
    return { group: "checklist", subtype: "manual", label: "사람 확인" };
  }

  function formulaForPlan(subtype) {
    const formulas = {
      staffing: "조사 항목 수 × 지점 수 × 표준 인·일 × 인건비 단가",
      transport: "조사 지점 수 × 왕복 교통비 × 연간 조사 빈도",
      equipment: "장비 취득가 ÷ 내용연수 + 유지보수비 + 임대비",
      unit_cost: "항목별 단가 × 대상 수량",
      frequency: "기본 비용 × 연간 조사 빈도 ÷ 기준 빈도",
      cost: "대상 수량 × 적용 단가 × 연간 빈도 + 부대비",
    };
    return formulas[subtype] || formulas.cost;
  }

  function neededInputsForPlan(subtype) {
    const common = ["대상 범위", "적용 기간", "계산식 승인"];
    const map = {
      staffing: ["대상 강/지점 수", "조사 항목 수", "표준 인·일 기준", "인건비 단가"],
      transport: ["대상 강/지점 수", "왕복 교통비", "연간 조사 빈도"],
      equipment: ["적용 장비", "장비 취득가", "내용연수", "유지보수비/임대비 배부 기준"],
      unit_cost: ["적용할 항목", "대상 수량", "적용 단가", "사용할 연도/단가표"],
      frequency: ["기준 빈도", "적용 빈도", "조정 대상 비용"],
      cost: ["대상 수량", "적용 단가", "연간 빈도"],
    };
    return map[subtype] || common;
  }

  function extractPlanFileHints(text) {
    const hay = normalizedPlanText(text);
    const hints = analysisFiles.filter((file) => {
      const name = normalizedPlanText(file.name);
      const base = normalizedPlanText(String(file.name || "").replace(/\.[^.]+$/, ""));
      return name && (hay.includes(name) || (base.length >= 4 && hay.includes(base)));
    }).map((file) => file.name);
    const quoted = Array.from(String(text || "").matchAll(/[`'"]([^`'"]+\.(?:xlsx?|csv|pdf|docx?|pptx?))[`'"]/gi))
      .map((m) => m[1]);
    return [...new Set([...hints, ...quoted])];
  }

  function isLikelyCostNumber(row) {
    if (!row || !Number.isFinite(row.value) || row.value <= 0) return false;
    const text = `${row.category} ${row.label} ${row.file} ${row.sheet}`;
    if (/연번|순번|번호|page|row|chunk|쪽|년\s*기준/i.test(row.label || "") && row.value < 10000) return false;
    if (row.value >= 1000) return true;
    return /단가|금액|비용|원가|예산|인건비|교통비|장비|임대|요율|비율|%|횟수|수량|개소|지점|인.?일/i.test(text);
  }

  function scorePlanRow(row, keys, fileHints) {
    const hay = `${row.category} ${row.label} ${row.file} ${row.sheet}`.toLowerCase();
    const normalizedFile = normalizedPlanText(row.file);
    let score = 0;
    if (fileHints.some((hint) => normalizedFile.includes(normalizedPlanText(hint).replace(/\.[^.]+$/, "")))) score += 8;
    keys.forEach((key) => { if (hay.includes(key)) score += 2; });
    if (/합계|총계|계\b|금액|단가|비용|원가|예산/i.test(`${row.label} ${row.sheet}`)) score += 1;
    return score;
  }

  function candidateRowsForPlanText(text, planType) {
    if (planType?.group !== "cost") return [];
    const rows = costAll.filter(isLikelyCostNumber);
    if (!rows.length) return [];
    const keys = planKeywords(text);
    const fileHints = extractPlanFileHints(text);
    const scored = rows.map((row) => ({ row, score: scorePlanRow(row, keys, fileHints) }))
      .filter((item) => item.score >= (fileHints.length ? 8 : 2))
      .sort((a, b) => b.score - a.score || b.row.value - a.row.value)
      .map((item) => item.row);
    return scored;
  }

  function rowsForPlanText(text, planType) {
    return candidateRowsForPlanText(text, planType).slice(0, 24);
  }

  function evidenceForPlan(text) {
    const keys = planKeywords(text);
    if (!keys.length || !evidenceAll.length) return [];
    return evidenceAll.map((ev) => {
      const hay = `${ev.type} ${ev.text} ${ev.file} ${ev.sheet}`.toLowerCase();
      const score = keys.reduce((sum, key) => sum + (hay.includes(key) ? 1 : 0), 0);
      return { ev, score };
    }).filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((item) => item.ev);
  }

  function planForControl(control) {
    const id = control.dataset.planId || "";
    const index = Number(control.dataset.planIndex);
    return analysisPlans.find((plan) => (plan.id || "") === id) || (Number.isFinite(index) ? analysisPlans[index] : null) || null;
  }

  function planResultKey(item) {
    return `${item?.id || item?.plan?.id || item?.index || ""}::${item?.title || ""}`;
  }

  function manualFieldValueMap(item) {
    const fields = Array.isArray(item?.manualInputs?.fields) ? item.manualInputs.fields : [];
    return new Map(fields.map((field) => [field.label, field.value ?? ""]));
  }

  function manualFieldRecordMap(item) {
    const fields = Array.isArray(item?.manualInputs?.fields) ? item.manualInputs.fields : [];
    return new Map(fields.map((field) => [field.label, field]));
  }

  function parseManualNumber(value) {
    if (resultPolicy?.parseManualNumber) return resultPolicy.parseManualNumber(value);
    if (value == null || !String(value).trim()) return null;
    const normalized = String(value).trim().replace(/[,\s원₩%]/g, "");
    if (!normalized) return null;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  function manualInputSummary(item) {
    const fields = Array.isArray(item?.manualInputs?.fields) ? item.manualInputs.fields : [];
    const values = fields
      .filter((field) => String(field.value || "").trim() || ["unknown", "excluded"].includes(field.status))
      .map((field) => {
        const value = [field.value, field.unit].filter(Boolean).join(" ") || (field.status === "excluded" ? "제외" : "확인 필요");
        return `${field.label}: ${value}`;
      });
    const memo = String(item?.manualInputs?.memo || "").trim();
    if (memo) values.push(`메모: ${memo}`);
    return values.join(" / ");
  }

  function manualFieldGuide(label, item) {
    const text = `${label || ""} ${item?.title || ""} ${item?.detail || ""}`;
    const guide = {
      placeholder: "예: 원문에서 확인한 숫자 또는 기준",
      help: "원본 자료나 담당자가 알고 있는 기준값을 입력하세요.",
    };
    if (/대상\s*강|지점|조사\s*대상|개소/i.test(text)) {
      return {
        placeholder: "예: 1개 강, 12개 지점",
        help: "조사대상 강/지점 수입니다. 계획서의 조사대상, 측점, 대상지 목록에서 확인하세요.",
      };
    }
    if (/조사\s*항목|항목\s*수/i.test(text)) {
      return {
        placeholder: "예: 유량·수위·수질 3개",
        help: "실제로 조사하거나 계산에 반영할 항목 개수입니다.",
      };
    }
    if (/표준\s*인.?일|인.?일|공수|노무/i.test(text)) {
      return {
        placeholder: "예: 0.5인·일/지점",
        help: "표준품셈, 과업지시서, 내부 산정 기준에 적힌 작업량 기준입니다.",
      };
    }
    if (/인건비|노무비|단가/i.test(text)) {
      return {
        placeholder: "예: 210000원/인·일",
        help: "적용할 노임단가 또는 단가표 금액입니다. 연도와 직급 기준도 메모에 남기세요.",
      };
    }
    if (/교통|여비|출장|차량|왕복/i.test(text)) {
      return {
        placeholder: "예: 버스 왕복 4732원, 차량 35km",
        help: "버스/기차/차량 중 실제 적용할 교통수단과 편도/왕복 기준을 확인하세요.",
      };
    }
    if (/빈도|횟수|주기|기간/i.test(text)) {
      return {
        placeholder: "예: 월 1회=12회/년",
        help: "연간 몇 번 수행하는지입니다. 월간/분기/연간 기준을 숫자로 적으세요.",
      };
    }
    if (/기간|연도|사용할\s*연도/i.test(text)) {
      return {
        placeholder: "예: 2025년 기준",
        help: "어느 연도·기간의 단가표나 예산을 쓸지 입력하세요.",
      };
    }
    if (/수량|대상\s*수량|적용할\s*항목/i.test(text)) {
      return {
        placeholder: "예: 24건, 6개 항목",
        help: "단가를 곱할 대상 수량입니다. 엑셀의 합계/수량 열에서 확인하세요.",
      };
    }
    if (/장비|내용연수|유지보수|임대/i.test(text)) {
      return {
        placeholder: "예: 내용연수 5년, 유지보수비 120000원",
        help: "장비 산정에 필요한 취득가, 내용연수, 유지보수비, 임대비 기준입니다.",
      };
    }
    return guide;
  }

  function humanInputKind(label, item) {
    const field = String(label || "");
    if (/적용\s*장비|장비명|모델명/i.test(field)) return "text";
    if (/부가세|vat|적용\s*여부|미적용|포함|제외/i.test(field)) return "boolean";
    if (/^\s*(계산\s*)?단위\s*$/i.test(field)) return "unit";
    if (/요율|비율|세율|보정률|%/i.test(field)) return "rate";
    if (/단가|취득가|구매\s*가격|수량|횟수|빈도|기간|인원|시간|금액|비용|합계|내용연수|연도|개소|지점|회\b|명\b|건\b/i.test(field)) return "number";
    return "text";
  }

  function humanInputImpact(label, item) {
    const field = String(label || "");
    if (/단가|취득가|구매\s*가격|수량|횟수|빈도|인원|시간|지점|개소|세율|부가세|보정률|합계|금액/i.test(field)) return "high";
    if (/기준|연도|기간|단위|대상|범위|법령|고시/i.test(field)) return "medium";
    return "low";
  }

  function humanInputReason(label, item) {
    const kind = humanInputKind(label, item);
    if (kind === "unit") return "단위가 없거나 여러 후보가 있어 결과값 해석이 달라질 수 있습니다.";
    if (kind === "boolean") return "적용 여부에 따라 최종 결과값 또는 체크리스트 상태가 달라집니다.";
    if (kind === "rate") return "요율/비율은 계산 결과에 직접 반영됩니다.";
    if (kind === "number") return "계산식에 들어가는 핵심 숫자입니다.";
    return "AI가 원문만으로 확정하지 못한 기준입니다.";
  }

  function uniqueCandidateKey(candidate) {
    return [candidate.value, candidate.unit || "", candidate.scenario_key || ""].join("::");
  }

  function dedupeCandidates(candidates) {
    const seen = new Set();
    return candidates.filter((candidate) => {
      if (candidate.value == null || candidate.value === "") return false;
      const key = uniqueCandidateKey(candidate);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function candidateSampleScore(seed, candidate) {
    const text = `${seed}::${uniqueCandidateKey(candidate)}`;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function sampleManualCandidates(candidates, seed, limit = 30) {
    const unique = dedupeCandidates(candidates);
    if (unique.length <= limit) return unique;
    return unique
      .map((candidate) => ({ candidate, score: candidateSampleScore(seed, candidate) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, limit)
      .map((entry) => entry.candidate);
  }

  function unitCandidatesForText(text) {
    const units = [];
    const source = String(text || "");
    const patterns = [
      ["원", /원|비용|금액|단가|예산/],
      ["원/개소", /원\/개소|개소.*단가|지점.*단가/],
      ["원/회", /원\/회|횟수|빈도|주기/],
      ["개소", /개소|지점|측점|조사\s*대상/],
      ["회", /횟수|빈도|주기|연간/],
      ["명", /인원|투입\s*인력|명\b/],
      ["시간", /시간|시수/],
      ["인·일", /인.?일|공수|노무/],
      ["%", /%|요율|세율|비율|보정률|부가세/],
      ["년", /연도|기준\s*연도|내용연수/],
    ];
    patterns.forEach(([unit, pattern]) => { if (pattern.test(source)) units.push(unit); });
    return [...new Set(units)];
  }

  function valueUnitsForField(label, item) {
    const field = String(label || "");
    if (/대상\s*강|지점|측점|개소/i.test(field)) return ["개 지점", "개소"];
    if (/조사\s*항목|항목\s*수/i.test(field)) return ["개 항목"];
    if (/횟수|빈도|주기/i.test(field)) return ["회", "회/년"];
    if (/인원|투입\s*인력/i.test(field)) return ["명"];
    if (/시간|시수/i.test(field)) return ["시간"];
    if (/내용연수|연도|기간|사용\s*연한|수명/i.test(field)) return ["년"];
    if (/표준\s*인.?일|인.?일|공수/i.test(field)) return ["인·일", "인·일/지점"];
    // 단가·인건비 조합 단위는 필드 라벨이 그 성격일 때만(item 텍스트 누수 방지).
    if (/인건비|노무비|노임|단가/i.test(field)) return ["원/인·일", "원/회", "원/개소", "원"];
    if (/금액|비용|합계|예산|취득가|가격|유지보수|임대|배부/i.test(field)) return ["원"];
    return unitCandidatesForText(field);
  }

  // 필드 성격별 그럴듯한 값 범위 — 리트리버/문서에서 긁힌 엉뚱한 값(예: 4천만 "년")을 걸러낸다.
  function fieldValueRange(label, item) {
    const field = String(label || "");
    const text = `${field} ${item?.title || ""} ${item?.detail || ""} ${item?.formula || ""}`;
    if (/내용연수|사용\s*연한|수명/i.test(field)) return { min: 1, max: 60, integer: true };
    if (/연도|기준\s*연도|년도/i.test(field)) return { min: 1990, max: 2100, integer: true };
    if (/부가세|vat|요율|세율|비율|보정률/i.test(field)) return { min: 0, max: 100 };
    if (/횟수|빈도|주기/i.test(field)) return { min: 1, max: 3650, integer: true };
    if (/인원|투입\s*인력/i.test(field)) return { min: 1, max: 1000, integer: true };
    if (/대상\s*강|지점|측점|개소|조사\s*항목|항목\s*수/i.test(field)) return { min: 1, max: 100000, integer: true };
    if (/표준\s*인.?일|인.?일|공수/i.test(field)) return { min: 0.01, max: 100000 };
    if (/인건비|노무비|노임/i.test(field)) return { min: 1000, max: 3000000 };   // 인·일 노임단가 상식 범위
    if (/단가/i.test(field)) return { min: 100, max: 500000000 };
    if (/금액|비용|합계|예산|총액|취득가|가격|유지보수|임대|배부/i.test(field)) return { min: 1000, max: 1e13 };
    return { min: 0, max: Infinity };
  }

  function isPlausibleFieldValue(label, item, value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return false;
    const range = fieldValueRange(label, item);
    if (n < range.min || n > range.max) return false;
    if (range.integer && !Number.isInteger(n)) return false;
    return true;
  }

  // 조합 단위(1인1일 등)는 '단위당' 성격의 필드에만 생성한다(내용연수·연도·배부기준 등 제외).
  function fieldAllowsCombinationUnits(label) {
    return /단가|인건비|노무비|노임|공수|인.?일|개소\s*당|회\s*당/i.test(String(label || ""));
  }

  // 조합으로 성립하는 단위(예: 인·일 = 인원×일수)를 1인1일, 1인2일 … 처럼 경우의 수로 전개한다.
  const UNIT_COUNTERS = [
    { token: "개소", max: 3 },
    { token: "지점", max: 3 },
    { token: "측점", max: 3 },
    { token: "항목", max: 4 },
    { token: "개월", max: 4 },
    { token: "시간", max: 4 },
    { token: "인", max: 3 },
    { token: "명", max: 3 },
    { token: "일", max: 4 },
    { token: "회", max: 4 },
    { token: "월", max: 4 },
    { token: "년", max: 3 },
  ];

  function expandUnitCombinations(unit) {
    const raw = String(unit || "").trim();
    // 복합 단위(· 로 묶인 두 개 이상의 계량 단위)만 조합으로 전개한다.
    if (!raw.includes("·")) return [raw];
    const m = raw.match(/^(.*?)([가-힣]+(?:·[가-힣]+)+)(.*)$/);
    if (!m) return [raw];
    const [, pre, composite, post] = m;
    const ranges = composite.split("·").map((part) => {
      const counter = UNIT_COUNTERS.find((u) => part.includes(u.token));
      return { text: part, max: counter ? counter.max : 1 };
    });
    if (ranges.every((range) => range.max <= 1)) return [raw];
    let combos = [""];
    const CAP = 16;
    ranges.forEach((range) => {
      const next = [];
      for (const prefix of combos) {
        for (let n = 1; n <= range.max && next.length < CAP; n += 1) {
          next.push(`${prefix}${n}${range.text}`);
        }
      }
      combos = next;
    });
    return combos.slice(0, CAP).map((combo) => `${pre}${combo}${post}`);
  }

  function combinationUnitsForField(label, item) {
    const base = valueUnitsForField(label, item);
    if (!fieldAllowsCombinationUnits(label)) return base; // 단위당 필드가 아니면 조합 단위 생성 안 함
    const seen = new Set();
    const expanded = [];
    base.forEach((unit) => {
      expandUnitCombinations(unit).forEach((variant) => {
        if (variant && !seen.has(variant)) {
          seen.add(variant);
          expanded.push(variant);
        }
      });
    });
    return expanded.length ? expanded : base;
  }

  function rowCandidate(row, label, unitOverride = "") {
    const unit = unitOverride || resultUnitForItem({ title: label, detail: rowMeaning(row), group: "cost" }, row.value);
    const valueText = `${/원/.test(unit) ? fmtCurrency(row.value) : fmtWon(row.value)}${unit || ""}`;
    return {
      value: row.value,
      unit,
      label: `${valueText} · ${rowMeaning(row)} · ${[row.file, sourceCellAddress(row)].filter(Boolean).join(" · ")}`,
      scenario_key: `${sourceOf(row)}::${unit}`,
      evidence_refs: [{
        file_name: row.file || "",
        sheet: row.sheet || "",
        range: row.cell || "",
        label: sourceOf(row),
        excerpt: rowMeaning(row),
      }],
      confidence: row.labelConfidence === "구조화" ? "high" : "medium",
    };
  }

  function manualFieldCandidates(label, item) {
    const kind = humanInputKind(label, item);
    const text = `${label || ""} ${item?.title || ""} ${item?.detail || ""} ${item?.formula || ""}`;
    if (kind === "text") return [];
    if (kind === "boolean") {
      return [
        { value: "적용", label: "적용", confidence: "medium" },
        { value: "미적용", label: "미적용", confidence: "medium" },
      ];
    }
    // '계산 단위'는 숫자가 아니라 '어떤 단위 기준으로 계산할지'를 고르는 필드 → 단위 후보를 준다.
    if (kind === "unit") {
      const itemText = `${item?.title || ""} ${item?.detail || ""} ${item?.formula || ""}`;
      const choices = [...new Set([
        ...unitCandidatesForText(itemText),
        "원/개소", "원/회", "원/인·일", "개소", "회", "인·일", "원",
      ])].filter(Boolean).slice(0, 12);
      return choices.map((u) => ({ value: u, unit: "", label: `${u} 기준`, confidence: "medium" }));
    }
    const labelKeys = planKeywords(label);
    const itemRows = Array.isArray(item?.candidateRows) ? item.candidateRows : (Array.isArray(item?.rows) ? item.rows : []);
    const rows = itemRows.length ? itemRows : costAll.filter(isLikelyCostNumber).slice(0, 500);
    const scoredRows = rows.map((row) => {
      const hay = `${row.label || ""} ${row.rowHeader || ""} ${row.columnHeader || ""} ${row.category || ""}`.toLowerCase();
      const score = labelKeys.reduce((sum, key) => sum + (hay.includes(key) ? 2 : 0), 0);
      return { row, score };
    }).sort((a, b) => b.score - a.score || b.row.value - a.row.value);
    const sourceRows = scoredRows.filter((entry) => entry.score > 0);
    const units = combinationUnitsForField(label, item);
    // 필드에 그럴듯한 값만 남기고(예: 내용연수에 4천만 제거), 특정 행 쏠림 방지로 상위만 사용.
    const plausibleRows = sourceRows.filter(({ row }) => isPlausibleFieldValue(label, item, row.value));
    const valueRows = plausibleRows.slice(0, units.length > 6 ? 12 : 24);
    const rowCandidates = valueRows.flatMap(({ row }) => {
      const applicableUnits = units.length ? units : [""];
      return applicableUnits.map((unit) => rowCandidate(row, label, unit));
    });
    if (kind === "rate" && /부가세|vat/i.test(text)) {
      rowCandidates.unshift({ value: 10, unit: "%", label: "10% (일반 부가세)", confidence: "low" });
    }
    return sampleManualCandidates(rowCandidates, `${item?.id || item?.title || "item"}::${label}`);
  }

  function humanInputFieldsForItem(item) {
    const seededContract = item?.plan?.result_contract;
    const isTypedContract = !!(seededContract && typeof seededContract === "object" && seededContract.kind);
    const seededFields = Array.isArray(seededContract?.human_input_fields) ? seededContract.human_input_fields : [];
    const seededMissing = Array.isArray(seededContract?.missing_inputs)
      ? seededContract.missing_inputs.map((entry) => typeof entry === "string" ? entry : (entry?.label || entry?.name || "")).filter(Boolean)
      : [];
    const makeField = (label, seeded = null) => {
      const impact = seeded?.impact || humanInputImpact(label, item);
      const candidates = seeded && Array.isArray(seeded.candidates)
        ? seeded.candidates
        : manualFieldCandidates(label, item);
      const inferredKind = humanInputKind(label, item);
      const hasCanonicalKind = /적용\s*장비|장비명|모델명|계산\s*단위|부가세|vat|내용연수|사용\s*연한|연도|단가|취득가|가격|수량|횟수|빈도|인원|시간|금액|비용|합계/i.test(label);
      return {
        ...(seeded || {}),
        id: seeded?.id || label.replace(/[^\w가-힣.-]+/g, "_").slice(0, 80) || "input",
        label,
        kind: hasCanonicalKind ? inferredKind : (seeded?.kind || inferredKind),
        reason: seeded?.reason || humanInputReason(label, item),
        impact,
        required: seeded?.required ?? impact === "high",
        candidates,
        status: seeded?.status || (candidates.length > 1 || impact === "high" ? "pending" : "unknown"),
      };
    };
    if (isTypedContract) {
      const fields = seededFields
        .map((field) => makeField(String(field?.label || field?.name || "").trim(), field))
        .filter((field) => field.label);
      seededMissing.forEach((label) => {
        const existing = fields.find((field) => field.label === label);
        if (existing) existing.required = true;
        else fields.push(makeField(label, { required: true, status: "pending" }));
      });
      const order = { high: 0, medium: 1, low: 2 };
      return fields.sort((a, b) => (order[a.impact] ?? 2) - (order[b.impact] ?? 2));
    }
    const baseLabels = new Set(item?.needs || []);
    if (item?.group === "cost") {
      const text = `${item.title || ""} ${item.detail || ""} ${item.formula || ""}`;
      if (!baseLabels.size && !item?.rowCount) neededInputsForPlan(item.subtype).forEach((label) => baseLabels.add(label));
      if (/부가세|vat|공급가|원가|금액|합계/i.test(text)) baseLabels.add("부가세 적용 여부");
      if (/단가|수량|지점|개소|횟수|빈도|인.?일|시간/i.test(text)) baseLabels.add("계산 단위");
    }
    const fields = [...baseLabels].slice(0, 10).map((label) => makeField(label, { required: true, status: "pending" }));
    return fields.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.impact] - order[b.impact];
    });
  }

  function confirmedHumanInputs(item) {
    const fields = Array.isArray(item?.manualInputs?.fields) ? item.manualInputs.fields : [];
    return fields.filter((field) => isHumanFieldResolved(field) && String(field.value ?? "").trim()).map((field) => ({
      field_id: field.id || field.label,
      label: field.label,
      kind: field.kind || "text",
      value: field.value,
      unit: field.unit || "",
      source: field.status === "custom" ? "custom" : (field.source || "candidate"),
      confidence: field.candidate?.confidence || field.candidate_confidence || "",
      human_verified: field.human_verified === true || field.source !== "candidate",
      evidence_refs: Array.isArray(field.candidate?.evidence_refs) ? field.candidate.evidence_refs.slice(0, 8) : [],
      memo: field.memo || item?.manualInputs?.memo || "",
    }));
  }

  function humanInputFieldState(item) {
    const previous = manualFieldRecordMap(item);
    const merged = humanInputFieldsForItem(item).map((field) => {
      const record = previous.get(field.label) || {};
      const candidates = field.candidates?.length ? field.candidates : (record.candidates || []);
      const kindChanged = !!record.kind && !!field.kind && record.kind !== field.kind;
      const value = kindChanged ? "" : (record.value ?? "");
      return {
        ...field,
        ...record,
        id: field.id || record.id || field.label,
        label: field.label,
        kind: field.kind || record.kind,
        reason: field.reason || record.reason || "",
        impact: field.impact || record.impact || "low",
        required: record.required ?? field.required,
        candidates,
        value,
        unit: kindChanged ? "" : (record.unit || ""),
        selection: kindChanged ? "" : (record.selection || field.selection || ""),
        status: kindChanged ? "pending" : (record.status || (String(value ?? "").trim() ? "custom" : field.status)),
        source: kindChanged ? "" : (record.source || field.source || ""),
        human_verified: !kindChanged && record.human_verified === true,
        candidate_confidence: record.candidate_confidence || record.candidate?.confidence || "",
      };
    });
    previous.forEach((record) => {
      if (!merged.some((field) => field.label === record.label)) {
        const inferredKind = humanInputKind(record.label, item);
        const hasCanonicalKind = /적용\s*장비|장비명|모델명|계산\s*단위|부가세|vat|내용연수|사용\s*연한|연도|단가|취득가|가격|수량|횟수|빈도|인원|시간|금액|비용|합계/i.test(record.label || "");
        const nextKind = hasCanonicalKind ? inferredKind : (record.kind || inferredKind);
        const kindChanged = !!record.kind && record.kind !== nextKind;
        merged.push({
          id: record.id || record.label,
          label: record.label,
          kind: nextKind,
          reason: record.reason || "담당자가 추가로 보완한 입력값입니다.",
          impact: record.impact || "medium",
          required: record.required ?? true,
          candidates: record.candidates || [],
          value: kindChanged ? "" : (record.value ?? ""),
          unit: kindChanged ? "" : (record.unit || ""),
          selection: kindChanged ? "" : (record.selection || ""),
          source: kindChanged ? "" : (record.source || "user"),
          status: kindChanged ? "pending" : (record.status || (String(record.value ?? "").trim() ? "custom" : "pending")),
          human_verified: !kindChanged && record.human_verified === true,
          candidate_confidence: record.candidate_confidence || record.candidate?.confidence || "",
        });
      }
    });
    return merged;
  }

  function isHumanFieldResolved(field) {
    if (!resultPolicyReady) return false;
    return resultPolicy.isHumanFieldResolved(field);
  }

  function pendingHumanInputFields(item) {
    return humanInputFieldState(item).filter((field) => field.required !== false && !isHumanFieldResolved(field));
  }

  function manualPanelIntro(item, fields) {
    const examples = fields.slice(0, 3).map((label) => {
      const guide = manualFieldGuide(label, item);
      return `${label}: ${guide.placeholder.replace(/^예:\s*/, "")}`;
    });
    return examples.length
      ? `아래 값은 AI가 원문에서 확정하지 못한 계산 변수입니다. 예: ${examples.join(" / ")}`
      : "아래 값은 AI가 원문에서 확정하지 못한 계산 변수입니다.";
  }

  function manualInputsComplete(item) {
    const fields = humanInputFieldState(item).filter((field) => field.required !== false);
    return fields.every(isHumanFieldResolved);
  }

  function manualAmount(item) {
    const fields = Array.isArray(item?.manualInputs?.fields) ? item.manualInputs.fields : [];
    if (!fields.length || !resultPolicyReady) return null;
    return resultPolicy.manualAmount({ fields, subtype: item?.subtype || "cost" });
  }

  function effectivePlanTotal(item) {
    if (!resultPolicyReady) return null;
    const typedKind = resultPolicy.resultKind(item?.plan) || "";
    if (typedKind && typedKind !== "calculation") return null;
    if (!typedKind && item?.group !== "cost") return null;
    const authoritative = resultPolicy.authoritativePlanAmount(item?.plan);
    const manual = manualAmount(item);
    const fallbackRows = Array.isArray(item?.candidateRows) && item.candidateRows.length ? item.candidateRows : (item?.rows || []);
    const fallback = resultPolicy.aggregateRowAmount(fallbackRows);
    return resultPolicy.selectEffectiveAmount({ authoritative, manual, fallback });
  }

  function effectiveReviewStatus(item) {
    const fields = humanInputFieldState(item);
    const contractStatus = resultContractForItem(item).status;
    if (contractStatus === "ready") {
      if (fields.some((field) => field.source === "candidate" && field.human_verified === true)) return "후보 확인 완료";
      if (fields.length) return "입력값 확정";
      return "확인";
    }
    if (contractStatus === "needs_input") {
      const need = String(pendingHumanInputFields(item)[0]?.label || item?.needs?.[0] || "").trim();
      return isEdit2Page && need ? `${need} 입력 필요` : "입력필요";
    }
    if (contractStatus === "needs_user_action") return "직접 실행 필요";
    if (contractStatus === "needs_evidence") return "근거 보완";
    return "검토 필요";
  }

  function reviewNeedsAttention(item) {
    return resultContractForItem(item).status !== "ready";
  }

  function needsManualInput(item) {
    return pendingHumanInputFields(item).length > 0
      || ((item?.status === "입력 필요" || (item?.group === "cost" && !item?.rowCount)) && !manualInputsComplete(item));
  }

  function hasHumanInputGate(item) {
    return humanInputFieldState(item).length > 0 || !!item?.manualInputs;
  }

  function pendingExecutionInputs() {
    return planExecutionResults
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => needsManualInput(item));
  }

  function requireExecutionHumanInputs() {
    const pending = pendingExecutionInputs();
    if (!pending.length) return true;
    const first = pending[0];
    openCard(9, true);
    openManualInputPanel(first.index);
    const labels = humanInputFieldState(first.item)
      .filter((field) => field.required !== false && !isHumanFieldResolved(field))
      .map((field) => field.label)
      .filter(Boolean)
      .slice(0, 4);
    status(`실행 전에 담당자 입력값을 확정하세요${labels.length ? `: ${labels.join(", ")}` : ""}.`, true);
    return false;
  }

  function calculateSelectedPlanResults() {
    const previousManualInputs = new Map(
      planExecutionResults
        .filter((item) => item.manualInputs)
        .map((item) => [planResultKey(item), item.manualInputs])
    );
    return selectedPlanControls().map((control, index) => {
      const plan = planForControl(control);
      const title = control.value;
      const detail = control.dataset.detail || "";
      const id = plan?.id || control.dataset.planId || `p${index + 1}`;
      const planType = classifyPlan(title, detail, plan);
      const text = `${title} ${detail}`;
      const rows = rowsForPlanText(text, planType);
      const candidateRows = candidateRowsForPlanText(text, planType);
      const total = resultPolicy.aggregateRowAmount(candidateRows);
      const top = rows.slice().sort((a, b) => b.value - a.value)[0] || null;
      const files = [...new Set(rows.map((row) => row.file))];
      const seededMissing = Array.isArray(plan?.result_contract?.missing_inputs) ? plan.result_contract.missing_inputs : [];
      const needs = planType.typed ? seededMissing : neededInputsForPlan(planType.subtype);
      const evidence = evidenceForPlan(text);
      const serverEvidence = planEvidenceChunks(plan);
      const reviewFlags = Array.isArray(plan?.review_flags) ? plan.review_flags : [];
      const result = {
        id,
        index: index + 1,
        title,
        detail,
        plan,
        group: planType.group,
        subtype: planType.subtype,
        label: planType.label,
        formula: planType.group === "cost" ? formulaForPlan(planType.subtype) : "",
        needs,
        status: planType.group === "cost"
          ? (rows.length ? "계산 후보" : "입력 필요")
          : (planType.group === "review" ? "근거 검토" : "사람 확인"),
        rowCount: rows.length,
        candidateRows,
        total,
        top,
        files,
        evidence,
        serverEvidence,
        evidenceStatus: plan?.evidence_status || (serverEvidence.length ? "confirmed" : "missing_evidence"),
        reviewFlags,
        rows: rows.slice(0, 8),
      };
      result.manualInputs = previousManualInputs.get(planResultKey(result)) || null;
      return result;
    });
  }

  function selectedPlanPayload() {
    return selectedPlanControls().map((control, index) => {
      const plan = planForControl(control);
      return {
        id: plan?.id || control.dataset.planId || `p${index + 1}`,
        title: control.value,
        detail: control.dataset.detail || plan?.detail || "",
      };
    });
  }

  function publicPlanResults() {
    return planExecutionResults.map((item) => ({
      title: item.title,
      detail: item.detail || "",
      group: item.group,
      label: item.label,
      formula: item.formula || "",
      status: effectiveReviewStatus(item),
      total: effectivePlanTotal(item),
      rowCount: item.rowCount || 0,
      needs: item.needs || [],
      files: item.files || [],
      evidenceStatus: item.evidenceStatus || "",
      reviewFlags: item.reviewFlags || [],
      result_contract: resultContractForItem(item),
      manual_inputs: item.manualInputs ? {
        ...item.manualInputs,
        amount: manualAmount(item),
      } : null,
      rows: (item.rows || []).slice(0, 8).map((row) => ({
        label: row.label,
        display_label: rowMeaning(row),
        row_header: row.rowHeader || "",
        column_header: row.columnHeader || "",
        label_confidence: row.labelConfidence || "",
        category: row.category,
        value: row.value,
        original_value: row.originalValue,
        overridden: !!cellOverrides.get(rowCellKey(row)),
        file: row.file,
        sheet: row.sheet,
        cell: row.cell,
        address: sourceCellAddress(row),
        source: sourceOf(row),
      })),
      evidence: [
        ...(item.serverEvidence || []).slice(0, 4).map((chunk) => ({
          source: evidenceChunkLabel(chunk),
          excerpt: chunk.excerpt || "",
          file_name: chunk.file_name || "",
        })),
        ...(item.evidence || []).slice(0, 3).map((ev) => ({
          source: sourceOf(ev),
          excerpt: ev.text || "",
          file_name: ev.file || "",
        })),
      ],
      result_contract: resultContractForItem(item),
    }));
  }

  function executionStatusLabel(status) {
    if (status === "calculated") return "계산 완료";
    if (status === "needs_human_action") return "사람 실행 필요";
    return "생성 완료";
  }

  function isLegacyArtifact(artifact) {
    const name = String(artifact?.name || "");
    const type = String(artifact?.content_type || "");
    return /\.(md|html?|csv)$/i.test(name) || /markdown|html|csv/i.test(type);
  }

  function friendlyArtifactName(artifact) {
    const name = String(artifact?.name || "");
    if (/^AI-실행-산출물\.pdf$/i.test(name)) return artifactDownloadName("pdf", "검토 결과");
    if (/^결과-리포트\.pdf$/i.test(name)) return reportDownloadName("pdf");
    if (/^계산-검토표\.xlsx$/i.test(name)) return artifactDownloadName("xlsx", "계산 검토표");
    return name || "보고서 파일";
  }

  function planRunStatusLabel(status) {
    if (status === "success") return "확인";
    if (status === "error") return "오류";
    return "검토 필요";
  }

  function planRunTooltip(run) {
    const contract = run.result_contract || run.resultContract || {};
    const kind = contract.kind ? resultKindLabel(contract.kind) : "검토 결과";
    const answer = contract.answer || run.summary || run.title || "검토 작업";
    const evidence = Array.isArray(run.evidence) && run.evidence.length
      ? run.evidence.slice(0, 5).map((ev) => evidenceChunkLabel(ev)).join(", ")
      : (Array.isArray(contract.evidence_refs) && contract.evidence_refs.length
        ? contract.evidence_refs.slice(0, 5).map((ref) => [ref.file_name || ref.label, ref.page ? `p.${ref.page}` : "", ref.sheet, ref.range].filter(Boolean).join(" · ")).join(", ")
        : "연결된 근거가 부족합니다.");
    const nextActions = Array.isArray(run.next_actions) && run.next_actions.length
      ? run.next_actions.slice(0, 5).join(", ")
      : (Array.isArray(contract.missing_inputs) && contract.missing_inputs.length
        ? contract.missing_inputs.slice(0, 5).join(", ")
        : "결과와 근거를 확인하세요.");
    return [
      `${kind} · ${answer}`,
      `근거: ${evidence}`,
      `다음 확인: ${nextActions}`,
    ].join("\n");
  }

  function planRunsHtml() {
    const runs = analysisPlanRuns?.runs || analysisExecution?.plan_runs?.runs || analysisExecution?.plan_runs || [];
    if (!Array.isArray(runs) || !runs.length) return "";
    return `<h3>플랜별 검토 기록</h3><ul class="plan-run-list">${runs.map((run) => {
      const tooltip = planRunTooltip(run);
      return `<li><strong>${esc(run.title || "검토 작업")}</strong> <span class="review-badge ${run.status === "success" ? "ok" : "need"}" data-tip="${attr(tooltip)}" aria-label="${attr(tooltip)}">${esc(planRunStatusLabel(run.status))}</span></li>`;
    }).join("")}</ul>`;
  }

  function executionResultGroupsHtml(executed) {
    if (!Array.isArray(executed) || !executed.length) return "";
    const groups = new Map();
    executed.forEach((item) => {
      const label = executionStatusLabel(item.status);
      if (!groups.has(label)) groups.set(label, { label, titles: [], results: [], artifacts: new Set() });
      const group = groups.get(label);
      if (item.title) group.titles.push(officeLabel(item.title));
      if (item.result) group.results.push(officeLabel(item.result));
      if (item.artifact) group.artifacts.add(officeLabel(item.artifact));
    });
    const rows = [...groups.values()].map((group) => {
      const artifacts = [...group.artifacts];
      const artifactText = artifacts.length ? artifacts.join(", ") : "서버 보관 보고서에 통합";
      const tooltip = [
        `${group.label} 작업 ${group.titles.length}개`,
        group.titles.length ? `작업: ${group.titles.join(", ")}` : "",
        group.results.length ? `결과: ${group.results.slice(0, 5).join(" / ")}` : "",
        `관련 문서: ${artifactText}`,
      ].filter(Boolean).join("\n");
      return `<li title="${attr(tooltip)}"><strong>${esc(group.label)}</strong> <span class="src">(${fmtWon(group.titles.length)}개)</span><br><span class="src">관련 문서: ${esc(artifactText)}</span></li>`;
    }).join("");
    return `<h3>검토 작업 결과</h3><ul class="execution-result-groups">${rows}</ul>`;
  }

  function executionArtifactsHtml() {
    const artifacts = analysisExecution?.artifacts || [];
    const currentArtifacts = artifacts.filter((artifact) => !isLegacyArtifact(artifact));
    const legacyArtifacts = artifacts.filter(isLegacyArtifact);
    const executed = analysisExecution?.executed || [];
    const humanTodos = analysisExecution?.human_todos || [];
    const artifactLinks = currentArtifacts.length
      ? `<p class="hint">아래 링크가 실제 다운로드 파일입니다. 검토 작업 결과의 ‘관련 문서’는 이 PDF/Excel 안에 통합된 세부 산출물 이름입니다.</p><ul class="artifact-list">${currentArtifacts.map((artifact) =>
          `<li><a href="${attr(artifact.download_url)}" target="_blank" rel="noopener">${esc(friendlyArtifactName(artifact))}</a>` +
          `${artifact.description ? `<br><span class="src">${esc(sanitizeTechnicalText(artifact.description))}</span>` : ""}</li>`
        ).join("")}</ul>`
      : "";
    const legacyNotice = legacyArtifacts.length
      ? `<p class="hint">이전에 만든 산출물이 이전 파일 형식으로 남아 있습니다. 현재 화면의 PDF·Excel은 초안 저장 버튼으로 새로 만들 수 있습니다.</p>`
      : "";
    const executedHtml = executionResultGroupsHtml(executed);
    const todoHtml = humanTodos.length
      ? `<h3>추가 확인 및 후속 조치</h3><p class="hint">아래 항목은 현재 등록된 파일만으로는 확정하지 못해 추가 자료 조사나 담당자 판단이 필요한 내용입니다.</p><ul>${humanTodos.map((item) => `<li>${esc(officeLabel(item))}</li>`).join("")}</ul>`
      : "";
    return [artifactLinks ? `<h3>다운로드 가능한 보고서</h3>${artifactLinks}` : "", legacyNotice, planRunsHtml(), executedHtml, todoHtml].filter(Boolean).join("");
  }

  function ensureExecutionArtifactsBox() {
    let box = $("executionArtifacts");
    if (box) return box;
    box = document.createElement("div");
    box.id = "executionArtifacts";
    box.className = "execution-artifacts";
    const printArea = $("printArea");
    printArea?.parentNode?.insertBefore(box, printArea);
    return box;
  }

  function renderExecutionArtifacts(data) {
    if (data) analysisExecution = data;
    const box = ensureExecutionArtifactsBox();
    const html = executionArtifactsHtml();
    box.innerHTML = html ? `<div class="summary-item">${html}</div>` : "";
  }

  async function runPlanRunsStep(options = {}) {
    await ensureAnalysisReady();
    if (!planExecutionResults.length && selectedPlanControls().length) {
      planExecutionResults = calculateSelectedPlanResults();
    }
    const data = await postJSON(`/api/analysis/sessions/${analysisSessionId}/plan-runs`, analysisContext({
      answers: selectedIdeaAnswers(),
      selectedPlans: selectedPlanPayload(),
      planResults: publicPlanResults(),
    }));
    analysisPlanRuns = data;
    renderExecutionArtifacts();
    if (!options.quiet) status(`✅ 플랜별 검토 기록 ${data.run_count || 0}건을 서버에 저장했습니다.`);
    return data;
  }

  async function runExecutionArtifactStep(options = {}) {
    reportStorageState = "storing";
    reportStorageError = "";
    renderEditCalculationReview();
    try {
      await ensureAnalysisReady();
      if (!planExecutionResults.length && selectedPlanControls().length) {
        planExecutionResults = calculateSelectedPlanResults();
      }
      if (options.skipPlanRuns !== true && selectedPlanPayload().length) {
        await runPlanRunsStep({ quiet: true });
      }
      const data = await postJSON(`/api/analysis/sessions/${analysisSessionId}/executions`, analysisContext({
        answers: selectedIdeaAnswers(),
        selectedPlans: selectedPlanPayload(),
        planResults: publicPlanResults(),
        reportText: $("printArea")?.innerText || "",
      }));
      analysisExecution = data;
      reportStorageState = "stored";
      reportStorageError = "";
      renderExecutionArtifacts(data);
      renderEditCalculationReview();
      if (window.refreshUsage) window.refreshUsage();
      const cost = data.cost_krw != null ? ` · ${data.cost_krw.toFixed(2)}원` : "";
      const fallback = data.fallback_from ? ` · 대체 실행 ${data.fallback_from} → ${data.provider}/${data.model}` : "";
      if (!options.quiet) status(`✅ 서버에 검토 기록 보관 완료 (${data.provider}/${data.model})${fallback}${cost}`);
      return data;
    } catch (err) {
      reportStorageState = "failed";
      reportStorageError = err?.message || "서버 보관 실패";
      renderEditCalculationReview();
      throw err;
    }
  }

  function fileTypeFromName(name) {
    if (/\.pdf$/i.test(name || "")) return "pdf";
    if (/\.xlsx?$/i.test(name || "")) return "xlsx";
    if (/\.csv$/i.test(name || "")) return "xlsx";
    return "text";
  }

  function fileDownloadUrl(fileId) {
    if (!analysisSessionId || !fileId) return "";
    return `/api/analysis/sessions/${encodeURIComponent(analysisSessionId)}/files/${encodeURIComponent(fileId)}`;
  }

  function findAnalysisFileByName(name) {
    const normalized = cleanFileTitle(name).toLowerCase();
    return analysisFiles.find((file) => file.name === name || cleanFileTitle(file.name).toLowerCase() === normalized) || null;
  }

  function evidencePageHint(text) {
    const match = String(text || "").match(/(?:page|p\.?|페이지|쪽)\s*(\d{1,4})/i);
    return match ? Number(match[1]) : null;
  }

  function evidenceRefsForItem(item) {
    const refs = [];
    const candidateFields = Array.isArray(item?.manualInputs?.fields)
      ? item.manualInputs.fields.filter((field) => field.source === "candidate" && field.candidate)
      : [];
    candidateFields.forEach((field) => {
      const candidate = field.candidate || {};
      const nested = Array.isArray(candidate.evidence_refs) ? candidate.evidence_refs[0] : null;
      refs.push({
        type: nested?.type || fileTypeFromName(nested?.file_name || ""),
        label: `${field.label} 후보값`,
        file_id: nested?.file_id || "",
        file_name: nested?.file_name || "AI 후보 선택",
        page: nested?.page || null,
        sheet: nested?.sheet || "",
        range: nested?.range || "",
        highlight_cells: nested?.range ? [nested.range] : [],
        excerpt: `${field.label}: ${[field.value, field.unit].filter(Boolean).join(" ")} (${candidate.label || "추천 후보"})`,
        download_url: nested?.download_url || "",
        source: "candidate",
      });
    });
    (item?.serverEvidence || []).slice(0, 6).forEach((chunk, index) => {
      const file = findAnalysisFileByName(chunk.file_name);
      refs.push({
        type: fileTypeFromName(chunk.file_name),
        label: evidenceChunkLabel(chunk),
        file_id: chunk.file_id || file?.id || "",
        file_name: chunk.file_name || "근거 자료",
        page: chunk.page || evidencePageHint(`${chunk.excerpt || ""} ${evidenceChunkLabel(chunk)}`),
        sheet: chunk.sheet || "",
        range: chunk.range || "",
        highlight_cells: chunk.range ? [chunk.range] : [],
        excerpt: chunk.excerpt || "",
        download_url: fileDownloadUrl(chunk.file_id || file?.id),
        score: chunk.score,
        source: chunk.source,
      });
    });
    (item?.rows || []).slice(0, 6).forEach((row) => {
      const file = findAnalysisFileByName(row.file);
      refs.push({
        type: fileTypeFromName(row.file),
        label: sourceOf(row),
        file_id: file?.id || "",
        file_name: row.file || "계산 근거",
        sheet: row.sheet || "",
        range: row.cell || "",
        highlight_cells: row.cell ? [row.cell] : [],
        excerpt: `${row.label}${row.value != null ? ` · ${fmtWon(row.value)}` : ""}`,
        download_url: fileDownloadUrl(file?.id),
      });
    });
    (item?.evidence || []).slice(0, 4).forEach((ev) => {
      const file = findAnalysisFileByName(ev.file);
      refs.push({
        type: fileTypeFromName(ev.file),
        label: sourceOf(ev),
        file_id: file?.id || "",
        file_name: ev.file || "근거 자료",
        sheet: ev.sheet || "",
        range: ev.cell || "",
        highlight_cells: ev.cell ? [ev.cell] : [],
        excerpt: ev.text || "",
        download_url: fileDownloadUrl(file?.id),
      });
    });
    return refs;
  }

  function compactEvidenceRef(ref) {
    return {
      type: ref.type || "text",
      label: ref.label || "",
      file_name: ref.file_name || "",
      page: ref.page || null,
      sheet: ref.sheet || "",
      range: ref.range || "",
      excerpt: String(ref.excerpt || "").slice(0, 360),
      score: ref.score,
      download_url: ref.download_url || "",
    };
  }

  function evidenceRefShortLabel(ref, index = 0) {
    const name = cleanFileTitle(ref.file_name || ref.label || `근거 ${index + 1}`);
    if (ref.type === "pdf" && ref.page) return `${name} p.${ref.page}`;
    if (ref.type === "xlsx") {
      const range = [ref.sheet, ref.range].filter(Boolean).join(" ");
      return range ? `${name} · ${range}` : name;
    }
    if (ref.range) return `${name} · ${ref.range}`;
    return name || `근거 ${index + 1}`;
  }

  function evidenceChipLabel(refs, fallbackText = "") {
    if (refs.length === 1) return evidenceRefShortLabel(refs[0], 0);
    if (refs.length > 1) return `근거 ${fmtWon(refs.length)}개`;
    return fallbackText ? "근거" : "근거 확인";
  }

  function evidencePopoverButton(item, index) {
    const refs = evidenceRefsForItem(item).slice(0, 6).map(compactEvidenceRef);
    const text = reviewEvidenceText(item);
    if (!text && !refs.length) return "";
    return `<button class="evidence-help evidence-chip" type="button" ` +
      `data-evidence-result="${index}" data-evidence-text="${attr(text)}" ` +
      `data-evidence-refs="${attr(JSON.stringify(refs))}" aria-label="근거 상세 보기">` +
      `${esc(evidenceChipLabel(refs, text))}</button>`;
  }

  function evidencePopoverFallbackHtml(text, resultIndex) {
    const body = String(text || "").split(/\s\/\s|\n+/).filter(Boolean).slice(0, 5)
      .map((line) => `<p>${esc(line)}</p>`).join("");
    const action = Number.isFinite(resultIndex)
      ? `<div class="evidence-popover-actions"><button class="btn btn-dark btn-small" type="button" data-evidence-result="${resultIndex}">원본근거 확인</button></div>`
      : "";
    return `<div class="evidence-popover-head"><strong>근거 상세</strong></div>${body || '<p>표시할 근거 발췌가 없습니다.</p>'}${action}`;
  }

  function evidencePopoverHtml(button) {
    const resultIndex = Number(button.dataset.evidenceResult);
    let refs = [];
    try {
      refs = JSON.parse(button.dataset.evidenceRefs || "[]");
    } catch {
      refs = [];
    }
    if (!refs.length) return evidencePopoverFallbackHtml(button.dataset.evidenceText || button.getAttribute("title") || "", resultIndex);
    const items = refs.map((ref, index) => {
      const location = [
        ref.page ? `PDF page ${ref.page}` : "",
        ref.sheet ? `시트 ${ref.sheet}` : "",
        ref.range ? `범위 ${ref.range}` : "",
      ].filter(Boolean).join(" · ");
      const score = typeof ref.score === "number" ? `<span class="evidence-score">매칭 ${Math.round(ref.score * 100)}%</span>` : "";
      return `<article class="evidence-popover-item">
        <strong>${esc(evidenceRefShortLabel(ref, index))}</strong>
        ${location || score ? `<div class="evidence-meta">${esc(location)}${score}</div>` : ""}
        ${ref.excerpt ? `<p>${esc(ref.excerpt)}</p>` : ""}
      </article>`;
    }).join("");
    const action = Number.isFinite(resultIndex)
      ? `<div class="evidence-popover-actions"><button class="btn btn-dark btn-small" type="button" data-evidence-result="${resultIndex}">원본근거 확인</button></div>`
      : "";
    return `<div class="evidence-popover-head"><strong>근거 상세</strong><span>${fmtWon(refs.length)}개</span></div>${items}${action}`;
  }

  function evidenceHighlightTerms(ref) {
    const stop = new Set(["근거", "자료", "파일", "페이지", "시트", "범위", "계산", "확인", "필요", "대한", "에서", "으로", "하고", "또는"]);
    const raw = [ref.excerpt, ref.label, ref.file_name].filter(Boolean).join(" ");
    const terms = new Set();
    (raw.match(/[가-힣A-Za-z0-9.%·()]{2,}/g) || []).forEach((token) => {
      const clean = token.replace(/^[()]+|[()]+$/g, "");
      if (clean.length < 2 || stop.has(clean)) return;
      if (/^\d+$/.test(clean) && clean.length < 2) return;
      terms.add(clean);
    });
    if (ref.range) terms.add(ref.range);
    return [...terms].sort((a, b) => b.length - a.length).slice(0, 14);
  }

  function highlightHtml(text, terms) {
    const value = String(text || "");
    const usable = (terms || []).filter((term) => String(term || "").length >= 2).slice(0, 18);
    if (!value || !usable.length) return esc(value);
    const pattern = new RegExp(usable.map(reEscape).join("|"), "gi");
    let last = 0;
    let html = "";
    value.replace(pattern, (match, offset) => {
      html += esc(value.slice(last, offset));
      html += `<mark>${esc(match)}</mark>`;
      last = offset + match.length;
      return match;
    });
    return html + esc(value.slice(last));
  }

  function enhancedEvidenceRefShell(ref, index) {
    const download = ref.download_url
      ? `<a class="btn btn-ghost btn-small" href="${attr(ref.download_url)}" target="_blank" rel="noopener">원본 열기</a>`
      : "";
    const meta = [
      ref.type === "pdf" && ref.page ? `PDF page ${ref.page}` : "",
      ref.type === "xlsx" && ref.sheet ? `시트 ${ref.sheet}` : "",
      ref.range ? `범위 ${ref.range}` : "",
      ref.label && !ref.page && !ref.sheet && !ref.range ? ref.label : "",
    ].filter(Boolean).join(" · ");
    const terms = evidenceHighlightTerms(ref);
    return `<article class="evidence-ref evidence-ref-enhanced">
      <div class="evidence-ref-head"><strong>근거 ${index + 1}. ${esc(ref.file_name || ref.label || "근거 자료")}</strong>${download}</div>
      <div class="evidence-meta">${esc(meta || "원본근거")}</div>
      ${ref.excerpt ? `<div class="evidence-highlight-excerpt">${highlightHtml(ref.excerpt, terms)}</div>` : ""}
      <div class="evidence-source-preview" data-evidence-preview-index="${index}">
        <p class="hint">원본근거를 불러오는 중입니다...</p>
      </div>
    </article>`;
  }

  function evidenceRefHtml(ref, index) {
    if (isEdit2Page) return enhancedEvidenceRefShell(ref, index);
    const download = ref.download_url
      ? `<a class="btn btn-ghost btn-small" href="${attr(ref.download_url)}" target="_blank" rel="noopener">원본 열기</a>`
      : "";
    if (ref.type === "xlsx") {
      return `<article class="evidence-ref">
        <div class="evidence-ref-head"><strong>근거 ${index + 1}. ${esc(ref.file_name)}</strong>${download}</div>
        <div class="evidence-meta">${esc([ref.sheet && `시트 ${ref.sheet}`, ref.range && `범위 ${ref.range}`].filter(Boolean).join(" · ") || ref.label)}</div>
        <div class="evidence-sheet-preview">
          <div class="evidence-sheet-row is-highlight"><span>${esc(ref.range || "행/셀")}</span><strong>${esc(ref.excerpt || "선택된 셀/행 근거")}</strong></div>
        </div>
      </article>`;
    }
    if (ref.type === "pdf") {
      return `<article class="evidence-ref">
        <div class="evidence-ref-head"><strong>근거 ${index + 1}. ${esc(ref.file_name)}</strong>${download}</div>
        <div class="evidence-meta">${esc(ref.page ? `PDF page ${ref.page}` : ref.label || "PDF 발췌 근거")}</div>
        <blockquote>${esc(ref.excerpt || "발췌문 정보가 아직 없습니다.")}</blockquote>
      </article>`;
    }
    return `<article class="evidence-ref">
      <div class="evidence-ref-head"><strong>근거 ${index + 1}. ${esc(ref.file_name || ref.label)}</strong>${download}</div>
      <div class="evidence-meta">${esc(ref.label || "")}</div>
      <blockquote>${esc(ref.excerpt || "근거 발췌가 아직 없습니다.")}</blockquote>
    </article>`;
  }

  function pdfTextLines(textContent) {
    const rows = new Map();
    (textContent.items || []).forEach((item) => {
      const str = String(item.str || "").trim();
      if (!str) return;
      const tx = item.transform || [];
      const y = Math.round(Number(tx[5]) || 0);
      const x = Number(tx[4]) || 0;
      const row = rows.get(y) || [];
      row.push({ x, str });
      rows.set(y, row);
    });
    return [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, row]) => row.sort((a, b) => a.x - b.x).map((part) => part.str).join(" ").replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function relevantPdfLines(lines, terms) {
    const loweredTerms = terms.map((term) => term.toLowerCase());
    const hits = [];
    lines.forEach((line, index) => {
      const lower = line.toLowerCase();
      if (loweredTerms.some((term) => lower.includes(term))) hits.push(index);
    });
    if (!hits.length) return lines.slice(0, 36);
    const include = new Set();
    hits.slice(0, 12).forEach((index) => {
      for (let i = Math.max(0, index - 1); i <= Math.min(lines.length - 1, index + 1); i++) include.add(i);
    });
    return [...include].sort((a, b) => a - b).map((index) => lines[index]);
  }

  async function renderPdfEvidencePreview(ref, host) {
    if (!window.pdfjsLib || !ref.download_url) throw new Error("PDF 원본을 읽을 수 없습니다.");
    const loading = window.pdfjsLib.getDocument(ref.download_url);
    const pdf = await loading.promise;
    const pageNo = Math.min(Math.max(Number(ref.page) || 1, 1), pdf.numPages || 1);
    const page = await pdf.getPage(pageNo);
    const textContent = await page.getTextContent();
    const lines = relevantPdfLines(pdfTextLines(textContent), evidenceHighlightTerms(ref));
    const terms = evidenceHighlightTerms(ref);
    host.innerHTML = `<div class="evidence-preview-toolbar">
        <strong>PDF ${pageNo} / ${pdf.numPages}</strong>
        <span>발췌문 기준 AI 하이라이트</span>
      </div>
      <div class="evidence-pdf-page">
        ${lines.length ? lines.map((line) => `<p>${highlightHtml(line, terms)}</p>`).join("") : `<p>${highlightHtml(ref.excerpt || "텍스트를 추출하지 못했습니다.", terms)}</p>`}
      </div>`;
  }

  function decodeEvidenceRange(rangeText, fallback) {
    const value = String(rangeText || "").trim();
    if (value && window.XLSX) {
      try { return XLSX.utils.decode_range(value.replace(/\$/g, "")); } catch { /* fall through */ }
    }
    const rowMatch = value.match(/row\s*(\d+)|행\s*(\d+)/i);
    if (rowMatch) {
      const r = Math.max(0, Number(rowMatch[1] || rowMatch[2]) - 1);
      return { s: { r, c: fallback.s.c }, e: { r, c: Math.min(fallback.e.c, fallback.s.c + 6) } };
    }
    return { s: fallback.s, e: { r: Math.min(fallback.e.r, fallback.s.r + 10), c: Math.min(fallback.e.c, fallback.s.c + 5) } };
  }

  function cellInRange(row, col, range) {
    return row >= range.s.r && row <= range.e.r && col >= range.s.c && col <= range.e.c;
  }

  async function loadWorkbookForEvidence(ref) {
    const fileName = ref.file_name || ref.label || "근거.xlsx";
    const cached = workbookCache.get(fileName);
    if (cached?.wb) return cached;
    const local = findAnalysisFileByName(fileName);
    let buffer = null;
    if (local?.costFile) buffer = await local.costFile.arrayBuffer();
    else if (local?.file) buffer = await local.file.arrayBuffer();
    else if (ref.download_url) {
      const res = await fetch(ref.download_url);
      if (!res.ok) throw new Error(`Excel 원본 다운로드 실패(${res.status})`);
      buffer = await res.arrayBuffer();
    }
    if (!buffer) throw new Error("Excel 원본을 읽을 수 없습니다.");
    const wb = XLSX.read(buffer, { type: "array" });
    rememberWorkbook(fileName, wb, { source: local ? "upload" : "download" });
    return workbookCache.get(fileName);
  }

  function parseEditedCellValue(text) {
    const raw = String(text || "").trim();
    const numeric = raw.replace(/[,\s원₩]/g, "");
    if (/^-?\d+(\.\d+)?$/.test(numeric)) return { t: "n", v: Number(numeric), display: raw };
    return { t: raw ? "s" : "z", v: raw, display: raw };
  }

  function setWorksheetCellValue(ws, addr, parsed) {
    if (!ws || !addr) return;
    if (parsed.t === "z") {
      delete ws[addr];
      return;
    }
    ws[addr] = { t: parsed.t, v: parsed.v };
  }

  function updateCostRowFromCell(fileName, sheetName, addr, parsed) {
    const row = costAll.find((item) => item.file === fileName && item.sheet === sheetName && item.cell === addr);
    if (!row) return false;
    if (parsed.t === "n" && Number.isFinite(parsed.v)) {
      row.value = parsed.v;
      row.overridden = true;
      return true;
    }
    row.overridden = true;
    return false;
  }

  function refreshAfterSpreadsheetEdit(message) {
    renderCostTable();
    if (selectedPlanControls().length) {
      planExecutionResults = calculateSelectedPlanResults();
    }
    reportStorageState = "idle";
    reportStorageError = "";
    if (lastHeuristic) {
      const next = buildHeuristicModel();
      if (next) renderHeuristic(next);
    }
    renderEditCalculationReview();
    runBuildResultStep({ quiet: true });
    status(message || "✅ 엑셀 수정값을 계산표와 결과 리포트에 반영했습니다.");
  }

  function applySpreadsheetCellEdit(cellEl) {
    const fileName = cellEl?.dataset.xlsxFile || "";
    const sheetName = cellEl?.dataset.xlsxSheet || "";
    const addr = cellEl?.dataset.xlsxCell || "";
    if (!fileName || !sheetName || !addr) return;
    const nextText = String(cellEl.textContent || "").trim();
    if (nextText === (cellEl.dataset.cellValue || "")) return;
    const cached = workbookCache.get(fileName);
    const ws = cached?.wb?.Sheets?.[sheetName];
    if (!ws) return;
    const originalCell = ws[addr];
    rememberOriginalCell(fileName, sheetName, addr, originalCell);
    const parsed = parseEditedCellValue(nextText);
    setWorksheetCellValue(ws, addr, parsed);
    const key = cellKey(fileName, sheetName, addr);
    cellOverrides.set(key, { fileName, sheetName, addr, value: parsed.v, t: parsed.t, display: nextText, updated_at: new Date().toISOString() });
    updateCostRowFromCell(fileName, sheetName, addr, parsed);
    cellEl.dataset.cellValue = nextText;
    cellEl.classList.add("is-overridden");
    refreshAfterSpreadsheetEdit(`${addr} 수정값을 계산표에 반영했습니다.`);
  }

  function restoreWorkbookOverrides(fileName, sheetName = "") {
    const cached = workbookCache.get(fileName);
    if (!cached?.wb) return;
    const targets = [...cellOverrides.values()].filter((item) => item.fileName === fileName && (!sheetName || item.sheetName === sheetName));
    targets.forEach((item) => {
      const ws = cached.wb.Sheets[item.sheetName];
      const original = cellOriginalValues.get(cellKey(item.fileName, item.sheetName, item.addr));
      if (!ws || !original) return;
      if (original.t === "z") delete ws[item.addr];
      else ws[item.addr] = { t: original.t, v: original.v, w: original.w, f: original.f };
      const row = costAll.find((r) => r.file === item.fileName && r.sheet === item.sheetName && r.cell === item.addr);
      if (row && typeof original.v === "number") {
        row.value = original.v;
        row.overridden = false;
      }
      cellOverrides.delete(cellKey(item.fileName, item.sheetName, item.addr));
    });
    refreshAfterSpreadsheetEdit("원본 값으로 되돌리고 계산표를 다시 반영했습니다.");
    const viewer = $("evidenceViewer");
    const index = Number(viewer?.dataset.resultIndex);
    if (Number.isFinite(index)) openEvidenceViewer(index);
  }

  function downloadEditedWorkbook(fileName) {
    const cached = workbookCache.get(fileName);
    if (!cached?.wb || !window.XLSX) return;
    const data = XLSX.write(cached.wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${cleanFileTitle(fileName) || "수정본"}-수정본.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function renderExcelEvidencePreview(ref, host) {
    if (!window.XLSX) throw new Error("Excel 원본을 읽을 수 없습니다.");
    const loaded = await loadWorkbookForEvidence(ref);
    const wb = loaded.wb;
    const fileName = loaded.fileName || ref.file_name || ref.label || "근거.xlsx";
    const sheetName = (ref.sheet && wb.Sheets[ref.sheet]) ? ref.sheet : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const full = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
    const target = decodeEvidenceRange(ref.range, full);
    const view = {
      s: { r: Math.max(full.s.r, target.s.r - 3), c: Math.max(full.s.c, target.s.c - 2) },
      e: { r: Math.min(full.e.r, target.e.r + 3), c: Math.min(full.e.c, target.e.c + 3) },
    };
    const terms = evidenceHighlightTerms(ref);
    const head = [];
    for (let c = view.s.c; c <= view.e.c; c++) head.push(`<th>${esc(XLSX.utils.encode_col(c))}</th>`);
    const rows = [];
    for (let r = view.s.r; r <= view.e.r; r++) {
      const cells = [];
      for (let c = view.s.c; c <= view.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        rememberOriginalCell(fileName, sheetName, addr, cell);
        const value = worksheetDisplayValue(cell);
        const key = cellKey(fileName, sheetName, addr);
        const cls = [
          cellInRange(r, c, target) ? "is-highlight" : "",
          cellOverrides.has(key) ? "is-overridden" : "",
        ].filter(Boolean).join(" ");
        cells.push(`<td class="${cls}" contenteditable="true" spellcheck="false" data-xlsx-file="${attr(fileName)}" data-xlsx-sheet="${attr(sheetName)}" data-xlsx-cell="${attr(addr)}" data-cell-value="${attr(value)}" title="셀을 수정하면 계산표에 즉시 반영됩니다.">${highlightHtml(value, terms)}</td>`);
      }
      rows.push(`<tr class="${r >= target.s.r && r <= target.e.r ? "row-highlight" : ""}"><th>${r + 1}</th>${cells.join("")}</tr>`);
    }
    host.innerHTML = `<div class="evidence-preview-toolbar">
        <div><strong>${esc(sheetName)}</strong><span>${esc(ref.range || "근거 범위 주변")}</span></div>
        <div class="evidence-edit-actions">
          <button class="btn btn-ghost btn-small" type="button" data-restore-workbook="${attr(fileName)}" data-restore-sheet="${attr(sheetName)}">원본 값으로 되돌리기</button>
          <button class="btn btn-ghost btn-small" type="button" data-export-workbook="${attr(fileName)}">수정본 엑셀 내보내기</button>
        </div>
      </div>
      <div class="evidence-excel-scroll"><table class="evidence-excel-table">
        <thead><tr><th></th>${head.join("")}</tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table></div>`;
  }

  async function renderEnhancedEvidencePreview(ref, host) {
    try {
      if (ref.type === "pdf") await renderPdfEvidencePreview(ref, host);
      else if (ref.type === "xlsx") await renderExcelEvidencePreview(ref, host);
      else host.innerHTML = `<div class="evidence-pdf-page"><p>${highlightHtml(ref.excerpt || ref.label || "표시할 원본근거가 없습니다.", evidenceHighlightTerms(ref))}</p></div>`;
    } catch (err) {
      host.innerHTML = `<div class="evidence-preview-fallback">
        <strong>원본 미리보기 대신 발췌문을 표시합니다.</strong>
        <p>${highlightHtml(ref.excerpt || err.message || "원본근거를 불러오지 못했습니다.", evidenceHighlightTerms(ref))}</p>
      </div>`;
    }
  }

  function renderEnhancedEvidencePreviews(refs) {
    if (!isEdit2Page) return;
    document.querySelectorAll("[data-evidence-preview-index]").forEach((host) => {
      const ref = refs[Number(host.dataset.evidencePreviewIndex)];
      if (ref) renderEnhancedEvidencePreview(ref, host);
    });
  }

  function ensureEvidenceViewer() {
    let viewer = $("evidenceViewer");
    if (viewer) return viewer;
    viewer = document.createElement("aside");
    viewer.id = "evidenceViewer";
    viewer.className = "evidence-viewer";
    viewer.hidden = true;
    viewer.innerHTML = `
      <div class="evidence-viewer-head">
        <div><span class="edit-eyebrow">원본근거 확인</span><h3 id="evidenceViewerTitle">근거 자료</h3></div>
        <button class="side-close" type="button" data-close-evidence-viewer aria-label="닫기">×</button>
      </div>
      <div id="evidenceViewerBody" class="evidence-viewer-body"></div>`;
    document.body.appendChild(viewer);
    return viewer;
  }

  function firstEvidenceResultIndex() {
    const withEvidence = planExecutionResults.findIndex((item) => evidenceRefsForItem(item).length > 0);
    if (withEvidence >= 0) return withEvidence;
    return planExecutionResults.length ? 0 : -1;
  }

  function openEvidenceViewer(index) {
    const item = planExecutionResults[index];
    if (!item) return;
    const viewer = ensureEvidenceViewer();
    viewer.classList.toggle("evidence-viewer-enhanced", isEdit2Page);
    viewer.dataset.resultIndex = String(index);
    const refs = evidenceRefsForItem(item);
    $("evidenceViewerTitle").textContent = item.title || "근거 자료";
    $("evidenceViewerBody").innerHTML = refs.length
      ? refs.map(evidenceRefHtml).join("")
      : '<p class="hint">이 항목에는 아직 원본근거가 연결되지 않았습니다.</p>';
    viewer.hidden = false;
    document.body.classList.add("evidence-viewer-open");
    renderEnhancedEvidencePreviews(refs);
  }

  function openFirstEvidenceViewer() {
    const index = firstEvidenceResultIndex();
    if (index < 0) {
      status("자동 분석 후 원본근거를 확인할 수 있습니다.", true);
      openCard(6, true);
      return;
    }
    openEvidenceViewer(index);
  }

  function closeEvidenceViewer() {
    const viewer = $("evidenceViewer");
    if (viewer) viewer.hidden = true;
    document.body.classList.remove("evidence-viewer-open");
  }

  function ensureManualInputPanel() {
    let panel = $("manualInputPanel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "manualInputPanel";
    panel.className = "manual-input-panel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="manual-input-card">
        <div class="manual-input-head">
          <div><span class="edit-eyebrow">담당자 입력</span><h3 id="manualInputTitle">입력값 보완</h3></div>
          <button class="side-close" type="button" data-close-manual-input aria-label="닫기">×</button>
        </div>
        <div id="manualInputBody"></div>
        <div class="result-actions compact-actions">
          <button class="btn btn-dark btn-small" type="button" data-save-manual-input>저장</button>
          <button class="btn btn-ghost btn-small" type="button" data-close-manual-input>취소</button>
        </div>
      </div>`;
    document.body.appendChild(panel);
    return panel;
  }

  function openManualInputPanel(index) {
    const item = planExecutionResults[index];
    if (!item) return;
    const panel = ensureManualInputPanel();
    panel.dataset.resultIndex = String(index);
    const fields = humanInputFieldState(item).slice(0, 8);
    renderManualInputPanel(panel, item, index, fields);
    augmentManualCandidatesFromRetriever(index, item, fields);
  }

  function renderManualInputPanel(panel, item, index, fields) {
    panel.dataset.resultIndex = String(index);
    const labels = fields.map((field) => field.label);
    $("manualInputTitle").textContent = item.title || "부족한 계산값 입력";
    $("manualInputBody").innerHTML = `
      <p class="hint">${esc(manualPanelIntro(item, labels))}</p>
      <div class="manual-guide-box">
        <strong>무엇을 입력하나요?</strong>
        <span>계산식에 들어갈 실제 숫자, 단가, 횟수, 기준을 확인합니다. 후보를 고르거나 직접 입력할 수 있고, 모르는 값은 확인 필요로 남길 수 있습니다.</span>
      </div>
      <div class="manual-field-grid">
        ${fields.map((field) => {
          const guide = manualFieldGuide(field.label, item);
          const sourceNote = field.candidates?.length
            ? `AI 후보 ${field.candidates.length}개 중 선택하거나 직접 입력하세요.`
            : "AI 후보가 부족하면 직접 입력하세요.";
          return `<div class="manual-field-card"
            data-human-field="${attr(field.id || field.label)}"
            data-human-label="${attr(field.label)}"
            data-human-kind="${attr(field.kind || "text")}"
            data-human-impact="${attr(field.impact || "medium")}"
            data-human-required="${field.required === false ? "false" : "true"}"
            data-human-reason="${attr(field.reason || "")}"
            data-human-selection="${attr(field.selection || "")}"
            data-human-candidates="${attr(JSON.stringify(field.candidates || []))}">
            <div class="manual-field-top">
              <strong>${esc(field.label)}</strong>
              <span class="manual-impact ${esc(field.impact || "medium")}">${esc(impactLabel(field.impact))}</span>
            </div>
            ${manualInputModeHtml(field)}
            <div class="manual-candidate-row" ${field.candidates?.length && String(field.selection || "").startsWith("candidate:") ? "" : "hidden"}>
              ${manualCandidateValueSelectHtml(field)}
            </div>
            <div class="manual-value-row" ${field.selection === "custom" || !field.candidates?.length ? "" : "hidden"}>
              <input type="text" data-manual-field="${attr(field.label)}" value="${attr(field.value ?? "")}" placeholder="${attr(guide.placeholder)}" />
              <input type="text" data-manual-unit value="${attr(field.unit || "")}" placeholder="단위" />
            </div>
            ${field.candidates?.length ? `<label class="manual-verify-row" ${String(field.selection || "").startsWith("candidate:") ? "" : "hidden"}>
              <input type="checkbox" data-human-verified ${field.human_verified === true ? "checked" : ""} />
              원본 근거를 확인했으며 이 후보를 확정합니다.
            </label>` : ""}
            <span class="manual-field-help">${esc(field.reason || sourceNote)} ${esc(guide.help)}</span>
          </div>`;
        }).join("")}
      </div>
      <label class="manual-memo">확인 메모<textarea data-manual-memo rows="3" placeholder="예: 교통비는 버스 왕복 기준, 단가는 2025년 노임단가표 p.3 적용">${esc(item.manualInputs?.memo || "")}</textarea></label>`;
    panel.hidden = false;
    panel.querySelectorAll("[data-manual-mode]").forEach((select) => applyManualInputMode(select, true));
    panel.querySelectorAll("[data-manual-select]").forEach((select) => applyManualCandidateSelection(select, true));
  }

  // 리트리버가 돌려준 숫자를 조합 단위 로직에 태워 후보로 만든다(로컬 후보와 동일한 형식).
  function retrieverValueCandidates(label, item, values) {
    const units = combinationUnitsForField(label, item);
    const candidates = [];
    (values || []).forEach((entry) => {
      const value = Number(entry?.value);
      if (!isPlausibleFieldValue(label, item, value)) return; // 필드에 안 맞는 값 제거
      const applicable = [];
      const seen = new Set();
      // 추출된 자체 단위 + 필드 단위. 필드에 단위가 있으면 '단위 없음'은 넣지 않는다.
      const unitPool = entry?.unit ? [entry.unit, ...units] : (units.length ? units : [""]);
      unitPool.forEach((unit) => {
        const key = String(unit || "");
        if (seen.has(key)) return;
        seen.add(key);
        applicable.push(unit || "");
      });
      applicable.forEach((unit) => {
        const valueText = `${fmtWon(value)}${unit || ""}`;
        candidates.push({
          value,
          unit,
          // 어떤 항목/장비의 값인지 이름을 함께 표기한다.
          label: `${valueText}${entry?.name ? ` · ${entry.name}` : ""} · 리트리버 추정${entry?.source ? ` (${entry.source})` : ""}`,
          scenario_key: `retriever::${unit}`,
          evidence_refs: [{
            file_name: entry?.file_name || entry?.source || "리트리버",
            sheet: "",
            range: entry?.range || "",
            label: "리트리버 검색",
            excerpt: entry?.excerpt || "",
          }],
          confidence: "low",
        });
      });
    });
    return sampleManualCandidates(candidates, `retriever::${item?.id || item?.title || "item"}::${label}`);
  }

  async function augmentManualCandidatesFromRetriever(index, item, fields) {
    if (!analysisSessionId) return;
    const emptyFields = fields.filter((field) =>
      !(field.candidates?.length) && !["boolean", "text", "unit"].includes(field.kind) && field.status !== "excluded"
    );
    if (!emptyFields.length) return;
    let payload;
    try {
      const res = await window.apiFetch(`/api/analysis/sessions/${encodeURIComponent(analysisSessionId)}/field-candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: emptyFields.map((field) => ({
            label: field.label,
            context: `${item?.title || ""} ${item?.detail || ""} ${item?.formula || ""}`.trim(),
          })),
        }),
      });
      if (!res.ok) return;
      payload = await res.json();
    } catch { return; }
    const byLabel = payload?.candidates || {};
    const panel = $("manualInputPanel");
    if (!panel || panel.dataset.resultIndex !== String(index)) return; // 다른 항목으로 이동했으면 무시
    // 그새 사용자가 입력 중인 메모·값은 보존한다.
    const memoEl = panel.querySelector("[data-manual-memo]");
    if (memoEl) item.manualInputs = { ...(item.manualInputs || {}), memo: memoEl.value };
    const typedLabels = new Set(
      Array.from(panel.querySelectorAll("[data-human-field]"))
        .filter((row) => String(row.querySelector("[data-manual-field]")?.value || "").trim())
        .map((row) => row.dataset.humanLabel)
    );
    let changed = false;
    emptyFields.forEach((field) => {
      if (field.candidates?.length || typedLabels.has(field.label)) return; // 이미 채워졌거나 사용자가 입력 중이면 건너뜀
      const values = Array.isArray(byLabel[field.label]) ? byLabel[field.label] : [];
      const candidates = retrieverValueCandidates(field.label, item, values);
      if (candidates.length) {
        field.candidates = candidates;
        field.candidateSource = "retriever";
        changed = true;
      }
    });
    if (changed) renderManualInputPanel(panel, item, index, fields);
  }

  // 자동 분석 시작 직후: 입력 필요 항목의 빈 후보를 리트리버로 미리 채워 둔다.
  // 채운 후보는 item.manualInputs.fields 레코드에 저장 → 다이얼로그가 열릴 때 그대로 읽힌다.
  async function prefetchRetrieverCandidatesForPending() {
    if (!analysisSessionId || !planExecutionResults.length) return true;
    for (const item of planExecutionResults) {
      const emptyFields = humanInputFieldState(item).filter((field) =>
        !(field.candidates?.length) && !["boolean", "text", "unit"].includes(field.kind) && field.status !== "excluded" && field.required !== false
      );
      if (!emptyFields.length) continue;
      let payload;
      try {
        const res = await window.apiFetch(`/api/analysis/sessions/${encodeURIComponent(analysisSessionId)}/field-candidates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: emptyFields.map((field) => ({
              label: field.label,
              context: `${item?.title || ""} ${item?.detail || ""} ${item?.formula || ""}`.trim(),
            })),
          }),
        });
        if (!res.ok) continue;
        payload = await res.json();
      } catch { continue; }
      const byLabel = payload?.candidates || {};
      const records = Array.isArray(item.manualInputs?.fields) ? item.manualInputs.fields.slice() : [];
      const recordByLabel = new Map(records.map((rec) => [rec.label, rec]));
      let hit = false;
      emptyFields.forEach((field) => {
        const values = Array.isArray(byLabel[field.label]) ? byLabel[field.label] : [];
        const candidates = retrieverValueCandidates(field.label, item, values);
        if (!candidates.length) return;
        hit = true;
        const existing = recordByLabel.get(field.label);
        if (existing) {
          existing.candidates = candidates;
          existing.candidateSource = "retriever";
        } else {
          const rec = {
            label: field.label,
            id: field.id,
            kind: field.kind,
            impact: field.impact,
            reason: field.reason,
            required: field.required,
            candidates,
            candidateSource: "retriever",
          };
          records.push(rec);
          recordByLabel.set(field.label, rec);
        }
      });
      if (hit) item.manualInputs = { ...(item.manualInputs || {}), fields: records };
    }
    renderEditCalculationReview();
    return true;
  }

  function closeManualInputPanel() {
    const panel = $("manualInputPanel");
    if (panel) panel.hidden = true;
  }

  function impactLabel(value) {
    if (value === "high") return "결과값 영향 큼";
    if (value === "medium") return "해석 영향";
    return "참고";
  }

  function candidateOptionLabel(candidate) {
    const label = String(candidate?.label || "").trim();
    const value = candidate?.value != null ? String(candidate.value).trim() : "";
    const unit = String(candidate?.unit || "").trim();
    const basis = label || [value, unit].filter(Boolean).join(" ");
    const confidence = candidate?.confidence ? ` · ${candidate.confidence}` : "";
    return `${basis || "후보값"}${confidence}`;
  }

  function manualInputModeHtml(field) {
    const selection = String(field.selection || "");
    const mode = selection.startsWith("candidate:") ? "candidate" : selection;
    const defaultCandidate = !mode || mode === "candidate";
    return `<select data-manual-mode aria-label="${attr(field.label)} 입력 방식">
      <option value="candidate" ${defaultCandidate ? "selected" : ""}>후보 선택</option>
      <option value="custom" ${mode === "custom" ? "selected" : ""}>직접 입력</option>
      <option value="unknown" ${mode === "unknown" ? "selected" : ""}>모름/확인 필요</option>
      <option value="excluded" ${mode === "excluded" || field.status === "excluded" ? "selected" : ""}>이번 계산에서 제외</option>
    </select>`;
  }

  function manualCandidateValueSelectHtml(field) {
    const current = String(field.selection || "").trim();
    const currentValue = String(field.value ?? "").trim();
    const options = (field.candidates || []).map((candidate, index) => {
      const value = `candidate:${index}`;
      const candidateValue = String(candidate?.value ?? "").trim();
      const selected = current === value || (!current && currentValue && currentValue === candidateValue);
      return `<option value="${attr(value)}" ${selected ? "selected" : ""}>${esc(candidateOptionLabel(candidate))}</option>`;
    }).join("");
    return `<select data-manual-select aria-label="${attr(field.label)} 후보값">
      <option value="">후보값을 고르세요 (${(field.candidates || []).length}개)</option>
      ${options}
    </select>`;
  }

  function applyManualInputMode(select, preserveVerification = false) {
    const row = select.closest("[data-human-field]");
    if (!row) return;
    const candidateRow = row.querySelector(".manual-candidate-row");
    const valueRow = row.querySelector(".manual-value-row");
    const candidateSelect = row.querySelector("[data-manual-select]");
    const input = row.querySelector("[data-manual-field]");
    const unitInput = row.querySelector("[data-manual-unit]");
    const verifyRow = row.querySelector(".manual-verify-row");
    const verifyInput = row.querySelector("[data-human-verified]");
    const mode = select.value || "custom";
    if (candidateRow) candidateRow.hidden = mode !== "candidate";
    if (valueRow) valueRow.hidden = mode !== "custom";
    if (verifyRow) verifyRow.hidden = mode !== "candidate" || !candidateSelect?.value;
    if (mode === "candidate") {
      if (candidateSelect?.value) applyManualCandidateSelection(candidateSelect, preserveVerification);
      return;
    }
    if (mode === "custom") {
      input?.focus();
      return;
    }
    if (candidateSelect) candidateSelect.value = "";
    if (input) input.value = "";
    if (unitInput) unitInput.value = "";
    if (verifyInput) verifyInput.checked = false;
  }

  function applyManualCandidateSelection(select, preserveVerification = false) {
    const row = select.closest("[data-human-field]");
    if (!row) return;
    const input = row.querySelector("[data-manual-field]");
    const unitInput = row.querySelector("[data-manual-unit]");
    const verifyRow = row.querySelector(".manual-verify-row");
    const verifyInput = row.querySelector("[data-human-verified]");
    let candidates = [];
    try { candidates = JSON.parse(row.dataset.humanCandidates || "[]"); } catch { candidates = []; }
    const value = select.value || "";
    if (verifyRow) verifyRow.hidden = !value.startsWith("candidate:");
    if (!preserveVerification && verifyInput) verifyInput.checked = false;
    if (value.startsWith("candidate:")) {
      const candidate = candidates[Number(value.split(":")[1])] || {};
      if (input) input.value = candidate.value != null ? String(candidate.value) : "";
      if (unitInput) unitInput.value = candidate.unit || (row.dataset.humanKind === "unit" ? String(candidate.value || "") : "");
      return;
    }
  }

  function saveManualInputPanel() {
    const panel = $("manualInputPanel");
    const index = Number(panel?.dataset.resultIndex);
    const item = planExecutionResults[index];
    if (!panel || !item) return;
    const fields = Array.from(panel.querySelectorAll("[data-human-field]")).map((row) => {
      const input = row.querySelector("[data-manual-field]");
      const unitInput = row.querySelector("[data-manual-unit]");
      const select = row.querySelector("[data-manual-select]");
      const modeSelect = row.querySelector("[data-manual-mode]");
      const verifiedInput = row.querySelector("[data-human-verified]");
      let candidates = [];
      try { candidates = JSON.parse(row.dataset.humanCandidates || "[]"); } catch { candidates = []; }
      const mode = modeSelect?.value || "custom";
      const selection = mode === "candidate" ? (select?.value || "") : mode;
      const candidateIndex = selection.startsWith("candidate:") ? Number(selection.split(":")[1]) : -1;
      const candidate = Number.isFinite(candidateIndex) && candidateIndex >= 0 ? candidates[candidateIndex] : null;
      const value = String(input?.value ?? "").trim();
      const unit = String(unitInput?.value || candidate?.unit || "").trim();
      const humanVerified = verifiedInput?.checked === true;
      let source = "user";
      let status = value ? "custom" : "pending";
      if (selection === "unknown" || selection === "excluded") {
        status = selection;
        source = "user";
      } else if (candidate) {
        const candidateValue = String(candidate.value ?? "").trim();
        status = value && value !== candidateValue ? "custom" : (humanVerified ? "confirmed" : "selected_candidate");
        source = status === "custom" ? "candidate+edited" : "candidate";
      } else if (selection === "custom" || value) {
        status = "custom";
        source = "custom";
      }
      return {
        id: row.dataset.humanField,
        label: row.dataset.humanLabel,
        kind: row.dataset.humanKind || "text",
        impact: row.dataset.humanImpact || "medium",
        required: row.dataset.humanRequired !== "false",
        reason: row.dataset.humanReason || "",
        type: "human_input",
        value,
        unit,
        selection,
        source,
        status,
        human_verified: source === "candidate" ? humanVerified : status === "custom",
        candidate_confidence: candidate?.confidence || "",
        candidate: candidate || null,
        candidates,
      };
    });
    item.manualInputs = {
      fields,
      confirmed_inputs: fields.filter((field) => isHumanFieldResolved(field) && String(field.value ?? "").trim()),
      memo: panel.querySelector("[data-manual-memo]")?.value.trim() || "",
      updated_at: new Date().toISOString(),
    };
    reportStorageState = "idle";
    reportStorageError = "";
    closeManualInputPanel();
    renderEditCalculationReview();
    runBuildResultStep({ quiet: true });
    status("✅ 담당자 입력값을 계산 확인표와 결과 리포트에 반영했습니다.");
  }

  function showEvidencePopover(button) {
    const text = button.dataset.evidenceText || button.getAttribute("title") || button.dataset.evidenceRefs || "";
    if (!String(text).trim()) return;
    if (!activeEvidencePopover) {
      activeEvidencePopover = document.createElement("div");
      activeEvidencePopover.className = "evidence-popover";
      document.body.appendChild(activeEvidencePopover);
    }
    activeEvidencePopover.innerHTML = evidencePopoverHtml(button);
    const rect = button.getBoundingClientRect();
    const maxLeft = Math.max(12, window.innerWidth - 388);
    activeEvidencePopover.style.left = `${Math.min(maxLeft, Math.max(12, rect.left))}px`;
    activeEvidencePopover.style.top = `${rect.bottom + window.scrollY + 8}px`;
    activeEvidencePopover.hidden = false;
  }

  function hideEvidencePopover() {
    if (activeEvidencePopover) activeEvidencePopover.hidden = true;
  }

  function planExecutionHtml() {
    if (!planExecutionResults.length) return "";
    const costItems = planExecutionResults.filter((item) => resultKindForItem(item) === "calculation");
    const reviewItems = planExecutionResults.filter((item) => item.group === "review");
    const checkItems = planExecutionResults.filter((item) => item.group === "checklist" || reviewNeedsAttention(item));
    const needCount = planExecutionResults.filter(reviewNeedsAttention).length;

    const costRows = costItems.map((item) => {
      const total = effectivePlanTotal(item);
      const amount = total != null ? fmtCurrency(total) : '<span class="danger">미산정</span>';
      const manualSummary = manualInputSummary(item);
      const serverSample = item.serverEvidence?.length
        ? item.serverEvidence.slice(0, 3).map((chunk) => `${evidenceChunkLabel(chunk)}: ${chunk.excerpt || ""}`.trim()).join("\n")
        : "";
      const sample = serverSample || (item.rows.length
        ? item.rows.slice(0, 3).map((row) => `${rowMeaning(row)} (${fmtWon(row.value)}) · ${sourceCellAddress(row)} · ${row.file || ""}`).join("\n")
        : "계산할 원본 수치가 명확하지 않습니다.");
      const rowTitle = `대표 근거\n${sample}`;
      return `<tr class="evidence-tooltip-row" title="${attr(rowTitle)}"><td><strong>${esc(item.title)}</strong>${item.detail ? `<br><span class="src">${esc(item.detail)}</span>` : ""}</td>` +
        `<td><strong class="ai-formula-text">${esc(item.formula)}</strong><br><span class="src">필요 입력: ${esc(item.needs.join(", "))}</span>${manualSummary ? `<br><span class="src">담당자 입력: ${esc(manualSummary)}</span>` : ""}</td>` +
        `<td class="num">${amount}<br><span class="src">${esc(effectiveReviewStatus(item))}</span></td>` +
        `</tr>`;
    });

    const reviewRows = reviewItems.map((item) => {
      const serverEvidence = item.serverEvidence?.length
        ? item.serverEvidence.slice(0, 3).map((chunk) => `${esc(evidenceChunkLabel(chunk))}<br><span class="src">${esc(chunk.excerpt || "")}</span>`).join("<br>")
        : "";
      const evidence = serverEvidence || (item.evidence.length
        ? item.evidence.map((ev) => `${esc(ev.text)}<br><span class="src">${esc(sourceOf(ev))}</span>`).join("<br>")
        : `<span class="src">${esc(item.detail || "관련 법령/출처 원문 확인 필요")}</span>`);
      return `<tr><td><strong>${esc(item.title)}</strong>${item.detail ? `<br><span class="src">${esc(item.detail)}</span>` : ""}</td>` +
        `<td>적용 조항과 의무 절차를 먼저 확정합니다.</td><td>${evidence}</td></tr>`;
    });

    const checklist = checkItems.map((item) => {
      const action = resultKindForItem(item) === "calculation"
        ? (manualInputSummary(item) || `입력값 확인 후 계산식 승인: ${item.needs.join(", ")}`)
        : (item.group === "review" ? "법령 원문과 적용 범위 확인" : "대상 범위와 자료 기준 확인");
      return `<li><strong>${esc(item.title)}</strong><br><span class="src">${esc(action)}</span></li>`;
    });

    const evidenceRows = planExecutionResults.flatMap((item) =>
      (item.serverEvidence || []).slice(0, 4).map((chunk) => `<tr class="evidence-tooltip-row" title="${attr(`발췌\n${chunk.excerpt || "발췌 내용 없음"}`)}">
        <td>${esc(item.title)}</td>
        <td>${esc(evidenceChunkLabel(chunk))}</td>
        <td><span class="evidence-status-chip ${item.evidenceStatus === "missing_evidence" ? "need" : "ok"}">${esc(evidenceStatusLabel(item.evidenceStatus))}</span>${item.reviewFlags?.length ? `<br><span class="src">${esc(item.reviewFlags.join(", "))}</span>` : ""}</td>
      </tr>`)
    );

    const headline = headlineCalculationHtml({ interactive: false });
    const resultCards = planResultContractsHtml({ interactive: false });
    const parts = [headline, resultCards, `<div class="board-kpis">
      <div class="kpi"><div class="kpi-v">${fmtWon(costItems.length)}</div><div class="kpi-l">비용 계산 플랜</div></div>
      <div class="kpi"><div class="kpi-v">${fmtWon(needCount)}</div><div class="kpi-l">담당자 확인</div></div>
    </div>`];
    if (checklist.length) parts.push(`<h3>다음에 사람이 해야 할 체크리스트</h3><ul>${checklist.join("")}</ul>`);
    if (costRows.length) parts.push(`<h3>비용계산</h3>${tableFromRows(["플랜", "AI 추정 계산식", "결과"], costRows, "plan-cost-table")}`);
    if (reviewRows.length) parts.push(`<h3>법규 검토</h3>${tableFromRows(["플랜", "검토 방향", "근거"], reviewRows)}`);
    if (evidenceRows.length) parts.push(`<h3>근거 자료 목록</h3>${tableFromRows(["플랜", "근거 자료", "상태"], evidenceRows, "evidence-source-table")}`);
    return parts.join("");
  }

  function planExecutionSummaryHtml() {
    if (!planExecutionResults.length) return "";
    const costItems = planExecutionResults.filter((item) => resultKindForItem(item) === "calculation");
    const needCount = planExecutionResults.filter(reviewNeedsAttention).length;
    return [
      headlineCalculationHtml({ interactive: false }),
      planResultContractsHtml({ interactive: false }),
      `<div class="board-kpis">
        <div class="kpi"><div class="kpi-v">${fmtWon(costItems.length)}</div><div class="kpi-l">비용 계산 플랜</div></div>
        <div class="kpi"><div class="kpi-v">${fmtWon(needCount)}</div><div class="kpi-l">담당자 확인</div></div>
        <div class="kpi"><div class="kpi-v">${fmtWon(detectedWorkbookStructures.length)}</div><div class="kpi-l">감지된 엑셀 구조</div></div>
        <div class="kpi"><div class="kpi-v">${fmtWon(costAll.length)}</div><div class="kpi-l">추출된 숫자 셀</div></div>
      </div>`,
    ].filter(Boolean).join("");
  }

  function sourceInventoryHtml() {
    const fileRows = analysisFiles.slice(0, 12).map((file) => {
      const state = file.uploaded
        ? (file.textAvailable ? "등록됨" : "등록됨 · 텍스트 확인 필요")
        : "등록 대기";
      return `<tr><td>${esc(file.name)}</td><td>${esc(state)}</td><td>${esc(friendlyFileType(file))}</td></tr>`;
    });
    const structureRows = detectedWorkbookStructures.slice(0, 10).map((item) =>
      `<tr><td>${esc(item.label)}</td><td>${esc(item.file)}<br><span class="src">${esc(item.sheet)}</span></td><td>${esc(item.summary)}</td></tr>`
    );
    const roleRows = costAll.filter((row) => row.sourceRole).slice(0, 10).map((row) =>
      `<tr><td>${esc(row.sourceRole)}</td><td>${esc(row.sourceDetail || row.label)}</td><td class="num">${fmtWon(row.value)}</td><td class="src">${esc(sourceCellAddress(row))}</td></tr>`
    );
    const parts = [];
    if (fileRows.length) parts.push(`<h3>등록 자료</h3>${tableFromRows(["파일", "상태", "형식"], fileRows, "source-inventory-table")}`);
    if (structureRows.length) parts.push(`<h3>감지된 엑셀 구조</h3>${tableFromRows(["구조", "파일·시트", "요약"], structureRows, "source-inventory-table")}`);
    if (roleRows.length) parts.push(`<h3>구조화된 수치 역할</h3>${tableFromRows(["역할", "항목", "값", "셀"], roleRows, "source-inventory-table")}`);
    return parts.length ? `<div class="source-inventory">${parts.join("")}</div>` : "";
  }

  function updateResultViewButtons() {
    document.querySelectorAll("[data-result-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.resultView === resultViewMode);
    });
  }

  function buildResult() {
    const summaries = Array.from(document.querySelectorAll("#summaryList .summary-item")).map((it) => {
      const name = it.querySelector(".si-name")?.textContent || "";
      const txt = it.querySelector(".si-text")?.textContent || "";
      return `<li><strong>${esc(name)}</strong> — ${esc(txt)}</li>`;
    });
    const summaryHtml = summaries.length ? `<ul>${summaries.join("")}</ul>` : "";

    const ideas = analysisQuestions.map((item, qi) => {
      const qid = item.id || `q${qi + 1}`;
      const sel = document.querySelector(`input[name="idea-${CSS.escape(qid)}"]:checked`);
      return sel ? `<li><strong>Q${qi + 1}. ${esc(item.question)}</strong><br>→ ${esc(sel.value)}</li>` : null;
    }).filter(Boolean);
    const ideaHtml = ideas.length ? `<ul>${ideas.join("")}</ul>` : "";

    const plans = Array.from(document.querySelectorAll(".plan-chk:checked")).map((c) => {
      const detail = c.dataset.detail ? `<br><span class="hint">${esc(c.dataset.detail)}</span>` : "";
      return `<li>${esc(c.value)}${detail}</li>`;
    });
    const planHtml = plans.length ? `<ul>${plans.join("")}</ul>` : "";
    const boardContent = document.querySelector("#boardArea .board-print")?.innerHTML || "";
    const heuristicHtml = lastHeuristic ? heuristicBody(lastHeuristic, false) : "";
    const deepContent = document.querySelector("#deepReportArea .print-area")?.innerHTML || "";
    const evidenceContent = document.querySelector("#evidenceArea .print-area")?.innerHTML || "";
    const validationHtml = validationSummary?.length
      ? `<ul>${validationSummary.map((item) => `<li><strong>${esc(item.verdict)}</strong> — ${esc(item.title)} (${esc(item.value)})${item.note ? `<br><span class="hint">${esc(item.note)}</span>` : ""}</li>`).join("")}</ul>`
      : "";

    const etcUrl = getEtcUrlValue(), etcNote = combinedAnalysisNote();
    const scope = [
      controlValue(projectName) ? `<li>GitHub 프로젝트: ${esc(controlValue(projectName))}</li>` : "",
      (controlValue(analysisTopic) || subject.value).trim() ? `<li>작업공간: ${esc((controlValue(analysisTopic) || subject.value).trim())}</li>` : "",
      outputGoal.value.trim() ? `<li>기대 산출물: ${esc(outputGoal.value.trim())}</li>` : "",
      decisionCriteria.value.trim() ? `<li>의사결정 기준: ${esc(decisionCriteria.value.trim())}</li>` : "",
    ].filter(Boolean).join("");
    const scopeHtml = scope ? `<ul>${scope}</ul>` : "";
    const etcHtml = (etcUrl || etcNote)
      ? `<ul>${etcUrl ? `<li>URL: ${esc(etcUrl)}</li>` : ""}${etcNote ? `<li>${esc(etcNote).replace(/\n/g, "<br>")}</li>` : ""}</ul>`
      : "";

    const title = reportTitleText();
    const sections = [];
    const addSection = (name, html) => {
      if (String(html || "").trim()) sections.push({ name, html });
    };
    const sourceInventory = sourceInventoryHtml();
    if (resultViewMode === "summary") {
      addSection("AI 검토 작업 결과", planExecutionSummaryHtml());
      addSection("프로젝트 범위", scopeHtml);
      addSection("자료·구조 인벤토리", sourceInventory);
      addSection("검토 요약", validationHtml);
      addSection("빠른 확인 질문 답변", ideaHtml);
      addSection("선택한 AI 검토 작업", planHtml);
    } else {
      addSection("AI 검토 작업 결과", planExecutionHtml());
      addSection("프로젝트 범위", scopeHtml);
      addSection("자료·구조 인벤토리", sourceInventory);
      addSection("자료 요약", summaryHtml);
      addSection("간단 요약", boardContent);
      addSection("계산식 만들기", heuristicHtml);
      addSection("상세 보고서", deepContent);
      addSection("법령·근거 매핑", evidenceContent);
      addSection("검토 요약", validationHtml);
      addSection("보충 입력", etcHtml);
      addSection("빠른 확인 질문 답변", ideaHtml);
      addSection("서버에 보관한 보고서", executionArtifactsHtml());
      addSection("선택한 AI 검토 작업", planHtml);
    }
    const body = sections.length
      ? sections.map((section, i) => `<h2>${i + 1}. ${section.name}</h2>${section.html}`).join("")
      : '<p class="hint">아직 결과에 반영된 항목이 없습니다.</p>';
    const printArea = $("printArea");
    printArea.classList.toggle("result-view-summary", resultViewMode === "summary");
    printArea.classList.toggle("result-view-deep", resultViewMode === "deep");
    printArea.innerHTML =
      `<div class="mp-h1">${esc(title)}</div>` +
      body;
    updateResultViewButtons();
    $("btnPrint").disabled = false;
    $("btnExportReportCsv")?.removeAttribute("disabled");
  }
  function runBuildResultStep(options = {}) {
    buildResult();
    if (reportStorageState === "stored") {
      markStepDone(9);
    } else {
      $("card-9")?.classList.remove("done");
      setFlowDone(9, false);
    }
    if (!options.quiet) status("🧾 결과 리포트 초안을 정리했습니다. 검토가 끝나면 서버에 검토 기록을 보관하세요.");
  }
  $("btnBuildResult").addEventListener("click", () => runBuildResultStep());
  document.querySelectorAll("[data-result-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      resultViewMode = btn.dataset.resultView === "deep" ? "deep" : "summary";
      updateResultViewButtons();
      if ($("printArea")?.querySelector(".mp-h1")) buildResult();
    });
  });
  updateResultViewButtons();
  $("btnPrint").addEventListener("click", () => {
    const originalTitle = document.title;
    document.title = reportDownloadName("pdf").replace(/\.pdf$/i, "");
    window.print();
    setTimeout(() => { document.title = originalTitle; }, 1200);
  });
  $("btnSaveExecution")?.addEventListener("click", async () => {
    if (!planExecutionResults.length && selectedPlanControls().length) {
      planExecutionResults = calculateSelectedPlanResults();
      reportStorageState = "idle";
      reportStorageError = "";
    }
    runBuildResultStep({ quiet: true });
    if (!requireExecutionHumanInputs() || !requireReportReadyForStorage()) return;
    const btn = $("btnSaveExecution");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "저장 중...";
    setEditStepState("report", "running");
    try {
      await runExecutionArtifactStep();
      runBuildResultStep({ quiet: true });
      setEditStepState("report", "done");
      openCard(9, true);
    } catch (err) {
      setEditStepState("report", "failed");
      status("❌ 서버 검토 기록 보관 실패: " + err.message, true);
    } finally {
      btn.textContent = original;
      renderEditCalculationReview();
    }
  });

  /* ---------- 6-A. 표·수치 정규화 & 근거 매핑 (클라이언트 xlsx 파싱) ---------- */
  // 단가는 특정 도메인 매직넘버가 아니라 데이터에서 추정한다(detectUnitPrice 참고).
  let costAll = []; // 모든 숫자 셀 { label, rowHeader, columnHeader, category, value, file, sheet, cell }
  let evidenceAll = []; // 법령/지침/품셈/단가표 등 문자 근거 후보 { type, text, file, sheet, cell }
  let evidenceLinks = [];
  let detectedWorkbookStructures = [];
  const workbookCache = new Map();
  const cellOriginalValues = new Map();
  const cellOverrides = new Map();
  let costHeadlineMode = "field_once";
  let lastHeuristic = null;
  let lastHeuristicHtml = "";
  let lastDeepReportHtml = "";
  let validationItems = [];
  let validationSummary = null;
  const costDrop = $("costDrop"), costFileInput = $("costFileInput");
  const costTableWrap = $("costTableWrap"), costCount = $("costCount"), costMinValue = $("costMinValue");
  const unitCostEngine = $("unitCostEngine");
  const UNIT_COST_STORE = "planningHarness.unitCostProfiles.v2";
  const DEFAULT_UNIT_PROFILES = [
    { id: "generic", label: "범용 단위원가", quantity: "수량 개수 건 지점 횟수", rate: "단가 금액 원가 비용", add: "부대비 경비 간접비", quantityFallback: 1, rateFallback: 0, addFallback: 0 },
    { id: "labor", label: "인력·노무", quantity: "인원 인일 공수 시간 일수", rate: "노임 인건비 시급 일단가", add: "여비 교통 장비 경비", quantityFallback: 1, rateFallback: 0, addFallback: 0 },
    { id: "survey", label: "조사·점검", quantity: "지점 개소 항목 횟수 빈도", rate: "조사 단가 점검 단가 비용", add: "출장 장비 운영 유지", quantityFallback: 1, rateFallback: 0, addFallback: 0 },
  ];
  let unitProfiles = loadUnitProfiles();
  let activeUnitProfileId = unitProfiles[0]?.id || "generic";
  let unitMappings = { quantity: "", rate: "", add: "" };

  function loadUnitProfiles() {
    try {
      const saved = JSON.parse(localStorage.getItem(UNIT_COST_STORE) || "null");
      return Array.isArray(saved?.profiles) && saved.profiles.length ? saved.profiles : DEFAULT_UNIT_PROFILES.map((item) => ({ ...item }));
    } catch { return DEFAULT_UNIT_PROFILES.map((item) => ({ ...item })); }
  }

  function saveUnitProfiles() {
    localStorage.setItem(UNIT_COST_STORE, JSON.stringify({ profiles: unitProfiles, active: activeUnitProfileId }));
  }

  function unitRowId(row) { return [row.file, row.sheet, row.cell].join("::"); }
  function unitCandidates() {
    return costAll.filter((row) => Number.isFinite(row.value)).slice(0, 500);
  }
  function activeUnitProfile() {
    return unitProfiles.find((item) => item.id === activeUnitProfileId) || unitProfiles[0] || DEFAULT_UNIT_PROFILES[0];
  }
  function mappingScore(row, keywords) {
    const hay = `${row.label || ""} ${row.rowHeader || ""} ${row.columnHeader || ""} ${row.sourceRole || ""}`.toLowerCase();
    return String(keywords || "").toLowerCase().split(/\s+/).filter(Boolean).reduce((sum, key) => sum + (hay.includes(key) ? key.length : 0), 0);
  }
  function autoMapUnitFields(force = false) {
    const profile = activeUnitProfile();
    const candidates = unitCandidates();
    for (const role of ["quantity", "rate", "add"]) {
      if (!force && unitMappings[role] && candidates.some((row) => unitRowId(row) === unitMappings[role])) continue;
      const best = candidates.map((row) => ({ row, score: mappingScore(row, profile[role]) })).sort((a, b) => b.score - a.score)[0];
      unitMappings[role] = best?.score > 0 ? unitRowId(best.row) : "";
    }
  }
  function mappedUnitValue(role) {
    const row = unitCandidates().find((item) => unitRowId(item) === unitMappings[role]);
    const fallback = Number(activeUnitProfile()[`${role}Fallback`]) || 0;
    return { row, value: row ? Number(row.value) : fallback, source: row ? `${row.file} · ${row.sheet}!${row.cell}` : "프로파일 기본값" };
  }
  function unitCandidateOptions(selected) {
    return `<option value="">프로파일 기본값</option>` + unitCandidates().map((row) => {
      const id = unitRowId(row);
      return `<option value="${attr(id)}"${id === selected ? " selected" : ""}>${esc(row.label)} · ${fmtWon(row.value)} · ${esc(row.sheet)}!${esc(row.cell)}</option>`;
    }).join("");
  }
  function renderUnitCostEngine() {
    if (!unitCostEngine) return;
    autoMapUnitFields(false);
    const profile = activeUnitProfile();
    const quantity = mappedUnitValue("quantity");
    const rate = mappedUnitValue("rate");
    const add = mappedUnitValue("add");
    const total = quantity.value * rate.value + add.value;
    unitCostEngine.hidden = false;
    unitCostEngine.innerHTML = `
      <div class="unit-cost-head"><div><strong>범용 단위원가 산정 엔진</strong><p class="hint">엑셀의 수량·단가·부대비 열을 자동 매핑하며 사용자가 직접 바꿀 수 있습니다.</p></div>
        <select data-unit-profile>${unitProfiles.map((item) => `<option value="${attr(item.id)}"${item.id === profile.id ? " selected" : ""}>${esc(item.label)}</option>`).join("")}</select>
        <button class="btn btn-ghost btn-small" type="button" data-unit-action="auto">자동 매핑</button></div>
      <div class="unit-cost-grid">
        <label>수량<select data-unit-map="quantity">${unitCandidateOptions(unitMappings.quantity)}</select></label>
        <label>단가<select data-unit-map="rate">${unitCandidateOptions(unitMappings.rate)}</select></label>
        <label>부대비<select data-unit-map="add">${unitCandidateOptions(unitMappings.add)}</select></label>
      </div>
      <div class="unit-cost-formula"><span>${fmtWon(quantity.value)} × ${fmtWon(rate.value)} + ${fmtWon(add.value)}</span><strong>${fmtWon(total)}</strong></div>
      <div class="unit-cost-sources"><span>수량: ${esc(quantity.source)}</span><span>단가: ${esc(rate.source)}</span><span>부대비: ${esc(add.source)}</span></div>`;
  }

  unitCostEngine?.addEventListener("change", (event) => {
    const profileSelect = event.target.closest("[data-unit-profile]");
    const mapping = event.target.closest("[data-unit-map]");
    if (profileSelect) { activeUnitProfileId = profileSelect.value; unitMappings = { quantity: "", rate: "", add: "" }; }
    if (mapping) unitMappings[mapping.dataset.unitMap] = mapping.value;
    saveUnitProfiles();
    renderUnitCostEngine();
  });
  unitCostEngine?.addEventListener("click", (event) => {
    if (!event.target.closest('[data-unit-action="auto"]')) return;
    autoMapUnitFields(true);
    renderUnitCostEngine();
  });
  const cellKey = (file, sheet, cell) => [file || "", sheet || "", cell || ""].join("::");
  const rowCellKey = (row) => cellKey(row?.file, row?.sheet, row?.cell);
  function rememberWorkbook(fileName, wb, meta = {}) {
    if (!fileName || !wb) return;
    workbookCache.set(fileName, { wb, fileName, ...meta });
  }
  function worksheetDisplayValue(cell) {
    return cell ? String(cell.w ?? cell.v ?? "") : "";
  }
  function rememberOriginalCell(file, sheet, addr, cell) {
    const key = cellKey(file, sheet, addr);
    if (!cellOriginalValues.has(key)) {
      cellOriginalValues.set(key, {
        t: cell?.t || "z",
        v: cell?.v,
        w: cell?.w,
        f: cell?.f,
        display: worksheetDisplayValue(cell),
      });
    }
  }
  function cellSourceHint(row) {
    const cell = row?.cell || "셀";
    return `${cell}은 원본 엑셀의 셀 주소입니다. 항목명은 같은 행의 왼쪽 텍스트와 같은 열의 위쪽 제목을 조합해 표시합니다.`;
  }
  function rowMeaning(row) {
    const label = String(row?.label || "").trim();
    if (label && label !== "(라벨 없음)") return `${row?.category || "수치"} · ${label}`;
    return `${row?.category || "수치"} · 항목명 확인 필요`;
  }
  function itemSourceLine(row) {
    return `해당 항목: ${rowMeaning(row)} · 원본 위치: ${sourceOf(row)}`;
  }
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
    detectedWorkbookStructures = detectedWorkbookStructures.filter((item) => item.fileKey !== key);
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

  function fullHtml(title, body, note) {
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${esc(title)}</title>` +
      `<style>body{font-family:-apple-system,"Malgun Gothic",sans-serif;margin:32px;color:#202939;line-height:1.55}` +
      `h1{font-size:26px}h2{color:#172033;margin:22px 0 8px}table{width:100%;border-collapse:collapse;font-size:14px}` +
      `th,td{border-bottom:1px solid #d8dee8;padding:8px 10px;text-align:left;vertical-align:top}th{background:#f9fafb;color:#172033}` +
      `.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}.src{color:#667085;font-size:12px}` +
      `.kpis{display:flex;gap:12px;flex-wrap:wrap}.kpi{border:1px solid #d8dee8;border-radius:8px;padding:12px 16px;min-width:130px}` +
      `.kpi-v{font-size:20px;font-weight:800;color:#172033}.warn{color:#c0392b}.muted{color:#667085}</style></head><body>` +
      `<h1>${esc(title)}</h1>${body}<p class="muted">${esc(note || "기획 하네스 루프 · 모든 자동 산출물은 원본 셀 출처와 함께 검증해야 합니다.")}</p></body></html>`;
  }

  function printHtmlReport(html, title) {
    if (!html) return;
    const frame = document.createElement("iframe");
    frame.title = title || "PDF report";
    frame.style.position = "fixed";
    frame.style.right = "100vw";
    frame.style.bottom = "100vh";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.border = "0";
    document.body.appendChild(frame);
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return;
      try { win.document.title = title || reportDownloadName("pdf").replace(/\.pdf$/i, ""); } catch { /* ignore cross-document title issues */ }
      win.focus();
      win.print();
      setTimeout(() => frame.remove(), 1200);
    };
    frame.srcdoc = html;
    status("PDF 저장 창을 열었습니다. 대상에서 PDF로 저장을 선택하세요.");
  }

  function sheetCellText(cell) {
    return String(cell?.w ?? cell?.v ?? "").replace(/\s+/g, " ").trim();
  }

  function labelCandidate(cell, options = {}) {
    const text = sheetCellText(cell);
    if (!text) return "";
    const numericOnly = /^[\d,.\-+()%\s]+$/.test(text);
    if (numericOnly) {
      if (!options.allowNumericHeader) return "";
      const compact = text.replace(/[,\s]/g, "");
      if (!/^(19|20)\d{2}$/.test(compact)) return "";
    }
    if (text.length > 80) return text.slice(0, 80);
    return text;
  }

  function nearestLabelParts(ws, r, c, range) {
    const rowLabels = [];
    for (let cc = c - 1; cc >= range.s.c; cc--) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: cc })];
      const text = labelCandidate(cell);
      if (text && !rowLabels.includes(text)) rowLabels.push(text);
      if (rowLabels.length >= 4) break;
    }
    const colHeaders = [];
    for (let rr = r - 1; rr >= range.s.r; rr--) {
      const cell = ws[XLSX.utils.encode_cell({ r: rr, c })];
      const text = labelCandidate(cell, { allowNumericHeader: true });
      if (text && !colHeaders.includes(text)) colHeaders.push(text);
      if (colHeaders.length >= 3) break;
    }
    const rowHeader = rowLabels.reverse().join(" / ");
    const columnHeader = colHeaders.reverse().join(" / ");
    const label = [rowHeader, columnHeader].filter(Boolean).join(" / ") || "(라벨 없음)";
    const confidence = rowHeader && columnHeader ? "상" : rowHeader || columnHeader ? "중" : "낮음";
    return { rowHeader, columnHeader, label, confidence };
  }

  function nearestLabel(ws, r, c, range) {
    return nearestLabelParts(ws, r, c, range).label;
  }

  function normalizeSheetHeader(value) {
    return String(value ?? "").replace(/\s+/g, "").trim();
  }

  function worksheetRows(ws, range) {
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        row[c] = sheetCellText(ws[XLSX.utils.encode_cell({ r, c })]);
      }
      rows[r] = row;
    }
    return rows;
  }

  function headerTextAt(rows, r, c) {
    return [rows[r - 2]?.[c], rows[r - 1]?.[c], rows[r]?.[c]]
      .map(normalizeSheetHeader)
      .filter(Boolean)
      .join("");
  }

  function findHeaderColumn(headers, patterns) {
    return headers.findIndex((text) => patterns.some((pattern) => pattern.test(text)));
  }

  function detectColumns(headers, map) {
    return Object.fromEntries(Object.entries(map).map(([key, patterns]) => [key, findHeaderColumn(headers, patterns)]));
  }

  function hasColumn(cols, key) {
    return Number.isInteger(cols[key]) && cols[key] >= 0;
  }

  function detectSheetStructure(fileName, sheet, rows, range) {
    const headerLimit = Math.min(range.e.r, range.s.r + 35);
    const statementMap = {
      section: [/^공종$/, /^구분$/, /분류/],
      itemName: [/품명/, /명칭/, /항목/, /내역/],
      spec: [/규격/, /사양/],
      unit: [/^단위$/],
      quantity: [/수량/, /물량/],
      materialUnitPrice: [/재료비.*단가/, /재료.*단가/],
      materialAmount: [/재료비.*금액/, /재료.*금액/],
      laborUnitPrice: [/노무비.*단가/, /노무.*단가/],
      laborAmount: [/노무비.*금액/, /노무.*금액/],
      expenseUnitPrice: [/경비.*단가/, /경비.*단가/],
      expenseAmount: [/경비.*금액/, /경비.*금액/],
      unitPrice: [/^단가$/, /적용단가/],
      amount: [/금액$/, /합계$/, /^계$/],
    };
    const priceMap = {
      itemName: [/품명/, /명칭/, /항목/, /내역/],
      spec: [/규격/, /사양/],
      unit: [/^단위$/],
      quantity: [/수량/, /물량/],
      baseUnitPrice: [/기준단가/, /예정단가/, /표준단가/, /조달단가/],
      appliedUnitPrice: [/적용단가/, /견적단가/, /계약단가/, /^단가$/],
      amount: [/금액$/, /합계$/, /^계$/],
    };
    let best = null;
    for (let r = range.s.r; r <= headerLimit; r++) {
      const headers = [];
      for (let c = range.s.c; c <= range.e.c; c++) headers[c] = headerTextAt(rows, r, c);
      const statementCols = detectColumns(headers, statementMap);
      const statementScore = [
        hasColumn(statementCols, "itemName"),
        hasColumn(statementCols, "quantity"),
        hasColumn(statementCols, "unitPrice") || hasColumn(statementCols, "materialUnitPrice") || hasColumn(statementCols, "laborUnitPrice"),
        hasColumn(statementCols, "amount") || hasColumn(statementCols, "materialAmount") || hasColumn(statementCols, "laborAmount") || hasColumn(statementCols, "expenseAmount"),
      ].filter(Boolean).length;
      const priceCols = detectColumns(headers, priceMap);
      const priceScore = [
        hasColumn(priceCols, "itemName"),
        hasColumn(priceCols, "appliedUnitPrice"),
        hasColumn(priceCols, "baseUnitPrice") || hasColumn(priceCols, "amount"),
        hasColumn(priceCols, "unit") || hasColumn(priceCols, "quantity"),
      ].filter(Boolean).length;
      const sheetHint = `${fileName} ${sheet}`;
      const statementHint = /내역|산출|공사|원가|견적/i.test(sheetHint) ? 1 : 0;
      const priceHint = /단가대비|단가비교|단가표|대비/i.test(sheetHint) ? 1 : 0;
      const candidates = [
        statementScore >= 3 ? { kind: "statement", label: "내역서", score: statementScore + statementHint, columns: statementCols, headerRow: r } : null,
        priceScore >= 3 ? { kind: "unit-comparison", label: "단가대비표", score: priceScore + priceHint, columns: priceCols, headerRow: r } : null,
      ].filter(Boolean);
      const next = candidates.sort((a, b) => b.score - a.score)[0];
      if (next && (!best || next.score > best.score)) best = next;
    }
    if (!best) return null;
    const dataRows = rows.slice(best.headerRow + 1).filter((row) => row?.some((value) => String(value || "").trim())).length;
    const roleCount = Object.values(best.columns).filter((value) => value >= 0).length;
    return {
      ...best,
      file: fileName,
      sheet,
      dataRows,
      roleCount,
      summary: `${best.label} 구조 감지 · 헤더 ${best.headerRow + 1}행 · 데이터 ${dataRows}행 · 역할 ${roleCount}개`,
    };
  }

  const structureRoleLabels = {
    section: "공종/구분",
    itemName: "품목명",
    spec: "규격",
    unit: "단위",
    quantity: "수량",
    materialUnitPrice: "재료비 단가",
    materialAmount: "재료비 금액",
    laborUnitPrice: "노무비 단가",
    laborAmount: "노무비 금액",
    expenseUnitPrice: "경비 단가",
    expenseAmount: "경비 금액",
    unitPrice: "단가",
    baseUnitPrice: "기준 단가",
    appliedUnitPrice: "적용 단가",
    amount: "금액/합계",
  };

  function structureFieldForCell(structure, c) {
    return Object.entries(structure?.columns || {}).find(([, col]) => col === c)?.[0] || "";
  }

  function structuredRowDetail(structure, rows, r) {
    const cols = structure?.columns || {};
    const row = rows[r] || [];
    return [
      hasColumn(cols, "section") ? row[cols.section] : "",
      hasColumn(cols, "itemName") ? row[cols.itemName] : "",
      hasColumn(cols, "spec") ? row[cols.spec] : "",
      hasColumn(cols, "unit") ? row[cols.unit] : "",
    ].map((value) => String(value || "").trim()).filter(Boolean).join(" / ");
  }

  function structuredCellInfo(structure, rows, r, c) {
    if (!structure || r <= structure.headerRow) return null;
    const field = structureFieldForCell(structure, c);
    if (!field || /^(section|itemName|spec|unit)$/.test(field)) return null;
    const role = structureRoleLabels[field] || field;
    const detail = structuredRowDetail(structure, rows, r);
    return {
      field,
      role,
      detail,
      structureKind: structure.kind,
      structureLabel: structure.label,
      label: [detail, role].filter(Boolean).join(" / ") || role,
    };
  }

  function detectedStructureSummaryHtml() {
    if (!detectedWorkbookStructures.length) return "";
    const items = detectedWorkbookStructures.slice(-8).map((item) =>
      `<li><strong>${esc(item.label)}</strong> <span>${esc(item.file)} · ${esc(item.sheet)}</span><br><span class="src">${esc(item.summary)}</span></li>`
    ).join("");
    return `<div class="detected-structure-summary"><strong>감지된 엑셀 구조</strong><ul>${items}</ul></div>`;
  }

  async function parseCostFile(file) {
    const fileKey = costFileKey(file);
    if (parsedCostFileKeys.has(fileKey)) return false;
    if (!window.XLSX) throw new Error("엑셀 파서 로드 실패(XLSX). 네트워크를 확인하세요.");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    rememberWorkbook(file.name, wb, { fileKey, source: "upload" });
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
      const rows = worksheetRows(ws, range);
      const structure = detectSheetStructure(file.name, sheet, rows, range);
      if (structure) {
        detectedWorkbookStructures.push({ ...structure, fileKey });
        addEvidence("엑셀 구조", structure.summary, sheet, `R${structure.headerRow + 1}`);
      }
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (!cell) continue;
          rememberOriginalCell(file.name, sheet, addr, cell);
          if (cell.t === "n" && typeof cell.v === "number" && isFinite(cell.v)) {
            const labelInfo = nearestLabelParts(ws, r, c, range);
            const structureInfo = structuredCellInfo(structure, rows, r, c);
            const label = structureInfo?.label || labelInfo.label;
            const basisText = `${label} ${structureInfo?.role || ""} ${file.name} ${sheet}`;
            costAll.push({
              label,
              rowHeader: structureInfo?.detail || labelInfo.rowHeader,
              columnHeader: structureInfo?.role || labelInfo.columnHeader,
              labelConfidence: structureInfo ? "구조화" : labelInfo.confidence,
              category: categoryFor(basisText),
              value: cell.v,
              originalValue: cell.v,
              file: file.name,
              sheet,
              cell: addr,
              fileKey,
              structureKind: structureInfo?.structureKind || "",
              structureLabel: structureInfo?.structureLabel || "",
              sourceRole: structureInfo?.role || "",
              sourceDetail: structureInfo?.detail || "",
            });
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

  function sourceRoleBadge(row) {
    if (!row?.sourceRole && !row?.structureLabel) return "";
    const label = [row.structureLabel, row.sourceRole].filter(Boolean).join(" · ");
    return `<span class="source-role-badge">${esc(label)}</span>`;
  }

  function renderCostTable() {
    const rows = filteredRows();
    const structureCount = detectedWorkbookStructures.length;
    costCount.textContent = `추출된 항목: ${rows.length} (전체 숫자셀 ${costAll.length}${structureCount ? ` · 구조 감지 ${structureCount}` : ""})`;
    const structureHtml = detectedStructureSummaryHtml();
    renderUnitCostEngine();
    if (!rows.length) { costTableWrap.innerHTML = `${structureHtml}<p class="hint">표시할 항목이 없습니다. 파일을 등록하거나 최소 절대값을 낮추세요.</p>`; return; }
    const head = "<tr><th>분류</th><th>셀 값의 뜻</th><th>값</th><th>좌표·출처</th></tr>";
    const body = rows.slice(0, 200).map((r) =>
      `<tr><td>${esc(r.category)}</td><td><strong>${esc(rowMeaning(r))}</strong>` +
      `${sourceRoleBadge(r)}` +
      `<br><span class="src">행: ${esc(r.rowHeader || "확인 필요")} · 열: ${esc(r.columnHeader || "확인 필요")} · 라벨 신뢰도 ${esc(r.labelConfidence || "낮음")}</span></td>` +
      `<td class="num">${fmtWon(r.value)}</td>` +
      `<td class="src" title="${attr(cellSourceHint(r))}">${esc(sourceCellAddress(r))}<br>${esc(r.file || "")}</td></tr>`).join("");
    const more = rows.length > 200 ? `<p class="hint">상위 200개만 표시 (총 ${rows.length}개).</p>` : "";
    costTableWrap.innerHTML = `${structureHtml}<table class="cost-table">${head}${body}</table>${more}`;
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

  /* ---------- 6-B. 간단 요약 (단가 산식 집계 + 인사이트) ---------- */
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
    const topRows = b.top.map((r) => {
      const hint = cellSourceHint(r);
      return `<li><strong>${esc(rowMeaning(r))}</strong> — ${fmtWon(r.value)}<br>` +
        `<span class="src" title="${attr(hint)}">${esc(itemSourceLine(r))}</span></li>`;
    }).join("");
    const insights = [];
    insights.push(`최대 값 항목은 <strong>${esc(b.top[0].label)}</strong> (${fmtWon(b.top[0].value)}) — 출처 ${esc(sourceOf(b.top[0]))}.`);
    if (b.multiples.length && b.unit) insights.push(`데이터에서 찾은 ${esc(b.unit.reason)} 후보 <strong>${fmtWon(b.unit.unit)}</strong>의 <strong>배수</strong>인 항목 ${b.multiples.length}개 → '단위 수 × 단가' 구조 후보 <span class="hint" style="display:inline">(추정·검증필요)</span>.`);
    insights.push(`상위 5개 항목이 합계의 ${Math.round(b.top.reduce((a, r) => a + r.value, 0) / b.sum * 100)}%를 차지.`);
    const insightHtml = `<ul>${insights.map((t) => `<li>${t}</li>`).join("")}</ul>`;
    return `<h2>상위 5개 항목</h2><ul class="board-top">${topRows}</ul><h2>인사이트</h2>${insightHtml}`;
  }

  function detectUnitMultiplier(rows, mode) {
    if (mode === "annual_total") {
      const text = rows.map((row) => `${row.label} ${row.rowHeader || ""} ${row.columnHeader || ""}`).join(" ");
      if (/월|monthly/i.test(text)) return 12;
      if (/분기|quarter/i.test(text)) return 4;
      return Math.max(1, Math.round(lastHeuristic?.unitCount || 1));
    }
    return 1;
  }

  function headlineUnitModeMeta(mode = costHeadlineMode) {
    const rows = positiveRows();
    if (planExecutionResults.length) return { mode: "selected_work", label: "선택 작업", multiplier: 1, selectable: false };
    const rowText = rows.map((row) => `${row.label || ""} ${row.rowHeader || ""} ${row.columnHeader || ""}`).join(" ");
    const selectable = /현장|관측소|지점|측점|조사|출장/i.test(rowText);
    if (!selectable) return { mode: "selected_work", label: "선택 작업", multiplier: 1, selectable: false };
    const multiplier = detectUnitMultiplier(rows, mode);
    if (mode === "station_once") return { mode, label: "관측소 1개소", multiplier, selectable: true };
    if (mode === "annual_total") return { mode, label: "연간 전체", multiplier, selectable: true };
    return { mode: "field_once", label: "현장 1회", multiplier: 1, selectable: true };
  }

  function metricRowCandidate(rows, pattern) {
    return rows.find((row) => pattern.test(`${row.category} ${row.label} ${row.rowHeader || ""} ${row.columnHeader || ""}`) && row.value > 0 && row.value <= 10000) || null;
  }

  function headlineCalculationModel(mode = costHeadlineMode) {
    const rows = positiveRows();
    const meta = headlineUnitModeMeta(mode);
    const costItems = planExecutionResults.filter((item) => resultKindForItem(item) === "calculation");
    const allowHeuristic = !planExecutionResults.length && resultPolicyReady;
    const heuristic = allowHeuristic ? (lastHeuristic || buildHeuristicModel()) : null;
    const costSummary = resultPolicyReady
      ? resultPolicy.summarizeCosts(costItems.map((item) => {
          const contract = resultContractForItem(item);
          return { kind: contract.kind, ready: contract.status === "ready", amount: effectivePlanTotal(item) };
        }))
      : null;
    const baseCost = costItems.length
      ? (costSummary?.total ?? null)
      : (allowHeuristic ? (heuristic?.unitCost ?? rows[0]?.value ?? null) : null);
    const peopleRow = meta.selectable ? metricRowCandidate(rows, /인원|인력|명|투입|공수|노무|인건/) : null;
    const hourRow = meta.selectable ? metricRowCandidate(rows, /시간|시급|8시간|근무|공수/) : null;
    const people = peopleRow ? peopleRow.value * meta.multiplier : null;
    const hours = hourRow ? hourRow.value * meta.multiplier : null;
    const cost = baseCost == null ? null : baseCost * meta.multiplier;
    const formulaRows = costItems.length ? costItems.slice(0, 8).map((item) => {
      const contract = resultContractForItem(item);
      const amount = contract.status === "ready" ? effectivePlanTotal(item) : null;
      const evidence = evidenceRefsForItem(item)[0] || null;
      return {
        title: item.title,
        unitCost: amount,
        total: amount == null ? null : amount * meta.multiplier,
        formula: amount == null
          ? "필수 입력·근거 확인 후 산정"
          : (meta.selectable ? `${meta.label} ${fmtWon(meta.multiplier)}단위 × ${fmtCurrency(amount)}원` : `확정 계산 결과 ${fmtCurrency(amount)}원`),
        ready: amount != null,
        evidence,
      };
    }) : [{
      title: allowHeuristic ? (heuristic?.driver || "대표 작업 단위") : "비용 계산 대상 없음",
      unitCost: heuristic?.unitCost ?? baseCost,
      total: cost,
      formula: baseCost == null ? "산정 가능한 금액 없음" : `${meta.label} ${fmtWon(meta.multiplier)}단위 × ${fmtCurrency(heuristic?.unitCost ?? baseCost)}원`,
      ready: baseCost != null,
      evidence: heuristic?.source ? { file_name: heuristic.source.file, sheet: heuristic.source.sheet, range: heuristic.source.cell } : null,
    }];
    return { meta, people, peopleRow, hours, hourRow, cost, formulaRows, costSummary, noCostTarget: !!planExecutionResults.length && !costItems.length };
  }

  function metricDisplay(value, unit) {
    return value == null ? "확인 필요" : `${fmtWon(value)}${unit}`;
  }

  function headlineCalculationHtml(options = {}) {
    const interactive = options.interactive !== false;
    const model = headlineCalculationModel(costHeadlineMode);
    if (model.noCostTarget) {
      return `<section class="headline-calc-panel"><div class="headline-calc-head"><div><span class="edit-eyebrow">핵심 결론</span><h3>비용 계산 대상 없음</h3></div></div><p class="hint">선택된 결과는 비용 계산 유형이 아니므로 금액 합계에 포함하지 않습니다.</p></section>`;
    }
    const select = interactive && model.meta.selectable ? `<label class="headline-unit-select">조사 단위
        <select data-headline-unit-mode>
          <option value="field_once"${costHeadlineMode === "field_once" ? " selected" : ""}>현장 1회</option>
          <option value="station_once"${costHeadlineMode === "station_once" ? " selected" : ""}>관측소 1개소</option>
          <option value="annual_total"${costHeadlineMode === "annual_total" ? " selected" : ""}>연간 전체</option>
        </select>
      </label>` : `<span class="headline-unit-static">${esc(model.meta.label)}</span>`;
    const evidenceText = (ref) => ref ? [ref.file_name, ref.sheet, ref.range].filter(Boolean).join(" · ") : "근거 확인 필요";
    const formulaRows = model.formulaRows.map((row) => `<tr title="${attr(`대표 근거\n${evidenceText(row.evidence)}`)}">
      <td>${esc(row.title)}</td>
      <td><strong class="ai-formula-text">${esc(row.formula)}</strong></td>
      <td class="num">${row.total == null ? '<span class="danger">미산정</span>' : `${fmtCurrency(row.total)}원`}</td>
    </tr>`).join("");
    const pendingCostCount = model.costSummary?.pendingCount || 0;
    const costLabel = model.cost == null
      ? "미산정"
      : `${fmtCurrency(model.cost)}원${pendingCostCount ? " (확정 부분합)" : ""}`;
    return `<section class="headline-calc-panel">
      <div class="headline-calc-head">
        <div><span class="edit-eyebrow">핵심 결론</span><h3>${esc(model.meta.label)} 기준 인원·시간·비용</h3></div>
        ${select}
      </div>
      <div class="headline-cards">
        <div><span>인원</span><strong>${esc(metricDisplay(model.people, "명"))}</strong><small>${esc(model.peopleRow ? sourceCellAddress(model.peopleRow) : "원문에서 후보를 찾지 못함")}</small></div>
        <div><span>시간</span><strong>${esc(metricDisplay(model.hours, "시간"))}</strong><small>${esc(model.hoursRow ? sourceCellAddress(model.hoursRow) : "원문에서 후보를 찾지 못함")}</small></div>
        <div><span>비용</span><strong>${esc(costLabel)}</strong><small>${pendingCostCount ? `미산정 ${fmtWon(pendingCostCount)}건 제외` : `${esc(model.meta.label)} ${fmtWon(model.meta.multiplier)}단위 기준`}</small></div>
      </div>
      <div class="headline-formula-table">
        <table><thead><tr><th>항목</th><th>단위×단가</th><th>결과</th></tr></thead><tbody>${formulaRows}</tbody></table>
      </div>
    </section>`;
  }
  function runBoardStep(options = {}) {
    const b = computeBoard();
    if (!b) { $("boardArea").innerHTML = '<p class="hint danger">6-A에서 표/수치 파일을 먼저 등록하세요.</p>'; return false; }
    const inner = boardHtml(b);
    $("boardArea").innerHTML = `<div class="print-area board-print">${inner}</div>`;
    lastBoardHtml =
      `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>간단 요약</title>` +
      `<style>body{font-family:-apple-system,"Malgun Gothic",sans-serif;margin:32px;color:#202939}` +
      `h2{color:#172033;margin:18px 0 6px}.board-kpis{display:flex;gap:12px;flex-wrap:wrap}` +
      `.kpi{border:1px solid #d8dee8;border-radius:8px;padding:12px 16px;min-width:120px}` +
      `.kpi-v{font-size:1.3rem;font-weight:800;color:#172033}.kpi-l{font-size:.8rem;color:#667085}` +
      `.src{color:#667085;font-size:.82rem}ul{padding-left:20px}</style></head><body>` +
      `<h1>간단 요약 — ${esc(dateEl.value || todayISO())}</h1>${inner}` +
      `<p style="color:#667085;font-size:.8rem;margin-top:24px">기획 하네스 루프 · 모든 수치는 원본 셀에서 추출(AI 생성 아님)</p></body></html>`;
    $("btnBoardHtml").disabled = false;
    $("btnBoardPdf").disabled = false;
    markStepDone("6b");
    if (!options.quiet) status("⚡ 간단 요약 생성 완료.");
    return true;
  }
  $("btnBoard").addEventListener("click", () => runBoardStep());
  $("btnBoardHtml").addEventListener("click", () => {
    printHtmlReport(lastBoardHtml, reportDownloadName("pdf", "간단 요약").replace(/\.pdf$/i, ""));
  });
  $("btnBoardPdf").addEventListener("click", () => {
    printHtmlReport(lastBoardHtml, reportDownloadName("pdf", "간단 요약").replace(/\.pdf$/i, ""));
  });

  /* ---------- 기존 분석설계 세션 복원 ---------- */
  function parseRestoredNote(note) {
    const rest = [];
    String(note || "").split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("분석 유형:")) {
        const id = templateIdFromText(trimmed.replace("분석 유형:", "").trim());
        if (id) applyAnalysisTemplate(id, { summaryOnly: true });
      }
      else if (trimmed.startsWith("필요 자료:") || trimmed.startsWith("검증 관점:")) {
        // Template metadata is restored from the selected template above.
      }
      else if (trimmed.startsWith("기대 산출물:")) outputGoal.value = trimmed.replace("기대 산출물:", "").trim();
      else if (trimmed.startsWith("의사결정 기준:")) decisionCriteria.value = trimmed.replace("의사결정 기준:", "").trim();
      else if (trimmed.startsWith("이번 분석의 중요 기준:")) setThoughtCriteriaFromText(trimmed.replace("이번 분석의 중요 기준:", "").trim());
      else if (trimmed.startsWith("보고서 우선 결과:")) setReportFocusFromText(trimmed.replace("보고서 우선 결과:", "").trim());
      else if (trimmed.startsWith("메모:")) rest.push(stripAutoPreferenceLines(trimmed.replace("메모:", "").trim()));
      else if (trimmed) rest.push(trimmed);
    });
    setEtcNoteValue(stripAutoPreferenceLines(rest.join("\n")), false, true);
  }

  async function restoreAnalysisSession(sessionId) {
    status("📂 분석설계 세션을 불러오는 중...");
    try {
      const res = await window.apiFetch(`/api/analysis/sessions/${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const s = data.session || {};
      analysisSessionId = sessionId;
      setFormControlValue(projectName, s.title || "");
      setFormControlValue(analysisTopic, s.subject || "");
      dateEl.value = s.date || dateEl.value || todayISO();
      setEtcUrlValue(s.etc_url || "", true);
      parseRestoredNote(s.etc_note || "");
      markdown.value = s.meeting_markdown || "";
      if (markdown.value) {
        $("card-4").hidden = false;
        fname.textContent = friendlyMeetingTitle({ title: s.subject || s.title, date: s.date || todayISO() });
        if (meetingResultPanel) meetingResultPanel.hidden = false;
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
      if (outputs.plan_runs?.content) {
        analysisPlanRuns = outputs.plan_runs.content;
        renderExecutionArtifacts();
      }
      if (outputs.executions?.content) {
        analysisExecution = outputs.executions.content;
        reportStorageState = "stored";
        reportStorageError = "";
        if (!analysisPlanRuns && outputs.executions.content.plan_runs) analysisPlanRuns = outputs.executions.content.plan_runs;
        renderExecutionArtifacts(analysisExecution);
        markStepDone(9);
      }
      void recoverAnalysisPipeline();
      status(`✅ 분석설계 세션을 복원했습니다: ${s.title || s.subject || "저장된 분석설계"}`);
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
      const g = map.get(key) || { key, count: 0, sum: 0, max: 0, top: null, rows: [] };
      g.count += 1;
      g.sum += r.value;
      g.rows.push(r);
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

  function confidenceFromScore(row, evidence, score) {
    if (!evidence) return "하";
    if (row.file === evidence.file && row.sheet === evidence.sheet) return "상";
    if (score >= 4) return "상";
    if (score >= 2) return "중";
    return "하";
  }

  function confidenceRank(value) {
    return value === "상" ? 0 : value === "중" ? 1 : 2;
  }

  function buildEvidenceLinks() {
    const rows = positiveRows(60);
    evidenceLinks = rows.map((row) => {
      const ranked = evidenceAll.map((ev) => ({ ev, score: scoreEvidence(row, ev) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      const bestMatch = ranked[0] || null;
      const best = bestMatch?.ev || null;
      const confidence = confidenceFromScore(row, best, bestMatch?.score || 0);
      return {
        row,
        evidence: best,
        confidence,
        status: best ? "근거 후보" : "근거 없음",
      };
    }).sort((a, b) => confidenceRank(a.confidence) - confidenceRank(b.confidence));
    return evidenceLinks;
  }

  function tableFromRows(headers, rows, className = "") {
    const cls = ["cost-table", className].filter(Boolean).join(" ");
    return `<table class="${attr(cls)}"><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${rows.join("")}</table>`;
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
    lastHeuristicHtml = fullHtml("단가 산식 추정", heuristicBody(model, false), "단순 산식은 검증 출발점입니다. 원본 근거(단가표·기준·규정 등) 확인 전 확정값으로 쓰지 마세요.");
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

  function runHeuristicStep(options = {}) {
    const model = buildHeuristicModel();
    if (!model) { $("heuristicArea").innerHTML = '<p class="hint danger">6-A에서 표/수치 파일을 먼저 등록하세요.</p>'; return false; }
    renderHeuristic(model);
    markStepDone("6c");
    if (!options.quiet) status("🧮 단가 산식 후보를 만들었습니다.");
    if (options.openNext !== false) openCard("6d");
    return true;
  }
  $("btnHeuristic").addEventListener("click", () => runHeuristicStep());
  $("btnHeuristicHtml").addEventListener("click", () => {
    printHtmlReport(lastHeuristicHtml, reportDownloadName("pdf", "계산식").replace(/\.pdf$/i, ""));
  });
  $("btnHeuristicPdf").addEventListener("click", () => {
    printHtmlReport(lastHeuristicHtml, reportDownloadName("pdf", "계산식").replace(/\.pdf$/i, ""));
  });

  function oneSentence(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    const match = clean.match(/^(.+?[.!?。！？]|.+?(?:다|요)\.)\s/);
    return (match ? match[1] : clean).slice(0, 180);
  }

  function fileSummarySentence(fileName, group) {
    const summary = analysisSummaries.find((item) => item.name === fileName || item.file_name === fileName);
    const fromAi = oneSentence(summary?.summary);
    if (fromAi) return fromAi;
    const categories = [...new Set(group.rows.map((row) => row.category).filter(Boolean))].slice(0, 3);
    const sheets = [...new Set(group.rows.map((row) => row.sheet).filter(Boolean))].slice(0, 3);
    const categoryText = categories.length ? categories.join(", ") : "수치";
    const sheetText = sheets.length ? ` 주요 시트는 ${sheets.join(", ")}입니다.` : "";
    return `${fileName}은 ${categoryText} 관련 수치와 근거 후보를 확인할 수 있는 자료입니다.${sheetText}`;
  }

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
    const fileRows = files.map((g) => `<tr><td>${esc(g.key)}</td><td>${esc(fileSummarySentence(g.key, g))}</td></tr>`);
    const repeatRows = repeats.length ? repeats.map((g) => `<tr><td class="num">${fmtWon(g.value)}</td><td class="num">${g.rows.length}</td><td>${g.rows.slice(0, 4).map((r) => `${esc(r.label)} <span class="src">(${esc(sourceOf(r))})</span>`).join("<br>")}</td></tr>`) : ['<tr><td colspan="3" class="src">반복 값 후보가 없습니다.</td></tr>'];
    const needRows = needs.length ? needs.map((r) => `<tr><td>${esc(r.category)}</td><td>${esc(r.label)}</td><td class="num">${fmtWon(r.value)}</td><td class="src">${esc(sourceOf(r))}</td></tr>`) : ['<tr><td colspan="4" class="src">현재 필터 기준 확인 필요 항목이 없습니다.</td></tr>'];
    return `${kpis}
      <h2>1. 카테고리별 구조</h2>${tableFromRows(["카테고리", "합계", "항목 수", "대표 항목"], catRows)}
      <h2>2. 파일별 구조</h2>${tableFromRows(["파일", "요약"], fileRows)}
      <h2>3. 반복 단가 후보</h2>${tableFromRows(["값", "반복 수", "대표 출처"], repeatRows)}
      <h2>4. 확인 필요 항목</h2>${tableFromRows(["카테고리", "항목", "값", "출처"], needRows)}`;
  }

  function runDeepReportStep(options = {}) {
    const body = deepReportBody();
    if (!body) { $("deepReportArea").innerHTML = '<p class="hint danger">6-A에서 표/수치 파일을 먼저 등록하세요.</p>'; return false; }
    $("deepReportArea").innerHTML = `<div class="print-area">${body}</div>`;
    lastDeepReportHtml = fullHtml("상세 보고서", body, "이 리포트는 구조 파악용입니다. 단위가 혼재된 합계는 확정 원가로 사용하지 마세요.");
    $("btnDeepReportHtml").disabled = false;
    $("btnDeepReportPdf").disabled = false;
    markStepDone("6d");
    if (!options.quiet) status("📘 상세 보고서를 만들었습니다.");
    if (options.openNext !== false) openCard("6e");
    return true;
  }
  $("btnDeepReport").addEventListener("click", () => runDeepReportStep());
  $("btnDeepReportHtml").addEventListener("click", () => {
    printHtmlReport(lastDeepReportHtml, reportDownloadName("pdf", "상세 보고서").replace(/\.pdf$/i, ""));
  });
  $("btnDeepReportPdf").addEventListener("click", () => {
    printHtmlReport(lastDeepReportHtml, reportDownloadName("pdf", "상세 보고서").replace(/\.pdf$/i, ""));
  });

  function renderEvidenceLinks() {
    const links = buildEvidenceLinks();
    const confidenceCounts = ["상", "중", "하"].map((level) =>
      `<div class="kpi"><div class="kpi-v">${links.filter((link) => link.confidence === level).length}</div><div class="kpi-l">신뢰도 ${level}</div></div>`
    ).join("");
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
    $("evidenceArea").innerHTML = `<div class="print-area">${evidenceList}<h2>수치-근거 매핑 후보</h2><div class="board-kpis">${confidenceCounts}</div>${tableFromRows(["카테고리", "수치 항목", "값", "근거 후보", "신뢰도"], rows)}</div>`;
  }
  function runEvidenceStep(options = {}) {
    if (!positiveRows().length) { $("evidenceArea").innerHTML = '<p class="hint danger">6-A에서 표/수치 파일을 먼저 등록하세요.</p>'; return false; }
    renderEvidenceLinks();
    markStepDone("6e");
    if (!options.quiet) status("⚖ 법령·근거 후보 매핑을 만들었습니다.");
    if (options.openNext !== false) openCard("6f");
    return true;
  }
  $("btnEvidence").addEventListener("click", () => runEvidenceStep());

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
  function runValidationStep(options = {}) {
    renderValidation();
    if (!validationItems.length) return false;
    markStepDone("6f");
    if (!options.quiet) status("✅ validation 표를 만들었습니다. 판정 후 검증 요약을 반영하세요.");
    return true;
  }
  function applyValidationSummary(options = {}) {
    const rows = Array.from(document.querySelectorAll("#validationArea [data-val-id]"));
    if (!rows.length) return false;
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
    if (!options.quiet) status("✅ validation 요약을 결과 정리에 반영했습니다.");
    return true;
  }
  $("btnValidation").addEventListener("click", () => runValidationStep());
  $("btnValidationSummary").addEventListener("click", () => applyValidationSummary());

  function setEditRunProgress(message, err) {
    const box = $("editRunProgress");
    if (!box) return;
    box.textContent = message || "";
    box.classList.toggle("danger", !!err);
  }

  const ANALYSIS_PIPELINE_STAGE_LABELS = {
    summary: "요약",
    questions: "확인 질문",
    plans: "분석 플랜",
    manual: "매뉴얼",
  };

  function setPipelineStageState(stage, state) {
    const el = document.querySelector(`[data-pipeline-stage="${CSS.escape(stage)}"]`);
    if (!el) return;
    el.classList.remove("is-running", "is-done", "is-failed");
    if (state) el.classList.add(`is-${state}`);
  }

  function resetPipelineStageStates() {
    Object.keys(ANALYSIS_PIPELINE_STAGE_LABELS).forEach((stage) => setPipelineStageState(stage, ""));
  }

  function renderPipelineStageOutput(stage, output) {
    if (!output || typeof output !== "object") return;
    if (stage === "summary" && Array.isArray(output.summaries)) {
      renderSummaries(output.summaries);
      markStepDone(6);
    } else if (stage === "questions" && Array.isArray(output.questions)) {
      renderIdeas(output.questions);
      markStepDone(7);
    } else if (stage === "plans" && Array.isArray(output.plans)) {
      renderPlans(output.plans);
      markStepDone(8);
    }
  }

  function hydratePipelineOutputs(outputs) {
    const values = outputs || {};
    renderPipelineStageOutput("summary", values.summaries?.content);
    renderPipelineStageOutput("questions", values.ideas?.content);
    renderPipelineStageOutput("plans", values.plans?.content);
  }

  function applyPipelineSnapshot(data, progress) {
    hydratePipelineOutputs(data?.outputs);
    const pipeline = data?.pipeline || data;
    const completed = Array.isArray(pipeline?.completed_stages) ? pipeline.completed_stages : [];
    Object.keys(ANALYSIS_PIPELINE_STAGE_LABELS).forEach((stage) => {
      setPipelineStageState(stage, completed.includes(stage) ? "done" : (pipeline?.current_stage === stage ? "running" : ""));
    });
    if (pipeline?.status === "running") {
      const label = ANALYSIS_PIPELINE_STAGE_LABELS[pipeline.current_stage] || "분석";
      const percent = Number(pipeline.progress?.percent) || 0;
      progress?.(`${label} 진행 중… ${percent}%`);
    }
    return pipeline;
  }

  async function fetchAnalysisPipelineStatus() {
    const res = await window.apiFetch(`/api/analysis/${encodeURIComponent(analysisSessionId)}/status`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function waitForAnalysisIndexReady(progress) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const data = await fetchAnalysisPipelineStatus();
      const state = data.indexing?.status || "idle";
      if (state === "done" || state === "idle") return data;
      if (state === "failed") {
        const failed = (data.indexing?.files || []).find((file) => file.index_status === "failed");
        throw new Error(failed?.index_error || "분석파일 인덱싱에 실패했습니다.");
      }
      const counts = data.indexing?.counts || {};
      progress?.(`분석파일 인덱싱 대기 중… 완료 ${counts.done || 0}, 대기 ${(counts.pending || 0) + (counts.indexing || 0)}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("분석파일 인덱싱 대기 시간이 초과되었습니다.");
  }

  async function pollAnalysisPipelineUntilDone(progress) {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const data = await fetchAnalysisPipelineStatus();
      const pipeline = applyPipelineSnapshot(data, progress);
      if (pipeline?.status === "completed") return data;
      if (pipeline?.status === "failed") throw new Error(pipeline.error?.message || "멀티스테이지 분석에 실패했습니다.");
      if (pipeline?.status === "idle") throw new Error("멀티스테이지 분석 실행을 시작하지 못했습니다.");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("멀티스테이지 분석 대기 시간이 초과되었습니다.");
  }

  async function runAnalysisPipelineStream(progress) {
    await waitForAnalysisIndexReady(progress);
    resetPipelineStageStates();
    const streamUrl = `/api/analysis/${encodeURIComponent(analysisSessionId)}/stream?doc_type=manual`;

    if (!("EventSource" in window)) {
      const response = await fetch(streamUrl, { credentials: "same-origin" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      await response.body?.cancel().catch(() => {});
      const result = await pollAnalysisPipelineUntilDone(progress);
      if (window.refreshUsage) window.refreshUsage();
      return result;
    }

    return new Promise((resolve, reject) => {
      const source = new EventSource(streamUrl);
      let settled = false;
      let fallbackStarted = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        source.close();
        if (error) reject(error);
        else resolve(value);
      };
      const eventData = (event) => {
        try { return JSON.parse(event.data || "{}"); } catch { return {}; }
      };
      const startPollingFallback = () => {
        if (fallbackStarted || settled) return;
        fallbackStarted = true;
        source.close();
        progress?.("실시간 연결이 끊겨 저장된 진행 상태를 확인하는 중…");
        pollAnalysisPipelineUntilDone(progress).then((data) => finish(null, data), (error) => finish(error));
      };

      source.addEventListener("pipeline", (event) => {
        const data = eventData(event);
        applyPipelineSnapshot(data.pipeline, progress);
      });
      source.addEventListener("snapshot", (event) => {
        const data = eventData(event);
        applyPipelineSnapshot(data.pipeline, progress);
      });
      source.addEventListener("stage", (event) => {
        const data = eventData(event);
        const label = ANALYSIS_PIPELINE_STAGE_LABELS[data.stage] || data.stage || "분석";
        if (data.type === "stage_started") {
          setPipelineStageState(data.stage, "running");
          progress?.(`${label} 진행 중… ${data.progress || 0}%`);
          return;
        }
        if (data.type === "stage_completed") {
          setPipelineStageState(data.stage, "done");
          renderPipelineStageOutput(data.stage, data.output);
          progress?.(`${label} 완료 · ${data.progress || 0}%`);
        }
      });
      source.addEventListener("complete", (event) => {
        Object.keys(ANALYSIS_PIPELINE_STAGE_LABELS).forEach((stage) => setPipelineStageState(stage, "done"));
        progress?.("AI 멀티스테이지 분석 완료 · 100%");
        if (window.refreshUsage) window.refreshUsage();
        finish(null, eventData(event));
      });
      source.addEventListener("failed", (event) => {
        const data = eventData(event);
        if (data.stage) setPipelineStageState(data.stage, "failed");
        finish(new Error(data.error?.message || "멀티스테이지 분석에 실패했습니다."));
      });
      source.onerror = startPollingFallback;
    });
  }

  async function recoverAnalysisPipeline(progress) {
    try {
      const data = await fetchAnalysisPipelineStatus();
      const pipeline = applyPipelineSnapshot(data, progress);
      if (pipeline?.status === "running") await pollAnalysisPipelineUntilDone(progress);
    } catch (error) {
      console.warn("분석 파이프라인 상태 복원 실패", error);
    }
  }

  function focusEditPlan() {
    const planCard = document.querySelector('[data-edit-output="plans"]');
    const target = planCard || $("editPlanMount")?.closest(".edit-work-panel");
    if (!target) return;
    if ("open" in target) target.open = true;
    openCard(6, false);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function reviewStatusBadge(item) {
    const statusText = effectiveReviewStatus(item);
    const ok = !reviewNeedsAttention(item);
    const reason = actionSummaryForItem(item);
    const title = ok
      ? `자료에서 계산값과 근거를 찾았습니다. 확인할 일: ${reason}`
      : `AI가 확정하지 못한 부분이 있습니다. 확인할 일: ${reason}`;
    return `<span class="review-badge ${ok ? "ok" : "need"}" data-tip="${attr(title)}" aria-label="${attr(title)}">${esc(statusText)}</span>`;
  }

  function reviewEvidenceText(item) {
    if (item?.serverEvidence?.length) {
      return item.serverEvidence.slice(0, 2)
        .map((chunk) => `${evidenceChunkLabel(chunk)}: ${chunk.excerpt || ""}`.trim())
        .join(" / ");
    }
    if (item?.top) return sourceOf(item.top);
    if (item?.evidence?.length) return sourceOf(item.evidence[0]);
    if (item?.files?.length) return item.files.slice(0, 2).join(", ");
    return item?.detail || "근거 확인 필요";
  }

  function resultKindForItem(item) {
    const typedKind = resultPolicy?.resultKind?.(item?.plan) || "";
    if (typedKind) return typedKind;
    const text = `${item?.title || ""} ${item?.detail || ""} ${item?.group || ""} ${item?.label || ""} ${item?.formula || ""}`;
    if (/로그아웃|로그인|계정|브라우저|전환|절차|체크리스트|매뉴얼|설정|발송|배포|승인/i.test(text)) return "procedure";
    if (/비교|대비|증감|차이|전후|변동|표준안|A\/B|에이비/i.test(text)) return "comparison";
    if (item?.group === "cost" || item?.formula || effectivePlanTotal(item) != null || /비용|원가|단가|예산|금액|합계|산출|산정|계산|수식|인건비|노무비|수문|유량|강우|면적|수량|인.?일/i.test(text)) return "calculation";
    if (/보고서|정책|산업|시장|청년|지역|배곧|시흥|리서치|동향|분석문|제안서|계획서|법규|법령/i.test(text)) return "report";
    return "summary_decision";
  }

  function resultKindLabel(kind) {
    if (kind === "calculation") return "계산 결과";
    if (kind === "comparison") return "비교표";
    if (kind === "report") return "보고서";
    if (kind === "procedure") return "실행 체크리스트";
    return "요약 판단";
  }

  function resultStatusForItem(item, kind) {
    if (kind === "procedure") return "needs_user_action";
    if (pendingHumanInputFields(item).length) return "needs_input";
    if (needsManualInput(item) && effectivePlanTotal(item) == null) return "needs_input";
    if (item?.reviewFlags?.length) return "needs_review";
    const seeded = item?.plan?.result_contract;
    if (seeded?.status === "ready" && !(resultPolicy?.contractBlockers?.([seeded]) || []).length) return "ready";
    if (!evidenceRefsForItem(item).length && !(item?.rows || []).length) {
      const confirmedNumbers = kind === "calculation"
        && confirmedHumanInputs(item).some((field) => ["number", "rate"].includes(field.kind));
      if (!confirmedNumbers) return "needs_evidence";
    }
    return "ready";
  }

  function resultStatusLabel(status) {
    if (status === "ready") return "결과 확인";
    if (status === "needs_input") return "입력 필요";
    if (status === "needs_review") return "검토 필요";
    if (status === "needs_user_action") return "직접 실행 필요";
    return "근거 보완";
  }

  function resultStatusClass(status) {
    return status === "ready" ? "ok" : "need";
  }

  function signedWon(value) {
    if (!Number.isFinite(value)) return "-";
    const sign = value > 0 ? "+" : "";
    return `${sign}${fmtWon(Math.round(value))}`;
  }

  function percentText(value) {
    if (!Number.isFinite(value)) return "-";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}%`;
  }

  function baselineRowForItem(item) {
    const rows = Array.isArray(item?.rows) ? item.rows : [];
    return rows.find((row) => /합계|총계|금액\/합계|기준 단가|적용 단가/i.test(`${row.sourceRole || ""} ${row.label || ""}`))
      || item?.top
      || rows[0]
      || null;
  }

  function resultVerificationForItem(contract, item) {
    if (contract.kind !== "calculation") {
      const evidenceCount = evidenceRefsForItem(item).length || (item?.evidence || []).length || (item?.serverEvidence || []).length;
      return {
        status: evidenceCount ? "근거 연결" : "근거 보완",
        statusClass: evidenceCount ? "ok" : "need",
        calculated: "-",
        baseline: evidenceCount ? `${evidenceCount}건` : "-",
        residual: "-",
        errorRate: "-",
        note: evidenceCount ? "원본근거 보기에서 출처를 확인하세요." : "결과 확정을 위해 원본 근거가 더 필요합니다.",
      };
    }
    const calculated = Number(contract.result_value?.raw_number ?? effectivePlanTotal(item));
    const baselineRow = baselineRowForItem(item);
    const baseline = Number(baselineRow?.value);
    if (!Number.isFinite(calculated) || !Number.isFinite(baseline) || baseline === 0) {
      return {
        status: "기준값 필요",
        statusClass: "need",
        calculated: Number.isFinite(calculated) ? fmtWon(Math.round(calculated)) : "-",
        baseline: Number.isFinite(baseline) ? fmtWon(Math.round(baseline)) : "-",
        residual: "-",
        errorRate: "-",
        note: "비교할 기준값 또는 원본 합계 셀이 필요합니다.",
      };
    }
    const residual = calculated - baseline;
    const errorRate = (residual / baseline) * 100;
    const absRate = Math.abs(errorRate);
    const status = absRate <= 1 ? "검산 양호" : absRate <= 5 ? "확인 필요" : "차이 큼";
    const note = baselineRow
      ? `기준값: ${sourceCellAddress(baselineRow)} · ${baselineRow.sourceRole || baselineRow.category || "대표 수치"}`
      : "기준값 출처 확인 필요";
    return {
      status,
      statusClass: absRate <= 1 ? "ok" : "need",
      calculated: fmtWon(Math.round(calculated)),
      baseline: fmtWon(Math.round(baseline)),
      residual: signedWon(residual),
      errorRate: percentText(errorRate),
      note,
    };
  }

  function resultVerificationHtml(verification) {
    if (!verification) return "";
    return `<div class="result-verification">
      <div class="result-verification-head">
        <strong>검증</strong>
        <span class="verify-status ${esc(verification.statusClass)}">${esc(verification.status)}</span>
      </div>
      <dl>
        <div><dt>계산값</dt><dd>${esc(verification.calculated)}</dd></div>
        <div><dt>기준값</dt><dd>${esc(verification.baseline)}</dd></div>
        <div><dt>잔차</dt><dd>${esc(verification.residual)}</dd></div>
        <div><dt>오차율</dt><dd>${esc(verification.errorRate)}</dd></div>
      </dl>
      <p>${esc(verification.note)}</p>
    </div>`;
  }

  function confirmationChecklistForItem(contract, item) {
    const checks = [];
    if (contract.kind === "calculation") {
      checks.push("결과값이 사용자가 구하려는 항목인지 확인");
      if (contract.formula?.expression) checks.push("수식의 단위·기간·수량 기준이 맞는지 확인");
      if (/교통|여비|출장|차량|왕복/i.test(`${item?.title || ""} ${item?.detail || ""} ${contract.formula?.expression || ""}`)) {
        checks.push("교통비는 버스/기차/차량 중 어떤 기준인지 확인");
      }
      if (contract.evidence_refs?.length) checks.push("근거 보기에서 원문 문구·엑셀 셀을 확인");
      if (contract.missing_inputs?.length) checks.push(`${contract.missing_inputs.slice(0, 3).join(", ")} 값을 입력 또는 메모`);
    } else if (contract.kind === "report") {
      checks.push("보고서가 원하는 주제와 범위를 다루는지 확인");
      checks.push("본문에 없는 사실이나 과한 표현이 없는지 확인");
      checks.push("근거 보기에서 인용 문구와 페이지를 확인");
    } else if (contract.kind === "comparison") {
      checks.push("비교 기준 기간·대상·단위가 같은지 확인");
      checks.push("큰 차이가 난 항목의 원본 행/셀을 확인");
    } else if (contract.kind === "procedure") {
      checks.push("AI가 완료한 일이 아니라 담당자가 직접 실행할 일인지 확인");
      checks.push("실행 후 완료 여부와 예외 상황을 메모");
    } else {
      checks.push("요약이 실제 업무 판단에 필요한 내용인지 확인");
      checks.push("근거 부족 항목은 자료를 보완하거나 담당자 메모로 남김");
    }
    return [...new Set(checks)].slice(0, 5);
  }

  function actionSummaryForItem(item) {
    const contract = resultContractForItem(item);
    if (contract.status === "needs_input") {
      return `부족한 값 입력: ${contract.missing_inputs?.slice(0, 3).join(", ") || "계산 변수"}`;
    }
    if (contract.status === "needs_evidence") return "근거 자료 추가 또는 원문 확인";
    if (contract.status === "needs_user_action") return "담당자가 직접 실행 후 완료 메모";
    if (contract.kind === "calculation") return "결과값·수식·원문근거 확인";
    if (contract.kind === "report") return "보고서 범위와 근거 문구 확인";
    if (contract.kind === "comparison") return "비교 기준과 큰 차이 항목 확인";
    return "결과 내용과 근거 확인";
  }

  function resultUnitForItem(item, value) {
    const text = `${item?.title || ""} ${item?.detail || ""} ${item?.formula || ""}`;
    if (/%|비율|요율/.test(text)) return "%";
    if (/원가|비용|금액|단가|예산|인건비|노무비|원\b/.test(text)) return "원";
    if (/시간|공수/.test(text)) return "시간";
    if (/명|인원/.test(text)) return "명";
    if (/건|개소|지점|수량|횟수/.test(text)) return "개";
    return value != null && Math.abs(value) >= 1000 ? "원" : "";
  }

  function formatResultValue(value, unit) {
    if (value == null) return "";
    const formatted = unit === "원" ? fmtCurrency(value) : fmtWon(value);
    if (unit === "%") return `${formatted}%`;
    return unit ? `${formatted}${unit}` : formatted;
  }

  function resultVariablesForItem(item) {
    const rows = (item?.rows || []).slice(0, 6).map((row) => ({
      label: rowMeaning(row),
      value: row.value != null ? fmtWon(row.value) : "원문 확인",
      source: `${sourceCellAddress(row)} · ${row.file || ""}`,
      rowHeader: row.rowHeader || "",
      columnHeader: row.columnHeader || "",
      locked: true,
    }));
    const fields = Array.isArray(item?.manualInputs?.fields) ? item.manualInputs.fields : [];
    const manual = fields.filter((field) => String(field.value ?? "").trim()).slice(0, 6).map((field) => ({
      label: field.label,
      value: [field.value, field.unit].filter(Boolean).join(" "),
      source: field.source === "candidate"
        ? `후보 선택 · ${candidateOptionLabel(field.candidate || { value: field.value, unit: field.unit })}`
        : (field.source === "candidate+edited" ? "후보 기반 직접 수정" : (field.source || "담당자 입력")),
      locked: false,
    }));
    return [...rows, ...manual].slice(0, 8);
  }

  function sourceCellHint(source) {
    const match = String(source || "").match(/(?:^|[!·\s])([A-Z]{1,3}\d{1,6})(?:\s|·|$)/i);
    if (!match) return "";
    return `${match[1].toUpperCase()}는 원본 엑셀의 셀 주소입니다. 이 값이 어떤 항목인지는 왼쪽 '원문 항목명'에서 확인합니다.`;
  }

  function formulaVariablesHtml(variables = []) {
    if (!variables.length) return '<p class="hint">원문에서 수식에 넣을 값을 확정하지 못했습니다. 필요한 경우 “부족한 값 입력”에서 별도로 입력하세요.</p>';
    const fixed = variables.filter((v) => v.locked !== false);
    const manual = variables.filter((v) => v.locked === false);
    const rows = variables.map((v) => {
      const hint = sourceCellHint(v.source);
      return `<tr>
        <td>${esc(v.label || "원문 항목")}</td>
        <td class="num">${esc(v.value || "")}</td>
        <td>${esc(v.source || "")}${hint ? `<br><span class="src">${esc(hint)}</span>` : ""}</td>
      </tr>`;
    }).join("");
    const note = fixed.length
      ? "아래 값은 원본 PDF/엑셀에서 가져온 고정값 후보입니다. 여기서 직접 수정하는 값이 아닙니다."
      : "아래 값은 담당자가 입력한 값입니다.";
    const manualNote = manual.length
      ? `<span>담당자 입력값 ${fmtWon(manual.length)}개가 함께 반영됐습니다.</span>`
      : "<span>다른 기준을 쓰려면 “부족한 값 입력”에 별도로 입력하세요.</span>";
    return `<div class="formula-fixed-note">
        <strong>수식 입력값은 고정</strong>
        <span>${esc(note)}</span>
        ${manualNote}
      </div>
      <div class="formula-value-table"><table>
        <thead><tr><th>원문 항목명</th><th>고정값</th><th>원본 위치</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function comparisonRowsForItem(item) {
    const rows = (item?.rows || []).slice(0, 8).map((row) => ({
      item: row.label,
      result: row.value != null ? fmtWon(row.value) : "원문 확인",
      evidence: sourceOf(row),
    }));
    if (rows.length) return rows;
    return evidenceRefsForItem(item).slice(0, 6).map((ref, index) => ({
      item: ref.label || `근거 ${index + 1}`,
      result: ref.excerpt || "원본 확인",
      evidence: [ref.file_name, ref.page ? `p.${ref.page}` : "", ref.sheet, ref.range].filter(Boolean).join(" · "),
    }));
  }

  function checklistForItem(item, kind) {
    const text = `${item?.title || ""} ${item?.detail || ""}`;
    const base = kind === "procedure" && /로그아웃|로그인|계정|브라우저|전환/i.test(text)
      ? [
          "현재 브라우저에서 개인 계정으로 로그인된 서비스 확인",
          "업무에 사용할 서비스에서 개인 계정 로그아웃",
          "회사 계정으로 다시 로그인",
          "프로필·권한·동기화 계정이 회사 계정인지 확인",
          "완료 여부와 예외 상황을 업무 기록에 남김",
        ]
      : [
          ...(item?.needs || []).map((need) => `${need} 확인`),
          ...(item?.reviewFlags || []).map((flag) => `${flag} 검토`),
          evidenceRefsForItem(item).length ? "원본근거 하이라이트 확인" : "근거 자료 보완",
        ];
    const rows = base.length ? base : [item?.detail || `${item?.title || "검토 작업"} 결과 확인`];
    return [...new Set(rows)].slice(0, 8).map((label) => ({
      label,
      status: "todo",
      note: kind === "procedure" ? "AI가 실제 PC 조작을 완료했다고 처리하지 않는 담당자 실행 항목입니다." : "",
    }));
  }

  function reportSectionsForItem(item, answer) {
    const evidence = evidenceRefsForItem(item).slice(0, 3)
      .map((ref) => `${ref.label || ref.file_name}: ${ref.excerpt || "원문 확인"}`)
      .join("\n");
    const missing = [...(item?.needs || []), ...(item?.reviewFlags || [])].filter(Boolean).join(", ");
    return [
      { heading: "결과 요약", body: answer },
      { heading: "분석 범위", body: item?.detail || item?.title || "선택한 분석 작업" },
      { heading: "근거 및 확인 내용", body: evidence || "연결된 원본 근거가 부족해 자료 추가 또는 원문 확인이 필요합니다." },
      { heading: "다음 확인 사항", body: missing || "현재 결과를 기준으로 담당자가 적용 범위와 최종 사용 여부를 확인하면 됩니다." },
    ];
  }

  function resultContractForItem(item) {
    const kind = resultKindForItem(item);
    const value = effectivePlanTotal(item);
    const unit = resultUnitForItem(item, value);
    const valueText = formatResultValue(value, unit);
    const humanFields = humanInputFieldState(item);
    const pendingLabels = pendingHumanInputFields(item).map((field) => field.label);
    const unresolvedNeeds = manualInputsComplete(item) ? [] : (item?.needs || []);
    const missing = [...new Set([...unresolvedNeeds, ...(item?.reviewFlags || []), ...pendingLabels].filter(Boolean))].slice(0, 10);
    const resultStatus = resultStatusForItem(item, kind);
    let answer = "";
    if (kind === "calculation") {
      answer = valueText && resultStatus === "ready"
        ? `${item.title}의 계산 결과는 ${valueText}입니다. 적용 수식과 근거를 함께 확인하세요.`
        : (valueText
          ? `${item.title}의 현재 확인된 부분값은 ${valueText}입니다. 미산정 항목이 있어 확정 합계가 아닙니다.`
          : `${item.title}은 아직 확정 계산값이 없습니다. ${missing.join(", ") || "필수 입력값"}을 확인해야 합니다.`);
    } else if (kind === "comparison") {
      answer = `${item.title} 비교 결과를 ${comparisonRowsForItem(item).length || 1}개 항목으로 정리했습니다.`;
    } else if (kind === "report") {
      answer = `${item.title} 보고서 초안을 작성했습니다. 핵심 근거, 분석 범위, 확인 사항을 본문 형태로 정리했습니다.`;
    } else if (kind === "procedure") {
      answer = `${item.title}은 AI가 실제 외부 시스템 조작을 완료했다고 처리하지 않고, 담당자가 실행할 체크리스트로 정리했습니다.`;
    } else {
      answer = `${item.title} 결과를 업무 판단용 요약으로 정리했습니다. 근거와 추가 확인 항목을 함께 확인하세요.`;
    }
    const contract = {
      kind,
      title: item.title,
      status: resultStatus,
      answer,
      result_value: valueText ? { label: resultStatus === "ready" ? "결과값" : "확인된 부분값", value: valueText, raw_number: value, unit, final: resultStatus === "ready" } : null,
      formula: item.formula || kind === "calculation" ? {
        expression: item.formula || "입력값 확인 후 적용 수식 확정",
        variables: resultVariablesForItem(item),
        note: resultVariablesForItem(item).length ? "원문 표/엑셀에서 확인된 고정값을 사용했습니다." : "필수 입력값이 확정되면 같은 수식으로 다시 계산합니다.",
      } : null,
      evidence_refs: evidenceRefsForItem(item).slice(0, 6),
      missing_inputs: missing,
      human_input_fields: humanFields.map((field) => ({
        id: field.id || field.label,
        label: field.label,
        kind: field.kind || "text",
        impact: field.impact || "medium",
        required: field.required !== false,
        reason: field.reason || "",
        status: field.status || "pending",
        value: field.value ?? "",
        unit: field.unit || "",
        selection: field.selection || "",
        source: field.source || "",
        human_verified: field.human_verified === true,
        candidate_confidence: field.candidate?.confidence || field.candidate_confidence || "",
        candidates: (field.candidates || []).slice(0, 8),
      })),
      human_confirmed_inputs: confirmedHumanInputs(item),
      source_note: evidenceRefsForItem(item).length ? `원본근거 ${evidenceRefsForItem(item).length}개 연결` : "연결된 원본근거가 부족합니다.",
    };
    if (kind === "comparison") contract.comparison_rows = comparisonRowsForItem(item);
    if (kind === "report" || kind === "summary_decision") contract.report_sections = reportSectionsForItem(item, answer);
    if (kind === "procedure") contract.checklist = checklistForItem(item, kind);
    const seeded = item?.plan?.result_contract;
    if (!seeded || typeof seeded !== "object" || !seeded.kind) return contract;
    const merged = { ...contract, ...seeded, title: seeded.title || contract.title };
    // The local gate is authoritative after the user confirms or edits inputs.
    // Do not let a stale planner status keep a now-complete result blocked.
    merged.status = contract.status;
    if (!seeded.answer) merged.answer = contract.answer;
    const authoritativeAmount = resultPolicy?.authoritativePlanAmount?.(item?.plan);
    if (!seeded.result_value || seeded.result_value.value == null || (kind === "calculation" && authoritativeAmount == null)) merged.result_value = contract.result_value;
    if (!Array.isArray(seeded.formula?.variables) || !seeded.formula.variables.length) merged.formula = contract.formula;
    else if (contract.formula?.variables?.length) {
      const manualFields = Array.isArray(item?.manualInputs?.fields) ? item.manualInputs.fields : [];
      const manualFor = (variable) => {
        const name = String(variable?.name || variable?.label || "").trim().toLowerCase();
        return manualFields.find((field) => {
          const label = String(field?.label || "").trim().toLowerCase();
          return label && (label === name || name.includes(label) || label.includes(name));
        });
      };
      const variables = seeded.formula.variables.map((variable) => {
        const field = manualFor(variable);
        if (!field || !String(field.value ?? "").trim()) return variable;
        return {
          ...variable,
          value: [field.value, field.unit].filter(Boolean).join(" "),
          unit: field.unit || variable.unit || "",
          source: field.source === "candidate" ? "담당자 후보 선택" : "담당자 입력",
          locked: false,
        };
      });
      const seededNames = new Set(variables.map((variable) => String(variable?.name || variable?.label || "").trim().toLowerCase()));
      const additional = contract.formula.variables.filter((variable) => variable.locked === false && !seededNames.has(String(variable?.label || variable?.name || "").trim().toLowerCase()));
      merged.formula = { ...contract.formula, ...seeded.formula, variables: [...variables, ...additional].slice(0, 12) };
    }
    if (!Array.isArray(seeded.evidence_refs) || !seeded.evidence_refs.length) merged.evidence_refs = contract.evidence_refs;
    merged.missing_inputs = contract.missing_inputs;
    if (contract.human_input_fields.length || !Array.isArray(seeded.human_input_fields)) merged.human_input_fields = contract.human_input_fields;
    if (contract.human_confirmed_inputs.length || !Array.isArray(seeded.human_confirmed_inputs)) merged.human_confirmed_inputs = contract.human_confirmed_inputs;
    if ((!Array.isArray(seeded.report_sections) || !seeded.report_sections.length) && contract.report_sections) merged.report_sections = contract.report_sections;
    if ((!Array.isArray(seeded.checklist) || !seeded.checklist.length) && contract.checklist) merged.checklist = contract.checklist;
    if (item?.manualInputs?.fields?.length && kind === "calculation") merged.answer = contract.answer;
    if (pendingHumanInputFields(item).length) merged.status = "needs_input";
    const mergedFields = Array.isArray(merged.human_input_fields) ? merged.human_input_fields : [];
    if (mergedFields.some((field) => field?.required !== false && !isHumanFieldResolved(field))) merged.status = "needs_input";
    else if (merged.status === "ready" && Array.isArray(merged.missing_inputs) && merged.missing_inputs.length) merged.status = "needs_review";
    return merged;
  }

  function reviewFilterMatches(item) {
    if (reviewFilter === "needs") return reviewNeedsAttention(item);
    if (reviewFilter === "input") return hasHumanInputGate(item);
    if (reviewFilter === "evidence") return !evidenceRefsForItem(item).length || item.evidenceStatus === "missing_evidence";
    return true;
  }

  function resultContractCardHtml(contract, item, index, options = {}) {
    const interactive = options.interactive !== false;
    const evidenceBtn = interactive
      ? `<button class="btn btn-ghost btn-small evidence-open" type="button" data-evidence-result="${index}">${esc(evidenceOpenLabel(item))}</button>`
      : "";
    const inputBtn = interactive && hasHumanInputGate(item)
      ? `<button class="btn btn-ghost btn-small manual-input-btn" type="button" data-manual-result="${index}">${contract.status === "needs_input" ? "입력값 확인" : "입력값 수정"}</button>`
      : "";
    const valueHtml = contract.result_value
      ? `<div class="result-value"><span>${esc(contract.result_value.label)}</span><strong>${esc(contract.result_value.value)}</strong></div>`
      : "";
    const verificationHtml = resultVerificationHtml(resultVerificationForItem(contract, item));
    const formulaHtml = contract.formula
      ? `<details class="result-contract-detail"><summary>계산식 보기</summary>
          <div class="formula-line">${esc(contract.formula.expression)}</div>
          ${formulaVariablesHtml(contract.formula.variables || [])}
        </details>` : "";
    const comparisonHtml = contract.comparison_rows?.length
      ? `<div class="result-mini-table"><table><thead><tr><th>항목</th><th>결과</th><th>근거</th></tr></thead><tbody>${contract.comparison_rows.map((row) =>
          `<tr><td>${esc(row.item)}</td><td>${esc(row.result)}</td><td>${esc(row.evidence || "")}</td></tr>`).join("")}</tbody></table></div>`
      : "";
    const reportHtml = contract.report_sections?.length
      ? `<div class="result-report-preview">${contract.report_sections.slice(0, 4).map((section) =>
          `<section><h4>${esc(section.heading)}</h4><p>${esc(section.body).replace(/\n/g, "<br>")}</p></section>`).join("")}</div>`
      : "";
    const checklistHtml = contract.checklist?.length
      ? `<ul class="result-checklist">${contract.checklist.map((todo) => {
          const label = typeof todo === "string" ? todo : todo.label;
          const note = typeof todo === "string" ? "" : todo.note;
          return `<li><span aria-hidden="true">□</span><div>${esc(label)}${note ? `<br><span class="src">${esc(note)}</span>` : ""}</div></li>`;
        }).join("")}</ul>`
      : "";
    const missingHtml = contract.missing_inputs?.length
      ? `<div class="result-missing"><strong>입력/확인할 값</strong><span>${esc(contract.missing_inputs.slice(0, 4).join(", "))}</span></div>`
      : "";
    const confirmedHtml = contract.human_confirmed_inputs?.length
      ? `<div class="result-human-inputs"><strong>사람 확인 완료</strong>${contract.human_confirmed_inputs.slice(0, 4).map((field) => {
          const confidence = field.confidence ? ` · 후보 신뢰도 ${field.confidence}` : "";
          return `<span>${esc(field.label)}: ${esc([field.value, field.unit].filter(Boolean).join(" "))}${esc(confidence)}</span>`;
        }).join("")}</div>`
      : "";
    const selectedCandidates = (contract.human_input_fields || []).filter((field) => field.status === "selected_candidate" || (field.source === "candidate" && field.human_verified !== true));
    const selectedHtml = selectedCandidates.length
      ? `<div class="result-missing"><strong>원본 확인 전 후보</strong><span>${esc(selectedCandidates.slice(0, 4).map((field) =>
          `${field.label}: ${[field.value, field.unit].filter(Boolean).join(" ")}${field.candidate_confidence ? ` (${field.candidate_confidence})` : ""}`).join(", "))}</span></div>`
      : "";
    const checklistTip = confirmationChecklistForItem(contract, item).map((check) => `- ${check}`).join("\n");
    const statusTitle = `${actionSummaryForItem(item)}\n\n무엇을 확인하나요?\n${checklistTip}`;
    return `<article class="result-contract-card kind-${esc(contract.kind)}" title="${attr(statusTitle)}">
      <div class="result-contract-head">
        <span class="result-kind">${esc(resultKindLabel(contract.kind))}</span>
        <span class="review-badge ${resultStatusClass(contract.status)}" data-tip="${attr(statusTitle)}" aria-label="${attr(statusTitle)}">${esc(resultStatusLabel(contract.status))}</span>
      </div>
      <h4>${esc(contract.title)}</h4>
      <p>${esc(contract.answer)}</p>
      ${valueHtml}
      ${verificationHtml}
      <div class="result-contract-actions">${evidenceBtn}${inputBtn}</div>
      ${formulaHtml}${comparisonHtml}${reportHtml}${checklistHtml}${selectedHtml}${confirmedHtml}${missingHtml}
    </article>`;
  }

  function planResultContractsHtml(options = {}) {
    const filtered = planExecutionResults
      .map((item, index) => ({ item, index, contract: resultContractForItem(item) }))
      .filter(({ item }) => reviewFilterMatches(item));
    if (!filtered.length) return "";
    return `<div class="result-contract-grid">${filtered.map(({ item, index, contract }) =>
      resultContractCardHtml(contract, item, index, options)).join("")}</div>`;
  }

  function renderEditResultContracts() {
    const box = $("editResultContracts");
    if (!box) return;
    if (!planExecutionResults.length) {
      box.innerHTML = '<p class="hint">자동 분석 후 실제 결과값, 보고서 초안, 실행 체크리스트가 표시됩니다.</p>';
      return;
    }
    const html = planResultContractsHtml({ interactive: true });
    box.innerHTML = html || '<p class="hint">현재 필터에 맞는 결과가 없습니다.</p>';
  }

  function resultContractInlineHtml(contract) {
    if (!contract) return "";
    const value = contract.result_value?.value ? ` · ${contract.result_value.value}` : "";
    return `<br><span class="src">${esc(resultKindLabel(contract.kind))}${esc(value)} · ${esc(contract.answer || "")}</span>`;
  }

  function evidenceOpenLabel(item) {
    const refs = evidenceRefsForItem(item);
    if (refs.length > 1) return `원문 근거 ${fmtWon(refs.length)}개 보기`;
    const ref = refs[0];
    if (!ref) return "근거 없음";
    if (ref.type === "pdf") return "PDF 원문 보기";
    if (ref.type === "xlsx") return "엑셀 셀 보기";
    return "원문 근거 보기";
  }

  function reportReadinessSnapshot() {
    const contracts = planExecutionResults.map((item) => resultContractForItem(item));
    const base = resultPolicyReady
      ? resultPolicy.reportReadiness(contracts, reportStorageState === "stored")
      : {
          state: "waiting",
          label: "결과 정책 확인 필요",
          blockers: ["결과 판정 정책이 준비되지 않아 서버 보관을 진행할 수 없습니다."],
        };
    if (reportStorageState === "storing") return { ...base, baseState: base.state, state: "storing", label: "보관 중" };
    if (reportStorageState === "failed") {
      const label = base.state === "needs_review" ? "검토·보관 실패" : "보관 실패";
      return { ...base, baseState: base.state, state: "storage_failed", label, error: reportStorageError };
    }
    return { ...base, baseState: base.state };
  }

  function requireReportReadyForStorage() {
    const snapshot = reportReadinessSnapshot();
    const retryable = snapshot.state === "ready"
      || (snapshot.state === "storage_failed" && snapshot.baseState === "ready" && !snapshot.blockers?.length);
    if (retryable) return true;
    if (snapshot.state === "stored") {
      status("이미 현재 검토 결과가 서버에 기록되어 있습니다.");
      return false;
    }
    const pending = pendingExecutionInputs();
    if (pending.length) {
      openCard(9, true);
      openManualInputPanel(pending[0].index);
    }
    const detail = snapshot.blockers?.length ? `: ${snapshot.blockers.slice(0, 3).join(" · ")}` : "";
    status(`서버 보관 전에 검토가 필요합니다${detail}`, true);
    return false;
  }

  function updateEditActionSummary() {
    const box = $("editActionSummary");
    if (!box) return;
    const total = planExecutionResults.length;
    const needs = planExecutionResults.filter(reviewNeedsAttention).length;
    const missing = planExecutionResults.filter((item) => !evidenceRefsForItem(item).length).length;
    if (!total) {
      box.textContent = "자동 분석 후 다음 확인 작업이 표시됩니다.";
      box.classList.remove("need");
      return;
    }
    box.textContent = needs
      ? `총 ${fmtWon(total)}개 항목을 검토했습니다. ${fmtWon(total - needs)}개는 바로 확인 가능하고, ${fmtWon(needs)}개는 담당자 확인이 필요합니다${missing ? ` · 근거 부족 ${fmtWon(missing)}개` : ""}.`
      : `총 ${fmtWon(total)}개 항목을 검토했습니다. 모든 항목이 확인 상태입니다.`;
    box.classList.toggle("need", needs > 0);
  }

  function renderEditCalculationReview() {
    if (pageMode !== "edit") return;
    const kpis = $("editCalcKpis");
    const review = $("editCalculationReview");
    if (!kpis || !review) return;
    const costItems = planExecutionResults.filter((item) => resultKindForItem(item) === "calculation");
    const needCount = planExecutionResults.filter(reviewNeedsAttention).length;
    const reportSnapshot = reportReadinessSnapshot();
    const reportState = reportSnapshot.label;
    kpis.innerHTML = `
      <div><strong>${fmtWon(analysisFiles.length)}건</strong><span>등록 자료</span></div>
      <div><strong>${fmtWon(needCount)}건</strong><span>담당자 확인</span></div>
      <div><strong>${reportState}</strong><span>리포트</span></div>`;
    const saveButton = $("btnSaveExecution");
    if (saveButton) {
      const blockedRetry = reportSnapshot.state === "storage_failed"
        && (reportSnapshot.baseState !== "ready" || !!reportSnapshot.blockers?.length);
      saveButton.disabled = ["waiting", "needs_review", "storing", "stored"].includes(reportSnapshot.state) || blockedRetry;
      saveButton.title = reportSnapshot.blockers?.length ? reportSnapshot.blockers.slice(0, 3).join("\n") : "";
    }
    updateEditActionSummary();
    renderEditResultContracts();
    if (!planExecutionResults.length) {
      review.innerHTML = '<p class="hint">자동 분석 후 계산 확인표가 표시됩니다.</p>';
      $("btnExportReportCsv")?.setAttribute("disabled", "disabled");
      return;
    }
    const headlineHtml = headlineCalculationHtml({ interactive: true });
    const filteredResults = planExecutionResults
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => reviewFilterMatches(item));
    if (!filteredResults.length) {
      review.innerHTML = `${headlineHtml}<p class="hint">현재 필터에 맞는 확인 항목이 없습니다. 전체 보기를 누르면 모든 결과를 볼 수 있습니다.</p>`;
      $("btnExportReportCsv")?.removeAttribute("disabled");
      return;
    }
    const rows = filteredResults.map(({ item, index }) => {
      const total = effectivePlanTotal(item);
      const amount = resultKindForItem(item) === "calculation" && total != null ? fmtCurrency(total) : "-";
      const formula = item.formula || (item.group === "review" ? "근거자료 확인" : "자료 기준 확인");
      const evidenceChip = evidencePopoverButton(item, index);
      const manualSummary = manualInputSummary(item);
      const inputButton = hasHumanInputGate(item)
        ? `<button class="btn btn-ghost btn-small manual-input-btn" type="button" data-manual-result="${index}">${needsManualInput(item) ? "입력값 확인" : "입력값 수정"}</button>`
        : "";
      const action = actionSummaryForItem(item);
      return `<tr>
        <td><strong>${esc(item.title)}</strong>${item.detail ? `<br><span class="src">${esc(item.detail)}</span>` : ""} ${evidenceChip}</td>
        <td>${esc(formula)}</td>
        <td class="num">${esc(amount)}</td>
        <td><button class="btn btn-ghost btn-small evidence-open" type="button" data-evidence-result="${index}">${esc(evidenceOpenLabel(item))}</button></td>
        <td>${reviewStatusBadge(item)}</td>
        <td>${inputButton}<div class="manual-input-summary">${esc(manualSummary || action)}</div></td>
      </tr>`;
    }).join("");
    review.innerHTML = `${headlineHtml}<div class="cost-table-wrap"><table class="edit-calculation-table">
      <thead><tr><th>항목</th><th>계산식</th><th>금액</th><th>근거</th><th>상태</th><th>해야 할 일</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
    $("btnExportReportCsv")?.removeAttribute("disabled");
  }

  function setEditStepState(step, state) {
    if (pageMode !== "edit" || !step) return;
    const el = document.querySelector(`[data-edit-step="${CSS.escape(step)}"]`);
    if (!el) return;
    el.classList.remove("is-running", "is-done", "is-failed", "is-skipped");
    if (state) el.classList.add(`is-${state}`);
  }

  function editStepForLabel(label) {
    if (/간단 요약|단가 산식|계산식/.test(label)) return "formula";
    if (/근거|상세 보고서|검증표|검토표/.test(label)) return "evidence";
    if (/아이디어|확인 질문/.test(label)) return "questions";
    if (/플랜|선택/.test(label)) return "plans";
    if (/리포트|결과|산출물/.test(label)) return "report";
    return "";
  }

  function reportTableRows() {
    const header = ["결과 유형", "항목", "실제 결과값", "수식/절차", "상태", "근거 자료", "메모/보고서"];
    const rows = planExecutionResults.map((item) => {
      const contract = resultContractForItem(item);
      const amount = contract.result_value?.value || "";
      const formula = contract.formula?.expression || (contract.checklist?.length ? contract.checklist.map((todo) => `□ ${todo.label}`).join("\n") : "");
      const statusText = `${effectiveReviewStatus(item)}${item.reviewFlags?.length ? ` (${item.reviewFlags.join(", ")})` : ""}`;
      const memo = [
        contract.answer,
        contract.report_sections?.slice(0, 2).map((section) => `${section.heading}: ${section.body}`).join("\n"),
        contract.comparison_rows?.slice(0, 5).map((row) => `${row.item}: ${row.result}`).join("\n"),
        item.detail || "",
        manualInputSummary(item),
      ].filter(Boolean).join("\n");
      return [resultKindLabel(contract.kind), item.title, amount || "입력 필요", formula, statusText, reviewEvidenceText(item).replace(/\s\/\s/g, "\n"), memo];
    });
    return [header, ...(rows.length ? rows : [["분석", "AI 검토 작업 결과", "", "", "대기", "", "자동 분석 후 생성"]])];
  }

  function downloadReportExcel() {
    if (!window.XLSX) {
      status("❌ Excel 파일 생성 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.", true);
      return;
    }
    const rows = [
      [reportTitleText()],
      [`생성일: ${todayISO()} · 긴 근거는 셀 안에서 줄바꿈됩니다.`],
      [],
      ...reportTableRows(),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 34 }, { wch: 30 }, { wch: 14 }, { wch: 16 }, { wch: 62 }, { wch: 36 }];
    ws["!rows"] = [{ hpt: 24 }, { hpt: 18 }, { hpt: 8 }, { hpt: 22 }, ...rows.slice(4).map(() => ({ hpt: 48 }))];
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
    ];
    ws["!autofilter"] = { ref: `A4:G${rows.length}` };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "계산 검토표");
    const data = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = reportDownloadName("xlsx");
    a.click();
    URL.revokeObjectURL(a.href);
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("#btnOpenEvidenceGuide")) {
      event.preventDefault();
      openFirstEvidenceViewer();
      return;
    }
    const filterBtn = event.target.closest("[data-review-filter]");
    if (filterBtn) {
      event.preventDefault();
      reviewFilter = filterBtn.dataset.reviewFilter || "all";
      document.querySelectorAll("[data-review-filter]").forEach((btn) => btn.classList.toggle("active", btn === filterBtn));
      renderEditCalculationReview();
      return;
    }
    const manualBtn = event.target.closest("[data-manual-result]");
    if (manualBtn) {
      event.preventDefault();
      openManualInputPanel(Number(manualBtn.dataset.manualResult));
      return;
    }
    const helpBtn = event.target.closest(".evidence-help");
    if (helpBtn) {
      event.preventDefault();
      showEvidencePopover(helpBtn);
      return;
    }
    const evidenceBtn = event.target.closest("[data-evidence-result]");
    if (evidenceBtn) {
      event.preventDefault();
      openEvidenceViewer(Number(evidenceBtn.dataset.evidenceResult));
      return;
    }
    if (event.target.closest("[data-close-evidence-viewer]")) {
      event.preventDefault();
      closeEvidenceViewer();
      return;
    }
    const restoreBtn = event.target.closest("[data-restore-workbook]");
    if (restoreBtn) {
      event.preventDefault();
      restoreWorkbookOverrides(restoreBtn.dataset.restoreWorkbook || "", restoreBtn.dataset.restoreSheet || "");
      return;
    }
    const exportBtn = event.target.closest("[data-export-workbook]");
    if (exportBtn) {
      event.preventDefault();
      downloadEditedWorkbook(exportBtn.dataset.exportWorkbook || "");
      return;
    }
    if (event.target.closest("[data-close-manual-input]")) {
      event.preventDefault();
      closeManualInputPanel();
      return;
    }
    if (event.target.closest("[data-save-manual-input]")) {
      event.preventDefault();
      saveManualInputPanel();
      return;
    }
    hideEvidencePopover();
  });
  document.addEventListener("change", (event) => {
    const manualMode = event.target.closest("[data-manual-mode]");
    if (manualMode) {
      applyManualInputMode(manualMode);
      return;
    }
    const manualSelect = event.target.closest("[data-manual-select]");
    if (manualSelect) {
      applyManualCandidateSelection(manualSelect);
      return;
    }
    const unitMode = event.target.closest("[data-headline-unit-mode]");
    if (unitMode) {
      costHeadlineMode = unitMode.value || "field_once";
      reportStorageState = "idle";
      reportStorageError = "";
      renderEditCalculationReview();
      runBuildResultStep({ quiet: true });
      status("✅ 조사 단위 기준을 바꿔 헤드라인 계산을 다시 반영했습니다.");
    }
  });
  document.addEventListener("focusout", (event) => {
    const cell = event.target.closest("[data-xlsx-cell][contenteditable='true']");
    if (cell) applySpreadsheetCellEdit(cell);
  });
  document.addEventListener("mouseover", (event) => {
    const helpBtn = event.target.closest(".evidence-help");
    if (helpBtn) showEvidencePopover(helpBtn);
  });
  document.addEventListener("focusin", (event) => {
    const helpBtn = event.target.closest(".evidence-help");
    if (helpBtn) showEvidencePopover(helpBtn);
  });
  document.addEventListener("keydown", (event) => {
    const editCell = event.target.closest("[data-xlsx-cell][contenteditable='true']");
    if (editCell && event.key === "Enter") {
      event.preventDefault();
      editCell.blur();
      return;
    }
    if (event.key !== "Escape") return;
    hideEvidencePopover();
    closeEvidenceViewer();
    closeManualInputPanel();
  });

  function applySelectedPlanResults(options = {}) {
    if (!selectedPlanControls().length) {
      if (!options.quiet) {
        status("반영할 검토 작업을 하나 이상 선택하세요.", true);
        focusEditPlan();
      }
      return false;
    }
    planExecutionResults = calculateSelectedPlanResults();
    reportStorageState = "idle";
    reportStorageError = "";
    runBuildResultStep({ quiet: true });
    renderEditCalculationReview();
    if (!options.quiet) status("✅ 선택한 검토 작업 결과를 계산표와 리포트에 반영했습니다.");
    if (options.openResult !== false) openCard(9, true);
    return true;
  }

  async function executeSelectedPlans() {
    const applied = applySelectedPlanResults();
    if (!applied) return;
    if (!requireExecutionHumanInputs()) return;
    if (!requireReportReadyForStorage()) return;
    const btn = $("btnExecutePlans");
    const original = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = "검토 기록 보관 중..."; }
    setEditStepState("report", "running");
    try {
      await runPlanRunsStep({ quiet: true });
      await runExecutionArtifactStep({ quiet: true, skipPlanRuns: true });
      runBuildResultStep({ quiet: true });
      setEditStepState("report", "done");
      status("✅ 선택한 검토 작업 결과를 서버 검토 기록으로 보관했습니다.");
    } catch (err) {
      setEditStepState("report", "failed");
      status("⚠️ 결과는 반영했지만 서버 검토 기록 보관에 실패했습니다: " + err.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = original || "계산표 다시 반영"; }
      renderEditCalculationReview();
    }
  }

  async function runEditAnalysisSequence() {
    const btn = $("btnRunAnalysisEdit");
    if (!btn) return;
    const originalText = btn.textContent;
    const warnings = [];
    const notes = [];
    const progress = (message, err) => {
      setEditRunProgress(message, err);
      status(`${err ? "⚠️ " : ""}${message}`, err);
    };
    const safeStep = async (label, fn) => {
      const stepKey = editStepForLabel(label);
      setEditStepState(stepKey, "running");
      progress(`${label} 진행 중...`);
      try {
        const result = await fn();
        if (result === false) notes.push(`${label} 생략`);
        setEditStepState(stepKey, result === false ? "skipped" : "done");
        return result;
      } catch (err) {
        warnings.push(`${label} 실패: ${err.message}`);
        setEditStepState(stepKey, "failed");
        return false;
      }
    };

    btn.disabled = true;
    btn.textContent = "분석 실행 중...";
    try {
      progress("자료 준비 확인 중...");
      await ensureAnalysisReady();
      setGate(true);

      const parsed = await parseAnalysisCostFiles({ silentNoFiles: true });
      if (parsed === null) warnings.push("Excel 자동 반영 실패");

      await safeStep("AI 멀티스테이지 분석", () => runAnalysisPipelineStream(progress));

      if (costAll.length) {
        await safeStep("계산식 만들기", () => runBoardStep({ openNext: false, quiet: true }));
        await safeStep("단가 산식 후보", () => runHeuristicStep({ openNext: false, quiet: true }));
        await safeStep("상세 보고서", () => runDeepReportStep({ openNext: false, quiet: true }));
        await safeStep("근거 연결", () => runEvidenceStep({ openNext: false, quiet: true }));
        await safeStep("검토표", () => {
          const ok = runValidationStep({ quiet: true });
          if (ok) applyValidationSummary({ quiet: true });
          return ok;
        });
      } else {
        notes.push("표/수치 자료 없음으로 수치 기반 항목 생략");
      }

      const planApplied = await safeStep("작업 목록 반영", () => applySelectedPlanResults({ quiet: true, openResult: false }));
      if (!planApplied) runBuildResultStep({ quiet: true });
      await safeStep("리트리버 후보 준비", () => prefetchRetrieverCandidatesForPending());
      if (!requireExecutionHumanInputs()) {
        setEditStepState("report", "skipped");
        progress("실행 전 담당자 입력 확정이 필요합니다.", true);
        return;
      }
      if (!requireReportReadyForStorage()) {
        setEditStepState("report", "skipped");
        progress("검토가 끝나지 않은 결과가 있어 서버 보관을 시작하지 않았습니다.", true);
        return;
      }
      if (planApplied) await safeStep("플랜별 검토 기록", () => runPlanRunsStep({ quiet: true }));
      const reportStored = await safeStep("검토 기록 서버 보관", async () => {
        await runExecutionArtifactStep({ quiet: true, skipPlanRuns: true });
        runBuildResultStep({ quiet: true });
        return true;
      });
      if (!reportStored) {
        setEditStepState("report", "failed");
        openCard(9, true);
        progress("결과 리포트 초안은 남아 있지만 서버 검토 기록 보관에 실패했습니다. 오류를 확인한 뒤 다시 시도하세요.", true);
        return;
      }
      openCard(9, true);

      const suffix = warnings.length
        ? `확인 필요: ${warnings.slice(0, 3).join(" · ")}${warnings.length > 3 ? " 외" : ""}`
        : (notes.length ? notes.join(" · ") : "AI 검토 작업 결과까지 반영했습니다.");
      const finalMessage = `현재 검토 결과를 서버에 기록했습니다. ${suffix}`;
      progress(finalMessage, warnings.length > 0);
    } catch (err) {
      setEditRunProgress(`분석 실행 실패: ${err.message}`, true);
      status("❌ 분석 실행 실패: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  const runEditBtn = $("btnRunAnalysisEdit");
  if (runEditBtn) runEditBtn.addEventListener("click", runEditAnalysisSequence);
  $("btnExecutePlans")?.addEventListener("click", executeSelectedPlans);
  $("btnExportReportCsv")?.addEventListener("click", downloadReportExcel);
  initIdentityScopedPrep();

  // 분석-only 작업이 자연스럽게 시작되도록 작업공간·자료 준비를 기본으로 펼친다.
  const query = new URLSearchParams(location.search);
  const restoreId = query.get("session");
  const meetingId = query.get("meeting");
  if (restoreId) restoreAnalysisSession(restoreId);
  else if (meetingId) {
    showMeetingPicker(false);
    void pickMeeting(meetingId, null);
  } else openCard(5);
  }
  if (window.__sduiRegisterBoot) window.__sduiRegisterBoot("analysis-edit", bootAnalysisEdit2);
  else bootAnalysisEdit2();
})();
