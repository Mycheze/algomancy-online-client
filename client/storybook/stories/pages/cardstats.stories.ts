/* Card stats (`?cardstats`), drawn by pages/cardstats.ts cardStatsHtml() from
 * made-up numbers. The metagame's tab row comes in as a slot. */
import '../../../engine/src/cards/registry.ts';
import { allRows } from '../../../ui/cardindex.ts';
import { cardStatsHtml, type CardStatsView } from '../../../ui/pages/cardstats.ts';
import { metaTabsHtml } from '../../../ui/pages/meta.ts';
import type { CsCard, CsResult } from '../../../ui/cardstats.ts';
import { CHROME } from './_page.ts';

const NAMES = allRows().filter(r => r.cls === 'card' && r.playable).map(r => r.name);
const wr = (n: number, w: number) => ({ n, w });

function card(name: string, i: number): CsCard {
  const g = 3 + ((i * 7) % 19);
  return {
    card: name, games: g, gih: wr(g - 1, Math.round((g - 1) * (0.3 + ((i * 13) % 40) / 100))), oh: wr(Math.ceil(g / 3), i % 3),
    drawn: wr(Math.ceil(g / 2), (i * 5) % Math.ceil(g / 2 + 1)), played: wr(g - 2, Math.round((g - 2) * 0.55)), gns: wr(i % 5, i % 2),
    copiesSeen: g + 2, timesPlayed: g - 1, recycled: i % 4, bottomed: i % 3, gihPlayed: g - 3, recycledFull: i % 4, bottomedFull: i % 2,
    firstTurnSum: g * 3, firstTurnN: g - 2, turnHist: [0, i % 2, 2, 3, 1, 0, 1], offered: i % 3 ? g : 0, picked: Math.floor(g / 2),
    pickPosSum: i % 4, given: i % 6 ? 0 : 1, deck: i % 2 ? wr(4, 2) : wr(0, 0), deckCopies: i % 2 ? 7 : 0,
  };
}

const DATA: CsResult = {
  ok: true, games: 48, seatGames: 96, coverage: { open: 90, draws: 88, plays: 96, picks: 40, init: 96 },
  sources: { live: 70, 'replay-sigs': 18, refs: 6, none: 2 }, firstPlayed: '2026-09-02T18:00Z', lastPlayed: '2026-11-02T21:00Z',
  cards: NAMES.slice(0, 40).map(card),
  elements: ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'].map((el, i) => ({ el, seat: wr(20 + i, 9 + i * 2), picked: 30 - i * 3, played: 25 - i * 2 })),
  pairs: { fire: wr(8, 5), 'fire+water': wr(12, 5), 'earth+wood': wr(9, 6), 'light+metal': wr(6, 2), dark: wr(4, 3) },
  trios: { 'fire+water+earth': 6, 'wood+metal+light': 4, 'dark+fire+wood': 2 },
  onPlay: wr(48, 27), turns: { 5: 2, 6: 7, 7: 12, 8: 14, 9: 8, 10: 3, 12: 2 }, constructedSeatGames: 40, floor: 5,
};

function view(over: Partial<CardStatsView> = {}): CardStatsView {
  return {
    data: DATA, loading: false, msg: '', msgTone: 'error', mode: 'all', range: 'all', rated: false, bothSigned: false, mine: false,
    section: 'cards', sortKey: 'games', sortDir: -1, text: '', els: [], kind: 'all', minGames: 1, focus: null,
    signedIn: true, tabs: metaTabsHtml('stats'), chrome: CHROME, ...over,
  };
}

export default {
  title: 'Pages/Card stats',
  render: (v: CardStatsView) => cardStatsHtml(v),
  args: view(),
};

export const Cards = {};
export const CardsFiltered = { name: 'Cards (filtered, sorted by GIH)', args: view({ els: ['fire'], kind: 'unit', minGames: 5, sortKey: 'gih', rated: true }) };
export const Draft = { name: 'Cards (draft columns)', args: view({ mode: 'draft' }) };
export const Constructed = { name: 'Cards (constructed columns)', args: view({ mode: 'constructed', range: '30' }) };
export const PinnedCard = { name: 'A card pinned', args: view({ focus: NAMES[4]! }) };
export const Elements = { args: view({ section: 'elements' }) };
export const Highlights = { args: view({ section: 'highlights', minGames: 3 }) };
export const Games = { args: view({ section: 'game' }) };
export const Loading = { args: view({ data: null, loading: true }) };
export const NotEnoughGames = {
  name: 'Not enough games',
  args: view({ data: null, mode: 'draft', range: '7', msgTone: 'note', msg: 'Only 2 games match these filters. Card stats need at least 5, so nobody\'s hand from one game is on show — widen the filters.' }),
};
