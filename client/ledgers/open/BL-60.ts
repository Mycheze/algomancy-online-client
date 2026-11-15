import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-60',
  slug: 'popup-sentences-owner-call',
  title: 'Owner\'s call: the board popup sentences kept as candidates to cut',
  area: 'client',
  size: 'S',
  track: 'qol',
  said:
    'All the extra weirdly AI generated, superfluous text was supposed to have been gotten rid of '
    + 'forever ago. (2026-11-03, board-r1 item 7)',
  means:
    'board-r1 cut the clear cases and KEPT these for the owner (all still in the code): the resource '
    + 'window\'s "Dormant: no mana or affinity until activated in planning."; the zoom\'s "token — erased '
    + 'when it leaves play"; the room tip\'s "N watching — they see both hands"; the Single Card Duel '
    + 'game tip "thirty copies of one card each. Rates the cards, not you."; the stack head\'s "— '
    + 'resolves as ONE composed ability"; the burst line "clicking a Fireball casts all 3 at once, as one '
    + 'chain, of different sizes."; the rot pill\'s "Rot never decreases on its own."; the debt pill\'s '
    + 'reminder; the cache\'s "both players see it"; the counterattack strip\'s "they arrive next round '
    + 'and cannot be touched until then"; the toolbar settings\' one-or-two-sentence tooltips; and the '
    + 'stack does-line on a card with no X ("Deal X damage to Gember (currently 3)": Dropslime, Burning '
    + 'Vengeance, Verdant Vengeance, Null Drone), where "no X on a card that has none" needs a wording '
    + 'choice against the 2026-09-30 live-amount wording.',
  doneWhen: [
    'The owner has said keep or cut for each line, and the cut ones are gone',
  ],
  decided: [],
  asks: [
    'Keep or cut, line by line (the table in var/records/board-r1-2026-11-03.md section 7, "Kept, candidates for the owner")',
  ],
  deps: [],
  touches: [
    'client/ui/main.ts',
    'client/ui/ressum.ts',
    'client/ui/cardtext.ts',
    'client/ui/does-lines.json',
  ],
  notes:
    '2026-11-12 (steward tidy): re-checked at HEAD, every sentence on the list is still in the code (ressum.ts rsfoot; '
    + 'cardtext.ts the token state; main.ts the room tip\'s watchers and Single Card Duel lines, the stack head, the '
    + 'burst line, the rot pill title, the cache title, the sent strip\'s title). Related owner call, not this list: '
    + 'report #385 (2026-11-11, aa976c82) cut the VISIBLE "arrives next round" line under the in-transit counterattack '
    + 'strip; that commit kept the strip\'s hover title "sent to counterattack — they arrive next round and cannot be '
    + 'touched until then", which is the line listed here, so it still waits on his keep-or-cut.',
} satisfies BacklogTicket;
