/* R120 — ELECTIVE combat-damage assignment (playtest ledger #84, the half the
 * owner deferred): "Each player is allowed to split the damage however they
 * want … It's actually legal to do ALL the damage to the front unit and none
 * to the back one, even if there is enough to kill them both. The only rule is
 * that the front unit must be assigned lethal damage before assigning any to
 * the back unit."
 *
 * The engine never decides for the player: when a strike has ≥2 living
 * victims and more pool than the front unit's pass-along share, the side
 * DEALING the damage is asked — one victim at a time, front-to-back, with the
 * one-click default split leading the first question. Trivial combats (one
 * victim, pool ≤ the front's share, {Piercing}) keep the silent pre-R120 path.
 *
 * Every "default" number below was PINNED against the pre-R120 engine at
 * d5e8def before the feature landed (scratch run, 2026-08-24): a 4-power
 * column onto 1/1+1/1 dealt 1/3; a 7-power blocker onto 1/2+1/2 dealt 2/5; a
 * Piercing 4 onto 1/1+1/1 dealt 1/1 with 2 to the face; a Deadly 2 onto
 * 3/5+3/5 dealt 1/1. Those exact numbers are what the default option must
 * reproduce.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { forcedAction } from '../src/apply.ts';
import type { GameState, Seat } from '../src/types.ts';
import { ent, pass, spawn, toDeployment, toNextBattle } from './util.ts';

/** spawn a p/t token unit for `seat` (the 82-attr-interactions idiom) */
function tok(h: Harness, seat: Seat, p: number, t: number): number {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}

/** [unit, n] of every 'damage' event since `mark` */
function dmgSince(h: Harness, mark: number): [number, number][] {
  return h.events.slice(mark).filter(e => e.type === 'damage')
    .map(e => [e.data!['unit'] as number, e.data!['n'] as number]);
}

/** answer the pending assignDamage decision with the option whose value is `v` */
function elect(h: Harness, v: unknown): void {
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'assignDamage', 'an elective-split decision is pending');
  const idx = dec.options.findIndex(o => o.value === v);
  assert.ok(idx >= 0, `option ${JSON.stringify(v)} is offered (menu: ${dec.options.map(o => JSON.stringify(o.value)).join(', ')})`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

/** the PIN1 board: a 4/3 attacker, blocked by 1/1 (front) + 1/1 (back) */
function overkillBoard(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const big = spawn(h, A, 'Rune Channeler');       // 4/3, no attributes
  const b1 = tok(h, D, 1, 1), b2 = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[big]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  const mark = h.events.length;
  pass(h); pass(h);   // into combat damage — the election suspends the sub-step
  return { h, A, D, big, b1, b2, mark };
}

test('R120 (a): the ATTACKER is asked, and ALL 4 onto the front 1/1 leaves the back one untouched', () => {
  const { h, A, D, big, b1, b2, mark } = overkillBoard(12001);
  const dec = h.state.decision!;
  assert.ok(dec, 'a real split raises a decision');
  assert.equal(dec.kind, 'assignDamage');
  assert.equal(dec.seat, A, 'the side DEALING the damage assigns — the attacker over its blockers');
  // the engine never answers for the player: no forced action while it pends
  assert.equal(forcedAction(h.state), null, 'forcedAction must not auto-answer the election');
  elect(h, 4);   // "(everything)" — the reported elective case: overkill the front
  assert.equal(h.state.decision, null, 'one question settles a two-victim column');
  const hits = dmgSince(h, mark);
  assert.deepEqual(hits.filter(([u]) => u === b1).map(([, n]) => n), [4],
    'the front 1/1 was DEALT the whole 4 (R114: nothing is trimmed)');
  assert.deepEqual(hits.filter(([u]) => u === b2), [], 'the back 1/1 was assigned NOTHING');
  assert.ok(!ent(h, b1), 'front blocker died');
  assert.ok(ent(h, b2), 'back blocker survives untouched');
  assert.equal(h.state.players[D]!.life, 30, 'no Piercing — nothing reached the player');
  assert.deepEqual(hits.filter(([u]) => u === big).map(([, n]) => n), [2],
    'the block-side strike (1+1 onto one victim) stayed silent and landed as before');
});

test('R120 (b): the FIRST option is the default split, and one click reproduces the pre-R120 numbers exactly', () => {
  const { h, D, big, b1, b2, mark } = overkillBoard(12002);
  const dec = h.state.decision!;
  assert.equal(dec.options[0]!.value, 'default', 'the one-click default leads the menu');
  assert.match(dec.options[0]!.label, /^default/, 'and is labeled as the default');
  h.do({ type: 'decide', seat: dec.seat, choice: 0 });
  assert.equal(h.state.decision, null, 'the default skips the per-unit walk entirely');
  const hits = dmgSince(h, mark);
  // pinned pre-R120 at d5e8def: front 1, back 1+2 leftover = 3, striker takes 2
  assert.deepEqual(hits.filter(([u]) => u === b1).map(([, n]) => n), [1], 'front: its share, 1');
  assert.deepEqual(hits.filter(([u]) => u === b2).map(([, n]) => n), [3], 'back: share + R114 leftover = 3');
  assert.deepEqual(hits.filter(([u]) => u === big).map(([, n]) => n), [2]);
  assert.ok(!ent(h, b1) && !ent(h, b2), 'both blockers die, as before');
  assert.equal(h.state.players[D]!.life, 30);
});

test('R120 (c): amounts below the front unit\'s lethal are never OFFERED while anything could go behind', () => {
  // 4-power attacker; front blocker 2/3 (share 3), back 1/1. Legal fronts: 3 or 4.
  const h = new Harness(12003);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const big = spawn(h, A, 'Rune Channeler');
  const b1 = tok(h, D, 2, 3), b2 = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[big]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  pass(h); pass(h);
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'assignDamage');
  const nums = dec.options.map(o => o.value).filter((v): v is number => typeof v === 'number');
  assert.deepEqual(nums, [3, 4],
    'the menu IS the rule: lethal-to-everything, nothing below lethal (R64 doctrine — illegal is unshown, not refused)');
  assert.ok(dec.options.some(o => o.value === 3 && /lethal/.test(o.label)), 'the floor is labeled lethal');
});

test('R120 (d): trivial combats stay SILENT — one victim, or pool within the front unit\'s share', () => {
  // one blocker, huge overkill: no decision, the full 4 lands (pre-R120 path)
  const h1 = new Harness(12004);
  toDeployment(h1);
  const A1 = h1.state.initiative as Seat, D1 = (1 - A1) as Seat;
  const big1 = spawn(h1, A1, 'Rune Channeler');
  const solo = tok(h1, D1, 1, 1);
  toNextBattle(h1, A1);
  h1.do({ type: 'declareAttack', seat: A1, columns: [[big1]] });
  pass(h1); pass(h1);
  h1.do({ type: 'declareBlocks', seat: D1, blocks: { 0: [solo] } });
  const m1 = h1.events.length;
  pass(h1); pass(h1);
  assert.equal(h1.state.decision, null, 'one living victim: no decision was raised');
  assert.deepEqual(dmgSince(h1, m1).filter(([u]) => u === solo).map(([, n]) => n), [4]);

  // two blockers but pool ≤ the front's share: every split is forced — silent
  const h2 = new Harness(12005);
  toDeployment(h2);
  const A2 = h2.state.initiative as Seat, D2 = (1 - A2) as Seat;
  const big2 = spawn(h2, A2, 'Rune Channeler');           // 4 power
  const f = tok(h2, D2, 1, 5), bk = tok(h2, D2, 1, 5);    // front share 5 > pool 4
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[big2]] });
  pass(h2); pass(h2);
  h2.do({ type: 'declareBlocks', seat: D2, blocks: { 0: [f, bk] } });
  const m2 = h2.events.length;
  pass(h2); pass(h2);
  assert.equal(h2.state.decision, null, 'pool ≤ front lethal: everything is owed to the front, nothing to elect');
  assert.deepEqual(dmgSince(h2, m2).filter(([u]) => u === f).map(([, n]) => n), [4], 'all 4 on the front');
  assert.deepEqual(dmgSince(h2, m2).filter(([u]) => u === bk), [], 'back untouched');
});

test('R120 (e): {Deadly} floors are 1 — the election prices them, and an elected overkill spares the back unit the sweep', () => {
  const h = new Harness(12006);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const d1 = spawn(h, A, 'Tidepool Terror');       // 1/2 {Deadly}
  const d2 = spawn(h, A, 'Tidepool Terror');       // 2-power Deadly column
  const b1 = tok(h, D, 3, 5), b2 = tok(h, D, 3, 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[d1, d2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  const mark = h.events.length;
  pass(h); pass(h);
  // first question: the ATTACKER's Deadly strike (pool 2 over floors 1+1)
  const dec = h.state.decision!;
  assert.equal(dec.seat, A);
  const nums = dec.options.map(o => o.value).filter((v): v is number => typeof v === 'number');
  assert.deepEqual(nums, [1, 2], 'the {Deadly} floor is 1, not the 5 the stats would price');
  assert.ok(dec.options.some(o => /Deadly.*floor/.test(o.label)), 'and it says so');
  elect(h, 2);   // both points on the front: the back 3/5 is never hit
  // second question: the DEFENDER's 6-power block-side strike over 1/2 + 1/2
  const dec2 = h.state.decision!;
  assert.equal(dec2.seat, D, 'both directions elect — now the defender over the attacking column');
  h.do({ type: 'decide', seat: D, choice: 0 });   // default (pinned pre-R120: 2 then 4)
  const hits = dmgSince(h, mark);
  assert.deepEqual(hits.filter(([u]) => u === b1).map(([, n]) => n), [2], 'front took the whole elected 2');
  assert.deepEqual(hits.filter(([u]) => u === b2), [], 'back was never hit');
  assert.ok(!ent(h, b1), 'Deadly kills the unit it touched');
  assert.ok(ent(h, b2), 'and spares the one it never touched — the election chose that');
  assert.deepEqual(hits.filter(([u]) => u === d1).map(([, n]) => n), [2], 'default block-side split, front');
  assert.deepEqual(hits.filter(([u]) => u === d2).map(([, n]) => n), [4], 'default block-side split, back + leftover');
});

test('R120 (f): {Piercing} never elects — its overflow is automatic, and the pinned numbers hold', () => {
  // Pinned pre-R120 at d5e8def: Bumblecrab+Bumblecrab (4, Piercing) onto
  // 1/1+1/1 dealt 1/1 with 2 to the face — and no decision existed. The
  // judgment call, documented on electionWalk: ledger #84's elective ruling
  // covers where NON-pierced damage lands among units; Piercing's overflow is
  // the ruling's own exception and stays automatic, so under Piercing every
  // victim gets exactly its share and there is nothing left to elect.
  const h = new Harness(12007);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const s1 = spawn(h, A, 'Bumblecrab');   // 2/3 {Piercing}
  const s2 = spawn(h, A, 'Bumblecrab');
  const b1 = tok(h, D, 1, 1), b2 = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[s1, s2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  const mark = h.events.length;
  pass(h); pass(h);
  assert.equal(h.state.decision, null, 'a {Piercing} strike raises no election');
  const hits = dmgSince(h, mark);
  assert.deepEqual(hits.filter(([u]) => u === b1).map(([, n]) => n), [1]);
  assert.deepEqual(hits.filter(([u]) => u === b2).map(([, n]) => n), [1]);
  assert.equal(h.state.players[D]!.life, 28, 'the 2 excess pierced to the face, exactly as pinned');
});

test('R120 (f2): an elective overkill on ONE side leaves the other side\'s {Piercing} overflow unchanged', () => {
  // Piercing attackers (4, overflow 2) meet 4/1+4/1 blockers whose 8-power
  // return strike DOES elect (shares 3+3 < 8). The defender's overkill
  // election must not move a single point of the attacker's pierce.
  const h = new Harness(12008);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const s1 = spawn(h, A, 'Bumblecrab');   // 2/3 {Piercing}
  const s2 = spawn(h, A, 'Bumblecrab');
  const b1 = tok(h, D, 4, 1), b2 = tok(h, D, 4, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[s1, s2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  const mark = h.events.length;
  pass(h); pass(h);
  const dec = h.state.decision!;
  assert.equal(dec.seat, D, 'only the non-Piercing (block-side) strike elects');
  elect(h, 8);   // everything onto the front Bumblecrab
  assert.equal(h.state.decision, null, 'and that was the only question');
  const hits = dmgSince(h, mark);
  assert.deepEqual(hits.filter(([u]) => u === s1).map(([, n]) => n), [8], 'front crab overkilled by election');
  assert.deepEqual(hits.filter(([u]) => u === s2), [], 'back crab untouched');
  assert.ok(ent(h, s2), 'and alive');
  assert.deepEqual(hits.filter(([u]) => u === b1).map(([, n]) => n), [1]);
  assert.deepEqual(hits.filter(([u]) => u === b2).map(([, n]) => n), [1]);
  assert.equal(h.state.players[D]!.life, 28, 'the Piercing overflow is still exactly 2 — untouched by the election');
});

test('R120 (g): a JSON round-trip mid-election drives — before the first answer and between the two strikes', () => {
  const h = new Harness(12009);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const d1 = spawn(h, A, 'Tidepool Terror');
  const d2 = spawn(h, A, 'Tidepool Terror');
  const b1 = tok(h, D, 3, 5), b2 = tok(h, D, 3, 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[d1, d2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  const mark = h.events.length;
  pass(h); pass(h);
  // suspended on the first strike, nothing recorded yet: assignPlans may be
  // entirely absent, which is also the shape of every pre-R120 saved state —
  // loading it and answering must work identically
  h.state = JSON.parse(JSON.stringify(h.state)) as GameState;   // save + load
  assert.equal(h.state.decision!.kind, 'assignDamage');
  elect(h, 1);   // the Deadly floor on the front; the last unit takes the rest, forced
  // now suspended on the SECOND strike with one complete plan recorded:
  // the recorded picks themselves must round-trip
  h.state = JSON.parse(JSON.stringify(h.state)) as GameState;   // save + load again
  const dec2 = h.state.decision!;
  assert.equal(dec2.kind, 'assignDamage');
  assert.equal(dec2.seat, D);
  elect(h, 3);   // 3 of 6 on the front 1/2; the back 1/2 takes the forced 3
  assert.equal(h.state.decision, null);
  const hits = dmgSince(h, mark);
  assert.deepEqual(hits.filter(([u]) => u === b1).map(([, n]) => n), [1], 'Deadly floor on the front');
  assert.deepEqual(hits.filter(([u]) => u === b2).map(([, n]) => n), [1], 'forced remainder behind');
  assert.ok(!ent(h, b1) && !ent(h, b2), 'Deadly swept both — both were hit');
  assert.deepEqual(hits.filter(([u]) => u === d1).map(([, n]) => n), [3]);
  assert.deepEqual(hits.filter(([u]) => u === d2).map(([, n]) => n), [3]);
  assert.equal(h.state.battle?.assignPlans, undefined, 'plans do not outlive their sub-step');
});

test('R120 (h): the BLOCK-side strike multi-assigns too — the defender may pile everything on the front attacker', () => {
  const h = new Harness(12010);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a1 = tok(h, A, 1, 2), a2 = tok(h, A, 1, 2);
  const fat = spawn(h, D, 'Life Plant');           // 7/3 blocker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1, a2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [fat] } });
  const mark = h.events.length;
  pass(h); pass(h);
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'assignDamage');
  assert.equal(dec.seat, D, 'the DEFENDER assigns its blocking column\'s damage over the attackers');
  elect(h, 7);   // everything on the front 1/2 — 5 past lethal, back untouched
  const hits = dmgSince(h, mark);
  assert.deepEqual(hits.filter(([u]) => u === a1).map(([, n]) => n), [7]);
  assert.deepEqual(hits.filter(([u]) => u === a2), [], 'back attacker untouched');
  assert.ok(ent(h, a2), 'and alive');
  assert.deepEqual(hits.filter(([u]) => u === fat).map(([, n]) => n), [2],
    'the 2-power attack onto the single blocker stayed silent (one victim)');
  assert.equal(h.state.players[A]!.life, 30, 'no Piercing anywhere: nothing to a player');
});
