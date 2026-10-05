import type { Env } from "./env";
import { decryptToken, encryptToken } from "./core/auth";

type IntegrationProvider = "google_calendar" | "kakao_message";

interface IntegrationTokenRow {
  id: string;
  user_id: string;
  provider: IntegrationProvider;
  access_token_enc: string;
  refresh_token_enc: string | null;
  scope: string | null;
  token_type: string | null;
  expires_at: string | null;
  connected_at: string;
  updated_at: string;
}

interface OAuthTokenInput {
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  tokenType?: string;
  expiresIn?: number;
}

interface ScheduleInput {
  date: string;
  start_time: string;
  end_time: string;
  timezone: string;
  kind: string;
  note: string | null;
  repeat_weekdays: number[];
}

interface NotificationJobRow {
  id: string;
  user_id: string;
  provider: IntegrationProvider;
  due_at: string;
  payload_json: string | null;
  status: string;
  attempts: number;
}

export class IntegrationError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "integration_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];
const KIND_LABEL: Record<string, string> = {
  available: "가능",
  busy: "바쁨",
  focus: "집중",
  meeting: "회의",
};
const REMINDER_MINUTES = new Set([30, 90, 180]);

function nowIso(): string {
  return new Date().toISOString();
}

function expiryIso(expiresIn?: number): string | null {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function formBody(data: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeDate(value: unknown): string {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new IntegrationError(400, "날짜는 YYYY-MM-DD 형식이어야 합니다.", "invalid_date");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new IntegrationError(400, "유효하지 않은 날짜입니다.", "invalid_date");
  }
  return date;
}

function normalizeTime(value: unknown, field: string): string {
  const time = String(value || "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new IntegrationError(400, `${field}는 HH:MM 형식이어야 합니다.`, "invalid_time");
  }
  return time;
}

function normalizeTimezone(value: unknown): string {
  const timezone = String(value || "Asia/Seoul").trim().slice(0, 80);
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$|^UTC$/.test(timezone)) {
    throw new IntegrationError(400, "타임존은 Asia/Seoul 같은 IANA 형식이어야 합니다.", "invalid_timezone");
  }
  return timezone;
}

function normalizeWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  )).sort((a, b) => a - b);
}

function normalizeReminderMinutes(value: unknown): number[] {
  const source = Array.isArray(value) ? value : [30];
  const minutes = Array.from(new Set(
    source.map((item) => Number(item)).filter((item) => REMINDER_MINUTES.has(item))
  )).sort((a, b) => b - a);
  return minutes.length ? minutes : [30];
}

function normalizeSchedule(body: unknown): ScheduleInput {
  const rec = asRecord(body);
  const date = normalizeDate(rec.date);
  const startTime = normalizeTime(rec.start_time, "start_time");
  const endTime = normalizeTime(rec.end_time, "end_time");
  if (startTime >= endTime) throw new IntegrationError(400, "시작 시간은 종료 시간보다 빨라야 합니다.", "invalid_time_range");
  return {
    date,
    start_time: startTime,
    end_time: endTime,
    timezone: normalizeTimezone(rec.timezone),
    kind: String(rec.kind || "available").slice(0, 40),
    note: String(rec.note || "").trim().replace(/\s+/g, " ").slice(0, 240) || null,
    repeat_weekdays: normalizeWeekdays(rec.repeat_weekdays),
  };
}

async function getTokenRow(env: Env, userId: string, provider: IntegrationProvider): Promise<IntegrationTokenRow | null> {
  return await env.DB.prepare(
    `SELECT id, user_id, provider, access_token_enc, refresh_token_enc, scope, token_type,
            expires_at, connected_at, updated_at
     FROM integration_tokens
     WHERE user_id=? AND provider=?`
  ).bind(userId, provider).first<IntegrationTokenRow>();
}

function requireSecret(env: Env): string {
  if (!env.JWT_SECRET) throw new IntegrationError(500, "JWT_SECRET이 설정되어 있지 않습니다.", "missing_secret");
  return env.JWT_SECRET;
}

export async function saveOAuthIntegrationToken(
  env: Env,
  userId: string,
  provider: IntegrationProvider,
  input: OAuthTokenInput
): Promise<void> {
  if (!input.accessToken) throw new IntegrationError(400, "access token이 비어 있습니다.", "missing_access_token");
  const secret = requireSecret(env);
  const existing = await getTokenRow(env, userId, provider);
  const ts = nowIso();
  const accessEnc = await encryptToken(input.accessToken, secret);
  const refreshEnc = input.refreshToken
    ? await encryptToken(input.refreshToken, secret)
    : existing?.refresh_token_enc || null;
  const expiresAt = expiryIso(input.expiresIn) || existing?.expires_at || null;
  const id = existing?.id || crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO integration_tokens (
       id, user_id, provider, access_token_enc, refresh_token_enc, scope, token_type,
       expires_at, connected_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       access_token_enc=excluded.access_token_enc,
       refresh_token_enc=excluded.refresh_token_enc,
       scope=excluded.scope,
       token_type=excluded.token_type,
       expires_at=excluded.expires_at,
       updated_at=excluded.updated_at`
  ).bind(
    id,
    userId,
    provider,
    accessEnc,
    refreshEnc,
    input.scope || existing?.scope || null,
    input.tokenType || existing?.token_type || "Bearer",
    expiresAt,
    existing?.connected_at || ts,
    ts
  ).run();
}

async function refreshGoogleToken(env: Env, refreshToken: string): Promise<OAuthTokenInput> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new IntegrationError(500, "Google OAuth 설정이 없습니다.", "missing_google_oauth");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: formBody({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json().catch(() => ({})) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new IntegrationError(401, data.error_description || "Google 토큰 갱신에 실패했습니다.", "google_refresh_failed");
  }
  return {
    accessToken: data.access_token,
    scope: data.scope,
    tokenType: data.token_type,
    expiresIn: data.expires_in,
  };
}

async function refreshKakaoToken(env: Env, refreshToken: string): Promise<OAuthTokenInput> {
  if (!env.KAKAO_REST_API_KEY) throw new IntegrationError(500, "Kakao OAuth 설정이 없습니다.", "missing_kakao_oauth");
  const response = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: formBody({
      grant_type: "refresh_token",
      client_id: env.KAKAO_REST_API_KEY,
      client_secret: env.KAKAO_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  const data = await response.json().catch(() => ({})) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new IntegrationError(401, data.error_description || "Kakao 토큰 갱신에 실패했습니다.", "kakao_refresh_failed");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    scope: data.scope,
    tokenType: data.token_type,
    expiresIn: data.expires_in,
  };
}

async function getFreshAccessToken(env: Env, userId: string, provider: IntegrationProvider): Promise<string> {
  const row = await getTokenRow(env, userId, provider);
  if (!row) throw new IntegrationError(409, "연동이 필요합니다.", "not_connected");

  const secret = requireSecret(env);
  const accessToken = await decryptToken(row.access_token_enc, secret);
  if (!accessToken) throw new IntegrationError(401, "저장된 access token을 읽을 수 없습니다.", "invalid_access_token");

  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : 0;
  if (!expiresAt || expiresAt > Date.now() + 60_000) return accessToken;

  if (!row.refresh_token_enc) return accessToken;
  const refreshToken = await decryptToken(row.refresh_token_enc, secret);
  if (!refreshToken) return accessToken;

  const refreshed = provider === "google_calendar"
    ? await refreshGoogleToken(env, refreshToken)
    : await refreshKakaoToken(env, refreshToken);
  await saveOAuthIntegrationToken(env, userId, provider, refreshed);
  return refreshed.accessToken;
}

export async function getIntegrationStatus(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT provider, scope, expires_at, connected_at, updated_at
     FROM integration_tokens
     WHERE user_id=? AND provider IN ('google_calendar', 'kakao_message')`
  ).bind(userId).all<Pick<IntegrationTokenRow, "provider" | "scope" | "expires_at" | "connected_at" | "updated_at">>();
  const map = new Map((results || []).map((row) => [row.provider, row]));
  const shape = (provider: IntegrationProvider) => {
    const row = map.get(provider);
    return {
      connected: !!row,
      scope: row?.scope || null,
      expires_at: row?.expires_at || null,
      connected_at: row?.connected_at || null,
      updated_at: row?.updated_at || null,
    };
  };
  return {
    integrations: {
      google_calendar: shape("google_calendar"),
      kakao_message: shape("kakao_message"),
    },
  };
}

function buildCalendarEvent(input: ScheduleInput) {
  const label = KIND_LABEL[input.kind] || input.kind || "일정";
  const summary = input.note || `${label} 일정`;
  const event: Record<string, unknown> = {
    summary,
    description: "기획 하네스 루프에서 생성한 시간 블록입니다.",
    start: { dateTime: `${input.date}T${input.start_time}:00`, timeZone: input.timezone },
    end: { dateTime: `${input.date}T${input.end_time}:00`, timeZone: input.timezone },
    reminders: { useDefault: true },
  };
  if (input.repeat_weekdays.length) {
    event.recurrence = [`RRULE:FREQ=WEEKLY;BYDAY=${input.repeat_weekdays.map((day) => BYDAY[day]).join(",")}`];
  }
  return event;
}

export async function createGoogleCalendarEvent(env: Env, userId: string, body: unknown) {
  const input = normalizeSchedule(body);
  const accessToken = await getFreshAccessToken(env, userId, "google_calendar");
  const event = buildCalendarEvent(input);
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=utf-8",
      accept: "application/json",
    },
    body: JSON.stringify(event),
  });
  const data = await response.json().catch(() => ({})) as {
    id?: string;
    htmlLink?: string;
    summary?: string;
    error?: { message?: string };
  };
  if (!response.ok || !data.id) {
    throw new IntegrationError(response.status || 502, data.error?.message || "Google Calendar 일정 생성에 실패했습니다.", "google_calendar_failed");
  }

  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO external_calendar_events (
       id, user_id, provider, external_event_id, html_link, date, start_time, end_time,
       timezone, recurrence_json, payload_json, created_at
     )
     VALUES (?, ?, 'google_calendar', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    userId,
    data.id,
    data.htmlLink || null,
    input.date,
    input.start_time,
    input.end_time,
    input.timezone,
    input.repeat_weekdays.length ? JSON.stringify(input.repeat_weekdays) : null,
    JSON.stringify(event),
    ts
  ).run();

  return {
    ok: true,
    event: {
      id: data.id,
      html_link: data.htmlLink || null,
      summary: data.summary || (event.summary as string),
    },
  };
}

function scheduleLines(input: ScheduleInput): string[] {
  const lines = [`${input.date} ${input.start_time}-${input.end_time}`];
  if (input.note) lines.push(`메모: ${input.note}`);
  if (input.repeat_weekdays.length) lines.push(`반복: ${input.repeat_weekdays.map((day) => DAY_LABEL[day]).join(", ")}`);
  return lines;
}

function scheduleText(input: ScheduleInput): string {
  return ["일정 알림", ...scheduleLines(input)].join("\n").slice(0, 900);
}

function reminderLabel(minutes: number): string {
  if (minutes === 30) return "30분 전";
  if (minutes === 90) return "1시간 30분 전";
  if (minutes === 180) return "3시간 전";
  return `${minutes}분 전`;
}

function kakaoTemplateObject(env: Env, input: ScheduleInput, text = scheduleText(input)) {
  return {
    object_type: "text",
    text,
    link: {
      web_url: `${env.APP_BASE_URL}/time-settings/`,
      mobile_web_url: `${env.APP_BASE_URL}/time-settings/`,
    },
    button_title: "시간 설정 보기",
  };
}

function zonedParts(timestampMs: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    minute: Number(map.get("minute")),
    second: Number(map.get("second")),
  };
}

function localDateTimeToUtcMs(date: string, time: string, timezone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = targetAsUtc;
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(guess, timezone);
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess -= representedAsUtc - targetAsUtc;
  }
  return guess;
}

async function postKakaoTemplate(env: Env, userId: string, templateObject: Record<string, unknown>) {
  const accessToken = await getFreshAccessToken(env, userId, "kakao_message");
  const response = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      accept: "application/json",
    },
    body: formBody({ template_object: JSON.stringify(templateObject) }),
  });
  const data = await response.json().catch(() => ({})) as { result_code?: number; msg?: string; code?: number };
  if (!response.ok || data.result_code !== 0) {
    const rawMessage = data.msg || "Kakao 메시지 발송에 실패했습니다.";
    const needsConsent = response.status === 401 || response.status === 403 || data.code === -402 || /scope|permission|consent|unauthorized/i.test(rawMessage);
    const message = needsConsent
      ? "Kakao 메시지 권한이 없거나 토큰이 만료되었습니다. '카카오 메시지 알림 연결'을 다시 눌러 메시지 권한에 동의해 주세요."
      : rawMessage;
    throw new IntegrationError(response.status || 502, message, "kakao_message_failed");
  }
  return data;
}

export async function sendKakaoScheduleMessage(env: Env, userId: string, body: unknown) {
  const input = normalizeSchedule(body);
  const templateObject = kakaoTemplateObject(env, input);
  const data = await postKakaoTemplate(env, userId, templateObject);
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO notification_jobs (
       id, user_id, provider, due_at, payload_json, status, attempts, last_error, sent_at, created_at, updated_at
     )
     VALUES (?, ?, 'kakao_message', ?, ?, 'sent', 1, NULL, ?, ?, ?)`
  ).bind(crypto.randomUUID(), userId, ts, JSON.stringify(templateObject), ts, ts, ts).run();

  return { ok: true, result_code: data.result_code };
}

export async function scheduleKakaoReminderJobs(env: Env, userId: string, body: unknown) {
  const input = normalizeSchedule(body);
  await getFreshAccessToken(env, userId, "kakao_message");
  const rec = asRecord(body);
  const minutes = normalizeReminderMinutes(rec.reminder_minutes ?? rec.reminderMinutes);
  const startMs = localDateTimeToUtcMs(input.date, input.start_time, input.timezone);
  const ts = nowIso();
  const nowMs = Date.now();
  const jobs = [];

  for (const minute of minutes) {
    const dueMs = Math.max(nowMs, startMs - minute * 60_000);
    const dueAt = new Date(dueMs).toISOString();
    const label = reminderLabel(minute);
    const text = [`${label} 일정 알림`, ...scheduleLines(input)].join("\n").slice(0, 900);
    const templateObject = kakaoTemplateObject(env, input, text);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO notification_jobs (
         id, user_id, provider, due_at, payload_json, status, attempts, last_error, sent_at, created_at, updated_at
       )
       VALUES (?, ?, 'kakao_message', ?, ?, 'queued', 0, NULL, NULL, ?, ?)`
    ).bind(id, userId, dueAt, JSON.stringify({ reminder_minutes: minute, template_object: templateObject, schedule: input }), ts, ts).run();
    jobs.push({ id, due_at: dueAt, reminder_minutes: minute, label });
  }

  return { ok: true, scheduled_count: jobs.length, jobs };
}

function parseJobTemplate(row: NotificationJobRow): Record<string, unknown> {
  if (!row.payload_json) throw new IntegrationError(400, "Notification job payload is missing.", "missing_payload");
  const parsed = JSON.parse(row.payload_json);
  const rec = asRecord(parsed);
  const template = asRecord(rec.template_object ?? rec.templateObject);
  if (!template.object_type || !template.text) throw new IntegrationError(400, "Notification job template is invalid.", "invalid_payload");
  return template;
}

export async function processDueKakaoNotifications(env: Env, limitValue = 20) {
  const limit = Math.min(50, Math.max(1, Number(limitValue) || 20));
  const ts = nowIso();
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, provider, due_at, payload_json, status, attempts
     FROM notification_jobs
     WHERE provider='kakao_message'
       AND status IN ('queued', 'retry')
       AND due_at<=?
     ORDER BY due_at ASC
     LIMIT ?`
  ).bind(ts, limit).all<NotificationJobRow>();

  let sent = 0;
  let failed = 0;
  for (const row of results || []) {
    const attempts = Number(row.attempts || 0) + 1;
    const claim = await env.DB.prepare(
      "UPDATE notification_jobs SET status='sending', attempts=?, updated_at=? WHERE id=? AND status IN ('queued', 'retry')"
    ).bind(attempts, nowIso(), row.id).run();
    if (!claim.meta.changes) continue;

    try {
      const templateObject = parseJobTemplate(row);
      await postKakaoTemplate(env, row.user_id, templateObject);
      const doneAt = nowIso();
      await env.DB.prepare(
        "UPDATE notification_jobs SET status='sent', last_error=NULL, sent_at=?, updated_at=? WHERE id=?"
      ).bind(doneAt, doneAt, row.id).run();
      sent += 1;
    } catch (err) {
      const retry = attempts < 3;
      const message = err instanceof Error ? err.message : "kakao_message_failed";
      await env.DB.prepare(
        "UPDATE notification_jobs SET status=?, last_error=?, updated_at=? WHERE id=?"
      ).bind(retry ? "retry" : "failed", message.slice(0, 500), nowIso(), row.id).run();
      failed += 1;
    }
  }

  return { ok: true, checked: (results || []).length, sent, failed };
}

export async function disconnectIntegration(env: Env, userId: string, provider: IntegrationProvider) {
  const result = await env.DB.prepare(
    "DELETE FROM integration_tokens WHERE user_id=? AND provider=?"
  ).bind(userId, provider).run();
  return { ok: true, disconnected: result.meta.changes > 0 };
}
