/* Toast — a brief notice at the foot of the window that goes away by itself.
 *
 * Four systems today (census §8i): the green `.toast` (the dominant one,
 * and this default look), the rules page's `.crtoast` (surface, accent
 * border; tone `info` here), the board's cost toasts (`.costtoast`, red edge;
 * tone `danger`) and the deck page's. This is the one helper meant to replace
 * them. Nothing is migrated yet: the board's cost toasts (ui/toast.ts) are a
 * different thing — a stack of game notices — and stay where they are.
 *
 *   toastHtml(props)    the markup, pure, for a page that paints it itself
 *   showToast(text, …)  puts ONE toast region in the document (made once,
 *                       reused) and shows `text` in it for `ms`; a second
 *                       call replaces the first. Returns a dismiss function.
 *
 * The region lives on <body>, outside #app, so a repaint of the page does not
 * take it away — the census's complaint about the green toast, which only
 * paints on the board's next render. */
import { type Common, rootAttrs, textOrHtml } from './_shared.ts';

export const TOAST_TONES = ['success', 'info', 'danger'] as const;
export type ToastTone = typeof TOAST_TONES[number];

export interface ToastProps extends Common {
  text?: string;
  textHtml?: string;
  tone?: ToastTone;
  /** shown (the class `on`); off, it is in the document but invisible */
  on?: boolean;
}

const toastClasses = (tone: ToastTone, on: boolean): string => `ui-toast ui-toast--${tone}${on ? ' on' : ''}`;

export function toastHtml(p: ToastProps): string {
  const tone = p.tone ?? 'success';
  return `<div${rootAttrs(toastClasses(tone, p.on ?? true), p, {
    role: tone === 'danger' ? 'alert' : 'status', 'aria-live': tone === 'danger' ? 'assertive' : 'polite',
  })}>${textOrHtml(p.text, p.textHtml)}</div>`;
}

/** the id of the one region showToast() keeps on <body> */
export const TOAST_REGION_ID = 'ui-toast-region';

/** the parts of an element and a document that showToast() touches (a test passes fakes) */
export interface ToastEl { id: string; className: string; textContent: string | null; setAttribute(name: string, value: string): void }
export interface ToastDoc {
  getElementById(id: string): ToastEl | null;
  createElement(tag: 'div'): ToastEl;
  body: { appendChild(el: ToastEl): unknown };
}

export interface ShowToastOptions {
  tone?: ToastTone;
  /** how long it stays, in ms */
  ms?: number;
  doc?: ToastDoc;
}

let hideTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, o: ShowToastOptions = {}): () => void {
  const doc = o.doc ?? (globalThis as { document?: ToastDoc }).document;
  if (!doc) return () => {};
  const tone = o.tone ?? 'success';
  let el = doc.getElementById(TOAST_REGION_ID);
  if (!el) {
    el = doc.createElement('div');
    el.id = TOAST_REGION_ID;
    doc.body.appendChild(el);
  }
  const region = el;
  region.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
  region.setAttribute('aria-live', tone === 'danger' ? 'assertive' : 'polite');
  region.textContent = text;
  region.className = toastClasses(tone, true);
  if (hideTimer !== undefined) clearTimeout(hideTimer);
  const dismiss = (): void => {
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = undefined;
    region.className = toastClasses(tone, false);
  };
  hideTimer = setTimeout(dismiss, o.ms ?? 2600);
  return dismiss;
}
