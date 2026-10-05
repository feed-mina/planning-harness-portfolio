import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeSwiftPackagePaths } from "../scripts/normalize-native-project.mjs";
import { productionApiBaseUrl, syncWebAssets } from "../scripts/sync-web-assets.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));

test("web asset sync replaces stale files and preserves nested assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-mobile-"));
  const sourceDir = path.join(root, "public");
  const targetDir = path.join(root, "www");

  try {
    await mkdir(path.join(sourceDir, "assets"), { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(sourceDir, "index.html"), "<!doctype html><html><head></head></html>");
    await writeFile(path.join(sourceDir, "assets", "app.js"), "export const ready = true;\n");
    await writeFile(path.join(targetDir, "stale.txt"), "remove me");

    await syncWebAssets({ sourceDir, targetDir });

    assert.equal(await readFile(path.join(targetDir, "index.html"), "utf8"), "<!doctype html><html><head></head></html>");
    assert.equal(await readFile(path.join(targetDir, "assets", "app.js"), "utf8"), "export const ready = true;\n");
    await assert.rejects(readFile(path.join(targetDir, "stale.txt"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native shell does not register the PWA service worker", async () => {
  const commonJs = await readFile(path.resolve(testDir, "..", "..", "public", "assets", "common.js"), "utf8");
  assert.match(commonJs, /window\.Capacitor\?\.isNativePlatform/);
  assert.match(commonJs, /if \(!isNativeShell && "serviceWorker" in navigator/);
});

test("production asset sync embeds the production Worker origin", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-mobile-production-"));
  const sourceDir = path.join(root, "public");
  const targetDir = path.join(root, "www");

  try {
    await mkdir(path.join(sourceDir, "assets"), { recursive: true });
    await writeFile(path.join(sourceDir, "index.html"), "<!doctype html>");

    await syncWebAssets({ sourceDir, targetDir, apiBaseUrl: productionApiBaseUrl });

    assert.match(
      await readFile(path.join(targetDir, "assets", "runtime-config.js"), "utf8"),
      new RegExp(productionApiBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows cap sync paths are normalized for Swift Package Manager", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-mobile-spm-"));
  const packagePath = path.join(root, "Package.swift");
  try {
    await writeFile(packagePath, '.package(name: "Plugin", path: "..\\..\\node_modules\\plugin")\n');
    const result = await normalizeSwiftPackagePaths(packagePath);
    assert.equal(result.changed, true);
    assert.equal(
      await readFile(packagePath, "utf8"),
      '.package(name: "Plugin", path: "../../node_modules/plugin")\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
