import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-08',
  slug: 'large-table-pacing',
  title: 'Large tables that do not take forever',
  area: 'engine',
  size: 'L',
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
} satisfies BacklogTicket;
