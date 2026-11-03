import { type ToggleProps, toggle } from '../../ui/components/toggle.ts';
import { row } from './_helpers.ts';

export default {
  title: 'Components/Toggle',
  render: (args: ToggleProps) => toggle(args),
  args: { label: 'Constructed', on: false, strong: false, dataBtn: 'demo' },
  argTypes: { size: { control: 'inline-radio', options: ['md', 'sm'] } },
};

export const Off = { args: { on: false } };
export const On = { args: { on: true } };
export const OnStrong = { name: 'On, strong', args: { on: true, strong: true } };
export const Small = { args: { on: true, size: 'sm' } };
export const AFilterRow = {
  render: () => row(['All', 'Draft', 'Constructed', 'Single card'].map((label, i) => toggle({ label, on: i === 2, dataBtn: 'demo' })), 6),
};
