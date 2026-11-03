/* Chip — a small label on something: a tag, a status, a badge.
 *
 * About twenty implementations today (census §8d). The dominant shape is the
 * small uppercase TAG (`.constag`, `.lgtag`): 11px, hairline border, 4px
 * radius, muted. `shape: 'pill'` is the rounded one (`.badgechip`,
 * `.replaychip`). `tone` replaces the five private good/warn/bad vocabularies
 * with the status tokens; `solid` fills the chip with its tone
 * (`.badgechip.owner`).
 *
 * Given a `title`, the chip shows the help cursor, as `.constag` does: the
 * title is the explanation the chip abbreviates. */
import { type Common, rootAttrs, textOrHtml } from './_shared.ts';

export const CHIP_TONES = ['neutral', 'accent', 'success', 'warning', 'danger', 'info'] as const;
export type ChipTone = typeof CHIP_TONES[number];
export const CHIP_SHAPES = ['tag', 'pill'] as const;
export type ChipShape = typeof CHIP_SHAPES[number];

export interface ChipProps extends Common {
  label?: string;
  labelHtml?: string;
  tone?: ChipTone;
  shape?: ChipShape;
  solid?: boolean;
  title?: string;
}

export function chip(p: ChipProps): string {
  const own = `ui-chip ui-chip--${p.tone ?? 'neutral'} ui-chip--${p.shape ?? 'tag'}${p.solid ? ' ui-chip--solid' : ''}`;
  return `<span${rootAttrs(own, p, { title: p.title })}>${textOrHtml(p.label, p.labelHtml)}</span>`;
}
