/* M4 live draft (Manual p.16-17): the draft-mode deck, the per-turn draft
 * step (hand↔pack merge with the leave-exactly-10 invariant), 1v1 pack
 * passing, and the N+1-turn pack refresh with recycle-to-bottom. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { createGame, DRAFT_TRIO, IllegalAction, legalActions } from '../src/apply.ts';
import { packCycle } from '../src/engine.ts';
import { draftDeckList, DECK_LIST } from '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { Seat } from '../src/types.ts';
import { skipHasteStep, toDeployment } from './util.ts';

// ── the draft pool ────────────────────────────────────────────────────

test('draft deck: the fire+water+earth trio is Manual-exact — 54 per element + 5 per pair = 177', () => {
  const deck = draftDeckList(DRAFT_TRIO);
  assert.equal(deck.length, 177);
  assert.equal(new Set(deck).size, 177, 'one copy of each card');
  const byFaction: Record<string, number> = {};
  for (const n of deck) {
    const f = [...(getCard(n).factions ?? [])].sort().join('+');
    byFaction[f] = (byFaction[f] ?? 0) + 1;
    assert.ok((getCard(n).factions ?? []).every(el => (DRAFT_TRIO as string[]).includes(el)), `${n} outside the trio`);
  }
  assert.equal(byFaction['fire'], 54);
  assert.equal(byFaction['water'], 54);
  assert.equal(byFaction['earth'], 54);
  assert.equal(byFaction['fire+water'], 5);
  assert.equal(byFaction['earth+water'], 5);
  assert.equal(byFaction['earth+fire'], 5);
});

test('draft deck is a subset of the playable deck list', () => {
  const all = new Set(DECK_LIST);
  for (const n of draftDeckList(DRAFT_TRIO)) assert.ok(all.has(n), `${n} not in DECK_LIST`);
});

// ── game creation ─────────────────────────────────────────────────────

test('createGame draft: 6-card hands (opening 4 + turn-1 draws), 10-card packs, draft step open', () => {
  const h = new Harness(2000, undefined, 'draft');
  assert.equal(h.state.mode, 'draft');
  assert.equal(h.state.turn, 1);
  for (const seat of [0, 1]) {
    assert.equal(h.state.players[seat]!.hand.length, 6, `seat ${seat} hand`);
    assert.equal(h.state.packs[seat]!.length, 10, `seat ${seat} pack`);
  }
  // 177 - 2×6 hands - 2×10 packs
  assert.equal(h.state.sharedDeck.length, 177 - 32);
  assert.deepEqual(h.state.draftDone, [false, false]);
});

test('shared mode is untouched: no packs, no draft step, 7-card turn-1 hands', () => {
  const h = new Harness(2000);
  assert.equal(h.state.mode, 'shared');
  assert.deepEqual(h.state.packs, [[], []]);
  assert.equal(h.state.draftDone, null);
  assert.equal(h.state.players[0]!.hand.length, 7); // opening 5 + draw 2
});

// ── the commit ────────────────────────────────────────────────────────

/** commit that keeps the pack exactly as dealt */
function noopCommit(h: Harness, seat: Seat): void {
  const H = h.state.players[seat]!.hand.length;
  const packIndices = h.state.packs[seat]!.map((_, i) => H + i);
  h.do({ type: 'draftCommit', seat, packIndices });
}

test('no-op commit preserves hand and pack exactly; both commits pass the packs', () => {
  const h = new Harness(2001, undefined, 'draft');
  const hand0 = [...h.state.players[0]!.hand];
  const pack0 = [...h.state.packs[0]!];
  const pack1 = [...h.state.packs[1]!];
  noopCommit(h, 0);
  assert.deepEqual(h.state.players[0]!.hand, hand0);
  assert.deepEqual(h.state.packs[0], pack0);
  assert.deepEqual(h.state.draftDone, [true, false]);
  noopCommit(h, 1);
  // 1v1 clockwise pass = swap
  assert.equal(h.state.draftDone, null);
  assert.deepEqual(h.state.packs[0], pack1);
  assert.deepEqual(h.state.packs[1], pack0);
});

test('a real merge: swapped cards land where chosen, hand size is conserved', () => {
  const h = new Harness(2002, undefined, 'draft');
  const hand = [...h.state.players[0]!.hand];
  const pack = [...h.state.packs[0]!];
  const pile = [...hand, ...pack];
  // keep pack slots 0..6 as dealt, but put hand cards 0,1,2 into the last
  // three pack slots (taking pack cards 7,8,9 into hand)
  const packIndices = [6, 7, 8, 9, 10, 11, 12, 0, 1, 2];
  h.do({ type: 'draftCommit', seat: 0, packIndices });
  assert.deepEqual(h.state.packs[0], packIndices.map(i => pile[i]));
  assert.deepEqual(h.state.players[0]!.hand, [hand[3], hand[4], hand[5], pack[7], pack[8], pack[9]]);
  assert.equal(h.state.players[0]!.hand.length, 6);
});

test('bad commits are rejected: wrong count, duplicates, out of range, wrong mode', () => {
  const h = new Harness(2003, undefined, 'draft');
  const H = h.state.players[0]!.hand.length;
  const noop = h.state.packs[0]!.map((_, i) => H + i);
  assert.throws(() => h.do({ type: 'draftCommit', seat: 0, packIndices: noop.slice(1) }), IllegalAction);
  assert.throws(() => h.do({ type: 'draftCommit', seat: 0, packIndices: [noop[0]!, ...noop.slice(0, 9)] }), IllegalAction);
  assert.throws(() => h.do({ type: 'draftCommit', seat: 0, packIndices: [...noop.slice(0, 9), 99] }), IllegalAction);
  assert.throws(() => h.do({ type: 'draftCommit', seat: 0, packIndices: [...noop.slice(0, 9), -1] }), IllegalAction);
  noopCommit(h, 0);
  assert.throws(() => noopCommit(h, 0), IllegalAction); // already committed
  const shared = new Harness(2003);
  assert.throws(() => shared.do({ type: 'draftCommit', seat: 0, packIndices: [] }), IllegalAction);
});

test('planning is gated until you commit; open again after (opponent still drafting)', () => {
  const h = new Harness(2004, undefined, 'draft');
  assert.throws(() => h.do({ type: 'donePlanning', seat: 0 }), IllegalAction);
  assert.throws(() => h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' }), IllegalAction);
  assert.throws(() => h.do({ type: 'activateResource', seat: 0, index: 0 }), IllegalAction);
  noopCommit(h, 0);
  // committed seat may proceed simultaneously while the opponent drafts
  h.do({ type: 'activateResource', seat: 0, index: 0 });
  h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' });
  assert.equal(h.state.players[0]!.hand.length, 5);
  // …but their own draft step is over
  assert.throws(() => noopCommit(h, 0), IllegalAction);
});

test('legalActions during the draft step: only commits — the no-op plus every single swap', () => {
  const h = new Harness(2005, undefined, 'draft');
  const legal = legalActions(h.state, 0);
  assert.ok(legal.every(a => a.type === 'draftCommit'));
  assert.equal(legal.length, 1 + 6 * 10);
  // every offered commit is actually legal
  for (const a of legal.slice(0, 12)) {
    const h2 = new Harness(2005, undefined, 'draft');
    h2.do(a);
  }
  noopCommit(h, 0);
  const after = legalActions(h.state, 0);
  assert.ok(after.some(a => a.type === 'donePlanning'));
  assert.ok(!after.some(a => a.type === 'draftCommit'));
});

// ── turn cycle: draws, passing, refresh ───────────────────────────────

/** every card in the game outside entities/erased: deck + packs + hands + bins */
function cardCount(h: Harness): number {
  return h.state.sharedDeck.length
    + h.state.packs.flat().length
    + h.state.players.reduce((s, p) => s + p.hand.length + p.bin.length, 0);
}

/** drive one full draft-mode turn: no-op drafts, planning, empty battle, deploy */
function playTurn(h: Harness): void {
  noopCommit(h, 0);
  noopCommit(h, 1);
  toDeployment(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
}

test('turns 2-3 draw 2 and re-open the draft step; packs refresh on turn 4 (N+1 cycle)', () => {
  const h = new Harness(2006, undefined, 'draft');
  const total = cardCount(h);
  assert.equal(total, 177);

  playTurn(h); // turn 1 → 2
  assert.equal(h.state.turn, 2);
  assert.equal(h.state.players[0]!.hand.length, 8, 'drew 2 on turn 2');
  assert.deepEqual(h.state.draftDone, [false, false], 'draft step re-opens');
  // commits must now leave 10 of a 18-card pile
  const legal = legalActions(h.state, 0);
  assert.equal(legal.length, 1 + 8 * 10);

  playTurn(h); // turn 2 → 3
  assert.equal(h.state.turn, 3);
  assert.ok(!h.log.some(l => l.includes('recycled; everyone is dealt')), 'no refresh before turn 4');

  const packsBefore = [h.state.packs[0]!.slice(), h.state.packs[1]!.slice()];
  playTurn(h); // turn 3 → 4: refresh (players+1 = 3 turns per cycle)
  assert.equal(h.state.turn, 4);
  assert.ok(h.log.some(l => l.includes('recycled; everyone is dealt')), 'turn 4 refreshes the packs');
  // old pack cards went to the bottom of the deck
  for (const c of packsBefore.flat()) {
    const inDeck = h.state.sharedDeck.includes(c) || h.state.packs.flat().includes(c)
      || h.state.players.some(p => p.hand.includes(c));
    assert.ok(inDeck, `${c} lost in the refresh`);
  }
  assert.equal(h.state.packs[0]!.length, 10);
  assert.equal(h.state.packs[1]!.length, 10);
  assert.equal(cardCount(h), total, 'no card created or destroyed by drafting');
});

test('haste step still works after a draft turn (gates compose)', () => {
  const h = new Harness(2007, undefined, 'draft');
  noopCommit(h, 0);
  noopCommit(h, 1);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  assert.equal(h.state.phase, 'battle');
});

test('replay determinism: same seed + same commits = same state', () => {
  const drive = () => {
    const h = new Harness(2008, undefined, 'draft');
    h.do({ type: 'draftCommit', seat: 1, packIndices: [0, 2, 4, 6, 8, 10, 12, 14, 15, 13] });
    noopCommit(h, 0);
    return h.state;
  };
  const a = drive();
  const b = drive();
  assert.deepEqual(a, b);
});

// ── the pack schedule the draft banner promises (playtest 2026-08-20) ──
//
// Bena, holding pick 3 of a 1v1 pack: "This reminder text is false … it should
// all be recycled at the end so my opponent will NOT get to see it again."
// He was right, and the cause was two independent copies of the N+1 schedule —
// one in startDraftStep, one in the server's view. packCycle is now the single
// copy; these tests pin what each of its three answers CLAIMS against what the
// engine actually does with the cards.

test('packCycle: N+1 looks, and only the cycle-opening holder sees the pack again', () => {
  // 1v1: three looks — you, your opponent, you again, then recycled
  const c = (turn: number) => packCycle(turn, 2);
  assert.equal(c(1).total, 3);
  assert.deepEqual([c(1).index, c(2).index, c(3).index, c(4).index], [0, 1, 2, 0]);
  assert.deepEqual([c(1).after, c(2).after, c(3).after], ['returns', 'others', 'recycled']);
  assert.deepEqual([c(4).after, c(5).after, c(6).after], ['returns', 'others', 'recycled'],
    'the schedule repeats every cycle');

  // 3 players: four looks, once around the table and back to the owner
  const t = (turn: number) => packCycle(turn, 3);
  assert.equal(t(1).total, 4);
  assert.deepEqual([t(1).after, t(2).after, t(3).after, t(4).after],
    ['returns', 'others', 'others', 'recycled']);
});

test('packCycle agrees with startDraftStep about which turns deal fresh packs', () => {
  // the refresh test above proves turn 4 refreshes; this proves the schedule
  // the UI reads from cannot drift away from the one the engine acts on
  const h = new Harness(2010, undefined, 'draft');
  const serials = (): number[] => h.state.packMeta!.map(m => m!.serial);
  const seen: Record<number, number[]> = {};
  for (let turn = 1; turn <= 7; turn++) {
    assert.equal(h.state.turn, turn);
    seen[turn] = serials();
    const fresh = packCycle(turn, 2).index === 0;
    if (turn > 1) {
      const grew = seen[turn]!.some(sn => !seen[turn - 1]!.includes(sn));
      assert.equal(grew, fresh, `turn ${turn}: packCycle says fresh=${fresh}, engine says ${grew}`);
    }
    playTurn(h);
  }
});

/** the cards left behind by `seat` after a no-op-ish commit this turn */
function leftInPack(h: Harness, seat: Seat): string[] {
  return h.state.packs[seat]!.slice();
}

test('"comes back to you" (turn 1) is true: your own pack returns on turn 3', () => {
  const h = new Harness(2011, undefined, 'draft');
  assert.equal(packCycle(1, 2).after, 'returns');
  const mine = leftInPack(h, 0);
  const serial = h.state.packMeta![0]!.serial;

  playTurn(h);                                   // turn 1 → 2 (opponent picks)
  assert.notEqual(h.state.packMeta![0]!.serial, serial, 'turn 2 holds the other pack');
  playTurn(h);                                   // turn 2 → 3
  assert.equal(h.state.turn, 3);
  assert.equal(h.state.packMeta![0]!.serial, serial, 'turn 3: my own pack is back');
  // no-op commits, so every card I left is still there for me to pick
  assert.deepEqual(h.state.packs[0]!.slice().sort(), mine.slice().sort());
});

test('"your opponent drafts the leftovers" (turn 2) is true', () => {
  const h = new Harness(2012, undefined, 'draft');
  playTurn(h);                                   // → turn 2
  assert.equal(packCycle(2, 2).after, 'others');
  const left = leftInPack(h, 0);
  const serial = h.state.packMeta![0]!.serial;

  playTurn(h);                                   // → turn 3
  assert.equal(h.state.packMeta![1]!.serial, serial,
    'the pack I just looked at is in my OPPONENT’s hands on turn 3');
  assert.deepEqual(h.state.packs[1]!.slice().sort(), left.slice().sort(),
    'and they are looking at exactly what I left in it');
});

test('"nobody drafts it again" (turn 3) is true: the leftovers are recycled', () => {
  const h = new Harness(2013, undefined, 'draft');
  playTurn(h); playTurn(h);                      // → turn 3
  assert.equal(h.state.turn, 3);
  assert.equal(packCycle(3, 2).after, 'recycled');
  const left = [leftInPack(h, 0), leftInPack(h, 1)];

  playTurn(h);                                   // → turn 4: packs recycled
  assert.equal(h.state.turn, 4);
  for (const seat of [0, 1] as Seat[]) {
    for (const card of left[seat]!) {
      assert.ok(!h.state.packs.flat().includes(card),
        `${card} was left on the final look but turned up in a pack — the banner would be lying`);
      assert.ok(h.state.sharedDeck.includes(card),
        `${card} should be at the bottom of the deck after the recycle`);
    }
  }
});
