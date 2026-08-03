/* ---------------- navigation og skal ---------------- */
const VIEWS = [
  { id: 'dash',      ico: '📊', label: 'Overblik' },
  { id: 'recipes',   ico: '📖', label: 'Opskrifter' },
  { id: 'plan',      ico: '📅', label: 'Madplan' },
  { id: 'shopping',  ico: '🛒', label: 'Indkøbsliste' },
  { id: 'timers',    ico: '⏱️', label: 'Timere' },
  { id: 'assistant', ico: '✨', label: 'AI-assistent' },
  { id: 'settings',  ico: '⚙️', label: 'Indstillinger' }
];
const RENDER = {}; // id -> funktion

function navBadge(id) {
  if (id === 'timers') {
    const n = S.timers.length;
    return n ? `<span class="navbadge">${n}</span>` : '';
  }
  if (id === 'shopping') {
    const n = K('shopItem').filter(i => !i.done).length;
    return n ? `<span class="navbadge">${n}</span>` : '';
  }
  return '';
}

function renderNav() {
  $('#navItems').innerHTML = `<button class="navbtn" id="navSearch">
      <span class="ico">🔍</span><span>Søg</span><span class="hint" style="margin-left:auto"><span class="kbd">⌘K</span></span>
    </button><div class="navsep"></div>` + VIEWS.map(v =>
    `<button class="navbtn${S.view === v.id ? ' active' : ''}" data-view="${v.id}">
       <span class="ico">${v.ico}</span><span>${v.label}</span>${navBadge(v.id)}</button>`).join('');
  $$('#navItems .navbtn[data-view]').forEach(b => b.onclick = () => {
    if (matchMedia('(max-width: 760px)').matches) document.body.classList.remove('navopen');
    goto(b.dataset.view);
  });
  $('#navSearch').onclick = openPalette;
  renderNavTimers();
  $('#navVersion').textContent = 'Kokkeri v' + APP_VERSION;
  const A = app();
  $('#brandName').textContent = A.appTitle || 'Kokkeri';
  $('#brandLogo').innerHTML = S.settings.logo ? `<img class="navlogo" src="${S.settings.logo}">` : '🍳';
}

/* aktive timere i sidebaren - nedtaellingen opdateres af timer-motoren via [data-timerid] */
function renderNavTimers() {
  const host = $('#navTimers');
  if (!host) return;
  host.innerHTML = S.timers.map(t => `
    <button class="navtimer${t.ringing ? ' ringing' : ''}${t.paused ? ' paused' : ''}" data-timerid="${t.id}" title="Gå til timerne">
      <span>${t.ringing ? '⏰' : t.paused ? '⏸' : '⏱'}</span>
      <span class="tlbl">${esc(t.label)}</span>
      <span class="ttime">${t.ringing ? '0:00' : fmtTimer(timerRemainMs(t))}</span>
    </button>`).join('');
  host.querySelectorAll('.navtimer').forEach(b => b.onclick = () => {
    if (matchMedia('(max-width: 760px)').matches) document.body.classList.remove('navopen');
    goto('timers');
  });
}

/* render() gentegner KUN - den maa ikke scrolle. Baggrundsting (site-import,
 * billed-hentning, timere) kalder render() loebende, og et scrollTo her ville
 * kaste brugeren til toppen midt i en side. Sideskift scroller i goto(). */
function render() {
  renderNav();
  const fn = RENDER[S.view] || RENDER.dash;
  $('#app').innerHTML = fn();
  const binder = RENDER[S.view + '_bind'];
  if (binder) binder();
  updateWakeBtn();
}
function goto(view, arg) {
  S.view = view;
  S.viewArg = arg == null ? null : arg;
  render();
  window.scrollTo(0, 0);
}

function pageHead(title, sub, extraHtml) {
  return `<div class="toprow"><div class="grow"><h1>${esc(title)}</h1><p class="sub">${sub || ''}</p></div>
    ${extraHtml || ''}</div>`;
}

/* faelles: opskrift-dropdown */
function recipeOptions(selectedId) {
  const list = K('recipe').slice().sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'da'));
  return '<option value="">– vælg opskrift –</option>' + list.map(r =>
    `<option value="${r.id}"${r.id === selectedId ? ' selected' : ''}>${esc(r.title)}</option>`).join('');
}

/* ---------------- kommandopalet (Cmd/Ctrl+K) ---------------- */
function paletteItems() {
  const items = VIEWS.map(v => ({ ico: v.ico, label: v.label, hint: 'side', run: () => goto(v.id) }));
  items.push(
    { ico: '📖', label: 'Ny opskrift', hint: 'handling', run: () => { goto('recipes'); recipeModal(null); } },
    { ico: '🌐', label: 'Importér opskrift fra URL', hint: 'handling', run: () => { goto('recipes'); importUrlModal(); } },
    { ico: '📋', label: 'Importér fra indsat HTML/noter', hint: 'handling', run: () => { goto('recipes'); importUrlModal(); setTimeout(() => { const d = $('#impPasteBox'); if (d) { d.open = true; $('#impPaste').focus(); } }, 60); } },
    { ico: '📚', label: 'Masse-import fra et site (bag login)', hint: 'handling', run: () => { goto('recipes'); siteImportModal(); } },
    { ico: '⏱️', label: 'Ny timer', hint: 'handling', run: () => { goto('timers'); newTimerModal(); } },
    { ico: '🛒', label: 'Tilføj til indkøbsliste', hint: 'handling', run: () => { goto('shopping'); setTimeout(() => { const el = $('#shopNew'); if (el) el.focus(); }, 50); } },
    { ico: '📱', label: S.wakeOn ? 'Slå skærmlås fra' : 'Hold skærmen tændt', hint: 'handling', run: () => setWakeLock(!S.wakeOn) },
    { ico: '🎲', label: 'Tilfældig opskrift', hint: 'handling', run: randomRecipe },
    { ico: '🌶️', label: 'Importér Paprika-eksport', hint: 'handling', run: () => { goto('settings'); setTimeout(() => { const b = $('#papImport'); if (b) b.scrollIntoView({ block: 'center' }); }, 60); } },
    { ico: '🌗', label: 'Skift tema', hint: 'handling', run: () => $('#themeQuick').click() }
  );
  /* opskrifter kan findes direkte fra paletten */
  for (const r of K('recipe')) {
    items.push({ ico: '🍽️', label: r.title || '(uden titel)', hint: 'opskrift', run: () => goto('recipeDetail', r.id) });
  }
  return items;
}

function randomRecipe() {
  const list = K('recipe');
  if (!list.length) return toast('Ingen opskrifter endnu', true);
  goto('recipeDetail', list[Math.floor(Math.random() * list.length)].id);
}

function openPalette() {
  if (!S.me || $('#palette')) return;
  const wrap = document.createElement('div');
  wrap.id = 'palette';
  wrap.innerHTML = `<div class="palbox">
      <input id="palInput" placeholder="Hop til side, opskrift eller handling…" autocomplete="off">
      <div class="palist" id="palList"></div>
    </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('#palInput');
  const list = wrap.querySelector('#palList');
  let sel = 0, shown = [];

  const close = () => wrap.remove();
  const draw = () => {
    const q = normName(input.value);
    shown = paletteItems().filter(it => !q || normName(it.label).includes(q)).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length ? shown.map((it, i) => `
      <div class="palitem${i === sel ? ' sel' : ''}" data-i="${i}">
        <span class="ico">${it.ico}</span><span>${esc(it.label)}</span><span class="hint">${it.hint}</span>
      </div>`).join('') : '<div class="palempty">Ingen resultater</div>';
    list.querySelectorAll('.palitem').forEach(el => {
      el.onmouseenter = () => { sel = +el.dataset.i; draw(); };
      el.onclick = () => { const it = shown[+el.dataset.i]; close(); it.run(); };
    });
    const selEl = list.querySelector('.palitem.sel');
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[sel]) { close(); shown[sel].run(); } }
    else if (e.key === 'Escape') close();
  };
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  draw();
  input.focus();
}

/* ---------------- auth-flow ---------------- */
async function boot() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    }
  });
  $('#navToggle').onclick = () => {
    if (matchMedia('(max-width: 760px)').matches) document.body.classList.toggle('navopen');
    else {
      document.body.classList.toggle('navfold');
      try { localStorage.setItem('kk_nav', document.body.classList.contains('navfold') ? '1' : ''); } catch (e) {}
    }
  };
  $('#themeQuick').onclick = () => {
    const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = cur;
    try { localStorage.setItem('kk_theme', cur); } catch (e) {}
    updateThemeBtn();
  };
  $('#wakeQuick').onclick = () => setWakeLock(!S.wakeOn);
  $('#logoutBtn').onclick = async () => { await api('/api/logout', { body: {} }); location.reload(); };

  try {
    const r = await api('/api/me');
    S.me = r.me;
    await enterApp();
  } catch (e) {
    showLogin();
  }
}
function updateThemeBtn() {
  $('#themeQuick').textContent = document.documentElement.dataset.theme === 'light' ? '🌙' : '☀️';
}

function showLogin() {
  document.body.className = 'noauth';
  $('#loginView').hidden = false;
  $('nav').hidden = true;
  $('#navToggle').hidden = true;
  $('#app').hidden = true;

  // skjul "Opret ny bruger" naar admin har lukket for registrering
  api('/api/public-config').then(cfg => {
    $('#showRegister').parentElement.hidden = !cfg.allowRegistration;
  }).catch(() => {});

  const doLogin = async () => {
    try {
      const r = await api('/api/login', { body: { username: $('#loginUser').value, password: $('#loginPass').value } });
      S.me = r.me;
      await enterApp();
    } catch (e) { toast(e.message, true); }
  };
  $('#loginBtn').onclick = doLogin;
  $('#loginPass').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
  $('#passkeyBtn').onclick = passkeyLogin;
  $('#showRegister').onclick = e => { e.preventDefault(); $('#loginForm').hidden = true; $('#registerForm').hidden = false; };
  $('#showLogin').onclick = e => { e.preventDefault(); $('#loginForm').hidden = false; $('#registerForm').hidden = true; };
  $('#registerBtn').onclick = async () => {
    if ($('#regPass').value !== $('#regPass2').value) return toast('Kodeordene er ikke ens', true);
    try {
      const r = await api('/api/register', { body: { username: $('#regUser').value, password: $('#regPass').value } });
      S.me = r.me;
      if (r.firstUser) toast('Du er oprettet som administrator');
      await enterApp();
    } catch (e) { toast(e.message, true); }
  };
}

async function enterApp() {
  /* Kun kort-felterne ved login - resten hentes i baggrunden af hydrateItems().
   * Med billederne inde i opskrifterne var dette kald 248 MB ved 2534 opskrifter. */
  const [settings, items] = await Promise.all([api('/api/settings'), api('/api/items?fields=card')]);
  S.settings = Object.assign({ app: {}, logo: '' }, settings);
  S.items = items.items || [];
  S.hydrated = false;
  reindex();
  hydrateItems();
  S.weekStart = mondayOf();
  document.body.className = '';
  try { if (localStorage.getItem('kk_nav') === '1') document.body.classList.add('navfold'); } catch (e) {}
  $('#loginView').hidden = true;
  $('nav').hidden = false;
  $('#navToggle').hidden = false;
  $('#app').hidden = false;
  $('#whoAmI').textContent = S.me.username + (S.me.isAdmin ? ' · admin' : '');
  updateThemeBtn();
  if (S.settings.logo) {
    $('#loginLogo').innerHTML = `<img src="${S.settings.logo}">`;
  }
  loadTimers();
  startTimerEngine();
  /* koerer der en site-import (startet foer browseren blev lukket)? vis den igen */
  api('/api/site/crawl/status').then(st => {
    if (st && st.running) { S.crawl = st; startCrawlPolling(); render(); }
    else {
      /* efterslaeb fra et tidligere crawl: manglende kategorier og billeder */
      categorizeImported().then(n => { if (n) render(); });
      localizeRemoteImages(6);
    }
  }).catch(() => {});
  try { if (localStorage.getItem('kk_wake') === '1') setWakeLock(true); } catch (e) {}
  render();
}

/* WebAuthn hjaelpere */
const waB64uToBuf = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const waBufToB64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function passkeyLogin() {
  try {
    const o = await api('/api/webauthn/login/options', { body: {} });
    const pk = o.publicKey;
    pk.challenge = waB64uToBuf(pk.challenge);
    const cred = await navigator.credentials.get({ publicKey: pk });
    const r = await api('/api/webauthn/login/verify', {
      body: {
        challengeId: o.challengeId,
        id: cred.id,
        response: {
          clientDataJSON: waBufToB64u(cred.response.clientDataJSON),
          authenticatorData: waBufToB64u(cred.response.authenticatorData),
          signature: waBufToB64u(cred.response.signature)
        }
      }
    });
    S.me = r.me;
    await enterApp();
  } catch (e) {
    if (e.name !== 'NotAllowedError') toast('Passkey-login fejlede: ' + e.message, true);
  }
}
async function passkeyRegister() {
  try {
    const o = await api('/api/webauthn/register/options', { body: {} });
    const pk = o.publicKey;
    pk.challenge = waB64uToBuf(pk.challenge);
    pk.user.id = waB64uToBuf(pk.user.id);
    pk.excludeCredentials = (pk.excludeCredentials || []).map(c => ({ type: 'public-key', id: waB64uToBuf(c.id) }));
    const cred = await navigator.credentials.create({ publicKey: pk });
    const label = prompt('Navn til denne passkey (fx "MacBook" eller "iPhone"):', 'Denne enhed') || 'Passkey';
    const r = await api('/api/webauthn/register/verify', {
      body: {
        challengeId: o.challengeId,
        label,
        response: { clientDataJSON: waBufToB64u(cred.response.clientDataJSON), attestationObject: waBufToB64u(cred.response.attestationObject) }
      }
    });
    S.me = r.me;
    toast('Passkey registreret');
    render();
  } catch (e) {
    if (e.name !== 'NotAllowedError') toast('Kunne ikke registrere passkey: ' + e.message, true);
  }
}
