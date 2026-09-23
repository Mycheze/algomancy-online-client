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
      'client/docs/prototypes/layouts.json',
      'client/docs/prototypes/layout-editor.html',
      'client/ui/style.css',
      'client/ui/main.ts',
    ],
    notes:
      'The slug was `visual-redesign-r0-r5` until 2026-08-25 — grep for that if an older note '
      + 'or branch name cites it. The id is unchanged, as ids always are. '
      + 'Size dropped L → M with the scope: this is now a reconciliation pass over one doc '
      + 'plus a decision about layouts.json, not a client rebuild. '
      + '2026-09-03: layouts.json, layout-editor.html and focus-board.html moved from ui/ (where the '
      + 'server\'s catch-all served them to anyone) to docs/prototypes/; mockup.html, referenced by nothing, deleted.',
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
      + 'viewport or clipped by an overflow:hidden ancestor — none flagged after the fixes.',
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
      'SHIPPED 2026-09-16, and the entry stays OPEN for the destructive half. The owner asked '
      + 'for "an admin dashboard where I can see: all accounts/users (and be able to directly '
      + 'give people Judge level tags and such), all reports (and their implementation status, '
      + 'and be able to thumbs up/down them), a full game history (so I can see what people '
      + 'have been playing)" and, asked, added live rooms. Four of the six doneWhen bullets are '
      + 'now true: accounts are listed, live rooms are visible, reports are readable and '
      + 'markable in the browser, every route is refused server-side, admin is an account flag '
      + 'independent of the judge badge, and only Bena holds it.\n\n'
      + 'STILL OPEN, ON PURPOSE: rename, ban and delete. Asked which account actions to build, '
      + 'the owner chose read + badges + the admin flag — everything reversible — and left the '
      + 'destructive set for when he wants it. A delete has no undo below the nightly var/ '
      + 'tarball, so it wants a typed-name confirmation when it is built.\n\n'
      + 'THE ONE DESIGN CONSTRAINT WORTH CARRYING FORWARD: a report\'s implementation STATUS '
      + 'is not server state. It lives in ledgers/playtest-ledger.ts, which is committed '
      + 'source, so server/admin.ts imports the ledger and joins by id — the status shown is '
      + 'the status of the RUNNING BUILD, which is the only version of the question an '
      + 'operator has. It is read-only in the browser because an edit would write to a source '
      + 'file on the deploy box and die at the next git pull. The writable signal is the '
      + 'triage mark (var/report-marks.jsonl, append-only, last-write-wins), which comes down '
      + 'with `npm run reports` so the next round can see what he already dismissed.\n\n'
      + 'Two things were flagged here as "raise with the owner rather than silently fix". '
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
      'server/e2e/test-accounts.ts covers both halves: the sweep is gone, and the just-finished attach works',
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
      'client/server/e2e/test-accounts.ts',
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
    id: 'BL-44',
    slug: 'draft-any-element-resource',
    title: 'Draft: let "more…" make a resource of ANY element, not only the game\'s three',
    area: 'engine',
    size: 'S',
    status: 'open',
    track: 'qol',
    said:
      'The "More" sub menu for a game does need to have all the other elements in it. They\'re '
      + 'just hidden. But it\'s technically legal to make a Fire resource, even if you don\'t have '
      + 'any Fire cards in the deck. […] note that as being technically wrong and that we should '
      + 'allow any color element to be made via the more menu. It might literally never happen, '
      + 'but we should be faithful to the game. (2026-09-19)',
    means:
      'A draft game narrows `GameState.elements` to its trio, and `doRecycle` / '
      + '`doExchangePrismite` refuse any element outside it (21-fixes: "a fwe draft game refuses '
      + 'wood/metal resources and never offers them"). The rules do not: any resource can be '
      + 'created by recycling. So in draft, the other elements should be legal too — offered '
      + 'behind the recycle menu\'s "more…" (and the Prismite exchange menu\'s), never on the '
      + 'main menu, exactly as a constructed deck\'s off-elements already are (R99/R299).',
    doneWhen: [
      'In a draft game, recycling a hand card → "more…" lists the four elements not in the trio, then Shard',
      'Choosing one makes that resource, and an active Prismite can be exchanged into one too',
      'The main recycle menu in draft is unchanged: the trio, then Prismite, then "more…"',
    ],
    decided: [
      'Owner, 2026-09-19: the rules allow it; the client is "technically wrong" until it does. Low priority — "it might literally never happen".',
    ],
    touches: [
      'client/engine/src/apply.ts',
      'client/ui/main.ts',
      'client/ui/inspect.ts',
      'client/engine/test/21-fixes.test.ts',
    ],
    notes:
      'Found shipping R299 (#168). The menu already splits show/hidden through '
      + 'resourceMenuElements; the engine check is the real change, and it will drift every '
      + 'draft fuzz walk, so expect to re-seed the fixtures that pin one (143, 171, test-accounts '
      + 'search for theirs now).',
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const BACKLOG: Entry[] = [...OPEN, ...CLOSED].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
