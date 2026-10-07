import type { Env } from "../../env";
import { timingSafeEqual } from "../../core/auth";
import { getUserToken } from "../../git";

type DeployTarget = "manual" | "cloudflare_pages" | "github_pages";
type GardenSourceMode = "analysis" | "direct" | "github";

interface GardenConfig {
  source: {
    repo: string;
    mode: GardenSourceMode;
    issuesDir: string;
    visibility: "public" | "private";
  };
  publish: {
    label: string;
    sections?: string[];
  };
  site: {
    title: string;
    baseUrl: string;
    logo: string;
  };
  sourceRefs: Array<{
    source_type: "analysis" | "design" | "meeting";
    source_id: string;
    source_title: string;
  }>;
  taxonomy: {
    topics: Record<string, string>;
    activities: Record<string, string>;
  };
  directContent?: string;
}

interface GardenAssetRow {
  id: string; garden_id: string; user_id: string; kind: "logo";
  name: string; type: string | null; size: number; r2_key: string; created_at: string;
}

interface UploadedGardenAsset {
  name: string; type?: string; size: number; arrayBuffer(): Promise<ArrayBuffer>;
}

interface GardenRow {
  id: string;
  user_id: string;
  repo: string;
  title: string;
  config_json: string;
  deploy_target: DeployTarget;
  status: string;
  site_url: string | null;
  last_build_at: string | null;
  created_at: string;
  updated_at: string;
  latest_build_status?: string | null;
  latest_build_message?: string | null;
  latest_build_at?: string | null;
}

interface GardenBuildRow {
  id: string;
  garden_id: string;
  user_id: string;
  status: string;
  message: string | null;
  error_message?: string | null;
  artifact_url: string | null;
  site_url: string | null;
  started_at: string;
  finished_at: string | null;
  build_fingerprint?: string | null;
  builder_version?: string | null;
  pages_project_name?: string | null;
}

type GardenBuildArtifactFile = "manifest" | "config" | "content" | "result";
type GardenBuildStatus = "artifact_ready" | "queued" | "running" | "succeeded" | "failed";

export class GardenError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "garden_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DEPLOY_TARGETS = new Set<DeployTarget>(["manual", "cloudflare_pages", "github_pages"]);
const GARDEN_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const MAX_GARDEN_LOGO_BYTES = 4 * 1024 * 1024;
const MAX_GARDENS_PER_USER = 3;
const MAX_DAILY_BUILDS_PER_USER = 5;
const MAX_GARDEN_SOURCES = 20;
const MAX_SOURCE_CHARS = 120_000;
const GARDEN_BUILDER_VERSION = "garden-content-v2.1";
const buildFlights = new Map<string, { promise: Promise<unknown>; expiresAt: number }>();
const gardenReadCache = new Map<string, { value: unknown; expiresAt: number }>();

function invalidateGardenCache(userId: string, gardenId?: string) {
  for (const key of gardenReadCache.keys()) {
    if (key.startsWith(`list:${userId}:`) || (gardenId && (key === `detail:${userId}:${gardenId}` || key.startsWith(`builds:${userId}:${gardenId}:`)))) gardenReadCache.delete(key);
  }
}

function now(): string {
  return new Date().toISOString();
}

function safeKey(value: string): string {
  return String(value || "")
    .replace(/^anon:/, "anon-")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compact(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeRepo(value: unknown, fallback?: string): string {
  const repo = compact(value || fallback).slice(0, 160);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new GardenError(400, "repo must use owner/name format.", "invalid_repo");
  }
  return repo;
}

function normalizeTitle(value: unknown, fallback: string): string {
  const title = compact(value || fallback).slice(0, 140);
  if (!title) throw new GardenError(400, "title is required.", "invalid_title");
  return title;
}

function normalizeLabel(value: unknown, fallback = "audience:business"): string {
  const label = compact(value || fallback).slice(0, 80);
  if (!label || /[\r\n]/.test(label)) throw new GardenError(400, "publish label is invalid.", "invalid_label");
  return label;
}

function normalizeSections(value: unknown, fallback: string[] = []): string[] {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map((item) => compact(item).slice(0, 80)).filter(Boolean))].slice(0, 30);
}

function normalizeIssuesDir(value: unknown, fallback = "Knowledge/Issues"): string {
  const dir = compact(value || fallback).replace(/\\/g, "/").slice(0, 180);
  if (!dir || dir.startsWith("/") || dir.includes("..") || !/^[\w./ -]+$/.test(dir)) {
    throw new GardenError(400, "issuesDir must be a relative repository path.", "invalid_issues_dir");
  }
  return dir.replace(/\/+/g, "/").replace(/\/$/, "");
}

function normalizeVisibility(value: unknown, fallback: "public" | "private" = "public"): "public" | "private" {
  const raw = compact(value || fallback).toLowerCase();
  return raw === "private" ? "private" : "public";
}

function normalizeOptionalText(value: unknown, max = 220): string {
  const text = compact(value).slice(0, max);
  if (/[\r\n]/.test(text)) throw new GardenError(400, "single-line value is required.", "invalid_text");
  return text;
}

function normalizeErrorMessage(value: unknown): string | null {
  const text = String(value ?? "").trim().slice(0, 2000);
  return text || null;
}

function normalizeDeployTarget(value: unknown, fallback: DeployTarget = "manual"): DeployTarget {
  const target = String(value || fallback) as DeployTarget;
  return DEPLOY_TARGETS.has(target) ? target : fallback;
}

function normalizeTaxonomy(value: unknown, fallback: Record<string, string> = {}): Record<string, string> {
  const source = asRecord(value);
  const entries = Object.keys(source).length ? Object.entries(source) : Object.entries(fallback);
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = compact(rawKey).slice(0, 80);
    const description = compact(rawValue).slice(0, 360);
    if (!key || !description) continue;
    out[key] = description;
    if (Object.keys(out).length >= 60) break;
  }
  return out;
}

function normalizeSourceRefs(value: unknown, fallback: GardenConfig["sourceRefs"] = []): GardenConfig["sourceRefs"] {
  const source = Array.isArray(value) ? value : fallback;
  return source.slice(0, MAX_GARDEN_SOURCES).map((item) => {
    const rec = asRecord(item);
    const rawType = String(rec.source_type || "analysis");
    const sourceType = (["analysis", "design", "meeting"].includes(rawType) ? rawType : "analysis") as GardenConfig["sourceRefs"][number]["source_type"];
    return {
      source_type: sourceType,
      source_id: normalizeOptionalText(rec.source_id, 160),
      source_title: normalizeOptionalText(rec.source_title, 240),
    };
  }).filter((item) => item.source_id && item.source_title);
}

function parseConfig(raw: string): GardenConfig | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const parsedConfig = parsed as { source?: { mode?: string } };
    if (parsedConfig.source?.mode === "issues") parsedConfig.source.mode = "github";
    return parsed as GardenConfig;
  } catch {
    return null;
  }
}

function defaultTitle(repo: string): string {
  return `${repo.split("/")[1] || "repo"} 지식베이스`;
}

function normalizeConfig(body: unknown, fallback?: GardenConfig): GardenConfig {
  const rec = asRecord(body);
  const source = asRecord(rec.source);
  const publish = asRecord(rec.publish);
  const site = asRecord(rec.site);
  const taxonomy = asRecord(rec.taxonomy);

  const rawMode = String(rec.sourceMode ?? rec.source_mode ?? source.mode ?? fallback?.source.mode ?? "analysis");
  const mode: GardenSourceMode = rawMode === "github" || rawMode === "issues" ? "github" : rawMode === "direct" ? "direct" : "analysis";
  const repoFallback = fallback?.source.repo || `personal/${crypto.randomUUID().slice(0, 12)}`;
  const repo = normalizeRepo(rec.repo ?? source.repo, repoFallback);
  const title = normalizeTitle(rec.title ?? site.title, fallback?.site.title || defaultTitle(repo));
  const issuesDir = normalizeIssuesDir(rec.issuesDir ?? source.issuesDir, fallback?.source.issuesDir || "Knowledge/Issues");
  const visibility = normalizeVisibility(rec.sourceVisibility ?? rec.visibility ?? source.visibility, fallback?.source.visibility || "public");
  const label = normalizeLabel(rec.publishLabel ?? publish.label, fallback?.publish.label || "audience:business");
  const sections = normalizeSections(rec.publishSections ?? rec.publish_sections ?? publish.sections, fallback?.publish.sections);
  const baseUrl = normalizeOptionalText(rec.baseUrl ?? site.baseUrl ?? fallback?.site.baseUrl ?? "", 220);
  const logo = normalizeOptionalText(rec.logo ?? site.logo ?? fallback?.site.logo ?? "", 220);
  const topics = normalizeTaxonomy(rec.topics ?? taxonomy.topics, fallback?.taxonomy.topics);
  const activities = normalizeTaxonomy(rec.activities ?? taxonomy.activities, fallback?.taxonomy.activities);
  const sourceRefs = normalizeSourceRefs(rec.sourceRefs ?? rec.source_refs, fallback?.sourceRefs);

  const directContent = String(rec.directContent ?? rec.direct_content ?? fallback?.directContent ?? "").trim().slice(0, MAX_SOURCE_CHARS);
  return {
    source: { repo, mode, issuesDir, visibility },
    publish: { label, sections },
    site: { title, baseUrl, logo },
    taxonomy: { topics, activities },
    sourceRefs,
    directContent,
  };
}

function gardenSlug(repo: string, id: string): string {
  const repoName = repo.split("/")[1] || "garden";
  const base = repoName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42) || "garden";
  return `${base}-${id.slice(0, 8)}`;
}

function generatedBaseUrl(env: Env, config: GardenConfig, id: string, target: DeployTarget): string {
  const [owner, repo] = config.source.repo.split("/");
  if (target === "github_pages") return `https://${owner}.github.io/${repo}/`;
  if (target === "cloudflare_pages") return `https://${gardenSlug(config.source.repo, id)}.pages.dev`;
  const appBase = String(env.APP_BASE_URL || "https://harness-meeting-app.kibayerin.workers.dev").replace(/\/$/, "");
  return `${appBase}/garden/preview/${gardenSlug(config.source.repo, id)}`;
}

function siteUrlFromConfig(config: GardenConfig): string | null {
  const baseUrl = config.site.baseUrl.trim();
  if (!baseUrl) return null;
  return /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function gardenConfigYaml(config: GardenConfig): string {
  const lines = [
    "source:",
    `  repo: ${yamlString(config.source.repo)}`,
    `  mode: ${yamlString(config.source.mode)}`,
    `  issuesDir: ${yamlString(config.source.issuesDir)}`,
    `  visibility: ${yamlString(config.source.visibility || "public")}`,
    "publish:",
    `  label: ${yamlString(config.publish.label)}`,
    `  sections: [${(config.publish.sections || []).map(yamlString).join(", ")}]`,
    "site:",
    `  title: ${yamlString(config.site.title)}`,
    `  baseUrl: ${yamlString(config.site.baseUrl)}`,
    `  logo: ${yamlString(config.site.logo)}`,
    "taxonomy:",
    "  topics:",
  ];

  const topics = Object.entries(config.taxonomy.topics);
  if (!topics.length) lines.push("    {}");
  else topics.forEach(([key, value]) => lines.push(`    ${yamlString(key)}: ${yamlString(value)}`));

  lines.push("  activities:");
  const activities = Object.entries(config.taxonomy.activities);
  if (!activities.length) lines.push("    {}");
  else activities.forEach(([key, value]) => lines.push(`    ${yamlString(key)}: ${yamlString(value)}`));

  lines.push("sources:");
  const sources = config.sourceRefs || [];
  if (!sources.length) lines.push("  []");
  else sources.forEach((source) => {
    lines.push(`  - type: ${yamlString(source.source_type)}`);
    lines.push(`    id: ${yamlString(source.source_id)}`);
    lines.push(`    title: ${yamlString(source.source_title)}`);
  });

  return `${lines.join("\n")}\n`;
}

function gardenForApi(row: GardenRow) {
  const config = parseConfig(row.config_json) || normalizeConfig({ repo: row.repo, title: row.title });
  return {
    id: row.id,
    repo: row.repo,
    title: row.title,
    deploy_target: row.deploy_target,
    status: row.status,
    site_url: row.site_url,
    last_build_at: row.last_build_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    latest_build: row.latest_build_status ? {
      status: row.latest_build_status,
      message: row.latest_build_message || null,
      started_at: row.latest_build_at || null,
    } : null,
    config,
    config_yaml: gardenConfigYaml(config),
  };
}

function buildForApi(row: GardenBuildRow) {
  return {
    id: row.id,
    garden_id: row.garden_id,
    status: row.status,
    message: row.message,
    error_message: row.error_message || null,
    artifact_url: row.artifact_url,
    manifest_url: buildArtifactUrl(row.garden_id, row.id, "manifest"),
    config_url: buildArtifactUrl(row.garden_id, row.id, "config"),
    result_url: buildArtifactUrl(row.garden_id, row.id, "result"),
    site_url: row.site_url,
    pages_project_name: row.pages_project_name || null,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

function buildArtifactUrl(gardenId: string, buildId: string, file: GardenBuildArtifactFile = "manifest"): string {
  return `/api/gardens/${encodeURIComponent(gardenId)}/builds/${encodeURIComponent(buildId)}/artifact?file=${file}`;
}

function runnerBuildArtifactUrl(gardenId: string, buildId: string, file: GardenBuildArtifactFile = "manifest"): string {
  return `/api/garden-runner/gardens/${encodeURIComponent(gardenId)}/builds/${encodeURIComponent(buildId)}/artifact?file=${file}`;
}

function buildCallbackUrl(gardenId: string, buildId: string): string {
  return `/api/gardens/${encodeURIComponent(gardenId)}/builds/${encodeURIComponent(buildId)}/callback`;
}

function absoluteUrl(env: Env, request: Request, path: string): string {
  const base = normalizeOptionalText(env.APP_BASE_URL, 500) || new URL(request.url).origin;
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

function buildArtifactKey(userId: string, gardenId: string, buildId: string, file: GardenBuildArtifactFile): string {
  const filename = file === "config" ? "garden.config.yaml" : file === "content" ? "content-package.json" : file === "result" ? "result.json" : "manifest.json";
  return `gardens/${safeKey(userId)}/${safeKey(gardenId)}/builds/${safeKey(buildId)}/${filename}`;
}

function normalizeBuildStatus(value: unknown): GardenBuildStatus {
  const raw = String(value || "").trim();
  if (raw === "artifact_ready" || raw === "queued" || raw === "running" || raw === "succeeded" || raw === "failed") return raw;
  throw new GardenError(400, "build status is invalid.", "invalid_build_status");
}

function canAdvanceBuildStatus(current: string, next: GardenBuildStatus): boolean {
  if (current === next) return true;
  if (current === "queued") return next === "running" || next === "artifact_ready" || next === "succeeded" || next === "failed";
  if (current === "artifact_ready") return next === "running" || next === "succeeded" || next === "failed";
  if (current === "running") return next === "succeeded" || next === "failed";
  return false;
}

function runnerTokenFromRequest(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return request.headers.get("x-garden-runner-token") || "";
}

async function requireRunnerToken(env: Env, request: Request): Promise<void> {
  const expected = env.GARDEN_RUNNER_TOKEN;
  if (!expected) throw new GardenError(501, "Garden runner token is not configured.", "runner_token_not_configured");
  const actual = runnerTokenFromRequest(request);
  if (!actual || !(await timingSafeEqual(actual, expected))) throw new GardenError(403, "Garden runner callback is not authorized.", "runner_unauthorized");
}

function buildManifest(
  garden: GardenRow,
  buildId: string,
  config: GardenConfig,
  startedAt: string,
  manifestUrl: string,
  configUrl: string,
  callbackUrl: string,
  contentUrl: string,
  contentSha256: string
) {
  return {
    schema: "planning-harness.garden-build.v1",
    build_id: buildId,
    garden_id: garden.id,
    repo: config.source.repo,
    deploy_target: garden.deploy_target,
    status: "queued",
    requested_at: startedAt,
    source: config.source,
    publish: config.publish,
    site: {
      ...config.site,
      site_url: garden.site_url,
    },
    taxonomy: config.taxonomy,
    artifacts: {
      manifest_json: {
        path: "manifest.json",
        download_url: manifestUrl,
      },
      config_yaml: {
        path: "garden.config.yaml",
        download_url: configUrl,
      },
      content_package: {
        path: "content-package.json",
        download_url: contentUrl,
        sha256: contentSha256,
      },
    },
    api: {
      callback_url: callbackUrl,
    },
    runner: {
      mode: "claim_or_callback",
      expected_input: "manifest.json + garden.config.yaml",
      suggested_command: "node build-garden.mjs --manifest-url \"$MANIFEST_URL\" --token \"$GARDEN_RUNNER_TOKEN\" --callback-token \"$GARDEN_RUNNER_TOKEN\" --out content",
      note: "Runner can either claim queued work from /api/garden-runner/builds/next or fetch this manifest/config and post status callbacks.",
    },
  };
}

async function findGarden(env: Env, userId: string, gardenId: string): Promise<GardenRow | null> {
  return await env.DB.prepare(
    `SELECT id, user_id, repo, title, config_json, deploy_target, status, site_url,
            last_build_at, created_at, updated_at
     FROM gardens
     WHERE id=? AND user_id=?`
  ).bind(gardenId, userId).first<GardenRow>();
}

async function requireGarden(env: Env, userId: string, gardenId: string): Promise<GardenRow> {
  const garden = await findGarden(env, userId, gardenId);
  if (!garden) throw new GardenError(404, "Garden was not found.", "garden_not_found");
  return garden;
}

export async function listGardens(env: Env, userId: string, limit = 50) {
  const n = Math.min(100, Math.max(1, limit));
  const cacheKey = `list:${userId}:${n}`;
  const cached = gardenReadCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as { gardens: ReturnType<typeof gardenForApi>[] };
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.user_id, g.repo, g.title, g.config_json, g.deploy_target, g.status,
            g.site_url, g.last_build_at, g.created_at, g.updated_at,
            (SELECT b.status FROM garden_builds b WHERE b.garden_id=g.id ORDER BY b.started_at DESC LIMIT 1) AS latest_build_status,
            (SELECT b.message FROM garden_builds b WHERE b.garden_id=g.id ORDER BY b.started_at DESC LIMIT 1) AS latest_build_message,
            (SELECT b.started_at FROM garden_builds b WHERE b.garden_id=g.id ORDER BY b.started_at DESC LIMIT 1) AS latest_build_at
     FROM gardens g
     WHERE g.user_id=?
     ORDER BY g.updated_at DESC
     LIMIT ?`
  ).bind(userId, n).all<GardenRow>();
  const value = { gardens: (results || []).map(gardenForApi) };
  if (!value.gardens.some((garden) => garden.status === "queued" || garden.status === "running" || garden.latest_build?.status === "queued" || garden.latest_build?.status === "running")) {
    gardenReadCache.set(cacheKey, { value, expiresAt: Date.now() + 10_000 });
  }
  return value;
}

// 공개 쇼케이스 — 로그인 없이 읽는다. 빌드가 성공해 site_url 이 있고 소스 저장소가 public 인
// 가든만, 제목·사이트 주소·마지막 빌드 시각만 내보낸다(사용자 id·repo·config 는 내보내지 않는다).
// sdui-template-kit 의 게시 가든 페이지가 서버에서 가져가 "planning-harness 에서 공개된 가든" 으로 보여 준다.
export async function listPublicGardens(env: Env, limit = 20) {
  const n = Math.min(50, Math.max(1, limit));
  const cacheKey = `public:${n}`;
  const cached = gardenReadCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as { gardens: PublicGarden[]; public: true };
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.title, g.config_json, g.site_url, g.last_build_at, g.updated_at
     FROM gardens g
     WHERE g.status = 'succeeded' AND g.site_url IS NOT NULL AND g.site_url <> ''
     ORDER BY COALESCE(g.last_build_at, g.updated_at) DESC
     LIMIT ?`
  ).bind(n * 2).all<Pick<GardenRow, "id" | "title" | "config_json" | "site_url" | "last_build_at" | "updated_at">>();
  const gardens: PublicGarden[] = [];
  for (const row of results || []) {
    const config = parseConfig(row.config_json);
    if (!config || config.source?.visibility !== "public") continue;
    if (!/^https:\/\//.test(String(row.site_url))) continue;
    gardens.push({ id: row.id, title: row.title, site_url: row.site_url as string, last_build_at: row.last_build_at });
    if (gardens.length >= n) break;
  }
  const value = { gardens, public: true as const };
  gardenReadCache.set(cacheKey, { value, expiresAt: Date.now() + 30_000 });
  return value;
}

interface PublicGarden {
  id: string;
  title: string;
  site_url: string;
  last_build_at: string | null;
}

export async function getGarden(env: Env, userId: string, gardenId: string) {
  const cacheKey = `detail:${userId}:${gardenId}`;
  const cached = gardenReadCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as { garden: ReturnType<typeof gardenForApi> };
  const value = { garden: gardenForApi(await requireGarden(env, userId, gardenId)) };
  if (value.garden.status !== "queued" && value.garden.status !== "running") gardenReadCache.set(cacheKey, { value, expiresAt: Date.now() + 10_000 });
  return value;
}

interface GardenContentDocument {
  id: string;
  type: "analysis" | "meeting" | "direct";
  title: string;
  body: string;
  source_url?: string | null;
  sections?: Array<{ kind: string; title: string; body_markdown: string }>;
  created_at?: string | null;
}

function sourceAppUrl(env: Env, type: "analysis" | "meeting", id: string): string {
  const base = (String(env.APP_BASE_URL || "https://harness-meeting-app.kibayerin.workers.dev").trim() || "https://harness-meeting-app.kibayerin.workers.dev").replace(/\/+$/, "");
  const param = type === "meeting" ? "meeting" : "session";
  return `${base}/analysis-edit2/?${param}=${encodeURIComponent(id)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function gardenBuildFingerprint(env: Env, garden: GardenRow, config: GardenConfig): Promise<string> {
  const sourceVersions: Array<Record<string, unknown>> = [];
  for (const source of config.sourceRefs) {
    if (source.source_type === "meeting") {
      const row = await env.DB.prepare("SELECT id, created_at, r2_key FROM meetings WHERE id=? AND user_id=?")
        .bind(source.source_id, garden.user_id).first<{ id: string; created_at: string; r2_key: string }>();
      sourceVersions.push({ type: "meeting", id: source.source_id, version: row?.created_at || null, r2_key: row?.r2_key || null });
    } else {
      const row = await env.DB.prepare("SELECT id, updated_at FROM analysis_sessions WHERE id=? AND user_id=?")
        .bind(source.source_id, garden.user_id).first<{ id: string; updated_at: string }>();
      const output = await env.DB.prepare("SELECT MAX(created_at) AS latest FROM analysis_outputs WHERE session_id=? AND user_id=?")
        .bind(source.source_id, garden.user_id).first<{ latest: string | null }>();
      sourceVersions.push({ type: "analysis", id: source.source_id, version: row?.updated_at || null, output_version: output?.latest || null });
    }
  }
  const logo = await env.DB.prepare("SELECT id, created_at, size FROM garden_assets WHERE garden_id=? AND user_id=? AND kind='logo'")
    .bind(garden.id, garden.user_id).first<{ id: string; created_at: string; size: number }>();
  return sha256Hex(stableJson({ builder_version: GARDEN_BUILDER_VERSION, config, sourceVersions, logo: logo || null, deploy_target: garden.deploy_target }));
}

function humanTitle(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).trim();
}

function markdownValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "-";
    if (value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      const rows = value as Record<string, unknown>[];
      const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 12);
      return [`| ${keys.map(humanTitle).join(" | ")} |`, `| ${keys.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${keys.map((key) => markdownValue(row[key], depth + 1).replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|")).join(" | ")} |`)].join("\n");
    }
    return value.map((item) => `- ${markdownValue(item, depth + 1).replace(/\r?\n/g, "\n  ")}`).join("\n");
  }
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    const rendered = markdownValue(item, depth + 1);
    return item && typeof item === "object"
      ? `${"#".repeat(Math.min(4, depth + 3))} ${humanTitle(key)}\n\n${rendered}`
      : `- **${humanTitle(key)}:** ${rendered}`;
  }).join("\n\n") || "-";
}

function contentJsonMarkdown(value: string): string {
  try { return markdownValue(JSON.parse(value)); } catch { return value.trim(); }
}

async function contentPackageForGarden(env: Env, garden: GardenRow, config: GardenConfig) {
  const documents: GardenContentDocument[] = [];
  for (const source of config.sourceRefs) {
    if (source.source_type === "meeting") {
      const row = await env.DB.prepare(
        "SELECT id, title, r2_key, created_at FROM meetings WHERE id=? AND user_id=?"
      ).bind(source.source_id, garden.user_id).first<{ id: string; title: string; r2_key: string; created_at: string }>();
      if (!row) throw new GardenError(404, `회의록을 찾을 수 없습니다: ${source.source_title}`, "garden_source_not_found");
      const object = await env.R2.get(row.r2_key);
      const body = object ? (await object.text()).slice(0, MAX_SOURCE_CHARS) : "";
      documents.push({ id: row.id, type: "meeting", title: row.title || source.source_title, body, source_url: sourceAppUrl(env, "meeting", row.id), created_at: row.created_at });
      continue;
    }
    const session = await env.DB.prepare(
      "SELECT id, title, subject, etc_note, created_at FROM analysis_sessions WHERE id=? AND user_id=?"
    ).bind(source.source_id, garden.user_id).first<{ id: string; title: string | null; subject: string | null; etc_note: string | null; created_at: string }>();
    if (!session) throw new GardenError(404, `분석자료를 찾을 수 없습니다: ${source.source_title}`, "garden_source_not_found");
    const { results } = await env.DB.prepare(
      `SELECT kind, content_json FROM analysis_outputs
       WHERE session_id=? AND user_id=? ORDER BY created_at ASC LIMIT 30`
    ).bind(session.id, garden.user_id).all<{ kind: string; content_json: string }>();
    const allowed = new Set(config.publish.sections || []);
    const sections = (results || []).filter((row) => !allowed.size || allowed.has(row.kind)).map((row) => ({
      kind: row.kind,
      title: humanTitle(row.kind),
      body_markdown: contentJsonMarkdown(row.content_json),
    }));
    const output = sections.map((section) => `## ${section.title}\n\n${section.body_markdown}`).join("\n\n");
    const body = [session.etc_note || "", output].filter(Boolean).join("\n\n").slice(0, MAX_SOURCE_CHARS);
    documents.push({ id: session.id, type: "analysis", title: session.title || session.subject || source.source_title, body, source_url: sourceAppUrl(env, "analysis", session.id), sections, created_at: session.created_at });
  }
  if (config.directContent) {
    documents.push({ id: `direct-${garden.id}`, type: "direct", title: config.site.title, body: config.directContent.slice(0, MAX_SOURCE_CHARS) });
  }
  if (config.source.mode !== "github" && !documents.length) {
    throw new GardenError(400, "분석자료, 회의록 또는 직접 작성 내용을 하나 이상 선택하세요.", "garden_source_required");
  }
  return {
    schema: "planning-harness.garden-content.v2",
    garden_id: garden.id,
    generated_at: now(),
    site: config.site,
    taxonomy: config.taxonomy,
    documents,
  };
}

export async function deleteGarden(env: Env, userId: string, gardenId: string) {
  invalidateGardenCache(userId, gardenId);
  const garden = await requireGarden(env, userId, gardenId);
  const config = parseConfig(garden.config_json);
  const deletedAt = now();

  if (garden.deploy_target !== "manual" && garden.site_url) {
    const cleanupDueAt = new Date(Date.parse(deletedAt) + 72 * 60 * 60 * 1000).toISOString();
    const projectName = garden.deploy_target === "cloudflare_pages"
      ? gardenSlug(config?.source.repo || garden.repo, garden.id)
      : null;
    await env.DB.prepare(
      `INSERT INTO garden_site_cleanup_jobs
       (id, garden_id, user_id, repo, deploy_target, site_url, project_name, status, attempts, cleanup_due_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
    ).bind(crypto.randomUUID(), garden.id, userId, garden.repo, garden.deploy_target,
      garden.site_url, projectName, cleanupDueAt, deletedAt).run();
  }

  const assets = await env.DB.prepare(
    "SELECT r2_key FROM garden_assets WHERE garden_id=? AND user_id=?"
  ).bind(gardenId, userId).all<{ r2_key: string }>();
  const builds = await env.DB.prepare(
    "SELECT id FROM garden_builds WHERE garden_id=? AND user_id=?"
  ).bind(gardenId, userId).all<{ id: string }>();

  for (const asset of assets.results || []) {
    if (asset.r2_key) await env.R2.delete(asset.r2_key);
  }
  for (const build of builds.results || []) {
    await Promise.all([
      env.R2.delete(buildArtifactKey(userId, gardenId, build.id, "config")),
      env.R2.delete(buildArtifactKey(userId, gardenId, build.id, "manifest")),
      env.R2.delete(buildArtifactKey(userId, gardenId, build.id, "content")),
      env.R2.delete(buildArtifactKey(userId, gardenId, build.id, "result")),
    ]);
  }

  await env.DB.prepare("DELETE FROM garden_assets WHERE garden_id=? AND user_id=?").bind(gardenId, userId).run();
  await env.DB.prepare("DELETE FROM garden_builds WHERE garden_id=? AND user_id=?").bind(gardenId, userId).run();
  await env.DB.prepare("DELETE FROM organization_gardens WHERE garden_id=?").bind(gardenId).run();
  await env.DB.prepare("DELETE FROM gardens WHERE id=? AND user_id=?").bind(gardenId, userId).run();
  return { ok: true, id: gardenId, site_cleanup_due_at: garden.deploy_target !== "manual" && garden.site_url
    ? new Date(Date.parse(deletedAt) + 72 * 60 * 60 * 1000).toISOString()
    : null };
}

interface GardenCleanupJobRow {
  id: string;
  user_id: string;
  repo: string;
  deploy_target: DeployTarget;
  project_name: string | null;
  attempts: number;
}

async function deleteGithubPages(env: Env, job: GardenCleanupJobRow): Promise<void> {
  const token = await getUserToken(env, job.user_id);
  if (!token) throw new Error("GitHub OAuth token is unavailable.");
  const response = await fetch(`https://api.github.com/repos/${job.repo}/pages`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "harness-meeting-app",
    },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`GitHub Pages delete failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}

async function deleteCloudflarePages(env: Env, job: GardenCleanupJobRow): Promise<void> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_PAGES_API_TOKEN) {
    throw new Error("Cloudflare Pages cleanup credentials are not configured.");
  }
  if (!job.project_name) throw new Error("Cloudflare Pages project name is unavailable.");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(job.project_name)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${env.CLOUDFLARE_PAGES_API_TOKEN}` } }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Cloudflare Pages delete failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}

export async function processDueGardenSiteCleanups(env: Env, limit = 10): Promise<void> {
  const due = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, repo, deploy_target, project_name, attempts
     FROM garden_site_cleanup_jobs
     WHERE status IN ('pending', 'retry') AND cleanup_due_at<=? AND attempts<10
     ORDER BY cleanup_due_at ASC LIMIT ?`
  ).bind(due, Math.min(50, Math.max(1, limit))).all<GardenCleanupJobRow>();

  for (const job of results || []) {
    const claimed = await env.DB.prepare(
      "UPDATE garden_site_cleanup_jobs SET status='running', attempts=attempts+1 WHERE id=? AND status IN ('pending','retry')"
    ).bind(job.id).run();
    if (!claimed.meta.changes) continue;
    try {
      if (job.deploy_target === "github_pages") await deleteGithubPages(env, job);
      else if (job.deploy_target === "cloudflare_pages") await deleteCloudflarePages(env, job);
      await env.DB.prepare(
        "UPDATE garden_site_cleanup_jobs SET status='completed', completed_at=?, last_error=NULL WHERE id=?"
      ).bind(new Date().toISOString(), job.id).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown site cleanup error";
      const retryHours = Math.min(24, Math.max(1, 2 ** Math.min(job.attempts, 5)));
      const retryAt = new Date(Date.now() + retryHours * 60 * 60 * 1000).toISOString();
      await env.DB.prepare(
        "UPDATE garden_site_cleanup_jobs SET status='retry', cleanup_due_at=?, last_error=? WHERE id=?"
      ).bind(retryAt, message.slice(0, 1000), job.id).run();
    }
  }
}

export async function saveGarden(env: Env, userId: string, body: unknown, gardenId?: string) {
  invalidateGardenCache(userId, gardenId);
  const current = gardenId ? await requireGarden(env, userId, gardenId) : null;
  const currentConfig = current ? parseConfig(current.config_json) || undefined : undefined;
  const config = normalizeConfig(body, currentConfig);
  const rec = asRecord(body);
  const deployTarget = normalizeDeployTarget(rec.deploy_target ?? rec.deployTarget,
    current?.deploy_target || (config.source.mode === "github" ? "manual" : "cloudflare_pages"));
  const ts = now();

  if (!current) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM gardens WHERE user_id=?")
      .bind(userId).first<{ count: number }>();
    if ((Number(count?.count) || 0) >= MAX_GARDENS_PER_USER) {
      throw new GardenError(429, `활성 Garden은 사용자당 ${MAX_GARDENS_PER_USER}개까지 만들 수 있습니다.`, "garden_limit_exceeded");
    }
  }

  if (current) {
    config.site.baseUrl = generatedBaseUrl(env, config, current.id, deployTarget);
    await env.DB.prepare(
      `UPDATE gardens
       SET repo=?, title=?, config_json=?, deploy_target=?, status=?, updated_at=?
       WHERE id=? AND user_id=?`
    ).bind(config.source.repo, config.site.title, JSON.stringify(config), deployTarget, "draft", ts, current.id, userId).run();
    return getGarden(env, userId, current.id);
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM gardens WHERE user_id=? AND repo=?"
  ).bind(userId, config.source.repo).first<{ id: string }>();
  if (existing?.id) {
    config.site.baseUrl = generatedBaseUrl(env, config, existing.id, deployTarget);
    await env.DB.prepare(
      `UPDATE gardens
       SET title=?, config_json=?, deploy_target=?, status=?, updated_at=?
       WHERE id=? AND user_id=?`
    ).bind(config.site.title, JSON.stringify(config), deployTarget, "draft", ts, existing.id, userId).run();
    return getGarden(env, userId, existing.id);
  }

  const id = crypto.randomUUID();
  config.site.baseUrl = generatedBaseUrl(env, config, id, deployTarget);
  await env.DB.prepare(
    `INSERT INTO gardens (id, user_id, repo, title, config_json, deploy_target, status, site_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, config.source.repo, config.site.title, JSON.stringify(config), deployTarget, "draft", null, ts, ts).run();
  return getGarden(env, userId, id);
}

function isUploadedGardenAsset(value: unknown): value is UploadedGardenAsset {
  return !!value && typeof value === "object"
    && typeof (value as { name?: unknown }).name === "string"
    && typeof (value as { size?: unknown }).size === "number"
    && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function";
}

async function gardenLogoRow(env: Env, userId: string, gardenId: string): Promise<GardenAssetRow | null> {
  return await env.DB.prepare(
    `SELECT id, garden_id, user_id, kind, name, type, size, r2_key, created_at
     FROM garden_assets WHERE garden_id=? AND user_id=? AND kind='logo'`
  ).bind(gardenId, userId).first<GardenAssetRow>();
}

export async function saveGardenLogoFromRequest(env: Env, userId: string, gardenId: string, request: Request) {
  invalidateGardenCache(userId, gardenId);
  const garden = await requireGarden(env, userId, gardenId);
  const form = await request.formData();
  const file = form.get("logo");
  if (!isUploadedGardenAsset(file) || file.size <= 0) throw new GardenError(400, "Logo file is required.", "logo_required");
  if (file.size > MAX_GARDEN_LOGO_BYTES) throw new GardenError(413, "Logo must be 4 MB or smaller.", "logo_too_large");
  if (!GARDEN_LOGO_TYPES.has(file.type || "")) throw new GardenError(400, "Unsupported logo type.", "invalid_logo_type");
  const previous = await gardenLogoRow(env, userId, gardenId);
  if (previous) await env.R2.delete(previous.r2_key);
  const id = crypto.randomUUID();
  const name = normalizeOptionalText(file.name, 180) || "garden-logo";
  const r2Key = `gardens/${safeKey(userId)}/${gardenId}/assets/${id}/${safeKey(name)}`;
  await env.R2.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  await env.DB.prepare("DELETE FROM garden_assets WHERE garden_id=? AND user_id=? AND kind='logo'").bind(gardenId, userId).run();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO garden_assets (id, garden_id, user_id, kind, name, type, size, r2_key, created_at)
     VALUES (?, ?, ?, 'logo', ?, ?, ?, ?, ?)`
  ).bind(id, gardenId, userId, name, file.type || null, file.size, r2Key, ts).run();
  const config = parseConfig(garden.config_json) || normalizeConfig({ repo: garden.repo, title: garden.title });
  config.site.logo = `/api/gardens/${gardenId}/logo`;
  await env.DB.prepare("UPDATE gardens SET config_json=?, updated_at=? WHERE id=? AND user_id=?")
    .bind(JSON.stringify(config), ts, gardenId, userId).run();
  return { logo: { id, name, type: file.type || null, size: file.size, url: config.site.logo }, garden: (await getGarden(env, userId, gardenId)).garden };
}

export async function getGardenLogoResponse(env: Env, userId: string, gardenId: string): Promise<Response> {
  await requireGarden(env, userId, gardenId);
  const row = await gardenLogoRow(env, userId, gardenId);
  if (!row) throw new GardenError(404, "Garden logo was not found.", "logo_not_found");
  const object = await env.R2.get(row.r2_key);
  if (!object) throw new GardenError(404, "Stored Garden logo was not found.", "logo_object_not_found");
  return new Response(object.body, { headers: { "content-type": row.type || "application/octet-stream", "cache-control": "private, max-age=300" } });
}

export async function deleteGardenLogo(env: Env, userId: string, gardenId: string) {
  invalidateGardenCache(userId, gardenId);
  const garden = await requireGarden(env, userId, gardenId);
  const row = await gardenLogoRow(env, userId, gardenId);
  if (row) await env.R2.delete(row.r2_key);
  await env.DB.prepare("DELETE FROM garden_assets WHERE garden_id=? AND user_id=? AND kind='logo'").bind(gardenId, userId).run();
  const config = parseConfig(garden.config_json) || normalizeConfig({ repo: garden.repo, title: garden.title });
  config.site.logo = "";
  await env.DB.prepare("UPDATE gardens SET config_json=?, updated_at=? WHERE id=? AND user_id=?")
    .bind(JSON.stringify(config), now(), gardenId, userId).run();
  return { ok: true, garden: (await getGarden(env, userId, gardenId)).garden };
}

export async function createGardenBuild(env: Env, userId: string, gardenId: string, force = false): Promise<unknown> {
  invalidateGardenCache(userId, gardenId);
  const garden = await requireGarden(env, userId, gardenId);
  const config = parseConfig(garden.config_json) || normalizeConfig({ repo: garden.repo, title: garden.title });
  const fingerprint = await gardenBuildFingerprint(env, garden, config);
  const flightKey = `${userId}:${gardenId}:${fingerprint}`;
  const flight = buildFlights.get(flightKey);
  if (!force && flight && flight.expiresAt > Date.now()) return flight.promise;
  const promise = createGardenBuildPrepared(env, userId, garden, config, fingerprint, force);
  buildFlights.set(flightKey, { promise, expiresAt: Date.now() + 60_000 });
  const cleanup = () => setTimeout(() => {
    if (buildFlights.get(flightKey)?.promise === promise) buildFlights.delete(flightKey);
  }, 60_000);
  void promise.then(cleanup, cleanup);
  return promise;
}

async function createGardenBuildPrepared(env: Env, userId: string, garden: GardenRow, config: GardenConfig, fingerprint: string, force: boolean) {
  const active = await env.DB.prepare(
    `SELECT id, garden_id, user_id, status, message, error_message, artifact_url, site_url, started_at, finished_at, build_fingerprint, builder_version, pages_project_name
     FROM garden_builds WHERE garden_id=? AND user_id=? AND status IN ('queued','running') ORDER BY started_at DESC LIMIT 1`
  ).bind(garden.id, userId).first<GardenBuildRow>();
  if (!force && active?.build_fingerprint === fingerprint) {
    return { build: buildForApi(active), garden: (await getGarden(env, userId, garden.id)).garden, reused: true };
  }
  if (active) throw new GardenError(409, "이미 대기 중이거나 실행 중인 빌드가 있습니다.", "garden_build_active");
  const id = crypto.randomUUID();
  const ts = now();
  if (!force) {
    const succeeded = await env.DB.prepare(
       `SELECT id, garden_id, user_id, status, message, error_message, artifact_url, site_url, started_at, finished_at, build_fingerprint, builder_version, pages_project_name
       FROM garden_builds WHERE garden_id=? AND user_id=? AND build_fingerprint=? AND status='succeeded' AND site_url IS NOT NULL ORDER BY finished_at DESC LIMIT 1`
    ).bind(garden.id, userId, fingerprint).first<GardenBuildRow>();
    if (succeeded?.site_url && /^https?:\/\//i.test(succeeded.site_url)) {
      return { build: buildForApi(succeeded), garden: (await getGarden(env, userId, garden.id)).garden, reused: true };
    }
  }
  const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const daily = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM garden_builds WHERE user_id=? AND started_at>=?"
  ).bind(userId, dayStart).first<{ count: number }>();
  if ((Number(daily?.count) || 0) >= MAX_DAILY_BUILDS_PER_USER) {
    throw new GardenError(429, `Garden 배포는 하루 ${MAX_DAILY_BUILDS_PER_USER}회까지 요청할 수 있습니다.`, "garden_build_limit_exceeded");
  }
  const configYaml = gardenConfigYaml(config);
  const manifestUrl = buildArtifactUrl(garden.id, id, "manifest");
  const configUrl = buildArtifactUrl(garden.id, id, "config");
  const runnerManifestUrl = runnerBuildArtifactUrl(garden.id, id, "manifest");
  const runnerConfigUrl = runnerBuildArtifactUrl(garden.id, id, "config");
  const callbackUrl = buildCallbackUrl(garden.id, id);
  const contentPackage = await contentPackageForGarden(env, garden, config);
  const contentJson = JSON.stringify(contentPackage, null, 2);
  const contentSha256 = await sha256Hex(contentJson);
  const runnerContentUrl = runnerBuildArtifactUrl(garden.id, id, "content");
  const manifest = buildManifest(garden, id, config, ts, runnerManifestUrl, runnerConfigUrl, callbackUrl, runnerContentUrl, contentSha256);
  const message = "Build package saved to R2 and queued for the Quartz build-garden runner.";

  await env.R2.put(buildArtifactKey(userId, garden.id, id, "config"), configYaml, {
    httpMetadata: { contentType: "text/yaml; charset=utf-8" },
  });
  await env.R2.put(buildArtifactKey(userId, garden.id, id, "manifest"), JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  await env.R2.put(buildArtifactKey(userId, garden.id, id, "content"), contentJson, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });

  const inserted = await env.DB.prepare(
    `INSERT INTO garden_builds (id, garden_id, user_id, status, message, artifact_url, site_url, started_at, package_sha256, build_fingerprint, builder_version)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM garden_builds
       WHERE garden_id=? AND user_id=? AND status IN ('queued', 'running')
     )`
  ).bind(id, garden.id, userId, "queued", message, manifestUrl, garden.site_url, ts, contentSha256, fingerprint, GARDEN_BUILDER_VERSION, garden.id, userId).run();
  if (!inserted.meta.changes) {
    const concurrent = await env.DB.prepare(
      `SELECT id, garden_id, user_id, status, message, error_message, artifact_url, site_url, started_at, finished_at, pages_project_name
       FROM garden_builds
       WHERE garden_id=? AND user_id=? AND status IN ('queued', 'running')
       ORDER BY started_at DESC LIMIT 1`
    ).bind(garden.id, userId).first<GardenBuildRow>();
    if (concurrent) return { build: buildForApi(concurrent), garden: (await getGarden(env, userId, garden.id)).garden, reused: true };
  }
  await env.DB.prepare(
    "UPDATE gardens SET status=?, last_build_at=?, updated_at=? WHERE id=? AND user_id=?"
  ).bind("queued", ts, ts, garden.id, userId).run();
  const build = await env.DB.prepare(
    `SELECT id, garden_id, user_id, status, message, error_message, artifact_url, site_url, started_at, finished_at, pages_project_name
     FROM garden_builds
     WHERE id=? AND user_id=?`
  ).bind(id, userId).first<GardenBuildRow>();
  return { build: build ? buildForApi(build) : null, garden: (await getGarden(env, userId, garden.id)).garden };
}

export async function listGardenBuilds(env: Env, userId: string, gardenId: string, limit = 20) {
  await requireGarden(env, userId, gardenId);
  const n = Math.min(50, Math.max(1, limit));
  const cacheKey = `builds:${userId}:${gardenId}:${n}`;
  const cached = gardenReadCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as { builds: ReturnType<typeof buildForApi>[] };
  const { results } = await env.DB.prepare(
    `SELECT id, garden_id, user_id, status, message, error_message, artifact_url, site_url, started_at, finished_at, pages_project_name
     FROM garden_builds
     WHERE garden_id=? AND user_id=?
     ORDER BY started_at DESC
     LIMIT ?`
  ).bind(gardenId, userId, n).all<GardenBuildRow>();
  const value = { builds: (results || []).map(buildForApi) };
  if (!value.builds.some((build) => build.status === "queued" || build.status === "running")) gardenReadCache.set(cacheKey, { value, expiresAt: Date.now() + 3_000 });
  return value;
}

export async function deleteGardenBuild(env: Env, userId: string, gardenId: string, buildId: string) {
  invalidateGardenCache(userId, gardenId);
  await requireGarden(env, userId, gardenId);
  const build = await env.DB.prepare("SELECT id FROM garden_builds WHERE id=? AND garden_id=? AND user_id=?")
    .bind(buildId, gardenId, userId).first<{ id: string }>();
  if (!build) throw new GardenError(404, "Garden build was not found.", "garden_build_not_found");
  await Promise.all([
    env.R2.delete(buildArtifactKey(userId, gardenId, buildId, "config")),
    env.R2.delete(buildArtifactKey(userId, gardenId, buildId, "manifest")),
    env.R2.delete(buildArtifactKey(userId, gardenId, buildId, "content")),
    env.R2.delete(buildArtifactKey(userId, gardenId, buildId, "result")),
  ]);
  await env.DB.prepare("DELETE FROM garden_builds WHERE id=? AND garden_id=? AND user_id=?")
    .bind(buildId, gardenId, userId).run();
  const latest = await env.DB.prepare("SELECT status, site_url, started_at FROM garden_builds WHERE garden_id=? AND user_id=? ORDER BY started_at DESC LIMIT 1")
    .bind(gardenId, userId).first<{ status: string; site_url: string | null; started_at: string }>();
  await env.DB.prepare("UPDATE gardens SET status=?, site_url=COALESCE(?, site_url), last_build_at=?, updated_at=? WHERE id=? AND user_id=?")
    .bind(latest?.status || "draft", latest?.site_url || null, latest?.started_at || null, now(), gardenId, userId).run();
  return { ok: true, id: buildId, garden: (await getGarden(env, userId, gardenId)).garden };
}

export async function gardenConfigResponse(env: Env, userId: string, gardenId: string): Promise<Response> {
  const garden = await requireGarden(env, userId, gardenId);
  const config = parseConfig(garden.config_json) || normalizeConfig({ repo: garden.repo, title: garden.title });
  return new Response(gardenConfigYaml(config), {
    headers: {
      "content-type": "text/yaml; charset=utf-8",
      "content-disposition": `attachment; filename="garden.config.yaml"`,
      "cache-control": "no-store",
    },
  });
}

export async function gardenBuildArtifactResponse(
  env: Env,
  userId: string,
  gardenId: string,
  buildId: string,
  file: string | null
): Promise<Response> {
  await requireGarden(env, userId, gardenId);
  const artifactFile: GardenBuildArtifactFile = file === "config" ? "config" : file === "content" ? "content" : file === "result" ? "result" : "manifest";
  const row = await env.DB.prepare(
    `SELECT id, garden_id, user_id, status, message, error_message, artifact_url, site_url, started_at, finished_at, pages_project_name
     FROM garden_builds
     WHERE id=? AND garden_id=? AND user_id=?`
  ).bind(buildId, gardenId, userId).first<GardenBuildRow>();
  if (!row) throw new GardenError(404, "Garden build artifact was not found.", "garden_build_not_found");

  const object = await env.R2.get(buildArtifactKey(userId, gardenId, buildId, artifactFile));
  if (!object) throw new GardenError(404, "Stored garden build artifact was not found.", "garden_artifact_not_found");

  const filename = artifactFile === "config" ? "garden.config.yaml" : artifactFile === "content" ? "content-package.json" : artifactFile === "result" ? "result.json" : "manifest.json";
  const contentType = artifactFile === "config" ? "text/yaml; charset=utf-8" : "application/json; charset=utf-8";
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

export async function gardenRunnerArtifactResponse(
  env: Env,
  request: Request,
  gardenId: string,
  buildId: string,
  file: string | null
): Promise<Response> {
  await requireRunnerToken(env, request);
  const artifactFile: GardenBuildArtifactFile = file === "config" ? "config" : file === "content" ? "content" : file === "result" ? "result" : "manifest";
  const row = await env.DB.prepare(
    `SELECT id, garden_id, user_id, status, message, error_message, artifact_url, site_url, started_at, finished_at, pages_project_name
     FROM garden_builds
     WHERE id=? AND garden_id=?`
  ).bind(buildId, gardenId).first<GardenBuildRow>();
  if (!row) throw new GardenError(404, "Garden build artifact was not found.", "garden_build_not_found");

  const object = await env.R2.get(buildArtifactKey(row.user_id, gardenId, buildId, artifactFile));
  if (!object) throw new GardenError(404, "Stored garden build artifact was not found.", "garden_artifact_not_found");

  const filename = artifactFile === "config" ? "garden.config.yaml" : artifactFile === "content" ? "content-package.json" : artifactFile === "result" ? "result.json" : "manifest.json";
  const contentType = artifactFile === "config" ? "text/yaml; charset=utf-8" : "application/json; charset=utf-8";
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

export async function claimNextGardenBuild(env: Env, request: Request) {
  await requireRunnerToken(env, request);
  const body = asRecord(await request.json().catch(() => ({})));
  const requestedTarget = normalizeDeployTarget(body.deploy_target ?? body.deployTarget, "manual");
  const hasTargetFilter = body.deploy_target || body.deployTarget;
  const row = hasTargetFilter
    ? await env.DB.prepare(
      `SELECT b.id, b.garden_id, b.user_id, b.status, b.message, b.error_message, b.artifact_url, b.site_url, b.started_at, b.finished_at, b.pages_project_name
       FROM garden_builds b
       JOIN gardens g ON g.id=b.garden_id
       WHERE b.status='queued' AND g.deploy_target=?
       ORDER BY b.started_at ASC
       LIMIT 1`
    ).bind(requestedTarget).first<GardenBuildRow>()
    : await env.DB.prepare(
      `SELECT id, garden_id, user_id, status, message, error_message, artifact_url, site_url, started_at, finished_at, pages_project_name
       FROM garden_builds
       WHERE status='queued'
       ORDER BY started_at ASC
       LIMIT 1`
    ).first<GardenBuildRow>();

  if (!row) return { ok: true, build: null };

  const ts = now();
  await env.DB.prepare(
    `UPDATE garden_builds
     SET status='running', message=?, error_message=NULL
     WHERE id=? AND garden_id=? AND status='queued'`
  ).bind("Runner claimed the build and started processing.", row.id, row.garden_id).run();
  await env.DB.prepare(
    "UPDATE gardens SET status=?, updated_at=? WHERE id=? AND user_id=?"
  ).bind("running", ts, row.garden_id, row.user_id).run();

  const build = await env.DB.prepare(
    `SELECT id, garden_id, user_id, status, message, error_message, artifact_url, site_url, started_at, finished_at, pages_project_name
     FROM garden_builds
     WHERE id=? AND garden_id=?`
  ).bind(row.id, row.garden_id).first<GardenBuildRow>();

  return {
    ok: true,
    build: build ? buildForApi(build) : null,
    manifest_url: absoluteUrl(env, request, runnerBuildArtifactUrl(row.garden_id, row.id, "manifest")),
    config_url: absoluteUrl(env, request, runnerBuildArtifactUrl(row.garden_id, row.id, "config")),
    content_url: absoluteUrl(env, request, runnerBuildArtifactUrl(row.garden_id, row.id, "content")),
    callback_url: absoluteUrl(env, request, buildCallbackUrl(row.garden_id, row.id)),
  };
}

export async function updateGardenBuildFromRunner(
  env: Env,
  request: Request,
  gardenId: string,
  buildId: string
) {
  await requireRunnerToken(env, request);
  const body = asRecord(await request.json().catch(() => ({})));
  const status = normalizeBuildStatus(body.status);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT id, garden_id, user_id, status, message, error_message, artifact_url, site_url, started_at, finished_at, pages_project_name
     FROM garden_builds
     WHERE id=? AND garden_id=?`
  ).bind(buildId, gardenId).first<GardenBuildRow>();
  if (!row) throw new GardenError(404, "Garden build was not found.", "garden_build_not_found");
  invalidateGardenCache(row.user_id, gardenId);

  // Runner callbacks can arrive late or be retried. Never allow a stale callback
  // to move a terminal build back to queued/running (or flip succeeded/failed).
  if (!canAdvanceBuildStatus(row.status, status)) {
    const build = buildForApi(row);
    return { ok: true, build, ignored: true, reason: "stale_build_status" };
  }

  const message = normalizeOptionalText(body.message, 1000) || row.message || "";
  const errorMessage = normalizeErrorMessage(body.error_message ?? body.errorMessage);
  const siteUrl = normalizeOptionalText(body.site_url ?? body.siteUrl, 500) || row.site_url || null;
  let artifactUrl = normalizeOptionalText(body.artifact_url ?? body.artifactUrl, 500) || row.artifact_url || null;
  const resultManifest = body.result_manifest ?? body.resultManifest;
  const resultDeployment = asRecord(asRecord(resultManifest)?.deployment);
  const pagesProjectName = normalizeOptionalText(
    body.pages_project_name ?? body.pagesProjectName ?? resultDeployment?.project,
    120
  ) || row.pages_project_name || null;
  if (resultManifest && typeof resultManifest === "object") {
    await env.R2.put(
      buildArtifactKey(row.user_id, gardenId, buildId, "result"),
      JSON.stringify(resultManifest, null, 2),
      { httpMetadata: { contentType: "application/json; charset=utf-8" } }
    );
    artifactUrl = buildArtifactUrl(gardenId, buildId, "result");
  }
  const finishedAt = status === "succeeded" || status === "failed"
    ? normalizeOptionalText(body.finished_at ?? body.finishedAt, 80) || now
    : null;

  await env.DB.prepare(
    `UPDATE garden_builds
     SET status=?, message=?, error_message=?, artifact_url=?, site_url=?, pages_project_name=?, finished_at=?
     WHERE id=? AND garden_id=?`
  ).bind(status, message || null, errorMessage, artifactUrl, siteUrl, pagesProjectName, finishedAt, buildId, gardenId).run();

  await env.DB.prepare(
    "UPDATE gardens SET status=?, site_url=COALESCE(?, site_url), updated_at=? WHERE id=? AND user_id=?"
  ).bind(status, siteUrl, now, gardenId, row.user_id).run();

  const build = await env.DB.prepare(
    `SELECT id, garden_id, user_id, status, message, error_message, artifact_url, site_url, started_at, finished_at, pages_project_name
     FROM garden_builds
     WHERE id=? AND garden_id=?`
  ).bind(buildId, gardenId).first<GardenBuildRow>();
  return { ok: true, build: build ? buildForApi(build) : null };
}
