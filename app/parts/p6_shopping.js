/* ---------------- Indkøbsliste ---------------- */
RENDER.shopping = () => {
  const items = K('shopItem').slice().sort((a, b) =>
    String(a.group || 'zzz').localeCompare(String(b.group || 'zzz'), 'da') ||
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const open = items.filter(i => !i.done), done = items.filter(i => i.done);

  const listHtml = arr => {
    let out = '', lastGroup = null;
    for (const i of arr) {
      const g = i.group || 'Andet';
      if (g !== lastGroup) { out += `<li class="shopgroup">${esc(g)}</li>`; lastGroup = g; }
      out += `<li class="${i.done ? 'done' : ''}" data-shop="${i.id}">
        <input type="checkbox" ${i.done ? 'checked' : ''}>
        <span class="txt">${esc(i.text)}</span>
        <button class="iconbtn" data-del="${i.id}" title="Fjern">✕</button>
      </li>`;
    }
    return out;
  };

  return pageHead('Indkøbsliste', `${open.length} varer mangler`,
      `<div class="rowflex">
        <button class="btn" id="shopPrint">🖨️ Print</button>
        <button class="btn" id="shopClearDone" ${done.length ? '' : 'disabled'}>Ryd afkrydsede</button>
        <button class="btn danger" id="shopClearAll" ${items.length ? '' : 'disabled'}>Tøm listen</button>
      </div>`) + `
  <div class="panelbox">
    <div class="rowflex">
      <input id="shopNew" placeholder="Tilføj vare – fx 2 L mælk" style="flex:1;min-width:200px">
      <button class="btn primary" id="shopAdd">Tilføj</button>
    </div>
    <ul class="shoplist">${listHtml(open) || '<li class="muted" style="border:0">Listen er tom 🎉</li>'}</ul>
    ${done.length ? `<h3 class="muted">Afkrydset (${done.length})</h3><ul class="shoplist">${listHtml(done)}</ul>` : ''}
  </div>
  <p class="small muted">Tilføj en hel opskrift fra opskriftens side (🛒) eller hele ugen fra madplanen.</p>`;
};
RENDER.shopping_bind = () => {
  const add = async () => {
    const el = $('#shopNew');
    const text = el.value.trim();
    if (!text) return;
    await saveItem({ id: uid(), kind: 'shopItem', text, group: '', done: false, createdAt: new Date().toISOString() }, true);
    render();
    setTimeout(() => { const n = $('#shopNew'); if (n) n.focus(); }, 30);
  };
  $('#shopAdd').onclick = add;
  $('#shopNew').onkeydown = e => { if (e.key === 'Enter') add(); };
  $('#shopNew').focus();

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
  $('#shopPrint').onclick = () => {
    const items = K('shopItem').filter(i => !i.done);
    let lastGroup = null, rows = '';
    for (const i of items.slice().sort((a, b) => String(a.group || 'zzz').localeCompare(String(b.group || 'zzz'), 'da'))) {
      const g = i.group || 'Andet';
      if (g !== lastGroup) { rows += `<h2>${esc(g)}</h2>`; lastGroup = g; }
      rows += `<p style="margin:2px 0">☐ ${esc(i.text)}</p>`;
    }
    printSheet(`${printLogoHtml()}<h1>Indkøbsliste</h1>${rows}<p class="pdate">${fmtDate(isoDate())}</p>`);
  };
};
