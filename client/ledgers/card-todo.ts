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
  // ── Competitive Constructed, 2026-11-02 (the round reserved CT-500..519): all
  //    closed, in card-todo-closed.ts; 503 was the corpus rebuild, done at
  //    landing in 3b7c7be6, and 505..507 were never used
  // ── the report triage of 2026-11-06 ────────────────────────────────────
  {
    id: 531, area: "client", severity: "minor",
    title: "the league match waiting room carries three explanatory lines the owner wants gone",
    detail: "Owner report #329 (page lobby, 2026-11-06): \"I don't like the redundant AI like text on the 'join a match' page. 'Deals when both decks are in.' can go and so can 'They join from their own League page — tell them on Discord you are here.' and 'Any deck. Keep it or change it every game.' as well. Just remove it.\" All three are in ui/pages/waiting.ts constructedWaitingHtml, the constructed (league) match room: the foot line \"Deals when both decks are in.\" (every constructed room), the deck row's hint \"Any deck. Keep it or change it every game.\" (league only), and the waiting hint \"Waiting for your opponent. They join from their own League page — tell them on Discord you are here.\" (league, opponent absent). The same waiting sentence is also printed by ui/pages/lobby.ts lobbyHtml for a random (league) live draft, and ui test 971 asserts it there (\"tell them on Discord you are here\").",
    evidence: "Report #329 (mycheze, owner, 2026-11-06T08:08Z, kind ux, minor); the strings found by grep at 7daed329.",
    fix: "Delete the three strings from constructedWaitingHtml (keep \"Waiting for your opponent.\" only if the hint would otherwise leave the room with no sign it is waiting — the seat row already says \"not here yet\"), drop the same League-page sentence from lobby.ts's league draft lobby, and move 971's assertion to their absence. Page test only; no flow changes.",
    proof: () => still('ui/pages/waiting.ts', 'Deals when both decks are in.', 'tell them on Discord you are here', 'Keep it or change it every game.'),
    reportId: 329,
    status: 'open',
  },
  // ── the report triage of 2026-11-07 ────────────────────────────────────
  {
    id: 534, area: "engine", severity: "major",
    cards: ["Blightwalker", "Splort", "Dropslime"],
    title: "a grafted Blightwalker cannot recall the card whose trashing set it off: Splort's composite would not offer Dropslime",
    detail: "Report #338 (invi, XWDS, 2026-11-07): \"I should be able to target dropslime with the trigger of splort (whos grafted blightwalker triggers with it)\". Blightwalker: \"When I am trashed, [Switch1] You may pay [2] to recall another target unit from your bin.\" Grafted onto Splort (\"When another card is trashed, [Switch1] I deal 2 damage to any target\"), the effect rides Splort's cause (CR 722.4), and on a mod's text \"I\", \"me\" and \"my\" mean the host (CR 720.6c): \"another\" excludes Splort, which is in play, so every unit card in the controller's bin is a legal target. The engine excluded Dropslime, the card whose trashing fired the composite. The cause: blightwalkerRecall's restrict (cards/sets/batch-dark-c.ts ~line 181) calls notSelfBinCard (cards/dsl.ts ~line 702), which excludes the bin slot the firing 'trashed' event names. That is right for Blightwalker's own \"when I am trashed\" (the event's card IS me), and wrong whenever the effect runs as a graft, where the event is the host's cause and its card is somebody else. The class: every graftEffect whose restrict or run reads ctx.event as \"me\"; notSelfBinCard is imported only by batch-dark-c.ts, but grep the sets for graftEffect beside ctx.event / eventBinSlot before calling it one card.",
    evidence: "Report #338; XWDS fetched and rebuilt 2026-11-07 (steward triage): [166] invi discards Dropslime (\"Discard me\") in turn 5's block window; [167] orders Splort's and Dropslime's trash triggers; at [170] Splort's composite asks \"Blightwalker: pay [2] to recall another target unit from your bin\" with options Cthyrian Rector and No targets only, while invi's bin is [Cthyrian Rector, Darkblast, Dropslime]. Splort (unit 51) carries mods [53, 52]. Dropslime is a Blight Unit, so isUnitCard admits it; notSelfBinCard is what drops it.",
    fix: "Make the \"another\" exclusion read who \"me\" is: on Blightwalker's own trigger the trashed card, on a graft the host (ctx.sourceId, in play, so no bin slot is excluded). EffectCtx already tells donated text apart (ctx.selfModId, CR 720.6d); find or add the equivalent for a running graft part. Reproducer: Splort with Blightwalker grafted, Dropslime discarded, the target menu must offer Dropslime; and Blightwalker's own trigger must still not offer itself (the existing guard in 135/Blightwalker tests). Sweep the class above.",
    proof: () => still('engine/src/cards/sets/batch-dark-c.ts', "isUnitCard(t.binCard.card) && notSelfBinCard(g, t, ctx)")
      && still('engine/src/cards/dsl.ts', "if (!d || d['card'] !== t.binCard.card || d['seat'] !== t.binCard.seat) return true;"),
    reportId: 338,
    status: 'open',
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const CARD_TODO: TodoEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
