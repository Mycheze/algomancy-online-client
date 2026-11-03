import { button } from '../../ui/components/button.ts';
import { iconButton } from '../../ui/components/icon-button.ts';
import { SHEET_PLACEMENTS, SHEET_WIDTHS, type SheetPlacement, type SheetProps, installSheetEsc, sheet } from '../../ui/components/sheet.ts';
import { frame } from './_helpers.ts';

const BODY = '<p style="margin:0 0 8px">Type the room code your friend gave you, or pick an invite.</p>'
  + Array.from({ length: 14 }, (_, i) => `<p style="margin:0 0 8px">Invite ${i + 1}: a room waiting for you.</p>`).join('');
const FOOT = button({ label: 'Cancel', dataBtn: 'demo-sheet-close' }) + button({ label: 'Join', variant: 'primary' });

export default {
  title: 'Components/Sheet',
  render: (args: SheetProps) => frame(sheet(args), 460),
  args: {
    open: true, id: 'demo-sheet', title: 'Join a room', bodyHtml: BODY, footerHtml: FOOT,
    width: 'md', placement: 'center', dismissBtn: 'demo-sheet-close',
  },
  argTypes: {
    width: { control: 'inline-radio', options: SHEET_WIDTHS },
    placement: { control: 'select', options: SHEET_PLACEMENTS },
  },
};

export const Center = {};
export const Small = { args: { width: 'sm', title: 'About', bodyHtml: '<p style="margin:0">Algomancy Online is an unofficial client.</p>', footerHtml: undefined } };
export const Large = { args: { width: 'lg' } };
const anchored = (placement: SheetPlacement) => ({
  args: { placement, width: 'sm', title: placement.includes('bottom') ? 'Update log' : 'Alerts', footerHtml: undefined },
});
export const AnchorBottomLeft = { name: 'Anchor: bottom left', ...anchored('anchor-bottom-left') };
export const AnchorBottomRight = { name: 'Anchor: bottom right', ...anchored('anchor-bottom-right') };
export const AnchorTopLeft = { name: 'Anchor: top left', ...anchored('anchor-top-left') };
export const AnchorTopRight = { name: 'Anchor: top right', ...anchored('anchor-top-right') };
export const Closed = { name: 'Closed (renders nothing)', args: { open: false } };

/** the pattern a page follows: the open sheet is STATE, every click repaints from it, Esc closes */
export const Live = {
  name: 'Live (state-driven, Esc closes)',
  render: (args: SheetProps) => {
    const wrap = document.createElement('div');
    let open: SheetPlacement | null = null;
    const paint = (): void => {
      wrap.innerHTML = frame(`<div style="padding:12px;display:flex;gap:8px;flex-wrap:wrap">${
        SHEET_PLACEMENTS.map(p => iconButton({ label: p, icon: 'chevron-right', layout: 'inline', dataBtn: 'demo-open', attrs: { 'data-p': p } })).join('')
      }</div>${sheet({ ...args, open: open !== null, placement: open ?? 'center' })}`, 460);
    };
    wrap.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('[data-btn]');
      if (!btn) return;
      if (btn.getAttribute('data-btn') === 'demo-open') open = btn.getAttribute('data-p') as SheetPlacement;
      if (btn.getAttribute('data-btn') === args.dismissBtn) open = null;
      paint();
    });
    installSheetEsc(document, () => { if (open === null) return false; open = null; paint(); return true; });
    paint();
    return wrap;
  },
  args: { open: false },
};
