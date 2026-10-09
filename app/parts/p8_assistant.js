/* ---------------- AI-assistent (panel i hoejre side) ----------------
 *
 * v41: assistenten bor ikke laengere paa sin egen side, men i et panel, der
 * aabnes fra ✨-knappen i toppen af HVER side (samme moenster som qlk og sagu).
 * Serveren (/api/ai/assistent) giver modellen MCP-serverens laese-vaerktoejer,
 * saa den kan soege i hele biblioteket, laese opskrifterne fuldt ud og linke
 * til dem som [Titel](/opskrift/<id>). Samtalen bor kun i hukommelsen (S.chat).
 */

const AI_GENVEJ = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘⌥A' : 'Ctrl+Alt+A';
const AI_HINTS = ['Hvad kan jeg lave med kylling og ris?',
  'Foreslå en hurtig hverdagsret fra mine opskrifter',
  'Hvilke af mine opskrifter er vegetariske?',
  'Hvad står der på madplanen i denne uge?',
  'Læg noget med kylling på madplanen i morgen, og sæt ingredienserne på indkøbslisten'];

function aiKnapHtml() {
  return `<button class="btn ai-knap" id="aiBtn" type="button" aria-label="Spørg assistenten"
    title="Spørg assistenten (${AI_GENVEJ})"><span class="ai-gnist">✨</span><span>Spørg</span></button>`;
}

/* Kaldes af render(): knappen staar fast i oeverste hoejre hjoerne af HVER
 * side (absolut i <main>), saa ingen RENDER-funktion skal huske den, og den
 * ikke drukner i en side med mange handlingsknapper (opskriften). */
function indsaetAiKnap() {
  const host = $('#app');
  if (!host || host.querySelector('#aiBtn')) return;
  host.insertAdjacentHTML('beforeend', aiKnapHtml());
  host.querySelector('#aiBtn').onclick = () => visAi(aiPanel().hidden);
}

function aiPanel() {
  let p = $('#aiPanel');
  if (p) return p;
  document.body.insertAdjacentHTML('beforeend', `<aside class="ai-panel" id="aiPanel" role="dialog" aria-labelledby="aiTitel" hidden>
    <div class="ai-hoved">
      <h2 id="aiTitel">✨ Køkkenassistent</h2>
      <button class="iconbtn" id="aiHist" type="button" title="Tidligere samtaler" aria-label="Tidligere samtaler">🕘</button>
      <button class="iconbtn" id="aiNy" type="button" title="Ny samtale" aria-label="Ny samtale">＋</button>
      <button class="iconbtn" id="aiLuk" type="button" title="Luk (Esc)" aria-label="Luk">✕</button>
    </div>
    <div class="ai-log" id="aiLog" aria-live="polite"></div>
    <form class="ai-form" id="aiForm">
      <textarea id="aiInput" rows="2" placeholder="Spørg om dine opskrifter… (Enter sender)"></textarea>
      <button class="btn primary" type="submit" id="aiSend">Send</button>
    </form>
  </aside>`);
  p = $('#aiPanel');
  p.querySelector('#aiLuk').onclick = () => visAi(false);
  p.querySelector('#aiNy').onclick = () => {
    if (S.chatBusy) return;
    S.chat = []; S.chatId = null; S.chatHistorik = null;
    tegnAi(); p.querySelector('#aiInput').focus();
  };
  p.querySelector('#aiHist').onclick = () => (S.chatHistorik ? (S.chatHistorik = null, tegnAi()) : visHistorik());
  const felt = p.querySelector('#aiInput');
  felt.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); p.querySelector('#aiForm').requestSubmit(); }
    if (e.key === 'Escape') { e.preventDefault(); visAi(false); }
  });
  p.querySelector('#aiForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = felt.value.trim();
    if (v && !S.chatBusy) { felt.value = ''; sendChat(v); }
  });
  /* Ét klik-lyt for hele loggen - den tegnes om ved hvert svar. */
  p.addEventListener('click', async e => {
    const a = e.target.closest('a[data-ai-opskrift]');
    if (a) {
      e.preventDefault();
      if (!recipeById(a.dataset.aiOpskrift)) { toast('Opskriften findes ikke længere', true); return; }
      if (window.innerWidth < 1200) visAi(false);
      goto('recipeDetail', a.dataset.aiOpskrift);
      return;
    }
    const aabn = e.target.closest('[data-samtale]');
    if (aabn) { aabnSamtale(aabn.dataset.samtale); return; }
    const slet = e.target.closest('[data-slet-samtale]');
    if (slet) { sletSamtale(slet.dataset.sletSamtale); return; }
    if (e.target.closest('#aiTilbage')) { S.chatHistorik = null; tegnAi(); return; }
    const h = e.target.closest('[data-hint]');
    if (h) { sendChat(h.dataset.hint); return; }
    if (e.target.closest('#aiToSettings')) { visAi(false); goto('settings'); visSettingsFane('integrationer'); return; }
    const b = e.target.closest('[data-saverec]');
    if (b) {
      b.disabled = true;
      b.textContent = 'Læser opskriften …';
      try {
        const rec = await aiExtractRecipe(S.chat[+b.dataset.saverec].content, '', '');
        recipeModal(null, Object.assign(rec, { url: '' }));
      } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = '💾 Gem som opskrift'; }
    }
  });
  return p;
}

function visAi(vis) {
  const p = aiPanel();
  /* Lukkes panelet, maa fokus ikke blive i det skjulte felt. */
  if (!vis && p.contains(document.activeElement)) document.activeElement.blur();
  p.hidden = !vis;
  document.body.classList.toggle('ai-aaben', vis);
  if (vis) {
    tegnAi();
    const f = p.querySelector('#aiInput'); if (f && !S.chatBusy) f.focus();
    if (!S.chatHentet) hentSenesteSamtale();
  }
}

/* ---------------- samtalerne gemmes paa serveren (v45) ----------------
 * En genindlaesning maa ikke slette det, man har skrevet. Samtalen gemmes
 * efter hvert spoergsmaal OG hvert svar (pr. bruger, tabellen ai_samtaler),
 * og panelet aabner med den seneste igen. 🕘 viser de tidligere. */
async function hentSenesteSamtale() {
  S.chatHentet = true;
  if (S.chat.length || S.chatBusy) return;      // man er allerede i gang
  try {
    const r = await api('/api/ai/samtaler');
    const seneste = (r.samtaler || [])[0];
    if (seneste && !S.chat.length && !S.chatBusy) await aabnSamtale(seneste.id, true);
  } catch (e) { /* ingen historik - en tom samtale virker fint */ }
}

async function gemSamtale() {
  if (!S.chat.length) return;
  if (!S.chatId) S.chatId = uid();
  try {
    await api('/api/ai/samtaler/' + S.chatId, { method: 'PUT', body: { beskeder: S.chat } });
  } catch (e) { toast('Samtalen blev ikke gemt: ' + e.message, true); }
}

async function aabnSamtale(id, stille) {
  if (S.chatBusy) return;
  try {
    const r = await api('/api/ai/samtaler/' + encodeURIComponent(id));
    S.chat = r.beskeder || [];
    S.chatId = r.id;
    S.chatHistorik = null;
    tegnAi();
  } catch (e) { if (!stille) toast(e.message, true); }
}

async function visHistorik() {
  S.chatHistorik = [];
  S.chatHistorikHenter = true;
  tegnAi();
  try { S.chatHistorik = (await api('/api/ai/samtaler')).samtaler || []; }
  catch (e) { S.chatHistorik = null; toast(e.message, true); }
  S.chatHistorikHenter = false;
  tegnAi();
}

async function sletSamtale(id) {
  if (!await confirmBox('Slet samtalen?', 'Slet')) return;
  try { await api('/api/ai/samtaler/' + encodeURIComponent(id), { method: 'DELETE', body: {} }); }
  catch (e) { return toast(e.message, true); }
  if (S.chatId === id) { S.chat = []; S.chatId = null; }
  if (S.chatHistorik) S.chatHistorik = S.chatHistorik.filter(x => x.id !== id);
  tegnAi();
}

/* "i dag 14:05", "i går 09:30", ellers datoen. */
function samtaleTid(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const kl = d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  const dage = Math.round((new Date(isoDate()) - new Date(isoDate(d))) / 864e5);
  return dage === 0 ? 'i dag ' + kl : dage === 1 ? 'i går ' + kl : fmtDate(iso);
}

function historikHtml() {
  if (!S.chatHistorik.length) return `<p class="muted">${S.chatHistorikHenter ? 'Henter …' : 'Ingen tidligere samtaler endnu.'}</p>
    <button class="btn small" id="aiTilbage" type="button">← Tilbage</button>`;
  return `<div class="ai-histhoved"><strong>Tidligere samtaler</strong>
      <button class="btn small" id="aiTilbage" type="button">← Tilbage</button></div>
    <ul class="ai-historik">${S.chatHistorik.map(x => `<li class="${x.id === S.chatId ? 'on' : ''}">
      <button type="button" class="ai-histlink" data-samtale="${esc(x.id)}">
        <span class="ai-histtitel">${esc(x.titel)}</span><span class="small muted">${esc(samtaleTid(x.opdateret))}</span></button>
      <button type="button" class="iconbtn" data-slet-samtale="${esc(x.id)}" title="Slet samtalen" aria-label="Slet samtalen">🗑</button>
    </li>`).join('')}</ul>`;
}

/* Modellens tekst: escapet, saa lidt markdown. Links til /opskrift/<id> bliver
 * interne (goto), andre http(s)-links aabner i en ny fane. */
function aiTekst(s) {
  let h = esc(s);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\[([^\]\n]+)\]\(\/opskrift\/([0-9a-zA-Z-]{6,64})\)/g,
    '<a href="/opskrift/$2" data-ai-opskrift="$2" class="ai-opskrift">$1</a>');
  h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  h = h.replace(/^#{1,4} (.+)$/gm, '<strong>$1</strong>');
  h = h.replace(/(?:^|\n)((?:[-*] .+(?:\n|$))+)/g, (m, liste) =>
    `\n<ul>${liste.trim().split('\n').map(l => `<li>${l.replace(/^[-*] /, '')}</li>`).join('')}</ul>\n`);
  return h.trim().replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>').replace(/<br>(<ul>)|(<\/ul>)<br>/g, '$1$2');
}

const AI_VAERKTOEJ_NAVN = {
  search_recipes: 'Søgte i opskrifterne', get_recipe: 'Læste opskriften',
  what_can_i_cook: 'Søgte efter råvarer', get_meal_plan: 'Læste madplanen',
  get_shopping_list: 'Læste indkøbslisten',
  add_to_meal_plan: 'Lagde på madplanen', add_to_shopping_list: 'Føjede til indkøbslisten'
};
const AI_SKRIVER = new Set(['add_to_meal_plan', 'add_to_shopping_list']);
function aiKaldHtml(k) {
  const x = k.input || {};
  const r = x.id || x.recipe_id ? recipeById(x.id || x.recipe_id) : null;
  const del = [x.date ? fmtDate(x.date) : '',
    r ? r.title : x.query || x.text || (Array.isArray(x.ingredients) ? x.ingredients.join(', ') : '')
      || (Array.isArray(x.items) ? x.items.join(', ') : '')
      || (x.from && x.to ? x.from + ' – ' + x.to : '') || x.category || ''].filter(Boolean).join(' · ');
  const skriver = AI_SKRIVER.has(k.name);
  const ikon = k.error ? '⚠️' : skriver ? '✅' : '🔎';
  return `<div class="ai-trin${skriver && !k.error ? ' skrev' : ''}${k.error ? ' daarlig' : ''}">${ikon} ${esc(AI_VAERKTOEJ_NAVN[k.name] || k.name)}${
    k.error ? ' – mislykkedes' : ''}${del ? ` <span class="muted">· ${esc(del)}</span>` : ''}</div>`;
}

/* Assistenten har lagt noget ind paa serveren: hent de datatyper igen, saa
 * madplanen, indkoebslisten og menuens taeller viser det med det samme.
 * render() scroller ikke, saa man bliver staaende, hvor man er. */
async function aiHentIgen(kinds) {
  for (const kind of kinds || []) {
    try {
      const svar = await api('/api/items?kind=' + encodeURIComponent(kind));
      S.items = S.items.filter(x => x.kind !== kind).concat(svar.items || []);
    } catch (e) { toast('Kunne ikke hente ' + kind + ' igen: ' + e.message, true); }
  }
  reindex();
  render();
}

function tegnAi() {
  const p = $('#aiPanel');
  if (!p || p.hidden) return;
  const log = p.querySelector('#aiLog');
  const form = p.querySelector('#aiForm');
  if (!S.settings.aiKeySet) {
    form.hidden = true;
    log.innerHTML = `<div class="ai-tom">
      <p><strong>Assistenten er ikke sat op endnu</strong></p>
      <p class="muted">Tilføj en Claude API-nøgle – eller din egen lokale AI-server (LM Studio/Ollama) –
      under Indstillinger, så kan assistenten søge i dine opskrifter, foreslå retter og hjælpe med madplanen.</p>
      <button class="btn" id="aiToSettings" type="button">⚙️ Gå til Indstillinger</button></div>`;
    return;
  }
  form.hidden = false;
  if (S.chatHistorik) {
    log.innerHTML = historikHtml();
    log.scrollTop = 0;
    return;
  }
  const linjer = S.chat.map((m, i) => {
    if (m.role === 'user') return `<div class="msg user">${esc(m.content)}</div>`;
    const trin = (m.tools || []).map(aiKaldHtml).join('');
    const gem = /ingredienser/i.test(m.content) && /fremgangsmåde/i.test(m.content)
      ? `<div class="msgact"><button class="btn small" type="button" data-saverec="${i}">💾 Gem som opskrift</button></div>` : '';
    return trin + `<div class="msg ai${m.fejl ? ' fejl' : ''}">${aiTekst(m.content)}${gem}</div>`;
  });
  if (!S.chat.length) {
    linjer.push(`<div class="ai-tom"><p>Hej! Jeg er din køkkenassistent 👨‍🍳 Jeg kan søge i og læse alle dine
      ${K('recipe').length} opskrifter, din madplan og indkøbsliste, sende dig direkte links –
      og lægge retter på madplanen og varer på indkøbslisten.</p>
      <div class="chathints">${AI_HINTS.map(h => `<span class="chip chipbtn" data-hint="${esc(h)}">${esc(h)}</span>`).join('')}</div></div>`);
  }
  if (S.chatBusy) linjer.push('<div class="msg ai thinking">Slår op og tænker …</div>');
  log.innerHTML = linjer.join('');
  log.scrollTop = log.scrollHeight;
  p.querySelector('#aiSend').disabled = !!S.chatBusy;
}

/* Det brugeren ser lige nu - saa "denne opskrift" giver mening for modellen. */
function aiKontekst() {
  let side = (VIEWS.find(v => v.id === S.view) || {}).label || '';
  if (S.view === 'recipeDetail') {
    const r = recipeById(S.viewArg);
    if (r) side = `opskriften "${r.title}" (id ${r.id})`;
  }
  return { idag: isoDate(), ugedag: WEEKDAYS_DA[(new Date().getDay() + 6) % 7], side };
}

async function sendChat(text) {
  if (S.chatBusy) return;
  S.chat.push({ role: 'user', content: text });
  S.chatBusy = true;
  S.chatHistorik = null;
  tegnAi();
  gemSamtale();                 // spoergsmaalet overlever en genindlaesning, mens der svares
  try {
    const r = await api('/api/ai/assistent', {
      body: {
        messages: S.chat.filter(m => !m.fejl).map(m => ({ role: m.role, content: m.content })),
        kontekst: aiKontekst()
      }
    });
    S.chat.push({ role: 'assistant', content: r.text || '(tomt svar)', tools: r.tools || [] });
    if (r.aendret && r.aendret.length) await aiHentIgen(r.aendret);
  } catch (e) {
    S.chat.push({ role: 'assistant', content: '⚠️ ' + e.message, fejl: true });
  }
  S.chatBusy = false;
  tegnAi();
  gemSamtale();
}

/* ⌘⌥A / Ctrl+Alt+A aabner og lukker panelet - samme genvej som i qlk og sagu.
 * e.code, ikke e.key: Alt+A giver "å" paa et dansk Mac-tastatur. */
document.addEventListener('keydown', e => {
  if (!S.me || e.code !== 'KeyA' || !e.altKey || e.shiftKey) return;
  const mac = AI_GENVEJ === '⌘⌥A';
  if (mac ? !(e.metaKey && !e.ctrlKey) : !(e.ctrlKey && !e.metaKey)) return;
  e.preventDefault();
  visAi(aiPanel().hidden);
});

/* /assistent (gamle bogmaerker, menupunktet, kommandopaletten) aabner panellet
 * oven paa overblikket - siden findes ikke laengere. */
RENDER.assistant = () => {
  S.view = 'dash';
  setTimeout(() => visAi(true), 0);
  return RENDER.dash();
};
