/* 1361 · A CUBE DECK TABLE'S LAYOUT (ui/cubearrange.ts, ui/deckarrange.ts landByCost; docs/25 §6, §13)
 * — pure, on made-up layouts.
 *
 *   §1 landByCost: a pick lands where Re-sort by cost would put it — after its other copies; on its
 *      cost's pile; else on a new pile for its cost set among the cost piles in cost order (after
 *      the dearest, at the end with none); nothing already placed moves, a renamed pile is left alone
 *   §2 layoutFrom / arrangeOf: there and back; a pile named for a cost takes that cost's picks again;
 *      any other name is the player's (named)
 *   §3 fitLayout: never a card the player does not have (main's copies kept first); with `land`,
 *      every card they have — the missing ones by cost; without, the rest stay in the pool
 *   §4 deckLayout: a submitted deck in the kept piles where its cards are there, by cost where not;
 *      its sideboard; Maybe less what the deck and sideboard use
 *
 * Seeds: none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { arrangeOf, deckLayout, fitLayout, layoutFrom, onTable } from '../cubearrange.ts';
import { landByCost, seedPiles, type DeckPile } from '../deckarrange.ts';
import { cardFacts } from '../deckstats.ts';

const costOf = (n: string): number => { const f = cardFacts(n)!; return f.isX ? 99 : f.mana; };
/** three cards of three different plain costs, cheapest first */
const byMana = new Map<number, string>();
for (const n of DECK_LIST) { const f = cardFacts(n); if (f && !f.isX && !byMana.has(f.mana)) byMana.set(f.mana, n); }
const [lo, mid, hi] = [...byMana.keys()].sort((a, b) => a - b).slice(1, 4).map(k => byMana.get(k)!) as [string, string, string];
const sameCost = (n: string): string => DECK_LIST.find(x => x !== n && costOf(x) === costOf(n))!;

test('§1 landByCost', () => {
  // on an empty table: a pile for its cost, named as Re-sort names it
  let t = landByCost([], mid);
  assert.deepEqual(t.map(p => [p.name, p.cards, p.auto]), [[String(costOf(mid)), [mid], `cost:${costOf(mid)}`]]);
  // a cheaper card: a new pile BEFORE; a dearer one: AFTER
  t = landByCost(t, lo);
  t = landByCost(t, hi);
  assert.deepEqual(t.map(p => p.cards), [[lo], [mid], [hi]], 'cost order');
  // the same cost: onto that pile; a second copy: after the first
  t = landByCost(t, sameCost(mid));
  assert.deepEqual(t[1]!.cards, [mid, sameCost(mid)]);
  t = landByCost(t, mid);
  assert.deepEqual(t[1]!.cards, [mid, mid, sameCost(mid)], 'next to its other copy');
  // the player's own piles: left alone, and a new cost pile goes among the cost piles
  const mine: DeckPile[] = [{ id: 'p9', name: 'Bombs', cards: [hi], named: true }, ...seedPiles([lo], 'cost')];
  const after = landByCost(mine, mid);
  assert.deepEqual(after.map(p => p.name), ['Bombs', String(costOf(lo)), String(costOf(mid))], 'after the last cost pile');
  assert.deepEqual(after[0]!.cards, [hi], 'nothing placed moves');
  assert.deepEqual(landByCost([{ id: 'p1', name: 'Mine', cards: [], named: true }], lo).map(p => p.name), ['Mine', String(costOf(lo))],
    'no cost pile: at the end');
  assert.equal(new Set(landByCost(landByCost(t, lo), hi).map(p => p.id)).size, 3, 'ids stay unique');
});

test('§2 layoutFrom / arrangeOf', () => {
  const a = { piles: [[lo, lo], [mid]], names: [String(costOf(lo)), 'Tricks'], side: [hi], maybe: [mid], from: 'draft' as const };
  const t = layoutFrom(a);
  assert.deepEqual(t.piles.map(p => [p.id, p.name, p.auto ?? null, !!p.named]),
    [['p1', String(costOf(lo)), `cost:${costOf(lo)}`, false], ['p2', 'Tricks', null, true]]);
  assert.deepEqual(arrangeOf(t), a, 'there and back');
  assert.deepEqual(arrangeOf(t, 'build').from, 'build');
  assert.deepEqual(landByCost(t.piles, sameCost(lo))[0]!.cards, [lo, lo, sameCost(lo)], 'the cost pile takes its picks again');
  assert.deepEqual(layoutFrom(null), { piles: [], side: [], maybe: [] });
  assert.deepEqual(layoutFrom({ piles: [[lo]], side: [], maybe: [] }).piles[0]!.name, 'Pile 1', 'no names: by position');
});

test('§3 fitLayout', () => {
  const t = layoutFrom({ piles: [[lo, mid]], side: [mid], maybe: [hi, 'Not Mine'], from: 'draft' });
  // I have one mid only: main keeps it, the sideboard's goes; a card I do not have goes
  const held = [lo, mid, hi, sameCost(lo)];
  const kept = fitLayout(t, held, false);
  assert.deepEqual([kept.piles[0]!.cards, kept.side, kept.maybe], [[lo, mid], [], [hi]]);
  assert.ok(!onTable(kept).includes(sameCost(lo)), 'without land: the rest stay in the pool');
  const landed = fitLayout(t, held, true);
  assert.deepEqual([...onTable(landed)].sort(), [...held].sort(), 'with land: every card I have');
  assert.ok(landed.piles.some(p => p.auto === `cost:${costOf(lo)}` && p.cards.includes(sameCost(lo))), 'the missing one by cost');
});

test('§4 deckLayout', () => {
  const kept = { piles: [[lo, mid], [hi]], names: ['Early', 'Late'], side: [], maybe: [sameCost(hi), sameCost(lo)], from: 'build' as const };
  const pool = [lo, mid, hi, sameCost(hi), sameCost(lo), sameCost(mid)];
  const t = deckLayout({ main: [lo, hi, sameCost(mid)], side: [sameCost(lo)] }, kept, pool);
  assert.deepEqual(t.piles.find(p => p.name === 'Early')!.cards, [lo], 'in the kept pile, where it is there');
  assert.deepEqual(t.piles.find(p => p.name === 'Late')!.cards, [hi]);
  assert.ok(t.piles.some(p => p.auto === `cost:${costOf(mid)}` && p.cards.includes(sameCost(mid))), 'by cost where not');
  assert.deepEqual(t.side, [sameCost(lo)]);
  assert.deepEqual(t.maybe, [sameCost(hi)], 'Maybe less what the sideboard uses');
});
