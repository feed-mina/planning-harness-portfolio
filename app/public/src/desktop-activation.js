import { requireEntitlement } from "./entitlements.js";

export class MemoryDesktopActivationStore {
  constructor() { this.leases = new Map(); }
  async put(lease) { this.leases.set(lease.token, structuredClone(lease)); return lease; }
  async get(token) { return structuredClone(this.leases.get(token) || null); }
}

export function createDesktopActivationService({ store = new MemoryDesktopActivationStore(), resolveLicense, randomUUID = () => crypto.randomUUID(), now = () => Date.now(), ttlMs = 15 * 60 * 1000 } = {}) {
  if (typeof resolveLicense !== "function") throw new TypeError("resolveLicense is required");
  const issue = async ({ licenseKey, deviceId }) => {
    if (!licenseKey || !deviceId) throw Object.assign(new Error("licenseKey and deviceId are required"), { status: 400, code: "invalid_activation" });
    const entitlement = await resolveLicense(licenseKey);
    if (!entitlement) throw Object.assign(new Error("Desktop license is invalid"), { status: 401, code: "invalid_license" });
    requireEntitlement(entitlement, "desktop.activate");
    const lease = { token: randomUUID(), deviceId, plan: entitlement.plan, features: entitlement.features, expiresAt: new Date(now() + ttlMs).toISOString() };
    await store.put(lease);
    return lease;
  };
  const heartbeat = async ({ token, deviceId }) => {
    const current = await store.get(token);
    if (!current || current.deviceId !== deviceId || Date.parse(current.expiresAt) <= now()) throw Object.assign(new Error("Desktop activation lease expired"), { status: 401, code: "activation_expired" });
    return issueLease(current);
  };
  const issueLease = async (current) => {
    const renewed = { ...current, expiresAt: new Date(now() + ttlMs).toISOString() };
    await store.put(renewed);
    return renewed;
  };
  return Object.freeze({ activate: issue, heartbeat });
}
