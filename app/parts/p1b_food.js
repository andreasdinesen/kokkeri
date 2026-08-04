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

/* ---- gaet kategori paa en importeret opskrift ----
 * Sidens egen kategori bruges foerst, men den passer sjaeldent til ens egen
 * liste ("Baalmad", "Nem aftensmad" ...). Derfor ogsaa noegleord i titel og
 * tags: "Gullaschsuppe" -> Suppe. Mest specifikke regler foerst, saa
 * "Kartoffelsalat" bliver Salat og ikke Hovedret. */
const CAT_RULES = [
  ['Suppe', /suppe|soup\b/, 2],
  ['Salat', /salat|coleslaw/, 2],
  ['Kage & bagværk', /kage|brød|bolle|muffin|cookie|tærte|scone|croissant|cupcake|brownie|snegl|kringle|bagværk|kiks|vaffel|pandekag|klejne|marengs/, 2],
  ['Dessert', /dessert|sorbet|mousse|tiramisu|budding|kompot|trifli|panna cotta|trøffel|trøfler|creme brulee|fromage|isdessert/, 2],
  ['Morgenmad', /morgenmad|brunch|grød|havregr|müsli|granola|omelet|æggekage|smoothiebowl/, 2],
  ['Drikkevarer', /drink|smoothie|juice|cocktail|kaffe|\bte\b|saft|milkshake|lemonade|glögg|gløgg/, 2],
  ['Forret', /forret|tapas|canapé|snacks?\b/, 2],
  ['Tilbehør', /tilbehør|dressing|\bdip\b|pesto|salsa|marinade|syltede|remoulade|\bsauce\b|kompot|chutney|rødkål/, 2],
  ['Hovedret', /hovedret|aftensmad|middag|gryde|steg\b|pasta|spaghetti|lasagne|risotto|curry|burger|pizza|frikadell|wok\b|gratin|bøf|fisk|kylling|kød|tærte|ret\b/, 2]
];
function guessCategory(rec) {
  const cats = app().categories || [];
  if (!cats.length) return '';
  /* 1) sidens egen kategori mod brugerens liste. Sammenlign fra ordets START
   * ("Supper" ~ "Suppe"), IKKE som fri substring - ellers ville sidens
   * "Aftensmad" matche en kategori ved navn "Mad". Sider angiver ofte flere,
   * adskilt af komma. */
  const src = normName(rec.sourceCategory || rec.category || '');
  for (const del of src.split(/[,/|·•]+/).map(s => s.trim()).filter(Boolean)) {
    const match = cats.find(c => {
      const n = normName(c);
      return n.length >= 4 && (del === n || del.startsWith(n) || n.startsWith(del));
    });
    if (match) return match;
  }
  /* 2) noegleord i sidens kategori, tags og titel */
  const tekst = normName([src, (rec.tags || []).join(' '), rec.title || ''].join(' '));
  for (const [navn, re] of CAT_RULES) {
    if (!re.test(tekst)) continue;
    const n = normName(navn);
    const match = cats.find(c => normName(c) === n) ||
      cats.find(c => normName(c).includes(n.split(' ')[0]) || n.includes(normName(c)));
    if (match) return match;
  }
  return '';
}
/* saet kategori paa importerede opskrifter, der mangler den. Hver opskrift
 * proeves kun én gang (catChecked), saa et bevidst fjernet valg ikke kommer igen. */
async function categorizeImported() {
  const mangler = K('recipe').filter(r => !r.category && !r.catChecked && (r.url || r.sourceCategory));
  if (!mangler.length) return 0;
  let n = 0;
  for (const r of mangler) {
    const c = guessCategory(r);
    if (c) { r.category = c; n++; }
    r.catChecked = true;
  }
  await saveBulk(mangler);
  return n;
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
      /* billedet ud i sit eget item, saa opskriften bliver ved med at vaere let */
      if (rec.image && /^data:/.test(rec.image)) {
        batch.push({ id: 'img-' + rec.id, kind: 'recipeImage', dataUrl: rec.image });
        rec.imageVer = String(Date.now());
      }
      delete rec.image;
      batch.push(rec);
      out.imported++;
    } catch (e) { out.failed++; }
    if (batch.length >= 25) { await saveBulk(batch.splice(0)); }
  }
  if (batch.length) await saveBulk(batch);
  return out;
}

/* ---------------- "Hvad kan jeg lave?" ----------------
 * Opslag i BRUGERENS EGNE ingredienslister - ikke AI. Ingredienserne ligger
 * allerede som tekst pr. opskrift, og et regelbaseret match rammer praecist:
 * maalt paa 2539 opskrifter gav "kylling" 221 rigtige mod 7 falske, hvor ordet
 * kun optraadte som kyllingebouillon (dem sorterer SMAGSORD fra).
 *
 * Grupperne er kuraterede regexer - samme moenster som SECTION_RULES og
 * CAT_RULES - fordi danske sammensatte ord ikke kan klares med praefiks alene:
 * "kylling" findes forrest i kyllingebryst, men "koed" staar BAGEST i oksekoed
 * og hakkekoed. Taellingen og raekkefoelgen kommer derimod fra biblioteket, saa
 * listen foelger med, naar det vokser, og tomme grupper skjules. */
const SMAGSORD = /(bouillon|fond|suppeterning|krydderi|essens|aroma|ekstrakt)/;
/* Tredje felt er RAEKKEFOELGEN: 1 = koed og fisk, 2 = groent og kulhydrat,
 * 3 = basisvarer. Sorteres der kun efter antal, ligger "Floede & maelk" (853)
 * og "Ost" (583) oeverst - men man vaelger sjaeldent en ret ud fra, at man har
 * maelk. Inden for hver gruppe afgoer antallet i BRUGERENS bibliotek. */
const RAAVARE_GRUPPER = [
  ['Kylling',         /kylling|unghane|hønse|hane\b/, 1],
  ['Hakket kød',      /hakket (okse|svine|kalve|lamme|kyllinge|kalkun)?kød|hakkekød|hakket (okse|svin|kalv|lam)|\bfars\b|oksefars|svinefars|kødfars/, 1],
  ['Oksekød',         /oksekød|okseinderlår|culotte|entrecote|ribeye|bøf(?!fel)|okseklump|tyndstegsfilet|højreb/, 1],
  ['Svinekød',        /svinekød|flæsk|nakkefilet|svinemørbrad|kotelet|bacon|skinke|pancetta/, 1],
  ['Lam',             /lammekød|lammekølle|lammefilet|lammekotelet|\blam\b/, 1],
  ['Kalkun',          /kalkun/, 1],
  ['Fisk',            /laks|torsk|rødspætte|makrel|tun\b|sej\b|kulmule|hellefisk|fiskefilet|\bfisk\b/, 1],
  ['Skaldyr',         /rejer|muslinger|krebse|hummer|blæksprutte|jomfruhummer/, 1],
  ['Æg',              /\bæg\b|æggeblomme|æggehvide/, 1],
  ['Pasta',           /pasta|spaghetti|penne|tagliatelle|lasagne|makaroni|fusilli|orzo/, 2],
  ['Ris',             /\bris\b|risotto|jasminris|basmati|grødris/, 2],
  ['Kartofler',       /kartof/, 2],
  ['Bønner & linser', /kikærter|linser|kidneybønner|sorte bønner|hvide bønner|bønner/, 2],
  ['Svampe',          /champignon|svampe|portobello|karljohan|shiitake/, 2],
  ['Broccoli & kål',  /broccoli|blomkål|spidskål|hvidkål|rødkål|grønkål|rosenkål/, 2],
  ['Tomater',         /tomat/, 2],
  ['Squash & auberginer', /squash|zucchini|aubergine/, 2],
  ['Spinat',          /spinat/, 2],
  ['Ost',             /\bost\b|mozzarella|feta|parmesan|cheddar|flødeost/, 3],
  ['Fløde & mælk',    /piskefløde|madlagningsfløde|\bfløde\b|\bmælk\b|kærnemælk|creme fraiche|cremefraiche/, 3]
];
const raaNorm = s => String(s || '').toLowerCase().replace(/[^a-zæøå0-9 ]/g, ' ').replace(/\s+/g, ' ');
/* Fritekst bliver til et almindeligt delstrengs-match: paa dansk staar hovedordet
 * tit sidst i et sammensat ord ("porre" i "forårsporrer"), saa praefiks duer ikke. */
const raaFritRe = tekst => {
  const t = raaNorm(tekst).trim();
  return t.length < 3 ? null : new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
};

/* Ingredienslinjerne uden sektions-overskrifter, normaliseret. Caches pr.
 * opskrift, saa 2539 opskrifter x 20 regexer ikke koeres ved hver render. */
function raavareLinjer(r) {
  const noegle = r.id + '|' + (r.updatedAt || '');
  if (!S._raaLinjer) S._raaLinjer = new Map();
  let v = S._raaLinjer.get(noegle);
  if (!v) {
    v = (r.ingredients || []).filter(l => !/^##/.test(l)).map(raaNorm);
    S._raaLinjer.set(noegle, v);
  }
  return v;
}
/* Matcher opskriften raavaren? Linjer hvor ordet KUN optraeder som smagsgiver
 * (kyllingebouillon, oksefond) taeller ikke - retten er ikke en kyllingeret. */
function harRaavare(r, re) {
  const traef = raavareLinjer(r).filter(l => re.test(l));
  return traef.length > 0 && !traef.every(l => SMAGSORD.test(l));
}
/* Hvor mange af de valgte raavarer har opskriften? */
function raavareTraef(r, valgte) {
  let n = 0;
  for (const v of valgte) if (v.re && harRaavare(r, v.re)) n++;
  return n;
}
/* Grupper med antal, stoerste foerst. Tomme grupper vises ikke. */
function raavareListe() {
  const rec = K('recipe');
  return RAAVARE_GRUPPER
    .map(([navn, re, rang]) => ({ navn, re, rang: rang || 2, n: rec.reduce((a, r) => a + (harRaavare(r, re) ? 1 : 0), 0) }))
    .filter(g => g.n > 0)
    .sort((a, b) => a.rang - b.rang || b.n - a.n);
}
/* De valgte (grupper + fritekst) som {navn, re}-objekter */
function valgteRaavarer() {
  return (S.recFilter.raavarer || []).map(navn => {
    const g = RAAVARE_GRUPPER.find(x => x[0] === navn);
    return { navn, re: g ? g[1] : raaFritRe(navn) };
  }).filter(v => v.re);
}
