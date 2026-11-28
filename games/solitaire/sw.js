// Offline support: serve the app from cache, refresh the cache in the
// background so updates arrive on the next visit.
const CACHE = 'solitaire-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/store.js', 'js/winnable.js',
  'js/core/rng.js', 'js/core/cards.js', 'js/core/solver.js',
  'js/games/index.js', 'js/games/klondike.js', 'js/games/spider.js', 'js/games/freecell.js', 'js/games/pyramid.js', 'js/games/tripeaks.js',
  'js/ui/board.js', 'js/ui/faces.js', 'js/ui/fx.js', 'js/ui/sound.js', 'js/ui/celebrate.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
