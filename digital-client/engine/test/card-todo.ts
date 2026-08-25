/**
 * THE CARD TODO — one tickable list of everything known to be wrong with the
 * cards, in one place, with the evidence that found it.
 *
 * WHY THIS EXISTS
 *
 * The owner, 2026-08-23, commissioning the sweep this file came out of:
 *
 *   "I would like for you to work through every single card in the digital
 *    client game and design AT LEAST one test for it … This full testing suite
 *    should reveal more cards and effects that aren't functional. Don't fix
 *    them quite yet, focus on capturing all the issues (including unanswered
 *    user reports) in a todo repository that can be ticked off as issues get
 *    addressed and fixed."
 *
 * So this is the capture, not the fix. Nothing in this file changes engine
 * behaviour.
 *
 * WHAT IS AND IS NOT IN HERE
 *
 * This is an INDEX of open work, and it deliberately does not restate what
 * another ledger already owns:
 *
 *   · `card-ledger.ts`     — the 28 cards with a printed clause that does
 *                            nothing. Referenced by CT-8, not copied.
 *   · `playtest-ledger.ts` — every owner bug report, one row each (the tally
 *                            line in 83-card-todo.test.ts reads the ledger
 *                            LIVE — a count typed here would only rot). Any
 *                            report still `live` there is carried here as its
 *                            own CT entry (CT-10..CT-14 were that batch), so
 *                            "unanswered user reports" and "cards found
 *                            broken by testing" live in ONE list, which is
 *                            what was asked for.
 *
 * THE RULE THAT KEEPS IT HONEST
 *
 * Every open entry carries a `proof` — a predicate that returns TRUE while the
 * bug is still there. `83-card-todo.test.ts` asserts every open item's proof
 * still holds, so the moment somebody fixes one, the suite FAILS and names the
 * item to tick off. That is the opposite of a `{ todo: true }` test, which can
 * never fail and is exactly how Harbinger of Immolation stayed dead through two
 * playtest reports and a conceded game (see the head of card-ledger.ts).
 *
 * An entry with no machine-checkable proof sets `proof: null` and MUST say in
 * `verify` how a human checks it. Those are the entries most likely to rot, so
 * the test counts them out loud.
 */

export type TodoArea =
  /** a specific card does not do what it prints */
  | 'card'
  /** an attribute is not honoured everywhere it should be */
  | 'attribute'
  /** an engine-wide seam is missing, and cards are parked on it */
  | 'engine'
  /** the UI, not the rules */
  | 'client'
  /** the tests themselves do not cover something they claim to */
  | 'coverage';

export type TodoSeverity =
  /** silently produces a WRONG game outcome, or makes a card unusable */
  | 'blocker'
  /** the card works but misreports, or a whole mechanic is absent */
  | 'major'
  /** cosmetic, or an edge case a real game is unlikely to reach */
  | 'minor';

export interface TodoEntry {
  /** stable id — cite it in commits and in code comments ("CARD-TODO #3") */
  id: number;
  area: TodoArea;
  severity: TodoSeverity;
  /** the card(s) this is about, if it is card-specific */
  cards?: string[];
  title: string;
  /** what is actually wrong, with the printed clause quoted where relevant */
  detail: string;
  /** how it was found — a drill scenario, a probe, a report id, a ruling */
  evidence: string;
  /** what a fix has to do, concretely enough to start from */
  fix: string;
  /** true WHILE the bug is present. Null when nothing can check it. */
  proof: null | (() => boolean);
  /** required when proof is null: how a human confirms it by hand */
  verify?: string;
  /** for an item that came from an owner bug report: its id in
   *  playtest-ledger.ts / playtest-issues.snapshot.jsonl */
  reportId?: number;
  /**
   * The test(s) that keep this fixed, each `file::substring-of-the-test-name`.
   * REQUIRED once `status` is 'done', and the substring must appear in a real
   * `test('...')` title in that file — 83-card-todo.test.ts checks both.
   *
   * This is the same rule `playtest-ledger.ts` runs on, for the same reason:
   * a fix with nothing that can fail when it regresses is not a fix, it is a
   * commit message. A `{ todo: true }` test does NOT qualify — it can never
   * fail, which is exactly how Harbinger of Immolation looked tracked for two
   * days while the card was completely dead.
   */
  guards?: string[];
  /** set to 'done' when fixed — the test then stops requiring the proof */
  status: 'open' | 'done';
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import './../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { spawn, toDeployment } from './util.ts';
import type { Seat } from '../src/types.ts';

const ENGINE_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'engine.ts'), 'utf8');

/** the source of a card's spell effect, comments and strings stripped */
function runSrc(card: string): string {
  const f = getCard(card).spellEffect?.run;
  return (f ? f.toString() : '')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, "''");
}

/** a two-unit board; returns the engine, the seats and the spawned ids */
function board(seed: number, mine: string, theirs?: string) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const a = spawn(h, A, mine);
  const d = theirs ? spawn(h, D, theirs) : undefined;
  return { h, A, D, a, d };
}

/** run one card's spell effect against chosen targets and count what it SAID */
function eventsFrom(
  card: string, seed: number, build: (g: E, A: Seat, D: Seat) => { targets: unknown[]; x?: number },
): number {
  const { h, A, D } = board(seed, 'Tidal Menace', 'The Foretold');
  const g = new E(h.state);
  const { targets, x } = build(g, A, D);
  const before = g.events.length;
  const def = getCard(card).spellEffect!;
  try {
    def.run(g, {
      controller: A, sourceName: card, region: g.homeRegion(A),
      targets: targets as never, x, event: null,
      choose: () => { throw new Error('choice'); },
    } as never);
  } catch { return -1; }        // suspended or threw: not a completed silent run
  return g.events.length - before;
}

export const CARD_TODO: TodoEntry[] = [
  // ── found by the whole-pool card drill (81-card-drill.test.ts) ─────────
  {
    id: 1,
    area: 'card',
    severity: 'blocker',
    cards: ['Abduct'],
    title: 'Abduct resolves in complete silence when it targets one of your own units',
    detail:
      'Printed: "Gain control of target unit with cost [x] or less unless its controller '
      + 'pays [x]." The target spec is `what: \'unit\'`, which offers BOTH sides, so '
      + 'pointing it at your own unit is a legal, offered play. The run then hits '
      + '`if (u.controller === ctx.controller) return;   // already yours` — no event, no '
      + 'log line. The spell leaves the stack, the mana and the X are spent, and the '
      + 'player has no way to tell a rule from a bug. There is a second silent return '
      + 'above it (`if (!isEnt(t)) return;`).',
    evidence:
      'The card drill, "lonely" board state (only the caster has units) — the scenario '
      + 'that exists specifically to push targeted cards down their own-unit branch. The '
      + 'fuzz-driven pass in 65-effect-conformance never cast Abduct at all, which is why '
      + 'its identical assertion never fired.',
    fix:
      "Announce it: g.ev('info', `Abduct: ${u.card} is already yours — nothing happens.`). "
      + 'Then answer the SEPARATE question of whether "gain control of target unit" should '
      + 'be offering allied units at all (R64 has the ownership kinds for it — '
      + "`what: 'enemyUnit'`, or a `restrict` — but changing the legal target set is a "
      + 'rules call, not a logging fix, so it needs the owner.)',
    proof: () => eventsFrom('Abduct', 8101, (g, A) => ({
      targets: [g.unitsOf(A, g.homeRegion(A))[0]!], x: 9,
    })) === 0,
    // FIXED 2026-08-23. Both silent branches announce now — the own-unit one
    // named in this entry AND the ransom-PAID one, which was silent too and is
    // the branch a player is most likely to hit. The target spec is deliberately
    // UNCHANGED: whether "gain control of target unit" should offer allied units
    // at all is a rules call the owner has not made, and this was a logging bug.
    guards: [
      '85-silent-branches.test.ts::Abduct aimed at your own unit announces',
      '85-silent-branches.test.ts::Abduct whose ransom',
      '85-silent-branches.test.ts::Abduct whose ransom is declined still takes the unit',
    ],
    status: 'done',
  },
  {
    id: 2,
    area: 'card',
    severity: 'major',
    cards: ['Divine Intervention'],
    title: 'Divine Intervention says nothing on the path where it actually works',
    detail:
      'Printed: "You may change the targets of target effect." The DECLINE branch logs '
      + '("…\'s targets are left alone"), but the branch that succeeds — the one that '
      + 'rewrites `item.parts[pi].targets[ti]` — emits no event at all. So the visible '
      + 'behaviour is backwards: choosing to do nothing is announced, and choosing to '
      + 'redirect an opposing spell is invisible. Two bare guard returns above it are '
      + 'silent as well.',
    evidence:
      'Card drill, "bait" board state. Compare Gravitational Correction, which does the '
      + 'same job and logs "Player 1 changes 1 of Protective Adaptations\'s targets."',
    fix:
      'Emit a line naming the effect and how many of its targets moved, matching '
      + "Gravitational Correction's wording so the two read the same in the log.",
    proof: () => {
      const s = runSrc('Divine Intervention');
      const tail = s.slice(s.indexOf('picks.push'));
      return tail.length > 0 && !tail.includes('g.ev(');
    },
    // FIXED 2026-08-23. The success branch now emits the same line Gravitational
    // Correction does, carrying the same `{ item, n }` data payload — so the two
    // cards that do the same job read the same in the log, and a test asserts
    // that rather than trusting it. ⚠ Gravitational Correction itself needed NO
    // fix: this entry's evidence implied its guards were silent, and they are
    // not — all three of its bare returns are inside forEach callbacks whose
    // caller already announces the aggregate.
    guards: [
      "85-silent-branches.test.ts::Divine Intervention that changes an effect",
      '85-silent-branches.test.ts::Divine Intervention and Gravitational Correction report a retarget the same way',
      '85-silent-branches.test.ts::Divine Intervention driven through a real game',
    ],
    status: 'done',
  },
  {
    id: 3,
    area: 'card',
    severity: 'major',
    cards: ['Immolate'],
    title: 'Immolate resolves in silence when its [Sacrifice a unit] cost is declined',
    detail:
      'Printed: "[Switch1] /[Sacrifice a unit]: Draw a card." The run opens '
      + '`if (!ctx.costPaid?.sacrificed) return;` with no announcement. That path is '
      + 'reachable both as an ordinary cast and — more often — as the bounded graft '
      + 'rider, where the rider\'s cost is declined at cast time and the composite then '
      + 'resolves a part that does nothing and says nothing.',
    evidence:
      'Card drill — Immolate resolved silently in ALL THREE board states, the only card '
      + 'in the pool to do so outside the two already known.',
    fix:
      "g.ev('info', 'Immolate: no unit was sacrificed — no card is drawn.') on that branch.",
    proof: () => eventsFrom('Immolate', 8103, () => ({ targets: [] })) === 0,
    // FIXED 2026-08-23, and WIDER than the card. The identical
    // `if (!ctx.costPaid?.sacrificed) return;` shape was silent on Sacrificial
    // Burst and Linked Extinction too, and Structural Collapse's `bar <= 0` is
    // the same bug with different arithmetic. All four announce now, and because
    // each is a shared `EffectDef` the graft rider — the path this entry says is
    // hit MORE often than the ordinary cast — is covered by the same fix.
    // In total the sweep this entry started closed 46 silent branches on 39
    // cards; see the head of 85-silent-branches.test.ts for the taxonomy.
    guards: [
      '85-silent-branches.test.ts::Immolate resolved as a graft rider with its cost unpaid',
    ],
    status: 'done',
  },

  // ── the owner's own attribute example ─────────────────────────────────
  {
    id: 4,
    area: 'attribute',
    severity: 'major',
    title: '{Piercing} does nothing on non-combat damage',
    detail:
      'The owner\'s second example, verbatim: "piercing is done even when its on a '
      + 'non-combat effect". It is not. `dealEffectDamageAll` — the batch EVERY '
      + 'non-combat damage source goes through — reads Deadly, Powerful, Poisonous, '
      + 'Resonant, Blessed, Reaping and Electric, and never mentions Piercing. A '
      + '{Piercing} source that deals 5 to a 1/1 kills it and the other 4 vanish; the '
      + 'result is byte-identical to a source with no attribute at all. This also makes '
      + 'a virus-donated {Piercing} a dead donation, which contradicts the ruling that '
      + 'authorises the donation in the first place: "you can only do this with '
      + 'attributes — mostly Deadly, Piercing, and Powerful are impacted by this" '
      + '(Caleb 2025-03-06, quoted at R79).',
    evidence:
      'Measured directly: Ruinbringer (8/9 {Piercing}) dealing 5 effect damage to a 7/2 '
      + 'left both life totals at 30, exactly as a vanilla 3/3 did. Also already written '
      + 'down in docs/digital-rules.md under R79 "⚠ Not in scope": "Piercing is a '
      + 'combat-overflow rule in this engine and dealEffectDamage has no overflow to '
      + 'pierce. The attribute now reaches the effect; nothing reads it there yet."',
    fix:
      'RULED, 2026-08-23 — the owner settled it and no further question is open: '
      + '"It redirects excess damage to that unit\'s controller (not as a trigger, just '
      + 'as part of resolution of the damage)." That matches the rulebook\'s combat '
      + 'wording (Rulebook 2023-07: "Excess damage beyond the health of the back row '
      + 'unit does not carry over to the player, unless the damage comes from a unit '
      + 'with the Piercing attribute"), generalised off the column. '
      + 'So: in `dealEffectDamageAll`, when the source has {Piercing}, the amount beyond '
      + 'what was needed to kill the recipient goes to THAT UNIT\'S controller, inside '
      + 'the same damage resolution — not as a separate event and not as a trigger. '
      + 'Excess is computed after {Powerful} doubling and after the receive-side '
      + '{Vulnerable} doubling, on the same lethal arithmetic the combat path uses.',
    proof: () => {
      const from = ENGINE_SRC.indexOf('  dealEffectDamageAll(');
      const rest = ENGINE_SRC.slice(from + 10);
      const next = rest.search(/\n  [a-zA-Z_$][\w$]*\(/);
      return from > 0 && !(next > 0 ? rest.slice(0, next) : rest).includes("'Piercing'");
    },
    // FIXED 2026-08-23. `dealEffectDamageAll` now plans the excess in the same
    // batch as an ordinary player recipient, so it is one resolution with one
    // R80 `total` and nothing reaches the stack in between — which is what "not
    // as a trigger, just as part of resolution" required. The lethal arithmetic
    // moved into a single `poolToKill` closure shared with {Electric} and
    // shaped on `combatSubStep`'s `assign`, so the combat and non-combat paths
    // can no longer drift.
    guards: [
      '82-attr-interactions.test.ts::Piercing: 5 effect damage to a 1/1',
      '82-attr-interactions.test.ts::Piercing: exactly lethal pierces nothing',
      '82-attr-interactions.test.ts::Piercing + Powerful',
      '82-attr-interactions.test.ts::Piercing vs a Vulnerable victim',
      '82-attr-interactions.test.ts::Piercing vs a damage-shielded unit',
      '82-attr-interactions.test.ts::Piercing + Deadly',
      '82-attr-interactions.test.ts::Piercing DONATED by a virus',
      '82-attr-interactions.test.ts::Piercing in a BATCH',
    ],
    status: 'done',
  },
  {
    id: 5,
    area: 'attribute',
    severity: 'major',
    cards: ['Bubb', 'Haboob', 'Trashling'],
    title: '{Unaware} is not implemented anywhere in the engine',
    detail:
      'Three cards print {Unaware} and the engine contains not a single reference to the '
      + 'string. R10 settled what it means ("everything counts as interacting") and stat '
      + 'layer 6 was reserved for it; the layer was never built. The three cards are '
      + 'therefore plain vanilla bodies in play.',
    evidence:
      'A grep of every attribute name against engine.ts + apply.ts: {Unaware} is the only '
      + 'one of the 25 attributes in the pool with ZERO references. The engine still '
      + 'carries the "layer 6 (Unaware) goes here" placeholder that card-ledger.ts keys '
      + 'its Bubb / Haboob / Trashling entries to.',
    fix:
      'RULED 2026-08-23. ⚠ THE FIRST RECORD OF THIS RULING HERE WAS WRONG, and the error '
      + 'was in how the question was ASKED, not in how it was answered — the owner was '
      + 'offered a multiple choice whose "blanket" option described only half his position, '
      + 'and a first implementation shipped on it. His operational statement, which governs: '
      + '"Unaware means that it looks ONLY at what is the literal printed text on all cards '
      + "'involved' (self or others when dealing damage or in combat when dealing/receiving). "
      + 'So Bubb blocking a Robot token would kill it (do Bubb, it has 0 power and 0 '
      + 'defense), no matter how many +1/+1 counters it has. Bubb would also survive 100 '
      + '-1/-1 counters just fine. Haboob kills anything that has 1 defense printed at the '
      + 'card level." '
      + 'So TWO things, and the first implementation had one of them: '
      + '(a) an {Unaware} card reads its OWN stats as PRINTED — layer 1 only, so a base '
      + 'REWRITE is ignored too ("literal printed text on the card"), which is what makes '
      + '"survives 100 -1/-1 counters" true right through the state-based death check; and '
      + '(b) in an interaction involving an {Unaware} card, EVERY card involved reads at '
      + 'printed. The pairwise mechanism the first pass was explicitly told not to build is '
      + 'the correct one. Scope is the owner\u2019s: dealing/receiving damage, and combat. '
      + 'This is ALSO Caleb\u2019s reading — "any Unaware units (or Spells like Haboob) will '
      + 'only look at BASE STAT PRINTED on cards" — so the "we diverge from the designer" '
      + 'note the first pass wrote was an artefact of the bad question and is gone. '
      + '⚠ OPEN EDGE, named rather than silently decided: R10 lists TARGETING as an '
      + 'interaction and the operational statement does not. Targeting is not collapsed; '
      + 'extending it would touch ~33 card-side effStats calls and needs its own ruling. '
      + 'THE LESSON, which is the reusable part: a ruling compressed into multiple choice '
      + 'is a ruling you have paraphrased. Quote the owner and let him write the sentence.',
    proof: () => !ENGINE_SRC.includes("'Unaware'"),
    // FIXED 2026-08-23, on the SECOND attempt. Two halves:
    //  · SELF — `effStats` ends `if (statAttrs.includes('Unaware')) return
    //    this.printedStats(e);`, layer 1 alone, so layers 2-5 (base rewrites
    //    included) are all ignored. Verified: Bubb is 5/6 through +5 counters,
    //    through 100 -1/-1 counters, and through a base rewrite to 4/4.
    //  · PAIRWISE — `interactionStats(u, involved)` collapses EVERY
    //    participant to printed when any of them is Unaware, wired at the three
    //    sites the owner named: the combat sub-step's column exchange,
    //    `dealEffectDamageAll`, and the shared `fight` helper. Verified: a Unit
    //    Token carrying +6 counters reads 7/7 alone and 1/1 in an exchange with
    //    Bubb.
    // A collapsed exchange needs its own death sweep, because `checkDeaths`
    // reads `effStats`: a Robot 20 read as printed 0/0 is assigned no damage at
    // all, so nothing would kill it. `sweepCollapsedDeaths` runs over the
    // exchange's participants and never globally — outside an interaction a
    // Robot 20 is a 20/20 and stays one.
    // The collapse survives {Pure} on purpose: R61 switches off the ATTRIBUTE
    // layer for an exchange, and this is a STAT layer.
    guards: [
      '92-unaware.test.ts::Bubb blocking a Robot token would kill it',
      '92-unaware.test.ts::Bubb would also survive 100 -1/-1 counters just fine',
      '92-unaware.test.ts::Haboob kills anything that has 1 defense printed at the card level',
      '92-unaware.test.ts::a +1/+1 counter on Bubb leaves it a 5/6',
      '92-unaware.test.ts::NEGATIVE CONTROL',
      '05-rulings.test.ts::R10',
    ],
    status: 'done',
  },

  // ── targeting legality, found by the drill ────────────────────────────
  {
    id: 6,
    area: 'card',
    severity: 'minor',
    cards: ['Organic Exchange'],
    title: 'Organic Exchange can be aimed at two of your own units, making it a no-op',
    detail:
      'Printed: "Exchange control of two target units and swap their positions." The '
      + "target spec is `what: 'unit', count: 2, min: 2` with no restriction that the two "
      + 'are controlled by different players. Aimed at two of your own, the two controller '
      + 'assignments cancel out and the log read "Player 1 takes Tidal Menace, Player 1 '
      + 'takes The Foretold — positions swapped", naming the same player twice. The '
      + 'position swap does still happen, so it was never entirely inert.',
    evidence: 'Card drill, "lonely" board state.',
    fix:
      'RULED 2026-08-23 — the play stays LEGAL and no `restrict` is added. Swapping the '
      + 'positions of two of your own units is a real line, the printed text does not '
      + 'forbid it, and narrowing the target set would take a legal play away to fix a '
      + 'sentence. So this was a LOG bug: when both targets already share a controller '
      + 'the line now says the positions swap and control does not change, instead of '
      + 'naming the same player twice as taker. '
      + '⚠ NOTE FOR WHOEVER RE-OPENS THIS: the original proof below asserted '
      + '`what === "unit" && !restrict`, which is precisely the state the ruling says to '
      + 'PRESERVE — it could never have gone false, so the item would have reported open '
      + 'forever. It is re-proofed against the defect that was actually there.',
    // The old shape, measured: aimed at two units under one controller, the log
    // line named that controller TWICE ("Player 1 takes A, Player 1 takes B").
    // The fixed card emits a different line for that case, so the name appears
    // once. Deliberately a shape-detector for the OLD code rather than an
    // assertion about the new wording — the new behaviour is pinned
    // structurally by the guards below, which compare the two cases without
    // fixing either sentence.
    proof: () => {
      const { h, A, a, d } = board(8106, 'Tidal Menace', 'The Foretold');
      const g = new E(h.state);
      // both targets under ONE controller: take the enemy unit first so the
      // board matches the reported situation without changing the card
      const mine = g.entity(a as never)!, theirs = g.entity(d as never)!;
      theirs.controller = A;
      const before = g.events.length;
      getCard('Organic Exchange').spellEffect!.run(g, {
        controller: A, sourceName: 'Organic Exchange', region: g.homeRegion(A),
        targets: [mine, theirs], event: null,
        choose: () => { throw new Error('choice'); },
      } as never);
      const said = g.events.slice(before).map(e => e.msg ?? '').join(' ');
      const name = g.pname(A);
      return said.split(name).length - 1 >= 2;
    },
    guards: [
      '85-silent-branches.test.ts::Organic Exchange aimed at two of your own units is still a legal, offered play',
      '85-silent-branches.test.ts::Organic Exchange announces a same-controller swap differently from a real exchange',
      '85-silent-branches.test.ts::Organic Exchange across the table still exchanges control',
    ],
    status: 'done',
  },

  // ── coverage: the reason these went unnoticed for so long ─────────────
  {
    id: 7,
    area: 'coverage',
    severity: 'major',
    title: 'The fuzz-driven conformance pass never reaches a third of the pool',
    detail:
      '65-effect-conformance carries the right assertions (no undeclared token, no silent '
      + 'resolution) but drives them with 140 fuzz games, and a random walk does not cast '
      + 'the whole box. Measured 2026-08-23: 143 of the 424 cards with effects were never '
      + 'driven once. Its own reach floor (`attempted >= 260` of 449 EffectDefs) is '
      + 'satisfied the whole time, so nothing reports the blind spot. All three silent '
      + 'cards above sat inside it.',
    evidence:
      'A probe that wrapped every EffectDef.run and ran exactly the seeds that file uses.',
    fix:
      'DECIDED 2026-08-23: the fuzz drive is NOT widened, and that is the answer rather '
      + 'than a deferral. A random walk is the wrong tool for coverage by construction — '
      + '81-card-drill.test.ts is the primary net now, playing every card through the real '
      + 'action path in three board states, deterministically, with no exemptions left in '
      + 'its silence sweep. 65 keeps the two guarantees the drill CANNOT make: it reaches '
      + 'abilities, graft compositions, donated [Augment] text and granted text (R63) that '
      + 'a "put it in hand and cast it" driver never touches. '
      + 'What was actually wrong here was not the reach, it was that the reach was '
      + 'INVISIBLE: 65\'s floor counted EffectDefs, and one shared helper def can be owned '
      + 'by a dozen cards, so a third of the pool went uncast while the floor looked '
      + 'healthy. 65 now states its reach in CARDS too and prints it on every run.',
    proof: null,
    verify:
      'node --test test/65-effect-conformance.test.ts prints "fuzz reach: N/M cards with '
      + 'effects were driven at least once — K never cast here" on every run. It was 281 of '
      + '417 (136 never cast) when this closed, and the floor is absolute so adding cards '
      + 'cannot dilute it.',
    guards: [
      '65-effect-conformance.test.ts::the drive states its reach in CARDS, not only in EffectDefs',
      '65-effect-conformance.test.ts::the drive actually covers the pool',
      '81-card-drill.test.ts::the drill plays every card in the pool, in three board states',
      '81-card-drill.test.ts::the drill reports honestly on its own reach',
    ],
    status: 'done',
  },
  {
    id: 8,
    area: 'coverage',
    severity: 'major',
    title: 'Cards with a printed clause that does nothing — see card-ledger.ts',
    detail:
      'Not restated here on purpose. card-ledger.ts is the authority, each entry quoting '
      + 'the printed clause and naming the primitive it is parked on. It was 28 entries on '
      + '2026-08-23 and is 23 now; the tally line in 83-card-todo.test.ts reads the ledger '
      + 'LIVE rather than repeating a number, because a count in a comment is a claim about '
      + 'the repo on the day it was typed. This entry exists so a reader of the todo list '
      + 'cannot miss that the list of broken cards is longer than the items above. '
      + 'THE USEFUL FINDING, 2026-08-23: the ledger is not 28 independent problems. Twelve '
      + 'of its entries were parked on FOUR engine seams, and building those four closed '
      + 'them together — Oorblak on Piercing excess (R103), Suspend / Nullbringer / Conduit '
      + 'of Pain / Counter Thief / Cosmic Conspirator / Automaton of Abundance on the '
      + 'replacement layer (R104), Bubb / Trashling / Haboob on stat layer 6, and Suspend '
      + 'again plus Temporal Rift on self-erase. Read the ledger by MISSING PRIMITIVE, not '
      + 'by card, and it is a much shorter list than it looks.',
    evidence: 'card-ledger.ts, kept honest by 71-card-ledger.test.ts.',
    fix:
      'Work the ledger down BY PRIMITIVE rather than by card — see the finding in the '
      + 'detail. Delete each entry in the same commit as its fix; that is the rule at the '
      + 'head of the file and it is what keeps a park note from outliving its cause. Note '
      + 'that 71-card-ledger.test.ts needs a live CANARY for its dead-shape sweep, so '
      + 'un-parking whichever card currently holds that role means nominating another.',
    proof: null,
    verify:
      'node --test test/71-card-ledger.test.ts prints the current tally on every run, and '
      + '83-card-todo.test.ts prints the ledger length beside the todo counts.',
    // DONE 2026-08-24: the ledger is EMPTY. The last six cards came off in one
    // round, worked exactly as this entry prescribed — by PRIMITIVE, not by
    // card: R121 (ability tax + pay-to-trigger gate → Crevice Lurker), R122
    // (imposed sacrifice cast cost → Vengeance), R123 (bin-anchored play
    // permission + erase-funded grant → Writhing Host, and the play-from-bin
    // action → Trench Stalker whole), R124 ('leftBin' choke point → Rotling),
    // plus Worldbender via replaceCardStep (report #87). The sweep stays armed:
    // its dead-shape assertion fails the day a new card ships with a dead half
    // and no entry, and the canary is synthetic now (T71 Canary), so an empty
    // ledger cannot blunt it.
    guards: [
      '71-card-ledger.test.ts::every card with a readably-dead half is declared',
      '71-card-ledger.test.ts::the sweep has teeth',
    ],
    status: 'done',
  },
  {
    id: 9,
    area: 'coverage',
    severity: 'minor',
    title: 'Many per-card "tests" only assert that the card registers',
    detail:
      '121 of the 494 registered cards were named exactly ONCE across every file in '
      + 'test/. That shape is the registration smoke check — spawn the body, assert the '
      + 'printed power/toughness — which passes for a card whose rules text does nothing '
      + 'at all. It is what let the three silent cards above sit behind a green suite.',
    evidence: 'A count of quoted card names per test file across all 80 test files.',
    fix:
      'STILL OPEN, deliberately — this is a PROGRAM, not a fix, and pretending otherwise '
      + 'is how it would quietly stop happening. What changed 2026-08-23: the population '
      + 'went 131 → 118 (39 cards got real, situation-named tests out of the silent-branch '
      + 'sweep and the replacement layer), and it now has a SCOREBOARD — '
      + '90-coverage-census.test.ts measures the four coverage bands, prints them on every '
      + 'run, and floors the weak band just above its real value so the next card added '
      + 'without a test of its own trips it. '
      + 'The honest read of the number: it counts ATTENTION, not correctness. A card named '
      + 'ten times can still be wrong and a card named twice can be perfect. What it cannot '
      + 'be is a card nobody has looked at.',
    proof: null,
    verify:
      'node --test test/90-coverage-census.test.ts prints the census. This item closes when '
      + 'the "named exactly once" band is small AND the cards in it are ones whose printed '
      + 'text genuinely needs no more than a body check (vanilla bodies, pure attribute '
      + 'cards) rather than ones nobody has got to yet.',
    // DONE 2026-08-24: the whole 97-card "named exactly once" band was
    // audited card-by-card by five parallel agents (combat triggers /
    // lifecycle watchers / play-watchers / spells / statics). 96 of 97
    // already carried real behavior tests — the band was an artifact of the
    // census counting only EXACT-quoted names, so a thorough test titled
    // 'Name: what it does' plus one spawn('Name') call scored as "named
    // once". The census now counts title-style mentions too, and the honest
    // band is 1: Slink, a vanilla body whose {Thieving} is pinned through it
    // in 09-attrs — exactly the "needs no more than a body check" close
    // condition this entry set. The audit also closed the real holes it
    // found: Recyclable Sentinel's death-branch payout (104), Rotspore
    // Herald on effect damage (107), ten R37/token-gate/bin-play negatives
    // (105), and Wraith's start-of-deployment shrink (101, via #23). The
    // floor is 8 (just above 1), so the next card added without a test of
    // its own still trips the census.
    guards: [
      '90-coverage-census.test.ts::the pool coverage census',
      '90-coverage-census.test.ts::every excluded sweep file still exists',
    ],
    status: 'done',
  },
  // ── UNANSWERED OWNER REPORTS ──────────────────────────────────────────
  // Owner reports that were `live` in playtest-ledger.ts when this list was
  // drawn up (CT-10..CT-14 were that batch), carried here so that "cards
  // found broken by testing" and "reports nobody has answered" are ONE list —
  // which is what was asked for. The LEDGER stays the authority on wording
  // and status, and its tally is read live by 83-card-todo.test.ts rather
  // than counted here, so this comment cannot rot when reports get fixed.
  // `reportId` is the index into playtest-issues.snapshot.jsonl, and
  // 83-card-todo.test.ts asserts these entries stay in step with the ledger.
  {
    id: 10,
    area: 'engine',
    severity: 'blocker',
    reportId: 60,
    title: 'There is no replacement-effect layer; twelve cards print replacement wording',
    detail:
      'Owner (XBYN, 2026-08-22): "The engine makes so many things triggers despite them '
      + 'not technically being triggers. We need a whole layer that deals with replacement '
      + 'effects." Twelve cards print replacement wording — five parked, six implemented as '
      + 'triggers. Live consequences: Containment Protocol and Nothyr can NEGATE a '
      + 'replacement (which never uses the stack); Automaton of Abundance fires per spawn so '
      + 'N identical tokens yield N copies instead of one per unique; Cosmic Conspirator '
      + 'really creates then erases, firing a spurious `spawned`; Nullbringer fires a '
      + 'lifeGained for a gain that never happened. Five module-level mutable flags exist '
      + 'only to paper over this.',
    evidence: 'playtest-ledger.ts #60, still `live`. Restated by the owner as #75.',
    fix:
      'BUILT 2026-08-23 as R104, in TWO families rather than one, because Caleb settled '
      + 'that they compose differently. (a) `AmountMod` — continuous, SUMMED, modelled '
      + 'line for line on `CostMod`: "a replacement only happens once … The replacement '
      + 'just takes what would be 1 and makes it 2", so two modifiers both apply and none '
      + 'applies to itself. Conduit of Pain, Flux Resonator, Proliferating Slime. '
      + '(b) Named `replaceX` hooks — first-true-consumes, modelled on the two that '
      + 'already existed: `replaceLifeGain`, `replaceCounters`, `replaceTokenCreation`, '
      + '`replaceTokenBatch`. Nullbringer, Counter Thief, Cosmic Conspirator, Automaton of '
      + 'Abundance. Plus `E.lockLife` for Suspend, which is neither. '
      + 'Deliberately NOT a general "any event" framework — one named hook per replaceable '
      + 'quantity, which is what the engine already said it wanted. '
      + 'Harbinger of Immolation is NOT in this class — it is continuous, not a replacement.',
    // The measured consequences, all now asserted rather than argued:
    // Nullbringer fires NO lifeGained and pushes nothing (verified directly:
    // life 30 → 26 on a gain of 4, event types lifeLost+info, empty stack);
    // Cosmic Conspirator fires no `spawned` for the Robot that was never
    // created and no `erased`; Conduit of Pain produces ONE damage event of 4
    // rather than a 6 then a 1. All seven cards now declare ZERO triggered or
    // activated abilities, so Containment Protocol and Nothyr cannot see them
    // at all — which is this item's stated acceptance criterion.
    // Three module-level flags deleted (`proliferating`, `aoaCopying`, and the
    // `nullbringerClaimed` WeakSet). Two KEPT and they are a different thing:
    // `probing` guards a nested QUERY (Spell Excavation asking targetCandidates
    // about another card's spec) and `aoScanning` stops two adjacent Ancient
    // Ones mimicking each other. One new latch lives in the ENGINE instead of a
    // card file — `inReplaceCounters`, because a counter redirect genuinely
    // re-enters and two thieves would ping-pong.
    proof: null,
    verify:
      'Containment Protocol cannot negate any of the seven, because none of them declares '
      + 'a triggered or activated ability any more — check with '
      + "`getCard(n).abilities` / `.augmentText` filtered on type. `docs/digital-rules.md` "
      + 'R104 records the layer; `88-replacement-conformance` fails if a declared hook is '
      + 'never read in engine.ts.',
    guards: [
      '87-replacement-layer.test.ts::Containment Protocol on the stack cannot negate a life-gain replacement',
      '87-replacement-layer.test.ts::Containment Protocol RESOLVING negates nothing a replacement did',
      '87-replacement-layer.test.ts::Nothyr finds no nonspell effect to target',
      '87-replacement-layer.test.ts::a replaced life gain fires no lifeGained',
      '87-replacement-layer.test.ts::a replaced token creation fires no spawned',
      '87-replacement-layer.test.ts::two different AmountMods both apply',
      '87-replacement-layer.test.ts::an AmountMod does not apply to its own contribution',
      '87-replacement-layer.test.ts::a replacement fires once, not once per source',
      '88-replacement-conformance.test.ts::the layer is NARROW on purpose',
    ],
    status: 'done',
  },
  {
    id: 11,
    area: 'engine',
    severity: 'blocker',
    reportId: 75,
    title: 'The rule for what may reach the stack, in the owner’s own words',
    detail:
      'Owner (WEHH, 2026-08-22), refined 2026-08-23. Only "When" / "Whenever" / a ":" '
      + 'activated ability go on the stack. Cards that say "instead", "as" or "if" AND DO '
      + 'NOT MENTION A TARGET never go on the stack — the target clause is the load-bearing '
      + 'half, because choosing a target is a public, respondable act. By that test '
      + 'Automaton of Abundance, Cosmic Conspirator, Nullbringer, Counter Thief, Flux '
      + 'Resonator, Proliferating Slime and Conduit of Pain all print "instead" with no '
      + 'target and must never reach the stack; R102 (Beyond, Codex Incarnate) is correctly '
      + 'NOT an exception, because it prints "target unit".',
    evidence: 'playtest-ledger.ts #75 — the sharpest statement of #60, and its acceptance criterion.',
    fix:
      'DONE 2026-08-23, and the deliverable is the SWEEP, not the seven cards. A one-card '
      + 'fix is what made this recur: report #46 (Bulborb) was closed with exactly one '
      + 'card and one test, and the class then came back as #60 and again as #75. So the '
      + "owner's printed-word rule is now a conformance test over all 494 cards, in the "
      + 'same family as 68-target-conformance (which exists for the same reason). '
      + 'It classifies per SENTENCE, and the narrowing took four measured rounds: the '
      + 'words literally → 63 cards; drop bare "if" → 19; require "would" → 11; require '
      + '"would" AND "instead" in the same sentence → 10 — plus one addition for the '
      + "owner's \"as\", a verb-anchored `deal|deals|dealt … as` that catches Blightsea "
      + 'Polyp and cannot match "as if it was in your hand". 11 cards flagged, 10 of which '
      + 'must never reach the stack and 1 of which must (Beyond, Codex Incarnate — it '
      + 'prints "target unit", so R102 is right and the sweep asserts the INVERSE for it).',
    // Two exemptions, both self-invalidating: Skittering Blight is exempt only
    // from the "whole text is a replacement" shortcut, because it prints "When
    // I spawn, gain a rot." as a separate sentence — the test fails if its text
    // ever becomes all-replacement. Beyond is pinned the other way.
    proof: null,
    verify:
      'node --test test/88-replacement-conformance.test.ts prints '
      + '"REPLACEMENTS: N of 494 cards — M never reach the stack, K do (they name a '
      + 'target)" on every run, and carries a classifier floor naming all 11 so a future '
      + 'over-narrowing cannot make the file pass vacuously.',
    guards: [
      '88-replacement-conformance.test.ts::a replacement that names NO target is built out of the replacement layer',
      '88-replacement-conformance.test.ts::a card whose whole text is an untargeted replacement declares NO ability at all',
      '88-replacement-conformance.test.ts::a replacement that DOES name a target still uses the stack (R102 stays R102)',
      '88-replacement-conformance.test.ts::every exemption is still needed',
      '88-replacement-conformance.test.ts::the classifier finds the replacement clauses, and only those',
    ],
    status: 'done',
  },
  {
    id: 12,
    area: 'card',
    severity: 'major',
    cards: ['Biotoxicity', 'Cosmic Conspirator'],
    reportId: 64,
    title: 'Biotoxicity never offers the token choice Cosmic Conspirator is supposed to grant',
    detail:
      'Owner (GETD, 2026-08-22): "Biotoxicity didn’t give me the choice of what kinds of '
      + 'tokens I wanted even though I had Cosmic Conspirator." Cosmic Conspirator is a '
      + 'replacement; its "you may instead" is a choice INSIDE the replacement and needs a '
      + 'decision raised BEFORE anything is created. Today the engine creates the Robot, '
      + 'fires `spawned`, then erases it — and Biotoxicity creates several tokens at once, '
      + 'so the per-spawn trigger never asks per kind.',
    evidence: 'playtest-ledger.ts #64. Blocked on CT-10.',
    fix:
      'FIXED 2026-08-23 by R104, and it did fall out of the layer — TWO defects, both of '
      + 'which a trigger patch would have missed. Biotoxicity creates three SPELL tokens '
      + 'and `E.createSpellToken` fired no dispatchable event at all, so the old `spawned` '
      + 'trigger heard nothing; and a per-spawn trigger could not have asked per token in '
      + 'a batch even if it had heard. `replaceTokenCreation` is consulted at the creation '
      + 'call, once per request, BEFORE anything exists — so the Robot that is swapped away '
      + 'is never created, never fires `spawned`, and is never erased.',
    proof: null,
    verify:
      'Play Biotoxicity with Cosmic Conspirator in play: three tokens, three questions, '
      + 'and each token comes out the kind you picked with the same X.',
    guards: [
      '26-metal-a.test.ts::Biotoxicity asks once per token in the batch (report #64)',
      '26-metal-a.test.ts::a created Robot may become a Fireball of the same X',
      '87-replacement-layer.test.ts::one resolving part is one creation batch',
    ],
    status: 'done',
  },
  {
    id: 13,
    area: 'client',
    reportId: 76,
    title: 'Undo during a hidden segment: the reported case is fixed; one narrow refusal remains',
    detail:
      'Owner (WEHH, 2026-08-22): deployment is simultaneous and hidden, so what the '
      + 'opponent did cannot have depended on your action. The undo guard asks "did anyone '
      + 'act after you", which is the right question during battle (shared, public stack) '
      + 'and the wrong one here.',
    evidence: 'playtest-ledger.ts #76.',
    fix:
      'FIXED 2026-08-23, and NOT the way the report asks. "Always be able to" is unsafe: '
      + 'splicing your action out shifts every entity id above its floor, and an opponent '
      + 'action that still replays LEGALLY while naming a different unit is silent '
      + 'corruption — worse than a refusal. `undoActionAt`\'s rebuild only ever measured '
      + '`IllegalAction`, so it was blind to exactly that. '
      + 'So: `spliceable()` is now cheap and EXACT for the id route only (refuse iff the '
      + 'spliced action allocated ids AND a later action names an id above that floor); it '
      + 'no longer asks who acted. Everything else is MEASURED — every action carries a '
      + 'resolved reference key (an entity id becomes "the k-th entity created by action '
      + 't7", a hand index becomes the card at it, a decision becomes its option label), '
      + 'plus the rng state and the actor\'s own private-zone delta; splice, rebuild, '
      + 'recompute, accept only if every later key is byte-identical. `RENUMBER_IMMUNE` is '
      + 'deleted as SUBSUMED — its five members were exempt because they name nothing, '
      + 'which the general rule now says once. '
      + 'Planning is covered for free: the gate reads the SEGMENT, never the phase, which '
      + 'is what report #37 asked for in so many words.',
    // ⚠ RECURRENCE, and the reason it recurred is on the record now: report
    // #37 (2026-08-21) made this same complaint, was marked FIXED, and NEITHER
    // of its two guards could ever have failed on #76's behaviour — both drive
    // the resource step, which allocates no id and draws no RNG, so the splice
    // gate is never even reached. #37's fix built the hidden SEGMENTS (which
    // decide which of your actions an undo looks at); it never touched the
    // splice GATE (which decides whether the undo may go). The decision also
    // lived inside main.ts's WebSocket handler, reachable only by playing a
    // whole game over a socket — a test nobody writes. It is now
    // `undoForSeat(room, seat)` in rooms.ts, and the guards below drive THAT.
    proof: null,
    verify:
      'The gate is `undoForSeat` in server/rooms.ts. Reproduce the report: deploy, have '
      + 'the opponent deploy a card (a real play, not a bare done), and your own play must '
      + 'still come back. It is done when the string "already acted on top of that one" '
      + 'appears nowhere in server/ except as a quoted report.',
    guards: [
      'server/test-undo-segment.ts::and it carries a PAYLOAD',
      'server/test-undo-segment.ts::is still undoable',
      'server/test-undo-segment.ts::whole position came through the rebuild untouched',
      'server/test-undo-segment.ts::and the reported error text is gone for good',
      'server/test-undo-segment.ts::the splice is refused',
      'server/test-undo-segment.ts::a fresh room opens inside the plan segment',
      'server/test-hidden.ts::freeze is captured at room creation',
    ],
    // CLOSED 2026-08-23 at the owner's second answer: "In deployment and
    // planning, you're 'alone' in a world that no one else can see. So you
    // should be perfectly allowed to undo everything, up to the beginning of
    // that phase." No residual refusal remains inside a hidden segment.
    //
    // ⚠ THE FIRST ATTEMPT WAS TOO CAUTIOUS AND THE SECOND FOUND OUT WHY.
    // Dropping the conservative id screen was NOT enough, and the reason is
    // worth keeping: the log is replayed VERBATIM, so a later action's raw
    // `hostId: 4` names a number that ceases to exist after the splice. The
    // measurement cannot wave that through — it refused four real games with
    // the engine's own "no such unit". The renumbering is not a false alarm to
    // be silenced, it is damage to be REPAIRED.
    // So `undoActionAt` now splices, RENUMBERS the surviving log (the spliced
    // action allocated [lo, hi); everything at or above `hi` shifts down by
    // hi - lo), rebuilds, and uses the reference-key measurement as the PROOF
    // that the renumbering was a repair rather than a guess — if the world
    // moved in any way other than that constant shift, a key differs and the
    // whole undo rolls back.
    // ⚠ This REWRITES ENTITY IDS IN THE PERSISTED LOG. Deliberate: an id is the
    // row number a choice was filed under, not the choice, and `seed + actions`
    // still reproduces the game exactly, which is the log's actual contract.
    // The only alternative is the refusal the owner just rejected.
    // The floor is `segmentFloor`, which lifts over a leading run of `decide`s
    // when the segment opened mid-suspension — debt (R39) and start-of-
    // deployment rot (R38) are paid inside the barrier action and were already
    // below it, but a start-of-phase trigger that ASKS something leaves its
    // `decide` at the segment start and must not be undone.
    severity: 'minor',
    status: 'done',
  },
  {
    id: 14,
    area: 'client',
    severity: 'minor',
    reportId: 77,
    title: 'A refused block declaration throws away the entire block plan',
    detail:
      'Owner (WEHH, 2026-08-22): declaring illegal blocks resets the whole board, so a '
      + 'large block has to be rebuilt over one mistake. It should name the offending '
      + 'units, keep the rest, and offer a "Reset blockers?" button.',
    evidence: 'playtest-ledger.ts #77. Client-side, not the engine.',
    fix:
      'FIXED 2026-08-23. Two halves, and the second was the real cause. '
      + '(a) `doDeclareBlocks` in apply.ts is split into `checkBlocks` — the same legality '
      + 'run, verbatim and in the same order — and the mutation, so the refusal is '
      + 'available as a VALUE (`blockDeclarationIssue`). `IllegalAction` did not need '
      + 'widening. ui/battle.ts\'s `blockVerdict` then walks a refused plan against that '
      + 'oracle (base, then columns in order, then counterattackers, then riders) and '
      + 'returns `{ why, offenders, keep, required }`. Every judgement is a question put '
      + 'to the engine, so no block rule is restated client-side and what survives is '
      + 'legal by construction. R84\'s compulsory duty comes back as `required`, not as an '
      + 'offender. Which blocks are LEGAL did not change. '
      + '(b) `declareBuiltBlocks` cleared the plan immediately after `act()`. That is '
      + 'correct in hotseat, where the refusal is synchronous, and WRONG over a socket, '
      + 'where the refusal lands after the wipe — i.e. in every network game, which is '
      + 'every game the report came from. The plan is now held until an authoritative '
      + 'state says the declaration landed.',
    proof: null,
    verify:
      'Declare a block plan with one bad column in a NETWORK game (the bug does not '
      + 'reproduce in hotseat). Only the named units clear, the notice names them by card, '
      + 'and a "Reset blockers?" button is offered.',
    guards: [
      '86-ui-block-refusal.test.ts::one bad column does not cost you the other five',
      '86-ui-block-refusal.test.ts::what the verdict keeps is something the engine actually accepts',
      '86-ui-block-refusal.test.ts::a compulsory block is REQUIRED, not an offender',
      '86-ui-block-refusal.test.ts::widening the error did not widen the RULE',
      '86-ui-block-refusal.test.ts::the plan is no longer wiped the moment the action is sent',
      '86-ui-block-refusal.test.ts::with a Reset blockers? button',
    ],
    status: 'done',
  },

  // ── found by the SEMANTIC pass (84-card-semantics.test.ts) ────────────
  {
    id: 15,
    area: 'card',
    severity: 'major',
    cards: ['Collect Remains', 'Temporal Rift', 'Suspend', 'Skybreaker'],
    title: '"Erase me" is unimplemented on four of the six cards that print it',
    detail:
      'Four cards print a self-erase and none of them erases anything: Collect Remains '
      + '("Put target card in a bin into your hand. Erase me."), Temporal Rift ("End this '
      + 'battle. Erase this spell."), Suspend ("… Erase me.") and Skybreaker ("[Augment] '
      + 'Erase me: Negate all spell effects."). Each has real, working code for its OTHER '
      + 'half, which is exactly why nothing caught it: the shape sweep in 71-card-ledger '
      + 'sees live code, and the drill sees the card do something. The two cards that DO '
      + 'implement it are Spore of Regenesis (erasing as a cost) and Zephyrzoa (in its '
      + '[Augment] box). '
      + 'This is not cosmetic. The erased pile is the zone cards leave the game through '
      + '(R65), so a spell that should erase itself instead lands in the bin, stays '
      + 'recurrable, and keeps counting toward every "cards in your bin" effect and every '
      + '"erase X cards from your bin" cost. Collect Remains is the worst of them, being '
      + 'itself a bin-recursion spell that is supposed to remove itself from the game.',
    evidence:
      'The semantic pass: the printed clause promises an `erased` event and the drill '
      + 'observed none, in any of the three board states. Confirmed by reading each run — '
      + 'none contains an erase call at all.',
    fix:
      'A resolving spell is binned by the engine after its effect runs, so a self-erase '
      + 'has to redirect that disposal rather than erase a card that is still on the '
      + 'stack. Skybreaker is the odd one out: there "Erase me" is an activation COST on '
      + 'a unit, so it follows Spore of Regenesis\'s pattern (eraseUnit on self) rather '
      + "than the spell-disposal one. Do Collect Remains first — it is the only one whose "
      + 'gap changes what a deck can do.',
    proof: () => {
      const dead = ['Collect Remains', 'Temporal Rift', 'Suspend', 'Skybreaker'].filter(n => {
        const c = getCard(n);
        const src = [c.spellEffect?.run, ...(c.abilities ?? []).map(a => a.effect?.run),
          ...(c.augmentText ?? []).map(a => a.effect?.run), c.graftEffect?.effect?.run]
          .map(f => (f ? f.toString() : '')).join('');
        return !/erase/i.test(src);
      });
      return dead.length === 4;
    },
    // FIXED 2026-08-23. `StackItem.eraseSelf` + `EffectCtx.eraseSelf()`, read by
    // a new branch in `dischargeItem` — the same choke point R79's Unstable
    // erase already goes through, so the two cannot double-log or double-push
    // to the public pile. The flag is state on the ITEM rather than a closure
    // variable, which is what makes it survive a mid-part suspension being
    // serialised and replayed (R85); a save/load round-trip test proves it.
    //
    // Two rulings came out of the work, both pinned:
    //  · A NEGATED self-erase spell is BINNED, not erased. "Erase me." is a
    //    sentence OF THE EFFECT, and R68 says a negated effect does nothing.
    //    The contrast one branch up proves it is a decision and not an
    //    accident: R79's {Unstable} IS erased on negation, because Unstable is
    //    a stamp on the object (a virus rode it) rather than an instruction.
    //    A FIZZLED one is binned for the same reason.
    //  · Skybreaker is not in this class at all — there "Erase me" is an
    //    activation COST on a unit in play, so it needed `AbilityCost.eraseSelf`
    //    and a real `eraseFromPlay`. It had been approximated as `sacrificeSelf`,
    //    which is a DEATH: the card reached a bin, fired death triggers and
    //    stayed recurrable. An erase is none of those things.
    guards: [
      '89-self-erase.test.ts::Collect Remains: it takes the bin card AND leaves the game',
      '89-self-erase.test.ts::having erased itself, it is not there for the next copy to recur',
      '89-self-erase.test.ts::Suspend: the life lock lands for the battle and the spell erases itself',
      '89-self-erase.test.ts::Temporal Rift: ending the battle does not carry off its own disposal',
      '89-self-erase.test.ts::Skybreaker: "Erase me" is paid as the activation cost, and an erase is not a death',
      '89-self-erase.test.ts::a NEGATED self-erase spell is binned, not erased',
      '89-self-erase.test.ts::a virus rides a self-erasing spell',
      '89-self-erase.test.ts::the erase survives a save/load',
      '89-self-erase.test.ts::every card in the pool that prints a self-erase reaches the erased pile',
      '84-card-semantics.test.ts::the \"Erase me\" class is exactly the four cards CARD-TODO #15 names',
    ],
    status: 'done',
  },
  // ── found while FIXING the above, 2026-08-23 ──────────────────────────
  // Every one of these was surfaced by the silent-branch sweep or the Piercing
  // work and confirmed by direct measurement before being written down. They
  // are here rather than in a report because the lesson of this repo is that a
  // finding with no entry and no failing test is a finding that comes back.
  {
    id: 16,
    area: 'engine',
    severity: 'major',
    title: 'A non-combat damage batch with nothing in it resolves in total silence',
    detail:
      '`E.dealEffectDamageAll` opens with `if (!order.length) return;` and says nothing. '
      + 'Measured 2026-08-23: an empty batch emits ZERO events. That is the same defect '
      + 'CARD-TODO #3 fixed on three cards, one level down — and it is the level that '
      + 'matters, because every "I deal N damage to each opponent / each enemy unit" card '
      + 'builds a hit list and hands it over. With no opponent in the region (R25) or no '
      + 'enemy unit on the board the list is empty, the card resolves, the mana is spent '
      + 'and the log is blank. Three carriers were patched card-side during the #3 sweep '
      + '(Flzzz, Restitution, Vroot); the rest of the pool is not, and patching them one '
      + 'at a time is exactly the shape that makes a bug recur.',
    evidence:
      'Direct probe: `dealEffectDamageAll(ctx, [])` against a live game state, counting '
      + 'events before and after. Zero. Raised by the agent that fixed CARD-TODO #3, which '
      + 'could not fix it because engine.ts was out of its scope.',
    fix:
      'Announce it in `dealEffectDamageAll` itself, at the `!order.length` return, naming '
      + '`ctx.sourceName` — one line covers every carrier at once and no card needs to '
      + 'know. Watch the two shapes that are NOT this bug and must stay silent: a batch '
      + 'whose hits were all `n <= 0` (a card that computed zero damage on purpose), and '
      + 'a fully PREVENTED batch, which R98 says was never dealt and which already logs '
      + 'the prevention itself.',
    proof: () => eventsFrom('Immolate', 8116, () => ({ targets: [] })) >= 0 && (() => {
      const { h, A } = board(8116, 'Tidal Menace', 'The Foretold');
      const g = new E(h.state);
      const before = g.events.length;
      g.dealEffectDamageAll({
        controller: A, sourceName: 'Immolate', region: g.homeRegion(A),
        targets: [], event: null, choose: () => { throw new Error('choice'); },
      } as never, []);
      return g.events.length === before;
    })(),
    // FIXED 2026-08-23. The guard is at the TOP of `dealEffectDamageAll` and
    // keyed on `hits.length`, not on `order.length` — which is what keeps the
    // two must-stay-silent shapes silent. An all-zero batch has a non-empty
    // `hits` and never reaches it (the planning loop's `n <= 0` drops it, and
    // the CARD owns that explanation — Siphon Life already says "X = 0"). A
    // fully prevented batch structurally cannot reach it either: prevention
    // runs after `!order.length`, in the `received` loop, so its `order` is
    // never empty, and R98 logs the prevention itself.
    // Four real carriers were covered without a single card edit: Meteor
    // Shower, Roving Quillback, Infernal Grovekeeper, Channel Through.
    guards: [
      '93-engine-defects.test.ts::handed an empty hit list announces that there was nothing to damage',
      '93-engine-defects.test.ts::still deals its damage and fires a damage event',
      '93-engine-defects.test.ts::whose every hit computed zero damage stays silent',
      '93-engine-defects.test.ts::a fully prevented damage batch reports only the prevention',
      '93-engine-defects.test.ts::Meteor Shower with no unit anywhere to hit',
    ],
    status: 'done',
  },
  {
    id: 17,
    area: 'engine',
    severity: 'major',
    cards: ['Wake the Dead'],
    title: 'Playing another player’s card out of their bin makes you its OWNER, permanently',
    detail:
      'Wake the Dead prints "Play up to two units in ANY bin with total cost [8] or less '
      + 'now, for free." It ends `g.spawnUnit(seat, c.name, ctx.region)` where `seat` is '
      + 'the CASTER and `c.seat` may be the opponent — and `E.spawnUnit` takes no owner '
      + 'parameter at all: it sets `owner: seat, controller: seat` together. So a unit '
      + 'raised out of an enemy bin is not borrowed, it is naturalised. When it dies it '
      + 'goes to the CASTER’s bin, it counts toward the caster’s "cards in your bin" '
      + 'effects for the rest of the game, and the original owner can never recur it. '
      + 'The engine tracks owner and controller separately everywhere else and says so '
      + 'out loud at R65 ("each card reaches ITS OWN owner’s erased pile — a virus on '
      + 'an enemy spell is the enemy’s card"), so this is a missing parameter rather '
      + 'than a deliberate reading. The card’s own header already calls it an '
      + 'approximation; the ledger does not carry it.',
    evidence:
      'Read from `E.spawnUnit`’s signature (`owner: seat, controller: seat`, no owner '
      + 'option) against Wake the Dead’s run, which is the only effect in the pool that '
      + 'reaches into a bin it does not control and then spawns. Found by the '
      + 'silent-branch sweep as a side observation and confirmed by reading both.',
    fix:
      'Give `spawnUnit` an `owner` option defaulting to `seat`, and pass the picked '
      + 'card’s real owner from Wake the Dead. Then check the neighbours: '
      + 'batch-dark-c already passes an explicit `owner`, batch-hybrids-ld-a spawns for '
      + '`opp` and for `m.controller`. A control-change is R8 and is NOT this — R8 moves '
      + 'the unit, it does not renationalise the card.',
    // ⚠ THE FIRST VERSION OF THIS PROOF WAS A SOURCE-TEXT PROXY (it matched
    // `g.spawnUnit(seat,`) and it stayed TRUE after the bug was fixed, because
    // the fix adds a fourth argument rather than changing the first. A proof
    // that reads source can be satisfied — or defeated — by restructuring, and
    // this one very nearly forced a pointless rename to make it go false. It is
    // behavioural now: raise an enemy's binned unit and ask who OWNS it.
    proof: () => {
      const { h, A, D } = board(8117, 'Tidal Menace', 'The Foretold');
      const g = new E(h.state);
      g.player(D).bin.push('Curio Drifter');
      let asked = 0;
      try {
        getCard('Wake the Dead').spellEffect!.run(g, {
          controller: A, sourceName: 'Wake the Dead', region: g.homeRegion(A),
          targets: [], event: null,
          choose: (_k: string, dec: { options: { card?: string; value: unknown }[] }) =>
            (asked++ === 0
              ? dec.options.find(o => o.card === 'Curio Drifter')!.value
              : dec.options[dec.options.length - 1]!.value),
        } as never);
      } catch { return true; }
      const raised = Object.values(g.s.entities).find(u => u.card === 'Curio Drifter');
      // the bug is present while the CASTER ends up owning the opponent's card
      return !!raised && raised.owner === A;
    },
    // FIXED 2026-08-23. `spawnUnit` gained an `owner` option defaulting to
    // `seat` (which stays the CONTROLLER), and the `spawned` event carries
    // `owner` only when it differs, so no existing reader's payload moved.
    // Verified directly: a unit raised out of P0's bin by P1 comes back
    // controller P1 / owner P0, and dies to P0's bin.
    // The sweep found TWO more, both wrong in more interesting ways than Wake
    // the Dead: Uglk ("each player puts a unit from THEIR bin into play under
    // an OPPONENT's control") was handing the card over permanently, which its
    // text never says — it now sets controller and owner in opposite directions
    // from one sentence; and Reclaim the Fallen ("under their CONTROLLER's
    // control") means a virus you stuck on an enemy comes back on their side
    // and is still your card. Every other spawn site reads the caster's own
    // zone, and every token site is correct by construction — a creation is
    // owned by its creator.
    guards: [
      '93-engine-defects.test.ts::raising a unit from the ENEMY bin gives the caster control, not ownership',
      '93-engine-defects.test.ts::raising a unit from your OWN bin is unchanged',
      '93-engine-defects.test.ts::the borrowed spawn says so in its event',
      '93-engine-defects.test.ts::Uglk hands an opponent CONTROL of a unit without handing over the card',
    ],
    status: 'done',
  },
  {
    id: 18,
    area: 'engine',
    severity: 'minor',
    cards: ['Hexbane Shiitake'],
    title: 'A [once] budget is spent when the trigger is QUEUED, so an ability that does nothing still burns it',
    detail:
      '`E`’s trigger-composition writes `budgetHolder.budgets[budgetKey] = 1` the moment '
      + 'a `bounded` ability is composed — before its run has a chance to discover it can '
      + 'do nothing. 88 of the pool’s 138 bounded ([once] / [Switch1]) abilities have a '
      + 'run that can bail out, and most of those bail-outs are harmless type guards. '
      + 'One was not: Hexbane Shiitake used to read `inEndOfTurn(g) ? false : ctx.choose(...)`, '
      + 'so during the end-of-turn window the player was NEVER ASKED and the [once] was spent '
      + 'anyway. The same shape burns the budget when the carrier is already gone or when '
      + 'the spell it wanted has left the stack. '
      + '⚠ The general case needs a RULING, not just code: does declining a "you may" '
      + 'on a bounded trigger spend the budget? A defensible yes (the trigger did fire). '
      + 'What is NOT defensible is spending it on a question nobody was asked.',
    evidence:
      'Read at engine.ts’s bounded-budget write (`if (ability.bounded) { … budgets[key] = 1 }`), '
      + 'which runs at composition time, against a census of every bounded ability whose run '
      + 'contains a bare `return;`: 88 of 138. Surfaced by the CARD-TODO #3 sweep.',
    fix:
      'RULED 2026-08-23: DECLINING NEVER SPENDS IT. A [once] is spent only when the '
      + 'ability actually does something — say no to a "you may" and the budget is intact, '
      + 'so the same trigger can ask again later the same turn. That answers both halves '
      + 'at once (the never-asked auto-decline and the ordinary decline) and makes all 88 '
      + 'bounded abilities with a bail-out branch behave the same way. '
      + 'SINCE UPDATED (same day): the never-asked half no longer exists. The premise it '
      + 'rested on — that a ctx.choose suspension in the end-of-turn window strands the '
      + 'game — was stale, so `inEndOfTurn` and all 21 of its auto-answers were deleted '
      + 'and Hexbane now ASKS wherever it resolves (99-endofturn.test.ts). The RULING is '
      + 'unchanged and still load-bearing: it is what makes the ORDINARY decline refund. '
      + 'IMPLEMENTATION NOTE, because the obvious version does not work: "emitted no '
      + 'event" is NOT the test for "did nothing" any more — CARD-TODO #3\u2019s sweep just '
      + 'gave every one of those bail-out branches an announcement, which was the point of '
      + 'it. So the seam has to be EXPLICIT: keep the reservation at composition time (it '
      + 'is also the re-entrancy guard) and add a way for a run to say "I did nothing, '
      + 'refund it", called from the ~46 branches the #3 sweep already found and annotated. '
      + 'Those branches are the list; they do not have to be rediscovered.',
    // ⚠ THE FIRST VERSION OF THIS PROOF matched `inEndOfTurn(g) ? false` in the
    // card's source — and after the fix it went on matching the EXPLANATORY
    // COMMENT that replaced the code. Source-text proofs measure the wrong
    // thing. (The shape is gone from the pool entirely now, which is exactly
    // why a proof written against it would have proved nothing.) This one asks whether the seam exists at all: a refund cannot
    // happen if there is nothing to call. The BEHAVIOUR — declined refunds,
    // successful activation still spends — is asserted by the guards below,
    // which is where behaviour belongs.
    proof: () => !ENGINE_SRC.includes('settleBudgetRefund'),
    // FIXED 2026-08-23 to the owner's ruling. `EffectCtx.refundBudget?.()`
    // raises `EffectPart.refunded`; `E.settleBudgetRefund` pays it out AFTER
    // the part finishes, so a suspension throws past it and R85's replay starts
    // with the flag clear — idempotent, and a run that succeeds never raises it.
    // The reservation stays at composition time because it is also the
    // re-entrancy guard.
    // Called from the bounded subset of the CARD-TODO #3 population — 10 cards,
    // 21 branches — plus three ENGINE sites, which is a scope extension worth
    // knowing about: a graft rider's cast [cost] is marked spent at cast time,
    // BEFORE the run exists, so `ctx.refundBudget()` can never be reached there
    // and `E.refundPart` had to be called from `payCastCost`'s decline and the
    // two unpayable-cost branches. Same ruling, different route: declining a
    // cost you were offered is declining.
    guards: [
      '93-engine-defects.test.ts::in the end-of-turn window is ASKED, and declining does not spend its [once]',
      '93-engine-defects.test.ts::can still fire later the same turn',
      '93-engine-defects.test.ts::whose exchange is DECLINED keeps its [once]',
      '93-engine-defects.test.ts::a SUCCESSFUL Hexbane Shiitake exchange really does spend its [once]',
      '93-engine-defects.test.ts::a declined "you may pay" on a bounded trigger keeps its budget',
      '93-engine-defects.test.ts::a bounded ability that DID something keeps the budget spent',
    ],
    status: 'done',
  },
  {
    id: 19,
    area: 'card',
    severity: 'major',
    cards: ['Spellbind'],
    title: '{Modular} opens its window but offers only GRAFTS — never augments, which is half the keyword',
    detail:
      'Printed (Spellbind, the pool\'s only {Modular} card): "(You can apply mods to a '
      + 'modular card from your hand and/or bin as it is played. You still pay their '
      + 'costs.)" The WINDOW is built and works — `E.collectModular` asks inside R35\'s '
      + 'cast-time collection, offers hand and bin, charges each mod as an additional cast '
      + 'cost, rides the mods on the stack item where both players can see them, adds each '
      + 'one\'s effect as an extra part, and bins them with the spell (R40). '
      + 'What it offers is the problem: `if (!isGraftable(name) …) return;` — 137 of 494 '
      + 'cards, GRAFTS ONLY. The Manual defines two ways to apply a mod and this is one of '
      + 'them: an AUGMENT needs the [Augment] symbol on the mod ("There is no restriction '
      + 'on the number of times a card can be augmented"), while a GRAFT additionally '
      + 'requires "both cards must have the graft symbol". The Light & Dark glossary says '
      + 'it outright — a Modular card "can arrive already carrying augments/grafts". '
      + 'The engine\'s own comment justifies the exclusion: "it is the only kind of mod '
      + 'that means anything on a spell — a spell has no body for an augment to grant '
      + 'attributes to." That is contradicted by R79 IN THE SAME FILE: a virus augmenting '
      + 'a spell donates its type-line [Augment] attributes into `ctx.grantedAttrs`, and '
      + '`dealEffectDamageAll` reads them (R103 added {Piercing} to that list). An augment '
      + 'on a spell demonstrably does something.',
    evidence:
      'Measured 2026-08-23. Graftable cards and type-line-[Augment]-attribute cards are '
      + 'DISJOINT — 137 and 22, overlap ZERO — so the filter does not narrow the choice, it '
      + 'makes attribute donation through {Modular} impossible. Of those 22, fourteen are '
      + 'viruses and can already reach a spell through R79\'s own virus window, so they '
      + 'lose nothing. EIGHT are not viruses and can reach a spell by NO route at all: '
      + 'Resonant Form, Noxious Sporefiend, Carapace Devourer, Tempest Wrangler, Bubb, '
      + 'Ephemeral Skywalker, Curio Drifter, Whispering Mantid. {Modular} is the only '
      + 'timing that could ever put them on a spell, and the reminder text says it should. '
      + 'A further 143 cards carry [Augment] TEXT and are excluded too. '
      + 'Not found by any sweep: 43-dark-c.test.ts asserts the graft rider works, which it '
      + 'does, and no test asks what is NOT on the menu — the same blind spot shape as the '
      + '"Erase me" class (CARD-TODO #15), where each card\'s OTHER half worked.',
    fix:
      'TWO changes, and one of them is not enough on its own. '
      + '(1) Widen `collectModular`\'s filter from `isGraftable` to "graftable OR '
      + 'augment-capable", the same predicate `doAugment` already uses for a mod applied '
      + 'to a unit — so the offer matches the Manual\'s definition of a mod rather than a '
      + 'subset of it. '
      + '(2) Union `item.mods` into `grantedAttrs` in `resolveParts`, beside the existing '
      + '`item.augments?.length ? this.stackAugmentAttrs(item) : []`. Without this the '
      + 'widened offer donates nothing and the bug looks fixed while nothing changed — '
      + 'exactly the shape of the parked halves this round has been closing. '
      + 'RULED 2026-08-23, and it is wider than the question asked. The owner: "I think '
      + "it's legal to apply ANYTHING to a Modular card. But many cards wont do anything "
      + 'at all since it requires being in play (which a spell never is). Same with '
      + 'viruses, they should also be allowed to be applied to the modular card, even if '
      + 'they might not do anything." So the menu is EVERY card in hand and bin whose cost '
      + 'you can pay — no graft filter, no augment filter, viruses included. A mod that '
      + 'does nothing is a legal, wasteful play, not something to prevent. The [Augment] '
      + 'TEXT half therefore needs no ruling and no code: it does nothing on a spell '
      + 'because there is no body for it to live on, and that must be TESTED so a '
      + 'deliberate no-op cannot later be mistaken for an unimplemented one. '
      + 'SECOND RULING, same day, which the first one exposed: "A modded Spellbind should '
      + 'also have unstable. It basically works as a \'flashback\' for graft cards. You pay '
      + '1 to put it on the stack, then add in some effects from your yard that you also '
      + 'want to happen. Since otherwise, gaining 1 rot is pretty bad." That is the '
      + 'Manual\'s PERMADEATH paragraph (p.35) applied to this card — "As long as a card '
      + 'is modded, it has the unstable attribute … even though mods can be applied from '
      + 'the bin, they are generally only able to be applied once" — and the one-shot mod '
      + 'is the PRICE OF THE FLASHBACK rather than a harsh edge case. Before this, a mod '
      + 'applied through the {Modular} window was binned and reusable while a virus '
      + 'applied to the same spell through R79\'s window was erased: the same act with '
      + 'opposite outcomes, which stops being defensible the moment anything can be '
      + 'applied.',
    proof: () => {
      const from = ENGINE_SRC.indexOf('  private collectModular(');
      if (from < 0) return false;
      const rest = ENGINE_SRC.slice(from + 10);
      const next = rest.search(/\n  (private |public )?[a-zA-Z_$][\w$]*\(/);
      const body = next > 0 ? rest.slice(0, next) : rest;
      // the bug is present while the offer is graft-only
      return body.includes('isGraftable(name)') && !/augmentAttrs|isAugment|augmentText/.test(body);
    },
    // FIXED 2026-08-23 as R105. The menu is now `canPayCard(seat, name,
    // { purpose: 'mod' })` and nothing else — verified end to end: with a
    // graftable card, a non-virus type-line augment, a virus and an
    // [Augment]-text card in hand, all four are offered. (An earlier probe that
    // showed only the graftable one was an AFFINITY artefact of the probe's own
    // resources, not a filter — worth knowing before re-testing this.)
    // Three things had to land together or the fix would have looked done and
    // changed nothing:
    //  · the offer, widened;
    //  · `payModularMod` pushing a `graft:` part ONLY for a graftable card —
    //    an invented graft key throws in `effectByKey`, so this was the crash
    //    the widening would otherwise have caused;
    //  · `E.stackModAttrs`, unioning the mods' type-line attributes into
    //    `grantedAttrs` beside R79's virus channel. Kept a SEPARATE method so
    //    the virus channel keeps meaning what its name says.
    // And the owner's second ruling: a modded carrier is {Unstable}, so the
    // spell and its mods are ERASED, never binned. Verified: a graft card
    // applied FROM THE BIN produces its effect (3 Wraiths, rot 0 → 3) and both
    // it and Spellbind end in the public erased pile with neither in a bin.
    // That is the flashback working as designed — the one-shot mod is the price.
    guards: [
      '91-modular.test.ts::the {Modular} menu offers every card you can pay for',
      '91-modular.test.ts::a card in the BIN is offered beside the hand, and an unaffordable one is not',
      '91-modular.test.ts::a GRAFT mod still contributes its [Switch] effect as an extra part',
      '91-modular.test.ts::a mod with NO graft effect adds no part',
      '91-modular.test.ts::a type-line [Augment] mod really donates',
      '91-modular.test.ts::an [Augment]-TEXT mod is accepted and does nothing',
      '91-modular.test.ts::the flashback line',
      '91-modular.test.ts::an UNMODDED {Modular} spell is not Unstable',
      '91-modular.test.ts::the {Modular} window and the virus window agree',
      '91-modular.test.ts::a NEGATED modded Spellbind is erased too',
    ],
    status: 'done',
  },
  // ── follow-ups from the fix round itself, 2026-08-23 ──────────────────
  {
    id: 20,
    area: 'engine',
    severity: 'minor',
    title: 'A bounded [once] is still spent when the ability FIZZLES for want of a target',
    detail:
      'RE-ANSWERED, AND THE FIRST ANSWER WAS WRONG. The question was whether a fizzle is '
      + '"the ability did nothing" (refund, consistent with CARD-TODO #18) or "the ability '
      + 'happened and missed" (spend, consistent with the way R86 already treats a fizzle '
      + 'as a real resolution that produced nothing). Both readings are defensible and the '
      + 'engine originally answered by accident. '
      + 'It was first closed on the REFUND reading, and shipped that way for part of a '
      + 'day. The designer then ruled the whole bounded family directly — a bounded '
      + 'ability "can only be activated or triggered once per turn. REGARDLESS OF IF THAT '
      + 'ABILITY RESOLVES OR DOESN\'T" — which names the fizzle by its own description. '
      + 'Reachable, not theoretical: 61 bounded abilities in the pool declare a target '
      + 'spec, so any of them can be answered by removing its target in response — and '
      + 'under the correct answer that answer COSTS the bounded ability its turn, which '
      + 'is the whole reason to play it.',
    evidence:
      'Read at `resolveItem`\'s R86 fizzle branch (`item.label fizzles — all targets are '
      + 'gone`), which returns before `resolveParts`. Counted 61 bounded abilities with a '
      + '`targets` spec. Raised by the agent that implemented #18, which could not answer '
      + 'it without the owner; re-answered by the designer on the same day.',
    fix:
      'RULED (designer, 2026-08-23), superseding the same day\'s first answer: a FIZZLE '
      + 'SPENDS THE USE. Written up as R113, which draws the line for the whole family — '
      + 'a bounded use is spent by being USED (activated, or put on the stack), and only '
      + 'a decline, or an offer that could not be made at all, keeps it. '
      + 'The fizzle branch\'s `refundPart` loop is deleted; `E.refundPart` stays, because '
      + 'the three cast-cost decline sites still need it. Six card-level '
      + '`ctx.refundBudget()` calls moved to the other side of the line at the same time '
      + '(Auric Ascendant x2, Slag Spewer x2, Graxxlid x2) and one was split '
      + '(Structural Collapse, on whether the [cost] was actually paid).',
    proof: null,
    verify:
      'Give a bounded targeted ability a target, remove the target in response, and read '
      + '`budgets` on the source. It must still hold the reservation.',
    guards: [
      '93-engine-defects.test.ts::a bounded ability that FIZZLES for want of a target has SPENT its [once]',
      '94-bounded-uses.test.ts::a bounded trigger that is NEGATED on the stack has still spent its use',
    ],
    status: 'done',
  },
  {
    id: 21,
    area: 'engine',
    severity: 'minor',
    title: 'A [once] on a ZONE trigger is reserved on a throwaway ghost, so it bounds nothing',
    detail:
      'R51 dispatches a trigger to a card sitting in a ZONE (a bin, the hand) through '
      + '`E.standIn`, which builds a detached `Entity` with `id: -1` and a fresh '
      + '`budgets: {}`. `composeParts` writes the bounded reservation onto that object — '
      + 'which is never in `s.entities` and is thrown away the moment the trigger is '
      + 'queued. So a `bounded` zone-triggered ability reserves nothing, refunds nothing, '
      + 'and is effectively UNBOUNDED however many times it fires in a turn. '
      + 'LATENT, NOT LIVE: measured 2026-08-23, ZERO cards in the pool of 494 declare an '
      + 'ability that is both `bounded` and zone-dispatched, so nothing is wrong in a game '
      + 'today. It is here because the failure is SILENT — the next card that prints '
      + '"[Augment][once] When I am trashed …" gets an unbounded [once] and nothing in the '
      + 'suite would say so. The engine already carries a note about the ghost; what it '
      + 'does not carry is anything that fails.',
    evidence:
      '`E.standIn` (engine.ts) returns `{ id: -1, …, budgets: {} }`; `composeParts` writes '
      + '`budgetHolder.budgets[key] = 1` on the host it is handed. A census of every '
      + 'ability in the pool: 0 are both bounded and zone-dispatched.',
    fix:
      'Cheapest honest fix is a TEST, not code: assert that no registered ability is both '
      + '`bounded` and zone-dispatched, so the day someone prints one the suite fails and '
      + 'names this entry. Doing it properly means giving a zone trigger a real budget '
      + 'holder — per (seat, card name) rather than per entity, since there is no entity — '
      + 'which is a design decision about what "per card" (R9) means for a card that is '
      + 'not in play, and should not be guessed at while nothing needs it.',
    proof: null,
    verify:
      'Census: no ability with `bounded: true` also declares a `zone`. When one appears, '
      + 'this stops being latent.',
    // DONE 2026-08-24 by the entry's own "cheapest honest fix": the census is
    // a test now. SAME DAY, the PROPER fix landed too — R124 (Rotling's
    // 'leftBin' trigger is bounded AND zone-dispatched) built the real budget
    // holder this entry specified: `GameState.zoneBudgets`, per seat × card
    // name, written by composeParts' stand-in branch for zone-dispatched
    // abilities only, refunded through refundPart, wiped in startTurn,
    // serialized. The census's premise changed with it — from "ban the
    // combination" to "enumerate the population" — and its guard substring
    // below still names it.
    guards: ['90-coverage-census.test.ts::no ability is both bounded and zone-dispatched'],
    status: 'done',
  },
  {
    id: 22,
    area: 'engine',
    severity: 'major',
    cards: ['Mirage Walker'],
    title: 'Mirage Walker asks who has INITIATIVE, not who acted, so it misfires both ways',
    detail:
      'Its bookkeeping `when()` reads `g.s.deployPlayer === self.controller`. `deployPlayer` is '
      + 'NOT the acting seat: deployment is simultaneous and it is a derived initiative-ordered '
      + 'marker (its own comment in apply.ts says "derived sequential marker"). The predicate '
      + 'therefore reduces to "is my controller the initiative seat?" and never asks who acted. '
      + 'FALSE NEGATIVE (the reported case, EGCW turn 8): the non-initiative seat\'s own '
      + 'deployment actions are never counted, so Rashi played Mirage Walker and it still fired. '
      + 'FALSE POSITIVE: the OPPONENT applying a mod in your region sets the flag and suppresses '
      + 'your trigger though you did nothing — reachable whenever someone grafts onto your unit, '
      + 'which is exactly what happened in that same deployment. '
      + 'RULED by the owner 2026-08-23: "the idea is that YOU did something during deployment '
      + 'other than just hitting Done" — any deployment action counts, mods and ability '
      + 'activations included.',
    evidence:
      'Playtest report #86 (EGCW). Confirmed over the full seat x deployPlayer matrix: 2 of the 4 '
      + 'combinations misfire. Mirage Walker is the ONLY card in the pool that reads '
      + '`deployPlayer` (grep over src/cards/), so the class is narrow — the real class is not '
      + '"phase-begin triggers" but "entity-local when() bookkeeping with a wrong window '
      + 'predicate". The parent hypothesis that permanents generally misfire for the phase they '
      + 'entered was CHECKED AND REFUTED: fireEvent snapshots entities at the instant the event '
      + 'fires, so a late arrival has already missed it.',
    fix:
      'Do NOT patch the predicate in card code — stamp the truth in the REDUCER. Add a per-seat '
      + '`deployActed` to GameState, zeroed in E.startDeployment(), set in apply() for any '
      + 'deployment action other than doneDeploying/decide. Mirage Walker\'s when() then becomes '
      + 'a pure read and the whole bookkeeping ability can be deleted. This also fixes the '
      + 'approximation the card\'s own header admits ("pure activations with silent effects can '
      + 'slip through") and removes its dependence on region scoping and event payloads — note '
      + '`modApplied` carries no seat at all today, so the minimal card-level fix would need a '
      + 'payload change anyway.',
    proof: null,
    verify:
      'Drive playCard(Mirage Walker) in deployment for each of the four (mwSeat, deployPlayer) '
      + 'combinations and count the 3/3 tokens at end of turn. While the bug is live, the two '
      + 'combinations where deployPlayer !== mwSeat wrongly produce a token.',
    // DONE 2026-08-24, exactly per `fix`: per-seat GameState.deployActed,
    // zeroed in startDeployment, stamped at ONE choke point in apply.ts's
    // dispatch (any deployment action except doneDeploying/decide — an illegal
    // action throws and discards the stamp with the draft). The card's whole
    // bookkeeping trigger is deleted; its end-of-turn when() is a pure read.
    // Red 6/9 before the fix across the seat × deployPlayer matrix, including
    // BOTH misfire directions. CARD-TODO #23 (the 763-use deployPlayer test
    // habit) stays open — this entry's guards are the first tests in the repo
    // that drive deployment from the non-initiative seat on purpose.
    guards: [
      '14-water-a.test.ts::Mirage Walker #86: acting suppresses, idling triggers',
      '14-water-a.test.ts::Mirage Walker #86: the OPPONENT acting during deployment does not suppress the trigger',
      '14-water-a.test.ts::Mirage Walker #86: activating an ability during deployment counts as acting',
    ],
    reportId: 86,
    status: 'done',
  },
  {
    id: 23,
    area: 'coverage',
    severity: 'major',
    title: 'deployPlayer is used as "the acting seat" by 763 assertions, so seat-asymmetric deployment bugs are invisible',
    detail:
      'The guard that should have caught CARD-TODO #22 reads `const p = h.state.deployPlayer!` '
      + 'and then drives THAT seat — which is always the initiative seat right after '
      + 'toDeployment(), i.e. the one seat Mirage Walker\'s buggy predicate happens to serve '
      + 'correctly. The test is green with the bug live. '
      + 'This is not one test\'s mistake: `h.state.deployPlayer` appears 763 times across 65 test '
      + 'files as the canonical "acting seat". ANY seat-asymmetric deployment bug is therefore '
      + 'invisible to the whole suite, not just this one. Same shape as the drill\'s own trap '
      + 'list: a fixture that always picks the convenient seat is not coverage, it is a habit.',
    evidence:
      'A count of `deployPlayer` occurrences across test/. The Mirage Walker replacement test, '
      + 'parameterised over seat x deployPlayer, was confirmed red 4/4 before the fix while the '
      + 'original single-seat test stayed green.',
    fix:
      'Not a mass rewrite — most of those 763 uses are legitimately "whoever is deploying". The '
      + 'useful move is a lint-style test asserting that any card test which drives a DEPLOYMENT '
      + 'action runs from both seats, plus fixing the fixtures for cards whose behaviour is '
      + 'seat-dependent. Start from the cards whose text says "you" or "your" about a deployment '
      + 'action, since those are the ones where the two seats can differ.',
    proof: null,
    verify:
      'grep -c "deployPlayer" over test/*.test.ts, and check whether any test drives the '
      + 'NON-deployPlayer seat through a deployment action.',
    // DONE 2026-08-24: test/101-deploy-seat-matrix.test.ts drives every card
    // whose printed text ties a "you/your/ally" clause to deployment through
    // the full owner-seat × deployPlayer 4-way (the Mirage Walker shape from
    // report #86) — Bonesculptor, Gridxlan, Invasive Species, Scholar of the
    // Void, Wraith, Xzydris, Prediction Prophet, Slurpr; Mirage Walker is
    // EXEMPT with a reason (its 4-way lives in 14-water-a). The engine turned
    // out genuinely seat-symmetric (`deploying()` reads per-seat deployDone,
    // dispatch keys on controller/bin-owner), so no fix was needed — but the
    // matrix was red-checked against both classic bugs (deploying :=
    // initiative seat → 4 red; listener dispatch biased to initiative → 10
    // red), and Wraith's start-of-deployment shrink had NO test anywhere
    // before this. A sync lint scans printed.json both directions so a new
    // deployment-"you" card must join the matrix or carry a written exemption.
    guards: [
      '101-deploy-seat-matrix.test.ts::seat-matrix',
      '101-deploy-seat-matrix.test.ts::every deployment-"you" card in printed.json is in the matrix or exempt',
    ],
    status: 'done',
  },
  {
    id: 24,
    area: 'engine',
    severity: 'major',
    cards: ['Worldbender'],
    title: 'Worldbender is a vanilla 2/2 — none of its text exists, and no draft-step skip machinery does either',
    detail:
      'Printed: "Skip your draft step. When you do, draw a card. You also lose 3 life if playing '
      + 'a constructed format." The card is registered as a vanilla 2/2 {Feeble}. It has been '
      + 'carried in card-ledger.ts as `gap: dead, severity: high`. '
      + 'The owner played it and filed report #87, which finally supplies the spec that no ruling '
      + 'had settled — and the key point is that the card REPLACES the turn\'s normal card '
      + 'acquisition rather than adding to it: '
      + 'LIVE DRAFT — skip looking at the pack; draw 2 for turn + 1 for Worldbender = 3; NO life '
      + 'loss. CONSTRUCTED and CUBE — skip the draw-4-then-put-2-back; draw 2 for turn + 1 for '
      + 'Worldbender = 3; lose 3 life.',
    evidence:
      'Playtest report #87 (XVUR, 2026-08-23): "I have it in play and didn\'t skip my draft step". '
      + 'card-ledger.ts has carried the entry since the pool audit, with a {todo:true} test at '
      + '28-metal-c.test.ts::Worldbender naming exactly what was missing — neither of which can '
      + 'fail, which is why the suite stayed green while the card stayed dead. Only playing it '
      + 'surfaced it.',
    fix:
      'Build a per-seat "skip your next draft step" flag consulted by the draft step, firing the '
      + 'draw only when the skip ACTUALLY happens ("when you do" is conditional). Then branch the '
      + 'two formats per the spec above. '
      + 'TWO THINGS THE REPORT DOES NOT SETTLE and which must not be guessed: `GameMode` is '
      + "'shared' | 'draft' | 'constructed' — there is no CUBE mode to branch on, so cube "
      + 'presumably rides the constructed branch if it is ever added; and `shared` mode is not '
      + 'mentioned at all and needs its own answer.',
    proof: null,
    verify:
      'Play Worldbender in a draft game and take the draft step: while the bug is live the pack '
      + 'is still offered and no extra card is drawn. In constructed, the draw-4-put-2-back still '
      + 'happens and no life is lost.',
    // DONE 2026-08-23/24: `CardBehavior.replaceCardStep`, consulted by
    // E.startDraftStep (the seat is marked done before anyone acts and its
    // pack passes untouched) and by the constructed draw. Draft: draw 1 on top
    // of startTurn's 2, no life loss. Constructed: no draw-4-put-2-back, draw
    // 3 THEN lose 3 (a lethal 3 still leaves the cards drawn). Cube rides the
    // constructed branch the day a mode exists; shared has no card step to
    // replace, so the hook returns false. Card-ledger entry deleted in the
    // same change; report #87 flipped to fixed with the same guards.
    guards: [
      '28-metal-c.test.ts::Worldbender in a live draft',
      '28-metal-c.test.ts::Worldbender in constructed',
    ],
    reportId: 87,
    status: 'done',
  },
  {
    id: 25,
    area: 'engine',
    severity: 'major',
    cards: ['Flux Resonator'],
    title: 'Spawn-with-counters bypasses the R104 amount layer, so Flux Resonator never sees a Robot spawn',
    detail:
      'The Robot token prints "I spawn with X +1/+1 counters on me", and Caleb has ruled Flux '
      + 'Resonator applies to that placement (2025-03-21: tokens created under it enter with a '
      + 'counter, "Yep"; 2025-05-30: "it\'s just X+1 … a 2/2 robot would spawn as a 3/3"). '
      + 'E.addCounters consults `amountDelta({kind: \'counters\'…})`; E.spawnUnit sets '
      + '`u.counters = opts.counters` DIRECTLY and never asks the layer, so every '
      + '"create a Robot X" in the pool ignores an allied Resonator.',
    evidence:
      'Playtest report #88 (XVUR, 2026-08-23). Code read: spawnUnit\'s counters assignment vs '
      + 'addCounters\' amountDelta fold, engine.ts.',
    fix:
      'Fold the counters amount layer into spawnUnit at the single site where `u.counters` is '
      + 'set (opts.counters >= 1 only — zero counters is no placement), before the spawn '
      + 'announce/event so the logged number is the final one. Deliberately NOT routed through '
      + 'replaceCounters (Counter Thief redirect on a token\'s own spawn counters is unsourced).',
    proof: null,
    verify:
      'Spawn a Robot 1 with an allied Flux Resonator in the region: while the bug is live it '
      + 'enters as a 1/1 with 1 counter; fixed, a 2/2 with 2.',
    // DONE 2026-08-24, exactly per `fix`: the fold sits at spawnUnit's single
    // counters site (positive spawns only), the spawn line and 'spawned' event
    // carry the final number, the token batch records the pre-mod REQUEST so a
    // batch copy replays the creation, and replaceCounters is deliberately not
    // consulted (unsourced). Red-checked: the first three guards fail with the
    // fold removed; the last two pin non-application (enemy / counterless).
    guards: [
      '27-metal-b.test.ts::Flux Resonator: an allied Robot spawns with one more counter',
      '27-metal-b.test.ts::Flux Resonator: a Robot 2 enters as a 3/3, not a 4/4',
      '27-metal-b.test.ts::Flux Resonator: two allied Resonators give a spawn X plus TWO',
      '27-metal-b.test.ts::Flux Resonator: an ENEMY Resonator adds nothing',
      '27-metal-b.test.ts::Flux Resonator: a token that spawns with NO counters gets none',
    ],
    reportId: 88,
    status: 'done',
  },
  {
    id: 26,
    area: 'engine',
    severity: 'major',
    cards: ['Rotling', 'Writhing Host'],
    title: "Two bin removals bypassed the R124 'leftBin' choke point (mods-from-bin; the R123 grantor erase)",
    detail:
      "R124 claims E.removeFromBin is the ONE way a card leaves a bin, firing 'leftBin' "
      + '{seat, card, reason} once per card. Two sites still spliced bins directly: '
      + "(a) apply.ts zoneTake — a mod (augment or graft) applied `from: 'bin'` ran "
      + "`e.player(seat)[from].splice(index, 1)`, so no 'leftBin' fired for the applied card; "
      + '(b) the R123 erase-funded haste play — the Writhing Host grantor was spliced out of '
      + "the bin directly before the 'erased' announce. No reachable card misbehaved: Rotling, "
      + "the only 'leftBin' listener, has no augment/graft symbol and cannot leave a bin via "
      + 'either path. But the invariant and its doc were FALSE, and any future leftBin '
      + 'listener that IS a mod card would have missed its own exit silently — the '
      + '"check the guards, not the status" class this repo keeps re-learning.',
    evidence:
      'Self-found 2026-08-24 by grepping for direct bin splices against the R124 claim: '
      + 'apply.ts zoneTake bin branch and the binErase block in playAtTiming (haste branch).',
    fix:
      "Route both through the choke point: zoneTake's bin branch calls "
      + "e.removeFromBin(seat, index, 'modded') — a new reason verb, added to the R124 verb "
      + 'list in types.ts and docs/digital-rules.md — and the R123 grantor leaves via '
      + "e.removeFromBin(seat, binErase.index, 'erased'), KEEPING the site's own 'erased' "
      + 'announce (the R65 hook on that announce is what feeds the public erased pile, once). '
      + 'Plus a static conformance sweep in 90-coverage-census so the NEXT direct splice '
      + 'fails a test instead of waiting to be re-found.',
    proof: null,
    verify:
      'node --test test/90-coverage-census.test.ts — the static sweep asserts the only '
      + 'direct bin splice in src/ is inside removeFromBin itself. The behavioural guards '
      + "assert one 'leftBin' per removal on the event stream and the erased pile holding "
      + 'the grantor exactly once.',
    // DONE 2026-08-24 in the same change that found it. Red-checked: each fix
    // reverted alone makes its matching guard fail (the mod tests see zero
    // 'leftBin' events; the Writhing Host test sees zero; the static sweep
    // counts two splices instead of one), then restored.
    guards: [
      "04-mods.test.ts::graft from the bin goes through the R124 choke point",
      "04-mods.test.ts::augment from the bin goes through the R124 choke point",
      '42-dark-b.test.ts::the grantor leaves through the R124 choke point',
      '90-coverage-census.test.ts::the only direct bin splice in src is inside removeFromBin',
    ],
    status: 'done',
  },
  {
    id: 27,
    area: 'engine',
    severity: 'major',
    cards: ['Cthyrian Rector', 'Murkdrop Distiller', 'Biomass Devourer'],
    title: "A 'trashed' responder finds its card by lastIndexOf(name), not by R131's binNth",
    detail:
      'R131 put `binNth` on the trashed event precisely because a bin holds bare card NAMES, so '
      + 'identity there is (name, nth occurrence) — "copies of one card are genuinely '
      + 'indistinguishable". The cards that RESPOND to a trash never read it. They re-find the '
      + 'card with `g.player(seat).bin.lastIndexOf(name)`, which answers "the last copy of that '
      + 'name in the bin right now" — a different question. The two answers diverge whenever the '
      + 'trashed copy has LEFT the bin before the responder resolves, which is exactly what a '
      + 'state-based erase does: the trigger goes on the stack, the erase sweeps the copy, and on '
      + 'resolution lastIndexOf lands on an INNOCENT older copy of the same name. Cthyrian Rector '
      + 'then recalls the wrong card to hand (having already paid a sacrifice), and Biomass '
      + 'Devourer erases the wrong card outright — a card leaving the game permanently by '
      + 'mistake. ~13 sites use the lastIndexOf idiom; only the ones reacting to an event that '
      + 'carries binNth are wrong, so this needs classifying site by site, not a blanket rewrite '
      + '(Lurking Dread and Xzydris ask "is my own name in my bin", which lastIndexOf answers '
      + 'correctly).',
    evidence:
      'Found 2026-08-24 by the R137 agent while pinning the two bin-reaching hazards for playtest '
      + 'report #93, and confirmed by reading batch-dark-c.ts:262 (Rector) and batch-metal-a.ts:384 '
      + '(Biomass Devourer) against E.noteTrashed. R137 did NOT create it — a dying TOKEN already '
      + 'bins, trashes and is swept, so the window has always existed — but R137 widened it a lot, '
      + 'because every modded unit death now opens the same window. Deliberately left unfixed in '
      + 'R137 so a reversible ruling and an unrelated pre-existing bug did not land in one commit.',
    fix:
      "Pass R131's binNth through to the responders and index with it instead of searching by "
      + 'name: the trashed event already carries {seat, card, binNth}, so a responder wants '
      + '`bin[binNth] === name ? binNth : -1` and must treat the mismatch as "gone" rather than '
      + 'falling back to a search. Classify all ~13 lastIndexOf sites first and fix only those '
      + 'driven by an event that carries an index. Then pin it the way this repo pins invariants: '
      + 'a static sweep in 90-coverage-census asserting no card reacting to a binNth-carrying '
      + 'event resolves its target by lastIndexOf, so the next one fails a test instead of being '
      + 're-found.',
    proof: () => {
      // TRUE while a 'trashed' responder still resolves its card by name-search.
      //
      // Two ways this proof has already lied, both worth keeping in view:
      //  1. The first draft read JSON.stringify(augmentText) — which DROPS
      //     FUNCTIONS, so it silently answered false and the suite reported the
      //     bug fixed while the code was untouched. Read `run.toString()`.
      //  2. toString() KEEPS COMMENTS, so a comment merely *mentioning*
      //     lastIndexOf held this true after the code stopped using it. R140's
      //     own census sweep hit the identical trap on the same day. Strip
      //     comments and strings first: measure CODE, never prose.
      const at = (getCard('Cthyrian Rector').augmentText ?? []) as Array<
        { effect?: { run?: (...a: never[]) => unknown } }>;
      const src = at.map(t => t.effect?.run?.toString() ?? '').join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
        .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, "''");
      return src.includes('lastIndexOf');
    },
    status: 'done',
    guards: [
      '43-dark-c.test.ts::R140: the Rector does NOT recall an innocent older copy',
      '43-dark-c.test.ts::R140: the Distiller does NOT cache an innocent older copy',
      '43-dark-c.test.ts::R140: eraseFromZone can be told WHICH bin slot to take',
      '26-metal-a.test.ts::R140: Biomass Devourer does NOT erase an innocent older copy',
      '26-metal-a.test.ts::R140: a stolen unit dies',
      '90-coverage-census.test.ts::R140: no card responding to a bin-index event re-finds its card by lastIndexOf',
    ],
  },
  // ── the SMVJ batch (2026-08-24 afternoon, reports #94-#102) ───────────
  // Nine reports arrived while round 22 was being worked. None is a card
  // doing the wrong thing except CT-29/CT-30; the rest are the client and two
  // rules questions. Each carries `reportId` so 83's cross-check binds them.
  {
    id: 28, area: 'client', severity: 'minor', reportId: 94,
    title: 'The stack resolves faster than a human can read it',
    detail:
      'With auto-yield on and nothing to respond to, the whole stack resolves in one frame. The '
      + 'log scrolls past and a player cannot tell WHY the board changed. Owner proposes a ceiling '
      + 'of about one item per second.',
    evidence: 'Owner report #94, room SMVJ, action 104.',
    fix:
      'A throttle in the CLIENT render/animation layer, replaying the event list it already '
      + 'receives. The engine is pure and must NOT learn about wall-clock time — putting a delay '
      + 'in the reducer would make replay and the test suite time-dependent. Likely a queue in '
      + 'ui/main.ts that drains events on a timer, with a skip/fast-forward affordance so a player '
      + 'who does not want the pacing is not held hostage by it.',
    proof: null,
    verify: 'Play a battle with auto-yield on and a multi-item stack; the items should appear one '
      + 'at a time at a readable rate rather than all at once.',
    status: 'open',
  },
  {
    id: 29, area: 'card', severity: 'major', reportId: 95, cards: ['Hush Mush'],
    title: 'Hush Mush hands over control as a TRIGGER; the card says it is part of the spell',
    detail:
      'Printed: "Negate target effect. Its controller gains control of me." One spell resolution, '
      + 'no ability. The engine implements the handover as a `triggered` ability on the body\'s own '
      + '`spawned` event, passing the seat through battleCounters[HUSH_KEY], so the body spawns '
      + 'under the CASTER and changes hands a step later. The intermediate state is observable '
      + '(see CT-30) and a trigger can be responded to or suppressed where spell resolution cannot.',
    evidence: 'Owner report #95, room SMVJ, action 123. Confirmed by reading '
      + 'src/cards/sets/batch-wood-a.ts (card definition at ~line 506) against the printed text.',
    fix:
      'Spawn the body already under the negated effect\'s controller instead of handing it over. '
      + 'R107 (owner != controller on spawnUnit) is exactly this primitive and already exists, so '
      + 'this should DELETE the triggered ability and the HUSH_KEY battleCounters handoff rather '
      + 'than add machinery. Check the header note in batch-wood-a.ts about two Hush Mushes in one '
      + 'battle before removing the ledger key.',
    proof: () => {
      // TRUE while the handover is still a separate triggered ability
      const abil = (getCard('Hush Mush').abilities ?? []) as Array<{ type?: string }>;
      return abil.some(a => a.type === 'triggered');
    },
    status: 'done',
    guards: [
      '23-wood-a.test.ts::R143 #95: Hush Mush ENTERS under the negated',
      '23-wood-a.test.ts::R143 #96: the CASTER',
      '23-wood-a.test.ts::TWO Hush Mushes in one battle keep separate answers',
      '23-wood-a.test.ts::whose target has already left the stack fizzles',
    ],
  },
  {
    id: 30, area: 'card', severity: 'major', reportId: 96, cards: ['Hush Mush', 'Flourishing Flora'],
    title: 'Hush Mush briefly spawns as the CASTER\'s ally, firing their ally-spawn watchers',
    detail:
      'The observable half of CT-29, and the reason it is not cosmetic. Flourishing Flora is '
      + '"[Augment] Whenever another ally spawns, put a +1/+1 counter on me." Because Hush Mush '
      + 'enters under the caster and only then changes hands, the caster\'s ally-spawn watchers '
      + 'fire on a unit that was never meant to be theirs, and the caster gets a counter. WIDER '
      + 'THAN THE ONE CARD: every "whenever an ally spawns" watcher can see this intermediate '
      + 'state; Flourishing Flora is just the one that happened to be on the board.',
    evidence: 'Owner report #96, room SMVJ, action 123 — the owner refused a counter he could see '
      + 'was wrong. Same action index as #95: cause and symptom, reported one minute apart.',
    fix: 'Fixing CT-29 fixes this: if the body never enters under the caster, no ally-spawn '
      + 'watcher of theirs can observe it. Pin it with a test that puts Flourishing Flora on the '
      + 'CASTER\'s board and asserts it gains NO counter when Hush Mush resolves.',
    proof: null,
    verify: 'Control Flourishing Flora, cast Hush Mush negating an opponent effect: Flora must not '
      + 'gain a counter, and the body must appear on the opponent\'s side without a handover step.',
    status: 'done',
    guards: [
      '23-wood-a.test.ts::R143 #95: Hush Mush ENTERS under the negated',
      '23-wood-a.test.ts::R143 #96: the CASTER',
      '23-wood-a.test.ts::TWO Hush Mushes in one battle keep separate answers',
      '23-wood-a.test.ts::whose target has already left the stack fizzles',
    ],
  },
  {
    id: 31, area: 'client', severity: 'minor', reportId: 97,
    title: 'Dormant resources read as active outside planning',
    detail:
      'A dormant resource cannot be spent until it activates, but it is drawn similarly enough to '
      + 'an active one to be miscounted mid-battle, when a player is totting up available mana '
      + 'under time pressure.',
    evidence: 'Owner report #97, room SMVJ, action 149.',
    fix: 'Phase-scope the presentation, per the owner\'s own proposal: de-emphasise or hide '
      + 'dormant resources during battle and deployment, and show them normally during planning, '
      + 'which is the phase you actually act on them in. Presentation only — no engine change.',
    proof: null,
    verify: 'During battle, dormant resources must be visually distinct from (or absent beside) '
      + 'active ones; during planning they appear as they do today.',
    status: 'open',
  },
  {
    id: 32, area: 'client', severity: 'minor', reportId: 98,
    title: 'One player resolving triggers blocks the other player\'s simultaneous deployment',
    detail:
      'Deployment is SIMULTANEOUS — both players act and moves are revealed when both are done — '
      + 'so an opponent working through a pile of start-of-combat triggers should not seize your '
      + 'screen or block your input while you deploy.',
    evidence: 'Owner report #98, room SMVJ, action 238 (a stack of Wraith triggers).',
    fix: 'Client concurrency: the opponent\'s trigger resolution should render without taking '
      + 'input focus or gating the local deploy UI. Related to CT-35, which is the rules-side '
      + 'proposal for the same pile of triggers.',
    proof: null,
    verify: 'While the opponent resolves start-of-combat triggers, you can still place and confirm '
      + 'deployment moves without waiting.',
    status: 'open',
  },
  {
    id: 33, area: 'client', severity: 'minor', reportId: 99,
    title: 'A token created with X=5 still prints a literal "X" in its text box',
    detail:
      'The value is known when the token is created, but the box shows the generic printed text, '
      + 'so the player must remember what it was made for. Owner: a Poison 5 should read "Put 5 '
      + '-1/-1 counters on target unit". NOT the markup class (R134/R141/R142) — nothing is failing '
      + 'to be consumed here; this is a live per-instance VALUE that should be substituted in.',
    evidence: 'Owner report #99, room SMVJ, action 264.',
    fix:
      'Decide where the substitution lives: stamped onto the token entity at creation, or done by '
      + 'the text box reading the entity\'s stored X. Prefer the latter — the printed text stays '
      + 'the printed text and only the DISPLAY specialises, which keeps printed.json (generated) '
      + 'and the per-instance value from being confused. Applies to every X-valued token, not just '
      + 'Poison.',
    proof: null,
    verify: 'Create a Poison with X=5; its text box reads "5", not "X".',
    status: 'open',
  },
  {
    id: 34, area: 'client', severity: 'major', reportId: 100,
    title: 'The R120 elective damage-split UI is confusing',
    detail:
      'The mechanic is right — R120 made the combat damage split ELECTIVE because "never decide '
      + 'for the player" — but the affordance is not. Owner: "terrible and confusing".',
    evidence: 'Owner report #100, room SMVJ, action 290.',
    fix:
      'The owner names it exactly: a per-unit up/down ticker, constrained so the assignments '
      + 'always sum to the damage available. ⚠ REUSE, do not rewrite: R139/BL-25 just built this '
      + 'shape for counter removal — a stepper with a max asked of the engine, clamped, an "All" '
      + 'that sets without submitting — lifted into ui/inspect.ts precisely so it is testable. A '
      + 'second independent stepper implementation is how the two drift apart.',
    proof: null,
    verify: 'Assign combat damage across several blockers with steppers; the total is forced to '
      + 'match the damage available and nothing submits until you confirm.',
    status: 'open',
  },
  {
    id: 35, area: 'engine', severity: 'major', reportId: 101,
    title: 'RULES QUESTION: should deployment use the stack, and may triggers over-target?',
    detail:
      '⚠ A RULES CHANGE, not a defect, and the largest item in this batch. Owner: "Deployment '
      + 'should use the stack. All Wraith triggers should go onto the stack simultaneously and be '
      + 'allowed to target the same unit, even exceeding its defense (the final triggers would '
      + 'just fizzle)." Two separable claims: (a) deployment-phase triggers use the STACK like '
      + 'everything else; (b) several may target the SAME unit even when the total exceeds what it '
      + 'can absorb, the surplus fizzling ON RESOLUTION rather than being prevented at targeting '
      + 'time. (b) is the load-bearing half — it says targeting must not pre-validate against a '
      + 'limit that earlier-resolving triggers may consume, which is the ordinary fizzle rule.',
    evidence: 'Owner report #101, room SMVJ, action 318.',
    fix:
      'DO NOT START until the owner confirms scope — this touches the deployment phase, the stack '
      + 'and every start-of-deployment trigger, and (b) may change existing targeting restrictions '
      + 'across the pool. Get a ruling number, then split (a) and (b) into separate commits so '
      + 'either can be reverted alone.',
    proof: null,
    verify: 'Owner ruling required before implementation.',
    status: 'done',
    guards: [
      '37-attrs-wight.test.ts::R144(a): every start-of-deployment trigger is on the stack before any of them resolves',
      '37-attrs-wight.test.ts::R144(b): three Wraith triggers may all aim at one 1/1, and the surplus fizzles',
      '37-attrs-wight.test.ts::does not pre-validate against a limit an earlier trigger will consume',
      '37-attrs-wight.test.ts::a subject is not a target',
      '37-attrs-wight.test.ts::R12 — a shared deployment stack does not let a Wraith reach across regions',
      '67-resolving-and-stack-viruses.test.ts::a NESTED resolution that suspends does not strand the outer marker',
    ],
  },
  {
    id: 36, area: 'client', severity: 'major', reportId: 102,
    title: "Caleb's formatting markup reaches the player: literal '/[', {i1} eating spaces",
    detail:
      'Owner: the {i}/{g}/"/" family is "pure engine markup used by some system Caleb uses to '
      + 'format cards better", so none of it may reach a player. Three renderer defects: "/[" '
      + 'prints literally on ~15 cards; consuming {i1} EATS THE ADJACENT SPACE, so Wither and '
      + 'Bloom renders "each enemy orput a +1/+1"; and a {/n} nested inside an unrecognised '
      + 'bracket never becomes a line break. Plus a DATA half — printed.json carries 49 cards with '
      + 'double spaces and 4 with layout hyphenation ("adja- cent", "oppo- nent" x3).',
    evidence:
      'Owner report #102, room SMVJ, action 341. Census of the whole pool: formatting family is '
      + '{i} 80, {/n} 73, {g} 8, {i1} 6, {/i} 5, {p} 2; the ~30 capitalised tokens are KEYWORD '
      + 'names and must keep showing. "/" settled: it occurs only as "/[…]" directly after a '
      + '[Switch1]/[Switch] marker, and is NOT the "/" of X/X or +1/+1 stat notation.',
    fix:
      'Renderer half in ui/cardtext.ts, with a whole-pool sweep over text AND type lines so no '
      + 'formatting token or "/[" can survive again. Data half in scripts/extract-printed.mjs — '
      + 'printed.json is GENERATED, so a hand edit there is silently wiped on the next '
      + 'regeneration. Linked Extinction\'s "Sacrifce a unit" was a typo in CALEB\'S SOURCE: the '
      + 'owner corrected it AT SOURCE on 2026-08-24 ("that\'s a typo in the backend"), in the '
      + 'oracle file, not by an extractor override. The general invariant replaced the '
      + 'single-card record: the extractor may change LAYOUT but never a word.',
    proof: null,
    verify: 'Render every card\'s text and type line: no {i}/{/i}/{i1}/{g}/{p}/{/n} and no "/[" '
      + 'survives, while X/X and +1/+1 are untouched and {Battle}/{Virus}/{Haste} still show.',
    status: 'done',
    guards: [
      '122-cardtext-markup.test.ts::R142: the /[…] box drops the slash and the brackets',
      '122-cardtext-markup.test.ts::R142: {i1} does not eat the space beside the word',
      '122-cardtext-markup.test.ts::R142: no card in the pool renders engine markup to a player',
      '122-cardtext-markup.test.ts::R142: no printed card carries a hyphenation artifact',
    ],
  },
  // ── found by R143's pool sweep (2026-08-24), not by a report ──────────
  {
    id: 37,
    area: 'card',
    severity: 'major',
    cards: ['Borrower of Forms', 'Nectar Ridge Oracle'],
    title: 'Borrower of Forms ENTERS as itself and only then becomes the copy',
    detail:
      'The same defect class as CT-29, one layer over: IDENTITY instead of CONTROL. Its spell '
      + 'parks the copied face and stats on a region ledger (`bof:*`) and its own `spawned` '
      + 'trigger claims them, so the body enters play as a plain Borrower of Forms and only '
      + 'afterwards becomes the thing it copied. Anything watching the spawn sees the wrong body. '
      + 'Nectar Ridge Oracle — "when an ally with greater defense than power spawns", which is '
      + "R1's own worked example — reads the pre-copy stats, and the player is asked a spurious "
      + 'trigger-ordering question that should not exist.',
    evidence:
      'Found 2026-08-24 by the R143 agent sweeping every giveControl / cross-seat spawn / '
      + 'opts.owner site in the pool after fixing Hush Mush. batch-metal-a.ts:477.',
    fix:
      'The same shape R143 used: carry the answer on the spell\'s own StackItem and apply it AS '
      + 'the body spawns, rather than parking it on a shared region ledger for a follow-up '
      + 'trigger to claim. R143 added `ctx.spawnUnder(seat)` for the controller; this wants the '
      + 'equivalent for the copied face/stats. Deletes the trigger and the ledger, as R143 did.',
    proof: null,
    verify:
      'Control a Nectar Ridge Oracle; cast Borrower of Forms copying something with greater '
      + 'defense than power. The Oracle must see the COPIED body, and no trigger-ordering '
      + 'question should be raised.',
    status: 'open',
  },
  {
    id: 38,
    area: 'engine',
    severity: 'major',
    cards: ['Mindspore Fiend', 'Organic Exchange', 'Download'],
    title: 'Three cards flip `controller` by raw assignment, bypassing E.giveControl',
    detail:
      'E.giveControl is the choke point for a control change: it propagates the new controller to '
      + "the unit's MODS, unslots it from the old formation and moves it to the new region. Three "
      + 'cards assign `controller` directly and skip all of it. Mindspore Fiend '
      + '(batch-wood-b.ts:121) is the worst: it skips the formation unslot and the region move as '
      + 'well, so it hands over a unit whose MODS STILL ANSWER TO THE OLD CONTROLLER. Organic '
      + 'Exchange (batch-wood-b.ts:224) and Download (batch-metal-a.ts:865) skip the mod '
      + 'propagation. Nothing reported this — it was found by sweep — so the failure is latent, '
      + 'not yet observed at a table.',
    evidence: "Found 2026-08-24 by the R143 agent's sweep of every control-change site in the pool.",
    fix:
      'Route all three through E.giveControl. Then pin the invariant the way R124 pinned the bin '
      + 'choke point: a STATIC sweep in 90-coverage-census asserting that the only assignment to '
      + '`.controller` on a unit in src/cards/ is inside giveControl itself, so the next bypass '
      + 'fails a test instead of waiting to be swept up.',
    proof: null,
    verify:
      'Give a MODDED unit away with Mindspore Fiend: the mods must answer to the new controller, '
      + 'and the unit must leave the old formation and move region.',
    status: 'open',
  },
  {
    id: 39,
    area: 'engine',
    severity: 'minor',
    title: 'No event fires when a unit changes controller',
    detail:
      "E.giveControl emits only an `info` line, so nothing in the pool can trigger on \"a unit "
      + 'changed controller\". No printed card needs it TODAY — this is a missing seam, recorded '
      + 'so the next card that prints "whenever you gain control of a unit" is a small change '
      + 'rather than a surprise.',
    evidence: "Found 2026-08-24 by the R143 agent's control-change sweep.",
    fix:
      "Emit a real typed event from giveControl (both seats' listeners, region-scoped per R12) "
      + 'and add it to the event vocabulary that 84-card-semantics reads. Do it WITH the first '
      + 'card that needs it, not before — an event nothing listens to is untested surface.',
    proof: null,
    verify: 'No card needs this yet; verify when one does.',
    status: 'open',
  },
  // ── found by the R146 sweep of bin entries written by CARD code ───────
  {
    id: 40,
    area: 'card',
    severity: 'major',
    cards: ['Hooba-Mon'],
    title: "Hooba-Mon's exchange binned an {Unstable} body and left it there",
    detail:
      '"[Augment] When I attack, you may exchange me for target unit in your bin with cost 3 or '
      + 'less." The exchange sends the outgoing body to its owner\'s bin FROM PLAY, and '
      + '`exchangeInPlace` pushed the card and trashed it and stopped. On the AUGMENT line — the '
      + 'line the card is printed for — `self` is the HOST WEARING Hooba-Mon, so it carries a mod '
      + 'and is {Unstable} by derivation (R69/R79). R137/R145: an Unstable card leaving an active '
      + 'zone into a bin is binned, trashed there, and then SWEPT into the erased pile. This one '
      + 'stayed in the bin instead — fully recurrable, and still counting toward every "cards in '
      + 'your bin" effect and every "erase X from your bin" cost. It was the only bin entry in '
      + 'card code that disagreed with E.destroy about the same disposal.',
    evidence:
      'Found 2026-08-25 by the R146 audit of every site in src/cards/ that writes to a bin '
      + 'without going through E.toBin or E.destroy. Two sites; this was one of them.',
    fix:
      'FIXED 2026-08-25 (R146). `exchangeInPlace` asks `g.isUnstable(self)` BEFORE deleting the '
      + "host's mods (isUnstable derives from `self.mods`), then follows destroy()'s statement "
      + 'order exactly: push, `noteTrashed`, and — when Unstable — `eraseFromZone(..., "bin", '
      + '{ index })` naming the slot it just pushed (R140, never a name search). A TOKEN host is '
      + 'unchanged: no card, so nothing to bin, trash or erase.',
    proof: null,
    verify:
      'Augment Hooba-Mon onto a host, attack, and take the exchange: the HOST card must fire a '
      + '`trashed` event and then an `erased` one, in that order, and must not be in the bin '
      + 'afterwards. Played NORMALLY (unmodded) it must still be binned and stay there.',
    guards: [
      '42-dark-b.test.ts::Hooba-Mon exchanges a MODDED host',
      '42-dark-b.test.ts::Hooba-Mon exchanges an UNMODDED host',
      '42-dark-b.test.ts::Hooba-Mon exchanges a TOKEN host',
    ],
    status: 'done',
  },
  {
    id: 41,
    area: 'card',
    severity: 'major',
    cards: ['Tides of the Cosmos', 'Collect Remains', 'Suspend', 'Temporal Rift'],
    title: 'A spell played free by Tides of the Cosmos could not obey its own "Erase me."',
    detail:
      '`playInline` (batch-water-a) — the shared "play this card as part of my resolution" helper '
      + 'behind Tides of the Cosmos, Hooba-Pon, Insidious Invitation and Spell Excavation — passed '
      + '`eraseSelf: () => {}` to the effect it ran, with the comment "an inline mod run has no '
      + 'stack item to erase". True about the mechanism, wrong as an answer: Collect Remains, '
      + 'Suspend and Temporal Rift each print a self-erase sentence, and played for free off the '
      + 'top of the deck by Tides they were BINNED and stayed recurrable. This is CARD-TODO #15 '
      + 'over again on a second route — and hidden the same way, because the other half of each '
      + "card worked. Tides also wrote its bin entry as a raw `bin.push`, bypassing E.toBin.",
    evidence:
      'Found 2026-08-25 by the R146 audit of bin writes in src/cards/, which turned up the raw '
      + 'push and then the swallowed eraseSelf one line above it.',
    fix:
      'FIXED 2026-08-25 (R146). `InlinePlay` carries an `eraseSelf` flag: playInline records the '
      + 'request and the CALLER, which is what decides where the card goes, honours it — the same '
      + 'split `StackItem.eraseSelf`/`dischargeItem` uses. Tides erases instead of binning when it '
      + 'is set, and otherwise goes through `E.toBin(..., "stack")`. The other three call sites '
      + 'were checked: Hooba-Pon and Insidious Invitation only reach their disposal on a FIZZLE, '
      + 'where the effect never ran and the flag cannot be set, and Spell Excavation never bins '
      + 'what it played (R96).',
    proof: null,
    verify:
      'Stack Suspend on top of the deck and cast Tides of the Cosmos; take Suspend as a free play. '
      + "It must reach the caster's erased pile and must not appear in the bin.",
    guards: [
      '15-water-b.test.ts::for free → the ERASED pile',
      '15-water-b.test.ts::Tides plays an ORDINARY spell for free',
    ],
    status: 'done',
  },
];
