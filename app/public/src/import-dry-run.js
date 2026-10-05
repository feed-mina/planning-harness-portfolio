import { access } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectTemplateFileRefs, createImportDryRunReport } from "./import-report.js";

function isUnsafeRelativePath(path) {
  return isAbsolute(path) || path.split(/[\\/]/).includes("..");
}

export async function findMissingTemplateFiles(manifest, templateDir) {
  const baseDir = templateDir instanceof URL ? fileURLToPath(templateDir) : templateDir;
  const missing = [];
  for (const file of collectTemplateFileRefs(manifest)) {
    if (isUnsafeRelativePath(file)) {
      missing.push({ path: file, reason: "must be a relative path inside the template package" });
      continue;
    }

    try {
      await access(resolve(baseDir, file));
    } catch {
      missing.push({ path: file, reason: "file not found" });
    }
  }
  return missing;
}

export { collectTemplateFileRefs, createImportDryRunReport };
