import { updatesHtml, UPDATES, type Update } from '../../../ui/updates.ts';

/* The Recent updates band under the home menu (ui/updates.ts updatesHtml,
 * which is already `(list, seen) => string`). The live list is the real one. */
const MADE_UP: Update[] = [
  { date: '2026-11-03', kind: 'fix', text: 'The Challenge button no longer drops onto a row of its own on a wide window.' },
  { date: '2026-11-03', kind: 'change', text: 'A made-up second line on the same day: its date is left blank.' },
  { date: '2026-11-01', kind: 'new', text: 'A made-up older line.' },
];

export default {
  title: 'Pages/Recent updates',
};

export const Live = { name: 'The live list, two new since the last visit', render: () => updatesHtml(UPDATES, UPDATES.length - 2) };
export const FirstVisit = { name: 'A first visit (nothing marked)', render: () => updatesHtml(MADE_UP, null) };
export const AllNew = { name: 'Everything new', render: () => updatesHtml(MADE_UP, 0) };
