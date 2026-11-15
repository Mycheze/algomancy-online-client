import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-05',
  slug: 'cube-draft',
  title: 'Cube draft — pregame pod draft into a 30-card constructed tournament',
  area: 'play',
  size: 'XL',
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
    'client/docs/25-cube-draft.md',
    'client/server/cube.ts',
    'client/server/cube-types.ts',
    'client/ui/cube.ts',
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
    + 'presets, and are part of why the pack structure has to be configurable at all. '
    + 'PROGRESS 2026-11-14 (tidy): built that day as "cube draft events", to the owner\'s new '
    + 'spec of the same day, client/docs/25-cube-draft.md, which supersedes this entry where '
    + 'they differ (its section 1 is his, section 13 his playtest feedback; section 12 lists '
    + 'the calls made without him). Built: a host opens an event from a list or chosen elements, '
    + 'players join by link or code, the pod drafts before any game (bots fill seats), each '
    + 'builds from only their picks, a deck short of 30 is refused at submit, then a Swiss, '
    + 'round-robin or exhibition tournament of ordinary rooms. Still missing against doneWhen, '
    + 'so this stays open: (1) NO DECKBUILDING TIMER: the building phase has no deadline at all '
    + '(server/cube-types.ts carries a deadline only for the pick clock; the host\'s "Start now" '
    + 'drops whoever has not submitted); (2) NO SAVED CUBE LIST: a pasted list lives only in its '
    + 'event, nothing in server/accounts.ts keeps it for the next one; (3) a cube too small for '
    + 'the table is no longer a warning but, by the owner\'s new choice, three packs shrunk to '
    + 'fit, refused below 30 cards a player (docs/25 sections 1 and 12.17); doneWhen line 3 is '
    + 'met in that form.',
} satisfies BacklogTicket;
