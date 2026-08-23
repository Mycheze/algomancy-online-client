/**
 * THE CARD DRILL — every card in the pool is played in a real game, and the
 * engine is asked to prove it did something.
 *
 * WHY THIS FILE EXISTS
 *
 * The owner, 2026-08-23: "we keep running into non functional cards … I'm
 * tired of coming across cards that just don't even do what they're supposed
 * to." Three nets already existed and none of them could catch that:
 *
 *  1. The BATCH test files (12-46) do carry a test per card, but for a large
 *     share of the pool that test is a registration smoke check — it spawns
 *     the body and asserts the printed 2/2. 121 of the 494 cards were named
 *     exactly once anywhere in `test/`, which is what such a check looks like
 *     from the outside.
 *  2. `65-effect-conformance` has the right assertion (an effect that
 *     completes and emits nothing is a failure) but a FUZZ drive. Measured on
 *     2026-08-23: 143 of the 424 cards with effects were never driven once
 *     across 140 fuzz games. An effect that never runs can never be caught
 *     being silent, and the reach floor in that file (`attempted >= 260`) is
 *     satisfied while a third of the pool goes unvisited.
 *  3. `71-card-ledger` reads a card's SHAPE. That catches `events: []` and an
 *     empty `run`; it cannot catch a run that collects a target, checks a
 *     condition and quietly returns.
 *
 * Abduct is what sat in the gap. Its printed text is "Gain control of target
 * unit with cost [x] or less unless its controller pays [x]", the target menu
 * offers your OWN units, and taking one runs
 *
 *     if (u.controller === ctx.controller) return;   // already yours
 *
 * — no event, no log line, nothing. The spell leaves the stack and the player
 * cannot tell a rule from a bug. The fuzzer never cast it, the shape sweep saw
 * live code, and the batch test asserted it registers. This file is the net
 * that closes under it.
 *
 * WHAT IT DOES
 *
 * `drill.ts` plays a named card through the engine's own action path — put it
 * in a hand, walk the real game forward, pick the `playCard` out of
 * `legalActions`, pass priority, answer decisions, let it resolve. Nothing
 * calls an effect's `run` directly and nothing pokes state to fake a cast, so
 * "it works in the drill" means "it works in a game".
 *
 * Each card is drilled in THREE board states, because which branch of a card
 * runs is a property of the board, not of the card:
 *
 *   'bait'   — an opponent-controlled effect is on the stack. The only state
 *              in which the eleven negate/retarget cards are castable at all.
 *   'plain'  — bodies and bins on both sides, empty stack.
 *   'lonely' — only the caster has units, which is what pushes a targeted
 *              card down its own-unit branch. This is the scenario that
 *              catches Abduct.
 *
 * and the assertions are the two that "non functional" actually means:
 * the card can be REACHED, and resolving it SAYS something.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, ambushEffect, getCard, type EffectDef } from '../src/cards/dsl.ts';
import { effectsOf } from '../src/cards/registry.ts';
import { drillCard, drillable, seedBoard } from './drill.ts';
import { E } from '../src/engine.ts';
import type { GameState, Seat } from '../src/types.ts';

// ── the recorder: which effects completed, and which said nothing ────────
//
// Shaped on 65-effect-conformance's wrapper, for the same reason: the
// registry stores the very EffectDef objects the engine resolves, so wrapping
// `run` in place sees every resolution however it was reached — cast, graft
// rider, donated [Augment] text, ambush.

const owners = new Map<EffectDef, string[]>();
for (const name of allCardNames()) {
  const defs = [...effectsOf(name)];
  if (getCard(name).ambush) defs.push(ambushEffect(name));
  for (const def of defs) {
    const l = owners.get(def);
    if (l) { if (!l.includes(name)) l.push(name); } else owners.set(def, [name]);
  }
}

/** effects that completed at least one run, and the silent-run tally */
const completed = new Set<EffectDef>();
const silent = new Map<EffectDef, number>();
/** the scenario currently being drilled, for the failure message */
let scenario = '';
const silentWhere = new Map<EffectDef, Set<string>>();

for (const def of owners.keys()) {
  const inner = def.run;
  def.run = (g, ctx) => {
    const before = g.events.length;
    inner(g, ctx);
    // reached only on a COMPLETED run — a Suspended throw skips it, and the
    // engine re-executes a suspended run from the top once answered
    completed.add(def);
    if (g.events.length === before) {
      silent.set(def, (silent.get(def) ?? 0) + 1);
      (silentWhere.get(def) ?? silentWhere.set(def, new Set()).get(def)!).add(scenario);
    }
  };
}

// ── the three board states ──────────────────────────────────────────────

/** only the caster has units — the board that pushes a targeted card down its
 *  own-unit branch (Abduct's "already yours", Organic Exchange's same-side
 *  swap). Without it those branches are unreachable and untested. */
function lonelyBoard(s: GameState, seat: Seat): void {
  const e = new E(s);
  for (const body of ['Tidal Menace', 'The Foretold', 'Bubb', 'Curio Drifter']) {
    try { e.spawnUnit(seat, body, e.homeRegion(seat), {}); } catch { /* unregistered */ }
  }
  const p = s.players[seat]!;
  p.bin.push('Tidal Menace', 'The Foretold', 'Curio Drifter', 'Immolate');
  try { e.settle(); } catch { /* a spawn trigger may suspend */ }
}

const SCENARIOS: { name: string; opts: Parameters<typeof drillCard>[2] }[] = [
  { name: 'bait', opts: { bait: true } },
  { name: 'plain', opts: {} },
  { name: 'lonely', opts: { setup: lonelyBoard } },
];

const POOL = allCardNames().filter(drillable);

/**
 * Cards the drill cannot reach through a hand, each with its reason. Kept to
 * the size it has to be: every name here is a hole in the net (the
 * 68-target-conformance pattern), and the assertion below fails if one of them
 * becomes reachable, so an entry cannot outlive its reason.
 */
const UNREACHABLE: Record<string, string> = {
  'Calming Force':
    'R100 — the card prints "I can\'t be played from your hand", and '
    + '80-round17-permissions asserts it is refused at every window. Never being '
    + 'a legal play IS the implemented behaviour.',
};

// ── the drive ───────────────────────────────────────────────────────────

const results = new Map<string, ReturnType<typeof drillCard>[]>();

test('the drill plays every card in the pool, in three board states', () => {
  for (const { name, opts } of SCENARIOS) {
    scenario = name;
    for (const card of POOL) {
      const r = drillCard(card, 900_000, opts);
      (results.get(card) ?? results.set(card, []).get(card)!).push(r);
    }
  }
  assert.ok(results.size === POOL.length, 'every card was drilled');
});

// ── 1. REACHABILITY: a card you cannot play is a card that does not work ──

test('every card can actually be played in a real game', () => {
  const unreachable: string[] = [];
  for (const [card, rs] of results) {
    if (card in UNREACHABLE) continue;
    if (!rs.some(r => r.played)) {
      unreachable.push(`${card} — never became a legal play in any of the three board states`);
    }
  }
  assert.deepEqual(unreachable.sort(), [],
    'these cards are in the deck and cannot be cast:\n  ' + unreachable.join('\n  ')
    + '\n\nEither the card is genuinely unplayable (a defect), or the drill needs a '
    + 'board state that gives it a legal target — add one to SCENARIOS rather than '
    + 'adding the card to UNREACHABLE, which is only for cards whose printed text '
    + 'says they cannot be played from hand.');
});

test('the UNREACHABLE exemptions are all still needed', () => {
  // self-invalidation, the house rule from 68-target-conformance: an exemption
  // that stops being true has to fail, or the list rots into a lie the way the
  // PARKED comments did.
  const stale: string[] = [];
  for (const [card, why] of Object.entries(UNREACHABLE)) {
    assert.ok(why.length > 40, `${card}: an exemption needs a reason, not a shrug`);
    if (results.get(card)?.some(r => r.played)) {
      stale.push(`${card} IS reachable now — delete its UNREACHABLE entry`);
    }
  }
  assert.deepEqual(stale, []);
});

// ── 2. NO CARD CRASHES, AND NOTHING IS OFFERED THEN REFUSED ─────────────

test('no card crashes the engine, and legalActions never lies about it', () => {
  const broken: string[] = [];
  for (const [card, rs] of results) {
    for (const r of rs) {
      if (r.outcome === 'crash') broken.push(`${card}: CRASH — ${String(r.error).split('\n')[0]}`);
      // `illegal` means legalActions offered the play and apply() refused it —
      // the class of defect that made the round-4 "pass all" bug and the
      // round-2 attack bug, both of which reached a live game
      if (r.outcome === 'illegal') broken.push(`${card}: offered then REFUSED — ${r.error}`);
      if (r.outcome === 'stuck') broken.push(`${card}: the game reached a state with no legal action for anyone`);
    }
  }
  assert.deepEqual(broken.sort(), []);
});

// ── 3. NO EFFECT RESOLVES INTO SILENCE ──────────────────────────────────

/**
 * Effects that complete without saying anything, with the reason each is
 * tolerated. This is the Abduct list, and it is meant to shrink to nothing.
 *
 * It is deliberately NOT a `{ todo: true }` test: a todo can never fail, which
 * is exactly how Harbinger of Immolation stayed dead through two playtest
 * reports and a conceded game (see the head of card-ledger.ts). Every entry
 * here is instead an OPEN ITEM in `card-todo.ts`, and the assertion below
 * fails the moment one of them starts announcing itself, so a fix cannot land
 * without the entry being ticked off.
 */
// EMPTY, AND IT MUST STAY THAT WAY UNLESS SOMEBODY ARGUES A NEW ENTRY IN.
// It once carried Abduct (CARD-TODO #1), Divine Intervention (#2) and Immolate
// (#3). All three are fixed — each now announces the branch it used to fall
// through in silence — so the exemptions are gone and the assertion below is
// what catches them if they ever go quiet again. The MECHANISM stays: an entry
// here is a deliberate, cited decision, never a way to quiet a failure.
const SILENT_KNOWN: Record<string, string> = {};

test('no card effect resolves into silence — the Abduct assertion', () => {
  const problems: string[] = [];
  for (const [def, n] of silent) {
    const cards = owners.get(def)!;
    if (cards.every(c => c in SILENT_KNOWN)) continue;
    problems.push(
      `${cards.join('/')} resolved silently ${n}× (in: ${[...(silentWhere.get(def) ?? [])].join(', ')})`);
  }
  problems.sort();
  assert.deepEqual(problems, [],
    'these effects ran to completion and emitted nothing — the player sees the card '
    + 'leave the stack with no indication of what it did:\n  ' + problems.join('\n  ')
    + "\n\nAdd a g.ev('info', '<Card>: <why> — nothing happens.') to that path. "
    + '"Nothing happened" is a legitimate outcome; not SAYING so never is.');
});

test('the known-silent list is still accurate — tick an entry off when it is fixed', () => {
  const fixed: string[] = [];
  for (const [card, why] of Object.entries(SILENT_KNOWN)) {
    assert.ok(/CARD-TODO #\d+/.test(why), `${card}: a known-silent entry must cite its CARD-TODO id`);
    const defs = [...owners.keys()].filter(d => owners.get(d)!.includes(card));
    if (!defs.some(d => silent.has(d))) {
      fixed.push(`${card} no longer resolves silently — delete its SILENT_KNOWN entry and close its CARD-TODO item`);
    }
  }
  assert.deepEqual(fixed, []);
});

// ── 4. THE TALLY ────────────────────────────────────────────────────────

test('the drill reports honestly on its own reach', () => {
  const played = [...results.values()].filter(rs => rs.some(r => r.played)).length;
  const withEffect = [...results.values()].filter(rs => rs.some(r => r.effectEvents.length > 0)).length;
  const changed = [...results.values()].filter(rs => rs.some(r => r.changed.length > 0 || r.newEntities.length > 0)).length;
  console.log(`    drill: ${played}/${POOL.length} cards reached and played`);
  console.log(`    ${changed} of them changed the game state; ${withEffect} logged an effect`);
  console.log(`    effects driven to completion: ${completed.size}/${owners.size}`);
  // A FLOOR, not a percentage, and deliberately a modest one. The drill CASTS
  // each card; it does not activate every ability, fire every death trigger or
  // compose every graft, so it reaches fewer distinct EffectDefs than the fuzz
  // pass in 65-effect-conformance (~290) even though it reaches strictly more
  // CARDS (490/491, against the fuzzer's 281/424). The two nets are
  // complementary and neither subsumes the other — this number must not fall.
  assert.ok(completed.size >= 165,
    `only ${completed.size}/${owners.size} effects ran to completion — the drill has lost its reach`);
});
