/* Service Worker v7 - offline application shell.
 * Business data stays in localStorage. Authenticated Supabase/API responses are never cached.
 * Only the explicit static app-shell files are precached; same-origin app assets use network-first fallback.
 */
const VERSION = 'factory-v7';
const CORE = [
  './',
  './index.html',
  './auth.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './js/supabase.js',
  './js/cloud-sync.js',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(CORE.map(async path => {
      try {
        const url = new URL(path, self.registration.scope);
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok && response.type === 'basic') {
          await cache.put(url.href, response);
        }
      } catch (error) {
        console.warn('Offline asset not precached:', path, error);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(VERSION);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (_) {
      const cached = await caches.match(request);
      return cached || caches.match(new URL('./index.html', self.registration.scope).href);
    }
  })());
});
