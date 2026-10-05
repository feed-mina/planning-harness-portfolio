import { createAiPatchReview, approveAiPatchReview, rejectAiPatchReview, undoAiPatchReview } from "./ai-patch-review.js";
import { diffStudioManifests, deserializeStudioManifest, exportStudioPackage, importStudioPackage, migrateStudioManifest } from "./manifest-versioning.js";

const clone = (value) => structuredClone(value);

export class MemoryProjectStore {
  constructor() {
    this.projects = new Map();
    this.reviews = new Map();
    this.audit = [];
    this.releases = new Map();
    this.branding = new Map();
  }

  async getProject(projectId) {
    const project = this.projects.get(projectId);
    return project ? clone(project) : null;
  }

  async saveManifest(projectId, manifest, options = {}) {
    const previous = this.projects.get(projectId);
    const currentVersion = previous?.version || 0;
    if (options.expectedVersion !== undefined && Number(options.expectedVersion) !== currentVersion) {
      const error = new Error("manifest version conflict");
      error.code = "version_conflict";
      error.status = 409;
      throw error;
    }
    const canonical = deserializeStudioManifest(manifest);
    const version = currentVersion + 1;
    const saved = { projectId, version, manifest: canonical, updatedAt: options.now || new Date().toISOString(), updatedBy: options.actor || "unknown", label: options.label || `Version ${version}` };
    const versions = [...(previous?.versions || []), clone(saved)];
    this.projects.set(projectId, { ...saved, versions });
    this.audit.push({ projectId, action: options.action || "manifest.saved", version, actor: saved.updatedBy, at: saved.updatedAt, diff: previous ? diffStudioManifests(previous.manifest, canonical) : null });
    return clone(saved);
  }

  async listVersions(projectId) {
    return clone(this.projects.get(projectId)?.versions || []).reverse();
  }

  async getVersion(projectId, version) {
    return clone(this.projects.get(projectId)?.versions?.find((item) => item.version === Number(version)) || null);
  }

  async publishRelease(projectId, pageId, slug, manifestVersion, options = {}) {
    const version = await this.getVersion(projectId, manifestVersion);
    if (!version || !version.manifest.pages?.some((page) => page.id === pageId)) throw Object.assign(new Error("manifest version or page not found"), { status: 404, code: "not_found" });
    const key = `${projectId}:${pageId}:${slug}`;
    const releases = this.releases.get(key) || [];
    const release = { projectId, pageId, slug, releaseVersion: releases.length + 1, manifestVersion: version.version, manifest: clone(version.manifest), publishedAt: options.now || new Date().toISOString(), publishedBy: options.actor || "unknown" };
    this.releases.set(key, [...releases, release]);
    this.audit.push({ projectId, action: "release.published", version: version.version, actor: release.publishedBy, at: release.publishedAt, detail: { pageId, slug, releaseVersion: release.releaseVersion } });
    return clone(release);
  }

  async getRelease(projectId, pageId, slug, releaseVersion = null) {
    const releases = this.releases.get(`${projectId}:${pageId}:${slug}`) || [];
    return clone(releaseVersion == null ? releases.at(-1) || null : releases.find((release) => release.releaseVersion === Number(releaseVersion)) || null);
  }

  async listReleases(projectId) {
    return clone([...this.releases.values()].flat().filter((release) => release.projectId === projectId)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)));
  }

  async saveReview(projectId, review) {
    this.reviews.set(`${projectId}:${review.id}`, clone(review));
    return clone(review);
  }

  async getReview(projectId, reviewId) {
    return clone(this.reviews.get(`${projectId}:${reviewId}`) || null);
  }

  async addAudit(event) {
    this.audit.push(clone(event));
  }

  async listAudit(projectId) {
    return clone(this.audit.filter((event) => event.projectId === projectId));
  }

  async getBranding(projectId) { return clone(this.branding.get(projectId) || null); }

  async saveBranding(projectId, branding, options = {}) {
    this.branding.set(projectId, clone(branding));
    this.audit.push({ projectId, action: "branding.saved", actor: options.actor || "unknown", at: options.now || new Date().toISOString() });
    return clone(branding);
  }
}

function parseJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

export class D1ProjectStore {
  constructor(database) {
    if (!database) throw new Error("D1 database binding is required");
    this.database = database;
  }

  async getProject(projectId) {
    const row = await this.database.prepare("SELECT id, current_version, manifest_json, updated_at, updated_by FROM studio_projects WHERE id = ?1").bind(projectId).first();
    return row ? { projectId: row.id, version: row.current_version, manifest: parseJson(row.manifest_json), updatedAt: row.updated_at, updatedBy: row.updated_by } : null;
  }

  async saveManifest(projectId, manifest, options = {}) {
    const canonical = deserializeStudioManifest(manifest);
    const previous = await this.getProject(projectId);
    const currentVersion = previous?.version || 0;
    if (options.expectedVersion !== undefined && Number(options.expectedVersion) !== currentVersion) {
      const error = new Error("manifest version conflict");
      error.code = "version_conflict";
      error.status = 409;
      throw error;
    }
    const version = currentVersion + 1;
    const at = options.now || new Date().toISOString();
    const actor = options.actor || "unknown";
    const label = options.label || `Version ${version}`;
    const serialized = JSON.stringify(canonical);
    const diff = previous ? diffStudioManifests(previous.manifest, canonical) : null;
    await this.database.batch([
      this.database.prepare("INSERT INTO studio_projects (id, current_version, manifest_json, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET current_version = excluded.current_version, manifest_json = excluded.manifest_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind(projectId, version, serialized, at, actor),
      this.database.prepare("INSERT INTO studio_project_versions (project_id, version, label, manifest_json, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(projectId, version, label, serialized, at, actor),
      this.database.prepare("INSERT INTO studio_audit_events (project_id, action, version, actor, detail_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(projectId, options.action || "manifest.saved", version, actor, JSON.stringify({ diff }), at),
    ]);
    return { projectId, version, manifest: canonical, updatedAt: at, updatedBy: actor, label };
  }

  async listVersions(projectId) {
    const result = await this.database.prepare("SELECT project_id, version, label, created_at, created_by FROM studio_project_versions WHERE project_id = ?1 ORDER BY version DESC").bind(projectId).all();
    return (result.results || []).map((row) => ({ projectId: row.project_id, version: row.version, label: row.label, updatedAt: row.created_at, updatedBy: row.created_by }));
  }

  async getVersion(projectId, version) {
    const row = await this.database.prepare("SELECT project_id, version, label, manifest_json, created_at, created_by FROM studio_project_versions WHERE project_id = ?1 AND version = ?2").bind(projectId, Number(version)).first();
    return row ? { projectId: row.project_id, version: row.version, label: row.label, manifest: parseJson(row.manifest_json), updatedAt: row.created_at, updatedBy: row.created_by } : null;
  }

  async publishRelease(projectId, pageId, slug, manifestVersion, options = {}) {
    const version = await this.getVersion(projectId, manifestVersion);
    if (!version || !version.manifest.pages?.some((page) => page.id === pageId)) throw Object.assign(new Error("manifest version or page not found"), { status: 404, code: "not_found" });
    const latest = await this.database.prepare("SELECT MAX(release_version) AS version FROM studio_releases WHERE project_id = ?1 AND page_id = ?2 AND slug = ?3").bind(projectId, pageId, slug).first();
    const releaseVersion = Number(latest?.version || 0) + 1;
    const publishedAt = options.now || new Date().toISOString();
    const publishedBy = options.actor || "unknown";
    await this.database.batch([
      this.database.prepare("INSERT INTO studio_releases (project_id, page_id, slug, release_version, manifest_version, manifest_json, published_at, published_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").bind(projectId, pageId, slug, releaseVersion, version.version, JSON.stringify(version.manifest), publishedAt, publishedBy),
      this.database.prepare("INSERT INTO studio_audit_events (project_id, action, version, actor, detail_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(projectId, "release.published", version.version, publishedBy, JSON.stringify({ pageId, slug, releaseVersion }), publishedAt),
    ]);
    return { projectId, pageId, slug, releaseVersion, manifestVersion: version.version, manifest: version.manifest, publishedAt, publishedBy };
  }

  async getRelease(projectId, pageId, slug, releaseVersion = null) {
    const suffix = releaseVersion == null ? "ORDER BY release_version DESC LIMIT 1" : "AND release_version = ?4";
    const statement = this.database.prepare(`SELECT project_id, page_id, slug, release_version, manifest_version, manifest_json, published_at, published_by FROM studio_releases WHERE project_id = ?1 AND page_id = ?2 AND slug = ?3 ${suffix}`);
    const row = releaseVersion == null ? await statement.bind(projectId, pageId, slug).first() : await statement.bind(projectId, pageId, slug, Number(releaseVersion)).first();
    return row ? { projectId: row.project_id, pageId: row.page_id, slug: row.slug, releaseVersion: row.release_version, manifestVersion: row.manifest_version, manifest: parseJson(row.manifest_json), publishedAt: row.published_at, publishedBy: row.published_by } : null;
  }

  async listReleases(projectId) {
    const result = await this.database.prepare("SELECT project_id, page_id, slug, release_version, manifest_version, published_at, published_by FROM studio_releases WHERE project_id = ?1 ORDER BY published_at DESC, release_version DESC").bind(projectId).all();
    return (result.results || []).map((row) => ({ projectId: row.project_id, pageId: row.page_id, slug: row.slug, releaseVersion: row.release_version, manifestVersion: row.manifest_version, publishedAt: row.published_at, publishedBy: row.published_by }));
  }

  async saveReview(projectId, review) {
    const serialized = JSON.stringify(review);
    await this.database.prepare("INSERT INTO studio_ai_reviews (project_id, id, status, manifest_version, review_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(project_id, id) DO UPDATE SET status = excluded.status, manifest_version = excluded.manifest_version, review_json = excluded.review_json, updated_at = excluded.updated_at").bind(projectId, review.id, review.status, review.manifestVersion, serialized, review.updatedAt).run();
    return clone(review);
  }

  async getReview(projectId, reviewId) {
    const row = await this.database.prepare("SELECT review_json FROM studio_ai_reviews WHERE project_id = ?1 AND id = ?2").bind(projectId, reviewId).first();
    return row ? parseJson(row.review_json) : null;
  }

  async addAudit(event) {
    await this.database.prepare("INSERT INTO studio_audit_events (project_id, action, version, actor, detail_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(event.projectId, event.action, event.version || null, event.actor || "unknown", JSON.stringify(event), event.at || new Date().toISOString()).run();
  }

  async listAudit(projectId) {
    const result = await this.database.prepare("SELECT action, version, actor, detail_json, created_at FROM studio_audit_events WHERE project_id = ?1 ORDER BY id DESC").bind(projectId).all();
    return (result.results || []).map((row) => ({ action: row.action, version: row.version, actor: row.actor, at: row.created_at, detail: parseJson(row.detail_json) }));
  }

  async getBranding(projectId) {
    const row = await this.database.prepare("SELECT branding_json FROM studio_project_branding WHERE project_id = ?1").bind(projectId).first();
    return row ? parseJson(row.branding_json) : null;
  }

  async saveBranding(projectId, branding, options = {}) {
    const at = options.now || new Date().toISOString();
    const actor = options.actor || "unknown";
    await this.database.batch([
      this.database.prepare("INSERT INTO studio_project_branding (project_id, branding_json, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(project_id) DO UPDATE SET branding_json = excluded.branding_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind(projectId, JSON.stringify(branding), at, actor),
      this.database.prepare("INSERT INTO studio_audit_events (project_id, action, actor, detail_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(projectId, "branding.saved", actor, "{}", at),
    ]);
    return clone(branding);
  }
}

export async function createReviewInStore(store, projectId, input, options = {}) {
  const project = await store.getProject(projectId);
  if (!project) throw Object.assign(new Error("project not found"), { status: 404, code: "not_found" });
  const review = createAiPatchReview({ ...input, projectId, manifest: project.manifest, manifestVersion: project.version }, options);
  await store.saveReview(projectId, review);
  return review;
}

export async function decideReviewInStore(store, projectId, reviewId, action, input = {}, options = {}) {
  const review = await store.getReview(projectId, reviewId);
  const project = await store.getProject(projectId);
  if (!review || !project) throw Object.assign(new Error("review or project not found"), { status: 404, code: "not_found" });
  if (action === "approve") {
    const result = approveAiPatchReview(review, { manifest: project.manifest, manifestVersion: project.version, actor: input.actor }, options);
    if (!result.idempotent) {
      const saved = await store.saveManifest(projectId, result.manifest, { expectedVersion: project.version, actor: input.actor, action: "ai_patch.approved", label: `AI review ${review.id}` });
      result.review.decision.manifestVersion = saved.version;
      await store.saveReview(projectId, result.review);
    }
    return result.review;
  }
  if (action === "reject") {
    const result = rejectAiPatchReview(review, input, options);
    if (!result.idempotent) {
      await store.saveReview(projectId, result.review);
      await store.addAudit({ ...result.audit, projectId, version: project.version });
    }
    return result.review;
  }
  if (action === "undo") {
    const result = undoAiPatchReview(review, { manifest: project.manifest, manifestVersion: project.version, actor: input.actor }, options);
    if (!result.idempotent) {
      await store.saveManifest(projectId, result.manifest, { expectedVersion: project.version, actor: input.actor, action: "ai_patch.undone", label: `Undo AI review ${review.id}` });
      await store.saveReview(projectId, result.review);
    }
    return result.review;
  }
  throw Object.assign(new Error("unsupported review action"), { status: 400, code: "invalid_action" });
}

export async function exportProject(store, projectId, options = {}) {
  const project = await store.getProject(projectId);
  if (!project) throw Object.assign(new Error("project not found"), { status: 404, code: "not_found" });
  const branding = store.getBranding ? await store.getBranding(projectId) : null;
  const exported = exportStudioPackage(project.manifest, { projectId, branding });
  await store.addAudit({ projectId, action: "package.exported", version: project.version, actor: options.actor || "unknown", at: options.now || new Date().toISOString() });
  return exported;
}

export async function importProject(store, projectId, packageValue, options = {}) {
  const current = await store.getProject(projectId);
  const manifest = importStudioPackage(packageValue, current?.manifest || packageValue.manifest, options);
  return store.saveManifest(projectId, manifest, { expectedVersion: current?.version || 0, actor: options.actor, action: "manifest.imported", label: options.label || "Imported package" });
}
