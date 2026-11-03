import { singleCardPickerHtml, type SingleCardPickerView } from '../../../ui/pages/singlecard.ts';

const NONE: SingleCardPickerView = { card: null, art: '', makesUnits: true, copies: 30, draft: '', suggestions: '', deckCount: 528 };

export default {
  title: 'Pages/Single Card Duel picker',
  render: (v: SingleCardPickerView) => `<div class="homecard" style="max-width:360px">${singleCardPickerHtml(v)}</div>`,
  args: NONE,
};

export const NothingPicked = {};
export const Picked = { args: { ...NONE, card: 'Ignis Sprite' } };
export const MakesNoUnits = { name: 'A card that makes no units', args: { ...NONE, card: 'Overwhelm', makesUnits: false } };
export const Typing = {
  args: {
    ...NONE, draft: 'ign',
    suggestions: '<button data-btn="sc-pick" data-name="Ignis Sprite">Ignis Sprite</button><button data-btn="sc-pick" data-name="Ignite">Ignite</button>',
  },
};
