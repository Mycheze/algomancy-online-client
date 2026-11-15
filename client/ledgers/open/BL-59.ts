import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-59',
  slug: 'ipad-one-height-bar-review',
  title: 'iPad: look at the side effects of the one-height action bar',
  area: 'client',
  size: 'S',
  track: 'qol',
  said:
    'One height for the action bar (owner, mid-round in board-r1, 2026-11-03). Its record: "Worth '
    + 'showing the owner."',
  means:
    'For the OWNER to look at on a real iPad, not a fix to start. The action bar is now always two '
    + 'rows tall (87px under touch), so the board never jumps. The cost on touch: battle and table '
    + 'cards are a little smaller than under a one-row prompt (a battle ghost slot went from 100px to '
    + '87px wide); and a card-scan decision (trigger order, glimpse "cache one", Scholar of the Void) '
    + 'stands up out of the bar over the bottom of your info line while it is up. Also for him to try '
    + 'on the iPad: Storybook from the installed web app (whether `window.open(\'\')` gives a usable '
    + 'window; ds-sb record).',
  doneWhen: [
    'The owner has played a game on the iPad with the bar and said keep it, or what to change',
  ],
  decided: [
    'This reverses the 2026-09-26 call ("fits its content"); 324 section 5 now pins the constant height.',
  ],
  asks: [
    'Are the smaller touch cards and the covered info line acceptable for a bar that never jumps?',
  ],
  deps: [],
  touches: [
    'client/ui/styles/board/39-regions.css',
    'client/ui/test/324-info-block-resources.test.ts',
  ],
  notes: 'Measurements: var/records/board-r1-2026-11-03.md section 3b.',
} satisfies BacklogTicket;
