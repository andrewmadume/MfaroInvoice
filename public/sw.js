const CACHE = "mfaro-public-assets-v6-icons-20261028";
const ASSETS = ["/MfaroInvoice-logo.svg?v=20261026", "/icons/app-192-v3.png", "/icons/app-512-v3.png", "/icons/app-maskable-512-v3.png", "/icons/apple-touch-v3.png", "/icons/favicon-v3.png"];
const STATIC_PATHS = new Set(ASSETS.map((asset) => asset.split("?")[0]));
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === "/manifest.webmanifest") return;
  const isPublicAsset = url.origin === self.location.origin && (STATIC_PATHS.has(url.pathname) || url.pathname.startsWith("/_next/static/"));
  // Never cache HTML, RSC payloads, API responses, or any authenticated request.
  if (event.request.method !== "GET" || !isPublicAsset || event.request.headers.has("cookie") || event.request.headers.has("authorization")) return;
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
    if (response.ok && response.type === "basic") caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
