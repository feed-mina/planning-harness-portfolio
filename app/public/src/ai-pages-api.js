import { evaluateAiGatewayRequest, MemoryUsageCounter } from "./ai-gateway.js";
import { attachAiRouteToGatewayRequest, routeAiTask } from "./ai-model-router.js";
import {
  createFetchResponsesTransport,
  createResponsesAdapter,
} from "./ai-responses-adapter.js";
import { resolveStudioAiPrompt } from "./ai-prompt-registry.js";
import { D1AiUsageStore } from "./ai-usage-store.js";
import { validateSketchInput } from "./sketch-input.js";
import { multimodalStudioInput, validateReferenceImageInput } from "./reference-image-input.js";
import { createByokTransport, readByok } from "./byok-providers.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export class AiPagesHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AiPagesHttpError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function textDimension(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function errorPayload(error) {
  return {
    ok: false,
    error: {
      code: error.code || "internal_error",
      message: error.message || "AI API request failed",
    },
  };
}

function adapterErrorStatus(error) {
  if (error.code === "aborted") return 499;
  if (["missing_api_key", "gateway_unconfigured"].includes(error.code)) return 503;
  if (["upstream_error", "invalid_ai_output", "invalid_manifest_patch"].includes(error.code)) return 502;
  if (error.code === "gateway_denied") return error.status || 402;
  if (["invalid_route", "unsupported_ai_task", "unsupported_ai_plan"].includes(error.code)) return 400;
  return 500;
}

function corsHeaders(origin) {
  const headers = new Headers({
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type, x-ai-gateway-key, x-ai-provider, x-ai-provider-key",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
    vary: "Origin",
  });
  return headers;
}

function jsonResponse(status, payload, origin) {
  const headers = corsHeaders(origin);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(payload), { status, headers });
}

function streamResponse(iterator, origin) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of iterator) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ai.done" })}\n\n`));
        controller.close();
      } catch (error) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: "ai.failed",
          error: { code: error.code || "internal_error", message: error.message || "AI stream failed" },
        })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ai.done" })}\n\n`));
        controller.close();
      }
    },
  });
  const headers = corsHeaders(origin);
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("x-accel-buffering", "no");
  return new Response(body, { status: 200, headers });
}

async function readJsonBody(request, maxBodyBytes) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBodyBytes) {
    throw new AiPagesHttpError(413, "body_too_large", "Request body exceeds the size limit");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBodyBytes) {
    throw new AiPagesHttpError(413, "body_too_large", "Request body exceeds the size limit");
  }
  if (!raw.trim()) {
    throw new AiPagesHttpError(400, "invalid_json", "Request body must be JSON");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new AiPagesHttpError(400, "invalid_json", "Request body must be valid JSON");
  }
}

function validateAssistBody(body) {
  if (!isRecord(body)) throw new AiPagesHttpError(400, "invalid_request", "Request body must be an object");
  if (typeof body.taskType !== "string" || !body.taskType.trim()) throw new AiPagesHttpError(400, "invalid_task_type", "taskType is required");
  if (body.input === undefined) throw new AiPagesHttpError(400, "invalid_input", "input is required");
  if (!isRecord(body.manifest)) throw new AiPagesHttpError(400, "invalid_manifest", "manifest must be a JSON object");
  if (body.plan !== undefined && (typeof body.plan !== "string" || !body.plan.trim())) throw new AiPagesHttpError(400, "invalid_plan", "plan must be a non-empty string");
  if (body.feature !== undefined && (typeof body.feature !== "string" || !body.feature.trim())) throw new AiPagesHttpError(400, "invalid_feature", "feature must be a non-empty string");
  if (body.dimensions !== undefined && !isRecord(body.dimensions)) throw new AiPagesHttpError(400, "invalid_dimensions", "dimensions must be an object");
  const sketch = validateSketchInput(body.sketch);
  if (!sketch.valid) throw new AiPagesHttpError(sketch.status, sketch.code, sketch.message);
  const reference = validateReferenceImageInput(body.reference);
  if (!reference.valid) throw new AiPagesHttpError(reference.status, reference.code, reference.message);
  return body;
}

function authorizationCredential(request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return request.headers.get("x-ai-gateway-key") || "";
}

function requestDimensions(body, credential) {
  const dimensions = isRecord(body.dimensions) ? body.dimensions : {};
  return {
    org: textDimension(dimensions.org, "org:unknown"),
    project: textDimension(dimensions.project, "project:default"),
    user: textDimension(dimensions.user, credential ? "user:gateway" : "user:anonymous"),
  };
}

function createGatewayCheck(body, route, credential, gatewayKey, plans, counter) {
  const dimensions = requestDimensions(body, credential);
  return {
    dimensions,
    gate: evaluateAiGatewayRequest(
      attachAiRouteToGatewayRequest({
        apiKey: credential || gatewayKey,
        plan: body.plan || "free",
        feature: body.feature || "ai-chat",
        dimensions,
      }, route),
      { validKeys: gatewayKey ? [gatewayKey] : [], plans, counter }
    ),
  };
}

export function createAiPagesHandler(options = {}) {
  const maxBodyBytes = options.maxBodyBytes || DEFAULT_MAX_BODY_BYTES;
  const counter = options.counter || new MemoryUsageCounter();

  return async function handleAiPagesRequest(context) {
    const request = context.request;
    const env = context.env || {};
    const url = new URL(request.url);
    const path = url.pathname;
    const gatewayKey = options.gatewayKey ?? env.AI_GATEWAY_KEY ?? "";
    const openAiApiKey = options.openAiApiKey ?? env.OPENAI_API_KEY ?? "";
    const corsOrigin = options.corsOrigin ?? env.AI_CORS_ORIGIN ?? request.headers.get("origin") ?? "*";
    const plans = options.plans;
    const customTransport = options.transport;

    if (request.method === "OPTIONS" && path.startsWith("/api/ai/")) {
      return new Response(null, { status: 204, headers: corsHeaders(corsOrigin) });
    }

    if (path === "/api/ai/health" && request.method === "GET") {
      return jsonResponse(200, {
        ok: true,
        service: "sdui-ai-api",
        adapter: "responses-api",
        runtime: "cloudflare-pages-functions",
        openAiConfigured: Boolean(openAiApiKey || customTransport),
        gatewayConfigured: Boolean(gatewayKey),
      }, corsOrigin);
    }

    const stream = path === "/api/ai/assist/stream";
    const assist = path === "/api/ai/assist";
    if (!((stream || assist) && request.method === "POST")) {
      return path.startsWith("/api/ai/")
        ? jsonResponse(404, { ok: false, error: { code: "not_found", message: "AI API route not found" } }, corsOrigin)
        : null;
    }

    try {
      const byok = readByok(request);
      const credential = authorizationCredential(request);
      if (!byok && (!gatewayKey || credential !== gatewayKey)) {
        return jsonResponse(gatewayKey ? 401 : 503, {
          ok: false,
          error: {
            code: gatewayKey ? "unauthenticated" : "gateway_unconfigured",
            message: gatewayKey ? "AI gateway authentication failed" : "AI gateway credentials are not configured",
          },
        }, corsOrigin);
      }

      const body = validateAssistBody(await readJsonBody(request, maxBodyBytes));
      if (options.resolveEntitlement) {
        const entitlement = await options.resolveEntitlement({ request, body, env });
        if (!entitlement?.features?.includes("ai.request")) throw new AiPagesHttpError(402, "plan_required", "AI feature is not available for this plan");
        body.plan = "ai-ops";
      }
      const route = routeAiTask({ taskType: body.taskType, plan: body.plan || "free" });
      const { dimensions, gate } = byok
        ? { dimensions: requestDimensions(body, "byok"), gate: { allowed: true, quota: 0, usage: 0, plan: body.plan || "ai-ops" } }
        : createGatewayCheck(body, route, credential, gatewayKey, plans, counter);
      if (!gate.allowed) {
        return jsonResponse(gate.status, {
          ok: false,
          error: {
            code: gate.code,
            message: gate.code === "quota_exceeded" ? "AI usage quota exceeded" : "AI feature is not available for this plan",
          },
          quota: gate.quota,
          usage: gate.usage,
        }, corsOrigin);
      }

      const usageStore = options.usageStore || (env.STUDIO_DB ? new D1AiUsageStore(env.STUDIO_DB) : null);
      if (usageStore && gate.quota > 0) {
        const reservation = await usageStore.reserve(gate, {
          ...dimensions,
          provider: route.provider,
          model: route.model,
          taskType: route.taskType,
        });
        if (!reservation.allowed) {
          return jsonResponse(429, {
            ok: false,
            error: { code: "quota_exceeded", message: "AI usage quota exceeded" },
            quota: reservation.quota,
            usage: reservation.usage,
          }, corsOrigin);
        }
        gate.usage = reservation.usage;
      }

      if (!byok && !customTransport && !openAiApiKey) {
        return jsonResponse(503, { ok: false, error: { code: "missing_api_key", message: "AI provider credentials are not configured" } }, corsOrigin);
      }

      const transport = byok
        ? (byok.provider === "openai" ? createFetchResponsesTransport({ apiKey: byok.apiKey }) : createByokTransport(byok))
        : (customTransport || createFetchResponsesTransport({ apiKey: openAiApiKey }));
      const adapter = createResponsesAdapter({
        transport,
        onUsage: async (event) => {
          if (usageStore) await usageStore.record(event);
          if (options.onUsage) await options.onUsage(event);
        },
      });
      const prompt = resolveStudioAiPrompt(body.taskType, {
        intent: body.input,
        manifest: body.manifest,
        locale: body.locale,
        selection: body.selection,
      }, options.promptRegistry);
      const adapterRequest = {
        route,
        gate,
        input: multimodalStudioInput(prompt.input, body.sketch, body.reference),
        instructions: prompt.instructions,
        promptCacheKey: prompt.cacheKey,
        prompt: { id: prompt.id, version: prompt.version },
        manifest: body.manifest,
        dimensions,
        signal: request.signal,
      };

      if (stream) return streamResponse(adapter.stream(adapterRequest), corsOrigin);
      const result = await adapter.generate(adapterRequest);
      return jsonResponse(200, {
        ok: true,
        type: result.type,
        responseId: result.responseId,
        route: result.route,
        patch: result.patch,
        manifest: result.manifest,
        usage: result.usage,
      }, corsOrigin);
    } catch (error) {
      return jsonResponse(error instanceof AiPagesHttpError ? error.status : adapterErrorStatus(error), errorPayload(error), corsOrigin);
    }
  };
}
