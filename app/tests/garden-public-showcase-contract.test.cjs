"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const read = (relPath) => fs.readFileSync(path.join(appRoot, relPath), "utf8");

// --- GET /api/gardens/public: 로그인 없는 공개 쇼케이스 (sdui-template-kit 게시 페이지가 서버에서 읽는다) ---

test("public showcase route is login-free and sits before the generic /api/gardens/:id matcher", () => {
  const router = read("src/router.ts");
  const publicIndex = router.indexOf('path === "/api/gardens/public" && request.method === "GET"');
  const genericIndex = router.indexOf('const gardenMatch = path.match(/^\\/api\\/gardens\\/([\\w-]+)$/);');
  assert.ok(publicIndex > 0, "public route exists");
  assert.ok(genericIndex > 0, "generic garden route exists");
  assert.ok(publicIndex < genericIndex, "public route must be matched before /api/gardens/:id, otherwise 'public' is treated as a garden id behind requireLogin()");
  const block = router.slice(publicIndex, router.indexOf("}", publicIndex + 1));
  assert.doesNotMatch(block, /requireLogin\(\)/, "no login gate on the public route");
  assert.match(block, /listPublicGardens\(env, limit\)/);
  assert.match(block, /Math\.min\(50, Math\.max\(1, Number\(url\.searchParams\.get\("limit"\)\) \|\| 20\)\)/);
});

test("public showcase only exposes succeeded, public-source gardens with an https site url, and no user or repo fields", () => {
  const gardens = read("src/domains/content/gardens.ts");
  const start = gardens.indexOf("export async function listPublicGardens(");
  assert.ok(start > 0);
  const body = gardens.slice(start, gardens.indexOf("interface PublicGarden", start));
  assert.match(body, /WHERE g\.status = 'succeeded' AND g\.site_url IS NOT NULL AND g\.site_url <> ''/);
  assert.match(body, /config\.source\?\.visibility !== "public"/);
  assert.match(body, /\^https:\\\/\\\//, "only https site urls are published");
  assert.match(body, /gardens\.push\(\{ id: row\.id, title: row\.title, site_url: row\.site_url as string, last_build_at: row\.last_build_at \}\)/);
  assert.doesNotMatch(body, /user_id|repo:|config_json:|config:/, "no user id, repo or config in the public shape");
});
