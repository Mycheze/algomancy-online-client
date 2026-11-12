/* The connecting screen: what #app shows between opening a room link and the
 * server's 'joined' — and, when the join is refused (a room code that names no
 * game), the refusal and the way home.
 *
 * main.ts renderConnecting() paints it (it also drops the board's baselines
 * and the .board class, which are the board's business). Moved out of main.ts
 * in the design-system round, 2026-11-03. Drawn in the app frame since
 * 2026-11-04, as the rooms it leads to are (pages/lobby.ts roomFrameHtml), so
 * the toolbar does not jump when the room appears; `joinscreen` stays the
 * root's last class (report.ts pageOf → "join"). */
import { backLink } from '../components/index.ts';
import { esc } from '../util.ts';
import type { FrameChrome } from './frame.ts';
import { roomFrameHtml, roomSection } from './lobby.ts';

export interface ConnectingView {
  /** the refusal to show, or '' while still connecting */
  error: string;
  /** the line shown while it is still on its way — what the page is actually
   * waiting for. A room link waits for the server; a replay, a lesson, a
   * challenge or a rules question is opened in this page and has no server to
   * connect to, so it says what it is loading instead (docs/23-ui-inventory/05
   * §18.15). Default: "Connecting to the server…" */
  waiting?: string;
  /** the server dropped and the page is already trying again by itself: `error`
   * holds the countdown ("disconnected from the server — reconnecting in 2s…"),
   * which is still on its way, not a refusal. It is drawn as the waiting line
   * is, with no "Back to the home screen" that reads as if it were over — the
   * toolbar's Home is the way out, as while connecting (docs/23-ui-inventory/05
   * §18.19). */
  retrying?: boolean;
  /** the toolbar's account and bell (pages/frame.ts); signed out when absent */
  chrome?: FrameChrome;
}

/** what a room link waits for */
export const CONNECTING = 'Connecting to the server…';

/** Pure. A refused join needs a way out — without the button it is a dead
 * end you can only leave by editing the URL. (The toolbar's Home is one too.) */
export function connectingHtml(v: ConnectingView): string {
  const frame = (body: string): string => roomFrameHtml({
    page: 'joinscreen', kind: 'Algomancy', room: null, backLabel: 'Home',
    chrome: v.chrome ?? { signedIn: false, alerts: 0 },
    cardHtml: roomSection(body),
  });
  if (v.error && v.retrying) {
    return frame(`<p role="status">${esc(v.error)} ${RETRYING}</p>`);
  }
  const uiError = v.error;
  return frame(`<p${uiError ? ' class="joinerr"' : ''}>${esc(uiError || v.waiting || CONNECTING)}</p>
    ${uiError ? backLink({ dataBtn: 'gohome', label: 'Back to the home screen', arrow: true }) : ''}`);
}

/** what the retrying line adds: it is not over */
export const RETRYING = 'This page joins the room by itself as soon as the server answers.';

/** what a kicked seat says when the server gives no reason */
export const KICKED = 'another connection took over this seat';

/** Pure. The notice a tab is left with when the server hands its seat to
 * another connection (server/main.ts sends `kicked` with the reason, then
 * closes the socket). The tab is done: the page is the notice and its way
 * home, and main.ts's NetBackend stops reconnecting before it paints this.
 * Moved out of NetBackend's message handler byte for byte (BL-63, 2026-11-12);
 * it is still the old join-screen card, not the app frame. */
export function kickedHtml(msg: string | undefined): string {
  return `<div class="joinscreen"><h2>Algomancy</h2>
        <p>${esc(msg ?? KICKED)}</p>
        <button data-btn="gohome">Home</button></div>`;
}
