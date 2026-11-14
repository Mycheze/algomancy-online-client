/* THE PICK SCREEN'S CONTROLLER — a cube event's draft (docs/25 §4, §13). The
 * drawing is pages/cubedraft.ts; the event's socket and state are ui/cube.ts,
 * which calls paintCubeDraft with every view it is pushed.
 *
 * THE SCREEN IS THE DECK TABLE (owner, 2026-11-14: *"The deck area should also
 * already have the 'sideboard' and 'maybeboard' areas … you should be able to
 * freely drag cards around in your deck area during the draft"*). This module
 * is a tabletop host (ui/tabletop.ts) whose band is the pack: the piles, + Pile,
 * Re-sort, the Sideboard and Maybe, every drag and every tap on the table are
 * the builder's own, through its one door `place()`. A pick lands in the main
 * deck where Re-sort by cost would put it (deckarrange.ts landByCost) — or,
 * dropped on a pile, the Sideboard or Maybe, there. The layout is sent to the
 * server (acts.arrange, debounced by ui/cube.ts) and the builder opens on it.
 *
 * Three ways to take a card, one door (`take`):
 *   a tap on a card            chooses it (acts.reserve) — ringed AT ONCE, the
 *                              server's echo only confirms it
 *   a second tap, or Confirm   takes the chosen card (acts.pick)
 *   a card dragged to the table takes it (the drop calls `take`, as the click does)
 *
 * ⚠ A PUSH REBUILDS ONLY WHAT IT CHANGED (owner: *"I think it's like resetting
 * or something when other players do something. It was sometimes hard to
 * select the card I wanted"*). Every other player's pick pushes a view — its
 * only news for me is the seats strip's counts — and the screen used to be
 * repainted whole for it, the pack's tiles rebuilt under the pointer between
 * its press and its release (so the click landed nowhere). Now each push is
 * compared with what is drawn: the seats strip, the title and the clock are
 * patched in place; the pack band is redrawn only when MY pack (or its tiles'
 * size) changed — a choice, or the clock's hint, only moves the ring on the
 * tiles it concerns; the table only when my picks did. And while
 * a pointer is down on the screen, or a card is in the air, the band and the
 * table wait — the release, or the next beat after it, draws them.
 *
 * THE CLOCK is ONE setInterval, started when the screen is painted and
 * cleared on the first tick that finds the screen gone (or stopCubeDraft) —
 * never a setTimeout that re-arms itself: the headless suites stub
 * setInterval and keep setTimeout real, and a re-arming timeout hangs them.
 * The view carries the server's `now`; the tick counts the deadline down by
 * the server's time (`skew`), rewrites the clock's text in place, and redraws
 * the band once when it turns urgent. At ≤10 s with nothing chosen it chooses
 * the server's suggestion for you, once per pick (`autoReserve`, pure) — the
 * card the server takes at 0 anyway.
 *
 * SOUNDS (ui/audio.ts): `pick` as I take a card, `packnew` as a pack comes in
 * front of me, `tensec` once a pick at ten seconds. A pack already waiting when
 * I pick shows within the ear's 90 ms of my `pick` and its `packnew` is dropped
 * by the cue throttle on purpose — it is one event, and I am looking at it.
 */
import type { CubeArrange, CubeDraftView, CubeView } from '../server/cube-types.ts';
import { SIDEBOARD_MAX } from '../engine/src/matchdeck.ts';
import { playCue } from './audio.ts';
import { arrangeOf, emptyLayout, fitLayout, layoutFrom, onTable, sameLayout, type TableLayout } from './cubearrange.ts';
import { landByCost, reconcilePiles, seedPiles } from './deckarrange.ts';
import { addDragProvider, dragActive, type DragProvider } from './drag.ts';
import { keepArt } from './pages/frame.ts';
import { noImgDrag } from './piletable.ts';
import { installPressZoom } from './presszoom.ts';
import * as tt from './tabletop.ts';
import { PEEK_MS } from './touch.ts';
import {
  clockText, confirmOff, cubeDraftClockHtml, cubeDraftTitleHtml, cubeDraftView, cubePackHtml, cubeSeatsHtml, PACK_SPLIT_KEY, packHint, packScrollKey,
  URGENT_MS, type CubeDraftPageView,
} from './pages/cubedraft.ts';

export interface CubeActs {
  reserve(card: string): void;
  pick(card: string): void;
  /** the table's layout changed: keep it (ui/cube.ts debounces the send) */
  arrange?(a: CubeArrange): void;
  /** Back ("Event"): the table has closed itself; show the event page */
  back?(): void;
}

// ── the pure part (test 1344) ─────────────────────────────────────────

/** one pick of the draft: a new pack, or the same pack one card smaller */
export function pickKey(d: CubeDraftView): string {
  return `${d.packNo}.${d.pickNo}.${d.pack?.length ?? 0}`;
}

/**
 * The card to choose for the player now, or null: at ≤10 s on the clock
 * (the server's time) with nothing chosen, the server's suggestion — once per
 * pick (`firedFor` is the pickKey it last fired for).
 */
export function autoReserve(d: CubeDraftView | null, serverNow: number, reserved: string | null, firedFor: string | null): string | null {
  if (!d?.pack || d.deadline === null || !d.suggest || reserved) return null;
  if (firedFor === pickKey(d) || !d.pack.includes(d.suggest)) return null;
  return d.deadline - serverNow <= URGENT_MS ? d.suggest : null;
}

/** what is drawn of a page view: the band, the ring in it (the chosen card, the clock's hint,
 * Confirm), the seats strip, the title — a push redraws a part only when its key moved */
export function drawKeys(v: CubeDraftPageView): { band: string; ring: string; seats: string; title: string } {
  return {
    band: JSON.stringify([v.packNo, v.pickNo, v.pack, v.taken, v.pw, v.split]),
    ring: JSON.stringify([v.reserved, packHint(v), confirmOff(v)]),
    seats: JSON.stringify([v.seats, v.direction]),
    title: JSON.stringify([v.event, v.packNo, v.pickNo, v.direction]),
  };
}

// ── state ─────────────────────────────────────────────────────────────

interface Screen {
  app: HTMLElement;
  view: CubeView;
  acts: CubeActs;
  /** the server's clock minus this one's, when the view came */
  skew: number;
}

/** where a card dropped on the table asked to go */
type Wish = { card: string; to: 'side' | 'maybe' | { pile: string } };

/** my deck table during the draft: its layout, and the picks it was last held to */
interface Table { code: string; layout: TableLayout; picks: string[] }

let cur: Screen | null = null;
let table: Table | null = null;
/** the card I tapped, for the pick it was tapped in (shown before the server echoes it) */
let mine: { key: string; card: string } | null = null;
/** the card I took, for the pick it was taken in (no second take until the pack moves on) */
let took: { key: string; card: string } | null = null;
/** where my last drop asked its card to land */
let wish: Wish | null = null;
/** the pick the auto-choice last fired for, and the one the ten-second cue last rang for */
let autoFor: string | null = null;
let tenFor: string | null = null;
/** the table must be redrawn (my picks changed) once nothing is held */
let tableDirty = false;
/** what is on screen of the band, the seats strip and the title */
let drawn = { band: '', ring: '', seats: '', title: '' };
/** the chosen card and the hint as they are drawn: the tiles a new ring changes */
let ringed: { reserved: string | null; hint: string | null } = { reserved: null, hint: null };
/** a pointer is down on the screen: nothing it could be over is rebuilt until it lifts */
let pressing = false;
let pressedAt = 0;
/** Back is ours to report — not when this module takes the table down itself */
let quiet = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** a press longer than this is a lost release (a window left mid-press), not a hold */
const PRESS_STALE_MS = 10_000;

const serverNow = (): number => Date.now() + (cur?.skew ?? 0);
const hostKey = (code: string): string => `cubedraft:${code}`;
const cue = (c: 'pick' | 'packnew' | 'tensec'): void => { try { playCue(c); } catch { /* no sound here (a test's node) */ } };

/** the card chosen now: my tap in this pick, else the server's */
function chosen(d: CubeDraftView | null): string | null {
  if (!d?.pack) return null;
  const key = pickKey(d);
  if (mine && mine.key === key && d.pack.includes(mine.card)) return mine.card;
  return d.reserved && d.pack.includes(d.reserved) ? d.reserved : null;
}

const takenNow = (d: CubeDraftView | null): string | null => (d?.pack && took && took.key === pickKey(d) ? took.card : null);

/** the page's view of the band, the title and the clock */
function pageView(): CubeDraftPageView | null {
  if (!cur) return null;
  const d = cur.view.draft;
  return cubeDraftView(cur.view, { reserved: chosen(d), taken: takenNow(d), serverNow: serverNow() });
}

/** is the tabletop showing this event's pick screen? */
const ours = (): boolean => !!cur && tt.tableOpen() === hostKey(cur.view.code);

const q = <T extends Element = HTMLElement>(sel: string): T | null =>
  cur && typeof cur.app.querySelector === 'function' ? cur.app.querySelector<T>(sel) : null;

// ── the table ─────────────────────────────────────────────────────────

/** hold the table to `picks`: a pick not on it lands where its drop asked, else by cost */
function settle(t: TableLayout, picks: readonly string[]): TableLayout {
  let out = fitLayout(t, picks, false);
  const left = new Map<string, number>();
  for (const n of picks) left.set(n, (left.get(n) ?? 0) + 1);
  for (const n of onTable(out)) left.set(n, (left.get(n) ?? 0) - 1);
  for (const n of picks) {
    const k = left.get(n) ?? 0;
    if (k <= 0) continue;
    left.set(n, k - 1);
    const w = wish && wish.card === n ? wish.to : null;
    if (w) wish = null;
    if (w === 'side') out = { ...out, side: [...out.side, n] };
    else if (w === 'maybe') out = { ...out, maybe: [...out.maybe, n] };
    else if (w && out.piles.some(p => p.id === w.pile)) out = { ...out, piles: out.piles.map(p => (p.id === w.pile ? { ...p, cards: [...p.cards, n] } : p)) };
    else out = { ...out, piles: landByCost(out.piles, n) };
  }
  return out;
}

/** send the layout to be kept (ui/cube.ts debounces it) */
function keep(): void {
  if (cur && table) cur.acts.arrange?.(arrangeOf(table.layout, 'draft'));
}

/** THE HOST: the builder's table on my picks, the pack for its band */
function draftHost(code: string): tt.TableHost {
  const L = (): TableLayout => table?.layout ?? emptyLayout();
  const h: tt.TableHost = {
    kind: 'deck',
    key: hostKey(code),
    inUrl: false,
    title: () => cur?.view.config.name ?? '',
    backLabel: 'Event',
    cards: () => L().piles.flatMap(p => p.cards),
    side: () => L().side,
    sideMax: SIDEBOARD_MAX,
    maybe: () => L().maybe,
    piles: () => L().piles,
    // no pool: the pack is the band, and every pick stays on the table
    pool: false,
    band: () => {
      const v = pageView()!;
      drawn = drawKeys(v);
      ringed = { reserved: v.reserved, hint: packHint(v) };
      return { html: cubePackHtml(v), split: v.split, splitKey: PACK_SPLIT_KEY, what: 'pack' };
    },
    titleHtml: () => { const v = pageView(); return v ? cubeDraftTitleHtml(v) : ''; },
    toolsHtml: () => { const v = pageView(); return v ? cubeDraftClockHtml(v) : ''; },
    pageClass: 'cdpage',
    commit: next => {
      if (!table) return;
      const was = table.layout;
      const cards = next.cards ?? was.piles.flatMap(p => p.cards);
      const piles = reconcilePiles(cards, 'piles' in next ? next.piles ?? seedPiles(cards, 'cost') : was.piles);
      table.layout = settle({ piles, side: next.sideboard ?? was.side, maybe: next.maybe ?? was.maybe }, table.picks);
      keep();
      tt.tabletopChanged();
    },
    close: () => { if (!quiet) cur?.acts.back?.(); },
  };
  return h;
}

/** The draft's table for `code`, if this tab holds one — the builder opens on it (ui/cubebuild.ts). */
export function draftLayout(code: string): TableLayout | null {
  return table && table.code === code ? table.layout : null;
}

// ── drawing: only what changed ────────────────────────────────────────

/** the band again, in place: its scroll kept within a pick, the top for a new one */
function patchBand(v: CubeDraftPageView): void {
  const el = q('.cdpack');
  if (!el) { tt.tabletopChanged(); return; }
  const was = el.querySelector<HTMLElement>('.ttpoolresults');
  const top = was && was.dataset['scroll'] === packScrollKey(v) ? was.scrollTop : 0;
  // the pack's pictures are the elements they were: a choice rings a card, it does not redraw the scans
  keepArt(el.parentElement ?? el, () => { el.outerHTML = noImgDrag(cubePackHtml(v)); }, '.cdpack img');
  const now = q('.cdpack .ttpoolresults');
  if (now && top) now.scrollTop = top;
  // the band holds the seats strip but not the title (.frametitle, outside it): the title stays
  // owed until flush patches it, or a new pack round kept "Pack 1 · Pick 13" (QA 2026-11-14)
  drawn = { ...drawKeys(v), title: drawn.title };
  ringed = { reserved: v.reserved, hint: packHint(v) };
}

/** a quoted attribute value in a selector */
const attrQ = (s: string): string => `"${s.replace(/["\\]/g, '\\$&')}"`;

/** THE RING, IN PLACE: a tap moves the chosen card's ring (and the hint's, and Confirm) on the tiles
 * it concerns — nothing else in the band is touched, no tile replaced. False when the band is not
 * there to patch (the caller draws it) */
function patchRing(v: CubeDraftPageView): boolean {
  const band = q('.cdpack');
  if (!band || typeof band.querySelectorAll !== 'function') return false;
  const hint = packHint(v);
  const names = new Set([ringed.reserved, ringed.hint, v.reserved, hint].filter((n): n is string => !!n));
  for (const name of names) {
    for (const t of Array.from(band.querySelectorAll<HTMLElement>(`[data-cd-card=${attrQ(name)}]`))) {
      t.classList.toggle('cdreserved', name === v.reserved);
      t.classList.toggle('cdhint', name === hint);
      t.setAttribute('aria-pressed', name === v.reserved ? 'true' : 'false');
    }
  }
  const ok = band.querySelector<HTMLButtonElement>('.cdconfirm');
  if (ok) ok.disabled = confirmOff(v);
  ringed = { reserved: v.reserved, hint };
  return true;
}

/** what a push or a beat changed, drawn — the table and the band wait while a pointer is down */
function flush(): void {
  if (!cur || !ours()) return;
  const held = dragActive() || pressing;
  if (tableDirty && !held) { tableDirty = false; tt.tabletopChanged(); return; }
  const v = pageView()!;
  const k = drawKeys(v);
  const bandMoved = k.band !== drawn.band;
  if (bandMoved && !held) patchBand(v);
  else {
    // a choice: the ring moves on the tiles it concerns (no element replaced, so even under a press)
    if (!bandMoved && k.ring !== drawn.ring) {
      if (patchRing(v)) drawn.ring = k.ring;
      else if (!held) patchBand(v);
    }
    if (k.seats !== drawn.seats) {
      // the seats strip, alone: another player's pick. Nothing under the pointer is touched
      const strip = q('.cdseats');
      if (strip) strip.outerHTML = cubeSeatsHtml(v);
      else if (!held) patchBand(v);
      drawn.seats = k.seats;
    }
  }
  if (k.title !== drawn.title) {
    const t = q('.frametitle');
    if (t) t.innerHTML = cubeDraftTitleHtml(v);
    drawn.title = k.title;
  }
}

// ── taking and choosing: every route comes here ───────────────────────

/** choose `card` (a tap): ringed now, sent to the server */
function choose(card: string): void {
  const d = cur?.view.draft;
  if (!cur || !d?.pack || !d.pack.includes(card) || takenNow(d)) return;
  mine = { key: pickKey(d), card };
  cur.acts.reserve(card);
  flush();
}

/** THE ONE DOOR: take `card` — a second tap, Confirm, or a drop. False when it cannot be taken now */
function take(card: string): boolean {
  const d = cur?.view.draft;
  if (!cur || !d?.pack || !d.pack.includes(card) || takenNow(d)) return false;
  took = { key: pickKey(d), card };
  cue('pick');
  cur.acts.pick(card);
  flush();
  return true;
}

/** a `cd-` button (the click listener's, and the tests'). True when it was ours */
export function cubeDraftButton(btn: string, el?: { dataset: Record<string, string | undefined> }): boolean {
  if (!btn.startsWith('cd-')) return false;
  const d = cur?.view.draft ?? null;
  switch (btn) {
    case 'cd-card': {
      const card = el?.dataset['cdCard'];
      if (!card) return true;
      if (chosen(d) === card) take(card); else choose(card);
      return true;
    }
    case 'cd-confirm': {
      const card = chosen(d);
      if (card) take(card);
      return true;
    }
    default: return true;
  }
}

// ── the clock ─────────────────────────────────────────────────────────

/** one beat: the clock's text, the urgent redraw, the auto-choice, what waited for a release — or, the screen gone, the end of the clock */
export function tickCubeDraft(): void {
  if (!cur) return;
  if (!ours() || (typeof cur.app.querySelector === 'function' && !cur.app.querySelector('.cdpage'))) { stopClock(); return; }
  if (pressing && Date.now() - pressedAt > PRESS_STALE_MS) pressing = false;
  const d = cur.view.draft;
  const auto = autoReserve(d, serverNow(), chosen(d), autoFor);
  if (auto && d) { autoFor = pickKey(d); choose(auto); }
  const left = d?.pack && d.deadline !== null ? d.deadline - serverNow() : null;
  if (d && left !== null && left <= URGENT_MS && left > 0 && tenFor !== pickKey(d)) { tenFor = pickKey(d); cue('tensec'); }
  const clock = q('.cdclock');
  if (clock) {
    const text = left !== null ? clockText(left) : '';
    if (clock.textContent !== text) clock.textContent = text;
    clock.classList?.toggle('cdurgent', left !== null && left <= URGENT_MS);
  }
  if (!dragActive() && !pressing) flush();
}

function startClock(): void {
  if (timer !== null || typeof setInterval !== 'function') return;
  timer = setInterval(tickCubeDraft, 250);
  // a test's process is never held open by it (node); a browser's id is a number
  (timer as unknown as { unref?: () => void })?.unref?.();
}

function stopClock(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

/** the screen is going (the event page, the builder): the clock stops, and the table comes down
 * if it is still up. The layout stays in this tab, for "Back to the draft" and for the builder */
export function stopCubeDraft(): void {
  stopClock();
  if (ours()) { quiet = true; try { tt.closeTabletop(); } finally { quiet = false; } }
  cur = null;
  tableDirty = false;
  pressing = false;
}

// ── the listeners ─────────────────────────────────────────────────────

/** a pointer went down on the screen (true) or lifted (false) — the document listeners' and the
 * tests'. Lifted, what waited is drawn on the next beat (after the click the release makes) */
export function cubeDraftPress(down: boolean): void {
  pressing = down && !!cur;
  if (down) pressedAt = Date.now();
}

const wired = new WeakSet<HTMLElement>();
let docWired = false;

/** the screen's own clicks: `cd-` buttons are taken here and go no further
 * (main.ts's delegator would repaint the page for a name it does not know) */
function wire(app: HTMLElement): void {
  if (!wired.has(app) && typeof app.addEventListener === 'function') {
    wired.add(app);
    app.addEventListener('click', e => {
      const btn = (e.target as HTMLElement | null)?.closest?.('[data-btn^="cd-"]') as HTMLElement | null;
      if (!btn || !btn.closest('.cdpage') || !cur) return;
      e.stopPropagation();
      if ((btn as HTMLButtonElement).disabled) return;
      cubeDraftButton(btn.dataset['btn'] ?? '', btn);
    });
  }
  installPressZoom();
  if (docWired || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  docWired = true;
  // a pointer down on the screen holds the band and the table as they are drawn until it lifts
  document.addEventListener('pointerdown', e => {
    if (cur && (e.target as HTMLElement | null)?.closest?.('.cdpage')) cubeDraftPress(true);
  }, { capture: true, passive: true });
  const lifted = (): void => cubeDraftPress(false);
  document.addEventListener('pointerup', lifted, { capture: true, passive: true });
  document.addEventListener('pointercancel', lifted, { capture: true, passive: true });
}

// ── the drag: a pack card onto the table is a take ────────────────────

/** where on the table a drop asks its card to go: a pile, the Sideboard, Maybe — else by cost */
function wishOf(zone: Element | null): Wish['to'] | null {
  const z = (zone as HTMLElement | null)?.dataset?.['ttZone'] ?? '';
  if (z === 'side' || z === 'maybe') return z;
  if (z.startsWith('pile|')) return { pile: z.slice(5) };
  return null;
}

const provider: DragProvider = {
  holdMs: PEEK_MS,
  pressLift: true,
  edgeScroll: true,
  sourceOf(el) {
    if (!cur || !el?.closest || !el.closest('.cdpage')) return null;
    return el.closest('[data-cd-card]') as HTMLElement | null;
  },
  plan(src) {
    const card = src.dataset['cdCard'];
    const d = cur?.view.draft;
    if (!card || !d?.pack?.includes(card) || takenNow(d)) return null;
    return {
      targets: [],
      // the table: the pile, the Sideboard or Maybe under the card, else the felt as a whole
      zoneAt: el => {
        const wrap = el?.closest?.('.tttablewrap') ?? null;
        if (!wrap) return null;
        const z = el!.closest('[data-tt-zone]') as HTMLElement | null;
        return z && wishOf(z) ? z : wrap;
      },
      drop: zone => {
        if (!zone) return false;
        const to = wishOf(zone);
        const was = wish;
        wish = to ? { card, to } : null;
        if (take(card)) return true;
        wish = was;
        return false;
      },
    };
  },
  started() { /* nothing hovers here but the zoom, which drag.ts takes down */ },
  ended() { flush(); },
  refind(src) {
    const card = src.dataset['cdCard'];
    return card && typeof document !== 'undefined'
      ? document.querySelector<HTMLElement>(`.cdpage [data-cd-card="${CSS.escape(card)}"]`) : null;
  },
};
addDragProvider(provider);
/** the pick screen's drag provider, for the tests that drop through it */
export const cubeDraftDrag: DragProvider = provider;

// ── the screen ────────────────────────────────────────────────────────

/** Paint the pick screen for `view` (every push): the first time the table opens; after that
 * only what the push changed is drawn. The clock keeps running. */
export function paintCubeDraft(app: HTMLElement, view: CubeView, acts: CubeActs, _rerender?: () => void): void {
  const prev = cur && cur.view.code === view.code ? cur.view.draft : null;
  const skew = cur && cur.view === view ? cur.skew : view.now - Date.now();
  cur = { app, view, acts, skew };
  const d = view.draft;
  // the pack moved on: my tap and my take were for the last one
  if (d && mine && mine.key !== pickKey(d)) mine = null;
  if (d && took && took.key !== pickKey(d)) took = null;
  if (d?.pack && prev && (!prev.pack || pickKey(prev) !== pickKey(d))) cue('packnew');
  // the table: this tab's, else the one the server kept for me, held to my picks
  const picks = d?.picks ?? view.myPool ?? [];
  if (!table || table.code !== view.code) {
    const kept = view.myArrange && view.myArrange.from !== 'build' ? layoutFrom(view.myArrange) : emptyLayout();
    table = { code: view.code, layout: settle(kept, picks), picks: [...picks] };
    if (!sameLayout(table.layout, kept)) keep();
  } else if (JSON.stringify(table.picks) !== JSON.stringify(picks)) {
    const next = settle(table.layout, picks);
    table.picks = [...picks];
    if (!sameLayout(next, table.layout)) {
      table.layout = next;
      tableDirty = true;
      // a pick is not a move to take back: Undo stays inside the table's own moves
      tt.clearHistory();
      keep();
    }
  }
  wire(app);
  if (!ours()) {
    tableDirty = false;
    pressing = false;
    tt.openTabletop(draftHost(view.code));
  } else {
    flush();
  }
  startClock();
  // a view that comes in already under 10 s chooses at once
  tickCubeDraft();
}
