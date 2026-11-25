// Offline app shell. Bump VERSION whenever app files change so phones pick up the update.
const VERSION = "langroll-v29";
const SHELL = [
  "./",
  "index.html",
  "app.css?v=14",
  "content.js?v=10",
  "srs.js?v=5",
  "app.js?v=23",
  "config.js?v=1",
  "sync.js?v=4",
  "watch.js?v=3",
  "recorder.js?v=1",
  "vendor/supabase-js-2.118.0.js",
  "privacy.html",
  "audio/manifest.json",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
];

// Every file comes fresh from the server, not from the browser's HTTP cache: GitHub Pages lets
// browsers keep files for 10 minutes, and a stale index.html stored under the new VERSION would be
// served until the next release.
self.addEventListener("install", (e) => {
  const fresh = SHELL.map((url) => new Request(url, { cache: "reload" }));
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
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
// Voice recordings are left to the browser's own cache: audio is fetched in byte ranges, which
// Safari won't play from a service worker's cache. Offline, the phone's voice stands in.
function cacheable(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin === self.location.origin && /\/audio\/.+\.mp3$/.test(url.pathname)) return false;
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
