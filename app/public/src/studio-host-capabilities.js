const requiredMethods = ["openProject", "saveProject", "importPackage", "exportPackage", "loadDraft", "saveDraft"];

function assertHost(host) {
  for (const method of requiredMethods) {
    if (typeof host?.[method] !== "function") throw new TypeError(`Studio host capability is missing: ${method}`);
  }
  return Object.freeze(host);
}

function requestError(response, fallback) {
  return response.json().catch(() => ({})).then((body) => {
    const error = new Error(body?.error?.message || fallback);
    error.status = response.status;
    error.code = body?.error?.code || "host_request_failed";
    throw error;
  });
}

export function createCloudProjectClient({ baseUrl = "", apiKey, actor = "studio-user", fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  const call = async (projectId, tail, init = {}) => {
    const response = await fetchImpl(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/${tail}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-studio-api-key": apiKey || "",
        "x-studio-actor": actor,
        ...init.headers,
      },
    });
    if (!response.ok) return requestError(response, `Studio host request failed (${response.status})`);
    return response.json();
  };
  return Object.freeze({
    openProject: (projectId) => call(projectId, "manifest"),
    saveProject: (projectId, manifest, options = {}) => call(projectId, "manifest", { method: "PUT", body: JSON.stringify({ manifest, ...options }) }),
    importProject: (projectId, packageValue, options = {}) => call(projectId, "import", { method: "POST", body: JSON.stringify({ package: packageValue, ...options }) }),
    exportProject: (projectId) => call(projectId, "export", { method: "POST", body: "{}" }),
  });
}

export function createWebStudioHost({ cloud, cache = globalThis.sessionStorage } = {}) {
  if (!cloud) throw new TypeError("cloud client is required");
  const cacheKey = (projectId) => `sdui-studio:draft:${projectId}`;
  return assertHost({
    kind: "web",
    canonicalSource: "cloud",
    openProject: cloud.openProject,
    saveProject: cloud.saveProject,
    importPackage: (projectId, packageValue, options) => cloud.importProject(projectId, packageValue, options),
    exportPackage: async (projectId) => (await cloud.exportProject(projectId)).package,
    loadDraft: async (projectId) => JSON.parse(cache?.getItem(cacheKey(projectId)) || "null"),
    saveDraft: async (projectId, draft) => cache?.setItem(cacheKey(projectId), JSON.stringify(draft)),
  });
}

export function createDesktopStudioHost({ cloud, fileSystem, cache } = {}) {
  if (!cloud) throw new TypeError("cloud client is required");
  if (!fileSystem?.readText || !fileSystem?.writeText) throw new TypeError("desktop fileSystem readText/writeText capabilities are required");
  if (!cache?.get || !cache?.set) throw new TypeError("desktop cache get/set capabilities are required");
  return assertHost({
    kind: "desktop",
    canonicalSource: "cloud",
    openProject: cloud.openProject,
    saveProject: cloud.saveProject,
    importPackage: async (projectId, path, options) => cloud.importProject(projectId, JSON.parse(await fileSystem.readText(path)), options),
    exportPackage: async (projectId, path) => {
      const exported = await cloud.exportProject(projectId);
      await fileSystem.writeText(path, JSON.stringify(exported.package, null, 2));
      return exported.package;
    },
    loadDraft: (projectId) => cache.get(projectId),
    saveDraft: (projectId, draft) => cache.set(projectId, draft),
  });
}

export const STUDIO_HOST_CAPABILITIES = Object.freeze([...requiredMethods]);
