import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-55',
  slug: 'sideboarding-table-leftovers',
  title: 'Competitive: what the sideboarding table and match screens still lack',
  area: 'client',
  size: 'M',
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
} satisfies BacklogTicket;
