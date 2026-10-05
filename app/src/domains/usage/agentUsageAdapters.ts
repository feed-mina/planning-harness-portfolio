// Issue #160 (REQ-205/207/209): 서버 pull 어댑터 경계.
// - Copilot: GitHub billing REST를 서버에서 pull (source=provider_api)
// - Claude/Codex: 공개 API 부재로 서버 pull 없음 — 로컬 브리지 push(source=local_bridge)는
//   agentSubscriptions의 공개 수동 입력 API가 수용한다 (adapter-research.md 참조).
// 어댑터는 제공자 오류를 예외로 던지지 않고 unknownReason으로 반환한다 (폴백 체인 유지).

import {
  AgentSubscriptionError,
  listAgentSubscriptions,
  upsertAgentUsageWindow,
} from "./agentSubscriptions";
import { decryptToken, encryptToken } from "../../core/auth";

interface AdapterEnv {
  DB: D1Database;
  JWT_SECRET?: string;
}

interface CredentialRow {
  id: string;
  user_id: string;
  provider: string;
  credential_enc: string;
  account_login: string;
  monthly_included_requests: number | null;
  last_sync_at: string | null;
  last_sync_status: "never" | "ok" | "error";
  last_sync_message: string | null;
}

type CopilotUsageFetch =
  | { ok: true; usedRequests: number }
  | { ok: false; unknownReason: string };

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "planning-harness-agent-usage";
const PAT_PATTERN = /^(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/;
const LOGIN_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 월간 윈도우 — 6시간 주기면 충분
const AUTO_SYNC_BATCH = 10;

function apiJson(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...(init?.headers || {}),
    },
  });
}

function credentialPresentation(row: CredentialRow | null) {
  if (!row) return { configured: false as const };
  return {
    configured: true as const,
    account_login: row.account_login,
    monthly_included_requests: row.monthly_included_requests,
    last_sync_at: row.last_sync_at,
    last_sync_status: row.last_sync_status,
    last_sync_message: row.last_sync_message,
  };
}

async function getCredentialRow(env: AdapterEnv, userId: string, provider: string): Promise<CredentialRow | null> {
  return await env.DB.prepare(
    `SELECT id, user_id, provider, credential_enc, account_login, monthly_included_requests,
            last_sync_at, last_sync_status, last_sync_message
       FROM agent_provider_credentials
      WHERE user_id=?1 AND provider=?2`
  ).bind(userId, provider).first<CredentialRow>();
}

export async function getCredentialSummaries(env: AdapterEnv, userId: string) {
  try {
    const result = await env.DB.prepare(
      `SELECT id, user_id, provider, credential_enc, account_login, monthly_included_requests,
              last_sync_at, last_sync_status, last_sync_message
         FROM agent_provider_credentials
        WHERE user_id=?1`
    ).bind(userId).all<CredentialRow>();
    const rows = result.results || [];
    return new Map(rows.map((row) => [row.provider, credentialPresentation(row)]));
  } catch {
    // 마이그레이션 이전 환경 — 자격증명 미구성으로 취급한다.
    return new Map<string, ReturnType<typeof credentialPresentation>>();
  }
}

function githubHeaders(pat: string): Record<string, string> {
  return {
    authorization: `Bearer ${pat}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": USER_AGENT,
  };
}

async function verifyGithubPat(pat: string): Promise<{ ok: true; login: string } | { ok: false; reason: string }> {
  try {
    const res = await fetch(`${GITHUB_API_BASE}/user`, { headers: githubHeaders(pat) });
    if (res.status === 401) return { ok: false, reason: "PAT 인증에 실패했습니다. 토큰이 유효한지 확인하세요." };
    if (!res.ok) return { ok: false, reason: `GitHub 계정 확인 실패 (HTTP ${res.status})` };
    const data = (await res.json()) as { login?: string };
    if (!data?.login) return { ok: false, reason: "GitHub 계정 정보를 읽을 수 없습니다." };
    return { ok: true, login: data.login };
  } catch {
    return { ok: false, reason: "GitHub API 호출에 실패했습니다(네트워크)." };
  }
}

// REQ-207: 개인 결제 Copilot premium request 사용량 (문서화된 개인 엔드포인트).
async function fetchCopilotPremiumUsage(pat: string, login: string): Promise<CopilotUsageFetch> {
  try {
    const res = await fetch(
      `${GITHUB_API_BASE}/users/${encodeURIComponent(login)}/settings/billing/premium_request/usage`,
      { headers: githubHeaders(pat) },
    );
    if (res.status === 401) {
      return { ok: false, unknownReason: "PAT 인증에 실패했습니다. 토큰 만료 여부를 확인하세요." };
    }
    if (res.status === 403) {
      return { ok: false, unknownReason: "PAT 권한이 부족합니다. fine-grained PAT에 'Plan' 읽기 권한이 필요합니다." };
    }
    if (res.status === 404) {
      return {
        ok: false,
        unknownReason: "개인 결제 사용량을 찾을 수 없습니다. 조직/엔터프라이즈 결제 계정이거나 아직 노출되지 않는 계정일 수 있습니다.",
      };
    }
    if (!res.ok) {
      return { ok: false, unknownReason: `GitHub billing API 오류 (HTTP ${res.status})` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const items = Array.isArray((data as { usageItems?: unknown[] }).usageItems)
      ? ((data as { usageItems: unknown[] }).usageItems)
      : Array.isArray((data as { usage?: unknown[] }).usage)
        ? ((data as { usage: unknown[] }).usage)
        : [];
    let used = 0;
    for (const raw of items) {
      const item = (raw || {}) as Record<string, unknown>;
      const product = String(item.product ?? "").toLowerCase();
      const sku = String(item.sku ?? "").toLowerCase();
      if (!product.includes("copilot") && !sku.includes("premium")) continue;
      const quantity = Number(item.grossQuantity ?? item.gross_quantity ?? item.quantity ?? 0);
      if (Number.isFinite(quantity) && quantity > 0) used += quantity;
    }
    return { ok: true, usedRequests: used };
  } catch {
    return { ok: false, unknownReason: "GitHub billing API 호출에 실패했습니다(네트워크)." };
  }
}

// premium request 카운터는 매월 1일(UTC)에 리셋된다.
function nextMonthlyResetIso(nowMs: number): string {
  const now = new Date(nowMs);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

async function recordSyncOutcome(
  env: AdapterEnv,
  credentialId: string,
  status: "ok" | "error",
  message: string,
  nowMs: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE agent_provider_credentials
        SET last_sync_at=?2, last_sync_status=?3, last_sync_message=?4, updated_at=?2
      WHERE id=?1`
  ).bind(credentialId, new Date(nowMs).toISOString(), status, message.slice(0, 240)).run();
}

export async function syncCopilotUsageForUser(env: AdapterEnv, userId: string, nowMs = Date.now()) {
  const credential = await getCredentialRow(env, userId, "copilot");
  if (!credential) {
    throw new AgentSubscriptionError(404, "credential_not_found", "등록된 Copilot PAT가 없습니다.");
  }
  if (!env.JWT_SECRET) {
    throw new AgentSubscriptionError(500, "crypto_unavailable", "서버 암호화 키가 구성되지 않았습니다.");
  }
  const pat = await decryptToken(credential.credential_enc, env.JWT_SECRET);
  if (!pat) {
    await recordSyncOutcome(env, credential.id, "error", "저장된 PAT를 복호화할 수 없습니다. PAT를 다시 등록하세요.", nowMs);
    throw new AgentSubscriptionError(409, "credential_unreadable", "저장된 PAT를 복호화할 수 없습니다. PAT를 다시 등록하세요.");
  }

  const fetched = await fetchCopilotPremiumUsage(pat, credential.account_login);
  const observedAt = new Date(nowMs).toISOString();

  if (!fetched.ok) {
    await recordSyncOutcome(env, credential.id, "error", fetched.unknownReason, nowMs);
    await upsertAgentUsageWindow(env, userId, "copilot", "monthly", {
      status: "error",
      remaining_value: null,
      limit_value: credential.monthly_included_requests,
      unit: "requests",
      resets_at: null,
      source: "provider_api",
      observed_at: observedAt,
      message: fetched.unknownReason,
    }, nowMs);
    return { synced: false, unknown_reason: fetched.unknownReason };
  }

  if (credential.monthly_included_requests === null) {
    const message = `사용량 ${fetched.usedRequests}건 확인됨 — 월 포함량이 미설정이라 잔여를 계산할 수 없습니다. PAT 설정에서 월 포함량을 입력하세요.`;
    await recordSyncOutcome(env, credential.id, "error", message, nowMs);
    await upsertAgentUsageWindow(env, userId, "copilot", "monthly", {
      status: "error",
      remaining_value: null,
      limit_value: null,
      unit: "requests",
      resets_at: null,
      source: "provider_api",
      observed_at: observedAt,
      message,
    }, nowMs);
    return { synced: false, unknown_reason: message, used_requests: fetched.usedRequests };
  }

  const remaining = Math.max(0, credential.monthly_included_requests - fetched.usedRequests);
  const message = `GitHub billing API 자동 수집 — 이번 달 사용 ${fetched.usedRequests}건`;
  await upsertAgentUsageWindow(env, userId, "copilot", "monthly", {
    status: "fresh",
    remaining_value: remaining,
    limit_value: credential.monthly_included_requests,
    unit: "requests",
    resets_at: nextMonthlyResetIso(nowMs),
    source: "provider_api",
    observed_at: observedAt,
    message,
  }, nowMs);
  await recordSyncOutcome(env, credential.id, "ok", message, nowMs);
  return { synced: true, used_requests: fetched.usedRequests, remaining_value: remaining };
}

// REQ-209: Cron 주기 수집 — 마지막 동기화가 오래된 자격증명만, 소량 배치로 (멱등 upsert).
export async function processAgentUsageAutoSync(env: AdapterEnv, nowMs = Date.now()): Promise<void> {
  if (!env.JWT_SECRET) return;
  let rows: Array<{ user_id: string }> = [];
  try {
    const cutoff = new Date(nowMs - AUTO_SYNC_INTERVAL_MS).toISOString();
    const result = await env.DB.prepare(
      `SELECT user_id FROM agent_provider_credentials
        WHERE provider='copilot' AND (last_sync_at IS NULL OR last_sync_at < ?1)
        ORDER BY last_sync_at ASC
        LIMIT ?2`
    ).bind(cutoff, AUTO_SYNC_BATCH).all<{ user_id: string }>();
    rows = result.results || [];
  } catch {
    return; // 마이그레이션 이전 환경
  }
  for (const row of rows) {
    try {
      await syncCopilotUsageForUser(env, row.user_id, nowMs);
    } catch {
      // 개별 사용자 실패는 격리 — last_sync_message에 이미 기록됨
    }
  }
}

function normalizePatInput(body: Record<string, unknown>) {
  const pat = typeof body.pat === "string" ? body.pat.trim() : "";
  if (!PAT_PATTERN.test(pat)) {
    throw new AgentSubscriptionError(400, "invalid_pat", "GitHub PAT 형식이 아닙니다 (ghp_… 또는 github_pat_…).");
  }
  let login: string | null = null;
  if (body.account_login !== undefined && body.account_login !== null && body.account_login !== "") {
    if (typeof body.account_login !== "string" || !LOGIN_PATTERN.test(body.account_login.trim())) {
      throw new AgentSubscriptionError(400, "invalid_login", "GitHub 사용자명이 올바르지 않습니다.");
    }
    login = body.account_login.trim();
  }
  let included: number | null = null;
  if (body.monthly_included_requests !== undefined && body.monthly_included_requests !== null && body.monthly_included_requests !== "") {
    const value = Number(body.monthly_included_requests);
    if (!Number.isFinite(value) || value < 0) {
      throw new AgentSubscriptionError(400, "invalid_number", "monthly_included_requests는 0 이상의 숫자여야 합니다.");
    }
    included = value;
  }
  return { pat, login, included };
}

async function putCopilotCredential(env: AdapterEnv, userId: string, input: unknown, nowMs: number) {
  if (!env.JWT_SECRET) {
    throw new AgentSubscriptionError(500, "crypto_unavailable", "서버 암호화 키가 구성되지 않았습니다.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentSubscriptionError(400, "invalid_body", "JSON 객체가 필요합니다.");
  }
  const { pat, login, included } = normalizePatInput(input as Record<string, unknown>);

  const subscription = await env.DB.prepare(
    "SELECT id FROM agent_subscriptions WHERE user_id=?1 AND provider='copilot'"
  ).bind(userId).first<{ id: string }>();
  if (!subscription) {
    throw new AgentSubscriptionError(409, "subscription_required", "PAT를 등록하기 전에 Copilot 구독 정보를 먼저 저장하세요.");
  }

  const verified = await verifyGithubPat(pat);
  if (!verified.ok) {
    throw new AgentSubscriptionError(400, "pat_verification_failed", verified.reason);
  }
  if (login && login.toLowerCase() !== verified.login.toLowerCase()) {
    throw new AgentSubscriptionError(400, "login_mismatch", `PAT 소유 계정(${verified.login})과 입력한 사용자명이 다릅니다.`);
  }

  const now = new Date(nowMs).toISOString();
  const encrypted = await encryptToken(pat, env.JWT_SECRET);
  await env.DB.prepare(
    `INSERT INTO agent_provider_credentials
       (id, user_id, provider, credential_enc, account_login, monthly_included_requests,
        last_sync_at, last_sync_status, last_sync_message, created_at, updated_at)
     VALUES (?1, ?2, 'copilot', ?3, ?4, ?5, NULL, 'never', NULL, ?6, ?6)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       credential_enc=excluded.credential_enc,
       account_login=excluded.account_login,
       monthly_included_requests=excluded.monthly_included_requests,
       last_sync_status='never',
       last_sync_message=NULL,
       updated_at=excluded.updated_at`
  ).bind(crypto.randomUUID(), userId, encrypted, verified.login, included, now).run();

  let sync: unknown = null;
  try {
    sync = await syncCopilotUsageForUser(env, userId, nowMs);
  } catch (error) {
    sync = { synced: false, unknown_reason: error instanceof AgentSubscriptionError ? error.message : "첫 동기화 실패" };
  }
  const credential = credentialPresentation(await getCredentialRow(env, userId, "copilot"));
  return { credential, sync, dashboard: await listAgentSubscriptions(env, userId, nowMs) };
}

async function deleteCopilotCredential(env: AdapterEnv, userId: string, nowMs: number) {
  const result = await env.DB.prepare(
    "DELETE FROM agent_provider_credentials WHERE user_id=?1 AND provider='copilot'"
  ).bind(userId).run();
  return {
    deleted: (result.meta.changes || 0) > 0,
    dashboard: await listAgentSubscriptions(env, userId, nowMs),
  };
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AgentSubscriptionError(415, "json_required", "application/json 요청만 지원합니다.");
  }
  try {
    return await request.json();
  } catch {
    throw new AgentSubscriptionError(400, "invalid_json", "올바른 JSON 본문이 필요합니다.");
  }
}

function authenticatedUser(userId: string | null | undefined): userId is string {
  return !!userId && !userId.startsWith("anon:");
}

// index.ts에서 handleAgentSubscriptionsRequest보다 먼저 호출해야 한다
// (그 핸들러는 /api/agent-subscriptions/* 하위의 미매칭 경로를 404로 종결시킨다).
export async function handleAgentUsageAdapterRequest(
  request: Request,
  env: AdapterEnv,
  userId: string | null | undefined,
  nowMs = Date.now(),
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/agent-subscriptions\/([^/]+)\/(credential|sync)$/);
  if (!match) return null;
  if (!authenticatedUser(userId)) {
    return apiJson({ error: "로그인이 필요합니다.", code: "login_required" }, { status: 401 });
  }

  try {
    const provider = decodeURIComponent(match[1]);
    const action = match[2];
    if (provider !== "copilot") {
      return apiJson({
        error: "이 제공자에는 서버 자동 수집 어댑터가 없습니다. Claude/Codex는 수동 입력 또는 로컬 브리지(source=local_bridge)를 사용하세요.",
        code: "adapter_unavailable",
      }, { status: 400 });
    }

    if (action === "credential" && request.method === "PUT") {
      return apiJson(await putCopilotCredential(env, userId, await readJsonBody(request), nowMs));
    }
    if (action === "credential" && request.method === "DELETE") {
      return apiJson(await deleteCopilotCredential(env, userId, nowMs));
    }
    if (action === "sync" && request.method === "POST") {
      const sync = await syncCopilotUsageForUser(env, userId, nowMs);
      return apiJson({ sync, dashboard: await listAgentSubscriptions(env, userId, nowMs) });
    }
    return apiJson({ error: "지원하지 않는 메서드입니다.", code: "method_not_allowed" }, {
      status: 405,
      headers: { allow: action === "credential" ? "PUT, DELETE" : "POST" },
    });
  } catch (error) {
    if (error instanceof AgentSubscriptionError) {
      return apiJson({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    }
    throw error;
  }
}
