// Issue #162: 로컬 브리지 수집기 파서·push 계약 테스트.
import test from "node:test";
import assert from "node:assert/strict";
import { parseUsageText, parseCodexSessionJsonl, pushWindows } from "../scripts/usage-bridge.mjs";

const NOW = Date.parse("2026-07-19T12:00:00.000Z");

test("parseUsageText는 세션/주간 사용률과 리셋 시각을 보수적으로 추출한다", () => {
  const windows = parseUsageText([
    "Claude Pro plan",
    "Current session (5-hour window)",
    "37% used · Resets 2026-07-19T15:00:00Z",
    "Current week (all models)",
    "12% used",
  ].join("\n"), NOW);
  assert.equal(windows.length, 2);
  const rolling = windows.find((item) => item.window_kind === "rolling_5h");
  assert.deepEqual(rolling, {
    window_kind: "rolling_5h",
    remaining_value: 63,
    limit_value: 100,
    unit: "percent",
    resets_at: "2026-07-19T15:00:00.000Z",
  });
  const weekly = windows.find((item) => item.window_kind === "weekly");
  assert.equal(weekly.remaining_value, 88);
  assert.equal(weekly.resets_at, null); // 리셋 미표기 → 추측하지 않는다
});

test("parseUsageText는 remaining 표기와 범위를 검증하고 모호한 텍스트는 버린다", () => {
  const remaining = parseUsageText("weekly limit: 40% remaining", NOW);
  assert.equal(remaining[0].remaining_value, 40);
  assert.equal(parseUsageText("weekly: 250% used", NOW).length, 0); // 범위 밖
  assert.equal(parseUsageText("아무 관련 없는 텍스트\n123 lines of logs", NOW).length, 0);
});

test("parseCodexSessionJsonl은 마지막 rate_limits 스냅샷을 찾아 윈도우로 정규화한다", () => {
  const jsonl = [
    JSON.stringify({ timestamp: "2026-07-19T10:00:00Z", payload: { type: "token_count" } }),
    "깨진 줄 { not json",
    JSON.stringify({
      timestamp: "2026-07-19T11:30:00Z",
      payload: {
        info: { total_token_usage: { input_tokens: 10 } },
        rate_limits: {
          primary: { used_percent: 25, window_minutes: 300, resets_in_seconds: 3600 },
          secondary: { used_percent: 80.5, window_minutes: 10080, resets_in_seconds: 86400 },
        },
      },
    }),
  ].join("\n");
  const parsed = parseCodexSessionJsonl(jsonl, NOW);
  assert.equal(parsed.observed_at, "2026-07-19T11:30:00.000Z");
  assert.equal(parsed.windows.length, 2);
  assert.deepEqual(parsed.windows[0], {
    window_kind: "rolling_5h",
    remaining_value: 75,
    limit_value: 100,
    unit: "percent",
    resets_at: "2026-07-19T12:30:00.000Z",
  });
  assert.equal(parsed.windows[1].window_kind, "weekly");
  assert.equal(parsed.windows[1].remaining_value, 19.5);
});

test("parseCodexSessionJsonl은 알 수 없는 윈도우·범위 밖 값을 추측하지 않는다", () => {
  const jsonl = JSON.stringify({
    timestamp: "2026-07-19T11:30:00Z",
    rate_limits: {
      primary: { used_percent: 130, window_minutes: 300 },
      secondary: { used_percent: 10, window_minutes: 43200 },
    },
  });
  assert.equal(parseCodexSessionJsonl(jsonl, NOW).windows.length, 0);
});

test("pushWindows는 local_bridge 페이로드만 보내고 리셋 미상 윈도우는 생략한다", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ applied: true }), { status: 200 });
  };
  const results = await pushWindows({
    baseUrl: "https://harness.test/",
    token: "mobile-access-token",
    provider: "codex",
    observedAt: "2026-07-19T11:30:00.000Z",
    windows: [
      { window_kind: "rolling_5h", remaining_value: 75, limit_value: 100, unit: "percent", resets_at: "2026-07-19T12:30:00.000Z" },
      { window_kind: "weekly", remaining_value: 19.5, limit_value: 100, unit: "percent", resets_at: null },
    ],
    fetchImpl,
    log: () => {},
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://harness.test/api/agent-subscriptions/codex/windows/rolling_5h");
  assert.equal(calls[0].init.headers.authorization, "Bearer mobile-access-token");
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.source, "local_bridge");
  assert.equal(payload.status, "fresh");
  assert.equal(payload.remaining_value, 75);
  assert.ok(!JSON.stringify(payload).includes("token"), "페이로드에 자격증명이 없어야 한다");
  assert.deepEqual(results.map((item) => item.reason), ["applied", "resets_unknown"]);
});

test("pushWindows는 서버 거절을 이유와 함께 반환하고 예외를 던지지 않는다", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ code: "subscription_required" }), { status: 409 });
  const results = await pushWindows({
    baseUrl: "https://harness.test",
    sid: "my-own-session",
    provider: "claude",
    observedAt: "2026-07-19T11:30:00.000Z",
    windows: [{ window_kind: "weekly", remaining_value: 88, limit_value: 100, unit: "percent", resets_at: "2026-07-24T00:00:00.000Z" }],
    fetchImpl,
    log: () => {},
  });
  assert.deepEqual(results, [{ window_kind: "weekly", pushed: false, reason: "subscription_required" }]);
});
