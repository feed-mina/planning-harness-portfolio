const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

const appRoot = join(__dirname, "..");
const read = (path) => readFileSync(join(appRoot, path), "utf8");

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

test("analytics config is opt-in and validates every public identifier", () => {
  const worker = read("src/router.ts");
  const wrangler = read("wrangler.jsonc");
  assert.match(worker, /path === "\/api\/analytics\/config"/);
  assert.match(worker, /env\.ANALYTICS_ENABLED === "true"/);
  assert.match(worker, /\^G-\[A-Z0-9\]\+\$/);
  assert.match(worker, /\^GTM-\[A-Z0-9\]\+\$/);
  assert.match(wrangler, /"ANALYTICS_ENABLED": "false"/);
});

test("analytics client uses an event and parameter allowlist", () => {
  const analytics = read("public/assets/analytics.js");
  const publicPages = JSON.parse(read("public/assets/public-pages.json"));
  for (const event of [
    "page_view", "cta_click", "file_download", "sign_up", "login",
    "meeting_input_start", "meeting_generate_success", "meeting_generate_error",
    "kanban_create_success", "github_issue_create_success",
  ]) assert.match(analytics, new RegExp(`\\b${event}:`));
  assert.doesNotMatch(analytics, /transcript\s*:/);
  assert.doesNotMatch(analytics, /user_id\s*:/);
  assert.deepEqual(publicPages.publicPaths, ["/", "/ask-todo-hub/", "/dev-setup/", "/feature/", "/stock/"]);
  assert.ok(publicPages.replaySafePaths.every((path) => publicPages.publicPaths.includes(path)));
  assert.match(analytics, /HarnessPublicPageConfig/);
  assert.doesNotMatch(analytics, /new Set\(\["\/"/);
  assert.match(read("../docs/analytics-marketing.md"), /public\/assets\/public-pages\.json[\s\S]*\/stock\//);
  assert.match(read("../docs/seo-google-naver.md"), /\/stock\/[\s\S]*다섯 개/);
});

test("analytics reads the generated public-page contract on every instrumented page", () => {
  const publicRoot = join(appRoot, "public");
  const pages = htmlFiles(publicRoot).filter((file) => readFileSync(file, "utf8").includes("/assets/analytics.js"));
  assert.ok(pages.length > 0);
  for (const file of pages) {
    const page = relative(appRoot, file).split(sep).join("/");
    const html = readFileSync(file, "utf8");
    assert.ok(html.indexOf("/assets/public-pages.js") >= 0, `${page} is missing public-pages.js`);
    assert.ok(html.indexOf("/assets/public-pages.js") < html.indexOf("/assets/analytics.js"), `${page} loads public-page config too late`);
    if (html.includes("/assets/common.js")) {
      assert.ok(html.indexOf("/assets/analytics.js") < html.indexOf("/assets/common.js"), `${page} loads analytics too late`);
    }
  }

  const config = JSON.parse(read("public/assets/public-pages.json"));
  for (const path of config.publicPaths) {
    const page = path === "/" ? "public/index.html" : `public${path}index.html`;
    assert.match(read(page), /\/assets\/analytics\.js/, `${page} is missing analytics.js`);
  }
});

test("404 page exposes its content through a main landmark", () => {
  const html = read("public/404.html");
  assert.match(html, /<main\b[^>]*class="wrap"/);
  assert.match(html, /<h1>404<\/h1>/);
  assert.match(html, /<\/main>/);
});

test("ASK/Todo Hub exposes installer, portable, checksum, and distinct analytics contracts", () => {
  const shell = read("public/ask-todo-hub/index.html");
  const fragment = read("public/assets/sdui-fragments/ask-todo-hub.html");
  assert.match(shell, /ASK\/Todo Hub - Windows 프로젝트 기록 제어 센터/);
  assert.match(fragment, /ASKTodoHub-Setup-latest\.exe/);
  assert.match(fragment, /ASKTodoHub-portable\.zip/);
  assert.match(fragment, /SHA256SUMS\.txt/);
  assert.match(fragment, /\/downloads\/ask-todo-hub\/ASKTodoHub-Setup-latest\.exe/);
  assert.doesNotMatch(fragment, /\/downloads\/ask-todo-hub\/ASKTodoHub\.exe/);
  assert.match(fragment, /\/downloads\/ask-todo-hub\/ASKTodoHub-portable\.zip/);
  assert.match(fragment, /\/downloads\/ask-todo-hub\/version-manifest\.json/);
  assert.match(fragment, /data-analytics-download="ask_todo_installer"/);
  assert.doesNotMatch(fragment, /data-analytics-download="ask_todo_single_file"/);
  assert.match(fragment, /data-analytics-download="ask_todo_portable"/);
  assert.match(fragment, /개인 PC/);
  assert.match(fragment, /임시 PC/);
  assert.doesNotMatch(fragment, /latest\/download\/AskTodoHub\.exe/);
  assert.doesNotMatch(fragment, /github\.com\/feed-mina\/ask-todo-hub\/releases\/latest\/download/);
});

test("ASK/Todo Hub public release manifest matches every published binary", () => {
  const releaseRoot = join(appRoot, "public/downloads/ask-todo-hub");
  const manifest = JSON.parse(readFileSync(join(releaseRoot, "version-manifest.json"), "utf8"));
  const checksumLines = readFileSync(join(releaseRoot, "SHA256SUMS.txt"), "ascii").trim().split(/\r?\n/);
  const checksums = new Map(checksumLines.map((line) => {
    const match = line.match(/^([0-9a-f]{64})  ([^\\/]+)$/);
    assert.ok(match, `invalid checksum line: ${line}`);
    return [match[2], match[1]];
  }));
  const expectedNames = [
    "ASKTodoHub-Setup.exe",
    "ASKTodoHub-Setup-latest.exe",
    "ASKTodoHub-portable.zip",
    `ASKTodoHub-${manifest.version}-portable.zip`,
  ];
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.product, "ASKTodoHub");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.downloadBaseUrl, "https://harness-meeting-app.kibayerin.workers.dev/downloads/ask-todo-hub/");
  assert.deepEqual(manifest.assets.map((asset) => asset.name), expectedNames);
  assert.equal(checksums.size, expectedNames.length);
  for (const asset of manifest.assets) {
    const path = join(releaseRoot, asset.name);
    const bytes = readFileSync(path);
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.equal(statSync(path).size, asset.sizeBytes, `${asset.name} size drift`);
    assert.equal(digest, asset.sha256, `${asset.name} manifest hash drift`);
    assert.equal(digest, checksums.get(asset.name), `${asset.name} checksum drift`);
  }
  const assetsByName = new Map(manifest.assets.map((asset) => [asset.name, asset]));
  assert.equal(
    assetsByName.get("ASKTodoHub-portable.zip").sha256,
    assetsByName.get(`ASKTodoHub-${manifest.version}-portable.zip`).sha256,
    "stable/versioned portable ZIPs must be identical",
  );
  assert.equal(
    assetsByName.get("ASKTodoHub-Setup.exe").sha256,
    assetsByName.get("ASKTodoHub-Setup-latest.exe").sha256,
    "latest installer alias must match canonical installer",
  );
});

test("robots permits noindex pages to be crawled and sitemap is generated", () => {
  const robots = read("public/robots.txt");
  assert.match(robots, /Disallow: \/api\//);
  assert.doesNotMatch(robots, /Disallow: \/(?:analysis|mypage|content|garden)\//);
  assert.match(read("public/studio/index.html"), /name="robots" content="noindex, nofollow"/);
  execFileSync(process.execPath, ["scripts/generate-sitemap.mjs", "--check"], { cwd: appRoot, stdio: "pipe" });
});
