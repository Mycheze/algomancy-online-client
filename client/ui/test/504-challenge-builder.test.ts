/* docs/21 — the weekly challenge's ORDERED deck builder (ui/challengebuild.ts).
 *
 * A challenge deck is dealt exactly as arranged, position 1 on top, so every
 * claim here is about ORDER:
 *
 *   §1 consecutive copies are ONE row; every edit moves or counts a whole
 *      row, and two identical rows that meet become one
 *   §2 the opening hand is the engine's (a dealt game read back), and it is
 *      the top of the list
 *   §3 the verdict is checkChallengeDeck's, word for word
 *   §4 the draft survives a reload, per challenge, and a storage that throws
 *      costs the save, never the builder
 *   §5 every row can be moved and counted by a tap (↑↓, − n +), not drag
 *      alone, and is numbered by its deck positions ("1–4")
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

test('§1 consecutive copies are one row, and every edit moves a whole row', () => {
  const l = [A, A, A, Bn, C, C, D];
  assert.deepEqual(B.blocks(l), [{ name: A, start: 0, n: 3 }, { name: Bn, start: 3, n: 1 }, { name: C, start: 4, n: 2 }, { name: D, start: 6, n: 1 }]);
  assert.equal(B.blocks(Array(40).fill(A)).length, 1, 'a 40-copy deck is one row');
  assert.deepEqual(B.blockUp(l, 2), [A, A, A, C, C, Bn, D], 'the whole block moves');
  assert.deepEqual(B.blockDown(l, 0), [Bn, A, A, A, C, C, D]);
  assert.deepEqual(B.blockUp(l, 0), l, 'the top row has nowhere higher to go');
  assert.deepEqual(B.blockDown(l, 3), l, 'the bottom row has nowhere lower to go');
  assert.deepEqual(B.moveBlock(l, 3, 0), [D, A, A, A, Bn, C, C], 'a drag from the bottom to the top');
  assert.deepEqual(B.blockMore(l, 1), [A, A, A, Bn, Bn, C, C, D], 'one more copy in that row');
  assert.deepEqual(B.blockLess(l, 0), [A, A, Bn, C, C, D], 'one fewer');
  assert.deepEqual(B.blockLess(l, 1), [A, A, A, C, C, D], 'the last copy takes the row with it');
  assert.deepEqual(B.blockCut(l, 2), [A, A, A, Bn, D], 'the whole row out');
  // two identical rows that meet are one row
  const split = [A, Bn, A];
  assert.equal(B.blocks(split).length, 3);
  assert.deepEqual(B.blocks(B.blockDown(split, 0)), [{ name: Bn, start: 0, n: 1 }, { name: A, start: 1, n: 2 }], 'moving next to an identical row merges them');
  assert.deepEqual(B.blocks(B.blockCut(split, 1)), [{ name: A, start: 0, n: 2 }], 'so does cutting what was between them');
  assert.deepEqual(B.addCard([A, A], A), [A, A, A], 'a searched card goes to the bottom (onto a matching last row)');
  assert.deepEqual(B.addCard([A], Bn), [A, Bn]);
  assert.deepEqual(B.cutOne([A, Bn, A, C, A], A), [A, Bn, A, C], 'a cut from the browser takes the lowest copy');
  assert.deepEqual(l, [A, A, A, Bn, C, C, D], 'no edit changes the list it was given');
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
  const moved = B.moveBlock(list, B.blocks(list).length - 1, 0);
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

test('§5 every row moves and counts by a tap, numbered by position, and Play waits for a legal deck', () => {
  const list = [A, A, A, A, Bn, C];
  const html = B.builderHtml({ def: DEF, list, decks: [], importing: false });
  const rows = [...html.matchAll(/class="chpos">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(rows, ['1–4', '5', '6'], 'one row per run of copies, numbered by deck position');
  assert.match(html, /class="chn">4</, 'the row carries its own count');
  assert.doesNotMatch(html, /×4/, 'no deck-wide total dressed as a row count');
  for (let b = 0; b < 3; b++) {
    for (const k of ['ch-up', 'ch-down', 'ch-more', 'ch-less', 'ch-cut']) {
      assert.match(html, new RegExp(`data-btn="${k}" data-b="${b}"`), `row ${b + 1} has its ${k} button`);
    }
  }
  assert.match(html, /data-btn="ch-up" data-b="0"[^>]*disabled/, 'the top row cannot go up');
  assert.match(html, /data-btn="ch-down" data-b="2"[^>]*disabled/, 'the bottom row cannot go down');
  assert.match(html, /Turn 1 hand \(you bottom 2\)/, 'the hand says what it is');
  assert.doesNotMatch(html, /data-btn="ch-play" disabled/);
  assert.doesNotMatch(html, /data-btn="ch-undo"/);
  assert.match(B.builderHtml({ def: DEF, list, decks: [], importing: false, undo: 'Cleared.' }), /Cleared\. <button data-btn="ch-undo">Undo<\/button>/);
  const bad = B.builderHtml({ def: DEF, list: ['Training Construct'], decks: [], importing: false });
  assert.match(bad, /data-btn="ch-play" disabled/);
  assert.match(bad, /class="chproblem"/);
  const imp = B.builderHtml({ def: DEF, list, decks: [{ id: 'd1', name: 'Mine', cards: [A] }], importing: true });
  assert.match(imp, /data-btn="ch-importdeck" data-id="d1"/);
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
