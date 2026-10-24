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
    id: 363, area: "engine", severity: "minor",
    cards: ["Ruinbringer", "Ominous Growth", "Deformant", "Pathogenic Enclave", "Sporebloom Siren"],
    title: "delete-all sweepers (Ruinbringer and four others) destroy their victims one at a time, outside the death batch",
    detail: "Ruinbringer (\"After combat, delete all units\"), Ominous Growth, Deformant, Pathogenic Enclave and Sporebloom Siren loop g.destroy(u, 'is deleted') over their victims outside checkDeaths (Ruinbringer's is batch-earth-c.ts line 115). So the victims are never one batch: CR 706.8c (\"Units that die together hear each other\") does not apply to them, nor does CT-351's neighbour snapshot, and an Ancient One deleted after its neighbour loses that neighbour's when-I-die text.",
    evidence: "Round 2026-10-24, R1024-engine.md (new defect 1): the engine agent, fixing CT-351.",
    fix: "An E.destroyBatch(units, verb) that sets deathBatch and deathBatchAdjacent the way checkDeaths does, used by every delete-all loop (derive the sites: every g.destroy inside a loop over units, not a hand list). It changes listener counts for these cards, so replay the stored games and check the drift.",
    proof: null,
    verify: "Ruinbringer's after-combat delete with an Ancient One between two units that have when-I-die text: count the borrowed triggers (two expected).",
    status: 'open',
  },
  {
    id: 364, area: "client", severity: "minor",
    title: "the shared id clock leaks hidden plays: a seat can count the other seat's spawns in a hidden step from the ids it is handed",
    detail: "CT-334 froze the actionCount served to the other seat during a hidden step. The same count leaks through ids: nextId and decisionHigh are served live in every view, and the ids of your own units, spell tokens and cached cards come off the same shared clock, so when your opponent spawns behind the freeze the next id you are handed jumps. Masking nextId in the view alone would not close it.",
    evidence: "Round 2026-10-24, R1024-server.md (new defect 1): the server agent, fixing CT-334.",
    fix: "Either per-seat id ranges inside a hidden step (an engine change that moves ids, so replay-sensitive) or symbolised ids in the view (large). Decide which before starting.",
    proof: null,
    verify: "In deployment, note the id of a unit you spawn, let the opponent spawn twice, spawn again: the gap counts their plays.",
    progress: "AUDIT 2026-10-24 (housework; AUDIT-ct-client.md): REAL, and the size is L (multi-session, replay-breaking). nextId is one shared clock behind entity ids, stack item ids, cached uids, decision ids and layer seqs; server/view.ts touches neither nextId nor decisionHigh. Masking them in the view is a few lines and does not close it (your own new ids still jump). A real fix is per-seat id bands inside a hidden segment (the precedent is segmentStamp/stampSeg in engine.ts for layer timestamps): about 18 nextId++ sites move to newId(seat); every stored game's ids change, so it needs an engine-version gate (171) and a drift replay of all saved games; renumberAction/renumberRefUids in rooms.ts assume one contiguous clock; ui/passrelease.ts relies on \"nextId only grows\"; and the bands must keep CR 113.2's initiative order because entity id doubles as a layer timestamp. Symbolised per-seat ids in every view is larger still. PRECEDENT: the owner declined this exact threat model for CT-106 on 2026-08-29 (\"Since all they get is very minimal information, I am not worried about this.\"): a modified client reading the wire, nothing on screen. So this is a wontfix candidate under that answer; it needs the owner's one-line confirmation that CT-106's answer covers it before it can be closed. Separately, CR D2.5e (annexd.auto-pass.haste-ready.residual) still says the action counter is sent to both players and rises on every action, which CT-334 made false and which contradicts D6.1a: redraft it to name the id clock as the residual.",
    status: 'open',
  },
  {
    id: 365, area: "client", severity: "minor",
    title: "renumberAction does not shift a cached-card target's uid when an undo splices out an id-allocating play",
    detail: "CT-199's fix forgives the uid shift in a later move's reference key (renumberRefUids), and renumberAction shifts the entity ids that later actions carry. It never shifts a { cached: { seat, uid } } target an action might carry in its payload. Targets appear to reach the log through decide labels, so this may be latent; nobody has built a case that reaches it.",
    evidence: "Round 2026-10-24, R1024-server.md (new defect 2): the server agent, fixing CT-199.",
    fix: "Check whether any action payload carries a cached target. If one does, shift its uid in renumberAction as renumberRefUids does, with a test that undoes a spawn under a later cached-target action; if none can, say so in renumberAction.",
    proof: null,
    verify: "Read renumberAction in server/rooms.ts for the cached target shape, and grep the action types for a cached uid.",
    status: 'open',
  },
  {
    id: 366, area: "engine", severity: "minor",
    cards: ["Rotling", "Spellbind"],
    title: "paying a {Modular} cost out of the bin fires no leftBin, so the bin-exit listeners never hear it",
    detail: "CR 405.7: every exit from a bin fires leftBin. payModularMod (engine.ts) takes a {Modular} mod out of the bin with a raw zone.splice, so Rotling (\"When I leave your bin, ...\") and the other bin-exit listeners do not hear a bin card used as a Modular cost. CT-344's work kept the foreign-owner table right there and left the event out on purpose, because adding it changes replays.",
    evidence: "Round 2026-10-24, R1024-owner.md (new defect 1): the owner agent, fixing CT-344.",
    fix: "Take the card through takeFromBin (which goes through removeFromBin, so leftBin fires) with reason 'modded', keep the owner it returns, replay the stored games for drift, and guard it with a bin listener that hears the Modular payment.",
    proof: null,
    verify: "Rotling in a bin, pay a {Modular} cost with it: its trigger should be offered.",
    progress: "AUDIT 2026-10-24 (housework; AUDIT-ct-engine.md): REACHABLE TODAY, not latent. payModularMod in engine.ts does zone.splice(index, 1) for modFrom === 'bin' (commented \"⚠ The bin exit fires no 'leftBin'\"). Probe: isGraftable('Rotling') is true and Rotling is the pool's only leftBin listener, and Spellbind ({Modular}, \"apply mods … from your hand and/or bin\") can graft Rotling out of the bin in a real game, where its \"When I leave your bin\" never fires. Size M: fix through takeFromBin with reason 'modded', then replay stored games for drift.",
    status: 'open',
  },
  {
    id: 367, area: "engine", severity: "minor",
    title: "playInlineMode (the virus, ambush and prophecy modes of an inline play) builds its stack items with no owner",
    detail: "CT-344 made the hand and bin exits carry a card's owner. playInlineMode, the mode branch of an inline play, builds its items without StackItem.owner. It is unreachable today: only Tides of the Cosmos uses modes, and it plays from the deck, a shared zone where the taker owns the card. A future caller playing a foreign-owned card from a hand or bin in a mode would drop its owner.",
    evidence: "Round 2026-10-24, R1024-owner.md (new defect 2): the owner agent, fixing CT-344.",
    fix: "Thread the owner the zone returned into each mode's item, as playInline's push branch does, and extend 623's class guards so a new mode cannot skip it.",
    proof: null,
    verify: "Read playInlineMode in client/engine/src/engine.ts for an owner on each item it builds.",
    status: 'open',
  },
  {
    id: 368, area: "client", severity: "minor",
    title: "regions board: with both hands shown, the spectated top-seat hand gets 20 to 30px and its cards are a sliver",
    detail: "The full spectated hand strip (.lspect, about 131px tall) gets about 20 to 30px of the top info block at 1440x900, so its cards are barely visible. It predates CT-336, and that fix does not change it: CT-336 only stopped the deck label drawing over the HAND header.",
    evidence: "Round 2026-10-24, R1024-ui.md (new defect 1): the ui agent in headless Chrome on ?question=transmogrifant-control-change (shot q336-after.png in its scratchpad).",
    fix: "Give the spectated hand its own height in the top info block, or move it out of the block (a strip above the board), and measure at 1440x900, 1280x720 and 1920x1080.",
    proof: null,
    verify: "Open ?question=transmogrifant-control-change at 1440x900 with both hands shown and look at the top hand.",
    status: 'open',
  },
  {
    id: 369, area: "client", severity: "minor",
    title: "the draft or bottom pick dialog's scrim covers the rail: a click on report hides the pick instead of opening the report",
    detail: "With a draft or bottom pick up, a click on the rail's report button lands on the pick dialog's scrim, which hides the pick; the report does not open. Reporting from inside a pick takes two clicks. Measured in headless Chrome while driving CT-291.",
    evidence: "Round 2026-10-24, R1024-ui.md (new defect 2): the ui agent, fixing CT-291.",
    fix: "Let the rail sit above the pick scrim, or pass clicks on the rail through the scrim, keeping the scrim's own click-to-hide everywhere else.",
    proof: null,
    verify: "Open a live draft pick and click the rail's report button once: the report should open.",
    status: 'open',
  },
  {
    id: 370, area: "client", severity: "minor",
    cards: ["Conduit of Pain"],
    title: "the stack caption still states the unboosted amount under Conduit of Pain or against a Vulnerable unit",
    detail: "CT-194 made the does-line double a Powerful item's own damage. Left out: Conduit of Pain's +1 (an amountDelta, not an attribute) is not added; a Vulnerable recipient's receive-side doubling is not shown; and on an \"each unit\" line the doubled number is shown even when one unit on the table is Pure.",
    evidence: "Round 2026-10-24, R1024-ui.md (CT-194 not done, and new defect 3): the ui agent.",
    fix: "Read the amount deltas resolution applies (Conduit of Pain) in doesLine; for a named Vulnerable target say the amount it will receive; for an each-unit line with a Pure unit on the table, say the printed number with a note or give it per unit.",
    proof: null,
    verify: "Cast a Fireball with Conduit of Pain in play, and another at a Vulnerable unit: read the caption against the damage dealt.",
    status: 'open',
  },
  {
    id: 371, area: "client", severity: "minor",
    title: "the why-can't-I-play hint (CT-288) is only on the card zoom: nothing on the classic board, and a click on a dark hand card does nothing",
    detail: "CT-288 hangs the reason a hand card has no offer under the card zoom (handBlockReason). The classic board has no zoom, so it shows nothing there; a mouse click on a dark hand card still does nothing (no toast); and the touch tap path uses the same decorator but was not driven.",
    evidence: "Round 2026-10-24, R1024-ui.md (CT-288 not done): the ui agent.",
    fix: "Show handBlockReason as a toast when a dark hand card is clicked, on either board, and as the classic board's hover line; drive a tap on a tablet viewport.",
    proof: null,
    verify: "On the classic board, hover and click a card you cannot afford.",
    status: 'open',
  },
  {
    id: 372, area: "client", severity: "minor",
    title: "league achievements (League regular, League champion) are not built, and nothing refreshes achievements at season close",
    detail: "docs/20 section 7 (and milestone 5) specs two derived achievements, \"League regular\" and \"League champion\", and a refreshAchievements call at season close. Neither achievement exists in server/achievements.ts and closeSeason calls nothing. The trophy chips were built this round; the first season closes Sun 8 Nov 2026.",
    evidence: "Round 2026-10-24, R1024-league.md (not built, and new defects): the league agent, building the trophy chips.",
    fix: "Derive both achievements from Account.league.seasons in server/achievements.ts and call refreshAchievements for each entrant in closeSeason; guard it with 610's in-process season close.",
    proof: null,
    verify: "Close a one-week season in process and read the champion's and a participant's achievements.",
    status: 'open',
  },
  {
    id: 373, area: "client", severity: "minor",
    title: "a league game can be disputed only while its room is still loaded",
    detail: "BL-48 and CT-339: the dispute button lives in the game room, and the room must still be loaded for it to work (rooms are restored for 7 days). After that a league game cannot be disputed at all, though its match may still be open on the League page. CT-339 fixed the organizer notice and left this half.",
    evidence: "Round 2026-10-24, R1024-league.md (CT-339 not done, and new defects), and the CT-339 ticket text.",
    fix: "Let the League match page (or a route keyed by the game code) file a dispute from the saved game file without loading the room, with the same report row and organizer notice.",
    proof: null,
    verify: "Finish a league game, wait until its room is no longer loaded, and try to dispute it.",
    status: 'open',
  },
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
    id: 376, area: "client", severity: "minor",
    cards: [],
    title: "an agreed fix's \"start of the step before\" option can land just before a forced action, which is re-taken at once",
    detail: "server/rooms.ts rewindPlans offers `{ to: prev, kind: 'prev' }` without the forced-action check the \"before <action>\" cuts get. With seed 48593 the step before begins with an empty forced declareBlocks at index 43; the cut lands just before it, main.ts's drain re-takes it at once, so the option really ends at the start of the CURRENT step.",
    evidence: "CR pass round 2026-10-24 (finding F-U23-10, CR Annex D4.5d).",
    fix: "Give the prev cut the same forced-action skip as the before-cuts (or drop the option when it would collapse onto the current step); guard with the seed-48593 shape.",
    proof: null,
    verify: "Seed 48593: offer the step-before rewind and check where the rewound game stands.",
    status: 'open',
  },
  {
    id: 377, area: "client", severity: "minor",
    cards: [],
    title: "the hidden-step comment and PUBLIC_IN_HIDDEN disagree about what the other seat sees",
    detail: "Finding F-U23-9 (CR pass 2026-10-24): the comment beside PUBLIC_IN_HIDDEN (server/rewind-cuts.ts) and the set itself name different things as public inside a hidden step. One of them is wrong; decide which from CR Annex D and make them agree.",
    evidence: "CR pass round 2026-10-24 (finding F-U23-9).",
    fix: "Read both, decide from the CR which is meant, fix the other, and pin the set in a test.",
    proof: null,
    verify: "Compare the comment with PUBLIC_IN_HIDDEN's members.",
    status: 'open',
  },
  {
    id: 378, area: "engine", severity: "minor",
    title: "a column that gains {Sluggish} during the damage step strikes in the Sluggish sub-step with no priority window before it; the designer puts one there",
    detail: "CR 608.3d (combat.damage.split.schedule-fixed, owner 2026-09-16) fixes which damage sub-steps are separate steps once, when the combat damage step opens, so a column that gains Sluggish mid-step strikes in the Sluggish sub-step but no window opens before that strike (owner-questions.md Q3, reading B, D-U12-11). The designer answered A. Caleb, rules-questions 2025-04-20, his step diagram [1363278470938890250]: \"Need sluggish to exist after here---> Combat / Before Sluggish priority window / Sluggish damage\"; his final scheme [1363287109401710603]: \"Before sluggish priority <- remaining columns will deal sluggish damange here\"; and on adding Sluggish [1363288029799911664]: \"you would have to add sluggish during the \"after swift\" window\". Every Sluggish strike in his scheme is preceded by the before-Sluggish window, so triggers from normal damage resolve there, before the gained Sluggish strike.",
    evidence: "CR audit 2026-10-24 (/home/bena/.claude/projects/-home-bena-Documents-Algomancy/zero-handoff/AUDIT-cr.md §1, Q3). engine.ts, combat damage opens: \"// CR 608.3d: fixed ONCE, here, before a single point of damage is dealt —\" then \"b.damageSubs = this.subStepsWithStrikes(b);\".",
    fix: "When a column gains Sluggish in the window after the Swift sub-step (or later), add the Sluggish sub-step to damageSubs so its before-Sluggish window opens. Keep the fixed-once rule for the other direction (a Swift unit dying never unsplits the step, 297). CR 608.3d, 608.3b and 608.3c already state the designer's reading (2026-10-24, engineDiffers F-U12-5): drop their engineDiffers when this lands. Flip 423 \"cr:combat.damage.split.empty-substep — a column that gains Sluggish after the last scheduled sub-step strikes with no window before it\", which pins today's behaviour, and replay stored games for drift.",
    proof: null,
    verify: "A normal-damage column with a death trigger, given Sluggish by an effect in the window after Swift damage: watch whether a priority window opens before its Sluggish strike (today it does not).",
    progress: "2026-10-24: CR 608.3d, 608.3b and 608.3c were redrafted to the designer's reading and re-verified (round 4): 608.3b and 608.3c confirmed, 608.3d PARTIAL. The verifier read Caleb's diagram (\"Need sluggish to exist after here---> Combat\") as checking Sluggish at that point in both directions: a Sluggish sub-step whose only Sluggish unit died or lost Sluggish by the end of the after-Swift window has no window either. So the fix here should schedule the Sluggish sub-step from the columns that have Sluggish when the after-Swift window ends (added or dropped), and 608.3d/608.3c need one more redraft and verify to say so (D-U12-11).",
    status: 'open',
  },
  {
    id: 379, area: "attribute", severity: "minor",
    cards: ["Aberrant Statweaver", "Reality Bender"],
    title: "{Inverted} inverts from a rewritten base, but the designer inverts from the printed stats: base stat changes are stat changes",
    detail: "CR 802.8c (attr.inverted.base, owner 2026-08-23): \"Setting a unit's base stats is not a stat change that Inverted inverts: the new base stats are what Inverted inverts from.\" That is owner-questions.md Q5, reading A (D-U19-3). The designer answered B. Caleb, rules-questions 2023-10-26, to \"I assume inverted does NOT interact with stat \"setting\" like Reshape\": \"It does because it applies in a later layer\" [1167220853726007336] and \"Basically you just look at the stats printed on the card, then look at its current stats. Take the difference\" [1167221076447744110]; to \"I guess ANY changes are changes from printed. including BASE ones.\": \"yeah and it lets me be more cavalier with base stat changes\" [1167224155289174056]; and 2025-11-26, on Bubb and Statweaver: \"base stat changes are still stat changes\" [1443370771647828032]. So a printed 7/5 made base 3/3 by Aberrant Statweaver, then Inverted, is 11/7 (the -4/-2 change flipped), not 3/3.",
    evidence: "CR audit 2026-10-24 (/home/bena/.claude/projects/-home-bena-Documents-Algomancy/zero-handoff/AUDIT-cr.md §1, Q5). engine.ts layer 5: \"p = 2 * base[0]! - p;\". 79-round17-layers.test.ts \"CR 802.8c layer 5: a base REWRITE is the thing inverted FROM, never inverted itself\" pins reading A and names the one-line change; its comment \"Caleb never addressed base rewrites\" is wrong.",
    fix: "In effStats compare against the printed stats (layer 1) instead of `base`, as 79's comment says; flip 79's A-pinned assertions (and 43-dark-c's base-rewrite case); CR 802.8c, 802.8a and 802.8d already state reading B (2026-10-24, engineDiffers F-U19-6): drop their engineDiffers when this lands; reword the player-facing Inverted row in client/ui/glossary.ts (\"Base stats and base rewrites are what it inverts FROM\") and 79's comment; replay stored games for drift.",
    proof: () => still('engine/src/engine.ts', 'p = 2 * base[0]! - p;'),
    verify: "grep \"p = 2 * base[0]! - p;\" in client/engine/src/engine.ts; or spawn a 7/5 token beside Aberrant Statweaver, give it Inverted, read its stats (3/3 today, 11/7 under the designer).",
    status: 'open',
  },
  {
    id: 380, area: "engine", severity: "minor",
    title: "a bin target whose copy has left the bin falls back to another copy of the same name; CR 405.6b says the effect finds nothing",
    detail: "CR 405.6b (zones.bin.identity.that-card): \"An effect that refers back to a card that just entered a bin (\"that card\", \"it\") means that copy. If that copy has left the bin, the effect finds nothing. It never takes a different copy of the same name.\" engine.ts binIndexOf, documented as \"the nth surviving copy of that card, or the last one left if the pile has shrunk past it\", returns `hits[Math.min(ref.nth ?? 0, hits.length - 1)]`, so when the referenced copy has gone and an earlier copy of the same name is still there, target legality (`binIndexOf(t.bin) !== -1`) and resolution (the binCard it builds) both take that other copy. No finding or CT carries it, and the rule has no engineDiffers.",
    evidence: "CR audit 2026-10-24 (/home/bena/.claude/projects/-home-bena-Documents-Algomancy/zero-handoff/AUDIT-cr.md §6, the first of the five open conflicts; first noted in the 2026-10-11 cr-only round's tickets.md, never ledgered). engine.ts: \"return hits[Math.min(ref.nth ?? 0, hits.length - 1)]!;\".",
    fix: "Make binIndexOf return -1 when the nth copy is gone (a BinRef names one copy), check every caller (target legality, resolution, the menus) still does the right thing, add a test with two copies of one name where the targeted one leaves before resolution, and file the finding (engineDiffers on 405.6b) or skip it if the fix lands first. Replay stored games for drift.",
    proof: () => still('engine/src/engine.ts', 'return hits[Math.min(ref.nth ?? 0, hits.length - 1)]!;'),
    verify: "grep \"hits.length - 1)]!\" in client/engine/src/engine.ts (binIndexOf).",
    status: 'open',
  },
  {
    id: 381, area: "client", severity: "minor",
    title: "on a touch screen a tap on a playable bin card still plays it; report #201's fix made only hand and cache taps read",
    detail: "Report #201 (2026-10-08) asked that a finger's tap on a card READS it (the peek) rather than playing it, because a touch screen has no hover. The fix, tapOnlyReads in ui/main.ts, guards the hand path and both cache paths (the board's 'cache' kind and the region panel's cacheplay thumb), but the bin has neither guard: the board's 'bin' kind and the region panel's binplay thumb both go straight to handleBinClick, so a tap on a bin card that is playable now (CR 405.9), prophesiable or applicable as a mod plays it. The round's own note said so: \"LEFT: bin-dialog plays still fire on tap\". Never ledgered.",
    evidence: "Backlog audit 2026-10-24 (/home/bena/.claude/projects/-home-bena-Documents-Algomancy/zero-handoff/AUDIT-backlog.md, loose end L18). ui/main.ts: \"if (kind === 'bin') { handleBinClick(Number(t.dataset['p']) as Seat, Number(t.dataset['i']), e); }\" and \"binplay: (btn, e) => { handleBinClick(\", with no tapOnlyReads; the hand and cache branches beside them have one.",
    fix: "Route both bin entry points through tapOnlyReads with a bin pick key (the same shape as cachePickKey: a bin card that answers the open question is still picked), and add a bin case to ui/test/384-touch-tap-reads (a tap reads, a mouse click plays).",
    proof: () => still('ui/main.ts', "if (kind === 'bin') { handleBinClick(Number(t.dataset['p']) as Seat, Number(t.dataset['i']), e); }"),
    verify: "On a touch device (or the 384 rig), tap a playable card in your bin: it plays instead of opening the peek.",
    status: 'open',
  },
  {
    id: 382, area: "engine", severity: "minor",
    title: "PROBE: a nested suspension (a trigger asking a question inside settle() during a chain head's commit) may still drop the chain tail",
    detail: "The 2026-08 five-subsystem audit fixed the 'resolve'-suspension loss of a chain's moreItems (the chain is now carried through ChainRest) and left one case open in its notes: \"a NESTED suspension (trigger inside settle() during a chain head's commit) still drops the chain tail — needs an E-level pending chain\". It was never ledgered, no report has named it since, and the engine has changed a lot around it (ChainRest on 'resolve' suspensions; resolveItem(item, chain)). So it is unverified, not known: it may already be fixed.",
    evidence: "Backlog audit 2026-10-24 (/home/bena/.claude/projects/-home-bena-Documents-Algomancy/zero-handoff/AUDIT-backlog.md, loose end L16), from the memory note digital-client-audit-2026-08.md.",
    fix: "Write a probe: cast a chain (an item whose resolution pushes more items), with a trigger that asks a question (a decision) during the chain head's commit, answer it, and check every item of the tail still resolves. If the tail is dropped, this becomes the real ticket (carry the pending chain on E across the nested suspension); if not, close with the probe promoted as the guard.",
    proof: null,
    verify: "The probe described in fix: count the chain's resolved items after a nested question is answered.",
    status: 'open',
  },
  {
    id: 383, area: "client", severity: "minor",
    title: "PROBE: the counterattackers-in-transit strip is a fixed 96px column and may clip once ten or more units are sent",
    detail: "The strip that shows counterattackers heading into a region (.sentstrip) is fixed at 96px wide with 40px cards, inert and dimmed. A report round on 2026-10-06 noted it may clip past about ten sent units; it was never measured or ledgered.",
    evidence: "Backlog audit 2026-10-24 (/home/bena/.claude/projects/-home-bena-Documents-Algomancy/zero-handoff/AUDIT-backlog.md, loose end L20). ui/style.css: \".sentstrip { width: 96px; flex-shrink: 0;\".",
    fix: "Load a review board with 11 or more sent counterattackers on both boards (classic and regions) at 1280x720 and 1440x900. If the strip clips or overflows, let it wrap or scale (as the fit pass does for other zones) and add the board to the review set; if it does not, close with the measurement.",
    proof: null,
    verify: "A battle with 11+ units sent to counterattack: look at the in-transit strip in the defender's region.",
    status: 'open',
  },
  {
    id: 384, area: "client", severity: "minor",
    title: "PROBE: in the recap playback the second of two quick plays waits for the 1-per-second tempo and drops in instead of flying from the hand",
    detail: "The recap playback (2026-10-03) replays the opponent's actions one by one with each card flying from its zone. The round's note lists one known defect it left unfixed: \"the 2nd of two quick plays waits for the 1/sec tempo and drops in rather than flying from the hand\". Never ledgered, and not re-checked since the later motion and stack work.",
    evidence: "Backlog audit 2026-10-24 (/home/bena/.claude/projects/-home-bena-Documents-Algomancy/zero-handoff/AUDIT-backlog.md, loose end L21), from the memory note recap-playback-plan.md.",
    fix: "Reproduce in the playback review boards (batch I): two plays from hand inside one second. If the second still drops in, give it its own flight from the hand (queue the flight, not only the repaint); then add the case to the playback tests. If it already flies, close with the board.",
    proof: null,
    verify: "Recap of two cards played from hand within a second: watch whether the second one flies from the hand.",
    status: 'open',
  },
  {
    id: 385, area: "engine", severity: "minor",
    title: "running out of cards loses no game here; the designer (and now the owner) say in constructed you lose and in live draft the game ends",
    detail: "CR 104.5 (concepts.ending.no-deck-out, owner 2026-09-16 \"No deck-out loss\"): \"Running out of cards does not end the game. A player who has to draw from an empty deck draws as many as there are and does not lose.\" The engine does that (300-recycle-mark \"CR 401.4 an empty deck AND an empty pile draws fewer — no loop, no crash, no loss\"). The designer says otherwise. Caleb, rules-questions 2025-04-01 [1356616873655140546]: \"In constructed you lose if you draw on an empty deck\"; 2025-08-04 [1402038431659593859]: \"in constructed you lose\"; and the same day [1402046319643856916]: \"in live draft the game just ends if you run out of cards (don't make sense to make a player lose since its a shared deck)\". Under the authority order the designer outranks the owner's call, so either the rule and the engine change, or the owner keeps no-loss knowingly as a digital convention (Annex D). Here a deck refills from the recycle pile first, so only an empty deck AND an empty pile is affected.",
    evidence: "CR audit 2026-10-24 (/home/bena/.claude/projects/-home-bena-Documents-Algomancy/zero-handoff/AUDIT-cr.md §3 (c), D-U01-8). Put to the owner 2026-10-24: \"Follow Caleb\".",
    fix: "Owner 2026-10-24, asked \"Follow Caleb?\" on deck-out: \"Follow Caleb\". Constructed: a player who has to draw from an empty deck loses (check whether the recycle pile refills the deck first, as today, and what empty means then: search Caleb's thread). Live draft: the game ends; how the result is scored then (draw? no result?) is not in the quoted words: search the thread first, then ask the owner. Redraft CR 104.5 with the designer + owner sources (replacing the 2026-09-16 adoption), update 300-recycle-mark's empty-deck test, and measure what this does to saved games (restore replay).",
    proof: null,
    verify: "Read CR 104.5 and 300-recycle-mark's empty-deck test against the three messages quoted in detail.",
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
    id: 390, area: "card", severity: 'minor',
    cards: ["Tides of the Cosmos"],
    title: "Tides of the Cosmos: the edited RAQ write-up says Rook lets it apply augments; the engine offers only Viruses, and the claim is in neither raq.ts nor the CR",
    detail: "_passer edited the Tides of the Cosmos RAQ write-up (1396955380000755795) on 2026-08-14 to add \"Having Rook would allow you to use Augments, but still doesn't allow for Grafts.\" That claim is not in client/ledgers/raq.ts, not in the CR, and not checked against the engine: Tides' inline modes offer a mod only as a Virus (batch-water-a.ts). It also conflicts on its face with CR 723.5b, under which Rook reaches the hand and the bin, while Tides plays from the deck. The RAQ write-up is the authority.",
    evidence: "tickets.md [WS2] in var/records/cr-only-round-2026-10-11/ (gitignored, main checkout), re-checked 2026-10-24 in the housework pass.",
    fix: "Add the claim to raq.ts (thread 1396955380000755795), decide 723.5b against the write-up, then let Tides' inline modes offer an augment under a live Rook, with a guard. Replay stored games for drift.",
    proof: () => still("engine/src/cards/sets/batch-water-a.ts", "if (c.virus && virusHosts(g, region).length) out.push('virus');"),
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
  {
    id: 407, area: "engine", severity: "minor",
    cards: [],
    title: "in battle a Virus cannot be augmented onto a spell token standing in play; the owner allows it",
    detail: "Owner question D-U06-9 (CR 305.6, also D-U17-4 / 721.4a). The engine lets a Virus mod units in battle and spells on the stack, not a spell token standing in play. Caleb: \"Honestly I don't see why you couldn't\" (augmenting a spell token in play, RQ 1364998183226179735, 2025-04-24) and \"It's very similar to how regular viruses work. So you can hit enemy spells\" (RQ 1347270455198879858, 2025-03-06). Owner 2026-10-24, asked \"During a battle, can a Virus be augmented onto a spell token that is sitting in play?\": \"Yes, allow it\".",
    evidence: "CR audit 2026-10-24 (zero-handoff/AUDIT-cr.md, Q1); owner answer in chat 2026-10-24.",
    fix: "Add the second battle path: a Virus from hand may target a spell token in play, with the attribute-only limit Caleb states. Record the owner adoption on the D-U06-9 records (305.6, 721.4a) through the cr scripts. Guard: a Virus gives a Fireball token in play Powerful mid-battle.",
    proof: null,
    verify: "In battle, try to augment a Virus onto a spell token standing in play.",
    status: 'open',
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const CARD_TODO: TodoEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
