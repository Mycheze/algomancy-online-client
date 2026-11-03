import { button } from '../../ui/components/button.ts';
import { type EmptyStateProps, emptyState } from '../../ui/components/empty-state.ts';

export default {
  title: 'Components/Empty state',
  render: (args: EmptyStateProps) => `<div style="max-width:480px">${emptyState(args)}</div>`,
  args: { text: 'No description yet.', bare: false },
};

export const Default = {};
export const WithAction = { args: { actionHtml: button({ label: 'Write one', size: 'sm', dataBtn: 'demo' }) } };
export const WithTitle = { args: { title: 'No decks', text: 'Import a list or build one card by card.', actionHtml: button({ label: 'New deck', variant: 'action', dataBtn: 'demo' }) } };
export const Bare = { args: { bare: true, text: 'no games recorded' } };
