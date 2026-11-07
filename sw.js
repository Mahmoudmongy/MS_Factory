/* Service Worker v6 - offline application shell.
 * Business data remains in localStorage; authenticated Supabase/API requests are never cached.
 * Same-origin app assets are network-first and cached for offline fallback. */
const VERSION='factory-v6';
const CORE=['./','./index.html','./auth.html','./manifest.json','./css/style.css','./js/app.js','./js/auth.js','./js/supabase.js','./js/cloud-sync.js','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(async c=>{await Promise.all(CORE.map(async path=>{try{const response=await fetch(path,{cache:'reload'});if(response.ok)await c.put(path,response)}catch(error){console.warn('Offline asset not precached:',path)}})})).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
 e.respondWith(fetch(r).then(res=>{if(res.ok&&res.type==='basic'){const cp=res.clone();caches.open(VERSION).then(c=>c.put(r,cp))}return res}).catch(()=>caches.match(r).then(m=>m||caches.match('./index.html'))))});
