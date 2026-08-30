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
 *
 * WHAT THE GATED COUNT IS FOR — CARD-TODO #49 (R171)
 *
 * "Counted out loud" was 316 promises in one heap, which is a number nobody
 * can plan against. Each gated claim now says WHY it is gated (`Claim.gate`),
 * and the tally prints the partition: 152 need a graft host, 110 need an event
 * fixture, 35 need an activation, 19 need a board. Stage 2 built the
 * activation — the drill pays the cost and takes `activateAbility` out of
 * `legalActions` like any other action — and all 35 are delivered.
 *
 * Evidence for a gated claim is ATTRIBUTED: it must come from a run that could
 * have satisfied the gate. That is a tightening. Scored the old loose way,
 * Oracle of the Flame's "Sacrifice me: Create a Fireball 1" was evidenced by
 * Oracle's own body arriving on a run where nothing was activated at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { drillCard, drillable, ownResolution } from './drill.ts';
import {
  claimsOf, EVIDENCE, STATE_EVIDENCE, rulesText, gateOf,
  TRIGGER_WORDS, CONDITION_WORDS, type Claim, type ClaimGate,
} from '../../ledgers/claims.ts';
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

/** does the card declare an activated ability of its OWN — one somebody can
 *  pay for and put on the stack once the body is in play? Distinguished from
 *  the `[Augment]`-box activated abilities (29 cards), which need a HOST
 *  before anybody can activate anything, and from the twelve SPELLS whose
 *  colon is an additional CAST cost (`[Switch1] /[Sacrifice a unit]: Draw a
 *  card`) paid during the cast rather than by a later activation. */
function hasOwnActivated(card: string): boolean {
  return (getCard(card).abilities ?? []).some(a => a.type === 'activated');
}

/** what the card was observed doing, across every board state */
interface Observed {
  types: Set<string>; changed: Set<string>; played: boolean;
  /** evidence from strictly AFTER one of this card's own abilities was
   *  activated, and only up to that activation resolving — see `activateTypes`
   *  in drill.ts for why the window has to be cut at both ends */
  actTypes: Set<string>; actChanged: Set<string>;
  /** the drill actually paid for and activated an ability of this card */
  activated: boolean;
  /** CARD-TODO #49 stage 4: evidence from a run in which the card was applied
   *  to a HOST as an `[Augment]` mod — the only state in which its `[Augment]`
   *  text box is live at all. Nothing else may evidence an augment-gated
   *  claim, for exactly the reason nothing but the activation window may
   *  evidence an activation-gated one. */
  augTypes: Set<string>; augChanged: Set<string>;
  /** the augment actually landed on a host */
  attached: boolean;
  /** CARD-TODO #49 stage 3: evidence from inside a resolution HEADED BY THIS
   *  CARD'S NAME — its own triggered abilities firing, wherever they were
   *  provoked from. See `ownResolution` in drill.ts for why the window is
   *  bound by the engine's own stack-item label and not by a stretch of time. */
  trigTypes: Set<string>; trigChanged: Set<string>;
  /** the fixtures the press run actually got through */
  fired: string[];
  /**
   * R211 / CARD-TODO #87: THE THIRD STATE. Runs that ended with one of this
   * card's activations still on the stack, so the drill could not close its
   * evidence window and this card's activation-gated promises are UNDECIDED
   * by that run rather than unobserved.
   *
   * It has to be printed, not swallowed. Folding an inconclusive run into
   * "observed" is the bug CT-87 fixes (the drill used to credit every event
   * from the stuck activation to the end of the run, and Slag Spewer read as
   * OBSERVED on somebody else's `erased` — CT-86). Folding it into "never
   * observed" is the opposite lie and would put a card in UNREACHED under a
   * precondition it does not actually lack.
   *
   * Measured over the whole pool at R211: 0 of 1296 runs. That zero is only
   * worth something because the channel has a positive control proving it can
   * be non-zero — `181-inconclusive-activation-window.test.ts` forces one and
   * shows the refusal. See docs/13-assessment.md §7.4.
   */
  inconclusive: { opts: string; reason: string; refused: string[] }[];
}

function observe(card: string): Observed {
  const types = new Set<string>();
  const changed = new Set<string>();
  const actTypes = new Set<string>();
  const actChanged = new Set<string>();
  const augTypes = new Set<string>();
  const augChanged = new Set<string>();
  const trigTypes = new Set<string>();
  const trigChanged = new Set<string>();
  let fired: string[] = [];
  const inconclusive: Observed['inconclusive'] = [];
  let played = false;
  let activated = false;
  let attached = false;
  const claims = claimsOf(card);
  const runs = [...SCENARIOS];
  // CARD-TODO #49 stage 2. The extra run is targeted rather than universal:
  // it is only meaningful where something can be activated, and running the
  // patient activate loop over all 347 cards would pay for 600 steps of
  // phase-walking on every card that has no ability at all.
  const wantsActivation = hasOwnActivated(card) || claims.some(c => c.gate === 'activated');
  if (wantsActivation) runs.push({ activate: true });
  // …and stage 4's, targeted the same way: only the 117 cards that print
  // something inside an `[Augment]` box have anything a host could unlock.
  const wantsHost = claims.some(c => c.gate === 'augment');
  if (wantsHost) runs.push({ augment: true, press: true });
  // …and stage 3's. A "When …" clause is owed only once its EVENT has
  // happened, and the drill stops the instant the card's own play resolves,
  // so before this the event simply never came: 54 of the 110 trigger-gated
  // promises and 12 of the 19 condition-gated ones had never been observed at
  // all. The press run keeps the game going and fires the fixture library at
  // the card — a unit dies, a card is trashed, a spell is played, a player
  // loses life, a counter is placed, damage lands, a battle is fought.
  const wantsEvent = claims.some(c => c.gate === 'trigger' || c.gate === 'condition');
  if (wantsEvent) runs.push({ press: true });
  for (const opts of runs) {
    let r;
    try { r = drillCard(card, 900_000, opts); } catch { continue; }
    // R211 / CT-87. Recorded BEFORE the branch below, because both the augment
    // run and the activate run open activation windows and either can end with
    // one still on the stack.
    if (r.actInconclusive) {
      inconclusive.push({
        opts: JSON.stringify(opts ?? {}),
        reason: r.actInconclusiveReason ?? 'maxSteps',
        refused: [...new Set(r.actInconclusiveTail)],
      });
    }
    if (opts?.augment) {
      if (r.attached) attached = true;
      for (const t of r.ownTypes) augTypes.add(t);
      for (const c of r.attachChanged) augChanged.add(c);
      for (const c of r.ownChanged) augChanged.add(c);
      // …and the ACTIVATION window, on the same terms stage 2 set: it opens at
      // the `activateAbility` action and closes when the item resolves. That
      // is wider than the `Resolving <card>` label window by exactly one
      // thing, and it is the thing these cards are about — an activation COST
      // is charged on the way to the stack, BEFORE the "Resolving" line, so a
      // label-bounded window can never see "Sacrifice another unit:",
      // "Discard a card:", "Gain 2 debt:" or "Erase me:" being paid. Seven
      // cards' costs are the promise (Soul Swallower, Scavenging Sentry,
      // Hearthwood Ancient, Pallid Gorger, Combustible Bogwalker, Lilbot,
      // No Hand Killer) and every one of them read as undelivered without it.
      for (const t of r.activateTypes) augTypes.add(t);
      for (const c of r.activateChanged) augChanged.add(c);
      // an `[Augment]` box that CREATES something is evidenced by the body
      // arriving, exactly as a cast is — but only inside the attached run,
      // and only for entities the augment's own resolution produced, which is
      // what `ownTypes` already carries as `tokenCreated`/`spawned`.
      continue;
    }
    if (opts?.press) fired = r.fired;
    for (const t of r.ownTypes) trigTypes.add(t);
    for (const c of r.ownChanged) trigChanged.add(c);
    if (r.played) played = true;
    for (const t of r.effectTypes) types.add(t);
    for (const c of r.changed) changed.add(c);
    if (r.newEntities.length) types.add('spawned');
    if (r.activated.length) activated = true;
    for (const t of r.activateTypes) actTypes.add(t);
    for (const c of r.activateChanged) actChanged.add(c);
  }
  return {
    types, changed, played, actTypes, actChanged, activated,
    augTypes, augChanged, attached, trigTypes, trigChanged, fired, inconclusive,
  };
}

function evidenced(c: Claim, types: Set<string>, changed: Set<string>): boolean {
  if (EVIDENCE[c.kind].some(t => types.has(t))) return true;
  const st = STATE_EVIDENCE[c.kind];
  if (st === 'hand') return [...changed].some(x => x.startsWith('hand'));
  if (st === 'control') return [...changed].some(x => x.includes('control'));
  if (st === 'stats') return [...changed].some(x => x.includes('stats'));
  if (st === 'counters') return [...changed].some(x => x.includes('counters'));
  return false;
}

/**
 * Was this promise observed being delivered — by a run that could actually
 * satisfy its GATE?
 *
 * The attribution is the point, and it is a TIGHTENING, not a loosening. The
 * evidence a claim is scored against used to be "anything this card was seen
 * doing in any run", which for a gated clause is barely evidence at all:
 * Oracle of the Flame prints "Sacrifice me: Create a Fireball 1", and the
 * arrival of Oracle's own body is a `spawned`, so its ability read as
 * delivered on a run where nobody activated anything. So:
 *
 *  · `augment` — the clause is live only on a HOST. No scenario grafts yet
 *    (CARD-TODO #49 stage 4), so NOTHING can evidence these and they are
 *    scored 0 rather than credited to the body's own doings.
 *  · `activated`, on a card with an ability of its own — only the window that
 *    opens at the activation and closes when it resolves.
 *  · `activated`, on a spell whose colon is a CAST cost — the cost is paid
 *    during the cast, so the ordinary post-play window is the right one.
 *  · `trigger` / `condition` / ungated — the ordinary post-play window.
 */
function met(c: Claim, o: Observed, card: string): boolean {
  if (c.gate === 'augment') return evidenced(c, o.augTypes, o.augChanged);
  if (c.gate === 'activated' && hasOwnActivated(card)) return evidenced(c, o.actTypes, o.actChanged);
  if (c.gate === 'trigger') return evidenced(c, o.trigTypes, o.trigChanged);
  return evidenced(c, o.types, o.changed);
}

const POOL = allCardNames().filter(drillable);
const observations = new Map<string, Observed>();
const unmet = new Map<string, Claim[]>();
/** every GATED promise that no run could evidence, by gate — CARD-TODO #49 */
const unobserved = new Map<ClaimGate, { card: string; claim: Claim }[]>();
/** gate → [observed, total] */
const partition = new Map<ClaimGate | 'OWED', [number, number]>();

test('drive every card and check it against its printed promises', () => {
  for (const card of POOL) {
    const claims = claimsOf(card);
    if (!claims.length) continue;
    const o = observe(card);
    observations.set(card, o);
    const missing = claims.filter(c => !c.conditional && !met(c, o, card));
    if (missing.length) unmet.set(card, missing);
    for (const c of claims) {
      const g = c.gate ?? 'OWED';
      const row = partition.get(g) ?? [0, 0];
      row[1]++;
      if (met(c, o, card)) row[0]++;
      else if (c.gate) (unobserved.get(c.gate) ?? unobserved.set(c.gate, []).get(c.gate)!).push({ card, claim: c });
      partition.set(g, row);
    }
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

// ── CARD-TODO #49 stage 1: WHY each gated promise is gated ──────────────

/**
 * THE BLIND-CHECK ON THE PARTITION.
 *
 * Splitting `conditional` into four named gates is only safe if it is exactly
 * that — a split. If a future edit widened `TRIGGER_WORDS` or dropped a
 * predicate out of `gateOf`, claims would quietly move from "gated" to "owed"
 * (a wall of false failures) or, far worse, from "owed" to "gated", which is
 * the failure mode CARD-TODO #49 warns about twice: the unchecked count going
 * down because the EXTRACTOR got weaker rather than because coverage grew.
 *
 * So the OLD boolean is recomputed here from first principles — the same five
 * predicates, written out, in the order the pre-partition code used — and
 * asserted to agree with `gate !== null` on every claim in the pool.
 *
 * ⚠ THE ALTERNATION BELOW IS COPIED OUT ON PURPOSE and must never be rewritten
 * as `TRIGGER_WORDS.test(head) || CONDITION_WORDS.test(head)`. The first cut of
 * this test did exactly that, and it was BLIND: a deliberate `deals|` spliced
 * into `TRIGGER_WORDS` changed both the thing under test and the thing testing
 * it, and the suite stayed green. A reference implementation that imports the
 * value it is checking is not a reference implementation.
 */
const OLD_CONDITION_RE =
  /\b(when|whenever|if|after|unless|may|instead|as long as|while|at the end|at the start|each turn|would)\b/;

function oldConditional(sentence: string, upto: number, fullText: string, at: number): boolean {
  const head = sentence.slice(0, upto).toLowerCase();
  const whole = sentence.toLowerCase();
  if (/\b(unless|up to|if )\b/.test(whole)) return true;
  if (/\[augment\]/i.test(fullText.slice(0, at))) return true;
  if (whole.includes(':') || fullText.slice(0, at).includes(':')) return true;
  const open = fullText.lastIndexOf('[', at);
  const close = fullText.lastIndexOf(']', at);
  if (open > close) return true;
  return OLD_CONDITION_RE.test(head);
}

test('the gate partition covers exactly the claims the old boolean called conditional', () => {
  // THE UNION OF THE TWO WORD LISTS MUST STILL BE THE ONE ALTERNATION THEY
  // WERE SPLIT OUT OF. Read structurally, off the regex sources, because the
  // per-claim check below can only see words this pool happens to print: a
  // word ADDED to TRIGGER_WORDS that no card uses would sail through it, and
  // would then start silently re-gating claims the day a card prints it.
  const words = (re: RegExp): string[] =>
    (/\(([^)]*)\)/.exec(re.source)?.[1] ?? '').split('|').filter(Boolean).sort();
  assert.deepEqual(
    [...words(TRIGGER_WORDS), ...words(CONDITION_WORDS)].sort(), words(OLD_CONDITION_RE),
    'TRIGGER_WORDS ∪ CONDITION_WORDS is no longer exactly the alternation they were split '
    + 'out of. A word added to either one re-gates claims; a word dropped un-gates them.');
  for (const w of words(OLD_CONDITION_RE)) {
    assert.ok(TRIGGER_WORDS.test(` ${w} `) !== CONDITION_WORDS.test(` ${w} `),
      `"${w}" must be in exactly one of TRIGGER_WORDS / CONDITION_WORDS`);
  }
  const disagreements: string[] = [];
  for (const card of POOL) {
    const text = rulesText(card);
    for (const c of claimsOf(card)) {
      const at = text.indexOf(c.raw);
      if (at < 0) continue;
      const start = text.lastIndexOf('.', at) + 1;
      const endDot = text.indexOf('.', at + c.raw.length);
      const sentence = text.slice(start, endDot === -1 ? text.length : endDot + 1);
      const old = oldConditional(sentence, at - start, text, at);
      if (old !== (gateOf(sentence, at - start, text, at) !== null)) {
        disagreements.push(`${card}: "${c.raw}" — old=${old}, gate=${gateOf(sentence, at - start, text, at)}`);
      }
    }
  }
  assert.deepEqual(disagreements, [],
    'gateOf() no longer partitions the SAME set the boolean did. Either a predicate was '
    + 'dropped (claims moved to "owed") or one was widened (claims moved out of the required '
    + 'set) — the second is how CARD-TODO #49 gets closed by accident instead of by work.');
});

test('the gate partition keeps its floor in every category', () => {
  const at = (g: ClaimGate) => partition.get(g)?.[1] ?? 0;
  // FLOORS, the way `req >= 115` floors the unconditional count. Measured
  // 2026-08-25: augment 152, trigger 110, activated 35, condition 19, owed 123
  // — 439 promises over 347 cards. These are set a little below the measured
  // values so that adding cards or refining a pattern is free, and hollowing
  // out a category is not.
  assert.ok(at('augment') >= 140, `only ${at('augment')} [Augment]-box promises — the augment scan lost reach`);
  assert.ok(at('trigger') >= 100, `only ${at('trigger')} trigger-gated promises — the trigger scan lost reach`);
  assert.ok(at('activated') >= 30, `only ${at('activated')} activation-gated promises — the colon/cost scan lost reach`);
  assert.ok(at('condition') >= 15, `only ${at('condition')} condition-gated promises — the condition scan lost reach`);
  const cond = (['augment', 'trigger', 'activated', 'condition'] as ClaimGate[])
    .reduce((n, g) => n + at(g), 0);
  assert.ok(cond >= 300,
    `only ${cond} gated promises (was 316) — CARD-TODO #49's denominator has SHRUNK. That is `
    + 'the one way this ticket must never be closed: the number is meant to fall because more '
    + 'promises are observed, never because fewer are extracted.');
});

// ── CARD-TODO #49 stage 2: the activated abilities, driven ──────────────

/**
 * Cards whose activation-gated promise the drill still cannot evidence. EMPTY
 * as of stage 2 — all twelve cards that carry an activated ability of their own
 * AND print a countable promise behind it deliver what the far side of their
 * colon says, and so do the twelve spells whose colon is a cast cost.
 *
 * An entry here means one of two things and must say which: REAL (the ability
 * is not implemented — cite a CARD-TODO id) or BOARD (implemented, but the
 * drill cannot make the ability legal or cannot pay its cost).
 */
const KNOWN_UNACTIVATED: Record<string, string> = {};

test('every activation-gated promise is delivered when the drill pays and activates', () => {
  const surprises: string[] = [];
  for (const { card, claim } of unobserved.get('activated') ?? []) {
    if (card in KNOWN_UNACTIVATED) continue;
    surprises.push(`${card} — promises ${claim.kind}${claim.n !== undefined ? `(${claim.n})` : ''} `
      + `"${claim.raw}" behind an activation; the drill ${observations.get(card)?.activated
        ? 'DID activate an ability of this card and saw no such thing'
        : 'could not activate anything on this card'}; printed: "${rulesText(card)}"`);
  }
  assert.deepEqual(surprises.sort(), [],
    'these cards print a promise behind an activated ability or a paid cost and nothing '
    + 'delivered it:\n  ' + surprises.join('\n  '));

  // THE POSITIVE CONTROLS. An empty `surprises` is worth nothing unless the
  // drill really did pay for and resolve abilities — a broken `activate` loop
  // that activated NOTHING would leave `actTypes` empty, `met` false and the
  // list full, so this half guards the opposite blindness: an attribution that
  // silently fell back to the loose whole-run evidence and passed everything.
  // 12, not 13: thirteen cards declare an activated ability of their own, but
  // The Bonesculptor's ("You may play one unit with no abilities from your bin
  // each deployment") prints no countable promise, so it carries no claims and
  // never reaches `observations` at all.
  const activatedCards = [...observations].filter(([, o]) => o.activated).map(([n]) => n);
  assert.ok(activatedCards.length >= 12,
    `the drill activated an ability on only ${activatedCards.length} cards — it was 12 when `
    + 'stage 2 landed, so the activation path has stopped firing and the green above is empty');
  for (const control of ['Oracle of the Flame', 'Glararr', 'Prismatic Observer']) {
    assert.ok(activatedCards.includes(control),
      `${control} is a positive control for the activation path and was not activated`);
  }
  // and the window must be CUT: Oracle of the Flame's own body arriving is a
  // `spawned`, so an uncut window would evidence "Create a Fireball 1" on a
  // run where nothing was activated at all
  const oracle = observations.get('Oracle of the Flame')!;
  assert.ok(!oracle.actTypes.has('phase'),
    'the post-activation evidence window is not being closed when the activation resolves — '
    + 'it has swallowed a phase change, so it is collecting the rest of the game');
});

// ── CARD-TODO #49 stages 3 & 4: the fixtures and the host ───────────────

import { UNREACHED } from '../../ledgers/unreached.ts';


test('every gated promise the fixtures cannot reach is NAMED, with the precondition that is missing', () => {
  // The shape CARD-TODO #49 asks to close in. Asserted in BOTH directions, the
  // way KNOWN_UNMET is: a card cannot quietly join the list, and an entry
  // cannot outlive its reason.
  const surprises: string[] = [];
  for (const g of ['augment', 'trigger', 'condition'] as ClaimGate[]) {
    for (const { card, claim } of unobserved.get(g) ?? []) {
      if (card in UNREACHED) continue;
      // R211 / CT-87: say WHICH of the three states this is. A card whose run
      // ended mid-activation has an UNDECIDED promise, not an unreached one,
      // and telling the reader "no fixture reached it" would send them to
      // build a board precondition that is already being built.
      const inc = observations.get(card)?.inconclusive ?? [];
      surprises.push(`${card} — ${g}-gated ${claim.kind}`
        + `${claim.n !== undefined ? `(${claim.n})` : ''} "${claim.raw}"; printed: "${rulesText(card)}"`
        + (inc.length
          ? `\n    ⚠ INCONCLUSIVE, not unreached (CT-87): ${inc.length} run(s) ended with an `
            + `activation still on the stack (${inc.map(i => i.reason).join(', ')}). Raise `
            + `maxSteps for this card before adding it to UNREACHED.`
          : ''));
    }
  }
  assert.deepEqual([...new Set(surprises)].sort(), [],
    'these cards print a gated promise that no fixture in the library reached, and nothing says '
    + 'why:\n  ' + [...new Set(surprises)].sort().join('\n  ')
    + '\n\nEither a fixture stopped firing (a regression — the floors below should have caught it), '
    + 'or the clause is unimplemented (open a CARD-TODO item and add it here as REAL), or the drill '
    + 'cannot build its precondition (add it here saying WHICH one). Do NOT widen EVIDENCE to make '
    + 'it disappear.');

  const stale: string[] = [];
  const stuck = new Set<string>();
  for (const g of ['augment', 'trigger', 'condition'] as ClaimGate[]) {
    for (const { card } of unobserved.get(g) ?? []) stuck.add(card);
  }
  for (const [card, why] of Object.entries(UNREACHED)) {
    if (!/^(REAL|REGION|EVENTLESS|BOARD|CHOICE|VOCAB|EXTRACT)/.test(why)) {
      stale.push(`${card}: must open with REAL / REGION / EVENTLESS / BOARD / CHOICE / VOCAB / EXTRACT`);
    }
    if (/^REAL/.test(why) && !/CARD-TODO #\d+/.test(why)) {
      stale.push(`${card}: a REAL entry must cite its CARD-TODO id`);
    }
    if (!stuck.has(card)) stale.push(`${card} is now observed delivering — delete this entry`);
  }
  assert.deepEqual(stale, []);
});

/**
 * THE BLIND-CHECK ON THE ATTRIBUTION SEAM.
 *
 * `ownResolution` is what stages 3 and 4 rest on: it decides which slice of the
 * event stream is THIS CARD'S OWN ability firing. Ask the question this repo
 * has learned to ask — *what would it look like if it were blind?* — and there
 * are two answers, in opposite directions:
 *
 *   ALWAYS FALSE — nothing is ever attributed, every gated promise reads as
 *     undelivered, and the count collapses. Loud. The floors below catch it.
 *   ALWAYS TRUE — every event in the game is attributed to whatever card is
 *     under test, and every claim of every kind reads as delivered. SILENT,
 *     and it is the exact failure the ticket warns about twice.
 *
 * So both directions are measured, against a REFERENCE WRITTEN OUT HERE from
 * the label grammar in the engine (`queueTrigger` builds `${card}: ${label}`,
 * `doActivateAbility` builds `${card}: ${label}` or `${card} (on ${face}): …`,
 * `resolveItem` logs `Resolving ${label}:`) rather than by importing the thing
 * under test. Stage 2's own agent caught its first reference implementation
 * importing the regexes it was checking, which moved the test and the tested
 * together.
 */
function ownReference(msg: string, card: string): boolean {
  const HEAD = 'Resolving ';
  if (!msg.startsWith(HEAD)) return false;
  const label = msg.slice(HEAD.length).replace(/:$/, '');
  if (label === card) return false;                    // the card's own CAST
  const rest = label.startsWith(card) ? label.slice(card.length) : null;
  if (rest === null) return false;
  return rest.startsWith(': ') || rest.startsWith(' (on ');
}

test('the own-resolution window can SEE, and can also say NO — measured in both directions', () => {
  // 1. the hand-written cases, each one a mistake that was actually available
  assert.equal(ownResolution('Resolving Immolate:', 'Immolate'), false,
    "a card's own CAST is not its own ABILITY. Letting it count is the Oracle-of-the-Flame bug: "
    + 'the body arriving evidences the clause behind the gate.');
  assert.equal(ownResolution('Resolving Geode: Create a Crystal 1:', 'Geode'), true,
    'a triggered ability logs `Resolving <card>: <label>:` and must be attributed');
  assert.equal(ownResolution('Resolving Skybreaker (on Tidal Menace): Negate all spell effects:',
    'Skybreaker'), true,
    'an [Augment]-donated ability logs `Resolving <card> (on <host>): …` — stage 4 rests on this');
  assert.equal(ownResolution('Resolving Wispweaver: something:', 'Wisp'), false,
    '`Resolving Wisp` is a PREFIX of `Resolving Wispweaver: …` — a bare startsWith would attribute '
    + "one card's trigger to another card entirely");
  assert.equal(ownResolution('Player 1 draws 1.', 'Immolate'), false);

  // 2. the same question asked of every `Resolving` line a real run produces,
  //    against the independent reference above
  const lines: string[] = [];
  const disagreements: string[] = [];
  for (const card of ['Geode', 'Immolate', 'Oracle of the Flame', 'Megadeath', 'Blightmound',
    'Ghord', 'Sporebloom Siren', 'Muck Rummager', 'Splort', 'Rune Channeler',
    'Bellowing Boulder', 'Palewing']) {
    const r = drillCard(card, 900_000, { press: true });
    for (const msg of r.events) {
      if (!msg.startsWith('Resolving ')) continue;
      lines.push(msg);
      if (ownResolution(msg, card) !== ownReference(msg, card)) {
        disagreements.push(`${card}: "${msg}" — ownResolution=${ownResolution(msg, card)}`);
      }
    }
  }
  assert.ok(lines.length >= 25,
    `only ${lines.length} "Resolving" lines harvested — this measurement has lost its reach and `
    + 'would agree vacuously');
  assert.deepEqual(disagreements, [],
    'ownResolution no longer agrees with the engine label grammar:\n  ' + disagreements.join('\n  '));

  // 3. THE POSITIVE CONTROL FOR "ALWAYS TRUE". Immolate is a plain spell —
  //    "[Sacrifice a unit] Draw a card" — with no triggered ability, no
  //    activated ability and no [Augment] box, so its own-window MUST be empty
  //    while its ordinary post-play window is not.
  const immolate = observations.get('Immolate');
  assert.ok(immolate, 'Immolate must be in the semantic pass for this control to mean anything');
  assert.deepEqual([...immolate.trigTypes], [],
    'Immolate has no ability of its own, so nothing may be attributed to one. A non-empty window '
    + 'here means the attribution has gone ALWAYS-TRUE and every gated count above is inflated.');
  assert.ok(immolate.types.has('draw'),
    'and its ordinary post-play window still sees the draw it prints — so the empty own-window '
    + 'above is a real distinction and not a dead observation');
});

test('the fixture library actually fires, and the augment actually lands on a host', () => {
  // The positive controls for stages 3 and 4. Without these, an empty
  // `surprises` above is worth nothing: a press run that fired no fixture and
  // an augment run that never attached would produce exactly the same green.
  const pressed = drillCard('Megadeath', 900_000, { press: true });
  assert.ok(pressed.fired.length >= 29,
    `the press run got through only ${pressed.fired.length} fixtures (31 exist, and 31 fired when `
    + 'R199 landed) — the beat scheduler has stopped firing and stage 3 is measuring nothing');
  for (const beat of ['die', 'despawn', 'trash', 'allySpawn', 'damage', 'counters']) {
    assert.ok(pressed.fired.includes(beat), `the "${beat}" fixture never fired`);
  }
  // R199: …and the beats that wait for the card to be STANDING IN the battle
  // fired there, in a region that is not its own. Without this, the five
  // REGION-family entries deleted from UNREACHED above would come back as
  // surprises and nothing here would say why. 170-battle-position-promises
  // holds the per-card assertions; this is the aggregate guard.
  assert.ok(pressed.inBattleBeats.length >= 5,
    `only ${pressed.inBattleBeats.length} beats fired while Megadeath stood in the battle — the `
    + '`inBattle` pin has stopped firing and the R12 family is dark again');
  assert.ok(pressed.inBattleBeats.some(b => !b.includes(':home=0:at=0:')),
    'every in-battle beat fired in the seat\'s OWN home region, so no attacking position was '
    + 'ever reached — the pin has degenerated into "the battle phase", which is exactly the bug '
    + 'R199 fixed');
  assert.ok(pressed.ownTypes.includes('tokenCreated'),
    'Megadeath prints "When I attack, create a Poison 5" and the press run must see it attack — '
    + 'if the destructive beats stop being held back until two battles have finished, the card is '
    + 'killed before it ever swings and 38 trigger promises go dark at once');

  const hosted = drillCard('Astralith', 900_000, { augment: true, press: true });
  assert.ok(hosted.attached, 'Astralith must land on a host — stage 4 measures nothing otherwise');
  assert.ok(hosted.host !== undefined && hosted.host !== 'Astralith',
    'the host is another card, not the augment itself');
  assert.ok(hosted.activated.length > 0,
    'Astralith prints "[Augment] [three]: put a +1/+1 counter on target unit" — its ability is '
    + 'offered on the HOST with `via: { mod }`, and this is the only path that reaches it');

  // and the CONTINUOUS half, which has no event at all and is measured by
  // taking the mod out of the game and reading the stats again
  const golem = drillCard('Aetherflux Golem', 900_000, { augment: true, press: true });
  assert.ok(golem.attachChanged.includes('unit stats/attributes changed'),
    'Aetherflux Golem prints "[Augment] I gain +2/+2" — a layer, not an action, so the ONLY '
    + 'evidence it can ever have is that removing the mod changes somebody\'s power/defence');
  const rubbish = drillCard('A Pile of Rubbish', 900_000, { augment: true, press: true });
  assert.deepEqual(rubbish.attachChanged.filter(c => c.includes('stats')), [],
    'A Pile of Rubbish\'s [Augment] box is a TRIGGER ("when I die, draw a card") and grants no '
    + 'stats. Reading a stat change here means the continuous check has gone always-true — which '
    + 'it did once, because every augment makes its host {Unstable} and the first version compared '
    + 'attributes as well as numbers.');
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
  // ── UNITS. These two lines used to disagree without saying so ─────────
  // `unmetCount` counts CLAIMS (9); `KNOWN_UNMET` is keyed by CARD (8). The
  // old output printed "114/123" and then accounted for "0 REAL + 8 BOARD",
  // and a reader — the orchestrator, on this very ticket — went looking for a
  // tenth card that does not exist. One card carries TWO unmet claims:
  // Suppression Field, whose "erase all of its mods and negate all of its
  // effects" is two promises against a target that has neither. Both units are named now, and the relationship between them
  // is ASSERTED below rather than left to be inferred from a printed number,
  // because an unstated invariant is how this repo's tallies have rotted.
  const realCards = Object.entries(KNOWN_UNMET).filter(([, w]) => w.startsWith('REAL'));
  const boardCards = Object.entries(KNOWN_UNMET).filter(([, w]) => !w.startsWith('REAL'));
  const claimsIn = (cards: [string, string][]) =>
    cards.reduce((n, [c]) => n + (unmet.get(c)?.length ?? 0), 0);
  console.log(
    `    the other ${unmetCount} unconditional promises are carried by `
    + `${unmet.size} cards: ${realCards.length} cards (${claimsIn(realCards)} claims) are REAL `
    + `defects, each citing its CARD-TODO id; ${boardCards.length} cards `
    + `(${claimsIn(boardCards)} claims) are board preconditions the drill cannot make`);

  // EVERY unmet claim belongs to a card that KNOWN_UNMET accounts for. The
  // `no card silently fails…` test already refuses an unlisted CARD; this says
  // the CLAIM arithmetic closes too, so the two printed lines can be added up.
  assert.equal(unmet.size, Object.keys(KNOWN_UNMET).length,
    'the cards with an unmet unconditional promise and the KNOWN_UNMET keys have diverged');
  assert.equal(claimsIn(realCards) + claimsIn(boardCards), unmetCount,
    `${unmetCount} unmet claims but only ${claimsIn(realCards) + claimsIn(boardCards)} of them `
    + 'belong to a KNOWN_UNMET card — the honesty tally no longer adds up');

  // ── CARD-TODO #87 / R211: THE THIRD STATE, printed whether or not it is 0 ──
  // A run that ended with an activation still on the stack knows nothing about
  // what that activation delivered. Before R211 the drill credited it with
  // every event from the stuck activation to wherever the run stopped, so an
  // inconclusive run read as a POSITIVE one — that is how Slag Spewer came to
  // be scored on an `erased` its host's death produced (CT-86). Now it is
  // refused, and refusals are counted here so the refusal is visible rather
  // than a silent subtraction.
  const incCards = [...observations].filter(([, o]) => o.inconclusive.length);
  const incRuns = incCards.reduce((n, [, o]) => n + o.inconclusive.length, 0);
  console.log(
    `    INCONCLUSIVE (CT-87): ${incRuns} run(s) across ${incCards.length} card(s) ended with an `
    + 'activation still on the stack, so their activation-gated promises are UNDECIDED — neither '
    + 'observed nor never-observed');
  for (const [card, o] of incCards) {
    for (const i of o.inconclusive) {
      console.log(`      ${card} ${i.opts} — ${i.reason}; refused [${i.refused.join(', ')}]`);
    }
  }

  // …and a FLOOR in the honest direction: here a number going UP is the bad
  // news. Measured 0 of 1296 runs at R211, over the whole pool, in exactly
  // these scenarios. A non-zero means some card's activation-gated promise
  // went UNDECIDED — raise `maxSteps` for that run until the window closes, or
  // say in UNREACHED that the drill cannot finish the activation. Do NOT make
  // this pass by crediting the tail again; that is CT-87.
  assert.equal(incRuns, 0,
    `${incRuns} drill run(s) ended with an activation still on the stack, so the promises behind `
    + 'those activations are undecided and the gated counts below are missing evidence they '
    + 'cannot go and get. Named above. The refusal itself is controlled for in '
    + '181-inconclusive-activation-window.test.ts.');

  // ── CARD-TODO #49: the gated promises, partitioned by WHAT THEY NEED ──
  // Until stage 1 these were one undifferentiated heap of 316 and the ticket
  // could not be planned against. The partition says which stage owns which
  // slice, and the per-gate delivered count says how far each has got.
  const GATE_NEEDS: Record<ClaimGate, string> = {
    augment: 'an [Augment] HOST           (stage 4 — done)',
    trigger: 'a fixture firing the EVENT  (stage 3 — done)',
    activated: 'somebody to PAY & ACTIVATE  (stage 2 — done)',
    condition: 'a BOARD meeting the clause  (stage 3 — done)',
  };
  let gTot = 0, gHit = 0;
  console.log('    gated promises, by what would have to happen before they are owed:');
  for (const g of ['augment', 'trigger', 'activated', 'condition'] as ClaimGate[]) {
    const [hit, tot] = partition.get(g) ?? [0, 0];
    gTot += tot; gHit += hit;
    console.log(`      ${g.padEnd(10)} ${String(tot).padStart(3)} — needs ${GATE_NEEDS[g]}  ·  ${hit} observed delivered`);
  }
  console.log(
    `    ${gHit}/${gTot} gated promises were observed being delivered by a run that could `
    + `satisfy their gate; ${gTot - gHit} have still never been observed`);
  // ⚠ R217: PRINT THE UNIT, BECAUSE THIS LINE HAS BEEN MIS-SUMMARISED THREE
  // TIMES. The number above counts CLAIMS; `UNREACHED` is keyed by CARD, and
  // several cards carry more than one unobserved claim. Every hand-written
  // summary of this tally so far — docs/13-assessment.md twice, and a
  // class-widening audit once — silently switched between the two and
  // published a card count that was really a claim count, or a partition that
  // did not sum to its own total. The suite was right every time; the prose
  // was not. So the partition is printed HERE, derived, next to the number it
  // partitions, and anyone quoting it can copy both units instead of inferring
  // one. docs/13 §5: a number nobody re-derives decays no matter who handles it.
  const opener = (why: string): string => /^([A-Z]+)/.exec(why)?.[1] ?? '??';
  const byOpener = new Map<string, number>();
  for (const why of Object.values(UNREACHED)) {
    const k = opener(why);
    byOpener.set(k, (byOpener.get(k) ?? 0) + 1);
  }
  const parts = [...byOpener].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  console.log(
    `    those ${gTot - gHit} CLAIMS are spread over ${Object.keys(UNREACHED).length} CARDS, `
    + `named individually in UNREACHED: ${parts.map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  // The delivered count is floored too, in the other direction: coverage that
  // has been paid for once must not be lost silently.
  // FLOORS ON THE DELIVERED COUNTS, one per gate, raised as each stage paid
  // for them. Measured 2026-08-25 at the end of R180: augment 129, trigger 86,
  // activated 35, condition 14 — 264 of 316. Measured 2026-08-26 at the end of
  // R199, once the beats learned to wait for the card to be STANDING IN the
  // battle: augment 137, trigger 92, activated 35, condition 14 — 278 of 316.
  // Set a little below so that a refinement is free and a silent give-back is
  // not.
  const hit = (g: ClaimGate) => partition.get(g)?.[0] ?? 0;
  assert.ok(hit('augment') >= 130,
    `only ${hit('augment')} [Augment] promises observed delivered (was 137 after R199, 129 when `
    + 'stage 4 landed, and 0 before it) — the host path has regressed');
  assert.ok(hit('trigger') >= 85,
    `only ${hit('trigger')} trigger-gated promises observed delivered (was 92 after R199, 86 when `
    + 'stage 3 landed) — a fixture has stopped firing, or the destructive beats are no longer '
    + 'being held back until two battles have finished');
  assert.ok(hit('condition') >= 12,
    `only ${hit('condition')} condition-gated promises observed delivered (was 14)`);
  assert.ok(gHit >= 270,
    `only ${gHit} gated promises observed delivered (98 when stage 2 landed, 264 at the end of `
    + 'R180, 278 at the end of R199) — coverage has regressed');
  assert.equal(partition.get('activated')?.[0], partition.get('activated')?.[1],
    'stage 2 delivered EVERY activation-gated promise; one has stopped being delivered');
  // A floor on the promises the suite actually REQUIRES. It is far below the
  // 439 total on purpose: tightening what counts as conditional (the [Augment]
  // box, an activated ability's colon, a bracketed cost, a trailing "unless")
  // moved 316 claims out of the required set, and every one of those moves
  // removed a false failure rather than weakening the check.
  assert.ok(req >= 115, `only ${req} unconditional promises — the claim extractor has lost its reach`);
});
