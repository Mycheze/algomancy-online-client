/**
 * Comprehensive rules, unit U06 (card types: units, spells, spell units, tokens, mods) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U06
 * (data/comprehensive-rules/build/probes/U06/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U06.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * The three tests titled "engine differs" are the exception: their rules state
 * the ruled law and carry an engineDiffers mark, and these tests pin the
 * divergence the mark describes. They are deliberately NOT listed in those
 * rules' sources. When one goes red the engine has been brought in line with
 * the ruling: drop the engineDiffers mark and the test, and bind a real example.
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
import type { Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, offered, ownAttrs, pass, pick, spawn, toDeployment, toNextBattle,
  tokensOf, unitsOf, withE,
} from './util.ts';

/** resolve the stack and answer every pending decision with its first option */
function drain(h: Harness): void {
  let guard = 60;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    const d = h.state.decision;
    if (d?.pickOrder) h.do({ type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) });
    else if (d) h.do({ type: 'decide', seat: d.seat, choice: 0 });
    else pass(h);
  }
}
/** pass until `seat` holds priority */
function passTo(h: Harness, seat: Seat): void {
  let guard = 8;
  while (h.state.priority !== seat && guard-- > 0) pass(h);
  assert.equal(h.state.priority, seat);
}

/** A attacks with a Good Whale; D (defending at home) holds 3 water and plays a Jelly at the whale. */
function jellyBoard(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'water', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Jelly') });
  pick(h, { unit: whale });
  return { h, A, D, whale };
}

/* ---------- units ---------- */

function fireballAt(seed: number, x: number): { h: Harness; foe: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const foe = spawn(h, A, 'The Foretold');                // 3/3 attacker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[foe]] });
  let tok = -1;
  withE(h, e => { tok = e.createSpellToken(D, 'Fireball', x, e.s.battle!.region).id; });
  passTo(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: tok });
  pick(h, { unit: foe });
  pass(h); pass(h);
  return { h, foe };
}

test('cr:types.units.defense.lethal — a 3/3 dealt exactly 3 dies; dealt 2 it lives', () => {
  const a = fireballAt(60613, 3);
  assert.ok(!ent(a.h, a.foe), 'damage equal to defense: dead');
  assert.ok(a.h.state.players[a.h.state.initiative]!.bin.includes('The Foretold'), 'and in the bin');
  finishBattle(a.h);
  const b = fireballAt(60614, 2);
  assert.ok(ent(b.h, b.foe), 'damage below defense: alive');
  assert.equal(ent(b.h, b.foe)!.damage, 2);
  finishBattle(b.h);
});

test('cr:types.units.dies-to-bin — a unit that dies, or is deleted, is put into the bin', () => {
  const h = new Harness(60615);
  toDeployment(h);
  const P = h.state.deployPlayer! as Seat;
  const a = spawn(h, P, 'Good Whale');
  const b = spawn(h, P, 'The Foretold');
  withE(h, e => { e.destroy(e.entity(a)!, 'dies'); e.destroy(e.entity(b)!, 'is deleted'); });
  drain(h);
  assert.ok(h.state.players[P]!.bin.includes('Good Whale'), 'died: bin');
  assert.ok(h.state.players[P]!.bin.includes('The Foretold'), 'deleted: bin');
});

test('cr:types.units.no-summoning-sickness — a unit that spawned during the attack step may still be declared as a blocker', () => {
  const { h, D } = jellyBoard(60603);
  pass(h); pass(h);                                        // the Jelly resolves and its body arrives
  const jelly = unitsOf(h, D).find(u => u.card === 'Jelly')!;
  assert.ok(jelly, 'the body is in play');
  let guard = 6;
  while (h.state.battle!.step !== 'blocks' && guard-- > 0) pass(h);
  assert.equal(h.state.battle!.step, 'blocks', 'reached the block declaration');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [jelly.id] } });
  assert.deepEqual(h.state.battle!.blocks[0], [jelly.id], 'the freshly spawned unit blocks');
  finishBattle(h);
});

test('cr:types.units.put-vs-play — a unit Exhume puts into play is not played (Bloomcaster makes no 1/1 for it)', () => {
  const h = new Harness(60606);
  toDeployment(h);
  const P = h.state.deployPlayer! as Seat;
  spawn(h, P, 'Bloomcaster');
  h.state.players[P]!.bin.push('Good Whale');
  giveResources(h, P, 'dark', 6);
  const tok0 = unitsOf(h, P).filter(u => u.card === 'Unit Token').length;
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Exhume') });
  drain(h);
  assert.ok(unitsOf(h, P).some(u => u.card === 'Good Whale'), 'the Whale is in play');
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Unit Token').length, tok0, 'no Bloomcaster 1/1');
  assert.ok(!h.events.slice(mark).some(e => e.type === 'cardPlayed' && e.data?.['card'] === 'Good Whale'), 'no cardPlayed for it');
});

/* ---------- spell units ---------- */

test('cr:types.spell-units.on-stack — a played spell unit (Jelly) is on the stack and not in play until it resolves', () => {
  const { h, D } = jellyBoard(60601);
  assert.ok(h.state.stack.some(i => i.card === 'Jelly' && i.kind === 'spellUnit'), 'Jelly is a spellUnit item on the stack');
  assert.ok(!Object.values(h.state.entities).some(e => e.card === 'Jelly'), 'no Jelly entity in play while it is on the stack');
  pass(h); pass(h);
  assert.ok(unitsOf(h, D).some(u => u.card === 'Jelly'), 'it entered play when it resolved');
  finishBattle(h);
});

test('cr:types.spell-units.in-battle — a spell unit played normally in battle arrives in the battle region outside any formation', () => {
  const { h, D } = jellyBoard(60602);
  pass(h); pass(h);
  const jelly = unitsOf(h, D).find(u => u.card === 'Jelly')!;
  const b = h.state.battle!;
  assert.equal(jelly.region, b.region, 'in the region where it resolved');
  assert.ok(!b.columns.flat().includes(jelly.id), 'not in an attacking column');
  assert.ok(!Object.values(b.blocks ?? {}).flat().includes(jelly.id), 'not blocking');
  finishBattle(h);
});

test('cr:types.spell-units.resolution — Spawntender creates its 8/8 before its own body enters play', () => {
  const h = new Harness(60604);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  giveResources(h, D, 'water', 10);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Spawntender') });
  const mark = h.events.length;
  pass(h); pass(h);
  const sp = h.events.slice(mark).filter(e => e.type === 'spawned').map(e => String(e.data?.['card']));
  const iTok = sp.indexOf('Unit Token'), iBody = sp.indexOf('Spawntender');
  assert.ok(iTok !== -1 && iBody !== -1, `both spawned: ${sp.join(', ')}`);
  assert.ok(iTok < iBody, 'the spell part (the 8/8) came first, then the body');
  finishBattle(h);
});

test('cr:types.spell-units.not-played — Exhume puts a Jelly from the bin into play with no spell effect, and Bloomcaster does not hear a play', () => {
  const h = new Harness(60605);
  toDeployment(h);
  const P = h.state.deployPlayer! as Seat, O = (1 - P) as Seat;
  spawn(h, P, 'Bloomcaster');
  const victim = spawn(h, O, 'Good Whale');
  h.state.players[P]!.bin.push('Jelly');
  giveResources(h, P, 'dark', 3);
  const tok0 = unitsOf(h, P).filter(u => u.card === 'Unit Token').length;
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Exhume') });
  drain(h);
  assert.ok(unitsOf(h, P).some(u => u.card === 'Jelly'), 'Jelly is in play');
  assert.deepEqual(effStats(h, victim), [7, 5], 'no -2/-2 anywhere: the spell part did not happen');
  assert.ok(!h.log.some(l => l.includes('-2/-2')), 'and the log shows none');
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Unit Token').length, tok0,
    'Bloomcaster ("whenever you play a unit") made no 1/1: the Jelly was put into play, not played');
});

/* The probe for the next three: measured on the engine, where Wake the Dead
 * spawns a spell unit body straight from the bin and skips its spell part. */
function wakeTheDeadSkipsTheSpell(): void {
  const h = new Harness(60621);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Good Whale');
  h.state.players[A]!.bin.push('Jelly');
  giveResources(h, A, 'dark', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wake the Dead') });
  pass(h); pass(h);
  pick(h, `${A}:0`);
  if (h.state.decision && h.state.decision.options.some(o => o.value === 'done')) pick(h, 'done');
  const askedTarget = !!h.state.decision;
  drain(h);
  const evs = h.events.slice(mark);
  assert.ok(unitsOf(h, A).some(u => u.card === 'Jelly'), 'the Jelly body is in play');
  assert.ok(evs.some(e => e.type === 'cardPlayed' && e.data?.['card'] === 'Jelly'), 'it is heard as a played card');
  assert.equal(askedTarget, false, 'no target was asked for the -2/-2');
  assert.ok(!evs.some(e => e.type === 'spellPlayed' && e.data?.['card'] === 'Jelly'), 'no spellPlayed event: not played as a spell');
  assert.deepEqual(effStats(h, victim), [7, 5], 'the spell part did not happen');
  finishBattle(h);
}

test('cr:types.spell-units.played-by-effect — engine differs: a Jelly that Wake the Dead plays from a bin arrives with no spell part and no spellPlayed event', wakeTheDeadSkipsTheSpell);

test('cr:types.spell-units.is-a-spell — engine differs: a Jelly that Wake the Dead plays from a bin is not played as a spell', wakeTheDeadSkipsTheSpell);

test('cr:types.spell-units.is-a-unit — engine differs: a Jelly that Wake the Dead plays as a unit gets no spell part', wakeTheDeadSkipsTheSpell);

/* ---------- tokens ---------- */

test('cr:types.tokens.creating-not-playing — Manufacture creating Robot tokens is not playing them (Bloomcaster, Stalwart Sentinel silent)', () => {
  const h = new Harness(60608);
  toDeployment(h);
  const P = h.state.deployPlayer! as Seat;
  spawn(h, P, 'Bloomcaster');
  const sent = spawn(h, P, 'Stalwart Sentinel');
  giveResources(h, P, 'metal', 6);
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Manufacture') });
  drain(h);
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Robot').length, 3, 'three Robots created');
  const played = h.events.slice(mark).filter(e => e.type === 'cardPlayed').map(e => e.data?.['card']);
  assert.deepEqual(played, ['Manufacture'], 'the only play is Manufacture itself');
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Unit Token').length, 0, 'Bloomcaster made nothing (the Robots were not played)');
  assert.equal(ent(h, sent)!.counters ?? 0, 0, 'Stalwart Sentinel heard no play from elsewhere');
});

test('cr:types.tokens.copying-a-token — Download is playable with a Borrower copy of a Robot on board and does not offer the Borrower', () => {
  const h = new Harness(60618);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  let atk = -1, robot = -1;
  withE(h, e => { atk = e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true }).id; });
  withE(h, e => { robot = e.spawnUnit(D, 'Robot', e.homeRegion(D), { token: true, counters: 3 }).id; });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, A, 'metal', 7);
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: robot });
  drain(h);
  const bof = unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!.id;
  assert.equal(ent(h, bof)!.token, undefined, 'not a token');
  giveResources(h, D, 'metal', 2);
  passTo(h, D);
  const dl = give(h, D, 'Download');
  const plays = legalActions(h.state, D).filter(a => a.type === 'playCard' && a.handIndex === dl);
  assert.ok(plays.length > 0, 'Download is playable (A has a real unit token), so the menu below is really read');
  h.do(plays[0]!);
  const units = h.state.decision!.options.map(o => (o.value as { unit?: number }).unit);
  assert.ok(units.includes(atk), 'the real token is offered');
  assert.ok(!units.includes(bof), 'the Borrower is not');
  finishBattle(h);
});

test('cr:types.tokens.leaving-play.still-dies — a dying unit token is seen by "whenever another unit dies" but not by a "nontoken unit dies" watcher', () => {
  const h = new Harness(60612);
  toDeployment(h);
  const P = h.state.deployPlayer! as Seat;
  const rr = spawn(h, P, 'Refuse Reclaimer');
  spawn(h, P, 'Saprophytic Oracle');
  let tok = -1;
  withE(h, e => { tok = e.spawnUnit(P, 'Unit Token', e.homeRegion(P), { token: true }).id; });
  assert.equal(ent(h, tok)!.token, true, 'setup: a real unit token');
  const tok0 = unitsOf(h, P).filter(u => u.card === 'Unit Token').length;
  withE(h, e => { e.destroy(e.entity(tok)!, 'dies'); });
  drain(h);
  assert.equal(ent(h, rr)!.counters, 1, 'Refuse Reclaimer: +1/+1 counter for the token death');
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Unit Token').length, tok0 - 1,
    'Saprophytic Oracle ("nontoken unit dies") created nothing');
});

test('cr:types.tokens.unit-tokens.regroup — a unit token survives regroup while a spell token beside it is erased', () => {
  const h = new Harness(60611);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  let unitTok = -1;
  withE(h, e => { unitTok = e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true }).id; });
  assert.equal(ent(h, unitTok)!.token, true, 'setup: a real unit token');
  toNextBattle(h, A);
  let st = -1;
  withE(h, e => { st = e.createSpellToken(A, 'Fireball', 1, e.homeRegion(A)).id; });
  finishBattle(h);
  assert.ok(ent(h, unitTok), 'the unit token is still in play after regroup');
  assert.ok(!ent(h, st), 'the spell token is gone');
});

test('cr:types.tokens.spell-tokens.region — a spell token left at home cannot be cast in a battle in another region', () => {
  const h = new Harness(60610);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const atk = spawn(h, A, 'Good Whale');
  let tok = -1;
  withE(h, e => { tok = e.createSpellToken(A, 'Fireball', 1, e.homeRegion(A)).id; });
  toNextBattle(h, A);
  assert.ok(ent(h, tok), 'the token survived to the battle');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });   // the token stays home
  passTo(h, A);
  assert.notEqual(ent(h, tok)!.region, h.state.battle!.region);
  assert.ok(!legalActions(h.state, A).some(a => a.type === 'castSpellToken' && a.entityId === tok), 'not offered');
  assert.throws(() => h.do({ type: 'castSpellToken', seat: A, entityId: tok }), /only in their region/);
  finishBattle(h);
});

test('cr:types.tokens.spell-tokens.moving.created-there — a Fireball created for the attacker in the enemy region during combat is castable there at once', () => {
  const h = new Harness(60609);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  const foe = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  let tok = -1;
  withE(h, e => { tok = e.createSpellToken(A, 'Fireball', 3, region).id; });
  passTo(h, A);
  assert.ok(legalActions(h.state, A).some(a => a.type === 'castSpellToken' && a.entityId === tok), 'offered');
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: foe });
  drain(h);
  assert.ok(!ent(h, foe), 'the 3/3 took 3 and died');
  finishBattle(h);
});

test('cr:types.tokens.spell-tokens.burst — Burst groups by name across different X, and only tokens in the same region', () => {
  const h = new Harness(60623);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  let other = -1;
  withE(h, e => {
    e.createSpellToken(D, 'Fireball', 1, region);
    e.createSpellToken(D, 'Fireball', 3, region);
    const elsewhere = [0, 1, 2, 3, 4, 5].find(r => r !== region && r !== e.homeRegion(A)) ?? e.homeRegion(A);
    other = e.createSpellToken(D, 'Fireball', 2, elsewhere).id;
  });
  const here = tokensOf(h, D).filter(t => t.card === 'Fireball' && t.region === region);
  assert.equal(here.length, 2);
  passTo(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: here[0]!.id });
  for (let k = 0; k < 4 && h.state.decision; k++) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  const onStack = h.state.stack.filter(i => i.card === 'Fireball');
  assert.equal(onStack.length, 2, 'Fireball 1 and Fireball 3 went together as two separate spells');
  assert.ok(tokensOf(h, D).some(t => t.id === other), 'the Fireball in another region stayed behind');
  finishBattle(h);
});

/* ---------- mods ---------- */

test('cr:types.mods.when — a non-Virus augment cannot be applied from hand during battle, but can in deployment', () => {
  const h = new Harness(60616);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const host = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  passTo(h, A);
  const idx = give(h, A, 'Curio Drifter');                // [Augment] {Evasive}, not a Virus
  assert.ok(!legalActions(h.state, A).some(a => a.type === 'augment' && a.index === idx), 'not offered in battle');
  assert.throws(() => h.do({ type: 'augment', seat: A, from: 'hand', index: idx, hostId: host }), /only Virus/);
  finishBattle(h);
  if (h.state.deployPlayer !== A) h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  const idx2 = h.state.players[A]!.hand.indexOf('Curio Drifter');
  assert.ok(legalActions(h.state, A).some(a => a.type === 'augment' && a.index === idx2 && a.hostId === host), 'offered in deployment');
});

test('cr:types.mods.spell-token-host — a non-Virus augment (Carapace Devourer) may augment a spell token in deployment', () => {
  const h = new Harness(60617);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  giveResources(h, A, 'earth', 2);
  let tok = -1;
  withE(h, e => { tok = e.createSpellToken(A, 'Fireball', 2, e.homeRegion(A)).id; });
  const idx = give(h, A, 'Carapace Devourer');            // [Augment] {Deadly}, not a Virus
  assert.ok(legalActions(h.state, A).some(a => a.type === 'augment' && a.index === idx && a.hostId === tok), 'offered on the token');
  h.do({ type: 'augment', seat: A, from: 'hand', index: idx, hostId: tok });
  assert.equal(ent(h, tok)!.mods.length, 1, 'attached');
});

/* ---------- general (tester additions) ---------- */

type PrintedRow = { name: string; type: string; kind: string };
const PRINTED_ROWS = Object.values(PRINTED as Record<string, PrintedRow>);
/** the type line with its {attribute} and [mod] glyphs dropped, as words */
const typeWords = (r: PrintedRow): string[] => r.type.replace(/\{[^}]*\}|\[[^\]]*\]/g, ' ').trim().split(/\s+/);
const isResourceRow = (r: PrintedRow): boolean => typeWords(r).at(-1) === 'Resource';

test('cr:types.general.kinds — every non-resource card is a unit, spell or spell unit, and every token is a unit token or a spell token', () => {
  assert.ok(PRINTED_ROWS.length > 400, 'premise: the whole pool is read');
  const cards = PRINTED_ROWS.filter(r => !isResourceRow(r) && !typeWords(r).includes('Token'));
  const tokens = PRINTED_ROWS.filter(r => typeWords(r).includes('Token'));
  assert.deepEqual([...new Set(cards.map(r => r.kind))].sort(), ['spell', 'spellUnit', 'unit'], 'three card types');
  assert.ok(tokens.length > 0, 'premise: the pool prints tokens');
  for (const t of tokens) assert.ok(t.kind === 'unit' || t.kind === 'spellToken', `${t.name} is a unit token or a spell token`);
  // and what the engine makes of them
  const h = new Harness(60630);
  toDeployment(h);
  const P = h.state.deployPlayer! as Seat;
  let robot = -1, fireball = -1;
  withE(h, e => {
    robot = e.spawnUnit(P, 'Robot', e.homeRegion(P), { token: true, counters: 1 }).id;
    fireball = e.createSpellToken(P, 'Fireball', 1, e.homeRegion(P)).id;
  });
  assert.equal(ent(h, robot)!.kind, 'unit');
  assert.equal(ent(h, robot)!.token, true, 'a unit token');
  assert.equal(ent(h, fireball)!.kind, 'spellToken', 'a spell token');
});

test('cr:types.general.type-line — the type line ends Unit, Spell or Spell Unit by type, and a token type line reads Token Unit or Spell Token', () => {
  const bad: string[] = [];
  for (const r of PRINTED_ROWS) {
    if (isResourceRow(r)) continue;
    const w = typeWords(r);
    const last = w.at(-1), last2 = w.slice(-2).join(' ');
    const want = w.includes('Token')
      ? (r.kind === 'unit' ? last2 === 'Token Unit' : r.kind === 'spellToken' && last2 === 'Spell Token')
      : r.kind === 'spellUnit' ? last2 === 'Spell Unit'
        : r.kind === 'spell' ? last === 'Spell'
          : r.kind === 'unit' && last === 'Unit' && last2 !== 'Spell Unit';
    if (!want) bad.push(`${r.name}: "${r.type}" (${r.kind})`);
  }
  assert.deepEqual(bad, []);
  const row = (n: string) => PRINTED_ROWS.find(r => r.name === n)!;
  assert.ok(row('Robot').type.endsWith('Robot Token Unit') && row('Robot').kind === 'unit', 'Robot Token Unit is a unit token');
  assert.ok(row('Fireball').type.endsWith('Spell Token') && row('Fireball').kind === 'spellToken', 'Spell Token is a spell token');
});

test('cr:types.general.stats — units, unit tokens and spell units carry power and defense; a spell token is no unit and takes no stat change', () => {
  const h = new Harness(60631);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  let robot = -1, crystal = -1, fireball = -1;
  withE(h, e => {
    robot = e.spawnUnit(D, 'Robot', e.homeRegion(D), { token: true, counters: 2 }).id;
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  withE(h, e => {
    crystal = e.createSpellToken(D, 'Crystal', 1, region).id;
    fireball = e.createSpellToken(D, 'Fireball', 1, region).id;
  });
  assert.deepEqual(effStats(h, atk), [7, 5], 'a unit: power 7, defense 5');
  assert.deepEqual(effStats(h, robot), [2, 2], 'a unit token: power and defense');
  passTo(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: crystal });   // "Put X +1/+1 counters on target unit"
  const menu = offered(h);
  assert.ok(menu.includes(JSON.stringify({ unit: atk })), 'a unit is offered');
  assert.ok(!menu.includes(JSON.stringify({ unit: fireball })), 'the spell token beside it is not');
  assert.ok(menu.every(k => !k.includes(`:${fireball}}`)), 'under no spelling');
  finishBattle(h);
});

test('cr:types.general.nouns — the printed noun decides: Tranquility (Spells) taxes a spell token, Arbiter of Armistice (Cards) does not', () => {
  const h = new Harness(60632);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const raider = spawn(h, D, 'Unit Token');
  spawn(h, A, 'Tranquility');
  spawn(h, A, 'Arbiter of Armistice');
  let tok = -1;
  withE(h, e => { tok = e.createSpellToken(A, 'Crystal', 1, e.homeRegion(A)).id; });
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  passTo(h, A);
  const e = new E(h.state);
  assert.equal(e.manaToPlay(A, 'Crystal'), 1, '"Spells cost one more": the token is a spell');
  assert.equal(e.lifeToPlay(A, 'Godray'), 2, 'control: a card played in battle pays 2 life');
  assert.equal(e.lifeToPlay(A, 'Crystal'), 0, '"Cards played": the token is not a card');
  giveResources(h, A, 'earth', 1);
  const life = h.state.players[A]!.life;
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: raider });
  assert.equal(new E(h.state).openMana(A), 0, 'the [1] tax was paid');
  assert.equal(h.state.players[A]!.life, life, 'no life was paid');
  finishBattle(h);
});

/* ---------- units (tester additions) ---------- */

test('cr:types.units.permanent — a unit stays in play through battle, regroup and the next turn until something removes it', () => {
  const h = new Harness(60633);
  toDeployment(h);
  const P = h.state.deployPlayer! as Seat;
  const whale = spawn(h, P, 'Good Whale');
  toNextBattle(h);
  finishBattle(h);
  assert.ok(ent(h, whale), 'still in play after a battle and its regroup');
  toNextBattle(h);
  finishBattle(h);
  assert.ok(ent(h, whale), 'and after a second turn');
  withE(h, e => { e.destroy(e.entity(whale)!, 'dies'); });
  drain(h);
  assert.ok(!ent(h, whale), 'until something removes it');
});

test('cr:types.units.power — an unblocked unit deals damage equal to its power', () => {
  const h = new Harness(60634);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  assert.equal(effStats(h, atk)[0], 3, 'premise: power 3');
  const life = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  finishBattle(h);
  assert.equal(life - h.state.players[D]!.life, 3, 'the defender took 3');
});

test('cr:types.units.defense — damage accumulates on a unit, and it dies once the total reaches its defense', () => {
  const h = new Harness(60635);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');                 // defense 5
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  const region = h.state.battle!.region;
  const burn = (x: number): void => {
    let tok = -1;
    withE(h, e => { tok = e.createSpellToken(D, 'Fireball', x, region).id; });
    passTo(h, D);
    h.do({ type: 'castSpellToken', seat: D, entityId: tok });
    pick(h, { unit: whale });
    pass(h); pass(h);
  };
  burn(2);
  assert.ok(ent(h, whale), '2 damage of 5: it lives');
  assert.equal(ent(h, whale)!.damage, 2, 'and the damage stays on it');
  burn(3);
  assert.ok(!ent(h, whale), '2 + 3 = 5 reaches its defense: it dies');
  finishBattle(h);
});

/* ---------- spells and spell units (tester additions) ---------- */

test('cr:types.spells.what — a spell (Manufacture) has its effect once and goes to the bin, never into play', () => {
  const h = new Harness(60636);
  toDeployment(h);
  const P = h.state.deployPlayer! as Seat;
  giveResources(h, P, 'metal', 6);
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Manufacture') });
  drain(h);
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Robot').length, 3, 'the effect happened');
  assert.ok(h.state.players[P]!.bin.includes('Manufacture'), 'the spell is in the bin');
  assert.ok(!Object.values(h.state.entities).some(e => e.card === 'Manufacture'), 'not in play');
  toNextBattle(h);
  finishBattle(h);
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Robot').length, 3, 'and it never happens again');
});

test('cr:types.spell-units.what — a played Jelly is a played spell with a one-time -2/-2, and then a unit with stats', () => {
  const { h, D, whale } = jellyBoard(60637);
  assert.ok(h.events.some(e => e.type === 'spellPlayed' && e.data?.['card'] === 'Jelly'), 'it was played as a spell');
  pass(h); pass(h);
  assert.deepEqual(effStats(h, whale), [5, 3], 'its spell part: -2/-2 on the whale');
  const jelly = unitsOf(h, D).find(u => u.card === 'Jelly')!;
  assert.ok(jelly, 'its body is a unit in play');
  assert.deepEqual(effStats(h, jelly.id), [2, 1], 'with stats');
  finishBattle(h);
});

/* ---------- tokens (tester additions) ---------- */

test('cr:types.tokens.what — tokens are created by an effect straight into play, through no hand, stack or bin', () => {
  const h = new Harness(60638);
  toDeployment(h);
  const P = h.state.deployPlayer! as Seat;
  giveResources(h, P, 'metal', 6);
  const hand0 = h.state.players[P]!.hand.length;
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Manufacture') });
  drain(h);
  const robots = unitsOf(h, P).filter(u => u.card === 'Robot');
  assert.equal(robots.length, 3);
  for (const r of robots) {
    assert.equal(r.token, true, 'a token');
    assert.equal(r.region, new E(h.state).homeRegion(P), 'in play, in the region the effect put it');
  }
  const spawned = h.events.slice(mark).filter(e => e.type === 'spawned' && e.data?.['card'] === 'Robot');
  assert.equal(spawned.length, 3, 'each one spawned into play');
  assert.ok(!h.state.players[P]!.hand.includes('Robot'), 'none passed through the hand');
  assert.equal(h.state.players[P]!.hand.length, hand0, 'the hand is back where it was');
  assert.ok(!h.state.players[P]!.bin.includes('Robot'), 'nor the bin');
  assert.ok(!h.state.stack.some(i => i.card === 'Robot'), 'nor the stack');
});

test('cr:types.tokens.kinds — a created token is either a unit token (a unit with the token flag) or a spell token', () => {
  const h = new Harness(60639);
  toDeployment(h);
  const P = h.state.deployPlayer! as Seat;
  const made: number[] = [];
  withE(h, e => {
    for (const req of [
      { form: 'unit' as const, name: 'Robot', x: 2 }, { form: 'unit' as const, name: 'Wisp', x: 0 },
      { form: 'spell' as const, name: 'Fireball', x: 1 }, { form: 'spell' as const, name: 'Poison', x: 1 },
      { form: 'spell' as const, name: 'Crystal', x: 1 },
    ]) made.push(e.createToken({ ...req, seat: P, region: e.homeRegion(P) }).id);
  });
  const kinds = made.map(id => { const t = ent(h, id)!; return t.kind === 'unit' ? (t.token ? 'unit token' : 'nontoken unit') : t.kind; });
  assert.deepEqual(kinds, ['unit token', 'unit token', 'spellToken', 'spellToken', 'spellToken']);
});

test('cr:types.tokens.unit-tokens — a unit token attacks and deals its power like a unit card', () => {
  const h = new Harness(60640);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  let tok = -1;
  withE(h, e => { tok = e.spawnUnit(A, 'Robot', e.homeRegion(A), { token: true, counters: 2 }).id; });
  assert.equal(ent(h, tok)!.token, true, 'setup: a real unit token');
  toNextBattle(h, A);
  assert.ok(legalActions(h.state, A).some(a => a.type === 'declareAttack'), 'the attack step is open');
  const life = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  assert.deepEqual(h.state.battle!.columns, [[tok]], 'it is attacking');
  finishBattle(h);
  assert.equal(life - h.state.players[D]!.life, 2, 'and dealt its power, 2');
});

function ridingBoard(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const atk = spawn(h, A, 'The Foretold');
  let tok = -1;
  withE(h, e => { tok = e.createSpellToken(A, 'Fireball', 1, e.homeRegion(A)).id; });
  toNextBattle(h, A);
  const home = ent(h, tok)!.region;
  return { h, A, atk, tok, home };
}

test('cr:types.tokens.spell-tokens.moving — a spell token rides into the enemy region only with an attacking unit, and stays there', () => {
  // with a unit: it comes along
  const a = ridingBoard(60641);
  a.h.do({ type: 'declareAttack', seat: a.A, columns: [[a.atk]], spellTokens: [a.tok] });
  const region = a.h.state.battle!.region;
  assert.notEqual(region, a.home, 'premise: the battle is away from home');
  assert.equal(ent(a.h, a.tok)!.region, region, 'the token moved with the attack');
  withE(a.h, e => { e.destroy(e.entity(a.atk)!, 'dies'); });
  drain(a.h);
  assert.equal(ent(a.h, a.tok)!.region, region, 'its unit gone, the token still stays: the move is not undone');
  assert.ok(!legalActions(a.h.state, a.A).some(x => 'entityId' in x && x.entityId === a.tok && x.type !== 'castSpellToken'),
    'and nothing offers to move it back');
  finishBattle(a.h);
  // without a unit: it cannot go
  const b = ridingBoard(60642);
  b.h.do({ type: 'declareAttack', seat: b.A, columns: [], spellTokens: [b.tok] });
  assert.equal(ent(b.h, b.tok)!.region, b.home, 'no attacking unit, no move');
  finishBattle(b.h);
});

/* ---------- mods (tester additions) ---------- */

test('cr:types.mods.what — an augment is applied not played and makes one card; a graft is the other kind; a text-only augment gives a spell token nothing', () => {
  const h = new Harness(60643);
  toDeployment(h);
  const P = h.state.deployPlayer! as Seat;
  spawn(h, P, 'Bloomcaster');
  const whale = spawn(h, P, 'Good Whale');
  giveResources(h, P, 'water', 1);
  const units0 = unitsOf(h, P).length;
  const mark = h.events.length;
  h.do({ type: 'augment', seat: P, from: 'hand', index: give(h, P, 'Curio Drifter'), hostId: whale });
  drain(h);
  assert.ok(!h.events.slice(mark).some(e => e.type === 'cardPlayed'), 'applying is not playing');
  assert.equal(unitsOf(h, P).length, units0, 'no new unit: Bloomcaster heard no play, and Curio Drifter is no separate unit');
  assert.equal(ent(h, whale)!.mods.length, 1, 'the mod is on the whale');
  assert.equal(ent(h, ent(h, whale)!.mods[0]!)!.appliedAs, 'augment');
  assert.ok(ownAttrs(h, whale).has('Evasive'), 'the one card has the text the mod adds');
  // the other kind: a graft
  const mush = spawn(h, P, 'Spewing Mushroom');
  giveResources(h, P, 'wood', 8);
  h.do({ type: 'graft', seat: P, from: 'hand', index: give(h, P, 'Biotoxicity'), hostId: mush, position: 0 });
  drain(h);
  assert.equal(ent(h, ent(h, mush)!.mods[0]!)!.appliedAs, 'graft');
  // a spell token augmented with text only (Bloomcaster) gains none of it
  let tok = -1;
  withE(h, e => { tok = e.createSpellToken(P, 'Fireball', 1, e.homeRegion(P)).id; });
  giveResources(h, P, 'wood', 2);
  h.do({ type: 'augment', seat: P, from: 'hand', index: give(h, P, 'Bloomcaster'), hostId: tok });
  drain(h);
  assert.equal(ent(h, tok)!.mods.length, 1, 'attached to the token');
  const tokens0 = unitsOf(h, P).filter(u => u.card === 'Unit Token').length;
  giveResources(h, P, 'water', 6);
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Good Whale') });
  drain(h);
  // the board's own Bloomcaster makes one 1/1; the token's copy of the text must make none
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Unit Token').length, tokens0 + 1,
    'one 1/1, from the Bloomcaster in play: the token gained no text');
});
