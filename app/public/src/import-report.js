import { getManifestI18n } from "./i18n.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function endpointId(endpoint) {
  return `${endpoint.method || "GET"} ${endpoint.path || ""}`.trim();
}

export function collectTemplateFileRefs(manifest) {
  const refs = new Set();

  for (const source of asArray(manifest.metadata?.sources)) {
    const file = asString(source);
    if (file) refs.add(file);
  }

  for (const page of asArray(manifest.pages)) {
    const file = asString(page.metadataRef);
    if (file) refs.add(file);
  }

  for (const plugin of asArray(manifest.plugins)) {
    const file = asString(plugin.entry);
    if (file) refs.add(file);
  }

  const apiContract = asString(manifest.api?.contract);
  if (apiContract) refs.add(apiContract);

  return Array.from(refs).sort();
}

export function createImportDryRunReport(manifest, options = {}) {
  const targetAdapter = options.adapter || null;
  const requiredFiles = options.requiredFiles || collectTemplateFileRefs(manifest);
  const missingFiles = options.missingFiles || [];
  const i18n = getManifestI18n(manifest, options.locale);
  const pages = asArray(manifest.pages).map((page) => ({
    id: page.id,
    sourceKind: page.sourceKind,
    route: page.route,
    metadataRef: page.metadataRef,
    pluginRefs: asArray(page.pluginRefs),
  }));

  const plugins = asArray(manifest.plugins).map((plugin) => ({
    id: plugin.id,
    kind: plugin.kind,
    entry: plugin.entry,
    runtimeAdapters: asArray(plugin.runtimeAdapters),
    provides: plugin.provides || {},
  }));

  const endpoints = asArray(manifest.api?.endpoints).map((endpoint) => ({
    id: endpointId(endpoint),
    auth: endpoint.auth || "unspecified",
  }));

  const env = {
    bindings: asArray(manifest.env?.bindings),
    secrets: asArray(manifest.env?.secrets),
    vars: asArray(manifest.env?.vars),
  };

  const gating = Object.fromEntries(
    Object.entries(manifest.gating || {}).map(([tier, features]) => [tier, asArray(features)])
  );

  const adapterSupported = targetAdapter
    ? asArray(manifest.runtimeAdapters).includes(targetAdapter)
    : null;

  return {
    mode: "dry-run",
    template: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      recommendedTier: manifest.recommendedTier,
    },
    targetAdapter,
    adapterSupported,
    i18n,
    creates: {
      pages,
      plugins,
      endpoints,
      env,
      gating,
    },
    filesystem: {
      requiredFiles,
      missingFiles,
    },
    summary: {
      pageCount: pages.length,
      pluginCount: plugins.length,
      endpointCount: endpoints.length,
      bindingCount: env.bindings.length,
      secretCount: env.secrets.length,
      localeCount: i18n.locales.length,
      messageCount: i18n.messageCount,
      requiredFileCount: requiredFiles.length,
      missingFileCount: missingFiles.length,
    },
  };
}
