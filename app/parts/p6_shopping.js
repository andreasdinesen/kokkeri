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
      `<div class="rowflex shoptools">
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
    ${bySection ? `<span class="chip chipbtn${visGruppe ? ' sel' : ''}" id="shopToggleGrp"
      title="Vis eller skjul hvilken opskrift varen kom fra">🏷️ Vis opskrift</span>` : ''}
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
  printSheet(`${printLogoHtml()}<h1>Indkøbsliste</h1>${rows}<p class="pdate">${fmtDate(isoDate())}</p>`, 'Indkoebsliste');
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
    const map = parseAiJson(r.text, false);
    if (!map) throw new Error('AI-svaret kunne ikke læses.' + aiSvarUddrag(r.text));
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