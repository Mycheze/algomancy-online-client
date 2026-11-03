import { STATUS_TONES, type StatusProps, statusMessage } from '../../ui/components/status.ts';
import { stack } from './_helpers.ts';

export default {
  title: 'Components/Status message',
  render: (args: StatusProps) => statusMessage(args),
  args: { text: 'Deck saved.', tone: 'note', boxed: false },
  argTypes: { tone: { control: 'select', options: STATUS_TONES } },
};

export const Note = { name: 'Note (today\'s gold .deckmsg)' };
export const Ok = { args: { tone: 'ok', text: 'Deck saved.' } };
export const Warn = { args: { tone: 'warn', text: 'Two cards are not in the pool any more.' } };
export const ErrorTone = { name: 'Error', args: { tone: 'error', text: 'Could not reach the server.' } };
export const Info = { args: { tone: 'info', text: 'The league starts on Sunday at 07:00 UTC.' } };
export const Boxed = { args: { tone: 'error', boxed: true, text: 'That password is wrong.' } };
export const AllTones = {
  render: () => stack([false, true].flatMap(boxed => STATUS_TONES.map(tone => statusMessage({ tone, boxed, text: `${tone}${boxed ? ', boxed' : ''}` }))), 8),
};
export const Paragraph = {
  name: 'As a paragraph (the home and waiting-room error line)',
  render: () => `<div>Above.${statusMessage({ tag: 'p', className: 'deckmsg', text: 'The server refused that name.' })}Below.</div>`,
};
