import { DECK_LIST } from '../../../engine/src/cards/registry.ts';
import { seedPiles } from '../../../ui/deckarrange.ts';
import { cubeDraftHtml, type CubeDraftPageView } from '../../../ui/pages/cubedraft.ts';
import { CHROME, page } from './_page.ts';

/* The cube draft's pick screen (pages/cubedraft.ts, docs/25 §4), from made-up
 * views: what ui/cubedraft.ts hands it mid-draft — a pack with a card chosen,
 * the urgent clock with the suggestion ringed, and the wait between packs. */

const CW = 132, CH = 183;
const PACK = DECK_LIST.slice(40, 53);
const PICKS = DECK_LIST.slice(0, 16);

const view = (over: Partial<CubeDraftPageView> = {}): CubeDraftPageView => {
  const picks = over.picks ?? PICKS;
  return {
    event: "Mycheze's cube", packNo: 2, pickNo: 5, direction: 'right',
    seats: [
      { name: 'Ann', bot: false, waiting: 1, picks: 17, me: false },
      { name: 'Bot 1', bot: true, waiting: 2, picks: 16, me: false },
      { name: 'You', bot: false, waiting: 1, picks: 16, me: true },
      { name: 'Quillon', bot: false, waiting: 0, picks: 17, me: false },
      { name: 'Bot 2', bot: true, waiting: 0, picks: 17, me: false },
      { name: 'Bot 3', bot: true, waiting: 1, picks: 16, me: false },
    ],
    pack: PACK, reserved: PACK[3]!, taken: null, suggest: PACK[0]!, msLeft: 42_000, picks,
    table: {
      cw: CW, ch: CH, newPiles: null, rail: null, scrollKey: 'cd-picks', zoneAttrs: { 'data-cd-zone': 'picks' },
      piles: seedPiles(picks, 'cost').map(p => ({
        zone: `cdpile|${p.id}`, name: p.name, tap: { card: null }, ch: CH, S: 30,
        cards: p.cards.map((name, k) => ({ name, src: `pick|${p.id}|${k}|${name}` })),
      })),
    },
    split: 0.55, chrome: CHROME,
    ...over,
  };
};

export default { title: 'Pages/Cube draft', parameters: { layout: 'fullscreen' } };

export const Pick = { name: 'A pack, one card chosen', render: () => page(cubeDraftHtml(view())) };
export const Urgent = {
  name: 'Ten seconds left, nothing chosen: the suggestion ringed, the clock red',
  render: () => page(cubeDraftHtml(view({ reserved: null, msLeft: 8_000 }))),
};
export const Waiting = { name: 'Waiting for the next pack', render: () => page(cubeDraftHtml(view({ pack: null, reserved: null, msLeft: null }))) };
export const FirstPick = {
  name: 'The first pick: no picks yet',
  render: () => page(cubeDraftHtml(view({ packNo: 1, pickNo: 1, direction: 'left', reserved: null, picks: [], table: { ...view().table, piles: [] } }))),
};
