// Cache navigations only. Never substitute another route for a missing page.
const CACHE = "recipebox-v3";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add("/offline.html")));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("recipebox-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {}));
      }
      return response;
    } catch {
      // HTML alone cannot guarantee a functioning Next app without its JS chunks.
      // Show an honest self-contained offline screen rather than a broken cached app.
      return await caches.match("/offline.html") || new Response("أنت غير متصل. حاول مرة أخرى عند عودة الاتصال.", {headers:{"Content-Type":"text/plain; charset=utf-8"},status:503});
    }
  })());
});
