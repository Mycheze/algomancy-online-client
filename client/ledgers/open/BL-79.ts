import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-79',
  slug: 'draws-in-the-records',
  title: 'A drawn game shows as a draw in profiles, deck records and match history',
  area: 'accounts',
  size: 'M',
  track: 'qol',
  said:
    'B - make it a draw. Nyar is right. But this is the only case (now) where a draw can happen. '
    + 'Both players go to the same "losing" life total (0 or below) at the same moment, from the same effect',
  means:
    'CT-565 made the tie at 0 a real draw at the table: the game ends with no winner, the end screen '
    + 'says "A draw", a match plays another game, and ratings, the card ladder and card stats skip it. '
    + 'The account records do not know the word yet: stats.ts summarizes a drawn game as finished: false, '
    + 'so the profile and deck records count it with the unresolved games (not a win, not a loss, no '
    + 'streak broken) and the match history row shows "?". This is the follow-up that teaches them a draw.',
  doneWhen: [
    'A drawn game is summarized as finished with no winner, and every fold that reads finished/won (accounts.ts profile, opponents, match rows; collection.ts and publicdecks.ts deck records) counts it as a draw, never as a loss',
    'The profile, the deck page and the match history show draws ("Draw", W–L–D), and a draw neither extends nor breaks a win streak',
    'A drawn game file older than the restore window is left as a finished game, not closed as idle (rooms.ts restore keys "finished" on a stamped winner)',
  ],
  asks: [
    'Whether a draw should move ratings (Elo half a point each) or stay unrated as it is now.',
  ],
  deps: [],
  touches: [
    'client/server/stats.ts',
    'client/server/accounts.ts',
    'client/server/collection.ts',
    'client/server/publicdecks.ts',
    'client/server/rooms.ts',
    'client/ui/pages/decks.ts',
  ],
  notes: 'Filed beside CT-565 (2026-11-16), from the owner\'s answer to it.',
} satisfies BacklogTicket;
