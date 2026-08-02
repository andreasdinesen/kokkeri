'use strict';
/* Kokkeri frontend – vanilla JS, ingen frameworks.
 * Samlet af build-dele (app/parts/p*.js -> public/app.js). */

const APP_VERSION = 6;

/* ---------------- state ---------------- */
const S = {
  me: null,
  settings: { app: {}, logo: '', aiKeySet: false, aiModel: '' },
  items: [],            // alle datatyper fra serveren
  byKind: {},           // kind -> [items]
  view: 'dash',
  viewArg: null,        // fx opskrift-id på detaljesiden
  weekStart: null,      // mandag i den viste madplan-uge (YYYY-MM-DD)
  recFilter: { q: '', category: '', fav: false },
  chat: [],             // AI-samtale (kun i hukommelsen)
  chatBusy: false,
  timers: [],           // [{id,label,totalMs,endsAt,remainMs,paused,ringing}]
  wakeOn: false,
  wakeSentinel: null
};

/* standard-parametre – kan aendres under Indstillinger */
const DEFAULT_APP = {
  appTitle: 'Kokkeri',
  categories: ['Hovedret', 'Forret', 'Dessert', 'Kage & bagværk', 'Tilbehør', 'Salat', 'Suppe', 'Morgenmad', 'Drikkevarer'],
  defaultServings: 4,
  timerPresets: [1, 3, 5, 10, 15, 20, 30, 45, 60]
};
const app = () => Object.assign({}, DEFAULT_APP, S.settings.app || {});

/* ---------------- API ---------------- */
async function api(path, opts) {
  const o = Object.assign({ headers: {} }, opts || {});
  if (o.body !== undefined) {
    o.method = o.method || 'POST';
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(path, o);
  let j = null;
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  return j;
}

/* ---------------- utils ---------------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* crypto.randomUUID findes kun i secure contexts (https/localhost) - fallback til getRandomValues */
function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;  // version 4
  b[8] = (b[8] & 63) | 128; // variant 10
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/* dansk + engelsk talformat: "1,5"=1.5, "1.5"=1.5 */
function num(v) {
  let s = String(v == null ? '' : v).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function fmt(n, dec) {
  if (n == null || isNaN(n)) return '–';
  return Number(n).toLocaleString('da-DK', { minimumFractionDigits: dec == null ? 0 : dec, maximumFractionDigits: dec == null ? 2 : dec });
}
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(String(d).length === 10 ? d + 'T00:00:00' : d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function isoDate(d) { // -> YYYY-MM-DD
  const dt = d ? new Date(d) : new Date();
  if (isNaN(dt)) return '';
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
function addDays(iso, n) {
  const dt = new Date(iso + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return isoDate(dt);
}
function mondayOf(d) { // mandag i samme uge
  const dt = d ? new Date(d + 'T00:00:00') : new Date();
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return isoDate(dt);
}
function isoWeekNo(iso) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}
const WEEKDAYS_DA = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

/* samlet tid for en opskrift - nogle sider saetter totalTime forkert (lavere end
 * cookTime), saa vi tager det stoerste af totalTime og prep+cook */
function recipeTotalMin(r) {
  return Math.max(r.totalMin || 0, (r.prepMin || 0) + (r.cookMin || 0)) || null;
}
function fmtMin(min) {
  if (min == null || isNaN(min) || min <= 0) return '';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h && m) return h + ' t ' + m + ' min';
  return h ? h + ' t' : m + ' min';
}

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = ''; }, isErr ? 5000 : 2600);
}
function downloadFile(name, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function normName(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

/* ---------------- ingrediens-skalering ---------------- */
/* Skalerer den ledende maengde i en ingredienslinje: "500 g mel" -> "750 g mel".
 * Forstaar decimaler (1,5 / 1.5), blandede tal (1 1/2), broeker (3/4) og
 * unicode-broeker (½ ¼ ¾ ⅓ ⅔ ⅛). Roerer ikke tal inde i teksten. */
const UFRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
function parseQty(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);              // 1 1/2
  if (m) return { val: +m[1] + (+m[2]) / (+m[3]), len: m[0].length };
  m = s.match(/^(\d+)\s*\/\s*(\d+)/);                          // 3/4
  if (m) return { val: (+m[1]) / (+m[2]), len: m[0].length };
  m = s.match(/^(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞])/);                      // 1½
  if (m) return { val: +m[1] + UFRAC[m[2]], len: m[0].length };
  m = s.match(/^([½¼¾⅓⅔⅛⅜⅝⅞])/);                              // ½
  if (m) return { val: UFRAC[m[1]], len: m[0].length };
  m = s.match(/^(\d+(?:[.,]\d+)?)/);                           // 500 / 1,5
  if (m) return { val: num(m[1]), len: m[0].length };
  return null;
}
function fmtQty(n) {
  const r = Math.round(n * 100) / 100;
  return r.toLocaleString('da-DK', { maximumFractionDigits: 2 });
}
function scaleIngredient(line, factor) {
  if (!factor || factor === 1) return line;
  const s = String(line);
  const q1 = parseQty(s);
  if (!q1) return line;
  let out = fmtQty(q1.val * factor);
  let rest = s.slice(q1.len);
  /* interval: "2-3 fed hvidloeg" */
  const rm = rest.match(/^\s*[-–]\s*/);
  if (rm) {
    const q2 = parseQty(rest.slice(rm[0].length));
    if (q2) {
      out += '-' + fmtQty(q2.val * factor);
      rest = rest.slice(rm[0].length + q2.len);
    }
  }
  return out + rest;
}

/* ---------------- data-adgang ---------------- */
function reindex() {
  S.byKind = {};
  for (const it of S.items) {
    if (it.deleted) continue;
    (S.byKind[it.kind] = S.byKind[it.kind] || []).push(it);
  }
}
const K = kind => S.byKind[kind] || [];
const recipeById = id => K('recipe').find(r => r.id === id) || null;

async function saveItem(it, quiet) {
  it.updatedAt = new Date().toISOString();
  const idx = S.items.findIndex(x => x.id === it.id);
  if (idx >= 0) S.items[idx] = it; else S.items.push(it);
  reindex();
  try { await api('/api/items', { body: { item: it } }); if (!quiet) toast('Gemt'); }
  catch (e) { toast('Kunne ikke gemme: ' + e.message, true); }
}
async function deleteItem(it) {
  it.deleted = true;
  await saveItem(it, true);
  toast('Slettet');
}
async function saveBulk(items) {
  for (const it of items) {
    const idx = S.items.findIndex(x => x.id === it.id);
    if (idx >= 0) S.items[idx] = it; else S.items.push(it);
  }
  reindex();
  const r = await api('/api/items/bulk', { body: { items } });
  return r.imported;
}
async function saveSettings(patch) {
  const s = await api('/api/settings', { body: { settings: patch } });
  S.settings = Object.assign(S.settings, s);
  toast('Indstillinger gemt');
}

/* ---------------- modal ---------------- */
function openModal(html, onReady, wide) {
  const host = $('#modalHost');
  host.innerHTML = `<div class="modalback"><div class="modal${wide ? ' wide' : ''}">${html}</div></div>`;
  host.querySelector('.modalback').addEventListener('mousedown', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  if (onReady) onReady(host.querySelector('.modal'));
}
function closeModal() { $('#modalHost').innerHTML = ''; }

async function confirmBox(text, verb) {
  return new Promise(resolve => {
    openModal(`<h2>Er du sikker?</h2><p>${esc(text)}</p>
      <div class="actions">
        <button class="btn" id="cfNo">Annullér</button>
        <button class="btn danger" id="cfYes">${esc(verb || 'Slet')}</button>
      </div>`, m => {
      m.querySelector('#cfNo').onclick = () => { closeModal(); resolve(false); };
      m.querySelector('#cfYes').onclick = () => { closeModal(); resolve(true); };
    });
  });
}

/* ---------------- hold skaermen taendt (Wake Lock) ---------------- */
async function setWakeLock(on) {
  if (on && !('wakeLock' in navigator)) {
    toast('Skærmlås kræver https (Wake Lock API er ikke tilgængeligt her)', true);
    return;
  }
  S.wakeOn = on;
  try { localStorage.setItem('kk_wake', on ? '1' : ''); } catch (e) {}
  if (on) {
    try {
      S.wakeSentinel = await navigator.wakeLock.request('screen');
      S.wakeSentinel.addEventListener('release', () => { S.wakeSentinel = null; });
      toast('Skærmen holdes tændt');
    } catch (e) {
      S.wakeOn = false;
      toast('Kunne ikke holde skærmen tændt: ' + e.message, true);
    }
  } else if (S.wakeSentinel) {
    try { await S.wakeSentinel.release(); } catch (e) {}
    S.wakeSentinel = null;
    toast('Skærmen må gerne slukke igen');
  }
  updateWakeBtn();
}
function updateWakeBtn() {
  const b = $('#wakeQuick');
  if (b) {
    b.classList.toggle('on', S.wakeOn);
    b.textContent = S.wakeOn ? '📱' : '📴';
    b.title = S.wakeOn ? 'Skærmen holdes tændt – klik for at slå fra'
                       : 'Skærmen må gerne slukke – klik for at holde den tændt';
  }
  const p = $('#wakePageBtn');
  if (p) {
    p.classList.toggle('primary', S.wakeOn);
    p.textContent = S.wakeOn ? '📱 Skærmen holdes tændt – slå fra' : '📱 Hold skærmen tændt';
  }
  /* kogetilstandens chip skal afspejle den faktiske tilstand */
  if (typeof CM !== 'undefined' && CM.recipe && !$('#cookMode').hidden) drawCookMode();
}
/* wake lock slippes naar fanen skjules - tag den igen */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.wakeOn && !S.wakeSentinel && 'wakeLock' in navigator) {
    navigator.wakeLock.request('screen').then(sn => {
      S.wakeSentinel = sn;
      sn.addEventListener('release', () => { S.wakeSentinel = null; });
    }).catch(() => {});
  }
});

/* ---------------- print ---------------- */
function printSheet(html) {
  $('#printHost').innerHTML = html;
  setTimeout(() => window.print(), 60);
}
function printLogoHtml() {
  return S.settings.logo ? `<div class="plogo"><img src="${S.settings.logo}"></div>` : '';
}

/* ---------------- mad-hjaelpere: enheder, afdelinger, sammenlaegning, Paprika ---------------- */

/* ---- enhedsomregning (imperial -> metrisk) ---- */
const IMPERIAL_UNITS = [
  { re: /\bcups?\b/i,                 factor: 2.4,    unit: 'dl' },
  { re: /\bfl\.?\s*oz\.?\b/i,         factor: 29.6,   unit: 'ml' },
  { re: /\b(?:oz|ounces?)\b/i,        factor: 28.35,  unit: 'g' },
  { re: /\b(?:lbs?|pounds?)\b/i,      factor: 453.6,  unit: 'g' },
  { re: /\b(?:tsp|teaspoons?)\b/i,    factor: 1,      unit: 'tsk' },
  { re: /\b(?:tbsp|tablespoons?)\b/i, factor: 1,      unit: 'spsk' },
  { re: /\bquarts?\b/i,               factor: 9.5,    unit: 'dl' },
  { re: /\bpints?\b/i,                factor: 4.7,    unit: 'dl' },
  { re: /\binch(?:es)?\b|\b(\d)"/i,   factor: 2.54,   unit: 'cm' }
];
function hasImperial(recipe) {
  const all = (recipe.ingredients || []).concat(recipe.instructions || []).join('\n');
  return IMPERIAL_UNITS.some(u => u.re.test(all)) || /\d\s*°?\s*F\b/.test(all);
}
function convertLineToMetric(line) {
  let s = String(line);
  /* "1 1/2 cups mel" / "3/4 cup" / "1½ oz" / "2,5 lbs" foran en imperial enhed */
  s = s.replace(/(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?\s*[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])\s*(cups?|fl\.?\s*oz\.?|oz|ounces?|lbs?|pounds?|tsp|teaspoons?|tbsp|tablespoons?|quarts?|pints?|inch(?:es)?)\b/gi,
    (m, qty, unitWord) => {
      const parsed = parseQty(qty.trim());
      if (!parsed) return m;
      const u = IMPERIAL_UNITS.find(x => x.re.test(unitWord));
      if (!u) return m;
      const val = parsed.val * u.factor;
      const rounded = u.unit === 'g' || u.unit === 'ml' ? Math.round(val)
        : Math.round(val * 10) / 10;
      return fmtQty(rounded) + ' ' + u.unit;
    });
  /* fahrenheit -> celsius (rundes til naermeste 5) */
  s = s.replace(/(\d{2,3})\s*°?\s*F\b/g, (m, f) => Math.round((+f - 32) * 5 / 9 / 5) * 5 + ' °C');
  return s;
}
function convertRecipeToMetric(r) {
  r.ingredients = (r.ingredients || []).map(convertLineToMetric);
  r.instructions = (r.instructions || []).map(convertLineToMetric);
}

/* ---- indkoebslistens afdelinger (regelbaseret; AI kan tage resten) ---- */
const SHOP_SECTIONS = ['Frugt & grønt', 'Kød & fisk', 'Mejeri & køl', 'Frost', 'Brød', 'Kolonial', 'Krydderier', 'Drikkevarer', 'Andet'];
const SECTION_RULES = [
  ['Frugt & grønt', /løg|hvidløg|kartof|gulerod|guleroedder|gulerødder|tomat(?!.*dåse)|agurk|peberfrug|salat|spinat|broccoli|blomkål|squash|aubergine|champignon|svampe|citron|lime|appelsin|æble|banan|bær|avocado|porre|selleri|ingefær|chili|krydderurt|persille|basilikum|koriander|dild|purløg|forårsløg|rødbede|græskar|majs|ærter(?!.*frost)|bønner(?!.*dåse)|kål|frugt/i],
  ['Kød & fisk', /kylling|okse|svin|hakket|kød|bacon|skinke|pølse|chorizo|lam|kalkun|and(?:ebryst)?|laks|torsk|fisk|reje|tun(?!.*dåse)|muslinge|filet|mørbrad|culotte|entrecote|frikadelle/i],
  ['Mejeri & køl', /mælk|fløde|smør(?!rebrød)|ost|yoghurt|skyr|creme fraiche|cremefraiche|æg(?:$|\s)|parmesan|mozzarella|feta|hytteost|kærnemælk|mascarpone|ricotta|halloumi|tortilla(?:pandekage)?|hummus/i],
  ['Frost', /frost|frossen|frosne|is(?:$|\s)/i],
  ['Brød', /brød|bolle|baguette|rugbrød|toast|pita|naan|croissant/i],
  ['Krydderier', /salt|peber(?!frug)|paprika(?:pulver)?|spidskommen|kommen|karry|gurkemeje|kanel|kardemomme|muskat|oregano|timian(?:,)?\s*tørret|tørret timian|laurbær|chiliflager|bouillon|fond|krydderi/i],
  ['Drikkevarer', /vand(?:$|\s)|juice|sodavand|øl(?:$|\s)|vin(?:$|\s|,)|rødvin|hvidvin|kaffe|te(?:$|\s)/i],
  ['Kolonial', /mel|sukker|gryn|ris(?:$|\s)|pasta|spaghetti|nudler|olie|eddike|balsamico|dåse|passata|ketchup|sennep|mayo|soja|honning|sirup|chokolade|kakao|nødder|mandler|rosiner|linser|kikærter|kokosmælk|tomatpuré|gær|bagepulver|vanilje|husblas|couscous|bulgur|quinoa|havregryn|müsli|marmelade|peanutbutter|kapers|oliven|ansjos|tortillachips/i]
];
function guessSection(text) {
  const t = normName(text);
  for (const [section, re] of SECTION_RULES) if (re.test(t)) return section;
  return '';
}

/* ---- sammenlaegning af ens varer ---- */
/* "500 g mel" -> {qty: 500, unit: 'g', name: 'mel'}; uden maengde -> {name} */
const UNIT_WORDS = /^(g|gram|kg|ml|cl|dl|l|liter|tsk|spsk|stk|styk|knsp|fed|dåse|dåser|glas|pose|poser|bundt|pakke|pakker|bakke|bakker|håndfuld)\.?\s+/i;
const UNIT_NORM = { gram: 'g', liter: 'l', styk: 'stk', dåser: 'dåse', poser: 'pose', pakker: 'pakke', bakker: 'bakke' };
function parseShopText(text) {
  let s = String(text || '').trim();
  const q2 = parseQty(s);
  let qty = null, unit = '';
  if (q2) {
    qty = q2.val;
    s = s.slice(q2.len).trim();
    const um = s.match(UNIT_WORDS);
    if (um) {
      unit = um[1].toLowerCase().replace(/\.$/, '');
      unit = UNIT_NORM[unit] || unit;
      s = s.slice(um[0].length).trim();
    }
  }
  return { qty, unit, name: s };
}
function mergeKey(p) {
  /* navnet normaliseres let: smaa bogstaver, uden "frisk(e)/finthakket"-stoej efter komma */
  return p.unit + '|' + normName(p.name.split(',')[0]);
}
/* laegger aabne varer med samme navn+enhed sammen; returnerer antal sammenlagte */
async function mergeShoppingItems() {
  const open = K('shopItem').filter(i => !i.done);
  const groups = new Map();
  for (const it of open) {
    const p = parseShopText(it.text);
    if (!p.name) continue;
    const key = mergeKey(p);
    (groups.get(key) || groups.set(key, []).get(key)).push({ it, p });
  }
  const changed = [];
  let merged = 0;
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    const withQty = arr.filter(x => x.p.qty != null);
    const keeper = arr[0].it;
    if (withQty.length >= 2) {
      const sum = withQty.reduce((a, x) => a + x.p.qty, 0);
      const p0 = arr[0].p;
      keeper.text = fmtQty(sum) + (p0.unit ? ' ' + p0.unit : '') + ' ' + p0.name;
    }
    keeper.group = arr.every(x => x.it.group === keeper.group) ? keeper.group : 'Flere opskrifter';
    changed.push(keeper);
    for (const x of arr.slice(1)) { x.it.deleted = true; changed.push(x.it); merged++; }
  }
  if (changed.length) await saveBulk(changed);
  return merged;
}

/* ---- forraad: er en ingrediens allerede paa lager? ---- */
function inPantry(text) {
  const t = normName(text);
  return K('pantryItem').some(p => {
    const n = normName(p.text);
    return n.length >= 3 && t.includes(n);
  });
}

/* ---------------- Paprika-import (.paprikarecipes) ---------------- */
/* Formatet er et zip-arkiv med en .paprikarecipe-fil (gzippet JSON) pr. opskrift. */
async function unzipEntries(buf) {
  const dv = new DataView(buf);
  /* find End of Central Directory bagfra */
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Ikke en gyldig zip-fil');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, off + 46, nameLen));
    /* datastarten findes via den LOKALE header (dens navn/extra kan afvige) */
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    entries.push({ name, method, data: new Uint8Array(buf, dataStart, compSize) });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
async function decompress(bytes, format) {
  const ds = new DecompressionStream(format);
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/* "1 hour 15 mins" / "45 min" / "1,5 time" -> minutter */
function parseTimeText(s) {
  s = String(s || '').toLowerCase();
  if (!s.trim()) return null;
  let min = 0;
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|timers?|time[rn]?|t\b)/);
  if (h) min += num(h[1]) * 60;
  const m = s.match(/(\d+)\s*(?:minutes?|mins?|minutter|min\b)/);
  if (m) min += +m[1];
  if (!min) { const bare = s.match(/^(\d+)$/); if (bare) min = +bare[1]; }
  return min ? Math.round(min) : null;
}
function b64ToBlob(b64, mime) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'image/jpeg' });
}
async function paprikaToRecipe(j) {
  const cats = app().categories || [];
  const pCats = Array.isArray(j.categories) ? j.categories : [];
  const category = cats.find(c => pCats.some(pc => normName(pc) === normName(c))) || '';
  let image = '';
  if (j.photo_data) {
    try { image = await blobToScaledDataUrl(b64ToBlob(j.photo_data)); } catch (e) {}
  }
  const split = s => String(s || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    .map(l => /^[A-ZÆØÅ0-9 &-]{3,40}:$/.test(l) ? '## ' + l.replace(/:$/, '') : l);
  return {
    id: uid(), kind: 'recipe',
    title: String(j.name || '(uden titel)').trim(),
    description: String(j.description || '').trim(),
    image,
    url: String(j.source_url || '').trim(),
    ingredients: split(j.ingredients),
    instructions: split(j.directions),
    prepMin: parseTimeText(j.prep_time),
    cookMin: parseTimeText(j.cook_time),
    totalMin: parseTimeText(j.total_time),
    servings: (() => { const m = String(j.servings || '').match(/\d+/); return m ? +m[0] : null; })(),
    yieldText: String(j.servings || ''),
    category,
    tags: pCats.filter(c => normName(c) !== normName(category)).slice(0, 8),
    rating: Math.min(5, Math.max(0, parseInt(j.rating, 10) || 0)),
    favorite: false,
    notes: [j.notes, j.nutritional_info ? 'Ernæring (fra Paprika): ' + j.nutritional_info : '']
      .filter(Boolean).join('\n\n').trim(),
    createdAt: j.created ? new Date(j.created).toISOString() : new Date().toISOString()
  };
}
async function importPaprikaFile(file, onProgress) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Din browser understøtter ikke DecompressionStream – prøv en nyere browser');
  }
  const buf = await file.arrayBuffer();
  let payloads = [];
  if (/\.paprikarecipe$/i.test(file.name)) {
    payloads = [new Uint8Array(buf)]; // enkelt opskrift (gzip direkte)
  } else {
    const entries = await unzipEntries(buf);
    for (const e of entries) {
      if (!/\.paprikarecipe$/i.test(e.name)) continue;
      payloads.push(e.method === 8 ? await decompress(e.data, 'deflate-raw') : e.data);
    }
  }
  if (!payloads.length) throw new Error('Fandt ingen opskrifter i filen – er det en Paprika-eksport (.paprikarecipes)?');
  const existing = new Set(K('recipe').map(r => normName(r.title)));
  const out = { imported: 0, skipped: 0, failed: 0 };
  const batch = [];
  for (let i = 0; i < payloads.length; i++) {
    if (onProgress) onProgress(i + 1, payloads.length);
    try {
      const jsonBytes = await decompress(payloads[i], 'gzip');
      const j = JSON.parse(new TextDecoder().decode(jsonBytes));
      if (existing.has(normName(j.name))) { out.skipped++; continue; }
      const rec = await paprikaToRecipe(j);
      existing.add(normName(rec.title));
      batch.push(rec);
      out.imported++;
    } catch (e) { out.failed++; }
    if (batch.length >= 25) { await saveBulk(batch.splice(0)); }
  }
  if (batch.length) await saveBulk(batch);
  return out;
}

/* ---------------- navigation og skal ---------------- */
const VIEWS = [
  { id: 'dash',      ico: '📊', label: 'Overblik' },
  { id: 'recipes',   ico: '📖', label: 'Opskrifter' },
  { id: 'plan',      ico: '📅', label: 'Madplan' },
  { id: 'shopping',  ico: '🛒', label: 'Indkøbsliste' },
  { id: 'timers',    ico: '⏱️', label: 'Timere' },
  { id: 'assistant', ico: '✨', label: 'AI-assistent' },
  { id: 'settings',  ico: '⚙️', label: 'Indstillinger' }
];
const RENDER = {}; // id -> funktion

function navBadge(id) {
  if (id === 'timers') {
    const n = S.timers.length;
    return n ? `<span class="navbadge">${n}</span>` : '';
  }
  if (id === 'shopping') {
    const n = K('shopItem').filter(i => !i.done).length;
    return n ? `<span class="navbadge">${n}</span>` : '';
  }
  return '';
}

function renderNav() {
  $('#navItems').innerHTML = `<button class="navbtn" id="navSearch">
      <span class="ico">🔍</span><span>Søg</span><span class="hint" style="margin-left:auto"><span class="kbd">⌘K</span></span>
    </button><div class="navsep"></div>` + VIEWS.map(v =>
    `<button class="navbtn${S.view === v.id ? ' active' : ''}" data-view="${v.id}">
       <span class="ico">${v.ico}</span><span>${v.label}</span>${navBadge(v.id)}</button>`).join('');
  $$('#navItems .navbtn[data-view]').forEach(b => b.onclick = () => {
    S.view = b.dataset.view;
    S.viewArg = null;
    if (matchMedia('(max-width: 760px)').matches) document.body.classList.remove('navopen');
    render();
  });
  $('#navSearch').onclick = openPalette;
  renderNavTimers();
  $('#navVersion').textContent = 'Kokkeri v' + APP_VERSION;
  const A = app();
  $('#brandName').textContent = A.appTitle || 'Kokkeri';
  $('#brandLogo').innerHTML = S.settings.logo ? `<img class="navlogo" src="${S.settings.logo}">` : '🍳';
}

/* aktive timere i sidebaren - nedtaellingen opdateres af timer-motoren via [data-timerid] */
function renderNavTimers() {
  const host = $('#navTimers');
  if (!host) return;
  host.innerHTML = S.timers.map(t => `
    <button class="navtimer${t.ringing ? ' ringing' : ''}${t.paused ? ' paused' : ''}" data-timerid="${t.id}" title="Gå til timerne">
      <span>${t.ringing ? '⏰' : t.paused ? '⏸' : '⏱'}</span>
      <span class="tlbl">${esc(t.label)}</span>
      <span class="ttime">${t.ringing ? '0:00' : fmtTimer(timerRemainMs(t))}</span>
    </button>`).join('');
  host.querySelectorAll('.navtimer').forEach(b => b.onclick = () => {
    if (matchMedia('(max-width: 760px)').matches) document.body.classList.remove('navopen');
    goto('timers');
  });
}

function render() {
  renderNav();
  const fn = RENDER[S.view] || RENDER.dash;
  $('#app').innerHTML = fn();
  const binder = RENDER[S.view + '_bind'];
  if (binder) binder();
  updateWakeBtn();
  window.scrollTo(0, 0);
}
function goto(view, arg) {
  S.view = view;
  S.viewArg = arg == null ? null : arg;
  render();
}

function pageHead(title, sub, extraHtml) {
  return `<div class="toprow"><div class="grow"><h1>${esc(title)}</h1><p class="sub">${sub || ''}</p></div>
    ${extraHtml || ''}</div>`;
}

/* faelles: opskrift-dropdown */
function recipeOptions(selectedId) {
  const list = K('recipe').slice().sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'da'));
  return '<option value="">– vælg opskrift –</option>' + list.map(r =>
    `<option value="${r.id}"${r.id === selectedId ? ' selected' : ''}>${esc(r.title)}</option>`).join('');
}

/* ---------------- kommandopalet (Cmd/Ctrl+K) ---------------- */
function paletteItems() {
  const items = VIEWS.map(v => ({ ico: v.ico, label: v.label, hint: 'side', run: () => goto(v.id) }));
  items.push(
    { ico: '📖', label: 'Ny opskrift', hint: 'handling', run: () => { goto('recipes'); recipeModal(null); } },
    { ico: '🌐', label: 'Importér opskrift fra URL', hint: 'handling', run: () => { goto('recipes'); importUrlModal(); } },
    { ico: '📋', label: 'Importér fra indsat HTML/noter', hint: 'handling', run: () => { goto('recipes'); importUrlModal(); setTimeout(() => { const d = $('#impPasteBox'); if (d) { d.open = true; $('#impPaste').focus(); } }, 60); } },
    { ico: '⏱️', label: 'Ny timer', hint: 'handling', run: () => { goto('timers'); newTimerModal(); } },
    { ico: '🛒', label: 'Tilføj til indkøbsliste', hint: 'handling', run: () => { goto('shopping'); setTimeout(() => { const el = $('#shopNew'); if (el) el.focus(); }, 50); } },
    { ico: '📱', label: S.wakeOn ? 'Slå skærmlås fra' : 'Hold skærmen tændt', hint: 'handling', run: () => setWakeLock(!S.wakeOn) },
    { ico: '🎲', label: 'Tilfældig opskrift', hint: 'handling', run: randomRecipe },
    { ico: '🌶️', label: 'Importér Paprika-eksport', hint: 'handling', run: () => { goto('settings'); setTimeout(() => { const b = $('#papImport'); if (b) b.scrollIntoView({ block: 'center' }); }, 60); } },
    { ico: '🌗', label: 'Skift tema', hint: 'handling', run: () => $('#themeQuick').click() }
  );
  /* opskrifter kan findes direkte fra paletten */
  for (const r of K('recipe')) {
    items.push({ ico: '🍽️', label: r.title || '(uden titel)', hint: 'opskrift', run: () => goto('recipeDetail', r.id) });
  }
  return items;
}

function randomRecipe() {
  const list = K('recipe');
  if (!list.length) return toast('Ingen opskrifter endnu', true);
  goto('recipeDetail', list[Math.floor(Math.random() * list.length)].id);
}

function openPalette() {
  if (!S.me || $('#palette')) return;
  const wrap = document.createElement('div');
  wrap.id = 'palette';
  wrap.innerHTML = `<div class="palbox">
      <input id="palInput" placeholder="Hop til side, opskrift eller handling…" autocomplete="off">
      <div class="palist" id="palList"></div>
    </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('#palInput');
  const list = wrap.querySelector('#palList');
  let sel = 0, shown = [];

  const close = () => wrap.remove();
  const draw = () => {
    const q = normName(input.value);
    shown = paletteItems().filter(it => !q || normName(it.label).includes(q)).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length ? shown.map((it, i) => `
      <div class="palitem${i === sel ? ' sel' : ''}" data-i="${i}">
        <span class="ico">${it.ico}</span><span>${esc(it.label)}</span><span class="hint">${it.hint}</span>
      </div>`).join('') : '<div class="palempty">Ingen resultater</div>';
    list.querySelectorAll('.palitem').forEach(el => {
      el.onmouseenter = () => { sel = +el.dataset.i; draw(); };
      el.onclick = () => { const it = shown[+el.dataset.i]; close(); it.run(); };
    });
    const selEl = list.querySelector('.palitem.sel');
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[sel]) { close(); shown[sel].run(); } }
    else if (e.key === 'Escape') close();
  };
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  draw();
  input.focus();
}

/* ---------------- auth-flow ---------------- */
async function boot() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    }
  });
  $('#navToggle').onclick = () => {
    if (matchMedia('(max-width: 760px)').matches) document.body.classList.toggle('navopen');
    else {
      document.body.classList.toggle('navfold');
      try { localStorage.setItem('kk_nav', document.body.classList.contains('navfold') ? '1' : ''); } catch (e) {}
    }
  };
  $('#themeQuick').onclick = () => {
    const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = cur;
    try { localStorage.setItem('kk_theme', cur); } catch (e) {}
    updateThemeBtn();
  };
  $('#wakeQuick').onclick = () => setWakeLock(!S.wakeOn);
  $('#logoutBtn').onclick = async () => { await api('/api/logout', { body: {} }); location.reload(); };

  try {
    const r = await api('/api/me');
    S.me = r.me;
    await enterApp();
  } catch (e) {
    showLogin();
  }
}
function updateThemeBtn() {
  $('#themeQuick').textContent = document.documentElement.dataset.theme === 'light' ? '🌙' : '☀️';
}

function showLogin() {
  document.body.className = 'noauth';
  $('#loginView').hidden = false;
  $('nav').hidden = true;
  $('#navToggle').hidden = true;
  $('#app').hidden = true;

  // skjul "Opret ny bruger" naar admin har lukket for registrering
  api('/api/public-config').then(cfg => {
    $('#showRegister').parentElement.hidden = !cfg.allowRegistration;
  }).catch(() => {});

  const doLogin = async () => {
    try {
      const r = await api('/api/login', { body: { username: $('#loginUser').value, password: $('#loginPass').value } });
      S.me = r.me;
      await enterApp();
    } catch (e) { toast(e.message, true); }
  };
  $('#loginBtn').onclick = doLogin;
  $('#loginPass').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
  $('#passkeyBtn').onclick = passkeyLogin;
  $('#showRegister').onclick = e => { e.preventDefault(); $('#loginForm').hidden = true; $('#registerForm').hidden = false; };
  $('#showLogin').onclick = e => { e.preventDefault(); $('#loginForm').hidden = false; $('#registerForm').hidden = true; };
  $('#registerBtn').onclick = async () => {
    if ($('#regPass').value !== $('#regPass2').value) return toast('Kodeordene er ikke ens', true);
    try {
      const r = await api('/api/register', { body: { username: $('#regUser').value, password: $('#regPass').value } });
      S.me = r.me;
      if (r.firstUser) toast('Du er oprettet som administrator');
      await enterApp();
    } catch (e) { toast(e.message, true); }
  };
}

async function enterApp() {
  const [settings, items] = await Promise.all([api('/api/settings'), api('/api/items')]);
  S.settings = Object.assign({ app: {}, logo: '' }, settings);
  S.items = items.items || [];
  reindex();
  S.weekStart = mondayOf();
  document.body.className = '';
  try { if (localStorage.getItem('kk_nav') === '1') document.body.classList.add('navfold'); } catch (e) {}
  $('#loginView').hidden = true;
  $('nav').hidden = false;
  $('#navToggle').hidden = false;
  $('#app').hidden = false;
  $('#whoAmI').textContent = S.me.username + (S.me.isAdmin ? ' · admin' : '');
  updateThemeBtn();
  if (S.settings.logo) {
    $('#loginLogo').innerHTML = `<img src="${S.settings.logo}">`;
  }
  loadTimers();
  startTimerEngine();
  try { if (localStorage.getItem('kk_wake') === '1') setWakeLock(true); } catch (e) {}
  render();
}

/* WebAuthn hjaelpere */
const waB64uToBuf = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const waBufToB64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function passkeyLogin() {
  try {
    const o = await api('/api/webauthn/login/options', { body: {} });
    const pk = o.publicKey;
    pk.challenge = waB64uToBuf(pk.challenge);
    const cred = await navigator.credentials.get({ publicKey: pk });
    const r = await api('/api/webauthn/login/verify', {
      body: {
        challengeId: o.challengeId,
        id: cred.id,
        response: {
          clientDataJSON: waBufToB64u(cred.response.clientDataJSON),
          authenticatorData: waBufToB64u(cred.response.authenticatorData),
          signature: waBufToB64u(cred.response.signature)
        }
      }
    });
    S.me = r.me;
    await enterApp();
  } catch (e) {
    if (e.name !== 'NotAllowedError') toast('Passkey-login fejlede: ' + e.message, true);
  }
}
async function passkeyRegister() {
  try {
    const o = await api('/api/webauthn/register/options', { body: {} });
    const pk = o.publicKey;
    pk.challenge = waB64uToBuf(pk.challenge);
    pk.user.id = waB64uToBuf(pk.user.id);
    pk.excludeCredentials = (pk.excludeCredentials || []).map(c => ({ type: 'public-key', id: waB64uToBuf(c.id) }));
    const cred = await navigator.credentials.create({ publicKey: pk });
    const label = prompt('Navn til denne passkey (fx "MacBook" eller "iPhone"):', 'Denne enhed') || 'Passkey';
    const r = await api('/api/webauthn/register/verify', {
      body: {
        challengeId: o.challengeId,
        label,
        response: { clientDataJSON: waBufToB64u(cred.response.clientDataJSON), attestationObject: waBufToB64u(cred.response.attestationObject) }
      }
    });
    S.me = r.me;
    toast('Passkey registreret');
    render();
  } catch (e) {
    if (e.name !== 'NotAllowedError') toast('Kunne ikke registrere passkey: ' + e.message, true);
  }
}

/* ---------------- Overblik ---------------- */
RENDER.dash = () => {
  const recipes = K('recipe');
  const favs = recipes.filter(r => r.favorite);
  const today = isoDate();
  const monday = mondayOf();
  const weekDates = [...Array(7)].map((_, i) => addDays(monday, i));
  const planned = K('planEntry').filter(e => weekDates.includes(e.date));
  const shopOpen = K('shopItem').filter(i => !i.done).length;

  /* de naeste 3 dages madplan */
  const upcoming = [];
  for (let i = 0; i < 3; i++) {
    const d = addDays(today, i);
    const entries = K('planEntry').filter(e => e.date === d);
    upcoming.push({ date: d, entries });
  }
  const dayName = d => d === today ? 'I dag' : d === addDays(today, 1) ? 'I morgen'
    : WEEKDAYS_DA[(new Date(d + 'T00:00:00').getDay() + 6) % 7];

  const latest = recipes.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 4);

  return pageHead(app().appTitle || 'Kokkeri', 'Dit lokale opskrifts-bibliotek',
      `<button class="btn" id="dashRandom">🎲 Tilfældig opskrift</button>
       <button class="btn primary" id="dashImport">🌐 Importér fra URL</button>`) + `

  <div class="cards">
    <div class="card"><div class="lbl">Opskrifter</div><div class="big">${recipes.length}</div>
      <div class="note">${favs.length} favoritter</div></div>
    <div class="card"><div class="lbl">Madplan (uge ${isoWeekNo(monday)})</div><div class="big">${planned.length}</div>
      <div class="note">planlagte måltider</div></div>
    <div class="card"><div class="lbl">Indkøbsliste</div><div class="big">${shopOpen}</div>
      <div class="note">varer mangler</div></div>
    <div class="card"><div class="lbl">Timere</div><div class="big">${S.timers.length}</div>
      <div class="note">${S.timers.some(t => t.ringing) ? '⏰ en timer ringer!' : S.timers.length ? 'i gang' : 'ingen aktive'}</div></div>
  </div>

  <h2>De næste dage</h2>
  <div class="panelbox">
    ${upcoming.map(u => `
      <div class="rowflex" style="padding:6px 0;border-bottom:1px solid var(--border)">
        <strong style="width:90px">${dayName(u.date)}</strong>
        <span class="muted small" style="width:78px">${fmtDate(u.date)}</span>
        ${u.entries.length ? u.entries.map(e => {
          const r = e.recipeId ? recipeById(e.recipeId) : null;
          return r ? `<a href="#" data-rec="${r.id}" class="planlink">🍽️ ${esc(r.title)}</a>`
                   : `<span>🍽️ ${esc(e.text || '')}</span>`;
        }).join(' · ') : '<span class="muted">intet planlagt</span>'}
      </div>`).join('')}
    <div style="margin-top:10px"><button class="btn small" id="dashToPlan">📅 Åbn madplanen</button></div>
  </div>

  ${latest.length ? `<h2>Seneste opskrifter</h2>
  <div class="recgrid">${latest.map(recipeCardHtml).join('')}</div>` : `
  <div class="panelbox center" style="padding:40px">
    <div style="font-size:40px">🍳</div>
    <h2 style="margin-top:8px">Velkommen til Kokkeri</h2>
    <p class="muted">Kom i gang ved at importere en opskrift fra en URL – appen trækker selv titel,
    ingredienser og fremgangsmåde ud af siden.</p>
    <button class="btn primary" id="dashImport2">🌐 Importér din første opskrift</button>
  </div>`}`;
};

RENDER.dash_bind = () => {
  $('#dashRandom').onclick = randomRecipe;
  $('#dashImport').onclick = importUrlModal;
  const i2 = $('#dashImport2');
  if (i2) i2.onclick = importUrlModal;
  $('#dashToPlan').onclick = () => goto('plan');
  $$('.planlink').forEach(a => a.onclick = e => { e.preventDefault(); goto('recipeDetail', a.dataset.rec); });
  bindRecipeCards();
};

/* ---------------- Opskrifter ---------------- */

function starsHtml(rating) {
  const r = rating || 0;
  return `<span class="stars">${[1, 2, 3, 4, 5].map(i => `<span class="${i <= r ? '' : 'off'}">★</span>`).join('')}</span>`;
}

function recipeCardHtml(r) {
  const time = recipeTotalMin(r);
  return `<div class="reccard" data-rec="${r.id}">
    <div class="recimg">${r.image ? `<img src="${r.image}" alt="" loading="lazy">` : '🍽️'}</div>
    <div class="recbody">
      <div class="rectitle">${r.favorite ? '⭐ ' : ''}${esc(r.title || '(uden titel)')}</div>
      <div class="recmeta">
        ${r.category ? `<span>${esc(r.category)}</span>` : ''}
        ${time ? `<span>⏱ ${fmtMin(time)}</span>` : ''}
        ${r.rating ? starsHtml(r.rating) : ''}
      </div>
    </div>
  </div>`;
}
function bindRecipeCards() {
  $$('.reccard[data-rec]').forEach(c => c.onclick = () => goto('recipeDetail', c.dataset.rec));
}

RENDER.recipes = () => {
  const f = S.recFilter;
  const cats = app().categories || [];
  let list = K('recipe').slice();
  if (f.fav) list = list.filter(r => r.favorite);
  if (f.category) list = list.filter(r => r.category === f.category);
  if (f.q) {
    const q = normName(f.q);
    list = list.filter(r =>
      normName(r.title).includes(q) ||
      normName((r.tags || []).join(' ')).includes(q) ||
      normName((r.ingredients || []).join(' ')).includes(q));
  }
  list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  return pageHead('Opskrifter', `${K('recipe').length} opskrifter i biblioteket`,
      `<button class="btn" id="recNew">➕ Ny opskrift</button>
       <button class="btn primary" id="recImport">🌐 Importér fra URL</button>`) + `
  <div class="rowflex">
    <input id="recSearch" placeholder="🔍 Søg i titel, ingredienser og tags…" value="${esc(f.q)}" style="min-width:240px;flex:1;max-width:380px">
    <span class="chip chipbtn${f.fav ? ' sel' : ''}" id="recFav">⭐ Favoritter</span>
    ${cats.map(c => `<span class="chip chipbtn${f.category === c ? ' sel' : ''}" data-cat="${esc(c)}">${esc(c)}</span>`).join('')}
  </div>
  ${list.length ? `<div class="recgrid">${list.map(recipeCardHtml).join('')}</div>`
    : '<p class="muted" style="margin-top:26px">Ingen opskrifter matcher.</p>'}`;
};
RENDER.recipes_bind = () => {
  $('#recNew').onclick = () => recipeModal(null);
  $('#recImport').onclick = importUrlModal;
  const search = $('#recSearch');
  search.oninput = () => {
    S.recFilter.q = search.value;
    clearTimeout(search._h);
    search._h = setTimeout(() => { const v = search.value; render(); const el = $('#recSearch'); el.focus(); el.setSelectionRange(v.length, v.length); }, 250);
  };
  $('#recFav').onclick = () => { S.recFilter.fav = !S.recFilter.fav; render(); };
  $$('[data-cat]').forEach(c => c.onclick = () => {
    S.recFilter.category = S.recFilter.category === c.dataset.cat ? '' : c.dataset.cat;
    render();
  });
  bindRecipeCards();
};

/* ---------------- detalje ---------------- */
/* goer "20 min"/"1 time" i fremgangsmaaden klikbare -> starter en timer */
function linkifyTimers(escapedText) {
  return escapedText.replace(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(minutter|minutters|minut|min\.?|timers|timer|time)\b/gi, (m, a, b, unit) => {
    const isHour = /^tim/i.test(unit);
    const mins = (parseInt(b || a, 10)) * (isHour ? 60 : 1);
    if (!mins || mins > 24 * 60) return m;
    return `<span class="inline-timer" data-min="${mins}" title="Klik for at starte en timer på ${mins} min">⏱ ${m}</span>`;
  });
}
function bindInlineTimers(label) {
  $$('.inline-timer').forEach(el => el.onclick = e => {
    e.stopPropagation();
    startTimer(+el.dataset.min * 60000, label);
    toast(`Timer på ${fmtMin(+el.dataset.min)} startet`);
    renderNav();
  });
}

function ingredientsHtml(r, factor) {
  return (r.ingredients || []).map(line => {
    if (/^##\s*/.test(line)) return `<li style="border:0;font-weight:700;color:var(--amber);padding-top:12px">${esc(line.replace(/^##\s*/, ''))}</li>`;
    return `<li>${esc(scaleIngredient(line, factor))}</li>`;
  }).join('');
}
function instructionsHtml(r) {
  let out = '', open = false;
  for (const step of (r.instructions || [])) {
    if (/^##\s*/.test(step)) {
      out += `<li class="stepsec">${esc(step.replace(/^##\s*/, ''))}</li>`;
    } else {
      out += `<li>${linkifyTimers(esc(step))}</li>`;
      open = true;
    }
  }
  return out || (open ? '' : '<li class="muted">Ingen fremgangsmåde</li>');
}

RENDER.recipeDetail = () => {
  const r = recipeById(S.viewArg);
  if (!r) { S.view = 'recipes'; return RENDER.recipes(); }
  const base = r.servings || app().defaultServings;
  if (S.detailFor !== r.id) { S.detailFor = r.id; S.detailServings = base; }
  if (!S.detailServings) S.detailServings = base;
  const factor = S.detailServings / base;

  return `<div class="toprow"><div class="grow">
      <p class="small" style="margin:0 0 6px"><a href="#" id="backToList">← Opskrifter</a></p>
      <h1>${esc(r.title)}</h1>
      <p class="sub">${r.category ? esc(r.category) + ' · ' : ''}${(r.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join(' ')}</p>
    </div>
    <div class="rowflex">
      <button class="iconbtn" id="favBtn" title="Favorit" style="font-size:22px">${r.favorite ? '⭐' : '☆'}</button>
      <button class="btn" id="cookBtn">👨‍🍳 Kogetilstand</button>
      <button class="btn" id="shopBtn">🛒 Til indkøbsliste</button>
      <button class="btn" id="planBtn">📅 Til madplan</button>
      <button class="btn" id="printBtn">🖨️ Print</button>
      <button class="btn" id="editBtn">✏️ Redigér</button>
    </div></div>

  <div class="rowflex" style="margin:6px 0 14px">
    ${r.prepMin ? `<span class="timechip">🔪 Forberedelse: ${fmtMin(r.prepMin)}</span>` : ''}
    ${r.cookMin ? `<span class="timechip">🍳 Tilberedning: ${fmtMin(r.cookMin)}</span>` : ''}
    ${recipeTotalMin(r) ? `<span class="timechip">⏱ I alt: ${fmtMin(recipeTotalMin(r))}</span>` : ''}
    ${r.nutrition ? `<span class="timechip" title="Pr. portion${r.nutrition.estimated ? ' (AI-estimat)' : ''}">🔥 ${r.nutrition.kcal} kcal · ${r.nutrition.protein} g protein · ${r.nutrition.carbs} g kulhydrat · ${r.nutrition.fat} g fedt</span>` : ''}
    <span class="stars pick" id="ratePick">${[1, 2, 3, 4, 5].map(i => `<span data-star="${i}" class="${i <= (r.rating || 0) ? '' : 'off'}">★</span>`).join('')}</span>
  </div>
  <div class="rowflex" style="margin:0 0 14px">
    <button class="btn small" id="shareBtn">${r.shareToken ? '🔗 Deles – vis link' : '🔗 Del med et link'}</button>
    ${S.settings.aiKeySet ? `<button class="btn small" id="nutriBtn">🥗 ${r.nutrition ? 'Genberegn ernæring' : 'Estimér ernæring'} (AI)</button>` : ''}
    ${hasImperial(r) ? '<button class="btn small" id="metricBtn">🌍 Omregn til metrisk (cups → dl …)</button>' : ''}
  </div>

  <div class="recdetail">
    <div>
      ${r.image ? `<div class="recphoto"><img src="${r.image}" alt=""></div>` : ''}
      ${r.description ? `<p class="muted" style="margin-top:12px">${esc(r.description)}</p>` : ''}
      <h2>Ingredienser</h2>
      <div class="rowflex" style="margin-bottom:4px">
        <span class="servstep">
          <button class="btn" id="servMinus">−</button>
          <strong>${S.detailServings} ${/portion|person/i.test(r.yieldText || '') || !r.yieldText ? 'portioner' : esc(r.yieldText.replace(/\d+\s*/, ''))}</strong>
          <button class="btn" id="servPlus">+</button>
        </span>
        ${factor !== 1 ? '<span class="chip on">skaleret</span>' : ''}
      </div>
      <ul class="ings">${ingredientsHtml(r, factor)}</ul>
      ${r.url ? `<p class="small">Kilde: <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(new URL(r.url).hostname)} ↗</a></p>` : ''}
    </div>
    <div>
      <h2 style="margin-top:0">Fremgangsmåde</h2>
      <ol class="steps">${instructionsHtml(r)}</ol>
      ${r.notes ? `<h2>Noter</h2><p style="white-space:pre-wrap">${esc(r.notes)}</p>` : ''}
      <p class="small muted" style="margin-top:22px">Tip: klik på et minuttal i fremgangsmåden for at starte en timer.</p>
    </div>
  </div>`;
};
RENDER.recipeDetail_bind = () => {
  const r = recipeById(S.viewArg);
  if (!r) return;
  $('#backToList').onclick = e => { e.preventDefault(); S.detailServings = null; goto('recipes'); };
  $('#editBtn').onclick = () => recipeModal(r);
  $('#cookBtn').onclick = () => openCookMode(r);
  $('#printBtn').onclick = () => printRecipe(r);
  $('#favBtn').onclick = async () => { r.favorite = !r.favorite; await saveItem(r, true); render(); };
  $('#shopBtn').onclick = () => addRecipeToShopping(r, S.detailServings / (r.servings || app().defaultServings));
  $('#planBtn').onclick = () => planEntryModal(null, { recipeId: r.id });
  $('#servMinus').onclick = () => { S.detailServings = Math.max(1, S.detailServings - 1); render(); };
  $('#servPlus').onclick = () => { S.detailServings = S.detailServings + 1; render(); };
  $$('#ratePick [data-star]').forEach(s => s.onclick = async () => {
    const v = +s.dataset.star;
    r.rating = r.rating === v ? 0 : v;
    await saveItem(r, true);
    render();
  });
  $('#shareBtn').onclick = () => shareRecipeModal(r);
  const nutri = $('#nutriBtn');
  if (nutri) nutri.onclick = () => aiEstimateNutrition(r, nutri);
  const metric = $('#metricBtn');
  if (metric) metric.onclick = async () => {
    if (!await confirmBox('Omregn alle amerikanske mål (cups, oz, lbs, °F …) til metrisk i denne opskrift? Ændringen gemmes.', 'Omregn')) return;
    convertRecipeToMetric(r);
    await saveItem(r);
    render();
  };
  bindInlineTimers(r.title);
};

/* ---------------- deling med offentligt link ---------------- */
function shareRecipeModal(r) {
  const draw = () => {
    const link = r.shareToken ? location.origin + '/del/' + r.shareToken : '';
    openModal(`<h2>🔗 Del "${esc(r.title)}"</h2>
      ${r.shareToken ? `
        <p class="small muted">Alle med linket kan se opskriften – uden login. Slå delingen fra igen når som helst.</p>
        <div class="rowflex">
          <input id="shareUrl" readonly value="${esc(link)}" style="flex:1;min-width:260px">
          <button class="btn small" id="shareCopy">Kopiér</button>
        </div>
        <div class="actions">
          <button class="btn danger" id="shareOff" style="margin-right:auto">Slå deling fra</button>
          <button class="btn" id="shareClose">Luk</button>
        </div>`
      : `<p class="small muted">Lav et offentligt link, så familie og venner kan se opskriften uden login.</p>
        <div class="actions">
          <button class="btn" id="shareClose">Annullér</button>
          <button class="btn primary" id="shareOn">Lav link</button>
        </div>`}`, m => {
      m.querySelector('#shareClose').onclick = () => { closeModal(); render(); };
      const on = m.querySelector('#shareOn');
      if (on) on.onclick = async () => {
        r.shareToken = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
        await saveItem(r, true);
        draw();
      };
      const off = m.querySelector('#shareOff');
      if (off) off.onclick = async () => {
        delete r.shareToken;
        await saveItem(r, true);
        toast('Delingen er slået fra');
        closeModal();
        render();
      };
      const copy = m.querySelector('#shareCopy');
      if (copy) copy.onclick = () => {
        m.querySelector('#shareUrl').select();
        navigator.clipboard.writeText(link).then(() => toast('Link kopieret'));
      };
    });
  };
  draw();
}

/* ---------------- ernaering (AI-estimat pr. portion) ---------------- */
async function aiEstimateNutrition(r, btn) {
  btn.disabled = true;
  btn.textContent = '🥗 Beregner …';
  try {
    const sys = `Du estimerer næringsindhold for madopskrifter. Svar KUN med ét JSON-objekt, ingen forklaring:
{"kcal": tal, "protein": tal, "carbs": tal, "fat": tal} – alle PR. PORTION, afrundet til hele tal.`;
    const res = await api('/api/ai', {
      body: {
        system: sys,
        messages: [{ role: 'user', content: `Opskrift: ${r.title}\nPortioner: ${r.servings || app().defaultServings}\nIngredienser:\n${(r.ingredients || []).join('\n')}` }],
        maxTokens: 512
      }
    });
    let j;
    try { j = JSON.parse(String(res.text).replace(/^[\s\S]*?\{/, '{').replace(/\}[^}]*$/, '}')); }
    catch (e) { throw new Error('AI-svaret kunne ikke læses'); }
    if (typeof j.kcal !== 'number') throw new Error('AI gav ikke et brugbart estimat');
    r.nutrition = {
      kcal: Math.round(j.kcal), protein: Math.round(j.protein || 0),
      carbs: Math.round(j.carbs || 0), fat: Math.round(j.fat || 0), estimated: true
    };
    await saveItem(r, true);
    toast('Ernæring estimeret (pr. portion)');
    render();
  } catch (e) {
    toast('Kunne ikke estimere: ' + e.message, true);
    btn.disabled = false;
    btn.textContent = '🥗 Estimér ernæring (AI)';
  }
}

/* ---------------- print ---------------- */
function printRecipe(r) {
  const factor = (S.detailServings || r.servings || 1) / (r.servings || S.detailServings || 1);
  printSheet(`${printLogoHtml()}
    <h1>${esc(r.title)}</h1>
    <p style="text-align:center">${r.category ? esc(r.category) + ' · ' : ''}${S.detailServings || r.servings || ''} portioner
      ${recipeTotalMin(r) ? ' · ' + fmtMin(recipeTotalMin(r)) : ''}</p>
    <h2>Ingredienser</h2>
    <ul>${(r.ingredients || []).map(l => `<li>${esc(scaleIngredient(l, factor))}</li>`).join('')}</ul>
    <h2>Fremgangsmåde</h2>
    <ol>${(r.instructions || []).map(s => /^##/.test(s) ? `</ol><h2>${esc(s.replace(/^##\s*/, ''))}</h2><ol>` : `<li>${esc(s)}</li>`).join('')}</ol>
    ${r.url ? `<p class="pdate">Kilde: ${esc(r.url)}</p>` : ''}`);
}

/* ---------------- redigerings-modal ---------------- */
function recipeModal(r, prefill) {
  const isNew = !r;
  const d = r || Object.assign({
    id: uid(), kind: 'recipe', title: '', description: '', image: '', url: '',
    ingredients: [], instructions: [], prepMin: null, cookMin: null, totalMin: null,
    servings: app().defaultServings, yieldText: '', category: '', tags: [], rating: 0,
    favorite: false, notes: '', createdAt: new Date().toISOString()
  }, prefill || {});
  const cats = app().categories || [];

  openModal(`<h2>${isNew ? 'Ny opskrift' : 'Redigér opskrift'}</h2>
    <div class="formgrid" style="grid-template-columns:2fr 1fr">
      <label class="fld"><span>Titel</span><input id="rmTitle" value="${esc(d.title)}"></label>
      <label class="fld"><span>Kategori</span><select id="rmCat">
        <option value="">–</option>${cats.map(c => `<option${c === d.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}
      </select></label>
    </div>
    <label class="fld"><span>Kort beskrivelse</span><textarea id="rmDesc" rows="2">${esc(d.description)}</textarea></label>
    <div class="formgrid">
      <label class="fld"><span>Portioner</span><input id="rmServ" type="number" min="1" value="${d.servings || ''}"></label>
      <label class="fld"><span>Forberedelse (min)</span><input id="rmPrep" type="number" min="0" value="${d.prepMin || ''}"></label>
      <label class="fld"><span>Tilberedning (min)</span><input id="rmCook" type="number" min="0" value="${d.cookMin || ''}"></label>
      <label class="fld"><span>Tags (komma-adskilt)</span><input id="rmTags" value="${esc((d.tags || []).join(', '))}"></label>
    </div>
    <label class="fld"><span>Ingredienser – én pr. linje ("## Overskrift" laver en gruppe)</span>
      <textarea id="rmIngs" rows="8">${esc((d.ingredients || []).join('\n'))}</textarea></label>
    <label class="fld"><span>Fremgangsmåde – ét trin pr. linje ("## Overskrift" laver en sektion)</span>
      <textarea id="rmSteps" rows="8">${esc((d.instructions || []).join('\n'))}</textarea></label>
    <label class="fld"><span>Noter (kun til dig selv)</span><textarea id="rmNotes" rows="2">${esc(d.notes || '')}</textarea></label>
    <div class="formgrid" style="grid-template-columns:2fr 1fr">
      <label class="fld"><span>Kilde-URL</span><input id="rmUrl" value="${esc(d.url || '')}"></label>
      <label class="fld"><span>Billede</span>
        <span class="rowflex">
          <button class="btn small" id="rmImgPick">${d.image ? 'Skift…' : 'Vælg…'}</button>
          ${d.image ? '<button class="btn small danger" id="rmImgDel">Fjern</button>' : ''}
          <input id="rmImgFile" type="file" accept="image/*" hidden>
        </span></label>
    </div>
    <div class="actions">
      ${isNew ? '' : '<button class="btn danger" id="rmDelete" style="margin-right:auto">Slet opskrift</button>'}
      <button class="btn" id="rmCancel">Annullér</button>
      <button class="btn primary" id="rmSave">Gem</button>
    </div>`, m => {
    let image = d.image || '';
    m.querySelector('#rmImgPick').onclick = () => m.querySelector('#rmImgFile').click();
    m.querySelector('#rmImgFile').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      image = await blobToScaledDataUrl(f);
      m.querySelector('#rmImgPick').textContent = 'Valgt ✓';
    };
    const del = m.querySelector('#rmImgDel');
    if (del) del.onclick = () => { image = ''; del.disabled = true; m.querySelector('#rmImgPick').textContent = 'Vælg…'; };
    m.querySelector('#rmCancel').onclick = closeModal;
    if (!isNew) m.querySelector('#rmDelete').onclick = async () => {
      if (!await confirmBox(`Slet opskriften "${d.title}"?`)) return;
      closeModal();
      await deleteItem(d);
      S.detailServings = null;
      goto('recipes');
    };
    m.querySelector('#rmSave').onclick = async () => {
      d.title = m.querySelector('#rmTitle').value.trim();
      if (!d.title) return toast('Opskriften skal have en titel', true);
      d.category = m.querySelector('#rmCat').value;
      d.description = m.querySelector('#rmDesc').value.trim();
      d.servings = parseInt(m.querySelector('#rmServ').value, 10) || null;
      d.prepMin = parseInt(m.querySelector('#rmPrep').value, 10) || null;
      d.cookMin = parseInt(m.querySelector('#rmCook').value, 10) || null;
      d.tags = m.querySelector('#rmTags').value.split(',').map(t => t.trim()).filter(Boolean);
      d.ingredients = m.querySelector('#rmIngs').value.split('\n').map(l => l.trim()).filter(Boolean);
      d.instructions = m.querySelector('#rmSteps').value.split('\n').map(l => l.trim()).filter(Boolean);
      d.notes = m.querySelector('#rmNotes').value.trim();
      d.url = m.querySelector('#rmUrl').value.trim();
      d.image = image;
      closeModal();
      await saveItem(d);
      goto('recipeDetail', d.id);
    };
  }, true);
}

/* ---------------- billeder: skaler til dataURL saa alt gemmes lokalt ---------------- */
function blobToScaledDataUrl(blob, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = maxDim || 720;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      let q = 0.82, url = cv.toDataURL('image/jpeg', q);
      while (url.length > 160000 && q > 0.4) { q -= 0.12; url = cv.toDataURL('image/jpeg', q); }
      URL.revokeObjectURL(img.src);
      resolve(url);
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('Kunne ikke læse billedet')); };
    img.src = URL.createObjectURL(blob);
  });
}
async function fetchImageAsDataUrl(url) {
  if (!url) return '';
  try {
    const r = await fetch('/api/fetch-image?url=' + encodeURIComponent(url));
    if (!r.ok) return '';
    return await blobToScaledDataUrl(await r.blob());
  } catch (e) { return ''; }
}

/* ---------------- import fra URL ---------------- */
function importUrlModal() {
  openModal(`<h2>🌐 Importér opskrift</h2>
    <p class="muted small">Indsæt et link til en opskrift – fx fra Valdemarsro, Arla, Madens Verden
    eller de fleste andre opskriftsider. Kokkeri trækker selv titel, ingredienser, fremgangsmåde,
    tider og billede ud og gemmer linket, så du altid kan gå tilbage til originalen.</p>
    <label class="fld"><span>URL</span><input id="impUrl" placeholder="https://…" autocomplete="off"></label>
    <details style="margin-top:12px" id="impPasteBox">
      <summary class="small muted" style="cursor:pointer">Siden kræver login? Eller opskriften står i dine noter? Indsæt indholdet her</summary>
      <p class="small muted" style="margin:8px 0 6px">
        <b>Side bag login:</b> åbn opskriften i din browser (logget ind), vis sidens kilde
        (<span class="kbd">⌘⌥U</span> / <span class="kbd">Ctrl+U</span>), kopiér det hele og indsæt her –
        så bruges din egen adgang, og Kokkeri parser HTML'en præcis som ved et link.
        Alternativt: markér al tekst på siden (<span class="kbd">⌘A</span>, <span class="kbd">⌘C</span>) og indsæt.<br>
        <b>Fra noter:</b> indsæt bare opskrift-teksten${S.settings.aiKeySet ? ' – AI\'en strukturerer den' : ' (kræver AI-nøgle under Indstillinger)'}.
      </p>
      <textarea id="impPaste" rows="7" style="width:100%" placeholder="Indsæt HTML eller opskrift-tekst her …"></textarea>
    </details>
    <p class="small muted" id="impStatus" style="min-height:18px"></p>
    <div class="actions">
      <button class="btn" id="impCancel">Annullér</button>
      <button class="btn primary" id="impGo">Hent opskrift</button>
    </div>`, m => {
    const status = m.querySelector('#impStatus');
    const input = m.querySelector('#impUrl');
    const paste = m.querySelector('#impPaste');
    input.focus();
    m.querySelector('#impCancel').onclick = closeModal;

    /* faelles afslutning: recipe-objekt eller AI-fallback paa raa tekst */
    const finish = async (res, url) => {
      if (res.recipe) {
        status.textContent = 'Fandt opskriften – henter billede …';
        const image = await fetchImageAsDataUrl(res.recipe.image);
        closeModal();
        openImportedRecipe(res.recipe, image);
        return true;
      }
      if (res.pageText) {
        if (!S.settings.aiKeySet) {
          status.innerHTML = 'Ingen maskinlæsbar opskrift (JSON-LD/microdata). Med en AI-nøgle under <b>Indstillinger</b> kan Kokkeri i stedet læse indholdet med AI.';
          return false;
        }
        status.textContent = 'Ingen maskinlæsbar opskrift – prøver med AI (kan tage ~20 sek.) …';
        const rec = await aiExtractRecipe(res.pageText, url, res.pageTitle);
        const image = await fetchImageAsDataUrl(rec.image || res.pageImage);
        closeModal();
        openImportedRecipe(Object.assign(rec, { url }), image);
        return true;
      }
      status.textContent = 'Kunne ikke finde en opskrift.';
      return false;
    };

    const go = async () => {
      let url = input.value.trim();
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      const raw = paste.value.trim();
      if (!url && !raw) return;
      const btn = m.querySelector('#impGo');
      btn.disabled = true;
      try {
        if (raw) {
          /* indsat indhold vinder over URL'en (som saa kun bruges som kilde-link) */
          const looksHtml = /<\/(div|p|html|body|head|script|li|span|h\d|article)>/i.test(raw) || /<html[\s>]/i.test(raw);
          if (looksHtml) {
            status.textContent = 'Analyserer HTML …';
            if (!await finish(await api('/api/parse-recipe', { body: { html: raw, url } }), url)) btn.disabled = false;
          } else {
            if (!S.settings.aiKeySet) {
              status.innerHTML = 'Ren tekst kræver en AI-nøgle under <b>Indstillinger</b> – eller indsæt sidens HTML i stedet.';
              btn.disabled = false;
              return;
            }
            status.textContent = 'AI\'en strukturerer teksten (kan tage ~20 sek.) …';
            const rec = await aiExtractRecipe(raw.slice(0, 30000), url, '');
            const image = await fetchImageAsDataUrl(rec.image);
            closeModal();
            openImportedRecipe(Object.assign(rec, { url }), image);
          }
        } else {
          status.textContent = 'Henter siden …';
          if (!await finish(await api('/api/fetch-recipe?url=' + encodeURIComponent(url)), url)) btn.disabled = false;
        }
      } catch (e) {
        status.textContent = 'Fejl: ' + e.message;
        btn.disabled = false;
      }
    };
    m.querySelector('#impGo').onclick = go;
    input.onkeydown = e => { if (e.key === 'Enter') go(); };
  });
}

function openImportedRecipe(rec, image) {
  /* gaet en kategori ud fra sidens egen kategori-tekst */
  const cats = app().categories || [];
  const catGuess = cats.find(c => normName(rec.category || '').includes(normName(c))) || '';
  recipeModal(null, {
    title: rec.title || '',
    description: rec.description || '',
    image: image || '',
    url: rec.url || '',
    ingredients: rec.ingredients || [],
    instructions: rec.instructions || [],
    prepMin: rec.prepMin || null,
    cookMin: rec.cookMin || null,
    totalMin: rec.totalMin || null,
    servings: rec.servings || app().defaultServings,
    yieldText: rec.yieldText || '',
    category: catGuess,
    tags: (rec.keywords ? String(rec.keywords).split(',').map(t => t.trim()).filter(Boolean).slice(0, 6) : [])
  });
  toast('Opskriften er hentet – tjek den igennem og tryk Gem');
}

/* AI-fallback: udtraek opskrift af raa sidetekst (eller chat-svar) */
async function aiExtractRecipe(text, sourceUrl, pageTitle) {
  const sys = `Du udtrækker madopskrifter af rå tekst. Svar KUN med ét JSON-objekt, ingen forklaring, ingen markdown-hegn.
Format: {"title": str, "description": str, "servings": tal|null, "prepMin": tal|null, "cookMin": tal|null,
"ingredients": [str, ...], "instructions": [str, ...], "category": str}
Ingredienser: én pr. linje med mængde først (fx "500 g hakket oksekød"). Brug "## Overskrift" som linje for grupper/sektioner.
Fremgangsmåde: ét trin pr. streng, uden numre. Behold dansk sprog (oversæt IKKE en udenlandsk opskrift).
Findes der ingen opskrift i teksten, svar {"error": "ingen opskrift fundet"}.`;
  const r = await api('/api/ai', {
    body: {
      system: sys,
      messages: [{ role: 'user', content: (pageTitle ? 'Sidens titel: ' + pageTitle + '\n\n' : '') + text }],
      maxTokens: 4096
    }
  });
  let j;
  try {
    j = JSON.parse(String(r.text).replace(/^[\s\S]*?\{/, '{').replace(/\}[^}]*$/, '}'));
  } catch (e) { throw new Error('AI-svaret kunne ikke læses som en opskrift'); }
  if (j.error) throw new Error(j.error);
  if (!j.title || !Array.isArray(j.ingredients)) throw new Error('AI fandt ingen opskrift på siden');
  return {
    title: j.title, description: j.description || '', servings: j.servings || null,
    prepMin: j.prepMin || null, cookMin: j.cookMin || null,
    ingredients: j.ingredients.map(String), instructions: (j.instructions || []).map(String),
    category: j.category || '', url: sourceUrl || ''
  };
}

/* ---------------- indkoebsliste fra opskrift ---------------- */
/* springer varer over, der ligger i forraadet, gaetter afdeling og laegger
 * ens varer sammen med det, der allerede staar paa listen */
async function addRecipeToShopping(r, factor) {
  const lines = (r.ingredients || []).filter(l => !/^##/.test(l));
  if (!lines.length) return toast('Opskriften har ingen ingredienser', true);
  let skipped = 0;
  const items = [];
  for (const l of lines) {
    const text = scaleIngredient(l, factor || 1);
    if (inPantry(text)) { skipped++; continue; }
    items.push({
      id: uid(), kind: 'shopItem', text, group: r.title,
      section: guessSection(text), done: false, createdAt: new Date().toISOString()
    });
  }
  if (items.length) await saveBulk(items);
  const merged = await mergeShoppingItems();
  toast(`${items.length} varer føjet til listen` +
    (skipped ? ` · ${skipped} sprunget over (i forråd)` : '') +
    (merged ? ` · ${merged} lagt sammen` : ''));
  renderNav();
}

/* ---------------- kogetilstand ---------------- */
const CM = { recipe: null, step: 0, wakeWasOn: false, checked: new Set() };

function openCookMode(r) {
  CM.recipe = r;
  CM.step = 0;
  CM.checked = new Set();
  CM.wakeWasOn = S.wakeOn;
  if (!S.wakeOn) setWakeLock(true); // skaermen skal ikke slukke midt i madlavningen
  drawCookMode();
  $('#cookMode').hidden = false;
}
function closeCookMode() {
  $('#cookMode').hidden = true;
  $('#cookMode').innerHTML = '';
  if (!CM.wakeWasOn && S.wakeOn) setWakeLock(false);
  CM.recipe = null;
}
/* aktive timere som stribe oeverst i kogetilstanden.
 * Bruger samme [data-timerid]/.ttime-kontrakt som timer-motoren, saa
 * nedtaellingen opdateres uden at hele kogetilstanden gentegnes. */
function cookTimersHtml() {
  if (!S.timers.length) return '';
  return S.timers.map(t => `
    <button class="cmtimer${t.ringing ? ' ringing' : ''}${t.paused ? ' paused' : ''}" data-timerid="${t.id}"
      data-cmtimer="${t.id}" title="${t.ringing ? 'Klik for at stoppe alarmen' : 'Klik for at pause/fortsætte'}">
      <span>${t.ringing ? '⏰' : t.paused ? '⏸' : '⏱'}</span>
      <span class="tlbl">${esc(t.label)}</span>
      <span class="ttime">${t.ringing ? '0:00' : fmtTimer(timerRemainMs(t))}</span>
    </button>`).join('');
}
function refreshCookTimers() {
  const host = $('#cmTimers');
  if (!host) return;
  host.innerHTML = cookTimersHtml();
  bindCookTimers();
}
function bindCookTimers() {
  $$('[data-cmtimer]').forEach(b => b.onclick = () => {
    const t = S.timers.find(x => x.id === b.dataset.cmtimer);
    if (!t) return;
    if (t.ringing) S.timers = S.timers.filter(x => x.id !== t.id);
    else if (t.paused) { t.endsAt = Date.now() + t.remainMs; t.remainMs = null; t.paused = false; }
    else { t.remainMs = timerRemainMs(t); t.paused = true; }
    saveTimers();
    refreshCookTimers();
    renderNav();
  });
}

function drawCookMode() {
  const r = CM.recipe;
  const steps = (r.instructions || []).filter(s => !/^##/.test(s));
  const factor = (S.detailServings || r.servings || 1) / (r.servings || S.detailServings || 1);
  const step = steps[CM.step] || '';
  $('#cookMode').innerHTML = `
    <div class="cmhead">
      <h2>👨‍🍳 ${esc(r.title)}</h2>
      <button class="chip chipbtn${S.wakeOn ? ' on' : ''}" id="cmWake" style="${S.wakeOn ? '' : 'color:var(--red);border-color:var(--red)'}">
        ${S.wakeOn ? '📱 skærmen holdes tændt' : '📴 skærmen holdes IKKE tændt'}</button>
      <button class="btn" id="cmTimer">⏱️ Timer</button>
      <button class="btn" id="cmClose">✕ Luk</button>
    </div>
    <div class="cmtimers" id="cmTimers">${cookTimersHtml()}</div>
    <div class="cmbody">
      <div class="cmings">
        <h3 style="margin-top:0">Ingredienser <span class="muted small">(kryds af undervejs)</span></h3>
        <ul>${(r.ingredients || []).map((line, i) => {
          if (/^##\s*/.test(line)) return `<li style="border:0;font-weight:700;color:var(--amber);padding-top:12px">${esc(line.replace(/^##\s*/, ''))}</li>`;
          return `<li><label class="chk cmck${CM.checked.has(i) ? ' done' : ''}">
            <input type="checkbox" data-cmck="${i}" ${CM.checked.has(i) ? 'checked' : ''}>
            <span>${esc(scaleIngredient(line, factor))}</span></label></li>`;
        }).join('')}</ul>
      </div>
      <div>
        <div class="cmstepnum">Trin ${CM.step + 1} af ${steps.length}</div>
        <div class="cmstep">${linkifyTimers(esc(step))}</div>
      </div>
    </div>
    <div class="cmfoot">
      <button class="btn" id="cmPrev" ${CM.step === 0 ? 'disabled' : ''}>← Forrige</button>
      <div class="cmprogress">${steps.map((_, i) => i === CM.step ? '●' : '○').join(' ')}</div>
      ${CM.step < steps.length - 1
        ? '<button class="btn primary" id="cmNext">Næste →</button>'
        : '<button class="btn primary" id="cmDone">✓ Færdig</button>'}
    </div>`;
  $('#cmClose').onclick = closeCookMode;
  $('#cmWake').onclick = () => setWakeLock(!S.wakeOn);
  $('#cmTimer').onclick = () => newTimerModal(r.title);
  bindCookTimers();
  $$('[data-cmck]').forEach(cb => cb.onchange = () => {
    const i = +cb.dataset.cmck;
    if (cb.checked) CM.checked.add(i); else CM.checked.delete(i);
    cb.closest('label').classList.toggle('done', cb.checked);
  });
  $('#cmPrev').onclick = () => { if (CM.step > 0) { CM.step--; drawCookMode(); } };
  const next = $('#cmNext');
  if (next) next.onclick = () => { CM.step++; drawCookMode(); };
  const done = $('#cmDone');
  if (done) done.onclick = async () => {
    CM.recipe.timesCooked = (CM.recipe.timesCooked || 0) + 1;
    CM.recipe.lastCooked = isoDate();
    await saveItem(CM.recipe, true);
    closeCookMode();
    toast('Velbekomme! 🍽️');
    render();
  };
  bindInlineTimers(r.title);
}
document.addEventListener('keydown', e => {
  if ($('#cookMode').hidden || $('#modalHost').innerHTML) return;
  if (e.key === 'ArrowRight') { const b = $('#cmNext'); if (b) b.click(); }
  else if (e.key === 'ArrowLeft') { const b = $('#cmPrev'); if (b && !b.disabled) b.click(); }
  else if (e.key === 'Escape') closeCookMode();
});

/* ---------------- Madplan (uge-visning) ---------------- */

function weekDatesOf(monday) { return [...Array(7)].map((_, i) => addDays(monday, i)); }

/* maaltids-typer; gamle entries uden slot regnes som aftensmad */
const SLOTS = [
  { id: 'breakfast', label: 'Morgenmad', ico: '🌅' },
  { id: 'lunch',     label: 'Frokost',   ico: '🥪' },
  { id: 'dinner',    label: 'Aftensmad', ico: '' },
  { id: 'other',     label: 'Andet',     ico: '📌' }
];
const slotOf = e => e.slot || 'dinner';
const slotOrder = id => SLOTS.findIndex(s => s.id === id);
const slotInfo = id => SLOTS.find(s => s.id === id) || SLOTS[2];

RENDER.plan = () => {
  const monday = S.weekStart || mondayOf();
  const dates = weekDatesOf(monday);
  const today = isoDate();
  const entriesByDate = {};
  for (const e of K('planEntry')) (entriesByDate[e.date] = entriesByDate[e.date] || []).push(e);

  return pageHead('Madplan', `Uge ${isoWeekNo(monday)} · ${fmtDate(monday)} – ${fmtDate(dates[6])}`,
      `<div class="rowflex">
        <button class="btn" id="wkPrev">←</button>
        <button class="btn" id="wkToday">I dag</button>
        <button class="btn" id="wkNext">→</button>
        <button class="btn" id="wkShop">🛒 Indkøbsliste for ugen</button>
        <button class="btn" id="wkPrint">🖨️ Print</button>
        <button class="btn" id="wkFill">📖 Udfyld fra biblioteket</button>
        <button class="btn" id="wkSaveMenu">💾 Gem som skabelon</button>
        <button class="btn" id="wkApplyMenu" ${K('menu').length ? '' : 'disabled'}>📋 Skabeloner…</button>
        ${S.settings.aiKeySet ? '<button class="btn primary" id="wkAi">✨ Foreslå madplan (AI)</button>' : ''}
      </div>`) + `
  <div class="weekgrid">
    ${dates.map((d, i) => `
      <div class="daycol${d === today ? ' today' : ''}" data-date="${d}">
        <div class="dhead">${WEEKDAYS_DA[i]} <span style="float:right;font-weight:400">${d.slice(8)}/${+d.slice(5, 7)}</span></div>
        ${(entriesByDate[d] || []).slice().sort((a, b) => slotOrder(slotOf(a)) - slotOrder(slotOf(b))).map(e => {
          const r = e.recipeId ? recipeById(e.recipeId) : null;
          const si = slotInfo(slotOf(e));
          const slotTag = slotOf(e) !== 'dinner' ? `<span class="muted">${si.ico} ${si.label} · </span>` : '';
          return `<div class="planentry" data-entry="${e.id}" draggable="true">
            ${slotTag}${r ? esc(r.title) : esc(e.text || '')}
            ${r && recipeTotalMin(r) ? `<div class="pmeta">⏱ ${fmtMin(recipeTotalMin(r))}${e.servings ? ' · ' + e.servings + ' pers.' : ''}</div>` : (e.servings ? `<div class="pmeta">${e.servings} pers.</div>` : '')}
          </div>`;
        }).join('')}
        <button class="dayadd" data-date="${d}">+ tilføj</button>
      </div>`).join('')}
  </div>
  <p class="small muted">Træk en ret til en anden dag for at flytte den – ligger der allerede noget, bytter de plads.
  Madplanen kan abonneres i din kalender-app – find iCal-linket under Indstillinger.</p>`;
};
RENDER.plan_bind = () => {
  $('#wkPrev').onclick = () => { S.weekStart = addDays(S.weekStart || mondayOf(), -7); render(); };
  $('#wkNext').onclick = () => { S.weekStart = addDays(S.weekStart || mondayOf(), 7); render(); };
  $('#wkToday').onclick = () => { S.weekStart = mondayOf(); render(); };
  $('#wkShop').onclick = weekToShopping;
  $('#wkPrint').onclick = printWeekPlan;
  $('#wkFill').onclick = autoFillWeek;
  $('#wkSaveMenu').onclick = saveWeekAsMenu;
  $('#wkApplyMenu').onclick = menuListModal;
  const ai = $('#wkAi');
  if (ai) ai.onclick = aiSuggestWeek;
  $$('.dayadd').forEach(b => b.onclick = () => planEntryModal(null, { date: b.dataset.date }));
  $$('.planentry[data-entry]').forEach(el => {
    el.onclick = () => {
      const e = K('planEntry').find(x => x.id === el.dataset.entry);
      if (e) planEntryModal(e);
    };
    el.ondragstart = ev => {
      ev.dataTransfer.setData('text/plain', el.dataset.entry);
      ev.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    };
    el.ondragend = () => el.classList.remove('dragging');
  });
  $$('.daycol[data-date]').forEach(col => {
    col.ondragover = ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; col.classList.add('dropover'); };
    col.ondragleave = ev => { if (!col.contains(ev.relatedTarget)) col.classList.remove('dropover'); };
    col.ondrop = ev => {
      ev.preventDefault();
      col.classList.remove('dropover');
      movePlanEntry(ev.dataTransfer.getData('text/plain'), col.dataset.date);
    };
  });
};

/* flyt en madplan-linje til en anden dag; ligger der allerede noget paa
 * maaldagen I SAMME maaltid, bytter de plads (de fortraengte ryger til den
 * dag, der traekkes fra) - morgenmad fortraenger ikke aftensmad */
async function movePlanEntry(entryId, toDate) {
  const e = K('planEntry').find(x => x.id === entryId);
  if (!e || !toDate || e.date === toDate) return;
  const fromDate = e.date;
  const displaced = K('planEntry').filter(x =>
    x.date === toDate && x.id !== e.id && slotOf(x) === slotOf(e));
  e.date = toDate;
  displaced.forEach(x => { x.date = fromDate; });
  await saveBulk([e, ...displaced]);
  toast(displaced.length ? 'Byttet om 🔄' : 'Flyttet til ' + fmtDate(toDate));
  render();
}

/* ---------------- skabeloner (genbrugelige uge-menuer) ---------------- */
async function saveWeekAsMenu() {
  const monday = S.weekStart || mondayOf();
  const dates = weekDatesOf(monday);
  const entries = K('planEntry').filter(e => dates.includes(e.date));
  if (!entries.length) return toast('Ugen er tom – der er intet at gemme', true);
  openModal(`<h2>💾 Gem ugen som skabelon</h2>
    <p class="small muted">Skabelonen gemmer ugedag + måltid + ret (${entries.length} linjer) og kan
    lægges ind i en hvilken som helst uge bagefter.</p>
    <label class="fld"><span>Navn</span><input id="menuName" placeholder="fx Hverdagsuge eller Sommeruge" maxlength="60"></label>
    <div class="actions">
      <button class="btn" id="menuCancel">Annullér</button>
      <button class="btn primary" id="menuSave">Gem skabelon</button>
    </div>`, m => {
    m.querySelector('#menuName').focus();
    m.querySelector('#menuCancel').onclick = closeModal;
    m.querySelector('#menuSave').onclick = async () => {
      const title = m.querySelector('#menuName').value.trim();
      if (!title) return toast('Giv skabelonen et navn', true);
      const menu = {
        id: uid(), kind: 'menu', title, createdAt: new Date().toISOString(),
        entries: entries.map(e => ({
          wd: (new Date(e.date + 'T00:00:00').getDay() + 6) % 7,
          slot: slotOf(e), recipeId: e.recipeId || '', text: e.text || '', servings: e.servings || null
        }))
      };
      closeModal();
      await saveItem(menu);
      render();
    };
  });
}

function menuListModal() {
  const menus = K('menu').slice().sort((a, b) => String(a.title).localeCompare(String(b.title), 'da'));
  if (!menus.length) return toast('Ingen skabeloner endnu – gem først en uge', true);
  openModal(`<h2>📋 Madplan-skabeloner</h2>
    <p class="small muted">Lægges ind i den viste uge. Dage/måltider, der allerede er udfyldt, springes over.</p>
    <table class="data"><tbody>
      ${menus.map(mn => `<tr>
        <td><b>${esc(mn.title)}</b><div class="small muted">${mn.entries.length} linjer:
          ${esc(mn.entries.slice(0, 4).map(e => e.recipeId ? (recipeById(e.recipeId) || {}).title || '(slettet)' : e.text).join(', '))}${mn.entries.length > 4 ? ' …' : ''}</div></td>
        <td class="right nowrap">
          <button class="btn small primary" data-apply="${mn.id}">Læg ind i ugen</button>
          <button class="iconbtn" data-mdel="${mn.id}" title="Slet skabelon">✕</button>
        </td></tr>`).join('')}
    </tbody></table>
    <div class="actions"><button class="btn" id="menuClose">Luk</button></div>`, m => {
    m.querySelector('#menuClose').onclick = closeModal;
    m.querySelectorAll('[data-apply]').forEach(b => b.onclick = () => applyMenu(b.dataset.apply));
    m.querySelectorAll('[data-mdel]').forEach(b => b.onclick = async () => {
      const mn = K('menu').find(x => x.id === b.dataset.mdel);
      if (mn && await confirmBox(`Slet skabelonen "${mn.title}"?`)) {
        await deleteItem(mn);
        closeModal();
        render();
      }
    });
  });
}

async function applyMenu(menuId) {
  const mn = K('menu').find(x => x.id === menuId);
  if (!mn) return;
  const monday = S.weekStart || mondayOf();
  const items = [];
  let skipped = 0;
  for (const e of mn.entries) {
    const date = addDays(monday, e.wd);
    if (e.recipeId && !recipeById(e.recipeId)) { skipped++; continue; } // opskriften er slettet
    if (K('planEntry').some(x => x.date === date && slotOf(x) === (e.slot || 'dinner'))) { skipped++; continue; }
    items.push({
      id: uid(), kind: 'planEntry', date, slot: e.slot || 'dinner',
      recipeId: e.recipeId || '', text: e.text || '', servings: e.servings || null
    });
  }
  if (!items.length) {
    toast('Alt i skabelonen var allerede udfyldt' + (skipped ? ` (${skipped} sprunget over)` : ''), true);
    return;
  }
  await saveBulk(items);
  closeModal();
  toast(`Skabelonen "${mn.title}" lagt ind – ${items.length} måltider` + (skipped ? `, ${skipped} sprunget over` : ''));
  render();
}

/* fyld ugens tomme dage med opskrifter fra biblioteket - uden AI.
 * Vaegtet lodtraekning: favoritter og hoejt vurderede traekkes oftere, og
 * samme ret kommer ikke paa to dage i samme uge (medmindre biblioteket er lille). */
async function autoFillWeek() {
  const monday = S.weekStart || mondayOf();
  const dates = weekDatesOf(monday);
  const free = dates.filter(d => !K('planEntry').some(e => e.date === d && slotOf(e) === 'dinner'));
  if (!free.length) return toast('Alle ugens dage har allerede noget på madplanen', true);
  const recipes = K('recipe');
  if (!recipes.length) return toast('Biblioteket er tomt – tilføj nogle opskrifter først', true);

  const usedIds = new Set(K('planEntry').filter(e => dates.includes(e.date) && e.recipeId).map(e => e.recipeId));
  const weight = r => 1 + (r.rating || 0) + (r.favorite ? 3 : 0);
  let pool = recipes.filter(r => !usedIds.has(r.id));

  const draw = () => {
    if (!pool.length) pool = recipes.slice(); // lille bibliotek: genbrug fremfor at stoppe
    let sum = pool.reduce((a, r) => a + weight(r), 0);
    let x = Math.random() * sum;
    for (let i = 0; i < pool.length; i++) {
      x -= weight(pool[i]);
      if (x <= 0) return pool.splice(i, 1)[0];
    }
    return pool.pop();
  };

  const items = free.map(d => ({
    id: uid(), kind: 'planEntry', date: d, slot: 'dinner', recipeId: draw().id, text: '', servings: null
  }));
  await saveBulk(items);
  toast(`${items.length} dage udfyldt – træk retterne rundt, som du vil`);
  render();
}

function planEntryModal(entry, prefill) {
  const isNew = !entry;
  const d = entry || Object.assign({
    id: uid(), kind: 'planEntry', date: isoDate(), slot: 'dinner', recipeId: '', text: '', servings: null
  }, prefill || {});

  openModal(`<h2>${isNew ? 'Tilføj til madplan' : 'Redigér madplan'}</h2>
    <div class="formgrid">
      <label class="fld"><span>Dato</span><input id="pmDate" type="date" value="${esc(d.date)}"></label>
      <label class="fld"><span>Måltid</span><select id="pmSlot">
        ${SLOTS.map(s => `<option value="${s.id}"${slotOf(d) === s.id ? ' selected' : ''}>${s.ico} ${s.label}</option>`).join('')}
      </select></label>
      <label class="fld"><span>Personer (valgfrit)</span><input id="pmServ" type="number" min="1" value="${d.servings || ''}"></label>
    </div>
    <label class="fld"><span>Opskrift fra biblioteket</span><select id="pmRec">${recipeOptions(d.recipeId)}</select></label>
    <label class="fld"><span>… eller fritekst (fx "Rester" eller "Pizza ude i byen")</span>
      <input id="pmText" value="${esc(d.text || '')}"></label>
    <div class="actions">
      ${isNew ? '' : '<button class="btn danger" id="pmDelete" style="margin-right:auto">Fjern</button>'}
      <button class="btn" id="pmCancel">Annullér</button>
      <button class="btn primary" id="pmSave">Gem</button>
    </div>`, m => {
    m.querySelector('#pmCancel').onclick = closeModal;
    if (!isNew) m.querySelector('#pmDelete').onclick = async () => {
      closeModal();
      await deleteItem(d);
      render();
    };
    m.querySelector('#pmSave').onclick = async () => {
      d.date = m.querySelector('#pmDate').value;
      if (!d.date) return toast('Vælg en dato', true);
      d.slot = m.querySelector('#pmSlot').value;
      d.recipeId = m.querySelector('#pmRec').value;
      d.text = m.querySelector('#pmText').value.trim();
      if (!d.recipeId && !d.text) return toast('Vælg en opskrift eller skriv en tekst', true);
      d.servings = parseInt(m.querySelector('#pmServ').value, 10) || null;
      closeModal();
      await saveItem(d);
      if (S.view !== 'plan') toast('Sat på madplanen ' + fmtDate(d.date));
      render();
    };
  });
}

/* hele ugens opskrifter -> indkoebsliste (skaleret efter personer) */
async function weekToShopping() {
  const dates = weekDatesOf(S.weekStart || mondayOf());
  const entries = K('planEntry').filter(e => dates.includes(e.date) && e.recipeId);
  if (!entries.length) return toast('Ugen har ingen opskrifter på madplanen', true);
  const items = [];
  let skipped = 0;
  for (const e of entries) {
    const r = recipeById(e.recipeId);
    if (!r) continue;
    const factor = e.servings && r.servings ? e.servings / r.servings : 1;
    for (const l of (r.ingredients || []).filter(l => !/^##/.test(l))) {
      const text = scaleIngredient(l, factor);
      if (inPantry(text)) { skipped++; continue; }
      items.push({
        id: uid(), kind: 'shopItem', text, group: r.title,
        section: guessSection(text), done: false, createdAt: new Date().toISOString()
      });
    }
  }
  if (items.length) await saveBulk(items);
  const merged = await mergeShoppingItems();
  toast(`${items.length} varer føjet til listen` +
    (skipped ? ` · ${skipped} i forråd` : '') + (merged ? ` · ${merged} lagt sammen` : ''));
  goto('shopping');
}

function printWeekPlan() {
  const monday = S.weekStart || mondayOf();
  const dates = weekDatesOf(monday);
  printSheet(`${printLogoHtml()}
    <h1>Madplan – uge ${isoWeekNo(monday)}</h1>
    <table><tbody>
    ${dates.map((d, i) => {
      const entries = K('planEntry').filter(e => e.date === d);
      return `<tr><td style="width:130px"><b>${WEEKDAYS_DA[i]}</b><br>${fmtDate(d)}</td>
        <td>${entries.slice().sort((a, b) => slotOrder(slotOf(a)) - slotOrder(slotOf(b))).map(e => {
          const r = e.recipeId ? recipeById(e.recipeId) : null;
          const pre = slotOf(e) !== 'dinner' ? slotInfo(slotOf(e)).label + ': ' : '';
          return pre + esc(r ? r.title : e.text || '') + (e.servings ? ` (${e.servings} pers.)` : '');
        }).join('<br>') || '&nbsp;'}</td></tr>`;
    }).join('')}
    </tbody></table>
    <p class="pdate">Printet ${fmtDate(isoDate())}</p>`);
}

/* ---------------- AI: foreslaa en uge-madplan ---------------- */
async function aiSuggestWeek() {
  const monday = S.weekStart || mondayOf();
  const dates = weekDatesOf(monday);
  const free = dates.filter(d => !K('planEntry').some(e => e.date === d && slotOf(e) === 'dinner'));
  if (!free.length) return toast('Alle ugens dage har allerede noget på madplanen', true);
  const recipes = K('recipe');
  if (recipes.length < 2) return toast('Tilføj nogle opskrifter først, så AI\'en har noget at vælge imellem', true);

  toast('AI\'en sammensætter en madplan …');
  const list = recipes.map(r => ({
    id: r.id, title: r.title, category: r.category || '',
    min: recipeTotalMin(r),
    rating: r.rating || 0, lastCooked: r.lastCooked || null
  }));
  const sys = `Du sammensætter en ugentlig aftensmads-plan ud fra brugerens egne opskrifter.
Vælg varieret (ikke to ens retter i træk, bland kategorier), foretræk højt vurderede opskrifter og
retter der ikke er lavet for nylig. Hverdagsretter bør være hurtige; weekend må gerne tage længere tid.
Svar KUN med JSON: [{"date": "YYYY-MM-DD", "recipeId": "..."}] – én pr. dato, brug KUN de givne datoer og recipeId'er.`;
  try {
    const r = await api('/api/ai', {
      body: {
        system: sys,
        messages: [{ role: 'user', content: `Datoer der skal fyldes: ${free.join(', ')}\n\nOpskrifter:\n` + JSON.stringify(list) }],
        maxTokens: 2048
      }
    });
    let plan;
    try { plan = JSON.parse(String(r.text).replace(/^[\s\S]*?\[/, '[').replace(/\][^\]]*$/, ']')); }
    catch (e) { throw new Error('AI-svaret kunne ikke læses'); }
    const items = [];
    for (const p of plan) {
      if (!free.includes(p.date) || !recipeById(p.recipeId)) continue;
      if (items.some(i => i.date === p.date)) continue;
      items.push({ id: uid(), kind: 'planEntry', date: p.date, slot: 'dinner', recipeId: p.recipeId, text: '', servings: null });
    }
    if (!items.length) throw new Error('AI\'en foreslog ingen brugbare dage');
    await saveBulk(items);
    toast(`Madplan foreslået for ${items.length} dage – ret til som du vil`);
    render();
  } catch (e) {
    toast('Kunne ikke lave madplan: ' + e.message, true);
  }
}

/* ---------------- Indkøbsliste ---------------- */
/* Grupperes pr. butiksafdeling (standard) eller pr. opskrift. Afdelingen
 * gaettes regelbaseret ved tilfoejelse; AI kan sortere resten. */

function shopSectionOf(i) { return i.section || guessSection(i.text) || 'Andet'; }
function shopGroupBy() {
  try { return localStorage.getItem('kk_shopgroup') || 'section'; } catch (e) { return 'section'; }
}

RENDER.shopping = () => {
  const bySection = shopGroupBy() === 'section';
  const items = K('shopItem').slice();
  const keyOf = i => bySection ? shopSectionOf(i) : (i.group || 'Andet');
  const sortKey = i => bySection
    ? String(SHOP_SECTIONS.indexOf(shopSectionOf(i))).padStart(2, '0')
    : (i.group || 'zzz');
  items.sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'da') ||
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const open = items.filter(i => !i.done), done = items.filter(i => i.done);
  const unsorted = open.filter(i => !i.section && !guessSection(i.text)).length;

  const listHtml = arr => {
    let out = '', lastGroup = null;
    for (const i of arr) {
      const g = keyOf(i);
      if (g !== lastGroup) { out += `<li class="shopgroup">${esc(g)}</li>`; lastGroup = g; }
      out += `<li class="${i.done ? 'done' : ''}" data-shop="${i.id}">
        <input type="checkbox" ${i.done ? 'checked' : ''}>
        <span class="txt">${esc(i.text)}</span>
        ${bySection && i.group ? `<span class="muted small nowrap">${esc(i.group)}</span>` : ''}
        <button class="iconbtn" data-del="${i.id}" title="Fjern">✕</button>
      </li>`;
    }
    return out;
  };

  const pantry = K('pantryItem').slice().sort((a, b) =>
    String(a.expires || '9999').localeCompare(String(b.expires || '9999')) ||
    String(a.text).localeCompare(String(b.text), 'da'));
  const soon = addDays(isoDate(), 7);

  return pageHead('Indkøbsliste', `${open.length} varer mangler`,
      `<div class="rowflex">
        <button class="btn" id="shopPrint">🖨️ Print</button>
        <button class="btn" id="shopMerge" ${open.length > 1 ? '' : 'disabled'}>🧮 Læg ens varer sammen</button>
        ${S.settings.aiKeySet && unsorted ? `<button class="btn" id="shopAiSort">✨ Sortér ${unsorted} med AI</button>` : ''}
        ${S.settings.haSet ? '<button class="btn" id="shopHa">🏠 Send til Home Assistant</button>' : ''}
        ${S.settings.todoistSet ? '<button class="btn" id="shopTd">✅ Send til Todoist</button>' : ''}
        <button class="btn" id="shopClearDone" ${done.length ? '' : 'disabled'}>Ryd afkrydsede</button>
        <button class="btn danger" id="shopClearAll" ${items.length ? '' : 'disabled'}>Tøm listen</button>
      </div>`) + `
  <div class="rowflex" style="margin-bottom:4px">
    <span class="chip chipbtn${bySection ? ' sel' : ''}" data-grp="section">Pr. afdeling</span>
    <span class="chip chipbtn${bySection ? '' : ' sel'}" data-grp="recipe">Pr. opskrift</span>
  </div>
  <div class="panelbox">
    <div class="rowflex">
      <input id="shopNew" placeholder="Tilføj vare – fx 2 L mælk" style="flex:1;min-width:200px">
      <button class="btn primary" id="shopAdd">Tilføj</button>
    </div>
    <ul class="shoplist">${listHtml(open) || '<li class="muted" style="border:0">Listen er tom 🎉</li>'}</ul>
    ${done.length ? `<h3 class="muted">Afkrydset (${done.length})</h3><ul class="shoplist">${listHtml(done)}</ul>` : ''}
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">🏺 Forråd <span class="muted small">– varer du har hjemme, springes over på indkøbslisten</span></h2>
    <div class="rowflex">
      <input id="pantryNew" placeholder="fx pasta, olivenolie, hvidløg …" style="flex:1;min-width:180px">
      <input id="pantryExp" type="date" title="Udløbsdato (valgfri)">
      <button class="btn" id="pantryAdd">Tilføj til forråd</button>
    </div>
    ${pantry.length ? `<ul class="shoplist">${pantry.map(p => `
      <li data-pantry="${p.id}">
        <span class="txt" style="cursor:default">${esc(p.text)}</span>
        ${p.expires ? `<span class="small nowrap ${p.expires < isoDate() ? 'warn' : p.expires <= soon ? '' : 'muted'}"
          style="${p.expires <= soon && p.expires >= isoDate() ? 'color:var(--amber)' : ''}">
          ${p.expires < isoDate() ? '⚠️ udløbet ' : 'udløber '}${fmtDate(p.expires)}</span>` : ''}
        <button class="iconbtn" data-pdel="${p.id}" title="Fjern">✕</button>
      </li>`).join('')}</ul>`
    : '<p class="small muted" style="margin-bottom:0">Forrådet er tomt. Tilføj basisvarer som salt, olie og pasta, så ryger de ikke med på indkøbslisten hver gang.</p>'}
  </div>`;
};

RENDER.shopping_bind = () => {
  $$('[data-grp]').forEach(c => c.onclick = () => {
    try { localStorage.setItem('kk_shopgroup', c.dataset.grp); } catch (e) {}
    render();
  });

  const add = async () => {
    const el = $('#shopNew');
    const text = el.value.trim();
    if (!text) return;
    await saveItem({
      id: uid(), kind: 'shopItem', text, group: '', section: guessSection(text),
      done: false, createdAt: new Date().toISOString()
    }, true);
    render();
    setTimeout(() => { const n = $('#shopNew'); if (n) n.focus(); }, 30);
  };
  $('#shopAdd').onclick = add;
  $('#shopNew').onkeydown = e => { if (e.key === 'Enter') add(); };

  $$('[data-shop]').forEach(li => {
    const it = K('shopItem').find(x => x.id === li.dataset.shop);
    if (!it) return;
    const toggle = async () => { it.done = !it.done; await saveItem(it, true); render(); };
    li.querySelector('input').onchange = toggle;
    li.querySelector('.txt').onclick = toggle;
  });
  $$('[data-del]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const it = K('shopItem').find(x => x.id === b.dataset.del);
    if (it) { it.deleted = true; await saveItem(it, true); render(); }
  });

  $('#shopMerge').onclick = async () => {
    const n = await mergeShoppingItems();
    toast(n ? `${n} varer lagt sammen` : 'Ingen ens varer at lægge sammen');
    render();
  };
  const aiSort = $('#shopAiSort');
  if (aiSort) aiSort.onclick = () => aiSortSections(aiSort);
  const ha = $('#shopHa');
  if (ha) ha.onclick = async () => {
    ha.disabled = true;
    ha.textContent = '🏠 Sender …';
    try {
      const r = await api('/api/ha/push-shopping', { body: {} });
      toast(`${r.pushed} varer sendt til Home Assistant` + (r.failed ? ` (${r.failed} fejlede)` : ''));
    } catch (e) { toast(e.message, true); }
    render();
  };
  const td = $('#shopTd');
  if (td) td.onclick = async () => {
    td.disabled = true;
    td.textContent = '✅ Sender …';
    try {
      const r = await api('/api/todoist/push-shopping', { body: {} });
      toast(`${r.pushed} varer sendt til Todoist` + (r.failed ? ` (${r.failed} fejlede)` : ''));
    } catch (e) { toast(e.message, true); }
    render();
  };

  $('#shopClearDone').onclick = async () => {
    const done = K('shopItem').filter(i => i.done);
    await saveBulk(done.map(i => Object.assign(i, { deleted: true })));
    render();
  };
  $('#shopClearAll').onclick = async () => {
    if (!await confirmBox('Tøm hele indkøbslisten?', 'Tøm')) return;
    await saveBulk(K('shopItem').map(i => Object.assign(i, { deleted: true })));
    render();
  };
  $('#shopPrint').onclick = printShoppingList;

  /* forraad */
  const pAdd = async () => {
    const text = $('#pantryNew').value.trim();
    if (!text) return;
    await saveItem({
      id: uid(), kind: 'pantryItem', text, expires: $('#pantryExp').value || '',
      createdAt: new Date().toISOString()
    }, true);
    render();
    setTimeout(() => { const n = $('#pantryNew'); if (n) n.focus(); }, 30);
  };
  $('#pantryAdd').onclick = pAdd;
  $('#pantryNew').onkeydown = e => { if (e.key === 'Enter') pAdd(); };
  $$('[data-pdel]').forEach(b => b.onclick = async () => {
    const p = K('pantryItem').find(x => x.id === b.dataset.pdel);
    if (p) { p.deleted = true; await saveItem(p, true); render(); }
  });
};

function printShoppingList() {
  const bySection = shopGroupBy() === 'section';
  const items = K('shopItem').filter(i => !i.done);
  const keyOf = i => bySection ? shopSectionOf(i) : (i.group || 'Andet');
  const sortKey = i => bySection
    ? String(SHOP_SECTIONS.indexOf(shopSectionOf(i))).padStart(2, '0') : (i.group || 'zzz');
  let lastGroup = null, rows = '';
  for (const i of items.slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'da'))) {
    const g = keyOf(i);
    if (g !== lastGroup) { rows += `<h2>${esc(g)}</h2>`; lastGroup = g; }
    rows += `<p style="margin:2px 0">☐ ${esc(i.text)}</p>`;
  }
  printSheet(`${printLogoHtml()}<h1>Indkøbsliste</h1>${rows}<p class="pdate">${fmtDate(isoDate())}</p>`);
}

/* AI saetter afdeling paa de varer, reglerne ikke kender */
async function aiSortSections(btn) {
  const unknown = K('shopItem').filter(i => !i.done && !i.section && !guessSection(i.text));
  if (!unknown.length) return;
  btn.disabled = true;
  btn.textContent = '✨ Sorterer …';
  try {
    const sys = `Du sorterer dagligvarer i supermarkeds-afdelinger. Svar KUN med ét JSON-objekt der
mapper hver vare til præcis én af disse afdelinger: ${JSON.stringify(SHOP_SECTIONS)}.
Format: {"vare-tekst": "afdeling", ...}`;
    const r = await api('/api/ai', {
      body: { system: sys, messages: [{ role: 'user', content: JSON.stringify(unknown.map(i => i.text)) }], maxTokens: 1500 }
    });
    let map;
    try { map = JSON.parse(String(r.text).replace(/^[\s\S]*?\{/, '{').replace(/\}[^}]*$/, '}')); }
    catch (e) { throw new Error('AI-svaret kunne ikke læses'); }
    const changed = [];
    for (const it of unknown) {
      const sec = map[it.text];
      if (SHOP_SECTIONS.includes(sec)) { it.section = sec; changed.push(it); }
    }
    if (changed.length) await saveBulk(changed);
    toast(`${changed.length} varer sorteret i afdelinger`);
  } catch (e) {
    toast('Kunne ikke sortere: ' + e.message, true);
  }
  render();
}
/* ---------------- Timere ---------------- */
/* Timerne lever i localStorage (kk_timers), saa de overlever en genindlaesning.
 * {id, label, totalMs, endsAt (epoch-ms), remainMs (ved pause), paused, ringing} */

function loadTimers() {
  try { S.timers = JSON.parse(localStorage.getItem('kk_timers') || '[]'); } catch (e) { S.timers = []; }
  if (!Array.isArray(S.timers)) S.timers = [];
}
function saveTimers() {
  try { localStorage.setItem('kk_timers', JSON.stringify(S.timers)); } catch (e) {}
}

function startTimer(ms, label) {
  S.timers.push({
    id: uid(), label: label || 'Timer', totalMs: ms,
    endsAt: Date.now() + ms, remainMs: null, paused: false, ringing: false
  });
  saveTimers();
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  if (S.view === 'timers') render(); else renderNav();
  refreshCookTimers();
}
function timerRemainMs(t) {
  return t.paused ? t.remainMs : Math.max(0, t.endsAt - Date.now());
}
function fmtTimer(ms) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}

/* ---- alarmlyd (WebAudio, ingen filer) ---- */
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const now = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, now + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.3, now + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.2);
      o.connect(g).connect(audioCtx.destination);
      o.start(now + i * 0.25);
      o.stop(now + i * 0.25 + 0.22);
    }
  } catch (e) {}
}

let timerEngineStarted = false;
function startTimerEngine() {
  if (timerEngineStarted) return;
  timerEngineStarted = true;
  setInterval(() => {
    let changed = false, anyRinging = false;
    for (const t of S.timers) {
      if (!t.paused && !t.ringing && Date.now() >= t.endsAt) {
        t.ringing = true;
        changed = true;
        toast('⏰ ' + t.label + ' er færdig!');
        if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification('⏰ ' + t.label, { body: 'Timeren er færdig' }); } catch (e) {}
        }
      }
      if (t.ringing) anyRinging = true;
    }
    if (anyRinging && Math.floor(Date.now() / 1000) % 2 === 0) beep();
    if (changed) {
      saveTimers();
      if (S.view === 'timers' || S.view === 'dash') render(); else renderNav();
      refreshCookTimers();
    }
    /* opdater viste tider uden fuld gen-rendering */
    $$('[data-timerid]').forEach(card => {
      const t = S.timers.find(x => x.id === card.dataset.timerid);
      if (!t) return;
      const rem = timerRemainMs(t);
      const timeEl = card.querySelector('.ttime');
      if (timeEl) timeEl.textContent = t.ringing ? '0:00' : fmtTimer(rem);
      const bar = card.querySelector('.timerbar > div');
      if (bar) bar.style.width = (t.ringing ? 100 : Math.min(100, 100 - rem / t.totalMs * 100)) + '%';
    });
  }, 500);
}

RENDER.timers = () => {
  const presets = app().timerPresets || DEFAULT_APP.timerPresets;
  return pageHead('Timere', 'Køkkentimere – de kører videre, selv om du skifter side',
      `<button class="btn" id="wakePageBtn">📱 Hold skærmen tændt</button>`) + `
  <div class="panelbox">
    <div class="rowflex">
      ${presets.map(m => `<button class="btn" data-preset="${m}">${fmtMin(m)}</button>`).join('')}
      <span style="flex:1"></span>
      <input id="tmMin" type="number" min="1" placeholder="min" style="width:80px">
      <input id="tmLabel" placeholder="navn (fx pasta)" style="width:160px">
      <button class="btn primary" id="tmStart">▶ Start</button>
    </div>
  </div>
  ${S.timers.length ? `<div class="timergrid">
    ${S.timers.map(t => {
      const rem = timerRemainMs(t);
      return `<div class="timercard${t.ringing ? ' ringing' : ''}" data-timerid="${t.id}">
        <div class="tlabel">${esc(t.label)}</div>
        <div class="ttime">${t.ringing ? '0:00' : fmtTimer(rem)}</div>
        <div class="timerbar"><div style="width:${t.ringing ? 100 : Math.min(100, 100 - rem / t.totalMs * 100)}%"></div></div>
        <div class="tactions">
          ${t.ringing
            ? `<button class="btn primary" data-tstop="${t.id}">✓ OK</button>`
            : `<button class="btn small" data-tpause="${t.id}">${t.paused ? '▶' : '⏸'}</button>
               <button class="btn small" data-tplus="${t.id}">+1 min</button>
               <button class="btn small danger" data-tstop="${t.id}">✕</button>`}
        </div>
      </div>`;
    }).join('')}
  </div>` : '<p class="muted" style="margin-top:24px">Ingen aktive timere. Start én med knapperne ovenfor – eller klik på et minuttal inde i en opskrift.</p>'}
  <p class="small muted">💡 Slå "Hold skærmen tændt" til, mens du laver mad, så skærmen ikke låser (kræver https).</p>`;
};
RENDER.timers_bind = () => {
  $('#wakePageBtn').onclick = () => setWakeLock(!S.wakeOn);
  updateWakeBtn();
  $$('[data-preset]').forEach(b => b.onclick = () => { startTimer(+b.dataset.preset * 60000, fmtMin(+b.dataset.preset)); });
  const start = () => {
    const min = num($('#tmMin').value);
    if (!min || min <= 0) return toast('Angiv antal minutter', true);
    startTimer(min * 60000, $('#tmLabel').value.trim() || fmtMin(min));
  };
  $('#tmStart').onclick = start;
  $('#tmMin').onkeydown = e => { if (e.key === 'Enter') start(); };
  $('#tmLabel').onkeydown = e => { if (e.key === 'Enter') start(); };

  $$('[data-tstop]').forEach(b => b.onclick = () => {
    S.timers = S.timers.filter(t => t.id !== b.dataset.tstop);
    saveTimers();
    render();
  });
  $$('[data-tpause]').forEach(b => b.onclick = () => {
    const t = S.timers.find(x => x.id === b.dataset.tpause);
    if (!t) return;
    if (t.paused) { t.endsAt = Date.now() + t.remainMs; t.remainMs = null; t.paused = false; }
    else { t.remainMs = timerRemainMs(t); t.paused = true; }
    saveTimers();
    render();
  });
  $$('[data-tplus]').forEach(b => b.onclick = () => {
    const t = S.timers.find(x => x.id === b.dataset.tplus);
    if (!t) return;
    if (t.paused) t.remainMs += 60000; else t.endsAt += 60000;
    t.totalMs += 60000;
    saveTimers();
    render();
  });
};

function newTimerModal(label) {
  const presets = app().timerPresets || DEFAULT_APP.timerPresets;
  openModal(`<h2>⏱️ Ny timer</h2>
    <div class="rowflex">${presets.map(m => `<button class="btn" data-nt="${m}">${fmtMin(m)}</button>`).join('')}</div>
    <div class="rowflex" style="margin-top:12px">
      <input id="ntMin" type="number" min="1" placeholder="minutter" style="width:110px">
      <input id="ntLabel" placeholder="navn" value="${esc(label || '')}" style="flex:1">
      <button class="btn primary" id="ntStart">▶ Start</button>
    </div>
    <div class="actions"><button class="btn" id="ntCancel">Luk</button></div>`, m => {
    m.querySelector('#ntCancel').onclick = closeModal;
    m.querySelectorAll('[data-nt]').forEach(b => b.onclick = () => {
      startTimer(+b.dataset.nt * 60000, label || fmtMin(+b.dataset.nt));
      closeModal();
      toast('Timer startet');
    });
    const start = () => {
      const min = num(m.querySelector('#ntMin').value);
      if (!min || min <= 0) return toast('Angiv antal minutter', true);
      startTimer(min * 60000, m.querySelector('#ntLabel').value.trim() || fmtMin(min));
      closeModal();
      toast('Timer startet');
    };
    m.querySelector('#ntStart').onclick = start;
    m.querySelector('#ntMin').onkeydown = e => { if (e.key === 'Enter') start(); };
    m.querySelector('#ntMin').focus();
  });
}

/* ---------------- AI-assistent (chat) ---------------- */

function assistantSystemPrompt() {
  const recipes = K('recipe').map(r => ({
    id: r.id, titel: r.title, kategori: r.category || '',
    min: recipeTotalMin(r),
    vurdering: r.rating || null, favorit: !!r.favorite
  }));
  const monday = mondayOf();
  const plan = K('planEntry')
    .filter(e => e.date >= monday && e.date <= addDays(monday, 13))
    .map(e => {
      const r = e.recipeId ? recipeById(e.recipeId) : null;
      return e.date + ': ' + (r ? r.title : e.text || '');
    });
  return `Du er køkkenassistenten i appen "Kokkeri" – brugerens eget opskrifts-bibliotek.
Du hjælper på dansk med madlavning: opskrifter, teknik, erstatninger af ingredienser, skalering,
menu-idéer og madplaner. Vær konkret og kortfattet.

I dag er det ${isoDate()} (${WEEKDAYS_DA[(new Date().getDay() + 6) % 7]}).

Brugerens opskrifter (JSON): ${JSON.stringify(recipes).slice(0, 20000)}

Madplan de næste to uger: ${plan.length ? plan.join('; ') : 'tom'}

Når du foreslår en komplet opskrift, så skriv den med tydelige afsnit "Ingredienser:" og
"Fremgangsmåde:", så brugeren kan gemme den med ét klik. Nævner brugeren en af sine egne
opskrifter, så tag udgangspunkt i den.`;
}

RENDER.assistant = () => {
  if (!S.settings.aiKeySet) {
    return pageHead('AI-assistent', 'Din personlige køkkenassistent') + `
    <div class="panelbox center" style="padding:40px">
      <div style="font-size:40px">✨</div>
      <h2 style="margin-top:8px">Assistenten er ikke sat op endnu</h2>
      <p class="muted">Tilføj en Claude API-nøgle – eller din egen lokale AI-server (LM Studio/Ollama) –
      under Indstillinger, så kan assistenten hjælpe med opskrift-idéer, madplaner,
      ingrediens-erstatninger og import af opskrifter fra sider uden maskinlæsbare data.</p>
      <button class="btn primary" id="aiToSettings">⚙️ Gå til Indstillinger</button>
    </div>`;
  }
  const hints = ['Hvad kan jeg lave med det, jeg har i køleskabet?',
    'Foreslå en hurtig hverdagsret', 'Lav en vegetarisk madplan til ugen',
    'Hvad kan jeg bruge i stedet for fløde?'];
  return pageHead('AI-assistent', 'Spørg om alt i køkkenet – assistenten kender dine opskrifter og din madplan',
      `<button class="btn" id="aiClear" ${S.chat.length ? '' : 'disabled'}>Ryd samtale</button>`) + `
  <div class="chatwrap">
    <div class="chatlog" id="chatLog">
      ${S.chat.length ? S.chat.map((m, i) => `
        <div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.content)}${
          m.role === 'assistant' && /ingredienser/i.test(m.content) && /fremgangsmåde/i.test(m.content)
            ? `<div class="msgact"><button class="btn small" data-saverec="${i}">💾 Gem som opskrift</button></div>` : ''
        }</div>`).join('')
      : `<div class="msg ai">Hej! Jeg er din køkkenassistent 👨‍🍳 Spørg mig om opskrifter, madplaner,
        erstatninger eller teknik – jeg kender dit bibliotek på ${K('recipe').length} opskrifter.</div>
        <div class="chathints">${hints.map(h => `<span class="chip chipbtn" data-hint="${esc(h)}">${esc(h)}</span>`).join('')}</div>`}
      ${S.chatBusy ? '<div class="msg ai thinking">Tænker …</div>' : ''}
    </div>
    <div class="chatinput">
      <textarea id="chatText" placeholder="Skriv til assistenten… (Enter sender, Shift+Enter = ny linje)"></textarea>
      <button class="btn primary" id="chatSend" ${S.chatBusy ? 'disabled' : ''}>Send</button>
    </div>
  </div>`;
};
RENDER.assistant_bind = () => {
  const toSettings = $('#aiToSettings');
  if (toSettings) { toSettings.onclick = () => goto('settings'); return; }

  const log = $('#chatLog');
  log.scrollTop = log.scrollHeight;
  $('#aiClear').onclick = () => { S.chat = []; render(); };
  $$('[data-hint]').forEach(c => c.onclick = () => sendChat(c.dataset.hint));
  $$('[data-saverec]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    b.textContent = 'Læser opskriften …';
    try {
      const rec = await aiExtractRecipe(S.chat[+b.dataset.saverec].content, '', '');
      recipeModal(null, Object.assign(rec, { url: '' }));
    } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = '💾 Gem som opskrift'; }
  });
  const ta = $('#chatText');
  const send = () => { const v = ta.value.trim(); if (v) sendChat(v); };
  $('#chatSend').onclick = send;
  ta.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };
  if (!S.chatBusy) ta.focus();
};

async function sendChat(text) {
  if (S.chatBusy) return;
  S.chat.push({ role: 'user', content: text });
  S.chatBusy = true;
  render();
  try {
    const r = await api('/api/ai', {
      body: { system: assistantSystemPrompt(), messages: S.chat, maxTokens: 3000 }
    });
    S.chat.push({ role: 'assistant', content: r.text || '(tomt svar)' });
  } catch (e) {
    S.chat.push({ role: 'assistant', content: '⚠️ ' + e.message });
  }
  S.chatBusy = false;
  if (S.view === 'assistant') render();
}

/* ---------------- Indstillinger ---------------- */
RENDER.settings = () => {
  const A = app();
  return pageHead('Indstillinger', 'App, AI, kalender, backup og brugere') + `

  <div class="panelbox">
    <h2 style="margin-top:0">App</h2>
    <div class="formgrid">
      <label class="fld"><span>Appens navn</span><input id="setTitle" value="${esc(A.appTitle)}"></label>
      <label class="fld"><span>Standard-portioner</span><input id="setServ" type="number" min="1" value="${A.defaultServings}"></label>
      <label class="fld"><span>Timer-forvalg (minutter, komma-adskilt)</span>
        <input id="setPresets" value="${esc((A.timerPresets || []).join(', '))}"></label>
    </div>
    <label class="fld"><span>Kategorier (én pr. linje)</span>
      <textarea id="setCats" rows="5">${esc((A.categories || []).join('\n'))}</textarea></label>
    <div class="rowflex" style="margin-top:10px">
      <button class="btn small" id="logoPick">${S.settings.logo ? 'Skift logo…' : 'Upload logo…'}</button>
      ${S.settings.logo ? '<button class="btn small danger" id="logoDel">Fjern logo</button>' : ''}
      <input id="logoFile" type="file" accept="image/*" hidden>
      <span style="flex:1"></span>
      <button class="btn primary" id="setSave">Gem indstillinger</button>
    </div>
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">✨ AI-assistent</h2>
    <p class="small muted">Nøgle og adresse gemmes kun på serveren og sendes aldrig til browseren.
      Status: ${S.settings.aiKeySet
        ? (S.settings.aiProvider === 'openai'
            ? '<span class="good">egen server ✓</span> <span class="muted">(' + esc(S.settings.aiUrl) + ')</span>'
            : '<span class="good">Claude-nøgle er sat ✓</span>')
        : '<span class="warn">ikke sat op</span>'}</p>
    <label class="fld" style="max-width:420px"><span>Udbyder</span>
      <select id="aiProv">
        <option value="claude"${S.settings.aiProvider !== 'openai' ? ' selected' : ''}>Claude API (Anthropic)</option>
        <option value="openai"${S.settings.aiProvider === 'openai' ? ' selected' : ''}>Egen server – OpenAI-kompatibel (LM Studio, Ollama …)</option>
      </select></label>
    <div id="aiClaudeFields" ${S.settings.aiProvider === 'openai' ? 'hidden' : ''}>
      <p class="small muted" style="margin:10px 0 0">Opret en API-nøgle på
        <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>.</p>
      <div class="formgrid" style="grid-template-columns:2fr 1fr">
        <label class="fld"><span>API-nøgle ${S.settings.aiKeySet && S.settings.aiProvider !== 'openai' ? '(udfyld kun for at skifte)' : ''}</span>
          <input id="aiKey" type="password" placeholder="sk-ant-…" autocomplete="off"></label>
        <label class="fld"><span>Model (tom = standard)</span>
          <input id="aiModel" placeholder="claude-sonnet-5" value="${esc(S.settings.aiModel || '')}"></label>
      </div>
    </div>
    <div id="aiLocalFields" ${S.settings.aiProvider === 'openai' ? '' : 'hidden'}>
      <p class="small muted" style="margin:10px 0 0">Peg på en OpenAI-kompatibel server på dit netværk –
        fx LM Studio (<b>Developer → Start server</b>) eller Ollama. Alt kører så lokalt og gratis.</p>
      <div class="formgrid" style="grid-template-columns:2fr 1fr">
        <label class="fld"><span>Serverens adresse (inkl. /v1)</span>
          <input id="aiUrl" placeholder="http://192.168.1.197:1234/v1" value="${esc(S.settings.aiUrl || '')}"></label>
        <label class="fld"><span>Model (tom = første på serveren)</span>
          <input id="aiModelLocal" placeholder="fx qwen/qwen3-27b" value="${esc(S.settings.aiModel || '')}"></label>
      </div>
    </div>
    <div class="rowflex" style="margin-top:10px">
      <button class="btn primary" id="aiSave">Gem AI</button>
      ${S.settings.aiKeySet && S.settings.aiProvider !== 'openai' ? '<button class="btn small danger" id="aiClearKey">Fjern nøglen</button>' : ''}
    </div>
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">🏠 Home Assistant</h2>
    <p class="small muted">Send indkøbslisten til en todo-liste i Home Assistant med ét klik fra
      Indkøbsliste-siden. Opret en langtids-token under din HA-profil (Sikkerhed → Long-lived access tokens)
      og en todo-liste (Indstillinger → Enheder → Hjælpere → Indkøbsliste).
      Status: ${S.settings.haSet ? '<span class="good">forbundet ✓</span>' : '<span class="warn">ikke sat op</span>'}</p>
    <div class="formgrid">
      <label class="fld"><span>HA-adresse (fx http://homeassistant.local:8123)</span>
        <input id="haUrl" value="${esc(S.settings.haUrl || '')}" placeholder="http://…"></label>
      <label class="fld"><span>Token ${S.settings.haSet ? '(udfyld kun for at skifte)' : ''}</span>
        <input id="haToken" type="password" autocomplete="off"></label>
      <label class="fld"><span>Todo-enhed (fx todo.indkobsliste)</span>
        <input id="haEntity" value="${esc(S.settings.haEntity || '')}" placeholder="todo.…"></label>
    </div>
    <button class="btn primary" id="haSave">Gem Home Assistant</button>
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">✅ Todoist</h2>
    <p class="small muted">Send indkøbslisten til Todoist med ét klik fra Indkøbsliste-siden.
      Hent dit API-token i Todoist under Indstillinger → Integrationer → Udvikler.
      Butiksafdeling og opskrift følger med som note på opgaven.
      Status: ${S.settings.todoistSet ? '<span class="good">forbundet ✓</span>' : '<span class="warn">ikke sat op</span>'}</p>
    <div class="formgrid">
      <label class="fld"><span>API-token ${S.settings.todoistSet ? '(udfyld kun for at skifte)' : ''}</span>
        <input id="tdToken" type="password" autocomplete="off" placeholder="fx 0123456789abcdef…"></label>
      <label class="fld"><span>Projekt</span>
        <span class="rowflex">
          <select id="tdProject" style="flex:1"><option value="${esc(S.settings.todoistProject || '')}">${S.settings.todoistProject ? 'Gemt projekt (hent listen for at skifte)' : 'Indbakke (standard)'}</option></select>
          <button class="btn small" id="tdLoad" ${S.settings.todoistSet ? '' : 'disabled'}>Hent</button>
        </span></label>
    </div>
    <button class="btn primary" id="tdSave">Gem Todoist</button>
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">📅 Madplan i din kalender</h2>
    <p class="small muted">Abonnér på madplanen i Apple/Google Kalender med dette link:</p>
    <div class="rowflex">
      <input id="icalUrl" readonly value="${esc(location.origin + '/api/madplan.ics?token=' + (S.settings.icalToken || ''))}" style="flex:1;min-width:260px">
      <button class="btn small" id="icalCopy">Kopiér</button>
    </div>
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">Backup & import</h2>
    <div class="rowflex">
      <button class="btn" id="bakJson">⬇️ Download backup (JSON)</button>
      ${S.me.isAdmin ? '<button class="btn" id="bakDb">⬇️ Download database (.db)</button>' : ''}
      ${S.me.isAdmin ? '<button class="btn" id="bakRestore">⬆️ Gendan fra JSON…</button><input id="bakFile" type="file" accept=".json" hidden>' : ''}
    </div>
    <h3>🌶️ Flyt fra Paprika</h3>
    <p class="small muted">Eksportér hele dit bibliotek i Paprika (Indstillinger → Export → Paprika Recipe Format)
      og vælg <b>.paprikarecipes</b>-filen her. Opskrifter, billeder, tider, kategorier og vurderinger følger med;
      dubletter (samme titel) springes over.</p>
    <button class="btn" id="papImport">⬆️ Importér Paprika-eksport…</button>
    <input id="papFile" type="file" accept=".paprikarecipes,.paprikarecipe" hidden>
    <span class="small muted" id="papStatus"></span>
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">Min konto</h2>
    <p class="small muted">Logget ind som <b>${esc(S.me.username)}</b>${S.me.isAdmin ? ' (administrator)' : ''}</p>
    <h3>Passkeys</h3>
    ${(S.me.passkeys || []).length ? `<table class="data" style="max-width:480px"><tbody>
      ${S.me.passkeys.map(pk => `<tr><td>🔑 ${esc(pk.label)}</td><td class="small muted">${fmtDate(pk.created)}</td>
        <td class="right"><button class="iconbtn" data-pkdel="${esc(pk.id)}">✕</button></td></tr>`).join('')}
    </tbody></table>` : '<p class="small muted">Ingen passkeys endnu.</p>'}
    <button class="btn small" id="pkAdd">➕ Tilføj passkey til denne enhed</button>
    <h3>Skift kodeord</h3>
    <div class="formgrid" style="max-width:560px">
      <label class="fld"><span>Nuværende kodeord</span><input id="pwCur" type="password" autocomplete="current-password"></label>
      <label class="fld"><span>Nyt kodeord</span><input id="pwNew" type="password" autocomplete="new-password"></label>
      <label class="fld"><span>&nbsp;</span><button class="btn" id="pwSave">Skift kodeord</button></label>
    </div>
  </div>

  ${S.me.isAdmin ? `<div class="panelbox">
    <h2 style="margin-top:0">Brugere (admin)</h2>
    <div id="adminUsers" class="muted small">Henter …</div>
  </div>` : ''}`;
};

RENDER.settings_bind = () => {
  let logoData = undefined; // undefined = uaendret, '' = fjern
  $('#logoPick').onclick = () => $('#logoFile').click();
  $('#logoFile').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    logoData = await blobToScaledDataUrl(f, 400);
    $('#logoPick').textContent = 'Logo valgt ✓';
  };
  const ld = $('#logoDel');
  if (ld) ld.onclick = () => { logoData = ''; ld.disabled = true; };

  $('#setSave').onclick = async () => {
    const patch = Object.assign({}, S.settings.app || {}, {
      appTitle: $('#setTitle').value.trim() || 'Kokkeri',
      defaultServings: parseInt($('#setServ').value, 10) || 4,
      timerPresets: $('#setPresets').value.split(',').map(s => parseInt(s, 10)).filter(n => n > 0),
      categories: $('#setCats').value.split('\n').map(s => s.trim()).filter(Boolean)
    });
    const settings = { app: patch };
    if (logoData !== undefined) settings.logo = logoData;
    await saveSettings(settings);
    render();
  };

  $('#aiProv').onchange = () => {
    const local = $('#aiProv').value === 'openai';
    $('#aiClaudeFields').hidden = local;
    $('#aiLocalFields').hidden = !local;
  };
  $('#aiSave').onclick = async () => {
    const local = $('#aiProv').value === 'openai';
    const settings = { ai_provider: local ? 'openai' : 'claude' };
    if (local) {
      settings.ai_url = $('#aiUrl').value.trim().replace(/\/+$/, '');
      settings.ai_model = $('#aiModelLocal').value.trim();
    } else {
      const key = $('#aiKey').value.trim();
      if (key) settings.ai_key = key;
      settings.ai_model = $('#aiModel').value.trim();
    }
    await saveSettings(settings);
    render();
  };
  const clearKey = $('#aiClearKey');
  if (clearKey) clearKey.onclick = async () => {
    if (!await confirmBox('Fjern AI-nøglen fra serveren?', 'Fjern')) return;
    await saveSettings({ ai_key: '' });
    render();
  };

  $('#haSave').onclick = async () => {
    const settings = {
      ha_url: $('#haUrl').value.trim().replace(/\/+$/, ''),
      ha_entity: $('#haEntity').value.trim()
    };
    const token = $('#haToken').value.trim();
    if (token) settings.ha_token = token;
    await saveSettings(settings);
    render();
  };

  $('#tdLoad').onclick = async () => {
    const btn = $('#tdLoad');
    btn.disabled = true;
    btn.textContent = 'Henter …';
    try {
      const r = await api('/api/todoist/projects');
      const sel = $('#tdProject');
      const cur = S.settings.todoistProject || '';
      sel.innerHTML = '<option value="">Indbakke (standard)</option>' +
        r.projects.map(p2 => `<option value="${esc(p2.id)}"${p2.id === cur ? ' selected' : ''}>${esc(p2.name)}</option>`).join('');
      toast('Hentede ' + r.projects.length + ' projekter – vælg ét og tryk Gem');
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
    btn.textContent = 'Hent';
  };
  $('#tdSave').onclick = async () => {
    const settings = { todoist_project: $('#tdProject').value };
    const token = $('#tdToken').value.trim();
    if (token) settings.todoist_token = token;
    await saveSettings(settings);
    render();
  };

  $('#papImport').onclick = () => $('#papFile').click();
  $('#papFile').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    const status = $('#papStatus');
    const btn = $('#papImport');
    btn.disabled = true;
    status.textContent = 'Læser filen …';
    try {
      const res = await importPaprikaFile(f, (i, total) => {
        status.textContent = `Importerer ${i} af ${total} …`;
      });
      toast(`Paprika-import: ${res.imported} nye opskrifter` +
        (res.skipped ? `, ${res.skipped} dubletter sprunget over` : '') +
        (res.failed ? `, ${res.failed} fejlede` : ''));
      status.textContent = '';
      render();
    } catch (err2) {
      status.textContent = '';
      btn.disabled = false;
      toast('Import fejlede: ' + err2.message, true);
    }
  };

  $('#icalCopy').onclick = () => {
    $('#icalUrl').select();
    navigator.clipboard.writeText($('#icalUrl').value).then(() => toast('Link kopieret'));
  };

  $('#bakJson').onclick = async () => {
    const b = await api('/api/backup');
    downloadFile('kokkeri-backup-' + isoDate() + '.json', JSON.stringify(b, null, 1), 'application/json');
  };
  const bdb = $('#bakDb');
  if (bdb) bdb.onclick = () => { location.href = '/api/backup.db'; };
  const brs = $('#bakRestore');
  if (brs) {
    brs.onclick = () => $('#bakFile').click();
    $('#bakFile').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch (err) { return toast('Filen er ikke gyldig JSON', true); }
      if (!Array.isArray(data.items)) return toast('Ligner ikke en Kokkeri-backup', true);
      const replace = await confirmBox(`Gendan ${data.items.length} elementer fra backup? Vælg "Erstat alt" for at overskrive alt eksisterende.`, 'Erstat alt');
      const r = await api('/api/restore', { body: { items: data.items, settings: data.settings || null, replace } });
      toast('Gendannede ' + r.restored + ' elementer');
      const items = await api('/api/items');
      S.items = items.items || [];
      reindex();
      render();
    };
  }

  $('#pkAdd').onclick = passkeyRegister;
  $$('[data-pkdel]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('Fjern denne passkey?', 'Fjern')) return;
    const r = await api('/api/webauthn/credentials/' + encodeURIComponent(b.dataset.pkdel), { method: 'DELETE', body: {} });
    S.me = r.me;
    render();
  });

  $('#pwSave').onclick = async () => {
    try {
      await api('/api/password', { body: { current: $('#pwCur').value, password: $('#pwNew').value } });
      toast('Kodeordet er skiftet');
      $('#pwCur').value = $('#pwNew').value = '';
    } catch (e) { toast(e.message, true); }
  };

  if (S.me.isAdmin) loadAdminUsers();
};

async function loadAdminUsers() {
  const host = $('#adminUsers');
  if (!host) return;
  try {
    const r = await api('/api/admin/users');
    host.className = '';
    host.innerHTML = `
      <label class="chk" style="margin-bottom:10px"><input type="checkbox" id="admAllowReg" ${r.allowRegistration ? 'checked' : ''}>
        Tillad registrering af nye brugere</label>
      <div class="tablewrap"><table class="data"><thead>
        <tr><th>Bruger</th><th>Oprettet</th><th>Passkeys</th><th>Rolle</th><th></th></tr></thead><tbody>
        ${r.users.map(u => `<tr>
          <td>${esc(u.username)}${u.id === S.me.id ? ' <span class="muted small">(dig)</span>' : ''}</td>
          <td class="small muted">${fmtDate(u.created)}</td>
          <td>${u.passkeys}</td>
          <td>${u.isAdmin ? '<span class="chip on">admin</span>' : '<span class="chip">bruger</span>'}</td>
          <td class="right nowrap">
            <button class="btn small" data-admpw="${u.id}">Nyt kodeord</button>
            <button class="btn small" data-admrole="${u.id}" data-isadmin="${u.isAdmin ? 1 : 0}">${u.isAdmin ? 'Fjern admin' : 'Gør til admin'}</button>
            ${u.id !== S.me.id ? `<button class="btn small danger" data-admdel="${u.id}" data-name="${esc(u.username)}">Slet</button>` : ''}
          </td></tr>`).join('')}
      </tbody></table></div>`;
    $('#admAllowReg').onchange = async e => {
      await api('/api/admin/settings', { body: { allowRegistration: e.target.checked } });
      toast('Gemt');
    };
    $$('[data-admpw]').forEach(b => b.onclick = async () => {
      const pw = prompt('Nyt kodeord (mindst 8 tegn):');
      if (!pw) return;
      try { await api(`/api/admin/users/${b.dataset.admpw}/password`, { body: { password: pw } }); toast('Kodeord sat'); }
      catch (e) { toast(e.message, true); }
    });
    $$('[data-admrole]').forEach(b => b.onclick = async () => {
      try {
        await api(`/api/admin/users/${b.dataset.admrole}/role`, { body: { isAdmin: b.dataset.isadmin !== '1' } });
        loadAdminUsers();
      } catch (e) { toast(e.message, true); }
    });
    $$('[data-admdel]').forEach(b => b.onclick = async () => {
      if (!await confirmBox(`Slet brugeren "${b.dataset.name}"?`)) return;
      try { await api('/api/admin/users/' + b.dataset.admdel, { method: 'DELETE', body: {} }); loadAdminUsers(); }
      catch (e) { toast(e.message, true); }
    });
  } catch (e) {
    host.textContent = 'Kunne ikke hente brugere: ' + e.message;
  }
}

/* start appen */
boot();
