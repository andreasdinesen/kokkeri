'use strict';
/* Kokkeri service worker - offline-stoette.
 * Strategi: netvaerk foerst, cache som fallback. Alt hentes altid frisk naar
 * der er net (ingen versions-bump noedvendig); ryger nettet, virker appen og
 * de senest sete data (GET /api/items m.m.) stadig - fx kogetilstand i koekkenet. */

const CACHE = 'kokkeri-v1';
const CORE = ['/', '/app.js', '/style.css', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  /* login/auth-svar maa aldrig caches */
  if (url.pathname.startsWith('/api/webauthn') || url.pathname === '/api/me') return;

  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() =>
      caches.match(req).then(hit => hit ||
        (req.mode === 'navigate' ? caches.match('/') : Response.error()))
    )
  );
});
