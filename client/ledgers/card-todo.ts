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
    id: 179, area: 'client', severity: 'minor',
    title:
      'the null-state class has two more doors one layer down, in applyUpdate and in the '
      + '`joined` branch of onMsg',
    detail:
      'CT-161 swept the helpers reachable from paintLive and found the door shut. Two more '
      + 'doors of the SAME class are one layer down and were measured but deliberately not '
      + 'changed:\n'
      + '  (a) applyUpdate calls noteHasteAnswered(this.state, …) and noteCast(this.state, …) '
      + 'unconditionally. A released `update` carrying no `view` before a board exists leaves '
      + '`this.state` null and hands it straight to watchCast.\n'
      + '  (b) onMsg does `this.state = m.view!` — a `joined` with neither `waiting` nor '
      + '`view` gives renderNow a board screen over a null state, and `h.state.players[…]` '
      + 'throws with the identical message-eating shape that made a refused join sit on '
      + '"Connecting to the server…" forever (report #135).\n'
      + '⚠ NEITHER IS REACHABLE TODAY — the server always sends a view — which is exactly why '
      + 'this is a ticket and not a fix. The unreachability is an accident of the server, not '
      + 'a property either client site asserts, and nothing on either side of the wire says '
      + 'so.',
    evidence:
      'ROUND 36, found by the CT-161 sweep and reported rather than fixed, which is the '
      + 'correct call — CT-161\'s brief was the helpers reachable from paintLive, and these '
      + 'are consumers one frame further in. Filed as a ticket the same day because this '
      + 'round\'s own finding (R285) is that a defect whose only home is a sentence stops '
      + 'being work.',
    fix:
      'Decide which side owns the invariant and say it there. Either the server\'s contract '
      + 'is "a `joined`/`update` always carries a view or a waiting" and something asserts '
      + 'that on the wire, or the client stops assuming it. ⚠ Do not simply add two null '
      + 'guards: the general shape CT-161 recorded is that a bail inside the callee never '
      + 'protects the argument, and a guard that makes the symptom go away without naming '
      + 'the owner of the invariant leaves the third door to be found later.',
    proof: null,
    verify:
      'Send a client a `joined` with neither `waiting` nor `view`, and an `update` with no '
      + 'view before any board exists. Neither should throw.',
    status: 'open',
  },
  {
    id: 180, area: 'coverage', severity: 'minor',
    title:
      'the UI test driver hands back a stub element for any id it is asked for, so a slot '
      + 'written to a screen that has no such node is invisible to every test',
    detail:
      '`engine/test/ui-driver.ts` returns a stub for any id not in its `ABSENT` list. '
      + '`setLiveSlot` has a "not a board screen" bail that works by `getElementById` coming '
      + 'back null — so in the driver that bail is NEVER TAKEN, and every live-slot write '
      + 'appears to succeed on every screen. Harmless for CT-161\'s guard, which measures '
      + 'whether the HELPER returned rather than whether the write landed, and says so. But '
      + 'it means no test in this repo can currently fail on a slot painted onto a screen '
      + 'that has no node for it.',
    evidence:
      'ROUND 36, noticed by the CT-161 agent while building 265-live-slots-without-a-board. '
      + 'It is the docs/13 §5 shape — an instrument that reports more sight than it has — and '
      + 'it was found the way §5 says they always are: by somebody distrusting a clean '
      + 'result.',
    fix:
      'Make the driver\'s element lookup answer honestly: a node exists iff the markup '
      + 'render() actually wrote contains that id. ⚠ EXPECT THIS TO REDDEN TESTS THAT ARE '
      + 'PASSING FOR THE WRONG REASON — that is the point, and each one wants reading rather '
      + 'than patching. Derive the id set from the rendered markup, never from a typed list, '
      + 'or the driver acquires the same blindness one level up.',
    proof: null,
    verify:
      'Ask the driver for an id no render has ever written. It should come back null, and '
      + 'setLiveSlot should take its bail.',
    status: 'open',
  },
  {
    id: 181, area: 'client', severity: 'minor',
    title:
      'an imposed-cost prompt is delivered as kind:targets with bare card names, so it reads '
      + 'as a targeting menu — and it has already cost one false bug report',
    detail:
      'The pick for an imposed additional cost (Vengeance\'s granted [Sacrifice a unit], and '
      + 'the Arbiter of Armistice\'s) arrives as `Decision.kind: \'targets\'`, and its option '
      + 'labels are bare card names — "The Foretold", "Bubb" — where a real target menu '
      + 'renders the owner too ("… (Ben\'s)"). So a question that means "choose one of YOUR '
      + 'units to sacrifice, as the price of the card you are playing" is presented in the '
      + 'same clothes as "choose a target", with nothing on it saying whose units these are '
      + 'or what paying does.',
    evidence:
      'ROUND 36. ⚠ THIS IS NOT HYPOTHETICAL — IT IS THE MEASURED COST. On 2026-08-27 the '
      + 'owner opened `vengeance-taxes-their-play`, read this prompt, and filed a `broken` '
      + 'verdict on Vengeance: he took Sudden Bloom for a targeted card and the sacrifice '
      + 'prompt for a targeting prompt. He caught it himself and retracted it twenty minutes '
      + 'later ("That verdict was a misread"). The engine was correct throughout — CT-177 '
      + 'proved it from YNBP\'s action log — so the ENTIRE episode, including a false ticket '
      + 'raised against the card five days later, traces to this one surface. In a '
      + 'shared-mode game both seats can carry the same name, which removes the last cue.',
    fix:
      'Make the prompt say what it is. Two halves, and the second is the general one: (a) an '
      + 'imposed-cost pick should name the owner of each option the way a target menu does, '
      + 'and (b) it should not wear `kind: \'targets\'` if that is the only thing telling the '
      + 'client how to draw it — a cost is not a target (R64/R67 keep those apart in the '
      + 'rules; the UI collapses them). ⚠ DERIVE the affected family rather than fixing the '
      + 'two cards: CT-177 established by census over printed.json that exactly two cards '
      + 'hang a bracketed additional cost on somebody else\'s play (Vengeance, Arbiter of '
      + 'Armistice), and that census already exists to be reused.',
    proof: null,
    verify:
      'Open vengeance-taxes-their-play in two tabs and play Sudden Bloom from seat 1. The '
      + 'prompt should be unmistakably "pay this to play your card", with each unit marked as '
      + 'yours — not a bare list of two names.',
    status: 'open',
  },
  {
    id: 182, area: 'client', severity: 'minor',
    title:
      'auto-pass keeps firing while a modal is open, including the bug-report dialog you '
      + 'opened to report the moment it is passing through',
    detail:
      'MEASURED, 2026-09-01: with the rules reference, the judge panel or the 🐛 report dialog '
      + 'open, the client still sends `passPriority`. On the surface this is CT-135\'s class — '
      + 'a modal is up and the game moves anyway — but ⚠ IT IS DELIBERATELY FILED AS A '
      + 'DECISION RATHER THAN A DEFECT, and the distinction is the entry:\n'
      + '  · a hotkey firing through a modal is an ACCIDENT — the player pressed a key meaning '
      + 'it for the dialog. That was CT-135 and it is straightforwardly a bug.\n'
      + '  · auto-pass is an EXPLICIT STANDING ARRANGEMENT whose entire point is that you do '
      + 'not have to be watching. Suppressing it while a panel is open is a change to what the '
      + 'player asked for, not a repair of it.\n'
      + '  · and unlike a suppressed hotkey, suppressing auto-pass changes game-visible TEMPO '
      + 'FOR THE OPPONENT: they now wait on you while you read a rules page.\n'
      + 'The sharpest case for changing it is the 🐛 dialog specifically — a player opens it to '
      + 'report THIS moment, and the game moves on while they type, so the report lands against '
      + 'a board that has already gone.',
    evidence:
      'ROUND 36. Found while building BL-18 (full control), by the agent that had just fixed '
      + 'CT-135 — it measured the behaviour, judged that it was NOT the same bug, and declined '
      + 'to change it unilaterally. That is the right call: the two look identical and differ '
      + 'in who asked for what.',
    fix:
      'This needs an OWNER DECISION before code, and the question is narrow: should a standing '
      + 'auto-pass hold while a panel is open — all panels, or only the report dialog? ⚠ Note '
      + 'that BL-18\'s full-control toggle ALREADY serves the player who wants nothing acting '
      + 'for them, so the case for changing the default is weaker than it first looks. If the '
      + 'answer is "only the report dialog", the implementation is narrow and the tempo '
      + 'objection mostly evaporates.',
    proof: null,
    verify:
      'Arm auto-pass, open the 🐛 dialog while the opponent holds priority, and wait. Today the '
      + 'game advances underneath you.',
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
