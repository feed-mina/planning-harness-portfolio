import {
  applyManifestPatch,
  validateManifestPatch,
} from "./ai-model-router.js";

export const AI_STUDIO_EVENT_TYPES = Object.freeze([
  "ai.started",
  "ai.text.delta",
  "ai.patch.delta",
  "ai.completed",
  "ai.failed",
]);

const PATCH_OPERATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    op: { type: "string", enum: ["add", "replace", "remove"] },
    path: { type: "string" },
    value: {},
  },
  required: ["op", "path"],
};

export const MANIFEST_PATCH_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    patch: {
      type: "array",
      items: PATCH_OPERATION_SCHEMA,
    },
  },
  required: ["patch"],
});

export class AiResponsesAdapterError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "AiResponsesAdapterError";
    this.code = code;
    this.status = options.status;
    this.issues = options.issues;
  }
}

function safeRoute(route) {
  return {
    provider: route.provider,
    model: route.model,
    taskType: route.taskType,
    reasoning: route.reasoning,
    plan: route.plan,
  };
}

function adapterError(code, message, options) {
  if (message instanceof AiResponsesAdapterError) return message;
  return new AiResponsesAdapterError(code, message, options);
}

function safeFailure(error) {
  if (error instanceof AiResponsesAdapterError) {
    return { code: error.code, message: error.message };
  }
  if (error?.name === "AbortError") {
    return { code: "aborted", message: "AI request was aborted" };
  }
  return { code: "upstream_error", message: "AI provider request failed" };
}

function ensureRoute(route) {
  if (!route || typeof route.model !== "string" || !route.model) {
    throw adapterError("invalid_route", "A routed AI model is required");
  }
}

function ensureApiKey(apiKey) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw adapterError("missing_api_key", "AI provider credentials are not configured");
  }
}

function ensureTransport(transport) {
  if (!transport || typeof transport.create !== "function" || typeof transport.stream !== "function") {
    throw adapterError("invalid_transport", "A Responses API transport is required");
  }
}

function assertGatewayAllowed(gate) {
  if (gate && gate.allowed !== true) {
    throw adapterError(
      "gateway_denied",
      "AI gateway denied the request",
      { status: gate.status }
    );
  }
}

export function buildResponsesRequest(route, options = {}) {
  ensureRoute(route);
  const request = {
    model: route.model,
    input: options.input ?? "",
    stream: options.stream === true,
    store: false,
    reasoning: route.reasoning,
    text: {
      format: {
        type: "json_schema",
        name: "sdui_manifest_patch",
        strict: true,
        schema: MANIFEST_PATCH_RESPONSE_SCHEMA,
      },
    },
  };

  if (options.instructions) request.instructions = options.instructions;
  if (options.previousResponseId) request.previous_response_id = options.previousResponseId;
  if (options.promptCacheKey) request.prompt_cache_key = options.promptCacheKey;
  if (options.safetyIdentifier) request.safety_identifier = options.safetyIdentifier;
  return request;
}

function outputTextFromItems(items) {
  if (!Array.isArray(items)) return "";
  return items
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((content) => content?.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("");
}

export function extractResponseText(response, fallbackText = "") {
  if (typeof response?.output_text === "string") return response.output_text;
  const outputText = outputTextFromItems(response?.output);
  return outputText || fallbackText;
}

export function parseManifestPatchResponse(response, fallbackText = "") {
  const text = extractResponseText(response, fallbackText);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw adapterError("invalid_ai_output", "AI response was not valid JSON");
  }

  if (!parsed || Array.isArray(parsed) || !Array.isArray(parsed.patch)) {
    throw adapterError("invalid_ai_output", "AI response did not contain a manifest patch");
  }

  const validation = validateManifestPatch(parsed.patch);
  if (!validation.valid) {
    throw adapterError("invalid_manifest_patch", "AI response contained an invalid manifest patch", {
      issues: validation.issues,
    });
  }

  return {
    responseId: response?.id || null,
    patch: parsed.patch,
    rawText: text,
  };
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

export function normalizeUsage(usage = {}) {
  const inputTokens = numberOrZero(usage.input_tokens);
  const cachedTokens = Math.min(inputTokens, numberOrZero(usage.input_tokens_details?.cached_tokens));
  return {
    inputTokens,
    outputTokens: numberOrZero(usage.output_tokens),
    totalTokens: numberOrZero(usage.total_tokens),
    cachedTokens,
    billableInputTokens: inputTokens - cachedTokens,
    reasoningTokens: numberOrZero(usage.output_tokens_details?.reasoning_tokens),
  };
}

export function createUsageEvent(route, usage, options = {}) {
  return {
    type: "ai.usage",
    occurredAt: (options.now || new Date()).toISOString(),
    responseId: options.responseId || null,
    prompt: options.prompt ? { id: options.prompt.id, version: options.prompt.version } : null,
    dimensions: {
      ...(options.dimensions || {}),
      provider: route.provider,
      model: route.model,
      taskType: route.taskType,
    },
    usage: normalizeUsage(usage),
  };
}

function responseIdFrom(event, fallback = null) {
  return event?.response?.id || event?.response_id || event?.id || fallback;
}

function failedEvent(responseId, error) {
  return {
    type: "ai.failed",
    responseId,
    error: safeFailure(error),
  };
}

export async function* normalizeResponsesStream(events, context = {}) {
  let responseId = context.responseId || null;
  let text = context.text || "";
  let started = context.started === true;

  for await (const event of events) {
    const eventType = event?.type;
    if (eventType === "response.created" || eventType === "response.in_progress") {
      responseId = responseIdFrom(event, responseId);
      if (!started) {
        started = true;
        yield { type: "ai.started", responseId };
      }
      continue;
    }

    if (eventType === "response.output_text.delta") {
      responseId = responseIdFrom(event, responseId);
      const delta = typeof event.delta === "string" ? event.delta : "";
      text += delta;
      if (delta) yield { type: "ai.text.delta", responseId, delta };
      continue;
    }

    if (eventType === "response.output_text.done") {
      responseId = responseIdFrom(event, responseId);
      if (typeof event.text === "string") text = event.text;
      continue;
    }

    if (eventType === "response.completed") {
      const response = event.response || event;
      responseId = responseIdFrom(event, responseId);
      try {
        const parsed = parseManifestPatchResponse(response, text);
        yield {
          type: "ai.patch.delta",
          responseId,
          operations: parsed.patch,
        };
        yield {
          type: "ai.completed",
          responseId,
          patch: parsed.patch,
          usage: normalizeUsage(response.usage),
          status: response.status || "completed",
        };
      } catch (error) {
        yield failedEvent(responseId, error);
      }
      return;
    }

    if (eventType === "response.failed" || eventType === "error") {
      responseId = responseIdFrom(event, responseId);
      yield failedEvent(responseId, adapterError("upstream_error", "AI provider returned an error"));
      return;
    }
  }
}

async function responseBodyError(response) {
  throw adapterError(
    "upstream_error",
    `OpenAI Responses API returned HTTP ${response.status}`,
    { status: response.status }
  );
}

async function requestJson(fetchImpl, endpoint, apiKey, body, signal) {
  ensureApiKey(apiKey);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw error?.name === "AbortError"
      ? error
      : adapterError("upstream_error", "AI provider request failed");
  }
  if (!response.ok) await responseBodyError(response);
  return response.json();
}

async function* parseSseResponse(response) {
  if (!response.body || typeof response.body.getReader !== "function") {
    throw adapterError("invalid_stream", "AI provider did not return a readable stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];

  const queuedEvents = [];
  const flushLine = (line) => {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
      return;
    }
    if (line !== "" || dataLines.length === 0) return;
    const data = dataLines.join("\n");
    dataLines = [];
    if (data === "[DONE]") {
      queuedEvents.push({ type: "__done__" });
      return;
    }
    try {
      queuedEvents.push(JSON.parse(data));
    } catch {
      throw adapterError("invalid_stream", "AI provider returned invalid stream data");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) flushLine(line);
    if (done) {
      flushLine(buffer);
      flushLine("");
    }
    while (queuedEvents.length) {
      const event = queuedEvents.shift();
      if (event.type === "__done__") return;
      yield event;
    }
    if (done) return;
  }
}

export function createFetchResponsesTransport(options = {}) {
  const {
    apiKey,
    endpoint = "https://api.openai.com/v1/responses",
    fetchImpl = globalThis.fetch,
  } = options;
  if (typeof fetchImpl !== "function") {
    throw adapterError("invalid_transport", "fetch is not available");
  }

  return {
    create(body, requestOptions = {}) {
      return requestJson(fetchImpl, endpoint, apiKey, body, requestOptions.signal);
    },
    async *stream(body, requestOptions = {}) {
      ensureApiKey(apiKey);
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: requestOptions.signal,
        });
      } catch (error) {
        throw error?.name === "AbortError"
          ? error
          : adapterError("upstream_error", "AI provider request failed");
      }
      if (!response.ok) await responseBodyError(response);
      yield* parseSseResponse(response);
    },
  };
}

export function createResponsesAdapter(options = {}) {
  const { transport, onUsage } = options;
  ensureTransport(transport);

  return {
    async generate(request = {}) {
      assertGatewayAllowed(request.gate);
      const body = buildResponsesRequest(request.route, {
        ...request,
        stream: false,
      });
      let response;
      try {
        response = await transport.create(body, { signal: request.signal });
        const parsed = parseManifestPatchResponse(response);
        const manifest = request.manifest === undefined
          ? undefined
          : applyManifestPatch(request.manifest, parsed.patch);
        const usageEvent = createUsageEvent(request.route, response.usage, {
          responseId: parsed.responseId,
          dimensions: request.dimensions,
          prompt: request.prompt,
        });
        if (onUsage) await onUsage(usageEvent);
        return {
          type: "ai.completed",
          responseId: parsed.responseId,
          route: safeRoute(request.route),
          patch: parsed.patch,
          manifest,
          usage: usageEvent.usage,
          usageEvent,
        };
      } catch (error) {
        throw error instanceof AiResponsesAdapterError
          ? error
          : adapterError("upstream_error", "AI provider request failed");
      }
    },

    async *stream(request = {}) {
      const route = safeRoute(request.route);
      let responseId = null;
      yield { type: "ai.started", responseId, route };

      try {
        assertGatewayAllowed(request.gate);
        const body = buildResponsesRequest(request.route, {
          ...request,
          stream: true,
        });
        const events = transport.stream(body, { signal: request.signal });
        for await (const event of normalizeResponsesStream(events, { started: true })) {
          responseId = event.responseId || responseId;
          if (event.type === "ai.completed") {
            const manifest = request.manifest === undefined
              ? undefined
              : applyManifestPatch(request.manifest, event.patch);
            const usageEvent = createUsageEvent(request.route, event.usage, {
              responseId,
              dimensions: request.dimensions,
              prompt: request.prompt,
            });
            if (onUsage) await onUsage(usageEvent);
            yield { ...event, route, manifest, usageEvent };
          } else {
            yield { ...event, route };
          }
        }
      } catch (error) {
        yield { ...failedEvent(responseId, error), route };
      }
    },
  };
}
