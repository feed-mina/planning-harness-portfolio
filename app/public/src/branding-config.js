const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CHANNELS = new Set(["stable", "beta"]);
const SIGNING = new Set(["platform", "external"]);

function safeUrl(value, path, issues, { relative = false } = {}) {
  if (!value) return;
  if (relative && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !/[\u0000-\u001f]/.test(value)) return;
  try { if (new URL(value).protocol === "https:") return; } catch {}
  issues.push({ path, message: "must be an HTTPS URL" });
}

export function validateBrandingConfig(input = {}) {
  const issues = [];
  if (typeof input.appName !== "string" || !input.appName.trim() || input.appName.length > 80 || /[\u0000-\u001f]/.test(input.appName)) issues.push({ path: "appName", message: "must be 1-80 printable characters" });
  safeUrl(input.logoUrl, "logoUrl", issues, { relative: true });
  safeUrl(input.iconUrl, "iconUrl", issues, { relative: true });
  safeUrl(input.supportUrl, "supportUrl", issues);
  if (input.domain && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(input.domain)) issues.push({ path: "domain", message: "must be a valid hostname" });
  for (const key of ["primary", "background", "text"]) if (input.theme?.[key] && !HEX.test(input.theme[key])) issues.push({ path: `theme.${key}`, message: "must be a 6-digit hex color" });
  if (input.desktop?.updateChannel && !CHANNELS.has(input.desktop.updateChannel)) issues.push({ path: "desktop.updateChannel", message: "must be stable or beta" });
  if (input.desktop?.signing?.strategy && !SIGNING.has(input.desktop.signing.strategy)) issues.push({ path: "desktop.signing.strategy", message: "must be platform or external" });
  if (input.desktop?.signing?.keyId && !/^[A-Za-z0-9._-]{1,100}$/.test(input.desktop.signing.keyId)) issues.push({ path: "desktop.signing.keyId", message: "must be a safe non-secret identifier" });
  const templates = input.preinstalledTemplates || [];
  if (!Array.isArray(templates) || templates.length > 20 || templates.some((id) => typeof id !== "string" || !ID.test(id)) || new Set(templates).size !== templates.length) issues.push({ path: "preinstalledTemplates", message: "must contain up to 20 unique template IDs" });
  return { valid: issues.length === 0, issues };
}

export function normalizeBrandingConfig(input = {}) {
  const config = {
    appName: input.appName?.trim() || "SDUI Studio",
    logoUrl: input.logoUrl || "",
    iconUrl: input.iconUrl || "",
    domain: input.domain?.toLowerCase() || "",
    supportUrl: input.supportUrl || "",
    theme: { primary: "#6557d7", background: "#f5f7fb", text: "#172033", ...(input.theme || {}) },
    desktop: { updateChannel: input.desktop?.updateChannel || "stable", signing: { strategy: input.desktop?.signing?.strategy || "platform", keyId: input.desktop?.signing?.keyId || "" } },
    preinstalledTemplates: [...(input.preinstalledTemplates || [])],
  };
  const validation = validateBrandingConfig(config);
  if (!validation.valid) throw Object.assign(new Error(`invalid branding config: ${validation.issues[0].message}`), { status: 400, code: "invalid_branding", issues: validation.issues });
  return config;
}

export function brandingRuntimeDescriptor(input) {
  const branding = normalizeBrandingConfig(input);
  return { title: branding.appName, iconUrl: branding.iconUrl, cssVariables: { "--brand-primary": branding.theme.primary, "--brand-background": branding.theme.background, "--brand-text": branding.theme.text }, domain: branding.domain };
}

export function applyBrandingToDocument(document, input) {
  const runtime = brandingRuntimeDescriptor(input);
  document.title = runtime.title;
  for (const [name, value] of Object.entries(runtime.cssVariables)) document.documentElement.style.setProperty(name, value);
  const icon = document.querySelector('link[rel="icon"]');
  if (icon && runtime.iconUrl) icon.href = runtime.iconUrl;
  return runtime;
}
