/* THE DECK TABLE — real card scans on a table, moved by hand.
 *
 * Owner, 2026-10-21, after building a challenge deck: *"the deck building was
 * pretty bad. It'd be way better to have a sorta drag and drop style of deck
 * building where the cards feel like they're physically on a table … That'd
 * also actually vastly improve the normal deck building interface."*
 *
 * One component for both builders (ui/decks.ts, the challenge builder), with
 * three views a host may offer:
 *
 *   SORTED    rows (the row split) × cost columns, the auto-sort of
 *             ui/decklayout.ts — plus YOUR MOVES: a card dragged to another
 *             cell stays there, marked ↪, until you put it back (owner, Q1).
 *             A move is one name, all its copies, under the current split
 *             only (ui/deckarrange.ts says why).
 *   FREEFORM  your own named piles in a wrapping row; one card per copy.
 *   STACKED   the challenge's draw order (a shell here; the challenge builder
 *             fills it in — see the hand-off in this round's notes).
 *
 * Plus two zones on the table in every view: MAYBE (the maybeboard — the old
 * tab is retired, owner Q6) and CUT. The drawer (ui/deckdrawer.ts) is the pool.
 *
 * ⚠ EVERY DROP IS A CLICK ROUTE, and `place()` is the only door. A drag drops
 * through `place()`; a tap on a card selects it and a tap on a lit spot calls
 * `place()` with the selection; the drawer's + calls `place()`; Put back, a
 * new pile, a rename — all `place()`. It is the one function here that calls
 * the host's `commit`, so whatever a finger can do a mouse can, and the other
 * way round (ui/test/536 counts the call sites). A tablet is a real audience
 * (docs/19): a finger HOLDS a card to lift it, because the page scrolls.
 *
 * ⚠ ARRANGEMENT NEVER CHANGES THE DECK. A move, a pile, a rename is
 * arrangement; only the deck's own list says what is in it. `place()` runs
 * `normaliseMoves` and `reconcilePiles` on every commit, so the arrangement can
 * never disagree with the list it arranges.
 *
 * DOM only in the wiring: `tableHtml` is a pure function of the host, which is
 * what lets ui/test/535 read the markup straight back.
 */
import { addDragProvider, type DragPlan, type DragProvider } from './drag.ts';
import { closeDrawer, drawerOpen, drawerTookKey, flushDrawer, openDrawer, type DrawerHost } from './deckdrawer.ts';
import { rowFor } from './cardindex.ts';
import { artHtml } from './cardpanel.ts';
import { txtIcon } from './cardtext.ts';
import { analyzeDeck } from './deckstats.ts';
import { GROUPINGS, needsCountBadge, stackLayers } from './decklayout.ts';
import {
  deletePile, movePileCard, moveTo, naturalCell, newPile, normaliseMoves, putAllBack, putBack,
  reconcilePiles, renamePile, seedPiles, sortedGrid,
  type DeckPile, type RowSplit, type SortMoves,
} from './deckarrange.ts';
import { blocks } from './challengebuild.ts';
import { PEEK_MS } from './touch.ts';
import { esc } from './util.ts';

export type TableView = 'sorted' | 'freeform' | 'stacked';

/** an arrangement edit: no card moves, but it is still a `place()` */
export type Arrange =
  | { op: 'newpile' }
  | { op: 'rename'; pile: string; name: string }
  | { op: 'delpile'; pile: string }
  | { op: 'putallback' }
  | { op: 'undo' };

/** Where a card is / goes. Positions are in the HOST's own terms. */
export type Place =
  | { at: 'drawer' }                          // not on the table: the pool
  | { at: 'table' }                           // "the deck", nowhere in particular (Sorted: its natural cell)
  | { at: 'cell'; row: string; col: string }  // Sorted: a cell — records a move unless it is the natural one
  | { at: 'pile'; pile: string; index?: number }  // Freeform (index = before the card there now)
  | { at: 'newpile' }                         // Freeform: a pile made for it
  | { at: 'gap'; gap: number }                // Stacked: the list index the card(s) go BEFORE
  | { at: 'maybe' }
  | { at: 'cut' }
  | { at: 'arrange'; edit: Arrange };

/** What is being moved: a name (Sorted and Maybe carry every copy there, a
 * pile one copy, the drawer one new copy — `n` narrows it), or a Stacked range */
export type Carry =
  | { name: string; from: Place; n?: number }
  | { block: number; n: number; from: Place };

export interface TableNext {
  cards?: string[]; maybe?: string[]; piles?: DeckPile[]; sortMoves?: SortMoves; view?: TableView;
}

export interface TableHost {
  /** namespaces the selection: 'deck:<id>' | 'challenge:<id>' */
  key: string;
  /** the button prefix the host's handleButton owns ('deck-' | 'ch-'); the
   * table's buttons are `<prefix>table` with a `data-dt` op */
  btnPrefix: string;
  views: readonly TableView[];
  view(): TableView;
  setView(v: TableView): void;
  /** the deck; ordered for the challenge */
  cards(): readonly string[];
  /** absent = no Maybe zone (the challenge) */
  maybe?(): readonly string[];
  /** Freeform only; null = none yet (seeded on entry, saved on the first commit) */
  piles?(): readonly DeckPile[] | null;
  /** Sorted tweaks; absent = a host that keeps none (the challenge: a move snaps home) */
  sortMoves?(): SortMoves | undefined;
  /** Stacked only: the engine's opening hand */
  hand?(): readonly string[] | null;
  /** the deck's cover card, ringed on the table */
  cover?(): string | null;
  /** copies a deck may hold (constructed 2): the selection's + stops there.
   * Absent = no cap. An affordance, never a refusal. */
  cap?: number;
  /** markup for the top of the table's head (the deck strip) */
  strip?(): string;
  /** THE ONE WAY IN — the host applies it through its own funnel */
  commit(next: TableNext): void;
  /** repaint the host's page — a selection commits nothing but must show */
  repaint(): void;
  /** a drag let go: paint whatever the host held back while it was up */
  dragEnded?(): void;
  /** the drawer this table opens */
  drawer(): DrawerHost;
}

// ── state ─────────────────────────────────────────────────────────────

/** the Sorted row split — per viewer, never stored. `cost` is not offered:
 * the columns already are cost */
let split: RowSplit = 'type';
const SPLITS = GROUPINGS.filter(g => g.id !== 'cost');
/** what is picked up, and on which table */
let sel: { key: string; carry: Carry } | null = null;
/** "Put all back" leaves one step of undo, gone after the next edit */
let undo: { key: string; split: RowSplit; moves: Record<string, { row: string; col: string }> } | null = null;
/** the table on screen — the drag provider and the listeners act on it */
let active: TableHost | null = null;

const viewOf = (h: TableHost): TableView => (h.views.includes(h.view()) ? h.view() : h.views[0]!);
const count = (list: readonly string[], name: string): number => list.filter(c => c === name).length;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** one copy out — the LOWEST, which is the challenge's `cutOne` and is
 * immaterial to an unordered deck */
function takeOne(list: string[], name: string): boolean {
  const i = list.lastIndexOf(name);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/** the piles as Freeform shows them: the saved ones reconciled to the deck,
 * or — on a deck that has none — the seed, one pile per Sorted row */
function pilesOf(h: TableHost): DeckPile[] {
  const saved = h.piles?.() ?? null;
  const cards = h.cards();
  if (saved) return reconcilePiles(cards, saved);
  return seedPiles(analyzeDeck([...cards]), split, h.sortMoves?.());
}

export function selected(h: TableHost): Carry | null {
  return sel && sel.key === h.key ? sel.carry : null;
}

export function clearSelection(): void { sel = null; }

/** where a card goes when nothing says where: Sorted its natural cell,
 * Freeform the pile the reconcile picks, Stacked the bottom */
export function defaultPlace(h: TableHost): Place {
  return viewOf(h) === 'stacked' ? { at: 'gap', gap: h.cards().length } : { at: 'table' };
}

// ── THE ONE DOOR ──────────────────────────────────────────────────────

/**
 * Put `carry` at `to` (or, with `carry` null, apply an arrangement edit).
 * Computes the next state with the pure edits and hands it to the host's
 * `commit` — the only call of it in this file. False, and nothing committed,
 * when the move would change nothing (a column move on a host that keeps no
 * moves snaps home this way).
 */
export function place(h: TableHost, carry: Carry | null, to: Place): boolean {
  const cards = [...h.cards()];
  const maybe = h.maybe ? [...h.maybe()] : null;
  const keepsMoves = !!h.sortMoves;
  const was = h.sortMoves?.();
  let moves = was;
  const saved = h.piles?.() ?? null;
  const freeform = viewOf(h) === 'freeform';
  // the piles this edit works on: Freeform's (seeded if there are none yet),
  // or the saved ones kept honest while another view is up
  let piles: DeckPile[] | null = freeform && h.piles ? pilesOf(h) : saved ? reconcilePiles(cards, saved) : null;
  let keepUndo = false;

  const putInPile = (name: string, n: number, pile: string, index?: number): boolean => {
    if (!piles) return false;
    const p = piles.find(x => x.id === pile);
    if (!p) return false;
    const at = Math.max(0, Math.min(index ?? p.cards.length, p.cards.length));
    p.cards.splice(at, 0, ...Array.from({ length: n }, () => name));
    return true;
  };
  const newPileId = (): string | null => {
    if (!piles) return null;
    piles = newPile(piles);
    return piles[piles.length - 1]!.id;
  };

  if (to.at === 'arrange') {
    const e = to.edit;
    if (e.op === 'newpile') { if (!newPileId()) return false; }
    else if (e.op === 'rename') { if (!piles) return false; piles = renamePile(piles, e.pile, e.name); }
    else if (e.op === 'delpile') { if (!piles) return false; piles = deletePile(piles, e.pile); }
    else if (e.op === 'putallback') {
      if (!keepsMoves) return false;
      undo = { key: h.key, split, moves: { ...(moves?.[split] ?? {}) } };
      keepUndo = true;
      moves = putAllBack(moves, split);
    } else {
      if (!undo || undo.key !== h.key) return false;
      moves = { ...(moves ?? {}), [undo.split]: { ...(moves?.[undo.split] ?? {}), ...undo.moves } };
      undo = null;
    }
  } else if (!carry) {
    return false;
  } else if ('block' in carry) {
    // STACKED — the challenge builder's (moveRange / segments live in
    // ui/challengebuild.ts). What the table can do without them:
    const b = blocks(cards)[carry.block];
    if (!b) return false;
    const take = Math.max(1, Math.min(carry.n, b.n));
    if (to.at === 'cut' || to.at === 'drawer') cards.splice(b.start + b.n - take, take);
    else return false;   // a reorder is moveRange's, when the challenge builder lands it
  } else {
    const { name, from } = carry;
    const onTable = from.at === 'table' || from.at === 'cell';
    const inDeck = count(cards, name);
    // 1 — how many, and taken from where
    let n: number;
    if (from.at === 'drawer') n = 1;
    else if (from.at === 'maybe') n = Math.min(carry.n ?? count(maybe ?? [], name), count(maybe ?? [], name));
    else if (from.at === 'pile') n = 1;
    else n = Math.min(carry.n ?? inDeck, inDeck);
    if (n < 1) return false;
    const leaving = to.at === 'cut' || to.at === 'drawer' || to.at === 'maybe';
    if (from.at === 'maybe') {
      if (to.at === 'maybe' || !maybe) return false;
      for (let i = 0; i < n; i++) takeOne(maybe, name);
    } else if ((onTable || from.at === 'pile') && leaving) {
      for (let i = 0; i < n; i++) takeOne(cards, name);
      // a pile's copy leaves from ITS pile, not wherever the reconcile would cut
      if (from.at === 'pile' && piles) {
        const p = piles.find(x => x.id === from.pile);
        if (p) takeOne(p.cards, name);
      }
    }
    // 2 — and put where
    const arriving = from.at === 'drawer' || from.at === 'maybe';
    if (to.at === 'cut' || to.at === 'drawer') {
      if (from.at === 'drawer') return false;
    } else if (to.at === 'maybe') {
      if (!maybe || from.at === 'maybe') return false;
      for (let i = 0; i < n; i++) maybe.push(name);
    } else if (to.at === 'table') {
      if (arriving) for (let i = 0; i < n; i++) cards.push(name);
      else if (onTable && keepsMoves) moves = putBack(moves, split, name);
      else return false;
    } else if (to.at === 'cell') {
      if (arriving) for (let i = 0; i < n; i++) cards.push(name);
      else if (!onTable) return false;
      // a host that keeps no moves (the challenge) snaps home: a column move
      // there commits nothing, and an add lands in its natural cell
      if (keepsMoves) moves = moveTo(moves, split, name, { row: to.row, col: to.col }, naturalCell(name, split));
      else if (!arriving) return false;
    } else if (to.at === 'pile' || to.at === 'newpile') {
      if (!piles) return false;
      const pile = to.at === 'pile' ? to.pile : newPileId();
      if (!pile) return false;
      const index = to.at === 'pile' ? to.index : undefined;
      if (arriving) {
        for (let i = 0; i < n; i++) cards.push(name);
        putInPile(name, n, pile, index);
      } else if (from.at === 'pile') {
        piles = movePileCard(piles, name, from.pile, pile, index);
      } else return false;
    } else if (to.at === 'gap') {
      if (from.at !== 'drawer') return false;   // a reorder is the challenge builder's
      cards.splice(Math.max(0, Math.min(to.gap, cards.length)), 0, name);
    }
  }

  // the arrangement follows the deck, always
  if (keepsMoves) moves = normaliseMoves(cards, moves);
  if (piles) piles = reconcilePiles(cards, piles);
  const next: TableNext = {};
  if (!same(cards, h.cards())) next.cards = cards;
  if (maybe && !same(maybe, h.maybe?.())) next.maybe = maybe;
  if (keepsMoves && !same(moves, was)) next.sortMoves = moves;
  if (piles && !same(piles, saved)) next.piles = piles;
  if (!Object.keys(next).length) return false;
  if (!keepUndo) undo = null;
  h.commit(next);
  return true;
}

// ── markup ────────────────────────────────────────────────────────────

const btn = (h: TableHost, op: string, extra = ''): string =>
  `data-btn="${h.btnPrefix}table" data-dt="${op}"${extra ? ` ${extra}` : ''}`;

/** a cost column's heading, in the game's own icons (two digits draw per digit) */
function colLabel(col: string): string {
  if (col === 'X') return txtIcon('cost_x', 'X');
  if (col === 'unknown') return '<span class="dim">?</span>';
  return [...col].map(d => txtIcon(`cost_${d}`, d)).join('');
}

/** the source key a card is picked up by, and re-found by after a repaint */
const srcOf = (parts: (string | number)[]): string => parts.join('|');

/** a card on the table: the real scan, copies drawn as a stack (badge only
 * over the cap), the ↪ mark on a moved one */
function cardTile(h: TableHost, name: string, n: number, src: string,
  o: { moved?: boolean; at?: number; cover?: string | null } = {}): string {
  const layers = stackLayers(n);
  const r = rowFor(name);
  const art = (cls: string): string => (r ? artHtml(r, cls) : `<div class="${cls} cbnoart">${esc(name)}</div>`);
  const on = !!sel && sel.key === h.key && keyOf(sel.carry) === src;
  return `<div class="dktile dtcard${layers.length ? ' dkstack' : ''}${on ? ' dtsel' : ''}${
      o.cover === name ? ' iscover' : ''}${needsCountBadge(n) ? ' overcap' : ''}"
      ${layers.length ? `style="--d:${layers.length}"` : ''}
      data-prev="${esc(name)}" ${btn(h, 'sel')} data-dt-src="${esc(src)}"${
      o.at !== undefined ? ` data-dt-i="${o.at}" data-dt-n="${n}"` : ''}
      ${n > 1 ? `aria-label="${esc(name)} ×${n}"` : ''}>
    ${layers.map(i => `<span class="dkghostwrap" style="--i:${i}" aria-hidden="true">${art('dkart')}</span>`).join('')}
    ${art('dkart')}
    ${needsCountBadge(n) ? `<span class="dkn bad">×${n}</span>` : ''}
    ${o.moved ? '<span class="dtmoved" title="Moved by you">↪</span>' : ''}
  </div>`;
}

/** the selection's own key, matched against each card's data-dt-src */
function keyOf(c: Carry): string {
  if ('block' in c) return srcOf(['block', c.block, c.n]);
  const f = c.from;
  if (f.at === 'pile') return srcOf(['pile', f.pile, f.index ?? 0, c.name]);
  return srcOf([f.at === 'cell' ? 'table' : f.at, c.name]);
}

/** a data-dt-src back into a Carry */
function carryOf(src: string | undefined): Carry | null {
  if (!src) return null;
  const [kind, ...rest] = src.split('|');
  if (kind === 'table' || kind === 'maybe' || kind === 'drawer') {
    const name = rest.join('|');
    return name ? { name, from: { at: kind } } : null;
  }
  if (kind === 'pile' && rest.length >= 3) {
    const [pile, i, ...nm] = rest;
    return { name: nm.join('|'), from: { at: 'pile', pile: pile!, index: Number(i) } };
  }
  if (kind === 'block' && rest.length === 2) return { block: Number(rest[0]), n: Number(rest[1]), from: { at: 'table' } };
  return null;
}

/** a zone attribute into the Place a tap on it means (a drop refines a pile
 * or a block by where the pointer is — see placeAt) */
function zonePlace(zone: string | undefined): Place | null {
  if (!zone) return null;
  const [kind, a, b] = zone.split('|');
  if (kind === 'cell' && a !== undefined && b !== undefined) return { at: 'cell', row: a, col: b };
  if (kind === 'pile' && a) return { at: 'pile', pile: a };
  if (kind === 'gap' && a !== undefined) return { at: 'gap', gap: Number(a) };
  if (kind === 'block' && a !== undefined) return { at: 'gap', gap: Number(b ?? 0) };
  if (kind === 'newpile' || kind === 'maybe' || kind === 'cut' || kind === 'drawer' || kind === 'table') return { at: kind };
  return null;
}

/** may this carry land on this zone? (what lights up, and what a drop takes) */
function legal(h: TableHost, c: Carry, zone: string): boolean {
  const kind = zone.split('|')[0];
  const from = c.from.at;
  const view = viewOf(h);
  if ('block' in c) return kind === 'cut' || kind === 'drawer' || kind === 'block' || kind === 'gap';
  switch (kind) {
    case 'drawer': case 'cut': return from !== 'drawer';
    case 'maybe': return !!h.maybe && from !== 'maybe';
    case 'table': return from === 'drawer' || from === 'maybe';
    case 'cell': return view === 'sorted' && (from === 'drawer' || from === 'maybe' || !!h.sortMoves);
    case 'pile': case 'newpile': return view === 'freeform' && from !== 'table';
    case 'gap': case 'block': return view === 'stacked' && from === 'drawer';
    default: return false;
  }
}

/** the selection is still there? (a cut, or another device, can take it away) */
function validSelection(h: TableHost): void {
  if (!sel || sel.key !== h.key) return;
  const c = sel.carry;
  if ('block' in c) { if (!blocks(h.cards())[c.block]) sel = null; return; }
  const list = c.from.at === 'maybe' ? (h.maybe?.() ?? []) : h.cards();
  if (!list.includes(c.name)) sel = null;
}

function toolsHtml(h: TableHost, view: TableView): string {
  const moved = view === 'sorted' && h.sortMoves ? Object.keys(h.sortMoves()?.[split] ?? {}).length : 0;
  const canUndo = undo && undo.key === h.key && undo.split === split && view === 'sorted';
  return `<div class="dttools">
    ${h.views.length > 1 ? `<span class="dtseg">${h.views.map(v =>
      `<button class="dkkind${v === view ? ' on' : ''}" ${btn(h, 'view', `data-dt-v="${v}"`)}>${
        v === 'sorted' ? 'Sorted' : v === 'freeform' ? 'Freeform' : 'Stacked'}</button>`).join('')}</span>` : ''}
    ${view === 'sorted' ? `<span class="dtseg">${SPLITS.map(g =>
      `<button class="dkkind${g.id === split ? ' on' : ''}" ${btn(h, 'split', `data-dt-v="${g.id}"`)}
        title="${esc(g.hint)}">${esc(g.label)}</button>`).join('')}</span>` : ''}
    <span class="dkfilterspacer"></span>
    ${moved ? `<button class="dkkind" ${btn(h, 'putallback')}>Put all back (${moved})</button>` : ''}
    ${canUndo ? `<button class="dkkind" ${btn(h, 'undo')}>Undo</button>` : ''}
    <button class="primary dtaddbtn" ${btn(h, 'drawer')}><span class="dtaddlbl">+ Add cards</span><span
      class="dthidelbl">Hide cards</span></button>
  </div>`;
}

/** what can be done to the card picked up — the finger's whole menu */
function selBarHtml(h: TableHost): string {
  const c = selected(h);
  if (!c) return '';
  if ('block' in c) {
    const b = blocks(h.cards())[c.block];
    if (!b) return '';
    return `<div class="dtselbar"><b>${esc(b.name)}</b>
      <button ${btn(h, 'cut')}>Cut</button>
      <button class="dkicon" ${btn(h, 'clear')} aria-label="put it down">✕</button></div>`;
  }
  const fromMaybe = c.from.at === 'maybe';
  const n = count(fromMaybe ? (h.maybe?.() ?? []) : h.cards(), c.name);
  const moved = c.from.at === 'table' && !!h.sortMoves?.()?.[split]?.[c.name] && viewOf(h) === 'sorted';
  const canMore = fromMaybe || h.cap === undefined || count(h.cards(), c.name) < h.cap;
  return `<div class="dtselbar">
    <b>${esc(c.name)}</b>${n > 1 && c.from.at !== 'pile' ? ` <span class="dim">×${n}</span>` : ''}
    <button ${btn(h, 'less')} aria-label="one fewer">−</button>
    ${canMore ? `<button ${btn(h, 'more')} aria-label="one more">+</button>` : ''}
    ${fromMaybe ? `<button ${btn(h, 'todeck')}>To deck</button>`
      : h.maybe ? `<button ${btn(h, 'tomaybe')}>Maybe</button>` : ''}
    <button ${btn(h, 'cut')}>Cut</button>
    ${moved ? `<button ${btn(h, 'putback')}>Put back</button>` : ''}
    <button class="dkicon" ${btn(h, 'clear')} aria-label="put it down">✕</button>
  </div>`;
}

/** Maybe and Cut, on the table in every view */
function zonesHtml(h: TableHost): string {
  const c = selected(h);
  const lit = (z: string): string => (c && legal(h, c, z) ? ' dttarget' : '');
  const maybe = h.maybe?.() ?? null;
  const entries = maybe ? analyzeDeck([...maybe]).copies.sort((a, b) => a.name.localeCompare(b.name)) : [];
  return `<div class="dtzones">
    ${maybe ? `<div class="dtmaybe${lit('maybe')}" ${btn(h, 'to', 'data-dt-zone="maybe"')}>
      <span class="dtzonelabel">Maybe${maybe.length ? ` <span class="dim">${maybe.length}</span>` : ''}</span>
      <div class="dtfan">${entries.map(e => cardTile(h, e.name, e.n, srcOf(['maybe', e.name]))).join('')}</div>
    </div>` : ''}
    <div class="dtcut${lit('cut')}" ${btn(h, 'to', 'data-dt-zone="cut"')}><span aria-hidden="true">🗑</span> Cut</div>
  </div>`;
}

/** with a card picked up, every legal cell and pile ends in an empty slot: a
 * tap on a card SELECTS it, so a finger needs somewhere in a full cell that
 * means "here" (it carries no button of its own — the tap reaches the cell's) */
const SLOT = '<div class="dtslot" aria-hidden="true"></div>';

function sortedHtml(h: TableHost): string {
  const a = analyzeDeck([...h.cards()]);
  if (!a.copies.length) return '<div class="dtempty">Empty — add cards from the drawer.</div>';
  const g = sortedGrid(a, split, h.sortMoves?.());
  const c = selected(h);
  const cover = h.cover?.() ?? null;
  return `<div class="dtsorted" style="--cols:${g.cols.length}">
    <div class="dtcols">${g.cols.map(col => `<div class="dtcolhead">${colLabel(col)}</div>`).join('')}</div>
    ${g.rows.map(row => {
      const total = row.cells.reduce((s, cell) => s + cell.entries.reduce((t, e) => t + e.n, 0), 0);
      return `<div class="dtrow">
      <div class="dtrowhead">${esc(row.label)} <span class="dim">${total}</span></div>
      <div class="dtcells">${row.cells.map(cell => {
        const zone = `cell|${row.key}|${cell.col}`;
        return `<div class="dtcell${cell.entries.length ? '' : ' empty'}${c && legal(h, c, zone) ? ' dttarget' : ''}"
          ${btn(h, 'to', `data-dt-zone="${esc(zone)}"`)}>
          <div class="dtcascade">${cell.entries.map(e =>
            cardTile(h, e.name, e.n, srcOf(['table', e.name]), { moved: e.moved, cover })).join('')}</div>
          ${c && legal(h, c, zone) ? SLOT : ''}
        </div>`;
      }).join('')}</div>
    </div>`;
    }).join('')}
  </div>`;
}

function freeformHtml(h: TableHost): string {
  const piles = pilesOf(h);
  const c = selected(h);
  const lit = (z: string): string => (c && legal(h, c, z) ? ' dttarget' : '');
  const cover = h.cover?.() ?? null;
  return `<div class="dtpiles">${piles.map(p => {
    // consecutive copies of one card are one stacked tile; dragging it takes one
    const runs: { name: string; at: number; n: number }[] = [];
    p.cards.forEach((name, i) => {
      const last = runs[runs.length - 1];
      if (last && last.name === name) last.n++;
      else runs.push({ name, at: i, n: 1 });
    });
    return `<section class="dtpile${lit(`pile|${p.id}`)}" ${btn(h, 'to', `data-dt-zone="pile|${esc(p.id)}"`)}>
      <div class="dtpilehead">
        <input id="dt-pile-${esc(p.id)}" class="dtpilename" value="${esc(p.name)}" maxlength="40"
          spellcheck="false" aria-label="pile name" data-dt-rename="${esc(p.id)}" ${btn(h, 'noop')}>
        <span class="dim">${p.cards.length}</span>
        ${piles.length > 1 ? `<button class="dtpiledel" ${btn(h, 'delpile', `data-dt-pile="${esc(p.id)}"`)}
          aria-label="delete pile">✕</button>` : ''}
      </div>
      <div class="dtcascade">${runs.map(r =>
        cardTile(h, r.name, r.n, srcOf(['pile', p.id, r.at, r.name]), { at: r.at, cover })).join('')}</div>
      ${c && legal(h, c, `pile|${p.id}`) ? SLOT : ''}
    </section>`;
  }).join('')}
    <button class="dtnewpile${lit('newpile')}" ${btn(h, 'to', 'data-dt-zone="newpile"')}>+ New pile</button>
  </div>`;
}

/**
 * STACKED — the challenge's draw order, top first. A SHELL: blocks, their
 * positions and the opening-hand band, so the challenge builder has the
 * markup and the class names to fill in (moveRange, segments — see the
 * hand-off). Not offered by the constructed builder.
 */
function stackedHtml(h: TableHost): string {
  const list = h.cards();
  if (!list.length) return '<div class="dtempty">Empty — add cards from the drawer.</div>';
  const hand = h.hand?.()?.length ?? 0;
  const bs = blocks(list);
  const tile = (b: { name: string; start: number; n: number }, i: number): string => `<div class="dtblock${
      b.start < hand ? ' inhand' : ''}" ${btn(h, 'to', `data-dt-zone="block|${i}|${b.start}"`)}>
      ${cardTile(h, b.name, b.n, srcOf(['block', i, b.n]))}
      <div class="dtpos">${b.n > 1 ? `${b.start + 1}–${b.start + b.n}` : b.start + 1}</div>
    </div>`;
  const inHand = bs.filter(b => b.start < hand);
  return `<div class="dtstacked">
    ${inHand.length ? `<div class="dtband"><div class="dtbandlabel">Turn 1 hand · you bottom 2</div>
      <div class="dtblocks">${inHand.map(tile).join('')}</div></div>` : ''}
    <div class="dtblocks">${bs.map((b, i) => (b.start < hand ? '' : tile(b, i))).join('')}
      <div class="dtgap dttail" ${btn(h, 'to', `data-dt-zone="gap|${list.length}"`)}></div></div>
  </div>`;
}

/** The table, as markup. Pure but for remembering which table is on screen. */
export function tableHtml(h: TableHost): string {
  active = h;
  ensureListeners();
  validSelection(h);
  const view = viewOf(h);
  const holding = !!selected(h);
  return `<div class="dtable dt-${view}${holding ? ' dtholding' : ''}" ${btn(h, 'bare', 'data-dt-zone="table"')}>
    <div class="dthead">
      ${h.strip?.() ?? ''}
      ${toolsHtml(h, view)}
      ${selBarHtml(h)}
      ${zonesHtml(h)}
    </div>
    <div class="dtbody">${view === 'sorted' ? sortedHtml(h) : view === 'freeform' ? freeformHtml(h) : stackedHtml(h)}</div>
  </div>`;
}

// ── clicks ────────────────────────────────────────────────────────────

/** The host forwards its `<prefix>table` buttons here. True = taken. */
export function tableClick(h: TableHost, el: HTMLElement): boolean {
  active = h;
  const op = el.dataset['dt'] ?? '';
  const c = selected(h);
  const name = c && !('block' in c) ? c.name : null;
  const done = (ok: boolean): true => { if (!ok) h.repaint(); return true; };
  switch (op) {
    case 'noop': return true;
    case 'bare':
    case 'clear':
      if (sel) { sel = null; h.repaint(); }
      return true;
    case 'sel': {
      const carry = carryOf(el.dataset['dtSrc']);
      if (!carry) return true;
      sel = c && keyOf(c) === keyOf(carry) ? null : { key: h.key, carry };
      h.repaint();
      return true;
    }
    case 'to': {
      const to = zonePlace(el.dataset['dtZone']);
      if (!to) return true;
      if (!c) {
        // nothing in hand: "+ New pile" still makes one
        if (to.at === 'newpile') place(h, null, { at: 'arrange', edit: { op: 'newpile' } });
        return true;
      }
      if (to.at === 'table') { sel = null; h.repaint(); return true; }   // bare table puts it down
      if (!legal(h, c, el.dataset['dtZone']!)) return true;
      sel = null;
      return done(place(h, c, to));
    }
    case 'add': {
      // the pinned panel's "add a copy", for a card named in the description
      const card = el.dataset['card'];
      if (card) place(h, { name: card, from: { at: 'drawer' } }, defaultPlace(h));
      return true;
    }
    case 'less':
      if (!c || !name) return true;
      return done(place(h, { name, n: 1, from: c.from }, { at: 'cut' }));
    case 'more':
      if (!c || !name) return true;
      return done(place(h, { name, from: { at: 'drawer' } },
        c.from.at === 'maybe' ? { at: 'maybe' }
          : c.from.at === 'pile' ? { at: 'pile', pile: c.from.pile }
            : { at: 'table' }));
    case 'tomaybe':
    case 'todeck':
    case 'cut': {
      if (!c) return true;
      const to: Place = op === 'tomaybe' ? { at: 'maybe' } : op === 'cut' ? { at: 'cut' } : defaultPlace(h);
      sel = null;
      return done(place(h, c, to));
    }
    case 'putback':
      if (!c) return true;
      sel = null;
      return done(place(h, c, { at: 'table' }));
    case 'putallback':
      return done(place(h, null, { at: 'arrange', edit: { op: 'putallback' } }));
    case 'undo':
      return done(place(h, null, { at: 'arrange', edit: { op: 'undo' } }));
    case 'delpile':
      return done(place(h, null, { at: 'arrange', edit: { op: 'delpile', pile: el.dataset['dtPile'] ?? '' } }));
    case 'view': {
      const v = el.dataset['dtV'] as TableView;
      if (!h.views.includes(v) || v === viewOf(h)) return true;
      sel = null;
      h.setView(v);
      return true;
    }
    case 'split': {
      const v = el.dataset['dtV'] as RowSplit;
      if (!SPLITS.some(g => g.id === v)) return true;
      split = v;
      sel = null;
      h.repaint();
      return true;
    }
    case 'drawer':
      // the button's label follows `html.drawerup` in CSS, so no repaint here
      if (drawerOpen()) closeDrawer(); else openDrawer(h.drawer());
      return true;
    default: return false;
  }
}

// ── the drag provider ─────────────────────────────────────────────────

/** where in a pile or a block the pointer is: a card's top half is "before it" */
function placeAt(zone: HTMLElement, x: number, y: number): Place | null {
  const z = zone.dataset['dtZone'] ?? '';
  const [kind, a, b] = z.split('|');
  if (kind === 'pile' && a) {
    const tiles = [...zone.querySelectorAll<HTMLElement>('[data-dt-src]')];
    for (let k = 0; k < tiles.length; k++) {
      const r = tiles[k]!.getBoundingClientRect();
      const bottom = k + 1 < tiles.length ? tiles[k + 1]!.getBoundingClientRect().top : r.bottom;
      if (y < (r.top + bottom) / 2) return { at: 'pile', pile: a, index: Number(tiles[k]!.dataset['dtI'] ?? 0) };
    }
    const last = tiles[tiles.length - 1];
    return { at: 'pile', pile: a, index: last ? Number(last.dataset['dtI'] ?? 0) + Number(last.dataset['dtN'] ?? 1) : 0 };
  }
  if (kind === 'block' && a !== undefined) {
    const r = zone.getBoundingClientRect();
    const blk = blocks(active?.cards() ?? [])[Number(a)];
    const start = Number(b ?? blk?.start ?? 0);
    return { at: 'gap', gap: x < r.left + r.width / 2 ? start : start + (blk?.n ?? 1) };
  }
  return zonePlace(z);
}

const provider: DragProvider = {
  holdMs: PEEK_MS,
  edgeScroll: true,
  sourceOf(el) {
    const src = el?.closest?.('[data-dt-src]') as HTMLElement | null;
    return src && active && src.isConnected ? src : null;
  },
  plan(src): DragPlan | null {
    const h = active;
    const carry = carryOf(src.dataset['dtSrc']);
    if (!h || !carry) return null;
    const ok = (z: Element | null): z is HTMLElement => !!z && legal(h, carry, (z as HTMLElement).dataset['dtZone'] ?? '');
    const targets = [...document.querySelectorAll<HTMLElement>('[data-dt-zone]')]
      .filter(z => ok(z) && z.dataset['dtZone'] !== 'table');
    return {
      targets,
      zoneAt(el) {
        let z = el?.closest?.('[data-dt-zone]') ?? null;
        while (z && !ok(z)) z = z.parentElement?.closest('[data-dt-zone]') ?? null;
        return z;
      },
      drop(zone, x, y) {
        const to = placeAt(zone as HTMLElement, x, y);
        return !!to && place(h, carry, to);
      },
    };
  },
  started() { sel = null; },
  ended() { active?.dragEnded?.(); flushDrawer(); },
  refind(src) {
    const k = src.dataset['dtSrc'];
    return k ? document.querySelector<HTMLElement>(`[data-dt-src="${CSS.escape(k)}"]`) : null;
  },
};
addDragProvider(provider);

// ── the two listeners a table needs beyond clicks ─────────────────────

let listening = false;
function ensureListeners(): void {
  if (listening || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  listening = true;
  // a pile's name, typed: saved when it is let go of (Enter or a click away)
  document.addEventListener('change', e => {
    const box = e.target as HTMLInputElement | null;
    const pile = box?.dataset?.['dtRename'];
    if (!pile || !active) return;
    place(active, null, { at: 'arrange', edit: { op: 'rename', pile, name: box!.value } });
  });
  document.addEventListener('keydown', e => {
    const box = e.target as HTMLInputElement | null;
    if (e.key === 'Enter' && box?.dataset?.['dtRename']) { box.blur(); return; }
    // Escape puts the card down — after the drawer has had it (its listener
    // is ahead of this one, and says when it took the key)
    if (e.key !== 'Escape' || drawerTookKey(e) || !active || !selected(active)) return;
    sel = null;
    active.repaint();
  });
}
