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
 * on the tabletop (ui/tabletop.ts, the builder in the app frame), which this
 * page hosts as kind `challenge`: the pool over a scratch table of piles
 * (cards being considered, kept in this browser, NOT in the deck) and the
 * deck itself as a strip along the bottom, left to right = top to bottom
 * (ui/deckstrip.ts). A pool tap adds to the END of the strip. The toolbar has
 * the count pill, Import a deck (a side sheet) and Play; Undo and Redo are
 * the builder's. The table sits on top of this page, which stays `open` under
 * it, so Back is a repaint of it.
 *
 * The home page's card and the header button are drawn from one fetch of
 * GET /api/challenge, asked the first time the home page draws and never at
 * boot: a game or replay link makes no request it has no use for.
 *
 * The markup is pages/challenge.ts's (the design-system round, 2026-11-03):
 * challengePageView() gathers this file's state, challengePageHtml() draws
 * it, and so for the home card and the header button.
 */
import { BOARD_KINDS, goalText, type BoardKind } from '../engine/src/challenge.ts';
import * as acct from './account.ts';
import { sheet } from './components/sheet.ts';
import * as dk from './decks.ts';
import {
  deckProblem, importListHtml, loadDraft, loadScratch, openingHand, saveDraft, saveScratch, tableNoteHtml, tablePill, tableToolsHtml,
} from './challengebuild.ts';
import { challengeStripHtml } from './deckstrip.ts';
import { cardHeight, cardWidth } from './piletable.ts';
import * as tt from './tabletop.ts';
import {
  canSubmit, doneRuns, forgetDone, freshRun, submitRun, type DoneRun, type SubmitReply,
} from './challengerun.ts';
import { chosenDeck } from './util.ts';
import {
  allViews, challengeGlanceHtml, challengeHomeCardHtml, challengeHomeView, challengeNavHtml, challengePageHtml, challengePageView,
  type BoardReply, type ChallengeReply, type ChallengeView,
} from './pages/challenge.ts';

export {
  BOARD_LABEL, DEBT_RULE, type BoardReply, type BoardRow, type ChallengeReply, type ChallengeView, type MyBest,
} from './pages/challenge.ts';
import { paintFrame } from './pages/frame.ts';
import type { StatusTone } from './components/status.ts';

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
/** how `msg` reads: a result (ok), a refusal (error) — set only through say() */
let msgTone: StatusTone = 'error';
const say = (text: string, tone: StatusTone): void => { msg = text; msgTone = tone; loadMissed = false; };
/** BL-10 (docs/23-ui-inventory/02 §8.5 item 28, "the league `msg` never clears"):
 * the line is a LOAD that failed, not something the player did — so the next
 * load that works takes it away (a refusal or a result stays: say() resets this) */
let loadMissed = false;
const missed = (text: string): void => { say(text, 'error'); loadMissed = true; };
/** a load worked: a load's own failure line is no longer true */
const loaded = (): void => { if (loadMissed) { msg = ''; loadMissed = false; } };
/** the home card's copy, and the token it was asked with */
let hint: ChallengeReply | null = null;
let hintFor: string | null | undefined;
/** BL-10 (docs/23-ui-inventory/01 §4 S16): the home's ask went unanswered —
 * it threw, or the reply was no challenge answer — and when; the card says it
 * could not load the challenge, and the next home draw HINT_RETRY_MS on asks
 * again. Same shape as league.ts. */
let hintMissedAt: number | null = null;
export const HINT_RETRY_MS = 15_000;
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
/** owner 2026-11-02 ("data-losing only"): dropping a kept run asks twice, the
 * league's press-again pattern (league.ts `arming`, `button.danger`). The key
 * is `forget:<at>`; any other ch- button disarms it. test/901. */
let arming: string | null = null;
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


/** the challenges this page knows: the page's answer, else the home card's */
const viewOf = (id: string | null): ChallengeView | null => allViews(data ?? hint).find(c => c.id === id) ?? null;

function load(): void {
  loading = true;
  const tok = acct.token();
  fetch('/api/challenge', { headers: acct.authHeaders(false) })
    .then(r => r.json() as Promise<ChallengeReply>)
    .then(r => {
      loading = false;
      if (!r || typeof r.now !== 'number') { missed('could not load the challenges'); paint(); return; }
      loaded();
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
    .catch(() => { loading = false; missed('could not reach the server'); paint(); });
}

/** The home card's data, asked the first time the home page draws. */
function askHint(): void {
  const tok = acct.token();
  if (hintFor === tok && (hintMissedAt === null || Date.now() - hintMissedAt < HINT_RETRY_MS)) return;
  hintFor = tok;
  const missed = (): void => {
    const was = hintMissedAt !== null;
    hintMissedAt = Date.now();
    // one repaint per flip, none while it stays down
    if (!was && !hint && !open) rerenderHost();
  };
  fetch('/api/challenge', { headers: acct.authHeaders(false) })
    .then(r => r.json() as Promise<ChallengeReply>)
    .then(r => {
      if (!r || typeof r.now !== 'number') { missed(); return; }
      const had = !!hint || hintMissedAt !== null;
      hintMissedAt = null;
      hint = r;
      skew = r.now - Date.now();
      if ((had || r.current || r.past.length) && !open) rerenderHost();
    })
    .catch(missed);
}

/** The home's Challenge card could not get an answer and has nothing older to
 * show: it says so (pages/home.ts) rather than "No challenge this week". */
export function hintUnreachable(): boolean {
  askHint();
  return hintMissedAt !== null && !hint;
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

// ── the home page (pages/challenge.ts draws it) ───────────────────────

/** The header's way in, while there is a challenge to show. */
export function navButtonHtml(): string {
  askHint();
  return challengeNavHtml(challengeHomeView(hint, Date.now() + skew));
}

/** "This week's challenge": hidden when there is none or no server. */
export function homeCardHtml(): string {
  askHint();
  return challengeHomeCardHtml(challengeHomeView(hint, Date.now() + skew));
}

/** The new home's Challenge card body: pages/challenge.ts challengeGlanceHtml; '' with no current week. */
export function homeGlanceHtml(): string {
  askHint();
  return challengeGlanceHtml(challengeHomeView(hint, Date.now() + skew));
}

/** this week's challenge id, or null — the home picks the Challenge card's art by it (ui/homeart.ts) */
export function currentId(): string | null {
  askHint();
  return challengeHomeView(hint, Date.now() + skew).current?.id ?? null;
}

/** a current or a past week to show: the home's Challenge button is live */
export function hasChallenge(): boolean {
  askHint();
  return challengeHomeView(hint, Date.now() + skew).any;
}

// ── the page ──────────────────────────────────────────────────────────

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
  // the app frame (pages/frame.ts): both columns keep their scroll over a repaint
  paintFrame($app, challengePageHtml(challengePageView({
    data, hint, loading, msg, msgTone, skew, tab, pastOpen, arming, boards, sending, building, list, importing, undo, decks: importable,
  })));
}

/** whichever is on screen: the table (this page's import sheet is drawn in
 * it) or this page */
function repaint(): void {
  if (tt.screen()) tt.tabletopChanged(); else paint();
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
  // `setup` is part of the deal (the dummy's life, an emblem): the run must carry it
  freshRun({ id: def.id, week: def.week, title: def.title, blurb: def.blurb, goal: def.goal, seed: def.seed, par: def.par,
    ...(def.setup ? { setup: def.setup } : {}) }, list);
  location.search = `?challenge=play&id=${encodeURIComponent(id)}`;
}

// ── clicks ────────────────────────────────────────────────────────────

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('ch-')) return false;
  const id = btn.dataset['id'] ?? '';
  if (b !== 'ch-import' && b !== 'ch-importdeck') importing = false;
  if (b !== 'ch-forget') arming = null;
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
    case 'ch-import': importing = !importing; if (importing) dk.ensureCollection(repaint); repaint(); return true;
    case 'ch-importdeck': {
      const d = importable().find(x => x.id === btn.dataset['id']);
      importing = false;
      // on the table: the builder's history takes it, so its Undo undoes it
      if (tt.screen() && building) {
        if (!d || !tt.place(tableHost(building), null, { at: 'arrange', edit: { op: 'set', cards: [...d.cards] } })) repaint();
        return true;
      }
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
    case 'ch-forget': {
      const key = `forget:${btn.dataset['at'] ?? ''}`;
      if (arming !== key) { arming = key; paint(); return true; }
      arming = null;
      forgetDone(Number(btn.dataset['at'])); paint(); return true;
    }
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
    pool: true,
    pill: () => tablePill(self.cards()),
    toolsHtml: () => tableToolsHtml(self.cards(), importing),
    // Esc closes the Import sheet (tabletop.ts's Esc asks)
    closeSheet: () => { if (!importing) return false; importing = false; return true; },
    sheetHtml: () => (importing ? sheet({
      open: true, placement: 'side', width: 'sm', title: 'Import a deck', bodyHtml: importListHtml(importable()),
      dismissBtn: 'ch-import', id: 'ch-importsheet',
    }) : ''),
    below: () => {
      const l = self.cards();
      const d = def();
      const problem = deckProblem(l);
      const hand = d && !problem ? openingHand(d, l) : null;
      const c = tt.selected(self);
      return tableNoteHtml(d ? goalText(d.goal) : null) + challengeStripHtml({
        list: l, hand: hand ? hand.length : null, ...cardSize(),
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
    close: () => { open = true; building = id; importing = false; syncUrl(); paint(); },
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

