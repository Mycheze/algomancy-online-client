/**
 * Comprehensive rules, unit U10 (regions, formations, columns) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U10
 * (data/comprehensive-rules/build/probes/U10/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U10.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * The three tests titled "engine differs" are the exception: their rules state
 * the ruled law and carry an engineDiffers mark, and these tests pin the
 * divergence the mark describes. When one goes red the engine has been brought
 * in line with the ruling: drop the engineDiffers mark and the test, and bind a
 * real example.
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
import type { EngineEvent, EntityId, Seat } from '../src/types.ts';
import { visibleToSeat } from '../../server/view.ts';
import { legalActions } from '../src/apply.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

/** a vanilla p/t token for `seat`, in its home region */
function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}
function kill(h: Harness, id: EntityId): void {
  const g = new E(h.state);
  g.destroy(g.entity(id)!, 'is deleted');
  g.settle();
}
function passTo(h: Harness, seat: Seat): void {
  let guard = 8;
  while (h.state.priority !== seat && h.state.priority !== null && guard-- > 0) pass(h);
  assert.equal(h.state.priority, seat, 'priority reached the acting seat');
}

test('cr:combat.columns.adjacency.at-resolution — Flamebreath Initiate attacks beside an ally, the ally is destroyed while the trigger waits, and X is 0 when it resolves', () => {
  const h = new Harness(91001);
  toDeployment(h);
  const A = h.state.initiative;
  const fb = spawn(h, A, 'Flamebreath Initiate');
  const ally = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[fb], [ally]] });   // one adjacent ally at trigger time
  assert.ok(h.state.stack.some(i => i.card === 'Flamebreath Initiate'), 'the trigger waits');
  kill(h, ally);                                                        // gone before it resolves
  pass(h); pass(h);
  const balls = tokensOf(h, A).filter(t => t.card === 'Fireball');
  assert.equal(balls.length, 1);
  assert.equal(balls[0]!.x, 1, 'X counted at resolution = 0 adjacent allies, so a Fireball 1');
  finishBattle(h);
});

test('cr:combat.formations.definition.empty — after blocks every attacking unit dies, and the attacking formation stays in the battle as an empty column that offers no position', () => {
  const h = new Harness(91003);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 1, 1);
  const big = tok(h, D, 9, 9);
  giveResources(h, A, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [big] } });
  kill(h, a);                                                           // the lone attacker dies after blocks
  assert.deepEqual(h.state.battle!.columns, [[]], 'the formation is still there: one column, now empty');
  assert.deepEqual(h.state.battle!.blocks[0], [big], 'and its blocker still stands against that column');
  assert.deepEqual(new E(h.state).formationSlots(A), [], 'no position at all, not even the hole');
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tiderunner Initiate') });
  assert.equal(h.state.decision, null, 'Tiderunner Initiate is not asked for a spot');
  finishBattle(h);
});

test('cr:combat.regions.definition.sacrifice — Cull makes each player sacrifice a unit, and a player whose only units are in another region sacrifices nothing', () => {
  const h = new Harness(91005);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 1, 1);
  const home = tok(h, A, 1, 1);                                         // stays home
  const dUnit = tok(h, D, 1, 1);
  giveResources(h, D, 'dark', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  new E(h.state).recall(ent(h, a)!);                                    // A now has nothing in the battle region
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Cull') });
  let guard = 10;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    const d = h.state.decision;
    if (d) h.do({ type: 'decide', seat: d.seat, choice: 0 }); else pass(h);
  }
  assert.ok(ent(h, home), 'the attacker unit at home was not sacrificed');
  assert.equal(ent(h, dUnit), undefined, 'the defender (present, with a unit here) did sacrifice');
  finishBattle(h);
});

test('cr:combat.regions.information — a log line stamped with another region is visible to both seats', () => {
  const ev: EngineEvent = { type: 'info', msg: 'elsewhere', data: { region: 7 } };
  assert.equal(visibleToSeat(ev, 0 as Seat), true);
  assert.equal(visibleToSeat(ev, 1 as Seat), true);
});

test('cr:combat.regions.presence — an attacker stays present in the region it attacked after every unit it sent is removed', () => {
  const h = new Harness(91006);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const a = tok(h, A, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  const r = h.state.battle!.region;
  assert.notEqual(r, new E(h.state).homeRegion(A), 'the battle is in the other region');
  kill(h, a);
  assert.ok(h.state.regions[r]!.presentSeats.includes(A), 'still present with no unit there');
  finishBattle(h);
});

test('cr:combat.regions.presence.only-by-attacking — a player who declares no attack does not enter the region it could have attacked', () => {
  const h = new Harness(91007);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  tok(h, A, 1, 1);
  toNextBattle(h, A);
  const dHome = new E(h.state).homeRegion(D);
  h.do({ type: 'declareAttack', seat: A, columns: [] });
  assert.ok(!h.state.regions[dHome]!.presentSeats.includes(A), 'the attacker never entered the defender region');
  finishBattle(h);
});

/* ── tester additions: the rules no verifier probe demonstrated ──────────── */

/** the formation grid of one battle as plain arrays, holes included */
function lineOf(h: Harness): { columns: EntityId[][]; blocks: Record<number, EntityId[]> } {
  const b = h.state.battle!;
  return { columns: b.columns.map(c => c.slice()), blocks: structuredClone(b.blocks) };
}
/** a chooser that answers a formation-slot question with the first option whose label matches */
function chooseLabel(seat: Seat, re: RegExp) {
  return {
    controller: seat,
    choose: (_k: string, d: { options: { label: string }[] }) => d.options.findIndex(o => re.test(o.label)),
  } as never;
}
/** pass until the battle reaches `step` (or leaves the battle) */
function passToStep(h: Harness, step: string): void {
  let guard = 20;
  while (h.state.battle && h.state.battle.step !== step && !h.state.decision && guard-- > 0) pass(h);
}
/** the action was refused, and the refusal says `why` */
function refused(fn: () => void, why: RegExp): boolean {
  try { fn(); return false; } catch (err) { return why.test(String((err as Error).message)); }
}

test('cr:combat.general.units — an attacking unit enters the defending player region, an unblocked attacker damages that player, and a defending unit blocks an attacker', () => {
  const h = new Harness(91010);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const free = tok(h, A, 2, 2), stopped = tok(h, A, 2, 2);
  const guard = tok(h, D, 1, 9);
  toNextBattle(h, A);
  const dHome = new E(h.state).homeRegion(D);
  h.do({ type: 'declareAttack', seat: A, columns: [[free], [stopped]] });
  assert.equal(ent(h, free)!.region, dHome, 'the attacker entered the defending player region');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [guard] } });
  const life = h.state.players[D]!.life;
  passToStep(h, 'afterWindow');
  assert.equal(h.state.players[D]!.life, life - 2, 'only the unblocked attacker damaged the defending player');
  assert.equal(ent(h, guard)!.damage, 2, 'the blocker defended against the other attacker');
  finishBattle(h);
});

test('cr:combat.regions.definition — a new game has one region per player, and each player starts present only in their own region', () => {
  const h = new Harness(91011);
  const g = new E(h.state);
  assert.equal(h.state.regions.length, h.state.players.length, 'one region for each player');
  for (const seat of [0, 1] as Seat[]) {
    const r = h.state.regions[g.homeRegion(seat)]!;
    assert.equal(r.owner, seat, 'the region belongs to that player');
    assert.deepEqual(r.presentSeats, [seat], 'and that player alone starts in it');
  }
});

test('cr:combat.regions.exclusive — every unit and spell token in play names one region, and an attacking unit and the spell token riding with it leave their home region for the battle region', () => {
  const h = new Harness(91012);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 1, 1);
  tok(h, D, 1, 1);
  toNextBattle(h, A);
  const g = new E(h.state);
  const home = g.homeRegion(A);
  const fire = g.createSpellToken(A, 'Fireball', 1, home).id;
  g.settle();
  const check = (): void => {
    for (const e of Object.values(h.state.entities)) {
      if (e.kind !== 'unit' && e.kind !== 'spellToken') continue;
      assert.ok(Number.isInteger(e.region) && h.state.regions[e.region], `${e.card} is in exactly one region`);
    }
  };
  check();
  assert.equal(ent(h, fire)!.region, home);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]], spellTokens: [fire] });
  const r = h.state.battle!.region;
  assert.notEqual(r, home);
  assert.equal(ent(h, a)!.region, r, 'the unit is in the battle region and so no longer in its home region');
  assert.equal(ent(h, fire)!.region, r, 'the spell token went with it');
  check();
  finishBattle(h);
});

test('cr:combat.regions.exclusive.no-region-zones — cached and binned cards carry no region, no region holds a stack, and a cache is reachable only where its owner is present', () => {
  const h = new Harness(91013);
  toDeployment(h);
  const uid: number[] = [-1, -1];
  const g = new E(h.state);
  uid[0] = g.cacheCard(0, 'Wisp', 'effect', { prophecy: 'Three Turns Pass' }).uid!;
  uid[1] = g.cacheCard(1, 'Hammer of Justice', 'effect', { prophecy: 'Three Turns Pass' }).uid!;
  g.settle();
  h.state.players[0]!.bin.push('Wisp');
  for (const p of h.state.players) {
    for (const c of p.cache ?? []) assert.ok(!('region' in c), 'a cached card names no region');
    for (const c of p.bin) assert.equal(typeof c, 'string', 'a binned card is a bare card, with no region');
  }
  for (const r of h.state.regions) assert.ok(!('stack' in r), 'no region holds a stack of its own');
  assert.ok(Array.isArray(h.state.stack), 'there is one stack for the game');
  const SPEC = { what: 'cachedCard' as const, prompt: 'recall up to one target cached card', count: 1, min: 0 };
  // during deployment each player is alone in their region: only their own cache is in reach
  for (const seat of [0, 1] as Seat[]) {
    const refs = h.q.targetCandidates(SPEC, h.q.homeRegion(seat), undefined, seat).map(r => JSON.stringify(r));
    assert.deepEqual(refs, [JSON.stringify({ cached: { seat, uid: uid[seat] } })]);
  }
  // in battle both players are present in the battle region: both caches are in reach
  const atk = tok(h, 0, 1, 1);
  toNextBattle(h, 0);
  h.do({ type: 'declareAttack', seat: 0, columns: [[atk]] });
  const refs = h.q.targetCandidates(SPEC, h.state.battle!.region, undefined, 0).map(r => JSON.stringify(r));
  assert.equal(refs.length, 2, 'both caches are in reach once both players are present');
  finishBattle(h);
});

test('cr:combat.regions.one-at-a-time — the first battle round runs every one of its steps in the defending region before the counterattack round begins in the other region', () => {
  const h = new Harness(91014);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 1, 9);
  const c = tok(h, D, 1, 9);
  toNextBattle(h, A);
  const trail: string[] = [];
  const note = (): void => {
    const b = h.state.battle;
    if (!b) return;
    const row = `${b.round}:${b.region}:${b.step}`;
    if (trail[trail.length - 1] !== row) trail.push(row);
  };
  note();
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] }); note();
  pass(h); pass(h); note();
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [c] }); note();
  let guard = 30;
  while (h.state.battle && h.state.battle.round === 1 && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
    note();
  }
  const g = new E(h.state);
  const r1 = trail.filter(t => t.startsWith('1:'));
  const r2 = trail.filter(t => t.startsWith('2:'));
  assert.ok(r1.every(t => t.startsWith(`1:${g.homeRegion(D)}:`)), `round 1 stays in the defending region: ${trail}`);
  assert.deepEqual(r1.map(t => t.split(':')[2]),
    ['declare', 'attackWindow', 'blocks', 'blockWindow', 'damageWindow', 'afterWindow'].filter(s => r1.some(t => t.endsWith(`:${s}`))),
    'round 1 walks its steps in order');
  assert.ok(r1.some(t => t.endsWith(':afterWindow')), 'round 1 reached its last step');
  assert.ok(r2.length > 0 && trail.indexOf(r2[0]!) > trail.indexOf(r1[r1.length - 1]!), 'round 2 begins only after round 1 is over');
  assert.ok(r2.every(t => t.startsWith(`2:${g.homeRegion(A)}:`)), 'and is fought in the other region');
  finishBattle(h);
});

test('cr:combat.regions.one-at-a-time.order — in a two-player game the first battle is in the non-initiative region and the counterattack battle is in the initiative region', () => {
  const h = new Harness(91015);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 1, 9);
  const c = tok(h, D, 1, 9);
  toNextBattle(h, A);
  const g = new E(h.state);
  assert.equal(h.state.initiative, A);
  assert.equal(h.state.battle!.round, 1);
  assert.equal(h.state.battle!.region, g.homeRegion(D), 'first: the non-initiative player region');
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [c] });
  let guard = 30;
  while (h.state.battle && h.state.battle.round === 1 && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  assert.equal(h.state.battle!.round, 2);
  assert.equal(h.state.battle!.attacker, D, 'the counterattack');
  assert.equal(h.state.battle!.region, g.homeRegion(A), 'then: the initiative player region');
  finishBattle(h);
});

test('cr:combat.regions.one-at-a-time.order — with no counterattack sent, no battle is fought in the initiative region', () => {
  const h = new Harness(91016);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 1, 9);
  tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  let guard = 30;
  while (h.state.battle && h.state.battle.round === 1 && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  assert.equal(h.state.battle, null, 'the battle phase is over: nothing is fought in the initiative region');
  assert.notEqual(h.state.phase, 'battle');
});

test('cr:combat.formations.definition — the units declared as attackers make up the attacking formation and the units declared as blockers make up the defending formation', () => {
  const h = new Harness(91017);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a1 = tok(h, A, 1, 9), a2 = tok(h, A, 1, 9), a3 = tok(h, A, 1, 9);
  const d1 = tok(h, D, 1, 9), d2 = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1, a2], [a3]] });
  assert.deepEqual(lineOf(h).columns, [[a1, a2], [a3]], 'the attacking formation is exactly the attackers');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1], 1: [d2] } });
  assert.deepEqual(lineOf(h).blocks, { 0: [d1], 1: [d2] }, 'the defending formation is exactly the blockers');
  finishBattle(h);
});

test('cr:combat.formations.definition.shape — a formation may be many columns wide, but a column of three units is refused on either side', () => {
  const h = new Harness(91018);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = [0, 1, 2, 3, 4].map(() => tok(h, A, 1, 9));
  const d = [0, 1, 2].map(() => tok(h, D, 1, 9));
  toNextBattle(h, A);
  assert.ok(refused(() => h.do({ type: 'declareAttack', seat: A, columns: [[a[0]!, a[1]!, a[2]!]] }), /columns hold 1-2 units/), 'three in one attacking column');
  h.do({ type: 'declareAttack', seat: A, columns: a.map(id => [id]) });
  assert.equal(h.state.battle!.columns.length, 5, 'five columns wide');
  pass(h); pass(h);
  assert.ok(refused(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d[0]!, d[1]!, d[2]!] } }), /blocking columns hold 1-2 units/), 'three in one blocking column');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d[0]!, d[1]!] } });
  assert.deepEqual(h.state.battle!.blocks[0], [d[0], d[1]], 'two, front and back, is allowed');
  finishBattle(h);
});

test('cr:combat.formations.definition.when-set — attacks are declared only in the attack step and blocks only in the block step', () => {
  const h = new Harness(91019);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 1, 9);
  const d = tok(h, D, 1, 9);
  toNextBattle(h, A);
  assert.equal(h.state.battle!.step, 'declare');
  assert.ok(refused(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d] } }), /not your block step/), 'no blocks in the attack step');
  assert.ok(legalActions(h.state, A).some(x => x.type === 'declareAttack'), 'the attack is offered in the attack step');
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  assert.ok(!legalActions(h.state, A).some(x => x.type === 'declareAttack'), 'and not after it');
  assert.ok(refused(() => h.do({ type: 'declareAttack', seat: A, columns: [[a]] }), /not your attack step/), 'a second attack declaration is refused');
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'blocks');
  assert.ok(refused(() => h.do({ type: 'declareAttack', seat: A, columns: [[a]] }), /not your attack step/), 'no attack declaration in the block step');
  assert.ok(legalActions(h.state, D).some(x => x.type === 'declareBlocks'), 'blocks are offered in the block step');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d] } });
  assert.ok(refused(() => h.do({ type: 'declareBlocks', seat: D, blocks: {} }), /not your block step/), 'and cannot be declared again after it');
  finishBattle(h);
});

test('cr:combat.formations.outside — a defending unit in the battle region that is not in the defending formation neither blocks nor takes combat damage', () => {
  const h = new Harness(91020);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 2, 9);
  const idle = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.equal(ent(h, idle)!.region, h.state.battle!.region, 'it stands in the battle region');
  assert.equal(new E(h.state).columnOf(idle), null, 'outside every formation');
  const life = h.state.players[D]!.life;
  passToStep(h, 'afterWindow');
  assert.equal(h.state.players[D]!.life, life - 2, 'it did not block: the attacker connected');
  assert.equal(ent(h, idle)!.damage, 0, 'and it took no combat damage');
  finishBattle(h);
});

test('cr:combat.formations.collapse.after-blocks — after blocks a column emptied of its attacker stays as a hole, and the hole stays when its blocker dies too', () => {
  const h = new Harness(91021);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = [tok(h, A, 1, 9), tok(h, A, 1, 9), tok(h, A, 1, 9)];
  const blk = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [blk] } });
  kill(h, atk[1]!);
  assert.deepEqual(lineOf(h).columns, [[atk[0]], [], [atk[2]]], 'the middle column stays, empty; nothing moves');
  assert.deepEqual(lineOf(h).blocks, { 1: [blk] }, 'the blocker keeps its column');
  kill(h, blk);
  assert.deepEqual(lineOf(h).columns, [[atk[0]], [], [atk[2]]], 'the hole does not close');
  finishBattle(h);
});

test('cr:combat.formations.placement.source-gone — Hooba-Lin is destroyed with its attack trigger on the stack, and the 1/1 still joins the formation Hooba-Lin was in', () => {
  const h = new Harness(91022);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const src = spawn(h, A, 'Hooba-Lin');
  const whale = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[src], [whale]] });
  assert.ok(h.state.stack.some(i => i.card === 'Hooba-Lin'), 'the attack trigger waits');
  kill(h, src);
  assert.equal(ent(h, src), undefined, 'the source has left play');
  pass(h); pass(h);
  const d = h.state.decision;
  assert.equal(d?.kind, 'formationSlot', 'the controller is asked where in the formation');
  h.do({ type: 'decide', seat: A, choice: 0 });
  const line = h.state.battle!.columns.flat();
  assert.ok(line.includes(whale));
  assert.ok(line.some(id => ent(h, id)?.card === 'Unit Token'), 'the 1/1 stands in the attacking formation');
  finishBattle(h);
});

test('cr:combat.columns.definition — one blocker in front of a two-unit attacking column blocks the whole column, so neither attacker damages the defending player', () => {
  const h = new Harness(91023);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const front = tok(h, A, 2, 9), back = tok(h, A, 2, 9);
  const blk = tok(h, D, 1, 20);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, back]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  const life = h.state.players[D]!.life;
  passToStep(h, 'afterWindow');
  assert.equal(h.state.players[D]!.life, life, 'no damage reached the defending player from either row');
  assert.ok(ent(h, blk)!.damage > 0, 'the column fought its blocker instead');
  finishBattle(h);
});

test('cr:combat.columns.definition.shared-attributes — Flying on the front unit of a column is shared with the unit behind it and not with the unit in the next column', () => {
  const h = new Harness(91024);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const flyer = tok(h, A, 1, 9), behind = tok(h, A, 1, 9), beside = tok(h, A, 1, 9);
  toNextBattle(h, A);
  ent(h, flyer)!.tempAttrs = ['Flying'];
  assert.ok(!new E(h.state).effAttrs(ent(h, behind)!).has('Flying'), 'outside a formation nothing is shared');
  h.do({ type: 'declareAttack', seat: A, columns: [[flyer, behind], [beside]] });
  const g = new E(h.state);
  assert.ok(g.effAttrs(ent(h, behind)!).has('Flying'), 'shared with the unit in the same column');
  assert.ok(!g.effAttrs(ent(h, beside)!).has('Flying'), 'not shared with the unit to its side');
  finishBattle(h);
});

test('cr:combat.columns.definition.side-block-shared-column — two units side-block in one column beside the attack, one in the front slot and one in the back slot', () => {
  const h = new Harness(91025);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 1, 20);
  const s1 = tok(h, D, 1, 1), s2 = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [s1, s2] } });
  const b = h.state.battle!;
  assert.deepEqual(b.columns, [[a], []], 'an empty column opened beside the attack');
  assert.deepEqual(b.blocks[1], [s1, s2], 'front slot s1, back slot s2, in the same side-block column');
  finishBattle(h);
});

test('cr:combat.formations.placement.defending-emptied-block — after blocks a blocking column whose blocker died offers its front slot, and a unit placed there blocks that column', () => {
  const h = new Harness(91026);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = tok(h, A, 1, 20), a1 = tok(h, A, 1, 20);
  const b0 = tok(h, D, 1, 1), b1 = tok(h, D, 1, 20);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b0], 1: [b1] } });
  kill(h, b0);
  assert.deepEqual(h.state.battle!.blocks[0], [], 'the first blocking column is empty');
  const g = new E(h.state);
  assert.ok(g.formationSlots(D).some(s => s.spot.kind === 'hole' && s.spot.column === 0), 'its front slot is offered');
  const late = g.spawnUnit(D, 'Unit Token', h.state.battle!.region, { token: true, tokenStats: [2, 5] });
  assert.equal(g.placeInFormation(late, chooseLabel(D, /column 1 \(an empty slot/), { source: 'cr' }), true);
  g.settle();
  assert.deepEqual(h.state.battle!.blocks[0], [late.id], 'the unit stands in that blocking column');
  const life = h.state.players[D]!.life;
  passToStep(h, 'afterWindow');
  assert.equal(ent(h, late.id)!.damage, 1, 'it fought the attacker of that column');
  assert.equal(ent(h, a0)!.damage, 2, 'and hit it');
  assert.equal(h.state.players[D]!.life, life, 'the column is blocked: nothing reached the player');
  finishBattle(h);
});

/* ── round-3 verifier probes ─────────────────────────────────────────────── */

test('cr:combat.formations.play-into.needs-formation — after blocks every attacker dies, and the attacker casts Tiderunner Initiate: nothing is asked and it enters play outside any formation', () => {
  const h = new Harness(73101);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 1, 3);
  const d = tok(h, D, 1, 9);
  giveResources(h, A, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d] } });
  kill(h, a);
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tiderunner Initiate') });
  assert.equal(h.state.decision, null, 'nothing is asked at cast');
  pass(h); pass(h);
  const r = unitsOf(h, A).find(u => u.card === 'Tiderunner Initiate');
  assert.ok(r, 'it entered play');
  assert.ok(!h.state.battle!.columns.flat().includes(r!.id), 'outside any formation');
  finishBattle(h);
});

test('cr:combat.formations.placement.empty-formation — after blocks every attacking unit dies, the attacker is offered no position, not even the hole, and Tiderunner Initiate enters play outside any formation', () => {
  const h = new Harness(73106);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 1, 3);
  const d = tok(h, D, 1, 9);
  giveResources(h, A, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d] } });
  kill(h, a);
  assert.deepEqual(h.state.battle!.columns, [[]], 'the hole is there');
  assert.deepEqual(new E(h.state).formationSlots(A), [], 'but no position is offered, not even the hole');
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tiderunner Initiate') });
  assert.equal(h.state.decision, null, 'no spot is asked for');
  pass(h); pass(h);
  const r = unitsOf(h, A).find(u => u.card === 'Tiderunner Initiate');
  assert.ok(r, 'it entered play');
  assert.deepEqual(h.state.battle!.columns, [[]], 'and the attacking line is unchanged');
  finishBattle(h);
});

test('cr:combat.formations.placement.source-gone — engine differs: a lone Hooba-Lin killed under its attack trigger makes its 1/1 outside the formation it was in', () => {
  const h = new Harness(73102);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const src = spawn(h, A, 'Hooba-Lin');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[src]] });
  assert.ok(h.state.stack.some(i => i.card === 'Hooba-Lin'), 'the attack trigger waits');
  kill(h, src);
  pass(h); pass(h);
  assert.equal(h.state.decision, null, 'no spot is asked for');
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Unit Token').length, 1, 'the 1/1 is made');
  const inLine = h.state.battle!.columns.flat().filter(id => ent(h, id)?.card === 'Unit Token');
  assert.equal(inLine.length, 0, 'but it is not placed into the formation Hooba-Lin was in');
  finishBattle(h);
});

test('cr:combat.formations.placement.defending — after blocks the defender is offered the slot behind its lone blocker and the front of the unblocked column but no end column, and after combat damage no block spot', () => {
  const h = new Harness(73103);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = tok(h, A, 1, 20), a1 = tok(h, A, 1, 20);
  const b0 = tok(h, D, 1, 20);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b0] } });
  assert.deepEqual(new E(h.state).formationSlots(D).map(s => s.spot),
    [{ kind: 'behind', unit: b0 }, { kind: 'block', column: 1 }],
    'behind the lone blocker, and in front of the unblocked column; no end column');
  passToStep(h, 'afterWindow');
  assert.equal(h.state.battle?.step, 'afterWindow');
  assert.ok(ent(h, a1), 'the unblocked attacker is still there');
  assert.ok(!new E(h.state).formationSlots(D).some(s => s.spot.kind === 'block'), 'after combat damage no block spot is offered');
  finishBattle(h);
});

test('cr:combat.formations.placement.defending-emptied-block — with no blocker left standing the emptied blocking column is not offered, only the front of the unblocked column', () => {
  const h = new Harness(73104);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = tok(h, A, 1, 20), a1 = tok(h, A, 1, 20);
  const b0 = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b0] } });
  kill(h, b0);
  assert.deepEqual(new E(h.state).formationSlots(D).map(s => s.spot), [{ kind: 'block', column: 1 }],
    'only the unblocked second column; the emptied first column is not offered');
  finishBattle(h);
});

test('cr:combat.formations.outside.stolen — a blocker whose control passes to the attacker after blocks is in neither the attacking nor the defending formation', () => {
  const h = new Harness(73105);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = tok(h, A, 1, 20);
  const b0 = tok(h, D, 1, 20);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b0] } });
  const g = new E(h.state);
  g.giveControl(g.entity(b0)!, A);
  g.settle();
  const b = h.state.battle!;
  assert.equal(ent(h, b0)!.controller, A, 'control changed');
  assert.ok(!b.columns.flat().includes(b0), 'not in the attacking formation');
  assert.ok(!Object.values(b.blocks).flat().includes(b0), 'not in the defending formation');
  finishBattle(h);
});

/** blockers on the first and third attacking columns, the second left unblocked, with Inspiration in the first */
function gapBlock(seed: number): { h: Harness; insp: EntityId; other: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = [tok(h, A, 1, 30), tok(h, A, 1, 30), tok(h, A, 1, 30)];
  const insp = spawn(h, D, 'Inspiration');
  const other = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [insp], 2: [other] } });
  return { h, insp, other };
}

test('cr:combat.columns.adjacency — engine differs: blockers of the first and third columns with the second unblocked are read as neighbours, so Inspiration buffs across the gap', () => {
  const { h, other } = gapBlock(71004);
  assert.deepEqual(effStats(h, other), [3, 3], 'the 1/1 in the third column got +2/+2');
  finishBattle(h);
});

test('cr:combat.columns.adjacency.positions — engine differs: the defending grid closes up the unblocked second column, so the third-column blocker is a side neighbour of the first-column blocker', () => {
  const { h, insp, other } = gapBlock(71008);
  assert.ok(new E(h.state).adjacentInFormation(insp).map(u => u.id).includes(other),
    'the third-column blocker is read as adjacent to the first-column blocker');
  finishBattle(h);
});

test('cr:combat.regions.arrangement — in a two-player game each region has one neighbour: an attack names no destination and goes into the opponent region, and the counterattack into the attacker region', () => {
  const h = new Harness(91040);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 1, 9);
  const c = tok(h, D, 1, 9);
  toNextBattle(h, A);
  const g = new E(h.state);
  assert.equal(h.state.regions.length, 2, 'two players, two regions');
  const attacks = legalActions(h.state, A).filter(x => x.type === 'declareAttack');
  assert.ok(attacks.length > 0, 'the attacker may declare an attack');
  for (const x of attacks) assert.deepEqual(Object.keys(x).sort(), ['columns', 'seat', 'type'], 'no attack offers a choice of region');
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  assert.equal(ent(h, a)!.region, g.homeRegion(D), 'the attack went into the one neighbouring region: the opponent region');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [c] });
  let guard = 30;
  while (h.state.battle && h.state.battle.round === 1 && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  assert.equal(h.state.battle!.attacker, D);
  assert.equal(ent(h, c)!.region, g.homeRegion(A), 'the counterattack went into the other one: the attacker region');
  finishBattle(h);
});
