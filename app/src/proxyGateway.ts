import type { Env } from "./env";
import { authenticateProxyKey } from "./proxyKeys";
import { checkOrganizationQuota, checkQuota, recordUsageEvent, type QuotaState } from "./domains/usage";

type ProxyProvider = "anthropic" | "openai" | "gemini";

interface ProxyUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers || {}) },
  });
}

function authToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-api-key")
    || request.headers.get("anthropic-api-key")
    || request.headers.get("x-goog-api-key")
    || "";
}

const MAX_USAGE_RESPONSE_BYTES = 1024 * 1024;

function quotaExceeded(scope: "account" | "organization", quota: QuotaState, orgId?: string | null): Response {
  return json({
    error: scope === "organization" ? "Organization AI budget limit exceeded." : "Daily AI budget limit exceeded.",
    scope,
    ...(orgId ? { org_id: orgId } : {}),
    used_krw: quota.used,
    limit_krw: quota.limit,
    warning: quota.warning,
  }, { status: 429 });
}

function cloneHeaders(request: Request): Headers {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);
  return headers;
}

function usageFromAnthropic(data: any, fallbackModel: string): ProxyUsage {
  const usage = data?.usage || {};
  return {
    provider: "claude",
    model: data?.model || fallbackModel || "unknown",
    inputTokens: Number(usage.input_tokens) || 0,
    outputTokens: Number(usage.output_tokens) || 0,
    cacheTokens: (Number(usage.cache_creation_input_tokens) || 0) + (Number(usage.cache_read_input_tokens) || 0),
  };
}

function usageFromOpenAI(data: any, fallbackModel: string): ProxyUsage {
  const usage = data?.usage || {};
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens) || 0;
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens) || 0;
  return {
    provider: "openai",
    model: data?.model || fallbackModel || "unknown",
    inputTokens,
    outputTokens,
    cacheTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens) || 0,
  };
}

function usageFromGemini(data: any, fallbackModel: string): ProxyUsage {
  const usage = data?.usageMetadata || {};
  const promptTokens = Number(usage.promptTokenCount) || 0;
  const candidatesTokens = Number(usage.candidatesTokenCount) || 0;
  const thoughtsTokens = Number(usage.thoughtsTokenCount) || 0;
  const totalTokens = Number(usage.totalTokenCount) || 0;
  const outputTokens = candidatesTokens + thoughtsTokens || Math.max(0, totalTokens - promptTokens);
  return {
    provider: "gemini",
    model: String(data?.modelVersion || fallbackModel || "unknown").replace(/^models\//, ""),
    inputTokens: promptTokens,
    outputTokens,
    cacheTokens: Number(usage.cachedContentTokenCount) || 0,
  };
}

async function responseUsage(provider: ProxyProvider, response: Response, fallbackModel: string): Promise<ProxyUsage | null> {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) return null;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_USAGE_RESPONSE_BYTES) return null;
  try {
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_USAGE_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (provider === "anthropic") return usageFromAnthropic(data, fallbackModel);
    if (provider === "openai") return usageFromOpenAI(data, fallbackModel);
    return usageFromGemini(data, fallbackModel);
  } catch {
    return null;
  }
}

function appendForwardedQuery(target: URL, request: Request): string {
  const source = new URL(request.url);
  for (const [key, value] of source.searchParams) {
    if (key.toLowerCase() === "key") continue;
    target.searchParams.append(key, value);
  }
  return target.toString();
}

function forwardUrl(provider: ProxyProvider, restPath: string, request: Request): string {
  const clean = restPath.replace(/^\/+/, "");
  if (provider === "anthropic") return appendForwardedQuery(new URL(`https://api.anthropic.com/${clean}`), request);
  if (provider === "openai") return appendForwardedQuery(new URL(`https://api.openai.com/${clean}`), request);
  return appendForwardedQuery(new URL(`https://generativelanguage.googleapis.com/${clean}`), request);
}

function providerHeaders(env: Env, request: Request, provider: ProxyProvider): Headers {
  const headers = cloneHeaders(request);
  if (provider === "anthropic") {
    headers.set("x-api-key", env.ANTHROPIC_API_KEY);
    headers.set("anthropic-version", request.headers.get("anthropic-version") || "2023-06-01");
    const beta = request.headers.get("anthropic-beta");
    if (beta) headers.set("anthropic-beta", beta);
  } else {
    if (provider === "gemini") {
      headers.set("x-goog-api-key", env.GEMINI_API_KEY || "");
      return headers;
    }
    headers.set("authorization", `Bearer ${env.OPENAI_API_KEY}`);
  }
  return headers;
}

function modelFromPath(provider: ProxyProvider, restPath: string): string {
  if (provider !== "gemini") return "unknown";
  const match = restPath.match(/(?:^|\/)models\/([^/:?]+)/);
  return match ? decodeURIComponent(match[1]) : "unknown";
}

async function requestBody(request: Request, provider: ProxyProvider, restPath: string): Promise<{ body: string | null; model: string }> {
  const pathModel = modelFromPath(provider, restPath);
  if (request.method === "GET" || request.method === "HEAD") return { body: null, model: pathModel };
  const text = await request.text();
  try {
    const data = JSON.parse(text);
    return { body: text, model: typeof data?.model === "string" ? data.model : pathModel };
  } catch {
    return { body: text, model: pathModel };
  }
}

function fallbackProvider(provider: ProxyProvider): string {
  if (provider === "anthropic") return "claude";
  if (provider === "openai") return "openai";
  return "gemini";
}

async function recordProxyUsage(
  env: Env,
  provider: ProxyProvider,
  restPath: string,
  response: Response,
  model: string,
  principal: NonNullable<Awaited<ReturnType<typeof authenticateProxyKey>>>,
  requestId: string,
  started: number,
  errorCode: string | null
): Promise<void> {
  const usage = await responseUsage(provider, response, model);
  await recordUsageEvent(env, {
    userId: principal.userId,
    orgId: principal.orgId,
    deviceId: principal.deviceId,
    proxyKeyId: principal.keyId,
    source: "proxy",
    requestId,
    provider: usage?.provider || fallbackProvider(provider),
    model: usage?.model || model,
    inputTokens: usage?.inputTokens || 0,
    outputTokens: usage?.outputTokens || 0,
    cacheTokens: usage?.cacheTokens || 0,
    latencyMs: Date.now() - started,
    statusCode: response.status,
    errorCode,
    metadata: { path: restPath, proxy_provider: provider },
  });
}

export async function handleProxyGateway(env: Env, request: Request, provider: ProxyProvider, restPath: string, ctx?: ExecutionContext): Promise<Response> {
  const key = authToken(request);
  const principal = key ? await authenticateProxyKey(env, key) : null;
  if (!principal) return json({ error: "유효한 프록시 키가 필요합니다." }, { status: 401 });
  const accountQuota = await checkQuota(env, principal.userId);
  if (!accountQuota.allowed) return quotaExceeded("account", accountQuota);
  const organizationQuota = principal.orgId
    ? await checkOrganizationQuota(env, principal.orgId, accountQuota.blockOnExceed)
    : null;
  if (organizationQuota && !organizationQuota.allowed) {
    return quotaExceeded("organization", organizationQuota, principal.orgId);
  }

  if (provider === "anthropic" && !env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 503 });
  if (provider === "openai" && !env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  if (provider === "gemini" && !env.GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY is not configured" }, { status: 503 });

  const started = Date.now();
  const requestId = crypto.randomUUID();
  const body = await requestBody(request, provider, restPath);
  let response: Response;
  let errorCode: string | null = null;

  try {
    response = await fetch(forwardUrl(provider, restPath, request), {
      method: request.method,
      headers: providerHeaders(env, request, provider),
      body: body.body,
    });
  } catch (err: any) {
    errorCode = "upstream_fetch_failed";
    response = json({ error: err?.message || "upstream fetch failed" }, { status: 502 });
  }

  const usageResponse = response.clone();
  const usagePromise = recordProxyUsage(env, provider, restPath, usageResponse, body.model, principal, requestId, started, errorCode);
  if (ctx) ctx.waitUntil(usagePromise);
  else await usagePromise;

  const headers = new Headers(response.headers);
  headers.set("x-harness-proxy-request-id", requestId);
  if (accountQuota.warning) headers.set("x-harness-budget-warning", accountQuota.warning.kind);
  if (organizationQuota?.warning) headers.set("x-harness-org-budget-warning", organizationQuota.warning.kind);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
