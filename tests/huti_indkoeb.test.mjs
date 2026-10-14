/* »🧊 Hent fra huti« paa indkoebslisten (v56).
 *
 * Den rigtige Kokkeri-server koerer mod en FALSK huti (tests/falsk_huti.mjs), som svarer paa
 * `shopping_list` som den rigtige huti. Frontendens egne funktioner (hele p5b_huti.js + p1b_food.js
 * for guessSection/parseShopText) koeres i en vm; api() og saveBulk() er rigtige kald mod serveren.
 * Proever:
 *  - hent: kun de aabne poster, renset, afdelingen oversat/gaettet, maerket »fra huti«
 *  - dubletter: samme post to gange giver ingen dublet - ogsaa naar teksten er rettet her (hutiId)
 *  - intet skrevet tilbage: Kokkeri kalder kun laesevaerktoejer, og hutis liste er uaendret
 *  - fejlstierne 401/timeout/500/HTML: én fast kode, Kokkeris liste uroert
 *  - ondsindet huti: HTML renses, loft paa antal og laengde, `addedBy` kommer aldrig med
 *  - en ikke-admin kan hente, naar forbindelsen findes (som de andre laesekald)
 *  - hutis nuvaerende form, en grupperet form og ren tekst laeses alle
 *  - Kokkeris egen MCP: huti_shopping_list
 *  - noeglen staar aldrig i et svar eller i loggen
 *
 *   node --test tests/huti_indkoeb.test.mjs      (port 9160, eller KK_PROEVE_PORT4)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { startFalskHuti, LAESENOEGLE, SKRIVENOEGLE, HEMMELIG_KROP, POSTER } from './falsk_huti.mjs';

const require = createRequire(import.meta.url);
const H = require('../app/huti.js');
const ROD = path.resolve(import.meta.dirname, '..');
const PORT = parseInt(process.env.KK_PROEVE_PORT4 || '9160', 10);
const laes = f => fs.readFileSync(path.join(ROD, f), 'utf8');

function udsnit(kilde, start) {
  const i0 = kilde.indexOf(start);
  if (i0 < 0) throw new Error('findes ikke: ' + start);
  let d = 0;
  for (let j = kilde.indexOf('{', i0); j < kilde.length; j++) {
    if (kilde[j] === '{') d++;
    else if (kilde[j] === '}' && --d === 0) return kilde.slice(i0, j + 1);
  }
  throw new Error('klammerne gaar ikke op: ' + start);
}
const CORE = laes('app/parts/p1_core.js');
const KODE = [
  udsnit(CORE, 'function normName('), udsnit(CORE, 'function num('),
  CORE.slice(CORE.indexOf('const UFRAC'), CORE.indexOf('\n', CORE.indexOf('const UFRAC'))),
  udsnit(CORE, 'function parseQty('),
  laes('app/parts/p1b_food.js'),
  laes('app/parts/p5b_huti.js'),
  'this.T = { hutiIndkoebPlan, hutiIndkoebItems, hutiIndkoebLaegPaa };'
].join('\n');

test('rensPost/indkoebAf: hutis svar er utrovaerdigt', () => {
  assert.equal(H.rensPost({ id: 1, text: 'x', checked: true }), null, 'afkrydset er ikke med');
  assert.equal(H.rensPost({ id: 1, text: '<b></b>' }), null, 'tom tekst kasseres');
  const p = H.rensPost({ id: 7, text: '<i>Mælk</i>', quantity: 2, unit: 'l', aisle: 'dairy', source: 'used_up', addedBy: 'Hemmelig' });
  assert.deepEqual(p, { hutiId: 7, text: 'Mælk', quantity: 2, unit: 'l', aisle: 'Mejeri & køl', source: 'used_up' });
  assert.equal(H.postTekst(p), '2 l Mælk');
  assert.equal(H.rensPost({ text: 'x', unit: 'pcs', quantity: 3 }).unit, 'stk');
  assert.equal(H.rensPost({ text: 'x', aisle: 'household' }).aisle, '', 'ingen pendant -> Kokkeri gaetter');
  assert.equal(H.indkoebAf({ isError: true, content: [{ type: 'text', text: 'Unknown tool' }] }), null);
  assert.equal(H.indkoebAf({ content: [{ type: 'text', text: 'noget helt andet' }] }), null);
  assert.deepEqual(H.indkoebAf({ content: [{ type: 'text', text: 'The shopping list is empty.' }], structuredContent: { items: [] } }), []);
});

async function startKokkeri(dir) {
  const log = { tekst: '' };
  const p = spawn(process.execPath, ['app/server.js'], { cwd: ROD,
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: dir, KOKKERI_HUTI_TIMEOUT_MS: '700' }), stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => { log.tekst += d; });
  p.stderr.on('data', d => { log.tekst += d; });
  await new Promise((ok, nej) => {
    const tid = setTimeout(() => nej(new Error('Kokkeri startede ikke:\n' + log.tekst)), 10000);
    p.stdout.on('data', () => { if (log.tekst.includes('lytter')) { clearTimeout(tid); ok(); } });
  });
  return { p, log };
}

test('Hent fra huti - ende til ende', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-hutiindk-'));
  const falsk = await startFalskHuti();
  const k = await startKokkeri(dir);
  t.after(async () => { k.p.kill(); await falsk.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  const svar = [];
  const klient = () => {
    let cookie = '';
    return async (sti, opts) => {
      const o = opts || {};
      const r = await fetch(`http://127.0.0.1:${PORT}${sti}`, { method: o.body !== undefined ? 'POST' : 'GET',
        headers: Object.assign({ cookie }, o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
      const tekst = await r.text();
      svar.push(tekst);
      const sc = r.headers.get('set-cookie');
      if (sc && !cookie) cookie = sc.split(';')[0];
      let j = null;
      try { j = JSON.parse(tekst); } catch (e) { /* tom */ }
      if (!r.ok) { const e = new Error((j && j.error) || 'HTTP ' + r.status); e.status = r.status; e.kode = j && j.kode; throw e; }
      return j;
    };
  };
  const admin = klient();
  const bruger = klient();
  await admin('/api/register', { body: { username: 'ejer', password: 'hemmeligt-kodeord' } });
  await bruger('/api/register', { body: { username: 'gaest', password: 'hemmeligt-kodeord' } });
  assert.equal((await bruger('/api/me')).me.isAdmin, false, 'den anden bruger er ikke admin');

  /* Kokkeris liste, som serveren har den */
  const liste = async () => ((await admin('/api/items?kind=shopItem')).items || []).filter(i => !i.deleted);

  /* En frisk vm med frontendens egne funktioner; K() laeser serverens liste ved opstart. */
  async function fladen(api) {
    const items = await liste();
    const ctx = {
      S: { settings: await api('/api/settings') }, api, console,
      K: kind => (kind === 'shopItem' ? items : []),
      saveBulk: async nye => { await api('/api/items/bulk', { body: { items: nye } }); items.push(...nye); },
      uid: () => 'kk-' + Math.random().toString(36).slice(2, 12),
      esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'),
      toast: () => {}, render: () => {}, lsGet: (k, d) => d, lsSet: () => {}
    };
    vm.createContext(ctx);
    vm.runInContext(KODE, ctx);
    return ctx.T;
  }

  await t.test('ikke forbundet: not_set, og intet kald til huti', async () => {
    await assert.rejects(admin('/api/huti/indkoeb', { body: {} }), e => e.kode === 'not_set' && e.status === 409);
    assert.equal(falsk.kald.length, 0);
  });

  await admin('/api/huti/forbind', { body: { url: falsk.base, key: LAESENOEGLE } });

  await t.test('hent: kun de aabne poster, renset, uden hvem der tilfoejede', async () => {
    const d = await admin('/api/huti/indkoeb', { body: {} });
    assert.equal(d.total, 3, 'Bananer er krydset af i huti');
    assert.deepEqual(d.items.map(x => x.line), ['2 l Letmælk', 'Rugbrød', '4 stk AA-batterier']);
    assert.deepEqual(d.items.map(x => x.hutiId), [31, 32, 33]);
    assert.equal(d.items[0].aisle, 'Mejeri & køl');
    assert.ok(!JSON.stringify(d).includes('Hemmelig Person'), 'addedBy sendes ikke videre');
  });

  await t.test('en ikke-admin kan hente, naar forbindelsen findes', async () => {
    const d = await bruger('/api/huti/indkoeb', { body: {} });
    assert.equal(d.total, 3);
  });

  await t.test('fladen: alle afkrydset, laegges paa med »fra huti« - og anden gang ingen dubletter', async () => {
    /* En aaben vare med samme navn staar i forvejen */
    await admin('/api/items/bulk', { body: { items: [{ id: 'kk-rugbroed-1', kind: 'shopItem', text: 'rugbrød', group: '', done: false }] } });
    let T = await fladen(admin);
    const d = await admin('/api/huti/indkoeb', { body: {} });
    const plan = T.hutiIndkoebPlan(d.items, await liste());
    assert.deepEqual(plan.map(x => [x.p.hutiId, x.status, x.valgt]), [[31, 'ny', true], [32, 'samme_tekst', false], [33, 'ny', true]]);
    const n = await T.hutiIndkoebLaegPaa(plan.filter(x => x.valgt).map(x => x.p));
    assert.equal(n, 2);
    const efter = await liste();
    const fraHuti = efter.filter(i => i.kilde === 'huti');
    assert.equal(fraHuti.length, 2);
    for (const i of fraHuti) assert.equal(i.group, 'fra huti');
    const maelk = fraHuti.find(i => i.hutiId === 31);
    assert.equal(maelk.text, '2 l Letmælk');
    assert.equal(maelk.section, 'Mejeri & køl', 'Kokkeris eget gaet');
    assert.equal(fraHuti.find(i => i.hutiId === 33).section, '', 'husholdning: hverken Kokkeri eller huti har en afdeling');

    /* Anden gang: alt staar der - ogsaa naar teksten er rettet i Kokkeri */
    maelk.text = '1 l skummetmælk';
    await admin('/api/items/bulk', { body: { items: [maelk] } });
    T = await fladen(admin);
    const d2 = await admin('/api/huti/indkoeb', { body: {} });
    const plan2 = T.hutiIndkoebPlan(d2.items, await liste());
    assert.deepEqual(plan2.map(x => [x.p.hutiId, x.status, x.valgt]), [[31, 'paa_listen', false], [32, 'samme_tekst', false], [33, 'paa_listen', false]]);
    /* Selv hvis fladen sendte dem alle (to klik, to faner): ingen dubletter af hutiId */
    const n2 = await T.hutiIndkoebLaegPaa(d2.items.filter(x => x.hutiId !== 32));
    assert.equal(n2, 0);
    assert.equal((await liste()).filter(i => i.kilde === 'huti').length, 2);

    /* Krydset af i Kokkeri -> »hentet foer«, ikke afkrydset som standard */
    maelk.done = true;
    await admin('/api/items/bulk', { body: { items: [maelk] } });
    const plan3 = T.hutiIndkoebPlan(d2.items, await liste());
    assert.deepEqual(plan3[0].status, 'hentet_foer');
    assert.equal(plan3[0].valgt, false);
  });

  await t.test('intet skrevet tilbage: kun laesevaerktoejer, hutis liste uaendret', () => {
    const navne = falsk.kald.flatMap(c => (Array.isArray(c.krop) ? c.krop : [c.krop])).map(b => b.method === 'tools/call' ? b.params.name : b.method);
    for (const n of navne) assert.ok(['shopping_list', 'pantry_for_planning', 'tools/list'].includes(n), 'Kokkeri kaldte ' + n);
    assert.deepEqual(falsk.poster, POSTER());
  });

  await t.test('hutis formater: grupperet og ren tekst laeses ens', async () => {
    const ens = (await admin('/api/huti/indkoeb', { body: {} })).items;
    for (const form of ['grupperet', 'tekst']) {
      falsk.indkoebForm = form;
      const d = await admin('/api/huti/indkoeb', { body: {} });
      assert.deepEqual(d.items.map(x => [x.hutiId, x.line, x.aisle]), ens.map(x => [x.hutiId, x.line, x.aisle]), form);
    }
    falsk.indkoebForm = 'items';
  });

  await t.test('fejlstierne: én fast kode, aldrig hutis krop, Kokkeris liste uroert', async () => {
    const foer = JSON.stringify((await liste()).map(i => [i.id, i.text, i.done]).sort());
    for (const [tilstand, kode, status] of [['401', 'bad_key', 400], ['500', 'failed', 424], ['html', 'failed', 424], ['timeout', 'failed', 424], ['redirect', 'failed', 424]]) {
      falsk.tilstand = tilstand;
      const t0 = Date.now();
      await assert.rejects(admin('/api/huti/indkoeb', { body: {} }), e => e.kode === kode && e.status === status, tilstand);
      assert.ok(Date.now() - t0 < 3000, tilstand + ' tog for lang tid');
    }
    falsk.tilstand = 'ok';
    assert.equal(JSON.stringify((await liste()).map(i => [i.id, i.text, i.done]).sort()), foer);
    for (const s of svar) assert.ok(!s.includes(HEMMELIG_KROP));
  });

  await t.test('ondsindet huti: renset, loft paa antal og laengde', async () => {
    falsk.tilstand = 'ondsindet';
    const d = await admin('/api/huti/indkoeb', { body: {} });
    falsk.tilstand = 'ok';
    assert.equal(d.items.length, 200, 'loft paa 200 poster');
    const tekst = JSON.stringify(d.items);
    assert.ok(!/[<>]/.test(tekst), tekst.slice(0, 300));
    assert.equal(d.items[0].text, 'Kaffe');
    assert.equal(d.items[0].quantity, null);
    assert.equal(d.items[0].unit, '');
    assert.equal(d.items[0].aisle, '');
    assert.equal(d.items[0].source, '');
    assert.equal(d.items[1].text.length, 120);
    assert.equal(d.items[1].quantity, null, '1e9 er ikke en maengde');
    assert.ok(!/[\u0000-\u001f\u2028]/.test(d.items[1].text));
  });

  await t.test('Kokkeris egen MCP: huti_shopping_list', async () => {
    const tok = (await admin('/api/access/token', { body: { label: 'proeve', scope: 'read' } })).token;
    const rpc = async (method, params) => {
      const r = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      svar.push(JSON.stringify(j));
      return j.result;
    };
    const l = await rpc('tools/list', {});
    assert.ok(l.tools.some(v => v.name === 'huti_shopping_list'), 'vaerktoejet er med for en laesenoegle');
    const r = await rpc('tools/call', { name: 'huti_shopping_list', arguments: {} });
    assert.ok(!r.isError, JSON.stringify(r));
    assert.match(r.content[0].text, /3 poster på hutis indkøbsliste/);
    assert.match(r.content[0].text, /- 2 l Letmælk · Mejeri & køl/);
    assert.equal(r.structuredContent.items[0].huti_id, 31);
    falsk.tilstand = '401';
    const f = await rpc('tools/call', { name: 'huti_shopping_list', arguments: {} });
    falsk.tilstand = 'ok';
    assert.equal(f.isError, true);
    assert.match(f.content[0].text, /afviste nøglen/);
  });

  await t.test('noeglen staar aldrig i et svar eller i loggen', () => {
    for (const s of svar) {
      assert.ok(!s.includes(LAESENOEGLE) && !s.includes(SKRIVENOEGLE), 'noegle i svar: ' + s.slice(0, 200));
      assert.ok(!s.includes(HEMMELIG_KROP));
      assert.ok(!s.includes('Hemmelig Person'));
    }
    assert.ok(!k.log.tekst.includes(LAESENOEGLE));
    assert.ok(!k.log.tekst.includes(HEMMELIG_KROP));
    assert.ok(!/\[fejl\].*huti/.test(k.log.tekst), 'huti nede er en advarsel, ikke [fejl]');
  });
});
