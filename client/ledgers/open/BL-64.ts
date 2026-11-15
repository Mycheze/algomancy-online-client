import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-64',
  slug: 'ui-shots-stable-comparisons',
  title: 'ui-shots: make two runs of one build compare clean',
  area: 'client',
  size: 'S',
  track: 'qol',
  said:
    'put all the other things into the backlog of todos that we want to take care of (2026-11-03)',
  means:
    'Every stream of the design-system round had to explain away the same false differences: the '
    + 'share links print the server port, so runs on two ports differ in 8 shots (decks__settings, '
    + 'meta__shared-deck, waiting__constructed); a focused search box draws its accent border or not '
    + 'depending on window focus (rules__*, and cards__browse as the first state of a fresh Chrome); '
    + 'cardstats__* and decks__first are not pixel-stable (translucent tiles, art); under load a shot '
    + 'can catch "Loading the document…" (crreview__doc, rules__cr) or time out.',
  doneWhen: [
    'Two full runs of the same build on two different ports compare with zero differences',
  ],
  decided: [
    'The home box does not get a Chrome for this: "No, the box shouldn\'t run chrome like that." (owner, '
      + '2026-11-08, answering the steward\'s BL-64 handoff). What is left is for a session on the dev laptop.',
  ],
  asks: [
    'a session with a browser (the dev laptop) to run the checks below; the steward cannot (no Chrome on the '
      + 'home box, and it is not to get one, see decided). Clear this once someone is at the laptop.',
  ],
  deps: [],
  touches: [
    'client/server/e2e/ui-shots.mjs',
    'client/server/e2e/ui-shots-states.mjs',
    'client/server/e2e/ui-shots-compare.mjs',
    'client/server/e2e/ui-shots-stable.mjs',
  ],
  notes: 'Sources: the ds-pages, ds-base, ds-w2c and ds-w3a records under var/records/. '
    + '2026-11-07 (steward): three of the four causes are fixed in the tool, ui-shots-stable.mjs, guarded by '
    + '1172-ui-shots-stable-runs.test.ts: Chrome browses one fixed origin (http://ui-shots.test, mapped to the '
    + 'server\'s port by --host-resolver-rules; --port-origin puts 127.0.0.1:<port> back), focus is emulated, and '
    + 'a shot waits for every visible "Loading…" line (and for its `check`), a page still loading being a failure. '
    + 'NOT verified in a browser: the home box has no Chrome. Left: (a) a real two-port run to prove doneWhen — if '
    + 'the run stops at once with "did not reach the server", the resolver mapping did not take; (b) the cardstats '
    + 'thumbnails\' ±2 edge jitter (image downscaling), still absorbed by --fuzz 3, not cured; (c) decks__first '
    + 'no longer exists (BL-65 rebuilt the deck screens), so its art jitter needs re-measuring on decks__*.'
    + ' 2026-11-08 (steward): parked for the laptop on the owner\'s answer; `asks` keeps it off the night queue.',
} satisfies BacklogTicket;
