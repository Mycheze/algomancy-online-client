/* Table — rows of data under a header.
 *
 * Today's dominant one is the profile's `.accttable` (16 uses: the profile,
 * the league, the deck syntax help; census §8g): 12px text, small uppercase
 * muted headers over a solid hairline, dotted lines between rows.
 *
 * A cell is text (escaped), a number, null (empty), or `{ html }` — trusted
 * markup, for a cell holding a chip or a button. A column's `align: 'right'`
 * is a numeric column: right-aligned, tabular figures. `scroll` wraps the
 * table in a box that scrolls sideways on a narrow screen instead of pushing
 * the page wider (the census's 8-column history table on a phone).
 *
 * `emptyText` is the one row shown when there are no rows.
 *
 * `headless` leaves the header row out: a list of rows whose meaning the
 * panel's title already gives (most of the league's tables). A column's
 * `title` is a tooltip on its header (the league's OMW, the challenge's
 * Turns), and its `headClassName` a class on the header cell alone. */
import { type Attrs, type Common, attrsHtml, classes, esc, rootAttrs } from './_shared.ts';

export type TableCell = string | number | null | undefined | { html: string };

export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  /** on the column's header cell and every cell under it */
  className?: string;
  /** on the header cell only */
  headClassName?: string;
  /** a tooltip on the header cell */
  title?: string;
}

export interface TableRow {
  cells: Record<string, TableCell>;
  className?: string;
  attrs?: Attrs;
}

export interface TableProps extends Common {
  columns: TableColumn[];
  rows: TableRow[];
  caption?: string;
  emptyText?: string;
  scroll?: boolean;
  /** no header row */
  headless?: boolean;
}

function cellHtml(c: TableCell): string {
  if (c === null || c === undefined) return '';
  return typeof c === 'object' ? c.html : esc(c);
}

const alignClass = (a: TableColumn['align']): string | undefined =>
  a === 'right' ? 'ui-table__num' : a === 'center' ? 'ui-table__center' : undefined;

export function table(p: TableProps): string {
  const head = p.columns.map(c =>
    `<th${attrsHtml({ class: classes(alignClass(c.align), c.className, c.headClassName) || undefined, scope: 'col', title: c.title })}>${esc(c.label)}</th>`).join('');
  const body = p.rows.length === 0 && p.emptyText !== undefined
    ? `<tr><td class="ui-table__empty" colspan="${p.columns.length}">${esc(p.emptyText)}</td></tr>`
    : p.rows.map(r => `<tr${attrsHtml({ class: r.className, ...r.attrs })}>${p.columns.map(c =>
      `<td${attrsHtml({ class: classes(alignClass(c.align), c.className) || undefined })}>${cellHtml(r.cells[c.key])}</td>`,
    ).join('')}</tr>`).join('');
  const caption = p.caption ? `<caption class="ui-table__caption">${esc(p.caption)}</caption>` : '';
  const thead = p.headless ? '' : `<thead><tr>${head}</tr></thead>`;
  const t = `<table${rootAttrs('ui-table', p)}>${caption}${thead}<tbody>${body}</tbody></table>`;
  return p.scroll ? `<div class="ui-table-scroll">${t}</div>` : t;
}
