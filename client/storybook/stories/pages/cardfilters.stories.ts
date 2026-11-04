/* The card filters (ui/pages/cardfilters.ts): the facet rail and the search
 * syntax the Cards page and the builder's pool share (BL-65). Drawn from
 * made-up queries; the chips' state is read off the query string. The same
 * markup under either set of button names: cards-* on the Cards page, tt-* in
 * the builder. */
import '../../../engine/src/cards/registry.ts';
import { CARDS_BTNS, POOL_BTNS, SECTIONS, facets, filterRailHtml, syntaxHelpHtml, type FilterRailView } from '../../../ui/pages/cardfilters.ts';
import { page } from './_page.ts';

const ALL_OPEN = Object.fromEntries(SECTIONS.map(s => [s.id, true]));
const rail = (v: FilterRailView, pool = false): string =>
  page(`<div class="cbpage" style="display:flex;height:720px">${filterRailHtml(v, pool ? POOL_BTNS : CARDS_BTNS)}</div>`);

export default {
  title: 'Pages/Card filters',
  render: (v: FilterRailView) => rail(v),
  args: { facets: facets(false), q: 'el:fire -kind:spell mana:2', railOpen: { element: true, cost: true, kind: true } },
};

/** the Cards page's rail: three sections open, an included and an excluded chip */
export const Rail = {};
/** every section open, while a deck is being built ("This deck" appears) */
export const AllOpenBuilding = { name: 'Every section, building', args: { facets: facets(true), q: 'is:deck sub:sprite', railOpen: ALL_OPEN } };
/** the builder's pool: the same rail under tt-* names */
export const PoolNames = { name: 'Under the pool\'s names (tt-*)', render: (v: FilterRailView) => rail(v, true) };
/** the syntax help, the body of the Cards page's sheet */
export const Syntax = { name: 'Search syntax', render: () => page(`<div class="cbhelp" style="padding:16px;max-width:760px">${syntaxHelpHtml()}</div>`) };
