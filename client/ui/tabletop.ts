/* THE BUILDER'S CONTROLLER — the deck builder that is a card table.
 *
 * Owner, 2026-10-21, on the first try (cards on a table inside the deck
 * page): *"The builder doesn't need to be integrated into the pages. it can be
 * its whole own page and layout … it should be a 'table top deck builder
 * simulator' page thing. And the major issue is that you need to be able to
 * naturally DRAG AND DROP cards. That's critical."*
 *
 * BL-65 (2026-11-04) put it in the app frame (pages/builder.ts draws it): the
 * card POOL across the top (pages/pool.ts, every card a tap adds — it replaced
 * the binder docked down the right), the deck on the felt below as PILES in a
 * wrapping row (pages/table.ts, ui/piletable.ts), the sideboard and Maybe in a
 * rail at the table's right. You pick a card up and put it down:
 *
 *   pool → a pile            one copy into the deck, where you let go
 *   pool → bare table        the same, in a new pile there
 *   a tap on a pool card     one copy to where "Add to" says (Deck · Side · Maybe)
 *   pile → pile              that copy, to exactly where you let go
 *   pile → a gap / table     a new pile there
 *   pile → the pool          that copy out of the deck
 *   pile ↔ Sideboard, Maybe  the rail's two piles
 *   a pile's header          the whole pile, to another place in the row
 *   a tap or click on a card its menu: Remove one · Add another · To sideboard
 *                            · To Maybe · To deck · Move… · Find similar · Details
 *
 * ⚠ EVERY DROP IS A CLICK ROUTE, and `place()` is the only door. A drag drops
 * through `place()`; a tap on a pool card is a `place()`; every menu item, a
 * finger's pick-up-and-put-down, Move…, Re-sort, Undo and Redo, a rename, a
 * new pile — all `place()`. It is the one function here that calls the host's
 * `commit` (ui/test/536 counts the call sites), so whatever a finger can do a
 * mouse can, and the other way round.
 *
 * A TAP ON A TABLE CARD OPENS ITS MENU, with any pointer. With a finger the
 * card is also picked up: a tap on a pile, a gap or another card then puts it
 * there (the finger's drag route, kept from v1 — 541). With a mouse a click
 * elsewhere closes the menu, and Move… arms the same place-by-tap route.
 *
 * UNDO AND REDO are a history of snapshots (ui/history.ts): place() records the
 * state before each change, and an Undo is a commit of the snapshot through the
 * same door.
 *
 * ⚠ ONLY THE PILE UNDER THE CARD LIGHTS. No slot outlines, no list of lit
 * targets (v1's green borders "were super confusing"): the plan passes no
 * targets, the zone under the card gets a soft tint, and the pile opens a gap
 * where the card will land. That gap is the preview, and the drop lands in it.
 *
 * Two hosts, through `TableHost`: the constructed deck (ui/decks.ts — its
 * piles ARE the deck) and the weekly challenge (ui/challenge.ts — its piles
 * are a scratch table, and the deck is an ordered strip under it).
 */
import { allRows } from './cardindex.ts';
import { cardPanelHtml, similarQuery } from './cardpanel.ts';
import { chipState, nextChipState, poolChosen, search as runSearch, type PoolGroup, withChip, withPoolGroup } from './cardsearch.ts';
import {
  deletePile, insertCard, movePile, movePileCard, newPileAt, reconcilePiles, removeAt, renamePile, seedPiles,
  type DeckPile, type ResortBy,
} from './deckarrange.ts';
import { analyzeDeck, ELEMENTS } from './deckstats.ts';
import { sampleOpeningHand } from '../engine/src/challenge.ts';
import { addDragProvider, dragActive, type DragPlan, type DragProvider } from './drag.ts';
import { canRedo, canUndo, emptyHistory, record, redo as redoStep, undo as undoStep, type History, type Snap } from './history.ts';
import {
  cardHeight, cardWidth, fanHeight, insertIndexAt, noImgDrag, previewShift, stripIndexAt, stripOf, type PileCard, type PileView,
} from './piletable.ts';
import { installPressZoom } from './presszoom.ts';
import { installSplitter, readSplit, shownSplit, stepSplit, writeSplit } from './splitter.ts';
import { PEEK_MS, touchSeen } from './touch.ts';
import { elIcon, esc } from './util.ts';
import { builderLoadingHtml, builderView, paintBuilder, type BuilderSheet, type BuilderView } from './pages/builder.ts';
import { facets, filterRailHtml, POOL_BTNS, syntaxHelpHtml } from './pages/cardfilters.ts';
import { deckStatsHtml, sampleHandHtml, statsStripHtml } from './pages/deckstats.ts';
import { frameChromeView, paintFrame } from './pages/frame.ts';
import { poolChipsHtml, poolResultsHtml, type PoolChip, type PoolTarget, type PoolView } from './pages/pool.ts';
import type { TableMenu, TableMenuItem, TableView } from './pages/table.ts';

// ── the host ──────────────────────────────────────────────────────────

export interface TableNext { cards?: string[]; maybe?: string[]; sideboard?: string[]; piles?: DeckPile[] | null }

export interface TableHost {
  /** deck: the piles ARE the deck. challenge: the piles are a scratch table
   * (not in the deck) and the deck is the ordered strip */
  kind: 'deck' | 'challenge';
  /** the `?table=` value: the deck's id, or `ch:<challenge id>` */
  key: string;
  /** the deck's name */
  title(): string;
  /** the Back button's caption */
  backLabel: string;
  /** the deck (ordered, for the challenge) */
  cards(): readonly string[];
  /** the maybeboard; absent = no Maybe pile (the challenge) */
  maybe?(): readonly string[];
  /** the sideboard (docs/22 §4.5); absent = no Sideboard pile (the challenge) */
  side?(): readonly string[];
  /** the sideboard's size: its header says n/this, in red over it */
  sideMax?: number;
  /** the host's rule over a move, or null: a reason here refuses it, and the
   * table shows the reason (the copy cap across deck and sideboard) */
  refuse?(next: TableNext): string | null;
  /** the saved piles; null = never arranged (the deck opens by cost) */
  piles(): readonly DeckPile[] | null;
  /** the deck's cover card, ringed on the table */
  cover?(): string | null;
  /** copies a deck may hold (constructed 2): a pile's header says ×3 in red,
   * and a tap on a pool card at the cap refuses with a note */
  cap?: number;
  /** the legacy summary (count, legality, curve, elements), drawn beside the
   * title when there is no `pill` */
  strip?(): string;
  /** markup under the table: the challenge's deck strip (see STRIP below) */
  below?(): string;
  /** THE ONE WAY IN — the host applies it through its own save funnel */
  commit(next: TableNext): void;
  /** Back: save what is waiting and repaint the page underneath */
  close(): void;

  // ── BL-65 (2026-11-04): the builder in the app frame. All additive and
  // optional: a host that sets none of these draws as before ──────────────

  /** the pool band over the table. ON unless false (or readOnly): every host
   * a builder has is building a deck */
  pool?: boolean;
  /** the toolbar's count pill: its words, its tone, and the lines its
   * "What's wrong" sheet lists (`tt-problems`). Absent = `strip()` as before */
  pill?(): TablePill;
  /** trusted markup: the host's own toolbar buttons, before Undo/Redo/Stats
   * (decks.ts: Deck info; the challenge: Import a deck, Play). A host whose
   * buttons open a sheet of its own calls `tabletopChanged()` to repaint */
  toolsHtml?(): string;
  /** trusted markup: the host's own sheet when one is open, else '' (Deck
   * info, the challenge's import). Drawn inside the page, after the table */
  sheetHtml?(): string;
  /** Esc: close the host's own sheet, if one is open — true when it was (the
   * table then repaints). The table's own sheets close first */
  closeSheet?(): boolean;
  /** the title's own button (the deck name ✎ opens Deck info: `deck-settings`) */
  titleBtn?: string;
  /** shown, not editable: no drag, no card menu, no pool */
  readOnly?: boolean;
  /** the host's own word for the note row (an import's answer), shown when
   * the table has none of its own (a refusal, "Tap where it goes.") */
  note?(): string | null;
}

/** the toolbar's count pill (TableHost.pill) */
export interface TablePill {
  /** "30 cards · legal", "27 / 30", "18 / 30 in the deck" */
  text: string;
  tone: 'ok' | 'warn' | 'bad';
  /** what is wrong, one line each — the "What's wrong" sheet; [] = nothing */
  problems: readonly string[];
}

/** Where a card is picked up from. Indexes are positions in the pile as drawn.
 * `binder` is the pool (the name it had when the pool was a binder; 536 and
 * 541 pin it as the pool's source). */
export type Carry =
  | { from: 'binder'; name: string }
  | { from: 'pile'; pile: string; index: number; name: string }
  | { from: 'maybe'; index: number; name: string }
  | { from: 'side'; index: number; name: string }
  | { from: 'strip'; index: number; name: string }
  | { from: 'head'; pile: string };

/** An arrangement edit: no card moves, but it is still a `place()` */
export type Arrange =
  | { op: 'rename'; pile: string; name: string }
  | { op: 'delpile'; pile: string }
  | { op: 'addpile' }
  | { op: 'resort'; by: ResortBy }
  | { op: 'undo' }
  | { op: 'redo' }
  /** the deck replaced whole (the challenge's Import a deck), undoably */
  | { op: 'set'; cards: string[] };

/** Where it goes. A destination index counts AFTER the carried card has left
 * (ui/deckarrange.ts); absent = the end. `binder` is the pool: out of the deck. */
export type Place =
  | { at: 'pile'; pile: string; index?: number }
  | { at: 'newpile'; pos: number }
  | { at: 'row'; pos: number }
  | { at: 'maybe'; index?: number }
  | { at: 'side'; index?: number }
  | { at: 'strip'; index?: number }
  | { at: 'binder' }
  | { at: 'auto' }
  | { at: 'arrange'; edit: Arrange };

// ── state ─────────────────────────────────────────────────────────────

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let host: TableHost | null = null;
/** a `?table=` the page was loaded with, waiting for its host to exist */
let wanted: string | null = null;
type Resolve = (id: string) => TableHost | null;
/** how many times the waiting `?table=` has been asked for and not found */
let misses = 0;
const resolvers: Partial<Record<TableHost['kind'], Resolve>> = {};
/** the card (or pile) picked: its menu is up, and a finger carries it */
let sel: { key: string; carry: Carry } | null = null;
/** the menu is open for `sel` (Move… closes it and keeps `sel`) */
let menuOpen = false;
/** Move…: the next tap on a pile, a gap or a card puts `sel` there, whatever the pointer */
let armed = false;
/** the card just dropped, drawn in front of its pile until the next pickup */
let front: { zone: string; index: number } | null = null;
/** every change, to take back and put again */
let hist: History | null = null;
/** a paint asked for while a card was in the air */
let paintPending = false;
/** why the host refused the last move — shown until the next one */
let note: string | null = null;
/** the last pointer's type: a finger carries what it taps, a mouse does not */
let lastPointer = 'mouse';
/** the pool: its query (the chips write into it), how many are drawn, where a tap adds */
const PAGE = 120;
let query = '';
let shown = PAGE;
let target: PoolTarget = 'deck';
/** the builder's own sheet */
type SheetKind = 'problems' | 'stats' | 'filters' | 'syntax' | 'details';
let sheetOpen: { kind: SheetKind; card?: string } | null = null;
/** the Stats sheet's sample hand, once dealt */
let hand: string[] | null = null;
/** More filters: which sections are open */
const railOpen: Record<string, boolean> = { element: true, cost: true, kind: true };
/** the table's pane height as last painted */
let paneSeen = 0;

/** a pile's rename box, let go of: once, however it was let go of */
function commitRename(box: HTMLInputElement): void {
  const pile = box.dataset['ttRename'];
  if (!pile || !host || box.dataset['ttDone']) return;
  box.dataset['ttDone'] = '1';
  if (!place(host, null, { at: 'arrange', edit: { op: 'rename', pile, name: box.value } })) paint();
}

export const screen = (): 'tabletop' | null => (host || (wanted && resolverFor(wanted)) ? 'tabletop' : null);

const resolverFor = (key: string): Resolve | undefined =>
  key.startsWith('ch:') ? resolvers.challenge : resolvers.deck;

/** a host's way back in from a reload (`?table=`), registered by main.ts.
 * Null = not yet (its data is still loading, and the host opens the table
 * itself when it lands) or not at all; asked twice with null, it is not at all. */
export function registerTableResolver(kind: TableHost['kind'], fn: Resolve): void {
  resolvers[kind] = fn;
}

const count = (list: readonly string[], name: string): number => list.filter(c => c === name).length;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const pileZone = (id: string): string => `pile|${id}`;
const poolOn = (h: TableHost): boolean => h.pool !== false && !h.readOnly;

/** the piles on the table: a deck's saved ones held to the deck (or, never
 * arranged, the deck by cost); a challenge's scratch piles as saved */
function pilesOf(h: TableHost): DeckPile[] {
  const saved = h.piles();
  if (h.kind !== 'deck') return saved ? saved.map(p => ({ ...p, cards: [...p.cards] })) : [];
  return saved ? reconcilePiles(h.cards(), saved) : seedPiles(h.cards(), 'cost');
}

/** everything the table edits, as it is now */
const snapNow = (h: TableHost): Snap => ({
  cards: h.cards(), maybe: h.maybe?.() ?? null, side: h.side?.() ?? null, piles: h.piles(),
});

/** this table's history (a fresh one for another table) */
const histFor = (h: TableHost): History => (hist && hist.key === h.key ? hist : emptyHistory(h.key));

/** a different table, or the deck reloaded from the server: nothing to take back */
export function clearHistory(): void { hist = null; }

// ── THE ONE DOOR ──────────────────────────────────────────────────────

/**
 * Put `carry` at `to` (or, with `carry` null, apply an arrangement edit).
 * Computes the next state with the pure edits of ui/deckarrange.ts (or the
 * history's snapshot) and hands it to the host's `commit` — the only call of
 * it in this file. False, and nothing committed, when nothing would change.
 */
export function place(h: TableHost, carry: Carry | null, to: Place): boolean {
  const deckPiles = h.kind === 'deck';
  let cards = [...h.cards()];
  let maybe = h.maybe ? [...h.maybe()] : null;
  let side = h.side ? [...h.side()] : null;
  const saved = h.piles();
  note = null;
  let piles = pilesOf(h);
  let landed: { zone: string; index: number } | null = null;
  /** a snapshot's piles to restore, null = back to never arranged; undefined = none */
  let restore: DeckPile[] | null | undefined;
  /** the history after an Undo or a Redo (else: record before the commit) */
  let stepped: History | null = null;

  /** one copy of `name` out of the deck list (constructed: the last copy;
   * order means nothing there) */
  const cutOne = (name: string): void => { const i = cards.lastIndexOf(name); if (i >= 0) cards.splice(i, 1); };

  if (to.at === 'arrange') {
    const e = to.edit;
    if (e.op === 'rename') piles = renamePile(piles, e.pile, e.name);
    else if (e.op === 'delpile') piles = deletePile(piles, e.pile);
    else if (e.op === 'addpile') piles = newPileAt(piles, piles.length);
    else if (e.op === 'resort') piles = seedPiles(deckPiles ? cards : piles.flatMap(p => p.cards), e.by);
    else if (e.op === 'set') cards = [...e.cards];
    else {
      const step = (e.op === 'undo' ? undoStep : redoStep)(histFor(h), snapNow(h));
      if (!step) return false;
      stepped = step.h;
      cards = [...step.to.cards];
      maybe = maybe && step.to.maybe ? [...step.to.maybe] : maybe;
      side = side && step.to.side ? [...step.to.side] : side;
      restore = step.to.piles ? step.to.piles.map(p => ({ ...p, cards: [...p.cards] })) : null;
      if (restore && deckPiles) restore = reconcilePiles(cards, restore);
    }
  } else if (!carry) {
    return false;
  } else if (carry.from === 'head') {
    if (to.at !== 'row') return false;
    const from = piles.findIndex(p => p.id === carry.pile);
    if (from < 0) return false;
    piles = movePile(piles, from, to.pos);
  } else {
    const { name } = carry;
    // 0 — a copy ENTERING the deck (a new one from the pool, tapped, dragged
    // or Add another; or one from Maybe or the Sideboard) stops at the copy
    // cap, the same note for all: nothing moves
    const capped = capNote(h, carry, to);
    if (capped) { note = capped; paintPending = true; return false; }
    // 1 — take it from where it was. A copy leaving the deck for good (the
    // pool, Maybe) leaves the deck list; one moving inside the table does not
    let piece: string | null = name;
    if (carry.from === 'maybe') {
      if (!maybe || maybe[carry.index] !== name) return false;
      maybe.splice(carry.index, 1);
    } else if (carry.from === 'side') {
      if (!side || side[carry.index] !== name) return false;
      side.splice(carry.index, 1);
    } else if (carry.from === 'strip') {
      if (cards[carry.index] !== name) return false;
      cards.splice(carry.index, 1);
    } else if (carry.from === 'pile') {
      const p = piles.find(x => x.id === carry.pile);
      if (!p || p.cards[carry.index] !== name) return false;
      const movingInside = to.at === 'pile' || to.at === 'newpile';
      if (!movingInside) {
        const r = removeAt(piles, carry.pile, carry.index);
        piles = r.piles;
        piece = r.name;
        if (deckPiles) cutOne(name);
      }
    }
    if (!piece) return false;
    // 2 — and put it where it goes
    const intoNewPile = (pos: number): string => {
      piles = newPileAt(piles, pos);
      return piles[Math.max(0, Math.min(pos, piles.length - 1))]!.id;
    };
    if (to.at === 'binder') {
      if (carry.from === 'binder') return false;
    } else if (to.at === 'maybe') {
      if (!maybe) return false;
      const at = Math.max(0, Math.min(to.index ?? maybe.length, maybe.length));
      maybe.splice(at, 0, name);
      landed = { zone: 'maybe', index: at };
    } else if (to.at === 'side') {
      if (!side) return false;
      const at = Math.max(0, Math.min(to.index ?? side.length, side.length));
      side.splice(at, 0, name);
      landed = { zone: 'side', index: at };
    } else if (to.at === 'strip') {
      if (deckPiles) return false;
      const at = Math.max(0, Math.min(to.index ?? cards.length, cards.length));
      cards.splice(at, 0, name);
      landed = { zone: 'strip', index: at };
    } else if (to.at === 'auto') {
      if (carry.from !== 'binder' && carry.from !== 'maybe' && carry.from !== 'side') return false;
      // the reconcile's rule: next to its other copies, else its Re-sort pile
      cards.push(name);
      if (!deckPiles) landed = { zone: 'strip', index: cards.length - 1 };
    } else {
      const pile = to.at === 'pile' ? to.pile : intoNewPile(to.pos);
      const target = piles.find(p => p.id === pile);
      if (!target) return false;
      const index = to.at === 'pile' && to.index !== undefined ? to.index : Number.MAX_SAFE_INTEGER;
      if (carry.from === 'pile') {
        piles = movePileCard(piles, carry.pile, carry.index, pile, index);
      } else {
        piles = insertCard(piles, name, pile, index);
        if (deckPiles) cards.push(name);
      }
      const now = piles.find(p => p.id === pile);
      if (now) landed = { zone: pileZone(pile), index: Math.min(index, now.cards.length - 1) };
    }
  }

  // the arrangement follows the deck, always
  if (deckPiles && restore === undefined) piles = reconcilePiles(cards, piles);
  const next: TableNext = {};
  if (!same(cards, h.cards())) next.cards = cards;
  if (maybe && !same(maybe, h.maybe?.())) next.maybe = maybe;
  if (side && !same(side, h.side?.())) next.sideboard = side;
  if (restore !== undefined) { if (!same(restore, saved)) next.piles = restore; } else if (!same(piles, saved)) next.piles = piles;
  if (!Object.keys(next).length) {
    // an Undo of a change that changed nothing visible still steps
    if (stepped) hist = stepped;
    return false;
  }
  // the host's rule: refused, nothing moves and the reason shows (a drop's
  // paint waits for the card to land — `ended` — and a tap's caller paints).
  // A step through the history restores a state that was, and is never refused
  const why = stepped ? null : h.refuse?.(next) ?? null;
  if (why) { note = why; paintPending = true; return false; }
  hist = stepped ?? record(histFor(h), snapNow(h));
  front = landed;
  h.commit(next);
  return true;
}

/** the host has applied a commit (or its deck changed some other way): the
 * table and the pool's counts follow. Every host calls this from its commit */
export function tabletopChanged(): void {
  if (host) paint();
}

// ── the view ──────────────────────────────────────────────────────────

/** the card width and height this window draws at */
function sizes(): { cw: number; ch: number } {
  const touch = typeof document !== 'undefined' && !!document.documentElement?.classList?.contains?.('touch');
  const cw = cardWidth({ touch, width: typeof innerWidth === 'number' ? innerWidth : 1200 });
  return { cw, ch: cardHeight(cw) };
}

/** the room a pile has to grow in before it tightens: the table pane as last
 * painted, less its head and padding; before the first paint, a guess */
function paneHeight(): number {
  if (paneSeen > 0) return paneSeen;
  const h = typeof innerHeight === 'number' ? innerHeight : 800;
  return Math.max(260, Math.round((h - 150) * (1 - readSplit())) - 90);
}

/** what the pane really holds, measured after a paint (0 = not on screen) */
function measurePane(): number {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return 0;
  const pane = document.querySelector<HTMLElement>('.ttpage .tttable');
  if (!pane || !(pane.clientHeight > 0)) return 0;
  const head = pane.querySelector<HTMLElement>('.tthead');
  return pane.clientHeight - (head?.offsetHeight ?? 0) - 44;
}

/** the selection's own key, matched against each card's data-tt-src */
function srcKey(c: Carry): string {
  switch (c.from) {
    case 'binder': return `binder|${c.name}`;
    case 'pile': return `pile|${c.pile}|${c.index}|${c.name}`;
    case 'maybe': return `maybe|${c.index}|${c.name}`;
    case 'side': return `side|${c.index}|${c.name}`;
    case 'strip': return `strip|${c.index}|${c.name}`;
    default: return `head|${c.pile}`;
  }
}

/** a data-tt-src back into a Carry */
export function carryOf(src: string | undefined): Carry | null {
  if (!src) return null;
  const [kind, ...rest] = src.split('|');
  if (kind === 'binder' && rest.length) return { from: 'binder', name: rest.join('|') };
  if (kind === 'pile' && rest.length >= 3) {
    const [pile, i, ...nm] = rest;
    return { from: 'pile', pile: pile!, index: Number(i), name: nm.join('|') };
  }
  if ((kind === 'maybe' || kind === 'side' || kind === 'strip') && rest.length >= 2) {
    const [i, ...nm] = rest;
    return { from: kind, index: Number(i), name: nm.join('|') };
  }
  if (kind === 'head' && rest.length) return { from: 'head', pile: rest.join('|') };
  return null;
}

export function selected(h: TableHost): Carry | null {
  return sel && sel.key === h.key ? sel.carry : null;
}

/** the card just dropped in `zone`, by index, to be drawn in front — for the
 * markup a host draws itself (the challenge's deck strip, `below()`) */
export const frontIn = (zone: string): number | undefined => (front?.zone === zone ? front.index : undefined);

/** the selection is still there? (a cut, or another device, can take it away) */
function validSelection(h: TableHost, piles: DeckPile[]): void {
  const c = selected(h);
  if (!c) return;
  const ok = c.from === 'pile' ? piles.find(p => p.id === c.pile)?.cards[c.index] === c.name
    : c.from === 'maybe' ? h.maybe?.()[c.index] === c.name
      : c.from === 'side' ? h.side?.()[c.index] === c.name
        : c.from === 'strip' ? h.cards()[c.index] === c.name
          : c.from === 'head' ? piles.some(p => p.id === c.pile) : true;
  if (!ok) putDown();
}

/** copies of `name` the cap counts: the deck and the sideboard together */
const capCount = (h: TableHost, name: string): number => count(h.cards(), name) + count(h.side?.() ?? [], name);

/** the refusal of a copy entering the deck at the copy cap — place() asks it
 * for every carry: a new copy from the pool (tapped or dragged) and one from
 * Maybe count against the deck and sideboard together; one from the Sideboard
 * is already counted, so it stops only when the deck itself is full. A copy
 * moving inside the deck adds nothing (an imported over-cap deck still saves,
 * flagged). Into the Sideboard is the host's rule */
function capNote(h: TableHost, carry: Exclude<Carry, { from: 'head' }>, to: Place): string | null {
  if (h.cap === undefined || h.kind !== 'deck') return null;
  if (to.at === 'maybe' || to.at === 'side') return null;
  if (to.at === 'binder') return null; // back to the pool: out of the deck
  const { name } = carry;
  const full = carry.from === 'binder' || carry.from === 'maybe' ? capCount(h, name) >= h.cap
    : carry.from === 'side' ? count(h.cards(), name) >= h.cap : false;
  return full ? `Max ${h.cap} of ${name}.` : null;
}

/** what can be done to what is picked — its whole menu */
function menuOf(h: TableHost, piles: DeckPile[]): TableMenu | null {
  const c = selected(h);
  if (!c || !menuOpen || h.readOnly) return null;
  const it = (btn: string, label: string, extra: Partial<TableMenuItem> = {}): TableMenuItem => ({ btn, label, ...extra });
  if (c.from === 'head') {
    const i = piles.findIndex(p => p.id === c.pile);
    const p = piles[i];
    return {
      title: p?.name ?? '', for: `head|${c.pile}`, items: [
        ...(i > 0 ? [it('tt-pilemove', '◀ Move left', { attrs: { 'data-tt-by': '-1' } })] : []),
        ...(i < piles.length - 1 ? [it('tt-pilemove', 'Move right ▶', { attrs: { 'data-tt-by': '1' } })] : []),
        ...(p && !p.cards.length && piles.length > 1 ? [it('tt-delpile', 'Delete pile', { attrs: { 'data-tt-pile': c.pile } })] : []),
      ],
    };
  }
  const deck = h.kind === 'deck';
  const inDeck = c.from === 'pile' ? deck : c.from === 'strip';
  const full = deck && h.cap !== undefined && capCount(h, c.name) >= h.cap;
  const items: TableMenuItem[] = [];
  items.push(it('tt-cut', inDeck || c.from === 'side' || c.from === 'maybe' ? 'Remove one' : 'Take off the table'));
  items.push(it('tt-more', 'Add another', { disabled: full }));
  if (h.side && c.from !== 'side') items.push(it('tt-toside', 'To sideboard'));
  if (h.maybe && c.from !== 'maybe') items.push(it('tt-tomaybe', 'To Maybe'));
  if (!inDeck) items.push(it('tt-todeck', 'To deck'));
  items.push(it('tt-move', 'Move…'));
  items.push(it('tt-similar', 'Find similar'));
  items.push(it('tt-details', 'Details'));
  return { title: c.name, for: srcKey(c), items };
}

/** the pool's chips: elements, costs, Unit · Spell (OR inside a group) */
function poolChips(q: string): PoolChip[] {
  const on = (g: PoolGroup, v: string): boolean => poolChosen(q, g).some(x => x.toLowerCase() === v.toLowerCase());
  return [
    ...ELEMENTS.map(el => ({ group: 'el' as const, value: el, label: el, iconHtml: elIcon(el, el), on: on('element', el) })),
    ...['0', '1', '2', '3', '4', '5', '6', '7', '8', 'X'].map(m => ({ group: 'mana' as const, value: m, label: m, on: on('cost', m) })),
    ...[['unit', 'Unit'], ['spell', 'Spell']].map(([v, label]) => ({ group: 'kind' as const, value: v!, label: label!, on: on('kind', v!) })),
  ];
}

const GROUP_OF: Record<PoolChip['group'], PoolGroup> = { el: 'element', mana: 'cost', kind: 'kind' };

/** the pool, as the page draws it */
function poolView(h: TableHost): PoolView | null {
  if (!poolOn(h)) return null;
  const deck = new Map<string, number>(), sideN = new Map<string, number>();
  for (const n of h.cards()) deck.set(n, (deck.get(n) ?? 0) + 1);
  for (const n of h.side?.() ?? []) sideN.set(n, (sideN.get(n) ?? 0) + 1);
  const rows = runSearch(query, {
    pool: allRows().filter(r => r.playable),
    ctx: { copies: n => deck.get(n) ?? 0, maybe: n => count(h.maybe?.() ?? [], n) },
  }).rows;
  const cap = h.kind === 'deck' ? h.cap : undefined;
  const tiles = rows.slice(0, shown).map(r => {
    const inDeck = deck.get(r.name) ?? 0, inSide = sideN.get(r.name) ?? 0;
    return { name: r.name, inDeck, inSide, atCap: cap !== undefined && inDeck + inSide >= cap, over: cap !== undefined && inDeck + inSide > cap };
  });
  const targets: PoolTarget[] = ['deck', ...(h.side ? ['side' as const] : []), ...(h.maybe ? ['maybe' as const] : [])];
  if (!targets.includes(target)) target = 'deck';
  return {
    query, chips: poolChips(query), active: query.trim() !== '', total: rows.length, tiles,
    ...(cap !== undefined ? { cap } : {}),
    target, targets, scrollKey: `tt-pool|${query}`,
  };
}

/** the builder's own sheet, its body drawn */
function sheetOf(h: TableHost): BuilderSheet | null {
  const s = sheetOpen;
  if (!s) return null;
  switch (s.kind) {
    case 'problems': {
      const lines = h.pill?.().problems ?? [];
      return { kind: 'problems', title: 'What’s wrong', width: 'sm',
        bodyHtml: lines.length ? `<ul class="ttproblems">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="dim">Nothing.</p>' };
    }
    case 'stats':
      return { kind: 'stats', title: 'Stats', width: 'md', bodyHtml: deckStatsHtml(analyzeDeck(h.cards())) + sampleHandHtml(hand) };
    case 'filters':
      return { kind: 'filters', title: 'More filters', width: 'md',
        bodyHtml: filterRailHtml({ facets: facets(true), q: query, railOpen }, POOL_BTNS),
        footerHtml: '<button class="cblink" data-btn="tt-filters" data-tt-syntax="1">Search syntax</button>' };
    case 'syntax':
      return { kind: 'syntax', title: 'Search syntax', width: 'lg', bodyHtml: syntaxHelpHtml(POOL_BTNS) };
    case 'details':
      return { kind: 'details', title: s.card ?? '', width: 'sm', bodyHtml: cardPanelHtml(s.card ?? '', { close: 'tt-sheet-close' }) };
  }
}

/** Everything the builder shows, for pages/builder.ts. */
function viewOf(h: TableHost): Omit<BuilderView, 'chrome'> {
  const { cw, ch } = sizes();
  const paneH = paneHeight();
  const piles = pilesOf(h);
  validSelection(h, piles);
  const c = selected(h);
  const cards = h.cards();
  const side = h.side?.() ?? null;
  // the cap counts the deck and the sideboard together (docs/22 §4.1)
  const both = side ? [...cards, ...side] : cards;
  const over = new Map<string, number>();
  if (h.cap !== undefined) for (const n of new Set(both)) { const k = count(both, n); if (k > h.cap) over.set(n, k); }
  const cover = h.cover?.() ?? null;
  const ro = !!h.readOnly;
  /** which card of a pile is picked */
  const picked = (list: PileCard[]): number | undefined => {
    const k = c ? list.findIndex(x => x.src === srcKey(c)) : -1;
    return k < 0 ? undefined : k;
  };
  const pileOf = (p: DeckPile): PileView => {
    const zone = pileZone(p.id);
    const list: PileCard[] = p.cards.map((name, k) => ({ name, src: `pile|${p.id}|${k}|${name}` }));
    return {
      zone, name: p.name, ...(ro ? { tap: { card: null } } : { rename: p.id, head: p.id }),
      cards: list, S: stripOf(list.length, paneH, ch), ch,
      front: front?.zone === zone ? front.index : undefined, picked: picked(list),
      cover, over, cls: c?.from === 'head' && c.pile === p.id ? 'ttpicked' : '',
      deletable: !ro && !p.cards.length && piles.length > 1,
    };
  };
  // the rail's two piles share about the pane's height
  const railH = Math.max(ch + 40, Math.round(paneH / 2));
  const maybe = h.maybe?.() ?? null;
  const maybePile: PileView | null = maybe ? {
    zone: 'maybe', name: 'Maybe', cards: maybe.map((name, k) => ({ name, src: `maybe|${k}|${name}` })),
    S: stripOf(maybe.length, railH, ch), ch, cls: 'ttmaybepile',
    front: front?.zone === 'maybe' ? front.index : undefined,
    picked: picked(maybe.map((name, k) => ({ name, src: `maybe|${k}|${name}` }))),
    ...(ro ? { tap: { card: null } } : {}),
  } : null;
  // the sideboard: the rail's first pile, its header n/7, an empty one a slot
  const sidePile: PileView | null = side ? {
    zone: 'side', name: 'Sideboard', cards: side.map((name, k) => ({ name, src: `side|${k}|${name}` })),
    S: stripOf(side.length, railH, ch), ch, over, cls: 'ttsidepile', slot: true,
    front: front?.zone === 'side' ? front.index : undefined,
    picked: picked(side.map((name, k) => ({ name, src: `side|${k}|${name}` }))),
    ...(h.sideMax !== undefined ? { limit: h.sideMax } : {}),
    ...(ro ? { tap: { card: null } } : {}),
  } : null;
  const table: TableView = {
    cw, ch, piles: piles.map(pileOf),
    newPiles: ro ? null : { emptyText: poolOn(h) ? 'Tap a card above to add it, or drag it here.' : '' },
    ...(ro ? { zoneAttrs: {} } : {}),
    rail: sidePile || maybePile ? { side: sidePile, maybe: maybePile } : null,
    footHtml: h.below?.() ?? '',
    menu: menuOf(h, piles),
    holding: !!c,
  };
  const deck = h.kind === 'deck';
  return {
    title: h.title(),
    ...(h.titleBtn ? { titleBtn: h.titleBtn } : {}),
    backLabel: h.backLabel,
    pill: h.pill?.() ?? null,
    stripHtml: h.pill ? '' : h.strip?.() ?? '',
    hostToolsHtml: h.toolsHtml?.() ?? '',
    canUndo: canUndo(hist, h.key),
    canRedo: canRedo(hist, h.key),
    stats: deck,
    note: note ?? (armed && c ? 'Tap where it goes.' : null) ?? h.note?.() ?? null,
    pool: poolView(h),
    split: readSplit(),
    head: { label: deck ? 'Main deck' : 'Scratch table', count: piles.reduce((n, p) => n + p.cards.length, 0), tools: !ro },
    table,
    statsStripHtml: deck ? statsStripHtml(analyzeDeck(cards)) : '',
    sheet: sheetOf(h),
    hostSheetHtml: h.sheetHtml?.() ?? '',
    readOnly: ro,
  };
}

/** the scroll of each region and the caret are carried by paintBuilder */
function paint(): void {
  if (!$app || !host) return;
  if (dragActive()) { paintPending = true; return; }
  paintPending = false;
  paintBuilder($app, builderView(viewOf(host)));
  // the piles' strips fit the pane: drawn once more if the guess was wrong
  const real = measurePane();
  if (real > 0 && Math.abs(real - paneHeight()) > 8) {
    paneSeen = real;
    paintBuilder($app, builderView(viewOf(host)));
  }
}

/** typing in the pool: the results and the chips only — the box, its caret
 * and everything else stay as they are */
function paintPool(): void {
  if (!$app || !host || typeof $app.querySelector !== 'function') { paint(); return; }
  if (dragActive()) { paintPending = true; return; }
  const v = poolView(host);
  const results = $app.querySelector<HTMLElement>('#tt-results');
  const chips = $app.querySelector<HTMLElement>('#tt-chips');
  if (!v || !results || !chips) { paint(); return; }
  results.innerHTML = noImgDrag(poolResultsHtml(v));
  results.dataset['scroll'] = v.scrollKey;
  results.scrollTop = 0;
  chips.innerHTML = noImgDrag(poolChipsHtml(v));
}

/** put the caret in the pool's search (a mouse only: on a tablet it would raise
 * the keyboard over the table) — for a host that opens a new, empty deck */
export function focusPool(): void {
  if (touchSeen() || typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const box = document.getElementById('tt-q') as HTMLInputElement | null;
  if (!box || typeof box.focus !== 'function') return;
  box.focus({ preventScroll: true });
  box.selectionStart = box.selectionEnd = box.value.length;
}

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('table');
    if (host) url.searchParams.set('table', host.key);
    history.replaceState(null, '', url.toString());
  } catch { /* file:// */ }
}

// ── the screen contract ───────────────────────────────────────────────

export function initTabletop(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  try { wanted = new URLSearchParams(location.search).get('table'); } catch { wanted = null; }
  ensureListeners();
}

/** Open the table for this host, on top of the page that built it. */
export function openTabletop(h: TableHost): void {
  if (!hist || hist.key !== h.key) { hist = null; query = ''; shown = PAGE; target = 'deck'; }
  host = h;
  wanted = null;
  putDown();
  front = null;
  note = null;
  sheetOpen = null;
  syncUrl();
  if ($app) $app.innerHTML = '';
  paint();
  try { scrollTo(0, 0); } catch { /* a page with no window */ }
}

/** Back: the page underneath repaints itself (the host's close). */
export function closeTabletop(): void {
  const h = host;
  host = null;
  wanted = null;
  putDown();
  front = null;
  sheetOpen = null;
  syncUrl();
  if (h) h.close(); else rerenderHost();
}

export function renderScreen(): void {
  if (!host && wanted) {
    const got = resolverFor(wanted)?.(wanted.startsWith('ch:') ? wanted.slice(3) : wanted) ?? null;
    if (got) { openTabletop(got); return; }
    if (++misses > 1) { wanted = null; syncUrl(); rerenderHost(); return; }
    if ($app) paintFrame($app, builderLoadingHtml(frameChromeView()));
    return;
  }
  paint();
}

// ── clicks ────────────────────────────────────────────────────────────

/** where a tap on a zone puts what is picked up */
function zonePlace(h: TableHost, zone: string): Place | null {
  const [kind, a] = zone.split('|');
  if (kind === 'pile' && a) return { at: 'pile', pile: a };
  if (kind === 'gap' && a !== undefined) return { at: 'newpile', pos: Number(a) };
  if (kind === 'end') return { at: 'newpile', pos: pilesOf(h).length };
  if (kind === 'maybe') return { at: 'maybe' };
  if (kind === 'side') return { at: 'side' };
  if (kind === 'strip') return { at: 'strip' };
  if (kind === 'binder') return { at: 'binder' };
  return null;
}

/** a tap on card `k` of `zone` with `c` picked up: the card goes BEFORE it —
 * counted, as every destination is, after the carried card has left */
function beforeCard(c: Carry, zone: string, k: number): Place | null {
  const [kind, a] = zone.split('|');
  const sameZone = (c.from === 'pile' && kind === 'pile' && c.pile === a)
    || (c.from === 'maybe' && kind === 'maybe') || (c.from === 'side' && kind === 'side')
    || (c.from === 'strip' && kind === 'strip');
  const src = sameZone && 'index' in c ? c.index : -1;
  const index = src >= 0 && k > src ? k - 1 : k;
  if (kind === 'pile' && a) return { at: 'pile', pile: a, index };
  if (kind === 'maybe') return { at: 'maybe', index };
  if (kind === 'side') return { at: 'side', index };
  if (kind === 'strip') return { at: 'strip', index };
  return null;
}

/** right after the picked copy: where Add another puts a new one */
function afterCard(c: Carry): Place | null {
  switch (c.from) {
    case 'pile': return { at: 'pile', pile: c.pile, index: c.index + 1 };
    case 'maybe': return { at: 'maybe', index: c.index + 1 };
    case 'side': return { at: 'side', index: c.index + 1 };
    case 'strip': return { at: 'strip', index: c.index + 1 };
    default: return null;
  }
}

/** a finger carries what it picked; a mouse only once Move… has armed it */
const carrying = (): boolean => armed || lastPointer !== 'mouse';

/** put the pick down: no menu, nothing carried */
function putDown(): void { sel = null; menuOpen = false; armed = false; }

/** main.ts offers every button here. True when it was ours. */
export function handleButton(el: HTMLElement): boolean {
  const b = el.dataset['btn'] ?? '';
  if (!b.startsWith('tt-')) return false;
  const h = host;
  if (!h) return true;
  const c = selected(h);
  const put = (to: Place): void => { const carry = c; putDown(); if (!carry || !place(h, carry, to)) paint(); };
  switch (b) {
    case 'tt-close': closeTabletop(); return true;
    case 'tt-card': {
      if (h.readOnly) return true;
      const carry = carryOf(el.dataset['ttSrc']);
      if (!carry || carry.from === 'head') return true;
      if (c && srcKey(c) === srcKey(carry)) { putDown(); paint(); return true; }
      if (c && carrying()) {
        const zone = (el.closest?.('[data-tt-zone]') as HTMLElement | null)?.dataset['ttZone'] ?? '';
        const to = c.from === 'head' ? null : beforeCard(c, zone, Number(el.dataset['ttI'] ?? 0));
        if (to) { put(to); return true; }
      }
      // A TAP OPENS THE MENU — and a finger carries the card besides
      sel = { key: h.key, carry };
      menuOpen = true;
      armed = false;
      paint();
      return true;
    }
    case 'tt-add': {
      // a tap on a pool card: one copy to where "Add to" says
      const carry = carryOf(el.dataset['ttSrc']);
      if (!carry || carry.from !== 'binder' || h.readOnly) return true;
      putDown();
      const to: Place = target === 'side' && h.side ? { at: 'side' } : target === 'maybe' && h.maybe ? { at: 'maybe' } : { at: 'auto' };
      if (!place(h, carry, to)) paint();
      return true;
    }
    case 'tt-rename': {
      // the name becomes a box, in place — no repaint, so the caret stays
      const pile = el.dataset['ttPile'] ?? '';
      if (typeof document.createElement !== 'function' || !el.replaceWith) return true;
      const box = document.createElement('input');
      box.className = 'ttpilename ttrenaming';
      box.value = box.defaultValue = el.textContent ?? '';
      box.maxLength = 40;
      box.spellcheck = false;
      box.autocomplete = 'off';
      box.setAttribute('aria-label', 'pile name');
      box.dataset['ttRename'] = pile;
      el.replaceWith(box);
      box.focus();
      box.select();
      // let go of: saved, or (unchanged) back to text
      box.addEventListener('blur', () => { if (box.isConnected) commitRename(box); });
      return true;
    }
    case 'tt-head': {
      // the grip picks the pile up: its menu moves it (a mouse can drag the header too)
      const pile = el.dataset['ttPile'] ?? '';
      if (c?.from === 'head' && c.pile === pile) putDown();
      else { sel = { key: h.key, carry: { from: 'head', pile } }; menuOpen = true; armed = false; }
      paint();
      return true;
    }
    case 'tt-pilemove': {
      // the pile stays picked, so ◀ ▶ can be tapped again
      if (c?.from !== 'head') return true;
      const piles = pilesOf(h);
      const i = piles.findIndex(p => p.id === c.pile);
      if (!place(h, c, { at: 'row', pos: i + Number(el.dataset['ttBy'] ?? 0) })) paint();
      return true;
    }
    case 'tt-to': {
      if (!c) return true;
      // a click on the felt with the menu up only closes it
      if (!carrying()) { putDown(); paint(); return true; }
      const to = zonePlace(h, el.dataset['ttZone'] ?? '');
      if (!to) return true;
      if (c.from === 'head') {
        const [kind, a] = (el.dataset['ttZone'] ?? '').split('|');
        if (kind !== 'gap') return true;
        const from = pilesOf(h).findIndex(p => p.id === c.pile);
        const pos = Number(a);
        put({ at: 'row', pos: pos > from ? pos - 1 : pos });
        return true;
      }
      put(to);
      return true;
    }
    case 'tt-cut': put({ at: 'binder' }); return true;
    case 'tt-tomaybe': put({ at: 'maybe' }); return true;
    case 'tt-toside': put({ at: 'side' }); return true;
    case 'tt-todeck': put(h.kind === 'deck' ? { at: 'auto' } : { at: 'strip' }); return true;
    case 'tt-newpile': put({ at: 'newpile', pos: pilesOf(h).length }); return true;
    case 'tt-more': {
      // Add another: a new copy right after this one; the menu stays on it
      if (!c || c.from === 'head') return true;
      const to = afterCard(c);
      if (!to || !place(h, { from: 'binder', name: c.name }, to)) paint();
      return true;
    }
    case 'tt-move': {
      // Move…: the menu goes, the card stays picked; the next tap puts it there
      if (!c) return true;
      menuOpen = false;
      armed = true;
      paint();
      return true;
    }
    case 'tt-putdown': putDown(); paint(); return true;
    case 'tt-delpile':
      putDown();
      if (!place(h, null, { at: 'arrange', edit: { op: 'delpile', pile: el.dataset['ttPile'] ?? '' } })) paint();
      return true;
    case 'tt-addpile':
      putDown();
      if (!place(h, null, { at: 'arrange', edit: { op: 'addpile' } })) paint();
      return true;
    case 'tt-resort': {
      const by = el.dataset['ttBy'] as ResortBy;
      if (by !== 'cost' && by !== 'type' && by !== 'element') return true;
      putDown();
      if (!place(h, null, { at: 'arrange', edit: { op: 'resort', by } })) paint();
      return true;
    }
    case 'tt-undo':
    case 'tt-redo':
      putDown();
      if (!place(h, null, { at: 'arrange', edit: { op: b === 'tt-undo' ? 'undo' : 'redo' } })) paint();
      return true;
    // ── the pool ──
    case 'tt-chip': {
      const value = el.dataset['value'] ?? '';
      const group = el.dataset['group'] as PoolChip['group'] | undefined;
      if (group && GROUP_OF[group]) {
        // the pool's own chips: OR inside the group
        const g = GROUP_OF[group];
        const now = poolChosen(query, g);
        const has = now.some(v => v.toLowerCase() === value.toLowerCase());
        query = withPoolGroup(query, g, has ? now.filter(v => v.toLowerCase() !== value.toLowerCase()) : [...now, value]);
      } else {
        // More filters' chips: include, exclude, clear — the Cards page's cycle
        const key = el.dataset['key'] ?? '';
        query = withChip(query, key, value, nextChipState(chipState(query, key, value)));
      }
      shown = PAGE;
      paint();
      return true;
    }
    case 'tt-clear': query = ''; shown = PAGE; paint(); return true;
    case 'tt-show': shown += PAGE; paintPool(); return true;
    case 'tt-target': {
      const to = el.dataset['to'] as PoolTarget;
      if (to === 'deck' || to === 'side' || to === 'maybe') target = to;
      paint();
      return true;
    }
    case 'tt-similar':
      if (c && c.from !== 'head') { query = similarQuery(c.name); shown = PAGE; }
      putDown();
      paint();
      return true;
    case 'tt-try': query = el.dataset['q'] ?? ''; shown = PAGE; paint(); return true;
    case 'tt-section': {
      const s = el.dataset['section'] ?? '';
      railOpen[s] = !railOpen[s];
      paint();
      return true;
    }
    // ── the sheets ──
    case 'tt-filters': sheetOpen = { kind: el.dataset['ttSyntax'] ? 'syntax' : 'filters' }; putDown(); paint(); return true;
    case 'tt-stats': sheetOpen = { kind: 'stats' }; hand = null; putDown(); paint(); return true;
    case 'tt-hand': hand = sampleOpeningHand(h.cards(), Math.random); paint(); return true;
    case 'tt-problems': sheetOpen = { kind: 'problems' }; putDown(); paint(); return true;
    case 'tt-details':
      if (c && c.from !== 'head') sheetOpen = { kind: 'details', card: c.name };
      putDown();
      paint();
      return true;
    case 'tt-sheet-close': sheetOpen = null; paint(); return true;
    // ── the divider's tap route ──
    case 'tt-split': writeSplit(stepSplit(shownSplit(el.closest?.('.ttbuilder') ?? null) ?? readSplit(), Number(el.dataset['by'] ?? 0))); paneSeen = 0; paint(); return true;
    default: return true;
  }
}

// ── the drag provider ─────────────────────────────────────────────────

/** what a carried card may be dropped on */
function legalZone(h: TableHost, c: Carry, zone: string): boolean {
  const kind = zone.split('|')[0];
  if (c.from === 'head') return kind === 'gap' || kind === 'pile' || kind === 'end';
  switch (kind) {
    case 'binder': return c.from !== 'binder';
    case 'maybe': return !!h.maybe;
    case 'side': return !!h.side;
    case 'strip': return h.kind !== 'deck';
    case 'pile': case 'gap': case 'end': return true;
    default: return false;
  }
}

interface Geo { fan: HTMLElement; S: number; n: number; src: number; axis: 'x' | 'y' }

/** a zone's fan, its strip, its count without the carried card, and where
 * the carried card sits in it (-1 when it comes from elsewhere) */
function geoOf(zone: HTMLElement, c: Carry): Geo | null {
  const fan = zone.querySelector<HTMLElement>('.ttfan');
  if (!fan || c.from === 'head') return null;
  const key = zone.dataset['ttZone'] ?? '';
  const S = Number(zone.dataset['ttS'] ?? 0) || 1;
  const all = Number(zone.dataset['ttN'] ?? fan.children.length);
  const [kind, a] = key.split('|');
  const mine = (c.from === 'pile' && kind === 'pile' && c.pile === a)
    || (c.from === 'maybe' && kind === 'maybe') || (c.from === 'side' && kind === 'side')
    || (c.from === 'strip' && kind === 'strip');
  const src = mine && 'index' in c ? c.index : -1;
  return { fan, S, n: all - (src >= 0 ? 1 : 0), src, axis: zone.dataset['ttAxis'] === 'x' ? 'x' : 'y' };
}

/** where in a zone the pointer is, as the Place a drop there commits */
function placeAt(h: TableHost, c: Carry, zone: HTMLElement, x: number, y: number): Place | null {
  const key = zone.dataset['ttZone'] ?? '';
  const [kind, a] = key.split('|');
  if (c.from === 'head') {
    const piles = pilesOf(h);
    const from = piles.findIndex(p => p.id === c.pile);
    let pos: number;
    if (kind === 'gap') pos = Number(a);
    else if (kind === 'end') pos = piles.length;
    else {
      const i = piles.findIndex(p => p.id === a);
      const r = zone.getBoundingClientRect();
      pos = x < r.left + r.width / 2 ? i : i + 1;
    }
    return { at: 'row', pos: pos > from ? pos - 1 : pos };
  }
  const g = geoOf(zone, c);
  if (g) {
    const r = g.fan.getBoundingClientRect();
    const { cw, ch } = sizes();
    const index = g.axis === 'x'
      ? stripIndexAt(x, r.left, 0, g.S, g.n, cw)
      : insertIndexAt(y, r.top, g.S, g.n, ch);
    if (kind === 'pile' && a) return { at: 'pile', pile: a, index };
    if (kind === 'maybe') return { at: 'maybe', index };
    if (kind === 'side') return { at: 'side', index };
    if (kind === 'strip') return { at: 'strip', index };
  }
  return zonePlace(h, key);
}

/** the preview on screen: the fan whose cards slid, and the zone it is for */
let preview: { fan: HTMLElement; zone: HTMLElement; key: string; height: string } | null = null;
let previewEdge: HTMLElement | null = null;

function clearPreview(): void {
  if (preview) {
    for (const el of [...preview.fan.children] as HTMLElement[]) { el.style.transform = ''; el.classList.remove('ttgone'); }
    preview.fan.style.height = preview.height;
    preview.zone.classList.remove('ttbefore', 'ttafter');
    preview = null;
  }
  previewEdge?.classList.remove('ttbefore', 'ttafter');
  previewEdge = null;
}

/** open the gap where the card would land: the cards from there slide down
 * (or along) one strip, and the carried card's own place closes up */
function showPreview(h: TableHost, c: Carry, zone: HTMLElement | null, x: number, y: number): void {
  if (!zone) { clearPreview(); return; }
  const to = placeAt(h, c, zone, x, y);
  const key = `${zone.dataset['ttZone']}#${to && 'index' in to ? to.index : to && 'pos' in to ? to.pos : ''}`;
  if (preview?.key === key || previewEdge && preview === null && previewEdge.dataset['ttKey'] === key) return;
  clearPreview();
  if (c.from === 'head') {
    // a pile in the air: the pile it would land beside shows the edge
    if (zone.classList.contains('ttpile')) {
      const r = zone.getBoundingClientRect();
      zone.classList.add(x < r.left + r.width / 2 ? 'ttbefore' : 'ttafter');
      previewEdge = zone;
      zone.dataset['ttKey'] = key;
    }
    return;
  }
  const g = geoOf(zone, c);
  if (!g || !to || !('index' in to) || to.index === undefined) return;
  const cards = [...g.fan.children] as HTMLElement[];
  preview = { fan: g.fan, zone, key, height: g.fan.style.height };
  cards.forEach((el, k) => {
    if (k === g.src) { el.classList.add('ttgone'); return; }
    const shift = previewShift(k, g.src, to.index!) * g.S;
    el.style.transform = shift ? (g.axis === 'x' ? `translateX(${shift}px)` : `translateY(${shift}px)`) : '';
  });
  if (g.axis === 'y') g.fan.style.height = `${fanHeight(g.n + 1, g.S, sizes().ch)}px`;
}

const provider: DragProvider = {
  holdMs: PEEK_MS,
  edgeScroll: true,
  pressLift: true,
  sourceOf(el) {
    if (!host || host.readOnly || !el?.closest) return null;
    if (!el.closest('.ttpage') || el.closest('input, summary, .ttpop, [data-sheet]')) return null;
    const head = el.closest('[data-tt-head]') as HTMLElement | null;
    if (head) return head.closest('.ttpile') as HTMLElement | null;
    return el.closest('[data-tt-src]') as HTMLElement | null;
  },
  plan(src): DragPlan | null {
    const h = host;
    const head = src.querySelector?.(':scope > [data-tt-head]') as HTMLElement | null;
    const carry = src.classList.contains('ttpile') && head
      ? carryOf(`head|${head.dataset['ttHead']}`) : carryOf(src.dataset['ttSrc']);
    if (!h || !carry || h.readOnly) return null;
    const ok = (z: Element | null): z is HTMLElement =>
      !!z && legalZone(h, carry, (z as HTMLElement).dataset['ttZone'] ?? '');
    // a pile in the air shows where it would go as an edge, not a new pile's place
    document.documentElement.classList.toggle('ttcarrypile', carry.from === 'head');
    return {
      targets: [],
      zoneAt(el) {
        let z = el?.closest?.('[data-tt-zone]') ?? null;
        while (z && !ok(z)) z = z.parentElement?.closest('[data-tt-zone]') ?? null;
        // the bare felt means "a new pile at the end": light the end slot
        if (z && z.classList.contains('tttable')) z = z.querySelector('.ttend') ?? z;
        return z;
      },
      over(zone, x, y) { showPreview(h, carry, zone as HTMLElement | null, x, y); },
      drop(zone, x, y) {
        const to = placeAt(h, carry, zone as HTMLElement, x, y);
        return !!to && place(h, carry, to);
      },
    };
  },
  started() {
    putDown();
    front = null;
    for (const el of document.querySelectorAll('.ttfront')) el.classList.remove('ttfront');
    for (const el of document.querySelectorAll('details.ttresort[open]')) el.removeAttribute('open');
    // the menu goes at once (nothing repaints while a card is in the air)
    for (const el of document.querySelectorAll('.ttpop')) el.remove();
  },
  ended() {
    clearPreview();
    document.documentElement.classList.remove('ttcarrypile');
    if (paintPending) paint();
  },
  refind(src) {
    const k = src.dataset['ttSrc'] ?? src.dataset['ttZone'];
    const attr = src.dataset['ttSrc'] !== undefined ? 'data-tt-src' : 'data-tt-zone';
    return k ? document.querySelector<HTMLElement>(`[${attr}="${CSS.escape(k)}"]`) : null;
  },
};
addDragProvider(provider);
/** the table's one drag provider, for the tests that drop through it */
export const tableDrag: DragProvider = provider;

// ── the listeners a table needs beyond clicks ─────────────────────────

/** a text box has the keys (a shortcut there is the box's own) — except the
 * pool's search while it is empty, which gives Undo back to the table */
function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el?.tagName) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  if (el.tagName === 'INPUT') return !(el.id === 'tt-q' && !(el as HTMLInputElement).value);
  return false;
}

let listening = false;
function ensureListeners(): void {
  if (listening || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  listening = true;
  // press and hold a card (or press the wheel on it) to read it big
  installPressZoom();
  // the divider: its drag repaints once, on the release
  installSplitter(() => { paneSeen = 0; if (host) paint(); });
  // the pointer that pressed decides whether a tap carries the card (a finger
  // does, a mouse does not) — noted before the click is dispatched
  document.addEventListener('pointerdown', e => { lastPointer = e.pointerType || 'mouse'; }, { capture: true, passive: true });
  // a mouse click anywhere on the page that is not one of ours closes the card menu
  document.addEventListener('click', e => {
    if (!host || !sel || carrying()) return;
    const t = e.target as HTMLElement | null;
    if (!t?.closest || t.closest('.ttpop, [data-btn^="tt-"]') || !t.closest('.ttpage')) return;
    putDown();
    paint();
  });
  // the pool's search, typed into: the results only, so the caret is never touched
  document.addEventListener('input', e => {
    const box = e.target as HTMLInputElement | null;
    if (!host || box?.id !== 'tt-q') return;
    query = box.value;
    shown = PAGE;
    paintPool();
  });
  // a pile's name, typed: never repainted while typed into; saved when let go
  document.addEventListener('change', e => {
    const box = e.target as HTMLInputElement | null;
    const pile = box?.dataset?.['ttRename'];
    if (!pile || !host) return;
    commitRename(box!);
  });
  document.addEventListener('keydown', e => {
    const box = e.target as HTMLInputElement | null;
    // Enter saves at once (a blur is not always delivered — a window
    // without focus never sends one); Escape keeps the old name
    if (e.key === 'Enter' && box?.dataset?.['ttRename']) { commitRename(box); return; }
    if (e.key === 'Escape' && box?.dataset?.['ttRename']) { e.stopPropagation(); box.value = box.defaultValue; commitRename(box); return; }
    if (!host) return;
    // Undo, Redo — but never a text box's own
    const mod = e.ctrlKey || e.metaKey;
    const k = (e.key ?? '').toLowerCase();
    if (mod && !e.altKey && (k === 'z' || k === 'y') && !typing(e.target) && !host.readOnly) {
      e.preventDefault();
      const op = k === 'y' || e.shiftKey ? 'redo' : 'undo';
      putDown();
      if (!place(host, null, { at: 'arrange', edit: { op } })) paint();
      return;
    }
    // Escape: the table's sheet, then the host's, then the pick. The page
    // itself has no Escape: it is a page, not a dialog
    if (e.key !== 'Escape') return;
    if (sheetOpen) { e.stopPropagation(); sheetOpen = null; paint(); return; }
    if (host.closeSheet?.()) { e.stopPropagation(); paint(); return; }
    if (!selected(host)) return;
    e.stopPropagation();
    putDown();
    paint();
  }, { capture: true });
  // hovering another card of the pile hands "in front" over to it
  document.addEventListener('mouseover', e => {
    if (!front || dragActive()) return;
    const card = (e.target as HTMLElement | null)?.closest?.('.ttcard');
    if (!card || card.classList.contains('ttfront')) return;
    const fan = card.parentElement;
    const was = fan?.querySelector?.('.ttfront');
    if (!was) return;
    was.classList.remove('ttfront');
    front = null;
  });
  // the card width and the strips follow the window
  if (typeof addEventListener === 'function') {
    addEventListener('resize', () => { if (host && $app?.firstElementChild?.classList?.contains('ttpage')) { paneSeen = 0; paint(); } });
  }
}
