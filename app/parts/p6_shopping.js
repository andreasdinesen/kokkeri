/* ---------------- Indkøbsliste ---------------- */
/* Grupperes pr. butiksafdeling (standard) eller pr. opskrift. Afdelingen
 * gaettes regelbaseret ved tilfoejelse; AI kan sortere resten. */

function shopSectionOf(i) { return i.section || guessSection(i.text) || 'Andet'; }
function shopGroupBy() {
  try { return localStorage.getItem('kk_shopgroup') || 'section'; } catch (e) { return 'section'; }
}
/* vis hvilken opskrift varen kom fra? Paa mobil fylder det meget, saa det
 * kan slaas fra. (I "Pr. opskrift" er navnet allerede overskriften.) */
function shopShowGroup() {
  try { return localStorage.getItem('kk_shopgrp') !== '0'; } catch (e) { return true; }
}

/* ---------------- tilbud pr. vare (v49) ----------------
 * Serveren matcher varerne mod ugens tilbud i brugerens butikker
 * (/api/tilbud/varer - tilbudForVarer i mcp.js). Svaret huskes, til listen
 * aendrer sig; tilbuddene selv caches 3 timer paa serveren.
 * Filteret: '' = alle varer, '*' = kun varer paa tilbud, ellers et butiksnavn. */
function tilbudSlaaetTil() { return !!(S.settings.tilbud && (S.settings.tilbud.butikker || []).length); }
function tilbudFilter() {
  try { return localStorage.getItem('kk_tilbudfilter') || ''; } catch (e) { return ''; }
}
function tilbudFor(i) { return (S.tilbudVarer && S.tilbudVarer[i.id]) || []; }
/* Det tilbud, chippen viser: filterets butik - ellers det billigste. */
function tilbudVist(i) {
  const t = tilbudFor(i), f = tilbudFilter();
  return f && f !== '*' ? t.find(o => o.butik === f) : t[0];
}
function tilbudVisesVare(i) {
  const f = tilbudFilter();
  if (!f || !S.tilbudVarer) return true;
  return f === '*' ? tilbudFor(i).length > 0 : tilbudFor(i).some(o => o.butik === f);
}
const kr = v => v == null ? '' : String(v).replace('.', ',') + ' kr';

async function hentTilbudForListen() {
  if (!tilbudSlaaetTil()) { S.tilbudVarer = null; return; }
  const varer = K('shopItem').filter(i => !i.done).map(i => ({ id: i.id, text: i.text }));
  const noegle = varer.map(v => v.id + v.text).join('|') + '#' + JSON.stringify(S.settings.tilbud.butikker);
  if (noegle === S.tilbudNoegle || S.tilbudHenter) return;
  S.tilbudHenter = true;
  try {
    const r = await api('/api/tilbud/varer', { body: { varer } });
    S.tilbudVarer = r.tilbud || {};
    S.tilbudNoegle = noegle;
  } catch (e) {
    S.tilbudNoegle = noegle;     // proev ikke igen ved hver optegning
    S.tilbudFejl = e.message;
  }
  S.tilbudHenter = false;
  if (S.view === 'shopping') render();
}

function tilbudChipHtml(i) {
  if (i.done) return '';
  const vist = tilbudVist(i);
  if (!vist) return '';
  const alle = tilbudFor(i);
  const titel = alle.map(o => `${o.butik}: ${o.titel} – ${kr(o.pris)}${o.foerpris ? ' (før ' + kr(o.foerpris) + ')' : ''}${o.til ? ', til ' + fmtDate(o.til) : ''}`).join('\n');
  return `<button type="button" class="tilbudchip" data-tilbud="${i.id}" title="${esc(titel)}">🏷️ ${esc(vist.butik)} ${esc(kr(vist.pris))}${
    alle.length > 1 ? ` <span class="tilbudmere">+${alle.length - 1}</span>` : ''}</button>`;
}
function tilbudDetaljeHtml(i) {
  if (!S.tilbudAaben || S.tilbudAaben !== i.id) return '';
  return `<li class="tilbuddetalje">${tilbudFor(i).map(o => `<span>🏷️ <b>${esc(o.butik)}</b> ${esc(o.titel)} – <b>${esc(kr(o.pris))}</b>${
    o.foerpris ? ` <s class="muted">${esc(kr(o.foerpris))}</s>` : ''}${o.maengde ? ` <span class="muted">· ${esc(o.maengde)}</span>` : ''}${
    o.til ? ` <span class="muted">· til ${esc(fmtDate(o.til))}</span>` : ''}</span>`).join('')}</li>`;
}
function tilbudFilterHtml(open) {
  if (!tilbudSlaaetTil()) return '';
  if (!S.tilbudVarer) return `<div class="rowflex tilbudfilter"><span class="small muted">🏷️ Henter tilbud …</span></div>`;
  const f = tilbudFilter();
  const paaTilbud = open.filter(i => tilbudFor(i).length);
  const prButik = new Map();
  for (const i of paaTilbud) for (const o of tilbudFor(i)) prButik.set(o.butik, (prButik.get(o.butik) || 0) + 1);
  const chip = (vaerdi, tekst) => `<span class="chip chipbtn${f === vaerdi ? ' sel' : ''}" data-tilbudfilter="${esc(vaerdi)}">${tekst}</span>`;
  return `<div class="rowflex tilbudfilter">
    <span class="small muted">🏷️ Tilbud:</span>
    ${chip('', 'Alle varer')}
    ${chip('*', `På tilbud (${paaTilbud.length})`)}
    ${[...prButik.entries()].sort((a, b) => b[1] - a[1]).map(([b, n]) => chip(b, `${esc(b)} (${n})`)).join('')}
  </div>`;
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
  if (tilbudSlaaetTil()) hentTilbudForListen();
  const f = tilbudFilter();
  const vistAaben = open.filter(tilbudVisesVare);

  const visGruppe = shopShowGroup();
  const listHtml = arr => {
    let out = '', lastGroup = null;
    for (const i of arr) {
      const g = keyOf(i);
      if (g !== lastGroup) { out += `<li class="shopgroup">${esc(g)}</li>`; lastGroup = g; }
      out += `<li class="${i.done ? 'done' : ''}" data-shop="${i.id}">
        <input type="checkbox" ${i.done ? 'checked' : ''}>
        <span class="shopmain">
          <span class="txt">${esc(i.text)}</span>
          ${bySection && i.group && visGruppe ? `<span class="grp">${esc(i.group)}</span>` : ''}
        </span>
        ${tilbudChipHtml(i)}
        <button class="iconbtn" data-del="${i.id}" title="Fjern">✕</button>
      </li>${tilbudDetaljeHtml(i)}`;
    }
    return out;
  };

  const pantry = K('pantryItem').slice().sort((a, b) =>
    String(a.expires || '9999').localeCompare(String(b.expires || '9999')) ||
    String(a.text).localeCompare(String(b.text), 'da'));
  const soon = addDays(isoDate(), 7);

  return pageHead('Indkøbsliste', `${open.length} varer mangler`,
      `<div class="rowflex shoptools">
        <button class="btn" id="shopPrint">🖨️ Print</button>
        <button class="btn" id="shopMerge" ${open.length > 1 ? '' : 'disabled'}>🧮 Læg ens varer sammen</button>
        ${S.settings.aiKeySet && open.length ? `<button class="btn" id="shopAiSort" title="AI gennemgår alle ${open.length} varer og flytter dem, der ligger i en forkert afdeling">✨ Sortér med AI</button>` : ''}
        ${S.settings.haSet ? '<button class="btn" id="shopHa">🏠 Send til Home Assistant</button>' : ''}
        ${S.settings.todoistSet ? '<button class="btn" id="shopTd">✅ Send til Todoist</button>' : ''}
        ${S.settings.dodaSet ? '<button class="btn" id="shopDoda">☑️ Send til doda</button>' : ''}
        <button class="btn" id="shopClearDone" ${done.length ? '' : 'disabled'}>Ryd afkrydsede</button>
        <button class="btn danger" id="shopClearAll" ${items.length ? '' : 'disabled'}>Tøm listen</button>
      </div>`) + `
  <div class="rowflex" style="margin-bottom:4px">
    <span class="chip chipbtn${bySection ? ' sel' : ''}" data-grp="section">Pr. afdeling</span>
    <span class="chip chipbtn${bySection ? '' : ' sel'}" data-grp="recipe">Pr. opskrift</span>
    ${bySection ? `<span class="chip chipbtn${visGruppe ? ' sel' : ''}" id="shopToggleGrp"
      title="Vis eller skjul hvilken opskrift varen kom fra">🏷️ Vis opskrift</span>` : ''}
  </div>
  ${tilbudFilterHtml(open)}
  <div class="panelbox">
    <div class="rowflex">
      <input id="shopNew" placeholder="Tilføj vare – fx 2 L mælk" style="flex:1;min-width:200px">
      <button class="btn primary" id="shopAdd">Tilføj</button>
    </div>
    ${f && S.tilbudVarer ? `<p class="small muted" style="margin:10px 0 0">Viser ${vistAaben.length} af ${open.length} varer – ${
      f === '*' ? 'dem, der er på tilbud et sted' : `dem, der er på tilbud i ${esc(f)}`}.</p>` : ''}
    <ul class="shoplist">${listHtml(vistAaben) || (open.length && f
      ? '<li class="muted" style="border:0">Ingen af varerne er på tilbud her lige nu.</li>'
      : '<li class="muted" style="border:0">Listen er tom 🎉</li>')}</ul>
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
  $$('[data-tilbudfilter]').forEach(c => c.onclick = () => {
    try { localStorage.setItem('kk_tilbudfilter', c.dataset.tilbudfilter); } catch (e) {}
    S.tilbudAaben = null;
    render();
  });
  $$('[data-tilbud]').forEach(c => c.onclick = e => {
    e.stopPropagation();
    S.tilbudAaben = S.tilbudAaben === c.dataset.tilbud ? null : c.dataset.tilbud;
    render();
  });
  $$('[data-grp]').forEach(c => c.onclick = () => {
    try { localStorage.setItem('kk_shopgroup', c.dataset.grp); } catch (e) {}
    render();
  });
  const tg = $('#shopToggleGrp');
  if (tg) tg.onclick = () => {
    try { localStorage.setItem('kk_shopgrp', shopShowGroup() ? '0' : '1'); } catch (e) {}
    render();
  };

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

  const doda = $('#shopDoda');
  if (doda) doda.onclick = async () => {
    doda.disabled = true;
    doda.textContent = '☑️ Sender …';
    try {
      /* Afdelingen gaettes i browseren (guessSection) - send den med, saa
       * noten i doda siger "Koed & fisk" ligesom listen her. */
      const afdelinger = {};
      for (const i of K('shopItem')) if (!i.done) afdelinger[i.id] = shopSectionOf(i);
      const r = await api('/api/doda/push-shopping', { body: { afdelinger } });
      toast(`${r.pushed} varer sendt til doda` + (r.failed ? ` (${r.failed} fejlede)` : ''));
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
  /* v49: Print foelger tilbudsfilteret - "hvad skal koebes i Kvickly" paa papir */
  const items = K('shopItem').filter(i => !i.done && tilbudVisesVare(i));
  const f = S.tilbudVarer ? tilbudFilter() : '';
  const keyOf = i => bySection ? shopSectionOf(i) : (i.group || 'Andet');
  const sortKey = i => bySection
    ? String(SHOP_SECTIONS.indexOf(shopSectionOf(i))).padStart(2, '0') : (i.group || 'zzz');
  let lastGroup = null, rows = '';
  for (const i of items.slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'da'))) {
    const g = keyOf(i);
    if (g !== lastGroup) { rows += `<h2>${esc(g)}</h2>`; lastGroup = g; }
    const o = f ? tilbudVist(i) : null;
    rows += `<p style="margin:2px 0">☐ ${esc(i.text)}${o ? ` <small>– tilbud: ${esc(o.titel)} ${esc(kr(o.pris))}</small>` : ''}</p>`;
  }
  const overskrift = f === '*' ? 'Indkøbsliste – varer på tilbud' : f ? 'Indkøbsliste – tilbud i ' + f : 'Indkøbsliste';
  printSheet(`${printLogoHtml()}<h1>${esc(overskrift)}</h1>${rows}<p class="pdate">${fmtDate(isoDate())}</p>`, 'Indkoebsliste');
}

/* Afdelingssvaret: {"1": "Kolonial", ...}. Laeses par for par i stedet for som
 * ét JSON-objekt (v48) - saa et klippet svar, en kommentar efter objektet
 * eller et manglende komma ikke smider ALT vaek; varer uden svar roeres ikke.
 * Kun afdelinger fra SHOP_SECTIONS godtages. */
function afdelingsSvar(text) {
  const s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const map = {};
  for (const m of s.matchAll(/"?(\d{1,3})"?\s*[:=]\s*"([^"\n]{2,40})"/g)) {
    if (SHOP_SECTIONS.includes(m[2].trim())) map[m[1]] = m[2].trim();
  }
  return map;
}

/* v47: AI GENNEMGAAR HELE LISTEN - ikke kun de varer, reglerne ikke kender.
 * Reglerne gaetter forkert paa sammensatte ord (flormelis -> Frost foer v47),
 * og en afdeling, der én gang er gemt paa varen, bliver staaende. Varerne
 * sendes nummereret (ens tekster og AI'ens stavning kan ikke forvirre
 * opslaget), og kun de varer, AI'en flytter, gemmes. */
async function aiSortSections(btn) {
  const varer = K('shopItem').filter(i => !i.done);
  if (!varer.length) return;
  btn.disabled = true;
  btn.textContent = '✨ Gennemgår …';
  try {
    const sys = `Du sorterer dagligvarer i supermarkeds-afdelinger i en dansk butik. Du får en nummereret
liste med varer og den afdeling, varen ligger i nu. Svar KUN med ét JSON-objekt, der mapper HVERT nummer
til præcis én af disse afdelinger: ${JSON.stringify(SHOP_SECTIONS)}.
Tænk på, hvor varen står i butikken: flormelis og majsmel er Kolonial, kyllingebouillon er Krydderier,
frosne ærter er Frost. Ret de varer, der ligger forkert – behold dem, der ligger rigtigt.
Format: {"1": "afdeling", "2": "afdeling", ...}`;
    const flyttet = [];
    let uset = 0;
    /* 40 ad gangen med rigeligt loft (v48): 113 varer i ét hug blev klippet
     * midt i svaret, og saa kunne intet laeses. */
    for (let fra = 0; fra < varer.length; fra += 40) {
      const bid = varer.slice(fra, fra + 40);
      btn.textContent = `✨ Gennemgår ${Math.min(fra + bid.length, varer.length)}/${varer.length} …`;
      const liste = bid.map((it, n) => `${n + 1}. ${it.text} (nu: ${shopSectionOf(it)})`).join('\n');
      const r = await api('/api/ai', {
        body: { system: sys, messages: [{ role: 'user', content: liste }], maxTokens: Math.min(8192, 800 + bid.length * 40), effort: 'low' }
      });
      const map = afdelingsSvar(r.text);
      if (!Object.keys(map).length) {
        console.warn('[sortér med AI] svaret kunne ikke læses:', r.stop, r.text);
        throw new Error((r.stop === 'max_tokens' || r.stop === 'length' ? 'AI-svaret blev skåret af.' : 'AI-svaret kunne ikke læses.') + aiSvarUddrag(r.text));
      }
      bid.forEach((it, n) => {
        const sec = map[String(n + 1)];
        if (!sec) { uset++; return; }
        if (!SHOP_SECTIONS.includes(sec) || sec === shopSectionOf(it)) return;
        flyttet.push({ it, til: sec });
        it.section = sec;
      });
    }
    if (flyttet.length) await saveBulk(flyttet.map(f => f.it));
    const vis = flyttet.slice(0, 3).map(f => `${parseShopText(f.it.text).name || f.it.text} → ${f.til}`).join(', ');
    const tjekket = varer.length - uset;
    toast((flyttet.length
      ? `AI gennemgik ${tjekket} varer og flyttede ${flyttet.length}: ${vis}${flyttet.length > 3 ? ' …' : ''}`
      : `AI gennemgik ${tjekket} varer – de ligger alle rigtigt`)
      + (uset ? ` (${uset} kom ikke med i svaret – tryk igen for at tjekke dem)` : ''));
  } catch (e) {
    toast('Kunne ikke sortere: ' + e.message, true);
  }
  render();
}
