const CACHE_PREFIX = "mylesnet-finance-pwa";
const CACHE_VERSION = "v1";
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";
const APP_SHELL_URLS = ["/signin", OFFLINE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const shellResponses = await Promise.all(APP_SHELL_URLS.map(async (path) => {
      const request = new Request(new URL(path, self.location.origin), {
        credentials: "omit",
        cache: "reload",
      });
      const response = await fetch(request);
      const responsePath = response.url ? new URL(response.url).pathname : path;
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || responsePath !== path || !contentType.includes("text/html") ||
          response.headers.has("set-cookie")) {
        throw new Error(`Unable to safely precache app shell route ${path}`);
      }
      // The shell allowlist contains only anonymous sign-in and offline UI. These explicit,
      // credential-free snapshots are safe to retain even when the app shell disables HTTP caching.
      return [path, response];
    }));
    await Promise.all(shellResponses.map(([path, response]) => cache.put(path, response)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== SHELL_CACHE && name !== STATIC_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isSensitiveRequest(request, url) {
  const pathname = url.pathname;
  return request.method !== "GET" ||
    request.headers.has("authorization") ||
    request.headers.has("cookie") ||
    request.mode === "websocket" ||
    request.headers.get("upgrade")?.toLowerCase() === "websocket" ||
    /^\/(api|auth|webhook|webhooks|convex)(\/|$)/i.test(pathname) ||
    /\/webhooks?(\/|$)/i.test(pathname);
}

function isStaticAsset(url) {
  const path = url.pathname;
  return path.startsWith("/_next/static/") ||
    path.startsWith("/fonts/") ||
    /^\/(icon-(192|512|maskable-512)|apple-touch-icon)\.png$/.test(path) ||
    /\.(woff2?|ttf|otf)$/.test(path);
}

function isCacheableAssetResponse(response) {
  if (!response.ok || response.type !== "basic" || response.headers.has("set-cookie")) return false;
  const cacheControl = response.headers.get("cache-control") || "";
  return !/private|no-store/i.test(cacheControl);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isSensitiveRequest(request, url)) return;

  if (request.mode === "navigate") {
    const navigationRequest = new Request(request, { cache: "no-store" });
    event.respondWith(fetch(navigationRequest).catch(async () => {
      const offlineResponse = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
      return offlineResponse || Response.error();
    }));
    return;
  }

  if (!isStaticAsset(url)) return;

  // Static assets are always fetched without browser cookies; auth state never gates
  // the cache, so a worker restart cannot delay assets or revive private responses.
  const cacheRequest = new Request(request, { credentials: "omit" });
  const update = fetch(cacheRequest).then(async (response) => {
    if (isCacheableAssetResponse(response)) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(cacheRequest, response.clone());
    }
    return response;
  });
  event.waitUntil(update.then(() => undefined).catch(() => undefined));
  event.respondWith((async () => {
    const cachedResponse = await caches.match(cacheRequest, { cacheName: STATIC_CACHE });
    return cachedResponse || update;
  })());
});
