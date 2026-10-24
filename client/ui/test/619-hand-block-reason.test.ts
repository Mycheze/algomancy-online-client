/* CT-288 (report #211): a hand card the engine will not let you play just
 * lost its ring, and a click on it did nothing — nothing said why. The cache
 * has said why since report #78 (`cacheBlockReason`); the hand now has the
 * same question (`handBlockReason`, ui/inspect.ts), asked in the order the
 * offer (apply.ts pushSourcePlays) asks its gates, and the card zoom — the
 * surface a hover and a finger tap both reach — hangs the answer under the card.
 *
 * Every case here is checked against the engine too: the card is really not
 * offered, so the line can never sit under a card that would play.
 *
 * ui/main.ts is a boot script with no DOM harness, so the wiring is read as
 * text at the bottom.
 *
 * Seeds 61900-61999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { Seat } from '../../engine/src/types.ts';
import { give, giveResources, pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { handBlockLine, handBlockReason, handOffers, type HandBlock } from '../inspect.ts';

/** A attacks with The Foretold; D holds priority in the battle, with `res` */
function battle(seed: number, res: [string, number][]): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[D]!.resources = [];
  for (const [k, n] of res) giveResources(h, D, k as never, n);
  while (h.state.priority !== D) pass(h);
  return { h, A, D };
}

/** the reason for hand card `i`, after checking the engine really offers nothing for it */
function why(h: Harness, seat: Seat, i: number): HandBlock {
  const legal = legalActions(h.state, seat);
  const b = handBlockReason(new E(h.state), seat, i, legal);
  if (b.kind !== 'none') assert.deepEqual(handOffers(legal, i), [], 'a card with a reason is not offered');
  return b;
}

test('CR 207.2 / CT-288: a deployment card held in a battle window says it waits for deployment', () => {
  const { h, D } = battle(61900, [['light', 5]]);
  const i = give(h, D, 'The Foretold');
  assert.deepEqual(why(h, D, i), { kind: 'timing', when: 'deployment' });
  assert.equal(handBlockLine(why(h, D, i)), 'Only during deployment.');
});

test('CR 111.6 / CT-288: a battle spell it cannot afford says the mana, then the affinity', () => {
  const { h, D } = battle(61901, [['fire', 2]]);
  const i = give(h, D, 'Arc Lightning');                  // rr, 4
  assert.deepEqual(why(h, D, i), { kind: 'mana', need: 4, have: 2 });
  assert.equal(handBlockLine(why(h, D, i)), 'Needs 4 mana; you have 2.');
  const { h: h2, D: D2 } = battle(61902, [['fire', 1], ['water', 3]]);
  const j = give(h2, D2, 'Arc Lightning');
  assert.deepEqual(why(h2, D2, j), { kind: 'affinity', element: 'fire', need: 2, have: 1 });
  assert.equal(handBlockLine(why(h2, D2, j)), 'Needs 2 fire affinity; you have 1.');
});

test('CR 110.7 / CT-288: a spell with nothing legal to aim at says so', () => {
  const { h, D } = battle(61903, [['earth', 3]]);
  const i = give(h, D, 'Squish');                          // needs an ally of D, and D has none
  assert.deepEqual(why(h, D, i), { kind: 'no-target' });
  assert.equal(handBlockLine(why(h, D, i)), 'Nothing legal to aim it at.');
});

test('CR 403.3b / CT-288: a playable card, and a seat with no window at all, say nothing', () => {
  const { h, A, D } = battle(61904, [['fire', 4]]);
  const i = give(h, D, 'Arc Lightning');
  assert.deepEqual(why(h, D, i), { kind: 'none' }, 'it is offered: the ring says so already');
  const j = give(h, A, 'Arc Lightning');
  assert.deepEqual(why(h, A, j), { kind: 'none' }, 'not their priority: every card is dark alike');
  assert.equal(handBlockLine({ kind: 'none' }), '');
});

test('CR 207.4 / CT-288: a battle spell held in deployment says it waits for battle', () => {
  const h = new Harness(61905);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'fire', 4);
  const i = give(h, p, 'Arc Lightning');
  assert.deepEqual(why(h, p, i), { kind: 'timing', when: 'battle' });
});

test('CT-288: the card zoom hangs the reason under a hand card with no offer, for a seat this screen plays', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  assert.match(main, /const mine = !replayActive\(\) && \(bothSeats\(\) \|\| NET\?\.seat === p\);/);
  assert.match(main, /handBlockLine\(handBlockReason\(q\(\), p, i, legalFor\(p\)\)\)/);
  assert.match(main, /<div class="zoomhang handwhy">\$\{esc\(why\)\}<\/div>/);
});
