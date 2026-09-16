/* saveBulk() maa ALDRIG gemme en opskrift, der stadig er `partial`.
 *
 * Funktionerne hentes UD AF KILDEN (app/parts/p1_core.js) og koeres mod en
 * api-attrap. En afskrift ville kun bevise, at afskriften virker.
 *
 * Faelden: hydrateItems() og ensureFull() sluger begge deres fejl, og
 * categorizeImported() kalder saveBulk() ved hver opstart, mens opskrifterne
 * ER delvise. Ét netvaerkshik - og fremgangsmaade og ingredienser er vaek.
 *
 *   node tests/savebulk.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROD = path.resolve(import.meta.dirname, '..');
const KILDE = fs.readFileSync(path.join(ROD, 'app/parts/p1_core.js'), 'utf8');
let ok = 0, fejl = 0;
const proev = async (navn, fn) => {
  try { await fn(); console.log('  ok   ' + navn); ok++; }
  catch (e) { console.log('  FEJL ' + navn + '\n       ' + e.message); fejl++; }
};
const skal = (v, f, hvad) => { if (v !== f) throw new Error(`${hvad}: fik ${JSON.stringify(v)}, ventede ${JSON.stringify(f)}`); };

/* Skaerer `[async ]function navn(...) { ... }` ud ved at taelle klammer.
 * Strenge og kommentarer i de tre funktioner indeholder ingen klammer. */
function udtraek(navn) {
  const m = new RegExp(`(?:async )?function ${navn}\\(`).exec(KILDE);
  if (!m) throw new Error(navn + ' findes ikke i p1_core.js');
  let i = KILDE.indexOf('{', m.index), d = 0;
  for (let j = i; j < KILDE.length; j++) {
    if (KILDE[j] === '{') d++;
    else if (KILDE[j] === '}' && --d === 0) return KILDE.slice(m.index, j + 1);
  }
  throw new Error(navn + ': klammerne gaar ikke op');
}
const KODE = ['ensureFull', 'hydrateItems', 'saveBulk'].map(udtraek).join('\n');

/* En verden med api-attrap. `svar(sti, opts)` afgoer hvert kald. */
function verden(items, svar) {
  const kald = [], toasts = [];
  const ctx = {
    S: { items, hydrated: false, view: 'dash' },
    kald, toasts,
    api: async (sti, opts) => { kald.push(sti); return svar(sti, opts); },
    toast: (t, err) => toasts.push({ t, err: !!err }),
    reindex: () => {}, render: () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(KODE + '\nthis.saveBulk = saveBulk;', ctx);
  return ctx;
}
const delvis = () => ({ id: 'rec-000001', kind: 'recipe', title: 'Boller', partial: true, category: 'Brød' });
const netfejl = () => { throw new Error('Failed to fetch'); };

console.log('saveBulk og partial-vagten');

await proev('hentningen fejler helt -> bulk-kaldet sker ALDRIG, og der returneres 0', async () => {
  const r = delvis();
  const w = verden([r], (sti) => sti === '/api/items/bulk' ? { imported: 1 } : netfejl());
  const n = await w.saveBulk([r]);
  skal(w.kald.includes('/api/items/bulk'), false, 'bulk-kaldet');
  skal(n, 0, 'returvaerdi');
  skal(w.toasts.some(t => t.err), true, 'fejl-toast');
});

await proev('listen lykkes, men mangler opskriften, og enkelt-hentningen fejler -> intet gemmes', async () => {
  const r = delvis();
  const w = verden([r], (sti) => {
    if (sti === '/api/items') return { items: [] };           // hydrate "lykkes" uden at fylde r
    if (sti === '/api/items/bulk') return { imported: 1 };
    return netfejl();                                          // ensureFull fejler
  });
  const n = await w.saveBulk([r]);
  skal(w.kald.includes('/api/items/bulk'), false, 'bulk-kaldet');
  skal(n, 0, 'returvaerdi');
});

await proev('én af flere fejler -> HELE gemningen afbrydes, ogsaa de fulde', async () => {
  const fuld = { id: 'shop-000001', kind: 'shopItem', name: 'mel' };
  const r = delvis();
  const w = verden([r, fuld], (sti) => sti === '/api/items/bulk' ? { imported: 2 } : netfejl());
  await w.saveBulk([fuld, r]);
  skal(w.kald.includes('/api/items/bulk'), false, 'bulk-kaldet');
});

await proev('hentningen lykkes -> fremgangsmaaden er med i bulk-kaldet (og lokale felter vinder)', async () => {
  const r = delvis();
  let sendt = null;
  const w = verden([r], (sti, opts) => {
    if (sti === '/api/items') return { items: [{ id: r.id, kind: 'recipe', title: 'Gammel', category: '', instructions: ['Aelt dejen'] }] };
    if (sti === '/api/items/bulk') { sendt = opts.body.items; return { imported: 1 }; }
    return netfejl();
  });
  const n = await w.saveBulk([r]);
  skal(n, 1, 'returvaerdi');
  skal(sendt[0].partial, undefined, 'partial-flaget');
  skal(JSON.stringify(sendt[0].instructions), '["Aelt dejen"]', 'fremgangsmaade');
  skal(sendt[0].category, 'Brød', 'lokal kategori');
});

await proev('ingen delvise -> gemmer direkte uden at hente noget', async () => {
  const fuld = { id: 'shop-000002', kind: 'shopItem', name: 'salt' };
  const w = verden([], (sti) => sti === '/api/items/bulk' ? { imported: 1 } : netfejl());
  skal(await w.saveBulk([fuld]), 1, 'returvaerdi');
  skal(w.kald.join(), '/api/items/bulk', 'kald');
});

console.log(`\n${ok} ok, ${fejl} fejl`);
process.exit(fejl ? 1 : 0);
