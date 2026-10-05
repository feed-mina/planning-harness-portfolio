const CACHE_PREFIX = "harness-loop-";
const CACHE_NAME = `${CACHE_PREFIX}shell-v7`;
const OFFLINE_URL = "/offline.html";
const SHELL_ASSETS = [
  "/",
  OFFLINE_URL,
  "/assets/styles.css",
  "/assets/analytics.js",
  "/assets/common.js",
  "/assets/dashboard.js",
  "/assets/pwa-icon-192.png",
  "/assets/pwa-icon-512.png",
  "/manifest.webmanifest"
];

function canCache(response) {
  if (!response || !response.ok) return false;
  const cacheControl = response.headers.get("cache-control") || "";
  const responseUrl = new URL(response.url || location.origin, location.origin);
  return responseUrl.origin === location.origin && !cacheControl.toLowerCase().includes("no-store");
}

async function cacheCopy(request, response) {
  if (!canCache(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    await cacheCopy(request, response);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) return caches.match(fallbackUrl);
    return Response.error();
  }
}

function cacheFirst(request, event) {
  const network = fetch(request).then(async (response) => {
    await cacheCopy(request, response);
    return response;
  });
  event.waitUntil(network.then(() => undefined).catch(() => undefined));

  return caches.match(request)
    .then((cached) => cached || network)
    .catch(() => Response.error());
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, OFFLINE_URL));
    return;
  }

  if (request.cache === "no-store") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (["script", "style", "worker"].includes(request.destination)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request, event));
});
