/**
 * Comprehensive rules, unit U05 (parts of a card) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U05
 * (data/comprehensive-rules/build/probes/U05/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U05.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import PRINTED from '../src/cards/printed.json' with { type: 'json' };
import type { EntityId, Seat } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, handIdx, pass, pick, spawn, toDeployment, toNextBattle, unitsOf, withE,
} from './util.ts';

/** resolve the stack and answer every pending decision with its first option */
function drain(h: Harness): void {
  let guard = 60;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    const d = h.state.decision;
    if (d?.pickOrder) h.do({ type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) });
    else if (d) pick(h, d.options[0]!.value);
    else { pass(h); pass(h); }
  }
}
/** pass until `seat` holds priority */
function passTo(h: Harness, seat: Seat): void {
  let guard = 8;
  while (h.state.priority !== seat && guard-- > 0) pass(h);
}

/* ---------- type line ---------- */

test('cr:card.type-line.card-type — every printed type line ends Unit / Spell / Spell Unit / Token Unit / Spell Token / Resource, matching its kind', () => {
  const rows = Object.values(PRINTED as Record<string, { name: string; type: string; kind: string }>);
  assert.ok(rows.length > 400, 'premise: the whole pool is read (492 rows when promoted)');
  const bad: string[] = [];
  for (const r of rows) {
    const words = r.type.replace(/\{[^}]*\}|\[[^\]]*\]/g, ' ').trim().split(/\s+/);
    const tail2 = words.slice(-2).join(' ');
    const last = words[words.length - 1];
    const ok =
      (r.kind === 'spell' && last === 'Spell')
      || (r.kind === 'spellUnit' && tail2 === 'Spell Unit')
      || (r.kind === 'spellToken' && tail2 === 'Spell Token')
      || (r.kind === 'unit' && (last === 'Unit' || last === 'Resource'));
    if (!ok) bad.push(`${r.name}: ${r.kind} / ${r.type}`);
    if (words.includes('Token') && r.kind === 'unit') assert.equal(tail2, 'Token Unit', `${r.name}: a unit token reads Token Unit`);
  }
  assert.deepEqual(bad, []);
});

/* ---------- cost orb ---------- */

test('cr:card.cost-orb.pips — affinity counts expended resources of the element but not dormant ones', () => {
  const h = new Harness(50525);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.resources = [];
  giveResources(h, P, 'wood', 2, 'expended');
  giveResources(h, P, 'wood', 1, 'dormant');
  const g = new E(h.state);
  assert.equal(g.affinity(P, 'wood'), 2, 'two expended count, the dormant one does not');
});

/* ---------- alternative-cost banner ---------- */

test('cr:card.banner.not-the-cards-cost — a unit played through its Ambush banner still costs its cost-orb mana', () => {
  const h = new Harness(50505);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const sprite = spawn(h, A, 'Ignis Sprite');
  const rc = spawn(h, D, 'Rune Channeler');
  giveResources(h, D, 'water', 4);
  give(h, D, 'Lurking Slimebeast');                   // cost orb [4bb], banner [3b]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [rc] } });
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: rc });
  drain(h);
  const slime = unitsOf(h, D).find(u => u.card === 'Lurking Slimebeast');
  assert.ok(slime, 'ambushed into play');
  assert.equal(new E(h.state).costOf(slime), 4, 'its cost is the orb (4), not the banner (3)');
  finishBattle(h);
});

test('cr:card.banner.cost — the affinity pips of an Ambush banner are required, and mana without them is refused', () => {
  const h = new Harness(50506);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const sprite = spawn(h, A, 'Ignis Sprite');
  const rc = spawn(h, D, 'Rune Channeler');
  giveResources(h, D, 'fire', 8);                     // plenty of mana, no water
  give(h, D, 'Lurking Slimebeast');                   // banner [3b]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [rc] } });
  passTo(h, D);
  assert.ok(!legalActions(h.state, D).some(a => a.type === 'playCard' && a.mode === 'ambush'), 'ambush not offered without the water pip');
  assert.throws(() => h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Lurking Slimebeast'), mode: 'ambush' }));
  finishBattle(h);
});

/* ---------- timing ---------- */

test('cr:card.timing.none — a card with no timing icon is refused in the haste step and in battle', () => {
  const h = new Harness(50502);
  toDeployment(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  const p = h.state.initiative as Seat;
  giveResources(h, p, 'fire', 2);
  give(h, p, 'Molten Upheaval');                       // a haste card, so the haste step opens
  give(h, p, 'Curio Drifter');                         // a unit with no timing icon
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone && !h.state.hasteDone[p], 'premise: the haste step is open');
  assert.ok(!legalActions(h.state, p).some(a => a.type === 'playCard' && a.handIndex === handIdx(h, p, 'Curio Drifter')), 'haste step: not offered');
  assert.throws(() => h.do({ type: 'playCard', seat: p, handIndex: handIdx(h, p, 'Curio Drifter') }));
  h.do({ type: 'doneHaste', seat: 0 });
  h.do({ type: 'doneHaste', seat: 1 });
  assert.equal(h.state.phase, 'battle');
  const A = h.state.battle!.attacker;
  const atk = spawn(h, A, 'Unit Token');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  passTo(h, p);
  assert.ok(!legalActions(h.state, p).some(a => a.type === 'playCard' && a.handIndex === handIdx(h, p, 'Curio Drifter')), 'battle: not offered');
  assert.throws(() => h.do({ type: 'playCard', seat: p, handIndex: handIdx(h, p, 'Curio Drifter') }));
  finishBattle(h);
});

test('cr:card.timing.haste — a Haste card is also playable during deployment', () => {
  const h = new Harness(50503);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 1);
  const i = give(h, P, 'Molten Upheaval');
  assert.ok(legalActions(h.state, P).some(a => a.type === 'playCard' && a.handIndex === i), 'offered in deployment');
});

/* ---------- stats ---------- */

test('cr:card.stats.changes.cancel — two +1/+1 then one -1/-1 leaves exactly one +1/+1 and no -1/-1; one of each leaves none', () => {
  const h = new Harness(50521);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const u = spawn(h, A, 'Good Whale');
  const v = spawn(h, A, 'Good Whale');
  withE(h, e => { e.addCounters(e.entity(u)!, 2, A); e.addCounters(e.entity(u)!, -1, A); });
  withE(h, e => { e.addCounters(e.entity(v)!, 1, A); e.addCounters(e.entity(v)!, -1, A); });
  assert.equal(ent(h, u)!.counters, 1, 'net one +1/+1 counter');
  assert.equal(ent(h, v)!.counters, 0, 'both removed: no counter of either kind');
});

test('cr:card.stats.negative-power — a negative-power unit deals 0 combat damage and does not subtract from its column', () => {
  const h = new Harness(50509);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const neg = spawn(h, A, 'Unit Token');
  const mate = spawn(h, A, 'Unit Token');
  withE(h, e => { e.addTemp(e.entity(neg)!, -4, 0); });   // 1/1 -> -3/1
  toNextBattle(h, A);
  assert.equal(new E(h.state).effStats(ent(h, neg)!)[0], -3, 'premise: power -3');
  const life0 = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[neg, mate]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(life0 - h.state.players[D]!.life, 1, 'the column deals 1: the mate deals 1, the -3 counts as 0');
  finishBattle(h);
});

/* ---------- augment box ---------- */

test('cr:card.augment-box.copy — Reconfigure is castable with a real [Augment] unit present and offers it, but never a Borrower that copied Bubb', () => {
  const h = new Harness(50524);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const bubb = spawn(h, D, 'Bubb');                      // [Augment] {Unaware}
  const realAug = spawn(h, A, 'Rampart Guardian');        // a real [Augment] unit, same region
  const host = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk, host], [realAug]] });
  giveResources(h, A, 'metal', 7);
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: bubb });
  drain(h);
  const bof = unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!.id;
  assert.equal(new E(h.state).nameOf(ent(h, bof)!), 'Bubb', 'premise: the Borrower is a Bubb copy');
  giveResources(h, A, 'earth', 2);
  giveResources(h, A, 'metal', 2);
  passTo(h, A);
  const rc = give(h, A, 'Reconfigure');
  assert.ok(legalActions(h.state, A).some(a => a.type === 'playCard' && a.handIndex === rc), 'Reconfigure is castable (the check is not vacuous)');
  h.do({ type: 'playCard', seat: A, handIndex: rc });
  const opts = h.state.decision!.options.map(o => (o.value as { unit?: number }).unit);
  assert.ok(opts.includes(realAug), 'the real [Augment] unit is a legal first target');
  assert.ok(!opts.includes(bof), 'the Borrower copying Bubb is not');
});

/* ---------- tester additions: the rules a reader might take for description ---------- */

/** deal n effect damage from a source with no attributes, then settle */
function effectDamage(h: Harness, controller: Seat, target: EntityId, n: number): void {
  const g = new E(h.state);
  g.dealEffectDamage(
    { controller, sourceName: 'Ignis Sprite', region: g.homeRegion(controller), targets: [], event: null,
      eraseSelf: () => {}, choose: () => { throw new Error('no choice expected'); } } as never,
    g.entity(target)! as never, n);
  g.settle();
}
const playable = (h: Harness, seat: Seat, name: string): boolean =>
  legalActions(h.state, seat).some(a => a.type === 'playCard' && a.handIndex === handIdx(h, seat, name));

test('cr:card.name.every-card — every card in the pool has a non-empty name, the one it is filed under', () => {
  const rows = Object.entries(PRINTED as Record<string, { name: string }>);
  assert.ok(rows.length > 400, 'premise: the whole pool is read');
  const bad = rows.filter(([k, r]) => typeof r.name !== 'string' || !r.name.trim() || r.name !== k).map(([k]) => k);
  assert.deepEqual(bad, []);
});

test('cr:card.cost-orb.mana-cost — Good Whale (mana 6) is refused with five resources and costs exactly six expended resources to play', () => {
  const h = new Harness(50530);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.resources = [];
  giveResources(h, P, 'water', 5);
  give(h, P, 'Good Whale');
  assert.ok(!playable(h, P, 'Good Whale'), 'five resources: not offered');
  giveResources(h, P, 'water', 2);
  assert.ok(playable(h, P, 'Good Whale'), 'seven resources: offered');
  h.do({ type: 'playCard', seat: P, handIndex: handIdx(h, P, 'Good Whale') });
  drain(h);
  assert.ok(unitsOf(h, P).some(u => u.card === 'Good Whale'), 'premise: it resolved');
  const rs = h.state.players[P]!.resources;
  assert.equal(rs.filter(r => r.state === 'expended').length, 6, 'six expended');
  assert.equal(new E(h.state).openMana(P), 1, 'the seventh is still open');
});

test('cr:card.cost-orb.pips-not-cost — Resurrect (cost 2 or less) offers Chitin Shredder, whose cost orb is 2 with two pips, and its cost in play reads 2', () => {
  const h = new Harness(50531);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.bin.push('Chitin Shredder', 'Rune Channeler');   // [ee] 2  and  [rr] 3
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Resurrect') });
  const labels = h.state.decision!.options.map(o => o.label);
  assert.ok(labels.some(l => l.startsWith('Chitin Shredder')), 'cost 2 (not 2 + its two pips) is 2 or less');
  assert.ok(!labels.some(l => l.startsWith('Rune Channeler')), 'premise: a cost-3 unit is not offered');
  pick(h, { bin: { seat: P, card: 'Chitin Shredder' } });
  drain(h);
  const chitin = unitsOf(h, P).find(u => u.card === 'Chitin Shredder')!;
  assert.equal(new E(h.state).costOf(chitin), 2, 'its cost is the mana number alone');
});

test('cr:card.type-line.attribute-colours — a column shares the combat attribute Powerful, but the column-mate of an Unstable unit is not Unstable and is binned, not erased', () => {
  const h = new Harness(50532);
  toDeployment(h);
  const A = h.state.initiative;
  const chitin = spawn(h, A, 'Chitin Shredder');         // {Powerful}
  const weaver = spawn(h, A, 'Aberrant Statweaver');     // {Unstable} printed, no Powerful
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[chitin, weaver]] });
  const g = new E(h.state);
  assert.ok(!g.ownAttrs(ent(h, weaver)!).has('Powerful'), 'premise: the Statweaver has no Powerful of its own');
  assert.ok(g.effAttrs(ent(h, weaver)!).has('Powerful'), 'combat attribute: shared down the column');
  assert.ok(g.isUnstable(ent(h, weaver)!), 'premise: the Statweaver is Unstable');
  assert.ok(!g.isUnstable(ent(h, chitin)!), 'Unstable is not shared');
  effectDamage(h, (1 - A) as Seat, chitin, 9);
  effectDamage(h, (1 - A) as Seat, weaver, 9);
  assert.ok(h.state.players[A]!.bin.includes('Chitin Shredder'), 'the column-mate dies into the bin');
  assert.ok(!(h.state.players[A]!.erased ?? []).includes('Chitin Shredder'), 'and is not erased');
  assert.ok((h.state.players[A]!.erased ?? []).includes('Aberrant Statweaver'), 'the Unstable unit itself is erased');
  finishBattle(h);
});

test('cr:card.stats.what — an unblocked 4/3 deals 4 combat damage; a 7/5 survives 4 damage and dies at its fifth', () => {
  const h = new Harness(50533);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const rc = spawn(h, A, 'Rune Channeler');              // 4/3
  const whale = spawn(h, D, 'Good Whale');                // 7/5
  effectDamage(h, A, whale, 4);
  assert.ok(ent(h, whale) && !ent(h, whale)!.absent && unitsOf(h, D).some(u => u.id === whale), 'four damage: alive');
  effectDamage(h, A, whale, 1);
  assert.ok(!unitsOf(h, D).some(u => u.id === whale), 'five damage: dead');
  assert.ok(h.state.players[D]!.bin.includes('Good Whale'), 'and binned');
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[rc]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(life0 - h.state.players[D]!.life, 4, 'power 4: four damage');
  finishBattle(h);
});

test('cr:card.stats.units — Lonely Forager, a Spell Unit, resolves into play as a 3/1 unit, while a plain spell resolves into the bin', () => {
  const h = new Harness(50534);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'water', 3);
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Lonely Forager') });
  drain(h);
  const lf = unitsOf(h, P).find(u => u.card === 'Lonely Forager');
  assert.ok(lf, 'in play');
  assert.equal(lf!.kind, 'unit', 'as a unit');
  assert.deepEqual(new E(h.state).effStats(lf!), [3, 1], 'with its printed stats');
  assert.ok(!h.state.players[P]!.bin.includes('Lonely Forager'), 'not in the bin');
  h.state.players[P]!.bin.push('Sparkwraith');
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Resurrect') });
  drain(h);
  assert.ok(!unitsOf(h, P).some(u => u.card === 'Resurrect'), 'the plain spell does not enter play');
  assert.ok(h.state.players[P]!.bin.includes('Resurrect'), 'it is binned');
});

test('cr:card.stats.changes — a -2/-2 that Jelly gives until regroup ends at regroup while a +1/+1 counter stays', () => {
  const h = new Harness(50535);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');                // 7/5
  withE(h, e => { e.addCounters(e.entity(whale)!, 1, A); });
  giveResources(h, D, 'water', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Jelly') });   // Target unit gains -2/-2 until regroup
  pick(h, { unit: whale });
  drain(h);
  assert.deepEqual(new E(h.state).effStats(ent(h, whale)!), [6, 4], 'counter +1/+1 and the -2/-2 both apply');
  finishBattle(h);
  assert.equal(h.state.phase, 'deploy');
  ent(h, whale)!.damage = 0;
  assert.deepEqual(new E(h.state).effStats(ent(h, whale)!), [8, 6], 'after regroup: the -2/-2 is gone, the counter stays');
  assert.equal(ent(h, whale)!.counters, 1);
});

test('cr:card.timing.what — every card has one timing (none, Haste or Battle) and Virus is its own mark; a Battle unit is refused in deployment and offered in battle', () => {
  const rows = Object.values(PRINTED as Record<string, { name: string; timing: string; virus: boolean }>);
  assert.deepEqual([...new Set(rows.map(r => r.timing))].sort(), ['battle', 'deploy', 'haste']);
  assert.ok(rows.every(r => typeof r.virus === 'boolean'), 'Virus is a separate flag on every card');
  const h = new Harness(50536);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'water', 4);
  give(h, P, 'Surly Stalker');                            // {Battle} [bb] 4
  give(h, P, 'Ignis Sprite');                             // no icon
  giveResources(h, P, 'fire', 1);
  assert.ok(playable(h, P, 'Ignis Sprite'), 'no icon: offered in deployment');
  assert.ok(!playable(h, P, 'Surly Stalker'), 'Battle icon: refused in deployment');
  h.state.players[P]!.hand.splice(handIdx(h, P, 'Ignis Sprite'), 1);
  toNextBattle(h, (1 - P) as Seat);
  const A = h.state.battle!.attacker;
  const atk = spawn(h, A, 'Unit Token');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  passTo(h, P);
  assert.ok(playable(h, P, 'Surly Stalker'), 'Battle icon: offered in battle');
  finishBattle(h);
});

test('cr:card.augment-box.permission — A Pile of Rubbish, which prints the augment symbol, is applied as an augment from hand, from bin and from cache', () => {
  for (const from of ['hand', 'bin', 'cache'] as const) {
    const h = new Harness(50537);
    toDeployment(h);
    const P = h.state.deployPlayer!;
    const host = spawn(h, P, 'Rune Channeler');
    giveResources(h, P, 'metal', 2);
    let index: number;
    if (from === 'hand') index = give(h, P, 'A Pile of Rubbish');
    else if (from === 'bin') { h.state.players[P]!.bin.push('A Pile of Rubbish'); index = h.state.players[P]!.bin.length - 1; }
    else {
      h.q.deckOf(P).unshift('A Pile of Rubbish');
      withE(h, e => { e.glimpse(P, 1); });
      index = h.state.players[P]!.cache!.findIndex(c => c.card === 'A Pile of Rubbish');
      assert.equal(h.q.cachePermission(P, index), 'glimpse', 'premise: a live glimpse');
    }
    assert.ok(legalActions(h.state, P).some(a => a.type === 'augment' && a.from === from && a.index === index), `${from}: offered`);
    h.do({ type: 'augment', seat: P, from, index, hostId: host });
    assert.ok(ent(h, host)!.mods.length === 1, `${from}: the augment is attached`);
  }
});
