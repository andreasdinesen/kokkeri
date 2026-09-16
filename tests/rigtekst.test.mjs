/* Kopiér opskriften som rig tekst (RUNE-ERFARINGER 9e).
 *
 * p1_core.js koeres, og opskriftSomRigTekst() / kopierOpskrift() /
 * kopierViaHaendelse() hentes UD AF KILDEN (app/parts/p4_recipes.js).
 *
 * Billedet er i brugerens stoerrelse (~200 KB data:-adresse) - ikke et
 * legetoejsbillede. Proeven kan ikke se, hvad der bliver SAT IND i Mail eller
 * Apple Notes; den ser, hvad der bliver lagt paa udklipsholderen.
 *
 *   node tests/rigtekst.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROD = path.resolve(import.meta.dirname, '..');
const laes = f => fs.readFileSync(path.join(ROD, f), 'utf8');
const CORE = laes('app/parts/p1_core.js');
const OPSKRIFTER = laes('app/parts/p4_recipes.js');
let ok = 0, fejl = 0;
const proev = async (navn, fn) => {
  try { await fn(); console.log('  ok   ' + navn); ok++; }
  catch (e) { console.log('  FEJL ' + navn + '\n       ' + e.message); fejl++; }
};
const skal = (v, f, hvad) => { if (v !== f) throw new Error(`${hvad}: fik ${JSON.stringify(v)}, ventede ${JSON.stringify(f)}`); };
const vent = () => new Promise(r => setTimeout(r, 0));

function udsnit(start) {
  const i0 = OPSKRIFTER.indexOf(start);
  if (i0 < 0) throw new Error('findes ikke: ' + start);
  let d = 0;
  for (let j = OPSKRIFTER.indexOf('{', i0); j < OPSKRIFTER.length; j++) {
    if (OPSKRIFTER[j] === '{') d++;
    else if (OPSKRIFTER[j] === '}' && --d === 0) return OPSKRIFTER.slice(i0, j + 1);
  }
  throw new Error('klammerne gaar ikke op: ' + start);
}

/* ~200 KB base64 - som et rigtigt opskriftsfoto efter skalering */
const STORT = 'data:image/jpeg;base64,' + Buffer.alloc(150000, 7).toString('base64');

function verden({ clipboard = true, skrivAfvises = false, billede = STORT } = {}) {
  const log = [];
  const toasts = [];
  const lyttere = {};
  const ctx = {
    console, Promise, Blob, setTimeout, clearTimeout, Math, JSON, String, Number, Array, Set, Date, RegExp,
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      addEventListener: (t, f) => { lyttere[t] = f; log.push('lyt:' + t); },
      removeEventListener: (t) => { delete lyttere[t]; },
      createElement: () => ({ setAttribute() {}, style: {}, select() {}, remove() {} }),
      body: { appendChild() {} },
      execCommand: (k) => {
        log.push('execCommand:' + k);
        const data = {};
        if (lyttere.copy) lyttere.copy({ preventDefault() {}, clipboardData: { setData: (t, v) => { data[t] = v; } } });
        log.push({ kopieret: data });
        return true;
      },
      querySelector: () => null
    },
    fetch: async (url) => { log.push('fetch:' + url); return { ok: true, blob: async () => ({ billede }) }; },
    FileReader: class { readAsDataURL(b) { this.result = b.billede; setTimeout(() => this.onload(), 0); } },
    navigator: clipboard ? { clipboard: { write: async (items) => {
      log.push('write');
      if (skrivAfvises) throw new Error('NotAllowedError');
      const it = items[0];
      const ud = {};
      for (const [t, p] of Object.entries(it.data)) ud[t] = await (await p).text();
      log.push({ skrevet: ud });
    } } } : {}
  };
  if (clipboard) {
    ctx.ClipboardItem = class { constructor(data) { log.push('ClipboardItem'); this.data = data; } };
  }
  vm.createContext(ctx);
  vm.runInContext(CORE + '\n' +
    udsnit('function opskriftSomRigTekst(') + '\n' +
    udsnit('async function opskriftBilledeTilKopi(') + '\n' +
    udsnit('function kopierOpskrift(') + '\n' +
    udsnit('function kopierViaHaendelse(') + '\n' +
    'toast = (m, e) => this.toasts.push([m, !!e]);' +
    'this.api = { opskriftSomRigTekst, kopierOpskrift, S };', Object.assign(ctx, { toasts }));
  return { ctx, api: ctx.api, log, toasts };
}

const OPSKRIFT = {
  id: 'rec-000001', kind: 'recipe', title: 'Lasagne <al forno>', category: 'Hovedret', servings: 4,
  prepMin: 20, cookMin: 40, description: 'Familiens & vennernes favorit.', imageVer: '17',
  url: 'https://opskrifter.eksempel.invalid/lasagne?a=1&b=2',
  ingredients: ['## Kødsovs', '500 g hakket oksekød', '1 dåse tomater', '## Bechamel', '50 g smør'],
  instructions: ['Brun kødet i 10 minutter.', '## Samling', 'Læg lagene.', 'Bag i 40 min.'],
  notes: 'HEMMELIG NOTE - kun til mig'
};

console.log('Kopiér som rig tekst: indholdet');

await proev('HTML: titel, billede, ingredienser som liste, trin nummereret, kilde', () => {
  const { api } = verden();
  const { html } = api.opskriftSomRigTekst(OPSKRIFT, 1, STORT);
  for (const del of ['<h1>Lasagne &lt;al forno&gt;</h1>', '<h3>Kødsovs</h3>', '<li>500 g hakket oksekød</li>',
    '<h3>Samling</h3>', '<ol><li>Brun kødet i 10 minutter.</li></ol>', '<ol><li>Læg lagene.</li><li>Bag i 40 min.</li></ol>',
    'Familiens &amp; vennernes favorit.',
    '<a href="https://opskrifter.eksempel.invalid/lasagne?a=1&amp;b=2">']) {
    if (!html.includes(del)) throw new Error('mangler: ' + del);
  }
  if (!html.includes(`<img src="${STORT}"`)) throw new Error('billedet er ikke med i fuld laengde');
  if (html.includes('HEMMELIG')) throw new Error('de private noter kom med');
  if (/<(ul|ol)><\/(ul|ol)>/.test(html)) throw new Error('tom liste');
});

await proev('ren tekst: laesbar - ingen base64, ingen HTML', () => {
  const { api } = verden();
  const { tekst } = api.opskriftSomRigTekst(OPSKRIFT, 1, STORT);
  if (tekst.length > 2000) throw new Error('teksten er ' + tekst.length + ' tegn - billedet er kommet med?');
  if (/data:|base64|<\/?(h\d|ul|ol|li|p|img|a|meta)\b/i.test(tekst)) throw new Error('teksten indeholder billeddata eller HTML');
  for (const del of ['Lasagne <al forno>\n', 'INGREDIENSER\nKødsovs:\n- 500 g hakket oksekød',
    'FREMGANGSMÅDE\n1. Brun kødet i 10 minutter.\nSamling:\n1. Læg lagene.\n2. Bag i 40 min.',
    'Kilde: https://opskrifter.eksempel.invalid/lasagne?a=1&b=2']) {
    if (!tekst.includes(del)) throw new Error('mangler: ' + JSON.stringify(del));
  }
  if (tekst.includes('HEMMELIG')) throw new Error('de private noter kom med');
});

await proev('skaleringen foelger siden (8 portioner = dobbelt)', () => {
  const { api } = verden();
  const { html, tekst } = api.opskriftSomRigTekst(OPSKRIFT, 2, '');
  if (!html.includes('<li>1.000 g hakket oksekød</li>')) {
    throw new Error('ikke skaleret: ' + html.match(/<li>[^<]*oksekød<\/li>/));
  }
  if (!tekst.includes('8 portioner')) throw new Error('portionerne er ikke skaleret');
});

await proev('adresser bag login og farlige adresser kommer ALDRIG med', () => {
  const { api } = verden();
  for (const bil of ['/api/image/rec-000001?v=17', 'http://billeder.eksempel.invalid/x.jpg', 'javascript:alert(1)']) {
    if (api.opskriftSomRigTekst(OPSKRIFT, 1, bil).html.includes('<img')) throw new Error('img med ' + bil);
  }
  const ond = api.opskriftSomRigTekst(Object.assign({}, OPSKRIFT, { url: 'javascript:alert(1)' }), 1, '');
  if (/javascript:/.test(ond.html + ond.tekst)) throw new Error('javascript:-kilden kom med');
});

console.log('Kopiér som rig tekst: udklipsholderen');

await proev('ClipboardItem oprettes INDE i klikket - foer billedet er hentet (Safari)', async () => {
  const { api, log, toasts } = verden();
  api.kopierOpskrift(OPSKRIFT, 1);
  // synkront, i samme tik som klikket:
  skal(log.filter(x => typeof x === 'string' && !x.startsWith('lyt:')).slice(0, 3).join(), 'fetch:/api/image/rec-000001?v=17,ClipboardItem,write', 'raekkefoelgen');
  for (let i = 0; i < 10; i++) await vent();
  const skrevet = log.find(x => x.skrevet).skrevet;
  if (!skrevet['text/html'].includes(`<img src="${STORT}"`)) throw new Error('billedet er ikke lagt ind som data:');
  if (/data:/.test(skrevet['text/plain'])) throw new Error('billeddata i text/plain');
  if (!/Apple Notes/.test(toasts[0][0])) throw new Error('toasten naevner ikke Apple Notes-graensen: ' + toasts[0][0]);
});

await proev('over ren http (ingen navigator.clipboard): copy-haendelsen baerer begge typer', async () => {
  const { api, log, toasts } = verden({ clipboard: false });
  await api.kopierOpskrift(OPSKRIFT, 1);
  const kop = log.find(x => x.kopieret);
  if (!kop) throw new Error('execCommand blev ikke kaldt: ' + JSON.stringify(log));
  if (!kop.kopieret['text/html'].includes('<h1>') || !kop.kopieret['text/plain'].startsWith('Lasagne')) {
    throw new Error('forkert indhold: ' + Object.keys(kop.kopieret));
  }
  skal(toasts[0][1], false, 'ingen fejl-toast');
});

await proev('naegtet tilladelse: falder tilbage til copy-haendelsen', async () => {
  const { api, log, toasts } = verden({ skrivAfvises: true });
  await api.kopierOpskrift(OPSKRIFT, 1);
  if (!log.includes('execCommand:copy')) throw new Error('ingen reserve: ' + JSON.stringify(log));
  skal(toasts.length && toasts[0][1], false, 'ingen fejl-toast');
});

await proev('uden billede: ingen <img>, og toasten naevner ikke Apple Notes', async () => {
  const { api, log, toasts } = verden();
  await api.kopierOpskrift(Object.assign({}, OPSKRIFT, { imageVer: '' }), 1);
  if (log.some(x => typeof x === 'string' && x.startsWith('fetch:'))) throw new Error('hentede et billede, der ikke findes');
  if (log.find(x => x.skrevet).skrevet['text/html'].includes('<img')) throw new Error('img uden billede');
  skal(toasts[0][0], 'Opskriften er kopieret', 'toasten');
});

await proev('knappen findes paa opskriften og er bundet', () => {
  if (!/id="copyRichBtn"/.test(udsnit('RENDER.recipeDetail = () =>'))) throw new Error('knappen mangler');
  if (!/\$\('#copyRichBtn'\)\.onclick = \(\) => kopierOpskrift\(r,/.test(udsnit('RENDER.recipeDetail_bind = () =>'))) {
    throw new Error('knappen er ikke bundet direkte til kopierOpskrift');
  }
});

console.log(`\n${ok} ok, ${fejl} fejl`);
process.exit(fejl ? 1 : 0);
