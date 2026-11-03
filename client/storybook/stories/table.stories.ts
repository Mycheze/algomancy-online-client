import { chip } from '../../ui/components/chip.ts';
import { type TableProps, table } from '../../ui/components/table.ts';

const COLUMNS = [
  { key: 'when', label: 'When' }, { key: 'opp', label: 'Opponent' }, { key: 'mode', label: 'Mode' },
  { key: 'turns', label: 'Turns', align: 'right' as const }, { key: 'res', label: 'Result' },
];
const ROWS = [
  { cells: { when: '2 Nov', opp: 'Nyar', mode: 'Draft', turns: 11, res: 'Win' } },
  { cells: { when: '1 Nov', opp: 'Karanda', mode: 'Constructed', turns: 7, res: { html: `Loss ${chip({ label: 'early', tone: 'accent', title: 'conceded before turn 3' })}` } } },
  { cells: { when: '30 Oct', opp: 'Tomzy', mode: 'Draft', turns: 14, res: 'Win' } },
];

export default {
  title: 'Components/Table',
  render: (args: TableProps) => `<div style="max-width:640px">${table(args)}</div>`,
  args: { columns: COLUMNS, rows: ROWS },
};

export const Default = {};
export const WithCaption = { args: { caption: 'Your last three games' } };
export const Empty = { args: { rows: [], emptyText: 'No games yet. Play one from the home screen.' } };
export const Scrolling = { name: 'Scrolling (narrow)', render: (args: TableProps) => `<div style="max-width:260px">${table({ ...args, scroll: true })}</div>` };
