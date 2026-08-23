/* THE END-OF-TURN WINDOW — a card asks its question there like anywhere else.
 *
 * WHAT THIS FILE IS FOR
 *
 * `helpers.inEndOfTurn(g)` — `g.s.phase === 'deploy' && g.s.deployPlayer ===
 * null` — existed because of one claim:
 *
 *     "a ctx.choose suspension there strands the game, so choose-based
 *      effects reachable then must auto-pick deterministically instead"
 *
 * Twenty-one cards took that licence and SILENTLY ANSWERED FOR THE PLAYER.
 * General Smof sacrificed your leftmost unit. Ghord sacrificed your
 * opponent's. Big Glimpse Card put all seven cards in pile 2 and cached
 * nothing, which is a four-mana spell that does nothing at all. Mindburn
 * sacrificed the leftmost unit X times over rather than letting anybody
 * discard. Bloodwind Revenant, Eminence of the Barrens, Hexbane Shiitake,
 * Mindspore Fiend, Dragnol, Swarmling, Maelstrom Charger, Tempest Oracle and
 * Abduct's ransom clause all declined offers nobody heard. None of them said
 * which way it had gone, because from inside the effect nothing had gone any
 * way — the question was never asked.
 *
 * THE CLAIM WAS STALE. `E.endTurn` sets `s.turnEnding` BEFORE it fires the
 * end-of-turn triggers and then calls `settle()`; `settle()` calls
 * `finishTurnEnd()` at every stable point, which flips the turn once the
 * decision, the stack and the trigger queue are all empty. The turn-end is
 * owed as a FLAG, not held on a call stack, so a suspension raised inside
 * that window is answered like any other and the flip happens on the way back
 * out. R85's replay contract does the rest: a suspension rolls the part back
 * and replays it from its start, with `shownEvents` suppressing the log lines
 * it already printed.
 *
 * THE RULING (designer, 2026-08-23) was taken with the cost stated — that
 * Smof, Ghord, Rockfall and Unstable Form interrupt every turn-end they fire
 * on, and that Mindburn can raise 2X prompts in a row:
 *
 *     "Ask — the click is the price."
 *
 * If turn-ends prove noisy in play the answer is a UI fast-path (auto-confirm,
 * "same as last time"), never a silent engine pick. So the guard is gone, the
 * helper is deleted, and this file is what stops it coming back.
 *
 * THE SHAPE OF THE FILE, and why it is not just a grep. Tests 1 and 2 are
 * source sweeps in the house idiom (68-target-conformance,
 * 88-replacement-conformance): they keep the PATTERN from being retyped.
 * A sweep is worthless on its own, because it goes on passing happily if
 * `finishTurnEnd` regresses and suspending in that window really does strand
 * the game again — at which point deleting the guard was the wrong call.
 * Test 3 is the one that goes red first: it drives a real `endTurn()` and
 * demands both halves, the question AND the flip. Tests 4-8 are the worst
 * offenders in the situation each of them used to get wrong.
 *
 * Seeds 9900-9999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { EffectCtx, EffectDef } from '../src/cards/dsl.ts';
import * as helpers from '../src/cards/sets/helpers.ts';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
} from './util.ts';
import type { EngineEvent, Entity, EntityId, Seat } from '../src/types.ts';

// ── 1 & 2. the pattern itself ───────────────────────────────────────────

const CARDS_DIR = fileURLToPath(new URL('../src/cards/', import.meta.url));
const SETS_DIR = `${CARDS_DIR}sets/`;

/** every .ts under src/cards/, as [relative path, source] */
function cardSources(): [string, string][] {
  const out: [string, string][] = [];
  for (const f of readdirSync(CARDS_DIR)) {
    if (f.endsWith('.ts')) out.push([f, readFileSync(CARDS_DIR + f, 'utf8')]);
  }
  for (const f of readdirSync(SETS_DIR)) {
    if (f.endsWith('.ts')) out.push([`sets/${f}`, readFileSync(SETS_DIR + f, 'utf8')]);
  }
  return out;
}

/**
 * EXEMPTIONS — a file allowed to name the auto-answer pattern anyway, with the
 * reason it is allowed to. Empty, and it should stay that way: there is no
 * legitimate use of the shape left, because the situation it existed for is
 * one the engine handles. It is here rather than absent so that adding one is
 * a deliberate act with a written reason attached, and so that
 * `every exemption is still needed` has something to police.
 */
const EXEMPT: Record<string, string> = {};

test('no card auto-answers a choice in the end-of-turn window', () => {
  const offenders: string[] = [];
  for (const [path, src] of cardSources()) {
    if (path in EXEMPT) continue;
    if (/\binEndOfTurn\b/.test(src)) offenders.push(path);
  }
  assert.deepEqual(offenders, [],
    'these files name `inEndOfTurn` again. The helper was DELETED on 2026-08-23 with the '
    + 'designer\'s ruling behind it — "Ask — the click is the price" — because auto-picking '
    + 'a player\'s answer is a silent WRONG answer, not a convenience. If the end-of-turn '
    + 'window is too noisy in play, the fix is a UI fast-path (auto-confirm / "same as last '
    + 'time"), never an engine-side pick. See the head of this file.\n  '
    + offenders.join('\n  '));
  // the runtime half of the same claim: the helper is not merely unused, it is
  // GONE. A grep passes on a helper nobody imports yet; this does not.
  assert.equal('inEndOfTurn' in helpers, false,
    'helpers.ts exports `inEndOfTurn` again — leaving it alive is how the pattern comes back');
});

test('nobody re-derives the end-of-turn window by hand', () => {
  // deleting the helper is worth nothing if the next card inlines its body.
  // ⚠ this is deliberately narrow: `deployPlayer === <a seat>` is a different
  // question (Mirage Walker asks it) and is not what this forbids.
  const offenders: string[] = [];
  for (const [path, src] of cardSources()) {
    if (path in EXEMPT) continue;
    if (/deployPlayer\s*===?\s*null/.test(src)) offenders.push(path);
  }
  assert.deepEqual(offenders, [],
    'these files test `deployPlayer === null` themselves, which is the end-of-turn window '
    + 'written out longhand. Card code has no business branching on it at all: the engine '
    + 'answers questions raised there and closes the owed turn flip afterwards.\n  '
    + offenders.join('\n  '));
});

test('every exemption is still needed', () => {
  const stale: string[] = [];
  const sources = new Map(cardSources());
  for (const [path, why] of Object.entries(EXEMPT)) {
    const src = sources.get(path);
    if (src === undefined) { stale.push(`${path} is exempt but does not exist`); continue; }
    if (!/\binEndOfTurn\b|deployPlayer\s*===?\s*null/.test(src)) {
      stale.push(`${path} is exempt (${why}) but no longer needs to be — delete the entry`);
    }
  }
  assert.deepEqual(stale, [],
    'an exemption that outlives its cause is a hole in the sweep that nobody is watching');
});

// ── 3. THE LOAD-BEARING ONE ─────────────────────────────────────────────
//
// Everything above is a source sweep, and a source sweep goes on passing if
// the ENGINE regresses. This is the counterfactual that justified the whole
// change, run as a test: General Smof grafted onto Mirage Walker's
// end-of-turn cause (the 97-mode-conformance recipe), driven into a real
// `endTurn()`.
//
// As shipped, Smof sacrificed `units[0]` — which was its own graft host — and
// erased it, its mods and Smof with it, in silence. With the guard gone the
// `ctx.choose` suspends, is answered, and the turn flips. If this ever goes
// red, `E.finishTurnEnd` no longer resumes out of `settle()`, the claim that
// let the twenty-one auto-picks go has stopped holding, and they — or a
// better fix — have to come back.

test('a choice raised inside a real endTurn() is asked, answered, and the turn still flips', () => {
  const h = new Harness(9901);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const walker = spawn(h, p, 'Mirage Walker');         // "at the end of turn, [Switch1] …"
  const fodder = spawn(h, p, 'Conduit of Pain');       // a SECOND unit, so the pick is real
  giveResources(h, p, 'fire', 2);                      // General Smof r / 2
  // General Smof rides the Walker's end-of-turn cause as a graft (R9/R110)
  h.do({
    type: 'graft', seat: p, from: 'hand',
    index: give(h, p, 'General Smof'), hostId: walker, position: 0,
  });
  // …but grafting IS a deployment action, and the Walker's cause is "if you
  // took no actions during deployment". So run the turn out and come back to
  // the NEXT one, where the seat does nothing at all.
  toNextBattle(h, p);
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') {
    h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  }
  const turn = h.state.turn;
  // both seats finish deploying → endTurn() → the graft composite resolves
  for (const seat of [0, 1] as const) {
    if (!h.state.deployDone?.[seat]) h.do({ type: 'doneDeploying', seat });
  }
  const dec = h.state.decision;
  assert.ok(dec, 'the end-of-turn window ASKS now — it used to sacrifice your leftmost unit '
    + 'for you, in silence, and that unit was the graft host itself');
  assert.equal(dec.seat, p, 'and it asks the player whose unit is being sacrificed');
  assert.ok(dec.options.length > 1,
    'a one-option menu would mean this test arranged no real choice and proved nothing');
  pick(h, fodder);                                     // NOT units[0] — the shipped auto-pick
  assert.equal(h.state.decision, null, 'the question is answered');
  assert.equal(h.state.turn, turn + 1,
    'and E.finishTurnEnd resumed out of settle() — the turn flipped, nothing stranded. '
    + 'If THIS is the assertion that failed, the claim behind deleting `inEndOfTurn` is '
    + 'no longer true and the sweeps above are guarding a wrong decision.');
  assert.equal(h.state.phase, 'planning', 'the next turn really started');
  assert.equal(ent(h, fodder), undefined, 'the unit the PLAYER chose is the one that was sacrificed');
  assert.ok(ent(h, walker), 'and the one they kept is still here — the auto-pick would have taken it');
});

// ── the white-box rig for 4-8 ───────────────────────────────────────────
//
// Most of the twenty-one are triggers on battle-only or death-only causes;
// arranging each of them to fire inside a genuine `endTurn()` over the action
// path would test the trigger plumbing, which other files already do, and not
// the thing that was broken. So these resolve the card's own effect with the
// game put into exactly the state `inEndOfTurn` used to name, and MEASURE THE
// QUESTIONS: who was asked, and what they were offered. Test 3 above is what
// keeps this rig honest about the window being survivable at all.

interface Ask { key: string; seat: Seat; prompt: string; options: unknown[] }

/** a real game walked to deployment and then put into the END-OF-TURN window */
function endOfTurn(seed: number): { g: E; h: Harness; A: Seat; D: Seat; region: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const g = new E(h.state);
  const region = g.homeRegion(A);
  g.s.deployPlayer = null;   // ← the window: phase 'deploy', nobody deploying
  assert.equal(g.s.phase, 'deploy', 'the rig has to reproduce the window exactly');
  return { g, h, A, D, region };
}

/** put a seat into a region, the way E.giveControl does when a unit defects */
function present(g: E, region: number, seat: Seat): void {
  const ps = g.s.regions[region]!.presentSeats;
  if (!ps.includes(seat)) ps.push(seat);
}

/**
 * Resolve one EffectDef in that window and record every question it asks.
 * `answers` is keyed by the effect's own choose key; an UNANSWERED key throws,
 * so a test cannot accidentally sleepwalk past a prompt it did not expect.
 */
function askAll(
  def: EffectDef, g: E, ctx: Partial<EffectCtx> & { controller: Seat; region: number },
  answers: Record<string, unknown> = {},
): { asks: Ask[]; evs: EngineEvent[] } {
  const asks: Ask[] = [];
  const before = g.events.length;
  def.run(g, {
    sourceName: 'test',
    targets: [],
    event: null,
    choose: (key, dec) => {
      asks.push({ key, seat: dec.seat, prompt: dec.prompt, options: dec.options.map(o => o.value) });
      if (!(key in answers)) {
        throw new Error(`unanswered choose "${key}" (${dec.prompt}) — options `
          + JSON.stringify(dec.options.map(o => o.label)));
      }
      return answers[key];
    },
    ...ctx,
  } as EffectCtx);
  return { asks, evs: g.events.slice(before) };
}

const spellOf = (card: string): EffectDef => getCard(card).spellEffect!;
const graftOf = (card: string): EffectDef => getCard(card).graftEffect!.effect;

/** spawn straight into a region, white-box (the util spawn() is home-only) */
function put(g: E, seat: Seat, name: string, region: number): Entity {
  const u = g.spawnUnit(seat, name, region);
  present(g, region, seat);
  return u;
}

// ── 4. General Smof ─────────────────────────────────────────────────────

test('General Smof asks which unit to sacrifice instead of taking units[0]', () => {
  const { g, A, region } = endOfTurn(9902);
  const keep = put(g, A, 'Gublin', region);
  const give_ = put(g, A, 'Shib', region);
  const { asks } = askAll(graftOf('General Smof'), g, { controller: A, region },
    { [`sac:${A}`]: give_.id });
  assert.equal(asks.length, 1, 'exactly one seat is present here, so exactly one question');
  assert.equal(asks[0]!.seat, A, 'and it is put to the player losing the unit');
  assert.deepEqual(asks[0]!.options, [keep.id, give_.id], 'both units are on the menu');
  assert.equal(g.entity(give_.id), undefined, 'the unit the PLAYER named is sacrificed');
  assert.ok(g.entity(keep.id), 'units[0] is not — that was the shipped auto-pick, and it '
    + 'routinely ate the graft host that had just triggered');
});

// ── 5. Ghord ────────────────────────────────────────────────────────────

test('Ghord makes the OPPONENT choose their own sacrifice, not the caster', () => {
  const { g, A, D, region } = endOfTurn(9903);
  const mine = put(g, A, 'Gublin', region);            // never at risk: "each OPPONENT"
  const keep = put(g, D, 'Shib', region);
  const give_ = put(g, D, 'Good Whale', region);
  const { asks } = askAll(graftOf('Ghord'), g, { controller: A, region },
    { [`sac:${D}`]: give_.id });
  assert.equal(asks.length, 1, 'one opponent is present, so one question');
  assert.equal(asks[0]!.seat, D,
    'THE OPPONENT is asked. The shipped code took their units[0] on the caster\'s behalf, '
    + 'which is a player answering a question that was never theirs to answer');
  assert.deepEqual(asks[0]!.options, [keep.id, give_.id]);
  assert.equal(g.entity(give_.id), undefined, 'their named unit dies');
  assert.ok(g.entity(keep.id) && g.entity(mine.id), 'and nothing else does');
});

// ── 6. Mindburn ─────────────────────────────────────────────────────────

test('Mindburn asks once per iteration and lets you discard rather than sacrifice', () => {
  const { g, A, region } = endOfTurn(9904);
  const a = put(g, A, 'Gublin', region);
  const b = put(g, A, 'Shib', region);
  g.player(A).hand.length = 0;                         // a hand with known contents
  g.player(A).hand.push('Immolate', 'Overbloom');
  const handBefore = g.player(A).hand.length;
  // X = 2 → two rounds, each a fresh question. The shipped code took
  // options[0] both times: the leftmost NONTOKEN UNIT, twice over.
  const { asks } = askAll(spellOf('Mindburn'), g, { controller: A, region, x: 2 }, {
    [`pick:0:${A}`]: 'h:0',
    [`pick:1:${A}`]: 'h:0',
  });
  assert.equal(asks.length, 2,
    'one question per iteration — this is the card the designer was warned about by name '
    + '("Mindburn can raise 2X prompts in a row") and accepted');
  assert.notEqual(asks[0]!.key, asks[1]!.key,
    'and the keys differ per round, or R85 replay would answer round 2 with round 1\'s answer');
  assert.ok(asks.every(k => k.seat === A));
  assert.ok(asks[0]!.options.some(v => String(v).startsWith('h:')),
    'discarding is on the menu at all — it is half the printed text');
  assert.ok(g.entity(a.id) && g.entity(b.id),
    'both units survive: the player discarded twice, which the shipped auto-pick could '
    + 'never do — it always sacrificed the leftmost unit');
  assert.equal(g.player(A).hand.length, handBefore - 2, 'two cards left the hand instead');
  assert.equal(g.player(A).bin.filter(n => n === 'Immolate' || n === 'Overbloom').length, 2,
    'discarding is trashing (R40) — they are in the bin');
});

// ── 7. Big Glimpse Card ─────────────────────────────────────────────────

test('Big Glimpse Card really splits the 7 and caches a non-empty pile', () => {
  const { g, A, D, region } = endOfTurn(9905);
  const seven = ['Gublin', 'Shib', 'Chombot', 'Uglk', 'Bloppert', 'Zephyrzoa', 'Mindburn'];
  const deck = g.deckOf(A);
  deck.unshift(...seven);
  const deckBefore = deck.length;
  // the opponent splits (two cards into pile 1, then "Done"), the caster picks
  const { asks } = askAll(spellOf('Big Glimpse Card'), g,
    { controller: A, region, targets: [{ player: D }] },
    { 'split:0': 0, 'split:1': 1, 'split:2': false, pile: 'a' });
  assert.equal(asks.length, 4, 'three split prompts and the pile prompt');
  assert.ok(asks.slice(0, 3).every(k => k.seat === D), 'the OPPONENT splits');
  assert.equal(asks[3]!.seat, A, 'the CASTER chooses which pile is cached');
  const cache = g.player(A).cache ?? [];
  assert.deepEqual(cache.map(c => c.card), ['Gublin', 'Shib'],
    'the chosen pile is cached. As shipped this card was a four-mana NO-OP here: the split '
    + 'auto-answered "Done" before a single card moved, so pile 1 was empty, pile 1 was '
    + 'cached, and all seven were recycled');
  assert.ok(cache.every(c => c.playableUntilTurn === g.s.turn),
    'with the glimpse-style permission the printed text promises (R45)');
  assert.equal(deck.length, deckBefore - 7 + 5, 'the other five went to the bottom');
});

// ── 8. Abduct ───────────────────────────────────────────────────────────

test('Abduct offers the pay-to-keep clause to the VICTIM', () => {
  const { g, h, A, D, region } = endOfTurn(9906);
  const theirs = put(g, D, 'Stasis Sentry', region);   // cost 3
  giveResources(h, D, 'metal', 3);                     // the ransom has to be payable
  assert.ok(g.openMana(D) >= 3, 'the rig has to make the [x] affordable, or this tests the '
    + 'unaffordable branch instead');
  const { asks } = askAll(spellOf('Abduct'), g,
    { controller: A, region, targets: [theirs], x: 3 }, { pay: true });
  assert.equal(asks.length, 1, 'the ransom is offered');
  assert.equal(asks[0]!.seat, D,
    'to the VICTIM, whose unit and whose mana it is. The shipped code skipped the offer '
    + 'entirely in this window and simply handed the unit over');
  assert.equal(g.entity(theirs.id)!.controller, D, 'they paid, so they keep it');
  assert.ok(g.openMana(D) < 3, 'and the mana really left their pool');
});

// ── 9. Dream Lapse, the one that mutates BEFORE it asks ─────────────────
//
// Every other site in this change follows the batch files' plan-then-commit
// convention: gather the answers, then touch the game. Dream Lapse does not —
// it calls `removeFromStack` and pushes the card into a hand, and ONLY THEN
// asks which card to discard. Before this change that choose could not
// suspend in the end-of-turn window (it auto-picked hand[0]); everywhere else
// it always could, and it always mutated first. So the hazard is not new, but
// it is the one worth checking by hand: R85 rolls the part back and REPLAYS it
// from the start, which means `removeFromStack` and `hand.push` run a second
// time. If the rollback did not restore the stack, the replay would find
// nothing to recall; if it did not restore the hand, the card would arrive
// twice. Confirmed here rather than reasoned about.

test('Dream Lapse suspends AFTER mutating and the R85 replay does not double the recall', () => {
  const h = new Harness(9907);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - h.state.initiative) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const prey = spawn(h, D, 'Shib');
  toNextBattle(h, A);
  for (const p of h.state.players) { p.bin.length = 0; p.hand.length = 0; }
  giveResources(h, D, 'fire', 2);                      // Luminous Arc r / 2
  giveResources(h, A, 'water', 1);
  giveResources(h, A, 'dark', 1);                      // Dream Lapse bd / 2
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: prey });
  const arcId = h.state.stack.find(i => i.card === 'Luminous Arc')!.id;
  // a SECOND card in D's hand is what makes the discard a real question — the
  // `hand.length === 1` arm is kept deliberately and would skip the suspension
  h.state.players[D]!.hand.push('Immolate');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Dream Lapse') });
  pick(h, { stack: arcId });
  pass(h); pass(h);                                    // resolve Dream Lapse
  const dec = h.state.decision;
  assert.ok(dec, 'the discard is a real question with two cards in hand');
  assert.equal(dec.seat, D, 'and the recalled spell\u2019s controller is the one who answers it');
  // the mutations that happened BEFORE the suspension, seen from mid-flight
  assert.ok(!h.state.stack.some(i => i.id === arcId), 'the Arc is off the stack');
  assert.deepEqual([...h.state.players[D]!.hand].sort(), ['Immolate', 'Luminous Arc'],
    'the recall landed exactly once, not twice — the replay re-ran it over rolled-back state');
  pick(h, h.state.players[D]!.hand.indexOf('Luminous Arc'));
  assert.equal(h.state.decision, null);
  assert.deepEqual(h.state.players[D]!.hand, ['Immolate'], 'one card discarded, one left');
  assert.equal(h.state.players[D]!.bin.filter(n => n === 'Luminous Arc').length, 1,
    'and exactly one copy reached the bin — a doubled recall would show up here');
  assert.ok(!h.state.stack.some(i => i.id === arcId), 'the Arc did not come back with the replay');
  assert.equal(h.log.filter(l => l.includes('is recalled off the stack')).length, 1,
    'and the log says it once, not twice: R85 suppresses the lines the first pass already '
    + 'printed, which is what keeps a replayed mutation invisible instead of confusing');
  finishBattle(h);
});

// ── 10. the count, so a deletion is visible ─────────────────────────────

test('the twenty-one auto-answers are gone from the pool, counted rather than assumed', () => {
  // A named roll-call, because "no matches" is also what a broken sweep says.
  // TWENTY-ONE SITES ACROSS TWENTY CARDS — Big Glimpse Card carried two, the
  // split and the pile. Every one of them now reaches a real ctx.choose /
  // chooseUnit / pickUnit instead of an answer the engine invented.
  const FIXED = [
    'Bloodwind Revenant', 'General Smof', 'Ghord', 'A Fast Pile of Rocks',
    'Eminence of the Barrens', 'Hexbane Shiitake', 'Mindspore Fiend', 'Rebalance',
    'Verdant Necrophage', 'Big Glimpse Card', 'Dream Lapse', 'Uglk', 'Mindburn',
    'Chombot', 'Dragnol', 'Swarmling', 'Maelstrom Charger', 'Abduct',
    'Tempest Oracle', 'Unstable Form',
    // and the two that were never live defects, deleted in the same pass:
    'Corrupting Blight',   // unreachable in 1v1 (`candidates.length === 1` wins)
    'Plague Bellower',     // dead code: activated abilities cannot run in this window
  ];
  const missing = FIXED.filter(n => { try { getCard(n); return false; } catch { return true; } });
  assert.deepEqual(missing, [], 'a card on the roll-call no longer exists — if it was '
    + 'renamed, rename it here too rather than dropping it');
  assert.equal(FIXED.length, 22,
    'twenty cards with live defects plus the two dead ones — the roll-call is the record '
    + 'of what this change touched, and shrinking it silently is how a card gets un-fixed');
});
