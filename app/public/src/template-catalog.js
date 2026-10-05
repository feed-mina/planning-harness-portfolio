import { createImportDryRunReport } from "./import-report.js";
import { validateTemplateManifest } from "./manifest.js";

export const BUNDLED_TEMPLATE_CATALOG = Object.freeze([
  Object.freeze({ id: "address-select-block", project: "Blocks", title: "Address Select Block", description: "주소 검색 preview/mock 과 real/provider 실행을 분리한 기능 블록", tags: ["block", "address", "preview", "adapter"], manifestPath: "../examples/address-select-block/template.manifest.json", thumbnail: "📮" }),
  Object.freeze({ id: "garden-knowledge-base", project: "Garden", title: "Garden Knowledge Base", description: "팀 자료와 지식을 관리하는 다국어 화면", tags: ["knowledge", "i18n", "cloudflare"], manifestPath: "../examples/garden-knowledge-base/template.manifest.json", thumbnail: "🌿" }),
  Object.freeze({ id: "kride-ai-chat", project: "Kride", title: "K-RIDE AI Chat", description: "AI 채팅·지도·여정 패널을 포함한 React 템플릿", tags: ["ai", "chat", "react"], manifestPath: "../examples/kride-ai-chat/template.manifest.json", thumbnail: "🚕" }),
  Object.freeze({ id: "planning-harness-meeting", project: "planning-harness", title: "Planning Harness", description: "회의와 실행 항목을 정리하는 기본 SDUI 구조", tags: ["planning", "meeting", "cloudflare"], manifestPath: "../fixtures/planning-harness/templates/sdui-template-kit/template.manifest.json", thumbnail: "🗂️" }),
]);

export function catalogCompatibility(manifest, targetAdapter = "cloudflare-worker-static") {
  const validation = validateTemplateManifest(manifest);
  if (!validation.valid) return { status: "unsupported", label: "지원하지 않는 버전", validation, report: null };
  const report = createImportDryRunReport(manifest, { adapter: targetAdapter });
  return report.adapterSupported
    ? { status: "ready", label: "바로 사용 가능", validation, report }
    : { status: "convertible", label: "자동 변환 후 사용 가능", validation, report };
}

export function filterCatalog(entries, options = {}) {
  const query = String(options.query || "").trim().toLowerCase();
  return entries.filter((entry) => {
    if (options.project && entry.project !== options.project) return false;
    if (!query) return true;
    return [entry.title, entry.description, entry.project, ...entry.tags].join(" ").toLowerCase().includes(query);
  });
}

export function createCatalogImport(manifest, entry, options = {}) {
  const importedAt = options.importedAt || new Date().toISOString();
  const suffix = options.suffix || Date.now().toString(36);
  const id = options.id || `${manifest.id}-copy-${suffix}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const imported = {
    ...structuredClone(manifest),
    id,
    name: options.name || `${manifest.name} Copy`,
    provenance: {
      sourceProject: entry.project,
      sourceTemplateId: manifest.id,
      sourceVersion: manifest.version,
      importedAt,
    },
  };
  if (options.targetAdapter && !imported.runtimeAdapters.includes(options.targetAdapter)) imported.runtimeAdapters = [options.targetAdapter, ...imported.runtimeAdapters];
  return imported;
}
