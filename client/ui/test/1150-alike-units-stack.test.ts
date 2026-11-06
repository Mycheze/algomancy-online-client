/* 1150 · FOUR OR MORE ALIKE UNITS STAND AS ONE STACK (owner, #steward
 * 2026-11-06, inbox-1568202702536572979):
 *
 *   "For very large boards that have many of the same unit tokens (for
 *   example, a ton of Robot 2s) in play, I think it would make sense to sorta
 *   semi overlap them (about half showing, like they're in a fan stack of some
 *   kind) and use a x5 counter in the corner. And hovering over them fans them
 *   all out, like with invaders. This would only work for IDENTICAL Units …
 *   that have 100% the same text, same counters, same everything and when
 *   there are 4 or more of them on the field at once, in the same region."
 *
 *   §1  five alike Robots in my In Play are one stack with ×5 on it, every
 *       unit still its own clickable card; three alike are not stacked
 *   §2  "the same everything": a Robot with one more counter, or damaged,
 *       stands apart — and the rest stack only while four are alike
 *   §3  the stack counts as three card slots in the row's fit, and a row of
 *       stacks wraps the way a flex row does (ui/fit.ts fitSpans)
 *   §4  the hover fan stays inside the row (ui/layout.ts stackFan)
 *   §5  the stylesheet: overlapped at rest, fanned on hover or when opened
 *   §6  a finger opens it with its count
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { toDeployment } from '../../engine/test/util.ts';
import type { EntityId, GameState, Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';
import { fitCards, fitSpans, rowsFor } from '../fit.ts';
import { stackFan } from '../layout.ts';
import { readStyles } from './read-styles.ts';

const ui = await client();
const CSS = readStyles();

function board(robots: Array<{ seat: Seat; counters: number; damage?: number }>): { state: GameState; ids: EntityId[] } {
  const h = new Harness(100001);
  toDeployment(h);
  const e = new E(h.state);
  const ids = robots.map(r => {
    const u = e.spawnUnit(r.seat, 'Robot', e.homeRegion(r.seat), { token: true, counters: r.counters });
    return u.id;
  });
  e.settle();
  robots.forEach((r, i) => { if (r.damage) h.state.entities[ids[i]!]!.damage = r.damage; });
  return { state: h.state, ids };
}

function paint(state: GameState, seat: Seat = 0): string {
  ui.join(state, seat, legalActions(state, seat));
  return ui.update(state, legalActions(state, seat));
}

/** each In Play row's field zone, mine and theirs */
function field(html: string, side: 'mine' | 'theirs'): string {
  const at = html.indexOf(`<div class="lplay ${side}`);
  assert.ok(at >= 0, `no ${side} In Play`);
  const from = html.indexOf('<div class="regionmain">', at);
  const to = html.indexOf('<div class="linv', from) >= 0 && side === 'theirs'
    ? html.indexOf('<div class="linv', from) : html.indexOf('<div class="linfo', from);
  return html.slice(from, to);
}
const stacks = (s: string): string[] => s.match(/<div class="ustack[^"]*"[^>]*>/g) ?? [];
const unitIds = (s: string): number[] => [...s.matchAll(/data-act="unit" data-id="(\d+)"/g)].map(m => Number(m[1]));

test('§1 five alike Robots are one stack, ×5; three alike are not', () => {
  const { state, ids } = board([
    ...Array.from({ length: 5 }, () => ({ seat: 0 as Seat, counters: 2 })),
    ...Array.from({ length: 3 }, () => ({ seat: 1 as Seat, counters: 2 })),
  ]);
  const html = paint(state);
  const mine = field(html, 'mine'), theirs = field(html, 'theirs');
  assert.equal(stacks(mine).length, 1, 'my five Robots stand as ONE stack');
  assert.match(mine, /<div class="ustack" data-zoomclear data-span="3" style="--k:5;--span:3">/);
  assert.match(mine, /<button class="pilecount" data-btn="pilefan" data-pile="units:\d+"[^>]*>×5<\/button>/, 'the count');
  // every unit is still its own real card, in the stack, in order
  assert.deepEqual(unitIds(mine), ids.slice(0, 5), 'each Robot keeps its own card, its own id');
  for (const id of ids.slice(0, 5)) assert.match(mine, new RegExp(`data-anim="e${id}"|anim[^>]*e${id}\\b`), `Robot ${id} keeps its flight anchor`);
  assert.equal(stacks(theirs).length, 0, 'three alike is under the owner\'s four: no stack');
  assert.deepEqual(unitIds(theirs), ids.slice(5));
});

test('§2 the same everything: one more counter, or damage, stands apart', () => {
  // four at 2 counters, one at 3, one damaged at 2: the four stack, two apart
  const { state, ids } = board([
    { seat: 0, counters: 2 }, { seat: 0, counters: 3 }, { seat: 0, counters: 2 },
    { seat: 0, counters: 2 }, { seat: 0, counters: 2, damage: 1 }, { seat: 0, counters: 2 },
  ]);
  const mine = field(paint(state), 'mine');
  assert.equal(stacks(mine).length, 1);
  assert.match(mine, /style="--k:4;--span:3"/, 'the four alike');
  const inStack = unitIds(mine.slice(mine.indexOf('<div class="ustack'), mine.indexOf('</button>', mine.indexOf('<div class="ustack'))));
  assert.deepEqual(inStack, [ids[0], ids[2], ids[3], ids[5]], 'exactly the four alike Robots');
  assert.deepEqual(unitIds(mine).sort((a, b) => a - b), [...ids].sort((a, b) => a - b), 'the odd two are still on the board');
  // three alike + a different one: no stack at all
  const few = board([{ seat: 0, counters: 2 }, { seat: 0, counters: 2 }, { seat: 0, counters: 2 }, { seat: 0, counters: 1 }]);
  assert.equal(stacks(field(paint(few.state), 'mine')).length, 0);
});

test('§3 a stack is three card slots in the fit; rows wrap as flex does', () => {
  // next-fit: [1, 3, 3] in rows of 4 — the second stack cannot join the first's row
  assert.equal(rowsFor([1, 3, 3], 4), 2);
  assert.equal(rowsFor([3, 1, 3, 1], 4), 2);
  assert.equal(rowsFor([1, 1, 3, 3], 4), 3, 'the stack does not fit after two cards, and wraps');
  assert.equal(rowsFor([3], 2), 1, 'a stack wider than the row stands at the row\'s width');
  // all ones is fitCards exactly
  const box = { w: 700, h: 230 };
  assert.deepEqual(fitSpans([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], box, { cw: 86, gap: 6 }), fitCards(12, box, { cw: 86, gap: 6 }));
  // ten Robots as one stack take three slots, not ten: the cards stay bigger
  const crowd = fitSpans([1, 1, 3], box, { cw: 86, gap: 6 });
  const loose = fitCards(12, box, { cw: 86, gap: 6 });
  assert.ok(crowd.cw > loose.cw, `the stacked row's cards (${crowd.cw}px) are bigger than twelve loose ones (${loose.cw}px)`);
  // and a plan always holds every item: rows × cols by packing, never a clipped row
  for (const spans of [[3, 3, 3, 3, 3], [1, 3, 1, 3, 1, 3, 1], [3, 1, 1, 1, 1, 1, 1, 3]]) {
    for (const w of [200, 400, 700, 1200]) {
      const p = fitSpans(spans, { w, h: 120 }, { cw: 78, gap: 6 });
      assert.ok(rowsFor(spans, p.cols) <= Math.max(1, p.rows), `${spans} in ${w}px: ${JSON.stringify(p)}`);
    }
  }
});

test('§4 the hover fan stays inside the row', () => {
  // room to spare: side by side from the stack's own edge
  assert.deepEqual(stackFan(5, 80, 100, 1000), { x0: 0, step: 82 });
  // near the right edge: moved left just enough to end at the row's edge
  const f = stackFan(5, 80, 800, 1000);
  assert.equal(800 + f.x0 + 80 + 4 * f.step, 1000);
  // wider than the row: closed up to the row's width, from its left edge
  const g = stackFan(20, 80, 300, 1000);
  assert.ok(g.step < 82 && 300 + g.x0 >= 0 && 300 + g.x0 + 80 + 19 * g.step <= 1000, JSON.stringify(g));
});

test('§5 the stylesheet: overlapped at rest, fanned on hover or opened', () => {
  const rule = (sel: string): string => {
    const at = CSS.indexOf(sel);
    assert.ok(at >= 0, `no rule ${sel}`);
    return CSS.slice(at, CSS.indexOf('}', at));
  };
  assert.match(rule('.lboard .regionmain .zone > .ustack {'), /--ustep: calc\(\(min\(var\(--span\), var\(--zcols, 99\)\) - 1\) \* var\(--slotstep\) \/ \(var\(--k\) - 1\)\)/);
  assert.match(rule('.lboard .ustack > .uslot + .uslot'), /margin-left: calc\(var\(--ustep\) - var\(--cw\)\)/);
  assert.match(rule('.lboard .ustack:hover > .uslot, .lboard .ustack.open > .uslot'), /transform: translateX\(calc\(var\(--ufan0, 0px\) \+ var\(--i\) \* \(var\(--ufanstep/);
  assert.match(rule('.lboard [data-fitmode="fan"] .regionmain .zone > .ustack {'), /--slotstep: calc\(var\(--fanstep\) \+ 6px\)/);
});

test('§6 a finger opens the stack with its count, and closes it', () => {
  const { state } = board(Array.from({ length: 4 }, () => ({ seat: 0 as Seat, counters: 2 })));
  paint(state);
  assert.doesNotMatch(field(ui.html(), 'mine'), /class="ustack open"/);
  ui.click({ btn: 'pilefan' });
  assert.match(field(ui.html(), 'mine'), /class="ustack open"/, 'opened');
  ui.click({ btn: 'pilefan' });
  assert.doesNotMatch(field(ui.html(), 'mine'), /class="ustack open"/, 'closed');
});
