/* ---------------- AI-assistent (chat) ---------------- */

function assistantSystemPrompt() {
  const recipes = K('recipe').map(r => ({
    id: r.id, titel: r.title, kategori: r.category || '',
    min: recipeTotalMin(r),
    vurdering: r.rating || null, favorit: !!r.favorite
  }));
  const monday = mondayOf();
  const plan = K('planEntry')
    .filter(e => e.date >= monday && e.date <= addDays(monday, 13))
    .map(e => {
      const r = e.recipeId ? recipeById(e.recipeId) : null;
      return e.date + ': ' + (r ? r.title : e.text || '');
    });
  return `Du er køkkenassistenten i appen "Kokkeri" – brugerens eget opskrifts-bibliotek.
Du hjælper på dansk med madlavning: opskrifter, teknik, erstatninger af ingredienser, skalering,
menu-idéer og madplaner. Vær konkret og kortfattet.

I dag er det ${isoDate()} (${WEEKDAYS_DA[(new Date().getDay() + 6) % 7]}).

Brugerens opskrifter (JSON): ${JSON.stringify(recipes).slice(0, 20000)}

Madplan de næste to uger: ${plan.length ? plan.join('; ') : 'tom'}

Når du foreslår en komplet opskrift, så skriv den med tydelige afsnit "Ingredienser:" og
"Fremgangsmåde:", så brugeren kan gemme den med ét klik. Nævner brugeren en af sine egne
opskrifter, så tag udgangspunkt i den.`;
}

RENDER.assistant = () => {
  if (!S.settings.aiKeySet) {
    return pageHead('AI-assistent', 'Din personlige køkkenassistent') + `
    <div class="panelbox center" style="padding:40px">
      <div style="font-size:40px">✨</div>
      <h2 style="margin-top:8px">Assistenten er ikke sat op endnu</h2>
      <p class="muted">Tilføj din Claude API-nøgle under Indstillinger, så kan assistenten hjælpe med
      opskrift-idéer, madplaner, ingrediens-erstatninger og import af opskrifter fra sider uden
      maskinlæsbare data.</p>
      <button class="btn primary" id="aiToSettings">⚙️ Gå til Indstillinger</button>
    </div>`;
  }
  const hints = ['Hvad kan jeg lave med det, jeg har i køleskabet?',
    'Foreslå en hurtig hverdagsret', 'Lav en vegetarisk madplan til ugen',
    'Hvad kan jeg bruge i stedet for fløde?'];
  return pageHead('AI-assistent', 'Spørg om alt i køkkenet – assistenten kender dine opskrifter og din madplan',
      `<button class="btn" id="aiClear" ${S.chat.length ? '' : 'disabled'}>Ryd samtale</button>`) + `
  <div class="chatwrap">
    <div class="chatlog" id="chatLog">
      ${S.chat.length ? S.chat.map((m, i) => `
        <div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.content)}${
          m.role === 'assistant' && /ingredienser/i.test(m.content) && /fremgangsmåde/i.test(m.content)
            ? `<div class="msgact"><button class="btn small" data-saverec="${i}">💾 Gem som opskrift</button></div>` : ''
        }</div>`).join('')
      : `<div class="msg ai">Hej! Jeg er din køkkenassistent 👨‍🍳 Spørg mig om opskrifter, madplaner,
        erstatninger eller teknik – jeg kender dit bibliotek på ${K('recipe').length} opskrifter.</div>
        <div class="chathints">${hints.map(h => `<span class="chip chipbtn" data-hint="${esc(h)}">${esc(h)}</span>`).join('')}</div>`}
      ${S.chatBusy ? '<div class="msg ai thinking">Tænker …</div>' : ''}
    </div>
    <div class="chatinput">
      <textarea id="chatText" placeholder="Skriv til assistenten… (Enter sender, Shift+Enter = ny linje)"></textarea>
      <button class="btn primary" id="chatSend" ${S.chatBusy ? 'disabled' : ''}>Send</button>
    </div>
  </div>`;
};
RENDER.assistant_bind = () => {
  const toSettings = $('#aiToSettings');
  if (toSettings) { toSettings.onclick = () => goto('settings'); return; }

  const log = $('#chatLog');
  log.scrollTop = log.scrollHeight;
  $('#aiClear').onclick = () => { S.chat = []; render(); };
  $$('[data-hint]').forEach(c => c.onclick = () => sendChat(c.dataset.hint));
  $$('[data-saverec]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    b.textContent = 'Læser opskriften …';
    try {
      const rec = await aiExtractRecipe(S.chat[+b.dataset.saverec].content, '', '');
      recipeModal(null, Object.assign(rec, { url: '' }));
    } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = '💾 Gem som opskrift'; }
  });
  const ta = $('#chatText');
  const send = () => { const v = ta.value.trim(); if (v) sendChat(v); };
  $('#chatSend').onclick = send;
  ta.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };
  if (!S.chatBusy) ta.focus();
};

async function sendChat(text) {
  if (S.chatBusy) return;
  S.chat.push({ role: 'user', content: text });
  S.chatBusy = true;
  render();
  try {
    const r = await api('/api/ai', {
      body: { system: assistantSystemPrompt(), messages: S.chat, maxTokens: 3000 }
    });
    S.chat.push({ role: 'assistant', content: r.text || '(tomt svar)' });
  } catch (e) {
    S.chat.push({ role: 'assistant', content: '⚠️ ' + e.message });
  }
  S.chatBusy = false;
  if (S.view === 'assistant') render();
}
