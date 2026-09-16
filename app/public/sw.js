'use strict';
/* Kokkeri service worker - offline-stoette.
 * Strategi: netvaerk foerst, cache som fallback. Alt hentes altid frisk naar
 * der er net (ingen versions-bump noedvendig); ryger nettet, virker appen og
 * de senest sete opskrifter og billeder stadig - fx kogetilstand i koekkenet. */

/* APP_VER stemples af build_rune.py - roer den ikke i haanden.
 * Ny version => nyt cache-navn => de gamle filer ryddes ved aktivering. */
const APP_VER = '35';
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

/* HVIDLISTEN - kun det, der staar her, gemmes i browserens cache.
 * Appens egne filer, og det kogetilstanden og opskrifterne skal bruge, naar
 * nettet ryger midt i madlavningen: listen (GET /api/items, ogsaa
 * ?fields=card), den enkelte opskrift (/api/items/<id>) og billederne
 * (/api/image/<id>). Dataene er faelles for alle brugere - intet personligt.
 * Kokkeri er en flerbruger-app, og cachen er faelles for alle, der logger ind
 * paa maskinen: /api/settings baerer icalToken, /api/backup hele databasen,
 * /api/me og /api/access brugerne, /oauth/authorize en samtykkeside, /del/
 * et delings-token. En sortliste glemmer den naeste - derfor en hvidliste. */
const STATISK = /^\/(|index\.html|app\.js|style\.css|manifest\.webmanifest|icon-\d+\.png|favicon\.ico)$/;
function maaCaches(sti) {
  return STATISK.test(sti) ||
    sti === '/api/items' ||
    (sti.startsWith('/api/items/') && sti !== '/api/items/bulk') ||
    sti.startsWith('/api/image/');
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  /* alt uden for hvidlisten gaar direkte til nettet - ingen kopi, intet fallback */
  if (!maaCaches(url.pathname)) return;

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
