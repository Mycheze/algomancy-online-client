/* CUBE DRAFT EVENTS, CLIENT SIDE (docs/25-cube-draft.md §9, §10).
 *
 * The contract every page module here keeps (league.ts, queue.ts): screen() says whether
 * this page owns #app, renderScreen() paints it, handleButton() is offered every click
 * (everything here is `cube-`, plus the home card's `nav-cube`), and the state lives in
 * this file. The URL is the page: `?cube=1` (my events) or `?cube=<CODE>` (one event),
 * written with replaceState. The drawing is pages/cube.ts; while I draft, the pick screen
 * is ui/cubedraft.ts's, and my deck is built on ui/cubebuild.ts's table.
 *
 * ── THE SOCKET ───────────────────────────────────────────────────────
 * The home has no WebSocket (queue.ts's header says why), so an event page opens its own,
 * room-less, while it is open: `{t:'cube', op:'sub', code, token}`, and the server pushes
 * `{t:'cube', view}` on every change, `{t:'cube', matched}` when a match of mine is posted,
 * `{t:'cube', error}` for a refused op. The draft's reserve and pick go up the same socket.
 * The view carries absolute deadlines and the server's `now`; the page counts down itself.
 *
 * ── ONE TIMER, AND ONLY WHILE IT IS NEEDED ───────────────────────────
 * A single setInterval runs while the page is open AND it shows a countdown or the socket
 * is down: it rewrites the countdowns in place and, when the socket is down, reconnects
 * once its backoff (1 s, 2 s, 4 s … 30 s) is up. Nothing here is a self-re-arming
 * setTimeout, and nothing runs at boot unless the URL opens the page (a self-re-arming
 * timer in a module installed at boot hangs the headless suites without a word).
 */
import * as acct from './account.ts';
import { playCue } from './audio.ts';
import { alertTab } from './tabalert.ts';
import { copyText } from './util.ts';
import { pollInboxNow, setCubeOpener } from './inbox.ts';
import type { CubeMatchView, CubeMine, CubeServerMsg, CubeView } from '../server/cube-types.ts';
import {
  CUBE_TABS, PACKS_MAX, PLAYERS_MAX, PLAYERS_MIN, ROUNDS_MAX, PACK_MIN,
  cubeGlanceHtml, cubeJoinRowsHtml, cubeView, defaultForm, formConfig, formFromConfig, paintCube, untilText,
  type CubeForm, type CubeHooks, type CubeSheet, type CubeTab,
} from './pages/cube.ts';
import type { StatusTone } from './components/status.ts';
import { cubeBuild, cubeTableWanted, openCubeBuilder, type CubeBuildActs } from './cubebuild.ts';
import { paintCubeDraft, stopCubeDraft, type CubeActs } from './cubedraft.ts';

// ── module state ──────────────────────────────────────────────────────

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let open = false;
/** the event showing, or null for my events */
let code: string | null = null;
let view: CubeView | null = null;
/** the server's clock minus this one's, from the last view */
let skew = 0;
let loading = false;
let list: CubeMine[] | null = null;
let listFor: string | null | undefined;
let listMissedAt: number | null = null;
const LIST_RETRY_MS = 15_000;
const LIST_STALE_MS = 60_000;
let listAskedAt = 0;
let listInFlight = false;
let tab: CubeTab = 'standings';
let sheet: CubeSheet | null = null;
let form: CubeForm | null = null;
let msg = '';
let msgTone: StatusTone = 'error';
let busy = false;
let arming: string | null = null;
let swapPick: string | null = null;
let banner: CubeMatchView | null = null;
/** the pick screen's Back ("Event"): the event page instead of the draft, until "Back to the draft" */
let draftHidden = false;
/** the builder was asked for on a reload (`?table=cube:<code>`): open it once the view is in */
let reopenBuilder: string | null = null;

const say = (text: string, tone: StatusTone): void => { msg = text; msgTone = tone; loadMissed = false; };
/** the line is the first load's failure, not something the player did: the view that lands takes it away */
let loadMissed = false;

export const screen = (): 'cube' | null => (open ? 'cube' : null);

export function initCube(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  // the bell's cube lines open the event the way the home card does
  setCubeOpener(c => openCube(c));
  const url = new URLSearchParams(location.search);
  // a reload on the builder's table: the page under it is this event's
  const table = cubeTableWanted();
  if (url.has('cube') && !url.has('room')) {
    const v = (url.get('cube') ?? '').trim().toUpperCase();
    show(v && v !== '1' ? v : null);
  } else if (table && !url.has('room')) {
    reopenBuilder = table;
    show(table.toUpperCase());
  }
}

/** The home card's way in, the Join sheet's rows, a typed code. */
export function openCube(c?: string | null): void {
  acct.leaveScreen();
  show(c ? c.trim().toUpperCase() : null);
  paint();
}

function show(c: string | null): void {
  if (code !== c) { view = null; tab = 'standings'; banner = null; draftHidden = false; }
  open = true; code = c; sheet = null; arming = null; swapPick = null; msg = '';
  syncUrl();
  if (c) { load(); connect(); } else { closeSocket(); listFor = undefined; askList(); }
  ensureTimer();
}

function close(): void {
  open = false; code = null; view = null; sheet = null;
  closeSocket();
  ensureTimer();
  syncUrl();
  rerenderHost();
}

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('cube');
    if (open) url.searchParams.set('cube', code ?? '1');
    history.replaceState(null, '', url.toString());
  } catch { /* file:// */ }
}

// ── HTTP ──────────────────────────────────────────────────────────────

type Reply = { ok: boolean; error?: string } & Record<string, unknown>;

async function post(path: string, body: Record<string, unknown> = {}): Promise<Reply> {
  busy = true;
  try {
    const r = await fetch(path, { method: 'POST', headers: acct.authHeaders(), body: JSON.stringify(body) });
    const j = await r.json().catch(() => null) as Reply | null;
    return j ?? { ok: false, error: r.status === 404 ? 'not allowed' : 'the server did not answer' };
  } catch {
    return { ok: false, error: 'could not reach the server' };
  } finally {
    busy = false;
  }
}

const eventPath = (c: string, op = ''): string => `/api/cube/${encodeURIComponent(c)}${op ? `/${op}` : ''}`;

/** a view moved on to a new phase or round: the bell's cube lines did too (ui/inbox.ts) */
export const bellMoved = (was: Pick<CubeView, 'phase' | 'round'> | null, now: Pick<CubeView, 'phase' | 'round'>): boolean =>
  !!was && (was.phase !== now.phase || was.round !== now.round);

/** take a view: the socket's push or an HTTP answer */
function take(v: CubeView): void {
  if (!open || !code || v.code.toUpperCase() !== code) return;
  if (bellMoved(view && view.code === v.code ? view : null, v)) pollInboxNow();
  view = v;
  skew = v.now - Date.now();
  loading = false;
  if (loadMissed) { msg = ''; loadMissed = false; }
  // a pairings swap names players of the round on screen: a new round drops the pick
  if (swapPick && !v.pending?.some(m => m.a.user === swapPick || m.b?.user === swapPick)) swapPick = null;
  if (sheet?.kind === 'pairings' && !v.pending?.length) sheet = null;
  // the builder open on this event follows the view (the pool, the submitted deck)
  const b = cubeBuild();
  if (b?.open && b.code.toUpperCase() === code) openCubeBuilder(v, BUILD_ACTS);
  else if (reopenBuilder && reopenBuilder.toUpperCase() === code && v.myPool && (v.phase === 'building' || v.phase === 'playing')) {
    reopenBuilder = null;
    openCubeBuilder(v, BUILD_ACTS);
  }
  ensureTimer();
}

function load(): void {
  if (!code) return;
  const c = code;
  loading = !view;
  fetch(eventPath(c), { headers: acct.authHeaders(false) })
    .then(r => r.json() as Promise<Reply & { view?: CubeView }>)
    .then(r => {
      if (code !== c) return;
      const v = r.view ?? (r && typeof r === 'object' && 'phase' in r ? r as unknown as CubeView : null);
      if (r.ok === false || !v) { loading = false; if (!view) { say(r.error ?? 'No event with that code.', 'error'); loadMissed = true; } paint(); return; }
      take(v);
      paint();
    })
    .catch(() => { if (code !== c) return; loading = false; if (!view) { say('could not reach the server', 'error'); loadMissed = true; } paint(); });
}

/** My events, for the list, the home card and the Join sheet: asked when a page draws them —
 * again for another account, after a miss (LIST_RETRY_MS), or once the answer is a minute old
 * (a match posted while the home sat there). Never on a timer of its own. */
function askList(): void {
  const tok = acct.token();
  if (!tok) { list = []; listFor = tok; return; }
  const age = Date.now() - listAskedAt;
  if (listFor === tok && (listInFlight || age < (listMissedAt !== null ? LIST_RETRY_MS : LIST_STALE_MS))) return;
  listFor = tok;
  listAskedAt = Date.now();
  listInFlight = true;
  fetch('/api/cube/mine', { headers: acct.authHeaders(false) })
    .finally(() => { listInFlight = false; })
    .then(r => r.json() as Promise<Reply & { events?: CubeMine[]; mine?: CubeMine[] }>)
    .then(r => {
      const rows = r.events ?? r.mine;
      if (!r.ok || !Array.isArray(rows)) { listMissedAt = Date.now(); if (open && !code) paint(); return; }
      const before = JSON.stringify(list);
      list = rows;
      listMissedAt = null;
      if (JSON.stringify(rows) !== before) { if (open && !code) paint(); else if (!open) rerenderHost(); }
    })
    .catch(() => { listMissedAt = Date.now(); if (open && !code) paint(); });
}

// ── the home card and the Join sheet ──────────────────────────────────

/** the home's Cube draft card body: my events at a glance ('' with none) */
export function homeGlanceHtml(): string {
  askList();
  return cubeGlanceHtml(list ?? []);
}

/** "Your cube events" in the Join sheet ('' with none) */
export function joinRowsHtml(): string {
  askList();
  return cubeJoinRowsHtml(list ?? []);
}

/** my cube matches waiting to be played — part of the home's Join badge */
export function joinCount(): number {
  askList();
  return (list ?? []).filter(r => r.myMatch && r.myMatch.status === 'waiting').length;
}

/** The Join sheet's code box: an event's code opens the event, anything else is a room. */
export function tryEvent(typed: string, orElse: () => void): void {
  const c = typed.trim().toUpperCase();
  if (!c) { orElse(); return; }
  fetch(eventPath(c), { headers: acct.authHeaders(false) })
    .then(r => r.json() as Promise<Reply & { view?: CubeView }>)
    .then(r => {
      const v = r.view ?? (r && typeof r === 'object' && 'phase' in r ? r as unknown as CubeView : null);
      if (r.ok !== false && v) { location.search = `?cube=${encodeURIComponent(c)}`; return; }
      orElse();
    })
    .catch(orElse);
}

// ── the way back from a cube match ────────────────────────────────────

/** The event a match room belongs to, for its way out: the match's own tag (the server's
 * `match.cube`), else the `cube=` this page's room link carried (a Play or a Watch from
 * the event page). null: not a cube match. */
export function backTo(matchEvent?: string | null): string | null {
  if (matchEvent) return matchEvent;
  try {
    const q = new URLSearchParams(location.search);
    const c = q.get('cube');
    return q.has('room') && c && c !== '1' ? c : null;
  } catch { return null; }
}

/** The ended board's way out (main.ts's bar): Home, or for a cube match — played or
 * watched — "Back to the event", the same words as the post-game screen and the ☰ menu.
 * The same button either way (`gohome`); main.ts's handler sends it to the event. */
export function homeButtonHtml(matchEvent?: string | null): string {
  return `<button data-btn="gohome">${backTo(matchEvent) ? 'Back to the event' : 'Home'}</button>`;
}

/** the search that goes back: `?cube=<CODE>`, or '' (home) */
export const backSearch = (matchEvent?: string | null): string => {
  const c = backTo(matchEvent);
  return c ? `?cube=${encodeURIComponent(c)}` : '';
};

/** A cube match's way out (main.ts: Leave, the table menu's Home, the post-game Home):
 * back to its event. False when this is no cube match — the caller goes home. */
export function leaveFor(matchEvent?: string | null): boolean {
  const s = backSearch(matchEvent);
  if (!s) return false;
  location.href = location.pathname + s;
  return true;
}

/** A cube match is over (`{t:'match', room: null}`). Between games, nothing is on the
 * board to read, so the page goes back to its event now; after a game the post-game screen
 * stays up and its way out goes to the event (main.ts goHome and the pg- buttons). */
export function matchOver(matchEvent: string | null | undefined, betweenGames: boolean): void {
  const s = backSearch(matchEvent);
  if (s && betweenGames) location.search = s;
}

// ── the socket ────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
/** the page wants a socket and has none: when to try again */
let retryAt: number | null = null;
let retries = 0;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];

const socketUp = (): boolean => !!ws && ws.readyState === 1;

function connect(): void {
  if (!open || !code) return;
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) { if (ws.readyState === 1) sub(); return; }
  retryAt = null;
  let sock: WebSocket;
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    sock = new WebSocket(`${proto}://${location.host}`);
  } catch { lost(); return; }
  ws = sock;
  sock.onopen = () => { if (ws === sock) { retries = 0; sub(); paint(); } };
  sock.onmessage = (ev: MessageEvent) => {
    if (ws !== sock) return;
    let m: CubeServerMsg | { t?: string };
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    onMsg(m);
  };
  sock.onclose = () => { if (ws === sock) { ws = null; lost(); paint(); } };
  // a socket handed over already open (a test's): subscribe now
  if (sock.readyState === 1) sub();
}

function sub(): void {
  if (!ws || ws.readyState !== 1 || !code) return;
  ws.send(JSON.stringify({ t: 'cube', op: 'sub', code, token: acct.token() }));
}

function send(body: Record<string, unknown>): void {
  if (socketUp()) ws!.send(JSON.stringify({ t: 'cube', ...body }));
  else { say('Reconnecting… try again in a moment.', 'error'); paint(); }
}

/** the socket went: try again after the backoff, while the page is open */
function lost(): void {
  if (!open || !code) return;
  retryAt = Date.now() + BACKOFF_MS[Math.min(retries, BACKOFF_MS.length - 1)]!;
  retries++;
  ensureTimer();
}

function closeSocket(): void {
  const s = ws;
  ws = null; retryAt = null; retries = 0;
  if (!s) return;
  try { if (s.readyState === 1) s.send(JSON.stringify({ t: 'cube', op: 'unsub' })); } catch { /* closing anyway */ }
  try { s.close(); } catch { /* already */ }
}

function onMsg(m: CubeServerMsg | { t?: string }): void {
  if (m.t !== 'cube') return;
  if ('view' in m && m.view) { take(m.view); paint(); return; }
  if ('matched' in m && m.matched) {
    banner = m.matched;
    pollInboxNow();
    playCue('decision');
    alertTab(m.matched.b ? 'Your match is ready' : 'You have a bye');
    paint();
    return;
  }
  if ('error' in m && m.error) { say(m.error, 'error'); paint(); }
}

// ── the one timer ─────────────────────────────────────────────────────

let timer = 0;

/** a countdown the page shows: the lobby's start, the break */
function hasDeadline(): boolean {
  const v = view;
  if (!v) return false;
  const now = Date.now() + skew;
  return (v.phase === 'lobby' && v.config.startAt !== null && v.config.startAt > now)
    || (v.breakUntil !== null && v.breakUntil > now);
}

function ensureTimer(): void {
  const want = open && !!code && (hasDeadline() || retryAt !== null);
  if (want && !timer) timer = setInterval(tick, 1000) as unknown as number;
  else if (!want && timer) { clearInterval(timer); timer = 0; }
}

function tick(): void {
  if (retryAt !== null && Date.now() >= retryAt) connect();
  if ($app && open) {
    const now = Date.now() + skew;
    let ran = false;
    for (const el of Array.from($app.querySelectorAll?.<HTMLElement>('[data-cube-until]') ?? [])) {
      const at = Number(el.dataset['cubeUntil']);
      const left = at - now;
      const t = untilText(left);
      if (el.textContent !== t) el.textContent = t;
      if (left <= 0) ran = true;
    }
    // a countdown ran out: the server's push brings what happens next; draw the page without it
    if (ran) paint();
  }
  ensureTimer();
}

// ── painting ──────────────────────────────────────────────────────────

const HOOKS: CubeHooks = {
  typed: (id, value) => { if (form) { if (id === 'name') form.name = value; else form.listText = value; } },
  repaint: () => paint(),
};

/** what the pick screen may do (ui/cubedraft.ts) */
const DRAFT_ACTS: CubeActs = {
  reserve: card => send({ op: 'reserve', card }),
  pick: card => send({ op: 'pick', card }),
};

/** what my deck's table may do (ui/cubebuild.ts) */
const BUILD_ACTS: CubeBuildActs = {
  submit: async (main, side) => {
    if (!code) return 'no event';
    const r = await post(eventPath(code, 'deck'), { main, side });
    if (!r.ok) return r.error ?? 'the deck was refused';
    if (r['view']) take(r['view'] as CubeView);
    return null;
  },
  suggest: async () => {
    if (!code) return null;
    const r = await post(eventPath(code, 'suggest'));
    const main = r['main'], side = r['side'];
    return r.ok && Array.isArray(main) && Array.isArray(side) ? { main: main as string[], side: side as string[] } : null;
  },
  // the table has closed itself: the router paints this page again
  back: () => rerenderHost(),
};

/** Paint the page — unless my deck's table is up over it (main.ts renderHome routes to the table
 * first, and calls renderScreen, `force`, once it is gone): a push then only refreshes the table. */
function paint(force = false): void {
  if (!$app || !open) return;
  if (!force && cubeBuild()?.open) return;
  const v = view;
  if (v && v.phase === 'drafting' && v.joined && v.draft && !draftHidden) {
    paintCubeDraft($app, v, DRAFT_ACTS, () => paint());
    return;
  }
  stopCubeDraft();
  if (!code) askList();
  paintCube($app, cubeView({
    code, event: view, list, listMissed: listMissedAt !== null && !list, loading, signedIn: !!acct.token(), skew,
    tab, sheet, form, msg, msgTone, busy, arming, swapPick, banner, online: !code || socketUp() || retryAt === null,
  }), HOOKS);
}

export function renderScreen(): void { paint(true); }

// ── clicks ────────────────────────────────────────────────────────────

/** an op's answer: the view it carries (or the socket's push), and its line */
async function act(op: string, body: Record<string, unknown> = {}, done = ''): Promise<boolean> {
  if (!code) return false;
  arming = null;
  paint();
  const r = await post(eventPath(code, op), body);
  if (r.ok) { if (done || msgTone === 'error') say(done, 'ok'); } else say(r.error ?? 'that did not work', 'error');
  if (r['view']) take(r['view'] as CubeView);
  else if (r.ok && !socketUp()) load();
  paint();
  return r.ok;
}

/** a two-press button: true when this press is the second */
function confirmed(key: string): boolean {
  if (arming === key) { arming = null; return true; }
  arming = key;
  paint();
  return false;
}

function formStep(k: string, d: number): void {
  const f = form;
  if (!f) return;
  switch (k) {
    case 'minPlayers': f.minPlayers = Math.max(PLAYERS_MIN, Math.min(f.maxPlayers, f.minPlayers + d)); break;
    case 'maxPlayers': f.maxPlayers = Math.max(f.minPlayers, Math.min(PLAYERS_MAX, f.maxPlayers + d)); break;
    case 'swissRounds': f.swissRounds = Math.max(1, Math.min(ROUNDS_MAX, f.swissRounds + d)); break;
    case 'packs': f.packs = Math.max(1, Math.min(PACKS_MAX, (f.packs ?? 3) + d)); break;
    case 'packSize': f.packSize = Math.max(PACK_MIN, Math.min(20, (f.packSize ?? 13) + d)); break;
  }
}

function formSet(k: string, v: string): void {
  const f = form;
  if (!f) return;
  switch (k) {
    case 'source': if (v === 'elements' || v === 'list') f.source = v; break;
    case 'tournament': if (v === 'swiss' || v === 'roundrobin' || v === 'exhibition') f.tournament = v; break;
    case 'rules': if (v === 'casual' || v === 'competitive') f.rules = v; break;
    case 'bestOf': f.bestOf = v === '3' ? 3 : 1; break;
    case 'start': if (v === 'host' || v === 'time') f.start = v; break;
    // Auto, or a number seeded from what Auto would have been
    case 'packs': f.packs = v === 'auto' ? null : f.packs ?? 3; break;
    case 'packSize': f.packSize = v === 'auto' ? null : f.packSize ?? 13; break;
  }
}

/** the scheduled start on another day, at the same time of day */
function formDay(offset: number): void {
  if (!form) return;
  const at = new Date(form.startAt);
  const day = new Date(); day.setHours(at.getHours(), at.getMinutes(), 0, 0); day.setDate(day.getDate() + offset);
  form.startAt = day.getTime();
}

const now = (): number => Date.now() + skew;

function playLink(room: string, seat: unknown): string {
  const s = seat === 0 || seat === 1 ? `&seat=${seat}` : '';
  return `?ws=1&room=${encodeURIComponent(room)}${s}&mode=constructed&cc=1&cube=${encodeURIComponent(code ?? '')}`;
}

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (b === 'nav-cube') { openCube(null); return true; }
  if (!b.startsWith('cube-')) return false;
  const d = btn.dataset;
  // a two-press button pressed once and then something else: it disarms
  if (arming && !['cube-kick', 'cube-leave', 'cube-cancel', 'cube-end', 'cube-drop'].includes(b)) arming = null;
  switch (b) {
    // the pick screen's Back is "Event": the event page over the draft, not the way home
    case 'cube-close':
      if (view?.phase === 'drafting' && view.joined && view.draft && !draftHidden) { draftHidden = true; paint(); return true; }
      close();
      return true;
    case 'cube-draft-show': draftHidden = false; paint(); return true;
    case 'cube-back': openCube(null); return true;
    // the post-game screen of a cube match: its one way out, back to the event
    case 'cube-return':
      if (!leaveFor(d['code'] || null)) location.href = location.pathname;
      return true;
    case 'cube-open': openCube(d['code'] ?? null); return true;
    case 'cube-tab': {
      const v = d['v'] as CubeTab | undefined;
      if (v && (CUBE_TABS as readonly string[]).includes(v)) { tab = v; paint(); }
      return true;
    }
    case 'cube-sheet-close': sheet = null; swapPick = null; paint(); return true;
    case 'cube-banner-close': banner = null; paint(); return true;

    // ── the New-event / settings form ──
    case 'cube-new':
      form = defaultForm(acct.currentUser()?.username ?? '', now());
      sheet = { kind: 'new' }; msg = ''; paint(); return true;
    case 'cube-edit':
      if (view) { form = formFromConfig(view.config, now()); sheet = { kind: 'edit' }; paint(); }
      return true;
    case 'cube-f-step': formStep(d['k'] ?? '', Number(d['d']) || 0); paint(); return true;
    case 'cube-f-set': formSet(d['k'] ?? '', d['v'] ?? ''); paint(); return true;
    case 'cube-f-bots': if (form) { form.fillBots = !form.fillBots; paint(); } return true;
    case 'cube-f-el': {
      const el = d['el'] as CubeForm['elements'][number] | undefined;
      if (form && el) form.elements = form.elements.includes(el) ? form.elements.filter(x => x !== el) : [...form.elements, el];
      paint();
      return true;
    }
    case 'cube-f-day': formDay(Number(d['d']) || 0); paint(); return true;
    case 'cube-f-time':
      if (form) form.startAt = Math.max(now(), form.startAt + (Number(d['d']) || 0) * 60_000);
      paint();
      return true;
    case 'cube-create': {
      if (!form || busy) return true;
      const config = formConfig(form);
      void post('/api/cube/new', { config }).then(r => {
        if (!r.ok || typeof r['code'] !== 'string') { say(r.error ?? 'could not make the event', 'error'); paint(); return; }
        form = null; listFor = undefined;
        openCube(r['code']);
      });
      paint();
      return true;
    }
    case 'cube-save':
      if (form && !busy) void act('config', { config: formConfig(form) }, 'Saved.').then(ok => { if (ok) { sheet = null; form = null; paint(); } });
      return true;

    // ── the lobby ──
    case 'cube-join': void act('join', {}, 'You have a seat.').then(ok => { if (ok) listFor = undefined; }); return true;
    case 'cube-leave': if (confirmed('leave')) void act('leave', {}, 'You left the event.').then(() => { listFor = undefined; }); return true;
    case 'cube-kick': if (confirmed(`kick:${d['user']}`)) void act('kick', { user: d['user'] ?? '' }); return true;
    case 'cube-start': void act('start'); return true;
    case 'cube-cancel': if (confirmed('cancel')) void act('cancel', {}, 'Called off.'); return true;
    case 'cube-copy': {
      const what = d['what'] === 'code' ? (code ?? '') : (document.getElementById('cube-share') as HTMLInputElement | null)?.value ?? '';
      copyText(what, d['what'] === 'code' ? null : document.getElementById('cube-share') as HTMLInputElement | null, btn, 'Copied ✓');
      return true;
    }

    // ── building and playing ──
    case 'cube-build':
      if (view?.myPool) openCubeBuilder(view, BUILD_ACTS);
      else { say('Your drafted cards are not here yet.', 'error'); paint(); }
      return true;
    case 'cube-startnow': sheet = { kind: 'startnow' }; paint(); return true;
    case 'cube-startnow-go': sheet = null; void act('start'); return true;
    case 'cube-ready': void act('ready', { on: d['on'] === '1' }); return true;
    case 'cube-play': {
      if (!code || busy) return true;
      banner = null;
      void post(eventPath(code, 'play'), d['pairing'] ? { pairing: d['pairing'] } : {}).then(r => {
        if (!r.ok || typeof r['room'] !== 'string') { say(r.error ?? 'could not open the match', 'error'); paint(); return; }
        location.search = playLink(r['room'], r['seat']);
      });
      paint();
      return true;
    }
    case 'cube-end': if (confirmed('end')) void act('end', {}, 'The event is over.'); return true;
    case 'cube-drop':
      if (d['on'] === '0' || confirmed(`drop:${d['user']}`)) void act('drop', { user: d['user'] ?? '', on: d['on'] === '1' });
      return true;

    // ── the host's pairings and results ──
    case 'cube-pairings': sheet = { kind: 'pairings' }; swapPick = null; paint(); return true;
    case 'cube-swap': {
      const u = d['user'] ?? '';
      if (!swapPick || swapPick === u) { swapPick = swapPick === u ? null : u; paint(); return true; }
      const a = swapPick;
      swapPick = null;
      void act('pairings', { swap: [a, u] });
      return true;
    }
    case 'cube-post': sheet = null; void act('post', {}, 'Posted.'); return true;
    case 'cube-result-open': if (d['pairing']) { sheet = { kind: 'result', pairing: d['pairing'] }; paint(); } return true;
    case 'cube-result':
      void act('result', { pairing: d['pairing'] ?? '', outcome: d['outcome'] ?? '' }).then(ok => { if (ok) { sheet = null; paint(); } });
      return true;
  }
  return false;
}
