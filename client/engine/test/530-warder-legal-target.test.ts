/* F-U03-6 — ENIGMATIC WARDER TARGETS ONLY AN EFFECT IT COULD BE A TARGET OF.
 *
 * "[Augment] [two]: Change a target of target effect to me." Caleb,
 * rules-questions (RQ 1403796597896253511, 2025-08-09), asked whether Warder
 * may be aimed at an effect with no target ("or is it 'it doesnt [h]ave one
 * target, you cant activate it'"):
 *
 *   "Yeah you can change any spell where warder could be a legal target."
 *
 * So the effect must have a target slot Warder could legally hold right now:
 * the slot's own kind and restriction, judged as the slot was first judged
 * (`E.canFillSlot`), over every slot a change can reach (`E.targetSlots`, a
 * Virus's host included). The owner's 2026-10-21 call that a change-the-
 * targets card may be aimed at a targetless effect (CT-307, 529) is about
 * Gravitational Correction and Divine Intervention: the designer ruled on
 * Warder himself.
 *
 * §1 a targetless trigger: Warder is not offered; Gravitational Correction
 *    and Divine Intervention still are (the control)
 * §2 effects whose every slot Warder cannot fill (a player, an ally of the
 *    other side, "4 or more defense"): not offered; add one it can fill and
 *    that one, alone, is on the menu
 * §3 a battle Virus being applied in Warder's region is on the menu
 * §4 a slot that already holds Warder: offered (Warder could be its legal
 *    target), and the CT-307 stop says the change does nothing
 *
 * Seeds 53000-53099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { EntityId, Seat, StackItem, TargetRef } from '../src/types.ts';
import { effStats, give, giveResources, spawn, toDeployment, toNextBattle } from './util.ts';

const key = (r: unknown): string => JSON.stringify(r);
const WARDER = 'Enigmatic Warder';
const WARDER_AB = getCard(WARDER).augmentText!.findIndex(a => a.type === 'activated');

/** A attacks alone with Surly Stalker (its trigger declares no targets) into
 * D's region, where D has Enigmatic Warder and a Good Whale. D holds priority
 * with the trigger on the stack. */
function board(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const stalker = spawn(h, A, 'Surly Stalker');
  const whale = spawn(h, D, 'Good Whale');
  const warder = spawn(h, D, WARDER);
  for (const f of ['earth', 'fire', 'light'] as const) giveResources(h, D, f, 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[stalker]] });
  const trig = h.state.stack.find(i => i.kind === 'triggered' && i.label.includes('Surly Stalker'))!;
  assert.ok(trig && trig.parts.every(p => !p.targets.length), 'the premise: a targetless trigger is on the stack');
  const region = trig.region;
  for (const id of [stalker, whale, warder]) {
    assert.equal(h.state.entities[id]!.region, region, `unit ${id} stands in the battle's region`);
  }
  if (h.state.priority !== D) h.do({ type: 'passPriority', seat: h.state.priority! });
  assert.equal(h.state.priority, D, 'D holds priority');
  return { h, A, D, stalker, whale, warder, region, trig: trig.id };
}

/** push A's effect `effectKey` onto the stack with `targets`, hand-built so it
 * asks nothing; returns its id */
function push(h: Harness, A: Seat, region: number, kind: StackItem['kind'], card: string,
  effectKey: string, targets: TargetRef[]): number {
  const e = new E(h.state);
  const it: StackItem = {
    id: e.s.nextId++, kind, card, label: card, controller: A, region, negated: false,
    parts: [{ effectKey, targets }],
  };
  e.s.stack.push(it);
  h.state = e.s;
  return it.id;
}

/** is D offered Warder's activation at all? */
const offeredWarder = (h: Harness, D: Seat, warder: EntityId): boolean =>
  legalActions(h.state, D).some(a => a.type === 'activateAbility' && a.entityId === warder);

/** activate Warder and return the stack ids its target menu offers */
function warderMenu(h: Harness, D: Seat, warder: EntityId): { ids: number[]; confirm: Map<number, string | undefined> } {
  h.do({ type: 'activateAbility', seat: D, entityId: warder, abilityIndex: WARDER_AB, via: 'augment' });
  const dec = h.state.decision!;
  assert.equal(dec?.kind, 'targets', 'Warder asks for its target');
  const ids: number[] = [];
  const confirm = new Map<number, string | undefined>();
  for (const o of dec.options) {
    const v = o.value as { stack?: number };
    if (v && typeof v === 'object' && typeof v.stack === 'number') { ids.push(v.stack); confirm.set(v.stack, o.confirm); }
  }
  return { ids, confirm };
}

/** does D's spell `name` offer the stack item `id` as its target? */
function spellOffers(h: Harness, D: Seat, name: string, id: number): boolean {
  const idx = give(h, D, name);
  assert.ok(legalActions(h.state, D).some(a => a.type === 'playCard' && a.handIndex === idx), `${name} can be cast`);
  h.do({ type: 'playCard', seat: D, handIndex: idx });
  if (h.state.decision?.kind !== 'targets') h.do({ type: 'decide', seat: D, choice: 0 });   // X: the least
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'targets', `${name} asks for its target`);
  return dec.options.some(o => key(o.value) === key({ stack: id }));
}

/* ══ §1 ═══════════════════════════════════════════════════════════════ */

test('F-U03-6 Enigmatic Warder is not offered against a targetless trigger', () => {
  const { h, D, warder } = board(53000);
  assert.equal(offeredWarder(h, D, warder), false,
    'with only Surly Stalkers trigger on the stack, Warder has no effect it could be a target of');
  assert.throws(() => h.do({ type: 'activateAbility', seat: D, entityId: warder, abilityIndex: WARDER_AB, via: 'augment' }),
    'and the activation is refused when sent anyway');
});

for (const [k, name] of ['Gravitational Correction', 'Divine Intervention'].entries()) {
  test(`F-U03-6 control: ${name} is still offered against the targetless trigger`, () => {
    const { h, D, trig } = board(53010 + k);
    assert.equal(spellOffers(h, D, name, trig), true, `${name} may be aimed at it (the owner, 2026-10-21)`);
  });
}

/* ══ §2 ═══════════════════════════════════════════════════════════════ */

/** A's effects whose every slot Warder (D's, 1/2) cannot fill */
function unfillable(h: Harness, A: Seat, D: Seat, region: number, stalker: EntityId, whale: EntityId): number[] {
  assert.ok(effStats(h, whale)[1] >= 4, 'the premise: the Whale has 4 or more defense');
  return [
    push(h, A, region, 'spell', 'Fester', 'spell:Fester', [{ player: D }]),                        // a player slot
    push(h, A, region, 'triggered', 'Mycelial Mentor', 'ability:Mycelial Mentor#0', [{ unit: stalker }]),   // "target ally" of A
    push(h, A, region, 'spell', 'Throw off a Cliff', 'spell:Throw off a Cliff', [{ unit: whale }]),        // "4 or more defense"
  ];
}

test('F-U03-6 Enigmatic Warder is not offered against effects whose every target it cannot legally be', () => {
  const { h, A, D, stalker, whale, warder, region } = board(53020);
  const ids = unfillable(h, A, D, region, stalker, whale);
  const g = new E(structuredClone(h.state));
  for (const id of ids) {
    const item = g.s.stack.find(i => i.id === id)!;
    assert.ok(g.targetSlots(item).length > 0, `the premise: ${item.label} has a target`);
    assert.ok(g.targetSlots(item).every(({ pi, ti }) => !g.canFillSlot(item, pi, ti, { unit: warder })),
      `the premise: Warder could not legally be any target of ${item.label}`);
  }
  assert.equal(offeredWarder(h, D, warder), false,
    'a player slot, an ally slot of the other side and a 4-defense slot are not targets Warder could be');
});

test('F-U03-6 Enigmatic Warder is offered against a single-target unit spell it could be the target of, and only that', () => {
  const { h, A, D, stalker, whale, warder, region, trig } = board(53030);
  const ids = unfillable(h, A, D, region, stalker, whale);
  const inv = push(h, A, region, 'spell', 'Invigorate', 'spell:Invigorate', [{ unit: stalker }]);
  assert.equal(offeredWarder(h, D, warder), true, 'Invigorate ("target unit") could target Warder');
  const { ids: menu, confirm } = warderMenu(h, D, warder);
  assert.deepEqual(menu, [inv], 'the menu is the one effect Warder could be a target of');
  assert.equal(confirm.get(inv), undefined, 'and it is sent without a stop');
  for (const id of [trig, ...ids]) assert.ok(!menu.includes(id), `stack item ${id} is not on the menu`);
});

/* ══ §3 ═══════════════════════════════════════════════════════════════ */

test('F-U03-6 Enigmatic Warder is offered against a battle Virus being applied in its region', () => {
  const h = new Harness(53040);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const warder = spawn(h, D, WARDER);
  giveResources(h, A, 'metal', 3);
  giveResources(h, D, 'earth', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(h.state.entities[warder]!.region, h.state.battle!.region, 'Warder stands in the battle region');
  while (h.state.stack.length || h.state.priority !== A) h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Aberrant Statweaver'), hostId: atk });
  const virus = h.state.stack.find(i => i.kind === 'virus')!;
  assert.ok(virus, 'the Virus is on the stack, aimed at the attacker');
  if (h.state.priority !== D) h.do({ type: 'passPriority', seat: h.state.priority! });
  assert.equal(h.state.priority, D, 'D holds priority');
  assert.equal(offeredWarder(h, D, warder), true, 'its host slot is a unit slot Warder could hold');
  assert.deepEqual(warderMenu(h, D, warder).ids, [virus.id], 'the Virus is on the menu');
});

/* ══ §4 ═══════════════════════════════════════════════════════════════ */

test('F-U03-6 an effect whose only fillable target already is Enigmatic Warder is offered, with the no-change stop', () => {
  const { h, A, D, warder, region } = board(53050);
  const inv = push(h, A, region, 'spell', 'Invigorate', 'spell:Invigorate', [{ unit: warder }]);
  assert.equal(offeredWarder(h, D, warder), true, 'Warder is a legal target of it');
  const { ids, confirm } = warderMenu(h, D, warder);
  assert.deepEqual(ids, [inv]);
  assert.match(confirm.get(inv) ?? '', /Enigmatic Warder will do nothing\. Continue\?/,
    'changing that target to Warder is no change, and the stop says so');
});

/* ══ §5 ═══════════════════════════════════════════════════════════════ */

test('F-U03-6 a Warder activation on the stack is no target another Warder could be, and judging it ends', () => {
  const { h, A, D, warder, region, stalker } = board(53060);
  const theirs = spawn(h, A, WARDER);   // A's Warder, home: only its activation goes into the region
  const inv = push(h, A, region, 'spell', 'Invigorate', 'spell:Invigorate', [{ unit: stalker }]);
  // two Warder activations aimed at each other: judging one asks the other's candidates
  const w1 = push(h, D, region, 'activated', WARDER, `augment:${WARDER}#${WARDER_AB}`, []);
  const w2 = push(h, A, region, 'activated', WARDER, `augment:${WARDER}#${WARDER_AB}`, [{ stack: w1 }]);
  h.state.stack.find(i => i.id === w1)!.parts[0]!.targets.push({ stack: w2 });
  h.state.stack.find(i => i.id === w1)!.sourceId = warder;
  h.state.stack.find(i => i.id === w2)!.sourceId = theirs;
  const { ids } = warderMenu(h, D, warder);
  assert.deepEqual(ids, [inv], 'neither Warder activation is on the menu: their one slot holds an effect, never a unit');
});
