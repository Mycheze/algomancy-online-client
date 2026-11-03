/* Segmented control — one choice out of a few, as a row of joined pills.
 *
 * The redesign's Draft | Constructed switch at the top of the Play card
 * (client/docs/24-redesign/), and the room settings under it: Clock Off / 20m
 * / 40m / 60m, Best of Bo1 / Bo3. A track (sunken, pill-shaped) holding one
 * <button> per option; the chosen one is raised with a gold edge and gold text.
 *
 * Every option is its own button with its OWN `dataBtn` and `attrs`, because
 * the pages already route these choices by name and carry their value in a
 * data attribute (`data-btn="clockpick" data-ms="1200000"`): a page adopting
 * this keeps both. The chosen option has the class `on` (tests and the
 * ui-driver read `.on`) and `aria-pressed="true"`; the others `"false"`. The
 * root is `role="group"`, named by `ariaLabel`.
 *
 * Nothing here decides which option is chosen: the page passes `on`. Two
 * options on at once is the page's bug, and renders as two. */
import { type Attrs, type Common, attrsHtml, classes, esc, rootAttrs } from './_shared.ts';

export const SEGMENTED_SIZES = ['md', 'sm'] as const;
export type SegmentedSize = typeof SEGMENTED_SIZES[number];

export interface SegmentedOption {
  label: string;
  /** what the option stands for; written as `data-value` */
  value: string;
  on: boolean;
  dataBtn?: string;
  attrs?: Attrs;
  className?: string;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedProps extends Common {
  options: SegmentedOption[];
  size?: SegmentedSize;
  /** stretch to the container's width, the options sharing it equally */
  full?: boolean;
  /** the group's accessible name ("Game type", "Clock") */
  ariaLabel?: string;
}

function option(o: SegmentedOption): string {
  const { class: attrClass, 'data-btn': attrBtn, ...rest } = o.attrs ?? {};
  const cls = classes('ui-segmented__option', o.on && 'on', o.className, typeof attrClass === 'string' ? attrClass : null);
  return `<button${attrsHtml({
    class: cls, 'data-btn': o.dataBtn ?? attrBtn, type: 'button', 'data-value': o.value,
    'aria-pressed': o.on ? 'true' : 'false', title: o.title, disabled: o.disabled, ...rest,
  })}>${esc(o.label)}</button>`;
}

export function segmented(p: SegmentedProps): string {
  const own = `ui-segmented${p.size === 'sm' ? ' ui-segmented--sm' : ''}${p.full ? ' ui-segmented--full' : ''}`;
  return `<div${rootAttrs(own, p, { role: 'group', 'aria-label': p.ariaLabel })}>${p.options.map(option).join('')}</div>`;
}
