/* CT-309 — "YOU MAY … TARGET": DECLINE OR TARGET, AT THE TARGET STEP.
 *
 * Report #232/233 (Shoreline Specter). The pool was split: seven "you may …
 * target" triggers let the player skip at the target menu (min 0), and four
 * (Shoreline Specter, Mindspore Fiend, Apex Prime, Chombot) forced a target
 * and asked the "may" again at resolution — so a player who never meant to use
 * the ability still had to point it at something (which fires "when targeted"
 * text) and then say no. The owner, 2026-10-21:
 *
 *   "decline/target should be the options. Same for all similarly worded
 *    things. You get the option to target something OR can decline and it
 *    doesn't happen."
 *
 * So every triggered ability or graft rider whose printed "may" governs a
 * "target" carries `TargetSpec.may`: "No targets" before the first pick
 * declines the whole ability, and picking a target is the yes — no second
 * "may" at resolution.
 *
 * ONE KEPT QUESTION, by source: a "you may pay [N] to …" ability (Reclaimer
 * of Secrets, Blightwalker) still asks for the payment as it resolves. That is
 * CR 111.9 and the designer's own answer for the same template (RAQ, Xenopod
 * Progenitor's "you may pay [one] to create …": "Xenopod goes on the stack
 * without a payment decision; the [1] is asked as it resolves"). Chombot's "up
 * to two counters" is a quantity, not the "may", and also stays.
 *
 * The class is DERIVED from the printed text, never listed.
 *
 * §1 the class, derived, and every member (and only a member) is `may`
 * §2 the target step offers the decline, on a real collector, for every member
 * §3 no second "may" at resolution (the run asks no yes/no about the ability)
 * §4 Shoreline Specter, end to end: decline, and target
 * §5 Chombot: both targets or neither; a declined bounded use is not spent
 *
 * Seeds 51200-51299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { allCardNames, getCard, type EffectDef, type TargetSpec } from '../src/cards/dsl.ts';
import type { CardName, Decision, Seat, StackItem } from '../src/types.ts';
import { ent, finishBattle, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

const isDone = (v: unknown): boolean => !!v && typeof v === 'object' && 'doneTargets' in (v as object);

/** the printed sentences of a card, markup stripped */
const sentences = (text: string): string[] =>
  text.replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
/** a sentence whose "may" governs a target ("you may recall target ally");
 * "may choose new targets" is the copy-retarget template, not this one */
const MAY_TARGET = /\bmay\b[^.]*\btarget\b/i;

interface Row { card: string; key: string; route: string; def: EffectDef; spec: TargetSpec; may: string[] }

/** every target spec in the pool, with its effect key and route */
function rows(): Row[] {
  const out: Row[] = [];
  for (const card of allCardNames()) {
    const c = getCard(card);
    const may = sentences(c.text ?? '').filter(s => MAY_TARGET.test(s));
    const add = (key: string, route: string, def: EffectDef | undefined) => {
      if (def?.targets) out.push({ card, key, route, def, spec: def.targets, may });
    };
    add(`spell:${card}`, 'spell', c.spellEffect);
    (c.abilities ?? []).forEach((a, i) => add(`ability:${card}#${i}`, a.type, a.effect));
    (c.augmentText ?? []).forEach((a, i) => add(`augment:${card}#${i}`, a.type, a.effect));
    if (c.graftEffect) add(`graft:${card}`, 'triggered', c.graftEffect.effect);   // a rider rides a trigger's cause
  }
  return out;
}
const ALL = rows();
/** the class: a triggered ability or graft rider of a card printing "may … target" */
const CLASS = ALL.filter(r => r.route === 'triggered' && r.may.length);

/* ══ §1 ═══════════════════════════════════════════════════════════════ */

test('CT-309 the may-target class is derived from printed text and every member declines at the target step', () => {
  for (const must of ['Shoreline Specter', 'Mindspore Fiend', 'Apex Prime', 'Chombot', 'Hooba-Mon', 'Blightwalker']) {
    assert.ok(CLASS.some(r => r.card === must), `${must} is found by the derivation`);
  }
  assert.ok(CLASS.length >= 13, `the derivation reaches the pool (${CLASS.length} specs)`);
  // a card whose may-target sentence could belong to either of two targeted
  // triggers would make the derivation guess; none does today
  for (const r of CLASS) {
    const siblings = CLASS.filter(x => x.card === r.card && x.route === 'triggered' && !x.key.startsWith('graft:'));
    assert.ok(siblings.length <= 1, `${r.card}: more than one targeted trigger beside a "may … target" sentence`);
  }
  const bad = CLASS.filter(r => r.spec.may !== true).map(r => `${r.key}: ${r.may.join(' ')}`);
  assert.deepEqual(bad, [], 'these "you may … target" triggers force a target (TargetSpec.may missing)');
});

test('CT-309 only a printed may-target trigger carries the flag', () => {
  const stray = ALL.filter(r => r.spec.may && !CLASS.includes(r)).map(r => `${r.key} (${r.route})`);
  assert.deepEqual(stray, [], 'a spell, an activated ability or a trigger that prints no "may … target" declines at targets');
});

/* ══ §2 ═══════════════════════════════════════════════════════════════ */

/** a home board with something legal for every member: units with counters on
 * both sides, cheap units and a spell in both bins */
function furnished(seed: number, card: string): { g: E; A: Seat; src: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const src = spawn(h, A, card);
  for (const seat of [A, D] as Seat[]) {
    for (const n of ['Unit Token', 'Good Whale', 'Unit Token']) ent(h, spawn(h, seat, n))!.counters = 2;
    h.state.players[seat]!.bin.push('Ignis Sprite' as CardName, 'Immolate' as CardName, 'Tidal Menace' as CardName);
  }
  return { g: new E(h.state), A, src };
}

for (const r of CLASS) {
  test(`CT-309 ${r.key}: the first target question offers No targets`, () => {
    const { g, A, src } = furnished(51200 + CLASS.indexOf(r), r.card);
    const item = {
      id: 9_512, kind: 'triggered', card: r.card as CardName, label: r.card, controller: A,
      region: g.homeRegion(A), negated: false, sourceId: src,
      parts: [{ effectKey: r.key, targets: [] }],
    } as unknown as StackItem;
    const asked: Omit<Decision, 'id'>[] = [];
    g.collectInlineTargets(item, (_pi, _n, dec) => {
      asked.push(dec);
      const stop = dec.options.findIndex(o => isDone(o.value));
      return stop >= 0 ? dec.options[stop]!.value : dec.options[0]!.value;
    });
    assert.ok(asked.length > 0, `${r.key}: the board offered no candidate, so this proves nothing`);
    assert.ok(asked[0]!.options.some(o => !isDone(o.value)), 'a target is on the menu');
    assert.ok(asked[0]!.options.some(o => isDone(o.value)), 'and so is the decline, beside it');
    assert.equal(item.parts[0]!.targets.length, 0, 'declining declares nothing');
  });
}

/* ══ §3 ═══════════════════════════════════════════════════════════════ */

test('CT-309 no may-target trigger asks a second may when it resolves', () => {
  // A yes/no about the ability itself is a question with a boolean or a
  // "Decline" option. Kept, by CR 111.9 (see the header): the payment of a
  // printed "you may pay [N] to …".
  const asks = /label:\s*'Decline'|value:\s*false\b|kind:\s*'payOrDecline'[^}]*value:\s*true\b/;
  const bad = CLASS
    .filter(r => !r.may.some(s => /\bmay pay\b/i.test(s)))
    .filter(r => asks.test(r.def.run.toString()))
    .map(r => r.key);
  assert.deepEqual(bad, [], 'these still ask the "may" again at resolution');
});

/* ══ §4 ═══════════════════════════════════════════════════════════════ */

/** Shoreline Specter and a Good Whale attack unblocked; the after-combat
 * trigger is asking for its target */
function specterBoard(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const sp = spawn(h, A, 'Shoreline Specter');
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sp], [wh]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'targets', 'the after-combat trigger asks for its ally');
  assert.match(dec.prompt, /Shoreline Specter/);
  return { h, A, D, wh, dec, life: h.state.players[D]!.life };
}

test('CT-309 Shoreline Specter declined at the target step: no recall and no life loss', () => {
  const { h, D, wh, dec, life } = specterBoard(51290);
  const stop = dec.options.findIndex(o => isDone(o.value));
  assert.ok(stop >= 0, 'the decline is on the target menu');
  h.do({ type: 'decide', seat: dec.seat, choice: stop });
  for (let n = 0; n < 6 && h.state.stack.length; n++) {
    assert.notEqual(h.state.decision?.kind, 'payOrDecline', 'nothing more is asked');
    pass(h);
  }
  assert.ok(ent(h, wh), 'nothing was recalled');
  assert.equal(h.state.players[D]!.life, life, 'and nobody lost life');
  assert.ok(h.log.some(l => /Shoreline Specter: declined/.test(l)), 'the log says it was declined');
  finishBattle(h);
});

test('CT-309 Shoreline Specter given a target recalls it and drains with no further prompt', () => {
  const { h, A, D, wh, life } = specterBoard(51291);
  pick(h, { unit: wh });
  for (let n = 0; n < 6 && h.state.stack.length; n++) {
    assert.notEqual(h.state.decision?.kind, 'payOrDecline', 'no second "may" at resolution');
    assert.equal(h.state.decision, null, `nothing is asked while it resolves (${h.state.decision?.prompt})`);
    pass(h);
  }
  assert.ok(!ent(h, wh) && h.state.players[A]!.hand.includes('Good Whale'), 'the ally was recalled');
  assert.equal(h.state.players[D]!.life, life - 2, 'and each opponent lost 2');
  finishBattle(h);
});

/* ══ §5 ═══════════════════════════════════════════════════════════════ */

test('CT-309 Chombot: once one target is picked both are required, and a decline does not spend the use', () => {
  const h = new Harness(51292);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const chom = spawn(h, A, 'Chombot');
  const mate = spawn(h, A, 'Unit Token');
  ent(h, mate)!.counters = 2;
  spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[chom], [mate]] });
  const first = h.state.decision!;
  assert.equal(first.kind, 'targets');
  assert.match(first.prompt, /Chombot/);
  assert.ok(first.options.some(o => isDone(o.value)), 'the first question offers the decline');
  pick(h, { unit: mate });
  assert.ok(!h.state.decision!.options.some(o => isDone(o.value)),
    'after one pick there is no stop: "from target unit onto another target unit" needs both');

  // the decline on a bounded ([Switch1]) trigger hands the use back (CR 109.9b)
  const h2 = new Harness(51293);
  toDeployment(h2);
  const A2 = h2.state.initiative, D2 = (1 - A2) as Seat;
  const c2 = spawn(h2, A2, 'Chombot');
  const m2 = spawn(h2, A2, 'Unit Token');
  ent(h2, m2)!.counters = 2;
  spawn(h2, D2, 'Good Whale');
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[c2], [m2]] });
  const d2 = h2.state.decision!;
  h2.do({ type: 'decide', seat: d2.seat, choice: d2.options.findIndex(o => isDone(o.value)) });
  for (let n = 0; n < 6 && h2.state.stack.length; n++) pass(h2);
  assert.ok(h2.log.some(l => /Chombot: declined/.test(l)), 'the log says it was declined');
  assert.ok(h2.log.some(l => /its use is not spent/.test(l)), 'and that the [Switch1] use is not spent');
  assert.equal(Object.values(ent(h2, c2)!.budgets ?? {}).filter(v => (v ?? 0) > 0).length, 0,
    'no budget is left reserved on Chombot');
});
