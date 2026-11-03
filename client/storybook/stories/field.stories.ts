import { type FieldProps, field } from '../../ui/components/field.ts';
import { stack } from './_helpers.ts';

export default {
  title: 'Components/Field',
  render: (args: FieldProps) => `<div style="max-width:320px">${field(args)}</div>`,
  args: { id: 'demo-field', label: 'Username', placeholder: 'your name at the table' },
  argTypes: { control: { control: 'inline-radio', options: ['input', 'textarea', 'select'] } },
};

export const Text = {};
export const WithHint = { args: { hint: 'Shown to your opponent and on the ladder.' } };
export const WithError = { args: { value: 'x', error: 'At least three characters.' } };
export const Password = { args: { label: 'Password', type: 'password', value: 'hunter22' } };
export const NumberInput = { name: 'Number', args: { label: 'Games per week', type: 'number', value: 3 } };
export const Textarea = { args: { label: 'Deck list', control: 'textarea', rows: 4, value: '3 Fire Elemental\n2 Ember Spark' } };
export const Select = {
  args: { label: 'Time zone', control: 'select', value: 'utc',
    options: [{ value: 'utc', label: 'UTC' }, { value: 'cet', label: 'Central European' }, { value: 'pt', label: 'Pacific' }] },
};
export const Checkbox = { args: { label: 'Rated game', type: 'checkbox', checked: true } };
export const Disabled = { args: { disabled: true, value: 'cannot change' } };
export const AForm = {
  render: () => `<div style="max-width:320px">${stack([
    field({ id: 'f1', label: 'Username', value: 'mycheze' }),
    field({ id: 'f2', label: 'Password', type: 'password', error: 'That password is wrong.' }),
    field({ id: 'f3', label: 'Remember me', type: 'checkbox', hint: 'Stay signed in on this device.' }),
  ].map(h => `<div style="align-self:stretch">${h}</div>`))}</div>`,
};
