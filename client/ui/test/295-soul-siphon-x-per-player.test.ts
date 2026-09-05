/* SOUL SIPHON'S X, ON THE TARGET AND ON THE STACK — live report 2026-09-05,
 * room VNNW action 122, ux / medium:
 *
 *   "When casting Soul Siphon, you can't actually see which player lost which
 *    amount of life. It needs to tell you in the UI. And when it's on the
 *    stack, it does say both players lost totals, rather than just the
 *    'relevant' one (the person being targeted)"
 *
 * The card reads X off the battle ledger PER TARGET PLAYER. #85 gave it one
 * preview row per seat — drawn on the HAND chip, where the number is not
 * needed — and the target question drew bare names. Now the rows carry the
 * seat they are about (perSeatRows), and:
 *
 *   §1 each {player} option on the target bar wears that seat's X
 *   §2 once the target is declared, the stack chip keeps only that seat's row
 *      (the same self-checking narrowing R57 modes have in stackPreviewX)
 *   §3 the control: a mode-narrowed card (Retribution Thing) and an option
 *      that is not a player are untouched
 *
 * Seeds 2950-2959.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import { give, giveResources, pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Seat } from '../../engine/src/types.ts';

const ui = await client();

/** the VNNW shape: the defender has taken 7 in this battle and holds priority
 * in the after-combat window, Soul Siphon in hand */
function bled(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');                     // 7/5
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                          // combat: D loses 7
  assert.equal(h.state.players[D]!.life, 23, 'the premise: a real 7 on the ledger');
  pass(h);
  assert.equal(h.state.priority, D);
  return { h, A, D };
}

const screen = (h: Harness, seat: Seat): string =>
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));

const optionOf = (h: Harness, seat: Seat): number =>
  h.state.decision!.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ player: seat }));

test('§1 the target buttons carry each player\'s X', () => {
  const { h, A, D } = bled(2950);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Soul Siphon') });
  assert.equal(h.state.decision?.kind, 'targets', 'the premise: the target question is open');
  const html = screen(h, D);
  const btn = (i: number): string => new RegExp(`data-btn="decide" data-i="${i}"[^>]*>([^<]*(?:<[^>]*>[^<]*)*?)</button>`).exec(html)?.[1] ?? '';
  const me = btn(optionOf(h, D)), them = btn(optionOf(h, A));
  assert.match(me, /X = 7/, `my own option says what X would be if I target myself: ${me}`);
  assert.match(them, /X = 0/, `the attacker's option says 0 — they lost nothing: ${them}`);
});

test('§2 on the stack only the declared target\'s row is shown', () => {
  const { h, A, D } = bled(2951);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Soul Siphon') });
  h.do({ type: 'decide', seat: D, choice: optionOf(h, D) });
  const item = h.state.stack.find(i => i.card === 'Soul Siphon');
  assert.ok(item, 'the premise: it is on the stack with its target declared');
  assert.deepEqual(item!.parts.flatMap(p => p.targets), [{ player: D }]);
  for (const seat of [A, D]) {
    const html = screen(h, seat);
    assert.match(html, /X=7/, `seat ${seat} sees the declared target's 7`);
    assert.equal(/X=7\/0|X=0\/7|X now: /.test(html), false,
      `seat ${seat} no longer sees both players' totals on the stack`);
  }
});

test('§3 the control: a mode-narrowed card and a plain option are untouched', () => {
  // Retribution Thing narrows by MODE (lost / gained), not by a player — its
  // rows carry no seat, and its target is a unit, so nothing here applies
  const { h, A, D } = bled(2952);
  const target = spawn(h, A, 'Wisp');
  giveResources(h, D, 'light', 3);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Retribution Thing') });
  const html = screen(h, D);
  const opts = h.state.decision!.options;
  assert.ok(opts.length, 'the premise: a question is open');
  assert.doesNotMatch(html, /· X = /, 'no per-player X on a question whose options are not players');
  assert.ok(h.state.entities[target], 'the fixture unit is in play');
});
