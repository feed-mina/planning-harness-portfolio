import type { Env } from "../../../env";

const MAX_BUTTONS = 8;
const MAX_LOG_NOTE_LENGTH = 240;
const MAX_LOCATION_LENGTH = 120;
const MAX_LOG_TEXT_INPUT = 120;
const MAX_BUTTON_LABEL_LENGTH = 60;
const MAX_ITEM_LABEL_LENGTH = 120;
const MAX_BUTTON_ITEMS = 12;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ID_LENGTH = 120;
const HISTORY_LIMIT = 200;
const ALLOWED_BUTTON_INPUT_MODES = new Set(["one_tap", "pick_item", "free_text"]);

const QUICK_NOTE = 240;

export class QuickLogError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "quick_log_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type QuickLogInputMode = "one_tap" | "pick_item" | "free_text";

interface QuickButtonRow {
  id: string;
  label: string;
  emoji: string | null;
  color: string | null;
  input_mode: QuickLogInputMode;
  category: string | null;
  goal_count: number | null;
  reminder_time: string | null;
  order_index: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface QuickButtonItemRow {
  id: string;
  button_id: string;
  label: string;
  order_index: number;
}

interface QuickLogRow {
  id: string;
  user_id: string;
  button_id: string | null;
  button_label: string;
  item_label: string | null;
  note: string | null;
  location: string | null;
  photo_key: string | null;
  logged_at: string;
  logged_date: string;
  timezone: string;
  deleted_at?: string | null;
}

interface OverviewButtonRow extends QuickButtonRow {
  items: { id: string; label: string; order_index: number }[];
  today_count: number;
  goal_count_value: number;
  streak: number;
  week: { date: string; count: number; hit: boolean }[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toStringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeText(value: unknown, maxLength: number, required = false): string {
  const raw = toStringValue(value).replace(/\s+/g, " ").trim();
  if (required && !raw) throw new QuickLogError(400, "value is required.", "invalid_value");
  if (!raw) return "";
  return raw.slice(0, maxLength);
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  const raw = toStringValue(value).replace(/\s+/g, " ").trim();
  if (!raw) return null;
  return raw.slice(0, maxLength);
}

function normalizeMode(raw: unknown): QuickLogInputMode {
  const value = toStringValue(raw) || "one_tap";
  if (!ALLOWED_BUTTON_INPUT_MODES.has(value)) {
    throw new QuickLogError(400, "input_mode must be one_tap, pick_item, or free_text.", "invalid_input_mode");
  }
  return value as QuickLogInputMode;
}

function normalizeId(raw: unknown): string {
  const value = toStringValue(raw);
  if (!value) throw new QuickLogError(400, "id is required.", "invalid_id");
  if (value.length > MAX_ID_LENGTH) throw new QuickLogError(400, "id is too long.", "invalid_id");
  return value;
}

function normalizeGoalCount(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    throw new QuickLogError(400, "goal_count must be an integer between 1 and 99.", "invalid_goal_count");
  }
  return value;
}

function normalizeReminderTime(raw: unknown): string | null {
  const value = toStringValue(raw);
  if (!value) return null;
  if (!/^[01]\d:[0-5]\d$/.test(value)) {
    throw new QuickLogError(400, "reminder_time must use HH:MM format.", "invalid_reminder_time");
  }
  return value;
}

function normalizeColor(raw: unknown): string | null {
  const value = toStringValue(raw).replace(/#/g, "");
  if (!value) return null;
  return `#${value.slice(0, 7)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTimeZone(raw: string | null): string {
  const value = toStringValue(raw).slice(0, 64);
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$|^UTC$/.test(value)) {
    throw new QuickLogError(400, "timezone must be a valid IANA timezone.", "invalid_timezone");
  }
  return value;
}

function timezoneDateParts(date: Date, timezone: string): { date: string } {
  try {
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    return { date: formatted.slice(0, 10) };
  } catch {
    return { date: date.toISOString().slice(0, 10) };
  }
}

function normalizeDate(raw: string | null): string {
  if (!raw) throw new QuickLogError(400, "date is required.", "invalid_date");
  const value = toStringValue(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new QuickLogError(400, "date must be YYYY-MM-DD", "invalid_date");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new QuickLogError(400, "date is invalid", "invalid_date");
  }
  return value;
}

function normalizeDateRange(rawFrom: string | null, rawTo: string | null): { from: string; to: string } {
  const today = timezoneDateParts(new Date(), "Asia/Seoul").date;
  const to = rawTo ? normalizeDate(rawTo) : today;
  const from = rawFrom ? normalizeDate(rawFrom) : shiftDate(to, -30);
  if (from > to) {
    throw new QuickLogError(400, "from date cannot be after to date.", "invalid_date_range");
  }
  return { from, to };
}

function shiftDate(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  next.setUTCDate(next.getUTCDate() + delta);
  return `${next.getUTCFullYear().toString().padStart(4, "0")}-${(next.getUTCMonth() + 1).toString().padStart(2, "0")}-${next.getUTCDate().toString().padStart(2, "0")}`;
}

function safePhotoKey(value: unknown): string | null {
  const normalized = normalizeOptionalText(value, MAX_LOG_TEXT_INPUT);
  if (!normalized) return null;
  return normalized;
}

async function getTimezone(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT timezone FROM user_time_settings WHERE user_id=?",
  ).bind(userId).first<{ timezone?: string }>();
  return normalizeTimeZone(row?.timezone || "Asia/Seoul");
}

function parseItems(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const values = raw
    .map((item) => normalizeOptionalText(item, MAX_ITEM_LABEL_LENGTH))
    .filter((item): item is string => !!item)
    .filter((item, index, all) => item && all.indexOf(item) === index);
  return values.slice(0, MAX_BUTTON_ITEMS);
}

function normalizeLogPayload(body: unknown) {
  const data = asRecord(body);
  const buttonIdRaw = normalizeOptionalText(data.button_id, 80);
  const buttonLabel = normalizeOptionalText(data.button_label, 80);
  const itemLabel = normalizeOptionalText(data.item_label, MAX_ITEM_LABEL_LENGTH);
  const note = normalizeOptionalText(data.note, QUICK_NOTE);
  const location = normalizeOptionalText(data.location, MAX_LOCATION_LENGTH);
  const photoKey = safePhotoKey(data.photo_key);
  const loggedAt = new Date();
  return {
    id: normalizeId(data.id),
    buttonId: buttonIdRaw,
    buttonLabel,
    itemLabel,
    note,
    location,
    photoKey,
    loggedAt,
    timezone: normalizeOptionalText(data.timezone, 64) || "Asia/Seoul",
  };
}

function normalizeButtonPayload(body: unknown) {
  const data = asRecord(body);
  return {
    label: normalizeText(data.label, MAX_BUTTON_LABEL_LENGTH, true),
    emoji: normalizeOptionalText(data.emoji, 16),
    color: normalizeColor(data.color),
    category: normalizeOptionalText(data.category, 40),
    inputMode: normalizeMode(data.input_mode),
    goalCount: normalizeGoalCount(data.goal_count),
    reminderTime: normalizeReminderTime(data.reminder_time),
    items: parseItems(data.items),
  };
}

function buildQuickLogOverviewPayload(
  targetDate: string,
  timezone: string,
  buttons: QuickButtonRow[],
  itemsByButton: Map<string, QuickButtonItemRow[]>,
  logs: QuickLogRow[],
) {
  const byButtonByDate = new Map<string, Map<string, number>>();
  const logsByDate = new Map<string, QuickLogRow[]>();
  const totalsByButton = new Map<string, number>();

  for (const row of logs) {
    const forDate = logsByDate.get(row.logged_date) || [];
    forDate.push(row);
    logsByDate.set(row.logged_date, forDate);

    if (!row.button_id) continue;
    const buttonMap = byButtonByDate.get(row.button_id) || new Map<string, number>();
    buttonMap.set(row.logged_date, (buttonMap.get(row.logged_date) || 0) + 1);
    byButtonByDate.set(row.button_id, buttonMap);
    totalsByButton.set(row.button_id, (totalsByButton.get(row.button_id) || 0) + 1);
  }

  const todayLogs = logsByDate.get(targetDate) || [];
  // 진행도는 "버튼 수" 단위로 통일한다 (#248).
  // 이전에는 target 이 목표 횟수의 합, achieved 가 달성 버튼 수라 분자·분모 단위가 달랐다.
  // 횟수 합이 필요한 화면은 goal_total 을 사용한다.
  const target = buttons.length;
  const goalTotal = buttons.reduce((acc, button) => acc + (button.goal_count || 1), 0);
  const achieved = buttons.reduce((acc, button) => {
    const buttonDayCount = byButtonByDate.get(button.id)?.get(targetDate) || 0;
    const need = button.goal_count || 1;
    return acc + (buttonDayCount >= need ? 1 : 0);
  }, 0);

  const overviewButtons: OverviewButtonRow[] = buttons.map((button) => {
    const goal = button.goal_count || 1;
    const byDate = byButtonByDate.get(button.id) || new Map<string, number>();
    const week: { date: string; count: number; hit: boolean }[] = [];
    for (let i = -6; i <= 0; i += 1) {
      const date = shiftDate(targetDate, i);
      const count = byDate.get(date) || 0;
      week.push({ date, count, hit: count >= goal });
    }
    let streak = 0;
    for (let i = 0; i < 60; i += 1) {
      const date = shiftDate(targetDate, -i);
      const count = byDate.get(date) || 0;
      if (count < goal) break;
      streak += 1;
    }
    return {
      ...button,
      items: itemsByButton.get(button.id) || [],
      today_count: byDate.get(targetDate) || 0,
      goal_count_value: goal,
      streak,
      week,
    };
  });

  return {
    date: targetDate,
    timezone,
    summary: {
      button_count: buttons.length,
      target,
      goal_total: goalTotal,
      achieved,
      log_count: todayLogs.length,
    },
    buttons: overviewButtons,
    logs: todayLogs,
  };
}

async function listButtonsWithItems(env: Env, userId: string) {
  const buttonsResult = await env.DB.prepare(
    `SELECT id, label, emoji, color, input_mode, category, goal_count, reminder_time, order_index, deleted_at, created_at, updated_at
       FROM user_quick_buttons
      WHERE user_id=? AND deleted_at IS NULL
      ORDER BY COALESCE(order_index, 0), created_at DESC`,
  ).bind(userId).all<QuickButtonRow>();
  const itemsResult = await env.DB.prepare(
    `SELECT id, button_id, label, order_index
       FROM user_quick_button_items
      WHERE user_id=?
      ORDER BY button_id, COALESCE(order_index, 0), created_at`,
  ).bind(userId).all<QuickButtonItemRow>();

  const itemsByButton = new Map<string, QuickButtonItemRow[]>();
  for (const item of itemsResult.results || []) {
    const list = itemsByButton.get(item.button_id) || [];
    list.push(item);
    itemsByButton.set(item.button_id, list);
  }
  return { buttons: buttonsResult.results || [], itemsByButton };
}

async function getButtonForUser(env: Env, userId: string, buttonId: string): Promise<QuickButtonRow | null> {
  return env.DB.prepare(
    `SELECT id, label, emoji, color, input_mode, category, goal_count, reminder_time, order_index, deleted_at, created_at, updated_at
       FROM user_quick_buttons
      WHERE id=? AND user_id=? AND deleted_at IS NULL`,
  ).bind(buttonId, userId).first<QuickButtonRow>();
}

async function getButtonItems(env: Env, buttonId: string) {
  const rows = await env.DB.prepare(
    `SELECT id, button_id, label, order_index
       FROM user_quick_button_items
      WHERE button_id=?
      ORDER BY order_index`,
  ).bind(buttonId).all<QuickButtonItemRow>();
  return rows.results || [];
}

function toPhotoName(name: string, userId: string): string {
  const safeName = toStringValue(name)
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    || "file";
  const safeUser = toStringValue(userId).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `quick-log/${safeUser}/${Date.now()}-${safeName}`;
}

export async function getQuickLogOverview(env: Env, userId: string, date: string | null = null) {
  const timezone = await getTimezone(env, userId);
  const targetDate = date ? normalizeDate(date) : timezoneDateParts(new Date(), timezone).date;
  const { buttons, itemsByButton } = await listButtonsWithItems(env, userId);
  const logsResult = await env.DB.prepare(
    `SELECT id, user_id, button_id, button_label, item_label, note, location, photo_key, logged_at, logged_date, timezone
       FROM user_quick_logs
      WHERE user_id=?
        AND deleted_at IS NULL
        AND logged_date BETWEEN ? AND ?
      ORDER BY logged_at DESC`,
  ).bind(userId, shiftDate(targetDate, -30), targetDate).all<QuickLogRow>();
  return buildQuickLogOverviewPayload(targetDate, timezone, buttons, itemsByButton, logsResult.results || []);
}

export async function getQuickLogButtons(env: Env, userId: string) {
  const { buttons, itemsByButton } = await listButtonsWithItems(env, userId);
  return {
    buttons: buttons.map((button) => ({
      ...button,
      items: itemsByButton.get(button.id) || [],
    })),
  };
}

export async function createQuickLogButton(env: Env, userId: string, body: unknown) {
  const payload = normalizeButtonPayload(body);
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM user_quick_buttons WHERE user_id=? AND deleted_at IS NULL`,
  ).bind(userId).first<{ count: number }>();
  if ((count?.count || 0) >= MAX_BUTTONS) throw new QuickLogError(400, "maximum number of buttons is 8.", "quick_button_limit");
  if (payload.inputMode === "pick_item" && !payload.items.length) {
    throw new QuickLogError(400, "items is required for pick_item mode.", "quick_log_items_required");
  }
  if (payload.inputMode !== "pick_item" && payload.items.length) {
    throw new QuickLogError(400, "items are only valid when input_mode is pick_item.", "quick_log_invalid_items");
  }

  const ts = nowIso();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user_quick_buttons
       (id, user_id, label, emoji, color, input_mode, category, goal_count, reminder_time, order_index, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).bind(id, userId, payload.label, payload.emoji, payload.color, payload.inputMode, payload.category, payload.goalCount, payload.reminderTime, 0, ts, ts).run();
  for (let index = 0; index < payload.items.length; index += 1) {
    const item = payload.items[index];
    const itemId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO user_quick_button_items (id, button_id, user_id, label, order_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(itemId, id, userId, item, index, ts).run();
  }

  const button = await getButtonForUser(env, userId, id);
  const buttonItems = await getButtonItems(env, id);
  return { button: { ...(button as QuickButtonRow), items: buttonItems } };
}

export async function updateQuickLogButton(env: Env, userId: string, id: string, body: unknown) {
  const current = await getButtonForUser(env, userId, id);
  if (!current) throw new QuickLogError(404, "button not found.", "quick_log_button_not_found");

  const payload = asRecord(body);
  const updates: string[] = [];
  const binds: unknown[] = [];
  if ("label" in payload) updates.push("label=?"), binds.push(normalizeText(payload.label, MAX_BUTTON_LABEL_LENGTH, true));
  if ("emoji" in payload) updates.push("emoji=?"), binds.push(normalizeOptionalText(payload.emoji, 16));
  if ("color" in payload) updates.push("color=?"), binds.push(normalizeColor(payload.color));
  if ("category" in payload) updates.push("category=?"), binds.push(normalizeOptionalText(payload.category, 40));
  if ("input_mode" in payload) updates.push("input_mode=?"), binds.push(normalizeMode(payload.input_mode));
  if ("goal_count" in payload) updates.push("goal_count=?"), binds.push(normalizeGoalCount(payload.goal_count));
  if ("reminder_time" in payload) updates.push("reminder_time=?"), binds.push(normalizeReminderTime(payload.reminder_time));

  const nextMode = "input_mode" in payload ? normalizeMode(payload.input_mode) : current.input_mode;
  if ("items" in payload) {
    const items = parseItems(payload.items);
    if (nextMode === "pick_item" && !items.length) throw new QuickLogError(400, "items is required for pick_item mode.", "quick_log_items_required");
    if (nextMode !== "pick_item" && items.length) {
      throw new QuickLogError(400, "items are only valid when input_mode is pick_item.", "quick_log_invalid_items");
    }
    await env.DB.prepare("DELETE FROM user_quick_button_items WHERE button_id=?").bind(id).run();
    if (nextMode === "pick_item") {
      for (let index = 0; index < items.length; index += 1) {
        const itemId = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO user_quick_button_items (id, button_id, user_id, label, order_index, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(itemId, id, userId, items[index], index, nowIso()).run();
      }
    }
  }

  if (!updates.length && !("items" in payload)) {
    const items = await getButtonItems(env, id);
    return { button: { ...current, items } };
  }

  updates.push("updated_at=?");
  binds.push(nowIso(), id, userId);
  await env.DB.prepare(
    `UPDATE user_quick_buttons
       SET ${updates.join(", ")}
     WHERE id=? AND user_id=? AND deleted_at IS NULL`,
  ).bind(...binds).run();

  const updated = await getButtonForUser(env, userId, id);
  const buttonItems = await getButtonItems(env, id);
  return { button: { ...(updated as QuickButtonRow), items: buttonItems } };
}

export async function deleteQuickLogButton(env: Env, userId: string, id: string) {
  const current = await getButtonForUser(env, userId, id);
  if (!current) throw new QuickLogError(404, "button not found.", "quick_log_button_not_found");
  const ts = nowIso();
  await env.DB.prepare(
    `UPDATE user_quick_buttons
       SET deleted_at=?, updated_at=?
     WHERE id=? AND user_id=? AND deleted_at IS NULL`,
  ).bind(ts, ts, id, userId).run();
  return { ok: true, id, deleted_at: ts };
}

export async function createQuickLogEntry(env: Env, userId: string, body: unknown) {
  const payload = normalizeLogPayload(body);
  const existing = await env.DB.prepare(
    `SELECT id, user_id, button_id, button_label, item_label, note, location, photo_key, logged_at, logged_date, timezone, deleted_at
       FROM user_quick_logs
      WHERE id=?`,
  ).bind(payload.id).first<QuickLogRow>();
  if (existing) {
    if (existing.user_id !== userId) {
      throw new QuickLogError(403, "log id belongs to another user.", "quick_log_not_owned");
    }
    // soft delete 된 기록은 되살리지 않는다 (#252).
    // 뒤늦게 도착한 재시도 POST 가 사용자가 방금 지운 기록을 부활시키면 안 되고,
    // 되돌리기는 명시적인 restore 엔드포인트가 담당한다.
    return { log: existing, idempotent: true, deleted: !!existing.deleted_at };
  }

  const timezone = await getTimezone(env, userId);
  const loggedDate = timezoneDateParts(payload.loggedAt, timezone).date;
  let buttonId = payload.buttonId;
  let buttonLabel = payload.buttonLabel;
  let finalMode: QuickLogInputMode = "free_text";

  if (buttonId) {
    const button = await getButtonForUser(env, userId, buttonId);
    if (!button) throw new QuickLogError(404, "button not found.", "quick_log_button_not_found");
    finalMode = button.input_mode;
    buttonLabel = buttonLabel || button.label;
    if (finalMode === "pick_item" && buttonLabel !== null) {
      const itemRows = await getButtonItems(env, buttonId);
      const allowedItems = new Set(itemRows.map((row) => row.label));
      if (!payload.itemLabel || !allowedItems.has(payload.itemLabel)) {
        throw new QuickLogError(400, "item_label is required and must be in button items.", "invalid_item_label");
      }
    } else if (finalMode !== "pick_item" && payload.itemLabel) {
      throw new QuickLogError(400, "item_label is only available for pick_item mode.", "invalid_item_label");
    }
  } else if (!buttonLabel) {
    throw new QuickLogError(400, "button_label is required when button_id is omitted.", "invalid_button");
  }

  await env.DB.prepare(
    `INSERT INTO user_quick_logs
      (id, user_id, button_id, button_label, item_label, note, location, photo_key, logged_at, logged_date, timezone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    payload.id,
    userId,
    buttonId,
    buttonLabel,
    payload.itemLabel,
    payload.note,
    payload.location,
    payload.photoKey,
    payload.loggedAt.toISOString(),
    loggedDate,
    timezone,
    nowIso(),
  ).run();

  return {
    log: {
      id: payload.id,
      user_id: userId,
      button_id: buttonId,
      button_label: buttonLabel,
      item_label: payload.itemLabel,
      note: payload.note,
      location: payload.location,
      photo_key: payload.photoKey,
      logged_at: payload.loggedAt.toISOString(),
      logged_date: loggedDate,
      timezone,
      input_mode: finalMode,
    },
    idempotent: false,
  };
}

// 삭제는 물리 삭제가 아니라 deleted_at 마킹이다 (#252).
// 물리 삭제 후 재생성으로 되돌리면 서버가 logged_at 을 "취소를 누른 시각"으로 다시 찍어
// 기록 시각이 조용히 바뀐다. 퀵 기록은 시각 자체가 데이터라 그런 복구는 쓸 수 없다.
export async function deleteQuickLogEntry(env: Env, userId: string, id: string) {
  const row = await env.DB.prepare(
    `SELECT user_id, logged_date, deleted_at FROM user_quick_logs WHERE id=?`,
  ).bind(id).first<{ user_id: string; logged_date: string; deleted_at: string | null }>();
  if (!row) throw new QuickLogError(404, "log not found.", "quick_log_entry_not_found");
  if (row.user_id !== userId) throw new QuickLogError(403, "not owner.", "quick_log_not_owner");
  const timezone = await getTimezone(env, userId);
  const today = timezoneDateParts(new Date(), timezone).date;
  if (row.logged_date !== today) throw new QuickLogError(403, "only today logs can be deleted.", "quick_log_delete_forbidden");
  // 이미 삭제된 기록에 대한 재요청은 성공으로 처리한다 (네트워크 재시도 대비).
  if (row.deleted_at) return { ok: true, id, idempotent: true };
  const result = await env.DB.prepare(
    `UPDATE user_quick_logs SET deleted_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL`,
  ).bind(new Date().toISOString(), id, userId).run();
  return { ok: result.meta.changes > 0, id, idempotent: false };
}

// 복구는 logged_at 을 건드리지 않는다 — 이 함수의 존재 이유다.
export async function restoreQuickLogEntry(env: Env, userId: string, id: string) {
  const row = await env.DB.prepare(
    `SELECT user_id, logged_date, deleted_at FROM user_quick_logs WHERE id=?`,
  ).bind(id).first<{ user_id: string; logged_date: string; deleted_at: string | null }>();
  if (!row) throw new QuickLogError(404, "log not found.", "quick_log_entry_not_found");
  if (row.user_id !== userId) throw new QuickLogError(404, "log not found.", "quick_log_entry_not_found");
  const timezone = await getTimezone(env, userId);
  const today = timezoneDateParts(new Date(), timezone).date;
  if (row.logged_date !== today) throw new QuickLogError(403, "only today logs can be restored.", "quick_log_restore_forbidden");
  if (!row.deleted_at) return { ok: true, id, idempotent: true };
  const result = await env.DB.prepare(
    `UPDATE user_quick_logs SET deleted_at=NULL WHERE id=? AND user_id=? AND deleted_at IS NOT NULL`,
  ).bind(id, userId).run();
  return { ok: result.meta.changes > 0, id, idempotent: false };
}

export async function getQuickLogHistory(env: Env, userId: string, from: string | null, to: string | null) {
  const normalized = normalizeDateRange(from, to);
  const rows = await env.DB.prepare(
    `SELECT id, user_id, button_id, button_label, item_label, note, location, photo_key, logged_at, logged_date, timezone
       FROM user_quick_logs
      WHERE user_id=?
        AND deleted_at IS NULL
        AND logged_date BETWEEN ? AND ?
      ORDER BY logged_at DESC
      LIMIT ${HISTORY_LIMIT}`,
  ).bind(userId, normalized.from, normalized.to).all<QuickLogRow>();
  return { from: normalized.from, to: normalized.to, logs: rows.results || [] };
}

export async function getQuickLogEntriesByDate(env: Env, userId: string, date: string | null) {
  const targetDate = date ? normalizeDate(date) : timezoneDateParts(new Date(), "Asia/Seoul").date;
  const timezone = await getTimezone(env, userId);
  const rows = await env.DB.prepare(
    `SELECT id, user_id, button_id, button_label, item_label, note, location, photo_key, logged_at, logged_date, timezone
       FROM user_quick_logs
      WHERE user_id=?
        AND deleted_at IS NULL
        AND logged_date=?
      ORDER BY logged_at DESC`,
  ).bind(userId, targetDate).all<QuickLogRow>();
  return { date: targetDate, timezone, logs: rows.results || [] };
}

function isImageFile(value: unknown): value is File {
  return !!value && typeof value === "object" && "type" in value && typeof (value as File).type === "string";
}

export async function uploadQuickLogPhoto(env: Env, userId: string, request: Request) {
  const form = await request.formData();
  const file = form.get("photo");
  if (!isImageFile(file)) throw new QuickLogError(400, "A photo file is required.", "photo_required");
  if (!file.type || !file.type.startsWith("image/")) throw new QuickLogError(400, "Only image/* file type is allowed.", "invalid_photo_type");
  const fileSize = typeof file.size === "number" ? file.size : 0;
  if (fileSize <= 0) throw new QuickLogError(400, "photo file is empty.", "invalid_photo");
  if (fileSize > MAX_FILE_BYTES) throw new QuickLogError(413, "Photo file must be <=5MB.", "photo_too_large");
  const key = toPhotoName(file.name || "quick-log-photo", userId);
  await env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return { photo_key: key };
}

export async function getQuickLogPhoto(env: Env, userId: string, key: string): Promise<Response> {
  const normalizedKey = toStringValue(key);
  if (!normalizedKey) throw new QuickLogError(400, "key is required.", "photo_key_required");
  const owned = await env.DB.prepare(
    `SELECT id FROM user_quick_logs WHERE user_id=? AND photo_key=? AND deleted_at IS NULL LIMIT 1`,
  ).bind(userId, normalizedKey).first<{ id: string }>();
  if (!owned) throw new QuickLogError(404, "photo not found.", "quick_log_photo_not_found");
  const object = await env.R2.get(normalizedKey);
  if (!object) throw new QuickLogError(404, "photo not found.", "quick_log_photo_not_found");
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "private, max-age=3600",
    },
  });
}
