import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-53',
  slug: 'competitive-swap-presets',
  title: 'Competitive: saved sideboard swaps — plan the UX before building it again',
  area: 'client',
  size: 'L',
  track: 'feature',
  said:
    'That can come later, but the UX is terrible for it and we should plan it better. (2026-11-03, '
    + 'on the saved "standardized swaps" presets being taken out; the 2026-11-02 ask was saved named '
    + 'presets that exchange a specific set of cards in one click)',
  means:
    'A PLANNING item, not a rebuild. The presets shipped with Competitive Constructed on 2026-11-02 '
    + 'and were removed whole on 2026-11-03 (engine matchdeck.ts, the deck store, the match wire, the '
    + 'deck page\'s Swaps section; record var/records/ds-round-2026-11-03-r2-C.md section 2). Manual '
    + 'sideboarding on the deck table and "Back to the registered deck" stay. Design where a preset is '
    + 'made and where it is applied (the deck page? the sideboarding table?) and show the owner before '
    + 'writing code.',
  doneWhen: [
    'A written design (screens and the one-tap flow) is shown to the owner and he approves it',
    'Only then: a player can save a named swap on a deck and apply it between games in one tap; the opponent never sees it',
  ],
  decided: [
    'Removed 2026-11-03; old decks that still carry `swaps` load and lose the field at their next write (812 section 2).',
  ],
  asks: [
    'Where should a swap be made and applied, and what should it look like? (the owner: "we should plan it better")',
  ],
  deps: [],
  touches: [
    'client/ui/pages/match.ts',
    'client/ui/decks.ts',
    'client/engine/src/matchdeck.ts',
    'client/docs/22-competitive-constructed.md',
  ],
} satisfies BacklogTicket;
