/* BL-16 — THE OPERATOR DASHBOARD: accounts, reports, games, live rooms.
 *
 * Same contract as meta.ts, decks.ts, cards.ts and account.ts, which main.ts
 * already knows how to drive: `screen()` says whether this page owns the app
 * element, `renderScreen()` paints it, `handleButton()` is offered every click
 * (everything here is prefixed `admin-`), and the state lives in this file.
 *
 * THE URL IS THE PAGE: `?admin=1`, written with replaceState like every other
 * page here. There is no link to it anywhere in the client — not in a menu,
 * not in a footer, not behind a role check. You reach it by typing the query
 * parameter, and what decides whether you see anything is the SERVER.
 *
 * ⚠ HIDING IS NOT A PERMISSION, and nothing on this page pretends otherwise.
 * Every route it calls 404s to a non-admin (server/api-admin.ts), so a curious
 * player who types ?admin=1 gets the same empty page whether they are logged
 * out, logged in, or holding an expired token — and a hostile one reading
 * bundle.js learns only the names of routes that will not answer them. The
 * page's own check exists to avoid showing an operator four empty tables, not
 * to keep anybody out.
 *
 * ── WHAT IS EDITABLE HERE AND WHAT IS NOT ────────────────────────────
 *
 * Editable: a judge badge, the admin flag, and a report's TRIAGE MARK. All
 * three are server state.
 *
 * Not editable, and it is not an oversight: a report's IMPLEMENTATION STATUS.
 * That lives in client/ledgers/playtest-ledger.ts, which is committed source —
 * a report is `fixed` when somebody wrote an entry naming the test that keeps
 * it fixed. Editing it from a browser would write to a source file on the
 * deploy box and be destroyed by the next `git pull`. So the status column is
 * read-only and shows the status OF THE RUNNING BUILD, which is the only
 * version of the question an operator has: "is this fixed in what these people
 * are playing right now?"
 */
import * as acct from './account.ts';
import { esc } from './util.ts';

/* ── the shapes the server sends (server/admin.ts) ─────────────────── */

interface Badge { owner?: true; judge?: 1 | 2 | 3; since: string }

interface AccountRow {
  id: string; username: string; createdAt: string; admin: boolean;
  badge?: Badge | null; games: number; wins: number;
  lastPlayed: string | null; friends: number; decks: number; discord: string | null;
}

interface ReportRow {
  id: number; ts: string; room: string; seat: number | null; note: string;
  actionIndex: number | null; kind?: string; severity?: string | null;
  page?: string; by?: { name: string; owner?: boolean; judge?: number } | null;
  status: string | null; guards: string[]; ledgerNote: string | null;
  mark: 'real' | 'not' | null; markedBy: string | null;
}

interface GameRow {
  code: string; playedAt: string; mode: string; els: string[];
  finished: boolean; diverged: boolean; winner: number | null; turns: number;
  minutes: number | null; players: [string, string]; known: [boolean, boolean];
  rated: boolean; custom: boolean;
}

interface RoomRow {
  code: string; mode: string; names: [string, string];
  connected: [boolean, boolean]; users: [string | null, string | null];
  turn: number; phase: string; winner: number | null; actions: number;
  minutes: number; watchers: number; rated: boolean;
}

interface Overview {
  me: string; admins: number; accounts: number; games: number; rooms: number;
  reports: { total: number; unmarked: number; real: number; not: number; live: number };
}

type Tab = 'reports' | 'accounts' | 'games' | 'rooms';

/* ── module state ─────────────────────────────────────────────────────── */

let open = false;
let tab: Tab = 'reports';
let loading = false;
/** null until the first load; false once the server has refused us */
let allowed: boolean | null = null;
let msg = '';
let over: Overview | null = null;
let accounts: AccountRow[] = [];
let reports: ReportRow[] = [];
let games: GameRow[] = [];
let rooms: RoomRow[] = [];
/** reports filter: show only the ones nobody has judged yet */
let unmarkedOnly = false;
let $app: HTMLElement | null = null;
let rerenderHost: (() => void) | null = null;

export const screen = (): 'admin' | null => (open ? 'admin' : null);

/* ── talking to the server ────────────────────────────────────────────── */

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { headers: acct.authHeaders(false) });
    // 404 IS THE REFUSAL. api-admin.ts answers a non-admin with the same 404 a
    // nonexistent path gets, so there is no body to read and nothing to
    // distinguish — which is the point. Anything but 200 is "you are not an
    // admin here", and the page says exactly that and nothing more specific,
    // because it does not know anything more specific.
    if (!res.ok) { allowed = false; return null; }
    allowed = true;
    return await res.json() as T;
  } catch { msg = 'could not reach the server'; return null; }
}

async function post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(path, {
      method: 'POST', headers: acct.authHeaders(), body: JSON.stringify(body),
    });
    if (!res.ok) { allowed = false; return null; }
    return await res.json() as Record<string, unknown>;
  } catch { msg = 'could not reach the server'; return null; }
}

async function load(): Promise<void> {
  loading = true; paint();
  const ov = await get<{ ok: boolean } & Overview>('/api/admin/overview');
  if (ov) over = ov;
  if (allowed) {
    if (tab === 'accounts') {
      const r = await get<{ accounts: AccountRow[] }>('/api/admin/accounts');
      if (r) accounts = r.accounts;
    } else if (tab === 'reports') {
      const r = await get<{ reports: ReportRow[] }>('/api/admin/reports');
      if (r) reports = r.reports;
    } else if (tab === 'games') {
      const r = await get<{ games: GameRow[] }>('/api/admin/games');
      if (r) games = r.games;
    } else {
      const r = await get<{ rooms: RoomRow[] }>('/api/admin/rooms');
      if (r) rooms = r.rooms;
    }
  }
  loading = false; paint();
}

/* ── opening and closing ──────────────────────────────────────────────── */

export function openAdmin(): void {
  open = true; msg = '';
  syncUrl();
  void load();
}

function close(): void {
  open = false;
  try {
    const url = new URL(location.href);
    url.searchParams.delete('admin');
    history.replaceState(null, '', url.toString());
  } catch { /* ignore */ }
  // the page is gone, so this module must NOT paint — hand the screen back to
  // whoever owns it now (the home screen, usually), exactly as meta.ts does
  rerenderHost?.();
}

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    if (open) url.searchParams.set('admin', '1');
    else url.searchParams.delete('admin');
    history.replaceState(null, '', url.toString());
  } catch { /* ignore */ }
}

/**
 * main.ts calls this once at boot, the way it calls initMeta and the rest.
 * `?admin=1` opens the page; anything else leaves it shut.
 *
 * The load is fired even for a signed-out browser, and that is fine: the
 * request 404s and `allowed` goes false, which is what paints the one-line
 * "not an admin" page. Asking the server is the only way to know, because the
 * client is deliberately not told who is an admin — `/api/me` carries no such
 * field, so a bundle nobody is signed into cannot be read for the answer.
 */
export function initAdmin(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  try {
    if (new URLSearchParams(location.search).get('admin') === '1') openAdmin();
  } catch { /* a URL we cannot parse is a page we do not open */ }
}

/* ── painting ─────────────────────────────────────────────────────────── */

const day = (iso: string): string => (iso ? esc(iso.slice(0, 10)) : '—');
const when = (iso: string): string => (iso ? esc(iso.slice(0, 16).replace('T', ' ')) : '—');

function badgeChips(b: Badge | null | undefined): string {
  if (!b) return '';
  const out: string[] = [];
  if (b.owner) out.push('<span class="badgechip owner">owner</span>');
  if (b.judge) out.push(`<span class="badgechip judge">Judge L${b.judge}</span>`);
  return out.join(' ');
}

function accountsHtml(): string {
  const rows = accounts.map(a => `
    <tr>
      <td><b>${esc(a.username)}</b> ${badgeChips(a.badge)}${a.admin ? ' <span class="badgechip admin">admin</span>' : ''}</td>
      <td class="num">${a.games}</td>
      <td class="num">${a.wins}</td>
      <td>${day(a.createdAt)}</td>
      <td>${a.lastPlayed ? day(a.lastPlayed) : '—'}</td>
      <td>${a.discord ? esc(a.discord) : '—'}</td>
      <td class="adminacts">
        <button data-btn="admin-judge" data-name="${esc(a.username)}" data-level="0">none</button>
        <button data-btn="admin-judge" data-name="${esc(a.username)}" data-level="1">L1</button>
        <button data-btn="admin-judge" data-name="${esc(a.username)}" data-level="2">L2</button>
        <button data-btn="admin-judge" data-name="${esc(a.username)}" data-level="3">L3</button>
        <button data-btn="admin-flag" data-name="${esc(a.username)}" data-want="${a.admin ? '0' : '1'}"
          >${a.admin ? 'revoke admin' : 'make admin'}</button>
      </td>
    </tr>`).join('');
  return `<p class="adminnote">${accounts.length} account(s) · ${over?.admins ?? '?'} admin(s).
    A judge badge and the admin flag are independent — a judge is a trusted voice on rules,
    an admin can change other people's accounts. The last admin cannot be revoked.</p>
    <div class="admintablewrap"><table class="admintable">
    <thead><tr><th>account</th><th>games</th><th>wins</th><th>joined</th><th>last played</th>
      <th>discord</th><th>actions</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">no accounts yet</td></tr>'}</tbody></table></div>`;
}

function statusChip(r: ReportRow): string {
  if (!r.status) return '<span class="stchip none" title="no ledger entry yet">untriaged</span>';
  const t = r.guards.length ? `${r.guards.length} guard(s): ${r.guards.join(' · ')}` : (r.ledgerNote ?? '');
  return `<span class="stchip ${esc(r.status)}" title="${esc(t)}">${esc(r.status)}</span>`;
}

function reportsHtml(): string {
  const shown = unmarkedOnly ? reports.filter(r => !r.mark) : reports;
  const rows = shown.map(r => `
    <tr class="${r.mark === 'not' ? 'dim' : ''}">
      <td class="num">#${r.id}</td>
      <td>${when(r.ts)}</td>
      <td>${r.room ? esc(r.room) : `<i>${esc(r.page ?? 'page')}</i>`}</td>
      <td>${r.by ? esc(r.by.name) : '<i>signed out</i>'}</td>
      <td>${esc(r.kind ?? '?')}${r.severity ? `/${esc(r.severity)}` : ''}</td>
      <td class="notecell">${esc(r.note)}</td>
      <td>${statusChip(r)}</td>
      <td class="adminacts">
        <button class="${r.mark === 'real' ? 'on' : ''}" data-btn="admin-mark"
          data-id="${r.id}" data-mark="real" title="real, worth doing">👍</button>
        <button class="${r.mark === 'not' ? 'on' : ''}" data-btn="admin-mark"
          data-id="${r.id}" data-mark="not" title="not a bug / won't do">👎</button>
        ${r.mark ? `<button data-btn="admin-mark" data-id="${r.id}" data-mark=""
          title="clear — set by ${esc(r.markedBy ?? '')}">✕</button>` : ''}
      </td>
    </tr>`).join('');
  const s = over?.reports;
  return `<p class="adminnote">
    ${s ? `${s.total} report(s) · ${s.unmarked} unjudged · 👍 ${s.real} · 👎 ${s.not} · ${s.live} still open on the ledger.` : ''}
    <label><input type="checkbox" data-btn="admin-unmarked" ${unmarkedOnly ? 'checked' : ''}> unjudged only</label>
    <br><b>Status is read-only</b> and comes from the ledger in the build this server is running —
    it says whether a report is fixed <i>in what people are playing right now</i>. Your 👍/👎 is
    the part you can change, and it comes down with <code>npm run reports</code>.</p>
    <div class="admintablewrap"><table class="admintable">
    <thead><tr><th>#</th><th>when</th><th>where</th><th>who</th><th>kind</th><th>report</th>
      <th>status</th><th>real?</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="8">no reports</td></tr>'}</tbody></table></div>`;
}

function gamesHtml(): string {
  const untimed = games.filter(g => g.minutes === null).length;
  const rows = games.map(g => {
    // a name that came off a live account prints plain; one recovered from the
    // record is marked, because "an account you can go and look at" and "what
    // the seat was called that day" are different facts, and an operator acting
    // on the first had better not be reading the second
    const p = (i: 0 | 1): string => (g.known[i]
      ? esc(g.players[i])
      : `${esc(g.players[i])}<i class="unk" title="not a current account — the name recorded at the time">*</i>`);
    // ⚠ THE RESULT WORD IS PREFIXED, AND THAT IS NOT A STYLE CHOICE.
    // ui/test/244's R266 census walks every ui/*.ts for single-quoted
    // EventType names and counts a match as "this module consumes that event".
    // A results column printing the word for a tied game is not a consumer of
    // the event of the same name, and counting it makes the client's coverage
    // number claim it surfaces MORE than it does — the direction that test
    // says such a number must never drift on its own. The census reads
    // comments too, which is why this note does not spell the bare literal
    // either. Reads the same to a player.
    const result = !g.finished ? '<i>unfinished</i>'
      : g.winner === null ? 'a draw'
        : `${p(g.winner as 0 | 1)} won`;
    return `<tr>
      <td>${esc(g.code)}</td>
      <td>${when(g.playedAt)}</td>
      <td>${esc(g.mode)}${g.custom ? ' <span class="stchip">custom</span>' : ''}${g.rated ? ' <span class="stchip">rated</span>' : ''}</td>
      <td>${esc(g.els.join('+'))}</td>
      <td>${p(0)} vs ${p(1)}</td>
      <td>${result}${g.diverged ? ' <span class="stchip none" title="the current engine could not replay it to the end">diverged</span>' : ''}</td>
      <td class="num">${g.turns}</td>
      <td class="num">${g.minutes === null ? '—' : `${g.minutes}m`}</td>
    </tr>`;
  }).join('');
  const anyUnknown = games.some(g => !g.known[0] || !g.known[1]);
  return `<p class="adminnote">${games.length} game(s) in the history.
    ${anyUnknown ? 'A name marked <i class="unk">*</i> is the one recorded when the game was played — that seat was signed out, or the account no longer exists. ' : ''}
    ${untimed ? `${untimed} were played before the match timer existed and have no length —
    they are shown as “—” rather than as 0, which would drag every average toward nothing.` : ''}</p>
    <div class="admintablewrap"><table class="admintable">
    <thead><tr><th>code</th><th>played</th><th>mode</th><th>elements</th><th>players</th>
      <th>result</th><th>turns</th><th>length</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="8">no games recorded</td></tr>'}</tbody></table></div>`;
}

function roomsHtml(): string {
  const rows = rooms.map(r => {
    const seat = (i: 0 | 1): string =>
      `${esc(r.names[i])}${r.users[i] ? '' : ' <i>(guest)</i>'}` +
      `<span class="dot ${r.connected[i] ? 'on' : 'off'}" title="${r.connected[i] ? 'connected' : 'not connected'}"></span>`;
    return `<tr>
      <td>${esc(r.code)}</td>
      <td>${esc(r.mode)}${r.rated ? ' <span class="stchip">rated</span>' : ''}</td>
      <td>${seat(0)} vs ${seat(1)}</td>
      <td>${r.winner !== null ? 'over' : `turn ${r.turn} · ${esc(r.phase)}`}</td>
      <td class="num">${r.actions}</td>
      <td class="num">${r.minutes}m</td>
      <td class="num">${r.watchers}</td>
    </tr>`;
  }).join('');
  return `<p class="adminnote">${rooms.length} room(s) in memory. A finished game stays here
    until it is dropped, and a room whose players both closed their tabs still shows — the dot
    beside each seat is whether a socket is attached right now, so “over, nobody connected” and
    “turn 4, both here” are told apart by looking. This page never touches a live game.</p>
    <div class="admintablewrap"><table class="admintable">
    <thead><tr><th>room</th><th>mode</th><th>seats</th><th>at</th><th>actions</th>
      <th>live</th><th>watching</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">no rooms</td></tr>'}</tbody></table></div>`;
}

function paint(): void {
  const app = $app ?? document.getElementById('app');
  if (!app || !open) return;
  app.className = 'admin';
  if (allowed === false) {
    app.innerHTML = `<div class="adminpage"><div class="adminhead">
      <h1>Admin</h1><button data-btn="admin-close">close</button></div>
      <p class="adminnote">This account is not an admin on this server, or you are not signed in.
      Nothing else on this page is available.</p></div>`;
    return;
  }
  const tabs = ([
    ['reports', 'Reports'], ['accounts', 'Accounts'], ['games', 'Games'], ['rooms', 'Live rooms'],
  ] as [Tab, string][]).map(([k, label]) =>
    `<button class="admintab${tab === k ? ' on' : ''}" data-btn="admin-tab" data-tab="${k}">${label}</button>`).join('');
  const body = loading ? '<p class="adminnote">loading…</p>'
    : tab === 'accounts' ? accountsHtml()
      : tab === 'reports' ? reportsHtml()
        : tab === 'games' ? gamesHtml() : roomsHtml();
  app.innerHTML = `<div class="adminpage">
    <div class="adminhead">
      <h1>Admin</h1>
      <span class="adminwho">${over ? `signed in as ${esc(over.me)}` : ''}</span>
      <button data-btn="admin-refresh">refresh</button>
      <button data-btn="admin-close">close</button>
    </div>
    <div class="admintabs">${tabs}</div>
    ${msg ? `<p class="adminmsg">${esc(msg)}</p>` : ''}
    ${body}
  </div>`;
}

export function renderScreen(): void { paint(); }

/* ── clicks ───────────────────────────────────────────────────────────── */

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('admin-')) return false;
  if (b === 'admin-close') { close(); return true; }
  if (b === 'admin-refresh') { void load(); return true; }
  if (b === 'admin-tab') {
    tab = (btn.dataset['tab'] as Tab) ?? 'reports';
    void load();
    return true;
  }
  if (b === 'admin-unmarked') { unmarkedOnly = !unmarkedOnly; paint(); return true; }
  if (b === 'admin-mark') {
    const id = Number(btn.dataset['id']);
    const raw = btn.dataset['mark'] ?? '';
    const mark = raw === 'real' || raw === 'not' ? raw : null;
    // clicking the mark a report already carries clears it, so the same button
    // is both "say yes" and "take it back" — one control, no second ✕ to find
    const cur = reports.find(r => r.id === id)?.mark ?? null;
    void post('/api/admin/mark', { id, mark: cur === mark ? null : mark }).then(() => load());
    return true;
  }
  if (b === 'admin-judge') {
    const name = btn.dataset['name'] ?? '';
    const level = Number(btn.dataset['level'] ?? '0');
    const who = accounts.find(a => a.username === name);
    // the owner mark is preserved: this control is about the JUDGE level, and
    // silently dropping somebody's owner flag because a judge button was
    // clicked would be a second effect nobody asked for
    void post('/api/admin/setbadge', {
      name, owner: who?.badge?.owner === true, judge: level >= 1 && level <= 3 ? level : null,
    }).then(() => load());
    return true;
  }
  if (b === 'admin-flag') {
    const name = btn.dataset['name'] ?? '';
    const want = btn.dataset['want'] === '1';
    void post('/api/admin/setadmin', { name, admin: want }).then(r => {
      if (r && r['ok'] === false) msg = String(r['error'] ?? 'refused');
      void load();
    });
    return true;
  }
  return true;
}
