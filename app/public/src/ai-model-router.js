export const AI_MODELS = Object.freeze({
  luna: "gpt-5.6-luna",
  terra: "gpt-5.6-terra",
  sol: "gpt-5.6-sol",
});

export const AI_TASK_ROUTES = Object.freeze({
  "theme-token-suggest": { model: AI_MODELS.terra, reasoningEffort: "medium" },
  "element-style-suggest": { model: AI_MODELS.terra, reasoningEffort: "medium" },
  "screen-generate": { model: AI_MODELS.sol, reasoningEffort: "high" },
  "publish-quality-gate": { model: AI_MODELS.sol, reasoningEffort: "high" },
  "i18n-draft": { model: AI_MODELS.luna, reasoningEffort: "low" },
  "i18n-refine": { model: AI_MODELS.terra, reasoningEffort: "medium" },
  "manifest-error-explain": { model: AI_MODELS.terra, reasoningEffort: "medium" },
  "metadata-generate": { model: AI_MODELS.luna, reasoningEffort: "low" },
  "white-label-design": { model: AI_MODELS.sol, reasoningEffort: "high" },
});

export const AI_PLAN_POLICIES = Object.freeze({
  free: { models: [AI_MODELS.luna], fallbackModel: AI_MODELS.luna, maxReasoningEffort: "low" },
  team: { models: [AI_MODELS.luna, AI_MODELS.terra], fallbackModel: AI_MODELS.terra, maxReasoningEffort: "medium" },
  "pro-template": { models: [AI_MODELS.luna, AI_MODELS.terra], fallbackModel: AI_MODELS.terra, maxReasoningEffort: "medium" },
  pro: { models: Object.values(AI_MODELS), fallbackModel: AI_MODELS.terra, maxReasoningEffort: "high" },
  hosted: { models: Object.values(AI_MODELS), fallbackModel: AI_MODELS.terra, maxReasoningEffort: "high" },
  "ai-ops": { models: Object.values(AI_MODELS), fallbackModel: AI_MODELS.terra, maxReasoningEffort: "high" },
  enterprise: { models: Object.values(AI_MODELS), fallbackModel: AI_MODELS.terra, maxReasoningEffort: "high" },
});

export const MANIFEST_PATCH_ALLOWED_ROOTS = Object.freeze([
  "/theme",
  "/elements",
  "/pages",
  "/messages",
  "/metadata",
  "/components",
]);

const MANIFEST_PATCH_PROTECTED_ROOTS = Object.freeze([
  "/schema",
  "/id",
  "/version",
  "/recommendedTier",
  "/runtimeAdapters",
  "/plugins",
  "/api",
  "/env",
  "/gating",
]);

const REASONING_ORDER = ["low", "medium", "high"];
const MODEL_REASONING_CAP = {
  [AI_MODELS.luna]: "low",
  [AI_MODELS.terra]: "medium",
  [AI_MODELS.sol]: "high",
};
const PATCH_OPERATIONS = new Set(["add", "replace", "remove"]);
const DANGEROUS_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function reasoningAtMost(requested, ...caps) {
  const indexes = [requested, ...caps]
    .map((effort) => REASONING_ORDER.indexOf(effort))
    .filter((index) => index >= 0);
  return REASONING_ORDER[Math.min(...indexes)];
}

function routeError(code, detail) {
  const error = new Error(detail);
  error.code = code;
  return error;
}

export function routeAiTask(request, options = {}) {
  const taskType = request?.taskType;
  const taskRoute = AI_TASK_ROUTES[taskType];
  if (!taskRoute) {
    throw routeError("unsupported_ai_task", `unsupported AI task type: ${taskType || "<empty>"}`);
  }

  const plan = request.plan || "free";
  const policy = (options.planPolicies || AI_PLAN_POLICIES)[plan];
  if (!policy) {
    throw routeError("unsupported_ai_plan", `unsupported AI plan: ${plan}`);
  }

  const requestedModel = request.requestedModel || null;
  const overrideEnabled = options.allowModelOverride === true;
  const requestedModelAllowed = requestedModel && policy.models.includes(requestedModel);
  let model = policy.models.includes(taskRoute.model) ? taskRoute.model : policy.fallbackModel;
  let routeReason = model === taskRoute.model ? "task_default" : "plan_fallback";

  if (requestedModel) {
    if (overrideEnabled && requestedModelAllowed) {
      model = requestedModel;
      routeReason = "approved_override";
    } else {
      routeReason = overrideEnabled ? "override_not_allowed_for_plan" : "override_disabled";
    }
  }

  const requestedReasoning = options.allowReasoningOverride === true
    ? request.requestedReasoningEffort || taskRoute.reasoningEffort
    : taskRoute.reasoningEffort;
  const reasoningEffort = reasoningAtMost(
    requestedReasoning,
    MODEL_REASONING_CAP[model],
    policy.maxReasoningEffort
  );

  return {
    provider: "openai",
    model,
    reasoning: { effort: reasoningEffort },
    taskType,
    plan,
    routeReason,
    requestedModel,
  };
}

export function attachAiRouteToGatewayRequest(request, route) {
  return {
    ...request,
    dimensions: {
      ...(request.dimensions || {}),
      provider: route.provider,
      model: route.model,
      taskType: route.taskType,
    },
  };
}

function pathMatchesRoot(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function decodePointer(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path === "/") {
    throw new Error("path must be a non-root JSON Pointer");
  }

  return path.slice(1).split("/").map((segment) => {
    if (/~(?:[^01]|$)/.test(segment)) {
      throw new Error("path contains an invalid JSON Pointer escape");
    }
    const decoded = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (DANGEROUS_PATH_SEGMENTS.has(decoded)) {
      throw new Error(`path contains a forbidden segment: ${decoded}`);
    }
    return decoded;
  });
}

function patchIssue(index, path, message) {
  return { index, path: path || "$", message };
}

export function validateManifestPatch(operations, options = {}) {
  const issues = [];
  const allowedRoots = options.allowedRoots || MANIFEST_PATCH_ALLOWED_ROOTS;
  const protectedRoots = options.protectedRoots || MANIFEST_PATCH_PROTECTED_ROOTS;

  if (!Array.isArray(operations)) {
    return { valid: false, issues: [patchIssue(-1, "$", "patch must be an array")] };
  }
  if (operations.length > (options.maxOperations || 100)) {
    issues.push(patchIssue(-1, "$", "patch exceeds the operation limit"));
  }

  operations.forEach((operation, index) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      issues.push(patchIssue(index, "$", "operation must be an object"));
      return;
    }
    if (!PATCH_OPERATIONS.has(operation.op)) {
      issues.push(patchIssue(index, operation.path, `unsupported operation: ${operation.op || "<empty>"}`));
    }

    try {
      decodePointer(operation.path);
      if (protectedRoots.some((root) => pathMatchesRoot(operation.path, root))) {
        issues.push(patchIssue(index, operation.path, "path is protected"));
      } else if (!allowedRoots.some((root) => pathMatchesRoot(operation.path, root))) {
        issues.push(patchIssue(index, operation.path, "path is outside the AI-editable manifest roots"));
      }
    } catch (error) {
      issues.push(patchIssue(index, operation.path, error.message));
    }

    if (["add", "replace"].includes(operation.op) && !Object.hasOwn(operation, "value")) {
      issues.push(patchIssue(index, operation.path, `${operation.op} requires a value`));
    }
  });

  return { valid: issues.length === 0, issues };
}

function arrayIndex(segment, length, allowEnd) {
  if (segment === "-" && allowEnd) return length;
  if (!/^\d+$/.test(segment)) return -1;
  const index = Number(segment);
  return index <= length - (allowEnd ? 0 : 1) ? index : -1;
}

function resolvePatchParent(root, segments, createMissing) {
  let current = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    if (Array.isArray(current)) {
      const childIndex = arrayIndex(segment, current.length, false);
      if (childIndex < 0) throw new Error(`array index does not exist: ${segment}`);
      current = current[childIndex];
      continue;
    }
    if (!current || typeof current !== "object") {
      throw new Error(`path parent is not an object: ${segment}`);
    }
    if (!Object.hasOwn(current, segment)) {
      if (!createMissing) throw new Error(`path parent does not exist: ${segment}`);
      current[segment] = /^\d+$/.test(nextSegment) || nextSegment === "-" ? [] : {};
    }
    current = current[segment];
  }
  return { parent: current, key: segments.at(-1) };
}

function applyOperation(root, operation) {
  const segments = decodePointer(operation.path);
  const { parent, key } = resolvePatchParent(root, segments, operation.op === "add");

  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, operation.op === "add");
    if (index < 0) throw new Error(`invalid array index: ${key}`);
    if (operation.op === "add") parent.splice(index, 0, structuredClone(operation.value));
    if (operation.op === "replace") parent[index] = structuredClone(operation.value);
    if (operation.op === "remove") parent.splice(index, 1);
    return;
  }

  if (!parent || typeof parent !== "object") {
    throw new Error("patch parent is not an object");
  }
  if (operation.op !== "add" && !Object.hasOwn(parent, key)) {
    throw new Error(`path does not exist: ${operation.path}`);
  }
  if (operation.op === "remove") delete parent[key];
  else parent[key] = structuredClone(operation.value);
}

export function applyManifestPatch(manifest, operations, options = {}) {
  const validation = validateManifestPatch(operations, options);
  if (!validation.valid) {
    const error = routeError("invalid_manifest_patch", "AI manifest patch validation failed");
    error.issues = validation.issues;
    throw error;
  }

  const next = structuredClone(manifest);
  try {
    operations.forEach((operation) => applyOperation(next, operation));
  } catch (cause) {
    const error = routeError("invalid_manifest_patch", cause.message);
    error.cause = cause;
    throw error;
  }
  return next;
}
