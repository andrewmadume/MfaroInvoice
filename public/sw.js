const CACHE = "mfaro-public-assets-v4-branding-20261026";
const ASSETS = ["/manifest.webmanifest?v=20261026", "/MfaroInvoice-icon.svg?v=20261026", "/MfaroInvoice-logo.svg?v=20261026", "/icon-192.png?v=20261026", "/icon-512.png?v=20261026", "/apple-touch-icon.png?v=20261026", "/favicon.png?v=20261026"];
const STATIC_PATHS = new Set(ASSETS.map((asset) => asset.split("?")[0]));
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isPublicAsset = url.origin === self.location.origin && (STATIC_PATHS.has(url.pathname) || url.pathname.startsWith("/_next/static/"));
  // Never cache HTML, RSC payloads, API responses, or any authenticated request.
  if (event.request.method !== "GET" || !isPublicAsset || event.request.headers.has("cookie") || event.request.headers.has("authorization")) return;
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
    if (response.ok && response.type === "basic") caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
