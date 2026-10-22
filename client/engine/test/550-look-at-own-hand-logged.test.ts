/**
 * CR D6.5a — LOOKING AT A HAND IS LOGGED FOR EVERYONE, WHOSE EVER HAND IT IS.
 *
 * CT-263, owner 2026-10-22: "Log both". When an effect lets a player look at a
 * hand, the other player's log says that a hand was looked at — in both
 * cases, including when the looker owns the hand (Thought Extraction aimed at
 * its own caster). It never names a card: the names go to the looker only.
 * Four look-at sites used to skip the public line for the caster's own hand
 * (`if (who !== ctx.controller) g.revealHandTo(...)`); the line is now written
 * by `E.revealHandTo` for both, and an own-hand look takes no "seen hand"
 * snapshot, which is the record of the OTHER hand a seat has seen.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { give, giveResources, logFor, pass, pick, spawn, toDeployment, toNextBattle, withE } from './util.ts';

const HAND = ['Good Whale', 'Shard Sprite'];

function thoughtExtractionAt(seed: number, aimAtSelf: boolean): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'dark', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[aimAtSelf ? A : D]!.hand = [...HAND];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Thought Extraction') });
  pick(h, { player: aimAtSelf ? A : D });
  pass(h); pass(h);
  if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  return { h, A, D };
}

test('CR D6.5a / CT-263: Thought Extraction aimed at the caster own hand tells the opponent a hand was looked at, naming nothing', () => {
  const { h, A, D } = thoughtExtractionAt(55001, true);
  const look = logFor(h, D).filter(l => l.includes('looks at'));
  assert.equal(look.length, 1, `the opponent log says a hand was looked at: ${JSON.stringify(logFor(h, D))}`);
  assert.ok(look[0]!.includes('their own hand'), look[0]!);
  for (const name of HAND) {
    assert.ok(!look[0]!.includes(name), `the public line names no card (${name})`);
  }
  assert.ok(!h.state.seenHand?.[A], 'and no seen-hand snapshot of your own hand is taken');
});

test('CR D6.5a / CT-263 control: aimed at the opponent, the public line still names the hand looked at', () => {
  const { h, A, D } = thoughtExtractionAt(55002, false);
  assert.ok(logFor(h, D).some(l => l.includes('looks at') && l.includes('hand') && !l.includes('own hand')),
    'the owner of the hand is told it was looked at');
  assert.ok(h.state.seenHand?.[A], 'and the looker keeps a snapshot of what they saw');
});

test('CR D6.5a / CT-263: Hand Peeper on your own hand logs the look and takes no snapshot', () => {
  const h = new Harness(55003);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const before = h.log.length;
  withE(h, e => { e.revealHandTo(P, P); });
  assert.ok(h.log.slice(before).some(l => l.includes('looks at their own hand')), 'the look is logged publicly');
  assert.ok(!h.state.seenHand?.[P], 'and nothing is snapshotted');
});
