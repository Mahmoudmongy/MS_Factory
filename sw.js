/* Service Worker v8 - offline application shell.
 * Online business data is read/written directly in Supabase; local state and queued changes are fallback-only offline.
 * Authenticated Supabase/API responses are never cached.
 * Only stable shell files are precached; built Vite assets are cached on first successful request.
 */
const VERSION = 'factory-v10';
const CORE = [
  './',
  './index.html',
  './auth.html',
  './change-password.html',
  './css/style.css',
  './manifest.json',
  './js/app.js',
  './js/change-password.js'
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
    // Pre-cache the production Vite modulepreload/script/style assets referenced by the HTML shell.
    for (const page of ['./index.html', './auth.html', './change-password.html']) {
      try {
        const pageUrl = new URL(page, self.registration.scope);
        const pageResponse = await fetch(pageUrl, { cache: 'reload' });
        if (!pageResponse.ok) continue;
        const html = await pageResponse.clone().text();
        const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
        for (const ref of refs) {
          try {
            const assetUrl = new URL(ref, pageUrl);
            if (assetUrl.origin !== self.location.origin || !/\.(?:js|css|svg|png|woff2?)(?:$|\?)/i.test(assetUrl.href)) continue;
            const assetResponse = await fetch(assetUrl, { cache: 'reload' });
            if (assetResponse.ok && assetResponse.type === 'basic') await cache.put(assetUrl.href, assetResponse);
          } catch (error) {
            console.warn('Offline module asset not precached:', ref, error);
          }
        }
      } catch (error) {
        console.warn('Could not inspect offline shell assets:', page, error);
      }
    }
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
