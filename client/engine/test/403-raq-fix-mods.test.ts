/**
 * RAQ fix round F5 (2026-10-09) — the grafts, Reconfigure, tokens and copies
 * tickets the RAQ audit filed (CT-213 … CT-219, CT-225), beyond the
 * reproductions in 393-raq-mods that now pass. The RAQ threads are the
 * authority (owner, 2026-10-09); each test names its ruling.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
  tokensOf, unitsOf, withE as whiteBox,
} from './util.ts';
import type { Seat } from '../src/types.ts';

/** pass priority until `seat` holds it */
function passTo(h: Harness, seat: Seat): void {
  let guard = 8;
  while (h.state.priority !== seat && guard-- > 0) pass(h);
  assert.equal(h.state.priority, seat, 'priority reached the acting seat');
}

/** answer every open question with its first option and drain the stack */
function drain(h: Harness): void {
  let guard = 60;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    const d = h.state.decision;
    if (d?.pickOrder) h.do({ type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) });
    else if (d) pick(h, d.options[0]!.value);
    else { pass(h); pass(h); }
  }
}

function borrow(h: Harness, A: Seat, target: number): number {
  giveResources(h, A, 'metal', 7);
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: target });
  drain(h);
  return unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!.id;
}

// ── CR 304.11d / CT-215: a cast spell token is a token ─────────────────────────

test('CR 304.11d: Download takes a Fireball already on the stack, and its new controller may aim it elsewhere', () => {
  const h = new Harness(40301);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const wall = spawn(h, D, 'Good Whale');                     // 7/5 — D's unit the stolen Fireball turns on
  giveResources(h, A, 'metal', 2);                            // Download mm/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fire = -1;
  whiteBox(h, e => { fire = e.createSpellToken(D, 'Fireball', 1, e.s.battle!.region).id; });
  passTo(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: fire });
  pick(h, { unit: atk });                                     // D aims it at A's attacker
  const item = h.state.stack[h.state.stack.length - 1]!.id;
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Download') });
  pick(h, { stack: item });
  pass(h); pass(h);                                           // Download resolves: the retarget question
  assert.equal(h.state.decision?.seat, A, 'the new controller chooses the targets');
  pick(h, { unit: wall });
  const stolen = h.state.stack.find(i => i.id === item)!;
  assert.equal(stolen.controller, A, 'the Fireball changed hands on the stack');
  pass(h); pass(h);                                           // the Fireball resolves
  assert.equal(ent(h, wall)!.damage, 1, 'and hit the unit its new controller chose');
  assert.ok(ent(h, atk), 'not the attacker it was first aimed at');
  finishBattle(h);
});

test('CR 304.11d: Arcane Echo copies a Fireball already on the stack as a fresh Fireball token', () => {
  const h = new Harness(40302);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);                            // Arcane Echo m/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fire = -1;
  whiteBox(h, e => { fire = e.createSpellToken(D, 'Fireball', 2, e.s.battle!.region).id; });
  passTo(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: fire });
  pick(h, { unit: atk });
  const item = h.state.stack[h.state.stack.length - 1]!.id;
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arcane Echo') });
  pick(h, { stack: item });
  pass(h); pass(h);                                           // Arcane Echo resolves
  const made = tokensOf(h, A).filter(t => t.card === 'Fireball');
  assert.equal(made.length, 1, 'A has a Fireball token of its own');
  assert.equal(made[0]!.x, 2, 'the same X');
  assert.ok(h.state.stack.some(i => i.id === item), 'and the original is still on the stack, untouched');
  finishBattle(h);
});

// ── CR 722.6 / CT-216: a grafted [cost] is mandatory ─────────────────────────

test('CR 722.6a: an activated graft cause whose grafted [cost] cannot be paid is not offered at all', () => {
  const h = new Harness(40303);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let evoker = -1;
  whiteBox(h, e => {
    evoker = e.spawnUnit(A, 'Omniwield Evoker', e.homeRegion(A)).id;   // [three]: a +1/+1 counter
    e.attachMod(e.s.entities[evoker]!, 'Darkblast', A, 'graft', 0);   // [Discard a card] …
  });
  giveResources(h, A, 'metal', 3);
  h.state.players[A]!.hand = [];                              // nothing to discard
  const activations = legalActions(h.state, A).filter(a => a.type === 'activateAbility' && a.entityId === evoker);
  assert.equal(activations.length, 0, 'not offered — its [three] would be spent on nothing');
  assert.throws(() => h.do({ type: 'activateAbility', seat: A, entityId: evoker, abilityIndex: 0 }),
    /grafted cost cannot be paid/, 'and refused by name');
  // positive control: one card in hand, and it is offered — and paid without a decline
  h.state.players[A]!.hand = ['Geode'];
  assert.ok(legalActions(h.state, A).some(a => a.type === 'activateAbility' && a.entityId === evoker),
    'with a card to discard it is offered');
});

test('CR 722.6a: an unpayable grafted [cost] on a triggered composite withholds it whole, and says so on the host', () => {
  const h = new Harness(40304);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let boulder = -1;
  whiteBox(h, e => {
    boulder = e.spawnUnit(A, 'Bellowing Boulder', e.homeRegion(A)).id;
    e.attachMod(e.s.entities[boulder]!, 'Darkblast', A, 'graft', 0);
  });
  toNextBattle(h, A);
  h.state.players[A]!.hand = [];
  const from = h.events.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder]] });
  const said = h.events.slice(from).find(ev => /the whole graft effect does not go on the stack/.test(ev.msg));
  assert.ok(said, 'the log says the composite is withheld');
  assert.equal(said!.data?.unit, boulder, 'and points at the host, so the board can show it');
  assert.ok(!h.state.stack.some(i => i.sourceId === boulder), 'nothing of it is on the stack');
  finishBattle(h);
});

// ── CR 410.5b / CT-218: a recalled spell token passes through the hand ───────

test('CR 801.7d: Dream Lapse recalls a cast Fireball token — it enters the hand (Rider of the Tides hears it) and is erased', () => {
  const h = new Harness(40305);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const rider = spawn(h, D, 'Rider of the Tides');            // 2/2: +2/+2 when a card enters a hand in battle
  giveResources(h, D, 'water', 1);
  giveResources(h, D, 'dark', 1);                             // Dream Lapse bd/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fire = -1;
  whiteBox(h, e => { fire = e.createSpellToken(A, 'Fireball', 1, e.s.battle!.region).id; });
  passTo(h, A);
  h.do({ type: 'castSpellToken', seat: A, entityId: fire });
  pick(h, { unit: rider });
  const item = h.state.stack[h.state.stack.length - 1]!.id;
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dream Lapse') });
  pick(h, { stack: item });
  drain(h);
  assert.ok(!h.state.players[A]!.hand.includes('Fireball'), 'the token did not stay in the hand');
  assert.ok(h.log.some(l => /recalls Fireball 1 to .* hand — a token, so it is erased/.test(l)), 'the log says both halves');
  assert.ok(effStats(h, rider)[0] >= 4, 'Rider of the Tides heard it enter a hand');
  finishBattle(h);
});

// ── CR 710.1a / CT-219: a copy is priced and typed by its face ───────────────

test('CR 710.1a: Abduct for X = 0 can take a Borrower of Forms that copied a Robot (its cost is the Robot, 0)', () => {
  const h = new Harness(40306);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  let robot = -1;
  whiteBox(h, e => { robot = e.spawnUnit(D, 'Robot', e.homeRegion(D), { token: true, counters: 3 }).id; });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, robot);                            // erases D's Robot 3 and becomes it
  assert.equal(new (whiteBoxE())(h.state).costOf(ent(h, bof)!), 0, 'the face costs 0');
  giveResources(h, D, 'wood', 1);
  giveResources(h, D, 'metal', 1);                            // Abduct gm, X = 0
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Abduct') });
  while (h.state.decision && !h.state.decision.options.some(o => (o.value as { unit?: number }).unit !== undefined)) {
    pick(h, h.state.decision.options[0]!.value);              // X = 0
  }
  assert.ok(h.state.decision!.options.some(o => (o.value as { unit?: number }).unit === bof),
    'the Borrower is a legal "cost [x] or less" target at X = 0');
  finishBattle(h);
});

test('CR 710.2: Leave None Pure sees a Borrower that copied an untouched Good Whale as untouched', () => {
  const h = new Harness(40307);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');                    // 7/5, no changes
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, whale);
  giveResources(h, D, 'dark', 2);                             // Leave None Pure d/2
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Leave None Pure') });
  assert.ok(h.state.decision!.options.some(o => (o.value as { unit?: number }).unit === bof),
    'an exact copy of an untouched 7/5 has no stat changes');
  finishBattle(h);
});

// ── CR 710.2a / CT-225: a fresh copy of a modded unit is not Unstable ─────────

test('CR 720.7e: a Borrower that copied a modded unit dies to the bin; a mod put on it later makes it Unstable the usual way', () => {
  const h = new Harness(40308);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  let host = -1;
  whiteBox(h, e => {
    host = e.spawnUnit(D, 'Good Whale', e.homeRegion(D)).id;
    e.attachMod(e.s.entities[host]!, 'Glowhaven Elder', D, 'augment');
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, host);
  assert.ok(!new (whiteBoxE())(h.state).isUnstable(ent(h, bof)!), 'fresh: not Unstable');
  whiteBox(h, e => { e.attachMod(e.s.entities[bof]!, 'Chitin Shredder', A, 'augment'); });
  assert.ok(new (whiteBoxE())(h.state).isUnstable(ent(h, bof)!), 'a real mod applied to it makes it Unstable');
  finishBattle(h);

  // CT-241 (9): "dies to the bin", observed — the same fresh copy, killed
  const g = new Harness(40318);
  toDeployment(g);
  const gA = g.state.initiative, gD = (1 - gA) as Seat;
  const gAtk = spawn(g, gA, 'Unit Token');
  let gHost = -1;
  whiteBox(g, e => {
    gHost = e.spawnUnit(gD, 'Good Whale', e.homeRegion(gD)).id;
    e.attachMod(e.s.entities[gHost]!, 'Glowhaven Elder', gD, 'augment');
  });
  toNextBattle(g, gA);
  g.do({ type: 'declareAttack', seat: gA, columns: [[gAtk]] });
  const gBof = borrow(g, gA, gHost);
  const binBefore = g.state.players[gA]!.bin.filter(c => c === 'Borrower of Forms').length;
  whiteBox(g, e => { e.destroy(e.s.entities[gBof]!, 'dies'); });
  assert.equal(ent(g, gBof), undefined, 'the copy died');
  assert.equal(g.state.players[gA]!.bin.filter(c => c === 'Borrower of Forms').length, binBefore + 1,
    'and the Borrower card went to the bin');
  assert.ok(!(g.state.players[gA]!.erased ?? []).includes('Borrower of Forms'), 'it was not erased: not Unstable');
  finishBattle(g);
});

// ── CR 720.10b / CT-213: a moved mod stays spent; CR 109.9k: its use is its own ──

test('CR 720.10b: a moved mod carries its spent augment budget, and a second Graxxlid left behind keeps its own use', () => {
  // Until report 269 the [Augment] use was kept on the HOST and copied here,
  // so the old host stayed marked and a second Graxxlid on it was spent too.
  // The use is the MOD's now (CR 109.9k): it moves with the mod and is nobody
  // else's.
  const h = new Harness(40309);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let a = -1, b = -1, grax = -1, stay = -1;
  whiteBox(h, e => {
    a = e.spawnUnit(A, 'Bubb', e.homeRegion(A)).id;
    b = e.spawnUnit(A, 'Good Whale', e.homeRegion(A)).id;
    grax = e.attachMod(e.s.entities[a]!, 'Graxxlid', A, 'augment').id;
    stay = e.attachMod(e.s.entities[a]!, 'Graxxlid', A, 'augment').id;
    assert.ok(e.composeParts(e.s.entities[a]!, 0, 'augment', 'Graxxlid', grax), 'the [once] is used this turn');
    e.moveMod(e.s.entities[grax]!, e.s.entities[b]!);
  });
  assert.equal(ent(h, grax)!.budgets['augment:Graxxlid#0'], 1, 'spent on the mod, which is on the new host');
  whiteBox(h, e => {
    assert.equal(e.composeParts(e.s.entities[b]!, 0, 'augment', 'Graxxlid', grax), null,
      'and it cannot be used again from there');
    assert.ok(e.composeParts(e.s.entities[a]!, 0, 'augment', 'Graxxlid', stay),
      'the Graxxlid left on the old host still has its use');
  });
  assert.equal(ent(h, a)!.budgets['augment:Graxxlid#0'], undefined, 'and the old host holds no mod\'s use');
});

/** the engine class, for the white-box reads above */
function whiteBoxE() {
  let ctor: (new (s: Harness['state']) => import('../src/engine.ts').E) | null = null;
  whiteBox(new Harness(1), e => { ctor = e.constructor as typeof ctor; });
  return ctor!;
}
