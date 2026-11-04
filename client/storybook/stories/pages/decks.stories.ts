import '../../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../../engine/src/cards/registry.ts';
import { cardFacts } from '../../../ui/deckstats.ts';
import {
  decksHtml, decksView, deckInfoHtml, deckInfoView, deckPreviewHtml, deckPreviewView,
  type DeckSource, type DecksState,
} from '../../../ui/pages/decks.ts';
import { CHROME, page } from './_page.ts';

/* The Decks page (ui/pages/decks.ts, BL-65): the shelf of deck boxes, the open deck's preview beside it, and
 * its side sheets; the read-only preview the shared deck uses; the builder's Deck info sheet. Real decks of the
 * real pool, as ui/decks.ts hands them over. */

const el = (e: string): string[] => DECK_LIST.filter(n => /^[A-Za-z ,'-]+$/.test(n) && cardFacts(n)?.factions.includes(e));
const two = (names: string[]): string[] => names.flatMap(n => [n, n]);
const rec = (games: number, wins: number) => ({ games, wins, losses: games - wins, unresolved: 0 });

const FIRE = el('fire'), WATER = el('water'), EARTH = el('earth'), METAL = el('metal'), WOOD = el('wood');
const DECKS: DeckSource[] = [
  { id: 'd1', name: 'Ember Rush', cards: [...two(FIRE.slice(0, 12)), ...two(METAL.slice(0, 3))], sideboard: FIRE.slice(20, 22),
    maybe: METAL.slice(10, 13), cover: FIRE[5]!, visibility: 'public', updatedAt: '2026-11-02T10:00:00Z', author: 'you', record: rec(6, 4),
    description: `A fast deck that wants the game over by turn six. Keep two cheap units in the opening hand and attack every turn. ${FIRE[0]} is the best opener; hold ${FIRE[3]} for the counterattack.` },
  { id: 'd2', name: 'Tidecaller Control', cards: [...two(WATER.slice(0, 13)), ...two(EARTH.slice(0, 2))], cover: WATER[4]!, visibility: 'unlisted',
    updatedAt: '2026-11-01T10:00:00Z', author: 'you', record: rec(4, 1) },
  { id: 'd3', name: 'Grove Keepers', cards: [...two(EARTH.slice(0, 10)), ...two(WOOD.slice(0, 5))], maybe: WOOD.slice(8, 14), cover: EARTH[2]!,
    updatedAt: '2026-10-30T10:00:00Z', author: 'you', record: rec(0, 0) },
  { id: 'd4', name: 'Iron Tide', cards: [...two(METAL.slice(0, 11)), ...WATER.slice(0, 5)], cover: METAL[6]!, updatedAt: '2026-10-29T10:00:00Z',
    author: 'you', record: rec(0, 0) },
  ...['Fire', 'Water', 'Earth', 'Metal'].map((e, i): DeckSource => {
    const pool = [FIRE, WATER, EARTH, METAL][i]!;
    return { id: `b${i}`, name: `Single-Box Battle Deck – ${e}`, cards: pool.slice(0, 30), cover: pool[9]!, updatedAt: `2026-10-0${i + 1}T10:00:00Z`,
      author: 'Caleb', record: rec(0, 0) };
  }),
];

const state = (over: Partial<DecksState> = {}): DecksState => ({
  signedIn: true, loading: false, decks: DECKS, openId: 'd1', sort: 'recent', msg: '', descOpen: false, chosenId: null, sheet: null,
  history: [
    { deckId: 'd1', result: 'win', opponent: 'Rashi', turns: 9, life: [12, 0], playedAt: '2026-11-02T18:00:00Z', code: 'QXZZ' },
    { deckId: 'd1', result: 'loss', opponent: 'Cy', turns: 11, life: [0, 4], playedAt: '2026-11-01T18:00:00Z', code: 'KEMX' },
  ],
  base: 'https://algomancy.online/', exportBody: `Ember Rush\n\n2 ${FIRE[0]}\n2 ${FIRE[1]}\n…`, ...over,
});
const draw = (over: Partial<DecksState> = {}): string => page(decksHtml({ ...decksView(state(over)), chrome: CHROME }));

export default { title: 'Pages/Decks', parameters: { layout: 'fullscreen' } };

export const Shelf = { name: 'The shelf, Ember Rush open', render: () => draw() };
export const NotLegal = { name: 'A deck that is not legal (27 / 30)', render: () => draw({ openId: 'd4' }) };
export const DescriptionOpen = { name: 'The description, read in full', render: () => draw({ descOpen: true }) };
export const ByName = { name: 'Sorted by name, with a note', render: () => draw({ sort: 'name', msg: 'Copied.' }) };
export const Empty = { name: 'No decks', render: () => draw({ decks: [], openId: null }) };
export const Loading = { name: 'Loading', render: () => draw({ decks: null, loading: true, openId: null }) };
export const SignedOut = { name: 'Signed out', render: () => page(decksHtml({ ...decksView(state({ signedIn: false, decks: null })), chrome: { signedIn: false, alerts: 0 } })) };
export const Import = { name: 'Sheet: Import', render: () => draw({ sheet: { kind: 'import', msg: '' } }) };
export const Share = { name: 'Sheet: Share', render: () => draw({ sheet: { kind: 'share' } }) };
export const Export = { name: 'Sheet: Export', render: () => draw({ sheet: { kind: 'export', format: 'text' } }) };
export const Delete = { name: 'Sheet: Delete', render: () => draw({ sheet: { kind: 'delete' } }) };
export const Games = { name: 'Sheet: Games', render: () => draw({ sheet: { kind: 'games' } }) };
export const Card = { name: 'Sheet: a card from the list', render: () => draw({ sheet: { kind: 'card', name: FIRE[0]! } }) };
export const ReadOnly = {
  name: 'The preview, read-only (the shared deck)',
  render: () => page(`<div style="width:400px;height:720px;display:flex;padding:16px">${deckPreviewHtml(
    deckPreviewView({ ...DECKS[0]!, author: 'Caleb', url: 'https://algomancer.cc/d/1' }, { focusBtn: 'meta-focus' }),
    { readOnly: true, actionsHtml: '<div class="dkprevmain"><button class="primary" data-btn="meta-take">Copy to my decks</button></div>' })}</div>`),
};
export const DeckInfo = {
  name: 'The builder\'s Deck info sheet',
  render: () => page(deckInfoHtml(deckInfoView(DECKS[0]!, { editing: false, draft: null, syntax: false, base: 'https://algomancy.online/' }))),
};
export const DeckInfoEditing = {
  name: 'Deck info, writing the description (with the syntax note)',
  render: () => page(deckInfoHtml(deckInfoView(DECKS[0]!, { editing: true, draft: 'A fast deck…', syntax: true, base: 'https://algomancy.online/' }))),
};
