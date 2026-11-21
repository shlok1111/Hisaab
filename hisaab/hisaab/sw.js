/* =====================================================================
   HISAAB service worker  -  the part that makes the app open offline.

   A service worker is a small script the browser keeps running beside
   the page. Every file the page asks for passes through it first.

   The rule used here is "network first, saved copy as the fallback":
     online   fetch the newest file, and save a copy of it
     offline  hand back the copy saved earlier
     slow     if the network takes over 2.5 seconds, use the saved copy

   Your entries are NOT in here. They live in localStorage (see app.js,
   part 4). This file only keeps the app's own files: HTML, CSS, JS,
   fonts and icons.
   ===================================================================== */
const CACHE = "hisaab-files-v1";

// Everything the app needs to start. Saved the first time you open it.
const FILES = [
  "./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "icons/favicon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
  "fonts/ibm-plex-sans-latin-400-normal.woff2", "fonts/ibm-plex-sans-latin-500-normal.woff2", "fonts/ibm-plex-sans-latin-600-normal.woff2",
  "fonts/ibm-plex-sans-latin-ext-400-normal.woff2", "fonts/ibm-plex-sans-latin-ext-500-normal.woff2", "fonts/ibm-plex-sans-latin-ext-600-normal.woff2",
  "fonts/bricolage-grotesque-latin-600-normal.woff2", "fonts/bricolage-grotesque-latin-800-normal.woff2",
];

// First visit: save every file in the list.
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

// After an update: delete caches left by older versions, then take control of open pages.
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// Every request from the page comes through here.
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;   // not ours: let the browser handle it
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request, { ignoreSearch: true });
  // "no-cache" makes the browser check with the server instead of trusting its own stale copy,
  // so an update you push to GitHub shows up on the next reload.
  const fresh = fetch(request.url, { cache: "no-cache" }).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  if (!saved) return fresh;                                             // nothing saved yet: the network is the only option
  const tooSlow = new Promise(resolve => setTimeout(() => resolve(saved), 2500));
  return Promise.race([fresh.catch(() => saved), tooSlow]);
}
