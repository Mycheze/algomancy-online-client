/* Sheet — a dismissable panel over the page, drawn from STATE.
 *
 * The redesign's "tap it and a list comes up" surfaces (client/docs/24-redesign/):
 * Join a Room, the update log, the client's about/disclaimer text, an alerts
 * list. Unlike dialog.ts (a native <dialog> a page opens with showModal()),
 * a sheet is plain markup that is there when `open` is true and is '' when it
 * is false. main.ts repaints #app with innerHTML on every state change and on
 * every poll; a sheet the page draws from its own state ("which sheet is
 * open") is simply drawn open again by the next repaint, so it survives them.
 *
 *   <div class="ui-sheet ui-sheet--<placement> ui-sheet--<width>">
 *     <div class="ui-sheet__scrim" data-btn="<dismissBtn>">     tap / click off
 *     <section class="ui-sheet__panel" role="dialog">
 *       <div class="ui-sheet__head"> title · ✕ (data-btn="<dismissBtn>")
 *       <div class="ui-sheet__body">      scrolls inside itself, never the page
 *       <div class="ui-sheet__foot">      only with footerHtml
 *
 * Dismissing is the page's: the scrim and the ✕ both carry `dismissBtn` as
 * their data-btn (main.ts's delegator routes on closest('[data-btn]'), so a
 * <div> works), and installSheetEsc() below hands the page an Escape key. The
 * page clears its state and repaints; nothing here hides itself.
 *
 * Placement: `center` over a dimmed page; the four anchors sit in a corner,
 * clear of an app shell's top or bottom bar (--shell-bar-h), over a lighter
 * scrim — for a list that belongs to a toolbar button or a bottom-bar link.
 * `side` (BL-65, 2026-11-04) is docked to the window's right edge, the full
 * height, over the lighter scrim: the deck screens' sheets, which cover part of
 * the window and never the whole deck. It always leaves a strip of the page
 * showing (--shell-bar-h wide) to tap off; it does not animate in either.
 * Width: sm 320px, md 480px, lg 720px, never wider than the window less its
 * gutters. Height: the body scrolls once the panel reaches the window's height
 * less its gutters (and the bar, when anchored; the side sheet has none).
 *
 * ⚠ A sheet holding a text field (the room code) loses the caret on every
 * repaint if it is drawn inside #app; keep such a sheet in a layer beside #app,
 * or have the page put the focus back (pages/caret.ts). */
import { type Common, esc, rootAttrs } from './_shared.ts';
import { icon } from './icon.ts';

export const SHEET_WIDTHS = ['sm', 'md', 'lg'] as const;
export type SheetWidth = typeof SHEET_WIDTHS[number];
export const SHEET_PLACEMENTS = ['center', 'anchor-bottom-left', 'anchor-bottom-right', 'anchor-top-left', 'anchor-top-right', 'side'] as const;
export type SheetPlacement = typeof SHEET_PLACEMENTS[number];

export interface SheetProps extends Common {
  /** false renders nothing at all */
  open: boolean;
  title: string;
  /** trusted markup */
  bodyHtml?: string;
  /** trusted markup: the buttons along the foot */
  footerHtml?: string;
  width?: SheetWidth;
  placement?: SheetPlacement;
  /** the data-btn the scrim and the ✕ carry: the page's "close this sheet" */
  dismissBtn?: string;
  /** the ✕'s name; default "Close" */
  closeLabel?: string;
  /** on the root; the title is `<id>-title`, which labels the panel */
  id?: string;
}

export function sheet(p: SheetProps): string {
  if (!p.open) return '';
  const placement = p.placement ?? 'center';
  const titleId = p.id ? `${p.id}-title` : undefined;
  const closeLabel = p.closeLabel ?? 'Close';
  const btn = p.dismissBtn ? ` data-btn="${esc(p.dismissBtn)}"` : '';
  return `<div${rootAttrs(`ui-sheet ui-sheet--${placement} ui-sheet--${p.width ?? 'md'}`, p, { id: p.id, 'data-sheet': true })}>`
    + `<div class="ui-sheet__scrim"${btn} data-sheet-dismiss aria-hidden="true"></div>`
    + `<section class="ui-sheet__panel" role="dialog"${titleId ? ` aria-labelledby="${esc(titleId)}"` : ` aria-label="${esc(p.title)}"`}>`
    + `<div class="ui-sheet__head"><h2 class="ui-sheet__title"${titleId ? ` id="${esc(titleId)}"` : ''}>${esc(p.title)}</h2>`
    + `<button class="ui-sheet__close" type="button"${btn} data-sheet-dismiss title="${esc(closeLabel)}" aria-label="${esc(closeLabel)}">${icon('close')}</button></div>`
    + `<div class="ui-sheet__body">${p.bodyHtml ?? ''}</div>`
    + (p.footerHtml ? `<div class="ui-sheet__foot">${p.footerHtml}</div>` : '')
    + '</section></div>';
}

/** the part of a keydown event the Escape helper reads */
export interface SheetKeyEvent { key: string; isComposing?: boolean; preventDefault(): void }
/** the part of a document installSheetEsc touches (a test passes a fake) */
export interface SheetEscRoot {
  addEventListener(type: 'keydown', fn: (e: SheetKeyEvent) => void): void;
}

const ESC_SLOT = '__uiSheetEsc';

/**
 * Escape → `onEsc(e)`, from anywhere in the document (a text field too: Esc
 * closes a sheet even while typing in it). The callback decides: it closes the
 * page's open sheet and returns true, and only then is the key's default
 * prevented — with no sheet open it returns false and Escape goes on to
 * whatever else wants it. Mid-composition (an IME) Escape is the composer's.
 *
 * Idempotent: one listener per document, however often it is called; a later
 * call replaces the callback. Returns true when it added the listener.
 */
export function installSheetEsc(doc: SheetEscRoot, onEsc: (e: SheetKeyEvent) => boolean | void): boolean {
  const slot = doc as unknown as Record<string, { onEsc: (e: SheetKeyEvent) => boolean | void } | undefined>;
  const held = slot[ESC_SLOT];
  if (held) { held.onEsc = onEsc; return false; }
  const state = { onEsc };
  slot[ESC_SLOT] = state;
  doc.addEventListener('keydown', e => {
    if ((e.key !== 'Escape' && e.key !== 'Esc') || e.isComposing) return;
    if (state.onEsc(e) === true) e.preventDefault();
  });
  return true;
}
