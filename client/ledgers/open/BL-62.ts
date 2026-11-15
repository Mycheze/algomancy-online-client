import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-62',
  slug: 'home-owner-calls',
  title: 'Owner to decide: what the new home left out of the sketch',
  area: 'client',
  size: 'S',
  track: 'qol',
  said:
    'Looking really solid… great v1! (2026-11-03, on the new home). Flagged for him by its record: '
    + '"No logo on home (the bottom bar names the client)." "Clock chips are Default/Off/45m/60m, not '
    + 'the sketch\'s 20m/40m (271 pins them)."',
  means:
    'Decisions, not bugs. (1) No ALGOMANCY logo on home: the toolbar is the header and the bottom bar '
    + 'names the client. (2) The sketch\'s 20m/40m clock chips were not adopted; the presets are Off / 45m '
    + '/ 60m (pages/clockpick.ts CLOCK_PRESETS, test 271). (3) The Draft tab has empty space between its '
    + 'rows and its buttons at 1440x900, because the card keeps one height across tabs so nothing jumps. '
    + '(4) The Challenge card has no Play button of its own: the whole card opens the challenge page.',
  doneWhen: [
    'The owner has answered each of the four, and any change he asks for is built',
  ],
  decided: [],
  asks: [
    'A logo on home or not?',
    'Clock presets: keep Off/45m/60m, or the sketch\'s 20m/40m?',
    'Is the Draft tab\'s empty space at 1440x900 fine, and is a whole-card Challenge button enough?',
  ],
  deps: [],
  touches: [
    'client/ui/pages/home.ts',
    'client/ui/pages/clockpick.ts',
    'client/ui/test/271-clock-picker-and-warning.test.ts',
  ],
  notes: 'Source: var/records/ds-round-2026-11-03-home-page.md "Flagged for the owner".',
} satisfies BacklogTicket;
