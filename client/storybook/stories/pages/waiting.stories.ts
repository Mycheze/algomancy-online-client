import {
  constructedWaitingHtml, singleWaitingHtml, type ConstructedWaitingView, type SingleWaitingView,
} from '../../../ui/pages/waiting.ts';
import { connectingHtml } from '../../../ui/pages/connecting.ts';
import { deckPickerHtml, type DeckPickerView } from '../../../ui/pages/deckpicker.ts';
import { singleCardPickerHtml } from '../../../ui/pages/singlecard.ts';
import { DECKS, FRIENDS, LINK, page, CHROME } from './_page.ts';

const PICKER: DeckPickerView = { current: DECKS[0]!, signedIn: true, mine: DECKS, defaults: null, msg: '' };

function cview(over: Partial<ConstructedWaitingView> = {}): ConstructedWaitingView {
  return {
    room: 'QXZZ', link: LINK, league: false, friends: FRIENDS,
    mineIn: false, oppIn: false, oppHere: false, myName: 'Ann', oppName: 'Bo',
    deck: DECKS[0]!, deckPicker: PICKER, error: '',
    chrome: CHROME,
    ...over,
  };
}
function sview(over: Partial<SingleWaitingView> = {}): SingleWaitingView {
  return {
    room: 'QXZZ', link: LINK, friends: FRIENDS, drawn: null,
    mineIn: false, oppIn: false, oppHere: true, myName: 'Ann', oppName: 'Bo', card: 'Ignis Sprite',
    picker: singleCardPickerHtml({ card: 'Ignis Sprite', art: '', makesUnits: true, copies: 30, draft: '', suggestions: '', deckCount: 528 }),
    error: '',
    chrome: CHROME,
    ...over,
  };
}

export default {
  title: 'Pages/Waiting rooms',
  parameters: { layout: 'fullscreen' },
};

export const ConstructedAlone = { name: 'Constructed: waiting for the opponent', render: () => page(constructedWaitingHtml(cview())) };
export const ConstructedBothIn = {
  name: 'Constructed: both decks in',
  render: () => page(constructedWaitingHtml(cview({ mineIn: true, oppIn: true, oppHere: true }))),
};
export const LeagueMatch = {
  name: 'Constructed league match',
  render: () => page(constructedWaitingHtml(cview({ league: true, friends: '' }))),
};
export const ConstructedError = {
  name: 'Constructed: a refused deck',
  render: () => page(constructedWaitingHtml(cview({ error: 'that deck is not legal: 27 cards' }))),
};
export const SingleCardDuel = { name: 'Single Card Duel', render: () => page(singleWaitingHtml(sview())) };
export const SingleCardDraw = {
  name: 'Single Card Duel: a draw before it starts',
  render: () => page(singleWaitingHtml(sview({ drawn: { mine: 'Overwhelm', theirs: 'Torrential' } }))),
};

/* the two small screens on the way into a room */
export const Connecting = { render: () => page(connectingHtml({ error: '' })) };
export const LoadingReplay = { name: 'Connecting: loading a replay', render: () => page(connectingHtml({ error: '', waiting: 'Loading the replay…' })) };
export const RefusedJoin = { name: 'Connecting: a refused join', render: () => page(connectingHtml({ error: 'There is no game with the code QXZZ.' })) };

/* the deck picker on its own, in each of its states */
const pickerBox = (v: DeckPickerView): string => `<div class="homecard deckpicker" style="max-width:360px">${deckPickerHtml(v)}</div>`;
export const DeckPickerLoading = { name: 'Deck picker: loading', render: () => pickerBox({ current: null, signedIn: false, mine: [], defaults: null, msg: '' }) };
export const DeckPickerSignedOut = {
  name: 'Deck picker: signed out (bundled decks, import)',
  render: () => pickerBox({ current: null, signedIn: false, mine: [], defaults: DECKS, msg: '' }),
};
export const DeckPickerCollection = { name: 'Deck picker: your collection', render: () => pickerBox(PICKER) };
export const DeckPickerMessage = {
  name: 'Deck picker: an import problem',
  render: () => pickerBox({ current: null, signedIn: false, mine: [], defaults: DECKS, msg: 'not playable: 27 cards · Overwhelm ×3' }),
};
