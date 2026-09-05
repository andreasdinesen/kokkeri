'use strict';
/* Kokkeri frontend – vanilla JS, ingen frameworks.
 * Samlet af build-dele (app/parts/p*.js -> public/app.js). */

const APP_VERSION = 30;

/* localStorage kan kaste (privat vindue, blokerede cookies) - preferencer maa
 * aldrig kunne vaelte appen. */
function lsGet(key, dflt) {
  try { const v = localStorage.getItem(key); return v === null ? dflt : v; } catch (e) { return dflt; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) {}
}

/* ---------------- state ---------------- */
const S = {
  me: null,
  settings: { app: {}, logo: '', aiKeySet: false, aiModel: '' },
  items: [],            // alle datatyper fra serveren
  byKind: {},           // kind -> [items]
  view: 'dash',
  viewArg: null,        // fx opskrift-id på detaljesiden
  weekStart: null,      // mandag i den viste madplan-uge (YYYY-MM-DD)
  recFilter: { q: '', category: '', fav: false, sort: lsGet('kk_recsort', 'nyeste'), minStars: +lsGet('kk_recminstars', 0) || 0, raavarer: [], kilde: '', frokost: false },
  /* undefined = ikke valgt endnu; filter-panelet starter da aabent paa en stor
   * skaerm og lukket paa en telefon */
  filterOpen: lsGet('kk_filteropen', '') === '' ? undefined : lsGet('kk_filteropen', '') === '1',
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

/* ---------------- AI-svar -> JSON ----------------
 * Lokale modeller (LM Studio/Ollama) pakker gerne svaret i markdown-hegn,
 * skriver en forklaring udenom (med kantparenteser i!), returnerer
 * {"plan": [...]} i stedet for [...] eller efterlader et trailing komma.
 * Derfor: find den foerste BALANCEREDE struktur der kan parses - proev flere
 * startpunkter, i stedet for at klippe fra foerste [ til sidste ]. */
function parseAiJson(text, forventArray) {
  const s = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')          // raesonnerende modeller
    .replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '') // markdown-hegn
    .trim();
  const balanceret = (start, aaben, luk) => {
    let dybde = 0, iStreng = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { iStreng = !iStreng; continue; }
      if (iStreng) continue;
      if (c === aaben) dybde++;
      else if (c === luk && --dybde === 0) return s.slice(start, i + 1);
    }
    return null;
  };
  const kandidater = [];
  for (const [a, l] of (forventArray ? [['[', ']'], ['{', '}']] : [['{', '}'], ['[', ']']])) {
    for (let p = s.indexOf(a), n = 0; p >= 0 && n < 6; p = s.indexOf(a, p + 1), n++) {
      const k = balanceret(p, a, l);
      if (k) kandidater.push(k);
    }
  }
  for (const k of kandidater) {
    let j;
    try { j = JSON.parse(k); }
    catch (e) {
      try { j = JSON.parse(k.replace(/,\s*([}\]])/g, '$1')); }   // trailing komma
      catch (e2) { continue; }
    }
    if (!forventArray) { if (j && typeof j === 'object' && !Array.isArray(j)) return j; continue; }
    if (Array.isArray(j)) return j;
    const arr = j && typeof j === 'object' && Object.values(j).find(v => Array.isArray(v));
    if (arr) return arr;                                  // {"plan": [...]}
  }
  return null;
}
/* kort uddrag af svaret til fejlbeskeden - ellers er "kunne ikke laeses" ubrugelig */
function aiSvarUddrag(text) {
  const s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/\s+/g, ' ');
  return s ? ' AI svarede: "' + s.slice(0, 120) + (s.length > 120 ? '…' : '') + '"' : ' AI svarede ingenting.';
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

/* ---------------- billeder ----------------
 * Fotoet ligger ikke i opskriften, men som sit eget item paa serveren. Kortene
 * peger paa /api/image/<id>?v=<imageVer>: URL'en skifter, naar billedet goer,
 * saa browseren kan cache den for evigt - og <img loading="lazy"> virker
 * foerst nu, hvor kilden er en rigtig URL og ikke en dataURL (en dataURL er
 * allerede en del af dokumentet og bliver aldrig udskudt). */
const imageSrc = r => (r && r.imageVer) ? `/api/image/${encodeURIComponent(r.id)}?v=${encodeURIComponent(r.imageVer)}` : '';
const hasImage = r => !!(r && (r.imageVer || r.image));
/* r.image kan stadig vaere sat midlertidigt: masse-importen gemmer en ekstern
 * URL, indtil localizeRemoteImages() henter billedet ned. */
const imageSrcOrRemote = r => imageSrc(r) || (r && r.image) || '';

async function saveRecipeImage(r, dataUrl) {
  const ver = String(Date.now());
  await api('/api/items', { body: { item: { id: 'img-' + r.id, kind: 'recipeImage', dataUrl } } });
  r.imageVer = ver;
  delete r.image;
  delete r.imageRemote;
  return ver;
}
async function deleteRecipeImage(r) {
  if (!r.imageVer) { delete r.image; return; }
  await api('/api/items', { body: { item: { id: 'img-' + r.id, kind: 'recipeImage', deleted: true } } });
  delete r.imageVer;
  delete r.image;
}

/* ---------------- delvise opskrifter ----------------
 * Login henter kun kort-felterne (titel, kategori, tid, stjerner ...). Resten
 * hentes, naar en opskrift aabnes - eller i baggrunden lige efter login.
 * `partial: true` markerer, at fremgangsmaade, noter mv. mangler endnu. */
async function ensureFull(r) {
  if (!r || r.kind !== 'recipe' || !r.partial) return r;
  try {
    const svar = await api('/api/items/' + encodeURIComponent(r.id));
    if (svar.item) for (const [k, v] of Object.entries(svar.item)) if (!(k in r)) r[k] = v;
  } catch (e) { toast('Kunne ikke hente opskriften: ' + e.message, true); return r; }
  delete r.partial;
  return r;
}

/* Fylder resten af opskrifterne paa i baggrunden lige efter login. Login venter
 * ikke paa den: kortene er nok til at tegne oversigten. Naar den er faerdig,
 * kan soegningen ogsaa kigge i ingredienserne igen. */
function hydrateItems() {
  if (S.hydrated) return Promise.resolve();
  /* koerer den allerede, saa vent paa DEN - ellers kan to kaldere tro, at
   * opskrifterne er fyldt ud, mens den ene stadig henter */
  if (S._hydrating) return S._hydrating;
  S._hydrating = (async () => {
    try {
      const svar = await api('/api/items');
      const kendte = new Map(S.items.map(x => [x.id, x]));
      for (const fuld of svar.items || []) {
        const cur = kendte.get(fuld.id);
        if (cur) {
          for (const [k, v] of Object.entries(fuld)) if (!(k in cur)) cur[k] = v;
          delete cur.partial;
        } else S.items.push(fuld);
      }
      reindex();
      S.hydrated = true;
      /* Tegn om, hvis noget paa siden afhaenger af ingredienserne: soegningen
       * kigger i dem, og raavare-panelet kan ikke taelle uden dem. Ellers ville
       * panelet blive staaende paa "Henter …", til brugeren selv roerte noget. */
      const f = S.recFilter || {};
      if (S.view === 'recipes' && (f.q || S.raaOpen || (f.raavarer || []).length)) render();
    } catch (e) {
      /* ikke kritisk: ensureFull() henter den enkelte opskrift ved behov */
    } finally { S._hydrating = null; }
  })();
  return S._hydrating;
}

async function saveItem(it, quiet) {
  /* En delvis opskrift maa ALDRIG gemmes som den er - saa ville fremgangsmaade
   * og noter blive skrevet vaek. Hent det manglende foerst; lokale aendringer
   * vinder, fordi kun felter der IKKE findes lokalt fyldes paa. */
  if (it && it.kind === 'recipe' && it.partial) {
    try {
      const svar = await api('/api/items/' + encodeURIComponent(it.id));
      if (svar.item) for (const [k, v] of Object.entries(svar.item)) if (!(k in it)) it[k] = v;
      delete it.partial;
    } catch (e) { toast('Kunne ikke gemme: ' + e.message, true); return; }
  }
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
  /* Samme fælde som i saveItem, men vaerre: categorizeImported() bulk-gemmer
   * ALLE opskrifter uden kategori ved app-start. Var de delvise, ville
   * fremgangsmaade og ingredienser blive skrevet vaek paa én gang. Ét
   * hydrate-kald fylder dem alle; ensureFull tager evt. efternoelere. */
  if (items.some(x => x && x.kind === 'recipe' && x.partial)) {
    await hydrateItems();
    for (const x of items) if (x && x.kind === 'recipe' && x.partial) await ensureFull(x);
  }
  for (const it of items) {
    /* billeder holdes ALDRIG i hukommelsen i browseren - de hentes via
     * /api/image, naar et kort faktisk vises */
    if (it.kind === 'recipeImage') continue;
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
/* document.title bliver browserens forslag til PDF-filnavn - saet et paent et
 * under print og gendan bagefter. */
function printSheet(html, filename) {
  $('#printHost').innerHTML = html;
  const orig = document.title;
  if (filename) {
    document.title = String(filename).replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) + '-' + isoDate();
    const restore = () => { document.title = orig; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    setTimeout(restore, 60000); // sikkerhedsnet hvis afterprint aldrig fyrer
  }
  setTimeout(() => window.print(), 60);
}
function printLogoHtml() {
  return S.settings.logo ? `<div class="plogo"><img src="${S.settings.logo}"></div>` : '';
}
