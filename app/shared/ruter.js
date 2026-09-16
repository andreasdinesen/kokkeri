/* Adresser til siderne - én liste, tre brugere (RUNE-ERFARINGER 9g).
 *
 * Browseren skriver stien i adresselinjen, saa /opskrift/<id> kan deles og
 * bogmaerkes. SERVEREN svarer med index.html paa praecis de samme stier, og
 * SERVICE WORKEREN giver app-skallen paa dem, naar nettet er vaek. Tre lister
 * ville skride fra hinanden ved den foerste nye side - saa den bor her.
 *
 * Kun de kendte stier peger paa appen. En catch-all ville ogsaa svare paa
 * /app.jsx og /styl.css med HTML - og i service workeren ville den give
 * app-skallen paa /del/<token> og /api/backup, naar nettet var vaek.
 *
 * Filen koerer tre steder: build_rune.py laegger den forrest i app.js,
 * serveren require'r den, og sw.js henter den med importScripts. Den maa
 * derfor ikke roere hverken window, document eller require.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.kokkeriRuter = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  /* [side-id, adresse, andre stavemaader der ogsaa skal virke] */
  const SIDER = [
    ['dash',      'overblik',      ['dash', 'forside', 'start']],
    ['recipes',   'opskrifter',    ['recipes', 'opskrift']],
    ['plan',      'madplan',       ['plan', 'mealplan', 'madplaner']],
    ['shopping',  'indkoebsliste', ['shopping', 'indkoeb', 'forraad', 'spisekammer']],
    ['timers',    'timere',        ['timers', 'timer']],
    ['assistant', 'assistent',     ['assistant', 'ai', 'ai-assistent']],
    ['settings',  'indstillinger', ['settings']]
  ];

  /* Undersider: /opskrift/<id> og /indstillinger/<fane>. Opskriften har sin
   * egen adresse, fordi det er DEN, man deler med sig selv og bogmaerker.
   * Fanerne staar ogsaa i SETTINGS_FANER (p9_settings.js) - tests/ruter
   * holder de to lister i trit. */
  const OPSKRIFT = 'opskrift';
  const FANER = ['app', 'integrationer', 'data', 'konto', 'brugere'];
  /* samme form som serverens item-id (server.js: cleanItem) */
  const ID_RE = /^[0-9a-zA-Z-]{6,64}$/;

  /* Stien skrives i haanden ved koekkenbordet, saa baade /Indkøbsliste og
   * /indkoebsliste/ skal ramme. æøå foldes til ae/oe/aa - samme translit
   * som adresserne selv er skrevet i. */
  function afkod(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; /* ugyldig %-kode: brug raa */ }
  }
  function fold(s) {
    return afkod(String(s || '')).toLowerCase()
      .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa');
  }

  const OPSLAG = {};
  for (const [id, sti, alias] of SIDER) {
    OPSLAG[fold(sti)] = id;
    for (const a of alias || []) OPSLAG[fold(a)] = id;
  }

  /* Sti -> { side, arg } eller null (serveren 404'er).
   * Kun FOERSTE led foldes: et opskrift-id skelner store og smaa bogstaver. */
  function ruteForSti(sti) {
    const led = String(sti || '').split('/').filter(Boolean);
    if (!led.length) return { side: 'dash', arg: null };
    if (led.length === 1 && fold(led[0]) === 'index.html') return { side: 'dash', arg: null };
    const foerste = fold(led[0]);
    if (led.length === 1) {
      const side = OPSLAG[foerste];
      return side ? { side, arg: null } : null;
    }
    if (led.length !== 2) return null;
    if (foerste === OPSKRIFT || foerste === 'recipe') {
      const id = afkod(led[1]);
      return ID_RE.test(id) ? { side: 'recipeDetail', arg: id } : null;
    }
    if (OPSLAG[foerste] === 'settings') {
      const fane = fold(led[1]);
      return FANER.includes(fane) ? { side: 'settings', arg: fane } : null;
    }
    return null;
  }

  function sideForSti(sti) {
    const r = ruteForSti(sti);
    return r ? r.side : null;
  }

  /* Side (+ opskrift-id eller fane) -> sti. Ukendt -> null. */
  function stiForSide(side, arg) {
    if (side === 'recipeDetail') {
      return ID_RE.test(String(arg || '')) ? '/' + OPSKRIFT + '/' + encodeURIComponent(arg) : null;
    }
    for (const [id, sti] of SIDER) {
      if (id !== side) continue;
      if (side === 'settings' && FANER.includes(arg)) return '/' + sti + '/' + arg;
      return '/' + sti;
    }
    return null;
  }

  return { SIDER, FANER, ruteForSti, sideForSti, stiForSide };
}));
