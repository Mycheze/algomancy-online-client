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
 * and `actionsHtml` likewise.
 *
 * `subtitleAs: 'p'` draws the subtitle as a paragraph with a paragraph's
 * margins (12px above and below): the league and the weekly challenge, whose
 * one-sentence subtitle was a `<p class="hint">`. The default is the bare line
 * of `.accthead .hint` (the profile, the card browser). */
import { type BackLinkProps, backLink } from './back-link.ts';
import { type Common, esc, rootAttrs } from './_shared.ts';

export interface PageHeaderProps extends Common {
  title: string;
  titleHtml?: string;
  subtitle?: string;
  subtitleHtml?: string;
  /** 'p': the subtitle is a paragraph, with its margins; default 'div', a bare line */
  subtitleAs?: 'div' | 'p';
  /** trusted markup: the page's buttons, before the back link */
  actionsHtml?: string;
  back?: BackLinkProps;
}

export function pageHeader(p: PageHeaderProps): string {
  const sub = p.subtitleHtml ?? (p.subtitle ? esc(p.subtitle) : '');
  const actions = (p.actionsHtml ?? '') + (p.back ? backLink(p.back) : '');
  return `<header${rootAttrs('ui-page-header', p)}>`
    + `<div class="ui-page-header__titles"><h1 class="ui-page-header__title">${esc(p.title)}${p.titleHtml ? ' ' + p.titleHtml : ''}</h1>`
    + (sub ? (p.subtitleAs === 'p'
      ? `<p class="ui-page-header__subtitle ui-page-header__subtitle--p">${sub}</p>`
      : `<div class="ui-page-header__subtitle">${sub}</div>`) : '')
    + '</div>'
    + (actions ? `<div class="ui-page-header__actions">${actions}</div>` : '')
    + '</header>';
}
