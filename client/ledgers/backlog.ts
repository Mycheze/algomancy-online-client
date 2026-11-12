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
    asks: [
      'LATER — the owner, 2026-11-11, rejecting the staged practice-opponents branch: "I don\'t actually want this in the client yet. mark in the triage as \"later\" or something." Off the night queue until he asks for it again.',
    ],
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
      + 'light and aimed away from the play area) stands.\n\n'
      + '2026-11-08 (steward): post-game — the box no longer scrolls as a whole. Its body is two columns '
      + '(pages/postgame.ts .pgcols: .pgstats = the table + Unlocked, .pgside = the notes, keep-it forms, '
      + 'buttons, peek); from 900px wide they sit side by side in a 920px box and each scrolls inside itself, '
      + 'capped at 100dvh - 180px (19-postgame.css); narrower, they stack exactly as before. A full table plus '
      + 'four buttons was ~870px, so at 1024x768 the buttons went under the fold. Guarded by '
      + '1176-postgame-fits-window.test.ts. Reasoned, not looked at (the home box has no browser): worth an '
      + 'eye at 1024x768 and 1440x900.\n\n'
      + '2026-11-08 (steward): button labels outside the game start with a capital, as the owner-approved home, '
      + 'profile and decks pages already did (docs/23-ui-inventory/05 §18.11): the share bar\'s Copy (every room) and '
      + 'its "Copied ✓", the draft lobby\'s Start over / Fill the rest in any order / Finish choosing first, the '
      + 'post-game\'s View the final board, the card browser\'s Show N more / Find similar / Rulings / Copy link / '
      + 'Save search / Forget, the metagame\'s Clear / Card list / Whole deck (JSON) / Copy / Close, card stats\' '
      + 'Clear, the league\'s Use <zone> / Set, the "kicked" notice\'s Home. Left lower-case on purpose: links inside a '
      + 'sentence (cblink, ui-button--link), element chips, and the game table (main.ts board toggles, lesson, '
      + 'sandbox). Guarded by 1177-button-labels-start-with-a-capital.test.ts (every page story rendered + the '
      + 'labels written in pages/*.ts and util.ts).\n\n'
      + '2026-11-09 (steward): a refusal outside the game is drawn as an error, not in a note\'s gold '
      + '(docs/23-ui-inventory/05 §18: "Errors and successes share .deckmsg gold"). The 2026-11-03 round had '
      + 'put every message line on statusMessage() in the `note` tone, "under today\'s look"; on seven sites '
      + 'that line only ever holds a failure (uiError, the sign-in screen\'s authMsg, the room friends panel\'s '
      + 'invite failure): home\'s Play card, the Constructed and Single Card Duel rooms, the match room and its '
      + 'sideboard bar, sign-in, Invite a friend. They are tone `error` (red, role="alert") with class '
      + '`.pageerr` (margins only; `.deckmsg` would have re-coloured them gold). Left in the note gold: the deck '
      + 'picker\'s line (it carries "loaded X" as well as refusals) and the match\'s deck-legality line (a state, '
      + 'beside counts already in red). Guarded by 1200-refusals-drawn-as-errors.test.ts.\n\n'
      + '2026-11-09 (steward): nothing pulses forever under prefers-reduced-motion (docs/23-ui-inventory/05 '
      + '§18.27: ".pgwants pulses forever with no reduced-motion override"). The class was seven rules, not one: '
      + '.pgwants (19-postgame), .lanchor.on and .lhl (32-learn), .livedot (16), .card.activatable (03), '
      + '.card.modhost and .stackcard.modhost (12). Each now has a reduce block beside it with animation: none; '
      + 'the glow, outline and colour stay, so the meaning does. Left as it was: the queue spinner, which the '
      + 'reduce block slows (a spinner that stops reads as frozen). Guarded by the census '
      + '1201-endless-motion-honours-reduce.test.ts: every `infinite` animation in the stylesheet must have its '
      + 'selector named in a reduced-motion block.\n\n'
      + '2026-11-09 (steward): the draft lobby draws its failure line (docs/23-ui-inventory/05 §18.16: "Draft lobby '
      + 'shows no error or disconnect line"). pages/lobby.ts took no error and pages/waiting.ts\'s trio branch handed '
      + 'it none, so "disconnected from the server — reconnecting…" and a server refusal (main.ts `uiError = m.msg`, '
      + 'with the error cue) left the lobby silent. LobbyArgs.error is drawn red under the seats, the same '
      + 'statusMessage error line as the Constructed and Single Card Duel rooms; story "The connection dropped". '
      + 'Guarded by 1200-refusals-drawn-as-errors.test.ts §3.\n\n'
      + '2026-11-09 (steward): the queue page\'s direct challenge says "Joining Rashi\'s game…", not "Joining Rashi '
      + 'game…" (docs/23-ui-inventory/05 §18.13, missing possessive; pages/queue.ts searchingHtml). With no name it '
      + 'stays "Joining their game…". Swept the ui and server templates for another name used before a noun without '
      + '\'s: none. Left: §18.13\'s "Rank all seven" (server/trio.ts) — the game has seven elements and the method '
      + 'ranks all of them, so it is not wrong today. Guarded by 970-page-queue-html.test.ts §2.\n\n'
      + '2026-11-09 (steward): the connecting screen says what it is waiting for (docs/23-ui-inventory/05 §18.15: '
      + '"Connecting to the server…" shown while loading a replay file or booting a local lesson). Only a room link '
      + 'waits for the server; the five boot branches that open their game in the page say "Setting up your lesson…", '
      + '"Setting up the challenge…", "Loading the run…" (a watched challenge run), "Loading the replay…" and "Setting up '
      + 'the board…" (a rules question), through ConnectingView.waiting (main.ts connectingLine). Guarded by '
      + '1202-connecting-says-what-it-loads.test.ts (§2 a census of main.ts\'s boot chain). \n\n'
      + '2026-11-09 (steward): the reconnect state is not drawn as final (docs/23-ui-inventory/05 §18.19). A room link '
      + 'opened while the server is down or restarting put NetBackend\'s "disconnected from the server — reconnecting in '
      + 'Ns…" in uiError, and pages/connecting.ts drew every uiError as a refusal: red .joinerr and a "← Back to the home '
      + 'screen" button. NetBackend.retrying (set in ws.onclose, cleared at the top of onMsg, so a refusal after the retry '
      + 'is still drawn as one) reaches ConnectingView.retrying: the countdown is a role="status" line with "This page '
      + 'joins the room by itself as soon as the server answers.", and the toolbar\'s Home is the only way out, as while '
      + 'connecting. Story "Connecting: the server dropped, trying again". Guarded by 1203-reconnect-is-not-final.test.ts. '
      + 'Left: §18.19\'s other half, no connecting spinner.\n\n'
      + '2026-11-09 (steward): an instruction a player reads says "Tap" on a finger-first device (docs/23-ui-inventory/05 '
      + '§18.14: "Click 2 cards to put on the bottom…" not in .remind). The class was ten lines: the draw step\'s panel and '
      + 'its empty row, the cache\'s "click one", the stack viewer\'s mod host, the battle\'s "Click a spot on the line", the '
      + 'blockers\' prompt, the burst token tip (tips open on a tap), the draft lobby\'s ranking hint, the card browser\'s '
      + 'element note, the deck description help. Each writes its verb with util.ts clickOrTap() (.mouseonly/.touchonly). '
      + 'Guarded by the census 1204-click-says-tap-on-touch.test.ts over main.ts and pages/*.ts (title= text is hover-only '
      + 'and passes). Left: the engine\'s own Discharge cost prompt ("click a unit to take counters off it", owner-asked, '
      + 'quoted in the CR) and the help layer\'s prose (tutorial.ts, lessons.ts): written for a mouse, it '
      + 'names a touch gesture only for right-click; a pass of its own.\n\n'
      + '2026-11-10 (steward): every text box, menu and writing area has a name a screen reader can say '
      + '(docs/23-ui-inventory/05 §18.24: "Unlabelled inputs: share link, deck <select>, #h-deckurl, #sc-q, post-game '
      + 'claim inputs (placeholder-only)"). The class was 51 controls: the room link (util.ts shareBar) and the metagame\'s '
      + 'deck link, the deck menu (deckpicker, match), every search box (cards, metagame, card stats, rules x2, deck '
      + 'builder, sandbox, single-card duel), the post-game and profile username/password boxes, the friend box, the '
      + 'report/dispute/take-back boxes and the take-back form\'s menus, the league\'s forms, the judge boxes, the comment '
      + 'box, the scenario notes, the exported-deck text. Each got an aria-label (nothing moves on screen). settingRow\'s '
      + 'label column is a <div> tied to nothing; its comment now says a bare control passed to it names itself. Guarded '
      + 'by the census 1205-form-controls-have-names.test.ts (every page and component story rendered, and every '
      + 'control written in ui/*.ts, pages/*.ts, components/*.ts).\n\n'
      + '2026-11-10 (steward): every button drawn as a symbol has a spoken name (docs/23-ui-inventory/05 §18.25: '
      + '"Transport buttons are glyphs with `title` only (replaybar.ts:183–188)"). A button is named by its content '
      + 'before its title, so ⏮ was read as the glyph. The class was 33 buttons: the replay bar\'s × ⏮ ◀ ⏸/▶ ▶| ⏭, the '
      + 'lesson frames\' ⏮ ▶ ⏭, the table toolbar\'s 📘 🧪 ☰ ↶ ⚖ ? 📝 ⋯, the seen-hand strip\'s ✕, the card panel\'s, '
      + 'scenario\'s, notifications\' and challenge run\'s close, the card browser\'s × ? and ↑/↓, the sandbox\'s − / +, '
      + 'the rules review\'s ↻, the bell (its count in the name), the admin report marks 👍 👎 ✕ (now ui-button '
      + 'variant icon, which has no CSS of its own). Each kept its title and got a short aria-label; nothing moved on '
      + 'screen. Guarded by the census 1206-glyph-buttons-have-names.test.ts (stories rendered + ui/pages/components '
      + 'source). Left: §18.25\'s other half, .elchip unselected vs disabled opacity.\n\n'
      + '2026-11-10 (steward): a button that shows it is chosen says so to a screen reader (docs/23-ui-inventory/05 '
      + '§18.23: "Radio-like groups are plain buttons with `.on`, no `aria-pressed`/`role=\"radio\"`: lobby methods, queue '
      + 'format, ranked/open, rank chips, replay moments"). The class was 40 buttons whose look changes with `.on`: the '
      + 'draft lobby\'s methods and element chips, Ranked/Open, every element filter chip (home, metagame, card stats, the '
      + 'card browser\'s facet chips), the clock presets, the learn page\'s elements, the metagame\'s grouping and export, '
      + 'the card-stats sort, the deck cover tiles, the league\'s skip weeks and grid presets, the table\'s option switches '
      + '(auto-pass, bluff haste, motion, sound, the log\'s detail, the deck search\'s scope), the replay\'s eye and '
      + 'moments, the sandbox zones, the rules review\'s tabs and filters, the admin report marks. A choice or a switch '
      + 'got aria-pressed, a button that opens a panel aria-expanded (search syntax, a past week\'s leaderboard, the deck\'s '
      + 'stats, the replay question, the rules review\'s Questions and Download, kept in step where crreview.ts toggles '
      + 'them in place), a place in a list aria-current (the rules reader\'s and review\'s contents). An excluded facet '
      + 'chip is also named "Hiding <label>". Nothing moved on screen. Guarded by the census '
      + '1207-chosen-buttons-say-so.test.ts (stories rendered + ui/pages/components source). Left: §18.23\'s roles '
      + '(role="radio"/radiogroup and arrow keys) — aria-pressed is what the segmented component already uses.\n\n'
      + '2026-11-10 (steward): a table\'s headers and the post-game\'s title say what they are (docs/23-ui-inventory/05 '
      + '§18.26: "post-game title is a `<div>`, not a heading; stat table has an empty `<th>`; `<em>` with '
      + '`font-style:normal` as a blurb"). The empty header was a class of nine columns: the post-game\'s middle column, '
      + 'the profile\'s Replay column and both Add friend columns, card stats\' win-rate bar and colour-pair corner, the '
      + 'board\'s resource window corner (ressum.ts), and through table()\'s `label: \'\'` the deck sheet\'s replay '
      + 'links and a closed challenge\'s Try / Watch buttons. Each holds a name drawn nowhere: `.srname` (base.css, '
      + 'not under :where so the board gets it), and table() columns take `spokenLabel`. The post-game title is an '
      + '<h2> (margin 0), its stat labels are <th scope="row"> (19-postgame.css keeps the head\'s bold and padding on '
      + 'thead, the rows\' dotted line on tbody th too), and the lobby\'s method blurb is span.lobbyblurb. Nothing '
      + 'moved on screen. Guarded by the census 1208-table-headers-and-headings-say-what-they-are.test.ts (stories '
      + 'rendered + ui/pages/components source, and every label-less table() column headless or spoken). Left: '
      + '§18.26\'s seat dots (an empty <i>, silent, the words beside it carry the state) and <b class="lockedin">; '
      + '§18.22 (dialog roles, focus trap) is the next accessibility pass.\n\n'
      + '2026-11-10 (steward): every box over the page is a dialog with a name (docs/23-ui-inventory/05 §18.22: "No '
      + '`role=\"dialog\"`, `aria-modal`, focus move or focus trap on any overlay here (concede, match found, pick, pick-set, '
      + 'trio reveal, post-game)"). The class was thirteen boxes: every box on the board\'s .overlay scrim (a player\'s bin, '
      + 'erased cards and cache, the inspector, the judge, the game log, the draft pick, the pick-a-set/piles window, the '
      + 'trio reveal, the concede question, the post-game) plus the queue\'s Match found and the Past reveals layer. Each got '
      + 'role="dialog" and an aria-label in its own title\'s words ("Ann\'s bin", "Concede the game?", "You win!"); concede\'s '
      + 'three titles are one `title` now, drawn and spoken. The rules reader, report forms, lesson, challenge results, '
      + 'comment sheets, ui-sheet and ui-dialog already had both. Guarded by the census 1209-overlays-are-named-dialogs.test.ts '
      + '(the scrim classes read off the stylesheet: fixed, inset 0, takes the pointer; every scrim in ui/pages/components '
      + 'source and every story must open onto a named dialog). Left: §18.22\'s other half — aria-modal, moving focus into '
      + 'the box and keeping it there; the board repaints #app wholesale, so that is behaviour to build and walk with a '
      + 'keyboard, not markup.\n\n'
      + '2026-11-10 (steward): a disabled element chip no longer looks like an unchosen one (docs/23-ui-inventory/05 '
      + '§18.25\'s other half: "`.elchip` unselected (opacity .55) and disabled (opacity .4) are near-identical"). The one '
      + 'place a chip is disabled is the draft lobby once you lock in (pick one and rank); the frozen elements dimmed from '
      + '.55 to .4 and nothing else. `.elchip:disabled:not(.on)` (shared/10-element-chips.css) is now .35, grayscale and a '
      + 'dashed border, so the cue does not rest on a shade or on colour; a chosen chip that is locked keeps its look. '
      + 'Swept the other dimmed-when-unchosen buttons (.favel, .ttelchip, .cbchip, .lobbymethod): none is ever disabled '
      + 'while dimmed. Guarded by 1210-disabled-chip-is-not-unchosen.test.ts. Reasoned, not looked at (no browser).\n\n'
      + '2026-11-10 (steward): a match offer at 0 says it is over (docs/23-ui-inventory/05 §18.20: "Match-found countdown '
      + 'at 0 has no expired state"). The box sat on a live "Accept 0", or "Waiting for Rashi… 0", until the server\'s 1s '
      + 'sweep pushed the lapse, and for ever on a dropped socket; the local count starts at the message\'s arrival, so its 0 '
      + 'is after the server\'s. pages/queue.ts offerHtml at left 0 draws no Accept and no count: a role="status" line '
      + '(data-qexpired), "Time ran out, so the game was not started." with Close, or, accepted, "Rashi did not answer in '
      + 'time. You go back to the front of the queue." with Cancel. queue.ts tickInPlace repaints once into it and then '
      + 'leaves it (no per-second rebuild, test 902). Stories "Match found, time ran out" and "…accepted, they did not '
      + 'answer". Guarded by 1211-match-offer-runs-out.test.ts (§2 drives the module through a fake socket). Left: '
      + '§18.20\'s other two (no live region for the queue, no rating delta on the post-game), and the table\'s fix-proposal '
      + 'bar (amend.ts barHtml), which also keeps its Agree at "0s"; checked the other countdowns (match.ts clock, the '
      + 'game clocks): they are clocks, not offers. Reasoned, not looked at (no browser).\n\n'
      + '2026-11-10 (steward): the same thing is said in the same words (docs/23-ui-inventory/05 §18.12: "Same idea, '
      + 'different words"). Three pairs: the draft lobby\'s absent seat said "has not arrived yet" and named a nameless '
      + 'opponent "Your opponent", the other rooms say "not here yet" and "Opponent" (pages/lobby.ts seatLine); the '
      + 'post-game\'s "Join matchmaking queue" is "Find a game", the home strip\'s button to the same screen; the bar that '
      + 'brings constructed\'s hidden bottom-2 back said "Draw step" (CR 503.1, the draw of 2 alone), now "Draw phase" '
      + 'like the panel and CR 901.5 (main.ts pickShowHtml). Left on purpose: "Leave" in a waiting room beside "Return to '
      + 'home" after a game (leaving a room is not going home), and "Opponent" as a column head or name vs "Your opponent" '
      + 'in a sentence. Guarded by 1212-same-thing-same-words.test.ts.\n\n'
      + '2026-11-10 (steward): the matchmaking counter says when the server stops answering (docs/23-ui-inventory/01 §4 '
      + 'S16: "No \\"can\'t reach the server\\" state for the matchmaking strip: it keeps the last number, or \\"checking…\\" for '
      + 'ever when offline"). ui/queue.ts\'s 5s poll swallowed every failure, so a server that went down left the home\'s '
      + 'Matchmaking card on a lit "2 waiting" with the open games\' Join buttons. Two misses in a row (a thrown fetch, or '
      + 'a reply that is not JSON or has no counts, as Caddy\'s 502 during a restart) set QueueSnapshot.unreachable; '
      + 'queueStripView and queueView then drop the stale counts and open games, and the strip, the home glance and the '
      + 'queue page\'s line read "could not reach the server — trying again…" (UNREACHABLE_LINE). The first answer, or a '
      + 'socket push with counts, clears it. One repaint per flip, none while it stays down. Story "Home card glance, '
      + 'the server not answering". Guarded by 1213-queue-counter-says-unreachable.test.ts (§2 drives the real poll '
      + 'through a fake fetch). Left: S16\'s other lines (a silent reload after a deploy, league and challenge fetch '
      + 'failures drawing nothing, an empty room code ignored). Reasoned, not looked at (no browser).\n\n'
      + '2026-11-11 (steward): a − / + stepper says which number it moves (docs/23-ui-inventory/01 §4 S15: "`.crknob` −/+ '
      + 'have `aria-label=\"fewer\"/\"more\"` without the knob\'s name"). 1206 passed them: it asks only that a symbol '
      + 'button has a name. The class was two pairs: the Game values sheet\'s five knobs (pages/customrules.ts '
      + 'gameValuesHtml, now "Pack size: one less" / "…: one more" off KNOB_LABEL) and card stats\' min games '
      + '(pages/cardstats.ts minGamesHtml). The sandbox\'s mana pair already said "One less Fire". Nothing moved on screen. '
      + 'Guarded by the census 1225-steppers-name-what-they-change.test.ts (every − / + button in ui/pages/components '
      + 'source, and the sheet rendered). Left: S15\'s `.crknob.changed`, a changed value told by colour alone.\n\n'
      + '2026-11-11 (steward): a state is told by more than its colour (docs/23-ui-inventory/01 §4 S15: "Colour is the only '
      + 'state cue for `.qstripcount.live`, `.crknob.changed`, `.lgbdates .now/.past` and `.lgbrows li.mine`"). The class '
      + 'was four: the Game values sheet\'s changed number (pages/customrules.ts gameValuesHtml: a ● beside its name, '
      + 'title and spoken text "changed from the standard N"), the league banner\'s dates (pages/league.ts: ✓ and a '
      + 'spoken "Over:" on the past ones, bold and aria-current="step" on now), the banner\'s own pairing (a 3px accent '
      + 'bar and a spoken "Your match:") and, same shape on the home League card, the track\'s now step (bold, '
      + 'aria-current). Left on purpose: `.qstripcount.live`, whose words already differ ("nobody waiting" vs "2 '
      + 'waiting"). Guarded by 1226-state-not-by-colour-alone.test.ts (§4: each state rule declares a property that is '
      + 'not a colour). Reasoned, not looked at (no browser).\n\n'
      + '2026-11-11 (steward): a button pressed with its box empty says what is missing (docs/23-ui-inventory/01 §4 S16: '
      + '"An empty room code is ignored with no message"). The class was five buttons that read a text box, found it '
      + 'empty and returned without a word: the home Join sheet\'s Join (pages/home.ts joinCodeTarget, a red line under '
      + 'the code row, "Type the room code first.", and the box takes the focus), the home Import sheet\'s Load and Use '
      + 'pasted list (pages/deckpicker.ts importDeck answers an empty box itself, with no request), the Decks page\'s '
      + 'import sheet, the same two (decks.ts EMPTY_DECK_LINK / EMPTY_DECK_LIST), and the profile\'s Add a friend '
      + '(account.ts EMPTY_FRIEND_LINE). Each line goes in the message spot that button already had. Story "Sheet: Join '
      + 'a room, Join pressed with no code". Guarded by 1227-empty-box-is-said.test.ts (§4 a census: no ui/ or pages/ '
      + 'handler reads a box and returns silently on empty). Left on purpose: the two ask-the-judge boxes (table and '
      + 'lesson), chat boxes whose Ask sends nothing when empty. Left: S16\'s silent reload after a deploy, and league '
      + 'and challenge fetch failures drawing nothing. Reasoned, not looked at (no browser).\n\n'
      + '2026-11-12 (steward): the League, Weekly challenge, Metagame and Card stats pages say how it went '
      + '(docs/23-ui-inventory/02 §8.1 item 2: "`.acctmsg` has no CSS … Action results and errors on two pages are bare '
      + 'text", §8.5 item 28 "looks the same for success and failure", §8.6 item 37 no role="status"; 03 §0.3 for the '
      + 'metagame and card stats). The class was six `<div class="acctmsg">` lines in pages/league.ts, challenge.ts, '
      + 'meta.ts (x3) and cardstats.ts. Each controller sets its line only through say(text, tone) and the view carries '
      + 'msgTone; the page draws statusMessage() in it: a refusal red with role="alert", a result ("Saved.", "Copied.", '
      + '"You\'re in …", "Copied into your collection") green with role="status", the metagame\'s "copying…" and card '
      + 'stats\' "Only N games match these filters" in the note gold. Story "A button\'s result" (League). Guarded by '
      + '1231-page-messages-say-how-it-went.test.ts (§2 a census: no controller sets msg but through say()). Left: '
      + '§8.5 item 28\'s other half, the league line never clears; and the home cards\' silent league and challenge '
      + 'fetch failures (S16). Reasoned, not looked at (no browser).',
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
      'The owner named it as a future item on 2026-11-03. Do not fold it into a palette round.',
      'The switch is Settings → Colours → Standard / Accessible on the profile (owner, 2026-11-07, ui/prefs.ts: '
        + 'data-colors="accessible" on <html>, kept in localStorage algoColors). It is "for red-green colour blindness": '
        + 'it re-points the colours that collide and keeps each element\'s family — it is not a separate high-contrast skin.',
    ],
    asks: [],
    deps: [],
    touches: [
      'client/ui/styles/tokens.css',
      'client/ui/prefs.ts',
      'client/ui/test/1030-manual-palette.test.ts',
      'client/ui/test/1160-accessible-colours.test.ts',
      'client/ui/test/1221-accessible-palette.test.ts',
    ],
    notes:
      'Starting numbers, from the palette round (var/records/ds-round-2026-11-03-r2-theme.md): on the '
      + 'purple, the element colours as SHAPES are below 3:1 on a raised panel — Dark 2.5:1 (was 3.2 '
      + 'on the old slate), Earth 2.4:1 (3.1), Wood 2.9:1 (3.6); the favourite-element picker\'s Dark '
      + 'icon reads faint. Danger text on a raised panel is 3.95:1 and white on the red badges 3.03:1, '
      + 'the two pairs the default palette leaves under 4.5. The board\'s state colours are table roles '
      + 'in tokens.css (--glow legal green, --target targeting gold, --pending teal, --danger); green '
      + 'vs gold and teal vs green are the pairs a deuteranope loses first. '
      + 'PROGRESS. 2026-11-07 (profile round): doneWhen 1 — the switch, remembered per browser, on a guest\'s profile too; '
      + 'fire, earth, wood, legal, targeting, in progress and success re-pointed, and the fire/earth/wood icons swapped '
      + '(ui/test/1160). 2026-11-11 (steward): doneWhen 4 — ui/test/1221 recomputes the theme\'s numbers (Machado 2009 + '
      + 'CIEDE2000: elements 15.8 apart in every vision, the four table roles 15.9 — the comment had said 24.1, it was 18.0 — '
      + 'and AA for every text colour the theme re-points); "in progress" #b553d5 → #d080f8 (it was 2.9:1 as text on a '
      + 'raised panel); and the targeting half of doneWhen 3: in the mode a target (.card / .life / .stackcard .candidate) '
      + 'wears a ◎ mark (a mark, not a doubled ring: ui/test/326 holds the owner\'s 2026-09-27 "double green border" complaint), so legal and targeting differ by more than hue. '
      + 'STILL OPEN, measured 2026-11-11 with the mode on: (a) element colours as SHAPES on the panels — earth 1.5:1 on a '
      + 'raised panel (darker than the standard earth\'s 2.4), wood 2.2, dark 2.5, fire 3.5, water 3.5; 4.5 for a mid-tone '
      + 'element is not possible while white ink stays over 3:1 on it (a raised panel needs luminance ≥ .35, white ink ≥ 3 '
      + 'needs ≤ .30), so the shape needs an outline or the chip a label, not a colour; (b) danger text on a raised panel '
      + '3.95:1 in both modes (lifting it puts white on the red badges under 3); (c) doneWhen 2, elements by shape or label '
      + 'everywhere, not yet audited; (d) other board rings that are hue alone: .card.selected #7fc0ff vs .card.playable '
      + '(cyan in the mode) are 6.9 apart to a tritan, both solid. '
      + '2026-11-11 (steward): (d) DONE for the picked ring — measured, it is worse to a deutan, the mode\'s audience: '
      + '#7fc0ff against the mode\'s cyan legal ring is 12.1 apart (43.8 against the standard green), so the mode made a '
      + 'picked card (formation, send list, a ticked pick-a-set card) and a pickable one look alike. In the mode a '
      + '`.card.selected` now wears a ✓ in the ◎ corner (board/03; a picked target keeps the ◎). Guarded by 1221 §5. '
      + 'Still open: (a), (b), (c). '
      + '2026-11-11 (steward): (b) DONE in the mode — red is two roles now: --color-danger (text, lines) and '
      + '--color-danger-fill (a background under white ink: the bell\'s count, damage chips, the over-cap and '
      + 'pool badges, the lost-target strip, the profile\'s loss bar — ten rules). The fill keeps #f06969 in both '
      + 'modes (white 3.03:1); the mode lifts the text to #ff7b7b (4.77:1 on a raised panel, 16.8 from the other '
      + 'table roles, 31.4 from a win to a deutan). Guarded by 1221 §3 and §6 (a census: no rule paints a background '
      + 'with the text red). The standard palette is unchanged (still 3.95:1 there; not a palette round). '
      + 'Still open: (a), (c). '
      + '2026-11-12 (steward): (a) DONE in the mode — every shape filled with an element colour (.pfswatch, .elbarseg, '
      + '.acctel, .res, .reschip, .resplate, .el-*) wears a 1px inset ring in --color-text (shared/10), which clears AA on '
      + 'every surface, so earth (1.5:1) and wood (2.2:1) no longer vanish into a raised panel, and a share bar\'s segments '
      + 'are split by a line. Guarded by 1221 §7, a census of every element-colour fill. Still open: (c).',
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
    asks: [
      'WAITING ON THE OWNER (steward, 2026-11-11): every doneWhen line but the last is done and guarded; the last is '
      + '"The owner has moved cards across on a real iPad", which no night run can do. Has the sideboarding table worked '
      + 'on your iPad between two Competitive games (tap or drag a copy across; your own piles; hover/hold zoom)? Yes closes '
      + 'BL-55; anything wrong becomes a CT. Off the night queue until then.',
    ],
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
      + 'pile on the tabletop has the same untried-device gap, filed as CT-516.\n\n'
      + '2026-11-08 (steward): (4) and (5) DONE — the fourth doneWhen line. server/match.ts matchSummary carries '
      + '`games: {winner, how}[]` and pages/match.ts matchResultHtml lists them under a Bo3\'s score ("Game 1: you won · '
      + 'Game 2: Bo won (conceded)"), on the match room\'s end screen and the post-game screen alike; ui/match.ts keeps '
      + 'pickId in localStorage (PICK_KEY). Guarded by 1175-match-games-and-pick.test.ts and 816 §1. Not looked at in a '
      + 'browser (the home box has none). Left: (1), (2), (3), (6).\n\n'
      + '2026-11-10 (steward tidy): (3) DONE — the third doneWhen line. BL-65 W4 (ee6b2e71, 2026-11-04) redrew the '
      + 'sideboarding table in the app frame, whose root carries `apppage` (1129 §1 pins it), and the floating report pill '
      + 'and bell are hidden under any `#app > .apppage` (shared/13-report-and-inbox.css, 1020); the 215px clearance is '
      + 'gone from 47-competitive-match.css. Re-checked at HEAD: (2) is still open (pages/match.ts deckPilesHtml still '
      + 'calls seedPiles(main, \'cost\')). Left: (1), (2), (6).\n\n'
      + '2026-11-10 (steward): (1) DONE — the first doneWhen line. zoom.ts zoomTarget falls back to tableTarget: a '
      + '`.ccsbtable [data-zoom]` tile with a scan is a hover target, shown as its scan alone (the press zoom\'s copy) at '
      + 'the hover zoom\'s width; never while `html.dragging`, and drag.ts begin() lets it go. The tabletop deck builder '
      + 'keeps only its press zoom (owner, 2026-10-21). Guarded by 1215-sideboard-table-hover-zoom.test.ts. Not looked at '
      + 'in a browser (the home box has none). Left: (2), (6).\n\n'
      + '2026-11-11 (steward): (2) DONE — the second doneWhen line. collection.ts matchDeckForPlay carries the saved '
      + 'deck\'s `piles` (sanitizePiles, clamped to its main); match.ts registrationFor/registerSeat store them on '
      + '`Registered.piles`, and matchLobbyInfo gives them to that seat only, in `mine.piles`. pages/match.ts matchPiles '
      + 'reconciles the REGISTERED arrangement to the current main on every paint (the builder\'s reconcilePiles), so a '
      + 'copy sideboarded out and back returns to its own pile; an emptied unnamed pile is not drawn; a deck never '
      + 'arranged, one registered off the wire, and a match registered before today stay by cost. Guarded by '
      + '1222-cc-registration-carries-piles.test.ts and 1223-cc-table-keeps-the-arrangement.test.ts. Not looked at in '
      + 'a browser (the home box has none). Left: (6), the owner on a real iPad — the last doneWhen line.',
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
      + 'className), the native checkboxes drawn light.\n\n'
      + '2026-11-10 (steward tidy): the fourth doneWhen line (the profile\'s password-change failure drawn as an error) '
      + 'is DONE: the profile redesign of 2026-11-07 (66e79da3) draws it with statusMessage tone \'error\' '
      + '(pages/profile.ts, the Account section), a success with tone \'ok\'. 732 §3 now pins both classes, and went red '
      + 'with the tone flipped to \'note\'. Re-checked the rest at HEAD, all still open: the signed-in Alerts button passes '
      + 'no `on` (pages/frame.ts toolHtml), `.zonelabel` is still defined in board/03, rootAttrs still writes `disabled` '
      + 'after the pass-through attrs, meta.ts still shares one `text`, 34-cardstats.css still has the two hex fills, and '
      + 'the three TODO(ds) splits are still in pages/home.ts, challenge.ts and league.ts.\n\n'
      + '2026-11-10 (steward, BL-63): the sixth doneWhen line (the card stats bar fills) is DONE: tokens.css gains '
      + '--color-data-draft (#4fb3c9) and --color-data-constructed (#9aa5b0), the funnel bars\' categorical colours, '
      + 'kept apart from --color-winrate-up although the draft one shares its value (a count is not a win rate). '
      + '34-cardstats.css reads them; same pixels. 921\'s ratchet for pages/cardstats went 3 → 1 (the hover row\'s '
      + 'white wash is left) and went red with #4fb3c9 put back.\n\n'
      + '2026-11-11 (steward, BL-63): the first doneWhen line (Alerts pressed while the inbox list is open) is DONE. '
      + 'FrameChrome gains `alertsOpen` (inbox.ts inboxListOpen: the list is open AND drawn, so false signed out, on a '
      + 'board and on a game page); pages/frame.ts toolHtml passes it as the signed-in Alerts\' `on`, the home\'s view '
      + 'and main.ts\'s chrome source read it, so every repaint draws it; and inbox.ts paint() presses every '
      + '`.ui-icon-button[data-inbox="bell"]` in place, since a click on the bell repaints only the layer, never the page '
      + 'under it. Guarded by 1224-alerts-pressed-while-open.test.ts, which went red with each of the three removed. '
      + 'Not looked at in a browser (the home box has none). Left: lines 2, 3, 5, 7, 8.\n\n'
      + '2026-11-11 (steward, BL-63): the fifth doneWhen line (the Metagame filter carrying between the card ladder and '
      + 'the deck list) is DONE. meta.ts keeps `ladderText` beside the list\'s `text`; HOOKS.setText writes the one for '
      + 'the tab that is up, pages/meta.ts ladderHtml reads and draws `ladderText`, and the list\'s Clear clears only its '
      + 'own. Guarded by 1228-meta-filters-per-tab.test.ts (driven through the real client), which went red with setText '
      + 'writing `text` for both and again with ladderHtml reading `text`. Left: lines 2, 3, 7, 8.\n\n'
      + '2026-11-11 (steward tidy): the seventh doneWhen line (is the tabletop\'s `!inGame` rerender guard reachable, as '
      + 'the waiting-room deck page\'s was) is CHECKED, and it is not reachable. tabletop.ts calls the host rerender in two '
      + 'places only: closeTabletop() with no host (its one caller, handleButton\'s `tt-close`, returns early when there is '
      + 'no host, so Back always runs the host\'s own close; the deck page\'s is a paint(), which draws in a room too), and '
      + 'renderScreen()\'s "the ?table= deck never resolved" exit. renderScreen() is called only from main.ts renderHome(), '
      + 'which never runs in a `?room=` (renderNow paints the room, renderWaiting, instead), so in a room that exit cannot '
      + 'happen; outside one `!inGame` is true. The deck page\'s own guard was fixed on 2026-11-02 (908). Seen by reading, '
      + 'not in a browser. Not filed, an owner-taste question rather than a defect: a deck page or builder opened from a '
      + 'waiting room is still painted over by the room on the next server push (an opponent arriving); the 2026-11-03 '
      + 'inventory (docs/23-ui-inventory/05 §4) noted it. Left: lines 2, 3, 8.\n\n'
      + '2026-11-11 (steward, BL-63): the second doneWhen line (`.zonelabel` in base.css) is DONE. The rule moved from '
      + 'board/03 to base.css beside .eyebrow, in tokens (same values: --dim is --color-text-muted, 11px, 8px), and stays '
      + 'BARE (0,1,0), not :where — its ~20 in-context overrides on the board and pages were written against that, and the '
      + 'board uses it most. Nothing between base.css and board/03 in index.css (the components, board/02) matches a '
      + '.zonelabel, and every use is class="zonelabel" alone, so no pixel moves. Kept as .zonelabel, not renamed to '
      + '.eyebrow: they differ by the top margin, and 36 call sites plus ~20 overrides would churn for nothing. 925 now '
      + 'lists .zonelabel as a base selector and §2 fails on a bare .zonelabel in any other piece, board included; it went '
      + 'red with the old rule put back in board/03. Left: lines 3, 8.\n\n'
      + '2026-11-12 (steward, BL-63): the third doneWhen line (the report dialog can use button()) is DONE, from the test '
      + 'side rather than the component\'s: moving `disabled` after the pass-through attrs in button() would only have '
      + 're-pinned the home page\'s six order-reading assertions (960 newgame: `disabled data-mode=…`). Instead 287\'s '
      + 'sendDisabled and 521 §2 read `disabled` off the Send button\'s own tag in either order, and pages/report.ts draws '
      + 'Cancel (secondary) and Send (primary, disabled while busy or incomplete) with button(); the kind/severity radios '
      + 'stay hand-written (.reportchoices button). Same pixels: .ui-button and .ui-button--primary are base.css\'s '
      + 'button / button.primary in tokens (5px 12px, radius 5px). 978 §2 now pins both buttons\' whole markup; with '
      + 'Send\'s disabled forced false, 287 (3 tests), 521 §2 and 978 §2 went red. components/README.md no longer lists '
      + 'the dialog as a leftover. Left: line 8.',
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
    decided: [
      'The home box does not get a Chrome for this: "No, the box shouldn\'t run chrome like that." (owner, '
        + '2026-11-08, answering the steward\'s BL-64 handoff). What is left is for a session on the dev laptop.',
    ],
    asks: [
      'a session with a browser (the dev laptop) to run the checks below; the steward cannot (no Chrome on the '
        + 'home box, and it is not to get one, see decided). Clear this once someone is at the laptop.',
    ],
    deps: [],
    touches: [
      'client/server/e2e/ui-shots.mjs',
      'client/server/e2e/ui-shots-states.mjs',
      'client/server/e2e/ui-shots-compare.mjs',
      'client/server/e2e/ui-shots-stable.mjs',
    ],
    notes: 'Sources: the ds-pages, ds-base, ds-w2c and ds-w3a records under var/records/. '
      + '2026-11-07 (steward): three of the four causes are fixed in the tool, ui-shots-stable.mjs, guarded by '
      + '1172-ui-shots-stable-runs.test.ts: Chrome browses one fixed origin (http://ui-shots.test, mapped to the '
      + 'server\'s port by --host-resolver-rules; --port-origin puts 127.0.0.1:<port> back), focus is emulated, and '
      + 'a shot waits for every visible "Loading…" line (and for its `check`), a page still loading being a failure. '
      + 'NOT verified in a browser: the home box has no Chrome. Left: (a) a real two-port run to prove doneWhen — if '
      + 'the run stops at once with "did not reach the server", the resolver mapping did not take; (b) the cardstats '
      + 'thumbnails\' ±2 edge jitter (image downscaling), still absorbed by --fuzz 3, not cured; (c) decks__first '
      + 'no longer exists (BL-65 rebuilt the deck screens), so its art jitter needs re-measuring on decks__*.'
      + ' 2026-11-08 (steward): parked for the laptop on the owner\'s answer; `asks` keeps it off the night queue.',
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
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const BACKLOG: Entry[] = [...OPEN, ...CLOSED].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
