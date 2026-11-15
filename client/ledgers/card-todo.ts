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
  // ── the report triage of 2026-11-10 ────────────────────────────────────
  // ── the report triage of 2026-11-11 ────────────────────────────────────
  // ── found by the steward repairing report #380's branch, 2026-11-11 ─────
  // ── the report triage of 2026-11-12 ────────────────────────────────────
  // ── the report triage of 2026-11-15 ────────────────────────────────────
  {
    id: 564, area: "engine", severity: "major",
    cards: ["Insidious Invitation", "Tides of the Cosmos", "Wake the Dead", "The Everywhere", "Tiderunner Initiate", "Trench Stalker"],
    title: "a unit played by another card's effect skips its own \"as I am played\" questions: The Everywhere names nothing, Tiderunner Initiate gets no spot",
    detail: "Reports #399 and #405. A card PLAYED by an effect (Insidious Invitation's \"players may play a unit from hand as if it were [Battle]\", Tides of the Cosmos's \"You may play them now, for free\", Wake the Dead's bin play) is declared by `declareInlinePlay` (engine/src/cards/sets/batch-water-a.ts, the CT-332 single declaration for both branches of `playInline`). It settles X, targets, mode, bracketed costs and — only when the CALLER passes `opts.intoFormation` (Hooba-Pon, whose own text says so) — a formation spot. It never reads the played card's own cast-window stages: `CardBehavior.namesAsPlayed` (The Everywhere, \"[Augment] As I am played or modded, name a card. My last named card loses all abilities.\"; engine.ts collectAsPlayedNaming, CR 702.3g) and `CardBehavior.playsIntoFormation` (Tiderunner Initiate, \"You may play me into an open spot in your formation.\"; Trench Stalker, \"I can be played directly into formation\"; engine.ts collectFormationSpot, CR 602.7 / 702.3e). So The Everywhere played this way arrives having named nothing — its whole text is dead until it is modded — and Tiderunner Initiate and Trench Stalker arrive beside the line with no offer of a spot. These are PLAYS (CR 701.4: \"play\"; collectAsPlayedNaming's own comment: \"Only a unit being PLAYED reaches here … playing is not putting into play\"), so both stages apply. Check the as-you-play offers (asYouPlayOffers, Maelstrom Charger's shape) on the same path while there: they are the same class.",
    evidence: "Report #399 (invi, QMRP, 2026-11-13, bug, medium): \"The everywhere should name a card when played in any way (e.g. insidious invitation)\". QMRP fetched and replayed 2026-11-15 (steward triage): 519 of 519, FAITHFUL, engine 5e379f65. From hand (log line ~490) the log says \"invi names Bloated Manablub as The Everywhere is played.\"; played off LordZZX's Insidious Invitation (cached via Premonition, ~777-796) it goes \"The Everywhere → stack … invi spawns The Everywhere.\" with no naming line. Report #405 (StubTailDstroyer, KNQX, 2026-11-14, bug, minor): \"When playing out Tiderunner Initiate with Insidious Invitation, you should be able to play Tiderunner into an open slot in formation\". KNQX fetched and replayed: 211 of 211, FAITHFUL, engine 940595b3. Twice from hand: \"Tiderunner Initiate is played straight into the formation (a new column on the right).\"; off Insidious Invitation (~352-370): \"Tiderunner Initiate → stack … StubTailDstroyer spawns Tiderunner Initiate.\", no spot asked. Read: batch-water-a.ts declareInlinePlay (`withSpot && opts.intoFormation`), the four playInline callers (batch-water-a Hooba-Pon and Insidious Invitation, batch-water-b Tides of the Cosmos, batch-dark-a Wake the Dead).",
    fix: "Teach `declareInlinePlay` the played card's own stages, asked through `ctx.choose` like everything else there: (1) `namesAsPlayed` → `item.named` with spec.options, announced as applyAsPlayedNaming announces it, so the body names on arrival on BOTH branches (the in-place branch spawns directly: pass the name through spawnUnit as resolveItem does); (2) `playsIntoFormation` → the same spot ask as `opts.intoFormation`, with \"stay out of formation\" on the menu (the text says may) and nothing asked with no formation (CR 602.7c). Then the in-place branch's placement. Sweep the registry (allCardNames) for every CardBehavior cast-window flag and assert each is honoured on the inline path, so the next flag cannot be missed. Guards: a test per card (Invitation → The Everywhere names and silences; Invitation → Tiderunner Initiate offered the open spot, and placed; Tides of the Cosmos → Trench Stalker) and the sweep. Run 800-cc-drift-guard and 409 (CR quotes batch-water-a). Player-visible: an updates.ts line.",
    proof: null,
    verify: "In a battle, cast Insidious Invitation and play The Everywhere from hand with it: you are asked to name a card. Do the same with Tiderunner Initiate while you have a formation: you are asked which open spot it goes into.",
    reportId: 399,
    status: "open",
  },
  {
    id: 565, area: "engine", severity: "minor",
    cards: [],
    title: "both players at 0 with equal totals: the initiative player loses; a judge says it should be a draw (owner's call)",
    detail: "Report #403 (Nyar, judge, AUUJ, 2026-11-14, bug, medium): \"The game is considered a loss for INT even if it should be a draw because both players are at 0. If they are both at 0 or lower the one with the lower value loses. If both are at the same value it is a draw\". The engine does what CR 104.1b says: \"If both players are at 0 or less when the life totals are checked, the player with the higher life total wins … If the totals are equal, the initiative player loses.\" The higher-total half is the designer's (calebgannon, rules-questions 2024-10-11 \"Piercing still can cause ties, although the tiebreak is the final life total in that case.\"; 2025-03-11 \"But yes currently the rule is player with the highest life total wins\"; 2025-04-28, on a Piercing block that could cause a draw, \"Yeah that could cause a draw, although right now the higher life total wins draws\"). The EQUAL-totals half is the owner's alone: \"Highest total, tie: INT loses\" (owner, chat 2026-10-25, CT-409; the record's sources.owner). No designer source addresses an exact tie, and Caleb's \"that could cause a draw\" is the only time a draw is named. A judge reporting that the engine breaks a rule is not closed by the steward on its own (steward skill §5), so this asks the owner to confirm or change his 2026-10-25 call.",
    evidence: "AUUJ (Nyar v StubTailDstroyer, constructed) fetched and replayed 2026-11-15 (steward triage): 161 of 161, FAITHFUL, engine 940595b3. Turn 5 combat damage, one sub-step: \"Nyar loses 5 life (combat) → 0.\" / \"StubTailDstroyer loses 6 life (combat) → 0.\" / \"*** Both players fell to 0 or less — StubTailDstroyer wins the tie at 0: it goes against the initiative player. ***\". CR 104.1b's record (data/comprehensive-rules/rules/U01.json, concepts.ending.elimination.simultaneous) and its notes: \"He never addresses an exact tie; the tie rule is the owner's\". Pinned by 654-simultaneous-loss (\"the engine decides a double loss by total, then against the initiative player\").",
    fix: "Owner decision first (needs-human: \"keep 'tie at equal totals: the initiative player loses', or make it a draw?\"). If he keeps it: close this wontfix citing his answer, report #403 by-design. If a draw: the engine needs a drawn game-over (no winner) through game over, the server's results, ratings and match scoring, and the end screen; CR 104.1b's record gets the new owner quote, re-verified and re-rendered; 654's tie test flips.",
    proof: null,
    verify: "Bring both players to the same total at 0 or below in one combat damage step: today the initiative player loses.",
    reportId: 403,
    status: "open",
  },
  {
    id: 566, area: "client", severity: "minor",
    cards: [],
    title: "the board's Cache area is drawn bigger than the Bin, though the bin is the pile that fills up",
    detail: "Report #401 (mycheze, owner, ENUC, 2026-11-14, ux, minor): \"The Cache zone is much larger than the Bin, which doesn't make sense. Usually, the cache has like 1 or two cards in it, if any and the bin has many. Just swap their sizes on screen, I think\". Each player's info line (ui/main.ts, the `info` builder in the board renderer: `.lbin` holds r.binMini, `.lcache` holds r.cache or the empty placeholder) draws the two piles side by side; the owner wants the bin given the cache's room and the cache the bin's.",
    evidence: "Report #401, room ENUC (mycheze v Gember), action 71. ENUC fetched and replayed 2026-11-15: 183 of 183, FAITHFUL. Read: ui/main.ts info line (bin · cache · name on my side, the mirror on theirs); styles/board/40-info-line-phase-icons.css (.linfo .lbin, .linfo .lcache flex: none). The actual widths come from the bin mini and the cache entries' card thumbs; not measured in a browser (none on the box).",
    fix: "Find what sizes the two (the binMini thumb vs the regioncache thumbs and the empty placeholder) and swap them, on both players' lines and in every layout the info line has (desktop, tablet, phone), so the bin is the bigger slot and the cache the smaller. Keep the cache's stable empty slot (owner, 2026-10-27). Guard: a ui test over the CSS read through ui/test/read-styles.ts (or the markup) that the bin's slot is at least the cache's. Player-visible: an updates.ts line.",
    proof: null,
    verify: "In a game with cards in both piles, the bin's area on each player's line is the larger and the cache's the smaller.",
    reportId: 401,
    status: "open",
  },
  {
    id: 567, area: "client", severity: "minor",
    cards: [],
    title: "a cached card shown in your hand: a \"Cache\" chip on the card instead of the floating \"cached\" label and the \"⚡ turn\" chip",
    detail: "Report #407 (mycheze, owner, XUKH, 2026-11-15, ux, minor): \"When a cached card is in your hand, rather than having the \\\"Cache\\\" title float above the card and a \\\"Turn\\\" chip be on the card, let's remove the \\\"Turn\\\" chip and make it a \\\"Cache\\\" chip instead. It would take up less space and get the same idea across\". The hand strip draws cached-and-playable cards in a `.handcached` group under a `.handcachedlabel` (\"cached · playable now\" / \"cached\"), each wearing the cache row's chip from `cacheChip` (ui/main.ts): \"⚡ turn\" for a glimpse, \"✓ free\" / \"⏳ n/m\" / \"waiting\" for a prophecy.",
    evidence: "Report #407, room XUKH (mycheze v Gember), action 122. XUKH fetched and replayed 2026-11-15: 252 of 252, FAITHFUL. Read: ui/main.ts handcached markup (\"in your cache, not your hand — also shown in the cache row\") and cacheChip.",
    fix: "In the HAND strip only (the cache row and the cache dialog keep their chips), drop the floating label and give each cached card one \"Cache\" chip. The owner names the glimpse case (\"Turn\"); a prophecy card's chip carries a count or \"free\", so keep that detail in the chip's title (tooltip) or as \"Cache ✓\" — pick the one that changes least and say so. Guards: ui tests that the hand's cached cards wear the Cache chip and no label, and that the cache row still shows ⚡ turn. Player-visible: an updates.ts line.",
    proof: null,
    verify: "Glimpse a card in a battle: in your hand it shows one \"Cache\" chip and no \"cached\" label above it; the cache row still shows ⚡ turn.",
    reportId: 407,
    status: "open",
  },
  {
    id: 568, area: "engine", severity: "minor",
    cards: ["Insidious Invitation", "Tiderunner Initiate"],
    title: "Tiderunner Initiate played off Insidious Invitation is not offered an open spot in the formation",
    detail: "Report #405 (StubTailDstroyer, KNQX, 2026-11-14, bug, minor): \"When playing out Tiderunner Initiate with Insidious Invitation, you should be able to play Tiderunner into an open slot in formation\". The same gap as report #399 (The Everywhere names nothing when played this way): a card played by another card's effect skips its own as-played stages. CT-564 carries the class, the evidence and the fix.",
    evidence: "KNQX fetched and replayed 2026-11-15 (steward triage): 211 of 211, FAITHFUL; from hand the Initiate goes \"played straight into the formation\", off Insidious Invitation it spawns with no spot asked. See CT-564.",
    fix: "Nothing here — it is CT-564's. This entry exists so report #405 is not lost, and closes with CT-564 (naming the Tiderunner Initiate guard CT-564 adds).",
    proof: null,
    verify: "In a battle, with a formation, cast Insidious Invitation and play Tiderunner Initiate from hand with it: you are asked which open spot it goes into.",
    reportId: 405,
    status: "open",
  },
  {
    id: 569, area: "client", severity: "minor",
    cards: [],
    title: "the card zoom works on the board but not on the card search, other players' decks or the meta deck list",
    detail: "Report #404 (mycheze, owner, 2026-11-14, ux, medium, page metadeck): \"The \\\"middle click to zoom in\\\" on a card should work in ALL pages that have cards! Including the card search, viewing other decks, the card metagame list, everything. We should make it a codified action to \\\"zoom in\\\" on a card.\" A feature, not a defect: BL-77 carries it (one zoom action, every page that draws a card).",
    evidence: "Report #404, no room. Read: ui/zoom.ts (the board's magnifier; the sideboard table, the draft pick and pool pages opt in); ui/pages/*.ts.",
    fix: "Nothing here — it is BL-77's. This entry exists so the report is not lost, and closes when BL-77 is done.",
    proof: null,
    verify: "Middle-click a card on the card search, a shared deck and the meta deck page: the big zoom shows on each.",
    reportId: 404,
    status: "open",
  },
  {
    id: 570, area: "client", severity: "minor",
    cards: [],
    title: "the \"bring spell tokens into this battle?\" question is a small chip list in the prompt bar, not a picker with Bring all / Bring none",
    detail: "Report #406 (mycheze, owner, XUKH, 2026-11-15, ux, medium): a dialog of every spell token you may bring, picked by clicking, with \"Bring all\" and \"Bring none\" buttons, instead of the prompt bar's small chips. A new dialog in the attack flow: BL-78 carries it.",
    evidence: "Report #406, room XUKH, action 99; XUKH fetched and replayed 2026-11-15: 252 of 252, FAITHFUL. Read: ui/main.ts, the battle declare step's ui.confirmRide bar; ui/battle.ts ridableTokens.",
    fix: "Nothing here — it is BL-78's. This entry exists so the report is not lost, and closes when BL-78 is done.",
    proof: null,
    verify: "Attack with spell tokens that may ride: a dialog shows them as tiles, with Bring all and Bring none.",
    reportId: 406,
    status: "open",
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const CARD_TODO: TodoEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
