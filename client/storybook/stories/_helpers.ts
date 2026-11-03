/* Layout for the stories themselves — not part of any component. A gallery
 * puts every variant side by side; `frame` keeps a position: fixed component
 * (a toast) inside its story instead of at the foot of the whole page. */

/** the items in a wrapping row */
export const row = (items: string[], gap = 8): string =>
  `<div style="display:flex;gap:${gap}px;flex-wrap:wrap;align-items:center">${items.join('')}</div>`;

/** the items in a column */
export const stack = (items: string[], gap = 12): string =>
  `<div style="display:flex;flex-direction:column;gap:${gap}px;align-items:flex-start">${items.join('')}</div>`;

/** a caption over an example */
export const labelled = (label: string, html: string): string =>
  `<div><div class="zonelabel" style="margin:0 0 4px">${label}</div>${html}</div>`;

/** a box a position: fixed child is laid out in (a transformed ancestor is its containing block) */
export const frame = (html: string, height = 90): string =>
  `<div style="transform:translateZ(0);height:${height}px;border:1px dashed var(--color-border)">${html}</div>`;
