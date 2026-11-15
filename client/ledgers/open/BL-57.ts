import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-57',
  slug: 'redesign-remaining-pages',
  title: 'Redesign the remaining pages to the docs/24 principles (one window, no page scroll, buttons)',
  area: 'client',
  size: 'XL',
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
} satisfies BacklogTicket;
