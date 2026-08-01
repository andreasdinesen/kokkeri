/* ---------------- Timere ---------------- */
/* Timerne lever i localStorage (kk_timers), saa de overlever en genindlaesning.
 * {id, label, totalMs, endsAt (epoch-ms), remainMs (ved pause), paused, ringing} */

function loadTimers() {
  try { S.timers = JSON.parse(localStorage.getItem('kk_timers') || '[]'); } catch (e) { S.timers = []; }
  if (!Array.isArray(S.timers)) S.timers = [];
}
function saveTimers() {
  try { localStorage.setItem('kk_timers', JSON.stringify(S.timers)); } catch (e) {}
}

function startTimer(ms, label) {
  S.timers.push({
    id: uid(), label: label || 'Timer', totalMs: ms,
    endsAt: Date.now() + ms, remainMs: null, paused: false, ringing: false
  });
  saveTimers();
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  if (S.view === 'timers') render(); else renderNav();
}
function timerRemainMs(t) {
  return t.paused ? t.remainMs : Math.max(0, t.endsAt - Date.now());
}
function fmtTimer(ms) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}

/* ---- alarmlyd (WebAudio, ingen filer) ---- */
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const now = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, now + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.3, now + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.2);
      o.connect(g).connect(audioCtx.destination);
      o.start(now + i * 0.25);
      o.stop(now + i * 0.25 + 0.22);
    }
  } catch (e) {}
}

let timerEngineStarted = false;
function startTimerEngine() {
  if (timerEngineStarted) return;
  timerEngineStarted = true;
  setInterval(() => {
    let changed = false, anyRinging = false;
    for (const t of S.timers) {
      if (!t.paused && !t.ringing && Date.now() >= t.endsAt) {
        t.ringing = true;
        changed = true;
        toast('⏰ ' + t.label + ' er færdig!');
        if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification('⏰ ' + t.label, { body: 'Timeren er færdig' }); } catch (e) {}
        }
      }
      if (t.ringing) anyRinging = true;
    }
    if (anyRinging && Math.floor(Date.now() / 1000) % 2 === 0) beep();
    if (changed) {
      saveTimers();
      if (S.view === 'timers' || S.view === 'dash') render(); else renderNav();
    }
    /* opdater viste tider uden fuld gen-rendering */
    $$('[data-timerid]').forEach(card => {
      const t = S.timers.find(x => x.id === card.dataset.timerid);
      if (!t) return;
      const rem = timerRemainMs(t);
      const timeEl = card.querySelector('.ttime');
      if (timeEl) timeEl.textContent = t.ringing ? '0:00' : fmtTimer(rem);
      const bar = card.querySelector('.timerbar > div');
      if (bar) bar.style.width = (t.ringing ? 100 : Math.min(100, 100 - rem / t.totalMs * 100)) + '%';
    });
  }, 500);
}

RENDER.timers = () => {
  const presets = app().timerPresets || DEFAULT_APP.timerPresets;
  return pageHead('Timere', 'Køkkentimere – de kører videre, selv om du skifter side',
      `<button class="btn" id="wakePageBtn">📱 Hold skærmen tændt</button>`) + `
  <div class="panelbox">
    <div class="rowflex">
      ${presets.map(m => `<button class="btn" data-preset="${m}">${fmtMin(m)}</button>`).join('')}
      <span style="flex:1"></span>
      <input id="tmMin" type="number" min="1" placeholder="min" style="width:80px">
      <input id="tmLabel" placeholder="navn (fx pasta)" style="width:160px">
      <button class="btn primary" id="tmStart">▶ Start</button>
    </div>
  </div>
  ${S.timers.length ? `<div class="timergrid">
    ${S.timers.map(t => {
      const rem = timerRemainMs(t);
      return `<div class="timercard${t.ringing ? ' ringing' : ''}" data-timerid="${t.id}">
        <div class="tlabel">${esc(t.label)}</div>
        <div class="ttime">${t.ringing ? '0:00' : fmtTimer(rem)}</div>
        <div class="timerbar"><div style="width:${t.ringing ? 100 : Math.min(100, 100 - rem / t.totalMs * 100)}%"></div></div>
        <div class="tactions">
          ${t.ringing
            ? `<button class="btn primary" data-tstop="${t.id}">✓ OK</button>`
            : `<button class="btn small" data-tpause="${t.id}">${t.paused ? '▶' : '⏸'}</button>
               <button class="btn small" data-tplus="${t.id}">+1 min</button>
               <button class="btn small danger" data-tstop="${t.id}">✕</button>`}
        </div>
      </div>`;
    }).join('')}
  </div>` : '<p class="muted" style="margin-top:24px">Ingen aktive timere. Start én med knapperne ovenfor – eller klik på et minuttal inde i en opskrift.</p>'}
  <p class="small muted">💡 Slå "Hold skærmen tændt" til, mens du laver mad, så skærmen ikke låser (kræver https).</p>`;
};
RENDER.timers_bind = () => {
  $('#wakePageBtn').onclick = () => setWakeLock(!S.wakeOn);
  updateWakeBtn();
  $$('[data-preset]').forEach(b => b.onclick = () => { startTimer(+b.dataset.preset * 60000, fmtMin(+b.dataset.preset)); });
  const start = () => {
    const min = num($('#tmMin').value);
    if (!min || min <= 0) return toast('Angiv antal minutter', true);
    startTimer(min * 60000, $('#tmLabel').value.trim() || fmtMin(min));
  };
  $('#tmStart').onclick = start;
  $('#tmMin').onkeydown = e => { if (e.key === 'Enter') start(); };
  $('#tmLabel').onkeydown = e => { if (e.key === 'Enter') start(); };

  $$('[data-tstop]').forEach(b => b.onclick = () => {
    S.timers = S.timers.filter(t => t.id !== b.dataset.tstop);
    saveTimers();
    render();
  });
  $$('[data-tpause]').forEach(b => b.onclick = () => {
    const t = S.timers.find(x => x.id === b.dataset.tpause);
    if (!t) return;
    if (t.paused) { t.endsAt = Date.now() + t.remainMs; t.remainMs = null; t.paused = false; }
    else { t.remainMs = timerRemainMs(t); t.paused = true; }
    saveTimers();
    render();
  });
  $$('[data-tplus]').forEach(b => b.onclick = () => {
    const t = S.timers.find(x => x.id === b.dataset.tplus);
    if (!t) return;
    if (t.paused) t.remainMs += 60000; else t.endsAt += 60000;
    t.totalMs += 60000;
    saveTimers();
    render();
  });
};

function newTimerModal(label) {
  const presets = app().timerPresets || DEFAULT_APP.timerPresets;
  openModal(`<h2>⏱️ Ny timer</h2>
    <div class="rowflex">${presets.map(m => `<button class="btn" data-nt="${m}">${fmtMin(m)}</button>`).join('')}</div>
    <div class="rowflex" style="margin-top:12px">
      <input id="ntMin" type="number" min="1" placeholder="minutter" style="width:110px">
      <input id="ntLabel" placeholder="navn" value="${esc(label || '')}" style="flex:1">
      <button class="btn primary" id="ntStart">▶ Start</button>
    </div>
    <div class="actions"><button class="btn" id="ntCancel">Luk</button></div>`, m => {
    m.querySelector('#ntCancel').onclick = closeModal;
    m.querySelectorAll('[data-nt]').forEach(b => b.onclick = () => {
      startTimer(+b.dataset.nt * 60000, label || fmtMin(+b.dataset.nt));
      closeModal();
      toast('Timer startet');
    });
    const start = () => {
      const min = num(m.querySelector('#ntMin').value);
      if (!min || min <= 0) return toast('Angiv antal minutter', true);
      startTimer(min * 60000, m.querySelector('#ntLabel').value.trim() || fmtMin(min));
      closeModal();
      toast('Timer startet');
    };
    m.querySelector('#ntStart').onclick = start;
    m.querySelector('#ntMin').onkeydown = e => { if (e.key === 'Enter') start(); };
    m.querySelector('#ntMin').focus();
  });
}
