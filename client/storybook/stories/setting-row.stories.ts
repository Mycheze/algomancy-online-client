import { type SettingRowProps, settingRow } from '../../ui/components/setting-row.ts';
import { segmented } from '../../ui/components/segmented.ts';

const CLOCK = segmented({ size: 'sm', ariaLabel: 'Clock', options: ['Default', 'Off', '45m', '60m'].map((l, i) => ({ label: l, value: l, on: i === 0 })) });

export default {
  title: 'Components/Setting row',
  render: (args: SettingRowProps) => `<div style="max-width:640px">${settingRow(args)}</div>`,
  args: { label: 'Clock', controlHtml: CLOCK },
};

export const Plain = {};
export const WithHint = { name: 'With a hint', args: { hintHtml: '60 minutes each, for the whole game.' } };
/** a form: rows stacked with the gap the form chooses */
export const AForm = {
  name: 'A form of rows',
  render: () => `<div style="max-width:640px;display:flex;flex-direction:column;gap:16px">${
    settingRow({ label: 'Format', controlHtml: segmented({ size: 'sm', ariaLabel: 'Format', options: [{ label: 'Live Draft', value: 'd', on: true }, { label: 'Constructed', value: 'c', on: false }] }) })
  }${settingRow({ label: 'Clock', controlHtml: CLOCK, hintHtml: '60m each' })}${
    settingRow({ label: 'Deck', controlHtml: '<select aria-label="Deck"><option>Ember Rush</option></select>' })}</div>`,
};
