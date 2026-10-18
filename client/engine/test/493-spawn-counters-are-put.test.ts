/* CR 301.8a, 707.5a — a spawn's counters ARE PUT ON it. Report #220 (room XPDJ).
 *
 * A Living Forge Robot arrived with Scrapyard Custodian in play and nobody drew:
 * the engine wrote a spawn's counters straight onto the body and told no
 * "when you put counters on…" listener. The designer says otherwise, five
 * times — "It would trigger them" (2023-09-20, asked whether a Robot spawning
 * means the counter "is never placed"); Custodian on Robot creation, "Yes"
 * (2025-03-21); "it also does work this way in mtg" (2025-03-26); "spawn with X
 * counters" is "putting one or more counters on an ally", "yes" (2026-01-27);
 * Aethercap Siphoner spawned in battle triggers Pestilent Mycelion, "Yes"
 * (2026-03-05).
 *
 * A placement in all three respects, so each has its case:
 *   · the SIGNAL — every countersChanged listener in the pool hears it
 *     (Custodian, Pestilent Mycelion, Wandering Blightshell; Ancient One by
 *     copying them), attributed to the seat that spawned the unit;
 *   · the AMOUNT layer — once, not twice (Flux Resonator: a Robot 2 is a 3/3);
 *   · the REDIRECT — during battle a Counter Thief takes them, and the Robot,
 *     X = 0, is a 0/0 that dies at the state check (CR 713.2). Outside battle
 *     the Thief does nothing.
 *
 * Seeds 49301-49399. Each negative has its live control beside it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import {
  ent, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf, withE,
} from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

/** order any trigger batch as offered and pass until the stack is empty */
function drain(h: Harness): void {
  let guard = 60;
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (dec?.kind === 'orderTriggers') {
      h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
      continue;
    }
    if (dec) throw new Error(`unexpected decision: ${dec.prompt}`);
    if (h.state.stack.length && h.state.priority !== null) { pass(h); continue; }
    return;
  }
}

const hand = (h: Harness, s: Seat): number => h.state.players[s]!.hand.length;
const robots = (h: Harness, s: Seat) => unitsOf(h, s).filter(u => u.card === 'Robot');

/** deployment, `A` to act, with `mine` and `theirs` in play */
function deploy(seed: number, mine: string[], theirs: string[] = []) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer as Seat, D = (1 - A) as Seat;
  const a = mine.map(n => spawn(h, A, n)), d = theirs.map(n => spawn(h, D, n));
  return { h, A, D, a, d };
}

/** …then into battle, `A` attacking (into D's region) with `cols`, A holding priority */
function battle(h: Harness, A: Seat, cols: EntityId[][]): void {
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: cols });
  assert.equal(h.state.priority, A, 'the attacker holds priority in the attack window');
}

test('report #220: a Living Forge Robot is a counter put on an ally — Scrapyard Custodian draws', () => {
  const { h, A, a: [forge] } = deploy(49301, ['Living Forge', 'Scrapyard Custodian']);
  giveResources(h, A, 'metal', 3);
  const h0 = hand(h, A);
  h.do({ type: 'activateAbility', seat: A, entityId: forge!, abilityIndex: 0, via: 'augment' });
  drain(h);
  assert.deepEqual(robots(h, A).map(r => r.counters), [2], 'the Robot 2 arrived');
  assert.equal(hand(h, A) - h0, 1, 'the Custodian drew — Caleb: "It would trigger them"');
  const put = h.events.filter(e => e.type === 'countersChanged').at(-1)!;
  assert.equal(put.data?.['by'], A, 'CR 707.5a: put on by the seat that spawned it');
  assert.equal(put.data?.['n'], 2);
  assert.equal(put.msg, '', 'signal-only: the spawn line already announces the counters');
});

test('every "I spawn with counters" card is a placement: Robot, Powerforge Synergist, Aethercap Siphoner', () => {
  for (const [i, name, opts] of [
    [0, 'Robot', { token: true, counters: 3 }],
    [1, 'Powerforge Synergist', {}],
    [2, 'Aethercap Siphoner', {}],                  // -1/-1 counters: "counters" is either sign
  ] as const) {
    const { h, A } = deploy(49310 + i, ['Scrapyard Custodian']);
    const h0 = hand(h, A);
    withE(h, e => { e.spawnUnit(A, name, e.homeRegion(A), opts); });
    drain(h);
    assert.equal(hand(h, A) - h0, 1, `${name}: the Custodian drew`);
  }
  // the control: a unit spawned with NO counters puts none on
  const { h, A } = deploy(49313, ['Scrapyard Custodian']);
  const h0 = hand(h, A);
  withE(h, e => { e.spawnUnit(A, 'Triskaidekaphage', e.homeRegion(A)); });
  drain(h);
  assert.equal(hand(h, A) - h0, 0, 'a counterless spawn is no placement');
  assert.equal(h.events.filter(e => e.type === 'countersChanged').length, 0);
});

test('Flux Resonator scales a spawn ONCE: a Robot 2 is a 3/3, and the placement says 3', () => {
  const { h, A } = deploy(49320, ['Flux Resonator', 'Scrapyard Custodian']);
  withE(h, e => { e.spawnUnit(A, 'Robot', e.homeRegion(A), { token: true, counters: 2 }); });
  drain(h);
  assert.deepEqual(robots(h, A).map(r => r.counters), [3], 'X+1, not X+2: the amount layer ran once');
  const put = h.events.filter(e => e.type === 'countersChanged');
  assert.equal(put.length, 1, 'one placement');
  assert.equal(put[0]!.data?.['n'], 3);
});

test('Caleb 2026-03-05: Aethercap Siphoner spawned in battle triggers Pestilent Mycelion', () => {
  const { h, A, D, a: [myc] } = deploy(49330, ['Pestilent Mycelion']);
  battle(h, A, [[myc!]]);
  const life0 = h.state.players[D]!.life;
  withE(h, e => { e.spawnUnit(A, 'Aethercap Siphoner', e.s.battle!.region); });
  drain(h);
  assert.equal(h.state.players[D]!.life, life0 - 1,
    'three -1/-1 counters were put on a unit — each opponent present loses 1');
  // the control: a +1/+1 spawn is not a -1/-1 placement
  withE(h, e => { e.spawnUnit(A, 'Powerforge Synergist', e.s.battle!.region); });
  drain(h);
  assert.equal(h.state.players[D]!.life, life0 - 1, 'Powerforge\'s +1/+1s do not feed it');
});

test('Counter Thief, DURING BATTLE: a Robot\'s spawn counters land on the Thief, and the 0/0 Robot dies', () => {
  const { h, A, D, a: [forge] } = deploy(49340, ['Living Forge'], ['Counter Thief', 'Wandering Blightshell']);
  const thief = unitsOf(h, D).find(u => u.card === 'Counter Thief')!.id;
  const shell = spawn(h, A, 'Wandering Blightshell');   // "When you put a counter on an enemy, draw"
  battle(h, A, [[forge!], [shell]]);                    // both into D's region, where the Thief is
  giveResources(h, A, 'metal', 3);
  const hA = hand(h, A), hD = hand(h, D);
  h.do({ type: 'activateAbility', seat: A, entityId: forge!, abilityIndex: 0, via: 'augment' });
  drain(h);
  assert.equal(ent(h, thief)!.counters, 2, 'the Robot 2\'s two counters were placed on the Thief instead');
  assert.equal(robots(h, A).length, 0, 'the Robot arrived as X = 0, a 0/0, and died (CR 713.2)');
  assert.ok(h.events.some(e => e.type === 'died' && /^Robot dies/.test(e.msg)),
    'it died rather than never existing');
  assert.equal(hand(h, A) - hA, 1,
    'CR 708.8b: the counters A spawned, redirected onto an ENEMY, are still A\'s — A\'s Blightshell draws');
  assert.equal(hand(h, D) - hD, 0, 'D put nothing anywhere — D\'s Blightshell is silent');
});

test('Counter Thief, OUTSIDE battle: the Robot keeps its own counters', () => {
  const { h, A, a: [, thief] } = deploy(49350, ['Scrapyard Custodian', 'Counter Thief']);
  const h0 = hand(h, A);
  withE(h, e => { e.spawnUnit(A, 'Robot', e.homeRegion(A), { token: true, counters: 2 }); });
  drain(h);
  assert.deepEqual(robots(h, A).map(r => r.counters), [2], '"during battle" — deployment is not');
  assert.equal(ent(h, thief!)!.counters, 0, 'the Thief took nothing');
  assert.equal(hand(h, A) - h0, 1, 'and the placement on the Robot still drew');
});
