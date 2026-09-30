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
 */

export type ReportStatus = 'fixed' | 'live' | 'partial' | 'by-design' | 'wontfix';

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
    id: 176, room: 'EGBM', date: '2026-09-28',
    report: 'kareds (seat 0), at the block window after Cosmic Reversal recalled their Spawntender: "hooba god should be blocked"',
    status: 'live',
    note:
      'The ENGINE is right and the BOARD lied. Replayed 393/393 faithful: at [334] Spawntender '
      + 'blocked the original Hooba-God (column 4); at [343] Cosmic Reversal recalled it; at '
      + '[345] combat printed "Column 4 is blocked (blockers gone) — no damage through" — R185, '
      + 'a removed blocker does not un-declare the block. But the battle panel draws a column '
      + 'as "unblocked" whenever its blocker LIST is empty (ui/main.ts, `b.blocks[ci] ?? []` '
      + 'then the ghost slot), never asking whether the key exists — so the reporter was shown '
      + 'an unblocked Hooba-God at the moment they filed. The 4 damage they took was the TOKEN '
      + 'copy (left unblocked by choice) plus Visionary Construct.',
  },
  {
    id: 177, room: 'XSEN', date: '2026-09-29',
    report: 'Owner: "With the new regions layout, the hand viewer reminder list thing is totally broken and can\'t be seen when in combat. It\'s fine to sorta hover over the inactive region, like how the stack can be on either side."',
    status: 'live',
    note:
      'The "👁 Their hand, seen" strip (confirmed by the owner 2026-09-30). On the regions board '
      + 'it is a grid row inside the opponent\'s info block, which clips (`overflow: hidden`, '
      + '`container-type: size`); `.lboard.fighting` shrinks that block until the strip row falls '
      + 'below the clip edge. Bripp revealed Gember\'s hand at [135], mid-battle, so the strip '
      + 'was populated and invisible for the whole fight. Fix: float it over the inactive region '
      + 'during battle, placed the way the stack window is.',
  },
  {
    id: 178, room: 'XSEN', date: '2026-09-29',
    report: 'Owner: "Pass through stack *still* isn\'t working right"',
    status: 'by-design',
    note:
      'R251 (the owner\'s round-31 Q6: "Pass through the stack assumes a pass is given to all '
      + 'effects that are currently on the stack, but gives priority if something changes"). '
      + 'Replayed 317/317 faithful: Tides of the Cosmos cast Rotwall and Amphivore; when '
      + 'Amphivore resolved at [181], Throw off a Cliff ("delete target unit with 4+ defense") '
      + 'became castable, a new option, and the pass released with Rotwall still on the stack '
      + '— `passAllRelease` returns \'ability\' on the replayed state at [182], one action before '
      + 'the report. Put to the owner 2026-09-30 with three options (only opponent changes '
      + 'release / own-stack spawns in scope / keep and explain); answer: "Don\'t even really '
      + 'need to explain it" — the behaviour stands, no reason line.',
  },
  {
    id: 179, room: 'XSEN', date: '2026-09-29',
    report: 'Owner: "Counter attack UI is pretty bad. There should be a special layout for choosing how to build your formation"',
    status: 'live',
    note:
      'At [278] round 2 opened with seat 0 declaring from a pool of three sent units. On the '
      + 'regions board they count as invaders of the battle region, so they are drawn in '
      + '`.linvside` — a narrow side strip at 0.6× card size — while the slots they must be '
      + 'clicked into sit in the fight block; the round-2 heading is hidden and the bar says '
      + '"build your attack". The owner chose (2026-09-30) a full-size staging row: the sent '
      + 'units drawn full-size in the fight block nearest home, every slot drawn up front, the '
      + 'bar saying it is a counterattack, and one-click shapes.',
  },
  {
    id: 164, room: '', date: '2026-09-14',
    report: 'Feature request from the home page (signed out): "Constructed draft mode would be great"',
    status: 'live',
    note:
      'A feature, not a defect, and it is BL-05 in the backlog — "Cube draft: pregame pod '
      + 'draft into a 30-card constructed tournament". Left open deliberately rather than '
      + 'closed as wontfix: it is wanted, it is scoped, and it is the second request for '
      + 'some form of draft-then-build. ⚠ WHAT THEY MEANT IS NOT SETTLED — "constructed '
      + 'draft" could be drafting a pool and building from it (BL-05 as written) or bringing '
      + 'a constructed deck into a draft pod, which is a different game. Ask before building.',
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const LEDGER: LedgerEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
