export function createPagesWorker(options = {}) {
  const aiHandler = options.aiHandler;
  const projectHandler = options.projectHandler;
  const publishedHandler = options.publishedHandler;
  const entitlementHandler = options.entitlementHandler;
  if (typeof aiHandler !== "function") throw new TypeError("aiHandler must be a function");
  if (typeof projectHandler !== "function") throw new TypeError("projectHandler must be a function");

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === "/") return Response.redirect(new URL("/studio/", url), 302);
      if (url.pathname.startsWith("/api/ai/")) return aiHandler({ request, env, ctx });
      if (url.pathname.startsWith("/api/projects/")) return projectHandler({ request, env, ctx });
      if ((url.pathname === "/api/entitlements" || url.pathname.startsWith("/api/desktop/")) && typeof entitlementHandler === "function") return entitlementHandler({ request, env, ctx });
      if (url.pathname.startsWith("/p/") && typeof publishedHandler === "function") return publishedHandler({ request, env, ctx });
      return env.ASSETS.fetch(request);
    },
  };
}
