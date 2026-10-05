const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "public", "assets", "ai-sdui-runtime.js"),
  "utf8",
);
const schema = "planning-harness.ai-sdui.v1";
const payloadHash = "a".repeat(64);

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.disabled = false;
    this.type = "";
    this._textContent = "";
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this._textContent;
  }

  set innerHTML(_value) {
    throw new Error("innerHTML is forbidden in the validated renderer");
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    return this.listeners.get("click")?.({ currentTarget: this });
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

function findAll(root, predicate) {
  const results = [];
  const visit = (element) => {
    if (predicate(element)) results.push(element);
    for (const child of element.children) visit(child);
  };
  visit(root);
  return results;
}

function makeResult(overrides = {}) {
  return {
    schema,
    result_id: "result-1",
    generated_at: "2026-07-19T01:00:00.000Z",
    source: { provider: "codex", model: "gpt-test" },
    card: {
      id: "card-1",
      type: "aiResultCard",
      props: { title: "검증된 제목", summary: "서버가 정규화한 요약", status: "completed" },
      children: [
        { id: "text-1", type: "textBlock", props: { text: "<img src=x onerror=alert(1)>" } },
        { id: "metric-1", type: "metricCard", props: { label: "파일", value: "3", unit: "개" } },
        { id: "status-1", type: "statusBadge", props: { status: "completed", label: "완료" } },
        {
          id: "actions-1",
          type: "actionGroup",
          props: { label: "안전한 다음 단계" },
          actions: [{
            id: "open-1",
            type: "OPEN_REQUIREMENTS",
            label: "요구사항 열기",
            ref_id: "requirements-1",
          }],
        },
      ],
      actions: [],
      ...overrides,
    },
  };
}

function responseBody(result, validated = true) {
  return {
    ok: true,
    schema,
    validation: { validated, validated_at: "2026-07-19T01:00:01.000Z" },
    result,
  };
}

function jsonResponse(body, marker = schema) {
  const headers = { "content-type": "application/json" };
  if (marker !== null) headers["x-ai-sdui-validated"] = marker;
  return new Response(JSON.stringify(body), { status: 200, headers });
}

function validatedResponse(result) {
  return jsonResponse(responseBody(result));
}

function loadRuntime(apiFetch) {
  const document = new FakeDocument();
  const window = { apiFetch };
  window.window = window;
  vm.runInContext(source, vm.createContext({ window, document, console, encodeURIComponent }));
  return { document, runtime: window.HarnessAiSduiRuntime };
}

test("public entry validates raw JSON before rendering inert text and a fixed OPEN callback", async () => {
  const calls = [];
  const callbackCalls = [];
  const rawPayload = { title: "<script>raw input must not render</script>" };
  const { document, runtime } = loadRuntime(async (url, options) => {
    calls.push({ url, options });
    return validatedResponse(makeResult());
  });
  const root = document.createElement("main");

  await runtime.validateAndRender(root, rawPayload, {
    onOpenRequirements: (detail) => callbackCalls.push(detail),
    MODIFY_CODE: () => assert.fail("dangerous callbacks must not be registered"),
  });

  assert.equal(runtime.schema, schema);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/ai-sdui/validate");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), rawPayload);
  assert.equal(root.children[0].tagName, "ARTICLE");
  assert.equal(findAll(root, (element) => element.textContent.includes("raw input")).length, 0);
  assert.equal(
    findAll(root, (element) => element.textContent === "<img src=x onerror=alert(1)>").length,
    1,
    "validated markup-like content stays inert textContent",
  );

  const button = findAll(root, (element) => element.textContent === "요구사항 열기")[0];
  await button.click();
  assert.deepEqual(JSON.parse(JSON.stringify(callbackCalls)), [{
    refId: "requirements-1",
    resultId: "result-1",
  }]);
  assert.equal(calls.length, 1, "safe host callbacks cannot synthesize a runtime API path");
});

test("missing or forged validation evidence fails closed and replaces old content with an error", async () => {
  const cases = [
    {
      name: "missing response header",
      response: jsonResponse(responseBody(makeResult()), null),
    },
    {
      name: "forged header without a validated body",
      response: jsonResponse(responseBody(makeResult(), false)),
    },
    {
      name: "wrong schema marker",
      response: jsonResponse(responseBody(makeResult()), "planning-harness.ai-sdui.v0"),
    },
  ];

  for (const candidate of cases) {
    const { document, runtime } = loadRuntime(async () => candidate.response);
    const root = document.createElement("main");
    root.textContent = "stale unvalidated result";
    await assert.rejects(
      runtime.validateAndRender(root, {}),
      /validation was not confirmed/,
      candidate.name,
    );
    assert.equal(root.children.length, 1, candidate.name);
    assert.equal(root.children[0].className, "ai-sdui-error", candidate.name);
    assert.equal(root.children[0].attributes.get("role"), "alert", candidate.name);
    assert.equal(findAll(root, (element) => element.textContent.includes("stale unvalidated")).length, 0);
  }
});

test("approval posts only the exact operation and hash and accepts execution=false", async () => {
  const calls = [];
  let dangerousExecutorCalls = 0;
  const approval = {
    id: "approval-1",
    type: "approvalCard",
    props: {
      title: "배포 승인",
      summary: "dry-run 결과를 승인합니다.",
      job_id: "job-1",
      operation: "DEPLOY",
      payload_hash: payloadHash,
      dry_run: true,
      server_check_required: true,
      expires_at: "2026-07-20T01:00:00.000Z",
    },
    actions: [{
      id: "approve-1",
      type: "APPROVE_JOB",
      label: "승인 기록",
      job_id: "job-1",
      operation: "DEPLOY",
      payload_hash: payloadHash,
    }],
  };
  const result = makeResult({ children: [approval], actions: [] });
  const { document, runtime } = loadRuntime(async (url, options) => {
    calls.push({ url, options });
    if (url === "/api/ai-sdui/validate") return validatedResponse(result);
    return new Response(JSON.stringify({
      ok: true,
      approval: {
        job_id: "job-1",
        operation: "DEPLOY",
        payload_hash: payloadHash,
        status: "approved",
      },
      execution: { started: false, endpoint_available: false },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const root = document.createElement("main");

  await runtime.validateAndRender(root, { schema }, {
    onDeploy: () => { dangerousExecutorCalls += 1; },
    DEPLOY: () => { dangerousExecutorCalls += 1; },
  });
  const button = findAll(root, (element) => element.textContent === "승인 기록")[0];
  await button.click();

  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "/api/ai-sdui/approval-jobs/job-1/approve");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    operation: "DEPLOY",
    payload_hash: payloadHash,
  });
  assert.equal(dangerousExecutorCalls, 0);
  assert.equal(button.disabled, true);
  assert.equal(
    findAll(root, (element) => element.textContent.includes("위험 작업은 실행되지 않았습니다")).length,
    1,
  );
});

test("dangerous direct actions are rejected even behind a forged successful server envelope", async () => {
  const unsafeResult = makeResult({
    actions: [{
      id: "danger-1",
      type: "MODIFY_CODE",
      label: "코드 변경",
      ref_id: "repo-1",
    }],
  });
  const { document, runtime } = loadRuntime(async () => validatedResponse(unsafeResult));
  const root = document.createElement("main");

  await assert.rejects(runtime.validateAndRender(root, {}), /unsafe action/);
  assert.equal(findAll(root, (element) => element.textContent === "코드 변경").length, 0);
  assert.equal(root.children[0].className, "ai-sdui-error");
});
