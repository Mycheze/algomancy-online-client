/* ROUND 7 — THE FIGHT BLOCK GROWS (report #204, CT-278; docs/18 § Round 7):
 * the markup and the stylesheet that make the battle board's shape.
 *
 * The owner chose the shape: the two Ls, their tints, the seam and the ring
 * stay, the edges (the info offshoots) do not move, and the fight gets the
 * room it NEEDS — "the horizontal space should be expanded when needed"
 * (their correction to a first build that gave it three quarters of the board
 * whatever it held). So a fight that fits in half keeps the half-and-half
 * board, and a wider one (`data-wide`, ui/layout.ts) widens. Before the round the battle used the board's one 6 × 9 grid, so the
 * fight's block was always exactly half the board wide (`yfight yfight yfight
 * tfight tfight tfight`) and its columns packed against its left edge.
 *
 * §1 the board says which column holds the fight, in both rounds and from
 *    both seats, and says nothing outside a battle (the board there is the
 *    one it was); the counterattackers on their way wrap down the idle column
 * §2 the stylesheet: the feet (info line + In Play) full width, the middle
 *    two columns half and half, with `data-wide` the idle one `--lidle`; the
 *    two In Plays are the bands round 7 plans (board round 8)
 * §3 the columns stand in the middle of the fight, in the width the invader
 *    strip leaves them, by auto margins (which give way when the row is full)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const CSS = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8');

/* a round-1 attack by seat 0, blocks with a unit sent, and the round-2 counterattack */
const h = new Harness(44901);
toDeployment(h);
const a1 = spawn(h, 0, 'Good Whale'), a2 = spawn(h, 0, 'Ephemeral Skywalker');
const d1 = spawn(h, 1, 'Rune Channeler'), d2 = spawn(h, 1, 'Curio Drifter');
const DEPLOY = structuredClone(h.state);
toNextBattle(h, 0);
h.do({ type: 'declareAttack', seat: 0, columns: [[a1], [a2]] });
const R1 = structuredClone(h.state);
pass(h); pass(h);
h.do({ type: 'declareBlocks', seat: 1, blocks: { 0: [d1] }, send: [d2] });
const SENT = structuredClone(h.state);
let guard = 60;
while (h.state.phase === 'battle' && h.state.battle!.round === 1 && guard-- > 0) {
  const dec = h.state.decision;
  if (dec) h.do({ type: 'decide', seat: dec.seat, choice: 0 }); else pass(h);
}
const R2 = structuredClone(h.state);

const paint = (s: GameState, seat: Seat): string => ui.join(s, seat, legalActions(s, seat));
const boardTag = (html: string): string => (/<div class="lboard[^>]*>/.exec(html) ?? [''])[0];

test('§1 the board names the fight column in both rounds from both seats, and nothing outside a battle', () => {
  assert.equal(R1.battle?.round, 1);
  assert.equal(R2.battle?.round, 2, 'the fixture reaches the counterattack');
  const e = new E(R1);
  assert.equal(R1.battle!.region, e.homeRegion(1), 'the premise: round 1 is fought in the defender\'s region');
  // seat 0 attacked: the fight is in THEIR column for seat 0, in MINE for seat 1
  assert.match(boardTag(paint(R1, 0)), /class="lboard fighting"[^>]* data-fight="theirs"/);
  assert.match(boardTag(paint(R1, 1)), /class="lboard fighting"[^>]* data-fight="mine"/);
  // round 2 is fought in the attacker's region
  assert.equal(R2.battle!.region, e.homeRegion(0));
  assert.match(boardTag(paint(R2, 0)), /data-fight="mine"/);
  assert.match(boardTag(paint(R2, 1)), /data-fight="theirs"/);
  // outside a battle the board is the grid it was
  const idle = boardTag(paint(DEPLOY, 0));
  assert.match(idle, /class="lboard idle"/);
  assert.doesNotMatch(idle, /data-fight/, 'no battle, no battle shape');
  // the counterattacker on its way wraps down the narrow idle column (fit
  // `band`), where it used to fan along a single row of a half-board block
  const sent = paint(SENT, 0);
  const incoming = /<div class="lfight mine incoming" data-region="\d" data-fit="([a-z]+)">/.exec(sent);
  assert.ok(incoming, 'the sent unit is drawn heading for seat 0\'s block');
  assert.equal(incoming[1], 'band');
});

/** a rule's body, by its exact selector */
const rule = (sel: string): string => {
  const at = CSS.indexOf(`${sel} {`);
  assert.ok(at >= 0, `style.css has no \`${sel} {\``);
  return CSS.slice(at, CSS.indexOf('}', at));
};
test('§2 the battle board: the feet full width, the middle two columns, the bands planned, the seam pushed aside only when needed', () => {
  // board round 8: each region is a full-width foot (info line + In Play)
  // and a column of the middle; in a battle the two In Plays are the bands
  // round 7 planned (--lbandt / --lbandb), the middle's fight row takes the
  // rest, and the info lines stand outside them
  const base = rule('.lboard.fighting[data-fight]');
  assert.match(base.replace(/\s+/g, ' '), /grid-template-rows: var\(--lint, var\(--linh\)\) var\(--lbandt, minmax\(0, 1fr\)\) auto minmax\(0, [\d.]+fr\) auto var\(--lbandb, minmax\(0, 1fr\)\) var\(--linh\);/);
  const areas = [...((/grid-template-areas:([\s\S]*?);/.exec(rule('.lboard')) ?? [])[1] ?? '').matchAll(/"([^"]+)"/g)].map(m => m[1]!.trim().split(/\s+/));
  const rowsOf = (name: string): number[] => areas.flatMap((r, i) => (r.includes(name) ? [i] : []));
  assert.deepEqual(rowsOf('tfight'), [2, 3], 'their battle block: the Invaders row on my side, then the fight row');
  assert.deepEqual(rowsOf('yfight'), [3, 4], 'mine: the fight row, then the Invaders row on their side');
  assert.deepEqual([rowsOf('yinv'), rowsOf('tinv')], [[2], [4]], 'each region\'s Invaders row nearest the other');
  assert.ok(['tinfo', 'tplay', 'yplay', 'yinfo'].every(n => areas[rowsOf(n)[0]!]!.every(a => a === n)), 'the feet are the full width');
  assert.match(rule('.lboard'), /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(rule('.lboard.fighting[data-fight="mine"][data-wide]'), /grid-template-columns: minmax\(0, 1fr\) var\(--lidle, [^)]*\);/);
  assert.match(rule('.lboard.fighting[data-fight="theirs"][data-wide]'), /grid-template-columns: var\(--lidle, [^)]*\) minmax\(0, 1fr\);/);
  // the tints (and so the ring) and the seam follow the Ls by grid line
  assert.match(rule('.lback.theirs.a'), /grid-row: 1 \/ 3; grid-column: 1 \/ -1;/);
  assert.match(rule('.lback.theirs.b'), /grid-row: 3 \/ 6; grid-column: 2 \/ 3;/);
  assert.match(rule('.lback.mine.b'), /grid-row: 3 \/ 6; grid-column: 1 \/ 2;/);
  assert.match(rule('.lback.mine.a'), /grid-row: 6 \/ 8; grid-column: 1 \/ -1;/);
  assert.match(rule('.lseam'), /grid-row: 3 \/ 6; grid-column: 2 \/ 3; justify-self: start;/);
  // the markup never says `data-wide`: only the plan, from the room, does
  assert.doesNotMatch(paint(R1, 0), /data-wide/);
});

test('§3 the columns stand in the middle of the fight, clear of the invader strip', () => {
  assert.match(rule('.lboard[data-fight] .lfight.focus .cols > :first-child'), /margin-left: auto/);
  assert.match(rule('.lboard[data-fight] .lfight.focus .cols > :last-child'), /margin-right: auto/);
  assert.match(rule('.lboard[data-fight] .lfight.focus .cols > .col'), /margin-top: auto; margin-bottom: auto/);
  assert.match(rule('.lboard[data-fight] .lfight.focus:has(> .linvside) .cols'), /padding-right: var\(--invw/);
  // a column's label never wraps or widens its column past its card
  assert.match(rule('.lboard[data-fight] .lfight.focus .col > .collabel'), /max-width: var\(--cw\); white-space: nowrap;/);
  // the strip's width is written on the block, where `.cols` can read it
  const layout = readFileSync(fileURLToPath(new URL('../layout.ts', import.meta.url)), 'utf8');
  assert.match(layout, /el\.style\.setProperty\('--invw'/);
});
