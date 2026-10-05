import type { Env } from "../../env";
import {
  markAnalysisIndexFailed,
  markAnalysisIndexRetry,
  processAnalysisIndexJob,
} from "./analysis";
import {
  markAnalysisCleanupFailed,
  markAnalysisCleanupRetry,
  processAnalysisCleanupJob,
} from "./analysisCleanup";

export const ANALYSIS_INDEX_QUEUE_NAME = "harness-analysis-index";
export const ANALYSIS_INDEX_DLQ_NAME = "harness-analysis-index-dlq";

export function configuredAnalysisQueueNames(env: Pick<Env, "ANALYSIS_INDEX_QUEUE_NAME" | "ANALYSIS_INDEX_DLQ_NAME">): {
  queueName: string;
  dlqName: string;
} {
  return {
    queueName: env.ANALYSIS_INDEX_QUEUE_NAME?.trim() || ANALYSIS_INDEX_QUEUE_NAME,
    dlqName: env.ANALYSIS_INDEX_DLQ_NAME?.trim() || ANALYSIS_INDEX_DLQ_NAME,
  };
}

export interface AnalysisIndexJob {
  type: "analysis_index";
  session_id: string;
  user_id: string;
  file_id: string;
}

export interface AnalysisCleanupJob {
  type: "analysis_cleanup";
  session_id: string;
  user_id: string;
}

export type AnalysisQueueJob = AnalysisIndexJob | AnalysisCleanupJob;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedId(value: unknown, max = 160): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : "";
}

export function parseAnalysisIndexJob(value: unknown): AnalysisIndexJob | null {
  if (!isRecord(value) || value.type !== "analysis_index") return null;
  const sessionId = boundedId(value.session_id);
  const userId = boundedId(value.user_id, 240);
  const fileId = boundedId(value.file_id);
  if (!sessionId || !userId || !fileId) return null;
  return {
    type: "analysis_index",
    session_id: sessionId,
    user_id: userId,
    file_id: fileId,
  };
}

export function parseAnalysisQueueJob(value: unknown): AnalysisQueueJob | null {
  const indexJob = parseAnalysisIndexJob(value);
  if (indexJob) return indexJob;
  if (!isRecord(value) || value.type !== "analysis_cleanup") return null;
  const sessionId = boundedId(value.session_id);
  const userId = boundedId(value.user_id, 240);
  if (!sessionId || !userId) return null;
  return { type: "analysis_cleanup", session_id: sessionId, user_id: userId };
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "indexing failed");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:key|token|secret)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 600);
}

export function indexRetryDelaySeconds(attempts: number): number {
  const exponent = Math.max(0, Math.min(5, Math.floor(attempts) - 1));
  return Math.min(30 * (2 ** exponent), 900);
}

function logQueueEvent(level: "info" | "error", event: Record<string, unknown>): void {
  const payload = JSON.stringify({ service: "analysis-queue", ...event });
  if (level === "error") console.error(payload);
  else console.log(payload);
}

export async function processAnalysisQueue(batch: MessageBatch<AnalysisQueueJob>, env: Env): Promise<void> {
  const { queueName, dlqName } = configuredAnalysisQueueNames(env);
  const isDlq = batch.queue === dlqName;
  for (const message of batch.messages) {
    const job = parseAnalysisQueueJob(message.body);
    if (!job) {
      logQueueEvent("error", {
        event: "invalid_message",
        queue: batch.queue,
        message_id: message.id,
        attempts: message.attempts,
      });
      message.ack();
      continue;
    }

    if (isDlq) {
      try {
        if (job.type === "analysis_cleanup") {
          await markAnalysisCleanupFailed(env, job, "retry limit exhausted", message.attempts);
        } else {
          await markAnalysisIndexFailed(env, job, safeErrorMessage("retry limit exhausted"), message.attempts);
        }
        logQueueEvent("error", {
          event: "dead_letter",
          queue: batch.queue,
          message_id: message.id,
          session_id: job.session_id,
          job_type: job.type,
          ...(job.type === "analysis_index" ? { file_id: job.file_id } : {}),
          attempts: message.attempts,
        });
        message.ack();
      } catch (error) {
        logQueueEvent("error", {
          event: "dead_letter_status_update_failed",
          queue: batch.queue,
          message_id: message.id,
          session_id: job.session_id,
          job_type: job.type,
          ...(job.type === "analysis_index" ? { file_id: job.file_id } : {}),
          error: safeErrorMessage(error),
        });
        message.retry({ delaySeconds: indexRetryDelaySeconds(message.attempts) });
      }
      continue;
    }

    if (batch.queue !== queueName) {
      logQueueEvent("error", {
        event: "unknown_queue",
        queue: batch.queue,
        message_id: message.id,
      });
      message.ack();
      continue;
    }

    try {
      const result = job.type === "analysis_cleanup"
        ? await processAnalysisCleanupJob(env, job, message.id, message.attempts)
        : await processAnalysisIndexJob(env, job, message.id, message.attempts);
      logQueueEvent("info", {
        event: "processed",
        queue: batch.queue,
        message_id: message.id,
        session_id: job.session_id,
        job_type: job.type,
        ...(job.type === "analysis_index" ? { file_id: job.file_id } : {}),
        attempts: message.attempts,
        result,
      });
      message.ack();
    } catch (error) {
      const errorMessage = safeErrorMessage(error);
      try {
        if (job.type === "analysis_cleanup") {
          await markAnalysisCleanupRetry(env, job, error, message.attempts);
        } else {
          await markAnalysisIndexRetry(env, job, message.id, errorMessage, message.attempts);
        }
      } catch (statusError) {
        logQueueEvent("error", {
          event: "retry_status_update_failed",
          queue: batch.queue,
          message_id: message.id,
          session_id: job.session_id,
          job_type: job.type,
          ...(job.type === "analysis_index" ? { file_id: job.file_id } : {}),
          error: safeErrorMessage(statusError),
        });
      }
      logQueueEvent("error", {
        event: "retry",
        queue: batch.queue,
        message_id: message.id,
        session_id: job.session_id,
        job_type: job.type,
        ...(job.type === "analysis_index" ? { file_id: job.file_id } : {}),
        attempts: message.attempts,
        error: errorMessage,
      });
      message.retry({ delaySeconds: indexRetryDelaySeconds(message.attempts) });
    }
  }
}
