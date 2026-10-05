"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const read = (relPath) => fs.readFileSync(path.join(appRoot, relPath), "utf8");

// --- Garden 분석·설계·회의록 연결 드롭다운: 개수 한계 + 최근 자료 미반영 ---

test("garden picker requests up to 200 docs per type and the server clamps allow it", () => {
  const garden = read("public/assets/sdui-garden.js");
  assert.match(garden, /const SOURCE_OPTION_FETCH_LIMIT = 200;/);
  assert.match(garden, /api\(`\/api\/analysis\/sessions\?limit=\$\{SOURCE_OPTION_FETCH_LIMIT\}`\)/);
  assert.match(garden, /api\(`\/api\/meetings\?limit=\$\{SOURCE_OPTION_FETCH_LIMIT\}`\)/);

  const analysis = read("src/domains/analysis/analysis.ts");
  assert.match(analysis, /Math\.min\(200, Math\.max\(1, Number\(limitValue\) \|\| 20\)\)/, "분석 세션 clamp 가 픽커 요청(200)보다 작으면 목록이 잘린다");
  const meetings = read("src/domains/meeting/meetings.ts");
  assert.match(meetings, /Math\.min\(200, Math\.max\(1, limit\)\)/, "회의록 clamp 가 픽커 요청(200)보다 작으면 목록이 잘린다");
});

test("server lists stay newest-first so recent docs are inside the capped window", () => {
  const analysis = read("src/domains/analysis/analysis.ts");
  assert.match(analysis, /ORDER BY s\.updated_at DESC\s*\n?\s*LIMIT \?/);
  const meetings = read("src/domains/meeting/meetings.ts");
  assert.match(meetings, /ORDER BY created_at DESC LIMIT \?/);
});

test("garden picker reloads options when reopened or when the tab comes back", () => {
  const garden = read("public/assets/sdui-garden.js");
  assert.match(garden, /function refreshSourceOptionsSoon\(ctx\)/);
  assert.match(garden, /\["pointerdown", "focus"\]\.forEach\(\(type\) => ctx\.refs\.gardenSourceSelect\.addEventListener\(type, \(\) => refreshSourceOptionsSoon\(ctx\)\)\)/);
  assert.match(garden, /document\.addEventListener\("visibilitychange", \(\) => \{ if \(!document\.hidden\) refreshSourceOptionsSoon\(ctx\); \}\)/);
  assert.match(garden, /window\.addEventListener\("pageshow", \(event\) => \{ if \(event\.persisted\) refreshSourceOptionsSoon\(ctx\); \}\)/);
  assert.match(garden, /SOURCE_OPTION_REFRESH_MS/, "재조회는 스로틀되어야 한다");
});

test("garden picker refresh keeps existing options when a fetch fails", () => {
  const garden = read("public/assets/sdui-garden.js");
  assert.match(garden, /api\(`\/api\/analysis\/sessions\?limit=\$\{SOURCE_OPTION_FETCH_LIMIT\}`\)\.catch\(\(\) => null\)/);
  assert.match(garden, /api\(`\/api\/meetings\?limit=\$\{SOURCE_OPTION_FETCH_LIMIT\}`\)\.catch\(\(\) => null\)/);
  assert.match(garden, /const keep = \(type\) => state\.sourceOptions\.filter\(\(item\) => item\.source_type === type\);/);
  assert.match(garden, /: keep\("analysis"\)/);
  assert.match(garden, /: keep\("meeting"\)/);
});

test("garden picker options carry a date so recent docs are recognisable", () => {
  const garden = read("public/assets/sdui-garden.js");
  assert.match(garden, /function sourceOptionLabel\(item\)/);
  assert.match(garden, /item\.date \|\| item\.updated_at \|\| item\.created_at/);
  assert.match(garden, /esc\(sourceOptionLabel\(item\)\)/);
});

test("garden picker rebuilds the select only when option contents changed", () => {
  const garden = read("public/assets/sdui-garden.js");
  assert.match(garden, /if \(state\.sourceOptionsHtml === html\) return;/);
  assert.match(garden, /state\.sourceOptionsHtml = html;/);
});

test("sibling doc pickers request the same raised limit", () => {
  const content = read("public/assets/sdui-content.js");
  assert.match(content, /api\("\/api\/analysis\/sessions\?limit=200"\)/);
  assert.match(content, /api\("\/api\/meetings\?limit=200"\)/);
  assert.match(read("public/assets/analysis.js"), /\/api\/meetings\?limit=200/);
  assert.match(read("public/assets/analysis-edit2.js"), /\/api\/meetings\?limit=200/);
});
