import { CHIP_SHAPES, CHIP_TONES, type ChipProps, chip } from '../../ui/components/chip.ts';
import { labelled, row, stack } from './_helpers.ts';

export default {
  title: 'Components/Chip',
  render: (args: ChipProps) => chip(args),
  args: { label: 'early', tone: 'neutral', shape: 'tag', solid: false },
  argTypes: {
    tone: { control: 'select', options: CHIP_TONES },
    shape: { control: 'inline-radio', options: CHIP_SHAPES },
  },
};

export const Neutral = {};
export const Accent = { args: { tone: 'accent' } };
export const Success = { args: { tone: 'success', label: 'faithful' } };
export const Warning = { args: { tone: 'warning', label: 'drift' } };
export const Danger = { args: { tone: 'danger', label: 'refused' } };
export const Info = { args: { tone: 'info', label: 'ruling' } };
export const Pill = { args: { shape: 'pill', tone: 'accent', label: 'judge' } };
export const Solid = { args: { shape: 'pill', tone: 'accent', solid: true, label: 'owner' } };
export const WithTitle = { name: 'With a title (help cursor)', args: { title: 'conceded before turn 3' } };
export const AllTonesAndShapes = {
  render: () => stack([false, true].flatMap(solid => CHIP_SHAPES.map(shape =>
    labelled(`${shape}${solid ? ', solid' : ''}`, row(CHIP_TONES.map(tone => chip({ label: tone, tone, shape, solid })), 6))))),
};
