'use strict';
/* Kokkeri service worker - offline-stoette.
 * Strategi: netvaerk foerst, cache som fallback. Alt hentes altid frisk naar
 * der er net (ingen versions-bump noedvendig); ryger nettet, virker appen og
 * de senest sete data (GET /api/items m.m.) stadig - fx kogetilstand i koekkenet. */

/* APP_VER stemples af build_rune.py - roer den ikke i haanden.
 * Ny version => nyt cache-navn => de gamle filer ryddes ved aktivering. */
const APP_VER = '30';
const CACHE = 'kokkeri-v' + APP_VER;
const CORE = ['/', '/app.js?v=' + APP_VER, '/style.css?v=' + APP_VER,
  '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

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
