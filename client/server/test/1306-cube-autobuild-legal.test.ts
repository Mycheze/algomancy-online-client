/* Cube draft §5: autoBuild — the suggested deck (docs/25-cube-draft.md §5, §6).
 *
 * §1 ⭐ across 120 drafted pools (15 seeded 8-bot drafts, win rates drawn from the seed), every
 *    suggestion passes checkMatchDeck, has 30 + 7, and uses only the pool, counting copies
 * §2 the main deck is the pool's best two elements (monos + their own gold cards) when it has 30
 *    of them, highest win rate first
 * §3 short of on-element cards, the best off-element ones fill the 30
 * §4 a pasted list's two copies: never more than 2 of a card across main + side
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCard } from '../../engine/src/cards/dsl.ts';
import { draftDeckList } from '../../engine/src/cards/registry.ts';
import { checkMatchDeck } from '../../engine/src/matchdeck.ts';
import { autoBuild, botPick, type WinRates } from '../cube-bot.ts';
import { advance, startDraft } from '../cube-draft.ts';
import { rng } from '../league.ts';

const BASE = draftDeckList(['fire', 'water', 'earth', 'wood', 'metal']);
const ALL7 = draftDeckList(['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark']);
const els = (c: string): string[] => getCard(c).factions ?? [];
const NONE: WinRates = new Map();

function rates(seed: number, pool: string[]): WinRates {
  const r = rng(seed);
  const wr: WinRates = new Map();
  for (const c of pool) if (r() < 0.8) { const n = Math.floor(r() * 80); wr.set(c, { n, w: Math.round(n * (0.3 + r() * 0.45)) }); }
  return wr;
}

function within(deck: string[], pool: string[]): boolean {
  const left = new Map<string, number>();
  for (const c of pool) left.set(c, (left.get(c) ?? 0) + 1);
  for (const c of deck) { const n = left.get(c) ?? 0; if (!n) return false; left.set(c, n - 1); }
  return true;
}

test('cube §1 every suggestion is a legal match deck from its own pool', () => {
  let pools = 0;
  for (let seed = 1; seed <= 15; seed++) {
    const cube = seed % 3 === 0 ? ALL7 : BASE;
    const wr = rates(seed, cube);
    const table = Array.from({ length: 8 }, (_, i) => ({ user: null, name: `Bot ${i + 1}` }));
    const size = Math.min(15, Math.floor(cube.length / 24));
    const d = startDraft(table, cube, 3, size, seed, 0);
    advance(d, 1e15, s => botPick(d.seats[s]!.queue[0]!, d.seats[s]!.picks, wr, seed * 31 + s));
    for (const s of d.seats) {
      const { main, side } = autoBuild(s.picks, wr);
      const r = checkMatchDeck(main, side);
      assert.ok(r.ok, `seed ${seed}: ${r.ok ? '' : r.error}`);
      assert.equal(main.length, 30);
      assert.equal(side.length, 7);
      assert.ok(within([...main, ...side], s.picks), 'only drafted cards, counting copies');
      pools++;
    }
  }
  assert.equal(pools, 120);
});

test('cube §2 the best two elements, best first', () => {
  const fire = BASE.filter(c => els(c).join() === 'fire');
  const water = BASE.filter(c => els(c).join() === 'water');
  const fw = BASE.filter(c => els(c).length === 2 && els(c).includes('fire') && els(c).includes('water'));
  const fe = BASE.filter(c => els(c).length === 2 && els(c).includes('fire') && els(c).includes('earth'));
  const earth = BASE.filter(c => els(c).join() === 'earth');
  const pool = [...fire.slice(0, 18), ...water.slice(0, 12), ...fw.slice(0, 3), ...fe.slice(0, 2), ...earth.slice(0, 8)];
  const { main, side } = autoBuild(pool, NONE);
  assert.equal(main.length, 30);
  assert.ok(main.every(c => els(c).every(e => e === 'fire' || e === 'water')), 'fire + water and their gold only');
  assert.ok(side.every(c => !main.includes(c)));
  // win rates order it: the 3 worst fire/water cards are left out
  const wr: WinRates = new Map(pool.map((c, i) => [c, { n: 100, w: 30 + (i % 40) }]));
  const ranked = autoBuild(pool, wr);
  const onEl = pool.filter(c => els(c).every(e => e === 'fire' || e === 'water'));
  const score = (c: string) => wr.get(c)!.w;
  const worstIn = Math.min(...ranked.main.map(score));
  const out = onEl.filter(c => !ranked.main.includes(c));
  assert.equal(out.length, onEl.length - 30);
  assert.ok(out.every(c => score(c) <= worstIn));
});

test('cube §3 short of on-element cards, the best others fill in', () => {
  const pool = [...BASE.filter(c => els(c).join() === 'metal').slice(0, 20),
    ...BASE.filter(c => els(c).join() === 'wood').slice(0, 6),
    ...BASE.filter(c => els(c).join() === 'earth').slice(0, 5),
    ...BASE.filter(c => els(c).join() === 'fire').slice(0, 5)];
  const wr: WinRates = new Map(pool.map((c, i) => [c, { n: 50, w: 20 + (i % 9) }]));
  const { main, side } = autoBuild(pool, wr);
  assert.equal(main.length, 30);
  assert.equal(main.filter(c => ['metal', 'wood'].includes(els(c)[0]!)).length, 26, 'all 26 on-element');
  assert.equal(side.length, 6);
  assert.ok(checkMatchDeck(main, side).ok);
});

test('cube §4 copies are capped at two across both boards', () => {
  const some = BASE.filter(c => els(c).join() === 'earth').slice(0, 14);
  const pool = [...some, ...some, ...some.slice(0, 5)];   // 3 copies of five cards
  const { main, side } = autoBuild(pool, NONE);
  const n = new Map<string, number>();
  for (const c of [...main, ...side]) n.set(c, (n.get(c) ?? 0) + 1);
  assert.ok([...n.values()].every(k => k <= 2));
  assert.equal(main.length + side.length, 28, 'every card twice, and no third copy');
  assert.equal(checkMatchDeck(main, side).ok, false, 'only 28 legal cards: the deck check, not autoBuild, says so');
});
