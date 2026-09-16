/* Service workeren maa kun gemme det, der staar paa HVIDLISTEN.
 *
 * app/public/sw.js laeses ud af kilden og koeres i en attrap-verden (self,
 * caches, fetch). Derefter sendes et fetch-event pr. sti igennem, og vi ser
 * efter, hvad der faktisk endte i cachen - og hvad der blev serveret fra den,
 * naar nettet var vaek.
 *
 * Kokkeri er en flerbruger-app, og browserens cache er faelles for alle, der
 * logger ind paa maskinen: /api/settings baerer icalToken, /api/backup hele
 * databasen.
 *
 *   node tests/sw.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROD = path.resolve(import.meta.dirname, '..');
const KILDE = fs.readFileSync(path.join(ROD, 'app/public/sw.js'), 'utf8');
const ORIGIN = 'https://kokkeri.eksempel.invalid';
let ok = 0, fejl = 0;
const proev = async (navn, fn) => {
  try { await fn(); console.log('  ok   ' + navn); ok++; }
  catch (e) { console.log('  FEJL ' + navn + '\n       ' + e.message); fejl++; }
};

function verden() {
  const lyttere = {};
  const gemt = new Map();           // url -> Response (alle cache-navne under ét)
  let online = true;
  const cache = {
    put: async (req, res) => { gemt.set(req.url, res); },
    addAll: async () => {},
    match: async (req) => gemt.get(typeof req === 'string' ? ORIGIN + req : req.url)
  };
  const ctx = {
    URL, Promise, console,
    location: new URL(ORIGIN + '/sw.js'),
    Response: { error: () => ({ fejl: true }) },
    self: { addEventListener: (t, f) => { lyttere[t] = f; }, skipWaiting() {}, clients: { claim() {} } },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: (r) => cache.match(r) },
    fetch: async (req) => {
      if (!online) throw new TypeError('Failed to fetch');
      return { ok: true, clone() { return { kopi: req.url }; } };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(KILDE, ctx);
  /* Et fetch-event. Returnerer {haandteret, svar}. */
  async function hent(sti, { method = 'GET', mode = 'cors' } = {}) {
    const req = { url: ORIGIN + sti, method, mode };
    let svar = null, haandteret = false;
    lyttere.fetch({ request: req, respondWith: p => { haandteret = true; svar = p; } });
    if (svar) svar = await svar;
    await new Promise(r => setTimeout(r, 0));   // lad caches.open().then(put) naa frem
    return { haandteret, svar };
  }
  return { hent, gemt, set offline(v) { online = !v; }, lyttere };
}

console.log('Service worker: hvidliste for cachen');

const MAA = [
  '/', '/index.html', '/app.js?v=34', '/style.css?v=34', '/manifest.webmanifest', '/icon-192.png',
  '/api/items', '/api/items?fields=card', '/api/items/rec-000001', '/api/image/rec-000001?v=17'
];
const MAA_IKKE = [
  '/api/settings', '/api/backup', '/api/backup.db', '/api/me', '/api/access',
  '/api/admin/users', '/api/webauthn/credentials', '/api/site/crawl/status',
  '/api/todoist/projects', '/api/madplan.ics?token=abc', '/api/public-config',
  '/api/items/bulk', '/api/fetch-recipe?url=x', '/api/ha/test', '/api/wipe',
  '/api/nyt-endepunkt-ingen-har-set-endnu',
  '/oauth/authorize?client_id=x', '/mcp', '/del/0123456789abcdef', '/.well-known/oauth-authorization-server'
];

await proev('APP_VER staar stadig, som build_rune.py stempler den', async () => {
  if (!/const APP_VER = '\d+';/.test(KILDE)) throw new Error('APP_VER-linjen er vaek');
});

await proev('hvidlistede stier caches (og serveres fra cachen offline)', async () => {
  const w = verden();
  for (const sti of MAA) {
    const r = await w.hent(sti);
    if (!r.haandteret) throw new Error(sti + ' blev ikke haandteret');
    if (!w.gemt.has(ORIGIN + sti)) throw new Error(sti + ' blev ikke gemt');
  }
  w.offline = true;
  const r = await w.hent('/api/items/rec-000001');
  if (!r.svar || r.svar.kopi !== ORIGIN + '/api/items/rec-000001') throw new Error('offline-svaret kom ikke fra cachen');
});

await proev('alt andet caches ALDRIG - og haandteres slet ikke af SW\'en', async () => {
  const w = verden();
  for (const sti of MAA_IKKE) {
    const r = await w.hent(sti);
    if (r.haandteret) throw new Error(sti + ' blev haandteret af SW\'en');
  }
  const lakket = [...w.gemt.keys()];
  if (lakket.length) throw new Error('i cachen: ' + lakket.join(', '));
});

await proev('en privat sti, der ALLEREDE ligger i cachen, serveres ikke offline', async () => {
  const w = verden();
  w.gemt.set(ORIGIN + '/api/settings', { kopi: 'gammel' });
  w.offline = true;
  const r = await w.hent('/api/settings');
  if (r.haandteret) throw new Error('/api/settings blev serveret fra cachen');
});

await proev('kun GET og kun egen origin', async () => {
  const w = verden();
  if ((await w.hent('/api/items', { method: 'POST' })).haandteret) throw new Error('POST blev haandteret');
  const req = { url: 'https://andet.eksempel.invalid/api/items', method: 'GET' };
  let h = false;
  w.lyttere.fetch({ request: req, respondWith: () => { h = true; } });
  if (h) throw new Error('fremmed origin blev haandteret');
});

console.log(`\n${ok} ok, ${fejl} fejl`);
process.exit(fejl ? 1 : 0);
