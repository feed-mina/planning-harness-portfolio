// 기획 하네스 회의록 앱 — Cloudflare Worker 진입점. 핸들러 조립만 담당한다.
// 실제 라우팅/큐/스케줄 로직은 router.ts / queue.ts / scheduled.ts 에 있다.
import { handleFetch } from "./router";
import { handleQueue } from "./queue";
import { handleScheduled } from "./scheduled";

export type { Env } from "./env";
export { NBlogWorkflow } from "./domains/nblog";

export default {
  fetch: handleFetch,
  queue: handleQueue,
  scheduled: handleScheduled,
};
