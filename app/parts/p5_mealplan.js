/* ---------------- Madplan (uge-visning) ---------------- */

function weekDatesOf(monday) { return [...Array(7)].map((_, i) => addDays(monday, i)); }

/* maaltids-typer; gamle entries uden slot regnes som aftensmad */
const SLOTS = [
  { id: 'breakfast', label: 'Morgenmad', ico: '🌅' },
  { id: 'lunch',     label: 'Frokost',   ico: '🥪' },
  { id: 'dinner',    label: 'Aftensmad', ico: '' },
  { id: 'other',     label: 'Andet',     ico: '📌' }
];
/* billeder i uge-oversigten kan slaas fra - de fylder meget paa en lille skaerm */
function planImages() {
  try { return localStorage.getItem('kk_planimg') === '1'; } catch (e) { return false; }
}
const slotOf = e => e.slot || 'dinner';
const slotOrder = id => SLOTS.findIndex(s => s.id === id);
const slotInfo = id => SLOTS.find(s => s.id === id) || SLOTS[2];

/* ---------------- find en ret og laeg den paa en dag ----------------
 * Med 12.000 opskrifter i biblioteket duer en rulleliste ikke - hverken her
 * eller i madplan-modalen. Derfor soeges der overalt, hvor en opskrift skal
 * vaelges, og der vises hoejst HITS_MAKS raekker ad gangen.
 *
 * To veje fra et soegeresultat ned paa en dag:
 *   traek-og-slip  (mus)
 *   vaelg-og-peg   (touch - iOS Safari kan slet ikke HTML5-drag)
 * S.planArm holder den valgte ret, indtil man peger paa en dag. Den bliver
 * haengende efter et drop, saa fx "Rester" kan lande paa flere dage i traek. */
const HITS_MAKS = 40;
/* "Rester" er den hyppigste linje i en madplan, der ikke er en opskrift -
 * den skal kunne saettes paa en dag uden at aabne noget. */
const HURTIG_TEKST = 'Rester';
const planSlot = () => S.planSlot || 'dinner';
const armEtiket = a => !a ? '' : (a.recipeId ? ((recipeById(a.recipeId) || {}).title || 'Opskriften') : a.text);

function planSoeg(q, maks) {
  const alle = K('recipe');
  if (!q) return alle.slice().sort(nyestFoerst).slice(0, maks);
  const traef = [];
  for (const r of alle) {
    const t = normName(r.title);
    /* titlen vejer tungest, og dem der BEGYNDER med soegningen ligger oeverst:
     * skriver man "pizza", vil man have "Pizza Margherita" foer "Rester af pizzadej" */
    const rang = t.startsWith(q) ? 0 : t.includes(q) ? 1
      : normName((r.tags || []).join(' ')).includes(q) ? 2
      : normName(r.category).includes(q) ? 3 : -1;
    if (rang >= 0) traef.push([rang, r]);
  }
  traef.sort((a, b) => a[0] - b[0] || cmpTekst(a[1].title, b[1].title));
  return traef.slice(0, maks).map(x => x[1]);
}

/* én raekke i et soegeresultat - ens i panelet og i vaelgeren */
function planHitHtml(r, kanTraekkes) {
  const bil = imageSrcOrRemote(r);
  const tid = recipeTotalMin(r);
  const under = [r.category || '', tid ? fmtMin(tid) : ''].filter(Boolean).join(' · ');
  return `<div class="findhit" data-hit="${r.id}"${kanTraekkes ? ' draggable="true"' : ''}>
    ${bil ? `<img src="${esc(bil)}" alt="" loading="lazy">` : '<span class="noimg">🍽️</span>'}
    <span class="grow"><b>${esc(r.title || '(uden titel)')}</b>
      ${under ? `<span class="small muted">${esc(under)}</span>` : ''}</span>
    ${r.rating ? starsHtml(r.rating) : ''}
  </div>`;
}
function planHitsHtml(liste, kanTraekkes) {
  return liste.length
    ? liste.map(r => planHitHtml(r, kanTraekkes)).join('')
    : '<p class="muted small" style="padding:10px 2px">Ingen opskrifter matcher.</p>';
}
function bindPlanHits(rod, vaelg, kanTraekkes) {
  rod.querySelectorAll('[data-hit]').forEach(el => {
    el.onclick = () => vaelg(el.dataset.hit);
    if (!kanTraekkes) return;
    el.ondragstart = ev => {
      ev.dataTransfer.setData('text/plain', 'rec:' + el.dataset.hit);
      ev.dataTransfer.effectAllowed = 'copy';
      el.classList.add('dragging');
    };
    el.ondragend = () => el.classList.remove('dragging');
  });
}

/* soegepanelet over ugegitteret */
function planFindHtml() {
  if (!S.planFind) return '';
  const antal = K('recipe').length;
  return `<div class="findpanel">
    <div class="rowflex">
      <input id="pfQ" class="grow" placeholder="Søg blandt ${antal} opskrifter – fx bønnegryde" value="${esc(S.planQ || '')}" autocomplete="off">
      <select id="pfSlot" title="Hvilket måltid retten lægges på">
        ${SLOTS.map(s => `<option value="${s.id}"${planSlot() === s.id ? ' selected' : ''}>${s.ico} ${s.label}</option>`).join('')}
      </select>
      <button class="btn" id="pfLuk">Luk</button>
    </div>
    <p class="small muted" style="margin:8px 2px 2px">Klik en ret for at vælge dagen – eller træk den ned på en dag.</p>
    <div class="findhits" id="pfHits">${planHitsHtml(planSoeg(normName(S.planQ || ''), HITS_MAKS), true)}</div>
  </div>`;
}
function planArmHtml() {
  if (!S.planArm) return '';
  return `<div class="armbar">
    <span class="grow">Vælg dagen til <b>${esc(armEtiket(S.planArm))}</b> – tryk “Læg her”</span>
    <select id="abSlot">${SLOTS.map(s => `<option value="${s.id}"${planSlot() === s.id ? ' selected' : ''}>${s.ico} ${s.label}</option>`).join('')}</select>
    <button class="btn small" id="abStop">Færdig</button>
  </div>`;
}
function planArm(spec) {
  S.planArm = spec;
  render();
}
const ugedagNr = d => (new Date(d + 'T00:00:00').getDay() + 6) % 7;
async function laegPaaDag(date, spec, slot) {
  if (!spec) return;
  await saveItem({
    id: uid(), kind: 'planEntry', date, slot: slot || 'dinner',
    recipeId: spec.recipeId || '', text: spec.text || '', servings: null
  }, true);
  toast(`${armEtiket(spec)} lagt på ${WEEKDAYS_DA[ugedagNr(date)].toLowerCase()} ${fmtDate(date)}`);
  render();
}

/* Fjern et maaltid med ét klik. Ingen bekraeftelse: linjen er sat paa plads
 * med ét klik og kan saettes tilbage med ét, og navnet staar i kvitteringen. */
async function fjernPlanEntry(id) {
  const e = K('planEntry').find(x => x.id === id);
  if (!e) return;
  const navn = e.recipeId ? ((recipeById(e.recipeId) || {}).title || 'Måltidet') : (e.text || 'Måltidet');
  e.deleted = true;
  await saveItem(e, true);
  toast(`${navn} fjernet fra ${WEEKDAYS_DA[ugedagNr(e.date)].toLowerCase()}`);
  render();
}

/* Soegbar opskrift-vaelger. Afloeser rullelisten med alle opskrifter - den
 * var baade tung at tegne og umulig at finde noget i. */
function vaelgOpskriftModal(overskrift, onPick) {
  openModal(`<h2>${esc(overskrift)}</h2>
    <input id="voQ" placeholder="Søg blandt ${K('recipe').length} opskrifter…" autocomplete="off" style="width:100%">
    <div class="findhits tall" id="voHits"></div>
    <div class="actions"><button class="btn" id="voLuk">Annullér</button></div>`, m => {
    const boks = m.querySelector('#voHits');
    const inp = m.querySelector('#voQ');
    const tegn = () => {
      boks.innerHTML = planHitsHtml(planSoeg(normName(inp.value), HITS_MAKS), false);
      bindPlanHits(boks, id => { closeModal(); onPick(id); });
    };
    inp.oninput = tegn;
    inp.onkeydown = ev => {
      if (ev.key !== 'Enter') return;
      const f = boks.querySelector('[data-hit]');
      if (f) f.click();
    };
    m.querySelector('#voLuk').onclick = closeModal;
    tegn();
    inp.focus();
  });
}

RENDER.plan = () => {
  const monday = S.weekStart || mondayOf();
  const dates = weekDatesOf(monday);
  const today = isoDate();
  const entriesByDate = {};
  for (const e of K('planEntry')) (entriesByDate[e.date] = entriesByDate[e.date] || []).push(e);
  const visBilleder = planImages();

  return pageHead('Madplan', `Uge ${isoWeekNo(monday)} · ${fmtDate(monday)} – ${fmtDate(dates[6])}`,
      `<div class="rowflex">
        <button class="btn" id="wkPrev">←</button>
        <button class="btn" id="wkToday">I dag</button>
        <button class="btn" id="wkNext">→</button>
        <button class="btn${S.planFind ? ' primary' : ''}" id="wkFind">🔍 Find ret</button>
        <button class="btn" id="wkRester">🍲 Rester</button>
        <button class="btn" id="wkShop">🛒 Indkøbsliste for ugen</button>
        <button class="btn" id="wkPrint">🖨️ Print</button>
        <button class="btn" id="wkFill">📖 Udfyld fra biblioteket</button>
        <button class="btn" id="wkSaveMenu">💾 Gem som skabelon</button>
        <button class="btn" id="wkApplyMenu" ${K('menu').length ? '' : 'disabled'}>📋 Skabeloner…</button>
        <button class="btn${visBilleder ? ' primary' : ''}" id="wkImg"
          title="Vis eller skjul billeder i ugeoversigten">🖼️ Billeder</button>
        <button class="btn danger" id="wkClear">🗑️ Ryd ugen</button>
        ${S.settings.aiKeySet ? '<button class="btn primary" id="wkAi">✨ Foreslå madplan (AI)</button>' : ''}
      </div>`) + planFindHtml() + planArmHtml() + `
  <div class="weekgrid">
    ${dates.map((d, i) => `
      <div class="daycol${d === today ? ' today' : ''}" data-date="${d}">
        <div class="dhead">${WEEKDAYS_DA[i]} <span style="float:right;font-weight:400">${d.slice(8)}/${+d.slice(5, 7)}</span></div>
        ${(entriesByDate[d] || []).slice().sort((a, b) => slotOrder(slotOf(a)) - slotOrder(slotOf(b))).map(e => {
          const r = e.recipeId ? recipeById(e.recipeId) : null;
          const si = slotInfo(slotOf(e));
          const slotTag = slotOf(e) !== 'dinner' ? `<span class="muted">${si.ico} ${si.label} · </span>` : '';
          return `<div class="planentry" data-entry="${e.id}" draggable="true">
            <button class="pdel" data-del="${e.id}" title="Fjern fra madplanen" aria-label="Fjern fra madplanen">✕</button>
            ${visBilleder && r && imageSrcOrRemote(r) ? `<img class="planimg" src="${esc(imageSrcOrRemote(r))}" alt="" loading="lazy">` : ''}
            ${slotTag}${r ? esc(r.title) : esc(e.text || '')}
            ${r && recipeTotalMin(r) ? `<div class="pmeta">⏱ ${fmtMin(recipeTotalMin(r))}${e.servings ? ' · ' + e.servings + ' pers.' : ''}</div>` : (e.servings ? `<div class="pmeta">${e.servings} pers.</div>` : '')}
          </div>`;
        }).join('')}
        <button class="dayadd${S.planArm ? ' arm' : ''}" data-date="${d}">${S.planArm ? '⬇ Læg her' : '+ tilføj'}</button>
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
  $('#wkClear').onclick = clearWeekModal;
  $('#wkImg').onclick = () => {
    try { localStorage.setItem('kk_planimg', planImages() ? '0' : '1'); } catch (e) {}
    render();
  };
  const ai = $('#wkAi');
  if (ai) ai.onclick = aiSuggestWeek;
  $('#wkFind').onclick = () => {
    S.planFind = !S.planFind;
    S.planFokus = S.planFind;
    render();
  };
  $('#wkRester').onclick = () => planArm({ text: HURTIG_TEKST });
  const pfq = $('#pfQ');
  if (pfq) {
    pfq.oninput = () => {
      S.planQ = pfq.value;
      const boks = $('#pfHits');
      boks.innerHTML = planHitsHtml(planSoeg(normName(S.planQ), HITS_MAKS), true);
      bindPlanHits(boks, id => planArm({ recipeId: id }), true);
    };
    $('#pfLuk').onclick = () => { S.planFind = false; render(); };
    $('#pfSlot').onchange = e => { S.planSlot = e.target.value; };
    bindPlanHits($('#pfHits'), id => planArm({ recipeId: id }), true);
    /* kun fokus naar panelet lige er aabnet - ellers stjaeler hver render
     * tastaturet paa en telefon */
    if (S.planFokus) { S.planFokus = false; pfq.focus(); }
  }
  if ($('#abStop')) {
    $('#abStop').onclick = () => { S.planArm = null; render(); };
    $('#abSlot').onchange = e => { S.planSlot = e.target.value; };
  }
  $$('.planentry [data-del]').forEach(b => b.onclick = ev => {
    ev.stopPropagation();          // ellers aabner kortet bagved ogsaa
    fjernPlanEntry(b.dataset.del);
  });
  $$('.dayadd').forEach(b => b.onclick = () => {
    if (S.planArm) return laegPaaDag(b.dataset.date, S.planArm, planSlot());
    planEntryModal(null, { date: b.dataset.date, slot: planSlot() });
  });
  $$('.planentry[data-entry]').forEach(el => {
    el.onclick = () => {
      const e = K('planEntry').find(x => x.id === el.dataset.entry);
      if (e) planQuickView(e);
    };
    el.ondragstart = ev => {
      ev.dataTransfer.setData('text/plain', 'entry:' + el.dataset.entry);
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
      /* tre slags last: en linje der flyttes, en ny opskrift, eller en fritekst */
      const last = ev.dataTransfer.getData('text/plain') || '';
      if (last.startsWith('rec:')) laegPaaDag(col.dataset.date, { recipeId: last.slice(4) }, planSlot());
      else if (last.startsWith('text:')) laegPaaDag(col.dataset.date, { text: last.slice(5) }, planSlot());
      else if (last.startsWith('entry:')) movePlanEntry(last.slice(6), col.dataset.date);
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

/* ---------------- ryd ugen ----------------
 * Ekstra spaerring: man skal se HVAD der ryger (listen) og trykke paa en
 * roed knap, der er slaaet fra indtil man har bekraeftet med et flueben.
 * En uges planlaegning maa ikke kunne forsvinde ved et fejlklik. */
function clearWeekModal() {
  const monday = S.weekStart || mondayOf();
  const dates = weekDatesOf(monday);
  const entries = K('planEntry').filter(e => dates.includes(e.date));
  if (!entries.length) return toast('Ugen er allerede tom', true);

  const linjer = dates.map((d, i) => {
    const paaDagen = entries.filter(e => e.date === d)
      .sort((a, b) => slotOrder(slotOf(a)) - slotOrder(slotOf(b)));
    if (!paaDagen.length) return '';
    return `<tr><td class="small muted nowrap">${WEEKDAYS_DA[i]}</td><td>${paaDagen.map(e => {
      const r = e.recipeId ? recipeById(e.recipeId) : null;
      const si = slotInfo(slotOf(e));
      return (slotOf(e) !== 'dinner' ? `<span class="muted small">${si.label}: </span>` : '') +
        esc(r ? r.title : e.text || '');
    }).join('<br>')}</td></tr>`;
  }).join('');

  openModal(`<h2>🗑️ Ryd uge ${isoWeekNo(monday)}</h2>
    <p class="small muted">${fmtDate(monday)} – ${fmtDate(dates[6])}.
      Følgende <b>${entries.length} måltider</b> fjernes fra madplanen. Opskrifterne selv
      røres ikke – kun planlægningen. Det kan ikke fortrydes.</p>
    <div class="tablewrap" style="max-height:240px;overflow:auto"><table class="data"><tbody>${linjer}</tbody></table></div>
    <label class="chk" style="margin:14px 0 4px">
      <input type="checkbox" id="cwOk"> Ja, jeg vil rydde hele ugen</label>
    <div class="actions">
      <button class="btn" id="cwCancel">Annullér</button>
      <button class="btn danger" id="cwGo" disabled>Ryd ${entries.length} måltider</button>
    </div>`, m => {
    const go = m.querySelector('#cwGo');
    m.querySelector('#cwOk').onchange = e => { go.disabled = !e.target.checked; };
    m.querySelector('#cwCancel').onclick = closeModal;
    go.onclick = async () => {
      go.disabled = true;
      await saveBulk(entries.map(e => Object.assign(e, { deleted: true })));
      closeModal();
      toast(`Uge ${isoWeekNo(monday)} ryddet – ${entries.length} måltider fjernet`);
      render();
    };
  });
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
/* Mindste antal stjerner en ret skal have for at komme i betragtning.
 * 0 = ingen krav. Uvurderede retter (rating 0) falder altsaa fra, saa snart
 * kravet er 1 eller mere - det er meningen: man vil have de gode igen. */
const fillMinStars = () => +lsGet('kk_fillminstars', 0) || 0;
const opfylderStjerner = (r, min) => !min || (r.rating || 0) >= min;
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
    <label class="chk" style="margin-top:14px"><input type="checkbox" id="fcFrokost">
      <span>Udfyld også frokost <span class="muted small">(fra frokost-opskrifter: madpakker,
        sandwich, brunch og lette retter – på tværs af kategorier)</span></span></label>
    <label class="fld" style="margin-top:14px"><span>Mindste vurdering</span>
      <select id="fcStars">
        <option value="0">★ Alle – også uvurderede</option>
        ${[1, 2, 3, 4, 5].map(i => `<option value="${i}"${fillMinStars() === i ? ' selected' : ''}>${'★'.repeat(i)} og op</option>`).join('')}
      </select></label>
    <p class="small muted" id="fcInfo" style="margin:12px 0 0"></p>
    <div class="actions">
      <button class="btn" id="fcCancel">Annullér</button>
      <button class="btn primary" id="fcGo">Udfyld ${free.length} dage</button>
    </div>`, m => {
    const bokse = () => [...m.querySelectorAll('[data-fc]')];
    const valgte = () => bokse().filter(b => b.checked).map(b => b.dataset.fc);
    const minStjerner = () => +m.querySelector('#fcStars').value || 0;
    const puljen = () => K('recipe').filter(r =>
      valgte().includes(r.category || '') && opfylderStjerner(r, minStjerner()));
    const opdater = () => {
      const n = puljen().length;
      const stj = minStjerner();
      m.querySelector('#fcInfo').textContent = n
        ? `${n} ${n === 1 ? 'opskrift' : 'opskrifter'} at vælge imellem til ${free.length} dage` +
          (stj ? ` (med mindst ${stj} ${stj === 1 ? 'stjerne' : 'stjerner'})` : '') +
          (n < free.length ? ' – nogle vil gå igen' : '')
        : (stj ? `Ingen opskrifter med mindst ${stj} ${stj === 1 ? 'stjerne' : 'stjerner'} i de valgte kategorier`
               : 'Ingen opskrifter i de valgte kategorier');
      m.querySelector('#fcGo').disabled = !n;
    };
    bokse().forEach(b => b.onchange = opdater);
    m.querySelector('#fcStars').onchange = opdater;
    m.querySelector('#fcFrokost').checked = lsGet('kk_fillfrokost', '') === '1';
    m.querySelector('#fcAll').onclick = () => { bokse().forEach(b => b.checked = true); opdater(); };
    m.querySelector('#fcMain').onclick = () => {
      bokse().forEach(b => b.checked = normName(b.dataset.fc) === 'hovedret');
      opdater();
    };
    m.querySelector('#fcCancel').onclick = closeModal;
    m.querySelector('#fcGo').onclick = async () => {
      const v = valgte();
      const pulje = puljen();
      try { localStorage.setItem('kk_fillcats', JSON.stringify(v)); } catch (e) {}
      lsSet('kk_fillminstars', minStjerner());
      const ogsaaFrokost = m.querySelector('#fcFrokost').checked;
      lsSet('kk_fillfrokost', ogsaaFrokost ? '1' : '0');
      closeModal();
      const nAften = await doAutoFill(free, dates, pulje, 'dinner');
      let nFrokost = 0;
      if (ogsaaFrokost) {
        /* Frokost gaar UDEN om kategori-valget: frokost er et filter paa tvaers
         * af kategorier, ikke en kategori. Stjernekravet gaelder stadig. */
        const frokostPulje = K('recipe').filter(r => erFrokost(r) && opfylderStjerner(r, minStjerner()));
        const frieFrokost = dates.filter(d => !K('planEntry').some(e => e.date === d && slotOf(e) === 'lunch'));
        if (frokostPulje.length) nFrokost = await doAutoFill(frieFrokost, dates, frokostPulje, 'lunch');
        else toast('Ingen frokost-opskrifter matcher stjernekravet', true);
      }
      toast(`${nAften} aftensmåltider${nFrokost ? ' og ' + nFrokost + ' frokoster' : ''} udfyldt – træk retterne rundt, som du vil`);
      render();
    };
    opdater();
  });
}

async function doAutoFill(free, dates, recipes, slot) {
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
    id: uid(), kind: 'planEntry', date: d, slot: slot || 'dinner', recipeId: draw().id, text: '', servings: null
  }));
  if (items.length) await saveBulk(items);
  return items.length;
}

/* Hurtigt kig paa retten fra madplanen - man planlaegger tit ud fra tid og
 * ingredienser, ikke titlen alene. Fritekst-linjer har intet at vise, saa de
 * gaar direkte til redigering. */
async function planQuickView(entry) {
  const r = entry.recipeId ? recipeById(entry.recipeId) : null;
  if (!r) return planEntryModal(entry);
  await ensureFull(r);                // ingredienserne kommer foerst med her
  const base = r.servings || app().defaultServings;
  const pers = entry.servings || base;
  const factor = base ? pers / base : 1;
  const tid = recipeTotalMin(r);
  const si = slotInfo(slotOf(entry));
  const ings = (r.ingredients || []).map(l => /^##\s*/.test(l)
    ? `<li style="border:0;font-weight:700;color:var(--amber);padding-top:10px">${esc(l.replace(/^##\s*/, ''))}</li>`
    : `<li>${esc(scaleIngredient(l, factor))}</li>`).join('');

  openModal(`<div class="rowflex" style="align-items:flex-start;gap:16px;flex-wrap:nowrap">
      ${imageSrcOrRemote(r) ? `<img src="${esc(imageSrcOrRemote(r))}" alt="" style="width:140px;height:105px;object-fit:cover;border-radius:10px;flex:none">` : ''}
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
      <button class="btn" id="qvEdit">✏️ Redigér</button>
      <button class="btn danger" id="qvDel" style="margin-right:auto">🗑️ Fjern fra dagen</button>
      <button class="btn" id="qvSwap">🔄 Skift ret</button>
      <button class="btn" id="qvShop">🛒 Til indkøbsliste</button>
      <button class="btn" id="qvOpen">📖 Åbn opskrift</button>
      <button class="btn primary" id="qvClose">Luk</button>
    </div>`, m => {
    m.querySelector('#qvClose').onclick = closeModal;
    m.querySelector('#qvEdit').onclick = () => planEntryModal(entry);
    m.querySelector('#qvDel').onclick = () => { closeModal(); fjernPlanEntry(entry.id); };
    m.querySelector('#qvSwap').onclick = () => vaelgOpskriftModal('🔄 Skift ret – ' + WEEKDAYS_DA[ugedagNr(entry.date)].toLowerCase(), async id => {
      entry.recipeId = id;
      entry.text = '';                 // en opskrift afloeser fritekst-linjen
      await saveItem(entry, true);
      toast('Skiftet til ' + ((recipeById(id) || {}).title || 'ny ret'));
      render();
    });
    m.querySelector('#qvOpen').onclick = () => { closeModal(); goto('recipeDetail', r.id); };
    m.querySelector('#qvShop').onclick = async () => {
      closeModal();
      await addRecipeToShopping(r, factor);
    };
  }, true);
}

/* Modalen aabnes forfra hver gang (aabn()), fordi opskrift-vaelgeren
 * overtager modalvinduet. Felterne laeses over i `d` foerst, saa dato,
 * maaltid og personer overlever turen forbi soegningen. */
function planEntryModal(entry, prefill) {
  const isNew = !entry;
  const d = entry || Object.assign({
    id: uid(), kind: 'planEntry', date: isoDate(), slot: 'dinner', recipeId: '', text: '', servings: null
  }, prefill || {});

  const aabn = () => {
    const valgt = d.recipeId ? recipeById(d.recipeId) : null;
    openModal(`<h2>${isNew ? 'Tilføj til madplan' : 'Redigér madplan'}</h2>
    <div class="formgrid">
      <label class="fld"><span>Dato</span><input id="pmDate" type="date" value="${esc(d.date)}"></label>
      <label class="fld"><span>Måltid</span><select id="pmSlot">
        ${SLOTS.map(s => `<option value="${s.id}"${slotOf(d) === s.id ? ' selected' : ''}>${s.ico} ${s.label}</option>`).join('')}
      </select></label>
      <label class="fld"><span>Personer (valgfrit)</span><input id="pmServ" type="number" min="1" value="${d.servings || ''}"></label>
    </div>
    <div class="fld"><span>Opskrift fra biblioteket</span>
      <div class="rowflex pickrow">
        <span class="grow${valgt ? '' : ' muted'}">${valgt ? esc(valgt.title) : 'Ingen valgt'}</span>
        <button type="button" class="btn small" id="pmPick">🔍 Søg…</button>
        ${d.recipeId ? '<button type="button" class="btn small" id="pmClear">Ryd</button>' : ''}
      </div>
    </div>
    <label class="fld"><span>… eller fritekst (fx "Rester" eller "Pizza ude i byen")</span>
      <input id="pmText" value="${esc(d.text || '')}"></label>
    <div class="rowflex" style="margin-top:6px">
      <button type="button" class="btn small" id="pmRester">🍲 Rester</button>
    </div>
    <div class="actions">
      ${isNew ? '' : '<button class="btn danger" id="pmDelete" style="margin-right:auto">Fjern</button>'}
      <button class="btn" id="pmCancel">Annullér</button>
      <button class="btn primary" id="pmSave">Gem</button>
    </div>`, m => {
      /* gem det indtastede i `d`, saa intet gaar tabt naar modalen tegnes igen */
      const laes = () => {
        d.date = m.querySelector('#pmDate').value || d.date;
        d.slot = m.querySelector('#pmSlot').value;
        d.text = m.querySelector('#pmText').value.trim();
        d.servings = parseInt(m.querySelector('#pmServ').value, 10) || null;
      };
      m.querySelector('#pmCancel').onclick = closeModal;
      m.querySelector('#pmPick').onclick = () => {
        laes();
        vaelgOpskriftModal('Vælg opskrift', id => { d.recipeId = id; aabn(); });
      };
      const ryd = m.querySelector('#pmClear');
      if (ryd) ryd.onclick = () => { laes(); d.recipeId = ''; aabn(); };
      m.querySelector('#pmRester').onclick = () => { m.querySelector('#pmText').value = HURTIG_TEKST; };
      if (!isNew) m.querySelector('#pmDelete').onclick = async () => {
        closeModal();
        await deleteItem(d);
        render();
      };
      m.querySelector('#pmSave').onclick = async () => {
        laes();
        if (!d.date) return toast('Vælg en dato', true);
        if (!d.recipeId && !d.text) return toast('Vælg en opskrift eller skriv en tekst', true);
        closeModal();
        await saveItem(d);
        if (S.view !== 'plan') toast('Sat på madplanen ' + fmtDate(d.date));
        render();
      };
    });
  };
  aabn();
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
    await ensureFull(r);              // listen har kun kort-felterne - vi skal bruge ingredienserne
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
  const minStj = fillMinStars();
  let recipes = K('recipe').filter(r => valgte.includes(r.category || '') && opfylderStjerner(r, minStj));
  /* for smalt valg: slaek foerst paa kategorierne, saa paa stjernerne */
  if (recipes.length < 2) recipes = K('recipe').filter(r => opfylderStjerner(r, minStj));
  if (recipes.length < 2) recipes = K('recipe');
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
    const plan = parseAiJson(r.text, true);
    if (!plan) throw new Error('AI-svaret kunne ikke læses.' + aiSvarUddrag(r.text));
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
