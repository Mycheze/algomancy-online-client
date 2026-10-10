/**
 * Comprehensive rules, unit U20 (attributes, Evasive to Modular) — CR example
 * tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U20
 * (data/comprehensive-rules/build/probes/U20/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U20.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * The four tests titled "engine differs" are the exception: their rules state
 * the ruling (or the printed text) and carry an engineDiffers mark, and these
 * tests pin the divergence the mark describes. They are deliberately NOT
 * listed in those rules' sources. When one goes red the engine has been
 * brought in line with the rule: drop the engineDiffers mark and the test, and
 * bind a real example.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import {
  ent, give, giveResources, offered, pass, pick, spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}
function grant(h: Harness, id: EntityId, attr: Attr): void {
  const g = new E(h.state);
  g.addTempAttr(g.entity(id)!, attr);
}
type Asked = { kind: string; seat: Seat; values: unknown[] };
/** run one noncombat damage batch straight through dealEffectDamageAll */
function effect(h: Harness, o: {
  controller: Seat; sourceId?: EntityId; attrs: Attr[]; hits: { target: { player: Seat } | EntityId; n: number }[];
  settle?: boolean;
}): { asked: Asked[]; g: E } {
  const asked: Asked[] = [];
  const g = new E(h.state);
  g.dealEffectDamageAll({
    controller: o.controller, sourceName: 'Unit Token', sourceId: o.sourceId, region: g.homeRegion(o.controller),
    targets: [], event: null, grantedAttrs: o.attrs, eraseSelf: () => {},
    choose: (_k: unknown, dec: { kind: string; seat: number; options: { value: unknown }[] }) => {
      asked.push({ kind: dec.kind, seat: dec.seat as Seat, values: dec.options.map(x => x.value) });
      return dec.options[0]!.value;
    },
  } as never, o.hits.map(x => ({ target: typeof x.target === 'number' ? g.entity(x.target)! : x.target, n: x.n })) as never);
  if (o.settle) { g.settle(); h.state = g.s; }
  return { asked, g };
}
function blockStep(h: Harness): void {
  for (let i = 0; i < 40 && h.state.battle?.step !== 'blocks'; i++) pass(h);
}
/** take every assignDamage question at its first (default) option */
function defaultAssignments(h: Harness): void {
  for (let i = 0; i < 5 && h.state.decision?.kind === 'assignDamage'; i++) {
    const dec = h.state.decision!; h.do({ type: 'decide', seat: dec.seat, choice: 0 });
  }
}
/** resolve whatever is waiting on the stack, answering any question with its first option */
function drainStack(h: Harness): void {
  for (let i = 0; i < 20 && (h.state.stack.length || h.state.triggerQueue.length || h.state.decision); i++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
}
/** one unblocked attacking column, granted `attrs`, through combat damage */
function unblocked(seed: number, attrs: Attr[], p: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, p, 9);
  for (const a of attrs) grant(h, atk, a);
  const lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  return { h, A, D, atk, lifeD };
}

/* ── Sneaky ─────────────────────────────────────────────────────────── */

test('cr:attr.sneaky.spell-tokens — a Sneaky unit attacking with two riding Fireball spell tokens is still alone and cannot be blocked', () => {
  const h = new Harness(92001);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const sprite = spawn(h, A, 'Ignis Sprite');            // each Ignis Sprite makes a Fireball 1 token for A
  spawn(h, A, 'Ignis Sprite');
  grant(h, sprite, 'Sneaky');
  const d = tok(h, D, 1, 5);
  toNextBattle(h, A);
  const fbs = tokensOf(h, A).filter(t => t.kind === 'spellToken');
  assert.equal(fbs.length, 2, 'two spell tokens');
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]], spellTokens: fbs.map(t => t.id) });
  for (const t of fbs) assert.equal(ent(h, t.id)!.region, h.state.battle!.region, 'both tokens go with the attack');
  blockStep(h);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d] } }), /Sneaky/);
});

test('cr:attr.sneaky.two-sneaky — two Whispering Mantids attacking in two columns are not alone, and both can be blocked', () => {
  const h = new Harness(92002);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const s1 = spawn(h, A, 'Whispering Mantid'), s2 = spawn(h, A, 'Whispering Mantid');
  const d1 = tok(h, D, 1, 5), d2 = tok(h, D, 1, 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[s1], [s2]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1], 1: [d2] } });
  assert.deepEqual(h.state.battle!.blocks, { 0: [d1], 1: [d2] });
});

test('cr:attr.sneaky.pure — Just a Unit (Pure) can block a lone Sneaky attacker, and a plain unit cannot', () => {
  const h = new Harness(92003);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const s1 = spawn(h, A, 'Whispering Mantid');
  const plain = tok(h, D, 1, 5);
  const pure = spawn(h, D, 'Just a Unit');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[s1]] });
  blockStep(h);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [plain] } }), /Sneaky/);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [pure] } });
  assert.deepEqual(h.state.battle!.blocks[0], [pure]);
});

/* ── Alluring ───────────────────────────────────────────────────────── */

test('cr:attr.alluring.trigger — the Alluring target is chosen by the attacking player, not the defender', () => {
  const h = new Harness(92004);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const d1 = tok(h, D, 1, 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  const dec = h.state.decision!;
  assert.equal(dec.seat, A, 'the attacker picks the lured unit');
  assert.notEqual(dec.seat, D);
  assert.deepEqual(dec.options.map(o => o.value), [{ unit: d1 }]);
});

test('cr:attr.alluring.two-duties — one unit lured by two columns blocks one of them, and the other column may be blocked by another unit or left unblocked', () => {
  const h = new Harness(92005);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const l1 = spawn(h, A, 'Tempest Wrangler'), l2 = spawn(h, A, 'Tempest Wrangler');
  const d1 = tok(h, D, 1, 5), d2 = tok(h, D, 1, 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[l1], [l2]] });
  for (let i = 0; i < 40 && h.state.battle?.step !== 'blocks'; i++) {
    const dec = h.state.decision;
    if (dec?.kind === 'orderTriggers') h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, j) => j) });
    else if (dec) pick(h, { unit: d1 });
    else pass(h);
  }
  assert.deepEqual(ent(h, d1)!.allured!.columns.slice().sort(), [0, 1], 'both triggers targeted the same unit');
  const s1 = structuredClone(h.state);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1], 1: [d2] } });
  assert.deepEqual(h.state.battle!.blocks, { 0: [d1], 1: [d2] }, 'the second column is blocked by another unit alone');
  h.state = structuredClone(s1);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] } });
  assert.deepEqual(h.state.battle!.blocks, { 0: [d1] }, 'the second column may be left unblocked');
  h.state = s1;
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [d1] } });
  assert.deepEqual(h.state.battle!.blocks, { 1: [d1] }, 'blocking the other column instead satisfies both triggers too');
});

/* ── Piercing ───────────────────────────────────────────────────────── */

test('cr:attr.piercing.combat — 10 Piercing into a 1/2 front and a 1/3 back must give the front at least 2 and then the back at least 3', () => {
  const h = new Harness(93007);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 20);
  const front = tok(h, D, 1, 2), back = tok(h, D, 1, 3);
  toNextBattle(h, A);
  grant(h, atk, 'Piercing');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [front, back] } });
  pass(h); pass(h);
  const nums = (): number[] => (h.state.decision?.options ?? []).map(o => o.value).filter((v): v is number => typeof v === 'number');
  assert.equal(h.state.decision?.kind, 'assignDamage');
  assert.equal(Math.min(...nums()), 2, 'the front must be given at least its lethal 2');
  h.do({ type: 'decide', seat: h.state.decision!.seat, choice: h.state.decision!.options.findIndex(o => o.value === 2) });
  assert.equal(h.state.decision?.kind, 'assignDamage');
  assert.equal(Math.min(...nums()), 3, 'the back must be given at least its lethal 3');
  assert.equal(Math.max(...nums()), 8, 'and may be given everything left');
});

test('cr:attr.piercing.noncombat-chooser — with no source unit (a spell), the controller of the effect places the Piercing excess, not the controller of the damaged unit', () => {
  const h = new Harness(92006);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const victim = tok(h, D, 1, 1);
  const { asked } = effect(h, { controller: A, attrs: ['Piercing'], hits: [{ target: victim, n: 5 }] });
  const q = asked.find(a => a.kind === 'assignDamage');
  assert.ok(q, 'the Piercing split is asked');
  assert.equal(q.seat, A, 'the caster decides');
});

test('cr:attr.piercing.noncombat-chooser — when the source unit has left play, the controller of the effect places the excess', () => {
  const h = new Harness(92007);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const src = tok(h, A, 1, 1);
  const victim = tok(h, D, 1, 1);
  { const g = new E(h.state); g.destroy(g.entity(src)!, 'dies'); g.settle(); h.state = g.s; }
  assert.equal(ent(h, src), undefined, 'the source has left play');
  const { asked } = effect(h, { controller: A, sourceId: src, attrs: ['Piercing'], hits: [{ target: victim, n: 5 }] });
  const q = asked.find(a => a.kind === 'assignDamage');
  assert.ok(q, 'the Piercing split is asked');
  assert.equal(q.seat, A);
});

/** one column of `p` power, granted `attrs`, blocked by Just a Unit (2/3 Pure) or by a plain 2/3 control */
function pureBlocks(seed: number, attrs: Attr[], p: number, t: number, control = false) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, p, t);
  for (const a of attrs) grant(h, atk, a);
  const jau = control ? tok(h, D, 2, 3) : spawn(h, D, 'Just a Unit');
  const lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [jau] } });
  pass(h); pass(h);
  defaultAssignments(h);
  return { h, A, D, atk, jau, lifeD };
}

test('cr:attr.piercing.pure — a 6-power Piercing column blocked by Just a Unit sends nothing to the defending player', () => {
  const { h, D, jau, lifeD } = pureBlocks(92020, ['Piercing'], 6, 9);
  assert.equal(h.state.players[D]!.life, lifeD);
  assert.equal(ent(h, jau), undefined, 'Just a Unit died');
});

test('cr:attr.piercing.pure — control: the same 6-power Piercing column blocked by a plain 2/3 sends 3 to the player', () => {
  const { h, D, lifeD } = pureBlocks(92030, ['Piercing'], 6, 9, true);
  assert.equal(lifeD - h.state.players[D]!.life, 3);
});

/* ── Electric ───────────────────────────────────────────────────────── */

test('cr:attr.electric.adjacency — outside a battle no unit is adjacent, so Electric excess stays on the unit it hit and nothing is asked', () => {
  const h = new Harness(92009);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const v = tok(h, D, 1, 2);
  tok(h, D, 1, 9); tok(h, D, 1, 9);
  assert.equal(h.state.battle, null);
  const { asked } = effect(h, { controller: A, attrs: ['Electric'], hits: [{ target: v, n: 6 }], settle: true });
  assert.equal(asked.length, 0, 'no jump is offered');
  assert.equal(ent(h, v), undefined, 'the unit is dealt the damage and dies');
});

test('cr:attr.electric.adjacency — during a battle, a unit in no formation has no adjacent unit even beside other idle units', () => {
  const h = new Harness(93008);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = tok(h, A, 1, 1);
  const idle = tok(h, D, 1, 2); tok(h, D, 1, 9);
  const blk = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  const g = new E(h.state);
  assert.ok(g.s.battle);
  assert.deepEqual(g.adjacentInFormation(idle), [], 'the idle unit is in no formation');
});

test('cr:attr.electric.chooser — engine differs: the Electric path is asked of the controller of the effect even when the source unit is the opponents', () => {
  const h = new Harness(92008);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = tok(h, A, 1, 1), a1 = tok(h, A, 1, 1);
  const b0 = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b0] } });
  const g0 = new E(h.state);
  assert.deepEqual(g0.adjacentInFormation(a0).map(u => u.id), [a1], 'the two attackers are adjacent');
  const { asked } = effect(h, { controller: A, sourceId: b0, attrs: ['Electric'], hits: [{ target: a0, n: 5 }] });
  const q = asked.find(a => a.kind === 'electricPath');
  assert.ok(q, 'a jump is offered');
  assert.equal(new E(h.state).entity(b0)!.controller, D, 'the source is the defenders');
  // the rule: the source controller (D) chooses; the engine asks the effect controller (A)
  assert.equal(q.seat, A, 'engine: the path is asked of the effect controller');
});

test('cr:attr.piercing.redirect — engine differs: with two Oorblaks, 10 Piercing combat damage is redirected a second time, so both die and only 2 reach the player', () => {
  const h = new Harness(92028);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 10);
  grant(h, atk, 'Piercing');
  const o1 = spawn(h, D, 'Oorblak'), o2 = spawn(h, D, 'Oorblak');   // 2/4 each
  const life = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  const lost = life - h.state.players[D]!.life;
  const deadO = [o1, o2].filter(o => !ent(h, o)).length;
  // the rule: one redirect, 4 into one Oorblak, 6 to the player
  assert.deepEqual({ lost, deadO }, { lost: 2, deadO: 2 }, 'engine: the excess is redirected again');
});

/* ── Poisonous ──────────────────────────────────────────────────────── */

test('cr:attr.poisonous.is-damage — Noxious Sporefiend dealing 2 to Awoken Tomb puts two -1/-1 counters on it, and its trigger makes a 2/2', () => {
  const h = new Harness(93005);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const sf = spawn(h, A, 'Noxious Sporefiend');
  const tomb = spawn(h, D, 'Awoken Tomb');
  const before = new Set(unitsOf(h, D).map(u => u.id));
  const g = new E(h.state);
  g.dealEffectDamage({
    controller: A, sourceName: 'Noxious Sporefiend', sourceId: sf, region: g.homeRegion(A), targets: [], event: null,
    eraseSelf: () => {}, choose: () => { throw new Error('no choice'); },
  } as never, g.entity(tomb)!, 2);
  g.settle();
  h.state = g.s;
  const t = ent(h, tomb)!;
  assert.equal(t.counters, -2, 'two -1/-1 counters');
  assert.equal(t.damage ?? 0, 0, 'no marked damage');
  for (let i = 0; i < 10 && (h.state.stack.length || h.state.triggerQueue.length); i++) pass(h);
  const made = unitsOf(h, D).filter(u => !before.has(u.id));
  assert.equal(made.length, 1, 'a unit was made');
  assert.deepEqual(new E(h.state).effStats(made[0]!), [2, 2], 'and it is a 2/2');
});

test('cr:attr.poisonous.players — an unblocked Poisonous column with 3 power makes the defending player lose 3 life', () => {
  const { h, D, lifeD } = unblocked(92040, ['Poisonous'], 3);
  assert.equal(lifeD - h.state.players[D]!.life, 3);
});

test('cr:attr.poisonous.players — 3 noncombat Poisonous damage to a player is ordinary life loss of 3', () => {
  const h = new Harness(92014);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const life = h.state.players[D]!.life;
  effect(h, { controller: A, attrs: ['Poisonous'], hits: [{ target: { player: D }, n: 3 }], settle: true });
  assert.equal(life - h.state.players[D]!.life, 3);
});

test('cr:attr.poisonous.resonant — a Poisonous Resonant hit of 2 puts two -1/-1 counters on the unit, and the Resonant trigger deals 2 to its controller', () => {
  const h = new Harness(92012);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const src = tok(h, A, 1, 1);
  const v = tok(h, D, 1, 9);
  const life = h.state.players[D]!.life;
  const { g } = effect(h, { controller: A, sourceId: src, attrs: ['Resonant', 'Poisonous'], hits: [{ target: v, n: 2 }] });
  assert.equal(g.entity(v)!.counters, -2);
  assert.equal(g.entity(v)!.damage, 0);
  const q = g.s.triggerQueue.filter(t => /Resonant/.test(t.label));
  assert.equal(q.length, 1);
  assert.deepEqual((q[0]!.event!.data as { resonant: unknown }).resonant, { player: D, n: 2 });
  g.settle(); h.state = g.s;
  drainStack(h);
  assert.equal(life - h.state.players[D]!.life, 2, 'the trigger dealt 2 to the controller of the unit');
});

test('cr:attr.poisonous.pure — a Poisonous column blocked by Just a Unit marks ordinary damage, not -1/-1 counters', () => {
  const { h, jau } = pureBlocks(92021, ['Poisonous'], 1, 9);
  assert.equal(ent(h, jau)!.damage, 1);
  assert.equal(ent(h, jau)!.counters ?? 0, 0);
});

test('cr:attr.poisonous.pure — control: against a plain 2/3 the Poisonous hit is a -1/-1 counter', () => {
  const { h, jau } = pureBlocks(92031, ['Poisonous'], 1, 9, true);
  assert.equal(ent(h, jau)!.counters, -1);
  assert.equal(ent(h, jau)!.damage, 0);
});

/* ── Resonant ───────────────────────────────────────────────────────── */

test('cr:attr.resonant.amount — a Resonant source dealing 2 to a Vulnerable unit, which is dealt 4, makes a Resonant trigger that deals 4 to its controller', () => {
  const h = new Harness(92010);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const src = tok(h, A, 1, 1);
  const v = tok(h, D, 1, 9);
  grant(h, v, 'Vulnerable');
  const life = h.state.players[D]!.life;
  const { g } = effect(h, { controller: A, sourceId: src, attrs: ['Resonant'], hits: [{ target: v, n: 2 }] });
  assert.equal(g.entity(v)!.damage, 4);
  const q = g.s.triggerQueue.filter(t => /Resonant/.test(t.label));
  assert.equal(q.length, 1);
  assert.deepEqual((q[0]!.event!.data as { resonant: unknown }).resonant, { player: D, n: 4 });
  g.settle(); h.state = g.s;
  drainStack(h);
  assert.equal(life - h.state.players[D]!.life, 4, 'the trigger dealt 4 to the controller of the unit');
});

test('cr:attr.resonant.units-only — an unblocked Resonant column dealing 3 combat damage to the defending player does not trigger Resonant', () => {
  const { h, D, lifeD } = unblocked(92041, ['Resonant'], 3);
  assert.equal(lifeD - h.state.players[D]!.life, 3, 'the player was dealt 3');
  assert.ok(!h.log.some(m => /\{Resonant\}/.test(m)), 'no Resonant trigger in the log');
  assert.equal(h.state.triggerQueue.filter(t => /Resonant/.test(t.label)).length, 0);
});

test('cr:attr.resonant.units-only — noncombat Resonant damage to a player queues no Resonant trigger', () => {
  const h = new Harness(92011);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const src = tok(h, A, 1, 1);
  const { g } = effect(h, { controller: A, sourceId: src, attrs: ['Resonant'], hits: [{ target: { player: D }, n: 3 }] });
  assert.equal(g.s.triggerQueue.filter(t => /Resonant/.test(t.label)).length, 0);
});

test('cr:attr.resonant.source-gone — a Powerful Resonant source that leaves play with its trigger waiting still deals doubled damage', () => {
  const h = new Harness(92013);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const src = tok(h, A, 1, 1);
  grant(h, src, 'Powerful');
  grant(h, src, 'Resonant');
  const v = tok(h, D, 1, 9);
  const life = h.state.players[D]!.life;
  const g = new E(h.state);
  g.dealEffectDamageAll({
    controller: A, sourceName: 'Unit Token', sourceId: src, region: g.homeRegion(A),
    targets: [], event: null, eraseSelf: () => {}, choose: () => 'default',
  } as never, [{ target: g.entity(v)!, n: 1 }] as never);
  assert.equal(g.entity(v)!.damage, 2, 'Powerful doubled the hit');
  g.destroy(g.entity(src)!, 'dies');                      // gone with its trigger waiting
  try { g.settle(); } catch { /* a decision */ }
  h.state = g.s;
  assert.equal(ent(h, src), undefined, 'the source has left play');
  for (let i = 0; i < 20 && h.state.stack.length; i++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  assert.equal(life - h.state.players[D]!.life, 4, 'the trigger for 2 is doubled by the last-known Powerful of the gone source');
});

test('cr:attr.resonant.pure — a Resonant column blocked by Just a Unit triggers no Resonant', () => {
  const { h, D, lifeD } = pureBlocks(92022, ['Resonant'], 1, 9);
  assert.ok(!h.log.some(m => /\{Resonant\}/.test(m)), 'no Resonant trigger in the log');
  assert.equal(h.state.players[D]!.life, lifeD);
});

test('cr:attr.resonant.pure — control: against a plain 2/3 the Resonant trigger fires', () => {
  const { h } = pureBlocks(92032, ['Resonant'], 1, 9, true);
  assert.ok(h.log.some(m => /\{Resonant\}/.test(m)));
});

/* ── Thieving / Reaping ─────────────────────────────────────────────── */

test('cr:attr.thieving.piercing — a Thieving and Piercing column blocked by a 1/1 deals 3 of excess to the defending player, and its controller draws a card', () => {
  const h = new Harness(92018);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 4, 4);
  grant(h, atk, 'Thieving'); grant(h, atk, 'Piercing');
  const d = tok(h, D, 1, 1);
  const life = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d] } });
  const hand = h.state.players[A]!.hand.length;
  pass(h); pass(h);
  defaultAssignments(h);
  assert.equal(life - h.state.players[D]!.life, 3, '3 of excess reached the defender');
  assert.equal(h.state.players[A]!.hand.length, hand + 1, 'and the attacker drew one card');
});

test('cr:attr.thieving.combat-only — 2 noncombat damage from a Thieving source to an opponent draws nothing', () => {
  const h = new Harness(92017);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const src = tok(h, A, 1, 1);
  grant(h, src, 'Thieving');
  const hand = h.state.players[A]!.hand.length;
  const life = h.state.players[D]!.life;
  effect(h, { controller: A, sourceId: src, attrs: [], hits: [{ target: { player: D }, n: 2 }], settle: true });
  assert.equal(life - h.state.players[D]!.life, 2, 'the opponent was dealt 2');
  assert.equal(h.state.players[A]!.hand.length, hand);
});

test('cr:attr.reaping.loses — engine differs: a unit with Reaping that kills and draws keeps Reaping, and a second kill draws again', () => {
  const h = new Harness(93002);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const src = tok(h, A, 1, 1);
  grant(h, src, 'Reaping');
  const v1 = tok(h, D, 1, 1), v2 = tok(h, D, 1, 1);
  const hand = h.state.players[A]!.hand.length;
  effect(h, { controller: A, sourceId: src, attrs: [], hits: [{ target: v1, n: 3 }], settle: true });
  assert.ok(!ent(h, v1));
  assert.equal(h.state.players[A]!.hand.length, hand + 1, 'the first kill draws');
  // the rule (printed): the source loses Reaping until regroup; the engine does not build it
  assert.ok(new E(h.state).ownAttrs(ent(h, src)!).has('Reaping'), 'engine: the source still has Reaping');
  effect(h, { controller: A, sourceId: src, attrs: [], hits: [{ target: v2, n: 3 }], settle: true });
  assert.ok(!ent(h, v2));
  assert.equal(h.state.players[A]!.hand.length, hand + 2, 'engine: the second kill, same phase, draws again');
});

/* ── Blessed / Afflicting / Lethal ──────────────────────────────────── */

test('cr:attr.blessed.own-damage — Godray aimed at its own controller at 3 life does not kill them', () => {
  const h = new Harness(92019);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.life = 3;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Godray') });
  pick(h, { player: A });
  pass(h); pass(h);
  assert.equal(h.state.players[A]!.life, 3, 'damaged 3 and healed 3 on the same check');
  assert.equal(h.state.winner ?? null, null, 'nobody lost');
});

test('cr:attr.afflicting.combat — an Afflicting column that kills a plain 2/3 blocker in combat gives the controller of the blocker a rot', () => {
  const { h, A, D, jau } = pureBlocks(92033, ['Afflicting'], 5, 9, true);
  assert.equal(ent(h, jau), undefined, 'the blocker died');
  assert.equal(h.events.filter(ev => ev.type === 'rotGained').length, 1);
  assert.equal(h.q.rot(D), 1, 'the controller of the blocker gains a rot');
  assert.equal(h.q.rot(A), 0);
});

test('cr:attr.afflicting.pure — an Afflicting column that kills Just a Unit gives its controller no rot', () => {
  const { h, D, jau } = pureBlocks(92023, ['Afflicting'], 5, 9);
  assert.equal(ent(h, jau), undefined, 'it died');
  assert.equal(h.events.filter(ev => ev.type === 'rotGained').length, 0, 'no rot');
  assert.equal(h.q.rot(D), 0);
});

test('cr:attr.lethal.combat-only — a Lethal unit blocked by a 2/2 kills it as any unit would, and the defending player is untouched', () => {
  const h = new Harness(92042);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 2, 4);
  grant(h, atk, 'Lethal');
  const d = tok(h, D, 2, 2);
  const life = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d] } });
  pass(h); pass(h);
  assert.equal(ent(h, d), undefined, 'the blocker died to 2 damage');
  assert.equal(h.state.players[D]!.life, life);
  assert.equal(h.state.winner ?? null, null, 'nobody has won');
});

test('cr:attr.lethal.combat-only — a blocked Gublin (Lethal) deals its ordinary 1 combat damage to a 1/3 blocker', () => {
  const h = new Harness(92016);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const gub = spawn(h, A, 'Gublin');                     // 1/4 Lethal
  const d = tok(h, D, 1, 3);
  const life = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[gub]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d] } });
  pass(h); pass(h);
  assert.equal(ent(h, d)!.damage, 1, 'the blocker took 1 and lives');
  assert.equal(h.state.players[D]!.life, life);
  assert.equal(h.state.winner ?? null, null);
});

test('cr:attr.lethal.combat-only — Lethal noncombat damage to a player does not kill them', () => {
  const h = new Harness(92015);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const src = tok(h, A, 1, 1);
  grant(h, src, 'Lethal');
  const life = h.state.players[D]!.life;
  effect(h, { controller: A, sourceId: src, attrs: [], hits: [{ target: { player: D }, n: 1 }], settle: true });
  assert.equal(h.state.players[D]!.life, life - 1);
  assert.equal(h.state.winner ?? null, null, 'nobody has won');
});

test('cr:attr.lethal.replaced — a Lethal column whose combat damage is all redirected into Oorblak still kills the defending player', () => {
  const h = new Harness(92029);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const gub = spawn(h, A, 'Gublin');                     // 1/4 Lethal
  const oo = spawn(h, D, 'Oorblak');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[gub]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(ent(h, oo)?.damage, 1, 'Oorblak took the 1');
  assert.equal(h.state.winner, A, 'the defender is killed though no damage reached them');
});

test('cr:attr.thieving.replaced — a Thieving column whose hit to the defending player Blightsea Polyp turns into 1 rot costs no life, and its controller still draws a card', () => {
  const h = new Harness(92031);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 3, 9);
  grant(h, atk, 'Thieving');
  spawn(h, D, 'Blightsea Polyp');
  const life = h.state.players[D]!.life;
  const rot = h.state.players[D]!.rot ?? 0;   // optional on the player: absent is none (E.rot)
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  const hand = h.state.players[A]!.hand.length;
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, life, 'the hit was replaced: no life lost');
  assert.equal(h.state.players[D]!.rot ?? 0, rot + 1, 'it was dealt as 1 rot instead');
  assert.equal(h.state.players[A]!.hand.length, hand + 1, 'and the Thieving controller still drew a card');
});

/* ── Pure ───────────────────────────────────────────────────────────── */

test('cr:attr.pure.stat-attributes — a Tough 0/4 still has 8 defense blocking a 5-power Just a Unit, and survives', () => {
  const h = new Harness(92024);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const jau = spawn(h, A, 'Just a Unit');
  { const g = new E(h.state); g.addCounters(g.entity(jau)!, 3); g.settle(); h.state = g.s; }   // 5/6
  const d = tok(h, D, 0, 4);
  grant(h, d, 'Tough');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[jau]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d] } });
  pass(h); pass(h);
  assert.ok(ent(h, d), 'the Tough blocker survives 5');
  assert.equal(ent(h, d)!.damage, 5);
});

test('cr:attr.pure.unaware-combat — Bubb (Unaware) blocking a buffed Just a Unit: both sides are read at printed stats', () => {
  const h = new Harness(92025);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const jau = spawn(h, A, 'Just a Unit');
  { const g = new E(h.state); g.addCounters(g.entity(jau)!, 4); g.settle(); h.state = g.s; }   // 6/7 live, 2/3 printed
  const bubb = spawn(h, D, 'Bubb');                       // 5/6 Unaware
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[jau]] });
  blockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  pass(h); pass(h);
  assert.equal(ent(h, bubb)?.damage, 2, 'Just a Unit hit at its printed power 2, not 6');
  assert.equal(ent(h, jau), undefined, 'and it died at its printed defense 3 to the 5 of Bubb');
});

test('cr:attr.pure.column — a unit attacking in a column with Just a Unit is dealt 1, not 2, by a Powerful effect dealing 1', () => {
  const h = new Harness(92027);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const x = tok(h, A, 1, 9);
  const jau = spawn(h, A, 'Just a Unit');
  const ctl = tok(h, A, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[x, jau], [ctl]] });
  effect(h, { controller: D, attrs: ['Powerful'], hits: [{ target: x, n: 1 }, { target: ctl, n: 1 }], settle: true });
  assert.equal(ent(h, x)!.damage, 1, 'the column-mate of Just a Unit is dealt 1');
  assert.equal(ent(h, ctl)!.damage, 2, 'the control in another column is dealt 2');
});

test('cr:attr.pure.not-targeting — a target-unit damage spell (Arc Lightning) can target Just a Unit', () => {
  const h = new Harness(92026);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const jau = spawn(h, D, 'Just a Unit');
  giveResources(h, A, 'fire', 4);
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arc Lightning') });
  assert.ok(offered(h).includes(JSON.stringify({ unit: jau })), `menu: ${offered(h)}`);
});

/* ── Modular ────────────────────────────────────────────────────────── */

test('cr:attr.modular.not-shared — engine differs: a unit given Modular in an attacking column shares Modular with its column-mate', () => {
  const h = new Harness(93006);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const m = tok(h, A, 1, 1), mate = tok(h, A, 1, 1);
  grant(h, m, 'Modular');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[m, mate]] });
  const g = new E(h.state);
  assert.ok(!g.ownAttrs(g.entity(mate)!).has('Modular'));
  // the rule: Modular is not shared; the engine shares it (latent: no unit prints Modular)
  assert.ok(g.effAttrs(g.entity(mate)!).has('Modular'), 'engine: the column-mate reads Modular');
});
