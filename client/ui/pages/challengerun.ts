/* A WEEKLY CHALLENGE RUN'S METER AND END PANELS, DRAWN (docs/21; the page
 * contract, pages/README.md).
 *
 * Moved out of ui/challengerun.ts in the design-system round, 2026-11-03.
 * These are not a page: the meter is a row of the board's sticky strip
 * (main.ts draws it there) and the end panel a layer over the board. They
 * live here so the end panels have a story and a DOM-free test like a page.
 * ui/challengerun.ts keeps the run, its layer and its buttons, and gathers
 * the views (runMeterView / runEndView there).
 *
 * Its own file, not pages/challenge.ts: that page's view gatherer imports
 * ui/challengerun.ts, which imports this.
 */
import { BOARD_KINDS, type BoardKind, type RunScore } from '../../engine/src/challenge.ts';
import type { SubmitReply, SubmitState } from '../challengerun.ts';
import { esc } from '../util.ts';

/** one number in a stat grid — account.ts's `.statcell`, value over label */
export const statCell = (label: string, value: string | number): string =>
  `<div class="statcell"><div class="statval">${esc(String(value))}</div><div class="statlab">${esc(label)}</div></div>`;

/** what the run took — turns first, the hardest to cut; extra copies only when there are any */
export function scoreHtml(s: RunScore): string {
  return `<div class="statgrid chscore">${statCell('Turns', s.turns)}${statCell('Cards', s.cards)}${
    s.extra ? statCell('Extra copies', s.extra) : ''}${statCell('Elements', s.elements)}</div>${
    s.debtTurns ? `<p class="dim chdebt">Met on turn ${s.turns - s.debtTurns}, plus ${s.debtTurns} turn${
      s.debtTurns === 1 ? '' : 's'} to pay off ${s.debt ?? 0} debt.</p>` : ''}`;
}

const BOARD_NAME: Record<BoardKind, string> = { fastest: 'fastest', leanest: 'leanest', purest: 'purest', overall: 'overall' };

/** "New best: fastest, leanest. #1 fastest · #3 leanest · #2 purest · #2 overall." */
function placedText(r: SubmitReply): string {
  const nb = (r.newBest ?? []).map(k => BOARD_NAME[k]);
  const head = nb.length ? `New best: ${nb.join(', ')}.` : 'On the leaderboard. No new best.';
  const ranks = BOARD_KINDS.flatMap(k => (r.ranks?.[k] ? [`#${r.ranks[k]} ${BOARD_NAME[k]}`] : []));
  return `${head}${ranks.length ? ` ${ranks.join(' · ')}.` : ''}`;
}

function submitHtml(st: SubmitState): string {
  switch (st.s) {
    case 'guest': return `<p>Sign in to put this run on the leaderboard. It is kept here until you do.</p>
      <button class="primary" data-chal="signin">Sign in</button>`;
    case 'sending': return '<p class="dim">Submitting…</p>';
    case 'error': return `<p class="chproblem">${esc(st.error)}</p><button data-chal="resend">Try again</button>`;
    case 'done': return `<p>${esc(placedText(st.reply))}</p>`;
    default: return '';
  }
}

export interface RunMeterView {
  /** "Turn 3 · 7 cards · 2 elements" — the run's own words */
  text: string;
  /** Give up was pressed once: the second press throws the run away */
  armed: boolean;
}

/** The meter: a row of the board's own sticky strip (main.ts renders it
 * there), under the turn bar — part of the table's layout, so it covers
 * nothing the board shows, at any width. Only the end panel is a layer. */
export function runMeterHtml(v: RunMeterView): string {
  return `<div class="chmeter" role="status">
    <span class="chmetertext">${esc(v.text)}</span>
    <button data-chal="rewind" title="back to the start of this turn">↺ Turn</button>
    <button data-chal="retry">Retry</button>
    ${v.armed
      ? '<button class="danger" data-chal="giveup">Press again to give up</button>'
      : '<button data-chal="giveup">Give up</button>'}
  </div>`;
}

/** the end panel: the goal met (the score, the upload), the run failed (why), or none */
export type RunEndView =
  | { kind: 'done'; score: RunScore; submit: SubmitState }
  | { kind: 'failed'; why: string }
  | null;

export function runEndHtml(v: RunEndView): string {
  if (!v) return '';
  if (v.kind === 'done') {
    return `<div class="chscrim"><div class="chbox" role="dialog" aria-label="Goal met">
      <h3>Goal met</h3>
      ${scoreHtml(v.score)}
      ${submitHtml(v.submit)}
      <div class="chboxbtns">
        <button data-chal="export">Export run</button>
        <button data-chal="retry">Retry</button>
        <button class="primary" data-chal="page">Challenge page</button>
      </div>
    </div></div>`;
  }
  return `<div class="chscrim"><div class="chbox" role="dialog" aria-label="Run failed">
      <h3>Run failed</h3>
      <p>${esc(v.why)}</p>
      <div class="chboxbtns">
        <button data-chal="rewind">↺ Rewind this turn</button>
        <button class="primary" data-chal="retry">Retry</button>
        <button data-chal="page">Challenge page</button>
      </div>
    </div></div>`;
}
