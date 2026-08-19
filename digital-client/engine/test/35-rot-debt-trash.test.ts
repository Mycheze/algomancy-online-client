/* Light & Dark engine wave A: the player-counter and trash primitives.
 *
 *  - R38 Rot: a player counter that deals damage equal to itself at the START
 *    OF DEPLOYMENT, in initiative order, from a source the victim controls,
 *    never decaying and never respondable (no priority during deployment).
 *    It runs through a replacement hook (Skittering Blight: "If rot would deal
 *    damage to you, instead put that many +1/+1 counters on me").
 *  - R39 Debt: a player counter paid off 1 mana each as the LAST thing in the
 *    resource step — mandatory, automatic, partial payment allowed, remainder
 *    carried, no other penalty. The mana spent is expended, so it is gone for
 *    the rest of the turn: that IS the cost.
 *  - R40 Trash: a NONTOKEN card entering a bin from anywhere other than the
 *    STACK is trashed, by the owner of the bin it enters. Discard/sacrifice/
 *    mill/death trash; a resolved or negated spell does not (it comes from the
 *    stack); tokens never do. Counted per battle in battleCounters.
 *
 * No Light & Dark card is scripted yet — every primitive here is proven with
 * synthetic test cards, the way the suite already tests bare mechanics.
 * Seeds: 3500-3599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { IllegalAction } from '../src/apply.ts';
import { registerSynthetic } from '../src/cards/dsl.ts';
import {
  ent, give, giveResources, pass, skipHasteStep, spawn, toDeployment, toNextBattle,
} from './util.ts';
import type { EngineEvent, Seat, StackItem } from '../src/types.ts';

// ── synthetic test cards ──────────────────────────────────────────────

const unit = (name: string, power: number, toughness: number, mana = 0) => ({
  name, cost: '', mana, power, toughness, type: 'Test Unit', kind: 'unit' as const,
  timing: 'deploy' as const, attrs: [], virus: false, burst: false,
  augmentAttrs: [], text: '', image: '',
});

/** stands in for Skittering Blight's "[Augment] If rot would deal damage to
 * you, instead put that many +1/+1 counters on me" — the whole reason rot
 * damage goes through a replacement hook instead of being applied inline. */
registerSynthetic(unit('Test Rot Ward', 1, 1), {
  replaceRotDamage: (g, self, _seat, amount) => { g.addCounters(self, amount); return true; },
});

/** a rot-damage hook that DECLINES (returns false) — proves the hook is a
 * replacement offer, not an interception */
registerSynthetic(unit('Test Rot Bystander', 1, 1), {
  replaceRotDamage: () => false,
});

registerSynthetic(unit('Test Grunt', 1, 1), {});
registerSynthetic(unit('Test Brute', 3, 3), {});
/** costs [3]: used to prove debt-paid mana is really gone */
registerSynthetic(unit('Test Debt Unit', 0, 1, 3), {});

registerSynthetic({
  name: 'Test Bin Spell', cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], text: 'Nothing happens.', image: '',
}, {
  spellEffect: { run: (g, ctx) => { g.ev('info', `${ctx.sourceName} does nothing.`); } },
});

// ── helpers ───────────────────────────────────────────────────────────

/** run engine mutations white-box, keeping the harness log honest (the trash
 * assertions read h.events, so the events must not be dropped on the floor) */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

const trashes = (h: Harness): EngineEvent[] => h.events.filter(ev => ev.type === 'trashed');
const rotHits = (h: Harness): EngineEvent[] =>
  h.events.filter(ev => ev.type === 'lifeLost' && ev.data?.['why'] === 'rot');

/** planning → (haste) → both battle rounds declined → deployment, without
 * the extra spawns toDeployment() callers usually want */
function intoDeployment(h: Harness): void {
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
}

// ── R38: rot ──────────────────────────────────────────────────────────

test('R38: rot deals damage equal to itself at the start of deployment, in initiative order', () => {
  const h = new Harness(3500);
  const I = h.state.initiative, N = (1 - I) as Seat;
  h.state.players[I]!.rot = 2;
  h.state.players[N]!.rot = 3;
  const lifeI = h.state.players[I]!.life, lifeN = h.state.players[N]!.life;
  assert.equal(rotHits(h).length, 0, 'nothing happens before deployment');
  intoDeployment(h);
  assert.equal(h.state.phase, 'deploy');
  assert.equal(h.state.players[I]!.life, lifeI - 2, 'the initiative player takes their 2');
  assert.equal(h.state.players[N]!.life, lifeN - 3, 'the other player takes their 3');
  const hits = rotHits(h);
  assert.deepEqual(hits.map(ev => ev.data!['seat']), [I, N], 'initiative order, deterministically');
  assert.deepEqual(hits.map(ev => ev.data!['n']), [2, 3]);
});

test('R38: the damage source is the damaged player themselves ("your rot is a source you control")', () => {
  const h = new Harness(3501);
  const I = h.state.initiative;
  h.state.players[I]!.rot = 1;
  intoDeployment(h);
  const dmg = h.events.filter(ev => ev.type === 'damage' && ev.data?.['source'] === 'rot');
  assert.equal(dmg.length, 1, 'rot damage emits a damage event, so triggers hear it');
  assert.equal(dmg[0]!.data!['player'], I, 'aimed at the player');
  assert.equal(dmg[0]!.data!['controller'], I,
    'controlled BY the damaged player — Caleb 2024-08-20, the R33 controller field');
});

test('R38: rot never decays — it fires again, at full size, every turn', () => {
  const h = new Harness(3502);
  const I = h.state.initiative;
  h.state.players[I]!.rot = 2;
  const life0 = h.state.players[I]!.life;
  intoDeployment(h);
  assert.equal(h.state.players[I]!.life, life0 - 2);
  assert.equal(h.state.players[I]!.rot, 2, 'rot stays (unlike debt, which is paid off)');
  // roll into the next turn's deployment
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  intoDeployment(h);
  assert.equal(h.state.players[I]!.life, life0 - 4, 'a second full 2 the next turn');
  assert.equal(h.state.players[I]!.rot, 2, 'still 2');
});

test('R38: rot damage cannot be responded to — deployment opens no priority window', () => {
  const h = new Harness(3503);
  h.state.players[0]!.rot = 1;
  h.state.players[1]!.rot = 1;
  intoDeployment(h);
  assert.equal(h.state.priority, null, 'nobody holds priority during deployment');
  assert.equal(h.state.stack.length, 0, 'nothing went on the stack');
  assert.equal(h.state.decision, null, 'and nobody was asked anything');
});

test('R38: a replacement hook can replace rot damage, and sees the full amount', () => {
  const h = new Harness(3504);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ward = spawn(h, P, 'Test Rot Ward');
  h.state.players[P]!.rot = 3;
  const life = h.state.players[P]!.life;
  toNextBattle(h, P);
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(h.state.phase, 'deploy');
  assert.equal(h.state.players[P]!.life, life, 'no life was lost — the damage was replaced');
  assert.equal(rotHits(h).length, 0, 'and no rot life-loss event happened at all');
  assert.equal(ent(h, ward)!.counters, 3, 'the replacement saw the full rot total (3)');
  assert.equal(h.state.players[P]!.rot, 3, 'replacing the damage does not spend the rot');
  assert.ok(h.log.some(l => l.includes('Test Rot Ward replaces the 3 damage')), 'logged for the player');
});

test('R38: a replacement that declines lets the damage through; only its controller is asked', () => {
  const h = new Harness(3505);
  toDeployment(h);
  const P = h.state.deployPlayer!, O = (1 - P) as Seat;
  spawn(h, P, 'Test Rot Bystander');
  spawn(h, P, 'Test Rot Ward');          // P's ward must NOT save O
  h.state.players[P]!.rot = 1;
  h.state.players[O]!.rot = 2;
  const lifeP = h.state.players[P]!.life, lifeO = h.state.players[O]!.life;
  toNextBattle(h, P);
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(h.state.players[P]!.life, lifeP, "P's ward replaced P's damage");
  assert.equal(h.state.players[O]!.life, lifeO - 2,
    "an opponent's replacement does not touch your rot damage (it is your source, not theirs)");
});

// ── R39: debt ─────────────────────────────────────────────────────────

test('R39: debt is paid automatically when the resource step ends — 1 mana per debt', () => {
  const h = new Harness(3510);
  const P = 0 as const;
  giveResources(h, P, 'fire', 5);
  h.state.players[P]!.debt = 3;
  assert.equal(new E(h.state).openMana(P), 5);
  h.do({ type: 'donePlanning', seat: P });
  assert.equal(h.state.players[P]!.debt, 0, 'all 3 debt paid off');
  assert.equal(new E(h.state).openMana(P), 2, '3 mana expended paying it');
  const paid = h.events.filter(ev => ev.type === 'debtPaid');
  assert.equal(paid.length, 1, 'the log shows the payment (rules transparency)');
  assert.deepEqual(paid[0]!.data, { seat: P, paid: 3, owed: 3, remaining: 0 });
});

test('R39: partial payment is fine and the remainder carries to the next turn', () => {
  const h = new Harness(3511);
  const P = 0 as const;
  giveResources(h, P, 'fire', 1);
  h.state.players[P]!.debt = 4;
  h.do({ type: 'donePlanning', seat: P });
  assert.equal(h.state.players[P]!.debt, 3, '1 paid, 3 carried');
  assert.equal(new E(h.state).openMana(P), 0, 'every open mana went to the debt');
  const life = h.state.players[P]!.life;
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  assert.equal(h.state.players[P]!.life, life, 'no life penalty for being unable to pay it all');
  // next turn: resources refresh, the carried debt is charged again
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(new E(h.state).openMana(P), 1, 'the expended resource refreshed');
  h.do({ type: 'donePlanning', seat: P });
  assert.equal(h.state.players[P]!.debt, 2, 'the carried debt is charged again next turn');
});

test('R39: with no mana, debt costs nothing else — it just carries', () => {
  const h = new Harness(3512);
  const P = 0 as const;
  h.state.players[P]!.debt = 2;
  const life = h.state.players[P]!.life;
  h.do({ type: 'donePlanning', seat: P });
  assert.equal(h.state.players[P]!.debt, 2, 'nothing paid');
  assert.equal(h.state.players[P]!.life, life, 'and NO other penalty (R39)');
  const paid = h.events.filter(ev => ev.type === 'debtPaid');
  assert.equal(paid[0]!.data!['paid'], 0, 'still logged, so the carry-over is visible');
});

test('R39: no debt, no event and no mana spent', () => {
  const h = new Harness(3513);
  const P = 0 as const;
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'donePlanning', seat: P });
  assert.equal(new E(h.state).openMana(P), 2, 'untouched');
  assert.equal(h.events.filter(ev => ev.type === 'debtPaid').length, 0, 'nothing to say');
});

test('R39: debt-paid mana is genuinely gone — no more resources can be activated, and the card is unplayable', () => {
  const h = new Harness(3514);
  const P = 0 as const;
  giveResources(h, P, 'fire', 3);
  h.state.players[P]!.debt = 2;
  const idx = give(h, P, 'Test Debt Unit');           // costs [3]
  assert.ok(new E(h.state).canPayCard(P, 'Test Debt Unit'), 'affordable before the debt is paid');
  h.do({ type: 'donePlanning', seat: P });
  assert.equal(new E(h.state).openMana(P), 1, '2 of the 3 mana went to the debt');
  // R39's whole point: nothing can be activated after paying
  assert.ok(!h.legal(P).some(a => a.type === 'activateResource' || a.type === 'recycleForResource'
    || a.type === 'exchangePrismite'),
    'the resource step is over — no way to make more mana this turn');
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(h.state.phase, 'deploy');
  assert.ok(!h.legal(P).some(a => a.type === 'playCard' && a.handIndex === idx),
    'the [3] unit is not offered — the debt mana is unavailable for casting');
  assert.throws(() => h.do({ type: 'playCard', seat: P, handIndex: idx }), IllegalAction);
});

test('R39: gainDebt / gainRot record the counter and announce it', () => {
  const h = new Harness(3515);
  whiteBox(h, e => { e.gainDebt(0, 2); e.gainRot(1, 1); e.gainRot(1, 1); });
  assert.equal(h.state.players[0]!.debt, 2);
  assert.equal(h.state.players[1]!.rot, 2, 'rot accumulates');
  assert.equal(h.events.filter(ev => ev.type === 'debtGained').length, 1);
  assert.equal(h.events.filter(ev => ev.type === 'rotGained').length, 2);
});

// ── R40: trashing ─────────────────────────────────────────────────────

test('R40: discarding from hand trashes, by the owner of the bin it enters', () => {
  const h = new Harness(3520);
  const P = 1 as const;
  const idx = give(h, P, 'Test Grunt');
  whiteBox(h, e => { e.discardFromHand(P, idx); });
  const t = trashes(h);
  assert.equal(t.length, 1);
  assert.deepEqual({ seat: t[0]!.data!['seat'], card: t[0]!.data!['card'], from: t[0]!.data!['from'] },
    { seat: P, card: 'Test Grunt', from: 'hand' });
  assert.ok(h.state.players[P]!.bin.includes('Test Grunt'));
  assert.ok(!h.state.players[P]!.hand.includes('Test Grunt'));
});

test('R40: milling from the deck trashes one event per card', () => {
  const h = new Harness(3521);
  const P = 0 as const;
  const top = h.state.sharedDeck.slice(0, 2);
  whiteBox(h, e => { e.mill(P, 2); });
  const t = trashes(h);
  assert.equal(t.length, 2, 'two cards milled, two trashes');
  assert.deepEqual(t.map(ev => ev.data!['card']), top);
  assert.ok(t.every(ev => ev.data!['from'] === 'deck' && ev.data!['seat'] === P));
  assert.deepEqual(h.state.players[P]!.bin, top);
});

test('R40: sacrificing and dying both trash — the card enters a bin from PLAY', () => {
  const h = new Harness(3522);
  const P = 0 as const;
  const a = spawn(h, P, 'Test Grunt');
  const b = spawn(h, P, 'Test Brute');
  whiteBox(h, e => { e.destroy(e.entity(a)!, 'is sacrificed'); e.destroy(e.entity(b)!, 'dies'); });
  const t = trashes(h);
  assert.deepEqual(t.map(ev => ev.data!['card']), ['Test Grunt', 'Test Brute']);
  assert.ok(t.every(ev => ev.data!['from'] === 'play' && ev.data!['seat'] === P));
  // and the log reads in the right order: the death first, then the trash
  const iDied = h.log.findIndex(l => l.includes('Test Grunt is sacrificed'));
  const iTrash = h.log.findIndex(l => l.includes('trashes Test Grunt'));
  assert.ok(iDied !== -1 && iTrash > iDied, 'the death is announced before the trash');
});

test('R40: a TOKEN dying is never trashed (it is erased, and R47 leans on this)', () => {
  const h = new Harness(3523);
  const P = 0 as const;
  whiteBox(h, e => {
    const t = e.spawnUnit(P, 'Test Grunt', e.homeRegion(P), { token: true });
    e.destroy(t, 'dies');
  });
  assert.equal(trashes(h).length, 0, 'a token never trashes');
  assert.deepEqual(h.state.players[P]!.bin, [], 'and never reaches a bin at all');
});

test('R40: a modded unit dying is ERASED, so nothing is trashed', () => {
  const h = new Harness(3524);
  const P = 0 as const;
  const u = spawn(h, P, 'Test Brute');
  whiteBox(h, e => {
    e.attachMod(e.entity(u)!, 'Test Grunt', P, 'augment');
    e.destroy(e.entity(u)!, 'dies');
  });
  assert.equal(trashes(h).length, 0, 'Unstable erases base and mods — erasing never touches a bin');
  assert.deepEqual(h.state.players[P]!.bin, []);
});

test('R40: a spell going to the bin after RESOLVING is not trashed (it comes from the stack)', () => {
  const h = new Harness(3525);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const idx = give(h, P, 'Test Bin Spell');
  h.do({ type: 'playCard', seat: P, handIndex: idx });
  assert.ok(h.state.players[P]!.bin.includes('Test Bin Spell'), 'it did reach the bin');
  assert.equal(trashes(h).length, 0, 'but from the stack — R40 excludes the stack explicitly');
});

test('R40: a NEGATED spell is not trashed either — countering is not trashing', () => {
  const h = new Harness(3526);
  const P = 0 as const;
  whiteBox(h, e => {
    const item: StackItem = {
      id: e.s.nextId++, kind: 'spell', card: 'Test Bin Spell', label: 'Test Bin Spell',
      controller: P, region: e.homeRegion(P), negated: true, parts: [],
    };
    e.resolveItem(item);
  });
  assert.ok(h.state.players[P]!.bin.includes('Test Bin Spell'), 'a negated spell is binned');
  assert.equal(trashes(h).length, 0, 'and that is still the stack, so no trash');
});

test('R40: recalling a modded unit trashes its MODS (bin, from play) but not the unit (hand)', () => {
  const h = new Harness(3527);
  const P = 0 as const;
  const u = spawn(h, P, 'Test Brute');
  whiteBox(h, e => {
    e.attachMod(e.entity(u)!, 'Test Grunt', P, 'augment');
    e.recall(e.entity(u)!);
  });
  assert.ok(h.state.players[P]!.hand.includes('Test Brute'), 'the unit went to hand — no bin, no trash');
  const t = trashes(h);
  assert.equal(t.length, 1);
  assert.equal(t[0]!.data!['card'], 'Test Grunt', 'only the mod entered a bin');
  assert.equal(t[0]!.data!['from'], 'play');
});

// ── R40: the per-battle trash counter ─────────────────────────────────

test('R40: battleCounters count trashes per battle and reset between battles', () => {
  const h = new Harness(3530);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const grunt = spawn(h, A, 'Test Grunt');    // 1/1 attacker
  spawn(h, D, 'Test Brute');                  // 3/3 blocker
  const discardIdx = give(h, A, 'Test Grunt');
  toNextBattle(h, A);
  const region = h.q.homeRegion(D);
  assert.equal(h.q.battleCounter(region, 'trashed'), 0, 'a fresh battle starts at zero');
  h.do({ type: 'declareAttack', seat: A, columns: [[grunt]] });
  // a trash DURING battle from a non-death source counts too
  whiteBox(h, e => { e.discardFromHand(A, discardIdx); });
  assert.equal(h.q.battleCounter(region, 'trashed'), 1, 'the discard counted');
  pass(h); pass(h);                                       // → block step
  const blocker = h.q.unitsOf(D, region)[0]!;
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker.id] } });
  pass(h); pass(h);                                       // combat damage: the 1/1 dies
  assert.ok(!ent(h, grunt), 'the attacker died in combat');
  assert.equal(h.q.battleCounter(region, 'trashed'), 2, 'the combat death trashed too');
  assert.equal(h.q.battleCounter(region, `trashed:${A}`), 2, "both were A's cards");
  assert.equal(h.q.battleCounter(region, `trashed:${D}`), 0, 'D trashed nothing');
  // out of battle and into the next one: the ledger resets with battleCounters
  while (h.state.phase === 'battle') {
    const b = h.state.battle!;
    if (b.step === 'declare') h.do({ type: 'declareAttack', seat: b.attacker, columns: [] });
    else if (b.step === 'blocks') h.do({ type: 'declareBlocks', seat: b.defender, blocks: {} });
    else pass(h);
  }
  toNextBattle(h, A);
  assert.equal(h.q.battleCounter(region, 'trashed'), 0, 'reset at the next battle phase');
  assert.equal(h.q.battleCounter(region, `trashed:${A}`), 0);
});

test('R40: a trash outside battle counts for nothing (battleCounters are battle-scoped)', () => {
  const h = new Harness(3531);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const idx = give(h, P, 'Test Grunt');
  whiteBox(h, e => { e.discardFromHand(P, idx); });
  assert.equal(trashes(h).length, 1, 'it is still a trash…');
  assert.equal(h.q.battleCounter(h.q.homeRegion(P), 'trashed'), 0,
    '…but "trashed in this battle" means during a battle');
});

// ── serialization ─────────────────────────────────────────────────────

test('rot and debt survive a JSON round-trip, and pre-expansion states still load', () => {
  const h = new Harness(3540);
  h.state.players[0]!.rot = 2;
  h.state.players[0]!.debt = 1;
  const round = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
  assert.equal(round.players[0]!.rot, 2);
  assert.equal(round.players[0]!.debt, 1);
  // a state serialized before the expansion has neither field
  delete round.players[0]!.rot;
  delete round.players[1]!.debt;
  const e = new E(round);
  assert.equal(e.rot(0), 0, 'a missing counter reads as 0');
  assert.equal(e.debt(1), 0);
  h.state = round;
  h.do({ type: 'donePlanning', seat: 0 });   // payDebt on an undefined debt
  assert.equal(h.state.phase, 'planning', 'the old state still drives fine');
});
