export const RESERVED_PUBLISH_SLUGS = Object.freeze(["api", "studio", "admin", "versions", "latest"]);
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizePublishSlug(value, fallback = "default") {
  const source = String(value || fallback || "default").trim().toLowerCase();
  return source.replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "default";
}

export function validatePublishSlug(value, fallback = "default", options = {}) {
  let decoded;
  try { decoded = options.encoded ? decodeURIComponent(String(value)) : String(value || ""); }
  catch { return { valid: false, slug: null, message: "slug must use valid URL encoding" }; }
  const slug = options.normalize === false ? decoded : normalizePublishSlug(decoded, fallback);
  if (!SLUG_PATTERN.test(slug)) return { valid: false, slug, message: "slug must be 1-63 lowercase letters, numbers, or hyphens" };
  if (RESERVED_PUBLISH_SLUGS.includes(slug)) return { valid: false, slug, message: `reserved slug: ${slug}` };
  return { valid: true, slug, message: null };
}

export function publishedReleaseUrls(origin, release) {
  const base = `${String(origin).replace(/\/$/, "")}/p/${encodeURIComponent(release.projectId)}/${encodeURIComponent(release.pageId)}/${encodeURIComponent(release.slug)}`;
  return { latestUrl: `${base}/`, versionedUrl: `${base}/v${release.releaseVersion}/` };
}
