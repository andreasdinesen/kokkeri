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
      if (e) planQuickView(e);
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
/* Hvilke kategorier maa autofyldet traekke fra? Uden filter ender saucer,
 * smoothies og salater som aftensmad. Valget huskes i localStorage. */
function fillCats() {
  const cats = app().categories || [];
  try {
    const gemt = JSON.parse(localStorage.getItem('kk_fillcats') || 'null');
    if (Array.isArray(gemt)) return gemt;
  } catch (e) {}
  const hoved = cats.find(c => normName(c) === 'hovedret');
  return hoved ? [hoved] : cats.slice();
}
function autoFillWeek() {
  const monday = S.weekStart || mondayOf();
  const dates = weekDatesOf(monday);
  const free = dates.filter(d => !K('planEntry').some(e => e.date === d && slotOf(e) === 'dinner'));
  if (!free.length) return toast('Alle ugens dage har allerede noget på madplanen', true);
  if (!K('recipe').length) return toast('Biblioteket er tomt – tilføj nogle opskrifter først', true);

  const cats = app().categories || [];
  const valgt = new Set(fillCats());
  const antal = c => K('recipe').filter(r => (r.category || '') === c).length;

  openModal(`<h2>📖 Udfyld fra biblioteket</h2>
    <p class="small muted">Vælg hvilke kategorier retterne må komme fra – ellers ender fx saucer
      og drikkevarer som aftensmad. Valget huskes til næste gang.</p>
    <div style="margin:12px 0;columns:2;column-gap:24px">
      ${cats.map(c => `<label class="chk" style="padding:4px 0;break-inside:avoid">
        <input type="checkbox" data-fc="${esc(c)}" ${valgt.has(c) ? 'checked' : ''}>
        <span>${esc(c)} <span class="muted small">(${antal(c)})</span></span></label>`).join('')}
      <label class="chk" style="padding:4px 0;break-inside:avoid">
        <input type="checkbox" data-fc="" ${valgt.has('') ? 'checked' : ''}>
        <span class="muted">Uden kategori <span class="small">(${antal('')})</span></span></label>
    </div>
    <div class="rowflex">
      <button class="btn small" id="fcAll">Markér alt</button>
      <button class="btn small" id="fcMain">Kun hovedretter</button>
    </div>
    <p class="small muted" id="fcInfo" style="margin:12px 0 0"></p>
    <div class="actions">
      <button class="btn" id="fcCancel">Annullér</button>
      <button class="btn primary" id="fcGo">Udfyld ${free.length} dage</button>
    </div>`, m => {
    const bokse = () => [...m.querySelectorAll('[data-fc]')];
    const valgte = () => bokse().filter(b => b.checked).map(b => b.dataset.fc);
    const puljen = () => K('recipe').filter(r => valgte().includes(r.category || ''));
    const opdater = () => {
      const n = puljen().length;
      m.querySelector('#fcInfo').textContent = n
        ? `${n} opskrifter at vælge imellem til ${free.length} dage` + (n < free.length ? ' – nogle vil gå igen' : '')
        : 'Ingen opskrifter i de valgte kategorier';
      m.querySelector('#fcGo').disabled = !n;
    };
    bokse().forEach(b => b.onchange = opdater);
    m.querySelector('#fcAll').onclick = () => { bokse().forEach(b => b.checked = true); opdater(); };
    m.querySelector('#fcMain').onclick = () => {
      bokse().forEach(b => b.checked = normName(b.dataset.fc) === 'hovedret');
      opdater();
    };
    m.querySelector('#fcCancel').onclick = closeModal;
    m.querySelector('#fcGo').onclick = async () => {
      const v = valgte();
      try { localStorage.setItem('kk_fillcats', JSON.stringify(v)); } catch (e) {}
      closeModal();
      await doAutoFill(free, dates, puljen());
    };
    opdater();
  });
}

async function doAutoFill(free, dates, recipes) {
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

/* Hurtigt kig paa retten fra madplanen - man planlaegger tit ud fra tid og
 * ingredienser, ikke titlen alene. Fritekst-linjer har intet at vise, saa de
 * gaar direkte til redigering. */
function planQuickView(entry) {
  const r = entry.recipeId ? recipeById(entry.recipeId) : null;
  if (!r) return planEntryModal(entry);
  const base = r.servings || app().defaultServings;
  const pers = entry.servings || base;
  const factor = base ? pers / base : 1;
  const tid = recipeTotalMin(r);
  const si = slotInfo(slotOf(entry));
  const ings = (r.ingredients || []).map(l => /^##\s*/.test(l)
    ? `<li style="border:0;font-weight:700;color:var(--amber);padding-top:10px">${esc(l.replace(/^##\s*/, ''))}</li>`
    : `<li>${esc(scaleIngredient(l, factor))}</li>`).join('');

  openModal(`<div class="rowflex" style="align-items:flex-start;gap:16px;flex-wrap:nowrap">
      ${r.image ? `<img src="${r.image}" alt="" style="width:140px;height:105px;object-fit:cover;border-radius:10px;flex:none">` : ''}
      <div style="flex:1;min-width:0">
        <h2 style="margin:0 0 2px">${esc(r.title)}</h2>
        <p class="small muted" style="margin:0 0 8px">
          ${si.ico} ${si.label} · ${WEEKDAYS_DA[(new Date(entry.date + 'T00:00:00').getDay() + 6) % 7]} ${fmtDate(entry.date)}</p>
        <div class="rowflex">
          ${r.category ? `<span class="chip">${esc(r.category)}</span>` : ''}
          ${tid ? `<span class="timechip">⏱ ${fmtMin(tid)}</span>` : ''}
          <span class="timechip">🍽 ${pers} pers.</span>
          ${r.rating ? starsHtml(r.rating) : ''}
        </div>
      </div>
    </div>
    ${r.description ? `<p class="small muted" style="margin:12px 0 0">${esc(r.description.slice(0, 220))}${r.description.length > 220 ? '…' : ''}</p>` : ''}
    <h3 style="margin-bottom:2px">Ingredienser${factor !== 1 ? ' <span class="chip on small">skaleret</span>' : ''}</h3>
    <ul class="ings" style="max-height:230px;overflow:auto;margin-top:4px">${ings || '<li class="muted">Ingen ingredienser</li>'}</ul>
    <div class="actions" style="flex-wrap:wrap">
      <button class="btn" id="qvEdit" style="margin-right:auto">✏️ Redigér</button>
      <button class="btn" id="qvShop">🛒 Til indkøbsliste</button>
      <button class="btn" id="qvOpen">📖 Åbn opskrift</button>
      <button class="btn primary" id="qvClose">Luk</button>
    </div>`, m => {
    m.querySelector('#qvClose').onclick = closeModal;
    m.querySelector('#qvEdit').onclick = () => planEntryModal(entry);
    m.querySelector('#qvOpen').onclick = () => { closeModal(); goto('recipeDetail', r.id); };
    m.querySelector('#qvShop').onclick = async () => {
      closeModal();
      await addRecipeToShopping(r, factor);
    };
  }, true);
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
    <p class="pdate">Printet ${fmtDate(isoDate())}</p>`, 'Madplan-uge-' + isoWeekNo(monday));
}

/* ---------------- AI: foreslaa en uge-madplan ---------------- */
async function aiSuggestWeek() {
  const monday = S.weekStart || mondayOf();
  const dates = weekDatesOf(monday);
  const free = dates.filter(d => !K('planEntry').some(e => e.date === d && slotOf(e) === 'dinner'));
  if (!free.length) return toast('Alle ugens dage har allerede noget på madplanen', true);
  /* samme kategori-filter som "Udfyld fra biblioteket", saa de to knapper
   * opfoerer sig ens - ellers kan AI'en foreslaa saucer og drikkevarer */
  const valgte = fillCats();
  let recipes = K('recipe').filter(r => valgte.includes(r.category || ''));
  if (recipes.length < 2) recipes = K('recipe');   // for smalt valg: brug hele biblioteket
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
