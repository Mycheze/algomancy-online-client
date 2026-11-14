/* The bell, the invite popup, and the room's friends panel.
 *
 * Owner, 2026-10-18: make a room and your friends are listed under it, the
 * online ones first; click one and they get a popup that joins them to the
 * game. A bell counts invites and friend requests, and is where anything else
 * of the kind goes. The server half is server/inbox.ts, which says why an
 * invite is re-checked against its room every time it is read.
 *
 * ── HOW IT IS BUILT ──────────────────────────────────────────────────
 *
 * A LAYER beside #app, like ui/report.ts: the bell and the popup must be on
 * every page that is not a board, and every screen module paints #app on its
 * own. Its clicks are `data-inbox`, never `data-btn` (main.ts owns those), and
 * are claimed in capture — including the ones in the room's friends panel,
 * which is the one piece painted INSIDE #app (by main.ts and ui/lobby.ts,
 * through `roomFriendsHtml`).
 *
 * ⚠ THE PANEL IS UPDATED IN PLACE, NOT BY REPAINTING THE ROOM. A poll that
 * repainted the constructed waiting room would rebuild its deck picker under
 * the player's pointer every few seconds. So the panel is a box with an id,
 * and a poll that changes it rewrites that box's insides and nothing else.
 * The room's own paints read the same state, so the two cannot disagree.
 *
 * ⚠ NOTHING POPS UP OVER A BOARD. A friend in a game cannot take a seat in
 * another one, and a dialog over a live board steals the click it lands
 * under. An invite that arrives during a game waits in the bell for the
 * board to go (the poll stops while one is up — a seated player already
 * counts as online).
 *
 * Polled over HTTP, never a socket: the home screen has none on purpose
 * (ui/queue.ts's header). Every poll is also what marks the player as on the
 * site for their friends.
 */
import { esc } from './util.ts';
import { playCue } from './audio.ts';
import { alertTab } from './tabalert.ts';
import { noteLine, type LeagueNote } from './leaguenotes.ts';
import { cubeNoteLine } from './cubenotes.ts';
import type { CubeNote } from '../server/cube-types.ts';
import { matchLink, myMatchLine, type MyMatch } from './match.ts';
import {
  inboxLayerHtml, inviteRowsHtml as inviteRowsPageHtml, roomFriendsBodyHtml, roomFriendsHtml as roomFriendsPanelHtml,
  type DeckShareCardView, type FriendStatus, type InviteCardView, type InboxListView, type NoteCardView, type RoomFriendsView, type RoomFriendView as RoomFriend,
} from './pages/inbox.ts';

// ── types off the wire (server/api-inbox.ts) ─────────────────────────

export interface InviteView { id: string; from: string; room: string; seat: number; mode: string; label: string; at: number }
export interface RequestView { id: string; username: string }
/** a deck a friend sent (server/deckshare.ts DeckShareView) */
export interface DeckShareView extends DeckShareCardView { at: number }
/** a friend in the waiting room's panel — the shape ui/pages/inbox.ts draws */
export type { FriendStatus, RoomFriend };
/** a league match time the other player suggested, waiting on this one */
export interface TimeAsk { season: string; seasonName: string; match: string; from: string; at: number }

export interface InboxDeps {
  token: () => string | null;
  authHeaders: () => Record<string, string>;
  /** the waiting room this page is sitting in, if any — the panel's room */
  room: () => string | null;
  /** a page opened as a game that is not (yet) a waiting room — connecting,
   * a replay, a solo lesson: no bell, no poll, before any board class is set */
  quiet: () => boolean;
  /** a friend request was answered here: the profile should hear of it */
  friendsChanged: () => void;
  /** the zone league times are shown in: the player's league one, else the browser's */
  tz: () => string;
  /** a league note's button: the League page, at this season */
  openLeague: (season: string) => void;
  /** …or Play on this match, the way the League page's own button does */
  playLeague: (season: string, match: string) => void;
  /** the bell heard league news: whatever is showing the league should ask again */
  leagueChanged: () => void;
}

// ── state ─────────────────────────────────────────────────────────────

let deps: InboxDeps | null = null;
let layer: HTMLElement | null = null;
let invites: InviteView[] = [];
let requests: RequestView[] = [];
let friends: RoomFriend[] = [];
let notes: LeagueNote[] = [];
let times: TimeAsk[] = [];
/** docs/25: cube events' news (server/cube-store.ts cubeNotesFor), newest first */
let cubeNotes: CubeNote[] = [];
/** decks friends sent, until opened or dismissed (server/deckshare.ts) */
let decks: DeckShareView[] = [];
/** docs/22 §5.6: this account's open Competitive matches (/api/matches/mine) */
let matches: MyMatch[] = [];
/** has a poll answered yet — the panel says "loading" until one has */
let loaded = false;
let panelOpen = false;
/** invites this tab has already announced (sound + title) or closed the popup on */
let announced = new Set<string>();
let dismissed = new Set<string>();
/** a refusal from the last invite click, shown in the panel */
let panelMsg = '';
/** what the last answer in the bell did ("✓ You're playing …"), until it closes */
let bellMsg = '';
/** the login the last poll was made for: a new one polls at once */
let pollFor: string | null = null;
/** when the next poll is due (epoch ms), and whether one is out now */
let dueAt = 0;
let inFlight = false;
/** a poll was asked for while one was on its way: its answer may predate what changed */
let again = false;

const POLL_MS = 8000;
/** in a waiting room the panel's "invited" ticks should keep up */
const ROOM_POLL_MS = 4000;
const HIDDEN_POLL_MS = 30_000;

const SEEN_KEY = 'algoInboxSeen';
function loadSeen(): void {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '{}') as { a?: string[]; d?: string[] };
    announced = new Set(raw.a ?? []);
    dismissed = new Set(raw.d ?? []);
  } catch { /* private mode, or nothing stored: start empty */ }
}
/* One key per thing that can pop up or chime: an invite by its id, a league
 * note as `L<id>`, a suggested time as `T<match>@<at>` (a new time for the
 * same match is a new thing to hear about). */
const noteKey = (n: LeagueNote): string => `L${n.id}`;
const timeKey = (t: TimeAsk): string => `T${t.match}@${t.at}`;
/** a sent deck — re-sending it is a new line, so a new id, so a new chime */
const deckKey = (d: DeckShareView): string => `D${d.id}`;
/** a match whose sideboarding window is running — once per game */
const matchKey = (m: MyMatch): string => `M${m.id}@${m.game}`;
/** the open matches worth a line: not the one whose room this page is */
const shownMatches = (): MyMatch[] => matches.filter(m => m.room !== deps?.room());
/** …and the ones worth a count: the sideboarding window is running without you */
const dueMatches = (): MyMatch[] => shownMatches().filter(m => m.phase === 'between' && m.until !== null);
/** CT-517: a paused match whose opponent is in its room — waiting on you to resume */
const resumeAsks = (): MyMatch[] => shownMatches().filter(m => m.phase === 'paused' && m.opponentHere === true);
/** once per pause */
const resumeKey = (m: MyMatch): string => `MR${m.id}@${m.pausedAt}`;

function saveSeen(): void {
  // only the ones still waiting are worth keeping; the rest have gone
  const live = new Set([...invites.map(i => i.id), ...notes.map(noteKey), ...times.map(timeKey), ...decks.map(deckKey), ...matches.map(matchKey),
    ...matches.map(resumeKey)]);
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify({
      a: [...announced].filter(id => live.has(id)), d: [...dismissed].filter(id => live.has(id)),
    }));
  } catch { /* the popup may come back after a reload — that is all */ }
}

/** what the bell counts: everything waiting on an answer, and league news not yet read */
const unread = (): number => invites.length + requests.length + times.length + decks.length + notes.filter(n => !n.read).length
  + cubeNotes.filter(n => !n.read).length
  + dueMatches().length + resumeAsks().length;

/** a league time, in the player's zone */
function timeText(unix: number): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
  try { return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: deps?.tz() }).format(unix * 1000); }
  catch { return new Date(unix * 1000).toUTCString(); }
}

/** the agreed-time reminders worth a popup: unread, and the match not long started */
const reminders = (): LeagueNote[] => notes.filter(n => n.kind === 'time-reminder' && !n.read
  && typeof n.data['at'] === 'number' && (n.data['at'] as number) * 1000 + 30 * 60_000 > Date.now());

const appEl = (): HTMLElement | null =>
  typeof document !== 'undefined' && typeof document.getElementById === 'function'
    ? document.getElementById('app') : null;
const onBoard = (): boolean => !!appEl()?.classList?.contains('board');

// ── the room's friends panel ─────────────────────────────────────────

/** the panel's view: what ui/pages/inbox.ts draws */
const panelView = (): RoomFriendsView => ({ loaded, friends, msg: panelMsg });

/**
 * The "Invite a friend" panel for a waiting room. `open` is false once the
 * other seat is filled, and then there is nothing to invite anybody to. A
 * signed-out player has no friends list, so gets no panel.
 */
export function roomFriendsHtml(open: boolean): string {
  if (!open || !deps?.token()) return '';
  return roomFriendsPanelHtml(panelView());
}

/** rewrite the panel's insides, if a room is showing one (see the header) */
function paintPanel(): void {
  const box = typeof document !== 'undefined' && typeof document.getElementById === 'function'
    ? document.getElementById('roomfriends') : null;
  if (box) box.innerHTML = roomFriendsBodyHtml(panelView());
}

// ── the layer: bell, list, popup ─────────────────────────────────────

/** a league note as the bell draws it: its sentence, in the player's zone */
function noteCard(n: LeagueNote): NoteCardView {
  const { html, action } = noteLine(n, timeText);
  const match = typeof n.data['match'] === 'string' ? n.data['match'] : '';
  return { key: noteKey(n), season: n.season, match, read: n.read, html, action };
}

/** the list's view: every card, each with what other modules draw already drawn */
function listView(): InboxListView {
  return {
    bellMsg,
    matches: shownMatches().map(m => {
      const l = myMatchLine(m);
      // CT-517: the other player is in the paused match's room, waiting on you
      return { room: m.room, seat: m.seat, asks: m.phase === 'paused' && m.opponentHere === true,
        opponent: m.opponent, text: l.text, button: l.button };
    }),
    invites,
    times: times.map(t => ({ season: t.season, seasonName: t.seasonName, match: t.match, from: t.from,
      when: timeText(t.at / 1000) })),
    requests,
    decks: decks.map(d => ({ id: d.id, from: d.from, deck: d.deck, name: d.name })),
    notes: notes.map(noteCard),
    cube: cubeNotes.map(n => ({ event: n.event, read: n.read, html: cubeNoteLine(n) })),
  };
}

// ── what the home's toolbar and Join sheet read (docs/24) ─────────────

/** The bell's count — what the home's Alerts button badges. 0 signed out
 * (what a signed-out poll left behind is not this viewer's). */
export function inboxUnread(): number { return deps?.token() ? unread() : 0; }

/** Whether the notifications list is on screen — what draws the toolbar's
 * Alerts button pressed (pages/frame.ts). False signed out, on a board and on
 * a game page, where the layer draws nothing whatever `panelOpen` says. */
export function inboxListOpen(): boolean {
  return panelOpen && !!deps?.token() && !onBoard() && !deps.quiet();
}

/** The toolbar's Alerts button follows the list as it opens and closes: its
 * pressed state patched in place (as the home patches its badge), since the
 * page under the layer is not repainted for a click on the bell. The next
 * repaint draws the same from frameChromeView. */
function pressBells(): void {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  const open = inboxListOpen();
  document.querySelectorAll('.ui-icon-button[data-inbox="bell"]').forEach(b => {
    b.classList.toggle('on', open);
    b.setAttribute('aria-pressed', open ? 'true' : 'false');
  });
}

/** the friend invites waiting on an answer — part of the home's Join badge */
export function inviteCount(): number { return deps?.token() ? invites.length : 0; }

/** The friends list the last poll brought, and whether one has answered yet —
 * what the Decks page's Share sheet lists under "Send to a friend". Empty
 * signed out. */
export function shareFriends(): { loaded: boolean; friends: readonly RoomFriend[] } {
  return deps?.token() ? { loaded, friends } : { loaded: false, friends: [] };
}

/* ONE LISTENER SLOT, like onInboxChange: the Decks page, whose Share sheet
 * lists the friends. Called when a poll changes the friends list (or is the
 * first to answer), so a sheet opened before the first poll fills in. */
let friendsChanged: (() => void) | null = null;
export function onShareFriends(cb: () => void): void { friendsChanged = cb; }

/** the pending invites, as ui/pages/inbox.ts inviteRowsHtml draws them */
export function inviteRowsView(): InviteCardView[] {
  return deps?.token() ? invites.map(i => ({ id: i.id, from: i.from, label: i.label })) : [];
}

/** the pending invites as rows with their Join / No thanks buttons ('' when none) */
export function inviteRowsHtml(): string { return inviteRowsPageHtml(inviteRowsView()); }

/* ONE LISTENER SLOT: the home screen, which repaints itself when the counts it
 * badges move. Called only when inboxUnread() or inviteCount() actually CHANGES
 * (checked at every paint of the layer, which follows every poll and click),
 * never merely because the layer painted — so the home's repaint, which can
 * paint this layer again, cannot loop. Registering again replaces it. */
let changed: (() => void) | null = null;
let lastCounts = '';
export function onInboxChange(cb: () => void): void { changed = cb; }
function noteCounts(): void {
  const now = `${inboxUnread()}|${inviteCount()}`;
  if (now === lastCounts) return;
  lastCounts = now;
  changed?.();
}

function paint(): void {
  noteCounts();
  pressBells();
  if (!layer) return;
  if (!deps?.token() || onBoard() || deps.quiet()) { if (layer.innerHTML) layer.innerHTML = ''; return; }
  layer.innerHTML = inboxLayerHtml({
    unread: unread(),
    list: panelOpen ? listView() : null,
    pops: {
      invites: invites.filter(i => !dismissed.has(i.id)),
      reminders: reminders().filter(r => !dismissed.has(noteKey(r))).map(noteCard),
    },
  });
}

// ── the poll ──────────────────────────────────────────────────────────

/* ⚠ ONE STEADY setInterval TICK, NEVER A setTimeout THAT RE-ARMS ITSELF.
 * The headless suites boot all of main.ts in node with setInterval stubbed
 * out and setTimeout left real (132-token-separation is one), so a
 * self-re-arming timeout keeps that process alive for ever — the gate hung on
 * it. ui/queue.ts polls the same way for the same reason. The tick is cheap:
 * it asks whether a poll is due and almost always answers no. */
function schedule(): void {
  const hidden = typeof document !== 'undefined' && document.hidden === true;
  dueAt = Date.now() + (hidden ? HIDDEN_POLL_MS : deps?.room() ? ROOM_POLL_MS : POLL_MS);
}

function tick(): void {
  // signed in (or out) since the last poll: the bell should say so now, not
  // at the next scheduled poll eight seconds on
  if (deps && deps.token() !== pollFor) dueAt = 0;
  if (!inFlight && Date.now() >= dueAt) poll();
}

function poll(): void {
  if (!deps) return;
  // a game page: asked again at the next tick, so a room that turns into a
  // waiting room has its friends panel within a second
  if (deps.quiet()) { paint(); return; }
  schedule();
  // signed out, or on a board: nothing to fetch, but the tick keeps running —
  // signing in and leaving the board both happen without a page load
  pollFor = deps.token();
  if (!deps.token() || onBoard()) { paint(); return; }
  inFlight = true;
  const room = deps.room();
  fetch(`/api/inbox${room ? `?room=${encodeURIComponent(room)}` : ''}`, { headers: deps.authHeaders() })
    .then(r => r.json())
    .then((r: { ok?: boolean; invites?: InviteView[]; requests?: RequestView[]; friends?: RoomFriend[];
      league?: LeagueNote[]; times?: TimeAsk[]; decks?: DeckShareView[]; cube?: CubeNote[] }) => {
      if (!r.ok) return;
      take(r.invites ?? [], r.requests ?? [], r.friends ?? [], r.league ?? [], r.times ?? [], r.decks ?? [], r.cube ?? []);
    })
    .catch(() => { /* offline: keep what we had */ })
    .finally(() => { inFlight = false; schedule(); if (again) { again = false; dueAt = 0; } });
  pollMatches();
}

/** the open matches, beside the inbox: a separate answer, so a server that
 * does not know the route costs the bell nothing */
function pollMatches(): void {
  let asked: Promise<unknown>;
  try { asked = fetch('/api/matches/mine', { headers: deps!.authHeaders() }); } catch { return; }
  asked.then(r => (r as Response).json())
    .then((r: { ok?: boolean; matches?: MyMatch[] }) => {
      if (!r?.ok) return;
      const next = r.matches ?? [];
      if (JSON.stringify(next) === JSON.stringify(matches)) return;
      matches = next;
      // a sideboarding window that started without you is worth a chime
      const fresh = [...dueMatches().map(matchKey), ...resumeAsks().map(resumeKey)].filter(k => !announced.has(k));
      if (fresh.length && loaded) { playCue('decision'); alertTab('Your match is waiting'); }
      for (const k of fresh) announced.add(k);
      saveSeen();
      paint();
    })
    .catch(() => { /* offline, or an older server: no lines */ });
}

/** fold a poll's answer in, and say so only if something changed */
function take(nextInvites: InviteView[], nextRequests: RequestView[], nextFriends: RoomFriend[],
  nextNotes: LeagueNote[], nextTimes: TimeAsk[], nextDecks: DeckShareView[] = [], nextCube: CubeNote[] = []): void {
  const before = JSON.stringify([invites, requests, friends, notes, times, decks, cubeNotes, loaded]);
  const friendsBefore = loaded ? JSON.stringify(friends) : '';
  const leagueBefore = JSON.stringify([notes.map(n => n.id), times]);
  invites = nextInvites;
  requests = nextRequests;
  friends = nextFriends;
  notes = nextNotes;
  times = nextTimes;
  decks = nextDecks;
  cubeNotes = nextCube;
  // the things worth a chime: an invite, a time to answer, a match about to start
  const fresh: [string, string][] = [
    ...invites.map(i => [i.id, `${i.from} invited you`] as [string, string]),
    ...times.map(t => [timeKey(t), `${t.from} suggests a time`] as [string, string]),
    ...decks.map(d => [deckKey(d), `${d.from} sent you a deck`] as [string, string]),
    ...reminders().map(r => [noteKey(r), 'Your league match is soon'] as [string, string]),
  ].filter(([k]) => !announced.has(k));
  // the first answer only fills the set: what was already waiting when the
  // page opened is shown, not announced again on every load
  if (fresh.length && loaded) {
    playCue('decision');
    alertTab(fresh[0]![1]);
  }
  for (const [k] of fresh) announced.add(k);
  // news that lands while the list is open is news being read
  if (panelOpen) markRead();
  // the League page and the home banner show the same matches: a new message
  // or a new suggestion means what they show has moved on
  if (loaded && JSON.stringify([notes.map(n => n.id), times]) !== leagueBefore) deps?.leagueChanged();
  loaded = true;
  saveSeen();
  if (JSON.stringify(friends) !== friendsBefore) friendsChanged?.();
  if (JSON.stringify([invites, requests, friends, notes, times, decks, cubeNotes, loaded]) === before) return;
  paint();
  paintPanel();
}

/** every league and cube note on the list is read: here, and on the server
 * (league notes by id, cube notes by time — their ids are per event) */
function markRead(): void {
  const upTo = Math.max(0, ...notes.filter(n => !n.read).map(n => n.id));
  const cubeUpTo = Math.max(0, ...cubeNotes.filter(n => !n.read).map(n => n.at));
  if (!upTo && !cubeUpTo) return;
  if (upTo) notes = notes.map(n => ({ ...n, read: true }));
  if (cubeUpTo) cubeNotes = cubeNotes.map(n => (n.at <= cubeUpTo ? { ...n, read: true } : n));
  void post('/api/inbox/read', { ...(upTo ? { upTo } : {}), ...(cubeUpTo ? { cubeUpTo } : {}) }).catch(() => undefined);
}

/** poll now rather than at the next tick — after a click changed something */
const pollSoon = (): void => { dueAt = 0; tick(); };

/** Something the bell shows has just changed (a cube round posted, a match found):
 * ask now, not at the next scheduled poll. One fetch, through the steady tick's own
 * door — no timer of its own; one already on its way is followed by another. */
export function pollInboxNow(): void {
  if (!deps) return;
  if (inFlight) { again = true; return; }
  pollSoon();
}

// ── clicks ────────────────────────────────────────────────────────────

function post(path: string, body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string }> {
  return fetch(path, { method: 'POST', headers: deps!.authHeaders(), body: JSON.stringify(body) })
    .then(r => r.json() as Promise<{ ok?: boolean; error?: string }>);
}

function onClick(what: string, el: HTMLElement): void {
  const id = el.dataset['id'] ?? '';
  switch (what) {
    case 'bell':
      panelOpen = !panelOpen;
      bellMsg = '';
      // opening the bell reads the league news in it
      if (panelOpen) markRead();
      paint();
      return;
    case 'league':
      panelOpen = false;
      paint();
      deps?.openLeague(el.dataset['season'] ?? '');
      return;
    case 'cube': {
      panelOpen = false;
      paint();
      const ev = el.dataset['event'] ?? '';
      // a waiting room is a game page: the event is a navigation away, as the League page is
      if (openCubeFn && !deps?.room()) openCubeFn(ev);
      else location.search = `?cube=${encodeURIComponent(ev)}`;
      return;
    }
    case 'league-play':
      panelOpen = false;
      paint();
      deps?.playLeague(el.dataset['season'] ?? '', el.dataset['match'] ?? '');
      return;
    case 'time-accept': {
      const match = el.dataset['match'] ?? '';
      const t = times.find(x => x.match === match);
      times = times.filter(x => x.match !== match);
      paint();
      void post('/api/league/time/accept', { season: el.dataset['season'] ?? '', match }).then(r => {
        // say what just happened: the card it answered has gone
        bellMsg = r.ok && t ? `✓ You're playing <b>${esc(t.from)}</b> ${esc(timeText(t.at / 1000))}.`
          : esc(r.error ?? 'that did not go through');
        if (r.ok) deps?.leagueChanged();
      }).catch(() => { bellMsg = 'could not reach the server'; }).finally(() => { paint(); pollSoon(); });
      return;
    }
    case 'hide':
      dismissed.add(id);
      saveSeen();
      paint();
      return;
    case 'join': {
      const inv = invites.find(i => i.id === id);
      if (!inv) return;
      // gone from this page at once, and answered on the server BEFORE we
      // leave: the room's page polls the moment it opens, and an invite still
      // there put the popup back over the room it had just brought us to
      invites = invites.filter(i => i.room !== inv.room);
      panelOpen = false;
      paint();
      // into the game the way every game start here goes: a full navigation —
      // after the answer, or anyway if the server does not give one
      const go = (): void => {
        location.search = `?ws=1&room=${encodeURIComponent(inv.room)}&seat=${inv.seat}&mode=${encodeURIComponent(inv.mode)}`;
      };
      const fallback = window.setTimeout(go, 1500);
      void post('/api/invite/accept', { id }).catch(() => undefined)
        .finally(() => { clearTimeout(fallback); go(); });
      return;
    }
    case 'match-open':
      panelOpen = false;
      paint();
      location.search = matchLink(el.dataset['room'] ?? '', el.dataset['seat'] === '1' ? 1 : 0);
      return;
    case 'decline':
      invites = invites.filter(i => i.id !== id);
      paint();
      void post('/api/invite/decline', { id }).finally(pollSoon);
      return;
    case 'invite': {
      const room = deps?.room();
      if (!room) return;
      panelMsg = '';
      // show the tick at once; the poll after the answer says what is true
      friends = friends.map(f => (f.id === id ? { ...f, invite: 'sent' } : f));
      paintPanel();
      void post('/api/invite', { to: id, room }).then(r => {
        if (!r.ok) panelMsg = r.error ?? 'that invite did not go';
      }).catch(() => { panelMsg = 'could not reach the server'; }).finally(pollSoon);
      return;
    }
    // a deck a friend sent: View opens it where the share link would, and
    // the line goes — answered on the server before we leave, as a Join is
    case 'deck-view': {
      const deck = el.dataset['deck'] ?? '';
      decks = decks.filter(d => d.id !== id);
      panelOpen = false;
      paint();
      const go = (): void => { location.search = `?deck=${encodeURIComponent(deck)}`; };
      const fallback = window.setTimeout(go, 1500);
      void post('/api/inbox/deck/clear', { id }).catch(() => undefined)
        .finally(() => { clearTimeout(fallback); go(); });
      return;
    }
    case 'deck-clear':
      decks = decks.filter(d => d.id !== id);
      paint();
      void post('/api/inbox/deck/clear', { id }).finally(pollSoon);
      return;
    case 'friend-accept':
    case 'friend-decline':
      requests = requests.filter(r => r.id !== id);
      paint();
      void post(what === 'friend-accept' ? '/api/friends/accept' : '/api/friends/remove', { id })
        .finally(() => { deps?.friendsChanged(); pollSoon(); });
      return;
    default: return;
  }
}

let installed = false;

/* ui/cube.ts hands its opener in (initCube) rather than being imported: it pulls in the pick
 * screen and the builder, and decks.ts and pages/home.ts import this module — an import of
 * cube.ts here is a cycle waiting to happen. Not handed in (a headless boot): a navigation. */
let openCubeFn: ((code: string) => void) | null = null;
/** the bell's cube lines open the event through this (ui/cube.ts openCube) */
export function setCubeOpener(f: (code: string) => void): void { openCubeFn = f; }

/** Mount the layer and start polling. Safe without a document (the headless
 * harness): nothing here is load-bearing for the game. */
export function installInbox(d: InboxDeps): void {
  deps = d;
  if (installed) return;
  const app = appEl();
  if (!app || !document.body || typeof document.body.appendChild !== 'function') return;
  installed = true;
  loadSeen();
  layer = document.createElement('div');
  layer.id = 'inboxlayer';
  document.body.appendChild(layer);

  // capture, and only our own controls — see report.ts for why
  document.addEventListener('click', e => {
    const t = (e.target as HTMLElement | null)?.closest?.('[data-inbox]') as HTMLElement | null;
    if (!t) {
      // a click anywhere else closes the list, as a menu would
      if (panelOpen && !(layer && typeof layer.contains === 'function' && layer.contains(e.target as Node))) {
        panelOpen = false;
        paint();
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onClick(t.dataset['inbox']!, t);
  }, { capture: true });

  // the bell follows the board, as the report pill does; leaving a board also
  // polls at once, so an invite that waited through the game shows now
  if (typeof MutationObserver === 'function') {
    let was = onBoard();
    new MutationObserver(() => {
      const now = onBoard();
      if (now === was) return;
      was = now;
      if (now) paint(); else pollSoon();
    }).observe(app, { attributes: true, attributeFilter: ['class'] });
  }
  if (typeof document.addEventListener === 'function') {
    // back to the tab: catch up now rather than at the slow hidden tick
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pollSoon(); });
  }
  window.setInterval(tick, 1000);
  poll();
}
