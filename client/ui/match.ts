/* Competitive Constructed — THE MATCH SCREENS (docs/22 §5, §6.1).
 *
 * Everything a Competitive match draws outside the board: the home screen's
 * Competitive card and its "Your matches" row, the game-1 waiting room where
 * each seat registers a deck, and the BETWEEN screen — score, frozen clocks,
 * the sideboarding window, Ready (the previous game's loser
 * readies WITH the initiative choice: owner, docs/22 §8 answer 1), pause and
 * resume, and Concede match. ui/main.ts gains only the dispatch.
 *
 * The server is server/match.ts; the wire is docs/22 §5.8. This screen holds
 * ONE thing of its own: a configuration the player is part-way through. A tap
 * moves one copy across, and the in-between steps of a swap are illegal (31 →
 * 30 → 29 → 30), while the server refuses an illegal configuration outright
 * and keeps the last legal one. So the draft lives here, the legality line and
 * Ready read it, and only a LEGAL draft is sent — which is also why "the lock
 * deals the last legal one" can never cost a player a half-made swap they did
 * not see.
 *
 * Touch-first (a 120 s window on an iPad): every move is one tap on a card;
 * nothing here needs hover or a right-click. Since 2026-11-03 (owner: "I wanted
 * something like MTGO. Your deck laid out below, on the table … then the
 * sideboard above and you slide cards in and out") the between screen is a
 * card table — the tabletop's piles of real scans — and a card can also be
 * DRAGGED across; the drop is the tap's own `moveCopy`.
 *
 * What these screens DRAW is pages/match.ts since the design-system round
 * (2026-11-03): this module keeps the wire types, the draft, the home card's
 * choices, the "Your matches" fetch, the cc- clicks and the countdown, and the
 * page reads them through matchState(), shown() and pickOf().
 */
import { checkSwap, type MatchConfig } from '../engine/src/matchdeck.ts';
import type { Seat } from '../engine/src/types.ts';
import { addDragProvider, type DragPlan, type DragProvider } from './drag.ts';
import { installPressZoom } from './presszoom.ts';
import { PEEK_MS } from './touch.ts';
import { esc } from './util.ts';
import { chosenMatchClockMs } from './pages/clockpick.ts';

// ── the wire (server/match.ts) ───────────────────────────────────────

export type MatchPhase = 'game' | 'between' | 'paused' | 'over' | 'void';

/** `waiting.match` — this seat's view of the match, built per seat. The
 * opponent's deck is never in it: `ready` is all it says about them. */
export interface MatchLobbyInfo {
  id: string; bestOf: 1 | 3; game: number;
  score: [number, number]; names: [string, string];
  banks: [number, number]; clockStart: number | null;
  phase: MatchPhase;
  chooser: Seat | null; initiative: Seat | null;
  until: number | null; locked: boolean;
  ready: [boolean, boolean];
  mine: { registered: MatchConfig; current: MatchConfig } | null;
  /** voidAt: the server's lapse time — 7 days, or a league week's end if sooner */
  pause?: { offeredBy: Seat | null; pausedAt: number | null; resume: [boolean, boolean]; voidAt?: number | null };
  result?: MatchResult;
}

export interface MatchResult { winner: Seat; how: 'games' | 'conceded' | 'time'; at: number; concededBy?: Seat }

/** the public summary every in-game push, `gameover` and `{t:'match'}` carry */
export interface MatchSummary {
  id: string; bestOf: 1 | 3; score: [number, number]; game: number;
  phase: MatchPhase; room: string;
  /** each game played, in order: its winner (null: closed with no result)
   * and how it ended — absent from an older server */
  games?: MatchGameResult[];
  result?: MatchResult; voided?: { at: number; why: string };
}

export interface MatchGameResult { winner: Seat | null; how: 'played' | 'conceded' | 'time' | 'closed' }

/** a row of `/api/matches/mine` */
export interface MyMatch {
  id: string; bestOf: 1 | 3; seat: Seat; opponent: string; score: [number, number]; game: number;
  phase: MatchPhase; room: string; pausedAt: number | null; until: number | null; voidAt: number | null;
  /** CT-517: the opponent is in the match's room / has pressed Resume (absent from an older server) */
  opponentHere?: boolean; resumeAsked?: boolean;
}

/** a deck in the collection with its Competitive verdict (ui/decks.ts competitiveDecks) */
export interface CcDeck { id: string; name: string; error: string | null }

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** the page that plays a match room: the room, the seat, and that it is a
 * match room (`cc=1`: the join never brings the casual deck) */
export const matchLink = (room: string, seat: Seat): string =>
  `?ws=1&room=${encodeURIComponent(room)}&seat=${seat}&mode=constructed&cc=1`;

// ── module state ─────────────────────────────────────────────────────

/** the home card's Best-of choice — Bo3 by default (§6.1); a post-game "New
 * match" link brings the last one back as `?bo=1` */
let bestOf: 1 | 3 = (() => {
  try { return new URLSearchParams(location.search).get('bo') === '1' ? 1 : 3; } catch { return 3; }
})();
/** the deck this browser brings to a match (home card, game-1 waiting room).
 * Kept in localStorage (BL-55): opening a match room is a page load
 * (`location.search`), so a pick held only in module state went back to the
 * first legal deck after every one, and after every reload. pickOf()
 * still falls back when the remembered deck is gone or no longer legal. */
export const PICK_KEY = 'algoCcDeck';
let pickId: string | null = (() => {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(PICK_KEY); } catch { return null; }
})();
function setPick(id: string | null): void {
  pickId = id;
  try {
    if (typeof localStorage === 'undefined') return;
    if (id) localStorage.setItem(PICK_KEY, id); else localStorage.removeItem(PICK_KEY);
  } catch { /* private window: this page only */ }
}
/** the configuration being worked out, keyed to the match and game it is for */
let draft: { key: string; cfg: MatchConfig } | null = null;
/** the moves this game's sideboarding can take back, last first (`cc-undo`):
 * each is the copy's way home — `from` is the zone it now sits in. Keyed like
 * the draft; an undo is moveCopy again, so it can do nothing a tap could not */
let undo: { key: string; moves: { from: 'main' | 'side'; card: string }[] } | null = null;
/** Concede match asks once before it counts */
let concedeAsk = false;
/** "Your matches": null until the first answer */
let mine: MyMatch[] | null = null;
let mineLoading = false;

// ── small words ──────────────────────────────────────────────────────

/** h:mm:ss / m:ss — the banks and the sideboarding countdown */
export function clock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n: number): string => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

/** "you lead 1–0", "you trail 0–1", "1–1" — from this seat's side */
export function scoreWords(score: [number, number], seat: Seat): string {
  const a = score[seat] ?? 0, b = score[other(seat)] ?? 0;
  return a > b ? `you lead ${a}–${b}` : a < b ? `you trail ${a}–${b}` : `${a}–${b}`;
}

/** the same cards on each board, in any order */
export const sameBoards = (a: MatchConfig, b: MatchConfig): boolean => {
  const k = (l: readonly string[]): string => [...l].sort().join('\n');
  return k(a.main) === k(b.main) && k(a.side) === k(b.side);
};

// ── the draft ────────────────────────────────────────────────────────

const keyOf = (w: MatchLobbyInfo): string => `${w.id}:${w.game}`;

/** what this seat's panel shows: the draft if one is under way, else the server's */
export function shown(w: MatchLobbyInfo): MatchConfig | null {
  if (!w.mine) return null;
  return draft && draft.key === keyOf(w) ? draft.cfg : w.mine.current;
}

/** a push arrived: a draft the server now holds is no longer a draft */
export function onLobby(w: MatchLobbyInfo): void {
  if (!draft) return;
  if (draft.key !== keyOf(w) || !w.mine || w.locked || w.phase !== 'between' || sameBoards(draft.cfg, w.mine.current)) {
    draft = null;
  }
}

/** move one copy of `card` off `from`, onto the other board */
function moved(cfg: MatchConfig, from: 'main' | 'side', card: string): MatchConfig | null {
  const src = [...cfg[from]];
  const i = src.lastIndexOf(card);
  if (i < 0) return null;
  src.splice(i, 1);
  return from === 'main'
    ? { main: src, side: [...cfg.side, card] }
    : { main: [...cfg.main, card], side: src };
}

/**
 * THE ONE MOVE of the sideboarding table: one copy of `card` off `from`, onto
 * the other zone. A tap on a card calls it (`cc-move`) and so does a drop
 * (the drag provider below) — one intent, two routes, so a drag can never do
 * what a tap could not. True when the copy moved.
 */
function moveCopy(a: MatchActions, from: 'main' | 'side', card: string, record = true): boolean {
  const w = a.lobby();
  if (!w?.mine || w.locked || w.phase !== 'between') return false;
  const next = moved(shown(w)!, from, card);
  if (!next) return false;
  draft = { key: keyOf(w), cfg: next };
  if (record) {
    if (undo?.key !== keyOf(w)) undo = { key: keyOf(w), moves: [] };
    undo.moves.push({ from: from === 'main' ? 'side' : 'main', card });
  }
  // only a legal configuration goes to the server — it would refuse the
  // rest and keep the last legal one, which is what the lock deals
  if (checkSwap(w.mine.registered, next).ok) a.send({ t: 'cc', op: 'config', main: next.main, side: next.side });
  a.rerender();
  return true;
}

/** a move of this game's sideboarding to take back (the table's Undo) */
export function canUndo(w: MatchLobbyInfo): boolean {
  return !!undo && undo.key === keyOf(w) && undo.moves.length > 0 && !w.locked && w.phase === 'between';
}

/** Undo: the last move's copy goes home, through moveCopy. A move the board
 * no longer allows (a config pushed from another device) is dropped */
function undoMove(a: MatchActions): void {
  const w = a.lobby();
  if (!w || !canUndo(w)) return;
  const last = undo!.moves.pop()!;
  if (!moveCopy(a, last.from, last.card, false)) a.rerender();
}

// ── the home card ────────────────────────────────────────────────────

/** the deck the card and the game-1 room offer first: the last pick if it is
 * still legal, else the first legal deck */
export function pickOf(decks: CcDeck[]): CcDeck | null {
  const legal = decks.filter(d => !d.error);
  return legal.find(d => d.id === pickId) ?? legal[0] ?? null;
}

/** wire the picker's <select> after a paint that holds it */
export function wireDeckSelect(rerender: () => void): void {
  const sel = typeof document !== 'undefined' ? document.getElementById('cc-deck') as HTMLSelectElement | null : null;
  sel?.addEventListener?.('change', () => { setPick(sel.value || null); rerender(); });
}

/** New match: reserve a code, then open the room as its creator */
function newMatch(decks: CcDeck[] | null, fail: (msg: string) => void): void {
  const pick = decks ? pickOf(decks) : null;
  if (!pick) return;
  fetch('/api/new').then(async r => {
    const j = await r.json() as { code?: string; error?: string };
    if (!r.ok || !j.code) { fail(j.error ?? 'could not start a match'); return; }
    // the Clock row's choice rides the CREATING link as a casual room's does
    // (main.ts newgame); Default sends nothing and the server applies the
    // match default. Never on a link for the other seat (matchLink).
    const ms = chosenMatchClockMs();
    const clock = ms === null ? '' : `&clock=${ms}`;
    location.search = `?ws=1&room=${encodeURIComponent(j.code)}&seat=0&mode=constructed&bo=${bestOf}&ccdeck=${encodeURIComponent(pick.id)}${clock}`;
  }).catch(() => fail('could not reach the server'));
}

// ── "Your matches" (§5.6: a paused match is always one button away) ──

/** ask once per page; a loaded or loading list returns BARE (a render passes
 * this its own repaint — see ensureCollection's 2,696-repaint note) */
export function loadMyMatches(headers: Record<string, string> | null, rerender: () => void): void {
  if (!headers || mine || mineLoading) return;
  mineLoading = true;
  let asked: Promise<unknown>;
  try { asked = fetch('/api/matches/mine', { headers }); } catch { asked = Promise.reject(new Error('no fetch')); }
  asked
    .then(r => (r as Response).json() as Promise<{ ok?: boolean; matches?: MyMatch[] }>)
    .then(r => { mine = r.ok ? r.matches ?? [] : []; })
    .catch(() => { mine = []; })
    .finally(() => { mineLoading = false; if (mine?.length) rerender(); });
}

/** how many open matches "Your matches" would list (0 before the list has
 * loaded) — part of the new home's Join badge (docs/24) */
export function myMatchCount(): number { return mine?.length ?? 0; }

/** forget the list (signing out) */
export function resetMyMatches(): void { mine = null; mineLoading = false; }

/** one open match, as a line and a button — shared with the bell */
export function myMatchLine(m: MyMatch, now = Date.now()): { text: string; button: string } {
  const days = Math.max(0, Math.floor((now - (m.pausedAt ?? now)) / 86_400_000));
  const where = m.phase === 'paused'
    ? `paused ${days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}`
    : m.phase === 'between' ? `game ${m.game} of ${m.bestOf} — sideboarding`
      : `game ${m.game} of ${m.bestOf}`;
  return {
    text: `vs <b>${esc(m.opponent || 'your opponent')}</b> · ${esc(scoreWords(m.score, m.seat))} · ${esc(where)}`,
    button: m.phase === 'paused' ? 'Resume' : 'Open',
  };
}

// ── the waiting room (game 1) and the between screen ─────────────────

// ── what the pages draw (pages/match.ts) ─────────────────────────────

/** this module's state, as pages/match.ts's views read it */
export function matchState(): { bestOf: 1 | 3; concedeAsk: boolean; mine: readonly MyMatch[] | null } {
  return { bestOf, concedeAsk, mine };
}

// ── clicks ───────────────────────────────────────────────────────────

/** what a click here may do through the socket client */
export interface MatchActions {
  /** the room's lobby payload, if this page is a match room */
  lobby(): MatchLobbyInfo | null;
  seat(): Seat;
  /** a `{t:'cc', …}` (or `{t:'concedeMatch'}`) on the room's socket */
  send(msg: Record<string, unknown>): void;
  /** game 1: register this deck (a join carrying its id) */
  register(deckId: string): void;
  decks(): CcDeck[] | null;
  fail(msg: string): void;
  rerender(): void;
}

/** a `cc-*` button. False when the button is not one of ours. */
export function handleMatchButton(btn: HTMLElement, a: MatchActions): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('cc-')) return false;
  const w = a.lobby();
  switch (b) {
    case 'cc-bo': bestOf = btn.dataset['bo'] === '1' ? 1 : 3; a.rerender(); return true;
    case 'cc-new': newMatch(a.decks(), a.fail); return true;
    case 'cc-open': {
      const seat: Seat = btn.dataset['seat'] === '1' ? 1 : 0;
      location.search = matchLink(btn.dataset['room'] ?? '', seat);
      return true;
    }
    case 'cc-register': {
      const decks = a.decks();
      const pick = decks ? pickOf(decks) : null;
      if (pick) a.register(pick.id);
      return true;
    }
    case 'cc-move':
      moveCopy(a, btn.dataset['from'] === 'side' ? 'side' : 'main', btn.dataset['card'] ?? '');
      return true;
    case 'cc-undo': undoMove(a); return true;
    case 'cc-reset':
      // back to the deck as registered (docs/22 §8 Q3: one tap away) — an
      // ordinary configuration; the server's push of it is the repaint. It
      // is a fresh start: nothing before it is taken back
      if (!w?.mine || w.locked) return true;
      draft = null;
      undo = null;
      a.send({ t: 'cc', op: 'config', main: [...w.mine.registered.main], side: [...w.mine.registered.side] });
      return true;
    case 'cc-ready': {
      if (!w) return true;
      if (btn.dataset['ready'] === '0') { a.send({ t: 'cc', op: 'ready', ready: false }); return true; }
      const init = btn.dataset['init'];
      a.send({ t: 'cc', op: 'ready', ready: true, ...(init === '0' || init === '1' ? { initiative: Number(init) } : {}) });
      return true;
    }
    case 'cc-pause': a.send({ t: 'cc', op: 'pause' }); return true;
    case 'cc-unpause': a.send({ t: 'cc', op: 'unpause' }); return true;
    case 'cc-resume': a.send({ t: 'cc', op: 'resume' }); return true;
    case 'cc-concede': concedeAsk = true; a.rerender(); return true;
    case 'cc-concede-no': concedeAsk = false; a.rerender(); return true;
    case 'cc-concede-yes': concedeAsk = false; a.send({ t: 'concedeMatch' }); a.rerender(); return true;
  }
  return false;
}

// ── the sideboarding table's drag (owner 2026-11-03: "like MTGO") ─────

/** the click handler's actions, handed over by main.ts at boot */
let tableActions: (() => MatchActions) | null = null;

/**
 * Drag a card between the deck and the sideboard — ui/drag.ts's machinery,
 * a provider beside the game's and the tabletop's, with the tabletop's feel:
 * a finger holds before it lifts (the deck pane scrolls under it), a mouse
 * press lifts at once, and a card carried to an edge scrolls the pane. The
 * only zone that lights is the OTHER one, and a drop on it is `moveCopy`,
 * the tap's own function. A drop anywhere else flies the card home.
 */
export const sideboardDrag: DragProvider = {
  holdMs: PEEK_MS,
  edgeScroll: true,
  pressLift: true,
  sourceOf(el) {
    // a card of the table: `data-cc-zone` is drawn there and nowhere else
    if (!tableActions || !el?.closest || !el.closest('[data-cc-zone]')) return null;
    const card = el.closest('[data-card]') as HTMLElement | null;
    return card?.dataset['btn'] === 'cc-move' ? card : null;
  },
  plan(src): DragPlan | null {
    const a = tableActions?.();
    const w = a?.lobby();
    if (!a || !w?.mine || w.locked || w.phase !== 'between') return null;
    const from = src.dataset['from'] === 'side' ? 'side' : 'main';
    const card = src.dataset['card'] ?? '';
    return {
      targets: [],
      zoneAt(el) {
        const z = el?.closest?.('[data-cc-zone]') as HTMLElement | null;
        return z && z.dataset['ccZone'] !== from ? z : null;
      },
      drop: () => moveCopy(a, from, card),
    };
  },
  started() { /* nothing hovers here */ },
  // a push that landed under the card was held back (main.ts render waits on
  // dragActive): paint it now — and after a drop, the moved card's own paint
  ended() { tableActions?.().rerender(); },
  refind(src) {
    const k = src.dataset['ttSrc'];
    return k ? document.querySelector<HTMLElement>(`[data-cc-zone] [data-tt-src="${CSS.escape(k)}"]`) : null;
  },
};

/** main.ts, at boot: the drag above, the press-to-read zoom, and a repaint
 * when the window changes size (the cards and strips follow it) */
export function installSideboardTable(actions: () => MatchActions): void {
  if (tableActions) return;
  tableActions = actions;
  addDragProvider(sideboardDrag);
  installPressZoom();
  if (typeof addEventListener === 'function' && typeof document !== 'undefined') {
    addEventListener('resize', () => {
      if (typeof document.querySelector === 'function' && document.querySelector('.ccsbtable')) actions().rerender();
    });
  }
}

// ── the countdown ────────────────────────────────────────────────────

let ticking = false;
/** the sideboarding countdown, patched in place: ONE steady setInterval tick
 * (never a self-re-arming setTimeout — the headless suites boot this module,
 * memory: headless-suites-and-timers), and never a repaint of the page under
 * a player's finger */
export function installCountdown(): void {
  if (ticking || typeof window === 'undefined' || typeof document === 'undefined') return;
  ticking = true;
  window.setInterval(() => {
    const els = typeof document.querySelectorAll === 'function' ? document.querySelectorAll('[data-cc-until]') : [];
    for (const el of Array.from(els as ArrayLike<HTMLElement>)) {
      const until = Number(el.dataset?.['ccUntil'] ?? el.getAttribute?.('data-cc-until'));
      if (Number.isFinite(until)) el.textContent = clock(until - Date.now());
    }
  }, 500);
}
