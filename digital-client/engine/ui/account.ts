/* Accounts in the client: the sign-in screen, the profile screen, and the
 * little strip at the top of the home screen.
 *
 * Kept out of main.ts, which is quite big enough. The contract is small:
 * main.ts asks whether an account screen is open (screen()), lets this module
 * paint if so (renderScreen()), offers it every button click first
 * (handleButton()), and drops barHtml() into the home screen. Everything else
 * — the token, the cached profile, the fetches — lives here.
 *
 * The token is a plain string in localStorage. It rides along on the
 * websocket join, which is what binds a seat to an account server-side, so a
 * game only counts toward your stats if you were logged in when you sat down.
 */

// ── the shapes the server sends ───────────────────────────────────────

export interface Profile {
  games: number; wins: number; losses: number; unfinished: number;
  byMode: Record<string, number>;
  byElement: Record<string, number>;
  cardElements: Record<string, number>;
  recycled: Record<string, number>;
  cards: Record<string, number>;
  unitsPlayed: number; spellsPlayed: number; tokensCast: number; modsApplied: number;
  cardsDrafted: number; resourcesActivated: number; abilitiesActivated: number;
  attacksDeclared: number; unitsAttackedWith: number;
  damageDealt: number; lifeLost: number; unitsLost: number; unitsKilled: number;
  turnsPlayed: number; longestGameTurns: number;
  flawlessWins: number; closeWins: number;
  streak: number; bestStreak: number;
  firstPlayed: string | null; lastPlayed: string | null;
}

export interface AchievementState {
  id: string; name: string; desc: string; icon: string;
  have: number; need: number; earned: boolean; earnedAt?: string | null;
}

export interface FriendView {
  id: string; username: string; online: boolean; games: number; wins: number;
  favoriteElement: string | null; lastPlayed: string | null;
}

export interface MatchRow {
  code: string; playedAt: string; mode: string; els: string[]; turns: number;
  finished: boolean; result: 'win' | 'loss' | 'unfinished';
  opponent: string; opponentId: string | null;
  life: [number, number];
  unitsPlayed: number; spellsPlayed: number; damageDealt: number;
  favoriteElement: string | null;
}

export interface Me {
  id: string; username: string; createdAt: string;
  favoriteElement: string | null;
  profile: Profile;
  topCards: { card: string; n: number }[];
  earned: number;
  opponents: { id: string; username: string; games: number; wins: number; losses: number }[];
  achievements: AchievementState[];
  friends: FriendView[]; incoming: FriendView[]; outgoing: FriendView[];
  history: MatchRow[];
}

export interface LeaderRow {
  id: string; username: string; online: boolean; games: number; wins: number;
  losses: number; streak: number; bestStreak: number;
  favoriteElement: string | null; earned: number; lastPlayed: string | null;
}

// ── module state ──────────────────────────────────────────────────────

const TOKEN_KEY = 'algoToken';

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let me: Me | null = null;
/** which account screen is open, if any */
let view: 'auth' | 'profile' | null = null;
/** the auth screen's mode and its message line */
let authMode: 'login' | 'register' = 'login';
let authMsg = '';
let busy = false;
/** profile screen tab */
let tab: 'stats' | 'achievements' | 'friends' | 'history' = 'stats';
let friendMsg = '';
let leaders: LeaderRow[] | null = null;

export const token = (): string | null => localStorage.getItem(TOKEN_KEY);
export const currentUser = (): Me | null => me;
export const screen = (): 'auth' | 'profile' | null => view;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ELEMENTS = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

/** wire this module up. `rerender` repaints whatever the host was showing
 * (the home screen) once an account screen closes. */
export function initAccounts(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  ensureToastHost();
  if (token()) void refreshMe();
}

/** Ask the server who we are. A token the server no longer knows is dropped
 * rather than left to fail every subsequent request. */
export async function refreshMe(): Promise<Me | null> {
  const t = token();
  if (!t) { me = null; return null; }
  try {
    const res = await fetch('/api/me', { headers: { authorization: `Bearer ${t}` } });
    if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); me = null; repaint(); return null; }
    const body = await res.json() as { ok: boolean; me?: Me };
    me = body.ok && body.me ? body.me : null;
  } catch {
    // offline: keep whatever profile we already had rather than logging out
  }
  repaint();
  return me;
}

/** The server pushes a fresh profile over the websocket after a game — take
 * it without a round trip. */
export function applyMe(next: Me): void {
  me = next;
  repaint();
}

function repaint(): void {
  if (view) renderScreen(); else rerenderHost();
}

// ── the home-screen strip ─────────────────────────────────────────────

const elChip = (el: string | null): string =>
  el ? `<span class="acctel ${el}" title="favorite element: ${el}">${el}</span>` : '';

/** The account line that sits above the home screen's buttons. */
export function barHtml(): string {
  if (!me) {
    return `<div class="acctbar out">
      <span class="accthint">Playing signed out — nothing is recorded.</span>
      <button data-btn="acct-open-auth">Log in / Sign up</button>
    </div>`;
  }
  const p = me.profile;
  const record = p.games
    ? `${p.wins}W–${p.losses}L${p.unfinished ? ` · ${p.unfinished} unfinished` : ''}`
    : 'no games yet';
  return `<div class="acctbar in">
    <button class="acctwho" data-btn="acct-open-profile" title="your profile, stats and achievements">
      <span class="acctname">${esc(me.username)}</span>${elChip(me.favoriteElement)}
    </button>
    <span class="acctrec">${record}${p.streak >= 2 ? ` · 🔥${p.streak}` : ''}</span>
    <button class="acctout" data-btn="acct-logout" title="log out">⏻</button>
  </div>`;
}

// ── screens ───────────────────────────────────────────────────────────

export function renderScreen(): void {
  if (!$app) return;
  $app.classList.remove('board');
  if (view === 'auth') renderAuth();
  else if (view === 'profile') renderProfile();
}

function renderAuth(): void {
  const isRegister = authMode === 'register';
  $app!.innerHTML = `<div class="joinscreen home acctscreen">
    <h1 class="homelogo">ALGOMANCY</h1>
    <h2>${isRegister ? 'Create an account' : 'Log in'}</h2>
    <p class="hint">${isRegister
      ? 'A username and a password, nothing else — no email, no recovery. Your stats, achievements and friends hang off this name.'
      : 'Signed in, every game you play is recorded to your profile.'}</p>
    <label class="namerow">Username <input id="a-user" maxlength="20" autocomplete="username"
      spellcheck="false" value="${esc(me?.username ?? '')}"></label>
    <label class="namerow">Password <input id="a-pass" type="password" maxlength="200"
      autocomplete="${isRegister ? 'new-password' : 'current-password'}"></label>
    ${authMsg ? `<p class="deckmsg">${esc(authMsg)}</p>` : ''}
    <div class="homebtns">
      <button class="primary" data-btn="acct-submit" ${busy ? 'disabled' : ''}>
        ${busy ? 'working…' : isRegister ? 'Create account' : 'Log in'}</button>
      <button data-btn="acct-toggle-mode">${isRegister
        ? 'I already have an account' : "I'm new here — create an account"}</button>
      <button data-btn="acct-close">Back</button>
    </div>
    ${isRegister ? `<p class="hint">If you have played here before under this name, signing up with it
      picks up the games you already played.</p>` : ''}
  </div>`;
  const submit = (): void => (document.querySelector('[data-btn="acct-submit"]') as HTMLElement | null)?.click();
  for (const id of ['a-user', 'a-pass']) {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if ((e as KeyboardEvent).key === 'Enter') submit();
    });
  }
  (document.getElementById(authMode === 'register' ? 'a-user' : 'a-user') as HTMLInputElement | null)?.focus();
}

const pct = (have: number, need: number): number => Math.max(0, Math.min(100, Math.round((have / need) * 100)));

const shortDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** the element bar: how much of everything you have actually played */
function elementBarHtml(weights: Record<string, number>): string {
  const total = ELEMENTS.reduce((n, el) => n + (weights[el] ?? 0), 0);
  if (!total) return '<div class="hint">No cards played yet.</div>';
  return `<div class="elbar">${ELEMENTS.map(el => {
    const w = weights[el] ?? 0;
    if (w <= 0) return '';
    return `<span class="elbarseg ${el}" style="flex:${w}" title="${el}: ${Math.round((w / total) * 100)}%"></span>`;
  }).join('')}</div>
  <div class="ellegend">${ELEMENTS.filter(el => (weights[el] ?? 0) > 0).map(el =>
    `<span class="acctel ${el}">${el} ${Math.round(((weights[el] ?? 0) / total) * 100)}%</span>`).join('')}</div>`;
}

const stat = (label: string, value: string | number, title = ''): string =>
  `<div class="statcell"${title ? ` title="${esc(title)}"` : ''}>
    <div class="statval">${typeof value === 'number' ? Math.round(value).toLocaleString() : esc(String(value))}</div>
    <div class="statlab">${esc(label)}</div></div>`;

function renderProfile(): void {
  if (!me) { view = 'auth'; renderAuth(); return; }
  const p = me.profile;
  const tabs = (['stats', 'achievements', 'friends', 'history'] as const).map(t =>
    `<button class="accttab ${tab === t ? 'on' : ''}" data-btn="acct-tab" data-tab="${t}">${
      t === 'achievements' ? `achievements <span class="acctcount">${me!.earned}/${me!.achievements.length}</span>`
      : t === 'friends' ? `friends <span class="acctcount">${me!.friends.length}${me!.incoming.length ? ` +${me!.incoming.length}` : ''}</span>`
      : t}</button>`).join('');

  $app!.innerHTML = `<div class="acctpage">
    <div class="accthead">
      <div>
        <h1>${esc(me.username)} ${elChip(me.favoriteElement)}</h1>
        <div class="hint">${p.games} game${p.games === 1 ? '' : 's'} · ${p.wins}W–${p.losses}L${
          p.unfinished ? ` · ${p.unfinished} unfinished` : ''} · playing since ${shortDate(p.firstPlayed ?? me.createdAt)}</div>
      </div>
      <div class="accthbtns">
        <button data-btn="acct-refresh" title="reload from the server">↻</button>
        <button data-btn="acct-logout">Log out</button>
        <button class="primary" data-btn="acct-close">Back to games</button>
      </div>
    </div>
    <div class="accttabs">${tabs}</div>
    <div class="acctbody">${
      tab === 'stats' ? statsTab(p)
      : tab === 'achievements' ? achievementsTab()
      : tab === 'friends' ? friendsTab()
      : historyTab()}</div>
  </div>`;
}

function statsTab(p: Profile): string {
  const modes = Object.entries(p.byMode).filter(([, n]) => n > 0)
    .map(([m, n]) => `${m} ${n}`).join(' · ') || 'none yet';
  return `<section class="acctcard">
      <h3>Record</h3>
      <div class="statgrid">
        ${stat('games', p.games)}
        ${stat('wins', p.wins)}
        ${stat('losses', p.losses)}
        ${stat('unfinished', p.unfinished, 'games that stopped before anybody won')}
        ${stat('win streak', p.streak)}
        ${stat('best streak', p.bestStreak)}
      </div>
      <div class="hint">formats played: ${esc(modes)}</div>
    </section>
    <section class="acctcard">
      <h3>Elements</h3>
      ${elementBarHtml(p.cardElements)}
      <div class="hint">Share of every card you have played. Hybrids count half to each.</div>
      <h4>Recycled for resources</h4>
      ${elementBarHtml(p.recycled)}
    </section>
    <section class="acctcard">
      <h3>On the table</h3>
      <div class="statgrid">
        ${stat('units played', p.unitsPlayed)}
        ${stat('spells played', p.spellsPlayed)}
        ${stat('spell tokens cast', p.tokensCast)}
        ${stat('augments & grafts', p.modsApplied)}
        ${stat('cards drafted', p.cardsDrafted)}
        ${stat('different cards', Object.values(p.cards).filter(n => n > 0).length)}
        ${stat('abilities used', p.abilitiesActivated)}
        ${stat('resources opened', p.resourcesActivated)}
      </div>
    </section>
    <section class="acctcard">
      <h3>Combat</h3>
      <div class="statgrid">
        ${stat('damage dealt', p.damageDealt)}
        ${stat('life lost', p.lifeLost)}
        ${stat('units killed', p.unitsKilled)}
        ${stat('units lost', p.unitsLost)}
        ${stat('attacks declared', p.attacksDeclared)}
        ${stat('units sent', p.unitsAttackedWith)}
        ${stat('turns played', p.turnsPlayed)}
        ${stat('longest game', `turn ${p.longestGameTurns}`)}
      </div>
    </section>
    <section class="acctcard">
      <h3>Most played cards</h3>
      ${me!.topCards.length ? `<ol class="topcards">${me!.topCards.map(c =>
        `<li><span class="tcname">${esc(c.card)}</span><span class="tcn">×${c.n}</span></li>`).join('')}</ol>`
        : '<div class="hint">Nothing yet.</div>'}
    </section>
    ${me!.opponents.length ? `<section class="acctcard">
      <h3>Head to head</h3>
      <table class="accttable"><tbody>${me!.opponents.map(o =>
        `<tr><td>${esc(o.username)}</td><td>${o.games} games</td>
          <td class="${o.wins >= o.losses ? 'good' : 'bad'}">${o.wins}W–${o.losses}L</td></tr>`).join('')}
      </tbody></table>
    </section>` : ''}`;
}

function achievementsTab(): string {
  const list = [...me!.achievements].sort((a, b) =>
    Number(b.earned) - Number(a.earned) || (b.have / b.need) - (a.have / a.need));
  return `<section class="acctcard wide">
    <h3>Achievements <span class="acctcount">${me!.earned} of ${list.length}</span></h3>
    <div class="achgrid">${list.map(a => `
      <div class="ach ${a.earned ? 'got' : ''}">
        <div class="achicon">${a.icon}</div>
        <div class="achbody">
          <div class="achname">${esc(a.name)}${a.earned && a.earnedAt
            ? `<span class="achdate">${shortDate(a.earnedAt)}</span>` : ''}</div>
          <div class="achdesc">${esc(a.desc)}</div>
          ${a.earned ? '' : `<div class="achbar"><span style="width:${pct(a.have, a.need)}%"></span></div>
            <div class="achprog">${a.have} / ${a.need}</div>`}
        </div>
      </div>`).join('')}</div>
  </section>`;
}

function friendRow(f: FriendView, kind: 'friend' | 'incoming' | 'outgoing'): string {
  return `<div class="friendrow">
    <span class="fdot ${f.online ? 'on' : ''}" title="${f.online ? 'online now' : 'offline'}"></span>
    <span class="fname">${esc(f.username)}</span>
    ${elChip(f.favoriteElement)}
    <span class="fstats">${f.games} games · ${f.wins}W</span>
    <span class="fspacer"></span>
    ${kind === 'incoming'
      ? `<button class="primary" data-btn="acct-friend-accept" data-id="${esc(f.id)}">Accept</button>
         <button data-btn="acct-friend-remove" data-id="${esc(f.id)}">Decline</button>`
      : kind === 'outgoing'
        ? `<span class="hint">asked</span>
           <button data-btn="acct-friend-remove" data-id="${esc(f.id)}">Cancel</button>`
        : `<button data-btn="acct-friend-remove" data-id="${esc(f.id)}" title="remove friend">✕</button>`}
  </div>`;
}

function friendsTab(): string {
  const board = leaders
    ? `<table class="accttable"><thead><tr><th></th><th>player</th><th>games</th><th>record</th><th>badges</th></tr></thead>
      <tbody>${leaders.map(l => `<tr>
        <td><span class="fdot ${l.online ? 'on' : ''}"></span></td>
        <td>${esc(l.username)} ${elChip(l.favoriteElement)}</td>
        <td>${l.games}</td>
        <td>${l.wins}W–${l.losses}L</td>
        <td>${l.earned}</td></tr>`).join('')}</tbody></table>`
    : '<div class="hint">loading…</div>';
  return `<section class="acctcard">
      <h3>Add a friend</h3>
      <div class="joinrow">
        <input id="a-friend" maxlength="20" placeholder="their username" spellcheck="false">
        <button data-btn="acct-friend-add">Send request</button>
      </div>
      ${friendMsg ? `<div class="deckmsg">${esc(friendMsg)}</div>` : ''}
    </section>
    ${me!.incoming.length ? `<section class="acctcard">
      <h3>Wants to be friends</h3>${me!.incoming.map(f => friendRow(f, 'incoming')).join('')}
    </section>` : ''}
    <section class="acctcard">
      <h3>Friends <span class="acctcount">${me!.friends.length}</span></h3>
      ${me!.friends.length ? me!.friends.map(f => friendRow(f, 'friend')).join('')
        : '<div class="hint">Nobody yet. Add your opponent by their username.</div>'}
      ${me!.outgoing.length ? `<h4>Waiting on</h4>${me!.outgoing.map(f => friendRow(f, 'outgoing')).join('')}` : ''}
    </section>
    <section class="acctcard wide">
      <h3>Everyone here</h3>
      ${board}
    </section>`;
}

function historyTab(): string {
  if (!me!.history.length) return '<section class="acctcard"><div class="hint">No games recorded yet.</div></section>';
  return `<section class="acctcard wide">
    <h3>Recent games</h3>
    <table class="accttable games"><thead><tr>
      <th>result</th><th>opponent</th><th>format</th><th>elements</th>
      <th>turns</th><th>life</th><th>played</th><th>room</th>
    </tr></thead><tbody>${me!.history.map(g => `<tr class="res-${g.result}">
      <td class="resultcell">${g.result === 'win' ? 'WIN' : g.result === 'loss' ? 'loss' : '—'}</td>
      <td>${esc(g.opponent)}</td>
      <td>${esc(g.mode)}</td>
      <td>${g.els.map(el => `<span class="acctel ${el}">${el}</span>`).join('')}</td>
      <td>${g.turns}</td>
      <td>${g.life[0]}–${g.life[1]}</td>
      <td>${shortDate(g.playedAt)}</td>
      <td class="roomcell">${esc(g.code)}</td>
    </tr>`).join('')}</tbody></table>
    <div class="hint">A game counts as soon as it is played — including the ones that never reached a winner.</div>
  </section>`;
}

// ── actions ───────────────────────────────────────────────────────────

/** POST with the bearer token attached, returning the parsed body. */
async function post<T>(path: string, body: unknown): Promise<T & { ok: boolean; error?: string }> {
  const t = token();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(body),
  });
  return await res.json() as T & { ok: boolean; error?: string };
}

async function submitAuth(): Promise<void> {
  const username = (document.getElementById('a-user') as HTMLInputElement | null)?.value.trim() ?? '';
  const password = (document.getElementById('a-pass') as HTMLInputElement | null)?.value ?? '';
  if (!username || !password) { authMsg = 'username and password, please'; renderAuth(); return; }
  busy = true; authMsg = ''; renderAuth();
  try {
    const r = await post<{ token?: string; me?: Me }>(
      authMode === 'register' ? '/api/auth/register' : '/api/auth/login', { username, password });
    busy = false;
    if (!r.ok || !r.token || !r.me) { authMsg = r.error ?? 'that did not work'; renderAuth(); return; }
    localStorage.setItem(TOKEN_KEY, r.token);
    // the seat name the game server files stats under is the account name, so
    // keep the home screen's name box in step rather than letting them differ
    localStorage.setItem('algoName', r.me.username);
    me = r.me;
    view = 'profile';
    tab = 'stats';
    renderScreen();
  } catch {
    busy = false;
    authMsg = 'could not reach the server';
    renderAuth();
  }
}

async function loadLeaders(): Promise<void> {
  try {
    const res = await fetch('/api/players');
    const body = await res.json() as { ok: boolean; players?: LeaderRow[] };
    leaders = body.players ?? [];
  } catch { leaders = []; }
  if (view === 'profile' && tab === 'friends') renderScreen();
}

/** main.ts hands every button click here first. Returns true when it was ours. */
export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('acct-')) return false;

  switch (b) {
    case 'acct-open-auth':
      view = 'auth'; authMode = me ? 'login' : 'register'; authMsg = '';
      renderScreen(); return true;

    case 'acct-open-profile':
      view = 'profile'; tab = 'stats';
      renderScreen();
      void refreshMe();
      return true;

    case 'acct-toggle-mode':
      authMode = authMode === 'login' ? 'register' : 'login'; authMsg = '';
      renderAuth(); return true;

    case 'acct-submit':
      void submitAuth(); return true;

    case 'acct-close':
      view = null; rerenderHost(); return true;

    case 'acct-refresh':
      void refreshMe(); return true;

    case 'acct-logout': {
      const t = token();
      localStorage.removeItem(TOKEN_KEY);
      me = null; view = null;
      if (t) void post('/api/auth/logout', {}).catch(() => {});
      rerenderHost();
      return true;
    }

    case 'acct-tab': {
      const t = btn.dataset['tab'];
      tab = (t === 'achievements' || t === 'friends' || t === 'history') ? t : 'stats';
      friendMsg = '';
      renderScreen();
      if (tab === 'friends' && !leaders) void loadLeaders();
      return true;
    }

    case 'acct-friend-add': {
      const input = document.getElementById('a-friend') as HTMLInputElement | null;
      const username = input?.value.trim() ?? '';
      if (!username) return true;
      void post<{ me?: Me; friends?: boolean }>('/api/friends/request', { username }).then(r => {
        friendMsg = r.ok
          ? (r.friends ? `you and ${username} are now friends` : `request sent to ${username}`)
          : (r.error ?? 'that did not work');
        if (r.me) me = r.me;
        renderScreen();
        void loadLeaders();
      }).catch(() => { friendMsg = 'could not reach the server'; renderScreen(); });
      return true;
    }

    case 'acct-friend-accept':
    case 'acct-friend-remove': {
      const id = btn.dataset['id'] ?? '';
      const path = b === 'acct-friend-accept' ? '/api/friends/accept' : '/api/friends/remove';
      void post<{ me?: Me }>(path, { id }).then(r => {
        if (r.me) me = r.me;
        friendMsg = r.ok ? '' : (r.error ?? 'that did not work');
        renderScreen();
      }).catch(() => { friendMsg = 'could not reach the server'; renderScreen(); });
      return true;
    }
  }
  return false;
}

// ── the post-game toast ───────────────────────────────────────────────
//
// Lives in its own element on <body> rather than in the render tree: an
// achievement can land while the board is on screen, and the board's render()
// rebuilds everything it owns.

let $toast: HTMLElement | null = null;

function ensureToastHost(): void {
  if ($toast?.isConnected) return;
  $toast = document.createElement('div');
  $toast.className = 'accttoasts';
  document.body.appendChild($toast);
}

/** Show "game recorded" and any achievements it unlocked. */
export function showRecorded(unlocked: { id: string; name: string; desc: string; icon: string }[]): void {
  ensureToastHost();
  const items = [
    { icon: '📊', name: 'Game recorded', desc: me ? `added to ${me.username}'s stats` : 'added to your stats' },
    ...unlocked.map(u => ({ icon: u.icon, name: `Achievement — ${u.name}`, desc: u.desc })),
  ];
  for (const [i, item] of items.entries()) {
    const el = document.createElement('div');
    el.className = 'accttoast';
    el.innerHTML = `<span class="ticon">${item.icon}</span>
      <span class="tbody"><b>${esc(item.name)}</b><br><span class="hint">${esc(item.desc)}</span></span>`;
    // clicking one dismisses it; they also time out on their own
    el.addEventListener('click', () => el.remove());
    $toast!.appendChild(el);
    setTimeout(() => el.remove(), 9000 + i * 1200);
  }
}
