import { evaluateAiGatewayRequest, MemoryUsageCounter } from "./ai-gateway.js";
import { routeAiTask, attachAiRouteToGatewayRequest } from "./ai-model-router.js";
import {
  createFetchResponsesTransport,
  createResponsesAdapter,
} from "./ai-responses-adapter.js";
import { validateSketchInput } from "./sketch-input.js";
import { multimodalStudioInput, validateReferenceImageInput } from "./reference-image-input.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_PORT = 4173;

export class AiApiHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AiApiHttpError";
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

function requestPath(request, port) {
  return new URL(request.url || "/", `http://localhost:${port}`).pathname;
}

function setCorsHeaders(response, corsOrigin) {
  response.setHeader("access-control-allow-origin", corsOrigin);
  response.setHeader("access-control-allow-headers", "authorization, content-type, x-ai-gateway-key");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-max-age", "600");
  response.setHeader("vary", "Origin");
}

function sendJson(response, status, payload, corsOrigin) {
  if (response.headersSent) return;
  setCorsHeaders(response, corsOrigin);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
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

function normalizeAuthorization(request) {
  const authorization = request.headers?.authorization || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return request.headers?.["x-ai-gateway-key"] || "";
}

function normalizeAuthorizationResult(result) {
  if (result === true) return { allowed: true, credential: "injected-authorized" };
  if (result && result.allowed === true) {
    return { ...result, credential: result.credential || "injected-authorized" };
  }
  if (result && typeof result.status === "number") return result;
  return { allowed: false, status: 401, code: "unauthenticated" };
}

function readJsonBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks = [];

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (settled) return;
      size += Buffer.byteLength(chunk);
      if (size > maxBodyBytes) {
        request.resume();
        fail(new AiApiHttpError(413, "body_too_large", "Request body exceeds the size limit"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      const raw = chunks.join("");
      if (!raw.trim()) {
        reject(new AiApiHttpError(400, "invalid_json", "Request body must be JSON"));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new AiApiHttpError(400, "invalid_json", "Request body must be valid JSON"));
      }
    });
    request.on("error", () => fail(new AiApiHttpError(400, "request_error", "Request body could not be read")));
  });
}

function validateAssistBody(body) {
  if (!isRecord(body)) {
    throw new AiApiHttpError(400, "invalid_request", "Request body must be an object");
  }
  if (typeof body.taskType !== "string" || !body.taskType.trim()) {
    throw new AiApiHttpError(400, "invalid_task_type", "taskType is required");
  }
  if (body.input === undefined) {
    throw new AiApiHttpError(400, "invalid_input", "input is required");
  }
  if (!isRecord(body.manifest)) {
    throw new AiApiHttpError(400, "invalid_manifest", "manifest must be a JSON object");
  }
  if (body.plan !== undefined && (typeof body.plan !== "string" || !body.plan.trim())) {
    throw new AiApiHttpError(400, "invalid_plan", "plan must be a non-empty string");
  }
  if (body.feature !== undefined && (typeof body.feature !== "string" || !body.feature.trim())) {
    throw new AiApiHttpError(400, "invalid_feature", "feature must be a non-empty string");
  }
  if (body.dimensions !== undefined && !isRecord(body.dimensions)) {
    throw new AiApiHttpError(400, "invalid_dimensions", "dimensions must be an object");
  }
  const sketch = validateSketchInput(body.sketch);
  if (!sketch.valid) throw new AiApiHttpError(sketch.status, sketch.code, sketch.message);
  const reference = validateReferenceImageInput(body.reference);
  if (!reference.valid) throw new AiApiHttpError(reference.status, reference.code, reference.message);
  return body;
}

function requestDimensions(body, authorization) {
  const dimensions = isRecord(body.dimensions) ? body.dimensions : {};
  return {
    org: textDimension(dimensions.org, "org:unknown"),
    project: textDimension(dimensions.project, "project:default"),
    user: textDimension(authorization.user, textDimension(dimensions.user, "user:anonymous")),
  };
}

function writeSse(response, event) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function streamHeaders(response, corsOrigin) {
  setCorsHeaders(response, corsOrigin);
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
}

function buildDefaultTransport(openAiApiKey, fetchImpl) {
  return createFetchResponsesTransport({
    apiKey: openAiApiKey,
    fetchImpl,
  });
}

function createGatewayCheck(body, route, authorization, gatewayKey, plans, counter) {
  const dimensions = requestDimensions(body, authorization);
  return {
    dimensions,
    gate: evaluateAiGatewayRequest(
      attachAiRouteToGatewayRequest({
        apiKey: authorization.credential || gatewayKey,
        plan: body.plan || "free",
        feature: body.feature || "ai-chat",
        dimensions,
      }, route),
      {
        validKeys: gatewayKey ? [gatewayKey] : [],
        plans,
        counter,
      }
    ),
  };
}

export function createAiApiHandler(options = {}) {
  const port = Number(options.port || process.env.PORT || DEFAULT_PORT);
  const maxBodyBytes = options.maxBodyBytes || DEFAULT_MAX_BODY_BYTES;
  const corsOrigin = options.corsOrigin || process.env.AI_CORS_ORIGIN || `http://localhost:${port}`;
  const gatewayKey = options.gatewayKey ?? process.env.AI_GATEWAY_KEY ?? "";
  const openAiApiKey = options.openAiApiKey ?? process.env.OPENAI_API_KEY ?? "";
  const plans = options.plans;
  const counter = options.counter || new MemoryUsageCounter();
  const transport = options.transport || buildDefaultTransport(openAiApiKey, options.fetchImpl);
  const customAuthorize = options.authorize;

  async function authorize(request) {
    if (customAuthorize) {
      return normalizeAuthorizationResult(await customAuthorize(request));
    }
    if (!gatewayKey) {
      return { allowed: false, status: 503, code: "gateway_unconfigured" };
    }
    const credential = normalizeAuthorization(request);
    if (credential !== gatewayKey) {
      return { allowed: false, status: 401, code: "unauthenticated" };
    }
    return { allowed: true, credential };
  }

  async function handleAssist(request, response, stream) {
    const authorization = await authorize(request);
    if (authorization.allowed !== true) {
      sendJson(response, authorization.status || 401, {
        ok: false,
        error: {
          code: authorization.code || "unauthenticated",
          message: authorization.code === "gateway_unconfigured"
            ? "AI gateway credentials are not configured"
            : "AI gateway authentication failed",
        },
      }, corsOrigin);
      return;
    }

    const body = validateAssistBody(await readJsonBody(request, maxBodyBytes));
    const route = routeAiTask({
      taskType: body.taskType,
      plan: body.plan || "free",
    });
    const { dimensions, gate } = createGatewayCheck(
      body,
      route,
      authorization,
      gatewayKey,
      plans,
      counter
    );

    if (!gate.allowed) {
      sendJson(response, gate.status, {
        ok: false,
        error: {
          code: gate.code,
          message: gate.code === "quota_exceeded"
            ? "AI usage quota exceeded"
            : "AI feature is not available for this plan",
        },
        quota: gate.quota,
        usage: gate.usage,
      }, corsOrigin);
      return;
    }

    if (!options.transport && !openAiApiKey) {
      sendJson(response, 503, {
        ok: false,
        error: {
          code: "missing_api_key",
          message: "AI provider credentials are not configured",
        },
      }, corsOrigin);
      return;
    }

    const adapter = createResponsesAdapter({
      transport,
      onUsage: options.onUsage,
    });
    const adapterRequest = {
      route,
      gate,
      input: multimodalStudioInput(body.input, body.sketch, body.reference),
      manifest: body.manifest,
      dimensions,
      signal: request.signal,
    };

    if (!stream) {
      const result = await adapter.generate(adapterRequest);
      sendJson(response, 200, {
        ok: true,
        type: result.type,
        responseId: result.responseId,
        route: result.route,
        patch: result.patch,
        manifest: result.manifest,
        usage: result.usage,
      }, corsOrigin);
      return;
    }

    streamHeaders(response, corsOrigin);
    try {
      for await (const event of adapter.stream(adapterRequest)) {
        writeSse(response, event);
      }
      writeSse(response, { type: "ai.done" });
      response.end();
    } catch (error) {
      writeSse(response, {
        type: "ai.failed",
        error: {
          code: error.code || "internal_error",
          message: error.message || "AI stream failed",
        },
      });
      writeSse(response, { type: "ai.done" });
      response.end();
    }
  }

  return async function aiApiHandler(request, response) {
    const path = requestPath(request, port);
    setCorsHeaders(response, corsOrigin);

    if (request.method === "OPTIONS" && path.startsWith("/api/ai/")) {
      response.writeHead(204);
      response.end();
      return true;
    }

    if (path === "/api/ai/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        service: "sdui-ai-api",
        adapter: "responses-api",
        openAiConfigured: Boolean(openAiApiKey || options.transport),
        gatewayConfigured: Boolean(gatewayKey || customAuthorize),
      }, corsOrigin);
      return true;
    }

    const stream = path === "/api/ai/assist/stream";
    const assist = path === "/api/ai/assist";
    if ((stream || assist) && request.method === "POST") {
      try {
        await handleAssist(request, response, stream);
      } catch (error) {
        if (response.headersSent) {
          if (!response.writableEnded) {
            writeSse(response, {
              type: "ai.failed",
              error: {
                code: error.code || "internal_error",
                message: error.message || "AI request failed",
              },
            });
            writeSse(response, { type: "ai.done" });
            response.end();
          }
          return true;
        }
        const status = error instanceof AiApiHttpError
          ? error.status
          : adapterErrorStatus(error);
        sendJson(response, status, errorPayload(error), corsOrigin);
      }
      return true;
    }

    if (path.startsWith("/api/ai/")) {
      sendJson(response, 404, {
        ok: false,
        error: { code: "not_found", message: "AI API route not found" },
      }, corsOrigin);
      return true;
    }

    return false;
  };
}
