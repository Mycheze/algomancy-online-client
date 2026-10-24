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
      + 'empties the bin and suppresses the ransom. The batch-E scenario round (2026-08-26/27) fixed the menu (DecisionOption.count) '
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
      + 'The batch-E scenario round fixed the client defect that caused the misplay; it did not, and could not, '
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
  // ── the comprehensive-rules export's findings, re-checked at HEAD and filed
  //    2026-10-10 (CT-226..CT-280 are reserved for that project). Each names its
  //    finding ids in data/comprehensive-rules/findings/, which carry the CT back.
  {
    id: 230, area: "coverage", severity: "minor",
    title: "two combat test titles assert the superseded \"no priority between damage sub-steps\" law",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rules combat.damage.split.boundary-window and combat.damage.split.state-between. CR 608.3b: a split damage step opens a priority window between the Swift and normal sub-steps, and the trigger queue resolves there. 02-combat still says \"no priority between sub-steps\"; its own board stops at that window, so it proves only the Swift strike. 239 \"R3 STILL STANDS\" takes its \"dealt NOTHING in the normal sub-step\" assertion while paused at the window, before the normal sub-step runs, so it does not assert its title.",
    evidence: "Findings F-U12-2 (dup F-U12-3). 02-combat.test.ts: \"R3/Swift: swift column deals damage first, no priority between sub-steps\". 239-damage-triggers-after-combat.test.ts: \"R3 STILL STANDS: a unit killed in the Swift sub-step deals no normal damage, and only the trigger queue waits\".",
    fix: "Retitle 02-combat to the Swift strike it proves. Rewrite 239 to pass the window, run the normal sub-step and then assert the dead Swift-step unit dealt nothing; retitle it to the amended law.",
    proof: () => still('engine/test/02-combat.test.ts', 'no priority between sub-steps') || still('engine/test/239-damage-triggers-after-combat.test.ts', 'CR 608.3e STILL STANDS'),
    status: 'open',
  },
  {
    id: 231, area: "client", severity: "minor",
    title: "three player-facing glossary rows state superseded law: Electric (excess lost), Glimpse (still moddable), Graft (cache)",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) ui/glossary.ts is our text and players read it. (1) The Electric row says \"When the chain runs out the excess is lost\"; CR 802.17d and 802.17e make each hop optional and a dead-end remainder dealt to the last unit, never lost, and CR 802.16q makes the Piercing dead end elective (CR rules attr.electric.*). (2) The Glimpse row ends \"still moddable out of the zone at full price\"; CR 801.9i refuses every verb on an expired glimpse, and the Cache row in the same file already says so (CR rule zones.cache.lapse). (3) The Graft row allows a cached card only \"if a fulfilled prophecy paid for it\", omitting the live glimpse that CR 801.9g and CR 403.3b allow (CR rule effects.mods.zones.cache). Test 177 cannot see any of them: the rows cite rulings that are still live.",
    evidence: "Findings F-REG-2, F-U07-5 (dup F-U18-2), F-U17-2. glossary.ts: \"When the chain runs out the excess is lost\"; \"still moddable out of the zone at full price\"; \"or from cache, if a fulfilled prophecy paid for it\". digital-rules.md: \"no {Piercing} is read: it stays on the last unit — dealt, never lost\". 315-cache-mod-permission.test.ts: \"R303: an expired glimpse is not a graft, not an augment, not anything\".",
    fix: "Rewrite the three rows from the live rulings and cite them (Electric: CR 802.17d, 802.17e, 802.16q; Glimpse and Graft: CR 801.9g, 720.5a). Consider teaching 177 to compare a row's text against the rulings that supersede the ones it cites.",
    proof: () => still('ui/glossary.ts', 'When the chain runs out the excess is lost', 'still moddable out of the zone at full price', 'or from cache, if a fulfilled prophecy paid for it'),
    status: 'open',
  },
  {
    id: 235, area: "coverage", severity: "minor",
    title: "test titles and messages in ten places, and one register row, still state law that a later ruling or the card changed",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) Each title below names behaviour the rulings have since changed; most assertions already follow the new law, so only the words mislead (Biomass Devourer's cannot tell the two bins apart at all). (1) 133: \"R157 §20 — …\" titles; §20 no longer holds (CR 107.5). (2) 45-hybrids-ld-b: Deferral Drone \"this turn\"; the card and the engine say this phase, and the retired register's table listed the clear in E.startTurn. (3) 26-metal-a: a stolen unit dies to its OWNER's bin; CR 405.3 sends it to the controller's. (4) 36-cache-prophecy: a cached token \"is erased, not cached\"; CR 410.5c has it visit the cache. (5) 178: \"Q3 is OPEN\" and \"the pile is untouched\"; CR 407.2 files the pile. (6) 36: prophesying is illegal in the haste step, unqualified; CR 504.9 allows a [Haste] banner. (7) util.ts and three tests: the haste step opens only for a payable haste card; CR 504.5 opens it every turn. (8) 35-rot: \"deployment opens no priority window\"; deployment now has a stack (CR 507.5). (9) 44: old suppression \"is a veto ABOVE copy\"; CR 712.2 says otherwise: a strip takes only what the unit has when it applies. (10) 42-dark-b: Afflicting rots \"the owner\"; Umbral Decay prints the controller.",
    evidence: "Findings F-U02-1, F-U04-1, F-U07-1, F-U07-2, F-U07-4 (dup F-U16-1), F-U08-2, F-U08-3, F-U09-1, F-U16-2, F-U20-2. Quotes: \"R157 §20 — with no Stasis Sentry an X spell costs exactly X\"; \"the next card you play this turn costs [3] less\"; \"| **clear** | `E.startTurn`, beside the `Entity.budgets` wipe |\"; \"R140: a stolen unit dies — the erase reaches the OWNER\"; \"R46: a TOKEN cached from play is erased, not cached (there is no card)\"; \"Q3 is OPEN\"; \"the host lives, and the pile is untouched\"; \"R42: prophesying is a DEPLOYMENT action — illegal in planning, the haste step and battle\"; \"appears when someone holds a payable haste card) */\"; \"R38: rot damage cannot be responded to — deployment opens no priority window\"; \"R118: R62 suppression is a veto ABOVE copy\"; \"{Afflicting} rots the owner of what it kills\".",
    fix: "Retitle each test to the live ruling and reword the messages. Where the assertion cannot tell old law from new (26-metal-a; 42-dark-b, where owner and controller coincide), add the case that can.",
    proof: () => still('engine/test/133-x-cost-semantics.test.ts', 'CR 107.2 —') || still('engine/test/45-hybrids-ld-b.test.ts', 'the next card you play this turn costs [3] less') || still('engine/test/26-metal-a.test.ts', 'the erase reaches the OWNER') || still('engine/test/36-cache-prophecy.test.ts', 'is erased, not cached (there is no card)', 'illegal in planning, the haste step and battle') || still('engine/test/178-played-item-and-erased-mods.test.ts', 'Q3 is OPEN', 'the pile is untouched') || still('engine/test/35-rot-debt-trash.test.ts', 'deployment opens no priority window') || still('engine/test/44-hybrids-ld-a.test.ts', 'suppression is a veto ABOVE copy') || still('engine/test/42-dark-b.test.ts', 'rots the owner of what it kills'),
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
    status: 'open',
  },
  {
    id: 238, area: "coverage", severity: "minor",
    title: "two test titles still call a settled ruling an open question (the Wraith self-pick, Abyssal Evocation's timing)",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) (1) 37-attrs-wight is titled \"(unconfirmed reading)\" with a warning mark, but CR 110.4a settles that \"an ally\" may be the unit itself (CR rule concepts.targets.ally.self). (2) 12-fire-a is titled \"⚠ OPEN — a bin-played card obeys its PRINTED timing\" and says the assertion flips if the owner rules otherwise; the owner ruled it on 2026-08-25 (\"Already correct — Abyssal Evocation, Writhing Host.\"), and CR 702.2a states it. The behaviour is right in both; only the words are stale.",
    evidence: "Findings F-U03-1, F-U07-3 (dups F-U14-4, F-U21-1). 37-attrs-wight.test.ts: \"R71 ⚠: a lone Wraith may pick ITSELF as \"an ally\" (unconfirmed reading)\". 12-fire-a.test.ts: \"Abyssal Evocation: ⚠ OPEN — a bin-played card obeys its PRINTED timing\". digital-rules.md: \"Already correct — Abyssal Evocation, Writhing Host.\"",
    fix: "Retitle both to cite the ruling that settled them, and drop the \"flips if\" comment in 12-fire-a.",
    proof: () => still('engine/test/37-attrs-wight.test.ts', '(unconfirmed reading)') || still('engine/test/12-fire-a.test.ts', '⚠ OPEN — a bin-played card obeys its PRINTED timing'),
    status: 'open',
  },
  {
    id: 240, area: "coverage", severity: "minor",
    title: "three guard tests wrap every assertion in an if that never fires, so they assert nothing",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) (1) 49-playtest-round6 \"R58: Enigmatic Warder cannot redirect an ENEMY into an ally slot\" looks for Fight on the stack after Fight has resolved, so its if (after) branch never runs (CR rule concepts.targets.ally.effect-controller). (2) 393-raq-mods, the Borrower/Reconfigure guard: no real [Augment] unit is a first target, so Reconfigure is never castable and the if (legalActions …) branch is skipped (CR rule card.augment-box.copy). (3) 393-raq-mods, the Borrower copying a Robot token: Download is never offered (plays.length = 0), so the \"Download cannot take\" half is vacuous (CR rule types.tokens.copying-a-token). Each was measured by a verifier.",
    evidence: "Findings F-U03-3, F-U05-2, F-U06-2. 49-playtest-round6.test.ts: \"if (after) {\". 393-raq-mods.test.ts: \"if (legalActions(h.state, A).some(a => a.type === 'playCard' && a.handIndex === rc)) {\" and \"if (plays.length) {\". The never-taken branches were measured by verifier probes (not committed).",
    fix: "Make each play required: build the board so the guarded action is offered, assert that it is, then assert the outcome with no if. Re-break each to see it go red.",
    proof: () => still('engine/test/49-playtest-round6.test.ts', 'if (after) {') || still('engine/test/393-raq-mods.test.ts', "a.type === 'playCard' && a.handIndex === rc)) {", 'if (plays.length) {'),
    status: 'open',
  },
  {
    id: 241, area: "coverage", severity: "minor",
    title: "ten tests (and one RAQ guard) claim more in their titles than their bodies assert",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) Each passes whatever the engine does on the claim in its title. (1) The RAQ guard for \"retargeting can rescue an effect from fizzling\" retargets a still-legal target. (2) 300: the per-seat constructed recycle pile, in a test that asserts the game is NOT constructed. (3) 05-rulings \"R11: regroup runs its exact sequence\" checks only the end state. (4) 18-earth-c: \"an adjacent enemy does not unlock it\" uses a facing blocker, which is not adjacent at all. (5) 21-fixes: \"round 2 … still restricts to the sent counterattackers\" never reaches a round 2. (6) 04-mods: \"mods move with a stolen unit\" assigns u.controller by hand and never reads the mod. (7) 290 §2: \"a Pure recipient's own Vulnerable\" makes the SOURCE Pure. (8) 12-fire-a: \"until regroup ends it\" never reaches regroup. (9) 403: \"dies to the bin\" never kills it; 36: \"both battles tick\" counts one.",
    evidence: "Findings F-U03-4, F-U07-8, F-U09-2, F-U10-2, F-U13-2, F-U17-3, F-U19-4, F-U21-2. raq.ts: \"guards: [\"12-fire-a.test.ts::Gravitational Correction: retargets the effect unless its controller pays [x]\"] },\". 300: \"assert.notEqual(h.state.mode, 'constructed', 'this harness is a shared-deck game');\". 05-rulings: \"R11: regroup runs its exact sequence\". 18-earth-c: \"// an adjacent ENEMY\". 21-fixes: \"round 2 after a real round-1 battle still restricts to the sent counterattackers\". 04-mods: \"u.controller = o;\". 290: \"the cheapest way to make the VICTIM side of the pairing Pure is to make the\".",
    fix: "For each, add the assertion the title promises (a fizzle avoided; a constructed game; an observation of order; an enemy inside the formation; a refused round-2 attacker; giveControl and the mod's controller; a Pure recipient; regroup reached; the death; both battles) or narrow the title to what is asserted.",
    proof: () => still('ledgers/raq.ts', '12-fire-a.test.ts::Gravitational Correction: retargets the effect unless its controller pays [x]') || still('engine/test/300-recycle-mark.test.ts', "this harness is a shared-deck game") || still('engine/test/05-rulings.test.ts', 'CR 506.2: regroup runs its exact sequence') || still('engine/test/18-earth-c.test.ts', '// an adjacent ENEMY') || still('engine/test/21-fixes.test.ts', 'still restricts to the sent counterattackers') || still('engine/test/04-mods.test.ts', 'u.controller = o;') || still('engine/test/290-pure-outside-combat.test.ts', 'the cheapest way to make the VICTIM side of the pairing Pure is to make the'),
    status: 'open',
  },
  {
    id: 262, area: "client", severity: "minor",
    title: "the automatic pass is latched per state counter, which the ruling on automatic answers rules out",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule annexd.auto-pass.automatic-answers. CR D2.4: an automatic answer (it names the haste-step ready and the automatic pass) is latched by being unanswered, never by a state counter, because states keep arriving while an intent is outstanding. The haste ready was converted (hasteAutoOut); the automatic pass still goes through takeAutoPass, keyed on actionCount, and 70 [59] asserts that a new state number re-opens the latch. A state with a new actionCount arriving while the pass is outstanding could send a second pass, which comes back refused.",
    evidence: "Findings F-U23-2 (dup F-U23-5). inspect.ts: \"if (latch.autoAt === actionCount || latch.sentFor === actionCount) return false;\". 70-playtest-round15.test.ts: \"assert.equal(takeAutoPass(plan, 41, latch), true, 'a new state is a new window');\". digital-rules.md: \"### (b) An automatic answer is latched by the FACT of being unanswered, never\".",
    fix: "Latch the automatic pass on \"sent and not yet answered\" (as hasteAutoOut does), clearing it on the server's answer, and update 70 [59].",
    proof: () => still('ui/inspect.ts', 'if (latch.autoAt === actionCount || latch.sentFor === actionCount) return false;'),
    status: 'open',
  },
  {
    id: 292, area: "coverage", severity: "minor",
    title: "the Automaton copy sweep (458) costs about two minutes of every gate",
    detail: "458's whole-pool sweep drills every card that creates a Unit Token with an Automaton on the board: ~50s alone, ~134s inside the full suite. It also reaches only 9 of the 15 non-1/1 creators (the X/X ones create nothing in the drill).",
    evidence: "Measured by the agent fixing report #212 (report round 2026-10-16): the file timed alone and inside the full engine suite.",
    fix: "Drive the 15 creators directly (their spawn sites) instead of drilling the whole pool, and reach the X/X ones with a nonzero X.",
    proof: null,
    verify: "Time `node --test test/458-automaton-copies-stats.test.ts`.",
    status: 'open',
  },
  {
    id: 293, area: "coverage", severity: "minor",
    title: "ledgers/claims.ts EVIDENCE has no entry for the new countersRemoved event",
    detail: "CT-286 added the countersRemoved event type; claims.ts's EVIDENCE table names event types and has none for it. Nothing failed.",
    evidence: "Found by the agent fixing report #210 (report round 2026-10-16), grepping claims.ts for the new event type.",
    fix: "Add the row, or derive the table from types.ts so a new event cannot be missed.",
    proof: null,
    verify: "grep countersRemoved client/ledgers/claims.ts",
    status: 'open',
  },
  {
    id: 294, area: "card", severity: "minor",
    cards: ["Automaton of Abundance"],
    title: "Automaton of Abundance on a batch mixed from two sources (Caleb hedged)",
    detail: "Caleb, 2024-07-24 (hedged, 'may change'): Accelerated Germination and Fungal Gardener 1/1s made in one batch should give \"two extra tokens\". The engine and CR 304.14 give one (one unique token). Not a ruling while hedged.",
    evidence: "Report #212 diagnosis.",
    fix: "Leave the engine; re-check if Caleb settles it.",
    proof: null,
    verify: "Accelerated Germination plus Fungal Gardener with an Automaton in play.",
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
    id: 333, area: "coverage", severity: "minor",
    title: "the sacrificeUnits from:'self' cast-cost path is now used by no card, only a synthetic test card",
    detail: "CT-264 moved Eldritch Dreamtender, Cthyrian Rector and Void Mandible off castCost { kind: 'sacrificeUnits', from: 'self' } to a sacrifice made at resolution. dsl.ts now says \"No card in the pool declares it today\"; engine.ts still carries the branch (selfSacrificeable) and only 32-cast-costs exercises it, through a synthetic card.",
    evidence: "The mandible agent, report round 2026-10-21.",
    fix: "Keep it if a printed [Sacrifice me] card is expected (it is the printed-cost shape), else remove the branch and the synthetic test together.",
    proof: () => still('engine/test/32-cast-costs.test.ts', "castCost: { kind: 'sacrificeUnits', from: 'self', n: 1 }"),
    verify: "grep \"from: 'self', n: 1\" in client/engine/test/32-cast-costs.test.ts",
    status: 'open',
  },
  {
    id: 337, area: "coverage", severity: "minor",
    cards: ["Towering Colossus"],
    title: "server/scenarios.ts: the lithoghul-donated comment says Towering Colossus's [Augment] text does nothing as a body",
    detail: "The comment on the opponent's Towering Colossus reads \"Its own printed text is an [Augment] box, which does nothing while it is a body in play\". Under CR 721.1 an [Augment] box radiates from a unit in play too: Colossus (\"[Augment] Enemies gain +2/+2.\") gives your units +2/+2 there. scenarios-d.ts says exactly that about the same card.",
    evidence: "The board agent, report round 2026-10-21, reading the scenario library.",
    fix: "Correct the comment, and check the expected text still holds with your The Foretold at +2/+2.",
    proof: () => still('server/scenarios.ts', 'Its own printed text is an [Augment] box, which does nothing'),
    verify: "Read the comment in server/scenarios.ts against batch-earth-c.ts.",
    status: 'open',
  },
  {
    id: 340, area: "coverage", severity: "minor",
    title: "CR Annex D4.5 (agreed fixes) describes the proposal and rewind as they were before this round",
    detail: "The dispute (c43e21b) and rewind-naming (28e4271) commits moved the code under D4.5 agreed-fix.proposal and .rewind: fixes in a run now file ONE report row, and the rewind offers \"before your last action\" named in each seat's words. The cr agent finalized both records as partial rather than stamp stale text; hidden-step.floor was confirmed.",
    evidence: "The cr agent, report round 2026-10-21 (c7c80ee).",
    fix: "Redraft both records against rooms.ts rewindOptions / main.ts fix runs, re-verify with an isolated verifier, cr:render.",
    proof: null,
    verify: "cr:check shows both records confirmed; 409 green.",
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
  {
    id: 347, area: "coverage", severity: "minor",
    cards: ["Wake the Dead", "The Bonesculptor", "Gridxlan"],
    title: "docs/16 and docs/12 still describe the old Wake the Dead and Bonesculptor behaviour",
    detail: "CT-245 and CT-255 (2026-10-22) made Wake the Dead's units real plays on the stack and turned The Bonesculptor's and Gridxlan's bin plays into standing permissions. docs/16-divergence-inventory.md line 415 still lists PLAY-VS-PUT-INTO-PLAY (\"Both print play and call spawnUnit, so no stack item\"), and docs/12-card-text.md line 106 still says the two cards that spell the budget in prose \"fall back to [Once]\".",
    evidence: "The plays agent, engine ticket round 2026-10-22 (the orchestrator's round record).",
    fix: "Mark the docs/16 row fixed (CT-245, CT-255) and correct the docs/12 sentence. docs/ is a test fixture directory: run the suites that read it after the edit, and do not rename or move anything.",
    proof: null,
    verify: "Read client/docs/16-divergence-inventory.md line 415 and client/docs/12-card-text.md line 106.",
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
    status: "open",
  },
  {
    id: 355, area: "card", severity: "minor",
    cards: ["Ancient One"],
    title: "Ancient One: an ally reachable both directly and through a second Ancient One lends its text once (the designer's \"boolean\")",
    detail: "Report 271 made two adjacent Ancient Ones share everything through each other (the designer: \"both have all the abilities of any creature adjacent to either\"), as a closure that counts each ally once: an ally adjacent to an Ancient One AND reachable through a second one lends one copy, which follows the designer calling it \"boolean\". The owner's ruling of 2026-10-22 (CT-342, \"each neighbour's copy of the ability is separate\") is about two DIFFERENT neighbours, so the two read as compatible, but nobody has asked the owner about the overlap. A note, not a known defect.",
    evidence: "The ancient agent, report round 2026-10-23 (R1023-ancient, new defect 5): 589 \"a static reaches through two adjacent Ancient Ones, once each\".",
    fix: "Optional owner question: in a row Ancient One, Ancient One, ally (with the first also beside the ally in a bent formation), does the first Ancient One get the ally's ability once or twice? If twice, the closure keeps one entry per path, not per ally.",
    proof: null,
    verify: "Read 589 \"a static reaches through two adjacent Ancient Ones, once each\" and the closure in batch-metal-a.ts.",
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
    cards: ["Rotling"],
    title: "paying a {Modular} cost out of the bin fires no leftBin, so the bin-exit listeners never hear it",
    detail: "CR 405.7: every exit from a bin fires leftBin. payModularMod (engine.ts) takes a {Modular} mod out of the bin with a raw zone.splice, so Rotling (\"When I leave your bin, ...\") and the other bin-exit listeners do not hear a bin card used as a Modular cost. CT-344's work kept the foreign-owner table right there and left the event out on purpose, because adding it changes replays.",
    evidence: "Round 2026-10-24, R1024-owner.md (new defect 1): the owner agent, fixing CT-344.",
    fix: "Take the card through takeFromBin (which goes through removeFromBin, so leftBin fires) with reason 'modded', keep the owner it returns, replay the stored games for drift, and guard it with a bin listener that hears the Modular payment.",
    proof: null,
    verify: "Rotling in a bin, pay a {Modular} cost with it: its trigger should be offered.",
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
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const CARD_TODO: TodoEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
