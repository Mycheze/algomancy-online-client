/* CT-332 / CT-143 — A CARD PLAYED BY AN EFFECT IS A WHOLE PLAY, ON BOTH BRANCHES.
 *
 * `playInline` (batch-water-a) has two branches: the PUSH branch, for a play
 * made inside a battle priority window (CR 701.4: it goes on the stack), and
 * the IN-PLACE branch, for one made where nobody can respond. They used to
 * build the play twice, and the in-place copy was the poorer one:
 *
 *  · CT-332 — it never paid a bracketed additional [cost] (CR 702.1, 702.4e).
 *    The push branch collected the cast window's costs; the in-place branch
 *    skipped them, so "[Sacrifice a unit]" was played free of the sacrifice.
 *  · CT-143 — it fired a hand-rolled 'spellPlayed' and no 'cardPlayed', so the
 *    CR 108.1a wide watchers never heard the play at all.
 *
 * Both branches now DECLARE the play through one function (X cost, targets,
 * mode, formation spot, the fixed bracketed costs) and ANNOUNCE it through
 * `commitItem`'s own announcing half, so the only thing that differs is the
 * last step: push it, or resolve it where it stands.
 *
 * ⚠ AND ONE COST NEITHER BRANCH PAID: "[Gain N debt]" (Hyper Beam) is not a
 * `castCost` but a printed line `playAtTiming` pays with the mana. A free
 * play waives the mana and nothing else (RAQ "[Solved] Tides of Cosmos - all
 * you need to know.", point 5: "Any additional [cost] of the card must be
 * paid."), so it is paid in the shared declaration too. §3 is the push branch.
 *
 * Seeds 55600-55649.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { inlinePlayGoesToStack, playInline } from '../src/cards/sets/batch-water-a.ts';
import { give, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf, withE } from './util.ts';

/** a resolving effect's context, for driving the in-place branch directly: it
 * answers every question with its first option */
const rig = (seat: Seat, region: number) => ({
  controller: seat, sourceName: 'CT-332 rig', region, targets: [], event: null,
  choose: (_k: string, d: { options: { value: unknown }[] }) => d.options[0]!.value,
}) as never;

/** every card whose play carries a bracketed additional cost, from the registry */
const bracketed = (): string[] =>
  allCardNames().filter(n => !!getCard(n).spellEffect?.castCost || !!getCard(n).gainDebt);

test('CR 702.4e / CT-332: the registry still has bracketed-cost cards for this file to be about', () => {
  const names = bracketed();
  assert.ok(names.includes('Immolate') && names.includes('Hyper Beam'),
    `positive control: the two fixtures below are bracketed-cost cards (found ${names.join(', ')})`);
});

test('CR 702.4e / CT-332: a [Sacrifice a unit] spell played in place pays its sacrifice', () => {
  const h = new Harness(55600);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const fodder = spawn(h, A, 'Unit Token');
  assert.equal(inlinePlayGoesToStack(h.q), false, 'fixture: deployment reaches the in-place branch');
  withE(h, e => { playInline(e, rig(A, e.homeRegion(A)), 'Immolate', 'ct332', A, { from: 'hand' }); });
  assert.equal(h.state.entities[fodder], undefined,
    'Immolate prints [Sacrifice a unit]: the in-place play must pay it, as the push branch and a cast from hand do');
});

test('CR 112.14c / CT-332: a [Gain N debt] spell played in place gains the debt', () => {
  const h = new Harness(55601);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, (1 - A) as Seat, 'Unit Token');                  // something for Hyper Beam to aim at
  const before = h.state.players[A]!.debt ?? 0;
  withE(h, e => { playInline(e, rig(A, e.homeRegion(A)), 'Hyper Beam', 'ct332d', A, { from: 'hand' }); });
  assert.equal((h.state.players[A]!.debt ?? 0) - before, getCard('Hyper Beam').gainDebt,
    'the printed debt line is a cost of the play, and a free play waives the mana only');
});

test('CR 108.1a / CT-143: the in-place branch fires the wide cardPlayed, for a unit and for a spell', () => {
  const h = new Harness(55602);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const start = h.events.length;
  withE(h, e => { playInline(e, rig(A, e.homeRegion(A)), 'Curio Drifter', 'ct143u', A, { from: 'bin' }); });
  withE(h, e => { playInline(e, rig(A, e.homeRegion(A)), 'Immolate', 'ct143s', A, { from: 'hand' }); });
  const plays = h.events.slice(start).filter(ev => ev.type === 'cardPlayed');
  assert.deepEqual(plays.map(ev => ev.data?.['card']), ['Curio Drifter', 'Immolate'],
    'every play announces itself on the wide event, whatever branch it took');
  for (const ev of plays) {
    assert.equal(typeof ev.data?.['item'], 'number',
      'with the play\'s own item id (CR 706.13), exactly as a no-stack play from hand carries it');
  }
  assert.equal(plays[0]!.data?.['from'], 'bin', 'and the zone it came out of (CR 701.4a)');
});

test('CR 702.4e / CT-332: Tides of the Cosmos playing Hyper Beam in a battle window gains the debt', () => {
  const h = new Harness(55603, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'water', 8);
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });
  while (h.state.priority !== A) pass(h);
  h.state.sharedDeck.unshift('Hyper Beam');
  const before = h.state.players[A]!.debt ?? 0;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tides of the Cosmos') });
  pass(h); pass(h);                                          // Tides resolves
  let guard = 10;
  while (h.state.decision && guard-- > 0) {
    const d = h.state.decision;
    const i = d.options.findIndex(o => /Hyper Beam/.test(o.label));
    h.do({ type: 'decide', seat: d.seat, choice: i >= 0 ? i : 0 });
  }
  assert.ok(h.state.stack.some(i => i.card === 'Hyper Beam'), 'fixture: Hyper Beam was played onto the stack');
  assert.equal((h.state.players[A]!.debt ?? 0) - before, getCard('Hyper Beam').gainDebt,
    'played by Tides it still costs its debt — "Any additional [cost] of the card must be paid"');
  void unitsOf;
});
