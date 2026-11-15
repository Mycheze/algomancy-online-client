import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-67',
  slug: 'spectate-has-a-way-in',
  title: 'Spectating has no way in but a typed URL',
  area: 'client',
  size: 'S',
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
  notes:
    'PROGRESS 2026-11-14 (tidy): the first button-reached way in exists, for cube events only: '
    + 'the event page\'s match list has a Watch button on every live match that is not yours '
    + '(ui/pages/cube.ts), opening the room with watch=1. Ordinary games still have none, and the '
    + 'interface guide (ui/tutorial.ts, "A room link with &watch=1 on the end") still tells players '
    + 'to type it, so neither doneWhen line is met.',
} satisfies BacklogTicket;
