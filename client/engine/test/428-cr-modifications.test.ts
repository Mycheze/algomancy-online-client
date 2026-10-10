/**
 * Comprehensive rules, unit U17 (modifications: augment, graft, virus,
 * modular) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U17
 * (data/comprehensive-rules/build/probes/U17/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U17.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * The tests titled "engine differs" are the exception: their rules state the
 * ruling and carry an engineDiffers mark, and these tests pin the divergence
 * the mark describes. They are deliberately NOT bound as those rules'
 * examples. When one goes red the engine has been brought in line with the
 * ruling: drop the engineDiffers mark and the test, and bind a real example.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { IllegalAction } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import printed from '../src/cards/printed.json' with { type: 'json' };
import type { DecisionOption, Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, spawn, toDeployment, toNextBattle, tokensOf,
  unitsOf, withE,
} from './util.ts';

type ModAction = { type: string; from: string; index: number; hostId?: number };
const mods = (h: Harness, seat: Seat) => legalActions(h.state, seat)
  .filter(a => a.type === 'augment' || a.type === 'graft') as ModAction[];
const binAugments = (h: Harness, seat: Seat) => legalActions(h.state, seat)
  .filter(a => a.type === 'augment' && (a as ModAction).from === 'bin');

function drainAll(h: Harness, guard = 40): void {
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    const d = h.state.decision;
    if (d) h.do({ type: 'decide', seat: d.seat, choice: 0 });
    else pass(h);
  }
}

function pickBy(h: Harness, match: (o: DecisionOption) => boolean): void {
  const dec = h.state.decision;
  assert.ok(dec, 'a decision was expected');
  const i = dec!.options.findIndex(match);
  assert.notEqual(i, -1, `no matching option in [${dec!.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: dec!.seat, choice: i });
}

/** A attacks with a vanilla unit; the battle window is open. */
function battleWindow(seed: number): { h: Harness; A: Seat; D: Seat; region: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  return { h, A, D, region: h.state.battle!.region };
}

function returnToNature(h: Harness, D: Seat): void {
  giveResources(h, D, 'earth', 4);
  if (h.state.priority !== D) pass(h);
  assert.equal(h.state.priority, D, 'setup: D holds priority');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Return to Nature') });
  pass(h); pass(h);
}

/** A battle with a {Battle} graft card (Burning Vengeance) in hand: returns the Spellbind mod menu. */
function battleGraftCardAndSpellbind(): { modsInBattle: number; menu: DecisionOption[] } {
  const h = new Harness(71752);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.hand.length = 0;
  h.state.players[A]!.bin.length = 0;
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'fire', 2);
  give(h, A, 'Burning Vengeance');                              // {Battle}, [Switch1]
  const modsInBattle = mods(h, A).length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  const dec = h.state.decision;
  assert.ok(dec, 'Spellbind asks for {Modular} mods as it is played');
  return { modsInBattle, menu: dec!.options };
}

// ── effects.mods.special-action.timing-icons ─────────────────────────────

test('cr:effects.mods.special-action.timing-icons — a {Haste} augment card (Hooba-Lin) is neither offered nor accepted as a mod in the haste step without Slurpr', () => {
  const h = new Harness(71751);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  giveResources(h, A, 'fire', 3);
  give(h, A, 'Hooba-Lin');                                      // {Haste}, [Augment]
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone && h.state.hasteDone[A] === false, 'setup: in the haste step');
  const i = h.state.players[A]!.hand.indexOf('Hooba-Lin');
  assert.notEqual(i, -1);
  assert.ok(!mods(h, A).some(a => a.type === 'augment' && a.index === i), 'not offered as a mod in the haste step');
  assert.throws(() => h.do({ type: 'augment', seat: A, from: 'hand', index: i, hostId: host }), IllegalAction,
    'and refused if asked for anyway');
});

test('cr:effects.mods.special-action.timing-icons — a {Battle} graft card is not offered as a mod in battle, but is on the menu of a Spellbind cast in battle', () => {
  const { modsInBattle, menu } = battleGraftCardAndSpellbind();
  assert.equal(modsInBattle, 0, 'a {Battle} card is not offered as a mod during battle');
  assert.ok(menu.some(o => o.card === 'Burning Vengeance'),
    `the {Battle} card is on the {Modular} menu in battle: [${menu.map(o => o.label).join(' | ')}]`);
});

// ── effects.graft.applying.deployment-only ───────────────────────────────

test('cr:effects.graft.applying.deployment-only — a graft card is not offered as a mod in battle, but is applied to a Modular card (Spellbind) played in battle', () => {
  const { modsInBattle, menu } = battleGraftCardAndSpellbind();
  assert.equal(modsInBattle, 0, 'no graft is offered during battle');
  assert.ok(menu.some(o => o.card === 'Burning Vengeance'),
    `the graft card is offered to Spellbind in battle: [${menu.map(o => o.label).join(' | ')}]`);
});

// ── effects.graft.applying.targets ───────────────────────────────────────

test('cr:effects.graft.applying.targets — grafting onto Mohruung targets it, and its targeted trigger fires before the graft attaches', () => {
  const h = new Harness(71754);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let mohr = -1;
  withE(h, e => { mohr = e.spawnUnit(A, 'Mohruung', e.homeRegion(A)).id; });
  giveResources(h, A, 'fire', 2);
  const from = h.events.length;
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Flame Juggle'), hostId: mohr, position: 0 });
  const seq = h.events.slice(from).map(e => e.type);
  const iTarget = seq.indexOf('targeted'), iTrig = seq.indexOf('triggered'), iApplied = seq.indexOf('modApplied');
  assert.ok(iTarget !== -1 && iTrig !== -1 && iApplied !== -1, seq.join(','));
  assert.ok(iTarget < iTrig && iTrig < iApplied, `targeted < triggered < modApplied: ${seq.join(',')}`);
  drainAll(h);
  assert.equal(ent(h, mohr)!.mods.length, 1, 'the graft is attached');
  assert.ok(tokensOf(h, A).some(t => t.card === 'Crystal'), 'and the Crystal is made');
});

// ── effects.graft.composite.no-target ────────────────────────────────────

test('cr:effects.graft.composite.no-target — engine differs: Megadeath with Resurrect grafted attacks with no target, its composite is pushed to the stack, and makes nothing', () => {
  const h = new Harness(71755);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const mega = spawn(h, A, 'Megadeath');
  giveResources(h, A, 'fire', 2);
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Resurrect'), hostId: mega, position: 0 });
  h.state.players[A]!.bin = h.state.players[A]!.bin.filter(n => n !== 'Resurrect');
  toNextBattle(h, A);
  const before = h.state.stack.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[mega]] });
  const pushed = h.state.stack.length - before;
  drainAll(h);
  assert.equal(Object.values(h.state.entities).filter(u => u.card === 'Poison').length, 0, 'no Poison');
  assert.equal(pushed, 1, `measured ${pushed} item(s) pushed; the ruling says none`);
});

// ── effects.mods.erase-off-host ──────────────────────────────────────────

test('cr:effects.mods.erase-off-host — a host kept alive only by a +2/+2 mod dies when Return to Nature erases the mod, and the mod card is not binned', () => {
  const { h, D, region } = battleWindow(71756);
  let host = -1;
  withE(h, e => {
    const u = e.spawnUnit(D, 'Unit Token', region, { counters: -2 });
    host = u.id;
    e.attachMod(u, 'Aetherflux Golem', D, 'augment');          // "[Augment] I gain +2/+2."
  });
  assert.ok(ent(h, host), 'setup: the host is alive with the mod');
  const [, def] = effStats(h, host);
  assert.ok(def >= 1, `setup: alive only through the mod, defense ${def}`);
  returnToNature(h, D);
  assert.ok(!ent(h, host), 'the host died once the mod was erased');
  assert.ok(!h.state.players[D]!.bin.includes('Aetherflux Golem'), 'the mod card was not binned');
  finishBattle(h);
});

test('cr:effects.mods.erase-off-host — engine differs: Return to Nature files a mod on a stolen host under its owner, not its controller', () => {
  const { h, A, D, region } = battleWindow(71757);
  const owner = A, thief = D;
  let host = -1;
  withE(h, e => {
    const u = e.spawnUnit(owner, 'Unit Token', region);
    host = u.id;
    e.attachMod(u, 'Ignis Sprite', owner, 'augment');
    assert.equal(e.giveControl(u, thief), true);
  });
  const modId = ent(h, host)!.mods[0]!;
  assert.equal(ent(h, modId)!.controller, thief, 'setup: the mod is controlled by the thief');
  assert.equal(ent(h, modId)!.owner, owner, 'setup: and owned by the owner');
  const mark = h.events.length;
  returnToNature(h, thief);
  const erasedEv = h.events.slice(mark).filter(ev => ev.type === 'erased'
    && (ev.data?.['cards'] as string[] | undefined)?.includes('Ignis Sprite'));
  assert.equal(ent(h, host)?.mods.length ?? 0, 0, 'the mod was erased');
  assert.equal(erasedEv.length, 1, 'the mod was filed once');
  assert.equal(erasedEv[0]!.data!['seat'], owner, 'filed under the owner (the ruling says controller)');
  finishBattle(h);
});

// ── effects.mods.erase-off-host.token ────────────────────────────────────

test('cr:effects.mods.erase-off-host.token — a Wraith token mod erased off a living host as a cost (eraseMod) is not filed on the erased pile', () => {
  const { h, D, region } = battleWindow(71758);
  let h1 = -1;
  withE(h, e => {
    const u1 = e.spawnUnit(D, 'Unit Token', region); h1 = u1.id;
    e.augmentWraith(u1, D);
  });
  const m1 = ent(h, h1)!.mods[0]!;
  assert.equal(ent(h, m1)!.token, true, 'setup: a token mod');
  const mark = h.events.length;
  withE(h, e => { e.eraseMod(e.entity(m1)!, {}); });
  assert.ok(ent(h, h1), 'the host stays in play');
  assert.equal(ent(h, h1)!.mods.length, 0, 'eraseMod took the mod off');
  assert.equal(h.events.slice(mark).filter(ev => ev.type === 'erased').length, 0, 'a token mod is not filed');
  finishBattle(h);
});

test('cr:effects.mods.erase-off-host.token — engine differs: Return to Nature files a Wraith token mod it erases on the erased pile', () => {
  const { h, D, region } = battleWindow(71758);
  let h2 = -1;
  withE(h, e => {
    const u2 = e.spawnUnit(D, 'Unit Token', region); h2 = u2.id;
    e.augmentWraith(u2, D);
  });
  const mark = h.events.length;
  returnToNature(h, D);
  assert.equal(ent(h, h2)?.mods.length ?? 0, 0, 'the Wraith mod was erased');
  const filed = h.events.slice(mark).filter(ev => ev.type === 'erased'
    && (ev.data?.['cards'] as string[] | undefined)?.includes('Wraith'));
  assert.equal(filed.length, 1, 'Return to Nature filed the token mod on the erased pile');
  finishBattle(h);
});

// ── effects.modular.effects.graft-cost ───────────────────────────────────

test('cr:effects.modular.effects.graft-cost — Spellbind carrying a grafted Immolate with no unit to sacrifice skips only the Immolate part and still gives its rot', () => {
  const h = new Harness(71707);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.hand.length = 0;
  h.state.players[A]!.bin.length = 0;
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'fire', 1);
  give(h, A, 'Immolate');                                       // [Switch1] /[Sacrifice a unit]: Draw a card.
  withE(h, e => { for (const u of Object.values(e.s.entities)) if (u.kind === 'unit' && u.controller === A) e.recall(u); });
  assert.equal(unitsOf(h, A).length, 0, 'setup: nothing to sacrifice');
  assert.equal(h.state.phase, 'battle', 'setup: still in battle');
  const hand0 = h.state.players[A]!.hand.length;
  for (let g = 8; h.state.priority !== A && g-- > 0;) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  const offered = h.state.decision?.options.map(o => o.label) ?? [];
  assert.ok(offered.some(l => l.startsWith('Immolate')), `Immolate is offered as a mod (offered: ${offered.join(' | ')})`);
  pickBy(h, o => o.card === 'Immolate');
  for (let k = 0; k < 6 && h.state.decision; k++) {
    const labels = h.state.decision.options.map(o => o.label);
    const i = labels.findIndex(l => l === 'No more mods');
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: i >= 0 ? i : 0 });
  }
  drainAll(h);
  const hand = h.state.players[A]!.hand;
  assert.ok(!hand.includes('Immolate'), 'Immolate was applied (it left the hand)');
  assert.equal(h.state.players[A]!.rot ?? 0, 1, 'Spellbind still gave its rot');
  assert.equal(hand.length, hand0 - 1, 'no card drawn: the Immolate part was skipped');
});

test('cr:effects.modular.effects.graft-cost — Spellbind carrying a grafted Immolate with a unit to sacrifice offers no decline, sacrifices the unit and draws', () => {
  const h = new Harness(71709);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.hand.length = 0;
  h.state.players[A]!.bin.length = 0;
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'fire', 1);
  give(h, A, 'Immolate');
  for (let g = 8; h.state.priority !== A && g-- > 0;) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  pickBy(h, o => o.card === 'Immolate');
  const seen: string[] = [];
  for (let k = 0; k < 6 && h.state.decision; k++) {
    const labels = h.state.decision.options.map(o => o.label);
    seen.push(...labels);
    const more = labels.findIndex(l => l === 'No more mods');
    const unit = h.state.decision.options.findIndex(o => (o.value as { unit?: number })?.unit === atk);
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: more >= 0 ? more : unit >= 0 ? unit : 0 });
  }
  assert.ok(!seen.some(l => /don.t pay|decline|skip/i.test(l)), `no decline offered: [${seen.join(' | ')}]`);
  drainAll(h);
  assert.ok(!ent(h, atk), 'the attacker was sacrificed to pay the grafted cost');
  assert.equal(h.state.players[A]!.hand.length, 1, 'and the Immolate part drew a card');
});

// ── effects.virus.battle.not-bin ─────────────────────────────────────────

test('cr:effects.virus.battle.not-bin — a Virus in the bin is not a battle augment, but is offered from the bin to a Spellbind cast in battle', () => {
  const h = new Harness(17301);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.hand.length = 0;
  h.state.players[A]!.bin = ['Chitin Shredder'];               // {Virus}
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'earth', 4);
  assert.equal(binAugments(h, A).length, 0, 'the bin Virus is not offered as a battle augment');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  const dec = h.state.decision;
  assert.ok(dec, 'Spellbind asks for mods as it is played');
  assert.ok(dec!.options.some(o => o.card === 'Chitin Shredder' && /bin/.test(o.label)),
    'the Virus is offered from the bin to the Modular spell during battle');
});

test('cr:effects.virus.battle.not-bin — a Virus in the bin is offered as a mod in the haste step under Slurpr, and not without it', () => {
  for (const withSlurpr of [false, true]) {
    const h = new Harness(17302);
    toDeployment(h);
    const A = h.state.deployPlayer!, D = (1 - A) as Seat;
    if (withSlurpr) spawn(h, A, 'Slurpr');
    spawn(h, A, 'Rune Channeler');
    h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
    h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
    h.state.players[A]!.hand.length = 0;
    h.state.players[D]!.hand.length = 0;
    h.state.players[A]!.bin = ['Chitin Shredder'];
    giveResources(h, A, 'earth', 4);
    h.do({ type: 'donePlanning', seat: 0 });
    h.do({ type: 'donePlanning', seat: 1 });
    assert.notEqual(h.state.phase, 'battle', 'in the haste step');
    assert.ok(h.state.hasteDone && h.state.hasteDone[A] === false, 'setup: in the haste step');
    const offered = binAugments(h, A).length;
    if (withSlurpr) assert.ok(offered > 0, 'with Slurpr the bin Virus is offered during the haste step');
    else assert.equal(offered, 0, 'without Slurpr nothing is offered from the bin during the haste step');
  }
});

// ═══ Tester additions: rules the verifier left without an executed demonstration ═══

// ── effects.mods.what ──────────────────────────────────────────────────────

test('cr:effects.mods.what — only a card with the augment or graft symbol is offered as a mod, and applying one changes the host', () => {
  const h = new Harness(71760);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  spawn(h, A, 'Oracle of the Flame');                             // a graft cause
  h.state.players[A]!.hand.length = 0;
  h.state.players[A]!.bin.length = 0;
  giveResources(h, A, 'earth', 6);
  giveResources(h, A, 'fire', 6);
  giveResources(h, A, 'light', 6);
  const golem = give(h, A, 'Aetherflux Golem');                     // [Augment]
  const juggle = give(h, A, 'Flame Juggle');                        // [Switch1]
  const plain = give(h, A, 'The Foretold');                         // neither symbol
  const offered = mods(h, A);
  assert.ok(offered.some(a => a.type === 'augment' && a.index === golem), 'the augment card is offered');
  assert.ok(offered.some(a => a.type === 'graft' && a.index === juggle), 'the graft card is offered');
  assert.ok(!offered.some(a => a.index === plain), 'the card with no mod symbol is not offered');
  assert.throws(() => h.do({ type: 'augment', seat: A, from: 'hand', index: plain, hostId: host }), IllegalAction);
  const before = effStats(h, host);
  h.do({ type: 'augment', seat: A, from: 'hand', index: golem, hostId: host });
  assert.deepEqual(effStats(h, host), [before[0] + 2, before[1] + 2], 'the host now carries the mod text');
});

// ── effects.mods.what.virus-modular ────────────────────────────────────────

test('cr:effects.mods.what.virus-modular — a Virus applied in battle is an augment action and attaches as an augment; no virus or modular kind of mod exists', () => {
  const h = new Harness(71761);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  assert.equal(h.state.priority, D, 'setup: D holds priority');
  giveResources(h, D, 'earth', 4);
  const golem = give(h, D, 'Aetherflux Golem');                    // {Virus}, [Augment]
  const kinds = new Set(legalActions(h.state, D).map(a => a.type));
  assert.ok(![...kinds].some(k => /virus|modular/i.test(k)), `no virus or modular action kind: ${[...kinds].join(',')}`);
  const act = mods(h, D).find(a => a.index === golem && a.hostId === atk);
  assert.ok(act, 'the Virus is offered');
  assert.equal(act!.type, 'augment', 'as an augment');
  h.do({ type: 'augment', seat: D, from: 'hand', index: golem, hostId: atk });
  pass(h); pass(h);
  const m = ent(h, atk)!.mods.map(id => ent(h, id)!);
  assert.equal(m.length, 1, 'the Virus attached');
  assert.equal(m[0]!.appliedAs, 'augment', 'applied as an augment');
  finishBattle(h);
});

// ── effects.mods.one-card ──────────────────────────────────────────────────

test('cr:effects.mods.one-card — an augment becomes part of its host: the host has its text, and the mod is not a separate unit', () => {
  const h = new Harness(71762);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'earth', 4);
  const units0 = unitsOf(h, A).length;
  const before = effStats(h, host);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Aetherflux Golem'), hostId: host });
  const u = ent(h, host)!;
  assert.equal(u.mods.length, 1, 'the host carries the mod');
  const mod = ent(h, u.mods[0]!)!;
  assert.equal(mod.modOf, host, 'the mod belongs to the host');
  assert.equal(unitsOf(h, A).length, units0, 'the mod is not a separate unit');
  assert.deepEqual(effStats(h, host), [before[0] + 2, before[1] + 2], 'the host has the mod text');
});

// ── effects.mods.one-card.no-limit ─────────────────────────────────────────

test('cr:effects.mods.one-card.no-limit — six augments are applied to one unit and every one of them counts', () => {
  const h = new Harness(71763);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'earth', 20);
  const before = effStats(h, host);
  for (let k = 0; k < 6; k++) {
    const i = give(h, A, 'Aetherflux Golem');
    assert.ok(mods(h, A).some(a => a.index === i && a.hostId === host), `augment ${k + 1} is still offered`);
    h.do({ type: 'augment', seat: A, from: 'hand', index: i, hostId: host });
  }
  assert.equal(ent(h, host)!.mods.length, 6, 'six mods on one unit');
  assert.deepEqual(effStats(h, host), [before[0] + 12, before[1] + 12], 'and all six apply');
});

// ── effects.mods.moving.not-applying ───────────────────────────────────────

test('cr:effects.mods.moving.not-applying — Rotbeast moving an augment onto Perpetual Construct fires no mod-applied event and makes no unit', () => {
  const h = new Harness(71764);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const rot = spawn(h, A, 'Rotbeast');
  const pc = spawn(h, D, 'Perpetual Construct');                 // "Whenever a mod is applied to me, create an X/X"
  giveResources(h, A, 'water', 4);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Curio Drifter'), hostId: rot });
  assert.equal(ent(h, rot)!.mods.length, 1, 'setup: Rotbeast carries an augment');
  toNextBattle(h, A);
  const unitsD0 = unitsOf(h, D).length;
  const mark = h.events.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[rot]] });
  for (let g = 0; g < 60 && h.state.phase === 'battle' && ent(h, rot)!.mods.length; g++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else if (legalActions(h.state, D).some(a => a.type === 'declareBlocks')) h.do({ type: 'declareBlocks', seat: D, blocks: {} });
    else pass(h);
  }
  assert.equal(ent(h, rot)!.mods.length, 0, 'the augment left Rotbeast');
  assert.equal(ent(h, pc)!.mods.length, 1, 'and is on Perpetual Construct');
  drainAll(h);
  assert.equal(h.events.slice(mark).filter(ev => ev.type === 'modApplied').length, 0, 'no mod-applied event');
  assert.equal(unitsOf(h, D).length, unitsD0, 'Perpetual Construct did not trigger');
  finishBattle(h);

  // the control: APPLYING the same augment to a Perpetual Construct does trigger it
  const c = new Harness(71775);
  toDeployment(c);
  const P = c.state.deployPlayer!;
  const pc2 = spawn(c, P, 'Perpetual Construct');
  giveResources(c, P, 'water', 4);
  const n0 = unitsOf(c, P).length;
  c.do({ type: 'augment', seat: P, from: 'hand', index: give(c, P, 'Curio Drifter'), hostId: pc2 });
  drainAll(c);
  assert.equal(unitsOf(c, P).length, n0 + 1, 'control: an applied mod makes the X/X unit');
});

// ── effects.augment.what ───────────────────────────────────────────────────

test('cr:effects.augment.what — an augment adds the text after its augment symbol to the host, not the rest of the card', () => {
  const h = new Harness(71765);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'earth', 4);
  const before = effStats(h, host);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Aetherflux Golem'), hostId: host });
  // Aetherflux Golem is a 1/1 whose augment text is "I gain +2/+2."
  assert.deepEqual(effStats(h, host), [before[0] + 2, before[1] + 2], 'the host gains +2/+2, not the mod 1/1 body');
});

// ── effects.augment.which-cards ────────────────────────────────────────────

test('cr:effects.augment.which-cards — a card with the augment symbol on its type line and an empty text box (Chitin Shredder) is applied as an augment', () => {
  const h = new Harness(71766);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'earth', 4);
  assert.equal(getCard('Chitin Shredder').text, '', 'setup: no text box');
  const i = give(h, A, 'Chitin Shredder');
  assert.ok(mods(h, A).some(a => a.type === 'augment' && a.index === i && a.hostId === host), 'offered as an augment');
  h.do({ type: 'augment', seat: A, from: 'hand', index: i, hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'and applied');
  assert.ok(ownAttrs(h, host).has('Powerful'), 'its type-line attribute went with it');
});

// ── effects.augment.hosts ──────────────────────────────────────────────────

test('cr:effects.augment.hosts — in deployment an augment goes only onto your own unit; in battle a Virus may go onto an opposing unit', () => {
  const h = new Harness(71767);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const mine = spawn(h, A, 'Unit Token');
  const theirs = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'water', 4);
  const curio = give(h, A, 'Curio Drifter');                     // plain [Augment], no {Virus}
  const offered = mods(h, A).filter(a => a.index === curio);
  assert.ok(offered.some(a => a.hostId === mine), 'onto my own unit: offered');
  assert.ok(!offered.some(a => a.hostId === theirs), 'onto the opposing unit: not offered');
  assert.throws(() => h.do({ type: 'augment', seat: A, from: 'hand', index: curio, hostId: theirs }), IllegalAction);

  const b = new Harness(71768);
  toDeployment(b);
  const X = b.state.initiative as Seat, Y = (1 - X) as Seat;
  const atk = spawn(b, X, 'The Foretold');
  toNextBattle(b, X);
  b.do({ type: 'declareAttack', seat: X, columns: [[atk]] });
  pass(b);
  giveResources(b, Y, 'earth', 4);
  const golem = give(b, Y, 'Aetherflux Golem');                   // {Virus}
  assert.ok(mods(b, Y).some(a => a.index === golem && a.hostId === atk), 'a Virus onto the opposing attacker: offered');
  b.do({ type: 'augment', seat: Y, from: 'hand', index: golem, hostId: atk });
  pass(b); pass(b);
  assert.equal(ent(b, atk)!.mods.length, 1, 'and it attached to the opposing unit');
  finishBattle(b);
});

// ── effects.graft.what ─────────────────────────────────────────────────────

test('cr:effects.graft.what — a graft puts a second effect under the host cause: one sacrifice of Oracle of the Flame makes both effects', () => {
  const h = new Harness(71769);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  giveResources(h, A, 'fire', 6);
  const oracle = spawn(h, A, 'Oracle of the Flame');
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Flame Juggle'), hostId: oracle, position: 0 });
  assert.equal(ent(h, oracle)!.mods.length, 1);
  assert.equal(ent(h, ent(h, oracle)!.mods[0]!)!.appliedAs, 'graft');
  const t0 = tokensOf(h, A).length;
  h.do({ type: 'activateAbility', seat: A, entityId: oracle, abilityIndex: 0 });
  drainAll(h);
  assert.equal(tokensOf(h, A).length - t0, 4, 'one cause: the Fireball 1 of the host and the three of Flame Juggle');
});

// ── effects.graft.what.cause-effect ────────────────────────────────────────

test('cr:effects.graft.what.cause-effect — Oracle of the Flame cause is Sacrifice me and its effect is Create a Fireball 1', () => {
  const h = new Harness(71770);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const oracle = spawn(h, A, 'Oracle of the Flame');
  const t0 = tokensOf(h, A).length;
  h.do({ type: 'activateAbility', seat: A, entityId: oracle, abilityIndex: 0 });
  assert.ok(!ent(h, oracle), 'the cause: Oracle was sacrificed');
  drainAll(h);
  const made = tokensOf(h, A).slice(t0);
  assert.equal(made.length, 1, 'the effect: one token');
  assert.equal(made[0]!.card, 'Fireball', 'a Fireball');
});

// ── effects.graft.applying.not-by-rook ─────────────────────────────────────

test('cr:effects.graft.applying.not-by-rook — with Rook in play an augment card is offered in battle but a graft card is not', () => {
  const h = new Harness(71771);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  spawn(h, D, 'Rook');
  spawn(h, D, 'Oracle of the Flame');                             // a graft cause for D
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  assert.equal(h.state.priority, D, 'setup: D holds priority');
  h.state.players[D]!.hand.length = 0;
  giveResources(h, D, 'water', 4);
  giveResources(h, D, 'fire', 6);
  const curio = give(h, D, 'Curio Drifter');                     // augment, not a Virus
  const juggle = give(h, D, 'Flame Juggle');                     // graft
  const m = mods(h, D);
  assert.ok(m.some(a => a.type === 'augment' && a.index === curio), 'Rook lets the augment card be applied in battle');
  assert.ok(!m.some(a => a.type === 'graft'), 'no graft is offered in battle');
  assert.ok(!m.some(a => a.index === juggle), 'the graft card is not offered at all');
  finishBattle(h);
});

// ── effects.virus.what ─────────────────────────────────────────────────────

test('cr:effects.virus.what — a Virus is applied as an augment from hand in battle, and in deployment it may be played or augmented normally', () => {
  const b = new Harness(71772);
  toDeployment(b);
  const X = b.state.initiative as Seat, Y = (1 - X) as Seat;
  const atk = spawn(b, X, 'The Foretold');
  toNextBattle(b, X);
  b.do({ type: 'declareAttack', seat: X, columns: [[atk]] });
  pass(b);
  giveResources(b, Y, 'earth', 4);
  const g = give(b, Y, 'Aetherflux Golem');
  b.do({ type: 'augment', seat: Y, from: 'hand', index: g, hostId: atk });
  pass(b); pass(b);
  assert.equal(ent(b, atk)!.mods.length, 1, 'battle: applied from hand as an augment');
  finishBattle(b);

  const h = new Harness(71773);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'earth', 8);
  const i = give(h, A, 'Aetherflux Golem');
  const acts = legalActions(h.state, A);
  assert.ok(acts.some(a => a.type === 'playCard' && (a as { handIndex: number }).handIndex === i), 'deployment: playable');
  assert.ok(mods(h, A).some(a => a.type === 'augment' && a.index === i && a.hostId === host), 'deployment: augmentable');
  h.do({ type: 'playCard', seat: A, handIndex: i });
  drainAll(h);
  assert.ok(unitsOf(h, A).some(u => u.card === 'Aetherflux Golem'), 'played as a unit');
});

// ── effects.virus.what.timing-not-host ─────────────────────────────────────

test('cr:effects.virus.what.timing-not-host — in deployment a Virus is offered onto your own unit only, like any augment', () => {
  const h = new Harness(71774);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const mine = spawn(h, A, 'Unit Token');
  const theirs = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'earth', 4);
  const g = give(h, A, 'Aetherflux Golem');                       // {Virus}
  const offered = mods(h, A).filter(a => a.index === g);
  assert.ok(offered.some(a => a.hostId === mine), 'onto my unit: offered');
  assert.ok(!offered.some(a => a.hostId === theirs), 'onto the opposing unit: not offered in deployment');
  assert.throws(() => h.do({ type: 'augment', seat: A, from: 'hand', index: g, hostId: theirs }), IllegalAction);
});

// ── effects.modular.what.pool ──────────────────────────────────────────────

test('cr:effects.modular.what.pool — Spellbind is the only card in the pool with Modular', () => {
  const rows = (Array.isArray(printed) ? printed : Object.values(printed as object)) as { name: string; attrs: string[]; type: string }[];
  const modular = rows.filter(c => c.attrs.includes('Modular') || /\{Modular\}/.test(c.type)).map(c => c.name);
  assert.deepEqual([...new Set(modular)], ['Spellbind']);
});
