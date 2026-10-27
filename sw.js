// Service worker: makes the app shell load instantly and offline.
// API calls to api.anthropic.com are never cached.
const VERSION = 'oeno-v3';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'app.js', 'claude.js', 'db.js', 'demo.js', 'image.js', 'pipeline.js', 'prompts.js', 'scoring.js',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'api.anthropic.com') return;

  // Fonts: cache-first.
  if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // App shell: stale-while-revalidate. Opens instantly on weak in-store signal;
  // a newer version is fetched in the background and used on the next launch.
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request).then((res) => {
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || (await c.match('index.html')) || Response.error();
    }));
  }
});
