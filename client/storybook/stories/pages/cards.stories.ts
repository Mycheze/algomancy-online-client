/* The card browser (`?cards`), drawn by pages/cards.ts cardsHtml() from
 * made-up views. The search is the real one over the real card pool, so a
 * story's `q` is any query the page accepts. Nothing here fetches: the
 * published-deck count and the rulings are in the view. */
import '../../../engine/src/cards/registry.ts';
import { search } from '../../../ui/cardsearch.ts';
import { allRows } from '../../../ui/cardindex.ts';
import { CHUNK, cardsHtml, facets, type CardsView } from '../../../ui/pages/cards.ts';

const CARDS = allRows().filter(r => r.cls === 'card' && r.playable);
const PINNED = CARDS[3]!;

function view(q: string, over: Partial<CardsView> = {}): CardsView {
  return {
    q, res: search(q), cardCount: allRows().filter(r => r.cls === 'card').length, deck: null, facets: facets(false),
    railOpen: { element: true, cost: true, kind: true }, hints: [], saved: [], helpOpen: false,
    focus: null, focusRow: null, played: 0, rulings: null, cursor: -1, shown: CHUNK, ...over,
  };
}

const DECK: NonNullable<CardsView['deck']> = {
  name: 'Ember Rush', noMaybe: false,
  copies: Object.fromEntries(CARDS.slice(0, 6).map((r, i) => [r.name, i === 2 ? 3 : 2])),
  summary: {
    total: 13, legal: false, problems: ['17 cards short of 30'],
    curve: [{ mana: 1, total: 2 }, { mana: 2, total: 5 }, { mana: 3, total: 4 }, { mana: 4, total: 2 }],
    elements: { fire: 9, water: 4 },
  },
};

export default {
  title: 'Pages/Cards',
  render: (v: CardsView) => cardsHtml(v),
  args: view(''),
};

export const Browse = {};
export const Search = { args: view('el:fire kind:unit mana<=3') };
export const SearchWithAnError = { name: 'Search with an error and a hint', args: view('deadly foo:1', { hints: [{ word: 'deadly', query: 'attr:deadly', why: '“deadly” is an attribute' }] }) };
export const Nothing = { name: 'Nothing matches', args: view('name:"no such card"') };
export const SyntaxHelp = { name: 'Syntax help', args: view('', { helpOpen: true }) };
export const ListView = { name: 'List view', args: view('view:list mana:2', { cursor: 2 }) };
export const TextView = { name: 'Text view', args: view('view:text el:water') };
export const Pinned = {
  args: view('el:fire', {
    focus: PINNED.name, focusRow: PINNED, played: 4,
    rulings: { name: PINNED.name, lines: ['A made-up ruling about when this resolves.'] },
    saved: [{ name: 'cheap fire', q: 'el:fire mana<=2' }],
  }),
};
export const Deckbuilding = {
  args: view('el:fire', { deck: DECK, facets: facets(true), railOpen: { element: true, building: true } }),
};
export const ChallengeDeck = {
  name: 'Deckbuilding (a challenge: no maybeboard)',
  args: view('el:fire', { deck: { ...DECK, noMaybe: true }, facets: facets(true) }),
};
