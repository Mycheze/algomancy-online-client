import { SEGMENTED_SIZES, type SegmentedProps, segmented } from '../../ui/components/segmented.ts';
import { labelled, stack } from './_helpers.ts';

const MODE: SegmentedProps = {
  ariaLabel: 'Game type',
  options: [
    { label: 'Draft', value: 'draft', on: false, dataBtn: 'home-mode', attrs: { 'data-mode': 'draft' } },
    { label: 'Constructed', value: 'constructed', on: true, dataBtn: 'home-mode', attrs: { 'data-mode': 'constructed' } },
  ],
};
const CLOCK: SegmentedProps = {
  ariaLabel: 'Clock', size: 'sm',
  options: [['Off', 0], ['20m', 20], ['40m', 40], ['60m', 60]].map(([label, min]) => ({
    label: String(label), value: String(min), on: min === 20, dataBtn: 'clockpick', attrs: { 'data-ms': Number(min) * 60_000 },
  })),
};
const BEST_OF: SegmentedProps = {
  ariaLabel: 'Best of', size: 'sm',
  options: [
    { label: 'Bo1', value: '1', on: true, dataBtn: 'bestof', attrs: { 'data-n': 1 } },
    { label: 'Bo3', value: '3', on: false, dataBtn: 'bestof', attrs: { 'data-n': 3 }, title: 'Best of three' },
  ],
};

export default {
  title: 'Components/Segmented',
  render: (args: SegmentedProps) => segmented(args),
  args: MODE,
  argTypes: { size: { control: 'inline-radio', options: SEGMENTED_SIZES }, full: { control: 'boolean' } },
};

export const DraftOrConstructed = { name: 'Draft | Constructed' };
export const Full = { name: 'Full width', render: (args: SegmentedProps) => `<div style="width:420px">${segmented({ ...args, full: true })}</div>` };
export const Clock = { name: 'Clock (4 options, small)', args: CLOCK };
export const BestOf = { name: 'Best of (small)', args: BEST_OF };
export const WithDisabled = {
  name: 'An option disabled',
  args: { ...CLOCK, options: CLOCK.options.map((o, i) => (i === 3 ? { ...o, disabled: true, title: 'Not in a league match' } : o)) },
};
/** the sketch's Play card: the switch over the room settings */
export const PlayCard = {
  name: 'In the Play card',
  render: () => `<div style="width:440px">${stack([
    segmented({ ...MODE, full: true }),
    labelled('Clock', segmented(CLOCK)),
    labelled('Best of', segmented(BEST_OF)),
  ])}</div>`,
};
