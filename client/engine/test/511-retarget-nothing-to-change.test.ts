/* CT-306 — A CHANGE-THE-TARGETS CARD WITH NOTHING TO CHANGE ASKS NOBODY ANYTHING.
 *
 * RCUY #235–237: Gravitational Correction ("Change the targets of target
 * effect unless its controller pays [x]") was cast at Surly Stalker's attack
 * trigger, which declares no targets. It asked the trigger's controller to
 * pay [x] "to keep its targets" FIRST, and only afterwards found there was no
 * target to change — the victim was asked to pay for nothing. Divine
 * Intervention asked its own "change the targets?" the same way round.
 *
 * Whether these cards may be CAST at a targetless effect is a separate,
 * open question (not settled here, not tested here): this file takes the cast
 * as given and pins what the resolution asks.
 *
 * The class is DERIVED from the printed text — every card that changes the
 * targets of "target effect" — and each is aimed at the targetless trigger:
 * no question may be put to anyone while it resolves, and the log says there
 * was nothing to change.
 *
 * Seeds 51100-51199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { EntityId, ResourceKind, Seat } from '../src/types.ts';
import { give, giveResources, spawn, toDeployment, toNextBattle } from './util.ts';

const key = (r: unknown): string => JSON.stringify(r);
const CHANGERS = allCardNames().filter(n => /\bchange (?:a|the) targets? of target effect\b/i.test(getCard(n).text ?? ''));

test('CT-306 the change-the-targets cards are derived, and Gravitational Correction and Divine Intervention are among them', () => {
  for (const n of ['Gravitational Correction', 'Divine Intervention']) {
    assert.ok(CHANGERS.includes(n), `${n} is found by the derivation`);
  }
});

/** A attacks alone with Surly Stalker; its targetless trigger is on the stack
 * and D holds priority. */
function stalkerTrigger(seed: number, changer: string): { h: Harness; A: Seat; D: Seat; trig: number; source?: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const stalker = spawn(h, A, 'Surly Stalker');
  const source = getCard(changer).spellEffect ? undefined : spawn(h, D, changer);
  for (const f of getCard(changer).factions!) giveResources(h, D, f as ResourceKind, 8);
  giveResources(h, A, 'water', 8);   // the victim CAN afford any ransom: affordability is not why it is not asked
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[stalker]] });
  const trig = h.state.stack.find(i => i.kind === 'triggered' && i.label.includes('Surly Stalker'));
  assert.ok(trig, 'Surly Stalker attacked alone and its trigger is on the stack');
  assert.ok(trig.parts.every(p => !p.targets.length), 'the premise: the trigger declares no targets');
  if (h.state.priority !== D) h.do({ type: 'passPriority', seat: h.state.priority! });
  assert.equal(h.state.priority, D, 'D holds priority to answer it');
  return { h, A, D, trig: trig.id, ...(source ? { source } : {}) };
}

/** F-U03-6: a "change a target of target effect TO ME" card (Enigmatic Warder)
 * may target only an effect it could be a legal target of — Caleb, RQ
 * 1403796597896253511: "you can change any spell where warder could be a legal
 * target". It never reaches the targetless trigger; 530 pins the rest. */
const toMe = (n: string): boolean => /\bchange a target of target effect to me\b/i.test(getCard(n).text ?? '');

for (const [k, changer] of CHANGERS.filter(toMe).entries()) {
  test(`CT-306 ${changer} cannot be aimed at a targetless trigger at all`, () => {
    const { h, D, source } = stalkerTrigger(51150 + k, changer);
    assert.ok(source !== undefined, `${changer} is a unit with the ability`);
    assert.ok(!legalActions(h.state, D).some(a => a.type === 'activateAbility' && a.entityId === source),
      `${changer} is not offered: it could not be a target of a trigger with no targets`);
  });
}

for (const [k, changer] of CHANGERS.filter(n => !toMe(n)).entries()) {
  test(`CT-306 ${changer} at a targetless trigger raises no payOrDecline and says there is nothing to change`, () => {
    const { h, D, trig, source } = stalkerTrigger(51100 + k, changer);
    const c = getCard(changer);
    if (c.spellEffect) h.do({ type: 'playCard', seat: D, handIndex: give(h, D, changer) });
    else {
      const ai = c.augmentText!.findIndex(a => a.type === 'activated');
      h.do({ type: 'activateAbility', seat: D, entityId: source!, abilityIndex: ai, via: 'augment' });
    }
    // the cast's own questions: X (the least) and the target (the trigger)
    for (let n = 0; n < 5 && h.state.decision; n++) {
      const dec = h.state.decision;
      const i = dec.options.findIndex(o => key(o.value) === key({ stack: trig }));
      h.do({ type: 'decide', seat: dec.seat, choice: Math.max(i, 0) });
    }
    const mine = h.state.stack.at(-1)!;
    assert.ok(mine.parts.some(p => p.targets.some(t => key(t) === key({ stack: trig }))),
      `${changer} is on the stack aimed at the trigger`);

    // resolve it, recording every question asked on the way
    const asked: string[] = [];
    for (let n = 0; n < 20 && h.state.stack.some(i => i.id === mine.id || h.state.decision); n++) {
      const dec = h.state.decision;
      if (dec) {
        asked.push(`${dec.kind} to seat ${dec.seat}: ${dec.prompt}`);
        h.do({ type: 'decide', seat: dec.seat, choice: 0 });
        continue;
      }
      const seat = ([0, 1] as Seat[]).find(p => legalActions(h.state, p).some(a => a.type === 'passPriority'));
      assert.ok(seat !== undefined, 'somebody can pass');
      h.do({ type: 'passPriority', seat });
    }
    assert.ok(!h.state.stack.some(i => i.id === mine.id), `${changer} resolved`);
    assert.deepEqual(asked, [], `${changer} asked a question about a trigger with no target to change`);
    assert.ok(h.log.some(l => l.includes(changer) && /no target/.test(l)),
      `${changer} says in the log that there was nothing to change`);
  });
}
