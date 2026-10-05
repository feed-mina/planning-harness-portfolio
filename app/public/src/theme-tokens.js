export const THEME_VERSION = "1.0";

export const DEFAULT_THEME = Object.freeze({
  version: THEME_VERSION,
  applyToAllScreens: true,
  tokens: {
    color: { primary: "#0f766e", accent: "#f59e0b", surface: "#ffffff", background: "#f8fafc", text: "#111827", mutedText: "#6b7280", border: "#e5e7eb", danger: "#dc2626", success: "#16a34a" },
    typography: { fontFamily: "Inter, system-ui, sans-serif", bodySize: "14px", headingSize: "24px", captionSize: "12px", lineHeight: "1.5" },
    space: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
    radius: { sm: "4px", md: "8px", lg: "12px" },
    shadow: { sm: "0 1px 2px rgba(15, 23, 42, 0.08)", md: "0 8px 24px rgba(15, 23, 42, 0.12)" },
  },
});

export const THEME_PRESETS = Object.freeze({
  default: DEFAULT_THEME,
  ocean: { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, color: { ...DEFAULT_THEME.tokens.color, primary: "#0369a1", accent: "#0d9488", background: "#f0f9ff" } } },
  berry: { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, color: { ...DEFAULT_THEME.tokens.color, primary: "#9f1239", accent: "#7c3aed", background: "#fff7ed" } } },
});

export const THEME_CATEGORIES = Object.freeze(["color", "typography", "space", "radius", "shadow", "custom"]);
const TOKEN_PATH_PATTERN = /^[a-z][a-zA-Z0-9-]*$/;
const FORBIDDEN_CSS_VALUE = /[;<>]|<\/?style|@import|expression\s*\(/i;
const COLOR = /^#[0-9a-f]{6}$/i;
const LENGTH = /^(-?\d+(\.\d+)?)(px|rem|em|%|vh|vw)$/i;
const LIMITS = {
  "typography.bodySize": [10, 32],
  "typography.headingSize": [16, 72],
  "typography.captionSize": [9, 24],
  "space.xs": [0, 32], "space.sm": [0, 48], "space.md": [0, 64], "space.lg": [0, 96], "space.xl": [0, 128],
  "radius.sm": [0, 32], "radius.md": [0, 48], "radius.lg": [0, 64],
};

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => structuredClone(value);

function mergeRecords(base, override) {
  const result = clone(base);
  if (!isRecord(override)) return result;
  for (const [key, value] of Object.entries(override)) {
    result[key] = isRecord(value) && isRecord(result[key]) ? mergeRecords(result[key], value) : clone(value);
  }
  return result;
}

const kebabCase = (value) => String(value).replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2").replaceAll(/[^a-zA-Z0-9]+/g, "-").replaceAll(/^-+|-+$/g, "").toLowerCase();

export function cssVariableName(path) {
  const typography = { fontFamily: "--font-family-base", bodySize: "--font-size-body", headingSize: "--font-size-heading", captionSize: "--font-size-caption", lineHeight: "--line-height" };
  const [category, token] = path.split(".");
  return category === "typography" && typography[token] ? typography[token] : `--${path.split(".").map(kebabCase).join("-")}`;
}

function isSafeTokenValue(value) {
  if (!(typeof value === "string" || typeof value === "number")) return false;
  const text = String(value).trim();
  const withoutReferences = text.replace(/\{[a-z][a-zA-Z0-9-]*(?:\.[a-z][a-zA-Z0-9-]*)+\}/g, "");
  return text.length > 0 && text.length <= 256 && !FORBIDDEN_CSS_VALUE.test(text) && !/[{}]/.test(withoutReferences);
}

function valueWithinLimit(path, value) {
  const limit = LIMITS[path];
  if (!limit) return true;
  const match = String(value).match(LENGTH);
  return Boolean(match) && Number(match[1]) >= limit[0] && Number(match[1]) <= limit[1];
}

function walkTokens(value, path, result) {
  if (!isRecord(value)) return result.push({ path, value });
  for (const [key, child] of Object.entries(value)) walkTokens(child, path ? `${path}.${key}` : key, result);
}

const issue = (path, message) => ({ path, message });

export function normalizeTheme(theme) {
  const normalized = mergeRecords(DEFAULT_THEME, isRecord(theme) ? theme : {});
  normalized.version = THEME_VERSION;
  normalized.applyToAllScreens = theme?.applyToAllScreens !== false;
  normalized.tokens = mergeRecords(DEFAULT_THEME.tokens, isRecord(theme?.tokens) ? theme.tokens : {});
  return normalized;
}

export function resolveTokenReferences(theme) {
  const variables = Object.fromEntries(listThemeTokens(theme, { resolve: false }).map((token) => [token.path, token.value]));
  const resolving = new Set();
  const resolve = (path) => {
    if (resolving.has(path)) throw new Error(`circular theme token reference: ${path}`);
    resolving.add(path);
    const value = String(variables[path] ?? "");
    const result = value.replace(/\{([a-z][a-zA-Z0-9-]*(?:\.[a-z][a-zA-Z0-9-]*)+)\}/g, (_, reference) => resolve(reference));
    resolving.delete(path);
    return result;
  };
  return Object.fromEntries(Object.keys(variables).map((path) => [path, resolve(path)]));
}

export function listThemeTokens(theme, options = {}) {
  const normalized = normalizeTheme(theme);
  const flattened = [];
  walkTokens(normalized.tokens, "", flattened);
  let resolved = {};
  if (options.resolve !== false) {
    try { resolved = resolveTokenReferences(normalized); } catch { resolved = {}; }
  }
  return flattened.map(({ path, value }) => {
    const [category] = path.split(".");
    const limit = LIMITS[path];
    return {
      path,
      category: THEME_CATEGORIES.includes(category) ? category : "custom",
      cssVariable: cssVariableName(path),
      value: String(value),
      resolvedValue: resolved[path] || String(value),
      inputType: category === "color" && COLOR.test(String(value)) ? "color" : limit ? "range" : "text",
      min: limit?.[0], max: limit?.[1], step: 1,
      label: path.split(".").at(-1).replaceAll(/([a-z])([A-Z])/g, "$1 $2"),
    };
  });
}

export function validateThemeTokens(theme) {
  if (theme === undefined) return { valid: true, issues: [], warnings: [], configured: false };
  if (!isRecord(theme)) return { valid: false, configured: true, issues: [issue("theme", "must be an object when provided")], warnings: [] };
  const issues = [];
  if (theme.version !== undefined && theme.version !== THEME_VERSION) issues.push(issue("theme.version", `must be ${THEME_VERSION}`));
  if (!isRecord(theme.tokens)) return { valid: false, configured: true, issues: [...issues, issue("theme.tokens", "must be an object when theme is configured")], warnings: [] };
  const flattened = [];
  walkTokens(theme.tokens, "", flattened);
  for (const { path, value } of flattened) {
    const segments = path.split(".");
    if (!THEME_CATEGORIES.includes(segments[0])) issues.push(issue(`theme.tokens.${path}`, `unsupported token category: ${segments[0]}`));
    if (segments.some((segment) => !TOKEN_PATH_PATTERN.test(segment))) issues.push(issue(`theme.tokens.${path}`, "token path contains an invalid segment"));
    if (!isSafeTokenValue(value)) issues.push(issue(`theme.tokens.${path}`, "token value is not a safe CSS value"));
    else if (!valueWithinLimit(path, value)) issues.push(issue(`theme.tokens.${path}`, "token value is outside the supported range"));
  }
  try { resolveTokenReferences(theme); } catch (error) { issues.push(issue("theme.tokens", error.message)); }
  return { valid: issues.length === 0, configured: true, issues, warnings: themeAccessibilityWarnings(theme) };
}

export function themeTokensToCssVariables(theme) {
  const resolved = resolveTokenReferences(theme);
  return Object.fromEntries(listThemeTokens(theme, { resolve: false }).map((token) => [token.cssVariable, resolved[token.path]]));
}

export function themeTokensToCssText(theme, selector = ":root") {
  const declarations = Object.entries(themeTokensToCssVariables(theme)).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `  ${name}: ${value};`).join("\n");
  return `${selector} {\n${declarations}\n}`;
}

export function setThemeToken(theme, path, value) {
  if (typeof path !== "string" || !path || path.split(".").some((segment) => !TOKEN_PATH_PATTERN.test(segment))) throw new Error(`invalid theme token path: ${path}`);
  if (!isSafeTokenValue(value) || !valueWithinLimit(path, value)) throw new Error(`unsafe theme token value: ${path}`);
  const next = normalizeTheme(theme);
  const segments = path.split(".");
  let cursor = next.tokens;
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = value;
  return next;
}

export function resetThemeToken(theme, path) {
  const fallback = listThemeTokens(DEFAULT_THEME, { resolve: false }).find((token) => token.path === path);
  if (!fallback) throw new Error(`unknown default theme token: ${path}`);
  return setThemeToken(theme, path, fallback.value);
}

export function resetTheme() {
  return clone(DEFAULT_THEME);
}

export function applyThemePreset(name) {
  if (!THEME_PRESETS[name]) throw new Error(`unknown theme preset: ${name}`);
  return clone(THEME_PRESETS[name]);
}

export function setApplyToAllScreens(theme, enabled) {
  return { ...normalizeTheme(theme), applyToAllScreens: Boolean(enabled) };
}

function luminance(hex) {
  const rgb = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function contrastRatio(foreground, background) {
  if (!COLOR.test(foreground) || !COLOR.test(background)) return null;
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

export function themeAccessibilityWarnings(theme) {
  const colors = normalizeTheme(theme).tokens.color;
  const checks = [["text", "surface"], ["mutedText", "surface"], ["text", "background"]];
  return checks.flatMap(([foreground, background]) => {
    const ratio = contrastRatio(colors[foreground], colors[background]);
    return ratio !== null && ratio < 4.5 ? [issue(`theme.tokens.color.${foreground}`, `contrast against ${background} is ${ratio.toFixed(2)}:1; target is 4.5:1`)] : [];
  });
}
