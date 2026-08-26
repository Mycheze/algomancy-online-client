/* Per-card tests for the dark-b batch (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources) so parallel card
 * registration cannot shift assertions; seeds are 4200-4299.
 *
 * Covers the expansion mechanics this batch touches: rot as a player counter
 * and its start-of-deployment replacement hook (R38 — Skittering Blight,
 * Blightmound, Fester, Legion of the Depths, Plague Ritual, Thought
 * Extraction), trashing and the per-battle trash ledger (R40 — Cerebrox,
 * Cthyrian Culler, Dropslime's discard-me mode, Muck Rummager, Palewing), the
 * Wight/Wraith token (R47 — Legion of the Depths, Plague Ritual), {Afflicting}
 * on -1/-1 counter kills (R48 — Umbral Decay) and the mod/board manipulation
 * cards (Grim Bargain, Hooba-Mon, Necromantic Rebuke, Rotbeast, Sarcophage).
 * Writhing Host is LIVE as of R123: a bin-anchored haste grant, paid for by
 * erasing the grantor out of the bin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import {
  effStats, ent, give, giveResources, handIdx, logFor, ownAttrs, pass, skipHasteStep, spawn,
  toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { Action, DecisionOption, EngineEvent, Entity, EntityId, Seat } from '../src/types.ts';

// ── helpers ───────────────────────────────────────────────────────────

/** Run raw engine calls against the harness state, absorbing a suspension and
 * keeping the harness log honest (trash assertions read h.events/h.log). */
function withE(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

/**
 * Drive everything pending to a standstill: answer decisions (the first option
 * `choose` accepts, else the first one; trigger ordering takes the identity
 * order) and pass priority while the stack has anything on it.
 */
function resolveAll(h: Harness, choose: (o: DecisionOption) => boolean = () => true): void {
  let guard = 120;
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (dec) {
      if (dec.pickOrder) {
        h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
        continue;
      }
      const i = dec.options.findIndex(choose);
      h.do({ type: 'decide', seat: dec.seat, choice: i === -1 ? 0 : i });
      continue;
    }
    if (h.state.phase === 'battle' && h.state.stack.length) { pass(h); continue; }
    return;
  }
  throw new Error('resolveAll did not terminate');
}

/** answer the pending decision by picking the option matching a target ref */
function pickRef(h: Harness, ref: unknown): void {
  const dec = h.state.decision!;
  const i = dec.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify(ref));
  if (i === -1) throw new Error(`no option matching ${JSON.stringify(ref)}`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

/** next turn's battle, attack with `columns`, settle the attack-window triggers */
function attackWith(h: Harness, attacker: Seat, columns: EntityId[][],
  choose?: (o: DecisionOption) => boolean): void {
  toNextBattle(h, attacker);
  h.do({ type: 'declareAttack', seat: attacker, columns });
  resolveAll(h, choose);
}

/** from the attack window: no blocks, then let combat damage happen and settle */
function throughCombat(h: Harness, defender: Seat, choose?: (o: DecisionOption) => boolean): void {
  pass(h); pass(h);                                        // → block step
  h.do({ type: 'declareBlocks', seat: defender, blocks: {} });
  pass(h); pass(h);                                        // → combat damage
  resolveAll(h, choose);
}

const trashes = (h: Harness): EngineEvent[] => h.events.filter(ev => ev.type === 'trashed');
const rotOf = (h: Harness, seat: Seat): number => h.q.rot(seat);
const entsNamed = (h: Harness, card: string): Entity[] =>
  Object.values(h.state.entities).filter(e => e.card === card);
const modsOn = (h: Harness, id: EntityId): Entity[] =>
  (ent(h, id)?.mods ?? []).map(m => ent(h, m)!).filter(Boolean);
const handSize = (h: Harness, seat: Seat): number => h.state.players[seat]!.hand.length;

/** finish the battle phase from wherever we are, answering anything asked */
function endBattle(h: Harness): void {
  let guard = 200;
  while (h.state.phase === 'battle' && guard-- > 0) {
    resolveAll(h);
    if (h.state.phase !== 'battle') break;
    const b = h.state.battle!;
    if (b.step === 'declare') h.do({ type: 'declareAttack', seat: b.attacker, columns: [] });
    else if (b.step === 'blocks') h.do({ type: 'declareBlocks', seat: b.defender, blocks: {} });
    else if (!h.state.decision) pass(h);
  }
}

/** roll the current deployment into the next one, so R38 rot damage lands */
function intoNextDeployment(h: Harness, attacker: Seat): void {
  toNextBattle(h, attacker);
  endBattle(h);
}

// ── Blightmound ───────────────────────────────────────────────────────

test('Blightmound: dealing combat damage gives each opponent a rot', () => {
  const h = new Harness(4200);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const bm = spawn(h, A, 'Blightmound');                   // 4/3 {Poisonous}
  attackWith(h, A, [[bm]]);
  assert.equal(rotOf(h, D), 0, 'declaring an attack is not dealing damage');
  throughCombat(h, D);
  assert.equal(rotOf(h, D), 1, 'the face hit gave the defender a rot');
  assert.equal(rotOf(h, A), 0, 'and never its own controller');
});

test('Blightmound: its POISONOUS unit damage counts as dealing combat damage too', () => {
  const h = new Harness(4201);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const bm = spawn(h, A, 'Blightmound');                   // 4/3 {Poisonous}
  const blocker = spawn(h, D, 'Unit Token');               // 1/1: eats the counters
  const lifeD = h.state.players[D]!.life;
  attackWith(h, A, [[bm]]);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  resolveAll(h);
  pass(h); pass(h);                                        // combat damage
  resolveAll(h);
  assert.equal(ent(h, blocker), undefined, 'Poisonous killed the blocker with -1/-1 counters');
  assert.equal(h.state.players[D]!.life, lifeD, 'no life was lost — the column was blocked');
  assert.equal(rotOf(h, D), 1, 'but damage was still dealt, so the rot lands (R38)');
});

test('Blightmound: dying also gives each opponent a rot — and [Switch1] bounds it', () => {
  const h = new Harness(4202);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const bm = spawn(h, A, 'Blightmound');
  const brute = spawn(h, D, 'Good Whale');                 // 7/5: kills the 4/3
  attackWith(h, A, [[bm]]);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [brute] } });
  resolveAll(h);
  pass(h); pass(h);
  resolveAll(h);
  assert.equal(ent(h, bm), undefined, 'Blightmound died in combat');
  assert.equal(rotOf(h, D), 1,
    'exactly one rot — it both dealt damage and died, but [Switch1] fires once per turn (R9)');
});

// ── Cerebrox ──────────────────────────────────────────────────────────

test('Cerebrox: whenever another card is trashed, each OTHER unit shrinks until regroup', () => {
  const h = new Harness(4203);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const brox = spawn(h, P, 'Cerebrox');                    // 3/3
  const ally = spawn(h, P, 'Good Whale');                  // 7/5
  const idx = give(h, P, 'Unit Token');
  withE(h, e => { e.discardFromHand(P, idx); });           // R40: discarding trashes
  assert.deepEqual(effStats(h, ally), [6, 4], 'the ally shrank');
  assert.deepEqual(effStats(h, brox), [3, 3], 'but not Cerebrox itself ("each OTHER unit")');
});

test('Cerebrox: a shrink to zero toughness kills, and it never shrinks itself', () => {
  const h = new Harness(4204);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const brox = spawn(h, P, 'Cerebrox');
  const chaff = spawn(h, P, 'Unit Token');                 // 1/1: one -1/-1 kills it
  const idx = give(h, P, 'Unit Token');
  withE(h, e => { e.discardFromHand(P, idx); });
  assert.equal(ent(h, chaff), undefined, 'the 1/1 died on the state check');
  // that death is itself a trash (a bin entered from play), which Cerebrox
  // also hears — so excluding its own body is load-bearing, not decoration
  assert.deepEqual(effStats(h, brox), [3, 3], 'Cerebrox never shrinks itself');
  assert.ok(trashes(h).length >= 2, 'the discard and the death both trashed');
});

// ── Cthyrian Culler ───────────────────────────────────────────────────

test('Cthyrian Culler: whenever a player trashes a card, each opponent loses 1 life', () => {
  const h = new Harness(4205);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const culler = spawn(h, A, 'Cthyrian Culler');
  attackWith(h, A, [[atk, culler]]);                       // both into the battle region
  const lifeD = h.state.players[D]!.life, lifeA = h.state.players[A]!.life;
  const idx = give(h, D, 'Unit Token');
  withE(h, e => { e.discardFromHand(D, idx); });           // the OPPONENT trashes
  resolveAll(h);
  assert.equal(h.state.players[D]!.life, lifeD - 1, '"a player" is any player, theirs included');
  assert.equal(h.state.players[A]!.life, lifeA, 'the controller is not an opponent of itself');
});

test('Cthyrian Culler: its [Augment] half makes each player discard after combat', () => {
  const h = new Harness(4206);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const culler = spawn(h, A, 'Cthyrian Culler');
  toNextBattle(h, A);
  const handA = handSize(h, A), handD = handSize(h, D);
  h.do({ type: 'declareAttack', seat: A, columns: [[culler]] });
  resolveAll(h);
  throughCombat(h, D);
  assert.equal(handSize(h, A), handA - 1, 'the attacker discarded');
  assert.equal(handSize(h, D), handD - 1, 'and so did the defender');
  assert.ok(trashes(h).length >= 2, 'both discards are trashes (R40)');
});

// ── Dropslime ─────────────────────────────────────────────────────────

test('Dropslime: the printed "1 Discard me" line is a deployment play mode that trashes it', () => {
  const h = new Harness(4207);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 1);
  const idx = give(h, P, 'Dropslime');
  assert.ok(h.legal(P).some(a => a.type === 'playCard' && a.handIndex === idx && a.mode === 'discardMe'),
    'the cost line gives it a second play mode (engine-side, R40)');
  h.do({ type: 'playCard', seat: P, handIndex: idx, mode: 'discardMe' });
  resolveAll(h);
  assert.equal(h.q.openMana(P), 0, 'the [1] was paid');
  assert.ok(h.state.players[P]!.bin.includes('Dropslime'), 'and it is in the bin');
  assert.equal(trashes(h).length, 1, 'discarding from hand is trashing');
  // ⚠ its own mode is DEPLOYMENT timing (no {Battle} marker on the cost line),
  // and the trash ledger is battle-scoped — so it fires for nothing
  assert.ok(h.log.some(l => l.includes('nothing has been trashed in this battle')),
    'the trigger still fired, from the bin, and found a count of zero');
});

test('Dropslime: trashed DURING battle, it zaps for everything trashed in that battle', () => {
  const h = new Harness(4208);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  attackWith(h, A, [[atk]]);
  give(h, A, 'Dropslime');
  const pitchD = give(h, D, 'Good Whale');
  withE(h, e => { e.discardFromHand(D, pitchD); });         // +1 trash, either side counts
  resolveAll(h);
  assert.equal(h.q.battleCounter(h.state.battle!.region, 'trashed'), 1,
    'the per-battle ledger counted it');
  const lifeD = h.state.players[D]!.life;
  withE(h, e => { e.discardFromHand(A, handIdx(h, A, 'Dropslime')); });
  assert.ok(h.state.decision, 'the trashed trigger fires from the BIN and asks for a target');
  pickRef(h, { player: D });
  resolveAll(h);
  assert.equal(h.state.players[D]!.life, lifeD - 2, "1 already trashed + Dropslime's own = 2 damage");
});

/* ── R137 / PLAYTEST REPORT #93, room ANBB, 2026-08-24 ───────────────────
 *
 * The owner: "I'm pretty sure we're doing death and trashing wrong for
 * Unstable units. Dropslime wouldn't make sense otherwise. But here, it died
 * and I didn't get its trigger or the other one."
 *
 * That game replays FAITHFUL under the engine of the day, and Dropslime
 * demonstrated BOTH halves of the bug by itself:
 *   - discarded from HAND, unmodded → "Ben trashes Dropslime (from hand)."
 *     → trigger fired → 2 damage to Rashi.  Correct, and always was.
 *   - later, in play, grafted a Wraith by Plague Ritual → {Unstable} → blocked,
 *     took lethal → "Dropslime dies — Unstable: it and its 1 mod(s) are
 *     ERASED." → no trash, no trigger, no ledger bump.
 * On that same combat-damage step an unmodded Thoughtripper died, binned,
 * trashed and fired correctly. Two disposals that look identical to a player,
 * behaving differently — which is what R137 removes.
 */
test('R137 / playtest #93: Dropslime fires from HAND *and* dying while Unstable — the same card, both halves', () => {
  const h = new Harness(4290);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const drop = spawn(h, A, 'Dropslime');                   // 1/1, will die Unstable
  const wall = spawn(h, D, 'Muck Rummager');               // 2/3 blocker, kills it
  // ANBB's Plague Ritual line: "Augments a Wraith on one of their units"
  withE(h, e => { e.augmentWraith(e.entity(drop)!, A); });
  assert.ok(new E(h.state).isUnstable(ent(h, drop)!), 'a modded unit is {Unstable} (R69)');
  give(h, A, 'Dropslime');                                 // the hand copy, for half one
  attackWith(h, A, [[drop]]);

  // ── half one: discarded from HAND. This half NEVER broke.
  const lifeD0 = h.state.players[D]!.life;
  withE(h, e => { e.discardFromHand(A, handIdx(h, A, 'Dropslime')); });
  assert.ok(h.state.decision, 'the trashed trigger fires from the bin and asks for a target');
  pickRef(h, { player: D });
  resolveAll(h);
  assert.equal(h.state.players[D]!.life, lifeD0 - 1,
    'one card trashed this battle — its own discard — so 1 damage');

  // ── half two: the SAME card in play, dying while {Unstable}. This is #93.
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [wall] } });
  pass(h); pass(h);
  // the Wraith mod donates a death trigger of its own, so answer everything
  // and steer only Dropslime's damage at the player
  resolveAll(h, o => JSON.stringify(o.value) === JSON.stringify({ player: D }));
  const trashed = trashes(h).filter(ev => ev.data?.['card'] === 'Dropslime');
  assert.equal(trashed.length, 2, 'both halves trashed — hand and Unstable death');
  assert.equal(trashed[1]!.data!['from'], 'play', 'the second came from PLAY');
  assert.equal(trashed[1]!.data!['seat'], A, 'and A trashed it: it entered A\'s bin (R40)');
  assert.equal(h.state.players[D]!.life, lifeD0 - 1 - 2,
    'two cards trashed this battle by now, so the Unstable death zaps for 2 — '
    + 'before R137 it dealt nothing at all, because it never fired');
  // and the destination a player SEES is exactly what it always was
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Dropslime').length, 1,
    'only the DISCARDED copy rests in the bin — the Unstable one was swept out again');
  assert.ok(h.q.erased(A).includes('Dropslime'), 'the Unstable copy is in the erased pile (R65)');
  assert.ok(h.log.some(l => /Dropslime is erased from the bin — Unstable/.test(l)),
    'and the log tells it in order: dies → bin, trashes, erased');
});

test('R137 / ANBB: an Unstable death and an unmodded death on the SAME damage step both trash and both fire', () => {
  const h = new Harness(4291);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const a1 = spawn(h, A, 'Muck Rummager');                 // 2/3 attackers, both survive
  const a2 = spawn(h, A, 'Muck Rummager');
  const drop = spawn(h, D, 'Dropslime');                   // 1/1, will be {Unstable}
  const trip = spawn(h, D, 'Thoughtripper');               // 1/1, unmodded — the control
  withE(h, e => { e.augmentWraith(e.entity(drop)!, D); });
  giveResources(h, D, 'dark', 2);                          // so Thoughtripper's [2] is payable
  give(h, A, 'Good Whale');                                // something for A to discard
  attackWith(h, A, [[a1], [a2]]);
  const region = h.state.battle!.region;
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [drop], 1: [trip] } });
  pass(h); pass(h);
  // read the ledger at the END of the damage step, before any queued trigger
  // resolves and starts trashing things of its own
  const names = trashes(h).map(ev => ev.data!['card']);
  assert.ok(names.includes('Dropslime'), 'the Unstable blocker trashed (R137 — it used to not)');
  assert.ok(names.includes('Thoughtripper'), 'and the unmodded one, as it always did');
  assert.ok(!names.includes('Wraith'), 'the token MOD has no card to bin, so no third trash (R69)');
  assert.equal(h.q.battleCounter(region, 'trashed'), 2,
    'the per-battle ledger counts BOTH deaths now — this is the number Dropslime reads');
  // aim Dropslime's zap at a player so it does not kill an attacker and skew
  // everything downstream
  resolveAll(h, o => JSON.stringify(o.value) === JSON.stringify({ player: A }));
  assert.ok(trashes(h).some(ev => ev.data?.['from'] === 'hand' && ev.data?.['seat'] === A),
    "Thoughtripper's trigger resolved too: A paid the [2] and discarded");
  // both are gone from play, and each went where its own rule sends it
  assert.ok(h.state.players[D]!.bin.includes('Thoughtripper'), 'the plain card rests in the bin');
  assert.ok(!h.state.players[D]!.bin.includes('Dropslime'),
    'the Unstable one is swept back out — the visible destination never changed');
  assert.ok(h.q.erased(D).includes('Dropslime'), 'into the public erased pile (R65)');
});

test('R137: Muck Rummager sees an Unstable death — "when you trash a card during battle, draw"', () => {
  const h = new Harness(4292);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Muck Rummager');                // 2/3, kills the 1/1 blocker
  spawn(h, D, 'Muck Rummager');                            // D's WATCHER, at home
  const drop = spawn(h, D, 'Dropslime');
  withE(h, e => { e.augmentWraith(e.entity(drop)!, D); });
  attackWith(h, A, [[atk]]);
  const handD = handSize(h, D);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [drop] } });
  pass(h); pass(h);
  resolveAll(h);
  assert.ok(trashes(h).some(ev => ev.data?.['card'] === 'Dropslime' && ev.data?.['seat'] === D),
    'D trashed it — the bin it entered is D\'s');
  assert.equal(handSize(h, D), handD + 1,
    'Muck Rummager drew off it. Before R137 this watcher silently under-triggered '
    + 'on EVERY modded-unit death, which nobody could report: you cannot see a trigger that does not happen.');
});

// ── Fester ────────────────────────────────────────────────────────────

test('Fester: target player gains a rot', () => {
  const h = new Harness(4209);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'dark', 2);                          // d/1
  give(h, A, 'Fester');
  attackWith(h, A, [[atk]]);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Fester') });
  pickRef(h, { player: D });
  resolveAll(h);
  assert.equal(rotOf(h, D), 1, 'the targeted player gained a rot');
  assert.equal(rotOf(h, A), 0);
  assert.ok(h.state.players[A]!.bin.includes('Fester'), 'the spell resolved to the bin');
  assert.equal(trashes(h).length, 0, 'from the stack, so not a trash (R40)');
});

test("Fester's rot really bites at the start of the next deployment (R38)", () => {
  const h = new Harness(4210);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  withE(h, e => { e.gainRot(P, 2); });                     // as if Festered twice
  const life = h.state.players[P]!.life;
  intoNextDeployment(h, P);
  assert.equal(h.state.phase, 'deploy');
  assert.equal(h.state.players[P]!.life, life - 2, 'damage equal to the rot');
  assert.equal(rotOf(h, P), 2, 'and the rot never decays');
});

// ── Grim Bargain ──────────────────────────────────────────────────────

test('Grim Bargain: one sacrifice round per [3] spent, and you draw for your nontoken losses', () => {
  const h = new Harness(4211);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');                   // a NONTOKEN card
  const theirs = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'dark', 7);                          // dd/X — X = 6 → two rounds
  give(h, A, 'Grim Bargain');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  resolveAll(h);
  let tok = 0;
  withE(h, e => { tok = e.spawnUnit(A, 'Unit Token', h.state.battle!.region, { token: true }).id; });
  const hand = handSize(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Grim Bargain') });
  pickRef(h, 6);                                           // X chosen and paid at cast (R35)
  resolveAll(h);
  assert.equal(ent(h, atk), undefined, "A's nontoken unit was sacrificed");
  assert.equal(ent(h, tok), undefined, 'and so was its token, in the second round');
  assert.equal(ent(h, theirs), undefined, 'D lost its only unit too');
  assert.equal(handSize(h, A), hand - 1 + 1,
    'the spell left the hand and exactly one card was drawn — tokens draw nothing');
});

test('Grim Bargain: less than [3] spent sacrifices nothing at all', () => {
  const h = new Harness(4212);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const theirs = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'dark', 2);
  give(h, A, 'Grim Bargain');
  attackWith(h, A, [[atk]]);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Grim Bargain') });
  pickRef(h, 2);
  resolveAll(h);
  assert.ok(ent(h, theirs) && ent(h, atk), 'floor(2/3) = 0 rounds');
  assert.ok(h.log.some(l => l.includes('less than [3] spent')));
});

// ── Hooba-Mon ─────────────────────────────────────────────────────────

test('Hooba-Mon: attacking may exchange it for a cheap unit in your bin', () => {
  const h = new Harness(4213);
  toDeployment(h);
  const A = h.state.initiative;
  const hooba = spawn(h, A, 'Hooba-Mon');                  // 1/1
  h.state.players[A]!.bin.push('Unit Token');              // a [0] unit — cost ≤ 3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hooba]] });
  // R67: the bin unit is a DECLARED target, so it is chosen while the trigger
  // is still being cast — before it reaches the stack, not once it resolves
  assert.equal(h.state.decision!.kind, 'targets');
  assert.equal(h.state.stack.length, 0, 'targets come first: nothing on the stack yet');
  pickRef(h, { bin: { seat: A, card: 'Unit Token' } });
  assert.equal(h.state.stack.length, 1, 'the attack trigger uses the stack (battle timing)');
  resolveAll(h);
  assert.equal(entsNamed(h, 'Hooba-Mon').length, 0, 'Hooba-Mon left play…');
  assert.ok(h.state.players[A]!.bin.includes('Hooba-Mon'), "…into its owner's bin");
  assert.equal(trashes(h).filter(t => t.data!['card'] === 'Hooba-Mon').length, 1,
    'a bin entered from play is a trash (R40)');
  const fresh = entsNamed(h, 'Unit Token').find(e => e.kind === 'unit');
  assert.ok(fresh, 'and the bin unit came into play');
  assert.ok(h.state.battle!.columns.some(c => c.includes(fresh!.id)),
    "taking the exchanged unit's exact position in the formation");
  assert.ok(!h.state.players[A]!.bin.includes('Unit Token'), 'it left the bin');
});

// ── R146: Hooba-Mon's exchange obeys the {Unstable} bin replacement ────
//
// The three tests below are ONE rule seen from three sides. `exchangeInPlace`
// sends the outgoing body to a bin FROM PLAY, and R137/R145 say an {Unstable}
// card making that trip is binned, TRASHED there, and only then swept into the
// erased pile — the exact route E.destroy takes. Before R146 the card was
// binned and simply left there, recurrable.

test('R146: Hooba-Mon exchanges a MODDED host → the host is trashed, then ERASED (not left in a bin)', () => {
  const h = new Harness(4290);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Rune Channeler');              // 4/3, no printed attrs
  giveResources(h, A, 'dark', 3);
  // Hooba-Mon goes on as an AUGMENT, which is the line the ⚠ is about: `self`
  // is now the HOST, and a host wearing a mod is {Unstable} by derivation
  // (R69/R79) — this is the ORDINARY case for this card, not a corner one.
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'the host really is modded…');
  assert.ok(new E(h.state).isUnstable(ent(h, host)!), '…and therefore Unstable');
  h.state.players[A]!.bin.push('Unit Token');              // a [0] unit — cost ≤ 3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pickRef(h, { bin: { seat: A, card: 'Unit Token' } });
  resolveAll(h);
  assert.equal(entsNamed(h, 'Rune Channeler').length, 0, 'the host left play');
  // R137: it passed THROUGH the bin and was trashed there…
  assert.equal(trashes(h).filter(t => t.data!['card'] === 'Rune Channeler').length, 1,
    'a bin entered from play is a trash, Unstable or not (R40/R137)');
  // …and the sweep then took it out again, onto the public pile (R65)
  assert.ok(!h.state.players[A]!.bin.includes('Rune Channeler'),
    'the Unstable card does NOT stay in the bin');
  assert.ok(new E(h.state).erased(A).includes('Rune Channeler'),
    'it reaches the public erased pile');
  // ORDERING, which is the half a "not in the bin" assertion alone would miss:
  // trash first, erase after. "Erased" here must not mean "skipped the trash".
  const order = h.events
    .filter(ev => (ev.type === 'trashed' || ev.type === 'erased')
      && ev.data!['card'] === 'Rune Channeler')
    .map(ev => ev.type);
  assert.deepEqual(order, ['trashed', 'erased'], 'R137 ordering: bin → trashed → swept');
});

test('R146 control: Hooba-Mon exchanges an UNMODDED host → it still BINS and stays there', () => {
  const h = new Harness(4291);
  toDeployment(h);
  const A = h.state.initiative;
  // played normally, Hooba-Mon's text-box [Augment] is live on itself, so
  // `self` is Hooba-Mon: no mods, no stamp, no printed {Unstable}
  const hooba = spawn(h, A, 'Hooba-Mon');
  assert.equal(new E(h.state).isUnstable(ent(h, hooba)!), false, 'nothing makes it Unstable');
  h.state.players[A]!.bin.push('Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hooba]] });
  pickRef(h, { bin: { seat: A, card: 'Unit Token' } });
  resolveAll(h);
  assert.equal(entsNamed(h, 'Hooba-Mon').length, 0, 'Hooba-Mon left play…');
  assert.ok(h.state.players[A]!.bin.includes('Hooba-Mon'), '…and STAYS in the bin');
  assert.equal(trashes(h).filter(t => t.data!['card'] === 'Hooba-Mon').length, 1,
    'trashed on the way in (R40)');
  assert.ok(!new E(h.state).erased(A).includes('Hooba-Mon'),
    'and nothing erased it — the sweep is for Unstable cards only');
});

// ⚠ SUPERSEDED BY A RULING, AND REWRITTEN RATHER THAN DELETED.
//
// R146 shipped this test asserting that a TOKEN host exchanged out of play was
// never binned and never trashed, and R146's own write-up flagged that as an
// OPEN QUESTION for the owner rather than a decision: `E.destroy` bins and
// trashes a dying token before sweeping it (R40's 2026-08-21 amendment), so
// the two departures disagreed.
//
// Bena ruled on 2026-08-25:
//
//   "For all intents and purposes a token is a normal thing that just ceases
//    to exist in all zones other than in play/stack whenever SBAs are checked."
//
// So it DOES enter the bin and it IS trashed there — the sweep is what removes
// it, afterwards. The assertions below are inverted deliberately: what R146
// pinned was the behaviour of the day, not the rule. The test keeps its shape
// and its seed so the change is legible in the diff.
test('R152 (was R146): Hooba-Mon exchanges a TOKEN host → binned and trashed, THEN swept', () => {
  const h = new Harness(4292);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let host = -1;
  withE(h, e => {
    host = e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [3, 3] }).id;
  });
  giveResources(h, A, 'dark', 3);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
  h.state.players[A]!.bin.push('Skittering Blight');       // a [1] unit — cost ≤ 3
  toNextBattle(h, A);
  const before = trashes(h).length;
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pickRef(h, { bin: { seat: A, card: 'Skittering Blight' } });
  resolveAll(h);
  assert.equal(ent(h, host), undefined, 'the token host left play');
  assert.equal(trashes(h).slice(before).filter(t => t.data!['card'] === 'Unit Token').length, 1,
    'RULED 2026-08-25: it was in the bin, so R40 trashed it (was 0 under R146)');
  assert.ok(!h.state.players[A]!.bin.includes('Unit Token'),
    '…and then ceased to exist there — the state-based sweep (was "never binned")');
  assert.ok(entsNamed(h, 'Skittering Blight').some(e => e.kind === 'unit'),
    'the exchange itself still happened');
});

// ── R152: an exchange is a leave-play, and behaves like one ────────────
//
// R146 aligned the BODY's disposal with E.destroy and left the rest of the
// departure disagreeing with it. Two halves here:
//
//  (1) the 'despawned' event was LOGGED and never FIRED, so no listener in the
//      game saw a Hooba-Mon exchange. The tests below drive REAL CARDS — the
//      host's own donated [Augment] despawn text, and a third-party watcher
//      standing in the battle region — rather than reading the log line, which
//      was already there and already proved nothing.
//
//  (2) the host's MODS were `delete g.s.entities[modId]` and nothing else: no
//      bin, no trash, no 'erased'. R137's argument applies verbatim — a
//      nontoken mod is binned and trashed when its carrier is recalled or
//      cached, so an exchange skipping that is the same mod card behaving
//      differently by how its host left play.

test('R152: the exchanged host\'s own [Augment] despawn text FIRES (not just logged)', () => {
  const h = new Harness(4293);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Rune Channeler');
  giveResources(h, A, 'dark', 6);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
  // Gzxyclop: "[Augment] When I despawn, discard two cards." On the host, "I"
  // is the host — a real card that watches units leaving play, and the same
  // sentence a recall or a cache already honours through afterDespawn().
  withE(h, e => { e.attachMod(e.entity(host)!, 'Gzxyclop', A, 'augment'); });
  give(h, A, 'Good Whale'); give(h, A, 'Good Whale');      // something to discard
  h.state.players[A]!.bin.push('Skittering Blight');   // a real card: a bin never holds a token (R152)
  toNextBattle(h, A);
  const before = handSize(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pickRef(h, { bin: { seat: A, card: 'Skittering Blight' } });
  resolveAll(h);
  assert.equal(entsNamed(h, 'Rune Channeler').length, 0, 'the host left play');
  assert.equal(handSize(h, A), before - 2,
    'the despawn was FIRED: the donated "when I despawn" text discarded two');
});

test('R152: a THIRD-PARTY watcher of "one of your units despawns" sees the exchange', () => {
  const h = new Harness(4294);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const host = spawn(h, A, 'Rune Channeler');
  // Demon of the Depths: "[Augment] Whenever one of your units despawns, I
  // deal 1 damage to any target." Its carrier must stand in the battle region
  // for R12 to let it hear the event, so it attacks in its own column.
  const carrier = spawn(h, A, 'Good Whale');
  withE(h, e => { e.attachMod(e.entity(carrier)!, 'Demon of the Depths', A, 'augment'); });
  giveResources(h, A, 'dark', 3);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
  h.state.players[A]!.bin.push('Skittering Blight');   // a real card: a bin never holds a token (R152)
  toNextBattle(h, A);
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[host], [carrier]] });
  pickRef(h, { bin: { seat: A, card: 'Skittering Blight' } });     // Hooba-Mon's pick
  // …and the Demon's "any target", aimed at the defending player so its 1
  // damage is visible as a life total rather than as a log line
  resolveAll(h, o => JSON.stringify(o.value) === JSON.stringify({ player: D }));
  assert.equal(entsNamed(h, 'Rune Channeler').length, 0, 'the host left play');
  assert.equal(h.state.players[D]!.life, lifeD - 1,
    'a unit despawned and the watcher fired — the exchange is not invisible');
});

test('R152: a NONTOKEN mod on an exchanged host is binned and TRASHED (R137)', () => {
  const h = new Harness(4295);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Rune Channeler');
  giveResources(h, A, 'dark', 6);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
  // Afflicting Anima: "When I am trashed, you may pay [1] to create a Wraith."
  // The assertion is that the TRIGGER runs, not that the bin held the name for
  // a moment — a Wraith on the board is the only proof of that.
  withE(h, e => { e.attachMod(e.entity(host)!, 'Afflicting Anima', A, 'augment'); });
  h.state.players[A]!.bin.push('Skittering Blight');   // a real card: a bin never holds a token (R152)
  toNextBattle(h, A);
  giveResources(h, A, 'dark', 2);                          // the [1] the trigger asks for
  assert.equal(entsNamed(h, 'Wraith').length, 0, 'no Wraith yet');
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pickRef(h, { bin: { seat: A, card: 'Skittering Blight' } });
  resolveAll(h);
  assert.equal(trashes(h).filter(t => t.data!['card'] === 'Afflicting Anima').length, 1,
    'the mod entered a bin FROM PLAY, so R40 trashed it');
  assert.ok(entsNamed(h, 'Wraith').some(e => e.kind === 'unit'),
    'and its own "when I am trashed" trigger really ran');
  // the same is true of Hooba-Mon, which is a mod on this line as well
  assert.equal(trashes(h).filter(t => t.data!['card'] === 'Hooba-Mon').length, 1,
    'Hooba-Mon is a mod here too, and takes the same route');
});

test('R152: the mods reach the public ERASED pile with the Unstable body (R65)', () => {
  const h = new Harness(4296);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Rune Channeler');
  giveResources(h, A, 'dark', 6);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
  withE(h, e => { e.attachMod(e.entity(host)!, 'Nothyr', A, 'augment'); });
  h.state.players[A]!.bin.push('Skittering Blight');   // a real card: a bin never holds a token (R152)
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pickRef(h, { bin: { seat: A, card: 'Skittering Blight' } });
  resolveAll(h);
  const erased = new E(h.state).erased(A);
  // a host wearing mods is {Unstable} by derivation (R69/R79), so the sweep
  // takes the body AND the mods — exactly what a death does
  assert.ok(erased.includes('Rune Channeler'), 'the body reaches the erased pile');
  assert.ok(erased.includes('Hooba-Mon'), 'and so does the mod that did the exchanging');
  assert.ok(erased.includes('Nothyr'), 'and every other nontoken mod');
  const bin = h.state.players[A]!.bin;
  assert.ok(!bin.includes('Hooba-Mon') && !bin.includes('Nothyr'),
    'none of them is left sitting in the bin, recurrable');
  // ORDERING, the half a "not in the bin" assertion alone would miss: the mod
  // was trashed on the way IN and swept afterwards, never "skipped the trash"
  const order = h.events
    .filter(ev => (ev.type === 'trashed' || ev.type === 'erased') && ev.data!['card'] === 'Nothyr')
    .map(ev => ev.type);
  assert.deepEqual(order, ['trashed', 'erased'], 'R137 ordering: bin → trashed → swept');
});

test('R152: a TOKEN mod on an exchanged host is ERASED and never binned (R69)', () => {
  const h = new Harness(4297);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Rune Channeler');
  giveResources(h, A, 'dark', 3);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
  withE(h, e => { e.augmentWraith(e.entity(host)!, A); });  // a TOKEN mod
  h.state.players[A]!.bin.push('Skittering Blight');   // a real card: a bin never holds a token (R152)
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pickRef(h, { bin: { seat: A, card: 'Skittering Blight' } });
  resolveAll(h);
  assert.ok(!h.state.players[A]!.bin.includes('Wraith'),
    'a token mod has no card of its own, so no bin entry (R69)');
  assert.equal(trashes(h).filter(t => t.data!['card'] === 'Wraith').length, 0,
    'and therefore nothing to trash');
  assert.ok(new E(h.state).erased(A).includes('Wraith'),
    'it still has to be VISIBLE somewhere — the erased pile (R65)');
});

// R152, RULED by Bena on 2026-08-25 — the question R146 left open:
//
//   "For all intents and purposes a token is a normal thing that just ceases
//    to exist in all zones other than in play/stack whenever SBAs are checked."
//
// A TOKEN BODY therefore takes the same route a dying token takes: bin, trash,
// then the state-based sweep. Note what the ruling is ABOUT — a ZONE, not
// dying — which is why it settles an exchange without anyone having to decide
// whether "exchanged" counts as "died". The ORDER is the whole content of the
// answer ("a normal thing that CEASES TO EXIST", in that order), so the
// ordering assertion below is the one that matters; "not in the bin at the end"
// was already true under the pre-ruling code and proves nothing on its own.
test('R152 (ruled): a TOKEN BODY exchanged out of play bins → is trashed → is swept', () => {
  const h = new Harness(4298);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let host = -1;
  withE(h, e => {
    host = e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [3, 3] }).id;
  });
  giveResources(h, A, 'dark', 3);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
  h.state.players[A]!.bin.push('Skittering Blight');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pickRef(h, { bin: { seat: A, card: 'Skittering Blight' } });
  resolveAll(h);
  assert.equal(ent(h, host), undefined, 'the token host left play');
  assert.equal(trashes(h).filter(t => t.data!['card'] === 'Unit Token').length, 1,
    'it really was in the bin, so R40 trashed it there');
  assert.ok(!h.state.players[A]!.bin.includes('Unit Token'), 'and then ceased to exist there');
  assert.ok(new E(h.state).erased(A).includes('Unit Token'),
    'the sweep files it on the public erased pile (R65), as a death does');
  // THE ORDER IS THE RULING. "A normal thing that ceases to exist" is a bin
  // entry first and a removal second, not an absence from the start.
  const order = h.events
    .filter(ev => (ev.type === 'trashed' || ev.type === 'erased') && ev.data!['card'] === 'Unit Token')
    .map(ev => ev.type);
  assert.deepEqual(order, ['trashed', 'erased'], 'bin → trashed → swept, exactly as destroy()');
  // and its NONTOKEN mod takes the same full route (R152(2)), on a token host
  assert.equal(trashes(h).filter(t => t.data!['card'] === 'Hooba-Mon').length, 1,
    'the mod on it is binned and trashed too');
  assert.ok(new E(h.state).erased(A).includes('Hooba-Mon'),
    'and swept — a token host wearing a mod is Unstable by derivation');
});

// ⚠ THE ONE PLACE THE RULING AND R69 DO NOT MEET — read before "fixing" either.
//
// Bena's sentence is about TOKENS ("a token ... ceases to exist in all zones
// other than in play/stack"). Read literally it would send a token MOD through
// a bin as well. R69 says the opposite for mods — "a token mod has no card of
// its own" — and `E.leavePlay` and `E.destroy` both implement R69: nontoken
// mods bin, token mods never do and are announced straight onto the erased
// pile. That split is OLDER than this ruling and lives in engine.ts, which
// R152 did not touch.
//
// R152 therefore follows `destroy` on both halves, which keeps the exchange and
// the death giving the same answer — the whole point of the exercise — and
// leaves the token-body/token-mod difference exactly where it already was.
// It is REPORTED, not resolved here. The token-MOD test asserts R69; the
// token-BODY test asserts the ruling; both are above.
// They do not contradict each other about any single object; they differ about
// whether a token in a MOD slot is "a thing with a card". If that is ever
// ruled the other way, the token-MOD test above and `destroy`'s `binnedMods`
// filter move together, and this comment is the reason to look at both.

test('Hooba-Mon: an over-cost bin is no offer at all', () => {
  const h = new Harness(4214);
  toDeployment(h);
  const A = h.state.initiative;
  const hooba = spawn(h, A, 'Hooba-Mon');
  h.state.players[A]!.bin.push('Good Whale');              // [7]: too expensive
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hooba]] });
  resolveAll(h);
  assert.ok(ent(h, hooba), 'Hooba-Mon stays');
  assert.ok(h.log.some(l => l.includes('no unit with cost 3 or less')));
});

// ── Legion of the Depths ──────────────────────────────────────────────

test('Legion of the Depths: spawning creates two Wraiths and 2 rot', () => {
  const h = new Harness(4215);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Legion of the Depths');                     // 0/8
  const wights = entsNamed(h, 'Wraith').filter(e => e.kind === 'unit');
  assert.equal(wights.length, 2, 'two Wraiths — one card, the Wight token (R47)');
  assert.ok(wights.every(w => w.token && w.controller === P));
  assert.deepEqual(effStats(h, wights[0]!.id), [3, 3], 'a real 3/3 body each (R71)');
  assert.equal(rotOf(h, P), 2, 'and its controller pays 2 rot for them');
});

test("Legion of the Depths: attacking makes two more, in the BATTLE region it is attacking into (R115)", () => {
  const h = new Harness(4216);
  toDeployment(h);
  const A = h.state.initiative;
  const legion = spawn(h, A, 'Legion of the Depths');
  const before = entsNamed(h, 'Wraith').length;
  attackWith(h, A, [[legion]]);
  const made = entsNamed(h, 'Wraith').filter(e => e.kind === 'unit');
  assert.equal(made.length - before, 2, 'two more on the attack');
  const home = h.q.homeRegion(A);
  const battle = h.state.battle!.region;
  assert.notEqual(battle, home, 'the Legion is fighting away from home');
  assert.ok(made.slice(-2).every(w => w.region === battle),
    'R115: created units arrive where the SOURCE is — the battle region, not home');
  assert.equal(rotOf(h, A), 4, '2 rot on spawn + 2 more on the attack');
});

// ── Muck Rummager ─────────────────────────────────────────────────────

test('Muck Rummager: YOUR trash during battle draws you a card', () => {
  const h = new Harness(4217);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const muck = spawn(h, A, 'Muck Rummager');
  attackWith(h, A, [[atk, muck]]);                         // into the battle region
  const idxD = give(h, D, 'Unit Token');
  const handA0 = handSize(h, A);
  withE(h, e => { e.discardFromHand(D, idxD); });           // the OPPONENT's trash
  resolveAll(h);
  assert.equal(handSize(h, A), handA0, 'their trash is not "you trash a card"');
  const idxA = give(h, A, 'Unit Token');
  withE(h, e => { e.discardFromHand(A, idxA); });           // mine
  resolveAll(h);
  assert.equal(handSize(h, A), handA0 + 1,
    '+1 given, -1 discarded, +1 drawn — my own trash draws');
});

test('Muck Rummager: a trash outside battle draws nothing ("during battle")', () => {
  const h = new Harness(4218);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Muck Rummager');
  const idx = give(h, P, 'Unit Token');
  const hand = handSize(h, P);
  withE(h, e => { e.discardFromHand(P, idx); });
  assert.equal(handSize(h, P), hand - 1, 'discarded, nothing drawn');
});

// ── Necromantic Rebuke ────────────────────────────────────────────────

test('Necromantic Rebuke: negates unless its controller erases X from their bin', () => {
  const h = new Harness(4219);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'dark', 2);                          // dd/2
  giveResources(h, D, 'fire', 2);
  give(h, A, 'Necromantic Rebuke');
  give(h, D, 'Flame of History');                          // r/1 "deal 1 damage to any target"
  h.state.players[A]!.bin.push('Unit Token', 'Unit Token');
  attackWith(h, A, [[atk, victim]]);
  pass(h);                                                 // hand D the window
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Flame of History') });
  pickRef(h, { unit: victim });
  // R64: the bracketed cost is paid AT CAST — two cards out of MY bin, X = 2,
  // fixed before the spell is on the stack.
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Necromantic Rebuke') });
  pickRef(h, { erase: 'Unit Token' });
  pickRef(h, { erase: 'Unit Token' });                     // the bin is empty → X = 2, closed
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Unit Token').length, 0,
    'the cost was paid as it was cast — erased, never trashed');
  const dec = h.state.decision!;
  h.do({ type: 'decide', seat: dec.seat, choice: dec.options.findIndex(o => o.label.includes('Flame')) });
  resolveAll(h);
  assert.equal(trashes(h).length, 0, 'erasing never touches a bin (R40)');
  assert.equal(ent(h, victim)!.damage, 0, 'D had nothing to erase, so the Flame was negated');
  assert.ok(h.log.some(l => l.includes('is negated')));
});

test('Necromantic Rebuke: the ransom saves the effect', () => {
  const h = new Harness(4220);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'dark', 2);
  giveResources(h, D, 'fire', 2);
  give(h, A, 'Necromantic Rebuke');
  give(h, D, 'Flame of History');
  h.state.players[A]!.bin.push('Unit Token');
  h.state.players[D]!.bin.push('Good Whale');
  attackWith(h, A, [[atk, victim]]);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Flame of History') });
  pickRef(h, { unit: victim });
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Necromantic Rebuke') });
  pickRef(h, { erase: 'Unit Token' });                     // X = 1, paid at cast
  const dec = h.state.decision!;
  h.do({ type: 'decide', seat: dec.seat, choice: dec.options.findIndex(o => o.label.includes('Flame')) });
  resolveAll(h, o => o.label === 'erase 1');               // D pays the ransom
  assert.equal(h.state.players[D]!.bin.filter(c => c === 'Good Whale').length, 0,
    'the targeted effect\'s controller paid the ransom');
  assert.ok(ent(h, victim)!.damage > 0, 'and the Flame survived to resolve');
});

// R74 (Bena, 2026-08-22, having checked the physical card). The printed line
// is exactly what is encoded — "[Erase X cards from your bin]: Negate up to one
// target effect unless its controller erases X cards from their bin" — so the
// MECHANICS are correct and untouched. What was missing is that X = 0 is a
// guaranteed no-op: the ransom "erase 0 cards" is met by doing nothing, so the
// negate can never happen. It stays LEGAL (explicitly not made illegal, unlike
// No Hand Killer's xMin: 1, which prevents burning a [once] budget) — the
// player is simply told, at the one moment they can still change their mind.
test('Necromantic Rebuke: stopping at X = 0 is offered WITH a warning, and stays legal (R74)', () => {
  const h = new Harness(4221.5);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'dark', 2);
  giveResources(h, D, 'fire', 2);
  give(h, A, 'Necromantic Rebuke');
  give(h, D, 'Flame of History');
  h.state.players[A]!.bin.push('Unit Token');              // something to erase, so a real choice
  attackWith(h, A, [[atk, victim]]);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Flame of History') });
  pickRef(h, { unit: victim });
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Necromantic Rebuke') });
  const dec = h.state.decision!;
  const stop = dec.options.find(o => o.label.startsWith("That's enough"));
  assert.ok(stop, 'the "that\'s enough" stop is on the table at X = 0');
  assert.ok(stop!.warning, 'and it carries a machine-readable warning the client can style');
  assert.ok(stop!.label.includes(stop!.warning!),
    'the warning is also in the label, so a client that ignores the field still shows it');
  assert.ok(/negates nothing/.test(stop!.warning!));
  // it is a warning, NOT a prohibition: taking it works and the cast completes
  h.do({ type: 'decide', seat: dec.seat, choice: dec.options.indexOf(stop!) });
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Unit Token').length, 1,
    'nothing was erased — X really is 0');
  const dec2 = h.state.decision!;
  h.do({ type: 'decide', seat: dec2.seat, choice: dec2.options.findIndex(o => o.label.includes('Flame')) });
  resolveAll(h);
  assert.ok(ent(h, victim)!.damage > 0, 'and, as warned, the Flame was not negated');
});

test('R74: the warning is only on X = 0 — a nonzero stop is an ordinary option', () => {
  const h = new Harness(4221.6);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'dark', 2);
  giveResources(h, D, 'fire', 2);
  give(h, A, 'Necromantic Rebuke');
  give(h, D, 'Flame of History');
  h.state.players[A]!.bin.push('Unit Token', 'Unit Token');
  attackWith(h, A, [[atk, victim]]);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Flame of History') });
  pickRef(h, { unit: victim });
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Necromantic Rebuke') });
  pickRef(h, { erase: 'Unit Token' });                     // X = 1 so far
  const stop = h.state.decision!.options.find(o => o.label.startsWith("That's enough"))!;
  assert.equal(stop.warning, undefined, 'X = 1 negates for real — nothing to warn about');
  assert.ok(!stop.label.includes('⚠'));
});

// The ransom's WHICH: "erases X cards from THEIR bin" — once the payer agrees
// to pay, which X cards leave is the payer's pick (eraseChosenFromBin), by bin
// index with the names visible. It used to take the most recently binned
// cards unasked — the engine deciding for the player.
test('Necromantic Rebuke: the payer PICKS which cards the ransom erases — the unpicked survive', () => {
  const h = new Harness(4235);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'dark', 2);
  giveResources(h, D, 'fire', 2);
  give(h, A, 'Necromantic Rebuke');
  give(h, D, 'Flame of History');
  h.state.players[A]!.bin.push('Unit Token');
  h.state.players[D]!.bin.push('Good Whale', 'Rotling');   // 2 > X = 1 → a real pick
  attackWith(h, A, [[atk, victim]]);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Flame of History') });
  pickRef(h, { unit: victim });
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Necromantic Rebuke') });
  pickRef(h, { erase: 'Unit Token' });                     // X = 1, paid at cast
  const tgt = h.state.decision!;
  h.do({ type: 'decide', seat: tgt.seat, choice: tgt.options.findIndex(o => o.label.includes('Flame')) });
  pass(h); pass(h);                                        // resolve the Rebuke → the ransom
  const pay = h.state.decision!;
  assert.equal(pay.seat, D, 'the pay-or-decline goes to the payer');
  h.do({ type: 'decide', seat: D, choice: pay.options.findIndex(o => o.label === 'erase 1') });
  const pickDec = h.state.decision!;
  assert.equal(pickDec.seat, D, 'and so does the WHICH pick — the payer chooses, not the engine');
  assert.deepEqual(pickDec.options.map(o => o.label), ['Good Whale', 'Rotling'], 'picked by bin index, names visible');
  assert.ok(pickDec.options.every(o => o.card), 'each option carries the card for the client to render');
  h.do({ type: 'decide', seat: D, choice: pickDec.options.findIndex(o => o.label === 'Rotling') });
  assert.deepEqual(h.state.players[D]!.bin, ['Good Whale'],
    'the UNPICKED card survives — the old code would have eaten the most recent (Rotling was, but by CHOICE now)');
  assert.ok(h.state.players[D]!.erased?.includes('Rotling'), 'the picked card reaches the erased pile (R65)');
  resolveAll(h);
  assert.ok(ent(h, victim)!.damage > 0, 'the ransom was paid → the Flame survived to resolve');
});

test('Necromantic Rebuke: a bin of exactly X is a FORCED set — everything goes, no pick prompt', () => {
  const h = new Harness(4236);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'dark', 2);
  giveResources(h, D, 'fire', 2);
  give(h, A, 'Necromantic Rebuke');
  give(h, D, 'Flame of History');
  h.state.players[A]!.bin.push('Unit Token', 'Unit Token');
  h.state.players[D]!.bin.push('Good Whale', 'Rotling');   // exactly X = 2
  attackWith(h, A, [[atk, victim]]);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Flame of History') });
  pickRef(h, { unit: victim });
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Necromantic Rebuke') });
  pickRef(h, { erase: 'Unit Token' });
  pickRef(h, { erase: 'Unit Token' });                     // the bin empties → X = 2, closed
  const tgt = h.state.decision!;
  h.do({ type: 'decide', seat: tgt.seat, choice: tgt.options.findIndex(o => o.label.includes('Flame')) });
  pass(h); pass(h);                                        // resolve the Rebuke → the ransom
  const pay = h.state.decision!;
  h.do({ type: 'decide', seat: pay.seat, choice: pay.options.findIndex(o => o.label === 'erase 2') });
  // a zero-choice erase asks nothing: no WHICH prompt for a forced total set
  assert.ok(!h.state.decision, 'no pick prompt when the whole bin must go');
  assert.deepEqual(h.state.players[D]!.bin, [], 'everything went');
  assert.deepEqual(h.state.players[D]!.erased, ['Good Whale', 'Rotling'], 'both to the erased pile (R65)');
  resolveAll(h);
  assert.ok(ent(h, victim)!.damage > 0, 'and the Flame survived');
});

test('Necromantic Rebuke: DECLINING the ransom is unchanged — negated, bin untouched', () => {
  const h = new Harness(4237);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'dark', 2);
  giveResources(h, D, 'fire', 2);
  give(h, A, 'Necromantic Rebuke');
  give(h, D, 'Flame of History');
  h.state.players[A]!.bin.push('Unit Token');
  h.state.players[D]!.bin.push('Good Whale', 'Rotling');   // could pay, chooses not to
  attackWith(h, A, [[atk, victim]]);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Flame of History') });
  pickRef(h, { unit: victim });
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Necromantic Rebuke') });
  pickRef(h, { erase: 'Unit Token' });                     // X = 1
  const tgt = h.state.decision!;
  h.do({ type: 'decide', seat: tgt.seat, choice: tgt.options.findIndex(o => o.label.includes('Flame')) });
  resolveAll(h, o => o.label === 'let it be negated');
  // the negated Flame's own card is binned by R68's disposal — the ransom
  // itself touched nothing
  assert.deepEqual(h.state.players[D]!.bin, ['Good Whale', 'Rotling', 'Flame of History'],
    'declining erases nothing — only the negated spell itself arrives');
  assert.ok(!h.state.players[D]!.erased?.length, 'nothing reached the erased pile');
  assert.equal(ent(h, victim)!.damage, 0, 'the Flame was negated');
  assert.ok(h.log.some(l => l.includes('is negated')));
});

test('Necromantic Rebuke: the ransom pick survives a JSON round-trip mid-decision (R85)', () => {
  const h = new Harness(4238);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'dark', 2);
  giveResources(h, D, 'fire', 2);
  give(h, A, 'Necromantic Rebuke');
  give(h, D, 'Flame of History');
  h.state.players[A]!.bin.push('Unit Token', 'Unit Token');
  h.state.players[D]!.bin.push('Good Whale', 'Rotling', 'Palewing');   // 3 > X = 2
  attackWith(h, A, [[atk, victim]]);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Flame of History') });
  pickRef(h, { unit: victim });
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Necromantic Rebuke') });
  pickRef(h, { erase: 'Unit Token' });
  pickRef(h, { erase: 'Unit Token' });                     // X = 2
  const tgt = h.state.decision!;
  h.do({ type: 'decide', seat: tgt.seat, choice: tgt.options.findIndex(o => o.label.includes('Flame')) });
  pass(h); pass(h);
  const pay = h.state.decision!;
  h.do({ type: 'decide', seat: pay.seat, choice: pay.options.findIndex(o => o.label === 'erase 2') });
  h.state = JSON.parse(JSON.stringify(h.state));           // save + load mid-pick (1 of 2)
  const p1 = h.state.decision!;
  h.do({ type: 'decide', seat: D, choice: p1.options.findIndex(o => o.label === 'Rotling') });
  h.state = JSON.parse(JSON.stringify(h.state));           // save + load mid-pick (2 of 2)
  const p2 = h.state.decision!;
  h.do({ type: 'decide', seat: D, choice: p2.options.findIndex(o => o.label === 'Palewing') });
  assert.deepEqual(h.state.players[D]!.bin, ['Good Whale'], 'the loaded state still erases exactly the picked two');
  assert.deepEqual(h.state.players[D]!.erased, ['Rotling', 'Palewing'], 'in pick order, to the erased pile');
  resolveAll(h);
  assert.ok(ent(h, victim)!.damage > 0, 'and the Flame survived');
});

// ── Palewing ──────────────────────────────────────────────────────────

test('Palewing: attacking discards a card (feeding the trash deck)', () => {
  const h = new Harness(4221);
  toDeployment(h);
  const A = h.state.initiative;
  const pw = spawn(h, A, 'Palewing');                      // 3/4 {Flying}
  toNextBattle(h, A);
  give(h, A, 'Good Whale');
  const hand = handSize(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[pw]] });
  resolveAll(h, o => o.label === 'Good Whale');
  assert.equal(handSize(h, A), hand - 1);
  assert.ok(h.state.players[A]!.bin.includes('Good Whale'), 'the chosen card was pitched');
  assert.equal(trashes(h).length, 1, 'and it is a trash (R40)');
});

test('Palewing: blocking discards too, and [Switch1] bounds it to once a turn', () => {
  const h = new Harness(4222);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const pw = spawn(h, D, 'Palewing');
  attackWith(h, A, [[atk]]);
  const hand = handSize(h, D);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [pw] } });
  resolveAll(h);
  assert.equal(handSize(h, D), hand - 1, 'blocking discarded one');
  assert.equal(trashes(h).length, 1, 'exactly one — [Switch1] is once per turn (R9)');
});

// ── Plague Ritual ─────────────────────────────────────────────────────

test('Plague Ritual: each player discards, gains a rot and gets a Wraith augment', () => {
  const h = new Harness(4223);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');                   // A's only unit in the region
  const host = spawn(h, D, 'Good Whale');                  // D's only unit in the region
  giveResources(h, A, 'dark', 2);                          // dd/1
  give(h, A, 'Plague Ritual');
  attackWith(h, A, [[atk]]);
  const handA = handSize(h, A), handD = handSize(h, D);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Plague Ritual') });
  resolveAll(h);
  assert.equal(rotOf(h, A), 1, 'each player gains a rot');
  assert.equal(rotOf(h, D), 1);
  assert.equal(handSize(h, A), handA - 2, 'the spell itself plus the discard');
  assert.equal(handSize(h, D), handD - 1, 'and D pitched one too');
  assert.equal(modsOn(h, atk).filter(m => m.card === 'Wraith').length, 1,
    "A's unit carries a Wraith augment");
  assert.equal(modsOn(h, host).filter(m => m.card === 'Wraith').length, 1, "and so does D's");
  assert.equal(modsOn(h, atk)[0]!.token, true, 'the augment is the same token (R47)');
});

// ── Rotbeast ──────────────────────────────────────────────────────────

test("Rotbeast: after combat it dumps its host's other augments onto an enemy", () => {
  const h = new Harness(4224);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const host = spawn(h, A, 'Good Whale');
  const enemy = spawn(h, D, 'Legion of the Depths');       // 0/8: survives the whale
  withE(h, e => {
    e.attachMod(e.entity(host)!, 'Rotbeast', A, 'augment');
    e.augmentWraith(e.entity(host)!, A);                    // the augment to be dumped
  });
  assert.equal(modsOn(h, host).length, 2);
  attackWith(h, A, [[host]]);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [enemy] } });
  resolveAll(h);
  pass(h); pass(h);                                        // combat damage → after combat
  resolveAll(h);
  assert.deepEqual(modsOn(h, host).map(m => m.card), ['Rotbeast'],
    'only the Rotbeast text itself stays — "my OTHER Augments"');
  assert.deepEqual(modsOn(h, enemy).map(m => m.card), ['Wraith'], 'the rest moved to the enemy');
  assert.equal(modsOn(h, enemy)[0]!.modOf, enemy, 'and are really re-parented');
});

test('Rotbeast: with no enemy in the region nothing moves', () => {
  const h = new Harness(4225);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const host = spawn(h, A, 'Good Whale');
  withE(h, e => {
    e.attachMod(e.entity(host)!, 'Rotbeast', A, 'augment');
    e.augmentWraith(e.entity(host)!, A);
  });
  attackWith(h, A, [[host]]);
  throughCombat(h, D);
  assert.equal(modsOn(h, host).length, 2, 'both augments stayed put');
  assert.ok(h.log.some(l => l.includes('no enemy to move my augments onto')));
});

// ── Sarcophage ────────────────────────────────────────────────────────

test('Sarcophage: a unit that connects with a player loses all its counters', () => {
  const h = new Harness(4226);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');                   // 7/5
  const sarco = spawn(h, D, 'Sarcophage');                 // in D's region, watching
  withE(h, e => { e.addCounters(e.entity(atk)!, 3); });
  assert.deepEqual(effStats(h, atk), [10, 8], 'three +1/+1 counters');
  attackWith(h, A, [[atk]]);
  throughCombat(h, D);
  assert.equal(ent(h, atk)!.counters, 0, 'the face hit stripped every counter');
  assert.deepEqual(effStats(h, atk), [7, 5], 'back to its printed body');
  assert.ok(ent(h, sarco), 'Sarcophage itself is untouched');
});

test('Sarcophage: a blocked column never connects, so its counters survive', () => {
  const h = new Harness(4227);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');                   // 1/1 + 3 counters = 4/4
  spawn(h, D, 'Sarcophage');
  let wall = 0;
  withE(h, e => {
    e.addCounters(e.entity(atk)!, 3);
    wall = e.spawnUnit(D, 'Unit Token', e.homeRegion(D), { token: true, tokenStats: [0, 20] }).id;
  });
  attackWith(h, A, [[atk]]);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [wall] } });
  resolveAll(h);
  pass(h); pass(h);
  resolveAll(h);
  assert.ok(ent(h, atk), 'the attacker survived the block');
  assert.equal(ent(h, atk)!.counters, 3, 'no player took combat damage — nothing is stripped');
});

// ── Skittering Blight ─────────────────────────────────────────────────

test('Skittering Blight: it hands you a rot on arrival…', () => {
  const h = new Harness(4228);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Skittering Blight');
  assert.equal(rotOf(h, P), 1, '"when I spawn, gain a rot"');
});

test('…and then eats the rot damage as +1/+1 counters (R38 replacement)', () => {
  const h = new Harness(4229);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const sb = spawn(h, P, 'Skittering Blight');             // spawn → 1 rot
  withE(h, e => { e.gainRot(P, 2); });                     // 3 total
  const life = h.state.players[P]!.life;
  intoNextDeployment(h, P);
  assert.equal(h.state.phase, 'deploy');
  assert.equal(h.state.players[P]!.life, life, 'no life lost — the damage was replaced');
  assert.equal(ent(h, sb)!.counters, 3, 'that many +1/+1 counters instead');
  assert.deepEqual(effStats(h, sb), [4, 4], 'a 1/1 that grows on your own decay');
  assert.equal(rotOf(h, P), 3, 'replacing the damage does not spend the rot');
});

test('Skittering Blight: the replacement rides along when it AUGMENTS a host', () => {
  const h = new Harness(4230);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'Good Whale');
  withE(h, e => {
    e.attachMod(e.entity(host)!, 'Skittering Blight', P, 'augment');
    e.gainRot(P, 2);
  });
  const life = h.state.players[P]!.life;
  intoNextDeployment(h, P);
  assert.equal(h.state.players[P]!.life, life, 'the donated hook still replaces');
  assert.equal(ent(h, host)!.counters, 2, 'and "counters on me" lands on the HOST');
});

// ── Thought Extraction ────────────────────────────────────────────────

test('Thought Extraction: strip a card from a hand you can see, at the cost of a rot', () => {
  const h = new Harness(4231);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'dark', 2);                          // dd/1
  give(h, A, 'Thought Extraction');
  attackWith(h, A, [[atk]]);
  give(h, D, 'Good Whale');
  const handD = handSize(h, D);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Thought Extraction') });
  pickRef(h, { player: D });
  resolveAll(h, o => o.label === 'Good Whale');
  assert.equal(handSize(h, D), handD - 1, 'a card was taken out of their hand');
  assert.ok(h.state.players[D]!.bin.includes('Good Whale'), 'into their bin');
  assert.equal(trashes(h).filter(t => t.data!['seat'] === D).length, 1, 'which trashes it (R40)');
  assert.equal(rotOf(h, A), 1, 'and you take the rot');
  // R203 / CT-84: this line used to read `h.log`, and `h.log` is the seatless
  // hotseat firehose — so it said nothing about WHO was shown the hand and
  // passed identically before and after R197b stopped the card publishing the
  // whole hand to the table. `logFor(h, seat)` is the log server/view.ts
  // actually serves that seat, so the claim is now falsifiable in both
  // directions: drop the `{ privateTo: ctx.controller }` in batch-dark-b and
  // the second assertion reddens here, in the card's own test file.
  assert.ok(logFor(h, A).some(l => l.includes('Thought Extraction reveals')),
    'the LOOKER was shown the hand — a look still tells the looker');
  assert.deepEqual(logFor(h, D).filter(l => l.includes('Thought Extraction reveals')), [],
    'and nobody else was: "look at" is a private look, not a reveal to the table (R197b)');
});

// ── Umbral Decay ──────────────────────────────────────────────────────

test('Umbral Decay: two -1/-1 counters, and {Afflicting} rots the owner of what it kills', () => {
  const h = new Harness(4232);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Unit Token');                // 1/1: two counters kill it
  giveResources(h, A, 'dark', 1);                          // d/1
  give(h, A, 'Umbral Decay');
  attackWith(h, A, [[atk]]);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Umbral Decay') });
  pickRef(h, { unit: victim });
  resolveAll(h);
  assert.equal(ent(h, victim), undefined, 'killed purely by counters');
  assert.equal(rotOf(h, D), 1, 'R48: Afflicting fires on -1/-1 counter kills');
  assert.equal(rotOf(h, A), 0);
  assert.ok(getCard('Umbral Decay').attrs.includes('Afflicting'),
    'the attribute is printed data — nothing is hand-coded for it');
});

test('Umbral Decay: a survivor just shrinks, and nobody gains a rot', () => {
  const h = new Harness(4233);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const big = spawn(h, D, 'Good Whale');                   // 7/5
  giveResources(h, A, 'dark', 1);
  give(h, A, 'Umbral Decay');
  attackWith(h, A, [[atk]]);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Umbral Decay') });
  pickRef(h, { unit: big });
  resolveAll(h);
  assert.deepEqual(effStats(h, big), [5, 3], 'two net -1/-1 counters');
  assert.equal(rotOf(h, D), 0, 'nothing died, so nothing is afflicted');
});

// ── Writhing Host (R123: a bin-anchored haste grant, erase-funded) ────

test('Writhing Host: registers as a plain 3/1 body and plays crash-free', () => {
  const h = new Harness(4234);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 1);                          // d/1
  const idx = give(h, P, 'Writhing Host');
  assert.ok(h.legal(P).some(a => a.type === 'playCard' && a.handIndex === idx));
  h.do({ type: 'playCard', seat: P, handIndex: idx });
  const u = Object.values(h.state.entities).find(e => e.card === 'Writhing Host')!;
  assert.deepEqual(effStats(h, u.id), [3, 1]);
});

/** planning, turn 1: seat 0 holds a deploy-timing unit (a second Writhing
 * Host — d/1, so one dark resource pays it) and `bins` says whose bin gets a
 * Host. Both seats then finish planning, which is where startHasteStep
 * decides whether the haste step engages at all (report #74's fatal gate). */
function hostSetup(seed: number, bins: Seat[]): { h: Harness; P: Seat; idx: number } {
  const h = new Harness(seed);
  const P = 0 as Seat;
  giveResources(h, P, 'dark', 1);
  for (const s of bins) h.state.players[s]!.bin.push('Writhing Host');
  const idx = give(h, P, 'Writhing Host');   // the PLAYED unit, deploy timing
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  return { h, P, idx };
}

/** the R123 offer: a haste-step play of the hand unit, funded by the erase */
const eraseOffer = (h: Harness, P: Seat, idx: number): Action | undefined =>
  h.legal(P).find(a => a.type === 'playCard' && a.handIndex === idx && a.eraseGrant === true);

test('Writhing Host (R123): a deploy unit in hand is offered at haste timing, and playing it erases the Host from the bin', () => {
  const { h, P, idx } = hostSetup(4235, [0]);
  assert.ok(h.state.hasteDone, 'the haste step engages off the bin grant alone');
  const offer = eraseOffer(h, P, idx);
  assert.ok(offer, 'the play is offered with the erase cost attached');
  h.do(offer!);
  const u = unitsOf(h, P).find(e => e.card === 'Writhing Host');
  assert.ok(u, 'the unit is in play (haste plays resolve immediately)');
  assert.equal(h.state.players[P]!.bin.length, 0, 'the grantor left the bin');
  assert.deepEqual(h.state.players[P]!.erased, ['Writhing Host'], '…for the ERASED pile, not another zone');
  assert.ok(h.log.some(l => l.includes('is erased from') && l.includes('as if it had [Haste]')),
    'the log announces the cost and the grant in one line');
  assert.ok(!ownAttrs(h, u!.id).has('Haste'),
    '"as if it had [Haste]" is timing only — the unit never carries the attribute');
});

test('Writhing Host (R123): with no copy in the bin the offer is absent', () => {
  const { h, P, idx } = hostSetup(4236, []);
  if (h.state.hasteDone) {   // a random hand may open the step on its own
    assert.ok(!eraseOffer(h, P, idx), 'no erase-funded play is offered');
    skipHasteStep(h);
  }
  assert.equal(h.state.players[P]!.hand[idx], 'Writhing Host', 'the unit stayed in hand');
});

test('Writhing Host (R123): declining the offered play leaves bin and hand untouched', () => {
  const { h, P, idx } = hostSetup(4237, [0]);
  assert.ok(eraseOffer(h, P, idx), 'the offer is up');
  h.do({ type: 'doneHaste', seat: P });   // declined: the offer is simply not taken
  assert.equal(h.state.players[P]!.bin.filter(n => n === 'Writhing Host').length, 1, 'the bin copy is untouched');
  assert.equal(h.state.players[P]!.hand[idx], 'Writhing Host', 'the hand unit is untouched');
  assert.equal((h.state.players[P]!.erased ?? []).length, 0, 'nothing was erased');
});

test("Writhing Host (R123): an opponent's bin copy grants you nothing — the printed \"your bin\" is per-seat", () => {
  const { h, P, idx } = hostSetup(4238, [1]);
  if (h.state.hasteDone) {
    assert.ok(!eraseOffer(h, P, idx), "the opponent's grantor funds no play of yours");
    skipHasteStep(h);
  }
  assert.equal(h.state.players[1]!.bin.filter(n => n === 'Writhing Host').length, 1,
    "the opponent's copy sits untouched");
});

test('Writhing Host (R123): a JSON round trip mid-offer still drives, and two bin copies are fungible — one pays, one stays', () => {
  const { h, P, idx } = hostSetup(4239, [0, 0]);
  const offer = eraseOffer(h, P, idx);
  assert.ok(offer, 'offered');
  // the wire trip: the action carries a flag, not a bin index — apply re-finds
  // the grantor through the same predicate the offer used, so nothing stale or
  // unserializable rides on it
  h.state = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
  h.do(JSON.parse(JSON.stringify(offer)) as Action);
  assert.ok(unitsOf(h, P).some(e => e.card === 'Writhing Host'), 'the reloaded game played it');
  // two identical grantors: the engine erases the first. An arbitrary pick
  // between FUNGIBLE copies (same name, same effect, same erased pile) is not
  // deciding for the player — a second DISTINCT grantor card would make the
  // choice visible and need an index on the action; none exists.
  assert.equal(h.state.players[P]!.bin.filter(n => n === 'Writhing Host').length, 1, 'exactly one grantor paid');
  assert.deepEqual(h.state.players[P]!.erased, ['Writhing Host']);
});

test("Writhing Host (R123/R124): the grantor leaves through the R124 choke point — 'leftBin' reason 'erased', erased pile exactly once", () => {
  // the grantor used to be spliced out of the bin DIRECTLY (CARD-TODO #26),
  // so its exit fired no 'leftBin'. It goes through E.removeFromBin now; the
  // site's own 'erased' announce is still the only thing feeding the R65
  // public pile, so the card must land there EXACTLY once, not twice.
  const { h, P, idx } = hostSetup(4240, [0]);
  const offer = eraseOffer(h, P, idx);
  assert.ok(offer, 'the erase-funded play is offered');
  h.do(offer!);
  const left = h.events.filter(ev => ev.type === 'leftBin');
  assert.equal(left.length, 1, "the grantor's exit fired exactly ONE 'leftBin'");
  assert.deepEqual(left[0]!.data, { seat: P, card: 'Writhing Host', reason: 'erased' },
    'through E.removeFromBin, with the erase reason verb');
  assert.deepEqual(h.state.players[P]!.erased, ['Writhing Host'],
    "in the R65 pile exactly once — 'leftBin' itself must not double the announce's push");
});

// ── registration sweep ────────────────────────────────────────────────

test('every dark-b card is registered with its printed data', () => {
  const names = [
    'Blightmound', 'Cerebrox', 'Cthyrian Culler', 'Dropslime', 'Fester',
    'Grim Bargain', 'Hooba-Mon', 'Legion of the Depths', 'Muck Rummager',
    'Necromantic Rebuke', 'Palewing', 'Plague Ritual', 'Rotbeast', 'Sarcophage',
    'Skittering Blight', 'Thought Extraction', 'Umbral Decay', 'Writhing Host',
  ];
  for (const n of names) {
    const c = getCard(n);
    assert.equal(c.name, n);
    assert.ok(c.factions?.includes('dark'), `${n} is a dark card`);
  }
  assert.equal(getCard('Grim Bargain').mana, 'X', 'the X cost comes from printed.json');
  assert.deepEqual(getCard('Dropslime').discardMe, { cost: '', mana: 1 },
    'and so does the discard-me cost line');
  assert.ok(getCard('Blightmound').attrs.includes('Poisonous'));
  assert.ok(getCard('Palewing').attrs.includes('Flying'));
  assert.ok(getCard('Umbral Decay').attrs.includes('Afflicting'));
});
