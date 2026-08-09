/* ---------------- Masse-import: crawl et helt site ----------------
 * Kokkeri henter selv siderne og koerer dem gennem den almindelige parser
 * (JSON-LD -> microdata -> evt. AI). Selve hentningen koerer som et BAGGRUNDSJOB
 * paa serveren, saa browseren kan lukkes undervejs - et site kan vaere tusindvis
 * af sider a ~1,4 sek.
 * Offentlige sider (valdemarsro.dk, madbanditten.dk ...) kraever intet. Ligger
 * indholdet bag login, indsaettes ens EGEN session-cookie; den gemmes aldrig paa
 * disk og slettes, naar jobbet slutter. */

const SI = { urls: [], cookie: '', userAgent: '', origin: '', poll: null };

/* samme normalisering som serverens normUrl(): uden protokol og trailing slash */
function normUrlFront(u) {
  return String(u || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}

/* traek cookie/user-agent/url ud af en indsat "Copy as cURL"-kommando */
function parseCurl(text) {
  const out = { url: '', cookie: '', userAgent: '' };
  const s = String(text || '');
  const u = s.match(/curl\s+(?:-[A-Za-z-]+\s+)*['"]?(https?:\/\/[^'"\s]+)/i);
  if (u) out.url = u[1];
  for (const m of s.matchAll(/-H\s+(['"])(.*?)\1/gs)) {
    const line = m[2], i = line.indexOf(':');
    if (i < 0) continue;
    const navn = line.slice(0, i).trim().toLowerCase();
    const vaerdi = line.slice(i + 1).trim();
    if (navn === 'cookie') out.cookie = vaerdi;
    if (navn === 'user-agent') out.userAgent = vaerdi;
  }
  const b = s.match(/-b\s+(['"])(.*?)\1/s);
  if (b && !out.cookie) out.cookie = b[2];
  return out;
}

/* ---------------- hvor er opskrifterne hentet fra? ----------------
 * Udledt af opskrifternes egen kilde-URL. Der foeres bevidst ikke en separat
 * import-historik: den ville kunne komme ud af trit med det, der faktisk ligger
 * i biblioteket (slettede opskrifter, gendannet backup), og listen her skal
 * vise virkeligheden. "Sidst hentet" er nyeste createdAt for sitet.
 * Kraever ikke hydrering - url og createdAt er med i kort-felterne. */
function importKilder() {
  const pr = new Map();
  for (const r of K('recipe')) {
    const vaert = recipeHost(r);          // samme grunddomaene som kilde-filteret
    if (!vaert) continue;
    let u;
    try { u = new URL(r.url); } catch (e) { continue; }
    const k = pr.get(vaert) || { vaert, origin: u.origin, n: 0, sidst: '' };
    k.n++;
    const d = r.createdAt || '';
    if (d > k.sidst) k.sidst = d;
    pr.set(vaert, k);
  }
  return [...pr.values()].sort((a, b) => b.n - a.n);
}
/* Sidste valg af metode + moenster pr. site, saa "Hent nye" rammer rigtigt.
 * Uden det skulle man huske, at arla.dk kraever moensteret /opskrifter/. */
function siHuskLaes() {
  try { return JSON.parse(lsGet('kk_siteimport', '{}')) || {}; } catch (e) { return {}; }
}
function siHuskGem(vaert, data) {
  const alle = siHuskLaes();
  alle[vaert] = data;
  lsSet('kk_siteimport', JSON.stringify(alle));
}
function importKilderHtml() {
  const kilder = importKilder();
  if (!kilder.length) return '';
  const husk = siHuskLaes();
  return `<details class="panelbox" open style="margin:12px 0;padding:10px 12px">
    <summary style="cursor:pointer;font-weight:600">📚 Hentet fra tidligere
      <span class="muted small" style="font-weight:400">– ${kilder.length} ${kilder.length === 1 ? 'site' : 'sites'}</span></summary>
    <div class="kilder">${kilder.slice(0, 15).map(k => `<div class="kilde">
      <div class="kildenavn"><b>${esc(k.vaert)}</b>${husk[k.vaert] && husk[k.vaert].pattern
        ? ` <span class="muted small">mønster: ${esc(husk[k.vaert].pattern)}</span>` : ''}</div>
      <div class="kildetal small muted"><span class="mono">${k.n}</span>
        ${k.n === 1 ? 'opskrift' : 'opskrifter'}${k.sidst ? ' · sidst ' + esc(fmtDate(k.sidst.slice(0, 10))) : ''}</div>
      <button class="btn small" data-hentnye="${esc(k.origin)}" data-vaert="${esc(k.vaert)}"
        title="Søg efter nye opskrifter på ${esc(k.vaert)}">Hent nye</button>
    </div>`).join('')}</div>
    <p class="small muted" style="margin:8px 0 0">Sider, du allerede har hentet, springes over – så
      »Hent nye« henter kun det, der er kommet til.</p>
  </details>`;
}

function siteImportModal() {
  SI.urls = [];
  openModal(`<h2>📚 Masse-import fra et site</h2>
    <p class="small muted">Kokkeri finder opskrifterne og henter dem i baggrunden – du kan roligt
    lukke vinduet undervejs. Offentlige sider kræver ingenting; ligger opskrifterne bag et
    abonnement, indsætter du din egen adgang under »Login-adgang«.</p>

    ${importKilderHtml()}

    <div class="formgrid" style="grid-template-columns:2fr 1fr">
      <label class="fld"><span>Adresse</span>
        <input id="siUrl" placeholder="https://www.valdemarsro.dk" autocomplete="off"></label>
      <label class="fld"><span>Find sider via</span>
        <select id="siMode">
          <option value="sitemap">Hele sitet (sitemap)</option>
          <option value="links">Links på den angivne side</option>
        </select></label>
    </div>
    <label class="fld"><span>Kun adresser der indeholder (tom = alle)</span>
      <input id="siPattern" placeholder="fx opskrift – lad stå tom hvis du er i tvivl" autocomplete="off"></label>

    <details style="margin:10px 0">
      <summary class="small muted" style="cursor:pointer">🔒 Login-adgang (kun hvis siderne kræver abonnement)</summary>
      <p class="small muted" style="margin:8px 0 6px">
        Åbn sitet i din browser (logget ind) → DevTools → fanen <b>Network</b> → højreklik på siden
        → <b>Copy → Copy as cURL</b> → indsæt herunder. Kokkeri bruger kun cookien og user-agenten,
        <b>gemmer dem aldrig på disk</b> og sletter dem, når importen er færdig.
      </p>
      <textarea id="siCurl" rows="3" style="width:100%" placeholder="curl 'https://…' -H 'cookie: …'   — eller indsæt bare cookie-strengen"></textarea>
      <span class="small muted" id="siAuthMsg"></span>
    </details>

    <div class="rowflex">
      <button class="btn primary" id="siFind">🔍 Find opskrifter</button>
      ${S.settings.aiKeySet ? `<label class="chk"><input type="checkbox" id="siAi">
        Brug AI på sider uden maskinlæsbar opskrift</label>` : ''}
    </div>
    <p class="small muted" id="siStatus" style="min-height:18px;margin:10px 0 0"></p>
    <div id="siResult"></div>

    <p class="small muted" style="border-top:1px solid var(--border);padding-top:10px;margin:14px 0 0">
      Der ventes ~1,2 sek. mellem hver side af hensyn til sitet. Hent kun fra sider, du selv har
      adgang til, og behold opskrifterne i din egen app – ingredienser og mængder er fakta, men
      brødtekst og billeder tilhører forfatteren.</p>

    <div class="actions"><button class="btn" id="siClose">Luk</button></div>`, m => {
    const status = m.querySelector('#siStatus');
    const result = m.querySelector('#siResult');
    m.querySelector('#siClose').onclick = closeModal;
    m.querySelector('#siUrl').focus();

    /* "Hent nye" ud for et kendt site: fyld felterne med sidste valg og soeg */
    m.querySelectorAll('[data-hentnye]').forEach(b => b.onclick = () => {
      const husket = siHuskLaes()[b.dataset.vaert] || {};
      m.querySelector('#siUrl').value = husket.url || b.dataset.hentnye;
      if (husket.mode) m.querySelector('#siMode').value = husket.mode;
      m.querySelector('#siPattern').value = husket.pattern || '';
      m.querySelector('#siFind').click();
    });

    const curl = m.querySelector('#siCurl');
    curl.onchange = curl.onblur = () => {
      const v = curl.value.trim();
      if (!v) { SI.cookie = ''; SI.userAgent = ''; m.querySelector('#siAuthMsg').textContent = ''; return; }
      const p = /^\s*curl\s/i.test(v) ? parseCurl(v) : { cookie: v, userAgent: '', url: '' };
      SI.cookie = p.cookie;
      SI.userAgent = p.userAgent;
      if (p.url && !m.querySelector('#siUrl').value.trim()) m.querySelector('#siUrl').value = p.url;
      m.querySelector('#siAuthMsg').textContent = SI.cookie
        ? `Fandt en cookie (${SI.cookie.length} tegn)${SI.userAgent ? ' + user-agent' : ''} ✓`
        : 'Kunne ikke finde en cookie i det indsatte';
    };

    m.querySelector('#siFind').onclick = async () => {
      let url = m.querySelector('#siUrl').value.trim();
      if (!url) return toast('Skriv sitets adresse', true);
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      curl.onblur();
      const btn = m.querySelector('#siFind');
      btn.disabled = true;
      status.textContent = 'Leder efter opskrifter …';
      result.innerHTML = '';
      try {
        const r = await api('/api/site/discover', {
          body: {
            url, mode: m.querySelector('#siMode').value,
            pattern: m.querySelector('#siPattern').value.trim(),
            cookie: SI.cookie, userAgent: SI.userAgent
          }
        });
        const fundne = r.urls || [];
        SI.origin = new URL(url).origin;
        /* spring sider over, som allerede er hentet - baade dem der blev til en
         * opskrift og dem der viste sig ikke at have en. Saa kan man bare koere
         * igen og faa de naeste, i stedet for at bruge koeretiden om igen. */
        /* crawlSeen kommer IKKE med i login-svaret (den vokser med hver crawl og
         * bruges kun her) - hentes derfor paa stedet. */
        let sete = [];
        try { sete = (await api('/api/items?kind=crawlSeen')).items || []; } catch (e) {}
        const kendte = new Set([
          ...K('recipe').map(x => normUrlFront(x.url)),
          ...sete.map(x => normUrlFront(x.url))
        ].filter(Boolean));
        SI.urls = fundne.filter(u => !kendte.has(normUrlFront(u)));
        const alleredeSet = fundne.length - SI.urls.length;
        /* husk metode + moenster til "Hent nye" naeste gang */
        try {
          siHuskGem(new URL(url).hostname.replace(/^www\./, ''), {
            url, mode: m.querySelector('#siMode').value,
            pattern: m.querySelector('#siPattern').value.trim()
          });
        } catch (e) {}
        if (!SI.urls.length) {
          status.innerHTML = fundne.length
            ? `Fandt <b>${fundne.length}</b> sider – dem har du <b>alle</b> hentet før. ` +
              `<span class="muted">Vil du hente dem igen, kan du rydde »Hentede sider« under Indstillinger → Ryd data.</span>`
            : 'Fandt ingen sider. Prøv den anden metode, eller ryd mønsteret.';
          btn.disabled = false;
          return;
        }
        status.innerHTML = `Fandt <b>${r.total}</b> sider` +
          (alleredeSet ? ` · <b>${SI.urls.length}</b> nye (${alleredeSet} hentet før, springes over)` : '') +
          `. <span class="muted">Sider uden opskrift springes automatisk over – og huskes.</span>` +
          (r.robotsAdvarsel ? ` <span class="warn">${esc(r.robotsAdvarsel)}</span>` : '');
        drawFundne(result);
        btn.disabled = false;
      } catch (e) {
        status.textContent = 'Fejl: ' + e.message;
        btn.disabled = false;
      }
    };
  }, true);
}

function drawFundne(host) {
  const vis = SI.urls.slice(0, 8).map(u => esc(u.replace(SI.origin, ''))).join('<br>');
  host.innerHTML = `
    <div class="panelbox" style="margin:10px 0">
      <div class="small mono muted" style="max-height:100px;overflow:auto">${vis}${SI.urls.length > 8 ? `<br>… og ${SI.urls.length - 8} mere` : ''}</div>
    </div>
    <div class="rowflex">
      <label class="fld" style="max-width:130px"><span>Hent maks</span>
        <input id="siLimit" type="number" min="1" max="5000" value="${Math.min(SI.urls.length, 300)}"></label>
      <label class="fld"><span>&nbsp;</span>
        <button class="btn primary" id="siStart">⬇️ Start import</button></label>
    </div>`;
  host.querySelector('#siStart').onclick = () => startCrawl();
}

async function startCrawl() {
  const limit = Math.max(1, Math.min(5000, parseInt($('#siLimit').value, 10) || 50));
  const urls = SI.urls.slice(0, limit);
  const useAi = !!($('#siAi') && $('#siAi').checked);
  const minutter = Math.ceil(urls.length * 1.5 / 60);
  if (!await confirmBox(`Hent ${urls.length} sider fra ${SI.origin.replace(/^https?:\/\//, '')}?
    Det tager ca. ${minutter} min., fordi der ventes mellem hver side.
    Importen kører på serveren – du kan lukke vinduet imens.`, 'Start')) return;
  try {
    await api('/api/site/crawl/start', { body: { urls, cookie: SI.cookie, userAgent: SI.userAgent, useAi } });
    SI.cookie = '';
    closeModal();
    toast('Importen er startet – den kører videre, også hvis du lukker Kokkeri');
    startCrawlPolling();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------------- status paa igangvaerende import ---------------- */
function startCrawlPolling() {
  if (SI.poll) return;
  SI.poll = setInterval(async () => {
    try {
      const st = await api('/api/site/crawl/status');
      S.crawl = st;
      if (!st.running) {
        clearInterval(SI.poll);
        SI.poll = null;
        if (st.total) {
          toast(`Import færdig: ${st.imported} nye opskrifter` +
            (st.skipped ? ` · ${st.skipped} havde du i forvejen` : '') +
            (st.failed ? ` · ${st.failed} sider uden opskrift` : ''), false);
          if (st.error) toast(st.error, true);
        }
        /* hent de nye opskrifter ind i browseren */
        const items = await api('/api/items?fields=card');
        S.items = items.items || [];
        S.hydrated = false;
        reindex();
        hydrateItems();
        render();          // importen er slut - her maa siden gerne tegnes om
        await categorizeImported();
        /* og hent billederne ned lokalt, lidt ad gangen */
        let rest = 1;
        while (rest > 0) rest = await localizeRemoteImages(6);
        return;
      }
      /* mens importen koerer: roer kun banneret og nav'ens taellere */
      if (!refreshCrawlBanner() && S.view === 'recipes') render();
      renderNav();
    } catch (e) {
      clearInterval(SI.poll);
      SI.poll = null;
    }
  }, 3000);
}

/* Crawl-jobbet gemmer billedets eksterne URL (Node kan ikke skalere billeder
 * uden pakker). Her hentes de ned lokalt, saa biblioteket ogsaa virker offline
 * og ikke belaster det oprindelige site. Koeres i smaa portioner i baggrunden. */
async function localizeRemoteImages(maks) {
  const liste = K('recipe').filter(r => r.imageRemote && r.image && !/^data:/.test(r.image));
  if (!liste.length) return 0;
  let n = 0;
  for (const r of liste.slice(0, maks || 6)) {
    const d = await fetchImageAsDataUrl(r.image);
    /* gemmes som selvstaendigt billed-item (saetter imageVer og rydder r.image) */
    if (d) { await saveRecipeImage(r, d); n++; }
    else delete r.image;
    delete r.imageRemote;              // ogsaa ved fejl, saa vi ikke proever i det uendelige
    await saveItem(r, true);
  }
  if (n) render();
  return liste.length - (maks || 6);
}

/* Opdaterer KUN banneret - ikke hele siden. En fuld render() hvert 3. sekund
 * ville koste fokus i soegefeltet og (foer v13) kaste brugeren til toppen. */
function refreshCrawlBanner() {
  const host = $('#crawlBanner');
  if (!host) return false;
  host.innerHTML = crawlBannerHtml();
  bindCrawlBanner();
  return true;
}

/* banner oeverst paa Opskrifter-siden, mens en import koerer */
function crawlBannerHtml() {
  const c = S.crawl;
  /* En STOPPET import med en fejl skal stadig ses. Foer viste banneret kun
   * koerende jobs, saa en import der blev afvist paa foerste side forsvandt
   * sporloest - brugeren fik "importen er startet" og hoerte aldrig mere. */
  if (c && !c.running && c.error) {
    return `<div class="panelbox" style="margin:0 0 14px;border-color:var(--red)">
      <div class="rowflex"><b class="warn">📚 Importen blev stoppet</b>
        <span style="flex:1"></span>
        <button class="btn small" id="crawlClear">OK</button></div>
      <p class="small" style="margin:8px 0 0">${esc(c.error)}</p>
      ${c.done ? `<p class="small muted" style="margin:6px 0 0">Nåede ${c.done} af ${c.total} sider${
        c.imported ? ` · ${c.imported} nye opskrifter blev hentet` : ''}.</p>` : ''}
    </div>`;
  }
  if (!c || !c.running) return '';
  const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
  return `<div class="panelbox" style="margin:0 0 14px">
    <div class="rowflex"><b>📚 Importerer fra ${esc(c.site)}</b>
      <span class="muted small">${c.done} af ${c.total} · ${c.imported} nye · ${c.skipped} dubletter · ${c.failed} uden opskrift</span>
      <span style="flex:1"></span>
      <button class="btn small danger" id="crawlStop">Stop</button></div>
    <div class="timerbar" style="margin-top:8px"><div style="width:${pct}%"></div></div>
    <div class="small muted mono" style="margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.current || '')}</div>
  </div>`;
}
function bindCrawlBanner() {
  const clear = $('#crawlClear');
  if (clear) clear.onclick = async () => {
    try { S.crawl = await api('/api/site/crawl/clear', { body: {} }); } catch (e) { S.crawl = null; }
    render();
  };
  const b = $('#crawlStop');
  if (b) b.onclick = async () => {
    await api('/api/site/crawl/stop', { body: {} });
    toast('Importen stoppes …');
  };
}
