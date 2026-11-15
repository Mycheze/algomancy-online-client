import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-04',
  slug: 'tournaments',
  title: 'Tournaments — Swiss and exhibition pairings with standings',
  area: 'play',
  size: 'XL',
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
    + 'builds and this one reuses per round. '
    + 'PROGRESS 2026-11-14 (tidy): the pairing half now exists, inside cube events only: '
    + 'server/cube-tourney.ts is a pure Swiss / round-robin / exhibition pairer with standings, '
    + 'OMW%/GW%/OGW% tie-breaks floored at 1/3, byes and host edits, and server/cube.ts opens '
    + 'ordinary match rooms per pairing and pushes players into them. A standalone tournament '
    + '(no draft, players bring constructed decks) does not exist yet; building it should reuse '
    + 'those two rather than write a second pairer.',
} satisfies BacklogTicket;
