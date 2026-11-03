/* Button — every clickable thing that is not a tab or a toggle.
 *
 * The look is today's base `button` rule (styles/base.css) written out under
 * its own class, so the component does not lean on the element selector, and
 * the variants are the ones the census found (client/docs/23-ui-inventory/
 * 07-design-foundations.md §8a):
 *
 *   secondary  the base button: raised surface, hairline border, accent on hover (the default)
 *   primary    the GREEN confirm — today's `button.primary`, "yes, do it" at the table and on pages
 *   action     the GOLD page action — today's `.homebtns .primary` and its five copies (accent
 *              border and text). Both "primaries" stay until the redesign picks one (docs/23,
 *              Decisions). ⚠ On a <button> today those copies ALSO show the green fill under the
 *              gold, because `button.primary` still applies; this variant is the gold alone, so a
 *              page swapping it in loses that green. That is the census's bug, not this look.
 *   ghost      transparent, dashed, dim — today's `.declinebtn` ("not this one")
 *   danger     red border and text — the pattern written out nine times (`.dkdanger`, …)
 *   link       a button that reads as a link — today's `.linkbtn` (accent, dotted underline)
 *   icon       a glyph button (✕, ↻, ⚙). Looks like secondary; it REQUIRES `title`, which is
 *              also its aria-label, because a glyph alone says nothing to a screen reader
 *
 * `size: 'sm'` is the compact one the account strip and the queue's back
 * button use (4px 8px, 12px). `href` renders an <a> with the same look. */
import { type Common, rootAttrs, textOrHtml } from './_shared.ts';

export const BUTTON_VARIANTS = ['secondary', 'primary', 'action', 'ghost', 'danger', 'link', 'icon'] as const;
export type ButtonVariant = typeof BUTTON_VARIANTS[number];
export const BUTTON_SIZES = ['md', 'sm'] as const;
export type ButtonSize = typeof BUTTON_SIZES[number];

export interface ButtonProps extends Common {
  /** the visible text, escaped */
  label?: string;
  /** trusted markup instead of `label` (an icon image, a count span) */
  labelHtml?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** for a <button>; defaults to "button" so a button in a form never submits by accident */
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  /** the hover text; for `icon` also the accessible name, and required */
  title?: string;
  /** render an <a href> instead of a <button> */
  href?: string;
}

/** the class list a button's root gets — for a component built on a button (toggle, tabs) */
export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  return `ui-button ui-button--${variant}${size === 'sm' ? ' ui-button--sm' : ''}`;
}

export function button(p: ButtonProps): string {
  const variant = p.variant ?? 'secondary';
  if (variant === 'icon' && !p.title) throw new Error('button: an icon button needs a title (its accessible name)');
  const own = buttonClasses(variant, p.size);
  const inner = textOrHtml(p.label, p.labelHtml);
  const common = { title: p.title, 'aria-label': variant === 'icon' ? p.title : undefined };
  if (p.href !== undefined) {
    return `<a${rootAttrs(own, p, { href: p.href, ...common, 'aria-disabled': p.disabled ? 'true' : undefined })}>${inner}</a>`;
  }
  return `<button${rootAttrs(own, p, { type: p.type ?? 'button', ...common, disabled: p.disabled })}>${inner}</button>`;
}
