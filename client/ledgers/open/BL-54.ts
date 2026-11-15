import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-54',
  slug: 'draft-card-pool-setting',
  title: 'Draft: a card-pool setting — base game or with Light & Dark',
  area: 'server',
  size: 'M',
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
} satisfies BacklogTicket;
