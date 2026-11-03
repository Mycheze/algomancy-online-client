import { button } from '../../ui/components/button.ts';
import { DIALOG_WIDTHS, type DialogProps, dialog, installDialogClose, openDialog } from '../../ui/components/dialog.ts';

const BODY = '<p style="margin:0">Tell us what went wrong. The game so far is attached, so we can replay it.</p>';
const ACTIONS = button({ label: 'Cancel', attrs: { 'data-dialog-close': true } }) + button({ label: 'Send', variant: 'primary', attrs: { 'data-dialog-close': true } });

/** a button that opens the dialog as a real modal (the backdrop, Escape, the top layer) */
const modal = (args: DialogProps): HTMLElement => {
  const wrap = document.createElement('div');
  wrap.innerHTML = button({ label: `Open “${args.title}”`, variant: 'action' }) + dialog(args);
  wrap.querySelector('button')!.addEventListener('click', () => openDialog(wrap.querySelector('dialog')));
  installDialogClose(wrap);
  return wrap;
};

export default {
  title: 'Components/Dialog',
  render: modal,
  args: { id: 'demo-dialog', title: 'Report a problem', bodyHtml: BODY, actionsHtml: ACTIONS, width: 'md', closable: true },
  argTypes: { width: { control: 'inline-radio', options: DIALOG_WIDTHS } },
};

export const Modal = {};
export const Large = { args: { width: 'lg', id: 'demo-lg' } };
export const ExtraLarge = { args: { width: 'xl', id: 'demo-xl' } };
export const NoCloseButton = { args: { closable: false, id: 'demo-nox' } };
/** drawn open in the page (not modal), to look at without clicking */
export const Open = {
  render: (args: DialogProps) => `<div style="position:relative;min-height:220px">${dialog({ ...args, id: 'demo-open', attrs: { open: true, style: 'position:static' } })}</div>`,
};
