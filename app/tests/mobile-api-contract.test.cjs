const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appRoot = path.resolve(__dirname, "..");

function loadClient(fetchImpl, config = { apiBaseUrl: "" }, navigator = { onLine: true }) {
  const source = fs.readFileSync(path.join(appRoot, "public/assets/api-client.js"), "utf8");
  const window = { fetch: fetchImpl, HarnessRuntimeConfig: config, navigator, URL, Headers, AbortController, setTimeout, clearTimeout };
  vm.runInNewContext(source, { window, URL, Headers, AbortController, setTimeout, clearTimeout });
  return window;
}

test("apiUrl keeps web requests same-origin and resolves mobile HTTPS origin", () => {
  assert.equal(loadClient(async () => {}).apiUrl("/api/me"), "/api/me");
  assert.equal(
    loadClient(async () => {}, { apiBaseUrl: "https://harness-meeting-app-staging.kibayerin.workers.dev" }).apiUrl("/api/me"),
    "https://harness-meeting-app-staging.kibayerin.workers.dev/api/me",
  );
});

test("apiFetch supports methods, multipart bodies, and timeout", async () => {
  const calls = [];
  const client = loadClient(async (url, options) => {
    calls.push({ url, options });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  const form = new FormData();
  form.append("file", new Blob(["demo"]), "demo.txt");
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    await client.apiFetch("/api/smoke", { method, body: method === "POST" ? form : undefined });
  }
  assert.deepEqual(calls.map((call) => call.options.method), ["GET", "POST", "PATCH", "DELETE"]);

  const timeoutClient = loadClient((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  await assert.rejects(timeoutClient.apiFetch("/api/slow", { timeoutMs: 5 }), (error) => error.code === "timeout");
});

test("AI generation routes get a longer default timeout than ordinary reads", () => {
  const { apiTimeoutPolicy } = loadClient(async () => {});
  const { defaultTimeoutFor, DEFAULT_TIMEOUT_MS, LONG_RUNNING_TIMEOUT_MS } = apiTimeoutPolicy;
  assert.ok(LONG_RUNNING_TIMEOUT_MS > DEFAULT_TIMEOUT_MS);
  for (const path of [
    "/api/ai/summarize",
    "/api/stt/clova",
    "/api/analysis/abc123/stream",
    "/api/analysis/sessions/abc123/summaries",
    "/api/analysis/sessions/abc123/field-candidates",
    "/api/meetings/from-recording",
    "/api/kanban/cards/from-meeting",
  ]) {
    assert.equal(defaultTimeoutFor(path), LONG_RUNNING_TIMEOUT_MS, path);
  }
  for (const path of ["/api/me", "/api/meetings?limit=50", "/api/analysis/abc123/status", "/api/analysis/sessions/abc123/files"]) {
    assert.equal(defaultTimeoutFor(path), DEFAULT_TIMEOUT_MS, path);
  }
});

test("an explicit timeoutMs still wins over the per-path default", async () => {
  const client = loadClient((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  await assert.rejects(client.apiFetch("/api/ai/summarize", { method: "POST", timeoutMs: 5 }), (error) => error.code === "timeout");
});

test("apiErrorMessage explains timeouts and oversized payloads in Korean", () => {
  const { apiErrorMessage, HarnessApiError } = loadClient(async () => {});
  assert.match(apiErrorMessage(new HarnessApiError("API request timed out", { code: "timeout" })), /시간 안에 끝나지 않았습니다/);
  assert.match(apiErrorMessage(new HarnessApiError("HTTP 413", { code: "http_error", status: 413 })), /한도를 넘었습니다/);
  assert.equal(apiErrorMessage(new Error("업로드는 한 번에 15.0 MB까지 가능합니다.")), "업로드는 한 번에 15.0 MB까지 가능합니다.");
});

test("apiFetchJson normalizes 401 and malformed JSON", async () => {
  const unauthorized = loadClient(async () => new Response('{"error":"login required"}', { status: 401 }));
  await assert.rejects(unauthorized.apiFetchJson("/api/me"), (error) => error.code === "unauthorized" && error.status === 401);
  const malformed = loadClient(async () => new Response("not-json", { status: 200 }));
  await assert.rejects(malformed.apiFetchJson("/api/me"), (error) => error.code === "invalid_json");
});

test("apiFetch injects an async mobile bearer token without overriding explicit authorization", async () => {
  const calls = [];
  const client = loadClient(async (_url, options) => {
    calls.push(options.headers);
    return new Response("{}", { status: 200 });
  });
  client.setApiAccessTokenProvider(async () => `ph_mob_at_${"a".repeat(43)}`);

  await client.apiFetch("/api/me");
  await client.apiFetch("/api/me", { headers: { authorization: "Bearer route-specific-token" } });

  assert.equal(calls[0].get("authorization"), `Bearer ph_mob_at_${"a".repeat(43)}`);
  assert.equal(calls[1].get("authorization"), "Bearer route-specific-token");
  client.setApiAccessTokenProvider(null);
});

test("apiFetch does not auto-inject a bearer into mobile token revocation", async () => {
  const calls = [];
  const client = loadClient(async (_url, options) => {
    calls.push(options.headers);
    return new Response("{}", { status: 200 });
  });
  client.setApiAccessTokenProvider(async () => `ph_mob_at_${"a".repeat(43)}`);

  await client.apiFetch("/api/auth/mobile/revoke", { method: "POST" });
  await client.apiFetch("/api/auth/mobile/revoke", {
    method: "POST",
    headers: { authorization: "Bearer explicitly-selected-token" },
  });

  assert.equal(calls[0].get("authorization"), null);
  assert.equal(calls[1].get("authorization"), "Bearer explicitly-selected-token");
});

test("apiFetch distinguishes caller cancellation from timeout", async () => {
  const client = loadClient((_url, options) => new Promise((_resolve, reject) => {
    if (options.signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  const controller = new AbortController();
  const pending = client.apiFetch("/api/slow", { signal: controller.signal, timeoutMs: 1000 });
  await Promise.resolve();
  controller.abort("user_cancelled");
  await assert.rejects(pending, (error) => error.code === "cancelled");
});

test("apiFetch timeout also bounds an unresolved access token provider", async () => {
  const client = loadClient(async () => {
    throw new Error("fetch must not run while token lookup is unresolved");
  });
  client.setApiAccessTokenProvider(() => new Promise(() => {}));
  await assert.rejects(client.apiFetch("/api/me", { timeoutMs: 5 }), (error) => error.code === "timeout");
});

test("HTML loads runtime config and API client before analytics", () => {
  const htmlFiles = [];
  for (const entry of fs.readdirSync(path.join(appRoot, "public"), { withFileTypes: true })) {
    const candidate = entry.isDirectory() ? path.join(appRoot, "public", entry.name, "index.html") : path.join(appRoot, "public", entry.name);
    if (candidate.endsWith(".html") && fs.existsSync(candidate)) htmlFiles.push(candidate);
  }
  assert.ok(htmlFiles.length > 0);
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    if (!html.includes("/assets/analytics.js")) continue;
    assert.ok(html.indexOf("/assets/runtime-config.js") < html.indexOf("/assets/api-client.js"), file);
    assert.ok(html.indexOf("/assets/api-client.js") < html.indexOf("/assets/analytics.js"), file);
  }
});

test("application assets do not call relative API routes through raw fetch", () => {
  const assetsDir = path.join(appRoot, "public/assets");
  const offenders = fs.readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js") && name !== "api-client.js")
    .filter((name) => /\bfetch\s*\(\s*(["'`])\/api\//.test(fs.readFileSync(path.join(assetsDir, name), "utf8")));
  assert.deepEqual(offenders, []);
});

test("Worker CORS contract is an explicit non-credentialed allowlist", () => {
  const source = fs.readFileSync(path.join(appRoot, "src/router.ts"), "utf8");
  assert.match(source, /"capacitor:\/\/localhost"/);
  assert.match(source, /"https:\/\/localhost"/);
  assert.doesNotMatch(source, /access-control-allow-origin[\s\S]{0,80}["']\*["']/i);
  assert.doesNotMatch(source, /access-control-allow-credentials/i);
});

test("mobile auth storage and route contracts persist only canonical hashes", () => {
  const migration = fs.readFileSync(path.join(appRoot, "migrations/0078_mobile_auth.sql"), "utf8");
  const worker = fs.readFileSync(path.join(appRoot, "src/router.ts"), "utf8");
  const auth = fs.readFileSync(path.join(appRoot, "src/domains/auth/mobileAuth.ts"), "utf8");
  const client = fs.readFileSync(path.join(appRoot, "public/assets/api-client.js"), "utf8");
  const wrangler = fs.readFileSync(path.join(appRoot, "wrangler.jsonc"), "utf8");

  assert.match(migration, /CREATE TABLE mobile_auth_codes/);
  assert.match(migration, /CREATE TABLE mobile_sessions/);
  assert.match(migration, /CREATE TABLE mobile_auth_rate_limits/);
  assert.match(migration, /code_hash\s+TEXT NOT NULL UNIQUE/);
  assert.match(migration, /access_token_hash\s+TEXT NOT NULL UNIQUE/);
  assert.match(migration, /refresh_token_hash\s+TEXT NOT NULL UNIQUE/);
  assert.doesNotMatch(migration, /\b(access_token|refresh_token|authorization_code)\s+TEXT/i);
  assert.match(migration, /code_hash = lower\(code_hash\)/);
  assert.match(auth, /SET consumed_at=\?1, consume_nonce=\?2[\s\S]+consumed_at IS NULL[\s\S]+cancelled_at IS NULL[\s\S]+expires_at>\?1/);
  assert.match(auth, /revoke_reason='rotated'/);
  assert.match(auth, /refresh token reuse detected/);
  assert.match(auth, /const AUTH_CODE_TTL_SECONDS = 2 \* 60/);
  assert.match(auth, /MOBILE_AUTH_ENABLED !== "true"/);
  assert.match(auth, /configuredRedirectUris\(env\)\.has\(value\)/);
  assert.match(auth, /"code_exchange", await authorizationCodeRateSubject/);
  assert.match(auth, /"refresh", await refreshRateSubject/);
  assert.match(auth, /"revoke", await revokeRateSubject/);
  assert.match(auth, /requiredString\(body, "token_type_hint", 32\)/);
  assert.match(worker, /\/api\/auth\/mobile\/token/);
  assert.match(worker, /authenticateMobileBearer/);
  assert.match(worker, /"code_issue", `user:\$\{identity\.userId\}`/);
  assert.match(client, /path !== "\/api\/auth\/mobile\/revoke"/);
  assert.equal((wrangler.match(/"MOBILE_AUTH_ENABLED": "false"/g) || []).length, 2);
  assert.equal((wrangler.match(/"MOBILE_AUTH_REDIRECT_URIS": "\[\]"/g) || []).length, 2);
});
