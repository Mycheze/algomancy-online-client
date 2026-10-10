/**
 * Comprehensive rules, unit U21 (other keyword abilities: Haste, Ambush,
 * Unstable) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U21
 * (data/comprehensive-rules/build/probes/U21/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U21.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E, IllegalAction } from '../src/engine.ts';
import type { Seat } from '../src/types.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, handIdx, offered, pass, pick, spawn, toDeployment,
  toNextBattle, tokensOf, unitsOf, withE,
} from './util.ts';

const passUntil = (h: Harness, seat: Seat) => { let g = 12; while (h.state.priority !== seat && g-- > 0) pass(h); };
/** resolve the stack, taking the first option of every decision on the way */
const drain = (h: Harness) => {
  let g = 40;
  while ((h.state.stack.length || h.state.decision) && g-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
};
const expended = (h: Harness, s: Seat) => h.state.players[s]!.resources.filter(r => r.state === 'expended').length;
const labels = (h: Harness): string[] => (h.state.decision?.options ?? []).map(o => o.label);
function decide(h: Harness, match: (label: string) => boolean): void {
  const d = h.state.decision!;
  const i = d.options.findIndex(o => match(o.label));
  assert.notEqual(i, -1, `no option matching; menu was [${labels(h).join(' | ')}]`);
  h.do({ type: 'decide', seat: d.seat, choice: i });
}

// ── Haste ────────────────────────────────────────────────────────────────

test('cr:keywords.abilities.haste — a Haste card is also offered and playable during deployment, not only in the haste step', () => {
  const h = new Harness(52101);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'water', 3);                    // Tidal Menace: b / 3, {Haste}
  const idx = give(h, P, 'Tidal Menace');
  assert.equal(h.state.phase, 'deploy');
  assert.ok(h.legal(P).some(a => a.type === 'playCard' && a.handIndex === idx),
    'the Haste card is offered at deployment');
  h.do({ type: 'playCard', seat: P, handIndex: idx });
  for (let g = 0; g < 6 && h.state.stack.length; g++) pass(h);
  assert.ok(unitsOf(h, P).some(u => u.card === 'Tidal Menace'), 'and it is played there');
});

// ── Ambush ───────────────────────────────────────────────────────────────

/** A attacks with a Unit Token; D defends holding Lurking Slimebeast ([3b] Ambush, main bb/4) */
function slimeBattle(seed: number, res: [string, number][]) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const ally = spawn(h, D, 'Bubb');
  for (const [k, n] of res) giveResources(h, D, k as never, n);
  give(h, D, 'Lurking Slimebeast');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  passUntil(h, D);
  return { h, A, D, ally };
}

test('cr:keywords.abilities.ambush.cost — 4 mana with no water pip cannot Ambush [3b]; 1 water and 3 fire can, and spend exactly 3', () => {
  {
    const { h, D } = slimeBattle(52201, [['fire', 4]]);
    assert.equal(h.state.priority, D);
    assert.ok(!h.legal(D).some(a => a.type === 'playCard' && a.mode === 'ambush'), 'not offered without the pip');
    assert.throws(() => h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Lurking Slimebeast'), mode: 'ambush' }),
      IllegalAction, 'and refused');
  }
  {
    const { h, D, ally } = slimeBattle(52202, [['water', 1], ['fire', 3]]);
    assert.ok(h.legal(D).some(a => a.type === 'playCard' && a.mode === 'ambush'), 'offered with one water pip');
    h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Lurking Slimebeast'), mode: 'ambush' });
    pick(h, { unit: ally });
    assert.equal(expended(h, D), 3, 'the Ambush mana (3) is spent, not the main cost (4)');
    drain(h);
    assert.ok(unitsOf(h, D).some(u => u.card === 'Lurking Slimebeast'));
    finishBattle(h);
  }
});

test('cr:keywords.abilities.ambush.timing — an Ambush is neither offered nor accepted during deployment', () => {
  const h = new Harness(52206);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Bubb');
  giveResources(h, P, 'water', 6);
  const idx = give(h, P, 'Lurking Slimebeast');
  assert.equal(h.state.phase, 'deploy');
  assert.ok(h.legal(P).some(a => a.type === 'playCard' && a.handIndex === idx && !a.mode), 'control: the plain play is offered');
  assert.ok(!h.legal(P).some(a => a.type === 'playCard' && a.mode === 'ambush'), 'the Ambush mode is not');
  assert.throws(() => h.do({ type: 'playCard', seat: P, handIndex: idx, mode: 'ambush' }), /Ambush is played during battle/);
});

test('cr:keywords.abilities.ambush.target — the Ambush menu holds only allies of the caster in the battle region', () => {
  const h = new Harness(52205);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const raider = spawn(h, A, 'Unit Token');
  const homebody = spawn(h, A, 'Unit Token');           // A's, but stays home
  const enemy = spawn(h, D, 'Bubb');                     // D's, in the battle region
  giveResources(h, A, 'water', 4);
  give(h, A, 'Lurking Slimebeast');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[raider]] });
  passUntil(h, A);
  assert.equal(ent(h, enemy)!.region, h.state.battle!.region, 'the enemy is in the battle region');
  assert.notEqual(ent(h, homebody)!.region, h.state.battle!.region, 'the homebody is not');
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Lurking Slimebeast'), mode: 'ambush' });
  const menu = offered(h);
  assert.ok(menu.includes(JSON.stringify({ unit: raider })), 'the attacking ally is offered');
  assert.ok(!menu.includes(JSON.stringify({ unit: enemy })), 'the enemy unit is not');
  assert.ok(!menu.includes(JSON.stringify({ unit: homebody })), 'an ally outside the battle region is not');
  pick(h, { unit: raider });
  finishBattle(h);
});

test('cr:keywords.abilities.ambush.target — a redirect (Enigmatic Warder) cannot move an Ambush onto a unit of the opponent', () => {
  const h = new Harness(52102);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const warder = spawn(h, A, 'Enigmatic Warder');     // A's: an opponent of the ambusher
  const ally = spawn(h, D, 'Bubb');
  giveResources(h, A, 'earth', 4);
  giveResources(h, D, 'water', 5);
  give(h, D, 'Orblish Horroth');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[warder]] });
  passUntil(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Orblish Horroth'), mode: 'ambush' });
  pick(h, { unit: ally });
  const amb = h.state.stack.find(i => i.kind === 'ambush')!;
  assert.ok(amb, 'the Ambush is on the stack');
  passUntil(h, A);
  h.do({ type: 'activateAbility', seat: A, entityId: warder, abilityIndex: 0, via: 'augment' });
  pick(h, { stack: amb.id });
  drain(h);
  const wlog = h.log.filter(l => l.includes('Enigmatic Warder'));
  assert.ok(wlog.length > 0, 'non-vacuity: the Warder ability was activated and resolved: ' + wlog.join(' / '));
  assert.ok(ent(h, warder), 'the Warder was NOT recalled by the Ambush');
  assert.equal(ent(h, warder)!.controller, A);
  assert.ok(h.state.players[D]!.hand.includes('Bubb'), 'the Ambush still recalled its own ally');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Orblish Horroth'), 'and the ambusher took its place');
  finishBattle(h);
});

test('cr:keywords.abilities.ambush.saves — ambushing the target of a Fireball saves it; the Fireball fizzles and does not hit the ambusher', () => {
  const h = new Harness(52103);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const sprite = spawn(h, A, 'Ignis Sprite');          // + a Fireball 1 token for A
  const victim = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'water', 5);
  give(h, D, 'Orblish Horroth');
  toNextBattle(h, A);
  const fb = tokensOf(h, A)[0]!;
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]], spellTokens: [fb.id] });
  passUntil(h, A);
  h.do({ type: 'castSpellToken', seat: A, entityId: fb.id });
  pick(h, { unit: victim });
  assert.ok(h.state.stack.some(i => i.card === 'Fireball'), 'the Fireball is on the stack aimed at the victim');
  passUntil(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Orblish Horroth'), mode: 'ambush' });
  pick(h, { unit: victim });
  drain(h);
  assert.ok(!ent(h, victim), 'the victim left play');
  const orb = unitsOf(h, D).find(u => u.card === 'Orblish Horroth');
  assert.ok(orb, 'the ambusher is in play');
  assert.equal(orb!.damage ?? 0, 0, 'the Fireball did not change target to the ambusher');
  assert.ok(h.log.some(l => /Fireball/.test(l) && /fizzle/i.test(l)), 'the Fireball fizzled');
  finishBattle(h);
});

test('cr:keywords.abilities.ambush.spell-effect — Dreadwave Devourer, which negates a target spell effect, negates an Ambush; the ambusher goes to the bin', () => {
  const h = new Harness(52203);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const raider = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 3);
  giveResources(h, D, 'water', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[raider]] });
  passUntil(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: raider });
  const amb = h.state.stack.find(i => i.kind === 'ambush')!;
  assert.ok(amb, 'the Ambush is on the stack');
  passUntil(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dreadwave Devourer') });
  assert.ok(offered(h).includes(JSON.stringify({ stack: amb.id })), 'the Ambush is a legal spell effect target');
  pick(h, { stack: amb.id });
  drain(h);
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Lurking Slimebeast'), 'the ambusher never arrived');
  assert.ok(h.state.players[A]!.bin.includes('Lurking Slimebeast'), 'the ambushing card is in its bin');
  assert.ok(ent(h, raider), 'its target was not recalled');
  finishBattle(h);
});

test('cr:keywords.abilities.ambush.spell-effect — a negated Ambush (Void Mandible) puts the ambushing card into the bin', () => {
  const h = new Harness(52104);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Void Mandible');
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'water', 3);
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: raider });
  pass(h); pass(h);
  assert.equal(h.state.stack.length, 0, 'the negated ambush left the stack');
  assert.ok(!unitsOf(h, D).some(u => u.card === 'Lurking Slimebeast'), 'the ambusher never arrived');
  assert.ok(h.state.players[D]!.bin.includes('Lurking Slimebeast'), 'the ambushing card is in its bin');
  finishBattle(h);
});

/** D casts Tides of the Cosmos in the attack window of A with `deck` on top */
function tides(seed: number, deck: string[]) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  spawn(h, D, 'Curio Drifter');                       // D's ally to ambush
  giveResources(h, D, 'water', 11);
  toNextBattle(h, A);
  const fill = Array(Math.max(0, 8 - deck.length)).fill('Good Whale');
  h.state.sharedDeck = [...deck, ...fill, 'Dune Drifter'];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tides of the Cosmos') });
  pass(h); pass(h);
  return { h, A, D };
}

test('cr:keywords.abilities.ambush.tides — the Tides budget reads the MAIN cost, and an Ambush via Tides pays nothing', () => {
  const { h, D } = tides(52204, ['Engorged Caudex', 'Lurking Slimebeast', 'Mirage Walker']);
  assert.ok(labels(h).some(l => l.startsWith('Lurking Slimebeast')), 'control: Slimebeast is offered on the first pick');
  decide(h, l => l.startsWith('Engorged Caudex'));    // main 5 -> 3 left
  assert.ok(!labels(h).some(l => l.startsWith('Lurking Slimebeast')),
    'Slimebeast (main 4, Ambush 3) no longer fits a budget of 3');
  assert.ok(labels(h).some(l => l.startsWith('Mirage Walker')),
    'Mirage Walker (main 3, Ambush 4) still fits');
  decide(h, l => l.startsWith('Mirage Walker'));
  const openBefore = h.state.players[D]!.resources.filter(r => r.state === 'open').length;
  let guard = 10;
  while (h.state.decision && !labels(h).some(l => /as an Ambush/.test(l)) && guard-- > 0) {
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  }
  decide(h, l => /Mirage Walker as an Ambush/.test(l));
  assert.ok(h.state.stack.some(i => i.kind === 'ambush' && i.card === 'Mirage Walker'), 'played as an Ambush');
  drain(h);
  assert.ok(unitsOf(h, D).some(u => u.card === 'Mirage Walker'), 'the ambusher stands in play');
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'open').length, openBefore,
    'no Ambush cost was paid');
  finishBattle(h);
});

// ── Unstable ─────────────────────────────────────────────────────────────

test('cr:keywords.abilities.unstable.still-dies — a modded (Unstable) unit that is destroyed still dies: a death watcher triggers, then it is erased', () => {
  const h = new Harness(52105);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const watcher = spawn(h, P, 'Refuse Reclaimer');
  const victim = spawn(h, P, 'The Foretold');
  withE(h, e => { e.attachMod(e.entity(victim)!, 'Chitin Shredder', P, 'augment'); });
  const before = effStats(h, watcher);
  withE(h, e => {
    assert.ok(e.isUnstable(e.entity(victim)!), 'the victim is Unstable (modded)');
    e.destroy(e.entity(victim)!, 'dies');
    e.settle();
  });
  for (let g = 0; g < 6 && (h.state.stack.length || h.state.decision); g++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.ok(h.events.some(ev => ev.type === 'died' && ev.data?.['card'] === 'The Foretold'), 'a died event fired');
  const after = effStats(h, watcher);
  assert.deepEqual(after, [before[0] + 1, before[1] + 1], 'the whenever-another-unit-dies ability triggered');
  assert.ok((h.state.players[P]!.erased ?? []).includes('The Foretold'), 'and the body was erased');
  assert.ok(!h.state.players[P]!.bin.includes('The Foretold'));
});

test('cr:keywords.abilities.unstable.until-regroup — a bin-played spell unit body loses its Unstable stamp at regroup', () => {
  const h = new Harness(52106);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.bin = ['Jelly'];
  giveResources(h, A, 'water', 3);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Abyssal Evocation') });
  pass(h); pass(h);
  h.do({ type: 'playFromBin', seat: A, binIndex: 0 });
  pick(h, { unit: atk });
  pass(h); pass(h);
  const body = unitsOf(h, A).find(u => u.card === 'Jelly')!;
  assert.equal(body.unstable, true, 'stamped while the battle runs');
  finishBattle(h);
  assert.equal(h.state.phase, 'deploy', 'the battle phase (and its regroup) is over');
  const later = ent(h, body.id);
  assert.ok(later, 'the body survived to the next deployment');
  const g = new E(h.state);
  assert.equal(g.isUnstable(g.entity(body.id)!), false, 'after regroup it is no longer Unstable');
});

test('cr:keywords.abilities.unstable.until-regroup — the stamp outlives the in-this-battle permission into round 2, and ends at regroup', () => {
  const h = new Harness(52207);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Conduit of Pain');
  const counter = spawn(h, D, 'Rune Channeler');       // so a round-2 battle happens
  giveResources(h, A, 'fire', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.bin = ['Jelly'];
  giveResources(h, A, 'water', 3);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Abyssal Evocation') });
  pass(h); pass(h);
  const r1 = h.state.battle!.region;
  h.do({ type: 'playFromBin', seat: A, binIndex: 0 });
  pick(h, { unit: atk });
  pass(h); pass(h);
  const body = unitsOf(h, A).find(u => u.card === 'Jelly')!;
  assert.equal(body.unstable, true, 'stamped in round 1');
  // drive round 1 to its end and stop as round 2 opens
  let g = 200;
  while (h.state.phase === 'battle' && h.state.battle!.round === 1 && g-- > 0) {
    const b = h.state.battle!, dec = h.state.decision;
    if (dec) h.do({ type: 'decide', seat: dec.seat, choice: dec.pickOrder ? dec.options.map((_, i) => i) : 0 } as never);
    else if (b.step === 'declare') h.do({ type: 'declareAttack', seat: b.attacker, columns: [] });
    else if (b.step === 'blocks') h.do({ type: 'declareBlocks', seat: b.defender, blocks: {}, send: [counter] });
    else pass(h);
  }
  assert.equal(h.state.phase, 'battle');
  assert.equal(h.state.battle!.round, 2, 'round 2 is open');
  const r2 = h.state.battle!.region;
  assert.notEqual(r1, r2, 'a different region');
  const e = new E(h.state);
  assert.equal(e.mayPlaySpellsFromBin(A, r2), false, 'the in-this-battle permission does not reach round 2');
  assert.ok(ent(h, body.id), 'the body is still in play');
  assert.equal(e.isUnstable(e.entity(body.id)!), true, 'but the body is still Unstable');
  finishBattle(h);
  const later = new E(h.state);
  assert.equal(later.isUnstable(later.entity(body.id)!), false, 'regroup ended it');
});

// ── Non-combat attributes ────────────────────────────────────────────────

test('cr:keywords.abilities.non-combat — Burst and Unstable are not combat attributes: a column shares Powerful but not Unstable', () => {
  // Burst and Unstable are never in any card's combat-attribute list; they are flags of their own
  let bursts = 0;
  for (const n of allCardNames()) {
    const c = getCard(n);
    assert.ok(!c.attrs.some(a => /^(burst|unstable)$/i.test(a)), `${n} lists a non-combat attribute as a combat one`);
    if (c.burst) bursts++;
  }
  assert.ok(bursts > 0, 'Burst cards exist in the pool, flagged outside the attribute list');
  // in a battle column the combat attribute spreads, the Unstable one does not
  const h = new Harness(52401);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'Chitin Shredder');       // 1/2 Powerful
  const mate = spawn(h, P, 'The Foretold');          // vanilla
  giveResources(h, P, 'earth', 2);
  h.do({ type: 'augment', seat: P, from: 'hand', index: give(h, P, 'Chitin Shredder'), hostId: host });
  toNextBattle(h, P);
  h.do({ type: 'declareAttack', seat: P, columns: [[mate, host]] });
  const q = new E(h.state);
  assert.deepEqual(q.columnOf(host), q.columnOf(mate), 'the two are column-mates');
  assert.ok(q.isUnstable(ent(h, host)!), 'the modded host is Unstable');
  assert.ok(q.effAttrs(ent(h, mate)!).has('Powerful'), 'the combat attribute is shared down the column');
  assert.ok(!q.isUnstable(ent(h, mate)!), 'the non-combat one is not: the mate is not Unstable');
  const shared = q.effAttrs(ent(h, mate)!);
  assert.ok(!shared.has('Unstable') && !shared.has('Burst'), 'no non-combat attribute is in the shared set');
});
