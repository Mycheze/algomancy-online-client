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
 * §2 the stylesheet: a battle grid whose columns are the old halves; with
 *    `data-wide` one per side, the fight's column two tracks of three, the
 *    bands still split at half; the tints and seam following both
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
const store = (globalThis as { localStorage: Storage }).localStorage;

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

const paint = (s: GameState, seat: Seat, layout: '1' | '2' = '2'): string => {
  store.setItem('algoLayout', layout);
  return ui.join(s, seat, legalActions(s, seat));
};
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
  // the classic board has no such thing
  assert.doesNotMatch(paint(R1, 0, '1'), /data-fight/);
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
const areas = (body: string): string[][] =>
  [...((/grid-template-areas:([\s\S]*?);/.exec(body) ?? [])[1] ?? '').matchAll(/"([^"]+)"/g)].map(m => m[1]!.trim().split(/\s+/));
/** the tracks an area covers in a template, as [first, last] */
const span = (rows: string[][], name: string): [number, number] => {
  const at = rows.flatMap(r => r.map((a, i) => (a === name ? i : -1)).filter(i => i >= 0));
  return [Math.min(...at), Math.max(...at)];
};

test('§2 the battle grid: the old halves, and per side when the fight needs more, the bands still split at half', () => {
  // a fight that fits in half: two tracks, exactly the half-and-half board it was
  const base = rule('.lboard.fighting[data-fight]');
  assert.match(base, /grid-template-rows: var\(--lbandt[^;]*\) auto minmax\(0, [\d.]+fr\) auto var\(--lbandb/);
  assert.match(base, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.deepEqual(areas(base), [['tinfo', 'tplay'], ['yinv', 'tfight'], ['yfight', 'tfight'], ['yfight', 'tinv'], ['yplay', 'yinfo']]);
  assert.match(rule('.lboard[data-fight] > .lback.mine.b'), /grid-column: 1 \/ 2/);
  assert.match(rule('.lboard[data-fight] > .lback.theirs.b'), /grid-column: 2 \/ 3/);
  assert.ok(CSS.includes('.lboard[data-fight] > .lseam { grid-column: 2; }'), 'the seam at the half');
  for (const side of ['mine', 'theirs'] as const) {
    const body = rule(`.lboard.fighting[data-fight="${side}"][data-wide]`);
    const rows = areas(body);
    assert.equal(rows.length, 5, `${side}: band · row · fight · row · band`);
    assert.ok(rows.every(r => r.length === 3), `${side}: three tracks`);
    const cols = (/grid-template-columns:([^;]+);/.exec(body) ?? [])[1]!.trim();
    const fight = side === 'mine' ? 'yfight' : 'tfight', idle = side === 'mine' ? 'tfight' : 'yfight';
    const [f0, f1] = span(rows, fight), [i0, i1] = span(rows, idle);
    assert.equal(f1 - f0, 1, `${side}: the fight spans two tracks`);
    assert.equal(i1 - i0, 0, `${side}: the idle block one`);
    // the idle track is the measured one; the half track is where the bands split
    const tracks = cols.split(/\s+(?![^(]*\))/);
    assert.equal(tracks.length, 3, `${side}: ${cols}`);
    assert.match(tracks[i0]!, /^var\(--lidle/, `${side}: the idle column is what the fight leaves`);
    const half = side === 'mine' ? 0 : 2;
    assert.equal(tracks[half], 'calc(50% - 4px)', `${side}: one track is exactly the old half (3 of 6 tracks and 2 gaps)`);
    // the bands split at that track, whichever side the fight is on: the info
    // offshoots keep their place and width
    const infoTop = span(rows, 'tinfo'), infoBot = span(rows, 'yinfo');
    const playTop = span(rows, 'tplay'), playBot = span(rows, 'yplay');
    if (side === 'mine') {
      assert.deepEqual([infoTop, playTop], [[0, 0], [1, 2]]);
      assert.deepEqual([playBot, infoBot], [[0, 0], [1, 2]]);
    } else {
      assert.deepEqual([infoTop, playTop], [[0, 1], [2, 2]]);
      assert.deepEqual([playBot, infoBot], [[0, 1], [2, 2]]);
    }
    // the Ls: each region's invaders row sits in its own column
    assert.deepEqual(span(rows, 'yinv'), span(rows, 'yfight'), `${side}: my invaders row is my column's width`);
    assert.deepEqual(span(rows, 'tinv'), span(rows, 'tfight'), `${side}: theirs likewise`);
  }
  // the tints (and so the ring) and the seam follow the columns
  assert.match(rule('.lboard[data-fight="mine"][data-wide] > .lback.mine.b'), /grid-column: 1 \/ 3/);
  assert.match(rule('.lboard[data-fight="mine"][data-wide] > .lback.theirs.b'), /grid-column: 3 \/ 4/);
  assert.match(rule('.lboard[data-fight="theirs"][data-wide] > .lback.mine.b'), /grid-column: 1 \/ 2/);
  assert.match(rule('.lboard[data-fight="theirs"][data-wide] > .lback.theirs.b'), /grid-column: 2 \/ 4/);
  assert.match(rule('.lboard[data-fight="mine"][data-wide] > .lseam'), /grid-column: 3/);
  assert.match(rule('.lboard[data-fight="theirs"][data-wide] > .lseam'), /grid-column: 2/);
  assert.match(rule('.lboard[data-fight] > .lback.theirs.a'), /grid-column: 1 \/ -1/);
  // and the board outside a battle is untouched: still the six-by-nine grid
  assert.match(rule('.lboard'), /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
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
