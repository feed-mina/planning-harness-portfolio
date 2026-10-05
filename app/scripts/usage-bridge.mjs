#!/usr/bin/env node
// Issue #162: 구독·사용량 로컬 브리지 수집기.
// 사용자의 로컬 환경에서 Claude Code `/usage`·codex `/status` 정보를 읽어
// 기존 공개 API(PUT /api/agent-subscriptions/{provider}/windows/{kind})에
// source=local_bridge 로 push 한다.
//
// 원칙 (이슈 인수조건):
// - 베스트에포트: 파싱이 불확실하면 아무것도 push 하지 않는다 (기존 값 오염 금지).
// - 전송 페이로드는 파싱된 수치·시각뿐 — CLI 원문/대화 내용/자격증명을 보내지 않는다.
// - 인증은 기존 경로만 사용: HARNESS_TOKEN(모바일 Bearer) 또는 본인이 직접 넣는 HARNESS_SID.
//
// 사용법:
//   node app/scripts/usage-bridge.mjs claude --paste < usage.txt   # /usage 화면 텍스트 붙여넣기
//   node app/scripts/usage-bridge.mjs codex                        # ~/.codex/sessions 최신 rate_limits
//   node app/scripts/usage-bridge.mjs codex --paste < status.txt   # /status 텍스트 붙여넣기
//   공통: --base-url URL --dry-run --resets-5h ISO --resets-weekly ISO
//   환경변수: HARNESS_BASE_URL, HARNESS_TOKEN 또는 HARNESS_SID

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const WINDOW_KINDS = ["rolling_5h", "weekly"];

// ---------------------------------------------------------------------------
// 텍스트 파서 (Claude /usage · codex /status 붙여넣기 공용)
// ---------------------------------------------------------------------------

function classifyWindow(line) {
  const lower = line.toLowerCase();
  if (/(current\s+session|5\s*-?\s*h|5\s*시간|session\s*\(|rolling)/i.test(lower)) return "rolling_5h";
  if (/(week|주간|weekly)/i.test(lower)) return "weekly";
  return null;
}

function extractPercent(line) {
  const match = line.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(used|사용|남음|remaining|left)?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  const qualifier = (match[2] || "used").toLowerCase();
  const remaining = /remaining|left|남음/.test(qualifier) ? value : 100 - value;
  return Math.round(remaining * 100) / 100;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function extractResetIso(line, nowMs) {
  const iso = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/);
  if (iso) {
    const parsed = Date.parse(iso[0]);
    return Number.isFinite(parsed) && parsed > nowMs ? new Date(parsed).toISOString() : null;
  }
  const resetMatch = line.match(/resets?\s*(?:at|:)?\s*(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!resetMatch) return null;
  const [, weekday, hourRaw, minuteRaw, meridiem] = resetMatch;
  let hour = Number(hourRaw);
  const minute = Number(minuteRaw || 0);
  if (!Number.isFinite(hour) || hour > 23 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  }
  const candidate = new Date(nowMs);
  candidate.setSeconds(0, 0);
  candidate.setHours(hour, minute);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday.toLowerCase());
    while (candidate.getDay() !== target || candidate.getTime() <= nowMs) {
      candidate.setDate(candidate.getDate() + 1);
    }
  } else {
    while (candidate.getTime() <= nowMs) candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.toISOString();
}

// /usage · /status 화면 텍스트에서 윈도우별 잔여 %와 리셋 시각을 보수적으로 추출한다.
// 윈도우를 식별하는 줄과 %가 같은 줄 또는 바로 다음 두 줄 안에 있을 때만 채택한다.
export function parseUsageText(text, nowMs = Date.now()) {
  const lines = String(text || "").split(/\r?\n/);
  const found = {};
  for (let i = 0; i < lines.length; i++) {
    const kind = classifyWindow(lines[i]);
    if (!kind || found[kind]) continue;
    for (let j = i; j < Math.min(i + 3, lines.length); j++) {
      const remaining = extractPercent(lines[j]);
      if (remaining === null) continue;
      const context = lines.slice(j, Math.min(j + 3, lines.length)).join(" ");
      found[kind] = {
        window_kind: kind,
        remaining_value: remaining,
        limit_value: 100,
        unit: "percent",
        resets_at: extractResetIso(`${lines[i]} ${context}`, nowMs),
      };
      break;
    }
  }
  return WINDOW_KINDS.filter((kind) => found[kind]).map((kind) => found[kind]);
}

// ---------------------------------------------------------------------------
// codex 세션 파일 파서 — rollout JSONL에 남는 rate_limits 스냅샷을 찾는다.
// 포맷 변경에 대비해 키 이름을 방어적으로 탐색하고, 불확실하면 빈 결과를 낸다.
// ---------------------------------------------------------------------------

function findRateLimits(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return null;
  if (!Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "rate_limits" && child && typeof child === "object") return child;
      const nested = findRateLimits(child, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function normalizeLimitEntry(entry, fallbackKind, observedMs) {
  if (!entry || typeof entry !== "object") return null;
  const usedPercent = Number(entry.used_percent ?? entry.usedPercent ?? entry.percent_used);
  if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return null;
  const windowMinutes = Number(entry.window_minutes ?? entry.windowMinutes ?? NaN);
  let kind = fallbackKind;
  if (Number.isFinite(windowMinutes)) {
    if (windowMinutes >= 60 && windowMinutes <= 720) kind = "rolling_5h";
    else if (windowMinutes >= 5000 && windowMinutes <= 20000) kind = "weekly";
    else return null; // 알 수 없는 윈도우 — 추측하지 않는다
  }
  const resetsSeconds = Number(entry.resets_in_seconds ?? entry.resetsInSeconds ?? NaN);
  const resetsAt = Number.isFinite(resetsSeconds) && resetsSeconds > 0
    ? new Date(observedMs + resetsSeconds * 1000).toISOString()
    : null;
  return {
    window_kind: kind,
    remaining_value: Math.round((100 - usedPercent) * 100) / 100,
    limit_value: 100,
    unit: "percent",
    resets_at: resetsAt,
  };
}

export function parseCodexSessionJsonl(jsonlText, fileMtimeMs = Date.now()) {
  const lines = String(jsonlText || "").split(/\r?\n/).filter((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    let event;
    try {
      event = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const rateLimits = findRateLimits(event);
    if (!rateLimits) continue;
    const timestamp = Date.parse(event?.timestamp ?? event?.ts ?? "");
    const observedMs = Number.isFinite(timestamp) ? timestamp : fileMtimeMs;
    const windows = [];
    const primary = normalizeLimitEntry(rateLimits.primary, "rolling_5h", observedMs);
    const secondary = normalizeLimitEntry(rateLimits.secondary, "weekly", observedMs);
    if (primary) windows.push(primary);
    if (secondary && !windows.some((item) => item.window_kind === secondary.window_kind)) windows.push(secondary);
    if (windows.length > 0) return { windows, observed_at: new Date(observedMs).toISOString() };
  }
  return { windows: [], observed_at: null };
}

export function findLatestCodexSessionFile(sessionsDir) {
  const stack = [sessionsDir];
  let latest = null;
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const mtime = fs.statSync(full).mtimeMs;
        if (!latest || mtime > latest.mtimeMs) latest = { path: full, mtimeMs: mtime };
      }
    }
  }
  return latest;
}

// ---------------------------------------------------------------------------
// push 클라이언트 — 파싱된 수치·시각만 전송한다.
// ---------------------------------------------------------------------------

export async function pushWindows({ baseUrl, token, sid, provider, windows, observedAt, dryRun, fetchImpl = fetch, log = console.log }) {
  const results = [];
  for (const window of windows) {
    if (window.resets_at === null) {
      log(`  ↳ ${provider}/${window.window_kind}: 리셋 시각을 확정할 수 없어 push를 생략합니다 (--resets-${window.window_kind === "rolling_5h" ? "5h" : "weekly"} 로 지정 가능).`);
      results.push({ window_kind: window.window_kind, pushed: false, reason: "resets_unknown" });
      continue;
    }
    const payload = {
      status: "fresh",
      remaining_value: window.remaining_value,
      limit_value: window.limit_value,
      unit: window.unit,
      resets_at: window.resets_at,
      source: "local_bridge",
      observed_at: observedAt,
      message: `local bridge ${provider} 수집`,
    };
    if (dryRun) {
      log(`  ↳ [dry-run] ${provider}/${window.window_kind}: ${JSON.stringify(payload)}`);
      results.push({ window_kind: window.window_kind, pushed: false, reason: "dry_run", payload });
      continue;
    }
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    else if (sid) headers.cookie = `sid=${sid}`;
    const url = `${baseUrl.replace(/\/$/, "")}/api/agent-subscriptions/${encodeURIComponent(provider)}/windows/${encodeURIComponent(window.window_kind)}`;
    try {
      const response = await fetchImpl(url, { method: "PUT", headers, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const hint = body.code === "subscription_required"
          ? " — 마이페이지에서 해당 제공자의 구독 정보를 먼저 저장하세요."
          : body.code === "login_required"
            ? " — HARNESS_TOKEN 또는 HARNESS_SID 인증을 확인하세요."
            : "";
        log(`  ↳ ${provider}/${window.window_kind}: 서버 거절 (${body.code || response.status})${hint}`);
        results.push({ window_kind: window.window_kind, pushed: false, reason: body.code || `http_${response.status}` });
        continue;
      }
      log(`  ↳ ${provider}/${window.window_kind}: ${body.applied ? "저장됨" : "더 최신 관측값이 있어 건너뜀"} (잔여 ${window.remaining_value}%)`);
      results.push({ window_kind: window.window_kind, pushed: !!body.applied, reason: body.applied ? "applied" : "superseded" });
    } catch (error) {
      log(`  ↳ ${provider}/${window.window_kind}: 전송 실패 (${error?.message || "network"})`);
      results.push({ window_kind: window.window_kind, pushed: false, reason: "network" });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "--paste" || value === "--dry-run") args.flags[value.slice(2)] = true;
    else if (value.startsWith("--")) args.flags[value.slice(2)] = argv[++i];
    else args.positional.push(value);
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

function applyResetOverrides(windows, flags, nowMs) {
  const overrides = { rolling_5h: flags["resets-5h"], weekly: flags["resets-weekly"] };
  return windows.map((window) => {
    const override = overrides[window.window_kind];
    if (!override) return window;
    const parsed = Date.parse(override);
    if (!Number.isFinite(parsed) || parsed <= nowMs) {
      console.error(`리셋 시각 지정이 올바르지 않습니다: ${override} (미래의 ISO 시각이어야 합니다)`);
      process.exit(1);
    }
    return { ...window, resets_at: new Date(parsed).toISOString() };
  });
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const provider = positional[0];
  if (provider !== "claude" && provider !== "codex") {
    console.error("사용법: usage-bridge.mjs <claude|codex> [--paste] [--dry-run] [--base-url URL] [--sessions-dir DIR] [--resets-5h ISO] [--resets-weekly ISO]");
    process.exit(1);
  }
  const baseUrl = flags["base-url"] || process.env.HARNESS_BASE_URL;
  const token = flags.token || process.env.HARNESS_TOKEN;
  const sid = flags.sid || process.env.HARNESS_SID;
  const dryRun = !!flags["dry-run"];
  if (!dryRun && !baseUrl) {
    console.error("--base-url 또는 HARNESS_BASE_URL 이 필요합니다.");
    process.exit(1);
  }
  if (!dryRun && !token && !sid) {
    console.error("HARNESS_TOKEN(모바일 Bearer) 또는 HARNESS_SID(본인 세션) 인증이 필요합니다.");
    process.exit(1);
  }

  const nowMs = Date.now();
  let windows = [];
  let observedAt = new Date(nowMs).toISOString();

  if (provider === "claude" || flags.paste) {
    const label = provider === "claude" ? "Claude Code /usage" : "codex /status";
    console.log(`${label} 화면 텍스트를 붙여넣고 Ctrl-D 로 종료하세요...`);
    windows = parseUsageText(await readStdin(), nowMs);
  } else {
    const sessionsDir = flags["sessions-dir"] || path.join(os.homedir(), ".codex", "sessions");
    const latest = findLatestCodexSessionFile(sessionsDir);
    if (!latest) {
      console.error(`codex 세션 파일을 찾지 못했습니다: ${sessionsDir} — codex /status 출력을 --paste 로 넣을 수도 있습니다.`);
      process.exit(2);
    }
    console.log(`codex 세션 파일: ${latest.path}`);
    const parsed = parseCodexSessionJsonl(fs.readFileSync(latest.path, "utf-8"), latest.mtimeMs);
    windows = parsed.windows;
    if (parsed.observed_at) observedAt = parsed.observed_at;
    if (Date.parse(observedAt) > nowMs) observedAt = new Date(nowMs).toISOString();
  }

  windows = applyResetOverrides(windows, flags, nowMs);
  if (windows.length === 0) {
    console.error("파싱된 윈도우가 없어 아무것도 push 하지 않습니다 (베스트에포트 원칙 — 기존 값을 오염시키지 않습니다).");
    process.exit(2);
  }

  console.log(`${provider}: ${windows.length}개 윈도우 파싱됨 (관측 ${observedAt})`);
  const results = await pushWindows({ baseUrl: baseUrl || "", token, sid, provider, windows, observedAt, dryRun });
  process.exit(results.some((item) => item.pushed) || dryRun ? 0 : 2);
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(`실패: ${error?.message || error}`);
    process.exit(1);
  });
}
