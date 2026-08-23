/**
 * DOES THE CARD DO WHAT IT SAYS?
 *
 * The owner, 2026-08-23, on the first pass of the card drill:
 *
 *   "I don't just want cards to 'be played and do something'. They need to do
 *    what they're SUPPOSED to do."
 *
 * `81-card-drill` proves a card is reachable, runs and emits something. It
 * cannot tell "deals 3 damage" from "draws a card" — both satisfy "did
 * something". This file closes that: `claims.ts` reads the PRINTED text out of
 * printed.json and turns it into typed promises, the drill plays the card, and
 * each promise is checked against the engine's own event vocabulary
 * (`damage`, `draw`, `tokenCreated`, `negated`, `erased`, …) plus the state
 * delta for the clauses that are continuous rather than eventful.
 *
 * WHAT IT FOUND — AND WHAT BECAME OF IT
 *
 * A whole dead CLASS that neither the shape sweep nor the drill could see:
 * **"Erase me" was unimplemented on four of the six cards that print it.**
 * Collect Remains, Temporal Rift, Suspend and Skybreaker all printed a
 * self-erase and none of them erased anything. The two that already worked
 * were Spore of Regenesis (where erasing is a COST) and Zephyrzoa (in its
 * [Augment] box), which is why the detection below reads augment and graft
 * text — and, since Skybreaker, activation COSTS — as well as the spell
 * effect: a narrower check would have accused a working card.
 * The card-ledger's shape sweep could not see it because those runs contained
 * real, working code for their other half, and the drill could not see it
 * because the card did do *something*.
 *
 * It mattered in a real game rather than only on paper: the erased pile is a
 * zone cards leave the game through (R65), so a spell that should erase itself
 * and instead goes to the bin stays recurrable and keeps counting toward every
 * "cards in your bin" effect. Collect Remains is a bin-recursion spell that is
 * supposed to remove itself, which made it the worst of the four.
 *
 * All four were fixed under CARD-TODO #15. The class-level assertion at the
 * bottom of this file is kept, inverted to "nobody prints a self-erase without
 * one", so a new card that forgets the clause fails on arrival and a deleted
 * implementation fails as a regression. 89-self-erase.test.ts holds the
 * per-card behaviour.
 *
 * HONEST LIMITS, STATED UP FRONT
 *
 * This is a FLOOR, not a proof of correctness. A card that prints "deal 3
 * damage to target unit" and deals 3 to the WRONG unit passes here. What it
 * catches is the far commoner defect: a card that promises a specific,
 * countable thing and delivers nothing of the kind. Only UNCONDITIONAL claims
 * are required — a clause behind "When…", "if…", an activated ability's colon
 * or an `[Augment]` box may legitimately not fire on the drill's board, and
 * demanding those would produce a wall of false failures. The conditional ones
 * are counted out loud instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { drillCard, drillable } from './drill.ts';
import { claimsOf, EVIDENCE, STATE_EVIDENCE, rulesText, type Claim } from './claims.ts';
import { E } from '../src/engine.ts';
import type { GameState, Seat } from '../src/types.ts';

function lonelyBoard(s: GameState, seat: Seat): void {
  const e = new E(s);
  for (const b of ['Tidal Menace', 'The Foretold', 'Bubb', 'Curio Drifter']) {
    try { e.spawnUnit(seat, b, e.homeRegion(seat), {}); } catch { /* unregistered */ }
  }
  const p = s.players[seat]!;
  p.bin.push('Tidal Menace', 'The Foretold', 'Curio Drifter', 'Immolate');
  try { e.settle(); } catch { /* a spawn trigger may suspend */ }
}

const SCENARIOS: Parameters<typeof drillCard>[2][] = [
  { bait: true }, {}, { setup: lonelyBoard },
];

/** what the card was observed doing, across every board state */
interface Observed { types: Set<string>; changed: Set<string>; played: boolean }

function observe(card: string): Observed {
  const types = new Set<string>();
  const changed = new Set<string>();
  let played = false;
  for (const opts of SCENARIOS) {
    let r;
    try { r = drillCard(card, 900_000, opts); } catch { continue; }
    if (r.played) played = true;
    for (const t of r.effectTypes) types.add(t);
    for (const c of r.changed) changed.add(c);
    if (r.newEntities.length) types.add('spawned');
  }
  return { types, changed, played };
}

function met(c: Claim, o: Observed): boolean {
  if (EVIDENCE[c.kind].some(t => o.types.has(t))) return true;
  const st = STATE_EVIDENCE[c.kind];
  if (st === 'hand') return [...o.changed].some(x => x.startsWith('hand'));
  if (st === 'control') return [...o.changed].some(x => x.includes('control'));
  if (st === 'stats') return [...o.changed].some(x => x.includes('stats'));
  if (st === 'counters') return [...o.changed].some(x => x.includes('counters'));
  return false;
}

const POOL = allCardNames().filter(drillable);
const observations = new Map<string, Observed>();
const unmet = new Map<string, Claim[]>();

test('drive every card and check it against its printed promises', () => {
  for (const card of POOL) {
    const claims = claimsOf(card);
    if (!claims.length) continue;
    const o = observe(card);
    observations.set(card, o);
    const missing = claims.filter(c => !c.conditional && !met(c, o));
    if (missing.length) unmet.set(card, missing);
  }
  assert.ok(observations.size > 300, 'the semantic pass covers the pool');
});

/**
 * Every card whose unconditional promise the drill could not evidence, with
 * the reason. Two kinds live here and the difference is the whole point:
 *
 *   REAL   — the clause is not implemented. Each carries a CARD-TODO id.
 *   BOARD  — the clause is implemented but the drill's board cannot satisfy
 *            it (X resolves to 0, there are no mods to erase, both players
 *            have the same life). These are the limit of a generic driver,
 *            not defects, and each says which precondition is missing.
 *
 * The list is asserted to be EXACTLY right in both directions below, so a
 * card cannot quietly join it and an entry cannot outlive its reason.
 */
const KNOWN_UNMET: Record<string, string> = {
  // (The "Erase me" class — Collect Remains, Temporal Rift, Suspend — used to
  // head this list as REAL defects under CARD-TODO #15. They implement the
  // clause now: `ctx.eraseSelf()` redirects the spell's disposal to the erased
  // pile, so the drill observes the `erased` event and the entries are gone.
  // 89-self-erase.test.ts is what keeps them gone.)

  // ── BOARD: implemented, but the drill cannot create the precondition ──
  'Soul Siphon':
    'BOARD — "Create an X/X unit, where X is the life target player lost in this '
    + 'battle". No life has been lost on the drill\'s board, so X is 0 and creating '
    + 'nothing is correct. The card says so: "X = 0 — no unit created."',
  'Retribution Thing':
    'BOARD — X is "the life you have lost or gained in this battle", which is 0 here. '
    + 'The card announces it: "your life has not moved this battle — X is 0."',
  'Return to Nature':
    'BOARD — "Negate all effects. Erase all mods." The drill\'s board has no mods in '
    + 'play, and it announces the no-op rather than resolving in silence.',
  'Suppression Field':
    'BOARD — "Erase all of its mods and negate all of its effects" on a target that '
    + 'has neither. The attribute-stripping half IS observed.',
  'Containment Protocol':
    'BOARD — "Negate all activated and triggered effects". The bait on the stack is a '
    + 'SPELL effect, so there is correctly nothing of that kind to negate.',
  'Insatiable Want':
    'BOARD — "Each player with an even life total sacrifices a unit. Each player with '
    + 'an odd life total draws a card." Both players are on 30, so the sacrifice half '
    + 'fires and the draw half correctly does not.',
  'Calming Force':
    'BOARD — R100: "I can\'t be played from your hand", so it is never cast and its '
    + 'negate is never owed. Same exemption as UNREACHABLE in 81-card-drill.',
  Robot:
    'BOARD — "I spawn with X +1/+1 counters on me" is applied by the CREATING effect '
    + '(spawnUnit(..., { counters: X })), not by the token. The drill spawns it with '
    + 'X = 0. Already declared NOT_A_GAP in 71-card-ledger for the same reason.',
};

test('no card silently fails to deliver an unconditional printed promise', () => {
  const surprises: string[] = [];
  for (const [card, claims] of unmet) {
    if (card in KNOWN_UNMET) continue;
    surprises.push(`${card} — promises ${claims.map(c => `${c.kind}${c.n !== undefined ? `(${c.n})` : ''} "${c.raw}"`).join(', ')}`
      + `; printed: "${rulesText(card)}"`);
  }
  assert.deepEqual(surprises.sort(), [],
    'these cards print a promise that nothing in the game was observed delivering:\n  '
    + surprises.join('\n  ')
    + '\n\nEither the clause is unimplemented (open a CARD-TODO item and add it here as '
    + 'REAL), or the drill cannot create its precondition (add it here as BOARD, saying '
    + 'which precondition is missing). Do NOT widen claims.ts to make it disappear.');
});

test('every KNOWN_UNMET entry is still needed, and still says which kind it is', () => {
  const stale: string[] = [];
  for (const [card, why] of Object.entries(KNOWN_UNMET)) {
    if (!/^(REAL|BOARD)/.test(why)) stale.push(`${card}: must open with REAL or BOARD`);
    if (/^REAL/.test(why) && !/CARD-TODO #\d+/.test(why)) {
      stale.push(`${card}: a REAL entry must cite its CARD-TODO id`);
    }
    if (!unmet.has(card)) {
      stale.push(`${card} now delivers its promise — delete this entry`
        + (/^REAL/.test(why) ? ' and close its CARD-TODO item' : ''));
    }
  }
  assert.deepEqual(stale, []);
});

// ── the self-erase class, asserted directly ─────────────────────────────

test('the "Erase me" class is exactly the four cards CARD-TODO #15 names', () => {
  // Read off the printed text rather than the todo list, so a NEW card that
  // prints a self-erase and forgets to implement it fails here on arrival
  // instead of joining a class nobody is counting.
  const printsSelfErase = allCardNames().filter(n => /erase\s+(me|this spell|itself)/i.test(getCard(n).text ?? ''));
  const implementsIt = (n: string): boolean => {
    const c = getCard(n);
    const src = [c.spellEffect?.run, ...(c.abilities ?? []).map(a => a.effect?.run),
      ...(c.augmentText ?? []).map(a => a.effect?.run), c.graftEffect?.effect?.run]
      .map(f => (f ? f.toString() : '')).join('');
    // CARD-TODO #15: an "Erase me:" that is an activation COST is a DECLARATION
    // (`cost: { eraseSelf: true }`), not code inside a run(), so a source scan
    // alone cannot see it — Skybreaker would read as dead forever. Costs are
    // read too, on abilities and on [Augment]-box abilities alike.
    const costs = [...(c.abilities ?? []), ...(c.augmentText ?? [])]
      .some(a => a.type === 'activated' && a.cost.eraseSelf === true);
    return costs || /erase/i.test(src);
  };
  const dead = printsSelfErase.filter(n => !implementsIt(n)).sort();
  // NONE, as of CARD-TODO #15. This list used to read
  // ['Collect Remains', 'Skybreaker', 'Suspend', 'Temporal Rift'] — the four
  // cards that printed a self-erase and did not have one. All four implement
  // it now, by two different mechanisms: three are SPELLS redirecting their own
  // disposal (`ctx.eraseSelf()` → `StackItem.eraseSelf` → `E.dischargeItem`),
  // and Skybreaker's is an activation COST (`AbilityCost.eraseSelf`).
  //
  // The detection is unchanged and still reads augmentText and graftEffect as
  // well as the spell effect: Zephyrzoa prints "recall your bin and erase me"
  // in its [Augment] box and implements it there, and a narrower check would
  // accuse a working card. Skybreaker is the reason it also reads a cost —
  // see below.
  assert.deepEqual(dead, [],
    'the set of cards printing a self-erase with no erase in their code has changed. '
    + 'A card here either lost its implementation (a regression — 89-self-erase names '
    + 'which one) or is a NEW card that prints the clause and forgot to honour it.');
  // THE POSITIVE CONTROLS, so an empty `dead` cannot mean "the check broke".
  // The list must be non-empty and every card on it must be seen implementing
  // its clause — if `implementsIt` ever silently returned true for everything,
  // `dead` would be empty for the wrong reason and only this half would say so.
  assert.ok(printsSelfErase.length >= 6,
    `only ${printsSelfErase.length} cards read as printing a self-erase — the printed-text `
    + 'scan has lost its reach, so an empty `dead` above proves nothing');
  assert.ok(implementsIt('Spore of Regenesis'),
    'Spore of Regenesis erases as a COST and is the proof this detection works at all');
  assert.ok(implementsIt('Zephyrzoa'),
    'Zephyrzoa erases in its [Augment] box — the reason the check reads augmentText');
});

// ── the tally ───────────────────────────────────────────────────────────

test('the semantic pass reports honestly on what it could and could not check', () => {
  let total = 0, cond = 0;
  for (const card of POOL) {
    for (const c of claimsOf(card)) { total++; if (c.conditional) cond++; }
  }
  const req = total - cond;
  const unmetCount = [...unmet.values()].reduce((n, cs) => n + cs.length, 0);
  console.log(
    `    semantics: ${observations.size} cards carry ${total} printed promises `
    + `(${req} unconditional, ${cond} behind a trigger/condition/activation)`);
  console.log(
    `    ${req - unmetCount}/${req} unconditional promises were observed being delivered`);
  const real = Object.values(KNOWN_UNMET).filter(w => w.startsWith('REAL')).length;
  console.log(
    `    ${real} of the rest are REAL defects (each cites its CARD-TODO id); `
    + `the other ${Object.keys(KNOWN_UNMET).length - real} are board preconditions the drill cannot make`);
  // A floor on the promises the suite actually REQUIRES. It is far below the
  // 439 total on purpose: tightening what counts as conditional (the [Augment]
  // box, an activated ability's colon, a bracketed cost, a trailing "unless")
  // moved 316 claims out of the required set, and every one of those moves
  // removed a false failure rather than weakening the check.
  assert.ok(req >= 115, `only ${req} unconditional promises — the claim extractor has lost its reach`);
});
