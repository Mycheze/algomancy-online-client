/**
 * RAQ batch A, part 1 — combat damage: assignment, prevention, and the
 * attributes that read the amount. Every test names the RAQ thread whose
 * worked example it encodes (ledgers/raq.ts holds the register entry).
 *
 * Authority: `calebgannon` is final; `_passer`'s [Solved] write-ups are the
 * reliable summaries. Where a later owner ruling (R-number) replaced a claim,
 * the register says so and there is no test here for the replaced half.
 *
 * A claim the engine does NOT honour today is a `{ todo }` test: it runs and
 * shows the disagreement without failing the gate, and its register entry
 * names the CT ticket. Nothing in engine/src was changed by this audit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard, type EffectCtx, type EffectDef } from '../src/cards/dsl.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';

// ── helpers ───────────────────────────────────────────────────────────────

/** a p/t token for `seat` in its home region (the 100-elective-assign idiom) */
function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}

/** give a unit an attribute until regroup (white-box: the attribute is the subject, not its source) */
function grant(h: Harness, id: EntityId, attr: Attr): void {
  const g = new E(h.state);
  g.addTempAttr(g.entity(id)!, attr);
}

/** answer the pending elective-split question with the option whose value is `v` */
function elect(h: Harness, v: number): void {
  const dec = h.state.decision!;
  assert.equal(dec?.kind, 'assignDamage', 'an elective-split decision is pending');
  const idx = dec.options.findIndex(o => o.value === v);
  assert.ok(idx >= 0, `option ${v} is offered (menu: ${dec.options.map(o => JSON.stringify(o.value)).join(', ')})`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

/** the numeric amounts the pending elective-split question offers */
function amountsOffered(h: Harness): number[] {
  return (h.state.decision?.options ?? []).map(o => o.value).filter((v): v is number => typeof v === 'number');
}

/** run an effect's `run` directly (the 140-layers-and-riders idiom) */
function resolveEffect(def: EffectDef, g: E, ctx: Partial<EffectCtx> & { controller: Seat }): void {
  def.run(g, {
    sourceName: 'test', region: g.homeRegion(ctx.controller), targets: [], event: null,
    eraseSelf: () => {}, choose: () => { throw new Error('no choice expected'); },
    ...ctx,
  } as EffectCtx);
  g.settle();
}

/** units `seat` controls that are neither of `known` — what an effect created */
const made = (h: Harness, seat: Seat, ...known: EntityId[]): number =>
  unitsOf(h, seat).filter(u => !known.includes(u.id)).length;

/**
 * The RAQ's shielded-Awoken-Tomb board: an attacker of `power` with `attrs`,
 * blocked by a 0/5 Awoken Tomb under Phytochemical Protection in FRONT and a
 * plain 5/6 BEHIND it. (The RAQ puts Bubb behind; Bubb has since become
 * {Unaware} (R106), and an Unaware exchange strips Deadly and Piercing, which
 * would change the question. A vanilla 5/6 keeps the thread's arithmetic.)
 */
function shieldedTombBoard(seed: number, power: number, attrs: Attr[]) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, power, 20);
  const tomb = spawn(h, D, 'Awoken Tomb');          // 0/5, [once] when I am dealt damage → X/X
  const back = tok(h, D, 5, 6);
  giveResources(h, D, 'wood', 2);                   // Phytochemical Protection gg/2
  toNextBattle(h, A);
  for (const a of attrs) grant(h, atk, a);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Phytochemical Protection') });
  pick(h, { unit: tomb });
  pass(h); pass(h);                                 // the shield resolves
  assert.equal(ent(h, tomb)!.damageShield, 'Phytochemical Protection', 'the shield is up');
  pass(h); pass(h);                                 // close the attack window
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [tomb, back] } });
  pass(h); pass(h);                                 // into combat damage
  return { h, A, D, atk, tomb, back };
}

// ── [Solved] Excessive Combat Damage & interaction with Piercing, Deadly and Phytochemical Protection ──

test('RAQ Excessive: a shielded Awoken Tomb in front must still be assigned its 5 before anything goes behind it', () => {
  const { h, D, tomb, back } = shieldedTombBoard(38701, 12, []);
  assert.equal(Math.min(...amountsOffered(h)), 5,
    '"You must assign atleast 5 damage to Awoken before you can start assigning damage to Bubb in the back"');
  elect(h, 5);
  const t = ent(h, tomb)!;
  assert.equal(t.damage, 0, 'the shield prevented all of it');
  assert.equal(t.counters, 5, '"Awoken will get atleast +5/+5 counters"');
  assert.equal(made(h, D, tomb, back), 0,
    '"but won\'t make 5/5 unit" — prevented damage was never dealt, so the Tomb never triggered');
  assert.ok(!ent(h, back), 'the other 7 killed the 5/6 behind it');
  finishBattle(h);
});

test('RAQ Excessive: with Deadly, 1 to the shielded Tomb unlocks the unit behind it', () => {
  const { h, D, tomb, back } = shieldedTombBoard(38702, 12, ['Deadly']);
  assert.equal(Math.min(...amountsOffered(h)), 1, '"Atleast 1 dmg to Awoken"');
  elect(h, 1);
  const t = ent(h, tomb)!;
  assert.ok(t, 'Deadly cannot kill through the shield');
  assert.equal(t.counters, 1, '"gets +1/+1"');
  assert.equal(made(h, D, tomb, back), 0, '"won\'t create 1/1 unit"');
  assert.ok(!ent(h, back), '"rest of the damage can go to Bubb in the back"');
  finishBattle(h);
});

test('RAQ Excessive: with Piercing, 5 to the shielded Tomb, 6 to the unit behind, and the rest to the player', () => {
  const { h, D, tomb, back } = shieldedTombBoard(38703, 15, ['Piercing']);
  // R319 (reverses R7): a Piercing strike elects too — "atleast" is a floor
  assert.equal(h.state.decision?.kind, 'assignDamage', 'the Piercing attacker is asked how to assign');
  elect(h, 5);                                       // "Atleast 5 damage to Awoken"
  elect(h, 6);                                       // "atleast 6 damage to Bubb", the rest goes on
  const t = ent(h, tomb)!;
  assert.equal(t.counters, 5, '"Atleast 5 damage to Awoken (gets atleast +5/+5, won\'t create 5/5)"');
  assert.ok(!ent(h, back), '"atleast 6 damage to Bubb"');
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 4, '"rest can go to Opponent HP": 15 - 5 - 6 = 4');
});

test('RAQ Excessive: Deadly + Piercing + Phytochemical — 1 to the Tomb, 1 behind, the rest to the player', () => {
  const { h, D, tomb, back } = shieldedTombBoard(38704, 15, ['Deadly', 'Piercing']);
  elect(h, 1);                                       // R319: the floors, elected
  elect(h, 1);
  const t = ent(h, tomb)!;
  assert.equal(t.counters, 1, '"Atleast 1 damage to Awoken (gets atleast +1/+1, won\'t create 1/1)"');
  assert.ok(!ent(h, back), '"then atleast 1 damage to Bubb" — Deadly kills it');
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 13, '"rest can go to Opponent HP": 15 - 1 - 1 = 13');
});

test('RAQ Excessive: Piercing pays lethal to the front AND the back, and only the rest reaches the player', () => {
  const h = new Harness(38705);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 20);
  const front = tok(h, D, 1, 2), back = tok(h, D, 1, 3);
  toNextBattle(h, A);
  grant(h, atk, 'Piercing');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [front, back] } });
  pass(h); pass(h);
  elect(h, 2); elect(h, 3);                          // R319: lethal to each, then the rest pierces
  assert.ok(!ent(h, front) && !ent(h, back), '"You need to assign enough damage to front & back"');
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 5, 'the excess 10 - 2 - 3 = 5 goes to the player');
});

test('RAQ Excessive: Deadly + Piercing over two blockers — 1 each, the rest to the player', () => {
  const h = new Harness(38706);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 20);
  const front = tok(h, D, 1, 6), back = tok(h, D, 1, 7);
  toNextBattle(h, A);
  grant(h, atk, 'Deadly');
  grant(h, atk, 'Piercing');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [front, back] } });
  pass(h); pass(h);
  elect(h, 1); elect(h, 1);                          // R319: the {Deadly} floors, elected
  assert.ok(!ent(h, front) && !ent(h, back), '"Atleast 1 damage to front, atleast 1 damage to back"');
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 8, '"and rest can go to Opponent Health": 10 - 1 - 1 = 8');
});

// ── [Solved] Poisonous vs "Whenever I am dealt damage" vs Phytochemical Protection ──

test('RAQ Poisonous: a shielded Jollyglop hit by a Poisonous unit takes no counters, does not trigger, and grows', () => {
  const h = new Harness(38707);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const siren = spawn(h, A, 'Sporebloom Siren');    // 2/2 {Poisonous}
  const glop = spawn(h, D, 'Jollyglop');             // 0/4, [once] when I am dealt damage → that many 1/1s
  giveResources(h, D, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[siren]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Phytochemical Protection') });
  pick(h, { unit: glop });
  pass(h); pass(h);
  pass(h); pass(h);
  const before = unitsOf(h, D).length;
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [glop] } });
  finishBattle(h);
  const g = ent(h, glop)!;
  assert.equal(g.counters, 2, '"won\'t get -2/-2 from Poisonous but will receive +2/+2 counters"');
  assert.equal(unitsOf(h, D).length, before, '"Jollyglop doesn\'t trigger" — no 1/1s');
});

// ── [Solved] Tough + "Double defense until regroup" ──

test('RAQ Tough: a 0/4 Tough unit with a +1/+1 counter is a 1/10', () => {
  const h = new Harness(38708);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const id = spawn(h, A, 'Rampart Guardian');       // printed {Tough} 0/4
  const g = new E(h.state);
  g.addCounters(g.entity(id)!, 1);
  g.settle();
  assert.deepEqual(effStats(h, id), [1, 10], '"That\'s 1/5 after including counter and 1/10 after including Tough"');
});

test('RAQ Tough: Burgeon on that 1/10 makes it 1/20, and losing Tough to Monke leaves 1/10', () => {
  const h = new Harness(38709);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const id = spawn(h, A, 'Rampart Guardian');
  spawn(h, D, 'Unit Token');
  {
    const g = new E(h.state);
    g.addCounters(g.entity(id)!, 1);
    g.settle();
  }
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[id]] });
  {
    const g = new E(h.state);
    resolveEffect(getCard('Burgeon').spellEffect!, g, { controller: A, sourceName: 'Burgeon', targets: [g.entity(id)!], mode: 'defense' });
  }
  assert.deepEqual(effStats(h, id), [1, 20], '"That\'s 1/20 now"');
  giveResources(h, A, 'metal', 1);                  // Monke m/1
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Monke') });
  pass(h); pass(h);                                 // Monke resolves: other units lose all attributes during battle
  assert.deepEqual(effStats(h, id), [1, 10],
    '"if this unit would loose Tough (eg. Monke), then it\'s back to being 1/10"');
  finishBattle(h);
});

// ── [Solved] Resonant, Combat Damage, Conduit and Powerful ──

/**
 * Resonant Form (2/4 {Resonant}) attacks into a sturdy blocker; `lost` is the
 * defender's life lost. Conduit of Pain, when asked for, attacks too in its
 * own column into a second wall: R12 scopes it to the region it stands in, so
 * left at home it would not see the battle at all.
 */
function resonantBoard(seed: number, opts: { powerful?: boolean; conduit?: boolean; oorblak?: boolean }) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const res = spawn(h, A, 'Resonant Form');
  const conduit = opts.conduit ? spawn(h, A, 'Conduit of Pain') : null;
  const wall = tok(h, D, 0, 20), wall2 = tok(h, D, 0, 20);
  const oorblak = opts.oorblak ? spawn(h, D, 'Oorblak') : null;
  toNextBattle(h, A);
  if (opts.powerful) grant(h, res, 'Powerful');
  h.do({ type: 'declareAttack', seat: A, columns: conduit ? [[res], [conduit]] : [[res]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: conduit ? { 0: [wall], 1: [wall2] } : { 0: [wall] } });
  const life = h.state.players[D]!.life;
  pass(h); pass(h);                                  // combat damage
  const wallDamage = ent(h, wall)!.damage;
  finishBattle(h);
  return { h, A, D, wallDamage, oorblak, lost: life - h.state.players[D]!.life };
}

test('RAQ Resonant: the extra damage is not combat damage — Oorblak does not take it, the player does', () => {
  const { h, wallDamage, oorblak, lost } = resonantBoard(38710, { oorblak: true });
  assert.equal(wallDamage, 2, 'the blocker took the 2 combat damage');
  assert.equal(lost, 2, 'the 2 from Resonant reached the player');
  assert.equal(ent(h, oorblak!)?.damage ?? 0, 0,
    '"extra damage from Resonant effect wouldn\'t be considered as combat damage" — Oorblak takes only COMBAT damage');
});

test('RAQ Resonant: Conduit of Pain adds 1 to the Resonant damage — 2 combat, then 3 to the face', () => {
  const { wallDamage, lost } = resonantBoard(38711, { conduit: true });
  assert.equal(wallDamage, 2, 'Conduit does not touch combat damage');
  assert.equal(lost, 3, '"2/4 dealing 2 damage to enemy unit would then put effect to deal 2+1=3 damage to opponent face"');
});

test('RAQ Resonant: a Powerful Resonant 2/4 deals 4 combat damage and then 8 to the face', () => {
  const { wallDamage, lost } = resonantBoard(38712, { powerful: true });
  assert.equal(wallDamage, 4, 'Powerful doubles the combat damage');
  assert.equal(lost, 8, '"2/4 Resonant Powerful would deal 4 combat damage … and then put effect on stack to deal 8 damage to enemy face"');
});

test('RAQ Resonant: Resonant + Powerful + Conduit — 4 combat, then (4+1)x2 = 10 to the face', () => {
  const { wallDamage, lost } = resonantBoard(38713, { powerful: true, conduit: true });
  assert.equal(wallDamage, 4);
  assert.equal(lost, 10, '"(4+1)x2 = 10 damage to enemy face"');
});

test('RAQ Resonant: Conduit adds its 1 BEFORE Powerful doubles — a Powerful Bellowing Boulder deals (1+1)x2 = 4 to each unit', () => {
  const h = new Harness(38722);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const boulder = spawn(h, A, 'Bellowing Boulder');
  const conduit = spawn(h, A, 'Conduit of Pain');    // attacks too, so it stands in the battle region (R12)
  const wall = tok(h, D, 0, 20);
  toNextBattle(h, A);
  grant(h, boulder, 'Powerful');
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder], [conduit]] });
  pass(h); pass(h);                                  // the trigger resolves
  assert.equal(ent(h, wall)!.damage, 4,
    '"(1+1)x2 damage to each unit = 4 damage to each unit" — the engine doubles first and adds after (1x2+1 = 3)');
});

test('RAQ Resonant: Bellowing Boulder with Resonant + Powerful + Conduit — 4 to each unit, then 10 per damaged unit', () => {
  const h = new Harness(38714);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const boulder = spawn(h, A, 'Bellowing Boulder');  // 3/4, when I attack or block: 1 damage to each unit
  const conduit = spawn(h, A, 'Conduit of Pain');    // attacks too, so it stands in the battle region (R12)
  const wall = tok(h, D, 0, 20);
  toNextBattle(h, A);
  grant(h, boulder, 'Resonant');
  grant(h, boulder, 'Powerful');
  // R315: the riders are the Boulder's own triggers and resolve AFTER the
  // ping, so the Boulder (3/4) and the Conduit (2/1) have to live through
  // the 4 they take for the thread's board to still be there — counters,
  // which are not damage and change no number the thread computes
  const g = new E(h.state);
  g.addCounters(g.entity(boulder)!, 10);
  g.addCounters(g.entity(conduit)!, 10);
  const lifeA = h.state.players[A]!.life, lifeD = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder], [conduit]] });
  pass(h); pass(h);                                  // the trigger resolves
  let guard = 20;
  while (h.state.stack.length && guard-- > 0) pass(h);   // and its three Resonant riders
  assert.equal(ent(h, wall)!.damage, 4, '"(1+1)x2 damage to each unit = 4 damage to each unit"');
  assert.equal(lifeD - h.state.players[D]!.life, 10, '"(4+1)x2 =10 damage to … enemy face for each of … their damaged unit"');
  assert.equal(lifeA - h.state.players[A]!.life, 20, 'and 10 to its own face for each of its own two damaged units');
});

// ── [Solved] Vulnerable + Piercing / Electric ──

/** a Vulnerable 3/8 Crumbling Ancient blocking (with a 2/2 behind it unless `lone`); A can pay for Arc Lightning */
function ancientBoard(seed: number, opts: { lone?: boolean } = {}) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 20);
  const ancient = spawn(h, D, 'Crumbling Ancient');  // 3/8 {Vulnerable}
  const behind = opts.lone ? null : tok(h, D, 2, 2);
  giveResources(h, A, 'fire', 4);                    // Arc Lightning rr/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: behind ? [ancient, behind] : [ancient] } });
  let guard = 6;
  while (h.state.priority !== A && guard-- > 0) pass(h);
  return { h, A, D, ancient, behind };
}

test('RAQ Vulnerable: Arc Lightning on a Vulnerable 3/8 — 4 of the 6 kill it, and the other 2 jump on', () => {
  const { h, A, ancient, behind } = ancientBoard(38715);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arc Lightning') });
  pick(h, { unit: ancient });
  pass(h); pass(h);
  pick(h, behind!);                                  // R317: the jump is the controller's choice
  assert.ok(!ent(h, ancient), '"you need 4 damage to kill it, because this 4 damage would be doubled on him"');
  assert.ok(!ent(h, behind!), '"you are left with 2 damage to distribute further"');
  finishBattle(h);
});

test('RAQ Vulnerable: Electric "can be" — all 6 may stay on the Vulnerable unit, as 12, with no jump', () => {
  const { h, A, ancient, behind } = ancientBoard(38716);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arc Lightning') });
  pick(h, { unit: ancient });
  const mark = h.events.length;
  pass(h); pass(h);
  // the controller must be ASKED whether the excess goes on — even with one
  // neighbour, which the engine used to walk without asking
  const dec = h.state.decision;
  assert.equal(dec?.kind, 'electricPath', 'the jump is a question');
  const keep = dec!.options.find(o => o.value === `keep:${ancient}`);
  assert.ok(keep, 'and keeping the excess on Crumbling Ancient is one of its answers');
  pick(h, keep!.value);
  const dealt = h.events.slice(mark).filter(e => e.type === 'damage' && e.data?.['unit'] === ancient)
    .map(e => e.data!['n'] as number);
  assert.deepEqual(dealt, [12], 'all 6 stay on it, doubled to 12');
  assert.ok(ent(h, behind!), '"you can ignore it and just assign all 6 damage to Crumbling Ancient … NOT ALLOWED to jump"');
  finishBattle(h);
});

test('RAQ Vulnerable: Electric damage with nowhere to jump is still dealt — all 6 land on the Vulnerable unit as 12', () => {
  const { h, A, ancient } = ancientBoard(38717, { lone: true });
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arc Lightning') });
  pick(h, { unit: ancient });
  pass(h); pass(h);                                  // Arc Lightning resolves
  const dealt = h.events.slice(mark).filter(e => e.type === 'damage' && e.data?.['unit'] === ancient)
    .map(e => e.data!['n'] as number);
  assert.deepEqual(dealt, [12],
    '"All 12 damage sink into Crumbling - this has its use if you had Ember of Life in play" (R114: ALL damage is dealt)');
});

test('RAQ Vulnerable: a 10-power Piercing column into a Vulnerable 3/8 assigns 4 and 6 goes to the player', () => {
  const h = new Harness(38718);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 20);
  const ancient = spawn(h, D, 'Crumbling Ancient');
  toNextBattle(h, A);
  grant(h, atk, 'Piercing');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [ancient] } });
  finishBattle(h);
  assert.ok(!ent(h, ancient), '"you are required to assing atleast 4 damage to Crumbling (which gets doubled due to Vulnerable)"');
  assert.equal(h.state.players[D]!.life, 30 - 6, '"excess damage is 10-4=6, which can go face"');
});

// ── [Solved] Oorblak vs Piercing. ──

test('RAQ Oorblak: 10 Piercing combat damage redirected into a 2/4 Oorblak — 4 kill it, the other 6 still reach the player', () => {
  // "10 damage is redirected to Oorblak, he takes 4 damage which is enough to
  // kill him and leftover 6 damage is still Piercing so it goes to players
  // face" — and Caleb: "replacement effects only apply once in an effect", so
  // the leftover is not redirected a second time.
  const h = new Harness(38724);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 10);
  const oorblak = spawn(h, D, 'Oorblak');            // 2/4: combat damage to me is dealt to it instead
  toNextBattle(h, A);
  grant(h, atk, 'Piercing');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.ok(!ent(h, oorblak), 'the 4 it takes kill it');
  assert.equal(h.state.players[D]!.life, 30 - 6, 'and the leftover 6 is still Piercing');
});

// ── [Solved] Piercing, side block and combat damage from defending formation ──

/** A attacks with `atk`; D blocks it with a 1/1 that then dies before damage */
function deadBlockerBoard(seed: number, piercing: boolean) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = piercing ? spawn(h, A, 'Good Whale') : tok(h, A, 7, 5);   // Good Whale: 7/5 {Piercing}
  const chump = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [chump] } });
  const g = new E(h.state);
  g.destroy(g.entity(chump)!, 'dies');
  g.settle();
  finishBattle(h);
  return { h, D };
}

test('RAQ Piercing: an unblocked Piercing column hits the player', () => {
  const h = new Harness(38723);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 7, '"Does my attacking unit with Piercing will hit enemy face if there isn\'t any blocker? Yes"');
});

test('RAQ Piercing: a Piercing column whose blocker died before damage puts its full power into the player', () => {
  const { h, D } = deadBlockerBoard(38719, true);
  assert.equal(h.state.players[D]!.life, 30 - 7,
    '"because it\'s attacking formation and that unit/column has Piercing, then full damage will go to face"');
});

test('RAQ Piercing: a blocked NON-Piercing column whose blocker died deals nothing to the player', () => {
  const { h, D } = deadBlockerBoard(38720, false);
  assert.equal(h.state.players[D]!.life, 30, '"Normally the column was blocked, so you couldn\'t hit face with that unit"');
});

test('RAQ Piercing: a defending Piercing column with an attacker in front of it carries its excess to the attacker', () => {
  const h = new Harness(38721);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 1);
  const whale = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [whale] } });
  finishBattle(h);
  assert.ok(!ent(h, atk));
  assert.equal(h.state.players[A]!.life, 30 - 6,
    '"as defender you can only deal combat damage to opponents face if your blocking columns has piercing AND there is enemy unit in front of them"');
});
