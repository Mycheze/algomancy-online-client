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
 *  - Once a row's status is anything but `live` or `partial`, move it (byte for
 *    byte) to the end of playtest-ledger-closed.ts, so this file shows only the
 *    reports still open. A triage that settles a row at once moves it in the
 *    same commit. (2026-11-13: 57 settled rows, #321-#386, had piled up here.)
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
    id: 399, room: "QMRP", date: "2026-11-13",
    report: "invi, seat 0 (bug, medium): \"The everywhere should name a card when played in any way (e.g. insidious invitation)\"",
    status: 'live',
    note: "Real. QMRP (invi v LordZZX, constructed, competitive, played on 5e379f65) fetched and replayed 2026-11-15: 519 of 519, FAITHFUL. Played from hand, The Everywhere names (\"invi names Bloated Manablub as The Everywhere is played.\"); played off LordZZX's Insidious Invitation it arrives with no naming line at all, so its \"As I am played or modded, name a card\" never happened. Cause: a card played by another card's effect is declared by declareInlinePlay (batch-water-a.ts), which never runs the played card's own cast-window stages (namesAsPlayed, playsIntoFormation). Nothing on master since has touched it. CT-564 filed, with #405 (the same gap, Tiderunner Initiate; CT-568).",
  },
  {
    id: 401, room: "ENUC", date: "2026-11-14",
    report: "mycheze, seat 0 (ux, minor): \"The Cache zone is much larger than the Bin, which doesn't make sense. Usually, the cache has like 1 or two cards in it, if any and the bin has many. Just swap their sizes on screen, I think\"",
    status: 'live',
    note: "The owner's layout change. ENUC (mycheze v Gember) fetched and replayed 2026-11-15: 183 of 183, FAITHFUL; nothing wrong in the game. The two piles sit side by side on each player's info line (ui/main.ts info builder, .lbin / .lcache). CT-566 filed: swap their sizes.",
  },
  {
    id: 403, room: "AUUJ", date: "2026-11-14",
    report: "Nyar, seat 0 (bug, medium): \"The game is considered a loss for INT even if it should be a draw because both players are at 0. If they are both at 0 or lower the one with the lower value loses. If both are at the same value it is a draw\"",
    status: 'live',
    note: "Owner's call. AUUJ (Nyar v StubTailDstroyer, constructed, played on 940595b3) fetched and replayed 2026-11-15: 161 of 161, FAITHFUL. One combat damage sub-step took Nyar 5 → 0 and StubTailDstroyer 6 → 0; the engine ended it \"StubTailDstroyer wins the tie at 0: it goes against the initiative player\" — what CR 104.1b says. The higher-total rule is the designer's (calebgannon 2024-10-11, 2025-03-11, 2025-04-28: \"right now the higher life total wins draws\"); the equal-totals rule is the owner's alone (\"Highest total, tie: INT loses\", 2026-10-25, CT-409), and no designer source speaks to an exact tie. A judge says the engine breaks a rule, so it is not closed by the steward: CT-565 filed asking the owner to confirm or change his call.",
  },
  {
    id: 404, room: "", date: "2026-11-14",
    report: "mycheze, page metadeck (ux, medium): \"The \\\"middle click to zoom in\\\" on a card should work in ALL pages that have cards! Including the card search, viewing other decks, the card metagame list, everything. We should make it a codified action to \\\"zoom in\\\" on a card.\"",
    status: 'live',
    note: "The owner's feature request, filed from the meta deck page, no room. ui/zoom.ts serves the board and a few opted-in tables (the sideboard table, the draft pick and pool pages), not the other card-showing pages. BL-77 filed with his words: one zoom action, on every page that draws a card (CT-569).",
  },
  {
    id: 405, room: "KNQX", date: "2026-11-14",
    report: "StubTailDstroyer, seat 1 (bug, minor): \"When playing out Tiderunner Initiate with Insidious Invitation, you should be able to play Tiderunner into an open slot in formation\"",
    status: 'live',
    note: "Real. KNQX (Yagamino v StubTailDstroyer, constructed, played on 940595b3) fetched and replayed 2026-11-15: 211 of 211, FAITHFUL. Twice from hand: \"Tiderunner Initiate is played straight into the formation (a new column on the right).\"; off StubTailDstroyer's Insidious Invitation it is put on the stack and spawns with no spot asked. Printed: \"You may play me into an open spot in your formation.\" (CR 602.7). Same cause as #399: declareInlinePlay (batch-water-a.ts) asks for a formation spot only when the caller passes intoFormation (Hooba-Pon), never from the played card's own playsIntoFormation (Tiderunner Initiate, Trench Stalker). CT-568, carried by CT-564.",
  },
  {
    id: 406, room: "XUKH", date: "2026-11-15",
    report: "mycheze, seat 0 (ux, medium): \"We should improve the \\\"Do you want to bring spell tokens with you into this battle?\\\" UI. Rather than just being a small, boring list that you click, we should make it a modal of some kind that brings up all the spell tokens you control in a nice interface where you just click all the ones you want to bring with you, as well as buttons that clearly say \\\"Bring all\\\" or \\\"Bring none\\\"\"",
    status: 'live',
    note: "The owner's UX request. XUKH (mycheze v Gember) fetched and replayed 2026-11-15: 252 of 252, FAITHFUL. Today the question is a line in the prompt bar after Attack! with small token chips (ui/main.ts, ui.confirmRide; report [69]). BL-78 filed with his words: a dialog of the ridable tokens as tiles, with Bring all and Bring none (CT-570).",
  },
  {
    id: 407, room: "XUKH", date: "2026-11-15",
    report: "mycheze, seat 0 (ux, minor): \"When a cached card is in your hand, rather than having the \\\"Cache\\\" title float above the card and a \\\"Turn\\\" chip be on the card, let's remove the \\\"Turn\\\" chip and make it a \\\"Cache\\\" chip instead. It would take up less space and get the same idea across\"",
    status: 'live',
    note: "The owner's UX change. XUKH fetched and replayed 2026-11-15: 252 of 252, FAITHFUL. The hand strip draws cached cards under a .handcachedlabel (\"cached · playable now\") with the cache row's chip (cacheChip: \"⚡ turn\" for a glimpse). CT-567 filed: in the hand, one \"Cache\" chip and no floating label.",
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const LEDGER: LedgerEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
