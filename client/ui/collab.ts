/* A SHARED DECK TABLE IN THE BROWSER (docs/26) — the builder pointed at a
 * session the server holds (server/api-collab.ts).
 *
 * The page is `?collab=<code>`. The table is ui/tabletop.ts as ever, through a
 * host made here: its cards are the session's, and every move the table makes
 * (`commit`, with the move itself) is shown AT ONCE and sent with a sequence
 * number. Each view the server pushes is the truth as of the last of this
 * tab's moves it has handled (`ack`); the moves still in flight are replayed on
 * top of it through ui/tableplace.ts applyPlace — the server's own arithmetic —
 * so nothing jumps back while a move is on its way, and a move someone else
 * beat this tab to simply does not survive the replay (the server's refusal
 * says why, in the note row).
 *
 * Undo and Redo are each person's own, and the server's (TableHost.step).
 *
 * THE HOST is the deck's owner: their table wraps the deck page's own host
 * (Deck info, the title, Back to Decks), and Back ends the session for
 * everyone. Anyone else leaves on their own, and may keep a copy.
 *
 * EVERYONE ELSE'S HAND: each pointer over the table is sent, anchored to the
 * zone under it (a pile, Maybe, the Sideboard) as fractions of that zone, so
 * two windows of different sizes agree on where it is; and the card in the
 * hand by its `data-tt-src`. They are drawn in a fixed layer beside #app
 * (`#collabmarks`), which a repaint of the table never touches.
 */
import * as acct from './account.ts';
import * as tt from './tabletop.ts';
import { applyPlace, sharedDeckHost, tableAfter, type Carry, type DeckTable, type Place } from './tableplace.ts';
import { deckPill } from './pages/decks.ts';
import {
  collabMarksHtml, collabPageHtml, collabSheetHtml, collabToolHtml, type CollabMark, type CollabPerson,
} from './pages/collab.ts';
import { frameChromeView, paintFrame } from './pages/frame.ts';
import { pollInboxNow, setCollabOpener, shareFriends } from './inbox.ts';
import { copyText } from './util.ts';
import { collabColour } from '../shared/collab.ts';
import { sendMsg, type ClientMsg, type ServerMsg } from '../shared/protocol.ts';
import type { CollabCursor, CollabView } from '../server/collab.ts';
import { MATCH_COPY_CAP, SIDEBOARD_MAX } from '../engine/src/matchdeck.ts';

type CollabMsg = ServerMsg<{ collabView: CollabView; collabCursor: CollabCursor }>;

/** what main.ts hands in: the deck page's pieces this module may not import (decks.ts imports it) */
export interface CollabDeps {
  app: HTMLElement;
  rerender: () => void;
  /** the deck page's own host for one of my decks, or null while the collection loads */
  hostBase: (deckId: string, then: () => void) => tt.TableHost | null;
  /** the shared table into the deck page's local copy */
  adopt: (deckId: string, t: DeckTable) => void;
  /** a write's answer, into the deck page's collection */
  adoptReply: (r: { ok: boolean }) => void;
}

let deps: CollabDeps | null = null;

// ── state ─────────────────────────────────────────────────────────────

/** the session this page is at, or null */
let code: string | null = null;
let ws: WebSocket | null = null;
let view: CollabView | null = null;
/** the table as this tab shows it: the last view, with the moves in flight on top */
let table: DeckTable | null = null;
/** this tab's moves and steps the server has not answered yet */
let pending: ({ seq: number; kind: 'move'; carry: Carry | null; to: Place } | { seq: number; kind: 'step' })[] = [];
let seq = 0;
/** the note row: a refused move, a reconnect */
let note: string | null = null;
/** why the session is over for this page (shown until Home), or null */
let ended: string | null = null;
/** the Together sheet is open */
let sheetOpen = false;
let sheetMsg = '';
/** friends asked from this tab */
const invited = new Set<string>();
/** the deck page's host, wrapped (the host's own table only) */
let base: tt.TableHost | null = null;
/** everyone else's last pointer, by account */
const cursors = new Map<string, CollabCursor>();

const key = (): string => `collab:${code}`;
const onTable = (): boolean => !!code && tt.tableOpen() === key();

/** the page this module owns while the table is not up: joining, signed out, or over */
export const screen = (): 'collab' | null => (code && !onTable() ? 'collab' : null);

export function initCollab(d: CollabDeps): void {
  deps = d;
  setCollabOpener(openShared, () => code);
  ensureListeners();
  let want: string | null = null;
  try { want = new URLSearchParams(location.search).get('collab'); } catch { /* file:// */ }
  // the boot paints the page once everything is wired: no paint from here
  if (want) openShared(want, false, false);
}

/** open the shared table `c` on this page (a link, the bell's Join); `sheet`: with the Together sheet up */
export function openShared(c: string, sheet = false, paint = true): void {
  const next = c.toUpperCase().trim();
  if (!next) return;
  if (code && code !== next) leave(false);
  code = next;
  ended = null; note = null; view = null; table = null; pending = []; sheetOpen = sheet; sheetMsg = '';
  syncUrl();
  connect();
  if (paint) deps?.rerender();
}

/** the deck page's Build together: open a session on my deck `deckId`, and its table */
export function startShared(deckId: string): void {
  void fetch('/api/collab/start', { method: 'POST', headers: acct.authHeaders(), body: JSON.stringify({ deck: deckId }) })
    .then(r => r.json() as Promise<{ ok: boolean; code?: string; error?: string }>)
    .then(r => {
      if (!r.ok || !r.code) { note = r.error ?? 'Could not start a session.'; tt.tabletopChanged(); return; }
      openShared(r.code, true);
    })
    .catch(() => { note = 'Could not reach the server.'; tt.tabletopChanged(); });
}

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('collab');
    if (code) { url.searchParams.set('collab', code); url.searchParams.delete('table'); }
    history.replaceState(null, '', url.toString());
  } catch { /* file:// */ }
}

// ── the socket ────────────────────────────────────────────────────────

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15_000];
const socketUp = (): boolean => !!ws && ws.readyState === 1;

function connect(): void {
  if (!code || ended) return;
  if (!acct.token()) { deps?.rerender(); return; }
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) { if (ws.readyState === 1) sub(); return; }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  let sock: WebSocket;
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    sock = new WebSocket(`${proto}://${location.host}`);
  } catch { lost(); return; }
  ws = sock;
  sock.onopen = () => { if (ws === sock) { retries = 0; sub(); } };
  sock.onmessage = (ev: MessageEvent) => {
    if (ws !== sock) return;
    let m: CollabMsg;
    try { m = JSON.parse(String(ev.data)) as CollabMsg; } catch { return; }
    onMsg(m);
  };
  sock.onclose = () => { if (ws === sock) { ws = null; lost(); } };
  if (sock.readyState === 1) sub();
}

function sub(): void {
  if (!ws || ws.readyState !== 1 || !code) return;
  // what was in flight on a socket that died may or may not have landed: the
  // next view says which, and nothing is sent twice
  pending = [];
  sendMsg(ws, { t: 'collab', op: 'sub', code, token: acct.token() });
}

function send(msg: ClientMsg): boolean {
  if (!socketUp()) return false;
  sendMsg(ws!, msg);
  return true;
}

/** the socket went: try again after the backoff, while the session is open here */
function lost(): void {
  if (!code || ended) return;
  note = 'Reconnecting…';
  repaint();
  const wait = BACKOFF_MS[Math.min(retries, BACKOFF_MS.length - 1)]!;
  retries++;
  retryTimer = setTimeout(() => { retryTimer = null; connect(); }, wait);
}

function closeSocket(): void {
  const s = ws;
  ws = null;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (!s) return;
  try { if (s.readyState === 1) sendMsg(s, { t: 'collab', op: 'unsub' }); } catch { /* closing anyway */ }
  try { s.close(); } catch { /* already */ }
}

function onMsg(m: CollabMsg): void {
  if (m.t !== 'collab') return;
  if ('view' in m && m.view) { take(m.view); return; }
  if ('cursor' in m && m.cursor) {
    if (m.cursor.at || m.cursor.held) cursors.set(m.cursor.id, m.cursor); else cursors.delete(m.cursor.id);
    drawMarksSoon();
    return;
  }
  if ('refused' in m && m.refused) { note = m.refused.note; repaint(); return; }
  if ('ended' in m && typeof m.ended === 'string') { over(m.ended); return; }
  if ('error' in m && m.error) { note = m.error; repaint(); }
}

/** a view: the truth, with this tab's moves still in flight replayed on top */
function take(v: CollabView): void {
  const first = !view;
  view = v;
  if (note === 'Reconnecting…') note = null;
  pending = pending.filter(p => p.seq > v.ack);
  let t: DeckTable = { cards: [...v.cards], maybe: [...v.maybe], side: [...v.side], piles: v.piles.map(p => ({ ...p, cards: [...p.cards] })) };
  for (const p of pending) {
    if (p.kind !== 'move') continue;
    const r = applyPlace(sharedDeckHost(t), p.carry, p.to);
    if (r.ok) t = tableAfter(t, r.next);
  }
  table = t;
  for (const id of [...cursors.keys()]) if (!v.members.some(m => m.id === id && m.here)) cursors.delete(id);
  if (v.youHost) deps?.adopt(v.deck.id, { cards: v.cards, maybe: v.maybe, side: v.side, piles: v.piles });
  if (first || !onTable()) { putUp(); return; }
  tt.tabletopChanged();
  drawMarksSoon();
}

/** the table on screen, with the deck page's host under it when it is mine */
function putUp(): void {
  if (!view || !code) return;
  // the host's Deck info arrives once the collection has: the table goes up again then, once
  if (view.youHost && !base) base = deps?.hostBase(view.deck.id, () => { if (view && code && !base) putUp(); }) ?? null;
  tt.openTabletop(sharedHost());
  pollInboxNow();
}

/** the session is over for this page: the table comes down (its host's
 * `close` says where to), else the page says so */
function over(why: string): void {
  ended = why;
  closeSocket();
  cursors.clear();
  drawMarks();
  if (onTable()) tt.closeTabletop(); else deps?.rerender();
}

/** forget the session */
function reset(): void {
  closeSocket();
  code = null; view = null; table = null; pending = []; ended = null; base = null;
  sheetOpen = false; note = null; copyMsg = '';
  cursors.clear();
  drawMarks();
  syncUrl();
}

/** leave this table: the host's ends the session for everyone */
function leave(paintAfter = true): void {
  if (view?.youHost && !ended) send({ t: 'collab', op: 'end' });
  reset();
  if (paintAfter) deps?.rerender();
}

// ── the table's host ──────────────────────────────────────────────────

function people(): CollabPerson[] {
  return (view?.members ?? []).map(m => ({ id: m.id, name: m.name, colour: collabColour(m.colour), here: m.here, host: m.host }));
}

function hostAwayNote(): string | null {
  if (!view || view.hostAway === null || view.youHost) return null;
  return `${view.deck.hostName}’s connection dropped. The session ends in a minute unless they come back.`;
}

function sharedHost(): tt.TableHost {
  const t = (): DeckTable => table ?? { cards: [], maybe: [], side: [], piles: [] };
  const b = base;
  return {
    kind: 'deck',
    key: key(),
    inUrl: false,
    title: () => view?.deck.name ?? 'Shared deck',
    backLabel: b ? b.backLabel : 'Home',
    cards: () => t().cards,
    maybe: () => t().maybe,
    side: () => t().side,
    piles: () => t().piles,
    sideMax: SIDEBOARD_MAX,
    cap: MATCH_COPY_CAP,
    refuse: next => sharedDeckHost(t()).refuse?.(next) ?? null,
    cover: () => view?.deck.cover ?? null,
    pool: true,
    pill: () => deckPill({ id: view?.deck.id ?? '', name: view?.deck.name ?? '', cards: t().cards, sideboard: t().side, cover: view?.deck.cover ?? null }),
    ...(b?.titleBtn ? { titleBtn: b.titleBtn } : {}),
    toolsHtml: () => collabToolHtml(people(), sheetOpen) + (b?.toolsHtml?.() ?? ''),
    sheetHtml: () => (sheetOpen ? collabSheetHtml(sheetView()) : b?.sheetHtml?.() ?? ''),
    closeSheet: () => {
      if (sheetOpen) { sheetOpen = false; return true; }
      return b?.closeSheet?.() ?? false;
    },
    button: el => { if (!onButton(el)) b?.button?.(el); },
    note: () => note ?? hostAwayNote() ?? b?.note?.() ?? null,
    commit: (next, move) => {
      if (!move || !table) return;
      note = null;
      const s = ++seq;
      pending.push({ seq: s, kind: 'move', carry: move.carry, to: move.to });
      table = tableAfter(table, next);
      if (!send({ t: 'collab', op: 'move', seq: s, carry: move.carry, to: move.to })) note = 'Reconnecting… that move will not stick.';
      tt.tabletopChanged();
      sendCursor(true);
    },
    step: dir => {
      const s = ++seq;
      if (!send({ t: 'collab', op: 'step', seq: s, dir })) { note = 'Reconnecting…'; tt.tabletopChanged(); return false; }
      pending.push({ seq: s, kind: 'step' });
      note = null;
      return true;
    },
    canStep: () => ({ undo: !!view?.canUndo || pending.some(p => p.kind === 'move'), redo: !!view?.canRedo }),
    painted: () => { drawMarksSoon(); sendCursor(false); },
    close: () => {
      const b2 = base;
      // the host goes back to the deck page, the deck as the table left it
      if (view?.youHost) { leave(false); if (b2) b2.close(); else deps?.rerender(); return; }
      // a guest whose session ended sees why (and may still keep a copy); one who left goes home
      if (ended) { sheetOpen = false; deps?.rerender(); return; }
      leave();
    },
  };
}

function sheetView(): Parameters<typeof collabSheetHtml>[0] {
  const sf = shareFriends();
  const here = new Set((view?.members ?? []).filter(m => m.here).map(m => m.id));
  let link = '';
  try { link = `${location.origin}${location.pathname}?collab=${code}`; } catch { /* file:// */ }
  return {
    link,
    people: people(),
    me: view?.me ?? '',
    youHost: !!view?.youHost,
    hostName: view?.deck.hostName ?? 'the host',
    friends: sf.friends.map(f => ({ id: f.id, username: f.username, status: f.status, sent: invited.has(f.id), joined: here.has(f.id) })),
    friendsLoaded: sf.loaded,
    msg: sheetMsg,
  };
}

/** every `tt-collab-…` button: true when it was one */
function onButton(el: HTMLElement): boolean {
  const b = el.dataset['btn'] ?? '';
  if (!b.startsWith('tt-collab-')) return false;
  switch (b) {
    case 'tt-collab-sheet': sheetOpen = !sheetOpen; sheetMsg = ''; break;
    case 'tt-collab-copylink': {
      const box = document.getElementById('tt-collab-link') as HTMLInputElement | null;
      copyText(box?.value ?? '', box, el);
      return true;
    }
    case 'tt-collab-invite': {
      const to = el.dataset['user'] ?? '';
      if (!to || !code) return true;
      invited.add(to);
      sheetMsg = '';
      void fetch('/api/collab/invite', { method: 'POST', headers: acct.authHeaders(), body: JSON.stringify({ code, to }) })
        .then(r => r.json() as Promise<{ ok?: boolean; error?: string }>)
        .then(r => { if (!r.ok) { invited.delete(to); sheetMsg = r.error ?? 'That invite did not go.'; repaint(); } })
        .catch(() => { invited.delete(to); sheetMsg = 'Could not reach the server.'; repaint(); });
      break;
    }
    case 'tt-collab-kick': send({ t: 'collab', op: 'kick', user: el.dataset['user'] ?? '' }); return true;
    case 'tt-collab-end': sheetOpen = false; tt.closeTabletop(); return true;
    case 'tt-collab-leave': sheetOpen = false; tt.closeTabletop(); return true;
    case 'tt-collab-copy': void saveCopy(); return true;
    default: return false;
  }
  repaint();
  return true;
}

/** a guest keeps the deck as it stands: a new private deck of their own */
async function saveCopy(): Promise<void> {
  const t = table;
  if (!t) return;
  const name = `${view?.deck.name ?? 'Shared deck'} (with ${view?.deck.hostName ?? 'friends'})`.slice(0, 60);
  sheetMsg = 'Saving…';
  repaint();
  try {
    const r = await fetch('/api/decks/create', {
      method: 'POST', headers: acct.authHeaders(),
      body: JSON.stringify({ name, cards: t.cards, maybe: t.maybe, sideboard: t.side }),
    }).then(x => x.json() as Promise<{ ok: boolean; error?: string; decks?: unknown[] }>);
    if (!r.ok) { sheetMsg = r.error ?? 'Could not save a copy.'; repaint(); return; }
    deps?.adoptReply(r);
    sheetMsg = `Saved to your decks as “${name}”.`;
  } catch { sheetMsg = 'Could not reach the server.'; }
  repaint();
}

function repaint(): void {
  if (onTable()) tt.tabletopChanged(); else if (code) renderScreen();
}

// ── the page before the table ─────────────────────────────────────────

export function renderScreen(): void {
  if (!deps || !code) return;
  if (!ended && !acct.token()) {
    paintFrame(deps.app, collabPageHtml({ state: 'signin', msg: 'Sign in to join this deck-building session.' }, frameChromeView()));
    return;
  }
  if (!ended) {
    connect();
    paintFrame(deps.app, collabPageHtml({ state: 'joining', msg: '' }, frameChromeView()));
    return;
  }
  paintFrame(deps.app, collabPageHtml({ state: 'ended', msg: ended, canCopy: !!table?.cards.length && !copyMsg, copyMsg }, frameChromeView()));
}

/** the ended page's Save a copy answer */
let copyMsg = '';

/** main.ts offers every button: the page's own (`collab-…`; the table's go through its host) */
export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (b === 'collab-home') { leave(); return true; }
  if (b === 'collab-copy') {
    void saveCopy().then(() => { copyMsg = sheetMsg; renderScreen(); });
    return true;
  }
  return false;
}

// ── everyone else's hand ──────────────────────────────────────────────

let lastSent = 0;
let lastAt: string | null = null;
let lastHeld: string | null = null;
let ptr: { x: number; y: number } | null = null;
let sendTimer: ReturnType<typeof setTimeout> | null = null;
const SEND_MS = 50;

/** the pointer as fractions of the table zone under it, or null off the table
 * (the pool is each person's own: a pointer over it means nothing to anyone else) */
function anchor(): { z: string; x: number; y: number } | null {
  if (!ptr || typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return null;
  const el = document.elementFromPoint(ptr.x, ptr.y);
  const zone = el?.closest?.('.ttpage [data-tt-zone]') as HTMLElement | null;
  const z = zone?.dataset['ttZone'];
  if (!zone || !z || z === 'binder' || z === 'off') return null;
  const r = zone.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  return { z, x: (ptr.x - r.left) / r.width, y: (ptr.y - r.top) / r.height };
}

function sendCursor(force: boolean): void {
  if (!onTable() || !socketUp()) return;
  const now = Date.now();
  if (!force && now - lastSent < SEND_MS) {
    if (!sendTimer) sendTimer = setTimeout(() => { sendTimer = null; sendCursor(false); }, SEND_MS);
    return;
  }
  const at = anchor();
  const held = tt.heldSrc();
  const atKey = at ? `${at.z}|${at.x.toFixed(3)}|${at.y.toFixed(3)}` : null;
  if (!force && atKey === lastAt && held === lastHeld) return;
  lastSent = now; lastAt = atKey; lastHeld = held;
  send({ t: 'collab', op: 'cursor', at, held });
}

let marksQueued = false;
function drawMarksSoon(): void {
  if (marksQueued || typeof requestAnimationFrame !== 'function') { if (!marksQueued) drawMarks(); return; }
  marksQueued = true;
  requestAnimationFrame(() => { marksQueued = false; drawMarks(); });
}

/** the layer beside #app, made once */
function layer(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  let el = document.getElementById('collabmarks');
  if (!el) {
    el = document.createElement('div');
    el.id = 'collabmarks';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  return el;
}

function drawMarks(): void {
  const el = layer();
  if (!el) return;
  if (!onTable() || !view) { if (el.innerHTML) el.innerHTML = ''; return; }
  const byId = new Map(view.members.map(m => [m.id, m]));
  const marks: CollabMark[] = [];
  for (const c of cursors.values()) {
    const m = byId.get(c.id);
    if (!m || c.id === view.me) continue;
    let x: number | null = null, y: number | null = null;
    if (c.at) {
      const z = document.querySelector<HTMLElement>(`.ttpage [data-tt-zone="${CSS.escape(c.at.z)}"]`);
      const r = z?.getBoundingClientRect();
      if (r && r.width > 0) { x = r.left + c.at.x * r.width; y = r.top + c.at.y * r.height; }
    }
    let held: CollabMark['held'] = null;
    if (c.held) {
      const head = c.held.startsWith('head|') ? c.held.slice(5) : null;
      const h = head
        ? document.querySelector<HTMLElement>(`.ttpage [data-tt-zone="pile|${CSS.escape(head)}"]`)
        : document.querySelector<HTMLElement>(`.ttpage .tttable [data-tt-src="${CSS.escape(c.held)}"], .ttpage .ttrail [data-tt-src="${CSS.escape(c.held)}"]`);
      const r = h?.getBoundingClientRect();
      if (r && r.width > 0) held = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    }
    if (x === null && !held) continue;
    marks.push({ id: c.id, name: m.name, colour: collabColour(m.colour), x, y, held });
  }
  el.innerHTML = collabMarksHtml(marks);
}

let listening = false;
function ensureListeners(): void {
  if (listening || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  listening = true;
  document.addEventListener('pointermove', e => {
    if (!onTable()) return;
    ptr = { x: e.clientX, y: e.clientY };
    sendCursor(false);
  }, { passive: true, capture: true });
  document.addEventListener('pointerup', () => { if (onTable()) setTimeout(() => sendCursor(true), 0); }, { passive: true, capture: true });
  document.addEventListener('pointerleave', () => { if (onTable()) { ptr = null; sendCursor(true); } }, { passive: true });
  // the table pane scrolls under the marks: they follow
  document.addEventListener('scroll', () => { if (onTable() && cursors.size) drawMarksSoon(); }, { passive: true, capture: true });
  if (typeof window !== 'undefined') window.addEventListener('resize', () => { if (onTable()) drawMarksSoon(); });
}
