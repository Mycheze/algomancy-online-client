/* 1222 — A COMPETITIVE REGISTRATION CARRIES THE DECK'S TABLETOP ARRANGEMENT
 * (BL-55, doneWhen 2: "The deck is laid out as the player arranged it on the
 * tabletop when the deck has an arrangement").
 *
 * The sideboarding table between games drew the deck by cost every time,
 * because the arrangement (CollectionDeck.piles) never left the collection:
 * matchDeckForPlay returned main and side only, and the match payload had no
 * room for it. Now:
 *
 *   §1 matchDeckForPlay carries the saved deck's piles, clamped to the main it
 *      returns; a deck never arranged carries none (812 §5 pins its keys)
 *   §2 registrationFor → registerSeat stores them on the match, and
 *      matchLobbyInfo gives them to THAT seat only, in `mine`; a registration
 *      off the wire (no saved deck) has none
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Seat } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t1222');
const { register, useAccountsFile } = await import('../accounts.ts');
const C = await import('../collection.ts');
const restoreAccounts = useAccountsFile(join(F.DIR, 'accounts.json'));
test.after(() => { restoreAccounts(); rmSync(F.DIR, { recursive: true, force: true }); });

const made = register('Arranger1222', 'a good password');
if (!made.ok) throw new Error(made.error);
const me = made.account;

const MAIN = F.REG[0].main;          // 15 names × 2
const SIDE = F.REG[0].side;
const NAMES = [...new Set(MAIN)];
/** the owner's own layout: two piles, neither by cost, one card's copies split between them */
const PILES = [
  { id: 'p1', name: 'Early', cards: [...NAMES.slice(0, 8).flatMap(n => [n, n]), NAMES[8]!], named: true as const },
  { id: 'p2', name: 'Late', cards: [NAMES[8]!, ...NAMES.slice(9).flatMap(n => [n, n])] },
];

function arrangedDeck() {
  const d = C.createDeck(me, { name: `Arranged ${Math.random()}`, cards: MAIN, sideboard: SIDE });
  if (!d.ok) throw new Error(d.error);
  const u = C.updateDeck(me, d.deck.id, { piles: PILES });
  if (!u.ok) throw new Error(u.error);
  return d.deck.id;
}

test('§1 matchDeckForPlay carries the saved arrangement, every copy of the main deck', () => {
  const id = arrangedDeck();
  const m = C.matchDeckForPlay(me.id, id);
  assert.ok(m);
  assert.deepEqual(m.piles?.map(p => [p.name, p.cards]), PILES.map(p => [p.name, p.cards]), 'the piles as laid out');
  assert.deepEqual(m.piles!.flatMap(p => p.cards).sort(), [...m.main].sort(), 'every copy of the main, no other card');
  const plain = C.createDeck(me, { name: 'Plain', cards: MAIN, sideboard: SIDE });
  if (!plain.ok) throw new Error(plain.error);
  assert.equal('piles' in C.matchDeckForPlay(me.id, plain.deck.id)!, false, 'never arranged: no piles at all');
});

test('§2 the registration stores them and only their own seat is told', () => {
  const id = arrangedDeck();
  const reg = F.M.registrationFor(me.id, id, null, null);
  assert.ok(!('error' in reg), `registrable: ${'error' in reg ? reg.error : ''}`);
  assert.equal(reg.piles?.length, 2, 'the registration carries the piles');
  const { room, m } = F.start(3, [me.id, 'u-bo'], [reg, F.REG[1]]);
  assert.deepEqual(m.registered[0]!.piles?.map(p => p.name), ['Early', 'Late'], 'stored on the match');
  const mine = F.M.matchLobbyInfo(room, 0 as Seat)!.mine!;
  assert.deepEqual(mine.piles?.map(p => [p.name, p.cards.length]), [['Early', 17], ['Late', 13]], 'seat 0 is given its piles');
  const theirs = F.M.matchLobbyInfo(room, 1 as Seat)!;
  assert.equal(JSON.stringify(theirs).includes('Early'), false, 'seat 1 never sees seat 0\'s arrangement');
  assert.equal('piles' in theirs.mine!, false, 'a deck off the wire has no arrangement');
});
