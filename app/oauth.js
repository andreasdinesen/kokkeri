'use strict';
/*
 * Kokkeri - OAuth 2.1 til claude.ai's connectors.
 *
 * Porteret fra doda (RUNE-ERFARINGER §9a). Claude Code og Desktop kan sende en
 * fast noegle i en header. Webklienten kan ikke: den kender ikke serveren paa
 * forhaand, saa den skal kunne REGISTRERE sig selv og sende brugeren gennem et
 * login. Det kraever fire ting:
 *
 *   1. To .well-known-dokumenter, saa klienten kan finde rundt  (RFC 9728, 8414)
 *   2. Dynamisk klientregistrering                              (RFC 7591)
 *   3. /authorize med PKCE og en samtykkeside
 *   4. /token, der bytter en kode til et access- og refresh-token
 *
 * Alt sammen JSON, omdirigeringer og hashing - ingen pakker.
 *
 * OAuth 2.1 frem for 2.0 betyder konkret: PKCE med S256 er OBLIGATORISK
 * ("plain" er ingen beskyttelse), implicit grant findes ikke, redirect_uri
 * matcher NOEJAGTIGT, og koder er engangsbrug med kort levetid.
 *
 * Modulet kender hverken databasen eller http'en - alt kommer ind gennem srv,
 * saa det kan testes for sig.
 */

const crypto = require('node:crypto');

const KODE_LEVETID = 60;                 // sekunder - koden skal byttes straks
const ADGANG_LEVETID = 8 * 3600;         // access token
const SCOPES = ['read', 'full'];

const sha256 = s => crypto.createHash('sha256').update(s).digest();
const b64u = b => Buffer.from(b).toString('base64url');

function opret(srv) {
  /* Koder lever kun i hukommelsen: de skal bruges inden for et minut og
   * behoever ikke overleve en genstart. */
  const koder = new Map();

  const base = req => {
    const foerste = v => String(v || '').split(',')[0].trim();
    const vaert = foerste(req.headers['x-forwarded-host']) || foerste(req.headers.host) || '';
    const proto = foerste(req.headers['x-forwarded-proto']) || (req.socket.encrypted ? 'https' : 'http');
    return `${proto}://${vaert}`;
  };

  /* ------------------------------------------------------------ opdagelse */

  function beskyttetRessource(req) {
    const b = base(req);
    return {
      resource: `${b}/mcp`,
      authorization_servers: [b],
      scopes_supported: SCOPES,
      bearer_methods_supported: ['header']
    };
  }

  function serverMetadata(req) {
    const b = base(req);
    return {
      issuer: b,
      authorization_endpoint: `${b}/oauth/authorize`,
      token_endpoint: `${b}/oauth/token`,
      registration_endpoint: `${b}/oauth/register`,
      revocation_endpoint: `${b}/oauth/revoke`,
      scopes_supported: SCOPES,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],   // kun S256
      token_endpoint_auth_methods_supported: ['none']
    };
  }

  /* -------------------------------------------------- dynamisk registrering */

  function registrer(krop) {
    const uris = Array.isArray(krop.redirect_uris) ? krop.redirect_uris : [];
    const gyldige = uris.filter(u => {
      try {
        const url = new URL(u);
        /* Kun https udefra. localhost tillades, saa man kan proeve med et
         * lokalt vaerktoej uden at skulle have et certifikat. */
        return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      } catch (e) { return false; }
    }).slice(0, 10);
    if (!gyldige.length) return { fejl: 'redirect_uris must contain at least one https URL' };

    const navn = String(krop.client_name || 'Unnamed client').slice(0, 120);
    const id = `kokkeri-client-${crypto.randomBytes(12).toString('hex')}`;
    srv.gemKlient({ id, name: navn, redirect_uris: JSON.stringify(gyldige) });
    return {
      klient: {
        client_id: id,
        /* Offentlig klient: ingen hemmelighed. Sikkerheden ligger i PKCE og i
         * den noejagtige redirect_uri - en hemmelighed i en browser ville
         * alligevel ikke vaere hemmelig. */
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: gyldige,
        client_name: navn,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
      }
    };
  }

  /* ---------------------------------------------------------- autorisation */

  /** Validerer forespoergslen FOER brugeren ser noget. */
  function tjekAutorisation(q) {
    const klient = srv.hentKlient(q.get('client_id') || '');
    if (!klient) return { fejl: 'Ukendt klient. Tilføj forbindelsen igen.' };

    const redirect = q.get('redirect_uri') || '';
    let registrerede = [];
    try { registrerede = JSON.parse(klient.redirect_uris); } catch (e) {}
    /* Noejagtig strengsammenligning - ingen praefiks, ingen wildcards. */
    if (!registrerede.includes(redirect)) {
      return { fejl: 'Den returadresse er ikke registreret for denne klient.' };
    }
    if (q.get('response_type') !== 'code') return { fejl: 'Kun response_type=code understøttes.', redirect };
    if (q.get('code_challenge_method') !== 'S256') return { fejl: 'PKCE med S256 er påkrævet.', redirect };
    const udfordring = q.get('code_challenge') || '';
    if (udfordring.length < 43) return { fejl: 'Der mangler et gyldigt code_challenge.', redirect };

    const scope = SCOPES.includes(q.get('scope')) ? q.get('scope') : 'full';
    return { klient, redirect, udfordring, scope, state: q.get('state') || '' };
  }

  /** Brugeren har sagt ja - lav koden og send ham tilbage. */
  function giveTilladelse(oplysninger, userId) {
    const kode = crypto.randomBytes(32).toString('base64url');
    koder.set(kode, {
      clientId: oplysninger.klient.id,
      redirect: oplysninger.redirect,
      udfordring: oplysninger.udfordring,
      scope: oplysninger.scope,
      userId,
      udloeber: Date.now() + KODE_LEVETID * 1000
    });
    if (koder.size > 100) {
      for (const [k, v] of koder) if (v.udloeber < Date.now()) koder.delete(k);
    }
    const url = new URL(oplysninger.redirect);
    url.searchParams.set('code', kode);
    if (oplysninger.state) url.searchParams.set('state', oplysninger.state);
    return url.toString();
  }

  /* ------------------------------------------------------------------ token */

  function byttKode(krop) {
    const kode = koder.get(krop.code);
    koder.delete(krop.code);                       // engangsbrug, altid
    if (!kode || kode.udloeber < Date.now()) return { fejl: 'invalid_grant' };
    /* Koden er bundet til BAADE klient og redirect - en stjaalet kode kan ikke
     * byttes fra et andet sted. */
    if (kode.clientId !== krop.client_id) return { fejl: 'invalid_grant' };
    if (kode.redirect !== krop.redirect_uri) return { fejl: 'invalid_grant' };
    /* PKCE: beviset for, at det er den samme klient, der bad om koden. */
    if (b64u(sha256(String(krop.code_verifier || ''))) !== kode.udfordring) {
      return { fejl: 'invalid_grant' };
    }
    return srv.udstedTokens(kode.clientId, kode.scope, kode.userId);
  }

  function forny(krop) {
    const r = srv.findRefresh(krop.refresh_token);
    if (!r) return { fejl: 'invalid_grant' };
    if (r.client_id !== krop.client_id) return { fejl: 'invalid_grant' };
    /* Roterende refresh: den gamle doer i samme oejeblik den nye foedes, saa en
     * stjaalet kopi kun kan bruges én gang - og det opdages. */
    srv.tilbagekaldRefresh(krop.refresh_token);
    return srv.udstedTokens(r.client_id, r.scope, r.user_id);
  }

  return {
    base, SCOPES, ADGANG_LEVETID,
    beskyttetRessource, serverMetadata, registrer,
    tjekAutorisation, giveTilladelse, byttKode, forny
  };
}

module.exports = { opret };
