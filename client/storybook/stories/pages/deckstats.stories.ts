/* A deck's stats (ui/pages/deckstats.ts, BL-65): the strip under the builder's
 * table, the full stats panel (the Stats sheet and the shared deck page), and a
 * sample opening hand. Drawn from real decks of the real pool. The strip's
 * layout is the builder's CSS (52-builder.css); until that lands it shows its
 * parts unstyled. */
import '../../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../../engine/src/cards/registry.ts';
import { analyzeDeck, cardFacts } from '../../../ui/deckstats.ts';
import { sampleOpeningHand } from '../../../engine/src/challenge.ts';
import { deckStatsHtml, sampleHandHtml, statsStripHtml } from '../../../ui/pages/deckstats.ts';
import { page } from './_page.ts';

const el = (e: string) => DECK_LIST.filter(n => cardFacts(n)?.factions.includes(e));
/** a two-element deck: fire with a metal splash, an X card */
const DECK = [...el('fire').slice(0, 13).flatMap(n => [n, n]), ...el('metal').slice(0, 3), DECK_LIST.find(n => cardFacts(n)?.isX)!];
const A = analyzeDeck(DECK);

export default {
  title: 'Pages/Deck stats',
  render: () => page(`<div style="padding:16px">${statsStripHtml(A)}</div>`),
};

export const Strip = { name: 'Stats strip' };
export const StripEmpty = { name: 'Stats strip, empty deck', render: () => page(`<div style="padding:16px">${statsStripHtml(analyzeDeck([]))}</div>`) };
export const Panel = { name: 'Full stats', render: () => page(`<div class="deckbody" style="padding:16px">${deckStatsHtml(A)}</div>`) };
export const SampleHandButton = { name: 'Sample hand: not dealt', render: () => page(`<div style="padding:16px">${sampleHandHtml(null)}</div>`) };
export const SampleHand = { name: 'Sample hand: dealt', render: () => page(`<div style="padding:16px">${sampleHandHtml(sampleOpeningHand(DECK, 7))}</div>`) };
