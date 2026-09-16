/* Indstillingernes faner (RUNE-ERFARINGER 9f).
 *
 * Opdelingen flyttede ti afsnit rundt i én stor skabelon, og en blok, der
 * ryger ved et uheld, ser ud som ingenting. Derfor:
 *  - skabelonen hentes UD AF KILDEN (app/parts/p9_settings.js) og tegnes
 *  - alle ti afsnit skal vaere der (for en admin), og hvert af dem skal staa
 *    inde i en fane, der har en knap
 *  - hvert id, settings_bind() slaar op, skal findes i det tegnede - ogsaa
 *    dem i faner, der er skjulte. ALT tegnes, ét vises.
 *
 *   node tests/faner.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROD = path.resolve(import.meta.dirname, '..');
const KILDE = fs.readFileSync(path.join(ROD, 'app/parts/p9_settings.js'), 'utf8');
let ok = 0, fejl = 0;
const proev = (navn, fn) => {
  try { fn(); console.log('  ok   ' + navn); ok++; }
  catch (e) { console.log('  FEJL ' + navn + '\n       ' + e.message); fejl++; }
};
const skal = (v, f, hvad) => { if (v !== f) throw new Error(`${hvad}: fik ${JSON.stringify(v)}, ventede ${JSON.stringify(f)}`); };

/* `start` ... til den klamme, der lukker den foerste `{` efter start */
function udsnit(start) {
  const i0 = KILDE.indexOf(start);
  if (i0 < 0) throw new Error('findes ikke: ' + start);
  let d = 0;
  for (let j = KILDE.indexOf('{', i0); j < KILDE.length; j++) {
    if (KILDE[j] === '{') d++;
    else if (KILDE[j] === '}' && --d === 0) return KILDE.slice(i0, j + 1);
  }
  throw new Error('klammerne gaar ikke op: ' + start);
}
const faneKonst = KILDE.slice(KILDE.indexOf('const SETTINGS_FANER'), KILDE.indexOf('];', KILDE.indexOf('const SETTINGS_FANER')) + 2);
const SKABELON = udsnit('RENDER.settings = () =>');
const BIND = udsnit('RENDER.settings_bind = () =>');

function tegn(admin) {
  const ctx = {
    RENDER: {},
    S: {
      me: { username: 'proeve', isAdmin: admin, passkeys: [{ id: 'pk1', label: 'Mac', created: '2026-09-16' }] },
      settings: { logo: 'data:,', aiKeySet: true, aiProvider: 'claude', aiModel: '', haSet: true, todoistSet: true, icalToken: 't' }
    },
    app: () => ({ appTitle: 'Kokkeri', defaultServings: 4, timerPresets: [5], categories: ['Suppe'] }),
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'),
    pageHead: t => `<h1>${t}</h1>`,
    fmtDate: s => s,
    location: { origin: 'https://kokkeri.eksempel.invalid' }
  };
  vm.createContext(ctx);
  vm.runInContext(faneKonst + '\n' + SKABELON + ';\nthis.SETTINGS_FANER = SETTINGS_FANER;', ctx);
  return { html: ctx.RENDER.settings(), FANER: ctx.SETTINGS_FANER };
}

/* Gaar html'en igennem med en div-stak og noterer, hvilken fane hvert
 * <h2> og hvert id staar i. */
function kort(html) {
  const stak = [], afsnit = [], ider = new Map();
  const re = /<(\/?)div\b([^>]*)>|<h2[^>]*>(.*?)<\/h2>|\bid="([^"]+)"/g;
  let m;
  const fane = () => { for (let i = stak.length - 1; i >= 0; i--) if (stak[i]) return stak[i]; return null; };
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<div') || m[0].startsWith('</div')) {
      if (m[1]) stak.pop();
      else {
        const f = /class="fane" data-fane="([^"]+)"/.exec(m[2]);
        stak.push(f ? f[1] : null);
        const id = /\bid="([^"]+)"/.exec(m[2]);     // <div id=...> i selve div-taggen
        if (id) ider.set(id[1], fane());
      }
    } else if (m[3] !== undefined) afsnit.push({ navn: m[3], fane: fane() });
    else ider.set(m[4], fane());
  }
  if (stak.length) throw new Error('div-stakken gaar ikke op: ' + stak.length);
  return { afsnit, ider };
}

/* Afsnittene, som de var foer opdelingen (v34) - alle ti. */
const ALLE = ['App', '✨ AI-assistent', '🏠 Home Assistant', '✅ Todoist', '📅 Madplan i din kalender',
  'Backup & import', '🗑️ Ryd data', 'Min konto', 'Claude-adgang (MCP)', 'Brugere (admin)'];
const KUN_ADMIN = ['🗑️ Ryd data', 'Brugere (admin)'];

console.log('Indstillinger: faner');

for (const admin of [true, false]) {
  const { html, FANER } = tegn(admin);
  const { afsnit, ider } = kort(html);
  const hvem = admin ? 'admin' : 'bruger';
  const knapper = [...html.matchAll(/class="fanebtn"[^>]*data-fane="([^"]+)"/g)].map(m => m[1]);
  const faner = [...html.matchAll(/class="fane" data-fane="([^"]+)"/g)].map(m => m[1]);

  proev(`${hvem}: alle afsnit er der - intet faldt ud`, () => {
    const vent = ALLE.filter(n => admin || !KUN_ADMIN.includes(n));
    skal(afsnit.map(a => a.navn).sort().join(' | '), vent.sort().join(' | '), 'afsnit');
  });
  proev(`${hvem}: hvert afsnit staar i en fane`, () => {
    const loese = afsnit.filter(a => !a.fane).map(a => a.navn);
    if (loese.length) throw new Error('uden for en fane: ' + loese.join(', '));
  });
  proev(`${hvem}: knapperne og fanerne svarer til hinanden - ingen tom fane`, () => {
    skal(knapper.join(), faner.join(), 'knapper mod faner');
    for (const f of faner) if (!afsnit.some(a => a.fane === f)) throw new Error('tom fane: ' + f);
    skal(new Set(faner).size, faner.length, 'dubletter');
    const forventet = FANER.filter(f => admin || !f[2]).map(f => f[0]);
    skal(faner.join(), forventet.join(), 'SETTINGS_FANER');
  });
  proev(`${hvem}: den foerste fane er en, alle har (faldet tilbage for ikke-admin)`, () => {
    if (FANER[0][2]) throw new Error('den foerste fane er kun for admin');
  });
  if (admin) proev('admin: hvert id, settings_bind() slaar op, findes - ogsaa i de skjulte faner', () => {
    const brugt = [...new Set([...BIND.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]))];
    if (brugt.length < 25) throw new Error('fandt kun ' + brugt.length + ' bindinger - er udtraekket forkert?');
    const mangler = brugt.filter(id => !ider.has(id));
    if (mangler.length) throw new Error('mangler: ' + mangler.join(', '));
    const iFaner = new Set(brugt.map(id => ider.get(id)));
    if (iFaner.size < 4) throw new Error('bindingerne ligger kun i ' + [...iFaner].join(', '));
  });
}

proev('settings_bind() kalder faneskiftet', () => {
  if (!/bindSettingsFaner\(\)/.test(BIND)) throw new Error('bindSettingsFaner() kaldes ikke');
});

console.log(`\n${ok} ok, ${fejl} fejl`);
process.exit(fejl ? 1 : 0);
