import type { Env } from "../../env";
import { getUserToken, listProjectItems, updateIssuePriorityMatrix } from "../../git";

const MAX_SOURCES = 20;
const MAX_SESSIONS = 200;
const MAX_SESSION_LINKS = 50;
const MAX_SESSION_ENTRIES = 1000;
const MAX_NEXT_ACTIONS = 50;

interface ScheduleSourceRow {
  id: string;
  user_id: string;
  repo: string;
  project_id: string;
  project_title: string;
  enabled: number;
  position: number;
  created_at: string;
  updated_at: string;
}

interface ScheduleSessionRow {
  id: string;
  user_id: string;
  source_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "done" | "canceled";
  host_name: string | null;
  host_handle: string | null;
  host_role: string | null;
  repo: string | null;
  project_id: string | null;
  project_title: string | null;
  room_key: string | null;
  meeting_url: string | null;
  meeting_added_by: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ScheduleSessionLinkRow {
  id: string;
  session_id: string;
  kind: "issue" | "pr";
  repo: string;
  project_id: string | null;
  project_title: string | null;
  number: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
  created_at: string;
  updated_at: string;
}

interface ScheduleSessionReportRow {
  session_id: string;
  summary: string;
  next_actions_json: string;
  created_at: string;
  updated_at: string;
}

interface ScheduleSessionEntryRow {
  id: string;
  session_id: string;
  user_id: string;
  entered_at: string;
  left_at: string | null;
  created_at: string;
}

interface NormalizedSessionLink {
  kind: "issue" | "pr";
  repo: string;
  projectId: string | null;
  projectTitle: string | null;
  number: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
}

export class ScheduleSessionError extends Error {
  constructor(public status: number, message: string, public code = "schedule_session_error") {
    super(message);
    this.name = "ScheduleSessionError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanContent(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function cleanNullableText(value: unknown, max: number): string | null {
  const text = cleanText(value, max);
  return text || null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function cleanRepo(value: unknown): string {
  const repo = cleanText(value, 180);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new ScheduleSessionError(400, "GitHub repo must use owner/name format.", "invalid_repo");
  }
  return repo;
}

function cleanOptionalRepo(value: unknown): string | null {
  return cleanText(value, 180) ? cleanRepo(value) : null;
}

function parseDateTime(value: unknown, field: string): string {
  const text = cleanText(value, 80);
  if (!text || Number.isNaN(Date.parse(text))) {
    throw new ScheduleSessionError(400, `${field} must be an ISO date-time value.`, "invalid_session_time");
  }
  return new Date(text).toISOString();
}

function cleanSessionStatus(value: unknown): ScheduleSessionRow["status"] {
  const status = cleanText(value, 20);
  if (!["scheduled", "done", "canceled"].includes(status)) {
    throw new ScheduleSessionError(400, "status must be scheduled, done, or canceled.", "invalid_session_status");
  }
  return status as ScheduleSessionRow["status"];
}

function cleanMeetingUrl(value: unknown): string | null {
  const text = cleanText(value, 2000);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") throw new Error("invalid protocol");
    return url.toString();
  } catch {
    throw new ScheduleSessionError(400, "meeting_url must be an HTTPS URL.", "invalid_meeting_url");
  }
}

function normalizeSessionLinks(value: unknown): NormalizedSessionLink[] {
  if (!Array.isArray(value)) {
    throw new ScheduleSessionError(400, "links must be an array.", "invalid_session_links");
  }
  if (value.length > MAX_SESSION_LINKS) {
    throw new ScheduleSessionError(
      400,
      `Up to ${MAX_SESSION_LINKS} issue or pull request links can be attached.`,
      "too_many_session_links",
    );
  }
  const links = value.map((item) => {
    const row = asRecord(item);
    const kind = cleanText(row.kind, 10);
    if (kind !== "issue" && kind !== "pr") {
      throw new ScheduleSessionError(400, "link kind must be issue or pr.", "invalid_session_link_kind");
    }
    const state = cleanText(row.state, 10);
    if (!["open", "draft", "merged", "closed"].includes(state)) {
      throw new ScheduleSessionError(400, "link state is invalid.", "invalid_session_link_state");
    }
    const number = Number(row.number);
    if (!Number.isInteger(number) || number < 1) {
      throw new ScheduleSessionError(400, "link number must be a positive integer.", "invalid_session_link_number");
    }
    const title = cleanText(row.title, 300);
    if (!title) {
      throw new ScheduleSessionError(400, "link title is required.", "missing_session_link_title");
    }
    return {
      kind: kind as NormalizedSessionLink["kind"],
      repo: cleanRepo(row.repo),
      projectId: cleanNullableText(row.project_id ?? row.projectId, 120),
      projectTitle: cleanNullableText(row.project_title ?? row.projectTitle, 200),
      number,
      title,
      state: state as NormalizedSessionLink["state"],
    };
  });
  const unique = new Set(links.map((link) => `${link.repo}\n${link.number}`));
  if (unique.size !== links.length) {
    throw new ScheduleSessionError(400, "The same repo item cannot be linked twice.", "duplicate_session_link");
  }
  return links;
}

function normalizeNextActions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ScheduleSessionError(400, "next_actions must be an array.", "invalid_next_actions");
  }
  if (value.length > MAX_NEXT_ACTIONS) {
    throw new ScheduleSessionError(
      400,
      `Up to ${MAX_NEXT_ACTIONS} next actions can be saved.`,
      "too_many_next_actions",
    );
  }
  return value.map((item) => {
    const action = cleanText(item, 500);
    if (!action) {
      throw new ScheduleSessionError(400, "next_actions cannot contain blank items.", "invalid_next_action");
    }
    return action;
  });
}

function reportForApi(row: ScheduleSessionReportRow | undefined) {
  if (!row) return null;
  let nextActions: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.next_actions_json);
    if (Array.isArray(parsed)) {
      nextActions = parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    nextActions = [];
  }
  return {
    session_id: row.session_id,
    summary: row.summary,
    next_actions: nextActions,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function ownedScheduleSource(env: Env, userId: string, sourceId: string) {
  const row = await env.DB.prepare(
    `SELECT id, user_id, repo, project_id, project_title, enabled, position, created_at, updated_at
     FROM github_schedule_sources WHERE id=? AND user_id=?`,
  ).bind(sourceId, userId).first<ScheduleSourceRow>();
  if (!row) {
    throw new ScheduleSessionError(404, "Schedule source not found.", "schedule_source_not_found");
  }
  return row;
}

async function ownedScheduleSession(env: Env, userId: string, sessionId: string) {
  const row = await env.DB.prepare(
    `SELECT id, user_id, source_id, title, starts_at, ends_at, status,
            host_name, host_handle, host_role, repo, project_id, project_title,
            room_key, meeting_url, meeting_added_by, canceled_at, created_at, updated_at
     FROM schedule_sessions WHERE id=? AND user_id=?`,
  ).bind(sessionId, userId).first<ScheduleSessionRow>();
  if (!row) {
    throw new ScheduleSessionError(404, "Schedule session not found.", "schedule_session_not_found");
  }
  return row;
}

async function attachScheduleSessionDetails(env: Env, sessions: ScheduleSessionRow[]) {
  const linksBySession = new Map<string, ScheduleSessionLinkRow[]>();
  const reportsBySession = new Map<string, ScheduleSessionReportRow>();
  const entriesBySession = new Map<string, ScheduleSessionEntryRow[]>();
  if (sessions.length) {
    const placeholders = sessions.map(() => "?").join(",");
    const ids = sessions.map((session) => session.id);
    const [links, reports, entries] = await Promise.all([
      env.DB.prepare(
        `SELECT id, session_id, kind, repo, project_id, project_title, number, title, state, created_at, updated_at
         FROM schedule_session_links
         WHERE session_id IN (${placeholders})
         ORDER BY repo, number`,
      ).bind(...ids).all<ScheduleSessionLinkRow>(),
      env.DB.prepare(
        `SELECT session_id, summary, next_actions_json, created_at, updated_at
         FROM schedule_session_reports
         WHERE session_id IN (${placeholders})`,
      ).bind(...ids).all<ScheduleSessionReportRow>(),
      env.DB.prepare(
        `SELECT id, session_id, user_id, entered_at, left_at, created_at
         FROM schedule_session_entries
         WHERE session_id IN (${placeholders})
         ORDER BY entered_at
         LIMIT ?`,
      ).bind(...ids, MAX_SESSION_ENTRIES).all<ScheduleSessionEntryRow>(),
    ]);
    for (const link of links.results || []) {
      const group = linksBySession.get(link.session_id) || [];
      group.push(link);
      linksBySession.set(link.session_id, group);
    }
    for (const report of reports.results || []) {
      reportsBySession.set(report.session_id, report);
    }
    for (const entry of entries.results || []) {
      const group = entriesBySession.get(entry.session_id) || [];
      group.push(entry);
      entriesBySession.set(entry.session_id, group);
    }
  }
  return sessions.map((session) => ({
    ...session,
    links: linksBySession.get(session.id) || [],
    report: reportForApi(reportsBySession.get(session.id)),
    entries: entriesBySession.get(session.id) || [],
  }));
}

function sessionLinkStatements(
  env: Env,
  sessionId: string,
  links: NormalizedSessionLink[],
  now: string,
) {
  return links.map((link) => env.DB.prepare(
    `INSERT INTO schedule_session_links (
       id, session_id, kind, repo, project_id, project_title, number, title, state, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    sessionId,
    link.kind,
    link.repo,
    link.projectId,
    link.projectTitle,
    link.number,
    link.title,
    link.state,
    now,
    now,
  ));
}

function sourceForApi(row: ScheduleSourceRow) {
  return {
    id: row.id,
    repo: row.repo,
    project_id: row.project_id,
    project_title: row.project_title,
    enabled: !!row.enabled,
    position: Number(row.position || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listScheduleSources(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, repo, project_id, project_title, enabled, position, created_at, updated_at
     FROM github_schedule_sources
     WHERE user_id=?
     ORDER BY enabled DESC, position, updated_at DESC`
  ).bind(userId).all<ScheduleSourceRow>();
  return { sources: (results || []).map(sourceForApi) };
}

export async function replaceScheduleSources(env: Env, userId: string, body: unknown) {
  const data = asRecord(body);
  if (!Array.isArray(data.sources)) {
    throw new ScheduleSessionError(400, "sources must be an array.", "invalid_sources");
  }
  if (data.sources.length > MAX_SOURCES) {
    throw new ScheduleSessionError(400, `Up to ${MAX_SOURCES} GitHub sources can be connected.`, "too_many_sources");
  }
  const normalized = data.sources.map((source, position) => {
    const row = asRecord(source);
    const repo = cleanRepo(row.repo);
    const projectId = cleanText(row.project_id ?? row.projectId, 120);
    const projectTitle = cleanText(row.project_title ?? row.projectTitle, 200);
    if (!projectId || !projectTitle) {
      throw new ScheduleSessionError(400, "Each source requires a GitHub Project.", "missing_project");
    }
    return { repo, projectId, projectTitle, position };
  });
  const unique = new Set(normalized.map((source) => `${source.repo}\n${source.projectId}`));
  if (unique.size !== normalized.length) {
    throw new ScheduleSessionError(400, "The same repo and Project cannot be connected twice.", "duplicate_source");
  }

  const current = await env.DB.prepare(
    "SELECT id, repo, project_id FROM github_schedule_sources WHERE user_id=?"
  ).bind(userId).all<Pick<ScheduleSourceRow, "id" | "repo" | "project_id">>();
  const ids = new Map((current.results || []).map((row) => [`${row.repo}\n${row.project_id}`, row.id]));
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare("DELETE FROM github_schedule_sources WHERE user_id=?").bind(userId),
    ...normalized.map((source) => env.DB.prepare(
      `INSERT INTO github_schedule_sources (
         id, user_id, repo, project_id, project_title, enabled, position, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).bind(
      ids.get(`${source.repo}\n${source.projectId}`) || crypto.randomUUID(),
      userId,
      source.repo,
      source.projectId,
      source.projectTitle,
      source.position,
      now,
      now,
    )),
  ];
  await env.DB.batch(statements);
  return listScheduleSources(env, userId);
}

function parseRangeValue(value: string | null, fallback: string): string {
  const normalized = value || fallback;
  if (Number.isNaN(Date.parse(normalized))) {
    throw new ScheduleSessionError(400, "from/to must be ISO date-time values.", "invalid_range");
  }
  return new Date(normalized).toISOString();
}

export async function listScheduleSessions(env: Env, userId: string, url: URL) {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 31 * 86400000).toISOString();
  const defaultTo = new Date(now.getTime() + 93 * 86400000).toISOString();
  const from = parseRangeValue(url.searchParams.get("from"), defaultFrom);
  const to = parseRangeValue(url.searchParams.get("to"), defaultTo);
  if (from > to) {
    throw new ScheduleSessionError(400, "from must not be after to.", "invalid_range");
  }
  if (Date.parse(to) - Date.parse(from) > 366 * 86400000) {
    throw new ScheduleSessionError(400, "A session range cannot exceed 366 days.", "range_too_large");
  }
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, source_id, title, starts_at, ends_at, status,
            host_name, host_handle, host_role, repo, project_id, project_title,
            room_key, meeting_url, meeting_added_by, canceled_at, created_at, updated_at
     FROM schedule_sessions
     WHERE user_id=? AND starts_at<=? AND ends_at>=?
     ORDER BY starts_at
     LIMIT ?`
  ).bind(userId, to, from, MAX_SESSIONS).all<ScheduleSessionRow>();
  const sessions = results || [];
  return {
    from,
    to,
    server_now: now.toISOString(),
    sessions: await attachScheduleSessionDetails(env, sessions),
  };
}

export async function getScheduleSession(env: Env, userId: string, sessionId: string) {
  const session = await ownedScheduleSession(env, userId, sessionId);
  const [result] = await attachScheduleSessionDetails(env, [session]);
  return { session: result };
}

export async function createScheduleSession(env: Env, userId: string, body: unknown) {
  const data = asRecord(body);
  const title = cleanText(data.title, 300);
  if (!title) {
    throw new ScheduleSessionError(400, "title is required.", "missing_session_title");
  }
  const startsAt = parseDateTime(data.starts_at ?? data.startsAt, "starts_at");
  const endsAt = parseDateTime(data.ends_at ?? data.endsAt, "ends_at");
  if (endsAt <= startsAt) {
    throw new ScheduleSessionError(400, "ends_at must be after starts_at.", "invalid_session_time");
  }
  const status = hasOwn(data, "status") ? cleanSessionStatus(data.status) : "scheduled";
  const sourceId = cleanNullableText(data.source_id ?? data.sourceId, 120);
  const source = sourceId ? await ownedScheduleSource(env, userId, sourceId) : null;
  const meetingUrl = cleanMeetingUrl(data.meeting_url ?? data.meetingUrl);
  const links = hasOwn(data, "links") ? normalizeSessionLinks(data.links) : [];
  const now = new Date().toISOString();
  const sessionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO schedule_sessions (
         id, user_id, source_id, title, starts_at, ends_at, status,
         host_name, host_handle, host_role, repo, project_id, project_title,
         room_key, meeting_url, meeting_added_by, canceled_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).bind(
      sessionId,
      userId,
      sourceId,
      title,
      startsAt,
      endsAt,
      status,
      cleanNullableText(data.host_name ?? data.hostName, 200),
      cleanNullableText(data.host_handle ?? data.hostHandle, 200),
      cleanNullableText(data.host_role ?? data.hostRole, 200),
      source?.repo || cleanOptionalRepo(data.repo),
      source?.project_id || cleanNullableText(data.project_id ?? data.projectId, 120),
      source?.project_title || cleanNullableText(data.project_title ?? data.projectTitle, 200),
      meetingUrl,
      meetingUrl
        ? cleanNullableText(data.meeting_added_by ?? data.meetingAddedBy, 200) || userId
        : null,
      status === "canceled" ? now : null,
      now,
      now,
    ),
    ...sessionLinkStatements(env, sessionId, links, now),
  ]);
  return getScheduleSession(env, userId, sessionId);
}

export async function updateScheduleSession(
  env: Env,
  userId: string,
  sessionId: string,
  body: unknown,
) {
  const current = await ownedScheduleSession(env, userId, sessionId);
  const data = asRecord(body);
  const title = hasOwn(data, "title") ? cleanText(data.title, 300) : current.title;
  if (!title) {
    throw new ScheduleSessionError(400, "title is required.", "missing_session_title");
  }
  const startsAt = hasOwn(data, "starts_at") || hasOwn(data, "startsAt")
    ? parseDateTime(data.starts_at ?? data.startsAt, "starts_at")
    : current.starts_at;
  const endsAt = hasOwn(data, "ends_at") || hasOwn(data, "endsAt")
    ? parseDateTime(data.ends_at ?? data.endsAt, "ends_at")
    : current.ends_at;
  if (endsAt <= startsAt) {
    throw new ScheduleSessionError(400, "ends_at must be after starts_at.", "invalid_session_time");
  }
  const status = hasOwn(data, "status") ? cleanSessionStatus(data.status) : current.status;
  const sourceWasProvided = hasOwn(data, "source_id") || hasOwn(data, "sourceId");
  const sourceId = sourceWasProvided
    ? cleanNullableText(data.source_id ?? data.sourceId, 120)
    : current.source_id;
  const source = sourceId ? await ownedScheduleSource(env, userId, sourceId) : null;
  const meetingUrlWasProvided = hasOwn(data, "meeting_url") || hasOwn(data, "meetingUrl");
  const meetingUrl = meetingUrlWasProvided
    ? cleanMeetingUrl(data.meeting_url ?? data.meetingUrl)
    : current.meeting_url;
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `UPDATE schedule_sessions
       SET source_id=?, title=?, starts_at=?, ends_at=?, status=?,
           host_name=?, host_handle=?, host_role=?, repo=?, project_id=?, project_title=?,
           meeting_url=?, meeting_added_by=?, canceled_at=?, updated_at=?
       WHERE id=? AND user_id=?`,
    ).bind(
      sourceId,
      title,
      startsAt,
      endsAt,
      status,
      hasOwn(data, "host_name") || hasOwn(data, "hostName")
        ? cleanNullableText(data.host_name ?? data.hostName, 200)
        : current.host_name,
      hasOwn(data, "host_handle") || hasOwn(data, "hostHandle")
        ? cleanNullableText(data.host_handle ?? data.hostHandle, 200)
        : current.host_handle,
      hasOwn(data, "host_role") || hasOwn(data, "hostRole")
        ? cleanNullableText(data.host_role ?? data.hostRole, 200)
        : current.host_role,
      source?.repo || (hasOwn(data, "repo") ? cleanOptionalRepo(data.repo) : current.repo),
      source?.project_id || (
        hasOwn(data, "project_id") || hasOwn(data, "projectId")
          ? cleanNullableText(data.project_id ?? data.projectId, 120)
          : current.project_id
      ),
      source?.project_title || (
        hasOwn(data, "project_title") || hasOwn(data, "projectTitle")
          ? cleanNullableText(data.project_title ?? data.projectTitle, 200)
          : current.project_title
      ),
      meetingUrl,
      meetingUrl
        ? (
          hasOwn(data, "meeting_added_by") || hasOwn(data, "meetingAddedBy")
            ? cleanNullableText(data.meeting_added_by ?? data.meetingAddedBy, 200) || userId
            : current.meeting_added_by || userId
        )
        : null,
      status === "canceled"
        ? current.canceled_at || now
        : null,
      now,
      sessionId,
      userId,
    ),
  ];
  if (hasOwn(data, "links")) {
    const links = normalizeSessionLinks(data.links);
    statements.push(
      env.DB.prepare("DELETE FROM schedule_session_links WHERE session_id=?").bind(sessionId),
      ...sessionLinkStatements(env, sessionId, links, now),
    );
  }
  await env.DB.batch(statements);
  return getScheduleSession(env, userId, sessionId);
}

export async function upsertScheduleSessionReport(
  env: Env,
  userId: string,
  sessionId: string,
  body: unknown,
) {
  await ownedScheduleSession(env, userId, sessionId);
  const data = asRecord(body);
  const summary = cleanContent(data.summary, 20000);
  if (!summary) {
    throw new ScheduleSessionError(400, "summary is required.", "missing_session_report_summary");
  }
  const nextActions = normalizeNextActions(data.next_actions ?? data.nextActions ?? []);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO schedule_session_reports (
       session_id, summary, next_actions_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       summary=excluded.summary,
       next_actions_json=excluded.next_actions_json,
       updated_at=excluded.updated_at`,
  ).bind(sessionId, summary, JSON.stringify(nextActions), now, now).run();
  const report = await env.DB.prepare(
    `SELECT session_id, summary, next_actions_json, created_at, updated_at
     FROM schedule_session_reports WHERE session_id=?`,
  ).bind(sessionId).first<ScheduleSessionReportRow>();
  return { report: reportForApi(report || undefined) };
}

export async function enterScheduleSession(env: Env, userId: string, sessionId: string) {
  await ownedScheduleSession(env, userId, sessionId);
  const existing = await env.DB.prepare(
    `SELECT id, session_id, user_id, entered_at, left_at, created_at
     FROM schedule_session_entries
     WHERE session_id=? AND user_id=? AND left_at IS NULL
     ORDER BY entered_at DESC LIMIT 1`,
  ).bind(sessionId, userId).first<ScheduleSessionEntryRow>();
  if (existing) return { entry: existing, created: false };
  const now = new Date().toISOString();
  const entryId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO schedule_session_entries (
       id, session_id, user_id, entered_at, left_at, created_at
     ) VALUES (?, ?, ?, ?, NULL, ?)`,
  ).bind(entryId, sessionId, userId, now, now).run();
  const entry = await env.DB.prepare(
    `SELECT id, session_id, user_id, entered_at, left_at, created_at
     FROM schedule_session_entries WHERE id=?`,
  ).bind(entryId).first<ScheduleSessionEntryRow>();
  if (!entry) {
    throw new ScheduleSessionError(500, "Schedule entry could not be loaded.", "schedule_entry_load_failed");
  }
  return { entry, created: true };
}

export async function leaveScheduleSession(
  env: Env,
  userId: string,
  sessionId: string,
  entryId: string,
) {
  await ownedScheduleSession(env, userId, sessionId);
  const entry = await env.DB.prepare(
    `SELECT id, session_id, user_id, entered_at, left_at, created_at
     FROM schedule_session_entries
     WHERE id=? AND session_id=? AND user_id=?`,
  ).bind(entryId, sessionId, userId).first<ScheduleSessionEntryRow>();
  if (!entry) {
    throw new ScheduleSessionError(404, "Schedule entry not found.", "schedule_entry_not_found");
  }
  if (!entry.left_at) {
    const leftAt = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE schedule_session_entries SET left_at=? WHERE id=? AND left_at IS NULL",
    ).bind(leftAt, entryId).run();
    entry.left_at = leftAt;
  }
  return { entry };
}

export async function listScheduleGithubItems(env: Env, userId: string) {
  const token = await getUserToken(env, userId);
  if (!token) {
    throw new ScheduleSessionError(401, "GitHub login is required.", "github_login_required");
  }
  const { sources } = await listScheduleSources(env, userId);
  const enabled = sources.filter((source) => source.enabled);
  const byProject = new Map<string, typeof enabled>();
  for (const source of enabled) {
    const group = byProject.get(source.project_id) || [];
    group.push(source);
    byProject.set(source.project_id, group);
  }
  const itemGroups = await Promise.all([...byProject.entries()].map(async ([projectId, projectSources]) => {
    const project = await listProjectItems(token, projectId);
    const repos = new Set(projectSources.map((source) => source.repo));
    return project.items
      .filter((item) => repos.has(item.repo))
      .map((item) => ({ ...item, source_ids: projectSources.filter((source) => source.repo === item.repo).map((source) => source.id) }));
  }));
  return {
    sources: enabled,
    items: itemGroups.flat(),
    server_now: new Date().toISOString(),
  };
}

export async function updateScheduleGithubItem(env: Env, userId: string, body: unknown) {
  const data = asRecord(body);
  const kind = cleanText(data.kind, 10);
  if (kind !== "issue") {
    throw new ScheduleSessionError(400, "Only GitHub issues can be moved from the Kanban.", "github_item_read_only");
  }
  const repo = cleanRepo(data.repo);
  const number = Number(data.number || 0);
  if (!Number.isInteger(number) || number < 1) {
    throw new ScheduleSessionError(400, "A positive GitHub issue number is required.", "invalid_issue_number");
  }
  const importance = cleanText(data.importance, 10);
  const urgency = cleanText(data.urgency, 10);
  const state = cleanText(data.state, 10);
  if (!["none", "low", "high"].includes(importance) || !["none", "low", "high"].includes(urgency)) {
    throw new ScheduleSessionError(400, "importance and urgency must be none, low, or high.", "invalid_priority");
  }
  if (!["open", "closed"].includes(state)) {
    throw new ScheduleSessionError(400, "state must be open or closed.", "invalid_state");
  }
  const token = await getUserToken(env, userId);
  if (!token) {
    throw new ScheduleSessionError(401, "GitHub login is required.", "github_login_required");
  }
  const { sources } = await listScheduleSources(env, userId);
  const matchingSources = sources.filter((source) => source.enabled && source.repo === repo);
  if (!matchingSources.length) {
    throw new ScheduleSessionError(404, "The issue is not part of a connected schedule source.", "github_item_not_connected");
  }
  const projectIds = [...new Set(matchingSources.map((source) => source.project_id))];
  const projects = await Promise.all(projectIds.map((projectId) => listProjectItems(token, projectId)));
  const connectedIssue = projects.some((project) => project.items.some(
    (item) => item.kind === "issue" && item.repo === repo && item.number === number,
  ));
  if (!connectedIssue) {
    throw new ScheduleSessionError(404, "The issue is not in a connected GitHub Project.", "github_item_not_connected");
  }
  const [owner, repoName] = repo.split("/");
  try {
    return {
      item: await updateIssuePriorityMatrix(
        token,
        owner,
        repoName,
        number,
        importance as "none" | "low" | "high",
        urgency as "none" | "low" | "high",
        state as "open" | "closed",
      ),
    };
  } catch (err) {
    throw new ScheduleSessionError(
      502,
      err instanceof Error ? err.message : "GitHub issue synchronization failed.",
      "github_issue_sync_failed",
    );
  }
}
