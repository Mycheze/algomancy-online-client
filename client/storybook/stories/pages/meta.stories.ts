/* The metagame (`?meta`, `?deck=`, `?cardladder`), drawn by pages/meta.ts
 * metaHtml() from made-up views. The card stats tab has its own page
 * (cardstats.stories.ts). */
import '../../../engine/src/cards/registry.ts';
import { allRows } from '../../../ui/cardindex.ts';
import { metaHtml, type MetaView } from '../../../ui/pages/meta.ts';
import type { PublicDeck } from '../../../ui/meta.ts';
import { CHROME } from './_page.ts';

const NAMES = allRows().filter(r => r.cls === 'card' && r.playable).map(r => r.name);

function deck(i: number, over: Partial<PublicDeck> = {}): PublicDeck {
  const pick = NAMES.slice(i * 9, i * 9 + 14);
  return {
    id: `d${i}`, name: ['Ember Rush', 'Tidal Lock', 'Wood Swarm', 'Dark Bargain'][i % 4]!,
    cards: [...pick, ...pick, NAMES[i * 9 + 20]!, NAMES[i * 9 + 21]!], cover: pick[0]!, author: 'Quillon',
    visibility: 'public', owner: { id: `u${i}`, username: ['Quillon', 'Marigold', 'Oberon', 'Juniper'][i % 4]! },
    createdAt: '2026-10-01', updatedAt: '2026-10-20', problems: [],
    record: { games: 6 + i * 3, wins: 4 + i, losses: 2 + i * 2, unresolved: 0, lastPlayed: '2026-11-01' }, copies: i,
    description: i === 0 ? 'Go wide early, then **burn** them out. Mulligan for a two-drop.' : undefined,
    ...over,
  };
}

function view(over: Partial<MetaView> = {}): MetaView {
  return {
    view: 'list', rows: [0, 1, 2, 3].map(i => deck(i)), minGames: 5, one: null, loading: false, msg: '', sort: 'winrate',
    els: [], text: '', focus: null, deckGroup: 'type', statsOpen: false, descOpen: false, exporting: null, backTo: 'list', ladder: null,
    signedIn: true, mine: false, link: 'https://algomancy.online/?deck=d0', exportText: '', stats: null, chrome: CHROME, ...over,
  };
}

const LADDER = {
  rankedAfter: 5, duels: 42,
  cards: NAMES.slice(0, 10).map((card, i) => ({ card, rating: 1620 - i * 17, games: 11 - i, wins: 6, losses: 5 - (i % 4), mirrors: i % 3 ? 0 : 1 })),
};

export default {
  title: 'Pages/Metagame',
  render: (v: MetaView) => metaHtml(v),
  args: view(),
};

export const PublishedDecks = { name: 'Published decks' };
export const Loading = { args: view({ rows: null, loading: true }) };
export const EmptyList = { name: 'Nothing published yet', args: view({ rows: [] }) };
export const Filtered = { name: 'Filtered to nothing', args: view({ els: ['metal'], text: 'zzz' }) };
export const LoadError = { name: 'Load error', args: view({ rows: null, msg: 'could not reach the server' }) };
export const SharedDeck = { name: 'Shared deck', args: view({ view: 'deck', one: deck(0) }) };
export const SharedDeckYours = { name: 'Shared deck (yours, unlisted)', args: view({ view: 'deck', one: deck(1, { visibility: 'unlisted' }), mine: true }) };
export const SharedDeckOpen = {
  name: 'Shared deck (stats, export, a pinned card)',
  args: view({ view: 'deck', one: deck(2), statsOpen: true, exporting: 'text', exportText: '2 Some Card\n2 Another Card', focus: NAMES[18]!, deckGroup: 'cost' }),
};
export const DeckNotFound = { name: 'Shared deck not found', args: view({ view: 'deck', msg: 'That deck is not shared, or the link is wrong.' }) };
export const CardLadder = { name: 'Card duel ladder', args: view({ view: 'ladder', ladder: LADDER }) };
export const CardLadderEmpty = { name: 'Card duel ladder (no duels)', args: view({ view: 'ladder', ladder: { cards: [], rankedAfter: 5, duels: 0 } }) };
