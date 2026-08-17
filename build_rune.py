#!/usr/bin/env python3
"""Byg kokkeri.yaml - en Yggdrasil Panel-rune der indlejrer hele appen.

Samler ogsaa frontenden: app/parts/p*.js -> app/public/app.js.
"""
import glob, re, subprocess, sys

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

# --- 1) Saml frontenden af delene ---
parts = sorted(glob.glob('app/parts/p*.js'))
if not parts:
    sys.exit('FEJL: ingen filer i app/parts/')
app_js = '\n'.join(read(p) for p in parts)
with open('app/public/app.js', 'w', encoding='utf-8') as f:
    f.write(app_js)
subprocess.run(['node', '--check', 'app/public/app.js'], check=True)

server_js = read('app/server.js')
oauth_js = read('app/oauth.js')
mcp_js = read('app/mcp.js')
style_css = read('app/public/style.css')

m = re.search(r'const APP_VERSION = (\d+);', app_js)
if not m:
    sys.exit('FEJL: APP_VERSION ikke fundet i app-delene')
app_version = m.group(1)

# Cache-bust: Cloudflare edge-cacher .js/.css i timevis og ignorerer no-cache.
# Versionerede URL'er giver hver release sin egen cache-noegle, saa opdateringer
# slaar igennem med det samme (serveren sender HTML som no-store).
index_html = read('app/public/index.html')
index_html = re.sub(r'(style\.css|app\.js)(\?v=\d+)?', rf'\1?v={app_version}', index_html)
with open('app/public/index.html', 'w', encoding='utf-8') as f:
    f.write(index_html)

# Service workeren skal have samme version: cache-navnet bumpes (saa gamle filer
# ryddes ved aktivering) og precachen peger paa de versionerede URL'er.
sw_js = read('app/public/sw.js')
sw_js = re.sub(r"const APP_VER = '[^']*';", f"const APP_VER = '{app_version}';", sw_js)
with open('app/public/sw.js', 'w', encoding='utf-8') as f:
    f.write(sw_js)
if f"const APP_VER = '{app_version}';" not in sw_js:
    sys.exit('FEJL: APP_VER ikke fundet/stemplet i sw.js')

# --- sikkerhedstjek ---
for name, txt in [('server.js', server_js), ('oauth.js', oauth_js), ('mcp.js', mcp_js),
                  ('index.html', index_html), ('app.js', app_js),
                  ('style.css', style_css), ('sw.js', sw_js)]:
    hits = set(re.findall(r'\{\{[A-Z_]+\}\}', txt))
    if hits:
        sys.exit(f'FEJL: {name} indeholder skabelon-kollisioner: {hits}')
    if 'YGG_PAYLOAD_EOF' in txt:
        sys.exit(f'FEJL: {name} indeholder heredoc-markøren YGG_PAYLOAD_EOF')

def wrap(s, width=100):
    return '\n'.join(s[i:i+width] for i in range(0, len(s), width))

# App-filerne pakkes som brotli-komprimeret tar i base85 - panelet koerer
# install-scriptet som ETT sh -c-argument, og Linux' MAX_ARG_STRLEN (131072 b)
# saetter loftet.
#
# Hvorfor ikke gzip+base64 (som foer v18)? Begge led var dyrere:
#   gzip -9 80298 b -> base64 107064 tegn   |   brotli q11 66498 b -> base85 83123 tegn
# Brotli koeres af node (som allerede er en byggeafhaengighed), og install-imaget
# ER node:24-alpine, saa `node -e` kan dekode. base85 pakker 4 bytes i 5 tegn mod
# base64's 4 - alfabetet er de printbare ASCII-tegn UDEN { } og \, saa payloaden
# aldrig kan ligne panelets {{VARIABEL}}-skabeloner eller trigge escaping.
#
# Filerne TRIMMES foerst (kommentarer, indrykning, tomme linjer). Kilderne paa
# disk beholder alt - det er kun payloaden der slankes, saa repoet stadig er
# laesbart. Derfor bygges tar'en fra strenge i memory, ikke fra disk.
import io, tarfile, tempfile, os
import trim

B85_ALFABET = ''.join(chr(c) for c in range(33, 127) if c not in (123, 125, 92))[:85]

def b85_encode(data):
    ud = []
    for i in range(0, len(data) - len(data) % 4, 4):
        v = int.from_bytes(data[i:i+4], 'big')
        cifre = []
        for _ in range(5):
            cifre.append(B85_ALFABET[v % 85]); v //= 85
        ud.append(''.join(reversed(cifre)))
    rest = len(data) % 4
    if rest:                       # nul-polstret sidste gruppe, afkortet til rest+1 tegn
        v = int.from_bytes(data[-rest:] + b'\0' * (4 - rest), 'big')
        cifre = []
        for _ in range(5):
            cifre.append(B85_ALFABET[v % 85]); v //= 85
        ud.append(''.join(reversed(cifre))[:rest + 1])
    return ''.join(ud)

# Dekoderen der koeres af `node -e '...'` i install-scriptet: laeser payloaden fra
# stdin, base85-dekoder, brotli-udpakker og skriver tar'en til stdout.
# MAA IKKE indeholde enkeltanfoerselstegn (den staar i en 'single quoted' sh-streng).
B85_DEKODER = (
    'const A=[];for(let c=33;c<127;c++)if(c!==123&&c!==125&&c!==92)A.push(c);'
    'const M=new Int16Array(128).fill(-1);for(let i=0;i<85;i++)M[A[i]]=i;'
    'const s=require("fs").readFileSync(0,"utf8").replace(/\\s+/g,"");'
    'const h=s.length/5|0,r=s.length%5,o=Buffer.alloc(h*4+(r?r-1:0));let q=0;'
    'for(let i=0;i<h;i++){let v=0;for(let j=0;j<5;j++)v=v*85+M[s.charCodeAt(q++)];o.writeUInt32BE(v>>>0,i*4);}'
    'if(r){let v=0;for(let j=0;j<5;j++)v=v*85+(j<r?M[s.charCodeAt(q+j)]:84);'
    'const b=Buffer.alloc(4);b.writeUInt32BE(v>>>0);b.copy(o,h*4,0,r-1);}'
    'process.stdout.write(require("zlib").brotliDecompressSync(o));')
assert "'" not in B85_DEKODER

def node_brotli(raa):
    """Brotli-komprimer via node - Python har det ikke i standardbiblioteket."""
    ind = tempfile.NamedTemporaryFile('wb', delete=False); ind.write(raa); ind.close()
    ud = tempfile.NamedTemporaryFile('wb', delete=False); ud.close()
    js = ('const z=require("zlib"),fs=require("fs"),t=fs.readFileSync(process.argv[1]);'
          'fs.writeFileSync(process.argv[2],z.brotliCompressSync(t,{params:{'
          '[z.constants.BROTLI_PARAM_QUALITY]:11,[z.constants.BROTLI_PARAM_LGWIN]:24,'
          '[z.constants.BROTLI_PARAM_SIZE_HINT]:t.length}}));')
    try:
        subprocess.run(['node', '-e', js, ind.name, ud.name], check=True)
        return open(ud.name, 'rb').read()
    finally:
        os.unlink(ind.name); os.unlink(ud.name)

def kør_dekoderen(payload_tekst):
    """Koer PRAECIS den dekoder der ligger i install-scriptet, saa rundturs-tjekket
    beviser at den udgivne dekoder virker - ikke bare at Python kan regne baglaens."""
    p = subprocess.run(['node', '-e', B85_DEKODER], input=payload_tekst.encode(),
                       capture_output=True)
    if p.returncode:
        sys.exit(f'FEJL: dekoderen i install-scriptet fejlede: {p.stderr.decode()[:400]}')
    return p.stdout

FILES = ['app/server.js', 'app/oauth.js', 'app/mcp.js',
         'app/public/index.html', 'app/public/style.css',
         'app/public/app.js', 'app/public/sw.js', 'app/public/icon-192.png', 'app/public/icon-512.png']
TRIMMERE = {'.js': trim.trim_js, '.css': trim.trim_css, '.html': trim.trim_html}

payload_filer = {}
raa_i_alt = trimmet_i_alt = 0
for path in FILES:
    raa = open(path, 'rb').read()
    fn = TRIMMERE.get(os.path.splitext(path)[1])
    data = fn(raa.decode('utf-8')).encode('utf-8') if fn else raa
    payload_filer[path] = data
    raa_i_alt += len(raa)
    trimmet_i_alt += len(data)

# Trimmet JS skal stadig kunne parses - ellers er payloaden ubrugelig
for path in [p for p in FILES if p.endswith('.js')]:
    with tempfile.NamedTemporaryFile('wb', suffix='.js', delete=False) as tf:
        tf.write(payload_filer[path])
        tmp = tf.name
    try:
        subprocess.run(['node', '--check', tmp], check=True)
    except subprocess.CalledProcessError:
        sys.exit(f'FEJL: {path} blev ugyldig JavaScript efter trimning')
    finally:
        os.unlink(tmp)

buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w') as tar:
    for path in FILES:
        info = tarfile.TarInfo(path)
        info.size = len(payload_filer[path])
        info.mtime = 0
        tar.addfile(info, io.BytesIO(payload_filer[path]))
tar_bytes = buf.getvalue()
komprimeret = node_brotli(tar_bytes)
payload = b85_encode(komprimeret)
assert not set(payload) & set('{}\\'), 'payload indeholder tegn der ikke er i alfabetet'

install_script = f"""set -eu
echo "Installerer Kokkeri v{app_version} ..."

# App-filerne ligger som brotli-komprimeret tar i base85 - se build_rune.py
node -e '{B85_DEKODER}' <<'YGG_PAYLOAD_EOF' | tar x
{wrap(payload)}
YGG_PAYLOAD_EOF

echo "Node: $(node --version)"
echo "Kokkeri v{app_version} er installeret."
"""

# update:-blokken (panelfunktion, se RUNE-ERFARINGER §9). En selvstaendig
# "Opdater app"-knap: panelet stopper appen, vi smider app/ vaek og pakker
# samme payload ud igen. /data (databasen) roeres IKKE, og skemaet opdaterer
# sig selv ved naeste start. Det er vejen til at skifte app-filerne - eller
# Node-versionen via NODE_IMAGE - uden at geninstallere.
opdater_script = f"""set -eu
echo "Opdaterer Kokkeri til v{app_version} ..."
echo "Node: $(node --version)"
rm -rf app

node -e '{B85_DEKODER}' <<'YGG_PAYLOAD_EOF' | tar x
{wrap(payload)}
YGG_PAYLOAD_EOF

echo "App-filerne er skiftet ud. Databasen i /data er uroert."
"""

# Loftet er Linux' MAX_ARG_STRLEN (131072 b) for ETT sh -c-argument. 120 K giver
# ~11 K margin. Ikonerne fylder kun ~4 K komprimeret - det er app.js der vokser.
# NB: at dele payloaden i to heredocs hjaelper IKKE - hele scriptet er det ene
# argument. Naar dette loft rammes, skal appen selv slankes, eller filer hentes
# efter installationen (kraever netadgang i containeren).
assert len(install_script) < 120_000, (
    f'FEJL: install-scriptet er {len(install_script)} tegn - taet paa MAX_ARG_STRLEN (131072).')

def indent(text, spaces):
    pad = ' ' * spaces
    return '\n'.join(pad + line if line.strip() else '' for line in text.split('\n'))

rune = f"""# Kokkeri - opskrifts-bibliotek, madplan og indkoebsliste som Yggdrasil-rune
# Importerer opskrifter fra URL'er (schema.org/Recipe), uge-madplan med iCal-feed,
# indkoebslister, koekkentimere og valgfri AI-assistent (Claude API).
# Alt (app + SQLite-database) ligger i serverens egen datamappe.
gameskill:
  id: kokkeri
  name: "Kokkeri"
  category: "Apps"
  description: "Opskrifts-bibliotek a la Paprika: importer opskrifter fra URL'er (siden laeses automatisk), uge-madplan med iCal-abonnement, indkoebslister fra opskrifter, koekkentimere, kogetilstand der holder skaermen taendt og valgfri AI-assistent (Claude API-noegle). Flere brugere, passkey-login. Egen SQLite-database - ingen eksterne afhaengigheder."
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

  install:
    image: "{{{{NODE_IMAGE}}}}"
    script: |
{indent(install_script.rstrip(), 6)}

  # Egen knap i panelet: skifter app-filerne uden at geninstallere. /data bliver.
  update:
    image: "{{{{NODE_IMAGE}}}}"
    label: "Opdater Kokkeri"
    script: |
{indent(opdater_script.rstrip(), 6)}

  startup:
    # node:sqlite er stabilt i Node 24; fallback-flaget daekker aeldre images.
    command: |
      if node -e "require('node:sqlite')" >/dev/null 2>&1; then exec node app/server.js; else exec node --experimental-sqlite app/server.js; fi
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

  # Wipe-knappen i panelet toemmer hele databasen (brugere + data) og starter forfra.
  # backup_first sikrer, at der altid ligger en frisk backup foer sletningen.
  wipe:
    paths: ["kokkeri.db", "kokkeri.db-wal", "kokkeri.db-shm"]
    backup_first: true
"""

with open('runes/kokkeri.yaml', 'w', encoding='utf-8') as f:
    f.write(rune)

import yaml
doc = yaml.safe_load(rune)
g = doc['gameskill']
assert g['id'] == 'kokkeri' and g['docker']['image'] and g['startup']['command']
assert g['ports'][0]['name'] == 'web' and g['ports'][0]['protocol'] == 'tcp'
script = g['install']['script']
assert script.count('YGG_PAYLOAD_EOF') == 2
# Rundtur: dekod payloaden fra scriptet og verificer, at filerne er byte-identiske med kilderne
_m = re.search(r"\| tar x\n(.*?)\nYGG_PAYLOAD_EOF", script, re.S)
_tar = tarfile.open(fileobj=io.BytesIO(kør_dekoderen(_m.group(1))))
for _p in FILES:
    assert _tar.extractfile(_p).read() == payload_filer[_p], f'payload afviger for {_p}'
assert "require('node:sqlite')" in g['startup']['command']
# Payloaden staar TO gange i YAML'en (install + update) - verificer begge. En
# opdatering, der pakker noget andet ud end installationen, er svaer at opdage.
_u = g['update']['script']
assert _u.count('YGG_PAYLOAD_EOF') == 2 and 'rm -rf app' in _u
_um = re.search(r"\| tar x\n(.*?)\nYGG_PAYLOAD_EOF", _u, re.S)
_utar = tarfile.open(fileobj=io.BytesIO(kør_dekoderen(_um.group(1))))
for _p in FILES:
    assert _utar.extractfile(_p).read() == payload_filer[_p], f'update-payload afviger for {_p}'
# update maa ALDRIG roere /data - det er hele pointen med knappen
assert '/data' not in _u.replace('Databasen i /data er uroert.', '')
assert g['docker']['image'] == '{{NODE_IMAGE}}' and g['install']['image'] == '{{NODE_IMAGE}}'
print(f'trimning: {raa_i_alt} -> {trimmet_i_alt} b app-filer (sparet {raa_i_alt - trimmet_i_alt} b foer komprimering)')
print(f'payload: tar {len(tar_bytes)} -> brotli {len(komprimeret)} -> base85 {len(payload)} tegn')
print(f'install-script: {len(script)} tegn af 120000 (sh -c-graense 131072); payload verificeret byte-identisk')
size = len(rune.encode())
print(f'kokkeri.yaml OK - {size} bytes ({size/1024:.0f} KB af max 512 KB)')
assert size < 512 * 1024, 'for stor!'
