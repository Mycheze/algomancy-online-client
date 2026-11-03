import { ICON_BUTTON_LAYOUTS, type IconButtonProps, iconButton } from '../../ui/components/icon-button.ts';
import { ICON_NAMES } from '../../ui/components/icon.ts';
import { labelled, row, stack } from './_helpers.ts';

/** the stories sit on the bar's colour, as the buttons will */
const bar = (html: string): string => `<div style="background:var(--color-surface);padding:8px 16px;border:1px solid var(--color-border)">${html}</div>`;

export default {
  title: 'Components/Icon button',
  render: (args: IconButtonProps) => bar(iconButton(args)),
  args: { label: 'Decks', icon: 'decks', layout: 'stack', dataBtn: 'demo' },
  argTypes: {
    layout: { control: 'inline-radio', options: ICON_BUTTON_LAYOUTS },
    icon: { control: 'select', options: ICON_NAMES },
    badge: { control: 'text' },
  },
};

export const Stack = {};
export const Inline = { args: { layout: 'inline', label: 'mycheze', icon: 'account' } };
export const WithCount = { name: 'Badge: a count', args: { label: 'Alerts', icon: 'alerts', badge: 3 } };
export const WithManyCount = { name: 'Badge: past 99', args: { label: 'Alerts', icon: 'alerts', badge: 140 } };
export const WithDot = { name: 'Badge: a dot', args: { label: 'Updates', icon: 'updates', badge: 'dot', layout: 'inline' } };
export const On = { args: { label: 'Rules', icon: 'rules', on: true } };
export const Disabled = { args: { label: 'Test', icon: 'test', disabled: true } };
export const AsLink = { name: 'As a link (href)', args: { label: 'Buy the game', icon: 'link', layout: 'inline', href: '#' } };
/** the sketch's top bar, left and right */
export const ToolbarRow = {
  name: 'A toolbar row',
  render: () => bar(stack([
    labelled('stack', row([
      iconButton({ label: 'Decks', icon: 'decks' }), iconButton({ label: 'Cards', icon: 'cards' }),
      iconButton({ label: 'Test', icon: 'test' }), iconButton({ label: 'Rules', icon: 'rules', on: true }),
      iconButton({ label: 'Alerts', icon: 'alerts', badge: 2 }), iconButton({ label: 'Report', icon: 'report' }),
      iconButton({ label: 'Admin', icon: 'admin', disabled: true }),
    ], 4)),
    labelled('inline', row([
      iconButton({ label: 'mycheze', icon: 'account', layout: 'inline' }),
      iconButton({ label: 'Update log', icon: 'updates', layout: 'inline', badge: 'dot' }),
      iconButton({ label: 'Sign in', icon: 'signin', layout: 'inline' }),
    ], 4)),
  ])),
};
