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

/** Everything still open. The closed entries — the bulk of the file until
 *  2026-09-03 — live in card-todo-closed.ts, unchanged and still run. */
const OPEN: TodoEntry[] = [
  {
    id: 223, area: "attribute", severity: "major",
    title: "{Piercing} is automatic; the RAQ lets the attacker overkill a unit and keep the excess off the player",
    detail: "R7 (owner, 2026-07-16) made Piercing automatic. Two RAQ write-ups say otherwise: with Piercing \"the attacker may still overkill the front or back unit, keeping that excess off the player\", and a Piercing attacker may put all 10 into a Vulnerable unit (20) so none reaches the player. The RAQ is the authority (owner, 2026-10-09), so R7 is reversed.",
    evidence: "RAQ audit 2026-10-09. Threads \"[Solved] Excessive Combat Damage & interaction with Piercing, Deadly and Phytochemical Protection\" and \"[Solved] Vulnerable + Piercing / Electric\", _passer. The owner: \"we can reuse the blocking damage assignment UI\".",
    fix: "Let a Piercing column assign its damage the way a blocked column already does (the existing damage-assignment UI), with the player as one more place excess may or may not go. New ruling reversing R7, citing both threads.",
    proof: null,
    verify: "Attack with a Piercing unit into one blocker: the attacker is asked how to assign, and may keep everything on the blocker.",
    status: "open",
  },
  {
    id: 224, area: "card", severity: "minor",
    cards: ["Stasis Sentry"],
    title: "under Stasis Sentry an X spell keeps X below 3 and only pays more; the RAQ says X itself must be at least 3",
    detail: "R157 §20 raised only the COST to 3, so Wildfire cast at X=0 costs 3 and deals 0. The RAQ: under Stasis Sentry in battle an X spell's X must be at least 3 (Wildfire deals at least 3); it is not an additional cost. The RAQ is the authority (owner, 2026-10-09), so R157 §20 is reversed.",
    evidence: "RAQ audit 2026-10-09. Thread \"[Solved] Spells with cost X vs Stasis Sentry\".",
    fix: "Make Stasis Sentry raise the minimum X (the collectX floor) instead of the price. New ruling reversing R157 §20.",
    proof: null,
    verify: "Under Stasis Sentry in battle, cast Wildfire: X starts at 3 and it deals 3.",
    status: "open",
  },
  {
    id: 225, area: "card", severity: "minor",
    cards: ["Borrower of Forms"],
    title: "a Borrower of Forms that copied a modded unit is Unstable; the RAQ says a fresh copy is not",
    detail: "R118 ruling 2 (owner): \"Inherit the mods text, but it IS Unstable.\" The RAQ write-up says a freshly resolved Borrower that copied a modded unit is not Unstable. The RAQ is the authority (owner, 2026-10-09), so R118 ruling 2 is reversed.",
    evidence: "RAQ audit 2026-10-09. Thread \"[Solved & Expanding?] Borrower of Forms - The weird interactions\", _passer.",
    fix: "A copy inherits the mods' text but is not itself modded, so not Unstable. New ruling reversing R118 ruling 2; check what else reads \"modded\" off a copy.",
    proof: null,
    verify: "Borrower copies an Unstable modded unit and then dies: it goes to the bin, not erased.",
    status: "open",
  },
  {
    id: 200, area: "attribute", severity: "major",
    cards: ["Conduit of Pain"],
    title: "{Resonant} is applied as life loss, not as damage from an effect, so Conduit of Pain and Powerful never touch it",
    detail: "The printed reminder: \"Whenever a resonant source deals damage to a unit, it deals that much damage to that unit's controller.\" The engine calls loseLife inline, so Conduit of Pain cannot add its 1 (2 to the face instead of 3) and a Powerful Resonant source is not doubled on the face hit (4 instead of 8; 10 with Conduit).",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Resonant, Combat Damage, Conduit and Powerful\", _passer: \"put effect on stack to deal…\". digital-rules already marks the Powerful half \"OPEN\" with no ticket.",
    fix: "Make the Resonant rider deal damage from its source (an effect), so damage modifiers apply. Check R121 (CT-212 is the Crevice Lurker half of the same rider).",
    proof: null,
    verify: "Run the todo reproduction in 387-raq-combat.test.ts, the three \"RAQ Resonant:\" todo tests about Conduit and Powerful on the face hit. — it fails while this is open.",
    status: "open",
  },
  {
    id: 201, area: "attribute", severity: "minor",
    cards: ["Conduit of Pain", "Bellowing Boulder"],
    title: "Conduit of Pain is added after Powerful doubles; the RAQ adds it before",
    detail: "RAQ arithmetic: a Powerful Bellowing Boulder with Conduit deals (1+1)x2 = 4; the engine deals 1x2+1 = 3. The spec calls its order an \"interim decision\", not a ruling, and quotes this same thread as agreeing.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Resonant, Combat Damage, Conduit and Powerful\", _passer's worked numbers.",
    fix: "Follow the RAQ (the authority, owner 2026-10-09): additive modifiers apply before doubling. New ruling replacing the interim decision.",
    proof: null,
    verify: "Run the todo reproduction in 387-raq-combat.test.ts, \"RAQ Resonant: Conduit adds its 1 BEFORE Powerful doubles\" and the Bellowing Boulder 10-per-unit todo. — it fails while this is open.",
    status: "open",
  },
  {
    id: 202, area: "engine", severity: "major",
    cards: ["Tiderunner Initiate"],
    title: "a column does not remember which damage sub-step it struck in, so it can strike twice",
    detail: "Three RAQ claims fail: a Swift column whose Swift unit is removed strikes again at normal speed; a column that struck at normal speed and then gains Sluggish strikes again; a Tiderunner Initiate played into an emptied Swift column strikes. (A Swift column that gains Sluggish striking twice passes only because nothing is remembered.)",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Swift/Normal/Sluggish. Opportunity windows & Gaining-Losing Attributes\". Builds on R295.",
    fix: "Record per column the sub-step it dealt combat damage in; a column that has struck deals no more combat damage this battle.",
    proof: null,
    verify: "Run the todo reproduction in 388-raq-blocks-and-windows.test.ts, the three \"RAQ Swift:\" todo tests. — it fails while this is open.",
    status: "open",
  },
  {
    id: 203, area: "engine", severity: "major",
    cards: ["Roving Quillback", "Tiderunner Initiate"],
    title: "side-blocking is not implemented, and a defender cannot play a blocker opposite an unblocked column",
    detail: "The manual allows blocking in \"slots where attackers aren't\". Caleb confirmed Roving Quillback counts side-blocks and that eight units may side-block as eight columns; the engine refuses \"no such attacking column\". The same limit means Tiderunner Initiate cannot be played in opposite an unblocked attacker (Caleb's answers 3 and 4), and a column blocked that way should stay blocked if the blocker leaves. digital-rules mentions side-blocks only in prose as \"left alone deliberately\".",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Threads \"[Solved] What is blocked? <Bubby don't hurt me>\" (calebgannon answers 1-4) and \"[Solved] Piercing, side block and combat damage from defending formation\".",
    fix: "Settled by the thread: a flash blocker (Tiderunner Initiate) put opposite an unblocked column blocks it, and the column stays blocked if it is removed (Caleb 3, 4); side-blocks count as blocked for Roving Quillback (\"yeah it should!\"); any number of units may side-block, each its own column (Caleb, 2025-07-23). A block-declaration shape for blockers with no attacking column opposite, plus the flash-block placement. Large: UI and engine.",
    proof: null,
    verify: "Run the todo reproduction in 388-raq-blocks-and-windows.test.ts, the two \"RAQ Blocked:\" todo tests; 387 has the Piercing side-block claim. — it fails while this is open.",
    status: "open",
  },
  {
    id: 204, area: "attribute", severity: "minor",
    cards: ["Ember of Life"],
    title: "{Electric} excess is forced to jump, and dropped when there is nowhere to jump",
    detail: "The RAQ reads Electric's \"can be\" as optional: all 6 may stay on a Vulnerable unit (12). With no neighbour and no Piercing the engine drops the excess: a lone Vulnerable 3/8 is dealt 8, not 12, which also contradicts R114 (\"ALL damage is dealt to units\").",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Vulnerable + Piercing / Electric\", _passer.",
    fix: "Make the jump a choice, and never drop combat damage (R114). Check R7 (Piercing is automatic) is not the model copied here.",
    proof: null,
    verify: "Run the todo reproduction in 387-raq-combat.test.ts, the two \"RAQ Vulnerable:\" todo tests. — it fails while this is open.",
    status: "open",
  },
  {
    id: 205, area: "engine", severity: "minor",
    cards: ["Squish", "Chitin Shredder"],
    title: "a Powerful Squish/Fight/Battle spell doubles the damage; the spell is not the source",
    detail: "With a Chitin Shredder virus on the Squish stack item, it deals 6. The RAQ: \"It doesn't matter if Squish is Powerful\" — the unit deals the damage, so only the unit's attributes count.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Squish/Fight/Battle vs Source of damage & Interactions\", _passer. R294 settles that the unit is the source.",
    fix: "When a spell makes a unit deal damage, take the damage attributes from the unit only.",
    proof: null,
    verify: "Run the todo reproduction in 387-raq-combat.test.ts, \"RAQ Squish: a Powerful Squish does not double\". — it fails while this is open.",
    status: "open",
  },
  {
    id: 206, area: "engine", severity: "minor",
    cards: ["Squish"],
    title: "Squish reads the ally's live defense even when the target is {Unaware}",
    detail: "A Robot 10 squishing Bubb kills it; R106 reads everything in an interaction with an Unaware unit at printed stats, so the RAQ answer is no harm.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Squish/Fight/Battle vs Source of damage & Interactions\"; R106.",
    fix: "Route the Squish amount through the same printed-stat read R106 uses for combat.",
    proof: null,
    verify: "Run the todo reproduction in 387-raq-combat.test.ts, \"RAQ Squish: a Robot 10 squishing Unaware Bubb\". — it fails while this is open.",
    status: "open",
  },
  {
    id: 207, area: "engine", severity: "major",
    cards: ["Fight", "Tidal Reversion"],
    title: "a spell is offered when only its first required target slot can be filled",
    detail: "castable() checks slot 0 only. Fight is offered with a lone ally in the region; Tidal Reversion is offered when the other player has no unit. Both RAQ and Caleb (screenshot) say neither can be played.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Target requirements to put effect on stack\": _passer on Fight, calebgannon on Tidal Reversion (\"You can't play it if one player doesn't have a valid target\").",
    fix: "castable() must require every required slot to be fillable with distinct targets. Whole-pool sweep beside it.",
    proof: null,
    verify: "Run the todo reproduction in 390-raq-stack.test.ts, the two \"RAQ target requirements:\" todo tests. — it fails while this is open.",
    status: "open",
  },
  {
    id: 208, area: "engine", severity: "major",
    title: "a target restriction is not re-checked at resolution unless the card does it itself",
    detail: "R56 says re-validate at resolution, but targetStillLegal checks only that the target exists. Ambush whose ally was stolen in response still recalls it to its new controller's hand and spawns the ambusher. Minor Kraken and Throw off a Cliff re-check by hand; most cards do not.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Valid targets becomes invalid.\", _passer: \"Ambush won't resolve as … that unit is no longer ally of your opponent\".",
    fix: "Re-run the slot restriction in targetStillLegal (general), then a whole-pool sweep for cards that re-check by hand and can drop it.",
    proof: null,
    verify: "Run the todo reproduction in 390-raq-stack.test.ts, \"RAQ valid targets: an Ambush whose ally changed sides\". — it fails while this is open.",
    status: "open",
  },
  {
    id: 209, area: "engine", severity: "major",
    cards: ["Flamebreath Initiate", "Bellowing Boulder"],
    title: "an effect whose source has died loses it: \"the carrier is gone\" and no last-known state",
    detail: "Flamebreath Initiate removed with its trigger on the stack makes nothing (\"the carrier is gone — no Fireball\"); the RAQ says X = 0 and it still makes a Fireball 1. Bellowing Boulder dead with its ping on the stack loses the Deadly its column gave it, because effectSourceAttrs falls back to the printed card. There are 63 \"carrier is gone\" guards across 19 card files; the ones that only READ the source contradict R1 and this thread.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Dead Unit Effect on Stack\", _passer: \"Bellowing Boulder will remember his last state\". ⚠ The same thread says Hooba-Bot, Hooba-Pon, Hooba-Lin, Embermaw Fledgling and Lumengrove Lurker \"remember they were in formation\", which R225 (owner, room FTUW) ruled the other way — those claims are marked outdated by R225 pending the owner.",
    fix: "The thread makes last-known state general (\"his effect will check BB state/last known state on resolution\"), and the RAQ is the authority (owner, 2026-10-09): reverse R225. Snapshot the source on the stack item (attributes, formation, column), resolve against it when the source is gone, and sweep the 63 guards. Rousing Spirit and Hooba-Nan are the thread's named exceptions that do nothing.",
    proof: null,
    verify: "Run the todo reproduction in 390-raq-stack.test.ts, the two \"RAQ dead unit:\" todo tests. — it fails while this is open.",
    status: "open",
  },
  {
    id: 210, area: "engine", severity: "major",
    cards: ["Monke", "Transmogrifant", "Suppression Field", "Formless"],
    title: "suppression vetoes attributes and abilities gained AFTER it (R62), where the RAQ and Caleb apply timestamps",
    detail: "R62 made suppression a veto, so a mod or grant arriving after Monke, Transmogrifant, Suppression Field or Formless is switched off too. Caleb: \"anything after that will still apply\"; _passer: \"timestamps takes precedence\". Five claims across three threads fail on this one rule.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Threads \"[Solved] Timestamps vs Static Abilities\", \"[Solved] Monke & Transmogrifant vs Suppression Field & Formless\", \"[Asked] Suppression Field & Formless vs Gaining Attributes\" (calebgannon). R62 and R293 are the engine's rulings; R293's quote is about the same attributes coming back, not new ones.",
    fix: "The RAQ wins (owner, 2026-10-09), and the owner: \"that goes for all ability stripping … it becomes a layer of some kind.\" Make ability/attribute stripping a layer applied in timestamp order: it removes what is there when it applies, and later grants apply. Reverses R62's veto. Covers Monke, Transmogrifant, Suppression Field, Formless and every other stripper.",
    proof: null,
    verify: "Run the todo reproduction in 390-raq-stack.test.ts \"RAQ timestamps:\", and in 393-raq-mods.test.ts the \"RAQ Suppression Field: an attribute granted after\", \"a Powerful virus attached after\" and \"RAQ Transmogrifant:\" todos. — it fails while this is open.",
    status: "open",
  },
  {
    id: 211, area: "card", severity: "minor",
    cards: ["Suppression Field", "Formless"],
    title: "Suppression Field and Formless strip only their target, where Caleb says the whole column loses the attributes",
    detail: "Caleb: \"the column would lose piercing\". Formless prints the column reminder; Suppression Field does not, so this is printed text vs the designer's answer.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Threads \"[Asked] Suppression Field & Formless vs Gaining Attributes\" (calebgannon) and \"[Solved] Monke & Transmogrifant vs Suppression Field & Formless\".",
    fix: "Follow Caleb (owner, 2026-10-09: \"that goes for all ability stripping\"): a stripper aimed at a unit in a formation strips the column. Build it on the CT-210 layer.",
    proof: null,
    verify: "Run the todo reproduction in 393-raq-mods.test.ts, the two \"RAQ Suppression Field:\" whole-column todos. — it fails while this is open.",
    status: "open",
  },
  {
    id: 212, area: "attribute", severity: "minor",
    cards: ["Crevice Lurker"],
    title: "Crevice Lurker does not tax {Resonant}, which Caleb intends",
    detail: "Resonant is an inline rider, not a trigger, so the R121 gate never sees it: 2 life drained with or without a Lurker. Caleb: \"my intent is for it to stop those from triggering\"; the card prints \"Abilities\".",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Trigger-like Attributes vs Crevice Lurker & Containment Protocol\", calebgannon.",
    fix: "Follow Caleb's stated intent (the RAQ is the authority, owner 2026-10-09). Falls out of CT-200 if Resonant becomes an effect on the stack.",
    proof: null,
    verify: "Run the todo reproduction in 390-raq-stack.test.ts, \"RAQ trigger-like attributes: Crevice Lurker taxes Resonant\". — it fails while this is open.",
    status: "open",
  },
  {
    id: 213, area: "engine", severity: "minor",
    cards: ["Graxxlid"],
    title: "Reconfigure refreshes a moved mod's once-per-turn ability",
    detail: "A Graxxlid already used this turn, moved by Reconfigure onto a new host, can negate again. _passer: \"you CANNOT use his Ability again\".",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Reconfigure vs Once per Turn Abilities\".",
    fix: "Key the once-per-turn budget to the mod, not to its host.",
    proof: null,
    verify: "Run the todo reproduction in 393-raq-mods.test.ts, \"RAQ Reconfigure vs Once per Turn\". — it fails while this is open.",
    status: "open",
  },
  {
    id: 214, area: "card", severity: "minor",
    cards: ["Perpetual Construct"],
    title: "Perpetual Construct hears only the moved unit, not each mod moved with it",
    detail: "The RAQ: Reconfiguring Bubb with two mods onto the Construct is \"3 Triggers… 1/1, 3/3, 4/4\"; the engine fires once, for the unit, and the two mods that rode along with it are silent — so the Construct grows by one step where the thread grows it by three.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Reconfigure onto Perpetual Construct.\".",
    fix: "Announce each moved mod as its own arrival for the Construct.",
    proof: null,
    verify: "Run the todo reproduction in 393-raq-mods.test.ts, \"RAQ Reconfigure onto Perpetual Construct\". — it fails while this is open.",
    status: "open",
  },
  {
    id: 215, area: "card", severity: "minor",
    cards: ["Download"],
    title: "Download cannot take a spell token that is already cast and on the stack",
    detail: "The RAQ marks \"Fireball effect on the stack\" as a token Download can take; the engine does not offer it: measured with a Fireball token cast and waiting on the stack, Download's target list does not include it, though the thread lists it among the tokens Download can take.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Download. What is a token (and what is not).\".",
    fix: "Add stack spell tokens to the target family Download reaches.",
    proof: null,
    verify: "Run the todo reproduction in 393-raq-mods.test.ts, \"RAQ Download: a Fireball already cast\". — it fails while this is open.",
    status: "open",
  },
  {
    id: 216, area: "engine", severity: "minor",
    title: "a grafted [cost] can be declined, and an unpayable one skips only that graft",
    detail: "Graft 101 point 11: \"you MUST pay it, you can't opt out\", and if it cannot be paid \"the whole Graft Effect won't go on the stack\". The engine offers \"Don't pay — skip this effect\" and, when unpayable, still resolves the host and the other grafts.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Graft 101. All you need to know about Grafts.\" point 11. R110 says skip \"that effect\"; whether that means the one graft part or the whole composite is the question.",
    fix: "Follow Graft 101 point 11 (the RAQ is the authority, owner 2026-10-09): the grafted cost is mandatory, and an unpayable one keeps the whole graft effect off the stack. Narrows R110.",
    proof: null,
    verify: "Run the todo reproduction in 393-raq-mods.test.ts, the two \"RAQ Graft 101 point 11:\" todos. — it fails while this is open.",
    status: "open",
  },
  {
    id: 217, area: "engine", severity: "minor",
    cards: ["Nectar Ridge Oracle", "Sandstone Defender"],
    title: "a spawn trigger reads the new unit before your statics apply to it",
    detail: "Under Sandstone Defender a 1/1 should spawn as a 1/3, so Nectar Ridge Oracle draws; the engine checks before the static, for token and nontoken units alike.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Nectar Ridge vs Sandstone Defender & Wisp Weaver.\".",
    fix: "Apply continuous effects to the arriving unit before arrival listeners read it.",
    proof: null,
    verify: "Run the todo reproduction in 393-raq-mods.test.ts, \"RAQ Nectar Ridge:\". — it fails while this is open.",
    status: "open",
  },
  {
    id: 218, area: "engine", severity: "minor",
    cards: ["Cosmic Reversal", "Rider of the Tides"],
    title: "a recalled spell token never enters the hand, so \"enters your hand\" watchers miss it",
    detail: "Cosmic Reversal erases a spell token straight off the stack. The RAQ: it \"technically enter[s] your hand\" and is then erased, so Rider of the Tides hears it. Recalled unit tokens are already right.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Recall Spell Token / Token unit. Token Unit dying.\". Check R305/R306 (token rulings) do not already settle it the other way.",
    fix: "Route a recalled spell token through the hand (fire the hand event), then erase it.",
    proof: null,
    verify: "Run the todo reproduction in 393-raq-mods.test.ts, \"RAQ Recall Spell Token:\". — it fails while this is open.",
    status: "open",
  },
  {
    id: 219, area: "engine", severity: "major",
    cards: ["Borrower of Forms", "Cosmic Reversal", "Lumengrove Lurker"],
    title: "a copy reads the PRINTED card in several places: grafts, cost and spell-unit status",
    detail: "Borrower of Forms that copied a grafted unit drops the copied graft; it cannot take more grafts (graftCauseIndex reads host.card); having copied Robot 3 it still costs 7 (manaOf reads the physical card); mimicking a unit it is still recalled by Cosmic Reversal as a spell unit (kind read off the printed card). Likely every copy card.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved & Expanding?] Borrower of Forms - The weird interactions\". Found by batch C; the readers are at apply.ts graftCauseIndex(host.card), manaOf(u.card), card(u.card).kind.",
    fix: "Read the effective (copied) face in those three readers; sweep for other printed-card readers on copies.",
    proof: null,
    verify: "Run the todo reproduction in 393-raq-mods.test.ts, the four \"RAQ Borrower of Forms:\" todos. — it fails while this is open.",
    status: "open",
  },
  {
    id: 220, area: "card", severity: "minor",
    cards: ["Tides of the Cosmos", "Molten Riftbreaker"],
    title: "Tides of the Cosmos plays every pick in its plain mode, never as a Virus, Ambush or Prophecy",
    detail: "The RAQ: \"Tides allows you to play Viruses/Ambushes/Prophecy (you still look at main cost)\". Molten Riftbreaker can only arrive as a unit.",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Tides of Cosmos - all you need to know.\", _passer.",
    fix: "Follow the RAQ (owner, 2026-10-09): offer Virus, Ambush and Prophecy, judged against the main cost.",
    proof: null,
    verify: "Run the todo reproduction in 396-raq-timing.test.ts, \"RAQ Tides 3:\". — it fails while this is open.",
    status: "open",
  },
  {
    id: 221, area: "engine", severity: "major",
    cards: ["Tides of the Cosmos", "Volatile Toxicity", "Towering Colossus"],
    title: "a card played mid-resolution skips its additional cost",
    detail: "pushInlinePlay never collects a cast cost: no sacrifice is asked for Volatile Toxicity from Tides, and it resolves into nothing. The same path serves Hooba-Pon and Insidious Invitation, so a unit with a cast cost probably slips past it there too (not yet tested).",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Tides of Cosmos - all you need to know.\", _passer: \"Any additional [cost] of the card must be paid\".",
    fix: "Collect the cast cost on the inline path; test the Hooba-Pon / Insidious Invitation route too.",
    proof: null,
    verify: "Run the todo reproduction in 396-raq-timing.test.ts, \"RAQ Tides 5:\". — it fails while this is open.",
    status: "open",
  },
  {
    id: 222, area: "card", severity: "minor",
    cards: ["Tides of the Cosmos", "Frosted Denial"],
    title: "Tides of the Cosmos offers Frosted Denial at X = 0",
    detail: "Frosted Denial prints \"X can't be zero\"; Tides plays it free at X = 0. The RAQ: \"you CANNOT play Frosted Denial from Tides of Cosmos\".",
    evidence: "RAQ audit 2026-10-09 (ledgers/raq.ts). Thread \"[Solved] Tides of Cosmos - all you need to know.\", _passer.",
    fix: "Exclude cards whose X may not be 0 from free plays.",
    proof: null,
    verify: "Run the todo reproduction in 396-raq-timing.test.ts, \"RAQ Tides 6:\". — it fails while this is open.",
    status: "open",
  },
  {
    id: 199, area: "client", severity: "minor",
    title: "undoing a spawn is refused if the opponent cached a card after it: the cached card's uid shifts",
    detail: "In a hidden step: you make a play that allocates entity ids (any spawn), then your opponent caches a card (any glimpse). Undoing your play is refused with \"taking that back would change what a move made after it refers to\". The reference key's zone delta writes the cached card's uid, which comes from the shared entity-id counter and so moves when your play is spliced out. Nothing about the opponent's move actually changed.",
    evidence: "Found by the R312 agent, 2026-10-04; 374 section 5 uses an id-free action to step around it.",
    fix: "Leave cache uids out of the zone delta, or symbolize them like entity ids. The zone-delta format is read by the card ledger's checks against old files, so it needs a format stamp or a new field.",
    proof: null,
    verify: "In deployment spawn a unit, let the opponent glimpse-and-cache, then press undo.",
    status: "open",
  },
  {
    id: 194, area: "client", severity: "minor",
    title: "the stack caption states an effect amount without the attribute that changes it (a Powerful Fireball says \"Deal 9\" and deals 18)",
    detail: "Found with report #188 (UVYZ [149]): the one-line does-text reads \"Deal 9 damage to Flourishing Flora\" while Emberflame Enlightener's granted Powerful doubles it. The owner chose chips only for #188 (2026-10-04) and to leave the caption wording for now, so this is deliberately parked, not forgotten.",
    evidence: "UVYZ replay at [149]; investigator for report #188.",
    fix: "Read E.stackItemAttrs in the does-line renderer and say the real amount (e.g. \"Deal 18 (Powerful)\"), for the attributes that change a number.",
    proof: null,
    verify: "Cast a Fireball with Emberflame Enlightener in play; the stack caption names the unboosted damage.",
    status: "open",
  },
  {
    id: 195, area: "client", severity: "minor",
    title: "a finished game forgotten after an hour answers its link with \"No game with code\", not the game",
    detail: "sweepFinished (server/main.ts) drops a decided, empty room an hour after it ends and its comment says a later reconnect \"finds the room by its file exactly as a restart would\". It does not: joinRefusal answers \"No game with code X\". The idle-room work (CT-193) gave CLOSED rooms a proper sentence; a FINISHED one still gets the typo answer.",
    evidence: "Noticed by the CT-193 agent, 2026-10-04; not reproduced in a browser.",
    fix: "Answer a decided room's link from its file (result + a replay link), or at least say the game is over.",
    proof: null,
    verify: "Finish a game, wait an hour with nobody in it, open its link.",
    status: "open",
  },
  {
    id: 196, area: "client", severity: "minor",
    title: "every restart re-dates the unfinished games still open: history reads the file mtime as the day played",
    detail: "Each boot appends a version stamp to every restored room and persists it, which moves the mtime; history.ts takes the mtime as when the game was played. CT-193 pins the mtime back when a room CLOSES, but a room still open across a restart reads as played on the restart day until it closes.",
    evidence: "Noticed by the CT-193 agent, 2026-10-04.",
    fix: "Date a history row by lastActionAt when the file has it, or pin the mtime on every restore persist.",
    proof: null,
    verify: "Restart the server with an unfinished game open; its history date moves to the restart.",
    status: "open",
  },
  {
    id: 197, area: "client", severity: "minor",
    title: "sandbox rooms restored after a restart escape the 50-room sandbox cap",
    detail: "sandboxCodes lives only in memory, so the cap that deletes the oldest scenario/sandbox rooms does not know about the ones restored at boot, and their files pile up. CT-193 now closes idle sandboxes, which limits the damage, but the cap itself is still blind after a restart.",
    evidence: "Noticed by the CT-193 agent, 2026-10-04.",
    fix: "Rebuild sandboxCodes from the restored rooms (mode or scenario field) at boot.",
    proof: null,
    verify: "Open several scenario rooms, restart, count sandboxCodes against the restored sandboxes.",
    status: "open",
  },
  {
    id: 186, area: 'client', severity: 'minor',
    title: 'constructed draft mode — a drafted pool you build a deck from, before you play it',
    detail:
      'Playtest report #164 (2026-09-14, from the home page, signed out): "Constructed draft '
      + 'mode would be great". The client has a LIVE draft — you draft out of the pack straight '
      + 'into the game you are playing — and a constructed mode where you bring a built deck. '
      + 'What it does not have is the third shape: draft a pool first, build from it, then play '
      + 'that deck.\n\n'
      + '\u26a0 WHAT THE REPORTER MEANT IS NOT SETTLED, and the two readings are different '
      + 'games. "Draft a pool, then build from it" is BL-05 (cube draft into a 30-card '
      + 'constructed tournament) and is already scoped in the backlog. "Bring a constructed '
      + 'deck into a draft pod" is something else entirely. They filed signed out and left no '
      + 'other words, so nobody can tell from the row. ASK BEFORE BUILDING.',
    evidence: 'playtest report #164; the second request for some form of draft-then-build, after '
      + '#163 (the Quick Start rules, which shipped the same night as BL-43).',
    fix: 'Nothing here — it is BL-05\'s. This entry exists so the report is not lost between the '
      + 'playtest ledger and the backlog, which is the gap 83-card-todo\'s report arm was '
      + 'written to close.',
    proof: null,
    verify: 'There is no way to draft a pool and build from it before playing; the home screen '
      + 'offers live draft and constructed only.',
    reportId: 164,
    status: 'open',
  },
  {
    id: 143, area: 'engine', severity: 'minor',
    title: 'a card played mid-resolution in place fires no cardPlayed at all, so the wide watchers are deaf to it',
    detail:
      'R198 says a card played mid-resolution goes on the stack and is respondable. playInline in-'
      + 'place path predates that and still spawns in place, firing spellPlayed and spawned but no '
      + 'cardPlayed — so R129 wide watchers (Void Mandible, Bloomcaster) never hear the play. R207 '
      + 'recorded the divergence; R263 threaded the source zone through the same path and left it '
      + 'standing.',
    evidence: 'Flagged by the R263 agent, which declined to fix it: "changes which cards trigger on '
      + 'plays nobody ruled on this round".',
    fix: 'Making it an item is a much larger change than it looks — a spawn is not a cast and there '
      + 'is no cast window to declare it in. Read R207 before starting.',
    proof: null,
    verify: 'Play a unit out of a bin during battle with a Void Mandible up; it cannot answer.',
    progress:
      '\u26a0 MEASURED AND DELIBERATELY NOT BUILT, ROUND 36. THE REPORTED DEFECT IS NOT '
      + 'REACHABLE, AND THE VERIFY LINE ABOVE IS FALSE TODAY. This entry was written from the '
      + 'CODE — playInline\'s in-place branch really does fire a hand-rolled spellPlayed and no '
      + 'cardPlayed — and not from the reachable behaviour, which R198 had already fixed. '
      + 'MEASURED by instrumenting playInline and running every test file that can reach it '
      + '(each one naming one of its three callers): 41 calls, 38 down R198\'s PUSH path, '
      + 'through E.commitItem, which fires R129\'s cardPlayed with R207\'s item id like any '
      + 'other play. The only three in-place hits are 241-played-from-zone\'s synthetic "R263 '
      + 'test rig" driving the function directly in the deploy phase. No card reaches it, '
      + 'because all three callers can only run inside a battle priority window — which is '
      + 'exactly inlinePlayGoesToStack\'s predicate: Hooba-Pon triggers on [attacked, blocked], '
      + 'and Insidious Invitation and Tides of the Cosmos both print battle timing.\n\n'
      + 'THE ENTRY CONFLATES TWO QUESTIONS AND THEY SEPARATE CLEANLY. Is cardPlayed separable '
      + 'from item-hood? Yes — R207 already built the encoding (no `item` = "this play put no '
      + 'effect on the stack") — but it is MOOT here. A watcher that only needs to KNOW '
      + '(Bloomcaster, "whenever you play a unit, create a 1/1") already hears a mid-resolution '
      + 'play: driven in 169 \u00a76a, where it makes its 1/1. A watcher that needs to RESPOND '
      + '(Void Mandible) needs an item, and has one: the push path pushes a real item, and '
      + '169 \u00a71 already answers a mid-resolution Hooba-Pon play with Dematerialize. So the '
      + 'wide watchers are not deaf and the play IS answerable; making the in-place path an '
      + 'item — the "much larger change" this entry warns about — buys nothing.\n\n'
      + '\u26a0 AND THE SMALL CHANGE IS NOT FREE EITHER, which is the reason it was not made. '
      + 'R207 ruled that a cardPlayed with no `item` means "there is nothing to negate". Firing '
      + 'one from the in-place path therefore makes Void Mandible pay its printed sacrifice for '
      + 'a negate that cannot land — a card interaction nobody has ruled on, invented on a path '
      + 'no card reaches. That is the same trade the R263 agent declined ("changes which cards '
      + 'trigger on plays nobody ruled on this round"), and it should be decided WITH the '
      + 'fourth caller, when there is a real card to rule about.\n\n'
      + 'THREE GUARDS, and each was re-broken. 169 \u00a76a (behavioural, real cards) reddens '
      + 'when the in-place path is forced, alongside five of R198\'s own tests. 169 \u00a76b is '
      + 'THE TRIPWIRE: the playInline call-site census is derived from source and reddens the '
      + 'day a FOURTH caller appears — with the question it has to answer in the failure '
      + 'message — plus the mechanical checks that keep the three in a window (printed timing, '
      + 'trigger events). 169 \u00a76c pins the residue: it asserts the in-place path fires NO '
      + 'cardPlayed, so the silence cannot be changed by accident either, and it says in the '
      + 'test that it records what the code does rather than what is right. Severity stays '
      + 'minor and the entry stays OPEN: the divergence is real, it costs nothing today, and '
      + '\u00a76b is the day it starts costing something.',
    status: 'open',
  },
  {
    id: 173, area: 'attribute', severity: 'minor',
    cards: ['Flame of History', 'Invasive Reassignment'],
    title:
      '{Reaping} never turns off — "It loses reaping until regroup" is unimplemented and '
      + 'nothing in the repo knew the clause existed',
    detail:
      'The four {Reaping} cards all print, identically: "(When a reaping source kills one or '
      + 'more units, draw a card. It loses reaping until regroup.)" That wording was found by '
      + 'reading the card SCANS during the CT-171 audit; it is absent from the oracle '
      + 'transcription because the keyword is a TYPE-LINE ATTRIBUTE and the transcription text '
      + 'field carries ability text only (owner, 2026-08-30). The second sentence is not '
      + 'implemented anywhere: grep for Reaping near regroup or lose in engine/src returns '
      + 'nothing. So a reaping source keeps drawing on every subsequent kill for the rest of '
      + 'the turn, where the card says it reaps once and then stops until regroup. Combined '
      + 'with CT-172 (a draw per body rather than per event) the attribute is substantially '
      + 'stronger than printed.',
    evidence:
      'CT-171 glossary audit, 2026-08-30. ⚠ THE ENGINE SAYS THE OPPOSITE IN A COMMENT: '
      + 'engine.ts carries "{Reaping} \\"When it KILLS a unit, its controller draws a card.\\" (⚠ '
      + 'NOT printed - none of the four {Reaping} cards carries" - a stale belief that is the '
      + 'reason nobody looked for the second sentence. docs/03-mechanics-inventory.md has '
      + 'carried the correct printed wording all along, including this clause, and even files '
      + 'it as undone engine work.',
    fix:
      'Implement the loss (an until-regroup suppression of the attribute on that source) and '
      + 'DELETE the stale "NOT printed" comment in engine.ts in the same change. ⚠ Reachability '
      + 'first: no card GRANTS {Reaping} to a unit - all four printers are kind: spell - so do '
      + 'not build a combat seam for it; a 2026-08-26 round built one on that false premise and '
      + 'it was reverted. The four spells take the effect path, which is where both fixes '
      + 'belong.',
    proof: null,
    verify:
      'Kill with a reaping source twice in one turn. The second kill should draw nothing.',
    progress:
      '⚠ MEASURED AND DELIBERATELY NOT BUILT, 2026-08-30 (R283). The clause is real and '
      + 'printed - verified on the Seismomancy scan - but it is UNREACHABLE in this pool, so '
      + 'building it would be machinery for a case that cannot occur. A one-shot spell resolves '
      + 'once and killRiders fires once per resolving part, so a source that cannot kill twice '
      + 'can never be observed losing anything. It would bite only if a UNIT could carry '
      + '{Reaping}, and nothing can give one: all four printers are kind spell with EMPTY '
      + 'augmentAttrs (so no virus or augment donation under R79), and The Omniphage - the only '
      + 'other card naming the attribute - grants off BIN UNIT cards. A 2026-08-26 round built '
      + 'a {Reaping} combat seam on a premise like this one and had to REVERT it, because no '
      + 'test could fail on a case that cannot happen. This entry stays OPEN rather than closed '
      + 'as built, and severity drops to minor: the gap is real, it costs nothing today, and '
      + '263 §4 is the tripwire that was missing in August - it goes RED the day a printer '
      + 'stops being a spell, gains augmentAttrs, or another card starts naming the attribute. '
      + 'THAT is the day this needs code. Also done here: the stale engine.ts comment asserting '
      + 'no {Reaping} card prints a reminder is replaced by the printed sentence itself.',
    status: 'open',
  },
  {
    id: 178, area: 'coverage', severity: 'minor',
    cards: ['Necromantic Rebuke'],
    title:
      'the owner\'s `slightly off` verdict on Necromantic Rebuke was answered by fixing the '
      + 'MISPLAY, and the branch the scenario exists to reach has still never run',
    detail:
      'var/verdicts.jsonl carries {"scenario":"rebuke-refused","card":"Necromantic Rebuke",'
      + '"verdict":"slightly-off","room":"DWYV","actionIndex":6} dated 2026-08-27T13:00Z. The '
      + 'cause was found and it was a client defect, not the card: the bin menu had collapsed '
      + 'two identical cards into one row without saying so, the owner paid X as 2, and X=2 '
      + 'empties the bin and suppresses the ransom. R220 fixed the menu (DecisionOption.count) '
      + 'and the board is unchanged. ⚠ But that closed the CAUSE OF THE MISPLAY, not the '
      + 'verdict: `rebuke-refused` exists to watch the REFUSAL branch at X=1, and '
      + 'ledgers/unreached.ts records in prose that it "still has not executed". So the card '
      + 'is unverified for the one clause the scenario was built to witness.\n\n'
      + '⚠ THIS TICKET DOES NOT CONTRADICT ANY RULING, and it is worth saying so plainly '
      + 'because 202-settled-rulings-not-reopened convicted an earlier wording of this entry '
      + 'that read as if it did. digital-rules.md §7 ("Necromantic Rebuke\'s X is the printed '
      + 'additional cost") marks the card ALREADY CORRECT and nothing here disputes that. The '
      + 'gap is a COVERAGE gap, which is why the area is `coverage` and not `card`: the '
      + 'engine is believed right and has never been WATCHED being right on this branch. '
      + 'R220 fixed the client defect that caused the misplay; it did not, and could not, '
      + 'witness the refusal.',
    evidence:
      'ROUND 36, found by 264-verdict-loop.test.ts ON ITS FIRST RUN — the guard was written '
      + 'for Vengeance (CT-177) and turned up a second dropped verdict immediately, which is '
      + 'the positive control docs/13 §7.4 asks every new checker for. ⚠ The finding already '
      + 'EXISTED, in a comment on UNWITNESSED_CARDS in ledgers/unreached.ts, where nothing '
      + 'could fail on it. That is the docs/13 §5 shape exactly: a real defect that stops '
      + 'being work the moment its only home is a sentence.',
    fix:
      'Re-open `rebuke-refused` and play it correctly — X = 1, so the bin is not emptied and '
      + 'the ransom is actually offered — then watch the refusal. If it behaves, the card '
      + 'earns a WITNESSED row and leaves UNWITNESSED_CARDS; if it does not, this entry '
      + 'becomes the real ticket. Either way the loop closes on evidence rather than on the '
      + 'assumption that fixing the menu fixed the card.',
    proof: null,
    verify:
      'Open rebuke-refused, pay X = 1, and refuse the ransom. The refusal branch runs and the '
      + 'card does what it prints.',
    status: 'open',
  },
  {
    id: 185, area: 'engine', severity: 'minor',
    title:
      'R286 point 5: "nothing will automatically resolve if you\'re holding ctrl" — the '
      + 'DEPLOYMENT half of full control, which needs a stop on a stack that drains itself',
    detail:
      'CT-183 landed full control as a held Ctrl key over the four things that act for you. '
      + 'One clause of the owner\'s answer is not in it: "Even during deployment, nothing '
      + 'will automatically resolve if you\'re holding ctrl." R286 built the stack that makes '
      + 'the sentence expressible, and CT-183\'s own note scoped this out until it existed. '
      + 'It exists now.\n\n'
      + 'THE OBSTACLE, stated plainly: the deployment stack drains INSIDE `settle()`, in the '
      + 'engine, and full control is a browser key relayed to the server. The engine has '
      + 'never heard of it, and the three other automatics are all outside the engine, which '
      + 'is why they were reachable.',
    evidence:
      'ROUND 37, the one clause of questions-round36 Q5 that CT-183 could not reach. R286 '
      + 'point 5 names it as the case that makes the deployment stack VISIBLE: "A held stop '
      + 'in deployment is only meaningful if there is a stack to stop on." Today a deployment '
      + 'play is pushed and drained within the same action, so no client ever sees the item '
      + 'on the stack at all - `E.pushItem` flashes it precisely because of that.',
    fix:
      '⚠ THE ONLY REPLAY-SAFE SHAPE IS AN ACTION, and that is the whole decision. A saved '
      + 'game is a seed plus an action log; anything that changes what the engine does must '
      + 'be IN that log or the replay diverges. So: a `holdStack` action carrying the seat '
      + 'and on/off, stored in GameState, read by `settle()`\'s deployment drain (which then '
      + 'leaves the seat\'s stack standing), plus a `resolveTop` action and a button for the '
      + 'player to step it. THREE COSTS THE OWNER SHOULD WEIGH BEFORE THIS IS BUILT: (1) '
      + 'every Ctrl press in deployment becomes a row in the action log, so send it ONLY in '
      + 'the deploy phase, where R286 says it is "very rare to matter"; (2) report #86 / '
      + 'CT-22 stamps any deployment action other than Done as "you did something this '
      + 'deployment" - this action must be exempted or holding Ctrl silently marks you as '
      + 'having acted; (3) the client relay stops being a socket message and becomes an '
      + 'action, which incidentally CLOSES CT-183\'s latency gap (a) for the deployment half, '
      + 'because an action is ordered in the log.',
    proof: null,
    verify:
      'In deployment, hold Ctrl and play a spell: it sits on your stack and waits for you. '
      + 'Let go: it resolves. The opponent sees none of it, and their own deployment is '
      + 'unaffected either way.',
    status: 'open',
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const CARD_TODO: TodoEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
