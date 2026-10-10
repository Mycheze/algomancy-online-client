/**
 * Comprehensive rules, unit U16 (timestamps and continuous effects, copies,
 * control, stripping, state checks, last-known state) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U16
 * (data/comprehensive-rules/build/probes/U16/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U16.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * The two tests titled "engine differs" are the exception: their rules carry
 * an engineDiffers mark, and these tests pin the divergence the mark
 * describes. They are deliberately NOT listed in those rules' sources. When
 * one goes red the engine has been changed: re-read the rule, drop or update
 * the engineDiffers mark and the test, and bind a real example.
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
import type { EntityId, Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, offered, pass, pick, spawn, toDeployment, toNextBattle, unitsOf, withE,
} from './util.ts';

const other = (s: Seat): Seat => (1 - s) as Seat;

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  h.state = g.s;
  return u.id;
}

/** answer the pending decision with the option whose label contains `label` */
function say(h: Harness, label: string): void {
  const dec = h.state.decision;
  if (!dec) throw new Error(`no decision pending; wanted "${label}"`);
  const idx = dec.options.findIndex(o => o.label.includes(label));
  if (idx === -1) throw new Error(`no option "${label}" in [${dec.options.map(o => o.label)}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

// ---------------------------------------------------------------- state checks

test('cr:effects.state.lethal — a unit whose marked damage equals its defense dies in the state check, and one with less lives', () => {
  const h = new Harness(71601);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = tok(h, p, 1, 3);
  withE(h, e => { e.entity(u)!.damage = 3; });
  assert.equal(ent(h, u), undefined, 'damage 3 on a 1/3: it died');
  const v = tok(h, p, 1, 3);
  withE(h, e => { e.entity(v)!.damage = 2; });
  assert.ok(ent(h, v), 'damage 2 on a 1/3: alive');
});

test('cr:effects.state.no-damage-needed.pure — a Pure 1/3 that is Tough and Inverted reads 1/0 and still dies in the state check', () => {
  const h = new Harness(71605);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = tok(h, p, 1, 3);
  const e = new E(h.state);
  e.addTempAttr(e.entity(u)!, 'Pure');
  e.addTempAttr(e.entity(u)!, 'Tough');
  e.addTempAttr(e.entity(u)!, 'Inverted');
  assert.ok(e.ownAttrs(e.entity(u)!).has('Pure'), 'setup: it is Pure');
  e.settle();
  h.state = e.s;
  assert.equal(ent(h, u), undefined, 'Pure is no escape: it died');
});

test('cr:effects.state.when.mid-resolution — the Pestilent Titan trigger kills a 1/1 before the next unit gets its counter', () => {
  const h = new Harness(71631);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const titan = spawn(h, A, 'Pestilent Titan');
  const t1 = tok(h, D, 1, 1);
  const t2 = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[titan]] });
  assert.ok(h.state.stack.some(i => i.card === 'Pestilent Titan'), 'setup: the trigger is on the stack');
  const mark = h.events.length;
  pass(h); pass(h);
  const evs = h.events.slice(mark);
  const firstDeath = evs.findIndex(ev => ev.type === 'died');
  const counters = evs.map((ev, i) => (ev.type === 'countersChanged' ? i : -1)).filter(i => i >= 0);
  assert.equal(ent(h, t1), undefined);
  assert.equal(ent(h, t2), undefined);
  assert.ok(counters.length >= 3, `three counters placed: ${evs.map(x => x.type).join(',')}`);
  assert.ok(firstDeath >= 0 && firstDeath < counters[counters.length - 1]!,
    `a death precedes the last counter: ${evs.map(x => x.type).join(',')}`);
  finishBattle(h);
});

test('cr:effects.state.what — at a safe point a lethally damaged unit dies, a dead unit token is erased instead of staying in the bin, and a recalled token is erased from the hand', () => {
  const h = new Harness(71641);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const whale = spawn(h, p, 'Good Whale');
  const t = tok(h, p, 1, 1);
  const e = new E(h.state);
  e.entity(whale)!.damage = 99;
  e.entity(t)!.damage = 99;
  assert.ok(e.entity(whale) && e.entity(t), 'setup: nothing dies until the check runs');
  e.settle();
  h.state = e.s;
  assert.equal(ent(h, whale), undefined, 'the unit that should be dead died');
  assert.equal(ent(h, t), undefined, 'and so did the token');
  assert.deepEqual(h.state.players[p]!.bin, ['Good Whale'], 'the card is in the bin, the token is not');
  assert.deepEqual(h.state.players[p]!.erased, ['Unit Token'], 'the token ceased to exist');
  const t2 = tok(h, p, 1, 1);
  withE(h, g => g.recall(g.entity(t2)!));
  assert.ok(!h.state.players[p]!.hand.includes('Unit Token'), 'a token cannot exist in a hand');
  assert.deepEqual(h.state.players[p]!.erased, ['Unit Token', 'Unit Token']);
});

test('cr:effects.state.together.limits — Cthyrian Culler dying alone does not hear its own trash, and dying beside an ally hears only the ally', () => {
  const count = (withMate: boolean): number => {
    const h = new Harness(71642);
    toDeployment(h);
    const A = h.state.initiative as Seat;
    const cc = spawn(h, A, 'Cthyrian Culler');
    const mate = spawn(h, A, 'Tiderunner Initiate');
    const from = h.events.length;
    withE(h, e => {
      e.entity(cc)!.damage = 99;
      if (withMate) e.entity(mate)!.damage = 99;
      e.checkDeaths();
    });
    assert.equal(ent(h, cc), undefined, 'setup: the Culler died');
    assert.ok(h.events.slice(from).some(ev => ev.type === 'trashed' && ev.data?.['card'] === 'Cthyrian Culler'),
      'setup: the Culler itself was trashed');
    return h.events.slice(from)
      .filter(ev => ev.type === 'triggered' && ev.msg === 'Trigger: Cthyrian Culler — each opponent loses 1 life.').length;
  };
  assert.equal(count(false), 0, 'its own departure: not heard');
  assert.equal(count(true), 1, 'one batch-mate trashed: heard once, not twice');
});

test('cr:effects.state.together.limits — Splort dying with an ally fires for the ally, and neither dead body is offered as a target', () => {
  const h = new Harness(71643);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const sp = spawn(h, A, 'Splort');
  const mate = spawn(h, A, 'Tiderunner Initiate');
  const live = spawn(h, A, 'Good Whale');
  withE(h, e => { e.entity(sp)!.damage = 99; e.entity(mate)!.damage = 99; });
  assert.equal(ent(h, sp), undefined, 'setup: Splort died');
  assert.equal(ent(h, mate), undefined, 'setup: in the same batch as its ally');
  assert.ok(h.state.decision?.prompt.includes('Splort'), 'the trigger for the ally asks for a target');
  const menu = offered(h);
  assert.ok(menu.includes(JSON.stringify({ unit: live })), 'a living unit is a legal target');
  assert.ok(!menu.includes(JSON.stringify({ unit: sp })), 'Splort, dead in the batch, is not');
  assert.ok(!menu.includes(JSON.stringify({ unit: mate })), 'nor is the ally that died beside it');
});

test('cr:effects.state.together.limits — Prickly Protector stops counting an ally the moment that ally is disposed inside the batch', () => {
  const h = new Harness(71644);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const pp = spawn(h, A, 'Prickly Protector');
  const a1 = spawn(h, A, 'Tiderunner Initiate');
  const a2 = spawn(h, A, 'Tiderunner Initiate');
  assert.deepEqual(effStats(h, pp), [2, 3], 'setup: two other allies, +2/+2');
  const seen: { unit: unknown; gone: boolean; stats: [number, number] }[] = [];
  withE(h, e => {
    const orig = e.fireEvent.bind(e);
    e.fireEvent = (type, ev, dying) => {
      if (type === 'died') {
        const unit = ev.data?.['unit'];
        seen.push({ unit, gone: !e.entity(unit as EntityId), stats: e.effStats(e.entity(pp)!) });
      }
      return orig(type, ev, dying);
    };
    e.entity(a1)!.damage = 99;
    e.entity(a2)!.damage = 99;
  });
  assert.equal(seen.length, 2, 'setup: two deaths in one batch');
  assert.ok(seen.every(s => s.gone), 'each body is gone from the board when its death is announced');
  assert.deepEqual(seen.map(s => s.stats), [[1, 2], [0, 1]], 'a dead batch-mate is no longer an ally for the count');
  assert.ok(ent(h, pp), 'the Protector, undamaged, lives at 0/1');
  assert.deepEqual(effStats(h, pp), [0, 1]);
});

// ---------------------------------------------------------------- column sharing

test('cr:effects.column-share.columns-only — a unit in the same column as Good Whale shares its Piercing, and one in the next column does not', () => {
  const h = new Harness(71604);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const whale = spawn(h, A, 'Good Whale');
  const side = spawn(h, A, 'Unit Token');
  const back = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale, back], [side]] });
  const e = new E(h.state);
  assert.ok(e.effAttrs(e.entity(back)!).has('Piercing'), 'same column: shared');
  assert.ok(!e.effAttrs(e.entity(side)!).has('Piercing'), 'adjacent column: not shared');
  finishBattle(h);
});

// ---------------------------------------------------------------- layers

test('cr:effects.continuous.switch — an 8/3 switched by Invasive Reassignment is a 3/8, and a later +2/+0 makes it a 5/8', () => {
  const h = new Harness(71626);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = other(A);
  const t = spawn(h, A, 'Unit Token');
  const big = spawn(h, D, 'Lurking Slimebeast');
  giveResources(h, A, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[t]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Invasive Reassignment') });
  pick(h, { unit: big });
  pass(h); pass(h);
  assert.deepEqual(effStats(h, big), [3, 8]);
  withE(h, e => e.addTemp(e.entity(big)!, 2, 0));
  assert.deepEqual(effStats(h, big), [5, 8], 'the later +2/+0 lands on power, unswitched');
  finishBattle(h);
});

test('cr:effects.continuous.layers.attribute-order — engine differs: a printed-Balanced 2/0 augmented with Tough is balanced first, then doubled, to 2/4', () => {
  const h = new Harness(71612);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'earth', 4);
  const child = spawn(h, p, 'Child of Aether');
  assert.deepEqual(effStats(h, child), [2, 2], 'setup: Balanced 2/0 reads 2/2');
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Rampart Guardian'), hostId: child });
  assert.deepEqual(effStats(h, child), [2, 4], 'balanced, then doubled');
});

// ---------------------------------------------------------------- copies

test('cr:effects.copies.spells.targets — Earnest Defender triggers for the targets of a copied Burgeon as well as the original', () => {
  const h = new Harness(71606);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const atk = spawn(h, A, 'Unit Token');
  const ed = spawn(h, A, 'Earnest Defender');
  spawn(h, D, 'Maelstrom Charger');
  giveResources(h, D, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [ed]] });
  pass(h);
  const before = unitsOf(h, A).filter(u => u.card === 'Unit Token').length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Burgeon') });
  pick(h, { unit: atk });
  if (h.state.decision && h.state.decision.options.some(o => o.value === 'power')) pick(h, 'power');
  say(h, 'Sacrifice Maelstrom Charger');
  say(h, 'Keep the original targets');
  let guard = 40;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  const made = unitsOf(h, A).filter(u => u.card === 'Unit Token').length - before;
  assert.equal(made, 2, 'one 1/1 for the played spell, one for the copy');
  finishBattle(h);
});

test('cr:effects.copies.spells.modular — a copy of Spellbind cast with Primordial Coalescence carries the same Modular mods', () => {
  const h = new Harness(71607);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const atk = spawn(h, A, 'Unit Token');
  const chg = spawn(h, A, 'Maelstrom Charger');
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [chg]] });
  giveResources(h, A, 'dark', 6);
  give(h, A, 'Primordial Coalescence');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  const idx = h.state.players[A]!.hand.lastIndexOf('Primordial Coalescence');
  pick(h, { modFrom: 'hand', index: idx });
  while (h.state.decision && h.state.decision.options.some(o => JSON.stringify(o.value) === JSON.stringify({ doneMods: true }))) {
    pick(h, { doneMods: true });
  }
  say(h, 'Sacrifice Maelstrom Charger');
  if (h.state.decision) { try { say(h, 'Keep'); } catch { /* no target question */ } }
  const orig = h.state.stack.find(i => !i.copy), copy = h.state.stack.find(i => i.copy);
  assert.ok(orig && copy, `both on the stack (stack: ${h.state.stack.map(i => i.label)})`);
  assert.deepEqual(copy!.mods, orig!.mods, 'the copy carries the same Modular mods');
  assert.ok((copy!.mods ?? []).some(m => m.card === 'Primordial Coalescence'));
  finishBattle(h);
});

test('cr:effects.copies.create-copy-of-me — the token copy Echo of Despair makes of itself has none of its counters and none of its mods', () => {
  const h = new Harness(71613);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const echo = spawn(h, A, 'Echo of Despair');
  withE(h, e => { e.addCounters(e.entity(echo)!, 1); e.attachMod(e.entity(echo)!, 'Sandstone Defender', A, 'augment'); });
  assert.equal(ent(h, echo)!.counters, 1);
  assert.equal(ent(h, echo)!.mods.length, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[echo]] });
  finishBattle(h);
  const copies = unitsOf(h, A).filter(u => u.card === 'Echo of Despair' && u.id !== echo);
  assert.equal(copies.length, 1, 'a copy was made');
  assert.equal(copies[0]!.token, true, 'the copy is a token');
  assert.equal(copies[0]!.counters, 0, 'no counters');
  assert.equal(copies[0]!.mods.length, 0, 'no mods');
});

// ---------------------------------------------------------------- control

test('cr:effects.control.region — a unit given in deployment to a player not present goes to the home region of that player, with its mods', () => {
  const h = new Harness(71609);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = other(A);
  const u = spawn(h, D, 'The Foretold');
  let mod = -1;
  withE(h, e => { mod = e.attachMod(e.entity(u)!, 'The Foretold', D, 'augment').id; });
  const homeA = new E(h.state).homeRegion(A);
  assert.notEqual(ent(h, u)!.region, homeA, 'setup: it stands in the other home region');
  withE(h, e => { e.giveControl(e.entity(u)!, A); });
  assert.equal(ent(h, u)!.controller, A);
  assert.equal(ent(h, u)!.region, homeA, 'it went to the home region of its new controller');
  assert.equal(ent(h, mod)!.region, homeA, 'and its mod with it');
});

// ---------------------------------------------------------------- stripping

test('cr:effects.stripping.what.abilities — Sandstone Defender silenced by a one-shot strip stops giving +0/+2 at once', () => {
  const h = new Harness(71636);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const sd = spawn(h, p, 'Sandstone Defender');
  const t = tok(h, p, 1, 1);
  assert.deepEqual(effStats(h, t), [1, 3], 'setup: the static applies');
  withE(h, e => e.suppress(e.entity(sd)!, 'Suppression Field', { abilities: true }));
  assert.deepEqual(effStats(h, t), [1, 1], 'the silenced unit radiates nothing');
});

test('cr:effects.stripping.what.abilities — engine differs: Sandstone Defender stripped by Transmogrifant still gives +0/+2, so a 1/1 token is 3/5 not 3/3', () => {
  const h = new Harness(71637);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Sandstone Defender');
  const t = tok(h, p, 1, 1);
  spawn(h, p, 'Transmogrifant');
  assert.deepEqual(effStats(h, t), [3, 5], 'engine measurement: the continuously stripped unit keeps radiating');
});

test('cr:effects.stripping.what.not-stats — a silenced Good Whale with a +1/+1 counter keeps its stats and its counter, an 8/6', () => {
  const h = new Harness(71610);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const w = spawn(h, p, 'Good Whale');
  withE(h, e => e.addCounters(e.entity(w)!, 1));
  assert.deepEqual(effStats(h, w), [8, 6]);
  withE(h, e => e.suppress(e.entity(w)!, 'Suppression Field', { abilities: true }));
  assert.ok(new E(h.state).abilitiesSuppressed(ent(h, w)!), 'setup: silenced');
  assert.deepEqual(effStats(h, w), [8, 6]);
  assert.equal(ent(h, w)!.counters, 1);
});

// ---------------------------------------------------------------- last-known state

test('cr:effects.last-known.departure-facts — the death event carries the counters the unit had', () => {
  const h = new Harness(71611);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = spawn(h, p, 'Good Whale');
  withE(h, e => e.addCounters(e.entity(u)!, 2));
  const mark = h.events.length;
  withE(h, e => e.destroy(e.entity(u)!, 'dies'));
  const died = h.events.slice(mark).find(ev => ev.type === 'died');
  assert.ok(died, 'a died event');
  assert.equal(died!.data!['counters'], 2);
});

test('cr:effects.last-known.stats — Deathglow Strider 3/4 with a counter, gone before its trigger resolves, deals its last-known 4, not its printed 3', () => {
  const h = new Harness(71632);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const st = spawn(h, A, 'Deathglow Strider');
  withE(h, e => e.addCounters(e.entity(st)!, 1));
  assert.deepEqual(effStats(h, st), [3, 4]);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[st]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.ok(h.state.stack.some(i => i.card === 'Deathglow Strider'), 'setup: trigger waiting');
  new E(h.state).destroy(ent(h, st)!, 'dies');
  assert.equal(ent(h, st), undefined);
  const life = h.state.players[D]!.life;
  pass(h); pass(h);
  assert.equal(life - h.state.players[D]!.life, 4, 'the defense it had when it left');
  finishBattle(h);
});

test('cr:effects.last-known.stats — Spewing Mushroom at +2/+0, gone before its attack trigger resolves, makes a Poison 3', () => {
  const h = new Harness(71633);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const sm = spawn(h, A, 'Spewing Mushroom');
  withE(h, e => e.addTemp(e.entity(sm)!, 2, 0));
  assert.deepEqual(effStats(h, sm), [3, 3]);
  spawn(h, other(A), 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sm]] });
  assert.ok(h.state.stack.some(i => i.card === 'Spewing Mushroom'), 'setup: trigger waiting');
  new E(h.state).destroy(ent(h, sm)!, 'dies');
  pass(h); pass(h);
  const poison = Object.values(h.state.entities).filter(u => u.card === 'Poison' && u.controller === A);
  assert.equal(poison.length, 1);
  assert.equal(poison[0]!.x, 3, 'a Poison of its last-known power');
  finishBattle(h);
});

test('cr:effects.last-known.face — Echo of Despair, gone before its after-combat trigger resolves, still makes an Echo of Despair token', () => {
  const h = new Harness(71628);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const echo = spawn(h, A, 'Echo of Despair');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[echo]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: other(A), blocks: {} });
  pass(h); pass(h);
  assert.ok(h.state.stack.some(i => i.card === 'Echo of Despair'), 'setup: trigger waiting');
  new E(h.state).destroy(ent(h, echo)!, 'dies');
  pass(h); pass(h);
  const copies = unitsOf(h, A).filter(u => u.card === 'Echo of Despair' && u.token);
  assert.equal(copies.length, 1, 'the copy is an Echo of Despair token');
  finishBattle(h);
});

test('cr:effects.last-known.what — Deathglow Strider gone before its trigger resolves is remembered with its card, face, controller, region, column-shared Piercing, stats and formation', () => {
  const h = new Harness(71645);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const whale = spawn(h, A, 'Good Whale');
  const st = spawn(h, A, 'Deathglow Strider');
  withE(h, e => e.addCounters(e.entity(st)!, 1));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale, st]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.ok(h.state.stack.some(i => i.card === 'Deathglow Strider'), 'setup: trigger waiting');
  const e = new E(h.state);
  const u = e.entity(st)!;
  const region = u.region;
  assert.ok(e.effAttrs(u).has('Piercing'), 'setup: it shares the Piercing of the whale in its column');
  e.destroy(u, 'dies');
  h.state = e.s;
  assert.equal(ent(h, st), undefined);
  assert.deepEqual(new E(h.state).lastKnownOf(st), {
    id: st, card: 'Deathglow Strider', face: 'Deathglow Strider', controller: A, region,
    attrs: ['Piercing'], power: 3, defense: 4, formationSeat: A,
  });
  pass(h); pass(h);
  finishBattle(h);
});
