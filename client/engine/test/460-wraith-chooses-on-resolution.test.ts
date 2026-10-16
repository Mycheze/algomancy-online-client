/* Report round 2026-10-16 (Discord report, relayed by the owner):
 *
 *   "Wraiths are implemented wrong. They should not target and need to fully
 *    resolve their effect one at a time."
 *
 * OWNER'S DECISION (verbatim, binding; it reverses his own 2026-08-24 ruling
 * from report #101 / room SMVJ):
 *
 *   "The way that I *guessed* Wraiths work is wrong. It's this new way. They
 *    don't target which means they can't be fizzled."
 *
 * WHAT WAS WRONG. The Wraith's "At the start of deployment, put a -1/-1 counter
 * on an ally" chose its ally as the trigger was PUT ON THE STACK (the retired
 * `EffectDef.subject` seam) and fizzled at resolution if that ally had gone.
 * Three Wraiths and a 1/1: three questions before anything resolved, all three
 * could name the 1/1, the first killed it and the other two fizzled.
 *
 * WHAT IT DOES NOW. "an ally" is not a target (CR 110.2: nothing is declared for
 * it as the effect goes on the stack), so the ally is chosen as each trigger
 * RESOLVES, from the allies in play at that moment. Each Wraith trigger resolves
 * fully before the next one is asked anything, and none can fizzle.
 *
 * Seeds: 46000-46099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import { effStats, ent, finishBattle, spawn, toDeployment, toNextBattle, withE } from './util.ts';
import type { EntityId } from '../src/types.ts';

const unit = (name: string, power: number, toughness: number, extra: Partial<Printed> = {}): Printed => ({
  name, cost: '', mana: 0, power, toughness, type: 'Test Unit', kind: 'unit',
  timing: 'deploy', attrs: [], virus: false, burst: false,
  augmentAttrs: [], text: '', image: '', ...extra,
});

/** inert deck filler: unaffordable and deploy-timed, so it never acts */
registerSynthetic(unit('T460 Filler', 1, 1, { mana: 20 }), {});
registerSynthetic(unit('T460 Grunt', 1, 1), {});
registerSynthetic(unit('T460 Brute', 4, 4), {});

/** a harness whose randomness cannot reach the assertions (see 37's sterile) */
function sterile(seed: number): Harness {
  const h = new Harness(seed);
  for (const p of h.state.players) p.hand.length = 0;
  h.state.sharedDeck = Array.from({ length: 400 }, () => 'T460 Filler');
  return h;
}

interface Ask { options: EntityId[]; pushed: number; resolved: number; gruntAlive: boolean }

/** answer every Wraith question with `prefer` when it is offered, else the first
 * option, recording what each question looked like when it was raised */
function answerAll(h: Harness, from: { events: number; log: number }, prefer: EntityId, watch: EntityId): Ask[] {
  const asks: Ask[] = [];
  let guard = 30;
  while (h.state.decision && guard-- > 0) {
    const dec = h.state.decision;
    asks.push({
      options: dec.options.map(o => o.value as EntityId),
      pushed: h.events.slice(from.events).filter(ev => ev.type === 'stackPushed').length,
      resolved: h.events.slice(from.events).filter(ev => ev.type === 'resolved').length,
      gruntAlive: !!ent(h, watch),
    });
    const i = Math.max(0, dec.options.findIndex(o => o.value === prefer));
    h.do({ type: 'decide', seat: dec.seat, choice: i });
  }
  return asks;
}

test('report 2026-10-16: three Wraith triggers and a 1/1 ask nothing before the first resolves', () => {
  const h = sterile(46000);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const grunt = spawn(h, P, 'T460 Grunt');
  withE(h, e => { for (let i = 0; i < 3; i++) e.createWraith(P); });
  toNextBattle(h, P);
  const from = { events: h.events.length, log: h.log.length };
  finishBattle(h);                                         // → the next start of deployment
  const asks = answerAll(h, from, grunt, grunt);
  assert.equal(asks.length, 3, 'one question per Wraith trigger (four allies each time it is asked)');
  assert.equal(asks[0]!.pushed, 3, 'all three triggers were on the stack before the first question');
  assert.deepEqual(asks.map(a => a.resolved), [0, 1, 2],
    'each question comes as its trigger begins to resolve, after the one before it has fully resolved');
  assert.equal(h.state.suspension, null);
});

// Playtest #98 and CR 507.5a still hold: the Wraith question is raised before
// anything of the resolution happens, so answering it rewinds nothing and the
// OTHER player deploys straight through it.
test('report 2026-10-16: a Wraith question at resolution does not freeze the other player in deployment', () => {
  const h = sterile(46003);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const O = (1 - P) as 0 | 1;
  spawn(h, P, 'T460 Grunt');
  withE(h, e => { e.createWraith(P); });
  toNextBattle(h, O);                                     // P is NOT the initiative seat
  finishBattle(h);
  if (h.state.decision?.seat !== P) {
    // the fixture must be the real thing: P is asked about its Wraith
    assert.fail(`expected ${P} to be asked, decision is ${JSON.stringify(h.state.decision)}`);
  }
  assert.equal(h.state.phase, 'deploy');
  const sus = h.state.suspension as { type: string; snapshot?: unknown };
  assert.ok(!sus.snapshot, 'the question carries no rollback snapshot');
  h.do({ type: 'doneDeploying', seat: O });
  assert.equal(h.state.deployDone?.[O], true, 'the other player finished deploying while the question stood open');
  assert.equal(h.state.decision?.seat, P, 'and the Wraith question is still open, undisturbed');
});

test('report 2026-10-16: the second Wraith trigger is asked after the first has fully resolved, without the dead 1/1 on its menu', () => {
  const h = sterile(46001);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const grunt = spawn(h, P, 'T460 Grunt');
  const ws: EntityId[] = [];
  withE(h, e => { for (let i = 0; i < 3; i++) ws.push(e.createWraith(P).id); });
  toNextBattle(h, P);
  const from = { events: h.events.length, log: h.log.length };
  finishBattle(h);
  const asks = answerAll(h, from, grunt, grunt);
  assert.equal(asks.length, 3);
  assert.ok(asks[0]!.options.includes(grunt), 'the first trigger is offered the 1/1');
  assert.equal(asks[1]!.gruntAlive, false, 'the first trigger resolved fully (the 1/1 is dead) before the second asked');
  assert.ok(!asks[1]!.options.includes(grunt), 'so the second is not offered the dead 1/1');
  assert.ok(!asks[2]!.options.includes(grunt), 'nor is the third');
  assert.ok(!h.log.some(l => l.includes('fizzle')), 'nothing fizzled');
  const shrunk = ws.reduce((n, w) => n + (3 - effStats(h, w)[1]), 0);
  assert.equal(shrunk, 2, 'all three counters landed: one killed the 1/1, two went on Wraiths still in play');
});

test('report 2026-10-16: five Wraith triggers and a 4/4, the 4/4 is offered until it dies and nothing fizzles', () => {
  const h = sterile(46002);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const brute = spawn(h, P, 'T460 Brute');
  withE(h, e => { for (let i = 0; i < 5; i++) e.createWraith(P); });
  toNextBattle(h, P);
  const from = { events: h.events.length, log: h.log.length };
  finishBattle(h);
  const asks = answerAll(h, from, brute, brute);
  assert.equal(asks.length, 5);
  assert.deepEqual(asks.map(a => a.options.includes(brute)), [true, true, true, true, false],
    'four counters kill the 4/4; the fifth trigger chooses among the allies still in play');
  assert.equal(ent(h, brute), undefined);
  assert.ok(!h.log.some(l => l.includes('fizzle')), 'nothing fizzled');
});
