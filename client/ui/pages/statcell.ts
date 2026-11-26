/* ONE NUMBER IN A STAT GRID: the value over its label, inside a `.statgrid`.
 * Every page that draws one draws it here, so the cell's markup, its escaping
 * and its hover are written once (styles/pages/17-accounts.css styles it).
 */
import { esc } from '../util.ts';

export interface StatCellOpts {
  /** the hover: what the number counts, when the label alone does not say */
  title?: string;
  /** an extra class on the value, for a value that is a word, not a number */
  valueClass?: string;
}

export const statCell = (label: string, value: string | number, o: StatCellOpts = {}): string =>
  `<div class="statcell"${o.title ? ` title="${esc(o.title)}"` : ''}><div class="statval${
    o.valueClass ? ` ${esc(o.valueClass)}` : ''}">${esc(String(value))}</div><div class="statlab">${esc(label)}</div></div>`;
