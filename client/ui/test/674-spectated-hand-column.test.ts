/* CT-368 — ON THE REGIONS BOARD, A SPECTATOR'S VIEW OF THE TOP SEAT'S HAND.
 *
 * With both hands shown, the top seat's full hand (`.lspect`) was a fourth
 * row of the info block and drew ~25px of 108px cards at 1440x900 (measured
 * on ?question=transmogrifant-control-change). CT-368 gave it a column of its
 * own, the block's height.
 *
 * Board round 8 (owner, 2026-10-27) made each player's info ONE line. The
 * strip is a stretch of the top seat's line, right after the name and its
 * card backs, the line's whole height, and never under 30% of its width
 * however many resources the line holds (CT-419's lesson: an `auto` neighbour
 * once left it 0px). The geometry is the browser's; what is held here is the
 * stylesheet that gives the strip its room, and the markup that puts it there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const CSS = read('../style.css');
const MAIN = read('../main.ts');

test('CT-368: the spectated hand is a stretch of the top seat\'s line, its whole height, never squeezed out', () => {
  assert.match(CSS, /\.linfo \.lspect \{ flex: 1 1 0; min-width: 30%; align-self: stretch;[^}]*container-type: size;/);
  // and in the markup it comes right after the name, before the cache and bin
  assert.match(MAIN, /: `\$\{id\}\$\{spect\}\$\{cache\}\$\{bin\}\$\{res\}`;/);
});

test('CT-368: its cards are sized from the strip height and shrink together when the hand is long', () => {
  assert.match(CSS, /\.linfo \.lspect > \.zone > \.card \{ flex: 0 1 min\(92px, calc\(\(100cqh - 18px\) \/ 1\.4\)\); width: auto; min-width: 0; \}/);
  assert.match(CSS, /\.linfo \.lspect > \.zone \{[^}]*flex-wrap: nowrap; overflow: hidden;/);
});
