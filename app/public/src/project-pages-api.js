import { D1ProjectStore, createReviewInStore, decideReviewInStore, exportProject, importProject } from "./cloud-project-store.js";
import { diffStudioManifests } from "./manifest-versioning.js";
import { publishedReleaseUrls, validatePublishSlug } from "./publish-release.js";
import { defaultApiKeyPrincipal, requireProjectPermission } from "./project-access-policy.js";
import { requireEntitlement, resolveEntitlement } from "./entitlements.js";
import { normalizeBrandingConfig } from "./branding-config.js";

const headersFor = (origin) => ({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": origin,
  "access-control-allow-headers": "authorization, content-type, x-studio-api-key, x-studio-actor",
  "access-control-allow-methods": "GET, PUT, POST, OPTIONS",
  vary: "Origin",
});

function json(status, value, origin) {
  return new Response(JSON.stringify(value), { status, headers: headersFor(origin) });
}

async function body(request) {
  try { return await request.json(); } catch { throw Object.assign(new Error("request body must be valid JSON"), { status: 400, code: "invalid_json" }); }
}

function credential(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : request.headers.get("x-studio-api-key") || "";
}

function route(path) {
  const match = path.match(/^\/api\/projects\/([^/]+)(?:\/(.*))?$/);
  if (!match) return null;
  return { projectId: decodeURIComponent(match[1]), tail: match[2] || "" };
}

export function createProjectPagesHandler(options = {}) {
  return async function handleProjectRequest(context) {
    const request = context.request;
    const env = context.env || {};
    const url = new URL(request.url);
    const matched = route(url.pathname);
    if (!matched) return null;
    const origin = options.corsOrigin ?? env.AI_CORS_ORIGIN ?? request.headers.get("origin") ?? "*";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headersFor(origin) });
    const apiKey = options.apiKey ?? env.STUDIO_API_KEY ?? env.AI_GATEWAY_KEY ?? "";
    if (!apiKey || credential(request) !== apiKey) return json(apiKey ? 401 : 503, { ok: false, error: { code: apiKey ? "unauthenticated" : "store_unconfigured", message: apiKey ? "Studio API authentication failed" : "Studio API key is not configured" } }, origin);
    if (!options.store && !env.STUDIO_DB) return json(503, { ok: false, error: { code: "store_unconfigured", message: "D1 STUDIO_DB binding is not configured" } }, origin);
    const store = options.store || new D1ProjectStore(env.STUDIO_DB);
    const principal = options.resolvePrincipal
      ? await options.resolvePrincipal({ request, projectId: matched.projectId, env })
      : defaultApiKeyPrincipal(request);
    const actor = principal.id;
    const allow = (permission) => requireProjectPermission(principal, permission);
    const entitlement = options.resolveEntitlement
      ? await options.resolveEntitlement({ request, projectId: matched.projectId, principal, env })
      : resolveEntitlement("enterprise");

    try {
      if (matched.tail === "manifest" && request.method === "GET") {
        allow("project.read");
        const project = await store.getProject(matched.projectId);
        return project ? json(200, { ok: true, ...project }, origin) : json(404, { ok: false, error: { code: "not_found", message: "Project not found" } }, origin);
      }
      if (matched.tail === "manifest" && request.method === "PUT") {
        allow("project.write");
        const input = await body(request);
        const saved = await store.saveManifest(matched.projectId, input.manifest, { expectedVersion: input.expectedVersion, actor, label: input.label });
        return json(200, { ok: true, ...saved }, origin);
      }
      if (matched.tail === "branding" && request.method === "GET") {
        allow("project.read");
        return json(200, { ok: true, branding: await store.getBranding(matched.projectId) }, origin);
      }
      if (matched.tail === "branding" && request.method === "PUT") {
        allow("project.write");
        requireEntitlement(entitlement, "branding.whiteLabel");
        const input = await body(request);
        return json(200, { ok: true, branding: await store.saveBranding(matched.projectId, normalizeBrandingConfig(input.branding), { actor }) }, origin);
      }
      if (matched.tail === "versions" && request.method === "GET") {
        allow("project.read");
        const search = (url.searchParams.get("search") || "").toLowerCase();
        const user = (url.searchParams.get("user") || "").toLowerCase();
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "";
        const excludeCurrent = url.searchParams.get("excludeCurrent") === "true";
        const page = Math.max(1, Number(url.searchParams.get("page") || 1));
        const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") || 5)));
        const listed = await store.listVersions(matched.projectId);
        const currentVersion = listed[0]?.version;
        const all = listed.filter((version) => {
          const searchable = `${version.version} ${version.label || ""}`.toLowerCase();
          const date = String(version.updatedAt || "").slice(0, 10);
          return (!search || searchable.includes(search))
            && (!user || String(version.updatedBy || "").toLowerCase().includes(user))
            && (!from || date >= from) && (!to || date <= to)
            && (!excludeCurrent || version.version !== currentVersion);
        });
        const start = (page - 1) * pageSize;
        return json(200, { ok: true, versions: all.slice(start, start + pageSize), page, pageSize, total: all.length }, origin);
      }
      if (matched.tail === "versions" && request.method === "POST") {
        allow("project.write");
        const input = await body(request);
        const saved = await store.saveManifest(matched.projectId, input.manifest, { expectedVersion: input.expectedVersion, actor, label: input.label });
        return json(201, { ok: true, ...saved }, origin);
      }
      if (matched.tail === "deployments" && request.method === "POST") {
        allow("deployment.publish");
        requireEntitlement(entitlement, "managed.deploy");
        const input = await body(request);
        const slugValidation = validatePublishSlug(input.slug, input.pageId || "default");
        if (!slugValidation.valid) throw Object.assign(new Error(slugValidation.message), { status: 400, code: "invalid_slug" });
        const release = await store.publishRelease(matched.projectId, input.pageId, slugValidation.slug, input.manifestVersion, { actor });
        return json(201, { ok: true, ...release, ...publishedReleaseUrls(url.origin, release) }, origin);
      }
      if (matched.tail === "deployments" && request.method === "GET") {
        allow("project.read");
        return json(200, { ok: true, deployments: await store.listReleases(matched.projectId) }, origin);
      }
      const versionMatch = matched.tail.match(/^versions\/(\d+)$/);
      if (versionMatch && request.method === "GET") {
        allow("project.read");
        const version = await store.getVersion(matched.projectId, versionMatch[1]);
        return version ? json(200, { ok: true, ...version }, origin) : json(404, { ok: false, error: { code: "not_found", message: "Version not found" } }, origin);
      }
      const diffMatch = matched.tail.match(/^versions\/(\d+)\/diff\/(\d+)$/);
      if (diffMatch && request.method === "GET") {
        allow("project.read");
        const before = await store.getVersion(matched.projectId, diffMatch[1]);
        const after = await store.getVersion(matched.projectId, diffMatch[2]);
        if (!before || !after) return json(404, { ok: false, error: { code: "not_found", message: "Version not found" } }, origin);
        return json(200, { ok: true, from: before.version, to: after.version, diff: diffStudioManifests(before.manifest, after.manifest) }, origin);
      }
      if (matched.tail === "export" && request.method === "POST") {
        allow("package.export");
        requireEntitlement(entitlement, "package.export");
        return json(200, { ok: true, package: await exportProject(store, matched.projectId, { actor }) }, origin);
      }
      if (matched.tail === "import" && request.method === "POST") {
        allow("package.import");
        const input = await body(request);
        const imported = await importProject(store, matched.projectId, input.package, { actor, mode: input.mode });
        if (input.package?.branding) {
          requireEntitlement(entitlement, "branding.whiteLabel");
          await store.saveBranding(matched.projectId, normalizeBrandingConfig(input.package.branding), { actor });
        }
        return json(201, { ok: true, ...imported }, origin);
      }
      if (matched.tail === "audit" && request.method === "GET") {
        allow("audit.read");
        return json(200, { ok: true, events: await store.listAudit(matched.projectId) }, origin);
      }
      if (matched.tail === "ai-reviews" && request.method === "POST") {
        allow("project.write");
        const input = await body(request);
        return json(201, { ok: true, review: await createReviewInStore(store, matched.projectId, { ...input, createdBy: actor }) }, origin);
      }
      const reviewMatch = matched.tail.match(/^ai-reviews\/([^/]+)(?:\/(approve|reject|undo))?$/);
      if (reviewMatch && request.method === "GET" && !reviewMatch[2]) {
        allow("project.read");
        const review = await store.getReview(matched.projectId, reviewMatch[1]);
        return review ? json(200, { ok: true, review }, origin) : json(404, { ok: false, error: { code: "not_found", message: "Review not found" } }, origin);
      }
      if (reviewMatch && request.method === "POST" && reviewMatch[2]) {
        allow("project.write");
        const input = await body(request);
        const review = await decideReviewInStore(store, matched.projectId, reviewMatch[1], reviewMatch[2], { ...input, actor });
        return json(200, { ok: true, review }, origin);
      }
      return json(404, { ok: false, error: { code: "not_found", message: "Project API route not found" } }, origin);
    } catch (error) {
      return json(error.status || (error.code === "version_conflict" ? 409 : 400), { ok: false, error: { code: error.code || "invalid_request", message: error.message } }, origin);
    }
  };
}
