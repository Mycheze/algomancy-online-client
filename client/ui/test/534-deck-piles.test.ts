/* THE TABLETOP'S PILE MODEL — ui/deckarrange.ts, pure.
 *
 * Owner, 2026-10-21 (spec v2): the deck lies on a table in piles; a deck with
 * no layout starts as piles by cost; drag any single copy anywhere; a pile
 * emptied by a drag goes; Re-sort by cost, type or element. All of it is
 * ARRANGEMENT ONLY — nothing here may add, remove or count a card of the deck,
 * which is the property most of these cases come back to.
 *
 *   §1  seedPiles by cost / type / element: every copy kept (multiset), one
 *       pile per decklayout section, cost order inside a pile, `auto` keys
 *   §2  movePileCard BY INDEX, with the AFTER-REMOVAL index convention —
 *       same pile and across piles, every position checked exhaustively
 *   §3  insertCard / removeAt / newPileAt / movePile
 *   §4  an emptied UNNAMED pile disappears, a NAMED one stays
 *   §5  reconcile: multiset equality over randomised add/cut sequences, never
 *       reordering a placed card, idempotent; the deficit order; the surplus
 *   §6  rename / delete
 *   §7  pure: no input is ever mutated
 *   §8  the Sorted half of v1 is gone, deleted rather than left behind
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { analyzeDeck, cardFacts } from '../deckstats.ts';
import { byCost, deckSections } from '../decklayout.ts';
import {
  deletePile, insertCard, movePile, movePileCard, newPileAt, reconcilePiles, removeAt, renamePile, seedPiles,
  type DeckPile, type ResortBy,
} from '../deckarrange.ts';

/** a deterministic PRNG, so a red run can be re-run */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const facts = DECK_LIST.map(n => cardFacts(n)!);
const firstOf = (p: (f: NonNullable<ReturnType<typeof cardFacts>>) => boolean): string => facts.find(p)!.name;
const UNIT = firstOf(f => f.kind === 'unit' && !f.isX);
const UNIT2 = facts.filter(f => f.kind === 'unit' && !f.isX && f.mana !== cardFacts(UNIT)!.mana)[0]!.name;
const SPELL = firstOf(f => f.kind === 'spell' && !f.isX);
const SPELL_UNIT = firstOf(f => f.kind === 'spellUnit');
const XCARD = firstOf(f => f.isX);
const UNKNOWN = 'Not A Card In This Build';
const BYS: ResortBy[] = ['cost', 'type', 'element'];

/** a deck with every kind of bucket in it: numbers, X, a card the build lacks */
const MIXED = [UNIT, UNIT, UNIT2, SPELL, SPELL_UNIT, XCARD, UNKNOWN, ...DECK_LIST.slice(40, 60)];
const DECKS: string[][] = [MIXED, DECK_LIST.slice(100, 140).flatMap(n => [n, n]), [...DECK_LIST]];

const tally = (list: readonly string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const n of list) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
};
const sameMultiset = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify([...tally(a)].sort()) === JSON.stringify([...tally(b)].sort());
const all = (ps: readonly DeckPile[]): string[] => ps.flatMap(p => p.cards);
const cardsOf = (ps: readonly DeckPile[]): string[][] => ps.map(p => p.cards);

/* ══ §1 seed ═══════════════════════════════════════════════════════════ */

test('§1 ⭐ seedPiles keeps every copy, one pile per decklayout section, cost order inside', () => {
  for (const cards of DECKS) {
    for (const by of BYS) {
      const seed = seedPiles(cards, by);
      assert.ok(sameMultiset(all(seed), cards), `${by}: the seed holds the deck exactly`);
      const secs = deckSections(analyzeDeck(cards), by);
      assert.deepEqual(seed.map(p => p.auto), secs.map(s => `${by}:${s.key}`), `${by}: a pile per section, in section order`);
      seed.forEach((p, i) => {
        assert.deepEqual(p.cards, secs[i]!.entries.flatMap(e => Array(e.n).fill(e.name)), `${by}/${p.name}: cost order`);
        const entries = p.cards.map(name => ({ name, n: 1, facts: cardFacts(name) }));
        assert.deepEqual([...entries].sort(byCost).map(e => e.name), p.cards, 'byCost, copies adjacent');
      });
      assert.equal(new Set(seed.map(p => p.id)).size, seed.length, 'ids unique');
      assert.ok(seed.every(p => /^[A-Za-z0-9_-]{1,16}$/.test(p.id)), 'ids the server keeps');
      assert.ok(seed.every(p => !p.named), 'a seeded pile is not one the user named');
      assert.deepEqual(reconcilePiles(cards, seed), seed, 'a fresh seed needs no reconcile');
    }
  }
});

test('§1 the cost piles are named by the number, cheapest first, then X; the others by their section', () => {
  const cost = seedPiles(MIXED, 'cost');
  const nums = cost.filter(p => /^\d+$/.test(p.name)).map(p => Number(p.name));
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b), 'cost order');
  assert.ok(nums.length >= 2);
  assert.equal(cost[nums.length]!.name, 'X', 'X after every number');
  assert.ok(cost.find(p => p.name === 'X')!.cards.includes(XCARD));
  assert.equal(cost.at(-1)!.auto, 'cost:unknown', 'a card the build lacks sorts last, never as a 0-drop');
  assert.deepEqual(seedPiles([UNIT, SPELL, SPELL_UNIT], 'type').map(p => [p.name, p.auto]),
    [['Units', 'type:units'], ['Spells', 'type:spells'], ['Spell units', 'type:spellUnits']]);
  assert.ok(seedPiles(MIXED, 'element').every(p => p.auto!.startsWith('element:')));
  assert.deepEqual(seedPiles([], 'cost'), [], 'an empty deck is an empty table');
});

/* ══ §2 move by index ══════════════════════════════════════════════════ */

/** the reference: take the copy out, then insert at the index among what is LEFT */
function expected(piles: DeckPile[], from: string, fi: number, to: string, ti: number): string[][] {
  const out = piles.map(p => [...p.cards]);
  const f = piles.findIndex(p => p.id === from);
  const t = piles.findIndex(p => p.id === to);
  const [c] = out[f]!.splice(fi, 1);
  out[t]!.splice(Math.min(ti, out[t]!.length), 0, c!);
  return out;
}

test('§2 ⭐ movePileCard moves THE copy at the index, to the index counted AFTER it left — exhaustively', () => {
  const piles: DeckPile[] = [
    { id: 'a', name: 'A', cards: ['a0', 'a1', 'a2', 'a3'], named: true },
    { id: 'b', name: 'B', cards: ['b0', 'b1'], named: true },
  ];
  for (const from of piles) {
    for (let fi = 0; fi < from.cards.length; fi++) {
      for (const to of piles) {
        const room = to.cards.length - (to === from ? 1 : 0);
        for (let ti = 0; ti <= room; ti++) {
          const got = movePileCard(piles, from.id, fi, to.id, ti);
          assert.deepEqual(cardsOf(got), expected(piles, from.id, fi, to.id, ti), `${from.id}[${fi}] → ${to.id}@${ti}`);
          assert.equal(got[piles.indexOf(to)]!.cards[ti], from.cards[fi], 'the moved copy sits AT the index');
        }
      }
    }
  }
  // the worked example the doc gives
  const row: DeckPile[] = [{ id: 'q', name: 'q', cards: ['a', 'b', 'c', 'd'] }];
  assert.deepEqual(movePileCard(row, 'q', 1, 'q', 2)[0]!.cards, ['a', 'c', 'b', 'd']);
  assert.deepEqual(movePileCard(row, 'q', 3, 'q', 0)[0]!.cards, ['d', 'a', 'b', 'c']);
  assert.deepEqual(movePileCard(row, 'q', 0, 'q', 99)[0]!.cards, ['b', 'c', 'd', 'a'], 'past the end clamps to the end');
});

test('§2 ⭐ copies of one name are separate: the copy under the pointer moves, not "the last one"', () => {
  const piles: DeckPile[] = [{ id: 'p', name: 'p', cards: [UNIT, SPELL, UNIT, XCARD], named: true }, { id: 'r', name: 'r', cards: [] , named: true }];
  assert.deepEqual(cardsOf(movePileCard(piles, 'p', 0, 'r', 0)), [[SPELL, UNIT, XCARD], [UNIT]], 'the FIRST copy left');
  assert.deepEqual(cardsOf(movePileCard(piles, 'p', 2, 'r', 0)), [[UNIT, SPELL, XCARD], [UNIT]], 'the SECOND copy left');
  assert.deepEqual(movePileCard(piles, 'p', 4, 'r', 0), piles, 'an index the pile does not have changes nothing');
  assert.deepEqual(movePileCard(piles, 'p', -1, 'r', 0), piles);
  assert.deepEqual(movePileCard(piles, 'p', 1.5, 'r', 0), piles);
  assert.deepEqual(movePileCard(piles, 'p', 0, 'nope', 0), piles, 'an unknown pile changes nothing');
  assert.deepEqual(movePileCard(piles, 'nope', 0, 'r', 0), piles);
});

/* ══ §3 the other edits ════════════════════════════════════════════════ */

test('§3 insertCard / removeAt: one copy on or off the table, at the index', () => {
  const piles: DeckPile[] = [{ id: 'p', name: 'p', cards: [UNIT, SPELL] }, { id: 'q', name: 'q', cards: [XCARD] }];
  assert.deepEqual(cardsOf(insertCard(piles, UNIT2, 'p', 1)), [[UNIT, UNIT2, SPELL], [XCARD]]);
  assert.deepEqual(cardsOf(insertCard(piles, UNIT2, 'p', 0)), [[UNIT2, UNIT, SPELL], [XCARD]]);
  assert.deepEqual(cardsOf(insertCard(piles, UNIT2, 'p', 99)), [[UNIT, SPELL, UNIT2], [XCARD]], 'past the end = at the end');
  assert.deepEqual(insertCard(piles, UNIT2, 'nope', 0), piles, 'an unknown pile changes nothing');

  const r = removeAt(piles, 'p', 1);
  assert.equal(r.name, SPELL);
  assert.deepEqual(cardsOf(r.piles), [[UNIT], [XCARD]]);
  assert.deepEqual(removeAt(piles, 'p', 2), { piles, name: null }, 'no such copy: nothing taken');
  assert.deepEqual(removeAt(piles, 'nope', 0), { piles, name: null });
});

test('§3 newPileAt: an empty pile at a row position, clamped; named only when given a name', () => {
  const piles: DeckPile[] = [{ id: 'p1', name: 'One', cards: [UNIT] }, { id: 'p2', name: 'Two', cards: [SPELL] }];
  for (const at of [0, 1, 2]) {
    const out = newPileAt(piles, at);
    assert.equal(out.length, 3);
    assert.deepEqual(out[at], { id: 'p3', name: 'Pile 3', cards: [] }, `at ${at}: inserted there, fresh id, unnamed`);
    assert.deepEqual(out.filter((_, i) => i !== at), piles, 'the others in order');
  }
  assert.equal(newPileAt(piles, 99).at(-1)!.id, 'p3', 'past the end = last');
  assert.equal(newPileAt(piles, -5)[0]!.id, 'p3', 'before the start = first');
  const named = newPileAt(piles, 1, '  Tricks ');
  assert.deepEqual(named[1], { id: 'p3', name: 'Tricks', cards: [], named: true });
  assert.equal(newPileAt(piles, 0, 'one')[0]!.name, 'one · 2', 'a clashing name is told apart (case-blind)');
  assert.equal(newPileAt(piles, 0, 'x'.repeat(60))[0]!.name.length, 40);
  // a gutter drop: a new pile, then the card into it by id — even when the
  // source pile empties away and the row shifts under it
  const one: DeckPile[] = [{ id: 'p1', name: 'One', cards: [UNIT] }, { id: 'p2', name: 'Two', cards: [SPELL] }];
  const made = newPileAt(one, 1);
  const id = made[1]!.id;
  assert.deepEqual(movePileCard(made, 'p1', 0, id, 0).map(p => [p.id, p.cards]), [[id, [UNIT]], ['p2', [SPELL]]]);
});

test('§3 movePile: the pile at `from` to `to`, counted after it left — exhaustively', () => {
  const piles: DeckPile[] = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id, cards: [id] }));
  for (let from = 0; from < 4; from++) {
    for (let to = 0; to < 4; to++) {
      const ids = piles.map(p => p.id);
      const [x] = ids.splice(from, 1);
      ids.splice(to, 0, x!);
      const got = movePile(piles, from, to);
      assert.deepEqual(got.map(p => p.id), ids, `${from} → ${to}`);
      assert.equal(got[to]!.id, piles[from]!.id, 'the moved pile sits AT `to`');
    }
  }
  assert.deepEqual(movePile(piles, 4, 0), piles, 'out of range changes nothing');
  assert.deepEqual(movePile(piles, 0, 99).map(p => p.id), ['b', 'c', 'd', 'a'], 'past the end = last');
});

/* ══ §4 empty piles ════════════════════════════════════════════════════ */

test('§4 ⭐ a pile emptied by a drag disappears — unless the user named it', () => {
  const piles: DeckPile[] = [
    { id: 'u', name: 'Pile 1', cards: [UNIT] },
    { id: 'n', name: 'Keepers', cards: [SPELL], named: true },
    { id: 't', name: 'Target', cards: [XCARD] },
  ];
  assert.deepEqual(movePileCard(piles, 'u', 0, 't', 0).map(p => p.id), ['n', 't'], 'unnamed + emptied by a move: gone');
  assert.deepEqual(movePileCard(piles, 'n', 0, 't', 0).map(p => [p.id, p.cards.length]), [['u', 1], ['n', 0], ['t', 2]],
    'named: stays, empty');
  assert.deepEqual(removeAt(piles, 'u', 0).piles.map(p => p.id), ['n', 't'], 'emptied to the binder: gone');
  assert.deepEqual(removeAt(piles, 'n', 0).piles.map(p => p.id), ['u', 'n', 't']);
  assert.deepEqual(movePileCard(piles, 'u', 0, 'u', 0), piles, 'a card put back where it was empties nothing');
  // a rename is what makes a pile named
  const renamed = renamePile(piles, 'u', 'Mine');
  assert.equal(renamed[0]!.named, true);
  assert.deepEqual(removeAt(renamed, 'u', 0).piles.map(p => p.id), ['u', 'n', 't']);
  // and reconcile never drops a pile: only a drag empties one away
  assert.deepEqual(reconcilePiles([SPELL, XCARD], piles).map(p => [p.id, p.cards.length]), [['u', 0], ['n', 1], ['t', 1]]);
});

/* ══ §5 reconcile ══════════════════════════════════════════════════════ */

test('§5 ⭐ reconcile: the piles hold exactly the deck, over randomised add/cut/move sequences', () => {
  const r = rng(53402);
  const names = DECK_LIST.slice(0, 25);
  let cards = names.slice(0, 15).flatMap(n => [n, n]);
  let piles = seedPiles(cards, 'cost');
  for (let step = 0; step < 400; step++) {
    const roll = r();
    if (roll < 0.4 || !cards.length) cards = [...cards, names[Math.floor(r() * names.length)]!];
    else if (roll < 0.8) cards = cards.filter((_, i, list) => i !== Math.floor(r() * list.length));
    else if (roll < 0.9) piles = newPileAt(piles, Math.floor(r() * (piles.length + 1)));
    else if (piles.length) {
      const f = piles[Math.floor(r() * piles.length)]!;
      const t = piles[Math.floor(r() * piles.length)]!;
      if (f.cards.length) piles = movePileCard(piles, f.id, Math.floor(r() * f.cards.length), t.id, Math.floor(r() * (t.cards.length + 1)));
    }
    const next = reconcilePiles(cards, piles);
    assert.ok(sameMultiset(all(next), cards), `step ${step}: the multiset is the deck's`);
    assert.deepEqual(reconcilePiles(cards, next), next, `step ${step}: idempotent`);
    for (const before of piles) {
      const after = next.find(p => p.id === before.id)!;
      assert.ok(after, 'no pile is dropped');
      const kept = after.cards.filter(c => before.cards.includes(c));
      const was = before.cards.filter(c => after.cards.includes(c));
      // equal-name copies are interchangeable; compare the order of first appearances
      const firsts = (l: string[]) => l.filter((c, i) => l.indexOf(c) === i);
      assert.deepEqual(firsts(kept), firsts(was), `step ${step}: pile ${before.id} kept its order`);
    }
    piles = next;
  }
});

test('§5 ⭐ a deficit goes to the pile holding the name, else its Re-sort bucket\'s pile, else "New" at the front', () => {
  const costOf = (n: string) => String(cardFacts(n)!.mana);
  const piles: DeckPile[] = [
    { id: 'a', name: 'Mine', cards: [SPELL] },
    { id: 'b', name: 'Units', cards: [UNIT2], auto: 'type:units' },
    { id: 'c', name: 'Also mine', cards: [UNIT] },
  ];
  // 1. a second UNIT joins its first copy — in pile c, not the "units" pile b
  assert.deepEqual(cardsOf(reconcilePiles([SPELL, UNIT2, UNIT, UNIT], piles)), [[SPELL], [UNIT2], [UNIT, UNIT]]);
  // 2. a unit nobody holds goes to the pile whose bucket is its own
  const NEWUNIT = facts.find(f => f.kind === 'unit' && ![UNIT, UNIT2].includes(f.name))!.name;
  assert.deepEqual(cardsOf(reconcilePiles([SPELL, UNIT2, UNIT, NEWUNIT], piles)), [[SPELL], [UNIT2, NEWUNIT], [UNIT]]);
  // …under that pile's OWN Re-sort: a cost pile takes a card of its cost
  const SAMECOST = facts.find(f => !f.isX && String(f.mana) === costOf(SPELL) && f.name !== SPELL)!.name;
  const byCostPiles: DeckPile[] = [{ id: 'x', name: 'x', cards: [] }, { id: 'k', name: costOf(SPELL), cards: [], auto: `cost:${costOf(SPELL)}` }];
  assert.deepEqual(cardsOf(reconcilePiles([SAMECOST], byCostPiles)), [[], [SAMECOST]]);
  // 3. a spell unit has no holder and no bucket pile → a "New" pile, made at the FRONT
  const three = reconcilePiles([SPELL, UNIT2, UNIT, SPELL_UNIT], piles);
  assert.equal(three[0]!.name, 'New');
  assert.deepEqual(three[0]!.cards, [SPELL_UNIT]);
  assert.ok(!piles.some(p => p.id === three[0]!.id), 'with an id of its own');
  assert.ok(!three[0]!.named, 'and not a pile the user named');
  // …and an existing "New" is reused, wherever it is
  const four = reconcilePiles([SPELL, UNIT2, UNIT, SPELL_UNIT], [...piles, { id: 'n', name: 'New', cards: [] }]);
  assert.equal(four.length, 4);
  assert.deepEqual(four[3]!.cards, [SPELL_UNIT]);
  // a malformed bucket attracts nothing
  assert.equal(reconcilePiles([UNIT], [{ id: 'z', name: 'z', cards: [], auto: 'bogus' }])[0]!.name, 'New');
  // an empty table: the binder's first card makes the first pile
  assert.deepEqual(reconcilePiles([UNIT], []).map(p => [p.name, p.cards]), [['New', [UNIT]]]);
});

test('§5 ⭐ surplus comes off the LAST pile holding the name', () => {
  const piles: DeckPile[] = [
    { id: 'a', name: 'A', cards: [UNIT, SPELL] },
    { id: 'b', name: 'B', cards: [UNIT] },
    { id: 'c', name: 'C', cards: [SPELL, UNIT] },
  ];
  assert.deepEqual(cardsOf(reconcilePiles([UNIT, UNIT, SPELL, SPELL], piles)), [[UNIT, SPELL], [UNIT], [SPELL]]);
  assert.deepEqual(cardsOf(reconcilePiles([UNIT, SPELL], piles)), [[UNIT, SPELL], [], []], 'empty piles are kept');
  assert.deepEqual(cardsOf(reconcilePiles([], piles)), [[], [], []]);
});

/* ══ §6 rename, delete ═════════════════════════════════════════════════ */

test('§6 rename and delete — and never change the cards', () => {
  const base: DeckPile[] = [
    { id: 'p1', name: 'Units', cards: [UNIT, UNIT2, UNIT] },
    { id: 'p2', name: 'Spells', cards: [SPELL] },
  ];
  assert.deepEqual(renamePile(base, 'p2', '  Tricks ')[1], { id: 'p2', name: 'Tricks', cards: [SPELL], named: true });
  assert.deepEqual(renamePile(base, 'p2', '   ')[1], base[1], 'a blank rename keeps the name, and does not mark it');
  assert.equal(renamePile(base, 'p2', 'units')[1]!.name, 'units · 2', 'a clashing name is told apart');
  const del = deletePile(base, 'p1');
  assert.deepEqual(del, [{ id: 'p2', name: 'Spells', cards: [UNIT, UNIT2, UNIT, SPELL] }],
    'the cards go to the front of the NEXT pile — reading order unchanged');
  assert.deepEqual(deletePile(base, 'p2')[0]!.cards, [UNIT, UNIT2, UNIT, SPELL], 'the last pile hands back to the previous');
  assert.deepEqual(deletePile(del, 'p2'), del, 'the only pile cannot be deleted');
  for (const ps of [del, renamePile(base, 'p1', 'x'), movePile(base, 0, 1)]) assert.ok(sameMultiset(all(ps), all(base)), 'same cards');
});

/* ══ §7 pure ═══════════════════════════════════════════════════════════ */

test('§7 ⭐ pure: no edit mutates the piles it was given', () => {
  const base: DeckPile[] = [
    { id: 'p1', name: 'Units', cards: [UNIT, UNIT2, UNIT], auto: 'type:units' },
    { id: 'p2', name: 'Spells', cards: [SPELL], named: true },
  ];
  const frozen = JSON.stringify(base);
  const cards = [UNIT, UNIT2, SPELL, XCARD];
  const frozenCards = JSON.stringify(cards);
  const outs = [
    movePileCard(base, 'p1', 0, 'p2', 1), movePileCard(base, 'p2', 0, 'p1', 0), insertCard(base, XCARD, 'p1', 1),
    removeAt(base, 'p2', 0).piles, newPileAt(base, 1, 'n'), movePile(base, 0, 1), renamePile(base, 'p1', 'y'),
    deletePile(base, 'p1'), reconcilePiles(cards, base), seedPiles(cards, 'type'),
  ];
  assert.equal(JSON.stringify(base), frozen, 'the piles are untouched');
  assert.equal(JSON.stringify(cards), frozenCards, 'the list is untouched');
  // and no output shares a cards array with the input
  for (const out of outs) for (const p of out) for (const q of base) assert.notEqual(p.cards, q.cards);
});

/* ══ §8 v1's Sorted half is gone ═══════════════════════════════════════ */

test('§8 the Sorted half (sortMoves and its grid) is deleted, not left behind', () => {
  const src = readFileSync(new URL('../deckarrange.ts', import.meta.url), 'utf8');
  for (const gone of ['SortMoves', 'SortCell', 'RowSplit', 'sortedGrid', 'normaliseMoves', 'moveTo', 'putBack',
    'putAllBack', 'naturalCell', 'validRow', 'colKeyOf']) {
    assert.ok(!new RegExp(`export (?:function|const|type|interface) ${gone}\\b`).test(src), `${gone} is gone`);
  }
  const layout = readFileSync(new URL('../decklayout.ts', import.meta.url), 'utf8');
  assert.ok(!/export function costColumns/.test(layout), 'and decklayout\'s costColumns with it');
});
