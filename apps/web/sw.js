// Offline app shell. Bump VERSION whenever app files change so phones pick up the update.
const VERSION = "langroll-v11";
const SHELL = [
  "./",
  "index.html",
  "app.css?v=5",
  "content.js?v=5",
  "srs.js?v=4",
  "app.js?v=10",
  "config.js?v=1",
  "sync.js?v=3",
  "vendor/supabase-js-2.118.0.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Only the app's own files and its web fonts are cached. Everything else, above all the API and
// Supabase auth, goes straight to the network: caching them would replay stale, per-user
// responses forever.
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
function cacheable(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin || FONT_HOSTS.includes(url.hostname);
}

// Cache first for the shell, network with cache fallback for fonts.
self.addEventListener("fetch", (e) => {
  if (!cacheable(e.request)) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && (res.type === "basic" || res.type === "cors")) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
