import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-78',
  slug: 'spell-token-ride-picker',
  title: 'Bringing spell tokens into a battle: a proper picker with "Bring all" and "Bring none"',
  area: 'client',
  size: 'S',
  track: 'qol',
  said:
    'We should improve the "Do you want to bring spell tokens with you into this battle?" UI. Rather than just being '
    + 'a small, boring list that you click, we should make it a modal of some kind that brings up all the spell '
    + 'tokens you control in a nice interface where you just click all the ones you want to bring with you, as well '
    + 'as buttons that clearly say "Bring all" or "Bring none" (owner, report #406, room XUKH, 2026-11-15)',
  means:
    'After Attack! the prompt bar asks the ride-along question (ui/main.ts, the battle `declare` step with '
    + '`ui.confirmRide`, report [69]): "Select the spell tokens you wish to bring into the attacked region, or select '
    + 'Bring none.", the ridable tokens (ui/battle.ts ridableTokens) as small chips in the bar, then Go back, Bring '
    + 'none and "Attack — n tokens riding". Replace it with a dialog over the table showing every ridable spell token '
    + 'as a card tile you click to pick, with Bring all, Bring none and the confirm. A new dialog in the attack flow, '
    + 'so it ships as `stage` for the owner to try.',
  doneWhen: [
    'After Attack!, a player with spell tokens that may ride gets a dialog of them as tiles, with Bring all and Bring none buttons beside the confirm',
    'Esc and Go back still return to the attack being built, and the keyboard shortcuts still work',
  ],
  decided: [],
  asks: [],
  deps: [],
  touches: [
    'client/ui/main.ts',
    'client/ui/battle.ts',
  ],
} satisfies BacklogTicket;
