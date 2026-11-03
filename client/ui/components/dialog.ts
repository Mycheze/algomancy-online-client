/* Dialog — a box over the page that wants an answer or a read.
 *
 * Today there are ~10 box styles and 12 scrims and no <dialog> at all
 * (census §8e). The dominant box is `.overlaybox`, the one every board
 * overlay uses: surface, ACCENT border, 10px radius, 18px 22px padding,
 * min(92vw, 560px) wide, its title an accent <h3>; its scrim is
 * `rgba(6,8,11,.72)` (now --color-scrim). The width steps are its modifiers'
 * (.revealbox/.helpbox 640, .logbox 820).
 *
 * This is the markup for a NATIVE <dialog>: the browser gives the top layer
 * (no z-index war), the ::backdrop scrim, Escape to close and focus kept
 * inside, none of which the hand-made overlays have. It renders closed; a page
 * opens it with openDialog() after the markup is in the document.
 *
 * ⚠ main.ts repaints #app with innerHTML on every state change, which would
 * destroy an open dialog inside it. A dialog that must survive a repaint
 * belongs in a layer beside #app (ui/README.md, "How it is put together").
 *
 * The ✕ carries `data-dialog-close`, which installDialogClose() answers, and
 * `closeDataBtn` as its data-btn when the page wants to hear about it. */
import { type Common, esc, rootAttrs } from './_shared.ts';
import { button } from './button.ts';

export const DIALOG_WIDTHS = ['md', 'lg', 'xl'] as const;
export type DialogWidth = typeof DIALOG_WIDTHS[number];

export interface DialogProps extends Common {
  id: string;
  title: string;
  /** trusted markup */
  bodyHtml?: string;
  /** trusted markup: the buttons along the foot, right-aligned */
  actionsHtml?: string;
  width?: DialogWidth;
  /** the ✕ in the corner; on unless false */
  closable?: boolean;
  closeDataBtn?: string;
  closeLabel?: string;
}

export function dialog(p: DialogProps): string {
  const titleId = `${p.id}-title`;
  const close = p.closable === false ? '' : button({
    variant: 'icon', label: '✕', title: p.closeLabel ?? 'Close', className: 'ui-dialog__close',
    dataBtn: p.closeDataBtn, attrs: { 'data-dialog-close': true },
  });
  return `<dialog${rootAttrs(`ui-dialog ui-dialog--${p.width ?? 'md'}`, p, { id: p.id, 'aria-labelledby': titleId })}>`
    + `<div class="ui-dialog__head"><h3 class="ui-dialog__title" id="${esc(titleId)}">${esc(p.title)}</h3>${close}</div>`
    + `<div class="ui-dialog__body">${p.bodyHtml ?? ''}</div>`
    + (p.actionsHtml ? `<div class="ui-dialog__actions">${p.actionsHtml}</div>` : '')
    + '</dialog>';
}

/** the part of an HTMLDialogElement the helpers use (a test passes a fake) */
export interface DialogLike {
  open: boolean;
  showModal(): void;
  close(returnValue?: string): void;
}

/** open it as a modal; false when it was missing or already open */
export function openDialog(el: DialogLike | null | undefined): boolean {
  if (!el || el.open) return false;
  el.showModal();
  return true;
}

/** close it; false when it was missing or already closed */
export function closeDialog(el: DialogLike | null | undefined, returnValue?: string): boolean {
  if (!el || !el.open) return false;
  el.close(returnValue);
  return true;
}

/** the part of an event target the click handler uses */
interface ClosestLike { closest(selector: string): ClosestLike | null }

/**
 * One click listener on `root` that closes the dialog around any
 * `[data-dialog-close]` clicked inside it. Install once, on a root that
 * outlives the repaints (document, or a layer). Returns the listener.
 */
export function installDialogClose(root: { addEventListener(type: 'click', fn: (e: { target: unknown }) => void): void }):
  (e: { target: unknown }) => void {
  const onClick = (e: { target: unknown }): void => {
    const t = e.target as Partial<ClosestLike> | null;
    if (!t || typeof t.closest !== 'function') return;
    const btn = t.closest('[data-dialog-close]');
    closeDialog(btn?.closest('dialog') as unknown as DialogLike | null);
  };
  root.addEventListener('click', onClick);
  return onClick;
}
