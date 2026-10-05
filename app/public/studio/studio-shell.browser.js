import {
  GARDEN_FIXTURE_PATH, approveStudioAiPatch, applyStudioThemePreset, createStudioShellViewModel,
  createStudioWebState, deleteStudioElement, duplicateStudioElement, insertStudioElement,
  moveStudioElement, rejectStudioAiPatch, renderStudioShellHtml, renderVersionResults, resetStudioElementStyle,
  resetStudioTheme, resetStudioThemeToken, selectStudioElement, selectStudioPage, setStudioCloudState,
  setStudioLocale, setStudioPreviewState, setStudioThemeScope, stageStudioAiPatch, undoStudioAiPatch,
  updateSelectedPage, updateStudioElementProps, updateStudioElementStyle, updateStudioNodeInteractionJson,
  updateStudioPageStateJson, updateThemeToken,
} from "../src/studio-web-shell.js";
import { createSketchPad } from "./sketch-pad.browser.js";
import { installInteractionRuntime } from "../src/interaction-runtime.js";
import { BUNDLED_TEMPLATE_CATALOG, catalogCompatibility, createCatalogImport, filterCatalog } from "../src/template-catalog.js";
import { normalizePublishSlug, publishedReleaseUrls } from "../src/publish-release.js";
import { createReferenceImageEditor } from "./reference-image.browser.js";

const root = document.querySelector("#studio-root");
const loadGardenButton = document.querySelector("#load-garden");
const manifestFileInput = document.querySelector("#manifest-file");
const status = document.querySelector("#studio-status");
const themeToggle = document.querySelector("[data-theme-toggle]");
const templateLibrary = document.querySelector("#template-library");
const catalogList = templateLibrary.querySelector("[data-catalog-list]");
const catalogDetail = templateLibrary.querySelector("[data-catalog-detail]");
let studioState = null;
let originalManifest = null;
let studioApiKey = "";
let aiProvider = "openai";
let aiProviderKey = "";
let pastStates = [];
let futureStates = [];
let versionPage = 1;
const VERSION_PAGE_SIZE = 5;
let sketchRuntime = null;
let sketchTrigger = null;
let sketchSubmitting = false;
let disposeInteractions = null;
let catalogItems = [];
let selectedCatalogId = null;
let referenceDraft = null;
let referenceEditor = null;
let referenceTrigger = null;

const STATUS_TEXT = {
  Ready: "편집할 준비가 되었습니다",
  Reset: "처음 상태로 되돌렸습니다",
  "Loading Garden": "예제를 불러오는 중입니다…",
  "Garden fixture": "예제를 불러왔습니다",
};
const setStatus = (message) => { status.textContent = STATUS_TEXT[message] || message; };

function setStudioChromeTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  themeToggle?.setAttribute("aria-pressed", String(next === "dark"));
  if (themeToggle) themeToggle.textContent = next === "dark" ? "라이트 모드" : "다크 모드";
  try { localStorage.setItem("sdui-studio-theme", next); } catch { /* storage may be disabled */ }
}

try { setStudioChromeTheme(localStorage.getItem("sdui-studio-theme") || "light"); } catch { setStudioChromeTheme("light"); }
themeToggle?.addEventListener("click", () => setStudioChromeTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

function render() {
  if (!studioState) return;
  // A full innerHTML swap discards any open <dialog>. Capture its state first, then
  // reopen the freshly rendered dialog so background re-renders never close the modal.
  const versionDialogWasOpen = Boolean(root.querySelector("[data-version-dialog]")?.open);
  const model = createStudioShellViewModel(studioState);
  root.innerHTML = renderStudioShellHtml(model);
  const referenceButton = document.createElement("button"); referenceButton.type = "button"; referenceButton.dataset.openReference = ""; referenceButton.textContent = "레퍼런스 참조";
  root.querySelector(".ai-input-actions")?.append(referenceButton);
  const referenceAttachment = document.createElement("div"); referenceAttachment.className = "reference-attachment"; referenceAttachment.dataset.referenceAttachment = "";
  if (referenceDraft) {
    const thumbnail = document.createElement("img"); thumbnail.src = referenceDraft.dataUrl; thumbnail.alt = "첨부한 레퍼런스 미리보기"; referenceAttachment.append(thumbnail);
    const copy = document.createElement("div"); appendTextElement(copy, "strong", referenceDraft.fileName); appendTextElement(copy, "small", `${referenceDraft.originalWidth}×${referenceDraft.originalHeight}`); appendTextElement(copy, "p", referenceDraft.description || "설명 없음"); referenceAttachment.append(copy);
    const actions = document.createElement("div"); const edit = appendTextElement(actions, "button", "다시 편집"); edit.type = "button"; edit.dataset.openReference = ""; const remove = appendTextElement(actions, "button", "제거"); remove.type = "button"; remove.dataset.removeReference = ""; referenceAttachment.append(actions);
  } else appendTextElement(referenceAttachment, "p", "첨부한 레퍼런스가 없습니다.", "muted");
  root.querySelector(".ai-input-actions")?.after(referenceAttachment);
  const referenceDialog = document.createElement("dialog"); referenceDialog.className = "reference-dialog"; referenceDialog.dataset.referenceDialog = ""; referenceDialog.setAttribute("aria-labelledby", "reference-dialog-title");
  referenceDialog.innerHTML = `<div class="reference-dialog-header"><div><h2 id="reference-dialog-title">레퍼런스 이미지 편집</h2><p>이미지를 이동하거나 확대해 참고할 영역을 맞추세요.</p></div><button type="button" data-close-reference aria-label="레퍼런스 창 닫기">×</button></div><div class="reference-workspace"><section class="reference-canvas-panel" data-reference-dropzone><canvas data-reference-canvas width="640" height="480" aria-label="레퍼런스 이미지 자르기 영역"></canvas><p data-reference-status>이미지를 놓거나 선택하세요</p><input type="file" data-reference-file accept="image/png,image/jpeg,image/webp"><div class="reference-tools"><label>확대·축소 <input type="range" data-reference-zoom min="0.5" max="3" step="0.05" value="1"></label><button type="button" data-reference-reset>원본비율 복원</button><button type="button" data-reference-replace>교체</button><button type="button" data-reference-delete>삭제</button></div></section><section><label><strong>참조 설명</strong><textarea data-reference-description maxlength="2000" placeholder="예: 색감과 카드 밀도만 참고하고 로고와 문구는 복제하지 마세요."></textarea></label><p class="muted">요구사항이 레퍼런스보다 우선하며 로고·상표·개인정보·비밀값은 복제하지 않습니다.</p></section></div><div class="reference-dialog-actions"><button type="button" data-close-reference>취소</button><button type="button" class="primary-action" data-attach-reference>AI 입력에 첨부</button></div>`;
  root.append(referenceDialog);
  const cloudControls = root.querySelector(".cloud-controls");
  const slugLabel = document.createElement("label");
  slugLabel.className = "publish-slug-control";
  slugLabel.textContent = "URL 이름";
  const slugInput = document.createElement("input");
  slugInput.dataset.publishSlug = "";
  slugInput.value = model.cloud.publishSlug || model.cloud.pageId || "default";
  slugLabel.append(slugInput);
  const slugPreview = document.createElement("small");
  slugPreview.dataset.publishUrlPreview = "";
  slugLabel.append(slugPreview);
  cloudControls.prepend(slugLabel);
  const updatePublishPreview = () => {
    const slug = normalizePublishSlug(slugInput.value, model.cloud.pageId || "default");
    slugPreview.textContent = `${window.location.origin}/p/${encodeURIComponent(model.cloud.projectId)}/${encodeURIComponent(model.cloud.pageId)}/${encodeURIComponent(slug)}/`;
  };
  updatePublishPreview();
  root.querySelector(".publish-result")?.remove();
  if (model.cloud.publishedUrl) {
    const result = document.createElement("div"); result.className = "publish-result";
    for (const [label, url] of [["최신 URL", model.cloud.publishedUrl], ["버전 고정 URL", model.cloud.versionedPublishedUrl]]) {
      const row = document.createElement("div"); appendTextElement(row, "strong", label); const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener"; link.textContent = url; row.append(link); const copy = appendTextElement(row, "button", "URL 복사"); copy.type = "button"; copy.dataset.copyReleaseUrl = url; row.append(copy); result.append(row);
    }
    root.querySelector(".cloud-panel").append(result);
  }
  const interactionPanel = document.createElement("section");
  interactionPanel.className = "panel interaction-panel";
  interactionPanel.dataset.testid = "interaction-panel";
  const heading = document.createElement("h2");
  heading.textContent = "동작/인터랙션";
  const intro = document.createElement("p");
  intro.className = "panel-intro";
  intro.textContent = "AI가 만든 선언형 상태와 선택 항목 동작을 확인하고 미세 조정합니다. JavaScript는 실행할 수 없습니다.";
  const stateLabel = document.createElement("label");
  stateLabel.textContent = "화면 상태(JSON)";
  const stateInput = document.createElement("textarea");
  stateInput.dataset.pageStateJson = "";
  stateInput.value = JSON.stringify(model.editor.state, null, 2);
  stateLabel.append(stateInput);
  const nodeLabel = document.createElement("label");
  nodeLabel.textContent = "선택 항목 동작(JSON)";
  const nodeInput = document.createElement("textarea");
  nodeInput.dataset.nodeInteractionJson = "";
  nodeInput.disabled = !model.editor.selectedNode;
  const selected = model.editor.selectedNode || {};
  nodeInput.value = JSON.stringify(Object.fromEntries(Object.entries({ events: selected.events, visibleWhen: selected.visibleWhen, enabledWhen: selected.enabledWhen, transition: selected.transition }).filter(([, value]) => value !== undefined)), null, 2);
  nodeLabel.append(nodeInput);
  interactionPanel.append(heading, intro, stateLabel, nodeLabel);
  root.querySelector("[data-ai-panel]").before(interactionPanel);
  disposeInteractions?.();
  disposeInteractions = installInteractionRuntime(root.querySelector("[data-testid='element-canvas']"), model.editor.state, {
    navigate: (route) => {
      const page = studioState.manifest.pages.find((candidate) => candidate.route === route);
      if (page) update((state) => selectStudioPage(state, page.id));
    },
  });
  loadGardenButton.textContent = "예제 불러오기";
  document.querySelector("#reset-manifest").textContent = "처음 상태로";
  if (versionDialogWasOpen) root.querySelector("[data-version-dialog]")?.showModal();
}

// Patch only the version list/pagination so filter inputs keep focus during typing.
function renderVersionList() {
  const container = root.querySelector("[data-version-results]");
  if (container) container.innerHTML = renderVersionResults(createStudioShellViewModel(studioState).cloud);
}

function update(mutator) {
  const previous = studioState;
  const next = mutator(studioState);
  if (previous && next.manifest !== previous.manifest) {
    pastStates = [...pastStates.slice(-49), previous];
    futureStates = [];
  }
  studioState = next;
  render();
}

function historyAction(action) {
  if (action === "undo" && pastStates.length) {
    futureStates.push(studioState);
    studioState = pastStates.pop();
  } else if (action === "redo" && futureStates.length) {
    pastStates.push(studioState);
    studioState = futureStates.pop();
  }
  render();
}

function authHeaders(json = false) {
  return { ...(json ? { "content-type": "application/json" } : {}), "x-studio-actor": "web-studio" };
}

async function fetchAi(body) {
  if (!aiProviderKey) throw new Error("선택한 AI 제공자의 API 키를 입력해 주세요.");
  return fetch("../api/ai/assist", { method: "POST", headers: { "content-type": "application/json", "x-ai-provider": aiProvider, "x-ai-provider-key": aiProviderKey }, body: JSON.stringify(body) });
}

async function cloudAction(action) {
  const projectId = root.querySelector("[data-project-id]")?.value.trim() || studioState.projectId;
  const endpoint = `../api/projects/${encodeURIComponent(projectId)}`;
  setStatus("클라우드 작업을 처리하는 중입니다…");
  if (action === "save") {
    const response = await fetch(`${endpoint}/manifest`, { method: "PUT", headers: authHeaders(true), body: JSON.stringify({ manifest: studioState.manifest, expectedVersion: studioState.projectVersion, label: "Studio save" }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "저장하지 못했습니다");
    update((state) => setStudioCloudState(state, { projectId, projectVersion: result.version, cloudStatus: `버전 ${result.version}으로 저장했습니다`, dirty: false }));
  } else if (action === "publish") {
    const pageId = studioState.selectedPageId || studioState.manifest.pages?.[0]?.id;
    const slug = normalizePublishSlug(root.querySelector("[data-publish-slug]")?.value, pageId || "default");
    let manifestVersion = studioState.projectVersion;
    if (studioState.dirty || !manifestVersion) {
      const saveResponse = await fetch(`${endpoint}/manifest`, { method: "PUT", headers: authHeaders(true), body: JSON.stringify({ manifest: studioState.manifest, expectedVersion: studioState.projectVersion, label: "Published from Studio" }) });
      const saved = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saved.error?.message || "배포할 버전을 저장하지 못했습니다");
      manifestVersion = saved.version;
    }
    const response = await fetch(`${endpoint}/deployments`, { method: "POST", headers: authHeaders(true), body: JSON.stringify({ pageId, slug, manifestVersion }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "배포하지 못했습니다");
    const urls = publishedReleaseUrls(window.location.origin, result);
    update((state) => setStudioCloudState(state, { projectId, projectVersion: manifestVersion, publishSlug: result.slug, publishedUrl: urls.latestUrl, versionedPublishedUrl: urls.versionedUrl, releaseVersion: result.releaseVersion, cloudStatus: `릴리스 v${result.releaseVersion}을 배포했습니다`, dirty: false }));
  } else if (action === "load") {
    const response = await fetch(`${endpoint}/manifest`, { headers: authHeaders() });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "프로젝트를 불러오지 못했습니다");
    root.querySelector("[data-version-dialog]")?.close();
    studioState = createStudioWebState(result.manifest, { projectId, projectVersion: result.version });
    studioState = setStudioCloudState(studioState, { cloudStatus: `버전 ${result.version}을 불러왔습니다` });
    render();
  } else {
    const search = root.querySelector("[data-version-search]")?.value.trim() || "";
    const user = root.querySelector("[data-version-user]")?.value.trim() || "";
    const from = root.querySelector("[data-version-from]")?.value || "";
    const to = root.querySelector("[data-version-to]")?.value || "";
    const excludeCurrent = root.querySelector("[data-version-exclude-current]")?.checked || false;
    // Capture intent before the request: an already-open dialog means "refresh in place",
    // a closed one means "open now". Reading it after the await would let a dialog the user
    // closed mid-request spring back open.
    const isRefresh = Boolean(root.querySelector("[data-version-dialog]")?.open);
    const params = new URLSearchParams({ page: String(versionPage), pageSize: String(VERSION_PAGE_SIZE), search, user, from, to, excludeCurrent: String(excludeCurrent) });
    const response = await fetch(`${endpoint}/versions?${params}`, { headers: authHeaders() });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "저장 기록을 불러오지 못했습니다");
    studioState = setStudioCloudState(studioState, { projectId, versions: result.versions, versionTotal: result.total, versionPage: result.page, versionSearch: search, versionUser: user, versionFrom: from, versionTo: to, versionExcludeCurrent: excludeCurrent, cloudStatus: `저장 기록 ${result.total}개` });
    if (isRefresh) renderVersionList();
    else { render(); root.querySelector("[data-version-dialog]")?.showModal(); }
  }
  setStatus("Ready");
}

async function loadVersion(version) {
  if (studioState.dirty && !window.confirm("저장하지 않은 변경이 있습니다. 이전 버전을 불러올까요?")) return;
  const projectId = root.querySelector("[data-project-id]")?.value.trim() || studioState.projectId;
  const response = await fetch(`../api/projects/${encodeURIComponent(projectId)}/versions/${version}`, { headers: authHeaders() });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "이전 버전을 불러오지 못했습니다");
  root.querySelector("[data-version-dialog]")?.close();
  pastStates.push(studioState);
  studioState = createStudioWebState(result.manifest, { projectId, projectVersion: result.version });
  studioState = setStudioCloudState(studioState, { dirty: true, cloudStatus: `버전 ${result.version}을 편집 상태로 열었습니다` });
  render();
}

async function previewVersion(version) {
  const projectId = root.querySelector("[data-project-id]")?.value.trim() || studioState.projectId;
  const response = await fetch(`../api/projects/${encodeURIComponent(projectId)}/versions/${version}`, { headers: authHeaders() });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "이전 버전을 미리 볼 수 없습니다");
  const preview = root.querySelector("[data-version-preview]");
  preview.hidden = false;
  preview.textContent = `버전 ${result.version} 미리보기 · ${result.manifest.name || result.manifest.id} · 화면 ${result.manifest.pages?.length || 0}개`;
}

async function requestAiChange() {
  const input = root.querySelector("[data-ai-prompt]")?.value.trim();
  if (!input) throw new Error("원하는 변경 내용을 문장으로 입력하세요");
  setStatus("AI 변경안을 만드는 중입니다…");
  const response = await fetchAi({ taskType: "screen-generate", plan: "ai-ops", feature: "ai-chat", input, reference: referenceDraft, manifest: studioState.manifest, dimensions: { project: studioState.projectId } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "AI 변경안을 만들지 못했습니다");
  update((state) => stageStudioAiPatch(state, result.patch));
  setStatus("AI 변경안을 검토해 주세요");
}

function initializeSketchCanvas() {
  const dialog = root.querySelector("[data-sketch-dialog]");
  const canvas = dialog?.querySelector("[data-sketch-canvas]");
  if (!dialog || !canvas) return;
  sketchRuntime?.destroy();
  sketchRuntime = createSketchPad({ canvas, colorInput: dialog.querySelector("[data-sketch-color]"), sizeInput: dialog.querySelector("[data-sketch-size]") });
}

function closeSketch(force = false) {
  const dialog = root.querySelector("[data-sketch-dialog]");
  const description = dialog?.querySelector("[data-sketch-description]")?.value.trim();
  if (!force && (description || sketchRuntime?.isDirty()) && !window.confirm("작성 중인 스케치와 설명을 닫을까요?")) return false;
  dialog?.close();
  sketchTrigger?.focus();
  return true;
}

async function openReferenceEditor(trigger) {
  const dialog = root.querySelector("[data-reference-dialog]");
  referenceTrigger = trigger;
  referenceEditor?.destroy();
  referenceEditor = createReferenceImageEditor({ canvas: dialog.querySelector("[data-reference-canvas]"), zoomInput: dialog.querySelector("[data-reference-zoom]"), status: dialog.querySelector("[data-reference-status]") });
  dialog.querySelector("[data-reference-description]").value = referenceDraft?.description || "";
  if (referenceDraft) await referenceEditor.loadReference(referenceDraft);
  dialog.showModal();
}

function closeReferenceEditor() {
  root.querySelector("[data-reference-dialog]")?.close();
  referenceTrigger?.focus();
}

async function loadReferenceFile(file) {
  if (file && referenceEditor) await referenceEditor.loadFile(file);
}

async function submitSketchAi() {
  if (sketchSubmitting) return;
  const dialog = root.querySelector("[data-sketch-dialog]");
  const description = dialog.querySelector("[data-sketch-description]").value.trim();
  if (!description && !sketchRuntime?.isDirty()) throw new Error("스케치 또는 기획 설명 중 하나 이상을 입력해 주세요.");
  const sketch = sketchRuntime?.isDirty() ? sketchRuntime.toPngDataUrl() : null;
  if (sketch && sketch.length > 750000) throw new Error("스케치 이미지가 너무 큽니다. 그림을 단순화한 뒤 다시 시도해 주세요.");
  const scope = dialog.querySelector("[data-sketch-scope]").value;
  const input = description || "첨부한 화면 스케치를 SDUI 화면으로 반영해 주세요.";
  const selection = { scope, pageId: studioState.selectedPageId, nodeId: scope === "selected-node" ? studioState.selectedNodeId : null };
  setStatus("스케치를 바탕으로 AI 변경안을 만드는 중입니다.");
  sketchSubmitting = true;
  const submit = dialog.querySelector("[data-submit-sketch]");
  submit.disabled = true;
  dialog.setAttribute("aria-busy", "true");
  try {
    const response = await fetchAi({ taskType: "screen-generate", plan: "ai-ops", feature: "ai-chat", input, sketch: sketch ? { mimeType: "image/png", width: 640, height: 480, dataUrl: sketch } : null, reference: referenceDraft, manifest: studioState.manifest, manifestVersion: studioState.projectVersion, selection, dimensions: { project: studioState.projectId } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "AI 변경안을 만들지 못했습니다.");
    closeSketch(true);
    update((state) => stageStudioAiPatch(state, result.patch));
    setStatus("AI 변경안을 검토해 주세요.");
  } finally {
    sketchSubmitting = false;
    submit.disabled = false;
    dialog.removeAttribute("aria-busy");
  }
}

root.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const canvasNode = event.target.closest("[data-node-id]");
  if (canvasNode) {
    event.preventDefault();
    update((state) => selectStudioElement(state, canvasNode.dataset.nodeId));
    return;
  }
  // Clicking the dialog element itself (not its content) means the backdrop was clicked.
  if (event.target.matches("[data-version-dialog]")) { event.target.close(); return; }
  if (!button) return;
  if (button.dataset.historyAction) historyAction(button.dataset.historyAction);
  else if (button.hasAttribute("data-scroll-preview")) root.querySelector(".editor-panel")?.scrollIntoView({ behavior: "smooth" });
  else if (button.dataset.pageId) update((state) => selectStudioPage(state, button.dataset.pageId));
  else if (button.dataset.nodeSelect) update((state) => selectStudioElement(state, button.dataset.nodeSelect));
  else if (button.dataset.insertElement) update((state) => insertStudioElement(state, button.dataset.insertElement));
  else if (button.dataset.resetToken) update((state) => resetStudioThemeToken(state, button.dataset.resetToken));
  else if (button.hasAttribute("data-reset-theme")) update(resetStudioTheme);
  else if (button.dataset.treeAction === "delete") update(deleteStudioElement);
  else if (button.dataset.treeAction === "duplicate") update(duplicateStudioElement);
  else if (["up", "down"].includes(button.dataset.treeAction)) update((state) => moveStudioElement(state, button.dataset.treeAction));
  else if (button.dataset.previewState) update((state) => setStudioPreviewState(state, button.dataset.previewState));
  else if (button.dataset.resetStyle) update((state) => resetStudioElementStyle(state, button.dataset.resetStyle));
  else if (button.dataset.cloudAction) cloudAction(button.dataset.cloudAction).catch((error) => { setStatus(error.message); update((state) => setStudioCloudState(state, { cloudStatus: error.message })); });
  else if (button.hasAttribute("data-open-versions")) { versionPage = 1; cloudAction("versions").catch((error) => setStatus(error.message)); }
  else if (button.dataset.loadVersion) loadVersion(button.dataset.loadVersion).catch((error) => setStatus(error.message));
  else if (button.dataset.previewVersion) previewVersion(button.dataset.previewVersion).catch((error) => setStatus(error.message));
  else if (button.hasAttribute("data-version-prev")) { versionPage = Math.max(1, versionPage - 1); cloudAction("versions").catch((error) => setStatus(error.message)); }
  else if (button.hasAttribute("data-version-next")) { versionPage += 1; cloudAction("versions").catch((error) => setStatus(error.message)); }
  else if (button.hasAttribute("data-ai-assist")) requestAiChange().catch((error) => setStatus(error.message));
  else if (button.hasAttribute("data-open-sketch")) {
    sketchTrigger = button;
    const dialog = root.querySelector("[data-sketch-dialog]");
    dialog.showModal();
    initializeSketchCanvas();
    requestAnimationFrame(() => dialog.querySelector("[data-sketch-description]")?.focus());
  } else if (button.hasAttribute("data-open-reference")) openReferenceEditor(button).catch((error) => setStatus(error.message));
  else if (button.hasAttribute("data-close-reference")) closeReferenceEditor();
  else if (button.hasAttribute("data-reference-reset")) referenceEditor?.resetView();
  else if (button.hasAttribute("data-reference-replace")) root.querySelector("[data-reference-file]")?.click();
  else if (button.hasAttribute("data-reference-delete")) referenceEditor?.remove();
  else if (button.hasAttribute("data-remove-reference")) { referenceDraft = null; render(); }
  else if (button.hasAttribute("data-attach-reference")) {
    try {
      const dialog = root.querySelector("[data-reference-dialog]");
      const next = referenceEditor?.toReference(dialog.querySelector("[data-reference-description]").value.trim());
      if (!next) throw new Error("레퍼런스 이미지를 선택하세요");
      referenceDraft = next; closeReferenceEditor(); render();
    } catch (error) { setStatus(error.message); }
  } else if (button.hasAttribute("data-close-sketch")) closeSketch();
  else if (button.dataset.sketchTool === "eraser" && sketchRuntime) {
    const enabled = button.getAttribute("aria-pressed") !== "true";
    sketchRuntime.setEraser(enabled);
    button.setAttribute("aria-pressed", String(enabled));
  } else if (button.dataset.sketchAction === "undo" && sketchRuntime) sketchRuntime.undo();
  else if (button.dataset.sketchAction === "clear" && sketchRuntime) sketchRuntime.clear();
  else if (button.hasAttribute("data-submit-sketch")) submitSketchAi().catch((error) => { setStatus(error.message); root.querySelector("[data-sketch-status]").textContent = error.message; });
  else if (button.dataset.copyReleaseUrl) navigator.clipboard.writeText(button.dataset.copyReleaseUrl).then(() => setStatus("URL을 복사했습니다"));
  else if (button.hasAttribute("data-copy-published-url")) { const url = root.querySelector(".publish-result a")?.href; if (url) navigator.clipboard.writeText(url).then(() => setStatus("배포 URL을 복사했습니다")); }
  else if (button.hasAttribute("data-copy-developer-info")) navigator.clipboard.writeText(button.closest("details").innerText).then(() => setStatus("개발 담당자 전달 정보를 복사했습니다"));
  else if (button.dataset.themeQuick) update((state) => updateThemeToken(state, button.dataset.themeQuick, button.dataset.themeValue));
  else if (button.hasAttribute("data-stage-ai-patch")) {
    try {
      const patch = JSON.parse(root.querySelector("[data-ai-patch]").value);
      update((state) => stageStudioAiPatch(state, patch));
    } catch (error) { setStatus(error.message); }
  } else if (button.dataset.reviewAction === "approve") update(approveStudioAiPatch);
  else if (button.dataset.reviewAction === "reject") update((state) => rejectStudioAiPatch(state, "Rejected in Studio"));
  else if (button.dataset.reviewAction === "undo") update(undoStudioAiPatch);
});

root.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-ai-provider]")) aiProvider = target.value;
  else if (target.matches("[data-reference-file]")) loadReferenceFile(target.files?.[0]).catch((error) => setStatus(error.message));
  else if (target.matches("[data-locale-selector]")) update((state) => setStudioLocale(state, target.value));
  else if (target.matches("[data-theme-token]")) update((state) => updateThemeToken(state, target.dataset.themeToken, target.value));
  else if (target.matches("[data-theme-range]")) update((state) => updateThemeToken(state, target.dataset.themeRange, `${target.value}px`));
  else if (target.matches("[data-theme-preset]") && target.value) update((state) => applyStudioThemePreset(state, target.value));
  else if (target.matches("[data-theme-scope]")) update((state) => setStudioThemeScope(state, target.checked));
  else if (target.matches("[data-node-prop]")) update((state) => updateStudioElementProps(state, target.dataset.nodeProp, target.value));
  else if (target.matches("[data-node-style-default]")) update((state) => updateStudioElementStyle(state, target.dataset.nodeStyleDefault, target.value, "default"));
  else if (target.matches("[data-node-style]") && target.value) update((state) => updateStudioElementStyle(state, target.dataset.nodeStyle, target.value));
  else if (target.matches("[data-page-state-json]")) update((state) => updateStudioPageStateJson(state, target.value));
  else if (target.matches("[data-node-interaction-json]")) update((state) => updateStudioNodeInteractionJson(state, target.value));
  else if (target.matches("[data-style-token]") && target.value) update((state) => updateStudioElementStyle(state, target.dataset.styleToken, target.value));
});

root.addEventListener("input", (event) => {
  if (event.target.matches("[data-ai-provider-key]")) aiProviderKey = event.target.value;
  else if (event.target.matches("[data-publish-slug]")) {
    const preview = root.querySelector("[data-publish-url-preview]");
    const projectId = root.querySelector("[data-project-id]")?.value.trim() || studioState.projectId;
    const pageId = studioState.selectedPageId || studioState.manifest.pages?.[0]?.id || "default";
    preview.textContent = `${window.location.origin}/p/${encodeURIComponent(projectId)}/${encodeURIComponent(pageId)}/${encodeURIComponent(normalizePublishSlug(event.target.value, pageId))}/`;
  }
  else if (event.target.matches("[data-version-search], [data-version-user], [data-version-from], [data-version-to], [data-version-exclude-current]")) {
    versionPage = 1;
    clearTimeout(root.versionFilterTimer);
    root.versionFilterTimer = setTimeout(() => cloudAction("versions").catch((error) => setStatus(error.message)), 250);
  }
});

root.addEventListener("cancel", (event) => {
  if (event.target.matches("[data-sketch-dialog]")) { event.preventDefault(); closeSketch(); }
  if (event.target.matches("[data-reference-dialog]")) { event.preventDefault(); closeReferenceEditor(); }
});

root.addEventListener("dragover", (event) => { if (event.target.closest("[data-reference-dropzone]")) event.preventDefault(); });
root.addEventListener("drop", (event) => {
  if (!event.target.closest("[data-reference-dropzone]")) return;
  event.preventDefault();
  loadReferenceFile(event.dataTransfer?.files?.[0]).catch((error) => setStatus(error.message));
});

document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.shiftKey) return;
  const dialog = root.querySelector("[data-sketch-dialog]");
  if (!dialog?.open || !sketchRuntime || sketchSubmitting) return;
  event.preventDefault();
  sketchRuntime.undo();
  root.querySelector("[data-sketch-status]").textContent = "스케치를 이전 상태로 되돌렸습니다.";
});

function openManifest(manifest, sourceLabel) {
  originalManifest = structuredClone(manifest);
  studioState = createStudioWebState(manifest, { adapter: "cloudflare-worker-static" });
  pastStates = [];
  futureStates = [];
  setStatus(sourceLabel);
  render();
}

function appendTextElement(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function renderCatalogDetail(item) {
  catalogDetail.replaceChildren();
  if (!item) { appendTextElement(catalogDetail, "p", "템플릿을 선택하면 상세 미리보기와 호환성 결과가 표시됩니다.", "muted"); return; }
  appendTextElement(catalogDetail, "div", item.entry.thumbnail, "template-detail-thumbnail");
  appendTextElement(catalogDetail, "h3", item.entry.title);
  appendTextElement(catalogDetail, "p", item.entry.description);
  appendTextElement(catalogDetail, "span", item.compatibility.label, `catalog-status is-${item.compatibility.status}`);
  const summary = item.compatibility.report?.summary;
  if (summary) appendTextElement(catalogDetail, "p", `화면 ${summary.pageCount}개 · 플러그인 ${summary.pluginCount}개 · 로케일 ${summary.localeCount}개`, "muted");
  appendTextElement(catalogDetail, "p", `출처 ${item.entry.project} · ${item.manifest.id} v${item.manifest.version}`, "muted");
  const tags = document.createElement("div"); tags.className = "catalog-tags";
  item.entry.tags.forEach((tag) => appendTextElement(tags, "span", tag)); catalogDetail.append(tags);
  const importButton = appendTextElement(catalogDetail, "button", "독립 복사본으로 가져오기");
  importButton.type = "button"; importButton.dataset.importCatalog = item.entry.id; importButton.disabled = item.compatibility.status === "unsupported";
}

function renderCatalog() {
  const query = templateLibrary.querySelector("[data-catalog-search]").value;
  const project = templateLibrary.querySelector("[data-catalog-project]").value;
  const visible = filterCatalog(catalogItems.map((item) => item.entry), { query, project });
  if (!visible.some((entry) => entry.id === selectedCatalogId)) selectedCatalogId = visible[0]?.id || null;
  catalogList.replaceChildren();
  visible.forEach((entry) => {
    const item = catalogItems.find((candidate) => candidate.entry.id === entry.id);
    const button = document.createElement("button"); button.type = "button"; button.className = `template-card${entry.id === selectedCatalogId ? " is-selected" : ""}`; button.dataset.catalogId = entry.id;
    appendTextElement(button, "span", entry.thumbnail, "template-card-thumbnail");
    const copy = document.createElement("span"); appendTextElement(copy, "strong", entry.title); appendTextElement(copy, "small", `${entry.project} · ${entry.tags.join(" · ")}`); appendTextElement(copy, "small", item.compatibility.label, `catalog-status is-${item.compatibility.status}`); button.append(copy); catalogList.append(button);
  });
  renderCatalogDetail(catalogItems.find((item) => item.entry.id === selectedCatalogId));
}

async function loadTemplateCatalog() {
  if (!catalogItems.length) catalogItems = await Promise.all(BUNDLED_TEMPLATE_CATALOG.map(async (entry) => {
    const response = await fetch(entry.manifestPath, { cache: "no-store" });
    if (!response.ok) throw new Error(`Catalog manifest failed: ${response.status}`);
    const manifest = await response.json();
    return { entry, manifest, compatibility: catalogCompatibility(manifest) };
  }));
  const projectSelect = templateLibrary.querySelector("[data-catalog-project]");
  if (projectSelect.options.length === 1) [...new Set(catalogItems.map((item) => item.entry.project))].forEach((project) => { const option = document.createElement("option"); option.value = project; option.textContent = project; projectSelect.append(option); });
  selectedCatalogId ||= catalogItems[0]?.entry.id || null;
  renderCatalog();
}

document.querySelector("#open-template-library").addEventListener("click", async () => {
  try { await loadTemplateCatalog(); templateLibrary.showModal(); } catch (error) { setStatus(error.message); }
});
templateLibrary.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.hasAttribute("data-close-template-library")) templateLibrary.close();
  else if (target.dataset.templateTab) {
    templateLibrary.querySelectorAll("[data-template-tab]").forEach((tab) => tab.setAttribute("aria-selected", String(tab === target)));
    templateLibrary.querySelectorAll("[data-template-panel]").forEach((panel) => { panel.hidden = panel.dataset.templatePanel !== target.dataset.templateTab; });
  } else if (target.hasAttribute("data-open-manifest-file")) manifestFileInput.click();
  else if (target.dataset.catalogId) { selectedCatalogId = target.dataset.catalogId; renderCatalog(); }
  else if (target.dataset.importCatalog) {
    const item = catalogItems.find((candidate) => candidate.entry.id === target.dataset.importCatalog);
    const imported = createCatalogImport(item.manifest, item.entry, { targetAdapter: "cloudflare-worker-static" });
    openManifest(imported, `${item.entry.title} copy`); templateLibrary.close();
  }
});
templateLibrary.addEventListener("input", (event) => { if (event.target.matches("[data-catalog-search], [data-catalog-project]")) renderCatalog(); });

async function loadGardenFixture() {
  setStatus("Loading Garden");
  const response = await fetch(GARDEN_FIXTURE_PATH, { cache: "no-store" });
  if (!response.ok) throw new Error(`Garden fixture failed: ${response.status}`);
  openManifest(await response.json(), "Garden fixture");
}

loadGardenButton.addEventListener("click", () => loadGardenFixture().catch((error) => setStatus(error.message)));
manifestFileInput.addEventListener("change", async () => {
  const file = manifestFileInput.files?.[0];
  if (!file) return;
  try {
    const manifest = JSON.parse(await file.text());
    const compatibility = catalogCompatibility(manifest);
    if (compatibility.status === "unsupported") throw new Error(compatibility.validation.issues[0].message);
    openManifest(manifest, file.name); templateLibrary.close();
  } catch (error) { setStatus(error.message); }
});
document.querySelector("#reset-manifest").addEventListener("click", () => { if (originalManifest) openManifest(originalManifest, "Reset"); });
loadGardenFixture().catch((error) => setStatus(error.message));
