'use strict';
/* Kokkeri -> huti: hvad har husstanden i fryseren, koeleskabet og spisekammeret?
 *
 * huti er husstandens inventar. Den har ingen REST-rute til en personlig noegle -
 * noeglen (`huti_…`) virker KUN paa `/mcp`. Derfor kalder Kokkeri hutis MCP-server
 * server-til-server (RUNE-ERFARINGER, qlk v35):
 *
 *   POST <huti>/mcp   JSON-RPC 2.0, stateless (`tools/call` uden `initialize`)
 *   Authorization: Bearer huti_…   og INGEN Origin (huti afviser en fremmed Origin)
 *   Accept: application/json, text/event-stream   - svaret laeses som JSON eller SSE
 *
 * Vaerktoejerne: `pantry_for_planning` (laes, det hele kompakt), `tools/list` (kan
 * noeglen skrive?), `shopping_list` (laes - »Hent fra huti« paa indkoebslisten) og
 * `take_stock` (kun med en skrivenoegle og kun efter et klik).
 *
 * Forbindelsen gaar KUN den ene vej (Andreas, 14/10-2026): Kokkeri laeser hutis
 * indkoebsliste, men skriver aldrig tilbage - huti har ingen »Send til Kokkeri«.
 *
 * Reglerne (RUNE-ERFARINGER §6b + huti v2):
 *  - Noeglen bor i settings (`huti_key`) og forlader ALDRIG serveren - fladen faar kun
 *    `hutiKeySet`. Indstillingerne gaar uden om den generelle /api/settings, saa reglen
 *    »ny adresse kraever noeglen igen« ikke kan omgaas.
 *  - Kun http(s), ingen brugernavn/kodeord i adressen, INGEN viderestillinger (et 3xx er
 *    en fejl), timeout 10 s, svarloft 2 MB.
 *  - Kaldet gaar gennem netvagten (app/netvagt.js, sikkerhedsreviewet 14/10-2026): DNS ved
 *    hvert kald, forbindelsen bundet til den tjekkede IP, og en INTERN adresse (LAN,
 *    127.0.0.1) kun, naar en Kokkeri-admin forbandt (`huti_privat` = '1'). Forbind/test/
 *    afbryd kraever i forvejen admin (server.js), saa i praksis er det altid admin.
 *  - »Tag ud« rammer KUN id'er fra seneste `pantry_for_planning` (madvarer) - en
 *    skrivenoegle i huti kan tage alt ud, ogsaa ammunition - og maengden klemmes til 1-10.
 *  - Fejl udadtil har faste koder: `bad_key` (401/403) eller `failed` (alt andet: ikke
 *    naaet, timeout, 5xx, ulaeseligt, rpc-fejl). hutis krop og noeglen kommer aldrig i et
 *    svar - kun status i loggen (`[huti] advarsel:`, ikke `[fejl]`, saa runens watcher
 *    ikke larmer, naar huti er nede).
 *  - hutis svar er utrovaerdigt input: hver vare renses (tal klemt, tekst uden tags og
 *    styretegn, kendte enheder, datoer i ISO-form). Fladen escaper alligevel alt.
 *  - Svaret caches i hukommelsen (3 min) - aldrig paa disk.
 *
 * Modulet kender hverken db'en eller http-serveren: alt kommer ind gennem `opret()`,
 * saa det kan proeves for sig (tests/huti.test.mjs).
 */
const netvagt = require('./netvagt.js');

const MAKS_SVAR = 2 * 1024 * 1024;
const MAKS_VARER = 200;
const MAKS_POSTER = 200;               // hutis indkoebsliste - loft paa antal
const CACHE_MS = 3 * 60 * 1000;

/* hutis enheder (huti/app/shared/model.js VARE_ENHEDER) paa dansk. Ukendt -> ''. */
const ENHEDER = { pcs: 'stk', portions: 'portioner', bags: 'poser', boxes: 'bokse', g: 'g', kg: 'kg', l: 'l', rounds: 'skud', packs: 'pakker' };
/* hutis vildtarter (hunt.sp_*) paa dansk. Ukendt kode -> koden selv er ikke med. */
const ARTER = { roe_deer: 'rådyr', fallow_deer: 'dåhjort', red_deer: 'kronhjort', wild_boar: 'vildsvin', pheasant: 'fasan',
  duck: 'and', goose: 'gås', hare: 'hare', other: 'vildt' };
const STEDTYPE = { freezer: 'fryser', bestbefore: 'køl/skab', thawed: 'optøet', opened: 'åbnet' };

/* Faste beskeder - samme ord uanset hvad huti svarede. */
const BESKED = {
  not_set: 'huti er ikke forbundet – angiv adresse og nøgle under Indstillinger → Integrationer',
  bad_url: 'Adressen skal være en http- eller https-adresse til huti',
  need_key: 'En ny adresse kræver nøglen igen',
  bad_key: 'huti afviste nøglen – lav en personlig nøgle i huti og kopiér den rigtigt',
  failed: 'Kunne ikke hente fra huti – prøv igen senere',
  read_only: 'Nøglen kan kun læse – lav en nøgle med »Read and change« i huti for at tage ud',
  refused: 'huti tog ikke varen ud – den findes måske ikke længere'
};
const fejl = kode => ({ ok: false, kode, besked: BESKED[kode] || BESKED.failed });

/** Brugerens adresse -> `https://vaert[:port][/sti]` uden skraastreg til sidst, eller ''. */
function rensBase(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s.length > 300) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!u.hostname || u.username || u.password || u.search || u.hash) return '';
    return u.protocol + '//' + u.host + u.pathname.replace(/\/+$/, '').replace(/\/mcp$/, '');
  } catch (e) { return ''; }
}

/** Utrovaerdig tekst: ingen tags, styretegn eller lange strenge. */
function rens(v, maks) {
  return String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, maks || 200);
}
const datoEllerNull = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const heltal = (v, min, maks) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= maks ? n : null;
};
/* Kokkeris egen norm() (app/mcp.js) - raavareordet sammenlignes med den. */
const norm = s => String(s || '').toLowerCase().replace(/[^a-zæøå0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Én vare fra huti -> det, Kokkeri gemmer og viser. null = kasseret. */
function rensVare(x) {
  if (!x || typeof x !== 'object') return null;
  const id = heltal(x.id, 1, 1e12);
  const navn = rens(x.name, 120);
  if (!id || !navn) return null;
  const q = Number(x.quantity);
  const art = x.origin && typeof x.origin === 'object' && /^[a-z_]{1,30}$/.test(String(x.origin.species || '')) ? String(x.origin.species) : '';
  return {
    id,
    name: navn,
    word: norm(rens(x.word, 60)).slice(0, 40),
    quantity: Number.isFinite(q) && q >= 0 && q < 1e7 ? Math.round(q * 1000) / 1000 : null,
    unit: Object.hasOwn(ENHEDER, x.unit) ? ENHEDER[x.unit] : '',
    place: rens(x.place, 200),
    mode: Object.hasOwn(STEDTYPE, x.mode) ? x.mode : null,
    soon: x.status === 'eat_soon',
    pastLimit: x.pastLimit === true,
    daysLeft: heltal(x.daysLeft, -100000, 100000),
    bestBefore: datoEllerNull(x.bestBefore),
    frozenAt: datoEllerNull(x.frozenAt),
    ageDays: heltal(x.ageDays, 0, 100000),
    origin: art ? { species: ARTER[art] || 'vildt', area: rens(x.origin.area, 80) } : null
  };
}

/* hutis afdelinger (huti/app/shared/model.js AFDELINGER) -> Kokkeris SHOP_SECTIONS (p1b_food.js).
 * household og other har ingen pendant - dér gaetter Kokkeri selv. */
const AFDELINGER = { produce: 'Frugt & grønt', bakery: 'Brød', dairy: 'Mejeri & køl', meat: 'Kød & fisk', frozen: 'Frost',
  dry_goods: 'Kolonial', drinks: 'Drikkevarer' };
const KILDER = new Set(['manual', 'used_up', 'low_stock', 'recipe']);

/** Én post fra hutis indkoebsliste -> det, Kokkeri viser. null = kasseret.
 *  Formatet (huti/app/mcp.js shopping_list): { id, text, quantity, unit, aisle, source, checked, addedBy }.
 *  `name` godtages for `text`, og `checkedAt` for `checked` (et senere huti-format). Afkrydsede
 *  poster er ikke med. Hvem der tilfoejede den (`addedBy`) sendes ALDRIG videre. */
function rensPost(x) {
  if (!x || typeof x !== 'object') return null;
  if (x.checked === true || (x.checkedAt != null && x.checkedAt !== '')) return null;
  const tekst = rens(x.text != null ? x.text : x.name, 120);
  if (!tekst) return null;
  const q = Number(x.quantity);
  const enhedRaa = String(x.unit == null ? '' : x.unit).trim().toLowerCase();
  const enhed = Object.hasOwn(ENHEDER, enhedRaa) ? ENHEDER[enhedRaa]
    : /^[a-zæøå.]{1,12}$/.test(enhedRaa) ? enhedRaa : '';
  const kilde = String(x.source || '');
  return {
    hutiId: heltal(x.id, 1, 1e12),
    text: tekst,
    quantity: x.quantity != null && x.quantity !== '' && Number.isFinite(q) && q > 0 && q < 1e6 ? Math.round(q * 1000) / 1000 : null,
    unit: enhed,
    aisle: Object.hasOwn(AFDELINGER, x.aisle) ? AFDELINGER[x.aisle] : '',
    source: KILDER.has(kilde) ? kilde : ''
  };
}

/** Teksten, posten faar paa Kokkeris liste: »2 l Letmælk« (som parseShopText forstaar). */
function postTekst(p) {
  if (p.quantity == null) return p.text;
  return `${String(p.quantity).replace('.', ',')}${p.unit ? ' ' + p.unit : ''} ${p.text}`;
}

/** Et `shopping_list`-svar -> rensede, aabne poster. null = ulaeseligt.
 *  Taaler hutis nuvaerende form (structuredContent.items) og en grupperet form
 *  (structuredContent.aisles/groups[].items). Uden structuredContent laeses tekstlinjerne
 *  »- [shopping #12] Letmælk (2 l) · dairy · manual« - en tom liste er »The shopping list is empty.« */
function indkoebAf(result) {
  if (!result || result.error || result.isError) return null;
  const sc = result.structuredContent;
  let raa = null;
  if (sc && typeof sc === 'object') {
    if (Array.isArray(sc.items)) raa = sc.items;
    else {
      const grupper = Array.isArray(sc.aisles) ? sc.aisles : Array.isArray(sc.groups) ? sc.groups : null;
      if (grupper) raa = grupper.slice(0, 50).flatMap(g => (g && Array.isArray(g.items) ? g.items.slice(0, MAKS_POSTER).map(x => (x && typeof x === 'object' && !x.aisle && g.aisle ? Object.assign({}, x, { aisle: g.aisle }) : x)) : []));
    }
  }
  if (!raa) {
    const tekst = Array.isArray(result.content) && result.content[0] && typeof result.content[0].text === 'string' ? result.content[0].text : null;
    if (tekst == null) return null;
    raa = [];
    for (const l of tekst.slice(0, 200000).split('\n')) {
      const m = /^- \[shopping #(\d+)\] (.+?)(?: \(([\d.,]+)(?: ([^)]{1,20}))?\))?(?: · ([a-z_]+))?(?: · ([a-z_]+))?( · ticked off)?$/.exec(l.trim());
      if (m) raa.push({ id: m[1], text: m[2], quantity: m[3] ? m[3].replace(',', '.') : null, unit: m[4] || '', aisle: m[5], source: m[6], checked: !!m[7] });
    }
    if (!raa.length && !/empty/i.test(tekst)) return null;
  }
  const poster = [];
  const set = new Set();
  for (const x of raa) {
    if (poster.length >= MAKS_POSTER) break;
    const p = rensPost(x);
    if (!p) continue;
    const noegle = p.hutiId ? '#' + p.hutiId : 't:' + p.text.toLowerCase();
    if (set.has(noegle)) continue;          // samme post to gange i svaret
    set.add(noegle);
    poster.push(p);
  }
  return poster;
}

/** »2 poser hakket vildt« / »hjortekølle« - til mærkerne i fladen og til AI'en. */
const ENTAL = { poser: 'pose', portioner: 'portion', bokse: 'boks', pakker: 'pakke' };
function maengdeTekst(v) {
  if (v.quantity == null) return '';
  const n = String(v.quantity).replace('.', ',');
  const enhed = v.quantity === 1 && ENTAL[v.unit] ? ENTAL[v.unit] : v.unit;
  return enhed ? `${n} ${enhed}` : `${n} ×`;
}
/** Én linje pr. vare til modellen (AI-panelet og Kokkeris MCP). Ren tekst. */
function vareLinje(v) {
  const dele = [`${v.name}${v.word && v.word !== norm(v.name) ? ` (${v.word})` : ''}`];
  const m = maengdeTekst(v);
  if (m) dele.push(m);
  if (v.place) dele.push(v.place);
  if (v.soon) dele.push(v.pastLimit ? 'SPIS NU (over grænsen)' : 'SPIS SNART');
  if (v.bestBefore) dele.push('bedst før ' + v.bestBefore);
  else if (v.ageDays != null) dele.push(`${v.ageDays} dage gammel`);
  if (v.origin) dele.push('fra ' + v.origin.species + (v.origin.area ? ' (' + v.origin.area + ')' : ''));
  return '- ' + dele.join(' · ');
}

/** hutis svar - JSON (ogsaa en batch) eller SSE (`data: {…}`) - til JSON-RPC-svarene. */
function laesSvar(tekst, contentType) {
  const t = String(tekst || '');
  const ct = String(contentType || '').toLowerCase();
  const somJson = s => { try { return JSON.parse(s); } catch (e) { return undefined; } };
  let ud;
  if (!ct.includes('text/event-stream')) ud = somJson(t.trim());
  if (ud === undefined) {
    const poster = [];
    for (const blok of t.split(/\r?\n\r?\n/)) {
      const data = blok.split(/\r?\n/).filter(l => /^data:/.test(l)).map(l => l.replace(/^data: ?/, '')).join('\n');
      const o = data ? somJson(data) : undefined;
      if (o !== undefined) poster.push(o);
    }
    ud = poster.length === 1 ? poster[0] : poster.length ? poster.flat() : undefined;
  }
  if (ud === undefined || ud === null || typeof ud !== 'object') return null;
  return Array.isArray(ud) ? ud : [ud];
}

/* Ét POST uden Origin, uden viderestilling, med loft og timeout - gennem netvagten.
 * Aldrig en undtagelse: { status, ct, tekst } eller { fejl: 'blokeret'|'timeout'|'unreachable'|'stor' }.
 * Kalderen goer alle fejl til den samme kode (`failed`), saa »Test« ikke er en portscanner. */
async function post(url, noegle, krop, timeoutMs, tilladPrivat) {
  const data = Buffer.from(JSON.stringify(krop));
  try {
    const r = await netvagt.hent(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer ' + noegle,
        'User-Agent': 'Kokkeri'
      },
      body: data,
      timeoutMs,
      maksBytes: MAKS_SVAR,
      tilladPrivat: !!tilladPrivat
    });
    return { status: r.status, ct: String(r.headers['content-type'] || ''), tekst: r.buf.toString('utf8') };
  } catch (e) {
    return { fejl: e.kode || 'unreachable' };
  }
}

function opret({ setting, setSetting, log, timeoutMs, cacheMs }) {
  const advar = besked => (log || console.log)('[huti] advarsel: ' + besked);
  const TIMEOUT = timeoutMs || Number(process.env.KOKKERI_HUTI_TIMEOUT_MS) || 10000;
  const CACHE = cacheMs != null ? cacheMs : CACHE_MS;
  let cache = null;                    // { base, at, data }
  let naesteId = 1;

  const base = () => rensBase(setting('huti_url', ''));
  const noegle = () => String(setting('huti_key', '') || '');
  /* Maa den GEMTE adresse vaere intern? Kun hvis en admin forbandt (netvagten). */
  const privat = () => setting('huti_privat', '') === '1';
  function status() {
    try { const s = JSON.parse(setting('huti_status', '') || 'null'); return s && typeof s === 'object' ? s : null; } catch (e) { return null; }
  }
  const gemStatus = s => setSetting('huti_status', JSON.stringify(s));

  /** Hvad fladen maa se - ALDRIG noeglen. */
  function offentlig() {
    const s = status();
    return {
      hutiUrl: setting('huti_url', ''),
      hutiKeySet: !!noegle(),
      hutiSet: !!(base() && noegle()),
      hutiCanWrite: !!(s && s.canWrite),
      hutiStatus: s ? { at: s.at || null, ok: !!s.ok, total: s.total ?? null, eatSoon: s.eatSoon ?? null, canWrite: !!s.canWrite, kode: s.kode || null } : null
    };
  }

  /** Et eller flere JSON-RPC-kald. -> { ok, svar: [result|{error}] } eller fejl(kode). */
  async function rpc(b, k, kald, tilladPrivat) {
    const krop = kald.map(c => ({ jsonrpc: '2.0', id: naesteId++, method: c.method, params: c.params || {} }));
    const r = await post(b + '/mcp', k, krop.length === 1 ? krop[0] : krop, TIMEOUT, tilladPrivat === undefined ? privat() : tilladPrivat);
    if (r.fejl) { advar(`${kald.map(c => c.params && c.params.name || c.method).join('+')}: ${r.fejl}`); return fejl('failed'); }
    if (r.status === 401 || r.status === 403) { advar('noeglen afvist (' + r.status + ')'); return fejl('bad_key'); }
    if (r.status < 200 || r.status >= 300) { advar('svarede ' + r.status); return fejl('failed'); }
    const svar = laesSvar(r.tekst, r.ct);
    if (!svar) { advar('ulaeseligt svar'); return fejl('failed'); }
    const ud = krop.map(k2 => {
      const s = svar.find(x => x && typeof x === 'object' && x.id === k2.id);
      if (!s || s.error || !s.result || typeof s.result !== 'object') return { error: true };
      return s.result;
    });
    return { ok: true, svar: ud };
  }

  /** Beholdningen fra et `pantry_for_planning`-svar -> renset. null = ulaeseligt. */
  function beholdningAf(result) {
    if (!result || result.error || result.isError) return null;
    const sc = result.structuredContent;
    if (!sc || typeof sc !== 'object' || !Array.isArray(sc.items)) return null;
    const items = sc.items.slice(0, MAKS_VARER).map(rensVare).filter(Boolean);
    const total = heltal(sc.total, 0, 1e7);
    const eatSoon = heltal(sc.eatSoon, 0, 1e7);
    return { items, total: total == null ? items.length : total, eatSoon: eatSoon == null ? items.filter(v => v.soon).length : eatSoon,
      today: datoEllerNull(sc.today) };
  }

  /** Proev en adresse + noegle: beholdningen og om noeglen kan skrive. */
  async function proev(b, k, tilladPrivat) {
    const r = await rpc(b, k, [{ method: 'tools/call', params: { name: 'pantry_for_planning', arguments: {} } }, { method: 'tools/list' }], tilladPrivat);
    if (!r.ok) return r;
    const beh = beholdningAf(r.svar[0]);
    if (!beh) { advar('pantry_for_planning gav intet brugbart svar (er det en huti?)'); return fejl('failed'); }
    const vt = r.svar[1] && Array.isArray(r.svar[1].tools) ? r.svar[1].tools : [];
    const canWrite = vt.some(t => t && t.name === 'take_stock');
    return { ok: true, beholdning: beh, canWrite };
  }

  /** Forbind: proever FOERST og gemmer kun ved succes. Samme adresse uden noegle genbruger den gemte.
   *  `tilladPrivat`: maa adressen vaere intern? (server.js: kun admin forbinder, saa true dér). */
  async function forbind({ url, key, tilladPrivat }) {
    const b = rensBase(url);
    if (!b) return fejl('bad_url');
    const ny = String(key == null ? '' : key).trim();
    const gemtBase = base();
    let k = ny;
    if (!k) {
      if (!noegle() || b !== gemtBase) return fejl('need_key');
      k = noegle();
    }
    if (k.length > 300 || /\s/.test(k)) return fejl('bad_key');
    const r = await proev(b, k, !!tilladPrivat);
    if (!r.ok) return r;
    setSetting('huti_url', b);
    setSetting('huti_key', k);
    setSetting('huti_privat', tilladPrivat ? '1' : '');
    gemStatus({ at: new Date().toISOString(), ok: true, total: r.beholdning.total, eatSoon: r.beholdning.eatSoon, canWrite: r.canWrite });
    cache = { base: b, at: Date.now(), data: r.beholdning };
    return { ok: true, total: r.beholdning.total, eatSoon: r.beholdning.eatSoon, canWrite: r.canWrite };
  }

  async function test() {
    const b = base(); const k = noegle();
    if (!b || !k) return fejl('not_set');
    const r = await proev(b, k);
    const s = status() || {};
    if (!r.ok) {
      gemStatus(Object.assign({}, s, { at: new Date().toISOString(), ok: false, kode: r.kode }));
      return r;
    }
    gemStatus({ at: new Date().toISOString(), ok: true, total: r.beholdning.total, eatSoon: r.beholdning.eatSoon, canWrite: r.canWrite });
    cache = { base: b, at: Date.now(), data: r.beholdning };
    return { ok: true, total: r.beholdning.total, eatSoon: r.beholdning.eatSoon, canWrite: r.canWrite };
  }

  function afbryd() {
    setSetting('huti_url', '');
    setSetting('huti_key', '');
    setSetting('huti_status', '');
    setSetting('huti_privat', '');
    cache = null;
    return { ok: true };
  }

  /** Beholdningen (cachet). -> { ok, items, total, eatSoon, at } eller fejl. */
  async function beholdning({ frisk } = {}) {
    const b = base(); const k = noegle();
    if (!b || !k) return fejl('not_set');
    if (!frisk && cache && cache.base === b && Date.now() - cache.at < CACHE) return Object.assign({ ok: true, at: cache.at }, cache.data);
    const r = await rpc(b, k, [{ method: 'tools/call', params: { name: 'pantry_for_planning', arguments: {} } }]);
    if (!r.ok) return r;
    const beh = beholdningAf(r.svar[0]);
    if (!beh) { advar('pantry_for_planning gav intet brugbart svar'); return fejl('failed'); }
    cache = { base: b, at: Date.now(), data: beh };
    return Object.assign({ ok: true, at: cache.at }, beh);
  }

  /** hutis indkoebsliste (kun de aabne poster), renset. ALTID et friskt kald - ét klik i
   *  fladen = ét kald, ingen cache og ingen nye forsoeg. Kokkeri skriver INTET tilbage;
   *  en laesenoegle er nok. -> { ok, items, total } eller fejl(kode). */
  async function indkoeb() {
    const b = base(); const k = noegle();
    if (!b || !k) return fejl('not_set');
    const r = await rpc(b, k, [{ method: 'tools/call', params: { name: 'shopping_list', arguments: {} } }]);
    if (!r.ok) return r;
    const poster = indkoebAf(r.svar[0]);
    if (!poster) { advar('shopping_list gav intet brugbart svar (aeldre huti uden indkoebsliste?)'); return fejl('failed'); }
    return { ok: true, items: poster.map(x => Object.assign(x, { line: postTekst(x) })), total: poster.length };
  }

  /** »Tag ud i huti« - kun efter et klik, kun med en skrivenoegle.
   *  Sikkerhedsreviewet (14/10-2026): en skrivenoegle i huti giver ALLE hutis skrivevaerktoejer,
   *  og take_stock tager ethvert lager-id ud - ogsaa ammunition. Kokkeri tager derfor KUN et id
   *  ud, der stod i seneste `pantry_for_planning` (madvarer; cachet hoejst 3 min, ellers hentes
   *  den igen), og maengden er et helt tal 1-10 (uden maengde = hutis standard, én). */
  async function tagUd(stockId, maengde) {
    const b = base(); const k = noegle();
    if (!b || !k) return fejl('not_set');
    const id = heltal(stockId, 1, 1e12);
    if (!id) return fejl('refused');
    const beh = await beholdning({});
    if (!beh.ok) return beh;
    if (!beh.items.some(v => v.id === id)) { advar(`tag ud afvist: #${id} er ikke en madvare i seneste beholdning`); return fejl('refused'); }
    const args = { stock: '#' + id, how: 'used' };
    const m = Math.round(Number(maengde));
    if (maengde != null && maengde !== '' && Number.isFinite(m)) args.amount = Math.min(10, Math.max(1, m));
    const r = await rpc(b, k, [{ method: 'tools/call', params: { name: 'take_stock', arguments: args } }]);
    if (!r.ok) return r;
    const res = r.svar[0];
    cache = null;                       // beholdningen er aendret (eller burde vaere det)
    if (res.error || res.isError) {
      const tekst = res.content && res.content[0] && String(res.content[0].text || '');
      if (/changes data|read access/i.test(tekst)) return fejl('read_only');
      return fejl('refused');
    }
    const sc = res.structuredContent && typeof res.structuredContent === 'object' ? res.structuredContent : {};
    const v = rensVare(Object.assign({}, sc.stock || {}, { status: 'ok' }));
    const taget = Number(sc.taken);
    return { ok: true, taken: Number.isFinite(taget) ? taget : null, stock: v ? { id: v.id, name: v.name, quantity: v.quantity, unit: v.unit } : null };
  }

  return { offentlig, forbind, test, afbryd, beholdning, indkoeb, tagUd, glemCache: () => { cache = null; } };
}

module.exports = { opret, rensBase, rensVare, rensPost, indkoebAf, postTekst, laesSvar, vareLinje, maengdeTekst, rens, ENHEDER, BESKED };
