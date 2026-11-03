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
 *   · ui/challenge.ts keeps the state, the fetches, the clicks, the hand-off
 *     to a run and the tabletop host.
 *
 * ("challengePage…", not "challenge…": `ChallengeView` is already the
 * server's name for one week's challenge, server/api-challenge.ts.)
 *
 * TODO(ds): view/html split: paint() stays in ui/challenge.ts. It must not
 * paint while the tabletop is up over the page (tt.screen()), and every
 * fetch that lands repaints; the state those read is that module's.
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
import { canSubmit, doneRuns, type DoneRun, type SubmitReply } from '../challengerun.ts';
import { esc } from '../util.ts';

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
}

export function challengePageHtml(v: ChallengePageView): string {
  const { data, msg, loading } = v;
  const cur = data?.current ?? null;
  const b = v.building;
  return `<div class="metapage chpage">
    <div class="accthead">
      <div><h1>Weekly challenge</h1>
        <p class="hint">Build a deck in order, then reach the goal using as few cards, elements and turns as you can.</p></div>
      <div class="accthbtns"><button data-btn="ch-close">Back</button></div>
    </div>
    ${msg ? `<div class="acctmsg">${esc(msg)}</div>` : ''}
    ${loading && !data ? '<p class="dim">Loading…</p>' : ''}
    <div class="acctbody">
      ${keptHtml(v)}
      ${b ? `${b.id !== cur?.id ? `<div class="acctcard wide"><h3>${esc(b.title)}</h3><p class="chgoal">${esc(goalText(b.goal))}</p>${
        b.closed ? '<p class="dim">This week is closed. A run still goes on its leaderboard.</p>' : ''}</div>` : ''}
        ${v.builder ? builderHtml(v.builder) : ''}` : ''}
      ${data && !cur ? '<div class="acctcard"><h3>No challenge this week</h3><p>Check back on Sunday.</p></div>' : ''}
      ${cur ? weekCardHtml(cur, v) : ''}
      ${cur ? boardHtml(cur, v) : ''}
      ${data ? pastHtml(data, v) : ''}
    </div>
  </div>`;
}

function bestHtml(id: string, v: ChallengePageView): string {
  const m = v.data?.mine?.[id];
  if (!m) return '';
  return `<h4>Your best</h4><table class="accttable chmine"><tbody>${BOARD_KINDS.map(k => `<tr>
    <td>${BOARD_LABEL[k]}</td><td><b>#${m[k].rank}</b></td><td class="dim">${esc(scoreLine(m[k].score))}</td></tr>`).join('')}</tbody></table>`;
}

function weekCardHtml(c: ChallengeView, v: ChallengePageView): string {
  return `<div class="acctcard chweek">
    <h3>${esc(c.title)}</h3>
    <p class="chgoal">${esc(goalText(c.goal))}</p>
    ${setupLines(c.setup).map(l => `<p class="chsetup">${esc(l)}</p>`).join('')}
    ${c.blurb ? `<p>${esc(c.blurb)}</p>` : ''}
    <p class="dim">${esc(timeLeft(c.closes, v.now))} · ${c.entrants} entrant${c.entrants === 1 ? '' : 's'}</p>
    <p class="dim">Three first places: fewest turns, fewest cards, fewest elements.</p>
    <p class="dim">${esc(DEBT_RULE)}</p>
    ${bestHtml(c.id, v)}
    ${v.building?.id === c.id ? '' : `<p><button class="primary" data-btn="ch-build" data-id="${esc(c.id)}">Build a deck</button></p>`}
  </div>`;
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

function boardHtml(c: ChallengeView, v: ChallengePageView, past = false): string {
  const tab = v.tab;
  const b = v.boards[c.id];
  let body: string;
  if (!b || b === 'loading') body = '<p class="dim">Loading…</p>';
  else if (b === 'error') body = '<p class="dim">Could not load the leaderboard.</p>';
  else if (!b.boards.fastest.length) body = '<p class="dim">No runs yet.</p>';
  else {
    const first = FIRST[tab];
    const th = (k: 'turns' | 'cards' | 'elements', label: string, tip = ''): string =>
      `<th${k === first ? ' class="chsorted"' : ''}${tip ? ` title="${esc(tip)}"` : ''}>${label}</th>`;
    const td = (k: 'turns' | 'cards' | 'elements', val: string): string => `<td>${k === first ? `<b>${val}</b>` : val}</td>`;
    body = `${winnersHtml(b)}
      <div class="chtabs" role="tablist">${BOARD_KINDS.map(k => `<button role="tab" aria-selected="${k === tab}" class="${
        k === tab ? 'on' : ''}" data-btn="ch-tab" data-tab="${k}" title="${esc(BOARD_TIP[k])}">${BOARD_LABEL[k]}</button>`).join('')}</div>
      <p class="dim chtabtip">${esc(BOARD_TIP[tab])}</p>
      <table class="accttable chboard"><thead><tr><th>#</th><th>player</th>${th('turns', 'Turns', TURNS_TIP)}${th('cards', 'Cards', CARDS_TIP)}${th('elements', 'Elements')}${
        b.closed ? '<th></th>' : ''}</tr></thead>
      <tbody>${b.boards[tab].map(r => `<tr><td>${r.rank}</td><td>${esc(r.name)}${olderHtml(r)}</td>${td('turns', `${r.score.turns}${r.score.debtTurns ? ` <span class="dim" title="${esc(debtTip(r.score))}">(+${r.score.debtTurns} debt)</span>` : ''}`)}${
        td('cards', `${r.score.cards}${r.score.extra ? ` <span class="dim">(${r.score.extra} extra)</span>` : ''}`)}${td('elements', String(r.score.elements))}${
        b.closed ? `<td class="chrowbtns">${r.deck ? `<button data-btn="ch-try" data-id="${esc(c.id)}" data-run="${esc(r.runId ?? '')}" title="load this deck into the builder">Try this deck</button>` : ''}${
          r.runId ? `<button data-btn="ch-watch" data-run="${esc(r.runId)}">Watch</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  }
  const head = past ? `${esc(c.title)} <span class="dim">· week of ${esc(c.week)}</span>` : 'Leaderboard';
  return `<div class="acctcard${b && b !== 'loading' && b !== 'error' && b.closed ? ' wide' : ''} chboardcard"><h3>${head}</h3>${body}</div>`;
}

function pastHtml(d: ChallengeReply, v: ChallengePageView): string {
  const pastOpen = v.pastOpen;
  if (!d.past.length) return '';
  return `<div class="acctcard wide"><h3>Past weeks</h3>
    <table class="accttable chpast"><tbody>${d.past.map(c => `<tr>
      <td>${esc(c.week)}</td><td><b>${esc(c.title)}</b> <span class="dim">${esc(goalText(c.goal))}</span></td>
      <td class="dim">${c.entrants} entrant${c.entrants === 1 ? '' : 's'}</td>
      <td class="chrowbtns"><button class="${pastOpen === c.id ? 'on' : ''}" data-btn="ch-past" data-id="${esc(c.id)}">Leaderboard</button>
        <button data-btn="ch-build" data-id="${esc(c.id)}">Build</button></td></tr>`).join('')}</tbody></table>
  </div>${pastOpen ? ((): string => { const c = d.past.find(x => x.id === pastOpen); return c ? boardHtml(c, v, true) : ''; })() : ''}`;
}

function keptHtml(v: ChallengePageView): string {
  const { arming } = v;
  if (!v.kept.length) return '';
  return `<div class="acctcard wide chkept"><h3>Finished runs</h3>
    ${v.kept.map(({ run: r, st }) => {
      return `<div class="chkeptrow"><b>${esc(r.title)}</b> <span class="dim">${esc(scoreLine(r.score))}</span>
        ${st === 'sending' ? '<span class="dim">Submitting…</span>'
          : st && !st.ok ? `<span class="chproblem">${esc(st.error ?? 'could not submit')}</span>` : ''}
        ${v.canSubmit
          ? (st === 'sending' ? '' : `<button data-btn="ch-send" data-at="${r.at}">Submit</button>`)
          : '<button class="primary" data-btn="ch-signin">Sign in to submit</button>'}
        ${arming === `forget:${r.at}`
          ? `<button class="danger" data-btn="ch-forget" data-at="${r.at}">Press again to drop this run</button>`
          : `<button data-btn="ch-forget" data-at="${r.at}" title="drop this run">✕</button>`}</div>`;
    }).join('')}
  </div>`;
}

// ── gathering ─────────────────────────────────────────────────────────

/** ui/challenge.ts's state, as it stands, that the page reads */
export interface ChallengeRaw {
  data: ChallengeReply | null;
  /** the home card's copy (the builder's challenge may be found there) */
  hint: ChallengeReply | null;
  loading: boolean;
  msg: string;
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
    data: r.data, loading: r.loading, msg: r.msg,
    now: Date.now() + r.skew,
    tab: r.tab, pastOpen: r.pastOpen, arming: r.arming,
    boards: Object.fromEntries(r.boards),
    building: b,
    builder: b ? { def: b, list: r.list, decks: r.decks(), importing: r.importing, undo: r.undo?.id === b.id ? r.undo.what : null } : null,
    kept: doneRuns().filter(x => viewOf(x.challengeId)).map(run => ({ run, st: r.sending.get(run.at) })),
    canSubmit: canSubmit(),
  };
}
