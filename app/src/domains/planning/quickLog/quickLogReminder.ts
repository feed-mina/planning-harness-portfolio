// Quick Log 리마인더 (#213 1차 MVP).
// Quick Log(기록)와 리마인더(기록하라고 알려주는 기능)를 독립적으로 설계한다:
// 설정 API(get/upsert) · ReminderService(메시지 생성) · ReminderSender(발송, 교체 가능) · 스케줄러(processDueQuickLogReminders)
// 카카오 실연동(KakaoSender)은 2차 범위 — 이번에는 ConsoleSender만 둔다.
import type { Env } from "../../../env";

export class QuickLogReminderError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "quick_log_reminder_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface ReminderRow {
  id: string;
  user_id: string;
  enabled: number;
  time: string;
  timezone: string;
  last_sent_date: string | null;
  created_at: string;
  updated_at: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toStringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeTime(raw: unknown): string {
  const value = toStringValue(raw);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new QuickLogReminderError(400, "time must use HH:MM (00:00-23:59) format.", "invalid_time");
  }
  return value;
}

function normalizeTimezone(raw: unknown): string {
  const value = toStringValue(raw).slice(0, 64) || "Asia/Seoul";
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$|^UTC$/.test(value)) {
    throw new QuickLogReminderError(400, "timezone must be a valid IANA timezone.", "invalid_timezone");
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toApiReminder(row: ReminderRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    enabled: !!row.enabled,
    time: row.time,
    timezone: row.timezone,
    last_sent_date: row.last_sent_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getQuickLogReminder(env: Env, userId: string) {
  const row = await env.DB.prepare(
    `SELECT id, user_id, enabled, time, timezone, last_sent_date, created_at, updated_at
       FROM quick_log_reminders WHERE user_id=?`,
  ).bind(userId).first<ReminderRow>();
  return { reminder: row ? toApiReminder(row) : null };
}

export async function upsertQuickLogReminder(env: Env, userId: string, body: unknown) {
  const data = asRecord(body);
  const time = normalizeTime(data.time);
  const timezone = normalizeTimezone(data.timezone);
  const enabled = data.enabled === undefined ? true : !!data.enabled;
  const ts = nowIso();

  const existing = await env.DB.prepare(`SELECT id FROM quick_log_reminders WHERE user_id=?`).bind(userId).first<{ id: string }>();
  if (existing) {
    await env.DB.prepare(
      `UPDATE quick_log_reminders SET enabled=?, time=?, timezone=?, updated_at=? WHERE user_id=?`,
    ).bind(enabled ? 1 : 0, time, timezone, ts, userId).run();
  } else {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO quick_log_reminders (id, user_id, enabled, time, timezone, last_sent_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).bind(id, userId, enabled ? 1 : 0, time, timezone, ts, ts).run();
  }
  return getQuickLogReminder(env, userId);
}

export async function deleteQuickLogReminder(env: Env, userId: string) {
  const result = await env.DB.prepare(`DELETE FROM quick_log_reminders WHERE user_id=?`).bind(userId).run();
  return { ok: result.meta.changes > 0 };
}

// ---- 메시지 생성 (Quick Log 저장 로직과 분리) ----

export interface ReminderUser {
  id: string;
}

export const ReminderService = {
  createMessage(_user: ReminderUser): string {
    return "안녕하세요. 오늘의 Quick Log를 남겨보세요. 오늘 하루는 어떠셨나요?";
  },
};

// ---- 발송 (교체 가능) ----

export interface ReminderSender {
  send(user: ReminderUser, message: string): Promise<void>;
}

export class ConsoleSender implements ReminderSender {
  async send(user: ReminderUser, message: string): Promise<void> {
    console.log(`[quick-log-reminder] user=${user.id} message=${message}`);
  }
}

// ---- 스케줄러 ----

function zonedNowParts(timezone: string): { date: string; time: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date());
    const map = new Map(parts.map((part) => [part.type, part.value]));
    return {
      date: `${map.get("year")}-${map.get("month")}-${map.get("day")}`,
      time: `${map.get("hour")}:${map.get("minute")}`,
    };
  } catch {
    const now = new Date();
    return { date: now.toISOString().slice(0, 10), time: now.toISOString().slice(11, 16) };
  }
}

const REMINDER_WINDOW_MINUTES = 5;

function minutesSinceMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// 자정 경계(예: 23:58 vs 00:01)도 원형 거리로 올바르게 처리한다.
function circularMinuteDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 1440;
  return Math.min(diff, 1440 - diff);
}

export async function processDueQuickLogReminders(
  env: Env,
  sender: ReminderSender = new ConsoleSender(),
): Promise<{ sent: number }> {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, enabled, time, timezone, last_sent_date
       FROM quick_log_reminders WHERE enabled=1`,
  ).all<ReminderRow>();

  let sent = 0;
  for (const row of rows.results || []) {
    const { date, time } = zonedNowParts(row.timezone || "Asia/Seoul");
    // 기존 5분 주기 cron을 그대로 쓰기 때문에, 정확한 분 일치 대신 현재 시각 ±5분 창 안에
    // 설정 시각이 들어오면 발송 대상으로 본다. 당일 중복 발송은 last_sent_date로 막는다.
    if (circularMinuteDiff(minutesSinceMidnight(time), minutesSinceMidnight(row.time)) > REMINDER_WINDOW_MINUTES) continue;
    if (row.last_sent_date === date) continue; // 같은 날 중복 발송 방지

    const user: ReminderUser = { id: row.user_id };
    const message = ReminderService.createMessage(user);
    await sender.send(user, message);
    await env.DB.prepare(
      `UPDATE quick_log_reminders SET last_sent_date=?, updated_at=? WHERE id=?`,
    ).bind(date, nowIso(), row.id).run();
    sent += 1;
  }
  return { sent };
}
