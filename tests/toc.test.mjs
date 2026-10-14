/* Sideoversigten i hoejre side (v56, RUNE-ERFARINGER §9b): valget af det aktive afsnit
 * er en ren funktion i p2_shell.js - hentet ud af kilden og proevet her. Selve rulningen
 * er proevet i browseren med rigtigt hjulscroll (programmatisk rulning fyrer ikke i
 * browser-panelet - test-quirk 3).
 *
 *   node --test tests/toc.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROD = path.resolve(import.meta.dirname, '..');
const kilde = fs.readFileSync(path.join(ROD, 'app/parts/p2_shell.js'), 'utf8');
function udsnit(start) {
  const i0 = kilde.indexOf(start);
  if (i0 < 0) throw new Error('findes ikke: ' + start);
  let d = 0;
  for (let j = kilde.indexOf('{', i0); j < kilde.length; j++) {
    if (kilde[j] === '{') d++;
    else if (kilde[j] === '}' && --d === 0) return kilde.slice(i0, j + 1);
  }
  throw new Error('klammerne gaar ikke op');
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(udsnit('function aktivtTocAfsnit(') + '\nthis.f = aktivtTocAfsnit;', ctx);
const f = ctx.f;

test('aktivt afsnit: det sidste, der er rullet op over graensen', () => {
  assert.equal(f([], 140, false), -1, 'ingen afsnit');
  assert.equal(f([200, 900, 1600], 140, false), 0, 'oeverst paa siden: det foerste');
  assert.equal(f([-500, 100, 800], 140, false), 1);
  assert.equal(f([-1500, -800, 140], 140, false), 2, 'praecis paa graensen taeller med');
  assert.equal(f([-1500, -800, 141], 140, false), 1);
});
test('aktivt afsnit: i bunden er det sidste aktivt, selv om det er kort', () => {
  assert.equal(f([-900, -200, 400], 140, true), 2);
  assert.equal(f([-900, -200, 400], 140, false), 1);
});
test('TOC_MIN er mindst 3, og graensen er den samme som style.css (900 px)', () => {
  assert.match(kilde, /const TOC_MIN = 3;/);
  const css = fs.readFileSync(path.join(ROD, 'app/public/style.css'), 'utf8');
  assert.match(css, /@media \(max-width: 900px\) \{\n  \.toc \{ display: none !important; \}/);
  assert.match(kilde, /render\(\)[\s\S]*byggToc\(\);\s+\/\/ EFTER optegningen/);
});
