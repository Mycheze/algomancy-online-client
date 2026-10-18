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
import { esc, elIcon } from './util.ts';
import { playCue } from './audio.ts';
import { alertTab } from './tabalert.ts';
import { noteLine, type LeagueNote } from './leaguenotes.ts';

// ── types off the wire (server/api-inbox.ts) ─────────────────────────

export interface InviteView { id: string; from: string; room: string; seat: number; mode: string; label: string; at: number }
export interface RequestView { id: string; username: string }
export type FriendStatus = 'online' | 'playing' | 'offline';
export interface RoomFriend {
  id: string; username: string; favoriteElement: string | null;
  status: FriendStatus; invite: 'sent' | 'declined' | null;
}
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

function saveSeen(): void {
  // only the ones still waiting are worth keeping; the rest have gone
  const live = new Set([...invites.map(i => i.id), ...notes.map(noteKey), ...times.map(timeKey)]);
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify({
      a: [...announced].filter(id => live.has(id)), d: [...dismissed].filter(id => live.has(id)),
    }));
  } catch { /* the popup may come back after a reload — that is all */ }
}

/** what the bell counts: everything waiting on an answer, and league news not yet read */
const unread = (): number => invites.length + requests.length + times.length + notes.filter(n => !n.read).length;

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

const STATUS_WORD: Record<FriendStatus, string> = { online: 'online', playing: 'in a game', offline: 'offline' };

function friendRowHtml(f: RoomFriend): string {
  const btn = f.invite === 'sent'
    ? `<button data-inbox="invite" data-id="${esc(f.id)}" disabled>Invited ✓</button>`
    : `<button ${f.status === 'offline' ? '' : 'class="primary" '}data-inbox="invite" data-id="${esc(f.id)}">${f.invite === 'declined' ? 'Ask again' : 'Invite'}</button>`;
  return `<div class="roomfriend ${f.status}">
    <span class="fdot ${f.status === 'offline' ? '' : 'on'}${f.status === 'playing' ? ' busy' : ''}"></span>
    ${f.favoriteElement ? `<span class="acctel icon ${esc(f.favoriteElement)}">${elIcon(f.favoriteElement)}</span>` : ''}
    <span class="rfname">${esc(f.username)}</span>
    <span class="rfstatus">${f.invite === 'declined' ? 'said no' : STATUS_WORD[f.status]}</span>
    ${btn}
  </div>`;
}

function panelBody(): string {
  if (!loaded) return '<p class="hint">…</p>';
  if (!friends.length) return '<p class="hint">Add friends on your profile and they show up here.</p>';
  return friends.map(friendRowHtml).join('')
    + (panelMsg ? `<p class="deckmsg">${esc(panelMsg)}</p>` : '');
}

/**
 * The "Invite a friend" panel for a waiting room. `open` is false once the
 * other seat is filled, and then there is nothing to invite anybody to. A
 * signed-out player has no friends list, so gets no panel.
 */
export function roomFriendsHtml(open: boolean): string {
  if (!open || !deps?.token()) return '';
  return `<div class="lobbypanel roomfriends"><div class="zonelabel">Invite a friend</div>
    <div id="roomfriends">${panelBody()}</div></div>`;
}

/** rewrite the panel's insides, if a room is showing one (see the header) */
function paintPanel(): void {
  const box = typeof document !== 'undefined' && typeof document.getElementById === 'function'
    ? document.getElementById('roomfriends') : null;
  if (box) box.innerHTML = panelBody();
}

// ── the layer: bell, list, popup ─────────────────────────────────────

function inviteCardHtml(i: InviteView, pop: boolean): string {
  return `<div class="invitecard">
    ${pop ? `<button class="invx" data-inbox="hide" data-id="${esc(i.id)}" title="keep it in the bell">✕</button>` : ''}
    <div><b>${esc(i.from)}</b> invites you to ${esc(i.label)}.</div>
    <div class="invbtns">
      <button class="primary" data-inbox="join" data-id="${esc(i.id)}">Join</button>
      <button data-inbox="decline" data-id="${esc(i.id)}">No thanks</button>
    </div>
  </div>`;
}

function timeAskHtml(t: TimeAsk): string {
  return `<div class="invitecard">
    <div><b>${esc(t.from)}</b> suggests playing your ${esc(t.seasonName)} match
      <b>${esc(timeText(t.at / 1000))}</b> <span class="dim">(your time)</span>.</div>
    <div class="invbtns">
      <button class="primary" data-inbox="time-accept" data-season="${esc(t.season)}" data-match="${esc(t.match)}">Accept</button>
      <button data-inbox="league" data-season="${esc(t.season)}">Suggest another</button>
    </div>
  </div>`;
}

function noteHtml(n: LeagueNote, pop: boolean): string {
  const { html, action } = noteLine(n, timeText);
  const match = typeof n.data['match'] === 'string' ? n.data['match'] : '';
  const btn = action === 'play' && match
    ? `<button class="primary" data-inbox="league-play" data-season="${esc(n.season)}" data-match="${esc(match)}">Play</button>`
    : action ? `<button data-inbox="league" data-season="${esc(n.season)}">League page</button>` : '';
  return `<div class="invitecard leaguenote${n.read ? '' : ' unread'}">
    ${pop ? `<button class="invx" data-inbox="hide" data-id="${esc(noteKey(n))}" title="keep it in the bell">✕</button>` : ''}
    <div>${html}</div>
    ${btn ? `<div class="invbtns">${btn}</div>` : ''}
  </div>`;
}

function listHtml(): string {
  const rows = [
    ...invites.map(i => inviteCardHtml(i, false)),
    ...times.map(timeAskHtml),
    ...requests.map(r => `<div class="invitecard">
      <div><b>${esc(r.username)}</b> wants to be friends.</div>
      <div class="invbtns">
        <button class="primary" data-inbox="friend-accept" data-id="${esc(r.id)}">Accept</button>
        <button data-inbox="friend-decline" data-id="${esc(r.id)}">Decline</button>
      </div>
    </div>`),
    ...(notes.length ? [`<div class="zonelabel">League</div>`, ...notes.map(n => noteHtml(n, false))] : []),
  ];
  return `<div class="inboxlist">
    <div class="zonelabel">Notifications</div>
    ${bellMsg ? `<p class="inboxdone">${bellMsg}</p>` : ''}
    ${rows.length ? rows.join('') : '<p class="hint">Nothing new.</p>'}
  </div>`;
}

function paint(): void {
  if (!layer) return;
  if (!deps?.token() || onBoard() || deps.quiet()) { if (layer.innerHTML) layer.innerHTML = ''; return; }
  const n = unread();
  const pops = panelOpen ? [] : [
    ...invites.filter(i => !dismissed.has(i.id)).map(i => inviteCardHtml(i, true)),
    ...reminders().filter(r => !dismissed.has(noteKey(r))).map(r => noteHtml(r, true)),
  ];
  layer.innerHTML = `<button class="inboxbell${n ? ' lit' : ''}" data-inbox="bell" title="notifications">🔔${n ? `<span class="inboxcount">${n}</span>` : ''}</button>`
    + (panelOpen ? listHtml() : '')
    + (pops.length ? `<div class="invitepops">${pops.join('')}</div>` : '');
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
      league?: LeagueNote[]; times?: TimeAsk[] }) => {
      if (!r.ok) return;
      take(r.invites ?? [], r.requests ?? [], r.friends ?? [], r.league ?? [], r.times ?? []);
    })
    .catch(() => { /* offline: keep what we had */ })
    .finally(() => { inFlight = false; schedule(); });
}

/** fold a poll's answer in, and say so only if something changed */
function take(nextInvites: InviteView[], nextRequests: RequestView[], nextFriends: RoomFriend[],
  nextNotes: LeagueNote[], nextTimes: TimeAsk[]): void {
  const before = JSON.stringify([invites, requests, friends, notes, times, loaded]);
  const leagueBefore = JSON.stringify([notes.map(n => n.id), times]);
  invites = nextInvites;
  requests = nextRequests;
  friends = nextFriends;
  notes = nextNotes;
  times = nextTimes;
  // the things worth a chime: an invite, a time to answer, a match about to start
  const fresh: [string, string][] = [
    ...invites.map(i => [i.id, `${i.from} invited you`] as [string, string]),
    ...times.map(t => [timeKey(t), `${t.from} suggests a time`] as [string, string]),
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
  if (JSON.stringify([invites, requests, friends, notes, times, loaded]) === before) return;
  paint();
  paintPanel();
}

/** every league note on the list is read: here, and on the server */
function markRead(): void {
  const upTo = Math.max(0, ...notes.filter(n => !n.read).map(n => n.id));
  if (!upTo) return;
  notes = notes.map(n => ({ ...n, read: true }));
  void post('/api/inbox/read', { upTo }).catch(() => undefined);
}

/** poll now rather than at the next tick — after a click changed something */
const pollSoon = (): void => { dueAt = 0; tick(); };

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
