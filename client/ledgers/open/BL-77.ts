import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-77',
  slug: 'card-zoom-on-every-page',
  title: 'The card zoom (middle click, hover, press-and-hold) on every page that shows a card',
  area: 'client',
  size: 'M',
  track: 'qol',
  said:
    'The "middle click to zoom in" on a card should work in ALL pages that have cards! Including the card search, '
    + 'viewing other decks, the card metagame list, everything. We should make it a codified action to "zoom in" on '
    + 'a card. (owner, report #404, 2026-11-14, filed from the meta deck page)',
  means:
    'ui/zoom.ts is the board\'s magnifier: a mouse hover, a middle click and a finger\'s press-and-hold raise a '
    + 'floating copy of the card. Its targets are the board\'s cards, plus a few tables that opted in (the sideboard '
    + 'table, BL-11\'s doneWhen; the draft pick and pool pages import it). The other pages that draw cards (the card '
    + 'search, a deck someone shared, the metagame deck list he filed from, deck stats, the builder, the profile\'s '
    + 'decks…) do not. Make "zoom in on a card" ONE action with one way in, that any page\'s card markup gets by '
    + 'wearing the same attribute, and put every card-showing page on it. Find every page that draws a card first '
    + '(ui/pages/*.ts, the components) and list which have it.',
  doneWhen: [
    'On every page that shows a card, a middle click on it (and a press-and-hold on a touch screen) shows the big zoom',
    'A card on a new page gets the zoom by wearing one shared attribute or helper, and a test fails on a card-drawing page without it',
  ],
  decided: [],
  asks: [],
  deps: [],
  touches: [
    'client/ui/zoom.ts',
    'client/ui/pages/',
  ],
} satisfies BacklogTicket;
