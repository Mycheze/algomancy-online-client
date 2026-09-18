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
import { ICON_BASE } from './assets.ts';
import { artFor } from './meta.ts';
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
  /** BL-02 — Elo per format, and how many rated games are behind each. Only
   * a MATCHMADE game is rated, so these move independently of `games`. */
  rating: Record<string, number>;
  ratedGames: Record<string, number>;
  firstPlayed: string | null; lastPlayed: string | null;
}

export interface AchievementState {
  id: string; name: string; desc: string; icon: string;
  have: number; need: number; earned: boolean; earnedAt?: string | null;
  /** the section of the grid this belongs in — server-side `GROUPS` order */
  group?: string;
  /** a rung on a ladder of the same feat at rising goals; the grid shows one
   * card per ladder rather than one per rung */
  tier?: { of: string; rung: number };
  /** an unearned secret: the server has already replaced the name and desc,
   * so there is nothing here to spoil — this only says to style it as a
   * mystery rather than as a normal locked row */
  hidden?: boolean;
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
  /** R290: only on a game a concede decided — the turn, the server's weight
   * (the thresholds live in server/concession.ts, not here), and whether it
   * was this account that conceded. A `walkover` row is counted nowhere. */
  concession?: { turn: number; weight: 'walkover' | 'early' | 'normal'; mine: boolean };
  /** BL-43: only on a custom-rules game — its rules as summary lines. Counted nowhere. */
  custom?: string[];
  /** R298: only on a single card duel — [your card, theirs]. Counted nowhere of yours. */
  single?: [string, string];
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
  /** BL-39: the Discord handle this account is linked to, or null. From
   * privateView() only — a stranger does not get it from /api/player. */
  discord?: string | null;
  /** BL-42: an account created by playing rather than by signing up. Real in
   * every other way; it just has no name its owner chose and no password. */
  provisional?: boolean;
  /** BL-17 (first slice): the trust mark the owner set by hand, or null */
  badge?: { owner?: true; judge?: 1 | 2 | 3; since: string } | null;
  /** the favourite element the player CHOSE; null = the one played most */
  favoritePicked?: string | null;
}

/** the badge as a chip: "Owner", "Judge L2" — nothing for an unmarked account */
export function badgeChipsHtml(badge: Me['badge']): string {
  if (!badge) return '';
  const chips: string[] = [];
  if (badge.owner) chips.push('<span class="badgechip owner" title="the site\'s owner">Owner</span>');
  if (badge.judge) chips.push(`<span class="badgechip judge" title="judge level ${badge.judge} — a trusted voice on rules and reports">Judge L${badge.judge}</span>`);
  return chips.join(' ');
}

export interface LeaderRow {
  id: string; username: string; online: boolean; games: number; wins: number;
  losses: number; streak: number; bestStreak: number;
  favoriteElement: string | null; earned: number; lastPlayed: string | null;
  /** BL-02: the rating on the board being shown, and whether this row is
   * PUBLICLY listable — a player under five rated games can see their own
   * standing and is not shown to anybody else. */
  rating: number; ratedGames: number; listed: boolean;
}

// ── module state ──────────────────────────────────────────────────────

const TOKEN_KEY = 'algoToken';

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let me: Me | null = null;
/** BL-39: does this deploy have a Discord bot at all? */
let discordLinking = false;
/** the live link code, while one is showing */
let linkCode: { code: string; expiresAt: number } | null = null;
/** which account screen is open, if any */
let view: 'auth' | 'profile' | null = null;
/** the auth screen's mode and its message line */
let authMode: 'login' | 'register' = 'login';
let authMsg = '';
let busy = false;
/** profile screen tab */
let tab: 'stats' | 'achievements' | 'ladder' | 'friends' | 'history' | 'decks' = 'stats';
let friendMsg = '';
let leaders: LeaderRow[] | null = null;

/* BL-02 — the rating ladder. Its own state rather than more fields on
 * `leaders`: that board is the all-time wins scoreboard the friends tab
 * shows, this one is per-format and carries the "you are not listed yet" row
 * with it, and folding them together would mean one of the two screens
 * carrying numbers it never displays. */
type LadderMode = 'constructed' | 'draft';
interface Ladder {
  mode: LadderMode;
  players: LeaderRow[];
  /** your own row and TRUE rank, even when you are not listed yet */
  you: (LeaderRow & { rank: number }) | null;
  /** how many players have a rated game at all — the denominator of `rank` */
  rated: number;
  publicAfter: number;
}
let ladderMode: LadderMode = 'constructed';
let ladder: Ladder | null = null;

export const token = (): string | null => localStorage.getItem(TOKEN_KEY);
/** The headers a request to our own API carries: the bearer token when signed
 * in, and a JSON content-type unless told not to. One copy — decks.ts and
 * meta.ts each had their own, and this file spelled it inline four times. */
export const authHeaders = (json = true): Record<string, string> => {
  const t = token();
  return { ...(json ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: `Bearer ${t}` } : {}) };
};

/** BL-42 — adopt a session minted outside this module (the queue's guest
 * account). Stored exactly like a login, because it IS one: a guest is an
 * ordinary account that has not been named yet. */
export function adoptToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t);
  void refreshMe();
}

/** Is the signed-in account still an unclaimed guest? */
export const isGuest = (): boolean => !!me?.provisional;
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
    const res = await fetch('/api/me', { headers: authHeaders(false) });
    if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); me = null; repaint(); return null; }
    const body = await res.json() as
      { ok: boolean; me?: Me; discordLinking?: boolean };
    me = body.ok && body.me ? body.me : null;
    // With no bot token on the server there is nothing to claim a code, so the
    // Connections block is hidden rather than offering a dead end.
    discordLinking = body.discordLinking === true;
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

/** the favourite element as its icon (owner, 2026-09-05: "instead of using
 * just text, use the actual element icon") — the same data/icons file the
 * card text draws for a pip; the word stays as the title and the alt */
const elChip = (el: string | null): string =>
  el ? `<span class="acctel icon ${el}" title="favorite element: ${el}"><img src="${ICON_BASE}${el}.webp" alt="${el}"></span>` : '';

/** The account line that sits above the home screen's buttons.
 *
 * T17/T20 (2026-09-05): signed in, it is ONE box and the whole box is the
 * button that opens the account page — "Playing as" used to sit beside it as
 * a separate label with the same name in it. The logout button that lived
 * here is gone: logging out is on the account page and nowhere else. */
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
  return `<button class="acctbar in" data-btn="acct-open-profile" title="your profile, stats and achievements">
    <span class="acctwho">Playing as <span class="acctname">${esc(me.username)}</span>${elChip(me.favoriteElement)}</span>
    <span class="acctrec">${record}${p.streak >= 2 ? ` · 🔥${p.streak}` : ''}</span>
  </button>`;
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
    ${isRegister ? `<p class="pwwarn" data-warn="nopwreset"><b>DO NOT FORGET YOUR PASSWORD.
      THERE IS NO PASSWORD RESET.</b> There is no email address on this account, so there is
      nothing to send a reset link to and nobody who can verify it is you. Write it down.</p>` : ''}
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
      <span class="metacover">${d.cover
        ? `<img src="${esc(artFor(d.cover))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
        : ''}</span>
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

/** Owner, 2026-09-05: "Allow them to override and choose their favorite in
 * the account stats tab." One icon per element, the chosen one lit; "auto"
 * goes back to the one played most. */
function favoritePickerHtml(): string {
  const picked = me?.favoritePicked ?? null;
  return `<div class="favpick" role="radiogroup" aria-label="favourite element">
    ${ELEMENTS.map(el => `<button type="button" role="radio" aria-checked="${picked === el}" class="favel ${el}${picked === el ? ' on' : ''}"
      data-btn="acct-favorite" data-el="${el}" title="${el}"><img src="${ICON_BASE}${el}.webp" alt="${el}"></button>`).join('')}
    <button type="button" role="radio" aria-checked="${picked === null}" class="favel auto${picked === null ? ' on' : ''}"
      data-btn="acct-favorite" data-el="" title="the element you have played most">auto</button>
  </div>
  <div class="hint">${picked ? `You chose ${picked}.` : `Showing the element you have played most${me?.favoriteElement ? ` — ${me.favoriteElement}` : ''}.`}</div>`;
}

const stat = (label: string, value: string | number, title = ''): string =>
  `<div class="statcell"${title ? ` title="${esc(title)}"` : ''}>
    <div class="statval">${typeof value === 'number' ? Math.round(value).toLocaleString() : esc(String(value))}</div>
    <div class="statlab">${esc(label)}</div></div>`;

function renderProfile(): void {
  if (!me) { view = 'auth'; renderAuth(); return; }
  const p = me.profile;
  const tabs = (['stats', 'achievements', 'ladder', 'friends', 'decks', 'history'] as const).map(t =>
    `<button class="accttab ${tab === t ? 'on' : ''}" data-btn="acct-tab" data-tab="${t}">${
      t === 'achievements' ? `achievements <span class="acctcount">${me!.earned}/${me!.achievements.length}</span>`
      : t === 'friends' ? `friends <span class="acctcount">${me!.friends.length}${me!.incoming.length ? ` +${me!.incoming.length}` : ''}</span>`
      : t === 'decks' ? `decks <span class="acctcount">${me!.decks?.length ?? 0}</span>`
      : t}</button>`).join('');

  $app!.innerHTML = `<div class="acctpage">
    <div class="accthead">
      <div>
        <h1>${esc(me.username)} ${elChip(me.favoriteElement)} ${badgeChipsHtml(me.badge)}</h1>
        <div class="hint">${p.games} game${p.games === 1 ? '' : 's'} · ${p.wins}W–${p.losses}L${
          p.unresolved ? ` · ${p.unresolved} with no recorded result` : ''
        } · playing since ${shortDate(p.firstPlayed ?? me.createdAt)}</div>
      </div>
      <div class="accthbtns">
        <button data-btn="acct-refresh" title="reload from the server">↻</button>
        <button data-btn="acct-logout">Log out</button>
        <button class="primary" data-btn="acct-close">Return to Lobby</button>
      </div>
    </div>
    <div class="accttabs">${tabs}</div>
    <div class="acctbody">${
      tab === 'stats' ? statsTab(p)
      : tab === 'achievements' ? achievementsTab()
      : tab === 'ladder' ? ladderTab()
      : tab === 'friends' ? friendsTab()
      : tab === 'decks' ? decksTab()
      : historyTab()}</div>
  </div>`;
}

/* BL-39 — Discord linking, on the stats tab rather than a tab of its own.
 *
 * ⚠ DELIBERATELY NOT A NEW TAB. The tab router parses its name out of a
 * hand-written allow-list (see the ⚠ on `tabFromButton` below), and 'decks'
 * was once missing from it and silently rendered the stats page instead. One
 * row of content is not worth walking into that a second time.
 */
function connectionsHtml(): string {
  if (!discordLinking) return '';
  const linked = me?.discord;
  if (linked) {
    return `<section class="acctcard">
      <h3>Connections</h3>
      <div class="statgrid"><div class="stat"><b>Discord</b><span>@${esc(linked)}</span></div></div>
      <button class="btn" data-btn="acct-discord-unlink">Unlink Discord</button>
      <div class="hint">The bot uses this so <code>/profile</code> and
        <code>/rating</code> know who is asking. Unlinking here always works,
        even if you have lost the Discord account.</div>
    </section>`;
  }
  const showing = linkCode && linkCode.expiresAt > Date.now();
  return `<section class="acctcard">
      <h3>Connections</h3>
      ${showing
        ? `<div class="statgrid"><div class="stat"><b>your code</b>
             <span class="linkcode">${esc(linkCode!.code)}</span></div></div>
           <div class="hint">Type <code>/link code ${esc(linkCode!.code)}</code> in
             Discord within ten minutes.</div>`
        : `<button class="btn" data-btn="acct-discord-link">Link Discord</button>
           <div class="hint">Get a code here, type it into the bot. The code is
             minted on this page, signed in as you, which is what proves the
             account is yours.</div>`}
    </section>`;
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
      <h4>Rating</h4>
      <div class="statgrid">
        ${stat('constructed', p.rating?.['constructed'] ?? 1000,
          `${p.ratedGames?.['constructed'] ?? 0} rated constructed games`)}
        ${stat('live draft', p.rating?.['draft'] ?? 1000,
          `${p.ratedGames?.['draft'] ?? 0} rated draft games`)}
      </div>
      <div class="hint">${((p.ratedGames?.['constructed'] ?? 0) + (p.ratedGames?.['draft'] ?? 0)) === 0
        ? 'Everyone starts at 1000. Play a game from the matchmaking queue and it starts moving.'
        : `over ${p.ratedGames?.['constructed'] ?? 0} constructed and ${p.ratedGames?.['draft'] ?? 0} draft games from the queue`}</div>
      ${p.unresolved ? `<div class="hint">${p.unresolved} game${p.unresolved === 1 ? ' has' : 's have'}
        no recorded result: played before the server started stamping the winner, and the rules have
        moved far enough since that the saved log no longer replays to the end.</div>` : ''}
    </section>
    ${connectionsHtml()}
    <section class="acctcard">
      <h3>Elements</h3>
      ${elementBarHtml(p.cardElements)}
      <div class="hint">Share of every card you have played. Hybrids count half to each.</div>
      <h4>Recycled for resources</h4>
      ${elementBarHtml(p.recycled)}
      <div class="hint">Prismites you turned into an element count here too.</div>
      <h4>Favourite element</h4>
      ${favoritePickerHtml()}
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

/** Server-side `GROUPS`, mirrored for ORDER only — an achievement whose group
 * this list does not know still renders, in a trailing section, rather than
 * vanishing because the client is a deploy behind the server. */
const GROUP_ORDER = [
  'Getting started', 'Winning', 'Elements', 'On the table',
  'Combat', 'One-game feats', 'Formats and people',
];

/**
 * Collapse each LADDER to a single card.
 *
 * "Play 50 / 150 / 300 different cards" is one pursuit at three goals, and
 * showing three cards for it says the player has three things to do. So a
 * ladder renders as its lowest UNEARNED rung — the one actually in front of
 * you — carrying a pip per rung so the finished ones still read as progress.
 * A fully-climbed ladder shows its top rung, earned.
 */
function collapseLadders(list: AchievementState[]): { row: AchievementState; rungs: boolean[] }[] {
  const out: { row: AchievementState; rungs: boolean[] }[] = [];
  const ladders = new Map<string, AchievementState[]>();
  for (const a of list) {
    if (!a.tier) { out.push({ row: a, rungs: [] }); continue; }
    const got = ladders.get(a.tier.of);
    if (got) got.push(a);
    else ladders.set(a.tier.of, [a]);
  }
  for (const rungs of ladders.values()) {
    rungs.sort((x, y) => (x.tier!.rung) - (y.tier!.rung));
    const show = rungs.find(r => !r.earned) ?? rungs[rungs.length - 1]!;
    out.push({ row: show, rungs: rungs.map(r => r.earned) });
  }
  return out;
}

function achievementCard(a: AchievementState, rungs: boolean[]): string {
  const pips = rungs.length > 1
    ? `<div class="achpips" title="${rungs.filter(Boolean).length} of ${rungs.length} earned">${
      rungs.map(got => `<span class="${got ? 'on' : ''}"></span>`).join('')}</div>`
    : '';
  return `<div class="ach ${a.earned ? 'got' : ''} ${a.hidden ? 'secret' : ''}">
    <div class="achicon">${a.icon}</div>
    <div class="achbody">
      <div class="achname">${esc(a.name)}${a.earned && a.earnedAt
        ? `<span class="achdate">${shortDate(a.earnedAt)}</span>` : ''}</div>
      <div class="achdesc">${esc(a.desc)}</div>
      ${pips}
      ${a.earned || a.hidden ? '' : `<div class="achbar"><span style="width:${pct(a.have, a.need)}%"></span></div>
        <div class="achprog">${a.have} / ${a.need}</div>`}
    </div>
  </div>`;
}

function achievementsTab(): string {
  const list = me!.achievements;
  // group first, then within a group keep the old order: earned, then whatever
  // you are closest to finishing
  const byGroup = new Map<string, AchievementState[]>();
  for (const a of list) {
    const g = a.group ?? 'Other';
    const got = byGroup.get(g);
    if (got) got.push(a);
    else byGroup.set(g, [a]);
  }
  const order = [
    ...GROUP_ORDER.filter(g => byGroup.has(g)),
    ...[...byGroup.keys()].filter(g => !GROUP_ORDER.includes(g)),
  ];

  const sections = order.map(g => {
    const cards = collapseLadders(byGroup.get(g)!)
      .sort((x, y) => Number(y.row.earned) - Number(x.row.earned)
        || (y.row.have / y.row.need) - (x.row.have / x.row.need));
    const got = byGroup.get(g)!.filter(a => a.earned).length;
    return `<div class="achgroup">
      <h4>${esc(g)} <span class="acctcount">${got}/${byGroup.get(g)!.length}</span></h4>
      <div class="achgrid">${cards.map(c => achievementCard(c.row, c.rungs)).join('')}</div>
    </div>`;
  }).join('');

  return `<section class="acctcard wide">
    <h3>Achievements <span class="acctcount">${me!.earned} of ${list.length}</span></h3>
    ${sections}
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

/**
 * BL-02 — the ladder.
 *
 * ⚠ THE "YOU" ROW IS THE POINT, not decoration. The owner's rule is that a
 * player can always see where they are and is not SHOWN to anybody until
 * their fifth rated game, so a board that simply hid them would answer half
 * of it. The rank comes from the server, computed over everybody with a rated
 * game, which is why it can be a bigger number than the listed rows below it
 * — and saying so out loud is better than a rank the player cannot reconcile
 * with what they can count.
 */
function ladderTab(): string {
  const modes = (['constructed', 'draft'] as const).map(m =>
    `<button class="elchip${m === ladderMode ? ' on' : ''}" data-btn="acct-ladder-mode" data-mode="${m}">${
      m === 'draft' ? 'Live draft' : 'Constructed'}</button>`).join('');

  if (!ladder) {
    return `<section class="acctcard"><h3>Ladder</h3>
      <div class="elrow">${modes}</div>
      <div class="hint">loading…</div></section>`;
  }

  const row = (l: LeaderRow, rank: number, mine: boolean): string => `<tr${mine ? ' class="myrow"' : ''}>
    <td class="lrank">${rank}</td>
    <td><span class="fdot ${l.online ? 'on' : ''}"></span></td>
    <td>${esc(l.username)} ${elChip(l.favoriteElement)}</td>
    <td class="lrating"><b>${l.rating}</b></td>
    <td>${l.ratedGames}</td>
    <td>${l.wins}W–${l.losses}L</td></tr>`;

  const you = ladder.you;
  const listedMe = !!you && ladder.players.some(p => p.id === you.id);
  const board = ladder.players.length
    ? `<table class="accttable ladder"><thead><tr>
        <th>#</th><th></th><th>player</th><th>rating</th><th>rated</th><th>record</th></tr></thead>
      <tbody>${ladder.players.map((l, i) => row(l, i + 1, l.id === you?.id)).join('')}</tbody></table>`
    : `<div class="hint">nobody has played ${ladder.publicAfter} rated ${
        ladderMode === 'draft' ? 'draft' : 'constructed'} games yet — the board fills up as people play.</div>`;

  const meLine = !you
    ? `<div class="hint">You have no rated ${ladderMode === 'draft' ? 'draft' : 'constructed'} games yet.
        Every game from the queue counts — games started from a room code do not.</div>`
    : listedMe
      ? ''
      : `<div class="youstanding">
          <b>You</b> · #${you.rank} of ${ladder.rated} · <b>${you.rating}</b>
          <span class="hint">${you.ratedGames} rated game${you.ratedGames === 1 ? '' : 's'} —
            ${ladder.publicAfter - you.ratedGames} more and you appear on the board above.</span>
        </div>`;

  return `<section class="acctcard">
      <h3>Ladder</h3>
      <div class="elrow">${modes}</div>
      ${meLine}
      ${board}
      <div class="hint">Everyone starts at 1000. Only games from the <b>matchmaking queue</b>
        are rated — both ranked and "whoever's open" — so a game you start by sending somebody a
        room code moves nothing. Constructed and live draft are rated separately.</div>
    </section>`;
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

/**
 * R290 — the label a conceded row carries beside its result, or '' for a
 * normal one. The weight is the server's word (see MatchRow.concession); this
 * only puts it into English. Exported so the tab's rows can be tested without
 * a signed-in `me`.
 */
export function concessionTag(g: MatchRow): string {
  const c = g.concession;
  if (!c || c.weight === 'normal') return '';
  const who = c.mine ? 'you' : esc(g.opponent);
  if (c.weight === 'walkover') {
    return `<span class="constag walkover" title="${who} conceded on turn ${c.turn} — not a game: it counts toward nothing, for either player">walkover · not counted</span>`;
  }
  return `<span class="constag early" title="${who} conceded on turn ${c.turn} — counts as a result, at half rating weight, and not toward the fast-game achievements">early concession · half weight</span>`;
}

/** BL-43 — the label a custom-rules row carries: kept in the history, counted toward nothing. */
export function customTag(g: MatchRow): string {
  // R298: a single card duel is tagged the same way, for the same reason
  if (g.single) {
    return `<span class="constag custom" title="Single Card Duel: ${esc(g.single[0])} vs ${esc(g.single[1])} — kept in your history, counted toward nothing of yours">single card · not counted</span>`;
  }
  if (!g.custom) return '';
  return `<span class="constag custom" title="custom rules: ${esc(g.custom.join(' · '))} — kept in your history, counted toward nothing">custom · not counted</span>`;
}

/** The match-history table body, one row per game. Pure: takes the rows. */
export function historyRowsHtml(history: MatchRow[]): string {
  return history.map(g => `<tr class="res-${g.result}${g.concession && g.concession.weight !== 'normal' ? ` weight-${g.concession.weight}` : ''}">
      <td class="resultcell">${g.result === 'win' ? 'WIN' : g.result === 'loss' ? 'loss' : '?'}${concessionTag(g)}${customTag(g)}</td>
      <td>${esc(g.opponent)}</td>
      <td>${esc(g.mode)}</td>
      <td>${g.els.map(el => `<span class="acctel ${el}">${el}</span>`).join('')}</td>
      <td>${g.turns}${g.diverged ? '<span class="partial" title="the current engine cannot replay this game to its end — its numbers are a floor, not a total">+</span>' : ''}</td>
      <td>${g.life[0]}–${g.life[1]}</td>
      <td>${shortDate(g.playedAt)}</td>
      <td class="roomcell">${esc(g.code)}</td>
    </tr>`).join('');
}

function historyTab(): string {
  if (!me!.history.length) return '<section class="acctcard"><div class="hint">No games recorded yet.</div></section>';
  return `<section class="acctcard wide">
    <h3>Recent games</h3>
    <table class="accttable games"><thead><tr>
      <th>result</th><th>opponent</th><th>format</th><th>elements</th>
      <th>turns</th><th>life</th><th>played</th><th>room</th>
    </tr></thead><tbody>${historyRowsHtml(me!.history)}</tbody></table>
    <div class="hint">A game counts as soon as it is played. A <b>+</b> beside the turn count means the
      current engine cannot replay that game all the way to its end, so its per-game numbers are a
      floor rather than a total — the rules have moved since it was played.
      A <b>walkover</b> — a game conceded on its first turn — stays here but counts toward
      nothing; an <b>early concession</b> counts, at half rating weight.</div>
  </section>`;
}

// ── actions ───────────────────────────────────────────────────────────

/** POST with the bearer token attached, returning the parsed body. */
async function post<T>(path: string, body: unknown): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
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

/** BL-02 — the per-format ladder. */
async function loadLadder(): Promise<void> {
  const want = ladderMode;
  try {
    const res = await fetch(`/api/players?mode=${want}`, { headers: authHeaders(false) });
    const body = await res.json() as Partial<Ladder> & { ok: boolean };
    // a slow response for a board the player has since switched away from
    // must not paint over the one they are looking at
    if (want !== ladderMode) return;
    ladder = {
      mode: want, players: body.players ?? [], you: body.you ?? null,
      rated: body.rated ?? 0, publicAfter: body.publicAfter ?? 5,
    };
  } catch { ladder = { mode: want, players: [], you: null, rated: 0, publicAfter: 5 }; }
  if (view === 'profile' && tab === 'ladder') renderScreen();
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
  // `pg-claim` lives on the post-game screen but is an ACCOUNT action, so it
  // is handled here with the rest of them rather than growing a second
  // place that knows how to set a session token.
  if (!b.startsWith('acct-') && b !== 'pg-claim') return false;

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

    case 'acct-favorite': {
      const el = btn.dataset['el'] || null;
      void post('/api/me/favorite', { element: el }).then(() => refreshMe());
      return true;
    }

    /* ── BL-42: turn the guest account this game was played on into a real
     * one. A rename and a password, nothing moves. ── */
    case 'pg-claim': {
      const form = btn.closest('form');
      const name = (form?.querySelector('[name=username]') as HTMLInputElement | null)?.value ?? '';
      const pw = (form?.querySelector('[name=password]') as HTMLInputElement | null)?.value ?? '';
      const errBox = form?.querySelector('.pgclaimerr') as HTMLElement | null;
      void (async () => {
        const body = await post('/api/auth/claim', { username: name, password: pw }) as
          { ok: boolean; token?: string; me?: Me; error?: string };
        if (body.ok && body.token && body.me) {
          localStorage.setItem(TOKEN_KEY, body.token);
          me = body.me;
          if (form) form.outerHTML =
            '<div class="pgnote">Saved — this game is on your profile now.</div>';
        } else if (errBox) {
          errBox.textContent = body.error ?? 'that did not work';
        }
      })();
      return true;
    }

    // ── BL-39: Discord linking ──
    case 'acct-discord-link':
      void (async () => {
        const body = await post('/api/link/discord/code', {}) as
          { ok: boolean; code?: string; expiresAt?: number; error?: string };
        if (body.ok && body.code && body.expiresAt) {
          linkCode = { code: body.code, expiresAt: body.expiresAt };
        } else {
          authMsg = body.error ?? 'could not get a code';
        }
        renderScreen();
      })();
      return true;

    case 'acct-discord-unlink':
      void (async () => {
        const body = await post('/api/link/discord/unlink', {}) as
          { ok: boolean; me?: Me };
        if (body.ok && body.me) { me = body.me; linkCode = null; }
        renderScreen();
      })();
      return true;

    case 'acct-logout': {
      // invalidate the session with the token we are about to drop — post()
      // re-reads localStorage for its auth header, so clearing first would
      // send the request unauthenticated and leave the session alive
      const t = token();
      if (t) {
        void fetch('/api/auth/logout', { method: 'POST', headers: authHeaders(), body: '{}' }).catch(() => {});
      }
      localStorage.removeItem(TOKEN_KEY);
      me = null; view = null;
      rerenderHost();
      return true;
    }

    case 'acct-tab': {
      const t = btn.dataset['tab'];
      // ⚠ 'decks' was missing from this list, so the decks tab rendered the
      // stats page. Derived from the tab list rather than re-listed, which is
      // what let the two drift apart in the first place.
      tab = (t === 'achievements' || t === 'ladder' || t === 'friends'
        || t === 'history' || t === 'decks') ? t : 'stats';
      friendMsg = '';
      renderScreen();
      if (tab === 'friends' && !leaders) void loadLeaders();
      if (tab === 'ladder' && ladder?.mode !== ladderMode) void loadLadder();
      return true;
    }

    case 'acct-ladder-mode': {
      const m = btn.dataset['mode'];
      if (m === 'constructed' || m === 'draft') ladderMode = m;
      ladder = null;
      renderScreen();
      void loadLadder();
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
