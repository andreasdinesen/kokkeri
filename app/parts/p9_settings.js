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
    <h2 style="margin-top:0">✨ AI-assistent (Claude API)</h2>
    <p class="small muted">Nøglen gemmes kun på serveren og sendes aldrig til browseren.
      Opret en API-nøgle på <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>.
      Status: ${S.settings.aiKeySet ? '<span class="good">nøgle er sat ✓</span>' : '<span class="warn">ingen nøgle</span>'}</p>
    <div class="formgrid" style="grid-template-columns:2fr 1fr auto">
      <label class="fld"><span>API-nøgle ${S.settings.aiKeySet ? '(udfyld kun for at skifte)' : ''}</span>
        <input id="aiKey" type="password" placeholder="sk-ant-…" autocomplete="off"></label>
      <label class="fld"><span>Model (tom = standard)</span>
        <input id="aiModel" placeholder="claude-sonnet-5" value="${esc(S.settings.aiModel || '')}"></label>
      <label class="fld"><span>&nbsp;</span><button class="btn primary" id="aiSave">Gem AI</button></label>
    </div>
    ${S.settings.aiKeySet ? '<button class="btn small danger" id="aiClearKey">Fjern nøglen</button>' : ''}
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
    <h2 style="margin-top:0">Backup</h2>
    <div class="rowflex">
      <button class="btn" id="bakJson">⬇️ Download backup (JSON)</button>
      ${S.me.isAdmin ? '<button class="btn" id="bakDb">⬇️ Download database (.db)</button>' : ''}
      ${S.me.isAdmin ? '<button class="btn" id="bakRestore">⬆️ Gendan fra JSON…</button><input id="bakFile" type="file" accept=".json" hidden>' : ''}
    </div>
  </div>

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

  ${S.me.isAdmin ? `<div class="panelbox">
    <h2 style="margin-top:0">Brugere (admin)</h2>
    <div id="adminUsers" class="muted small">Henter …</div>
  </div>` : ''}`;
};

RENDER.settings_bind = () => {
  let logoData = undefined; // undefined = uaendret, '' = fjern
  $('#logoPick').onclick = () => $('#logoFile').click();
  $('#logoFile').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    logoData = await blobToScaledDataUrl(f, 400);
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

  $('#aiSave').onclick = async () => {
    const settings = {};
    const key = $('#aiKey').value.trim();
    if (key) settings.ai_key = key;
    settings.ai_model = $('#aiModel').value.trim();
    if (!Object.keys(settings).length) return;
    await saveSettings(settings);
    render();
  };
  const clearKey = $('#aiClearKey');
  if (clearKey) clearKey.onclick = async () => {
    if (!await confirmBox('Fjern AI-nøglen fra serveren?', 'Fjern')) return;
    await saveSettings({ ai_key: '' });
    render();
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
      const r = await api('/api/restore', { body: { items: data.items, settings: data.settings || null, replace } });
      toast('Gendannede ' + r.restored + ' elementer');
      const items = await api('/api/items');
      S.items = items.items || [];
      reindex();
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

/* start appen */
boot();
