import { button } from '../../ui/components/button.ts';
import { chip } from '../../ui/components/chip.ts';
import { type PageHeaderProps, pageHeader } from '../../ui/components/page-header.ts';

export default {
  title: 'Components/Page header',
  render: (args: PageHeaderProps) => pageHeader(args),
  args: { title: 'Decks', subtitle: '4 saved · edits save themselves' },
};

export const TitleOnly = { args: { subtitle: undefined } };
export const WithSubtitle = {};
export const WithBackLink = { args: { back: { dataBtn: 'deck-close' } } };
export const WithActions = {
  args: {
    title: 'mycheze',
    titleHtml: chip({ label: 'owner', tone: 'accent', shape: 'pill', solid: true }),
    subtitle: '212 games · 120W–92L · playing since 5 Sep 2026',
    actionsHtml: [
      button({ label: '🏅 League', dataBtn: 'nav-league' }),
      button({ label: '↻', variant: 'icon', title: 'reload from the server', dataBtn: 'acct-refresh' }),
      button({ label: 'Log out', dataBtn: 'acct-logout' }),
    ].join(''),
    back: { dataBtn: 'acct-close' },
  },
};
export const PlainBack = { name: 'With a plain "Back"', args: { title: '🏅 League', subtitle: 'Season 3 · week 2 of 4', back: { dataBtn: 'lg-close', label: 'Back', variant: 'secondary' } } };
export const ParagraphSubtitle = {
  name: 'Subtitle as a paragraph (league, challenge)',
  args: { title: 'Weekly challenge', subtitle: 'Build a deck in order, then reach the goal using as few cards, elements and turns as you can.',
    subtitleAs: 'p', back: { dataBtn: 'ch-close', label: 'Back', variant: 'secondary' } },
};
