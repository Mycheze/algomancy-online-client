/* Cube draft §5: the bots' pick heuristic, ported from the owner's DraftTrainer
 * (docs/25-cube-draft.md §5; server/cube-bot.ts names the knobs).
 *
 * §1 the base is 100 × the shrunk win rate, (w + 5) / (n + 10); no data is 50
 * §2 element: on an empty pool every element is unsupported a little (1.5), so a gold card pays
 *    twice and loses to a mono card of the same win rate; a committed pool charges 6 off-element
 * §3 bomb: +1 for sharing an element with a pool card at 61%+ (cap 2)
 * §4 curve: from pick 14, an on-element unit at a slot the pool is short of gets up to +1.5
 * §5 jitter: ±0.5, a function of (seed, card) — the same seed scores the same
 * §6 ⭐ a table of bots with NO win-rate data still commits: each ends mostly in two elements,
 *    far more than a bot that takes the first card of every pack
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCard } from '../../engine/src/cards/dsl.ts';
import { draftDeckList } from '../../engine/src/cards/registry.ts';
import { botPick, scorePack, type WinRates } from '../cube-bot.ts';
import { advance, startDraft } from '../cube-draft.ts';

const BASE = draftDeckList(['fire', 'water', 'earth', 'wood', 'metal']);
const els = (c: string): string[] => getCard(c).factions ?? [];
const mono = (el: string) => BASE.filter(c => els(c).length === 1 && els(c)[0] === el);
const units = (el: string, mana: number) => mono(el).filter(c => getCard(c).kind === 'unit' && getCard(c).mana === mana);
const NONE: WinRates = new Map();
const score = (card: string, picks: string[], wr: WinRates = NONE, seed = 1) =>
  scorePack([card], picks, wr, seed)[0]!.score;
const near = (a: number, b: number, eps = 0.5) => Math.abs(a - b) <= eps + 1e-9;

test('cube §1 shrunk win rate', () => {
  const c = mono('fire')[0]!;
  assert.ok(near(score(c, []), 50 - 1.5), 'no data: 50, less the empty-pool element charge');
  const wr: WinRates = new Map([[c, { n: 10, w: 10 }]]);
  assert.ok(near(score(c, [], wr), 75 - 1.5), '(10 + 5) / (10 + 10) = 75%');
});

test('cube §2 element support', () => {
  const fire = mono('fire')[0]!, water = mono('water')[0]!;
  const gold = BASE.find(c => els(c).length === 2)!;
  assert.ok(near(score(gold, []), 50 - 3), 'a gold card pays per element');
  // a 51% gold card loses P1P1 to a 50% mono card
  const wr: WinRates = new Map([[gold, { n: 10, w: 5.2 }]]);
  const best = scorePack([gold, fire], [], wr, 3);
  assert.equal(best[0]!.card, fire);
  // committed to fire (12 fire cards): water pays the full 6, fire pays nothing
  const pool = mono('fire').slice(1, 13);
  assert.ok(near(score(fire, pool), 50));
  const waterCost = String(getCard(water).cost).length;
  assert.ok(near(score(water, pool), 50 - 6 - 2 * (waterCost - 1)), 'a second affinity of an unsupported element costs 2 more');
  // a second element is fully supported once it is in the top two
  const two = [...pool.slice(0, 8), ...mono('water').slice(1, 5)];
  assert.ok(near(score(water, two), 50));
  assert.equal(botPick([water, mono('earth')[0]!], two, NONE, 9), water);
});

test('cube §3 bombs pull their element', () => {
  const [bomb, card] = mono('wood');
  const wr: WinRates = new Map([[bomb!, { n: 100, w: 80 }]]);   // 85 / 110 = 77%
  const pool = [bomb!, ...mono('wood').slice(5, 10)];
  const base = score(card!, pool, NONE);
  assert.ok(near(score(card!, pool, wr) - base, 1, 1e-9), '+1 for one bomb');
  const wr2: WinRates = new Map([...wr, [pool[1]!, { n: 100, w: 80 }], [pool[2]!, { n: 100, w: 80 }]]);
  assert.ok(near(score(card!, pool, wr2) - base, 2, 1e-9), 'capped at +2');
});

test('cube §4 curve gaps, from pick 14', () => {
  const twos = units('earth', 2), threes = units('earth', 3);
  assert.ok(twos.length >= 8 && threes.length >= 6);
  // 14 earth cards, none of them 2-drop units: an earth 2-drop is short of target
  const filler = mono('earth').filter(c => !twos.includes(c) && c !== threes[0]).slice(0, 14);
  const at13 = filler.slice(0, 13);
  const plain = (picks: string[], c: string) => score(c, picks, NONE, 5);
  assert.ok(near(plain(filler, twos[0]!) - plain(at13, twos[0]!), 1.5, 1e-9), 'the full +1.5 appears at 14 picks');
  assert.ok(near(plain(filler, mono('earth').find(c => getCard(c).kind === 'spell')!)
    - plain(at13, mono('earth').find(c => getCard(c).kind === 'spell')!), 0, 1e-9), 'never for a spell');
  // with the 2-drops already in, no bonus
  const full = [...filler.slice(0, 7), ...twos.slice(1, 8)];
  assert.ok(plain(full, twos[0]!) - plain(at13, twos[0]!) < 1e-9);
});

test('cube §5 jitter is bounded and seeded', () => {
  const pack = mono('metal').slice(0, 12);
  const a = scorePack(pack, [], NONE, 77), b = scorePack(pack, [], NONE, 77), c = scorePack(pack, [], NONE, 78);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  for (const r of [...a, ...c]) assert.ok(r.score >= 48 - 1e-9 && r.score <= 49 + 1e-9);
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1]!.score >= a[i]!.score, 'best first');
});

/** for each seat: picks whose elements lie within the seat's two most-picked elements */
function onTopTwo(picks: string[]): number {
  const n = new Map<string, number>();
  for (const p of picks) for (const e of els(p)) n.set(e, (n.get(e) ?? 0) + 1);
  const top = [...n].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([e]) => e);
  return picks.filter(p => els(p).every(e => top.includes(e))).length;
}

test('cube §6 bots with no data still settle into two elements', () => {
  let bots = 0, naive = 0, seats = 0;
  for (const seed of [1, 2, 3, 4]) {
    const table = Array.from({ length: 8 }, (_, i) => ({ user: null, name: `Bot ${i + 1}` }));
    const d = startDraft(table, BASE, 3, 13, seed, 0);
    advance(d, 1e15, s => botPick(d.seats[s]!.queue[0]!, d.seats[s]!.picks, NONE, seed * 100 + s));
    const f = startDraft(table, BASE, 3, 13, seed, 0);
    advance(f, 1e15, s => f.seats[s]!.queue[0]![0]!);
    for (let s = 0; s < 8; s++) {
      const k = onTopTwo(d.seats[s]!.picks);
      assert.ok(k >= 24, `seed ${seed} seat ${s}: only ${k} of 39 picks in two elements`);
      bots += k; naive += onTopTwo(f.seats[s]!.picks); seats++;
    }
  }
  console.log(`# in two elements, mean of 39: bots ${(bots / seats).toFixed(1)}, first-card ${(naive / seats).toFixed(1)}`);
  assert.ok(bots / seats >= 30);
  assert.ok(bots / seats > naive / seats + 10);
});
