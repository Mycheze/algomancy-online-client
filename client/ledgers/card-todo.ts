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
 *   · `card-ledger.ts`     — the cards with a printed clause that does
 *                            nothing. Referenced by CT-8, not copied. NO COUNT
 *                            IS TYPED HERE ON PURPOSE: it is a work QUEUE and
 *                            its length going down is the metric, so a number
 *                            written here rots the moment the queue moves. It
 *                            has been EMPTY since 2026-08-23; `71-card-ledger`
 *                            reads it live.
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
  /**
   * What actually closed it, written at the time. Distinct from `fix`, which is
   * the plan BEFORE the work: this is the account afterwards, including the
   * places the plan turned out to be wrong. Optional, and only meaningful on a
   * `done` entry — the entries whose briefs were corrected by the agent doing
   * the work are the ones worth reading later, and a plan that was never
   * revisited is exactly how a "fixed" item stops describing reality.
   */
  closed?: string;
  /**
   * For a long-lived entry that is being worked down rather than finished in
   * one go: what the last round actually established, including where THIS
   * entry's own plan turned out to be wrong. CT-49's "activated abilities are
   * the cheap third" was off by a factor of four, and an entry that cannot
   * record that keeps sending the next round down the same path.
   */
  progress?: string;
  /**
   * `open` — still broken. `done` — fixed, and `guards` names what keeps it so.
   *
   * `wontfix` — THE OWNER DECIDED IT SHOULD NOT BE BUILT. Added 2026-08-29 for
   * CT-106, which had nowhere honest to go: there is no fix and therefore no
   * guard, so `done` is a lie the guard requirement correctly refuses; but
   * leaving it `open` means this queue reports work that nobody intends to do,
   * and a list that overstates what is left is the same dishonesty in the other
   * direction. `playtest-ledger.ts` has carried exactly this third state from
   * the beginning, for exactly this reason. A `wontfix` MUST carry `closed`
   * saying who decided and why — that is enforced below.
   */
  status: 'open' | 'done' | 'wontfix';
}
import '../engine/src/cards/registry.ts';
import { CLOSED } from './card-todo-closed.ts';
import { body, still, text } from './card-todo-helpers.ts';

// ── proofs for the comprehensive-rules findings (CT-226 on) ─────────────
// Each finding was re-checked against HEAD before it was filed. A proof
// here either re-runs the verifier's measurement or reads the line the
// finding quotes; when that line is gone the proof goes false and 83 names
// the entry to tick off (or throws, when the code it reads has moved).
// The readers (still, body) live in card-todo-helpers.ts, and the harness
// probes of the entries closed on 2026-10-22 moved with them to the closed half.

/** Everything still open. The closed entries — the bulk of the file until
 *  2026-09-03 — live in card-todo-closed.ts, unchanged and still run. */
const OPEN: TodoEntry[] = [
  // ── the comprehensive-rules export's findings, re-checked at HEAD and filed
  //    2026-10-10 (CT-226..CT-280 are reserved for that project). Each names its
  //    finding ids in data/comprehensive-rules/findings/, which carry the CT back.
  {
    id: 346, area: "engine", severity: "minor",
    cards: ["Hooba-Nan"],
    title: "a blocker's empty adjacent slots never include the front of a neighbouring unblocked column",
    detail: "CR 607.2. CT-249 made an unblocked attacking column a gap in the defending formation, so blockers either side of it are no longer neighbours. The slot code still offers a blocker no empty adjacent slot in that neighbouring column, even at its front, though that slot is empty and next to it. Unreached: the only card that places beside a unit by adjacency (Hooba-Nan) triggers on attack, not on block.",
    evidence: "The formation agent, engine ticket round 2026-10-22, fixing CT-249 (560 \"a blocker next to an unblocked column has no adjacent slot in it\" pins today's answer).",
    fix: "Nothing until a card can place beside a blocker. Then decide whether the front of an unblocked neighbouring column is an adjacent slot (CR 607.2), and flip 560's last test with it.",
    proof: null,
    verify: "Read 560 \"a blocker next to an unblocked column has no adjacent slot in it\"; check the pool for a block-time adjacency placer.",
    progress: "RE-CHECKED 2026-10-24 (R1024-engine.md), still unreachable. E.adjacentSlots has one caller, Hooba-Nan's \"[Augment] When I attack, ... create a 1/1 unit in all my empty adjacent slots\"; its only pool sibling, Rousing Spirit, places in \"the empty slot behind me\", its own column. No card places beside a blocker. The rule itself is unsettled: CR 607.2 lets a joining unit be placed there, CR 603.3b says a defending formation has no adjacent slots past its ends, and CT-249 made the unblocked column a gap in the defending grid. 560 still pins today's answer.",
    status: "open",
  },
  // ── the report round of 2026-10-23 ────────────────────────────────────
  {
    id: 362, area: "engine", severity: "minor",
    cards: [],
    title: "Electric is applied to effect damage only, never to combat damage",
    detail: "CR 802.17a: \"When an Electric source deals a unit more than its lethal damage, the excess may be dealt to a unit adjacent to that unit instead.\" It names no kind of damage, but the engine jumps Electric excess only for effect damage; a unit made Electric that deals excess combat damage to a blocker sends none on. No unit prints Electric, so it is reached only through grants (and Envoy of Lightning, whose grant is spell effects only).",
    evidence: "CR pass 2026-10-23 (r1022-handoff/CR-PASS-1023.md, new defect 3): an isolated verifier measured it while checking 802.25c.",
    fix: "Nothing until a card can put Electric on a fighting unit. Then extend the combat damage path as the designer describes (lethal to the struck unit first, then excess spread to adjacent units, repeated); until then the limit can be stated in CR 802.17 as an engine note.",
    proof: null,
    verify: "Grant Electric to an attacker that deals excess combat damage to a blocker with an adjacent unit: does the excess jump?",
    progress: "RESEARCHED 2026-10-24 (R1024-engine.md). The designer says Electric spreads combat damage too, all in rules-questions, 2023, before print. 2023-09-15, on a 2-power Deadly unit killing both units in its column: \"Yep\" / \"Also works great with piercing or electric\"; on an Electric attack, \"It's a recursive definition\" / \"So you kill something\" / \"(the front unit)\" / \"Then excess damage goes left right front or back\". 2023-09-16, on several Electric attackers: \"First they all hit and deal damage to the first units\" / \"You may assign as much as you want as long as it's at least lethal\" / \"Then you choose adjacent units and assign damage to those\" / \"And repeat until you run out of damage to spread\". 2023-12-20, asked whether a 4-attack Deadly Electric unit could kill 4 adjacent units: \"Yep\" / \"You could wipe a whole board\" / \"If you start on the end\". No RAQ thread covers Electric in combat. BUT NOTHING IN TODAY'S POOL CAN GRANT ELECTRIC TO A UNIT THAT FIGHTS: only Arc Lightning (a spell with no mod type line) and Envoy of Lightning (\"Your spell effects with a single target are Electric\"; Battle and Fight take two targets, CR 802.17j) name it, and The Omniphage, Borrower of Forms, Apex Prime and Hooba-God take only what units print, and no unit prints Electric. Only a test grant (552) reaches the limit. Whether a pre-print answer counts is the owner's call.",
    status: "open",
  },
  // ── Pass D, the mop-up and the replacement-order round, 2026-10-25: defects found and not fixed
  {
    id: 427, area: "engine", severity: "minor",
    title: "a split damage step fixes its schedule when the step begins; the designer says a column that dealt Swift damage deals no normal damage",
    detail: "CR 608.3 and 608.3d (combat.damage.split) state the owner's 2026-09-16 call: windows open after a sub-step only when it struck and a later one will, and the schedule is fixed when the step begins. Caleb, rules-questions 2025-04-20 [1363292630443626568]: \"If a column dealt swift damage, it won't deal normal damage. / If a column dealt normal damage it won't deal sluggish damage.\" That tracks what each column dealt rather than a schedule fixed at the start, which differs when a column gains or loses Swift or Sluggish mid-step.",
    evidence: "CR pass D 2026-10-25 (zero-handoff/PD-cr.md, tier-3 stretch): discrepancy D-U12-9, the quote checked against the rules-questions export.",
    fix: "Read the thread around the quote, then check 608.3d (redrafted in pass B+C) and the engine's strike memory (CR 608.2e) against it: a column that dealt Swift damage must not deal normal damage, and one that dealt normal must not deal Sluggish. If they disagree, change the engine or the rule, with a test.",
    proof: null,
    verify: "Give a Swift column Sluggish after it struck, and a normal column Sluggish after the normal sub-step: which strike again?",
    status: 'open',
  },
  {
    id: 428, area: "engine", severity: "minor",
    title: "a blocking formation with no living unit offers no position; the designer lets a unit be played into it even with no units",
    detail: "CR 602.6k states the owner's 2026-08-22 prose: \"with no living unit in the grid the answer is \\\"no slots\\\"\". Caleb, rules-questions 2024-05-07 [1237434283786768415], asked how a unit that joins a formation works with no units: \"You could play it directly into a blocking formation even if you had no units, but you can't play it into an attacking formation with no units because you just couldn't declare an attack with no units.\" The defender half differs.",
    evidence: "CR pass D 2026-10-25 (zero-handoff/PD-cr.md, tier-3 stretch): discrepancy D-U10-10, the quote checked against the rules-questions export.",
    fix: "Decide with the owner whether Caleb's 2024 answer stands. If it does, a unit played during a battle with an empty blocking side may enter the defending formation (a front slot facing an attacker); change the slot offer, redraft 602.6k and 602.7c, add a test and replay stored games.",
    proof: null,
    verify: "In a battle where you defend with no units, play a unit that may join a formation: is a blocking position offered?",
    status: 'open',
  },
  {
    id: 429, area: "card", severity: "minor",
    cards: ["Life Channel", "Arbiter of Vitality"],
    title: "Life Channel under Arbiter of Vitality gives +3/+3, not +6/+6: X adds the printed 3, not the life the spell gained",
    detail: "Life Channel prints \"You gain 3 life, then [Switch1] Target unit gains +X/+X until regroup, where X is the life you've gained in this battle.\" The spell run (batch-light-b.ts) reads the battle ledger before the gain and adds the printed 3 (\"const x = before + 3;\"). Measured under Arbiter of Vitality: life went up 6 and Good Whale went from 7/5 to 10/8. The card's xPreview says 3 too, so the stack caption matches the engine; both are wrong against the printed \"the life you've gained\".",
    evidence: "Pass D mop-up 2026-10-25 (zero-handoff/PM-client.md, new defect 1): the client agent, measuring CT-412's captions.",
    fix: "Read lifeGainedThisBattle after the gain (or use gainLife's return value) in the spell run and in xPreview; guard under Arbiter.",
    proof: () => still('engine/src/cards/sets/batch-light-b.ts', 'const x = before + 3;'),
    status: 'open',
  },
  {
    id: 430, area: "coverage", severity: "minor",
    title: "dsl.ts still calls the amount multipliers SUMMED and the additive-versus-multiplier order unanswered",
    detail: "The amountMultipliers doc comment in engine/src/cards/dsl.ts says \"the claiming factors are SUMMED into one multiplier (the owner's n*2*v)\"; E.amountFactor multiplies (2^n, CR 708.6), as the AmountMultiplier comment itself says. That AmountMultiplier comment still says how a multiplier composes with an additive AmountMod \"IS NOT ANSWERED\"; Caleb and the owner answered it (CT-425, the replacement-order round). Comments only.",
    evidence: "Pass D mop-up 2026-10-25 (zero-handoff/PM-client.md, new defect 2; zero-handoff/RO.md section 5, item 5).",
    fix: "Reword both comments to CR 708.6 and 708.6a as they stand after CT-425.",
    proof: () => still('engine/src/cards/dsl.ts', 'the claiming factors are SUMMED into one multiplier'),
    status: 'open',
  },
  {
    id: 431, area: "coverage", severity: "minor",
    title: "client/README.md says the regions board is behind the board toggle; it has been the default since 2026-09-26",
    detail: "The client/README.md row for docs/18-board-layout-v2.md reads \"the regions board: two interlocking Ls, region ≠ control, never scrolls — behind the ▦ board toggle\". The regions board is the default; the toggle now selects the classic board.",
    evidence: "Pass D paperwork 2026-10-25 (zero-handoff/PD-paper.md, new defect 1).",
    fix: "Reword the row: the regions board is the default, and the toggle selects the classic one.",
    proof: () => still('README.md', 'never scrolls — behind the ▦ board toggle'),
    status: 'open',
  },
  {
    id: 432, area: "coverage", severity: "minor",
    cards: ["Torrential Reclamation"],
    title: "test 182 still lists the Torrential Reclamation scaling question as open, quoting the old card text",
    detail: "182-correctness-sample.test.ts OPEN_QUESTIONS[0] asks whether \"for each ally recalled this way\" scales the sacrifice too, quoting \"Recall X target nontoken allies. Then each player sacrifices a unit and you lose 1 life for each ally recalled this way.\" The owner settled it (2026-08-25/28), and the designer's reworded text, now in the oracle (CT-374), puts the sacrifice inside the \"for each\".",
    evidence: "Pass D paperwork 2026-10-25 (zero-handoff/PD-paper.md, new defect 3).",
    fix: "Drop the question from OPEN_QUESTIONS (the tally line counts them), or keep it as history with the answer and the new text.",
    proof: () => still('engine/test/182-correctness-sample.test.ts', '"for each ally recalled this way" scale the SACRIFICE too'),
    status: 'open',
  },
  {
    id: 433, area: "client", severity: "minor",
    title: "the glossary {Reaping} row says one kill draws a card; CR 802.21a says killing one or more units draws one card",
    detail: "ui/glossary.ts row Reaping: \"When it kills a unit, its controller draws a card.\" CR 802.21a: a reaping source that kills one or more units draws one card. Players see the printed sentence (scan-reminders.json), but the full row text is the old paraphrase. 156 derives KILL_RIDERS from this row text, so a reword must keep that derivation.",
    evidence: "Pass D paperwork 2026-10-25 (zero-handoff/PD-paper.md, new defect 4), while fixing CT-173's comments.",
    fix: "Reword the row to CR 802.21a, then run 156, 177 and 227.",
    proof: () => still('ui/glossary.ts', "text: 'When it kills a unit, its controller draws a card.'"),
    status: 'open',
  },
  {
    id: 434, area: "engine", severity: "minor",
    title: "the declineCost branch of the grafted cast-cost decision is believed dead since the cost became a cast-time payment",
    detail: "engine.ts, the grafted cast-cost decision: \"if ('declineCost' in obj) {\". Since CR 111.15 and CT-216 a grafted cost is paid as the composite goes on the stack, and nothing is believed to reach the decline branch. CT-391 kept it and described it as believed dead, because that pass made no behaviour change.",
    evidence: "Pass D paperwork 2026-10-25 (zero-handoff/PD-paper.md, new defect 5), closing CT-391.",
    fix: "Prove nothing reaches it (a throw in the branch under the whole engine suite), delete it with 393's two guards as the net, and replay stored games.",
    proof: () => still('engine/src/engine.ts', "if ('declineCost' in obj) {"),
    status: 'open',
  },
  {
    id: 435, area: "engine", severity: "minor",
    cards: ["Infernal Cultivator", "Malevolent Machinations"],
    title: "a [Sacrifice X units] cost destroys its units one at a time, so they are not one death batch; whether they should be needs a source",
    detail: "CT-414 made the units one sacrifice instruction takes die together (Caleb: \"Sacrifices are resolved simultaneously\"). Costs were left alone: the engine's cost payer (sacrificeUnits) still destroys one unit at a time for Infernal Cultivator, Malevolent Machinations and the other multi-unit sacrifice costs. Caleb's words were about an effect, not a cost.",
    evidence: "Pass D mop-up 2026-10-25 (zero-handoff/PM-engine.md, new defect 1).",
    fix: "Find a source on a multi-unit sacrifice cost (designer, then RAQ, then the owner). If they die together, pay through sacrificeTogether, guard with an Ancient One among the paid units, and replay stored games.",
    proof: null,
    verify: "Pay a two-unit sacrifice cost with an Ancient One beside a unit with a when-I-die line among the two: count its borrowed triggers.",
    status: 'open',
  },
  {
    id: 438, area: "coverage", severity: "minor",
    title: "after the replacement-order round, 472's first title and the engine.ts replacement comment still describe the old fixed order",
    detail: "472-counter-thief-and-rot-order.test.ts: \"CR 708.4a: two Counter Thieves — the player whose unit the counters were for is asked which keeps them\". Since the round the thieves' controller orders them; the test passes because in it that player owns both. The title is bound by CR 708.4a's record. The engine.ts comment above the replacement hooks still says the player the event happens to is asked, lists \"Cosmic Conspirators\" as order-insensitive (not so beside an Automaton) and says there is deliberately no general framework; E.replaceEvent is one now.",
    evidence: "The replacement-order build, zero-handoff/RO.md section 5 item 6 and section 6 (\"Also stale\").",
    fix: "Retitle 472's test to the controller rule and rebind 708.4a's example in the same change (cr scripts, re-verify); rewrite the engine.ts comment to point at E.replaceEvent.",
    proof: () => still('engine/test/472-counter-thief-and-rot-order.test.ts', 'the player whose unit the counters were for is asked') || still('engine/src/engine.ts', 'and Cosmic Conspirators (each asks its own controller'),
    status: 'open',
  },
  {
    id: 473, area: "client", severity: "minor",
    title: "a stack does-line turns \"pays\" into \"pay\" when the player's name ends in \" 1\"",
    detail: "renderTemplate's plural-to-singular rewrite also fires on a player name ending in \" 1\": a seat named \"Player 1\" reads \"Player 1 pay 5\" on Abduct.",
    evidence: "r1101c text agent, 2026-11-01 (775 names its seats to avoid it).",
    fix: "Apply the singular rewrite to the amount slot only, never to text that came from a player name.",
    proof: null,
    verify: "Abduct for 5 against a seat named \"Player 1\": read the stack line.",
    status: 'open',
  },
  {
    id: 474, area: "client", severity: "minor",
    title: "an activatable unit's ~8px pulsing glow is cut by its section edge",
    detail: "After the #315 fix every card ring fits its zone, but the soft glow on a unit with an activatable ability is ~8px and is still clipped by its section and the window. Also: at a region's outer left edge the region's own coloured border now sits over the outer ~2px of a 3px ring.",
    evidence: "r1101c edges agent measurements, 2026-11-01.",
    fix: "Owner call: give the glow room (spacing change) or shrink it to the ring's 3px.",
    proof: null,
    verify: "An activatable unit flush against the In Play edge: screenshot the glow.",
    status: 'open',
  },
  // ── Competitive Constructed, 2026-11-02 (the round reserved CT-500..519; the
  //    open ones are here, the closed ones in card-todo-closed.ts; 503 was the
  //    corpus rebuild, done at landing in 3b7c7be6, and 505..507 were never used)
  {
    id: 502, area: "coverage", severity: "minor",
    title: "four Competitive Constructed rules records name no test, though tests for them exist",
    detail: "The CR records formats.constructed.competitive.sideboard (7 cards; the copy cap counts deck and sideboard), formats.constructed.competitive.swaps (any exchange between games, deck at least 30), annexd.modes.competitive.sideboard-window (120 s or both Ready) and annexd.modes.competitive.initiative-choice (the loser chooses) render with no \"Tests:\" line, so nothing re-checks them.",
    evidence: "The Competitive register (var/records/cc-round-2026-11-02-register.md, W1 \"TO FILE: CT-502\"); re-checked 2026-11-03 in the rendered CR and Annex D, where those four keys carry no tests.",
    fix: "Bind each record to the test that already exercises it through the cr scripts (808 for the sideboard cap, 817 for the window and the exchange, 835 for the loser's choice), re-verify and re-render.",
    proof: null,
    verify: "Search Algomancy-Comprehensive-Rules.md and Annex-D-Digital-Conventions.md for the four keys: does each \"Key:\" line have a \"Tests:\" part?",
    status: 'open',
  },
  {
    id: 511, area: "coverage", severity: "minor",
    title: "several tests fail or hang only under machine load, and a parallel gate will make that worse",
    detail: "Seen during the 2026-11-02/03 rounds, each passing alone: server 594 (replay report run) flakes under load; server 486 timed out twice in a gate under agent load (7/7 alone); server 615 hung once; ui 294 section 4 (the prophecy meter) intermittent; ui 226 section 1a (log and naming) once with three ui-shots runs going.",
    evidence: "The Competitive register (W3 \"TO FILE: CT-511\") and the design-system register (gate1-3), ds-comp and ds-w2a records under var/records/.",
    fix: "For each, find what waits on wall-clock time and make it wait on the event instead (or give it a deadline that scales); BL-52 wants the gate parallel, so do this first.",
    proof: null,
    verify: "Run the full gate while three ui-shots runs are going: do any of 594, 486, 615, 294 or 226 fail?",
    status: 'open',
  },
  {
    id: 515, area: "client", severity: "minor",
    title: "a deck's text export drops its sideboard, and pasting the export back puts its maybeboard in the deck",
    detail: "ui/deckstats.ts deckListText writes the main list and then a \"// maybeboard\" divider with the maybeboard, and has no sideboard at all. server/decks.ts importDeckText skips every // line and adds every card line to the deck, so a round trip moves the maybeboard into the main deck and loses the sideboard. The rich file format carries both correctly.",
    evidence: "The Competitive builder stream (register, W5 \"TO FILE at landing: CT-515\"), pre-existing in importDeckText; re-checked 2026-11-03 in both files.",
    fix: "Give the text grammar a sideboard divider, export it, and make importDeckText read the divider lines (maybeboard and sideboard) into their own lists; extend 188's round trip to both.",
    proof: () => still('ui/decks.ts', 'deckListText(d.name, d.cards, d.maybe, d.url)') && still('server/decks.ts', "if (!line || line.startsWith('#') || line.startsWith('//')) continue;"),
    status: 'open',
  },
  {
    id: 516, area: "client", severity: "minor",
    title: "the deck builder's sideboard pile was never tried in Firefox, by touch drag or on an iPad",
    detail: "The Competitive builder stream added a sideboard pile (5/7) to the tabletop builder and drove it in headless Chrome only. drag.ts has a Firefox guard and scans are draggable=false, but nobody has dragged a card to or from the sideboard pile with a finger or in Firefox. 2026-11-04 (BL-65): the rebuilt builder's Sideboard rail and the Competitive sideboarding table were dragged both ways in REAL Firefox 158 over BiDi and with Chrome touch emulation at 1024 and 768 (var/records/bl65/handoff-W5b.md). A real iPad is still untried.",
    evidence: "The Competitive register (W5 \"CT-516 not verified in Firefox / touch drag / iPad\").",
    fix: "Drag cards both ways between the deck and the sideboard pile on a real iPad and in Firefox; fix what does not move, and add a ui-driver touch case if one is missing.",
    proof: null,
    verify: "On an iPad, open a deck on the tabletop and drag a card onto the sideboard pile and back.",
    status: 'open',
  },
  {
    id: 520, area: "client", severity: "minor",
    title: "at 768 wide a long deck name runs under the builder's card-count pill",
    detail: "The builder's toolbar title (the deck name, tap to open Deck info) and the count pill share the toolbar's left side. At 768x1024 a long name such as 'Single-Box Battle Deck - Fire v1.1.0' runs under the pill instead of being cut short.",
    evidence: "BL-65 W5b, real Firefox at 768x1024 (var/records/bl65/handoff-W5b.md, Found).",
    fix: "Let the title shrink and ellipsize before the pill (min-width: 0, text-overflow on the title), measured at 768.",
    proof: null,
    verify: "Open a deck with a long name on the table at 768x1024: is the whole pill readable?",
    status: 'open',
  },
  {
    id: 521, area: "client", severity: "minor",
    title: "a card dropped on the table's Main deck header row makes a new pile at the end",
    detail: "On the builder, the row that says MAIN DECK n with + Pile and Re-sort is part of the table's drop zone. A card let go there lands in a new pile after the last one, which reads as a stray pile the player did not ask for.",
    evidence: "BL-65 W5b real-input runs (var/records/bl65/handoff-W5b.md, Found).",
    fix: "Make the header row not a drop target (the card goes back where it came from), or treat it as the end of the nearest pile; decide which with the owner.",
    proof: null,
    verify: "Drag a deck card onto the MAIN DECK header row and let go: does a new pile appear?",
    status: 'open',
  },
  {
    id: 522, area: "client", severity: "minor",
    title: "[[Card Name]] in a deck description is not a card link",
    detail: "A description written with the common [[Card Name]] convention shows the brackets around the name. The description's card links come from ui/cardlinks.ts, which links names written plainly; master did the same before BL-65, so this is not a regression.",
    evidence: "BL-65 W3 screenshot of a shared deck (var/records/bl65/shots/W3/shared-deck-1440x900.png); W5a compared master f5f08c5c's renderer (handoff-W5a.md, F9).",
    fix: "Accept [[Name]] in cardlinks as a link to Name and drop the brackets; keep plain names linking as they do.",
    proof: null,
    verify: "Write [[Bumblecrab]] in a description: does it show as a link with no brackets?",
    status: 'open',
  },
  // ── the report triage of 2026-11-03 (reports #319-#325; the steward; filed as CT-520..522, renumbered 526..528 on landing) ───────
  {
    id: 526, area: "client", severity: "minor",
    cards: ["Thoughtripper", "Reclaimer of Secrets", "Tempest Oracle", "Blightwalker", "Rotling", "Swarmling"],
    title: "a \"you may pay [N]\" trigger's stack line states the effect as certain before the payment is decided",
    detail: "Thoughtripper prints \"you may pay [2]: each opponent discards a card\"; its does-line is \"{opponent} discards a card\", so while it waits on the stack it reads as if the opponent will discard, though its controller has not yet chosen to pay. Seven of the nine \"you may pay\" triggers in the pool drop the condition: Reclaimer of Secrets (\"Recall {0}\"), Tempest Oracle, Blightwalker, Rotling, Thoughtripper and both Swarmling triggers. Afflicting Anima and Sacrifice Dude already say it (\"… if you pay 1\", \"… if you pay 2\").",
    evidence: "Report #319 (KFCS @143, mycheze, owner): \"Helper text while Thoughtripper trigger on the stack says 'Gember WILL discard' but I haven't paid or not yet.\" Replayed: the board at 143 has Thoughtripper's trigger on the stack. Swept allCardNames() for labels matching /may pay/ against ui/does-lines.json (2026-11-03): the seven above have no condition in their line.",
    fix: "Give each of the seven lines the condition in the register the two correct ones use (\"… if you pay 2\"), and add a ui test that walks every ability whose label says \"may pay\" and fails on a does-line without \"if you pay\" (or an agreed equivalent) — 344 walks the templates but asks nothing about optional costs.",
    proof: () => still('ui/does-lines.json', '"ability:Thoughtripper#0": "{opponent} discards a card"'),
    reportId: 319,
    status: 'open',
  },
  {
    id: 527, area: "client", severity: "minor",
    cards: ["Spell Excavation", "Recall"],
    title: "a player passed seven windows with a Spell Excavation'd Recall playable and says they were never given priority to play it",
    detail: "KFCS turn 6 battle: Gember cast Spell Excavation on Recall [263-264] (\"you may play target spell from your bin until regroup\"). From [268] to [282] the engine offered seat 0 playFromBin on both Recalls (bin 7 and 8) at every one of Gember's seven priority windows, and Gember passed each one; ui/main.ts binUsableIndexes glows exactly those bin entries. The players then agreed a 2-life edit on each side to make up for it. The room file cannot say whether those passes were clicks or a standing Pass all: under 'all' mode passAllRelease deliberately asks no change clause (CR D2.2), so an option granted mid-phase would not hand priority back.",
    evidence: "Report #321 (KFCS @283, agreed edit, mycheze proposed, Gember agreed): \"Gember didn't get to play Recall from her bin during that turn for some reason. She spell extracted it but didn't get priority to play it.\" legalActions replayed at each of [266]-[282] (2026-11-03).",
    fix: "First find out: re-create the board (Spell Excavation resolving under a Pass all armed earlier in the battle) and see whether the chip passes through the new bin play. If it does, the question for the owner is whether an option your OWN resolving spell grants should release Pass all; if it does not, the problem is how visible a playable bin card is (a glow inside a pile) — ask the players which.",
    proof: null,
    verify: "Arm Pass all in a battle, cast Spell Excavation on a spell in your bin, let it resolve: are you given priority with the bin card playable?",
    reportId: 321,
    status: 'open',
  },
  {
    id: 528, area: "client", severity: "minor",
    title: "casting a Burst token asks you to pick the token you just clicked again, and places the last one for you",
    detail: "CR 803.5d: the caster orders a Burst group one token at a time. Clicking a token sends castSpellToken {entityId, ordered: true}, but doCastSpellToken calls burstStep with no `picked`, so the clicked token is ignored and the first prompt asks which token resolves first — the player clicks the same token a second time. burstStep also takes the last remaining token without asking (\"else the only one left\"). The owner wants the clicked token to BE the first pick, and the last one clicked rather than placed for them.",
    evidence: "Report #322 (DQTX @134, mycheze, owner): \"the UI should force you to click on the first one again, it should automatically just assume the one you clicked is the first one you're casting. And the final one shouldn't be automatically selected. It throws off the whole sequence of actions.\" Replayed: [129] castSpellToken 46 ordered, then [130] the burstPick prompt.",
    fix: "Pass the clicked entityId to burstStep as the first `picked`; decide with the owner whether the last token is then a one-option prompt or a click on the board, update 358-burst-order(-ui) and CR 803.5d's record if the wording changes. Replays: an old log's extra [130]-style pick would then be one decide too many — check replay-room on the logged games before landing.",
    proof: () => still('engine/src/apply.ts', 'burstStep(e, seat, region, then, [], group.map(t => t.id));'),
    reportId: 322,
    status: 'open',
  },
  {
    id: 523, area: "client", severity: "minor",
    title: "a clock is seen ticking while its player is on Pass all; which window it was is not known",
    detail: "CR D3.2b: a player's clock does not run in a priority window their standing pass is answering. server/rooms.ts clockRunning honours it only where settlePassAll stamped the window: inPassWindow (no decision, the seat has priority, pass legal), the arm not released, no report dialog open, no proposal. Anything else is billed by design — a decision, a declaration, a deploy step — and the arm comes off at the phase change. The report does not say which window ticked. SHXD was game 3 of a Competitive match whose banks carry between games, and Gember lost it on time (clockMs [0, 539039]) at turn 4's planning.",
    evidence: "Report #323 (SHXD @109, mycheze, owner): \"When 'all passing' your clock still ticks down and it shouldn't.\" Report #325, two minutes after the game ended on time, disputes the result: \"We don't really want this to count.\"",
    fix: "Reproduce in a server test with a clocked room: arm Pass all in battle and walk the windows (opponent's stack items, the attack and block declarations, the battle-end pass, a deploy step), recording clockRun for the armed seat at each. Every billed window that is a pure pass window is the bug; the rest go to the owner as \"billed by design under D3.2b — should it be?\"",
    proof: null,
    verify: "Play a clocked game, arm Pass all at the start of a battle, and watch your own clock through the battle.",
    reportId: 323,
    status: 'open',
  },
  {
    id: 524, area: "client", severity: "minor",
    title: "a game lost on time has no way back to the post-game summary once you view the board",
    detail: "The post-game screen's \"view the final board\" (pg-close) hides it; the only way back is the prompt bar's \"Post-game summary\" button (pg-reopen), which ui/main.ts promptHtml renders only inside `if (s.phase === 'gameover')`. A game decided outside the state — a loss on time (BL-27, server decidedOutsideState) — never reaches phase 'gameover', so the bar shows the ordinary prompt and the summary is gone until a reload. SHXD ended on time at turn 4's planning step.",
    evidence: "Report #324 (SHXD @113, mycheze, owner): \"There's no way to get back to the 'Game Over' summary after you 'View Board'.\" Replayed: SHXD's final state is turn 4, phase planning, Gember's clock 0.",
    fix: "Key the bar's game-over branch (and the reopen button) on postGame being set, not on the state's phase, so a time loss and any other result decided off the state behave like a played-out one; a ui test rendering the bar with postGame set over a non-gameover state.",
    proof: () => body('ui/main.ts', "if (s.phase === 'gameover') {", 'Playtest 2026-08-20').includes('data-btn="pg-reopen"')
      && text('ui/main.ts').split('data-btn="pg-reopen"').length === 2,
    reportId: 324,
    status: 'open',
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const CARD_TODO: TodoEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
