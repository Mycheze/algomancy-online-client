/**
 * RAQ batch C — the Discord RAQ threads on grafts, augments, Reconfigure,
 * tokens, counters and copies, read against the engine (ledgers/raq.ts).
 *
 * Each test names the thread it comes from and quotes the claim. A claim the
 * engine disagrees with today is a `{ todo: 'RAQ: …' }` reproduction: it runs,
 * it says what the thread expects, and it does not fail the gate until the
 * owner has seen the list and a fix round takes it.
 *
 * Authority, as everywhere in this repo: `calebgannon` is final, `_passer`'s
 * [Solved] write-ups are reliable, other players are reasoning aloud.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import type { Action } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick, skipHasteStep, spawn, toDeployment, toNextBattle,
  tokensOf, unitsOf, withE as whiteBox,
} from './util.ts';
import type { Seat } from '../src/types.ts';

const handSize = (h: Harness, s: Seat): number => h.state.players[s]!.hand.length;

/** pass priority until `seat` holds it */
function passTo(h: Harness, seat: Seat): void {
  let guard = 8;
  while (h.state.priority !== seat && guard-- > 0) pass(h);
  assert.equal(h.state.priority, seat, 'priority reached the acting seat');
}

// ── [Solved] Reconfigure vs Despawn ─────────────────────────────────────
// _passer: "Does Reconfigure causes units Despawn effect to trigger? No. The
// Unit never switch zones … Bubb WON'T trigger Growing Plague 'When I
// Despawn'. Since now Robot is Unaware it will die and then trigger Growing
// Plague Despawn."

test('RAQ Reconfigure vs Despawn: moving Bubb and its Growing Plague onto a Robot fires no despawn; the Robot then dies Unaware and the Plague despawns once', () => {
  const h = new Harness(39301);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  let robot = -1, bubb = -1;
  whiteBox(h, e => {
    robot = e.spawnUnit(A, 'Robot', e.homeRegion(A), { token: true, counters: 3 }).id;   // 0/0 + three +1/+1
    bubb = e.spawnUnit(D, 'Bubb', e.homeRegion(D)).id;
    e.attachMod(e.s.entities[bubb]!, 'Growing Plague', D, 'augment');
  });
  assert.deepEqual(effStats(h, robot), [3, 3], 'setup: a 3/3 Robot');
  giveResources(h, D, 'earth', 2);
  giveResources(h, D, 'metal', 2);                            // Reconfigure em/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[robot]] });
  pass(h);                                                    // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Reconfigure') });
  pick(h, { unit: bubb });
  pick(h, { unit: robot });
  const before = handSize(h, A) + handSize(h, D);
  pass(h); pass(h);                                           // Reconfigure resolves
  while (h.state.stack.length) { pass(h); pass(h); }          // and whatever it set off
  assert.ok(!ent(h, robot), 'the Robot, now Unaware, ignored its counters and died a 0/0');
  assert.equal(handSize(h, A) + handSize(h, D) - before, 2,
    'Growing Plague despawned ONCE — when the Robot died — and not when Bubb was moved');
  finishBattle(h);
});

// ── [Solved] Reconfigure vs Once per Turn Abilities ─────────────────────
// _passer: "Does Reconfigure refresh used up Once per Turn Abilities so they
// can be used again? No. … Since Graxxlid was already Activated this turn,
// you CANNOT use his Ability again."

// BROKEN today: the second activation is accepted — the [once] budget does not
// follow the Graxxlid to its new host.
test('RAQ Reconfigure vs Once per Turn: a spent Graxxlid moved by Reconfigure onto a new host is still spent',
  { todo: 'RAQ: Reconfigure refreshes a moved mod once-per-turn budget' }, () => {
  const h = new Harness(39302);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  let bubb = -1, scuttler = -1, grax = -1;
  whiteBox(h, e => {
    bubb = e.spawnUnit(D, 'Bubb', e.homeRegion(D)).id;
    scuttler = e.spawnUnit(D, 'Mirage Scuttler', e.homeRegion(D)).id;
    grax = e.attachMod(e.s.entities[bubb]!, 'Graxxlid', D, 'augment').id;
  });
  giveResources(h, A, 'fire', 2);                             // Channeled Boon rr/2
  giveResources(h, D, 'earth', 4);
  giveResources(h, D, 'metal', 2);                            // [one] twice + Reconfigure em/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: bubb });                                    // aimed at the Graxxlid wearer
  const boon = h.state.stack[0]!.id;
  h.do({ type: 'activateAbility', seat: D, entityId: bubb, abilityIndex: 0, via: { mod: grax } });
  pick(h, { stack: boon });
  pass(h); pass(h);                                           // Graxxlid's negate resolves
  assert.ok(!h.state.stack.some(i => i.id === boon), 'setup: the [once] was used');
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Reconfigure') });
  pick(h, { unit: bubb });
  pick(h, { unit: scuttler });
  pass(h); pass(h);                                           // Reconfigure resolves
  assert.ok(ent(h, scuttler)!.mods.some(m => ent(h, m)!.card === 'Graxxlid'), 'Graxxlid now rides the Scuttler');
  // a fresh effect aimed at the Scuttler: the moved Graxxlid may not answer it
  giveResources(h, A, 'fire', 2);
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: scuttler });
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: D, entityId: scuttler, abilityIndex: 0, via: { mod: grax } }),
    /already used/,
    'the [once] budget moved with the card — Reconfigure is not a zone change');
  finishBattle(h);
});

// ── [Solved] Reconfigure onto Perpetual Construct ───────────────────────
// _passer: "Perpetual Construct will trigger separetly for each of the Mods.
// (1) Mirage Scuttler, (3) Pile of Runes, (4) Bubb are Reconfigured onto
// Perpetual Construct. 3 Triggers land on the stack: Create 1/1, Create 3/3,
// Create 4/4"

// BROKEN today: the engine fires the Construct once, for Bubb (a 4/4); the two
// mods riding along arrive silently ("Reconfigure: 2 mod(s) move along with Bubb").
test('RAQ Reconfigure onto Perpetual Construct: each moved mod is its own trigger — a 4/4, a 3/3 and a 1/1',
  { todo: 'RAQ: Perpetual Construct hears only the moved unit, not the mods riding with it' }, () => {
  const h = new Harness(39303);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  let bubb = -1, pc = -1;
  whiteBox(h, e => {
    bubb = e.spawnUnit(D, 'Bubb', e.homeRegion(D)).id;
    pc = e.spawnUnit(D, 'Perpetual Construct', e.homeRegion(D)).id;
    e.attachMod(e.s.entities[bubb]!, 'A Pile of Runes', D, 'augment');
    e.attachMod(e.s.entities[bubb]!, 'Mirage Scuttler', D, 'augment');
  });
  giveResources(h, D, 'earth', 2);
  giveResources(h, D, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  const tokensBefore = unitsOf(h, D).filter(u => u.token).length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Reconfigure') });
  pick(h, { unit: bubb });
  pick(h, { unit: pc });
  pass(h); pass(h);                                           // Reconfigure resolves
  while (h.state.stack.length) { pass(h); pass(h); }          // the Construct's triggers
  const made = unitsOf(h, D).filter(u => u.token).slice(tokensBefore).map(u => effStats(h, u.id)[0]).sort();
  assert.deepEqual(made, [1, 3, 4], 'one X/X per mod moved, X = that mod\'s cost');
  finishBattle(h);
});

/** answer every open question with `answer` (or its first option) and drain the stack */
function drain(h: Harness, answer?: unknown): void {
  let guard = 60;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    const d = h.state.decision;
    if (d?.pickOrder) h.do({ type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) });
    else if (d) pick(h, answer ?? d.options[0]!.value);
    else { pass(h); pass(h); }
  }
}

/** attack with `col` alone, take no blocks, deal combat damage */
function connect(h: Harness, A: Seat, col: number[]): void {
  h.do({ type: 'declareAttack', seat: A, columns: [col] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: (1 - A) as Seat, blocks: {} });
  pass(h); pass(h);
}

// ── [Solved] Amphivore / Lost Guardian. Bounded Grafts and Ralph explained ──
// _passer: "Order of Effects is 'top to bottom' and then 'top to bottom'
// again … Amphivore with Plodding Pebble and Bellowing Boulder will do: Get
// +1/+1 Counter, Deal 1 damage to each unit, Get +1/+1 Counter, Deal 1 damage
// to each unit, Get +1/+1 Counter, Deal 1 damage to each unit"

test('RAQ Amphivore: a tripled composite runs its grafts top to bottom, then again — counter, damage, counter, damage, counter, damage', () => {
  const h = new Harness(39304);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let amph = -1;
  whiteBox(h, e => {
    amph = e.spawnUnit(A, 'Amphivore', e.homeRegion(A)).id;
    e.attachMod(e.s.entities[amph]!, 'Plodding Pebble', A, 'graft', 0);
    e.attachMod(e.s.entities[amph]!, 'Bellowing Boulder', A, 'graft', 1);
  });
  toNextBattle(h, A);
  const from = h.log.length;
  connect(h, A, [amph]);
  drain(h);
  const beats = h.log.slice(from)
    .filter(l => (/counter/.test(l) && /Amphivore/.test(l)) || /deals 1 to/.test(l))
    .map(l => (/counter/.test(l) ? 'counter' : 'damage'));
  assert.deepEqual(beats, ['counter', 'damage', 'counter', 'damage', 'counter', 'damage'], h.log.slice(from).join('\n'));
  finishBattle(h);
});

// _passer: "On 1st 'top to bottom' control of Ralph will be given to target
// opponent and 3x 1/1s will be created. On 2nd and 3rd 'top to bottom' you
// won't be able to give control … rest of graft still happens."

test('RAQ Amphivore with Ralph grafted: the first pass gives the host away and makes three 1/1s, later passes give nothing, the other graft still runs three times', () => {
  const h = new Harness(39305);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  let amph = -1;
  whiteBox(h, e => {
    amph = e.spawnUnit(A, 'Amphivore', e.homeRegion(A)).id;
    e.attachMod(e.s.entities[amph]!, 'Flame Juggle', A, 'graft', 0);
    e.attachMod(e.s.entities[amph]!, 'Ralph', A, 'graft', 1);
  });
  toNextBattle(h, A);
  const ones = (): number => unitsOf(h, A).filter(u => u.token && u.card !== 'Fireball').length;
  const before = ones();
  connect(h, A, [amph]);
  drain(h, { player: D });
  assert.equal(ent(h, amph)!.controller, D, 'the first pass gave the host — the "me" of a graft — to the opponent');
  assert.equal(ones() - before, 3, 'three 1/1s, once: "If you do" fails on the second and third passes');
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Fireball').length, 9, 'and Flame Juggle still ran all three times');
  finishBattle(h);
});

// ── [Solved] Graft 101. All you need to know about Grafts ───────────────
// _passer's write-up, twelve numbered points plus three worked examples, and
// calebgannon in the discussion. One test per point that the engine can be
// asked about.

const grafts = (h: Harness, seat: Seat): Extract<Action, { type: 'graft' }>[] =>
  legalActions(h.state, seat).filter((a): a is Extract<Action, { type: 'graft' }> => a.type === 'graft');

// 1. "Grafting can only be done during Deployment Phase" — and, in the
// discussion: "grafting is always in deployment even if the card I want to
// use as a graft has haste, right?" / _passer: "Yes. Always in deployment."
test('RAQ Graft 101 point 1: a graft is offered in deployment and never in the haste step or in battle, even for a Haste card', () => {
  const h = new Harness(39306);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let host = -1;
  whiteBox(h, e => { host = e.spawnUnit(A, 'Bellowing Boulder', e.homeRegion(A)).id; });
  give(h, A, 'Molten Upheaval');                              // {Haste} r/1, [Switch1]
  giveResources(h, A, 'fire', 3);
  assert.ok(grafts(h, A).some(a => a.hostId === host), 'deployment: offered');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = A;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone && !h.state.hasteDone[A], 'setup: the haste step is open for the Haste card');
  assert.equal(grafts(h, A).length, 0, 'the haste step: not offered');
  skipHasteStep(h);
  assert.equal(h.state.phase, 'battle');
  assert.equal(grafts(h, A).length, 0, 'battle: not offered');
});

// 2. "You need unit in play which will be target of the Grafts. That unit
// must have it's own Graft Cause"
test('RAQ Graft 101 point 2: only a unit with a graft cause of its own can be grafted onto', () => {
  const h = new Harness(39307);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let cause = -1, plain = -1;
  whiteBox(h, e => {
    cause = e.spawnUnit(A, 'Bellowing Boulder', e.homeRegion(A)).id;   // "When I attack or block, [Switch] …"
    plain = e.spawnUnit(A, 'Bubb', e.homeRegion(A)).id;                // no graft symbol
  });
  give(h, A, 'Flame Juggle');
  giveResources(h, A, 'fire', 2);
  const hosts = new Set(grafts(h, A).map(a => a.hostId));
  assert.ok(hosts.has(cause), 'the Boulder takes grafts');
  assert.ok(!hosts.has(plain), 'Bubb, with no graft cause, does not');
});

// 3. "You can either use Grafts from your Bin or Hand … You still must pay
// the cost and meet Affinity threshold"
test('RAQ Graft 101 point 3: a graft comes from the bin as well as the hand, and only when its cost and affinity are met', () => {
  const h = new Harness(39308);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  whiteBox(h, e => { e.spawnUnit(A, 'Bellowing Boulder', e.homeRegion(A)); });
  h.state.players[A]!.bin.push('Flame Juggle');               // r/2
  assert.ok(!grafts(h, A).some(a => a.from === 'bin'), 'no fire: not offered');
  giveResources(h, A, 'water', 2);
  assert.ok(!grafts(h, A).some(a => a.from === 'bin'), 'two mana but no fire affinity: not offered');
  giveResources(h, A, 'fire', 1);
  assert.ok(grafts(h, A).some(a => a.from === 'bin'), 'cost and affinity met: offered from the bin');
});

// 4. "Spells or Spell-Units with Graft icon … can be played and their effect
// resolves once, but later can be used as Graft from Bin … If LL unit dies,
// you can use him during Deployment as Graft"
test('RAQ Graft 101 point 4: a dead Leaping Lillik is a graft from the bin', () => {
  const h = new Harness(39309);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  whiteBox(h, e => { e.spawnUnit(A, 'Bellowing Boulder', e.homeRegion(A)); });
  h.state.players[A]!.bin.push('Leaping Lillik');             // bb/5
  giveResources(h, A, 'water', 5);
  assert.ok(grafts(h, A).some(a => a.from === 'bin' && h.state.players[A]!.bin[a.index] === 'Leaping Lillik'));
});

// 5. "Applying Graft is 'targeting' effect, so if you try to Graft something
// underneath the Mohruung, he will trigger first"
test('RAQ Graft 101 point 5: grafting onto Mohruung targets it, so it makes its Crystal', () => {
  const h = new Harness(39310);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let mohr = -1;
  whiteBox(h, e => { mohr = e.spawnUnit(A, 'Mohruung', e.homeRegion(A)).id; });
  giveResources(h, A, 'fire', 2);
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Flame Juggle'), hostId: mohr, position: 0 });
  drain(h);
  assert.ok(tokensOf(h, A).some(t => t.card === 'Crystal' && t.x === 2), 'Mohruung heard the graft as a target');
});

// 6. "When attaching Grafts, you ignore everything that is written before the
// Graft symbol" — Omniwield Evoker's "[three]:" is not paid when it rides
// under another cause.
test('RAQ Graft 101 point 6: a grafted Omniwield Evoker adds its counter to the host trigger and charges nothing', () => {
  const h = new Harness(39311);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let boulder = -1;
  whiteBox(h, e => {
    boulder = e.spawnUnit(A, 'Bellowing Boulder', e.homeRegion(A)).id;
    e.attachMod(e.s.entities[boulder]!, 'Omniwield Evoker', A, 'graft', 0);
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder]] });
  drain(h);
  assert.equal(ent(h, boulder)!.counters, 1,
    'the Boulder got the +1/+1 counter — and A has no mana at all, so no [three] was paid');
  finishBattle(h);
});

// 8. "Triggered/Activated Graft is SINGLE effect on the stack … even big graft
// doing multiple things can be negated by single Hush Mush"
test('RAQ Graft 101 point 8: the host trigger and every graft under it are one stack item, and one negate stops all of it', () => {
  const h = new Harness(39312);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  let boulder = -1;
  whiteBox(h, e => {
    boulder = e.spawnUnit(A, 'Bellowing Boulder', e.homeRegion(A)).id;     // 3/4: 1 damage to each unit
    e.attachMod(e.s.entities[boulder]!, 'Overbloom', A, 'graft', 0);        // + target unit gains +7/+7
  });
  giveResources(h, D, 'wood', 2);                             // Hush Mush gg/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder]] });
  while (h.state.decision) pick(h, { unit: boulder });        // Overbloom's target, declared on the way to the stack
  assert.equal(h.state.stack.length, 1, 'ONE stack item');
  const item = h.state.stack[0]!.id;
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Hush Mush') });
  pick(h, { stack: item });
  drain(h);
  assert.equal(ent(h, boulder)!.damage, 0, 'no 1 damage to each unit');
  assert.deepEqual(effStats(h, boulder), [3, 4], 'and no +7/+7');
  finishBattle(h);
});

// 9. "Graft Effect will be resolved from top to bottom. (Eg. Under Mohruung
// you can put Overbloom's graft first and then 2nd Graft from Spewing
// Mushroom. This way when Mohruung triggers you can apply '+7/+7 until
// regroup' to him and then get Poison 8."
function mohruungPoison(order: ['Overbloom', 'Spewing Mushroom'] | ['Spewing Mushroom', 'Overbloom'], seed: number): number {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let mohr = -1;
  whiteBox(h, e => {
    mohr = e.spawnUnit(A, 'Mohruung', e.homeRegion(A)).id;                  // 1/5
    e.attachMod(e.s.entities[mohr]!, order[0], A, 'graft', 0);
    e.attachMod(e.s.entities[mohr]!, order[1], A, 'graft', 1);
  });
  giveResources(h, A, 'fire', 1);
  // a third graft targets Mohruung (point 5), which triggers the composite
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Molten Upheaval'), hostId: mohr, position: 2 });
  drain(h, { unit: mohr });                                   // Overbloom's +7/+7 goes on Mohruung
  return tokensOf(h, A).find(t => t.card === 'Poison')?.x ?? -1;
}
test('RAQ Graft 101 point 9: grafts resolve top to bottom — Overbloom above Spewing Mushroom under Mohruung makes a Poison 8, and below it a Poison 1', () => {
  assert.equal(mohruungPoison(['Overbloom', 'Spewing Mushroom'], 39313), 8, '+7/+7 first, then Poison X at power 8');
  assert.equal(mohruungPoison(['Spewing Mushroom', 'Overbloom'], 39314), 1, 'Poison X first, at power 1');
});

// 10. "You cannot change the order of the Grafts already applied, but new
// Grafts can be 'slided' between existing ones."
test('RAQ Graft 101 point 10: a new graft slides between two already applied, and theirs is the only order offered to change', () => {
  const h = new Harness(39315);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let host = -1;
  whiteBox(h, e => { host = e.spawnUnit(A, 'Bellowing Boulder', e.homeRegion(A)).id; });
  giveResources(h, A, 'fire', 4);
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Flame Juggle'), hostId: host, position: 0 });
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Ignis Sprite'), hostId: host, position: 1 });
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Molten Upheaval'), hostId: host, position: 1 });
  assert.deepEqual(ent(h, host)!.mods.map(m => ent(h, m)!.card), ['Flame Juggle', 'Molten Upheaval', 'Ignis Sprite']);
  assert.ok(!legalActions(h.state, A).some(a => /reorder|moveGraft|swapGraft/i.test(a.type)), 'no action moves a graft already applied');
});

// 11. "{graft icon} [cost]: Effect … puts Additional Cost which is
// non-optional (you MUST pay it, you can't opt out) and if you can't pay it
// … then the whole Graft Effect won't go on the stack."
// BROKEN today: engine.ts castCost collection treats a grafted [cost] as an
// opt-in rider ("grafted riders are opt-in" — no ruling cited) and skips only
// that part; the rest of the composite resolves.
test('RAQ Graft 101 point 11: an unpayable [cost] graft keeps the whole composite off the stack — the host and the other grafts too',
  { todo: 'RAQ: an unpayable grafted [cost] skips only its own part' }, () => {
  const h = new Harness(39316);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let boulder = -1;
  whiteBox(h, e => {
    boulder = e.spawnUnit(A, 'Bellowing Boulder', e.homeRegion(A)).id;
    e.attachMod(e.s.entities[boulder]!, 'Flame Juggle', A, 'graft', 0);
    e.attachMod(e.s.entities[boulder]!, 'Darkblast', A, 'graft', 1);       // [Discard a card] I deal 5 …
  });
  toNextBattle(h, A);
  h.state.players[A]!.hand = [];                              // nothing to discard
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder]] });
  drain(h);
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Fireball').length, 0, 'Flame Juggle did not run');
  assert.equal(ent(h, boulder)!.damage, 0, 'and the Boulder\'s own 1 damage to each unit did not either');
  finishBattle(h);
});

// BROKEN today: the cost question offers "Don't pay — skip this effect".
test('RAQ Graft 101 point 11: a payable [cost] graft must be paid — no opting out of it',
  { todo: 'RAQ: a grafted [cost] can be declined' }, () => {
  const h = new Harness(39317);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  let boulder = -1;
  whiteBox(h, e => {
    boulder = e.spawnUnit(A, 'Bellowing Boulder', e.homeRegion(A)).id;
    e.attachMod(e.s.entities[boulder]!, 'Darkblast', A, 'graft', 0);
  });
  toNextBattle(h, A);
  h.state.players[A]!.hand = ['Geode'];
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder]] });
  const seen: string[] = [];
  let guard = 10;
  while (h.state.decision && guard-- > 0) {
    seen.push(...h.state.decision.options.map(o => o.label));
    const pay = h.state.decision.options.find(o => !/decline|don.t|skip|no /i.test(o.label));
    pick(h, pay ? pay.value : { player: D });
  }
  assert.ok(!seen.some(l => /decline|don.t pay|skip/i.test(l)), `no way to decline the discard: ${seen.join(' | ')}`);
  assert.equal(h.state.players[A]!.hand.length, 0, 'the card was discarded');
  finishBattle(h);
});

// 12. "If 'top' Unit has Bounded Graft … it can only trigger once per turn …
// if 'top' Unit has Unbounded Graft, it can be triggered/activated multiple
// times … Bounded Grafts underneath will be included only on 1st resolution."
// Worked example: "If you Activate this Omniwield Evoker … When Activated
// again, it will ommit the 'Creation of Robot X' part since this is Bounded".
test('RAQ Graft 101 point 12: an unbounded host activated twice carries its bounded graft only the first time', () => {
  const h = new Harness(39318);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let ev = -1;
  whiteBox(h, e => {
    ev = e.spawnUnit(A, 'Omniwield Evoker', e.homeRegion(A)).id;
    e.attachMod(e.s.entities[ev]!, 'Flame Juggle', A, 'graft', 0);         // [Switch1] Create three Fireball 1
  });
  giveResources(h, A, 'metal', 6);
  h.do({ type: 'activateAbility', seat: A, entityId: ev, abilityIndex: 0 });
  drain(h);
  assert.equal(ent(h, ev)!.counters, 1);
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Fireball').length, 3, 'first activation: the bounded graft rides');
  h.do({ type: 'activateAbility', seat: A, entityId: ev, abilityIndex: 0 });
  drain(h);
  assert.equal(ent(h, ev)!.counters, 2, 'second activation: the host part runs again');
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Fireball').length, 3, 'and the bounded graft does not');
});

test('RAQ Graft 101 point 12: a bounded host triggers once per turn, so an unbounded graft under it happens once', () => {
  const h = new Harness(39319);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let mohr = -1;
  whiteBox(h, e => {
    mohr = e.spawnUnit(A, 'Mohruung', e.homeRegion(A)).id;                  // When I become targeted, [Switch1] Crystal 2
    e.attachMod(e.s.entities[mohr]!, 'Ignis Sprite', A, 'graft', 0);        // [Switch] Create a Fireball 1
  });
  giveResources(h, A, 'fire', 4);
  for (let i = 0; i < 2; i++) {
    h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Molten Upheaval'), hostId: mohr, position: 1 + i });
    drain(h);
  }
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Crystal').length, 1, 'Mohruung answered the first targeting only');
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Fireball').length, 1, 'and the unbounded Ignis graft rode it once');
});

// Worked example: "Plodding Pebble received damage and is triggered. His
// effect wants to go on the stack, so player must at that time delcare
// targets for all things … If there wasn't Voltwrath Behemoth in the first
// place, player would still need to target something to be deleted"
test('RAQ Graft 101 Plodding Pebble example: with no enemy on the board the grafted delete must still take one of your own units', () => {
  const h = new Harness(39320);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let pebble = -1;
  whiteBox(h, e => {
    pebble = e.spawnUnit(A, 'Plodding Pebble', e.homeRegion(A)).id;          // When I am dealt damage, [Switch1] counter
    e.attachMod(e.s.entities[pebble]!, 'Leaping Lillik', A, 'graft', 0);    // [Switch1] Delete target unit
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[pebble]] });   // into a region with nobody in it
  let fire = -1;
  whiteBox(h, e => { fire = e.createSpellToken(A, 'Fireball', 1, e.s.battle!.region).id; });
  passTo(h, A);
  h.do({ type: 'castSpellToken', seat: A, entityId: fire });
  pick(h, { unit: pebble });                                  // a Fireball 1 at the Pebble
  let guard = 6;
  while (!h.state.decision && h.state.stack.length && guard-- > 0) { pass(h); pass(h); }
  const dec = h.state.decision;
  assert.ok(dec, 'the target is asked for as the trigger goes on the stack');
  const values = dec!.options.map(o => JSON.stringify(o.value));
  assert.ok(values.includes(JSON.stringify({ unit: pebble })), 'your own unit is a legal target');
  assert.ok(!dec!.options.some(o => (o.value as { doneTargets?: true })?.doneTargets), 'and there is no way to aim at nothing');
});

// calebgannon, on whether a bounded graft can run twice in a turn: "There are
// some examples where this could happen … Play flame juggle, play engorged
// caudex, graft flame juggle onto the caudex, play a unit and trigger the
// caudex"; _passer: "play Caudex, play any unit, get card, recall Caudex,
// play him again, play unit, get 2nd card" — calebgannon: "Yes that works".
test('RAQ Graft 101 calebgannon: a recalled and replayed Engorged Caudex is a new object, and its [Switch1] draws again the same turn', () => {
  const h = new Harness(39321);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  giveResources(h, A, 'wood', 10);
  giveResources(h, A, 'fire', 4);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Engorged Caudex') });
  drain(h);
  const hand0 = handSize(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Ignis Sprite') });
  drain(h);
  assert.equal(handSize(h, A), hand0 + 1, 'the first nontoken ally drew');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Ignis Sprite') });
  drain(h);
  assert.equal(handSize(h, A), hand0 + 1, 'the second did not — [Switch1]');
  const caudex = unitsOf(h, A).find(u => u.card === 'Engorged Caudex')!.id;
  whiteBox(h, e => e.recall(e.s.entities[caudex]!));
  h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.indexOf('Engorged Caudex') });
  drain(h);
  const hand1 = handSize(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Ignis Sprite') });
  drain(h);
  assert.equal(handSize(h, A), hand1 + 1, 'the replayed Caudex is a new object and draws again');
});

// ── [Solved] Download. What is a token (and what is not) ────────────────
// _passer: "1. Fireball 'in play' / 'in Region' ✅  2. Fireball effect 'on the
// stack' ✅  3. 8/8 unit from Spawntender (or any X/X unit created by Awoken
// Tomb or similiar) ✅  4. Copy of Echo of Despair ✅ … 6. Copy of a spell
// resulting from Earthbound Replicator ❌  7. Copy of a spell resulting from
// Maelstrom Charger ❌"

/** A attacks into D's region; D has an 8/8 from Spawntender and an uncast Fireball there */
function downloadBoard(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'water', 7);                            // Spawntender bbb/7
  giveResources(h, A, 'metal', 2);                            // Download mm/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Spawntender') });
  drain(h);
  const eight = unitsOf(h, D).find(u => u.token && effStats(h, u.id)[0] === 8)!.id;
  let fire = -1;
  whiteBox(h, e => { fire = e.createSpellToken(D, 'Fireball', 1, e.s.battle!.region).id; });
  return { h, A, D, atk, eight, fire };
}
const offeredUnits = (h: Harness): number[] =>
  h.state.decision!.options.map(o => (o.value as { unit?: number }).unit).filter((u): u is number => u !== undefined);

test('RAQ Download: a Fireball in the region and an X/X unit token are both tokens it can take', () => {
  const { h, A, eight, fire } = downloadBoard(39322);
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Download') });
  const units = offeredUnits(h);
  assert.ok(units.includes(fire), 'the Fireball sitting in the region');
  assert.ok(units.includes(eight), 'the 8/8 Spawntender made');
  finishBattle(h);
});

// BROKEN today: a spell token that has been CAST is a stack item, and the
// 'token' target family reaches units and uncast spell tokens only.
test('RAQ Download: a Fireball already cast and on the stack is a token it can take',
  { todo: 'RAQ: Download cannot target a spell token on the stack' }, () => {
  const { h, A, D, atk, fire } = downloadBoard(39323);
  passTo(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: fire });
  pick(h, { unit: atk });
  const item = h.state.stack[h.state.stack.length - 1]!.id;
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Download') });
  const vals = h.state.decision!.options.map(o => JSON.stringify(o.value));
  assert.ok(vals.includes(JSON.stringify({ stack: item })) || vals.includes(JSON.stringify({ unit: fire })),
    `the Fireball on the stack is offered: ${vals.join(' ')}`);
  finishBattle(h);
});

test('RAQ Download: a copy Echo of Despair makes of itself is a token', () => {
  const h = new Harness(39324);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const echo = spawn(h, A, 'Echo of Despair');                // after combat, if a player lost life, copy me
  toNextBattle(h, A);
  connect(h, A, [echo]);
  drain(h);
  const copies = unitsOf(h, A).filter(u => u.card === 'Echo of Despair' && u.id !== echo);
  assert.equal(copies.length, 1, 'setup: the copy was made');
  assert.ok(copies[0]!.token, 'and it is a token — what Download and Arcane Echo can target');
  finishBattle(h);
});

test('RAQ Download: a spell copy made by Earthbound Replicator is not a token, so Download cannot take it', () => {
  const h = new Harness(39325);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const rep = spawn(h, D, 'Earthbound Replicator');
  giveResources(h, D, 'fire', 2);                             // Channeled Boon rr/2
  giveResources(h, A, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channeled Boon') });
  pick(h, { unit: rep });
  pass(h); pass(h);                                           // the Replicator's trigger resolves
  while (h.state.decision) pick(h, false);                    // keep the copy's target
  const copy = h.state.stack.find(i => i.copy);
  assert.ok(copy, 'setup: the Replicator copied the Boon');
  passTo(h, A);
  const dl = give(h, A, 'Download');
  assert.ok(!legalActions(h.state, A).some(a => a.type === 'playCard' && a.handIndex === dl),
    'with the copy the only thing on the stack, Download has nothing to take — the copy is not a token');
  finishBattle(h);
});

// ── [Solved] Earthbound Replicator. No, it's not infinity ───────────────
// _passer: "1. Earthbound will trigger for any player targeting him with
// played spell. So both you and enemy can benefit off from it. … 3. Enemy can
// remove him easily with Fireballs / Poisons and get copy of them."

test('RAQ Earthbound Replicator: an enemy spell aimed at it is copied for the ENEMY', () => {
  const h = new Harness(39326);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const rep = spawn(h, D, 'Earthbound Replicator');
  giveResources(h, A, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: rep });
  pass(h); pass(h);                                           // the Replicator's trigger resolves
  while (h.state.decision) pick(h, false);
  const copy = h.state.stack.find(i => i.copy);
  assert.ok(copy, 'the enemy\'s spell was copied');
  assert.equal(copy!.controller, A, '"they copy it" — the copy is the caster\'s, not the Replicator controller\'s');
  finishBattle(h);
});

test('RAQ Earthbound Replicator: a Fireball token cast at it is a played spell and is copied', () => {
  const h = new Harness(39327);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const rep = spawn(h, D, 'Earthbound Replicator');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fire = -1;
  whiteBox(h, e => { fire = e.createSpellToken(A, 'Fireball', 1, e.s.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: A, entityId: fire });
  pick(h, { unit: rep });
  pass(h); pass(h);                                           // the Replicator's trigger resolves
  while (h.state.decision) pick(h, false);
  assert.ok(h.state.stack.some(i => i.copy), 'R305: a cast spell token is played, so the Replicator copies it');
  finishBattle(h);
});

// ── [Solved] Nectar Ridge vs Sandstone Defender & Wisp Weaver ───────────
// _passer: "For Sandstone Defender it means that 1/1 unit will spawn already
// as 1/3 and it will trigger Nectar Ridge Oracle. For Wisp Weaver it means
// that 0/1 Wisp (which would trigger Nectar Ridge Oracle), will spawn already
// as 2/2 and WON'T trigger … This works the same for Statis Ability of
// Animated Spark"

// BROKEN today: the spawned units end up 1/3, but the Oracle's "defense >
// power" read at the spawn event sees them before Sandstone's static does
// (a nontoken 1/1 — Ignis Sprite — fails the same way; a printed 0/2 draws).
test('RAQ Nectar Ridge: under Sandstone Defender a 1/1 spawns already a 1/3, so the Oracle draws',
  { todo: 'RAQ: a spawn trigger reads the new unit before your statics apply to it' }, () => {
  const h = new Harness(39328);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Nectar Ridge Oracle');
  spawn(h, A, 'Sandstone Defender');
  giveResources(h, A, 'wood', 2);
  const hand0 = handSize(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Accelerated Germination') });   // two 1/1s
  drain(h);
  assert.ok(unitsOf(h, A).filter(u => u.token).every(u => effStats(h, u.id).join('/') === '1/3'), 'the 1/1s are 1/3s');
  assert.equal(handSize(h, A), hand0 + 1, 'the Oracle saw a 1/3 spawn and drew (once — [once])');
});

test('RAQ Nectar Ridge: under Infernal Wispweaver a 0/1 Wisp spawns already a 2/2, so the Oracle does not draw', () => {
  const h = new Harness(39329);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Nectar Ridge Oracle');
  spawn(h, A, 'Infernal Wispweaver');                         // your wisps gain +2/+1
  const hand0 = handSize(h, A);
  whiteBox(h, e => { e.createToken({ form: 'unit', name: 'Wisp', x: 0, seat: A, region: e.homeRegion(A) }); });
  drain(h);
  const wisp = unitsOf(h, A).find(u => u.card === 'Wisp');
  assert.ok(wisp, 'setup: a Wisp');
  assert.deepEqual(effStats(h, wisp!.id), [2, 2]);
  assert.equal(handSize(h, A), hand0, 'it never was a 0/1 — no draw');
});

test('RAQ Nectar Ridge: Animated Spark statics a unit that spawns mid-battle from the moment it spawns', () => {
  const h = new Harness(39330);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Animated Spark');                               // your units +1/+0 per nontoken spell this battle
  giveResources(h, D, 'water', 7);                            // Spawntender bbb/7, a {Battle} spell
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Spawntender') });
  drain(h);
  const made = unitsOf(h, D).filter(u => u.token);
  assert.equal(made.length, 1, 'setup: the 8/8 spawned');
  assert.deepEqual(effStats(h, made[0]!.id), [9, 8], 'spawned already +1/+0 for the spell that made it');
  finishBattle(h);
});

// ── [Asked] Suppression Field & Formless vs Gaining Attributes/Abilities ──
// ── [Solved] Monke & Transmogrifant vs Suppression Field & Formless ──────
// calebgannon: "Suppression field just removes attributes from the time it
// was played, so anything after that will still apply … Also work mentioning
// these would apply loss of attributes to the entire column, so if bubb was in
// colum with a piercing unit before suppression field was played, the column
// would lose piercing."
// _passer: "If Suppresion Field/Formless has targeted Bubb and resolved, he
// loses Unaware, but later on you can: play Protective Adaptations to give him
// Piercing, attach Powerful virus under him and he will be Powerful …"

/** A attacks with `col`; D answers with Suppression Field on `target` and it resolves */
function suppressed(seed: number, col: (h: Harness, A: Seat) => number[], targetAt: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const units = col(h, A);
  giveResources(h, D, 'metal', 1);                            // Suppression Field m/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [units] });
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Suppression Field') });
  pick(h, { unit: units[targetAt]! });
  drain(h);
  return { h, A, D, units };
}
const colAttrs = (h: Harness, ids: number[]): Set<string> => { let s = new Set<string>(); whiteBox(h, e => { s = e.colAttrs(ids); }); return s; };

// BROKEN today: only the target is stamped. Formless was widened to its
// column by R293 because it PRINTS "(This removes attributes from its
// column.)"; Suppression Field prints no such reminder, but calebgannon's
// answer names both cards ("these would apply loss of attributes to the
// entire column").
test('RAQ Suppression Field: it takes the attributes of the target\'s whole column — Bubb beside a Piercing unit, and the column loses Piercing',
  () => {
  const { h, units } = suppressed(39331, (h, A) => [spawn(h, A, 'Bubb'), spawn(h, A, 'Bumblecrab')], 0);
  const col = colAttrs(h, units);
  assert.ok(!col.has('Piercing'), `the column lost the Crab's Piercing (column has ${[...col]})`);
  assert.ok(!col.has('Unaware'), 'and Bubb\'s Unaware');
  finishBattle(h);
});

test('RAQ Suppression Field: aimed at either unit of a column, the whole column loses both — Bubb with Nebula Drifter, aimed at the Drifter',
  () => {
  const { h, units } = suppressed(39332, (h, A) => [spawn(h, A, 'Bubb'), spawn(h, A, 'Nebula Drifter')], 1);
  const col = colAttrs(h, units);
  assert.ok(!col.has('Unaware') && !col.has('Flying'), `no Unaware, no Flying (column has ${[...col]})`);
  finishBattle(h);
});

// BROKEN today (R62's veto): "loses ALL attributes" is implemented as a layer
// that nothing switches back on, so a grant AFTER the field resolved is
// stripped too. calebgannon says the opposite. ⚠ R293's owner quote ("If you
// remove the attributes from a guy for the turn, it wouldn't make sense for it
// to get them back") is about the SAME attributes coming back, and is not
// obviously this case — the owner should rule.
test('RAQ Suppression Field: an attribute granted after it resolved still applies — Protective Adaptations gives the suppressed Bubb Piercing',
  () => {
  const { h, A, units } = suppressed(39333, (h, A) => [spawn(h, A, 'Bubb')], 0);
  giveResources(h, A, 'water', 1);                            // Protective Adaptations b/1
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Protective Adaptations') });
  pick(h, { unit: units[0]! });
  drain(h);
  assert.ok(!ownAttrs(h, units[0]!).has('Unaware'), 'the Unaware it had is still gone');
  assert.ok(ownAttrs(h, units[0]!).has('Piercing'), 'the Piercing it gained afterwards is there');
  finishBattle(h);
});

test('RAQ Suppression Field: a Powerful virus attached after it resolved makes the suppressed Bubb Powerful',
  () => {
  const { h, A, units } = suppressed(39334, (h, A) => [spawn(h, A, 'Bubb')], 0);
  giveResources(h, A, 'earth', 2);                            // Chitin Shredder ee/2, a Virus
  passTo(h, A);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostId: units[0]! });
  drain(h);
  assert.ok(ent(h, units[0]!)!.mods.some(m => ent(h, m)!.card === 'Chitin Shredder'), 'setup: the virus is on Bubb');
  assert.ok(ownAttrs(h, units[0]!).has('Powerful'));
  finishBattle(h);
});

// _passer: "Monke and Transmogrifant have Static Abilities meaning they work
// continuously and affect new units entering play (eg. Chitin Shredder
// entering through Insidious Invitation would lose Powerful). But if any unit
// in play later gains Attribute or Ability, then timestamps takes precedence
// and this new Attribute/Ability is NOT affected … Once Monke / Transmogrifant
// are removed from play, all other units regain their Abilities and
// Attributes." (Monke has been errata'd to "If I spawned this turn, … during
// battle" since; Transmogrifant is unchanged and carries the claim.)

test('RAQ Transmogrifant: a unit that enters play under it has no attributes, and gets them back when Transmogrifant leaves', () => {
  const h = new Harness(39335);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tm = spawn(h, A, 'Transmogrifant');
  const shredder = spawn(h, A, 'Chitin Shredder');            // {Powerful}
  assert.ok(!ownAttrs(h, shredder).has('Powerful'), 'it entered under the static and lost Powerful');
  whiteBox(h, e => e.recall(e.s.entities[tm]!));
  assert.ok(ownAttrs(h, shredder).has('Powerful'), 'with Transmogrifant gone, Powerful is back');
});

// BROKEN today: the static vetoes the later grant as well.
test('RAQ Transmogrifant: an attribute a unit gains AFTER it is in play is not affected — a Powerful virus attached later works',
  () => {
  const h = new Harness(39336);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Transmogrifant');
  const bubb = spawn(h, A, 'Bubb');
  giveResources(h, A, 'earth', 2);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostId: bubb });
  drain(h);
  assert.ok(ent(h, bubb)!.mods.some(m => ent(h, m)!.card === 'Chitin Shredder'), 'setup: the virus is on Bubb');
  assert.ok(ownAttrs(h, bubb).has('Powerful'), 'the later grant has the later timestamp');
});

// ── [Solved] Recall Spell Token / Token unit. Token Unit dying ──────────
// _passer: "1. Token Spell technically enter your hand if you Recall them and
// are instantly erased (this matter for the purpose of triggers like Xenopod
// Progenitator or Rider of the Tides)."

// BROKEN today: Cosmic Reversal says "recalls Fireball 1 — token: erased" and
// the token never passes through the hand, so no hand-entry watcher hears it.
// (A recalled UNIT token does pass through: 15-water-b, R69.)
test('RAQ Recall Spell Token: a Fireball token recalled off the stack enters its controller hand — Rider of the Tides hears it — and is erased',
  { todo: 'RAQ: a recalled spell token is erased without entering the hand' }, () => {
  const h = new Harness(39337);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const rider = spawn(h, D, 'Rider of the Tides');            // 2/2: a card enters a hand during battle → +2/+2
  giveResources(h, D, 'water', 2);                            // Cosmic Reversal bb/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fire = -1;
  whiteBox(h, e => { fire = e.createSpellToken(A, 'Fireball', 1, e.s.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: A, entityId: fire });
  pick(h, { unit: rider });
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Cosmic Reversal') });
  drain(h);
  assert.ok(!h.state.players[A]!.hand.includes('Fireball'), 'the token did not stay in the hand');
  assert.deepEqual(effStats(h, rider), [4, 4], 'but it entered one: Rider of the Tides gained +2/+2');
  finishBattle(h);
});

// ── [Solved] Are counters cumulative or distinct? ───────────────────────
// Answered by a player (nyarlathotep8457), not by the designer or a [Solved]
// write-up: "If a unit has both a +1/+1 and -1/-1 counter on it they both get
// removed … The pestilent mycelion would still see that you placed a -1/-1
// counter and trigger." The Manual backs the cancelling (Entity.counters is
// net for that reason).

test('RAQ counters: a -1/-1 counter put on a unit with +1/+1 counters cancels one, and Pestilent Mycelion still hears the -1/-1', () => {
  const h = new Harness(39338);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Pestilent Mycelion');                          // whenever -1/-1 counters are put on a unit, each opponent loses 1
  const u = spawn(h, D, 'Good Whale');
  whiteBox(h, e => e.addCounters(e.entity(u)!, 2, D));
  toNextBattle(h, A);                                         // R25: the life loss needs an opponent present
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const life = h.state.players[A]!.life;
  whiteBox(h, e => e.addCounters(e.entity(u)!, -1, D));
  drain(h);
  assert.equal(ent(h, u)!.counters, 1, 'one +1/+1 left: they cancelled pairwise');
  assert.equal(h.state.players[A]!.life, life - 1, 'and the placement of a -1/-1 still triggered the Mycelion');
  finishBattle(h);
});

test('RAQ counters: after the cancelling the unit has no -1/-1 counter, so Sporebloom Siren does not delete it', () => {
  const h = new Harness(39339);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const siren = spawn(h, A, 'Sporebloom Siren');              // When I die, delete all units with -1/-1 counters on them
  const u = spawn(h, A, 'Good Whale');
  whiteBox(h, e => { e.addCounters(e.entity(u)!, 2, A); e.addCounters(e.entity(u)!, -1, A); });
  whiteBox(h, e => e.destroy(e.entity(siren)!, 'dies'));
  drain(h);
  assert.ok(ent(h, u), 'the Whale, at a net +1, was not deleted');
});

// ── [Solved & Expanding?] Borrower of Forms - The weird interactions ────
// _passer, compiling calebgannon ("it inherits all of the combined text").

/** cast Borrower of Forms for A at `target` (in battle) and resolve it */
function borrow(h: Harness, A: Seat, target: number): number {
  giveResources(h, A, 'metal', 7);
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: target });
  drain(h);
  return unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!.id;
}

test('RAQ Borrower of Forms: a mod attached to it after it resolved makes it Unstable', () => {
  const h = new Harness(39340);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, whale);
  giveResources(h, A, 'earth', 2);
  passTo(h, A);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostId: bof });
  drain(h);
  let unstable = false;
  whiteBox(h, e => { unstable = e.isUnstable(e.entity(bof)!); });
  assert.ok(unstable, 'modded, so Unstable');
  finishBattle(h);
});

test('RAQ Borrower of Forms: recalled, it goes back to the hand as Borrower of Forms', () => {
  const h = new Harness(39341);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, whale);
  whiteBox(h, e => e.recall(e.s.entities[bof]!));
  assert.ok(h.state.players[A]!.hand.includes('Borrower of Forms'), 'the card in hand is the Borrower');
  assert.ok(!h.state.players[A]!.hand.includes('Good Whale') && !h.state.players[D]!.hand.includes('Good Whale'),
    'the Whale was erased when the Borrower resolved and comes back to nobody');
  finishBattle(h);
});

test('RAQ Borrower of Forms: copying a Robot token makes a nontoken unit, which Download cannot take', () => {
  const h = new Harness(39342);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  let robot = -1;
  whiteBox(h, e => { robot = e.spawnUnit(D, 'Robot', e.homeRegion(D), { token: true, counters: 3 }).id; });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, robot);
  assert.equal(ent(h, bof)!.token, undefined, 'the Borrower is a card, whatever it copied');
  giveResources(h, D, 'metal', 2);
  passTo(h, D);
  const dl = give(h, D, 'Download');
  const plays = legalActions(h.state, D).filter(a => a.type === 'playCard' && a.handIndex === dl);
  if (plays.length) {
    h.do(plays[0]!);
    assert.ok(!h.state.decision!.options.some(o => (o.value as { unit?: number }).unit === bof), 'not a token to Download');
  }
  finishBattle(h);
});

test('RAQ Borrower of Forms: a Borrower that copied an [Augment] unit cannot be the first target of Reconfigure', () => {
  const h = new Harness(39343);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const bubb = spawn(h, D, 'Bubb');                           // [Augment] {Unaware}
  const host = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk, host]] });
  const bof = borrow(h, A, bubb);
  giveResources(h, A, 'earth', 2);
  giveResources(h, A, 'metal', 2);
  passTo(h, A);
  const rc = give(h, A, 'Reconfigure');
  if (legalActions(h.state, A).some(a => a.type === 'playCard' && a.handIndex === rc)) {
    h.do({ type: 'playCard', seat: A, handIndex: rc });
    assert.ok(!h.state.decision!.options.some(o => (o.value as { unit?: number }).unit === bof),
      '"True BoFy doesn\'t have :augment: symbol on him"');
  }
  finishBattle(h);
});

// BROKEN today: Cosmic Reversal finds spell units by the PRINTED card
// (g.card(u.card).kind), and a mimicking Borrower's printed card is still a
// Spell Unit.
test('RAQ Borrower of Forms: while it mimics a unit it is not a spell unit, so Cosmic Reversal leaves it in play',
  { todo: 'RAQ: Cosmic Reversal recalls a Borrower of Forms that is mimicking a unit' }, () => {
  const h = new Harness(39344);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, whale);
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Cosmic Reversal') });
  drain(h);
  assert.ok(ent(h, bof), 'the Borrower, a Good Whale for all purposes, stayed in play');
  finishBattle(h);
});

// "As Caleb said 'it inherits all of the combined text'" — the copied grafts
// included (and R118 ruling 2, the owner: "Inherit the mods text").
// BROKEN today: the Borrower's attack runs the Boulder's own trigger and drops
// the grafted Flame Juggle — the composite is built from mod ENTITIES, and a
// copy carries none.
test('RAQ Borrower of Forms: a Borrower that copied a Bellowing Boulder with Flame Juggle grafted runs the whole copied composite',
  { todo: 'RAQ: a copy of a grafted unit runs the host trigger without its grafts' }, () => {
  const h = new Harness(39346);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  let boulder = -1;
  whiteBox(h, e => {
    boulder = e.spawnUnit(D, 'Bellowing Boulder', e.homeRegion(D)).id;
    e.attachMod(e.s.entities[boulder]!, 'Flame Juggle', D, 'graft', 0);
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, boulder);
  finishBattle(h);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bof]] });
  drain(h);
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Fireball').length, 3, 'the copied Flame Juggle ran');
  assert.ok(h.log.some(l => /deals 1 to/.test(l)), 'and so did the Boulder\'s own 1 to each unit');
  finishBattle(h);
});

// "If my BoFy copied some Graft unit, can I attach more grafts to it? Yes,
// BUT only 'underneath' original copied grafts."
// BROKEN today, a step earlier than the ordering: apply.ts asks
// graftCauseIndex(host.card) — the PRINTED card — and Borrower of Forms
// prints no graft cause, whatever face it wears, so no graft is offered.
test('RAQ Borrower of Forms: a graft added to a Borrower that copied a graft stack resolves below the copied grafts',
  { todo: 'RAQ: a Borrower that copied a graft cause cannot be grafted onto (printed-card host check)' }, () => {
  const h = new Harness(39345);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  let boulder = -1;
  whiteBox(h, e => {
    boulder = e.spawnUnit(D, 'Bellowing Boulder', e.homeRegion(D)).id;
    e.attachMod(e.s.entities[boulder]!, 'Flame Juggle', D, 'graft', 0);
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, boulder);
  finishBattle(h);
  // next deployment: graft Overbloom onto the Borrower, asking for the TOP slot
  giveResources(h, A, 'wood', 2);
  give(h, A, 'Overbloom');
  const grafts0 = grafts(h, A).filter(a => a.hostId === bof);
  assert.ok(grafts0.length, 'setup: the Borrower takes grafts (it copied a graft cause)');
  const top = grafts0.find(a => a.position === 0);
  h.do(top ?? grafts0[0]!);
  toNextBattle(h, A);
  const from = h.log.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[bof]] });
  drain(h, { unit: bof });
  const lines = h.log.slice(from);
  const juggle = lines.findIndex(l => /creates a Fireball/.test(l));
  const bloom = lines.findIndex(l => /\+7\/\+7/.test(l));
  assert.ok(juggle !== -1 && bloom !== -1, `setup: both ran\n${lines.join('\n')}`);
  assert.ok(juggle < bloom, 'the copied Flame Juggle runs before the graft added later');
  finishBattle(h);
});

// "Q: BoFy copied Robot 3. Is he a token now? A: No, true BoFy is non-token
// Unit, but his cost would be 0. (For things like Deformant, Lumengrove
// Lurker, Death Greeter or Abduct)"
// BROKEN today: every "cost" reader asks manaOf(u.card) — the PRINTED card —
// so the Borrower costs 7 whatever it copied.
test('RAQ Borrower of Forms: a Borrower that copied a Robot costs 0, so Lumengrove Lurker can recall it',
  { todo: 'RAQ: a copy keeps its printed cost (manaOf reads the physical card)' }, () => {
  const h = new Harness(39347);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const lurker = spawn(h, A, 'Lumengrove Lurker');            // after combat, recall a unit with cost ≤ units in my formation
  let robot = -1;
  whiteBox(h, e => { robot = e.spawnUnit(D, 'Robot', e.homeRegion(D), { token: true, counters: 3 }).id; });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, robot);
  finishBattle(h);
  toNextBattle(h, A);
  connect(h, A, [lurker, bof]);                               // a formation of two
  let asked: string[] | null = null;
  let guard = 20;
  while ((h.state.decision || h.state.stack.length) && guard-- > 0) {
    const d = h.state.decision;
    if (d && /Lumengrove/.test(d.prompt)) { asked = d.options.map(o => JSON.stringify(o.value)); break; }
    if (d) pick(h, d.options[0]!.value); else { pass(h); pass(h); }
  }
  assert.ok(asked, 'setup: the Lurker asked for its target');
  assert.ok(asked!.includes(JSON.stringify({ unit: bof })), `cost 0 ≤ 2: the Borrower is a legal target (offered ${asked})`);
});

