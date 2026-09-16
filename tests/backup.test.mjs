/* GET /api/backup mod den KOERENDE server.
 *
 *  - filnavnet kommer fra serveren (frontenden linker direkte til endepunktet)
 *  - indholdet er byte for byte det samme som den gamle .all()-udgave gav
 *  - svaret STREAMES: holder klienten inde, holder serveren ogsaa inde
 *    (den venter paa 'drain') - og den er ikke blokeret imens
 *  - det, der skrives under en igangvaerende backup, kommer ikke halvt med
 *  - fallbacket til .all() (Node 22.5-22.12 har ingen .iterate) giver det samme
 *
 * En preload (--require) lytter paa node:sqlite's StatementSync og melder paa
 * stderr, naar backuppens SELECT koerer - og kan fjerne .iterate helt.
 *
 *   node tests/backup.test.mjs            (port 9033, eller KK_PROEVE_PORT)
 */
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ROD = path.resolve(import.meta.dirname, '..');
const PORT = parseInt(process.env.KK_PROEVE_PORT || '9033', 10);
let ok = 0, fejl = 0;
const proev = async (navn, fn) => {
  try { await fn(); console.log('  ok   ' + navn); ok++; }
  catch (e) { console.log('  FEJL ' + navn + '\n       ' + e.message); fejl++; }
};
const skal = (v, f, hvad) => { if (v !== f) throw new Error(`${hvad}: fik ${JSON.stringify(v)}, ventede ${JSON.stringify(f)}`); };
const vent = ms => new Promise(r => setTimeout(r, ms));

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-backup-'));
const PRELOAD = path.join(DIR, 'lyt.cjs');
fs.writeFileSync(PRELOAD, `
const { StatementSync } = require('node:sqlite');
const P = StatementSync.prototype;
if (process.env.PROEVE_UDEN_ITERATE) delete P.iterate;
const erBackup = s => /^SELECT data FROM items WHERE deleted = 0$/.test(s.sourceSQL);
const orgAll = P.all;
P.all = function (...a) {
  if (erBackup(this)) process.stderr.write('[proeve] all\\n');
  return orgAll.apply(this, a);
};
const orgIt = P.iterate;
if (orgIt) P.iterate = function (...a) {
  const it = orgIt.apply(this, a);
  if (!erBackup(this)) return it;
  process.stderr.write('[proeve] iterate\\n');
  return (function* () {
    let n = 0;
    try { for (const r of it) { n++; yield r; } }
    finally { process.stderr.write('[proeve] iterate-slut ' + n + '\\n'); }
  })();
};
`);

function startServer(env = {}) {
  const log = { tekst: '' };
  const p = spawn(process.execPath, ['--require', PRELOAD, 'app/server.js'], {
    cwd: ROD,
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: DIR }, env),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  p.stdout.on('data', d => { log.tekst += d; });
  p.stderr.on('data', d => { log.tekst += d; });
  return new Promise((ok, nej) => {
    const t = setTimeout(() => nej(new Error('serveren startede ikke:\n' + log.tekst)), 8000);
    p.stdout.on('data', () => {
      if (log.tekst.includes('lytter')) { clearTimeout(t); ok({ p, log }); }
    });
  });
}
const stop = s => new Promise(r => { s.p.once('exit', r); s.p.kill(); });

let cookie = '';
function kald(metode, sti, krop) {
  return new Promise((ok, nej) => {
    const data = krop === undefined ? null : Buffer.from(JSON.stringify(krop));
    const req = http.request({ host: '127.0.0.1', port: PORT, path: sti, method: metode,
      headers: Object.assign({ cookie }, data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) },
    res => {
      const dele = [];
      res.on('data', d => dele.push(d));
      res.on('end', () => ok({ res, krop: Buffer.concat(dele) }));
    });
    req.on('error', nej);
    req.end(data);
  });
}

/* Det, den gamle udgave skrev: samme SELECT, samme sammenkaedning. */
function forventet(exported, settings) {
  const db = new DatabaseSync(path.join(DIR, 'kokkeri.db'));
  const rows = db.prepare('SELECT data FROM items WHERE deleted = 0').all();
  db.close();
  return '{"app":"kokkeri","exported":' + JSON.stringify(exported) +
    ',"settings":' + JSON.stringify(settings) + ',"items":[' + rows.map(r => r.data).join(',') + ']}';
}
async function indstillinger() {
  const s = JSON.parse((await kald('GET', '/api/settings')).krop);
  delete s.icalToken;           // /api/settings = appSettingsJson() + icalToken
  return s;
}
const exportedAf = tekst => JSON.parse(tekst.slice(0, 200).match(/"exported":("[^"]*")/)[1]);

console.log('Backup: filnavn, indhold og streaming');

/* --- data: ~45 MB, saa svaret ikke kan gemme sig i socketens buffer --- */
let s = await startServer();
try {
  const reg = await kald('POST', '/api/register', { username: 'proeve', password: 'hemmeligt-kodeord' });
  cookie = String(reg.res.headers['set-cookie'][0]).split(';')[0];
  await kald('POST', '/api/settings', { settings: { app: { appTitle: 'Prøvekøkken ✓', categories: ['Æbler', 'Ø'] } } });
  const db = new DatabaseSync(path.join(DIR, 'kokkeri.db'));
  const ind = db.prepare('INSERT INTO items (id, kind, data, updated_at, deleted) VALUES (?,?,?,?,?)');
  const fyld = 'æøå "citat" \\ ' + 'x'.repeat(150000);
  db.exec('BEGIN');
  for (let i = 0; i < 300; i++) {
    const id = 'rec-' + String(i).padStart(6, '0');
    ind.run(id, 'recipe', JSON.stringify({ id, kind: 'recipe', title: 'Ret ' + i + ' – 🍳', notes: fyld }), '2026-09-16', i === 7 ? 1 : 0);
  }
  db.exec('COMMIT');
  db.close();

  await proev('Content-Disposition har det beskrivende navn kokkeri-backup-<dato>.json', async () => {
    const { res } = await kald('GET', '/api/backup');
    const dato = new Date().toISOString().slice(0, 10);
    skal(res.headers['content-disposition'], `attachment; filename="kokkeri-backup-${dato}.json"`, 'Content-Disposition');
    skal(res.headers['cache-control'], 'no-store', 'Cache-Control');
  });

  await proev('indholdet er byte-identisk med den gamle udgave (og bruger .iterate)', async () => {
    s.log.tekst = '';
    const { krop } = await kald('GET', '/api/backup');
    const t = krop.toString('utf8');
    const f = forventet(exportedAf(t), await indstillinger());
    skal(t.length, f.length, 'laengde');
    skal(t === f, true, 'bytes ens');
    skal(JSON.parse(t).items.length, 299, 'antal (den slettede er udeladt)');
    if (!s.log.tekst.includes('[proeve] iterate\n')) throw new Error('backuppen brugte ikke .iterate:\n' + s.log.tekst);
    if (s.log.tekst.includes('[proeve] all')) throw new Error('backuppen brugte .all');
  });

  await proev('streames: en klient, der holder inde, holder serveren inde - uden at blokere den', async () => {
    const foer = forventet('X', await indstillinger());
    s.log.tekst = '';
    let res;
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/backup', headers: { cookie } });
    await new Promise(r => req.on('response', x => { res = x; res.pause(); r(); }));
    await vent(800);
    if (!s.log.tekst.includes('[proeve] iterate\n')) throw new Error('iterate startede ikke');
    if (s.log.tekst.includes('iterate-slut')) throw new Error('serveren laeste alle raekker, mens klienten holdt inde');
    /* serveren svarer stadig - og en skrivning NU maa ikke komme med */
    const nyt = await kald('POST', '/api/items', { item: { id: 'rec-sent00', kind: 'recipe', title: 'Kom for sent' } });
    skal(nyt.res.statusCode, 200, 'samtidig skrivning');
    const dele = [];
    res.on('data', d => dele.push(d));
    res.resume();
    await new Promise(r => res.on('end', r));
    const t = Buffer.concat(dele).toString('utf8');
    skal(t.includes('Kom for sent'), false, 'skrivningen under backuppen kom med');
    skal(t === foer.replace('"exported":"X"', '"exported":' + JSON.stringify(exportedAf(t))), true, 'bytes ens');
    if (!/iterate-slut 299/.test(s.log.tekst)) throw new Error('iterate blev ikke laest til ende');
  });

  await proev('en klient, der gaar midt i, efterlader ikke serveren haengende', async () => {
    s.log.tekst = '';
    await new Promise(r => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/backup', headers: { cookie } }, res => {
        res.once('data', () => { req.destroy(); r(); });
      });
    });
    await vent(300);
    if (!/iterate-slut \d+/.test(s.log.tekst)) throw new Error('iteratoren blev ikke lukket');
    const { res } = await kald('GET', '/api/settings');
    skal(res.statusCode, 200, 'serveren svarer bagefter');
  });

  await proev('kraever login', async () => {
    const gemt = cookie; cookie = '';
    try { skal((await kald('GET', '/api/backup')).res.statusCode, 401, 'status'); }
    finally { cookie = gemt; }
  });
} finally { await stop(s); }

/* --- aeldre Node uden .iterate: fallbacket skal give det samme --- */
s = await startServer({ PROEVE_UDEN_ITERATE: '1' });
try {
  await proev('uden .iterate (Node 22.5-22.12) falder den tilbage til .all - samme bytes', async () => {
    s.log.tekst = '';
    const { res, krop } = await kald('GET', '/api/backup');
    skal(res.statusCode, 200, 'status');
    const t = krop.toString('utf8');
    skal(t === forventet(exportedAf(t), await indstillinger()), true, 'bytes ens');
    if (!s.log.tekst.includes('[proeve] all')) throw new Error('fallbacket brugte ikke .all:\n' + s.log.tekst);
  });
} finally { await stop(s); }

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n${ok} ok, ${fejl} fejl`);
process.exit(fejl ? 1 : 0);
