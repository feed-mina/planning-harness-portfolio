import { elementStyleToCss, resolveElementStyle } from "./base-elements.js";
import { D1ProjectStore } from "./cloud-project-store.js";
import { migrateStudioManifest } from "./manifest-versioning.js";
import { getManifestI18n, resolvePageTitle } from "./i18n.js";
import { themeTokensToCssText } from "./theme-tokens.js";
import { interactionAttributes, interactionRuntimeScript, interactionTransitionCss } from "./interaction-runtime.js";
import { validatePublishSlug } from "./publish-release.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const safeImageUrl = (value) => /^(https?:\/\/|\/|\.\/|\.\.\/)/i.test(String(value || "").trim()) ? String(value).trim() : "";

function renderNode(node) {
  const style = escapeHtml([elementStyleToCss(resolveElementStyle(node, "default")), interactionTransitionCss(node)].filter(Boolean).join("; "));
  const common = `class="published-node published-${escapeHtml(node.type.toLowerCase())}" style="${style}" ${interactionAttributes(node)}`;
  const children = (node.children || []).map(renderNode).join("");
  if (node.type === "Heading") { const level = Math.min(6, Math.max(1, Number(node.props?.level || 2))); return `<h${level} ${common}>${escapeHtml(node.props?.text)}</h${level}>`; }
  if (node.type === "Text") return `<p ${common}>${escapeHtml(node.props?.text)}</p>`;
  if (node.type === "Button") return `<button type="button" ${common}>${escapeHtml(node.props?.label)}</button>`;
  if (node.type === "Image") return `<img ${common} src="${escapeHtml(safeImageUrl(node.props?.src))}" alt="${escapeHtml(node.props?.alt)}">`;
  if (node.type === "Divider") return `<hr ${common}>`;
  if (node.type === "Spacer") return `<div ${common} aria-hidden="true"></div>`;
  const cardCopy = node.type === "Card" ? `<strong>${escapeHtml(node.props?.title)}</strong><p>${escapeHtml(node.props?.description)}</p>` : "";
  return `<div ${common}>${cardCopy}${children}</div>`;
}

export function renderPublishedPage(manifestValue, pageId) {
  const manifest = migrateStudioManifest(manifestValue);
  const page = manifest.pages.find((item) => item.id === pageId);
  if (!page) return null;
  const locale = getManifestI18n(manifest).selectedLocale;
  const pageTitle = resolvePageTitle(manifest, page, { locale }).value;
  const themeCss = themeTokensToCssText(manifest.theme);
  const content = (page.nodes || []).map(renderNode).join("");
  return `<!doctype html><html lang="${escapeHtml(locale || "ko")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(pageTitle || manifest.name)}</title><style>${themeCss}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--color-background);color:var(--color-text);font-family:var(--font-family-base);font-size:var(--font-size-body);line-height:var(--line-height)}main{width:min(960px,calc(100% - 32px));margin:0 auto;padding:var(--space-xl) 0}.published-stack{display:flex;flex-direction:column}.published-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.published-button{cursor:pointer}.published-image{display:block;max-width:100%}@media(max-width:720px){.published-grid{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){[data-sdui-transition]{transition:none!important}}</style></head><body><main>${content}</main><script>${interactionRuntimeScript(page.state)}</script></body></html>`;
}

function publishedPath(pathname) {
  const match = pathname.match(/^\/p\/([^/]+)\/([^/]+)(?:\/([^/]+)(?:\/v(\d+))?)?\/?$/);
  if (!match) return null;
  try {
    const base = { projectId: decodeURIComponent(match[1]), pageId: decodeURIComponent(match[2]), slug: null, releaseVersion: null };
    if (!match[3]) return base;
    const slug = validatePublishSlug(match[3], "default", { encoded: true, normalize: false });
    return slug.valid ? { ...base, slug: slug.slug, releaseVersion: match[4] ? Number(match[4]) : null } : null;
  } catch { return null; }
}

export function createPublishedPageHandler(options = {}) {
  return async function handlePublishedPage(context) {
    const matched = publishedPath(new URL(context.request.url).pathname);
    if (!matched) return null;
    const store = options.store || (context.env?.STUDIO_DB ? new D1ProjectStore(context.env.STUDIO_DB) : null);
    if (!store) return new Response("Published page storage is unavailable", { status: 503 });
    let source;
    try {
      source = matched.slug
        ? await store.getRelease(matched.projectId, matched.pageId, matched.slug, matched.releaseVersion)
        : await store.getProject(matched.projectId);
    } catch (error) {
      console.error("published_page_store_error", { projectId: matched.projectId, pageId: matched.pageId, slug: matched.slug, message: error?.message });
      return new Response("Published page storage is temporarily unavailable", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-sdui-error": "published_store_unavailable" },
      });
    }
    const html = source ? renderPublishedPage(source.manifest, matched.pageId) : null;
    const immutable = matched.releaseVersion != null;
    return html ? new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=60" } }) : new Response("Page not found", { status: 404 });
  };
}
