/* Sidernes adresser (RUNE-ERFARINGER 9g) - app/shared/ruter.js.
 *
 * Adresserne staar ét sted, men bruges tre: browseren skriver dem i
 * adresselinjen, SERVEREN svarer med index.html paa dem, og sw.js giver
 * app-skallen paa dem offline. Den vigtigste proeve er derfor ikke
 * opslagene, men at HVER side i menuen - og hver fane i indstillingerne -
 * ogsaa HAR en adresse. Den fejler den dag, nogen tilfoejer en side uden.
 *
 * Til sidst koeres den rigtige server (port 9141, eller KK_PROEVE_PORT):
 * kendte stier -> index.html, ukendte -> 404, /del/<token> uaendret, og
 * manifestets start_url valideres.
 *
 *   node tests/ruter.test.mjs
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const ROD = path.resolve(import.meta.dirname, '..');
const PORT = parseInt(process.env.KK_PROEVE_PORT || '9141', 10);
const require = createRequire(import.meta.url);
const ruter = require('../app/shared/ruter.js');
const laes = f => fs.readFileSync(path.join(ROD, f), 'utf8');
const SHELL = laes('app/parts/p2_shell.js');
const SETTINGS = laes('app/parts/p9_settings.js');
let ok = 0, fejl = 0;
const proev = async (navn, fn) => {
  try { await fn(); console.log('  ok   ' + navn); ok++; }
  catch (e) { console.log('  FEJL ' + navn + '\n       ' + e.message); fejl++; }
};
const skal = (v, f, hvad) => {
  if (JSON.stringify(v) !== JSON.stringify(f)) throw new Error(`${hvad}: fik ${JSON.stringify(v)}, ventede ${JSON.stringify(f)}`);
};

/* `start` ... til den klamme, der lukker den foerste `{` efter start */
function udsnit(kilde, start) {
  const i0 = kilde.indexOf(start);
  if (i0 < 0) throw new Error('findes ikke: ' + start);
  let d = 0;
  for (let j = kilde.indexOf('{', i0); j < kilde.length; j++) {
    if (kilde[j] === '{') d++;
    else if (kilde[j] === '}' && --d === 0) return kilde.slice(i0, j + 1);
  }
  throw new Error('klammerne gaar ikke op: ' + start);
}

/* Siderne, som de staar i menuen (VIEWS i p2_shell.js) */
const sidernesIder = () => [...SHELL.matchAll(/\{\s*id:\s*'([a-zA-Z]+)'\s*,\s*ico:/g)].map(m => m[1]);
const fanernesIder = () => {
  const blok = SETTINGS.slice(SETTINGS.indexOf('const SETTINGS_FANER'), SETTINGS.indexOf('];', SETTINGS.indexOf('const SETTINGS_FANER')));
  return [...blok.matchAll(/\['([a-z]+)',/g)].map(m => m[1]);
};

console.log('Adresser: ruteren');

await proev('hver side i menuen har en adresse, og adressen foerer tilbage', () => {
  const ider = sidernesIder();
  if (ider.length < 7) throw new Error(`fandt kun ${ider.length} sider - er moensteret gaaet i stykker?`);
  skal(ider.filter(id => !ruter.stiForSide(id)), [], 'sider uden adresse');
  for (const id of ider) skal(ruter.sideForSti(ruter.stiForSide(id)), id, id);
});

await proev('hver fane i indstillingerne har en adresse (SETTINGS_FANER == ruter.FANER)', () => {
  const faner = fanernesIder();
  if (faner.length < 5) throw new Error(`fandt kun ${faner.length} faner`);
  skal(faner, ruter.FANER, 'fanerne');
  for (const f of faner) skal(ruter.ruteForSti(ruter.stiForSide('settings', f)), { side: 'settings', arg: f }, f);
});

await proev('en opskrift har sin egen adresse - og id\'et beholder store bogstaver', () => {
  for (const id of ['rec-000001', 'AbC123xyz', '3f2a9c1e-0b7d-4e2a-9f11-2c3d4e5f6a7b']) {
    const sti = ruter.stiForSide('recipeDetail', id);
    skal(sti, '/opskrift/' + id, 'stien');
    skal(ruter.ruteForSti(sti), { side: 'recipeDetail', arg: id }, id);
  }
  skal(ruter.ruteForSti('/Opskrift/AbC123xyz/'), { side: 'recipeDetail', arg: 'AbC123xyz' }, 'stort O, skraastreg');
  skal(ruter.stiForSide('recipeDetail', '../x'), null, 'ugyldigt id giver ingen sti');
});

await proev('to sider deler aldrig adresse, og forsiden er Overblik', () => {
  skal(new Set(ruter.SIDER.map(s => s[1])).size, ruter.SIDER.length, 'unikke adresser');
  for (const s of ['/', '', '/index.html']) skal(ruter.ruteForSti(s), { side: 'dash', arg: null }, s);
});

await proev('stavemaader man selv ville skrive ved koekkenbordet', () => {
  skal(ruter.sideForSti('/Madplan'), 'plan', 'stort bogstav');
  skal(ruter.sideForSti('/timere/'), 'timers', 'skraastreg til sidst');
  skal(ruter.sideForSti('/indkøbsliste'), 'shopping', 'rigtige danske bogstaver');
  skal(ruter.sideForSti('/indk%C3%B8bsliste'), 'shopping', 'som browseren sender dem');
  skal(ruter.sideForSti('/forråd'), 'shopping', 'forraadet bor paa indkoebslisten');
  skal(ruter.sideForSti('/recipes'), 'recipes', 'det engelske id');
  skal(ruter.ruteForSti('/Indstillinger/Data'), { side: 'settings', arg: 'data' }, 'fanen foldes');
});

await proev('ukendte stier er ukendte - ikke appen', () => {
  for (const sti of ['/opskrifte', '/app.jsx', '/styl.css', '/app.js', '/sw.js', '/ruter.js',
    '/api/items', '/api/backup', '/oauth/authorize', '/mcp', '/del/0123456789abcdef',
    '/.well-known/oauth-authorization-server', '/opskrift/kort', '/opskrift/a%2Fb-c-d-e',
    '/opskrift/abc123/mere', '/indstillinger/hemmelig', '/overblik/x', '/%E0%A4%A']) {
    skal(ruter.ruteForSti(sti), null, sti);
  }
});

console.log('Adresser: frontenden');

/* synkAdresse() og popstate-lytteren UD AF KILDEN, i en attrap med history */
function shell(sti) {
  const skrevet = [];
  const lyttere = {};
  const manifest = { href: '', setAttribute(k, v) { this.href = v; } };
  const ctx = {
    kokkeriRuter: ruter,
    S: { me: { username: 'x' }, view: 'dash', viewArg: null },
    VIEWS: [{ id: 'dash', label: 'Overblik' }, { id: 'recipes', label: 'Opskrifter' }, { id: 'settings', label: 'Indstillinger' }],
    recipeById: id => (id === 'rec-000001' ? { id, title: 'Lasagne' } : null),
    document: { title: '', querySelector: () => manifest },
    location: { pathname: sti, search: '', hash: '' },
    history: {},
    window: { addEventListener: (t, f) => { lyttere[t] = f; }, scrollTo() {} },
    render: () => { ctx.renderet++; },
    renderet: 0
  };
  for (const m of ['pushState', 'replaceState']) {
    ctx.history[m] = (st, t, url) => { skrevet.push([m, url]); ctx.location.pathname = url.split(/[?#]/)[0]; };
  }
  vm.createContext(ctx);
  const kode = SHELL.slice(SHELL.indexOf('const { ruteForSti, stiForSide }'), SHELL.indexOf('/* render() gentegner KUN'));
  vm.runInContext(kode + '\nthis.synkAdresse = synkAdresse;', ctx);
  return { ctx, skrevet, lyttere, manifest };
}

await proev('foerste optegning RETTER adressen, et sideskift laegger en ny post', () => {
  const { ctx, skrevet, manifest } = shell('/');
  ctx.synkAdresse();
  ctx.S.view = 'recipeDetail'; ctx.S.viewArg = 'rec-000001';
  ctx.synkAdresse();
  skal(skrevet, [['replaceState', '/overblik'], ['pushState', '/opskrift/rec-000001']], 'historikken');
  skal(ctx.document.title, 'Lasagne · Kokkeri', 'titlen');
  skal(manifest.href, '/manifest.webmanifest?start=' + encodeURIComponent('/opskrift/rec-000001'), 'manifestet');
});

await proev('samme sti skrives ALDRIG igen (ellers kan tilbage kun ét skridt)', () => {
  const { ctx, skrevet } = shell('/opskrifter');
  ctx.S.view = 'recipes';
  ctx.synkAdresse(); ctx.synkAdresse(); ctx.synkAdresse();
  skal(skrevet, [], 'historikken');
});

await proev('tilbage-knappen skifter side uden at skrive en ny post', () => {
  const { ctx, skrevet, lyttere } = shell('/overblik');
  ctx.synkAdresse();
  ctx.location.pathname = '/opskrift/rec-000001';     // browseren har selv skiftet adressen
  lyttere.popstate();
  skal([ctx.S.view, ctx.S.viewArg, ctx.renderet, ctx.S._urlErstat], ['recipeDetail', 'rec-000001', 1, true], 'efter popstate');
  // en popstate til en ukendt sti roeres ikke
  ctx.location.pathname = '/del/0123456789abcdef';
  lyttere.popstate();
  skal(ctx.renderet, 1, 'ukendt sti gentegner ikke');
  skal(skrevet, [], 'historikken');
});

await proev('render() synker adressen EFTER optegningen og bruger erstat-flaget', () => {
  const r = udsnit(SHELL, 'function render()');
  const iBind = r.indexOf('binder()'), iSynk = r.indexOf('synkAdresse(S._urlErstat)');
  if (iBind < 0 || iSynk < 0 || iSynk < iBind) throw new Error('synkAdresse skal kaldes efter binderen');
  if (!/const start = ruteForSti\(location\.pathname\)/.test(udsnit(SHELL, 'async function boot()'))) {
    throw new Error('boot() laeser ikke startsiden af adressen');
  }
});

console.log('Adresser: index.html');

await proev('ingen relative adresser i index.html', () => {
  const html = laes('app/public/index.html');
  const rel = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map(m => m[1])
    .filter(u => u !== '#' && !u.startsWith('/') && !/^https?:/.test(u));
  skal(rel, [], 'relative adresser');
  for (const f of ['/style.css?v=', '/app.js?v=', '/manifest.webmanifest', '/icon-192.png']) {
    if (!html.includes(`"${f}`)) throw new Error('mangler ' + f);
  }
});

console.log('Adresser: den koerende server');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-ruter-'));
function hent(sti, { metode = 'GET', krop, cookie } = {}) {
  return new Promise((ok, nej) => {
    const data = krop ? JSON.stringify(krop) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: sti, method: metode,
      headers: Object.assign({}, data ? { 'Content-Type': 'application/json' } : {}, cookie ? { cookie } : {}) }, res => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', d => { b += d; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, tekst: b }));
    });
    req.on('error', nej);
    if (data) req.write(data);
    req.end();
  });
}
const server = spawn(process.execPath, ['app/server.js'], {
  cwd: ROD, env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: DIR }),
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
try {
  await new Promise((ok, nej) => {
    const t = setTimeout(() => nej(new Error('serveren startede ikke:\n' + log)), 8000);
    server.stdout.on('data', () => { if (log.includes('lytter')) { clearTimeout(t); ok(); } });
  });
  const INDEX = laes('app/public/index.html');

  await proev('kendte stier svarer med index.html (no-store)', async () => {
    for (const sti of ['/overblik', '/opskrifter', '/opskrift/rec-000001', '/Indk%C3%B8bsliste/',
      '/indstillinger/data', '/madplan', '/timere', '/assistent']) {
      const r = await hent(sti);
      skal([r.status, r.tekst === INDEX, r.headers['cache-control']], [200, true, 'no-store'], sti);
    }
  });

  await proev('ukendte stier giver 404 - ingen catch-all', async () => {
    for (const sti of ['/styl.css', '/app.jsx', '/opskrifte', '/opskrift/kort', '/indstillinger/hemmelig', '/api/nyt']) {
      const r = await hent(sti);
      if (r.status !== 404 && r.status !== 401) throw new Error(`${sti}: ${r.status}`);
      if (r.tekst === INDEX) throw new Error(sti + ' svarede med index.html');
    }
  });

  await proev('/ruter.js serveres (til sw.js) og er den samme fil', async () => {
    const r = await hent('/ruter.js?v=35');
    skal([r.status, r.headers['content-type'], r.tekst === laes('app/shared/ruter.js')],
      [200, 'text/javascript; charset=utf-8', true], '/ruter.js');
  });

  await proev('manifestet: start_url foelger den side, genvejen blev lavet paa - valideret', async () => {
    const start = async q => JSON.parse((await hent('/manifest.webmanifest' + q)).tekst);
    const m = await start('?start=' + encodeURIComponent('/opskrift/AbC123xyz'));
    skal([m.start_url, m.scope, m.icons[0].src], ['/opskrift/AbC123xyz', '/', '/icon-192.png'], 'opskrift');
    skal((await start('?start=%2FIndk%C3%B8bsliste')).start_url, '/indkoebsliste', 'foldet');
    skal((await start('')).start_url, '/', 'uden start');
    for (const ond of ['https://ond.eksempel.invalid/', '//ond.eksempel.invalid/', '/del/0123456789abcdef',
      'javascript:alert(1)', '/api/backup']) {
      skal((await start('?start=' + encodeURIComponent(ond))).start_url, '/', ond);
    }
  });

  await proev('/del/<token> virker uaendret', async () => {
    const reg = await hent('/api/register', { metode: 'POST', krop: { username: 'proeve', password: 'hemmelig-proeve' } });
    skal(reg.status, 200, 'registrering');
    const cookie = String(reg.headers['set-cookie'][0]).split(';')[0];
    const token = '0123456789abcdef0123456789abcdef';
    const gem = await hent('/api/items', { metode: 'POST', cookie, krop: { item: {
      id: 'rec-000001', kind: 'recipe', title: 'Delt lasagne', shareToken: token,
      ingredients: ['500 g pasta'], instructions: ['Kog den'] } } });
    skal(gem.status, 200, 'gem');
    const r = await hent('/del/' + token);
    skal([r.status, r.tekst.includes('<title>Delt lasagne</title>'), r.tekst === INDEX], [200, true, false], 'delt side');
    skal((await hent('/del/ffffffffffffffffffffffffffffffff')).status, 404, 'ukendt token');
  });
} finally {
  server.kill('SIGTERM');
  fs.rmSync(DIR, { recursive: true, force: true });
}

console.log(`\n${ok} ok, ${fejl} fejl`);
process.exit(fejl ? 1 : 0);
