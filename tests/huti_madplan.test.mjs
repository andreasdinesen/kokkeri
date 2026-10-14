/* »✨ Foreslå madplan (AI)« med hutis beholdning (v55).
 *
 * Den rigtige Kokkeri-server koerer med en FALSK huti (tests/falsk_huti.mjs) og en
 * FALSK AI-udbyder (OpenAI-kompatibel /chat/completions - samme vej som »egen
 * AI-server«). Frontendens egne funktioner (aiSuggestWeek fra p5_mealplan.js og
 * hele p5b_huti.js) koeres i en vm med smaa attrapper for DOM'en; api() er et
 * rigtigt fetch mod serveren. Proever:
 *  - prompten faar beholdningen og reglen om »spis snart«, og opskrifterne, der
 *    bruger noget fra huti, faar feltet `huti`
 *  - de lagte dage faar maerket »fra huti: …« (samme som »Brug det, vi har«)
 *  - huti nede eller ikke forbundet: madplanen laves som foer, og huti spoerges
 *    hoejst én gang (ingen loekke)
 *
 *   node --test tests/huti_madplan.test.mjs      (port 9158, eller KK_PROEVE_PORT2)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { startFalskHuti, LAESENOEGLE } from './falsk_huti.mjs';

const ROD = path.resolve(import.meta.dirname, '..');
const PORT = parseInt(process.env.KK_PROEVE_PORT2 || '9158', 10);
const laes = f => fs.readFileSync(path.join(ROD, f), 'utf8');

/* `start` ... til den klamme, der lukker den foerste `{` efter start */
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
const PLAN = laes('app/parts/p5_mealplan.js');
const KODE = [
  udsnit(CORE, 'function recipeTotalMin('), CORE.slice(CORE.indexOf('function parseAiJson('), CORE.indexOf('/* kort uddrag af svaret')),   // kommentaren har en uparret { udsnit(CORE, 'function aiSvarUddrag('),
  udsnit(CORE, 'function isoDate('), udsnit(CORE, 'function addDays('), udsnit(CORE, 'function mondayOf('),
  udsnit(PLAN, 'function weekDatesOf('), 'const slotOf = e => e.slot || \'dinner\';',
  'const fillMinStars = () => 0;', 'const opfylderStjerner = (r, min) => !min || (r.rating || 0) >= min;',
  udsnit(PLAN, 'async function aiSuggestWeek('),
  laes('app/parts/p5b_huti.js'),
  'this.T = { aiSuggestWeek, hutiOpdaterPlan, hutiPlanMaerke };'
].join('\n');

const OPSKRIFTER = [
  { id: 'opskr-hjort-01', kind: 'recipe', title: 'Hjortegryde', category: 'Hovedret', rating: 3, ingredients: ['1 hjortekølle', '2 dl piskefløde'] },
  { id: 'opskr-lasag-02', kind: 'recipe', title: 'Vildtlasagne', category: 'Hovedret', rating: 5, ingredients: ['500 g hakket vildt', 'lasagneplader'] },
  { id: 'opskr-kylin-03', kind: 'recipe', title: 'Kyllingegryde', category: 'Hovedret', rating: 4, ingredients: ['2 kyllingebryst', 'ris'] },
  { id: 'opskr-boenn-04', kind: 'recipe', title: 'Bønnegryde', category: 'Hovedret', rating: 5, ingredients: ['2 dåser bønner'] },
  { id: 'opskr-pasta-05', kind: 'recipe', title: 'Pasta pesto', category: 'Hovedret', rating: 2, ingredients: ['400 g pasta', 'pesto'] }
];

/* Den falske AI: vaelger opskrifter med »(spis snart)« i huti-feltet foerst, saa resten. */
async function startFalskAi() {
  const ai = { kald: [] };
  const server = http.createServer((req, res) => {
    const dele = [];
    req.on('data', d => dele.push(d));
    req.on('end', () => {
      const krop = JSON.parse(Buffer.concat(dele).toString('utf8') || '{}');
      ai.kald.push(krop);
      const bruger = krop.messages.find(m => m.role === 'user').content;
      const datoer = /Datoer der skal fyldes: ([0-9, -]+)/.exec(bruger)[1].split(', ');
      const liste = JSON.parse(bruger.slice(bruger.indexOf('Opskrifter:\n') + 12));
      const snart = x => (x.huti || []).some(o => /spis snart/.test(o)) ? 0 : x.huti ? 1 : 2;
      liste.sort((a, b) => snart(a) - snart(b));
      const plan = datoer.map((d, i) => ({ date: d, recipeId: liste[i % liste.length].id }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'falsk', choices: [{ message: { content: JSON.stringify(plan) }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  ai.base = `http://127.0.0.1:${server.address().port}`;
  ai.stop = () => new Promise(ok => { server.closeAllConnections(); server.close(ok); });
  return ai;
}

test('Foreslå madplan (AI) med huti', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-hutiplan-'));
  const falsk = await startFalskHuti();
  const ai = await startFalskAi();
  const log = { tekst: '' };
  const p = spawn(process.execPath, ['app/server.js'], { cwd: ROD,
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: dir, KOKKERI_HUTI_TIMEOUT_MS: '700' }), stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => { log.tekst += d; });
  p.stderr.on('data', d => { log.tekst += d; });
  await new Promise((ok, nej) => {
    const tid = setTimeout(() => nej(new Error('Kokkeri startede ikke:\n' + log.tekst)), 10000);
    p.stdout.on('data', () => { if (log.tekst.includes('lytter')) { clearTimeout(tid); ok(); } });
  });
  t.after(async () => { p.kill(); await falsk.stop(); await ai.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  let cookie = '';
  const api = async (sti, opts) => {
    const o = opts || {};
    const r = await fetch(`http://127.0.0.1:${PORT}${sti}`, { method: o.body !== undefined ? 'POST' : (o.method || 'GET'),
      headers: Object.assign({ cookie }, o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc && !cookie) cookie = sc.split(';')[0];
    let j = null;
    try { j = await r.json(); } catch (e) { /* tom */ }
    if (!r.ok) throw new Error((j && j.error) || 'HTTP ' + r.status);
    return j;
  };
  await api('/api/register', { body: { username: 'proeve', password: 'hemmeligt-kodeord' } });
  await api('/api/items/bulk', { body: { items: OPSKRIFTER } });
  await api('/api/settings', { body: { settings: { ai_provider: 'openai', ai_url: ai.base, ai_model: 'falsk' } } });

  /* En frisk vm pr. koersel: S, K og DOM-attrapperne. */
  async function koer() {
    const plan = [];
    const toasts = [];
    const S = { settings: await api('/api/settings'), weekStart: '2026-10-12', view: 'plan' };
    const ctx = {
      S, api, console, toasts,
      K: kind => (kind === 'recipe' ? OPSKRIFTER : kind === 'planEntry' ? plan : []),
      recipeById: id => OPSKRIFTER.find(r => r.id === id) || null,
      fillCats: () => ['Hovedret'],
      saveBulk: async items => { plan.push(...items); },
      toast: (m, fejl) => toasts.push((fejl ? 'FEJL ' : '') + m),
      render: () => {}, uid: () => 'e-' + Math.random().toString(36).slice(2, 10),
      esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'),
      lsGet: (k, d) => d, lsSet: () => {}
    };
    vm.createContext(ctx);
    vm.runInContext(KODE, ctx);
    await ctx.T.aiSuggestWeek();
    return { plan, toasts, T: ctx.T };
  }

  await t.test('huti forbundet: prompten faar beholdningen og reglen, dagene faar maerket', async () => {
    await api('/api/huti/forbind', { body: { url: falsk.base, key: LAESENOEGLE } });
    const foer = falsk.kald.length;
    const { plan, toasts, T } = await koer();
    const sidste = ai.kald[ai.kald.length - 1];
    const sys = sidste.messages.find(m => m.role === 'system').content;
    const bruger = sidste.messages.find(m => m.role === 'user').content;
    assert.match(sys, /Prioritér FØRST opskrifter, der bruger varer markeret "\(spis snart\)"/);
    assert.match(bruger, /I huti \(4 madvarer, 2 skal spises snart\):/);
    assert.match(bruger, /- Hjortekølle, 1 stk – SPIS SNART/);
    const liste = JSON.parse(bruger.slice(bruger.indexOf('Opskrifter:\n') + 12));
    assert.deepEqual(liste.find(x => x.id === 'opskr-hjort-01').huti, ['hjortekølle (spis snart)', 'piskefløde']);
    assert.deepEqual(liste.find(x => x.id === 'opskr-kylin-03').huti, ['kyllingebryst']);
    assert.equal(liste.find(x => x.id === 'opskr-boenn-04').huti, undefined);
    assert.equal(plan.length, 7);
    assert.ok(['opskr-hjort-01', 'opskr-lasag-02'].includes(plan[0].recipeId), 'spis snart foerst');
    assert.match(toasts[toasts.length - 1], /bruger noget fra huti/);
    // Maerket paa dagene - samme funktion som »Brug det, vi har« og madplanen bruger.
    await T.hutiOpdaterPlan(plan);
    const maerke = T.hutiPlanMaerke(plan[0]);
    assert.match(maerke, /fra huti: /);
    assert.match(maerke, plan[0].recipeId === 'opskr-hjort-01' ? /Hjortekølle/ : /Hakket vildt 500 g/);
    assert.match(maerke, /spis/);
    assert.equal(T.hutiPlanMaerke(plan.find(e => e.recipeId === 'opskr-boenn-04') || { recipeId: 'opskr-boenn-04' }), '');
    assert.equal(falsk.kald.length - foer, 1, 'ét kald til huti for forslaget (maerkerne kom fra cachen)');
  });

  await t.test('huti nede: madplanen laves som foer, ét forsoeg, ingen loekke', async () => {
    for (const tilstand of ['500', 'timeout', '401']) {
      falsk.tilstand = tilstand;
      const foer = falsk.kald.length;
      const aiFoer = ai.kald.length;
      const { plan, toasts } = await koer();
      assert.equal(plan.length, 7, tilstand + ': ' + toasts.join(' | '));
      assert.equal(falsk.kald.length - foer, 1, tilstand + ': præcis ét kald til huti');
      assert.equal(ai.kald.length - aiFoer, 1);
      assert.ok(!/I huti/.test(ai.kald[ai.kald.length - 1].messages.map(m => m.content).join('\n')), tilstand);
    }
    falsk.tilstand = 'ok';
  });

  await t.test('huti ikke forbundet: ingen huti i prompten, intet kald', async () => {
    await api('/api/huti/afbryd', { body: {} });
    const foer = falsk.kald.length;
    const { plan } = await koer();
    const sidste = ai.kald[ai.kald.length - 1];
    assert.ok(!/huti/i.test(sidste.messages.map(m => m.content).join('\n')));
    assert.equal(plan.length, 7);
    assert.equal(falsk.kald.length, foer);
  });
});
