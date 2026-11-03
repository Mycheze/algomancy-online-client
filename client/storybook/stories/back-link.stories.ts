import { BACK_LINK_VARIANTS, type BackLinkProps, backLink } from '../../ui/components/back-link.ts';
import { row } from './_helpers.ts';

export default {
  title: 'Components/Back link',
  render: (args: BackLinkProps) => backLink(args),
  args: { dataBtn: 'demo-close', arrow: false },
  argTypes: { variant: { control: 'inline-radio', options: BACK_LINK_VARIANTS } },
};

export const ReturnToLobby = { name: 'Return to Lobby (default)' };
export const Back = { args: { label: 'Back', variant: 'secondary' } };
export const ArrowHome = { name: '← home', args: { label: 'home', arrow: true, variant: 'secondary', size: 'sm' } };
export const AsLink = { args: { label: 'Back to the deck', arrow: true, variant: 'link' } };
export const AllVariants = { render: () => row(BACK_LINK_VARIANTS.map(variant => backLink({ dataBtn: 'demo', variant, label: variant, arrow: true }))) };
