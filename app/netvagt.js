'use strict';
/*
 * Kokkeri - netvagten: alle udgaaende kald til en adresse, en BRUGER har angivet
 * (opskriftsimport, crawl, billed-proxy, huti, egen AI-server, Home Assistant,
 * doda, Cellarius). Kopieret fra huti/app/netvagt.js (huti v2, 2026-10-14) og
 * udvidet med svarets headere, viderestillinger og en fetch-lignende indpakning.
 *
 * Sikkerhedsreviewet af huti-forbindelsen (2026-10-14): /api/fetch-recipe var en
 * fuld SSRF - en hvilken som helst indlogget bruger kunne laese hutis interne side
 * paa 127.0.0.1 tilbage gennem Kokkeri. Reglerne her:
 *
 *  1. Vaerten slaas op i DNS ved HVERT kald, og ALLE A/AAAA-svar tjekkes. Peger
 *     bare ét af dem paa loopback, privat, link-local, CGNAT, ULA, multicast
 *     eller »uspecificeret«, er adressen intern - og kun en Kokkeri-admin
 *     maa bruge den (`tilladPrivat`). Kokkeri og huti/HA/LM Studio staar typisk
 *     paa samme LAN-server, saa admin SKAL kunne.
 *  2. Forbindelsen BINDES til den adresse, der blev tjekket: http/https faar en
 *     `lookup`-funktion, der kun kan svare med den. Et DNS-svar, der skifter
 *     mellem tjek og forbindelse (DNS-rebinding), naar derfor aldrig frem.
 *     TLS tjekker stadig certifikatet mod vaertsnavnet (servername).
 *  3. `hent()` foelger ingen viderestillinger. `hentFoelg()` foelger dem selv,
 *     hop for hop, og HVERT hop gaar gennem tjekket igen (et offentligt link kan
 *     viderestille til 127.0.0.1). Cookie/Authorization sendes ikke videre til en
 *     anden oprindelse.
 *  4. Timeout og et loft paa svarkroppen.
 *
 * Fejl kastes som Error med `kode`: 'blokeret' | 'timeout' | 'unreachable' | 'stor'.
 * Kalderen goer dem ENS udadtil (»kunne ikke hente«) - ellers er en importknap en
 * portscanner. Detaljen (e.message) er kun til loggen.
 */

const net = require('node:net');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');

/* To lister: en BlockList tjekker en IPv4-adresse OGSAA mod IPv6-regler (som ::ffff:0:0/96),
 * saa en blandet liste ville goere hele IPv4-nettet internt (RUNE-ERFARINGER, huti v2). */
const INTERNE4 = new net.BlockList();
const INTERNE6 = new net.BlockList();
for (const [a, n] of [
  ['0.0.0.0', 8], ['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['169.254.0.0', 16], ['100.64.0.0', 10], ['192.0.0.0', 24], ['198.18.0.0', 15],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) INTERNE4.addSubnet(a, n, 'ipv4');
for (const [a, n] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  // IPv4 indlejret i IPv6 (NAT64 og den gamle »kompatible« form) kan pege ind paa nettet.
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['::', 96],
  // IPv4-mappet i hex-form (::ffff:7f00:1) - den prikkede form tjekkes som IPv4 i erIntern().
  ['::ffff:0:0', 96],
]) INTERNE6.addSubnet(a, n, 'ipv6');

/** Er adressen intern? '::ffff:10.0.0.1' tjekkes som IPv4. En ugyldig adresse er intern (luk hellere). */
function erIntern(adr) {
  let s = String(adr || '').trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (m) s = m[1];
  const v = net.isIP(s);
  if (!v) return true;
  return v === 6 ? INTERNE6.check(s, 'ipv6') : INTERNE4.check(s, 'ipv4');
}

/** Alle adresser for vaerten. En IP-literal er sig selv. Kaster med kode 'unreachable'. */
async function slaaOp(vaert) {
  let h = String(vaert || '');
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const v = net.isIP(h);
  if (v) return [{ address: h, family: v }];
  try {
    const svar = await dns.promises.lookup(h, { all: true, verbatim: true });
    if (!svar.length) throw new Error('intet svar');
    return svar;
  } catch (e) {
    throw Object.assign(new Error(`dns: ${e.code || e.message}`), { kode: 'unreachable' });
  }
}

/* `tilladPrivat` er true/false eller en funktion (vaert) -> bool (proeverne bruger den
 * til at vise, at et hop til en anden vaert tjekkes for sig). */
const maaPrivat = (tillad, vaert) => (typeof tillad === 'function' ? !!tillad(vaert) : !!tillad);

/**
 * Tjek vaerten og vaelg den adresse, forbindelsen bindes til.
 * -> { address, family }. Kaster { kode: 'blokeret' } for en intern adresse uden `tilladPrivat`.
 */
async function vaelgAdresse(vaert, tilladPrivat) {
  const alle = await slaaOp(vaert);
  if (!maaPrivat(tilladPrivat, vaert) && alle.some((a) => erIntern(a.address))) {
    throw Object.assign(new Error(`intern adresse (${alle.map((a) => a.address).join(', ')})`), { kode: 'blokeret' });
  }
  return alle[0];
}

/**
 * Ét http(s)-kald, bundet til en tjekket adresse. Foelger INGEN viderestilling.
 * opts: { method, headers, body (string|Buffer), timeoutMs, maksBytes, klip, tilladPrivat }
 *   klip: true = en krop over loftet klippes (sider); ellers kastes kode 'stor'.
 * -> { status, headers, buf }. Kaster Error med `kode`.
 */
async function hent(url, opts = {}) {
  let u;
  try { u = new URL(url); } catch (e) { throw Object.assign(new Error('ugyldig adresse'), { kode: 'blokeret' }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Object.assign(new Error('protokol'), { kode: 'blokeret' });
  if (u.username || u.password) throw Object.assign(new Error('brugeroplysninger i adressen'), { kode: 'blokeret' });
  const timeoutMs = opts.timeoutMs || 10_000;
  const maks = opts.maksBytes || 512 * 1024;
  const start = Date.now();
  const valgt = await vaelgAdresse(u.hostname, opts.tilladPrivat);
  const rest = Math.max(1, timeoutMs - (Date.now() - start));
  const modul = u.protocol === 'https:' ? https : http;
  // Forbindelsen kan KUN gaa til den adresse, der lige er tjekket (rebinding).
  const lookup = (_h, o, cb) => {
    if (o && o.all) cb(null, [{ address: valgt.address, family: valgt.family }]);
    else cb(null, valgt.address, valgt.family);
  };
  const vaertsnavn = u.hostname.replace(/^\[|\]$/g, '');
  return new Promise((ok, nej) => {
    let faerdig = false;
    const slut = (fejl, vaerdi) => { if (faerdig) return; faerdig = true; clearTimeout(ur); if (fejl) nej(fejl); else ok(vaerdi); };
    const req = modul.request(u, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      lookup,
      agent: false,
      servername: net.isIP(vaertsnavn) ? undefined : vaertsnavn,
    }, (res) => {
      const dele = [];
      let n = 0;
      const svar = () => ({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(dele) });
      res.on('data', (d) => {
        if (faerdig) return;
        n += d.length;
        if (n > maks) {
          res.destroy();
          if (opts.klip) { dele.push(d.subarray(0, Math.max(0, d.length - (n - maks)))); slut(null, svar()); }
          else slut(Object.assign(new Error('svaret er for stort'), { kode: 'stor' }));
          return;
        }
        dele.push(d);
      });
      res.on('end', () => slut(null, svar()));
      res.on('error', (e) => slut(Object.assign(new Error(e.message), { kode: 'unreachable' })));
    });
    const ur = setTimeout(() => { req.destroy(); slut(Object.assign(new Error('timeout'), { kode: 'timeout' })); }, rest);
    req.on('error', (e) => slut(Object.assign(new Error(e.code || e.message), { kode: 'unreachable' })));
    if (opts.body !== undefined) req.end(opts.body); else req.end();
  });
}

/**
 * Som hent(), men foelger viderestillinger (hoejst `maksHop`, standard 5). HVERT hop
 * slaas op og tjekkes for sig. 301/302/303 bliver til GET uden krop (som en browser).
 * -> { status, headers, buf, url } (url = den sidste adresse).
 */
async function hentFoelg(url, opts = {}) {
  const maksHop = opts.maksHop == null ? 5 : opts.maksHop;
  const t0 = Date.now();
  const timeoutMs = opts.timeoutMs || 10_000;
  let nu = String(url);
  let o = Object.assign({}, opts);
  const forste = (() => { try { return new URL(nu).origin; } catch (e) { return ''; } })();
  for (let hop = 0; ; hop++) {
    const rest = timeoutMs - (Date.now() - t0);
    if (rest <= 0) throw Object.assign(new Error('timeout'), { kode: 'timeout' });
    const r = await hent(nu, Object.assign({}, o, { timeoutMs: rest }));
    const sted = r.headers && r.headers.location;
    if (r.status < 300 || r.status >= 400 || r.status === 304 || !sted) return Object.assign(r, { url: nu });
    if (hop >= maksHop) throw Object.assign(new Error('for mange viderestillinger'), { kode: 'unreachable' });
    let naeste;
    try { naeste = new URL(String(sted), nu).href; } catch (e) { throw Object.assign(new Error('ugyldig viderestilling'), { kode: 'unreachable' }); }
    if (r.status === 301 || r.status === 302 || r.status === 303) {
      if ((o.method || 'GET') !== 'GET' && o.method !== 'HEAD') o = Object.assign({}, o, { method: 'GET', body: undefined });
    }
    // Hemmeligheder (crawlens cookie, en noegle) foelger ikke med til en anden oprindelse.
    if (new URL(naeste).origin !== forste && o.headers) {
      const h = {};
      for (const [k, v] of Object.entries(o.headers)) if (!/^(cookie|authorization)$/i.test(k)) h[k] = v;
      o = Object.assign({}, o, { headers: h });
    }
    nu = naeste;
  }
}

/**
 * Fetch-lignende indpakning, saa de gamle `fetch()`-kald kun skal skiftes ud:
 * -> { ok, status, url, headers: { get(navn) }, text(), json(), arrayBuffer() }.
 * opts: som hent() + `foelg` (standard true) og `timeoutMs`.
 */
async function vagtFetch(url, opts = {}) {
  const r = opts.foelg === false ? await hent(url, opts) : await hentFoelg(url, opts);
  const buf = r.buf;
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    url: r.url || url,
    headers: { get: (n) => { const v = r.headers[String(n).toLowerCase()]; return v == null ? null : Array.isArray(v) ? v.join(', ') : String(v); } },
    text: async () => buf.toString('utf8'),
    json: async () => JSON.parse(buf.toString('utf8')),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

module.exports = { erIntern, slaaOp, vaelgAdresse, hent, hentFoelg, vagtFetch };
