/**
 * Comprehensive rules, unit U19 (attributes, general through Feeble) — CR
 * example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U19
 * (data/comprehensive-rules/build/probes/U19/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U19.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * The tests titled "engine differs" are the exception: their rule states the
 * printed reading and carries an engineDiffers mark, and each of these tests
 * pins the divergence the mark describes. No example is bound to them. When
 * one goes red the engine has been brought in line with the printed reading:
 * drop the engineDiffers mark and the test, and bind a real example.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Attr, EngineEvent, EntityId, Seat } from '../src/types.ts';
import {
  absorb, effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick, spawn, toDeployment, toNextBattle,
  tokensOf,
} from './util.ts';

/** a vanilla token unit with the given stats, in the seat's home region */
function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  h.state = g.s;
  return u.id;
}
function grant(h: Harness, id: EntityId, attr: Attr): void {
  const g = new E(h.state);
  g.addTempAttr(g.entity(id)!, attr);
  h.state = g.s;
}
/** effect damage from a unit source, outside combat */
function dealFrom(h: Harness, controller: Seat, sourceId: EntityId, tgt: EntityId, n: number): EngineEvent[] {
  const g = new E(h.state);
  const src = g.entity(sourceId)!;
  g.dealEffectDamageAll(
    {
      controller, sourceName: src.card, sourceId, region: g.homeRegion(controller),
      targets: [], event: null,
      eraseSelf: () => {},
      choose: () => { throw new Error('no choice expected'); },
    } as never,
    [{ target: g.entity(tgt)!, n }]);
  g.settle();
  h.state = g.s;
  absorb(h, g.events);
  return g.events;
}
const dealtTo = (evs: EngineEvent[], id: EntityId): number =>
  evs.filter(e => e.type === 'damage' && e.data?.['unit'] === id).reduce((s, e) => s + (e.data!['n'] as number), 0);
/** a card's printed text box, read off printed.json */
const PRINTED = ((): Record<string, { text?: string }> => {
  const raw = JSON.parse(fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cards', 'printed.json'), 'utf8')) as
    Record<string, { name: string; text?: string }> | { name: string; text?: string }[];
  return Object.fromEntries((Array.isArray(raw) ? raw : Object.values(raw)).map(c => [c.name, c]));
})();
const printedText = (name: string): string => PRINTED[name]?.text ?? '';
function strikeAll(h: Harness): void {
  let guard = 10;
  while (h.state.decision?.kind === 'assignDamage' && guard-- > 0) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
}

/* ── general ────────────────────────────────────────────────────────────── */

test('cr:attr.general.pure — Unaware is off in a Pure pairing outside combat: an Unaware source does not collapse a pumped Pure recipient to its printed stats', () => {
  const h = new Harness(43001);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const bubb = spawn(h, A, 'Bubb');                // Unaware source
  const pure = spawn(h, D, 'Just a Unit');         // 2/3 Pure
  { const g = new E(h.state); g.addCounters(g.entity(pure)!, 2); g.settle(); h.state = g.s; }   // 4/5 live
  const ctl = tok(h, D, 2, 3);
  { const g = new E(h.state); g.addCounters(g.entity(ctl)!, 2); g.settle(); h.state = g.s; }    // 4/5 live, not Pure
  dealFrom(h, A, bubb, pure, 3);
  dealFrom(h, A, bubb, ctl, 3);
  assert.ok(ent(h, pure), 'the Pure 4/5 survives 3: not read at its printed 2/3');
  assert.equal(ent(h, ctl), undefined, 'control: the non-Pure 4/5 (printed 2/3) is collapsed by Unaware and dies');
});

test('cr:attr.general.pure — engine differs: Tough still applies to a unit dealt damage by a Pure source', () => {
  const h = new Harness(43002);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const src = spawn(h, A, 'Just a Unit');          // Pure source
  const tgt = spawn(h, D, 'Rampart Guardian');     // 0/4 Tough -> 0/8
  const evs = dealFrom(h, A, src, tgt, 5);
  assert.equal(dealtTo(evs, tgt), 5);
  assert.ok(ent(h, tgt), 'alive: 5 damage against the Tough-doubled 8, so Tough was NOT switched off by the Pure pairing');
  assert.deepEqual(effStats(h, tgt), [0, 8]);
});

test('cr:attr.general.pure — engine differs: Balanced still applies to a unit dealt damage by a Pure source', () => {
  const h = new Harness(43003);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const src = spawn(h, A, 'Just a Unit');          // Pure source
  const tgt = tok(h, D, 4, 1);
  grant(h, tgt, 'Balanced');                       // 4/1 -> 4/4
  assert.deepEqual(effStats(h, tgt), [4, 4]);
  dealFrom(h, A, src, tgt, 3);
  assert.ok(ent(h, tgt), 'alive with 3 damage: Balanced was read in the Pure pairing (a 4/1 would have died)');
});

test('cr:attr.general.pure — engine differs: in combat, Tough still doubles a blocker whose exchange holds a Pure attacker', () => {
  const h = new Harness(43004);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 5, 20);
  const guard = spawn(h, D, 'Rampart Guardian');   // 0/4 Tough -> 0/8
  toNextBattle(h, A);
  grant(h, atk, 'Pure');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [guard] } });
  pass(h); pass(h);
  strikeAll(h);
  assert.ok(ent(h, guard), 'the Guardian survives 5: its Tough (0/8) was read in the Pure exchange');
  assert.equal(ent(h, guard)!.damage, 5);
  finishBattle(h);
});

test('cr:attr.general.pure — engine differs: in combat, Unaware still collapses an exchange that holds a Pure attacker', () => {
  const h = new Harness(43005);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 3, 3);
  ent(h, atk)!.counters = 4;                       // live 7/7
  const bubb = spawn(h, D, 'Bubb');                // 5/6 Unaware
  toNextBattle(h, A);
  grant(h, atk, 'Pure');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  pass(h); pass(h);
  strikeAll(h);
  assert.ok(ent(h, bubb), 'Bubb survives');
  assert.equal(ent(h, bubb)!.damage, 3, 'the Pure attacker dealt its printed 3: Unaware was NOT switched off by Pure');
  assert.equal(ent(h, atk), undefined, 'and died against its printed 3 defense');
  finishBattle(h);
});

test('cr:attr.general.application-order — a Tough unit attacking with a Balanced unit behind it is doubled, then balanced: Rampart Guardian is an 8/8', () => {
  const h = new Harness(43006);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const g0 = spawn(h, A, 'Rampart Guardian');      // 0/4 Tough
  const child = spawn(h, A, 'Child of Aether');    // 2/0 Balanced
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[g0, child]] });
  assert.deepEqual(effStats(h, g0), [8, 8], 'Guardian: its own Tough first (0/8), then the Balanced shared from behind (8/8)');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: (1 - A) as Seat, blocks: {} });
  finishBattle(h);
});

test('cr:attr.general.application-order — engine differs: Tough augmented onto a printed-Balanced unit applies after the printed Balanced', () => {
  const h = new Harness(43007);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const child = spawn(h, p, 'Child of Aether');    // 2/0 printed Balanced
  giveResources(h, p, 'earth', 3);
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Rampart Guardian'), hostId: child });
  assert.deepEqual(effStats(h, child), [2, 4],
    'engine: Balanced (printed) then Tough, 2/2 then 2/4; the printed order (doubled, then balanced) would give 2/2');
});

/* ── Flying ─────────────────────────────────────────────────────────────── */

test('cr:attr.flying.removed — after the Flying unit leaves the attacking column, a ground unit may block the rest', () => {
  const h = new Harness(43008);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const sky = spawn(h, A, 'Ephemeral Skywalker'); // 3/1 Flying
  const t = tok(h, A, 1, 1);
  const ground = spawn(h, D, 'Rune Channeler');   // no Flying
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sky, t]] });
  assert.ok(new E(h.state).effAttrs(ent(h, t)!).has('Flying'), 'the token shares Flying while the Skywalker is in the column');
  { const g = new E(h.state); g.destroy(g.entity(sky)!, 'dies'); g.settle(); h.state = g.s; }
  pass(h); pass(h);
  assert.ok(!new E(h.state).effAttrs(ent(h, t)!).has('Flying'), 'the token lost Flying');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [ground] } });
  assert.deepEqual(h.state.battle!.blocks[0], [ground], 'the ground block is legal');
  finishBattle(h);
});

/* ── Deadly ─────────────────────────────────────────────────────────────── */

test('cr:attr.deadly.timing — a Deadly and Swift column kills its blocker in the Swift sub-step, before the blocker strikes', () => {
  const h = new Harness(43009);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');        // 2/1 Swift
  const terror = spawn(h, A, 'Tidepool Terror');   // 1/2 Deadly
  const blk = tok(h, D, 5, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune, terror]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  strikeAll(h);
  assert.equal(ent(h, blk), undefined, 'the 5/9 blocker is already destroyed when the Swift sub-step ends');
  finishBattle(h);
  assert.ok(ent(h, dune) && ent(h, terror), 'neither attacker was struck back');
  assert.equal(ent(h, dune)!.damage + ent(h, terror)!.damage, 0);
});

test('cr:attr.deadly.players — an unblocked Deadly 3/3 costs the defending player exactly 3 life', () => {
  const h = new Harness(43010);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dev = spawn(h, A, 'Carapace Devourer');    // 3/3 Deadly
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[dev]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, life0 - 3, 'loses exactly 3');
});

/* ── Swift and Sluggish ─────────────────────────────────────────────────── */

test('cr:attr.swift.pure — a Swift attacker blocked by a Pure unit strikes in the normal sub-step, together with the blocker', () => {
  const h = new Harness(43011);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');        // 2/1 Swift
  const pure = spawn(h, D, 'Just a Unit');         // 2/3 Pure
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [pure] } });
  pass(h); pass(h);
  assert.deepEqual(h.state.battle?.damageSubs ?? null, ['normal'], 'only the normal sub-step strikes');
  assert.equal(ent(h, dune), undefined, 'the Drifter is struck back simultaneously and dies');
  assert.equal(ent(h, pure)!.damage, 2, 'and the Pure blocker took its 2 in the same strike');
  finishBattle(h);
});

test('cr:attr.sluggish.pure — a Sluggish attacker blocked by a Pure unit strikes in the normal sub-step, together with the blocker', () => {
  const h = new Harness(43012);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const slow = spawn(h, A, 'Ambling Mountaintop'); // 4/5 Sluggish
  const pure = spawn(h, D, 'Just a Unit');         // 2/3 Pure
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[slow]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [pure] } });
  pass(h); pass(h);
  assert.deepEqual(h.state.battle?.damageSubs ?? null, ['normal'], 'only the normal sub-step strikes');
  assert.equal(ent(h, pure), undefined, 'the Pure blocker died to the 4');
  assert.equal(ent(h, slow)!.damage, 2, 'and struck back in the same strike');
  finishBattle(h);
});

/* ── Tough and Balanced ─────────────────────────────────────────────────── */

test('cr:attr.tough.power — a 0/4 Tough unit with a -1/-1 counter is a -1/6: its power is not doubled', () => {
  const h = new Harness(43013);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const g0 = spawn(h, p, 'Rampart Guardian');
  ent(h, g0)!.counters = -1;
  assert.deepEqual(effStats(h, g0), [-1, 6]);
});

test('cr:attr.tough.after-counters — a 0/4 Tough unit with a -1/-1 counter has defense 6: the counter applies first, then the doubling', () => {
  const h = new Harness(43014);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const g0 = spawn(h, p, 'Rampart Guardian');
  ent(h, g0)!.counters = -1;
  assert.equal(effStats(h, g0)[1], 6, '(4 - 1) x 2 = 6, not 4 x 2 - 1 = 7');
});

test('cr:attr.balanced.after-changes — Balanced reads after counters: a 1/3 with two +1/+1 counters and Balanced is a 5/5', () => {
  const h = new Harness(43015);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = tok(h, p, 1, 3);
  ent(h, u)!.counters = 2;
  grant(h, u, 'Balanced');
  assert.deepEqual(effStats(h, u), [5, 5]);
});

/* ── Unaware ────────────────────────────────────────────────────────────── */

test('cr:attr.unaware.targets — Poison X=6 may target Unaware Bubb: six -1/-1 counters go on, and Bubb stays a 5/6', () => {
  const h = new Harness(43016);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 1);
  const bubb = spawn(h, D, 'Bubb');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  new E(h.state).createSpellToken(A, 'Poison', 6, region);
  h.do({ type: 'castSpellToken', seat: A, entityId: tokensOf(h, A).find(t => t.card === 'Poison')!.id });
  pick(h, { unit: bubb });                         // the target menu offers Bubb
  let guard = 6;
  while (h.state.stack.length > 0 && guard-- > 0) pass(h);
  assert.ok(ent(h, bubb), 'Bubb survives');
  assert.equal(ent(h, bubb)!.counters, -6, 'the six counters are on it');
  assert.deepEqual(effStats(h, bubb), [5, 6], 'and it still reads its printed 5/6');
  finishBattle(h);
});

test('cr:attr.unaware.targets — a Robot 10 squishing Bubb deals 0, because the Robot is read at its printed 0/0', () => {
  const h = new Harness(43017);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const g0 = new E(h.state);
  const robot = g0.spawnUnit(A, 'Robot', g0.homeRegion(A), { token: true, counters: 10 }).id;
  g0.settle(); h.state = g0.s;
  const bubb = spawn(h, D, 'Bubb');
  const g = new E(h.state);
  assert.deepEqual(g.printedStats(g.entity(bubb)!), [5, 6], 'Bubb prints 5/6: its printed defense is 6, not 0');
  assert.deepEqual(g.interactionStats(g.entity(robot)!, [g.entity(bubb)!]), [0, 0], 'the Robot, in an interaction with Bubb, reads 0/0');
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[robot]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Squish') });
  pick(h, { unit: robot });
  pick(h, { unit: bubb });
  pass(h); pass(h);
  assert.equal(ent(h, bubb)!.damage, 0, 'the Robot deals its printed defense, 0');
  finishBattle(h);
});

/* ── Powerful ───────────────────────────────────────────────────────────── */

test('cr:attr.powerful.unit-source — Squish on a unit that shares Powerful from its column deals double', () => {
  const h = new Harness(43018);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ally = tok(h, A, 1, 3);
  const chitin = spawn(h, A, 'Chitin Shredder');   // Powerful, column-mate
  const wall = tok(h, D, 0, 20);
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally, chitin]] });
  assert.ok(!ownAttrs(h, ally).has('Powerful'), 'premise: the ally does not print Powerful');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Squish') });
  pick(h, { unit: ally });
  pick(h, { unit: wall });
  pass(h); pass(h);
  assert.equal(ent(h, wall)!.damage, 6, 'the ally deals its 3 defense, doubled by the shared Powerful');
  finishBattle(h);
});

/* ── Vulnerable ─────────────────────────────────────────────────────────── */

test('cr:attr.vulnerable.lethal — a Vulnerable 3/7 needs 4 (half of 7 rounded up), so a 10-power Piercing column sends 6 through', () => {
  const h = new Harness(43019);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 20);
  const blk = tok(h, D, 3, 7);
  toNextBattle(h, A);
  grant(h, atk, 'Piercing');
  grant(h, blk, 'Vulnerable');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  const life0 = h.state.players[D]!.life;
  finishBattle(h);
  assert.equal(ent(h, blk), undefined, 'the blocker died');
  assert.equal(h.state.players[D]!.life, life0 - 6, '4 kept on the 3/7 (8 received), 6 pierce; rounding down would keep 3 (6 received, not lethal)');
});

test('cr:attr.vulnerable.lethal — lethal is half the remaining defense: a Vulnerable 3/8 with 2 damage marked needs 3, so 7 of 10 pierce', () => {
  const h = new Harness(43020);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 20);
  const blk = spawn(h, D, 'Crumbling Ancient');    // 3/8 Vulnerable
  toNextBattle(h, A);
  grant(h, atk, 'Piercing');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  ent(h, blk)!.damage = 2;
  const life0 = h.state.players[D]!.life;
  finishBattle(h);
  assert.equal(ent(h, blk), undefined, 'the blocker died');
  assert.equal(life0 - h.state.players[D]!.life, 7, '3 kept (6 received on 6 remaining), 7 pierce');
});

test('cr:attr.vulnerable.pure — a Vulnerable unit that is itself Pure is dealt 2 by a 2-damage effect, not 4', () => {
  const h = new Harness(43021);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const src = spawn(h, A, 'Lithoghul');
  const tgt = spawn(h, D, 'Crumbling Ancient');    // 3/8 Vulnerable
  grant(h, tgt, 'Pure');
  const evs = dealFrom(h, A, src, tgt, 2);
  assert.equal(dealtTo(evs, tgt), 2, 'dealt 2, not 4');
});

/* ── Feeble ─────────────────────────────────────────────────────────────── */

test('cr:attr.feeble — Bripp prints Feeble, so the block-refusal guards that use it are not vacuous', () => {
  const h = new Harness(43022);
  toDeployment(h);
  const D = (1 - (h.state.initiative as Seat)) as Seat;
  const bripp = spawn(h, D, 'Bripp');
  assert.ok(ownAttrs(h, bripp).has('Feeble'), 'Bripp carries Feeble');
});

test('cr:attr.feeble.pure — a Pure unit granted Feeble is accepted as a blocker', () => {
  const h = new Harness(43023);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 1);
  const pure = spawn(h, D, 'Just a Unit');
  grant(h, pure, 'Feeble');
  assert.ok(ownAttrs(h, pure).has('Feeble') && ownAttrs(h, pure).has('Pure'), 'premise: it is Pure and Feeble');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [pure] } });
  assert.deepEqual(h.state.battle!.blocks[0], [pure]);
  finishBattle(h);
});

/* ── the attributes' reminder texts, executed ───────────────────────────── */

test('cr:attr.flying — Air Plant prints the reminder, and only a flying unit may block a Flying attacker', () => {
  assert.ok(printedText('Air Plant').includes('Only flying units can block flying units.'), 'the printed reminder');
  const h = new Harness(43024);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const sky = spawn(h, A, 'Ephemeral Skywalker'); // 3/1 Flying
  const ground = spawn(h, D, 'Rune Channeler');   // no Flying
  const flyer = tok(h, D, 1, 5);
  toNextBattle(h, A);
  grant(h, flyer, 'Flying');
  h.do({ type: 'declareAttack', seat: A, columns: [[sky]] });
  pass(h); pass(h);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [ground] } }), /flying/i,
    'a ground unit may not block the Flying attacker');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [flyer] } });
  assert.deepEqual(h.state.battle!.blocks[0], [flyer], 'a flying unit may');
  finishBattle(h);
});

test('cr:attr.deadly — Rotspore Herald prints the reminder, and 1 combat damage from a Deadly attacker kills a 5/9 blocker', () => {
  assert.ok(printedText('Rotspore Herald').includes('Any damage from a deadly source will kill a unit.'), 'the printed reminder');
  const h = new Harness(43025);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const terror = spawn(h, A, 'Tidepool Terror');   // 1/2 Deadly
  const blk = tok(h, D, 5, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[terror]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  strikeAll(h);
  finishBattle(h);
  assert.equal(ent(h, blk), undefined, 'the 5/9 died to 1 damage from a Deadly source');
});

test('cr:attr.swift — Rime Wraith prints the reminder, and a Swift 2/1 kills a 2/2 blocker before it can strike back', () => {
  assert.ok(printedText('Rime Wraith').includes('Swift units deal combat damage first.'), 'the printed reminder');
  const h = new Harness(43026);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');        // 2/1 Swift
  const blk = tok(h, D, 2, 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  strikeAll(h);
  finishBattle(h);
  assert.equal(ent(h, blk), undefined, 'the blocker died');
  assert.ok(ent(h, dune), 'the Swift 2/1 survived');
  assert.equal(ent(h, dune)!.damage, 0, 'and was never struck');
});

test('cr:attr.sluggish — Rime Wraith prints the reminder, and a Sluggish 4/5 dies to a 5/4 blocker before it can strike', () => {
  assert.ok(printedText('Rime Wraith').includes('Sluggish units deal combat damage last.'), 'the printed reminder');
  const h = new Harness(43027);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const slow = spawn(h, A, 'Ambling Mountaintop'); // 4/5 Sluggish
  const blk = tok(h, D, 5, 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[slow]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  strikeAll(h);
  finishBattle(h);
  assert.equal(ent(h, slow), undefined, 'the Sluggish attacker died in the normal sub-step');
  assert.ok(ent(h, blk), 'the blocker survived');
  assert.equal(ent(h, blk)!.damage, 0, 'and was never struck');
});

test('cr:attr.unaware — Unaware Bubb ignores its own counters, and a pumped 3/3 blocked by Bubb is read at its printed 3/3', () => {
  const h = new Harness(43028);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 3, 3);
  ent(h, atk)!.counters = 4;                       // live 7/7
  const bubb = spawn(h, D, 'Bubb');                // 5/6 Unaware
  ent(h, bubb)!.counters = 2;
  assert.deepEqual(effStats(h, bubb), [5, 6], 'Bubb ignores its own +2/+2: it reads its printed 5/6');
  assert.deepEqual(effStats(h, atk), [7, 7], 'control: outside an interaction with Bubb the token is a 7/7');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  pass(h); pass(h);
  strikeAll(h);
  assert.equal(ent(h, bubb)!.damage, 3, 'the attacker dealt its printed 3, not 7');
  assert.equal(ent(h, atk), undefined, 'and died to 5 against its printed defense 3');
  finishBattle(h);
});

test('cr:attr.powerful — Emberflame Enlightener prints the reminder, and a Powerful source deals double in combat and by effect', () => {
  assert.ok(printedText('Emberflame Enlightener').includes('Powerful sources deal double damage'), 'the printed reminder');
  const h = new Harness(43029);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const chitin = spawn(h, A, 'Chitin Shredder');   // 1/2 Powerful
  const wall = tok(h, D, 0, 20);
  const evs = dealFrom(h, A, chitin, wall, 3);
  assert.equal(dealtTo(evs, wall), 6, 'effect damage 3 from a Powerful source is dealt as 6');
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[chitin]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.equal(life0 - h.state.players[D]!.life, 2, 'the unblocked 1-power Powerful attacker costs 2 life');
});
