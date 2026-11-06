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
import { CLOSED } from './backlog-closed.ts';

/** Everything still open. The closed entries — the bulk of the file until
 *  2026-09-03 — live in backlog-closed.ts, unchanged and still run. */
const OPEN: Entry[] = [
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
      '2026-11-02 — THE BRIEF GREW: A REAL DESIGN SYSTEM, NOT LIGHT SPRUCING. Owner: "we\'ve been so focused on the game, the other parts of the UI have fallen to the wayside. The homepage, the other basic subpages, the general design system... They\'re all sorta placeholders and have a very specific vibe-coded vibe." Then: "I think we should actually use Storybook for this work so that we can iterate on specific design elements," and, shown the plan, "Aight go ahead and get on it". The plan is client/docs/23-design-system.md (six phases: build the system under today\'s look first, then redesign in Storybook), from the inventory in client/docs/23-ui-inventory/. The 2026-08-25 limit below ("do not read this as licence for a redesign") no longer applies to the non-game pages; the game board stays out of scope.',
      'No reference, no mood board, and the brief is small. Owner, 2026-08-25, asked whether there is a look he wants or whether "less programmer-art" is the whole brief: "It\'s honestly pretty much, just some general light sprucing up is all that\'s needed. Mostly in non gameplay related areas." — so: light, and aimed away from the play area. Do not read this as licence for a redesign, and do not go looking for one in docs/07 (see BL-09).',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/docs/23-design-system.md',
      'client/ui/styles',
      'client/ui/anim.ts',
      'client/ui/motion.ts',
      'client/ui/flash.ts',
    ],
    notes:
      'Standing entry — the right way to use it is to open a specific sub-task, do that, and '
      + 'leave this one open. Do not mark it done.\n\n'
      + '2026-09-05, before the first cloud deploy — the owner\'s own list, shipped: the '
      + 'legal strip across the top of every page is gone ("I don\'t like the top bar with all '
      + 'the information, the footer is more than enough"); the deck builder and the card '
      + 'browser get the same 22px side padding as every other page (they had 2px); every '
      + 'header/tool button row wraps instead of overflowing its box; the join-code and '
      + 'deck-link inputs shrink before pushing their button out of the card; the '
      + '"Your opponent\'s deployment" overlay reads one beat per play ("Rashi plays Fight." '
      + 'then what it did) instead of play / → stack / Resolving / effect. Walked at '
      + '1280×720, 1100×700 and 1440×900 over home, sign-in, profile, decks, deck builder, '
      + 'cards, metagame, queue, draft lobby, board, rules, judge, footer and the three legal '
      + 'pages in headless Chrome, with a script that also flags any button outside the '
      + 'viewport or clipped by an overflow:hidden ancestor — none flagged after the fixes.\n\n'
      + '2026-09-22: the second doneWhen ("does not re-open the table layout unless something '
      + 'there is actually unreadable") is superseded for the PLAY ZONE by the owner\'s own '
      + 'request: the regions board, BL-45 / docs/18. Regions were unreadable — that is the '
      + 'case the clause allowed for. The rest of this entry (home, lobby, profile, post-game, '
      + 'light and aimed away from the play area) stands.',
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
      'Nothing a judge does edits the comprehensive rules or the rulings corpus',
    ],
    decided: [
      'Humans, not the bot. The existing in-client "Ask the judge" box goes to the rules bot; badges are about people.',
      'L3 = word of law / creators. L2 = highly knowledgeable community, long-time players. L1 = above genpop, not yet fully trusted.',
      'NO LIVE ESCALATION. Judges review and flag instead. Owner, 2026-08-25, asked whether a human answer can flow back into the in-game box: "Not live, but judges should be able to review questions and flag problematic ones." — so the in-game box stays bot-answered, and what badges buy is an after-the-fact review queue over the questions that were asked, with a flag on the bad ones. Do not build in-game escalation.',
      'AN L3 JUDGE MAY NOT EDIT THE RULINGS CORPUS. Owner, 2026-08-25: "No, but their feedback needs to be prioritized during updates and engine fixes." — the comprehensive rules (until 2026-10, the ruling register) and the rulings corpus stay the owner\'s hand. The obligation this creates is on the OTHER side: a judge\'s flag has to land somewhere durable and visibly prioritized, so that the next rules update or engine fix actually sees it. A flag that only exists as a chat message does not satisfy this.',
    ],
    asks: [],
    deps: ['BL-16'],
    touches: [
      'client/server/accounts.ts',
      'client/server/api-accounts.ts',
      'client/ui/main.ts',
      'client/ui/inspect.ts',
      'data/comprehensive-rules',
    ],
    notes:
      'NEXT FEATURE (owner 2026-10-25, asked which big feature comes once the to-do list is cleared: "Judge badges rest (BL-17)"). '
      + 'The client already has a judge question box (the ⚖ entry on the card right-click menu '
      + 'and the judge-q input) wired to the rules bot. That is the natural place to hang '
      + 'human escalation. FIRST SLICE LANDED 2026-09-05, from the owner triaging the first '
      + 'live game\'s reports ("check what kind of account left the report. mycheze should be '
      + 'set to me (owner) and judge level 1"): `Account.badge` {owner, judge 1-3, since}, set '
      + 'only through the tester-token route POST /api/admin/badge (deploy/badge.sh on the '
      + 'box — "only an admin"), shown on the profile, and copied onto every report the account '
      + 'files (`IssueRow.by`, report-fields.ts), which `npm run reports` prints beside each '
      + 'new row. Guards: server/e2e/test-badge.ts, server/e2e/test-report.ts §5. NOT yet: the in-game '
      + 'badge, the review queue over judge questions, and reports ORDERED by badge — those '
      + 'are the doneWhen lines still open.',
  },
  {
    id: 'BL-51',
    slug: 'colour-blind-mode',
    title: 'Colour-blind / high-visibility mode',
    area: 'client',
    size: 'L',
    status: 'open',
    track: 'feature',
    said:
      'We should certainly make a "colorblind friendly" version that ignores aesthetics and just '
      + 'makes sure everything is very easy to see and accessible.',
    means:
      'A FUTURE switch (owner 2026-11-03, while the Manual\'s purple/orange palette went live): a '
      + 'second look for the whole client, board and pages, chosen in the settings, that puts '
      + 'legibility first and the rulebook\'s aesthetics second. Nothing the player needs to know '
      + 'is told by colour alone, every text and every meaningful shape clears a high contrast bar '
      + 'on whatever it sits on, and the state colours of the table (targeting, legal, pending, '
      + 'danger, the seats) stay apart for the common colour-vision deficiencies.',
    doneWhen: [
      'A setting turns the mode on and off, signed in or not, and the choice is remembered',
      'With it on, every element is told apart by its SHAPE or a label as well as its colour (the element shapes already exist), on cards, chips, the resource row and the favourite-element picker',
      'With it on, every text and every element shape clears 4.5:1 against the surface it is drawn on; the board\'s state outlines (targeting, legal, pending, danger) are told apart by line style or a mark, not hue alone',
      'A guard test holds the mode\'s palette to those contrast numbers, as test 1030 holds the default one',
    ],
    decided: [
      'Not built yet: the owner named it as a future item on 2026-11-03. Do not fold it into a palette round.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/styles/tokens.css',
      'client/ui/test/1030-manual-palette.test.ts',
    ],
    notes:
      'Starting numbers, from the palette round (var/records/ds-round-2026-11-03-r2-theme.md): on the '
      + 'purple, the element colours as SHAPES are below 3:1 on a raised panel — Dark 2.5:1 (was 3.2 '
      + 'on the old slate), Earth 2.4:1 (3.1), Wood 2.9:1 (3.6); the favourite-element picker\'s Dark '
      + 'icon reads faint. Danger text on a raised panel is 3.95:1 and white on the red badges 3.03:1, '
      + 'the two pairs the default palette leaves under 4.5. The board\'s state colours are table roles '
      + 'in tokens.css (--glow legal green, --target targeting gold, --pending teal, --danger); green '
      + 'vs gold and teal vs green are the pairs a deuteranope loses first.',
  },
  // ── the leftovers of the 2026-11-02/03 rounds (Competitive Constructed, the design
  //    system, the new home, board-r1), filed 2026-11-03. Owner, that night: "put all
  //    the other things into the backlog of todos that we want to take care of".
  //    Each was re-checked against the code before it was filed.
  {
    id: 'BL-53',
    slug: 'competitive-swap-presets',
    title: 'Competitive: saved sideboard swaps — plan the UX before building it again',
    area: 'client',
    size: 'L',
    status: 'open',
    track: 'feature',
    said:
      'That can come later, but the UX is terrible for it and we should plan it better. (2026-11-03, '
      + 'on the saved "standardized swaps" presets being taken out; the 2026-11-02 ask was saved named '
      + 'presets that exchange a specific set of cards in one click)',
    means:
      'A PLANNING item, not a rebuild. The presets shipped with Competitive Constructed on 2026-11-02 '
      + 'and were removed whole on 2026-11-03 (engine matchdeck.ts, the deck store, the match wire, the '
      + 'deck page\'s Swaps section; record var/records/ds-round-2026-11-03-r2-C.md section 2). Manual '
      + 'sideboarding on the deck table and "Back to the registered deck" stay. Design where a preset is '
      + 'made and where it is applied (the deck page? the sideboarding table?) and show the owner before '
      + 'writing code.',
    doneWhen: [
      'A written design (screens and the one-tap flow) is shown to the owner and he approves it',
      'Only then: a player can save a named swap on a deck and apply it between games in one tap; the opponent never sees it',
    ],
    decided: [
      'Removed 2026-11-03; old decks that still carry `swaps` load and lose the field at their next write (812 section 2).',
    ],
    asks: [
      'Where should a swap be made and applied, and what should it look like? (the owner: "we should plan it better")',
    ],
    deps: [],
    touches: [
      'client/ui/pages/match.ts',
      'client/ui/decks.ts',
      'client/engine/src/matchdeck.ts',
      'client/docs/22-competitive-constructed.md',
    ],
  },
  {
    id: 'BL-54',
    slug: 'draft-card-pool-setting',
    title: 'Draft: a card-pool setting — base game or with Light & Dark',
    area: 'server',
    size: 'M',
    status: 'open',
    track: 'feature',
    said:
      'The home sketch (client/docs/24-redesign/home-sketch-2026-11-03.png) has a Pool setting for a '
      + 'draft: base game vs with Light & Dark. Not built on the new home: "No card-pool setting (needs a '
      + 'server change; spec)" (flagged for the owner, 2026-11-03).',
    means:
      'Every Light & Dark card has the light or dark faction, so "base game only" is the same as the '
      + 'elements being drawn from the five base elements. Today every trio method draws from all seven '
      + '(server/trio.ts ALL_ELEMENTS), and the only lever is a custom card filter, which makes the game '
      + 'custom (no stats) and is refused when the lobby picks the elements. The options are written up '
      + 'in var/records/ds-round-2026-11-03-home-inventory.md section 4: A (the room carries a pool and '
      + 'the trio methods draw from 5 or 7) is the only one that keeps both players choosing in the lobby '
      + 'and keeps the game counting toward stats.',
    doneWhen: [
      'The draft panel on home has a Pool choice; with "Base game" no trio method, the 🎲 or a fixed pick can produce Light or Dark',
      'A base-game draft is not a custom game: it counts toward stats and rating like any other',
      'The pool survives a restart and a rematch, and a saved game replays with it',
    ],
    decided: [],
    asks: [
      'Option A from the inventory (a room field read by trio.ts), or another? And does a league draft ever use it?',
    ],
    deps: [],
    touches: [
      'client/server/trio.ts',
      'client/server/rooms.ts',
      'client/ui/pages/home.ts',
      'client/ui/pages/lobby.ts',
    ],
  },
  {
    id: 'BL-55',
    slug: 'sideboarding-table-leftovers',
    title: 'Competitive: what the sideboarding table and match screens still lack',
    area: 'client',
    size: 'M',
    status: 'open',
    track: 'qol',
    said:
      'I wanted something like MTGO. Your deck laid out below, on the table we spent so much time '
      + 'building, then the sideboard above and you slide cards in and out. (2026-11-03; built and live '
      + 'that night, these are what its record left)',
    means:
      'The table between games works (tap or drag a copy across). Left over, all re-checked in the code '
      + 'on 2026-11-03: (1) a mouse hover raises a card in its pile but gives no big zoom; only '
      + 'press-and-hold or the middle button does (zoom.ts\'s hover target is the board\'s `.card`); '
      + '(2) the deck is always laid out by cost (pages/match.ts deckPilesHtml: seedPiles(main, \'cost\')), '
      + 'never as the player arranged it on their tabletop, because that arrangement is not in the match '
      + 'payload; (3) the report pill and bell float over the table\'s bottom bar, which keeps 215px clear '
      + 'for them (47-competitive-match.css); (4) the match result says the score only, not each game\'s '
      + 'result; (5) the Competitive deck pick is not remembered across a reload (ui/match.ts pickId is '
      + 'module state); (6) never tried on a real iPad or in Firefox (headless Chrome only).',
    doneWhen: [
      'Hovering a card on the sideboarding table with a mouse shows the big zoom, as on the board',
      'The deck is laid out as the player arranged it on the tabletop when the deck has an arrangement',
      'Nothing floats over the table\'s bottom bar',
      'The match result lists each game\'s winner, and the Competitive deck pick survives a reload',
      'The owner has moved cards across on a real iPad',
    ],
    decided: [],
    asks: [],
    deps: [],
    touches: [
      'client/ui/pages/match.ts',
      'client/ui/match.ts',
      'client/ui/zoom.ts',
      'client/ui/styles/pages/47-competitive-match.css',
    ],
    notes:
      'Sources: var/records/cc-sideboard-2026-11-03.md "Left / notes"; the Competitive register '
      + '(var/records/cc-round-2026-11-02-register.md, "Not done (W6)"). The builder\'s own sideboard '
      + 'pile on the tabletop has the same untried-device gap, filed as CT-516.',
  },
  {
    id: 'BL-56',
    slug: 'card-browser-sideboard',
    title: 'The card browser has no "add to sideboard" button',
    area: 'client',
    size: 'S',
    status: 'open',
    track: 'qol',
    said:
      'Adding cards to your sideboard isn\'t working (2026-11-03; fixed that night on the deck page, the '
      + 'tabletop and the pinned panel, but not in the full card browser)',
    means:
      'With a deck open, the full card browser\'s tiles (pages/cards.ts tileButtons) offer − / + / » '
      + '(maybeboard) and nothing for the sideboard; on the deck page\'s Sideboard tab the 🔍 browse button '
      + 'is simply not offered (decks.ts). While there: the browser\'s + is not capped at 2 copies, which '
      + 'the deck page and the binder are.',
    doneWhen: [
      'With a deck open, a card browser tile can add a copy to the sideboard, within the 7-card and 2-copy limits',
      'The Sideboard tab offers the browser like the other tabs do, and a card added there lands on the sideboard',
      'The browser\'s + stops at 2 copies across deck and sideboard',
    ],
    decided: [],
    asks: [],
    deps: [],
    touches: [
      'client/ui/pages/cards.ts',
      'client/ui/cards.ts',
      'client/ui/decks.ts',
    ],
    notes: 'Sources: var/records/ds-round-2026-11-03-r2-C.md "Found, not fixed"; ds-w2c record (the + cap).',
  },
  {
    id: 'BL-57',
    slug: 'redesign-remaining-pages',
    title: 'Redesign the remaining pages to the docs/24 principles (one window, no page scroll, buttons)',
    area: 'client',
    size: 'XL',
    status: 'open',
    track: 'feature',
    said:
      'Owner, 2026-11-03 (client/docs/24-redesign/README.md): iPad and desktop only, "Let\'s not even '
      + 'worry about phones for now"; "No page scrolling. Every page has to be manageable without scrolling '
      + 'up or down"; everything is buttons; simple, not chaotic.',
    means:
      'Only the home is built on the app shell and guarded as one window (ui-shots `noScroll`, test 1012). '
      + 'Every other page still scrolls as a page. Not yet redesigned (client/ui/pages/README.md): My decks '
      + 'with its modals and Sideboard tab (still scrolls, r2-C record), the tabletop builder and binder, '
      + 'the card browser, Metagame (its headers keep their own markup by an owner call: the Back button '
      + 'by the title), Card stats, Profile, Sign-in, Admin, League, Weekly challenge, Learn to Play menu, '
      + 'How to play / rules, the rules review page, the matchmaking queue, the waiting rooms and draft '
      + 'lobby, post-game. The sideboarding table is already window-sized. One page at a time, each shown '
      + 'to the owner.',
    doneWhen: [
      'Each page above fits the window at 1440x900 and at 1024x768 touch, with only its own lists scrolling inside, and a ui-shots `noScroll` state guards it',
      'The owner has seen and approved each redesigned page',
    ],
    decided: [
      'No phone layouts (owner 2026-11-03). Phone-only overflows found tonight are parked, not fixed.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/docs/24-redesign/README.md',
      'client/ui/pages/README.md',
      'client/ui/components/app-shell.ts',
      'client/server/e2e/ui-shots-states.mjs',
    ],
  },
  {
    id: 'BL-58',
    slug: 'board-colour-literals',
    title: 'Board colours the palette round left hard-coded: the commit button\'s green, the stack popup\'s navy',
    area: 'client',
    size: 'S',
    status: 'open',
    track: 'qol',
    said:
      'put all the other things into the backlog of todos that we want to take care of (2026-11-03)',
    means:
      'The Manual palette moved the board through tokens but left the board\'s own literals "for the '
      + 'board\'s round". board-r1 then fixed the action bar\'s washes. Still literals: `button.commitbtn` '
      + '(styles/board/29-cost-toasts.css: #3c5a2f / #5b8747 / #476b37), written to match the old green '
      + '`button.primary`, which is orange now; and the stack item popup\'s navy (the old-slate family, a '
      + 'seam on the purple but legible).',
    doneWhen: [
      'The commit button reads as the same primary as every other primary button',
      'The stack item popup sits on a palette surface, not the old navy; test 921\'s board allowlist shrinks with it',
    ],
    decided: [],
    asks: [],
    deps: [],
    touches: [
      'client/ui/styles/board/29-cost-toasts.css',
      'client/ui/styles/board/20-stack.css',
      'client/ui/test/921-no-new-colour-literals.test.ts',
    ],
    notes:
      'Sources: var/records/ds-round-2026-11-03-r2-theme.md "Left / for later" and '
      + 'var/records/board-r1-2026-11-03.md "Not done / for later". The prompt bar\'s dark-gold wash on '
      + 'the same list is fixed (board-r1 item 3).',
  },
  {
    id: 'BL-59',
    slug: 'ipad-one-height-bar-review',
    title: 'iPad: look at the side effects of the one-height action bar',
    area: 'client',
    size: 'S',
    status: 'open',
    track: 'qol',
    said:
      'One height for the action bar (owner, mid-round in board-r1, 2026-11-03). Its record: "Worth '
      + 'showing the owner."',
    means:
      'For the OWNER to look at on a real iPad, not a fix to start. The action bar is now always two '
      + 'rows tall (87px under touch), so the board never jumps. The cost on touch: battle and table '
      + 'cards are a little smaller than under a one-row prompt (a battle ghost slot went from 100px to '
      + '87px wide); and a card-scan decision (trigger order, glimpse "cache one", Scholar of the Void) '
      + 'stands up out of the bar over the bottom of your info line while it is up. Also for him to try '
      + 'on the iPad: Storybook from the installed web app (whether `window.open(\'\')` gives a usable '
      + 'window; ds-sb record).',
    doneWhen: [
      'The owner has played a game on the iPad with the bar and said keep it, or what to change',
    ],
    decided: [
      'This reverses the 2026-09-26 call ("fits its content"); 324 section 5 now pins the constant height.',
    ],
    asks: [
      'Are the smaller touch cards and the covered info line acceptable for a bar that never jumps?',
    ],
    deps: [],
    touches: [
      'client/ui/styles/board/39-regions.css',
      'client/ui/test/324-info-block-resources.test.ts',
    ],
    notes: 'Measurements: var/records/board-r1-2026-11-03.md section 3b.',
  },
  {
    id: 'BL-60',
    slug: 'popup-sentences-owner-call',
    title: 'Owner\'s call: the board popup sentences kept as candidates to cut',
    area: 'client',
    size: 'S',
    status: 'open',
    track: 'qol',
    said:
      'All the extra weirdly AI generated, superfluous text was supposed to have been gotten rid of '
      + 'forever ago. (2026-11-03, board-r1 item 7)',
    means:
      'board-r1 cut the clear cases and KEPT these for the owner (all still in the code): the resource '
      + 'window\'s "Dormant: no mana or affinity until activated in planning."; the zoom\'s "token — erased '
      + 'when it leaves play"; the room tip\'s "N watching — they see both hands"; the Single Card Duel '
      + 'game tip "thirty copies of one card each. Rates the cards, not you."; the stack head\'s "— '
      + 'resolves as ONE composed ability"; the burst line "clicking a Fireball casts all 3 at once, as one '
      + 'chain, of different sizes."; the rot pill\'s "Rot never decreases on its own."; the debt pill\'s '
      + 'reminder; the cache\'s "both players see it"; the counterattack strip\'s "they arrive next round '
      + 'and cannot be touched until then"; the toolbar settings\' one-or-two-sentence tooltips; and the '
      + 'stack does-line on a card with no X ("Deal X damage to Gember (currently 3)": Dropslime, Burning '
      + 'Vengeance, Verdant Vengeance, Null Drone), where "no X on a card that has none" needs a wording '
      + 'choice against the 2026-09-30 live-amount wording.',
    doneWhen: [
      'The owner has said keep or cut for each line, and the cut ones are gone',
    ],
    decided: [],
    asks: [
      'Keep or cut, line by line (the table in var/records/board-r1-2026-11-03.md section 7, "Kept, candidates for the owner")',
    ],
    deps: [],
    touches: [
      'client/ui/main.ts',
      'client/ui/ressum.ts',
      'client/ui/cardtext.ts',
      'client/ui/does-lines.json',
    ],
  },
  {
    id: 'BL-61',
    slug: 'retire-style-codemods',
    title: 'Retire the one-shot style scripts: delete split-styles.mjs, drop tokenize-styles\' stale token template',
    area: 'client',
    size: 'S',
    status: 'open',
    track: 'qol',
    said:
      'put all the other things into the backlog of todos that we want to take care of (2026-11-03)',
    means:
      '`client/ui/scripts/split-styles.mjs` cut style.css into styles/ and was due for deletion once '
      + 'Competitive Constructed landed (the landing runbook\'s step 6); it has landed. '
      + '`tokenize-styles.mjs` still embeds TOKENS_CSS with the OLD values (e.g. --color-surface #1a1f27, '
      + 'now #3e1d52 in tokens.css). Re-checked: its isRoleTokens guard leaves a tokens.css that already '
      + 'holds role tokens alone, so a re-run does NOT overwrite it as the palette record feared, but the '
      + 'stale template misleads anyone who reads it.',
    doneWhen: [
      'split-styles.mjs is gone and nothing references it (920, css-scan.mjs, docs/23, ui/README.md, engine/scripts/paths.mjs checked)',
      'tokenize-styles.mjs carries no copy of the token values: tokens.css is the only place they live',
    ],
    decided: [],
    asks: [],
    deps: [],
    touches: [
      'client/ui/scripts/split-styles.mjs',
      'client/ui/scripts/tokenize-styles.mjs',
      'client/ui/test/920-styles-split-order.test.ts',
      'client/ui/test/921-no-new-colour-literals.test.ts',
    ],
  },
  {
    id: 'BL-62',
    slug: 'home-owner-calls',
    title: 'Owner to decide: what the new home left out of the sketch',
    area: 'client',
    size: 'S',
    status: 'open',
    track: 'qol',
    said:
      'Looking really solid… great v1! (2026-11-03, on the new home). Flagged for him by its record: '
      + '"No logo on home (the bottom bar names the client)." "Clock chips are Default/Off/45m/60m, not '
      + 'the sketch\'s 20m/40m (271 pins them)."',
    means:
      'Decisions, not bugs. (1) No ALGOMANCY logo on home: the toolbar is the header and the bottom bar '
      + 'names the client. (2) The sketch\'s 20m/40m clock chips were not adopted; the presets are Off / 45m '
      + '/ 60m (pages/clockpick.ts CLOCK_PRESETS, test 271). (3) The Draft tab has empty space between its '
      + 'rows and its buttons at 1440x900, because the card keeps one height across tabs so nothing jumps. '
      + '(4) The Challenge card has no Play button of its own: the whole card opens the challenge page.',
    doneWhen: [
      'The owner has answered each of the four, and any change he asks for is built',
    ],
    decided: [],
    asks: [
      'A logo on home or not?',
      'Clock presets: keep Off/45m/60m, or the sketch\'s 20m/40m?',
      'Is the Draft tab\'s empty space at 1440x900 fine, and is a whole-card Challenge button enough?',
    ],
    deps: [],
    touches: [
      'client/ui/pages/home.ts',
      'client/ui/pages/clockpick.ts',
      'client/ui/test/271-clock-picker-and-warning.test.ts',
    ],
    notes: 'Source: var/records/ds-round-2026-11-03-home-page.md "Flagged for the owner".',
  },
  {
    id: 'BL-63',
    slug: 'design-system-small-leftovers',
    title: 'Design-system round: the small page bugs and tidy-ups it found and left',
    area: 'client',
    size: 'M',
    status: 'open',
    track: 'qol',
    said:
      'put all the other things into the backlog of todos that we want to take care of (2026-11-03)',
    means:
      'The records\' "found, not fixed" lines that were still true in the code on 2026-11-03, each small. '
      + 'Pick any one off; tick its doneWhen line. Phone-only overflows (profile History 534px and the '
      + 'card-search syntax help 448px on a 390px screen, the past-week Watch buttons, card stats headers) '
      + 'are parked under the owner\'s "not even worry about phones" (BL-57).',
    doneWhen: [
      'The home toolbar\'s Alerts button shows pressed while the inbox list is open (pages/home.ts passes no `on` when signed in; the list\'s state is inbox.ts\'s)',
      '`.zonelabel`, the client\'s one global small-caps label, lives in base.css (or becomes `.eyebrow`), not in board/03-life-cards-battle-log.css',
      'The button component writes `disabled` where a test reading attribute order expects it (rootAttrs puts it before the pass-through attrs; 287 reads `data-report="send" disabled`), so the report dialog can use button()',
      'The profile\'s password-change failure is drawn as an error, not in `.deckmsg` gold',
      'Metagame: a filter typed on the card ladder does not carry to the deck list and back (meta.ts shares one `text`)',
      'Card stats: the bar fills in 34-cardstats.css (#4fb3c9, #9aa5b0) use data-viz tokens, as wrTint now does',
      'Checked: whether the tabletop\'s rerender `!inGame` guard can reach the waiting-room deck-page bug it resembles (docs/23 "Found, not fixed")',
      'The TODO(ds) splits are done: handlePregameButton out of main.ts into pages/home.ts, and league / challenge paint() split from their wiring; the "kicked" notice out of NetBackend',
    ],
    decided: [],
    asks: [],
    deps: [],
    touches: [
      'client/ui/pages/home.ts',
      'client/ui/inbox.ts',
      'client/ui/styles/base.css',
      'client/ui/components/_shared.ts',
      'client/ui/pages/profile.ts',
      'client/ui/meta.ts',
      'client/ui/styles/pages/34-cardstats.css',
      'client/ui/tabletop.ts',
      'client/docs/23-design-system.md',
    ],
    notes:
      'Sources: var/records/ds-round-2026-11-03-{ds-base,ds-w2b,ds-w2c,ds-w3a,ds-w3b,home-page}.md and '
      + 'docs/23 "Found, not fixed". Already fixed later that night and NOT filed: the report button over '
      + 'the league\'s Suggest a time, the friends list\'s empty table on a fetch error, the league grid\'s '
      + '"drag" on touch, the signed-out Challenge nav wrap, `.scdraw`/`.scwarn` in the wrong piece, '
      + 'legal.ts\'s injected stylesheet, the queue\'s 16px buttons, the favourite/unlink missing catches, '
      + 'the ladder failure in gold, crreview.ts\'s stale comment, 962 matching words in strings, the '
      + 'component gaps (panel titleHtml and sub-heading, table headless and column titles, tabs '
      + 'className), the native checkboxes drawn light.',
  },
  {
    id: 'BL-64',
    slug: 'ui-shots-stable-comparisons',
    title: 'ui-shots: make two runs of one build compare clean',
    area: 'client',
    size: 'S',
    status: 'open',
    track: 'qol',
    said:
      'put all the other things into the backlog of todos that we want to take care of (2026-11-03)',
    means:
      'Every stream of the design-system round had to explain away the same false differences: the '
      + 'share links print the server port, so runs on two ports differ in 8 shots (decks__settings, '
      + 'meta__shared-deck, waiting__constructed); a focused search box draws its accent border or not '
      + 'depending on window focus (rules__*, and cards__browse as the first state of a fresh Chrome); '
      + 'cardstats__* and decks__first are not pixel-stable (translucent tiles, art); under load a shot '
      + 'can catch "Loading the document…" (crreview__doc, rules__cr) or time out.',
    doneWhen: [
      'Two full runs of the same build on two different ports compare with zero differences',
    ],
    decided: [],
    asks: [],
    deps: [],
    touches: [
      'client/server/e2e/ui-shots.mjs',
      'client/server/e2e/ui-shots-states.mjs',
      'client/server/e2e/ui-shots-compare.mjs',
    ],
    notes: 'Sources: the ds-pages, ds-base, ds-w2c and ds-w3a records under var/records/.',
  },
  {
    id: 'BL-66',
    slug: 'pages-redesign-ux-pass',
    title: 'The redesigned pages: the owner\'s UX changes',
    area: 'client',
    size: 'M',
    status: 'open',
    track: 'qol',
    said:
      'Everything I want to change is minor and specifically about changing UX (but we\'ll do that later) (2026-11-04)',
    means:
      'After clicking through the pages redesign on the dev server, the owner has small UX changes to make '
      + 'to the redesigned pages. They are not listed yet: ask for them when this is picked up.',
    doneWhen: [
      'Every change on the owner\'s list is made and he has seen it',
    ],
    decided: [],
    asks: ['the list of UX changes'],
    deps: [],
    touches: [
      'client/ui/pages/frame.ts',
      'client/ui/styles/pages/49-frame.css',
    ],
  },
  {
    id: 'BL-67',
    slug: 'spectate-has-a-way-in',
    title: 'Spectating has no way in but a typed URL',
    area: 'client',
    size: 'S',
    status: 'open',
    track: 'qol',
    said:
      'Every SINGLE page must be accessible (and leavable) without touching the URL bar (since we\'re treating '
      + 'this like a stand alone app that just happens to run in browser) (2026-11-04)',
    means:
      'The way-out audit of 2026-11-04 fixed every screen that stranded a player (test 1074; Test mode\'s Leave in '
      + 'test-sandbox.ts). One screen is still reachable only by URL: watching a game (`&watch=1`), which the '
      + 'interface guide tells players to type (ui/tutorial.ts) and which main.ts says "belongs wherever spectating '
      + 'is offered on purpose" — nothing offers it. Offer it where a player would look: a friend\'s live game, '
      + 'the room\'s share line. (Left URL-only on purpose: the scenario tester and ?demo are developer tools behind '
      + 'a token or for the screenshot rig; the CR review page and rules questions are the judges\'.)',
    doneWhen: [
      'A player can start watching a game from a button, and the guide no longer tells anyone to type a URL',
    ],
    decided: [],
    asks: ['where the Watch button should be'],
    deps: [],
    touches: [
      'client/ui/tutorial.ts',
      'client/ui/main.ts',
    ],
  },
  {
    id: 'BL-68',
    slug: 'steward-approved-branch-already-landed',
    title: 'The runner keeps re-landing an approved branch whose work already reached master another way',
    area: 'server',
    size: 'S',
    status: 'open',
    track: 'qol',
    said:
      'I don\'t want to manually approve all those things I can just approve … make sure the actual approval '
      + 'requests are important. (2026-11-05)',
    means:
      'land_approved in steward/run-once.sh rebases every origin/steward-approved/* branch onto master and, on a '
      + 'conflict, journals approved-conflict and writes state/redgate/<item>.json, which the queue turns into a '
      + '"repair" line ahead of every report, CT and BL. When that repair re-applies the work as a NEW commit and '
      + 'ships it (or the worker finds it already on master), the runner removes the redgate file but never '
      + 'deletes the approved branch, so the next tick rebases it again, conflicts again (its patch is on master '
      + 'now, with different ledger text) and queues the same repair again, without end. Seen 2026-11-05 on '
      + 'CT-521: approved 06:48, conflicted 06:53 and 08:39, repaired and shipped as c674d37c at 09:29, '
      + 'approved-conflict again at 09:35, and queued as "repair origin/steward-approved/CT-521" for the next '
      + 'run, which found it already-fixed (its builder.ts, tabletop.ts and test 1143 hunks are identical to '
      + 'c674d37c\'s). Every tick until it is fixed spends a Claude run on the same line. '
      + 'The fix (one guard, in land_approved before the rebase): take the item\'s last journal row that is not '
      + 'approved-conflict / approved-gate-red; if it is shipped, landed, already-fixed or not-a-bug, the approved '
      + 'work is on master already, so archive the branch (push $ref:refs/archive/steward/$item and delete '
      + 'refs/heads/steward-approved/$item, live mode only), remove state/redgate/$item.json, journal '
      + '"landed-elsewhere", and continue. A later "approved" row (a re-approval) is not finished, so a real '
      + 'second approval still lands. Then a test-runner.sh scenario: an approved branch with a finished journal '
      + 'row is archived and never queued for repair.',
    doneWhen: [
      'An approved branch whose item already shipped is archived on the next tick and its repair line never comes back',
    ],
    decided: [
      'An approved branch whose item already shipped, or was found already fixed, is finished: the runner archives it by itself. Owner, 2026-11-05, on Discord, asked whether the worker may tidy away an approved fix that already went live another way: "Yes of course. If an issue is fixed and no longer an issue, it\'s categorically \"solved\""',
    ],
    asks: [],
    deps: [],
    touches: [
      'steward/run-once.sh',
      'steward/test-runner.sh',
    ],
    notes: 'Until it lands, the stale ref origin/steward-approved/CT-521 (23d78f55, superseded by c674d37c on '
      + 'master) re-queues itself every tick; deleting that one branch on GitHub stops the loop by hand. Staged '
      + 'under its own id, not CT-521: approving a steward/CT-521 branch would push onto the stale '
      + 'steward-approved/CT-521 of the same name. A worker that meets "repair origin/steward-approved/CT-521" '
      + 'before this lands: it is already on master; skip it for this entry. '
      + 'FIX WRITTEN 2026-11-05 (the commit that adds this sentence): approved_finished() + the guard at the top '
      + 'of land_approved\'s loop, journalling landed-elsewhere (dry-landed-elsewhere when dry), and the '
      + 'test-runner.sh scenario "landed-elsewhere". The guard\'s jq was checked against the box\'s real journal '
      + '(CT-521 → finished) and nine synthetic rows; test-runner.sh itself needs git network and was not run. '
      + 'Left open because its only guard is a runner scenario, not a node test: close it with that commit once '
      + 'the scenario has passed on the box.',
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const BACKLOG: Entry[] = [...OPEN, ...CLOSED].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
