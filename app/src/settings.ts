// 사용자 설정(provider/model/커스텀 프롬프트). 마이페이지에서 저장, summarize/analysis 가 적용.
import type { Env } from "./env";
import { DEFAULT_PROMPT_TEMPLATE, type AIPurpose, type AISettings } from "./ai";

export const DEFAULTS = { provider: "gemini" as const, model: "gemini-2.5-pro" };

export const VALID_PROVIDERS = ["gemini", "claude", "openai"] as const;
export const DEFAULT_MODEL_BY_PROVIDER = {
  gemini: "gemini-2.5-pro",
  claude: "claude-sonnet-4-6",
  openai: "gpt-5-mini",
} as const;

export const MODEL_CATALOG = {
  analysis: {
    gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
    claude: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
    openai: ["gpt-5", "gpt-5-mini"],
  },
  search: {
    gemini: ["gemini-2.5-pro"],
    claude: ["claude-sonnet-4-6"],
    openai: ["gpt-5"],
  },
} as const;

export const AI_STAGE_DEFINITIONS = [
  {
    id: "meeting_summary",
    label: "3. 회의록 변환",
    description: "회의 녹취/자막을 회의록 Markdown으로 변환",
    purpose: "analysis",
    provider: "gemini",
    model: "gemini-2.5-pro",
  },
  {
    id: "analysis_summaries",
    label: "6. 분석파일 요약",
    description: "업로드한 문서/표/메모를 요약",
    purpose: "analysis",
    provider: "claude",
    model: "claude-sonnet-4-6",
  },
  {
    id: "analysis_ideas",
    label: "7. 아이디어 도출",
    description: "요약과 메모를 바탕으로 선택 질문 생성",
    purpose: "analysis",
    provider: "claude",
    model: "claude-sonnet-4-6",
  },
  {
    id: "analysis_plans",
    label: "8. 분석 플랜 도출",
    description: "선택 답변 기반 실행 가능한 분석 플랜 생성",
    purpose: "analysis",
    provider: "claude",
    model: "claude-opus-4-8",
  },
  {
    id: "analysis_manual",
    label: "9. 매뉴얼/메모 산출",
    description: "회의록·메모를 단계별 매뉴얼(또는 메모) 문서로 정리",
    purpose: "analysis",
    provider: "claude",
    model: "claude-opus-4-8",
  },
] as const;

export type AIStage = typeof AI_STAGE_DEFINITIONS[number]["id"];

interface SettingsRow {
  default_provider?: string | null;
  default_model?: string | null;
  custom_prompt?: string | null;
  stage_models?: string | null;
}

const STAGE_DEFAULTS = Object.fromEntries(
  AI_STAGE_DEFINITIONS.map((stage) => [stage.id, stage])
) as Record<AIStage, typeof AI_STAGE_DEFINITIONS[number]>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isProvider(value: string | undefined): value is AISettings["provider"] {
  return !!value && (VALID_PROVIDERS as readonly string[]).includes(value);
}

function isStage(value: string | undefined): value is AIStage {
  return !!value && AI_STAGE_DEFINITIONS.some((stage) => stage.id === value);
}

function normalizePurpose(value: string | undefined, fallback: AIPurpose = "analysis"): AIPurpose {
  return value === "search" ? "search" : fallback;
}

function stageDefault(stage: AIStage): AISettings {
  const def = STAGE_DEFAULTS[stage];
  const purpose = def.purpose as AIPurpose;
  return {
    provider: def.provider,
    model: def.model,
    purpose,
    webSearch: purpose === "search",
  };
}

export function normalizeAISettings(
  providerValue?: string,
  modelValue?: string,
  fallback: AISettings = { provider: DEFAULTS.provider, model: DEFAULTS.model, purpose: "analysis" },
  purposeValue?: string
): AISettings {
  const provider = (isProvider(providerValue) ? providerValue : fallback.provider) as AISettings["provider"];
  const model = (modelValue || (isProvider(providerValue) ? DEFAULT_MODEL_BY_PROVIDER[provider] : fallback.model) || DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULTS.model).slice(0, 100);
  const purpose = normalizePurpose(purposeValue, fallback.purpose === "search" ? "search" : "analysis");
  return { provider, model, promptTemplate: fallback.promptTemplate ?? null, purpose, webSearch: purpose === "search" };
}

export function isLoggedIn(userId: string): boolean {
  return !userId.startsWith("anon:");
}

async function readSettingsRow(env: Env, userId: string): Promise<SettingsRow | null> {
  if (!isLoggedIn(userId)) return null;
  return env.DB.prepare(
    "SELECT default_provider, default_model, custom_prompt, stage_models FROM settings WHERE user_id=?"
  ).bind(userId).first<SettingsRow>();
}

function parseStageModels(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return asRecord(JSON.parse(raw)) || {};
  } catch {
    return {};
  }
}

export function normalizeStageSettingsMap(value: unknown): Record<AIStage, AISettings> {
  const rec = asRecord(value) || {};
  const out = {} as Record<AIStage, AISettings>;
  for (const stage of AI_STAGE_DEFINITIONS) {
    const current = asRecord(rec[stage.id]);
    const fallback = stageDefault(stage.id);
    out[stage.id] = normalizeAISettings(
      asString(current?.provider),
      asString(current?.model),
      fallback,
      asString(current?.purpose)
    );
  }
  return out;
}

function stageSettingsFromRow(row: SettingsRow | null): Record<AIStage, AISettings> {
  return normalizeStageSettingsMap(parseStageModels(row?.stage_models));
}

function baseSettingsFromRow(row: SettingsRow | null): AISettings {
  return normalizeAISettings(row?.default_provider || undefined, row?.default_model || undefined, {
    provider: DEFAULTS.provider,
    model: DEFAULTS.model,
    promptTemplate: row?.custom_prompt || null,
    purpose: "analysis",
  });
}

// summarize/analysis 에 쓸 유효 설정 — stage 가 있으면 단계별 모델, 없으면 전역 기본값.
export async function getEffectiveSettings(env: Env, userId: string, stage?: AIStage): Promise<AISettings> {
  const row = await readSettingsRow(env, userId);
  if (stage && isStage(stage)) {
    const selected = stageSettingsFromRow(row)[stage] || stageDefault(stage);
    return { ...selected, promptTemplate: row?.custom_prompt || null };
  }
  return baseSettingsFromRow(row);
}

// 마이페이지 표시용 — 유효 설정 + 단계별 모델 + 기본 프롬프트 템플릿(편집 출발점).
export async function settingsForApi(env: Env, userId: string) {
  const row = await readSettingsRow(env, userId);
  const eff = baseSettingsFromRow(row);
  const stageModels = stageSettingsFromRow(row);
  return {
    loggedIn: isLoggedIn(userId),
    provider: eff.provider,
    model: eff.model,
    custom_prompt: eff.promptTemplate,
    default_prompt: DEFAULT_PROMPT_TEMPLATE,
    ai_stages: AI_STAGE_DEFINITIONS.map((stage) => ({
      id: stage.id,
      label: stage.label,
      description: stage.description,
      default_provider: stage.provider,
      default_model: stage.model,
      default_purpose: stage.purpose,
    })),
    stage_models: stageModels,
    model_catalog: MODEL_CATALOG,
    purpose_options: [
      { value: "analysis", label: "분석용" },
      { value: "search", label: "인터넷서치용" },
    ],
  };
}

// 마이페이지 "기본 git 대상" 표시용.
export async function gitDefaultsForApi(env: Env, userId: string) {
  if (!isLoggedIn(userId)) return { default_repo: null, default_project_id: null, default_project_title: null };
  const row = await env.DB.prepare(
    "SELECT default_repo, default_project_id, default_project_title FROM settings WHERE user_id=?"
  ).bind(userId).first<{ default_repo?: string; default_project_id?: string; default_project_title?: string }>();
  return {
    default_repo: row?.default_repo || null,
    default_project_id: row?.default_project_id || null,
    default_project_title: row?.default_project_title || null,
  };
}

// git 컬럼만 갱신(AI 설정 컬럼은 건드리지 않음).
export async function saveGitDefaults(
  env: Env, userId: string,
  body: { default_repo?: string | null; default_project_id?: string | null; default_project_title?: string | null }
): Promise<void> {
  const repo = body.default_repo && /^[\w.-]+\/[\w.-]+$/.test(body.default_repo) ? body.default_repo : null;
  const projId = body.default_project_id ? String(body.default_project_id).slice(0, 100) : null;
  const projTitle = body.default_project_title ? String(body.default_project_title).slice(0, 200) : null;
  await env.DB.prepare(
    `INSERT INTO settings (user_id, default_repo, default_project_id, default_project_title, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       default_repo=excluded.default_repo,
       default_project_id=excluded.default_project_id,
       default_project_title=excluded.default_project_title,
       updated_at=excluded.updated_at`
  ).bind(userId, repo, projId, projTitle, new Date().toISOString()).run();
}

export async function saveSettings(
  env: Env, userId: string,
  body: { provider?: string; model?: string; custom_prompt?: string | null; stage_models?: unknown }
): Promise<void> {
  const { provider, model } = normalizeAISettings(body.provider, body.model);
  const cp = body.custom_prompt && body.custom_prompt.trim() ? body.custom_prompt.slice(0, 8000) : null;
  const stageModels = JSON.stringify(normalizeStageSettingsMap(body.stage_models));
  await env.DB.prepare(
    `INSERT INTO settings (user_id, default_provider, default_model, custom_prompt, stage_models, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       default_provider=excluded.default_provider,
       default_model=excluded.default_model,
       custom_prompt=excluded.custom_prompt,
       stage_models=excluded.stage_models,
       updated_at=excluded.updated_at`
  ).bind(userId, provider, model, cp, stageModels, new Date().toISOString()).run();
}
