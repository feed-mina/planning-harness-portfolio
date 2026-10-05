// DagsHub(MLflow Tracking) 연동 — 공유 모듈.
// Cloudflare Worker(JS 런타임)에는 공식 MLflow Python client 를 못 쓰므로
// DagsHub 가 노출하는 MLflow REST API(2.0) 를 직접 호출한다. 작업 1건 = MLflow run 1건.
// 평가(evals) 와 실사용(analysis/meeting) 양쪽에서 이 모듈을 통해 기록한다.
import { deployEnvironment, type Env } from "./env";

export interface DagsHubConfig {
  baseUrl: string;
  token: string;
  repo: string | null;
  environment: string;
}

// run 을 만든 경로. "usage" = 실사용 트래픽, "eval" = 평가 실행.
// 배포 환경(production/staging)은 별도 environment 태그로 기록한다.
export type DagsHubSource = "usage" | "eval";

export type DagsHubStatus = "synced" | "failed" | "token_missing" | "not_configured";

export interface DagsHubResult {
  status: DagsHubStatus;
  url: string | null;
}

export interface DagsHubRunInput {
  experiment: string;
  source: DagsHubSource;
  runName: string;
  startTime?: number;
  status?: "FINISHED" | "FAILED";
  tags?: Record<string, string | number | boolean | null | undefined>;
  params?: Record<string, string | number | null | undefined>;
  metrics?: Record<string, number | null | undefined>;
}

// 환경별 experiment 이름. production 기록을 그대로 두려고 기본값은 기존 이름을 유지하고,
// staging 은 wrangler.jsonc 의 vars 로 별도 experiment 를 가리킨다.
export const DAGSHUB_EVAL_EXPERIMENT = "ai-eval";
export const DAGSHUB_USAGE_EXPERIMENT = "production-usage";

// 평가(evals) run 이 들어갈 experiment.
export function evalExperiment(env: Pick<Env, "DAGSHUB_EVAL_EXPERIMENT">): string {
  return env.DAGSHUB_EVAL_EXPERIMENT?.trim() || DAGSHUB_EVAL_EXPERIMENT;
}

// 실사용(회의록 요약·분석설계) run 이 들어갈 experiment.
export function usageExperiment(env: Pick<Env, "DAGSHUB_USAGE_EXPERIMENT">): string {
  return env.DAGSHUB_USAGE_EXPERIMENT?.trim() || DAGSHUB_USAGE_EXPERIMENT;
}

export function dagsHubConfig(env: Env): DagsHubConfig | null {
  const uri = env.DAGSHUB_MLFLOW_TRACKING_URI;
  const token = env.DAGSHUB_TOKEN;
  if (!uri || !token) return null;
  return {
    baseUrl: uri.replace(/\/+$/, ""),
    token,
    repo: env.DAGSHUB_REPO || null,
    environment: deployEnvironment(env),
  };
}

// source(usage/eval) 와 environment(production/staging) 는 호출부가 덮어쓰지 못하게
// 항상 마지막에 얹는다 — 이 두 태그가 run 을 구분하는 기준이다.
export function runTags(cfg: DagsHubConfig, input: DagsHubRunInput): Record<string, string | number | boolean | null | undefined> {
  return {
    ...input.tags,
    "mlflow.runName": input.runName,
    source: input.source,
    environment: cfg.environment,
  };
}

function authHeader(cfg: DagsHubConfig): string {
  // DagsHub 액세스 토큰은 username/password 양쪽에 동일 토큰을 넣어 Basic 인증한다.
  return `Basic ${btoa(`${cfg.token}:${cfg.token}`)}`;
}

async function mlflowPost<T = Record<string, unknown>>(cfg: DagsHubConfig, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${cfg.baseUrl}/api/2.0/mlflow/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader(cfg) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`MLflow ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

// experiment_id 는 (baseUrl, name) 별로 isolate 내에서 캐시해 매 run 마다 조회하지 않는다.
const experimentCache = new Map<string, string>();

async function resolveExperimentId(cfg: DagsHubConfig, name: string): Promise<string | null> {
  const getUrl = `${cfg.baseUrl}/api/2.0/mlflow/experiments/get-by-name?experiment_name=${encodeURIComponent(name)}`;
  const res = await fetch(getUrl, { headers: { authorization: authHeader(cfg) } });
  if (!res.ok) return null;
  const data = await res.json() as { experiment?: { experiment_id?: string } };
  return data?.experiment?.experiment_id || null;
}

async function ensureExperiment(cfg: DagsHubConfig, name: string): Promise<string> {
  const key = `${cfg.baseUrl}::${name}`;
  const cached = experimentCache.get(key);
  if (cached) return cached;

  let id = await resolveExperimentId(cfg, name);
  if (!id) {
    try {
      const created = await mlflowPost<{ experiment_id: string }>(cfg, "experiments/create", { name });
      id = created.experiment_id || null;
    } catch {
      // 동시 실행 등으로 이미 존재할 수 있어 아래에서 재조회한다.
      id = await resolveExperimentId(cfg, name);
    }
  }
  if (!id) throw new Error(`MLflow experiment 확인 실패: ${name}`);
  experimentCache.set(key, id);
  return id;
}

function toTagArray(record: Record<string, string | number | boolean | null | undefined> | undefined) {
  const out: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(record || {})) {
    if (value === null || value === undefined || value === "") continue;
    out.push({ key, value: String(value).slice(0, 500) });
  }
  return out.slice(0, 100);
}

function toParamArray(record: Record<string, string | number | null | undefined> | undefined) {
  const out: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(record || {})) {
    if (value === null || value === undefined || value === "") continue;
    out.push({ key, value: String(value).slice(0, 500) });
  }
  return out.slice(0, 100);
}

function toMetricArray(record: Record<string, number | null | undefined> | undefined, ts: number) {
  const out: Array<{ key: string; value: number; timestamp: number; step: number }> = [];
  for (const [key, value] of Object.entries(record || {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    out.push({ key, value, timestamp: ts, step: 0 });
  }
  return out.slice(0, 100);
}

async function pushRun(cfg: DagsHubConfig, experimentId: string, input: DagsHubRunInput): Promise<string | null> {
  const created = await mlflowPost<{ run?: { info?: { run_id?: string; run_uuid?: string } } }>(cfg, "runs/create", {
    experiment_id: experimentId,
    start_time: input.startTime ?? Date.now(),
    tags: toTagArray(runTags(cfg, input)),
  });
  const runId = created?.run?.info?.run_id || created?.run?.info?.run_uuid;
  if (!runId) throw new Error("MLflow run_id 미수신");

  const ts = Date.now();
  const params = toParamArray(input.params);
  const metrics = toMetricArray(input.metrics, ts);
  if (params.length || metrics.length) {
    await mlflowPost(cfg, "runs/log-batch", { run_id: runId, params, metrics });
  }
  await mlflowPost(cfg, "runs/update", { run_id: runId, status: input.status ?? "FINISHED", end_time: ts });

  return cfg.repo ? `https://dagshub.com/${cfg.repo}/experiments/#/experiment/${experimentId}/${runId}` : null;
}

// 단일 진입점 — 설정이 없거나 push 가 실패해도 절대 throw 하지 않고 상태만 반환한다.
// 호출부(평가/실사용)는 이 반환값으로 sync 상태를 판단하고, 실패가 본 작업을 막지 않게 한다.
export async function logDagsHubRun(env: Env, input: DagsHubRunInput): Promise<DagsHubResult> {
  const cfg = dagsHubConfig(env);
  if (!cfg) {
    if (env.DAGSHUB_MLFLOW_TRACKING_URI && !env.DAGSHUB_TOKEN) return { status: "token_missing", url: null };
    return { status: "not_configured", url: null };
  }
  try {
    const experimentId = await ensureExperiment(cfg, input.experiment);
    const url = await pushRun(cfg, experimentId, input);
    return { status: "synced", url };
  } catch {
    return { status: "failed", url: null };
  }
}
