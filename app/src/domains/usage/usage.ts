// 토큰 사용량 → 원(KRW) 환산, D1 기록, 일 한도 체크.
import type { Env } from "../../env";
import { escapeHtml } from "../../html";
import { sendTransactionalEmail } from "../../mail";
import { sendOrganizationOverageAdminEmails } from "../organization";

// 1M 토큰당 원(KRW) 근사 단가. ⚠️ 실제 공시 단가로 조정하세요(요금은 수시 변동).
// { provider: { model: { in, out } } }. 모델 미매칭 시 provider 의 "_default" 사용.
const PRICE_KRW_PER_1M: Record<string, Record<string, { in: number; out: number }>> = {
  claude: {
    "claude-sonnet-4-6": { in: 4200, out: 21000 },
    "claude-opus-4-8": { in: 21000, out: 105000 },
    "claude-haiku-4-5-20251001": { in: 1400, out: 7000 },
    _default: { in: 4200, out: 21000 },
  },
  openai: {
    "gpt-5": { in: 4200, out: 21000 },
    "gpt-5-mini": { in: 700, out: 2800 },
    _default: { in: 4200, out: 21000 },
  },
  gemini: {
    "gemini-2.5-pro": { in: 3500, out: 14000 },
    "gemini-2.5-flash": { in: 500, out: 2000 },
    _default: { in: 3500, out: 14000 },
  },
};

export function computeCostKRW(provider: string, model: string, inTok: number, outTok: number): number {
  const p = PRICE_KRW_PER_1M[provider] || {};
  const rate = p[model] || p._default || { in: 0, out: 0 };
  return (inTok * rate.in + outTok * rate.out) / 1_000_000;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const USAGE_RETENTION_DAYS = 30;

export interface UsageLimitSettings {
  daily_limit_krw: number;
  warn_threshold_krw: number;
  block_on_exceed: boolean;
  alert_email_enabled: boolean;
}

export interface UsageAlert {
  id: number;
  day: string;
  kind: "warning" | "limit";
  threshold_krw: number;
  used_krw: number;
  channel?: "in_app" | "email";
  delivery_status?: "recorded" | "email_sent" | "email_skipped" | "email_failed";
  delivered_at?: string | null;
  error_message?: string | null;
  created_at: string;
}

export interface QuotaState {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  warnThreshold: number;
  blockOnExceed: boolean;
  warning: { kind: "warning" | "limit"; message: string } | null;
}

export interface UsageProviderBudget {
  provider: "gemini" | "openai" | "claude";
  label: "Gemini" | "GPT" | "Claude";
  used_krw: number;
  day_used_krw: number;
}

export interface UsageBudgetOverview {
  day: string;
  used_krw: number;
  day_used_krw: number;
  limit_krw: number;
  remaining_krw: number;
  warn_threshold_krw: number;
  block_on_exceed: boolean;
  warning: QuotaState["warning"];
  reset_count: number;
  previous_used_krw: number;
  last_reset_at: string | null;
  providers: UsageProviderBudget[];
}

interface UsageResetBoundary {
  resetAt: string | null;
  previousUsed: number;
  resetCount: number;
}

export interface UsageSubjectSummary {
  subject_type: "account" | "device";
  label: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  total_tokens: number;
  cost_krw: number;
  latest_at: string | null;
}

export interface UsageRequestSummary {
  id: number;
  day: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  total_tokens: number;
  cost_krw: number;
  created_at: string;
}

export interface UsageExportRow {
  day: string;
  created_at: string;
  subject_type: "account" | "device";
  subject_label: string;
  device_label: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  total_tokens: number;
  cost_krw: number;
  source: string;
  status_code: number | null;
}

export type CostDashboardPeriod = "day" | "week" | "month";

export interface CostDashboard {
  period: CostDashboardPeriod;
  since: string;
  days: number;
  totals: {
    requests: number;
    input_tokens: number;
    output_tokens: number;
    cache_tokens: number;
    total_tokens: number;
    cost_krw: number;
  };
  budget: {
    daily_limit_krw: number;
    period_limit_krw: number;
    used_krw: number;
    remaining_krw: number;
    burn_rate: number;
  };
  days_series: { day: string; cost: number; requests: number }[];
  providers: { provider: string; requests: number; total_tokens: number; cost_krw: number }[];
  models: { provider: string; model: string; requests: number; total_tokens: number; cost_krw: number }[];
}

export interface UsageLogOptions {
  orgId?: string | null;
  deviceId?: string | null;
  proxyKeyId?: string | null;
  source?: "app" | "proxy" | "import" | string;
  requestId?: string | null;
  latencyMs?: number | null;
  statusCode?: number | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown> | null;
  costKRW?: number | null;
}

export interface UsageEventInput extends UsageLogOptions {
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
}

function defaultLimit(env: Env): number {
  const value = Number(env.DAILY_LIMIT_KRW || "500");
  return Number.isFinite(value) && value > 0 ? value : 500;
}

function defaultWarnThreshold(limit: number): number {
  return Math.max(1, Math.round(limit * 0.8));
}

function retentionCutoffDay(): string {
  return new Date(Date.now() - (USAGE_RETENTION_DAYS - 1) * 86400000).toISOString().slice(0, 10);
}

function clampRetentionDays(days: unknown): number {
  return Math.min(USAGE_RETENTION_DAYS, Math.max(1, Number(days) || USAGE_RETENTION_DAYS));
}

function normalizeLimitSettings(env: Env, raw?: Partial<UsageLimitSettings> | null): UsageLimitSettings {
  const fallbackLimit = defaultLimit(env);
  const dailyLimit = Math.min(10_000_000, Math.max(1, Number(raw?.daily_limit_krw ?? fallbackLimit) || fallbackLimit));
  const fallbackWarn = defaultWarnThreshold(dailyLimit);
  const warnThreshold = Math.min(dailyLimit, Math.max(1, Number(raw?.warn_threshold_krw ?? fallbackWarn) || fallbackWarn));
  return {
    daily_limit_krw: dailyLimit,
    warn_threshold_krw: warnThreshold,
    block_on_exceed: raw?.block_on_exceed !== false,
    alert_email_enabled: raw?.alert_email_enabled !== false,
  };
}

export async function getUsageLimitSettings(env: Env, userId: string): Promise<UsageLimitSettings> {
  const row = await env.DB.prepare(
    "SELECT daily_limit_krw, warn_threshold_krw, block_on_exceed, alert_email_enabled FROM usage_limits WHERE user_id=?"
  ).bind(userId).first<{ daily_limit_krw: number; warn_threshold_krw: number; block_on_exceed: number; alert_email_enabled: number }>();
  if (!row) return normalizeLimitSettings(env);
  return normalizeLimitSettings(env, {
    daily_limit_krw: row.daily_limit_krw,
    warn_threshold_krw: row.warn_threshold_krw,
    block_on_exceed: row.block_on_exceed !== 0,
    alert_email_enabled: row.alert_email_enabled !== 0,
  });
}

export async function saveUsageLimitSettings(env: Env, userId: string, body: unknown): Promise<UsageLimitSettings> {
  const rec = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const next = normalizeLimitSettings(env, {
    daily_limit_krw: Number(rec.daily_limit_krw),
    warn_threshold_krw: Number(rec.warn_threshold_krw),
    block_on_exceed: rec.block_on_exceed !== false,
    alert_email_enabled: rec.alert_email_enabled !== false,
  });
  await env.DB.prepare(
    `INSERT INTO usage_limits (user_id, daily_limit_krw, warn_threshold_krw, block_on_exceed, alert_email_enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       daily_limit_krw=excluded.daily_limit_krw,
       warn_threshold_krw=excluded.warn_threshold_krw,
       block_on_exceed=excluded.block_on_exceed,
       alert_email_enabled=excluded.alert_email_enabled,
       updated_at=excluded.updated_at`
  ).bind(userId, next.daily_limit_krw, next.warn_threshold_krw, next.block_on_exceed ? 1 : 0, next.alert_email_enabled ? 1 : 0, new Date().toISOString()).run();
  return next;
}

export async function getDailyCost(env: Env, userId: string, day: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(cost_krw),0) AS total FROM usage_events WHERE user_id=? AND day=?"
  ).bind(userId, day).first<{ total: number }>();
  return row?.total ?? 0;
}

async function latestUsageReset(env: Env, userId: string, day: string): Promise<UsageResetBoundary> {
  const row = await env.DB.prepare(
    `SELECT reset_at, previous_window_used_krw,
            (SELECT COUNT(*) FROM usage_resets WHERE user_id=? AND day=?) AS reset_count
     FROM usage_resets
     WHERE user_id=? AND day=?
     ORDER BY reset_at DESC, id DESC
     LIMIT 1`
  ).bind(userId, day, userId, day).first<{
    reset_at: string;
    previous_window_used_krw: number;
    reset_count: number;
  }>();
  return {
    resetAt: row?.reset_at || null,
    previousUsed: Number(row?.previous_window_used_krw) || 0,
    resetCount: Number(row?.reset_count) || 0,
  };
}

async function getCurrentUsageCost(env: Env, userId: string, day: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(cost_krw), 0) AS total
     FROM usage_events
     WHERE user_id=? AND day=?
       AND created_at > COALESCE((
         SELECT MAX(reset_at) FROM usage_resets WHERE user_id=? AND day=?
       ), '')`
  ).bind(userId, day, userId, day).first<{ total: number }>();
  return Number(row?.total) || 0;
}

function quotaState(settings: UsageLimitSettings, used: number): QuotaState {
  const overLimit = used >= settings.daily_limit_krw;
  const overWarn = used >= settings.warn_threshold_krw;
  return {
    allowed: !settings.block_on_exceed || !overLimit,
    used,
    limit: settings.daily_limit_krw,
    remaining: Math.max(0, settings.daily_limit_krw - used),
    warnThreshold: settings.warn_threshold_krw,
    blockOnExceed: settings.block_on_exceed,
    warning: overLimit
      ? { kind: "limit", message: settings.block_on_exceed ? "현재 AI 사용 구간의 한도를 초과해 요청이 차단됩니다." : "현재 AI 사용 구간의 한도를 초과했습니다." }
      : overWarn
        ? { kind: "warning", message: "현재 AI 사용 구간의 사용액이 예산 알림 임계치를 넘었습니다." }
        : null,
  };
}

export async function checkQuota(env: Env, userId: string): Promise<QuotaState> {
  const settings = await getUsageLimitSettings(env, userId);
  const used = await getCurrentUsageCost(env, userId, today());
  return quotaState(settings, used);
}

export async function checkOrganizationQuota(
  env: Env,
  orgId: string,
  blockOnExceed = true,
): Promise<QuotaState | null> {
  const fallbackLimit = defaultLimit(env);
  const fallbackWarn = defaultWarnThreshold(fallbackLimit);
  const budget = await env.DB.prepare(
    `SELECT COUNT(*) AS member_count,
            COALESCE(SUM(COALESCE(l.daily_limit_krw, ?)), 0) AS daily_limit_krw,
            COALESCE(SUM(COALESCE(l.warn_threshold_krw, ?)), 0) AS warn_threshold_krw
     FROM organization_members m
     LEFT JOIN usage_limits l ON l.user_id=m.user_id
     WHERE m.org_id=? AND m.status='active'`
  ).bind(fallbackLimit, fallbackWarn, orgId).first<{
    member_count: number;
    daily_limit_krw: number;
    warn_threshold_krw: number;
  }>();
  if (!budget || Number(budget.member_count) < 1) return null;
  const usage = await env.DB.prepare(
    "SELECT COALESCE(SUM(cost_krw), 0) AS total FROM usage_events WHERE org_id=? AND day=?"
  ).bind(orgId, today()).first<{ total: number }>();
  return quotaState(normalizeLimitSettings(env, {
    daily_limit_krw: Number(budget.daily_limit_krw),
    warn_threshold_krw: Number(budget.warn_threshold_krw),
    block_on_exceed: blockOnExceed,
    alert_email_enabled: false,
  }), Number(usage?.total) || 0);
}

function usageProvider(provider: string): UsageProviderBudget["provider"] | null {
  const value = provider.trim().toLowerCase();
  if (value === "gemini" || value === "google") return "gemini";
  if (value === "openai" || value === "gpt") return "openai";
  if (value === "claude" || value === "anthropic") return "claude";
  return null;
}

export async function getUsageBudgetOverview(env: Env, userId: string): Promise<UsageBudgetOverview> {
  const day = today();
  const [settings, boundary] = await Promise.all([
    getUsageLimitSettings(env, userId),
    latestUsageReset(env, userId, day),
  ]);
  const { results } = await env.DB.prepare(
    `SELECT provider,
            COALESCE(SUM(cost_krw), 0) AS day_used_krw,
            COALESCE(SUM(CASE WHEN created_at > ? THEN cost_krw ELSE 0 END), 0) AS used_krw
     FROM usage_events
     WHERE user_id=? AND day=?
     GROUP BY provider`
  ).bind(boundary.resetAt || "", userId, day).all<{
    provider: string;
    day_used_krw: number;
    used_krw: number;
  }>();

  const labels: Record<UsageProviderBudget["provider"], UsageProviderBudget["label"]> = {
    gemini: "Gemini",
    openai: "GPT",
    claude: "Claude",
  };
  const values: Record<UsageProviderBudget["provider"], { used: number; dayUsed: number }> = {
    gemini: { used: 0, dayUsed: 0 },
    openai: { used: 0, dayUsed: 0 },
    claude: { used: 0, dayUsed: 0 },
  };
  let unclassifiedUsed = 0;
  let unclassifiedDayUsed = 0;
  for (const row of results || []) {
    const key = usageProvider(row.provider);
    const used = Number(row.used_krw) || 0;
    const dayUsed = Number(row.day_used_krw) || 0;
    if (key) {
      values[key].used += used;
      values[key].dayUsed += dayUsed;
    } else {
      unclassifiedUsed += used;
      unclassifiedDayUsed += dayUsed;
    }
  }
  const providers = (["gemini", "openai", "claude"] as const).map((provider) => ({
    provider,
    label: labels[provider],
    used_krw: values[provider].used,
    day_used_krw: values[provider].dayUsed,
  }));
  const used = providers.reduce((sum, row) => sum + row.used_krw, unclassifiedUsed);
  const dayUsed = providers.reduce((sum, row) => sum + row.day_used_krw, unclassifiedDayUsed);
  const quota = quotaState(settings, used);
  return {
    day,
    used_krw: quota.used,
    day_used_krw: dayUsed,
    limit_krw: quota.limit,
    remaining_krw: quota.remaining,
    warn_threshold_krw: quota.warnThreshold,
    block_on_exceed: quota.blockOnExceed,
    warning: quota.warning,
    reset_count: boundary.resetCount,
    previous_used_krw: boundary.previousUsed,
    last_reset_at: boundary.resetAt,
    providers,
  };
}

export async function resetUsageBudget(env: Env, userId: string): Promise<UsageBudgetOverview> {
  const day = today();
  const boundary = await latestUsageReset(env, userId, day);
  const resetAt = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(cost_krw), 0) AS total
     FROM usage_events
     WHERE user_id=? AND day=? AND created_at>? AND created_at<=?`
  ).bind(userId, day, boundary.resetAt || "", resetAt).first<{ total: number }>();
  await env.DB.prepare(
    `INSERT INTO usage_resets (user_id, day, reset_at, previous_window_used_krw, reason)
     VALUES (?, ?, ?, ?, 'manual')`
  ).bind(userId, day, resetAt, Number(row?.total) || 0).run();
  return getUsageBudgetOverview(env, userId);
}

export async function processDailyUsageBudgetResets(env: Env, scheduledTime = Date.now()): Promise<{ day: string; resets: number }> {
  const scheduled = new Date(scheduledTime);
  const day = scheduled.toISOString().slice(0, 10);
  const previousDay = new Date(Date.parse(`${day}T00:00:00.000Z`) - 86400000).toISOString().slice(0, 10);
  // Cron 지연으로 자정 이후 요청이 빠지는 일이 없도록 실제 실행 시각이 아니라 정확한 UTC 자정을 경계로 쓴다.
  const resetAt = `${day}T00:00:00.000Z`;
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO usage_resets
       (user_id, day, reset_at, previous_window_used_krw, reason)
     SELECT subjects.user_id, ?, ?, COALESCE(previous.total, 0), 'daily'
     FROM (
       SELECT user_id FROM usage_limits
       UNION
       SELECT user_id FROM usage_events WHERE day IN (?, ?)
     ) subjects
     LEFT JOIN (
       SELECT user_id, SUM(cost_krw) AS total
       FROM usage_events
       WHERE day=?
       GROUP BY user_id
     ) previous ON previous.user_id=subjects.user_id`
  ).bind(day, resetAt, previousDay, day, previousDay).run();
  const resets = Number(inserted.meta.changes || 0);
  console.log(JSON.stringify({ service: "usage-budget", event: "daily_reset", day, resets }));
  return { day, resets };
}

export async function listUsageAlerts(env: Env, userId: string, days = 14): Promise<UsageAlert[]> {
  const dayList: string[] = [];
  for (let i = clampRetentionDays(days) - 1; i >= 0; i--) dayList.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  const since = dayList[0];
  const { results } = await env.DB.prepare(
    `SELECT id, day, kind, threshold_krw, used_krw, channel, delivery_status, delivered_at, error_message, created_at
     FROM usage_alerts WHERE user_id=? AND day>=? ORDER BY created_at DESC LIMIT 20`
  ).bind(userId, since).all<UsageAlert>();
  return results || [];
}

async function primaryEmail(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT email FROM user_identities
     WHERE user_id=? AND email IS NOT NULL AND email<>''
     ORDER BY provider='email' DESC, updated_at DESC
     LIMIT 1`
  ).bind(userId).first<{ email: string }>();
  return row?.email || null;
}

async function updateAlertDelivery(
  env: Env,
  userId: string,
  day: string,
  kind: "warning" | "limit",
  status: "email_sent" | "email_skipped" | "email_failed",
  error?: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE usage_alerts
     SET channel='email', delivery_status=?, delivered_at=?, error_message=?
     WHERE user_id=? AND day=? AND kind=?`
  ).bind(status, status === "email_sent" ? new Date().toISOString() : null, error ? error.slice(0, 500) : null, userId, day, kind).run();
}

async function sendUsageAlertEmail(env: Env, userId: string, day: string, kind: "warning" | "limit", threshold: number, used: number): Promise<void> {
  const settings = await getUsageLimitSettings(env, userId);
  if (!settings.alert_email_enabled) {
    await updateAlertDelivery(env, userId, day, kind, "email_skipped", "user_opted_out");
    return;
  }
  const to = await primaryEmail(env, userId);
  if (!to) {
    await updateAlertDelivery(env, userId, day, kind, "email_skipped", "recipient_email_missing");
    return;
  }
  if (!env.SENDGRID_API_KEY || !env.ALERT_EMAIL_FROM) {
    await updateAlertDelivery(env, userId, day, kind, "email_skipped", "sendgrid_api_key_or_sender_missing");
    return;
  }

  const label = kind === "limit" ? "Daily AI budget limit reached" : "Daily AI budget warning";
  const usedText = Math.round(used).toLocaleString("ko-KR");
  const thresholdText = Math.round(threshold).toLocaleString("ko-KR");
  const text = [
    label,
    "",
    `Day: ${day}`,
    `Used: ${usedText} KRW`,
    `Threshold: ${thresholdText} KRW`,
    "",
    "Open My Page > Settings to change your budget or email alert preference.",
  ].join("\n");
  const html = `<h1>${escapeHtml(label)}</h1><p>Day: ${escapeHtml(day)}</p><p>Used: <strong>${escapeHtml(usedText)} KRW</strong></p><p>Threshold: ${escapeHtml(thresholdText)} KRW</p><p>Open My Page &gt; Settings to change your budget or email alert preference.</p>`;
  try {
    await sendTransactionalEmail(env, to, `[Planning Harness] ${label}`, text, html, ["planning-harness", "usage-alert"]);
    await updateAlertDelivery(env, userId, day, kind, "email_sent");
  } catch (err: any) {
    await updateAlertDelivery(env, userId, day, kind, "email_failed", err?.message || "email_send_failed");
  }
}

async function recordUsageAlert(env: Env, userId: string, day: string, kind: "warning" | "limit", threshold: number, used: number): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO usage_alerts (user_id, day, kind, threshold_krw, used_krw, channel, delivery_status, created_at)
     VALUES (?, ?, ?, ?, ?, 'in_app', 'recorded', ?)`
  ).bind(userId, day, kind, threshold, used, new Date().toISOString()).run();
  return result.meta.changes > 0;
}

async function recordUsageAlertsIfNeeded(env: Env, userId: string, before: number, after: number): Promise<void> {
  const settings = await getUsageLimitSettings(env, userId);
  const day = today();
  if (before < settings.warn_threshold_krw && after >= settings.warn_threshold_krw) {
    if (await recordUsageAlert(env, userId, day, "warning", settings.warn_threshold_krw, after)) {
      await sendUsageAlertEmail(env, userId, day, "warning", settings.warn_threshold_krw, after);
      await sendOrganizationOverageAdminEmails(env, userId, day, "warning", settings.warn_threshold_krw, after);
    }
  }
  if (before < settings.daily_limit_krw && after >= settings.daily_limit_krw) {
    if (await recordUsageAlert(env, userId, day, "limit", settings.daily_limit_krw, after)) {
      await sendUsageAlertEmail(env, userId, day, "limit", settings.daily_limit_krw, after);
      await sendOrganizationOverageAdminEmails(env, userId, day, "limit", settings.daily_limit_krw, after);
    }
  }
}

// 최근 N일 사용량 시계열 — 일자별 비용/토큰 + provider별 비용 (통계 차트용).
export async function getSeries(env: Env, userId: string, days = 14) {
  const dayList: string[] = [];
  for (let i = clampRetentionDays(days) - 1; i >= 0; i--) dayList.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  const since = dayList[0];
  const { results } = await env.DB.prepare(
    `SELECT day, provider, SUM(cost_krw) AS cost, SUM(input_tokens + output_tokens + cache_tokens) AS tokens
     FROM usage_events WHERE user_id=? AND day>=? GROUP BY day, provider ORDER BY day`
  ).bind(userId, since).all<{ day: string; provider: string; cost: number; tokens: number }>();

  const byDay: Record<string, { cost: number; tokens: number }> = {};
  for (const d of dayList) byDay[d] = { cost: 0, tokens: 0 };
  const byProvider: Record<string, number> = {};
  for (const r of results || []) {
    if (byDay[r.day]) { byDay[r.day].cost += r.cost; byDay[r.day].tokens += r.tokens; }
    byProvider[r.provider] = (byProvider[r.provider] || 0) + r.cost;
  }
  return {
    days: dayList.map((d) => ({ day: d, cost: byDay[d].cost, tokens: byDay[d].tokens })),
    providers: Object.entries(byProvider).map(([provider, cost]) => ({ provider, cost })),
  };
}

export async function getUsageBreakdown(env: Env, userId: string, days = 30) {
  const dayCount = clampRetentionDays(days);
  const since = new Date(Date.now() - (dayCount - 1) * 86400000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    `SELECT provider, model,
            COUNT(*) AS requests,
            SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens,
            SUM(cache_tokens) AS cache_tokens,
            SUM(cost_krw) AS cost_krw
     FROM usage_events
     WHERE user_id=? AND day>=?
     GROUP BY provider, model
     ORDER BY cost_krw DESC`
  ).bind(userId, since).all<{
    provider: string;
    model: string;
    requests: number;
    input_tokens: number;
    output_tokens: number;
    cache_tokens: number;
    cost_krw: number;
  }>();

  const models = (results || []).map((row) => {
    const input = Number(row.input_tokens) || 0;
    const output = Number(row.output_tokens) || 0;
    const cache = Number(row.cache_tokens) || 0;
    return {
      provider: row.provider,
      model: row.model,
      requests: Number(row.requests) || 0,
      input_tokens: input,
      output_tokens: output,
      cache_tokens: cache,
      total_tokens: input + output + cache,
      cost_krw: Number(row.cost_krw) || 0,
    };
  });
  const totals = models.reduce((acc, row) => {
    acc.requests += row.requests;
    acc.input_tokens += row.input_tokens;
    acc.output_tokens += row.output_tokens;
    acc.cache_tokens += row.cache_tokens;
    acc.total_tokens += row.total_tokens;
    acc.cost_krw += row.cost_krw;
    return acc;
  }, { requests: 0, input_tokens: 0, output_tokens: 0, cache_tokens: 0, total_tokens: 0, cost_krw: 0 });

  return { since, days: dayCount, totals, models };
}

function subjectType(userId: string): "account" | "device" {
  return userId.startsWith("anon:") ? "device" : "account";
}

export function maskUsageIdentifier(value: string | null | undefined, visible = 4): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes("@")) {
    const [local, domain] = raw.split("@");
    return `${local.slice(0, 2)}***@${domain || "***"}`;
  }
  const compact = raw.replace(/^anon:/, "");
  if (compact.length <= visible * 2) return `${compact.slice(0, 2)}***`;
  return `${compact.slice(0, visible)}...${compact.slice(-visible)}`;
}

function subjectLabel(userId: string): string {
  if (userId.startsWith("anon:")) return `익명 기기 ${userId.slice(-8)}`;
  return `계정 ${userId.slice(0, 6)}...${userId.slice(-4)}`;
}

function safeSubjectLabel(userId: string): string {
  if (userId.startsWith("anon:")) return "Current anonymous device";
  return `Account ${maskUsageIdentifier(userId, 4)}`;
}

export async function getUsageSubjects(env: Env, userId: string, days = 30): Promise<{ since: string; days: number; subjects: UsageSubjectSummary[] }> {
  const dayCount = clampRetentionDays(days);
  const since = new Date(Date.now() - (dayCount - 1) * 86400000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    `SELECT user_id,
            COUNT(*) AS requests,
            SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens,
            SUM(cache_tokens) AS cache_tokens,
            SUM(cost_krw) AS cost_krw,
            MAX(created_at) AS latest_at
     FROM usage_events
     WHERE user_id=? AND day>=?
     GROUP BY user_id
     ORDER BY cost_krw DESC`
  ).bind(userId, since).all<{
    user_id: string;
    requests: number;
    input_tokens: number;
    output_tokens: number;
    cache_tokens: number;
    cost_krw: number;
    latest_at: string | null;
  }>();

  const subjects = (results || []).map((row) => {
    const input = Number(row.input_tokens) || 0;
    const output = Number(row.output_tokens) || 0;
    const cache = Number(row.cache_tokens) || 0;
    return {
      subject_type: subjectType(row.user_id),
      label: safeSubjectLabel(row.user_id),
      requests: Number(row.requests) || 0,
      input_tokens: input,
      output_tokens: output,
      cache_tokens: cache,
      total_tokens: input + output + cache,
      cost_krw: Number(row.cost_krw) || 0,
      latest_at: row.latest_at || null,
    };
  });
  return { since, days: dayCount, subjects };
}

export async function getUsageRequests(env: Env, userId: string, days = 30, limit = 50): Promise<{ since: string; days: number; requests: UsageRequestSummary[] }> {
  const dayCount = clampRetentionDays(days);
  const rowLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const since = new Date(Date.now() - (dayCount - 1) * 86400000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    `SELECT id, day, provider, model, input_tokens, output_tokens, cache_tokens, cost_krw, created_at
     FROM usage_events
     WHERE user_id=? AND day>=?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(userId, since, rowLimit).all<{
    id: number;
    day: string;
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_tokens: number;
    cost_krw: number;
    created_at: string;
  }>();

  const requests = (results || []).map((row) => {
    const input = Number(row.input_tokens) || 0;
    const output = Number(row.output_tokens) || 0;
    const cache = Number(row.cache_tokens) || 0;
    return {
      id: Number(row.id),
      day: row.day,
      provider: row.provider,
      model: row.model,
      input_tokens: input,
      output_tokens: output,
      cache_tokens: cache,
      total_tokens: input + output + cache,
      cost_krw: Number(row.cost_krw) || 0,
      created_at: row.created_at,
    };
  });
  return { since, days: dayCount, requests };
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function usageExportCsv(rows: UsageExportRow[]): string {
  const header = [
    "day",
    "created_at",
    "subject_type",
    "subject_label",
    "device_label",
    "provider",
    "model",
    "input_tokens",
    "output_tokens",
    "cache_tokens",
    "total_tokens",
    "cost_krw",
    "source",
    "status_code",
  ];
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvCell(row[key as keyof UsageExportRow])).join(",")),
  ].join("\n");
}

export async function getUsageExportCsv(env: Env, userId: string, days = USAGE_RETENTION_DAYS): Promise<{ filename: string; csv: string }> {
  const dayCount = clampRetentionDays(days);
  const since = new Date(Date.now() - (dayCount - 1) * 86400000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    `SELECT day, created_at, user_id, device_id, provider, model, input_tokens, output_tokens, cache_tokens,
            cost_krw, source, status_code
     FROM usage_events
     WHERE user_id=? AND day>=?
     ORDER BY created_at DESC`
  ).bind(userId, since).all<{
    day: string;
    created_at: string;
    user_id: string;
    device_id: string | null;
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_tokens: number;
    cost_krw: number;
    source: string;
    status_code: number | null;
  }>();
  const rows: UsageExportRow[] = (results || []).map((row) => {
    const input = Number(row.input_tokens) || 0;
    const output = Number(row.output_tokens) || 0;
    const cache = Number(row.cache_tokens) || 0;
    const type = subjectType(row.user_id);
    return {
      day: row.day,
      created_at: row.created_at,
      subject_type: type,
      subject_label: safeSubjectLabel(row.user_id),
      device_label: row.device_id ? `Device ${maskUsageIdentifier(row.device_id, 4)}` : "",
      provider: row.provider,
      model: row.model,
      input_tokens: input,
      output_tokens: output,
      cache_tokens: cache,
      total_tokens: input + output + cache,
      cost_krw: Number(row.cost_krw) || 0,
      source: row.source || "app",
      status_code: row.status_code ?? null,
    };
  });
  return { filename: `usage-${since}-${today()}.csv`, csv: usageExportCsv(rows) };
}

export async function pruneOldUsageData(env: Env): Promise<void> {
  const cutoff = retentionCutoffDay();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM usage_alerts WHERE day < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM usage_resets WHERE day < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM usage_events WHERE day < ?").bind(cutoff),
  ]);
}

function normalizePeriod(period?: string | null): CostDashboardPeriod {
  return period === "week" || period === "month" ? period : "day";
}

function daysForPeriod(period: CostDashboardPeriod): number {
  if (period === "month") return 30;
  if (period === "week") return 7;
  return 1;
}

function dateRange(days: number): { since: string; days: string[] } {
  const items: string[] = [];
  for (let i = days - 1; i >= 0; i--) items.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  return { since: items[0], days: items };
}

export async function getCostDashboard(env: Env, userId: string, periodValue?: string | null): Promise<CostDashboard> {
  const period = normalizePeriod(periodValue);
  const dayCount = daysForPeriod(period);
  const { since, days } = dateRange(dayCount);
  const settings = await getUsageLimitSettings(env, userId);

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS requests,
            COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cache_tokens),0) AS cache_tokens,
            COALESCE(SUM(cost_krw),0) AS cost_krw
     FROM usage_events
     WHERE user_id=? AND day>=?`
  ).bind(userId, since).first<{
    requests: number;
    input_tokens: number;
    output_tokens: number;
    cache_tokens: number;
    cost_krw: number;
  }>();

  const { results: dayRows } = await env.DB.prepare(
    `SELECT day, COUNT(*) AS requests, COALESCE(SUM(cost_krw),0) AS cost
     FROM usage_events
     WHERE user_id=? AND day>=?
     GROUP BY day
     ORDER BY day`
  ).bind(userId, since).all<{ day: string; requests: number; cost: number }>();

  const { results: providerRows } = await env.DB.prepare(
    `SELECT provider,
            COUNT(*) AS requests,
            COALESCE(SUM(input_tokens + output_tokens + cache_tokens),0) AS total_tokens,
            COALESCE(SUM(cost_krw),0) AS cost_krw
     FROM usage_events
     WHERE user_id=? AND day>=?
     GROUP BY provider
     ORDER BY cost_krw DESC`
  ).bind(userId, since).all<{ provider: string; requests: number; total_tokens: number; cost_krw: number }>();

  const { results: modelRows } = await env.DB.prepare(
    `SELECT provider, model,
            COUNT(*) AS requests,
            COALESCE(SUM(input_tokens + output_tokens + cache_tokens),0) AS total_tokens,
            COALESCE(SUM(cost_krw),0) AS cost_krw
     FROM usage_events
     WHERE user_id=? AND day>=?
     GROUP BY provider, model
     ORDER BY cost_krw DESC`
  ).bind(userId, since).all<{ provider: string; model: string; requests: number; total_tokens: number; cost_krw: number }>();

  const daily: Record<string, { cost: number; requests: number }> = {};
  for (const day of days) daily[day] = { cost: 0, requests: 0 };
  for (const row of dayRows || []) {
    if (!daily[row.day]) continue;
    daily[row.day].cost = Number(row.cost) || 0;
    daily[row.day].requests = Number(row.requests) || 0;
  }

  const input = Number(totalRow?.input_tokens) || 0;
  const output = Number(totalRow?.output_tokens) || 0;
  const cache = Number(totalRow?.cache_tokens) || 0;
  const cost = Number(totalRow?.cost_krw) || 0;
  const periodLimit = settings.daily_limit_krw * dayCount;

  return {
    period,
    since,
    days: dayCount,
    totals: {
      requests: Number(totalRow?.requests) || 0,
      input_tokens: input,
      output_tokens: output,
      cache_tokens: cache,
      total_tokens: input + output + cache,
      cost_krw: cost,
    },
    budget: {
      daily_limit_krw: settings.daily_limit_krw,
      period_limit_krw: periodLimit,
      used_krw: cost,
      remaining_krw: Math.max(0, periodLimit - cost),
      burn_rate: periodLimit > 0 ? cost / periodLimit : 0,
    },
    days_series: days.map((day) => ({ day, cost: daily[day].cost, requests: daily[day].requests })),
    providers: (providerRows || []).map((row) => ({
      provider: row.provider,
      requests: Number(row.requests) || 0,
      total_tokens: Number(row.total_tokens) || 0,
      cost_krw: Number(row.cost_krw) || 0,
    })),
    models: (modelRows || []).map((row) => ({
      provider: row.provider,
      model: row.model,
      requests: Number(row.requests) || 0,
      total_tokens: Number(row.total_tokens) || 0,
      cost_krw: Number(row.cost_krw) || 0,
    })),
  };
}

function normalizeTokenCount(value: unknown): number {
  return Math.max(0, Math.round(Number(value) || 0));
}

function metadataJson(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) return null;
  try {
    return JSON.stringify(value).slice(0, 4000);
  } catch {
    return null;
  }
}

export async function recordUsageEvent(env: Env, event: UsageEventInput): Promise<number> {
  await pruneOldUsageData(env);
  const day = today();
  const before = await getCurrentUsageCost(env, event.userId, day);
  const inputTokens = normalizeTokenCount(event.inputTokens);
  const outputTokens = normalizeTokenCount(event.outputTokens);
  const cacheTokens = normalizeTokenCount(event.cacheTokens);
  const cost = Number.isFinite(Number(event.costKRW))
    ? Math.max(0, Number(event.costKRW))
    : computeCostKRW(event.provider, event.model, inputTokens, outputTokens);
  await env.DB.prepare(
    `INSERT INTO usage_events (
       user_id, day, provider, model, input_tokens, output_tokens, cache_tokens, cost_krw, created_at,
       org_id, device_id, proxy_key_id, source, request_id, latency_ms, status_code, error_code, metadata_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    event.userId,
    day,
    event.provider,
    event.model,
    inputTokens,
    outputTokens,
    cacheTokens,
    cost,
    new Date().toISOString(),
    event.orgId || null,
    event.deviceId || null,
    event.proxyKeyId || null,
    event.source || "app",
    event.requestId || null,
    Number.isFinite(Number(event.latencyMs)) ? Math.max(0, Math.round(Number(event.latencyMs))) : null,
    Number.isFinite(Number(event.statusCode)) ? Math.round(Number(event.statusCode)) : null,
    event.errorCode ? String(event.errorCode).slice(0, 120) : null,
    metadataJson(event.metadata)
  ).run();
  await recordUsageAlertsIfNeeded(env, event.userId, before, before + cost);
  return cost;
}

export async function logUsage(
  env: Env, userId: string, provider: string, model: string, inTok: number, outTok: number, cacheTok = 0, options: UsageLogOptions = {}
): Promise<number> {
  return recordUsageEvent(env, {
    ...options,
    userId,
    provider,
    model,
    inputTokens: inTok,
    outputTokens: outTok,
    cacheTokens: cacheTok,
  });
}
