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
export const Headless = {
  name: 'Headless (the league\'s lists)',
  args: { headless: true, columns: [{ key: 'pair', label: '' }, { key: 'res', label: '' }, { key: 'when', label: '', className: 'dim' }],
    rows: [{ cells: { pair: 'Nyar vs Tomzy', res: 'Nyar won', when: 'Mon 3 Nov' } }, { cells: { pair: 'Karanda vs Ann', res: 'not played', when: '–' } }] },
};
export const HeaderTooltips = {
  name: 'Header tooltips and a marked column',
  args: {
    columns: [{ key: 'rank', label: '#' }, { key: 'player', label: 'player' },
      { key: 'turns', label: 'Turns', title: 'The turn you met the goal on, plus any turns paying off debt.', headClassName: 'chsorted' },
      { key: 'omw', label: 'OMW', title: "opponents' match-win percentage — the tiebreak" }],
    rows: [{ cells: { rank: 1, player: 'Ann', turns: { html: '<b>4</b>' }, omw: '62%' } }, { cells: { rank: 2, player: 'Bob', turns: { html: '<b>5</b>' }, omw: '48%' } }],
  },
};
