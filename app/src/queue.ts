// Cloudflare Queue 소비자 — analysis 인덱싱 큐 처리만 담당.
import type { Env } from "./env";
import { processAnalysisQueue, type AnalysisQueueJob } from "./domains/analysis";

export async function handleQueue(batch: MessageBatch<AnalysisQueueJob>, env: Env): Promise<void> {
  await processAnalysisQueue(batch, env);
}
