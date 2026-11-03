/* What every component shares: escaping, the pass-through props, and the
 * attribute string they turn into.
 *
 * Not a component (no story, no stylesheet): the leading `_` is what tells
 * ui/test/940's guard to pass over it. README.md beside this file is the
 * contract the components follow. */
import { esc } from '../util.ts';

export { esc };

/** an attribute value: `true` writes the bare attribute, `false`/`null`/`undefined` leave it out */
export type AttrValue = string | number | boolean | null | undefined;
export type Attrs = Record<string, AttrValue>;

/**
 * The props every component passes through to its root element (for a field,
 * to its control). `dataBtn` is the main.ts click delegator's name for the
 * element, and it is written exactly as given: a page that adopts a component
 * keeps every data-btn it had. `className` is added after the component's own
 * classes; `attrs` is any other attribute (`data-tab`, `title`, `aria-*`, …),
 * escaped.
 */
export interface Common {
  dataBtn?: string;
  className?: string;
  attrs?: Attrs;
}

const ATTR_NAME = /^[A-Za-z_:][\w:.-]*$/;

/** the class list: falsy entries dropped, each name once, in order */
export function classes(...names: Array<string | false | null | undefined>): string {
  const out: string[] = [];
  for (const n of names) {
    if (!n) continue;
    for (const one of n.split(/\s+/)) if (one && !out.includes(one)) out.push(one);
  }
  return out.join(' ');
}

/**
 * `attrs` as markup: ` name="value"` each, with a leading space, values
 * escaped. A name that is not a plain attribute name throws: the names are
 * code, never data, so a bad one is a bug to see, not text to escape.
 */
export function attrsHtml(attrs: Attrs = {}): string {
  let out = '';
  for (const [name, value] of Object.entries(attrs)) {
    if (!ATTR_NAME.test(name)) throw new Error(`components: ${JSON.stringify(name)} is not an attribute name`);
    if (value === false || value === null || value === undefined) continue;
    out += value === true ? ` ${name}` : ` ${name}="${esc(value)}"`;
  }
  return out;
}

/**
 * The root element's attributes: `class` (the component's own, then
 * `p.className`, then any `class` in `p.attrs`), `data-btn`, then the rest of
 * `p.attrs` and the component's `extra`. A `data-btn` given both ways is the
 * prop's.
 */
export function rootAttrs(own: string, p: Common, extra: Attrs = {}): string {
  const { class: attrClass, 'data-btn': attrBtn, ...rest } = p.attrs ?? {};
  const cls = classes(own, p.className, typeof attrClass === 'string' ? attrClass : null);
  return attrsHtml({ class: cls, 'data-btn': p.dataBtn ?? attrBtn, ...extra, ...rest });
}

/** text escaped, or the trusted markup given as `html` when there is some */
export function textOrHtml(text: unknown, html?: string): string {
  return html !== undefined ? html : text === undefined || text === null ? '' : esc(text);
}
