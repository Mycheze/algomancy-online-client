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
    status: 'fixed',
    guards: [
      "1181-late-trigger-goes-on-top.test.ts::cost goes on top of the whole batch, unasked",
    ],
    note: "Real on the CR's reading. Replayed (257/257): [222] invi ordered Splort's and Blightwalker's trash triggers; putting Splort's on cost a discard, Dropslime [225], whose trigger fired with Blightwalker still waiting, and [226] asked invi to order Blightwalker and Dropslime together, so Blightwalker went on top. CR 706.5 orders the triggers put on at the same time; CR 706.3a puts a trigger on once the action that made it trigger is complete, on top of what is already there, so Dropslime belongs above Blightwalker. CT-535. Fixed 2026-11-08: a trigger set off while a batch goes on the stack waits for the whole batch and goes on top, ordered only with the other late ones; the batch keeps the order its player gave.",
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
    status: 'fixed',
    guards: [
      "1182-bin-target-names-its-aimer.test.ts::each copy names its own aimer (the ASSX case)",
    ],
    note: "A fair request, not a defect. Replayed (298/298): at [276] two stack items aimed at Dropslime copies in invi's bin at once, Blightwalker's recall [269] and Combustible Bogwalker's recall (item 114); a bin card aimed at shows only the badge \"🎯 targeted\" (ui/main.ts binTargetBadge), which names nothing. The hover arrows from a stack row exist, but nothing on the card says which item aims at it. CT-537. Fixed 2026-11-08: a targeted bin card's crosshair names the stack items aiming at it on hover, on the region strip and in the bin dialog, and in the dialog the card says it under itself (\"by Blightwalker\").",
  },
  {
    id: 342, room: "ASSX", date: "2026-11-07",
    report: "invi, seat 1: \"augments falling off of a recalled creature should count as trashed for dropslime\"",
    status: 'fixed',
    guards: [
      "1183-mods-travel-with-their-host.test.ts::a mod trashed off a recalled attacker counts as trashed in that battle",
    ],
    note: "Real. Replayed (298/298): Yagamino's Bloated Manablub was grafted (Molten Upheaval, Void Memory) at home in region 0 [226]-[227], attacked into invi's region 1 [250] and was recalled by Auric Ascendant [258]; both mods were trashed, but the battle tally counted them under region 0 (battleCounters [{trashed:2},{trashed:5}] at [294]), so each Dropslime [295], [297] dealt 5, not 7. The mods kept the region they were applied in: declaring an attack moves the attackers' region and not their mods'. CT-536. Fixed 2026-11-08: a unit's mods now move with it on every region move (the attack, a counterattacker's arrival, control change, regroup); replayed at its recording commit with the fix, both Dropslimes deal 7.",
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
    status: 'fixed',
    guards: [
      "1184-cost-sacrifice-last-known.test.ts::Throwing Boulder sacrificed from a column with a Deadly unit throws a Deadly 3",
    ],
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
    status: 'fixed',
    guards: [
      "341-pickset-modal.test.ts::Big Glimpse Card: Confirm answers every pile-1 card by value, then Done splitting",
    ],
    note: "A fair request, not a defect. Replayed (252/252, --report @90): invi, splitting Yagamino's seven, picked one card at a time into pile 1 [86]-[88] and then \"Done splitting\" [89]. The split is a run of one-card questions (batch-hybrids-ld-a.ts, `split:k`): a pick cannot be taken back, and the two piles are never shown side by side until the caster chooses. CT-539, fixed 2026-11-09: the splitter now gets a two-pile window, moves cards between the piles freely and confirms once; the client answers the same one-card questions, so the log is unchanged.",
  },
  {
    id: 350, room: "TGMK", date: "2026-11-08",
    report: "invi, seat 1, agreed fix: back to before invi's Nothyr (turn 8 battle). \"asdf\"",
    status: 'agreed-fix',
    note: "Took back invi's discard of Nothyr [264] (\"negate up to one target nonspell effect\", with Yagamino's Tenebrous Bulborb augment on the stack); Yagamino agreed. Replayed (--report, the board rebuilt): Nothyr was offered and paid correctly. Replayed again invi used Combustible Bogwalker's ability instead [264], recalling Dropslime [265] and discarding Nothyr for it [266]. The player changing their own play; no defect.",
  },
  {
    id: 351, room: "BHVW", date: "2026-11-08",
    report: "mycheze, seat 0 (ux): \"Spell tokens that are riding along don't need to be up in the \\\"invaders\\\" zone. It should be down *below* your row of units, close to your own bin. That's unused space anyway\"",
    status: 'fixed',
    guards: [
      "253-combat-orientation.test.ts::the riding token stands at the end of the strip nearest the attacker, on both screens",
    ],
    note: "A layout request, fair. Replayed (213/213, faithful): filed on the final position, turn 5, after mycheze's winning attack. Declaring an attack moves the riding spell tokens into the battle region with the attackers (apply.ts declareAttack), and the board draws them in that region's Invaders strip beside the attacking units; the owner wants them on the attacker's own side, below their units near their bin. Presentation only. CT-540. Fixed 2026-11-09: in a fight the riding tokens (and every other invader, all the attacker's) stand at the attacker's end of the strip at the right of the battle: the foot on the attacker's own screen, under their units and nearest their bin; the head on the defender's, as before.",
  },
  {
    id: 352, room: "", date: "2026-11-08",
    report: "mycheze, home (ux): \"The header text on the League and Challenge and Matchmaking is an unclickable row. It's weird and the whole card should be able to be clicked\"",
    status: 'fixed',
    guards: [
      "1185-home-side-card-click-through.test.ts::the lifted title and body of a home side card let a click through to the card's own button",
    ],
    note: "Real, by reading. Each side card is meant to open its page wherever it is clicked: a stretched transparent button (.homesideopen, pages/home.ts sideCardHtml) covers it. But styles/pages/54-home-art.css lifts every other child of the card to z-index 1 above that button, so the title strip and the body's glass catch the click and nothing happens; only the gaps between them open the page. CT-543. Fixed 2026-11-09: the lifted words take no pointer events, so a click anywhere on the card falls through to its button; buttons and links inside (Matchmaking's Join) take their own clicks back.",
  },
  {
    id: 353, room: "", date: "2026-11-08",
    report: "mycheze, home (ux): \"On the League box, there needs to be a bit more spacing between the \\\"current standings\\\" and the bottom of the box. Right now, it immediatly ends at the bottom of the box and it's hard to read\"",
    status: 'fixed',
    guards: [
      "1186-home-league-card-room.test.ts::the home page's League card is never squeezed below its words, so the standings are not clipped",
    ],
    note: "A spacing fix on the home page's League card: its body (pages/league.ts leagueGlanceHtml) ends on the standings list with no room under it. CT-544. Fixed 2026-11-09: the card shared the column's height by flex share and its glass shrank under its words and clipped them; the League and Challenge cards are now never smaller than their words, and the glass keeps 12px under its last line.",
  },
  {
    id: 354, room: "", date: "2026-11-08",
    report: "mycheze, home (ux): \"Saying \\\"Next: vs Yagamino\\\" in the League is a bit misleading. The order doesn't really matter. Rather, it should be something \\\"This week vs: Yagamino and Gember\\\" or \\\"This week vs: Yagamino, invi and Gember\\\"\"",
    status: 'fixed',
    guards: [
      "1024-league-home-glance.test.ts::the card names every opponent still to play this week, not one \"next\"",
    ],
    note: "Real: the League card names only the first unplayed match (pages/league.ts leagueGlanceView, `matches.find(x => x.playable && !x.result)`, drawn as \"Next: vs …\"), though a week's matches have no order. It should list every opponent still to play this week. CT-545. Fixed 2026-11-09: the card now reads \"This week vs: A, B and C\" over every match still to play this week, an agreed time beside its name.",
  },
  {
    id: 355, room: "", date: "2026-11-08",
    report: "mycheze, home (ux): \"When you copy a deck that someone else made and play it, it says \\\"Deck name copy - by _____\\\" but instead of their name, it's a UUID string of nonsense.\"",
    status: 'fixed',
    guards: [
      "1187-taken-copy-author.test.ts::a copy of a deck its owner built is by the owner, not \"you\"",
    ],
    note: "Real. The deck picker prints a collection deck as \"name — by author\" (pages/deckpicker.ts), and taking a copy of somebody's shared deck copies the source's free-text `author` verbatim (server/collection.ts duplicateDeck) instead of naming the player who published it. Which deck carried the id is not checked (the account store is not fetchable). CT-541. Fixed 2026-11-09: a taken copy is by its builder's name or the player who shared it, and no \"by …\" label prints an id any more.",
  },
  {
    id: 356, room: "", date: "2026-11-08",
    report: "mycheze, home (ux): \"Your understanding of what \\\"Casual and Competitive\\\" is about is wrong. Casual = simultaneous actions during simultaneous phases, Competitive = entirely turn based … Best of 1 or Best of 3 … should be a separate slider … add the rules set choice to Draft. And add a little hover tool tip …\"",
    status: 'fixed',
    guards: [
      "960-page-home-html.test.ts::960 §4 Constructed: Casual and Competitive",
      "1196-rules-set-apart-from-best-of.test.ts::1196 §1-§3 the rules set apart from Best of: a Casual match, and a Competitive draft",
    ],
    note: "Fixed 2026-11-09 (steward, staged): Draft and Constructed each choose the rules set (Casual = both at once, Competitive = in turn) with a tooltip; Constructed chooses Best of 1 or 3 apart from it (a Casual Best of 3 is a match played simultaneously; a Competitive draft plays in turn). CT-546. Triage: An owner design decision, filed as work: the home page's Constructed Format switch today means friend's room vs match (Competitive is Best of 1/3 with a sideboard, and only a match room plays in turn, server/match.ts `rules: { sequential: true }`). He separates the rules set (simultaneous vs in turn, on Draft AND Constructed, explained by a tooltip) from Best of 1/3 (Constructed, either rules set). Too big for a triage; his words are kept whole in BL-73 (CT-546 carries the report).",
  },
  {
    id: 357, room: "RUCV", date: "2026-11-08",
    report: "mycheze, seat 0 (gamebreaking): \"Gember thought she selected the right deck, but for some reason, it didn't actually follow her into the game.\"",
    status: 'live',
    note: "Real, cause not pinned. RUCV fetched: a friend's constructed room, Gember seat 1 dealt with her saved deck 92e37b2f… (a blue list: Bloated Manablub, Good Whale, Bripp …); mycheze conceded 15 seconds in, turn 1, to start again. In a friend's constructed room the joiner's browser-held deck is registered the moment they join (server/rooms.ts takesJoinDeck), so the game deals on arrival and the joiner never sees which deck they brought. League and Competitive rooms already take a deck only from the room's own pick. Why the held deck was not the one she chose is not checked (another tab or device, or a pick that did not stick). CT-542.",
  },
  {
    id: 358, room: "CNDX", date: "2026-11-08",
    report: "mycheze, seat 0 (ux): \"Cached cards that are playable in a turn should probably ALWAYS appear to the right of the hand (even when not playable due to timing restrictions or something), but with the same \\\"playable/not playable\\\" UI that cards normally have in the hand. It's too easy to miss that it appears in your hand ONLY for brief moments.\"",
    status: 'fixed',
    guards: [
      '155-hand-affordances.test.ts::a cached card you may play this turn but not this step stays beside the hand, dark',
    ],
    note: "Real, by reading. CNDX fetched and replayed (filed at [171], turn 5 battle; today's engine refuses a redundant pass at [83] after the 2026-11-08 priority changes, and --as-recorded shows every difference heals to the same final board). The cached cards beside the hand (ui/main.ts handCachedHtml) are only those with a legal action this instant, so a glimpsed card whose timing is shut disappears from there until its next window. He wants every cached card still usable this turn shown there, lit or dark like a hand card. CT-547.",
  },
  {
    id: 359, room: "CNDX", date: "2026-11-08",
    report: "mycheze, seat 0 (ux): \"When a unit is modded, the mod sorta cuts off the \\\"damage\\\" -X red badge so you can't read it unless you zoom in\"",
    status: 'fixed',
    guards: [
      "1193-damage-marker-over-mods.test.ts::the damage marker is drawn above the mod strips of a modded unit",
    ],
    note: "Real by the report; cause not seen (no browser on the box). Filed at [217], turn 6: Fireball 3 had just dealt 3 to mycheze's attacking Amphivore, grafted with Bloated Manablub. The red damage marker is drawn at the bottom-left of the card face, which on a modded unit is the seam where its first mod strip hangs (styles/board/08-playtest-ux-fixes.css, .card.modded). CT-548, fixed 2026-11-09: the marker is lifted above the strips (and the next card of a pile) and ringed dark; which of them covered it was not seen.",
  },
  {
    id: 360, room: "MNCM", date: "2026-11-09",
    report: "mycheze, seat 0 (ux): \"The new \\\"splitting\\\" UI for Big Glimpse Card is much better now! It's very easy to use and understand. But it should be basically the same for the chooser. Instead of giving them two buttons with a list of options, it should present them with two modal piles of cards to choose from with buttons below to \\\"Put Pile 1 into your hand\\\" or \\\"Put Pile 2 into your hand\\\" (and below, in smaller text \\\"Recycle the rest\\\"). Choices and actions should be visual as much as possible!\"",
    status: 'live',
    note: "A fair request, not a defect. MNCM fetched and replayed (57/57, no divergence; a test-mode game, mycheze both seats, played after the two-pile split window went live): seat 1 split the seven in the new window [13]-[16], and the report was filed at [17], the caster's pile question. That question is two text buttons listing each pile's names; it carries nothing the client could draw as cards. CT-549: show the caster the two piles as cards with a button under each.",
  },
  {
    id: 361, room: "", date: "2026-11-09",
    report: "mycheze, acct (ux): \"We should use the same font from the homepage in the headers and footers of all pages.\"",
    status: 'live',
    note: "A fair styling request, real by reading. The home page sets its headings and its footer's \"Algomancy\" in the brand lettering (styles/pages/54-home-art.css, `--font-brand`); every other page is drawn in the shared app frame (pages/frame.ts), whose title bar's page name and footer button use the plain body font. One change to the frame reaches every page. CT-550.",
  },
  {
    id: 362, room: "TUDN", date: "2026-11-09",
    report: "Debeli, seat 1, agreed fix: back to the start of the step before (turn 1, the haste step). \"asd\"",
    status: 'agreed-fix',
    note: "Took back Debeli's and mycheze's haste Dones, both attack passes and mycheze's Construct Overseer [10]-[14]; mycheze agreed. Replayed (--branch; 147 of 147 actions, no divergence): Debeli pressed Done with haste again and the two went straight on to the further take-back filed as #363. Trying the button, with a placeholder reason; no defect.",
  },
  {
    id: 363, room: "TUDN", date: "2026-11-09",
    report: "Debeli, seat 1, agreed fix: back to the start of the step before (turn 1, planning). \"asd\"",
    status: 'agreed-fix',
    note: "Continues #362: took back all of turn 1's planning [0]-[10] (bottom cards, resources, prismite exchanges, both Dones); mycheze agreed. Replayed, both players planned again in a different order, mycheze spawned Construct Overseer again, and the game went on to 147 actions. A test of rewinding through a hidden step; no defect.",
  },
  {
    id: 364, room: "TUDN", date: "2026-11-09",
    report: "mycheze, seat 0 (ux): \"When you hover over a prophecied card you should still be able to see the \\\"countdown\\\" stuff as \\\"chips\\\" on the card. You can still see when you're NOT hovering over it, but now you can't really tell when zoomed in\"",
    status: 'live',
    note: "Real by reading. Filed at [53], turn 2 deployment, with Debeli's Flzzz counting 'Two Turns Pass' in their cache. A cache thumb on the table wears its count as a chip beside the card, not on it, and the hover zoom copies only the card, so the zoomed copy has no count; the hand-side strip and the cache dialog put the chip on the card and keep it. CT-551.",
  },
  {
    id: 365, room: "TUDN", date: "2026-11-09",
    report: "mycheze, seat 0 (ux): \"The \\\"revealed hand zone\\\" covers your units when declaring an attack. I can't see my units here!\"",
    status: 'live',
    note: "Real, reproduced on the ui driver. Filed at [66], turn 3, mycheze declaring an attack, with Debeli's hand seen since Eldritch Dreamtender on turn 2. The 'their hand, seen' strip floats over the In Play of the region not being fought in, and when you attack that is your own, where you are picking attackers. Likely made worse the same day by in-play units standing full size in a battle. CT-552.",
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const LEDGER: LedgerEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
