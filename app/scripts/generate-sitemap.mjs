import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const appRoot = resolve(import.meta.dirname, "..");
const publicRoot = join(appRoot, "public");
const sitemapPath = join(publicRoot, "sitemap.xml");
const publicPagesConfigPath = join(publicRoot, "assets", "public-pages.json");
const publicPagesScriptPath = join(publicRoot, "assets", "public-pages.js");

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name === "index.html" ? [path] : [];
  });
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1] || "";
}

function tags(html, tagName) {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) || [];
}

function pairedContents(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi"))]
    .map((match) => match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function tagsWithAttribute(html, tagName, name, value) {
  return tags(html, tagName).filter((tag) => attribute(tag, name).toLowerCase() === value);
}

function isNoIndex(html) {
  return tags(html, "meta").some((tag) =>
    attribute(tag, "name").toLowerCase() === "robots" &&
    attribute(tag, "content").toLowerCase().split(/\s*,\s*/).includes("noindex")
  );
}

function routeFromIndexFile(root, file) {
  const directory = relative(root, dirname(file)).split(sep).join("/");
  return directory ? `/${directory}/` : "/";
}

function requiredSingle(values, label, route, errors) {
  if (values.length !== 1) {
    errors.push(`${route} must contain exactly one ${label}; found ${values.length}.`);
    return "";
  }
  if (!values[0]) errors.push(`${route} has an empty ${label}.`);
  return values[0];
}

function assertUnique(pages, key, label, errors) {
  const owners = new Map();
  for (const page of pages) {
    const value = page[key].toLowerCase();
    if (!value) continue;
    const firstRoute = owners.get(value);
    if (firstRoute) errors.push(`${page.route} duplicates ${label} from ${firstRoute}.`);
    else owners.set(value, page.route);
  }
}

export function validatePublicPages(root, config) {
  const errors = [];
  const origin = String(config?.origin || "").replace(/\/$/, "");
  const configuredPaths = Array.isArray(config?.publicPaths) ? config.publicPaths : [];
  const replaySafePaths = Array.isArray(config?.replaySafePaths) ? config.replaySafePaths : [];

  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.origin !== origin || parsedOrigin.pathname !== "/") errors.push("origin must be an absolute origin without a trailing slash or path.");
  } catch {
    errors.push("origin must be an absolute URL.");
  }

  for (const path of configuredPaths) {
    if (typeof path !== "string" || !path.startsWith("/") || (path !== "/" && !path.endsWith("/")) || path.includes("?") || path.includes("#")) {
      errors.push(`Invalid public path ${JSON.stringify(path)}; paths must start and end with / and contain no query or fragment.`);
    }
  }
  if (new Set(configuredPaths).size !== configuredPaths.length) errors.push("publicPaths contains duplicate entries.");
  for (const path of replaySafePaths) {
    if (!configuredPaths.includes(path)) errors.push(`Replay-safe path ${JSON.stringify(path)} is not a public path.`);
  }

  const pages = htmlFiles(root).flatMap((file) => {
    const html = readFileSync(file, "utf8");
    if (isNoIndex(html)) return [];
    const route = routeFromIndexFile(root, file);
    const title = requiredSingle(pairedContents(html, "title"), "<title>", route, errors);
    const description = requiredSingle(
      tagsWithAttribute(html, "meta", "name", "description").map((tag) => attribute(tag, "content").trim()),
      'meta[name="description"]',
      route,
      errors,
    );
    const h1 = requiredSingle(pairedContents(html, "h1"), "<h1>", route, errors);
    const canonical = requiredSingle(
      tags(html, "link")
        .filter((tag) => attribute(tag, "rel").toLowerCase().split(/\s+/).includes("canonical"))
        .map((tag) => attribute(tag, "href").trim()),
      'link[rel="canonical"]',
      route,
      errors,
    );
    const expectedCanonical = `${origin}${route}`;
    if (canonical && canonical !== expectedCanonical) {
      errors.push(`${route} canonical must be ${expectedCanonical}; found ${canonical}.`);
    }
    return [{ route, title, description, h1, canonical }];
  });

  assertUnique(pages, "title", "title", errors);
  assertUnique(pages, "description", "description", errors);
  assertUnique(pages, "h1", "H1", errors);
  assertUnique(pages, "canonical", "canonical", errors);

  const discoveredPaths = pages.map((page) => page.route).sort();
  const expectedPaths = [...configuredPaths].sort();
  if (JSON.stringify(discoveredPaths) !== JSON.stringify(expectedPaths)) {
    errors.push(`publicPaths drift: configured=${JSON.stringify(expectedPaths)} discovered=${JSON.stringify(discoveredPaths)}.`);
  }
  if (errors.length) throw new Error(`Public SEO validation failed:\n- ${errors.join("\n- ")}`);
  return pages.sort((a, b) => a.route === "/" ? -1 : b.route === "/" ? 1 : a.route.localeCompare(b.route));
}

export function publicPagesScript(config) {
  return [
    "(() => {",
    '  "use strict";',
    "  window.HarnessPublicPageConfig = Object.freeze({",
    `    version: ${JSON.stringify(config.version)},`,
    `    origin: ${JSON.stringify(config.origin)},`,
    `    publicPaths: Object.freeze(${JSON.stringify(config.publicPaths)}),`,
    `    replaySafePaths: Object.freeze(${JSON.stringify(config.replaySafePaths)}),`,
    "  });",
    "})();",
    "",
  ].join("\n");
}

export function sitemapXml(pages) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.flatMap((page) => ["  <url>", `    <loc>${page.canonical}</loc>`, "  </url>"]),
    "</urlset>",
    "",
  ].join("\n");
}

function run() {
  const config = JSON.parse(readFileSync(publicPagesConfigPath, "utf8"));
  const pages = validatePublicPages(publicRoot, config);
  const xml = sitemapXml(pages);
  const browserConfig = publicPagesScript(config);

  if (process.argv.includes("--check")) {
    const stale = [];
    if (!existsSync(sitemapPath) || readFileSync(sitemapPath, "utf8") !== xml) stale.push("sitemap.xml");
    if (!existsSync(publicPagesScriptPath) || readFileSync(publicPagesScriptPath, "utf8") !== browserConfig) stale.push("assets/public-pages.js");
    if (stale.length) {
      console.error(`${stale.join(" and ")} stale. Run: npm run build:seo`);
      process.exitCode = 1;
      return;
    }
    console.log(`Public SEO metadata and generated assets are current (${pages.length} URLs).`);
    return;
  }

  writeFileSync(sitemapPath, xml, "utf8");
  writeFileSync(publicPagesScriptPath, browserConfig, "utf8");
  console.log(`Generated sitemap.xml and public-pages.js with ${pages.length} URLs.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
