// 멀티 provider AI 프록시 — 회의 전사 → 회의록 Markdown. 키는 서버 secret.
// 프롬프트는 템플릿(플레이스홀더)로, 마이페이지 커스텀 프롬프트를 그대로 적용.
import type { Env } from "./env";

export interface MeetingMeta {
  transcript: string;
  date: string;
  time?: string;
  attendees?: string;
  subject?: string;
}
export type AIPurpose = "analysis" | "search";
export interface AISettings {
  provider: "claude" | "openai" | "gemini";
  model: string;
  promptTemplate?: string | null; // null 이면 DEFAULT_PROMPT_TEMPLATE
  purpose?: AIPurpose;
  webSearch?: boolean;
}
export interface SummarizeResult {
  markdown: string; provider: string; model: string; inputTokens: number; outputTokens: number; fallbackFrom?: string | null;
}
export interface GenerateTextResult {
  text: string; provider: string; model: string; inputTokens: number; outputTokens: number; fallbackFrom?: string | null;
}

type ProviderCallResult = { text: string; inputTokens: number; outputTokens: number };

// provider 한 곳이 응답을 붙잡고 있으면 fallback 까지 못 가고 브라우저 쪽에서 통째로 타임아웃난다.
// 호출마다 상한을 두고, 초과하면 회수 가능한 오류로 취급해 다음 provider 로 넘긴다.
// 최대 4회(기본 + fallback 3) × 이 값이 클라이언트 상한(api-client.js LONG_RUNNING_TIMEOUT_MS)보다 작아야 한다.
const PROVIDER_TIMEOUT_MS = 60000;
const PROVIDER_TIMEOUT_MARKER = "provider_timeout";

async function providerFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(`${label} ${PROVIDER_TIMEOUT_MARKER}: ${PROVIDER_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다.`);
    }
    throw err;
  }
}

const QUOTA_FALLBACKS: AISettings[] = [
  { provider: "gemini", model: "gemini-2.5-flash" },
  { provider: "claude", model: "claude-sonnet-4-6" },
  { provider: "openai", model: "gpt-5-mini" },
];

// 마이페이지에서 편집 가능한 기본 프롬프트 템플릿.
// 플레이스홀더: {{date}} {{time}} {{subject}} {{attendees}} {{transcript}}
export const DEFAULT_PROMPT_TEMPLATE = `아래 회의 전사 텍스트를 한국어 회의록 Markdown 으로 정리해줘.
반드시 아래 형식/섹션을 그대로 지켜(설명·코드펜스 없이 Markdown 본문만 출력):

# {{date}} {{time}} 회의 — {{subject}}

## 참석자
{{attendees}}

## 안건
- (핵심 안건들)

## 결정사항 (Decisions)
- (합의/결정된 것)

## 요약
(3~5문장 요약)

## 할 일 (Action Items)
- [ ] <할 일> — @담당자 ~YYYY-MM-DD [priority:High|Medium|Low]

## 참고 / 링크
- (있으면)

규칙:
- 할 일은 반드시 위 라인 형식(" — ", @담당자, ~마감일, [priority:...])을 지켜라. 불명확하면 @담당자 / ~{{date}}.
- 전사에 없는 내용을 지어내지 마라.

[전사 텍스트]
{{transcript}}`;

function attendeesBlock(attendees?: string): string {
  const raw = (attendees || "").trim();
  if (!raw) return "- @담당자1";
  return raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    .map((s) => "- " + (s.startsWith("@") ? s : "@" + s)).join("\n");
}

// 템플릿 렌더 — 플레이스홀더 치환 + 빈 값으로 생긴 잔여물(중복 공백, 라인 끝 " — ") 정리.
export function renderPrompt(template: string, meta: MeetingMeta): string {
  const map: Record<string, string> = {
    date: meta.date || "",
    time: meta.time || "",
    subject: meta.subject || "",
    attendees: attendeesBlock(meta.attendees),
    transcript: meta.transcript || "",
  };
  let out = template.replace(/\{\{\s*(date|time|subject|attendees|transcript)\s*\}\}/g, (_, k) => map[k]);
  // 커스텀 프롬프트에 {{transcript}} 가 없으면 전사를 끝에 붙인다.
  if (!/\{\{\s*transcript\s*\}\}/.test(template) && !out.includes(meta.transcript) && meta.transcript) {
    out += `\n\n[전사 텍스트]\n${meta.transcript}`;
  }
  // 헤더 등에서 빈 time/subject 로 생긴 잔여물 정리
  out = out.replace(/[ \t]{2,}/g, " ").replace(/ — (?=\n|$)/g, "").replace(/—[ \t]*(?=\n|$)/g, "");
  return out;
}

async function callClaude(env: Env, model: string, prompt: string, webSearch = false): Promise<ProviderCallResult> {
  const res = await providerFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
      ...(webSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }] } : {}),
    }),
  }, "Anthropic");
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return { text: (data.content || []).map((b: any) => b.text || "").join("").trim(),
    inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
}
async function callOpenAI(env: Env, model: string, prompt: string, webSearch = false): Promise<ProviderCallResult> {
  if (webSearch) {
    const res = await providerFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, tools: [{ type: "web_search" }], input: prompt }),
    }, "OpenAI");
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    const text = data.output_text || (data.output || []).flatMap((item: any) => item.content || [])
      .map((part: any) => part.text || "").join("").trim();
    return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
  }
  const res = await providerFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
  }, "OpenAI");
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return { text: (data.choices?.[0]?.message?.content || "").trim(),
    inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
}
// ---- Vertex AI (서비스 계정 OAuth) ----
// 서비스 계정 JSON(secret)이 설정되면 AI Studio 키 대신 Vertex 리전 엔드포인트로 호출 → "User location" 차단 회피.
export interface ServiceAccount { client_email: string; private_key: string; project_id?: string; token_uri: string; }
let cachedVertexToken: { token: string; exp: number } | null = null;

export function parseServiceAccount(env: Env): ServiceAccount | null {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  try {
    const j = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as Record<string, string>;
    if (!j.client_email || !j.private_key) return null;
    return { client_email: j.client_email, private_key: j.private_key, project_id: j.project_id,
      token_uri: j.token_uri || "https://oauth2.googleapis.com/token" };
  } catch { return null; }
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export async function getVertexToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedVertexToken && cachedVertexToken.exp - 60 > now) return cachedVertexToken.token;
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64url(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri, iat: now, exp: now + 3600,
  })));
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(signingInput));
  const jwt = `${signingInput}.${base64url(sig)}`;
  const res = await fetch(sa.token_uri, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) throw new Error(`Vertex 토큰 발급 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  if (!data.access_token) throw new Error("Vertex 토큰 응답에 access_token 없음");
  cachedVertexToken = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) };
  return cachedVertexToken.token;
}

async function callGeminiVertex(env: Env, sa: ServiceAccount, model: string, prompt: string, webSearch = false): Promise<ProviderCallResult> {
  const location = env.GOOGLE_CLOUD_LOCATION || "us-central1";
  const project = env.GOOGLE_CLOUD_PROJECT_ID || sa.project_id;
  if (!project) throw new Error("Vertex project id 없음(GOOGLE_CLOUD_PROJECT_ID 또는 서비스계정 project_id)");
  const token = await getVertexToken(sa);
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    ...(webSearch ? { tools: [{ googleSearch: {} }] } : {}),
  };
  const res = await providerFetch(url, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }, "Vertex");
  if (!res.ok) throw new Error(`Vertex ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return { text: (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim(),
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 };
}

async function callGemini(env: Env, model: string, prompt: string, webSearch = false): Promise<ProviderCallResult> {
  // 서비스 계정이 있으면 Vertex(위치 차단 회피), 없으면 AI Studio 키.
  const sa = parseServiceAccount(env);
  if (sa) return callGeminiVertex(env, sa, model, prompt, webSearch);
  if (!env.GEMINI_API_KEY) throw new Error("Gemini 설정 없음(GEMINI_API_KEY 또는 GOOGLE_SERVICE_ACCOUNT_JSON)");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    ...(webSearch ? { tools: [{ googleSearch: {} }] } : {}),
  };
  const res = await providerFetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, "Gemini");
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return { text: (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim(),
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 };
}

function isRecoverableProviderError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return new RegExp(`\\b429\\b|quota|rate limit|resource_exhausted|too many requests|failed_precondition|user location is not supported|unsupported_country_region_territory|request not allowed|${PROVIDER_TIMEOUT_MARKER}`, "i").test(msg);
}

function hasProviderKey(env: Env, provider: AISettings["provider"]): boolean {
  if (provider === "claude") return !!env.ANTHROPIC_API_KEY;
  if (provider === "openai") return !!env.OPENAI_API_KEY;
  return !!env.GEMINI_API_KEY || !!env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

async function callProvider(env: Env, settings: AISettings, prompt: string): Promise<ProviderCallResult> {
  const webSearch = !!settings.webSearch;
  switch (settings.provider) {
    case "claude": return callClaude(env, settings.model, prompt, webSearch);
    case "openai": return callOpenAI(env, settings.model, prompt, webSearch);
    case "gemini": return callGemini(env, settings.model, prompt, webSearch);
    default: throw new Error("알 수 없는 provider: " + settings.provider);
  }
}

export async function generateText(env: Env, prompt: string, settings: AISettings): Promise<GenerateTextResult> {
  const attempts: AISettings[] = [];
  const seen = new Set<string>();
  const fallbackCandidates = settings.webSearch
    ? QUOTA_FALLBACKS.map((candidate) => ({ ...candidate, purpose: "search" as const, webSearch: true }))
    : QUOTA_FALLBACKS;
  for (const candidate of [settings, ...fallbackCandidates]) {
    const key = `${candidate.provider}/${candidate.model}`;
    if (!seen.has(key)) {
      seen.add(key);
      attempts.push(candidate);
    }
  }

  const fallbackErrors: string[] = [];
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const label = `${attempt.provider}/${attempt.model}`;
    if (!hasProviderKey(env, attempt.provider)) {
      fallbackErrors.push(`${label}: API key 없음`);
      continue;
    }

    try {
      const out = await callProvider(env, attempt, prompt);
      if (!out.text) throw new Error("빈 응답");
      return {
        text: out.text,
        provider: attempt.provider,
        model: attempt.model,
        inputTokens: out.inputTokens,
        outputTokens: out.outputTokens,
        fallbackFrom: i === 0 ? null : `${settings.provider}/${settings.model}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (i === 0 && !isRecoverableProviderError(err)) throw err;
      fallbackErrors.push(`${label}: ${msg.slice(0, 160)}`);
    }
  }

  throw new Error(`AI provider fallback 실패: ${fallbackErrors.join(" | ")}`);
}

export async function summarize(env: Env, meta: MeetingMeta, settings: AISettings): Promise<SummarizeResult> {
  const prompt = renderPrompt(settings.promptTemplate || DEFAULT_PROMPT_TEMPLATE, meta);
  const out = await generateText(env, prompt, settings);
  return {
    markdown: out.text,
    provider: out.provider,
    model: out.model,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    fallbackFrom: out.fallbackFrom,
  };
}
