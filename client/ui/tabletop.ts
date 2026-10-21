/* THE TABLETOP — a deck builder page that is a card table.
 *
 * Owner, 2026-10-21, on the first try (cards on a table inside the deck
 * page): *"The builder doesn't need to be integrated into the pages. it can be
 * its whole own page and layout … it should be a 'table top deck builder
 * simulator' page thing. And the major issue is that you need to be able to
 * naturally DRAG AND DROP cards. That's critical."*
 *
 * So this is a page of its own, reached by "Build on the table" from the deck
 * page (and the challenge page), with a Back button. The deck lies on a felt
 * as PILES in a wrapping row (ui/piletable.ts draws one); the binder
 * (ui/binder.ts) is docked down the right with every card. You pick a card up
 * and put it down:
 *
 *   binder → a pile          one copy into the deck, where you let go
 *   binder → bare table      the same, in a new pile there
 *   pile → pile              that copy, to exactly where you let go
 *   pile → a gutter / table  a new pile there
 *   pile → binder            that copy out of the deck
 *   pile ↔ Maybe             the maybeboard is a pile at the table's edge
 *   a pile's header          the whole pile, to another place in the row
 *
 * Re-sort lays it all out again by cost, type or element, with one Undo. A
 * deck nobody has arranged opens as piles by cost.
 *
 * ⚠ EVERY DROP IS A CLICK ROUTE, and `place()` is the only door. A drag drops
 * through `place()`; a finger can also TAP a card to pick it up and tap where
 * it goes, and that calls the same `place()`; the binder's + is a `place()`;
 * Re-sort, Undo, a rename, a new pile — all `place()`. It is the one function
 * here that calls the host's `commit`, so whatever a finger can do a mouse
 * can, and the other way round (ui/test/536 counts the call sites). A mouse
 * click does NOT pick a card up — it pins the card in the binder to read —
 * because tap-to-pick-up was the whole of v1's mouse experience ("It was all
 * click and click again to drop"). The pointer decides, never the device.
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
import { addDragProvider, dragActive, type DragPlan, type DragProvider } from './drag.ts';
import { binderTookKey, closeBinder, flushBinder, openBinder, pinCard, type BinderHost } from './binder.ts';
import {
  deletePile, insertCard, movePile, movePileCard, newPileAt, reconcilePiles, removeAt, renamePile, seedPiles,
  type DeckPile, type ResortBy,
} from './deckarrange.ts';
import {
  cardHeight, cardWidth, fanHeight, insertIndexAt, noImgDrag, pileHtml, previewShift, stripIndexAt, stripOf, type PileCard,
} from './piletable.ts';
import { PEEK_MS } from './touch.ts';
import { esc } from './util.ts';

// ── the host ──────────────────────────────────────────────────────────

export interface TableNext { cards?: string[]; maybe?: string[]; piles?: DeckPile[] | null }

export interface TableHost {
  /** deck: the piles ARE the deck. challenge: the piles are a scratch table
   * (not in the deck) and the deck is the ordered strip */
  kind: 'deck' | 'challenge';
  /** the `?table=` value: the deck's id, or `ch:<challenge id>` */
  key: string;
  /** the deck's name */
  title(): string;
  /** the Back button's words */
  backLabel: string;
  /** the deck (ordered, for the challenge) */
  cards(): readonly string[];
  /** the maybeboard; absent = no Maybe pile (the challenge) */
  maybe?(): readonly string[];
  /** the saved piles; null = never arranged (the deck opens by cost) */
  piles(): readonly DeckPile[] | null;
  /** the deck's cover card, ringed on the table */
  cover?(): string | null;
  /** copies a deck may hold (constructed 2): a pile's header says ×3 in red */
  cap?: number;
  /** the top bar's deck summary (count, legality, curve, elements) */
  strip?(): string;
  /** markup under the table: the challenge's deck strip (see STRIP below) */
  below?(): string;
  /** THE ONE WAY IN — the host applies it through its own save funnel */
  commit(next: TableNext): void;
  /** Back: save what is waiting and repaint the page underneath */
  close(): void;
  /** the full card browser with this query */
  fullBrowser(query: string): void;
}

/** Where a card is picked up from. Indexes are positions in the pile as drawn. */
export type Carry =
  | { from: 'binder'; name: string }
  | { from: 'pile'; pile: string; index: number; name: string }
  | { from: 'maybe'; index: number; name: string }
  | { from: 'strip'; index: number; name: string }
  | { from: 'head'; pile: string };

/** An arrangement edit: no card moves, but it is still a `place()` */
export type Arrange =
  | { op: 'rename'; pile: string; name: string }
  | { op: 'delpile'; pile: string }
  | { op: 'resort'; by: ResortBy }
  | { op: 'undo' };

/** Where it goes. A destination index counts AFTER the carried card has left
 * (ui/deckarrange.ts); absent = the end. */
export type Place =
  | { at: 'pile'; pile: string; index?: number }
  | { at: 'newpile'; pos: number }
  | { at: 'row'; pos: number }
  | { at: 'maybe'; index?: number }
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
/** what a finger has picked up (touch only) */
let sel: { key: string; carry: Carry } | null = null;
/** the card just dropped, drawn in front of its pile until the next pickup */
let front: { zone: string; index: number } | null = null;
/** Re-sort's one step back, gone after the next edit */
let undo: { key: string; piles: DeckPile[] | null } | null = null;
/** a paint asked for while a card was in the air */
let paintPending = false;
/** the last pointer's type: a mouse click pins, a tap picks up */
let lastPointer = 'mouse';
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

/** the piles on the table: a deck's saved ones held to the deck (or, never
 * arranged, the deck by cost); a challenge's scratch piles as saved */
function pilesOf(h: TableHost): DeckPile[] {
  const saved = h.piles();
  if (h.kind !== 'deck') return saved ? saved.map(p => ({ ...p, cards: [...p.cards] })) : [];
  return saved ? reconcilePiles(h.cards(), saved) : seedPiles(h.cards(), 'cost');
}

// ── THE ONE DOOR ──────────────────────────────────────────────────────

/**
 * Put `carry` at `to` (or, with `carry` null, apply an arrangement edit or a
 * binder add). Computes the next state with the pure edits of
 * ui/deckarrange.ts and hands it to the host's `commit` — the only call of it
 * in this file. False, and nothing committed, when nothing would change.
 */
export function place(h: TableHost, carry: Carry | null, to: Place): boolean {
  const deckPiles = h.kind === 'deck';
  const cards = [...h.cards()];
  const maybe = h.maybe ? [...h.maybe()] : null;
  const saved = h.piles();
  let piles = pilesOf(h);
  let keepUndo = false;
  let landed: { zone: string; index: number } | null = null;
  /** Undo's piles, null = back to never arranged; undefined = not an Undo */
  let restore: DeckPile[] | null | undefined;

  /** one copy of `name` out of the deck list (constructed: the last copy;
   * order means nothing there) */
  const cutOne = (name: string): void => { const i = cards.lastIndexOf(name); if (i >= 0) cards.splice(i, 1); };

  if (to.at === 'arrange') {
    const e = to.edit;
    if (e.op === 'rename') piles = renamePile(piles, e.pile, e.name);
    else if (e.op === 'delpile') piles = deletePile(piles, e.pile);
    else if (e.op === 'resort') {
      undo = { key: h.key, piles: saved ? saved.map(p => ({ ...p, cards: [...p.cards] })) : null };
      keepUndo = true;
      piles = seedPiles(deckPiles ? cards : piles.flatMap(p => p.cards), e.by);
    } else {
      if (!undo || undo.key !== h.key) return false;
      restore = undo.piles && deckPiles ? reconcilePiles(cards, undo.piles) : undo.piles;
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
    // 1 — take it from where it was. A copy leaving the deck for good (the
    // binder, Maybe) leaves the deck list; one moving inside the table does not
    let piece: string | null = name;
    if (carry.from === 'maybe') {
      if (!maybe || maybe[carry.index] !== name) return false;
      maybe.splice(carry.index, 1);
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
    } else if (to.at === 'strip') {
      if (deckPiles) return false;
      const at = Math.max(0, Math.min(to.index ?? cards.length, cards.length));
      cards.splice(at, 0, name);
      landed = { zone: 'strip', index: at };
    } else if (to.at === 'auto') {
      if (carry.from !== 'binder' && carry.from !== 'maybe') return false;
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
  if (deckPiles) piles = reconcilePiles(cards, piles);
  const next: TableNext = {};
  if (!same(cards, h.cards())) next.cards = cards;
  if (maybe && !same(maybe, h.maybe?.())) next.maybe = maybe;
  if (restore !== undefined) next.piles = restore;
  else if (!same(piles, saved)) next.piles = piles;
  if (!Object.keys(next).length) return false;
  if (!keepUndo) undo = null;
  front = landed;
  h.commit(next);
  return true;
}

/** the host has applied a commit (or its deck changed some other way): the
 * table and the binder's counts follow. Every host calls this from its commit */
export function tabletopChanged(): void {
  if (host) paint();
}

// ── markup ────────────────────────────────────────────────────────────

/** the card width and height this window draws at */
function sizes(): { cw: number; ch: number } {
  const touch = typeof document !== 'undefined' && !!document.documentElement?.classList?.contains?.('touch');
  const cw = cardWidth({ touch, width: typeof innerWidth === 'number' ? innerWidth : 1200 });
  return { cw, ch: cardHeight(cw) };
}

/** the table pane's height, for how far a pile may grow before it tightens */
function paneHeight(): number {
  const pane = typeof document.querySelector === 'function' ? document.querySelector<HTMLElement>('.tttable') : null;
  const h = pane?.clientHeight ?? 0;
  return h > 0 ? h - 40 : Math.max(300, (typeof innerHeight === 'number' ? innerHeight : 800) - 170);
}

/** the selection's own key, matched against each card's data-tt-src */
function srcKey(c: Carry): string {
  switch (c.from) {
    case 'binder': return `binder|${c.name}`;
    case 'pile': return `pile|${c.pile}|${c.index}|${c.name}`;
    case 'maybe': return `maybe|${c.index}|${c.name}`;
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
  if ((kind === 'maybe' || kind === 'strip') && rest.length >= 2) {
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
      : c.from === 'strip' ? h.cards()[c.index] === c.name
        : c.from === 'head' ? piles.some(p => p.id === c.pile) : true;
  if (!ok) sel = null;
}

const btn = (op: string, extra = ''): string => `data-btn="tt-${op}"${extra ? ` ${extra}` : ''}`;

/** what can be done to what a finger picked up — its whole menu */
function selBarHtml(h: TableHost, piles: DeckPile[]): string {
  const c = selected(h);
  if (!c) return '';
  if (c.from === 'head') {
    const i = piles.findIndex(p => p.id === c.pile);
    return `<div class="ttselbar"><b>${esc(piles[i]?.name ?? '')}</b>
      ${i > 0 ? `<button ${btn('pilemove', 'data-tt-by="-1"')} aria-label="move left">◀</button>` : ''}
      ${i < piles.length - 1 ? `<button ${btn('pilemove', 'data-tt-by="1"')} aria-label="move right">▶</button>` : ''}
      <button class="dkicon" ${btn('putdown')} aria-label="put it down">✕</button></div>`;
  }
  return `<div class="ttselbar">
    <b>${esc(c.name)}</b>
    <span class="dim">tap where it goes</span>
    ${c.from !== 'binder' ? `<button ${btn('cut')}>Cut</button>` : ''}
    ${h.maybe && c.from !== 'maybe' ? `<button ${btn('tomaybe')}>Maybe</button>` : ''}
    ${c.from === 'maybe' ? `<button ${btn('todeck')}>To deck</button>` : ''}
    <button ${btn('newpile')}>New pile</button>
    <button class="dkicon" ${btn('putdown')} aria-label="put it down">✕</button>
  </div>`;
}

function toolsHtml(h: TableHost): string {
  const by = (v: ResortBy, label: string): string => `<button ${btn('resort', `data-tt-by="${v}"`)}>${label}</button>`;
  return `<div class="tttools">
    <details class="ttresort"><summary>Re-sort ▾</summary>
      <div class="ttmenu">${by('cost', 'By cost')}${by('type', 'By type')}${by('element', 'By element')}</div>
    </details>
    ${undo && undo.key === h.key ? `<button ${btn('undo')}>Undo</button>` : ''}
  </div>`;
}

/** The page, as markup. Pure but for remembering the pane's height. */
export function pageHtml(h: TableHost): string {
  const { cw, ch } = sizes();
  const paneH = paneHeight();
  const piles = pilesOf(h);
  validSelection(h, piles);
  const c = selected(h);
  const cards = h.cards();
  const over = new Map<string, number>();
  if (h.cap !== undefined) for (const n of new Set(cards)) { const k = count(cards, n); if (k > h.cap) over.set(n, k); }
  const cover = h.cover?.() ?? null;
  /** which card of a pile a finger has picked up */
  const picked = (list: PileCard[]): number | undefined => {
    const k = c ? list.findIndex(x => x.src === srcKey(c)) : -1;
    return k < 0 ? undefined : k;
  };
  const pileOf = (p: DeckPile): string => {
    const zone = pileZone(p.id);
    const list: PileCard[] = p.cards.map((name, k) => ({ name, src: `pile|${p.id}|${k}|${name}` }));
    return pileHtml({
      zone, name: p.name, rename: p.id, head: p.id, cards: list, S: stripOf(list.length, paneH, ch), ch,
      front: front?.zone === zone ? front.index : undefined, picked: picked(list),
      cover, over, cls: c?.from === 'head' && c.pile === p.id ? 'ttpicked' : '',
      deletable: !p.cards.length && piles.length > 1,
    });
  };
  const gutter = (i: number): string => `<div class="ttgutter" data-tt-zone="gap|${i}" ${btn('to')}></div>`;
  const maybe = h.maybe?.() ?? null;
  const maybeHtml = maybe ? (() => {
    const list: PileCard[] = maybe.map((name, k) => ({ name, src: `maybe|${k}|${name}` }));
    return `<div class="ttmaybe">${pileHtml({
      zone: 'maybe', name: 'Maybe', cards: list, S: stripOf(list.length, paneH, ch), ch,
      front: front?.zone === 'maybe' ? front.index : undefined, picked: picked(list),
      cls: 'ttmaybepile',
    })}</div>`;
  })() : '';
  // the page's class is the LAST one (ui/report.ts's pageOf reads it)
  return `<div class="${c ? 'ttholding ' : ''}ttpage" style="--cw:${cw}px;--ch:${ch}px">
    <div class="tttop">
      <button class="ttback" ${btn('close')}>← ${esc(h.backLabel)}</button>
      <div class="ttsummary">${h.strip?.() ?? `<b>${esc(h.title())}</b>`}</div>
      ${toolsHtml(h)}
    </div>
    ${selBarHtml(h, piles)}
    <div class="ttbody">
      <div class="tttable" data-tt-zone="end" ${btn('to')}>
        <div class="ttrow">${piles.map((p, i) => gutter(i) + pileOf(p)).join('')}
          <div class="ttend" data-tt-zone="end" ${btn('to')}>${piles.length ? '' : '<span class="dim">Drag cards here from the binder.</span>'}</div>
        </div>
      </div>
      ${maybeHtml}
    </div>
    ${h.below?.() ?? ''}
  </div>`;
}

/** the boxes that scroll on the page: their scroll is kept across a repaint
 * (they are rebuilt with it, and a drop must not throw the table to its top) */
const SCROLLERS = '.ttbody, .tttable, .ttmaybe, .ttstripbox';

function paint(): void {
  if (!$app || !host) return;
  if (dragActive()) { paintPending = true; return; }
  paintPending = false;
  const keep = typeof document.querySelectorAll === 'function'
    ? [...document.querySelectorAll<HTMLElement>(SCROLLERS)].map(e => [e.scrollTop, e.scrollLeft] as const)
    : [];
  $app.classList.remove('board');
  $app.innerHTML = noImgDrag(pageHtml(host));
  if (keep.length && typeof document.querySelectorAll === 'function') {
    document.querySelectorAll<HTMLElement>(SCROLLERS).forEach((e, i) => {
      const k = keep[i];
      if (k) { e.scrollTop = k[0]; e.scrollLeft = k[1]; }
    });
  }
  openBinder(binderHost(host));
}

/** the binder's host: a + is a `place()` on the table, like a drop */
function binderHost(h: TableHost): BinderHost {
  return {
    copies: name => count(h.cards(), name),
    ...(h.maybe ? { maybe: (name: string) => count(h.maybe!(), name) } : {}),
    ...(h.cap !== undefined ? { cap: h.cap } : {}),
    add: name => { place(h, { from: 'binder', name }, { at: 'auto' }); },
    ...(h.maybe ? { toMaybe: (name: string) => { place(h, { from: 'binder', name }, { at: 'maybe' }); } } : {}),
    fullBrowser: query => h.fullBrowser(query),
  };
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
  host = h;
  wanted = null;
  sel = null;
  front = null;
  if (undo && undo.key !== h.key) undo = null;
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
  sel = null;
  front = null;
  syncUrl();
  closeBinder();
  if (h) h.close(); else rerenderHost();
}

export function renderScreen(): void {
  if (!host && wanted) {
    const got = resolverFor(wanted)?.(wanted.startsWith('ch:') ? wanted.slice(3) : wanted) ?? null;
    if (got) { openTabletop(got); return; }
    if (++misses > 1) { wanted = null; syncUrl(); rerenderHost(); return; }
    if ($app) {
      $app.innerHTML = `<div class="ttpage"><div class="tttop"><button class="ttback" ${btn('close')}>← Back</button></div>
        <div class="hint ttloading">Setting out the table…</div></div>`;
    }
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
  if (kind === 'strip') return { at: 'strip' };
  if (kind === 'binder') return { at: 'binder' };
  return null;
}

/** a tap on card `k` of `zone` with `c` picked up: the card goes BEFORE it —
 * counted, as every destination is, after the carried card has left */
function beforeCard(c: Carry, zone: string, k: number): Place | null {
  const [kind, a] = zone.split('|');
  const sameZone = (c.from === 'pile' && kind === 'pile' && c.pile === a)
    || (c.from === 'maybe' && kind === 'maybe') || (c.from === 'strip' && kind === 'strip');
  const src = sameZone && 'index' in c ? c.index : -1;
  const index = src >= 0 && k > src ? k - 1 : k;
  if (kind === 'pile' && a) return { at: 'pile', pile: a, index };
  if (kind === 'maybe') return { at: 'maybe', index };
  if (kind === 'strip') return { at: 'strip', index };
  return null;
}

/** main.ts offers every button here. True when it was ours. */
export function handleButton(el: HTMLElement): boolean {
  const b = el.dataset['btn'] ?? '';
  if (!b.startsWith('tt-')) return false;
  const h = host;
  if (!h) return true;
  const c = selected(h);
  const put = (to: Place): void => { const carry = c; sel = null; if (!carry || !place(h, carry, to)) paint(); };
  switch (b) {
    case 'tt-close': closeTabletop(); return true;
    case 'tt-card': {
      const carry = carryOf(el.dataset['ttSrc']);
      if (!carry || carry.from === 'head') return true;
      // A MOUSE READS, A FINGER LIFTS — the pointer decides, never the device
      if (lastPointer === 'mouse') { pinCard(carry.name); return true; }
      if (!c) { sel = { key: h.key, carry }; pinCard(carry.name); paint(); return true; }
      if (srcKey(c) === srcKey(carry)) { sel = null; paint(); return true; }
      const zone = (el.closest?.('[data-tt-zone]') as HTMLElement | null)?.dataset['ttZone'] ?? '';
      const to = c.from === 'head' ? null : beforeCard(c, zone, Number(el.dataset['ttI'] ?? 0));
      if (to) put(to); else { sel = { key: h.key, carry }; paint(); }
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
      // a finger picks the pile up to move it; a mouse drags it
      if (lastPointer === 'mouse') return true;
      const pile = el.dataset['ttPile'] ?? '';
      sel = c?.from === 'head' && c.pile === pile ? null : { key: h.key, carry: { from: 'head', pile } };
      paint();
      return true;
    }
    case 'tt-pilemove': {
      if (c?.from !== 'head') return true;
      const piles = pilesOf(h);
      const i = piles.findIndex(p => p.id === c.pile);
      if (!place(h, c, { at: 'row', pos: i + Number(el.dataset['ttBy'] ?? 0) })) paint();
      return true;
    }
    case 'tt-to': {
      if (!c) return true;
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
    case 'tt-todeck': put(h.kind === 'deck' ? { at: 'auto' } : { at: 'strip' }); return true;
    case 'tt-newpile': put({ at: 'newpile', pos: pilesOf(h).length }); return true;
    case 'tt-putdown': sel = null; paint(); return true;
    case 'tt-delpile':
      if (!place(h, null, { at: 'arrange', edit: { op: 'delpile', pile: el.dataset['ttPile'] ?? '' } })) paint();
      return true;
    case 'tt-resort': {
      const by = el.dataset['ttBy'] as ResortBy;
      if (by !== 'cost' && by !== 'type' && by !== 'element') return true;
      sel = null;
      if (!place(h, null, { at: 'arrange', edit: { op: 'resort', by } })) paint();
      return true;
    }
    case 'tt-undo':
      if (!place(h, null, { at: 'arrange', edit: { op: 'undo' } })) paint();
      return true;
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
    || (c.from === 'maybe' && kind === 'maybe') || (c.from === 'strip' && kind === 'strip');
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
    if (!host || !el?.closest) return null;
    if (!el.closest('.ttpage, #binderlayer') || el.closest('input, summary')) return null;
    const head = el.closest('[data-tt-head]') as HTMLElement | null;
    if (head) return head.closest('.ttpile') as HTMLElement | null;
    return el.closest('[data-tt-src]') as HTMLElement | null;
  },
  plan(src): DragPlan | null {
    const h = host;
    const head = src.querySelector?.(':scope > [data-tt-head]') as HTMLElement | null;
    const carry = src.classList.contains('ttpile') && head
      ? carryOf(`head|${head.dataset['ttHead']}`) : carryOf(src.dataset['ttSrc']);
    if (!h || !carry) return null;
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
    sel = null;
    front = null;
    for (const el of document.querySelectorAll('.ttfront')) el.classList.remove('ttfront');
    for (const el of document.querySelectorAll('details.ttresort[open]')) el.removeAttribute('open');
  },
  ended() {
    clearPreview();
    document.documentElement.classList.remove('ttcarrypile');
    if (paintPending) paint();
    flushBinder();
  },
  refind(src) {
    const k = src.dataset['ttSrc'] ?? src.dataset['ttZone'];
    const attr = src.dataset['ttSrc'] !== undefined ? 'data-tt-src' : 'data-tt-zone';
    return k ? document.querySelector<HTMLElement>(`[${attr}="${CSS.escape(k)}"]`) : null;
  },
};
addDragProvider(provider);

// ── the listeners a table needs beyond clicks ─────────────────────────

let listening = false;
function ensureListeners(): void {
  if (listening || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  listening = true;
  // the pointer that pressed decides what the click means (a mouse pins, a
  // finger picks up) — noted before the click is dispatched
  document.addEventListener('pointerdown', e => { lastPointer = e.pointerType || 'mouse'; }, { capture: true, passive: true });
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
    // Escape puts a picked-up card down — after the binder has had it. The
    // page itself has no Escape: it is a page, not a dialog
    if (e.key !== 'Escape' || binderTookKey(e) || !host || !selected(host)) return;
    sel = null;
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
    addEventListener('resize', () => { if (host && $app?.firstElementChild?.classList?.contains('ttpage')) paint(); });
  }
}
