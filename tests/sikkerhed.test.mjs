/* Sikkerhedsreviewet af huti-forbindelsen (14/10-2026) - regressionsproever.
 *
 *  1. huti-forbindelsen er faelles: forbind/test/afbryd kraever Kokkeri-admin, og
 *     »tag ud« rammer kun madvarer fra seneste pantry_for_planning (ikke ammunition),
 *     med en klemt maengde.
 *  2. SSRF: netvagten (app/netvagt.js) - DNS ved hvert kald, alle svar tjekkes,
 *     forbindelsen bundet til den tjekkede IP, hvert hop i en viderestilling tjekkes,
 *     interne adresser kun for admin, ens fejl udadtil. Gaelder opskriftsimport,
 *     crawl, billed-proxy, huti, egen AI-server, Home Assistant, doda og Cellarius.
 *  3. CSRF-barrieren sammenligner MIME-essensen praecist.
 *  +  /api/settings: en ikke-admin kan ikke flytte en adresse vaek fra en gemt noegle,
 *     og kan ikke aabne registreringen.
 *
 *   node --test tests/sikkerhed.test.mjs      (port 9159, eller KK_PROEVE_PORT3)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFalskHuti, LAESENOEGLE, SKRIVENOEGLE } from './falsk_huti.mjs';

const require = createRequire(import.meta.url);
const ROD = path.resolve(import.meta.dirname, '..');
const PORT = parseInt(process.env.KK_PROEVE_PORT3 || '9159', 10);
const HEMMELIG = 'INTERN-SIDE-MAA-ALDRIG-NAA-UD';

/* En »intern tjeneste« paa 127.0.0.1: noterer hvert kald og svarer med en hemmelighed.
 * /omdiriger sender videre til /hemmelig (til viderestillings-proeven). */
async function startIntern() {
  const s = { kald: [] };
  const server = http.createServer((req, res) => {
    const dele = [];
    req.on('data', d => dele.push(d));
    req.on('end', () => {
      s.kald.push({ url: req.url, metode: req.method, headere: req.headers });
      if (req.url.startsWith('/omdiriger-lh')) { res.writeHead(302, { location: `http://localhost:${server.address().port}/hemmelig` }); res.end(); return; }
      if (req.url.startsWith('/omdiriger')) { res.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/hemmelig` }); res.end(); return; }
      if (req.url.startsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"falsk"}]}'); return; }
      if (req.url.startsWith('/chat/completions')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'hej fra intern AI' } }] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<html><head><title>Intern</title></head><body>${HEMMELIG}</body></html>`);
    });
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  s.port = server.address().port;
  s.base = `http://127.0.0.1:${s.port}`;
  s.stop = () => new Promise(ok => { server.closeAllConnections(); server.close(ok); });
  return s;
}

function startKokkeri(dir) {
  const log = { tekst: '' };
  const p = spawn(process.execPath, ['app/server.js'], {
    cwd: ROD,
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: dir, KOKKERI_HUTI_TIMEOUT_MS: '1500' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  p.stdout.on('data', d => { log.tekst += d; });
  p.stderr.on('data', d => { log.tekst += d; });
  return new Promise((ok, nej) => {
    const t = setTimeout(() => nej(new Error('Kokkeri startede ikke:\n' + log.tekst)), 10000);
    p.stdout.on('data', () => { if (log.tekst.includes('lytter')) { clearTimeout(t); ok({ p, log }); } });
  });
}

/* En klient med sin egen cookie. */
function klient() {
  let cookie = '';
  return async (metode, sti, krop, headere) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${sti}`, { method: metode,
      headers: Object.assign({ cookie }, krop === undefined ? {} : { 'content-type': 'application/json' }, headere || {}),
      body: krop === undefined ? undefined : (typeof krop === 'string' ? krop : JSON.stringify(krop)) });
    const tekst = await r.text();
    const sc = r.headers.get('set-cookie');
    if (sc && !cookie) cookie = sc.split(';')[0];
    let json = null;
    try { json = JSON.parse(tekst); } catch (e) { /* ikke json */ }
    return { status: r.status, json, tekst };
  };
}

/* ---------------------------------------------------------------- netvagten for sig */

test('netvagt: interne adresser - og BlockList-faelden (IPv4 mod IPv6-regler)', () => {
  const N = require('../app/netvagt.js');
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', 'ikke-en-ip'])
    assert.equal(N.erIntern(a), true, a);
  for (const a of ['93.184.216.34', '1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])
    assert.equal(N.erIntern(a), false, a + ' er offentlig - en blandet BlockList ville sige intern');
});

test('netvagt: blokerer interne adresser uden tilladPrivat, binder til den tjekkede IP, tjekker hvert hop', async t => {
  const N = require('../app/netvagt.js');
  const intern = await startIntern();
  t.after(() => intern.stop());
  for (const url of [intern.base + '/hemmelig', `http://localhost:${intern.port}/hemmelig`, `http://[::ffff:127.0.0.1]:${intern.port}/`]) {
    await assert.rejects(N.hent(url, {}), e => e.kode === 'blokeret', url);
  }
  assert.equal(intern.kald.length, 0, 'intet kald naaede frem');
  const ok = await N.hent(intern.base + '/hemmelig', { tilladPrivat: true });
  assert.equal(ok.status, 200);
  assert.match(ok.buf.toString(), new RegExp(HEMMELIG));
  // Viderestilling: 127.0.0.1 maa (proeve-reglen), men hoppet til »localhost« tjekkes for sig.
  const kunDenneVaert = vaert => vaert === '127.0.0.1';
  const foerHop = intern.kald.length;
  await assert.rejects(N.hentFoelg(`${intern.base}/omdiriger-lh`, { tilladPrivat: kunDenneVaert }), e => e.kode === 'blokeret');
  assert.deepEqual(intern.kald.slice(foerHop).map(k => k.url), ['/omdiriger-lh'], 'hoppet til /hemmelig blev aldrig taget');
  const fulgt = await N.hentFoelg(`${intern.base}/omdiriger`, { tilladPrivat: true });
  assert.equal(fulgt.status, 200);
  // Andre protokoller og brugeroplysninger
  await assert.rejects(N.hent('file:///etc/passwd', { tilladPrivat: true }), e => e.kode === 'blokeret');
  await assert.rejects(N.hent(`http://a:b@127.0.0.1:${intern.port}/`, { tilladPrivat: true }), e => e.kode === 'blokeret');
  // Et ukendt navn -> unreachable
  await assert.rejects(N.hent('http://ikke-til.invalid/', {}), e => e.kode === 'unreachable');
});

test('huti.js: forbindelsen gaar gennem netvagten (intern adresse kraever tilladelse)', async t => {
  const H = require('../app/huti.js');
  const falsk = await startFalskHuti();
  t.after(() => falsk.stop());
  const lager = {};
  const mod = H.opret({ setting: (k, d) => (k in lager ? lager[k] : d), setSetting: (k, v) => { lager[k] = v; }, log: () => {} });
  const nej = await mod.forbind({ url: falsk.base, key: LAESENOEGLE, tilladPrivat: false });
  assert.equal(nej.ok, false);
  assert.equal(nej.kode, 'failed', 'samme kode som »ikke naaet« - ingen portscanner');
  assert.equal(falsk.kald.length, 0, 'huti blev aldrig kaldt');
  const ja = await mod.forbind({ url: falsk.base, key: LAESENOEGLE, tilladPrivat: true });
  assert.equal(ja.ok, true);
  assert.equal((await mod.beholdning({ frisk: true })).ok, true, 'den gemte (admin-)adresse maa bruges bagefter');
});

/* ---------------------------------------------------------------- ende til ende */

test('ende til ende: huti kun for admin, tag ud kun madvarer, SSRF-vagten, CSRF', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-sikker-'));
  const falsk = await startFalskHuti();
  const intern = await startIntern();
  const k = await startKokkeri(dir);
  t.after(async () => { k.p.kill(); await falsk.stop(); await intern.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  const admin = klient();
  const fremmed = klient();
  assert.equal((await admin('POST', '/api/register', { username: 'ejer', password: 'hemmeligt-kodeord' })).status, 200);
  assert.equal((await fremmed('POST', '/api/register', { username: 'fremmed', password: 'hemmeligt-kodeord' })).status, 200,
    'registreringen er aaben som standard - derfor skal huti-forbindelsen vaere admin');

  await t.test('1a: en ikke-admin kan hverken forbinde, teste eller afbryde', async () => {
    let r = await fremmed('POST', '/api/huti/forbind', { url: falsk.base, key: LAESENOEGLE });
    assert.equal(r.status, 403, r.tekst);
    assert.equal(falsk.kald.length, 0, 'den fremmede naaede ikke huti');
    r = await admin('POST', '/api/huti/forbind', { url: falsk.base, key: SKRIVENOEGLE });
    assert.equal(r.status, 200, r.tekst);
    const foer = falsk.kald.length;
    assert.equal((await fremmed('POST', '/api/huti/test', {})).status, 403);
    assert.equal((await fremmed('POST', '/api/huti/afbryd', {})).status, 403);
    assert.equal((await fremmed('POST', '/api/huti/forbind', { url: intern.base, key: 'huti_falsk' })).status, 403);
    assert.equal(falsk.kald.length, foer);
    const s = (await fremmed('GET', '/api/settings')).json;
    assert.equal(s.hutiSet, true, 'forbindelsen staar der stadig');
    assert.equal(s.hutiUrl, falsk.base, 'og peger stadig paa den rigtige huti');
    // Laesning er faelles Kokkeri-data: login er nok.
    assert.equal((await fremmed('POST', '/api/huti/beholdning', {})).status, 200);
  });

  await t.test('1b: tag ud rammer kun madvarer fra seneste pantry_for_planning, maengden klemmes', async () => {
    let r = await fremmed('POST', '/api/huti/tag-ud', { stockId: 77 });
    assert.equal(r.status, 409, r.tekst);
    assert.equal(r.json.kode, 'refused');
    assert.equal(falsk.taget.length, 0, 'ammunitionen blev ALDRIG taget ud');
    r = await admin('POST', '/api/huti/tag-ud', { stockId: 77 });
    assert.equal(r.json.kode, 'refused', 'heller ikke for admin - Kokkeri tager kun mad ud');
    r = await fremmed('POST', '/api/huti/tag-ud', { stockId: 12, amount: 100000 });
    assert.equal(r.status, 200, r.tekst);
    assert.equal(falsk.taget.length, 1);
    assert.ok(falsk.taget[0].amount === undefined || (Number.isInteger(falsk.taget[0].amount) && falsk.taget[0].amount <= 10),
      'maengden er klemt: ' + falsk.taget[0].amount);
    falsk.taget.length = 0;
    r = await fremmed('POST', '/api/huti/tag-ud', { stockId: 13, amount: 2.5 });
    assert.equal(r.status, 200, r.tekst);
    assert.ok(falsk.taget[0].amount === undefined || Number.isInteger(falsk.taget[0].amount), 'et helt tal');
  });

  await t.test('2: opskriftsimport kan ikke laese en intern side tilbage (ikke-admin), ens fejl', async () => {
    const intern1 = await fremmed('GET', '/api/fetch-recipe?url=' + encodeURIComponent(intern.base + '/hemmelig'));
    const ukendt = await fremmed('GET', '/api/fetch-recipe?url=' + encodeURIComponent('http://ikke-til.invalid/'));
    const lukket = await fremmed('GET', '/api/fetch-recipe?url=' + encodeURIComponent('http://127.0.0.1:1/'));
    for (const r of [intern1, ukendt, lukket]) assert.ok(!r.tekst.includes(HEMMELIG), r.tekst);
    assert.equal(intern1.status, ukendt.status);
    assert.equal(intern1.status, lukket.status);
    assert.equal(intern1.json.error, ukendt.json.error, 'samme besked for intern og ukendt');
    assert.equal(intern1.json.error, lukket.json.error, 'samme besked for intern og lukket port');
    assert.ok(!intern.kald.some(x => x.url === '/hemmelig'), 'den interne tjeneste blev aldrig kaldt');
    // site/fetch, site/discover, fetch-image og crawl - samme regel
    assert.notEqual((await fremmed('POST', '/api/site/fetch', { url: intern.base + '/hemmelig' })).status, 200);
    assert.notEqual((await fremmed('POST', '/api/site/discover', { url: intern.base + '/', mode: 'links' })).status, 200);
    assert.notEqual((await fremmed('GET', '/api/fetch-image?url=' + encodeURIComponent(intern.base + '/hemmelig'))).status, 200);
    const c = await fremmed('POST', '/api/site/crawl/start', { urls: [intern.base + '/hemmelig'] });
    assert.equal(c.status, 200, c.tekst);
    for (let i = 0; i < 50 && (await fremmed('GET', '/api/site/crawl/status')).json.running; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(intern.kald.length, 0, 'ingen af vejene naaede den interne tjeneste: ' + JSON.stringify(intern.kald.map(x => x.url)));
  });

  await t.test('2: admin MAA bruge interne adresser (Kokkeri og huti paa samme LAN-server)', async () => {
    const r = await admin('GET', '/api/fetch-recipe?url=' + encodeURIComponent(intern.base + '/omdiriger'));
    assert.equal(r.status, 200, r.tekst);
    assert.match(r.json.pageText, new RegExp(HEMMELIG), 'viderestillingen blev fulgt for admin');
  });

  await t.test('2: integrationer med en gemt adresse - intern kun, naar en admin satte den', async () => {
    // Den fremmede saetter sin egen AI-server til den interne tjeneste.
    let r = await fremmed('POST', '/api/settings', { settings: { ai_provider: 'openai', ai_url: intern.base, ai_model: 'falsk' } });
    assert.equal(r.status, 200, r.tekst);
    const foer = intern.kald.length;
    r = await fremmed('POST', '/api/ai', { messages: [{ role: 'user', content: 'hej' }] });
    assert.notEqual(r.status, 200);
    assert.equal(intern.kald.length, foer, 'AI-kaldet naaede ikke den interne tjeneste');
    // Home Assistant: samme regel
    await fremmed('POST', '/api/items/bulk', { items: [{ id: 'vare-000001', kind: 'shopItem', text: 'maelk', done: false }] });
    r = await fremmed('POST', '/api/settings', { settings: { ha_url: intern.base, ha_token: 'tok', ha_entity: 'todo.indkoeb' } });
    assert.equal(r.status, 200, r.tekst);
    r = await fremmed('POST', '/api/ha/push-shopping', {});
    assert.notEqual(r.status, 200);
    assert.equal(intern.kald.length, foer, 'HA-kaldet naaede ikke den interne tjeneste');
    // Admin saetter samme adresser -> virker (LM Studio og HA paa LAN)
    r = await admin('POST', '/api/settings', { settings: { ai_provider: 'openai', ai_url: intern.base, ai_model: 'falsk' } });
    r = await admin('POST', '/api/ai', { messages: [{ role: 'user', content: 'hej' }] });
    assert.equal(r.status, 200, r.tekst);
    r = await admin('POST', '/api/settings', { settings: { ha_url: intern.base, ha_entity: 'todo.indkoeb' } });
    r = await admin('POST', '/api/ha/push-shopping', {});
    assert.equal(r.status, 200, r.tekst);
    // ... og en fremmed, der gemmer den SAMME adresse igen, oedelaegger det ikke
    await fremmed('POST', '/api/settings', { settings: { ai_provider: 'openai', ai_url: intern.base, ai_model: 'falsk' } });
    assert.equal((await fremmed('POST', '/api/ai', { messages: [{ role: 'user', content: 'hej' }] })).status, 200);
  });

  await t.test('+: en ikke-admin kan ikke flytte en adresse vaek fra en gemt noegle eller aabne registreringen', async () => {
    let r = await admin('POST', '/api/settings', { settings: { ha_url: 'https://ha.eksempel.invalid', ha_token: 'HA-HEMMELIG-TOKEN', ha_entity: 'todo.x' } });
    assert.equal(r.status, 200, r.tekst);
    r = await fremmed('POST', '/api/settings', { settings: { ha_url: 'https://angriber.eksempel.invalid' } });
    assert.equal(r.status, 403, 'tokenet ville ellers blive sendt til den nye adresse');
    assert.equal((await admin('GET', '/api/settings')).json.haUrl, 'https://ha.eksempel.invalid');
    r = await fremmed('POST', '/api/settings', { settings: { ha_url: 'https://angriber.eksempel.invalid', ha_token: 'mit-eget' } });
    assert.equal(r.status, 200, 'med sin egen noegle er det bare en ny forbindelse');
    r = await fremmed('POST', '/api/settings', { settings: { allow_registration: '1' } });
    assert.equal(r.status, 403, 'registreringen styres kun af admin');
  });

  await t.test('3: CSRF-barrieren - MIME-essensen sammenlignes praecist', async () => {
    for (const ct of ['text/plain; x=application/json', 'text/plain;application/json', 'application/jsonx', 'application/json-patch+json'])
      assert.equal((await admin('POST', '/api/settings', JSON.stringify({ settings: {} }), { 'content-type': ct })).status, 400, ct);
    for (const ct of ['application/json', 'application/json; charset=utf-8', 'Application/JSON'])
      assert.equal((await admin('POST', '/api/settings', JSON.stringify({ settings: {} }), { 'content-type': ct })).status, 200, ct);
  });
});
