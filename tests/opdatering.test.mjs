/* Proever install-, update- og startup-scriptet fra den UDGIVNE runes/kokkeri.yaml
 * - ikke en afskrift. En afskrift beviser kun, at afskriften virker (Sagu v48).
 *
 * ALT koerer uden net: en `node`-attrap tidligt i PATH svarer paa startsnorens
 * hentning med et faerdigt tar-arkiv, praecis som GitHub ville. Alle andre
 * node-kald sendes videre til den rigtige node.
 *
 *   node tests/opdatering.test.mjs
 */
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROD = path.resolve(import.meta.dirname, '..');
const NODE = process.execPath;
let ok = 0, fejl = 0;
const proev = (navn, fn) => {
  try { fn(); console.log('  ok   ' + navn); ok++; }
  catch (e) { console.log('  FEJL ' + navn + '\n       ' + e.message); fejl++; }
};
const skal = (v, f, hvad) => { if (v !== f) throw new Error(`${hvad}: fik ${JSON.stringify(v)}, ventede ${JSON.stringify(f)}`); };
const findes = (d, ...p) => fs.existsSync(path.join(d, ...p));

/* --- scripts ud af YAML'en, som panelet ville laese dem --- */
const yamlFelt = (sti) => execFileSync('python3', ['-c',
  `import yaml;g=yaml.safe_load(open('runes/kokkeri.yaml'))['gameskill'];print(${sti}, end='')`
], { cwd: ROD, encoding: 'utf8' });
const INSTALL = yamlFelt("g['install']['script']");
const UPDATE = yamlFelt("g['update']['script']");
const STARTUP = yamlFelt("g['startup']['command']");

/* --- et arkiv, der ligner GitHubs: <repo>-<ref>/app/... --- */
function byg_arkiv(dir, { version = 30, medKilde = true, udenServer = false } = {}) {
  /* Ryd stilladset foerst. Uden det bliver en tidligere koersels server.js
   * liggende og pakket med - og et "ufuldstaendigt" arkiv er saa ikke
   * ufuldstaendigt. Proeven bestod dermed af den forkerte grund. */
  fs.rmSync(path.join(dir, '_arkiv'), { recursive: true, force: true });
  const rod = path.join(dir, '_arkiv', 'kokkeri-30');
  fs.mkdirSync(path.join(rod, 'app', 'public'), { recursive: true });
  const skriv = (p, t) => fs.writeFileSync(path.join(rod, 'app', ...p.split('/')), t);
  if (!udenServer) skriv('server.js', 'console.log("Kokkeri lytter");');
  skriv('oauth.js', '/* oauth */');
  skriv('mcp.js', '/* mcp */');
  if (medKilde) skriv('kilde.js', 'console.log("[kode] attrap-kilde");');
  skriv('public/index.html', `<script src="app.js?v=${version}"></script>`);
  skriv('public/app.js', '/* app */');
  const tar = path.join(dir, '_arkiv.tar');
  execFileSync('tar', ['c', '-C', path.join(dir, '_arkiv'), '-f', tar, 'kokkeri-30']);
  return tar;
}
/* node-attrappen: svarer paa startsnorens -e-kald med arkivet, ellers rigtig node */
function laegAttrap(dir, tar) {
  const bin = path.join(dir, '_bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh
case "$*" in
  *codeload*) exec cat ${JSON.stringify(tar)} ;;
  *) exec ${JSON.stringify(NODE)} "$@" ;;
esac
`, { mode: 0o755 });
  return bin;
}
function nyMappe(opts) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kokkeri-upd-'));
  fs.mkdirSync(path.join(d, 'data'));
  fs.writeFileSync(path.join(d, 'data', 'kokkeri.db'), 'VIGTIGE DATA');
  const tar = byg_arkiv(d, opts);
  d_bin.set(d, laegAttrap(d, tar));
  return d;
}
const d_bin = new Map();
function kør(dir, script, ekstraEnv = {}) {
  const f = path.join(dir, '_k.sh');
  fs.writeFileSync(f, script);
  return spawnSync('/bin/sh', [f], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${d_bin.get(dir)}:${process.env.PATH}`, ...ekstraEnv }
  });
}

console.log('\nSCRIPTETS FORM (læst af den udgivne YAML)');
proev('ingen /tmp i install eller update', () => {
  for (const [n, s] of [['install', INSTALL], ['update', UPDATE]])
    if (s.includes('/tmp')) throw new Error(`${n} bruger /tmp`);
});
proev('sletter ikke app/ (bytter i stedet)', () => {
  for (const [n, s] of [['install', INSTALL], ['update', UPDATE]])
    if (/\brm -rf app\b/.test(s)) throw new Error(`${n}: rm -rf app efterlader et vindue uden app/`);
});
proev('update: kilde.js-grenen ligger FOER startsnoren', () => {
  const a = UPDATE.indexOf('[ -f app/kilde.js ]'), b = UPDATE.indexOf('refs/tags/');
  if (a < 0) throw new Error('ingen kilde.js-gren');
  if (b < 0) throw new Error('ingen startsnor');
  if (a > b) throw new Error('startsnoren ligger foerst - hvert tryk ville nedgradere (tovo)');
});
proev('laasen tages foer forgreningen', () => {
  const a = UPDATE.indexOf('mkdir .kokkeri-laas'), b = UPDATE.indexOf('[ -f app/kilde.js ]');
  if (a < 0) throw new Error('ingen laas');
  if (b < 0) throw new Error('ingen forgrening');
  if (a > b) throw new Error('laasen beskytter kun den ene gren');
});
proev('genstart-beskeden staar sidst', () => {
  if (!UPDATE.includes('GENSTART KOKKERI NU')) throw new Error('mangler genstart-besked');
  if (!UPDATE.trimEnd().endsWith('============================================"'))
    throw new Error('beskeden staar ikke sidst');
});
proev('startup: redning og kilde.js foer serveren', () => {
  const r = STARTUP.indexOf('.kokkeri-gammel'), k = STARTUP.indexOf('node app/kilde.js'), s = STARTUP.indexOf('exec node app/server.js');
  if (r < 0 || k < 0 || s < 0) throw new Error('mangler et af leddene');
  if (!(r < k && k < s)) throw new Error('forkert raekkefoelge');
});

console.log('\nOPFOERSEL (uden net - node-attrap i PATH)');
proev('install: frisk container faar en komplet app/', () => {
  const d = nyMappe();
  const r = kør(d, INSTALL);
  skal(r.status, 0, 'exitkode');
  for (const f of ['server.js', 'oauth.js', 'mcp.js', 'kilde.js', 'public/index.html'])
    if (!findes(d, 'app', ...f.split('/'))) throw new Error(`app/${f} mangler`);
  if (findes(d, '.kokkeri-ny')) throw new Error('arbejdsmappen blev ikke ryddet');
});
proev('update: bruger kilde.js naar den findes (nedgraderer ikke)', () => {
  const d = nyMappe();
  kør(d, INSTALL);
  fs.writeFileSync(path.join(d, 'app', 'kendetegn.txt'), 'NYERE UDGAVE');
  const r = kør(d, UPDATE);
  skal(r.status, 0, 'exitkode');
  if (!/attrap-kilde/.test(r.stdout)) throw new Error('kilde.js blev ikke koert');
  if (/Henter app-koden fra GitHub/.test(r.stdout)) throw new Error('startsnoren koerte ogsaa - nedgradering');
  if (!findes(d, 'app', 'kendetegn.txt')) throw new Error('app/ blev rullet tilbage til startsnorens udgave');
});
proev('update uden kilde.js: falder tilbage til startsnoren', () => {
  const d = nyMappe({ medKilde: false });
  kør(d, INSTALL);
  fs.writeFileSync(path.join(d, 'app', 'foraeldet.js'), 'gammel');
  const r = kør(d, UPDATE);
  skal(r.status, 0, 'exitkode');
  if (!/Henter app-koden fra GitHub/.test(r.stdout)) throw new Error('startsnoren koerte ikke');
  if (findes(d, 'app', 'foraeldet.js')) throw new Error('foraeldet fil blev liggende');
  skal(fs.readFileSync(path.join(d, 'data', 'kokkeri.db'), 'utf8'), 'VIGTIGE DATA', '/data');
});
proev('laasen afviser en anden koersel', () => {
  const d = nyMappe();
  kør(d, INSTALL);
  fs.mkdirSync(path.join(d, '.kokkeri-laas'));
  const r = kør(d, UPDATE);
  skal(r.status, 1, 'exitkode');
  if (!/allerede i gang/.test(r.stdout + r.stderr)) throw new Error('ingen forklarende besked');
  if (!findes(d, '.kokkeri-laas')) throw new Error('den fremmede laas blev fjernet');
});
proev('to samtidige: praecis én vinder, taberen falder paa LAASEN', () => {
  for (let i = 0; i < 5; i++) {
    const d = nyMappe();
    kør(d, INSTALL);
    const f = path.join(d, '_u.sh');
    fs.writeFileSync(f, UPDATE);
    const env = JSON.stringify({ ...process.env, PATH: `${d_bin.get(d)}:${process.env.PATH}` });
    const svar = execFileSync(NODE, ['-e', `
      const {spawn}=require('child_process');
      const koer=()=>new Promise(res=>{const p=spawn('/bin/sh',[${JSON.stringify(f)}],{cwd:${JSON.stringify(d)},env:${env}});
        let u='';p.stdout.on('data',c=>u+=c);p.stderr.on('data',c=>u+=c);p.on('close',k=>res({k,u}));});
      Promise.all([koer(),koer()]).then(r=>console.log(JSON.stringify(r)));
    `], { encoding: 'utf8' });
    const svarene = JSON.parse(svar);
    const vundet = svarene.filter(x => x.k === 0).length;
    if (vundet !== 1) throw new Error(`runde ${i + 1}: ${vundet} lykkedes, ventede 1 (${JSON.stringify(svarene.map(x => x.k))})`);
    const taber = svarene.find(x => x.k !== 0);
    if (!/allerede i gang/.test(taber.u))
      throw new Error(`runde ${i + 1}: taberen faldt ikke paa laasen: ${taber.u.trim().split('\n').pop()}`);
    /* Skaerpelse fra Sagu v49 / doda v84: taberen skal aldrig naa at roere en fil.
     * Uden dette beviser proeven kun, at én af to fejlede - og at app/ overlever
     * er saa timing, ikke en regel. */
    if (/mv:|tar:|No such file/.test(taber.u))
      throw new Error(`runde ${i + 1}: taberen naaede at roere filer: ${taber.u.trim().split('\n').pop()}`);
    if (!findes(d, 'app', 'server.js')) throw new Error(`runde ${i + 1}: app/ er ikke hel bagefter`);
  }
});
proev('ufuldstaendigt arkiv byttes IKKE ind', () => {
  /* Arkivet findes og har en app-mappe - men ingen server.js. Uden tjekket
   * ville det blive byttet ind, og app/ ville vaere oedelagt UDEN vej tilbage,
   * fordi byttet lykkedes. (Sabotage-runden afsloerede, at proeven manglede.) */
  const d = nyMappe({ medKilde: false });
  kør(d, INSTALL);
  fs.writeFileSync(path.join(d, 'app', 'kendetegn.txt'), 'DEN GODE UDGAVE');
  const daarligt = byg_arkiv(d, { medKilde: false, udenServer: true });
  fs.copyFileSync(daarligt, path.join(d, '_arkiv.tar'));
  const r = kør(d, UPDATE);
  if (r.status === 0) throw new Error('et arkiv uden server.js blev accepteret');
  if (!/indeholder ingen app\/server\.js/.test(r.stdout + r.stderr))
    throw new Error('ingen forklarende besked om det ufuldstaendige arkiv');
  skal(fs.readFileSync(path.join(d, 'app', 'kendetegn.txt'), 'utf8'), 'DEN GODE UDGAVE', 'app/ blev roert');
});
proev('trap frigiver laasen efter en fejlet koersel', () => {
  const d = nyMappe({ medKilde: false });
  /* saboter arkivet, saa startsnoren fejler */
  fs.writeFileSync(path.join(d, '_arkiv.tar'), 'ikke et arkiv');
  const r = kør(d, UPDATE);
  if (r.status === 0) throw new Error('den saboterede koersel burde fejle');
  if (findes(d, '.kokkeri-laas')) throw new Error('laasen overlevede - knappen ville vaere doed for altid');
});
proev('afbrudt midt i byttet: startup ruller tilbage', () => {
  const d = nyMappe();
  kør(d, INSTALL);
  fs.writeFileSync(path.join(d, 'app', 'kendetegn.txt'), 'FORRIGE UDGAVE');
  fs.renameSync(path.join(d, 'app'), path.join(d, '.kokkeri-gammel'));
  fs.mkdirSync(path.join(d, '.kokkeri-laas'));
  /* kun redningen: alt FOER kilde.js-kaldet. At filtrere linjer ud ville
   * efterlade en if uden krop - og saa fejler shellen paa syntaks i stedet
   * for at bevise noget (fanget af proeven selv). */
  const skaer = STARTUP.indexOf('node app/kilde.js');
  if (skaer < 0) throw new Error('startup kalder ikke kilde.js');
  const redning = STARTUP.slice(0, skaer);
  const r = kør(d, redning);
  skal(r.status, 0, 'exitkode');
  skal(fs.readFileSync(path.join(d, 'app', 'kendetegn.txt'), 'utf8'), 'FORRIGE UDGAVE', 'forrige udgave');
  if (findes(d, '.kokkeri-laas')) throw new Error('den strandede laas blev ikke ryddet');
});

console.log('\nKILDE.JS (rene funktioner, ingen net)');
const kilde = await import(path.join(ROD, 'app', 'kilde.js'));
proev('KODE_VERSION: tom/seneste/tal - og et hoejlydt afslag', () => {
  skal(kilde.oensket('').laast, false, 'tom');
  skal(kilde.oensket('seneste').laast, false, 'seneste');
  skal(kilde.oensket('30').version, 30, 'tal');
  if (!kilde.oensket('v30').fejl) throw new Error('»v30« skal afvises hoejlydt, ikke tolkes');
});
proev('nyesteTag regner numerisk (v9 vs v80)', async () => {
  const svar = [[{ name: 'v9' }, { name: 'v80' }, { name: 'v100' }, { name: 'ikke-en-tag' }], []];
  let i = 0;
  const n = await kilde.nyesteTag(async () => svar[i++] || []);
  skal(n, 100, 'hoejeste vN');
});
proev('tjekTrae afviser en tag, hvis koden er stemplet anderledes', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kokkeri-trae-'));
  const a = path.join(d, 'app'); fs.mkdirSync(path.join(a, 'public'), { recursive: true });
  for (const f of ['server.js', 'oauth.js', 'mcp.js']) fs.writeFileSync(path.join(a, f), '//');
  fs.writeFileSync(path.join(a, 'public', 'app.js'), '//');
  fs.writeFileSync(path.join(a, 'public', 'index.html'), '<script src="app.js?v=29"></script>');
  let kastede = false;
  try { kilde.tjekTrae(a, 30); } catch (e) { kastede = /stemplet v29/.test(e.message); }
  if (!kastede) throw new Error('en tag med forkert stempel blev accepteret');
  kilde.tjekTrae(a, 29);   // det rigtige stempel skal gaa igennem
});

console.log(`\n${ok} bestaaet, ${fejl} fejlet\n`);
process.exit(fejl ? 1 : 0);
