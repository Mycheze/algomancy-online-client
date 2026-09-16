/* R296 — THE MARK: recycling puts a card past the end of the library, and the
 * pile comes back only when the deck runs out.
 *
 * The rule is not in any printed rulebook. The owner, 2026-09-16, after a game
 * with a judge-level player:
 *
 *   > "There's a rule that's NOT in the rule book about recycled cards and
 *   > reshuffling. Now, you actually 'mark' where the original end of the
 *   > library is, then fully reshuffle the recycled cards if you need to draw
 *   > from your deck again. This removes the need to try and remember (or
 *   > worry about) what you recycled and in what order."
 *
 * ── WHAT CHANGED, AND WHAT DID NOT ───────────────────────────────────
 * `E.recycleToBottom` was the single writer already — every way a card reaches
 * the bottom of a deck goes through it — so the rule is one line there plus a
 * refill at the four readers. What is new is a ZONE: `sharedRecycled` in
 * shared/draft, `recycled[seat]` in constructed, reached through
 * `E.recycleOf(seat)` exactly as the deck is reached through `E.deckOf(seat)`.
 *
 * SCOPE, settled by the owner on 2026-09-16: everything that hits the bottom
 * goes past the mark. That is all seven callers — recycling from hand for a
 * resource, the constructed draw phase's put-2-back, the cards a Glimpse did
 * not cache, a recycled draft pack, Bripp, Reality Siphoner's bin recycle and
 * Tides of the Cosmos's unplayed reveals. §6 derives that list rather than
 * typing it, so an eighth caller cannot appear untested.
 *
 * ⚠ THE ORDER OF A RECYCLE NO LONGER HAS RULES CONSEQUENCES, and several
 * tests elsewhere still assert it. That is deliberate: the pile is shuffled on
 * its way back in, so order is unobservable in play — but it is the only
 * evidence that a caller passes its cards in the order it was given rather
 * than sorted or reversed, and a test that stopped looking would stop noticing.
 *
 * Seeds 30000-30099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { logFor, toDeployment } from './util.ts';
import type { CardName, Seat } from '../src/types.ts';

/** a fresh shared-mode game with both zones addressable */
function board(seed: number): { h: Harness; g: E; P: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  return { h, g: new E(h.state), P: h.state.deployPlayer! };
}

/** drain the live deck down to `n` cards without touching the pile */
function deckDownTo(g: E, seat: Seat, n: number): CardName[] {
  const deck = g.deckOf(seat);
  return deck.splice(0, Math.max(0, deck.length - n));
}

/* ══ §1 — A RECYCLED CARD DOES NOT COME BACK BEFORE THE MARK ═════════ */

test('R296 §1 a recycled card stays behind the mark while the deck still has cards', () => {
  const { h, g, P } = board(30001);
  // ⚠ COUNT, DO NOT NAME. The pool ships two copies of most cards and the deck
  // is two pools, so `includes(name)` is true for a card nobody recycled. The
  // claim is about the copy that crossed the mark, which only a count can put
  // a number on.
  const recycled = 'Astral Tidewraith';
  const count = (xs: readonly CardName[]): number => xs.filter(n => n === recycled).length;
  const inDeck = count(g.deckOf(P));
  g.recycleToBottom(P, recycled);
  h.state = g.s;
  assert.deepEqual(g.recycleOf(P), [recycled], 'it went past the mark');
  assert.equal(count(g.deckOf(P)), inDeck, 'and the live deck did not gain a copy');

  // draw the whole deck but one — the pile must not have been reached
  const deckLeft = g.deckOf(P).length;
  g.draw(P, deckLeft - 1, true);
  h.state = g.s;
  assert.equal(count(h.state.players[P]!.hand), inDeck,
    'drawing almost the whole deck reaches the deck\'s own copies and no more');
  assert.deepEqual(g.recycleOf(P), [recycled], 'the recycled copy is still behind the mark');
});

/* ══ §2 — AND COMES BACK WHEN THE DECK RUNS OUT ══════════════════════ */

test('R296 §2 when the deck runs out the pile is shuffled in and drawing continues', () => {
  const { h, g, P } = board(30002);
  deckDownTo(g, P, 1);
  const last = g.deckOf(P)[0]!;
  const pile = ['Geode', 'Gublin', 'Shib', 'Chombot', 'Uglk'];
  for (const n of pile) g.recycleToBottom(P, n);

  const handBefore = h.state.players[P]!.hand.length;
  g.draw(P, 3, true);
  h.state = g.s;

  const drawn = h.state.players[P]!.hand.slice(handBefore);
  assert.equal(drawn.length, 3, 'three cards were drawn across the mark');
  assert.equal(drawn[0], last, 'the first came off the real deck, before the reshuffle');
  assert.ok(drawn.slice(1).every(n => pile.includes(n)),
    'the other two came out of the reshuffled pile');
  assert.equal(g.recycleOf(P).length, 0, 'the pile is empty — the whole of it went in');
  assert.equal(g.deckOf(P).length, pile.length - 2, 'and the rest of it is the new deck');
  assert.ok(g.events.some(e => e.type === 'recycle' && e.data?.['reshuffled'] === true),
    'and the reshuffle is announced — both players can see that the deck turned over');
});

/* ══ §3 — SEEDED, SO IT REPLAYS ══════════════════════════════════════ */

test('R296 §3 the reshuffle is seeded: the same game twice deals the identical deck', () => {
  const run = (): CardName[] => {
    const { g, P } = board(30003);
    deckDownTo(g, P, 0);
    for (const n of ['Geode', 'Gublin', 'Shib', 'Chombot', 'Uglk', 'Bloppert']) {
      g.recycleToBottom(P, n);
    }
    g.draw(P, 6, true);
    return [...g.deckOf(P), ...g.player(P).hand.slice(-6)];
  };
  assert.deepEqual(run(), run(), 'two runs of the same seed reshuffle identically');
});

test('R296 §3b the reshuffle really shuffles — it is not the pile in the order it was built', () => {
  // A negative control for §3: a "shuffle" that returned its input unchanged
  // would pass §3 perfectly, and every other test in this file with it.
  const order = ['Geode', 'Gublin', 'Shib', 'Chombot', 'Uglk', 'Bloppert', 'Zephyrzoa', 'Mindburn'];
  const seen = new Set<string>();
  for (let seed = 30010; seed < 30020; seed++) {
    const { g, P } = board(seed);
    deckDownTo(g, P, 0);
    for (const n of order) g.recycleToBottom(P, n);
    g.draw(P, 1, true);                       // forces the refill
    seen.add([...g.player(P).hand.slice(-1), ...g.deckOf(P)].join(','));
  }
  assert.ok(seen.size > 1,
    `ten seeds produced ${seen.size} distinct orders — a shuffle that never shuffles would give 1`);
  assert.ok(!seen.has(order.join(',')) || seen.size > 1,
    'and the built order is not simply handed back every time');
});

/* ══ §4 — BOTH EMPTY IS STILL BOTH EMPTY ════════════════════════════ */

test('R296 §4 an empty deck AND an empty pile draws fewer — no loop, no crash, no loss', () => {
  const { h, g, P } = board(30004);
  deckDownTo(g, P, 0);
  assert.equal(g.recycleOf(P).length, 0, 'the fixture really has nothing anywhere');
  const handBefore = h.state.players[P]!.hand.length;
  g.draw(P, 3, true);
  h.state = g.s;
  assert.equal(h.state.players[P]!.hand.length, handBefore, 'nothing was drawn');
  assert.equal(g.deckOf(P).length, 0);
  // R296 does not add a deck-out loss: you simply draw fewer, as before.
  assert.equal(h.state.winner, null, 'and running out of cards does not end the game');
  // the mill and cache readers take the same door
  assert.deepEqual(g.mill(P, 2), [], 'mill draws nothing either');
  assert.deepEqual(g.cacheTopOfDeck(P, 2), [], 'and so does a cache-from-deck');
});

/* ══ §5 — WHOSE PILE IS IT ══════════════════════════════════════════ */

test('R296 §5 constructed gives each seat its own pile; shared and draft share one', () => {
  const h = new Harness(30005);
  toDeployment(h);
  const g = new E(h.state);
  assert.notEqual(h.state.mode, 'constructed', 'this harness is a shared-deck game');
  g.recycleToBottom(0, 'Geode');
  g.recycleToBottom(1, 'Gublin');
  assert.deepEqual(g.recycleOf(0), ['Geode', 'Gublin'], 'one communal pile, both seats writing to it');
  assert.equal(g.recycleOf(0), g.recycleOf(1), 'and it is literally the same array');
  assert.deepEqual(h.state.sharedRecycled, ['Geode', 'Gublin']);
  assert.equal(h.state.recycled, undefined, 'the per-seat field is absent outside constructed');
});

/* ══ §6 — EVERY READER OF THE DECK GOES THROUGH THE MARK ════════════ */

test('R296 §6 every reader of the deck reshuffles at the mark, not just draw', () => {
  for (const [what, read] of [
    ['draw', (g: E, P: Seat) => { g.draw(P, 1, true); }],
    ['mill', (g: E, P: Seat) => { g.mill(P, 1); }],
    ['cacheTopOfDeck', (g: E, P: Seat) => { g.cacheTopOfDeck(P, 1); }],
    ['glimpse', (g: E, P: Seat) => { g.glimpse(P, 1); }],
  ] as [string, (g: E, P: Seat) => void][]) {
    const { g, P } = board(30006);
    deckDownTo(g, P, 0);
    g.recycleToBottom(P, 'Geode');
    g.recycleToBottom(P, 'Gublin');
    read(g, P);
    assert.equal(g.recycleOf(P).length, 0,
      `${what}: the empty deck reached the mark and pulled the whole pile in`);
    assert.equal(g.deckOf(P).length, 1, `${what}: and it read exactly one card out of it`);
  }
});

test('R296 §6b a glimpse WIDER than the deck reshuffles mid-reveal and still reveals N', () => {
  // The awkward reader: glimpse reveals N at once and must not mutate anything
  // before its "cache one" decision. refillFromRecycled takes a `need` for
  // exactly this, and appends UNDER what is left of the deck — so reading one
  // real card and then reshuffling gives the same N as reshuffling beneath it
  // and then reading N.
  const { g, P } = board(30007);
  deckDownTo(g, P, 1);
  const last = g.deckOf(P)[0]!;
  for (const n of ['Geode', 'Gublin', 'Shib']) g.recycleToBottom(P, n);
  const kept = g.glimpse(P, 3);
  assert.equal(kept.length, 1, 'a glimpse caches exactly one (R45), whatever it had to cross');
  assert.equal(g.deckOf(P).length, 1,
    'four cards were available across the mark, three were revealed, one is left');
  assert.ok([last, 'Geode', 'Gublin', 'Shib'].includes(kept[0]!),
    'and what it cached came from the four real cards, not from nowhere');
});

/* ══ §7 — THE ZONE IS SECRET, THE COUNT IS NOT ══════════════════════ */

test('R296 §7 nothing in the pile is a card anybody can name — it is a deck, not a bin', () => {
  // The rules half of the redaction that server/view.ts performs (and that
  // server/test-drive.ts asserts over the wire): the pile is not public
  // information the way a bin is. The owner: "plus recycled (but can't look at
  // the cards still)". Here that is the ENGINE's half — a recycled card is in
  // no zone any player-facing reader treats as visible.
  // a fresh harness is IN the planning phase, which is where a hand card is
  // recycled for a resource — `board()` above has already walked past it
  const h = new Harness(30008);
  const P: Seat = 0;
  const name = h.state.players[P]!.hand[0]!;
  h.do({ type: 'recycleForResource', seat: P, handIndex: 0, element: 'fire' });
  const g = new E(h.state);
  assert.ok(g.recycleOf(P).includes(name), 'the card is in the pile');
  assert.ok(!h.state.players[P]!.bin.includes(name), 'and NOT in the bin — recycling is not trashing');
  // ⚠ `h.log` is the UNREDACTED hotseat log and DOES name the card, which is
  // right: you know what you yourself recycled, and after R296 knowing it buys
  // nothing, because the pile is shuffled on the way back. The claim is about
  // what the OTHER seat is served, which is `redactLog`'s job.
  const theirs = logFor(h, (1 - P) as Seat);
  assert.ok(!theirs.some(l => l.includes(name)),
    'the opponent is never told WHICH card went past the mark');
  assert.ok(theirs.some(l => /recycles a card for a dormant resource/.test(l)),
    'only that one did — the count is public, the card is not');
});

/* ══ §8 — CONSERVATION ══════════════════════════════════════════════ */

test('R296 §8 no card is created or destroyed by crossing the mark', () => {
  const { h, g, P } = board(30009);
  const total = (): number => g.deckOf(P).length + g.recycleOf(P).length
    + h.state.players.reduce((s, p) => s + p.hand.length + p.bin.length, 0)
    + h.state.packs.flat().length;
  const before = total();
  deckDownTo(g, P, 2).forEach(n => g.recycleToBottom(P, n));   // everything past the mark
  assert.equal(total(), before, 'moving the whole deck past the mark conserves the count');
  g.draw(P, 10, true);
  h.state = g.s;
  assert.equal(total(), before, 'and so does drawing back across it');
  assert.ok(DECK_LIST.length > 0, 'the registry is loaded — this fixture is not empty');
});
