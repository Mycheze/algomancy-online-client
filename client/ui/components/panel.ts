/* Panel — a box of related content on a page.
 *
 * Today's dominant recipe is the profile's `.acctcard` (50 uses, on the nine
 * account-style pages; census §8c): surface, hairline border, 6px radius,
 * 12px padding, and a small uppercase accent title. The variants are the
 * census's other two families:
 *
 *   default   .acctcard
 *   inset     a panel on a panel: the raised surface (.statcell, .ach, .deckdesc, …)
 *   emphasis  the accent border (.overlaybox's colour; .lgbanner, .chbox, .lessonbox, …)
 *
 * `roomy` is the home page's card instead (.homecard: 8px radius, 16px padding).
 * `wide` spans every column of a grid (.acctcard.wide).
 *
 * `bodyHtml` is trusted markup — usually other components. */
import { type Common, esc, rootAttrs } from './_shared.ts';

export const PANEL_VARIANTS = ['default', 'inset', 'emphasis'] as const;
export type PanelVariant = typeof PANEL_VARIANTS[number];

export interface PanelProps extends Common {
  title?: string;
  /** trusted markup after the title */
  bodyHtml?: string;
  variant?: PanelVariant;
  roomy?: boolean;
  wide?: boolean;
  /** the element: a <section> when it has a title, a <div> otherwise, unless said */
  tag?: 'section' | 'div' | 'aside' | 'article';
}

export function panel(p: PanelProps): string {
  const tag = p.tag ?? (p.title ? 'section' : 'div');
  const own = `ui-panel ui-panel--${p.variant ?? 'default'}${p.roomy ? ' ui-panel--roomy' : ''}${p.wide ? ' ui-panel--wide' : ''}`;
  const title = p.title ? `<h3 class="ui-panel__title">${esc(p.title)}</h3>` : '';
  return `<${tag}${rootAttrs(own, p)}>${title}${p.bodyHtml ?? ''}</${tag}>`;
}
