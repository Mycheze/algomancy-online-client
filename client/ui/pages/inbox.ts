/* The bell, its notification list, the invite popups and the waiting room's
 * friends panel — DRAWN. The layer itself (its state, its poll, its clicks)
 * is ui/inbox.ts; this file is only the markup, as pure functions of a view.
 *
 * Split out in the design-system round (2026-11-03) under the page contract
 * (pages/README.md), with one difference from a page: the state stays in
 * ui/inbox.ts, which main.ts imports early and which match.ts and the waiting
 * room import for roomFriendsHtml. So ui/inbox.ts gathers the view (its
 * `layerView()` / `panelView()`), these functions draw it, and inbox.ts puts
 * the result on its layer. Everything another module draws — a league note's
 * sentence (leaguenotes.ts noteLine), a match line (match.ts myMatchLine), a
 * time in the player's zone — arrives in the view already drawn: match.ts
 * imports inbox.ts, so importing it here would close a cycle.
 *
 * The markup is byte for byte what inbox.ts drew before the split (the
 * ui-driver and 839 read it). Its buttons stay hand-written `<button>`s:
 * every click here is `data-inbox`, and `.invbtns button` / `.roomfriend
 * button` size them, so the button component would add nothing but a class.
 * Its CSS is styles/shared/13-report-and-inbox.css. */
import { esc, elIcon } from '../util.ts';
import { statusMessage } from '../components/index.ts';

// ── the view ─────────────────────────────────────────────────────────

/** an invite to a room (server/api-inbox.ts InviteView) */
export interface InviteCardView { id: string; from: string; label: string }
/** a league time the other player suggested, with the time already in the player's zone */
export interface TimeAskCardView { season: string; seasonName: string; match: string; from: string; when: string }
/** a friend request */
export interface RequestCardView { id: string; username: string }
/** a league note: its sentence (trusted markup, leaguenotes.ts noteLine) and its one button */
export interface NoteCardView {
  /** the popup's dismiss key (`L<id>`) */
  key: string;
  season: string;
  /** the match a Play button opens ('' when none) */
  match: string;
  read: boolean;
  /** trusted markup: noteLine's sentence */
  html: string;
  action: 'league' | 'play' | null;
}
/** an open Competitive match (match.ts myMatchLine already applied) */
export interface MatchCardView {
  room: string; seat: number;
  /** the opponent is in the paused match's room, waiting on you (CT-517) */
  asks: boolean;
  opponent: string;
  /** trusted markup: myMatchLine's text */
  text: string;
  /** "Open" / "Resume" */
  button: string;
}

export interface InboxListView {
  /** trusted markup: what the last answer in the bell did ("✓ You're playing <b>…</b>") */
  bellMsg: string;
  matches: MatchCardView[];
  invites: InviteCardView[];
  times: TimeAskCardView[];
  requests: RequestCardView[];
  notes: NoteCardView[];
}

export interface InboxLayerView {
  /** what the bell counts */
  unread: number;
  /** the list is open (and then no popup is shown) */
  list: InboxListView | null;
  /** the popups: invites and match-time reminders not dismissed */
  pops: { invites: InviteCardView[]; reminders: NoteCardView[] };
}

export type FriendStatus = 'online' | 'playing' | 'offline';
export interface RoomFriendView {
  id: string; username: string; favoriteElement: string | null;
  status: FriendStatus; invite: 'sent' | 'declined' | null;
}
export interface RoomFriendsView {
  /** a poll has answered */
  loaded: boolean;
  friends: RoomFriendView[];
  /** a refusal from the last invite click */
  msg: string;
}

// ── the room's friends panel ─────────────────────────────────────────

const STATUS_WORD: Record<FriendStatus, string> = { online: 'online', playing: 'in a game', offline: 'offline' };

function friendRowHtml(f: RoomFriendView): string {
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

/** the inside of the panel's box — what a poll rewrites in place */
export function roomFriendsBodyHtml(v: RoomFriendsView): string {
  if (!v.loaded) return '<p class="hint">…</p>';
  if (!v.friends.length) return '<p class="hint">Add friends on your profile and they show up here.</p>';
  return v.friends.map(friendRowHtml).join('')
    + (v.msg ? statusMessage({ tag: 'p', tone: 'error', className: 'pageerr', text: v.msg }) : '');
}

/** the whole panel, as the waiting room's slot */
export function roomFriendsHtml(v: RoomFriendsView): string {
  return `<div class="lobbypanel roomfriends"><div class="zonelabel">Invite a friend</div>
    <div id="roomfriends">${roomFriendsBodyHtml(v)}</div></div>`;
}

// ── the cards ────────────────────────────────────────────────────────

function inviteCardHtml(i: InviteCardView, pop: boolean): string {
  return `<div class="invitecard">
    ${pop ? `<button class="invx" data-inbox="hide" data-id="${esc(i.id)}" title="keep it in the bell" aria-label="Dismiss (it stays in the bell)">✕</button>` : ''}
    <div><b>${esc(i.from)}</b> invites you to ${esc(i.label)}.</div>
    <div class="invbtns">
      <button class="primary" data-inbox="join" data-id="${esc(i.id)}">Join</button>
      <button data-inbox="decline" data-id="${esc(i.id)}">No thanks</button>
    </div>
  </div>`;
}

function timeAskHtml(t: TimeAskCardView): string {
  return `<div class="invitecard">
    <div><b>${esc(t.from)}</b> suggests playing your ${esc(t.seasonName)} match
      <b>${esc(t.when)}</b> <span class="dim">(your time)</span>.</div>
    <div class="invbtns">
      <button class="primary" data-inbox="time-accept" data-season="${esc(t.season)}" data-match="${esc(t.match)}">Accept</button>
      <button data-inbox="league" data-season="${esc(t.season)}">Suggest another</button>
    </div>
  </div>`;
}

function noteHtml(n: NoteCardView, pop: boolean): string {
  const btn = n.action === 'play' && n.match
    ? `<button class="primary" data-inbox="league-play" data-season="${esc(n.season)}" data-match="${esc(n.match)}">Play</button>`
    : n.action ? `<button data-inbox="league" data-season="${esc(n.season)}">League page</button>` : '';
  return `<div class="invitecard leaguenote${n.read ? '' : ' unread'}">
    ${pop ? `<button class="invx" data-inbox="hide" data-id="${esc(n.key)}" title="keep it in the bell" aria-label="Dismiss (it stays in the bell)">✕</button>` : ''}
    <div>${n.html}</div>
    ${btn ? `<div class="invbtns">${btn}</div>` : ''}
  </div>`;
}

/** docs/22 §5.6: an open match, one button from anywhere */
function matchCardHtml(m: MatchCardView): string {
  return `<div class="invitecard">
    <div>${m.asks ? `<b>${esc(m.opponent || 'Your opponent')}</b> wants to resume your match` : `Competitive match ${m.text}`}</div>
    <div class="invbtns"><button class="primary" data-inbox="match-open" data-room="${esc(m.room)}" data-seat="${m.seat}">${m.button}</button></div>
  </div>`;
}

function requestHtml(r: RequestCardView): string {
  return `<div class="invitecard">
      <div><b>${esc(r.username)}</b> wants to be friends.</div>
      <div class="invbtns">
        <button class="primary" data-inbox="friend-accept" data-id="${esc(r.id)}">Accept</button>
        <button data-inbox="friend-decline" data-id="${esc(r.id)}">Decline</button>
      </div>
    </div>`;
}

/** The pending invites as rows, for a sheet that lists them inside the page
 * (the home's Join sheet, docs/24): the same sentence and the same
 * `data-inbox="join"` / `"decline"` buttons as the popup, so the click goes
 * through inbox.ts's capture listener wherever the row is drawn. Nothing at
 * all when there is none. */
export function inviteRowsHtml(invites: readonly InviteCardView[]): string {
  if (!invites.length) return '';
  return `<div class="inviterows">${invites.map(i => `<div class="inviterow">
    <span><b>${esc(i.from)}</b> invites you to ${esc(i.label)}.</span>
    <span class="invbtns">
      <button class="primary" data-inbox="join" data-id="${esc(i.id)}">Join</button>
      <button data-inbox="decline" data-id="${esc(i.id)}">No thanks</button>
    </span>
  </div>`).join('')}</div>`;
}

/** the list the bell opens */
export function inboxListHtml(v: InboxListView): string {
  const rows = [
    ...v.matches.map(matchCardHtml),
    ...v.invites.map(i => inviteCardHtml(i, false)),
    ...v.times.map(timeAskHtml),
    ...v.requests.map(requestHtml),
    ...(v.notes.length ? [`<div class="zonelabel">League</div>`, ...v.notes.map(n => noteHtml(n, false))] : []),
  ];
  return `<div class="inboxlist">
    <div class="zonelabel">Notifications</div>
    ${v.bellMsg ? `<p class="inboxdone">${v.bellMsg}</p>` : ''}
    ${rows.length ? rows.join('') : '<p class="hint">Nothing new.</p>'}
  </div>`;
}

/** the whole layer: the bell, the list when it is open, and the popups when it is not */
export function inboxLayerHtml(v: InboxLayerView): string {
  const n = v.unread;
  const pops = v.list ? [] : [
    ...v.pops.invites.map(i => inviteCardHtml(i, true)),
    ...v.pops.reminders.map(r => noteHtml(r, true)),
  ];
  return `<button class="inboxbell${n ? ' lit' : ''}" data-inbox="bell" title="notifications" aria-label="Notifications${n ? `: ${n} new` : ''}">🔔${n ? `<span class="inboxcount">${n}</span>` : ''}</button>`
    + (v.list ? inboxListHtml(v.list) : '')
    + (pops.length ? `<div class="invitepops">${pops.join('')}</div>` : '');
}
