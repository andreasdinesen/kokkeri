/* ---------------- Madplan (uge-visning) ---------------- */

function weekDatesOf(monday) { return [...Array(7)].map((_, i) => addDays(monday, i)); }

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
        ${S.settings.aiKeySet ? '<button class="btn primary" id="wkAi">✨ Foreslå madplan (AI)</button>' : ''}
      </div>`) + `
  <div class="weekgrid">
    ${dates.map((d, i) => `
      <div class="daycol${d === today ? ' today' : ''}" data-date="${d}">
        <div class="dhead">${WEEKDAYS_DA[i]} <span style="float:right;font-weight:400">${d.slice(8)}/${+d.slice(5, 7)}</span></div>
        ${(entriesByDate[d] || []).map(e => {
          const r = e.recipeId ? recipeById(e.recipeId) : null;
          return `<div class="planentry" data-entry="${e.id}" draggable="true">
            ${r ? esc(r.title) : esc(e.text || '')}
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
 * maaldagen, bytter de plads (de fortraengte ryger til den dag, der traekkes fra) */
async function movePlanEntry(entryId, toDate) {
  const e = K('planEntry').find(x => x.id === entryId);
  if (!e || !toDate || e.date === toDate) return;
  const fromDate = e.date;
  const displaced = K('planEntry').filter(x => x.date === toDate && x.id !== e.id);
  e.date = toDate;
  displaced.forEach(x => { x.date = fromDate; });
  await saveBulk([e, ...displaced]);
  toast(displaced.length ? 'Byttet om 🔄' : 'Flyttet til ' + fmtDate(toDate));
  render();
}

/* fyld ugens tomme dage med opskrifter fra biblioteket - uden AI.
 * Vaegtet lodtraekning: favoritter og hoejt vurderede traekkes oftere, og
 * samme ret kommer ikke paa to dage i samme uge (medmindre biblioteket er lille). */
async function autoFillWeek() {
  const monday = S.weekStart || mondayOf();
  const dates = weekDatesOf(monday);
  const free = dates.filter(d => !K('planEntry').some(e => e.date === d));
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
    id: uid(), kind: 'planEntry', date: d, recipeId: draw().id, text: '', servings: null
  }));
  await saveBulk(items);
  toast(`${items.length} dage udfyldt – træk retterne rundt, som du vil`);
  render();
}

function planEntryModal(entry, prefill) {
  const isNew = !entry;
  const d = entry || Object.assign({
    id: uid(), kind: 'planEntry', date: isoDate(), recipeId: '', text: '', servings: null
  }, prefill || {});

  openModal(`<h2>${isNew ? 'Tilføj til madplan' : 'Redigér madplan'}</h2>
    <div class="formgrid">
      <label class="fld"><span>Dato</span><input id="pmDate" type="date" value="${esc(d.date)}"></label>
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
  for (const e of entries) {
    const r = recipeById(e.recipeId);
    if (!r) continue;
    const factor = e.servings && r.servings ? e.servings / r.servings : 1;
    for (const l of (r.ingredients || []).filter(l => !/^##/.test(l))) {
      items.push({
        id: uid(), kind: 'shopItem', text: scaleIngredient(l, factor),
        group: r.title, done: false, createdAt: new Date().toISOString()
      });
    }
  }
  await saveBulk(items);
  toast(`${items.length} varer føjet til indkøbslisten`);
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
        <td>${entries.map(e => {
          const r = e.recipeId ? recipeById(e.recipeId) : null;
          return esc(r ? r.title : e.text || '') + (e.servings ? ` (${e.servings} pers.)` : '');
        }).join('<br>') || '&nbsp;'}</td></tr>`;
    }).join('')}
    </tbody></table>
    <p class="pdate">Printet ${fmtDate(isoDate())}</p>`);
}

/* ---------------- AI: foreslaa en uge-madplan ---------------- */
async function aiSuggestWeek() {
  const monday = S.weekStart || mondayOf();
  const dates = weekDatesOf(monday);
  const free = dates.filter(d => !K('planEntry').some(e => e.date === d));
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
      items.push({ id: uid(), kind: 'planEntry', date: p.date, recipeId: p.recipeId, text: '', servings: null });
    }
    if (!items.length) throw new Error('AI\'en foreslog ingen brugbare dage');
    await saveBulk(items);
    toast(`Madplan foreslået for ${items.length} dage – ret til som du vil`);
    render();
  } catch (e) {
    toast('Kunne ikke lave madplan: ' + e.message, true);
  }
}
