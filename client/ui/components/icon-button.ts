/* Icon button — a toolbar button: a big icon over a small caption.
 *
 * The redesign's top bar (client/docs/24-redesign/: Decks, Cards, Test, Rules,
 * Alerts, Report) and its bottom bar. Calm on purpose: no box, no border, the
 * muted text colour; hover lifts it to the text colour on a raised wash, and
 * `on` (the page you are on, a panel that is open) paints it gold. The keyboard
 * focus ring is base.css's.
 *
 *   layout 'stack'   the icon over the caption (the default; the top bar)
 *   layout 'inline'  the icon left of the caption (the account slot, the bottom bar)
 *
 * At least 48px tall either way (--icon-button-min-h), so it is a finger's
 * target on an iPad.
 *
 * `badge`: a number draws a small gold pill on the icon's top-right corner (99+
 * past 99); `'dot'` (or `true`) a plain dot; 0, false or undefined draws
 * nothing. `on` is the class `on` (as on every pressed thing in the client:
 * tests read `.on`) plus `aria-pressed` on a <button> or `aria-current="page"`
 * on a link; leave it undefined for a button that is never pressed.
 *
 * `iconHtml` replaces the icon with trusted markup (an avatar image, say). */
import { type Common, esc, rootAttrs } from './_shared.ts';
import { type IconName, icon } from './icon.ts';

export const ICON_BUTTON_LAYOUTS = ['stack', 'inline'] as const;
export type IconButtonLayout = typeof ICON_BUTTON_LAYOUTS[number];

export interface IconButtonProps extends Common {
  /** the caption under (or beside) the icon, escaped. Also the accessible name */
  label: string;
  icon?: IconName;
  /** trusted markup in place of `icon` */
  iconHtml?: string;
  layout?: IconButtonLayout;
  /** a count (0 hides it), or 'dot' / true for a dot */
  badge?: number | 'dot' | boolean;
  /** pressed / current; undefined for a button that has no such state */
  on?: boolean;
  disabled?: boolean;
  title?: string;
  /** render an <a href> instead of a <button> */
  href?: string;
}

/** the badge's markup, or '' when there is nothing to show */
export function iconButtonBadge(badge: IconButtonProps['badge']): string {
  if (badge === undefined || badge === false || badge === 0) return '';
  if (badge === true || badge === 'dot') return '<span class="ui-icon-button__badge ui-icon-button__badge--dot"></span>';
  if (typeof badge !== 'number' || !Number.isFinite(badge) || badge < 0) return '';
  return `<span class="ui-icon-button__badge">${badge > 99 ? '99+' : esc(Math.floor(badge))}</span>`;
}

export function iconButton(p: IconButtonProps): string {
  const layout = p.layout ?? 'stack';
  const own = `ui-icon-button ui-icon-button--${layout}${p.on ? ' on' : ''}`;
  const glyph = p.iconHtml ?? (p.icon ? icon(p.icon) : '');
  const inner = `<span class="ui-icon-button__icon">${glyph}${iconButtonBadge(p.badge)}</span>`
    + `<span class="ui-icon-button__label">${esc(p.label)}</span>`;
  if (p.href !== undefined) {
    return `<a${rootAttrs(own, p, {
      href: p.href, title: p.title, 'aria-current': p.on ? 'page' : undefined, 'aria-disabled': p.disabled ? 'true' : undefined,
    })}>${inner}</a>`;
  }
  return `<button${rootAttrs(own, p, {
    type: 'button', title: p.title, 'aria-pressed': p.on === undefined ? undefined : p.on ? 'true' : 'false', disabled: p.disabled,
  })}>${inner}</button>`;
}
