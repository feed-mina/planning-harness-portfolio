export const AGENT_PROVIDERS = ["claude", "codex", "copilot"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const AGENT_OBSERVATION_SOURCES = ["manual", "provider_api", "local_bridge"] as const;
export type AgentObservationSource = (typeof AGENT_OBSERVATION_SOURCES)[number];

export const AGENT_WINDOW_STATUSES = ["fresh", "stale", "unsupported", "unconfigured", "error"] as const;
export type AgentWindowStatus = (typeof AGENT_WINDOW_STATUSES)[number];

export const AGENT_WINDOW_KINDS = ["rolling_5h", "daily", "weekly", "monthly"] as const;
export type AgentWindowKind = (typeof AGENT_WINDOW_KINDS)[number];

export const AGENT_UNITS = ["percent", "requests", "messages", "credits", "tokens", "unknown"] as const;
export type AgentUnit = (typeof AGENT_UNITS)[number];

type BillingInterval = "unknown" | "monthly" | "yearly";

interface AgentSubscriptionsEnv {
  DB: D1Database;
}

interface ProviderDefinition {
  provider: AgentProvider;
  label: string;
  verification_url: string;
  verification_guidance: string;
  windows: ReadonlyArray<{
    kind: AgentWindowKind;
    label: string;
    default_unit: AgentUnit;
    input_supported: boolean;
    unsupported_reason?: string;
  }>;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  provider: AgentProvider;
  plan_label: string;
  billing_interval: BillingInterval;
  next_renewal_on: string | null;
  timezone: string;
  renewal_source: AgentObservationSource;
  verified_at: string;
  created_at: string;
  updated_at: string;
}

interface WindowRow {
  id: string;
  user_id: string;
  provider: AgentProvider;
  window_kind: AgentWindowKind;
  remaining_value: number | null;
  limit_value: number | null;
  unit: AgentUnit;
  resets_at: string | null;
  source: AgentObservationSource;
  status: AgentWindowStatus;
  observed_at: string;
  message: string | null;
  created_at: string;
  updated_at: string;
}

export const AGENT_PROVIDER_DEFINITIONS: ReadonlyArray<ProviderDefinition> = [
  {
    provider: "claude",
    label: "Claude",
    verification_url: "https://support.claude.com/en/articles/14553413-claude-code-cheatsheet",
    verification_guidance: "Claude Code에서 /usage를 실행해 현재 플랜의 롤링·주간 한도와 리셋 시각을 확인하세요.",
    windows: [
      {
        kind: "daily",
        label: "일간",
        default_unit: "unknown",
        input_supported: false,
        unsupported_reason: "Claude 공식 사용 화면에서 독립된 일간 잔여치를 확인할 수 없어 이 슬롯은 미지원입니다.",
      },
      { kind: "weekly", label: "주간", default_unit: "percent", input_supported: true },
      { kind: "rolling_5h", label: "5시간 롤링", default_unit: "percent", input_supported: true },
    ],
  },
  {
    provider: "codex",
    label: "Codex",
    verification_url: "https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan",
    verification_guidance: "Codex 설정의 Usage 화면 또는 한도 배너에서 현재 계정에 실제로 표시되는 윈도우를 확인하세요.",
    windows: [
      {
        kind: "daily",
        label: "일간",
        default_unit: "unknown",
        input_supported: false,
        unsupported_reason: "Codex 공식 사용 화면에서 독립된 일간 잔여치를 확인할 수 없어 이 슬롯은 미지원입니다.",
      },
      { kind: "weekly", label: "주간", default_unit: "percent", input_supported: true },
      { kind: "rolling_5h", label: "5시간 롤링", default_unit: "percent", input_supported: true },
    ],
  },
  {
    provider: "copilot",
    label: "GitHub Copilot",
    verification_url: "https://github.com/settings/billing",
    verification_guidance: "GitHub Billing & licensing 또는 IDE의 Copilot usage에서 현재 플랜의 월간 요청량을 확인하세요.",
    windows: [
      {
        kind: "daily",
        label: "일간",
        default_unit: "unknown",
        input_supported: false,
        unsupported_reason: "GitHub Copilot 개인 플랜은 독립된 일간 잔여치를 제공하지 않아 이 슬롯은 미지원입니다.",
      },
      {
        kind: "weekly",
        label: "주간",
        default_unit: "unknown",
        input_supported: false,
        unsupported_reason: "GitHub Copilot 개인 플랜은 독립된 주간 잔여치를 제공하지 않아 이 슬롯은 미지원입니다.",
      },
      { kind: "monthly", label: "월간", default_unit: "requests", input_supported: true },
    ],
  },
] as const;

const PROVIDER_BY_ID = new Map(AGENT_PROVIDER_DEFINITIONS.map((item) => [item.provider, item]));
const BILLING_INTERVALS = ["unknown", "monthly", "yearly"] as const;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 240;
const MAX_JSON_BODY_BYTES = 32 * 1024;
const SENSITIVE_FIELD = /(token|cookie|secret|password|authorization|browser[_-]?profile|session[_-]?key)/i;

export class AgentSubscriptionError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AgentSubscriptionError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentSubscriptionError(400, "invalid_body", "JSON 객체가 필요합니다.");
  }
  return value as Record<string, unknown>;
}

function assertNoSensitiveFields(value: unknown, path = "body"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELD.test(key)) {
      throw new AgentSubscriptionError(
        400,
        "sensitive_field_forbidden",
        "쿠키, 인증 토큰, 비밀번호 또는 브라우저 세션 정보는 저장하지 않습니다.",
        { field: `${path}.${key}` },
      );
    }
    assertNoSensitiveFields(child, `${path}.${key}`);
  }
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new AgentSubscriptionError(400, "invalid_field", `${field} 값이 올바르지 않습니다.`, { field, allowed });
  }
  return value as T;
}

function normalizeText(value: unknown, field: string, maxLength: number, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") {
    throw new AgentSubscriptionError(400, "invalid_field", `${field}는 문자열이어야 합니다.`, { field });
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new AgentSubscriptionError(400, "invalid_field", `${field}가 너무 깁니다.`, { field, max_length: maxLength });
  }
  return normalized;
}

function normalizeProvider(value: string): AgentProvider {
  return normalizeEnum(value, AGENT_PROVIDERS, "provider");
}

function strictDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AgentSubscriptionError(400, "invalid_date", `${field}는 YYYY-MM-DD 형식이어야 합니다.`, { field });
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2020 || year > 2200 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new AgentSubscriptionError(400, "invalid_date", `${field}의 달력 날짜가 올바르지 않습니다.`, { field });
  }
  return value;
}

function normalizeTimestamp(value: unknown, field: string, nowMs: number, required = true): string | null {
  if (value === undefined || value === null || value === "") {
    if (!required) return null;
    throw new AgentSubscriptionError(400, "invalid_timestamp", `${field}가 필요합니다.`, { field });
  }
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    throw new AgentSubscriptionError(400, "invalid_timestamp", `${field}는 시간대가 포함된 ISO 시각이어야 합니다.`, { field });
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new AgentSubscriptionError(400, "invalid_timestamp", `${field} 시각이 올바르지 않습니다.`, { field });
  }
  if (parsed > nowMs + MAX_FUTURE_SKEW_MS) {
    throw new AgentSubscriptionError(400, "future_observation", `${field}는 현재보다 5분 이상 미래일 수 없습니다.`, { field });
  }
  return new Date(parsed).toISOString();
}

function normalizeResetTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    throw new AgentSubscriptionError(400, "invalid_timestamp", `${field}는 시간대가 포함된 ISO 시각이어야 합니다.`, { field });
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new AgentSubscriptionError(400, "invalid_timestamp", `${field} 시각이 올바르지 않습니다.`, { field });
  }
  return new Date(parsed).toISOString();
}

function normalizeTimezone(value: unknown): string {
  const timezone = normalizeText(value, "timezone", 64, "Asia/Seoul");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new AgentSubscriptionError(400, "invalid_timezone", "지원되는 IANA 시간대를 입력하세요.", { field: "timezone" });
  }
  return timezone;
}

function localDateAt(timestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function normalizeOptionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new AgentSubscriptionError(400, "invalid_number", `${field}는 0 이상의 숫자여야 합니다.`, { field });
  }
  return value;
}

function providerWindow(provider: AgentProvider, kind: AgentWindowKind) {
  const definition = PROVIDER_BY_ID.get(provider);
  const window = definition?.windows.find((item) => item.kind === kind);
  if (!window || !window.input_supported) {
    throw new AgentSubscriptionError(
      400,
      "unsupported_window",
      `${provider}에는 ${kind} 윈도우를 임의로 만들 수 없습니다. 제공자 화면에 표시되는 고유 윈도우만 입력하세요.`,
      {
        provider,
        window_kind: kind,
        supported: definition?.windows.filter((item) => item.input_supported).map((item) => item.kind) || [],
      },
    );
  }
  return window;
}

function renewalPresentation(row: SubscriptionRow, nowMs: number) {
  if (!row.next_renewal_on) return { renewal_status: "unconfigured" as const, days_until_renewal: null };
  const today = localDateAt(new Date(nowMs).toISOString(), row.timezone);
  if (row.next_renewal_on < today) return { renewal_status: "stale" as const, days_until_renewal: null };
  const days = Math.round((Date.parse(`${row.next_renewal_on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { renewal_status: "fresh" as const, days_until_renewal: days };
}

function defaultWindowMessage(status: AgentWindowStatus): string {
  if (status === "stale") return "리셋 시각이 지났습니다. 새 값을 확인해 다시 입력하세요.";
  if (status === "unsupported") return "현재 플랜 또는 제공자 화면에서 이 값을 확인할 수 없습니다.";
  if (status === "error") return "마지막 확인 과정에서 오류가 발생했습니다.";
  if (status === "unconfigured") return "아직 값을 입력하지 않았습니다.";
  return "";
}

function windowPresentation(row: WindowRow | undefined, definition: ProviderDefinition["windows"][number], nowMs: number) {
  if (!row) {
    const status: AgentWindowStatus = definition.input_supported ? "unconfigured" : "unsupported";
    return {
      window_kind: definition.kind,
      label: definition.label,
      input_supported: definition.input_supported,
      status,
      remaining_value: null,
      recorded_remaining_value: null,
      limit_value: null,
      unit: definition.default_unit,
      resets_at: null,
      source: null,
      observed_at: null,
      message: definition.unsupported_reason || defaultWindowMessage(status),
    };
  }
  const resetPassed = row.status === "fresh" && !!row.resets_at && Date.parse(row.resets_at) <= nowMs;
  const status: AgentWindowStatus = resetPassed ? "stale" : row.status;
  return {
    window_kind: definition.kind,
    label: definition.label,
    input_supported: definition.input_supported,
    status,
    remaining_value: status === "fresh" ? row.remaining_value : null,
    recorded_remaining_value: status === "stale" ? row.remaining_value : null,
    limit_value: row.limit_value,
    unit: row.unit,
    resets_at: row.resets_at,
    source: row.source,
    observed_at: row.observed_at,
    message: resetPassed ? defaultWindowMessage("stale") : (row.message || defaultWindowMessage(status)),
  };
}

interface CredentialSummaryRow {
  provider: AgentProvider;
  account_login: string;
  monthly_included_requests: number | null;
  last_sync_at: string | null;
  last_sync_status: "never" | "ok" | "error";
  last_sync_message: string | null;
}

// PAT 원문/암호문은 절대 포함하지 않는다 — 표시용 메타데이터만 조회.
async function listCredentialSummaries(env: AgentSubscriptionsEnv, userId: string): Promise<CredentialSummaryRow[]> {
  try {
    const result = await env.DB.prepare(
      `SELECT provider, account_login, monthly_included_requests, last_sync_at, last_sync_status, last_sync_message
         FROM agent_provider_credentials
        WHERE user_id=?1`
    ).bind(userId).all<CredentialSummaryRow>();
    return result.results || [];
  } catch {
    return []; // 마이그레이션 이전 환경
  }
}

export async function listAgentSubscriptions(env: AgentSubscriptionsEnv, userId: string, nowMs = Date.now()) {
  const credentials = await listCredentialSummaries(env, userId);
  const [subscriptionsResult, windowsResult] = await Promise.all([
    env.DB.prepare(
      `SELECT id, user_id, provider, plan_label, billing_interval, next_renewal_on, timezone,
              renewal_source, verified_at, created_at, updated_at
         FROM agent_subscriptions
        WHERE user_id=?1
        ORDER BY provider`
    ).bind(userId).all<SubscriptionRow>(),
    env.DB.prepare(
      `SELECT id, user_id, provider, window_kind, remaining_value, limit_value, unit, resets_at,
              source, status, observed_at, message, created_at, updated_at
         FROM agent_usage_windows
        WHERE user_id=?1
        ORDER BY provider, window_kind`
    ).bind(userId).all<WindowRow>(),
  ]);
  const subscriptions = subscriptionsResult.results || [];
  const windows = windowsResult.results || [];

  return {
    version: 1,
    collection_mode: "manual",
    automatic_sync: credentials.length > 0,
    required_usage_slots: ["daily", "weekly"] as const,
    reset_policy: "observation_required",
    // 수동 관측 입력 경로는 자격증명을 수집하지 않는다. Copilot PAT는 사용자가
    // 별도 credential API로 명시 등록하며 암호문으로만 저장된다 (adapter-research.md).
    sensitive_credentials_collected: false,
    providers: AGENT_PROVIDER_DEFINITIONS.map((definition) => {
      const subscription = subscriptions.find((row) => row.provider === definition.provider);
      const credential = credentials.find((row) => row.provider === definition.provider);
      return {
        provider: definition.provider,
        label: definition.label,
        verification_url: definition.verification_url,
        verification_guidance: definition.verification_guidance,
        adapter_available: definition.provider === "copilot",
        supported_windows: definition.windows.filter((item) => item.input_supported).map((item) => item.kind),
        subscription: subscription ? { ...subscription, ...renewalPresentation(subscription, nowMs) } : null,
        credential: definition.provider === "copilot"
          ? (credential
            ? {
              configured: true,
              account_login: credential.account_login,
              monthly_included_requests: credential.monthly_included_requests,
              last_sync_at: credential.last_sync_at,
              last_sync_status: credential.last_sync_status,
              last_sync_message: credential.last_sync_message,
            }
            : { configured: false })
          : null,
        windows: definition.windows.map((item) => windowPresentation(
          windows.find((row) => row.provider === definition.provider && row.window_kind === item.kind),
          item,
          nowMs,
        )),
      };
    }),
  };
}

export async function upsertAgentSubscription(
  env: AgentSubscriptionsEnv,
  userId: string,
  providerValue: string,
  input: unknown,
  nowMs = Date.now(),
) {
  const provider = normalizeProvider(providerValue);
  const body = asRecord(input);
  assertNoSensitiveFields(body);
  const timezone = normalizeTimezone(body.timezone);
  const verifiedAt = normalizeTimestamp(body.verified_at, "verified_at", nowMs)!;
  const nextRenewalOn = strictDate(body.next_renewal_on, "next_renewal_on");
  if (nextRenewalOn && nextRenewalOn < localDateAt(verifiedAt, timezone)) {
    throw new AgentSubscriptionError(
      400,
      "past_renewal_date",
      "다음 갱신일은 확인 시각의 현지 날짜보다 이전일 수 없습니다. 과거 값을 자동으로 다음 주기로 추정하지 않습니다.",
      { field: "next_renewal_on" },
    );
  }
  const planLabel = normalizeText(body.plan_label, "plan_label", 80);
  const billingInterval = normalizeEnum(body.billing_interval ?? "unknown", BILLING_INTERVALS, "billing_interval");
  const renewalSource = normalizeEnum(body.renewal_source ?? "manual", AGENT_OBSERVATION_SOURCES, "renewal_source");
  const now = new Date(nowMs).toISOString();

  const result = await env.DB.prepare(
    `INSERT INTO agent_subscriptions
       (id, user_id, provider, plan_label, billing_interval, next_renewal_on, timezone,
        renewal_source, verified_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       plan_label=excluded.plan_label,
       billing_interval=excluded.billing_interval,
       next_renewal_on=excluded.next_renewal_on,
       timezone=excluded.timezone,
       renewal_source=excluded.renewal_source,
       verified_at=excluded.verified_at,
       updated_at=excluded.updated_at
     WHERE excluded.verified_at > agent_subscriptions.verified_at`
  ).bind(
    crypto.randomUUID(), userId, provider, planLabel, billingInterval, nextRenewalOn,
    timezone, renewalSource, verifiedAt, now,
  ).run();

  return { applied: (result.meta.changes || 0) > 0, dashboard: await listAgentSubscriptions(env, userId, nowMs) };
}

export async function upsertAgentUsageWindow(
  env: AgentSubscriptionsEnv,
  userId: string,
  providerValue: string,
  windowValue: string,
  input: unknown,
  nowMs = Date.now(),
) {
  const provider = normalizeProvider(providerValue);
  const windowKind = normalizeEnum(windowValue, AGENT_WINDOW_KINDS, "window_kind");
  const definition = providerWindow(provider, windowKind);
  const body = asRecord(input);
  assertNoSensitiveFields(body);
  const existingSubscription = await env.DB.prepare(
    "SELECT id FROM agent_subscriptions WHERE user_id=?1 AND provider=?2"
  ).bind(userId, provider).first<{ id: string }>();
  if (!existingSubscription) {
    throw new AgentSubscriptionError(409, "subscription_required", "사용량을 저장하기 전에 구독 정보를 먼저 저장하세요.");
  }

  const status = normalizeEnum(body.status, AGENT_WINDOW_STATUSES, "status");
  const observedAt = normalizeTimestamp(body.observed_at, "observed_at", nowMs)!;
  const remainingValue = normalizeOptionalNumber(body.remaining_value, "remaining_value");
  const limitValue = normalizeOptionalNumber(body.limit_value, "limit_value");
  const unit = normalizeEnum(body.unit ?? definition.default_unit, AGENT_UNITS, "unit");
  const resetsAt = normalizeResetTimestamp(body.resets_at, "resets_at");
  const source = normalizeEnum(body.source ?? "manual", AGENT_OBSERVATION_SOURCES, "source");
  const message = normalizeText(body.message, "message", MAX_MESSAGE_LENGTH) || null;

  if (status === "fresh") {
    if (remainingValue === null || resetsAt === null) {
      throw new AgentSubscriptionError(400, "incomplete_observation", "fresh 상태에는 잔여량과 다음 리셋 시각이 필요합니다.");
    }
    if (Date.parse(resetsAt) <= Date.parse(observedAt)) {
      throw new AgentSubscriptionError(400, "invalid_reset", "fresh 관측의 리셋 시각은 관측 시각보다 미래여야 합니다.");
    }
  } else if (remainingValue !== null) {
    throw new AgentSubscriptionError(400, "unknown_must_be_null", "fresh가 아닌 상태의 잔여량은 0이 아니라 null이어야 합니다.");
  }
  if (remainingValue !== null && limitValue !== null && remainingValue > limitValue) {
    throw new AgentSubscriptionError(400, "remaining_exceeds_limit", "잔여량은 전체 한도보다 클 수 없습니다.");
  }

  const now = new Date(nowMs).toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO agent_usage_windows
       (id, user_id, provider, window_kind, remaining_value, limit_value, unit, resets_at,
        source, status, observed_at, message, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
     ON CONFLICT(user_id, provider, window_kind) DO UPDATE SET
       remaining_value=excluded.remaining_value,
       limit_value=excluded.limit_value,
       unit=excluded.unit,
       resets_at=excluded.resets_at,
       source=excluded.source,
       status=excluded.status,
       observed_at=excluded.observed_at,
       message=excluded.message,
       updated_at=excluded.updated_at
     WHERE excluded.observed_at > agent_usage_windows.observed_at`
  ).bind(
    crypto.randomUUID(), userId, provider, windowKind, remainingValue, limitValue, unit,
    resetsAt, source, status, observedAt, message, now,
  ).run();

  return { applied: (result.meta.changes || 0) > 0, dashboard: await listAgentSubscriptions(env, userId, nowMs) };
}

export async function deleteAgentSubscription(
  env: AgentSubscriptionsEnv,
  userId: string,
  providerValue: string,
  nowMs = Date.now(),
) {
  const provider = normalizeProvider(providerValue);
  const result = await env.DB.prepare(
    "DELETE FROM agent_subscriptions WHERE user_id=?1 AND provider=?2"
  ).bind(userId, provider).run();
  return {
    deleted: (result.meta.changes || 0) > 0,
    provider,
    dashboard: await listAgentSubscriptions(env, userId, nowMs),
  };
}

function authenticatedUser(userId: string | null | undefined): userId is string {
  return !!userId && !userId.startsWith("anon:");
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new AgentSubscriptionError(400, "invalid_path_encoding", "경로의 퍼센트 인코딩이 올바르지 않습니다.");
  }
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AgentSubscriptionError(415, "json_required", "application/json 요청만 지원합니다.");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new AgentSubscriptionError(413, "payload_too_large", "JSON 본문은 32KB를 초과할 수 없습니다.");
  }
  if (!request.body) {
    throw new AgentSubscriptionError(400, "invalid_json", "올바른 JSON 본문이 필요합니다.");
  }
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BODY_BYTES) {
        await reader.cancel("payload too large").catch(() => undefined);
        throw new AgentSubscriptionError(413, "payload_too_large", "JSON 본문은 32KB를 초과할 수 없습니다.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch (error) {
    if (error instanceof AgentSubscriptionError) throw error;
    throw new AgentSubscriptionError(400, "invalid_json", "올바른 UTF-8 JSON 본문이 필요합니다.");
  }
}

// REQ-205 이원화: 공개 API는 사용자 명시 입력(manual)과 로그인 사용자의 로컬 브리지 push(local_bridge)를
// 수용한다. provider_api는 서버 내부 어댑터(agentUsageAdapters) 전용으로 유지한다.
function manualHttpInput(value: unknown, sourceField: "renewal_source" | "source"): Record<string, unknown> {
  const body = asRecord(value);
  const claimedSource = body[sourceField] ?? "manual";
  if (claimedSource !== "manual" && claimedSource !== "local_bridge") {
    throw new AgentSubscriptionError(
      400,
      "untrusted_source",
      "공개 입력 API에서는 source=manual 또는 local_bridge만 허용합니다. provider_api는 서버 내부 어댑터 경계에서만 사용할 수 있습니다.",
      { field: sourceField },
    );
  }
  return { ...body, [sourceField]: claimedSource };
}

export async function handleAgentSubscriptionsRequest(
  request: Request,
  env: AgentSubscriptionsEnv,
  userId: string | null | undefined,
  nowMs = Date.now(),
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== "/api/agent-subscriptions" && !path.startsWith("/api/agent-subscriptions/")) return null;
  if (!authenticatedUser(userId)) {
    return apiJson({ error: "로그인이 필요합니다.", code: "login_required" }, { status: 401 });
  }

  try {
    if (path === "/api/agent-subscriptions" && request.method === "GET") {
      return apiJson(await listAgentSubscriptions(env, userId, nowMs));
    }

    const windowMatch = path.match(/^\/api\/agent-subscriptions\/([^/]+)\/windows\/([^/]+)$/);
    if (windowMatch && request.method === "PUT") {
      return apiJson(await upsertAgentUsageWindow(
        env,
        userId,
        decodePathSegment(windowMatch[1]),
        decodePathSegment(windowMatch[2]),
        manualHttpInput(await readJson(request), "source"),
        nowMs,
      ));
    }

    const providerMatch = path.match(/^\/api\/agent-subscriptions\/([^/]+)$/);
    if (providerMatch && request.method === "PUT") {
      return apiJson(await upsertAgentSubscription(
        env,
        userId,
        decodePathSegment(providerMatch[1]),
        manualHttpInput(await readJson(request), "renewal_source"),
        nowMs,
      ));
    }
    if (providerMatch && request.method === "DELETE") {
      return apiJson(await deleteAgentSubscription(env, userId, decodePathSegment(providerMatch[1]), nowMs));
    }

    if (path === "/api/agent-subscriptions" || providerMatch || windowMatch) {
      return apiJson({ error: "지원하지 않는 메서드입니다.", code: "method_not_allowed" }, {
        status: 405,
        headers: { allow: path === "/api/agent-subscriptions" ? "GET" : (windowMatch ? "PUT" : "PUT, DELETE") },
      });
    }
    return apiJson({ error: "찾을 수 없습니다.", code: "not_found" }, { status: 404 });
  } catch (error) {
    if (error instanceof AgentSubscriptionError) {
      return apiJson({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    }
    throw error;
  }
}
