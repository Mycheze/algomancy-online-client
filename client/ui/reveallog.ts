/* THIS GAME'S REVEALS, AS THIS SEAT WAS SHOWN THEM (report #224, 2026-10-18).
 *
 * The owner: the opponent's glimpse notice closed by itself after a few
 * seconds, and "make it possible to see past revealed zones in the right
 * click menu". Two surfaces, one record:
 *
 *   · the notice (`.glimpsenotice`, drawn by ui/main.ts) shows the newest
 *     reveal worth a pop-up until the viewer dismisses it or a newer one takes
 *     its place. No timer, and no reset on a repaint, a layout or motion
 *     toggle, a reconnect or a refresh — the notice is a pointer into this
 *     record, not a moment of its own.
 *   · "Past reveals" in the table menu (right-click bare table, or the rail's
 *     ☰ table on a touch screen) opens every reveal of this game, newest
 *     first, in a LAYER beside #app (the ui/report.ts pattern): its own
 *     `data-reveals` clicks, its own scrim (`.revealscrim`, never the board's
 *     modal class), its own Escape; painted only when it opens or closes.
 *
 * ⚠ WHAT IS IN HERE IS EXACTLY WHAT THE SERVER SENT THIS SEAT. The records are
 * folded off the event batches the client was handed (ui/reveal.ts
 * revealRecords) — after the server's redaction and CR D6.2's hold — and off
 * nothing else. The game state keeps no record of a reveal, so this is the
 * client's own memory of its own screen; it cannot know more than was shown.
 *
 * WHERE IT IS KEPT: one localStorage key (`algoReveals`), holding the CURRENT
 * game only — a different game overwrites it, so it never grows past one game.
 * That is what lets a refresh or a reconnect (every server restart reloads
 * the page) still show the list: the server never resends a reveal's events,
 * only the log's prose. A record names its action count, and loading drops
 * any record from beyond the state it is loaded against — a rewind, or a new
 * game in a reused room (LEARN, DEMO) whose count starts again from zero.
 */
import { esc } from './util.ts';
import { glimpseHeadline, type RevealRecord } from './reveal.ts';
import type { CardName } from '../engine/src/types.ts';

/** one reveal, as kept */
export interface KeptReveal {
  seat: number;
  cards: CardName[];
  source?: string;
  turn: number;
  /** the game's action count when it arrived — what a rewind is measured by */
  at: number;
}

interface Store {
  /** room · seat · names — which game, as this seat sits in it */
  game: string;
  items: KeptReveal[];
  /** the item the notice is showing, or null when it was dismissed */
  notice: number | null;
}

const KEY = 'algoReveals';
/** a long game's worth; the oldest go first */
const CAP = 80;

let store: Store = { game: '', items: [], notice: null };

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private window: this tab keeps it */ }
}

/** two batches carrying the same reveal (a recap watched again) are one record */
const sameReveal = (a: KeptReveal, b: KeptReveal): boolean =>
  a.turn === b.turn && a.seat === b.seat && (a.source ?? '') === (b.source ?? '')
  && a.cards.join('\u0001') === b.cards.join('\u0001');

/**
 * Start (or resume) the record for this game. Called on every join, which is
 * every reconnect too: the record of the same game survives, another game's
 * is replaced, and anything from beyond `actionCount` is dropped.
 */
export function loadReveals(game: string, actionCount: number): void {
  let got: Store | null = null;
  try { got = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Store | null; } catch { got = null; }
  // the in-memory record is the newer one when storage is unavailable
  const from = got && got.game === game ? got : store.game === game ? store : null;
  if (!from || !Array.isArray(from.items)) { store = { game, items: [], notice: null }; save(); return; }
  const items = from.items.filter(r => r && Array.isArray(r.cards) && r.at <= actionCount);
  const n = typeof from.notice === 'number' ? from.items[from.notice] : undefined;
  const notice = n ? items.indexOf(n) : -1;
  store = { game, items, notice: notice >= 0 ? notice : null };
  save();
}

/**
 * Fold one batch's reveals in. `pop` is the one the notice should show (the
 * newest that the viewer's own decision did not already show — ui/reveal.ts
 * glimpseNotice), or null to leave the notice where it is.
 */
export function recordReveals(recs: readonly RevealRecord[], pop: RevealRecord | null, turn: number, at: number): void {
  if (!store.game || (!recs.length && !pop)) return;
  let popAt: number | null = null;
  for (const r of recs) {
    const kept: KeptReveal = { seat: r.seat, cards: [...r.cards], ...(r.source ? { source: r.source } : {}), turn, at };
    let i = store.items.findIndex(x => sameReveal(x, kept));
    if (i < 0) { store.items.push(kept); i = store.items.length - 1; }
    if (pop && r.seat === pop.seat && r.cards.join('\u0001') === pop.cards.join('\u0001')
      && (r.source ?? '') === (pop.source ?? '')) popAt = i;
  }
  if (popAt !== null) store.notice = popAt;
  if (store.items.length > CAP) {
    const drop = store.items.length - CAP;
    store.items = store.items.slice(drop);
    store.notice = store.notice !== null && store.notice >= drop ? store.notice - drop : null;
  }
  save();
}

/** what the notice shows right now, or null */
export function noticeReveal(): KeptReveal | null {
  return store.notice !== null ? store.items[store.notice] ?? null : null;
}

/** the viewer put the notice away */
export function dismissNotice(): void {
  if (store.notice === null) return;
  store.notice = null;
  save();
}

/** how many reveals this game has shown this seat */
export function revealCount(): number {
  return store.items.length;
}

// ── the past-reveals dialog ─────────────────────────────────────────────

/** what the layer needs from the board, without importing it */
export interface RevealsDeps {
  /** a seat's name, as the board writes it */
  name(seat: number): string;
  /** the seat this client plays, or null */
  mySeat(): number | null;
  /** one card scan */
  card(name: CardName): string;
}

/** the dialog's markup, newest first */
function revealsHtml(items: readonly KeptReveal[], d: Pick<RevealsDeps, 'name' | 'mySeat' | 'card'>): string {
  const rows = [...items].reverse().map(r => `<div class="revealrow">
      <div class="revealhead">${esc(glimpseHeadline(r, d.name(r.seat), d.mySeat()))}<span class="revealturn">turn ${r.turn}</span></div>
      <div class="revealcards">${r.cards.map(n => d.card(n)).join('')}</div>
    </div>`).join('');
  return `<div class="overlaybox revealbox" data-reveals="box">
      <div class="revealtop"><h3>Past reveals</h3>
        <button data-reveals="close" title="close" aria-label="close">✕</button></div>
      <div class="revealrows">${rows || '<p class="hint">Nothing revealed yet.</p>'}</div>
    </div>`;
}

let open = false;
let layer: HTMLElement | null = null;
let deps: RevealsDeps | null = null;

function paint(): void {
  if (!layer || !deps) return;
  layer.innerHTML = open ? `<div class="revealscrim" data-reveals="scrim">${revealsHtml(store.items, deps)}</div>` : '';
}

export function openReveals(): void {
  open = true;
  paint();
}

function closeReveals(): void {
  if (!open) return;
  open = false;
  paint();
}

/** is the dialog up? — the board's hotkeys must not reach under it */
export function isRevealsOpen(): boolean {
  return open;
}

/** Mount the layer beside #app. Safe where there is nothing to hang it on. */
export function installRevealsLayer(d: RevealsDeps): void {
  if (layer) return;
  const app = document.getElementById('app');
  if (!app || !document.body || typeof document.body.appendChild !== 'function') return;
  deps = d;
  layer = document.createElement('div');
  layer.id = 'revealslayer';
  document.body.appendChild(layer);

  // every click inside is the layer's: the nearest `data-reveals` says whose —
  // the ✕ or the scrim close it, the box keeps it
  const mine = (e: Event): string | null => {
    const t = (e.target as HTMLElement | null)?.closest?.('[data-reveals]') as HTMLElement | null;
    return open && t ? t.dataset['reveals'] ?? '' : null;
  };
  document.addEventListener('click', e => {
    const what = mine(e);
    if (what === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (what === 'close' || what === 'scrim') closeReveals();
  }, { capture: true });
  // a card's own menu would open on the board underneath, out of sight
  document.addEventListener('contextmenu', e => {
    if (mine(e) === null) return;
    e.preventDefault();
    e.stopPropagation();
  }, { capture: true });
  document.addEventListener('keydown', e => {
    if (!open) return;
    e.stopPropagation();
    if (e.key === 'Escape') closeReveals();
  }, { capture: true });
  // leaving the board closes it
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => { if (!app.classList?.contains('board')) closeReveals(); })
      .observe(app, { attributes: true, attributeFilter: ['class'] });
  }
}
