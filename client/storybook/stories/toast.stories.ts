import { button } from '../../ui/components/button.ts';
import { TOAST_TONES, type ToastProps, showToast, toastHtml } from '../../ui/components/toast.ts';
import { frame, row } from './_helpers.ts';

export default {
  title: 'Components/Toast',
  render: (args: ToastProps) => frame(toastHtml(args)),
  args: { text: 'Deck saved.', tone: 'success', on: true },
  argTypes: { tone: { control: 'inline-radio', options: TOAST_TONES } },
};

export const Success = {};
export const Info = { args: { tone: 'info', text: 'Link copied.' } };
export const Danger = { args: { tone: 'danger', text: 'Could not save: the server is down.' } };
/** the real helper: one region on <body>, replaced by the next, gone after 2.6s */
export const Live = {
  render: () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = row(TOAST_TONES.map(tone => button({ label: `show ${tone}`, attrs: { 'data-tone': tone } })));
    wrap.addEventListener('click', e => {
      const tone = (e.target as HTMLElement).closest('[data-tone]')?.getAttribute('data-tone');
      if (tone) showToast(`A ${tone} toast.`, { tone: tone as ToastProps['tone'] });
    });
    return wrap;
  },
};
