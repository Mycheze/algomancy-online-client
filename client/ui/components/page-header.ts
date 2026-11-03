/* Page header — the title row at the top of a page.
 *
 * Today's dominant one is the account-style `.accthead`, which nine pages use
 * (census §8k): a 26px title with a muted line under it on the left, the
 * page's buttons pushed to the right, a hairline beneath. The back link, when
 * there is one, is the LAST of the buttons, where those pages put "Return to
 * Lobby".
 *
 * `titleHtml` is trusted markup appended inside the <h1> after the escaped
 * title (the profile puts its element and badge chips there); `subtitleHtml`
 * and `actionsHtml` likewise. */
import { type BackLinkProps, backLink } from './back-link.ts';
import { type Common, esc, rootAttrs } from './_shared.ts';

export interface PageHeaderProps extends Common {
  title: string;
  titleHtml?: string;
  subtitle?: string;
  subtitleHtml?: string;
  /** trusted markup: the page's buttons, before the back link */
  actionsHtml?: string;
  back?: BackLinkProps;
}

export function pageHeader(p: PageHeaderProps): string {
  const sub = p.subtitleHtml ?? (p.subtitle ? esc(p.subtitle) : '');
  const actions = (p.actionsHtml ?? '') + (p.back ? backLink(p.back) : '');
  return `<header${rootAttrs('ui-page-header', p)}>`
    + `<div class="ui-page-header__titles"><h1 class="ui-page-header__title">${esc(p.title)}${p.titleHtml ? ' ' + p.titleHtml : ''}</h1>`
    + (sub ? `<div class="ui-page-header__subtitle">${sub}</div>` : '')
    + '</div>'
    + (actions ? `<div class="ui-page-header__actions">${actions}</div>` : '')
    + '</header>';
}
