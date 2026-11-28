// Fact Rocket service worker: keeps a copy of the app on the device so it opens with no connection.
// Strategy: answer from the saved copy right away, then refresh that copy in the background,
// so a new version shows up on the launch after it was fetched.
// The cache name and file list are repeated in index.html ("Check for update").
const CACHE = 'fact-rocket-v1';
const FILES = ['./', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const ROOT = new URL('./', location).pathname;   // the folder this worker lives in

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(f => new Request(f, {cache: 'reload'}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('fact-rocket-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.cache === 'reload') return;   // "Check for update" asks the network directly
  // The app page itself (with or without index.html) is stored once, under "./".
  const isApp = url.pathname === ROOT || url.pathname === ROOT + 'index.html';
  const file = url.pathname.slice(ROOT.length);
  if (!isApp && !FILES.includes(file)) return;   // anything else (prompt.html, …) goes straight to the network
  const key = isApp ? './' : file;

  e.respondWith(caches.open(CACHE).then(async cache => {
    const saved = await cache.match(key);
    const fresh = fetch(key, {cache: 'no-cache'}).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    if (!saved) return fresh;
    e.waitUntil(fresh.catch(() => {}));   // offline: keep what we have
    return saved;
  }));
});
