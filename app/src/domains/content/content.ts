import type { Env } from "../../env";

type ContentVisibility = "private" | "team" | "public";

interface ContentPostRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
  visibility: ContentVisibility;
  tags_json: string;
  project_id: string | null;
  topic_id: string | null;
  source_refs_json: string;
  sleep_hours_json: string;
  daily_slots_json: string;
  emotion: string | null;
  created_at: string;
  updated_at: string;
}

interface ContentAssetRow {
  id: string;
  post_id: string;
  user_id: string;
  name: string;
  type: string | null;
  size: number;
  r2_key: string;
  created_at: string;
}

interface UploadedAsset {
  name: string;
  type?: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export class ContentError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "content_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const MAX_ASSETS_PER_UPLOAD = 8;
const VALID_VISIBILITY = new Set<ContentVisibility>(["private", "team", "public"]);

function now(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeUserKey(userId: string): string {
  return userId.replace(/[^\w.-]/g, "_").slice(0, 120);
}

function safeName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  return (cleaned || "content-asset").slice(0, 180);
}

function isUploadedAsset(value: unknown): value is UploadedAsset {
  return !!value
    && typeof value === "object"
    && typeof (value as { name?: unknown }).name === "string"
    && typeof (value as { size?: unknown }).size === "number"
    && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function";
}

function normalizeTitle(value: unknown, fallback?: string): string {
  const title = String(value ?? fallback ?? "").trim().replace(/\s+/g, " ").slice(0, 180);
  if (!title) throw new ContentError(400, "Title is required.", "invalid_title");
  return title;
}

function normalizeBody(value: unknown, fallback = ""): string {
  return String(value ?? fallback).trim().slice(0, 60000);
}

function normalizeVisibility(value: unknown, fallback: ContentVisibility = "private"): ContentVisibility {
  const visibility = String(value || fallback) as ContentVisibility;
  if (!VALID_VISIBILITY.has(visibility)) throw new ContentError(400, "Unsupported visibility.", "invalid_visibility");
  return visibility;
}

function normalizeTags(value: unknown, fallback: string[] = []): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : fallback;
  const tags = raw
    .map((tag) => String(tag || "").trim().replace(/^#/, "").replace(/\s+/g, "-").slice(0, 32))
    .filter(Boolean);
  return Array.from(new Set(tags)).slice(0, 12);
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return normalizeTags(parsed);
  } catch {
    return [];
  }
}

function normalizeOptionalId(value: unknown, fallback: string | null = null): string | null {
  const clean = String(value ?? fallback ?? "").trim().slice(0, 160);
  return clean || null;
}

function normalizeJsonArray(value: unknown, fallback: unknown[] = []): unknown[] {
  return Array.isArray(value) ? value : fallback;
}

function parseJsonArray(value: string): unknown[] {
  try { return normalizeJsonArray(JSON.parse(value || "[]")); } catch { return []; }
}

function normalizeSleepHours(value: unknown, fallback: number[] = []): number[] {
  const raw = Array.isArray(value) ? value : fallback;
  return Array.from(new Set(raw.map(Number).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23))).sort((a, b) => a - b);
}

function normalizeDailySlots(value: unknown, fallback: Record<string, string> = {}): Record<string, string> {
  const rec = asRecord(value);
  const source = Object.keys(rec).length ? rec : fallback;
  return {
    morning: String(source.morning || "").trim().slice(0, 500),
    lunch: String(source.lunch || "").trim().slice(0, 500),
    evening: String(source.evening || "").trim().slice(0, 500),
  };
}

function parseDailySlots(value: string): Record<string, string> {
  try { return normalizeDailySlots(JSON.parse(value || "{}")); } catch { return normalizeDailySlots({}); }
}

function normalizeSourceRefs(value: unknown, fallback: unknown[] = []) {
  return normalizeJsonArray(value, fallback).slice(0, 30).map((item) => {
    const rec = asRecord(item);
    const sourceType = String(rec.source_type || "");
    return {
      source_type: ["analysis", "design", "meeting"].includes(sourceType) ? sourceType : "analysis",
      source_id: String(rec.source_id || "").slice(0, 160),
      source_title: String(rec.source_title || "").slice(0, 240),
      import_mode: ["summary", "quote", "reference"].includes(String(rec.import_mode)) ? String(rec.import_mode) : "reference",
    };
  }).filter((item) => item.source_id);
}

function postForApi(row: ContentPostRow, assetCount?: number) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    visibility: row.visibility,
    tags: parseTags(row.tags_json),
    project_id: row.project_id,
    topic_id: row.topic_id,
    source_refs: normalizeSourceRefs(parseJsonArray(row.source_refs_json)),
    sleep_hours: normalizeSleepHours(parseJsonArray(row.sleep_hours_json)),
    daily_slots: parseDailySlots(row.daily_slots_json),
    emotion: row.emotion,
    asset_count: assetCount ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function assetForApi(row: ContentAssetRow) {
  return {
    id: row.id,
    post_id: row.post_id,
    name: row.name,
    type: row.type,
    size: row.size,
    created_at: row.created_at,
  };
}

async function findPost(env: Env, userId: string, postId: string): Promise<ContentPostRow | null> {
  return await env.DB.prepare(
    `SELECT id, user_id, title, body, visibility, tags_json, project_id, topic_id,
            source_refs_json, sleep_hours_json, daily_slots_json, emotion, created_at, updated_at
     FROM content_posts WHERE id=? AND user_id=? AND deleted_at IS NULL`
  ).bind(postId, userId).first<ContentPostRow>();
}

async function requirePost(env: Env, userId: string, postId: string): Promise<ContentPostRow> {
  const post = await findPost(env, userId, postId);
  if (!post) throw new ContentError(404, "Content post was not found.", "post_not_found");
  return post;
}

async function assetRows(env: Env, userId: string, postId: string): Promise<ContentAssetRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, post_id, user_id, name, type, size, r2_key, created_at
     FROM content_assets WHERE post_id=? AND user_id=? ORDER BY created_at DESC`
  ).bind(postId, userId).all<ContentAssetRow>();
  return results || [];
}

export async function listContentPosts(env: Env, userId: string, limit = 12, offset = 0) {
  const n = Math.min(100, Math.max(1, limit));
  const start = Math.max(0, offset);
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM content_posts WHERE user_id=? AND deleted_at IS NULL"
  ).bind(userId).first<{ total: number }>();
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.user_id, p.title, p.body, p.visibility, p.tags_json, p.project_id, p.topic_id,
            p.source_refs_json, p.sleep_hours_json, p.daily_slots_json, p.emotion, p.created_at, p.updated_at,
            COUNT(a.id) AS asset_count
     FROM content_posts p
     LEFT JOIN content_assets a ON a.post_id=p.id AND a.user_id=p.user_id
     WHERE p.user_id=? AND p.deleted_at IS NULL
     GROUP BY p.id
     ORDER BY p.updated_at DESC
     LIMIT ? OFFSET ?`
  ).bind(userId, n, start).all<ContentPostRow & { asset_count: number }>();
  return {
    posts: (results || []).map((row) => postForApi(row, Number(row.asset_count) || 0)),
    pagination: { total: Number(countRow?.total) || 0, limit: n, offset: start },
  };
}

export async function createContentPost(env: Env, userId: string, body: unknown) {
  const rec = asRecord(body);
  const id = crypto.randomUUID();
  const ts = now();
  const title = normalizeTitle(rec.title);
  const contentBody = normalizeBody(rec.body);
  const visibility = normalizeVisibility(rec.visibility);
  const tags = normalizeTags(rec.tags);
  const projectId = normalizeOptionalId(rec.project_id);
  const topicId = normalizeOptionalId(rec.topic_id);
  const sourceRefs = normalizeSourceRefs(rec.source_refs);
  const sleepHours = normalizeSleepHours(rec.sleep_hours);
  const dailySlots = normalizeDailySlots(rec.daily_slots);
  const emotion = normalizeOptionalId(rec.emotion);
  await env.DB.prepare(
    `INSERT INTO content_posts (id, user_id, title, body, visibility, tags_json, project_id, topic_id,
       source_refs_json, sleep_hours_json, daily_slots_json, emotion, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, title, contentBody, visibility, JSON.stringify(tags), projectId, topicId,
    JSON.stringify(sourceRefs), JSON.stringify(sleepHours), JSON.stringify(dailySlots), emotion, ts, ts).run();
  return { post: { id, title, body: contentBody, visibility, tags, project_id: projectId, topic_id: topicId,
    source_refs: sourceRefs, sleep_hours: sleepHours, daily_slots: dailySlots, emotion,
    asset_count: 0, created_at: ts, updated_at: ts } };
}

export async function getContentPost(env: Env, userId: string, postId: string) {
  const post = await requirePost(env, userId, postId);
  return { post: postForApi(post), assets: (await assetRows(env, userId, postId)).map(assetForApi) };
}

export async function updateContentPost(env: Env, userId: string, postId: string, body: unknown) {
  const current = await requirePost(env, userId, postId);
  const rec = asRecord(body);
  const title = Object.prototype.hasOwnProperty.call(rec, "title") ? normalizeTitle(rec.title, current.title) : current.title;
  const contentBody = Object.prototype.hasOwnProperty.call(rec, "body") ? normalizeBody(rec.body, current.body) : current.body;
  const visibility = Object.prototype.hasOwnProperty.call(rec, "visibility")
    ? normalizeVisibility(rec.visibility, current.visibility)
    : current.visibility;
  const tags = Object.prototype.hasOwnProperty.call(rec, "tags") ? normalizeTags(rec.tags, parseTags(current.tags_json)) : parseTags(current.tags_json);
  const projectId = Object.prototype.hasOwnProperty.call(rec, "project_id") ? normalizeOptionalId(rec.project_id) : current.project_id;
  const topicId = Object.prototype.hasOwnProperty.call(rec, "topic_id") ? normalizeOptionalId(rec.topic_id) : current.topic_id;
  const sourceRefs = Object.prototype.hasOwnProperty.call(rec, "source_refs")
    ? normalizeSourceRefs(rec.source_refs, parseJsonArray(current.source_refs_json))
    : normalizeSourceRefs(parseJsonArray(current.source_refs_json));
  const sleepHours = Object.prototype.hasOwnProperty.call(rec, "sleep_hours")
    ? normalizeSleepHours(rec.sleep_hours, normalizeSleepHours(parseJsonArray(current.sleep_hours_json)))
    : normalizeSleepHours(parseJsonArray(current.sleep_hours_json));
  const dailySlots = Object.prototype.hasOwnProperty.call(rec, "daily_slots")
    ? normalizeDailySlots(rec.daily_slots, parseDailySlots(current.daily_slots_json))
    : parseDailySlots(current.daily_slots_json);
  const emotion = Object.prototype.hasOwnProperty.call(rec, "emotion") ? normalizeOptionalId(rec.emotion) : current.emotion;
  const ts = now();
  await env.DB.prepare(
    `UPDATE content_posts SET title=?, body=?, visibility=?, tags_json=?, project_id=?, topic_id=?,
       source_refs_json=?, sleep_hours_json=?, daily_slots_json=?, emotion=?, updated_at=?
     WHERE id=? AND user_id=? AND deleted_at IS NULL`
  ).bind(title, contentBody, visibility, JSON.stringify(tags), projectId, topicId, JSON.stringify(sourceRefs),
    JSON.stringify(sleepHours), JSON.stringify(dailySlots), emotion, ts, postId, userId).run();
  return { post: { id: postId, title, body: contentBody, visibility, tags, project_id: projectId, topic_id: topicId,
    source_refs: sourceRefs, sleep_hours: sleepHours, daily_slots: dailySlots, emotion,
    updated_at: ts, created_at: current.created_at } };
}

export async function deleteContentPost(env: Env, userId: string, postId: string) {
  await requirePost(env, userId, postId);
  const ts = now();
  const result = await env.DB.prepare(
    "UPDATE content_posts SET deleted_at=?, updated_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL"
  ).bind(ts, ts, postId, userId).run();
  return { ok: result.meta.changes > 0 };
}

export async function listContentAssets(env: Env, userId: string, postId: string) {
  await requirePost(env, userId, postId);
  return { assets: (await assetRows(env, userId, postId)).map(assetForApi) };
}

export async function saveContentAssetsFromRequest(env: Env, userId: string, postId: string, request: Request) {
  await requirePost(env, userId, postId);
  const form = await request.formData();
  const files: UploadedAsset[] = [];
  for (const value of form.getAll("assets") as unknown[]) {
    if (isUploadedAsset(value) && value.size > 0) files.push(value);
  }
  if (!files.length) throw new ContentError(400, "At least one file is required.", "asset_required");
  if (files.length > MAX_ASSETS_PER_UPLOAD) throw new ContentError(400, "Too many files in one upload.", "too_many_assets");

  const created: ReturnType<typeof assetForApi>[] = [];
  const ts = now();
  for (const file of files) {
    if (file.size > MAX_ASSET_BYTES) throw new ContentError(413, "Each asset must be 12 MB or smaller.", "asset_too_large");
    const id = crypto.randomUUID();
    const name = safeName(file.name);
    const key = `content/${safeUserKey(userId)}/${postId}/${id}/${name}`;
    await env.R2.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    await env.DB.prepare(
      `INSERT INTO content_assets (id, post_id, user_id, name, type, size, r2_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, postId, userId, name, file.type || null, file.size, key, ts).run();
    created.push(assetForApi({ id, post_id: postId, user_id: userId, name, type: file.type || null, size: file.size, r2_key: key, created_at: ts }));
  }

  await env.DB.prepare("UPDATE content_posts SET updated_at=? WHERE id=? AND user_id=?").bind(ts, postId, userId).run();
  return { assets: created };
}

export async function deleteContentAsset(env: Env, userId: string, postId: string, assetId: string) {
  await requirePost(env, userId, postId);
  const row = await env.DB.prepare(
    `SELECT id, post_id, user_id, name, type, size, r2_key, created_at
     FROM content_assets WHERE id=? AND post_id=? AND user_id=?`
  ).bind(assetId, postId, userId).first<ContentAssetRow>();
  if (!row) throw new ContentError(404, "Content asset was not found.", "asset_not_found");
  await env.R2.delete(row.r2_key);
  const result = await env.DB.prepare(
    "DELETE FROM content_assets WHERE id=? AND post_id=? AND user_id=?"
  ).bind(assetId, postId, userId).run();
  await env.DB.prepare("UPDATE content_posts SET updated_at=? WHERE id=? AND user_id=?").bind(now(), postId, userId).run();
  return { ok: result.meta.changes > 0 };
}

export async function getContentAssetResponse(env: Env, userId: string, postId: string, assetId: string): Promise<Response> {
  await requirePost(env, userId, postId);
  const row = await env.DB.prepare(
    `SELECT id, post_id, user_id, name, type, size, r2_key, created_at
     FROM content_assets WHERE id=? AND post_id=? AND user_id=?`
  ).bind(assetId, postId, userId).first<ContentAssetRow>();
  if (!row) throw new ContentError(404, "Content asset was not found.", "asset_not_found");
  const object = await env.R2.get(row.r2_key);
  if (!object) throw new ContentError(404, "Stored content asset was not found.", "asset_object_not_found");
  const headers = new Headers();
  headers.set("content-type", row.type || "application/octet-stream");
  headers.set("content-length", String(row.size));
  headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`);
  return new Response(object.body, { headers });
}
