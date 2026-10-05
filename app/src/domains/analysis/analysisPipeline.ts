import type { AISettings } from "../../ai";
import {
  AnalysisError,
  generateAnalysisIdeas,
  generateAnalysisManual,
  generateAnalysisPlans,
  getAnalysisIndexStatus,
  latestOutputs,
  summarizeAnalysisFiles,
} from "./analysis";
import type { Env } from "../../env";

export const ANALYSIS_PIPELINE_STAGES = ["summary", "questions", "plans", "manual"] as const;
export type AnalysisPipelineStage = typeof ANALYSIS_PIPELINE_STAGES[number];
export type AnalysisPipelineSettings = Record<AnalysisPipelineStage, AISettings>;

interface AnalysisPipelineRunRow {
  id: string;
  session_id: string;
  user_id: string;
  status: "running" | "completed" | "failed";
  current_stage: AnalysisPipelineStage | null;
  completed_stages_json: string;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface PipelineStartOptions {
  docType?: "manual" | "memo";
}

interface ClaimedRun {
  run: AnalysisPipelineRunRow;
  claimed: boolean;
}

const encoder = new TextEncoder();
const ACTIVE_RUN_STALE_MS = 30 * 60 * 1000;
const SSE_RETRY_MS = 2500;

function parseCompletedStages(raw: string): AnalysisPipelineStage[] {
  try {
    const values = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is AnalysisPipelineStage =>
      typeof value === "string" && ANALYSIS_PIPELINE_STAGES.includes(value as AnalysisPipelineStage)
    );
  } catch {
    return [];
  }
}

function publicRun(row: AnalysisPipelineRunRow | null) {
  if (!row) {
    return {
      run_id: null,
      status: "idle",
      current_stage: null,
      completed_stages: [] as AnalysisPipelineStage[],
      progress: { completed: 0, total: ANALYSIS_PIPELINE_STAGES.length, percent: 0 },
      error: null,
      started_at: null,
      updated_at: null,
      completed_at: null,
    };
  }
  const completedStages = parseCompletedStages(row.completed_stages_json);
  return {
    run_id: row.id,
    status: row.status,
    current_stage: row.current_stage,
    completed_stages: completedStages,
    progress: {
      completed: completedStages.length,
      total: ANALYSIS_PIPELINE_STAGES.length,
      percent: Math.round((completedStages.length / ANALYSIS_PIPELINE_STAGES.length) * 100),
    },
    error: row.error_message ? { code: row.error_code || "analysis_pipeline_failed", message: row.error_message } : null,
    started_at: row.started_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}

async function latestRun(env: Env, userId: string, sessionId: string): Promise<AnalysisPipelineRunRow | null> {
  return env.DB.prepare(
    `SELECT id, session_id, user_id, status, current_stage, completed_stages_json,
            error_code, error_message, started_at, updated_at, completed_at
     FROM analysis_pipeline_runs
     WHERE session_id=? AND user_id=?
     ORDER BY updated_at DESC
     LIMIT 1`
  ).bind(sessionId, userId).first<AnalysisPipelineRunRow>();
}

async function claimPipelineRun(env: Env, userId: string, sessionId: string): Promise<ClaimedRun> {
  // 세션 소유권과 인덱싱 상태를 함께 검증한다. pending/failed이면 409를 그대로 반환한다.
  const indexing = await getAnalysisIndexStatus(env, userId, sessionId);
  if (indexing.index_status !== "done" && indexing.index_status !== "idle") {
    throw new AnalysisError(
      409,
      indexing.index_status === "failed"
        ? "일부 분석파일 인덱싱에 실패했습니다. 상태를 확인한 뒤 다시 시도하세요."
        : "분석파일 인덱싱이 진행 중입니다. 잠시 후 다시 시도하세요.",
      indexing.index_status === "failed" ? "analysis_index_failed" : "analysis_index_pending",
      { indexing },
    );
  }

  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - ACTIVE_RUN_STALE_MS).toISOString();
  await env.DB.prepare(
    `UPDATE analysis_pipeline_runs
     SET status='failed', error_code='analysis_pipeline_stale',
         error_message='이전 분석 실행이 중단되어 새 실행으로 전환할 수 있습니다.',
         updated_at=?, completed_at=?
     WHERE session_id=? AND user_id=? AND status='running' AND updated_at<?`
  ).bind(now, now, sessionId, userId, staleBefore).run();

  const runId = crypto.randomUUID();
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO analysis_pipeline_runs
       (id, session_id, user_id, status, current_stage, completed_stages_json,
        error_code, error_message, started_at, updated_at, completed_at)
     VALUES (?, ?, ?, 'running', NULL, '[]', NULL, NULL, ?, ?, NULL)`
  ).bind(runId, sessionId, userId, now, now).run();

  if (Number(inserted.meta.changes || 0)) {
    const run = await latestRun(env, userId, sessionId);
    if (!run) throw new Error("분석 파이프라인 실행 상태를 만들지 못했습니다.");
    return { run, claimed: true };
  }

  const active = await env.DB.prepare(
    `SELECT id, session_id, user_id, status, current_stage, completed_stages_json,
            error_code, error_message, started_at, updated_at, completed_at
     FROM analysis_pipeline_runs
     WHERE session_id=? AND user_id=? AND status='running'
     ORDER BY updated_at DESC
     LIMIT 1`
  ).bind(sessionId, userId).first<AnalysisPipelineRunRow>();
  if (!active) throw new AnalysisError(409, "분석 실행 상태가 변경되었습니다. 다시 시도하세요.", "analysis_pipeline_conflict");
  return { run: active, claimed: false };
}

async function updateRunStage(
  env: Env,
  runId: string,
  stage: AnalysisPipelineStage,
  completedStages: AnalysisPipelineStage[],
): Promise<void> {
  await env.DB.prepare(
    `UPDATE analysis_pipeline_runs
     SET current_stage=?, completed_stages_json=?, updated_at=?
     WHERE id=? AND status='running'`
  ).bind(stage, JSON.stringify(completedStages), new Date().toISOString(), runId).run();
}

async function completeRun(env: Env, runId: string, completedStages: AnalysisPipelineStage[]): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE analysis_pipeline_runs
     SET status='completed', current_stage=NULL, completed_stages_json=?,
         error_code=NULL, error_message=NULL, updated_at=?, completed_at=?
     WHERE id=? AND status='running'`
  ).bind(JSON.stringify(completedStages), now, now, runId).run();
}

function publicPipelineError(error: unknown): { code: string; message: string } {
  if (error instanceof AnalysisError) {
    return { code: error.code || "analysis_pipeline_failed", message: error.message.slice(0, 600) };
  }
  return { code: "analysis_pipeline_failed", message: "분석 단계 실행에 실패했습니다. 잠시 후 다시 시도하세요." };
}

async function failRun(env: Env, runId: string, error: unknown): Promise<{ code: string; message: string }> {
  const safe = publicPipelineError(error);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE analysis_pipeline_runs
     SET status='failed', error_code=?, error_message=?, updated_at=?, completed_at=?
     WHERE id=? AND status='running'`
  ).bind(safe.code, safe.message, now, now, runId).run();
  return safe;
}

function stageAnswers(ideas: unknown): { question: string; answer: string; assumed: true }[] {
  if (!ideas || typeof ideas !== "object") return [];
  const questions = (ideas as { questions?: unknown }).questions;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const question = typeof (value as { question?: unknown }).question === "string"
      ? (value as { question: string }).question.trim()
      : "";
    const options = (value as { options?: unknown }).options;
    const answer = Array.isArray(options) && typeof options[0] === "string" ? options[0].trim() : "";
    return question && answer ? [{ question, answer, assumed: true as const }] : [];
  });
}

function sseChunk(event: string, data: unknown, id?: string): Uint8Array {
  return encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function streamHeaders(): Headers {
  return new Headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  });
}

export async function getAnalysisPipelineStatus(env: Env, userId: string, sessionId: string) {
  const [indexing, outputs, run] = await Promise.all([
    getAnalysisIndexStatus(env, userId, sessionId),
    latestOutputs(env, userId, sessionId),
    latestRun(env, userId, sessionId),
  ]);
  return {
    session_id: sessionId,
    pipeline: publicRun(run),
    indexing: {
      status: indexing.index_status,
      counts: indexing.counts,
      files: indexing.files,
    },
    outputs,
  };
}

export async function createAnalysisPipelineStream(
  env: Env,
  userId: string,
  sessionId: string,
  settings: AnalysisPipelineSettings,
  options: PipelineStartOptions,
  ctx: ExecutionContext,
): Promise<Response> {
  const claimed = await claimPipelineRun(env, userId, sessionId);
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let writable = true;
  let sequence = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      value.enqueue(encoder.encode(`retry: ${SSE_RETRY_MS}\n\n`));
    },
    cancel() {
      writable = false;
    },
  });
  const send = (event: string, data: unknown) => {
    if (!writable || !controller) return;
    try {
      sequence += 1;
      controller.enqueue(sseChunk(event, data, `${claimed.run.id}:${sequence}`));
    } catch {
      writable = false;
    }
  };
  const close = () => {
    if (!writable || !controller) return;
    try { controller.close(); } catch { /* 연결 종료 후 파이프라인은 계속 처리한다. */ }
    writable = false;
  };

  if (!claimed.claimed) {
    send("snapshot", { type: "pipeline_snapshot", pipeline: publicRun(claimed.run) });
    close();
    return new Response(stream, { status: 200, headers: streamHeaders() });
  }

  const run = async () => {
    const completed: AnalysisPipelineStage[] = [];
    let ideas: unknown = null;
    try {
      send("pipeline", { type: "pipeline_started", pipeline: publicRun(claimed.run) });
      for (const [index, stage] of ANALYSIS_PIPELINE_STAGES.entries()) {
        await updateRunStage(env, claimed.run.id, stage, completed);
        send("stage", {
          type: "stage_started",
          stage,
          index: index + 1,
          total: ANALYSIS_PIPELINE_STAGES.length,
          progress: Math.round((completed.length / ANALYSIS_PIPELINE_STAGES.length) * 100),
        });

        let output: unknown;
        if (stage === "summary") {
          output = await summarizeAnalysisFiles(env, userId, sessionId, {}, settings.summary);
        } else if (stage === "questions") {
          output = await generateAnalysisIdeas(env, userId, sessionId, {}, settings.questions);
          ideas = output;
        } else if (stage === "plans") {
          output = await generateAnalysisPlans(env, userId, sessionId, { answers: stageAnswers(ideas) }, settings.plans);
        } else {
          output = await generateAnalysisManual(env, userId, sessionId, { docType: options.docType || "manual" }, settings.manual);
        }

        completed.push(stage);
        await updateRunStage(env, claimed.run.id, stage, completed);
        send("stage", {
          type: "stage_completed",
          stage,
          index: index + 1,
          total: ANALYSIS_PIPELINE_STAGES.length,
          progress: Math.round((completed.length / ANALYSIS_PIPELINE_STAGES.length) * 100),
          output,
        });
      }
      await completeRun(env, claimed.run.id, completed);
      send("complete", {
        type: "pipeline_completed",
        run_id: claimed.run.id,
        completed_stages: completed,
        progress: 100,
      });
      console.log(JSON.stringify({ event: "analysis_pipeline_completed", run_id: claimed.run.id, session_id: sessionId }));
    } catch (error) {
      const safe = await failRun(env, claimed.run.id, error);
      send("failed", {
        type: "pipeline_failed",
        run_id: claimed.run.id,
        stage: ANALYSIS_PIPELINE_STAGES[completed.length] || null,
        completed_stages: completed,
        error: safe,
      });
      console.error(JSON.stringify({
        event: "analysis_pipeline_failed",
        run_id: claimed.run.id,
        session_id: sessionId,
        stage: ANALYSIS_PIPELINE_STAGES[completed.length] || null,
        error_code: safe.code,
      }));
    } finally {
      close();
    }
  };

  ctx.waitUntil(run());
  return new Response(stream, { status: 200, headers: streamHeaders() });
}
