/* Tabs — a row of buttons, one of them the current view.
 *
 * Eight implementations today (census §8f), all ordinary buttons with an
 * `.on` class. The dominant look: the base button, and the current tab in
 * accent with bold text (`.helptab.on`, `.accttab.on`, `.chtabs button.on`).
 * `caps` is the profile's `.accttabs` (uppercase, 11px, letter-spaced).
 *
 * The current tab carries the class `on` (tests and the ui-driver read it,
 * see toggle.ts) and `aria-selected="true"`; the row is a tablist. Each tab
 * gets `data-tab="<id>"`, and the row's `dataBtn` unless the tab names its
 * own — the usual page routes every tab through one data-btn and reads
 * data-tab. A `count` is the muted number after the label (`.acctcount`). */
import { type Attrs, type Common, attrsHtml, classes, esc, rootAttrs, textOrHtml } from './_shared.ts';
import { buttonClasses } from './button.ts';

export const TABS_VARIANTS = ['plain', 'caps'] as const;
export type TabsVariant = typeof TABS_VARIANTS[number];

export interface TabItem {
  id: string;
  label?: string;
  labelHtml?: string;
  count?: string | number;
  /** this tab's own data-btn, instead of the row's */
  dataBtn?: string;
  title?: string;
  /** extra classes on this tab's button, after the component's (a page's own tab class) */
  className?: string;
  attrs?: Attrs;
}

export interface TabsProps extends Common {
  items: TabItem[];
  /** the id of the current tab */
  active: string;
  variant?: TabsVariant;
  /** the tablist's accessible name */
  label?: string;
}

export function tabs(p: TabsProps): string {
  const variant = p.variant ?? 'plain';
  const buttons = p.items.map(t => {
    const on = t.id === p.active;
    const count = t.count === undefined ? '' : ` <span class="ui-tabs__count">${esc(t.count)}</span>`;
    return `<button${attrsHtml({
      class: classes(buttonClasses('secondary'), 'ui-tabs__tab', on && 'on', t.className),
      'data-btn': t.dataBtn ?? p.dataBtn, 'data-tab': t.id,
      type: 'button', role: 'tab', 'aria-selected': on ? 'true' : 'false', title: t.title,
      ...t.attrs,
    })}>${textOrHtml(t.label ?? t.id, t.labelHtml)}${count}</button>`;
  }).join('');
  return `<div${rootAttrs(`ui-tabs ui-tabs--${variant}`, { className: p.className, attrs: p.attrs }, {
    role: 'tablist', 'aria-label': p.label,
  })}>${buttons}</div>`;
}
