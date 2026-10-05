import { validateThemeTokens } from "./theme-tokens.js";
import { validateStudioManifest, STUDIO_DOCUMENT_VERSION } from "./manifest-versioning.js";

export const MANIFEST_SCHEMA = "feedmina.sdui.template.v1";

export const RUNTIME_ADAPTERS = new Set([
  "react-next",
  "cloudflare-worker-static",
]);

export const TIERS = new Set([
  "free",
  "pro-template",
  "hosted",
  "ai-ops",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isKebabCase(value) {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function isSemverLike(value) {
  return /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/i.test(value);
}

function isLocaleCode(value) {
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value);
}

function issue(path, message) {
  return { path, message };
}

function requireString(manifest, key, issues) {
  if (typeof manifest[key] !== "string" || !manifest[key].trim()) {
    issues.push(issue(key, "must be a non-empty string"));
  }
}

function validateRuntimeAdapters(value, issues) {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(issue("runtimeAdapters", "must be a non-empty array"));
    return;
  }

  value.forEach((adapter, index) => {
    if (!RUNTIME_ADAPTERS.has(adapter)) {
      issues.push(issue(`runtimeAdapters[${index}]`, `unsupported adapter: ${adapter}`));
    }
  });
}

function validatePages(value, pluginIds, issues, warnings) {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(issue("pages", "must contain at least one page"));
    return;
  }

  value.forEach((page, index) => {
    const base = `pages[${index}]`;
    if (!isRecord(page)) {
      issues.push(issue(base, "must be an object"));
      return;
    }

    for (const key of ["id", "sourceKind", "title", "route", "metadataRef"]) {
      if (typeof page[key] !== "string" || !page[key].trim()) {
        issues.push(issue(`${base}.${key}`, "must be a non-empty string"));
      }
    }

    if (!["page_key", "screen_id"].includes(page.sourceKind)) {
      issues.push(issue(`${base}.sourceKind`, "must be page_key or screen_id"));
    }

    if (page.pluginRefs !== undefined) {
      if (!Array.isArray(page.pluginRefs)) {
        issues.push(issue(`${base}.pluginRefs`, "must be an array when provided"));
      } else {
        page.pluginRefs.forEach((pluginId, pluginIndex) => {
          if (!pluginIds.has(pluginId)) {
            warnings.push(issue(`${base}.pluginRefs[${pluginIndex}]`, `plugin not declared in plugins: ${pluginId}`));
          }
        });
      }
    }
  });
}

function validatePlugins(value, issues) {
  const ids = new Set();
  if (value === undefined) return ids;
  if (!Array.isArray(value)) {
    issues.push(issue("plugins", "must be an array when provided"));
    return ids;
  }

  value.forEach((plugin, index) => {
    const base = `plugins[${index}]`;
    if (!isRecord(plugin)) {
      issues.push(issue(base, "must be an object"));
      return;
    }

    if (typeof plugin.id !== "string" || !plugin.id.trim()) {
      issues.push(issue(`${base}.id`, "must be a non-empty string"));
    } else {
      if (ids.has(plugin.id)) issues.push(issue(`${base}.id`, `duplicate plugin id: ${plugin.id}`));
      ids.add(plugin.id);
    }

    if (typeof plugin.kind !== "string" || !plugin.kind.trim()) {
      issues.push(issue(`${base}.kind`, "must be a non-empty string"));
    }

    validateRuntimeAdapters(plugin.runtimeAdapters, issues);

    if (typeof plugin.entry !== "string" || !plugin.entry.trim()) {
      issues.push(issue(`${base}.entry`, "must be a non-empty string"));
    }
  });

  return ids;
}

function validateGating(value, issues) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(issue("gating", "must be an object when provided"));
    return;
  }

  for (const key of Object.keys(value)) {
    if (!TIERS.has(key)) {
      issues.push(issue(`gating.${key}`, `unsupported tier: ${key}`));
    }
    if (!Array.isArray(value[key])) {
      issues.push(issue(`gating.${key}`, "must be an array of feature ids"));
    }
  }
}

function validateLocaleArray(value, issues) {
  const seen = new Set();
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(issue("locales", "must be a non-empty array when i18n is configured"));
    return seen;
  }

  value.forEach((locale, index) => {
    if (typeof locale !== "string" || !locale.trim()) {
      issues.push(issue(`locales[${index}]`, "must be a non-empty locale string"));
      return;
    }
    if (!isLocaleCode(locale)) {
      issues.push(issue(`locales[${index}]`, `invalid locale code: ${locale}`));
    }
    if (seen.has(locale)) {
      issues.push(issue(`locales[${index}]`, `duplicate locale: ${locale}`));
    }
    seen.add(locale);
  });

  return seen;
}

function validateMessages(value, declaredLocales, issues, warnings) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(issue("messages", "must be an object keyed by locale"));
    return;
  }

  for (const [locale, messages] of Object.entries(value)) {
    if (!isLocaleCode(locale)) {
      issues.push(issue(`messages.${locale}`, `invalid locale code: ${locale}`));
    }
    if (declaredLocales.size && !declaredLocales.has(locale)) {
      warnings.push(issue(`messages.${locale}`, `locale not declared in locales: ${locale}`));
    }
    if (!isRecord(messages)) {
      issues.push(issue(`messages.${locale}`, "must be an object of message keys to strings"));
      continue;
    }
    for (const [key, message] of Object.entries(messages)) {
      if (typeof message !== "string") {
        issues.push(issue(`messages.${locale}.${key}`, "must be a string"));
      }
    }
  }
}

function validateI18n(manifest, issues, warnings) {
  const configured = manifest.defaultLocale !== undefined || manifest.locales !== undefined || manifest.messages !== undefined;
  if (!configured) return;

  if (typeof manifest.defaultLocale !== "string" || !manifest.defaultLocale.trim()) {
    issues.push(issue("defaultLocale", "must be a non-empty string when i18n is configured"));
  } else if (!isLocaleCode(manifest.defaultLocale)) {
    issues.push(issue("defaultLocale", `invalid locale code: ${manifest.defaultLocale}`));
  }

  const declaredLocales = validateLocaleArray(manifest.locales, issues);
  if (typeof manifest.defaultLocale === "string" && manifest.defaultLocale.trim() && declaredLocales.size && !declaredLocales.has(manifest.defaultLocale)) {
    issues.push(issue("defaultLocale", "must be included in locales"));
  }

  validateMessages(manifest.messages, declaredLocales, issues, warnings);
}

export function validateTemplateManifest(manifest) {
  const issues = [];
  const warnings = [];

  if (!isRecord(manifest)) {
    return {
      valid: false,
      issues: [issue("$", "manifest must be a JSON object")],
      warnings,
    };
  }

  requireString(manifest, "schema", issues);
  requireString(manifest, "id", issues);
  requireString(manifest, "name", issues);
  requireString(manifest, "version", issues);
  requireString(manifest, "recommendedTier", issues);

  if (manifest.schema !== MANIFEST_SCHEMA) {
    issues.push(issue("schema", `must be ${MANIFEST_SCHEMA}`));
  }
  if (typeof manifest.id === "string" && !isKebabCase(manifest.id)) {
    issues.push(issue("id", "must be kebab-case"));
  }
  if (typeof manifest.version === "string" && !isSemverLike(manifest.version)) {
    issues.push(issue("version", "must look like semver, for example 0.1.0"));
  }
  if (typeof manifest.recommendedTier === "string" && !TIERS.has(manifest.recommendedTier)) {
    issues.push(issue("recommendedTier", `unsupported tier: ${manifest.recommendedTier}`));
  }

  validateRuntimeAdapters(manifest.runtimeAdapters, issues);
  const pluginIds = validatePlugins(manifest.plugins, issues);
  validatePages(manifest.pages, pluginIds, issues, warnings);
  validateGating(manifest.gating, issues);
  validateI18n(manifest, issues, warnings);
  issues.push(...validateThemeTokens(manifest.theme).issues);
  if (manifest.documentVersion !== undefined && manifest.documentVersion !== STUDIO_DOCUMENT_VERSION) {
    issues.push(issue("documentVersion", `must be ${STUDIO_DOCUMENT_VERSION}`));
  }
  issues.push(...validateStudioManifest(manifest).issues.filter((item) => !item.path.startsWith("theme")));

  return {
    valid: issues.length === 0,
    issues,
    warnings,
  };
}
