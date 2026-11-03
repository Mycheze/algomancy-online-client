/* THE DECK FILE, VERSION 2 — the sideboard (ui/deckformat.ts,
 * read by server/decks.ts; docs/deck-format.md, docs/22 §4.2).
 *
 * 311 holds the format to everything it promised at version 1. This is what
 * version 2 adds:
 *
 *  §1 a deck exported with a sideboard imports back with it, through the
 *     REAL importer — and a file written while saved swaps existed (2026-11-02,
 *     taken out 2026-11-03) still imports, its `swaps` ignored
 *  §2 a version-1 reader degrades: the sideboard lands in its maybeboard and
 *     the main deck survives; a file that says version 1 is read that way here
 *  §3 algomancer.cc's nested `deck.sideboard` still goes into maybe, never
 *     into the sideboard (owner, docs/22 §8 Q5)
 *  §4 nothing empty is written, and no `swaps` ever is
 *  §5 an unscripted sideboard card is reported
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DECK_FORMAT, DECK_FORMAT_VERSION, buildDeckFile, deckFileText, expandEntries, parseDeckFile,
} from '../../ui/deckformat.ts';
import { defaultDecks, importDeckFile, importDeckPaste } from '../decks.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const base = defaultDecks()[0]!;
/** seven pool cards the first starter deck does not play */
const SIDE = DECK_LIST.filter(n => !base.cards.includes(n)).slice(0, 7);
const sorted = (l: readonly string[]): string[] => [...l].sort();

const v2Deck = () => ({
  name: base.name,
  cards: base.cards,
  sideboard: SIDE,
  maybe: ['Rune Channeler'],
});
/** what a 2026-11-02 build wrote: the same file with saved swaps in it */
const OLD_SWAPS = [
  { name: 'vs. control', out: [{ name: base.cards[0]!, quantity: 1 }], in: [{ name: SIDE[0]!, quantity: 1 }] },
];

test('§1 a deck with a sideboard survives export and import; old swaps are ignored', () => {
  const file = buildDeckFile(v2Deck(), { now: '2026-11-02T00:00:00.000Z' });
  assert.equal(file.version, 2);
  assert.equal(DECK_FORMAT_VERSION, 2);
  const back = importDeckPaste(deckFileText(file));
  assert.deepEqual(back.problems, []);
  assert.deepEqual(sorted(back.cards), sorted(base.cards), 'the main deck');
  assert.deepEqual(sorted(back.sideboard ?? []), sorted(SIDE), 'THE SIDEBOARD');
  assert.deepEqual(back.maybe, ['Rune Channeler'], 'the maybeboard stays its own list');
  assert.ok(!('swaps' in back));
  // a file from the build that had saved swaps: everything else reads as before
  const old = importDeckPaste(JSON.stringify({ ...JSON.parse(deckFileText(file)), swaps: OLD_SWAPS }));
  assert.deepEqual(old.problems, []);
  assert.deepEqual(sorted(old.cards), sorted(base.cards));
  assert.deepEqual(sorted(old.sideboard ?? []), sorted(SIDE));
  assert.ok(!('swaps' in old), 'its swaps are not read');
});

test('§2 a version 1 reader degrades the sideboard to its maybeboard', () => {
  const file = JSON.parse(deckFileText(buildDeckFile({ name: 'x', cards: base.cards, sideboard: SIDE })));
  // The version-1 reader's one line for the shelf (deckformat.ts at ba32fcf4):
  //   const maybe = entriesFrom(deck['maybe'] ?? deck['sideboard'], slugs);
  // so a v2 file with a sideboard and no maybe hands it the sideboard as a
  // maybeboard, and the main deck is untouched. The key MUST stay top-level
  // `sideboard` in the same entry shape for that to hold.
  assert.ok(!('maybe' in file));
  assert.deepEqual(sorted(expandEntries(file['maybe'] ?? file['sideboard'])), sorted(SIDE));
  // …and a file that SAYS it is version 1 means what v1 meant, here too
  const v1 = importDeckFile(JSON.stringify({ ...file, version: 1 }));
  assert.deepEqual(sorted(v1.maybe ?? []), sorted(SIDE), 'a v1 file: its sideboard is a shelf');
  assert.equal(v1.sideboard, undefined, 'and not a sideboard');
  assert.deepEqual(sorted(v1.cards), sorted(base.cards));
  // a newer reader's note still fires for a version past this build's
  const r = parseDeckFile(JSON.stringify({ ...file, version: 3 }));
  assert.ok(r.ok && r.file.sideboard?.length === 7 && r.notes.length === 1);
});

test('§3 algomancer.cc deck.sideboard still imports into maybe', () => {
  const payload = {
    deck: {
      _id: '6a0ad201656c0c0c9b916b93',
      name: 'theirs',
      cards: [{ cardId: 'ignis-sprite', quantity: 2 }],
      sideboard: [{ cardId: 'rune-channeler', quantity: 1 }],
      swaps: [{ name: 'not ours', out: ['Ignis Sprite'], in: ['Rune Channeler'] }],
    },
    cards: [{ id: 'ignis-sprite', name: 'Ignis Sprite' }, { id: 'rune-channeler', name: 'Rune Channeler' }],
  };
  const info = importDeckFile(JSON.stringify(payload));
  assert.deepEqual(info.maybe, ['Rune Channeler'], 'their sideboard is our maybeboard');
  assert.equal(info.sideboard, undefined, 'never our sideboard');
  assert.ok(!('swaps' in info), 'and nothing else is read out of their payload');
});

test('§4 nothing empty is written, and no swaps ever are', () => {
  const bare = buildDeckFile({ name: 'x', cards: base.cards });
  assert.ok(!('sideboard' in bare) && !('swaps' in bare));
  // a stored deck that still carries swaps from 2026-11-02 exports without them
  const file = buildDeckFile({ ...v2Deck(), swaps: [{ id: 'w1', name: 'n', out: [base.cards[0]!], in: [] }] } as never);
  assert.equal(file.format, DECK_FORMAT);
  assert.ok(!('swaps' in file));
});

test('§5 an unscripted sideboard card is a note', () => {
  const file = buildDeckFile({ ...v2Deck(), sideboard: [...SIDE.slice(0, 6), 'Not A Real Card'] });
  const back = importDeckFile(deckFileText(file));
  assert.deepEqual(back.problems, ['not in the scripted pool: Not A Real Card']);
  assert.equal(back.sideboard?.length, 6);
});
