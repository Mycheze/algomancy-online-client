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
      '⚠ MEASURED AND DELIBERATELY NOT BUILT, 2026-08-30 (CR 802.21). The clause is real and '
      + 'printed - verified on the Seismomancy scan - but it is UNREACHABLE in this pool, so '
      + 'building it would be machinery for a case that cannot occur. A one-shot spell resolves '
      + 'once and killRiders fires once per resolving part, so a source that cannot kill twice '
      + 'can never be observed losing anything. It would bite only if a UNIT could carry '
      + '{Reaping}, and nothing can give one: all four printers are kind spell with EMPTY '
      + 'augmentAttrs (so no virus or augment donation under CR 721.4b), and The Omniphage - the only '
      + 'other card naming the attribute - grants off BIN UNIT cards. A 2026-08-26 round built '
      + 'a {Reaping} combat seam on a premise like this one and had to REVERT it, because no '
      + 'test could fail on a case that cannot happen. This entry stays OPEN rather than closed '
      + 'as built, and severity drops to minor: the gap is real, it costs nothing today, and '
      + '263 §4 is the tripwire that was missing in August - it goes RED the day a printer '
      + 'stops being a spell, gains augmentAttrs, or another card starts naming the attribute. '
      + 'THAT is the day this needs code. Also done here: the stale engine.ts comment asserting '
      + 'no {Reaping} card prints a reminder is replaced by the printed sentence itself.'
      + "\n\nRE-CHECKED 2026-10-22, still deliberately open: no unit can carry {Reaping} in this pool, so the until-regroup loss still cannot be observed, and 263 section 4 is still the tripwire. The engine.ts note now states the printed reminder and why the second sentence is not built (0ee1250, eb3db42); nothing else changed.",
    status: 'open',
  },
  // ── the comprehensive-rules export's findings, re-checked at HEAD and filed
  //    2026-10-10 (CT-226..CT-280 are reserved for that project). Each names its
  //    finding ids in data/comprehensive-rules/findings/, which carry the CT back.
  {
    id: 235, area: "coverage", severity: "minor",
    title: "test titles and messages in ten places, and one register row, still state law that a later ruling or the card changed",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) Each title below names behaviour the rulings have since changed; most assertions already follow the new law, so only the words mislead (Biomass Devourer's cannot tell the two bins apart at all). (1) 133: \"R157 §20 — …\" titles; §20 no longer holds (CR 107.5). (2) 45-hybrids-ld-b: Deferral Drone \"this turn\"; the card and the engine say this phase, and the retired register's table listed the clear in E.startTurn. (3) 26-metal-a: a stolen unit dies to its OWNER's bin; CR 405.3 sends it to the controller's. (4) 36-cache-prophecy: a cached token \"is erased, not cached\"; CR 410.5c has it visit the cache. (5) 178: \"Q3 is OPEN\" and \"the pile is untouched\"; CR 407.2 files the pile. (6) 36: prophesying is illegal in the haste step, unqualified; CR 504.9 allows a [Haste] banner. (7) util.ts and three tests: the haste step opens only for a payable haste card; CR 504.5 opens it every turn. (8) 35-rot: \"deployment opens no priority window\"; deployment now has a stack (CR 507.5). (9) 44: old suppression \"is a veto ABOVE copy\"; CR 712.2 says otherwise: a strip takes only what the unit has when it applies. (10) 42-dark-b: Afflicting rots \"the owner\"; Umbral Decay prints the controller.",
    evidence: "Findings F-U02-1, F-U04-1, F-U07-1, F-U07-2, F-U07-4 (dup F-U16-1), F-U08-2, F-U08-3, F-U09-1, F-U16-2, F-U20-2. Quotes: \"R157 §20 — with no Stasis Sentry an X spell costs exactly X\"; \"the next card you play this turn costs [3] less\"; \"| **clear** | `E.startTurn`, beside the `Entity.budgets` wipe |\"; \"R140: a stolen unit dies — the erase reaches the OWNER\"; \"R46: a TOKEN cached from play is erased, not cached (there is no card)\"; \"Q3 is OPEN\"; \"the host lives, and the pile is untouched\"; \"R42: prophesying is a DEPLOYMENT action — illegal in planning, the haste step and battle\"; \"appears when someone holds a payable haste card) */\"; \"R38: rot damage cannot be responded to — deployment opens no priority window\"; \"R118: R62 suppression is a veto ABOVE copy\"; \"{Afflicting} rots the owner of what it kills\".",
    fix: "Retitle each test to the live ruling and reword the messages. Where the assertion cannot tell old law from new (26-metal-a; 42-dark-b, where owner and controller coincide), add the case that can.",
    proof: () => still('engine/test/45-hybrids-ld-b.test.ts', 'the next card you play this turn costs [3] less') || still('engine/test/26-metal-a.test.ts', 'the erase reaches the OWNER') || still('engine/test/36-cache-prophecy.test.ts', 'is erased, not cached (there is no card)') || still('engine/test/178-played-item-and-erased-mods.test.ts', 'Q3 is OPEN', 'the pile is untouched') || still('engine/test/42-dark-b.test.ts', 'rots the owner of what it kills'),
    progress: "PARTLY FIXED 2026-10-24 (33ec835): (2) Deferral Drone says \"this phase\"; (3) 26-metal-a retitled and asserts the controller's bin (mutant-proved); (4)(6) 36 retitled, the token test asserts the cached event; (7) the haste-step messages cite CR 504.5 (08-cards2, 33, 15-water-b, 416, util.ts, ui 75); (10) 42-dark-b retitled, with a new stolen-unit test (mutant-proved). LEFT: (1) 133's proof needle 'CR 107.2 —' can never go false though 133 already cites current law (fix the proof); (5) 178's two titles, cited in full by CT-86's guards in card-todo-closed.ts, proposed: \"CR 720.9 Slag Spewer: an erase paid as a COST announces itself with a real erased event and files the erased pile\" and \"CR 720.9 Suppression Field: mods leave host and game, the host lives, and the erased pile files them\"; (8) 35-rot \"deployment opens no priority window\" matches CR 507.5, so that needle is not a defect (finding F-U09-1 is outdated); (9) 44's title, bound in full by CR 712.1a's example, kept (its message now cites CR 712.2). AUDIT 2026-10-24 (housework; AUDIT-ct-engine.md): the proof could never have gone false, because four of its needles matched words that are correct. They are retired here: (1) 133 'CR 107.2 —' (133 cites current law); (6) 36's 'illegal in planning, the haste step and battle', which still matched the RETITLED 36:228 \"CR 803.7b: … a banner not ending in [Haste] is illegal in planning, the haste step and battle (CR 504.9)\"; (8) 35-rot 'deployment opens no priority window' (correct under CR 507.5); (9) 44 'suppression is a veto ABOVE copy' (kept on purpose, bound by CR 712.1a's example in rules/U16.json). The proof now reads only the real defects; today that is item (5). RENAME TABLE for (5), one change: (a) 178-played-item-and-erased-mods.test.ts:268 \"CR 720.9 Slag Spewer: an erase paid as a COST still announces itself with \"info\" — Q3 is OPEN\" → \"CR 720.9 Slag Spewer: an erase paid as a COST announces itself with a real erased event and files the erased pile\"; (b) :301 \"CR 720.9 Suppression Field: mods leave host and game, the host lives, and the pile is untouched\" → \"CR 720.9 Suppression Field: mods leave host and game, the host lives, and the erased pile files them\"; (c) card-todo-closed.ts CT-86's two guards, which cite both titles as substrings; (d) findings F-U07-4 and F-U16-1, whose evidence quotes them (cr:check reports a stale finding-evidence once the quote leaves the file: re-quote or close through the cr scripts, as d387740 did). Neither 178 title is bound by a rule example, so no re-verify. Verdict tests_run patterns are frozen history: leave them. Then close with guards on the two new 178 titles plus 26-metal-a and 42-dark-b.",
    status: 'open',
  },
  {
    id: 236, area: "coverage", severity: "minor",
    title: "the RAQ ledger (and, until 2026-10, the ruling register) still carry open warnings and claims that later work has settled",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) Register text only; the engine or client already does the right thing. (1) the retired register said Living Vault refuses X cards in hand (CR 107.3a: an X card in hand costs 0); 39-light-b asserts it offers them at [0]. (2) the retired register said the client does not re-seed its block build when the attack line closes; rekeyBuild does, pinned by 55-ui-formation. (3) the retired register asked for a declareBlocks:spellTokens facet; 75-ui-reachability has it. (4) the retired register worded Embermaw Fledgling's count as units the controller \"owns\"; the card counts by control, which is right. (5) the retired register said the inspector states a reminder twice and must be fixed \"before this counts as closed\"; ui/main.ts already drops those rows. (6) the retired register said nineteen tier-1 announcements \"remain log-only\"; the client toasts every one (CT-142; CR D7.4). (7) The RAQ note on the Wispweaver guard still warns it is green \"for the wrong reason\" after the Sandstone case was found to be a fixture error.",
    evidence: "Findings F-U02-2, F-U11-1 (dup F-U24-2), F-U11-2, F-U10-1, F-U24-1, F-U24-4, F-U15-2. digital-rules.md: \"`printedMana` returns `null`, so an X card in hand is never offered); the\"; \"re-seed its preview when `b.columns.length` changes, and it does not yet.\"; \"It wants a `declareBlocks:spellTokens` facet and a\"; \"units the controller owns in `battle.columns` at trigger resolution\"; \"One duplication is left standing and it is in `ui/main.ts`.\"; \"Nineteen tier-1 announcements remain log-only.\" raq.ts: \"Green partly for the wrong reason given the Sandstone defect\".",
    fix: "Update the RAQ note. (The register warnings this entry listed went with the register, 2026-10.)",
    // the register half of this entry went with the register (2026-10 CR-only migration); the RAQ note is what is left
    proof: () => still('ledgers/raq.ts', 'Green partly for the wrong reason given the Sandstone defect'),
    progress: "AUDIT 2026-10-24 (housework; AUDIT-ct-engine.md, AUDIT-cr.md §5): still real. Rewrite the Wispweaver note in ledgers/raq.ts (\"Green partly for the wrong reason given the Sandstone defect\"): the Sandstone case was a fixture error and the engine was right, so the warning has no basis. In the same edit fix two more stale raq.ts notes: the strike-memory note \"⚠ Green today only because the engine keeps NO strike memory at all\" (D-U12-16; the strike memory exists since 2026-10-09) and the Containment Protocol note \"Resonant never waits on the stack\" (D-U20-6; it waits since 2026-10-09). The Wispweaver edit retires finding F-U15-2's evidence quote: re-quote or close it through the cr scripts. Then the proof goes false; close.",
    status: 'open',
  },
  {
    id: 238, area: "coverage", severity: "minor",
    title: "two test titles still call a settled ruling an open question (the Wraith self-pick, Abyssal Evocation's timing)",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) (1) 37-attrs-wight is titled \"(unconfirmed reading)\" with a warning mark, but CR 110.4a settles that \"an ally\" may be the unit itself (CR rule concepts.targets.ally.self). (2) 12-fire-a is titled \"⚠ OPEN — a bin-played card obeys its PRINTED timing\" and says the assertion flips if the owner rules otherwise; the owner ruled it on 2026-08-25 (\"Already correct — Abyssal Evocation, Writhing Host.\"), and CR 702.2a states it. The behaviour is right in both; only the words are stale.",
    evidence: "Findings F-U03-1, F-U07-3 (dups F-U14-4, F-U21-1). 37-attrs-wight.test.ts: \"R71 ⚠: a lone Wraith may pick ITSELF as \"an ally\" (unconfirmed reading)\". 12-fire-a.test.ts: \"Abyssal Evocation: ⚠ OPEN — a bin-played card obeys its PRINTED timing\". digital-rules.md: \"Already correct — Abyssal Evocation, Writhing Host.\"",
    fix: "Retitle both to cite the ruling that settled them, and drop the \"flips if\" comment in 12-fire-a.",
    proof: () => still('engine/test/37-attrs-wight.test.ts', '(unconfirmed reading)') || still('engine/test/12-fire-a.test.ts', '⚠ OPEN — a bin-played card obeys its PRINTED timing'),
    progress: "PARTLY FIXED 2026-10-24 (e68f99e): 37-attrs-wight retitled \"a unit is its own ally\", and 12-fire-a's \"flips if\" comment replaced by the owner's 2026-08-25 words and CR 702.2a. LEFT: the 12-fire-a title \"Abyssal Evocation: ⚠ OPEN — a bin-played card obeys its PRINTED timing\" is bound in full by CR 405.9 (zones.bin.play-from-bin): rename it and rebind that example in one change. AUDIT 2026-10-24 (housework; AUDIT-ct-engine.md): 37-attrs-wight is done (0 matches). RENAME TABLE, one change: (a) 12-fire-a.test.ts:141 \"Abyssal Evocation: ⚠ OPEN — a bin-played card obeys its PRINTED timing\" → a title citing CR 702.2a and the owner's 2026-08-25 \"Already correct\"; (b) rebind the CR 405.9 example (rules/U07.json key zones.bin.play-from-bin), which changes its recordHash and so needs a round-4 re-verify, stamp, cr:render and cr:check; (c) re-quote or close findings F-U07-3, F-U14-4 and F-U21-1, which quote the old title. The verdict pattern in verdicts/U07.json is frozen history: leave it. Best done in one session with CT-235 and CT-354 (one re-verify batch).",
    status: 'open',
  },
  {
    id: 295, area: "coverage", severity: "minor",
    title: "a variable-cost ability's X can settle on a value whose restriction then has no target; test 30's header calls the X primitive parked",
    detail: "From WP1 (#211). A variable bracketed cast cost's X is fixed by paying one unit at a time, so nothing stops it settling on an X that leaves an X-reading restriction with no target. No card does it today; 453's tripwire fails if one appears. Separately, 30-hybrids-wm-b.test.ts's header still says \"the cast-time X primitive is PARKED\", which is stale.",
    evidence: "Found by the agent fixing report #211 (report round 2026-10-16), reading variableCostXChoices and test 30.",
    fix: "Filter the payable sizes like collectX does if a card ever needs it; fix the header.",
    proof: null,
    verify: "Read 453's tripwire and test 30's header.",
    status: 'open',
  },
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
    id: 354, area: "coverage", severity: "minor",
    title: "three test titles still describe the old Unstable reading: 224 says \"CR 801.2h says not trashed\", 429 says \"engine differs\", 35 likewise",
    detail: "CR 801.2h now reads \"An {Unstable} card that dies in play is still trashed: trashing is part of its death\" (CT-246, owner 2026-10-22: \"Trash isnt a trigger tho. Its a kind of death thing.\"). The tests that pin that behaviour still say the opposite in their names: 224-mod-trash \"CT-246 GUARD (engine; CR 801.2h says not trashed): ...\" (two tests) and \"... (CT-246; CR 801.2h differs) the body always is\"; 429 \"cr:keywords.actions.trash.unstable-death — engine differs: ...\"; and the assertion label in 35-rot-debt-trash \"(CR 801.2; the engine route, CT-246 — CR 801.2h says not trashed)\". The assertions are right; only the words are stale.",
    evidence: "The CR pass, report round 2026-10-22/23 (CR-PASS-REPORT, \"Stale test titles\").",
    fix: "Rename them to say what CR 801.2h says now. A rename must update everything that cites the old title in the same change: the guards in card-todo-closed.ts (CT-246's family) and playtest-ledger-closed.ts, and the CR records whose examples bind these titles (findings U07/U18 and the rendered rules cite them, so the cr scripts re-bind and re-render; verdicts are frozen history and stay).",
    proof: () => still('engine/test/224-mod-trash.test.ts', 'CR 801.2h says not trashed', 'CR 801.2h differs')
      || still('engine/test/429-cr-keyword-actions.test.ts', 'engine differs: a printed-Unstable')
      || still('engine/test/35-rot-debt-trash.test.ts', 'CR 801.2h says not trashed'),
    verify: "grep \"801.2h says not trashed\" and \"engine differs\" in client/engine/test.",
    progress: "PARTLY FIXED 2026-10-24 (0aa7c53): 429 and 35 retitled, one 224 title renamed, comments reworded. LEFT: two 224 titles cited in full by card-todo-closed.ts (CT-246) and playtest-ledger-closed.ts; proposed \"CT-246 GUARD (CR 801.2h: an Unstable card that dies is still trashed): the BODY of an Unstable unit that dies is trashed, mods or no mods\" and \"CR 801.2g whole pool: no nontoken mod is trashed by its host death — and the body always is (CR 801.2h)\". Rename and update both ledgers in one change. AUDIT 2026-10-24 (housework; AUDIT-ct-engine.md): REAL, AND ABOUT FIVE TIMES WIDER THAN FILED. As filed: 224-mod-trash.test.ts:97 and :280, plus the :102-104 comment that explains why they were kept (it also matches the proof needle). Same change: card-todo-closed.ts (CT-246's guards cite both titles in full) and playtest-ledger-closed.ts (likewise), and findings F-U07-6 and F-U18-1, whose evidence quotes the :97 title (re-quote or close through the cr scripts). Neither title is bound by a rule example. NOT ON THE TICKET, the same stale phrase \"CR 801.2h differs\" (CR 801.2h now agrees with the engine): four more test titles, 42-dark-b.test.ts:272, :315, :351 and 43-dark-c.test.ts:86, whose ledger citations (playtest-ledger-closed.ts) cite only the suffix, so renaming the prefix is free; and comments or messages at 42-dark-b:255, :693, :695; 43-dark-c:191, :245; 62-death-facts:116, :136; 37-attrs-wight:655; 17-earth-b:668; 229-cosmic-and-control:670; 35-rot-debt-trash:393 (\"CR 801.2h would invert it back\"); engine.ts:6846, :6959. Widen the ticket to \"CR 801.2h differs, everywhere\" and sweep with one grep for '801.2h differs', '801.2h says not trashed' and '801.2h would'.",
    status: "open",
  },
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
  // ── the round of 2026-10-24 (r1024) ───────────────────────────────────
  {
    id: 374, area: "card", severity: "minor",
    cards: ["Torrential Reclamation"],
    title: "Torrential Reclamation: our oracle row and scan carry the wording from before the designer's 2024-03-29 reword",
    detail: "The oracle row (revision 2024-03-14) and data/cards/Torrential-Reclamation.jpg read \"Recall X target nontoken allies. Then each player sacrifices a unit and you lose 1 life for each ally recalled this way.\" On 2024-03-29 Caleb accepted the reword \"for each ally recalled this way, each player sacrifices a unit and you lose 1 life\" (\"Alright lol I'll change it\") and said \"alright I updated torrential reclamation with the print company\". For the per-ally sacrifice the meaning is the same (CT-356); for X = 0 it is not (CT-375).",
    evidence: "Round 2026-10-24, R1024-engine.md (new defect 2, and the CT-356 thread): rules-questions [1223284240943153253] and [1223306509216382976].",
    fix: "Owner and data question: find the printed card (a newer scan or the print run). If it carries the reword, fix the oracle row in place with the reason in the commit and run npm run extract; if not, record that the print kept the old order.",
    proof: null,
    verify: "Compare data/cards/Torrential-Reclamation.jpg and the oracle row with a current printed copy.",
    status: 'open',
  },
  {
    id: 386, area: "card", severity: 'minor',
    cards: ["Worldbender"],
    title: "Worldbender's oracle row carries a ruling the designer called outdated (\"All draft skipping cards are not legal in formats without a draft.\")",
    detail: "data/cards/AlgomancyCards-OracleText.json, Worldbender, `rulings`: \"All draft skipping cards are not legal in formats without a draft.\" Caleb called that ruling outdated in rules-questions (messages #22656/#22659 of the 2026-10-11 gold set). The bot hides it with an OUTDATED_CARD_RULINGS entry in bot/pipeline/build_corpus.py instead of the canonical file being fixed, so every other reader of the oracle still sees it.",
    evidence: "tickets.md [WS3b] and [WS2] in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass.",
    fix: "Delete the line from the oracle row in place, with the designer messages in the commit message (canonical file), run npm run extract, drop the OUTDATED_CARD_RULINGS entry, and rebuild the corpus in the main checkout.",
    proof: () => still("../data/cards/AlgomancyCards-OracleText.json", "All draft skipping cards are not legal in formats without a draft."),
    status: 'open',
  },
  {
    id: 387, area: "coverage", severity: 'minor',
    title: "CR 721.1f lists only dies, recalled or cached for a donated \"When I despawn\"; erased and exchanged are missing",
    detail: "CR 721.1f (effects.augment.what.despawn) says a mod's donated \"When I despawn\" ability \"triggers whichever way the host leaves play: when it dies, is recalled or is cached.\" CR 410.2 counts erasing and exchanging out of play as despawning too, and CT-350's guards (626) already cite 721.1f for an erased and an exchanged Ancient One. The list is short by two.",
    evidence: "tickets.md [CR] in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 conflicts.",
    fix: "Add \"is exchanged or is erased\" to 721.1f, bind 626's erased and exchanged tests as examples, stamp, re-verify (round 4, fresh verifier, decoys), cr:render, cr:check, 409.",
    proof: () => still("../data/comprehensive-rules/rules/U17.json", "triggers whichever way the host leaves play: when it dies, is recalled or is cached."),
    status: 'open',
  },
  {
    id: 388, area: "coverage", severity: 'minor',
    title: "CR 410.4d does not say whether an Unstable unit exchanged out of play is trashed before it is erased",
    detail: "CR 410.4d: \"But a modded unit is {Unstable}, so when it is exchanged out of play, it and all of its mods are erased, just as they would be if it died.\" CR 801.2h says a dying Unstable card is still trashed, for death only. The engine trashes and then erases an exchanged Unstable body (129-disposal-tail (iii) asserts ['trashed', 'erased']), which the CR does not state.",
    evidence: "tickets.md [WS1 coverage agent] in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass.",
    fix: "State it in 410.4d (\"it is trashed and then erased\"), citing 410.7 and the owner's 2026-08-25 \"a despawn and trashing\", bind 129's test, and re-verify.",
    proof: () => still("../data/comprehensive-rules/rules/U07.json", "so when it is exchanged out of play, it and all of its mods are erased, just as they would be if it died."),
    status: 'open',
  },
  {
    id: 389, area: "coverage", severity: 'minor',
    title: "CR 901.8 (Single Card Duel) duplicates Annex D8.2; both are live and code cites 901.8",
    detail: "The Single Card Duel rules are stated twice: 901.8* in the main document (\"Single Card Duel is a variant of constructed that the client offers.\") and D8.2* in Annex D, which is where a digital-only mode belongs. server/rooms.ts and ui/main.ts cite CR 901.8, so the two can drift apart and readers are sent to the wrong one.",
    evidence: "coverage-gaps.md (DUPLICATE: 901.8* ≡ D8.2*) in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6.",
    fix: "Tombstone the 901.8* keys (ledger.mjs remove <key> \"duplicate of D8.2\" annexd.<key>), remap the citations in rooms.ts and ui/main.ts to D8.2, cr:render, cr:check, 184, 409.",
    proof: () => still("../data/comprehensive-rules/rules/U22.json", "Single Card Duel is a variant of constructed that the client offers."),
    status: 'open',
  },
  {
    id: 391, area: "coverage", severity: 'minor',
    title: "stale comments still state superseded law: owner's bin and cache, the payable-haste step, a linear multiplier, regroup erasing Oorblak, deletion not a death",
    detail: "Comments and prose that contradict the current CR (the code and assertions are right): (1) engine.ts \"push each nontoken mod into its owner's bin\", \"a dying TOKEN really does enter its owner's bin\", dsl.ts \"a death bins to the OWNER's bin\", 141-despawn-mods \"goes to its own owner's bin\", 39-light-b \"into its owner's cache\" (CR 400.4, 410.4a: the controller's); (2) server/scenarios-i.ts and scenarios.ts, ui/glossary.ts: the haste step opens only for a payable haste card (CR 504.5: every turn); (3) batch-hybrids-ld-b.ts, dsl.ts, 137: the Arbiter multiplier is linear (CR 708.6: a product); (4) 17-earth-b \"regroup would\" erase Oorblak (CR 506.2); 28-metal-c \"a deletion and still not a death\" (CR 713.8, 801.5); engine.ts \"the formation may collapse\" between sub-steps (CR 602.5a, 608.3e); registry.ts \"a legal ally — it just does nothing.\" (CR 110.2c); engine.ts and 92-unaware \"the Unaware rule's one open edge\" (CR 802.9h); and engine.ts's grafted-cost comment \"whose cost is declined at\" (CR 111.15; the declineCost branch is dead, CT-216).",
    evidence: "tickets.md and coverage-gaps.md in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass, each phrase re-found on 2026-10-24.",
    fix: "One comment sweep: reword each to the current rule (cite it), give 39-light-b a case where owner and controller differ, and consider deleting the dead declineCost branch. No behaviour change.",
    proof: () => still("engine/src/engine.ts", "push each nontoken mod into its owner's bin") || still("server/scenarios.ts", "The haste step only engages when somebody holds a payable haste") || still("engine/src/cards/sets/batch-hybrids-ld-b.ts", "v × 2 × n is LINEAR in n, so three") || still("engine/test/17-earth-b.test.ts", "because Oorblak is {Unstable} and regroup would") || still("engine/test/28-metal-c.test.ts", "a deletion and still not a death.") || still("engine/src/engine.ts", "whose cost is declined at"),
    status: 'open',
  },
  {
    id: 392, area: "coverage", severity: 'minor',
    title: "CR coverage gap: \"When I am trashed\" fires from the bin",
    detail: "The engine relies on a rule no comprehensive rule states. engine.ts fireOwnTrashTrigger fires a card's own trash trigger with the card already in the bin. Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: 801.2j (U18).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in 801.2j (U18) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("engine/src/engine.ts", "private fireOwnTrashTrigger(seat: Seat, name: CardName, region: number, ev: EngineEvent, anchor?: Entity): void {"),
    status: 'open',
  },
  {
    id: 393, area: "coverage", severity: 'minor',
    title: "CR coverage gap: who controls a copy of a spell",
    detail: "The engine relies on a rule no comprehensive rule states. The engine stamps the original's controller on a copy unless the effect names one: \"copy.controller = opts.controller ?? orig.controller;\". Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: 710.8e (U16).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in 710.8e (U16) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("engine/src/engine.ts", "copy.controller = opts.controller ?? orig.controller;"),
    status: 'open',
  },
  {
    id: 394, area: "coverage", severity: 'minor',
    title: "CR coverage gap: text with no qualifier gets none, as a general rule",
    detail: "The engine relies on a rule no comprehensive rule states. Only 110.3 (targets) and 707.7 (statics) say it; 182-correctness-sample relies on it in general (\"carries no qualifier, so every unit in reach is\"). Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: 101.7 (U01).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in 101.7 (U01) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("engine/test/182-correctness-sample.test.ts", "carries no qualifier, so every unit in reach is"),
    status: 'open',
  },
  {
    id: 395, area: "coverage", severity: 'minor',
    title: "CR coverage gap: event-defined amounts (\"that much\", \"that many\", X = the damage dealt) are read off the event",
    detail: "The engine relies on a rule no comprehensive rule states. About eleven card sites read such amounts off the triggering event, and 109.3b says the opposite: \"An amount a triggered ability uses is measured when the ability resolves, so responses can change it.\" It also covers how Torrential Reclamation splits its count over both clauses. Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: 109.3c (U03), narrowing 109.3b.",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in 109.3c (U03), narrowing 109.3b from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("../data/comprehensive-rules/rules/U03.json", "An amount a triggered ability uses is measured when the ability resolves, so responses can change it."),
    status: 'open',
  },
  {
    id: 396, area: "coverage", severity: 'minor',
    title: "CR coverage gap: a grafted rider's variable cost sets its own X",
    detail: "The engine relies on a rule no comprehensive rule states. 50-ui-inspect relies on it: \"a grafted rider's variable cost is its OWN X and is attributed to the\". Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: U17 (the graft rules).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in U17 (the graft rules) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("engine/test/50-ui-inspect.test.ts", "a grafted rider's variable cost is its OWN X and is attributed to the"),
    status: 'open',
  },
  {
    id: 397, area: "coverage", severity: 'minor',
    title: "CR coverage gap: two permission sources are no stronger than one (Rook, Slurpr)",
    detail: "The engine relies on a rule no comprehensive rule states. batch-light-c.ts: \"unbudgeted OR-FOLD in Rook's shape: one grantor is enough, two Slurprs are\". Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: 707.10a (U15).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in 707.10a (U15) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("engine/src/cards/sets/batch-light-c.ts", "unbudgeted OR-FOLD in Rook's shape: one grantor is enough, two Slurprs are"),
    status: 'open',
  },
  {
    id: 398, area: "coverage", severity: 'minor',
    title: "CR coverage gap: the discarding player picks which card to discard",
    detail: "The engine relies on a rule no comprehensive rule states. 704.1a says only that a discard is not a target; batch-dark-c.ts (Void Memory): \"The discarding player picks their own card\". Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: 801.3a (U18).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in 801.3a (U18) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("engine/src/cards/sets/batch-dark-c.ts", "The discarding player picks their own card"),
    status: 'open',
  },
  {
    id: 399, area: "coverage", severity: 'minor',
    title: "CR coverage gap: debt is always payable, with no cap",
    detail: "The engine relies on a rule no comprehensive rule states. engine.ts: \"case 'gainDebt': return true;   // debt is always takeable\". Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: 112.14d (U04).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in 112.14d (U04) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("engine/src/engine.ts", "case 'gainDebt': return true;"),
    status: 'open',
  },
  {
    id: 400, area: "coverage", severity: 'minor',
    title: "CR coverage gap: Spell Excavation's grant is singular and spent on the play",
    detail: "The engine relies on a rule no comprehensive rule states. apply.ts: \"The SINGLE-CARD grant (CR 405.9)\". Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: an example under 405.9 (U07).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in an example under 405.9 (U07) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("engine/src/apply.ts", "The SINGLE-CARD grant (CR 405.9)"),
    status: 'open',
  },
  {
    id: 401, area: "coverage", severity: 'minor',
    title: "CR coverage gap: whose erased pile a spell and its Virus go to",
    detail: "The engine relies on a rule no comprehensive rule states. 723.4b is silent on it; the engine files them somewhere, and no rule says whose pile. Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: 723.4c (U17).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in 723.4c (U17) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: null,
    verify: "Read CR 723.4b/723.4c for whose erased pile a negated spell with a Virus on it goes to; none says.",
    status: 'open',
  },
  {
    id: 402, area: "coverage", severity: 'minor',
    title: "CR coverage gap: a non-target choice with no candidate does nothing (not a fizzle), keeping the Wraith exception",
    detail: "The engine relies on a rule no comprehensive rule states. 37-attrs-wight: \"'no candidates, nothing to ask'\". Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: 110.2d (U03).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in 110.2d (U03) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("engine/test/37-attrs-wight.test.ts", "'no candidates, nothing to ask'"),
    status: 'open',
  },
  {
    id: 403, area: "coverage", severity: 'minor',
    title: "CR coverage gap: a card is never nowhere (always in exactly one zone)",
    detail: "The engine relies on a rule no comprehensive rule states. 169-mid-resolution-window: \"is in exactly one place — never nowhere, never duplicated\". Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: U07 (zones), minor.",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in U07 (zones), minor from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("engine/test/169-mid-resolution-window.test.ts", "is in exactly one place — never nowhere, never duplicated"),
    status: 'open',
  },
  {
    id: 404, area: "coverage", severity: 'minor',
    title: "CR coverage gap: Annex D: a target menu names each unit's controller",
    detail: "The engine relies on a rule no comprehensive rule states. engine.ts builds each option as the card and its controller's name: \"(${this.pname(u.controller)}'s)\". Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: D6.19 (U24).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in D6.19 (U24) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("engine/src/engine.ts", "(${this.pname(u.controller)}'s)"),
    status: 'open',
  },
  {
    id: 405, area: "coverage", severity: 'minor',
    title: "CR coverage gap: Annex D: dormant resources are drawn dimmed",
    detail: "The engine relies on a rule no comprehensive rule states. Only 106.3b (\"can't be spent\") exists; ui/resources.ts: \"A dormant resource cannot be spent\" and 127-token-x-and-dormant pin the dimming. Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: a D6 rule (U24).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in a D6 rule (U24) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("ui/resources.ts", "A dormant resource cannot be spent"),
    status: 'open',
  },
  {
    id: 406, area: "coverage", severity: 'minor',
    title: "CR coverage gap: Annex D: every printed bracket is drawn as a box, not only modal ones",
    detail: "The engine relies on a rule no comprehensive rule states. D6.10a covers modal brackets only; ui/style.css draws every bracket: \"/* CR D6.10a: the panel the PRINTED card draws around a bracket\". Found by the 2026-10-11 cr-only round's citation agents (coverage-gaps.md), which listed it for a later drafting round that never happened; still a gap on 2026-10-24 (no rule text states it). Suggested home: D6.10 (U24).",
    evidence: "Coverage-gaps list in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass; AUDIT-cr.md §6 (\"STILL A GAP\").",
    fix: "Draft the rule in D6.10 (U24) from its sources (designer first, then print, then an owner call or the engine with a test), stamp, re-verify with a fresh verifier and decoys, cr:render, cr:check, 409. If no higher source speaks, file it as a tier-3 owner sign-off.",
    proof: () => still("ui/style.css", "CR D6.10a: the panel the PRINTED card draws around a bracket"),
    status: 'open',
  },
  // ── Passes B and C of the zero plan, 2026-10-25: defects the six agents found and did not fix
  {
    id: 411, area: "client", severity: "minor",
    title: "on a touch screen, after a tap reads a bin card its use button probably takes two taps: the first only puts the zoom away",
    detail: "CT-381 put a Play / Prophesy / Use as mod button (binuse) under each usable card in the bin dialog for touch. A tap on a bin card holds the zoom, and ui/touch.ts swallows the click of the next tap so that putting the zoom away never acts; the only exemption is the read's own button, closest?.('[data-btn=\"tapgo\"]') (CT-408). So a tap on binuse while the zoom is up only closes the zoom, and the card is used on the tap after. Read in the code, not driven.",
    evidence: "Pass C 2026-10-25, zero-handoff/PC-play.md (new defect 1): the play agent, fixing CT-408.",
    fix: "Drive it first with a real CDP finger (the PC-play rig, tapwalk.mjs) to confirm the two taps; then exempt the bin's button too, '[data-btn=\"tapgo\"], [data-btn=\"binuse\"]' in the lift handler of touch.ts, and add the one-tap case to 646.",
    proof: () => still('ui/touch.ts', "closest?.('[data-btn=\"tapgo\"]')"),
    verify: "On a touch device, tap a usable card in the bin dialog, then tap the button under it once: does it play?",
    status: 'open',
  },
  {
    id: 412, area: "client", severity: "minor",
    cards: ["Arbiter of Vitality", "Flux Resonator", "Proliferating Slime", "Channel Through"],
    title: "the stack caption still states the unmodified amount for Arbiter of Vitality life lines, Flux Resonator and Proliferating Slime counters, rot and debt, prevention, and Piercing or Electric overflow",
    detail: "CT-370 made a damage line say the damage that lands (Conduit of Pain, Powerful, Vulnerable, Pure). The rest of the class is not said on the line: (1) Arbiter of Vitality doubles life gain and loss (E.lifeAmount): \"Gain 3 life\" reads 3 and gains 6, and a player hit by \"Deal N damage\" loses 2N; (2) Flux Resonator and Proliferating Slime move counters, rot and debt by one, so \"Put N counters\" lines are off by one; (3) a prevention shield (preventUnitDamage) and {Piercing} or {Electric} overflow are not represented; (4) Channel Through's \"split N\" is doubled for Powerful only, without Conduit of Pain's per-point +1.",
    evidence: "Pass C 2026-10-25, zero-handoff/PC-play.md (CT-370 section, \"The class, swept\", and new defect 2): the play agent swept the pool's amountMods and amountMultipliers.",
    fix: "A second engine read helper beside amountDeltaPreview for amountFactor / lifeAmount and the counter, rot and debt deltas, priced in ui/doesline.ts the way damagePricer prices damage; decide how a shield and an overflow are said, or record that they are not. Resolve each case through the engine and require the caption to equal what happens, in both seats' views, as 678 does.",
    proof: null,
    verify: "With Arbiter of Vitality in play, put a \"Gain 3 life\" effect on the stack and compare its caption with the life gained (today 3 shown, 6 gained).",
    status: 'open',
  },
  {
    id: 413, area: "engine", severity: "minor",
    cards: ["Ancient One"],
    title: "a Deadly kill and an ordinary lethal kill in the same combat damage step are two death batches, so an Ancient One borrowed one when-I-die line instead of two",
    detail: "CR 713.6: \"Units that die in the same state check die together\", and CR 706.8c: units that die together hear each other. sweepDeadly (combat), sweepCollapsedDeaths (Unaware), sweepPureDeaths and the effect-Deadly loop in dealEffectDamageAll each destroy one unit at a time before or outside checkDeaths, so their victims never share a batch with the lethal-damage deaths of the same sub-step. Measured: a defending Rubbish-modded token, Ancient One and Rubbish-modded token killed by Deadly 1, 5 and 5 damage in one normal sub-step; the Ancient One borrowed 1 \"when I die\" line, where 2 are expected.",
    evidence: "Pass B 2026-10-25, zero-handoff/PB-combat.md (new defect 1): the combat agent, fixing CT-363, with a scratch probe (deadly-probe.test.ts in the session scratchpad, not committed).",
    fix: "Collect the Deadly, collapsed and Pure victims and dispose them in the same E.destroyBatch as the lethal set of checkDeaths (CT-363 extracted it). Guard with the probe's board, and replay stored games for drift (trigger counts change only when a batch listener or an Ancient One is among the victims).",
    proof: null,
    verify: "The probe in detail: Deadly 1, 5 and 5 damage into Rubbish-modded token, Ancient One, Rubbish-modded token in one sub-step; count the borrowed triggers (2 expected, 1 today).",
    status: 'open',
  },
  {
    id: 414, area: "engine", severity: "minor",
    cards: ["General Smof", "Ghord", "Spiteful Shadow", "Death Greeter", "Molten Tormentor", "Torrential Reclamation", "Malicious Hardware", "Maw of Damnation", "Cull", "Grim Bargain", "Mindburn", "No Hand Killer", "Sacrifice Dude", "Linked Extinction", "Perish", "Lurking Dread"],
    title: "\"each player sacrifices\" effects destroy their picks one at a time outside a death batch; whether simultaneous sacrifices die together is unruled",
    detail: "About fifteen cards make several units die at once by sacrifice, and each commits its picks with one destroy at a time, outside checkDeaths, so the victims are never one batch (CR 706.8c, 714.9). Plan then commit: General Smof, Ghord, Spiteful Shadow, Death Greeter, Molten Tormentor, Torrential Reclamation, Malicious Hardware, Maw of Damnation, Cull, Grim Bargain, Mindburn, No Hand Killer, Sacrifice Dude; interleaved with the picks: Linked Extinction, Perish; and the commit loop of Lurking Dread. No quote found says whether units sacrificed by one effect die together, so this needs a rules source before any change.",
    evidence: "Pass B 2026-10-25, zero-handoff/PB-combat.md (new defect 2): the combat agent, sweeping every destroy inside a loop while fixing CT-363.",
    fix: "Find a source first (designer, then RAQ, then the owner). If simultaneous sacrifices die together, the plan-then-commit sites call destroyBatch(picks, 'is sacrificed'), the two interleaved ones are reshaped to plan then commit, the CR gains the sentence, and stored games are replayed for drift.",
    proof: null,
    verify: "Search data/rulings for a ruling on sacrifices dying together; then, with each player sacrificing and an Ancient One among the picks beside a unit with a when-I-die line, count its borrowed triggers.",
    status: 'open',
  },
  {
    id: 415, area: "engine", severity: "minor",
    cards: ["Biomass Devourer", "Cthyrian Rector", "Murkdrop Distiller"],
    title: "a trigger that finds its card in a bin by the event binNth finds nothing when an earlier copy of the same name leaves first (the mirror of CT-380)",
    detail: "CT-380 made declared bin targets follow their copy: reindexBinRefs re-points every live BinRef when a copy of that name leaves the bin. The binNth stamped on 'trashed' and 'died' event data is not re-pointed. eventBinSlot / binIndexOfNth find \"the copy the event named\" by name and nth, so if an EARLIER copy of that name leaves the bin before the responder resolves, nth points past the end and Biomass Devourer, Cthyrian Rector or Murkdrop Distiller finds nothing, though the card is still in the bin. Found by reading the code; not run.",
    evidence: "Pass B 2026-10-25, zero-handoff/PB-zones.md (CT-380 section and new defect 1): the zones agent.",
    fix: "Re-index the binNth stamped on the event data of pending and stacked triggers inside reindexBinRefs, as CT-380 does for targets. Guard with two copies of one name in a bin, the later one the event's card and the earlier one taken out in response.",
    proof: null,
    verify: "Two copies of one card in a bin, the second just trashed with a Biomass Devourer-style watcher waiting; take the first copy out before the trigger resolves: does the trigger still find its card?",
    status: 'open',
  },
  {
    id: 416, area: "card", severity: "minor",
    cards: ["Tides of the Cosmos"],
    title: "Tides of the Cosmos plays a Virus onto units only, never onto a spell on the stack or a spell token in play",
    detail: "A Virus played from hand may go onto a spell on the stack (CR 723.4) and, since CT-407, onto a spell token in play during a battle (CR 721.4a). The Virus mode of Tides (virusHosts in batch-water-a.ts) collects only units in the region, so a Virus revealed by Tides cannot reach those hosts. The RAQ write-up says only that Tides lets you \"apply Viruses\"; no source asks for the gap to be closed or kept.",
    evidence: "Pass B 2026-10-25, zero-handoff/PB-zones.md (CT-407 section and new defect 2): the zones agent.",
    fix: "Ask whether a Virus played by Tides reaches every host a Virus from hand reaches. If so, build virusHosts from the same host list as battleVirusHosts (stack spells, spell tokens appended last), guard it, and replay stored games for drift.",
    proof: null,
    verify: "Tides of the Cosmos in battle revealing a Virus while an enemy spell is on the stack: is the spell offered as a host?",
    status: 'open',
  },
  {
    id: 417, area: "client", severity: "minor",
    title: "PROBE: a player brought to 0 by an effect part that then asks a question is shown on 0 with the question pending; the board has never been looked at in that state",
    detail: "Since CT-409 a player at 0 is not out until the effect part has finished, so a part that loses life and then asks something publishes a board with a player on 0 and a question up; the game ends when the part finishes. The rules handle it (test 654: Penance's draw now happens after a lethal loss), but no one has seen the client draw that state.",
    evidence: "Pass B 2026-10-25, zero-handoff/PB-end.md (\"Found, not fixed\" 2): the end agent, fixing CT-409; it could not drive it in a browser.",
    fix: "Find the cards whose part loses life and then asks a question, drive one to 0 life with the question up in a browser on both boards, and check the board reads sensibly (life 0, the prompt, the game over after it); fix whatever reads wrong.",
    proof: null,
    verify: "Penance on a player at 1 whose part then asks a question: look at the board while the question is pending.",
    status: 'open',
  },
  {
    id: 418, area: "engine", severity: "minor",
    title: "a deck-out inside an effect that has already taken a player to 0 ends the game at the draw, before the life check; which comes first is unruled",
    detail: "CT-385 ends the game the moment a draw finds the deck and the recycle pile empty (deckedOut), and CT-409 waits for the whole effect part before checking life totals. So an effect that takes a player to 0 and then makes a player draw from nothing is decided by the deck-out rule, not by the life comparison. Neither the designer nor the owner has ruled the order; the case is rare.",
    evidence: "Pass B 2026-10-25, zero-handoff/PB-end.md (\"Found, not fixed\" 3): the end agent, fixing CT-385 and CT-409.",
    fix: "Ask (designer's words first, then the owner) whether a pending life loss or a deck-out decides a game when both happen inside one effect; then make the engine and CR 104.1a / 104.5 say it, with a test.",
    proof: null,
    verify: "In constructed, an effect that brings a player to 0 and then makes the other player draw from an empty deck and pile: who wins, and by which rule?",
    status: 'open',
  },
  {
    id: 419, area: "client", severity: "minor",
    title: "regions board at 1280x720 in battle: the top info block is only 85px tall, so the spectated top-seat hand is 39x55",
    detail: "CT-368 gave the spectated hand a column of its own, sized from the info block's height. At 1440x900 and 1920x1080 its cards are a whole 92x128, but at 1280x720 during a battle the fit pass (ui/fit.ts planBattleBoard) leaves the top info block 85px tall, so the cards are 39x55: whole, but small.",
    evidence: "Pass C 2026-10-25, zero-handoff/PC-board.md (CT-368 section and new defect 1): the board agent, measuring in headless Chrome.",
    fix: "Give the info offshoot a height floor in planBattleBoard's band split while a spectator strip is drawn, or move the strip out of the block at short heights; measure at 1280x720, 1440x900 and 1920x1080 on both boards.",
    proof: null,
    verify: "Spectate a battle on the regions board at 1280x720 with both hands shown and measure the top hand's cards.",
    status: 'open',
  },
  {
    id: 420, area: "client", severity: "minor",
    title: "docs/19 says playing from the hand on touch is a drag or the rail's buttons, but the rail has no play button",
    detail: "client/docs/19-touch-and-drag.md, under \"A tap only reads\": \"Playing from the hand is a drag (below) or the rail's buttons.\" The rail has no play button, so the second route does not exist. Docs only; the client is right.",
    evidence: "Pass A 2026-10-24, zero-handoff/PA-touch.md, and again Pass C 2026-10-25, zero-handoff/PC-play.md (new defect 3).",
    fix: "Reword the sentence to the routes that exist (a drag, or the card menu where one is offered), checked against ui/main.ts and ui/touch.ts.",
    proof: () => still('docs/19-touch-and-drag.md', "hand is a drag (below) or the rail's buttons"),
    verify: "Read the \"A tap only reads\" paragraph of client/docs/19-touch-and-drag.md against the rail.",
    status: 'open',
  },
  {
    id: 421, area: "coverage", severity: "minor",
    title: "the live-draft deck-out tie rule is still labelled provisional in engine.ts and test 656, though the owner settled it",
    detail: "CT-385 shipped the tie rule for a shared-deck deck-out (the initiative player loses) as a provisional default put to the owner: engine.ts deckedOut's comment says \"PROVISIONAL, put to the owner\" and 656's test title ends \"(provisional)\". The owner settled it on 2026-10-25: \"INT player loses\". The behaviour is right; only the labels are stale.",
    evidence: "Books pass 2026-10-25, closing CT-385 against zero-handoff/ROUND-BC.md (owner answers).",
    fix: "Replace the provisional note in engine.ts with the owner's words and date, and drop \"(provisional)\" from 656's title (CT-385's guard cites the title without it, so no ledger change).",
    proof: () => still('engine/src/engine.ts', 'PROVISIONAL, put to the owner') || still('engine/test/656-deck-out.test.ts', 'goes against the initiative player (provisional)'),
    verify: "grep provisional in engine.ts deckedOut and in 656-deck-out.test.ts.",
    status: 'open',
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const CARD_TODO: TodoEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
