/**
 * THE BACKLOG — everything the owner wants built that is NOT "make the cards
 * work", written down with enough detail that an agent with an idle hour can
 * pick one up and finish it without another interview.
 *
 * WHY THIS EXISTS
 *
 * The owner, 2026-08-24:
 *
 *   "I have a lot of ideas left to do on the digital client. The prio is still
 *    making the game system and all the cards function properly, but there are
 *    a lot of other things too. Instead of putting them in a text file, I want
 *    to give them to you to track and make a db of things to do with detail.
 *    That way, when there's down time, an agent could look to check something
 *    off."
 *
 * So: a text file is exactly what this must not be. Every entry below was
 * INTERVIEWED — the owner's own words are in `said`, and `means` is the
 * understanding they corrected me into. Several of my first guesses were
 * wrong (BL-20 was backwards, BL-16 was about the wrong screen, BL-24 turned
 * out to be a bug and not a feature at all), which is the whole reason the
 * interview happened and the reason `said` is kept verbatim: when an agent
 * disagrees with `means`, `said` is the tiebreaker, not this file's author.
 *
 * THE PRIORITY RULE
 *
 * Nothing in here outranks the card/engine work. `ledgers/card-todo.ts` is
 * the queue that matters; this is the queue for when that one is blocked or
 * the session is short. An agent picking work from here is choosing to do
 * something the owner wants but did not ask for TODAY — so it must be
 * genuinely finishable, which is what `size` and `deps` are for.
 *
 * WHAT KEEPS IT HONEST
 *
 * `backlog.test.ts` asserts, on every `npm run check`:
 *   1. ids and slugs are unique, and `deps` all resolve (no dangling, no cycles)
 *   2. every entry names at least one acceptance criterion in `doneWhen` —
 *      an entry nobody can tell is finished is a wish, not a task
 *   3. every path in `touches` still EXISTS on disk. This is the rot detector.
 *      Files move; an entry that points at a file that is gone is lying about
 *      where the work is, and the suite says so by name.
 *   4. nothing is `done` without `evidence` — a commit AND a guard test, the
 *      same rule `playtest-ledger.ts` runs after reports #10 and #28 taught it
 *      that "done" in a commit message is not done.
 *   5. an entry with open `asks` is not `active` — you cannot be building
 *      something whose design question the owner has not answered.
 *
 * THE SECOND PASS — 2026-08-25
 *
 * The 29 questions this file was carrying in `asks` were put to the owner in
 * writing, and all 29 came back answered. Every one has moved out of `asks`
 * and into `decided`, carrying his verbatim words and that date — the answer
 * sheet itself was a file in ~/Downloads that is not in the repo and will not
 * survive, so these entries are now the only record of it.
 *
 * Three things from that pass are worth knowing before you read on:
 *
 *   - Four answers created work that had no entry: BL-26 and BL-27 (make the
 *     timers optional and configurable, THEN make running out of time lose the
 *     game), BL-28 (name-claiming is wrong for a public deploy), and BL-29
 *     (spectators and replays, which he split off from tournaments by name).
 *   - One answer corrected THIS FILE. BL-04's question stated that the 40:00
 *     chess clock already exists per room. It has been 60 minutes since
 *     2026-08-20, and the owner said so. Checked against `CLOCK_START_MS` in
 *     server/rooms.ts, which is where the number actually lives.
 *   - One answer knocked the ground out from under an entry. Asked whether
 *     docs/07 was still the visual brief, he answered "I don't know what
 *     docs/07 is". BL-09 is re-framed rather than quietly kept or quietly
 *     dropped — read the entry.
 *
 * SCOPE, AS OF THE INTERVIEW
 *
 * The single most important thing established: **the target is a public
 * deploy**, not the two-player LAN box the older notes describe. Free, no
 * economy, no monetization, funded by the owner, existing so people can play
 * online without Tabletop Simulator and so newcomers can be taught. It should
 * push players toward buying the physical game, or at least the cheap
 * print-and-play, to support the creator. There is NO official client shipped
 * — the Steam page is an intent, not a product in development.
 */

/** which part of the tree the work lands in */
export type Area =
  /** the pure reducer: rules, cards, state */
  | 'engine'
  /** the browser client */
  | 'client'
  /** the node server: rooms, sockets, persistence */
  | 'server'
  /** accounts, profiles, stats, permissions */
  | 'accounts'
  /** organized play: queues, tournaments, cube */
  | 'play'
  /** teaching material: tutorials, challenges, docs */
  | 'teaching'
  /** not code: legal text, attribution, policy */
  | 'legal';

/**
 * Rough cost, in the only unit that matters here: can one agent finish it in
 * one sitting?
 *   S  — one sitting, one or two files
 *   M  — one long sitting, several files, needs its own tests
 *   L  — multiple sessions; needs a design pass before code
 *   XL — a project. Do not start one of these off the back of "down time".
 */
export type Size = 'S' | 'M' | 'L' | 'XL';

export type Status =
  /** nobody has started it */
  | 'open'
  /** somebody is on it right now — say who/when in `notes` */
  | 'active'
  /** shipped, with `evidence` */
  | 'done'
  /** decided against; `notes` must say why */
  | 'dropped';

export type Track =
  /** the owner's "small QoL or UX" list — friction in a client that works */
  | 'qol'
  /** the owner's "ideas left to do" list — things that do not exist yet */
  | 'feature';

export interface Entry {
  /** stable handle. Never renumber: other files and commit messages cite these. */
  id: string;
  /** kebab-case name, unique, for greps and branch names */
  slug: string;
  title: string;
  area: Area;
  size: Size;
  status: Status;
  track: Track;
  /**
   * THE OWNER'S OWN WORDS, verbatim from the 2026-08-24 interview (or the
   * original list line where they did not elaborate). Never paraphrase in
   * here — `means` is where interpretation goes. When the two disagree, this
   * one wins.
   */
  said: string;
  /** the settled understanding, after the owner corrected the first guess */
  means: string;
  /**
   * How a human tells it is finished, in the running client. Not "the code is
   * written" — what they can see or do that they could not before.
   */
  doneWhen: readonly string[];
  /** decisions already made, recorded so nobody re-opens them */
  decided?: readonly string[];
  /** genuinely open design questions. An entry with these cannot be `active`. */
  asks?: readonly string[];
  /** ids that must be `done` first */
  deps?: readonly string[];
  /**
   * Where the work lands. REPO-ROOT-RELATIVE paths, and the test asserts every
   * one exists — so this doubles as the rot detector when files move.
   */
  touches: readonly string[];
  notes?: string;
  /** required once `status: 'done'` */
  evidence?: { commit: string; guards: readonly string[] };
}

export const BACKLOG: readonly Entry[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // FEATURES — the "ideas left to do" list
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'BL-01',
    slug: 'matchmaking-queue',
    title: 'Matchmaking queue — find a game without trading links',
    area: 'play',
    size: 'M',
    status: 'done',
    evidence: {
      commit: 'cd0ba8b',
      guards: [
        // the server scripts run through the suite runner — see BL-24's row
        'suite.test.ts::test-queue.ts — two players land in ONE room with no link passed',
        'suite.test.ts::test-queue.ts — queueing signed out is refused WITH A SENTENCE',
        'suite.test.ts::test-queue.ts — constructed without a deck likewise',
        'suite.test.ts::test-queue.ts — disconnecting leaves no ghost entry',
        'suite.test.ts::test-queue.ts — a decline puts the other one back in line',
        'suite.test.ts::test-queue.ts — an unanswered offer lapses on its own',
        // the rule the whole "ranked" promise rests on
        'suite.test.ts::test-queue.ts — a player who has waited out their band cannot drag a NEWCOMER outside theirs',
        'suite.test.ts::test-queue.ts — the clock is the FORMAT default, not either player\'s picker',
        // the client half
        '279-queue-and-rating.test.ts::BL-01 \u00a71 an empty queue is an invitation, and a real one is a count',
        '279-queue-and-rating.test.ts::BL-01 \u00a72 constructed needs a deck; draft does not',
        '279-queue-and-rating.test.ts::BL-01 \u00a73 the matchmade clock matches the UI\'s per-format defaults',
        '279-queue-and-rating.test.ts::BL-01 \u00a74 the home screen shows the queue, and the post-game button is alive',
      ],
    },
    track: 'feature',
    said: 'Matchmaking and ELO/rankings',
    means:
      'A "Find a game" queue on the home screen. A signed-in player joins the queue for a '
      + 'format; when two are waiting the server creates the room outright and pushes both '
      + 'clients into it — the same move `rooms.ts` already makes for a rematch, so a late '
      + 'clicker follows rather than starting a second room. This replaces link-sharing as '
      + 'the normal way to start a game against a stranger; codes stay for playing a friend.',
    doneWhen: [
      'Home screen has a queue button per format (constructed, draft) that a signed-in player can join and leave',
      'Two players in the same queue land in the same room without either one sending a link',
      'Leaving the page or disconnecting removes you from the queue — no ghost entries pairing with nobody',
      'Queueing while signed out is refused with a reason, not silently broken',
    ],
    decided: [
      'Queue AND rating AND leaderboard are all wanted (owner, 2026-08-24) — the queue is this entry, the rating is BL-02',
      'Accounts are required to queue: playing signed out already records nothing (see server/accounts).',
      '\u26a0 THE FIRST-COME DECISION WAS SUPERSEDED, 2026-09-02. It used to read: "Pairing is FIRST-COME, not rated. Owner, 2026-08-25: \'For now, anyone with anyone. If we get enough oplayers to be picky, we can do that later.\' — build strictly first-two-in-line ... do not build the widening-search version now." The owner reopened it himself: "Choose of you want ranked (pairs you only with people close enough to your ELO) or whoever\'s open (with whoever, but it does change your elo)". So BOTH exist, and \u2014 the part that is easy to miss \u2014 the open queue is RATED TOO. There is no unrated way to queue.',
      'The scope, in the owner\'s words, 2026-09-02: "Just a way to enter the queue and get into games with someone you don\'t actually know. It should have a basic ELO system, which just helps to pair people with at least partially similar skill levels." — "basic" and "at least partially similar" are the brief; this is not a rating system to be defended, it is a way to avoid handing a beginner to somebody 600 points above them.',
      'Constructed is offered only with a deck. Owner, 2026-09-02: "constructed is only an option if you have at least 1 deck in your deck list". \u26a0 The gate is at QUEUE time and not at join time, which is stricter than the home screen\'s: a matchmade constructed game DEALS the moment both sides accept, so there is no deck-picker lobby to fall back into.',
      'The count is on the home screen. Owner, 2026-09-02: "you should also be able to see, easily, if/how many people are in the queue at a glance from the homepage." Served by an UNAUTHENTICATED /api/queue, because "is anybody around?" is asked before deciding whether signing in is worth it.',
      'FORMATS: constructed and live draft only (2026-09-02). The shared-pool deal stays link-only and is never rated.',
      'THE BAND WIDENS rather than refusing (2026-09-02): \u00b1100 \u2192 \u00b1150 (0:30) \u2192 \u00b1200 (1:00) \u2192 \u00b1300 (2:00) \u2192 anyone (3:00). Chosen over a hard cap because on this population a cap is just a queue nobody leaves. "Ranked" means it tried hard, not that it refuses.',
      'A 10-SECOND ACCEPT PROMPT, both sides (2026-09-02), chosen over dropping people straight in — so nobody who wandered off hands a stranger a dead game. Whoever accepts and is let down goes back in line with their ORIGINAL wait; the flaker is dropped.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/server/queue.ts',
      'client/server/main.ts',
      'client/server/rooms.ts',
      'client/server/test-queue.ts',
      'client/ui/queue.ts',
      'client/ui/main.ts',
      'client/ui/postgame.ts',
    ],
    notes:
      'DONE 2026-09-02. The prior art this entry named was the right prior art: `createMatch` in '
      + 'rooms.ts is `createRematch` with three changes, and it stamps `room.users` before '
      + 'either client connects for the same reason \u2014 a player who accepts and then closes the '
      + 'tab must not leave a game belonging to nobody.\n\n'
      + 'ONE POOL PER FORMAT, NOT TWO. The obvious build is a ranked pool and an open pool, '
      + 'which is FOUR half-empty pools across two formats. Instead the mode is a property of '
      + 'the ENTRY and two players pair iff every constraint EITHER imposes is satisfied: open '
      + 'imposes nothing, ranked imposes its current band. A ranked and an open player pair the '
      + 'moment the open one falls inside the ranked one\'s window \u2014 which costs the open player '
      + 'nothing (they said anyone) and costs the ranked player nothing (it is inside the window '
      + 'they were shown).\n\n'
      + '\u26a0 THE BAND IS CHECKED AGAINST BOTH SIDES, and this is the one thing here that a '
      + 'plausible implementation gets wrong. Checking only the searching player\'s band keeps '
      + 'the promise for exactly one of the two: the other, who was just shown "searching '
      + '\u00b1100", is handed somebody 400 points away and has no way to know. test-queue.ts \u00a72 '
      + 'asks it from both directions and reddens when the check is one-sided.\n\n'
      + '\u26a0 A MATCHMADE ROOM IGNORES BOTH PLAYERS\' CLOCK PICKERS. `chosenClockMs()` reads THAT '
      + 'browser\'s `algoClockMs`; letting it win would mean one stranger\'s "Off" handed the '
      + 'other an untimed RATED game, which silently disables BL-27 \u2014 the only thing making a '
      + 'stalled rated game end in a result. `MATCH_CLOCK_MS` in rooms.ts is the server\'s own '
      + 'table (45m / 60m), and 279 \u00a73 locks it to the UI\'s copy because the bundle cannot '
      + 'import from server/ and two copies of a number is what rots.\n\n'
      + 'THE TRANSPORT DOES THE WORK for "disconnecting removes you". There is one way a socket '
      + 'ends; the close handler dequeues. It is not a rule anybody has to remember to apply at '
      + 'each of the ways a player can go away.\n\n'
      + '\u26a0 A QUEUEING SOCKET IS IN NO ROOM, and nothing on this server could describe one: '
      + '`conns` gets an entry on JOIN and every entry carries a room. Hence a third map beside '
      + '`conns` and `watching`, and hence the queue message being handled ABOVE the join branch '
      + '\u2014 everything below it either names a room or reads `conns`. Same reasoning BL-29 used '
      + 'for keeping watchers out of `conns`.\n\n'
      + 'The tick hangs on BL-27\'s existing 1s sweep rather than adding a timer: it wants the '
      + 'same cadence (band widening, the accept countdown) and inherits that comment\'s '
      + '`.unref()` argument, without which the suite hangs on every one of the thirty servers '
      + 'it spawns.',
  },
  {
    id: 'BL-02',
    slug: 'elo-and-leaderboard',
    title: 'Elo ratings and a leaderboard',
    area: 'accounts',
    size: 'M',
    status: 'done',
    evidence: {
      commit: 'cd0ba8b',
      guards: [
        'suite.test.ts::test-elo.ts — everybody starts at 1000',
        'suite.test.ts::test-elo.ts — an even first game is symmetric',
        'suite.test.ts::test-elo.ts — K settles on exactly the game you go public',
        'suite.test.ts::test-elo.ts — a game the matchmaker did not make does NOT count',
        'suite.test.ts::test-elo.ts — a game both seats abandoned moves nobody',
        'suite.test.ts::test-elo.ts — no stamped winner + a diverged replay is UNKNOWN, not a loss',
        'suite.test.ts::test-elo.ts — ratings are PER FORMAT',
        // \u2b50 the reproducibility claim, which is the entry's whole point
        'suite.test.ts::test-elo.ts — 40 shuffles of the same games give byte-identical ratings',
        'suite.test.ts::test-elo.ts — rebuilding twice more does not move it \u2014 a fold, never an increment',
        'suite.test.ts::test-elo.ts — but not publicly listed yet \u2014 1 rated game, and it takes 5',
        '279-queue-and-rating.test.ts::BL-02 \u00a74 the queue explains what is rated, where it is claimed',
      ],
    },
    track: 'feature',
    said: 'Matchmaking and ELO/rankings',
    means:
      'A rating on each account, updated per finished game, and a public leaderboard. It '
      + 'must be computed the way everything else in the accounts layer is computed: as a '
      + 'pure fold over the saved games, from the STAMPED winner, never incremented in '
      + 'place. That is the load-bearing design fact of server/stats.ts and the reason '
      + 'changing how a stat counts is a `--force` reseed rather than a hand edit.',
    doneWhen: [
      'Every account shows a rating on its profile',
      'A leaderboard page ranks accounts, and says how many games back the rating goes',
      'Re-running the seed/rebuild reproduces the exact same ratings from the game files — no drift',
      'A game with no stamped winner and a diverged replay does NOT move anybody\'s rating (it is unknown, not a loss)',
      'A new account starts at 1000, can see its own standing immediately, and is absent from the PUBLIC leaderboard until its 5th rated game',
      'A game both seats abandoned (`finished: false`, no stamped winner) moves nobody\'s rating and is not counted as a loss for either side',
    ],
    decided: [
      'Ratings are per format (constructed vs draft rated separately) — one number across formats would be misleading given draft decks are random.',
      'Rating comes from the stamp, not from replaying the log: old logs diverge on newer engines (this already burned 5 of the first 8 games).',
      'Start at 1000; public after 5 rated games. Owner, 2026-08-25: "I think standard is to start with 1000 elo. Someone can always see where they are on the leaderboard, but don\'t appear publically until 5 rated games are finished." — the rating exists and moves from game 1 and the player can always see their own position; it is the PUBLIC listing that waits for the 5th finished rated game.',
      'A doubly-abandoned game counts as nothing. Owner, 2026-08-25: "Both players abandon? Just don\'t count it. But we\'ll make the timer actally cause a game loss before launching to prevent BMing." — server/history.ts already lands these as `finished: false`, so the fold skips them. The second half of that answer is not this entry: it is BL-27, and once it lands, a player who walks away from a running clock loses rather than producing one of these. (BL-27 DID land, 2026-09-01, so a walk-away now stamps a loss and this clause covers only the honest "we both had to go".)',
      '\u2b50 ONLY QUEUE GAMES ARE RATED (2026-09-02). This entry never said which games count, and the answer is not "all of them": two friends passing a room code can trade wins, which is harmless while it moves a stat sheet and is not harmless once it moves a public ladder. So `Room.rated` is set by the matchmaker and by nothing else. Link rooms, rematches, hotseat, sandbox and signed-out play stay unrated and go on counting for stats and achievements exactly as before.',
      'BOTH QUEUE MODES MOVE THE RATING. Owner, 2026-09-02, on the open queue: "with whoever, but it does change your elo". There is no unrated way to queue, and the two modes move it identically \u2014 only who you are handed differs.',
      'K IS 40 WHILE PROVISIONAL AND 20 AFTER, stepping at the FIFTH rated game \u2014 the same game the owner\'s rule makes you publicly listed. One threshold doing both jobs: a new rating finds its level while nobody is looking at it and stops swinging on the game it goes public.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/server/rating.ts',
      'client/server/history.ts',
      'client/server/accounts.ts',
      'client/server/api-accounts.ts',
      'client/server/test-elo.ts',
      'client/ui/account.ts',
    ],
    notes:
      'DONE 2026-09-02, alongside BL-01.\n\n'
      + '\u26a0 THE NOTE BELOW THIS ONE WAS WRONG, and usefully so. It said ratings "can be '
      + 'computed from games already on disk" and to ship this first if the queue stalled. Once '
      + 'only QUEUE games are rated that stops being true \u2014 there is nothing on disk to compute '
      + 'from \u2014 and the consolation is much better than the plan: THE MIGRATION PROBLEM '
      + 'DISAPPEARS. Every rated game will have been created by this code, so none of the '
      + 'diverged-old-log hazard that shaped the rest of stats.ts (five of the first eight games) '
      + 'reaches the rating path at all. No backfill, no reseed, no `--force`.\n\n'
      + '\u26a0 THIS COULD NOT BE A `foldSeat` COUNTER, which is why rating.ts exists at all. '
      + 'Every other stat here is addition on ONE account; foldSeat never looks at the opponent. '
      + 'Elo is pairwise \u2014 what a win is worth depends on the other player\'s rating at that '
      + 'moment \u2014 so rebuildProfiles() runs a SECOND pass over the same history and writes both '
      + 'players together.\n\n'
      + '\u2b50 THE ORDER HAD TO BE TOTAL, AND `playedAt` IS NOT. Elo is path-dependent, so '
      + '"re-running the rebuild reproduces the exact same ratings" is a claim about the sort. '
      + 'Two games routinely share a timestamp (the seeder stamps fixtures in a loop; a fast '
      + 'rematch lands in the same millisecond), and Array.sort is only stable with respect to '
      + 'the order it was handed \u2014 which for store.history is insertion order and is not '
      + 'reproducible after a re-import. `code` breaks the tie. Sorting on playedAt alone passes '
      + 'every other assertion in test-elo.ts and fails the shuffle one, which is exactly why '
      + 'that assertion is there.\n\n'
      + 'THE PUBLIC-AFTER-5 RULE IS APPLIED IN THE ROUTE, NOT IN leaderboard(). Ranks are '
      + 'computed over everybody with a rated game and only the LISTING is cut, so the `you` row '
      + 'carries a rank that can exceed players.length. Filtering first and numbering afterwards '
      + 'would hand a hidden player a flattering rank among the people who are shown \u2014 and the '
      + 'owner asked for the opposite: "Someone can always see where they are on the '
      + 'leaderboard, but don\'t appear publically until 5 rated games are finished."\n\n'
      + 'One unrelated bug fixed in passing: ui/account.ts\'s tab router omitted \'decks\' from '
      + 'its allow-list, so the decks tab rendered the stats page.',
  },
  {
    id: 'BL-03',
    slug: 'single-player-challenges',
    title: 'Single-player challenges — simple scripted opponents',
    area: 'teaching',
    size: 'L',
    status: 'open',
    track: 'feature',
    said:
      'Against "real" opponents, but running a very simplified game plan. For example, one '
      + 'opponent could, in each haste, make an x/x unit where x is the turn number x2. They '
      + 'don\'t block ever and always attack all. Another could be similar, but it makes a '
      + 'unit during deployment which has a random attribute. Simple opponents like that. '
      + 'Probably easy to beat, but good for newer players of if you want to try out a '
      + 'constructed deck against something more than just a goldfish.',
    means:
      'NOT puzzles with a fixed board and a fixed goal, and NOT a real AI. A set of named '
      + 'opponents, each with a short, legible, deterministic game plan, that occupy the '
      + 'second seat of an otherwise normal game. Two the owner named outright: (a) each '
      + 'haste step, create an X/X where X = 2 × turn number; never blocks; always attacks '
      + 'with everything. (b) the same, but it creates its unit during deployment and the '
      + 'unit gets a random attribute. They are meant to be beatable. The value is that a '
      + 'newer player faces something that actually attacks, and a deckbuilder can test a '
      + 'constructed list against a real clock instead of goldfishing.',
    doneWhen: [
      'You can start a solo game against a named challenge opponent from the home screen, signed in or not',
      'At least the two opponents the owner described exist and behave exactly as described',
      'The opponent takes its turn through the same legalActions/apply path as a human seat — no engine-side special cases',
      'The game ends, scores, and reaches the post-game screen like any other game',
      'Adding a third opponent is a small self-contained file, not a refactor',
      'A finished challenge game records nothing — no stats, no achievements, no rating movement — exactly as signed-out play records nothing',
    ],
    decided: [
      'Opponents are scripted plans, not search or evaluation. "Probably easy to beat" is the intent, not a compromise.',
      'They are opponents in a normal game, not puzzle scenarios — the board starts empty.',
      'Challenge results are EXCLUDED from stats, achievements and rating. Owner, 2026-08-25, asked whether they should count or be excluded like signed-out play: "Excluded as well" — so a challenge game must not reach the stats fold at all, rather than reaching it and being filtered later.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/engine/src/apply.ts',
      'client/server/rooms.ts',
      'client/ui/main.ts',
    ],
    notes:
      'Doc 06 M5 lists "puzzle mode" — that is a DIFFERENT idea and the owner did not pick '
      + 'it. Do not quietly build puzzles instead. (The bot USED to carry puzzles/*.json for '
      + 'a "What\'s the play?" feature; the owner removed it on 2026-09-02 — "it never really '
      + 'worked and wasn\'t a great idea" — which is one more reason not to drift back into '
      + 'it here.) The seam to drive an opponent already exists: forcedAction() in apply.ts is '
      + 'drained by the server and the hotseat act(), never by the engine, and the reason is '
      + 'recorded — engine-side auto-anything broke 242 scripted tests once. A challenge '
      + 'opponent belongs on the SERVER side of that same seam.',
  },
  {
    id: 'BL-04',
    slug: 'tournaments',
    title: 'Tournaments — Swiss and exhibition pairings with standings',
    area: 'play',
    size: 'XL',
    status: 'open',
    track: 'feature',
    said:
      'A tournament allows many players to join and then does swiss (or exhibition) pairings '
      + 'for everyone for 1v1 games. It keeps standings updated and finds a winner. With '
      + 'Swiss, it\'d default to the number of rounds required to find a winner (but can be '
      + 'overridden by the organizer) and exhibition can be just a time limit or min number '
      + 'of games (exhibition, btw, is just where you play against the first avalible person, '
      + 'regardless of record. The goal is to get as many games in with unique people as '
      + 'possible.',
    means:
      'An event object that many players join and that pairs them into ordinary 1v1 rooms, '
      + 'round after round, tracking standings until it has a winner. Two pairing modes. '
      + 'SWISS: pair on record, default round count = the minimum needed to resolve a single '
      + 'winner, organizer may override. EXHIBITION: no records — you are paired with the '
      + 'first available person, and the goal is maximum games against UNIQUE opponents; it '
      + 'ends on a time limit or a minimum game count rather than on a bracket resolving.',
    doneWhen: [
      'An organizer can create an event, choose Swiss or exhibition, and share a join link',
      'Players join, and the event pairs them into real rooms they are pushed into — no link-passing between rounds',
      'Swiss: default round count is derived from the entrant count and the organizer can override it before it starts',
      'Exhibition: pairing prefers opponents you have not yet played, and the event ends on the configured time limit or game minimum',
      'A standings page updates live and names a winner at the end',
      'An odd entrant count is handled (bye) and a no-show does not wedge the round',
      'Standings break ties on opponents\' match win percentage',
      'A round deadline is expressed with the configurable timer from BL-26, and an expired game resolves by BL-27\'s rule instead of sitting unfinished forever',
    ],
    decided: [
      'Tournaments and cube are TWO features that overlap: cube (BL-05) reuses this pairing infrastructure but is not part of it.',
      'Games are ordinary 1v1 rooms — the tournament schedules them, it does not change how they play.',
      'Swiss tiebreak is OMW%. Owner, 2026-08-25: "OMW% is fine. Just standard stuff." — opponents\' match win percentage, computed the ordinary way; do not invent a house tiebreaker.',
      'THE CLOCK IS 60 MINUTES, NOT 40 — this entry\'s own question had it wrong. Owner, 2026-08-25: "Chess clock is actually 60. Timer going off will eventually lose the game. But we need to make timers optional and configurable first." VERIFIED against the code: `CLOCK_START_MS = 60 * 60 * 1000` in server/rooms.ts, changed from 40 minutes on 2026-08-20 after 40 ran out mid-playtest ("a draft game with real decisions wants an hour"). The question that said "The 40:00 chess clock already exists per room" was stale when it was asked.',
      'Round deadlines wait on two new entries, in the owner\'s stated order: BL-26 (timers optional and configurable) then BL-27 (running out loses the game). Neither existed when this entry was written; both were created by that answer.',
      'Spectators are wanted, but NOT as part of this. Owner, 2026-08-25: "We want to allow spectators and match replays, but that\'s its own feature, yes." — filed as BL-29. A tournament may link to it; it must not block on it.',
    ],
    asks: [],
    deps: ['BL-01'],
    touches: [
      'client/server/main.ts',
      'client/server/rooms.ts',
      'client/server/accounts.ts',
      'client/ui/lobby.ts',
      'client/ui/main.ts',
    ],
    notes:
      'XL — do not start this in a down-time slot. It needs a design pass first. Depends on '
      + 'BL-01 mostly for the "server pushes you into a room" machinery, which the queue '
      + 'builds and this one reuses per round.',
  },
  {
    id: 'BL-05',
    slug: 'cube-draft',
    title: 'Cube draft — pregame pod draft into a 30-card constructed tournament',
    area: 'play',
    size: 'XL',
    status: 'open',
    track: 'feature',
    said:
      'Cube draft would use the tournament infra to do pairings, but decks are made from '
      + 'drafting in a pod of all the players using a cube. By default, it\'s 5 chosen colors, '
      + 'all shuffled together into packs, but can also be overridden with a custom list or '
      + 'selecting more (or fewer) colors, which could allow duplicates. Players then build 30 '
      + 'card constructed decks and play a tournament together. ... yes, it\'s all done '
      + 'pregame. NOT a live draft. ... Default cube drafts are 4 packs of 10.',
    means:
      'A pregame drafting phase, structurally UNLIKE the existing live draft (which deals '
      + 'packs during each planning phase of a running game). Everyone in the pod opens a '
      + 'pack, picks, passes, until the packs are dry. Default: 4 packs of 10 per player, '
      + 'built from the 5 chosen elements shuffled together. The cube may instead be a custom '
      + 'list, and that list may itself contain duplicates. Then each player builds a 30-card '
      + 'deck. After that it is plain constructed — the pod plays a tournament (BL-04) with '
      + 'the decks they built.',
    doneWhen: [
      'An organizer can start a cube event, set the cube (default: chosen elements shuffled) and the pack structure (default 4 packs of 10)',
      'All players draft simultaneously in one pod, pack-passing, before any game starts',
      'If the cube has fewer cards than players × packs × pack size, the settings screen WARNS at configuration time',
      'A cube larger than needed just leaves cards undrafted — no error',
      'Each player builds a 30-card deck from their pool in a deckbuilder, and the deck locks',
      'The pod then plays a normal tournament with those decks',
      'Deckbuilding runs on a 10-minute default timer that the organizer can change or turn off',
      'A deck that is not a legal 30 cannot be submitted — the builder shows an error and keeps you there, rather than accepting it and fixing it later',
      'A cube list saves to the organizer\'s account like a deck, and can be picked again for a later event without re-entering it',
    ],
    decided: [
      'Pregame, not live. The existing in-game live draft is a different format and stays.',
      '30 cards is the constructed deck size for cube AND for normal constructed.',
      'Resources are NOT drafted. "Resources are a part of the base game that players always have access to. It\'s not like magic." Prismites/resources stay freely available exactly as they are now.',
      'Duplicates come from the CUBE LIST containing duplicates, not from the tool inventing them to fill packs.',
      'Default pack structure: 4 packs of 10.',
      'After deckbuilding, a cube draft is indistinguishable from normal constructed.',
      'Deckbuilding is timed, organizer-overridable, and an illegal deck is simply refused. Owner, 2026-08-25: "10 minutes to build is standard. Let the organizer configure and override things. Players just can\'t submit a non-legal deck. It should show an error." — 10 minutes is the DEFAULT, not the rule; the organizer configures it, the same way they configure everything else about the event.',
      'A cube list is saved to an account like a deck. Owner, 2026-08-25: "Save it like a constructed deck to the user\'s account." — it lives in the same locker as decks (BL-14) and is reusable across events, so it is not per-event configuration that has to be re-entered.',
    ],
    asks: [],
    deps: ['BL-04', 'BL-14'],
    touches: [
      'client/server/main.ts',
      'client/server/rooms.ts',
      'client/server/decks.ts',
      'client/server/trio.ts',
      'client/ui/lobby.ts',
      'client/engine/src/cards/registry.ts',
    ],
    notes:
      'Trap: the existing draft code is the LIVE draft (draftDeckList, draftCommit, packs '
      + 'refreshed every N+1 turns, redaction of your own pack during the draft step). Almost '
      + 'none of it transfers — this is a separate pregame pod draft. Reuse the deckbuilder '
      + 'from BL-14 rather than writing a second one. '
      + 'FOR INFORMATION, not an override: the printed manual (data/rules/Algomancy-Manual.txt, '
      + '"CUBE DRAFT") describes two procedures and the owner\'s default matches neither. '
      + 'ALGOMANCY CUBE DRAFT — deal each player a pack of 10, then 15 times over: draw 2 '
      + 'from the cube, combine hand with pack, choose 10, pass clockwise, until each player '
      + 'has 30. TRADITIONAL CUBE DRAFT — three packs of 13 to 15 (15 for 6 players, 13 for '
      + '8), pick and pass, alternating direction. The manual also sizes the cube at 320 '
      + 'cards from one box, 640 for groups larger than 8. The owner said "4 packs of 10" '
      + 'and that is the default this entry builds; the manual\'s two are worth offering as '
      + 'presets, and are part of why the pack structure has to be configurable at all.',
  },
  {
    id: 'BL-06',
    slug: 'test-mode',
    title: 'Test mode — solo sandbox with any card, any mana, 1000 life',
    area: 'client',
    size: 'M',
    status: 'done',
    track: 'feature',
    said: 'Test mode (summon any card, make any mana, no opponent, 1000 life)',
    means:
      'A solo sandbox room: no opponent, 1000 life, spawn any card from the full registry '
      + 'into hand or straight onto the board, mint any mana or affinity at will, move freely '
      + 'between phases. The rules still apply to what you have summoned — the cheat is in '
      + 'getting the board set up, not in how it then behaves. Two uses, and the owner named '
      + 'both: testing the engine, and card interaction exploration — "you can see how cards '
      + 'interact, try new combos and such".',
    doneWhen: [
      'A test-mode room can be started from the home screen and needs no second player',
      'You can search the whole card registry by name and put a chosen card into your hand, your board, or your bin',
      'You can set your mana/affinity to anything, and your life is 1000',
      'You can advance or jump phases without needing a legal action',
      'Cards summoned this way behave under normal rules — triggers fire, statics apply, combat resolves',
      'Nothing from test mode is recorded to account stats or the metagame',
      'The SECOND seat can be stocked the same way — cards, mana, life — so an interaction across the table can be set up and run',
      'The opponent\'s side can be driven from a second tab rather than crowding both boards\' controls onto one screen',
    ],
    decided: [
      'It is a sandbox for exploration as much as a debug harness — the UI should be usable by a player, not just by an agent.',
      'Open to everyone on a public deploy — no flag, no badge. Owner, 2026-08-25, asked whether it should be gated: "Yes, for anyone."',
      'The sandbox is TWO-SIDED, and the second side gets its own tab. Owner, 2026-08-25: "Yes, you should be able to contruct game states and test things. Maybe allowing players to open the opponent\'s side in another tab would be great for that and keep the interface less cluttered." — so the second seat is a real seat you can also stock, and the preferred UI is a second tab/window driving it, precisely to keep one screen from carrying two sets of cheats. Treat the tab as the owner\'s suggestion ("maybe") rather than a hard requirement, but the two-sided part is not optional.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/engine/src/types.ts',
      'client/engine/src/apply.ts',
      'client/engine/src/engine.ts',
      'client/server/scenarios.ts',
      'client/server/rooms.ts',
      'client/server/main.ts',
      'client/server/test-sandbox.ts',
      'client/server/suite.test.ts',
      'client/ui/sandbox.ts',
      'client/ui/main.ts',
    ],
    notes:
      'Design constraint worth respecting: the engine is a pure reducer and its purity is '
      + 'why replay, undo and the fuzzer all work. Test-mode cheats should be ACTIONS in the '
      + 'log (a `sandboxSpawn` action, say), gated to sandbox rooms — not out-of-band state '
      + 'mutation, which would break replay for the one mode most likely to be used to '
      + 'reproduce a bug report.\n\n'
      + 'BUILT THAT WAY, and the note was right twice over. Four actions — `sandboxSpawn`, '
      + '`sandboxResources`, `sandboxLife`, `sandboxAdvance` — each refused unless '
      + '`GameState.sandbox` is true, and that flag is set at the DEAL and by nothing else, so '
      + 'no sequence of actions turns a real game into a sandbox.\n\n'
      + 'THE DECISION WORTH REMEMBERING: a sandbox room is SCENARIO-SHAPED. `dealScenario()` is '
      + 'its choke point too, and it rides on `Room.scenario`, so the four deal sites, the '
      + 'restore path, `replay-probe.ts`\'s refusal and the history/stats exclusion are all '
      + 'inherited rather than answered a second time — the exclusion is at the SOURCE for the '
      + 'same reason R216 put it there. It is deliberately NOT in `SCENARIOS`: every member of '
      + 'that record is a card under test with an `expect` line and a verdict bar, and a '
      + 'sandbox has none of those. `isDealId` is the one-line seam.\n\n'
      + '`sandboxAdvance` does not assign `phase` — `Scenario.prologue` already records why — '
      + 'it takes the real step-closing actions for both seats out of `legalActions`, and stops '
      + 'on a decision rather than answering it for the human. Seat 1 is driven by R216\'s '
      + 'scripted opponent while nobody is sitting in it, which is what makes the room solo, '
      + 'and it goes quiet the moment the second tab opens.\n\n'
      + 'The UI is TWO LINES in main.ts: `ui/sandbox.ts` paints outside #app, injects its own '
      + 'styles, claims its clicks with `data-sbx`, and repaints off a MutationObserver rather '
      + 'than a render hook — the home-screen launcher is appended to the "On your own" row by '
      + 'that same observer, so `renderHome()` never learns the file exists. Its card search is '
      + '`ui/cardsearch.ts` over an unfiltered pool (BL-25\'s note asked for exactly that) '
      + 'intersected with `allCardNames()`, which is what `sandboxSpawn` will actually accept.\n\n'
      + 'THE TWO CLASS GUARDS THAT CAUGHT THE FIRST DRAFT, both worth knowing about before '
      + 'writing any zone-entry code: `152-hand-entry` (R179) refuses a bare `hand.push` outside '
      + '`E.toHand`, and `90-coverage-census` (R145/R40) refuses a bare `bin.push` outside '
      + '`E.toBin`. Both were right. So a summon into a hand fires `handEntered` — the three '
      + '"whenever cards enter a player\'s hand during battle" cards see it, which is the "and '
      + 'then it behaves under normal rules" line working. Both methods gained a `from: '
      + '\'sandbox\'` zone, because a summon comes from outside the game and `\'deck\'` would '
      + 'have been a lie in a saved log forever. ⚠ In `toBin`, `\'sandbox\'` joins `\'stack\'` '
      + 'as a NON-trashing entry: placing a card in a bin must not fire "when I am trashed" for '
      + 'a card that was never anywhere. Also worth knowing: `244-log-is-not-the-only-surface` '
      + 'pins a census of every engine announcement (193 → 199 here), and `256-cost-toasts` '
      + 'reads that number out of 244\'s source.\n\n'
      + 'STILL OPEN, for the owner: local hotseat has no server room and so no sandbox. Test '
      + 'mode is network-room-only, which was the obvious default — say if hotseat should get '
      + 'it too.',
    evidence: {
      commit: 'f0c92ab',
      guards: [
        'client/engine/test/274-sandbox.test.ts::\u00a71 every sandbox action is REFUSED in an ordinary game (the negative control, with its list of cheats DERIVED from types.ts)',
        'client/engine/test/274-sandbox.test.ts::\u00a74 a unit summoned this way fires its spawn trigger, minted mana pays a real cost, and combat resolves',
        'client/engine/test/274-sandbox.test.ts::\u00a75 the same sandbox log replays to the same board',
        'client/engine/test/275-sandbox-panel.test.ts::the panel installs, is fail-closed without the server-pushed flag, and needs one import and one call in main.ts',
        'client/server/suite.test.ts::test-sandbox.ts \u2014 the open route, the wire-level refusal in an ordinary room, the byte-identical rebuild across a server restart, and the history fold skipping it at the source',
      ],
    },
  },
  {
    id: 'BL-07',
    slug: 'multiplayer',
    title: 'Multiplayer — more than two seats, FFA and teams',
    area: 'engine',
    size: 'XL',
    status: 'open',
    track: 'feature',
    said: 'Multiplayer',
    means:
      'Games with more than two players: free-for-all and teams, which is what Algomancy '
      + 'actually is at a table. The engine currently assumes two seats in load-bearing '
      + 'places — the region model, initiative, and the 1v1 counterattack rule all encode '
      + 'it. This is the largest engine item on the list.',
    doneWhen: [
      'A game can be created with 3+ seats, FFA or teams',
      'Regions/adjacency are correct for the table size — each pair of neighbours has its shared space',
      'Attack declaration and the counterattack work with more than one possible defender',
      'Initiative and turn order are correct for N players',
      'The fuzzer runs clean at 3 and 4 seats (6+ is a later look — owner, 2026-08-25)',
      'Per-seat redaction is still leak-free with more than one opponent',
      'FFA has NO counterattack, and the client does not offer one',
      'FFA attacks are declared simultaneously and revealed at once — the commit-reveal the deployment phase already does at 1v1',
      'Priority passes CLOCKWISE from the player nearest the initiative player, not back and forth',
      'Two players attacking the same player produces ONE battle in that region with all three participating',
      '2v2 resolves battles region by region: NIT regions first, then IT regions, each clockwise from the IT player',
    ],
    decided: [
      'Both FFA and teams are wanted.',
      'Build 3 and 4 seats first. Owner, 2026-08-25: "Start with 3 and 4. If it all works we can look into doing larger tables." — 6+ is explicitly a later look, so the fuzzer criterion for THIS entry stops at 4. BL-08 (pacing) still talks about 6, because that is the size where the pacing problem bites.',
      'Teams means 2v2. Owner, 2026-08-25: "Team drafting is just 2v2 and has special rules." — note he answered about team DRAFTING. The manual lists team setups as "2v2 or 3v3, can be played either as split teams (multiple regions) or joint players sharing a single region", but 3v3 is six seats, which the same day\'s answer defers. So: 2v2 now, arbitrary splits not now, and the "special rules" of team draft belong to BL-05\'s neighbourhood rather than here (manual: each team brings one 30-card-per-player constructed deck with up to 2 copies of a card, and live-drafts from it during the game).',
      'THE MULTIPLAYER COMBAT RULES ARE PRINTED, AND THEY ARE DETAILED. Owner, 2026-08-25, asked whether the 1v1 counterattack generalises: "It\'s all in the manual and fairly detailed." Checked — data/rules/Algomancy-Manual.txt, the "_ MULTIPLAYER" spread. It does not generalise; it depends on the format. Every line below this one is quoted from that spread, so nobody has to go hunting for it — but go and read it anyway before designing any of this.',
      'FFA HAS NO COUNTERATTACK. Manual: "The FFA battle structure is simpler than the teams/1v1 structure since there is no attack/counter-attack", and again in a note: "There are no counterattacks in FFA, which gives this format a different feel to teams/1v1." After a simultaneous attack declaration, each region runs: attacker sets units into Formation → priority window → defender sets blocking formation → priority window → Combat Step, all units in formation dealing damage simultaneously → one last after-combat priority window before Regroup.',
      'FFA ATTACKS ARE COMMIT-REVEAL. Manual, "INTENT CARDS": "In FFA, players declare their attacks simultaneously by placing intent cards face down in front of each of their units and other cards such as spell tokens with their intended action. Once all players have finished this, all of the cards are flipped up and the chosen attacks take place instantly!" Units may be grouped behind one intent card. This is the same shape as the simultaneous hidden deployment the engine already implements (deployDone[]/deploySnapshot).',
      'TEAMS KEEP THE 1v1 FLOW, ACROSS SEVERAL REGIONS AT ONCE. Manual, "TEAM BATTLE STRUCTURE": "The battle structure in team games is identical to that of 1v1, meaning it has the same attack-counter attack flow to it. The only difference is that now, attacks and blocks take place across multiple regions, so there are multiple separated priority windows to resolve between each step." In 2v2 there are two NIT and two IT regions; IT declare their attacks all at once into multiple regions, priority resolves in each NIT region clockwise from the IT player, NIT declare blocks AND counterattacks all at once into multiple regions, then each region resolves its own priority/damage/after-damage windows — NIT regions finish first, then IT regions, each in clockwise order from the IT player.',
      'PRIORITY GOES ROUND, NOT BACK AND FORTH. Manual, "MULTIPLAYER PRIORITY": "The stack functions identically in 3 player situations as it does in 1v1, but priority is passed in a circle instead of back and forth. The player closest to the initiative player in a clockwise direction gains priority first and priority is passed from that player clockwise during each priority window."',
      'THREE PLAYERS IN ONE REGION IS A REAL CASE, not an edge case. Manual: when two players attack the same player, all three take part in that battle together in one region; the defender defends against both incoming formations and all three players may interact with each other and their units there. The manual warns that symmetric effects get extremely powerful in that situation.',
      'FFA IS SIMULTANEOUS OUTSIDE BATTLE. Manual, "SIMULTANEOUS TURNS": every phase other than battle can be completed by all players at once — resources in planning, units in deployment — with a clockwise-from-initiative fallback for players who are learning or playing competitively. That fallback is worth building as an option, not just the fast path.',
      'Team initiative is per TEAM. Manual: whichever team holds the initiative token has the initiative, and teams act together — in deployment a team deploys in any order it likes before passing to the other team.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/engine/src/engine.ts',
      'client/engine/src/types.ts',
      'client/engine/src/apply.ts',
      'client/server/view.ts',
      'client/server/rooms.ts',
      'client/ui/main.ts',
    ],
    notes:
      'doc 06 M5 already lists "FFA intents (commit-reveal); teams" as beyond-v1 work — and '
      + 'the manual confirms that framing exactly: FFA really is intent cards flipped at '
      + 'once. READ THE MANUAL BEFORE DESIGNING ANY OF THIS: data/rules/Algomancy-Manual.txt, the '
      + 'pages headed "_ MULTIPLAYER" (grep for "FREE FOR ALL" and "TEAM BATTLE STRUCTURE"). '
      + 'It answers the region/priority/counterattack questions this entry used to be '
      + 'blocked on, and the answers are in `decided` above verbatim. '
      + 'Related but separate: BL-08, keeping a big table fast.',
  },
  {
    id: 'BL-08',
    slug: 'large-table-pacing',
    title: 'Large tables that do not take forever',
    area: 'engine',
    size: 'L',
    status: 'open',
    track: 'feature',
    said:
      'I\'d also like to make it playable with very large tables without taking forever, but '
      + 'that seems hard to implement honestly.',
    means:
      'The pacing problem specific to big multiplayer games: with six seats, a strictly '
      + 'sequential priority/turn structure means five people wait while one plays. The '
      + 'answer is almost certainly simultaneity rather than speed — parallel planning and '
      + 'deployment, commit-reveal intents, batching windows nobody actually wants to act in '
      + '— not making individual turns faster. The owner flagged it as hard, and it is.',
    doneWhen: [
      'A 6-player game spends most of its wall clock with most seats ABLE to act, measurably — instrument it before and after',
      'No player is idle for a full round without a reason they can see',
      'Simultaneity does not create information leaks or non-determinism — the fuzzer and replay stay clean',
    ],
    decided: [
      'This is a separate entry from BL-07 on purpose: multiplayer can ship correct-but-slow first, and should.',
      'There is no target yet, and that is the answer. Owner, 2026-08-25, asked whether there is a table size where slow is acceptable or whether 6 should feel like 2: "No idea yet, tbh." — so the instrument-first acceptance criterion stands. Measure a 6-player game, show the numbers, and ask again with data rather than picking a target now.',
      'The manual makes the target easier than it looks: outside battle, FFA phases are meant to be played by everyone at once (data/rules/Algomancy-Manual.txt, "SIMULTANEOUS TURNS"). Parallel planning and deployment are the PRINTED rule, not an optimisation this entry has to justify.',
    ],
    asks: [],
    deps: ['BL-07'],
    touches: [
      'client/engine/src/engine.ts',
      'client/engine/src/apply.ts',
      'client/server/rooms.ts',
    ],
    notes:
      'Prior art already in the tree: simultaneous hidden deployment (deployDone[], '
      + 'deploySnapshot, viewFor(state, seat, frozenOpp)) is exactly this pattern working '
      + 'at 1v1. Generalizing IT is the most promising path, not inventing something new.',
  },
  {
    id: 'BL-09',
    slug: 'docs-07-reconcile',
    title: 'docs/07 is not a brief — reconcile it with what shipped, and stop citing it',
    area: 'client',
    size: 'M',
    status: 'open',
    track: 'feature',
    said: 'Visual sprucing up',
    means:
      'THIS ENTRY CHANGED ON 2026-08-25 and the old version should not be resurrected. It '
      + 'used to be "finish the docs/07 visual redesign (R0–R5)", on the assumption that '
      + 'docs/07-visual-redesign.md was the owner\'s standing visual brief. Asked to confirm '
      + 'that, he answered "I don\'t know what docs/07 is". The doc is real — it is in the '
      + 'tree, dated 2026-07-17, and it says on its own first page that it is written from '
      + '"Bena\'s brief" — but it is an agent-authored spec he does not recognise as a thing '
      + 'he is waiting on, and its R0–R5 are therefore NOT sanctioned work. What is left is a '
      + 'documentation job: a spec nobody has read in a month, describing as pending things '
      + 'that shipped, is exactly the rot this backlog exists to catch. Mark what it is, '
      + 'reconcile it with the client that actually exists, and point the next agent at '
      + 'BL-10, which now carries the owner\'s real and much smaller visual brief.',
    doneWhen: [
      'docs/07 carries a status line saying it is a historical spec, when it was written, and that the owner did not recognise it as a current brief on 2026-08-25',
      'Anything in docs/07 that has since shipped is no longer described there as pending',
      'Any R0–R5 item that is still genuinely wanted is moved to BL-10 as a named sub-task, in the owner\'s terms — light, mostly non-gameplay — rather than left in a doc nobody is reading',
      'The per-phase layouts in layouts.json are actually used by the client, or the file is retired',
      'Nothing anywhere cites docs/07 as a source of pending requirements',
    ],
    decided: [
      'THE OWNER DOES NOT KNOW THIS DOCUMENT. Owner, 2026-08-25, asked whether docs/07 is still what he wants visually: "I don\'t know what docs/07 is." That is an answer, not a non-answer: it removes docs/07 as evidence of what he wants. Do not build R0–R5 off the strength of it.',
      'The real visual brief is BL-10\'s. Owner, 2026-08-25, in the very next question: "It\'s honestly pretty much, just some general light sprucing up is all that\'s needed. Mostly in non gameplay related areas." A ground-up client rebuild is not that.',
      'The entry is kept rather than dropped because the doc is still in the tree and still reads as a live plan. Deleting the entry would leave the misleading document behind with nobody assigned to it; that is how the last three "wait, is this still true?" surprises happened.',
      'Correction to this entry\'s own question, which said "~13 months after writing it": docs/07 is dated 2026-07-17 and came into the repo on 2026-08-18. It was about five weeks old when the question was asked, not thirteen months.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/docs/07-visual-redesign.md',
      'client/docs/09-visual-clarification.md',
      'client/ui/layouts.json',
      'client/ui/layout-editor.html',
      'client/ui/style.css',
      'client/ui/main.ts',
    ],
    notes:
      'The slug was `visual-redesign-r0-r5` until 2026-08-25 — grep for that if an older note '
      + 'or branch name cites it. The id is unchanged, as ids always are. '
      + 'Size dropped L → M with the scope: this is now a reconciliation pass over one doc '
      + 'plus a decision about layouts.json, not a client rebuild.',
  },
  {
    id: 'BL-10',
    slug: 'visual-polish',
    title: 'Visual polish pass — art, motion, typography, table',
    area: 'client',
    size: 'M',
    status: 'open',
    track: 'feature',
    said: 'Visual sprucing up',
    means:
      'The open-ended half. Card art presentation, animation on attack/damage/death, table '
      + 'texture and depth, readable typography and spacing. Split from BL-09 because that '
      + 'one had a written spec attached to it and this one is a judgement call each time. '
      + 'Since 2026-08-25 this is ALSO the whole of the visual brief: the owner asked for '
      + '"general light sprucing up", "mostly in non gameplay related areas", which is a much '
      + 'smaller thing than BL-09 used to imply.',
    doneWhen: [
      'A named, bounded improvement ships and the owner agrees it looks better — this entry never "completes", it gets re-opened',
      'The work lands in the non-gameplay screens first — home, lobby, account/profile, post-game — and does not re-open the table layout unless something there is actually unreadable',
    ],
    decided: [
      'No reference, no mood board, and the brief is small. Owner, 2026-08-25, asked whether there is a look he wants or whether "less programmer-art" is the whole brief: "It\'s honestly pretty much, just some general light sprucing up is all that\'s needed. Mostly in non gameplay related areas." — so: light, and aimed away from the play area. Do not read this as licence for a redesign, and do not go looking for one in docs/07 (see BL-09).',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/style.css',
      'client/ui/anim.ts',
      'client/ui/motion.ts',
      'client/ui/flash.ts',
    ],
    notes:
      'Standing entry — the right way to use it is to open a specific sub-task, do that, and '
      + 'leave this one open. Do not mark it done.',
  },
  {
    id: 'BL-11',
    slug: 'ui-tutorial',
    title: 'UI tutorial — teach the client to people who know Algomancy',
    area: 'teaching',
    size: 'M',
    status: 'open',
    track: 'feature',
    said:
      'The UI tutorial is meant for players that know algomancy but need to learn how to do '
      + 'things in this client.',
    means:
      'An interactive first-run walkthrough of the CLIENT ONLY. Assumes you know the game. '
      + 'Where your hand is, how to declare an attack and build a column, how to block, how '
      + 'to graft/augment with the mouse, what the auto-pass chip does, that right-click '
      + 'opens the inspector, where bins and erased cards live, how the clock works.',
    doneWhen: [
      'A new player can trigger the tutorial from the home screen and re-run it later',
      'It covers every interaction that is not discoverable by looking: column building, sends, grafting, auto-pass/auto-yield, undo, the report button',
      'It does not teach rules — that is BL-12',
      'Skipping it is one click and it does not nag',
      'It is a played scripted game, not an overlay on the live client',
      'It walks the owner\'s whole checklist: planning, priority passing, yielding, modding, using the bin, multiple targets, complicated graft effects, attacks and counterattacks, and bringing spell tokens along',
    ],
    decided: [
      'This and learn-to-play (BL-12) are distinct: this one is client-only.',
      'A SCRIPTED QUICK GAME, not coach-marks. Owner, 2026-08-25, given both options: "Scripted quick game that shows how to do the actions and how cards work is fine. Make sure they understand planning, priority passing, yielding, modding, using the bin, multiple targets, complicated graft effects, attacks/counter attacks, bringing along spell tokens, etc." — the second sentence is a content checklist and it is now in `doneWhen` line by line.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/main.ts',
      'client/ui/glossary.ts',
      'client/ui/index.html',
    ],
    notes:
      'FLAG, raised 2026-08-25 rather than resolved: the owner\'s checklist crosses the line '
      + 'this entry drew between itself and BL-12. "Make sure they understand planning, '
      + 'priority passing ... attacks/counter attacks" is understanding the GAME, which the '
      + 'entry says explicitly is BL-12\'s job ("It does not teach rules — that is BL-12"). '
      + 'The reading that fits both: teach every item on the list AS AN INTERACTION — where '
      + 'you click to pass priority, how you set up a graft, how a spell token comes along — '
      + 'and leave WHY you would to BL-12. If you cannot do one without the other for a '
      + 'given item, build it once, here, and have BL-12 reuse it rather than repeat it.',
  },
  {
    id: 'BL-12',
    slug: 'learn-to-play',
    title: 'Learn to play — the UI tutorial plus the actual game, via a contrived game',
    area: 'teaching',
    size: 'L',
    status: 'open',
    track: 'feature',
    said: 'And learn to play is the UI PLUS actual game functions with a contrived game of some kind.',
    means:
      'The full onboarding for someone who has never played Algomancy: everything BL-11 '
      + 'teaches, plus the rules and concepts — affinity, elements, the planning/battle/'
      + 'regroup/deployment cycle, why the counterattack exists, what grafting is — taught '
      + 'through a CONTRIVED GAME with a controlled board, not through a wall of text.',
    doneWhen: [
      'Someone who has never played can finish it and then play a real game without asking a human what to do',
      'It teaches through a played game with a stacked/scripted board, not a document',
      'It covers the concepts a new player actually stumbles on: affinity and resources, the counterattack, columns sharing attributes, grafting',
      'It is one of the first things visible to a signed-out visitor — this client exists partly to teach newcomers',
      'It ends by pointing at the shop: both links from BL-15, with an honest line about supporting the creator',
    ],
    decided: [
      'Contrived game, not a rules document. The owner said "with a contrived game of some kind".',
      'Teaching newcomers is a stated reason the project exists, so this is not a nice-to-have.',
      'It ends with the buy links. Owner, 2026-08-25: "Yes. Give them the links and recommend buying the game or AT LEAST the print and play version to support the creator of this excellent game." — the two exact URLs are recorded on BL-15; use those, do not go looking for others.',
    ],
    asks: [],
    deps: ['BL-11', 'BL-03'],
    touches: [
      'client/ui/main.ts',
      'client/ui/glossary.ts',
      'client/docs/digital-rules.md',
      'data/rules',
    ],
    notes:
      'Depends on BL-03 because the scripted-opponent machinery is what lets a contrived '
      + 'game have a cooperative opponent that does the thing the lesson needs.',
  },
  {
    id: 'BL-13',
    slug: 'metagame-database',
    title: 'Metagame database — public aggregates, private lists',
    area: 'accounts',
    size: 'M',
    status: 'open',
    track: 'feature',
    said: 'Constructed/metagame saving/database ... Yeah, keep lists secret but aggregate stats public',
    means:
      'A public metagame page built as a fold over the saved games, the same way profiles '
      + 'are. What is being played and how it does: card play rates, win rates by element '
      + 'and trio, how archetypes fare against each other. Individual decklists stay PRIVATE '
      + 'to their owner — only aggregates are published.',
    doneWhen: [
      'A metagame page shows aggregate play/win rates and says over what sample',
      'No UNPUBLISHED decklist is reachable from it, by URL or otherwise (revised 2026-08-28 — see decided)',
      'It is recomputed by the same fold as profiles, so the two can never disagree',
      'A format with too few games says so rather than showing noise as signal',
      'The same aggregates can be read all-time and over a recent window, off one fold rather than two code paths',
    ],
    decided: [
      'Decklists are secret; aggregates are public. Owner, 2026-08-24, unprompted and explicit.',
      'Archetypes are COMPUTED, not tagged — and not soon. Owner, 2026-08-25: "We won\'t implement this for a long while, but I think we can do it based on calculations of \'cards in common\' and multidimentional space. Something like \'this set of XYZ cards in this combination of elements defines this deck\'. Then players can give it a name somehow." — cluster on card overlap plus element combination, and let players name a cluster after the fact. Note the first clause: he expects this to be far off, so SHIP THE PAGE WITHOUT ARCHETYPES. Card, element and trio aggregates are a complete first version.',
      'Both time windows. Owner, 2026-08-25, asked all-time only or 30-day slices: "Both, why not."',
      'REVISED 2026-08-28 — publishing is opt-in, and a published list IS public. The owner asked '
      + 'for it directly: "I want to be able to set decks public so that they appear in a list of '
      + 'some kind. I want to be able to share my decks with people on my profile" and "decks that '
      + 'are public can start showing up in a \'meta game\' list page which has some basic filters '
      + 'and sorts (by default) by winrate". That does NOT overturn the 2026-08-24 decision, it '
      + 'scopes it: a deck is private until its owner publishes it, which is what BL-14\'s means '
      + 'already anticipated ("a shareable deck link if you choose to share it — sharing is opt-in, '
      + 'because BL-13 keeps lists private by default"). What survives unchanged is the note below: '
      + 'the page LISTS decks somebody published and never reconstructs one from an aggregate.',
      'The published-deck list, the share link and descriptions shipped as BL-35/BL-36. What is '
      + 'still open here is the AGGREGATE half — card play rates, win rates by element and trio, '
      + 'and the recent-window fold. Those are what this entry is now about.',
    ],
    asks: [],
    deps: ['BL-14'],
    touches: [
      'client/server/stats.ts',
      'client/server/history.ts',
      'client/server/decks.ts',
      'client/server/publicdecks.ts',
      'client/ui/account.ts',
      'client/ui/meta.ts',
    ],
    notes:
      'Aggregates must be computed server-side from lists nobody can read back out. Do not build '
      + 'a "top decks" view that reconstructs a list from its aggregate — a deck reaches the '
      + 'metagame page because its owner published it, never because a fold inferred it. That '
      + 'distinction is the whole of the 2026-08-28 revision above, and server/publicdecks.ts '
      + 'states it in its header.',
  },
  {
    id: 'BL-14',
    slug: 'deck-locker',
    title: 'Deck locker — save, view and edit constructed decks on your account',
    area: 'accounts',
    size: 'M',
    status: 'done',
    evidence: {
      commit: '90ec026',
      guards: [
        // the server scripts run through the suite runner — see BL-24's row
        'suite.test.ts::test-collection.ts — the starter five seeded once and NEVER re-seeded after a delete',
        'suite.test.ts::test-collection.ts — a half-built deck saves, reports its shortfall, and is refused for play',
        'suite.test.ts::test-collection.ts — twenty decks is the limit, and the refusal says what to do',
        'suite.test.ts::test-collection.ts — a deck id claimed over the wire that is not yours is IGNORED, so no win can be credited to somebody else\'s deck',
        'suite.test.ts::test-collection.ts — the record is a fold: a full rebuildProfiles() leaves it intact',
        '188-deck-stats.test.ts::§3 the cumulative column carries a requirement DOWN the curve, never up',
        '188-deck-stats.test.ts::§3 `first` fires exactly once per level of a requirement',
        '188-deck-stats.test.ts::§6 a deck exported as text imports back as the same deck',
      ],
    },
    track: 'feature',
    said: 'Saving/viewing constructed decks with account',
    means:
      'The personal half of the deck story: build, name, save, edit, copy and delete decks '
      + 'on your account, and pick a saved one when joining a constructed room instead of '
      + 'rebuilding it. Import/export as text, and a shareable deck link if you choose to '
      + 'share it — sharing is opt-in, because BL-13 keeps lists private by default.',
    doneWhen: [
      'A signed-in player can save a named deck and see it listed on their account',
      'A saved deck can be edited, duplicated and deleted',
      'Joining a constructed room offers your saved decks instead of a blank builder',
      'A deck can be exported to and imported from plain text',
      'A deck is 30 cards and the builder enforces it',
      'A 21st deck is refused with a message that says why, not silently dropped',
      'Editing a deck that has already been played in a rated game produces a NEW version; the played one stays exactly as history recorded it',
    ],
    // ⚠ SHIPPED WITH ONE doneWhen LINE OPEN, on purpose and said out loud: the
    // fork-on-edit rule above is NOT built. There is no rated play yet (BL-02
    // is open), so there is no history it could corrupt — and fork-on-edit
    // fights the make-cuts-and-tweaks loop this was actually asked for
    // ("I could save all my decks there and see them visually and make
    // cuts/tweaks", 2026-08-27). Build it WITH rated play, where it has a
    // meaning, rather than now, where it would only be friction. Everything
    // else on the list is in, plus duplicate and a text export that
    // round-trips through the real importer.
    decided: [
      '30 cards is the constructed deck size.',
      'Lists are private by default (BL-13); sharing one is a deliberate act.',
      'Twenty decks per account. Owner, 2026-08-25: "Let\'s set it at like 20 just to help people stay organized and not overwhelm our db (despite deck lists being so tiny)." — the stated reason is tidiness, not storage, so the limit wants a friendly message rather than a hard error page.',
      'A deck played in a rated game is FROZEN. Owner, 2026-08-25: "Correct. Don\'t let deck edits mess with history. But minor edits will likely mean its the same archetype." — an edit to a played deck must fork a new version rather than rewrite the one BL-02 and BL-13 point at. The archetype remark is guidance for BL-13\'s clustering (near-identical lists should cluster together), NOT permission to let a small edit through to a played deck.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/server/collection.ts',
      'client/server/api-decks.ts',
      'client/server/api-util.ts',
      'client/server/decks.ts',
      'client/server/default-decks.json',
      'client/server/accounts.ts',
      'client/server/rooms.ts',
      'client/server/history.ts',
      'client/ui/decks.ts',
      'client/ui/deckstats.ts',
      'client/ui/util.ts',
      'client/ui/main.ts',
    ],
    notes:
      'server/decks.ts and default-decks.json already existed and were the right starting '
      + 'point — the importer and the bundled five were reused whole, and the new work is the '
      + 'collection ON the account plus the page. Two things worth knowing before touching it: '
      + "(1) a deck's record is DERIVED from the game history by deck id, never counted, so it "
      + 'cannot drift — which means the id has to survive the wire, and the server re-reads the '
      + 'deck out of the account behind the token rather than trusting the id sent; (2) the '
      + 'curve/split/affinity arithmetic lives in a pure DOM-free module (ui/deckstats.ts) '
      + 'precisely because sums a player makes cuts on are the kind that go quietly wrong.',
  },
  {
    id: 'BL-15',
    slug: 'legal-and-attribution',
    title: 'Legal, attribution, and "buy the real game"',
    area: 'legal',
    size: 'S',
    status: 'open',
    track: 'feature',
    said:
      'No official client yet. It\'s on steam as a "we want to make this" but its not being '
      + 'worked on currently. ... Basically, I want a client for playing online without '
      + 'tabletop sim and a way to teach new people. I\'m paying for it and have no interest '
      + 'in making money from it. I also want to recommend people buy the physical game '
      + 'before playing on the client (which is free and has no economy) or AT LEAST the '
      + 'print and play version, which is cheap and supports the creator.',
    means:
      'The text a public deploy legally and ethically needs. An unmistakable "unofficial fan '
      + 'project, not affiliated with the creator" notice. Card art and IP attribution. A '
      + 'prominent, genuine recommendation to buy the physical game — or at minimum the '
      + 'print-and-play, which is cheap and supports Caleb — placed where new players will '
      + 'actually read it. And, because accounts now exist on a public deploy, a terms of '
      + 'service and a privacy policy covering what is stored: usernames, password hashes, '
      + 'game logs.',
    doneWhen: [
      'A signed-out visitor sees the unofficial/unaffiliated notice without hunting for it',
      'There is a clear link to buy the physical game and to the print-and-play, with an honest "this supports the creator" line',
      'Card art and IP are attributed',
      'A privacy policy states exactly what is stored (username, scrypt password hash, game logs) and that there is no email and no password reset',
      'A terms page states the client is free, has no economy, and makes no money',
      'The two buy links are exactly https://shop.calebgannon.com/products/algomancy-the-base-game (physical) and https://shop.calebgannon.com/products/algomancy-print-and-play-edition (print-and-play)',
      'Caleb has actually been asked, and the answer is recorded, before anything is deployed publicly',
    ],
    decided: [
      'Free, no economy, no monetization, owner-funded. Not negotiable and should be stated plainly.',
      'There is NO shipped official client — do not write copy implying one exists. The Steam page is an intent that is not currently being worked on.',
      'The pitch order is: buy physical > buy print-and-play > play here for free.',
      'CALEB\'S BLESSING IS STILL A PRECONDITION OF GOING PUBLIC. Owner, 2026-08-25, asked whether he wants explicit blessing or whether a clear unofficial notice is enough: "I\'ll get it before making it ublick." — doc 06\'s standing item stands, and the unofficial notice is not a substitute for it. Nobody deploys publicly until the owner says he has it.',
      'THE TWO URLS, exactly as the owner gave them on 2026-08-25: https://shop.calebgannon.com/products/algomancy-print-and-play-edition and https://shop.calebgannon.com/products/algomancy-the-base-game. Use these verbatim; do not "helpfully" swap in a store search page or a shortened link.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/legal.ts',
      'client/ui/main.ts',
      'client/engine/test/267-legal-and-attribution.test.ts',
      'client/README.md',
    ],
    notes:
      'S in effort, but it is a BLOCKER on the public deploy that the rest of this backlog '
      + 'assumes. Cheap and unblocking — a good candidate for the first down-time slot.\n\n'
      + 'ROUND 36: BUILT, AND STILL OPEN — ON PURPOSE. `client/ui/legal.ts` ships six of the '
      + 'seven acceptance lines: the unofficial strip above the wordmark on every non-board '
      + 'screen, the footer pitch with both URLs verbatim in the fixed order, and the About & '
      + 'attribution / Privacy / Terms pages. `client/engine/test/267-legal-and-attribution.'
      + 'test.ts` (14 assertions) pins the two URLs and their order, the notice, the '
      + '"no official client" statement, the free/no-economy/makes-no-money claims, the '
      + 'attribution, and — DERIVED, not restated — the privacy page\'s storage list against '
      + 'the real fields of server/accounts.ts, the real getters of server/statepaths.ts, and '
      + 'every localStorage key in ui/.\n'
      + 'THE SEVENTH LINE IS NOT TICKED AND IS NOT AN AGENT\'S TO TICK: "Caleb has actually '
      + 'been asked, and the answer is recorded". That is the owner\'s ("I\'ll get it before '
      + 'making it ublick", 2026-08-25) and nothing built here substitutes for it. The entry '
      + 'stays `open` because `done` would claim it — and because `done` also needs a commit '
      + 'and a guard in `evidence`, which the round that lands this should fill in ONLY once '
      + 'the answer exists.\n'
      + 'ONE THING THE PAGE STATES THAT MAY CHANGE: there is no password reset. That is true '
      + 'today and is written as a consequence of having no email, not as an apology — but it '
      + 'is questions-round36 Q3, and if the owner picks a recovery code or an admin reset, '
      + 'the privacy page has to be rewritten with it. §3 of the guard fails if a reset route '
      + 'appears while the page still says there is none.\n'
      + 'WHAT THE STORE ACTUALLY KEEPS, checked rather than assumed: the doneWhen line says '
      + '"username, scrypt password hash, game logs" and that is a floor, not the list. It '
      + 'also holds the salt, the account id and creation date, the whole stat sheet, the '
      + 'achievements with unlock times, friends and pending requests, the folded-game '
      + 'bookkeeping, and the deck collection; plus session tokens with first/last-seen '
      + 'stamps, and a full match-history row per game. Separately on disk: every saved game '
      + '(seed + complete action log — a move-for-move record), the 🐛 reports, and the '
      + 'scenario verdicts. The IP address is held in memory only, for the failed-login '
      + 'throttle. All of that is on the page.',
  },
  {
    id: 'BL-16',
    slug: 'admin-panel',
    title: 'Admin panel — accounts, live rooms, and bug-report triage',
    area: 'accounts',
    size: 'M',
    status: 'open',
    track: 'feature',
    said: 'Admin panel/accounts',
    means:
      'An operator page for a public deploy: account management (rename, ban, reset, '
      + 'delete), a list of live rooms and who is in them, and a triage queue for the 🐛 '
      + 'reports the client already writes to issues.jsonl — read them, mark them, close '
      + 'them, without SSHing into the box.',
    doneWhen: [
      'An admin account can list, rename, ban and delete accounts',
      'Live rooms are visible with their seats and status',
      'Bug reports from the in-client 🐛 button are readable and closable in the browser',
      'Everything on the page is refused to non-admins, server-side, not just hidden in the UI',
      'Admin is a flag on an account, grantable only by another admin, and independent of any judge badge',
      'Ben\'s account has the flag and no other account does until he grants it',
    ],
    decided: [
      'Needed because the target is a public deploy with strangers.',
      'ADMIN IS A FLAG ON AN ACCOUNT, and it is NOT the judge badge. Owner, 2026-08-25, asked exactly that: "Ben is an admin and L1 judge. He will set the other accounts when anyone else maybe ends up joining." — note that he puts himself at L1 while holding admin, which settles the question outright: the two are independent axes. One admin to start, who grants the rest by hand; there is no self-service path to it.',
      'The account-claiming problem is NOT this entry. Owner, 2026-08-25, asked whether fixing it belongs here or in its own entry, answered with the rule instead: "When live, no, you will not claim the games unless you make an account right after finishing playing, in which case that becomes your first tracked game." That is a change to server/accounts.ts, not to the admin page, so it is filed as BL-28.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/server/accounts.ts',
      'client/server/api-accounts.ts',
      'client/server/main.ts',
      'client/server/rooms.ts',
      'client/ui/account.ts',
    ],
    notes:
      'Two things were flagged here as "raise with the owner rather than silently fix". '
      + 'NAME CLAIMING was raised on 2026-08-25 and answered — it is now BL-28, with his rule '
      + 'recorded verbatim.\n\n'
      + 'NO EMAIL AND THEREFORE NO PASSWORD RESET was raised on 2026-09-01 (round-36 Q3) and '
      + 'answered, and the answer was not a feature: *"DO NOT FORGET YOUR PASSWORD, THERE IS '
      + 'NO PASSWORD RESET" must be shown at account creation.* So there is still no reset '
      + 'route and none is planned; what changed is that the consequence is now SHOWN WHERE '
      + 'THE DAMAGE IS DONE rather than only on the privacy page somebody would have to go '
      + 'and read. Landed 2026-09-01 in ui/account.ts, in his own capitals, gated on '
      + '`isRegister` so it is on the create screen and not the log-in one — a warning on the '
      + 'log-in screen arrives after the moment it is about. 267 §7 guards all three: the '
      + 'words, the screen, and that no reset ROUTE has quietly appeared under the shouting. '
      + 'The admin-panel half of this entry is untouched and still open.',
  },
  {
    id: 'BL-17',
    slug: 'judge-badges',
    title: 'Judge badges — L1/L2/L3 trust levels for rules and bug reports',
    area: 'accounts',
    size: 'M',
    status: 'open',
    track: 'feature',
    said:
      'Judge badges (levels 1, 2 and 3) for priority rules/bug reports ... badge system is '
      + 'for humans. L3 judges basically have word of law. They\'re creators of the game '
      + 'essentially. L2 is a step down. Highly knowledgable community membrs and long time '
      + 'players. L1 is basically raising someone above the genpop, but not as trusted yet',
    means:
      'A HUMAN trust level stamped on an account, shown as a badge, that determines whose '
      + 'rules answers and bug reports carry weight. L3 = word of law, essentially the game\'s '
      + 'creators; their ruling settles it. L2 = highly knowledgeable community members and '
      + 'long-time players. L1 = raised above the general population, but not yet fully '
      + 'trusted. It feeds the report/rules queue: a badged report is prioritized, and a '
      + 'badged answer is recorded as authoritative.',
    doneWhen: [
      'An account can hold a badge level and it is visible on their profile and in game',
      'Rules questions and bug reports from badged accounts are surfaced ahead of unbadged ones',
      'An L3 answer is recorded as authoritative and is distinguishable from an L2 or L1 opinion',
      'Only an admin can grant or revoke a badge',
      'A badged account can review the questions players asked the rules bot, and flag a bad or problematic one',
      'A flagged question lands in a queue that survives a restart and is visibly ahead of unflagged reports when the owner works through them',
      'Nothing a judge writes is returned into a live game — no human answer appears in the in-game "Ask the judge" box',
      'Nothing a judge does edits digital-rules.md or the rulings corpus',
    ],
    decided: [
      'Humans, not the bot. The existing in-client "Ask the judge" box goes to the rules bot; badges are about people.',
      'L3 = word of law / creators. L2 = highly knowledgeable community, long-time players. L1 = above genpop, not yet fully trusted.',
      'NO LIVE ESCALATION. Judges review and flag instead. Owner, 2026-08-25, asked whether a human answer can flow back into the in-game box: "Not live, but judges should be able to review questions and flag problematic ones." — so the in-game box stays bot-answered, and what badges buy is an after-the-fact review queue over the questions that were asked, with a flag on the bad ones. Do not build in-game escalation.',
      'AN L3 JUDGE MAY NOT EDIT THE RULINGS CORPUS. Owner, 2026-08-25: "No, but their feedback needs to be prioritized during updates and engine fixes." — digital-rules.md and the rulings corpus stay the owner\'s hand. The obligation this creates is on the OTHER side: a judge\'s flag has to land somewhere durable and visibly prioritized, so that the next rules update or engine fix actually sees it. A flag that only exists as a chat message does not satisfy this.',
    ],
    asks: [],
    deps: ['BL-16'],
    touches: [
      'client/server/accounts.ts',
      'client/server/api-accounts.ts',
      'client/ui/main.ts',
      'client/ui/inspect.ts',
      'client/docs/digital-rules.md',
    ],
    notes:
      'The client already has a judge question box (the ⚖ entry on the card right-click menu '
      + 'and the judge-q input) wired to the rules bot. That is the natural place to hang '
      + 'human escalation.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // QoL / UX — the small list. These are where a down-time agent should look
  // first: most are S, none need a design pass, and several are outright bugs.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'BL-18',
    slug: 'full-control',
    title: 'Full control — suppress every shortcut the client takes for you',
    area: 'client',
    size: 'M',
    // ⚠ STATUS IS STILL `open` FOR ONE REASON ONLY, and it is bookkeeping
    // rather than work: `backlog.test.ts`'s own gate requires
    // `evidence.commit` to be a real sha before an entry may be `done`, and
    // the round brief forbids committing. Everything this entry asks for is
    // built and guarded (see the notes below for the guard list, ready to move
    // into an `evidence` block unchanged). Flip this to `done` with the
    // round's sha in the integration pass. Writing a placeholder sha to get
    // past the gate would be precisely the lie the gate exists to catch.
    status: 'done',
    evidence: {
      commit: 'e224b3f',
      guards: [
        'client/engine/test/272-full-control.test.ts::BL-18 \u00a71 with full control OFF, the client still passes for you exactly as before',
        'client/engine/test/272-full-control.test.ts::BL-18 \u00a72 a standing Pass-all armed BEFORE the switch is not a promise it keeps',
        'client/engine/test/272-full-control.test.ts::BL-18 \u00a73 the switch reaches the SERVER, on the join and on every change',
        'client/engine/test/272-full-control.test.ts::BL-18 \u00a74 you can respond to your own spell with the first still on the stack',
        'client/engine/test/272-full-control.test.ts::BL-18 \u00a75 both drain sites are known, and the one in this lane is guarded',
        'client/engine/test/273-full-control-hotseat.test.ts::BL-18 \u00a71 with full control OFF a hotseat empty board still steps itself along',
        'client/engine/test/273-full-control-hotseat.test.ts::BL-18 \u00a72 with full control ON the drain stops and the player is left the window',
        'client/engine/test/273-full-control-hotseat.test.ts::BL-18 \u00a72 \u2026and switching it back off lets the same board drain again',
      ],
    },
    track: 'qol',
    said: 'full control',
    means:
      'MTGO-style full control: a toggle that stops the client acting on your behalf, so you '
      + 'get a window at every point you could legally act, even a trivial one. Four things '
      + 'currently act for you and all four must yield to it: `ui.autopass` (passes when pass '
      + 'is the only legal action), the "Pass all" chip, the right-click auto-yield map, and '
      + 'the server-side forcedAction() that auto-attacks/auto-blocks on an empty board. It '
      + 'also covers HOLD PRIORITY — casting a second thing before the first resolves without '
      + 'releasing the window.',
    doneWhen: [
      'A persisted toggle turns off autopass, pass-all, auto-yield and forced actions together',
      'With it on, you are stopped at every window where you have any legal action, including ones with a single option',
      'You can cast a second spell in response to your own first without the window closing',
      'With it off, nothing about current behaviour changes',
    ],
    decided: [
      'It is "never auto-anything, stop at every window I could act in", and it DOES include hold priority. Owner confirmed both, 2026-08-24.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/main.ts',
      'client/engine/src/apply.ts',
      'client/server/rooms.ts',
    ],
    notes:
      'Trap recorded in the tree: forcedAction() lives in apply.ts but is drained by the '
      + 'SERVER and the hotseat act(), never by the engine — engine-side auto-skip broke 242 '
      + 'scripted tests and was reverted. Full control must switch it off at the drain site, '
      + 'not inside the reducer.\n\n'
      + 'THE CLIENT HALF LANDED 2026-09-01. `algoFullControl`, one toggle in the side rail, '
      + 'and the switch sits at `planAutoPass` — the ONE place all three client-side '
      + 'automatics are decided, because `autoPassDecision` already takes each of them as an '
      + 'INPUT, so switching them off is switching off their inputs and there is no fourth '
      + 'path for one to creep back along. A standing Pass-all armed BEFORE the switch is '
      + 'DROPPED rather than merely ignored (else the chip sits there offering to stop '
      + 'something already stopped). The affordances go too: no Pass-all / Pass-stack button, '
      + 'no auto-yield menu entry, no auto-yield badge — full control does not offer what it '
      + 'would not honour. Guards: 272 (8) + 273 (3).\n\n'
      + '⚠ A FIFTH THING ACTS FOR YOU and the entry does not name it: the R236 automatic '
      + 'haste-step ready. `bluffHasteOn()` is its narrow opt-out; full control is the wide '
      + 'one, and it goes off with the rest.\n\n'
      + '⚠ ROW FOUR IS ONLY HALF THE SERVER\'S, and this note above already said so without '
      + 'drawing the conclusion: forcedAction() has TWO drain sites, and the hotseat act() is '
      + 'in client/ui/main.ts. That one is switched off (273 drives it: an empty board stops '
      + 'stepping itself along and the player is handed a real window with a real button — '
      + 'checked, because a drain removed without an affordance is a hang, not a feature). '
      + 'THE NETWORK DRAIN, server/main.ts::drainForced, LANDED TOO, later the same day, once '
      + 'client/server/ was free. So all four rows are done. 272 §5 keeps a census of both '
      + 'drain sites so a third cannot appear unnoticed.\n\n'
      + 'HOW THE PREFERENCE REACHES THE SERVER, and the shape was CHOSEN rather than copied. '
      + 'It is NOT `clockStart`\'s shape: BL-26\'s bank is a property of the ROOM — one seat '
      + 'picks it at creation, it binds both players, it is persisted, and a later join is '
      + 'deliberately ignored so the second player cannot re-specify it. Full control is the '
      + 'opposite on every count: one seat\'s own preference, changeable mid-game, binding on '
      + 'nobody else. So it is shaped like `Room.building` instead — per-seat, soft, relayed. '
      + '`{t:"fullcontrol", on}` on every change, plus `on` on every join, and the server copy '
      + 'is NOT PERSISTED because the browser owns it and re-asserts it: a reconnect, a seat '
      + 'takeover and a restart all re-establish it for free, and a persisted copy could only '
      + 'ever come to disagree with the localStorage that drives the other half of the same '
      + 'feature.\n\n'
      + '⚠ THE GATE IS PER SEAT, NOT PER ROOM, and that is the whole of "must not desync the '
      + 'opponent": `forcedAction` names the seat it is answering for, so the drain stops only '
      + 'at a step belonging to somebody who asked it to, and the other player\'s own forced '
      + 'steps still drain. (It is a `break` and not a `continue`: skipping does not change the '
      + 'state, so a `continue` would spin the loop to its guard for nothing.) THE ONE REAL '
      + 'CONSEQUENCE, stated rather than discovered in a game and asserted in the test: while '
      + 'the board owes YOU a step, your opponent waits for you to click it, the same way they '
      + 'wait for any other action of yours. That is what opting in means.\n\n'
      + '⚠ TURNING IT OFF RESUMES THE DRAIN, which the entry does not ask for and the feature '
      + 'is broken without: a player who switches back mid-game while the board is holding a '
      + 'step for them would otherwise sit at a window they have just said they do not want, '
      + 'and the board would never move again on its own — a stuck game produced by switching '
      + 'a preference OFF.\n\n'
      + 'NOT A HANG, measured on both halves rather than reasoned: the seat that owes the held '
      + 'step is OFFERED it (a real affordance in the hotseat markup, a non-empty `legal` in '
      + 'the seat\'s own push over the wire), and taking it moves the game on. A drain removed '
      + 'without an affordance behind it is a stopped board, not a feature.\n\n'
      + 'GUARDS (ready to move into an `evidence` block with the round\'s sha):\n'
      + '  272-full-control.test.ts — §1 the negative control, §2 the three client automatics '
      + 'including a promise and a yield stored BEFORE the switch, §3 the affordances and the '
      + 'wire (both the join and the change), §4 hold priority, §5 the drain-site census\n'
      + '  273-full-control-hotseat.test.ts — the hotseat drain, its negative control, and the '
      + 'round trip\n'
      + '  suite.test.ts::test-full-control.ts — the server drain over real sockets\n\n'
      + 'RE-BROKEN SEVEN WAYS across the three files: forget to drop the standing promise; '
      + 'unguard the hotseat drain; force the switch always-on (the negative control catches '
      + 'it); drop `on` from the join (the reconnect path); read the server flag off the ROOM '
      + 'instead of the seat; remove the server gate; hold unconditionally on the server.\n\n'
      + '⚠ HOLD PRIORITY IS NOT WHAT THE doneWhen LINE LOOKS LIKE, measured rather than read. '
      + 'Casting does NOT keep the window here: engine.ts hands priority to the other seat the '
      + 'moment an item goes on the stack, so MTGO-style "cast two with nobody looking in '
      + 'between" is FALSE today and would be an ENGINE change to who gets priority after a '
      + 'cast — a rules decision, not a client one. What the line LITERALLY asks for is true '
      + 'and is now pinned (272 §4): the window does not CLOSE — the opponent gets a look, '
      + 'priority comes back, and the first spell is still on the stack to respond to. Which '
      + 'of the two the owner meant is worth asking before anybody edits the engine — it is '
      + 'Q5 on docs/questions-round36.md. THIS ENTRY IS COMPLETE UNDER THE LITERAL READING, '
      + 'which is the one its doneWhen line states and 272 §4 pins. If the owner answers that '
      + 'he meant the MTGO one, that is a NEW entry (an engine change to who holds priority '
      + 'after a cast), not a reopening of this one.',
  },
  {
    id: 'BL-19',
    slug: 'reset-blocks',
    title: 'Reset blocks — one button to clear an assignment and start over',
    area: 'client',
    size: 'S',
    status: 'done',
    evidence: {
      commit: '723d78d',
      guards: [
        '55-ui-formation.test.ts::clearBuild: every kind of assignment goes at once',
        '55-ui-formation.test.ts::clearBuild: the SPARSE index survives a clear',
        '55-ui-formation.test.ts::clearBuild: what gets republished is an EMPTY formation',
        '55-ui-formation.test.ts::hasBuild: any one kind of assignment on its own counts',
        '55-ui-formation.test.ts::the three clear paths in ui/main.ts all go through resetFormation',
      ],
    },
    track: 'qol',
    said: 'reset blocks',
    means:
      'While declaring blocks, a single button that clears every assigned blocker so you can '
      + 'start the assignment over, instead of un-assigning column by column. The same button '
      + 'should exist while building attack columns and while picking counterattack sends — '
      + 'it is the same interaction and the same frustration.',
    doneWhen: [
      'A visible "clear" control during block declaration empties all assignments in one click',
      'The same control exists while building an attack formation and while choosing counterattack sends',
      'Clearing does not send anything to the server or commit — it only resets local assignment state',
      'The opponent\'s live preview of your in-progress formation clears with it',
    ],
    decided: [
      'It applies to blocks, attack columns and sends — all three. Owner confirmed, 2026-08-24.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/main.ts',
      'client/ui/formation.ts',
    ],
    notes:
      'ui/formation.ts keeps `columns` SPARSE and index-keyed on purpose — index is meaning, '
      + 'and compacting slid blockers onto the wrong attackers once already. A reset is just '
      + 'emptying the array, which is safe; do not "helpfully" compact anything while you are '
      + 'in there. publishCols() must be re-published after a clear so the opponent\'s preview '
      + 'follows.',
  },
  {
    id: 'BL-20',
    slug: 'card-menu-scoping',
    title: 'Right-click a card, get card things — field entries belong to the field',
    area: 'client',
    size: 'S',
    status: 'done',
    evidence: {
      commit: '9ccc2f0',
      guards: [
        '216-menu-scoping.test.ts::§1 right-clicking a CARD shows card things, and nothing about the field',
        '216-menu-scoping.test.ts::§2 both field entries are still reachable — from bare table',
        '216-menu-scoping.test.ts::§3 a card BACK is not a dead click: an unreadable card gets the table menu',
      ],
    },
    track: 'qol',
    said:
      'I was referring to the concede and view erased menu items. Those are for ONLY when '
      + 'right clicking the field. Righclicking a card should only show things related to '
      + 'that card',
    means:
      'Right-clicking a CARD currently appends the board-level entries (Concede, View erased) '
      + 'to every menu. It should not. A card menu should carry only card-related entries — '
      + 'inspector, ask the judge, auto-yield — and Concede / View erased should appear only '
      + 'on a right-click of bare table.',
    doneWhen: [
      'Right-clicking any card shows only entries about that card',
      'Right-clicking bare table still shows Concede and View erased',
      'Right-clicking a card BACK (opponent hand) is still not a dead click — decide what it shows and make it deliberate',
    ],
    decided: [
      'This REVERSES an earlier deliberate decision. main.ts says the board entries ride on every card menu "so you never have to hunt for bare table" (R65, from the playtest asks "We need a way to right click -> concede match :(" and "I dont think there\'s currently a way to view erased cards"). The owner has now decided the opposite. Keep the entries reachable from bare table — the original complaint was that they were unreachable at all, and that must not come back.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/main.ts',
      'client/ui/inspect.ts',
    ],
    notes:
      '✔ DONE 2026-08-29 as R241 — read that register entry before touching this again, because '
      + 'it records a REVERSAL and the thing it reverses is still a live hazard. '
      + 'The composition changed at ONE call site (main.ts\'s contextmenu handler); '
      + 'ui/inspect.ts boardMenuEntries still owns WHICH entries exist and what they are called, '
      + 'and needed no change — the two were already separate, which is why this was three lines '
      + 'and a test rather than a rewrite. '
      + '⚠ §2 IS THE LOAD-BEARING TEST, NOT §1. R65 put these entries on every card menu because '
      + 'the original playtest asks were that neither was reachable AT ALL. A future change that '
      + 'satisfies this entry by making them unreachable again would be filing that report a '
      + 'third time, and §2 is the only thing standing in the way. '
      + 'THE CARD BACK, decided rather than defaulted (the third done-when): an unreadable card '
      + 'is not a card, for menu purposes. It offers no card things, so there is no scope to '
      + 'confuse, and it falls through to the FIELD\'s menu — which is what keeps right-clicking '
      + 'the opponent\'s hand from being a click that does nothing.',
  },
  {
    id: 'BL-21',
    slug: 'deployment-reveal-readability',
    title: 'The deployment reveal is unreadable, and repeats itself afterwards',
    area: 'client',
    size: 'M',
    status: 'done',
    evidence: {
      commit: '3386ab7',
      guards: [
        '217-reveal-rows.test.ts::§1a two units of the same card are TWO rows — the folding is gone',
        '217-reveal-rows.test.ts::§1b the MOD is on the surface, on the card it was applied to',
        '217-reveal-rows.test.ts::§2a round 8 fixture: one card',
        '217-reveal-rows.test.ts::§2c a modded copy NEVER merges with a plain one',
        '217-reveal-rows.test.ts::§3a sendReveal really does put the reveal events in BOTH fields',
        '217-reveal-rows.test.ts::§3b the client holds only the TAIL — measured on a real barrier flush',
        '217-reveal-rows.test.ts::§4a every event carrying a message reaches the surface somewhere',
      ],
    },
    track: 'qol',
    said:
      'I mean when you see what your opponent did, it\'s very hard to actually read. It\'s '
      + 'getting overly cluttered and verbose and doesn\'t actually show the mods they do, '
      + 'that sort of thing. After dismissing it, there\'s also a weird flurry of their stack '
      + 'and abilities, which is weird and rudundant there.',
    means:
      'Three complaints about the reveal interstitial that shows what your opponent did '
      + 'during simultaneous hidden deployment. (1) It is cluttered and verbose — hard to '
      + 'actually read. (2) It does not show the MODS they applied, which is exactly the '
      + 'information you need. (3) After you dismiss it, their stack and abilities replay in '
      + 'a flurry, which is redundant — you just watched it — and confusing.',
    doneWhen: [
      'The reveal reads at a glance: what they deployed, where, and what it did',
      'Mods/augments applied during their deployment are shown, on the cards they were applied to',
      'Dismissing the reveal does not replay their stack and abilities again',
      'Nothing that only the opponent should know leaks into the reveal',
    ],
    decided: [
      'The complaint is about the REVEAL, not about committing your own deployment.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/main.ts',
      'client/server/rooms.ts',
      'client/server/view.ts',
    ],
    notes:
      '✔ DONE 2026-08-29. THIS ENTRY\'S GUESS ABOUT THE FLURRY WAS EXACTLY RIGHT and is worth '
      + 'recording as such — "check whether the reveal consumes the events or merely previews '
      + 'them" was the whole of it. `server/main.ts::sendReveal` sends `reveal: revealEvents` AND '
      + '`events: [...revealEvents, ...tailEvents]` through the same filter, so the client held '
      + 'the reveal\'s own events and replayed them as board beats the instant you dismissed the '
      + 'surface describing them. It now holds `events.slice(reveal.length)`, and 217 §3a pins '
      + 'that composition against main.ts\'s source — the slice is only correct while it holds. '
      + '⚠ COMPLAINT (1) WAS WORSE THAN "VERBOSE", and this is the part to read before touching '
      + 'the surface again. MEASURED on a real Room: two Good Whales with a Hooba-Lin on the '
      + 'FIRST drew ONE row, with the second Whale folded into the first one\'s sentence. The '
      + 'grouping ran `findCardName` over message PROSE, and that returns the LONGEST card name '
      + 'in the string — so a two-word host outranks a one-word mod in every message naming both '
      + '(which is ALSO why the mods were invisible), and two units sharing a card name were one '
      + 'group by construction. `ui/reveal.ts` reads the events\' structure instead. '
      + '⚠ AND THE TRAP THAT IS NOT IN THIS ENTRY AT ALL: this is the SECOND report about this '
      + 'surface. Round 8 was "single cards create 5, full sized entries […] they don\'t need to '
      + 'take up so much space", `groupReveal` was that fix, and it over-corrected into the bug '
      + 'above. One row per entity would have been round 8 filed AGAIN — a spell that makes three '
      + 'tokens makes three entities. Hence the merge rule: adjacent rows for the same card '
      + 'merge, UNLESS one carries a mod, because the chip would otherwise read as being on both '
      + 'copies. Round 8\'s own fixture lives in 217 §2 now; it moved rather than being deleted '
      + 'with the code it tested.',
  },
  {
    id: 'BL-22',
    slug: 'card-text-icon-bugs',
    title: 'Card text: duplicated Augment icon, missing Unstable, wrong depleted-ability icon',
    area: 'client',
    size: 'S',
    status: 'done',
    evidence: {
      commit: '85f697d',
      guards: [
        '122-cardtext-markup.test.ts::an augment line does not repeat the [Augment] icon',
        '122-cardtext-markup.test.ts::no augment-donating card in the pool leads its clause with the marker',
        '122-cardtext-markup.test.ts::an Unstable card says so',
        '122-cardtext-markup.test.ts::a spent once-per-turn ability is one short [Once] note',
      ],
    },
    track: 'qol',
    said:
      'When looking at a cards text, it duplicates icons. For example, an augmented thing '
      + 'will show the :augment: icon twice, once on each line. It also doesn\'t show unstable '
      + 'anywhere. And when a :once: per turn activated/triggered ability is depleted, it\'s '
      + 'nice that it greys it out, but it also duplicates the text, making it really long and '
      + 'uses the wrong icon [Switch1] rather than [Once]. That\'s just visual tho.',
    means:
      'Three concrete rendering bugs in the card text box, all cosmetic, all annoying. '
      + '(1) An augmented card prints the [Augment] icon twice, once per line. (2) Unstable '
      + 'is never rendered anywhere, so a card that is Unstable does not say so. (3) A '
      + 'depleted once-per-turn ability greys out correctly — that part is good — but it also '
      + 'DUPLICATES the ability text, making the box very long, and tags it with [Switch1] '
      + 'instead of [Once].',
    doneWhen: [
      'An augmented card shows the [Augment] icon exactly once',
      'A card with Unstable renders it',
      'A depleted once-per-turn ability greys out WITHOUT restating its text, and is tagged [Once]',
      'Each of the three has a test in the cardtext suite so it cannot silently come back',
    ],
    decided: [
      'Cosmetic only — the owner said so explicitly ("That\'s just visual tho"). No engine behaviour changes.',
      'Greying out a depleted ability is correct and stays.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/cardtext.ts',
      'client/ui/main.ts',
      'client/docs/12-card-text.md',
    ],
    notes:
      'Starting points found while writing this entry: ui/cardtext.ts `boundedTag()` returns '
      + "'[Switch1]' for triggered abilities and '[once]' otherwise — that is the wrong-icon "
      + 'bug. The "already used this turn" note line near the bottom of the same file is the '
      + 'likely text duplication. The `[Augment] Grants …` line plus the printed text-box '
      + '[Augment] marker is the likely double icon. NOTE: [Switch1] is a real token that '
      + 'appears in printed card text (see printed.json) — do not globally rewrite it, only '
      + 'fix the depleted-ability tag.',
  },
  {
    id: 'BL-23',
    slug: 'single-line-badges',
    title: 'Badges should stay on one line',
    area: 'client',
    size: 'S',
    status: 'done',
    evidence: {
      commit: 'c3e85f7',
      guards: [
        '123-badge-line.test.ts::folds the overflow into a +N chip that names what it hid',
        '123-badge-line.test.ts::holds one line at every card width in style.css',
        '123-badge-line.test.ts::folds printed attributes before live state',
        '123-badge-line.test.ts::truncates a lone over-long label',
      ],
    },
    track: 'qol',
    said: 'single line "badges"',
    means:
      'The corner chips on a card scan — attributes, the ±N/±N counter chip, mod badges, '
      + '"sent", "⏩ auto-yield", 📜 prophesy, the X-cost preview — stack up and wrap onto '
      + 'multiple lines over the card art. They should be held to a single line: compact '
      + 'them, truncate, or roll the overflow into a "+2" you can hover. The count of badges '
      + 'is fine; the wrapping is the problem.',
    doneWhen: [
      'A card carrying many badges renders them on one line and the art stays readable',
      'No badge becomes unreachable — overflow is still inspectable (hover, or the inspector)',
      'It holds at the small card sizes used in the bin, stack thumbs and decision options, not just on the board',
    ],
    decided: [
      'The complaint is the wrapping, not the number of badges. Owner confirmed, 2026-08-24.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/main.ts',
      'client/ui/style.css',
    ],
    notes:
      'Badges are built in cardHtml/unitBadges in ui/main.ts and styled as .badges / .badge '
      + '(.mod, .ctr) in style.css. Several are pushed conditionally from different places, so '
      + 'the fix is probably in the container, not in each call site.',
  },
  {
    id: 'BL-24',
    slug: 'create-in-formation-broken',
    title: 'BUG: "into formation" / "in my formation" placement is not working',
    area: 'engine',
    size: 'M',
    status: 'done',
    evidence: {
      commit: 'f8653ac',
      guards: [
        '108-formation-class.test.ts::Hooba-Lin',
        '108-formation-class.test.ts::Hooba-Bot',
        '108-formation-class.test.ts::Hooba-Pon',
        '108-formation-class.test.ts::Hooba-God',
        '108-formation-class.test.ts::Tiderunner Initiate',
        '108-formation-class.test.ts::Trench Stalker',
        '50-ui-inspect.test.ts::optionPingId',
        'suite.test.ts::test-formation-decision.ts',
      ],
    },
    track: 'qol',
    said: 'The "into formation" or "in my formation" hasn\'t been working',
    means:
      'Not a feature request — a reported defect. Effects that create or play a unit "in my '
      + 'formation" / "into formation" are supposed to place it into a slot in the '
      + 'controller\'s existing formation (R75: the controller chooses the slot at '
      + 'resolution). The owner reports this is not working. Affects at least: the [Augment] '
      + '"create a 1/1 unit in my formation" card, "create a Robot 2 in my formation", the '
      + 'copy-of-me-in-my-formation card, Hooba-Pon\'s play-a-unit-into-an-open-position, and '
      + 'the "can be played directly into formation" card.',
    doneWhen: [
      'Each "in my formation" / "into formation" card is reproduced failing, then fixed',
      'The controller is actually offered the slot choice at resolution (R75)',
      'A regression test per affected card, in the engine suite',
      'If it turns out to be a UI-side failure to present the choice, the entry says so and the fix lands there',
    ],
    decided: [
      'This is a bug report from the owner, so it outranks every other entry in this file — bugs in card behaviour are the stated top priority for the project.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/engine/src/engine.ts',
      'client/engine/test/73-play-into-formation.test.ts',
      'client/ledgers/playtest-ledger.ts',
      'client/ledgers/card-todo.ts',
      'client/engine/src/cards/sets/batch-fire-a.ts',
      'client/engine/src/cards/sets/batch-metal-b.ts',
      'client/engine/src/cards/sets/batch-water-a.ts',
      'client/engine/src/cards/sets/batch-light-a.ts',
    ],
    notes:
      'IMPORTANT — there is prior work here and it must be read before touching anything. '
      + 'playtest-ledger.ts records a fix that introduced TWO distinct mechanisms: '
      + 'CardBehavior.playsIntoFormation with a \'formation\' cast (play-time placement, for '
      + 'Tiderunner, which was wrongly folded into the create-in-formation class), and '
      + 'placeInFormation kept for the genuine create-in-formation class (R75). '
      + '73-play-into-formation.test.ts guards the first. A regression in one of the two, or '
      + 'a card wired to the wrong one, is the most likely cause. '
      + 'CROSS-REFERENCE: this probably also belongs in ledgers/card-todo.ts with a proof '
      + 'predicate, since that is where card defects live and where the suite enforces them. '
      + 'It is carried here because the owner reported it as part of this list. '
      + 'This entry is READY on purpose despite an unanswered question — the owner was not '
      + 'asked which card they saw fail, because all five are testable directly and a bug '
      + 'report should not wait on an interview. If you want to narrow it first, ask. '
      + 'CLOSED 2026-08-24 (f8653ac). The RULES half could not be reproduced at HEAD: all '
      + 'seven cards ask the slot question and place correctly through the real action '
      + 'path, and the server relays the ask to the right seat. What WAS broken is the '
      + 'PRESENTATION, and it reads exactly like the report: both formation asks were '
      + "raised as DecisionKind 'electricPath', whose numeric option values are RAW ENTITY "
      + 'IDS by contract (R4) — but R75/R29 slot options carry slot INDEXES 0..n-1, so the '
      + 'client pinged whichever units happened to own entity ids 0..n-1 and the wrong '
      + "units lit up. It is its own kind 'formationSlot' now, and the ping judgement moved "
      + 'out of main.ts into ui/inspect.ts `optionPingId`, where it is testable. '
      + 'The other likely contributor is DEPLOY AGE: the Hooba slot ask only exists since '
      + 'ac84ab0 (08-22), the Tiderunner invader-zone fix since cac3c30 (08-22, ledger '
      + '#54), and Trench Stalker was parked until e3b4dfb (08-24) — a game played against '
      + 'a server deployed before those is "hasn\'t been working" with no bug at HEAD. '
      + 'The deploy box was not checked from that session; if the owner still sees it after '
      + 'a deploy of f8653ac, reopen with the card name.',
  },
  {
    id: 'BL-25',
    slug: 'counter-removal-affordance',
    title: 'Removing counters: say to click the unit, add a stepper and an "All" button',
    area: 'client',
    size: 'S',
    status: 'done',
    evidence: {
      commit: '6c45091',
      guards: [
        '124-counter-stepper.test.ts::the Discharge cost prompt tells you to click a unit',
        '124-counter-stepper.test.ts::the stepper clamps at 1 and at the max the engine gave it',
        '124-counter-stepper.test.ts::"All" sets the count to the max and does NOT submit',
        '124-counter-stepper.test.ts::the stepper max is counterPool(), asked of the engine',
        '124-counter-stepper.test.ts::one click pays several counters, and X is what was taken',
        '124-counter-stepper.test.ts::an effect that removes counters carries its own ceiling',
      ],
    },
    track: 'qol',
    said:
      'It\'s actually okay, it\'s just not clear that it wants you to click the unit. It needs '
      + 'to say that. Plus maybe a counter with up/down arrows would be nice too or an "All" '
      + 'button which jumps the count to the max (without auto submitting) for cases where '
      + 'there are a ton of counters.',
    means:
      'The counter-removal mechanism itself is fine — the affordance is not. It must SAY that '
      + 'you are meant to click a unit. Then a proper quantity control: up/down arrows to set '
      + 'how many, and an "All" button that jumps the count to the maximum. "All" sets the '
      + 'count; it must NOT auto-submit — that matters when a unit has a lot of counters and '
      + 'you want to look before you commit.',
    doneWhen: [
      'The prompt explicitly tells you to click a unit',
      'A stepper with up/down arrows sets the number of counters to remove',
      'An "All" button sets the count to the maximum and does not submit',
      'It works for the removeCounters cost kind and for effects that remove counters',
    ],
    decided: [
      'Do not redesign the flow — the owner said it is "actually okay". This is labelling plus a stepper plus All.',
      '"All" sets, it does not submit. Stated explicitly by the owner.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/main.ts',
      'client/engine/src/engine.ts',
    ],
    notes:
      'The cost kind is `removeCounters` in engine.ts (costLabel around the "remove X +1/+1 '
      + 'counter…" string, and the eligibility filter requiring u.counters > 0). The engine '
      + 'side already computes the max available via counterPool() — the UI can ask it rather '
      + 'than recomputing.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FILED FROM THE 2026-08-25 ANSWERS — work the owner's answers created that
  // had no entry anywhere. These are features, not QoL; they sit down here
  // rather than up with BL-01 because ids are allocated in order and never
  // renumbered. Each one quotes the answer that created it.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'BL-26',
    slug: 'configurable-timers',
    title: 'Make the clock optional and configurable, per room',
    area: 'server',
    size: 'M',
    status: 'done',
    evidence: {
      commit: '1f12877',
      guards: [
        // the server scripts run through the suite runner — see BL-24's row
        'suite.test.ts::test-clock.ts — BL-26 the bank as a PER-ROOM setting',
        'suite.test.ts::test-clock.ts — a custom bank',
        'suite.test.ts::test-clock.ts — no clock at all',
        'suite.test.ts::test-clock.ts — a pre-setting file still loading',
        'suite.test.ts::test-clock.ts — a joiner who cannot re-specify',
        // the UI half, landed 2026-09-01 in the client lane
        '271-clock-picker-and-warning.test.ts::BL-26 \u00a74 the home screen offers the owner',
        '271-clock-picker-and-warning.test.ts::BL-26 \u00a74 the default follows the MODE',
        '271-clock-picker-and-warning.test.ts::BL-26 \u00a73 no link built for the OTHER seat carries the clock setting',
        '271-clock-picker-and-warning.test.ts::BL-26 \u00a71 a client that was never sent a clock draws no clocks',
      ],
    },
    track: 'feature',
    said:
      'Chess clock is actually 60. Timer going off will eventually lose the game. But we '
      + 'need to make timers optional and configurable first.',
    means:
      'Today the clock is a module constant — `CLOCK_START_MS = 60 * 60 * 1000` in '
      + 'server/rooms.ts — that every room gets and nobody can change or switch off, and it '
      + 'is display-only: settleClock() clamps at zero and nothing reads the result. The '
      + 'owner named making it optional and configurable as the PREREQUISITE for making time '
      + 'run out matter (BL-27), so it is its own entry and it comes first. Make the starting '
      + 'bank a per-room setting chosen when the room is made — including "no clock at all" — '
      + 'persisted with the room and visible to both seats before the game starts.',
    doneWhen: [
      'A room can be created with the 60-minute default, some other bank, or no clock at all',
      'The chosen bank is persisted with the room and survives a server restart',
      'A saved game from before the setting existed still loads, with the bank it was saved with',
      'A room with the clock off shows no clocks at all, rather than a frozen 60:00',
      'Both seats can see the clock setting before the first action',
      'CLOCK_START_MS becomes the DEFAULT rather than the rule — nothing outside room creation reads the constant',
    ],
    decided: [
      'The clock is 60 minutes, not 40. `CLOCK_START_MS = 60 * 60 * 1000`, raised from 40 on 2026-08-20 after 40 minutes ran out mid-playtest ("a draft game with real decisions wants an hour"). BL-04\'s old question said 40:00 and was wrong; the owner corrected it on 2026-08-25.',
      'Configurability comes FIRST. Owner, 2026-08-25: "we need to make timers optional and configurable first." BL-27 depends on this entry, not the other way round.',
      'Off is a real setting, not a very large number. A room with no clock must not run one invisibly.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/server/rooms.ts',
      'client/server/main.ts',
      'client/server/test-clock.ts',
      'client/ui/lobby.ts',
      'client/ui/main.ts',
    ],
    notes:
      'DONE 2026-09-01, server side. `Room.clockStart` is the setting: persisted, chosen at '
      + 'creation, `null` for no clock at all. `CLOCK_START_MS` is now only the DEFAULT, and '
      + 'the only site outside creation that still reads it is restoreRooms, which is not an '
      + 'exception - a file with no `clockStart` was played at 60:00 because that was the '
      + 'only bank there was. The wire unit is MILLISECONDS and the server validates a RANGE '
      + '([MIN_CLOCK_MS, MAX_CLOCK_MS]) rather than a list of presets: two people who can '
      + 'both see the setting may play whatever length they agree on, and the floor is 1s '
      + 'deliberately, because BL-27 is only testable at speed because of it. A room with the '
      + 'clock off sends NO `clock` field at all rather than a stopped one - the client draws '
      + 'nothing because it was told nothing, which is why "shows no clocks rather than a '
      + 'frozen 60:00" needed no UI change. The setting rides the join exactly as `mode` and '
      + '`els` do, and joinableRoom ignores it for an existing room, which is what stops the '
      + 'SECOND player handing their opponent a three-second game by editing a link.\n\n'
      + '⚠ THE ONE PLAYER-FACING PIECE THAT WAS NOT LANDED IS NOW, 2026-09-01, in the client '
      + 'lane: the home-screen picker (Off / 10m / 20m / 30m / 60m / 90m), persisted as '
      + '`algoClockMs` and appended to the CREATING join only. It is deliberately NOT on the '
      + 'share link - the room exists by then and the server ignores the field, so appending '
      + 'it could only change what the JOINER believes they are choosing; 271 §3 derives that '
      + 'check from the link templates themselves, so a fourth link added later is covered '
      + 'without an edit.\n\n'
      + 'THE PRESET LIST IS NO LONGER A PLACEHOLDER, 2026-09-01. Q4 answered: "45m and 60m. '
      + 'Constructed games are shorter, so I\'d say the default for constructed is 45m and '
      + 'the default for live draft is 60m." Three chips now - Default, 45m, 60m, Off - and '
      + '⚠ THE DEFAULT STOPPED BEING A CONSTANT, which is the part the one-line change did '
      + 'not cover: a single CLOCK_DEFAULT_MS cannot say "45 for constructed and 60 for a '
      + 'draft". So `CLOCK_DEFAULT_BY_MODE` is the table, `chosenClockMs(mode)` resolves it, '
      + 'and "Default" is the ABSENCE of `algoClockMs` rather than a number written into it - '
      + 'a stored number would freeze one mode\'s answer onto both. The mode is known at the '
      + 'New button and nowhere earlier, which is why the resolution happens at that call '
      + 'site. The SERVER is untouched: it still validates a range, so an old link carrying '
      + 'clock=90m is still honoured and this is only what the screen offers.',
  },
  {
    id: 'BL-27',
    slug: 'clock-expiry-loses',
    title: 'Running out of time loses the game — the anti-BM rule, before launch',
    area: 'server',
    size: 'M',
    status: 'done',
    evidence: {
      commit: '1f12877',
      guards: [
        // the server scripts run through the suite runner — see BL-24's row
        'suite.test.ts::test-clock.ts — a seat that STOPS ACTING runs out of time and loses',
        'suite.test.ts::test-clock.ts — which is the one case nothing polls for',
        'suite.test.ts::test-clock.ts — stamped like a concession and refused afterwards',
        'suite.test.ts::test-clock.ts — a clockless room, a disconnected seat and a server restart cost nobody anything',
        // CT-160 × BL-27: a FROZEN room must not hand anybody a loss for not
        // moving in a game that refuses every move
        'suite.test.ts::test-forensics.ts — saved logs as a forensic record',
        // the UI half, landed 2026-09-01 in the client lane
        '271-clock-picker-and-warning.test.ts::BL-27 \u00a72 a full bank is not critical, and a nearly-empty one is',
        '271-clock-picker-and-warning.test.ts::BL-27 \u00a72 the threshold is a tenth of the ROOM',
      ],
    },
    track: 'feature',
    said:
      'Timer going off will eventually lose the game. But we need to make timers optional '
      + 'and configurable first. ... we\'ll make the timer actally cause a game loss before '
      + 'launching to prevent BMing.',
    means:
      'When a seat\'s bank reaches zero in a room that HAS a clock, that seat loses and the '
      + 'game ends. The reason the owner gave is not pacing, it is BM: today a player who is '
      + 'losing can simply stop acting and the game never ends — it lands in history as '
      + '`finished: false` with no stamped winner, which is indistinguishable from an honest '
      + '"we both had to go". The loss must be STAMPED the way a concession is, so the '
      + 'history sync and the rating fold (BL-02) see an ordinary decided game.',
    doneWhen: [
      'A seat whose clock reaches zero loses, and the game ends at that moment',
      'The result is stamped like a concession — decidedWinner() names the other seat, and the saved file records it',
      'Nothing expires in a room whose clock is off (BL-26)',
      'A merely disconnected seat does not bleed time — clockRunning() already stops both clocks when a socket is missing, and that stays true',
      'A room restored from disk resumes with the time it had, and nobody loses on the strength of wall-clock time that passed while the server was down',
      'Both players see the clock going critical before it happens — a loss on time must never be a surprise',
    ],
    decided: [
      'This is an ANTI-BM rule, in the owner\'s words: "to prevent BMing". That is what it is for, and it is why a stalled game has to end in a result rather than in silence.',
      'It is a LAUNCH BLOCKER. Owner, 2026-08-25: "we\'ll make the timer actally cause a game loss before launching".',
      'It comes after BL-26: "we need to make timers optional and configurable first."',
      'It does not change the abandonment rule. Owner, same day, on BL-02: "Both players abandon? Just don\'t count it." Once this lands, a player who walks away from a running clock produces a LOSS rather than an abandonment, and only a game where nobody\'s clock ran out stays uncounted.',
    ],
    asks: [],
    deps: ['BL-26'],
    touches: [
      'client/server/rooms.ts',
      'client/server/main.ts',
      'client/server/history.ts',
      'client/server/test-clock.ts',
      'client/ui/main.ts',
    ],
    notes:
      'DONE 2026-09-01, server side. THE TRAP WAS REAL AND IT IS SOLVED WITH A SWEEP, NOT A '
      + 'TIMER. A per-room setTimeout armed for the exact zero is more precise and much '
      + 'worse: it has to be re-armed by every one of the seven sites that can change who is '
      + 'on the clock, and a site that forgets is a game that never ends - this entry\'s own '
      + 'failure, reintroduced one layer along. main.ts runs one unref\'d 1s interval over '
      + 'allRooms() instead. It costs nothing because expiredSeat() opens with a CHEAP GATE: '
      + '`clockRun` is the CACHED running set, so "could anybody have hit zero since the last '
      + 'settle" is two subtractions, and only a room that actually has pays for a settle '
      + '(which means clockRunning, which means legalActions twice). `.unref()` is not '
      + 'decoration - without it the suite spawns and kills this server thirty times a run '
      + 'and hangs on every one.\n\n'
      + 'THE RESULT IS STAMPED, NOT LOGGED. A concede is a real Action because a player took '
      + 'it; running out of time is not something anybody DID, and it cannot be replayed '
      + 'because the clock is wall time and is not part of the game state - a pseudo-action '
      + 'would make every saved log stop reproducing its own game. `Room.winner` is exactly '
      + 'this shape and summarizeGame already prefers the stamp, so the history sync and the '
      + 'rating fold see `finished: true` with a named winner.\n\n'
      + 'FOUR THINGS THE ENTRY DID NOT NAME AND THE WORK FOUND. (1) `clockRunning` needed the '
      + 'same "decided outside the state" arm, or the very next settle after an expiry looks '
      + 'at a board still full of legal moves and starts both banks running again on a '
      + 'finished game. (2) `applyToRoom` needed one too: the engine refuses everything once '
      + '`state.winner` is set, but a loss on time never touches the state, so without it the '
      + 'loser could go on playing a game they had already lost. (3) The expiry note has to '
      + 'be PUT ON THE WIRE - the first draft pushed a view with an empty event list, which '
      + 'left both players staring at a stopped board and an unchanged log, i.e. exactly the '
      + 'silent ending this entry exists to abolish. (4) The CT-160 composition guard passed '
      + 'for the wrong reason until the fixture was given sockets: clockRunning also stops '
      + 'both clocks when a seat is missing, and that arm was masking the frozen one.\n\n'
      + '⚠ THE ONE doneWhen LINE THAT WAS NOT LANDED — "both players see the clock going '
      + 'critical before it happens" — IS NOW, 2026-09-01, in the client lane. '
      + '`clockWarnAt(start) = min(60_000, start / 10)`: a minute of warning on an hour, nine '
      + 'seconds on ninety. ⚠ DERIVED FROM THE ROOM\'S OWN BANK rather than a constant, and '
      + 'that is this entry\'s own MIN_CLOCK_MS floor talking: a fixed one-minute warning '
      + 'would already be lit when a ninety-second game began, and a warning that is always on '
      + 'is not a warning. 271 §2\'s discriminating case is ten seconds left in a 90s bank - '
      + 'critical under ANY constant threshold, correctly quiet under this one - with the cap '
      + 'checked from the other side too. The `.warn` class is toggled in BOTH writers of the '
      + 'clock nodes: clocksHtml() and the 1s ticker. ⚠ THE TICKER IS THE ONE THAT MATTERS, '
      + 'because it is the only thing still running when both players have stopped acting, '
      + 'which is exactly the situation a loss on time arrives out of; a class toggled only in '
      + 'the render would light up on the next paint, and the whole point is that there may '
      + 'not be one.',
  },
  {
    id: 'BL-28',
    slug: 'claiming-past-games',
    title: 'Name-claiming is wrong on a public deploy — claim the game you just played, nothing else',
    area: 'accounts',
    size: 'M',
    status: 'open',
    track: 'feature',
    said:
      'When live, no, you will not claim the games unless you make an account right after '
      + 'finishing playing, in which case that becomes your first tracked game.',
    means:
      'register() currently calls claimSeats(), which walks the entire saved history and '
      + 'attaches every seat ever played under a matching name. That is right for a '
      + 'two-person LAN box — it is how the first eight games landed in Ben\'s profile the '
      + 'moment he registered — and wrong the instant strangers can register: "Ben" is not a '
      + 'rare name. The owner\'s rule replaces it with something much narrower: no retroactive '
      + 'sweep, but a player who finishes a signed-out game and registers RIGHT AFTER gets '
      + 'that game, and it becomes their first tracked game.',
    doneWhen: [
      'Registering a username no longer sweeps up past games played under that name',
      'A player who finishes a signed-out game and registers straight afterwards gets that game, and only that game, as their first tracked game',
      'The window is bounded and defined in one place — a stranger cannot register tomorrow and take a game they did not play',
      'What happens to the LAN-era claims already in the store is decided explicitly and written down, not left to whatever the code happens to do',
      'server/test-accounts.ts covers both halves: the sweep is gone, and the just-finished attach works',
    ],
    decided: [
      'THE RULE, from the owner, 2026-08-25: "When live, no, you will not claim the games unless you make an account right after finishing playing, in which case that becomes your first tracked game."',
      'Split out of BL-16 (admin panel) deliberately: he was asked where the fix belongs and answered with the rule instead. The change lands in server/accounts.ts, which is not the admin page, so it is its own entry.',
      'The LAN behaviour was not a bug — accounts.ts says so itself: "On a two-person LAN server \'whoever registers the name is that player\' is the right trade; on anything public it would not be." This entry is the public-deploy half of a trade that was made knowingly.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/server/accounts.ts',
      'client/server/api-accounts.ts',
      'client/server/history.ts',
      'client/server/test-accounts.ts',
      'client/ui/account.ts',
    ],
    notes:
      'claimSeats() in server/accounts.ts is the exact function, called from register(). It '
      + 'matches `game.names[seat]` lowercased against `account.key`, skips seats that '
      + 'already have a user, and calls rebuildProfiles() — so profiles follow whatever this '
      + 'ends up doing and the fold does not need touching. '
      + 'The "right after finishing" half needs something the server does not have yet: a '
      + 'handle on the game you just played that survives you leaving the page and '
      + 'registering. The post-game screen is the natural place to hang it (server/history.ts '
      + 'already summarises the finished game there).',
  },
  {
    id: 'BL-29',
    slug: 'spectators',
    title: 'Spectators — watch a live room without a seat',
    area: 'server',
    size: 'L',
    status: 'done',
    evidence: {
      commit: '74f4c95',
      guards: [
        'suite.test.ts::test-spectate.ts — BL-29 the LIVE half of spectators',
      ],
    },
    track: 'feature',
    said: 'We want to allow spectators and match replays, but that\'s its own feature, yes.',
    means:
      'Two related things the owner split off from tournaments by name when asked whether '
      + 'spectators were in scope there. SPECTATE: join a live room as a seatless viewer. '
      + 'REPLAY: watch a finished game back from its saved file. Most of the replay machinery '
      + 'exists — every room file is seed plus action log, and server/replay-room.ts already '
      + 'replays one through the current engine — but that same tool documents the trap: an '
      + 'old log on a newer engine DRIFTS (moves that were legal then are refused now) or '
      + 'FORKS (the server rebuilt the game mid-match and play continued from the rebuilt '
      + 'board). A replay viewer that quietly showed the reconstructed game instead of saying '
      + 'so would be lying to the viewer.',
    doneWhen: [
      'A viewer can watch a live room without occupying a seat, and their joining or leaving does not disturb the players',
      'Whether the players can see that they are being watched is decided deliberately, and the entry records which way',
      'A spectator sees exactly what the owner chose them to see, and cannot be mistaken for a player by the server or by themselves',
    ],
    decided: [
      'It is its own feature, not part of tournaments. Owner, 2026-08-25, asked whether spectators could watch a tournament or whether that was strictly later: "We want to allow spectators and match replays, but that\'s its own feature, yes." BL-04 may link to this; it must not block on it.',
      'OMNISCIENT AND LIVE. Owner, 2026-09-01, answering the ask that used to sit below: "Just omniscient and live is fine for now." A spectator sees BOTH hands and sees them now — not seat-by-seat, not delayed. "for now" is his own hedge and is recorded in the code: a delayed or redacted broadcast is a change to `spectatorView` in server/view.ts and to nothing else.',
      'THE PLAYERS ARE TOLD, which answers this entry\'s own "decided deliberately" line. An omniscient live view is a cheating vector the moment a spectator can talk to a player, and the one thing that makes that manageable at a friendly table is that both seats can see there is an audience. So every view carries a watcher COUNT — never names, because a count is what makes the risk visible and a name list would be a second feature.',
      '⚠ SPECTATE AND REPLAY ARE NO LONGER ONE ENTRY, and the reasoning that made them one is now wrong. It said "they are the same viewer over two sources", which was true while both were unbuilt; the owner\'s answer split them, because a LIVE omniscient view needs no redaction work at all while a REPLAY viewer is almost entirely the drift/fork verdict `replay-room.ts` already makes. Building the live half first cost nothing the replay half will have to redo. The replay half is BL-38.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/server/rooms.ts',
      'client/server/view.ts',
      'client/server/replay-room.ts',
      'client/server/main.ts',
      'client/ui/main.ts',
    ],
    notes:
      'viewFor(state, seat, frozenOpp) in server/view.ts is the per-seat redaction and WAS '
      + 'expected to be the basis for a spectator view. ⚠ THE OWNER\'S ANSWER MADE THAT WRONG: '
      + '"omniscient" means the spectator view is not a redaction at all, so `spectatorView` '
      + 'bypasses viewFor entirely - the exact thing this note used to forbid ("that is how a '
      + 'redaction hole gets in through a door the leak tests do not watch"). The warning is '
      + 'still right; the exception is the owner\'s; the compensation is that the bypass is '
      + 'nailed shut on the other side.\n\n'
      + 'A WATCHER IS NOT A SEAT AND CANNOT BECOME ONE. `pickSeat` is never called for one, '
      + '`conns` never gets an entry, and the action path reads `conns` - so a watching socket '
      + 'has no seat to act as, and every game message it sends is refused BY CONSTRUCTION '
      + 'rather than by a check somebody has to remember to keep. A seated player is refused '
      + 'the watch message for the mirror reason. It never touches the clock either: '
      + '`clockRunning` asks about `room.sockets`, which a watcher is not in, so an audience '
      + 'cannot start or stop anybody\'s bank.\n\n'
      + 'THE PUSH HOOKS `sendToSeat` - the one function every push to a player goes through - '
      + 'and coalesces on the microtask queue so one action is not broadcast once per seat. '
      + 'Enumerating the push sites instead is the failure this repo has already had twice '
      + '(CT-135\'s three overlay lists).\n\n'
      + 'test-spectate.ts is A LEAK TEST RUN BACKWARDS: the watcher must see the hand the '
      + 'seat\'s own view hides, asserted as the same moment seen twice, so "omniscient" is a '
      + 'measurement rather than a wish. Break-tested three ways - redacting the view reddens '
      + '1, dropping the not-already-seated check reddens 4, not telling the seats reddens 2.\n\n'
      + 'THE CLIENT: `?ws=1&room=CODE&watch=1`. `NET.seat` stays 0 for a spectator and means '
      + '"which way round the table is drawn" rather than "who I am" - eight thousand lines '
      + 'read it for orientation and a null there would be a null-check in each of them. What '
      + 'keeps a watcher out of the game is the SERVER, not that field. ⚠ The watch link is '
      + 'deliberately NOT on the share banner: that banner is the one you send the person you '
      + 'are waiting to PLAY, and handing them a spectator link in the same breath is how '
      + 'somebody ends up watching a game they meant to be in.',
  },
  {
    id: 'BL-30',
    slug: 'ally-target-warning',
    title: 'Warn — not stop — when a mixed-allegiance spell is aimed entirely at your own units',
    area: 'client',
    size: 'M',
    status: 'done',
    evidence: {
      commit: 'b1f2158',
      guards: [
        '278-ally-misclick.test.ts::R288 \u00a70 the family is derived from printed specs',
        '278-ally-misclick.test.ts::R288 \u00a70 CONTROL: the predicate rejects both single-allegiance shapes',
        '278-ally-misclick.test.ts::R288 \u00a71 Fight aimed at a second unit of your own',
        '278-ally-misclick.test.ts::R288 \u00a72 the ALLY slot never asks',
        '278-ally-misclick.test.ts::R288 \u00a72 picking the ENEMY in the open slot is silent',
        '278-ally-misclick.test.ts::R288 \u00a73 no single-allegiance spell in the pool can reach the question',
        '278-ally-misclick.test.ts::R288 \u00a74 the question changes no legality',
        '278-ally-misclick.test.ts::R288 \u00a75 the client asks before sending',
        '278-ally-misclick.test.ts::R288 \u00a75 "no" sends nothing and leaves the same pick open',
      ],
    },
    track: 'qol',
    said:
      'there are many cards in the game that you can TECHNICALLY point at several of your own '
      + 'units (Fight, Organic Exchange). We shouldn\'t stop that from happening, they\'re legal '
      + 'targets, but it might be nice to add a small warning if they select two of their own '
      + 'units (Did you mean to target allies with this spell? Yes or No, rechoose targets). '
      + 'This should only be applied to spells where one target is "supposed" to be an ally and '
      + 'the other is an enemy, in cases where it could be easy to misclick your own dudes.',
    means:
      'A non-blocking confirm on the LAST target pick, never a legality change. The owner is '
      + 'explicit twice over — "we shouldn\'t stop that from happening" and "they\'re legal '
      + 'targets" — and R157\'s standing steer ("printed text always wins"; take the reading that '
      + 'lets more things happen) forbids narrowing the target set. So this is a misclick guard '
      + 'and nothing else: the player answers Yes and the spell resolves exactly as it does '
      + 'today. Trigger condition: every chosen target shares a controller with the caster, on a '
      + 'spell whose printed intent is one ally and one enemy.',
    doneWhen: [
      'Aiming Fight at two of your own units raises a confirm naming the spell, and answering Yes resolves it unchanged',
      'Answering No returns to target selection with the picks cleared, not to a cancelled cast',
      'A spell that is SUPPOSED to hit only allies (or only enemies) never raises the confirm — this is the false-positive test and it matters more than the true positive',
      'The card set it applies to is DERIVED from card data, not a hand-written list — docs/13 §7.2',
      'No legality changes: a saved game replays identically with the warning code present',
    ],
    decided: [
      'Warn, never block. Owner, 2026-08-26: "We shouldn\'t stop that from happening, they\'re legal targets."',
      'Scope is mixed-allegiance spells only, and the owner named the shape himself: "spells where one target is \'supposed\' to be an ally and the other is an enemy". A spell that legitimately hits two allies must never warn.',
      'There is precedent for warned-but-legal in this engine (R74, guarded in engine/test/42-dark-b.test.ts) — reuse that shape rather than inventing a second one.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/engine/src/types.ts',
      'client/ui/main.ts',
      'client/engine/src/engine.ts',
    ],
    notes:
      'Seams found 2026-08-28: a display-only `warning?` on the decision option (types.ts), the '
      + 'R74 warned-but-legal precedent, and R194 for why a warning needs a window to hang on. '
      + '⚠ The false-positive case is the whole risk. A warning that fires on spells the owner '
      + 'aims at his own units ON PURPOSE is worse than no warning — he will learn to click '
      + 'through it, and then it protects nothing.\n\n'
      + 'DONE 2026-09-01. R288. THE ASK WAS ANSWERED and the answer was the derivation itself: '
      + '"Anything that says target ally AND target unit on the same card … if a card calls out '
      + '\'one ally, one OTHER target\', it is almost always going to be one ally and one enemy." '
      + 'That is already written down - R58 gave every target slot its own kind - so '
      + '`mixedAllegiance` in dsl.ts is a two-line read over `slots` and needs no new printed '
      + 'facet and no hand list. Derived family today: Fight and Squish.\n\n'
      + '⚠ ORGANIC EXCHANGE IS NOT IN IT, and the owner named it in the original ask. His later '
      + 'rule excludes it: it prints "two target units" with no ally slot, so "target ally AND '
      + 'target unit on the same card" does not describe it. It is a different shape - '
      + 'exchanging control of two units you already control is a KNOWN NO-OP, which is R74\'s '
      + '`warning`, not a guess about what the player meant. 278 §0 pins the family so the '
      + 'disagreement is on the record rather than argued again.\n\n'
      + 'TWO FIELDS, NOT ONE. `DecisionOption.confirm` is new beside R74\'s `warning`: R74 says '
      + '"this will do nothing" (a fact about the effect, fine as prose) and R288 says "you may '
      + 'have clicked the wrong thing" (a guess about the player, worth an interruption). '
      + 'Folding them together would have put a dialogue in front of every R74 option. And '
      + '`confirm` is NOT appended to the label, breaking R74\'s convention deliberately: '
      + 'referenceKey records a decide by its options\' labels, so label text re-keys saved '
      + 'games and R200 reads the cosmetic change as divergence.\n\n'
      + 'THE CLIENT ASKS AT `act()`\'S DOOR and nowhere else - a target is answerable from '
      + 'seven places in main.ts and CT-135\'s lesson is that a hand-kept list of sites loses '
      + 'one. ⚠ The first shape of the confirm handler cleared the flag before re-sending, '
      + 'which made act()\'s own guard re-ask the same question and the Yes button do nothing; '
      + 'the flag now stays set ACROSS the send and the guard skips the choice it is already '
      + 'confirming. Found by the test, not by reading.\n\n'
      + '"No" sends nothing at all - nothing had been sent, so there is nothing to undo, and '
      + 'the same pick is still open. For both cards in the family that IS "picks cleared": the '
      + 'earlier slot was forced to be an ally, so the only pick that could be wrong is the one '
      + 'being asked about. Escape still takes the whole cast back.',
  },
  {
    id: 'BL-31',
    slug: 'per-game-achievements',
    title: 'Eleven single-game achievements, and the per-game counters they need',
    area: 'accounts',
    size: 'M',
    status: 'open',
    track: 'feature',
    said:
      'More achievements: Trigger a graft effect with 5 or more parts / Deal 30 damage with a '
      + 'single non-combat effect / Deal 100 damage in a single combat / Have a unit 50/50 (or '
      + 'larger) unit in play / Have at least 25 units in play / Win a game without dealing '
      + 'combat damage to any opponent / Play the same named spell 5 times in a single game / '
      + 'Win a game with 3 or fewer resources in play (which is longer than 3 turns) / Make 12 '
      + 'or more resources in a single game / Win a game with 0 cards in your deck / Win a game '
      + 'where you play cards from 4 or more elements (Play the Rainbow)',
    means:
      'Eleven new rows in server/achievements.ts. The list is the owner\'s verbatim and he named '
      + 'one of them himself ("Play the Rainbow"). ⚠ THE REASON THIS IS M AND NOT S: ten of the '
      + 'eleven are PER-GAME FACTS ("in a single combat", "in a single game", "at least 25 units '
      + 'in play"), and the achievements table can only express a COUNTER-VS-GOAL over a '
      + 'Profile, which is a pure SUM over saved games. A sum cannot answer "the most you ever '
      + 'did in one game". So each needs a new per-game HIGHLIGHT counter written during the '
      + 'fold in server/stats.ts — flawlessWins/closeWins are the existing pattern to copy.',
    doneWhen: [
      'All eleven appear in the achievements UI with honest progress, using the same counter-vs-goal shape as the existing 28 — no bespoke predicates',
      'Each new per-game highlight is computed in the stats fold and has a test driving a real saved game through it',
      'The retroactivity limit is STATED in the entry and in the code: a highlight is only as retroactive as the fold can see it, so games played before the counter existed may read zero',
      'An existing achievement\'s progress is unchanged — adding these must not perturb the 28 already there',
    ],
    decided: [
      'These are single-game facts, not career totals. The five nearest existing achievements (tinkerer, swarm, spellslinger, elementalist, aggressor) are all career sums and none of them is one of these eleven — verified 2026-08-28 by importing the live module, not by grepping it.',
      'Unlocks stay sticky (accounts.ts stamps first-earned and never clears), so a later goal change cannot take a badge away.',
      'ANSWERED 2026-08-30, the open ask: the parenthesis in "3 or fewer resources (which is longer than 3 turns)" is a CONDITION. Owner: "A condition — turn > 3". A freak turn-3 win does not earn Ascetic.',
      'ANSWERED 2026-08-30: "trigger a graft effect with 5 or more parts" means THE TRIGGERED ABILITY, not a board scan of mod stacks. Owner picked it over the two cheaper readings. It is exact rather than approximate: composeParts() in engine.ts already returns one EffectPart per grafted mod that joins the ability\'s graftCause, so "parts" is the engine\'s own word for the thing being counted. queueTrigger now puts `parts` and `controller` on its `triggered` event — the single choke point all trigger dispatch shares — and stats.ts takes the max.',
      'ANSWERED 2026-08-30: damage counts EVERYTHING YOU DAMAGED, units and faces, not face-only. Owner chose it over the face-only reading. For the non-combat one this needed no summing of ours: the engine already puts `total` on the damage event, defined as "the damage this effect dealt" across the whole batch, past prevention and {Vulnerable} doubling.',
      'Comeback Kid was tightened during implementation: "win after dropping to 5 life or less" also has to END above 5. Without that it is Close Call with extra steps — the same win at 4 life would earn both, and neither would mean anything.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/server/achievements.ts',
      'client/server/stats.ts',
      'client/server/accounts.ts',
    ],
    notes:
      'Folded in from ~/Downloads/next-algomancy.txt on 2026-08-28, which was the only copy. '
      + 'ACHIEVEMENTS.length was 28 at that point and none of the eleven was among them. '
      + '⚠ Do not implement any of these as a bespoke predicate — the table\'s whole design is '
      + 'that every row is a counter and a goal, which is what lets the UI show "7 / 10" '
      + 'uniformly and what makes a new achievement retroactive by construction.',
  },
  {
    id: 'BL-32',
    slug: 'tuck-hand-during-draft',
    title: 'Tuck the hand dock while drafting or choosing the bottom two',
    area: 'client',
    size: 'S',
    status: 'done',
    evidence: {
      commit: '9ccc2f0',
      guards: [
        '216-menu-scoping.test.ts::§4a the duplication the report describes is real, and measured',
        '216-menu-scoping.test.ts::§4b TUCKED, NOT UNMOUNTED — the flight anchor survives',
        '216-menu-scoping.test.ts::§4c the dock comes back the moment the choice ends',
      ],
    },
    track: 'qol',
    said:
      'UX improvement idea: when drafting or choosing which 2 (in contructed) to put on the '
      + 'bottom, make the "hand" along the bottom of the screen slide down to not show. Since '
      + 'you can see your hand in the draft/recycle area, it\'s just duplicated and moving it '
      + 'off screen would let you more easily survey the battlefield at the same time',
    means:
      'The owner filed this through the in-game bug button as playtest report #113 and called it '
      + 'an "improvement idea" himself, so it is a QoL entry rather than a defect. The '
      + 'duplication is real and was measured: a draft state renders 16 `draftcard` elements and '
      + 'the SAME 12 hand cards again in `.handdock`. TUCK IT, DO NOT DELETE IT — see the traps.',
    doneWhen: [
      'During a draft, and during the constructed bottom-two choice, the hand dock is out of the way and the battlefield is unobstructed',
      'The cards are still reachable — tucked, not gone, so a player who wants to check their hand can',
      'Card flight animations still play into and out of the hand (this is the thing most likely to break)',
      'The dock returns to normal the moment the draft/bottom choice ends',
    ],
    decided: [
      'It is an idea, not a bug. Owner, playtest report #113, 2026-08-27: he wrote "UX improvement idea" in the report itself.',
      'Carried as CARD-TODO #99 only because an unanswered owner report must be carried there; this entry is its real home.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/main.ts',
      'client/ui/style.css',
    ],
    notes:
      '✔ DONE 2026-08-29. `handDockTucked()` in main.ts is true while a draft pack or the '
      + 'constructed bottom-two choice is open; `.handdock.tucked .zone` clips the row to an 18px '
      + 'strip and `:hover` gives it back. It came in at the S the entry estimated. '
      + 'BOTH TRAPS WERE REAL. (1) `$app.innerHTML` is replaced WHOLESALE on every paint — which '
      + 'cost nothing here, because a tuck keyed off state in pure CSS has no toggle to lose '
      + 'across a repaint and no transition that could never run. (2) `data-animzone="hand:N"` is '
      + 'on the dock and nowhere else in net mode. ⚠ THIS ONE IS SHARPER THAN THIS ENTRY PUT IT, '
      + 'and the correction is the reusable part: ui/anim.ts `real()` requires width AND HEIGHT > '
      + '0 before it will fly a card, so a dock CLIPPED TO ZERO drops every flight into and out '
      + 'of your hand exactly as silently as a dock that is unmounted. 18px is a real box in a '
      + 'real place, and that is the whole reason this is a CSS change and not an animation bug. '
      + 'MEASURED IN HEADLESS CHROME rather than reasoned about, because the CSS is the one '
      + 'surface test/ui-driver.ts cannot reach: 20px tucked, 130px on hover, 130px untucked — '
      + '110px of table given back, with `real()` true in all three states.',
  },
  {
    id: 'BL-33',
    slug: 'card-browser',
    title: 'Card browser — search and filter the whole pool, and build from it',
    area: 'client',
    size: 'L',
    status: 'done',
    track: 'feature',
    said:
      'The digital client desperatly needs a card viewer/searcher/scryfall like interface/'
      + 'filtering syntax. Please plan how to add all that and make it fully functional. I want '
      + 'to easily be able to find cards with certain text and features and everything including '
      + 'negative filtering, inclusive and exclusive searches, etc. It should also be nice and '
      + 'easy to use for deck building. I have an agent doing some work in the oracle text '
      + 'storage, but we may also need to do some more improvement and auditing to ensure it\'s '
      + 'all accurate and easy to work with and maintain.',
    means:
      'A browse page over EVERY card the oracle file knows (534, plus the three engine '
      + 'synthetics), driven by a Scryfall-shaped query language with AND/OR, parentheses and '
      + 'negation on both terms and groups. The query STRING is the page state: the facet rail '
      + 'rewrites it rather than holding filters of its own, and it rides in the URL, so a search '
      + 'is a link. The deck drawer runs the same parser over the same rows, so the two surfaces '
      + 'cannot disagree. And the oracle data underneath it is audited on every `npm test`.',
    doneWhen: [
      'A Cards page opens from the home screen and shows every card in the box, tokens and reference cards included and marked as not deck-legal',
      'The query bar takes `-el:fire (sub:sprite OR sub:demon) mana<=3` and answers it',
      'Clicking a facet chip once includes, twice excludes, and a third time clears it — and the query string in the box follows every click',
      'Typing in the box makes the chips follow, so the two never disagree',
      'A search can be sent to someone as a link and opens with the same results',
      'From a deck, the browser adds and cuts cards and the deck count moves as you do it',
      'The in-app syntax sheet lists every filter, and each example in it actually returns something',
      '`npm run audit:cards` is clean, and a stale entry in the accepted-findings list fails it',
    ],
    decided: [
      'Coverage is EVERYTHING. Owner, 2026-08-28: "Everything, but treat tokens, resources and the \'help\' cards as special, non-card cards." Hence the `class` field and `class:card` as a visible, removable chip rather than a hidden default.',
      'A bare word searches name, type line AND rules text — the owner\'s choice, and what the old drawer did, so nothing regressed.',
      'Synonyms are SUGGESTED, never applied. cards.py silently expands "deathtouch" to "deadly"; this does not, because a bar that searches for a word you did not type cannot answer "does any card actually say trample".',
      'catalogue.json is a SECOND file, not extra columns on printed.json: the engine spreads every printed field onto CardDef, and browse metadata has no business widening that trust boundary.',
      'The browser never touches deck state — it goes through a bridge into ui/decks.ts\'s single edit()/scheduleSave() funnel, so BL-14\'s debounce rules still hold.',
    ],
    asks: [],
    deps: ['BL-14'],
    touches: [
      'client/ui/cards.ts',
      'client/ui/cardindex.ts',
      'client/ui/cardsearch.ts',
      'client/ui/cardsynonyms.ts',
      'client/ui/decks.ts',
      'client/ui/main.ts',
      'client/ui/style.css',
      'client/engine/scripts/extract-printed.mjs',
      'client/engine/scripts/audit-cards.mjs',
      'client/engine/scripts/card-audit-known.mjs',
      'client/engine/src/cards/catalogue.json',
      'client/docs/15-card-browser.md',
    ],
    notes:
      'UNBLOCKS TWO ENTRIES, and both should reuse rather than rebuild. BL-06 (test mode) asks to '
      + '"search the whole card registry by name and put a chosen card into your hand" — that is '
      + '`ui/cardsearch.ts` over an unfiltered pool with a different tile button. BL-05 (cube) '
      + 'already says to reuse the card grid/search "rather than writing a second one".\n\n'
      + 'THE TRAP THAT COST THE MOST HERE: `src/apply.ts` registers a third synthetic card '
      + '(\'Alluring Attribute\'), so `allCardNames()` answers 494 or 495 depending on whether '
      + 'apply.ts happens to have been imported yet. The index had a different number of rows in '
      + 'a test than in the browser. ui/cardindex.ts now imports apply.ts for the side effect and '
      + 'says why. Suspect any count derived from the registry that was taken without it.',
    // Carried as `active` until 4d1b554 existed, because `evidence.commit` has to
    // be a real sha and this file's own test refuses a placeholder — which is
    // exactly the check that stops a backlog claiming credit ahead of the work.
    evidence: {
      commit: '4d1b554',
      guards: [
        'client/engine/test/210-cardsearch.test.ts',
        'client/engine/test/211-card-audit.test.ts',
        'client/engine/test/212-card-browser-wiring.test.ts',
      ],
    },
  },
  {
    id: 'BL-34',
    slug: 'deck-page-readable',
    title: 'The deck page grid — read a card, and stop at two copies',
    area: 'client',
    size: 'M',
    status: 'done',
    evidence: {
      commit: 'ab31457',
      guards: [
        'client/engine/test/214-deck-page-wiring.test.ts::the tile carries data-prev; the cap hides + and keeps −; the copy handler does not repaint',
        'client/engine/test/212-card-browser-wiring.test.ts::still green after the panel was extracted, so the two pages still do not import each other',
      ],
    },
    track: 'qol',
    said:
      "It's actually pretty hard to interactively build a deck in the normal viewer since you "
      + "can't see the cards in the deck without scrolling up, you can't see the text of the cards "
      + 'without opening their image in a new tab, etc. Plus, it\'s super easy to add more than 2 '
      + 'cards to a deck. Better to grey them out in the viewer and add a "focus window" like in '
      + 'the browse page',
    means:
      'The deck page\'s own card grid gets what BL-33 gave the browser\'s identical grid and never '
      + 'came back for: `data-prev` so the hover text box works, the whole tile as a click target '
      + 'that pins a card panel, and no competing native tooltip or name banner over the printed '
      + 'text. Beside that, two things the browser did not need — a sticky deck strip so the deck '
      + 'is on screen while you add to it, and the copy cap made visible: the ×n badge shows in '
      + 'the add drawer (it was hidden there, which is exactly why a third copy went in unnoticed) '
      + 'and at two copies the tile greys and stops offering +.',
    doneWhen: [
      'Hovering a card on the deck page shows its rules text, without opening anything',
      'Clicking a card pins it beside the grid, the way the browse page does',
      'The deck total, legality and curve stay on screen while you scroll the add drawer',
      // ⚠ AMENDED 2026-08-29 (round 31). The original read "...is greyed and offers no +, in
      // the deck AND in the drawer". Greying the deck grid meant that in a constructed deck,
      // where nearly every card is a two-of, MOST OF YOUR OWN DECK WAS GREY — the owner
      // reported it as "the cards are weirdly greyed out, for some reason". The requirement
      // (the cap must be legible, never left to counting corners) survives on three signals:
      // the drawn stack, the withheld +, and the red badge over the cap. The MECHANISM this
      // bullet named did not. Withholding + is unchanged everywhere.
      'A card you already have two of offers no + anywhere, and is greyed in the ADD DRAWER — '
        + 'where greying means "nothing more to take here". Never in your own deck grid',
      'It is still possible to SAVE a deck with three of something — the cap is an affordance, not a gate',
    ],
    decided: [
      'ONE PANEL, in ui/cardpanel.ts, imported by both pages. A second one on the deck page would '
      + 'drift from the browser\'s the way the two card filters drifted before ui/cardindex.ts. '
      + 'Note 212-card-browser-wiring.test.ts forbids the two PAGES importing each other, so a '
      + 'neutral third module is not merely tidier, it is the only shape available.',
      'The cap is offered, not enforced. server/collection.ts is explicit that a saved deck may be '
      + 'illegal while you build and that the rule bites when the deck is brought to a game; '
      + 'greying the tile must not become a refusal to hold an imported three-of.',
      'The name banner goes, for the owner\'s own reason on the browse page: "The name banner is '
      + 'blocking the card text from being read." The hover box and the panel both print it.',
    ],
    asks: [],
    touches: [
      'client/ui/decks.ts',
      'client/ui/cards.ts',
      'client/ui/cardpanel.ts',
      'client/ui/util.ts',
      'client/ui/style.css',
      'client/engine/test/214-deck-page-wiring.test.ts',
    ],
    notes:
      'Carries the Export-as-text copy button fix, which was the same class of bug: the deck page '
      + 'had grown its own clipboard path and main.ts had the working one. The deck page\'s called '
      + '`navigator.clipboard` ONLY — undefined on the plain-http LAN deploy, so it never once '
      + 'copied there — and its fallback selected the textarea and then repainted the page, '
      + 'throwing away the selection it had just told the reader to copy. One `copyText` in '
      + 'ui/util.ts now, used by both.',
  },
  {
    id: 'BL-35',
    slug: 'deck-sharing',
    title: 'Publish a deck — visibility, a share link, and lineage',
    area: 'accounts',
    size: 'M',
    status: 'done',
    evidence: {
      commit: 'ab31457',
      guards: [
        'suite.test.ts::test-collection.ts — private is the default; a private deck and a nonexistent one answer identically; a copy is never born public; the lineage fold survives a deleted parent and a cycle',
        'suite.test.ts::test-collection.ts — the unauthed /api/deck/{shared,meta,played} routes, and that nothing on the meta list is private or unlisted',
      ],
    },
    track: 'feature',
    said:
      'There should be a way to easily share decklists via a link of some kind ... I want to be '
      + 'able to set decks public so that they appear in a list of some kind. I want to be able to '
      + 'share my decks with people on my profile ... In a similar vein, decks that are public can '
      + 'start showing up in a "meta game" list page which has some basic filters and sorts (by '
      + 'default) by winrate',
    means:
      'A deck gains a visibility — private (the default, and what every existing deck reads as), '
      + 'unlisted (anybody with the link) and public (the link, your profile, and the metagame '
      + 'page). A share link is `?deck=<id>` and opens on a cold load for a logged-out visitor. '
      + 'Taking a copy of somebody\'s shared deck stamps `copiedFrom`, and the metagame record is '
      + 'folded over the whole LINEAGE — without that a popular list reads as a dozen decks with '
      + 'two games each.',
    doneWhen: [
      'A deck can be set private / unlisted / public, and starts private',
      'A share link opens the deck for somebody who is not logged in',
      'A private deck\'s link does not open, and answers exactly as a link to no deck at all does',
      'A public deck is on its owner\'s profile and on the metagame page; an unlisted one is on neither',
      'Taking a copy puts it in your collection, private, credited to whoever built it',
      'A deck\'s metagame record counts the games played with it AND with its copies',
    ],
    decided: [
      'Private is the default and is enforced in ONE place (server/publicdecks.ts `visibilityOf`, '
      + 'which reads an absent or unrecognised field as private). Every export in that file asks it.',
      'A private deck and a deck that does not exist give the SAME answer. A distinguishable one '
      + 'would make the endpoint an oracle for "does this id exist", which is what an unlisted '
      + 'link\'s secrecy rests on.',
      'A copy is never born public. Inheriting the parent\'s visibility would publish somebody\'s '
      + 'deck on their behalf the moment they clicked "take a copy".',
      'Public reads live on /api/deck/*, not /api/decks/*: everything under the latter is behind a '
      + '401 because a collection belongs to an account, and these answer for anybody.',
      'Winrate is folded by lineage. Owner, 2026-08-28, choosing between the owner\'s own record '
      + 'and the lineage: the lineage, so a popular deck accumulates a real sample.',
    ],
    asks: [],
    deps: ['BL-14'],
    touches: [
      'client/server/collection.ts',
      'client/server/publicdecks.ts',
      'client/server/api-decks.ts',
      'client/server/api-accounts.ts',
      'client/server/main.ts',
      'client/ui/decks.ts',
      'client/ui/meta.ts',
      'client/ui/account.ts',
      'client/server/test-collection.ts',
    ],
    notes:
      'THE SAMPLE IS EMPTY AND THE PAGE HAS TO SAY SO. Of the 4679 history rows in accounts.json '
      + 'when this was built, ZERO carried `deckIds` and only three games had ever been '
      + 'constructed — `deckIds` is stamped nowhere else (rooms.ts persists it for constructed '
      + 'only). The plumbing is real and the corpus is not there yet, so the metagame page ranks '
      + 'nothing until decks have five games and lists the rest under a divider that explains why. '
      + 'Do not "fix" the empty winrate column by lowering the floor.',
  },
  {
    id: 'BL-36',
    slug: 'deck-descriptions',
    title: 'Deck descriptions, with the card names in them hoverable',
    area: 'client',
    size: 'M',
    status: 'done',
    evidence: {
      commit: 'ab31457',
      guards: [
        'client/engine/test/213-cardlinks.test.ts::the sweep: only <a> and four attributes ever come out, every data-prev is a real card, a hostile target makes no link',
        'client/engine/test/213-cardlinks.test.ts::a one-word name that is also a GLOSSARY term does not auto-link, derived from the two tables rather than listed',
      ],
    },
    track: 'feature',
    said:
      'Decks should be able to have a description (markdown friendly) for writing about how it '
      + 'works and maybe how to play it. It should just show the first few sentences by default '
      + 'and expand when clicked. The descriptions should also automatically let card names be '
      + 'hoverable and show the cards (which is nice if the person mentions the cards in the '
      + 'descirpiton but you don\'t know the names of everything yet). And can be specially done '
      + 'with this syntax: [Any Text](Actual Card Name) (but any real card name found in the desc '
      + 'will automatically have the hover without the special markdowning)',
    means:
      'A markdown description on a deck, clipped to its first sentences with the rest behind a '
      + 'click, rendered through ui/markdown.ts. Card names in it become hover links — both the '
      + 'explicit [Text](Card Name) form and any bare name found in the prose.',
    doneWhen: [
      'A deck can carry a markdown description, and it renders as markdown',
      'It shows the first few sentences and expands on a click',
      'A bare card name in the prose hovers and shows the card',
      '[Any Text](Actual Card Name) links to that card whatever the text says',
      'A name that is not a card is left as plain text, and nothing a writer types becomes markup',
    ],
    decided: [
      'ui/markdown.ts IS NOT MODIFIED. Its two invariants — raw text enters in exactly one place, '
      + 'and no attribute is ever emitted — are why it is safe, and it says outright that link '
      + 'syntax "must not be" implemented there. The card linking goes in the `inline` hook that '
      + 'module already documents and main.ts already uses (it passes `iconizeText`).',
      'The ONE attribute is safe because its value always comes from `rowFor`, never from the '
      + 'writer: an unrecognised target produces no link at all. So the attribute\'s value set is '
      + 'the card pool, and no input can widen it. A deck description is the first user text this '
      + 'client renders on OTHER people\'s screens, so 213 sweeps the output to hold that.',
      'The single-word exclusion is DERIVED, not a stoplist: 140 pool names are one word and some '
      + 'are rules vocabulary (Battle, Trash, Cache, Rot, Debt, Augment, Graft), so a one-word '
      + 'name that is also a GLOSSARY term does not auto-link. ui/glossary.ts already carries that '
      + 'table and its GlossEntry even has an `re` field for "terms that are also ordinary '
      + 'English" — the same problem, already solved once. A hand-written list would be right '
      + 'today and wrong the next time a card is printed.',
      'Matching is case-sensitive, which does the rest: prose says "we fight early", the card is '
      + '`Fight`. Anybody who means the card can say so explicitly.',
      'The clip is made on the SOURCE, never on rendered markup — cutting HTML at a character '
      + 'count is how a renderer starts emitting half a tag.',
    ],
    asks: [],
    deps: ['BL-35'],
    touches: [
      'client/ui/cardlinks.ts',
      'client/ui/markdown.ts',
      'client/ui/decks.ts',
      'client/ui/meta.ts',
      'client/server/collection.ts',
      'client/engine/test/213-cardlinks.test.ts',
    ],
    notes:
      'The description rides the deck page\'s existing 500ms debounce, which means '
      + '`flushSave` had to start SENDING it — `updateDeck` applies only the fields it is sent, so '
      + 'leaving it out made publishing a setting that never reached the server while the local '
      + 'copy (which is the truth during a pending save) made it look like it had.',
  },
  {
    id: 'BL-37',
    slug: 'match-clock',
    title: 'A wall-clock match timer — how long a game ACTUALLY takes',
    area: 'server',
    size: 'S',
    status: 'done',
    evidence: {
      commit: '72a0a33',
      guards: [
        'suite.test.ts::test-match-clock.ts — BL-37 the MATCH clock',
        '277-match-length.test.ts::BL-37 \u00a71 the match length reads as a person would say it',
        '277-match-length.test.ts::BL-37 \u00a71 a timed game says how long it took',
        '277-match-length.test.ts::BL-37 \u00a72 a game that measured nothing prints no length at all',
        '277-match-length.test.ts::BL-37 \u00a72 \u2026and neither does an explicit zero',
      ],
    },
    track: 'feature',
    said:
      'a global wall-clock match timer — literal elapsed time, not double-counting per-player '
      + 'time — saved with the game to track average game length and tune the clocks',
    means:
      'One clock for the TABLE, beside the two chess clocks. BL-26 made the bank a per-room '
      + 'setting and BL-27 made running out of it lose the game, and both of those are guesses '
      + 'until somebody knows how long a game here actually takes. So: measure it, save it with '
      + 'the game, and report the average.',
    doneWhen: [
      'A finished game carries how long it took, in its saved file',
      'The number is LITERAL elapsed table time, not the two banks added together',
      'A room with the clock OFF is timed too — that is the room whose length you most need',
      'A game played before the timer existed reads as UNKNOWN, never as a nought-length game',
      'The average is available somewhere the owner will actually see it',
    ],
    decided: [
      'It cannot be derived from `clockMs`, which is why it is a field. Two banks of 45 minutes are ninety minutes of clock and one game, so adding the consumed halves answers "how much thinking happened" rather than "how long were we sitting here" — the owner\'s "not double-counting per-player time", exactly. And a room with the clock off has no banks at all.',
      'It stops for the same reasons the chess clocks stop, and from the SAME predicate: `matchRunning` was factored OUT of `clockRunning`, which now reads "this room has a clock" plus `matchRunning`. Two copies of that list would drift, and the drift would be invisible — both numbers would still look plausible.',
      'BOTH SEATS CONNECTED is part of "running", and it is the one arm worth arguing about. An overnight gap with a closed tab is not match length and counting it would make the average useless for the thing it is for. `startedAt` is stored beside it so the raw wall interval stays recoverable and the rule can be judged rather than trusted.',
      'ABSENT, NOT ZERO. Every game in the archive predates this, so an unmeasured game carries no field at all — `matchLengths` skips it and reports `n`, and the post-game screen omits the line. A 0 folded into an average would drag it toward nothing while looking like data.',
      'The MEDIAN is reported beside the mean. Match length is exactly the shape that has outliers: one game left open over a lunch break moves a mean of six games by ten minutes and moves the median not at all.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/server/rooms.ts',
      'client/server/history.ts',
      'client/server/accounts.ts',
      'client/server/main.ts',
      'client/ui/postgame.ts',
      'client/server/test-match-clock.ts',
      'client/engine/test/277-match-length.test.ts',
    ],
    notes:
      'DONE 2026-09-01, the same day it was asked for. `Room.matchMs` counts UP and has no floor '
      + '(it is a record, not a resource), billed by `settleClock` off the same stamp and the '
      + 'same interval as the two banks so the three numbers always measure the same instants. '
      + 'Persisted with the room, carried across a restart, and the hours the server was DOWN '
      + 'are not billed to it — `matchRun` is false after a restore and `clockStamp` is now, '
      + 'which is the same trick BL-27 already used to stop anybody losing on time they never '
      + 'spent.\n\n'
      + 'THREE SURFACES: the saved file, the post-game screen ("shared \u00b7 7 turns \u00b7 47m"), '
      + 'and a startup log line over the whole history — "match length over 12 timed games: '
      + 'median 41m, mean 46m, longest 88m". The startup line is the one that answers the ask: '
      + 'it is where the operator already looks and it is what a bank should be chosen from. '
      + '⚠ It prints n and the median as well as the mean, deliberately — see `decided`.\n\n'
      + 'The one judgement call worth revisiting: `matchMs` excludes time when a seat was '
      + 'disconnected. That is right for "how long does a game take" and wrong for "how long was '
      + 'this room open"; `startedAt` keeps the second question answerable without changing the '
      + 'first.',
  },
  {
    id: 'BL-38',
    slug: 'match-replays',
    title: 'Watch a finished game back from its saved file',
    area: 'server',
    size: 'M',
    status: 'open',
    track: 'feature',
    said: 'We want to allow spectators and match replays, but that\'s its own feature, yes.',
    means:
      'The other half of what BL-29 used to be, and it is spun out because the owner\'s '
      + '2026-09-01 answer ("Just omniscient and live is fine for now") split them: a LIVE '
      + 'omniscient view needed no redaction work at all and landed the same day, while this '
      + 'half is almost entirely about a problem the live one does not have — an old log on a '
      + 'newer engine. Every room file is seed plus action log and server/replay-room.ts '
      + 'already replays one through the current engine, so the machinery exists; what does '
      + 'not exist is a viewer, and a viewer that quietly showed a RECONSTRUCTED game instead '
      + 'of saying so would be lying to the person watching.',
    doneWhen: [
      'A finished game can be watched back from its saved file, with step and scrub controls',
      'A replay whose log no longer reproduces SAYS so, and distinguishes DRIFT (the rules moved; the file is fine) from a FORK (the server rebuilt a live game and play continued) — replay-room.ts already makes that verdict, so reuse it rather than re-deriving it',
      'The viewer shows the board as it was AT THAT MOMENT, not the board a modern engine would produce from the same log',
      'A game that cannot be replayed at all is listed and says why, rather than being absent',
    ],
    decided: [
      'Spun out of BL-29 on 2026-09-01. BL-29\'s old `decided` line said spectate and replay were one entry "because they are the same viewer over two sources", which was true while both were unbuilt and stopped being true the moment one shipped. The live viewer reuses `spectatorView` and a socket; this one reuses a replay and a scrubber, and they share only the word "watch".',
      'THE VERDICT IS NOT OPTIONAL. replay-room.ts distinguishes ENGINE DRIFT from a FORK and CT-160 now FREEZES a forked live room rather than continuing it. A replay viewer that showed the rebuilt board without the verdict would undo that work at the one moment somebody is looking for evidence.',
    ],
    asks: [
      'Does a replay show the game as the PLAYERS saw it (each seat\'s hidden information hidden, switchable) or omniscient like the live spectator view? The live answer was "omniscient and live is fine for now" and this may well inherit it — but a finished game is the one case where hiding is cheap and a "watch it the way I played it" mode is worth something, so it should be asked rather than assumed.',
    ],
    deps: ['BL-29'],
    touches: [
      'client/server/replay-room.ts',
      'client/server/main.ts',
      'client/ui/main.ts',
    ],
    notes:
      'The forensic half is already built and tested: replay-room.ts, `driftedAgainst`, the '
      + '`forks` record, R200\'s version stamps and CT-160\'s freeze. The work here is a '
      + 'viewer over what they already say, plus the honesty of showing their verdict.',
  },
  {
    id: 'BL-39',
    slug: 'discord-account-link',
    title: 'Discord linking — one person, two accounts, proved',
    area: 'accounts',
    size: 'M',
    status: 'done',
    track: 'feature',
    said:
      'Integration with the matchmaking queue (use a slash command to set a channel as a '
      + 'queue watcher, then recieve a message/invite each time someone joins the queue and '
      + 'invites people who see it via discord to join and play) ... Generally link between '
      + 'the two and make them feel unified',
    means:
      'A Discord user can prove they own an Algomancy account, so the bot can answer '
      + '"what is MY rating" without anybody typing a username, and a queue announcement can '
      + 'name the person rather than a string.',
    doneWhen: [
      'A signed-in player presses Link Discord on their profile page, gets a six-character code, types `/link code <it>` in Discord, and the bot replies with their Algomancy username',
      '`/profile` and `/rating` with no arguments answer about the person who ran them',
      'One Discord account links to exactly one game account and vice versa; a second attempt is REFUSED with a sentence naming what it collided with, never silently overwritten',
      'Unlinking works from the profile page AND from Discord — the web side is the durable one, because there is no password reset',
      'A link survives a finished game (which rebuilds every profile) and a server restart',
      'With no bot token configured the link routes 404 and the profile page shows no Connections block at all',
    ],
    decided: [
      'THE CLIENT MINTS AND DISCORD CLAIMS, not the reverse. Both directions prove as much — the mint is bearer-authed and `interaction.user.id` is asserted by Discord — so the tiebreaker is where the secret lives. Minting on the profile page means it exists only on the player\'s own signed-in screen until they type it. The other way round it is born in a Discord message and redeemed where somebody is LEAST likely to already be signed in, so the flow ends at a login prompt with a live code in the clipboard.',
      '`Account.linked` is TOP-LEVEL, never on `profile`. rebuildProfiles() does `a.profile = emptyProfile()` and recordLiveGame calls it on every finished game, so a link on the profile would be erased the first time anybody played.',
      'No new account tab. account.ts\'s tab router parses its name from a hand-written allow-list and `decks` was once missing from it, silently rendering the stats page; one row of content is not worth that risk twice.',
    ],
    touches: [
      'client/server/link.ts',
      'client/server/api-link.ts',
      'client/server/accounts.ts',
      'client/ui/account.ts',
      'bot/cogs/account.py',
    ],
    evidence: {
      commit: 'd1a69c5',
      guards: [
        '281-discord-link.test.ts::BL-39 §3 minting again replaces, so only one code is ever live',
        '281-discord-link.test.ts::BL-39 §4 wrong and expired are the same answer',
        // the server scripts run through the suite runner — see BL-01's row
        'suite.test.ts::test-bot.ts — §8b one Discord account cannot link to a SECOND game account',
        'suite.test.ts::test-bot.ts — §8c THE LINK SURVIVED A RESTART',
      ],
    },
  },
  {
    id: 'BL-40',
    slug: 'discord-queue-notifications',
    title: 'The matchmaking queue reaches Discord',
    area: 'play',
    size: 'M',
    status: 'done',
    track: 'feature',
    said:
      'use a slash command to set a channel as a queue watcher, then recieve a message/invite '
      + 'each time someone joins the queue and invites people who see it via discord to join and play',
    means:
      'A channel can be marked with `/queuewatch`, and every join of the matchmaking queue '
      + 'posts there — who, which format, how many are waiting — with an optional role ping '
      + 'and a button to the client.',
    doneWhen: [
      'A player joining the queue produces a message in the watched channel within seconds, naming them and the format',
      'An optional role is pinged, and `@everyone` is refused outright',
      'The same person queueing repeatedly does not repeat the announcement',
      'A bot that is down or restarting misses nothing it can recover: it catches up from the server\'s replay ring, and SAYS SO when the gap is older than the ring holds',
      'A bot that is unreachable costs the game server nothing — players still pair, and the server is still running afterwards',
      'Old announcements are left alone; there is no auto-cleanup',
    ],
    decided: [
      'PUSH, NOT POLL, and not for latency: /api/queue returns counts only on purpose, so a poller could never name anybody, and a join can pair and resolve inside one 1s tick so a poll would not reliably see it at all.',
      'The server emits FACTS. Which channel, which role, how often — all bot-side. The game server must never learn a Discord role id.',
      'NO AUTO-CLEANUP of stale announcements — the owner\'s call. A watch pointing at a deleted channel IS dropped, which is a different thing: without it one deleted channel raises on every queue join for ever.',
    ],
    deps: ['BL-01', 'BL-39'],
    touches: [
      'client/server/hooks.ts',
      'client/server/main.ts',
      'bot/pushserver.py',
      'bot/watchers.py',
      'bot/cogs/queuewatch.py',
    ],
    notes:
      'The dangerous half is hooks.ts: it fires from inside sweepQueue(), on the same 1s timer '
      + 'that makes a stalled rated game end in a result (BL-27). An unhandled rejection there '
      + 'kills the process, run-server.sh respawns, and every live room replay-restores — which '
      + 'is what test-bot.ts §10 is really guarding, after an earlier version of it asserted '
      + 'something that could not fail. The bot half has its own guards, which this ledger '
      + 'cannot cite because it only accepts .test.ts: `bot/test/test_queuewatch.py` §4 (the '
      + 'push handler returns before the fan-out finishes) and §1 (a corrupt watch file reads '
      + 'as empty rather than stopping the bot from booting). Run them with '
      + '`.venv/bin/python bot/test/test_queuewatch.py`.',
    evidence: {
      commit: 'e61d372',
      guards: [
        'suite.test.ts::test-bot.ts — §10 THE SERVER IS STILL RUNNING after a batch of pushes failed',
        'suite.test.ts::test-bot.ts — §9 the replay ring says when it has a gap',
      ],
    },
  },
  {
    id: 'BL-41',
    slug: 'card-search-over-http',
    title: 'The card query language, for readers that are not the browser',
    area: 'server',
    size: 'S',
    status: 'done',
    track: 'feature',
    said: 'Redo the card search to use the Scryfall like searching',
    means:
      'The bot\'s `/search` speaks the same `el:fire mana<=3` the card page does, by asking '
      + 'the game server — so there is one grammar, not a second one in Python that drifts.',
    doneWhen: [
      '`/search el:fire mana<=3` in Discord returns the cards the browser returns for the same query',
      'A query with an unclosed quote still answers, and says it guessed',
      'The answer says when an implicit `class:card` narrowed it',
      'The bot contains no copy of the grammar',
    ],
    decided: [
      'server/ imports ui/cardsearch.ts directly rather than moving the trio to a shared package. Counted rather than guessed: the move is 17 import edits plus 9 engine tests, for one consumer. The trigger for doing it anyway is recorded in api-cardsearch.ts.',
      'THE EDGE PAYS FOR ITSELF: ui/tsconfig.json has DOM in its lib and the server\'s does not, so importing the trio compiles it without DOM for the first time and turns cardindex.ts\'s "pure and DOM-free" comment into a build error.',
      'The BM25 describer SURVIVES as /find. A filter answers none of the questions a description answers, and deleting it would also break app.py\'s /api/search, which the web front-end renders.',
    ],
    touches: [
      'client/server/api-cardsearch.ts',
      'client/ui/cardsearch.ts',
      'bot/gameserver.py',
      'bot/cogs/cardlookup.py',
    ],
    evidence: {
      commit: 'f303bb7',
      guards: [
        '280-cardsearch-api.test.ts::BL-41 §3 total reports every match, not the page that came back',
        '282-dom-free-trio.test.ts::BL-41 §2 server/ imports only the search trio from ui/',
      ],
    },
  },
];
