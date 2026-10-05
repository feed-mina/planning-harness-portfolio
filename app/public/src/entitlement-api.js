import { createDesktopActivationService } from "./desktop-activation.js";
import { resolveEntitlement } from "./entitlements.js";

const response = (status, value) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const readBody = async (request) => { try { return await request.json(); } catch { throw Object.assign(new Error("Valid JSON is required"), { status: 400, code: "invalid_json" }); } };

export function createEntitlementPagesHandler(options = {}) {
  let defaultActivationService;
  return async function entitlementHandler({ request, env = {} }) {
    const path = new URL(request.url).pathname;
    try {
      if (path === "/api/entitlements" && request.method === "GET") {
        const entitlement = options.resolveRequestEntitlement ? await options.resolveRequestEntitlement(request) : resolveEntitlement(env.STUDIO_PLAN || "free");
        return response(200, { ok: true, entitlement });
      }
      if (["/api/desktop/activate", "/api/desktop/heartbeat"].includes(path) && request.method === "POST") {
        defaultActivationService ||= createDesktopActivationService({ resolveLicense: async (key) => key && key === env.DESKTOP_LICENSE_KEY ? resolveEntitlement(env.STUDIO_PLAN || "pro") : null });
        const service = options.activationService || defaultActivationService;
        const input = await readBody(request);
        const lease = path.endsWith("activate") ? await service.activate(input) : await service.heartbeat(input);
        return response(200, { ok: true, lease });
      }
      return response(404, { ok: false, error: { code: "not_found", message: "Entitlement route not found" } });
    } catch (error) {
      return response(error.status || 400, { ok: false, error: { code: error.code || "invalid_request", message: error.message } });
    }
  };
}
