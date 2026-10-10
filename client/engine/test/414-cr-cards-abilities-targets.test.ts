/**
 * Comprehensive rules, unit U03 (cards, tokens, faces, copies; abilities; targets) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U03
 * (data/comprehensive-rules/build/probes/U03/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U03.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * The two tests titled "engine differs" are the exception: their rules state
 * the ruling and carry an engineDiffers mark, and these tests pin the
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
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import printed from '../src/cards/printed.json' with { type: 'json' };
import type { Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, spawn, tokensOf, toDeployment, toNextBattle,
  unitsOf, withE,
} from './util.ts';

/** answer every decision (first option, or the full order) and pass until the stack is empty */
function drain(h: Harness): void {
  let guard = 60;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    const d = h.state.decision;
    if (d?.pickOrder) h.do({ type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) });
    else if (d) pick(h, d.options[0]!.value);
    else { pass(h); pass(h); }
  }
}

// ── abilities ────────────────────────────────────────────────────────────────

test('cr:concepts.abilities.granted.is-ability — a Reforge the Dead grant made BEFORE an ability strip is removed; one made AFTER it still fires', () => {
  const run = (stripFirst: boolean): number => {
    const h = new Harness(31602);
    toDeployment(h);
    const A = h.state.deployPlayer!;
    const tok = spawn(h, A, 'Unit Token');
    giveResources(h, A, 'metal', 3);
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
    const strip = (): void => withE(h, e => e.suppress(e.s.entities[tok]!, 'Suppression Field', { abilities: true }));
    if (stripFirst) strip();
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Reforge the Dead') });
    pass(h); pass(h);
    assert.equal(ent(h, tok)!.granted?.length, 1, 'the grant landed');
    if (!stripFirst) strip();
    {
      const e = new E(h.state);
      e.destroy(ent(h, tok)!, 'is deleted');
      e.settle();
      h.state = e.s;
    }
    let guard = 10;
    while (h.state.stack.length && guard-- > 0) { pass(h); pass(h); }
    const robots = unitsOf(h, A).filter(u => u.card === 'Robot').length;
    finishBattle(h);
    return robots;
  };
  assert.equal(run(true), 1, 'stripped first, then granted: the later grant still fires');
  assert.equal(run(false), 0, 'granted first, then stripped: the granted ability is gone');
});

test('cr:concepts.abilities.once.trashed — two copies of Maw of Despair discarded in one turn each trigger their bounded trash ability', () => {
  const h = new Harness(31603);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  give(h, P, 'Maw of Despair');                              // When I am trashed, [Switch1] Glimpse 2.
  give(h, P, 'Maw of Despair');
  const start = h.log.length;
  withE(h, e => { e.discardFromHand(P, e.player(P).hand.indexOf('Maw of Despair')); e.settle(); });
  drain(h);
  withE(h, e => { e.discardFromHand(P, e.player(P).hand.indexOf('Maw of Despair')); e.settle(); });
  drain(h);
  const triggers = h.log.slice(start).filter(l => l.startsWith('Trigger: Maw of Despair'));
  assert.equal(triggers.length, 2, `both copies triggered:\n${h.log.slice(start).join('\n')}`);
});

test('cr:concepts.abilities.once.bin — two copies of Rotling leaving ONE bin in the same turn share one [Switch1] use', () => {
  const h = new Harness(31604);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 3);
  h.state.players[P]!.bin.push('Rotling', 'Rotling');
  withE(h, e => { e.removeFromBin(P, e.player(P).bin.lastIndexOf('Rotling'), 'test'); e.settle(); });
  assert.ok(h.state.decision, 'the first copy is offered its pay-[1]');
  pick(h, h.state.decision!.options.find(o => String(o.label).startsWith('Pay [1]'))!.value);
  withE(h, e => { e.removeFromBin(P, e.player(P).bin.lastIndexOf('Rotling'), 'test'); e.settle(); });
  assert.equal(h.state.decision, null, 'the second copy, out of the same bin the same turn, is not offered');
});

// ── targets ──────────────────────────────────────────────────────────────────

test('cr:concepts.targets.becomes-targeted — the trigger of Mohruung goes on the stack ABOVE the spell that targeted it, and the Crystal is made while the spell still waits', () => {
  const h = new Harness(30301);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const mohr = spawn(h, D, 'Mohruung');                       // 1/5: survives one Twin Flame
  giveResources(h, A, 'fire', 3);                             // Twin Flame rr/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  pick(h, { unit: mohr });
  if (h.state.decision) pick(h, { doneTargets: true });       // "up to two": stop at one
  const kinds = h.state.stack.map(i => `${i.kind}:${i.card ?? i.label}`);
  const tfAt = h.state.stack.findIndex(i => i.card === 'Twin Flame');
  const trigAt = h.state.stack.findIndex(i => i.kind === 'triggered' && (i.card === 'Mohruung' || /Mohruung/.test(i.label)));
  assert.ok(tfAt >= 0 && trigAt >= 0, `both on the stack: ${kinds.join(', ')}`);
  assert.ok(trigAt > tfAt, `the trigger sits ABOVE the spell (stack bottom to top: ${kinds.join(', ')})`);
  pass(h); pass(h);                                           // resolve the top item only
  assert.ok(tokensOf(h, D).some(t => t.card === 'Crystal'), 'the Crystal is made first');
  assert.ok(h.state.stack.some(i => i.card === 'Twin Flame'), 'while Twin Flame is still waiting on the stack');
  finishBattle(h);
});

test('cr:concepts.targets.becomes-targeted — engine differs: a graft onto Mohruung queues the trigger before the graft attaches, but the Crystal is made only after it attaches', () => {
  const h = new Harness(33603);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let mohr = -1;
  withE(h, e => { mohr = e.spawnUnit(A, 'Mohruung', e.homeRegion(A)).id; });
  giveResources(h, A, 'fire', 2);
  const start = h.log.length;
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Flame Juggle'), hostId: mohr, position: 0 });
  assert.equal(ent(h, mohr)!.mods.length, 1, 'the graft is already attached when the action returns');
  drain(h);
  const lines = h.log.slice(start);
  const iTrig = lines.findIndex(l => /^Trigger: Mohruung/.test(l));
  const iAttach = lines.findIndex(l => /Flame Juggle grafts onto Mohruung/.test(l));
  const iCrystal = lines.findIndex(l => /creates a Crystal 2/.test(l));
  assert.ok(tokensOf(h, A).some(t => t.card === 'Crystal'), 'a Crystal was made');
  assert.ok(iTrig >= 0 && iTrig < iAttach, `the trigger is queued before the graft attaches:\n${lines.join('\n')}`);
  assert.ok(iAttach < iCrystal, `the graft is attached BEFORE the trigger resolves:\n${lines.join('\n')}`);
  assert.equal(ent(h, mohr)!.mods.length, 1);
});

function boonSetup(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const atk2 = spawn(h, A, 'Unit Token');
  const warder = spawn(h, D, 'Enigmatic Warder');            // 1/2
  giveResources(h, A, 'fire', 2);                            // Channeled Boon rr/2
  giveResources(h, D, 'earth', 2);                           // the Warder [two]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [atk2]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });
  const boonId = h.state.stack.find(i => i.card === 'Channeled Boon')!.id;
  // the only target of the Boon leaves play while the Boon waits on the stack
  withE(h, e => { e.destroy(e.entity(atk)!, 'is deleted'); e.settle(); });
  assert.equal(ent(h, atk), undefined, 'setup: the original target is gone');
  return { h, A, D, warder, boonId };
}

test('cr:concepts.targets.change.rescue — control: a spell whose only target is gone, left alone, fizzles', () => {
  const { h, warder } = boonSetup(33601);
  const start = h.log.length;
  pass(h); pass(h);
  assert.ok(h.log.slice(start).some(l => /Channeled Boon fizzles/.test(l)), h.log.slice(start).join('\n'));
  assert.deepEqual(effStats(h, warder), [1, 2], 'nothing was buffed');
  finishBattle(h);
});

test('cr:concepts.targets.change.rescue — the same spell given a new legal target by Enigmatic Warder resolves instead of fizzling', () => {
  const { h, A, D, warder, boonId } = boonSetup(33601);
  if (h.state.priority === A) pass(h);
  h.do({ type: 'activateAbility', seat: D, entityId: warder, abilityIndex: 0, via: 'augment' });
  pick(h, { stack: boonId });
  pass(h); pass(h);                                          // the Warder resolves
  const start = h.log.length;
  pass(h); pass(h);                                          // the Boon resolves
  assert.ok(!h.log.slice(start).some(l => /fizzles/.test(l)), h.log.slice(start).join('\n'));
  assert.deepEqual(effStats(h, warder), [5, 6], 'the Boon resolved on its new target');
  finishBattle(h);
});

type TargetList = { player: Seat }[];

test('cr:concepts.targets.legal.player — in deployment "target player" offers only the controller and "target opponent" offers nobody; in battle both seats', () => {
  const h = new Harness(33602);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  let dep: { player: string; opponent: string } = { player: '', opponent: '' };
  withE(h, e => {
    const r = e.homeRegion(A);
    dep = {
      player: JSON.stringify(e.targetCandidates({ what: 'player' } as never, r, undefined, A)),
      opponent: JSON.stringify(e.targetCandidates({ what: 'opponent' } as never, r, undefined, A)),
    };
  });
  assert.equal(dep.player, JSON.stringify([{ player: A }]), `deployment player: ${dep.player}`);
  assert.equal(dep.opponent, '[]', `deployment opponent: ${dep.opponent}`);
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let bat: { player: TargetList; opponent: TargetList } = { player: [], opponent: [] };
  withE(h, e => {
    const r = h.state.battle!.region;
    bat = {
      player: e.targetCandidates({ what: 'player' } as never, r, undefined, D) as TargetList,
      opponent: e.targetCandidates({ what: 'opponent' } as never, r, undefined, D) as TargetList,
    };
  });
  assert.deepEqual(new Set(bat.player.map(t => t.player)), new Set([A, D]), 'battle: both players');
  assert.deepEqual(bat.opponent.map(t => t.player), [A], 'battle: opponent = the non-controller only');
  finishBattle(h);
});

test('cr:concepts.targets.legal.player — Soul Siphon played in battle offers the effect controller as well as the opponent', () => {
  const h = new Harness(30303);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'water', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Soul Siphon') });
  const vals = h.state.decision!.options.map(o => JSON.stringify(o.value));
  assert.ok(vals.includes(JSON.stringify({ player: D })), `the caster may target itself: ${vals.join(' ')}`);
  assert.ok(vals.includes(JSON.stringify({ player: A })), 'and the opponent');
  pick(h, { player: D });
  finishBattle(h);
});

test('cr:concepts.targets.must-be-targeted.choice-only — a Gatekeeper of Souls arriving after targets were chosen does not make them illegal', () => {
  const h = new Harness(30304);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'fire', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  pick(h, { unit: victim });
  if (h.state.decision) pick(h, { doneTargets: true });
  let gk = -1;
  withE(h, e => { gk = e.spawnUnit(D, 'Gatekeeper of Souls', h.state.battle!.region).id; });
  assert.ok(ent(h, gk), 'setup: a Gatekeeper now stands in the battle region');
  pass(h); pass(h);
  assert.equal(ent(h, victim), undefined, 'the 1/1 chosen before the Gatekeeper arrived still took the damage');
  assert.equal(ent(h, gk)!.damage ?? 0, 0, 'and the Gatekeeper was not substituted');
  finishBattle(h);
});

test('cr:concepts.targets.must-be-targeted — engine differs: Gatekeeper of Souls compels the target of an Overbloom played in deployment, outside battle', () => {
  const h = new Harness(30305);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const gk = spawn(h, P, 'Gatekeeper of Souls');
  const mine = spawn(h, P, 'Unit Token');
  giveResources(h, P, 'wood', 6);
  const idx = give(h, P, 'Overbloom');                        // deployment spell: "Target unit gains +7/+7 until regroup."
  assert.equal(h.state.phase, 'deploy', 'setup: deployment, not battle');
  h.do({ type: 'playCard', seat: P, handIndex: idx });
  const vals = h.state.decision!.options.map(o => JSON.stringify(o.value));
  assert.ok(vals.includes(JSON.stringify({ unit: gk })), 'the Gatekeeper is offered');
  assert.ok(!vals.includes(JSON.stringify({ unit: mine })), `the other unit is not offered: ${vals.join(' ')}`);
});

// ── tester additions: the rules no verifier probe demonstrated ───────────────

const openOf = (h: Harness, seat: Seat): number => h.state.players[seat]!.resources.filter(r => r.state === 'open').length;
const forgeAct = (h: Harness, seat: Seat, lf: number) =>
  h.legal(seat).filter(a => a.type === 'activateAbility' && a.entityId === lf);

test('cr:concepts.cards.card.characteristics — every card in the pool has a name, and most have ability text', () => {
  const cards = Object.values(printed) as { name: string; text: string }[];
  assert.ok(cards.length > 400, `the whole pool: ${cards.length}`);
  for (const c of cards) {
    assert.ok(typeof c.name === 'string' && c.name.trim().length > 0, `a card with no name: ${JSON.stringify(c)}`);
    assert.equal(getCard(c.name).name, c.name, `the engine knows ${c.name} by its name`);
  }
  const withText = cards.filter(c => (c.text ?? '').trim().length > 0).length;
  assert.ok(withText * 2 > cards.length, `most cards have abilities: ${withText} of ${cards.length}`);
  assert.ok(withText < cards.length, 'and not every card does');
});

test('cr:concepts.abilities.activated — Living Forge cannot activate its ability without the cost before the colon, and paying it gives the effect after', () => {
  const h = new Harness(41401);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const lf = spawn(h, P, 'Living Forge');                    // [Augment] [three]: Create a Robot 2.
  giveResources(h, P, 'metal', 2);
  assert.equal(forgeAct(h, P, lf).length, 0, 'two resources: the ability is not offered');
  assert.throws(() => h.do({ type: 'activateAbility', seat: P, entityId: lf, abilityIndex: 0, via: 'augment' }),
    /cannot pay/, 'and is refused');
  giveResources(h, P, 'metal', 1);
  assert.equal(forgeAct(h, P, lf).length, 1, 'three resources: offered');
  h.do({ type: 'activateAbility', seat: P, entityId: lf, abilityIndex: 0, via: 'augment' });
  assert.equal(openOf(h, P), 0, 'the cost of three was paid');
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Robot').length, 1, 'and the effect happened: a Robot');
});

test('cr:concepts.abilities.activated.when — Living Forge activates twice in one deployment and again with priority in battle, as long as its cost is paid', () => {
  const h = new Harness(41402);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const lf = spawn(h, P, 'Living Forge');
  giveResources(h, P, 'metal', 6);
  h.do({ type: 'activateAbility', seat: P, entityId: lf, abilityIndex: 0, via: 'augment' });
  h.do({ type: 'activateAbility', seat: P, entityId: lf, abilityIndex: 0, via: 'augment' });
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Robot').length, 2, 'twice in deployment');
  assert.equal(forgeAct(h, P, lf).length, 0, 'and not a third time with nothing left to pay');
  // battle: the Forge's controller defends at home and activates when they hold priority
  const atkSeat = (1 - P) as Seat;
  const atk = spawn(h, atkSeat, 'Unit Token');
  toNextBattle(h, atkSeat);
  h.do({ type: 'declareAttack', seat: atkSeat, columns: [[atk]] });
  assert.equal(h.state.battle!.region, ent(h, lf)!.region, 'setup: the battle is in the Forge region');
  giveResources(h, P, 'metal', 3);
  if (h.state.priority !== P) pass(h);
  assert.equal(h.state.priority, P, 'the Forge controller holds priority');
  const before = unitsOf(h, P).filter(u => u.card === 'Robot').length;
  h.do({ type: 'activateAbility', seat: P, entityId: lf, abilityIndex: 0, via: 'augment' });
  pass(h); pass(h);
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Robot').length, before + 1, 'and in battle');
  finishBattle(h);
});

test('cr:concepts.abilities.triggered — a When ability fires on its event, an After combat ability after combat, and an At the end of turn ability at the end of the turn', () => {
  const h = new Harness(41403);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const rot0 = h.state.players[P]!.rot ?? 0;
  let start = h.log.length;
  giveResources(h, P, 'dark', 1);
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Skittering Blight') });   // When I spawn, gain a rot.
  assert.ok(h.log.slice(start).some(l => /^Trigger: Skittering Blight/.test(l)), h.log.slice(start).join('\n'));
  assert.equal(h.state.players[P]!.rot ?? 0, rot0 + 1, 'When: the rot was gained on the spawn');
  spawn(h, P, 'Harbinger of Immolation');                     // At the end of turn, create a Fireball X
  const wisp = spawn(h, P, 'Wisp');                           // After combat, sacrifice me.
  assert.equal(tokensOf(h, P).filter(t => t.card === 'Fireball').length, 0, 'no Fireball before the turn ends');
  start = h.log.length;
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.ok(h.log.slice(start).some(l => /^Trigger: Harbinger of Immolation/.test(l)), h.log.slice(start).join('\n'));
  assert.ok(tokensOf(h, P).some(t => t.card === 'Fireball'), 'At the end of turn: a Fireball was made');
  h.state.initiative = P;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  for (const seat of [0, 1] as Seat[]) if (h.state.phase === 'planning' && h.state.hasteDone && !h.state.hasteDone[seat]) h.do({ type: 'doneHaste', seat });
  h.do({ type: 'declareAttack', seat: P, columns: [[wisp]] });
  assert.ok(ent(h, wisp), 'the Wisp is attacking');
  start = h.log.length;
  finishBattle(h);
  assert.equal(ent(h, wisp), undefined, 'After combat: the Wisp sacrificed itself');
  assert.ok(h.log.slice(start).some(l => /^Trigger: Wisp/.test(l)), h.log.slice(start).join('\n'));
});

test('cr:concepts.abilities.static — Glowhaven Elder buffs the other units for exactly as long as it is in play', () => {
  const h = new Harness(41404);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const tok = spawn(h, P, 'Unit Token');
  const base = effStats(h, tok);
  const elder = spawn(h, P, 'Glowhaven Elder');               // Your other units gain +1/+1.
  assert.deepEqual(effStats(h, tok), [base[0] + 1, base[1] + 1], 'in play: +1/+1');
  assert.deepEqual(effStats(h, elder), [3, 3], 'not itself');
  withE(h, e => { e.destroy(e.entity(elder)!, 'is deleted'); e.settle(); });
  while (h.state.stack.length) { pass(h); pass(h); }
  assert.equal(ent(h, elder), undefined, 'the Elder has left play');
  assert.deepEqual(effStats(h, tok), base, 'gone with it');
});

test('cr:concepts.abilities.replacement — Flux Resonator changes the Robot counters as the Forge ability resolves, without a stack item or a priority pass of its own', () => {
  const h = new Harness(41405);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const atkSeat = (1 - P) as Seat;
  spawn(h, P, 'Flux Resonator');                              // If counters would be put … put that many plus one instead.
  const lf = spawn(h, P, 'Living Forge');
  const atk = spawn(h, atkSeat, 'Unit Token');
  toNextBattle(h, atkSeat);
  h.do({ type: 'declareAttack', seat: atkSeat, columns: [[atk]] });
  giveResources(h, P, 'metal', 3);
  if (h.state.priority !== P) pass(h);
  h.do({ type: 'activateAbility', seat: P, entityId: lf, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.stack.length, 1, 'only the Forge ability is on the stack');
  const start = h.log.length;
  pass(h); pass(h);                                           // one round of passes resolves it
  assert.equal(h.state.stack.length, 0, 'nothing was added to the stack by the replacement');
  const robot = unitsOf(h, P).find(u => u.card === 'Robot')!;
  assert.equal(robot.counters, 3, 'the Robot 2 arrived with 2 + 1 counters');
  assert.ok(!h.log.slice(start).some(l => /^Trigger: Flux Resonator/.test(l)), h.log.slice(start).join('\n'));
  finishBattle(h);
});

test('cr:concepts.targets.not-target.distribution — Channel Through distributes onto an enemy Mohruung at resolution without targeting it', () => {
  const h = new Harness(41406);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ally = spawn(h, D, 'Good Whale');
  const mohr = spawn(h, A, 'Mohruung');                       // 1/5: When I become targeted, create a Crystal 2
  giveResources(h, D, 'earth', 2);
  giveResources(h, D, 'fire', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mohr]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channel Through') });
  pick(h, 1);                                                 // X = 1
  pick(h, { player: A });
  pick(h, { unit: ally });
  const item = h.state.stack[h.state.stack.length - 1]!;
  assert.deepEqual(item.parts[0]!.targets, [{ player: A }, { unit: ally }], 'the targets are the opponent and the ally');
  assert.equal(ent(h, mohr)!.damage ?? 0, 0, 'nothing is divided yet');
  assert.ok(!h.state.stack.some(i => i.card === 'Mohruung' || /Mohruung/.test(i.label)), 'Mohruung did not trigger at cast');
  const start = h.log.length;
  let guard = 10;
  while (h.state.stack.length && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else { pass(h); pass(h); }
  }
  assert.equal(ent(h, mohr)!.damage, 2, `the 2 damage was divided onto Mohruung at resolution:\n${h.log.slice(start).join('\n')}`);
  assert.ok(!h.log.slice(start).some(l => /^Trigger: Mohruung/.test(l)), `and it was never targeted:\n${h.log.slice(start).join('\n')}`);
  assert.ok(!tokensOf(h, A).some(t => t.card === 'Crystal'), 'so no Crystal');
  finishBattle(h);
});

test('cr:concepts.targets.region.global — a stack item and the cards in either bin are offered from every region, while a unit is offered only in its own', () => {
  const h = new Harness(41407);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const foe = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'fire', 3);
  toNextBattle(h, A);
  h.state.players[A]!.bin.push('Twin Flame');
  h.state.players[D]!.bin.push('Overbloom');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  pick(h, { unit: foe });
  if (h.state.decision) pick(h, { doneTargets: true });
  const battle = h.state.battle!.region;
  const item = h.state.stack.find(i => i.card === 'Twin Flame')!;
  let other = -1;
  withE(h, e => { other = e.homeRegion(A); });
  assert.notEqual(other, battle, 'setup: a second region with no battle in it');
  const ask = (what: string, region: number): string[] => {
    let out: string[] = [];
    withE(h, e => { out = e.targetCandidates({ what } as never, region, undefined, D).map(r => JSON.stringify(r)); });
    return out;
  };
  for (const r of [battle, other]) {
    assert.ok(ask('stackEffect', r).includes(JSON.stringify({ stack: item.id })), `the stack item, from region ${r}`);
    const bins = ask('anyBinCard', r).join(' ');
    assert.match(bins, /Twin Flame/, `a card in one bin, from region ${r}: ${bins}`);
    assert.match(bins, /Overbloom/, `and in the other, from region ${r}: ${bins}`);
  }
  assert.ok(ask('unit', battle).includes(JSON.stringify({ unit: foe })), 'control: the unit, from its own region');
  assert.ok(!ask('unit', other).includes(JSON.stringify({ unit: foe })), 'but not from the other');
  finishBattle(h);
});
