export const PRODUCT_PLANS = Object.freeze({
  free: { features: ["core.edit"], limits: { projects: 1, seats: 1, aiRequestsPerDay: 0 } },
  team: { features: ["core.edit", "package.export", "managed.deploy"], limits: { projects: 10, seats: 5, aiRequestsPerDay: 0 } },
  pro: { features: ["core.edit", "package.export", "managed.deploy", "ai.request", "branding.whiteLabel", "desktop.activate"], limits: { projects: 50, seats: 20, aiRequestsPerDay: 1000 } },
  enterprise: { features: ["core.edit", "package.export", "managed.deploy", "ai.request", "branding.whiteLabel", "desktop.activate"], limits: { projects: null, seats: null, aiRequestsPerDay: null } },
});

export function resolveEntitlement(plan = "free", overrides = {}) {
  const definition = PRODUCT_PLANS[plan];
  if (!definition) throw Object.assign(new Error(`Unknown product plan: ${plan}`), { status: 400, code: "invalid_plan" });
  return Object.freeze({ plan, features: Object.freeze([...(definition.features || []), ...(overrides.features || [])]), limits: Object.freeze({ ...definition.limits, ...(overrides.limits || {}) }) });
}

export function entitlementAllows(entitlement, feature) {
  return Boolean(entitlement?.features?.includes(feature));
}

export function requireEntitlement(entitlement, feature) {
  if (!entitlementAllows(entitlement, feature)) throw Object.assign(new Error(`${feature} requires a plan upgrade`), { status: 402, code: "plan_required", feature, plan: entitlement?.plan || "free" });
  return entitlement;
}
