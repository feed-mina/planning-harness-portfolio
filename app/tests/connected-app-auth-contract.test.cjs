const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(appRoot, name), "utf8");

test("connected app migration and runtime keep credentials hash-only", () => {
  const sql = read("migrations/0096_connected_app_auth.sql");
  const runtime = read("src/domains/auth/connectedAppAuth.ts");
  assert.match(sql, /code_hash\s+TEXT NOT NULL UNIQUE/);
  assert.match(sql, /exchange_id_hash\s+TEXT UNIQUE/);
  assert.doesNotMatch(sql, /\bcode\s+TEXT/);
  assert.doesNotMatch(sql, /\bexchange_id\s+TEXT/);
  assert.match(runtime, /AUTHORIZATION_CODE_TTL_SECONDS = 120/);
  assert.match(runtime, /timingSafeEqual\(match\[1\], expected\)/);
  assert.match(runtime, /request\.headers\.has\("origin"\)/);
});

test("login continuation is fixed across OAuth and email flows", () => {
  const auth = read("src/domains/auth/auth.ts");
  const mypage = read("public/assets/mypage.js");
  assert.match(auth, /connectedAppLoginContinuation\(request, env\)/);
  assert.match(auth, /\.\.\.\(next \? \{ next \} : \{\}\)/);
  assert.match(mypage, /CONNECTED_APP_RESUME_PATH = "\/api\/auth\/connected-app\/authorize\/resume"/);
  assert.match(mypage, /if \(value !== CONNECTED_APP_RESUME_PATH\) return null/);
  assert.match(mypage, /location\.replace\(continuation\)/);
  assert.match(mypage, /connectedAppResumePath\(data\.next\)/);
});

test("production enables Auto Media navigation while staging stays disabled", () => {
  const config = read("wrangler.jsonc");
  assert.equal((config.match(/"CONNECTED_APP_AUTH_ENABLED": "true"/g) || []).length, 1);
  assert.equal((config.match(/"CONNECTED_APP_AUTH_ENABLED": "false"/g) || []).length, 1);
  assert.equal((config.match(/"AUTO_MEDIA_NAV_ENABLED": "true"/g) || []).length, 1);
  assert.equal((config.match(/"AUTO_MEDIA_NAV_ENABLED": "false"/g) || []).length, 1);
  assert.match(config, /"CONNECTED_APP_CLIENT_ID": "auto-media-web"/);
  assert.match(config, /"CONNECTED_APP_AUDIENCE": "auto-media"/);
  assert.match(config, /"CONNECTED_APP_SCOPE": "auto_media:sign_in"/);
  assert.match(config, /"CONNECTED_APP_REDIRECT_URI": "https:\/\/auto-media\.kibayerin\.workers\.dev\/auth\/harness\/callback"/);
  assert.doesNotMatch(config, /"CONNECTED_APP_BACKCHANNEL_SECRET"\s*:/);
});

test("shared sidebar sends staging and production users to production Auto Media", () => {
  const common = read("public/assets/common.js");
  const nblog = common.indexOf('id: "nblog-automation"');
  const autoMedia = common.indexOf('id: "auto-media"');
  const mypage = common.indexOf('id: "mypage"');

  assert.ok(autoMedia > nblog, "Auto Media must follow NBlog automation");
  assert.ok(mypage > autoMedia, "Auto Media must precede mypage");
  assert.match(
    common,
    /id: "auto-media", readinessEndpoint: "\/api\/connected-apps\/auto-media\/readiness", label: "영상 자동화"/,
  );
  assert.match(common, /payload\.href !== AUTO_MEDIA_PRODUCTION_URL/);
  assert.match(common, /pending\.replaceWith\(link\)/);
  assert.doesNotMatch(common, /auto-media-staging\.kibayerin\.workers\.dev/);
});
