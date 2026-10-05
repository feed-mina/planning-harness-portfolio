// Cloudflare Cron 트리거 — 5분 주기 정기 작업 조립만 담당.
import type { Env } from "./env";
import { processDueKakaoNotifications } from "./integrations";
import { processDueGardenSiteCleanups } from "./domains/content";
import { processDailyUsageBudgetResets } from "./domains/usage";
import { scheduleAnalysisCleanup } from "./domains/analysis";
import { processAgentUsageAutoSync } from "./domains/usage";
import { processDueQuickLogReminders } from "./domains/planning";
import { processPendingIdentityRevocations } from "./domains/auth";

export async function handleScheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(processDueKakaoNotifications(env));
  ctx.waitUntil(processDueGardenSiteCleanups(env));
  ctx.waitUntil(processDailyUsageBudgetResets(env, controller.scheduledTime));
  ctx.waitUntil(scheduleAnalysisCleanup(env));
  ctx.waitUntil(processAgentUsageAutoSync(env, controller.scheduledTime));
  // Quick Log 리마인더(#213) — 기존 5분 주기 cron에 합류, ±5분 창 매칭으로 처리.
  ctx.waitUntil(processDueQuickLogReminders(env).then(() => undefined));
  // 소셜 계정 연결 해제 시 외부 토큰 폐기가 실패한 건 재시도(최대 5회).
  ctx.waitUntil(processPendingIdentityRevocations(env).then(() => undefined));
}
