import { PANEL_VARIANTS, type PanelProps, panel, panelSubheading } from '../../ui/components/panel.ts';
import { row } from './_helpers.ts';

const BODY = '<p>Games played, your record by element, and the cards you play most.</p>';

export default {
  title: 'Components/Panel',
  render: (args: PanelProps) => `<div style="max-width:420px">${panel(args)}</div>`,
  args: { title: 'Your stats', bodyHtml: BODY, variant: 'default', roomy: false },
  argTypes: { variant: { control: 'inline-radio', options: PANEL_VARIANTS } },
};

export const Default = {};
export const Inset = { args: { variant: 'inset' } };
export const Emphasis = { args: { variant: 'emphasis' } };
export const Roomy = { name: 'Roomy (the home card)', args: { roomy: true, title: undefined, bodyHtml: '<h2 style="margin:0">Play a game</h2>' + BODY } };
export const Untitled = { args: { title: undefined } };
export const AllVariants = {
  render: () => row(PANEL_VARIANTS.map(variant => `<div style="width:260px">${panel({ variant, title: variant, bodyHtml: BODY })}</div>`), 12),
};
export const TitleWithMarkup = {
  name: 'Title with markup (titleHtml)',
  args: { title: 'November league', titleHtml: '<span class="lgtag">hidden</span><span class="lgtag">on hold</span>' },
};
export const WithSubheadings = {
  name: 'With sub-headings',
  args: {
    title: 'Your matches',
    bodyHtml: `${panelSubheading({ text: 'Week 2' })}<p>vs <b>Nyar</b> · Play</p>${panelSubheading({ text: 'Week 1' })}<p>vs <b>Karanda</b> · ✅ you won</p>`,
  },
};
