import { getManifestI18n, hasI18n, pageTitleKey, setLocaleMessage } from "./i18n.js";
import { applyPageEdit, createStudioSession } from "./studio-session.js";
import {
  applyThemePreset, resetTheme, resetThemeToken, setApplyToAllScreens, setThemeToken,
} from "./theme-tokens.js";
import {
  BASE_ELEMENT_REGISTRY, BASE_ELEMENT_TYPES, STYLE_PROPERTIES, deleteElement, duplicateElement,
  elementStyleToCss, findElement, flattenElements, insertElement, moveElement, renameElement,
  resetElementStyle, resolveElementStyle, setElementStyle, updateElement,
} from "./base-elements.js";
import { approveAiPatchReview, createAiPatchReview, rejectAiPatchReview, undoAiPatchReview } from "./ai-patch-review.js";
import { diffStudioManifests, migrateStudioManifest, validateStudioManifest } from "./manifest-versioning.js";
import { interactionAttributes, interactionTransitionCss } from "./interaction-runtime.js";

export const GARDEN_FIXTURE_PATH = "../examples/garden-knowledge-base/template.manifest.json";
const asArray = (value) => Array.isArray(value) ? value : [];
const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const firstPageId = (manifest) => asArray(manifest.pages)[0]?.id || null;

function refreshSession(state) {
  const session = createStudioSession(state.manifest, { adapter: state.adapter, missingFiles: state.missingFiles, locale: state.locale });
  return { ...state, locale: session.i18n.selectedLocale, session };
}

function selectedPageFromManifest(state) {
  return asArray(state.manifest.pages).find((page) => page.id === state.selectedPageId) || asArray(state.manifest.pages)[0] || null;
}

function selectedEditorPage(state) {
  return asArray(state.session.editor.pages).find((page) => page.id === state.selectedPageId) || state.session.editor.pages[0] || null;
}

function numberedElements(nodes, prefix = "") {
  return asArray(nodes).flatMap((node, index) => {
    const number = prefix ? `${prefix}-${index + 1}` : `${index + 1}`;
    return [{ node, depth: number.split("-").length - 1, number }, ...numberedElements(node.children, number)];
  });
}

function updatePageNodes(state, nodes, selectedNodeId = state.selectedNodeId) {
  const manifest = applyPageEdit(state.manifest, state.selectedPageId, { nodes });
  return refreshSession({ ...state, manifest, selectedNodeId, dirty: true });
}

function fieldValue(page, path) {
  return page?.editableFields.find((field) => field.path === path)?.value || "";
}

function applyStudioPagePatch(state, page, patch) {
  const { title, ...pagePatch } = patch;
  let manifest = Object.keys(pagePatch).length ? applyPageEdit(state.manifest, page.id, pagePatch) : state.manifest;
  if (title !== undefined) {
    const i18n = getManifestI18n(manifest, state.locale);
    manifest = hasI18n(manifest) && i18n.selectedLocale
      ? setLocaleMessage(manifest, i18n.selectedLocale, pageTitleKey(page.id), title)
      : applyPageEdit(manifest, page.id, { title });
  }
  return manifest;
}

export function createStudioWebState(manifest, options = {}) {
  const themeConfigured = Boolean(manifest?.theme);
  const workingManifest = migrateStudioManifest(options.clone === false ? manifest : cloneJson(manifest));
  const pageId = options.selectedPageId || firstPageId(workingManifest);
  const page = workingManifest.pages.find((item) => item.id === pageId);
  const adapter = options.adapter || asArray(workingManifest.runtimeAdapters)[0] || "cloudflare-worker-static";
  const i18n = getManifestI18n(workingManifest, options.locale);
  return refreshSession({
    manifest: workingManifest,
    adapter,
    locale: options.locale || i18n.selectedLocale,
    missingFiles: options.missingFiles || [],
    selectedPageId: pageId,
    selectedNodeId: options.selectedNodeId || page?.nodes?.[0]?.id || null,
    previewState: "default",
    dirty: false,
    projectId: options.projectId || workingManifest.id,
    projectVersion: Number(options.projectVersion || 0),
    versions: [],
    versionTotal: 0,
    versionPage: 1,
    versionSearch: "",
    versionUser: "",
    versionFrom: "",
    versionTo: "",
    versionExcludeCurrent: false,
    cloudStatus: "Not saved",
    publishedUrl: "",
    publishSlug: "",
    versionedPublishedUrl: "",
    releaseVersion: 0,
    review: null,
    reviewBaseManifest: null,
    themeConfigured,
  });
}

export const setStudioLocale = (state, locale) => refreshSession({ ...state, locale });

export function selectStudioPage(state, pageId) {
  const page = asArray(state.manifest.pages).find((item) => item.id === pageId);
  return page ? refreshSession({ ...state, selectedPageId: pageId, selectedNodeId: page.nodes?.[0]?.id || null }) : state;
}

export function updateSelectedPage(state, patch) {
  const page = selectedPageFromManifest(state);
  if (!page) return state;
  return refreshSession({ ...state, manifest: applyStudioPagePatch(state, page, patch), selectedPageId: page.id, dirty: true });
}

export function updateThemeToken(state, path, value) {
  try { return refreshSession({ ...state, manifest: { ...state.manifest, theme: setThemeToken(state.manifest.theme, path, value) }, dirty: true, themeConfigured: true }); } catch { return state; }
}

export function resetStudioThemeToken(state, path) {
  return refreshSession({ ...state, manifest: { ...state.manifest, theme: resetThemeToken(state.manifest.theme, path) }, dirty: true });
}

export function resetStudioTheme(state) {
  return refreshSession({ ...state, manifest: { ...state.manifest, theme: resetTheme() }, dirty: true });
}

export function applyStudioThemePreset(state, preset) {
  try { return refreshSession({ ...state, manifest: { ...state.manifest, theme: applyThemePreset(preset) }, dirty: true }); } catch { return state; }
}

export function setStudioThemeScope(state, enabled) {
  return refreshSession({ ...state, manifest: { ...state.manifest, theme: setApplyToAllScreens(state.manifest.theme, enabled) }, dirty: true });
}

export const selectStudioElement = (state, nodeId) => findElement(selectedPageFromManifest(state)?.nodes, nodeId) ? { ...state, selectedNodeId: nodeId } : state;

export function insertStudioElement(state, type) {
  const page = selectedPageFromManifest(state);
  if (!page || !BASE_ELEMENT_REGISTRY[type]) return state;
  const result = insertElement(page.nodes, state.selectedNodeId, type);
  return updatePageNodes(state, result.nodes, result.inserted.id);
}

export function deleteStudioElement(state, nodeId = state.selectedNodeId) {
  const page = selectedPageFromManifest(state);
  const result = deleteElement(page?.nodes || [], nodeId);
  if (!result.deleted) return state;
  return updatePageNodes(state, result.nodes, result.nodes[0]?.id || null);
}

export function duplicateStudioElement(state, nodeId = state.selectedNodeId) {
  const page = selectedPageFromManifest(state);
  const result = duplicateElement(page?.nodes || [], nodeId);
  return result.duplicate ? updatePageNodes(state, result.nodes, result.duplicate.id) : state;
}

export function moveStudioElement(state, direction, nodeId = state.selectedNodeId) {
  const page = selectedPageFromManifest(state);
  return updatePageNodes(state, moveElement(page?.nodes || [], nodeId, direction));
}

export function renameStudioElement(state, name, nodeId = state.selectedNodeId) {
  const page = selectedPageFromManifest(state);
  return updatePageNodes(state, renameElement(page?.nodes || [], nodeId, name));
}

export function updateStudioElementProps(state, property, value, nodeId = state.selectedNodeId) {
  const page = selectedPageFromManifest(state);
  const node = findElement(page?.nodes, nodeId);
  if (!node) return state;
  return updatePageNodes(state, updateElement(page.nodes, nodeId, { props: { ...node.props, [property]: value } }));
}

export function updateStudioElementStyle(state, property, value, styleState = state.previewState, nodeId = state.selectedNodeId) {
  const page = selectedPageFromManifest(state);
  return updatePageNodes(state, setElementStyle(page?.nodes || [], nodeId, property, value, styleState));
}

export function resetStudioElementStyle(state, property, styleState = state.previewState, nodeId = state.selectedNodeId) {
  const page = selectedPageFromManifest(state);
  return updatePageNodes(state, resetElementStyle(page?.nodes || [], nodeId, property, styleState));
}

function applyValidatedInteractionEdit(state, manifest) {
  const validation = validateStudioManifest(manifest);
  return validation.valid ? refreshSession({ ...state, manifest: validation.manifest, dirty: true }) : { ...state, cloudStatus: validation.issues[0].message };
}

export function updateStudioPageStateJson(state, value) {
  try {
    const page = selectedPageFromManifest(state);
    const pageState = JSON.parse(value);
    if (!pageState || typeof pageState !== "object" || Array.isArray(pageState)) throw new Error("page state must be a JSON object");
    return applyValidatedInteractionEdit(state, applyPageEdit(state.manifest, page.id, { state: pageState }));
  } catch (error) { return { ...state, cloudStatus: error.message }; }
}

export function updateStudioNodeInteractionJson(state, value, nodeId = state.selectedNodeId) {
  try {
    const page = selectedPageFromManifest(state);
    const interaction = JSON.parse(value);
    if (!interaction || typeof interaction !== "object" || Array.isArray(interaction)) throw new Error("interaction must be a JSON object");
    const node = findElement(page?.nodes, nodeId);
    if (!node) return state;
    const allowedKeys = ["events", "visibleWhen", "enabledWhen", "transition"];
    const nextNode = { ...node };
    for (const key of allowedKeys) Object.hasOwn(interaction, key) ? nextNode[key] = interaction[key] : delete nextNode[key];
    const nodes = updateElement(page.nodes, nodeId, nextNode);
    return applyValidatedInteractionEdit(state, applyPageEdit(state.manifest, page.id, { nodes }));
  } catch (error) { return { ...state, cloudStatus: error.message }; }
}

export const setStudioPreviewState = (state, previewState) => ["default", "hover", "active", "disabled"].includes(previewState) ? { ...state, previewState } : state;

export function stageStudioAiPatch(state, patch, options = {}) {
  try {
    const review = createAiPatchReview({ projectId: state.projectId, manifest: state.manifest, manifestVersion: state.projectVersion, patch, createdBy: options.actor || "studio-user" });
    return { ...state, review, reviewBaseManifest: cloneJson(state.manifest) };
  } catch (error) {
    return { ...state, cloudStatus: error.message };
  }
}

export function approveStudioAiPatch(state, options = {}) {
  if (!state.review) return state;
  try {
    const result = approveAiPatchReview(state.review, { manifest: state.manifest, manifestVersion: state.projectVersion, actor: options.actor || "studio-user" });
    return refreshSession({ ...state, manifest: result.manifest, review: result.review, projectVersion: state.projectVersion + (result.idempotent ? 0 : 1), dirty: true });
  } catch (error) { return { ...state, cloudStatus: error.message }; }
}

export function rejectStudioAiPatch(state, reason = "") {
  if (!state.review) return state;
  try { return { ...state, review: rejectAiPatchReview(state.review, { actor: "studio-user", reason }).review }; } catch (error) { return { ...state, cloudStatus: error.message }; }
}

export function undoStudioAiPatch(state) {
  if (!state.review) return state;
  try {
    const result = undoAiPatchReview(state.review, { manifest: state.manifest, manifestVersion: state.projectVersion, actor: "studio-user" });
    return refreshSession({ ...state, manifest: result.manifest, review: result.review, projectVersion: state.projectVersion + (result.idempotent ? 0 : 1), dirty: true });
  } catch (error) { return { ...state, cloudStatus: error.message }; }
}

export function setStudioCloudState(state, patch) {
  return { ...state, ...patch };
}

function renderElement(node, selectedNodeId, previewState) {
  const selected = node.id === selectedNodeId;
  const style = [elementStyleToCss(resolveElementStyle(node, previewState)), interactionTransitionCss(node)].filter(Boolean).join("; ");
  const common = `data-node-id="${escapeHtml(node.id)}" ${interactionAttributes(node)} class="canvas-node canvas-${node.type.toLowerCase()}${selected ? " is-selected" : ""}" style="${escapeHtml(style)}"`;
  const children = (node.children || []).map((child) => renderElement(child, selectedNodeId, previewState)).join("");
  if (node.type === "Heading") return `<h2 ${common}>${escapeHtml(node.props.text)}</h2>`;
  if (node.type === "Text") return `<p ${common}>${escapeHtml(node.props.text)}</p>`;
  if (node.type === "Button") return `<button type="button" ${common}${previewState === "disabled" ? " disabled" : ""}>${escapeHtml(node.props.label)}</button>`;
  if (node.type === "Image") return `<img ${common} src="${escapeHtml(node.props.src)}" alt="${escapeHtml(node.props.alt)}">`;
  if (node.type === "Divider") return `<hr ${common}>`;
  if (node.type === "Spacer") return `<div ${common} aria-label="Spacer"></div>`;
  const cardCopy = node.type === "Card" ? `<strong>${escapeHtml(node.props.title)}</strong><p>${escapeHtml(node.props.description)}</p>` : "";
  return `<div ${common}>${cardCopy}${children}</div>`;
}

function renderDiff(diff) {
  if (!diff || diff.empty) return '<p class="muted">바뀌는 내용이 없습니다.</p>';
  const theme = diff.theme.map((item) => `<li><strong>${escapeHtml(TOKEN_LABELS[`theme.${item.property}`] || TOKEN_LABELS[item.property] || friendlyProperty(item.property))}</strong> ${escapeHtml(item.before)} → ${escapeHtml(item.after)}</li>`).join("");
  const elements = diff.elements.map((item) => `<li><strong>${escapeHtml(item.id)}</strong> ${escapeHtml(item.change)}${[...(item.props || []), ...(item.style || []), ...(item.states || [])].map((change) => ` · ${escapeHtml(change.state ? `${change.state}.${change.property}` : change.property)}`).join("")}</li>`).join("");
  const interactions = (diff.interactions || []).map((item) => `<li><strong>${escapeHtml(item.nodeId || item.pageId)}</strong> · 동작 ${escapeHtml(item.property)}</li>`).join("");
  return `<ul class="diff-list">${theme}${elements}${interactions}</ul>`;
}

const VERSION_RESULTS_PAGE_SIZE = 5;

export function renderVersionResults(cloud) {
  const rows = cloud.versions.map((version) => `<tr data-version-row><td>v${version.version}</td><td>${escapeHtml(version.label || "설명 없음")}</td><td>${escapeHtml(version.updatedBy || "작성자 없음")}</td><td>${escapeHtml(version.updatedAt || "-")}</td><td><button type="button" data-preview-version="${version.version}">미리보기</button> <button type="button" data-load-version="${version.version}">불러오기</button></td></tr>`).join("");
  const totalPages = Math.max(1, Math.ceil(cloud.total / VERSION_RESULTS_PAGE_SIZE));
  return `<table><thead><tr><th>버전</th><th>설명</th><th>사용자</th><th>저장 일시</th><th></th></tr></thead><tbody>${rows}</tbody></table><p data-version-empty${cloud.total ? " hidden" : ""}>조건에 맞는 버전이 없습니다.</p><div class="pagination"><button type="button" data-version-prev${cloud.page <= 1 ? " disabled" : ""}>이전</button><span data-version-page>${cloud.page} / ${totalPages}</span><button type="button" data-version-next${cloud.page * VERSION_RESULTS_PAGE_SIZE >= cloud.total ? " disabled" : ""}>다음</button></div>`;
}

export function createStudioShellViewModel(state) {
  const session = state.session;
  const editorPage = selectedEditorPage(state);
  const selectedPage = selectedPageFromManifest(state);
  const selectedNode = findElement(selectedPage?.nodes, state.selectedNodeId);
  return {
    state,
    labels: session.i18n.labels,
    importSummary: { templateName: session.template.name, templateId: session.template.id, version: session.template.version, tier: session.template.recommendedTier, status: session.validation.valid ? "Valid" : "Invalid", issues: session.validation.issues, warnings: [...session.validation.warnings, ...session.i18n.warnings] },
    theme: { ...session.theme, configured: state.themeConfigured },
    i18n: session.i18n,
    explorer: session.navigation.pages.map((page) => ({ ...page, selected: page.id === state.selectedPageId })),
    editor: { pageId: selectedPage?.id || "", title: fieldValue(editorPage, "title"), route: fieldValue(editorPage, "route"), state: selectedPage?.state || {}, selectedNode },
    elements: { registry: BASE_ELEMENT_TYPES.map((type) => ({ type, ...BASE_ELEMENT_REGISTRY[type] })), tree: numberedElements(selectedPage?.nodes || []), previewState: state.previewState },
    preview: { nodes: selectedPage?.nodes || [], adapter: session.preview.adapter, adapterSupported: session.preview.adapterSupported, routes: session.preview.routes, endpoints: session.preview.endpoints },
    commands: { importDryRun: session.export.dryRunCommand, exportPackage: `sdui-kit export --source example --template ${session.template.id} --out ./dist/${session.template.id}`, manifestPath: session.export.manifestPath, packageFiles: session.export.packageFiles },
    cloud: { projectId: state.projectId, pageId: state.selectedPageId, version: state.projectVersion, versions: state.versions, total: state.versionTotal, page: state.versionPage, search: state.versionSearch, user: state.versionUser, from: state.versionFrom, to: state.versionTo, excludeCurrent: state.versionExcludeCurrent, status: state.cloudStatus, dirty: state.dirty, publishedUrl: state.publishedUrl, publishSlug: state.publishSlug, versionedPublishedUrl: state.versionedPublishedUrl, releaseVersion: state.releaseVersion },
    review: state.review,
  };
}

function localeOptions(i18n) {
  const localeNames = { ko: "한국어", en: "English" };
  return i18n.locales.map((locale) => `<option value="${escapeHtml(locale)}"${locale === i18n.selectedLocale ? " selected" : ""}>${escapeHtml(localeNames[locale] || locale)}</option>`).join("");
}

const CATEGORY_LABELS = { Layout: "화면 배치", Content: "내용", Action: "버튼·동작" };
const ELEMENT_LABELS = { Container: "영역", Stack: "세로 목록", Grid: "격자", Heading: "제목", Text: "본문", Button: "버튼", Image: "이미지", Card: "카드", Divider: "구분선", Spacer: "빈 공간" };
const STATE_LABELS = { default: "기본", hover: "마우스를 올렸을 때", active: "누르는 동안", disabled: "사용할 수 없을 때" };
const TOKEN_LABELS = {
  "color.primary": "도형 안쪽 색 · 주요 버튼", "color.accent": "글자 배경색", "color.surface": "카드 배경색", "color.background": "화면 배경색", "color.text": "글자색", "color.mutedText": "보조 글자색", "color.border": "선 색 · 테두리", "color.danger": "경고·삭제색", "color.success": "성공·완료색",
  "typography.fontFamily": "글꼴", "typography.bodySize": "본문 글자 크기", "typography.headingSize": "제목 글자 크기", "typography.captionSize": "작은 글자 크기", "typography.lineHeight": "줄 간격",
  "space.xs": "매우 좁은 간격", "space.sm": "좁은 간격", "space.md": "보통 간격", "space.lg": "넓은 간격", "space.xl": "매우 넓은 간격",
  "radius.sm": "조금 둥근 모서리", "radius.md": "보통 둥근 모서리", "radius.lg": "많이 둥근 모서리", "shadow.sm": "옅은 그림자", "shadow.md": "진한 그림자",
};
const PROPERTY_LABELS = {
  text: "표시 문구", label: "버튼 문구", title: "제목", description: "설명", src: "이미지 주소", alt: "이미지 설명", variant: "버튼 종류", level: "제목 크기",
  color: "글자색", backgroundColor: "배경색", borderColor: "테두리색", iconColor: "아이콘색", borderRadius: "모서리 둥글기", padding: "안쪽 여백", margin: "바깥 여백", gap: "항목 간격", fontSize: "글자 크기", fontWeight: "글자 굵기", width: "너비", height: "높이", opacity: "투명도", textAlign: "문자 정렬",
};
const friendlyProperty = (property) => PROPERTY_LABELS[property] || property;

export function renderStudioShellHtml(model) {
  const basicThemePaths = new Set(["color.primary", "color.border", "color.background", "color.text", "color.accent", "typography.headingSize", "typography.bodySize", "typography.fontFamily", "typography.lineHeight", "space.md"]);
  const renderThemeToken = (token, { compact = false } = {}) => {
    const numeric = token.inputType === "range" ? Number.parseFloat(token.value) : null;
    if (compact && token.inputType === "color") return `<label class="theme-token-row"><span><strong>${escapeHtml(TOKEN_LABELS[token.path] || token.label)}</strong><small>${escapeHtml(token.cssVariable)}</small></span><span class="theme-token-swatch" style="--token-swatch:${escapeHtml(token.value)}" aria-label="${escapeHtml(token.value)}"></span><input type="text" data-theme-token="${escapeHtml(token.path)}" value="${escapeHtml(token.value)}"><button type="button" class="icon-button" data-reset-token="${escapeHtml(token.path)}" title="Reset this token">↺</button></label>`;
    return `<label class="theme-token-row"><span><strong>${escapeHtml(TOKEN_LABELS[token.path] || token.label)}</strong><small>${escapeHtml(token.cssVariable)}</small></span>
      ${token.inputType === "color" ? `<input type="color" data-theme-token="${escapeHtml(token.path)}" value="${escapeHtml(token.value)}">` : ""}
      ${token.inputType === "range" ? `<input type="range" data-theme-range="${escapeHtml(token.path)}" min="${token.min}" max="${token.max}" step="${token.step}" value="${numeric}">` : ""}
      <input type="text" data-theme-token="${escapeHtml(token.path)}" value="${escapeHtml(token.value)}">
      ${token.inputType === "color" ? `<span class="color-swatches" aria-label="빠른 색상 선택">${["#0f766e", "#0369a1", "#7c3aed", "#dc2626", "#111827", "#ffffff"].map((color) => `<button type="button" data-theme-quick="${escapeHtml(token.path)}" data-theme-value="${color}" style="--swatch:${color}" aria-label="${color}"></button>`).join("")}</span>` : ""}
      <button type="button" class="icon-button" data-reset-token="${escapeHtml(token.path)}" title="이 항목만 기본값으로">↺</button></label>`;
  };
  const themeRows = model.theme.tokens.filter((token) => basicThemePaths.has(token.path)).map((token) => renderThemeToken(token, { compact: true })).join("");
  const advancedThemeRows = model.theme.tokens.filter((token) => !basicThemePaths.has(token.path)).map(renderThemeToken).join("");
  const palette = `<details class="add-menu"><summary>+ 항목 추가</summary><p class="muted">버튼을 누르면 현재 선택한 위치에 새 항목이 생깁니다.</p><div class="palette-grid">${model.elements.registry.map((item) => `<button type="button" data-insert-element="${item.type}" title="${ELEMENT_LABELS[item.type]} 추가">+ ${ELEMENT_LABELS[item.type]}</button>`).join("")}</div></details>`;
  const tree = model.elements.tree.map(({ node, depth, number }) => `<button type="button" class="tree-row${node.id === model.editor.selectedNode?.id ? " is-selected" : ""}" style="--depth:${depth}" data-node-select="${escapeHtml(node.id)}"><span><b>${number}.</b> ${escapeHtml(node.name || ELEMENT_LABELS[node.type] || node.type)}</span><small>${escapeHtml(ELEMENT_LABELS[node.type] || node.type)}</small></button>`).join("");
  const node = model.editor.selectedNode;
  const props = node ? Object.entries(node.props || {}).map(([key, value]) => `<label>${escapeHtml(friendlyProperty(key))}<input data-node-prop="${escapeHtml(key)}" value="${escapeHtml(value)}"></label>`).join("") : '<p class="muted">왼쪽 목록이나 가운데 미리보기에서 편집할 항목을 선택하세요.</p>';
  const resolvedNodeStyle = node ? resolveElementStyle(node, "default") : {};
  const colorInputValue = (value) => {
    const token = model.theme.tokens.find((item) => `var(${item.cssVariable})` === value);
    const resolved = token?.resolvedValue || value;
    return /^#[0-9a-f]{6}$/i.test(String(resolved || "")) ? resolved : "#ffffff";
  };
  const buttonColors = node?.type === "Button" ? `<fieldset class="button-color-fields"><legend>이 버튼만 디자인</legend><p class="muted">선택한 버튼에만 적용되며 복사한 다른 버튼과 전체 디자인은 바뀌지 않습니다.</p>${[
    ["backgroundColor", "도형 안쪽 색"], ["borderColor", "선 색"], ["color", "글자색"],
  ].map(([property, label]) => `<label>${label}<span class="color-control"><input type="color" data-node-style-default="${property}" value="${escapeHtml(colorInputValue(resolvedNodeStyle[property]))}"><input type="text" data-node-style-default="${property}" value="${escapeHtml(resolvedNodeStyle[property] || "")}"></span></label>`).join("")}</fieldset>` : "";
  const style = node ? STYLE_PROPERTIES.map((property) => {
    const value = model.elements.previewState === "default" ? node.style?.[property] : node.states?.[model.elements.previewState]?.[property];
    const tokenOptions = model.theme.tokens.filter((token) => property.toLowerCase().includes("color") ? token.category === "color" : true).map((token) => `<option value="var(${token.cssVariable})">${escapeHtml(token.cssVariable)}</option>`).join("");
    return `<label class="style-row"><span>${escapeHtml(friendlyProperty(property))}<small>${value ? "직접 설정됨" : "전체 디자인 따름"}</small></span><select data-style-token="${property}" aria-label="${escapeHtml(friendlyProperty(property))} 디자인 값"><option value="">직접 입력</option>${tokenOptions}</select><input data-node-style="${property}" value="${escapeHtml(value || "")}" placeholder="전체 디자인 값 사용"><button type="button" class="icon-button" data-reset-style="${property}" title="전체 디자인 값으로 되돌리기">↺</button></label>`;
  }).join("") : "";
  const canvas = model.preview.nodes.map((item) => renderElement(item, node?.id, model.elements.previewState)).join("");
  const reviewStatus = { pending: "검토 대기", pending_review: "검토 대기", approved: "적용 완료", rejected: "적용하지 않음", undone: "적용 취소됨" };
  const review = model.review ? `<div class="review-status"><strong>${reviewStatus[model.review.status] || escapeHtml(model.review.status)}</strong><small>${escapeHtml(model.review.id)}</small></div>${renderDiff(model.review.diff)}<div class="button-row"><button type="button" data-review-action="approve">이대로 적용</button><button type="button" data-review-action="reject">적용하지 않기</button><button type="button" data-review-action="undo">적용 취소</button></div>` : '<p class="muted">AI 변경 코드를 붙여 넣으면 적용 전 차이를 보여드립니다.</p>';
  return `
    <style data-theme-runtime>${model.theme.cssText}</style>
    <nav class="studio-actions" aria-label="편집 도구"><button type="button" data-history-action="undo">↶ 실행 취소</button><button type="button" data-history-action="redo">↷ 다시 실행</button>${palette}<button type="button" data-scroll-preview>미리보기</button><button type="button" data-cloud-action="save">저장</button><button type="button" data-cloud-action="publish" class="primary-action">화면 배포</button></nav>
    <section class="panel import-panel" data-testid="import-summary"><div class="panel-heading"><div><h2>${escapeHtml(model.importSummary.templateName)}</h2><p class="panel-intro">현재 열어 둔 템플릿입니다. 작업할 언어를 선택하면 해당 언어의 문구를 확인할 수 있습니다.</p></div><span class="status-pill ${model.importSummary.status === "Valid" ? "is-valid" : "is-invalid"}">${model.importSummary.status === "Valid" ? "사용 가능" : "확인 필요"}</span></div><div class="studio-meta"><span>템플릿 ID: ${escapeHtml(model.importSummary.templateId)}</span><span>버전 ${escapeHtml(model.importSummary.version)}</span><label>작업 언어 <select data-testid="locale-selector" data-locale-selector>${localeOptions(model.i18n)}</select></label></div></section>
    <section class="panel explorer-panel" data-testid="page-explorer"><div class="panel-heading"><h2>화면 구성</h2></div><p class="panel-intro">목차 번호는 항목 구조에 따라 자동으로 바뀝니다.</p><div class="tree-list">${tree}</div><div class="tree-action-row"><button type="button" data-tree-action="up">↑ 위로</button><button type="button" data-tree-action="down">↓ 아래로</button><button type="button" data-tree-action="duplicate">복사</button><button type="button" class="danger-action" data-tree-action="delete">삭제</button></div></section>
    <section class="panel theme-panel" data-testid="theme-panel"><div class="theme-card-header"><h2>전체 디자인</h2><div class="theme-card-controls"><select data-theme-preset aria-label="디자인 세트"><option value="">디자인 세트 선택</option><option value="default">기본</option><option value="ocean">파란색 계열</option><option value="berry">자주색 계열</option></select><button type="button" data-reset-theme>전체 기본값으로</button></div></div><p class="panel-intro theme-card-intro">도형·버튼의 선과 안쪽 색, 글자색·배경색, 크기·글꼴·줄 간격, 화면 간격을 정합니다.</p><label class="toggle-row"><input type="checkbox" data-theme-scope${model.state.manifest.theme.applyToAllScreens ? " checked" : ""}>모든 화면에 같은 디자인 적용</label><div class="theme-token-grid">${themeRows}</div><details><summary>고급 디자인 설정</summary><div class="theme-token-grid">${advancedThemeRows}</div></details>${(model.theme.warnings || []).map((item) => `<p class="warning">${escapeHtml(item.message)}</p>`).join("")}</section>
    <section class="panel editor-panel" data-testid="adapter-preview"><div class="panel-heading"><div><h2>화면 미리보기</h2><small>${escapeHtml(model.editor.title)} · ${escapeHtml(model.editor.route)}</small></div><div class="segmented">${["default", "hover", "active", "disabled"].map((state) => `<button type="button" data-preview-state="${state}" class="${model.elements.previewState === state ? "is-selected" : ""}">${STATE_LABELS[state]}</button>`).join("")}</div></div><p class="panel-intro">편집할 부분을 직접 누르세요. 오른쪽에서 문구와 디자인을 바꿀 수 있습니다.</p><div class="canvas" data-testid="element-canvas">${canvas}</div></section>
    <section class="panel preview-panel" data-testid="page-editor"><div class="panel-heading"><h2>선택 항목 편집</h2><small>${escapeHtml(node?.name || "선택 없음")}</small></div><p class="panel-intro">선택한 항목 하나만 변경합니다. 복사본은 원본과 별도로 꾸밀 수 있습니다.</p><div class="inspector-form">${props}${buttonColors}</div><details><summary>고급 스타일 설정 · ${STATE_LABELS[model.elements.previewState]}</summary><div class="style-list">${style}</div></details></section>
    <section class="panel command-panel" data-testid="command-panel"><details><summary><strong>개발 담당자에게 전달할 정보</strong></summary><p class="panel-intro">배포·오류 문의 시 아래 정보를 복사해 개발 담당자에게 전달하세요.</p><dl><dt>템플릿</dt><dd>${escapeHtml(model.importSummary.templateId)} v${escapeHtml(model.importSummary.version)}</dd><dt>실행 환경</dt><dd>${escapeHtml(model.preview.adapter)}</dd><dt>현재 저장 버전</dt><dd>v${model.cloud.version}</dd></dl><code>${escapeHtml(model.commands.importDryRun)}</code><code>${escapeHtml(model.commands.exportPackage)}</code><button type="button" data-copy-developer-info>정보 복사</button></details></section>
    <section class="panel review-panel ai-panel" data-ai-panel><details data-ai-details${model.review ? " open" : ""}><summary><strong>AI로 수정</strong></summary><div class="ai-panel-body"><p class="panel-intro">원하는 변경을 자연어 또는 스케치와 기획 설명으로 입력하면 AI가 변경안을 만들고, 적용 전에 결과를 비교합니다.</p><div class="ai-provider-settings"><label>AI 제공자<select data-ai-provider><option value="openai">OpenAI</option><option value="anthropic">Claude (Anthropic)</option><option value="google">Gemini (Google)</option></select></label><label>사용자 API 키<input type="password" data-ai-provider-key autocomplete="off" placeholder="이번 탭에서만 사용"></label><small>웹 구독과 API 사용 권한·과금은 별도입니다. 키는 저장하지 않습니다.</small></div><div class="ai-input-actions"><button type="button" data-open-sketch>스케치하기</button></div><textarea data-ai-prompt placeholder="예: 버튼을 파란색으로 바꾸고 제목을 조금 크게 해줘"></textarea><button type="button" data-ai-assist>AI 변경안 만들기</button><p class="ai-status" data-ai-status aria-live="polite"></p>${review}<details><summary>고급 모드: 변경 코드 직접 입력</summary><textarea data-ai-patch></textarea><button type="button" data-stage-ai-patch>변경 코드 비교</button></details></div></details></section>
    <section class="panel cloud-panel"><div class="panel-heading"><h2>저장·배포 및 버전 히스토리</h2><span class="status-pill">현재 v${model.cloud.version}</span></div><p class="panel-intro">저장은 편집 이력을 보관하고, 화면 배포는 최신 내용을 공개 URL에 반영합니다.</p><div class="cloud-controls"><input data-project-id value="${escapeHtml(model.cloud.projectId)}" aria-label="프로젝트 ID"><button type="button" data-cloud-action="save">새 버전 저장</button><button type="button" data-cloud-action="publish" class="primary-action">화면 배포</button><button type="button" data-cloud-action="load">최신 버전 불러오기</button><button type="button" data-open-versions>버전 히스토리</button></div>${model.cloud.publishedUrl ? `<div class="publish-result"><strong>배포 URL</strong><a href="${escapeHtml(model.cloud.publishedUrl)}" target="_blank" rel="noopener">${escapeHtml(model.cloud.publishedUrl)}</a><button type="button" data-copy-published-url>URL 복사</button></div>` : ""}<p class="muted">${escapeHtml(model.cloud.status)}</p></section>
    <dialog class="version-dialog" data-version-dialog><form method="dialog"><div class="panel-heading"><h2>버전 히스토리</h2><button value="close" aria-label="닫기">×</button></div></form><div class="version-filters"><label>검색<input data-version-search value="${escapeHtml(model.cloud.search)}" placeholder="버전 또는 설명"></label><label>저장한 사용자<input data-version-user value="${escapeHtml(model.cloud.user)}" placeholder="사용자"></label><label>시작일<input type="date" data-version-from value="${escapeHtml(model.cloud.from)}"></label><label>종료일<input type="date" data-version-to value="${escapeHtml(model.cloud.to)}"></label><label class="toggle-row"><input type="checkbox" data-version-exclude-current${model.cloud.excludeCurrent ? " checked" : ""}>현재 버전 제외</label></div><div class="version-preview" data-version-preview hidden></div><div data-version-results>${renderVersionResults(model.cloud)}</div></dialog>
    <dialog class="sketch-dialog" data-sketch-dialog aria-labelledby="sketch-dialog-title" aria-describedby="sketch-dialog-description"><div class="sketch-dialog-header"><div><h2 id="sketch-dialog-title">스케치로 AI 수정</h2><p id="sketch-dialog-description">화면 구조를 그리고 기획 의도를 함께 설명해 주세요.</p></div><button type="button" data-close-sketch aria-label="스케치 창 닫기">×</button></div><div class="sketch-workspace"><section class="sketch-canvas-panel"><canvas data-sketch-canvas width="640" height="480" aria-label="화면 기획 스케치 캔버스"></canvas><div class="sketch-tools" aria-label="스케치 도구"><input type="color" data-sketch-color value="#111827" aria-label="펜 색상"><label>굵기 <input type="range" data-sketch-size min="3" max="28" value="10"></label><button type="button" data-sketch-tool="eraser" aria-pressed="false">지우개</button><button type="button" data-sketch-action="undo">실행 취소</button><button type="button" data-sketch-action="clear">비우기</button></div></section><section class="sketch-description-panel"><label for="sketch-description"><strong>스케치 기획 설명</strong></label><textarea id="sketch-description" data-sketch-description maxlength="4000" placeholder="예: 사이드바는 햄버거 메뉴, 상단에는 헤더, 본문은 왼쪽 글과 오른쪽 이미지로 구성해 주세요."></textarea><label>수정 범위<select data-sketch-scope><option value="current-page">현재 화면 전체</option><option value="selected-node">현재 선택 항목</option></select></label><p class="muted">스케치 또는 설명 중 하나 이상을 입력해야 합니다. 둘 다 입력하면 더 정확한 수정안을 만들 수 있습니다.</p><p data-sketch-status aria-live="polite"></p></section></div><div class="sketch-dialog-actions"><button type="button" data-close-sketch>취소</button><button type="button" class="primary-action" data-submit-sketch>AI 수정안 만들기</button></div></dialog>
  `;
}
