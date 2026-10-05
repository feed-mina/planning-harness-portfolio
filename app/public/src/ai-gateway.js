export const AI_GATEWAY_ERRORS = {
  unauthenticated: { status: 401, code: "unauthenticated" },
  plan_required: { status: 402, code: "plan_required" },
  quota_exceeded: { status: 429, code: "quota_exceeded" },
};

export const DEFAULT_AI_PLANS = {
  free: {
    features: ["static-chat-demo"],
    dailyQuota: 0,
  },
  "ai-ops": {
    features: ["ai-chat", "itinerary-generation", "usage-metering"],
    dailyQuota: 100,
  },
};

export class MemoryUsageCounter {
  constructor() {
    this.counts = new Map();
  }

  incrementAndGet(key) {
    const next = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, next);
    return next;
  }
}

function dayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function usageDimensionKey(request, now = new Date()) {
  const dimensions = request.dimensions || {};
  const parts = [
    dayKey(now),
    dimensions.org || "org:unknown",
    dimensions.project || "project:default",
    dimensions.user || "user:anonymous",
    dimensions.provider || "provider:unknown",
    dimensions.model || "model:unknown",
  ];
  if (dimensions.taskType) parts.push(dimensions.taskType);
  return parts.join("|");
}

function denied(error, extra = {}) {
  return {
    allowed: false,
    status: error.status,
    code: error.code,
    ...extra,
  };
}

export function evaluateAiGatewayRequest(request, options = {}) {
  const plans = options.plans || DEFAULT_AI_PLANS;
  const validKeys = options.validKeys || [];
  const counter = options.counter || new MemoryUsageCounter();
  const now = options.now || new Date();
  const apiKey = request.apiKey || "";

  if (!apiKey || (validKeys.length > 0 && !validKeys.includes(apiKey))) {
    return denied(AI_GATEWAY_ERRORS.unauthenticated);
  }

  const planId = request.plan || "free";
  const plan = plans[planId];
  const feature = request.feature || "ai-chat";
  if (!plan || !plan.features.includes(feature)) {
    return denied(AI_GATEWAY_ERRORS.plan_required, { requiredFeature: feature, plan: planId });
  }

  const quota = Number(plan.dailyQuota || 0);
  const dimensionKey = usageDimensionKey(request, now);
  const usage = quota > 0 ? counter.incrementAndGet(dimensionKey) : 0;
  if (quota > 0 && usage > quota) {
    return denied(AI_GATEWAY_ERRORS.quota_exceeded, { quota, usage, dimensionKey });
  }

  return {
    allowed: true,
    status: 200,
    code: "allowed",
    plan: planId,
    feature,
    quota,
    usage,
    dimensionKey,
  };
}
