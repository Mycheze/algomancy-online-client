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
import { ALL_ELEMENTS } from '../engine/src/apply.ts';
import { esc } from './util.ts';
/* TYPE ONLY, and it has to stay that way: ui/meta.ts imports this module for
 * real (it needs the token and the current user), so a value import here would
 * close a cycle. `import type` is erased before the bundler ever sees it. */
import type { PublicDeck } from './meta.ts';

// ── the shapes the server sends ───────────────────────────────────────

/** NB: the wire carries more fields than the client reads (e.g. byElement,
 * which only the server's achievements look at) — only what the UI renders
 * is declared here. */
export interface Profile {
  games: number; wins: number; losses: number;
  /** games whose result we cannot read — see the server's Profile.unresolved */
  unresolved: number;
  byMode: Record<string, number>;
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
  /** the collection deck this seat brought, if any (ui/decks.ts filters on it) */
  deckId: string | null;
  finished: boolean; diverged: boolean; result: 'win' | 'loss' | 'unknown';
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
  /** the decks this account has PUBLISHED — public only, so an unlisted deck
   * stays reachable by its link and by nothing else (server/publicdecks.ts) */
  decks?: PublicDeck[];
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
let tab: 'stats' | 'achievements' | 'friends' | 'history' | 'decks' = 'stats';
let friendMsg = '';
let leaders: LeaderRow[] | null = null;

export const token = (): string | null => localStorage.getItem(TOKEN_KEY);
export const currentUser = (): Me | null => me;
export const screen = (): 'auth' | 'profile' | null => view;

/** the engine's own element list, so a new element never leaves this file
 * with a stale copy (the string type fits the server's weight records) */
const ELEMENTS: readonly string[] = ALL_ELEMENTS;

/** wire this module up. `rerender` repaints whatever the host was showing
 * (the home screen) once an account screen closes. */
export function initAccounts(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  if (token()) void refreshMe();
}

/** Ask the server who we are. A token the server no longer knows is dropped
 * rather than left to fail every subsequent request. */
async function refreshMe(): Promise<Me | null> {
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
    ? `${p.wins}W–${p.losses}L${p.unresolved ? ` · ${p.unresolved} unrecorded` : ''}`
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
  // login prefills the username, so the password is the field being asked for
  (document.getElementById(authMode === 'register' ? 'a-user' : 'a-pass') as HTMLInputElement | null)?.focus();
}

const pct = (have: number, need: number): number => Math.max(0, Math.min(100, Math.round((have / need) * 100)));

const shortDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * The decks this account has published — the shelf you point somebody at.
 *
 * PUBLIC ONLY. An unlisted deck is reachable by its link and by nothing else;
 * putting it on a profile would make the two shared states mean the same
 * thing. The server already filters (publicDecksOf), and this does not second-
 * guess it — it prints what it was sent.
 */
function decksTab(): string {
  const decks = me?.decks ?? [];
  if (!decks.length) {
    return `<section class="acctcard wide"><h3>Published decks</h3>
      <p class="hint">Nothing published yet. Open a deck on your decks page and use its
        <b>share</b> tab — public decks show up here and on the metagame list, unlisted ones
        are reachable only by their link.</p></section>`;
  }
  return `<section class="acctcard wide"><h3>Published decks</h3>
    <div class="metalist">${decks.map(d => {
    const { games, wins, losses } = d.record;
    const decided = wins + losses;
    return `<button class="metarow" data-btn="meta-open" data-id="${esc(d.id)}">
      <span class="metacover"></span>
      <span class="metabody">
        <span class="metaname">${esc(d.name)}</span>
        <span class="metaby">${d.cards.length} cards${
      d.copiedFrom ? ` · after ${esc(d.copiedFrom.owner)}’s ${esc(d.copiedFrom.name)}` : ''}</span>
      </span>
      <span class="metarec">${games
      ? `${decided ? `<b>${Math.round((wins / decided) * 100)}%</b> ` : ''}<span class="dim">${wins}W–${losses}L in ${games}</span>`
      : '<span class="dim">no games yet</span>'}</span>
    </button>`;
  }).join('')}</div></section>`;
}

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
  const tabs = (['stats', 'achievements', 'friends', 'decks', 'history'] as const).map(t =>
    `<button class="accttab ${tab === t ? 'on' : ''}" data-btn="acct-tab" data-tab="${t}">${
      t === 'achievements' ? `achievements <span class="acctcount">${me!.earned}/${me!.achievements.length}</span>`
      : t === 'friends' ? `friends <span class="acctcount">${me!.friends.length}${me!.incoming.length ? ` +${me!.incoming.length}` : ''}</span>`
      : t === 'decks' ? `decks <span class="acctcount">${me!.decks?.length ?? 0}</span>`
      : t}</button>`).join('');

  $app!.innerHTML = `<div class="acctpage">
    <div class="accthead">
      <div>
        <h1>${esc(me.username)} ${elChip(me.favoriteElement)}</h1>
        <div class="hint">${p.games} game${p.games === 1 ? '' : 's'} · ${p.wins}W–${p.losses}L${
          p.unresolved ? ` · ${p.unresolved} with no recorded result` : ''
        } · playing since ${shortDate(p.firstPlayed ?? me.createdAt)}</div>
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
      : tab === 'decks' ? decksTab()
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
        ${stat('no result', p.unresolved, 'games played on an older engine whose log no longer replays to its ending — the result was never recorded')}
        ${stat('win streak', p.streak)}
        ${stat('best streak', p.bestStreak)}
      </div>
      <div class="hint">formats played: ${esc(modes)}</div>
      ${p.unresolved ? `<div class="hint">${p.unresolved} game${p.unresolved === 1 ? ' has' : 's have'}
        no recorded result: played before the server started stamping the winner, and the rules have
        moved far enough since that the saved log no longer replays to the end.</div>` : ''}
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
      <td class="resultcell">${g.result === 'win' ? 'WIN' : g.result === 'loss' ? 'loss' : '?'}</td>
      <td>${esc(g.opponent)}</td>
      <td>${esc(g.mode)}</td>
      <td>${g.els.map(el => `<span class="acctel ${el}">${el}</span>`).join('')}</td>
      <td>${g.turns}${g.diverged ? '<span class="partial" title="the current engine cannot replay this game to its end — its numbers are a floor, not a total">+</span>' : ''}</td>
      <td>${g.life[0]}–${g.life[1]}</td>
      <td>${shortDate(g.playedAt)}</td>
      <td class="roomcell">${esc(g.code)}</td>
    </tr>`).join('')}</tbody></table>
    <div class="hint">A game counts as soon as it is played. A <b>+</b> beside the turn count means the
      current engine cannot replay that game all the way to its end, so its per-game numbers are a
      floor rather than a total — the rules have moved since it was played.</div>
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
      // invalidate the session with the token we are about to drop — post()
      // re-reads localStorage for its auth header, so clearing first would
      // send the request unauthenticated and leave the session alive
      const t = token();
      if (t) {
        void fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
          body: '{}',
        }).catch(() => {});
      }
      localStorage.removeItem(TOKEN_KEY);
      me = null; view = null;
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

// (the "game recorded" toast is gone: the result and its unlocks now ride the
// 'gameover' payload and are shown by the post-game screen, ui/postgame.ts)
