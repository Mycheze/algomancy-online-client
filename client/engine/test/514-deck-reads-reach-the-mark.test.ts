/* CR 408.2b — ANYTHING THAT USES THE DECK REACHES THE MARK (report #268, CT-312).
 *
 * Report #268 (room MQBZ): Tides of the Cosmos ("Reveal the top eight cards of
 * the deck …") revealed ONE card. The deck held one card and the recycle pile
 * eighteen. The card read `g.deckOf(…).slice(0, 8)` itself, and only the
 * engine's own readers (draw, mill, cacheTopOfDeck, glimpse, dealPacks) knew
 * the pile existed. Big Glimpse Card had the same gap at seven.
 *
 * The owner, 2026-10-21:
 *
 *   > "The recycled cards are meant to be a part of your deck still. In paper,
 *   > they're put literally under your deck, but with a "reminder" card below
 *   > the last "initial" card. When you hit that reminder, for whatever
 *   > reason, you shuffle the recycled pile and put the reminder back on the
 *   > very bottom. So ANYTHING that uses the deck should be able to trigger
 *   > the reshuffle."
 *
 * The fix is one public primitive pair, `E.revealTop` / `E.takeTop`, which
 * card code uses instead of reading the deck; 526 guards that no card reads
 * it directly. This file is the behaviour: deck 1 + pile 10, and each card
 * reveals its full N.
 *
 * Seeds 51400-51499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { getCard, type EffectCtx, type EffectDef } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { toDeployment } from './util.ts';
import type { CardName, EngineEvent, Seat } from '../src/types.ts';

const TOP = 'Rune Channeler' as CardName;
/** ten distinct names, so a count can say exactly which ones came back */
const PILE = [
  'Tidal Menace', 'Curio Drifter', 'Good Whale', 'Jelly', 'Ignis Sprite',
  'Dune Drifter', 'Whispering Mantid', 'Lonely Forager', 'Astral Tidewraith', 'Suspend',
] as CardName[];

interface Board { h: Harness; g: E; A: Seat; D: Seat; region: number }

/** a shared-mode game at deployment, with the deck = [TOP] and the pile = PILE */
function board(seed: number, deck: CardName[] = [TOP], pile: CardName[] = PILE): Board {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  h.state.sharedDeck = [...deck];
  h.state.sharedRecycled = [...pile];
  const g = new E(h.state);
  return { h, g, A, D, region: g.homeRegion(A) };
}

/** run one EffectDef as A in A's home region, answering by key */
function run(
  def: EffectDef, b: Board, answer: (key: string) => unknown, ctx: Partial<EffectCtx> = {},
): EngineEvent[] {
  const before = b.g.events.length;
  def.run(b.g, {
    sourceName: 'test', controller: b.A, region: b.region, targets: [], event: null,
    choose: (key: string) => answer(key),
    ...ctx,
  } as EffectCtx);
  return b.g.events.slice(before);
}

const spellOf = (card: string): EffectDef => getCard(card as CardName).spellEffect!;
const revealOf = (evs: EngineEvent[]): CardName[] =>
  (evs.find(e => e.type === 'revealed')?.data?.['cards'] as CardName[] | undefined) ?? [];

/* ══ the primitive ════════════════════════════════════════════════════ */

test('CR 408.2b revealTop wider than the deck reshuffles the pile in under what is left', () => {
  const b = board(51401);
  const rng0 = b.g.s.rngState;
  const top = b.g.revealTop(b.A, 8);
  assert.equal(top.length, 8, 'eight asked, eleven in deck + pile: eight shown');
  assert.equal(top[0], TOP, 'the card above the mark is still the top card');
  assert.equal(b.g.recycleOf(b.A).length, 0, 'the whole pile went in');
  assert.equal(b.g.deckOf(b.A).length, 11, 'and nothing was taken — revealTop only looks');
  assert.notEqual(b.g.s.rngState, rng0, 'the pile was SHUFFLED on its way in');
  // re-entry (a part that asks and resumes) reads the same eight, no second shuffle
  const rng1 = b.g.s.rngState;
  assert.deepEqual(b.g.revealTop(b.A, 8), top, 'idempotent: the same eight again');
  assert.equal(b.g.s.rngState, rng1, 'and no second shuffle');
  assert.deepEqual(b.g.takeTop(b.A, 8), top, 'takeTop takes exactly what revealTop showed');
  assert.equal(b.g.deckOf(b.A).length, 3);
});

test('CR 408.2 revealTop within the deck does not touch the pile or the RNG', () => {
  const deck = PILE.slice(0, 8);
  const b = board(51402, deck, ['Jelly', 'Jelly'] as CardName[]);
  const rng0 = b.g.s.rngState;
  assert.deepEqual(b.g.revealTop(b.A, 8), deck, 'eight cards above the mark: the reveal stops short of it');
  assert.equal(b.g.recycleOf(b.A).length, 2, 'the pile is untouched');
  assert.equal(b.g.s.rngState, rng0, 'no shuffle happened');
});

test('CR 401.4 revealTop off an empty deck and an empty pile shows nothing', () => {
  const b = board(51403, [], []);
  assert.deepEqual(b.g.revealTop(b.A, 8), []);
  assert.deepEqual(b.g.takeTop(b.A, 8), []);
});

/* ══ the cards ════════════════════════════════════════════════════════ */

test('Tides of the Cosmos off a one-card deck with ten recycled reveals eight (report 268)', () => {
  const b = board(51410);
  // pick nothing: the reveal and the recycle of all eight are what is measured
  const evs = run(spellOf('Tides of the Cosmos'), b, () => -1, { sourceName: 'Tides of the Cosmos' });
  const shown = revealOf(evs);
  assert.equal(shown.length, 8,
    `Tides of the Cosmos revealed ${shown.length}: "Reveal the top eight cards of the deck" reaches `
    + 'the mark and reshuffles the recycle pile in (owner, 2026-10-21)');
  assert.equal(shown[0], TOP, 'the card above the mark is revealed first');
  assert.ok(evs.some(e => e.type === 'recycle' && e.data?.['reshuffled']), 'the reshuffle was announced');
  assert.equal(b.g.deckOf(b.A).length, 3, 'eleven cards, eight revealed: three left above the new mark');
  assert.deepEqual([...b.g.recycleOf(b.A)].sort(), [...shown].sort(),
    'the eight it did not play are recycled past the NEW mark');
});

test('Big Glimpse Card off a one-card deck with ten recycled reveals seven (report 268)', () => {
  const b = board(51411);
  const ps = b.g.s.regions[b.region]!.presentSeats;
  if (!ps.includes(b.D)) ps.push(b.D);                      // CR 601.4d: an opponent to split
  const cached0 = (b.g.player(b.A).cache ?? []).length;
  const evs = run(spellOf('Big Glimpse Card'), b,
    key => (key.startsWith('split:') ? false : 'b'),         // no split: pile 2 holds all seven
    { sourceName: 'Big Glimpse Card', targets: [{ player: b.D }] as EffectCtx['targets'] });
  const shown = revealOf(evs);
  assert.equal(shown.length, 7,
    `Big Glimpse Card revealed ${shown.length}: "Reveal the top 7 cards of the deck" reaches the mark `
    + 'and reshuffles the recycle pile in (owner, 2026-10-21)');
  assert.equal(shown[0], TOP);
  assert.equal((b.g.player(b.A).cache ?? []).length - cached0, 7, 'the chosen pile of seven is cached');
  assert.equal(b.g.deckOf(b.A).length, 4, 'eleven cards, seven revealed: four left');
});

test('Big Glimpse Card with no opponent in the region shuffles nothing (CR 601.4d)', () => {
  const b = board(51412);
  assert.deepEqual(b.g.s.regions[b.region]!.presentSeats.filter(s => s !== b.A), [],
    'the precondition: a region holding nobody but the controller');
  const rng0 = b.g.s.rngState;
  run(spellOf('Big Glimpse Card'), b, key => { throw new Error(`asked ${key}`); },
    { sourceName: 'Big Glimpse Card' });
  assert.equal(b.g.s.rngState, rng0, 'an effect that does not exist here does not reach the mark either');
  assert.equal(b.g.recycleOf(b.A).length, PILE.length, 'the pile is where it was');
  assert.deepEqual(b.g.deckOf(b.A), [TOP]);
});
