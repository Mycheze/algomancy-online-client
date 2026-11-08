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
  // ── the report triage of 2026-11-07 ────────────────────────────────────
  {
    id: 535, area: "engine", severity: "minor",
    cards: ["Splort", "Blightwalker", "Dropslime", "Combustible Bogwalker"],
    title: "a trigger set off while a batch of triggers goes on the stack is ordered in with the rest of the batch instead of going on top",
    detail: "Report #339 (invi, YYAE, 2026-11-07): \"when putting a trigger on the stack triggers another trigger, the new trigger should always be on top of the others (i think, I'm not a 100 %)\". In the block window invi activated Combustible Bogwalker discarding Blightwalker: Splort's trash trigger and Blightwalker's own trash trigger fired together and invi ordered them (Blightwalker to resolve first). Putting Splort's composite on the stack meant discarding a card (the composite carries a \"discard a card\" cost), invi discarded Dropslime, and Dropslime's trash trigger fired — while Blightwalker, already ordered, was still waiting to go on. The engine then asked invi to order Blightwalker and Dropslime together, and Blightwalker went on top. CR 706.5: the triggers \"put on the stack at the same time\" (Splort and Blightwalker, one batch, one order) are ordered together; CR 706.3a: a trigger goes on the stack \"as soon as the action or resolution that made them trigger is complete, on top of anything already on the stack\" — the action that made Dropslime trigger is that batch being put on, so on this reading Dropslime goes above Blightwalker, as the reporter says. The cause: fireEvent's `if (queued) this.s.triggerOrderedSeats = [];   // new batch: (re)ask ordering` (engine.ts ~line 14287, and its twins ~3683, ~3725) treats a trigger queued DURING processTriggerQueue's drain (a cost paid or a target chosen while a queued trigger is built in stackPendingTrigger) as joining the batch still in the queue, so the drain re-asks the order over old and new together. The class: every trigger that can fire while a queued trigger is put on the stack — a cost paid by discarding, sacrificing or trashing (graft [cost]s, Splort-style composites), a \"when I become targeted\" trigger fired by a trigger's target (CR 110.11 already says that one goes above the effect that targeted), a Crevice Lurker tax payment (CR 111.10g) if paying it can trigger anything. Not judged yet: whether the opponent's waiting triggers (CR 703.4) are affected the same way.",
    evidence: "Report #339; YYAE fetched and replayed 2026-11-07 (steward triage), 257/257 actions, no divergence: [219] invi activates Combustible Bogwalker (augment); [221] discards Blightwalker for its cost; [222] orders \"Splort: deal 2 damage …\" and \"Blightwalker: you may pay [2] …\" as [1,0] (Blightwalker resolves first); [223]-[224] aims Splort's composite (Splort, then grafted Darkblast); [225] pays its \"discard a card\" with Dropslime; [226] is asked \"Order your triggers\" over Blightwalker AND Dropslime, answers [0,1]; at [229] the stack is Torrential Reclamation, Combustible Bogwalker, Splort, Dropslime, Blightwalker (top). Blightwalker then resolved first and recalled Dropslime.",
    fix: "Settle the reading first (skill §5: CR 706.3a/706.5 above, 110.11's \"above the effect that targeted\", RAQ threads on stack order) — if it holds, a trigger queued while the drain is putting a batch on goes on after the whole batch, on top, ordered only among the other new ones: keep the batch's order and mark the late triggers as a NEW batch the drain takes up once the old one is empty. Reproducer: the YYAE board at [225] (or a scenario with Splort carrying a discard-cost graft, Blightwalker and Dropslime in hand): Dropslime's trigger must end on top of Blightwalker's with no second order question offered over both. Pin the ordinary one-batch ordering tests (239, 136) unchanged.",
    proof: () => still('engine/src/engine.ts', "if (queued) this.s.triggerOrderedSeats = [];   // new batch: (re)ask ordering"),
    reportId: 339,
    status: 'open',
  },
  {
    id: 536, area: "engine", severity: "major",
    cards: ["Dropslime", "Bloated Manablub", "Molten Upheaval", "Void Memory", "Auric Ascendant"],
    title: "a modded unit's mods stay behind in its home region when it attacks: a mod trashed in that battle is not counted for Dropslime",
    detail: "Report #342 (invi, ASSX, 2026-11-07): \"augments falling off of a recalled creature should count as trashed for dropslime\". They do fire 'trashed', but noteTrashed (engine.ts ~line 3612) bumps the battle tally of `anchor.region`, and the anchor is the mod entity, whose region is stale. declareAttack moves the attackers into the battle region with `for (const id of [...columns.flat(), ...spellTokens]) e.entity(id)!.region = b.region;` (apply.ts ~line 2550) and never touches their mods, though every other region move does: the controller change (engine.ts ~line 8358, `for (const id of u.mods) … m.region = u.region`), a mod moved to a new host (~13957), and the regroup resync (~16650). So for the whole battle an attacker's mods report its home region. Dropslime (\"I deal damage equal to the cards trashed in this battle\") reads battleCounter(region, 'trashed'), Muck Rummager the per-seat one. The class, to sweep before calling it one counter: every reader of a mod entity's `.region` during battle — the two mod noteTrashed calls (engine.ts ~4578, ~7891), the radiator walk that groups anchors by `anchor.region` (~2939-2950: a radiating graft on an attacker may project into the wrong region), and anything keyed on `item.region` for a mod's own trigger.",
    evidence: "Report #342; ASSX fetched and replayed 2026-11-07 (steward triage repair), 298/298, no divergence: [226]-[227] Yagamino grafts Molten Upheaval (mod 91) and Void Memory (mod 92) onto Bloated Manablub (unit 90) in region 0; [250] Manablub attacks into region 1; before [258] the state has unit 90 in region 1 and mods 91, 92 in region 0; [258] Auric Ascendant recalls Manablub, 'trashed' fires for both mods with region 0; at [294] battleCounters are [{trashed:2,'trashed:0':2},{trashed:5,…}], and the two Dropslimes [295], [297] deal 5 each where seven cards were trashed in the battle.",
    fix: "Move the mods with their host when an attack is declared (the same one-liner engine.ts ~8358 uses), or better, have a mod's region always read through its host so it cannot go stale. Reproducer: a grafted or augmented unit attacks into the other region and is recalled or killed there; Dropslime's battle count must include its mods. Then sweep the class above, with a test for a radiating mod on an attacker if one exists.",
    proof: () => still('engine/src/apply.ts', "for (const id of [...columns.flat(), ...spellTokens]) e.entity(id)!.region = b.region;"),
    reportId: 342,
    status: 'open',
  },
  {
    id: 537, area: "client", severity: "minor",
    title: "a card that a stack item aims at says only that it is targeted, not by what",
    detail: "Report #341 (invi, ASSX, 2026-11-07, feature): \"when targeting, cards that are already targeted should not only say that they are targeted, but also by what (because it's sometimes ambiguous)\". A bin card aimed at carries binTargetBadge (ui/main.ts ~line 4684): \"🎯\" on a region thumb, \"🎯 targeted\" in the bin dialog, with a tooltip that names nothing. The stack rows' hover arrows (stackArrows, main.ts ~8434) show the link one item at a time, from the stack side only. With two items aiming at copies of one card the player cannot tell which is which from the card.",
    evidence: "Report #341; ASSX replayed 2026-11-07 (steward triage repair): at [276] Blightwalker's recall [269] and Combustible Bogwalker's recall (item 114) both aim at Dropslime copies in invi's bin. Hypothesis: that is the ambiguity invi meant; the report does not name the card.",
    fix: "Name the aiming item(s) on the card: the badge's tooltip (and the dialog's long label) lists the stack items aiming at it, e.g. \"🎯 Blightwalker\". Check units on the board too, wherever a target mark is drawn. Small; a page/ui test over the badge text.",
    proof: () => still('ui/main.ts', "t: short ? '🎯' : '🎯 targeted', cls: 'tgtnow',"),
    reportId: 341,
    status: 'open',
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const CARD_TODO: TodoEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
