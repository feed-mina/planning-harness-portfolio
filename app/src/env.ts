// Cloudflare Worker Env 바인딩 타입. index.ts(진입점)에서 분리해 도메인 파일들이
// 진입점을 거치지 않고 이 파일만 import하도록 한다(순환 제거).
import type { AnalysisQueueJob } from "./domains/analysis";
import type { NBlogWorkflowParams } from "./domains/nblog";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  R2: R2Bucket;
  VECTORIZE?: Vectorize;
  ANALYSIS_INDEX_QUEUE: Queue<AnalysisQueueJob>;
  ANALYSIS_INDEX_QUEUE_NAME?: string;
  ANALYSIS_INDEX_DLQ_NAME?: string;
  NBLOG_WORKFLOW: Workflow<NBlogWorkflowParams>;
  NBLOG_HANDOFF_ENABLED?: string;
  NBLOG_MEDIA_MAX_BYTES?: string;
  ANALYSIS_RETENTION_DAYS?: string;
  DAILY_LIMIT_KRW: string;
  GITHUB_OAUTH_CLIENT_ID: string;
  APP_BASE_URL: string;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  GEMINI_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_PAGES_API_TOKEN?: string;
  // Vertex AI 경로 — 서비스 계정 JSON(secret) + 리전이 설정되면 Gemini 를 Vertex 로 호출(위치 차단 회피).
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_CLOUD_PROJECT_ID?: string;
  GOOGLE_CLOUD_LOCATION?: string;
  RAG_EMBEDDING_PROVIDER?: string;
  RAG_EMBEDDING_MODEL?: string;
  RAG_EMBEDDING_DIMENSIONS?: string;
  DAGSHUB_MLFLOW_TRACKING_URI?: string;
  DAGSHUB_TOKEN?: string;
  DAGSHUB_REPO?: string;
  // 실험 추적은 환경별로 분리한다 — staging run 이 production 기록에 섞이지 않게 experiment 를 나눈다.
  DAGSHUB_EVAL_EXPERIMENT?: string;
  DAGSHUB_USAGE_EXPERIMENT?: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  KAKAO_REST_API_KEY?: string;
  KAKAO_CLIENT_SECRET?: string;
  NAVER_OAUTH_CLIENT_ID?: string;
  NAVER_OAUTH_CLIENT_SECRET?: string;
  CLOVA_SPEECH_INVOKE_URL?: string;
  CLOVA_SPEECH_SECRET_KEY?: string;
  GARDEN_RUNNER_TOKEN?: string;
  SENDGRID_API_KEY?: string;
  SENDGRID_MAIL_SEND_ENDPOINT?: string;
  ALERT_EMAIL_FROM?: string;
  ALERT_EMAIL_FROM_NAME?: string;
  ANALYTICS_ENABLED?: string;
  ANALYTICS_ENVIRONMENT?: string;
  MOBILE_AUTH_ENABLED?: string;
  MOBILE_AUTH_REDIRECT_URIS?: string;
  CONNECTED_APP_AUTH_ENABLED?: string;
  AUTO_MEDIA_NAV_ENABLED?: string;
  CONNECTED_APP_CLIENT_ID?: string;
  CONNECTED_APP_AUDIENCE?: string;
  CONNECTED_APP_SCOPE?: string;
  CONNECTED_APP_REDIRECT_URI?: string;
  CONNECTED_APP_BACKCHANNEL_SECRET?: string;
  GA4_MEASUREMENT_ID?: string;
  GTM_CONTAINER_ID?: string;
  CLOUDFLARE_WEB_ANALYTICS_TOKEN?: string;
  CLARITY_PROJECT_ID?: string;
  JWT_SECRET: string;
}

export const DEFAULT_DEPLOY_ENVIRONMENT = "production";

// 배포 환경 이름(production/staging)의 단일 출처. ANALYTICS_ENVIRONMENT 가 환경별로
// 이미 정확히 세팅돼 있어 이를 그대로 쓰고, 미설정이면 production 으로 본다.
// 분석 스크립트 설정과 DagsHub run 태그가 같은 값을 보게 하려는 목적이다.
export function deployEnvironment(env: Pick<Env, "ANALYTICS_ENVIRONMENT">): string {
  return env.ANALYTICS_ENVIRONMENT?.trim() || DEFAULT_DEPLOY_ENVIRONMENT;
}
