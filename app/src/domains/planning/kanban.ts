import type { Env } from "../../env";
import { parseActionItems as parseGithubActionItems, type ActionItem } from "../../git";
import { getUserToken, updateIssuePriorityMatrix, updateIssueState } from "../../git";
import { getMeeting } from "../meeting";

type KanbanStatus = "todo" | "doing" | "done";
type KanbanPriority = "low" | "medium" | "high";
type KanbanMatrixAxis = "none" | "low" | "high";

interface KanbanBoardRow {
  id: string;
  user_id: string;
  title: string;
  source_kind: string;
  source_id: string;
  created_at: string;
  updated_at: string;
  card_count?: number;
}

interface KanbanCardRow {
  id: string;
  board_id: string;
  user_id: string;
  title: string;
  description: string | null;
  assignee: string | null;
  due_date: string | null;
  priority: KanbanPriority;
  importance?: KanbanMatrixAxis;
  urgency?: KanbanMatrixAxis;
  status: KanbanStatus;
  source_kind: string;
  source_id: string | null;
  source_raw: string;
  position: number;
  created_at: string;
  updated_at: string;
  board_title?: string | null;
  github_repo?: string | null;
  github_issue_number?: number | null;
  github_issue_url?: string | null;
}

export class KanbanError extends Error {
  constructor(public status: number, message: string, public code = "kanban_error") {
    super(message);
    this.name = "KanbanError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanMultiline(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function cleanDate(value: unknown): string | null {
  const text = cleanText(value, 32);
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeStatus(value: unknown, fallback: KanbanStatus = "todo"): KanbanStatus {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "doing" || raw === "done" || raw === "todo" ? raw : fallback;
}

function normalizePriority(value: unknown, fallback: KanbanPriority = "medium"): KanbanPriority {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "high") return "high";
  if (raw === "low") return "low";
  if (raw === "medium") return "medium";
  return fallback;
}

function normalizeMatrixAxis(value: unknown, fallback: KanbanMatrixAxis = "low"): KanbanMatrixAxis {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "high") return "high";
  if (raw === "low") return "low";
  if (raw === "none") return "none";
  return fallback;
}

function boardForApi(row: KanbanBoardRow) {
  return {
    id: row.id,
    title: row.title,
    source_kind: row.source_kind,
    source_id: row.source_id,
    card_count: Number(row.card_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function cardForApi(row: KanbanCardRow) {
  return {
    id: row.id,
    board_id: row.board_id,
    board_title: row.board_title || null,
    title: row.title,
    description: row.description || "",
    assignee: row.assignee || "",
    due_date: row.due_date || "",
    priority: row.priority,
    importance: normalizeMatrixAxis(row.importance),
    urgency: normalizeMatrixAxis(row.urgency),
    status: row.status,
    source_kind: row.source_kind,
    source_id: row.source_id,
    source_raw: row.source_raw,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
    github_repo: row.github_repo || "",
    github_issue_number: row.github_issue_number || null,
    github_issue_url: row.github_issue_url || "",
  };
}

function explicitActionItems(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((item) => {
    const rec = asRecord(item);
    const title = cleanText(rec.title, 240);
    if (!title) return null;
    return {
      title,
      assignee: cleanText(rec.assignee, 80) || undefined,
      due: cleanDate(rec.due_date ?? rec.due) || undefined,
      priority: cleanText(rec.priority, 20) || undefined,
      raw: cleanMultiline(rec.raw ?? title, 1000),
    };
  }).filter(Boolean) as ActionItem[];
}

function parseMeetingActionItems(markdown: string): ActionItem[] {
  const lines = markdown.split(/\r?\n/);
  const items: ActionItem[] = [];
  let inSection = false;
  let sawActionHeading = false;
  const isActionHeading = (text: string) => /(할\s*일|액션|action|todo|tasks?)/i.test(text);

  function parseTaskLine(line: string): ActionItem | null {
    const m = line.match(/^\s*[-*]\s*(?:\[[ xX]?\]\s*)?(.+?)\s*$/);
    if (!m) return null;
    const raw = m[1].trim();
    if (!raw || /^<.*>$/.test(raw)) return null;
    const assignee = (raw.match(/@([\w.-]+)/) || [])[1];
    const due = (raw.match(/(?:~|due:?\s*)(\d{4}-\d{2}-\d{2})/i) || [])[1];
    const priority = (raw.match(/\[priority:\s*(High|Medium|Low)\]/i) || [])[1];
    const title = raw
      .replace(/@[\w.-]+/g, "")
      .replace(/(?:~|due:?\s*)\d{4}-\d{2}-\d{2}/ig, "")
      .replace(/\[priority:\s*(High|Medium|Low)\]/ig, "")
      .split(/\s+[—-]\s+/)[0]
      .replace(/\s+/g, " ")
      .trim();
    return title ? { title, assignee, due, priority, raw } : null;
  }

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      inSection = isActionHeading(heading[1]);
      if (inSection) sawActionHeading = true;
      else if (sawActionHeading) break;
      continue;
    }
    if (!inSection) continue;
    const item = parseTaskLine(line);
    if (item) items.push(item);
  }

  if (!items.length && !sawActionHeading) {
    for (const line of lines) {
      if (!/^\s*[-*]\s*\[[ xX]?\]\s*/.test(line)) continue;
      const item = parseTaskLine(line);
      if (item) items.push(item);
    }
  }

  return items.length ? items : parseGithubActionItems(markdown);
}

async function getOrCreateBoard(
  env: Env,
  userId: string,
  title: string,
  sourceKind: string,
  sourceId: string
): Promise<KanbanBoardRow> {
  const existing = await env.DB.prepare(
    `SELECT id, user_id, title, source_kind, source_id, created_at, updated_at
     FROM kanban_boards
     WHERE user_id=? AND source_kind=? AND source_id=?`
  ).bind(userId, sourceKind, sourceId).first<KanbanBoardRow>();
  const now = new Date().toISOString();
  if (existing) {
    await env.DB.prepare(
      "UPDATE kanban_boards SET title=?, updated_at=? WHERE id=? AND user_id=?"
    ).bind(title, now, existing.id, userId).run();
    return { ...existing, title, updated_at: now };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO kanban_boards (id, user_id, title, source_kind, source_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, title, sourceKind, sourceId, now, now).run();
  return { id, user_id: userId, title, source_kind: sourceKind, source_id: sourceId, created_at: now, updated_at: now };
}

async function nextPosition(env: Env, userId: string, boardId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM kanban_cards WHERE user_id=? AND board_id=?"
  ).bind(userId, boardId).first<{ next_position: number }>();
  return Number(row?.next_position || 0);
}

export async function listKanbanBoards(env: Env, userId: string, limitValue = 50) {
  const limit = Math.min(100, Math.max(1, Number(limitValue) || 50));
  const { results } = await env.DB.prepare(
    `SELECT b.id, b.user_id, b.title, b.source_kind, b.source_id, b.created_at, b.updated_at,
            COUNT(c.id) AS card_count
     FROM kanban_boards b
     LEFT JOIN kanban_cards c ON c.board_id=b.id AND c.user_id=b.user_id
     WHERE b.user_id=?
     GROUP BY b.id
     ORDER BY b.updated_at DESC
     LIMIT ?`
  ).bind(userId, limit).all<KanbanBoardRow>();
  return { boards: (results || []).map(boardForApi) };
}

export async function listKanbanCards(env: Env, userId: string, url: URL) {
  const boardId = cleanText(url.searchParams.get("boardId"), 80);
  const status = cleanText(url.searchParams.get("status"), 20);
  const clauses = ["c.user_id=?"];
  const binds: unknown[] = [userId];
  if (boardId) { clauses.push("c.board_id=?"); binds.push(boardId); }
  if (status) { clauses.push("c.status=?"); binds.push(normalizeStatus(status)); }
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.board_id, c.user_id, c.title, c.description, c.assignee, c.due_date,
            c.priority, c.importance, c.urgency, c.status, c.source_kind, c.source_id, c.source_raw, c.position,
            c.created_at, c.updated_at, b.title AS board_title,
            c.github_repo, c.github_issue_number, c.github_issue_url
     FROM kanban_cards c
     JOIN kanban_boards b ON b.id=c.board_id AND b.user_id=c.user_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY c.status, c.position, c.created_at
     LIMIT 300`
  ).bind(...binds).all<KanbanCardRow>();
  return { cards: (results || []).map(cardForApi) };
}

export async function createKanbanCardsFromMeeting(env: Env, userId: string, body: unknown) {
  const data = asRecord(body);
  const meetingId = cleanText(data.meeting_id ?? data.meetingId, 80);
  let markdown = cleanMultiline(data.markdown, 100_000);
  let sourceId = meetingId || crypto.randomUUID();
  let sourceKind = meetingId ? "meeting" : "meeting_markdown";
  let boardTitle = cleanText(data.board_title ?? data.boardTitle, 180);

  if (meetingId) {
    const meeting = await getMeeting(env, userId, meetingId);
    if (!meeting) throw new KanbanError(404, "Meeting was not found.", "meeting_not_found");
    markdown = markdown || meeting.markdown || "";
    boardTitle = boardTitle || `${meeting.title || "회의록"} 칸반`;
  }

  if (!markdown && !Array.isArray(data.action_items ?? data.actionItems)) {
    throw new KanbanError(400, "Meeting markdown or action_items is required.", "missing_source");
  }

  const items = explicitActionItems(data.action_items ?? data.actionItems);
  const actionItems = items.length ? items : parseMeetingActionItems(markdown);
  if (!actionItems.length) {
    throw new KanbanError(422, "No action items were found in the meeting note.", "no_action_items");
  }

  boardTitle = boardTitle || cleanText(data.meeting_title ?? data.meetingTitle, 180) || "회의록 칸반";
  const board = await getOrCreateBoard(env, userId, boardTitle, sourceKind, sourceId);
  let position = await nextPosition(env, userId, board.id);
  const now = new Date().toISOString();
  const created = [];
  const skipped = [];

  for (const item of actionItems.slice(0, 100)) {
    const title = cleanText(item.title, 240);
    const raw = cleanMultiline(item.raw || title, 1000);
    if (!title || !raw) continue;
    const id = crypto.randomUUID();
    const priority = normalizePriority(item.priority);
    const due = cleanDate(item.due);
    const assignee = cleanText(item.assignee, 80) || null;
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO kanban_cards (
         id, board_id, user_id, title, description, assignee, due_date, priority, status,
         source_kind, source_id, source_raw, position, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, board.id, userId, title, raw, assignee, due, priority, "todo",
      "meeting_action_item", sourceId, raw, position, now, now
    ).run();
    if (result.meta.changes) {
      created.push({ id, title, assignee, due_date: due, priority, status: "todo", source_raw: raw });
      position += 1;
    } else {
      skipped.push(raw);
    }
  }

  await env.DB.prepare(
    "UPDATE kanban_boards SET updated_at=? WHERE id=? AND user_id=?"
  ).bind(new Date().toISOString(), board.id, userId).run();

  return {
    ok: true,
    board: boardForApi(board),
    created,
    created_count: created.length,
    skipped_count: skipped.length,
  };
}

export async function updateKanbanCard(env: Env, userId: string, cardId: string, body: unknown) {
  const current = await env.DB.prepare(
    `SELECT id, board_id, user_id, title, description, assignee, due_date, priority, importance, urgency, status,
            source_kind, source_id, source_raw, position, created_at, updated_at,
            github_repo, github_issue_number, github_issue_url
     FROM kanban_cards
     WHERE id=? AND user_id=?`
  ).bind(cardId, userId).first<KanbanCardRow>();
  if (!current) throw new KanbanError(404, "Kanban card was not found.", "card_not_found");
  const data = asRecord(body);
  const title = cleanText(data.title ?? current.title, 240) || current.title;
  const description = cleanMultiline(data.description ?? current.description ?? "", 2000);
  const assignee = cleanText(data.assignee ?? current.assignee ?? "", 80) || null;
  const dueDate = data.due_date === null || data.due === null ? null : cleanDate(data.due_date ?? data.due ?? current.due_date);
  const priority = normalizePriority(data.priority, current.priority);
  const importance = normalizeMatrixAxis(data.importance, normalizeMatrixAxis(current.importance));
  const urgency = normalizeMatrixAxis(data.urgency, normalizeMatrixAxis(current.urgency));
  const status = normalizeStatus(data.status, current.status);
  const githubRepo = Object.prototype.hasOwnProperty.call(data, "github_repo")
    ? cleanText(data.github_repo, 180)
    : cleanText(current.github_repo, 180);
  const issueValue = Object.prototype.hasOwnProperty.call(data, "github_issue_number")
    ? Number(data.github_issue_number || 0)
    : Number(current.github_issue_number || 0);
  const githubIssueNumber = Number.isInteger(issueValue) && issueValue > 0 ? issueValue : null;
  if ((githubRepo && !/^[\w.-]+\/[\w.-]+$/.test(githubRepo)) || (!!githubRepo !== !!githubIssueNumber)) {
    throw new KanbanError(400, "GitHub 이슈는 owner/repo와 이슈 번호를 함께 입력하세요.", "invalid_github_issue_link");
  }
  let githubIssueUrl = githubRepo && githubIssueNumber ? `https://github.com/${githubRepo}/issues/${githubIssueNumber}` : null;
  let githubSync: { state: "open" | "closed"; url: string } | null = null;
  const githubLinkChanged = githubRepo !== (current.github_repo || "") || githubIssueNumber !== (current.github_issue_number || null);
  const matrixChanged = importance !== normalizeMatrixAxis(current.importance) || urgency !== normalizeMatrixAxis(current.urgency);
  const matrixUpdate = Object.prototype.hasOwnProperty.call(data, "importance") || Object.prototype.hasOwnProperty.call(data, "urgency");
  if (githubRepo && githubIssueNumber && (matrixChanged || matrixUpdate)) {
    const token = await getUserToken(env, userId);
    if (!token) throw new KanbanError(401, "GitHub 이슈 라벨을 변경하려면 GitHub 로그인이 필요합니다.", "github_login_required");
    const [owner, repo] = githubRepo.split("/");
    try {
      githubSync = await updateIssuePriorityMatrix(token, owner, repo, githubIssueNumber, importance, urgency, status === "done" ? "closed" : "open");
    } catch (err) {
      throw new KanbanError(502, err instanceof Error ? err.message : "GitHub 이슈 라벨 동기화에 실패했습니다.", "github_issue_sync_failed");
    }
    githubIssueUrl = githubSync.url || githubIssueUrl;
  } else if (githubRepo && githubIssueNumber && (
    (status !== current.status && (status === "done" || current.status === "done")) ||
    (githubLinkChanged && status === "done")
  )) {
    const token = await getUserToken(env, userId);
    if (!token) throw new KanbanError(401, "GitHub 이슈 상태를 변경하려면 GitHub 로그인이 필요합니다.", "github_login_required");
    const [owner, repo] = githubRepo.split("/");
    try {
      githubSync = await updateIssueState(token, owner, repo, githubIssueNumber, status === "done" ? "closed" : "open");
    } catch (err) {
      throw new KanbanError(502, err instanceof Error ? err.message : "GitHub 이슈 상태 변경에 실패했습니다.", "github_issue_sync_failed");
    }
    githubIssueUrl = githubSync.url || githubIssueUrl;
  }
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE kanban_cards
     SET title=?, description=?, assignee=?, due_date=?, priority=?, importance=?, urgency=?, status=?,
         github_repo=?, github_issue_number=?, github_issue_url=?, updated_at=?
     WHERE id=? AND user_id=?`
  ).bind(title, description || null, assignee, dueDate, priority, importance, urgency, status,
    githubRepo || null, githubIssueNumber, githubIssueUrl, now, cardId, userId).run();
  await env.DB.prepare(
    "UPDATE kanban_boards SET updated_at=? WHERE id=? AND user_id=?"
  ).bind(now, current.board_id, userId).run();
  const row = await env.DB.prepare(
    `SELECT c.id, c.board_id, c.user_id, c.title, c.description, c.assignee, c.due_date,
            c.priority, c.importance, c.urgency, c.status, c.source_kind, c.source_id, c.source_raw, c.position,
            c.created_at, c.updated_at, b.title AS board_title,
            c.github_repo, c.github_issue_number, c.github_issue_url
     FROM kanban_cards c
     JOIN kanban_boards b ON b.id=c.board_id AND b.user_id=c.user_id
     WHERE c.id=? AND c.user_id=?`
  ).bind(cardId, userId).first<KanbanCardRow>();
  return { ok: true, card: row ? cardForApi(row) : null, github_sync: githubSync };
}

export async function deleteKanbanCard(env: Env, userId: string, cardId: string) {
  const current = await env.DB.prepare(
    `SELECT id, board_id, github_repo, github_issue_number
     FROM kanban_cards
     WHERE id=? AND user_id=?`
  ).bind(cardId, userId).first<Pick<KanbanCardRow, "id" | "board_id" | "github_repo" | "github_issue_number">>();
  if (!current) throw new KanbanError(404, "Kanban card was not found.", "card_not_found");
  const result = await env.DB.prepare(
    "DELETE FROM kanban_cards WHERE id=? AND user_id=?"
  ).bind(cardId, userId).run();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE kanban_boards SET updated_at=? WHERE id=? AND user_id=?"
  ).bind(now, current.board_id, userId).run();
  return {
    ok: Number(result.meta.changes || 0) > 0,
    id: cardId,
    github_issue_closed: false,
    updated_at: now,
  };
}
