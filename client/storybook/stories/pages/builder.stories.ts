import { DECK_LIST } from '../../../engine/src/cards/registry.ts';
import { builderHtml, type BuilderView } from '../../../ui/pages/builder.ts';
import { poolHtml, type PoolView } from '../../../ui/pages/pool.ts';
import { seedPiles } from '../../../ui/deckarrange.ts';
import type { TableView } from '../../../ui/pages/table.ts';
import { CHROME, page } from './_page.ts';

/* The builder (pages/builder.ts) and its pool (pages/pool.ts), from made-up
 * views: what ui/tabletop.ts hands them for a constructed deck. */

const CW = 132, CH = 183;
const MAIN = Array.from({ length: 27 }, (_, i) => DECK_LIST[i % 14]!);
const SIDE = DECK_LIST.slice(20, 22);
const MAYBE = DECK_LIST.slice(30, 33);
const POOLN = DECK_LIST.slice(0, 40);

const pool = (over: Partial<PoolView> = {}): PoolView => ({
  query: '', active: false, total: 483, cap: 2, target: 'deck', targets: ['deck', 'side', 'maybe'], scrollKey: 'tt-pool|',
  chips: [
    ...['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'].map(el => ({ group: 'el' as const, value: el, label: el, on: el === 'fire' })),
    ...['0', '1', '2', '3', '4', '5', '6', '7', '8', 'X'].map(m => ({ group: 'mana' as const, value: m, label: m, on: false })),
    { group: 'kind', value: 'unit', label: 'Unit', on: false }, { group: 'kind', value: 'spell', label: 'Spell', on: false },
  ],
  tiles: POOLN.map(name => {
    const inDeck = MAIN.filter(n => n === name).length, inSide = SIDE.filter(n => n === name).length;
    return { name, inDeck, inSide, atCap: inDeck + inSide >= 2, over: inDeck + inSide > 2 };
  }),
  ...over,
});
const table = (over: Partial<TableView> = {}): TableView => ({
  cw: CW, ch: CH, newPiles: { emptyText: 'Tap a card above to add it, or drag it here.' },
  piles: seedPiles(MAIN, 'cost').map(p => ({
    zone: `pile|${p.id}`, name: p.name, rename: p.id, head: p.id, ch: CH, S: 30,
    cards: p.cards.map((name, k) => ({ name, src: `pile|${p.id}|${k}|${name}` })),
  })),
  rail: {
    side: { zone: 'side', name: 'Sideboard', cls: 'ttsidepile', limit: 7, slot: true, ch: CH, S: 30, cards: SIDE.map((name, k) => ({ name, src: `side|${k}|${name}` })) },
    maybe: { zone: 'maybe', name: 'Maybe', cls: 'ttmaybepile', ch: CH, S: 30, cards: MAYBE.map((name, k) => ({ name, src: `maybe|${k}|${name}` })) },
  },
  ...over,
});
const view = (over: Partial<BuilderView> = {}): BuilderView => ({
  title: 'Ember Rush', titleBtn: 'deck-settings', backLabel: 'Decks',
  pill: { text: '27 / 30', tone: 'warn', problems: ['3 cards short of 30'] }, stripHtml: '',
  hostToolsHtml: '', canUndo: true, canRedo: false, stats: true, note: null,
  pool: pool(), split: 0.4, head: { label: 'Main deck', count: MAIN.length, tools: true },
  table: table(), statsStripHtml: '', sheet: null, hostSheetHtml: '', readOnly: false, chrome: CHROME,
  ...over,
});

export default { title: 'Pages/Builder', parameters: { layout: 'fullscreen' } };

export const Builder = { name: 'The builder: pool, divider, table, rail', render: () => page(builderHtml(view())) };
export const Legal = { name: 'A legal deck (the pill is not a button)', render: () => page(builderHtml(view({ pill: { text: '30 cards · legal', tone: 'ok', problems: [] } }))) };
export const Refused = { name: 'A refusal in the note row', render: () => page(builderHtml(view({ note: `Max 2 of ${MAIN[0]}.` }))) };
export const Menu = {
  name: 'The card menu open',
  render: () => page(builderHtml(view({ table: table({ holding: true, menu: { title: MAIN[0]!, for: 'x', items: [
    { btn: 'tt-cut', label: 'Remove one' }, { btn: 'tt-more', label: 'Add another' }, { btn: 'tt-toside', label: 'To sideboard' },
    { btn: 'tt-tomaybe', label: 'To Maybe' }, { btn: 'tt-move', label: 'Move…' }, { btn: 'tt-similar', label: 'Find similar' }, { btn: 'tt-details', label: 'Details' },
  ] } }) }))).replace('class="ttpop"', 'class="ttpop" style="left:420px;top:460px"'),
};
export const WhatsWrong = {
  name: 'What’s wrong (a side sheet)',
  render: () => page(builderHtml(view({ sheet: { kind: 'problems', title: 'What’s wrong', width: 'sm', bodyHtml: '<ul class="ttproblems"><li>3 cards short of 30</li></ul>' } }))),
};
export const NoPool = { name: 'A host with no pool', render: () => page(builderHtml(view({ pool: null }))) };
export const PoolAlone = {
  name: 'The pool band alone (filtered, Add to Side)',
  render: () => `<div class="ttpage" style="height:360px;display:flex;flex-direction:column">${poolHtml(pool({ query: 'el:fire', active: true, total: 141, target: 'side' }))}</div>`,
};
