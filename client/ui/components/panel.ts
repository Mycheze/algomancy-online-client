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
 * `titleHtml` is trusted markup after the escaped title (a space between when
 * both are given): a title that carries a tag or a dim date (the league's
 * season, a past week's leaderboard). Alone, it is the whole title.
 *
 * `panelSubheading()` is the panel's second level, `.acctcard h4`'s recipe:
 * a small muted capitals line over a group inside the panel (a week's name
 * over its table, "Your best").
 *
 * `bodyHtml` is trusted markup — usually other components. */
import { type Common, esc, rootAttrs, textOrHtml } from './_shared.ts';

export const PANEL_VARIANTS = ['default', 'inset', 'emphasis'] as const;
export type PanelVariant = typeof PANEL_VARIANTS[number];

export interface PanelProps extends Common {
  title?: string;
  /** trusted markup after the escaped title (or the whole title when there is no `title`) */
  titleHtml?: string;
  /** trusted markup after the title */
  bodyHtml?: string;
  variant?: PanelVariant;
  roomy?: boolean;
  wide?: boolean;
  /** the element: a <section> when it has a title, a <div> otherwise, unless said */
  tag?: 'section' | 'div' | 'aside' | 'article';
}

export function panel(p: PanelProps): string {
  const titled = !!(p.title || p.titleHtml);
  const tag = p.tag ?? (titled ? 'section' : 'div');
  const own = `ui-panel ui-panel--${p.variant ?? 'default'}${p.roomy ? ' ui-panel--roomy' : ''}${p.wide ? ' ui-panel--wide' : ''}`;
  const titleInner = [p.title ? esc(p.title) : '', p.titleHtml ?? ''].filter(Boolean).join(' ');
  const title = titled ? `<h3 class="ui-panel__title">${titleInner}</h3>` : '';
  return `<${tag}${rootAttrs(own, p)}>${title}${p.bodyHtml ?? ''}</${tag}>`;
}

export interface PanelSubheadingProps extends Common {
  text?: string;
  /** trusted markup instead of `text` */
  textHtml?: string;
}

/** a heading inside a panel, under its title: `<h4 class="ui-panel__subheading">` */
export function panelSubheading(p: PanelSubheadingProps): string {
  return `<h4${rootAttrs('ui-panel__subheading', p)}>${textOrHtml(p.text, p.textHtml)}</h4>`;
}
