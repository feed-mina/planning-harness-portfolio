import { access, copyFile, cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateStudioManifest } from "./manifest-versioning.js";

const exampleTemplates = new Map([
  ["address-select-block", fileURLToPath(new URL("../examples/address-select-block/", import.meta.url))],
  ["garden-knowledge-base", fileURLToPath(new URL("../examples/garden-knowledge-base/", import.meta.url))],
]);

const planningHarnessTemplates = new Map([
  ["garden-knowledge-base", {
    manifest: createGardenManifest,
    files: [
      ["app/migrations/0030_gardens_sdui.sql", "migrations/ui_metadata.sql"],
      ["app/public/assets/sdui-garden.js", "public/assets/sdui-garden.js"],
      ["templates/sdui-template-kit/api-contract.md", "api-contract.md"],
    ],
    generated: [
      ["README.md", gardenReadme],
      ["public/index.html", gardenShell],
    ],
  }],
]);

async function listFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path, base));
    } else if (entry.isFile()) {
      files.push(relative(base, path).replaceAll("\\", "/"));
    }
  }

  return files.sort();
}

async function ensureFile(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

async function copyMappedFiles(sourceRoot, outputDir, mappings) {
  for (const [from, to] of mappings) {
    const sourcePath = resolve(sourceRoot, from);
    const targetPath = resolve(outputDir, to);
    await ensureFile(sourcePath, from);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

function gardenI18nMessages() {
  return {
    ko: {
      "pages.garden.title": "가든",
      "studio.labels.import": "가져오기",
      "studio.labels.explorer": "탐색기",
      "studio.labels.editor": "편집기",
      "studio.labels.preview": "미리보기",
      "studio.labels.commands": "명령",
      "studio.labels.loadGarden": "가든 불러오기",
      "studio.labels.importManifest": "Manifest 가져오기",
      "studio.labels.reset": "초기화",
      "studio.labels.template": "템플릿",
      "studio.labels.id": "ID",
      "studio.labels.version": "버전",
      "studio.labels.tier": "티어",
      "studio.labels.locale": "언어",
      "studio.labels.messages": "메시지",
      "studio.labels.title": "제목",
      "studio.labels.route": "경로",
      "studio.labels.source": "소스",
      "studio.labels.metadata": "메타데이터",
      "studio.labels.routes": "경로",
      "studio.labels.endpoints": "엔드포인트",
      "studio.labels.environment": "환경",
      "studio.labels.bindings": "바인딩",
      "studio.labels.secrets": "시크릿",
      "studio.labels.gates": "게이트",
      "studio.labels.importDryRun": "가져오기 Dry-run",
      "studio.labels.exportPackage": "패키지 내보내기",
      "studio.labels.packageFiles": "패키지 파일",
    },
    en: {
      "pages.garden.title": "Garden",
      "studio.labels.import": "Import",
      "studio.labels.explorer": "Explorer",
      "studio.labels.editor": "Editor",
      "studio.labels.preview": "Preview",
      "studio.labels.commands": "Commands",
      "studio.labels.loadGarden": "Load Garden",
      "studio.labels.importManifest": "Import Manifest",
      "studio.labels.reset": "Reset",
      "studio.labels.template": "Template",
      "studio.labels.id": "ID",
      "studio.labels.version": "Version",
      "studio.labels.tier": "Tier",
      "studio.labels.locale": "Locale",
      "studio.labels.messages": "Messages",
      "studio.labels.title": "Title",
      "studio.labels.route": "Route",
      "studio.labels.source": "Source",
      "studio.labels.metadata": "Metadata",
      "studio.labels.routes": "Routes",
      "studio.labels.endpoints": "Endpoints",
      "studio.labels.environment": "Environment",
      "studio.labels.bindings": "Bindings",
      "studio.labels.secrets": "Secrets",
      "studio.labels.gates": "Gates",
      "studio.labels.importDryRun": "Import dry-run",
      "studio.labels.exportPackage": "Export package",
      "studio.labels.packageFiles": "Package Files",
    },
  };
}

function createGardenManifest() {
  return {
    schema: "feedmina.sdui.template.v1",
    id: "garden-knowledge-base",
    name: "Garden/Knowledge Base Template",
    version: "0.1.0",
    recommendedTier: "pro-template",
    runtimeAdapters: ["cloudflare-worker-static"],
    defaultLocale: "ko",
    locales: ["ko", "en"],
    messages: gardenI18nMessages(),
    pages: [
      {
        id: "garden",
        sourceKind: "page_key",
        title: "Garden",
        route: "/garden/",
        metadataRef: "migrations/ui_metadata.sql",
        pluginRefs: ["garden"],
      },
    ],
    metadata: {
      format: "sql",
      sources: ["migrations/ui_metadata.sql"],
    },
    components: ["TEXT", "INPUT", "TEXTAREA", "SELECT", "CHECKBOX", "BUTTON", "GROUP", "WIDGET"],
    plugins: [
      {
        id: "garden",
        kind: "page-plugin",
        runtimeAdapters: ["cloudflare-worker-static"],
        entry: "public/assets/sdui-garden.js",
        provides: {
          actions: ["NEW_GARDEN_FORM", "SAVE_GARDEN", "BUILD_GARDEN"],
          hydrators: ["github_repos", "gardens"],
          widgets: ["garden_config_preview", "garden_builds"],
        },
      },
    ],
    api: {
      contract: "api-contract.md",
      endpoints: [
        { method: "GET", path: "/api/ui/garden", auth: "public metadata with role filtering" },
        { method: "GET", path: "/api/git/repos", auth: "provider:github" },
        { method: "GET", path: "/api/gardens", auth: "provider:github" },
        { method: "POST", path: "/api/gardens", auth: "provider:github" },
        { method: "POST", path: "/api/gardens/:gardenId/build", auth: "provider:github" },
      ],
    },
    env: {
      bindings: ["DB", "R2"],
      secrets: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
    },
    gating: {
      free: ["manual-config-preview", "manual-artifact-handoff"],
      "pro-template": ["template-package"],
      hosted: ["managed-deploy", "scheduled-sync", "team-sharing"],
    },
    source: {
      kind: "planning-harness",
      files: planningHarnessTemplates.get("garden-knowledge-base").files.map(([from, to]) => ({ from, to })),
    },
  };
}

function gardenReadme() {
  return `# Garden/Knowledge Base Template

Exported from planning-harness source files.

This package includes:

- \`template.manifest.json\`
- \`migrations/ui_metadata.sql\`
- \`public/assets/sdui-garden.js\`
- \`api-contract.md\`

Run \`sdui-kit import <this-dir> --target cloudflare-worker-static --dry-run\` before applying it.
`;
}

function gardenShell() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Garden SDUI Template</title>
  </head>
  <body>
    <main id="app" data-sdui-template="garden-knowledge-base"></main>
    <script type="module" src="./assets/sdui-garden.js"></script>
  </body>
</html>
`;
}

export function listExampleTemplates() {
  return Array.from(exampleTemplates.keys()).sort();
}

export function listSourceTemplates(source) {
  if (source === "example") return listExampleTemplates();
  if (source === "planning-harness") return Array.from(planningHarnessTemplates.keys()).sort();
  return [];
}

export function defaultPlanningHarnessRoot(cwd = process.cwd()) {
  return resolve(cwd, "..", "planning-harness");
}

export async function exportExampleTemplate({ template, outDir }) {
  const sourceDir = exampleTemplates.get(template);
  if (!sourceDir) {
    throw new Error(`Unknown example template: ${template}. Available: ${listExampleTemplates().join(", ")}`);
  }

  const outputDir = resolve(outDir);
  const sourceStats = await stat(sourceDir);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Example template is not a directory: ${sourceDir}`);
  }

  await mkdir(dirname(outputDir), { recursive: true });
  await cp(sourceDir, outputDir, { recursive: true, force: true });

  return {
    template,
    source: "example",
    outDir: outputDir,
    files: await listFiles(outputDir),
  };
}

export async function exportPlanningHarnessTemplate({ template, outDir, sourceRoot = defaultPlanningHarnessRoot() }) {
  const config = planningHarnessTemplates.get(template);
  if (!config) {
    throw new Error(`Unknown planning-harness template: ${template}. Available: ${listSourceTemplates("planning-harness").join(", ")}`);
  }

  const outputDir = resolve(outDir);
  const root = sourceRoot instanceof URL ? fileURLToPath(sourceRoot) : resolve(sourceRoot);
  await ensureFile(root, "planning-harness source root");
  await mkdir(outputDir, { recursive: true });
  await copyMappedFiles(root, outputDir, config.files);

  const manifestPath = join(outputDir, "template.manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(migrateStudioManifest(config.manifest()), null, 2)}\n`, "utf8");

  for (const [to, contentFactory] of config.generated) {
    const targetPath = resolve(outputDir, to);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, contentFactory(), "utf8");
  }

  return {
    template,
    source: "planning-harness",
    sourceRoot: root,
    outDir: outputDir,
    files: await listFiles(outputDir),
  };
}

export async function exportTemplate({ source, template, outDir, sourceRoot }) {
  if (source === "example") return exportExampleTemplate({ template, outDir });
  if (source === "planning-harness") return exportPlanningHarnessTemplate({ template, outDir, sourceRoot });
  throw new Error(`Unsupported export source: ${source}. Supported: example, planning-harness`);
}
