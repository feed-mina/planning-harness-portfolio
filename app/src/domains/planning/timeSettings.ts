import type { Env } from "../../env";

type TimeBlockKind = "available" | "busy" | "focus" | "meeting";

interface TimeSettingsRow {
  user_id: string;
  timezone: string;
  workday_start: string;
  workday_end: string;
  weekdays_json: string;
  updated_at: string;
}

interface TimeBlockRow {
  id: string;
  user_id: string;
  date: string;
  start_time: string;
  end_time: string;
  kind: TimeBlockKind;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface TimeBlockRuleRow {
  id: string;
  user_id: string;
  weekdays_json: string;
  start_time: string;
  end_time: string;
  kind: TimeBlockKind;
  note: string | null;
  starts_on: string;
  ends_on: string | null;
  created_at: string;
  updated_at: string;
}

export class TimeSettingsError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "time_settings_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];
const VALID_KINDS = new Set<TimeBlockKind>(["available", "busy", "focus", "meeting"]);
const RULE_ID_PREFIX = "rule-";

function now(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseWeekdays(value: string | null | undefined): number[] {
  if (!value) return DEFAULT_WEEKDAYS;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return DEFAULT_WEEKDAYS;
    const days = parsed
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    const unique = Array.from(new Set(days)).sort((a, b) => a - b);
    return unique.length ? unique : DEFAULT_WEEKDAYS;
  } catch {
    return DEFAULT_WEEKDAYS;
  }
}

function normalizeWeekdays(value: unknown, fallback = DEFAULT_WEEKDAYS): number[] {
  const source = Array.isArray(value) ? value : (fallback.length ? fallback : DEFAULT_WEEKDAYS);
  const days = source
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const unique = Array.from(new Set(days)).sort((a, b) => a - b);
  if (!unique.length) throw new TimeSettingsError(400, "At least one weekday is required.", "invalid_weekdays");
  return unique;
}

function normalizeTimezone(value: unknown, fallback = "Asia/Seoul"): string {
  const timezone = String(value || fallback).trim().slice(0, 80);
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$|^UTC$/.test(timezone)) {
    throw new TimeSettingsError(400, "Timezone must be an IANA timezone like Asia/Seoul.", "invalid_timezone");
  }
  return timezone;
}

function normalizeTime(value: unknown, field: string, fallback?: string): string {
  const time = String(value ?? fallback ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new TimeSettingsError(400, `${field} must use HH:MM format.`, "invalid_time");
  }
  return time;
}

function normalizeDate(value: unknown): string {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TimeSettingsError(400, "Date must use YYYY-MM-DD format.", "invalid_date");
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TimeSettingsError(400, "Date is not valid.", "invalid_date");
  }
  return date;
}

function normalizeKind(value: unknown): TimeBlockKind {
  const kind = String(value || "available") as TimeBlockKind;
  if (!VALID_KINDS.has(kind)) throw new TimeSettingsError(400, "Unsupported time block kind.", "invalid_kind");
  return kind;
}

function normalizeNote(value: unknown): string | null {
  const note = String(value || "").trim().replace(/\s+/g, " ").slice(0, 240);
  return note || null;
}

function settingsForApi(row: TimeSettingsRow | null) {
  return {
    timezone: row?.timezone || "Asia/Seoul",
    workday_start: row?.workday_start || "09:00",
    workday_end: row?.workday_end || "18:00",
    weekdays: parseWeekdays(row?.weekdays_json),
    updated_at: row?.updated_at || null,
  };
}

function blockForApi(row: TimeBlockRow) {
  return {
    id: row.id,
    date: row.date,
    start_time: row.start_time,
    end_time: row.end_time,
    kind: row.kind,
    note: row.note,
    source: "block" as const,
    repeat_weekdays: [] as number[],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// 반복 규칙에서 만들어진 블록은 실제 행이 아니라서 `rule-` 접두사가 붙은 id 를 쓴다.
// 라우터의 `[\w-]+` 패턴에 걸리도록 콜론 대신 하이픈을 쓴다.
function ruleBlockId(ruleId: string): string {
  return `${RULE_ID_PREFIX}${ruleId}`;
}

function ruleIdFromBlockId(blockId: string): string | null {
  return blockId.startsWith(RULE_ID_PREFIX) ? blockId.slice(RULE_ID_PREFIX.length) : null;
}

function ruleBlockForApi(row: TimeBlockRuleRow, date: string) {
  return {
    id: ruleBlockId(row.id),
    date,
    start_time: row.start_time,
    end_time: row.end_time,
    kind: row.kind,
    note: row.note,
    source: "rule" as const,
    repeat_weekdays: parseWeekdays(row.weekdays_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function ruleForApi(row: TimeBlockRuleRow) {
  return {
    id: row.id,
    weekdays: parseWeekdays(row.weekdays_json),
    start_time: row.start_time,
    end_time: row.end_time,
    kind: row.kind,
    note: row.note,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// date 는 로컬 달력 날짜 문자열이라 UTC 로 파싱해야 요일이 흔들리지 않는다.
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function sortBlocks<T extends { start_time: string; created_at: string }>(blocks: T[]): T[] {
  return blocks.sort((a, b) => (
    a.start_time === b.start_time
      ? a.created_at.localeCompare(b.created_at)
      : a.start_time.localeCompare(b.start_time)
  ));
}

async function getSettingsRow(env: Env, userId: string): Promise<TimeSettingsRow | null> {
  return await env.DB.prepare(
    `SELECT user_id, timezone, workday_start, workday_end, weekdays_json, updated_at
     FROM user_time_settings WHERE user_id=?`
  ).bind(userId).first<TimeSettingsRow>();
}

export async function getTimeSettings(env: Env, userId: string) {
  return { settings: settingsForApi(await getSettingsRow(env, userId)) };
}

export async function saveTimeSettings(env: Env, userId: string, body: unknown) {
  const rec = asRecord(body);
  const current = settingsForApi(await getSettingsRow(env, userId));
  const timezone = normalizeTimezone(rec.timezone, current.timezone);
  const workdayStart = normalizeTime(rec.workday_start, "workday_start", current.workday_start);
  const workdayEnd = normalizeTime(rec.workday_end, "workday_end", current.workday_end);
  if (workdayStart >= workdayEnd) {
    throw new TimeSettingsError(400, "workday_start must be before workday_end.", "invalid_time_range");
  }
  const weekdays = normalizeWeekdays(rec.weekdays, current.weekdays);
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO user_time_settings (user_id, timezone, workday_start, workday_end, weekdays_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       timezone=excluded.timezone,
       workday_start=excluded.workday_start,
       workday_end=excluded.workday_end,
       weekdays_json=excluded.weekdays_json,
       updated_at=excluded.updated_at`
  ).bind(userId, timezone, workdayStart, workdayEnd, JSON.stringify(weekdays), ts).run();
  return { settings: { timezone, workday_start: workdayStart, workday_end: workdayEnd, weekdays, updated_at: ts } };
}

export async function listTimeBlocks(env: Env, userId: string, date: string) {
  const safeDate = normalizeDate(date);
  const range = await listTimeBlocksRange(env, userId, safeDate, safeDate);
  return {
    date: safeDate,
    blocks: range.days[0]?.blocks || [],
    server_now: range.server_now,
    timezone: range.timezone,
  };
}

function dateRange(from: string, to: string): string[] {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (fromMs > toMs) {
    throw new TimeSettingsError(400, "from must not be after to.", "invalid_date_range");
  }
  const count = Math.floor((toMs - fromMs) / 86400000) + 1;
  if (count > 42) {
    throw new TimeSettingsError(400, "A time block range cannot exceed 42 days.", "date_range_too_large");
  }
  return Array.from({ length: count }, (_, index) => (
    new Date(fromMs + index * 86400000).toISOString().slice(0, 10)
  ));
}

export async function listTimeBlocksRange(env: Env, userId: string, from: string, to: string) {
  const safeFrom = normalizeDate(from);
  const safeTo = normalizeDate(to);
  const dates = dateRange(safeFrom, safeTo);

  const [blockRows, ruleRows, skipRows, settingsRow] = await Promise.all([
    env.DB.prepare(
      `SELECT id, user_id, date, start_time, end_time, kind, note, created_at, updated_at
       FROM user_time_blocks
       WHERE user_id=? AND date BETWEEN ? AND ?`
    ).bind(userId, safeFrom, safeTo).all<TimeBlockRow>(),
    env.DB.prepare(
      `SELECT id, user_id, weekdays_json, start_time, end_time, kind, note, starts_on, ends_on, created_at, updated_at
       FROM user_time_block_rules
       WHERE user_id=? AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?)`
    ).bind(userId, safeTo, safeFrom).all<TimeBlockRuleRow>(),
    env.DB.prepare(
      `SELECT rule_id, date
       FROM user_time_block_rule_skips
       WHERE user_id=? AND date BETWEEN ? AND ?`
    ).bind(userId, safeFrom, safeTo).all<{ rule_id: string; date: string }>(),
    getSettingsRow(env, userId),
  ]);

  const skipped = new Set((skipRows.results || []).map((row) => `${row.rule_id}:${row.date}`));
  type ApiBlock = ReturnType<typeof blockForApi> | ReturnType<typeof ruleBlockForApi>;
  const blocksByDate = new Map(dates.map((date) => [date, [] as ApiBlock[]]));

  for (const row of blockRows.results || []) {
    blocksByDate.get(row.date)?.push(blockForApi(row));
  }
  for (const date of dates) {
    const weekday = weekdayOf(date);
    for (const row of ruleRows.results || []) {
      if (date < row.starts_on || (row.ends_on && date > row.ends_on)) continue;
      if (skipped.has(`${row.id}:${date}`)) continue;
      if (!parseWeekdays(row.weekdays_json).includes(weekday)) continue;
      blocksByDate.get(date)?.push(ruleBlockForApi(row, date));
    }
  }

  return {
    from: safeFrom,
    to: safeTo,
    days: dates.map((date) => ({ date, blocks: sortBlocks(blocksByDate.get(date) || []) })),
    server_now: now(),
    timezone: settingsForApi(settingsRow).timezone,
  };
}

export async function listTimeBlockRules(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, weekdays_json, start_time, end_time, kind, note, starts_on, ends_on, created_at, updated_at
     FROM user_time_block_rules WHERE user_id=? ORDER BY starts_on DESC, created_at DESC`
  ).bind(userId).all<TimeBlockRuleRow>();
  return { rules: (results || []).map(ruleForApi) };
}

export async function createTimeBlock(env: Env, userId: string, body: unknown) {
  const rec = asRecord(body);
  const date = normalizeDate(rec.date);
  const startTime = normalizeTime(rec.start_time, "start_time");
  const endTime = normalizeTime(rec.end_time, "end_time");
  if (startTime >= endTime) throw new TimeSettingsError(400, "start_time must be before end_time.", "invalid_time_range");
  const kind = normalizeKind(rec.kind);
  const note = normalizeNote(rec.note);
  const ts = now();

  // 반복 요일이 오면 하루짜리 블록 대신 규칙을 저장한다. 조회 시점에 요일로 확장된다.
  const repeatWeekdays = Array.isArray(rec.repeat_weekdays) && rec.repeat_weekdays.length
    ? normalizeWeekdays(rec.repeat_weekdays)
    : [];

  if (repeatWeekdays.length) {
    const ruleId = crypto.randomUUID();
    const endsOn = rec.repeat_ends_on == null || rec.repeat_ends_on === ""
      ? null
      : normalizeDate(rec.repeat_ends_on);
    if (endsOn && endsOn < date) {
      throw new TimeSettingsError(400, "repeat_ends_on must not be before the start date.", "invalid_date_range");
    }
    await env.DB.prepare(
      `INSERT INTO user_time_block_rules
         (id, user_id, weekdays_json, start_time, end_time, kind, note, starts_on, ends_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(ruleId, userId, JSON.stringify(repeatWeekdays), startTime, endTime, kind, note, date, endsOn, ts, ts).run();
    return {
      rule: {
        id: ruleId,
        weekdays: repeatWeekdays,
        start_time: startTime,
        end_time: endTime,
        kind,
        note,
        starts_on: date,
        ends_on: endsOn,
        created_at: ts,
        updated_at: ts,
      },
    };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user_time_blocks (id, user_id, date, start_time, end_time, kind, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, date, startTime, endTime, kind, note, ts, ts).run();
  return {
    block: { id, date, start_time: startTime, end_time: endTime, kind, note, created_at: ts, updated_at: ts },
  };
}

// 반복에서 나온 블록은 지울 실제 행이 없다. `date` 가 오면 그 날짜만 건너뛰고,
// 없으면 규칙 자체를 삭제한다.
export async function deleteTimeBlock(env: Env, userId: string, id: string, date?: string) {
  const ruleId = ruleIdFromBlockId(id);
  if (!ruleId) {
    const result = await env.DB.prepare(
      "DELETE FROM user_time_blocks WHERE id=? AND user_id=?"
    ).bind(id, userId).run();
    return { ok: result.meta.changes > 0, scope: "block" as const };
  }

  const rule = await env.DB.prepare(
    "SELECT id FROM user_time_block_rules WHERE id=? AND user_id=?"
  ).bind(ruleId, userId).first<{ id: string }>();
  if (!rule) return { ok: false, scope: "rule" as const };

  if (date) {
    const safeDate = normalizeDate(date);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_time_block_rule_skips (rule_id, user_id, date, created_at)
       VALUES (?, ?, ?, ?)`
    ).bind(ruleId, userId, safeDate, now()).run();
    return { ok: true, scope: "occurrence" as const, date: safeDate };
  }

  await env.DB.prepare("DELETE FROM user_time_block_rule_skips WHERE rule_id=? AND user_id=?")
    .bind(ruleId, userId).run();
  const result = await env.DB.prepare(
    "DELETE FROM user_time_block_rules WHERE id=? AND user_id=?"
  ).bind(ruleId, userId).run();
  return { ok: result.meta.changes > 0, scope: "rule" as const };
}
