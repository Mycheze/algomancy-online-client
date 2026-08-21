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
 * Writhing Host is PARKED with a todo test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import {
  effStats, ent, give, giveResources, handIdx, pass, spawn, toDeployment, toNextBattle,
} from './util.ts';
import type { DecisionOption, EngineEvent, Entity, EntityId, Seat } from '../src/types.ts';

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
  assert.equal(h.state.stack.length, 1, 'the attack trigger uses the stack (battle timing)');
  resolveAll(h, o => o.label === 'Unit Token');
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
  assert.deepEqual(effStats(h, wights[0]!.id), [4, 4], 'a real 4/4 body each');
  assert.equal(rotOf(h, P), 2, 'and its controller pays 2 rot for them');
});

test("Legion of the Depths: attacking makes two more, in its controller's HOME region (R28)", () => {
  const h = new Harness(4216);
  toDeployment(h);
  const A = h.state.initiative;
  const legion = spawn(h, A, 'Legion of the Depths');
  const before = entsNamed(h, 'Wraith').length;
  attackWith(h, A, [[legion]]);
  const made = entsNamed(h, 'Wraith').filter(e => e.kind === 'unit');
  assert.equal(made.length - before, 2, 'two more on the attack');
  const home = h.q.homeRegion(A);
  assert.ok(made.slice(-2).every(w => w.region === home),
    'created units arrive home, not in the battle region');
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
  assert.ok(h.log.some(l => l.includes('Thought Extraction reveals')), 'the hand was revealed');
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

// ── Writhing Host (PARKED) ────────────────────────────────────────────

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

test('Writhing Host: "play a unit as if it had [Haste] by erasing me from your bin" is PARKED — '
  + 'granting haste timing to ANOTHER card and adding a cost to its play action both live in '
  + "apply.ts/legalActions, out of card code's reach", { todo: true }, () => {
  // The same missing machinery that parks Dispatch Courier's "play a unit
  // during the mana step as if it had [Haste]", plus a bin-sourced additional
  // cost on a DIFFERENT card's play action.
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
