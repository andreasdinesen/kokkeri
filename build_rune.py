#!/usr/bin/env python3
"""Byg kokkeri.yaml - en Yggdrasil Panel-rune, der HENTER appen fra GitHub.

Indtil v29 bar runen hele appen: 107 KB base85-payload i baade install- og
update-scriptet, og hver eneste aendring krachte en ny rune gennem panelet.
Loftet var desuden taet paa (MAX_ARG_STRLEN 131.072 for ét sh -c-argument; vi
laa paa 107.091). Nu henter appen sin egen kode - se app/kilde.js.

Runen skal kun udgives, naar RUNEN aendrer sig. En ny app-udgave er:
    bump APP_VERSION -> python3 build_rune.py -> commit -> push -> git tag vN
og derefter en genstart i panelet (eller »Opdater Kokkeri«).

Samler ogsaa frontenden: app/parts/p*.js -> app/public/app.js.
"""
import glob, re, subprocess, sys
import yaml

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

EJER, REPO = 'andreasdinesen', 'kokkeri'

# --- 1) Saml frontenden af delene ---
parts = sorted(glob.glob('app/parts/p*.js'))
if not parts:
    sys.exit('FEJL: ingen filer i app/parts/')
app_js = '\n'.join(read(p) for p in parts)
with open('app/public/app.js', 'w', encoding='utf-8') as f:
    f.write(app_js)
for f_ in ['app/public/app.js', 'app/server.js', 'app/oauth.js', 'app/mcp.js', 'app/kilde.js']:
    subprocess.run(['node', '--check', f_], check=True)

m = re.search(r'const APP_VERSION = (\d+);', app_js)
if not m:
    sys.exit('FEJL: APP_VERSION ikke fundet i app-delene')
app_version = m.group(1)

# Cache-bust: Cloudflare edge-cacher .js/.css i timevis og ignorerer no-cache.
# Stemplet er samtidig kilde.js' KVITTERING: den afviser en tag, hvis koden
# indeni er stemplet med et andet nummer end taggen lover.
index_html = read('app/public/index.html')
index_html = re.sub(r'(style\.css|app\.js)(\?v=\d+)?', rf'\1?v={app_version}', index_html)
with open('app/public/index.html', 'w', encoding='utf-8') as f:
    f.write(index_html)

sw_js = re.sub(r"const APP_VER = '[^']*';", f"const APP_VER = '{app_version}';", read('app/public/sw.js'))
with open('app/public/sw.js', 'w', encoding='utf-8') as f:
    f.write(sw_js)
if f"const APP_VER = '{app_version}';" not in sw_js:
    sys.exit('FEJL: APP_VER ikke fundet/stemplet i sw.js')

# --- sikkerhedstjek paa kilderne ---
for name in ['app/server.js', 'app/oauth.js', 'app/mcp.js', 'app/kilde.js',
             'app/public/index.html', 'app/public/app.js', 'app/public/style.css', 'app/public/sw.js']:
    txt = read(name)
    hits = set(re.findall(r'\{\{[A-Z_]+\}\}', txt))
    if hits:
        sys.exit(f'FEJL: {name} indeholder skabelon-kollisioner: {hits}')

# --- 2) Startsnoren ---
# Den inline-henter, install-scriptet og update-scriptets ELSE-gren deler.
# Skrives som ÉN linje uden enkeltanfoerselstegn: den staar i en 'single
# quoted' sh-streng.
HENT_KROP = (
    'const https=require("https"),zlib=require("zlib");'
    f'const U="https://codeload.github.com/{EJER}/{REPO}/tar.gz/refs/tags/v{app_version}";'
    'function d(m){console.error("[fejl] "+m);console.error("Adresse: "+U);'
    'console.error("Repoet er offentligt, saa en 404 betyder, at adressen ikke findes - '
    'tjek at taggen er pushet.");process.exit(1);}'
    'function hent(u,n){const h={"user-agent":"kokkeri-installer"};'
    'https.get(u,{headers:h},(r)=>{'
    'if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){'
    'if(n<=0)return d("for mange omdirigeringer");r.resume();'
    'return hent(new URL(r.headers.location,u).toString(),n-1);}'
    'if(r.statusCode!==200)return d("GitHub svarede "+r.statusCode);'
    'const g=zlib.createGunzip();g.on("error",(e)=>d("arkivet kunne ikke pakkes ud: "+e.message));'
    'r.pipe(g).pipe(process.stdout);}).on("error",(e)=>d("kunne ikke naa GitHub: "+e.message));}'
    'hent(U,3);')
assert "'" not in HENT_KROP, 'startsnoren maa ikke indeholde enkeltanfoerselstegn'

def startsnor(indryk=0):
    """Henter og BYTTER app/ ind. Ingen /tmp: begge flytninger er rename inden
    for samme filsystem. Den gamle app flyttes til side frem for at blive
    slettet, saa startup kan saette den tilbage, hvis vi doer mellem dem."""
    p = ' ' * indryk
    return '\n'.join(p + l for l in f"""echo "Henter app-koden fra GitHub (v{app_version}) ..."
rm -rf .kokkeri-ny .kokkeri-gammel
mkdir -p .kokkeri-ny
node -e '{HENT_KROP}' > .kokkeri-ny/app.tar
tar x -C .kokkeri-ny -f .kokkeri-ny/app.tar
rm -f .kokkeri-ny/app.tar
# Mappenavnet i et GitHub-arkiv er <repo>-<ref uden v>, og arkivet begynder med
# en pax_global_header-post. Ingen af delene gaettes: find den app-mappe, der FINDES.
NY=$(find .kokkeri-ny -maxdepth 2 -type d -name app | head -n 1)
if [ -z "$NY" ] || [ ! -f "$NY/server.js" ]; then
  echo "[fejl] arkivet fra GitHub indeholder ingen app/server.js"
  exit 1
fi
if [ -d app ]; then mv app .kokkeri-gammel; fi
mv "$NY" app
rm -rf .kokkeri-ny .kokkeri-gammel""".split('\n'))

install_script = f"""set -eu
echo "Installerer Kokkeri (startsnor v{app_version}) ..."
echo "Node: $(node --version)"

{startsnor()}

echo "Filer udpakket:"
ls -1 app app/public
echo "Klar. Start serveren i panelet - den henter selv nyeste udgave"
echo "(eller den, KODE_VERSION laaser til), foer den starter."
"""

# update-knappen. Rakkefoelgen er ikke tilfaeldig (tovos fejl, meldt af Sagu v48):
# kilde.js-grenen skal ligge FOERST. Laa startsnoren foerst og ubetinget, ville
# hvert tryk paa knappen NEDGRADERE til startsnorens tag og derefter hente frem
# igen - og slog nettet fejl i andet trin, blev appen liggende paa den gamle
# udgave, stille.
opdater_script = f"""set -eu
echo "Opdaterer Kokkeri ..."
echo "Node: $(node --version)"

if ! mkdir .kokkeri-laas 2>/dev/null; then
  echo "[fejl] en anden opdatering er allerede i gang."
  echo "Vent til den er faerdig, eller genstart Kokkeri og proev igen."
  exit 1
fi
trap 'rm -rf .kokkeri-laas .kokkeri-ny' EXIT INT TERM

if [ -f app/kilde.js ]; then
  echo "Appen henter selv sin kode - henter nyeste (eller KODE_VERSION) ..."
  node app/kilde.js
else
{startsnor(2)}
fi

echo ""
echo "============================================"
echo "  GENSTART KOKKERI NU."
echo "  Filerne er skiftet ud, men serveren koerer"
echo "  stadig den gamle kode, indtil den genstartes."
echo "============================================"
"""

# En genstart ER opdateringen: kilde.js koerer FOER serveren. Derfor de to
# oprydninger foerst - efter en afbrudt udskiftning og efter en strandet laas,
# som trap ikke naaede at frigive ved et haardt drab.
startup_command = """if [ ! -f app/server.js ] && [ -f .kokkeri-gammel/server.js ]; then
  rm -rf app
  mv .kokkeri-gammel app
  echo "[kode] app/ sat tilbage efter en afbrudt udskiftning"
fi
if [ -d .kokkeri-laas ]; then
  rm -rf .kokkeri-laas .kokkeri-ny
  echo "[kode] en strandet opdateringslaas er ryddet"
fi
node app/kilde.js || echo "[kode] advarsel: opdateringen kunne ikke koeres"
if node -e "require('node:sqlite')" >/dev/null 2>&1; then
  exec node app/server.js
else
  exec node --experimental-sqlite app/server.js
fi
"""

def indent(text, spaces):
    pad = ' ' * spaces
    return '\n'.join(pad + line if line.strip() else '' for line in text.split('\n'))

rune = f"""# Kokkeri - opskrifts-bibliotek, madplan og indkoebsliste som Yggdrasil-rune
# Runen BAERER IKKE koden: install-scriptet henter tag v{app_version} fra GitHub, og
# app/kilde.js henter selv nyeste udgave ved hver opstart. Runen skal derfor kun
# udgives igen, naar selve runen aendrer sig - ikke ved hver app-udgave.
gameskill:
  id: kokkeri
  name: "Kokkeri"
  category: "Apps"
  description: "Opskrifts-bibliotek a la Paprika: importer opskrifter fra URL'er (siden laeses automatisk), uge-madplan med iCal-abonnement, indkoebslister fra opskrifter, koekkentimere, kogetilstand der holder skaermen taendt, MCP-connector til Claude og valgfri AI-assistent. Flere brugere, passkey-login. Egen SQLite-database - ingen eksterne afhaengigheder."
  author: "andreas"
  version: {app_version}
  icon: "app"

  docker:
    # Templated, saa Node-versionen er et felt i panelet: kommer der en CVE i
    # Node, kan man skifte image og trykke "Opdater app" - uden ny udgivelse.
    image: "{{{{NODE_IMAGE}}}}"

  variables:
    - key: APP_NAME
      name: "Appens navn"
      type: string
      default: "Kokkeri"
    - key: NODE_IMAGE
      name: "Node-image"
      type: string
      default: "node:24-alpine"
      pattern: '^node:[0-9][A-Za-z0-9._-]*$'
      hint: "Skal vaere et node:-image, fx node:24-alpine eller node:24.9.0-alpine"
    - key: KODE_VERSION
      name: "Kodeversion"
      type: string
      default: "seneste"
      hint: "»seneste« henter nyeste udgivne vN. Skriv et tal (fx 30) for at laase til praecis den udgave - vejen tilbage, naar en udgivelse er daarlig."

  install:
    image: "{{{{NODE_IMAGE}}}}"
    script: |
{indent(install_script.rstrip(), 6)}

  # Egen knap i panelet. En genstart goer det samme; knappen er til, naar man
  # vil hente uden at genstarte foerst.
  update:
    image: "{{{{NODE_IMAGE}}}}"
    label: "Opdater Kokkeri"
    script: |
{indent(opdater_script.rstrip(), 6)}

  startup:
    # node:sqlite er stabilt i Node 24; fallback-flaget daekker aeldre images.
    command: |
{indent(startup_command.rstrip(), 6)}
    done_regex: 'Kokkeri lytter'
    stop_timeout: 30

  ports:
    - {{ name: web, default: 3000, protocol: tcp }}

  watchers:
    - name: "Serverfejl i Kokkeri"
      pattern: "\\\\[fejl\\\\]"
      threshold: 5
      window_secs: 300

  backup:
    include: []

  wipe:
    backup_first: true
    paths:
      - "kokkeri.db"
      - "kokkeri.db-wal"
      - "kokkeri.db-shm"
"""

with open('runes/kokkeri.yaml', 'w', encoding='utf-8') as f:
    f.write(rune)

# ---------------- validering ----------------
g = yaml.safe_load(rune)['gameskill']
assert g['id'] == 'kokkeri' and g['docker']['image'] == '{{NODE_IMAGE}}'
assert g['ports'][0]['name'] == 'web' and g['ports'][0]['protocol'] == 'tcp'
assert {v['key'] for v in g['variables']} >= {'APP_NAME', 'NODE_IMAGE', 'KODE_VERSION'}

_i, _u, _s = g['install']['script'], g['update']['script'], g['startup']['command']

def _foer(tekst, a, b, hvorfor):
    """Raekkefoelge-assertion. BEVIS FOERST at begge led findes: str.find giver
    -1, og -1 er mindre end alt - en naiv find(a) < find(b) ville bestaa netop
    den dag, det ene led var forsvundet (Sagu v48)."""
    ia, ib = tekst.find(a), tekst.find(b)
    assert ia >= 0, f'FEJL: mangler {a!r} - {hvorfor}'
    assert ib >= 0, f'FEJL: mangler {b!r} - {hvorfor}'
    assert ia < ib, f'FEJL: {a!r} skal staa foer {b!r} - {hvorfor}'

# Startsnoren peger paa DENNE version, og taggen skal findes efter push.
assert f'refs/tags/v{app_version}' in _i, 'FEJL: install henter ikke denne version'
# Hovedvejen FOERST. Laa startsnoren foerst, ville hvert tryk nedgradere (tovo).
_foer(_u, '[ -f app/kilde.js ]', 'refs/tags/', 'kilde.js-grenen skal ligge foer startsnoren')
# Laasen om HELE update-scriptet, foer noget kan aendres.
_foer(_u, 'mkdir .kokkeri-laas', '[ -f app/kilde.js ]', 'laasen skal tages foer forgreningen')
_foer(_u, "trap 'rm -rf .kokkeri-laas", '[ -f app/kilde.js ]', 'trap skal sidde, foer noget kan fejle')
# BYT, slet ikke - i BEGGE scripts.
for navn, txt in [('install', _i), ('update', _u)]:
    assert 'rm -rf app' not in txt, f'FEJL: {navn} maa ikke slette app/ - flyt den til side'
    assert '/tmp' not in txt, f'FEJL: {navn} maa ikke bruge /tmp - mv over to filsystemer er en kopi'
    _foer(txt, 'mv app .kokkeri-gammel', 'mv "$NY" app', f'{navn}: gammel app flyttes til side foer byttet')
    assert '$NY/server.js' in txt, f'FEJL: {navn} tjekker ikke arkivet, foer den bytter'
# Genstart-beskeden er den eneste vagt mod, at app-update ikke genstarter serveren.
assert 'GENSTART KOKKERI NU' in _u
assert _u.rstrip().endswith('============================================"'), (
    'FEJL: genstart-beskeden skal staa SIDST - ellers drukner den i udpakningens output')
# En genstart ER opdateringen, og redningen skal koere foer serveren.
_foer(_s, '.kokkeri-gammel', 'node app/kilde.js', 'redningen skal koere foer opdateringen')
_foer(_s, '.kokkeri-laas', 'node app/kilde.js', 'laasen ryddes foer opdateringen')
_foer(_s, 'node app/kilde.js', 'exec node app/server.js', 'koden hentes foer serveren starter')

print(f'install-script: {len(_i)} tegn (var 107.091 med indlejret payload)')
print(f'update-script:  {len(_u)} tegn')
size = len(rune.encode())
print(f'kokkeri.yaml OK - {size} bytes ({size/1024:.1f} KB, var 225 KB)')
print(f'\nHUSK efter push:  git tag v{app_version} && git push origin v{app_version}')
print('Uden taggen kan hverken install eller kilde.js hente koden.')
