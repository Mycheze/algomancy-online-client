/**
 * RAQ — the threads that arrived or changed in the 2026-10-10 re-export, read
 * against the engine (ledgers/raq.ts; the audit is engine/test/386).
 *
 *  · "[Solved] Combat Damage triggers & "After Combat" triggers stack." — most
 *    of it was already guarded by 239 (R261 took this very write-up as its
 *    text); what is new here is the Swift/Sluggish follow-up: the LAST damage
 *    sub-step's triggers join the after-combat batch.
 *  · "[Solved] Mods are NOT Played." — what was missing is "you still need to
 *    pay the cost & meet affinity requirements" for an augment and a Virus.
 *  · "[Solved] Spell Tokens vs Hand. …" — its new point 1: a spell token is
 *    not in the hand, and casting one is a play from somewhere other than the
 *    hand (R342).
 *
 * Authority, as everywhere in this repo: `calebgannon` is final, `_passer`'s
 * [Solved] write-ups are reliable, other players are reasoning aloud.
 *
 * Seeds 40800-40899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Action, EntityId, Seat } from '../src/types.ts';
import {
  effStats, ent, give, giveResources, pass, pick, spawn, throughDamageWindows, toDeployment, toNextBattle,
  withE as whiteBox,
} from './util.ts';

const other = (s: Seat): Seat => (1 - s) as Seat;

/** answer the damage step's own elective-split questions, and nothing else */
function answerElections(h: Harness): void {
  let guard = 30;
  while (h.state.decision?.kind === 'assignDamage' && guard-- > 0) {
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  }
}

/** the trigger-ordering question `seat` is asked after combat, its labels */
function orderingOf(h: Harness, seat: Seat): string[] {
  let guard = 20;
  while (h.state.decision && guard-- > 0) {
    const d = h.state.decision;
    if (d.kind === 'orderTriggers' && d.seat === seat) return d.options.map(o => o.label);
    h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
  }
  assert.fail(`${seat} was never asked to order a batch (decision: ${h.state.decision?.kind ?? 'none'})`);
}

// ── [Solved] Combat Damage triggers & "After Combat" triggers stack. ─────
// mycheze: "How does this interact with Swift/Sluggish?" — _passer: "presence
// of Swift or/and Sluggish opens new stacks which must be resolved before you
// move to next combat damage step (swift->normal->sluggish), but the last one
// which happens is then directly connected with "after combat""

test('RAQ Combat Damage & After Combat: with Swift in the battle, a death in the LAST (normal) sub-step joins the after-combat batch', () => {
  const h = new Harness(40801);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const lith = spawn(h, A, 'Lithoghul');            // 4/4, normal sub-step
  const swift = spawn(h, A, 'Dune Drifter');        // 2/1 {Swift}: splits the step
  const geo = spawn(h, D, 'Geode');                 // dies to 4 → "create a Crystal"
  spawn(h, D, 'Wisp');                              // "After combat, sacrifice me."
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lith], [swift]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [geo] }, send: [], spellTokens: [] });
  pass(h); pass(h);
  answerElections(h);
  assert.equal(h.state.battle!.step, 'damageWindow', 'the Swift sub-step struck and the step split');
  assert.ok(ent(h, geo), 'the Geode is still alive at the Swift/normal boundary');
  throughDamageWindows(h);
  answerElections(h);

  assert.ok(!ent(h, geo), 'the Geode died in the normal sub-step');
  const labels = orderingOf(h, D);
  assert.ok(labels.some(l => /Geode/.test(l)), `the last sub-step's death trigger is in the batch [${labels.join(' | ')}]`);
  assert.ok(labels.some(l => /Wisp/.test(l) && /after combat/i.test(l)),
    'and so is the after-combat trigger — the last sub-step is "directly connected with after combat"');
});

test('RAQ Combat Damage & After Combat: with Sluggish last, a death in the Sluggish sub-step joins the after-combat batch', () => {
  const h = new Harness(40802);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const adv = spawn(h, A, 'Adversary of the Deep'); // {Sluggish} 2/2
  const geo = spawn(h, D, 'Geode');                 // 1/1: strikes in the normal sub-step, dies in the Sluggish one
  spawn(h, D, 'Wisp');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[adv]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [geo] }, send: [], spellTokens: [] });
  pass(h); pass(h);
  answerElections(h);
  assert.equal(h.state.battle!.step, 'damageWindow', 'normal struck first; the Sluggish sub-step is still to come');
  assert.equal(h.state.battle!.pendingSub, 'Sluggish');
  throughDamageWindows(h);
  answerElections(h);

  assert.ok(!ent(h, geo), 'the Geode died in the Sluggish sub-step');
  const labels = orderingOf(h, D);
  assert.ok(labels.some(l => /Geode/.test(l)) && labels.some(l => /Wisp/.test(l)),
    `one batch with the after-combat trigger [${labels.join(' | ')}]`);
});

// ── [Solved] Mods are NOT Played. ────────────────────────────────────────
// _passer: "They are Applied. When you use them you still need to pay the cost
// & meet affinity requirements." (Grafts: 393 Graft 101 point 3.)

const augmentsFromHand = (h: Harness, seat: Seat, name: string): Action[] =>
  h.legal(seat).filter(a => a.type === 'augment' && a.from === 'hand'
    && h.state.players[seat]!.hand[a.index] === name);

test('RAQ Mods are NOT Played: an augment from hand needs its affinity and pays its cost', () => {
  const h = new Harness(40811);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Bripp');
  give(h, A, 'Stalwart Sentinel');                  // l / [1], [Augment]
  giveResources(h, A, 'fire', 3);
  assert.equal(augmentsFromHand(h, A, 'Stalwart Sentinel').length, 0, 'three mana, no light: not offered');
  giveResources(h, A, 'light', 1);
  const opt = augmentsFromHand(h, A, 'Stalwart Sentinel')[0];
  assert.ok(opt, 'with the light pip it is offered');
  const mana = h.q.openMana(A);
  h.do(opt!);
  assert.equal(h.q.openMana(A), mana - 1, 'and the [1] is paid');
});

test('RAQ Mods are NOT Played: a Virus in battle needs its affinity and pays its cost', () => {
  const h = new Harness(40812);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Bripp');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  assert.equal(h.state.priority, D, 'D holds priority in the attack window');
  give(h, D, "Möbius's Corruption");               // d / [1] {Virus}
  giveResources(h, D, 'fire', 3);
  const onto = (): Action[] => augmentsFromHand(h, D, "Möbius's Corruption").filter(a => a.type === 'augment' && a.hostId === atk);
  assert.equal(onto().length, 0, 'three mana, no dark: not offered');
  giveResources(h, D, 'dark', 1);
  const opt = onto()[0];
  assert.ok(opt, 'with the dark pip it is offered onto the enemy attacker');
  const mana = h.q.openMana(D);
  h.do(opt!);
  assert.equal(h.q.openMana(D), mana - 1, 'and the [1] is paid');
});

// ── [Solved] Spell Tokens vs Hand. … point 1 ─────────────────────────────
// _passer: "Spell tokens are not in hand. They won't count for things like
// Dreadspawn Horror or Astral Tidewraith. Playing spell token like Fireball
// will trigger Stalwart Sentinel."

function fireball(h: Harness, seat: Seat, x: number): EntityId {
  let id = 0;
  whiteBox(h, e => { id = e.createSpellToken(seat, 'Fireball', x, e.homeRegion(seat)).id; });
  return id;
}

test('RAQ Spell Tokens vs Hand: Dreadspawn Horror does not count spell tokens as cards in hand', () => {
  const h = new Harness(40821);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  h.state.players[A]!.hand.length = 0;
  const ds = spawn(h, A, 'Dreadspawn Horror');
  assert.deepEqual(effStats(h, ds), [7, 5], 'empty hand: 7/5');
  fireball(h, A, 2); fireball(h, A, 3);
  assert.deepEqual(effStats(h, ds), [7, 5], 'two Fireball tokens: still 7/5 — they are not in the hand');
  give(h, A, 'Bripp');
  assert.deepEqual(effStats(h, ds), [6, 4], 'the control: a real card in hand counts');
});

test('RAQ Spell Tokens vs Hand: Astral Tidewraith does not count spell tokens as cards in hand', () => {
  const h = new Harness(40822);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const tide = spawn(h, A, 'Astral Tidewraith');
  fireball(h, A, 2);
  fireball(h, D, 2); fireball(h, D, 3);
  toNextBattle(h, A);
  h.state.players[A]!.hand = [];
  h.state.players[D]!.hand = ['Bripp'];
  const lifeA = h.state.players[A]!.life, lifeD = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[tide]] });
  assert.ok(h.state.stack.some(it => /Astral Tidewraith/.test(it.label)), 'the attack trigger is on the stack');
  let guard = 6;
  while (h.state.stack.some(it => /Astral Tidewraith/.test(it.label)) && guard-- > 0) pass(h);
  assert.equal(h.state.players[D]!.life, lifeD - 1, 'D: one card in hand, two Fireball tokens — 1 damage');
  assert.equal(h.state.players[A]!.life, lifeA, 'A: empty hand and a Fireball token — no damage');
});

/** D attacks A's region with a Unit Token, so A's home units and tokens stand
 * in the battle; A holds priority with an empty stack. */
function defending(seed: number, setup: (h: Harness, A: Seat) => void): { h: Harness; A: Seat; raider: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = other(A);
  const raider = spawn(h, D, 'Unit Token');
  setup(h, A);
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);
  assert.equal(h.state.priority, A, 'setup: A holds priority');
  return { h, A, raider };
}

test('RAQ Spell Tokens vs Hand: casting a Fireball token triggers Stalwart Sentinel — a play from somewhere other than the hand', () => {
  let sent = 0, tok = 0;
  const { h, A, raider } = defending(40823, (h, A) => {
    sent = spawn(h, A, 'Stalwart Sentinel');
    tok = fireball(h, A, 1);
  });
  assert.equal(ent(h, sent)!.counters, 0);
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: raider });
  let guard = 10;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    const d = h.state.decision;
    if (d) h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
    else pass(h);
  }
  assert.equal(ent(h, sent)!.counters, 2, 'R342: the Sentinel takes its two +1/+1 counters');
});

test('RAQ Spell Tokens vs Hand: Proph, printed with the same words, draws for a cast Fireball token too', () => {
  let tok = 0;
  const { h, A, raider } = defending(40824, (h, A) => {
    spawn(h, A, 'Proph');
    tok = fireball(h, A, 1);
  });
  const hand0 = h.state.players[A]!.hand.length;
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: raider });
  let guard = 10;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    const d = h.state.decision;
    if (d) h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
    else pass(h);
  }
  assert.equal(h.state.players[A]!.hand.length, hand0 + 1, 'R342: "a unit or spell from anywhere other than your hand" — Proph draws');
});
