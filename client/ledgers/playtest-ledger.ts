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
  {
    id: 340, room: "PUQF", date: "2026-11-07",
    report: "invi, seat 1, agreed fix: back to before invi's choice: Dropslime (turn 8 battle, counterattack). \"dfdf\"",
    status: 'agreed-fix',
    note: "Took back invi's pick of Dropslime for Blightwalker's \"recall another target unit from your bin\" and Yagamino's pass [346]-[347]; Yagamino agreed. Replayed (427/427, no divergence; --branch): invi picked Splort from the same bin instead [346] and paid [2] [349]. The trigger offered both cards either time; the player changing their own pick. No defect.",
  },
  {
    id: 341, room: "ASSX", date: "2026-11-07",
    report: "invi, seat 1 (feature): \"when targeting, cards that are already targeted should not only say that they are targeted, but also by what (because it's sometimes ambiguous)\"",
    status: 'live',
    note: "A fair request, not a defect. Replayed (298/298): at [276] two stack items aimed at Dropslime copies in invi's bin at once, Blightwalker's recall [269] and Combustible Bogwalker's recall (item 114); a bin card aimed at shows only the badge \"🎯 targeted\" (ui/main.ts binTargetBadge), which names nothing. The hover arrows from a stack row exist, but nothing on the card says which item aims at it. CT-537.",
  },
  {
    id: 342, room: "ASSX", date: "2026-11-07",
    report: "invi, seat 1: \"augments falling off of a recalled creature should count as trashed for dropslime\"",
    status: 'live',
    note: "Real. Replayed (298/298): Yagamino's Bloated Manablub was grafted (Molten Upheaval, Void Memory) at home in region 0 [226]-[227], attacked into invi's region 1 [250] and was recalled by Auric Ascendant [258]; both mods were trashed, but the battle tally counted them under region 0 (battleCounters [{trashed:2},{trashed:5}] at [294]), so each Dropslime [295], [297] dealt 5, not 7. The mods kept the region they were applied in: declaring an attack moves the attackers' region and not their mods'. CT-536.",
  },
  {
    id: 343, room: "ZFHC", date: "2026-11-07",
    report: "Yagamino, seat 1, agreed fix: back to before Yagamino's Dropslime (turn 4 battle, counterattack). \"cwesyf\"",
    status: 'agreed-fix',
    note: "Took back Yagamino's discard of Dropslime and the choice that followed [91]-[92]; invi agreed. Replayed (406/406, no divergence; --report): the discard trashed Dropslime from hand and fired both Cthyrian Rector's \"recall the trashed card\" and Dropslime's own trash trigger, and Yagamino's first choice [92] was the order of those two. Replayed again Yagamino discarded Dropslime the same way [91] and ordered them the other way round, Cthyrian Rector first [92], then aimed at Bellowing Boulder [93]. The player changing their own choice; no defect.",
  },
  {
    id: 344, room: "ZFHC", date: "2026-11-07",
    report: "invi, seat 0: \"throwing a deadly throwing bloulder should be a deadly 3 dmg! (it should remember the last state of the card before it left the battlefield)\"",
    status: 'live',
    note: "Real. Replayed (406/406): turn 10, Yagamino attacked with one column, Carapace Devourer ({Deadly}) and Throwing Boulder, so the Boulder shared Deadly (CR 802.1e). It was sacrificed for its ability [258] aimed at invi's Pestilent Titan (3/4) [259], and the ability dealt a plain 3 [261]: the Titan lived, and the players took it off the board by hand (#346). CR 714.2: an effect whose source has left play has the attributes it had when it left, its column's included; 802.1e's own example is Bellowing Boulder pinging with Deadly. The sacrifice is a cost, paid before the ability is on the stack, so the last-known snapshot finds no item to write to. Reproduced on a fresh board: the same column's Boulder deals 3 non-Deadly to a Good Whale. CT-538.",
  },
  {
    id: 345, room: "ZFHC", date: "2026-11-07",
    report: "invi, seat 0, agreed fix: back to before Yagamino's Throwing Boulder's ability (turn 10 battle). \"asd\"",
    status: 'agreed-fix',
    note: "The players' first repair for #344 (CT-538), whose entry carries the defect. Took back the Throwing Boulder sacrifice, its target Pestilent Titan and both passes [258]-[261]; Yagamino agreed. Replayed (--report): the redo repeats every cut choice (4/4), and the 3 damage again came without the Deadly the Boulder shared with Carapace Devourer, which is why the players then edited the Titan off the board (#346). The take-back itself was legal and changed nothing; no defect of its own.",
  },
  {
    id: 346, room: "ZFHC", date: "2026-11-07",
    report: "invi, seat 0, agreed fix: take invi's Pestilent Titan off the board, to their bin. \"asd\"",
    status: 'agreed-fix',
    note: "The players' hand repair for #344 (CT-538), whose entry carries the defect. At [262] (turn 10 battle) both agreed to bin invi's Pestilent Titan (unit 88), the target the sacrificed, Deadly-sharing Throwing Boulder should have killed with its 3 damage (CR 714.2). Replayed faithfully with the edit. The edit put the board where the rules had it; no defect of its own.",
  },
  {
    id: 347, room: "ZFHC", date: "2026-11-07",
    report: "invi, seat 0 (feature): \"a way to see erased cards\"",
    status: 'fixed',
    guards: ['58-playtest-round9.test.ts::CR 407.1a: erased cards are kept in a public pile',
      '50-ui-inspect.test.ts::erased',
      '70-playtest-round15.test.ts::board menu offers BOTH erased piles'],
    note: "Already there: the same ask as #31 (2026-08-21). Right-clicking the bare table opens \"🚫 My erased cards (n)\" and \"🚫 <opponent>'s erased cards (n)\" (ui/inspect.ts boardMenuEntries), each a dialog of that pile. The owner put them only on the table's menu, not on a card's (2026-08-25: \"Those are for ONLY when right clicking the field\"), and the tutorial's menu tip names them. invi had erased cards to look for at [365] (Sparkwraith and its mod, erased at Skybreaker's cost). Finding the entry is the gap, not the view.",
  },
  {
    id: 348, room: "ZFHC", date: "2026-11-07",
    report: "invi, seat 0, dispute: \"why did one of us win?!?!?!?\" (game over, turn 14)",
    status: 'by-design',
    guards: ['656-deck-out.test.ts::CR 104.5 / CT-385: in constructed the card step from an empty deck and pile ends the game'],
    note: "By design: invi ran out of cards. Replayed (406/406): at the turn 14 card step invi's deck was empty, the two recycled cards were shuffled in and drawn with the one left (\"invi draws 3\"), and the fourth draw found nothing: \"invi has to draw from an empty deck and loses — Yagamino wins!\", with invi at 17 and Yagamino at 19. CR 104.5a: in constructed the player who ran out of cards loses, whatever the life totals; its example is exactly the card step. The bin is never shuffled in (CR 104.5), and invi had 13 cards there.",
  },
  {
    id: 349, room: "PBNT", date: "2026-11-07",
    report: "invi, seat 0 (feature): \"big glimpse card: make a view where you can reorder the cards between two piles until happy\"",
    status: 'live',
    note: "A fair request, not a defect. Replayed (252/252, --report @90): invi, splitting Yagamino's seven, picked one card at a time into pile 1 [86]-[88] and then \"Done splitting\" [89]. The split is a run of one-card questions (batch-hybrids-ld-a.ts, `split:k`): a pick cannot be taken back, and the two piles are never shown side by side until the caster chooses. CT-539.",
  },
  {
    id: 350, room: "TGMK", date: "2026-11-08",
    report: "invi, seat 1, agreed fix: back to before invi's Nothyr (turn 8 battle). \"asdf\"",
    status: 'agreed-fix',
    note: "Took back invi's discard of Nothyr [264] (\"negate up to one target nonspell effect\", with Yagamino's Tenebrous Bulborb augment on the stack); Yagamino agreed. Replayed (--report, the board rebuilt): Nothyr was offered and paid correctly. Replayed again invi used Combustible Bogwalker's ability instead [264], recalling Dropslime [265] and discarding Nothyr for it [266]. The player changing their own play; no defect.",
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const LEDGER: LedgerEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
