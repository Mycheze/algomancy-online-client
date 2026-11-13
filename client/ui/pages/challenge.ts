/* THE WEEKLY CHALLENGE PAGE, ITS HOME CARD AND ITS HEADER BUTTON, DRAWN
 * (docs/21-weekly-challenges.md § Browser; the page contract, pages/README.md).
 *
 * Moved out of ui/challenge.ts in the design-system round, 2026-11-03:
 *
 *   · challengePageView(raw) / challengeHomeView(raw) gather — the server's
 *     clock, the runs kept in this browser, whether this account can submit,
 *     the decks the builder can import — into a plain view;
 *   · challengePageHtml(view) / challengeHomeCardHtml(view) /
 *     challengeNavHtml(view) draw it and touch nothing else;
 *   · paintChallengePage(app, view) paints it in the app frame (2026-11-13,
 *     BL-63). The page has no wiring of its own: every control on it is a
 *     data-btn click, which ui/challenge.ts handleButton answers;
 *   · ui/challenge.ts keeps the state, the fetches, the clicks, the hand-off
 *     to a run and the tabletop host — and the decision whether to paint at
 *     all: never while the tabletop is up over the page (tt.screen()), whose
 *     state is that module's, as main.ts's router decides which page owns
 *     the app element.
 *
 * ("challengePage…", not "challenge…": `ChallengeView` is already the
 * server's name for one week's challenge, server/api-challenge.ts.)
 *
 * The builder card is ui/challengebuild.ts builderHtml (pure already), and
 * the run's meter and end panels are ui/challengerun.ts's: they are drawn on
 * the board, not on this page.
 */
import type { CardName } from '../../engine/src/types.ts';
import {
  BOARD_KINDS, TROPHY_KINDS, goalText, setupLines, type BoardKind, type ChallengeDef, type RunScore,
} from '../../engine/src/challenge.ts';
import { builderHtml, type BuilderView } from '../challengebuild.ts';
import { panel, panelSubheading } from '../components/panel.ts';
import { type TableColumn, table } from '../components/table.ts';
import { statusMessage, type StatusTone } from '../components/status.ts';
import { tabs } from '../components/tabs.ts';
import { canSubmit, doneRuns, type DoneRun, type SubmitReply } from '../challengerun.ts';
import { esc } from '../util.ts';
import { frameChromeView, frameHtml, paintFrame, type FrameChrome } from './frame.ts';

// ── the server's shapes (server/api-challenge.ts, server/challenge-store.ts) ──

export type ChallengeView = ChallengeDef & { opens: number; closes: number; closed: boolean; entrants: number };
export interface BoardRow {
  rank: number; name: string; score: RunScore; at: number; runId?: string; deck?: CardName[];
  /** the run no longer reproduces on today's rules (server/challenge-resim.ts) */
  older?: boolean;
}
export interface BoardReply {
  id: string; closed: boolean; boards: Record<BoardKind, BoardRow[]>;
  /** a closed week's frozen first place on each trophy board */
  winners?: Partial<Record<BoardKind, BoardRow>>;
}
/** the caller's best run on one board, and its rank there */
export interface MyBest { score: RunScore; rank: number }
export interface ChallengeReply {
  now: number;
  current: ChallengeView | null;
  past: ChallengeView[];
  /** the caller's best per challenge, on each board */
  mine?: Record<string, Record<BoardKind, MyBest>>;
}
/** one leaderboard as the page holds it: the answer, or still coming, or failed */
export type BoardSlot = BoardReply | 'loading' | 'error';

/** the challenges a reply knows, newest first */
export const allViews = (d: ChallengeReply | null): ChallengeView[] => (d ? [...(d.current ? [d.current] : []), ...d.past] : []);

// ── formatting ────────────────────────────────────────────────────────

/** "3d 4h left", "5h 12m left" — measured from `now`, the server's clock */
export function timeLeft(closes: number, now: number): string {
  const ms = Math.max(0, closes - now);
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (ms <= 0) return 'closed';
  return d ? `${d}d ${h % 24}h left` : h ? `${h}h ${m % 60}m left` : `${Math.max(1, m)}m left`;
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "12 cards (2 extra)", the extra copies only when there are any */
const cardsText = (s: RunScore): string => `${plural(s.cards, 'card')}${s.extra ? ` (${s.extra} extra)` : ''}`;

/** "5 turns (3 paying debt)", the debt turns only when there are any */
const turnsText = (s: RunScore): string => `${plural(s.turns, 'turn')}${s.debtTurns ? ` (${s.debtTurns} paying debt)` : ''}`;

const scoreLine = (s: RunScore): string =>
  `${turnsText(s)} · ${cardsText(s)} · ${plural(s.elements, 'element')}`;

/** each board's name, and what it ranks by — the tab's tooltip */
export const BOARD_LABEL: Record<BoardKind, string> = {
  fastest: 'Fastest', leanest: 'Leanest', purest: 'Purest', overall: 'Overall',
};
const BOARD_TIP: Record<BoardKind, string> = {
  fastest: 'Fewest turns. Ties go to fewer cards, then fewer elements.',
  leanest: 'Fewest cards. Ties go to fewer turns, then fewer elements.',
  purest: 'Fewest elements. Ties go to fewer turns, then fewer cards.',
  overall: 'All three at once, with turns counting most: turns² × cards × √elements. No trophy.',
};
/** the column each board sorts by first (bold); overall has none */
const FIRST: Partial<Record<BoardKind, 'turns' | 'cards' | 'elements'>> = { fastest: 'turns', leanest: 'cards', purest: 'elements' };

// ── the home page ─────────────────────────────────────────────────────

export interface ChallengeHomeView {
  /** this week's challenge, or null: no card */
  current: ChallengeView | null;
  /** there is a week to show at all (this one or a past one): the header button */
  any: boolean;
  /** the viewer's best on this week's fastest board */
  best: MyBest | undefined;
  /** the server's clock */
  now: number;
}

/** The header's way in, while there is a challenge to show. */
export function challengeNavHtml(v: ChallengeHomeView): string {
  if (!v.any) return '';
  return '<button class="homedecks" data-btn="nav-challenge">🧩 Challenge</button>';
}

/** "This week's challenge": hidden when there is none or no server. */
export function challengeHomeCardHtml(v: ChallengeHomeView): string {
  const c = v.current;
  if (!c) return '';
  const best = v.best;
  return `<div class="homecard chhome">
    <h2>This week's challenge</h2>
    <p class="cardsub"><b>${esc(goalText(c.goal))}</b></p>
    <p class="cardsub">${esc(timeLeft(c.closes, v.now))}${best ? ` · your best: ${plural(best.score.turns, 'turn')} (#${best.rank} fastest)` : ''}</p>
    <div class="spacer"></div>
    <button class="cta primary" data-btn="ch-home-play" data-id="${esc(c.id)}">Play</button>
  </div>`;
}

/** The new home's Challenge card body (docs/24, 2026-11-03): this week's goal,
 * the time left and your best. No buttons — the whole card is H1's
 * `nav-challenge` button. '' with no current week (the card says so itself). */
export function challengeGlanceHtml(v: ChallengeHomeView): string {
  const c = v.current;
  if (!c) return '';
  const best = v.best;
  // how much of the week is gone: the bar empties as the week runs out
  const span = c.closes - c.opens;
  const left = span > 0 ? Math.max(0, Math.min(1, (c.closes - v.now) / span)) : 0;
  return `<div class="chglance">
    <div class="chgltitle">${esc(c.title)}</div>
    <div class="chglgoal">${esc(goalText(c.goal))}</div>
    <div class="chgltime"><span class="chglbar"><span style="width:${Math.round(left * 100)}%"></span></span>${esc(timeLeft(c.closes, v.now))}</div>
    <div class="chglmeta">${best ? `<span class="chglbest">#${best.rank} fastest · ${plural(best.score.turns, 'turn')}</span>` : ''}${
      c.entrants ? `<span>${plural(c.entrants, 'player')}</span>` : ''}</div>
  </div>`;
}

/** Gather the home card and header button: from the page's answer or the home's own. */
export function challengeHomeView(hint: ChallengeReply | null, now: number): ChallengeHomeView {
  const current = hint?.current ?? null;
  return {
    current,
    any: !!hint && (!!hint.current || hint.past.length > 0),
    best: current ? hint?.mine?.[current.id]?.fastest : undefined,
    now,
  };
}

// ── the page ──────────────────────────────────────────────────────────

/** a run finished in this browser, and how its upload is going */
export interface KeptRun { run: DoneRun; st: 'sending' | SubmitReply | undefined }

export interface ChallengePageView {
  /** the server's answer, or null before the first one */
  data: ChallengeReply | null;
  loading: boolean;
  /** the last thing a button or fetch said ('' = nothing) */
  msg: string;
  /** a result is drawn as one (ok), a refusal in red (error) */
  msgTone: StatusTone;
  /** the server's clock */
  now: number;
  /** the leaderboard tab on show */
  tab: BoardKind;
  /** the past week whose board is unfolded */
  pastOpen: string | null;
  /** a press-again button waiting for its second press (`forget:<at>`) */
  arming: string | null;
  /** the leaderboards the page has asked for, by challenge id */
  boards: Record<string, BoardSlot>;
  /** the challenge the builder builds for, and the builder card's view; null = no builder */
  building: ChallengeView | null;
  builder: BuilderView | null;
  /** the runs finished in this browser for a challenge the page knows */
  kept: KeptRun[];
  /** this account can put a run on a board (named, not a guest) */
  canSubmit: boolean;
  /** the toolbar's account and bell (pages/frame.ts) */
  chrome: FrameChrome;
}

/** The page, in the app frame (pages/frame.ts, 2026-11-04): two columns that
 * each scroll inside themselves. On the left what the week IS and what you
 * have done (finished runs, the builder, this week, the past weeks); on the
 * right the leaderboard — this week's, or the past week you opened, in its
 * place rather than under the list. */
export function challengePageHtml(v: ChallengePageView): string {
  const { data, msg, loading } = v;
  const cur = data?.current ?? null;
  const b = v.building;
  const past = v.pastOpen ? data?.past.find(x => x.id === v.pastOpen) ?? null : null;
  const shown = past ?? cur;
  const left = `${keptHtml(v)}
      ${b ? `${b.id !== cur?.id ? panel({ title: b.title, wide: true, bodyHtml: `<p class="chgoal">${esc(goalText(b.goal))}</p>${
        b.closed ? '<p class="dim">This week is closed. A run still goes on its leaderboard.</p>' : ''}` }) : ''}
        ${v.builder ? builderHtml(v.builder) : ''}` : ''}
      ${data && !cur ? panel({ title: 'No challenge this week', bodyHtml: '<p>Check back on Sunday.</p>' }) : ''}
      ${cur ? weekCardHtml(cur, v) : ''}
      ${data ? pastHtml(data, v) : ''}`;
  return frameHtml({
    page: 'chpage', title: 'Weekly challenge', back: { dataBtn: 'ch-close', label: 'Home' }, chrome: v.chrome, fill: true,
    mainHtml: `${msg ? statusMessage({ tone: v.msgTone, text: msg }) : ''}
    ${loading && !data ? '<p class="dim">Loading…</p>' : ''}
    <div class="chwork${shown ? '' : ' chnoboard'}">
      <div class="chleft" data-scroll="ch-left">${left}</div>
      ${shown ? `<div class="chright" data-scroll="ch-board-${esc(shown.id)}">${boardHtml(shown, v, !!past, !!past && !!cur)}</div>` : ''}
    </div>`,
  });
}

// "Your best" and the past weeks are lists with no header row; a column's class sits on every cell
const BEST_COLUMNS = [{ key: 'kind', label: '' }, { key: 'rank', label: '' }, { key: 'score', label: '', className: 'dim' }];


function bestHtml(id: string, v: ChallengePageView): string {
  const m = v.data?.mine?.[id];
  if (!m) return '';
  return `${panelSubheading({ text: 'Your best' })}${table({ className: 'chmine', headless: true, columns: BEST_COLUMNS, rows: BOARD_KINDS.map(k => ({ cells: {
    kind: BOARD_LABEL[k], rank: { html: `<b>#${m[k].rank}</b>` }, score: scoreLine(m[k].score),
  } })) })}`;
}

function weekCardHtml(c: ChallengeView, v: ChallengePageView): string {
  return panel({ title: c.title, className: 'chweek', bodyHtml: `
    <p class="chgoal">${esc(goalText(c.goal))}</p>
    ${setupLines(c.setup).map(l => `<p class="chsetup">${esc(l)}</p>`).join('')}
    ${c.blurb ? `<p>${esc(c.blurb)}</p>` : ''}
    <p class="dim">${esc(timeLeft(c.closes, v.now))} · ${c.entrants} entrant${c.entrants === 1 ? '' : 's'}</p>
    <p class="dim">Three first places: fewest turns, fewest cards, fewest elements.</p>
    <p class="dim">${esc(DEBT_RULE)}</p>
    ${bestHtml(c.id, v)}
    ${v.building?.id === c.id ? '' : `<p><button class="primary" data-btn="ch-build" data-id="${esc(c.id)}">Build a deck</button></p>`}
  ` });
}

/** Owner, 2026-10-23: "Flag it, still ranked". A run the rules have moved
 * under keeps its score and rank; the board says so, in a player's words. */
const OLDER_TIP = 'The rules have changed since this run was played: replayed today, it would not go the same way. '
  + 'Its score stands.';
const olderHtml = (r: BoardRow): string =>
  r.older ? ` <span class="dim chold" title="${esc(OLDER_TIP)}">played on older rules</span>` : '';

/** "met on turn 2, then 3 turns paying off 24 debt" */
const debtTip = (s: RunScore): string =>
  `Met the goal on turn ${s.turns - (s.debtTurns ?? 0)}, then ${plural(s.debtTurns ?? 0, 'turn')} paying off ${s.debt ?? 0} debt.`;

/** "Fastest: Tomzy · Leanest: Tomzy · Purest: Nyar" — a closed week's frozen winners */
function winnersHtml(b: BoardReply): string {
  if (!b.closed || !b.winners) return '';
  const ws = TROPHY_KINDS.flatMap(k => { const w = b.winners![k]; return w ? [`${BOARD_LABEL[k]}: <b>${esc(w.name)}</b>${olderHtml(w)}`] : []; });
  return ws.length ? `<p class="chwinners">Winners · ${ws.join(' · ')}</p>` : '';
}

const CARDS_TIP = 'Each card used counts once, and every copy past the second counts as one more.';

/** Owner, 2026-11-01: debt still owed when the goal is met costs the turns paying it off */
export const DEBT_RULE = 'Debt you still owe when you meet the goal adds the turns it would take to pay off: '
  + 'your open resources pay first, then each later turn pays with 2 more resources than the one before.';
const TURNS_TIP = `The turn you met the goal on, plus any turns paying off debt. ${DEBT_RULE}`;

function boardHtml(c: ChallengeView, v: ChallengePageView, past = false, backToWeek = false): string {
  const tab = v.tab;
  const b = v.boards[c.id];
  let body: string;
  if (!b || b === 'loading') body = '<p class="dim">Loading…</p>';
  else if (b === 'error') body = '<p class="dim">Could not load the leaderboard.</p>';
  else if (!b.boards.fastest.length) body = '<p class="dim">No runs yet.</p>';
  else {
    const first = FIRST[tab];
    // the column the tab sorts by: its head in accent, its numbers bold
    const col = (k: 'turns' | 'cards' | 'elements', label: string, tip?: string): TableColumn =>
      ({ key: k, label, headClassName: k === first ? 'chsorted' : undefined, title: tip });
    const td = (k: 'turns' | 'cards' | 'elements', val: string): { html: string } => ({ html: k === first ? `<b>${val}</b>` : val });
    const columns: TableColumn[] = [{ key: 'rank', label: '#' }, { key: 'player', label: 'player' },
      col('turns', 'Turns', TURNS_TIP), col('cards', 'Cards', CARDS_TIP), col('elements', 'Elements'),
      ...(b.closed ? [{ key: 'btns', label: '', spokenLabel: 'Try or watch', className: 'chrowbtns' }] : [])];
    body = `${winnersHtml(b)}
      ${tabs({ className: 'chtabs', dataBtn: 'ch-tab', active: tab,
        items: BOARD_KINDS.map(k => ({ id: k, label: BOARD_LABEL[k], title: BOARD_TIP[k] })) })}
      <p class="dim chtabtip">${esc(BOARD_TIP[tab])}</p>
      ${table({ className: 'chboard', columns, rows: b.boards[tab].map(r => ({ cells: {
        rank: r.rank, player: { html: `${esc(r.name)}${olderHtml(r)}` },
        turns: td('turns', `${r.score.turns}${r.score.debtTurns ? ` <span class="dim" title="${esc(debtTip(r.score))}">(+${r.score.debtTurns} debt)</span>` : ''}`),
        cards: td('cards', `${r.score.cards}${r.score.extra ? ` <span class="dim">(${r.score.extra} extra)</span>` : ''}`),
        elements: td('elements', String(r.score.elements)),
        btns: { html: `${r.deck ? `<button data-btn="ch-try" data-id="${esc(c.id)}" data-run="${esc(r.runId ?? '')}" title="load this deck into the builder">Try this deck</button>` : ''}${
          r.runId ? `<button data-btn="ch-watch" data-run="${esc(r.runId)}">Watch</button>` : ''}` },
      } })) })}`;
  }
  const head = past ? `${esc(c.title)} <span class="dim">· week of ${esc(c.week)}</span>${backToWeek
    ? ` <button class="chweekback" data-btn="ch-past" data-id="${esc(c.id)}">This week</button>` : ''}` : 'Leaderboard';
  return panel({ wide: !!b && b !== 'loading' && b !== 'error' && b.closed, className: 'chboardcard',
    titleHtml: head, bodyHtml: body });
}

function pastHtml(d: ChallengeReply, v: ChallengePageView): string {
  const pastOpen = v.pastOpen;
  if (!d.past.length) return '';
  return `${panel({ title: 'Past weeks', wide: true, bodyHtml: `
    ${/* rows of two lines, not a table: the list sits in the page's narrower
        left column (the app frame, 2026-11-04), where a week, a title and a
        count in columns wrapped word by word */ ''}<ul class="chpast">${d.past.map(c => `<li class="chpastrow${pastOpen === c.id ? ' on' : ''}">
      <div class="chpasttext"><b>${esc(c.title)}</b> <span class="dim">${esc(goalText(c.goal))}</span>
        <div class="dim chpastmeta">${esc(c.week)} · ${c.entrants} entrant${c.entrants === 1 ? '' : 's'}</div></div>
      <div class="chrowbtns"><button class="${pastOpen === c.id ? 'on' : ''}" aria-expanded="${pastOpen === c.id}" data-btn="ch-past" data-id="${esc(c.id)}">Leaderboard</button>
        <button data-btn="ch-build" data-id="${esc(c.id)}">Build</button></div>
    </li>`).join('')}</ul>
  ` })}`;
}

function keptHtml(v: ChallengePageView): string {
  const { arming } = v;
  if (!v.kept.length) return '';
  return panel({ title: 'Finished runs', wide: true, className: 'chkept', bodyHtml: `
    ${v.kept.map(({ run: r, st }) => {
      return `<div class="chkeptrow"><b>${esc(r.title)}</b> <span class="dim">${esc(scoreLine(r.score))}</span>
        ${st === 'sending' ? '<span class="dim">Submitting…</span>'
          : st && !st.ok ? `<span class="chproblem">${esc(st.error ?? 'could not submit')}</span>` : ''}
        ${v.canSubmit
          ? (st === 'sending' ? '' : `<button data-btn="ch-send" data-at="${r.at}">Submit</button>`)
          : '<button class="primary" data-btn="ch-signin">Sign in to submit</button>'}
        ${arming === `forget:${r.at}`
          ? `<button class="danger" data-btn="ch-forget" data-at="${r.at}">Press again to drop this run</button>`
          : `<button data-btn="ch-forget" data-at="${r.at}" title="drop this run" aria-label="Drop this run">✕</button>`}</div>`;
    }).join('')}
  ` });
}

// ── gathering ─────────────────────────────────────────────────────────

/** ui/challenge.ts's state, as it stands, that the page reads */
export interface ChallengeRaw {
  data: ChallengeReply | null;
  /** the home card's copy (the builder's challenge may be found there) */
  hint: ChallengeReply | null;
  loading: boolean;
  msg: string;
  msgTone: StatusTone;
  /** server clock minus ours */
  skew: number;
  tab: BoardKind;
  pastOpen: string | null;
  arming: string | null;
  boards: ReadonlyMap<string, BoardSlot>;
  sending: ReadonlyMap<number, 'sending' | SubmitReply>;
  /** the builder: which challenge, its list, the import picker, the undo on offer */
  building: string | null;
  list: readonly string[];
  importing: boolean;
  undo: { id: string; what: string } | null;
  /** the decks the builder can import (the collection's, else the home page's choice) */
  decks: () => { id: string; name: string; cards: string[] }[];
}

/** Gather everything the challenge page shows. */
export function challengePageView(r: ChallengeRaw): ChallengePageView {
  const known = allViews(r.data ?? r.hint);
  const viewOf = (id: string | null): ChallengeView | null => known.find(c => c.id === id) ?? null;
  const b = r.building ? viewOf(r.building) : null;
  return {
    data: r.data, loading: r.loading, msg: r.msg, msgTone: r.msgTone,
    now: Date.now() + r.skew,
    tab: r.tab, pastOpen: r.pastOpen, arming: r.arming,
    boards: Object.fromEntries(r.boards),
    building: b,
    builder: b ? { def: b, list: r.list, decks: r.decks(), importing: r.importing, undo: r.undo?.id === b.id ? r.undo.what : null } : null,
    kept: doneRuns().filter(x => viewOf(x.challengeId)).map(run => ({ run, st: r.sending.get(run.at) })),
    canSubmit: canSubmit(),
    chrome: frameChromeView(),
  };
}

/** Paint `v` into `app`, in the app frame: both columns keep their scroll
 * over a repaint. */
export function paintChallengePage(app: HTMLElement, v: ChallengePageView): void {
  paintFrame(app, challengePageHtml(v));
}
