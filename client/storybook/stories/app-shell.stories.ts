import { type AppShellProps, appShell, shellBar } from '../../ui/components/app-shell.ts';
import { button } from '../../ui/components/button.ts';
import { iconButton } from '../../ui/components/icon-button.ts';
import { panel } from '../../ui/components/panel.ts';
import { segmented } from '../../ui/components/segmented.ts';
import { frame } from './_helpers.ts';

const TOP = shellBar({
  startHtml: iconButton({ label: 'Decks', icon: 'decks' }) + iconButton({ label: 'Cards', icon: 'cards' }),
  centerHtml: iconButton({ label: 'mycheze', icon: 'account', layout: 'inline' }),
  endHtml: iconButton({ label: 'Test', icon: 'test' }) + iconButton({ label: 'Rules', icon: 'rules' })
    + iconButton({ label: 'Alerts', icon: 'alerts', badge: 2 }) + iconButton({ label: 'Report', icon: 'report' }),
});
const BOTTOM = shellBar({
  startHtml: iconButton({ label: 'Algomancy Online (Unofficial Client)', icon: 'info', layout: 'inline' }),
  endHtml: iconButton({ label: 'Update log', icon: 'updates', layout: 'inline', badge: 'dot' }),
});
const PLAY = panel({
  title: 'Play',
  bodyHtml: `<div style="display:flex;flex-direction:column;gap:12px">${segmented({
    full: true, ariaLabel: 'Game type',
    options: [{ label: 'Draft', value: 'draft', on: false }, { label: 'Constructed', value: 'constructed', on: true }],
  })}${segmented({ size: 'sm', ariaLabel: 'Clock', options: ['Off', '20m', '40m', '60m'].map((l, i) => ({ label: l, value: l, on: i === 0 })) })}`
    + `<div style="display:flex;gap:8px;justify-content:flex-end">${button({ label: 'Join a room' })}${button({ label: 'Create room', variant: 'action' })}</div></div>`,
});
const SIDE = ['League', 'Challenge', 'Matchmaking'].map(t => panel({ title: t, bodyHtml: '<p class="hint" style="margin:0">At a glance.</p>' })).join('');
const MAIN = `<div style="display:grid;grid-template-columns:3fr 2fr;gap:16px">${PLAY}<div style="display:flex;flex-direction:column;gap:16px">${SIDE}</div></div>`;

export default {
  title: 'Components/App shell',
  // the shell is 100dvh; in a story it fills a fixed frame instead
  render: (args: AppShellProps) => frame(appShell({ ...args, attrs: { style: 'height:100%' } }), 560),
  args: { topHtml: TOP, mainHtml: MAIN, bottomHtml: BOTTOM },
};

/** the home sketch in miniature */
export const HomeSketch = { name: 'Home, in miniature' };
/** the main region scrolls inside itself; the bars stay put */
export const MainScrolls = {
  name: 'Main scrolls, bars stay',
  args: { mainHtml: Array.from({ length: 30 }, (_, i) => `<p style="margin:0 0 8px">Row ${i + 1}</p>`).join('') },
};
export const NoBottomBar = { name: 'No bottom bar', args: { bottomHtml: undefined } };
/** the bar alone: start | centre | end, the centre truly centred */
export const Bar = {
  render: () => `<div style="background:var(--color-surface);border:1px solid var(--color-border)">${shellBar({
    startHtml: iconButton({ label: 'Decks', icon: 'decks' }),
    centerHtml: iconButton({ label: 'mycheze', icon: 'account', layout: 'inline' }),
    endHtml: iconButton({ label: 'Test', icon: 'test' }) + iconButton({ label: 'Rules', icon: 'rules' }) + iconButton({ label: 'Report', icon: 'report' }),
  })}</div>`,
};
