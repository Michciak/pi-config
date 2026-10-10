const CACHE = "pi-remote-shell-v2";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    const response = await fetch("/", {cache: "no-store"});
    const html = await response.clone().text();
    await cache.put("/", response);
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\/assets\/[^"]+|\/assets\/[^"]+)"/g)].map(match => match[1]);
    try { const manifest=await fetch("/shell-assets.json",{cache:"no-store"});if(manifest.ok)assets.push(...await manifest.json()); } catch {}
    await cache.addAll([...new Set(["/manifest.webmanifest", "/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", ...assets])]);
  }));
});
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("pi-remote-shell-") && key !== CACHE).map(key => caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("message", event => { if (event.data === "activate") self.skipWaiting(); });
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
  } else if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || ["/icon.svg", "/manifest.webmanifest"].includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
