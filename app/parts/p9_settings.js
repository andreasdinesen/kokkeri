/* ---------------- Indstillinger ---------------- */
RENDER.settings = () => {
  const A = app();
  return pageHead('Indstillinger', 'App, AI, kalender, backup og brugere') + `

  <div class="panelbox">
    <h2 style="margin-top:0">App</h2>
    <div class="formgrid">
      <label class="fld"><span>Appens navn</span><input id="setTitle" value="${esc(A.appTitle)}"></label>
      <label class="fld"><span>Standard-portioner</span><input id="setServ" type="number" min="1" value="${A.defaultServings}"></label>
      <label class="fld"><span>Timer-forvalg (minutter, komma-adskilt)</span>
        <input id="setPresets" value="${esc((A.timerPresets || []).join(', '))}"></label>
    </div>
    <label class="fld"><span>Kategorier (én pr. linje)</span>
      <textarea id="setCats" rows="5">${esc((A.categories || []).join('\n'))}</textarea></label>
    <div class="rowflex" style="margin-top:10px">
      <button class="btn small" id="logoPick">${S.settings.logo ? 'Skift logo…' : 'Upload logo…'}</button>
      ${S.settings.logo ? '<button class="btn small danger" id="logoDel">Fjern logo</button>' : ''}
      <input id="logoFile" type="file" accept="image/*" hidden>
      <span style="flex:1"></span>
      <button class="btn primary" id="setSave">Gem indstillinger</button>
    </div>
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">✨ AI-assistent</h2>
    <p class="small muted">Nøgle og adresse gemmes kun på serveren og sendes aldrig til browseren.
      Status: ${S.settings.aiKeySet
        ? (S.settings.aiProvider === 'openai'
            ? '<span class="good">egen server ✓</span> <span class="muted">(' + esc(S.settings.aiUrl) + ')</span>'
            : '<span class="good">Claude-nøgle er sat ✓</span>')
        : '<span class="warn">ikke sat op</span>'}</p>
    <label class="fld" style="max-width:420px"><span>Udbyder</span>
      <select id="aiProv">
        <option value="claude"${S.settings.aiProvider !== 'openai' ? ' selected' : ''}>Claude API (Anthropic)</option>
        <option value="openai"${S.settings.aiProvider === 'openai' ? ' selected' : ''}>Egen server – OpenAI-kompatibel (LM Studio, Ollama …)</option>
      </select></label>
    <div id="aiClaudeFields" ${S.settings.aiProvider === 'openai' ? 'hidden' : ''}>
      <p class="small muted" style="margin:10px 0 0">Opret en API-nøgle på
        <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>.</p>
      <div class="formgrid" style="grid-template-columns:2fr 1fr">
        <label class="fld"><span>API-nøgle ${S.settings.aiKeySet && S.settings.aiProvider !== 'openai' ? '(udfyld kun for at skifte)' : ''}</span>
          <input id="aiKey" type="password" placeholder="sk-ant-…" autocomplete="off"></label>
        <label class="fld"><span>Model (tom = standard)</span>
          <input id="aiModel" placeholder="claude-sonnet-5" value="${esc(S.settings.aiModel || '')}"></label>
      </div>
    </div>
    <div id="aiLocalFields" ${S.settings.aiProvider === 'openai' ? '' : 'hidden'}>
      <p class="small muted" style="margin:10px 0 0">Peg på en OpenAI-kompatibel server på dit netværk –
        fx LM Studio (<b>Developer → Start server</b>) eller Ollama. Alt kører så lokalt og gratis.</p>
      <div class="formgrid" style="grid-template-columns:2fr 1fr">
        <label class="fld"><span>Serverens adresse (inkl. /v1)</span>
          <input id="aiUrl" placeholder="http://din-server:1234/v1" value="${esc(S.settings.aiUrl || '')}"></label>
        <label class="fld"><span>Model (tom = første på serveren)</span>
          <input id="aiModelLocal" placeholder="fx qwen/qwen3-27b" value="${esc(S.settings.aiModel || '')}"></label>
      </div>
    </div>
    <div class="rowflex" style="margin-top:10px">
      <button class="btn primary" id="aiSave">Gem AI</button>
      ${S.settings.aiKeySet && S.settings.aiProvider !== 'openai' ? '<button class="btn small danger" id="aiClearKey">Fjern nøglen</button>' : ''}
    </div>
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">🏠 Home Assistant</h2>
    <p class="small muted">Send indkøbslisten til en todo-liste i Home Assistant med ét klik fra
      Indkøbsliste-siden. Opret en langtids-token under din HA-profil (Sikkerhed → Long-lived access tokens)
      og en todo-liste (Indstillinger → Enheder → Hjælpere → Indkøbsliste).
      Status: ${S.settings.haSet ? '<span class="good">forbundet ✓</span>' : '<span class="warn">ikke sat op</span>'}</p>
    <div class="formgrid">
      <label class="fld"><span>HA-adresse (fx http://homeassistant.local:8123)</span>
        <input id="haUrl" value="${esc(S.settings.haUrl || '')}" placeholder="http://…"></label>
      <label class="fld"><span>Token ${S.settings.haSet ? '(udfyld kun for at skifte)' : ''}</span>
        <input id="haToken" type="password" autocomplete="off"></label>
      <label class="fld"><span>Todo-enhed (fx todo.indkobsliste)</span>
        <input id="haEntity" value="${esc(S.settings.haEntity || '')}" placeholder="todo.…"></label>
    </div>
    <button class="btn primary" id="haSave">Gem Home Assistant</button>
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">✅ Todoist</h2>
    <p class="small muted">Send indkøbslisten til Todoist med ét klik fra Indkøbsliste-siden.
      Hent dit API-token i Todoist under Indstillinger → Integrationer → Udvikler.
      Butiksafdeling og opskrift følger med som note på opgaven.
      Status: ${S.settings.todoistSet ? '<span class="good">forbundet ✓</span>' : '<span class="warn">ikke sat op</span>'}</p>
    <div class="formgrid">
      <label class="fld"><span>API-token ${S.settings.todoistSet ? '(udfyld kun for at skifte)' : ''}</span>
        <input id="tdToken" type="password" autocomplete="off" placeholder="fx 0123456789abcdef…"></label>
      <label class="fld"><span>Projekt</span>
        <span class="rowflex">
          <select id="tdProject" style="flex:1"><option value="${esc(S.settings.todoistProject || '')}">${S.settings.todoistProject ? 'Gemt projekt (hent listen for at skifte)' : 'Indbakke (standard)'}</option></select>
          <button class="btn small" id="tdLoad" ${S.settings.todoistSet ? '' : 'disabled'}>Hent</button>
        </span></label>
    </div>
    <button class="btn primary" id="tdSave">Gem Todoist</button>
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">📅 Madplan i din kalender</h2>
    <p class="small muted">Abonnér på madplanen i Apple/Google Kalender med dette link:</p>
    <div class="rowflex">
      <input id="icalUrl" readonly value="${esc(location.origin + '/api/madplan.ics?token=' + (S.settings.icalToken || ''))}" style="flex:1;min-width:260px">
      <button class="btn small" id="icalCopy">Kopiér</button>
    </div>
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">Backup & import</h2>
    <div class="rowflex">
      <button class="btn" id="bakJson">⬇️ Download backup (JSON)</button>
      ${S.me.isAdmin ? '<button class="btn" id="bakDb">⬇️ Download database (.db)</button>' : ''}
      ${S.me.isAdmin ? '<button class="btn" id="bakRestore">⬆️ Gendan fra JSON…</button><input id="bakFile" type="file" accept=".json" hidden>' : ''}
    </div>
    <h3>🌶️ Flyt fra Paprika</h3>
    <p class="small muted">Eksportér hele dit bibliotek i Paprika (Indstillinger → Export → Paprika Recipe Format)
      og vælg <b>.paprikarecipes</b>-filen her. Opskrifter, billeder, tider, kategorier og vurderinger følger med;
      dubletter (samme titel) springes over.</p>
    <button class="btn" id="papImport">⬆️ Importér Paprika-eksport…</button>
    <input id="papFile" type="file" accept=".paprikarecipes,.paprikarecipe" hidden>
    <span class="small muted" id="papStatus"></span>
  </div>

  ${S.me.isAdmin ? `<div class="panelbox" style="border-color:var(--red)">
    <h2 style="margin-top:0">🗑️ Ryd data</h2>
    <p class="small muted">Sletter indhold permanent – brugere, kategorier, AI-nøgle og øvrige
      indstillinger bevares. Tag en backup først, hvis du er i tvivl.</p>
    <button class="btn danger" id="wipeOpen">Vælg hvad der skal slettes…</button>
  </div>` : ''}

  <div class="panelbox">
    <h2 style="margin-top:0">Min konto</h2>
    <p class="small muted">Logget ind som <b>${esc(S.me.username)}</b>${S.me.isAdmin ? ' (administrator)' : ''}</p>
    <h3>Passkeys</h3>
    ${(S.me.passkeys || []).length ? `<table class="data" style="max-width:480px"><tbody>
      ${S.me.passkeys.map(pk => `<tr><td>🔑 ${esc(pk.label)}</td><td class="small muted">${fmtDate(pk.created)}</td>
        <td class="right"><button class="iconbtn" data-pkdel="${esc(pk.id)}">✕</button></td></tr>`).join('')}
    </tbody></table>` : '<p class="small muted">Ingen passkeys endnu.</p>'}
    <button class="btn small" id="pkAdd">➕ Tilføj passkey til denne enhed</button>
    <h3>Skift kodeord</h3>
    <div class="formgrid" style="max-width:560px">
      <label class="fld"><span>Nuværende kodeord</span><input id="pwCur" type="password" autocomplete="current-password"></label>
      <label class="fld"><span>Nyt kodeord</span><input id="pwNew" type="password" autocomplete="new-password"></label>
      <label class="fld"><span>&nbsp;</span><button class="btn" id="pwSave">Skift kodeord</button></label>
    </div>
  </div>

  <div class="panelbox">
    <h2 style="margin-top:0">Claude-adgang (MCP)</h2>
    <p class="small muted">Lad Claude læse og skrive i dine opskrifter, din madplan og din
      indkøbsliste. <b>claude.ai</b> forbinder du med knappen »Add custom connector« og
      adressen herunder – du bliver sendt hertil for at godkende. <b>Claude Code</b> og
      <b>Claude Desktop</b> bruger i stedet en nøgle, du laver her.</p>
    <div id="accessBox" class="muted small">Henter …</div>
  </div>

  ${S.me.isAdmin ? `<div class="panelbox">
    <h2 style="margin-top:0">Brugere (admin)</h2>
    <div id="adminUsers" class="muted small">Henter …</div>
  </div>` : ''}`;
};

/* ---------------- Claude-adgang: noegler og forbundne apps ---------------- */
async function tegnAdgang() {
  const box = $('#accessBox');
  if (!box) return;
  let d;
  try { d = await api('/api/access'); } catch (e) { box.textContent = 'Kunne ikke hente adgangen.'; return; }
  box.innerHTML = `
    <div class="fld" style="max-width:560px">
      <span class="small muted">Adresse til connector</span>
      <div class="rowflex"><input id="mcpUrl" readonly value="${esc(d.mcpUrl)}" style="flex:1;min-width:0">
        <button class="btn small" id="mcpCopy">Kopiér</button></div>
    </div>
    <h3>Forbundne apps</h3>
    ${d.connections.length ? `<div class="kilder">${d.connections.map(c => `<div class="kilde">
        <div class="kildenavn"><b>${esc(c.name)}</b></div>
        <div class="kildetal small muted">forbundet ${fmtDate(String(c.last_token || '').slice(0, 10))}</div>
        <button class="btn small danger" data-conndel="${esc(c.id)}">Fjern</button></div>`).join('')}</div>`
      : '<p class="small muted">Ingen apps er forbundet endnu.</p>'}
    <h3>Nøgler til Claude Code og Desktop</h3>
    ${d.tokens.length ? `<div class="kilder">${d.tokens.map(t => `<div class="kilde">
        <div class="kildenavn"><b>${esc(t.label || 'Uden navn')}</b>
          <span class="muted small">${t.scope === 'read' ? 'kun læsning' : 'fuld adgang'}</span></div>
        <div class="kildetal small muted">${t.last_used ? 'brugt ' + fmtDate(t.last_used.slice(0, 10)) : 'aldrig brugt'}</div>
        <button class="btn small danger" data-tokdel="${esc(t.id)}">Slet</button></div>`).join('')}</div>`
      : '<p class="small muted">Ingen nøgler endnu.</p>'}
    <div class="rowflex" style="margin-top:10px">
      <input id="tokLabel" placeholder="Navn, fx »Claude på laptoppen«" style="max-width:240px">
      <select id="tokScope">
        <option value="full">Fuld adgang</option>
        <option value="read">Kun læsning</option>
      </select>
      <button class="btn small" id="tokNew">Lav nøgle</button>
    </div>`;

  $('#mcpCopy').onclick = () => { $('#mcpUrl').select(); document.execCommand('copy'); toast('Adressen er kopieret'); };
  $$('[data-conndel]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('Fjern forbindelsen? Appen mister adgangen med det samme.')) return;
    await api('/api/access/connection/revoke', { body: { clientId: b.dataset.conndel } });
    toast('Forbindelsen er fjernet');
    tegnAdgang();
  });
  $$('[data-tokdel]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('Slet nøglen? Det, der bruger den, mister adgangen.')) return;
    await api('/api/access/token/revoke', { body: { id: b.dataset.tokdel } });
    toast('Nøglen er slettet');
    tegnAdgang();
  });
  $('#tokNew').onclick = async () => {
    const r = await api('/api/access/token', { body: { label: $('#tokLabel').value, scope: $('#tokScope').value } });
    /* Klarteksten findes kun her og nu - serveren gemmer kun en hash. */
    openModal(`<h2>🔑 Nøglen er lavet</h2>
      <p class="small muted">Kopiér den nu – den kan ikke vises igen. Serveren gemmer kun et aftryk af den.</p>
      <textarea readonly rows="3" style="width:100%;font-family:ui-monospace,monospace">${esc(r.token)}</textarea>
      <p class="small muted">I Claude Code: <code>claude mcp add --transport http kokkeri ${esc(d.mcpUrl)} --header "Authorization: Bearer DIN_NØGLE"</code></p>
      <div class="actions"><button class="btn primary" id="tokOk">Færdig</button></div>`,
      m => { m.querySelector('#tokOk').onclick = () => { closeModal(); tegnAdgang(); }; }, true);
  };
}

RENDER.settings_bind = () => {
  let logoData = undefined; // undefined = uaendret, '' = fjern
  $('#logoPick').onclick = () => $('#logoFile').click();
  $('#logoFile').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    logoData = await blobToScaledDataUrl(f, 400, { png: true }); // PNG bevarer transparens
    $('#logoPick').textContent = 'Logo valgt ✓';
  };
  const ld = $('#logoDel');
  if (ld) ld.onclick = () => { logoData = ''; ld.disabled = true; };

  $('#setSave').onclick = async () => {
    const patch = Object.assign({}, S.settings.app || {}, {
      appTitle: $('#setTitle').value.trim() || 'Kokkeri',
      defaultServings: parseInt($('#setServ').value, 10) || 4,
      timerPresets: $('#setPresets').value.split(',').map(s => parseInt(s, 10)).filter(n => n > 0),
      categories: $('#setCats').value.split('\n').map(s => s.trim()).filter(Boolean)
    });
    const settings = { app: patch };
    if (logoData !== undefined) settings.logo = logoData;
    await saveSettings(settings);
    render();
  };

  $('#aiProv').onchange = () => {
    const local = $('#aiProv').value === 'openai';
    $('#aiClaudeFields').hidden = local;
    $('#aiLocalFields').hidden = !local;
  };
  $('#aiSave').onclick = async () => {
    const local = $('#aiProv').value === 'openai';
    const settings = { ai_provider: local ? 'openai' : 'claude' };
    if (local) {
      settings.ai_url = $('#aiUrl').value.trim().replace(/\/+$/, '');
      settings.ai_model = $('#aiModelLocal').value.trim();
    } else {
      const key = $('#aiKey').value.trim();
      if (key) settings.ai_key = key;
      settings.ai_model = $('#aiModel').value.trim();
    }
    await saveSettings(settings);
    render();
  };
  const clearKey = $('#aiClearKey');
  if (clearKey) clearKey.onclick = async () => {
    if (!await confirmBox('Fjern AI-nøglen fra serveren?', 'Fjern')) return;
    await saveSettings({ ai_key: '' });
    render();
  };

  $('#haSave').onclick = async () => {
    const settings = {
      ha_url: $('#haUrl').value.trim().replace(/\/+$/, ''),
      ha_entity: $('#haEntity').value.trim()
    };
    const token = $('#haToken').value.trim();
    if (token) settings.ha_token = token;
    await saveSettings(settings);
    render();
  };

  $('#tdLoad').onclick = async () => {
    const btn = $('#tdLoad');
    btn.disabled = true;
    btn.textContent = 'Henter …';
    try {
      const r = await api('/api/todoist/projects');
      const sel = $('#tdProject');
      const cur = S.settings.todoistProject || '';
      sel.innerHTML = '<option value="">Indbakke (standard)</option>' +
        r.projects.map(p2 => `<option value="${esc(p2.id)}"${p2.id === cur ? ' selected' : ''}>${esc(p2.name)}</option>`).join('');
      toast('Hentede ' + r.projects.length + ' projekter – vælg ét og tryk Gem');
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
    btn.textContent = 'Hent';
  };
  $('#tdSave').onclick = async () => {
    const settings = { todoist_project: $('#tdProject').value };
    const token = $('#tdToken').value.trim();
    if (token) settings.todoist_token = token;
    await saveSettings(settings);
    render();
  };

  const wipeBtn = $('#wipeOpen');
  if (wipeBtn) wipeBtn.onclick = wipeModal;

  $('#papImport').onclick = () => $('#papFile').click();
  $('#papFile').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    const status = $('#papStatus');
    const btn = $('#papImport');
    btn.disabled = true;
    status.textContent = 'Læser filen …';
    try {
      const res = await importPaprikaFile(f, (i, total) => {
        status.textContent = `Importerer ${i} af ${total} …`;
      });
      toast(`Paprika-import: ${res.imported} nye opskrifter` +
        (res.skipped ? `, ${res.skipped} dubletter sprunget over` : '') +
        (res.failed ? `, ${res.failed} fejlede` : ''));
      status.textContent = '';
      render();
    } catch (err2) {
      status.textContent = '';
      btn.disabled = false;
      toast('Import fejlede: ' + err2.message, true);
    }
  };

  $('#icalCopy').onclick = () => {
    $('#icalUrl').select();
    navigator.clipboard.writeText($('#icalUrl').value).then(() => toast('Link kopieret'));
  };

  $('#bakJson').onclick = async () => {
    const b = await api('/api/backup');
    downloadFile('kokkeri-backup-' + isoDate() + '.json', JSON.stringify(b, null, 1), 'application/json');
  };
  const bdb = $('#bakDb');
  if (bdb) bdb.onclick = () => { location.href = '/api/backup.db'; };
  const brs = $('#bakRestore');
  if (brs) {
    brs.onclick = () => $('#bakFile').click();
    $('#bakFile').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch (err) { return toast('Filen er ikke gyldig JSON', true); }
      if (!Array.isArray(data.items)) return toast('Ligner ikke en Kokkeri-backup', true);
      const replace = await confirmBox(`Gendan ${data.items.length} elementer fra backup? Vælg "Erstat alt" for at overskrive alt eksisterende.`, 'Erstat alt');
      /* I portioner: en backup med billeder fylder hundredvis af megabyte, og
       * ét POST ville baade ramme serverens graense og fylde hukommelsen.
       * Foerste kald rydder (hvis "erstat alt") og saetter indstillingerne. */
      let gendannet = 0;
      try {
        await api('/api/restore', { body: { begin: true, settings: data.settings || null, replace } });
        for (let i = 0; i < data.items.length; i += 50) {
          const del = data.items.slice(i, i + 50);
          const r = await api('/api/restore', { body: { items: del } });
          gendannet += r.restored || 0;
          toast(`Gendanner … ${Math.min(i + 50, data.items.length)} af ${data.items.length}`);
        }
      } catch (err) { return toast('Gendannelsen stoppede: ' + err.message, true); }
      toast('Gendannede ' + gendannet + ' elementer');
      const items = await api('/api/items?fields=card');
      S.items = items.items || [];
      S.hydrated = false;
      reindex();
      hydrateItems();
      render();
    };
  }

  $('#pkAdd').onclick = passkeyRegister;
  $$('[data-pkdel]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('Fjern denne passkey?', 'Fjern')) return;
    const r = await api('/api/webauthn/credentials/' + encodeURIComponent(b.dataset.pkdel), { method: 'DELETE', body: {} });
    S.me = r.me;
    render();
  });

  $('#pwSave').onclick = async () => {
    try {
      await api('/api/password', { body: { current: $('#pwCur').value, password: $('#pwNew').value } });
      toast('Kodeordet er skiftet');
      $('#pwCur').value = $('#pwNew').value = '';
    } catch (e) { toast(e.message, true); }
  };

  tegnAdgang();
  if (S.me.isAdmin) loadAdminUsers();
};

async function loadAdminUsers() {
  const host = $('#adminUsers');
  if (!host) return;
  try {
    const r = await api('/api/admin/users');
    host.className = '';
    host.innerHTML = `
      <label class="chk" style="margin-bottom:10px"><input type="checkbox" id="admAllowReg" ${r.allowRegistration ? 'checked' : ''}>
        Tillad registrering af nye brugere</label>
      <div class="tablewrap"><table class="data"><thead>
        <tr><th>Bruger</th><th>Oprettet</th><th>Passkeys</th><th>Rolle</th><th></th></tr></thead><tbody>
        ${r.users.map(u => `<tr>
          <td>${esc(u.username)}${u.id === S.me.id ? ' <span class="muted small">(dig)</span>' : ''}</td>
          <td class="small muted">${fmtDate(u.created)}</td>
          <td>${u.passkeys}</td>
          <td>${u.isAdmin ? '<span class="chip on">admin</span>' : '<span class="chip">bruger</span>'}</td>
          <td class="right nowrap">
            <button class="btn small" data-admpw="${u.id}">Nyt kodeord</button>
            <button class="btn small" data-admrole="${u.id}" data-isadmin="${u.isAdmin ? 1 : 0}">${u.isAdmin ? 'Fjern admin' : 'Gør til admin'}</button>
            ${u.id !== S.me.id ? `<button class="btn small danger" data-admdel="${u.id}" data-name="${esc(u.username)}">Slet</button>` : ''}
          </td></tr>`).join('')}
      </tbody></table></div>`;
    $('#admAllowReg').onchange = async e => {
      await api('/api/admin/settings', { body: { allowRegistration: e.target.checked } });
      toast('Gemt');
    };
    $$('[data-admpw]').forEach(b => b.onclick = async () => {
      const pw = prompt('Nyt kodeord (mindst 8 tegn):');
      if (!pw) return;
      try { await api(`/api/admin/users/${b.dataset.admpw}/password`, { body: { password: pw } }); toast('Kodeord sat'); }
      catch (e) { toast(e.message, true); }
    });
    $$('[data-admrole]').forEach(b => b.onclick = async () => {
      try {
        await api(`/api/admin/users/${b.dataset.admrole}/role`, { body: { isAdmin: b.dataset.isadmin !== '1' } });
        loadAdminUsers();
      } catch (e) { toast(e.message, true); }
    });
    $$('[data-admdel]').forEach(b => b.onclick = async () => {
      if (!await confirmBox(`Slet brugeren "${b.dataset.name}"?`)) return;
      try { await api('/api/admin/users/' + b.dataset.admdel, { method: 'DELETE', body: {} }); loadAdminUsers(); }
      catch (e) { toast(e.message, true); }
    });
  } catch (e) {
    host.textContent = 'Kunne ikke hente brugere: ' + e.message;
  }
}

/* ---------------- ryd data (admin) ----------------
 * To spaerringer mod uheld: man skal vaelge datatyperne aktivt, OG skrive
 * KOKKERI. Ordet tjekkes ogsaa server-side. */
const WIPE_KINDS = [
  { kind: 'recipe', navn: 'Opskrifter', ico: '📖' },
  { kind: 'planEntry', navn: 'Madplan', ico: '📅' },
  { kind: 'menu', navn: 'Madplan-skabeloner', ico: '📋' },
  { kind: 'shopItem', navn: 'Indkøbsliste', ico: '🛒' },
  { kind: 'pantryItem', navn: 'Forråd', ico: '🏺' },
  { kind: 'crawlSeen', navn: 'Hentede sider (huskes ved masse-import)', ico: '📚' }
];
function wipeModal() {
  const antal = k => K(k).length;
  openModal(`<h2>🗑️ Ryd data</h2>
    <p class="small muted">Vælg hvad der skal slettes. Det kan <b>ikke</b> fortrydes –
      hverken brugere, kategorier eller andre indstillinger røres.</p>
    <div style="margin:12px 0">
      ${WIPE_KINDS.map(w => `<label class="chk" style="padding:5px 0">
        <input type="checkbox" data-wk="${w.kind}">
        <span>${w.ico} ${w.navn} <span class="muted small">(${antal(w.kind)})</span></span></label>`).join('')}
    </div>
    <div class="rowflex" style="margin-bottom:12px">
      <button class="btn small" id="wipeAll">Markér alt</button>
      <button class="btn small" id="wipeNone">Fjern markering</button>
      <span style="flex:1"></span>
      <button class="btn small" id="wipeBackup">⬇️ Tag backup først</button>
    </div>
    <label class="fld"><span>Skriv <b>KOKKERI</b> for at bekræfte</span>
      <input id="wipeWord" autocomplete="off" placeholder="KOKKERI"></label>
    <p class="small warn" id="wipeMsg" style="min-height:18px"></p>
    <div class="actions">
      <button class="btn" id="wipeCancel">Annullér</button>
      <button class="btn danger" id="wipeGo" disabled>Slet permanent</button>
    </div>`, m => {
    const word = m.querySelector('#wipeWord');
    const go = m.querySelector('#wipeGo');
    const bokse = () => [...m.querySelectorAll('[data-wk]')];
    const valgte = () => bokse().filter(b => b.checked).map(b => b.dataset.wk);
    const opdater = () => {
      const n = valgte().length;
      const ordOk = word.value.trim().toUpperCase() === 'KOKKERI';
      go.disabled = !n || !ordOk;
      go.textContent = n ? `Slet ${valgte().reduce((a, k) => a + K(k).length, 0)} elementer permanent` : 'Slet permanent';
      m.querySelector('#wipeMsg').textContent = !n ? 'Vælg mindst én datatype'
        : (!ordOk ? 'Skriv KOKKERI for at låse op' : '');
    };
    bokse().forEach(b => b.onchange = opdater);
    word.oninput = opdater;
    m.querySelector('#wipeAll').onclick = () => { bokse().forEach(b => b.checked = true); opdater(); };
    m.querySelector('#wipeNone').onclick = () => { bokse().forEach(b => b.checked = false); opdater(); };
    m.querySelector('#wipeBackup').onclick = async () => {
      const b = await api('/api/backup');
      downloadFile('kokkeri-backup-' + isoDate() + '.json', JSON.stringify(b, null, 1), 'application/json');
    };
    m.querySelector('#wipeCancel').onclick = closeModal;
    go.onclick = async () => {
      const kinds = valgte();
      go.disabled = true;
      try {
        const r = await api('/api/wipe', { body: { kinds, confirm: word.value.trim() } });
        S.items = S.items.filter(it => !kinds.includes(it.kind));
        reindex();
        closeModal();
        toast(`${r.deleted} elementer slettet`);
        render();
      } catch (e) {
        m.querySelector('#wipeMsg').textContent = e.message;
        go.disabled = false;
      }
    };
    opdater();
    word.focus();
  });
}

/* start appen */
boot();
