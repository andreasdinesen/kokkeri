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
      <div class="dashday">
        <strong class="dagnavn">${dayName(u.date)}</strong>
        <span class="muted small dagdato">${fmtDate(u.date)}</span>
        <span class="dagretter">${u.entries.length ? u.entries.map(e => {
          const r = e.recipeId ? recipeById(e.recipeId) : null;
          return r ? `<a href="#" data-rec="${r.id}" class="planlink">🍽️ ${esc(r.title)}</a>`
                   : `<span>🍽️ ${esc(e.text || '')}</span>`;
        }).join('') : '<span class="muted">intet planlagt</span>'}</span>
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
