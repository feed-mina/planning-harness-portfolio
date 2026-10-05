"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const appRoot = path.resolve(__dirname, "..");
const read = (relPath) => fs.readFileSync(path.join(appRoot, relPath), "utf8");
const exists = (relPath) => fs.existsSync(path.join(appRoot, relPath));

test("address select example manifest captures preview and runtime adapter boundaries", () => {
  const manifest = JSON.parse(read("public/examples/address-select-block/template.manifest.json"));
  assert.equal(manifest.schema, "feedmina.sdui.template.v1");
  assert.equal(manifest.id, "address-select-block");
  assert.equal(manifest.recommendedTier, "pro-template");
  assert.deepEqual(manifest.runtimeAdapters, ["cloudflare-worker-static", "react-next"]);
  assert.equal(manifest.pages[0].metadataRef, "metadata/address-select-block.screen.json");
  assert.equal(manifest.plugins[0].entry, "plugins/address-select-block.manifest.json");
  assert.ok(manifest.risks.some((item) => /current editor repository is still inaccessible/i.test(item)));
});

test("address select example ships every file referenced by the manifest", () => {
  const manifest = JSON.parse(read("public/examples/address-select-block/template.manifest.json"));
  const baseDir = "public/examples/address-select-block";

  for (const source of manifest.metadata.sources) {
    assert.ok(exists(path.join(baseDir, source)), `missing metadata source: ${source}`);
  }
  assert.ok(exists(path.join(baseDir, manifest.api.contract)), `missing api contract: ${manifest.api.contract}`);
  for (const plugin of manifest.plugins) {
    assert.ok(exists(path.join(baseDir, plugin.entry)), `missing plugin entry: ${plugin.entry}`);
  }
});

test("address select block metadata draft normalizes keys and separates preview from real providers", () => {
  const metadata = JSON.parse(read("public/examples/address-select-block/metadata/address-select-block.screen.json"));
  assert.equal(metadata.editorBlock.component_type, "ADDRESS_BLOCK");
  assert.deepEqual(metadata.editorBlock.options, {
    label: "주소",
    required: true,
    provider: "mock",
    previewMode: true,
  });
  assert.deepEqual(metadata.compileTargets["cloudflare-worker-static"].normalizedValueKeys, ["zipCode", "roadAddress", "detailAddress"]);
  assert.equal(metadata.compileTargets["cloudflare-worker-static"].previewAdapter, "mock");
  assert.equal(metadata.compileTargets["cloudflare-worker-static"].realAdapter, "web-daum");
  assert.equal(metadata.compileTargets["react-next"].realAdapter, "mobile-native");
  assert.deepEqual(metadata.compileTargets["cloudflare-worker-static"].compiledSdui.fieldKeyMap, {
    zipCode: "zip_code",
    roadAddress: "road_address",
    detailAddress: "detail_address",
  });
});

test("bundled catalog and exporter expose canonical example template identifiers", async () => {
  const { BUNDLED_TEMPLATE_CATALOG } = await import(pathToFileURL(path.join(appRoot, "public/src/template-catalog.js")).href);
  const { listExampleTemplates } = await import(pathToFileURL(path.join(appRoot, "public/src/export-template.js")).href);

  const catalogIds = BUNDLED_TEMPLATE_CATALOG.map((entry) => entry.id);
  assert.ok(catalogIds.includes("address-select-block"));
  assert.ok(catalogIds.includes("garden-knowledge-base"));
  assert.ok(catalogIds.includes("kride-ai-chat"));

  const addressEntry = BUNDLED_TEMPLATE_CATALOG.find((entry) => entry.id === "address-select-block");
  assert.equal(addressEntry.manifestPath, "../examples/address-select-block/template.manifest.json");

  const exampleTemplates = listExampleTemplates();
  assert.ok(exampleTemplates.includes("address-select-block"));
  assert.ok(exampleTemplates.includes("garden-knowledge-base"));
});
