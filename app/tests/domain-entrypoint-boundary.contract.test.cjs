const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const domainsRoot = path.join(appRoot, "src", "domains");

const forbiddenEntrypoints = [
  "src/index.ts",
  "src/router.ts",
  "src/queue.ts",
  "src/scheduled.ts",
].map((relativePath) => ({
  relativePath,
  candidates: [
    normalize(path.join(appRoot, relativePath)),
    normalize(path.join(appRoot, relativePath.replace(/\.ts$/, ""))),
  ],
}));

function normalize(filePath) {
  return filePath.split(path.sep).join("/");
}

function listDomainFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listDomainFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith(".ts")) return [fullPath];
    return [];
  });
}

function collectImportSpecifiers(source) {
  const specifiers = [];
  const staticImportPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  for (const pattern of [staticImportPattern, dynamicImportPattern]) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

test("domain modules never import Worker entrypoints", () => {
  const violations = [];

  for (const file of listDomainFiles(domainsRoot)) {
    const source = fs.readFileSync(file, "utf8");
    const relativeFile = normalize(path.relative(appRoot, file));

    for (const specifier of collectImportSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = normalize(path.resolve(path.dirname(file), specifier));
      const matchedEntrypoint = forbiddenEntrypoints.find((entrypoint) =>
        entrypoint.candidates.includes(resolved),
      );
      if (!matchedEntrypoint) continue;
      violations.push(`${relativeFile} -> ${specifier} (${matchedEntrypoint.relativePath})`);
    }
  }

  assert.equal(
    violations.length,
    0,
    `Domain files must stay below the Worker entrypoint layer.\n${violations.join("\n")}`,
  );
});
