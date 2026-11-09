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
import { body, still } from './card-todo-helpers.ts';

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
    id: 542, area: "client", severity: "major",
    title: "joining a friend's constructed room locks in the deck this browser last selected the moment you arrive, with no chance to check or change it",
    detail: "Report #357 (mycheze, RUCV, 2026-11-08, gamebreaking): \"Gember thought she selected the right deck, but for some reason, it didn't actually follow her into the game.\" Every join carries the browser's chosen deck (ui/main.ts sendJoin, the `algoDeck` copy in ui/util.ts chosenDeck), and in a friend's constructed room the server registers it at once (server/rooms.ts takesJoinDeck: `return !room.league || pick;`, used at server/main.ts ~line 2876): the joiner who completes the pair deals the game on arrival, so the waiting room's \"Play this deck\" is never shown to them and nothing on the way in says which deck they are bringing. League rooms (owner, 2026-11-01) and Competitive matches (CT-518) already take a deck only from the room's own pick.",
    evidence: "Report #357; RUCV fetched 2026-11-08 (steward triage): a constructed room, mycheze seat 0, Gember seat 1, built on c9c91714; the game was dealt with Gember's saved deck 92e37b2f… (a blue list: Bloated Manablub, Good Whale, Bripp, Tempest Wrangler …), and mycheze conceded on turn 1, 15 seconds in, so they could start again. Verified by reading: the join path above deals on arrival. Hypothesis, not checked (the account store is not fetchable): the deck the browser held was not the one Gember picked — another tab, another device, or a pick on a screen that does not write the chosen deck (the deck page's \"copy\" not appearing until reload, the owner's inbox note of 2026-11-08, is one candidate).",
    fix: "Owner call before code (it is a flow): either (a) a friend's constructed room takes the joiner's deck only from the waiting room's own \"Play this deck\" (takesJoinDeck true only on `pick`, as league rooms), so both seats see their deck before the game is dealt; or (b) keep the instant deal but show the deck being brought on the join step (the room link's landing and the home Join sheet) with a way to change it. Either way, a server test that a non-pick join of a friend's waiting constructed room does or does not register, and a ui test of what the joiner is shown.",
    proof: () => still('server/rooms.ts', "return !room.league || pick;"),
    reportId: 357,
    status: 'open',
  },
  {
    id: 546, area: "client", severity: "major",
    title: "Casual vs Competitive is offered as friend's room vs match, not as the rules set (simultaneous or in turn) apart from Best of 1/3",
    detail: "Report #356 (mycheze, home, 2026-11-08, ux, medium) — the owner's design decision, kept whole in BL-73's `said`: \"Casual = simultaneous actions during simultaneous phases / Competitive = entirely turn based, INT while NIT watches, then swap / Best of 1 or Best of 3 doesn't really matter for that, that should be a separate slider. So both draft AND constructed should have the competitive vs casual slider … add a little hover tool tip …\". Today the Format switch exists only on Constructed (ui/pages/home.ts constructedRowsHtml): Casual creates a friend's room, Competitive a match (Best of 1/3, sideboard, sign-in, and the in-turn rule stamped by server/match.ts as `rules: { sequential: true }`), with a subtext line instead of a tooltip.",
    evidence: "Report #356 (page: home, no room). Code read 2026-11-08 (steward triage): the in-turn rule reaches a game only through a match (server/match.ts ~226, ~306), and the engine's GameRules.sequential is documented \"Constructed only\" (engine/src/types.ts ~56).",
    fix: "BL-73 is the plan (it carries the questions to settle in code: sequential in draft, a Casual Best of 3, a Competitive single game). This entry closes when BL-73's doneWhen lines are met.",
    proof: () => still('ui/pages/home.ts', "'A sideboard of up to 7, swapped between games. Players take each step in turn.'"),
    reportId: 356,
    status: 'open',
  },
  {
    id: 547, area: "client", severity: "minor",
    title: "a cached card you may still use this turn shows beside your hand only at the instants it can be played, so it is easy to miss",
    detail: "Report #358 (mycheze, CNDX, 2026-11-08, ux, medium): \"Cached cards that are playable in a turn should probably ALWAYS appear to the right of the hand (even when not playable due to timing restrictions or something), but with the same \\\"playable/not playable\\\" UI that cards normally have in the hand. It's too easy to miss that it appears in your hand ONLY for brief moments.\" The hand-side strip (ui/main.ts handCachedHtml ~line 3698, CT-50 / report #103) draws only `playableCachedIndexes(legalFor(p))` — the entries with a legal offer THIS instant (ui/inspect.ts ~294) — so a glimpsed card whose timing is shut (a battle spell in deployment, a unit during battle) or that has no target yet vanishes from beside the hand and comes back at the next window. The engine already has the predicate the owner means: `cachePermission(seat, i)` is 'glimpse' or 'prophecy' while the entry may be used at all (the cache chip, `cacheChip`, reads it), and ui/inspect.ts cacheBlockReason already names why a live entry cannot be played right now ('timing', 'mana', 'no-target').",
    evidence: "Report #358; CNDX fetched and replayed 2026-11-08 (steward triage): 224 actions; today's engine refuses a redundant pass at [83] (the 2026-11-08 priority changes; --as-recorded: every difference heals and the final board is identical), and the report was filed at [171], turn 5 battle, attack window. In the game mycheze glimpsed Celestial Purge on turn 4 and played it at once; the note reads as the general rule, not one card. Verified by reading: the strip's filter above is the only gate, and it is the legal-action list.",
    fix: "Draw every cached entry with a live permission (`cachePermission(p, i)` non-null) in the hand-side strip, ringed as playable only when it is in playableCachedIndexes, and otherwise dark like an unplayable hand card, with cacheBlockReason as its title (\"…only during battle\"). Keep the one `data-act=\"cache\"` click and the no-`anim`-key rule from the strip's comment. A ui test: a glimpsed battle spell in deployment is in the strip, not ringed; in battle it is ringed; a spent entry is not in the strip.",
    proof: () => still('ui/main.ts', "const idx = playableCachedIndexes(legalFor(p)).filter(i => cache[i]);"),
    reportId: 358,
    status: 'open',
  },
  {
    id: 548, area: "client", severity: "minor",
    title: "on a modded unit the red damage marker is partly hidden by its mods and hard to read without zooming in",
    detail: "Report #359 (mycheze, CNDX, 2026-11-08, ux, minor): \"When a unit is modded, the mod sorta cuts off the \\\"damage\\\" -X red badge so you can't read it unless you zoom in\". The marker is `.dmg` (ui/main.ts cardHtml ~line 3351, `u.damage` from ~3580), drawn bottom-left of the face (styles/board/03-life-cards-battle-log.css ~140, `bottom: 2px; left: 2px`, no z-index). A modded table card is a two-row grid (styles/board/08-playtest-ux-fixes.css ~131, `.card.modded`: the face and every overlay in row 1, `.fieldmods` in row 2), so the marker sits on the seam where the first strip is tucked under the face; the strips (`.fieldmods .modstrip`, position: relative, later in the markup, with an inset shadow on ::before at z-index 1) come right after it.",
    evidence: "Report #359; CNDX fetched and replayed 2026-11-08 (steward triage), filed at [217], turn 6 battle with Flame of History on the stack: Fireball 3 had just dealt 3 to mycheze's attacking Amphivore, which carries a grafted Bloated Manablub — a modded unit with −3 drawn in the battle's Invaders strip (52px cards, styles/board/09-region-overhaul.css ~89). Not seen (no browser on the box): exactly what covers the marker — the first strip, the next card of the attacking column's pile (styles/board/41-regions-blocks.css ~147, .invpile), or the marker's own 11px size on a 52px card — is a hypothesis.",
    fix: "Look at a modded, damaged unit on the table (the ?demo board, an Invaders strip and a home row) and find what overlaps the marker; then keep the marker clear of the mods: lift it above them (a z-index over `.fieldmods`) and/or move it off the seam, and check it at the smallest card widths. A ui test over the CSS (through ui/test/read-styles.ts) pinning whatever rule the fix adds.",
    proof: null,
    verify: "Damage a unit that carries an augment or graft (e.g. Fireball an attacking modded unit); its red −N marker is fully readable on the table without zooming, in the Invaders strip and at home.",
    reportId: 359,
    status: 'open',
  },
  {
    id: 549, area: "client", severity: "minor",
    title: "Big Glimpse Card's caster chooses a pile from two text buttons, not from the two piles shown as cards",
    detail: "Report #360 (mycheze, MNCM, 2026-11-09, ux, medium): \"The new \\\"splitting\\\" UI for Big Glimpse Card is much better now! It's very easy to use and understand. But it should be basically the same for the chooser. Instead of giving them two buttons with a list of options, it should present them with two modal piles of cards to choose from with buttons below to \\\"Put Pile 1 into your hand\\\" or \\\"Put Pile 2 into your hand\\\" (and below, in smaller text \\\"Recycle the rest\\\"). Choices and actions should be visual as much as possible!\" The splitter's half is CT-539 (ui/pickset.ts splitHtml, group 'split', driven by the `pickSet` hint on each `split:k` question). The caster's half is the engine's `ctx.choose('pile', …)` in engine/src/cards/sets/batch-hybrids-ld-a.ts (Big Glimpse Card): a payOrDecline with two options whose labels are the pile contents as text (`Pile 1: A, B, …`) and no `card` on either option and no display hint, so the ordinary decision bar draws two long text buttons.",
    evidence: "Report #360; MNCM fetched and replayed 2026-11-09 (steward triage): 57/57 actions, no divergence, played on 9e7ad015 (the CT-539 split window already live). A test-mode game, mycheze both seats: Big Glimpse Card cast in battle [10], seat 1 split with the new window [13]-[16], and the report was filed at [17], the caster's pile question (answered 'Pile 2'). Verified by reading: the pile question carries nothing the client could draw as cards.",
    fix: "Give the pile question a display-only hint carrying both piles' card names (like CT-539's `pickSet`, so the action log and every saved game are unchanged: the answer is still 'a' or 'b'), and draw it in the client as the split window's two panes of scans, read-only, with one button under each pile. The card says \"Cache one pile\", so the buttons should name what happens (e.g. \"Cache pile 1\" with \"recycle the rest\" in smaller text beneath); the owner wrote \"Put Pile N into your hand\" because cached cards sit beside the hand — keep the printed verb unless he says otherwise. An empty pile shows \"empty\" and its button still works. A ui test: the pile question draws both piles as cards, each button sends its pile's option; the fallback decision bar still answers when the hint is absent.",
    proof: () => !/pickSet|piles\s*:/.test(body('engine/src/cards/sets/batch-hybrids-ld-a.ts', "ctx.choose('pile'", 'const keep')),
    reportId: 360,
    status: 'open',
  },
  {
    id: 550, area: "client", severity: "minor",
    title: "the pages after the home draw their title bar and footer in the plain text font, not the home page's brand lettering",
    detail: "Report #361 (mycheze, account page, 2026-11-09, ux, minor): \"We should use the same font from the homepage in the headers and footers of all pages.\" The home page sets its headings and its footer's \"Algomancy\" in the brand face, `var(--font-brand)` (styles/pages/54-home-art.css ~line 28, the rule headed \"the brand face\": `.homeplayhead h1, .homesidetitle > span, .lgglname, .chgltitle, .homewordmark`, uppercase, letter-spacing .04em; the footer's wordmark is a `<span class=\"homewordmark\">` inside its info button, ui/pages/home.ts bottomHtml). Every other page is drawn in the app frame (ui/pages/frame.ts frameHtml): its title bar's page name is `<h1 class=\"frametitle\">` (styles/pages/49-frame.css, size and weight only, no font-family, so it inherits the body font) and its footer is `CLIENT_INFO`, an info button whose label is plain text with no wordmark span.",
    evidence: "Report #361 (page: acct, no room). Code read 2026-11-09 (steward triage): `--font-brand` is used only by the home's rules above in all of ui/styles (grep `font-brand`); the frame's title and footer carry no font of their own. The frame is shared by every page after the home (decks, cards, metagame, challenge, league, queue, match, profile, sign-in …), so one change in frame.ts and 49-frame.css reaches them all. Not seen in a browser (none on the box).",
    fix: "In the frame, set the title bar's page name in the brand face as the home's headings are (`.frametitle`: `font-family: var(--font-brand)`, weight 400, uppercase with the home's letter-spacing; check that long titles still ellipsize and that the `<small>` subtitle keeps the body font), and give the footer's button the home's label markup (`<span class=\"homewordmark\">Algomancy</span> Online <span class=\"homewordsub\">(Unofficial Client)</span>`, the wordmark rule widened from `.homeinfo` to the frame's `.frameinfo` too, or one shared class). A ui test over frameHtml's markup (the footer's wordmark span) and over the CSS read through ui/test/read-styles.ts (the frame title takes the brand face).",
    proof: () => !/homewordmark|wordmark/.test(body('ui/pages/frame.ts', 'export const CLIENT_INFO', '/* ── painting')),
    verify: "Open any page from the home (Decks, Cards, your profile): the page name in the top bar and the \"Algomancy\" in the bottom bar are in the same lettering as the home page's headings and footer.",
    reportId: 361,
    status: 'open',
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const CARD_TODO: TodoEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
