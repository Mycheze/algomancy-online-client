/**
 * THE PLAYTEST REPORT LEDGER — every bug report the owner has ever filed,
 * with its status and the test that keeps it fixed.
 *
 * WHY THIS EXISTS
 *
 * Reports arrive through the in-game Report button (the 🐛 button until
 * 2026-09-05) and land in `var/issues.jsonl` on the game server. That file is not in git, so the
 * reports themselves were never version-controlled, never reviewed, and never
 * connected to anything that could fail. The result, in the owner's words on
 * 2026-08-22: "Things that I mention as being problematic in games should STOP
 * BEING PROBLEMS."
 *
 * Two reports proved the point on the same day:
 *
 *  - Tempest Wrangler / Alluring was reported on 2026-08-20 (BRDM), fixed in
 *    round 7 with a whole test file — and reported again, verbatim, on
 *    2026-08-22 (UFAB). Round 7's tests only ever attacked with columns that
 *    were ALL Alluring, so the one board shape that mattered (a mixed attack,
 *    where a blocker can be dumped on a non-Alluring column) was never
 *    asserted. A fix with a test that misses the reported shape is not a fix.
 *
 *  - Harbinger of Immolation's "your spell tokens stay through regroup" was
 *    reported on 2026-08-20 (ZQPC) and was still completely unimplemented on
 *    2026-08-22, when it cost the owner a constructed game. `git log` shows no
 *    commit ever touched it in response. It LOOKED handled because a PARKED
 *    note and a `{todo:true}` placeholder already existed — and a `{todo:true}`
 *    test can never fail, so the repo stayed green while the card stayed dead.
 *
 * So the rule this ledger enforces is narrow and deliberate: **a report marked
 * FIXED must name a test that actually exists.** Not a commit message, not a
 * comment, not a rule number — a test. `70-playtest-ledger.test.ts` checks it.
 *
 * HOW TO USE IT
 *
 *  - A new report comes in: add an entry. The count assertion fails until you
 *    do, so a report cannot be silently dropped on the floor.
 *  - You fix something: set `status: 'fixed'` and name the guard. If you cannot
 *    name a guard, it is not fixed — it is `live` with a note.
 *  - `{ todo: true }` tests do NOT count as guards. That is the exact trap
 *    Harbinger fell into. `guards` must name a test that runs and can fail.
 *
 * STATUS VALUES
 *   'fixed'    — resolved, and `guards` names test(s) that would fail if
 *                someone re-broke it.
 *   'live'     — still broken. `note` says why / what the root cause is.
 *   'partial'  — some of the report is done. `note` says which part is not.
 *   'by-design'— the engine deliberately does something else. `note` MUST cite
 *                the ruling, Manual page, or rule number that justifies it,
 *                because this is us telling the owner he was wrong and that
 *                needs a source.
 *   'wontfix'  — acknowledged, not being done. `note` says why.
 *   'agreed-fix' — (CT-327, 2026-10-21) a row filed by an AGREED FIX (BL-46,
 *                the in-game "propose a fix" both players accept) whose cut or
 *                edit was a player's misclick or take-back, with no defect
 *                behind it. Every accepted fix files a report row (owner,
 *                2026-10-16), so most of these are "oops". `note` MUST say
 *                what was taken back and why that is no defect; the row's
 *                snapshot line must carry `fix` (70-playtest-ledger checks
 *                both). An agreed-fix row whose "What went wrong" names a real
 *                defect gets a normal status instead (`fixed`, `live`, …), and
 *                so does one that turned out to be hiding one (YNKA #262's
 *                "oops" was a Warder that could not redirect a Virus).
 *                `server/rewind-cuts.ts` and `replay-room.ts --report` rebuild
 *                the board a fix row was filed on, which is how to tell.
 */

export type ReportStatus = 'fixed' | 'live' | 'partial' | 'by-design' | 'wontfix' | 'agreed-fix';

/**
 * One row of issues.jsonl, as the reader sees it. The shape is the WRITER's
 * (`server/report-fields.ts` — /api/report builds exactly this), re-exported
 * here so the ledger test and any other reader of the snapshot name it once.
 * `kind` and `severity` (T6, 2026-09-05) are optional because 150-odd rows
 * were written before the form asked for them.
 */
export type { IssueRow, ReportKind, ReportSeverity } from '../server/report-fields.ts';

export interface LedgerEntry {
  /** index into issues.jsonl, oldest first — the stable id */
  id: number;
  /** room code the report came from */
  room: string;
  /** ISO date (day precision is enough) */
  date: string;
  /** the report, trimmed to its essence but not paraphrased into something else */
  report: string;
  status: ReportStatus;
  /**
   * Test(s) that keep this fixed. Each is `file::substring-of-the-test-name`.
   *
   * The substring must appear in a `test('...')` title in that file, and — as
   * of 2026-08-25 — in EXACTLY ONE of them. Both halves were loopholes:
   *
   *  · it used to be enough to match an `assert.ok(…, 'message')` label, so a
   *    guard could point at a sentence inside a test rather than at a test.
   *  · a substring matching SEVERAL titles pinned none of them. `#43` cited
   *    `50-ui-inspect.test.ts::X`, which matched twelve — every X-on-stack test
   *    could have been deleted and this ledger would have stayed green.
   *
   * Where a report really is held down by a family of tests, list the family:
   * one entry per test, each naming its own. Required when status is 'fixed';
   * a `{todo:true}` test does not qualify.
   *
   * ⚠ AND THE PART NO TEST CAN CHECK. `70-playtest-ledger.test.ts` proves a
   * guard EXISTS. It cannot prove the guard is about the report. Three entries
   * were closed for months against tests that could not fail on the reported
   * behaviour (#25's guards read only ui/style.css; #44's named the one
   * Throwing Boulder test that was the POSITIVE case; #46's class guard was a
   * replacement sweep that never looks at the card). The only thing that
   * settles it is a MUTATION: break the reported behaviour on purpose and
   * watch the named guard go red. If you have not done that, you do not know
   * that you have a guard.
   */
  guards?: string[];
  /** required for every status except 'fixed' */
  note?: string;
}
import { CLOSED } from './playtest-ledger-closed.ts';

/** Everything still open. The closed entries — the bulk of the file until
 *  2026-09-03 — live in playtest-ledger-closed.ts, unchanged and still run. */
const OPEN: LedgerEntry[] = [
  {
    id: 321, room: "KFCS", date: "2026-11-03",
    report: "mycheze, seat 1, agreed fix: set both players' life down by 2. \"Gember didn't get to play Recall from her bin during that turn for some reason. She spell extracted it but didn't get priority to play it\"",
    status: 'by-design',
    guards: ['230-pass-modes.test.ts::a bin play your own resolving Spell Excavation grants hands pass through stack back, and not pass all'],
    note: "By design (CT-527). Replayed: after Spell Excavation chose Recall [264], the engine offered Gember both Recalls from the bin at every one of her seven priority windows [268]-[282], and the bin glows a playable card. On those states a Pass through stack would have handed priority back at [268] (a new option, CR D2.2b); a Pass all keeps passing to the end of the phase by the owner's ruling (CR D2.2d). The room file cannot say which button made the passes. If a play your own spell grants should stop Pass all, that is a change to that ruling.",
  },
  {
    id: 322, room: "DQTX", date: "2026-11-03",
    report: "mycheze, seat 1: casting spell tokens, the UI makes you click the first one again instead of taking the one you clicked as the first, and the final one is picked for you. It throws off the sequence.",
    status: 'fixed',
    guards: [
      '358-burst-order-ui.test.ts::§1 clicking a Fireball makes it #1 (report #322)',
    ],
    note: "Real. [129] cast token 46 (ordered), then [130] the burst-order prompt asks which resolves first: the clicked token is ignored (burstStep is called with no pick), and the last token is taken without asking. The owner's ask changes the CR 803.5d flow. CT-528. Fixed 2026-11-05: the token you click to cast a Burst group is #1 and goes straight to its aim; every later token is a pick on the board, the last one too (CR D1.2h).",
  },
  {
    id: 323, room: "SHXD", date: "2026-11-03",
    report: "mycheze, seat 1: when \"all passing\" your clock still ticks down and it shouldn't.",
    status: 'by-design',
    guards: ['1145-passall-clock-walk.test.ts::CT-523 §1 a seat on Pass all runs no clock in any priority window of the battle'],
    note: "By design, on the owner's own answer (CT-523). SHXD replayed through the real server with Pass all armed at each player's first battle pass: no window Pass all was passing in ran a clock; the clock ran only while the game waited on that player to declare blocks or an attack, pick a target or answer a \"you may pay\". Asked whether those should stop too, the owner said no (2026-11-05): \"It should ONLY tick down when you have to do something, anything, in order for the game to progress.\" CR D3.2b now cites that. Gember lost this game (game 3 of a match) on time; #325 is the dispute.",
  },
  {
    id: 325, room: "SHXD", date: "2026-11-03",
    report: "mycheze, seat 1, dispute (winner mycheze): \"We don't really want this to count.\"",
    status: 'wontfix',
    note: "Nothing to build: the dispute did its job (BL-48: it files this row, tags the game and changes no result). Filed two minutes after Gember lost game 3 of match MH4VMRK6WGV on time (clockMs [0, 539039]; the match carries banks between games). Whether the result stands is the owner's call; the defect that may lie behind it, a clock running under Pass all (#323), is CT-523.",
  },
  {
    id: 329, room: "", date: "2026-11-06",
    report: "mycheze (owner), the league match waiting room: remove the redundant explanatory text — \"Deals when both decks are in.\", \"They join from their own League page — tell them on Discord you are here.\" and \"Any deck. Keep it or change it every game.\"",
    status: 'fixed',
    guards: [
      "961-page-waiting-html.test.ts::961 §3b the owner removed the waiting room explanatory lines",
    ],
    note: "Real and as described: all three lines were printed by the constructed (league) match room, and the League-page sentence also by the league live-draft lobby. Removed from both (CT-531, 2026-11-06); the seat row's 'not here yet' still says who is missing.",
  },
  {
    id: 330, room: "MCHQ", date: "2026-11-06",
    report: "Nyar, seat 1, agreed fix: back to before Nyar's Mirrorback Ambusher (turn 5 battle, counterattack). \"control check for the stack\"",
    status: 'agreed-fix',
    note: "Took back Nyar's Mirrorback Ambusher ambush on their own Arcane Concentrator [156]-[157], put on the stack in the counterattack window; mycheze agreed. Replayed (600 of 600 actions, no divergence): Nyar played exactly the same two actions again [156]-[157], still held priority, and cast Leaping Lillik on Aberrant Statweaver on top [158]-[159]; the stack resolved Lillik, its two Concentrator triggers and Body Swap, then the ambush. The engine let Nyar keep priority over their own ambush, as it should; the take-back replayed the same play, so it was a check, as the reason says. No defect.",
  },
  {
    id: 331, room: "MCHQ", date: "2026-11-06",
    report: "Nyar, seat 1, agreed fix: back to before Nyar's augment (turn 9 battle, blocks declared). \"wrong order\"",
    status: 'agreed-fix',
    note: "Took back Nyar's Smouldering Inferno Virus augment on mycheze's Living Forge [318], played before anything else in the window; mycheze agreed. Replayed, Nyar cast Leaping Lillik on Automaton of Abundance first, ordered its triggers [318]-[320], then played the same augment on top [321], so it resolved first. The player's own sequencing, as the reason says; the engine took both orders. No defect.",
  },
  {
    id: 333, room: "UAUS", date: "2026-11-06",
    report: "Nyar, seat 1, agreed fix: back to before Yagamino's resource (turn 2 planning). \"test\"",
    status: 'agreed-fix',
    note: "Took back Yagamino's resource, Done planning and both haste Dones [30]-[33]; Yagamino agreed. Replayed (--branch): nothing had been played, and the two went straight on to the further take-back filed as #334. Trying the button, as the reason says; no defect.",
  },
  {
    id: 334, room: "UAUS", date: "2026-11-06",
    report: "Nyar, seat 1, agreed fix: back to the start of this step (turn 2, planning). \"test\"",
    status: 'agreed-fix',
    note: "Continues #333: took back all of turn 2's planning [20]-[29] (bottom cards, recycles, resources); Yagamino agreed. Replayed, both players planned again, in a different order, and the game went on to 358 actions. A test of rewinding through a hidden step; no defect.",
  },
  {
    id: 335, room: "RGMY", date: "2026-11-06",
    report: "invi, seat 0, agreed fix: back to the start of this step (turn 3, deployment). \"asd\"",
    status: 'agreed-fix',
    note: "Took back Yagamino's Bloated Manablub, its Molten Upheaval graft, invi's Darkblast graft on Maw of Despair and Yagamino's Molten Riftbreaker [115]-[118]; Yagamino agreed. Replayed (--branch): Yagamino deployed Molten Riftbreaker first and then Manablub with a graft, and invi did not graft Darkblast. The players redoing their own deployment; the engine took both. No defect.",
  },
  {
    id: 336, room: "AXNJ", date: "2026-11-06",
    report: "invi, seat 0, agreed fix: back to before invi's choice: Yagamino, then further back to before invi's choice: Molten Riftbreaker (turn 3 battle). \"asd\"",
    status: 'agreed-fix',
    note: "Two rewinds in one run: Dropslime's target (Yagamino's Molten Riftbreaker) [73] and Splort's (Yagamino) [74]; Yagamino agreed both. Replayed (--branch): invi chose the same two targets the other way round, Dropslime at Yagamino and Splort at the Riftbreaker [73]-[74]. Both triggers offered every target either time; the player swapping their own aims. No defect.",
  },
  {
    id: 337, room: "QHBA", date: "2026-11-06",
    report: "Yagamino, seat 1, agreed fix: back to the start of the step before (turn 1, planning). \"ghg\"",
    status: 'agreed-fix',
    note: "Took back all of turn 1's planning and invi's haste Done [0]-[12]; invi agreed. Replayed (--branch): the same kinds of plays again in another order, and the game went on to 150 actions. Nothing had happened yet; trying the button. No defect.",
  },
  {
    id: 339, room: "YYAE", date: "2026-11-07",
    report: "invi, seat 1: \"when putting a trigger on the stack triggers another trigger, the new trigger should always be on top of the others (i think, I'm not a 100 %)\"",
    status: 'live',
    note: "Real on the CR's reading. Replayed (257/257): [222] invi ordered Splort's and Blightwalker's trash triggers; putting Splort's on cost a discard, Dropslime [225], whose trigger fired with Blightwalker still waiting, and [226] asked invi to order Blightwalker and Dropslime together, so Blightwalker went on top. CR 706.5 orders the triggers put on at the same time; CR 706.3a puts a trigger on once the action that made it trigger is complete, on top of what is already there, so Dropslime belongs above Blightwalker. CT-535.",
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const LEDGER: LedgerEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
