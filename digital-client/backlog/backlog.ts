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
 * Nothing in here outranks the card/engine work. `engine/test/card-todo.ts` is
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
    status: 'open',
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
      'Pairing is FIRST-COME, not rated. Owner, 2026-08-25: "For now, anyone with anyone. If we get enough oplayers to be picky, we can do that later." — build strictly first-two-in-line. Rating-aware pairing is a later option that needs a population to be worth anything, so do not build the widening-search version now.',
    ],
    asks: [],
    deps: [],
    touches: [
      'digital-client/server/main.ts',
      'digital-client/server/rooms.ts',
      'digital-client/server/accounts.ts',
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/ui/account.ts',
    ],
    notes:
      'Prior art in the tree: the rematch handshake in rooms.ts builds the room server-side '
      + 'rather than having a client create it, and roomWaiting() already generalizes "this '
      + 'room is waiting for a second person". Both are the shape a queue wants.',
  },
  {
    id: 'BL-02',
    slug: 'elo-and-leaderboard',
    title: 'Elo ratings and a leaderboard',
    area: 'accounts',
    size: 'M',
    status: 'open',
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
      'A doubly-abandoned game counts as nothing. Owner, 2026-08-25: "Both players abandon? Just don\'t count it. But we\'ll make the timer actally cause a game loss before launching to prevent BMing." — server/history.ts already lands these as `finished: false`, so the fold skips them. The second half of that answer is not this entry: it is BL-27, and once it lands, a player who walks away from a running clock loses rather than producing one of these.',
    ],
    asks: [],
    deps: [],
    touches: [
      'digital-client/server/stats.ts',
      'digital-client/server/history.ts',
      'digital-client/server/accounts.ts',
      'digital-client/server/seed-accounts.ts',
      'digital-client/engine/ui/account.ts',
    ],
    notes:
      'Does NOT depend on BL-01 — ratings can be computed from games already on disk. Ship '
      + 'this first if the queue stalls on the pairing question.',
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
      'digital-client/engine/src/apply.ts',
      'digital-client/server/rooms.ts',
      'digital-client/engine/ui/main.ts',
      'puzzles',
    ],
    notes:
      'The bot half of this repo has puzzles/*.json and doc 06 M5 lists "puzzle mode" — that '
      + 'is a DIFFERENT idea and the owner did not pick it. Do not quietly build puzzles '
      + 'instead. The seam to drive an opponent already exists: forcedAction() in apply.ts is '
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
      'digital-client/server/main.ts',
      'digital-client/server/rooms.ts',
      'digital-client/server/accounts.ts',
      'digital-client/engine/ui/lobby.ts',
      'digital-client/engine/ui/main.ts',
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
      'digital-client/server/main.ts',
      'digital-client/server/rooms.ts',
      'digital-client/server/decks.ts',
      'digital-client/server/trio.ts',
      'digital-client/engine/ui/lobby.ts',
      'digital-client/engine/src/cards/registry.ts',
    ],
    notes:
      'Trap: the existing draft code is the LIVE draft (draftDeckList, draftCommit, packs '
      + 'refreshed every N+1 turns, redaction of your own pack during the draft step). Almost '
      + 'none of it transfers — this is a separate pregame pod draft. Reuse the deckbuilder '
      + 'from BL-14 rather than writing a second one. '
      + 'FOR INFORMATION, not an override: the printed manual (Rules/Algomancy-Manual.txt, '
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
    status: 'open',
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
      'digital-client/engine/src/apply.ts',
      'digital-client/engine/src/engine.ts',
      'digital-client/server/rooms.ts',
      'digital-client/engine/ui/main.ts',
    ],
    notes:
      'Design constraint worth respecting: the engine is a pure reducer and its purity is '
      + 'why replay, undo and the fuzzer all work. Test-mode cheats should be ACTIONS in the '
      + 'log (a `sandboxSpawn` action, say), gated to sandbox rooms — not out-of-band state '
      + 'mutation, which would break replay for the one mode most likely to be used to '
      + 'reproduce a bug report.',
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
      'THE MULTIPLAYER COMBAT RULES ARE PRINTED, AND THEY ARE DETAILED. Owner, 2026-08-25, asked whether the 1v1 counterattack generalises: "It\'s all in the manual and fairly detailed." Checked — Rules/Algomancy-Manual.txt, the "_ MULTIPLAYER" spread. It does not generalise; it depends on the format. Every line below this one is quoted from that spread, so nobody has to go hunting for it — but go and read it anyway before designing any of this.',
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
      'digital-client/engine/src/engine.ts',
      'digital-client/engine/src/types.ts',
      'digital-client/engine/src/apply.ts',
      'digital-client/server/view.ts',
      'digital-client/server/rooms.ts',
      'digital-client/engine/ui/main.ts',
    ],
    notes:
      'doc 06 M5 already lists "FFA intents (commit-reveal); teams" as beyond-v1 work — and '
      + 'the manual confirms that framing exactly: FFA really is intent cards flipped at '
      + 'once. READ THE MANUAL BEFORE DESIGNING ANY OF THIS: Rules/Algomancy-Manual.txt, the '
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
      'The manual makes the target easier than it looks: outside battle, FFA phases are meant to be played by everyone at once (Rules/Algomancy-Manual.txt, "SIMULTANEOUS TURNS"). Parallel planning and deployment are the PRINTED rule, not an optimisation this entry has to justify.',
    ],
    asks: [],
    deps: ['BL-07'],
    touches: [
      'digital-client/engine/src/engine.ts',
      'digital-client/engine/src/apply.ts',
      'digital-client/server/rooms.ts',
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
      'digital-client/docs/07-visual-redesign.md',
      'digital-client/docs/09-visual-clarification.md',
      'digital-client/engine/ui/layouts.json',
      'digital-client/engine/ui/layout-editor.html',
      'digital-client/engine/ui/style.css',
      'digital-client/engine/ui/main.ts',
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
      'digital-client/engine/ui/style.css',
      'digital-client/engine/ui/anim.ts',
      'digital-client/engine/ui/motion.ts',
      'digital-client/engine/ui/flash.ts',
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
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/ui/glossary.ts',
      'digital-client/engine/ui/index.html',
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
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/ui/glossary.ts',
      'digital-client/docs/digital-rules.md',
      'Rules',
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
      'No individual decklist is reachable from it, by URL or otherwise',
      'It is recomputed by the same fold as profiles, so the two can never disagree',
      'A format with too few games says so rather than showing noise as signal',
      'The same aggregates can be read all-time and over a recent window, off one fold rather than two code paths',
    ],
    decided: [
      'Decklists are secret; aggregates are public. Owner, 2026-08-24, unprompted and explicit.',
      'Archetypes are COMPUTED, not tagged — and not soon. Owner, 2026-08-25: "We won\'t implement this for a long while, but I think we can do it based on calculations of \'cards in common\' and multidimentional space. Something like \'this set of XYZ cards in this combination of elements defines this deck\'. Then players can give it a name somehow." — cluster on card overlap plus element combination, and let players name a cluster after the fact. Note the first clause: he expects this to be far off, so SHIP THE PAGE WITHOUT ARCHETYPES. Card, element and trio aggregates are a complete first version.',
      'Both time windows. Owner, 2026-08-25, asked all-time only or 30-day slices: "Both, why not."',
    ],
    asks: [],
    deps: ['BL-14'],
    touches: [
      'digital-client/server/stats.ts',
      'digital-client/server/history.ts',
      'digital-client/server/decks.ts',
      'digital-client/engine/ui/account.ts',
    ],
    notes:
      'The privacy decision has a real consequence: aggregates must be computed server-side '
      + 'from lists nobody can read back out. Do not build a "top decks" view that '
      + 'reconstructs a list from its aggregate.',
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
      'digital-client/server/collection.ts',
      'digital-client/server/api-decks.ts',
      'digital-client/server/api-util.ts',
      'digital-client/server/decks.ts',
      'digital-client/server/default-decks.json',
      'digital-client/server/accounts.ts',
      'digital-client/server/rooms.ts',
      'digital-client/server/history.ts',
      'digital-client/engine/ui/decks.ts',
      'digital-client/engine/ui/deckstats.ts',
      'digital-client/engine/ui/util.ts',
      'digital-client/engine/ui/main.ts',
    ],
    notes:
      'server/decks.ts and default-decks.json already existed and were the right starting '
      + 'point — the importer and the bundled five were reused whole, and the new work is the '
      + 'collection ON the account plus the page. Two things worth knowing before touching it: '
      + "(1) a deck's record is DERIVED from the game history by deck id, never counted, so it "
      + 'cannot drift — which means the id has to survive the wire, and the server re-reads the '
      + 'deck out of the account behind the token rather than trusting the id sent; (2) the '
      + 'curve/split/affinity arithmetic lives in a pure DOM-free module (engine/ui/deckstats.ts) '
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
      'digital-client/engine/ui/index.html',
      'digital-client/engine/ui/main.ts',
      'digital-client/README.md',
    ],
    notes:
      'S in effort, but it is a BLOCKER on the public deploy that the rest of this backlog '
      + 'assumes. Cheap and unblocking — a good candidate for the first down-time slot.',
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
      'digital-client/server/accounts.ts',
      'digital-client/server/api-accounts.ts',
      'digital-client/server/main.ts',
      'digital-client/server/rooms.ts',
      'digital-client/engine/ui/account.ts',
    ],
    notes:
      'Two things were flagged here as "raise with the owner rather than silently fix". '
      + 'NAME CLAIMING was raised on 2026-08-25 and answered — it is now BL-28, with his rule '
      + 'recorded verbatim. NO EMAIL AND THEREFORE NO PASSWORD RESET is still unraised: it '
      + 'was not among the 29 questions, and it is still a real problem for a public deploy '
      + 'with strangers. Ask it next time; do not invent an answer.',
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
      'digital-client/server/accounts.ts',
      'digital-client/server/api-accounts.ts',
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/ui/inspect.ts',
      'digital-client/docs/digital-rules.md',
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
    status: 'open',
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
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/src/apply.ts',
      'digital-client/server/rooms.ts',
    ],
    notes:
      'Trap recorded in the tree: forcedAction() lives in apply.ts but is drained by the '
      + 'SERVER and the hotseat act(), never by the engine — engine-side auto-skip broke 242 '
      + 'scripted tests and was reverted. Full control must switch it off at the drain site, '
      + 'not inside the reducer.',
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
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/ui/formation.ts',
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
    status: 'open',
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
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/ui/inspect.ts',
    ],
    notes:
      'The entries themselves are decided in ui/inspect.ts (boardMenuEntries), where they are '
      + 'tested; main.ts only hangs behaviour on them. Change the composition at the call '
      + 'site in the contextmenu handler and update inspect.ts\'s tests to match. Watch the '
      + 'card-back branch — it currently falls back to boardMenuItems() precisely so the '
      + 'click is not dead.',
  },
  {
    id: 'BL-21',
    slug: 'deployment-reveal-readability',
    title: 'The deployment reveal is unreadable, and repeats itself afterwards',
    area: 'client',
    size: 'M',
    status: 'open',
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
      'digital-client/engine/ui/main.ts',
      'digital-client/server/rooms.ts',
      'digital-client/server/view.ts',
    ],
    notes:
      'Mechanism: the server sends a `reveal` field on the deploy-end flush and the events '
      + 'are flushed as a `replay`; sendReveal in main.ts paints the interstitial. The '
      + '"flurry after dismissing" is almost certainly that replay being animated a second '
      + 'time by the normal event path once the overlay clears — check whether the reveal '
      + 'consumes the events or merely previews them.',
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
      'digital-client/engine/ui/cardtext.ts',
      'digital-client/engine/ui/main.ts',
      'digital-client/docs/12-card-text.md',
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
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/ui/style.css',
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
      'digital-client/engine/src/engine.ts',
      'digital-client/engine/test/73-play-into-formation.test.ts',
      'digital-client/engine/test/playtest-ledger.ts',
      'digital-client/engine/test/card-todo.ts',
      'digital-client/engine/src/cards/sets/batch-fire-a.ts',
      'digital-client/engine/src/cards/sets/batch-metal-b.ts',
      'digital-client/engine/src/cards/sets/batch-water-a.ts',
      'digital-client/engine/src/cards/sets/batch-light-a.ts',
    ],
    notes:
      'IMPORTANT — there is prior work here and it must be read before touching anything. '
      + 'playtest-ledger.ts records a fix that introduced TWO distinct mechanisms: '
      + 'CardBehavior.playsIntoFormation with a \'formation\' cast (play-time placement, for '
      + 'Tiderunner, which was wrongly folded into the create-in-formation class), and '
      + 'placeInFormation kept for the genuine create-in-formation class (R75). '
      + '73-play-into-formation.test.ts guards the first. A regression in one of the two, or '
      + 'a card wired to the wrong one, is the most likely cause. '
      + 'CROSS-REFERENCE: this probably also belongs in engine/test/card-todo.ts with a proof '
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
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/src/engine.ts',
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
    status: 'open',
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
      'digital-client/server/rooms.ts',
      'digital-client/server/main.ts',
      'digital-client/server/test-clock.ts',
      'digital-client/engine/ui/lobby.ts',
      'digital-client/engine/ui/main.ts',
    ],
    notes:
      'server/test-clock.ts is the guard, and it already learned this lesson once: its '
      + 'comment says it "hardcoded 40:00 and silently went red when rooms.ts moved to '
      + '60:00", so it imports CLOCK_START_MS now. Extend it rather than restating numbers. '
      + 'The clock is genuinely display-only today — rooms.ts: "clamp at zero (display only '
      + '— no enforcement)" — so nothing depends on the current value except the display and '
      + 'that test. clockMs is already persisted per room, which is most of the persistence '
      + 'half of this entry.',
  },
  {
    id: 'BL-27',
    slug: 'clock-expiry-loses',
    title: 'Running out of time loses the game — the anti-BM rule, before launch',
    area: 'server',
    size: 'M',
    status: 'open',
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
      'digital-client/server/rooms.ts',
      'digital-client/server/main.ts',
      'digital-client/server/history.ts',
      'digital-client/server/test-clock.ts',
      'digital-client/engine/ui/main.ts',
    ],
    notes:
      'The seam is settleClock() in server/rooms.ts, which is called after anything that '
      + 'changes the running set and already clamps at zero. The winner stamp is Room.winner '
      + 'and decidedWinner(); read the comment on decidedWinner first — it exists precisely '
      + 'because a game can be decided without the live state saying so. '
      + 'REAL TRAP: nothing polls. settleClock() only runs when something happens, so a room '
      + 'where both players have stopped acting never settles and never notices the zero. '
      + 'Expiry needs a timer of its own, or the check has to be driven from somewhere that '
      + 'still ticks when neither player is doing anything.',
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
      'digital-client/server/accounts.ts',
      'digital-client/server/api-accounts.ts',
      'digital-client/server/history.ts',
      'digital-client/server/test-accounts.ts',
      'digital-client/engine/ui/account.ts',
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
    slug: 'spectators-and-replays',
    title: 'Spectators and match replays',
    area: 'server',
    size: 'L',
    status: 'open',
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
      'A finished game can be watched back from its saved file, with step and scrub controls',
      'A replay whose log no longer reproduces SAYS so, and distinguishes drift from a fork — replay-room.ts already makes that verdict, so reuse it rather than re-deriving it',
      'No hidden information reaches a spectator that the seats did not have at that moment',
      'Whether the players can see that they are being watched is decided deliberately, and the entry records which way',
    ],
    decided: [
      'It is its own feature, not part of tournaments. Owner, 2026-08-25, asked whether spectators could watch a tournament or whether that was strictly later: "We want to allow spectators and match replays, but that\'s its own feature, yes." BL-04 may link to this; it must not block on it.',
      'Spectating and replay are one entry because they are the same viewer over two sources — a live redacted stream and a saved log. Building two viewers would be the mistake.',
    ],
    asks: [
      'Does a spectator see the game seat-by-seat, with each side\'s hidden information still hidden (which is what viewFor() already produces), or an omniscient broadcast view showing both hands? It changes the whole build, and an omniscient LIVE view is a cheating vector the moment a spectator can talk to a player — a delay is the usual answer elsewhere, and that is a decision, not a default.',
    ],
    deps: [],
    touches: [
      'digital-client/server/rooms.ts',
      'digital-client/server/view.ts',
      'digital-client/server/replay-room.ts',
      'digital-client/server/main.ts',
      'digital-client/engine/ui/main.ts',
    ],
    notes:
      'viewFor(state, seat, frozenOpp) in server/view.ts is the per-seat redaction and is the '
      + 'natural basis for a spectator view; server/test-hidden.ts and '
      + 'server/test-view-snapshot.ts are the leak guards to extend. Do NOT build a spectator '
      + 'view that bypasses viewFor() — that is how a redaction hole gets in through a door '
      + 'the leak tests do not watch.',
  },
  {
    id: 'BL-30',
    slug: 'ally-target-warning',
    title: 'Warn — not stop — when a mixed-allegiance spell is aimed entirely at your own units',
    area: 'client',
    size: 'M',
    status: 'open',
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
    asks: [
      'How is "supposed to be an ally" DERIVED? The owner named Fight and Organic Exchange but the rule has to come from the card data, not from those two names. If no derivation exists in the printed text, this needs either a new printed-data facet or an explicit accepted-cost hand list — and that choice should be made deliberately rather than defaulted into.',
    ],
    deps: [],
    touches: [
      'digital-client/engine/src/types.ts',
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/src/engine.ts',
    ],
    notes:
      'Seams found 2026-08-28: a display-only `warning?` on the decision option (types.ts), the '
      + 'R74 warned-but-legal precedent, and R194 for why a warning needs a window to hang on. '
      + '⚠ The false-positive case is the whole risk. A warning that fires on spells the owner '
      + 'aims at his own units ON PURPOSE is worse than no warning — he will learn to click '
      + 'through it, and then it protects nothing.',
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
    ],
    asks: [
      '"Win a game with 3 or fewer resources in play (which is longer than 3 turns)" — is the parenthesis a CONDITION (the game must have run more than 3 turns) or the owner explaining why the achievement is hard? It changes whether a 3-turn win counts.',
    ],
    deps: [],
    touches: [
      'digital-client/server/achievements.ts',
      'digital-client/server/stats.ts',
      'digital-client/server/accounts.ts',
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
    status: 'open',
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
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/ui/style.css',
    ],
    notes:
      '⚠ TWO TRAPS, both measured on 2026-08-28, and either will cost an afternoon. (1) `$app.'
      + 'innerHTML` is replaced WHOLESALE on every paint, so a CSS transition can never run — an '
      + 'instant hide is S, a real slide needs the dock hoisted out of the repainted subtree and '
      + 'is M. Size above assumes the instant hide. (2) `data-animzone="hand:N"` exists ONLY on '
      + 'the dock in net mode, so removing it from the DOM BREAKS CARD FLIGHTS. Tuck it '
      + 'off-screen; do not unmount it.',
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
      'digital-client/engine/ui/cards.ts',
      'digital-client/engine/ui/cardindex.ts',
      'digital-client/engine/ui/cardsearch.ts',
      'digital-client/engine/ui/cardsynonyms.ts',
      'digital-client/engine/ui/decks.ts',
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/ui/style.css',
      'digital-client/engine/scripts/extract-printed.mjs',
      'digital-client/engine/scripts/audit-cards.mjs',
      'digital-client/engine/scripts/card-audit-known.mjs',
      'digital-client/engine/src/cards/catalogue.json',
      'digital-client/docs/15-card-browser.md',
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
        'digital-client/engine/test/210-cardsearch.test.ts',
        'digital-client/engine/test/211-card-audit.test.ts',
        'digital-client/engine/test/212-card-browser-wiring.test.ts',
      ],
    },
  },
];
