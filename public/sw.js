const CACHE = "mfaro-shell-cf95ce59efe333c9";
const ASSETS = ["/offline/index.html", "/offline/workspace.js", "/offline/workspace.css", "/MfaroInvoice-logo.svg", "/icons/app-192-v3.png", "/icons/app-512-v3.png", "/icons/app-maskable-512-v3.png", "/icons/apple-touch-v3.png", "/icons/favicon-v3.png"];
const PUBLIC = new Set(ASSETS);
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
// Activation requires user choice or closure of every window using the old worker.
self.addEventListener("message",event=>{if(event.data?.type==="ACTIVATE_UPDATE")void self.skipWaiting();});
self.addEventListener("activate",event=>event.waitUntil((async()=>{const keys=(await caches.keys()).filter(k=>k.startsWith("mfaro-shell-"));const keep=new Set([CACHE,...keys.filter(k=>k!==CACHE).slice(-1)]);await Promise.all(keys.filter(k=>!keep.has(k)).map(k=>caches.delete(k)));await self.clients.claim();})()));
self.addEventListener("fetch",event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=="GET"||url.origin!==self.location.origin)return;
  if(request.mode==="navigate"){
    event.respondWith(fetch(request).catch(async()=>await(await caches.open(CACHE)).match("/offline/index.html")||new Response("Reconnect once to prepare offline access.",{status:503,headers:{"Content-Type":"text/plain"}})));
    return;
  }
  // No authenticated API, RSC, Supabase, document or financial-response caching.
  if(!PUBLIC.has(url.pathname))return;
  event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(request)));
});
