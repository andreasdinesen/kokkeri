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
  'Hvad står der på madplanen i denne uge?'];

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
  p.querySelector('#aiNy').onclick = () => { S.chat = []; tegnAi(); p.querySelector('#aiInput').focus(); };
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
  if (vis) { tegnAi(); const f = p.querySelector('#aiInput'); if (f && !S.chatBusy) f.focus(); }
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
  get_shopping_list: 'Læste indkøbslisten'
};
function aiKaldHtml(k) {
  const x = k.input || {};
  const r = k.name === 'get_recipe' ? recipeById(x.id) : null;
  const del = r ? r.title : x.query || (Array.isArray(x.ingredients) ? x.ingredients.join(', ') : '')
    || (x.from && x.to ? x.from + ' – ' + x.to : '') || x.category || '';
  return `<div class="ai-trin">🔎 ${esc(AI_VAERKTOEJ_NAVN[k.name] || k.name)}${del ? ` <span class="muted">· ${esc(del)}</span>` : ''}</div>`;
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
  const linjer = S.chat.map((m, i) => {
    if (m.role === 'user') return `<div class="msg user">${esc(m.content)}</div>`;
    const trin = (m.tools || []).map(aiKaldHtml).join('');
    const gem = /ingredienser/i.test(m.content) && /fremgangsmåde/i.test(m.content)
      ? `<div class="msgact"><button class="btn small" type="button" data-saverec="${i}">💾 Gem som opskrift</button></div>` : '';
    return trin + `<div class="msg ai${m.fejl ? ' fejl' : ''}">${aiTekst(m.content)}${gem}</div>`;
  });
  if (!S.chat.length) {
    linjer.push(`<div class="ai-tom"><p>Hej! Jeg er din køkkenassistent 👨‍🍳 Jeg kan søge i og læse alle dine
      ${K('recipe').length} opskrifter, din madplan og indkøbsliste – og sende dig direkte links.</p>
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
  tegnAi();
  try {
    const r = await api('/api/ai/assistent', {
      body: {
        messages: S.chat.filter(m => !m.fejl).map(m => ({ role: m.role, content: m.content })),
        kontekst: aiKontekst()
      }
    });
    S.chat.push({ role: 'assistant', content: r.text || '(tomt svar)', tools: r.tools || [] });
  } catch (e) {
    S.chat.push({ role: 'assistant', content: '⚠️ ' + e.message, fejl: true });
  }
  S.chatBusy = false;
  tegnAi();
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
