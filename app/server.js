'use strict';
/* Kokkeri – selvstændig server til Yggdrasil Panel
 * Node.js (>=22) uden npm-afhængigheder: node:http + node:sqlite + node:crypto.
 * Funktioner: brugere, sessions, kodeord (scrypt), passkeys (WebAuthn),
 * fælles data-API (items pr. kind), indstillinger, backup/restore,
 * opskrift-import fra URL (schema.org/Recipe JSON-LD), billed-proxy,
 * AI-proxy (Claude API, nøglen bor kun på serveren) og iCal-feed af madplanen.
 * Alt data ligger i SQLite i /data. Bygget efter samme opskrift som beanledger. */

const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const BIND_PORT = parseInt(process.env.BIND_PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || process.cwd();
const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const APP_NAME = process.env.APP_NAME || 'Kokkeri';
const SESSION_DAYS = 90;
const DB_PATH = path.join(DATA_DIR, 'kokkeri.db');

/* Datatyper frontenden må gemme. Holdes som whitelist så API'et ikke kan
 * bruges som vilkårligt lager. */
const KINDS = new Set([
  'recipe',     // opskrift (titel, ingredienser, fremgangsmåde, kilde-URL ...)
  'recipeImage',// opskriftens foto (dataURL), id = opskriftens id. Ligger for sig selv,
                // saa listen kan hentes uden 100 KB billede pr. opskrift - se /api/image
  'planEntry',  // madplan-linje (dato + slot + opskrift eller fritekst)
  'shopItem',   // indkøbsliste-linje (tekst, evt. opskrift-reference, afdeling, afkrydset)
  'menu',       // gemt madplan-skabelon (ugedag+slot+opskrift pr. linje)
  'pantryItem', // forråd (vare man har hjemme, evt. udløbsdato)
  'crawlSeen'   // side der ER hentet, men ikke havde en opskrift (springes over næste gang)
]);

/* ---------------- database ---------------- */
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  jwk TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);
/* Delings-siden slog shareToken op ved at parse ALLE opskrifter og .find()e.
 * Med et udtryks-indeks er det ét opslag - og /del/<token> kraever ikke login. */
CREATE INDEX IF NOT EXISTS idx_items_share ON items(json_extract(data, '$.shareToken'))
  WHERE json_extract(data, '$.shareToken') IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const q = {
  userByName: db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userCount: db.prepare('SELECT COUNT(*) AS n FROM users'),
  adminCount: db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1'),
  insertUser: db.prepare('INSERT INTO users (username, pass_salt, pass_hash, is_admin, created_at) VALUES (?,?,?,?,?)'),
  setPassword: db.prepare('UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?'),
  setAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  allUsers: db.prepare(`SELECT u.id, u.username, u.is_admin, u.created_at,
      (SELECT COUNT(*) FROM credentials c WHERE c.user_id = u.id) AS passkeys
    FROM users u ORDER BY u.id`),
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)'),
  sessionByToken: db.prepare('SELECT * FROM sessions WHERE token = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  credById: db.prepare('SELECT * FROM credentials WHERE id = ?'),
  credsByUser: db.prepare('SELECT id, label, created_at FROM credentials WHERE user_id = ? ORDER BY created_at'),
  insertCred: db.prepare('INSERT INTO credentials (id, user_id, jwk, counter, label, created_at) VALUES (?,?,?,?,?,?)'),
  updateCounter: db.prepare('UPDATE credentials SET counter = ? WHERE id = ?'),
  deleteCred: db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?'),
  deleteUserCreds: db.prepare('DELETE FROM credentials WHERE user_id = ?'),
  itemsAll: db.prepare('SELECT kind, data FROM items WHERE deleted = 0'),
  itemsByKind: db.prepare('SELECT data FROM items WHERE kind = ? AND deleted = 0'),
  itemById: db.prepare('SELECT * FROM items WHERE id = ?'),
  /* Listerne sender de RAA JSON-strenge videre. data-kolonnen ER allerede JSON,
   * saa JSON.parse -> JSON.stringify var ren spildtid og en hukommelsesspids. */
  rawExcept: db.prepare(`SELECT data FROM items WHERE deleted = 0 AND kind NOT IN ('recipeImage', 'crawlSeen')`),
  rawByKind: db.prepare('SELECT data FROM items WHERE kind = ? AND deleted = 0'),
  rawAll: db.prepare('SELECT data FROM items WHERE deleted = 0'),
  imageById: db.prepare(`SELECT data, updated_at FROM items WHERE id = ? AND kind = 'recipeImage' AND deleted = 0`),
  recipeByShare: db.prepare(`SELECT data FROM items WHERE kind = 'recipe' AND deleted = 0
    AND json_extract(data, '$.shareToken') = ?`),
  recipeById: db.prepare(`SELECT data FROM items WHERE id = ? AND kind = 'recipe' AND deleted = 0`),
  upsertItem: db.prepare(`INSERT INTO items (id, kind, data, updated_at, deleted) VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, data = excluded.data,
      updated_at = excluded.updated_at, deleted = excluded.deleted`),
  wipeItems: db.prepare('DELETE FROM items'),
  deleteByKind: db.prepare('DELETE FROM items WHERE kind = ?'),
  countByKind: db.prepare('SELECT COUNT(*) AS n FROM items WHERE kind = ? AND deleted = 0'),
  allSettings: db.prepare('SELECT key, value FROM settings'),
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
};

const nowIso = () => new Date().toISOString();
const setting = (key, dflt) => { const r = q.getSetting.get(key); return r ? r.value : dflt; };

/* kalender-token til iCal-abonnement (kalender-apps kan ikke sende cookies) */
if (!setting('ical_token', '')) {
  q.setSetting.run('ical_token', crypto.randomBytes(16).toString('hex'));
}

/* ---------------- billeder ligger for sig selv ----------------
 * Et foto fylder ~100 KB som dataURL. Laa det i opskriften, sendte /api/items
 * hele biblioteket med billeder og alt (248 MB ved 2534 opskrifter) ved hvert
 * login. Nu bor billedet i sit eget item med id "img-<opskriftens id>", og
 * opskriften har kun `imageVer` - et stempel der goer /api/image/<id>?v=<ver>
 * cachebar for evigt, samtidig med at et nyt foto giver en ny URL. */
const imgId = rid => 'img-' + rid;

function migrateImagesOut() {
  if (setting('images_split', '') === '1') return;
  const rows = db.prepare(`SELECT id, data FROM items WHERE kind = 'recipe' AND deleted = 0`).all();
  const stamp = nowIso();
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      let r;
      try { r = JSON.parse(row.data); } catch (e) { continue; }
      if (typeof r.image !== 'string' || !r.image.startsWith('data:')) continue;
      const ver = String(Date.parse(r.updatedAt || '') || Date.now());
      q.upsertItem.run(imgId(row.id), 'recipeImage',
        JSON.stringify({ id: imgId(row.id), kind: 'recipeImage', dataUrl: r.image }), stamp, 0);
      delete r.image;
      delete r.imageRemote;
      r.imageVer = ver;
      q.upsertItem.run(row.id, 'recipe', JSON.stringify(r), r.updatedAt || stamp, 0);
      n++;
    }
    q.setSetting.run('images_split', '1');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  if (n) console.log(`Kokkeri: flyttede ${n} billeder ud af opskrifterne (engangs-migrering)`);
}
migrateImagesOut();

/* dataURL -> {type, buf}. Ugyldigt input giver null frem for at kaste. */
function decodeDataUrl(s) {
  const m = /^data:([^;,]+)(;base64)?,/.exec(String(s || ''));
  if (!m) return null;
  const rest = s.slice(m[0].length);
  try {
    return { type: m[1], buf: m[2] ? Buffer.from(rest, 'base64') : Buffer.from(decodeURIComponent(rest), 'utf8') };
  } catch (e) { return null; }
}

/* ---------------- helpers ---------------- */
const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => Buffer.from(String(s || ''), 'base64url');
const sha256 = buf => crypto.createHash('sha256').update(buf).digest();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function verifyPassword(user, password) {
  const h = Buffer.from(hashPassword(password, user.pass_salt), 'hex');
  const stored = Buffer.from(user.pass_hash, 'hex');
  return h.length === stored.length && crypto.timingSafeEqual(h, stored);
}
function createSession(res, userId, secure) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  q.insertSession.run(token, userId, nowIso(), exp);
  const cookie = [`kokkeri_session=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`].concat(secure ? ['Secure'] : []).join('; ');
  res.setHeader('Set-Cookie', cookie);
}
function readCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}
function currentUser(req) {
  const token = readCookies(req).kokkeri_session;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const s = q.sessionByToken.get(token);
  if (!s) return null;
  if (s.expires_at < nowIso()) { q.deleteSession.run(token); return null; }
  const u = q.userById.get(s.user_id);
  if (!u) { q.deleteSession.run(token); return null; }
  u._token = token;
  return u;
}
function reqContext(req) {
  const proto = (String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()) ||
    (req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return { origin: proto + '://' + host, rpId: hostname, secure: proto === 'https' };
}

/* simple rate limit for login attempts */
const attempts = new Map();
function rateLimited(key) {
  const now = Date.now();
  const a = attempts.get(key) || [];
  const recent = a.filter(t => now - t < 15 * 60e3);
  attempts.set(key, recent);
  return recent.length >= 15;
}
function noteAttempt(key) { (attempts.get(key) || attempts.set(key, []).get(key)).push(Date.now()); }

/* ---------------- CBOR (minimal decoder) ---------------- */
function cborDecodeFirst(buf) {
  let off = 0;
  function readLen(ai) {
    if (ai < 24) return ai;
    if (ai === 24) return buf[off++];
    if (ai === 25) { const v = buf.readUInt16BE(off); off += 2; return v; }
    if (ai === 26) { const v = buf.readUInt32BE(off); off += 4; return v; }
    if (ai === 27) { const v = Number(buf.readBigUInt64BE(off)); off += 8; return v; }
    throw new Error('cbor: unsupported length');
  }
  function read() {
    if (off >= buf.length) throw new Error('cbor: truncated');
    const ib = buf[off++], mt = ib >> 5, ai = ib & 31;
    if (mt === 7) {
      if (ai === 20) return false;
      if (ai === 21) return true;
      if (ai === 22 || ai === 23) return null;
      throw new Error('cbor: unsupported simple/float');
    }
    const len = readLen(ai);
    switch (mt) {
      case 0: return len;
      case 1: return -1 - len;
      case 2: { const v = buf.subarray(off, off + len); off += len; return Buffer.from(v); }
      case 3: { const v = buf.subarray(off, off + len).toString('utf8'); off += len; return v; }
      case 4: { const a = []; for (let i = 0; i < len; i++) a.push(read()); return a; }
      case 5: { const m = new Map(); for (let i = 0; i < len; i++) { const k = read(); m.set(k, read()); } return m; }
      default: throw new Error('cbor: unsupported major type');
    }
  }
  const v = read();
  return [v, off];
}

/* ---------------- WebAuthn ---------------- */
function coseToJwk(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2) { // EC2
    if (cose.get(-1) !== 1 || alg !== -7) throw new Error('Ukendt EC-kurve/algoritme');
    return { kty: 'EC', crv: 'P-256', x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) };
  }
  if (kty === 3) { // RSA
    if (alg !== -257) throw new Error('Ukendt RSA-algoritme');
    return { kty: 'RSA', n: b64u(cose.get(-1)), e: b64u(cose.get(-2)) };
  }
  throw new Error('Ukendt nøgletype');
}
function parseAuthData(authData) {
  if (authData.length < 37) throw new Error('authData for kort');
  const out = {
    rpIdHash: authData.subarray(0, 32),
    flags: authData[32],
    counter: authData.readUInt32BE(33)
  };
  if (out.flags & 0x40) { // attested credential data
    const credIdLen = authData.readUInt16BE(53);
    out.credId = authData.subarray(55, 55 + credIdLen);
    const [cose] = cborDecodeFirst(authData.subarray(55 + credIdLen));
    out.cose = cose;
  }
  return out;
}
function verifyClientData(cdJson, expectType, expectChallenge, expectOrigin) {
  let cd;
  try { cd = JSON.parse(cdJson.toString('utf8')); } catch (e) { throw new Error('Ugyldig clientData'); }
  if (cd.type !== expectType) throw new Error('Forkert clientData-type');
  if (cd.challenge !== expectChallenge) throw new Error('Challenge matcher ikke');
  if (cd.origin !== expectOrigin) throw new Error('Origin matcher ikke (' + cd.origin + ' ≠ ' + expectOrigin + ')');
  return cd;
}
function verifyAssertionSignature(jwkJson, authData, cdJson, sig) {
  const key = crypto.createPublicKey({ key: JSON.parse(jwkJson), format: 'jwk' });
  const signed = Buffer.concat([authData, sha256(cdJson)]);
  return crypto.verify('sha256', signed, key, sig);
}

/* challenge store (in-memory, kortlivet) */
const challenges = new Map();
function issueChallenge(data) {
  const id = crypto.randomBytes(16).toString('hex');
  challenges.set(id, Object.assign({ exp: Date.now() + 5 * 60e3 }, data));
  if (challenges.size > 1000) {
    for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k);
  }
  return id;
}
function takeChallenge(id) {
  const c = challenges.get(id);
  challenges.delete(id);
  if (!c || c.exp < Date.now()) return null;
  return c;
}

/* ---------------- HTTP plumbing ---------------- */
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}
const err = (res, code, message) => send(res, code, { error: message });

/* Felterne oversigten, madplanen og soegningen har brug for. Resten af
 * opskriften (fremgangsmaade, noter, ernaering ...) hentes foerst naar man
 * aabner den - se GET /api/items/<id>. */
const KORT_FELTER = ['id', 'kind', 'title', 'category', 'sourceCategory', 'catChecked',
  'tags', 'rating', 'favorite', 'servings', 'yieldText', 'prepMin', 'cookMin', 'totalMin',
  'timesCooked', 'lastCooked', 'createdAt', 'updatedAt', 'imageVer', 'url'];

/* Skriver {"items":[...]} ud i bidder. Raekkerne ER allerede JSON-tekst i
 * data-kolonnen, saa de konkateneres direkte: ingen JSON.parse -> JSON.stringify
 * og ingen kaempe streng i heapen (det var 1,3 GB pr. kald ved 2534 opskrifter). */
function streamItems(res, rows, kunKort) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.write('{"items":[');
  let bid = '', foerste = true;
  for (const row of rows) {
    let tekst = row.data;
    if (kunKort) {
      let o;
      try { o = JSON.parse(tekst); } catch (e) { continue; }
      if (o.kind === 'recipe') {
        const kort = {};
        for (const k of KORT_FELTER) if (o[k] !== undefined) kort[k] = o[k];
        kort.partial = true;          // frontenden ved, at resten mangler
        tekst = JSON.stringify(kort);
      }
    }
    bid += (foerste ? '' : ',') + tekst;
    foerste = false;
    if (bid.length > 262144) { res.write(bid); bid = ''; }
  }
  res.write(bid + ']}');
  res.end();
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > (maxBytes || 25e6)) { reject(new Error('For stor forespørgsel')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('Ugyldig JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};
function serveStatic(res, relPath) {
  const full = path.normalize(path.join(PUBLIC_DIR, relPath));
  if (!full.startsWith(PUBLIC_DIR)) return err(res, 404, 'Ikke fundet');
  fs.readFile(full, (e, data) => {
    if (e) return err(res, 404, 'Ikke fundet');
    // no-store paa HTML: Cloudflare edge-cacher .js/.css i timevis (den ignorerer
    // no-cache), men ikke HTML - og HTML'en peger paa versionerede ?v=N-URL'er,
    // saa en ny release altid slaar igennem med det samme.
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': path.extname(full) === '.html' ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}

/* ---------------- validation ---------------- */
const USERNAME_RE = /^[a-zA-Z0-9._æøåÆØÅ-]{2,32}$/;
function validPassword(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 200; }

/* Whitelist af setting-nøgler frontenden må skrive. `app` er hoved-JSON'en
 * med parametre; `logo` er et data-URL-billede. `ai_key` er Claude API-nøglen –
 * den gemmes her, men returneres ALDRIG til frontenden (kun aiKeySet: true). */
const SETTING_KEYS = new Set(['app', 'logo', 'allow_registration', 'ai_key', 'ai_model',
  'ai_provider', 'ai_url', 'ha_url', 'ha_token', 'ha_entity', 'todoist_token', 'todoist_project']);
const SETTING_MAX = { app: 200000, logo: 900000, allow_registration: 4, ai_key: 300, ai_model: 100,
  ai_provider: 20, ai_url: 300,
  ha_url: 300, ha_token: 2000, ha_entity: 200, todoist_token: 200, todoist_project: 120 };

function sanitizeItem(it) {
  if (!it || typeof it !== 'object') return null;
  if (typeof it.id !== 'string' || !/^[0-9a-zA-Z-]{6,64}$/.test(it.id)) return null;
  if (typeof it.kind !== 'string' || !KINDS.has(it.kind)) return null;
  const clean = Object.assign({}, it);
  delete clean._token;
  const json = JSON.stringify(clean);
  if (json.length > 200000) return null;
  return { id: it.id, kind: it.kind, json, deleted: it.deleted ? 1 : 0 };
}
function meJson(u) {
  return {
    id: u.id, username: u.username, isAdmin: !!u.is_admin,
    passkeys: q.credsByUser.all(u.id).map(c => ({ id: c.id, label: c.label || 'Passkey', created: c.created_at }))
  };
}
function appSettingsJson() {
  const out = {};
  for (const row of q.allSettings.all()) {
    if (row.key === 'app') { try { out.app = JSON.parse(row.value); } catch (e) { out.app = {}; } }
    else if (row.key === 'logo') out.logo = row.value;
  }
  /* aiKeySet = "AI er klar til brug" uanset udbyder */
  out.aiProvider = setting('ai_provider', 'claude');
  out.aiUrl = setting('ai_url', '');
  out.aiKeySet = out.aiProvider === 'openai' ? !!setting('ai_url', '') : !!setting('ai_key', '');
  out.aiModel = setting('ai_model', '');
  /* Home Assistant + Todoist: tokens forlader aldrig serveren */
  out.haUrl = setting('ha_url', '');
  out.haEntity = setting('ha_entity', '');
  out.haSet = !!(setting('ha_url', '') && setting('ha_token', '') && setting('ha_entity', ''));
  out.todoistProject = setting('todoist_project', '');
  out.todoistSet = !!setting('todoist_token', '');
  return out;
}

/* ---------------- opskrift-import (schema.org/Recipe) ---------------- */
/* De fleste opskrift-sider (Valdemarsro, Arla, madensverden, NYT Cooking ...)
 * indlejrer opskriften som JSON-LD. Vi henter siden, finder Recipe-objektet og
 * normaliserer det. Findes intet, returneres sidens rene tekst, saa frontenden
 * kan lade AI'en udtraekke opskriften i stedet. */
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'da,en;q=0.8'
};

/* Headers til crawl: brugerens egen cookie/user-agent er VALGFRI - offentlige
 * sider (fx valdemarsro.dk) kraever ingenting, abonnements-sider kraever cookien.
 * Cookien gemmes aldrig; den foelger med i hvert kald fra frontenden. */
function crawlHeaders(body) {
  const h = Object.assign({}, FETCH_HEADERS);
  const cookie = String((body && body.cookie) || '').replace(/[\r\n]/g, '').trim();
  if (cookie) h['Cookie'] = cookie.slice(0, 8000);
  const ua = String((body && body.userAgent) || '').replace(/[\r\n]/g, '').trim();
  if (ua) h['User-Agent'] = ua.slice(0, 400);
  const ref = String((body && body.referer) || '').replace(/[\r\n]/g, '').trim();
  if (ref) h['Referer'] = ref.slice(0, 500);
  return h;
}
/* groft tjek: fik vi en login-side i stedet for indholdet? */
function looksLikeLogin(html) {
  const head = String(html || '').slice(0, 4000).toLowerCase();
  return /<form[^>]*(login|signin|log-ind)/.test(head) ||
    (/type=["']password["']/.test(head) && !/recipe/i.test(head));
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '°',
    aring: 'å', Aring: 'Å', aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø',
    frac12: '½', frac14: '¼', frac34: '¾', eacute: 'é', uuml: 'ü', ouml: 'ö', auml: 'ä' };
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
    .replace(/&([a-zA-Z]+);/g, (m, n) => named[n] !== undefined ? named[n] : m);
}
function stripHtml(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
/* ISO 8601-varighed (PT1H30M) -> minutter */
function isoDurationToMin(v) {
  const m = String(v || '').match(/^-?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return null;
  const min = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + (+m[4] || 0) / 60;
  return min ? Math.round(min) : null;
}
function asText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return decodeEntities(v.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ');
  if (typeof v === 'object') return asText(v.name || v.text || v['@value'] || '');
  return String(v);
}
function imageUrlOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return imageUrlOf(v[0]);
  if (typeof v === 'object') return imageUrlOf(v.url || v.contentUrl || '');
  return '';
}
function findRecipeNode(node, depth) {
  if (!node || typeof node !== 'object' || (depth || 0) > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) { const r = findRecipeNode(n, (depth || 0) + 1); if (r) return r; }
    return null;
  }
  const t = node['@type'];
  const types = Array.isArray(t) ? t : (t ? [t] : []);
  if (types.some(x => String(x).toLowerCase() === 'recipe')) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    if (node[key]) { const r = findRecipeNode(node[key], (depth || 0) + 1); if (r) return r; }
  }
  return null;
}
function instructionsOf(v, out) {
  out = out || [];
  if (!v) return out;
  if (typeof v === 'string') {
    /* nogle sider har hele fremgangsmaaden som een streng med linjeskift */
    decodeEntities(v.replace(/<[^>]+>/g, '\n')).split(/\n+/)
      .map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach(s => out.push(s));
    return out;
  }
  if (Array.isArray(v)) { v.forEach(x => instructionsOf(x, out)); return out; }
  if (typeof v === 'object') {
    const t = String(v['@type'] || '').toLowerCase();
    if (t === 'howtosection') {
      const name = asText(v.name);
      if (name) out.push('## ' + name);
      instructionsOf(v.itemListElement, out);
      return out;
    }
    const txt = asText(v.text || v.name);
    if (txt) out.push(txt);
    else instructionsOf(v.itemListElement, out);
    return out;
  }
  return out;
}
function normalizeRecipe(node, pageUrl) {
  const yieldRaw = asText(node.recipeYield);
  const servings = (() => { const m = yieldRaw.match(/\d+/); return m ? +m[0] : null; })();
  const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient
    : Array.isArray(node.ingredients) ? node.ingredients
    : (node.recipeIngredient || node.ingredients) ? [node.recipeIngredient || node.ingredients] : [])
    .map(asText).filter(Boolean);
  return {
    title: asText(node.name),
    description: asText(node.description),
    image: imageUrlOf(node.image),
    ingredients,
    instructions: instructionsOf(node.recipeInstructions).filter(Boolean),
    prepMin: isoDurationToMin(node.prepTime),
    cookMin: isoDurationToMin(node.cookTime),
    totalMin: isoDurationToMin(node.totalTime),
    servings,
    yieldText: yieldRaw,
    category: asText(node.recipeCategory),
    cuisine: asText(node.recipeCuisine),
    keywords: asText(node.keywords),
    author: asText(node.author),
    url: pageUrl
  };
}
/* Microdata-fallback (itemtype="schema.org/Recipe" + itemprop=...) - bruges af
 * bl.a. Valdemarsro. Uden DOM noejes vi med robuste heuristikker: alle props
 * soeges fra Recipe-scopets start og frem. */
function mdProp(scope, prop, all) {
  const re = new RegExp(
    `<([a-z0-9]+)([^>]*\\bitemprop=["']${prop}["'][^>]*)>([\\s\\S]*?)<\\/\\1>|<[^>]*\\bitemprop=["']${prop}["'][^>]*?(?:content|datetime)=["']([^"']+)["'][^>]*\\/?>|<[^>]*(?:content|datetime)=["']([^"']+)["'][^>]*\\bitemprop=["']${prop}["'][^>]*\\/?>`,
    'gi');
  const out = [];
  let m;
  while ((m = re.exec(scope))) {
    /* content/datetime-attribut vinder over indre tekst (fx PT45M) */
    const attrs = m[2] || '';
    const attrVal = (attrs.match(/(?:content|datetime)=["']([^"']+)["']/i) || [])[1];
    const v = attrVal || m[4] || m[5] || stripHtml(m[3] || '');
    if (v && String(v).trim()) out.push(String(v).trim());
    if (!all) break;
  }
  return all ? out : (out[0] || '');
}
function microdataRecipe(html, pageUrl) {
  const idx = html.search(/itemtype=["']https?:\/\/schema\.org\/Recipe["']/i);
  if (idx < 0) return null;
  const scope = html.slice(Math.max(0, html.lastIndexOf('<', idx)));
  const ingredients = mdProp(scope, 'recipeIngredient', true)
    .concat(mdProp(scope, 'ingredients', true))
    .map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!ingredients.length) return null;
  const instructions = [];
  for (const block of mdProp(scope, 'recipeInstructions', true)) {
    block.split(/\n+/).map(s => s.trim()).filter(Boolean).forEach(s => instructions.push(s));
  }
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                  html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const yieldRaw = mdProp(scope, 'recipeYield');
  const servM = yieldRaw.match(/\d+/);
  return {
    title: mdProp(scope, 'headline') || (ogTitle ? decodeEntities(ogTitle[1]) : '') ||
           mdProp(scope, 'name') || (titleM ? decodeEntities(titleM[1]).trim() : ''),
    description: mdProp(scope, 'description'),
    image: ogImg ? ogImg[1] : imageUrlOf(mdProp(scope, 'image')),
    ingredients,
    instructions,
    prepMin: isoDurationToMin(mdProp(scope, 'prepTime')),
    cookMin: isoDurationToMin(mdProp(scope, 'cookTime')),
    totalMin: isoDurationToMin(mdProp(scope, 'totalTime')),
    servings: servM ? +servM[0] : null,
    yieldText: yieldRaw,
    category: mdProp(scope, 'recipeCategory'),
    cuisine: mdProp(scope, 'recipeCuisine'),
    keywords: mdProp(scope, 'keywords'),
    author: '',
    url: pageUrl
  };
}
function extractRecipe(html, pageUrl) {
  const blocks = [...html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let json;
    const raw = b[1].trim().replace(/^\s*<!--/, '').replace(/-->\s*$/, '');
    try { json = JSON.parse(raw); } catch (e) { continue; }
    const node = findRecipeNode(json, 0);
    if (node) {
      const r = normalizeRecipe(node, pageUrl);
      if (r.title && (r.ingredients.length || r.instructions.length)) return r;
    }
  }
  const md = microdataRecipe(html, pageUrl);
  if (md && md.title) return md;
  return null;
}
async function fetchPage(url) {
  const r = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!r.ok) throw new Error('Siden svarede ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 8e6) throw new Error('Siden er for stor');
  return buf.toString('utf8');
}

/* ---------------- crawl-job (baggrund) ----------------
 * Et helt site kan vaere tusindvis af sider - derfor koerer importen som et job
 * PAA SERVEREN, saa brugeren kan lukke browseren imens. Kun ét job ad gangen.
 * Cookien lever kun i dette objekt (aldrig paa disk) og slettes naar jobbet er
 * faerdigt. Billeder gemmes som ekstern URL - frontenden kan hente dem lokalt
 * bagefter (canvas-skalering findes ikke i Node uden pakker). */
const crawlJob = {
  running: false, stop: false, startedAt: '', site: '',
  total: 0, done: 0, imported: 0, skipped: 0, failed: 0,
  current: '', error: '', cookie: '', userAgent: '', useAi: false, urls: []
};

function crawlStatus() {
  return {
    running: crawlJob.running, site: crawlJob.site, startedAt: crawlJob.startedAt,
    total: crawlJob.total, done: crawlJob.done, imported: crawlJob.imported,
    skipped: crawlJob.skipped, failed: crawlJob.failed,
    current: crawlJob.current, error: crawlJob.error
  };
}

/* URL uden protokol/trailing slash - saa http/https og "/side" vs "/side/"
 * regnes som samme side, baade her og i frontendens filtrering */
function normUrl(u) {
  return String(u || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}
function markSeen(url) {
  try {
    /* id udledes af URL'en, saa samme side aldrig giver to raekker */
    const id = 'seen-' + crypto.createHash('sha1').update(normUrl(url)).digest('hex').slice(0, 24);
    const stamp = nowIso();
    q.upsertItem.run(id, 'crawlSeen',
      JSON.stringify({ id, kind: 'crawlSeen', url, seenAt: stamp }), stamp, 0);
  } catch (e) {}
}

async function runCrawlJob() {
  const headers = crawlHeaders({ cookie: crawlJob.cookie, userAgent: crawlJob.userAgent });
  /* eksisterende titler = dublet-filter */
  const kendte = new Set(q.itemsByKind.all('recipe')
    .map(r => { try { return String(JSON.parse(r.data).title || '').toLowerCase().replace(/\s+/g, ' ').trim(); } catch (e) { return ''; } })
    .filter(Boolean));

  for (const url of crawlJob.urls) {
    if (crawlJob.stop) break;
    crawlJob.current = url;
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(25000), redirect: 'follow' });
      if (r.status === 401 || r.status === 403) {
        crawlJob.error = 'Adgang nægtet (' + r.status + ') – cookien virker ikke længere. Stoppet.';
        break;
      }
      if (!r.ok) { crawlJob.failed++; }
      else {
        const html = (await r.text()).slice(0, 8e6);
        if (looksLikeLogin(html)) {
          crawlJob.error = 'Fik en login-side retur – cookien er udløbet. Stoppet.';
          break;
        }
        let rec = extractRecipe(html, url);
        if (!rec && crawlJob.useAi) {
          try {
            const out = await aiMessage({
              system: `Du udtrækker madopskrifter af rå tekst. Svar KUN med ét JSON-objekt:
{"title": str, "description": str, "servings": tal|null, "prepMin": tal|null, "cookMin": tal|null,
"ingredients": [str], "instructions": [str], "category": str}
Findes der ingen opskrift, svar {"error":"ingen"}. Oversæt intet.`,
              messages: [{ role: 'user', content: stripHtml(html).slice(0, 20000) }],
              maxTokens: 3000
            });
            const j = parseAiJsonServer(out.text);
            if (j && j.title && Array.isArray(j.ingredients) && j.ingredients.length) {
              rec = { title: j.title, description: j.description || '', image: '', ingredients: j.ingredients.map(String),
                instructions: (j.instructions || []).map(String), prepMin: j.prepMin || null, cookMin: j.cookMin || null,
                totalMin: null, servings: j.servings || null, yieldText: '', category: j.category || '', keywords: '', url };
            }
          } catch (e) {}
        }
        const titel = rec && String(rec.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!rec || !titel) {
          crawlJob.failed++;
          /* husk siden, saa den ikke hentes igen naeste gang - et sitemap er
           * fuldt af blogindlaeg, og uden dette bruges hele koeretiden paa dem */
          markSeen(url);
        }
        else if (kendte.has(titel)) crawlJob.skipped++;
        else {
          kendte.add(titel);
          const id = crypto.randomUUID();
          const item = {
            id, kind: 'recipe', title: rec.title, description: rec.description || '',
            image: rec.image || '', url,
            ingredients: rec.ingredients || [], instructions: rec.instructions || [],
            prepMin: rec.prepMin || null, cookMin: rec.cookMin || null, totalMin: rec.totalMin || null,
            servings: rec.servings || null, yieldText: rec.yieldText || '',
            /* serveren kender ikke brugerens kategoriliste - gem sidens egen
             * kategori raat, saa frontenden kan mappe den (guessCategory) */
            category: '', sourceCategory: rec.category || '',
            tags: rec.keywords ? String(rec.keywords).split(',').map(t => t.trim()).filter(Boolean).slice(0, 6) : [],
            rating: 0, favorite: false, notes: '', imageRemote: !!rec.image,
            createdAt: new Date().toISOString()
          };
          q.upsertItem.run(id, 'recipe', JSON.stringify(item), nowIso(), 0);
          crawlJob.imported++;
        }
      }
    } catch (e) {
      crawlJob.failed++;
    }
    crawlJob.done++;
    if (!crawlJob.stop) await new Promise(r2 => setTimeout(r2, 1100 + Math.random() * 400));
  }
  console.log(`[crawl] ${crawlJob.site}: ${crawlJob.imported} nye, ${crawlJob.skipped} dubletter, ${crawlJob.failed} uden opskrift`);
  crawlJob.running = false;
  crawlJob.current = '';
  crawlJob.cookie = '';       // hemmeligheden lever ikke laengere end jobbet
  crawlJob.userAgent = '';
  crawlJob.urls = [];
}

/* ---------------- AI-proxy ----------------
 * To udbydere: Claude API (Anthropic) eller en egen OpenAI-kompatibel server
 * (LM Studio, Ollama, llama.cpp ...). Valget bor i settings `ai_provider`;
 * noegle/URL forlader aldrig serveren. */
const AI_DEFAULT_MODEL = 'claude-sonnet-5';

/* Samme problem som i frontenden (parseAiJson i p1_core.js): lokale modeller
 * pakker svaret i markdown-hegn eller skriver en forklaring udenom. Holdes
 * bevidst i sync med frontend-versionen - ret begge steder. */
function parseAiJsonServer(text) {
  const s = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '').trim();
  for (let p = s.indexOf('{'), n = 0; p >= 0 && n < 6; p = s.indexOf('{', p + 1), n++) {
    let dybde = 0, iStreng = false, esc = false;
    for (let i = p; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { iStreng = !iStreng; continue; }
      if (iStreng) continue;
      if (c === '{') dybde++;
      else if (c === '}' && --dybde === 0) {
        const k = s.slice(p, i + 1);
        try { return JSON.parse(k); }
        catch (e) {
          try { return JSON.parse(k.replace(/,\s*([}\]])/g, '$1')); } catch (e2) {}
        }
        break;
      }
    }
  }
  return null;
}

function aiSanitizeMessages(body) {
  const messages = Array.isArray(body.messages) ? body.messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-40).map(m => ({ role: m.role, content: String(m.content).slice(0, 60000) })) : [];
  if (!messages.length) { const e = new Error('Ingen beskeder'); e.status = 400; throw e; }
  return messages;
}

async function aiMessage(body) {
  const provider = setting('ai_provider', 'claude');
  const messages = aiSanitizeMessages(body);
  const maxTokens = Math.min(Math.max(parseInt(body.maxTokens, 10) || 2048, 256), 8192);
  const system = typeof body.system === 'string' && body.system ? String(body.system).slice(0, 60000) : '';

  if (provider === 'openai') {
    const base = setting('ai_url', '').replace(/\/+$/, '');
    if (!base) { const e = new Error('Ingen AI-server sat op – angiv serverens adresse under Indstillinger'); e.status = 400; throw e; }
    const key = setting('ai_key', '');
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = 'Bearer ' + key;
    let model = setting('ai_model', '');
    if (!model) {
      /* LM Studio kraever et modelnavn - tag den foerst indlaeste fra /models */
      try {
        const r0 = await fetch(base + '/models', { headers, signal: AbortSignal.timeout(10000) });
        const j0 = await r0.json();
        model = (j0 && j0.data && j0.data[0] && j0.data[0].id) || '';
      } catch (e) {}
      if (!model) { const e = new Error('Kunne ikke finde en model på AI-serveren – angiv modelnavnet under Indstillinger'); e.status = 400; throw e; }
    }
    const payload = {
      model, max_tokens: maxTokens,
      messages: (system ? [{ role: 'system', content: system }] : []).concat(messages)
    };
    let r;
    try {
      /* lokale modeller kan vaere langsomme - giv dem god tid */
      r = await fetch(base + '/chat/completions', {
        method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(300000)
      });
    } catch (e2) {
      const e = new Error('Kunne ikke nå AI-serveren på ' + base + ' (' + e2.message + ')'); e.status = 502; throw e;
    }
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = (j && j.error && (j.error.message || j.error)) || ('AI-serveren svarede ' + r.status);
      const e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 300)); e.status = 502; throw e;
    }
    let text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    /* raesonnerende lokale modeller (qwen3 m.fl.) pakker taenkning ind i <think>-blokke */
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return { text, model: (j && j.model) || model, usage: (j && j.usage) || null };
  }

  /* --- Claude API (standard) --- */
  const key = setting('ai_key', '');
  if (!key) { const e = new Error('Ingen AI-nøgle sat – tilføj din Claude API-nøgle under Indstillinger'); e.status = 400; throw e; }
  const model = setting('ai_model', '') || AI_DEFAULT_MODEL;
  const payload = { model, max_tokens: maxTokens, messages };
  if (system) payload.system = system;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000)
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (j && j.error && j.error.message) || ('AI-tjenesten svarede ' + r.status);
    const e = new Error(msg); e.status = r.status === 401 ? 401 : 502; throw e;
  }
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  return { text, model: j.model, usage: j.usage || null };
}

/* ---------------- router ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const ctx = reqContext(req);

  try {
    /* --- static --- */
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveStatic(res, 'index.html');
    if (req.method === 'GET' && p === '/manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
      return res.end(JSON.stringify({
        name: APP_NAME, short_name: 'Kokkeri', start_url: '.', display: 'standalone',
        background_color: '#0b0f14', theme_color: '#e0703c', lang: 'da',
        icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
      }));
    }
    if (req.method === 'GET' && /^\/(app\.js|style\.css|sw\.js|icon-\d+\.png|favicon\.ico)$/.test(p)) {
      return serveStatic(res, p === '/favicon.ico' ? 'icon-192.png' : p.slice(1));
    }

    /* offentlig delt opskrift (ingen session - beskyttet af unikt token pr. opskrift) */
    if (p.startsWith('/del/') && req.method === 'GET') {
      const token = decodeURIComponent(p.slice(5)).replace(/[^0-9a-f]/g, '');
      if (token.length < 16) return err(res, 404, 'Ikke fundet');
      /* ét indeks-opslag (idx_items_share) - ikke en scanning af hele biblioteket */
      const rad = q.recipeByShare.get(token);
      let rec = null;
      try { rec = rad ? JSON.parse(rad.data) : null; } catch (e) {}
      if (!rec) return err(res, 404, 'Opskriften findes ikke – delingen kan være slået fra');
      /* billedet bor for sig selv nu - hent det kun til den ene side */
      if (rec.imageVer && !rec.image) {
        const irad = q.imageById.get(imgId(rec.id));
        try { if (irad) rec.image = JSON.parse(irad.data).dataUrl; } catch (e) {}
      }
      const H = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const ings = (rec.ingredients || []).map(l => /^##\s*/.test(l)
        ? `<li class="grp">${H(l.replace(/^##\s*/, ''))}</li>` : `<li>${H(l)}</li>`).join('');
      const steps = (rec.instructions || []).map(s2 => /^##\s*/.test(s2)
        ? `</ol><h3>${H(s2.replace(/^##\s*/, ''))}</h3><ol>` : `<li>${H(s2)}</li>`).join('');
      const meta = [rec.category, rec.servings ? rec.servings + ' portioner' : '',
        rec.totalMin || rec.cookMin ? '⏱ ' + (rec.totalMin || ((rec.prepMin || 0) + (rec.cookMin || 0))) + ' min' : '']
        .filter(Boolean).join(' · ');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(`<!doctype html><html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${H(rec.title)}</title>
<style>
body{font:16px/1.5 system-ui,-apple-system,sans-serif;margin:0;background:#0b0f14;color:#e6edf3}
@media(prefers-color-scheme:light){body{background:#f4f5f7;color:#1c2128}.wrap{background:#fff}}
.wrap{max-width:760px;margin:0 auto;padding:28px 22px 60px}
img{max-width:100%;border-radius:12px}
h1{margin:8px 0 4px}.meta{color:#8b98a5;margin-bottom:18px}
ul{list-style:none;padding:0}ul li{padding:6px 0;border-bottom:1px solid rgba(128,148,168,.25)}
ul li.grp{font-weight:700;color:#e0703c;border:0;padding-top:14px}
ol li{padding:5px 0 5px 4px}
.foot{margin-top:36px;color:#8b98a5;font-size:13px}
a{color:#539bf5;text-decoration:none}
</style></head><body><div class="wrap">
${rec.image ? `<img src="${rec.image}" alt="">` : ''}
<h1>${H(rec.title)}</h1>
<div class="meta">${H(meta)}</div>
${rec.description ? `<p>${H(rec.description)}</p>` : ''}
<h2>Ingredienser</h2><ul>${ings}</ul>
<h2>Fremgangsmåde</h2><ol>${steps}</ol>
${rec.url ? `<p class="foot">Original: <a href="${H(rec.url)}" rel="noopener">${H(rec.url)}</a></p>` : ''}
<p class="foot">Delt fra ${H(APP_NAME)} 🍳</p>
</div></body></html>`);
    }

    if (!p.startsWith('/api/')) return err(res, 404, 'Ikke fundet');

    /* --- API --- */
    const user = currentUser(req);
    const isJson = (req.headers['content-type'] || '').includes('application/json');
    if (req.method !== 'GET' && !isJson) return err(res, 400, 'Content-Type skal være application/json');
    const body = req.method === 'GET' ? {} : await readBody(req);

    /* iCal-abonnement af madplanen (ingen session - beskyttet af token) */
    if (p === '/api/madplan.ics' && req.method === 'GET') {
      const token = String(u.searchParams.get('token') || '');
      const want = setting('ical_token', '');
      if (!want || token !== want) return err(res, 403, 'Ugyldigt kalender-token');
      const entries = q.itemsByKind.all('planEntry').map(r => JSON.parse(r.data));
      /* Slaa KUN de opskrifter op, madplanen faktisk henviser til. Feedet blev
       * pollet af kalender-apps hvert kvarter og parsede foer hele biblioteket. */
      const cache = new Map();
      const hentRec = id => {
        if (!id) return null;
        if (!cache.has(id)) {
          const row = q.recipeById.get(id);
          let x = null;
          try { x = row ? JSON.parse(row.data) : null; } catch (e) {}
          cache.set(id, x);
        }
        return cache.get(id);
      };
      const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kokkeri//DA', 'CALSCALE:GREGORIAN',
        'X-WR-CALNAME:' + icsEsc(APP_NAME + ' madplan'), 'X-WR-TIMEZONE:Europe/Copenhagen'];
      const SLOT_DA = { breakfast: 'Morgenmad', lunch: 'Frokost', other: 'Andet' };
      for (const e of entries) {
        if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
        const rec = e.recipeId ? hentRec(e.recipeId) : null;
        const slotPre = SLOT_DA[e.slot] ? SLOT_DA[e.slot] + ': ' : '';
        const title = slotPre + (rec ? rec.title : (e.text || 'Madplan'));
        lines.push('BEGIN:VEVENT', `UID:${e.id}@kokkeri`, 'DTSTAMP:' + stamp,
          `DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`,
          'SUMMARY:' + icsEsc('🍽 ' + title));
        if (rec && rec.url) lines.push('DESCRIPTION:' + icsEsc(rec.url));
        lines.push('END:VEVENT');
      }
      lines.push('END:VCALENDAR');
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(lines.join('\r\n'));
    }

    /* offentlig config til login-siden (ingen session paakraevet) */
    if (p === '/api/public-config' && req.method === 'GET') {
      const total = q.userCount.get().n;
      return send(res, 200, {
        appName: APP_NAME,
        allowRegistration: total === 0 || setting('allow_registration', '1') === '1'
      });
    }

    /* auth */
    if (p === '/api/register' && req.method === 'POST') {
      const total = q.userCount.get().n;
      const allowReg = total === 0 || setting('allow_registration', '1') === '1';
      if (!allowReg) return err(res, 403, 'Registrering af nye brugere er slået fra');
      const username = String(body.username || '').trim();
      if (!USERNAME_RE.test(username)) return err(res, 400, 'Brugernavn: 2-32 tegn (bogstaver, tal, . _ -)');
      if (!validPassword(body.password)) return err(res, 400, 'Kodeordet skal være mindst 8 tegn');
      if (q.userByName.get(username)) return err(res, 409, 'Brugernavnet er optaget');
      const salt = crypto.randomBytes(16).toString('hex');
      const info = q.insertUser.run(username, salt, hashPassword(body.password, salt), total === 0 ? 1 : 0, nowIso());
      createSession(res, Number(info.lastInsertRowid), ctx.secure);
      const nu = q.userById.get(Number(info.lastInsertRowid));
      console.log(`[bruger] oprettet: ${username}${total === 0 ? ' (admin)' : ''}`);
      return send(res, 200, { me: meJson(nu), firstUser: total === 0 });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const key = (req.socket.remoteAddress || '') + '|' + String(body.username || '');
      if (rateLimited(key)) return err(res, 429, 'For mange forsøg – prøv igen om et kvarter');
      const usr = q.userByName.get(String(body.username || '').trim());
      if (!usr || !verifyPassword(usr, String(body.password || ''))) {
        noteAttempt(key);
        return err(res, 401, 'Forkert brugernavn eller kodeord');
      }
      createSession(res, usr.id, ctx.secure);
      return send(res, 200, { me: meJson(usr) });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      if (user) q.deleteSession.run(user._token);
      res.setHeader('Set-Cookie', 'kokkeri_session=; Path=/; Max-Age=0');
      return send(res, 200, { ok: true });
    }

    /* webauthn login (ingen session påkrævet) */
    if (p === '/api/webauthn/login/options' && req.method === 'POST') {
      const challenge = b64u(crypto.randomBytes(32));
      const challengeId = issueChallenge({ challenge, origin: ctx.origin, rpId: ctx.rpId, type: 'get' });
      return send(res, 200, {
        challengeId,
        publicKey: { challenge, rpId: ctx.rpId, timeout: 60000, userVerification: 'preferred', allowCredentials: [] }
      });
    }
    if (p === '/api/webauthn/login/verify' && req.method === 'POST') {
      const c = takeChallenge(String(body.challengeId || ''));
      if (!c || c.type !== 'get') return err(res, 400, 'Challenge er udløbet – prøv igen');
      const cred = q.credById.get(String(body.id || ''));
      if (!cred) return err(res, 401, 'Ukendt passkey');
      const cdJson = fromB64u(body.response && body.response.clientDataJSON);
      const authData = fromB64u(body.response && body.response.authenticatorData);
      const sig = fromB64u(body.response && body.response.signature);
      verifyClientData(cdJson, 'webauthn.get', c.challenge, c.origin);
      const ad = parseAuthData(authData);
      if (!ad.rpIdHash.equals(sha256(Buffer.from(c.rpId)))) return err(res, 401, 'Forkert rpId');
      if (!(ad.flags & 0x01)) return err(res, 401, 'Bruger ikke til stede');
      if (!verifyAssertionSignature(cred.jwk, authData, cdJson, sig)) return err(res, 401, 'Ugyldig signatur');
      if (ad.counter > 0 && cred.counter > 0 && ad.counter <= cred.counter) return err(res, 401, 'Ugyldig tæller (klonet nøgle?)');
      q.updateCounter.run(ad.counter, cred.id);
      const usr = q.userById.get(cred.user_id);
      if (!usr) return err(res, 401, 'Brugeren findes ikke længere');
      createSession(res, usr.id, ctx.secure);
      return send(res, 200, { me: meJson(usr) });
    }

    /* alt herunder kræver login */
    if (!user) return err(res, 401, 'Ikke logget ind');

    if (p === '/api/me' && req.method === 'GET') return send(res, 200, { me: meJson(user) });

    if (p === '/api/password' && req.method === 'POST') {
      if (!verifyPassword(user, String(body.current || ''))) return err(res, 401, 'Nuværende kodeord er forkert');
      if (!validPassword(body.password)) return err(res, 400, 'Nyt kodeord skal være mindst 8 tegn');
      const salt = crypto.randomBytes(16).toString('hex');
      q.setPassword.run(salt, hashPassword(body.password, salt), user.id);
      return send(res, 200, { ok: true });
    }

    /* webauthn registrering */
    if (p === '/api/webauthn/register/options' && req.method === 'POST') {
      const challenge = b64u(crypto.randomBytes(32));
      const challengeId = issueChallenge({ challenge, origin: ctx.origin, rpId: ctx.rpId, type: 'create', userId: user.id });
      return send(res, 200, {
        challengeId,
        publicKey: {
          challenge,
          rp: { name: APP_NAME, id: ctx.rpId },
          user: { id: b64u(Buffer.from('user-' + user.id)), name: user.username, displayName: user.username },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          timeout: 60000,
          attestation: 'none',
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
          excludeCredentials: q.credsByUser.all(user.id).map(c => ({ type: 'public-key', id: c.id }))
        }
      });
    }
    if (p === '/api/webauthn/register/verify' && req.method === 'POST') {
      const c = takeChallenge(String(body.challengeId || ''));
      if (!c || c.type !== 'create' || c.userId !== user.id) return err(res, 400, 'Challenge er udløbet – prøv igen');
      const cdJson = fromB64u(body.response && body.response.clientDataJSON);
      verifyClientData(cdJson, 'webauthn.create', c.challenge, c.origin);
      const [att] = cborDecodeFirst(fromB64u(body.response && body.response.attestationObject));
      const authData = att.get('authData');
      if (!Buffer.isBuffer(authData)) return err(res, 400, 'Manglende authData');
      const ad = parseAuthData(authData);
      if (!ad.rpIdHash.equals(sha256(Buffer.from(c.rpId)))) return err(res, 400, 'Forkert rpId');
      if (!ad.credId || !ad.cose) return err(res, 400, 'Ingen credential-data');
      const jwk = coseToJwk(ad.cose);
      const credId = b64u(ad.credId);
      if (q.credById.get(credId)) return err(res, 409, 'Denne passkey er allerede registreret');
      const label = String(body.label || '').slice(0, 100) || 'Passkey';
      q.insertCred.run(credId, user.id, JSON.stringify(jwk), ad.counter, label, nowIso());
      return send(res, 200, { me: meJson(user) });
    }
    if (p.startsWith('/api/webauthn/credentials/') && req.method === 'DELETE') {
      q.deleteCred.run(decodeURIComponent(p.slice('/api/webauthn/credentials/'.length)), user.id);
      return send(res, 200, { me: meJson(q.userById.get(user.id)) });
    }

    /* ---- data: items (faelles for alle brugere) ---- */
    if (p === '/api/items' && req.method === 'GET') {
      const kind = u.searchParams.get('kind');
      if (kind && !KINDS.has(kind)) return err(res, 400, 'Ukendt datatype');
      /* Uden ?kind udelades recipeImage (hentes via /api/image) og crawlSeen
       * (bruges kun af masse-importen) - de har intet at goere i login-svaret. */
      const rows = kind ? q.rawByKind.all(kind) : q.rawExcept.all();
      const kort = u.searchParams.get('fields') === 'card';
      return streamItems(res, rows, kort);
    }
    /* Opskriftens fulde indhold - naar man aabner én fra listen. */
    if (p.startsWith('/api/items/') && req.method === 'GET' && !p.endsWith('/bulk')) {
      const row = q.recipeById.get(decodeURIComponent(p.slice('/api/items/'.length)));
      if (!row) return err(res, 404, 'Findes ikke');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('{"item":' + row.data + '}');
    }
    if (p.startsWith('/api/image/') && req.method === 'GET') {
      const row = q.imageById.get(imgId(decodeURIComponent(p.slice('/api/image/'.length))));
      if (!row) return err(res, 404, 'Intet billede');
      let bild = null;
      try { bild = decodeDataUrl(JSON.parse(row.data).dataUrl); } catch (e) {}
      if (!bild) return err(res, 404, 'Billedet kan ikke laeses');
      const etag = '"' + crypto.createHash('sha1').update(row.updated_at + bild.buf.length).digest('hex').slice(0, 16) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
      res.writeHead(200, {
        'Content-Type': bild.type,
        'Content-Length': bild.buf.length,
        ETag: etag,
        /* URL'en er versioneret med ?v=imageVer, saa indholdet kan aldrig skifte
         * bag om cachen - derfor immutable. */
        'Cache-Control': 'private, max-age=31536000, immutable'
      });
      return res.end(bild.buf);
    }
    if (p === '/api/items' && req.method === 'POST') {
      const it = sanitizeItem(body.item);
      if (!it) return err(res, 400, 'Ugyldigt element');
      const stamp = nowIso();
      q.upsertItem.run(it.id, it.kind, it.json, stamp, it.deleted);
      return send(res, 200, { ok: true, updatedAt: stamp });
    }
    if (p === '/api/items/bulk' && req.method === 'POST') {
      const arr = Array.isArray(body.items) ? body.items.slice(0, 50000) : null;
      if (!arr) return err(res, 400, 'Forventede { items: [...] }');
      let n = 0;
      const stamp = nowIso();
      db.exec('BEGIN');
      try {
        for (const raw of arr) {
          const it = sanitizeItem(raw);
          if (!it) continue;
          q.upsertItem.run(it.id, it.kind, it.json, stamp, it.deleted);
          n++;
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return send(res, 200, { imported: n });
    }

    /* ---- indstillinger (app-parametre + logo + AI) ---- */
    if (p === '/api/settings' && req.method === 'GET') {
      return send(res, 200, Object.assign(appSettingsJson(), { icalToken: setting('ical_token', '') }));
    }
    if (p === '/api/settings' && req.method === 'POST') {
      const entries = body.settings && typeof body.settings === 'object' ? body.settings : null;
      if (!entries) return err(res, 400, 'Forventede { settings: {...} }');
      for (const [key, val] of Object.entries(entries)) {
        if (!SETTING_KEYS.has(key)) return err(res, 400, 'Ukendt indstilling: ' + key);
        const str = key === 'app' ? JSON.stringify(val) : String(val == null ? '' : val);
        if (str.length > SETTING_MAX[key]) return err(res, 413, key + ' er for stor');
        q.setSetting.run(key, str);
      }
      return send(res, 200, appSettingsJson());
    }

    /* ---- opskrift-import fra URL ---- */
    if (p === '/api/fetch-recipe' && req.method === 'GET') {
      let target;
      try { target = new URL(String(u.searchParams.get('url') || '')); } catch (e) { return err(res, 400, 'Ugyldig URL'); }
      if (target.protocol !== 'https:' && target.protocol !== 'http:') return err(res, 400, 'Kun http/https-links');
      try {
        const html = await fetchPage(target.href);
        const recipe = extractRecipe(html, target.href);
        if (recipe) return send(res, 200, { recipe });
        /* intet JSON-LD: returner sidens tekst, saa AI'en kan proeve */
        const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const ogImg = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:image["']/i);
        return send(res, 200, {
          recipe: null,
          pageTitle: titleM ? decodeEntities(titleM[1]).trim().slice(0, 300) : '',
          pageImage: ogImg ? ogImg[1] : '',
          pageText: stripHtml(html).slice(0, 30000)
        });
      } catch (e) {
        return err(res, 502, 'Kunne ikke hente siden: ' + e.message);
      }
    }

    /* ---- opskrift-parsning af indsat HTML ----
     * Til sider bag login: brugeren kopierer sidens HTML (vis kilde / Cmd+A)
     * fra sin egen indloggede browser og indsaetter den - serveren koerer
     * praecis samme parser som ved URL-import (JSON-LD -> microdata). */
    if (p === '/api/parse-recipe' && req.method === 'POST') {
      const html = typeof body.html === 'string' ? body.html.slice(0, 3e6) : '';
      if (!html.trim()) return err(res, 400, 'Ingen HTML at analysere');
      let pageUrl = '';
      try { pageUrl = body.url ? new URL(String(body.url)).href : ''; } catch (e) {}
      const recipe = extractRecipe(html, pageUrl);
      if (recipe) return send(res, 200, { recipe });
      const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const ogImg = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:image["']/i);
      return send(res, 200, {
        recipe: null,
        pageTitle: titleM ? decodeEntities(titleM[1]).trim().slice(0, 300) : '',
        pageImage: ogImg ? ogImg[1] : '',
        pageText: stripHtml(html).slice(0, 30000)
      });
    }

    /* ---- crawl af et site man selv har adgang til (fx et abonnement) ----
     * Brugeren leverer sin egen session-cookie (fra DevTools eller en indsat
     * cURL-kommando); serveren henter siderne med den og bruger den almindelige
     * opskrift-parser. Cookien gemmes ALDRIG - den sendes med pr. kald. */
    if (p === '/api/site/discover' && req.method === 'POST') {
      let target;
      try { target = new URL(String(body.url || '')); } catch (e) { return err(res, 400, 'Ugyldig URL'); }
      if (target.protocol !== 'https:' && target.protocol !== 'http:') return err(res, 400, 'Kun http/https');
      const headers = crawlHeaders(body);
      const mode = body.mode === 'sitemap' ? 'sitemap' : 'links';
      const pattern = String(body.pattern || '').toLowerCase();
      try {
        let urls = [];
        let robotsAdvarsel = '';
        try {
          const rob = await fetch(target.origin + '/robots.txt', { headers, signal: AbortSignal.timeout(8000) });
          if (rob.ok) {
            const txt = (await rob.text()).slice(0, 20000);
            /* meget simpelt tjek: er stien eksplicit disallowed for alle? */
            const alle = txt.split(/user-agent:/i).find(s => /^\s*\*/.test(s)) || '';
            const dis = [...alle.matchAll(/disallow:\s*(\S+)/gi)].map(m => m[1]).filter(x => x !== '/');
            if (dis.some(d => target.pathname.startsWith(d))) {
              robotsAdvarsel = 'Sitets robots.txt fraråder automatisk hentning af denne sti.';
            }
          }
        } catch (e) {}

        if (mode === 'sitemap') {
          const seen = new Set();
          const grab = async (u, dybde) => {
            if (dybde > 3 || seen.has(u) || seen.size > 60 || urls.length > 3000) return;
            seen.add(u);
            const r = await fetch(u, { headers, signal: AbortSignal.timeout(20000), redirect: 'follow' });
            if (!r.ok) return;
            const txt = (await r.text()).slice(0, 8e6);
            for (const m of txt.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
              const l = m[1].replace(/&amp;/g, '&');
              if (/\.xml(\.gz)?$/i.test(l)) await grab(l, dybde + 1);
              else urls.push(l);
            }
          };
          for (const s of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) {
            try { await grab(target.origin + s, 0); } catch (e) {}
            if (urls.length) break;
          }
          if (!urls.length) {
            try {
              const rob = await fetch(target.origin + '/robots.txt', { headers, signal: AbortSignal.timeout(8000) });
              if (rob.ok) {
                for (const m of (await rob.text()).matchAll(/Sitemap:\s*(\S+)/gi)) await grab(m[1], 0);
              }
            } catch (e) {}
          }
          if (!urls.length) return err(res, 404, 'Fandt intet sitemap på ' + target.origin + ' – prøv "links på siden" i stedet');
        } else {
          const r = await fetch(target.href, { headers, signal: AbortSignal.timeout(20000), redirect: 'follow' });
          if (!r.ok) return err(res, 502, 'Siden svarede ' + r.status + (r.status === 401 || r.status === 403 ? ' – virker din cookie?' : ''));
          const html = (await r.text()).slice(0, 8e6);
          if (looksLikeLogin(html)) return err(res, 401, 'Fik en login-side retur – cookien er udløbet eller mangler');
          for (const m of html.matchAll(/<a[^>]+href\s*=\s*["']([^"'#]+)["']/gi)) {
            try {
              const u = new URL(m[1], target.href);
              if (u.origin === target.origin) urls.push(u.href.split('#')[0]);
            } catch (e) {}
          }
        }
        urls = [...new Set(urls)]
          .filter(u => !/\.(jpg|jpeg|png|gif|webp|svg|pdf|css|js|xml|zip|mp4)(\?|$)/i.test(u))
          .filter(u => !pattern || u.toLowerCase().includes(pattern));
        /* 5000 = samme loft som crawl/start, saa store sites (madbanditten har
         * 3169 sider) kan tages i én omgang i stedet for kun de foerste 1000 */
        return send(res, 200, { urls: urls.slice(0, 5000), total: urls.length, robotsAdvarsel });
      } catch (e) {
        return err(res, 502, 'Kunne ikke hente: ' + e.message);
      }
    }

    /* ---- baggrundsjob: hent mange sider uden at browseren skal vaere aaben ---- */
    if (p === '/api/site/crawl/status' && req.method === 'GET') {
      return send(res, 200, crawlStatus());
    }
    if (p === '/api/site/crawl/stop' && req.method === 'POST') {
      crawlJob.stop = true;
      return send(res, 200, crawlStatus());
    }
    if (p === '/api/site/crawl/start' && req.method === 'POST') {
      if (crawlJob.running) return err(res, 409, 'Der kører allerede en import – vent til den er færdig');
      const urls = (Array.isArray(body.urls) ? body.urls : [])
        .map(String).filter(u => /^https?:\/\//i.test(u)).slice(0, 5000);
      if (!urls.length) return err(res, 400, 'Ingen adresser at hente');
      Object.assign(crawlJob, {
        running: true, stop: false, startedAt: nowIso(),
        site: (() => { try { return new URL(urls[0]).hostname; } catch (e) { return ''; } })(),
        total: urls.length, done: 0, imported: 0, skipped: 0, failed: 0,
        current: '', error: '', urls,
        cookie: String(body.cookie || ''), userAgent: String(body.userAgent || ''),
        useAi: !!body.useAi && (setting('ai_provider', 'claude') === 'openai'
          ? !!setting('ai_url', '') : !!setting('ai_key', ''))
      });
      console.log(`[crawl] starter ${urls.length} sider fra ${crawlJob.site}`);
      runCrawlJob().catch(e => {
        console.error('[fejl] crawl', e.message);
        crawlJob.error = e.message;
        crawlJob.running = false;
        crawlJob.cookie = '';
      });
      return send(res, 200, crawlStatus());
    }

    if (p === '/api/site/fetch' && req.method === 'POST') {
      let target;
      try { target = new URL(String(body.url || '')); } catch (e) { return err(res, 400, 'Ugyldig URL'); }
      if (target.protocol !== 'https:' && target.protocol !== 'http:') return err(res, 400, 'Kun http/https');
      try {
        const r = await fetch(target.href, {
          headers: crawlHeaders(body), signal: AbortSignal.timeout(25000), redirect: 'follow'
        });
        if (!r.ok) return err(res, 502, 'Siden svarede ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 8e6) return err(res, 413, 'Siden er for stor');
        const html = buf.toString('utf8');
        if (looksLikeLogin(html)) return err(res, 401, 'Fik en login-side retur – cookien virker ikke længere');
        const recipe = extractRecipe(html, target.href);
        if (recipe) return send(res, 200, { recipe });
        const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const ogImg = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:image["']/i);
        return send(res, 200, {
          recipe: null,
          pageTitle: titleM ? decodeEntities(titleM[1]).trim().slice(0, 300) : '',
          pageImage: ogImg ? ogImg[1] : '',
          pageText: stripHtml(html).slice(0, 30000)
        });
      } catch (e) {
        return err(res, 502, 'Kunne ikke hente: ' + e.message);
      }
    }

    /* ---- billed-proxy (til at gemme opskrift-billeder lokalt som dataURL) ---- */
    if (p === '/api/fetch-image' && req.method === 'GET') {
      let target;
      try { target = new URL(String(u.searchParams.get('url') || '')); } catch (e) { return err(res, 400, 'Ugyldig URL'); }
      if (target.protocol !== 'https:' && target.protocol !== 'http:') return err(res, 400, 'Kun http/https-links');
      try {
        const r = await fetch(target.href, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20000), redirect: 'follow' });
        if (!r.ok) return err(res, 502, 'Billedet svarede ' + r.status);
        const type = r.headers.get('content-type') || '';
        if (!type.startsWith('image/')) return err(res, 415, 'Ikke et billede (' + type + ')');
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 10e6) return err(res, 413, 'Billedet er for stort');
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        return res.end(buf);
      } catch (e) {
        return err(res, 502, 'Kunne ikke hente billedet: ' + e.message);
      }
    }

    /* ---- AI-proxy ---- */
    if (p === '/api/ai' && req.method === 'POST') {
      try {
        const out = await aiMessage(body);
        return send(res, 200, out);
      } catch (e) {
        return err(res, e.status || 502, e.message);
      }
    }

    /* ---- Home Assistant: skub aabne indkoebsvarer til en todo-liste ----
     * Token'et bor kun paa serveren (settings ha_token). En vare ad gangen via
     * todo.add_item - HA har ingen bulk-service. */
    if (p === '/api/ha/push-shopping' && req.method === 'POST') {
      const haUrl = setting('ha_url', '').replace(/\/+$/, '');
      const haToken = setting('ha_token', '');
      const haEntity = setting('ha_entity', '');
      if (!haUrl || !haToken || !haEntity) return err(res, 400, 'Home Assistant er ikke sat op – udfyld URL, token og todo-enhed under Indstillinger');
      const items = q.itemsByKind.all('shopItem').map(r => JSON.parse(r.data)).filter(i => !i.done);
      if (!items.length) return err(res, 400, 'Indkøbslisten er tom');
      let ok = 0, failed = 0, lastErr = '';
      for (const it of items.slice(0, 200)) {
        try {
          const r = await fetch(haUrl + '/api/services/todo/add_item', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + haToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity_id: haEntity, item: String(it.text || '').slice(0, 250) }),
            signal: AbortSignal.timeout(10000)
          });
          if (r.ok) ok++; else { failed++; lastErr = 'HA svarede ' + r.status; }
        } catch (e) { failed++; lastErr = e.message; }
        if (failed >= 3 && ok === 0) break; // giv op hurtigt hvis intet virker
      }
      if (!ok) return err(res, 502, 'Kunne ikke sende til Home Assistant: ' + lastErr);
      return send(res, 200, { pushed: ok, failed });
    }

    /* ---- Todoist ----
     * Token'et bor kun paa serveren (settings todoist_token).
     * Bruger den UNIFIED API v1 (api.todoist.com/api/v1) - det gamle
     * /rest/v2 blev pensioneret i 2026 og svarer nu 410 Gone.
     * GET /projects (pagineret: {results, next_cursor}) og POST /tasks. */
    if (p.startsWith('/api/todoist/')) {
      const tdToken = setting('todoist_token', '');
      if (!tdToken) return err(res, 400, 'Todoist er ikke sat op – indsæt dit API-token under Indstillinger');
      const td = async (path2, opts) => {
        /* NB: headers saettes EFTER merge. Object.assign er "shallow", saa et
         * opts.headers (fx Content-Type paa POST) ville ellers erstatte hele
         * headers-objektet og fjerne Authorization - GET virkede, POST gav 401. */
        const o = Object.assign({ signal: AbortSignal.timeout(15000) }, opts || {});
        o.headers = Object.assign({ 'Authorization': 'Bearer ' + tdToken },
          (opts && opts.headers) || {});
        const r = await fetch('https://api.todoist.com/api/v1' + path2, o);
        if (r.status === 401 || r.status === 403) { const e = new Error('Todoist afviste tokenet – tjek at det er kopieret rigtigt'); e.status = 401; throw e; }
        if (r.status === 429) { const e = new Error('Todoist beder om at vente lidt (for mange kald)'); e.status = 429; throw e; }
        if (!r.ok) { const e = new Error('Todoist svarede ' + r.status); e.status = 502; throw e; }
        return r.status === 204 ? null : r.json();
      };

      /* projektliste, saa brugeren kan vaelge hvor varerne skal lande */
      if (p === '/api/todoist/projects' && req.method === 'GET') {
        try {
          const projects = [];
          let cursor = '';
          /* v1 er pagineret; hent maks 5 sider (=250 projekter) */
          for (let page = 0; page < 5; page++) {
            const r = await td('/projects?limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
            const rows = Array.isArray(r) ? r : (r && Array.isArray(r.results) ? r.results : []);
            for (const x of rows) {
              projects.push({ id: String(x.id), name: x.name, isInbox: !!(x.is_inbox_project || x.inbox_project) });
            }
            cursor = (r && r.next_cursor) || '';
            if (!cursor) break;
          }
          return send(res, 200, { projects });
        } catch (e) { return err(res, e.status || 502, e.message); }
      }

      if (p === '/api/todoist/push-shopping' && req.method === 'POST') {
        const items = q.itemsByKind.all('shopItem').map(r => JSON.parse(r.data)).filter(i => !i.done);
        if (!items.length) return err(res, 400, 'Indkøbslisten er tom');
        const projectId = setting('todoist_project', '');
        let ok = 0, failed = 0, lastErr = '', lastStatus = 502;
        for (const it of items.slice(0, 200)) {
          const task = { content: String(it.text || '').slice(0, 500) };
          if (projectId) task.project_id = projectId;
          /* butiksafdeling/opskrift som beskrivelse - godt naar man staar i butikken */
          const note = [it.section, it.group].filter(Boolean).join(' · ');
          if (note) task.description = note.slice(0, 500);
          try {
            await td('/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Request-Id': crypto.randomUUID() },
              body: JSON.stringify(task)
            });
            ok++;
          } catch (e) {
            failed++;
            lastErr = e.message;
            lastStatus = e.status || 502;
            if (e.status === 401 || e.status === 429) break; // ugyldigt token / rate limit - stop straks
          }
          if (failed >= 3 && ok === 0) break;
        }
        if (!ok) return err(res, lastStatus === 401 ? 401 : 502, 'Kunne ikke sende til Todoist: ' + lastErr);
        return send(res, 200, { pushed: ok, failed });
      }
    }

    /* ---- backup / restore ---- */
    if (p === '/api/backup' && req.method === 'GET') {
      /* Backuppen indeholder ALT - ogsaa billederne. Den skrives i bidder;
       * bygget som én streng ville den vaere en halv gigabyte i heapen. */
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="kokkeri-${new Date().toISOString().slice(0, 10)}.json"`
      });
      res.write('{"app":"kokkeri","exported":' + JSON.stringify(nowIso()) +
        ',"settings":' + JSON.stringify(appSettingsJson()) + ',"items":[');
      let bid = '', foerste = true;
      for (const row of q.rawAll.all()) {
        bid += (foerste ? '' : ',') + row.data;
        foerste = false;
        if (bid.length > 262144) { res.write(bid); bid = ''; }
      }
      res.write(bid + ']}');
      return res.end();
    }
    if (p === '/api/backup.db' && req.method === 'GET') {
      if (!user.is_admin) return err(res, 403, 'Kræver administrator-rettigheder');
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) {}
      /* streames fra disk - fs.readFile ville laese hele databasen ind i RAM */
      let stat = null;
      try { stat = fs.statSync(DB_PATH); } catch (e) { return err(res, 500, 'Kunne ikke læse databasen'); }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="kokkeri-${new Date().toISOString().slice(0, 10)}.db"`
      });
      const stream = fs.createReadStream(DB_PATH);
      stream.on('error', () => res.destroy());
      return stream.pipe(res);
    }
    /* ---- toem data (admin) ----
     * Bekraeftelsesordet tjekkes OGSAA her - ikke kun i browseren - saa et
     * fejlkald mod API'et ikke kan slette alt. Brugere og indstillinger
     * (kategorier, AI-noegle, logo) roeres ikke. */
    if (p === '/api/wipe' && req.method === 'POST') {
      if (!user.is_admin) return err(res, 403, 'Kræver administrator-rettigheder');
      if (String(body.confirm || '').trim().toUpperCase() !== 'KOKKERI') {
        return err(res, 400, 'Skriv KOKKERI for at bekræfte');
      }
      const kinds = (Array.isArray(body.kinds) ? body.kinds : []).filter(k => KINDS.has(k));
      if (!kinds.length) return err(res, 400, 'Vælg mindst én datatype');
      let n = 0;
      db.exec('BEGIN');
      try {
        /* billederne bor i deres egen kind - de skal med, naar opskrifterne ryddes */
        for (const k of kinds.includes('recipe') ? kinds.concat('recipeImage') : kinds) {
          n += q.deleteByKind.run(k).changes || 0;
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      console.log(`[wipe] ${user.username} slettede ${n} elementer (${kinds.join(', ')})`);
      return send(res, 200, { deleted: n });
    }

    if (p === '/api/restore' && req.method === 'POST') {
      if (!user.is_admin) return err(res, 403, 'Kræver administrator-rettigheder');
      /* Gendannelse sker i portioner: en fuld backup er hundredvis af megabyte
       * (billederne), og ét POST ville baade sprænge grænsen i readBody og
       * ligge i heapen. Foerste kald kan saette replace/settings uden items. */
      const arr = Array.isArray(body.items) ? body.items : (body.begin ? [] : null);
      if (!arr) return err(res, 400, 'Forventede { items: [...] } fra en Kokkeri-backup');
      const stamp = nowIso();
      let n = 0;
      db.exec('BEGIN');
      try {
        if (body.replace) q.wipeItems.run();
        for (const raw of arr) {
          const it = sanitizeItem(raw);
          if (!it) continue;
          q.upsertItem.run(it.id, it.kind, it.json, stamp, it.deleted);
          n++;
        }
        if (body.settings && typeof body.settings === 'object') {
          if (body.settings.app) q.setSetting.run('app', JSON.stringify(body.settings.app).slice(0, SETTING_MAX.app));
          if (typeof body.settings.logo === 'string') q.setSetting.run('logo', body.settings.logo.slice(0, SETTING_MAX.logo));
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      console.log(`[backup] ${user.username} gendannede ${n} elementer${body.replace ? ' (erstattede alt)' : ''}`);
      return send(res, 200, { restored: n });
    }

    /* ---- admin ---- */
    if (p.startsWith('/api/admin/')) {
      if (!user.is_admin) return err(res, 403, 'Kræver administrator-rettigheder');

      if (p === '/api/admin/users' && req.method === 'GET') {
        return send(res, 200, {
          users: q.allUsers.all().map(x => ({
            id: x.id, username: x.username, isAdmin: !!x.is_admin,
            created: x.created_at, passkeys: x.passkeys
          })),
          allowRegistration: setting('allow_registration', '1') === '1'
        });
      }
      if (p === '/api/admin/settings' && req.method === 'POST') {
        if (typeof body.allowRegistration === 'boolean') {
          q.setSetting.run('allow_registration', body.allowRegistration ? '1' : '0');
        }
        return send(res, 200, { allowRegistration: setting('allow_registration', '1') === '1' });
      }
      const m = p.match(/^\/api\/admin\/users\/(\d+)(?:\/(password|role))?$/);
      if (m) {
        const targetId = parseInt(m[1], 10);
        const target = q.userById.get(targetId);
        if (!target) return err(res, 404, 'Brugeren findes ikke');

        if (m[2] === 'password' && req.method === 'POST') {
          if (!validPassword(body.password)) return err(res, 400, 'Kodeordet skal være mindst 8 tegn');
          const salt = crypto.randomBytes(16).toString('hex');
          q.setPassword.run(salt, hashPassword(body.password, salt), targetId);
          q.deleteUserSessions.run(targetId);
          console.log(`[admin] ${user.username} satte nyt kodeord for ${target.username}`);
          return send(res, 200, { ok: true });
        }
        if (m[2] === 'role' && req.method === 'POST') {
          const makeAdmin = !!body.isAdmin;
          if (!makeAdmin && target.is_admin && q.adminCount.get().n <= 1) {
            return err(res, 400, 'Kan ikke fjerne den sidste administrator');
          }
          q.setAdmin.run(makeAdmin ? 1 : 0, targetId);
          console.log(`[admin] ${user.username} ${makeAdmin ? 'gav' : 'fjernede'} admin for ${target.username}`);
          return send(res, 200, { ok: true });
        }
        if (!m[2] && req.method === 'DELETE') {
          if (targetId === user.id) return err(res, 400, 'Du kan ikke slette dig selv');
          if (target.is_admin && q.adminCount.get().n <= 1) return err(res, 400, 'Kan ikke slette den sidste administrator');
          q.deleteUserSessions.run(targetId);
          q.deleteUserCreds.run(targetId);
          q.deleteUser.run(targetId);
          console.log(`[admin] ${user.username} slettede brugeren ${target.username}`);
          return send(res, 200, { ok: true });
        }
      }
    }

    return err(res, 404, 'Ukendt endpoint');
  } catch (e) {
    console.error('[fejl]', req.method, p, e.message);
    return err(res, 500, 'Serverfejl: ' + e.message);
  }
});

setInterval(() => { try { q.purgeSessions.run(nowIso()); } catch (e) {} }, 6 * 3600e3).unref();

server.listen(BIND_PORT, () => {
  console.log(`${APP_NAME}: Kokkeri lytter på port ${BIND_PORT} (data: ${DB_PATH})`);
});
