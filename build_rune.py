#!/usr/bin/env python3
"""Byg kokkeri.yaml - en Yggdrasil Panel-rune der indlejrer hele appen.

Samler ogsaa frontenden: app/parts/p*.js -> app/public/app.js.
"""
import base64, glob, re, subprocess, sys

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
index_html = read('app/public/index.html')
style_css = read('app/public/style.css')

m = re.search(r'const APP_VERSION = (\d+);', app_js)
if not m:
    sys.exit('FEJL: APP_VERSION ikke fundet i app-delene')
app_version = m.group(1)

# --- sikkerhedstjek ---
for name, txt in [('server.js', server_js), ('index.html', index_html), ('app.js', app_js), ('style.css', style_css)]:
    hits = set(re.findall(r'\{\{[A-Z_]+\}\}', txt))
    if hits:
        sys.exit(f'FEJL: {name} indeholder skabelon-kollisioner: {hits}')
    if 'YGG_PAYLOAD_EOF' in txt:
        sys.exit(f'FEJL: {name} indeholder heredoc-markøren YGG_PAYLOAD_EOF')

def b64_wrap(s, width=100):
    return '\n'.join(s[i:i+width] for i in range(0, len(s), width))

# App-filerne pakkes som gzippet tar (base64) - panelet koerer install-scriptet som ETT
# sh -c-argument, og Linux' MAX_ARG_STRLEN (~128 KiB) saetter loftet.
import io, tarfile, gzip
FILES = ['app/server.js', 'app/public/index.html', 'app/public/style.css',
         'app/public/app.js', 'app/public/icon-192.png', 'app/public/icon-512.png']
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w') as tar:
    for path in FILES:
        info = tarfile.TarInfo(path)
        data = open(path, 'rb').read()
        info.size = len(data)
        info.mtime = 0
        tar.addfile(info, io.BytesIO(data))
payload = base64.b64encode(gzip.compress(buf.getvalue(), 9, mtime=0)).decode()

install_script = f"""set -eu
echo "Installerer Kokkeri v{app_version} ..."

# App-filerne ligger som gzippet tar-arkiv (base64) - se build_rune.py
base64 -d <<'YGG_PAYLOAD_EOF' | gunzip | tar x
{b64_wrap(payload)}
YGG_PAYLOAD_EOF

echo "Node: $(node --version)"
echo "Kokkeri v{app_version} er installeret."
"""

assert len(install_script) < 110_000, (
    f'FEJL: install-scriptet er {len(install_script)} tegn - taet paa/over sh -c-graensen (~128 KiB).')

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
    image: "node:24-alpine"

  variables:
    - key: APP_NAME
      name: "Appens navn"
      type: string
      default: "Kokkeri"

  install:
    image: "node:24-alpine"
    script: |
{indent(install_script.rstrip(), 6)}

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
_m = re.search(r"\| gunzip \| tar x\n(.*?)\nYGG_PAYLOAD_EOF", script, re.S)
_tar = tarfile.open(fileobj=io.BytesIO(gzip.decompress(base64.b64decode(_m.group(1)))))
for _p in FILES:
    assert _tar.extractfile(_p).read() == open(_p, 'rb').read(), f'payload afviger for {_p}'
assert "require('node:sqlite')" in g['startup']['command']
print(f'install-script: {len(script)} tegn (sh -c-graense ~131072); payload verificeret byte-identisk')
size = len(rune.encode())
print(f'kokkeri.yaml OK - {size} bytes ({size/1024:.0f} KB af max 512 KB)')
assert size < 512 * 1024, 'for stor!'
