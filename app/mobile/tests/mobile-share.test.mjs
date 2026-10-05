import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const mobileDir = path.resolve(testDir, "..");
const appDir = path.resolve(mobileDir, "..");
const shareSource = await readFile(path.join(appDir, "public", "assets", "mobile-share.js"), "utf8");

function loadShare({ native = true, plugins = {}, web = {} } = {}) {
  const context = {
    Blob,
    crypto: webcrypto,
    setTimeout: web.setTimeout || ((callback) => callback()),
    URL: web.URL,
    document: web.document,
    Capacitor: {
      isNativePlatform: () => native,
      registerPlugin: (name) => plugins[name],
    },
  };
  vm.runInNewContext(shareSource, context, { filename: "mobile-share.js" });
  return context.HarnessMobileShare;
}

function nativeMocks({ shareError, cleanupError, staleCleanupFailures = 0 } = {}) {
  const calls = [];
  let remainingStaleCleanupFailures = staleCleanupFailures;
  const filesystem = {
    async writeFile(options) {
      calls.push(["writeFile", options]);
      return { uri: `file:///cache/${options.path}` };
    },
    async deleteFile(options) {
      calls.push(["deleteFile", options]);
      if (cleanupError) throw cleanupError;
    },
    async rmdir(options) {
      calls.push(["rmdir", options]);
      if (options.path === "shared-markdown" && remainingStaleCleanupFailures > 0) {
        remainingStaleCleanupFailures -= 1;
        throw Object.assign(new Error("stale cleanup denied"), { code: "OS-PLUG-FILE-0013" });
      }
      if (options.path !== "shared-markdown" && cleanupError) throw cleanupError;
    },
  };
  const share = {
    async canShare() {
      calls.push(["canShare"]);
      return { value: true };
    },
    async share(options) {
      calls.push(["share", options]);
      if (shareError) throw shareError;
      return { activityType: "test.receiver" };
    },
  };
  return { calls, plugins: { Filesystem: filesystem, Share: share } };
}

test("safe Markdown filenames remove traversal, controls, and reserved device names", () => {
  const api = loadShare({ native: false });
  assert.equal(api.safeMarkdownFileName("CON.md"), "_CON.md");
  assert.equal(api.safeMarkdownFileName("CON.txt.md"), "_CON.txt.md");
  const safe = api.safeMarkdownFileName("../../회의록\u202E:<draft>?.md");
  assert.match(safe, /^[^<>:"/\\|?*\u0000-\u001f]+\.md$/u);
  assert.doesNotMatch(safe, /\.\./);
  assert.ok(Array.from(safe).length <= 83);
});

test("native share writes UTF-8 Markdown to a private cache subtree and always removes it", async () => {
  const mocks = nativeMocks();
  const api = loadShare({ plugins: mocks.plugins });
  const result = await api.shareMarkdown({ markdown: "# 회의록\n", fileName: "2026-07-19_meeting.md" });

  assert.equal(result.status, "completed");
  assert.deepEqual(mocks.calls.map(([name]) => name), ["rmdir", "canShare", "writeFile", "share", "deleteFile", "rmdir"]);
  assert.equal(mocks.calls[0][1].path, "shared-markdown");
  const write = mocks.calls[2][1];
  assert.equal(write.directory, "CACHE");
  assert.equal(write.encoding, "utf8");
  assert.equal(write.recursive, true);
  assert.match(write.path, /^shared-markdown\/[0-9a-f-]+\/2026-07-19_meeting\.md$/);
  const shared = mocks.calls[3][1];
  assert.deepEqual(Array.from(shared.files), [`file:///cache/${write.path}`]);
  assert.equal(mocks.calls[4][1].path, write.path);
  assert.equal(mocks.calls[5][1].path, write.path.replace(/\/[^/]+$/, ""));
});

test("startup cleanup removes Markdown left by an interrupted process", async () => {
  const mocks = nativeMocks();
  const api = loadShare({ plugins: mocks.plugins });
  const result = await api.cleanupStaleShares();

  assert.equal(result.status, "completed");
  assert.deepEqual(mocks.calls.map(([name]) => name), ["rmdir"]);
  assert.equal(mocks.calls[0][1].path, "shared-markdown");
  assert.equal(mocks.calls[0][1].directory, "CACHE");
  assert.equal(mocks.calls[0][1].recursive, true);
});

test("stale cleanup failure is explicit and the serialized queue can retry", async () => {
  const mocks = nativeMocks({ staleCleanupFailures: 1 });
  const api = loadShare({ plugins: mocks.plugins });

  await assert.rejects(api.cleanupStaleShares(), (error) => error.code === "stale_cleanup_failed");
  const result = await api.shareMarkdown({ markdown: "# retry", fileName: "retry.md" });
  assert.equal(result.status, "completed");
  assert.equal(mocks.calls.filter(([name, options]) => name === "rmdir" && options.path === "shared-markdown").length, 2);
});

test("share cancellation is non-fatal and still cleans the cache file", async () => {
  const mocks = nativeMocks({ shareError: new Error("Share canceled") });
  const api = loadShare({ plugins: mocks.plugins });
  const result = await api.shareMarkdown({ markdown: "# 취소 테스트", fileName: "cancel.md" });

  assert.equal(result.status, "cancelled");
  assert.deepEqual(mocks.calls.map(([name]) => name), ["rmdir", "canShare", "writeFile", "share", "deleteFile", "rmdir"]);
});

test("cleanup failure is reported even after the share sheet resolves", async () => {
  const cleanupError = Object.assign(new Error("permission denied"), { code: "OS-PLUG-FILE-0013" });
  const mocks = nativeMocks({ cleanupError });
  const api = loadShare({ plugins: mocks.plugins });
  await assert.rejects(
    api.shareMarkdown({ markdown: "# cleanup", fileName: "cleanup.md" }),
    (error) => error.code === "cleanup_failed",
  );
  assert.equal(mocks.calls.at(-1)[0], "rmdir");
});

test("web fallback downloads the same sanitized Markdown without invoking native plugins", async () => {
  let clicked = false;
  let removed = false;
  let revoked = "";
  let capturedBlob;
  const anchor = {
    click() { clicked = true; },
    remove() { removed = true; },
  };
  const api = loadShare({
    native: false,
    web: {
      URL: {
        createObjectURL(blob) { capturedBlob = blob; return "blob:test"; },
        revokeObjectURL(url) { revoked = url; },
      },
      document: {
        createElement: () => anchor,
        body: { appendChild: () => {} },
      },
    },
  });
  const result = await api.shareMarkdown({ markdown: "# web", fileName: "../web?.md" });

  assert.equal(result.mode, "download");
  assert.equal(anchor.download, "web.md");
  assert.equal(clicked, true);
  assert.equal(removed, true);
  assert.equal(revoked, "blob:test");
  const bytes = new Uint8Array(await capturedBlob.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
  assert.equal(new TextDecoder().decode(bytes), "# web");
});

test("native project exposes only the Markdown cache subtree and bundles the iOS privacy manifest", async () => {
  const [paths, manifest, project, swiftPackage, packageJson, featureSource] = await Promise.all([
    readFile(path.join(mobileDir, "android", "app", "src", "main", "res", "xml", "file_paths.xml"), "utf8"),
    readFile(path.join(mobileDir, "ios", "App", "PrivacyInfo.xcprivacy"), "utf8"),
    readFile(path.join(mobileDir, "ios", "App", "App.xcodeproj", "project.pbxproj"), "utf8"),
    readFile(path.join(mobileDir, "ios", "App", "CapApp-SPM", "Package.swift"), "utf8"),
    readFile(path.join(mobileDir, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(appDir, "public", "assets", "feature.js"), "utf8"),
  ]);

  assert.match(paths, /<cache-path name="shared_markdown" path="shared-markdown\/"\s*\/>/);
  assert.doesNotMatch(paths, /<(?:external-path|external-cache-path|files-path)\b/);
  assert.match(manifest, /NSPrivacyAccessedAPICategoryFileTimestamp/);
  assert.match(manifest, /<string>C617\.1<\/string>/);
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
  assert.match(swiftPackage, /path: "\.\.\/\.\.\/\.\.\/node_modules\/@capacitor\/filesystem"/);
  assert.doesNotMatch(swiftPackage, /path: "[^"]*\\/);
  assert.equal(packageJson.dependencies["@capacitor/filesystem"], "8.1.2");
  assert.equal(packageJson.dependencies["@capacitor/share"], "8.0.1");
  assert.match(featureSource, /cleanupStaleShares\?\.\(\)\.catch/);
});
