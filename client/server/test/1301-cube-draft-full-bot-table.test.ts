/* Cube draft §4: a full table of bots drafts to the end (docs/25-cube-draft.md §4, §5).
 *
 * §1 eight bots, the base five, 3 × 13: advance() alone runs it to done; every dealt card is picked
 *    exactly once, every seat ends with packs × packSize picks, and the 8 leftover cards are unused
 * §2 the same seed drafts the same table; another seed deals another one
 * §3 it is cheap: a whole 8-bot draft with the real heuristic runs well under a second
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftDeckList } from '../../engine/src/cards/registry.ts';
import { botPick, type WinRates } from '../cube-bot.ts';
import { advance, nextWake, startDraft } from '../cube-draft.ts';
import type { DraftState } from '../cube-types.ts';

const BASE = draftDeckList(['fire', 'water', 'earth', 'wood', 'metal']);
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ user: null, name: `Bot ${i + 1}` }));

/** a win-rate table drawn from the seed, so the bots have something to disagree about */
function someRates(seed: number): WinRates {
  const wr: WinRates = new Map();
  BASE.forEach((c, i) => {
    const n = (i * 37 + seed) % 60;
    wr.set(c, { n, w: Math.round(n * (0.35 + ((i * 13 + seed) % 30) / 100)) });
  });
  return wr;
}

const chooser = (d: DraftState, wr: WinRates) => (seat: number): string =>
  botPick(d.seats[seat]!.queue[0]!, d.seats[seat]!.picks, wr, d.seed + seat);

function runBots(seed: number): { d: DraftState } {
  const d = startDraft(bots(8), BASE, 3, 13, seed, 0, 6000);
  // ONE advance with a far-future `now` must finish it (the time-ordered loop)
  assert.equal(advance(d, Number.MAX_SAFE_INTEGER, chooser(d, someRates(seed))), true);
  return { d };
}

test('cube §1 eight bots draft the base five to the end', () => {
  const { d } = runBots(42);
  assert.equal(d.done, true);
  assert.equal(nextWake(d), null);
  const all = d.seats.flatMap(s => s.picks);
  assert.equal(all.length, 8 * 3 * 13);
  assert.equal(new Set(all).size, all.length, 'singleton pool: no card picked twice');
  for (const c of all) assert.ok(BASE.includes(c));
  assert.equal(BASE.filter(c => !all.includes(c)).length, 320 - 312, 'eight leftovers');
  for (const s of d.seats) {
    assert.equal(s.picks.length, 39);
    assert.deepEqual(s.queue, []);
    assert.equal(s.reserved, null);
  }
  assert.ok(d.unopened.every(r => r.every(p => p.length === 0)), 'every pack opened');
});

test('cube §2 the seed decides the deal, the seat order and the picks', () => {
  const a = runBots(7).d, b = runBots(7).d, c = runBots(8).d;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.seats.map(s => s.picks), c.seats.map(s => s.picks));
  // seat order is shuffled: with 8 named seats, some seed moves one
  const named = Array.from({ length: 8 }, (_, i) => ({ user: `u${i}`, name: `P${i}` }));
  const orders = [1, 2, 3].map(seed => startDraft(named, BASE, 3, 13, seed, 0).seats.map(s => s.user).join());
  assert.ok(orders.some(o => o !== named.map(s => s.user).join()), 'the table order is shuffled');
  assert.equal(new Set(orders).size, 3);
});

test('cube §3 an 8-bot draft takes well under a second', () => {
  runBots(1);   // warm the card-facts cache
  const t0 = performance.now();
  runBots(99);
  const ms = performance.now() - t0;
  console.log(`# 8-bot draft: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 500, `took ${ms} ms`);
});
