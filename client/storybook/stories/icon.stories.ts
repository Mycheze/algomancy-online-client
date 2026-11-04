import { ICON_NAMES, type IconName, type IconProps, icon } from '../../ui/components/icon.ts';
import { row } from './_helpers.ts';

type Args = IconProps & { name: IconName };

export default {
  title: 'Components/Icon',
  render: ({ name, ...args }: Args) => `<span style="color:var(--color-text)">${icon(name, args)}</span>`,
  args: { name: 'decks', size: 48 },
  argTypes: { name: { control: 'select', options: ICON_NAMES }, size: { control: 'number' } },
};

export const One = {};
/** every icon with its name, at the toolbar's 24px and at 48px to check the drawing */
export const AllIcons = {
  name: 'All icons',
  render: () => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:16px 8px;color:var(--color-text)">${
    ICON_NAMES.map(n => `<div style="display:flex;flex-direction:column;align-items:center;gap:6px">${icon(n, { size: 48 })}`
      + `${icon(n, { size: 24 })}<code style="font-size:var(--text-12);color:var(--color-text-muted)">${n}</code></div>`).join('')}</div>`,
};
/** 1em by default: the icon follows the text's size and colour */
export const InText = {
  name: 'In text (1em, currentColor)',
  render: () => `<p style="font-size:var(--text-16);color:var(--color-accent);margin:0">${icon('league')} League week 3 · `
    + `<span style="color:var(--color-danger)">${icon('alerts')} 2 alerts</span></p>`,
};
export const WithTitle = { name: 'Named (role="img")', args: { name: 'info', title: 'About this client' } };
export const Row24 = { name: 'Row at 24px', render: () => `<div style="color:var(--color-text-muted)">${row(ICON_NAMES.map(n => icon(n, { size: 24 })), 14)}</div>` };
/** the deck screens' tools (BL-65): the builder's toolbar and the Decks page's preview actions, as they sit together */
const DECK_TOOLS: IconName[] = ['undo', 'redo', 'edit', 'filter', 'plus', 'import', 'export', 'share', 'copy', 'trash'];
export const DeckTools = { name: 'Deck screens\' tools', render: () => `<div style="color:var(--color-text)">${row(DECK_TOOLS.map(n => icon(n, { size: 24 })), 14)}</div>` };
