import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-66',
  slug: 'pages-redesign-ux-pass',
  title: 'The redesigned pages: the owner\'s UX changes',
  area: 'client',
  size: 'M',
  track: 'qol',
  said:
    'Everything I want to change is minor and specifically about changing UX (but we\'ll do that later) (2026-11-04)',
  means:
    'After clicking through the pages redesign on the dev server, the owner has small UX changes to make '
    + 'to the redesigned pages. They are not listed yet: ask for them when this is picked up.',
  doneWhen: [
    'Every change on the owner\'s list is made and he has seen it',
  ],
  decided: [],
  asks: ['the list of UX changes'],
  deps: [],
  touches: [
    'client/ui/pages/frame.ts',
    'client/ui/styles/pages/49-frame.css',
  ],
} satisfies BacklogTicket;
