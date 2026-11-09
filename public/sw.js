/* MS Factory offline application shell.
 * Business data remains in localStorage. Cross-origin Supabase/API traffic is never cached.
 * Cache cleanup is restricted to this app's explicitly named cache; other apps on the
 * same origin must never lose their Cache Storage entries.
 */
const VERSION = 'ms-factory-shell-v11';
const LEGACY_APP_CACHES = new Set(['factory-v5', 'factory-v10']);
const SHELL_PAGES = ['./', './index.html', './auth.html', './change-password.html'];
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

function isCacheableRequest(request, url) {
  if (request.mode === 'navigate') {
    return SHELL_PAGES.some(path => new URL(path, self.registration.scope).pathname === url.pathname);
  }
  return /\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?|ttf|json)(?:$|\?)/i.test(url.pathname + url.search);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(CORE.map(async path => {
      try {
        const url = new URL(path, self.registration.scope);
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok && response.type === 'basic') await cache.put(url.href, response);
      } catch (error) {
        console.warn('Offline asset not precached:', path, error);
      }
    }));
    // Pre-cache local Vite assets referenced by the HTML shell. Never cache third-party URLs.
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
            if (assetUrl.origin !== self.location.origin || !isCacheableRequest(new Request(assetUrl), assetUrl)) continue;
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
    const obsoleteAppCaches = keys.filter(key => LEGACY_APP_CACHES.has(key) || (key.startsWith('ms-factory-shell-v') && key !== VERSION));
    await Promise.all(obsoleteAppCaches.map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (!isCacheableRequest(request, url)) return;

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
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await caches.match(new URL('./index.html', self.registration.scope).href);
        if (shell) return shell;
      }
      return new Response('Offline: requested resource is not available in the application cache.', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
  })());
});
