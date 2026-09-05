/* Proever update:-scriptet fra den UDGIVNE runes/kokkeri.yaml - ikke en afskrift.
 * En afskrift beviser kun, at afskriften virker (Sagu v48).
 * Alt koerer lokalt: payloaden ligger i scriptet, saa der er intet net at fake.
 *
 *   node tests/opdatering.test.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROD = path.resolve(import.meta.dirname, '..');
let ok = 0, fejl = 0;
const proev = (navn, fn) => {
  try { fn(); console.log('  ok   ' + navn); ok++; }
  catch (e) { console.log('  FEJL ' + navn + '\n       ' + e.message); fejl++; }
};
const skalVaere = (v, forventet, hvad) => {
  if (v !== forventet) throw new Error(`${hvad}: fik ${JSON.stringify(v)}, ventede ${JSON.stringify(forventet)}`);
};

/* --- hent scriptet ud af YAML'en, som panelet ville --- */
function hentScript(navn) {
  return execFileSync('python3', ['-c',
    `import yaml,sys; print(yaml.safe_load(open('runes/kokkeri.yaml'))['gameskill']['${navn}']['script' if '${navn}'=='update' else 'command'], end='')`
  ], { cwd: ROD, encoding: 'utf8', maxBuffer: 1 << 28 });
}
const UPDATE = hentScript('update');
const STARTUP = execFileSync('python3', ['-c',
  "import yaml; print(yaml.safe_load(open('runes/kokkeri.yaml'))['gameskill']['startup']['command'], end='')"
], { cwd: ROD, encoding: 'utf8' });

function nyMappe() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kokkeri-upd-'));
  fs.mkdirSync(path.join(d, 'data'));
  fs.writeFileSync(path.join(d, 'data', 'kokkeri.db'), 'VIGTIGE DATA');
  return d;
}
function kør(dir, script, opts = {}) {
  const f = path.join(dir, '_k.sh');
  fs.writeFileSync(f, script);
  const r = spawnSync('/bin/sh', [f], { cwd: dir, encoding: 'utf8', ...opts });
  return r;
}
import { spawnSync } from 'node:child_process';
const findes = (d, ...p) => fs.existsSync(path.join(d, ...p));

console.log('\nSCRIPTETS FORM (læst af den udgivne YAML)');
proev('ingen /tmp i update-scriptet', () => {
  if (UPDATE.includes('/tmp')) throw new Error('bruger /tmp - mv paa tvaers af filsystemer er en kopi');
});
proev('sletter ikke app/ (bytter i stedet)', () => {
  if (/\brm -rf app\b/.test(UPDATE)) throw new Error('rm -rf app efterlader et vindue uden app/');
});
proev('laasen tages foer foerste aendring', () => {
  const a = UPDATE.indexOf('mkdir .kokkeri-laas');
  const b = UPDATE.indexOf('rm -rf .kokkeri-ny');
  if (a < 0) throw new Error('ingen laas i scriptet');
  if (b < 0) throw new Error('fandt ikke den foerste aendring');
  if (a > b) throw new Error('laasen tages for sent');
});
proev('genstart-beskeden staar sidst', () => {
  if (!UPDATE.includes('GENSTART KOKKERI NU')) throw new Error('mangler genstart-besked');
  const rest = UPDATE.trimEnd().split('\n').slice(-6).join('\n');
  if (!rest.includes('GENSTART KOKKERI NU')) throw new Error('beskeden drukner i output foer slutningen');
});

console.log('\nOPFOERSEL');
proev('frisk installation: app/ bliver komplet', () => {
  const d = nyMappe();
  const r = kør(d, UPDATE);
  skalVaere(r.status, 0, 'exitkode');
  if (!findes(d, 'app', 'server.js')) throw new Error('app/server.js mangler');
  if (!findes(d, 'app', 'public', 'app.js')) throw new Error('app/public/app.js mangler');
  if (findes(d, '.kokkeri-laas')) throw new Error('laasen blev ikke frigivet');
  if (findes(d, '.kokkeri-ny')) throw new Error('arbejdsmappen blev ikke ryddet');
});
proev('opdatering: foraeldet fil forsvinder, /data uroert', () => {
  const d = nyMappe();
  kør(d, UPDATE);
  fs.writeFileSync(path.join(d, 'app', 'foraeldet.js'), 'gammel');
  fs.writeFileSync(path.join(d, 'app', 'server.js'), 'OEDELAGT');
  const r = kør(d, UPDATE);
  skalVaere(r.status, 0, 'exitkode');
  if (findes(d, 'app', 'foraeldet.js')) throw new Error('foraeldet fil blev liggende');
  if (fs.readFileSync(path.join(d, 'app', 'server.js'), 'utf8') === 'OEDELAGT') throw new Error('server.js blev ikke skiftet');
  skalVaere(fs.readFileSync(path.join(d, 'data', 'kokkeri.db'), 'utf8'), 'VIGTIGE DATA', '/data');
});
proev('laasen afviser en anden koersel', () => {
  const d = nyMappe();
  kør(d, UPDATE);
  fs.mkdirSync(path.join(d, '.kokkeri-laas'));
  const foer = fs.readFileSync(path.join(d, 'app', 'server.js'), 'utf8');
  const r = kør(d, UPDATE);
  skalVaere(r.status, 1, 'exitkode');
  if (!/allerede i gang/.test(r.stdout + r.stderr)) throw new Error('ingen forklarende besked');
  skalVaere(fs.readFileSync(path.join(d, 'app', 'server.js'), 'utf8'), foer, 'app/ blev roert');
  if (!findes(d, '.kokkeri-laas')) throw new Error('den fremmede laas blev fjernet');
});
proev('to samtidige koersler: praecis én vinder, app/ er hel', () => {
  for (let i = 0; i < 5; i++) {
    const d = nyMappe();
    const f = path.join(d, '_k.sh');
    fs.writeFileSync(f, UPDATE);
    const koer = () => new Promise(res => {
      const p = spawn('/bin/sh', [f], { cwd: d });
      let ud = '';
      p.stdout.on('data', c => ud += c); p.stderr.on('data', c => ud += c);
      p.on('close', kode => res({ kode, ud }));
    });
    const svar = execFileSync('node', ['-e', `
      const {spawn}=require('child_process');
      const koer=()=>new Promise(res=>{const p=spawn('/bin/sh',['${f}'],{cwd:'${d}'});let u='';
        p.stdout.on('data',c=>u+=c);p.stderr.on('data',c=>u+=c);p.on('close',k=>res({k,u}));});
      Promise.all([koer(),koer()]).then(r=>console.log(JSON.stringify(r)));
    `], { encoding: 'utf8' });
    const svarene = JSON.parse(svar);
    const koder = svarene.map(x => x.k);
    const vundet = koder.filter(k => k === 0).length;
    if (vundet !== 1) throw new Error(`runde ${i + 1}: ${vundet} kørsler lykkedes, ventede præcis 1 (${JSON.stringify(koder)})`);
    /* Taberen skal fælde PAA LAASEN. Uden dette bestod proeven, da laasen var
     * fjernet helt: taberen fejlede tilfaeldigt paa noget andet, og "praecis én
     * vinder" var opfyldt af de forkerte grunde (fundet ved sabotage-koersel). */
    const taber = svarene.find(x => x.k !== 0);
    if (!/allerede i gang/.test(taber.u)) {
      throw new Error(`runde ${i + 1}: taberen faldt ikke paa laasen, men paa: ${taber.u.trim().split('\n').pop()}`);
    }
    /* Skaerpelse fra Sagu v49 / doda v84: taberen skal falde paa laasen og
     * ALDRIG naa at roere en fil. Uden dette beviser proeven kun, at én af to
     * fejlede - og at app/ overlever er saa timing, ikke en regel. */
    if (/mv:|tar:|No such file/.test(taber.u)) {
      throw new Error(`runde ${i + 1}: taberen naaede at roere filer: ${taber.u.trim().split('\n').pop()}`);
    }
    if (!findes(d, 'app', 'server.js')) throw new Error(`runde ${i + 1}: app/server.js mangler bagefter`);
    if (findes(d, '.kokkeri-laas')) throw new Error(`runde ${i + 1}: laasen blev ikke frigivet`);
  }
});
proev('trap frigiver laasen efter en fejlet koersel', () => {
  const d = nyMappe();
  /* saboter payloaden, saa udpakningen fejler */
  const daarlig = UPDATE.replace(/^([!-~]{100})$/m, 'XXXX');
  const r = kør(d, daarlig);
  if (r.status === 0) throw new Error('den saboterede koersel burde fejle');
  if (findes(d, '.kokkeri-laas')) throw new Error('laasen overlevede fejlen - knappen ville vaere doed for altid');
  const r2 = kør(d, UPDATE);
  skalVaere(r2.status, 0, 'en ny koersel bagefter');
});
proev('afbrudt midt i byttet: startup ruller tilbage', () => {
  const d = nyMappe();
  kør(d, UPDATE);
  fs.writeFileSync(path.join(d, 'app', 'kendetegn.txt'), 'FORRIGE UDGAVE');
  /* efterlign et nedbrud efter "mv app .kokkeri-gammel", foer "mv $NY app" */
  fs.renameSync(path.join(d, 'app'), path.join(d, '.kokkeri-gammel'));
  fs.mkdirSync(path.join(d, '.kokkeri-laas'));
  const redning = STARTUP.split('\n').filter(l => !l.includes('exec node')).join('\n');
  const r = kør(d, redning);
  skalVaere(r.status, 0, 'exitkode');
  if (!findes(d, 'app', 'server.js')) throw new Error('app/ blev ikke rullet tilbage');
  skalVaere(fs.readFileSync(path.join(d, 'app', 'kendetegn.txt'), 'utf8'), 'FORRIGE UDGAVE', 'forrige udgave');
  if (findes(d, '.kokkeri-laas')) throw new Error('den strandede laas blev ikke ryddet');
});

console.log(`\n${ok} bestaaet, ${fejl} fejlet\n`);
process.exit(fejl ? 1 : 0);
