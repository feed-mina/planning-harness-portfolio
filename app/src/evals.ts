import { generateText, type AISettings } from "./ai";
import type { Env } from "./env";
import { checkQuota, computeCostKRW, logUsage } from "./domains/usage";
import { logDagsHubRun, evalExperiment } from "./dagshub";
import { escapeHtml } from "./html";

type EvalStage = "meeting_summary" | "analysis_summaries" | "analysis_ideas" | "analysis_plans";

interface EvalCaseRow {
  id: string;
  user_id: string;
  name: string;
  stage: EvalStage;
  input_json: string;
  expected_json: string | null;
  prompt_version: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface EvalRunRow {
  id: string;
  case_id: string;
  user_id: string;
  stage: EvalStage;
  prompt_version: string;
  provider: string;
  model: string;
  actual_provider: string | null;
  actual_model: string | null;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_krw: number;
  success: number;
  error: string | null;
  json_parse_ok: number;
  schema_ok: number;
  source_citation_hit: number;
  judge_score: number | null;
  fallback_from: string | null;
  dagshub_sync_status: string | null;
  dagshub_run_url: string | null;
  output_json: string | null;
  created_at: string;
  case_name?: string | null;
}

interface EvalCombination {
  provider: AISettings["provider"];
  model: string;
  prompt_version?: string;
}

interface EvalInput {
  prompt?: string;
  context?: string;
  instruction?: string;
}

interface EvalExpected {
  keywords?: string[];
  required_keys?: string[];
  source_terms?: string[];
}

const STAGES: EvalStage[] = ["meeting_summary", "analysis_summaries", "analysis_ideas", "analysis_plans"];
const PROVIDERS = ["gemini", "claude", "openai"] as const;

const SEED_CASES: Array<{ name: string; stage: EvalStage; input: EvalInput; expected: EvalExpected }> = [
  {
    name: "회의록 결정/액션아이템 추출",
    stage: "meeting_summary",
    input: {
      prompt: [
        "다음 회의 메모를 Markdown 회의록으로 요약해 주세요.",
        "참석자: 민아, 지훈",
        "내용: 예산 검토는 7월 10일까지 완료한다. 지훈은 견적 비교표를 작성한다. 민아는 발주 리스크를 확인한다.",
      ].join("\n"),
      instruction: "결정사항과 액션아이템을 분리해 작성합니다.",
    },
    expected: { keywords: ["예산", "7월 10일", "지훈", "민아"], required_keys: [] },
  },
  {
    name: "분석파일 JSON 요약 형식",
    stage: "analysis_summaries",
    input: {
      prompt: [
        "분석 파일 요약 JSON을 생성해 주세요.",
        "파일: budget.csv",
        "내용: A안 1200만원, B안 980만원. B안은 납기 리스크가 있고 A안은 유지보수 조건이 좋다.",
      ].join("\n"),
      instruction: "overall, summaries 배열을 포함한 JSON으로 답합니다.",
    },
    expected: { keywords: ["A안", "B안", "리스크"], required_keys: ["overall", "summaries"] },
  },
  {
    name: "RAG 근거 출처 포함 플랜",
    stage: "analysis_plans",
    input: {
      prompt: [
        "다음 근거를 바탕으로 실행 플랜 JSON을 작성해 주세요.",
        "근거 chunk: file-1:chunk-0001 - 수문 조사 표본은 3개 이상이어야 한다.",
        "요청: 조사 설계와 검증 단계를 포함합니다.",
      ].join("\n"),
      instruction: "plans 배열과 각 detail에 근거 chunk를 짧게 포함합니다.",
    },
    expected: {
      keywords: ["수문", "조사", "검증"],
      required_keys: ["plans"],
      source_terms: ["file-1:chunk-0001"],
    },
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown, max = 1000): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined;
}

function asStringArray(value: unknown, max = 40): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? item.trim().slice(0, 200) : "")
    .filter(Boolean)
    .slice(0, max);
}

function normalizeStage(value: unknown): EvalStage {
  const text = asString(value, 80);
  return STAGES.includes(text as EvalStage) ? text as EvalStage : "meeting_summary";
}

function normalizeProvider(value: unknown): AISettings["provider"] {
  const text = asString(value, 80);
  return (PROVIDERS as readonly string[]).includes(text || "") ? text as AISettings["provider"] : "gemini";
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function extractJsonObject(text: string): unknown | null {
  const clean = stripCodeFence(text);
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(clean.slice(start, end + 1)); } catch { /* ignore */ }
    }
    return null;
  }
}

function buildPrompt(row: EvalCaseRow, promptVersion: string): string {
  const input = parseJson<EvalInput>(row.input_json, {});
  const expected = parseJson<EvalExpected>(row.expected_json, {});
  const required = expected.required_keys?.length
    ? `\nRequired JSON keys: ${expected.required_keys.join(", ")}`
    : "";
  return [
    `Evaluation case: ${row.name}`,
    `Stage: ${row.stage}`,
    `Prompt version: ${promptVersion}`,
    input.context ? `Context:\n${input.context}` : "",
    input.instruction ? `Instruction:\n${input.instruction}` : "",
    `Task:\n${input.prompt || ""}`,
    required,
  ].filter(Boolean).join("\n\n").slice(0, 50000);
}

function keywordScore(text: string, expected: EvalExpected): number | null {
  const keywords = expected.keywords || [];
  if (!keywords.length) return null;
  const lower = text.toLowerCase();
  const hits = keywords.filter((keyword) => lower.includes(keyword.toLowerCase())).length;
  return hits / keywords.length;
}

function schemaPass(parsed: unknown | null, expected: EvalExpected): boolean {
  const keys = expected.required_keys || [];
  if (!keys.length) return true;
  const rec = asRecord(parsed);
  if (!rec) return false;
  return keys.every((key) => key in rec);
}

function sourceHit(text: string, expected: EvalExpected): boolean {
  const terms = expected.source_terms || [];
  if (!terms.length) return /\b[\w-]+:(chunk-)?\d{3,4}\b/i.test(text) || /\b[\w-]+:[\w-]{8,}\b/i.test(text);
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

async function ensureSeedCases(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    "SELECT name FROM ai_eval_cases WHERE user_id=?"
  ).bind(userId).all<{ name: string }>();
  const existing = new Set((results || []).map((row) => row.name));
  const now = new Date().toISOString();
  for (const item of SEED_CASES) {
    if (existing.has(item.name)) continue;
    await env.DB.prepare(
      `INSERT INTO ai_eval_cases (id, user_id, name, stage, input_json, expected_json, prompt_version, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      userId,
      item.name,
      item.stage,
      JSON.stringify(item.input),
      JSON.stringify(item.expected),
      "seed-v1",
      now,
      now
    ).run();
  }
}

function publicCase(row: EvalCaseRow) {
  return {
    id: row.id,
    name: row.name,
    stage: row.stage,
    input: parseJson<EvalInput>(row.input_json, {}),
    expected: parseJson<EvalExpected>(row.expected_json, {}),
    prompt_version: row.prompt_version,
    enabled: !!row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function avg(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function aggregateRuns(rows: EvalRunRow[]) {
  const groups = new Map<string, EvalRunRow[]>();
  for (const row of rows) {
    const key = [row.stage, row.prompt_version, row.provider, row.model].join("|");
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, items]) => {
    const [stage, promptVersion, provider, model] = key.split("|");
    const successes = items.filter((item) => item.success);
    const judged = items.map((item) => item.judge_score).filter((value): value is number => typeof value === "number");
    return {
      stage,
      prompt_version: promptVersion,
      provider,
      model,
      runs: items.length,
      success_rate: items.length ? successes.length / items.length : 0,
      failure_count: items.length - successes.length,
      fallback_count: items.filter((item) => item.fallback_from).length,
      judge_score_avg: avg(judged),
      schema_pass_rate: avg(items.map((item) => item.schema_ok ? 1 : 0)),
      source_citation_hit_rate: avg(items.map((item) => item.source_citation_hit ? 1 : 0)),
      latency_p50_ms: percentile(items.map((item) => item.latency_ms || 0), 50),
      latency_p95_ms: percentile(items.map((item) => item.latency_ms || 0), 95),
      avg_tokens: avg(items.map((item) => (item.input_tokens || 0) + (item.output_tokens || 0))),
      avg_cost_krw: avg(items.map((item) => item.cost_krw || 0)),
    };
  }).sort((a, b) => a.stage.localeCompare(b.stage) || b.runs - a.runs);
}

function publicRun(row: EvalRunRow) {
  return {
    id: row.id,
    case_id: row.case_id,
    case_name: row.case_name || null,
    stage: row.stage,
    prompt_version: row.prompt_version,
    provider: row.provider,
    model: row.model,
    actual_provider: row.actual_provider,
    actual_model: row.actual_model,
    latency_ms: row.latency_ms,
    usage: { input_tokens: row.input_tokens, output_tokens: row.output_tokens },
    cost_krw: row.cost_krw,
    success: !!row.success,
    error: row.error,
    json_parse_ok: !!row.json_parse_ok,
    schema_ok: !!row.schema_ok,
    source_citation_hit: !!row.source_citation_hit,
    judge_score: row.judge_score,
    fallback_from: row.fallback_from,
    dagshub_sync_status: row.dagshub_sync_status,
    dagshub_run_url: row.dagshub_run_url,
    created_at: row.created_at,
  };
}

export async function listEvalDashboard(env: Env, userId: string) {
  await ensureSeedCases(env, userId);
  const [casesRes, runsRes] = await Promise.all([
    env.DB.prepare(
      `SELECT id, user_id, name, stage, input_json, expected_json, prompt_version, enabled, created_at, updated_at
       FROM ai_eval_cases
       WHERE user_id=?
       ORDER BY created_at`
    ).bind(userId).all<EvalCaseRow>(),
    env.DB.prepare(
      `SELECT r.*, c.name AS case_name
       FROM ai_eval_runs r
       LEFT JOIN ai_eval_cases c ON c.id=r.case_id AND c.user_id=r.user_id
       WHERE r.user_id=?
       ORDER BY r.created_at DESC
       LIMIT 1000`
    ).bind(userId).all<EvalRunRow>(),
  ]);
  const runs = runsRes.results || [];
  return {
    cases: (casesRes.results || []).map(publicCase),
    aggregates: aggregateRuns(runs),
    recent_runs: runs.slice(0, 25).map(publicRun),
    summary: {
      case_count: (casesRes.results || []).length,
      run_count: runs.length,
      success_count: runs.filter((run) => run.success).length,
      fallback_count: runs.filter((run) => run.fallback_from).length,
    },
    dagshub: {
      configured: !!(env.DAGSHUB_MLFLOW_TRACKING_URI && env.DAGSHUB_TOKEN),
      tracking_uri: env.DAGSHUB_MLFLOW_TRACKING_URI || null,
      token_present: !!env.DAGSHUB_TOKEN,
      repo: env.DAGSHUB_REPO || null,
    },
  };
}

export async function createEvalCase(env: Env, userId: string, body: unknown) {
  const rec = asRecord(body) || {};
  const now = new Date().toISOString();
  const input = asRecord(rec.input) || { prompt: asString(rec.prompt, 20000) || "" };
  const expected = asRecord(rec.expected) || {
    keywords: asStringArray(rec.keywords),
    required_keys: asStringArray(rec.required_keys),
    source_terms: asStringArray(rec.source_terms),
  };
  const row = {
    id: crypto.randomUUID(),
    name: asString(rec.name, 160) || "Untitled eval case",
    stage: normalizeStage(rec.stage),
    input_json: JSON.stringify(input),
    expected_json: JSON.stringify(expected),
    prompt_version: asString(rec.prompt_version, 80) || "custom-v1",
    now,
  };
  await env.DB.prepare(
    `INSERT INTO ai_eval_cases (id, user_id, name, stage, input_json, expected_json, prompt_version, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(row.id, userId, row.name, row.stage, row.input_json, row.expected_json, row.prompt_version, now, now).run();
  return { case: publicCase({ ...row, user_id: userId, enabled: 1, created_at: now, updated_at: now }) };
}

function normalizeCombinations(value: unknown): EvalCombination[] {
  if (!Array.isArray(value)) {
    return [{ provider: "gemini", model: "gemini-2.5-flash", prompt_version: "default" }];
  }
  return value.map((raw) => {
    const rec = asRecord(raw) || {};
    return {
      provider: normalizeProvider(rec.provider),
      model: asString(rec.model, 120) || "gemini-2.5-flash",
      prompt_version: asString(rec.prompt_version, 80) || "default",
    };
  }).filter((item) => item.model).slice(0, 12);
}

async function fetchCases(env: Env, userId: string, ids: string[]): Promise<EvalCaseRow[]> {
  await ensureSeedCases(env, userId);
  if (!ids.length) {
    const { results } = await env.DB.prepare(
      `SELECT id, user_id, name, stage, input_json, expected_json, prompt_version, enabled, created_at, updated_at
       FROM ai_eval_cases
       WHERE user_id=? AND enabled=1
       ORDER BY created_at
       LIMIT 3`
    ).bind(userId).all<EvalCaseRow>();
    return results || [];
  }
  const rows: EvalCaseRow[] = [];
  for (const id of ids.slice(0, 20)) {
    const row = await env.DB.prepare(
      `SELECT id, user_id, name, stage, input_json, expected_json, prompt_version, enabled, created_at, updated_at
       FROM ai_eval_cases
       WHERE id=? AND user_id=? AND enabled=1`
    ).bind(id, userId).first<EvalCaseRow>();
    if (row) rows.push(row);
  }
  return rows;
}

async function insertRun(env: Env, row: Omit<EvalRunRow, "case_name">) {
  await env.DB.prepare(
    `INSERT INTO ai_eval_runs (
       id, case_id, user_id, stage, prompt_version, provider, model, actual_provider, actual_model,
       latency_ms, input_tokens, output_tokens, cost_krw, success, error, json_parse_ok, schema_ok,
       source_citation_hit, judge_score, fallback_from, dagshub_sync_status, dagshub_run_url, output_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.id,
    row.case_id,
    row.user_id,
    row.stage,
    row.prompt_version,
    row.provider,
    row.model,
    row.actual_provider,
    row.actual_model,
    row.latency_ms,
    row.input_tokens,
    row.output_tokens,
    row.cost_krw,
    row.success,
    row.error,
    row.json_parse_ok,
    row.schema_ok,
    row.source_citation_hit,
    row.judge_score,
    row.fallback_from,
    row.dagshub_sync_status,
    row.dagshub_run_url,
    row.output_json,
    row.created_at
  ).run();
}

// 평가 실행 1건 = MLflow run 1건. DagsHub push 와 environment 별 experiment 선택은
// 공유 모듈(dagshub.ts)에 위임한다.

// 실행 결과를 (설정돼 있으면) DagsHub 로 push 한 뒤 sync 상태/링크를 확정해 DB 에 저장한다.
// logDagsHubRun 은 throw 하지 않고 상태만 돌려주므로 DagsHub 장애가 평가를 막지 않는다.
async function finalizeRun(env: Env, row: EvalRunRow, created: EvalRunRow[]) {
  const res = await logDagsHubRun(env, {
    experiment: evalExperiment(env),
    source: "eval",
    runName: `${row.provider}/${row.model} · ${row.case_name || row.case_id}`,
    startTime: Date.parse(row.created_at) || Date.now(),
    status: row.success ? "FINISHED" : "FAILED",
    tags: {
      stage: row.stage,
      prompt_version: row.prompt_version,
      provider: row.provider,
      model: row.model,
      case_id: row.case_id,
      user_id: row.user_id,
      success: String(!!row.success),
      fallback_from: row.fallback_from,
    },
    params: {
      provider: row.provider,
      model: row.model,
      actual_provider: row.actual_provider,
      actual_model: row.actual_model,
      stage: row.stage,
      prompt_version: row.prompt_version,
      case_id: row.case_id,
    },
    metrics: {
      latency_ms: row.latency_ms,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cost_krw: row.cost_krw,
      success: row.success,
      json_parse_ok: row.json_parse_ok,
      schema_ok: row.schema_ok,
      source_citation_hit: row.source_citation_hit,
      judge_score: row.judge_score,
    },
  });
  row.dagshub_sync_status = res.status;
  row.dagshub_run_url = res.url;
  await insertRun(env, row);
  created.push(row);
}

export async function runEvalCases(env: Env, userId: string, body: unknown) {
  const rec = asRecord(body) || {};
  const cases = await fetchCases(env, userId, asStringArray(rec.case_ids, 20));
  if (!cases.length) return { error: "No enabled eval cases found.", status: 404 };
  const combinations = normalizeCombinations(rec.combinations);
  const repeat = Math.min(3, Math.max(1, Number(rec.repeat) || 1));
  const created: EvalRunRow[] = [];

  for (const testCase of cases) {
    for (const combination of combinations) {
      for (let i = 0; i < repeat; i++) {
        const quota = await checkQuota(env, userId);
        if (!quota.allowed) {
          return { error: `Daily AI limit exceeded (${quota.limit} KRW).`, status: 429, runs: created.map(publicRun) };
        }
        const promptVersion = combination.prompt_version || testCase.prompt_version || "default";
        const prompt = buildPrompt(testCase, promptVersion);
        const expected = parseJson<EvalExpected>(testCase.expected_json, {});
        const id = crypto.randomUUID();
        const started = Date.now();
        const now = new Date().toISOString();
        try {
          const out = await generateText(env, prompt, {
            provider: combination.provider,
            model: combination.model,
            purpose: "analysis",
            webSearch: false,
          });
          const latency = Date.now() - started;
          const cost = computeCostKRW(out.provider, out.model, out.inputTokens, out.outputTokens);
          await logUsage(env, userId, out.provider, out.model, out.inputTokens, out.outputTokens);
          const parsed = extractJsonObject(out.text);
          const score = keywordScore(out.text, expected);
          const row: EvalRunRow = {
            id,
            case_id: testCase.id,
            user_id: userId,
            stage: testCase.stage,
            prompt_version: promptVersion,
            provider: combination.provider,
            model: combination.model,
            actual_provider: out.provider,
            actual_model: out.model,
            latency_ms: latency,
            input_tokens: out.inputTokens,
            output_tokens: out.outputTokens,
            cost_krw: cost,
            success: 1,
            error: null,
            json_parse_ok: parsed ? 1 : 0,
            schema_ok: schemaPass(parsed, expected) ? 1 : 0,
            source_citation_hit: sourceHit(out.text, expected) ? 1 : 0,
            judge_score: score,
            fallback_from: out.fallbackFrom || null,
            dagshub_sync_status: "pending",
            dagshub_run_url: null,
            output_json: JSON.stringify({ text: out.text.slice(0, 20000), parsed }),
            created_at: now,
            case_name: testCase.name,
          };
          await finalizeRun(env, row, created);
        } catch (err) {
          const latency = Date.now() - started;
          const row: EvalRunRow = {
            id,
            case_id: testCase.id,
            user_id: userId,
            stage: testCase.stage,
            prompt_version: promptVersion,
            provider: combination.provider,
            model: combination.model,
            actual_provider: null,
            actual_model: null,
            latency_ms: latency,
            input_tokens: 0,
            output_tokens: 0,
            cost_krw: 0,
            success: 0,
            error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
            json_parse_ok: 0,
            schema_ok: 0,
            source_citation_hit: 0,
            judge_score: null,
            fallback_from: null,
            dagshub_sync_status: "pending",
            dagshub_run_url: null,
            output_json: null,
            created_at: now,
            case_name: testCase.name,
          };
          await finalizeRun(env, row, created);
        }
      }
    }
  }
  return { runs: created.map(publicRun), dashboard: await listEvalDashboard(env, userId) };
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function reportData(env: Env, userId: string) {
  const dashboard = await listEvalDashboard(env, userId);
  return dashboard.aggregates;
}

export async function evalReportResponse(env: Env, userId: string, format: string): Promise<Response> {
  const rows = await reportData(env, userId);
  const stamp = new Date().toISOString();
  const name = `ai_eval_report_${stamp.slice(0, 10)}`;

  if (format === "csv") {
    const headers = [
      "stage", "prompt_version", "provider", "model", "runs", "accuracy_judge_score",
      "schema_pass_rate", "source_citation_hit_rate", "latency_p50_ms", "latency_p95_ms",
      "avg_tokens", "avg_cost_krw", "failure_count", "fallback_count",
    ];
    const csv = [headers.join(",")].concat(rows.map((row) => [
      row.stage,
      row.prompt_version,
      row.provider,
      row.model,
      row.runs,
      row.judge_score_avg,
      row.schema_pass_rate,
      row.source_citation_hit_rate,
      row.latency_p50_ms,
      row.latency_p95_ms,
      row.avg_tokens,
      row.avg_cost_krw,
      row.failure_count,
      row.fallback_count,
    ].map(escapeCsv).join(","))).join("\n");
    return new Response(`\uFEFF${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}.csv"`,
      },
    });
  }

  if (format === "md" || format === "markdown") {
    const header = [
      "# AI Performance Report",
      "",
      `Generated: ${stamp}`,
      "",
      "| stage | prompt version | provider/model | accuracy | schema pass | source hit | latency p50/p95 | avg tokens/cost | failure/fallback |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ].join("\n");
    const body = rows.map((row) =>
      `| ${row.stage} | ${row.prompt_version} | ${row.provider}/${row.model} | ${(row.judge_score_avg * 100).toFixed(1)}% | ${(row.schema_pass_rate * 100).toFixed(1)}% | ${(row.source_citation_hit_rate * 100).toFixed(1)}% | ${row.latency_p50_ms}/${row.latency_p95_ms}ms | ${row.avg_tokens.toFixed(0)} / ${row.avg_cost_krw.toFixed(3)} KRW | ${row.failure_count}/${row.fallback_count} |`
    ).join("\n");
    return new Response(`\uFEFF${header}\n${body}\n`, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${name}.md"`,
      },
    });
  }

  const table = rows.map((row) => `<tr>
    <td>${escapeHtml(row.stage)}</td>
    <td>${escapeHtml(row.prompt_version)}</td>
    <td>${escapeHtml(row.provider)}/${escapeHtml(row.model)}</td>
    <td>${(row.judge_score_avg * 100).toFixed(1)}%</td>
    <td>${(row.schema_pass_rate * 100).toFixed(1)}%</td>
    <td>${(row.source_citation_hit_rate * 100).toFixed(1)}%</td>
    <td>${row.latency_p50_ms} / ${row.latency_p95_ms} ms</td>
    <td>${row.avg_tokens.toFixed(0)} / ${row.avg_cost_krw.toFixed(3)} KRW</td>
    <td>${row.failure_count} / ${row.fallback_count}</td>
  </tr>`).join("");
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>AI Performance Report</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; margin: 40px; color: #1f2937; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; }
    th { background: #f8fafc; }
    td:nth-child(n+4) { text-align: right; font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <h1>AI Performance Report</h1>
  <p>Generated: ${escapeHtml(stamp)}</p>
  <table>
    <thead><tr><th>stage</th><th>prompt version</th><th>provider/model</th><th>accuracy</th><th>schema pass</th><th>source hit</th><th>latency p50/p95</th><th>avg token/cost</th><th>failure/fallback</th></tr></thead>
    <tbody>${table || '<tr><td colspan="9">No eval runs yet.</td></tr>'}</tbody>
  </table>
</body>
</html>`;
  return new Response(`\uFEFF${html}`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.html"`,
    },
  });
}
