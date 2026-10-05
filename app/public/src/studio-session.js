import { getManifestI18n, pushI18nWarning, resolvePageTitle, resolveStudioLabel } from "./i18n.js";
import { validateTemplateManifest } from "./manifest.js";
import { createImportDryRunReport } from "./import-report.js";
import { listThemeTokens, normalizeTheme, themeTokensToCssText, validateThemeTokens } from "./theme-tokens.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const LABEL_FALLBACKS = {
  import: "Import",
  explorer: "Explorer",
  editor: "Editor",
  preview: "Preview",
  commands: "Commands",
  loadGarden: "Load Garden",
  importManifest: "Import Manifest",
  reset: "Reset",
  template: "Template",
  id: "ID",
  version: "Version",
  tier: "Tier",
  locale: "Locale",
  messages: "Messages",
  title: "Title",
  route: "Route",
  source: "Source",
  metadata: "Metadata",
  routes: "Routes",
  endpoints: "Endpoints",
  environment: "Environment",
  bindings: "Bindings",
  secrets: "Secrets",
  gates: "Gates",
  importDryRun: "Import dry-run",
  exportPackage: "Export package",
  packageFiles: "Package Files",
  theme: "Theme",
  tokens: "Tokens",
  cssVariables: "CSS Variables",
  configured: "Configured",
};

function buildLabels(manifest, locale, warnings) {
  return Object.fromEntries(
    Object.entries(LABEL_FALLBACKS).map(([key, fallback]) => [
      key,
      pushI18nWarning(warnings, resolveStudioLabel(manifest, key, fallback, { locale })),
    ])
  );
}

function editablePage(manifest, page, locale, warnings) {
  const title = pushI18nWarning(warnings, resolvePageTitle(manifest, page, { locale }));
  return {
    id: page.id,
    title,
    literalTitle: page.title,
    route: page.route,
    sourceKind: page.sourceKind,
    metadataRef: page.metadataRef,
    editableFields: [
      { path: "title", type: "text", value: title },
      { path: "route", type: "text", value: page.route },
      { path: "pluginRefs", type: "list", value: asArray(page.pluginRefs) },
    ],
  };
}

function pluginPanel(plugin) {
  return {
    id: plugin.id,
    kind: plugin.kind,
    entry: plugin.entry,
    runtimeAdapters: asArray(plugin.runtimeAdapters),
    provides: plugin.provides || {},
  };
}

function gatePanel(gating = {}) {
  return Object.entries(gating).map(([tier, features]) => ({
    tier,
    features: asArray(features),
  }));
}

function dryRunCommand(adapter, locale) {
  const target = adapter || "<adapter>";
  const localeFlag = locale ? ` --locale ${locale}` : "";
  return `sdui-kit import <template-dir> --target ${target}${localeFlag} --dry-run`;
}

export function createStudioSession(manifest, options = {}) {
  const adapter = options.adapter || asArray(manifest.runtimeAdapters)[0] || null;
  const missingFiles = options.missingFiles || [];
  const i18nBase = getManifestI18n(manifest, options.locale);
  const locale = i18nBase.selectedLocale;
  const validation = validateTemplateManifest(manifest);
  const dryRun = createImportDryRunReport(manifest, { adapter, missingFiles, locale });
  const i18nWarnings = [];
  const labels = buildLabels(manifest, locale, i18nWarnings);
  const editorPages = asArray(manifest.pages).map((page) => editablePage(manifest, page, locale, i18nWarnings));
  const themeValidation = validateThemeTokens(manifest.theme);
  const theme = normalizeTheme(manifest.theme);

  return {
    mode: "studio-dry-run",
    template: dryRun.template,
    validation,
    theme: {
      configured: themeValidation.configured,
      version: theme.version,
      tokens: listThemeTokens(theme),
      cssText: themeTokensToCssText(theme),
      issues: themeValidation.issues,
      warnings: themeValidation.warnings || [],
      applyToAllScreens: theme.applyToAllScreens,
    },
    i18n: {
      ...dryRun.i18n,
      labels,
      warnings: i18nWarnings,
    },
    navigation: {
      pages: editorPages.map((page) => ({
        id: page.id,
        title: page.title,
        route: page.route,
      })),
    },
    editor: {
      pages: editorPages,
      plugins: asArray(manifest.plugins).map(pluginPanel),
      gates: gatePanel(manifest.gating),
      env: dryRun.creates.env,
    },
    preview: {
      adapter,
      adapterSupported: dryRun.adapterSupported,
      routes: editorPages.map((page) => ({
        pageId: page.id,
        title: page.title,
        route: page.route,
        metadataRef: page.metadataRef,
      })),
      endpoints: dryRun.creates.endpoints,
      missingFiles,
    },
    export: {
      manifestPath: "template.manifest.json",
      packageFiles: dryRun.filesystem.requiredFiles,
      dryRunCommand: dryRunCommand(adapter, locale),
    },
  };
}

export function applyPageEdit(manifest, pageId, patch) {
  return {
    ...manifest,
    pages: asArray(manifest.pages).map((page) => (
      page.id === pageId ? { ...page, ...patch } : page
    )),
  };
}
