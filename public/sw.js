// Service worker de Llama Repostera (PWA).
// Estrategia pensada para NO romper App Check ni servir código viejo:
//  - Documento (navegación) y JS/CSS/JSON → network-first (siempre intenta la versión fresca;
//    sólo usa caché como respaldo offline). Esto evita servir un app.js sin App Check.
//  - Imágenes/íconos/fuentes → cache-first (rápido y disponible offline).
//  - Cross-origin (Firestore, gstatic, reCAPTCHA, Tesseract CDN) → NO se intercepta.
// OJO: subir la versión al cambiar los assets precacheados (activate limpia los caches viejos)
const CACHE_NAME = 'reposteria-v5';
const PRECACHE = ['/', '/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

function networkFirst(request) {
  return fetch(request)
    .then(resp => {
      if (resp && resp.ok) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(request, clone));
      }
      return resp;
    })
    .catch(() => caches.match(request).then(c => c || (request.mode === 'navigate' ? caches.match('/index.html') : undefined)));
}

function cacheFirst(request) {
  return caches.match(request).then(cached => cached || fetch(request).then(resp => {
    if (resp && resp.ok) {
      const clone = resp.clone();
      caches.open(CACHE_NAME).then(c => c.put(request, clone));
    }
    return resp;
  }));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin: dejar pasar sin tocar

  const isAsset = /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf)$/i.test(url.pathname);
  if (isAsset) {
    event.respondWith(cacheFirst(req));
  } else {
    // documento + js + css + json → siempre fresco con respaldo offline
    event.respondWith(networkFirst(req));
  }
});
