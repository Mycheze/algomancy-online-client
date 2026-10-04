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
