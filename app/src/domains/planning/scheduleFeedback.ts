import type { Env } from "../../env";
import { addIssueComment, createIssue } from "../../git";
import { gitDefaultsForApi } from "../../settings";

const DEFAULT_FEEDBACK_REPO = "feed-mina/planning-harness";
const MAX_FILES_PER_UPLOAD = 5;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

const CARDS = [
  {
    id: "daily-schedule",
    title: "오늘 일정 카드",
    description: "마이페이지에서 확인하는 오늘 일정과 후속 작업에 대한 의견을 GitHub 이슈로 남깁니다.",
    issue_title: "[마이페이지] 오늘 일정 카드 피드백",
    tags: ["일정", "피드백"],
  },
  {
    id: "time-blocks",
    title: "반복/날짜별 시간 블록",
    description: "기본 근무 시간, 반복 요일, 날짜별 가능/바쁨 블록에 대한 보완 사항을 모읍니다.",
    issue_title: "[시간 설정] 반복/날짜별 시간 블록 피드백",
    tags: ["시간설정", "반복일정"],
  },
  {
    id: "calendar-alerts",
    title: "Google Calendar/Kakao 알림",
    description: "캘린더 등록과 카카오 메시지 알림 연결에 필요한 확인 사항을 기록합니다.",
    issue_title: "[연동] Google Calendar/Kakao 일정 알림 피드백",
    tags: ["Google Calendar", "Kakao"],
  },
  {
    id: "materials",
    title: "자료별 불러오기/등록",
    description: "일정 카드별 참고 파일을 R2에 보관하고, 필요할 때 다시 불러옵니다.",
    issue_title: "[자료] 일정 카드 자료 등록/불러오기",
    tags: ["자료", "R2"],
  },
] as const;

type ScheduleCardId = typeof CARDS[number]["id"];

interface CountRow {
  card_id: string;
  count: number;
  latest_at?: string | null;
}

interface LatestIssueRow {
  card_id: string;
  repo: string;
  issue_number: number;
  issue_title?: string | null;
  github_issue_url?: string | null;
  created_at: string;
}

function cardById(cardId: string) {
  return CARDS.find((card) => card.id === cardId) || null;
}

function cardInfo(cardId: string, fallbackTitle?: string) {
  const known = cardById(cardId);
  if (known) return known;
  const title = (fallbackTitle || "스케줄 카드").trim().slice(0, 160);
  return {
    id: cardId as ScheduleCardId,
    title,
    description: "마이페이지 스케줄 보드에서 등록한 피드백입니다.",
    issue_title: `[마이페이지 스케줄] ${title}`,
    tags: ["스케줄", "피드백"],
  };
}

function sanitizeCardId(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/i.test(value)) throw Object.assign(new Error("지원하지 않는 일정 카드입니다."), { status: 400 });
  return value;
}

function sanitizeRepo(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(value)) throw Object.assign(new Error("repo는 owner/name 형식이어야 합니다."), { status: 400 });
  return value;
}

function sanitizeIssueNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw Object.assign(new Error("issueNumber는 1 이상의 정수여야 합니다."), { status: 400 });
  return n;
}

function safeName(name: string): string {
  return (name || "file")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "file";
}

function safeKey(value: string): string {
  return String(value || "")
    .replace(/^anon:/, "anon-")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "unknown";
}

function isFileEntry(value: unknown): value is File {
  return typeof value === "object" && value !== null &&
    "name" in value && typeof value.name === "string" &&
    "arrayBuffer" in value && typeof value.arrayBuffer === "function";
}

function assetUrl(env: Env, id: string): string {
  const base = (env.APP_BASE_URL || "").replace(/\/+$/, "");
  return `${base || ""}/api/schedule/assets/${encodeURIComponent(id)}`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function countByCard(env: Env, userId: string, table: "schedule_feedback_assets" | "schedule_feedback_entries") {
  const { results } = await env.DB.prepare(
    `SELECT card_id, COUNT(*) AS count, MAX(created_at) AS latest_at
     FROM ${table}
     WHERE user_id=?
     GROUP BY card_id`
  ).bind(userId).all<CountRow>();
  return new Map((results || []).map((row) => [row.card_id, row]));
}

async function latestIssueByCard(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT card_id, repo, issue_number, issue_title, github_issue_url, created_at
     FROM schedule_feedback_entries
     WHERE user_id=? AND issue_number IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 100`
  ).bind(userId).all<LatestIssueRow>();
  const out = new Map<string, LatestIssueRow>();
  for (const row of results || []) {
    if (!out.has(row.card_id)) out.set(row.card_id, row);
  }
  return out;
}

export async function listScheduleCards(env: Env, userId: string) {
  const defaults = await gitDefaultsForApi(env, userId);
  const repo = defaults.default_repo || DEFAULT_FEEDBACK_REPO;
  const [assetCounts, feedbackCounts] = await Promise.all([
    countByCard(env, userId, "schedule_feedback_assets"),
    countByCard(env, userId, "schedule_feedback_entries"),
  ]);
  const latestIssues = await latestIssueByCard(env, userId);

  return {
    default_repo: defaults.default_repo,
    repo,
    cards: CARDS.map((card) => {
      const latest = latestIssues.get(card.id);
      const linkedIssue = latest?.repo === repo ? latest : null;
      return {
        ...card,
        repo,
        issue_number: linkedIssue?.issue_number || null,
        issue_title: linkedIssue?.issue_title || card.issue_title,
        github_issue_url: linkedIssue?.github_issue_url || null,
        asset_count: assetCounts.get(card.id)?.count || 0,
        feedback_count: feedbackCounts.get(card.id)?.count || 0,
        latest_asset_at: assetCounts.get(card.id)?.latest_at || null,
        latest_feedback_at: feedbackCounts.get(card.id)?.latest_at || null,
      };
    }),
  };
}

export async function listScheduleAssets(env: Env, userId: string, url: URL) {
  const cardId = sanitizeCardId(url.searchParams.get("cardId") || "");
  const repo = url.searchParams.get("repo") ? sanitizeRepo(url.searchParams.get("repo")) : null;
  const issueNumber = sanitizeIssueNumber(url.searchParams.get("issueNumber"));
  const clauses = ["user_id=?", "card_id=?"];
  const binds: unknown[] = [userId, cardId];
  if (repo) { clauses.push("repo=?"); binds.push(repo); }
  if (issueNumber) { clauses.push("issue_number=?"); binds.push(issueNumber); }

  const { results } = await env.DB.prepare(
    `SELECT id, card_id, repo, issue_number, issue_title, name, type, size, created_at
     FROM schedule_feedback_assets
     WHERE ${clauses.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT 100`
  ).bind(...binds).all<any>();
  return {
    assets: (results || []).map((row) => ({
      ...row,
      download_url: `/api/schedule/assets/${encodeURIComponent(row.id)}`,
    })),
  };
}

export async function uploadScheduleAssets(env: Env, userId: string, request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_UPLOAD_BYTES) throw Object.assign(new Error(`업로드는 한 번에 ${fmtBytes(MAX_UPLOAD_BYTES)}까지 가능합니다.`), { status: 413 });

  const form = await request.formData();
  const cardId = sanitizeCardId(form.get("cardId"));
  const card = cardInfo(cardId, String(form.get("issueTitle") || ""));
  const repo = sanitizeRepo(form.get("repo") || DEFAULT_FEEDBACK_REPO);
  const issueNumber = sanitizeIssueNumber(form.get("issueNumber"));
  const issueTitle = String(form.get("issueTitle") || card.issue_title).trim().slice(0, 200);
  const entries = form.getAll("files") as unknown[];
  const files = entries.filter(isFileEntry);
  if (!files.length) throw Object.assign(new Error("업로드할 파일을 선택하세요."), { status: 400 });
  if (files.length > MAX_FILES_PER_UPLOAD) throw Object.assign(new Error(`한 번에 파일 ${MAX_FILES_PER_UPLOAD}개까지 등록할 수 있습니다.`), { status: 400 });

  let total = 0;
  const saved = [];
  for (const file of files) {
    if (!file.size) continue;
    if (file.size > MAX_FILE_BYTES) throw Object.assign(new Error(`파일 하나는 ${fmtBytes(MAX_FILE_BYTES)}까지 가능합니다: ${file.name}`), { status: 413 });
    total += file.size;
    if (total > MAX_UPLOAD_BYTES) throw Object.assign(new Error(`업로드는 한 번에 ${fmtBytes(MAX_UPLOAD_BYTES)}까지 가능합니다.`), { status: 413 });

    const id = crypto.randomUUID();
    const name = safeName(file.name);
    const type = file.type || "application/octet-stream";
    const issueKey = issueNumber ? `issue-${issueNumber}` : safeKey(issueTitle || "draft");
    const key = `schedule-feedback/${safeKey(userId)}/${safeKey(repo)}/${issueKey}/${safeKey(cardId)}/${id}/${name}`;
    await env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } });
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO schedule_feedback_assets
       (id, user_id, card_id, repo, issue_number, issue_title, name, type, size, r2_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, userId, cardId, repo, issueNumber, issueTitle || null, name, type, file.size, key, now).run();
    saved.push({
      id, card_id: cardId, repo, issue_number: issueNumber, issue_title: issueTitle,
      name, type, size: file.size, created_at: now, download_url: `/api/schedule/assets/${encodeURIComponent(id)}`,
    });
  }
  if (!saved.length) throw Object.assign(new Error("저장할 수 있는 파일이 없습니다."), { status: 400 });
  return { assets: saved, count: saved.length };
}

export async function getScheduleAsset(env: Env, userId: string, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT name, type, size, r2_key
     FROM schedule_feedback_assets
     WHERE id=? AND user_id=?`
  ).bind(id, userId).first<{ name: string; type?: string | null; size: number; r2_key: string }>();
  if (!row) return new Response(JSON.stringify({ error: "자료를 찾을 수 없습니다." }), { status: 404, headers: { "content-type": "application/json; charset=utf-8" } });
  const obj = await env.R2.get(row.r2_key);
  if (!obj) return new Response(JSON.stringify({ error: "R2 자료를 찾을 수 없습니다." }), { status: 404, headers: { "content-type": "application/json; charset=utf-8" } });
  const headers = new Headers();
  headers.set("content-type", row.type || obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set("content-length", String(row.size || obj.size || 0));
  headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.name || "file")}`);
  return new Response(obj.body, { headers });
}

export async function createScheduleFeedback(
  env: Env,
  userId: string,
  token: string,
  body: unknown,
  login?: string | null
) {
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const cardId = sanitizeCardId(data.cardId);
  const card = cardInfo(cardId, String(data.issueTitle || ""));
  const repo = sanitizeRepo(data.repo || DEFAULT_FEEDBACK_REPO);
  const issueNumber = sanitizeIssueNumber(data.issueNumber);
  const issueTitle = String(data.issueTitle || card.issue_title).trim().slice(0, 200) || card.issue_title;
  const message = String(data.message || "").trim().slice(0, 20000);
  if (!message) throw Object.assign(new Error("피드백 내용을 입력하세요."), { status: 400 });
  const assetIds = Array.isArray(data.assetIds) ? data.assetIds.map((id) => String(id || "")).filter(Boolean).slice(0, 20) : [];

  let assets: any[] = [];
  if (assetIds.length) {
    const placeholders = assetIds.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(
      `SELECT id, name, size, type
       FROM schedule_feedback_assets
       WHERE user_id=? AND id IN (${placeholders})
       ORDER BY created_at DESC`
    ).bind(userId, ...assetIds).all<any>();
    assets = results || [];
  }

  const assetBlock = assets.length
    ? "\n\n### 관련 자료\n" + assets.map((asset) =>
        `- [${asset.name}](${assetUrl(env, asset.id)}) (${fmtBytes(Number(asset.size || 0))})`
      ).join("\n")
    : "";
  const generatedBy = login ? `@${login}` : userId;
  const ghBody =
    `### 일정 카드 피드백\n\n` +
    `- 카드: ${card.title}\n` +
    `- 등록자: ${generatedBy}\n` +
    `- 원본 앱: ${env.APP_BASE_URL || ""}/mypage/?tab=schedule\n\n` +
    `${message}${assetBlock}\n\n---\n_기획 하네스 루프 마이페이지에서 등록_`;

  const [owner, name] = repo.split("/");
  let githubIssueUrl = "";
  let githubCommentUrl: string | null = null;
  let finalIssueNumber = issueNumber;

  if (issueNumber) {
    const comment = await addIssueComment(token, owner, name, issueNumber, ghBody);
    githubIssueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
    githubCommentUrl = comment.url;
  } else {
    const issue = await createIssue(token, owner, name, issueTitle, ghBody);
    finalIssueNumber = issue.number;
    githubIssueUrl = issue.url;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO schedule_feedback_entries
     (id, user_id, card_id, repo, issue_number, issue_title, body, github_issue_url, github_comment_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, cardId, repo, finalIssueNumber, issueTitle, message, githubIssueUrl, githubCommentUrl, now).run();

  if (assetIds.length && finalIssueNumber) {
    const placeholders = assetIds.map(() => "?").join(", ");
    await env.DB.prepare(
      `UPDATE schedule_feedback_assets
       SET issue_number=?, issue_title=?
       WHERE user_id=? AND id IN (${placeholders})`
    ).bind(finalIssueNumber, issueTitle, userId, ...assetIds).run();
  }

  return {
    id,
    repo,
    issue_number: finalIssueNumber,
    github_issue_url: githubIssueUrl,
    github_comment_url: githubCommentUrl,
    created_at: now,
  };
}
