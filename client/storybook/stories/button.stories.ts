import { BUTTON_SIZES, BUTTON_VARIANTS, type ButtonProps, button } from '../../ui/components/button.ts';
import { labelled, row, stack } from './_helpers.ts';

export default {
  title: 'Components/Button',
  render: (args: ButtonProps) => button(args),
  args: { label: 'Return to Lobby', dataBtn: 'demo', variant: 'secondary', size: 'md', disabled: false },
  argTypes: {
    variant: { control: 'select', options: BUTTON_VARIANTS },
    size: { control: 'inline-radio', options: BUTTON_SIZES },
  },
};

export const Secondary = { args: { variant: 'secondary', label: 'Log out' } };
export const Primary = { name: 'Primary (green confirm)', args: { variant: 'primary', label: 'Confirm' } };
export const Action = { name: 'Action (gold page action)', args: { variant: 'action', label: '⚔ Play a game' } };
export const Ghost = { args: { variant: 'ghost', label: 'No block' } };
export const Danger = { args: { variant: 'danger', label: 'Delete deck' } };
export const Link = { args: { variant: 'link', label: 'class:all' } };
export const Icon = { args: { variant: 'icon', label: '↻', title: 'reload from the server' } };
export const Small = { args: { size: 'sm', label: 'Sign in' } };
export const Disabled = { args: { disabled: true, label: 'Save' } };
export const AsALink = { name: 'As an <a href>', args: { href: '#', label: 'Open the rules' } };

export const AllVariants = {
  render: () => stack(BUTTON_SIZES.map(size => labelled(size, row(BUTTON_VARIANTS.map(variant =>
    button({ variant, size, label: variant === 'icon' ? '✕' : variant, title: variant === 'icon' ? 'close' : undefined })))))),
};
