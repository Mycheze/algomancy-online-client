/* Back link — the way off a page, back to where the player came from.
 *
 * The census counts seven wordings on the non-game pages (§8k and the
 * inventory's Part 2). The dominant one is the account-style header's last
 * action: a green `<button class="primary">Return to Lobby</button>` (Profile,
 * Cards, Decks), so that is the default. The League and Challenge pages use a
 * plain "Back" (`variant: 'secondary'`); the queue and the tabletop put an
 * arrow in front ("← home", `arrow: true`).
 *
 * It is a ui-button underneath; `dataBtn` is required because a back link
 * nobody routes is a dead button. */
import { type ButtonSize, button } from './button.ts';
import { type Common, classes, esc } from './_shared.ts';

export const BACK_LINK_VARIANTS = ['primary', 'secondary', 'link'] as const;
export type BackLinkVariant = typeof BACK_LINK_VARIANTS[number];

export interface BackLinkProps extends Common {
  dataBtn: string;
  label?: string;
  variant?: BackLinkVariant;
  /** put "← " in front of the label */
  arrow?: boolean;
  size?: ButtonSize;
  title?: string;
}

export function backLink(p: BackLinkProps): string {
  const label = esc(p.label ?? 'Return to Lobby');
  return button({
    ...p,
    className: classes('ui-back-link', p.className),
    variant: p.variant ?? 'primary',
    label: undefined,
    labelHtml: p.arrow ? `<span class="ui-back-link__arrow" aria-hidden="true">←</span> ${label}` : label,
  });
}
