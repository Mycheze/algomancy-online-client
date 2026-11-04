import { DECK_LIST } from '../../../engine/src/cards/registry.ts';
import { tableHtml, type TableView } from '../../../ui/pages/table.ts';
import { seedPiles } from '../../../ui/deckarrange.ts';
import type { PileView } from '../../../ui/piletable.ts';
import { page } from './_page.ts';

/* The table (pages/table.ts): the pile row, the rail and the card menu, the
 * way the builder and the Competitive sideboarding table both draw it. */

const CW = 108, CH = 150;
const MAIN = Array.from({ length: 30 }, (_, i) => DECK_LIST[i % 15]!);
const SIDE = DECK_LIST.slice(20, 22);
const MAYBE = DECK_LIST.slice(30, 33);

const piles = (tap?: PileView['tap']): PileView[] => seedPiles(MAIN, 'cost').map(p => ({
  zone: `pile|${p.id}`, name: p.name, rename: tap ? undefined : p.id, head: tap ? undefined : p.id, ch: CH, S: 30,
  cards: p.cards.map((name, k) => ({ name, src: `pile|${p.id}|${k}|${name}` })), ...(tap ? { tap } : {}),
}));
const rail = (side: string[]): TableView['rail'] => ({
  side: { zone: 'side', name: 'Sideboard', cls: 'ttsidepile', limit: 7, slot: true, ch: CH, S: 30,
    cards: side.map((name, k) => ({ name, src: `side|${k}|${name}` })) },
  maybe: { zone: 'maybe', name: 'Maybe', cls: 'ttmaybepile', ch: CH, S: 30,
    cards: MAYBE.map((name, k) => ({ name, src: `maybe|${k}|${name}` })) },
});
const frame = (html: string): string => page(`<div class="ttpage" style="height:640px;display:flex;flex-direction:column">${html}</div>`);

export default { title: 'Pages/Table', parameters: { layout: 'fullscreen' } };

export const Builder = {
  name: 'The builder’s table: piles, the sideboard, Maybe',
  render: () => frame(tableHtml({ cw: CW, ch: CH, piles: piles(), newPiles: { emptyText: 'Tap a card in the pool to add it.' }, rail: rail(SIDE) })),
};
export const EmptySideboard = {
  name: 'An empty sideboard keeps its slot',
  render: () => frame(tableHtml({ cw: CW, ch: CH, piles: piles(), newPiles: { emptyText: '' }, rail: rail([]) })),
};
export const Empty = {
  name: 'An empty deck',
  render: () => frame(tableHtml({ cw: CW, ch: CH, piles: [], newPiles: { emptyText: 'Tap a card in the pool to add it.' }, rail: rail([]) })),
};
export const Menu = {
  name: 'The card menu (placed beside the card by the paint)',
  render: () => frame(tableHtml({
    cw: CW, ch: CH, piles: piles(), newPiles: { emptyText: '' }, rail: rail(SIDE), holding: true,
    menu: { title: MAIN[0]!, for: `pile|x|0|${MAIN[0]}`, items: [
      { btn: 'tt-cut', label: 'Remove one' }, { btn: 'tt-more', label: 'Add another' }, { btn: 'tt-toside', label: 'To sideboard' },
      { btn: 'tt-tomaybe', label: 'To Maybe' }, { btn: 'tt-move', label: 'Move…' }, { btn: 'tt-similar', label: 'Find similar' },
      { btn: 'tt-details', label: 'Details' },
    ] },
  })).replace('class="ttpop"', 'class="ttpop" style="left:300px;top:200px"'),
};
export const Competitive = {
  name: 'Another host’s taps (the Competitive table: no new piles)',
  render: () => frame(tableHtml({
    cw: CW, ch: CH, piles: piles({ card: 'cc-move', from: 'main' }), newPiles: null,
    zoneAttrs: { 'data-cc-zone': 'main' }, rail: { side: rail(SIDE)!.side, sideAttrs: { 'data-cc-zone': 'side' } },
  })),
};
