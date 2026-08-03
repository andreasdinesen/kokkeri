/* ---------------- Opskrifter ---------------- */

/* Hvor mange kort der tegnes ad gangen (resten hentes med "Vis flere"
 * eller naar bunden kommer i syne). */
const REC_SIDE = 60;

const cmpTekst = (a, b) => String(a || '').localeCompare(String(b || ''), 'da');
const nyestFoerst = (a, b) => cmpTekst(b.createdAt, a.createdAt);
const SORTERINGER = {
  nyeste:  { navn: '🕒 Nyeste først', fn: nyestFoerst },
  stjerner:{ navn: '★ Flest stjerner', fn: (a, b) => (b.rating || 0) - (a.rating || 0) || nyestFoerst(a, b) },
  faerrest:{ navn: '☆ Færrest stjerner', fn: (a, b) => (a.rating || 0) - (b.rating || 0) || nyestFoerst(a, b) },
  titel:   { navn: '🔤 Titel A–Å', fn: (a, b) => cmpTekst(a.title, b.title) },
  tid:     { navn: '⏱ Korteste tid', fn: (a, b) => (recipeTotalMin(a) || 1e9) - (recipeTotalMin(b) || 1e9) || nyestFoerst(a, b) }
};

function starsHtml(rating) {
  const r = rating || 0;
  return `<span class="stars">${[1, 2, 3, 4, 5].map(i => `<span class="${i <= r ? '' : 'off'}">★</span>`).join('')}</span>`;
}

/* Klikbare stjerner - bruges baade paa kortet og paa detaljesiden, saa en
 * opskrift kan vurderes uden at aabne den. `data-ratefor` baerer opskriftens id. */
function starsPickHtml(r) {
  return `<span class="stars pick" data-ratefor="${r.id}" title="Giv stjerner">${
    [1, 2, 3, 4, 5].map(i => `<span data-star="${i}" class="${i <= (r.rating || 0) ? '' : 'off'}">★</span>`).join('')
  }</span>`;
}
async function bindStarPickers() {
  $$('[data-ratefor] [data-star]').forEach(s => s.onclick = async e => {
    e.stopPropagation();                     // ellers aabner kortet opskriften
    const id = s.parentElement.dataset.ratefor;
    const r = recipeById(id);
    if (!r) return;
    const v = +s.dataset.star;
    r.rating = r.rating === v ? 0 : v;       // klik paa samme stjerne rydder
    await saveItem(r, true);
    render();
  });
}

function recipeCardHtml(r, medKatVaelger) {
  const time = recipeTotalMin(r);
  const cats = app().categories || [];
  const src = imageSrcOrRemote(r);
  return `<div class="reccard" data-rec="${r.id}">
    <div class="recimg">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : '🍽️'}</div>
    <div class="recbody">
      <div class="rectitle">${r.favorite ? '⭐ ' : ''}${esc(r.title || '(uden titel)')}</div>
      <div class="recmeta">
        ${r.category ? `<span>${esc(r.category)}</span>` : ''}
        ${time ? `<span>⏱ ${fmtMin(time)}</span>` : ''}
        ${starsPickHtml(r)}
      </div>
      ${medKatVaelger ? `<select class="katpick" data-katfor="${r.id}" title="Sæt kategori">
        <option value="">Vælg kategori …</option>
        ${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>` : ''}
    </div>
  </div>`;
}
function bindRecipeCards() {
  $$('.reccard[data-rec]').forEach(c => c.onclick = () => goto('recipeDetail', c.dataset.rec));
}

RENDER.recipes = () => {
  const f = S.recFilter;
  const cats = app().categories || [];
  let list = K('recipe').slice();
  if (f.fav) list = list.filter(r => r.favorite);
  /* noCat er sit eget flag - tom streng kan ikke bruges, da den betyder "intet filter" */
  if (f.noCat) list = list.filter(r => !r.category);
  else if (f.category) list = list.filter(r => r.category === f.category);
  if (f.q) {
    const q = normName(f.q);
    list = list.filter(r =>
      normName(r.title).includes(q) ||
      normName((r.tags || []).join(' ')).includes(q) ||
      normName((r.ingredients || []).join(' ')).includes(q));
  }
  if (f.minStars) list = list.filter(r => (r.rating || 0) >= f.minStars);
  SORTERINGER[f.sort] ? list.sort(SORTERINGER[f.sort].fn) : list.sort(SORTERINGER.nyeste.fn);
  const udenKat = K('recipe').filter(r => !r.category).length;
  /* Vis kun et vindue ad gangen: 5000 kort paa én gang er 5000 DOM-noder,
   * og gridet bygges forfra ved hvert tastetryk i soegefeltet. */
  const vist = list.slice(0, S.recLimit || REC_SIDE);

  return pageHead('Opskrifter', `${K('recipe').length} opskrifter i biblioteket`,
      `<button class="btn" id="recNew">➕ Ny opskrift</button>
       <button class="btn" id="recSiteImport">📚 Masse-import</button>
       <button class="btn primary" id="recImport">🌐 Importér fra URL</button>`) + `
  <div class="rowflex">
    <input id="recSearch" placeholder="🔍 Søg i titel, ingredienser og tags…" value="${esc(f.q)}" style="min-width:240px;flex:1;max-width:380px">
    <select id="recSort" title="Sortering">
      ${Object.entries(SORTERINGER).map(([k, s]) => `<option value="${k}"${f.sort === k ? ' selected' : ''}>${s.navn}</option>`).join('')}
    </select>
    <select id="recMinStars" title="Vis kun opskrifter med mindst så mange stjerner">
      <option value="0">★ Alle vurderinger</option>
      ${[1, 2, 3, 4, 5].map(i => `<option value="${i}"${f.minStars === i ? ' selected' : ''}>${'★'.repeat(i)} og op</option>`).join('')}
    </select>
    <span class="chip chipbtn${f.fav ? ' sel' : ''}" id="recFav">⭐ Favoritter</span>
    ${cats.map(c => `<span class="chip chipbtn${!f.noCat && f.category === c ? ' sel' : ''}" data-cat="${esc(c)}">${esc(c)}</span>`).join('')}
    ${udenKat ? `<span class="chip chipbtn${f.noCat ? ' sel' : ''}" id="recNoCat"
      title="Opskrifter der mangler en kategori">🏷️ Uden kategori (${udenKat})</span>` : ''}
  </div>
  ${f.noCat ? `<p class="small muted" style="margin:10px 0 0">
    Vælg en kategori direkte på kortet – den gemmes med det samme.</p>` : ''}
  <div id="crawlBanner">${crawlBannerHtml()}</div>
  ${list.length ? `<div class="recgrid">${vist.map(r => recipeCardHtml(r, f.noCat)).join('')}</div>
    ${vist.length < list.length ? `<div class="loadmore">
      <button class="btn" id="recMore">Vis flere (${vist.length} af ${list.length})</button></div>` : ''}`
    : '<p class="muted" style="margin-top:26px">Ingen opskrifter matcher.</p>'}`;
};
RENDER.recipes_bind = () => {
  $('#recNew').onclick = () => recipeModal(null);
  $('#recImport').onclick = importUrlModal;
  $('#recSiteImport').onclick = siteImportModal;
  bindCrawlBanner();
  /* et nyt filter betyder en ny liste - start vinduet forfra */
  const omTegn = () => { S.recLimit = REC_SIDE; render(); };
  const search = $('#recSearch');
  search.oninput = () => {
    S.recFilter.q = search.value;
    clearTimeout(search._h);
    search._h = setTimeout(() => { const v = search.value; omTegn(); const el = $('#recSearch'); el.focus(); el.setSelectionRange(v.length, v.length); }, 250);
  };
  $('#recSort').onchange = e => { S.recFilter.sort = e.target.value; lsSet('kk_recsort', e.target.value); omTegn(); };
  $('#recMinStars').onchange = e => { S.recFilter.minStars = +e.target.value || 0; lsSet('kk_recminstars', S.recFilter.minStars); omTegn(); };
  $('#recFav').onclick = () => { S.recFilter.fav = !S.recFilter.fav; omTegn(); };
  $$('[data-cat]').forEach(c => c.onclick = () => {
    S.recFilter.noCat = false;
    S.recFilter.category = S.recFilter.category === c.dataset.cat ? '' : c.dataset.cat;
    omTegn();
  });
  const noCat = $('#recNoCat');
  if (noCat) noCat.onclick = () => {
    S.recFilter.noCat = !S.recFilter.noCat;
    S.recFilter.category = '';
    omTegn();
  };
  /* "Vis flere" - baade som knap og automatisk naar den kommer i syne */
  const more = $('#recMore');
  if (more) {
    const hentFlere = () => { S.recLimit = (S.recLimit || REC_SIDE) + REC_SIDE; render(); };
    more.onclick = hentFlere;
    if (window.IntersectionObserver) {
      const io = new IntersectionObserver(e => { if (e[0].isIntersecting) { io.disconnect(); hentFlere(); } },
        { rootMargin: '400px' });
      io.observe(more);
    }
  }
  bindStarPickers();
  /* saet kategori direkte fra kortet - ét klik pr. opskrift i stedet for
   * at aabne og gemme hver enkelt */
  $$('[data-katfor]').forEach(sel => {
    sel.onclick = e => e.stopPropagation();      // ellers aabner kortet opskriften
    sel.onchange = async () => {
      const r = recipeById(sel.dataset.katfor);
      if (!r || !sel.value) return;
      r.category = sel.value;
      r.catChecked = true;                        // et bevidst valg - ikke gæt igen
      await saveItem(r, true);
      toast(`${r.title} → ${sel.value}`);
      render();
    };
  });
  bindRecipeCards();
};

/* ---------------- detalje ---------------- */
/* goer tidsangivelser i fremgangsmaaden klikbare -> starter en timer.
 * Forstaar: "45 min" · "1,5 time" (dansk decimalkomma) · "1½ time" ·
 * "1 time og 30 minutter" · "20-30 minutter" (tager den NEDRE graense, saa
 * maden ikke brænder på - man kan altid trykke +1 min).
 * Fælden var et regex paa `(\d+)`: i "1,5 time" fangede det kun "5" og
 * lavede en timer paa 5 TIMER. */
const TIMER_FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
function timeTextToMin(tal, enhed, ekstraMin) {
  const s = String(tal).replace(/\s+/g, '');
  const f = s.match(/^(\d*)([½¼¾⅓⅔])$/);
  const v = f ? (f[1] ? +f[1] : 0) + TIMER_FRAC[f[2]] : num(s);
  const erTime = /^tim/i.test(enhed);
  return Math.round(erTime ? v * 60 + (+ekstraMin || 0) : v);
}
function linkifyTimers(escapedText) {
  const re = /(\d+(?:[.,]\d+)?\s*[½¼¾⅓⅔]?|[½¼¾⅓⅔])\s*(?:[-–]\s*\d+(?:[.,]\d+)?\s*)?(timers|timer|timen|time|minutters|minutter|minut|min)\.?(?![a-zæøåA-ZÆØÅ])(?:\s*(?:og\s+)?(\d+)\s*(?:minutter|minut|min)\.?(?![a-zæøåA-ZÆØÅ]))?/gi;
  return escapedText.replace(re, (m, tal, enhed, ekstraMin) => {
    const mins = timeTextToMin(tal, enhed, ekstraMin);
    if (!mins || mins > 24 * 60) return m;
    return `<span class="inline-timer" data-min="${mins}" title="Start en timer på ${fmtMin(mins)}">⏱ ${m}</span>`;
  });
}
function bindInlineTimers(label) {
  $$('.inline-timer').forEach(el => el.onclick = e => {
    e.stopPropagation();
    startTimer(+el.dataset.min * 60000, label);
    toast(`Timer på ${fmtMin(+el.dataset.min)} startet`);
    renderNav();
  });
}

function ingredientsHtml(r, factor) {
  return (r.ingredients || []).map(line => {
    if (/^##\s*/.test(line)) return `<li style="border:0;font-weight:700;color:var(--amber);padding-top:12px">${esc(line.replace(/^##\s*/, ''))}</li>`;
    return `<li>${esc(scaleIngredient(line, factor))}</li>`;
  }).join('');
}
function instructionsHtml(r) {
  let out = '', open = false;
  for (const step of (r.instructions || [])) {
    if (/^##\s*/.test(step)) {
      out += `<li class="stepsec">${esc(step.replace(/^##\s*/, ''))}</li>`;
    } else {
      out += `<li>${linkifyTimers(esc(step))}</li>`;
      open = true;
    }
  }
  return out || (open ? '' : '<li class="muted">Ingen fremgangsmåde</li>');
}

RENDER.recipeDetail = () => {
  const r = recipeById(S.viewArg);
  if (!r) { S.view = 'recipes'; return RENDER.recipes(); }
  /* Listen har kun kort-felterne - hent resten, foer opskriften kan vises. */
  if (r.partial) { ensureFull(r).then(() => { if (S.view === 'recipeDetail') render(); }); return '<p class="muted">Henter opskriften …</p>'; }
  const base = r.servings || app().defaultServings;
  if (S.detailFor !== r.id) { S.detailFor = r.id; S.detailServings = base; }
  if (!S.detailServings) S.detailServings = base;
  const factor = S.detailServings / base;

  return `<div class="toprow"><div class="grow">
      <p class="small" style="margin:0 0 6px"><a href="#" id="backToList">← Opskrifter</a></p>
      <h1>${esc(r.title)}</h1>
      <p class="sub">${r.category ? esc(r.category) + ' · ' : ''}${(r.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join(' ')}</p>
    </div>
    <div class="rowflex">
      <button class="iconbtn" id="favBtn" title="Favorit" style="font-size:22px">${r.favorite ? '⭐' : '☆'}</button>
      <button class="btn" id="cookBtn">👨‍🍳 Kogetilstand</button>
      <button class="btn" id="shopBtn">🛒 Til indkøbsliste</button>
      <button class="btn" id="planBtn">📅 Til madplan</button>
      <button class="btn" id="printBtn">🖨️ Print</button>
      <button class="btn" id="editBtn">✏️ Redigér</button>
    </div></div>

  <div class="rowflex" style="margin:6px 0 14px">
    ${r.prepMin ? `<span class="timechip">🔪 Forberedelse: ${fmtMin(r.prepMin)}</span>` : ''}
    ${r.cookMin ? `<span class="timechip">🍳 Tilberedning: ${fmtMin(r.cookMin)}</span>` : ''}
    ${recipeTotalMin(r) ? `<span class="timechip">⏱ I alt: ${fmtMin(recipeTotalMin(r))}</span>` : ''}
    ${r.nutrition ? `<span class="timechip" title="Pr. portion${r.nutrition.estimated ? ' (AI-estimat)' : ''}">🔥 ${r.nutrition.kcal} kcal · ${r.nutrition.protein} g protein · ${r.nutrition.carbs} g kulhydrat · ${r.nutrition.fat} g fedt</span>` : ''}
    ${starsPickHtml(r)}
  </div>
  <div class="rowflex" style="margin:0 0 14px">
    <button class="btn small" id="shareBtn">${r.shareToken ? '🔗 Deles – vis link' : '🔗 Del med et link'}</button>
    ${S.settings.aiKeySet ? `<button class="btn small" id="nutriBtn">🥗 ${r.nutrition ? 'Genberegn ernæring' : 'Estimér ernæring'} (AI)</button>` : ''}
    ${hasImperial(r) ? '<button class="btn small" id="metricBtn">🌍 Omregn til metrisk (cups → dl …)</button>' : ''}
  </div>

  <div class="recdetail">
    <div>
      ${imageSrcOrRemote(r) ? `<div class="recphoto"><img src="${esc(imageSrcOrRemote(r))}" alt=""></div>` : ''}
      ${r.description ? `<p class="muted" style="margin-top:12px">${esc(r.description)}</p>` : ''}
      <h2>Ingredienser</h2>
      <div class="rowflex" style="margin-bottom:4px">
        <span class="servstep">
          <button class="btn" id="servMinus">−</button>
          <strong>${S.detailServings} ${/portion|person/i.test(r.yieldText || '') || !r.yieldText ? 'portioner' : esc(r.yieldText.replace(/\d+\s*/, ''))}</strong>
          <button class="btn" id="servPlus">+</button>
        </span>
        ${factor !== 1 ? '<span class="chip on">skaleret</span>' : ''}
      </div>
      <ul class="ings">${ingredientsHtml(r, factor)}</ul>
      ${r.url ? `<p class="small">Kilde: <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(new URL(r.url).hostname)} ↗</a></p>` : ''}
    </div>
    <div>
      <h2 style="margin-top:0">Fremgangsmåde</h2>
      <ol class="steps">${instructionsHtml(r)}</ol>
      ${r.notes ? `<h2>Noter</h2><p style="white-space:pre-wrap">${esc(r.notes)}</p>` : ''}
      <p class="small muted" style="margin-top:22px">Tip: klik på et minuttal i fremgangsmåden for at starte en timer.</p>
    </div>
  </div>`;
};
RENDER.recipeDetail_bind = () => {
  const r = recipeById(S.viewArg);
  if (!r || r.partial) return;             // venter stadig paa resten af opskriften
  $('#backToList').onclick = e => { e.preventDefault(); S.detailServings = null; goto('recipes'); };
  $('#editBtn').onclick = () => recipeModal(r);
  $('#cookBtn').onclick = () => openCookMode(r);
  $('#printBtn').onclick = () => printRecipe(r);
  $('#favBtn').onclick = async () => { r.favorite = !r.favorite; await saveItem(r, true); render(); };
  $('#shopBtn').onclick = () => addRecipeToShopping(r, S.detailServings / (r.servings || app().defaultServings));
  $('#planBtn').onclick = () => planEntryModal(null, { recipeId: r.id });
  $('#servMinus').onclick = () => { S.detailServings = Math.max(1, S.detailServings - 1); render(); };
  $('#servPlus').onclick = () => { S.detailServings = S.detailServings + 1; render(); };
  bindStarPickers();
  $('#shareBtn').onclick = () => shareRecipeModal(r);
  const nutri = $('#nutriBtn');
  if (nutri) nutri.onclick = () => aiEstimateNutrition(r, nutri);
  const metric = $('#metricBtn');
  if (metric) metric.onclick = async () => {
    if (!await confirmBox('Omregn alle amerikanske mål (cups, oz, lbs, °F …) til metrisk i denne opskrift? Ændringen gemmes.', 'Omregn')) return;
    convertRecipeToMetric(r);
    await saveItem(r);
    render();
  };
  bindInlineTimers(r.title);
};

/* ---------------- deling med offentligt link ---------------- */
function shareRecipeModal(r) {
  const draw = () => {
    const link = r.shareToken ? location.origin + '/del/' + r.shareToken : '';
    openModal(`<h2>🔗 Del "${esc(r.title)}"</h2>
      ${r.shareToken ? `
        <p class="small muted">Alle med linket kan se opskriften – uden login. Slå delingen fra igen når som helst.</p>
        <div class="rowflex">
          <input id="shareUrl" readonly value="${esc(link)}" style="flex:1;min-width:260px">
          <button class="btn small" id="shareCopy">Kopiér</button>
        </div>
        <div class="actions">
          <button class="btn danger" id="shareOff" style="margin-right:auto">Slå deling fra</button>
          <button class="btn" id="shareClose">Luk</button>
        </div>`
      : `<p class="small muted">Lav et offentligt link, så familie og venner kan se opskriften uden login.</p>
        <div class="actions">
          <button class="btn" id="shareClose">Annullér</button>
          <button class="btn primary" id="shareOn">Lav link</button>
        </div>`}`, m => {
      m.querySelector('#shareClose').onclick = () => { closeModal(); render(); };
      const on = m.querySelector('#shareOn');
      if (on) on.onclick = async () => {
        r.shareToken = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
        await saveItem(r, true);
        draw();
      };
      const off = m.querySelector('#shareOff');
      if (off) off.onclick = async () => {
        delete r.shareToken;
        await saveItem(r, true);
        toast('Delingen er slået fra');
        closeModal();
        render();
      };
      const copy = m.querySelector('#shareCopy');
      if (copy) copy.onclick = () => {
        m.querySelector('#shareUrl').select();
        navigator.clipboard.writeText(link).then(() => toast('Link kopieret'));
      };
    });
  };
  draw();
}

/* ---------------- ernaering (AI-estimat pr. portion) ---------------- */
async function aiEstimateNutrition(r, btn) {
  btn.disabled = true;
  btn.textContent = '🥗 Beregner …';
  try {
    const sys = `Du estimerer næringsindhold for madopskrifter. Svar KUN med ét JSON-objekt, ingen forklaring:
{"kcal": tal, "protein": tal, "carbs": tal, "fat": tal} – alle PR. PORTION, afrundet til hele tal.`;
    const res = await api('/api/ai', {
      body: {
        system: sys,
        messages: [{ role: 'user', content: `Opskrift: ${r.title}\nPortioner: ${r.servings || app().defaultServings}\nIngredienser:\n${(r.ingredients || []).join('\n')}` }],
        maxTokens: 512
      }
    });
    const j = parseAiJson(res.text, false);
    if (!j) throw new Error('AI-svaret kunne ikke læses.' + aiSvarUddrag(res.text));
    if (typeof j.kcal !== 'number') throw new Error('AI gav ikke et brugbart estimat');
    r.nutrition = {
      kcal: Math.round(j.kcal), protein: Math.round(j.protein || 0),
      carbs: Math.round(j.carbs || 0), fat: Math.round(j.fat || 0), estimated: true
    };
    await saveItem(r, true);
    toast('Ernæring estimeret (pr. portion)');
    render();
  } catch (e) {
    toast('Kunne ikke estimere: ' + e.message, true);
    btn.disabled = false;
    btn.textContent = '🥗 Estimér ernæring (AI)';
  }
}

/* ---------------- print ---------------- */
function printRecipe(r) {
  const factor = (S.detailServings || r.servings || 1) / (r.servings || S.detailServings || 1);
  printSheet(`${printLogoHtml()}
    <h1>${esc(r.title)}</h1>
    <p style="text-align:center">${r.category ? esc(r.category) + ' · ' : ''}${S.detailServings || r.servings || ''} portioner
      ${recipeTotalMin(r) ? ' · ' + fmtMin(recipeTotalMin(r)) : ''}</p>
    <h2>Ingredienser</h2>
    <ul>${(r.ingredients || []).map(l => `<li>${esc(scaleIngredient(l, factor))}</li>`).join('')}</ul>
    <h2>Fremgangsmåde</h2>
    <ol>${(r.instructions || []).map(s => /^##/.test(s) ? `</ol><h2>${esc(s.replace(/^##\s*/, ''))}</h2><ol>` : `<li>${esc(s)}</li>`).join('')}</ol>
    ${r.url ? `<p class="pdate">Kilde: ${esc(r.url)}</p>` : ''}`, r.title);
}

/* ---------------- redigerings-modal ---------------- */
function recipeModal(r, prefill) {
  const isNew = !r;
  const d = r || Object.assign({
    id: uid(), kind: 'recipe', title: '', description: '', image: '', url: '',
    ingredients: [], instructions: [], prepMin: null, cookMin: null, totalMin: null,
    servings: app().defaultServings, yieldText: '', category: '', tags: [], rating: 0,
    favorite: false, notes: '', createdAt: new Date().toISOString()
  }, prefill || {});
  const cats = app().categories || [];

  openModal(`<h2>${isNew ? 'Ny opskrift' : 'Redigér opskrift'}</h2>
    <div class="formgrid" style="grid-template-columns:2fr 1fr">
      <label class="fld"><span>Titel</span><input id="rmTitle" value="${esc(d.title)}"></label>
      <label class="fld"><span>Kategori</span><select id="rmCat">
        <option value="">–</option>${cats.map(c => `<option${c === d.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}
      </select></label>
    </div>
    <label class="fld"><span>Kort beskrivelse</span><textarea id="rmDesc" rows="2">${esc(d.description)}</textarea></label>
    <div class="formgrid">
      <label class="fld"><span>Portioner</span><input id="rmServ" type="number" min="1" value="${d.servings || ''}"></label>
      <label class="fld"><span>Forberedelse (min)</span><input id="rmPrep" type="number" min="0" value="${d.prepMin || ''}"></label>
      <label class="fld"><span>Tilberedning (min)</span><input id="rmCook" type="number" min="0" value="${d.cookMin || ''}"></label>
      <label class="fld"><span>Tags (komma-adskilt)</span><input id="rmTags" value="${esc((d.tags || []).join(', '))}"></label>
    </div>
    <label class="fld"><span>Ingredienser – én pr. linje ("## Overskrift" laver en gruppe)</span>
      <textarea id="rmIngs" rows="8">${esc((d.ingredients || []).join('\n'))}</textarea></label>
    <label class="fld"><span>Fremgangsmåde – ét trin pr. linje ("## Overskrift" laver en sektion)</span>
      <textarea id="rmSteps" rows="8">${esc((d.instructions || []).join('\n'))}</textarea></label>
    <label class="fld"><span>Noter (kun til dig selv)</span><textarea id="rmNotes" rows="2">${esc(d.notes || '')}</textarea></label>
    <div class="formgrid" style="grid-template-columns:2fr 1fr">
      <label class="fld"><span>Kilde-URL</span><input id="rmUrl" value="${esc(d.url || '')}"></label>
      <label class="fld"><span>Billede</span>
        <span class="rowflex">
          <button class="btn small" id="rmImgPick">${hasImage(d) ? 'Skift…' : 'Vælg…'}</button>
          ${hasImage(d) ? '<button class="btn small danger" id="rmImgDel">Fjern</button>' : ''}
          <input id="rmImgFile" type="file" accept="image/*" hidden>
        </span></label>
    </div>
    <div class="actions">
      ${isNew ? '' : '<button class="btn danger" id="rmDelete" style="margin-right:auto">Slet opskrift</button>'}
      <button class="btn" id="rmCancel">Annullér</button>
      <button class="btn primary" id="rmSave">Gem</button>
    </div>`, m => {
    /* nytBillede: null = uroert · '' = fjern · dataURL = erstat.
     * En importeret opskrift kommer med billedet som dataURL i kladden - det
     * skal gemmes som et selvstaendigt billed-item, ikke inde i opskriften. */
    let nytBillede = (typeof d.image === 'string' && d.image.startsWith('data:')) ? d.image : null;
    m.querySelector('#rmImgPick').onclick = () => m.querySelector('#rmImgFile').click();
    m.querySelector('#rmImgFile').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      nytBillede = await blobToScaledDataUrl(f);
      m.querySelector('#rmImgPick').textContent = 'Valgt ✓';
    };
    const del = m.querySelector('#rmImgDel');
    if (del) del.onclick = () => { nytBillede = ''; del.disabled = true; m.querySelector('#rmImgPick').textContent = 'Vælg…'; };
    m.querySelector('#rmCancel').onclick = closeModal;
    if (!isNew) m.querySelector('#rmDelete').onclick = async () => {
      if (!await confirmBox(`Slet opskriften "${d.title}"?`)) return;
      closeModal();
      await deleteItem(d);
      S.detailServings = null;
      goto('recipes');
    };
    m.querySelector('#rmSave').onclick = async () => {
      d.title = m.querySelector('#rmTitle').value.trim();
      if (!d.title) return toast('Opskriften skal have en titel', true);
      d.category = m.querySelector('#rmCat').value;
      d.description = m.querySelector('#rmDesc').value.trim();
      d.servings = parseInt(m.querySelector('#rmServ').value, 10) || null;
      d.prepMin = parseInt(m.querySelector('#rmPrep').value, 10) || null;
      d.cookMin = parseInt(m.querySelector('#rmCook').value, 10) || null;
      d.tags = m.querySelector('#rmTags').value.split(',').map(t => t.trim()).filter(Boolean);
      d.ingredients = m.querySelector('#rmIngs').value.split('\n').map(l => l.trim()).filter(Boolean);
      d.instructions = m.querySelector('#rmSteps').value.split('\n').map(l => l.trim()).filter(Boolean);
      d.notes = m.querySelector('#rmNotes').value.trim();
      d.url = m.querySelector('#rmUrl').value.trim();
      closeModal();
      /* billedet gemmes som sit eget item - saa opskriften selv bliver ved med
       * at vaere et par kilobyte og kan sendes med i listen */
      if (nytBillede) await saveRecipeImage(d, nytBillede);
      else if (nytBillede === '') await deleteRecipeImage(d);
      await saveItem(d);
      goto('recipeDetail', d.id);
    };
  }, true);
}

/* ---------------- billeder: skaler til dataURL saa alt gemmes lokalt ---------------- */
/* opts.png = behold PNG (bevarer gennemsigtighed - JPEG goer transparent til SORT,
 * hvilket oedelaegger logoer). Fotos gemmes som JPEG for pladsens skyld. */
function blobToScaledDataUrl(blob, maxDim, opts) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = maxDim || 720;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      let url;
      if (opts && opts.png) {
        url = cv.toDataURL('image/png');
        /* PNG kan ikke kvalitets-skrues ned - skalér i stedet, hvis den er for stor */
        let w = cv.width, h = cv.height;
        while (url.length > 160000 && w > 64) {
          w = Math.round(w * 0.8); h = Math.round(h * 0.8);
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          url = cv.toDataURL('image/png');
        }
      } else {
        let q = 0.82;
        url = cv.toDataURL('image/jpeg', q);
        while (url.length > 160000 && q > 0.4) { q -= 0.12; url = cv.toDataURL('image/jpeg', q); }
      }
      URL.revokeObjectURL(img.src);
      resolve(url);
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('Kunne ikke læse billedet')); };
    img.src = URL.createObjectURL(blob);
  });
}
async function fetchImageAsDataUrl(url) {
  if (!url) return '';
  try {
    const r = await fetch('/api/fetch-image?url=' + encodeURIComponent(url));
    if (!r.ok) return '';
    return await blobToScaledDataUrl(await r.blob());
  } catch (e) { return ''; }
}

/* ---------------- import fra URL ---------------- */
function importUrlModal() {
  openModal(`<h2>🌐 Importér opskrift</h2>
    <p class="muted small">Indsæt et link til en opskrift – fx fra Valdemarsro, Arla, Madens Verden
    eller de fleste andre opskriftsider. Kokkeri trækker selv titel, ingredienser, fremgangsmåde,
    tider og billede ud og gemmer linket, så du altid kan gå tilbage til originalen.</p>
    <label class="fld"><span>URL</span><input id="impUrl" placeholder="https://…" autocomplete="off"></label>
    <details style="margin-top:12px" id="impPasteBox">
      <summary class="small muted" style="cursor:pointer">Siden kræver login? Eller opskriften står i dine noter? Indsæt indholdet her</summary>
      <p class="small muted" style="margin:8px 0 6px">
        <b>Side bag login:</b> åbn opskriften i din browser (logget ind), vis sidens kilde
        (<span class="kbd">⌘⌥U</span> / <span class="kbd">Ctrl+U</span>), kopiér det hele og indsæt her –
        så bruges din egen adgang, og Kokkeri parser HTML'en præcis som ved et link.
        Alternativt: markér al tekst på siden (<span class="kbd">⌘A</span>, <span class="kbd">⌘C</span>) og indsæt.<br>
        <b>Fra noter:</b> indsæt bare opskrift-teksten${S.settings.aiKeySet ? ' – AI\'en strukturerer den' : ' (kræver AI-nøgle under Indstillinger)'}.
      </p>
      <textarea id="impPaste" rows="7" style="width:100%" placeholder="Indsæt HTML eller opskrift-tekst her …"></textarea>
    </details>
    <p class="small muted" id="impStatus" style="min-height:18px"></p>
    <div class="actions">
      <button class="btn" id="impCancel">Annullér</button>
      <button class="btn primary" id="impGo">Hent opskrift</button>
    </div>`, m => {
    const status = m.querySelector('#impStatus');
    const input = m.querySelector('#impUrl');
    const paste = m.querySelector('#impPaste');
    input.focus();
    m.querySelector('#impCancel').onclick = closeModal;

    /* faelles afslutning: recipe-objekt eller AI-fallback paa raa tekst */
    const finish = async (res, url) => {
      if (res.recipe) {
        status.textContent = 'Fandt opskriften – henter billede …';
        const image = await fetchImageAsDataUrl(res.recipe.image);
        closeModal();
        openImportedRecipe(res.recipe, image);
        return true;
      }
      if (res.pageText) {
        if (!S.settings.aiKeySet) {
          status.innerHTML = 'Ingen maskinlæsbar opskrift (JSON-LD/microdata). Med en AI-nøgle under <b>Indstillinger</b> kan Kokkeri i stedet læse indholdet med AI.';
          return false;
        }
        status.textContent = 'Ingen maskinlæsbar opskrift – prøver med AI (kan tage ~20 sek.) …';
        const rec = await aiExtractRecipe(res.pageText, url, res.pageTitle);
        const image = await fetchImageAsDataUrl(rec.image || res.pageImage);
        closeModal();
        openImportedRecipe(Object.assign(rec, { url }), image);
        return true;
      }
      status.textContent = 'Kunne ikke finde en opskrift.';
      return false;
    };

    const go = async () => {
      let url = input.value.trim();
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      const raw = paste.value.trim();
      if (!url && !raw) return;
      const btn = m.querySelector('#impGo');
      btn.disabled = true;
      try {
        if (raw) {
          /* indsat indhold vinder over URL'en (som saa kun bruges som kilde-link) */
          const looksHtml = /<\/(div|p|html|body|head|script|li|span|h\d|article)>/i.test(raw) || /<html[\s>]/i.test(raw);
          if (looksHtml) {
            status.textContent = 'Analyserer HTML …';
            if (!await finish(await api('/api/parse-recipe', { body: { html: raw, url } }), url)) btn.disabled = false;
          } else {
            if (!S.settings.aiKeySet) {
              status.innerHTML = 'Ren tekst kræver en AI-nøgle under <b>Indstillinger</b> – eller indsæt sidens HTML i stedet.';
              btn.disabled = false;
              return;
            }
            status.textContent = 'AI\'en strukturerer teksten (kan tage ~20 sek.) …';
            const rec = await aiExtractRecipe(raw.slice(0, 30000), url, '');
            const image = await fetchImageAsDataUrl(rec.image);
            closeModal();
            openImportedRecipe(Object.assign(rec, { url }), image);
          }
        } else {
          status.textContent = 'Henter siden …';
          if (!await finish(await api('/api/fetch-recipe?url=' + encodeURIComponent(url)), url)) btn.disabled = false;
        }
      } catch (e) {
        status.textContent = 'Fejl: ' + e.message;
        btn.disabled = false;
      }
    };
    m.querySelector('#impGo').onclick = go;
    input.onkeydown = e => { if (e.key === 'Enter') go(); };
  });
}

function openImportedRecipe(rec, image) {
  /* gaet en kategori ud fra sidens kategori-tekst, tags og titel */
  const catGuess = guessCategory({
    sourceCategory: rec.category || '', title: rec.title || '',
    tags: rec.keywords ? String(rec.keywords).split(',') : []
  });
  recipeModal(null, {
    title: rec.title || '',
    description: rec.description || '',
    image: image || '',
    url: rec.url || '',
    ingredients: rec.ingredients || [],
    instructions: rec.instructions || [],
    prepMin: rec.prepMin || null,
    cookMin: rec.cookMin || null,
    totalMin: rec.totalMin || null,
    servings: rec.servings || app().defaultServings,
    yieldText: rec.yieldText || '',
    category: catGuess,
    tags: (rec.keywords ? String(rec.keywords).split(',').map(t => t.trim()).filter(Boolean).slice(0, 6) : [])
  });
  toast('Opskriften er hentet – tjek den igennem og tryk Gem');
}

/* AI-fallback: udtraek opskrift af raa sidetekst (eller chat-svar) */
async function aiExtractRecipe(text, sourceUrl, pageTitle) {
  const sys = `Du udtrækker madopskrifter af rå tekst. Svar KUN med ét JSON-objekt, ingen forklaring, ingen markdown-hegn.
Format: {"title": str, "description": str, "servings": tal|null, "prepMin": tal|null, "cookMin": tal|null,
"ingredients": [str, ...], "instructions": [str, ...], "category": str}
Ingredienser: én pr. linje med mængde først (fx "500 g hakket oksekød"). Brug "## Overskrift" som linje for grupper/sektioner.
Fremgangsmåde: ét trin pr. streng, uden numre. Behold dansk sprog (oversæt IKKE en udenlandsk opskrift).
Findes der ingen opskrift i teksten, svar {"error": "ingen opskrift fundet"}.`;
  const r = await api('/api/ai', {
    body: {
      system: sys,
      messages: [{ role: 'user', content: (pageTitle ? 'Sidens titel: ' + pageTitle + '\n\n' : '') + text }],
      maxTokens: 4096
    }
  });
  const j = parseAiJson(r.text, false);
  if (!j) throw new Error('AI-svaret kunne ikke læses som en opskrift.' + aiSvarUddrag(r.text));
  if (j.error) throw new Error(j.error);
  if (!j.title || !Array.isArray(j.ingredients)) throw new Error('AI fandt ingen opskrift på siden');
  return {
    title: j.title, description: j.description || '', servings: j.servings || null,
    prepMin: j.prepMin || null, cookMin: j.cookMin || null,
    ingredients: j.ingredients.map(String), instructions: (j.instructions || []).map(String),
    category: j.category || '', url: sourceUrl || ''
  };
}

/* ---------------- indkoebsliste fra opskrift ---------------- */
/* springer varer over, der ligger i forraadet, gaetter afdeling og laegger
 * ens varer sammen med det, der allerede staar paa listen */
async function addRecipeToShopping(r, factor) {
  const lines = (r.ingredients || []).filter(l => !/^##/.test(l));
  if (!lines.length) return toast('Opskriften har ingen ingredienser', true);
  let skipped = 0;
  const items = [];
  for (const l of lines) {
    const text = scaleIngredient(l, factor || 1);
    if (inPantry(text)) { skipped++; continue; }
    items.push({
      id: uid(), kind: 'shopItem', text, group: r.title,
      section: guessSection(text), done: false, createdAt: new Date().toISOString()
    });
  }
  if (items.length) await saveBulk(items);
  const merged = await mergeShoppingItems();
  toast(`${items.length} varer føjet til listen` +
    (skipped ? ` · ${skipped} sprunget over (i forråd)` : '') +
    (merged ? ` · ${merged} lagt sammen` : ''));
  renderNav();
}

/* ---------------- kogetilstand ---------------- */
const CM = { recipe: null, step: 0, wakeWasOn: false, checked: new Set() };

function openCookMode(r) {
  CM.recipe = r;
  CM.step = 0;
  CM.checked = new Set();
  CM.wakeWasOn = S.wakeOn;
  if (!S.wakeOn) setWakeLock(true); // skaermen skal ikke slukke midt i madlavningen
  drawCookMode();
  $('#cookMode').hidden = false;
}
function closeCookMode() {
  $('#cookMode').hidden = true;
  $('#cookMode').innerHTML = '';
  if (!CM.wakeWasOn && S.wakeOn) setWakeLock(false);
  CM.recipe = null;
}
/* aktive timere som stribe oeverst i kogetilstanden.
 * Bruger samme [data-timerid]/.ttime-kontrakt som timer-motoren, saa
 * nedtaellingen opdateres uden at hele kogetilstanden gentegnes. */
function cookTimersHtml() {
  if (!S.timers.length) return '';
  return S.timers.map(t => `
    <button class="cmtimer${t.ringing ? ' ringing' : ''}${t.paused ? ' paused' : ''}" data-timerid="${t.id}"
      data-cmtimer="${t.id}" title="${t.ringing ? 'Klik for at stoppe alarmen' : 'Klik for at pause/fortsætte'}">
      <span>${t.ringing ? '⏰' : t.paused ? '⏸' : '⏱'}</span>
      <span class="tlbl">${esc(t.label)}</span>
      <span class="ttime">${t.ringing ? '0:00' : fmtTimer(timerRemainMs(t))}</span>
    </button>`).join('');
}
function refreshCookTimers() {
  const host = $('#cmTimers');
  if (!host) return;
  host.innerHTML = cookTimersHtml();
  bindCookTimers();
}
function bindCookTimers() {
  $$('[data-cmtimer]').forEach(b => b.onclick = () => {
    const t = S.timers.find(x => x.id === b.dataset.cmtimer);
    if (!t) return;
    if (t.ringing) S.timers = S.timers.filter(x => x.id !== t.id);
    else if (t.paused) { t.endsAt = Date.now() + t.remainMs; t.remainMs = null; t.paused = false; }
    else { t.remainMs = timerRemainMs(t); t.paused = true; }
    saveTimers();
    refreshCookTimers();
    renderNav();
  });
}

function drawCookMode() {
  const r = CM.recipe;
  const steps = (r.instructions || []).filter(s => !/^##/.test(s));
  const factor = (S.detailServings || r.servings || 1) / (r.servings || S.detailServings || 1);
  const step = steps[CM.step] || '';
  $('#cookMode').innerHTML = `
    <div class="cmhead">
      <h2>👨‍🍳 ${esc(r.title)}</h2>
      <button class="chip chipbtn${S.wakeOn ? ' on' : ''}" id="cmWake" style="${S.wakeOn ? '' : 'color:var(--red);border-color:var(--red)'}">
        ${S.wakeOn ? '📱 skærmen holdes tændt' : '📴 skærmen holdes IKKE tændt'}</button>
      <button class="btn" id="cmTimer">⏱️ Timer</button>
      <button class="btn" id="cmClose">✕ Luk</button>
    </div>
    <div class="cmtimers" id="cmTimers">${cookTimersHtml()}</div>
    <div class="cmbody">
      <div class="cmings">
        <h3 style="margin-top:0">Ingredienser <span class="muted small">(kryds af undervejs)</span></h3>
        <ul>${(r.ingredients || []).map((line, i) => {
          if (/^##\s*/.test(line)) return `<li style="border:0;font-weight:700;color:var(--amber);padding-top:12px">${esc(line.replace(/^##\s*/, ''))}</li>`;
          return `<li><label class="chk cmck${CM.checked.has(i) ? ' done' : ''}">
            <input type="checkbox" data-cmck="${i}" ${CM.checked.has(i) ? 'checked' : ''}>
            <span>${esc(scaleIngredient(line, factor))}</span></label></li>`;
        }).join('')}</ul>
      </div>
      <div>
        <div class="cmstepnum">Trin ${CM.step + 1} af ${steps.length}</div>
        <div class="cmstep">${linkifyTimers(esc(step))}</div>
      </div>
    </div>
    <div class="cmfoot">
      <button class="btn" id="cmPrev" ${CM.step === 0 ? 'disabled' : ''}>← Forrige</button>
      <div class="cmprogress">${steps.map((_, i) => i === CM.step ? '●' : '○').join(' ')}</div>
      ${CM.step < steps.length - 1
        ? '<button class="btn primary" id="cmNext">Næste →</button>'
        : '<button class="btn primary" id="cmDone">✓ Færdig</button>'}
    </div>`;
  $('#cmClose').onclick = closeCookMode;
  $('#cmWake').onclick = () => setWakeLock(!S.wakeOn);
  $('#cmTimer').onclick = () => newTimerModal(r.title);
  bindCookTimers();
  $$('[data-cmck]').forEach(cb => cb.onchange = () => {
    const i = +cb.dataset.cmck;
    if (cb.checked) CM.checked.add(i); else CM.checked.delete(i);
    cb.closest('label').classList.toggle('done', cb.checked);
  });
  $('#cmPrev').onclick = () => { if (CM.step > 0) { CM.step--; drawCookMode(); } };
  const next = $('#cmNext');
  if (next) next.onclick = () => { CM.step++; drawCookMode(); };
  const done = $('#cmDone');
  if (done) done.onclick = async () => {
    CM.recipe.timesCooked = (CM.recipe.timesCooked || 0) + 1;
    CM.recipe.lastCooked = isoDate();
    await saveItem(CM.recipe, true);
    closeCookMode();
    toast('Velbekomme! 🍽️');
    render();
  };
  bindInlineTimers(r.title);
}
document.addEventListener('keydown', e => {
  if ($('#cookMode').hidden || $('#modalHost').innerHTML) return;
  if (e.key === 'ArrowRight') { const b = $('#cmNext'); if (b) b.click(); }
  else if (e.key === 'ArrowLeft') { const b = $('#cmPrev'); if (b && !b.disabled) b.click(); }
  else if (e.key === 'Escape') closeCookMode();
});
