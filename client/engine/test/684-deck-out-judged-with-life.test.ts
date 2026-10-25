/**
 * CR 104.5, 104.1b / CT-418 — a deck-out INSIDE one effect waits for the effect to
 * finish, as a 0 life total does, and the two are judged together.
 *
 * The owner, 2026-10-25, asked "Constructed: one effect brings your opponent to 0
 * and then makes you draw from an empty deck and an empty recycle pile. Who
 * wins?", answered "Check both at the end".
 *
 * The rule: a decked player and a player at 0 or less have each lost at the same
 * moment. One loser loses; two losers are decided as a double KO is (CR 104.1b):
 * the higher life total wins, and on equal totals the initiative player loses.
 * With a shared deck the deck-out is decided on life totals anyway (CR 104.5b).
 * A deck-out outside any effect (the card step) still ends the game at once
 * (test 656).
 *
 * The effect is run the way `resolveParts` runs a part: inside `E.lifeBatch`.
 * Penance: "Any number of target players each lose 1 life. Draw a card."
 *
 * Seeds 68400-68449.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E, GameEnded, other } from '../src/engine.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { getCard, type EffectCtx } from '../src/cards/dsl.ts';
import type { CardName, Seat } from '../src/types.ts';

const constructed = (seed: number): Harness => new Harness(seed, undefined, 'constructed', undefined,
  [DECK_LIST.slice(0, 30) as CardName[], DECK_LIST.slice(30, 60) as CardName[]]);

/** `caster` resolves Penance at `targets`, with its own deck and recycle pile empty */
function penance(h: Harness, caster: Seat, targets: Seat[], lives: [number, number]): { g: E; ended: boolean } {
  const g = new E(structuredClone(h.state));
  g.deckOf(caster).length = 0;
  g.recycleOf(caster).length = 0;
  g.player(0).life = lives[0];
  g.player(1).life = lives[1];
  try {
    g.lifeBatch(() => getCard('Penance').spellEffect!.run(g, {
      controller: caster, sourceName: 'Penance', region: g.homeRegion(caster),
      targets: targets.map(player => ({ player })), event: null, eraseSelf: () => {},
      choose: () => { throw new Error('no choice expected'); },
    } as unknown as EffectCtx));
  } catch (sig) {
    if (!(sig instanceof GameEnded)) throw sig;
    return { g, ended: true };
  }
  return { g, ended: false };
}

test('CR 104.5, 104.1b / CT-418: one effect takes the opponent to 0 and decks the caster -- both lost, and the higher life total (the caster) wins', () => {
  const h = constructed(68400);
  const A: Seat = 0, B = other(A);
  const { g, ended } = penance(h, A, [B], [5, 1]);
  assert.ok(ended, 'the game ended when the effect finished');
  assert.equal(g.s.players[B]!.life, 0);
  assert.equal(g.s.winner, A, 'the caster wins on 5 to 0 (the deck-out used to end it at the draw, for the player on 0)');
  const ev = g.events.find(e => e.type === 'gameOver')!;
  assert.equal((ev.data as { deckedOut?: number }).deckedOut, A, 'the game-over still says who ran out');
});

test('CR 104.5, 104.1b / CT-418: both players brought to 0 and the caster decked in one effect -- equal totals, the initiative player loses', () => {
  const h = constructed(68401);
  const A: Seat = 0, B = other(A);
  const { g, ended } = penance(h, A, [A, B], [1, 1]);
  assert.ok(ended);
  assert.deepEqual(g.s.players.map(p => p.life), [0, 0]);
  assert.equal(g.s.winner, other(g.s.initiative as Seat), 'the tie goes against the initiative player');
});

test('CR 104.5a / CT-418: a deck-out inside an effect with nobody at 0 -- the decked player still loses, once the effect has finished', () => {
  const h = constructed(68402);
  const A: Seat = 1, B = other(A);
  const { g, ended } = penance(h, A, [B], [20, 5]);   // B (seat 0) on 20, A on 5
  assert.ok(ended);
  assert.equal(g.s.players[B]!.life, 19, 'the life loss happened (the draw is the last thing Penance does)');
  assert.equal(g.s.winner, B, 'the player who ran out of cards loses, whatever the life totals');
});

test('CR 104.5b / CT-418: with a shared deck the deck-out inside an effect is decided on life totals, the player on 0 included', () => {
  const h = new Harness(68403);   // live-draft style shared deck
  const g = new E(structuredClone(h.state));
  const A: Seat = 0, B = other(A);
  g.deckOf(A).length = 0;
  g.recycleOf(A).length = 0;
  g.player(A).life = 5; g.player(B).life = 1;
  let ended = false;
  try {
    g.lifeBatch(() => getCard('Penance').spellEffect!.run(g, {
      controller: A, sourceName: 'Penance', region: g.homeRegion(A), targets: [{ player: B }],
      event: null, eraseSelf: () => {}, choose: () => { throw new Error('no choice expected'); },
    } as unknown as EffectCtx));
  } catch (sig) { if (!(sig instanceof GameEnded)) throw sig; ended = true; }
  assert.ok(ended);
  assert.equal(g.s.winner, A);
});
