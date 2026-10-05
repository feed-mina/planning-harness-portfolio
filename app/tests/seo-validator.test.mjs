import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validatePublicPages } from "../scripts/generate-sitemap.mjs";

const origin = "https://example.test";

function page({ route = "/", title = "Home", description = "Home description", h1 = "Home heading", canonical = `${origin}${route}` } = {}) {
  return `<!doctype html><html><head><title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${canonical}"></head><body><h1>${h1}</h1></body></html>`;
}

function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "planning-harness-seo-"));
  try { return callback(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("public SEO validator accepts complete unique metadata and normalized canonicals", () => withFixture((root) => {
  writeFileSync(join(root, "index.html"), page(), "utf8");
  mkdirSync(join(root, "stock"));
  writeFileSync(join(root, "stock", "index.html"), page({
    route: "/stock/",
    title: "Stock",
    description: "Stock description",
    h1: "Stock heading",
  }), "utf8");
  const pages = validatePublicPages(root, {
    origin,
    publicPaths: ["/", "/stock/"],
    replaySafePaths: ["/"],
  });
  assert.deepEqual(pages.map(({ route }) => route), ["/", "/stock/"]);
}));

test("public SEO validator rejects missing or duplicate metadata and canonical drift", () => withFixture((root) => {
  writeFileSync(join(root, "index.html"), '<!doctype html><html><head><title>Home</title><link rel="canonical" href="https://example.test"></head><body><h1>One</h1><h1>Two</h1></body></html>', "utf8");
  assert.throws(
    () => validatePublicPages(root, { origin, publicPaths: ["/"], replaySafePaths: [] }),
    (error) => {
      assert.match(error.message, /exactly one meta\[name="description"\]; found 0/);
      assert.match(error.message, /exactly one <h1>; found 2/);
      assert.match(error.message, /canonical must be https:\/\/example\.test\//);
      return true;
    },
  );
}));

test("public SEO validator rejects configured and discovered path drift", () => withFixture((root) => {
  writeFileSync(join(root, "index.html"), page(), "utf8");
  assert.throws(
    () => validatePublicPages(root, { origin, publicPaths: ["/", "/stock/"], replaySafePaths: [] }),
    /publicPaths drift/,
  );
}));
