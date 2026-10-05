import { normalizeTheme, validateThemeTokens } from "./theme-tokens.js";
import { flattenElements, normalizeElementTree, validateElementStates, validateElementStyle } from "./base-elements.js";
import { validatePageInteractions } from "./interaction-runtime.js";

export const STUDIO_DOCUMENT_VERSION = 2;
const clone = (value) => structuredClone(value);
const stable = (value) => JSON.stringify(value);

export function migrateStudioManifest(manifest) {
  const next = clone(manifest);
  next.documentVersion = STUDIO_DOCUMENT_VERSION;
  next.theme = normalizeTheme(next.theme);
  next.pages = (next.pages || []).map((page) => ({
    ...page,
    nodes: normalizeElementTree(page.nodes, page.id),
  }));
  return next;
}

export function validateStudioManifest(manifest) {
  const migrated = migrateStudioManifest(manifest);
  const issues = [...validateThemeTokens(migrated.theme).issues];
  const routes = new Set(migrated.pages.map((page) => page.route));
  for (const [pageIndex, page] of migrated.pages.entries()) {
    issues.push(...validatePageInteractions(page, pageIndex, routes));
    const ids = new Set();
    for (const { node } of flattenElements(page.nodes)) {
      if (ids.has(node.id)) issues.push({ path: `pages[${pageIndex}].nodes`, message: `duplicate node id: ${node.id}` });
      ids.add(node.id);
      const style = validateElementStyle(node.type, node.style);
      const states = validateElementStates(node.type, node.states);
      issues.push(...style.issues.map((message) => ({ path: `node.${node.id}.style`, message })));
      issues.push(...states.issues.map((message) => ({ path: `node.${node.id}.states`, message })));
    }
  }
  return { valid: issues.length === 0, issues, manifest: migrated };
}

function flattenTokenMap(theme) {
  const result = {};
  for (const [category, values] of Object.entries(theme?.tokens || {})) {
    for (const [name, value] of Object.entries(values || {})) result[`${category}.${name}`] = value;
  }
  return result;
}

function indexNodes(manifest) {
  const result = new Map();
  for (const page of manifest.pages || []) {
    for (const { node } of flattenElements(page.nodes)) result.set(node.id, { pageId: page.id, node });
  }
  return result;
}

function changes(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter((key) => stable(before?.[key]) !== stable(after?.[key])).map((key) => ({ property: key, before: before?.[key], after: after?.[key] }));
}

export function diffStudioManifests(beforeInput, afterInput) {
  const before = migrateStudioManifest(beforeInput);
  const after = migrateStudioManifest(afterInput);
  const theme = changes(flattenTokenMap(before.theme), flattenTokenMap(after.theme));
  const left = indexNodes(before);
  const right = indexNodes(after);
  const elements = [];
  const interactions = [];
  for (const pageId of new Set([...before.pages.map((page) => page.id), ...after.pages.map((page) => page.id)])) {
    const previousPage = before.pages.find((page) => page.id === pageId);
    const currentPage = after.pages.find((page) => page.id === pageId);
    for (const change of changes(previousPage?.state, currentPage?.state)) interactions.push({ pageId, scope: "state", ...change });
  }
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const previous = left.get(id);
    const current = right.get(id);
    if (!previous) {
      elements.push({ id, pageId: current.pageId, change: "added", type: current.node.type });
      continue;
    }
    if (!current) {
      elements.push({ id, pageId: previous.pageId, change: "removed", type: previous.node.type });
      continue;
    }
    const props = changes(previous.node.props, current.node.props);
    const style = changes(previous.node.style, current.node.style);
    const states = ["hover", "active", "disabled"].flatMap((state) => changes(previous.node.states?.[state], current.node.states?.[state]).map((change) => ({ state, ...change })));
    const nodeInteractions = changes(
      { events: previous.node.events, visibleWhen: previous.node.visibleWhen, enabledWhen: previous.node.enabledWhen, transition: previous.node.transition },
      { events: current.node.events, visibleWhen: current.node.visibleWhen, enabledWhen: current.node.enabledWhen, transition: current.node.transition }
    );
    nodeInteractions.forEach((change) => interactions.push({ pageId: current.pageId, nodeId: id, scope: "node", ...change }));
    if (props.length || style.length || states.length || nodeInteractions.length || previous.pageId !== current.pageId) elements.push({ id, pageId: current.pageId, change: previous.pageId === current.pageId ? "modified" : "moved", type: current.node.type, props, style, states });
  }
  return { empty: theme.length === 0 && elements.length === 0 && interactions.length === 0, theme, elements, interactions };
}

export function serializeStudioManifest(manifest) {
  const validation = validateStudioManifest(manifest);
  if (!validation.valid) throw new Error(`invalid Studio manifest: ${validation.issues[0].message}`);
  return JSON.stringify(validation.manifest);
}

export function deserializeStudioManifest(serialized) {
  const parsed = typeof serialized === "string" ? JSON.parse(serialized) : clone(serialized);
  const validation = validateStudioManifest(parsed);
  if (!validation.valid) throw new Error(`invalid Studio manifest: ${validation.issues[0].message}`);
  return validation.manifest;
}

export function exportStudioPackage(manifest, metadata = {}) {
  const packageValue = {
    format: "feedmina.studio.package.v1",
    exportedAt: metadata.exportedAt || new Date().toISOString(),
    projectId: metadata.projectId || manifest.id,
    manifest: deserializeStudioManifest(manifest),
  };
  if (metadata.branding) packageValue.branding = clone(metadata.branding);
  return packageValue;
}

export function importStudioPackage(packageValue, currentManifest, options = {}) {
  if (packageValue?.format !== "feedmina.studio.package.v1") throw new Error("unsupported Studio package format");
  const incoming = deserializeStudioManifest(packageValue.manifest);
  if (options.mode !== "merge-elements") return incoming;
  const current = migrateStudioManifest(currentManifest);
  const pages = current.pages.map((page) => {
    const incomingPage = incoming.pages.find((candidate) => candidate.id === page.id);
    return incomingPage ? { ...page, nodes: incomingPage.nodes } : page;
  });
  return { ...current, pages, theme: incoming.theme };
}

export function runtimeSnapshot(manifest) {
  const canonical = migrateStudioManifest(manifest);
  return stable({ theme: canonical.theme, pages: canonical.pages.map((page) => ({ id: page.id, state: page.state || {}, nodes: page.nodes })) });
}
