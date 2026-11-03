/* Toggle — a button that stays pressed: a filter, a sort key, a view switch.
 *
 * Today's look is the `.on` rule written out 28 times (census §8a): accent
 * border and accent text. Four of the copies also go bold (`.helptab.on`,
 * `.accttab.on`, `.cbchip.on`, `.chtabs button.on`); `strong` is those.
 *
 * The pressed state is the class `on`, not a BEM modifier, on purpose: the
 * tests and the ui-driver read `.on` out of rendered markup in ~18 files, so a
 * page that swaps this in keeps them passing. It is also `aria-pressed`. */
import { type Common, rootAttrs, textOrHtml } from './_shared.ts';
import { type ButtonSize, buttonClasses } from './button.ts';

export interface ToggleProps extends Common {
  label?: string;
  labelHtml?: string;
  on: boolean;
  /** bold when on, as the tab-like copies are */
  strong?: boolean;
  size?: ButtonSize;
  title?: string;
  disabled?: boolean;
}

export function toggle(p: ToggleProps): string {
  const own = `${buttonClasses('secondary', p.size)} ui-toggle${p.strong ? ' ui-toggle--strong' : ''}${p.on ? ' on' : ''}`;
  return `<button${rootAttrs(own, p, {
    type: 'button', 'aria-pressed': p.on ? 'true' : 'false', title: p.title, disabled: p.disabled,
  })}>${textOrHtml(p.label, p.labelHtml)}</button>`;
}
