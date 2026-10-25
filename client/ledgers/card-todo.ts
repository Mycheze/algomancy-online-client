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
import { still } from './card-todo-helpers.ts';

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
    id: 423, area: "engine", severity: "minor",
    cards: ["Hooba-Mon", "Necromorph"],
    title: "an exchanged Unstable (modded) unit is trashed before it is erased; CR 410.4d says it is erased instead of entering the bin and is not trashed",
    detail: "CR 410.4d (zones.changes.mods.exchanged), as redrafted in CR pass D: \"when it is exchanged out of play, it and all of its mods are erased instead of entering the bin. It is not trashed, because it never enters a bin\". Print decides it (the Unstable reminder: \"(If they would enter a bin, erase them instead.)\"), and the owner's 2026-10-22 call keeps an Unstable card's trash for a death. The engine bins the body, trashes it and then erases it on the exchange route: 42-dark-b asserts \"trashed, then ERASED\" and 129-disposal-tail (iii) the same verbs.",
    evidence: "CR pass D 2026-10-25 (zero-handoff/PD-cr.md, CT-388): finding F-U07-12, discrepancy D-U07-18.",
    fix: "In the exchange route (disposeToBin from exchangeInPlace), erase an Unstable body without binning or trashing it. Flip 42-dark-b's \"trashed, erased\" order assert and 129 (iii)'s body verbs, and rebind 410.4d's example; keep the death route (CT-246) as it is. Replay stored games: a Hooba-Mon or Necromorph exchange of a modded unit would stop firing trash watchers (the Dropslime count, Cerebrox).",
    proof: () => still('engine/test/42-dark-b.test.ts', 'Hooba-Mon exchanges a MODDED host → the host is trashed, then ERASED'),
    status: 'open',
  },
  {
    id: 424, area: "engine", severity: "minor",
    cards: ["Download"],
    title: "a unit stolen during a battle sits out until regroup, but the designer says the new controller can block with it",
    detail: "CR 711.3 states the owner's 2026-08-25 call (\"it sits out until regroup\"); the owner's 2026-08-18 call had it join the new controller's formations. Caleb, rules-questions 2025-09-08 [1414660063162798082], asked about stealing an attacking token with Download: \"you gain control of it so its no longer attacking and would be able to block. It cant attack an opponent in the same turn of a FFA game since there's only one declare attack step each turn\". The designer outranks an owner call in the authority order, so the rule and the engine may be wrong.",
    evidence: "CR pass D 2026-10-25 (zero-handoff/PD-cr.md, tier-3 stretch): discrepancy D-U16-11, the quote checked against the rules-questions export.",
    fix: "Put Caleb's words to the owner beside his 2026-08-25 call. If Caleb's reading stands, a unit stolen in battle stops attacking and may block for its new controller; change the control-change path (Download and every in-battle steal), redraft 711.3, add a test, and replay stored games for drift.",
    proof: null,
    verify: "Steal an attacking unit with Download before blocks: can its new controller block with it?",
    status: 'open',
  },
  {
    id: 426, area: "engine", severity: "minor",
    title: "a Virus on a resolving spell unit stays on as an augment; the designer says a spell carrying a Virus is erased on resolution",
    detail: "CR 723.4c (effects.virus.spell-host.spell-unit) states the owner's 2026-08-22 exception: a spell unit enters play with the Virus as an augment instead of being erased. Caleb, rules-questions 2025-03-06 [1347270455198879858]: \"It's very similar to how regular viruses work. So you can hit enemy spells, the spell gets erased on resolution\". No source makes the spell-unit exception; the record says no ruling asks for it.",
    evidence: "CR pass D 2026-10-25 (zero-handoff/PD-cr.md, tier-3 stretch): discrepancy D-U17-3, the quote checked against the rules-questions export.",
    fix: "Ask the owner whether Caleb's \"the spell gets erased on resolution\" covers a spell unit. If it does, a virused spell unit is erased on resolution (it never arrives); change the resolution path, redraft 723.4c, add a test and replay stored games. If not, record the owner's answer as the source of 723.4c.",
    proof: null,
    verify: "Augment a Virus onto a spell unit on the stack and let it resolve: does the unit arrive with the Virus on it?",
    status: 'open',
  },
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
    id: 436, area: "client", severity: "minor",
    title: "in a mixed death batch every \"Deadly\" and \"Unaware\" line is logged before the first \"dies → bin\" line",
    detail: "Since CT-413 the Deadly, collapsed and Pure victims die in one batch with the lethal-damage deaths. The sweeps announce their victims as they decide, so all of a batch's \"Deadly — X dies.\" and \"Unaware: …\" lines come before the first \"dies → bin\" line instead of beside the unit each is about. Cosmetic.",
    evidence: "Pass D mop-up 2026-10-25 (zero-handoff/PM-engine.md, new defect 2).",
    fix: "Carry each doomed unit's line with it into destroyBatch and print it just before that unit's death line; keep the four literal ev() sites ui 244 counts.",
    proof: null,
    verify: "Deadly and lethal damage killing three units in one sub-step: read the log order.",
    status: 'open',
  },
  {
    id: 437, area: "engine", severity: "minor",
    cards: ["Automaton of Abundance", "Cosmic Conspirator", "Omniwield Evoker"],
    title: "in a mixed token batch with Automaton chosen first, a later spell token that Cosmic Conspirator turns into a Robot is still copied",
    detail: "The replacement-order round treats one creation batch as one event, but tokens are still created inline. In a mixed batch (a Robot and a Conspirator-kind spell token from one effect) where Automaton-first was chosen at the Robot, a later Poison that the Conspirator turns into a Robot is still copied; in the strict whole-batch reading it would not be, because Automaton had already applied to the batch. Only Omniwield Evoker graft combinations can make such a batch.",
    evidence: "The replacement-order design, zero-handoff/REPLACEMENT-ORDER.md section 4.1.1 (\"Known approximation\"), kept by the build (zero-handoff/RO.md section 5, item 4).",
    fix: "Deferring creation is not possible (three callers use the returned entity). Either record the batch order answer per event so a re-tested Automaton sees it has applied, or state the approximation in CR 708.9. Guard with an Evoker grafted with a Robot maker and a Poison maker.",
    proof: null,
    verify: "Omniwield Evoker grafted to make a Robot and a Poison, Automaton first at the Robot, the Poison turned into a Robot: is it copied?",
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
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const CARD_TODO: TodoEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
