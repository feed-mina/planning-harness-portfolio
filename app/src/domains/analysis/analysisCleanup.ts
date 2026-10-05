import { deleteSessionGraph } from "./graph";
import type { AnalysisCleanupJob } from "./analysisQueue";
import type { Env } from "../../env";
import { deleteSessionChunks } from "./rag";

const DEFAULT_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 3650;
const DISCOVERY_LIMIT = 100;
const ENQUEUE_LIMIT = 20;
const STALE_JOB_MS = 30 * 60 * 1000;

interface CleanupJobRow {
  session_id: string;
  user_id: string;
  status: string;
  attempts: number;
}

function retentionDays(env: Env): number {
  const value = Number(env.ANALYSIS_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
  return Math.min(MAX_RETENTION_DAYS, Math.max(1, Number.isFinite(value) ? Math.round(value) : DEFAULT_RETENTION_DAYS));
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "analysis cleanup failed");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:key|token|secret)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 600);
}

function retryAt(attempts: number): string {
  const exponent = Math.max(0, Math.min(6, Math.floor(attempts)));
  const delayMs = Math.min(5 * 60 * 1000 * (2 ** exponent), 6 * 60 * 60 * 1000);
  return new Date(Date.now() + delayMs).toISOString();
}

export async function scheduleAnalysisCleanup(env: Env): Promise<{ discovered: number; enqueued: number; failed: number }> {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - retentionDays(env) * 86400000).toISOString();
  const staleBefore = new Date(Date.now() - STALE_JOB_MS).toISOString();

  await env.DB.prepare(
    `UPDATE analysis_cleanup_jobs
     SET status='retry', next_attempt_at=?, updated_at=?, last_error='stale cleanup job recovered'
     WHERE status IN ('queueing', 'queued', 'processing') AND updated_at<?`
  ).bind(now, now, staleBefore).run();

  const oldSessions = await env.DB.prepare(
    `INSERT OR IGNORE INTO analysis_cleanup_jobs
       (session_id, user_id, status, attempts, last_error, next_attempt_at, created_at, updated_at, completed_at)
     SELECT id, user_id, 'pending', 0, NULL, ?, ?, ?, NULL
     FROM analysis_sessions
     WHERE updated_at<?
     ORDER BY updated_at ASC
     LIMIT ?`
  ).bind(now, now, now, cutoff, DISCOVERY_LIMIT).run();

  // 세션 행이 이미 사라졌지만 청크가 남은 경우도 같은 ID 기반 작업으로 수렴시킨다.
  const orphanChunks = await env.DB.prepare(
    `INSERT OR IGNORE INTO analysis_cleanup_jobs
       (session_id, user_id, status, attempts, last_error, next_attempt_at, created_at, updated_at, completed_at)
     SELECT c.session_id, c.user_id, 'pending', 0, NULL, ?, ?, ?, NULL
     FROM analysis_chunks c
     LEFT JOIN analysis_sessions s ON s.id=c.session_id AND s.user_id=c.user_id
     WHERE s.id IS NULL
     GROUP BY c.session_id, c.user_id
     LIMIT ?`
  ).bind(now, now, now, DISCOVERY_LIMIT).run();

  const { results } = await env.DB.prepare(
    `SELECT session_id, user_id, status, attempts
     FROM analysis_cleanup_jobs
     WHERE status IN ('pending', 'retry') AND COALESCE(next_attempt_at, '')<=?
     ORDER BY created_at ASC
     LIMIT ?`
  ).bind(now, ENQUEUE_LIMIT).all<CleanupJobRow>();

  let enqueued = 0;
  let failed = 0;
  for (const row of results || []) {
    const claimed = await env.DB.prepare(
      `UPDATE analysis_cleanup_jobs
       SET status='queueing', updated_at=?
       WHERE session_id=? AND user_id=? AND status IN ('pending', 'retry')`
    ).bind(new Date().toISOString(), row.session_id, row.user_id).run();
    if (!Number(claimed.meta.changes || 0)) continue;
    const job: AnalysisCleanupJob = {
      type: "analysis_cleanup",
      session_id: row.session_id,
      user_id: row.user_id,
    };
    try {
      await env.ANALYSIS_INDEX_QUEUE.send(job, { contentType: "json" });
      await env.DB.prepare(
        "UPDATE analysis_cleanup_jobs SET status='queued', last_error=NULL, updated_at=? WHERE session_id=? AND user_id=? AND status='queueing'"
      ).bind(new Date().toISOString(), row.session_id, row.user_id).run();
      enqueued += 1;
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      await env.DB.prepare(
        `UPDATE analysis_cleanup_jobs
         SET status='retry', attempts=?, last_error=?, next_attempt_at=?, updated_at=?
         WHERE session_id=? AND user_id=?`
      ).bind(attempts, safeErrorMessage(error), retryAt(attempts), new Date().toISOString(), row.session_id, row.user_id).run();
      failed += 1;
    }
  }

  const discovered = Number(oldSessions.meta.changes || 0) + Number(orphanChunks.meta.changes || 0);
  console.log(JSON.stringify({ service: "analysis-cleanup", event: "scheduled", discovered, enqueued, failed, retention_days: retentionDays(env) }));
  return { discovered, enqueued, failed };
}

export async function processAnalysisCleanupJob(
  env: Env,
  job: AnalysisCleanupJob,
  messageId: string,
  attempts: number,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_JOB_MS).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE analysis_cleanup_jobs
     SET status='processing', attempts=MAX(attempts, ?), last_error=NULL, updated_at=?
     WHERE session_id=? AND user_id=? AND status<>'completed'
       AND (status<>'processing' OR updated_at<?)`
  ).bind(Math.max(1, attempts), now, job.session_id, job.user_id, staleBefore).run();
  if (!Number(claimed.meta.changes || 0)) {
    const current = await env.DB.prepare(
      "SELECT status FROM analysis_cleanup_jobs WHERE session_id=? AND user_id=?"
    ).bind(job.session_id, job.user_id).first<{ status: string }>();
    return { status: current?.status === "completed" ? "already_done" : "busy" };
  }

  const [session, files] = await Promise.all([
    env.DB.prepare(
      "SELECT meeting_r2_key FROM analysis_sessions WHERE id=? AND user_id=?"
    ).bind(job.session_id, job.user_id).first<{ meeting_r2_key: string | null }>(),
    env.DB.prepare(
      "SELECT r2_key FROM analysis_files WHERE session_id=? AND user_id=?"
    ).bind(job.session_id, job.user_id).all<{ r2_key: string }>(),
  ]);
  const r2Keys = [...new Set(
    [...(files.results || []).map((row) => row.r2_key), session?.meeting_r2_key]
      .filter((value): value is string => typeof value === "string" && !!value)
  )];
  if (r2Keys.length) await env.R2.delete(r2Keys);

  // Vectorize 삭제가 실패하면 D1 청크를 남겨 큐 재시도로 다시 시도할 수 있게 한다.
  await deleteSessionChunks(env, job.user_id, job.session_id, { failOnVectorizeError: true });
  await deleteSessionGraph(env, job.user_id, job.session_id);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM analysis_outputs WHERE session_id=? AND user_id=?").bind(job.session_id, job.user_id),
    env.DB.prepare("DELETE FROM analysis_pipeline_runs WHERE session_id=? AND user_id=?").bind(job.session_id, job.user_id),
    env.DB.prepare("DELETE FROM analysis_files WHERE session_id=? AND user_id=?").bind(job.session_id, job.user_id),
    env.DB.prepare("DELETE FROM analysis_sessions WHERE id=? AND user_id=?").bind(job.session_id, job.user_id),
  ]);

  const completedAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE analysis_cleanup_jobs
     SET status='completed', last_error=NULL, updated_at=?, completed_at=?
     WHERE session_id=? AND user_id=? AND status='processing'`
  ).bind(completedAt, completedAt, job.session_id, job.user_id).run();
  return { status: "completed", r2_objects: r2Keys.length, message_id: messageId };
}

export async function markAnalysisCleanupRetry(
  env: Env,
  job: AnalysisCleanupJob,
  error: unknown,
  attempts: number,
): Promise<void> {
  const safeAttempts = Math.max(1, attempts);
  await env.DB.prepare(
    `UPDATE analysis_cleanup_jobs
     SET status='retry', attempts=MAX(attempts, ?), last_error=?, next_attempt_at=?, updated_at=?
     WHERE session_id=? AND user_id=? AND status<>'completed'`
  ).bind(
    safeAttempts,
    safeErrorMessage(error),
    retryAt(safeAttempts),
    new Date().toISOString(),
    job.session_id,
    job.user_id,
  ).run();
}

export async function markAnalysisCleanupFailed(
  env: Env,
  job: AnalysisCleanupJob,
  error: unknown,
  attempts: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE analysis_cleanup_jobs
     SET status='failed', attempts=MAX(attempts, ?), last_error=?, updated_at=?
     WHERE session_id=? AND user_id=? AND status<>'completed'`
  ).bind(
    Math.max(1, attempts),
    safeErrorMessage(error),
    new Date().toISOString(),
    job.session_id,
    job.user_id,
  ).run();
}
