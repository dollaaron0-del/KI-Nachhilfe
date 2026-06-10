'use strict';
const CACHE = 'ki-tutor-v5';
const STATIC = ['./app.js', './style.css', './icon.svg', './manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (url.includes('api.anthropic.com') || url.includes('cdn.jsdelivr.net') || url.includes('cdnjs.cloudflare.com')) return;

  // HTML immer vom Netzwerk – nie gecacht, damit Updates sofort ankommen
  if (e.request.mode === 'navigate' || url.endsWith('.html')) {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }

  // Alles andere: Cache first, Netzwerk als Fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
