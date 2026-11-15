import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-03',
  slug: 'single-player-challenges',
  title: 'Single-player challenges — simple scripted opponents',
  area: 'teaching',
  size: 'L',
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
} satisfies BacklogTicket;
