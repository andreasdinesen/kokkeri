/*
 * Kokkeri henter sin egen kode. Porteret fra doda (RUNE-ERFARINGER).
 *
 * Indtil v29 BAR runen hele appen: 107 KB base85-payload i baade install- og
 * update-scriptet, og hver eneste aendring krachte en ny rune gennem panelet.
 * Loftet var desuden taet paa: Linux' MAX_ARG_STRLEN er 131.072 tegn for ét
 * sh -c-argument, og vi laa paa 107.091 med 13 K tilbage.
 *
 * Nu goer serveren det selv. `startup`-kommandoen koerer det her modul FOER
 * den starter serveren, saa **en genstart er opdateringen**. Runen skal kun
 * udgives, naar selve runen aendrer sig.
 *
 * ── De tre regler ────────────────────────────────────────────────────────
 *
 * 1. **En fejl maa aldrig kunne forhindre serveren i at starte.** Alt herinde
 *    ender med exit 0. Kan GitHub ikke naas, koerer den kode, der ligger.
 *    Det er den vigtigste egenskab: en netvaerksfejl paa Hjorten maa ikke
 *    kunne slukke for opgavelisten.
 * 2. **Der byttes ALDRIG halvt.** Der pakkes ud i en frisk mappe ved siden
 *    af, den tjekkes, og foerst derefter skiftes navnene. Mellem de to
 *    omdoebninger ligger app/ under `.kokkeri-gammel` - og startup-kommandoen
 *    kan sætte den tilbage, hvis vi doer praecis der.
 * 3. **KODE_VERSION er en laas, ikke et oenske.** Staar der et tal, hentes
 *    praecis den tag - ogsaa selv om der findes en nyere. Det er vejen
 *    tilbage, naar en udgivelse er daarlig: saet tallet i panelet, genstart.
 *
 * ── Hvorfor tags og ikke en gren ─────────────────────────────────────────
 *
 * `refs/heads/main` ville vaere ét kald mindre, men main er arbejdsbordet.
 * Taggen `vN` er den eneste ref, der betyder »udgivet«. Derfor spoerges
 * GitHub om TAG-listen, og det hoejeste `v<tal>` vinder - ikke det, API'et
 * tilfaeldigvis naevner foerst.
 */

'use strict';

const https = require('node:https');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/* v30 er den foerste udgave, der kan hente sig selv. Laaser man laengere
 * tilbage, forsvinder kilde.js sammen med resten. */
const FOERSTE_SELVHENTENDE = 30;

const EJER = 'andreasdinesen';
const REPO = 'kokkeri';

const APP = __dirname;                        // <rod>/app
const ROD = path.dirname(APP);                // runens arbejdsmappe
const MAERKE = path.join(APP, '.kode-version');
const NY = path.join(ROD, '.kokkeri-ny');
const GAMMEL = path.join(ROD, '.kokkeri-gammel');

/* En hentning, der haenger, ville haenge opstarten - og dermed appen. */
const TIMEOUT_MS = 20000;
/* GitHubs tag-liste er nogle faa kB. Et svar paa 4 MB er noget andet. */
const MAX_JSON = 4 * 1024 * 1024;
/* Arkivet er ~1 MB i dag. Loftet er en spaerre, ikke en forventning. */
const MAX_ARKIV = 64 * 1024 * 1024;

function log(besked) { console.log(`[kode] ${besked}`); }

/* Advarsler skriver IKKE [fejl]: panelets watcher taeller [fejl]-linjer og
 * ville sende en notifikation, hver gang nettet var nede i et sekund. */
function advar(besked) { console.log(`[kode] advarsel: ${besked}`); }

/* ------------------------------------------------------------ hvad vil vi */

/**
 * Laeser panelets KODE_VERSION.
 *
 * Tomt, »seneste« og »latest« betyder alle det samme. Alt andet end et rent
 * tal afvises HOEJLYDT frem for at blive tolket: skriver man »v82« eller
 * »82.1«, skal man vide, at kokkeri ikke gjorde, hvad der stod.
 */
function oensket(raa) {
  const t = String(raa === undefined ? (process.env.KODE_VERSION || '') : raa).trim();
  if (t === '' || /^(seneste|latest)$/i.test(t)) return { laast: false, tekst: 'seneste' };
  if (/^\d+$/.test(t)) return { laast: true, version: Number(t), tekst: t };
  return { laast: false, tekst: 'seneste', fejl: `KODE_VERSION »${t}« er hverken et tal eller »seneste«` };
}

/**
 * Hvilken udgave ligger der lige nu?
 *
 * Maerket skrives af den her fil. Findes det ikke, er app/ lagt af runens
 * install-script (eller en aeldre kokkeri) - og saa staar tallet i index.html,
 * hvor build'et stempler det. Uden det fallback ville foerste genstart efter
 * opgraderingen altid hente koden igen, ogsaa naar den var den rigtige.
 */
function installeret(mappe = APP) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(mappe, '.kode-version'), 'utf8'));
    if (Number.isInteger(m.version)) return m;
  } catch { /* intet maerke - saa spoerger vi index.html */ }
  try {
    const html = fs.readFileSync(path.join(mappe, 'public', 'index.html'), 'utf8');
    const m = html.match(/app\.js\?v=(\d+)/);
    if (m) return { version: Number(m[1]), oensket: null, hentet: null, kilde: 'install' };
  } catch { /* ingen app - saa er der intet at sammenligne med */ }
  return null;
}

/* ------------------------------------------------------------------- netto */

function hentSvar(url, forsoeg, ved) {
  return new Promise((ok, nej) => {
    const req = https.get(url, {
      headers: { 'user-agent': 'kokkeri-opdatering', accept: '*/*' },
      timeout: TIMEOUT_MS,
    }, (res) => {
      const kode = res.statusCode;
      if (kode >= 300 && kode < 400 && res.headers.location) {
        res.resume();
        if (forsoeg <= 0) return nej(new Error('for mange omdirigeringer'));
        return ok(hentSvar(new URL(res.headers.location, url).toString(), forsoeg - 1, ved));
      }
      if (kode !== 200) {
        res.resume();
        /* 404 paa en tag-adresse betyder én ting: taggen er ikke pushet.
         * Repoet er offentligt, saa det er ALDRIG en rettighedsfejl. */
        return nej(new Error(kode === 404
          ? `${ved}: GitHub svarede 404 - findes taggen? (${url})`
          : `${ved}: GitHub svarede ${kode}`));
      }
      ok(res);
    });
    req.on('timeout', () => req.destroy(new Error(`${ved}: GitHub svarede ikke inden ${TIMEOUT_MS} ms`)));
    req.on('error', nej);
  });
}

async function hentJson(url, ved) {
  const res = await hentSvar(url, 3, ved);
  return new Promise((ok, nej) => {
    let tekst = '';
    res.setEncoding('utf8');
    res.on('data', (d) => {
      tekst += d;
      if (tekst.length > MAX_JSON) { res.destroy(); nej(new Error(`${ved}: svaret var for stort`)); }
    });
    res.on('end', () => {
      try { ok(JSON.parse(tekst)); } catch { nej(new Error(`${ved}: svaret var ikke JSON`)); }
    });
    res.on('error', nej);
  });
}

/**
 * Det hoejeste `vN` blandt repoets tags.
 *
 * Der bladres, indtil en side er tom. GitHub sorterer ikke tags numerisk (v9
 * staar efter v80 alfabetisk), saa der SKAL regnes paa hele listen frem for
 * at tage den foerste. Med 80+ tags er det to kald - og kun ved genstart.
 */
async function nyesteTag(hent = hentJson) {
  let bedst = 0;
  for (let side = 1; side <= 20; side += 1) {
    const url = `https://api.github.com/repos/${EJER}/${REPO}/tags?per_page=100&page=${side}`;
    const liste = await hent(url, 'tag-listen');
    if (!Array.isArray(liste) || liste.length === 0) break;
    for (const t of liste) {
      const m = /^v(\d+)$/.exec(String(t && t.name));
      if (m) bedst = Math.max(bedst, Number(m[1]));
    }
    if (liste.length < 100) break;
  }
  if (!bedst) throw new Error('tag-listen indeholdt ingen vN-tag');
  return bedst;
}

/* --------------------------------------------------------------- udpakning */

function ryd() {
  fs.rmSync(NY, { recursive: true, force: true });
  fs.rmSync(GAMMEL, { recursive: true, force: true });
}

/**
 * Henter og pakker `vN` ud i .kokkeri-ny/ og returnerer stien til app-mappen.
 *
 * Der pakkes ud ved siden af app/ - ikke i /tmp. `mv` mellem to filsystemer
 * er en kopi, og en kopi kan afbrydes paa midten; et `rename` inden for samme
 * filsystem kan ikke. Det er hele grunden til, at temp-mappen ligger her.
 *
 * `tar` er busybox' - den samme, install-scriptet allerede bruger. gzip'en
 * pakkes ud af Nodes zlib, saa tar kun skal kunne det, den har bevist.
 */
async function hentUdgave(version) {
  ryd();
  fs.mkdirSync(NY, { recursive: true });
  const arkiv = path.join(NY, 'kode.tar');
  const url = `https://codeload.github.com/${EJER}/${REPO}/tar.gz/refs/tags/v${version}`;
  const res = await hentSvar(url, 3, `arkivet v${version}`);
  await new Promise((ok, nej) => {
    let bytes = 0;
    const ud = fs.createWriteStream(arkiv);
    const pak = zlib.createGunzip();
    res.on('data', (d) => {
      bytes += d.length;
      if (bytes > MAX_ARKIV) { res.destroy(); nej(new Error('arkivet var for stort')); }
    });
    res.on('error', nej);
    pak.on('error', (e) => nej(new Error(`arkivet kunne ikke pakkes ud: ${e.message}`)));
    ud.on('error', nej);
    ud.on('finish', ok);
    res.pipe(pak).pipe(ud);
  });

  const r = spawnSync('tar', ['x', '-C', NY, '-f', arkiv], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar fejlede: ${(r.stderr || '').trim().slice(0, 300)}`);
  fs.rmSync(arkiv, { force: true });

  /* Mappenavnet i et GitHub-arkiv er <repo>-<ref uden v>. Det GAETTES ikke:
   * find den app-mappe, der findes. Arkivet begynder desuden med en
   * pax_global_header-post, som ikke er en mappe. */
  for (const navn of fs.readdirSync(NY)) {
    const kandidat = path.join(NY, navn, 'app');
    if (fs.existsSync(path.join(kandidat, 'server.js'))) return kandidat;
  }
  throw new Error('arkivet fra GitHub indeholder ingen app/server.js');
}

/**
 * Er det her en hel kokkeri - og er det den, vi bad om?
 *
 * Versionen laeses ud af det udpakkede index.html. Passer den ikke med
 * taggen, er koden ikke det, den udgiver sig for at vaere (en tag flyttet
 * oven paa en anden commit, fx), og saa byttes der IKKE. Hellere koere
 * videre paa det kendte end at starte noget, ingen kan navngive.
 */
function tjekTrae(mappe, version) {
  for (const kraevet of ['server.js', 'oauth.js', 'mcp.js', 'public/index.html', 'public/app.js']) {
    if (!fs.existsSync(path.join(mappe, ...kraevet.split('/')))) {
      throw new Error(`den hentede kode mangler ${kraevet}`);
    }
  }
  const html = fs.readFileSync(path.join(mappe, 'public', 'index.html'), 'utf8');
  const m = html.match(/app\.js\?v=(\d+)/);
  if (!m) throw new Error('den hentede index.html har intet versionsstempel');
  if (Number(m[1]) !== version) {
    throw new Error(`taggen v${version} indeholder kode stemplet v${m[1]}`);
  }
}

/**
 * Byt app/ ud. To omdoebninger, ingen kopi.
 *
 * Doer processen mellem dem, ligger den gamle app under `.kokkeri-gammel`, og
 * startup-kommandoen saetter den tilbage. Uden det trin ville et daarligt
 * tidspunkt kunne efterlade en container uden app/ - og uden app/ er der
 * heller ingen kilde.js til at hente en ny.
 */
function byt(nyApp, maerke) {
  fs.rmSync(GAMMEL, { recursive: true, force: true });
  if (fs.existsSync(APP)) fs.renameSync(APP, GAMMEL);
  fs.renameSync(nyApp, APP);
  fs.writeFileSync(path.join(APP, '.kode-version'), `${JSON.stringify(maerke, null, 2)}\n`);
  ryd();
}

/* ------------------------------------------------------------------ samlet */

async function opdater(env = process.env) {
  const vil = oensket(env.KODE_VERSION);
  if (vil.fejl) advar(`${vil.fejl} - bruger seneste`);
  const har = installeret();

  let maal;
  if (vil.laast) {
    maal = vil.version;
  } else {
    maal = await nyesteTag();
  }

  if (har && har.version === maal) {
    log(`v${maal} ligger allerede${vil.laast ? ' (laast)' : ''} - henter ikke`);
    /* Maerket opdateres alligevel: laasen kan vaere aendret i panelet, uden
     * at versionen er det, og saa skal appen kunne vise det rigtige. */
    try {
      fs.writeFileSync(MAERKE, `${JSON.stringify({
        version: maal, oensket: vil.tekst, hentet: (har && har.hentet) || null,
        kilde: (har && har.kilde) || 'install',
      }, null, 2)}\n`);
    } catch { /* et maerke er en bekvemmelighed, ikke en betingelse */ }
    return { version: maal, hentet: false };
  }

  /* v82 er den foerste udgave, der kan hente sig selv. Laaser man laengere
   * tilbage, forsvinder kilde.js sammen med resten - og saa opdaterer en
   * genstart ikke mere. Vejen tilbage er panelets »Opdater kokkeri«, som falder
   * tilbage til runens startsnor. Det skal staa i loggen, FOER det sker. */
  if (maal < FOERSTE_SELVHENTENDE) {
    advar(`v${maal} er fra foer Kokkeri kunne hente sin egen kode.`);
    advar('En genstart opdaterer ikke derfra - brug »Opdater Kokkeri« i panelet for at komme videre.');
  }
  log(`henter v${maal}${har ? ` (har v${har.version})` : ''} ...`);
  const nyApp = await hentUdgave(maal);
  tjekTrae(nyApp, maal);
  byt(nyApp, {
    version: maal, oensket: vil.tekst, hentet: new Date().toISOString(), kilde: 'github',
  });
  log(`v${maal} er paa plads. Databasen i /data er uroert.`);
  return { version: maal, hentet: true };
}

async function main() {
  try {
    await opdater();
  } catch (err) {
    advar(`${err.message}`);
    advar('serveren starter paa den kode, der allerede ligger');
  } finally {
    try { ryd(); } catch { /* oprydning maa ikke kunne vaelte opstarten */ }
  }
  /* ALTID 0. Se regel 1 oeverst. */
  process.exit(0);
}

module.exports = { oensket, installeret, nyesteTag, tjekTrae, opdater, MAERKE };

if (require.main === module) main();
