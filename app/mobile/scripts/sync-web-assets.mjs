import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileDir = path.resolve(scriptDir, "..");
const defaultSourceDir = path.resolve(mobileDir, "..", "public");
const defaultTargetDir = path.resolve(mobileDir, "www");
export const stagingApiBaseUrl = "https://harness-meeting-app-staging.kibayerin.workers.dev";
export const productionApiBaseUrl = "https://harness-meeting-app.kibayerin.workers.dev";

async function requireWebEntry(sourceDir) {
  const entry = path.join(sourceDir, "index.html");
  const entryStat = await stat(entry).catch(() => null);
  if (!entryStat?.isFile()) {
    throw new Error(`Web asset entry is missing: ${entry}`);
  }
}

/**
 * Sync web assets and embed the selected API origin. The environment variable
 * is used only when the caller does not provide an explicit apiBaseUrl.
 */
export async function syncWebAssets({
  sourceDir = defaultSourceDir,
  targetDir = defaultTargetDir,
  apiBaseUrl = process.env.MOBILE_API_BASE_URL || stagingApiBaseUrl,
} = {}) {
  const source = path.resolve(sourceDir);
  const target = path.resolve(targetDir);

  if (
    source === target
    || source.startsWith(`${target}${path.sep}`)
    || target.startsWith(`${source}${path.sep}`)
  ) {
    throw new Error("Refusing to sync overlapping source and target directories");
  }

  await requireWebEntry(source);
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
  if (!/^https:\/\/[^/]+$/.test(apiBaseUrl)) {
    throw new Error("MOBILE_API_BASE_URL must be an HTTPS origin without a path");
  }
  await writeFile(
    path.join(target, "assets", "runtime-config.js"),
    `window.HarnessRuntimeConfig = Object.freeze(${JSON.stringify({ apiBaseUrl }, null, 2)});\n`,
    "utf8",
  );
  await requireWebEntry(target);

  return { sourceDir: source, targetDir: target, apiBaseUrl };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await syncWebAssets({
    apiBaseUrl: process.argv[2] === "--production"
      ? productionApiBaseUrl
      : undefined,
  });
  console.log(`Synced mobile web assets: ${result.sourceDir} -> ${result.targetDir}`);
}
