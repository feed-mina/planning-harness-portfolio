import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultPackagePath = path.resolve(scriptDir, "..", "ios", "App", "CapApp-SPM", "Package.swift");

export async function normalizeSwiftPackagePaths(packagePath = defaultPackagePath) {
  const source = await readFile(packagePath, "utf8");
  const normalized = source.replace(/(\.package\([^\n]*?path:\s*")([^"]+)(")/g, (_match, before, value, after) => (
    `${before}${value.replace(/\\/g, "/")}${after}`
  ));
  if (normalized !== source) await writeFile(packagePath, normalized, "utf8");
  return { changed: normalized !== source, packagePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await normalizeSwiftPackagePaths();
  console.log(`${result.changed ? "Normalized" : "Verified"} Swift package paths: ${result.packagePath}`);
}
