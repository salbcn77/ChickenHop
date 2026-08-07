const CACHE_NAME = 'chicken-hop-v5';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './leaderboard.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: always serve the latest code when online (so updates apply
// on the very next reload instead of the one after), falling back to the
// cache only when there's no connection. `cache: 'no-store'` is needed here
// because a plain fetch() still consults the browser's own HTTP cache first
// — without it, an update could sit invisible behind that cache even though
// this handler is otherwise "network-first".
//
// Only same-origin requests are handled here — everything else (Firestore's
// realtime channels, Google Fonts, etc.) is left to go straight to the
// network untouched. Caching third-party traffic indiscriminately is risky:
// Firestore in particular uses long-lived streaming requests that make no
// sense to cache and shouldn't be intercepted.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        if (response.ok || response.type === 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
