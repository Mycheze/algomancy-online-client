/**
 * A LOOP THAT COMMITS A COLLECTED LIST, WHEN THE LIST COMES BACK EMPTY —
 * CARD-TODO #74 and #81(b) / R209.
 *
 * ── THE CLASS, AND THE DEFINITION THIS FILE IS SWEPT AGAINST
 *
 * CT-70 repaired "each opponent" over a region holding nobody else: the loop
 * ran ZERO TIMES because no seat qualified. CT-74 was spun off for a second
 * cause: an opponent IS present, and every present seat has NOTHING TO GIVE,
 * so the collection comes back empty, the run completes and emits nothing.
 *
 * ⚠ THE TICKETS' TWO SHAPES ARE ONE CLASS, AND THIS FILE SWEEPS THE CLASS.
 * CT-74's wording is "collect into a list, commit the list, no else-branch";
 * CT-81(b)'s two cards (Dragnol, Shoreline Specter) are a bare
 * `for (const seat of opponentsIn(…))` with NO ACCUMULATOR AT ALL. Reading the
 * ticket by its code shape gives 7, 9 or 10 members depending on which clause
 * of the sentence you weight, and every one of those readings leaves the other
 * shape orphaned on no ticket — which is precisely the "one-card fix for a
 * whole class" failure docs/13-assessment.md §4 says keeps recurring. So the
 * definition here is the PLAYER-FACING one:
 *
 *     a clause that promises a per-seat outcome, resolves over an empty
 *     collection — of seats, or of picks — and emits nothing FOR THAT CLAUSE.
 *
 * Whether the collection is empty because no seat qualified (CT-70's cause) or
 * because every qualifying seat had nothing to give (CT-74's cause) changes the
 * WORDING of the announcement and nothing else. Whether there is an accumulator
 * is an implementation detail: `Perish` has none either — it sacrifices as it
 * goes — and is unambiguously a member. Under that definition the pool holds
 * **twelve repair sites over fifteen conformance labels**, and all twelve are
 * below.
 *
 * ── WHY NO SWEEP SAW ANY OF THEM, AND THE TWO SEPARATE BLINDNESSES
 *
 * 1. `65-effect-conformance` drives every EffectDef in the registry and fails
 *    a run that emits nothing. It reported this whole family clean because of a
 *    property of its RIG that nobody had written down: **both of its board
 *    states gave every present seat a unit.** The empty-collection branch was
 *    not rare there, it was UNREACHABLE. R209 adds a third board — `barren`,
 *    both seats present in a battle region that every unit has left — and it
 *    convicted six labels on its first run, one of which (`Perish`) was on no
 *    ticket and in no report. Eight of the twelve below are caught by it now.
 *
 * 2. The other four are HALF-SILENT and 65 is blind to them BY CONSTRUCTION,
 *    which is CT-81(b)'s finding: 65 convicts only a run that emits nothing AT
 *    ALL, so an effect whose empty clause says nothing while its OTHER half
 *    speaks can never be seen there, no matter what board it is driven on.
 *    `Recall` recalls nobody but always takes the 2 life; `Shoreline Specter`
 *    announces its recall while the life loss it PROMISED IN ITS OWN PROMPT
 *    ("each opponent loses 2 life") silently does not happen. Those four are
 *    watched here and nowhere else, and §13 pins that claim.
 *
 * ⚠ THE LOOP IS NOT THE BUG, exactly as in 158. Nobody here was made to reach
 * a seat that is not there or take a unit that does not exist; "nothing
 * happened" is a legitimate outcome. Not SAYING so is the bug, and every test
 * below asserts BOTH — that the player was told, and that the board did not
 * move.
 *
 * WHAT EACH TEST ASSERTS, IN ORDER (the 158 house shape)
 *   1. the PRECONDITION — the collection really is empty for the reason the
 *      test names, so it is aimed at the situation it claims to be aimed at;
 *   2. there was really something at stake elsewhere, so a silent pass is not
 *      silence about a board that was empty anyway;
 *   3. the clause SPOKE — see `assertClauseSpoke` for how a half-silent card's
 *      clause is distinguished from its speaking half WITHOUT greping prose;
 *   4. and the guard really was a guard: the board did not move.
 *
 * NEVER THE PROSE. A test that greps a sentence gets deleted the first time
 * somebody improves the sentence, and then the branch is unguarded again — the
 * standing rule from 85-silent-branches and 158. The CARD and its PRINTED
 * CLAUSE are named in every assertion message instead.
 *
 * Seeds: fixed per test, as in 158.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { getCard, type EffectCtx, type EffectDef } from '../src/cards/dsl.ts';
import { effectsOf } from '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import { giveResources, spawn, toDeployment, toNextBattle } from './util.ts';
import type { CardName, EngineEvent, EntityId, GameState, Seat } from '../src/types.ts';

// ── the two boards ──────────────────────────────────────────────────────

interface Board { g: E; A: Seat; D: Seat; region: number }

/**
 * BARREN — an attack was declared, so BOTH seats are present in the battle
 * region, and then every unit in it left.
 *
 * This is the situation CT-74 is about and it is entirely ordinary: an attack
 * where every column traded off, or a mass recall, leaves exactly this.
 * `presentSeats` is written at declaration and is NOT recomputed when the last
 * body goes, which is why "each player" clauses still enumerate two seats over
 * an empty region in a real game rather than falling back to CT-70's case.
 *
 * Built by walking a real Harness to a real declared attack and then removing
 * the region's entities — the same construction `65-effect-conformance`'s
 * third board uses, so the two nets are aimed at the same board.
 */
function barren(seed: number): Board {
  const h = new Harness(seed);
  toDeployment(h);
  const first = h.state.deployPlayer!;
  for (const seat of [0, 1] as Seat[]) {
    for (const k of ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'] as const) {
      giveResources(h, seat, k, 4);
    }
  }
  for (const seat of [first, (1 - first) as Seat]) {
    try { spawn(h, seat, 'Tidal Menace'); } catch { /* a spawn trigger suspended */ }
  }
  toNextBattle(h);
  const att = h.state.battle!.attacker;
  const declares = legalActions(h.state, att).filter(a => a.type === 'declareAttack');
  assert.ok(declares.length, 'the rig could not declare an attack — no battle region to empty');
  h.do(declares[declares.length - 1]!);
  const region = h.state.battle!.region;
  const state = structuredClone(h.state) as GameState;
  // mods live INLINE on their host, so dropping the hosts drops the mods too
  for (const [id, e] of Object.entries(state.entities)) {
    if (e.region === region) delete state.entities[id as unknown as EntityId];
  }
  if (state.battle) { state.battle.columns = []; state.battle.blocks = {}; }
  return { g: new E(state), A: att, D: (1 - att) as Seat, region };
}

/**
 * HOME — deployment, the caster alone in his own region, with the opponent
 * intact in his. R25's ordinary out-of-battle shape, and the board 158 uses.
 * Used here only for the two CT-81(b) cards, whose empty collection is a list
 * of SEATS rather than of picks.
 */
function home(seed: number): Board {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  for (const k of ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'] as const) {
    giveResources(h, A, k, 4);
  }
  spawn(h, A, 'Tidal Menace');
  spawn(h, D, 'The Foretold');
  const g = new E(h.state);
  return { g, A, D, region: g.homeRegion(A) };
}

// ── the rig ─────────────────────────────────────────────────────────────

/** Resolve one EffectDef in the board's region and return the events IT emitted. */
function resolve(def: EffectDef, b: Board, ctx: Partial<EffectCtx> = {}): EngineEvent[] {
  const before = b.g.events.length;
  def.run(b.g, {
    sourceName: 'test',
    controller: b.A,
    region: b.region,
    targets: [],
    event: null,
    choose: (_key, dec) => dec.options[0]!.value,
    ...ctx,
  } as EffectCtx);
  return b.g.events.slice(before);
}

const spellOf = (card: string): EffectDef => getCard(card).spellEffect!;
const abilityOf = (card: string, i = 0): EffectDef => getCard(card).abilities![i]!.effect;
const augmentOf = (card: string, i = 0): EffectDef => getCard(card).augmentText![i]!.effect;

/** a snapshot of everything these cards could move, for the "and nothing
 * happened" half of every test */
function snapshot(g: E): string {
  return JSON.stringify({
    life: g.s.players.map(p => p.life),
    hands: g.s.players.map(p => p.hand.join(',')),
    bins: g.s.players.map(p => p.bin.join(',')),
    units: Object.values(g.s.entities).map(e => `${e.id}:${e.card}:${e.controller}:${e.region}`).sort(),
  });
}

/** the precondition for a BARREN test: both seats are present here and neither
 * has a single unit. Without it every test below would pass for the wrong
 * reason — the loop would find somebody and the PAYLOAD would emit the event. */
function assertBarren(b: Board, card: string): void {
  const present = [...b.g.s.regions[b.region]!.presentSeats].sort();
  assert.deepEqual(present, [0, 1],
    `${card}: this test is about a region where the opponent IS present and has nothing to `
    + 'give. With nobody present it is CT-70\'s case instead and proves the wrong thing.');
  assert.deepEqual(b.g.unitsIn(b.region), [],
    `${card}: the region must hold no units at all — that is what makes every seat's pick pool `
    + 'empty. With a unit here the collection is not empty and this test proves nothing.');
  // …and there IS a board elsewhere, so "nothing happened" is about THIS
  // region rather than about a game that had run out of pieces.
  assert.ok(b.g.s.players.every(p => p.life > 0), `${card}: both players are still alive`);
}

/**
 * THE CLAUSE SPOKE — and for a half-silent card, the clause rather than the
 * effect.
 *
 * ⚠ WHY THIS IS NOT `evs.length > 0`. Four of the twelve cards below ALWAYS
 * emit something: `Recall` takes 2 life from every present seat whether or not
 * anybody recalled, `Dragnol` gains its 2 life before it drains. A test that
 * only asked "did anything happen" would pass on those four with the defect
 * fully intact — which is exactly how CT-81(b) says the whole-pool sweep is
 * blind to them, and repeating that blindness here would make this file's
 * green meaningless for a third of its subjects.
 *
 * The discriminator is STRUCTURAL, not textual: a card's own announcement is
 * `g.ev('info', msg)` with NO data payload, while every engine action that
 * moves the board emits a TYPED event carrying data (`lifeLost`, `lifeGained`,
 * `despawned`, `died`, …) — see `E.ev`, which attaches `data` only when it is
 * given some. So "the clause spoke" is: at least one data-less `info` event.
 * That survives any rewording of the sentence, which is the house rule.
 */
function assertClauseSpoke(evs: EngineEvent[], card: string, clause: string): void {
  const announcements = evs.filter(e => e.type === 'info' && e.data === undefined && e.msg.length > 0);
  assert.ok(announcements.length > 0,
    `${card}: "${clause}" resolved over an EMPTY collection and said nothing about it. `
    + `The ${evs.length} event(s) it did emit are the OTHER half of the card:\n`
    + `${evs.map(e => `    ${e.type}: ${e.msg}`).join('\n') || '    (none at all)'}\n`
    + "Add a g.ev('info', '<Card>: <why>.') to that path. \"Nothing happened\" is a legitimate "
    + 'outcome; not SAYING so never is. (R209 / CARD-TODO #74.)');
}

// ── 1. Cull ─────────────────────────────────────────────────────────────
// "[Switch1] Each player sacrifices a unit."

test('Cull — "each player sacrifices a unit" with nobody holding a unit here says so and kills nothing', () => {
  const b = barren(7901);
  assertBarren(b, 'Cull');
  const before = snapshot(b.g);
  const evs = resolve(spellOf('Cull'), b, { sourceName: 'Cull' });
  assertClauseSpoke(evs, 'Cull', 'Each player sacrifices a unit');
  assert.equal(snapshot(b.g), before, 'Cull: nobody had a unit, so nothing died');
});

test('Cull — the graft rider is the SAME EffectDef, so one repair covers both of 65\'s labels', () => {
  // CT-70 paid for this once: 65 labels `spell:Cull` and `graft:Cull`
  // separately while both read one object. Pinned so that if the card ever
  // stops sharing it, the graft route gets its own test here instead of
  // silently going unwatched.
  assert.equal(getCard('Cull').graftEffect?.effect, getCard('Cull').spellEffect);
});

// ── 2. Death Greeter ────────────────────────────────────────────────────
// "[Augment] When you play a spell, each player sacrifices a unit with cost ≤
// the spell's cost."

test('Death Greeter — "each player sacrifices a unit with cost ≤ the spell\'s" with no units here says so', () => {
  const b = barren(7902);
  assertBarren(b, 'Death Greeter');
  const before = snapshot(b.g);
  const evs = resolve(augmentOf('Death Greeter'), b, {
    sourceName: 'Death Greeter',
    // a real spell name, so `eventCardCost` reads a real cost rather than 0 —
    // the branch under test is the empty POOL, not a zero cost bar
    event: { type: 'spellPlayed', msg: '', data: { seat: b.A, card: 'Immolate' } },
  });
  assertClauseSpoke(evs, 'Death Greeter', "each player sacrifices a unit with cost ≤ the spell's cost");
  assert.equal(snapshot(b.g), before, 'Death Greeter: "(if able)" was able of nobody, so nothing died');
});

// ── 3. Grim Bargain ─────────────────────────────────────────────────────
// "Each player sacrifices a unit. Repeat this for every [3] spent. Draw a card
// for each nontoken unit you sacrificed this way."
//
// ⚠ 65 CANNOT REACH THIS ONE even with the barren board: the rig's X ladder
// lands on X = 2, which makes `rounds` 0 and takes the ALREADY-guarded
// "less than [3] spent" branch. Only a real X ≥ 3 gets to the empty plan.

test('Grim Bargain — [3] spent but nobody here has a unit: it says so and draws nothing', () => {
  const b = barren(7903);
  assertBarren(b, 'Grim Bargain');
  const before = snapshot(b.g);
  const evs = resolve(spellOf('Grim Bargain'), b, { sourceName: 'Grim Bargain', x: 3 });
  assertClauseSpoke(evs, 'Grim Bargain', 'Each player sacrifices a unit … draw a card for each');
  assert.equal(snapshot(b.g), before,
    'Grim Bargain: no unit was sacrificed, so no card is drawn — the draw is off the SACRIFICES, '
    + 'not off the [3]');
});

// ── 4. Insatiable Want ──────────────────────────────────────────────────
// "Each player with an even life total sacrifices a unit. Each player with an
// odd life total draws a card."

test('Insatiable Want — even-life players with no unit here: it says so, and no card is drawn either', () => {
  const b = barren(7904);
  assertBarren(b, 'Insatiable Want');
  // force BOTH totals even, so the draw clause is empty too and the whole
  // effect is silent without the repair. (Life is set directly: the point is
  // the parity, and no card in this test may move the board.)
  for (const p of b.g.s.players) p.life = 20;
  const before = snapshot(b.g);
  const evs = resolve(spellOf('Insatiable Want'), b, { sourceName: 'Insatiable Want' });
  assertClauseSpoke(evs, 'Insatiable Want', 'Each player with an even life total sacrifices a unit');
  assert.equal(snapshot(b.g), before,
    'Insatiable Want: an even-life player with no unit sacrifices nothing, and nobody was odd');
});

// ── 5. Maw of Damnation ─────────────────────────────────────────────────
// "Each player sacrifices two units. If four or more units were sacrificed
// this way, repeat this."

test('Maw of Damnation — "each player sacrifices two units" with none here says so and does not loop', () => {
  const b = barren(7905);
  assertBarren(b, 'Maw of Damnation');
  const before = snapshot(b.g);
  const evs = resolve(spellOf('Maw of Damnation'), b, { sourceName: 'Maw of Damnation' });
  assertClauseSpoke(evs, 'Maw of Damnation', 'Each player sacrifices two units');
  assert.equal(snapshot(b.g), before, 'Maw of Damnation: nothing was sacrificed');
  assert.ok(evs.length <= 2,
    'Maw of Damnation: an empty round must STOP the repeat, not announce an empty round twenty '
    + `times — it emitted ${evs.length} events`);
});

// ── 6. Perish ───────────────────────────────────────────────────────────
// "Each player sacrifices half of their units, rounded up."
//
// ⚠ ON NO TICKET. CT-74 named zero unrepaired members and its own exemplar was
// already fixed; Perish was found by the `barren` board added to 65 for this
// ticket, which is the argument for that board outlasting these repairs.

test('Perish — "half of their units, rounded up" is half of nothing: it says so and kills nothing', () => {
  const b = barren(7906);
  assertBarren(b, 'Perish');
  const before = snapshot(b.g);
  const evs = resolve(spellOf('Perish'), b, { sourceName: 'Perish' });
  assertClauseSpoke(evs, 'Perish', 'Each player sacrifices half of their units, rounded up');
  assert.equal(snapshot(b.g), before, 'Perish: ceil(0/2) is 0 for everybody');
});

// ── 7. Upheaval ─────────────────────────────────────────────────────────
// "Each player recalls two units. If four or more units were recalled this
// way, repeat this."

test('Upheaval — "each player recalls two units" with none here says so and does not loop', () => {
  const b = barren(7907);
  assertBarren(b, 'Upheaval');
  const before = snapshot(b.g);
  const evs = resolve(spellOf('Upheaval'), b, { sourceName: 'Upheaval' });
  assertClauseSpoke(evs, 'Upheaval', 'Each player recalls two units');
  assert.equal(snapshot(b.g), before, 'Upheaval: nothing was recalled, so no hand grew');
  assert.ok(evs.length <= 2,
    `Upheaval: an empty iteration must STOP the repeat — it emitted ${evs.length} events`);
});

// ── 8. Seabed Shellcaster ───────────────────────────────────────────────
// "When the second nontoken spell is played in this battle, [Switch1] Each
// player recalls a unit."

test('Seabed Shellcaster — "each player recalls a unit" with none here says so and recalls nothing', () => {
  const b = barren(7908);
  assertBarren(b, 'Seabed Shellcaster');
  const before = snapshot(b.g);
  const evs = resolve(abilityOf('Seabed Shellcaster'), b, {
    sourceName: 'Seabed Shellcaster',
    event: { type: 'spellPlayed', msg: '', data: { seat: b.A, card: 'Immolate' } },
  });
  assertClauseSpoke(evs, 'Seabed Shellcaster', 'Each player recalls a unit');
  assert.equal(snapshot(b.g), before, 'Seabed Shellcaster: nothing was recalled');
});

test('Seabed Shellcaster — ability and graft rider are the SAME EffectDef (one repair, two labels)', () => {
  assert.equal(getCard('Seabed Shellcaster').graftEffect?.effect,
    getCard('Seabed Shellcaster').abilities![0]!.effect);
});

// ── 9. Recall — HALF-SILENT ─────────────────────────────────────────────
// "[Switch1] Each player recalls a unit and loses 2 life."
//
// ⚠ 65 CAN NEVER SEE THIS ONE. The life loss is unconditional, so the run
// always emits; a checker that convicts only a WHOLLY silent run is blind to
// the recall clause forever, on every board. CT-81(b)'s finding, and the
// reason `assertClauseSpoke` looks for a data-less info event rather than for
// any event at all.

test('Recall — the life loss happens, the recall does not, and the card now says which', () => {
  const b = barren(7909);
  assertBarren(b, 'Recall');
  const lives = b.g.s.players.map(p => p.life);
  const hands = b.g.s.players.map(p => p.hand.length);
  const evs = resolve(spellOf('Recall'), b, { sourceName: 'Recall' });
  assertClauseSpoke(evs, 'Recall', 'Each player recalls a unit and loses 2 life');
  // the OTHER half must still do exactly what it printed — this repair is an
  // announcement, and a repair that changed behaviour would be the wrong fix
  assert.deepEqual(b.g.s.players.map(p => p.life), lives.map(l => l - 2),
    'Recall: "and loses 2 life" is unconditional — a player with no unit to recall still pays it');
  assert.deepEqual(b.g.s.players.map(p => p.hand.length), hands,
    'Recall: nothing was recalled, so no hand grew');
});

test('Recall — the graft rider is the SAME EffectDef (one repair, two labels)', () => {
  assert.equal(getCard('Recall').graftEffect?.effect, getCard('Recall').spellEffect);
});

// ── 10. Torrential Reclamation — HALF-SILENT ────────────────────────────
// "Recall X target nontoken allies. For each ally recalled this way, each
// player sacrifices a unit and you lose 1 life."

test('Torrential Reclamation — the recall and the life loss happen, the sacrifice clause says it did not', () => {
  const b = barren(7910);
  assertBarren(b, 'Torrential Reclamation');
  // the ally being recalled is NOT in the battle region — it is put in the
  // caster's own home region, so the battle region stays barren and every
  // sacrifice pool stays empty while the recall half genuinely fires.
  // (`barren` empties the BATTLE region, and the attacker's whole board walked
  // into it when the attack was declared, so there is nothing left at home.)
  const ally = b.g.spawnUnit(b.A, 'Tidal Menace' as CardName, b.g.homeRegion(b.A));
  b.g.events.length = 0;
  const life = b.g.player(b.A).life;
  const hand = b.g.player(b.A).hand.length;
  const evs = resolve(spellOf('Torrential Reclamation'), b, {
    // a ResolvedTarget for a unit IS the Entity (dsl.ts::ResolvedTarget)
    sourceName: 'Torrential Reclamation', x: 1, targets: [ally],
  } as Partial<EffectCtx>);
  assertClauseSpoke(evs, 'Torrential Reclamation', 'each player sacrifices a unit');
  // `E.recall` routes the card through `toHand` and marks the body absent
  // rather than deleting the entity — assert what the PLAYER sees.
  assert.ok(!b.g.unitsOf(b.A, b.g.homeRegion(b.A)).some(u => u.id === ally.id),
    'Torrential Reclamation: the recall half still happened — this repair adds a line, not a branch');
  assert.equal(b.g.player(b.A).hand.length, hand + 1,
    'Torrential Reclamation: the recalled ally really reached its owner\'s hand');
  assert.equal(b.g.player(b.A).life, life - 1,
    'Torrential Reclamation: "you lose 1 life" is per ALLY RECALLED, not per unit sacrificed');
  assert.deepEqual(b.g.unitsIn(b.region), [],
    'Torrential Reclamation: nobody in the barren region had a unit to sacrifice');
});

// ── 11. Dragnol — HALF-SILENT, CT-81(b) ─────────────────────────────────
// "[Augment] Pay [2]: You gain 2 life and each opponent loses 2 life."

test('Dragnol — the [2] is paid and 2 life gained; with no opponent here the drain now says so', () => {
  const b = home(7911);
  const others = b.g.s.regions[b.region]!.presentSeats.filter(s => s !== b.A);
  assert.deepEqual(others, [],
    'Dragnol: this test is R25\'s case — the caster alone in his home region out of battle');
  const lives = b.g.s.players.map(p => p.life);
  assert.ok(lives[b.D]! > 2, 'Dragnol: the opponent HAS life to lose — the no-op is R25, not exhaustion');
  const evs = resolve(augmentOf('Dragnol'), b, { sourceName: 'Dragnol' });
  assertClauseSpoke(evs, 'Dragnol', 'each opponent loses 2 life');
  assert.equal(b.g.player(b.A).life, lives[b.A]! + 2,
    'Dragnol: the gain half is unchanged — the player paid [2] and got the 2 life');
  assert.equal(b.g.player(b.D).life, lives[b.D]!,
    'Dragnol: a seat that is not in this region loses nothing (R25)');
});

// ── 12. Shoreline Specter — HALF-SILENT, CT-81(b) ───────────────────────
// "When I die, you may recall target unit. If you do, each opponent loses 2
// life." — and its OWN PROMPT says "(each opponent loses 2 life)", which is
// what makes the silence a broken promise rather than merely a missing line.

test('Shoreline Specter — its prompt promises "each opponent loses 2 life"; with none here it says why not', () => {
  const b = home(7912);
  const others = b.g.s.regions[b.region]!.presentSeats.filter(s => s !== b.A);
  assert.deepEqual(others, [], 'Shoreline Specter: R25\'s case — nobody else in this region');
  const victim = b.g.unitsOf(b.A, b.region)[0];
  assert.ok(victim, 'the rig needs a unit to recall, or the decline branch runs instead');
  const lives = b.g.s.players.map(p => p.life);
  const hand = b.g.player(b.A).hand.length;
  assert.ok(lives[b.D]! > 2, 'Shoreline Specter: the opponent HAS life to lose');
  const evs = resolve(augmentOf('Shoreline Specter'), b, {
    sourceName: 'Shoreline Specter',
    targets: [victim],
    event: { type: 'afterCombat', msg: '', data: { seat: b.A } },
    // the prompt is a payOrDecline whose FIRST option is "Recall …" — the
    // rig's first-option answer is the "yes" branch, which is the one that
    // promised the life loss
    choose: (_k, dec) => dec.options[0]!.value,
  } as Partial<EffectCtx>);
  assertClauseSpoke(evs, 'Shoreline Specter', 'each opponent loses 2 life');
  assert.ok(!b.g.unitsOf(b.A, b.region).some(u => u.id === victim.id),
    'Shoreline Specter: the recall half still happened — the promise it broke was the OTHER half');
  assert.equal(b.g.player(b.A).hand.length, hand + 1,
    'Shoreline Specter: the recalled ally really reached its owner\'s hand');
  assert.deepEqual(b.g.s.players.map(p => p.life), lives,
    'Shoreline Specter: no opponent is here, so nobody loses 2 life (R25)');
});

// ── 13. THE CLASS ITSELF ────────────────────────────────────────────────

/** the twelve repair SITES. Sites, not labels: Cull, Seabed Shellcaster and
 * Recall each back TWO of 65's conformance labels with ONE object, so the
 * fifteen labels are twelve repairs. CT-70 was closed against a miscount of
 * exactly this kind; the three shared-object assertions above are what keep
 * the two numbers reconcilable. */
const REPAIRED = [
  'Cull', 'Death Greeter', 'Grim Bargain', 'Insatiable Want', 'Maw of Damnation',
  'Perish', 'Upheaval', 'Seabed Shellcaster',
  // half-silent — invisible to 65 by construction (CT-81b)
  'Recall', 'Torrential Reclamation', 'Dragnol', 'Shoreline Specter',
];

test('every card repaired for CARD-TODO #74 carries an EffectDef the whole-pool sweeps can see', () => {
  // Same house rule as 158's #12: the nets have to be aimed at the same cards,
  // or a fix here can rot without the sweep noticing.
  assert.equal(REPAIRED.length, 12, 'twelve repair sites — see the header for the definition');
  const missing = REPAIRED.filter(c => effectsOf(c).length === 0);
  assert.deepEqual(missing, [],
    'these cards carry no EffectDef the registry can see, so 65-effect-conformance and '
    + '81-card-drill cannot watch them');
});

test('the four half-silent members are watched HERE because no silence sweep can see them', () => {
  // CT-81(b), as an assertion rather than as a claim in a comment. Each of
  // these emits something even with its clause empty, so 65's "a completed run
  // must emit SOMETHING" is satisfied while the defect stands. If one of them
  // ever became wholly silent, 65 would start convicting it and this test
  // would be describing the wrong world — so it checks the property directly.
  const halfSilent: [string, EffectDef, Partial<EffectCtx>][] = [
    ['Recall', spellOf('Recall'), {}],
    ['Dragnol', augmentOf('Dragnol'), {}],
  ];
  for (const [card, def, extra] of halfSilent) {
    const b = card === 'Dragnol' ? home(7913) : barren(7913);
    const evs = resolve(def, b, { sourceName: card, ...extra });
    const typed = evs.filter(e => e.data !== undefined);
    assert.ok(typed.length > 0,
      `${card} is supposed to be HALF-silent: its other half moves the board and emits a typed `
      + 'event, which is exactly why 65-effect-conformance can never convict it. It emitted no '
      + 'typed event at all here, so either the card changed or this file\'s premise did.');
  }
});

test('the empty-collection class and CARD-TODO #70\'s region class are disjoint', () => {
  // Two tickets, two causes, one player-facing defect (see the header). They
  // are watched in two files — 158 for "no seat qualified", this one for "no
  // seat had anything to give" — and the split only works if no card is in
  // both lists with only one of them maintained. Malicious Hardware is the
  // seam: R187 gave it the CT-70 line and the CT-74 line in the same commit,
  // and it is 158's, not this file's.
  const ct70 = new Set([
    'Bloated Manablub', 'Blightmound', 'Linked Extinction', 'Void Memory',
    'Growing Plague', 'Malicious Hardware', 'Pestilent Mycelion', 'Rotwall',
    'Verdant Necrophage', 'Stellarspore Harvester',
    'Restitution', 'Vroot', 'Flzzz',
  ]);
  const both = REPAIRED.filter(c => ct70.has(c));
  assert.deepEqual(both, [],
    `${both.join(', ')} is watched by BOTH 158-silent-region-branches and this file. That is not `
    + 'wrong in itself, but it must be deliberate: pick one owner, or the day the card changes '
    + 'one file is updated and the other silently keeps asserting the old shape.');
});

test('every repaired card is a real registered card, spelled the way the registry spells it', () => {
  // cheap, and it is how a rename turns this whole file into twelve tests of
  // nothing
  for (const c of REPAIRED) assert.ok(getCard(c as CardName), `${c} is not in the registry`);
});
