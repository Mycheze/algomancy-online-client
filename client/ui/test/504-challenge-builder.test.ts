/* docs/21 — the weekly challenge's ORDERED deck builder (ui/challengebuild.ts).
 *
 * A challenge deck is dealt exactly as arranged, position 1 on top, so every
 * claim here is about ORDER:
 *
 *   §1 consecutive copies are ONE row of the summary ("1–4"), and two
 *      identical rows that meet are one; the browser's add goes to the
 *      bottom and its cut takes the lowest copy
 *   §2 the opening hand is the engine's (a dealt game read back), and it is
 *      the top of the list
 *   §3 the verdict is checkChallengeDeck's, word for word
 *   §4 the draft survives a reload, per challenge, and a storage that throws
 *      costs the save, never the builder
 *   §5 the builder card is a summary — rows numbered by deck position, the
 *      Turn-1 hand, Import / Clear / Undo / Play — and the way to the table
 *      ("Build on the table"), where the order is built (540); no row is
 *      moved or counted here, and nothing is HTML5-dragged
 *   §6 the card browser builds this list: add goes to the bottom, cut takes
 *      the lowest copy, and there is no maybeboard
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import { checkChallengeDeck, newChallengeGame, type ChallengeDef } from '../../engine/src/challenge.ts';

const g = globalThis as Record<string, unknown>;
const store = new Map<string, string>();
let storageThrows = false;
g['localStorage'] = {
  getItem: (k: string) => { if (storageThrows) throw new Error('denied'); return store.get(k) ?? null; },
  setItem: (k: string, v: string) => { if (storageThrows) throw new Error('quota'); store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

const B = await import('../challengebuild.ts');

const DEF: ChallengeDef = { id: 'b1', week: '2026-10-18', title: 'Builder', blurb: '', goal: { kind: 'unitsPlayed', n: 3 }, seed: 50400, par: 3 };
const units = DECK_LIST.filter(n => getCard(n).kind === 'unit').slice(0, 12);
const [A, Bn, C, D] = units as [string, string, string, string];

test('§1 consecutive copies are one row, and the browser adds at the bottom and cuts the lowest copy', () => {
  const l = [A, A, A, Bn, C, C, D];
  assert.deepEqual(B.blocks(l), [{ name: A, start: 0, n: 3 }, { name: Bn, start: 3, n: 1 }, { name: C, start: 4, n: 2 }, { name: D, start: 6, n: 1 }]);
  assert.equal(B.blocks(Array(40).fill(A)).length, 1, 'a 40-copy deck is one row');
  // two identical rows that meet are one row
  assert.equal(B.blocks([A, Bn, A]).length, 3);
  assert.deepEqual(B.blocks([Bn, A, A]), [{ name: Bn, start: 0, n: 1 }, { name: A, start: 1, n: 2 }], 'adjacent copies merge');
  assert.deepEqual(B.addCard([A, A], A), [A, A, A], 'a searched card goes to the bottom (onto a matching last row)');
  assert.deepEqual(B.addCard([A], Bn), [A, Bn]);
  assert.deepEqual(B.cutOne([A, Bn, A, C, A], A), [A, Bn, A, C], 'a cut from the browser takes the lowest copy');
  assert.deepEqual(l, [A, A, A, Bn, C, C, D], 'nothing changes the list it was given');
  assert.deepEqual(B.counts([A, Bn, A, A]), [{ name: A, n: 3 }, { name: Bn, n: 1 }]);
  assert.deepEqual(B.costIfAllUsed([A, A, A, A, Bn, Bn, Bn, C]), { unique: 3, extra: 3 }, 'copies past the second are extra');
});

test('§2 the opening hand is the top of the list, as the engine deals it', () => {
  const list = Array.from({ length: 14 }, (_, i) => units[i % units.length]!);
  const hand = B.openingHand(DEF, list);
  assert.ok(hand, 'a legal list is dealt');
  const dealt = newChallengeGame(DEF, list as never).state.players[0]!.hand;
  assert.deepEqual(hand, [...dealt], 'read off a dealt game, not re-derived');
  assert.ok(hand.length >= 4, `non-vacuous: a real hand (${hand.length} cards)`);
  assert.deepEqual([...hand].sort(), list.slice(0, hand.length).sort(), 'the hand is the top of the deck');
  // move the bottom card to the top and it is in the hand
  const last = list[list.length - 1]!;
  const moved = [last, ...list.slice(0, -1)];
  assert.ok(B.openingHand(DEF, moved)!.includes(last));
  assert.equal(B.openingHand(DEF, []), null, 'nothing to deal');
});

test('§3 the verdict is checkChallengeDeck, word for word', () => {
  assert.equal(B.deckProblem([A]), null);
  const bad = ['Training Construct'];
  const v = checkChallengeDeck(bad);
  assert.equal(v.ok, false);
  assert.equal(B.deckProblem(bad), (v as { error: string }).error);
  assert.ok(B.deckProblem([]), 'an empty list says what to do');
  assert.equal(B.openingHand(DEF, bad), null, 'a refused deck is not dealt');
});

test('§4 the draft survives a reload per challenge, and a throwing storage costs only the save', () => {
  store.clear();
  B.saveDraft('w1', [A, Bn]);
  B.saveDraft('w2', [C]);
  assert.deepEqual(B.loadDraft('w1'), [A, Bn]);
  assert.deepEqual(B.loadDraft('w2'), [C]);
  assert.deepEqual(B.loadDraft('w3'), []);
  assert.ok(store.has('algoChallengeDecks'), 'one stored object for every challenge');
  B.saveDraft('w1', []);
  assert.deepEqual(B.loadDraft('w1'), [], 'clearing drops the entry');
  store.set('algoChallengeDecks', '{not json');
  assert.deepEqual(B.loadDraft('w2'), [], 'a corrupt store reads as empty');
  storageThrows = true;
  try {
    assert.doesNotThrow(() => B.saveDraft('w1', [A]));
    assert.deepEqual(B.loadDraft('w1'), []);
  } finally { storageThrows = false; }
});

test('§5 the builder card is a summary, numbered by position, with the way to the table; Play waits for a legal deck', () => {
  const list = [A, A, A, A, Bn, C];
  const html = B.builderHtml({ def: DEF, list, decks: [], importing: false });
  const rows = [...html.matchAll(/class="chpos">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(rows, ['1–4', '5', '6'], 'one row per run of copies, numbered by deck position');
  assert.match(html, /data-btn="ch-tabletop">Build on the table</, 'the order is built on the table');
  assert.doesNotMatch(html, /data-btn="ch-(?:up|down|more|less|cut|browse)"/, 'no row is moved or counted here');
  assert.doesNotMatch(html, /draggable="true"|data-chblock/, 'and nothing is HTML5-dragged');
  assert.match(html, /Turn 1 hand \(you bottom 2\)/, 'the hand says what it is');
  const hand = B.openingHand(DEF, list)!;
  assert.equal((html.match(/class="chhandcard"/g) ?? []).length, hand.length, 'and is the dealt hand');
  assert.doesNotMatch(html, /data-btn="ch-play" disabled/);
  assert.doesNotMatch(html, /data-btn="ch-undo"/);
  assert.match(B.builderHtml({ def: DEF, list, decks: [], importing: false, undo: 'Cleared.' }), /Cleared\. <button data-btn="ch-undo">Undo<\/button>/);
  const bad = B.builderHtml({ def: DEF, list: ['Training Construct'], decks: [], importing: false });
  assert.match(bad, /data-btn="ch-play" disabled/);
  assert.match(bad, /class="chproblem"/);
  const imp = B.builderHtml({ def: DEF, list, decks: [{ id: 'd1', name: 'Mine', cards: [A] }], importing: true });
  assert.match(imp, /data-btn="ch-importdeck" data-id="d1"/);
  assert.doesNotMatch(B.builderHtml({ def: DEF, list: [], decks: [], importing: false }), /<ol class="chlist">/, 'an empty deck has no rows');
});

test('§6 the card browser builds the list through its bridge', () => {
  let list: string[] = [A];
  let back = 0;
  const br = B.bridgeFor({ title: 'Builder', list: () => list, set: l => { list = l; }, back: () => { back++; } });
  br.add(Bn); br.add(A);
  assert.deepEqual(list, [A, Bn, A]);
  assert.equal(br.copies(A), 2);
  br.remove(A);
  assert.deepEqual(list, [A, Bn], 'the lower copy went');
  assert.equal(br.noMaybe, true, 'no maybeboard');
  const s = br.summary();
  assert.equal(s.total, 2);
  assert.equal(s.legal, true);
  br.back();
  assert.equal(back, 1);
});
