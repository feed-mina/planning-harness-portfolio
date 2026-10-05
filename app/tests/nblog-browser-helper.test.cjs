const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const helperRoot = path.join(appRoot, "nblog-smarteditor-client");
const protocol = require(path.join(helperRoot, "shared", "protocol.js"));
const adapter = require(path.join(helperRoot, "content", "smarteditor-adapter.js"));
const bookmarklet = require(path.join(appRoot, "public", "nblog-handoff", "bookmarklet.js"));

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const CLAIM_TOKEN = `nbh_${"a".repeat(43)}`;
const SESSION_TOKEN = `nbhs_${"b".repeat(43)}`;
const CHECKSUM = `sha256:${"c".repeat(64)}`;

function encodeCode(prefix, value) {
  return `${prefix}${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function connectionPayload(nowMs = Date.UTC(2026, 6, 23, 0, 0, 0)) {
  return {
    version: 1,
    api_origin: "https://harness-meeting-app.kibayerin.workers.dev",
    session_id: SESSION_ID,
    claim_path: `/api/nblog/handoff-sessions/${SESSION_ID}/claim`,
    claim_token: CLAIM_TOKEN,
    contract_version: "1.1",
    expires_at: new Date(nowMs + 10 * 60 * 1000).toISOString(),
  };
}

function assertProtocolError(fn, code) {
  assert.throws(fn, (error) => error?.name === "ProtocolError" && error.code === code);
}

test("connection codes are exact, short-lived, and limited to the two Harness origins", () => {
  const nowMs = Date.UTC(2026, 6, 23, 0, 0, 0);
  const payload = connectionPayload(nowMs);
  const parsed = protocol.parseConnectionCode(encodeCode(protocol.CONNECTION_PREFIX, payload), { nowMs });

  assert.equal(parsed.api_origin, payload.api_origin);
  assert.equal(parsed.session_id, SESSION_ID);
  assert.equal(parsed.claim_token, CLAIM_TOKEN);

  assertProtocolError(() => protocol.parseConnectionCode(encodeCode(protocol.CONNECTION_PREFIX, {
    ...payload,
    api_origin: "https://harness-meeting-app.kibayerin.workers.dev.evil.example",
  }), { nowMs }), "api_origin_not_allowed");
  assertProtocolError(() => protocol.parseConnectionCode(encodeCode(protocol.CONNECTION_PREFIX, {
    ...payload,
    claim_path: `/api/nblog/handoff-sessions/${SESSION_ID}/checkpoints`,
  }), { nowMs }), "claim_path_mismatch");
  assertProtocolError(() => protocol.parseConnectionCode(encodeCode(protocol.CONNECTION_PREFIX, {
    ...payload,
    extra: true,
  }), { nowMs }), "invalid_connection_fields");
  assertProtocolError(() => protocol.parseConnectionCode(encodeCode(protocol.CONNECTION_PREFIX, {
    ...payload,
    expires_at: new Date(nowMs - 1).toISOString(),
  }), { nowMs }), "connection_expired");
});

test("claim responses accept only the assisted-input safety contract and canonical body", () => {
  const nowMs = Date.UTC(2026, 6, 23, 0, 0, 0);
  const connection = protocol.parseConnectionCode(
    encodeCode(protocol.CONNECTION_PREFIX, connectionPayload(nowMs)),
    { nowMs },
  );
  const response = {
    contract_version: "1.1",
    session_token: SESSION_TOKEN,
    handoff_session: { id: SESSION_ID, status: "browser_connected" },
    bundle: {
      schema_version: "1.1",
      handoff_session_id: SESSION_ID,
      bundle_checksum: CHECKSUM,
      campaign_version: 7,
      target: { blog_url: "https://blog.naver.com/MyBlog" },
      content: {
        selected_title: "검증된 제목",
        body: "태그 줄을 제거한 본문",
        markdown: "태그 줄을 제거한 본문\n\n#태그",
        tags: ["태그"],
      },
    },
    safety: {
      stores_naver_credentials: false,
      automatic_input_allowed: ["title", "body", "tags"],
      manual_user_actions_required: ["login", "captcha", "media", "place", "preview", "publish"],
      final_publish_requires_user_action: true,
    },
  };

  const claimed = protocol.validateClaimResponse(response, connection);
  assert.equal(claimed.draft.title, "검증된 제목");
  assert.equal(claimed.draft.body, "태그 줄을 제거한 본문");
  assert.deepEqual(claimed.draft.tags, ["태그"]);
  assert.equal(claimed.draft.target_blog_id, "myblog");
  assert.deepEqual(claimed.draft.manual_steps, ["login", "captcha", "media", "place", "preview", "publish"]);

  const unsafe = structuredClone(response);
  unsafe.safety.manual_user_actions_required = ["login", "captcha", "media", "place", "publish"];
  assertProtocolError(() => protocol.validateClaimResponse(unsafe, connection), "unsafe_claim_response");

  const heading = protocol.splitTrailingTags("본문\n\n# 제목 문장", []);
  assert.equal(heading.body, "본문\n\n# 제목 문장");
  assert.deepEqual(heading.tags, []);
});

test("the MV3 manifest and sources keep permissions and executable code narrow", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(helperRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting", "storage"]);
  assert.deepEqual([...manifest.host_permissions].sort(), [
    "https://harness-meeting-app-staging.kibayerin.workers.dev/*",
    "https://harness-meeting-app.kibayerin.workers.dev/*",
  ]);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);

  const files = [
    "background.js",
    "shared/protocol.js",
    "content/smarteditor-adapter.js",
    "content/smarteditor-runner.js",
    "popup/popup.js",
  ];
  const source = files.map((file) => fs.readFileSync(path.join(helperRoot, file), "utf8")).join("\n");
  assert.doesNotMatch(source, /localStorage|chrome\.storage\.local|<all_urls>|externally_connectable/);
  assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(/);
  assert.match(source, /chrome\.storage\.session/);
  assert.match(source, /credentials:\s*"omit"/);

  const injected = [
    fs.readFileSync(path.join(helperRoot, "content", "smarteditor-adapter.js"), "utf8"),
    fs.readFileSync(path.join(helperRoot, "content", "smarteditor-runner.js"), "utf8"),
  ].join("\n");
  assert.doesNotMatch(injected, /\.click\s*\(/);
  assert.doesNotMatch(injected, /발행[^"\n]*\)\s*;|publishButton|captcha_bypass|automated_publish/);
});

test("the public extension ZIP exists and matches its published checksum", () => {
  const zipPath = path.join(appRoot, "public", "downloads", "nblog-smarteditor-helper.zip");
  const checksumPath = path.join(appRoot, "public", "downloads", "nblog-smarteditor-helper.sha256");
  const archive = fs.readFileSync(zipPath);
  const expected = fs.readFileSync(checksumPath, "utf8").trim().split(/\s+/)[0];
  const actual = crypto.createHash("sha256").update(archive).digest("hex");

  assert.ok(archive.length > 10_000);
  assert.equal(archive.subarray(0, 4).toString("hex"), "504b0304");
  assert.equal(actual, expected);
});

class FakeElement {
  constructor(documentLike, kind, options = {}) {
    this.ownerDocument = documentLike;
    this.kind = kind;
    this.hidden = false;
    this.disabled = false;
    this.isContentEditable = options.contentEditable === true;
    this.value = options.nativeInput ? (options.value || "") : undefined;
    this.innerText = options.text || "";
    this.textContent = options.text || "";
    this.placeholderText = options.placeholderText || "";
    this.attributes = { ...(options.attributes || {}) };
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  querySelectorAll(selector) {
    if (selector === ".se-placeholder, .__se_placeholder" && this.placeholderText) {
      return [{ innerText: this.placeholderText, textContent: this.placeholderText }];
    }
    return [];
  }

  closest() {
    return this.kind === "title" ? { className: "se-section-documentTitle" } : null;
  }

  focus() {}

  dispatchEvent() {
    return true;
  }
}

function fakeEditor(options = {}) {
  const documentLike = {
    selected: null,
    defaultView: {
      Event: class Event {
        constructor(type) { this.type = type; }
      },
      InputEvent: class InputEvent {
        constructor(type) { this.type = type; }
      },
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    },
    getSelection() {
      return {
        removeAllRanges() {},
        addRange() {},
      };
    },
    createRange() {
      return {
        selectNodeContents: (element) => { documentLike.selected = element; },
      };
    },
    execCommand(command, _showUi, text) {
      assert.equal(command, "insertText");
      documentLike.selected.innerText = text;
      documentLike.selected.textContent = text;
      return true;
    },
  };
  const title = new FakeElement(documentLike, "title", {
    contentEditable: true,
    text: options.titleText ?? "제목",
    placeholderText: options.titleText === undefined ? "제목" : "",
  });
  const body = new FakeElement(documentLike, "body", {
    contentEditable: true,
    text: options.bodyText || "",
  });
  const extraBody = options.ambiguousBody
    ? new FakeElement(documentLike, "body", { contentEditable: true })
    : null;
  const tags = new FakeElement(documentLike, "tags", {
    nativeInput: true,
    value: options.tagText || "",
    attributes: { placeholder: "태그" },
  });

  documentLike.querySelectorAll = (selector) => {
    if (selector.includes("태그")) return options.hideTags ? [] : [tags];
    if (selector.includes("documentTitle")
      || selector.includes("se-title-text")
      || selector.includes('placeholder="제목"')
      || selector.includes('aria-label="제목"')) {
      return [title];
    }
    if (selector.includes("se-text-paragraph")) {
      return [title, body, ...(extraBody ? [extraBody] : [])];
    }
    if (selector.includes("본문")) return [body, ...(extraBody ? [extraBody] : [])];
    return [];
  };
  return { documentLike, title, body, tags };
}

test("the SmartEditor adapter fills one blank editor, is idempotent, and blocks unsafe DOM states", () => {
  const draft = { version: 1, title: "자동입력 제목", body: "첫 줄\n둘째 줄", tags: ["태그"] };
  const blank = fakeEditor();
  const applied = adapter.applyDraft(blank.documentLike, draft);
  assert.equal(applied.ok, true);
  assert.equal(applied.code, "applied");
  assert.equal(blank.title.innerText, draft.title);
  assert.equal(blank.body.innerText, draft.body);
  assert.equal(blank.tags.value, "#태그");
  assert.ok(applied.manual_steps.includes("publish"));
  assert.ok(applied.manual_steps.includes("preview"));

  const repeated = adapter.applyDraft(blank.documentLike, draft);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.code, "already_applied");

  const occupied = fakeEditor({ bodyText: "사용자가 이미 쓴 글" });
  assert.deepEqual(adapter.applyDraft(occupied.documentLike, draft), {
    ok: false,
    code: "editor_not_empty",
    diagnostics: { conflicting_fields: ["body"] },
  });

  const ambiguous = fakeEditor({ ambiguousBody: true });
  const mismatch = adapter.applyDraft(ambiguous.documentLike, draft);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "selector_mismatch");
  assert.equal(mismatch.diagnostics.body_candidates, 2);
});

test("partial failure recovery: fields that already match the draft are skipped, only the remaining fields are filled in", () => {
  const draft = { version: 1, title: "자동입력 제목", body: "첫 줄\n둘째 줄", tags: ["태그"] };

  // body_input_failed 이후 재시도하는 상황을 재현: title은 이전 시도에서 이미 성공, body/tags는 비어 있음.
  const afterTitleOnly = fakeEditor({ titleText: draft.title });
  const resumedAfterBody = adapter.applyDraft(afterTitleOnly.documentLike, draft);
  assert.equal(resumedAfterBody.ok, true);
  assert.equal(resumedAfterBody.code, "applied");
  assert.deepEqual(resumedAfterBody.fields, { title: "unchanged", body: "inserted", tags: "inserted" });
  assert.equal(afterTitleOnly.title.innerText, draft.title);
  assert.equal(afterTitleOnly.body.innerText, draft.body);
  assert.equal(afterTitleOnly.tags.value, "#태그");

  // tag_input_failed 이후 재시도: title·body는 이미 일치, tags만 비어 있음.
  const afterTitleAndBody = fakeEditor({ titleText: draft.title, bodyText: draft.body });
  const resumedAfterTags = adapter.applyDraft(afterTitleAndBody.documentLike, draft);
  assert.equal(resumedAfterTags.ok, true);
  assert.equal(resumedAfterTags.code, "applied");
  assert.deepEqual(resumedAfterTags.fields, { title: "unchanged", body: "unchanged", tags: "inserted" });
  assert.equal(afterTitleAndBody.tags.value, "#태그");
});

test("partial failure recovery still refuses to touch a field with real foreign content", () => {
  const draft = { version: 1, title: "자동입력 제목", body: "첫 줄\n둘째 줄", tags: ["태그"] };

  // title은 이전 시도로 이미 정확히 채워졌지만, body에는 draft와 다른(사용자) 내용이 있다.
  const conflicting = fakeEditor({ titleText: draft.title, bodyText: "사용자가 직접 쓴 다른 내용" });
  const result = adapter.applyDraft(conflicting.documentLike, draft);
  assert.equal(result.ok, false);
  assert.equal(result.code, "editor_not_empty");
  assert.deepEqual(result.diagnostics.conflicting_fields, ["body"]);
  // 충돌이 발견되면 아무 필드도 건드리지 않아야 한다(이미 맞는 title도, 충돌한 body도 그대로).
  assert.equal(conflicting.title.innerText, draft.title);
  assert.equal(conflicting.body.innerText, "사용자가 직접 쓴 다른 내용");
  assert.equal(conflicting.tags.value, "");
});

test("the offline bookmarklet accepts the seven-field payload and never performs network work", () => {
  const payload = {
    version: 1,
    title: "북마클릿 제목",
    body: "북마클릿 본문",
    tags: ["태그"],
    place_name: "미생맥주 수원권선점",
    target_blog: "https://blog.naver.com/myblog",
    category: "체험단",
  };
  const code = encodeCode(bookmarklet.PREFIX, payload);
  assert.deepEqual(bookmarklet.parseDraftCode(code), payload);

  const missingFields = encodeCode(bookmarklet.PREFIX, {
    version: 1,
    title: payload.title,
    body: payload.body,
    tags: payload.tags,
  });
  assert.throws(() => bookmarklet.parseDraftCode(missingFields), /invalid_draft/);

  const source = fs.readFileSync(path.join(appRoot, "public", "nblog-handoff", "bookmarklet.js"), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage/);
  assert.doesNotMatch(source, /\.click\s*\(/);

  let queried = false;
  let alertText = "";
  const result = bookmarklet.run({
    location: {
      protocol: "https:",
      hostname: "blog.naver.com",
      href: "https://blog.naver.com/otherblog?Redirect=Write",
    },
    prompt: () => code,
    alert: (message) => { alertText = message; },
    document: {
      querySelectorAll() {
        queried = true;
        return [];
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "target_blog_mismatch");
  assert.equal(queried, false, "account mismatch must stop before any editor query");
  assert.match(alertText, /다른|달라/);
});
