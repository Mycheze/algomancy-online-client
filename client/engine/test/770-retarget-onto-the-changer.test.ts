/* A CHANGE-THE-TARGETS EFFECT IS A LEGAL NEW TARGET WHILE IT RESOLVES — AND
 * NO EFFECT IS EVER A LEGAL TARGET FOR ITSELF.
 *
 * invi's question (relayed by the owner, 2026-11-01): can Gravitational
 * Correction change the target of a Null Drone to (a) the Null Drone itself,
 * (b) the Gravitational Correction itself? Nyar's answer, which the owner
 * adopted: (a) no, (b) yes, "the rules are modelled after magic" — an effect
 * on the stack is an illegal target for itself, and the resolving changer is
 * still on the stack, so it can be the new target. The Drone is then left
 * aimed at an effect that is gone by the time it resolves, and negates
 * nothing.
 *
 * The engine answered both the other way: (b) was never offered, because
 * `resolveStackAt` takes the resolving item off `s.stack` before it runs.
 *
 * The class is DERIVED from the printed text: every spell that changes the
 * targets of "target effect" (Gravitational Correction, Divine Intervention).
 *
 * Seeds 77000-77099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { ResourceKind, Seat } from '../src/types.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

const key = (r: unknown): string => JSON.stringify(r);
const CHANGERS = allCardNames().filter(n => !!getCard(n).spellEffect
  && /\bchange the targets of target effect\b/i.test(getCard(n).text ?? ''));

test('the change-the-targets spells are derived, and each has its test below', () => {
  // a new one fails here: give it a test of its own (CR 110.9c binds to them by title)
  assert.deepEqual([...CHANGERS].sort(), ['Divine Intervention', 'Gravitational Correction']);
});

/** A attacks; A casts Luminous Arc at D's unit, D answers with Null Drone
 * aimed at the Arc, and A casts `changer` at the Drone. */
function droneUnderChanger(seed: number, changer: string) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Monke');
  const victim = spawn(h, D, 'Monke');
  giveResources(h, A, 'fire', 2);
  for (const f of getCard(changer).factions!) giveResources(h, A, f as ResourceKind, 8);
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  if (h.state.priority !== A) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: victim });
  const arc = h.state.stack.at(-1)!.id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Null Drone') });
  pick(h, { stack: arc });
  const drone = h.state.stack.at(-1)!;
  assert.equal(drone.card, 'Null Drone', 'fixture: the Drone is on the stack');
  assert.deepEqual(drone.parts[0]!.targets, [{ stack: arc }], 'fixture: aimed at the Arc');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, changer) });
  if (h.state.decision?.kind !== 'targets') h.do({ type: 'decide', seat: h.state.decision!.seat, choice: 0 });   // X
  return { h, A, D, arc, drone: drone.id, victim };
}

function ontoTheChanger(seed: number, changer: string): void {
  const { h, A, arc, drone } = droneUnderChanger(seed, changer);
  // the cast-time stop (CT-307) must not call this a no-op: the changer
  // itself will be a legal new target, even with nothing else on the stack
  const opt = h.state.decision!.options.find(o => key(o.value) === key({ stack: drone }));
  assert.ok(opt, 'the Drone is a legal target for the changer');
  assert.equal(opt.warning, undefined, 'no "will do nothing" warning: it can move the Drone onto itself');
  pick(h, { stack: drone });
  const self = h.state.stack.at(-1)!.id;
  pass(h); pass(h);                                   // the changer resolves
  let menu: unknown[] | null = null;
  for (let guard = 0; h.state.decision && guard < 6; guard++) {
    const dec = h.state.decision;
    const vals = dec.options.map(o => key(o.value));
    const i = vals.indexOf(key({ stack: self }));
    if (i >= 0) {
      menu = dec.options.map(o => o.value);
      h.do({ type: 'decide', seat: dec.seat, choice: i });
      continue;
    }
    // the victim declines the ransom; the "may" says yes
    const j = dec.seat === A ? vals.indexOf('true') : vals.indexOf('false');
    h.do({ type: 'decide', seat: dec.seat, choice: j >= 0 ? j : 0 });
  }
  assert.ok(menu, `(b) the resolving ${changer} is offered as the Drone's new target`);
  assert.ok(!menu.some(v => key(v) === key({ stack: drone })), '(a) the Drone is never offered as its own target');
  assert.ok(menu.some(v => key(v) === key({ stack: arc })), 'the Arc is still there to choose (or keep)');
  assert.ok(h.log.some(l => l.includes(changer) && /changes 1 of Null Drone/.test(l)), 'the change is logged');
  assert.ok(!h.state.stack.some(i => i.id === self), `${changer} has resolved and left the stack`);
  const d = h.state.stack.find(i => i.id === drone)!;
  assert.deepEqual(d.parts[0]!.targets, [{ stack: self }], `the Drone now targets ${changer}`);

  pass(h); pass(h);                                   // the Drone resolves, its target gone
  assert.ok(h.state.stack.some(i => i.id === arc), 'the Arc was not negated');
  assert.ok(!h.log.some(l => /Luminous Arc is negated/.test(l)), 'nothing negated the Arc');
}

test("Gravitational Correction can move Null Drone's target onto Gravitational Correction itself, never onto the Drone", () => {
  ontoTheChanger(77001, 'Gravitational Correction');
});

test("Divine Intervention can move Null Drone's target onto Divine Intervention itself, never onto the Drone", () => {
  ontoTheChanger(77002, 'Divine Intervention');
});
