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
    ],
    asks: [
      'Does the queue pair by rating (skill-based, widening with wait time) or strictly first-two-in-line? The owner picked "queue + rating + leaderboard" over the skill-based-pairing option, which reads as first-two-in-line for now — confirm before building the harder one.',
    ],
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
    ],
    decided: [
      'Ratings are per format (constructed vs draft rated separately) — one number across formats would be misleading given draft decks are random.',
      'Rating comes from the stamp, not from replaying the log: old logs diverge on newer engines (this already burned 5 of the first 8 games).',
    ],
    asks: [
      'Provisional rating for a new account, and how many games before you appear on the leaderboard?',
      'Does an unfinished/abandoned game count as a loss, or not count at all? Concessions already stamp a winner, so this is only about true abandonment.',
    ],
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
    ],
    decided: [
      'Opponents are scripted plans, not search or evaluation. "Probably easy to beat" is the intent, not a compromise.',
      'They are opponents in a normal game, not puzzle scenarios — the board starts empty.',
    ],
    asks: [
      'Should challenge results count toward account stats/achievements/rating, or be excluded like signed-out play?',
    ],
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
    ],
    decided: [
      'Tournaments and cube are TWO features that overlap: cube (BL-05) reuses this pairing infrastructure but is not part of it.',
      'Games are ordinary 1v1 rooms — the tournament schedules them, it does not change how they play.',
    ],
    asks: [
      'Tiebreakers for Swiss standings — opponents\' match win %, head-to-head, something simpler?',
      'Does a tournament round have a clock/deadline, and what happens to an unfinished game when time expires? The 40:00 chess clock already exists per room.',
      'Can spectators watch, or is that strictly later?',
    ],
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
    ],
    decided: [
      'Pregame, not live. The existing in-game live draft is a different format and stays.',
      '30 cards is the constructed deck size for cube AND for normal constructed.',
      'Resources are NOT drafted. "Resources are a part of the base game that players always have access to. It\'s not like magic." Prismites/resources stay freely available exactly as they are now.',
      'Duplicates come from the CUBE LIST containing duplicates, not from the tool inventing them to fill packs.',
      'Default pack structure: 4 packs of 10.',
      'After deckbuilding, a cube draft is indistinguishable from normal constructed.',
    ],
    asks: [
      'Is there a deckbuilding time limit, and what happens if someone does not submit a legal 30?',
      'Can a cube list be saved and reused/shared between events, or is it configured per event?',
    ],
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
      + 'from BL-14 rather than writing a second one.',
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
    ],
    decided: [
      'It is a sandbox for exploration as much as a debug harness — the UI should be usable by a player, not just by an agent.',
    ],
    asks: [
      'Should test mode be available to everyone on a public deploy, or gated behind a flag/judge badge? (It trivially reveals nothing secret, but it is also an odd thing to hand a new player.)',
      'Two-sided sandbox — do you want to be able to give the empty second seat a board too, to test interactions across the table?',
    ],
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
      'The fuzzer runs clean at 3, 4 and 6 seats',
      'Per-seat redaction is still leak-free with more than one opponent',
    ],
    decided: [
      'Both FFA and teams are wanted.',
    ],
    asks: [
      'Table sizes to actually support — 3–4, or all the way to 6+?',
      'Teams: 2v2 only, or arbitrary team splits?',
      'Does the 1v1 counterattack rule generalize, or is there a different multiplayer rule? This is a RULES question, not an engine one — it may need a judge/creator answer.',
    ],
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
      'doc 06 M5 already lists "FFA intents (commit-reveal); teams" as beyond-v1 work. '
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
    ],
    asks: [
      'Is there a table size where you would accept it being slow, or is the goal that 6 players feels like 2?',
    ],
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
    slug: 'visual-redesign-r0-r5',
    title: 'Finish the docs/07 visual redesign (R0–R5)',
    area: 'client',
    size: 'L',
    status: 'open',
    track: 'feature',
    said: 'Visual sprucing up',
    means:
      'The concrete half of "visual sprucing up": docs/07-visual-redesign.md is a complete '
      + 'spec with the decisions already made, and R0–R5 were never built. There are also '
      + 'owner-authored per-phase layouts (layouts.json, layout-editor.html) and two later '
      + 'visual docs (09-visual-clarification, 12-card-text) that have not been fully '
      + 'reconciled with what shipped.',
    doneWhen: [
      'R0–R5 from docs/07 are either built or explicitly re-decided against, in writing, in that doc',
      'docs/07 no longer describes anything as pending that has shipped',
      'The per-phase layouts in layouts.json are actually used by the client, or the file is retired',
    ],
    decided: [],
    asks: [
      'Is docs/07 still what you want visually, ~13 months after writing it? Re-read it before building; parts may have been overtaken by the playtest-driven UI work.',
    ],
    deps: [],
    touches: [
      'digital-client/docs/07-visual-redesign.md',
      'digital-client/docs/09-visual-clarification.md',
      'digital-client/engine/ui/layouts.json',
      'digital-client/engine/ui/layout-editor.html',
      'digital-client/engine/ui/style.css',
      'digital-client/engine/ui/main.ts',
    ],
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
      + 'one has a written spec to finish and this one is a judgement call each time.',
    doneWhen: [
      'A named, bounded improvement ships and the owner agrees it looks better — this entry never "completes", it gets re-opened',
    ],
    decided: [],
    asks: [
      'Is there a reference or mood you want it to look like, or is "less programmer-art" the whole brief?',
    ],
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
    ],
    decided: [
      'This and learn-to-play (BL-12) are distinct: this one is client-only.',
    ],
    asks: [
      'Coach-marks over the live client, or a scripted sandbox game you play through?',
    ],
    deps: [],
    touches: [
      'digital-client/engine/ui/main.ts',
      'digital-client/engine/ui/glossary.ts',
      'digital-client/engine/ui/index.html',
    ],
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
    ],
    decided: [
      'Contrived game, not a rules document. The owner said "with a contrived game of some kind".',
      'Teaching newcomers is a stated reason the project exists, so this is not a nice-to-have.',
    ],
    asks: [
      'Does it end with a nudge to buy the physical game / print-and-play? That is the natural place for it (see BL-15).',
    ],
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
    ],
    decided: [
      'Decklists are secret; aggregates are public. Owner, 2026-08-24, unprompted and explicit.',
    ],
    asks: [
      'What counts as an "archetype" — is that a manual tag, a clustering of lists, or just element combination?',
      'Time windows: all-time only, or last-30-days style slices?',
    ],
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
    status: 'open',
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
    ],
    decided: [
      '30 cards is the constructed deck size.',
      'Lists are private by default (BL-13); sharing one is a deliberate act.',
    ],
    asks: [
      'Is there a deck limit per account?',
      'Should a deck be frozen once played in a rated game, so history is not rewritten by editing it? (Affects BL-02 and BL-13.)',
    ],
    deps: [],
    touches: [
      'digital-client/server/decks.ts',
      'digital-client/server/default-decks.json',
      'digital-client/server/api-accounts.ts',
      'digital-client/engine/ui/account.ts',
      'digital-client/engine/ui/main.ts',
    ],
    notes:
      'server/decks.ts and default-decks.json already exist — READ THEM FIRST. Some of this '
      + 'may be partly built, and the entry should be narrowed to the gap rather than '
      + 'reimplemented.',
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
    ],
    decided: [
      'Free, no economy, no monetization, owner-funded. Not negotiable and should be stated plainly.',
      'There is NO shipped official client — do not write copy implying one exists. The Steam page is an intent that is not currently being worked on.',
      'The pitch order is: buy physical > buy print-and-play > play here for free.',
    ],
    asks: [
      'Do you want Caleb\'s explicit blessing before the public deploy, or is a clear unofficial notice enough? doc 06 records "Caleb\'s blessing before any public deploy" as a standing item — is that still your position?',
      'Exact URLs for the physical game and the print-and-play.',
    ],
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
    ],
    decided: [
      'Needed because the target is a public deploy with strangers.',
    ],
    asks: [
      'Who is an admin — a flag on an account, or is L3 judge (BL-17) the same thing?',
      'The account-claiming rule ("registering with a name claims saved games played under it") is explicitly "fine for a 2-person LAN box, wrong for anything public". Does fixing that belong here, or as its own entry?',
    ],
    deps: [],
    touches: [
      'digital-client/server/accounts.ts',
      'digital-client/server/api-accounts.ts',
      'digital-client/server/main.ts',
      'digital-client/server/rooms.ts',
      'digital-client/engine/ui/account.ts',
    ],
    notes:
      'Related and urgent for a public deploy, but NOT in the owner\'s list and so not '
      + 'invented as an entry here: name claiming, and the fact that there is no email and '
      + 'therefore no password reset. Raise both with the owner rather than silently fixing.',
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
    ],
    decided: [
      'Humans, not the bot. The existing in-client "Ask the judge" box goes to the rules bot; badges are about people.',
      'L3 = word of law / creators. L2 = highly knowledgeable community, long-time players. L1 = above genpop, not yet fully trusted.',
    ],
    asks: [
      'Does a human judge answer flow BACK into the client\'s "Ask the judge" box — i.e. can an unanswerable bot question be escalated to a human and the answer returned in-game?',
      'Should an L3 ruling be able to update digital-rules.md / the rulings corpus, or is that always the owner\'s hand?',
    ],
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
    status: 'open',
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
    status: 'open',
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
    status: 'open',
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
];
