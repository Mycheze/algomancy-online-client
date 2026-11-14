/* 1377 — EVERY PAINT THAT REDRAWS PICTURES GOES THROUGH keepArt (owner, 2026-11-14: "Fix the painter
 * entirely"). Source guards, derived from the tree rather than listed where they can be:
 *
 * §1 paintFrame — the painter of every page after the home — writes #app only inside keepArt
 * §2 the partial patches that redraw pictures: the cube draft's pack band (cubedraft.ts patchBand,
 *    an outerHTML of the band) and the builder's pool results (tabletop.ts paintPool)
 * §3 every OTHER whole-page write of #app in client/ui is either inside keepArt or one of the
 *    known writers below, each with the reason it needs none — and each reason still holds:
 *    the no-picture pages draw no picture, and the board draws no lazy one. A new writer, or a
 *    picture added to a listed page, fails here and says to paint through keepArt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectingHtml, kickedHtml, type ConnectingView } from '../pages/connecting.ts';

const UI = fileURLToPath(new URL('..', import.meta.url));
const code = (f: string): string => readFileSync(join(UI, f), 'utf8');
/** a function's body: from its signature to the first line that closes it */
const body = (src: string, sig: string): string => {
  const at = src.indexOf(sig);
  assert.ok(at >= 0, `${sig} is still there`);
  return src.slice(at, src.indexOf('\n}\n', at));
};

test('1377 §1 paintFrame writes #app only inside keepArt', () => {
  const paint = body(code('pages/frame.ts'), 'export function paintFrame(');
  const writes = paint.split('\n').filter(l => /\binnerHTML\s*=/.test(l));
  assert.ok(writes.length > 0, 'non-vacuous: paintFrame writes #app');
  for (const l of writes) assert.match(l, /keepArt\(app, \(\) => \{ app\.innerHTML = html; \}\)/, `a repaint outside keepArt flashes every picture: ${l.trim()}`);
});

test('1377 §2 the pack band and the pool results are patched through keepArt', () => {
  const band = body(code('cubedraft.ts'), 'function patchBand(');
  const bandWrites = band.split('\n').filter(l => /\.(outer|inner)HTML\s*=/.test(l));
  assert.ok(bandWrites.length > 0, 'non-vacuous: patchBand redraws the band');
  for (const l of bandWrites) assert.match(l, /keepArt\(el\.parentElement \?\? el, \(\) => \{ el\.outerHTML = .*\}, '\.cdpack img'\)/, l.trim());
  const pool = body(code('tabletop.ts'), 'function paintPool(');
  const results = pool.split('\n').filter(l => /results\.innerHTML\s*=/.test(l));
  assert.ok(results.length > 0, 'non-vacuous: paintPool redraws the results');
  for (const l of results) assert.match(l, /keepArt\(results, \(\) => \{ results\.innerHTML = /, l.trim());
});

/** the whole-page writers that need no keepArt, and why */
const NO_KEEP: { file: string; line: RegExp; why: string; holds: () => void }[] = [
  { file: 'main.ts', line: /\$app\.innerHTML = kickedHtml\(/, why: 'the kicked notice draws no picture',
    holds: () => assert.doesNotMatch(kickedHtml('x'), /<img\b/) },
  { file: 'main.ts', line: /\$app\.innerHTML = connectingHtml\(/, why: 'the connecting page draws no picture',
    holds: () => {
      for (const v of [{ error: '' }, { error: 'e' }, { error: 'e', retrying: true }, { error: '', waiting: 'w' }] as ConnectingView[]) assert.doesNotMatch(connectingHtml(v), /<img\b/);
    } },
  { file: 'main.ts', line: /\$app\.innerHTML = `$/, why: 'the board: its scans are eager, not lazy (a cached eager image is drawn at once), and its motion and hover passes read the nodes they had',
    holds: () => assert.doesNotMatch(code('main.ts'), /loading=\\?"lazy|\bartHtml\(/, 'a lazy picture on the board would flash: paint it through keepArt') },
  { file: 'tabletop.ts', line: /\$app\.innerHTML = '';/, why: 'clears #app before the table paints (through paintFrame)', holds: () => {} },
  ...['crreview.ts', 'pages/admin.ts', 'pages/judgereview.ts'].map(file => ({
    file, line: /\bapp\.innerHTML = /, why: 'the page draws no picture',
    holds: () => assert.doesNotMatch(code(file), /<img\b|\bartHtml\(|\bscanHtml\(|\belIcon\b|\biconize/, `${file} draws a picture now: paint it through keepArt`),
  })),
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'test' || n === 'node_modules' ? [] : sources(p);
    return n.endsWith('.ts') ? [relative(UI, p)] : [];
  });
}

test('1377 §3 every other whole-page write of #app is inside keepArt or a known writer that needs none', () => {
  const seen = new Set<number>();
  let writers = 0;
  for (const f of sources(UI)) {
    code(f).split('\n').forEach((l, i) => {
      if (!/(^|[^.\w])\$?app\.innerHTML\s*=/.test(l) || /^\s*(\*|\/\/)/.test(l)) return;
      writers++;
      if (/keepArt\(\$?app, /.test(l)) return;
      const k = NO_KEEP.findIndex(n => n.file === f && n.line.test(l));
      assert.ok(k >= 0, `${f}:${i + 1} repaints #app outside keepArt — every picture on it flashes: ${l.trim()}`);
      seen.add(k);
    });
  }
  assert.ok(writers >= 8, `non-vacuous: the scan finds the writers (${writers})`);
  NO_KEEP.forEach((n, k) => {
    assert.ok(seen.has(k), `stale entry: ${n.file} no longer writes ${n.line} — drop it`);
    n.holds();
  });
});
