/* A COMPETITIVE CONSTRUCTED REGISTRATION — engine/src/matchdeck.ts checkMatchDeck
 * (docs/22 §4.1). The rule is the owner's (2026-11-02, docs/22 §0): main at
 * least 30, sideboard at most 7, at most 2 copies of a card across both boards.
 *
 *  §1 a legal 30 + 7 registers, and the lists come back canonical, unmoved
 *  §2 the sideboard cap: 7 passes, 8 does not
 *  §3 the copy cap counts main and sideboard TOGETHER
 *  §4 an alias is the card it names, on either board
 *  §5 the main deck is still checkDeck's question; a single card duel deck is never a CC deck
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMatchDeck, SIDEBOARD_MAX } from '../src/matchdeck.ts';
import { DECK_LIST } from '../src/cards/registry.ts';

/** thirty distinct pool cards, none of them Counter Thief (§4 needs it free) */
const POOL = DECK_LIST.filter(n => n !== 'Counter Thief');
const MAIN = POOL.slice(0, 30);
const SIDE = POOL.slice(30, 37);

test('§1 a legal 30 plus 7 registers, canonical and in order', () => {
  const r = checkMatchDeck(MAIN, SIDE);
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.deepEqual(r.main, MAIN);
  assert.deepEqual(r.side, SIDE);
  const none = checkMatchDeck(MAIN, undefined);
  assert.ok(none.ok && none.side.length === 0, 'an absent sideboard is an empty one');
});

test('§2 the sideboard holds at most seven cards', () => {
  assert.equal(SIDEBOARD_MAX, 7);
  const eight = checkMatchDeck(MAIN, POOL.slice(30, 38));
  assert.equal(eight.ok, false);
  assert.match((eight as { error: string }).error, /at most 7/);
  assert.equal(checkMatchDeck(MAIN, ['not a card']).ok, false, 'a sideboard card must be a pool card');
  assert.equal(checkMatchDeck(MAIN, 'Ignis Sprite').ok, false, 'a sideboard is a list');
});

test('§3 the copy cap counts the main deck and the sideboard together', () => {
  const card = MAIN[0]!;
  // one in main + two in side: legal on each board alone, three across both
  const r = checkMatchDeck(MAIN, [card, card]);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, new RegExp(`across the main deck and sideboard: ${card}`));
  assert.ok(checkMatchDeck(MAIN, [card]).ok, 'two across both boards is fine');
  // two in main + one in side
  const main2 = [...MAIN, card];
  assert.ok(checkMatchDeck(main2, []).ok);
  assert.equal(checkMatchDeck(main2, [card]).ok, false);
});

test('§4 an alias counts as its card on either board', () => {
  // registerAlias('Counter Theif', 'Counter Thief') — the printed spelling
  const main = [...MAIN, 'Counter Thief', 'Counter Theif'];
  const r = checkMatchDeck(main, ['Counter Theif']);
  assert.equal(r.ok, false, 'three Counter Thiefs under two spellings is three copies');
  assert.match((r as { error: string }).error, /Counter Thief/);
  const ok = checkMatchDeck([...MAIN, 'Counter Thief'], ['Counter Theif']);
  assert.ok(ok.ok);
  assert.deepEqual(ok.side, ['Counter Thief'], 'the sideboard comes back canonical');
});

test('§5 the main deck is checkDeck: 30 minimum, the pool, and no single card duel', () => {
  const short = checkMatchDeck(MAIN.slice(0, 29), SIDE);
  assert.equal(short.ok, false);
  assert.match((short as { error: string }).error, /^main deck: .*at least 30/);
  const duel = checkMatchDeck(Array.from({ length: 30 }, () => MAIN[0]!), []);
  assert.equal(duel.ok, false, 'thirty of one card is a single card duel deck, never a CC one');
});
