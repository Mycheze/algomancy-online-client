/* CT-307 — A CHANGE-THE-TARGETS CARD AIMED AT AN EFFECT IT CANNOT CHANGE ASKS FIRST.
 *
 * The owner, 2026-10-21, asked whether Gravitational Correction may be cast at
 * an effect with no targets (RCUY #235–237, Surly Stalker's attack trigger):
 *
 *   "yes [they may be cast], since it just says 'target effect', but I think
 *    we should add a stop/reminder that 'hey, this effect has no targets, so
 *    this card will have no effect. Do you want to continue?' should be
 *    enough."
 *
 * So the candidate stays on the menu (castability is unchanged), and the
 * option carries a display-only `confirm` with `confirmWhy: 'noop'`
 * (TargetSpec.pickConfirm). The client asks before sending; "Continue" sends
 * the very pick it interrupted, "Go back" sends nothing; a pick with something
 * to change goes straight through.
 *
 * The class is DERIVED from the printed text: "change a/the target(s) of
 * target effect".
 *
 * §1 the class, derived, and every member carries the stop
 * §2 the engine marks the targetless effect, and not the targeted one
 * §3 the client asks first; Continue sends; Go back sends nothing
 * §4 a pick with a changeable target is sent at once
 *
 * Seeds 52900-52999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { allCardNames, getCard, type TargetSpec } from '../../engine/src/cards/dsl.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import { give, giveResources, pick, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { DecisionOption, ResourceKind, Seat } from '../../engine/src/types.ts';

const ui = await client();
const key = (r: unknown): string => JSON.stringify(r);
const CHANGERS = allCardNames()
  .filter(n => /\bchange (?:a|the) targets? of target effect\b/i.test(getCard(n).text ?? ''));

/** the target spec a changer aims with (its spell, or its activated text) */
function specOf(name: string): TargetSpec | undefined {
  const c = getCard(name);
  if (c.spellEffect) return c.spellEffect.targets;
  const a = [...(c.abilities ?? []), ...(c.augmentText ?? [])].find(x => x.type === 'activated');
  return a?.effect.targets;
}

/* ══ §1 ═══════════════════════════════════════════════════════════════ */

test('CT-307 the change-the-targets class is derived, and every member carries the no-op stop', () => {
  for (const n of ['Gravitational Correction', 'Divine Intervention', 'Enigmatic Warder']) {
    assert.ok(CHANGERS.includes(n), `${n} is found by the derivation`);
  }
  for (const n of CHANGERS) {
    assert.equal(typeof specOf(n)?.pickConfirm, 'function', `${n} asks before it is aimed at nothing`);
  }
});

/* ══ the board ════════════════════════════════════════════════════════ */

/**
 * A attacks alone with Surly Stalker (its trigger declares no targets) and
 * answers it with Invigorate on the Stalker (a target that can change). D
 * holds priority with both on the stack, and starts `changer`.
 */
function board(seed: number, changer: string) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const stalker = spawn(h, A, 'Surly Stalker');
  spawn(h, D, 'Good Whale');   // another unit, so the Invigorate's target can change
  const source = getCard(changer).spellEffect ? undefined : spawn(h, D, changer);
  for (const f of getCard(changer).factions!) giveResources(h, D, f as ResourceKind, 8);
  giveResources(h, A, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[stalker]] });
  const trig = h.state.stack.find(i => i.kind === 'triggered' && i.label.includes('Surly Stalker'))!;
  assert.ok(trig && trig.parts.every(p => !p.targets.length), 'the premise: a targetless trigger is on the stack');
  if (h.state.priority !== A) h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Invigorate') });
  pick(h, { unit: stalker });
  const inv = h.state.stack.at(-1)!;
  assert.equal(inv.card, 'Invigorate', 'the premise: a targeted spell is on the stack too');
  for (let n = 0; n < 4 && h.state.priority !== D; n++) h.do({ type: 'passPriority', seat: h.state.priority! });
  assert.equal(h.state.priority, D, 'D holds priority');
  const c = getCard(changer);
  if (c.spellEffect) h.do({ type: 'playCard', seat: D, handIndex: give(h, D, changer) });
  else {
    const ai = c.augmentText!.findIndex(a => a.type === 'activated');
    h.do({ type: 'activateAbility', seat: D, entityId: source!, abilityIndex: ai, via: 'augment' });
  }
  // X (Gravitational Correction) is asked before the target: take the least
  if (h.state.decision?.kind !== 'targets') h.do({ type: 'decide', seat: D, choice: 0 });
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'targets', `${changer} asks for its target`);
  const at = (id: number): number => dec.options.findIndex(o => key(o.value) === key({ stack: id }));
  return { h, A, D, trig: at(trig.id), inv: at(inv.id), trigId: trig.id, invId: inv.id };
}

/* ══ §2 ═══════════════════════════════════════════════════════════════ */

/** F-U03-6: "change a target of target effect TO ME" (Enigmatic Warder) may
 * target only an effect it could be a legal target of — Caleb, RQ
 * 1403796597896253511 — so the targetless trigger is not on its menu at all;
 * engine/test/530 pins it. The owner's call above is for the others. */
const toMe = (n: string): boolean => /\bchange a target of target effect to me\b/i.test(getCard(n).text ?? '');

for (const [k, changer] of CHANGERS.filter(toMe).entries()) {
  test(`CT-307 ${changer}: the targetless effect is not on the menu, the targeted one goes straight through`, () => {
    const { h, trig, inv } = board(52920 + k, changer);
    const opts: DecisionOption[] = h.state.decision!.options;
    assert.equal(trig, -1, 'it could not be a target of a trigger with no targets');
    assert.ok(inv >= 0, 'the effect it could be a target of is offered');
    assert.equal(opts[inv]!.confirm, undefined);
  });
}

for (const [k, changer] of CHANGERS.filter(n => !toMe(n)).entries()) {
  test(`CT-307 ${changer}: the targetless effect asks first, the targeted one does not`, () => {
    const { h, trig, inv } = board(52900 + k, changer);
    const opts: DecisionOption[] = h.state.decision!.options;
    assert.ok(trig >= 0 && inv >= 0, 'both effects are on the menu: the stop is never a narrowing');
    assert.equal(opts[trig]!.confirmWhy, 'noop');
    assert.equal(opts[trig]!.confirm, `This effect has no targets, so ${changer} will do nothing. Continue?`);
    assert.equal(opts[inv]!.confirm, undefined, 'an effect with a target to change goes straight through');
  });
}

/* ══ §3 ═══════════════════════════════════════════════════════════════ */

test('CT-307 the client asks before sending a targetless pick, and Continue sends that pick', () => {
  const { h, D, trig, trigId } = board(52950, 'Gravitational Correction');
  ui.join(viewFor(h.state, D), D, legalActions(h.state, D));
  ui.sent();
  ui.click({ act: 'stackitem', id: String(trigId) });
  assert.deepEqual(ui.actions(), [], 'nothing is sent before the player answers');
  assert.match(ui.html(), /This effect has no targets, so Gravitational Correction will do nothing\. Continue\?/,
    'the question is on screen');
  assert.match(ui.html(), /data-btn="allyconfirm"[^>]*>Continue</, 'with Continue');
  assert.match(ui.html(), /data-btn="allycancel">Go back</, 'and Go back');
  ui.click({ btn: 'allyconfirm' });
  assert.deepEqual(ui.actions(), [{ type: 'decide', seat: D, choice: trig }],
    'Continue sends the same pick it interrupted');
});

test('CT-307 Go back sends nothing and leaves the target pick open', () => {
  const { h, D, trigId } = board(52951, 'Gravitational Correction');
  ui.join(viewFor(h.state, D), D, legalActions(h.state, D));
  ui.sent();
  ui.click({ act: 'stackitem', id: String(trigId) });
  ui.click({ btn: 'allycancel' });
  assert.deepEqual(ui.actions(), [], 'Go back sends nothing');
  assert.doesNotMatch(ui.html(), /will do nothing\. Continue\?/, 'the question is gone');
  assert.ok(ui.has({ act: 'stackitem', id: String(trigId) }), 'and the same target pick is still open');
});

/* ══ §4 ═══════════════════════════════════════════════════════════════ */

test('CT-307 a pick with a target to change is sent at once', () => {
  const { h, D, inv, invId } = board(52952, 'Gravitational Correction');
  ui.join(viewFor(h.state, D), D, legalActions(h.state, D));
  ui.sent();
  ui.click({ act: 'stackitem', id: String(invId) });
  assert.deepEqual(ui.actions(), [{ type: 'decide', seat: D, choice: inv }], 'no question, straight on the wire');
});

