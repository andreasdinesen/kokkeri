/* Kokkeri -> huti (v55): app/huti.js, huti-matcheren i app/mcp.js og /api/huti/*.
 *
 *  - de rene dele: adressen, JSON/SSE-laesningen, rensningen af hutis varer
 *  - matcheren: samme raekkefoelge som what_can_i_cook (uden »spis snart«), og
 *    »spis snart« foerst; indkoebslinjerne er strengere (bouillon taeller ikke)
 *  - ende til ende mod en FALSK huti (tests/falsk_huti.mjs) og den rigtige Kokkeri-
 *    server: forbind/test/afbryd, ny adresse kraever noeglen, qlk-moenstret (ingen
 *    Origin, Bearer, Accept, ingen initialize), forslag, maerker, linjer, tag ud,
 *    fejlstierne 401/timeout/500/HTML/viderestilling/SSE, ondsindede navne, og at
 *    noeglen ALDRIG staar i et svar eller i loggen.
 *
 *   node --test tests/huti.test.mjs      (port 9157, eller KK_PROEVE_PORT)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFalskHuti, LAESENOEGLE, SKRIVENOEGLE, HEMMELIG_KROP, VARER } from './falsk_huti.mjs';

const require = createRequire(import.meta.url);
const ROD = path.resolve(import.meta.dirname, '..');
const H = require('../app/huti.js');
const M = require('../app/mcp.js');
const PORT = parseInt(process.env.KK_PROEVE_PORT || '9157', 10);

const OPSKRIFTER = [
  { id: 'opskr-hjort-01', kind: 'recipe', title: 'Hjortegryde', category: 'Hovedret', rating: 3,
    ingredients: ['1 hjortekølle', '2 dl piskefløde', 'salt'] },
  { id: 'opskr-lasag-02', kind: 'recipe', title: 'Vildtlasagne', category: 'Hovedret', rating: 5,
    ingredients: ['500 g hakket vildt', 'lasagneplader', '1 terning kyllingebouillon'] },
  { id: 'opskr-kylsa-03', kind: 'recipe', title: 'Kyllingesalat', category: 'Salat', rating: 4, tags: ['frokost'],
    ingredients: ['2 kyllingebryst', 'salat'] },
  { id: 'opskr-flkar-04', kind: 'recipe', title: 'Flødekartofler', category: 'Tilbehør', rating: 2,
    ingredients: ['1 kg kartofler', '3 dl piskefløde'] },
  { id: 'opskr-pande-05', kind: 'recipe', title: 'Pandekager', category: 'Dessert', rating: 5,
    ingredients: ['3 æg', '5 dl mælk'] },
  { id: 'opskr-intet-06', kind: 'recipe', title: 'Bønnesuppe', category: 'Hovedret', rating: 5,
    ingredients: ['## Suppen', '2 dåser bønner', '1 l grøntsagsbouillon'] }
];

/* ---------------------------------------------------------------- de rene dele */

test('rensBase: kun http(s), ingen brugeroplysninger, /mcp og skraastreg vaek', () => {
  assert.equal(H.rensBase('https://huti.example.dk/'), 'https://huti.example.dk');
  assert.equal(H.rensBase('huti.example.dk'), 'https://huti.example.dk');
  assert.equal(H.rensBase('http://192.168.0.10:8080/mcp'), 'http://192.168.0.10:8080');
  for (const d of ['javascript:alert(1)', 'ftp://x.dk', 'https://bruger:kode@x.dk', 'file:///etc/passwd', '', 'https://x.dk/?a=1'])
    assert.equal(H.rensBase(d), '', d);
});

test('laesSvar: JSON, batch, SSE og affald', () => {
  assert.deepEqual(H.laesSvar('{"jsonrpc":"2.0","id":1,"result":{}}', 'application/json'), [{ jsonrpc: '2.0', id: 1, result: {} }]);
  assert.equal(H.laesSvar('[{"id":1},{"id":2}]', 'application/json').length, 2);
  assert.deepEqual(H.laesSvar('event: message\ndata: {"id":3,"result":{"x":1}}\n\n', 'text/event-stream'), [{ id: 3, result: { x: 1 } }]);
  assert.equal(H.laesSvar('data: [{"id":1},{"id":2}]\n\n', 'text/event-stream').length, 2);
  assert.equal(H.laesSvar('<html>nej</html>', 'text/html'), null);
  assert.equal(H.laesSvar('"bare en streng"', 'application/json'), null);
});

test('rensVare: hutis svar er utrovaerdigt', () => {
  const v = H.rensVare({ id: 21, name: '<img src=x onerror=alert(1)>Laks', word: '<b>laks</b>', quantity: 'mange', unit: '<script>',
    place: 'javascript:alert(1)', status: 'eat_soon', bestBefore: 'i morgen', ageDays: 1e12, origin: { species: '"><script>', area: '<i>x</i>' } });
  assert.equal(v.name, 'Laks');
  assert.equal(v.word, 'laks');
  assert.equal(v.quantity, null);
  assert.equal(v.unit, '');
  assert.equal(v.bestBefore, null);
  assert.equal(v.ageDays, null);
  assert.equal(v.origin, null, 'ukendt art-kode -> ingen oprindelse');
  assert.equal(v.soon, true);
  assert.equal(H.rensVare({ id: 'javascript:alert(1)', name: 'x' }), null);
  assert.equal(H.rensVare({ id: 5, name: '' }), null);
  const k = H.rensVare(VARER()[0]);
  assert.deepEqual([k.unit, k.origin.species, k.origin.area, k.place], ['stk', 'kronhjort', 'Revir Nord', 'Fryser › Skuffe 2']);
  assert.equal(H.rensVare(VARER()[3]).origin, null, 'manglende origin-felt taales');
});

test('matcheren: samme raekkefoelge som what_can_i_cook uden »spis snart«, og spis snart foerst', async () => {
  const varer = VARER().map(H.rensVare);
  const ingen = varer.map(v => Object.assign({}, v, { soon: false }));
  const f = M.hutiForslag(OPSKRIFTER, ingen, { limit: 50 });
  const srv = { listItems: () => OPSKRIFTER, totalMin: () => null, host: () => '' };
  const wcic = M.opret(srv).VAERKTOEJER.find(v => v.name === 'what_can_i_cook');
  const w = await wcic.kald({ ingredients: f.ord.map(o => o.ord), limit: 50 });
  assert.deepEqual(f.retter.map(x => x.r.id), w.data.recipes.map(r => r.id), 'samme raekkefoelge');
  assert.deepEqual(f.retter.map(x => x.n), w.data.recipes.map(r => r.matched), 'samme taelling');
  assert.ok(!f.retter.some(x => x.r.id === 'opskr-intet-06'));
  // Pandekager kommer med via raavaregruppen (piskefløde ~ mælk) - som i what_can_i_cook.
  assert.ok(f.retter.some(x => x.r.id === 'opskr-pande-05'));
  // Med »spis snart« (hjortekølle, hakket vildt) kommer de retter foerst.
  const s = M.hutiForslag(OPSKRIFTER, varer, { limit: 50 });
  assert.deepEqual(s.retter.slice(0, 2).map(x => x.r.id).sort(), ['opskr-hjort-01', 'opskr-lasag-02']);
  assert.ok(s.retter.slice(2).every(x => x.snart === 0));
  // Kategori- og frokostfilteret
  assert.deepEqual(M.hutiForslag(OPSKRIFTER, varer, { kategorier: ['Hovedret'] }).retter.map(x => x.r.id).sort(), ['opskr-hjort-01', 'opskr-lasag-02']);
  assert.deepEqual(M.hutiForslag(OPSKRIFTER, varer, { kunFrokost: true }).retter.map(x => x.r.id), ['opskr-kylsa-03']);
  // Maerket paa en ret: hvilke varer
  assert.deepEqual(M.hutiVarerTil(OPSKRIFTER[0], varer).map(v => v.id).sort(), [11, 13]);
});

test('indkoebslinjerne: strengere end opskrift-matcheren', () => {
  const varer = VARER().map(H.rensVare);
  const id = l => M.hutiVarerTilLinje(l, varer).map(v => v.id);
  assert.deepEqual(id('500 g hakket vildt'), [12]);
  assert.deepEqual(id('2 dl piskefløde'), [13]);
  assert.deepEqual(id('5 dl mælk'), [], 'gruppen (mælk ~ fløde) taeller ikke paa listen');
  assert.deepEqual(id('1 terning kyllingebouillon'), [], 'smagsgiver');
  assert.deepEqual(id('2 kyllingebryst uden skind'), [14]);
  assert.deepEqual(id('salt'), []);
});

/* ---------------------------------------------------------------- ende til ende */

function startKokkeri(dir, env) {
  const log = { tekst: '' };
  const p = spawn(process.execPath, ['app/server.js'], {
    cwd: ROD,
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: dir, KOKKERI_HUTI_TIMEOUT_MS: '700' }, env),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  p.stdout.on('data', d => { log.tekst += d; });
  p.stderr.on('data', d => { log.tekst += d; });
  return new Promise((ok, nej) => {
    const t = setTimeout(() => nej(new Error('Kokkeri startede ikke:\n' + log.tekst)), 10000);
    p.stdout.on('data', () => { if (log.tekst.includes('lytter')) { clearTimeout(t); ok({ p, log }); } });
  });
}

test('ende til ende mod en falsk huti', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-huti-'));
  const falsk = await startFalskHuti();
  const k = await startKokkeri(dir);
  t.after(async () => { k.p.kill(); await falsk.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  const svar = [];                      // ALT, Kokkeri har svaret - noeglen maa aldrig staa i det
  let cookie = '';
  const kald = async (metode, sti, krop, headere) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${sti}`, { method: metode,
      headers: Object.assign({ cookie }, krop === undefined ? {} : { 'content-type': 'application/json' }, headere || {}),
      body: krop === undefined ? undefined : JSON.stringify(krop) });
    const tekst = await r.text();
    svar.push(tekst);
    const sc = r.headers.get('set-cookie');
    if (sc && !cookie) cookie = sc.split(';')[0];
    let json = null;
    try { json = JSON.parse(tekst); } catch (e) { /* ikke json */ }
    return { status: r.status, json, tekst };
  };
  assert.equal((await kald('POST', '/api/register', { username: 'proeve', password: 'hemmeligt-kodeord' })).status, 200);
  assert.equal((await kald('POST', '/api/items/bulk', { items: OPSKRIFTER })).status, 200);
  const huti = falsk.base;

  await t.test('forbind: forkert noegle gemmes ikke, rigtig noegle gemmes efter proeven', async () => {
    let r = await kald('POST', '/api/huti/forbind', { url: huti, key: 'huti_forkert' });
    assert.equal(r.status, 400);
    assert.equal(r.json.kode, 'bad_key');
    assert.ok(!r.tekst.includes(HEMMELIG_KROP));
    assert.equal((await kald('GET', '/api/settings')).json.hutiSet, false);
    r = await kald('POST', '/api/huti/forbind', { url: 'javascript:alert(1)', key: LAESENOEGLE });
    assert.equal(r.json.kode, 'bad_url');
    r = await kald('POST', '/api/huti/forbind', { url: huti + '/', key: LAESENOEGLE });
    assert.equal(r.status, 200, r.tekst);
    assert.deepEqual([r.json.total, r.json.eatSoon, r.json.canWrite], [4, 2, false]);
    const s = (await kald('GET', '/api/settings')).json;
    assert.deepEqual([s.hutiSet, s.hutiKeySet, s.hutiUrl, s.hutiCanWrite], [true, true, huti, false]);
    assert.ok(!('huti_key' in s) && !('hutiKey' in s));
  });

  await t.test('qlk-moenstret: ingen Origin, Bearer, Accept, ingen initialize', () => {
    const c = falsk.kald.filter(x => x.url === '/mcp');
    assert.ok(c.length >= 2);
    for (const x of c) {
      assert.equal(x.headere.origin, undefined);
      assert.match(String(x.headere.accept), /application\/json/);
      assert.match(String(x.headere.accept), /text\/event-stream/);
      const poster = Array.isArray(x.krop) ? x.krop : [x.krop];
      assert.ok(!poster.some(p => p.method === 'initialize'));
    }
    assert.equal(c[c.length - 1].headere.authorization, `Bearer ${LAESENOEGLE}`);
  });

  await t.test('generelle /api/settings kan ikke saette huti-noeglen', async () => {
    const r = await kald('POST', '/api/settings', { settings: { huti_key: 'huti_snyd', huti_url: 'http://127.0.0.1:1' } });
    assert.equal(r.status, 400);
    assert.equal((await kald('GET', '/api/settings')).json.hutiUrl, huti);
  });

  await t.test('ny adresse kraever noeglen igen - samme adresse genbruger den', async () => {
    let r = await kald('POST', '/api/huti/forbind', { url: 'http://127.0.0.1:9', key: '' });
    assert.equal(r.status, 400);
    assert.equal(r.json.kode, 'need_key');
    r = await kald('POST', '/api/huti/forbind', { url: huti, key: '' });
    assert.equal(r.status, 200, r.tekst);
  });

  await t.test('Test viser tallene', async () => {
    const r = await kald('POST', '/api/huti/test', {});
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.total, r.json.eatSoon], [4, 2]);
    assert.equal(r.json.settings.hutiStatus.ok, true);
  });

  await t.test('forslag: spis snart foerst, varerne med, cachen', async () => {
    const foer = falsk.kald.length;
    const r = await kald('POST', '/api/huti/forslag', {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.recipes.slice(0, 2).map(x => x.id).sort(), ['opskr-hjort-01', 'opskr-lasag-02']);
    const hjort = r.json.recipes.find(x => x.id === 'opskr-hjort-01');
    assert.deepEqual(hjort.from.sort(), [11, 13]);
    assert.equal(hjort.soon, 1);
    assert.equal(r.json.items.length, 4);
    assert.equal(falsk.kald.length, foer, 'cachen: intet nyt kald til huti');
    const kat = await kald('POST', '/api/huti/forslag', { categories: ['Hovedret'] });
    assert.deepEqual(kat.json.recipes.map(x => x.id).sort(), ['opskr-hjort-01', 'opskr-lasag-02']);
    const fr = await kald('POST', '/api/huti/forslag', { meal: 'lunch' });
    assert.deepEqual(fr.json.recipes.map(x => x.id), ['opskr-kylsa-03']);
    await kald('POST', '/api/huti/forslag', { frisk: true });
    assert.equal(falsk.kald.length, foer + 1, 'frisk: true spoerger igen');
  });

  await t.test('maerker paa madplanen og linjer til indkoebslisten', async () => {
    const r = await kald('POST', '/api/huti/opskrifter', { ids: ['opskr-hjort-01', 'opskr-intet-06', '<script>'] });
    assert.deepEqual(r.json.matches['opskr-hjort-01'].sort(), [11, 13]);
    assert.deepEqual(r.json.matches['opskr-intet-06'], []);
    assert.equal(Object.keys(r.json.matches).length, 2, 'ugyldigt id droppes');
    const l = await kald('POST', '/api/huti/linjer', { lines: ['500 g hakket vildt', '5 dl mælk', '1 terning kyllingebouillon'] });
    assert.deepEqual(l.json.matches, [[12], [], []]);
  });

  await t.test('tag ud: laesenoeglen afvises, skrivenoeglen taeller ned', async () => {
    let r = await kald('POST', '/api/huti/tag-ud', { stockId: 11 });
    assert.equal(r.status, 403);
    assert.equal(r.json.kode, 'read_only');
    assert.equal(falsk.taget.length, 0);
    r = await kald('POST', '/api/huti/forbind', { url: huti, key: SKRIVENOEGLE });
    assert.equal(r.json.canWrite, true);
    r = await kald('POST', '/api/huti/tag-ud', { stockId: 12 });
    assert.equal(r.status, 200, r.tekst);
    assert.deepEqual(falsk.taget, [{ id: 12, amount: undefined, how: 'used' }]);
    assert.equal(r.json.stock.quantity, 1);
    r = await kald('POST', '/api/huti/tag-ud', { stockId: 999 });
    assert.equal(r.json.kode, 'refused');
  });

  await t.test('Kokkeris egen MCP: huti_pantry (ogsaa med retter)', async () => {
    const tok = (await kald('POST', '/api/access/token', { label: 'proeve', scope: 'read' })).json.token;
    const rpc = async (name, args) => {
      const r = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      const j = await r.json();
      svar.push(JSON.stringify(j));
      return j.result;
    };
    const r = await rpc('huti_pantry', { suggest_recipes: true });
    assert.ok(!r.isError, JSON.stringify(r));
    assert.match(r.content[0].text, /4 madvarer i huti, 2 skal spises snart/);
    assert.match(r.content[0].text, /Hjortekølle · 1 stk · Fryser › Skuffe 2 · SPIS SNART/);
    assert.match(r.content[0].text, /Hjortegryde \[opskr-hjort-01\]/);
    assert.equal(r.structuredContent.recipes[0].eat_soon, 1);
    const kun = await rpc('huti_pantry', { eat_soon_only: true });
    assert.equal(kun.structuredContent.items.length, 2);
  });

  await t.test('fejlstierne: én fast kode, aldrig hutis krop', async () => {
    const proev = async (tilstand, kode, status) => {
      falsk.tilstand = tilstand;
      const t0 = Date.now();
      const r = await kald('POST', '/api/huti/test', {});
      assert.equal(r.status, status, `${tilstand}: ${r.tekst}`);
      assert.equal(r.json.kode, kode, tilstand);
      assert.ok(!r.tekst.includes(HEMMELIG_KROP), tilstand);
      return Date.now() - t0;
    };
    await proev('401', 'bad_key', 400);
    await proev('500', 'failed', 424);
    await proev('html', 'failed', 424);
    const tid = await proev('timeout', 'failed', 424);
    assert.ok(tid < 3000, 'timeout overholdt: ' + tid);
    falsk.andetRamt = false;
    await proev('redirect', 'failed', 424);
    assert.equal(falsk.andetRamt, false, 'viderestillingen foelges ikke');
    falsk.tilstand = 'sse';
    assert.equal((await kald('POST', '/api/huti/test', {})).status, 200, 'SSE-svar laeses');
    falsk.tilstand = 'ok';
    // En fejlet test bliver staaende i status - men forbindelsen er der stadig.
    assert.equal((await kald('GET', '/api/settings')).json.hutiSet, true);
  });

  await t.test('ondsindet huti: HTML og javascript: renses', async () => {
    falsk.tilstand = 'ondsindet';
    const r = await kald('POST', '/api/huti/beholdning', { frisk: true });
    falsk.tilstand = 'ok';
    assert.equal(r.status, 200);
    assert.equal(r.json.items.length, 2, 'varen uden gyldigt id droppes');
    const tekst = JSON.stringify(r.json.items);
    assert.ok(!/[<>]/.test(tekst), tekst);
    assert.equal(r.json.items[0].name, 'Laks');
    assert.equal(r.json.items[1].name.length, 120);
    assert.equal(r.json.items[1].quantity, null, '1e9 er ikke en maengde');
  });

  await t.test('afbryd rydder alt', async () => {
    const r = await kald('POST', '/api/huti/afbryd', {});
    assert.equal(r.json.settings.hutiSet, false);
    assert.equal(r.json.settings.hutiKeySet, false);
    assert.equal((await kald('POST', '/api/huti/forslag', {})).json.kode, 'not_set');
  });

  await t.test('noeglen staar aldrig i et svar eller i loggen', () => {
    for (const s of svar) {
      assert.ok(!s.includes(LAESENOEGLE) && !s.includes(SKRIVENOEGLE), 'noegle i svar: ' + s.slice(0, 200));
      assert.ok(!s.includes(HEMMELIG_KROP));
    }
    assert.ok(!k.log.tekst.includes(LAESENOEGLE) && !k.log.tekst.includes(SKRIVENOEGLE));
    assert.ok(!k.log.tekst.includes(HEMMELIG_KROP));
    assert.ok(!/\[fejl\].*huti/.test(k.log.tekst), 'huti nede er en advarsel, ikke [fejl]');
  });
});
