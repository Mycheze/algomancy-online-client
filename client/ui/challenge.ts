/* THE WEEKLY CHALLENGE PAGE (docs/21-weekly-challenges.md § Browser).
 *
 * Same contract as ui/league.ts and ui/meta.ts, which main.ts already drives:
 * screen() says whether this page owns the app element, renderScreen() paints
 * it, handleButton() is offered every click (everything here is `ch-`), and
 * the state lives in this file. `?challenge` opens it, and so does the
 * `nav-challenge` button — the owner uses an installed web app with no
 * address bar, so a page reachable only by URL is a page he cannot reach.
 *
 * Everything shown is the server's answer (server/api-challenge.ts): the
 * week, its four leaderboards, the caller's best on each. The two things this page
 * owns are the BUILDER (ui/challengebuild.ts, an ordered deck kept per
 * challenge in this browser) and the hand-off to a run (ui/challengerun.ts,
 * which main.ts opens at `?challenge=play`).
 *
 * The builder here is a summary — the deck's rows, its Turn-1 hand, Import,
 * Clear, Undo and Play — and a "Build on the table" button. The deck is built
 * on the tabletop (ui/tabletop.ts), which this page hosts as kind
 * `challenge`: a scratch table of piles on top (cards being considered, kept
 * in this browser, NOT in the deck) and the deck itself as a strip below,
 * left to right = top to bottom (ui/deckstrip.ts). The table sits on top of
 * this page, which stays `open` under it, so Back is a repaint of it.
 *
 * The home page's card and the header button are drawn from one fetch of
 * GET /api/challenge, asked the first time the home page draws and never at
 * boot: a game or replay link makes no request it has no use for.
 */
import type { CardName } from '../engine/src/types.ts';
import {
  BOARD_KINDS, TROPHY_KINDS, goalText, type BoardKind, type ChallengeDef, type RunScore,
} from '../engine/src/challenge.ts';
import * as acct from './account.ts';
import * as cb from './cards.ts';
import { deckStripHtml } from './cardpanel.ts';
import * as dk from './decks.ts';
import {
  bridgeFor, builderHtml, deckProblem, loadDraft, loadScratch, openingHand, saveDraft, saveScratch, summaryOf,
} from './challengebuild.ts';
import { challengeStripHtml } from './deckstrip.ts';
import { cardHeight, cardWidth } from './piletable.ts';
import * as tt from './tabletop.ts';
import {
  canSubmit, doneRuns, forgetDone, freshRun, submitRun, type DoneRun, type SubmitReply,
} from './challengerun.ts';
import { chosenDeck, esc } from './util.ts';

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

// ── module state ──────────────────────────────────────────────────────

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let open = false;
let data: ChallengeReply | null = null;
/** the session token `data` was asked with: a sign-in asks again (for `mine`) */
let dataFor: string | null | undefined;
/** server clock minus ours, from the last answer, so "time left" is the server's */
let skew = 0;
let loading = false;
let msg = '';
/** the home card's copy, and the token it was asked with */
let hint: ChallengeReply | null = null;
let hintFor: string | null | undefined;
/** leaderboards, by challenge id */
const boards = new Map<string, BoardReply | 'loading' | 'error'>();
/** the board on show (one choice for every week's leaderboard) */
let tab: BoardKind = 'fastest';
/** the past week whose board is unfolded */
let pastOpen: string | null = null;
/** the builder: which challenge it builds for, and its list */
let building: string | null = null;
let list: string[] = [];
let importing = false;
/** one step back from a replace (import, clear, try this deck): the list
 * before it, for that challenge, and what to call it. Any other edit drops it. */
let undo: { id: string; list: string[]; what: string } | null = null;
/** a kept run's upload, by its `at` */
const sending = new Map<number, 'sending' | SubmitReply>();
/** a `?table=ch:<id>` reload waiting for the challenges to load */
let tableWanted: string | null = null;

export const screen = (): 'challenge' | null => (open ? 'challenge' : null);

export function initChallenge(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  const url = new URLSearchParams(location.search);
  const v = url.get('challenge');
  // `?challenge=play` and `?challenge=watch` are game pages main.ts opens
  if (url.has('challenge') && v !== 'play' && v !== 'watch') {
    open = true;
    if (v && v !== '1') building = v;
    // back from Watch: that week's board, unfolded
    pastOpen = url.get('board');
    load();
    // a run's goal panel, signed out: the sign-in form, then this page, which
    // submits the kept run (sendKept) once there is an account
    if (url.get('signin') === '1') acct.signInThenReturn();
  }
}

/** the challenges this page knows, newest first */
const allViews = (d: ChallengeReply | null): ChallengeView[] => (d ? [...(d.current ? [d.current] : []), ...d.past] : []);
const viewOf = (id: string | null): ChallengeView | null => allViews(data ?? hint).find(c => c.id === id) ?? null;

function load(): void {
  loading = true;
  const tok = acct.token();
  fetch('/api/challenge', { headers: acct.authHeaders(false) })
    .then(r => r.json() as Promise<ChallengeReply>)
    .then(r => {
      loading = false;
      if (!r || typeof r.now !== 'number') { msg = 'could not load the challenges'; paint(); return; }
      data = r; dataFor = tok;
      hint = r; hintFor = tok;
      skew = r.now - Date.now();
      if (building && !viewOf(building)) building = null;
      if (building && !list.length) list = loadDraft(building);
      if (pastOpen && !r.past.some(c => c.id === pastOpen)) pastOpen = null;
      if (pastOpen && !boards.has(pastOpen)) loadBoard(pastOpen);
      const cur = r.current;
      if (cur && !boards.has(cur.id)) loadBoard(cur.id);
      sendKept();
      // a reload on the table: it opens now that its challenge is known (or
      // the table gives up on it, and this page shows)
      const want = tableWanted;
      tableWanted = null;
      if (want) { const h = tabletopHostFor(want); if (h) { tt.openTabletop(h); return; } rerenderHost(); return; }
      paint();
    })
    .catch(() => { loading = false; msg = 'could not reach the server'; paint(); });
}

/** The home card's data, asked the first time the home page draws. */
function askHint(): void {
  const tok = acct.token();
  if (hintFor === tok) return;
  hintFor = tok;
  fetch('/api/challenge', { headers: acct.authHeaders(false) })
    .then(r => r.json() as Promise<ChallengeReply>)
    .then(r => {
      if (!r || typeof r.now !== 'number') return;
      const had = !!hint;
      hint = r;
      skew = r.now - Date.now();
      if ((had || r.current || r.past.length) && !open) rerenderHost();
    })
    .catch(() => { /* no server, no card */ });
}

function loadBoard(id: string): void {
  boards.set(id, 'loading');
  fetch(`/api/challenge/${encodeURIComponent(id)}/board`)
    .then(r => r.json() as Promise<BoardReply>)
    .then(r => { boards.set(id, r && r.boards && Array.isArray(r.boards.fastest) ? r : 'error'); paint(); })
    .catch(() => { boards.set(id, 'error'); paint(); });
}

/** Runs finished in this browser and not on a board yet: send them once
 * there is a named account to send them as. */
function sendKept(): void {
  if (!canSubmit()) return;
  for (const d of doneRuns()) {
    if (sending.has(d.at) || !viewOf(d.challengeId)) continue;
    sending.set(d.at, 'sending');
    void submitRun(d).then(r => {
      sending.set(d.at, r);
      if (r.ok) {
        forgetDone(d.at);
        boards.delete(d.challengeId);
        load();
      } else paint();
    });
  }
}

export function openChallenge(build?: string): void {
  open = true; msg = ''; importing = false;
  if (build !== undefined) { building = build; list = loadDraft(build); }
  syncUrl();
  load();
  paint();
}

/** Something about the challenges changed (a sign-in): ask again. */
export function refresh(): void {
  if (open) load();
  hintFor = undefined;
}

function close(): void {
  open = false; importing = false;
  syncUrl();
  rerenderHost();
}

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('challenge');
    url.searchParams.delete('board');
    url.searchParams.delete('signin');
    if (open) url.searchParams.set('challenge', building ?? '1');
    history.replaceState(null, '', url.toString());
  } catch { /* file:// */ }
}

// ── formatting ────────────────────────────────────────────────────────

/** "3d 4h left", "5h 12m left" — the server's clock, not this machine's */
export function timeLeft(closes: number, now = Date.now() + skew): string {
  const ms = Math.max(0, closes - now);
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (ms <= 0) return 'closed';
  return d ? `${d}d ${h % 24}h left` : h ? `${h}h ${m % 60}m left` : `${Math.max(1, m)}m left`;
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "12 cards (2 extra)", the extra copies only when there are any */
const cardsText = (s: RunScore): string => `${plural(s.cards, 'card')}${s.extra ? ` (${s.extra} extra)` : ''}`;

const scoreLine = (s: RunScore): string =>
  `${plural(s.turns, 'turn')} · ${cardsText(s)} · ${plural(s.elements, 'element')}`;

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

/** The header's way in, while there is a challenge to show. */
export function navButtonHtml(): string {
  askHint();
  if (!hint || (!hint.current && !hint.past.length)) return '';
  return '<button class="homedecks" data-btn="nav-challenge">🧩 Challenge</button>';
}

/** "This week's challenge": hidden when there is none or no server. */
export function homeCardHtml(): string {
  askHint();
  const c = hint?.current;
  if (!c) return '';
  const best = hint?.mine?.[c.id]?.fastest;
  return `<div class="homecard chhome">
    <h2>This week's challenge</h2>
    <p class="cardsub"><b>${esc(goalText(c.goal))}</b></p>
    <p class="cardsub">${esc(timeLeft(c.closes))}${best ? ` · your best: ${plural(best.score.turns, 'turn')} (#${best.rank} fastest)` : ''}</p>
    <div class="spacer"></div>
    <button class="cta primary" data-btn="ch-home-play" data-id="${esc(c.id)}">Play</button>
  </div>`;
}

// ── the page ──────────────────────────────────────────────────────────

function bestHtml(id: string): string {
  const m = data?.mine?.[id];
  if (!m) return '';
  return `<h4>Your best</h4><table class="accttable chmine"><tbody>${BOARD_KINDS.map(k => `<tr>
    <td>${BOARD_LABEL[k]}</td><td><b>#${m[k].rank}</b></td><td class="dim">${esc(scoreLine(m[k].score))}</td></tr>`).join('')}</tbody></table>`;
}

function weekCardHtml(c: ChallengeView): string {
  return `<div class="acctcard chweek">
    <h3>${esc(c.title)}</h3>
    <p class="chgoal">${esc(goalText(c.goal))}</p>
    ${c.blurb ? `<p>${esc(c.blurb)}</p>` : ''}
    <p class="dim">${esc(timeLeft(c.closes))} · ${c.entrants} entrant${c.entrants === 1 ? '' : 's'}</p>
    <p class="dim">Three first places: fewest turns, fewest cards, fewest elements.</p>
    ${bestHtml(c.id)}
    ${building === c.id ? '' : `<p><button class="primary" data-btn="ch-build" data-id="${esc(c.id)}">Build a deck</button></p>`}
  </div>`;
}

/** Owner, 2026-10-23: "Flag it, still ranked". A run the rules have moved
 * under keeps its score and rank; the board says so, in a player's words. */
const OLDER_TIP = 'The rules have changed since this run was played: replayed today, it would not go the same way. '
  + 'Its score stands.';
const olderHtml = (r: BoardRow): string =>
  r.older ? ` <span class="dim chold" title="${esc(OLDER_TIP)}">played on older rules</span>` : '';

/** "Fastest: Tomzy · Leanest: Tomzy · Purest: Nyar" — a closed week's frozen winners */
function winnersHtml(b: BoardReply): string {
  if (!b.closed || !b.winners) return '';
  const ws = TROPHY_KINDS.flatMap(k => { const w = b.winners![k]; return w ? [`${BOARD_LABEL[k]}: <b>${esc(w.name)}</b>${olderHtml(w)}`] : []; });
  return ws.length ? `<p class="chwinners">Winners · ${ws.join(' · ')}</p>` : '';
}

const CARDS_TIP = 'Each card used counts once, and every copy past the second counts as one more.';

function boardHtml(c: ChallengeView, past = false): string {
  const b = boards.get(c.id);
  let body: string;
  if (!b || b === 'loading') body = '<p class="dim">Loading…</p>';
  else if (b === 'error') body = '<p class="dim">Could not load the leaderboard.</p>';
  else if (!b.boards.fastest.length) body = '<p class="dim">No runs yet.</p>';
  else {
    const first = FIRST[tab];
    const th = (k: 'turns' | 'cards' | 'elements', label: string, tip = ''): string =>
      `<th${k === first ? ' class="chsorted"' : ''}${tip ? ` title="${esc(tip)}"` : ''}>${label}</th>`;
    const td = (k: 'turns' | 'cards' | 'elements', v: string): string => `<td>${k === first ? `<b>${v}</b>` : v}</td>`;
    body = `${winnersHtml(b)}
      <div class="chtabs" role="tablist">${BOARD_KINDS.map(k => `<button role="tab" aria-selected="${k === tab}" class="${
        k === tab ? 'on' : ''}" data-btn="ch-tab" data-tab="${k}" title="${esc(BOARD_TIP[k])}">${BOARD_LABEL[k]}</button>`).join('')}</div>
      <p class="dim chtabtip">${esc(BOARD_TIP[tab])}</p>
      <table class="accttable chboard"><thead><tr><th>#</th><th>player</th>${th('turns', 'Turns')}${th('cards', 'Cards', CARDS_TIP)}${th('elements', 'Elements')}${
        b.closed ? '<th></th>' : ''}</tr></thead>
      <tbody>${b.boards[tab].map(r => `<tr><td>${r.rank}</td><td>${esc(r.name)}${olderHtml(r)}</td>${td('turns', String(r.score.turns))}${
        td('cards', `${r.score.cards}${r.score.extra ? ` <span class="dim">(${r.score.extra} extra)</span>` : ''}`)}${td('elements', String(r.score.elements))}${
        b.closed ? `<td class="chrowbtns">${r.deck ? `<button data-btn="ch-try" data-id="${esc(c.id)}" data-run="${esc(r.runId ?? '')}" title="load this deck into the builder">Try this deck</button>` : ''}${
          r.runId ? `<button data-btn="ch-watch" data-run="${esc(r.runId)}">Watch</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  }
  const head = past ? `${esc(c.title)} <span class="dim">· week of ${esc(c.week)}</span>` : 'Leaderboard';
  return `<div class="acctcard${b && b !== 'loading' && b !== 'error' && b.closed ? ' wide' : ''} chboardcard"><h3>${head}</h3>${body}</div>`;
}

function pastHtml(d: ChallengeReply): string {
  if (!d.past.length) return '';
  return `<div class="acctcard wide"><h3>Past weeks</h3>
    <table class="accttable chpast"><tbody>${d.past.map(c => `<tr>
      <td>${esc(c.week)}</td><td><b>${esc(c.title)}</b> <span class="dim">${esc(goalText(c.goal))}</span></td>
      <td class="dim">${c.entrants} entrant${c.entrants === 1 ? '' : 's'}</td>
      <td class="chrowbtns"><button class="${pastOpen === c.id ? 'on' : ''}" data-btn="ch-past" data-id="${esc(c.id)}">Leaderboard</button>
        <button data-btn="ch-build" data-id="${esc(c.id)}">Build</button></td></tr>`).join('')}</tbody></table>
  </div>${pastOpen ? ((): string => { const c = d.past.find(x => x.id === pastOpen); return c ? boardHtml(c, true) : ''; })() : ''}`;
}

function keptHtml(): string {
  const kept = doneRuns().filter(r => viewOf(r.challengeId));
  if (!kept.length) return '';
  return `<div class="acctcard wide chkept"><h3>Finished runs</h3>
    ${kept.map(r => {
      const st = sending.get(r.at);
      return `<div class="chkeptrow"><b>${esc(r.title)}</b> <span class="dim">${esc(scoreLine(r.score))}</span>
        ${st === 'sending' ? '<span class="dim">Submitting…</span>'
          : st && !st.ok ? `<span class="chproblem">${esc(st.error ?? 'could not submit')}</span>` : ''}
        ${canSubmit()
          ? (st === 'sending' ? '' : `<button data-btn="ch-send" data-at="${r.at}">Submit</button>`)
          : '<button class="primary" data-btn="ch-signin">Sign in to submit</button>'}
        <button data-btn="ch-forget" data-at="${r.at}" title="drop this run">✕</button></div>`;
    }).join('')}
  </div>`;
}

/** the builder's decks to import: the collection's, else the one chosen on the home page */
function importable(): { id: string; name: string; cards: string[] }[] {
  const mine = dk.playableDecks();
  if (mine.length) return mine.map(d => ({ id: d.id, name: d.name, cards: d.cards }));
  const c = chosenDeck();
  return c ? [{ id: '__chosen', name: c.name, cards: c.cards }] : [];
}

function paint(): void {
  if (!$app || !open) return;
  // the tabletop is up over this page: a commit there must not paint this
  // page over it (and it never paints under a drag that way either)
  if (tt.screen()) return;
  $app.classList.remove('board');
  const cur = data?.current ?? null;
  const b = building ? viewOf(building) : null;
  $app.innerHTML = `<div class="metapage chpage">
    <div class="accthead">
      <div><h1>Weekly challenge</h1>
        <p class="hint">Build a deck in order, then reach the goal using as few cards, elements and turns as you can.</p></div>
      <div class="accthbtns"><button data-btn="ch-close">Back</button></div>
    </div>
    ${msg ? `<div class="acctmsg">${esc(msg)}</div>` : ''}
    ${loading && !data ? '<p class="dim">Loading…</p>' : ''}
    <div class="acctbody">
      ${keptHtml()}
      ${b ? `${b.id !== cur?.id ? `<div class="acctcard wide"><h3>${esc(b.title)}</h3><p class="chgoal">${esc(goalText(b.goal))}</p>${
        b.closed ? '<p class="dim">This week is closed. A run still goes on its leaderboard.</p>' : ''}</div>` : ''}
        ${builderHtml({ def: b, list, decks: importable(), importing, undo: undo?.id === b.id ? undo.what : null })}` : ''}
      ${data && !cur ? '<div class="acctcard"><h3>No challenge this week</h3><p>Check back on Sunday.</p></div>' : ''}
      ${cur ? weekCardHtml(cur) : ''}
      ${cur ? boardHtml(cur) : ''}
      ${data ? pastHtml(data) : ''}
    </div>
  </div>`;
}

function setList(next: string[], replacing?: string): void {
  undo = replacing && building ? { id: building, list: [...list], what: replacing } : null;
  list = next;
  if (building) saveDraft(building, list);
  paint();
}

/** Start a run of the builder's deck: saved for `?challenge=play`, then go. */
function play(id: string): void {
  const def = viewOf(id);
  if (!def) return;
  freshRun({ id: def.id, week: def.week, title: def.title, blurb: def.blurb, goal: def.goal, seed: def.seed, par: def.par }, list);
  location.search = `?challenge=play&id=${encodeURIComponent(id)}`;
}

// ── clicks ────────────────────────────────────────────────────────────

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('ch-')) return false;
  const id = btn.dataset['id'] ?? '';
  if (b !== 'ch-import' && b !== 'ch-importdeck') importing = false;
  switch (b) {
    case 'ch-home-play': openChallenge(id || hint?.current?.id); return true;
    case 'ch-close': close(); return true;
    case 'ch-build': building = id; list = loadDraft(id); syncUrl(); paint(); return true;
    case 'ch-past':
      pastOpen = pastOpen === id ? null : id;
      if (pastOpen && !boards.has(id)) loadBoard(id);
      paint();
      return true;
    case 'ch-try': {
      const bd = boards.get(id);
      const row = bd && typeof bd === 'object' ? BOARD_KINDS.flatMap(k => bd.boards[k]).find(r => r.runId === btn.dataset['run']) : null;
      if (!row?.deck) return true;
      if (building !== id) { building = id; list = loadDraft(id); }
      setList([...row.deck], `Loaded ${row.name}'s deck.`);
      syncUrl();
      return true;
    }
    case 'ch-tab': {
      const t = btn.dataset['tab'] as BoardKind;
      if (BOARD_KINDS.includes(t)) { tab = t; paint(); }
      return true;
    }
    case 'ch-watch':
      location.search = `?challenge=watch&run=${encodeURIComponent(btn.dataset['run'] ?? '')}`;
      return true;
    case 'ch-clear': setList([], 'Cleared.'); return true;
    case 'ch-undo':
      if (undo && undo.id === building) { const back = undo.list; setList(back); }
      return true;
    case 'ch-import': importing = !importing; if (importing) dk.ensureCollection(paint); paint(); return true;
    case 'ch-importdeck': {
      const d = importable().find(x => x.id === btn.dataset['id']);
      importing = false;
      if (d) setList([...d.cards], `Imported ${d.name}.`); else paint();
      return true;
    }
    case 'ch-tabletop': {
      const h = building ? tabletopHostFor(building) : null;
      if (h) tt.openTabletop(h);
      return true;
    }
    case 'ch-play': if (building) play(building); return true;
    case 'ch-send': {
      const d = doneRuns().find(x => x.at === Number(btn.dataset['at']));
      if (d) { sending.delete(d.at); sendOne(d); }
      return true;
    }
    case 'ch-forget': forgetDone(Number(btn.dataset['at'])); paint(); return true;
    case 'ch-signin': acct.signInThenReturn(); return true;
  }
  return false;
}

function sendOne(d: DoneRun): void {
  sending.set(d.at, 'sending');
  paint();
  void submitRun(d).then(r => {
    sending.set(d.at, r);
    if (r.ok) { forgetDone(d.at); boards.clear(); load(); } else paint();
  });
}

export function renderScreen(): void {
  if (data && !loading && dataFor !== acct.token()) load();
  paint();
}

/** test seam: the builder's list as it stands */
export const builderList = (): readonly string[] => list;

// ── the tabletop (ui/tabletop.ts): the challenge host ──────────────────

/** the card width and height the table draws at — the tabletop's own rule
 * (ui/piletable.ts), so the strip's cards are the piles' cards */
function cardSize(): { cw: number; ch: number } {
  const touch = typeof document !== 'undefined' && !!document.documentElement?.classList?.contains?.('touch');
  const cw = cardWidth({ touch, width: typeof innerWidth === 'number' ? innerWidth : 1200 });
  return { cw, ch: cardHeight(cw) };
}

/**
 * The table for challenge `id`'s builder: the strip is the draft deck (every
 * edit through setList, so it is saved and ends the Undo like any other), the
 * piles are the scratch table (this browser only, never the deck).
 */
function tableHost(id: string): tt.TableHost {
  const def = (): ChallengeView | null => viewOf(id);
  const self: tt.TableHost = {
    kind: 'challenge',
    key: `ch:${id}`,
    title: () => def()?.title ?? 'this challenge',
    backLabel: 'Back to the challenge',
    cards: () => (building === id ? list : loadDraft(id)),
    piles: () => loadScratch(id),
    strip: () => {
      const d = def();
      return `${deckStripHtml(d?.title ?? 'this challenge', summaryOf(self.cards()), { lead: 'Challenge' })}
        <p class="ttchnote dim">${d ? `${esc(goalText(d.goal))} · ` : ''}Cards on the table are not in the deck. The table is saved in this browser only.</p>`;
    },
    below: () => {
      const l = self.cards();
      const d = def();
      const problem = deckProblem(l);
      const hand = d && !problem ? openingHand(d, l) : null;
      const c = tt.selected(self);
      return challengeStripHtml({
        list: l, hand: hand ? hand.length : null, problem, ...cardSize(),
        front: tt.frontIn('strip'), picked: c?.from === 'strip' ? c.index : undefined,
      });
    },
    commit: next => {
      if (building !== id) return;
      if ('piles' in next) saveScratch(id, next.piles ?? null);
      if (next.cards) setList(next.cards);
      tt.tabletopChanged();
    },
    // the table has already left the screen, so this paints the page
    close: () => { open = true; building = id; syncUrl(); paint(); },
    fullBrowser: query => {
      const d = def();
      if (!d) return;
      cb.useDeck(bridgeFor({
        title: d.title, list: () => list,
        set: l => { if (building === id) setList(l); },
        // back to the table (it is still up under the browser)
        back: () => { cb.useDeck(null); rerenderHost(); },
      }));
      cb.openBrowser(query);
    },
  };
  return self;
}

/**
 * The tabletop for challenge `id`, with this page opened under it (so Back
 * lands on that challenge's builder) — or null: not known yet (the page is
 * loading, and opens the table itself when the answer lands) or no such
 * challenge. main.ts registers this for a reload on `?table=ch:<id>`.
 */
export function tabletopHostFor(id: string): tt.TableHost | null {
  if (!open) { open = true; building = id; list = loadDraft(id); syncUrl(); }
  if (!data) {
    tableWanted = id;
    if (!loading) load();
    return null;
  }
  if (!viewOf(id)) return null;
  if (building !== id) { building = id; list = loadDraft(id); syncUrl(); }
  importing = false;
  return tableHost(id);
}
