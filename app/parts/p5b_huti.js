/* ---------------- huti: fryseren, koeleskabet og spisekammeret (v55) ----------------
 * huti er husstandens inventar. Serveren (app/huti.js) spoerger hutis MCP-server med en
 * personlig noegle, der aldrig forlader serveren; fladen ser kun de rensede varer.
 * ALT fra huti escapes her alligevel - navne, steder og ord er utrovaerdigt input.
 *
 *  - Madplanen: knappen »🧊 Brug det, vi har« -> forslag (what_can_i_cook-matcheren paa
 *    serveren, spis snart foerst) -> »Læg på …« med laegPaaDag(), den samme vej som
 *    soegepanelet bruger. Hver ret paa madplanen faar maerket »fra huti: …«.
 *  - Kvik-visningen: maerket + »Tag ud i huti« (kun med en skrivenoegle, kun efter klik).
 *  - Indkoebslisten: linjer, huti har, vises i en dialog - brugeren vaelger, om de
 *    springes over eller kommer med (saa med maerket »har i huti: …«). Intet fjernes stille.
 *
 * Kaldene rammer /api/huti/*. Fejl giver en toast eller en linje - ALDRIG en ny runde
 * kald: S.hutiPlan husker noeglen for det, der er spurgt om, ogsaa naar det fejlede
 * (huti-broen fik en kaldeloekke af praecis den slags, se huti/claude-noter/kokkeri-broen.md). */

const hutiSat = () => !!(S.settings && S.settings.hutiSet);
const hutiKanSkrive = () => !!(S.settings && S.settings.hutiCanWrite);

/* Varerne (sidst hentede) slaas op pr. id - svarene har kun id'er pr. ret/linje. */
function hutiHusk(items) {
  S.hutiVarer = {};
  for (const v of items || []) S.hutiVarer[v.id] = v;
}
const hutiVare = id => (S.hutiVarer || {})[id] || null;
const hutiVarerAf = ids => (ids || []).map(hutiVare).filter(Boolean);

/* »2 poser« / »1 stk« - tom, naar huti ikke kender maengden. */
const HUTI_ENTAL = { poser: 'pose', portioner: 'portion', bokse: 'boks', pakker: 'pakke' };
function hutiMaengde(v) {
  if (v.quantity == null) return '';
  const n = String(v.quantity).replace('.', ',');
  const enhed = v.quantity === 1 && HUTI_ENTAL[v.unit] ? HUTI_ENTAL[v.unit] : v.unit;
  return enhed ? `${n} ${enhed}` : `${n} ×`;
}
/* »hjortekølle (spis snart, Fryser › Skuffe 2)« - escapet. */
function hutiVareTekst(v, medMaengde) {
  const om = [v.soon ? (v.pastLimit ? 'spis nu' : 'spis snart') : '', v.place || ''].filter(Boolean).join(', ');
  const m = medMaengde ? hutiMaengde(v) : '';
  return `${m ? esc(m) + ' ' : ''}${esc(v.name)}${om ? ` <span class="muted">(${esc(om)})</span>` : ''}`;
}
/* Maerket »fra huti: …« under en ret (madplan, forslag, kvik-visning). */
function hutiFraHtml(varer, maks) {
  if (!varer || !varer.length) return '';
  const vis = varer.slice(0, maks || 3);
  const snart = varer.some(v => v.soon);
  return `<div class="pmeta hutifra${snart ? ' snart' : ''}" title="Det har I i huti">🧊 fra huti: ${vis.map(v => hutiVareTekst(v)).join('; ')}`
    + `${varer.length > vis.length ? ` <span class="muted">+${varer.length - vis.length}</span>` : ''}</div>`;
}

/* ---------- madplanens maerker ---------- */

/* Hvilke af ugens retter bruger noget fra huti? Hentes én gang pr. (uge, retter) - ogsaa ved fejl. */
function hutiPlanNoegle(entries) {
  return [...new Set(entries.filter(e => e.recipeId).map(e => e.recipeId))].sort().join(',');
}
function hutiPlanMaerke(e) {
  if (!hutiSat() || !e.recipeId || !S.hutiPlan || !S.hutiPlan.matches) return '';
  return hutiFraHtml(hutiVarerAf(S.hutiPlan.matches[e.recipeId]), 2);
}
async function hutiOpdaterPlan(entries) {
  if (!hutiSat()) return;
  const noegle = hutiPlanNoegle(entries);
  if (!noegle || (S.hutiPlan && S.hutiPlan.noegle === noegle)) return;
  S.hutiPlan = { noegle, matches: null, henter: true };
  try {
    const d = await api('/api/huti/opskrifter', { body: { ids: noegle.split(',') } });
    hutiHusk(d.items);
    S.hutiPlan = { noegle, matches: d.matches || {} };
  } catch (e) {
    S.hutiPlan = { noegle, matches: null, fejl: e.message };
    return;                          // ingen render: siden er tegnet, og vi spoerger ikke igen
  }
  if (S.view === 'plan') render();
}

/* ---------- »Brug det, vi har« ---------- */

function hutiFrieDage(dates, slot) {
  return dates.filter(d => !K('planEntry').some(e => e.date === d && slotOf(e) === slot));
}
async function hutiForslagModal() {
  const monday = S.weekStart || mondayOf();
  const dates = weekDatesOf(monday);
  const st = { slot: lsGet('kk_hutislot', 'dinner') === 'lunch' ? 'lunch' : 'dinner', kunKat: lsGet('kk_hutikat', '1') === '1', d: null, fejl: '', lagt: {} };
  const tegn = m => {
    const d = st.d;
    const frie = hutiFrieDage(dates, st.slot);
    const dagValg = valgt => dates.map(x => `<option value="${x}"${x === valgt ? ' selected' : ''}>${esc(WEEKDAYS_DA[ugedagNr(x)])} ${esc(fmtDate(x))}${frie.includes(x) ? '' : ' (optaget)'}</option>`).join('');
    let krop;
    if (st.fejl) krop = `<p class="warn">${esc(st.fejl)}</p><div class="rowflex"><button class="btn small" id="hfIgen">Prøv igen</button></div>`;
    else if (!d) krop = '<p class="muted">Henter fra huti …</p>';
    else {
      const snartOrd = d.words.filter(w => w.soon);
      krop = `<p class="small" style="margin:0 0 8px"><b>${d.total}</b> madvarer i huti, <b>${d.eatSoon}</b> skal spises snart.`
        + `${snartOrd.length ? ` Spis snart: ${snartOrd.slice(0, 8).map(w => `<span class="chip small hutichip snart">${esc(w.word)}</span>`).join(' ')}` : ''}</p>`
        + (d.recipes.length ? `<div class="hutiforslag">${d.recipes.map(r => {
          const lokal = recipeById(r.id);
          const tid = lokal ? recipeTotalMin(lokal) : 0;
          const lagt = st.lagt[r.id];
          return `<div class="hutiret" data-hr="${esc(r.id)}">
            <div class="grow" style="min-width:0">
              <b>${esc(r.title || '(uden titel)')}</b>
              <span class="small muted">${[r.category, tid ? fmtMin(tid) : '', `bruger ${r.matched} af jeres varer`].filter(Boolean).map(esc).join(' · ')}</span>
              ${r.soon ? '<span class="chip small hutichip snart">spis snart</span>' : ''}
              ${hutiFraHtml(hutiVarerAf(r.from), 3)}
            </div>
            <div class="rowflex hutilaeg">
              ${lagt ? `<span class="good small">✓ lagt på ${esc(lagt)}</span>` : `<select data-hd="${esc(r.id)}" aria-label="Dag">${dagValg(frie.find(x => x >= isoDate()) || frie[0] || dates[0])}</select>
              <button class="btn small primary" data-hl="${esc(r.id)}">Læg på</button>`}
            </div>
          </div>`;
        }).join('')}</div>`
          : '<p class="muted">Ingen opskrifter i biblioteket bruger det, der er i huti' + (st.kunKat && st.slot !== 'lunch' ? ' – prøv uden kategorifilteret' : '') + '.</p>');
    }
    m.querySelector('#hfKrop').innerHTML = krop;
    const igen = m.querySelector('#hfIgen');
    if (igen) igen.onclick = () => hent(m, true);
    m.querySelectorAll('[data-hl]').forEach(b => b.onclick = async () => {
      const id = b.dataset.hl;
      const dag = m.querySelector(`[data-hd="${CSS.escape(id)}"]`).value;
      await laegPaaDag(dag, { recipeId: id }, st.slot);   // samme vej som soegepanelet
      st.lagt[id] = WEEKDAYS_DA[ugedagNr(dag)].toLowerCase() + ' ' + fmtDate(dag);
      tegn(m);
    });
  };
  const hent = async (m, frisk) => {
    st.fejl = ''; st.d = null; tegn(m);
    try {
      st.d = await api('/api/huti/forslag', { body: { meal: st.slot === 'lunch' ? 'lunch' : '', categories: st.kunKat ? fillCats() : null, frisk: !!frisk } });
      hutiHusk(st.d.items);
    } catch (e) { st.fejl = 'huti: ' + e.message; }
    if (document.body.contains(m)) tegn(m);
  };
  const kat = fillCats();
  openModal(`<h2>🧊 Brug det, vi har</h2>
    <p class="small muted" style="margin-top:0">Retter fra biblioteket, der bruger det, I har i fryseren, køleskabet og spisekammeret i huti –
      dem med noget, der skal spises snart, øverst. Vælg en dag, og læg retten på madplanen for uge ${isoWeekNo(monday)}.</p>
    <div class="rowflex" style="margin-bottom:8px">
      <select id="hfSlot" aria-label="Måltid">${SLOTS.filter(s => s.id === 'dinner' || s.id === 'lunch').map(s => `<option value="${s.id}"${st.slot === s.id ? ' selected' : ''}>${s.ico} ${s.label}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" id="hfKat"${st.kunKat ? ' checked' : ''}>
        <span class="small">Kun ${esc(kat.length ? kat.slice(0, 3).join(', ') + (kat.length > 3 ? ' …' : '') : 'de valgte kategorier')}</span></label>
      <button class="btn small" id="hfFrisk" title="Hent beholdningen fra huti igen">↻ Hent igen</button>
    </div>
    <div id="hfKrop"></div>
    <div class="actions"><button class="btn primary" id="hfLuk">Færdig</button></div>`, m => {
    m.querySelector('#hfLuk').onclick = () => { closeModal(); render(); };
    m.querySelector('#hfSlot').onchange = e => { st.slot = e.target.value; lsSet('kk_hutislot', st.slot); hent(m); };
    m.querySelector('#hfKat').onchange = e => { st.kunKat = e.target.checked; lsSet('kk_hutikat', st.kunKat ? '1' : '0'); hent(m); };
    m.querySelector('#hfFrisk').onclick = () => hent(m, true);
    hent(m);
  }, true);
}

/* ---------- »✨ Foreslå madplan (AI)« med hutis beholdning ----------
 * Madplan-AI'en er ét /api/ai-kald uden vaerktoejer (opskriftslisten staar i prompten),
 * saa huti kommer med som KONTEKST: beholdningen som tekst, og hver opskrift, der bruger
 * noget fra huti, faar feltet `huti` (raavareordene, »(spis snart)« paa dem, der haster).
 * Matchet er serverens (/api/huti/forslag = what_can_i_cook-matcheren), saa AI'en ser
 * det samme som »Brug det, vi har«. Maerkerne paa de lagte dage kommer af sig selv
 * (hutiPlanMaerke), fordi retterne nu staar paa madplanen. */
const HUTI_MADPLAN_REGEL = `Husstanden har mad i fryseren, køleskabet og spisekammeret (appen huti) – den står over opskrifterne.
Opskrifter med feltet "huti" bruger noget af det. Prioritér FØRST opskrifter, der bruger varer markeret "(spis snart)",
dernæst andre opskrifter med "huti", og fyld resten op med andre retter. Brug hver vare, der skal spises snart, højst
én gang, med mindre der er meget af den. Vælg stadig kun opskrifter fra listen, og hold variationen.`;
async function hutiMadplanKontekst(list) {
  if (!hutiSat()) return null;
  let d;
  /* ét klik = ét friskt opslag */
  try { d = await api('/api/huti/forslag', { body: { limit: 60, frisk: true } }); } catch (e) {
    console.warn('huti svarede ikke - madplanen laves uden:', e.message);
    return null;
  }
  hutiHusk(d.items);
  const bruger = {};
  for (const r of d.recipes || []) {
    const ord = [...new Set(hutiVarerAf(r.from).map(v => (v.word || v.name) + (v.soon ? ' (spis snart)' : '')))];
    if (ord.length) bruger[r.id] = ord;
  }
  const varer = (d.items || []).slice(0, 60).map(v => `- ${v.name}${hutiMaengde(v) ? ', ' + hutiMaengde(v) : ''}${v.soon ? ' – SPIS SNART' : ''}`);
  return {
    bruger,
    list: list.map(x => (bruger[x.id] ? Object.assign({}, x, { huti: bruger[x.id] }) : x)),
    tekst: `I huti (${d.total} madvarer, ${d.eatSoon} skal spises snart):\n${varer.join('\n')}`
  };
}

/* ---------- kvik-visningen: maerke + »Tag ud i huti« ---------- */

async function hutiKvikVis(m, r) {
  const boks = m.querySelector('#qvHuti');
  if (!boks || !hutiSat()) return;
  boks.innerHTML = '<p class="small muted" style="margin:8px 0 0">🧊 Spørger huti …</p>';
  let varer = [];
  try {
    const d = await api('/api/huti/opskrifter', { body: { ids: [r.id] } });
    hutiHusk(d.items);
    varer = hutiVarerAf((d.matches || {})[r.id]);
  } catch (e) {
    boks.innerHTML = `<p class="small warn" style="margin:8px 0 0">🧊 huti: ${esc(e.message)}</p>`;
    return;
  }
  if (!varer.length) { boks.innerHTML = '<p class="small muted" style="margin:8px 0 0">🧊 Intet fra huti i den her ret.</p>'; return; }
  boks.innerHTML = hutiFraHtml(varer, 6) + (hutiKanSkrive()
    ? `<div class="rowflex" style="margin-top:6px">${varer.slice(0, 6).map(v => `<button class="btn small" data-tagud="${v.id}"
        title="Træk én portion/pose fra i huti, når retten laves">➖ Tag ud i huti: ${esc(v.name)}</button>`).join('')}</div>`
    : '');
  boks.querySelectorAll('[data-tagud]').forEach(b => b.onclick = async () => {
    const v = hutiVare(+b.dataset.tagud);
    if (!v) return;
    if (!await confirmBox(`Tæl »${v.name}« én ned i huti (én portion/pose/stk – ${v.place || 'huti'})?`, 'Tag ud')) return;
    b.disabled = true;
    try {
      const svar = await api('/api/huti/tag-ud', { body: { stockId: v.id } });
      const rest = svar.stock && svar.stock.quantity != null ? ` – ${hutiMaengde(svar.stock)} tilbage` : '';
      toast(`Taget ud i huti: ${v.name}${rest}`);
      b.textContent = '✓ Taget ud';
      S.hutiPlan = null;               // maerkerne hentes igen naeste gang
    } catch (e) { b.disabled = false; toast('huti: ' + e.message, true); }
  });
}

/* ---------- indkoebslisten: har huti det? ---------- */

/* items: shopItem-udkast. -> de items, der skal gemmes (nogle med `huti`-maerket), eller
 * null, hvis brugeren fortryder. Uden huti, eller hvis huti ikke svarer, kommer alt med. */
async function hutiFiltrerIndkoeb(items) {
  if (!hutiSat() || !items.length) return items;
  let d;
  try { d = await api('/api/huti/linjer', { body: { lines: items.map(i => i.text) } }); } catch (e) {
    toast('huti kunne ikke spørges – alt kommer på listen (' + e.message + ')', true);
    return items;
  }
  hutiHusk(d.items);
  const ramt = items.map((it, i) => ({ it, varer: hutiVarerAf((d.matches || [])[i]) })).filter(x => x.varer.length);
  if (!ramt.length) return items;
  const harTekst = varer => 'har i huti: ' + varer.slice(0, 3).map(v => (hutiMaengde(v) ? hutiMaengde(v) + ' ' : '') + v.name).join(', ');
  return new Promise(resolve => {
    let svaret = false;
    const svar = v => { if (!svaret) { svaret = true; resolve(v); } };
    openModal(`<h2>🧊 Det har I allerede i huti</h2>
      <p class="small muted" style="margin-top:0">${ramt.length} af ${items.length} varer ligger i huti. Sæt flueben ved dem, der skal
        springes over – resten kommer på listen med et mærke, så I kan se, at de findes.</p>
      <ul class="hutilinjer">${ramt.map((x, i) => `<li><label class="chk">
        <input type="checkbox" data-hs="${i}" checked>
        <span><b>${esc(x.it.text)}</b><br><span class="small">🧊 ${x.varer.slice(0, 3).map(v => hutiVareTekst(v, true)).join('; ')}</span></span>
      </label></li>`).join('')}</ul>
      <div class="rowflex"><button class="btn small" id="hsAlle">Spring alle over</button><button class="btn small" id="hsIngen">Tag alle med</button></div>
      <div class="actions">
        <button class="btn" id="hsAnnuller">Annullér</button>
        <button class="btn primary" id="hsOk">Læg på listen</button>
      </div>`, m => {
      const bokse = () => [...m.querySelectorAll('[data-hs]')];
      m.querySelector('#hsAlle').onclick = () => bokse().forEach(b => { b.checked = true; });
      m.querySelector('#hsIngen').onclick = () => bokse().forEach(b => { b.checked = false; });
      m.querySelector('#hsAnnuller').onclick = () => { closeModal(); svar(null); };
      m.querySelector('#hsOk').onclick = () => {
        const spring = new Set();
        bokse().forEach(b => {
          const x = ramt[+b.dataset.hs];
          if (b.checked) spring.add(x.it);
          else x.it.huti = harTekst(x.varer).slice(0, 200);
        });
        closeModal();
        const ud = items.filter(it => !spring.has(it));
        ud.hutiSprunget = spring.size;
        svar(ud);
      };
    });
    /* lukkes modalen paa anden vis (klik udenfor), er det en fortrydelse */
    const vagt = setInterval(() => { if (!document.querySelector('#hsOk')) { clearInterval(vagt); svar(null); } }, 400);
  });
}

/* ---------- indstillinger ---------- */

/* Panelet selv staar i p9_settings.js (fanen Integrationer) - tests/faner.test.mjs
 * tegner skabelonen alene og vil se hvert afsnit dér. Her er kun bindingerne. */
function hutiIndstillingerBind() {
  const msg = t => { const el = $('#hutiMsg'); if (el) el.textContent = t; };
  const efter = d => { if (d && d.settings) S.settings = Object.assign(S.settings, d.settings); S.hutiPlan = null; };
  const tal = d => `${d.total} madvarer, ${d.eatSoon} skal spises snart${d.canWrite ? ' · nøglen kan tage ud' : ''}`;
  const gem = $('#hutiSave');
  if (gem) gem.onclick = async () => {
    gem.disabled = true; msg('Prøver huti …');
    try {
      const d = await api('/api/huti/forbind', { body: { url: $('#hutiUrl').value.trim(), key: $('#hutiKey').value.trim() } });
      efter(d);
      toast('huti er forbundet ✓ – ' + tal(d));
      render();
    } catch (e) { gem.disabled = false; msg(''); toast('huti: ' + e.message, true); }
  };
  const test = $('#hutiTest');
  if (test) test.onclick = async () => {
    test.disabled = true; msg('Prøver huti …');
    try {
      const d = await api('/api/huti/test', { body: {} });
      efter(d);
      toast('huti svarer ✓ – ' + tal(d));
      render();
    } catch (e) {
      test.disabled = false; msg('');
      toast('huti: ' + e.message, true);
      try { S.settings = Object.assign(S.settings, await api('/api/settings')); } catch (e2) {}
      render();
    }
  };
  const ryd = $('#hutiClear');
  if (ryd) ryd.onclick = async () => {
    if (!await confirmBox('Afbryd forbindelsen til huti? Nøglen slettes i Kokkeri, og knappen »Brug det, vi har« forsvinder.', 'Afbryd')) return;
    try { efter(await api('/api/huti/afbryd', { body: {} })); toast('Forbindelsen til huti er afbrudt'); } catch (e) { toast(e.message, true); }
    render();
  };
}
