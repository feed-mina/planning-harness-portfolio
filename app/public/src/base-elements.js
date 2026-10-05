const clone = (value) => structuredClone(value);
const records = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SAFE_VALUE = /^[^;{}<>]{1,256}$/;

export const BASE_ELEMENT_TYPES = Object.freeze([
  "Container", "Stack", "Grid", "Heading", "Text",
  "Button", "Image", "Card", "Divider", "Spacer",
]);

export const STYLE_PROPERTIES = Object.freeze([
  "backgroundColor", "color", "borderColor", "iconColor", "borderRadius",
  "padding", "margin", "gap", "width", "height", "opacity",
]);

const layout = ["Container", "Stack", "Grid"];
const leaf = ["Heading", "Text", "Button", "Image", "Divider", "Spacer"];

export const BASE_ELEMENT_REGISTRY = Object.freeze({
  Container: { category: "Layout", label: "Container", allowedChildren: true, defaultProps: {}, defaultStyle: { padding: "var(--space-md)" } },
  Stack: { category: "Layout", label: "Stack", allowedChildren: true, defaultProps: { direction: "vertical" }, defaultStyle: { gap: "var(--space-sm)" } },
  Grid: { category: "Layout", label: "Grid", allowedChildren: true, defaultProps: { columns: 2 }, defaultStyle: { gap: "var(--space-md)" } },
  Heading: { category: "Content", label: "Heading", allowedChildren: false, defaultProps: { text: "New heading", level: 2 }, defaultStyle: { color: "var(--color-text)" } },
  Text: { category: "Content", label: "Text", allowedChildren: false, defaultProps: { text: "New text" }, defaultStyle: { color: "var(--color-muted-text)" } },
  Button: { category: "Action", label: "Button", allowedChildren: false, defaultProps: { label: "Button", variant: "primary" }, defaultStyle: { backgroundColor: "var(--color-primary)", color: "#ffffff", borderRadius: "var(--radius-md)", padding: "var(--space-sm)" } },
  Image: { category: "Content", label: "Image", allowedChildren: false, defaultProps: { src: "https://placehold.co/640x360", alt: "Placeholder" }, defaultStyle: { width: "100%", borderRadius: "var(--radius-md)" } },
  Card: { category: "Content", label: "Card", allowedChildren: true, defaultProps: { title: "New card", description: "Card description" }, defaultStyle: { backgroundColor: "var(--color-surface)", borderColor: "var(--color-border)", borderRadius: "var(--radius-md)", padding: "var(--space-md)" } },
  Divider: { category: "Layout", label: "Divider", allowedChildren: false, defaultProps: {}, defaultStyle: { borderColor: "var(--color-border)", width: "100%" } },
  Spacer: { category: "Layout", label: "Spacer", allowedChildren: false, defaultProps: {}, defaultStyle: { height: "var(--space-md)" } },
});

let sequence = 0;
function generatedId(type) {
  sequence += 1;
  return `node_${type.toLowerCase()}_${Date.now().toString(36)}_${sequence}`;
}

export function createElementNode(type, options = {}) {
  const definition = BASE_ELEMENT_REGISTRY[type];
  if (!definition) throw new Error(`unknown element type: ${type}`);
  return {
    id: options.id || generatedId(type),
    name: options.name || definition.label,
    type,
    props: { ...clone(definition.defaultProps), ...(records(options.props) ? clone(options.props) : {}) },
    style: { ...clone(definition.defaultStyle), ...(records(options.style) ? validateElementStyle(type, options.style).style : {}) },
    states: records(options.states) ? validateElementStates(type, options.states).states : {},
    ...(records(options.events) ? { events: clone(options.events) } : {}),
    ...(records(options.visibleWhen) ? { visibleWhen: clone(options.visibleWhen) } : {}),
    ...(records(options.enabledWhen) ? { enabledWhen: clone(options.enabledWhen) } : {}),
    ...(records(options.transition) ? { transition: clone(options.transition) } : {}),
    children: definition.allowedChildren ? (Array.isArray(options.children) ? clone(options.children) : []) : [],
  };
}

export function createDefaultPageNodes(pageId = "page") {
  return [createElementNode("Container", {
    id: `node_${pageId}_root`,
    name: "Page content",
    children: [
      createElementNode("Heading", { id: `node_${pageId}_heading`, props: { text: "Build your screen" } }),
      createElementNode("Text", { id: `node_${pageId}_text`, props: { text: "Select an element to edit its content and style." } }),
      createElementNode("Button", { id: `node_${pageId}_button`, props: { label: "Get started" } }),
    ],
  })];
}

export function normalizeElementTree(nodes, pageId = "page") {
  if (!Array.isArray(nodes) || nodes.length === 0) return createDefaultPageNodes(pageId);
  return nodes.map((node) => {
    const normalized = createElementNode(node.type, node);
    normalized.children = BASE_ELEMENT_REGISTRY[node.type].allowedChildren
      ? (Array.isArray(node.children) ? node.children.map((child) => normalizeElementTree([child], pageId)[0]) : [])
      : [];
    return normalized;
  });
}

export function findElement(nodes, nodeId) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node.id === nodeId) return node;
    const nested = findElement(node.children, nodeId);
    if (nested) return nested;
  }
  return null;
}

function mapTree(nodes, mapper) {
  return nodes.map((node) => {
    const mapped = mapper(node);
    return { ...mapped, children: mapTree(mapped.children || [], mapper) };
  });
}

function locate(nodes, nodeId, parent = null) {
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].id === nodeId) return { node: nodes[index], parent, siblings: nodes, index };
    const nested = locate(nodes[index].children || [], nodeId, nodes[index]);
    if (nested) return nested;
  }
  return null;
}

export function insertElement(nodes, selectedId, type, options = {}) {
  const next = clone(Array.isArray(nodes) ? nodes : []);
  const node = createElementNode(type, options);
  const target = locate(next, selectedId);
  if (!target) {
    next.push(node);
    return { nodes: next, inserted: node, placement: "root" };
  }
  if (BASE_ELEMENT_REGISTRY[target.node.type].allowedChildren) {
    target.node.children.push(node);
    return { nodes: next, inserted: node, placement: "child" };
  }
  target.siblings.splice(target.index + 1, 0, node);
  return { nodes: next, inserted: node, placement: "sibling" };
}

export function deleteElement(nodes, nodeId) {
  const next = clone(nodes);
  const target = locate(next, nodeId);
  if (!target) return { nodes: next, deleted: false };
  target.siblings.splice(target.index, 1);
  return { nodes: next, deleted: true };
}

function remapIds(node) {
  return {
    ...node,
    id: generatedId(node.type),
    name: `${node.name || node.type} copy`,
    children: (node.children || []).map(remapIds),
  };
}

export function duplicateElement(nodes, nodeId) {
  const next = clone(nodes);
  const target = locate(next, nodeId);
  if (!target) return { nodes: next, duplicate: null };
  const duplicate = remapIds(target.node);
  target.siblings.splice(target.index + 1, 0, duplicate);
  return { nodes: next, duplicate };
}

export function moveElement(nodes, nodeId, direction) {
  const next = clone(nodes);
  const target = locate(next, nodeId);
  if (!target) return next;
  const destination = direction === "up" ? target.index - 1 : target.index + 1;
  if (destination < 0 || destination >= target.siblings.length) return next;
  const [node] = target.siblings.splice(target.index, 1);
  target.siblings.splice(destination, 0, node);
  return next;
}

export function updateElement(nodes, nodeId, patch) {
  return mapTree(clone(nodes), (node) => node.id === nodeId ? { ...node, ...clone(patch) } : node);
}

export function renameElement(nodes, nodeId, name) {
  const clean = String(name || "").trim().slice(0, 80);
  return clean ? updateElement(nodes, nodeId, { name: clean }) : clone(nodes);
}

function validStyleValue(property, value) {
  if (property === "opacity") return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
  return typeof value === "string" && SAFE_VALUE.test(value.trim());
}

export function validateElementStyle(type, style) {
  if (!BASE_ELEMENT_REGISTRY[type]) return { valid: false, style: {}, issues: ["unknown element type"] };
  const accepted = {};
  const issues = [];
  for (const [property, value] of Object.entries(records(style) ? style : {})) {
    if (!STYLE_PROPERTIES.includes(property)) {
      issues.push(`unsupported style property: ${property}`);
    } else if (!validStyleValue(property, value)) {
      issues.push(`invalid style value: ${property}`);
    } else {
      accepted[property] = property === "opacity" ? Number(value) : value.trim();
    }
  }
  return { valid: issues.length === 0, style: accepted, issues };
}

export function validateElementStates(type, states) {
  const accepted = {};
  const issues = [];
  for (const state of ["hover", "active", "disabled"]) {
    if (states?.[state] === undefined) continue;
    const result = validateElementStyle(type, states[state]);
    accepted[state] = result.style;
    issues.push(...result.issues.map((message) => `${state}: ${message}`));
  }
  return { valid: issues.length === 0, states: accepted, issues };
}

export function setElementStyle(nodes, nodeId, property, value, state = "default") {
  const current = findElement(nodes, nodeId);
  if (!current) return clone(nodes);
  const validated = validateElementStyle(current.type, { [property]: value });
  if (!validated.valid) return clone(nodes);
  if (state === "default") return updateElement(nodes, nodeId, { style: { ...current.style, ...validated.style } });
  return updateElement(nodes, nodeId, {
    states: { ...current.states, [state]: { ...(current.states?.[state] || {}), ...validated.style } },
  });
}

export function resetElementStyle(nodes, nodeId, property, state = "default") {
  const current = findElement(nodes, nodeId);
  if (!current) return clone(nodes);
  if (state === "default") {
    const style = { ...current.style };
    if (property) delete style[property];
    else Object.keys(style).forEach((key) => delete style[key]);
    return updateElement(nodes, nodeId, { style });
  }
  const states = clone(current.states || {});
  if (property) delete states[state]?.[property];
  else delete states[state];
  return updateElement(nodes, nodeId, { states });
}

export function resolveElementStyle(node, state = "default") {
  const defaults = BASE_ELEMENT_REGISTRY[node.type]?.defaultStyle || {};
  return {
    ...defaults,
    ...(node.style || {}),
    ...(state === "default" ? {} : node.states?.[state] || {}),
  };
}

export function elementStyleToCss(style) {
  return Object.entries(style || {}).map(([key, value]) => {
    const css = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    if (key === "borderColor") return `border-color: ${value}; border-style: solid; border-width: 1px`;
    if (key === "iconColor") return `--element-icon-color: ${value}`;
    return `${css}: ${value}`;
  }).join("; ");
}

export function flattenElements(nodes, depth = 0) {
  return (nodes || []).flatMap((node) => [{ node, depth }, ...flattenElements(node.children, depth + 1)]);
}

export function isLeafElement(type) {
  return leaf.includes(type);
}

export function isLayoutElement(type) {
  return layout.includes(type);
}
