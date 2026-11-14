import { DECK_LIST } from '../../../engine/src/cards/registry.ts';
import { cubeDraftHtml, type CubeDraftPageView } from '../../../ui/pages/cubedraft.ts';
import { draftTable } from '../../../ui/test/cubedraft-fixture.ts';
import { CHROME, page } from './_page.ts';

/* The cube draft's pick screen (pages/cubedraft.ts, docs/25 §4, §13), from made-up
 * views: what ui/cubedraft.ts hands the builder mid-draft — the pack in the band (a card
 * chosen; the urgent clock with the suggestion ringed; the wait between packs) and the
 * deck table under it, the builder's own: the picks in piles by cost, the Sideboard, Maybe. */

const PACK = DECK_LIST.slice(40, 53);
const PICKS = DECK_LIST.slice(0, 13);
const SIDE = DECK_LIST.slice(13, 15);
const MAYBE = DECK_LIST.slice(15, 16);

const view = (over: Partial<CubeDraftPageView> = {}): CubeDraftPageView => ({
  event: "Mycheze's cube", packNo: 2, pickNo: 5, direction: 'right',
  seats: [
    { name: 'Ann', bot: false, waiting: 1, picks: 17, me: false },
    { name: 'Bot 1', bot: true, waiting: 2, picks: 16, me: false },
    { name: 'You', bot: false, waiting: 1, picks: 16, me: true },
    { name: 'Quillon', bot: false, waiting: 0, picks: 17, me: false },
    { name: 'Bot 2', bot: true, waiting: 0, picks: 17, me: false },
    { name: 'Bot 3', bot: true, waiting: 1, picks: 16, me: false },
  ],
  pack: PACK, reserved: PACK[3]!, taken: null, suggest: PACK[0]!, msLeft: 42_000,
  split: 0.55, pw: 132,
  ...over,
});
const table = (picks = PICKS, side = SIDE, maybe = MAYBE) => ({ ...draftTable(picks, side, maybe), chrome: CHROME });

export default { title: 'Pages/Cube draft', parameters: { layout: 'fullscreen' } };

export const Pick = { name: 'A pack, one card chosen; the picks on the deck table', render: () => page(cubeDraftHtml(view(), table())) };
export const Urgent = {
  name: 'Ten seconds left, nothing chosen: the suggestion ringed, the clock red',
  render: () => page(cubeDraftHtml(view({ reserved: null, msLeft: 8_000 }), table())),
};
export const Waiting = { name: 'Waiting for the next pack', render: () => page(cubeDraftHtml(view({ pack: null, reserved: null, msLeft: null }), table())) };
export const FirstPick = {
  name: 'The first pick: an empty table',
  render: () => page(cubeDraftHtml(view({ packNo: 1, pickNo: 1, direction: 'left', reserved: null }), table([], [], []))),
};
