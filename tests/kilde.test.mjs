/* Proever af app/kilde.js' require-kontrol. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const kilde = require('../app/kilde.js');
const midlertidig = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kilde-'));
/* et minimalt trae, som tjekTrae() godkender - uden server.js' egne requires */
function byggTrae(rod, version) {
  const app = path.join(rod, 'app');
  for (const f of ['server.js', 'oauth.js', 'mcp.js', 'kilde.js', 'public/app.js']) {
    fs.mkdirSync(path.dirname(path.join(app, f)), { recursive: true });
    fs.writeFileSync(path.join(app, f), '// test\n');
  }
  fs.writeFileSync(path.join(app, 'public', 'index.html'), '<script src="/app.js?v=' + version + '"></script>');
  return app;
}

/* ------------------------------------------------ require-kaeden (2026-09-16) */

test('et modul, serveren require\'r, men som mangler i traeet, afvises', () => {
  // Den haandskrevne liste i tjekTrae() naevnte ikke klientip.js - saa blev en
  // hentning uden den godkendt, og serveren doede ved hver genstart.
  const rod = midlertidig();
  const app = byggTrae(rod, 9);
  fs.writeFileSync(path.join(app, 'server.js'), "const { klientIp } = require('./klientip');\n");
  assert.throws(() => kilde.tjekRequires(app), /mangler klientip\.js \(kraevet af server\.js\)/);
  fs.writeFileSync(path.join(app, 'klientip.js'), '// findes\n');
  assert.doesNotThrow(() => kilde.tjekRequires(app));
  fs.rmSync(rod, { recursive: true, force: true });
});

test('require-kontrollen koerer som en del af tjekTrae()', () => {
  const rod = midlertidig();
  const app = byggTrae(rod, 9);
  fs.writeFileSync(path.join(app, 'server.js'), "require('./findes-ikke');\n");
  assert.throws(() => kilde.tjekTrae(app, 9), /mangler findes-ikke\.js/);
  fs.rmSync(rod, { recursive: true, force: true });
});

test('en require i en KOMMENTAR blokerer ikke en opdatering', () => {
  const rod = midlertidig();
  const app = byggTrae(rod, 9);
  fs.writeFileSync(path.join(app, 'server.js'), "// tidligere: require('./gammel')\n *  require('./ogsaa-gammel')\n");
  assert.doesNotThrow(() => kilde.tjekRequires(app));
  fs.rmSync(rod, { recursive: true, force: true });
});

test('den RIGTIGE app er hel efter kontrollen', () => {
  // Beviset paa, at kontrollen ikke fejler paa sit eget repo.
  assert.doesNotThrow(() => kilde.tjekRequires(new URL('../app', import.meta.url).pathname));
});
