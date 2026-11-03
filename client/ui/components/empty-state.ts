/* Empty state — what a list says when there is nothing in it.
 *
 * Today most are a bare `.hint` line ("no decks loaded"), which prints at
 * full text colour where the hint has no rule (inventory, Part 2). The one
 * designed empty state is the deck page's `.deckdesc.empty`: a dashed box with
 * the muted sentence and the button that fills it, in a row. That is the
 * default; `bare` is just the muted line, with no box.
 *
 * `actionHtml` is trusted markup: usually a button(). */
import { type Common, esc, rootAttrs } from './_shared.ts';

export interface EmptyStateProps extends Common {
  text: string;
  title?: string;
  actionHtml?: string;
  bare?: boolean;
}

export function emptyState(p: EmptyStateProps): string {
  const title = p.title ? `<strong class="ui-empty-state__title">${esc(p.title)}</strong>` : '';
  return `<div${rootAttrs(`ui-empty-state${p.bare ? ' ui-empty-state--bare' : ''}`, p)}>${title}`
    + `<span class="ui-empty-state__text">${esc(p.text)}</span>${p.actionHtml ?? ''}</div>`;
}
