import type { Env } from "./env";

type HistoryKind = "meeting" | "analysis";

interface MeetingRow {
  id: string;
  title: string | null;
  date: string | null;
  created_at: string;
}

interface AnalysisRow {
  id: string;
  title: string | null;
  date: string | null;
  subject: string | null;
  meeting_r2_key: string | null;
  created_at: string;
  updated_at: string;
  file_count: number;
  file_names: string | null;
  output_kinds: string | null;
  latest_output_at: string | null;
}

interface HistoryMarkRow {
  item_type: HistoryKind;
  item_id: string;
  tags: string | null;
  favorite: number;
  deleted_at: string | null;
  updated_at: string;
}

interface MeetingDetailRow extends MeetingRow {
  r2_key: string | null;
  dagshub_run_url: string | null;
}

interface AnalysisDetailRow {
  id: string;
  title: string | null;
  date: string | null;
  subject: string | null;
  meeting_r2_key: string | null;
  etc_url: string | null;
  etc_note: string | null;
  created_at: string;
  updated_at: string;
}

interface AnalysisFileDetailRow {
  id: string;
  name: string;
  type: string | null;
  size: number;
  text_excerpt: string | null;
  created_at: string;
}

interface AnalysisOutputDetailRow {
  kind: string;
  content_json: string;
  provider: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  dagshub_run_url: string | null;
  created_at: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizeTags(parsed);
  } catch {
    return [];
  }
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().replace(/^#+/, "").replace(/\s+/g, " ").slice(0, 24);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

function uniqueTags(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const tag of group) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

function splitPacked(value: string | null): string[] {
  if (!value) return [];
  return value.split("|||").map((name) => name.trim()).filter(Boolean).slice(0, 50);
}

function autoTags(
  parts: Array<string | null | undefined>,
  base: string[],
  options: { fileNames?: string[]; outputKinds?: string[]; hasMeeting?: boolean } = {}
): string[] {
  const text = parts.filter(Boolean).join(" ");
  const tags = [...base];
  const rules: Array<[RegExp, string]> = [
    [/원가|예산|비용|단가|회계|재무/i, "원가"],
    [/수문|수자원|유량|강우|조사/i, "수문"],
    [/정부|공공|용역|과업|사업/i, "정부사업"],
    [/법령|규정|고시|지침|근거/i, "근거검증"],
    [/보고서|리포트|산출물/i, "보고서"],
    [/회의|미팅|논의|킥오프|점검/i, "회의록"],
    [/검증|validation|validate|확인/i, "검증"],
    [/계획|플랜|todo|action|실행/i, "플랜"],
    [/데이터|통계|지표|dashboard|보드/i, "데이터분석"],
  ];
  for (const [pattern, tag] of rules) {
    if (pattern.test(text)) tags.push(tag);
  }
  const fileNames = options.fileNames || [];
  if (fileNames.length) tags.push("파일첨부");
  if (fileNames.some((name) => /\.(xlsx|xls)$/i.test(name))) tags.push("엑셀");
  if (fileNames.some((name) => /\.csv$/i.test(name))) tags.push("CSV");
  if (fileNames.some((name) => /\.(pdf|docx?|hwp|hwpx)$/i.test(name))) tags.push("문서");
  if (fileNames.some((name) => /\.(md|txt|json|sql)$/i.test(name))) tags.push("텍스트자료");
  if (fileNames.some((name) => /예산|원가|단가|회계|비용/i.test(name))) tags.push("비용자료");
  if (fileNames.some((name) => /법령|고시|지침|품셈|기준|근거/i.test(name))) tags.push("근거자료");

  const outputKinds = options.outputKinds || [];
  if (outputKinds.includes("summaries")) tags.push("AI요약");
  if (outputKinds.includes("ideas")) tags.push("아이디어");
  if (outputKinds.includes("plans")) tags.push("분석플랜");
  if (options.hasMeeting) tags.push("회의록");
  return uniqueTags(tags);
}

function markMap(rows: HistoryMarkRow[]): Map<string, HistoryMarkRow> {
  return new Map(rows.map((row) => [`${row.item_type}:${row.item_id}`, row]));
}

function splitFileNames(value: string | null): string[] {
  return splitPacked(value).slice(0, 20);
}

function safeParseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function looksMojibake(value: string): boolean {
  const sample = value.slice(0, 2000);
  if (sample.length < 4) return false;
  const replacement = sample.match(/[�占]/g)?.length || 0;
  const latin1 = sample.match(/[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/g)?.length || 0;
  const cp949Like = sample.match(/[遺洹寃곗젙댁슜뚯씪씠덉뒪좊━꾩꽍ㅽ뙣몄쟻쒕떎쓬룄섏꽭]/g)?.length || 0;
  if (replacement >= 2 || latin1 >= 3) return true;
  return cp949Like >= 6 && cp949Like / sample.length > 0.08;
}

function repairLatin1Mojibake(value: string): string {
  if (!/[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/.test(value)) return value;
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 255) return value;
    bytes.push(code);
  }
  const decoded = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(new Uint8Array(bytes));
  return looksMojibake(decoded) ? value : decoded;
}

function publicTextExcerpt(value: string | null): string | null {
  if (!value) return null;
  const repaired = repairLatin1Mojibake(value);
  if (looksMojibake(repaired)) return null;
  return repaired;
}

async function itemExists(env: Env, userId: string, kind: HistoryKind, id: string): Promise<boolean> {
  const table = kind === "meeting" ? "meetings" : "analysis_sessions";
  const row = await env.DB.prepare(`SELECT id FROM ${table} WHERE id=? AND user_id=?`).bind(id, userId).first<{ id: string }>();
  return !!row;
}

async function activeItemExists(env: Env, userId: string, kind: HistoryKind, id: string): Promise<boolean> {
  if (!await itemExists(env, userId, kind, id)) return false;
  const row = await env.DB.prepare(
    `SELECT deleted_at
     FROM history_marks
     WHERE user_id=? AND item_type=? AND item_id=?`
  ).bind(userId, kind, id).first<{ deleted_at: string | null }>();
  return !row?.deleted_at;
}

export async function listHistory(env: Env, userId: string, limitValue?: number) {
  const limit = Math.min(200, Math.max(1, Number(limitValue) || 100));
  const [meetingRows, analysisRows, markRows] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, date, created_at
       FROM meetings
       WHERE user_id=?
         AND NOT EXISTS (
           SELECT 1 FROM history_marks hm
           WHERE hm.user_id=meetings.user_id
             AND hm.item_type='meeting'
             AND hm.item_id=meetings.id
             AND hm.deleted_at IS NOT NULL
         )
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(userId, limit).all<MeetingRow>(),
    env.DB.prepare(
      `SELECT
         s.id, s.title, s.date, s.subject, s.meeting_r2_key, s.created_at, s.updated_at,
         COALESCE(f.file_count, 0) AS file_count,
         f.file_names AS file_names,
         o.latest_output_at AS latest_output_at
       FROM analysis_sessions s
       LEFT JOIN (
         SELECT session_id, user_id, COUNT(*) AS file_count, GROUP_CONCAT(name, '|||') AS file_names
         FROM analysis_files
         GROUP BY session_id, user_id
       ) f ON f.session_id=s.id AND f.user_id=s.user_id
       LEFT JOIN (
         SELECT session_id, user_id, MAX(created_at) AS latest_output_at, GROUP_CONCAT(kind, '|||') AS output_kinds
         FROM analysis_outputs
         GROUP BY session_id, user_id
       ) o ON o.session_id=s.id AND o.user_id=s.user_id
       WHERE s.user_id=?
         AND NOT EXISTS (
           SELECT 1 FROM history_marks hm
           WHERE hm.user_id=s.user_id
             AND hm.item_type='analysis'
             AND hm.item_id=s.id
             AND hm.deleted_at IS NOT NULL
         )
       ORDER BY s.updated_at DESC
       LIMIT ?`
    ).bind(userId, limit).all<AnalysisRow>(),
    env.DB.prepare(
      `SELECT item_type, item_id, tags, favorite, deleted_at, updated_at
       FROM history_marks
       WHERE user_id=?`
    ).bind(userId).all<HistoryMarkRow>(),
  ]);

  const marks = markMap(markRows.results || []);
  const items = [
    ...(meetingRows.results || []).map((row) => {
      const mark = marks.get(`meeting:${row.id}`);
      const customTags = parseTags(mark?.tags);
      const generatedTags = autoTags([row.title], ["회의록"], { hasMeeting: true });
      return {
        kind: "meeting" as const,
        id: row.id,
        source: "회의록 만들기",
        title: row.title || "회의록",
        date: row.date,
        project: row.title || "회의록",
        subject: row.title || null,
        created_at: row.created_at,
        updated_at: row.created_at,
        latest_activity_at: row.created_at,
        file_count: 0,
        file_names: [],
        meeting_available: true,
        latest_output_at: null,
        favorite: !!mark?.favorite,
        custom_tags: customTags,
        auto_tags: generatedTags,
        tags: uniqueTags(customTags, generatedTags),
      };
    }),
    ...(analysisRows.results || []).map((row) => {
      const mark = marks.get(`analysis:${row.id}`);
      const customTags = parseTags(mark?.tags);
      const fileNames = splitFileNames(row.file_names);
      const outputKinds = splitPacked(row.output_kinds);
      const generatedTags = autoTags([row.title, row.subject, ...fileNames], ["분석설계"], {
        fileNames,
        outputKinds,
        hasMeeting: !!row.meeting_r2_key,
      });
      return {
        kind: "analysis" as const,
        id: row.id,
        source: "분석설계",
        title: row.title || row.subject || "분석설계 세션",
        date: row.date,
        project: row.title || row.subject || "분석 프로젝트",
        subject: row.subject,
        created_at: row.created_at,
        updated_at: row.updated_at,
        latest_activity_at: row.latest_output_at || row.updated_at || row.created_at,
        file_count: Number(row.file_count || 0),
        file_names: fileNames,
        output_kinds: uniqueTags(outputKinds),
        meeting_available: !!row.meeting_r2_key,
        latest_output_at: row.latest_output_at,
        favorite: !!mark?.favorite,
        custom_tags: customTags,
        auto_tags: generatedTags,
        tags: uniqueTags(customTags, generatedTags),
      };
    }),
  ].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return String(b.latest_activity_at || "").localeCompare(String(a.latest_activity_at || ""));
  }).slice(0, limit);

  const counts = items.reduce((acc, item) => {
    acc.total += 1;
    if (item.kind === "meeting") acc.meetings += 1;
    if (item.kind === "analysis") acc.analysis += 1;
    if (item.favorite) acc.favorites += 1;
    return acc;
  }, { total: 0, meetings: 0, analysis: 0, favorites: 0 });

  const tags = uniqueTags(...items.map((item) => item.tags)).sort((a, b) => a.localeCompare(b, "ko"));
  return { items, counts, tags, server_now: new Date().toISOString() };
}

async function readR2Text(env: Env, key: string | null, max = 100000): Promise<string> {
  if (!key) return "";
  const obj = await env.R2.get(key);
  if (!obj) return "";
  return (await obj.text()).slice(0, max);
}

async function historyMark(env: Env, userId: string, kind: HistoryKind, id: string) {
  const row = await env.DB.prepare(
    `SELECT item_type, item_id, tags, favorite, deleted_at, updated_at
     FROM history_marks
     WHERE user_id=? AND item_type=? AND item_id=?`
  ).bind(userId, kind, id).first<HistoryMarkRow>();
  return {
    favorite: !!row?.favorite,
    custom_tags: parseTags(row?.tags),
  };
}

function latestOutputs(rows: AnalysisOutputDetailRow[]) {
  const outputs: Record<string, unknown> = {};
  const meta: Record<string, unknown> = {};
  for (const row of rows) {
    if (outputs[row.kind]) continue;
    outputs[row.kind] = safeParseJson(row.content_json) || {};
    meta[row.kind] = {
      provider: row.provider,
      model: row.model,
      usage: { input_tokens: row.input_tokens, output_tokens: row.output_tokens },
      dagshub_run_url: row.dagshub_run_url,
      created_at: row.created_at,
    };
  }
  return { outputs, output_meta: meta, output_kinds: Object.keys(outputs) };
}

export async function getHistoryDetail(env: Env, userId: string, kind: string, id: string) {
  if (kind !== "meeting" && kind !== "analysis") {
    return { error: "지원하지 않는 히스토리 유형입니다.", status: 400 };
  }
  if (!await activeItemExists(env, userId, kind, id)) {
    return { error: "히스토리를 찾을 수 없습니다.", status: 404 };
  }

  if (kind === "meeting") {
    const row = await env.DB.prepare(
      `SELECT id, title, date, r2_key, dagshub_run_url, created_at
       FROM meetings WHERE id=? AND user_id=?`
    ).bind(id, userId).first<MeetingDetailRow>();
    if (!row) return { error: "회의록을 찾을 수 없습니다.", status: 404 };
    const mark = await historyMark(env, userId, "meeting", id);
    const markdown = await readR2Text(env, row.r2_key);
    const auto_tags = autoTags([row.title, markdown.slice(0, 800)], ["회의록"], { hasMeeting: true });
    return {
      kind: "meeting" as const,
      source: "회의록 만들기",
      item: {
        id: row.id,
        title: row.title || "회의록",
        date: row.date,
        created_at: row.created_at,
        favorite: mark.favorite,
        custom_tags: mark.custom_tags,
        auto_tags,
        tags: uniqueTags(mark.custom_tags, auto_tags),
      },
      markdown,
      dagshub_run_url: row.dagshub_run_url,
    };
  }

  const session = await env.DB.prepare(
    `SELECT id, title, date, subject, meeting_r2_key, etc_url, etc_note, created_at, updated_at
     FROM analysis_sessions WHERE id=? AND user_id=?`
  ).bind(id, userId).first<AnalysisDetailRow>();
  if (!session) return { error: "분석설계 세션을 찾을 수 없습니다.", status: 404 };

  const [filesRes, outputsRes, meetingMarkdown, mark] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, type, size, text_excerpt, created_at
       FROM analysis_files WHERE session_id=? AND user_id=? ORDER BY created_at`
    ).bind(id, userId).all<AnalysisFileDetailRow>(),
    env.DB.prepare(
      `SELECT kind, content_json, provider, model, input_tokens, output_tokens, dagshub_run_url, created_at
       FROM analysis_outputs
       WHERE session_id=? AND user_id=?
       ORDER BY created_at DESC
       LIMIT 50`
    ).bind(id, userId).all<AnalysisOutputDetailRow>(),
    readR2Text(env, session.meeting_r2_key, 100000),
    historyMark(env, userId, "analysis", id),
  ]);
  const files = filesRes.results || [];
  const { outputs, output_meta, output_kinds } = latestOutputs(outputsRes.results || []);
  const fileNames = files.map((file) => file.name);
  const auto_tags = autoTags(
    [session.title, session.subject, session.etc_note, ...fileNames],
    ["분석설계"],
    { fileNames, outputKinds: output_kinds, hasMeeting: !!session.meeting_r2_key }
  );
  return {
    kind: "analysis" as const,
    source: "분석설계",
    item: {
      id: session.id,
      title: session.title || session.subject || "분석설계 세션",
      date: session.date,
      subject: session.subject,
      project: session.title || session.subject || "분석 프로젝트",
      etc_url: session.etc_url,
      etc_note: session.etc_note,
      created_at: session.created_at,
      updated_at: session.updated_at,
      file_count: files.length,
      file_names: fileNames,
      meeting_available: !!session.meeting_r2_key,
      favorite: mark.favorite,
      custom_tags: mark.custom_tags,
      auto_tags,
      tags: uniqueTags(mark.custom_tags, auto_tags),
      output_kinds,
    },
    meeting_markdown: meetingMarkdown,
    files: files.map((file) => ({
      id: file.id,
      name: file.name,
      type: file.type,
      size: file.size,
      text_available: !!publicTextExcerpt(file.text_excerpt),
      text_excerpt: publicTextExcerpt(file.text_excerpt),
      created_at: file.created_at,
    })),
    outputs,
    output_meta,
  };
}

export async function updateHistoryMark(env: Env, userId: string, kind: string, id: string, body: unknown) {
  if (kind !== "meeting" && kind !== "analysis") {
    return { error: "지원하지 않는 히스토리 유형입니다." };
  }
  if (!await activeItemExists(env, userId, kind, id)) {
    return { error: "히스토리를 찾을 수 없습니다.", status: 404 };
  }

  const current = await env.DB.prepare(
    `SELECT item_type, item_id, tags, favorite, deleted_at, updated_at
     FROM history_marks
     WHERE user_id=? AND item_type=? AND item_id=?`
  ).bind(userId, kind, id).first<HistoryMarkRow>();

  const rec = asRecord(body) || {};
  const tags = "tags" in rec ? normalizeTags(rec.tags) : parseTags(current?.tags);
  const favorite = typeof rec.favorite === "boolean" ? rec.favorite : !!current?.favorite;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO history_marks (user_id, item_type, item_id, tags, favorite, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET
       tags=excluded.tags,
       favorite=excluded.favorite,
       updated_at=excluded.updated_at`
  ).bind(userId, kind, id, JSON.stringify(tags), favorite ? 1 : 0, now).run();

  return { kind, id, custom_tags: tags, favorite, updated_at: now };
}

export async function deleteHistoryItem(env: Env, userId: string, kind: string, id: string) {
  if (kind !== "meeting" && kind !== "analysis") {
    return { error: "지원하지 않는 히스토리 유형입니다.", status: 400 };
  }
  if (!await itemExists(env, userId, kind, id)) {
    return { error: "히스토리를 찾을 수 없습니다.", status: 404 };
  }
  const current = await env.DB.prepare(
    `SELECT tags, favorite, deleted_at
     FROM history_marks
     WHERE user_id=? AND item_type=? AND item_id=?`
  ).bind(userId, kind, id).first<Pick<HistoryMarkRow, "tags" | "favorite" | "deleted_at">>();
  const deletedAt = current?.deleted_at || new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO history_marks (user_id, item_type, item_id, tags, favorite, deleted_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET
       deleted_at=excluded.deleted_at,
       updated_at=excluded.updated_at`
  ).bind(userId, kind, id, current?.tags || null, current?.favorite || 0, deletedAt, deletedAt).run();
  return { ok: true, kind, id, deleted_at: deletedAt, recoverable: true };
}

export async function restoreHistoryItem(env: Env, userId: string, kind: string, id: string) {
  if (kind !== "meeting" && kind !== "analysis") {
    return { error: "지원하지 않는 히스토리 유형입니다.", status: 400 };
  }
  if (!await itemExists(env, userId, kind, id)) {
    return { error: "히스토리를 찾을 수 없습니다.", status: 404 };
  }
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE history_marks
     SET deleted_at=NULL, updated_at=?
     WHERE user_id=? AND item_type=? AND item_id=? AND deleted_at IS NOT NULL`
  ).bind(now, userId, kind, id).run();
  return { ok: true, kind, id, restored: Number(result.meta.changes || 0) > 0, updated_at: now };
}
