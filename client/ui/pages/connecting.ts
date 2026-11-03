/* The connecting screen: what #app shows between opening a room link and the
 * server's 'joined' — and, when the join is refused (a room code that names no
 * game), the refusal and the way home.
 *
 * main.ts renderConnecting() paints it (it also drops the board's baselines
 * and the .board class, which are the board's business). Moved out of main.ts
 * in the design-system round, 2026-11-03. */
import { esc } from '../util.ts';

export interface ConnectingView {
  /** the refusal to show, or '' while still connecting */
  error: string;
}

/** Pure. A refused join needs a way out — without the button it is a dead
 * end you can only leave by editing the URL. */
export function connectingHtml(v: ConnectingView): string {
  const uiError = v.error;
  return `<div class="joinscreen"><h2>Algomancy</h2>
    <p${uiError ? ' class="joinerr"' : ''}>${uiError ? esc(uiError) : 'Connecting to the server…'}</p>
    ${uiError ? '<button class="primary" data-btn="gohome">← Back to the home screen</button>' : ''}</div>`;
}
