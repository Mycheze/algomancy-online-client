/* 687 — A SPECTATOR'S VIEW OF THE TOP SEAT'S HAND: THE ROOM IT GETS
 * (CT-419, after CT-368 / test 674).
 *
 * Until board round 8 the spectated hand stood in the top info BLOCK, whose
 * height the battle plan shared out (planBattleBoard's `spect`: the top band
 * took the spare height first, up to what the strip's cards could use). Board
 * round 8 (owner, 2026-10-27) made the info one fixed line and took the bands
 * out of the info, so that arithmetic is gone. What replaces it: the top
 * seat's line is the one line that grows while a spectator's view of that
 * hand is in it — 128px (100px on a window under 820px tall), so its cards
 * stand ~83px (~62px) wide, where a 60px line would have left them ~33px —
 * and the battle plan is over the board between the two lines, whatever
 * they are.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const CSS = read('../style.css');

test('CT-419: the top line grows while it holds a spectated hand, and only then', () => {
  assert.match(CSS, /\.lboard:has\(> \.linfo\.theirs \.lspect\) \{ --lint: var\(--linspect, (\d+)px\); \}/);
  assert.match(CSS, /\.lboard \{[^}]*grid-template-rows:\s*var\(--lint, var\(--linh\)\)/, 'the top line\'s track is --lint, the plain line by default');
  const tall = Number(/var\(--linspect, (\d+)px\)/.exec(CSS)![1]);
  const line = Number(/\.lboard \{[^}]*--linh: (\d+)px;/.exec(CSS)![1]);
  assert.ok(tall >= line + 40, `the spectated line (${tall}px) is well taller than a plain one (${line}px)`);
  assert.match(CSS, /@media \(max-height: 820px\) \{ \.lboard \{ --linspect: \d+px; \} \}/, 'a smaller one on a short window');
});

test('CT-419: the battle plan no longer shares the height with the strip — it is over what lies between the lines', () => {
  const layout = read('../layout.ts');
  assert.doesNotMatch(layout, /spectWant|spect:/, 'shapeBoard asks the strip nothing');
  assert.match(layout, /const lines = \(boxOf\(lb\.querySelector\('\.linfo\.theirs'\)\)/, 'the plan is over the board less the two info lines, however tall they are');
});
