import { TABS_VARIANTS, type TabsProps, tabs } from '../../ui/components/tabs.ts';

const ITEMS = [
  { id: 'stats', label: 'stats' }, { id: 'history', label: 'history' },
  { id: 'achievements', label: 'achievements', count: '12/40' }, { id: 'friends', label: 'friends', count: 3 },
];

export default {
  title: 'Components/Tabs',
  render: (args: TabsProps) => tabs(args),
  args: { items: ITEMS, active: 'history', dataBtn: 'demo-tab', variant: 'plain', label: 'Profile' },
  argTypes: {
    variant: { control: 'inline-radio', options: TABS_VARIANTS },
    active: { control: 'inline-radio', options: ITEMS.map(i => i.id) },
  },
};

export const Plain = {};
export const Caps = { name: 'Caps (the profile)', args: { variant: 'caps' } };
export const TabClass = {
  name: 'A tab with its own class',
  args: { items: ITEMS.map(i => ({ ...i, className: 'accttab' })), variant: 'caps' },
};
