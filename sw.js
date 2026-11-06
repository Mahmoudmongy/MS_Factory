/* Service Worker v5 - app shell only.
 * - versioned cache, old caches deleted on activate (no stale app forever)
 * - network-first for same-origin GET so updates are picked up; cache is the offline fallback
 * - never touches non-GET, cross-origin (CDN libs / APIs) or /api/* requests => user data is never cached here
 * - user data lives in the page storage (per device/browser profile), not in this cache */
const VERSION='factory-v5';
const CORE=['./','./index.html','./manifest.json','./css/style.css','./js/app.js','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
 e.respondWith(fetch(r).then(res=>{if(res.ok&&res.type==='basic'){const cp=res.clone();caches.open(VERSION).then(c=>c.put(r,cp))}return res}).catch(()=>caches.match(r).then(m=>m||caches.match('./index.html'))))});
