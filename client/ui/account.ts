/* Accounts in the client: the sign-in screen, the profile screen, and the
 * little strip at the top of the home screen.
 *
 * Their MARKUP is ui/pages/signin.ts and ui/pages/profile.ts since the
 * design-system round (2026-11-03): pure functions of a view, which this
 * module hands its state to. What stays here is the state, the fetches and
 * the clicks, because nearly every module imports this one for
 * authHeaders() and currentUser().
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
import { artFor } from './meta.ts';
import { identityBarHtml, identityBarView, paintSignin, signinView } from './pages/signin.ts';
import {
  badgeChipsHtml, concessionTag, customTag, disputedTag, fixedTag, gameElementsHtml, historyRowsHtml,
  modeName, paintProfile, profileTabFor, profileView, trophyChipHtml, trophyChipsHtml, type Ladder, type LadderMode,
  type PlayersBoard, type ProfileTab,
} from './pages/profile.ts';
import { applyColourMode, isPrefName, readPrefs, setPref } from './prefs.ts';

/* The screens are drawn by ui/pages/signin.ts and ui/pages/profile.ts
 * (design-system round, 2026-11-03): pure functions of a view this module's
 * state is handed to. The small pure pieces other screens borrow (the chips,
 * the history rows and their tags, modeName) moved with the profile and are
 * re-exported here, where postgame.ts, league.ts and the tests find them. */
export {
  badgeChipsHtml, concessionTag, customTag, disputedTag, fixedTag, gameElementsHtml, historyRowsHtml, modeName,
  trophyChipHtml, trophyChipsHtml,
};
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
  /** a game that is not a draft has no trio: [the colours you played, theirs]
   * (server accounts.ts MatchRow.sides). Absent on a draft row. */
  sides?: [string[], string[]];
  /** the collection deck this seat brought, if any (ui/decks.ts filters on it) */
  deckId: string | null;
  finished: boolean; diverged: boolean; result: 'win' | 'loss' | 'unknown';
  opponent: string; opponentId: string | null;
  life: [number, number];
  unitsPlayed: number; spellsPlayed: number; damageDealt: number;
  favoriteElement: string | null;
  /** CR D8.5: only on a game a concede decided — the turn, the server's weight
   * (the thresholds live in server/concession.ts, not here), and whether it
   * was this account that conceded. A `walkover` row is counted nowhere. */
  concession?: { turn: number; weight: 'walkover' | 'early' | 'normal'; mine: boolean };
  /** BL-43: only on a custom-rules game — its rules as summary lines. Counted nowhere. */
  custom?: string[];
  /** CR D8.2e: only on a single card duel — [your card, theirs]. Counted nowhere of yours. */
  single?: [string, string];
  /** BL-46: the game took agreed fixes — how many (the row is tagged, still counted) */
  amended?: number;
  /** BL-48: somebody disputed the result — the row is tagged, the result stands */
  disputed?: { mine: boolean; theirs: boolean };
  /** docs/22 §2.6: a game of a Competitive match — which game, of how many
   * (`bestOf` absent when the server could not say) */
  match?: { id: string; game: number; bestOf?: 1 | 3 };
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
  /** the league seasons this account finished, oldest first, with the place
   * each earned — written at the season's close (server league-store.ts
   * closeSeason → accounts.ts setLeagueHonour), public like the badge */
  trophies?: LeagueTrophy[];
  /** the favourite element the player CHOSE; null = the one played most */
  favoritePicked?: string | null;
  /** present (true) only on an admin's OWN profile — it draws the Admin
   * button and nothing else; the dashboard asks the server (ui/pages/admin.ts) */
  admin?: true;
  /** the league availability (privateView only): its zone is the one league
   * times are shown in, in the bell as on the League page */
  availability?: { tz: string; grid: string } | null;
}

/** One finished league season as the server keeps it on the account
 * (server/accounts.ts LeagueHonour). */
export interface LeagueTrophy {
  season: string; name: string; place: 'champion' | 'finalist' | 'participant'; w: number; l: number;
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
/** BL-39: why Link Discord did not give a code. Its own message, shown on the
 * Connections card: it used to go to `authMsg`, which only the sign-in screen
 * draws, so the profile showed nothing at all (test/905). */
let linkMsg = '';
/** which account screen is open, if any */
let view: 'auth' | 'profile' | null = null;
/** the auth screen's mode and its message line */
let authMode: 'login' | 'register' = 'login';
let authMsg = '';
let busy = false;
/** profile screen tab */
let tab: ProfileTab = 'overview';
let friendMsg = '';
/** #296: the change-password box's last answer (the server's error, or done) */
let pwMsg: { text: string; ok: boolean } | null = null;
/** why choosing a favourite element did not take (shown under the picker) */
let favMsg = '';
/** a guest naming the account from Settings: why it did not take */
let claimMsg = '';
let leaders: LeaderRow[] | null = null;
/** the last load of `leaders` failed: the friends tab says so (and offers to ask again) */
let leadersFailed = false;

/* BL-02 — the rating ladder. Its own state rather than more fields on
 * `leaders`: that board is the all-time wins scoreboard the friends tab
 * shows, this one is per-format and carries the "you are not listed yet" row
 * with it, and folding them together would mean one of the two screens
 * carrying numbers it never displays. */
let ladderMode: LadderMode = 'constructed';
let ladder: Ladder | null = null;
/** the Players tab's board: a format's ladder (ladderMode), or 'all' (leaders) */
let board: PlayersBoard = 'constructed';

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

/* ── BL-28: "make an account right after finishing playing" ─────────────
 *
 * A seat nobody was signed in on is handed a single-use ticket for that game
 * on the post-game payload (server main.ts recordFinishedGame). Registering
 * with it inside the window makes that game the first one on the new profile
 * — and nothing else: a name typed into a seat claims nothing any more.
 *
 * Kept here, with the server's own expiry, so a refresh of the post-game
 * screen or a sign-up from the ordinary Account screen still carries it. The
 * window is the SERVER's number (`until`); this file never holds a copy. */
const SIGNUP_KEY = 'algoSignupClaim';
export interface SignupTicket { ticket: string; until: number }

export function rememberSignupClaim(room: string, t: SignupTicket): void {
  try { localStorage.setItem(SIGNUP_KEY, JSON.stringify({ ticket: t.ticket, until: t.until, room })); } catch { /* storage off: the screen still has it */ }
}
/** the unexpired ticket this browser holds — for `room`, when one is named */
export function pendingSignupClaim(room?: string): SignupTicket | null {
  try {
    const c = JSON.parse(localStorage.getItem(SIGNUP_KEY) ?? 'null') as (SignupTicket & { room?: string }) | null;
    if (!c || typeof c.ticket !== 'string') return null;
    if (!(Number(c.until) > Date.now())) { forgetSignupClaim(); return null; }
    if (room !== undefined && c.room !== room) return null;
    return { ticket: c.ticket, until: c.until };
  } catch { return null; }
}
function forgetSignupClaim(): void {
  try { localStorage.removeItem(SIGNUP_KEY); } catch { /* nothing to forget */ }
}
/** how the post-game sign-up went, for the ticket it was made with */
let signedUpWith: { ticket: string; claimed: boolean } | null = null;
export const signupOutcome = (ticket: string): 'claimed' | 'lapsed' | null =>
  signedUpWith?.ticket === ticket ? (signedUpWith.claimed ? 'claimed' : 'lapsed') : null;
/** what the post-game screen says once the sign-up is done */
export const signupNoteHtml = (how: 'claimed' | 'lapsed'): string =>
  `<div class="pgnote">${how === 'claimed'
    ? 'Signed up — this game is the first one on your profile.'
    : 'Signed up. The offer for this game had run out, so your profile starts with your next one.'}</div>`;
export const currentUser = (): Me | null => me;
/** A stored token is being checked and has not answered yet. While it is, the
 * identity bar says so instead of "Playing signed out — Log in / Sign up",
 * which every signed-in player used to see flash up on every load (300ms of
 * it on a 300ms link; found 2026-11-02). test/904-home-identity-and-typing. */
let resolving = false;
export const resolvingUser = (): boolean => resolving;
export const screen = (): 'auth' | 'profile' | null => view;

/** Step off the account screen so another page can own the app element
 * (main.ts nav-league / nav-admin): this screen is checked first in render. */
export function leaveScreen(): void { view = null; }

/** set by signInThenReturn: a successful sign-in goes back to the page that
 * asked, not on to the profile */
let returnAfterAuth = false;

/** The rules review page's "Sign in to comment": the sign-in screen, and on
 * success straight back to whatever the host repaints (that page, which is
 * still open underneath), instead of the profile and its Return to Lobby. */
export function signInThenReturn(): void {
  view = 'auth'; authMode = 'login'; authMsg = ''; returnAfterAuth = true;
  renderScreen();
}

/** wire this module up. `rerender` repaints whatever the host was showing
 * (the home screen) once an account screen closes. */
export function initAccounts(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  // the accessible colours, before the first paint (ui/prefs.ts)
  applyColourMode();
  if (token()) { resolving = true; void refreshMe(); }
}

/** Ask the server who we are. A token the server no longer knows is dropped
 * rather than left to fail every subsequent request. */
async function refreshMe(): Promise<Me | null> {
  const t = token();
  if (!t) { me = null; return null; }
  try {
    const res = await fetch('/api/me', { headers: authHeaders(false) });
    if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); me = null; resolving = false; repaint(); return null; }
    const body = await res.json() as
      { ok: boolean; me?: Me; discordLinking?: boolean };
    me = body.ok && body.me ? body.me : null;
    // With no bot token on the server there is nothing to claim a code, so the
    // Connections block is hidden rather than offering a dead end.
    discordLinking = body.discordLinking === true;
  } catch {
    // offline: keep whatever profile we already had rather than logging out
  }
  resolving = false;
  repaint();
  return me;
}

/** Something outside this module changed the friends list (the bell's
 * Accept, ui/inbox.ts): fetch the profile again so the friends tab agrees. */
export function reloadMe(): void { if (token()) void refreshMe(); }

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

/** The account line that sits above the home screen's buttons (pages/signin.ts
 * draws it; test/904 holds it to saying "Signing in…" while a token resolves). */
export function barHtml(): string {
  return identityBarHtml(identityBarView(me, resolving));
}

// ── screens ───────────────────────────────────────────────────────────

export function renderScreen(): void {
  if (!$app) return;
  $app.classList.remove('board');
  if (view === 'auth') renderAuth();
  else if (view === 'profile') renderProfile();
}

/** the sign-in screen (pages/signin.ts) — the only place authMsg is drawn */
function renderAuth(): void {
  paintSignin($app!, signinView({ mode: authMode, me, msg: authMsg, busy }));
}

function renderProfile(): void {
  if (!me) { view = 'auth'; renderAuth(); return; }
  paintProfile($app!, profileView({
    me, tab, discordLinking, linkCode, linkMsg, friendMsg, pwMsg, favMsg, claimMsg, leaders, leadersFailed, board, ladder,
    prefs: readPrefs(), artFor,
  }));
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
    // BL-28: signing up from here straight after a signed-out game still
    // carries that game's ticket (the post-game screen's own form is the
    // usual way in)
    const claim = authMode === 'register' ? pendingSignupClaim() : null;
    const r = await post<{ token?: string; me?: Me; claimed?: number }>(
      authMode === 'register' ? '/api/auth/register' : '/api/auth/login',
      { username, password, ...(claim ? { claim: claim.ticket } : {}) });
    busy = false;
    if (!r.ok || !r.token || !r.me) { authMsg = r.error ?? 'that did not work'; renderAuth(); return; }
    localStorage.setItem(TOKEN_KEY, r.token);
    if (claim) { signedUpWith = { ticket: claim.ticket, claimed: !!r.claimed }; forgetSignupClaim(); }
    // the seat name the game server files stats under is the account name, so
    // keep the home screen's name box in step rather than letting them differ
    localStorage.setItem('algoName', r.me.username);
    me = r.me;
    if (returnAfterAuth) { returnAfterAuth = false; view = null; rerenderHost(); return; }
    view = 'profile';
    tab = 'overview';
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
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json() as Partial<Ladder> & { ok: boolean };
    // a slow response for a board the player has since switched away from
    // must not paint over the one they are looking at
    if (want !== ladderMode) return;
    ladder = {
      mode: want, players: body.players ?? [], you: body.you ?? null,
      rated: body.rated ?? 0, publicAfter: body.publicAfter ?? 5,
    };
  } catch {
    if (want !== ladderMode) return;
    ladder = { mode: want, players: [], you: null, rated: 0, publicAfter: 5, failed: true };
  }
  if (view === 'profile' && tab === 'players') renderScreen();
}

async function loadLeaders(): Promise<void> {
  try {
    const res = await fetch('/api/players');
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json() as { ok: boolean; players?: LeaderRow[] };
    if (!body.ok) throw new Error('refused');
    leaders = body.players ?? [];
    leadersFailed = false;
  } catch {
    // not an empty list: an empty table read as "nobody plays here" (the
    // friends tab says it could not load, and its Try again asks again)
    leaders = null;
    leadersFailed = true;
  }
  if (view === 'profile' && tab === 'players') renderScreen();
}

/** the Players tab's board: fetch it unless it is already here */
function loadBoard(): void {
  if (board === 'all') { if (!leaders) void loadLeaders(); }
  else if (ladder?.mode !== ladderMode) void loadLadder();
}

/** main.ts hands every button click here first. Returns true when it was ours. */
export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  // `pg-claim` lives on the post-game screen but is an ACCOUNT action, so it
  // is handled here with the rest of them rather than growing a second
  // place that knows how to set a session token.
  if (!b.startsWith('acct-') && b !== 'pg-claim' && b !== 'pg-signup') return false;

  switch (b) {
    case 'acct-open-auth':
      view = 'auth'; authMode = me ? 'login' : 'register'; authMsg = ''; returnAfterAuth = false;
      renderScreen(); return true;

    case 'acct-open-profile':
      view = 'profile'; tab = 'overview'; pwMsg = null; favMsg = ''; claimMsg = '';
      renderScreen();
      void refreshMe();
      return true;

    case 'acct-toggle-mode':
      authMode = authMode === 'login' ? 'register' : 'login'; authMsg = '';
      renderAuth(); return true;

    case 'acct-submit':
      void submitAuth(); return true;

    case 'acct-close':
      view = null; returnAfterAuth = false; rerenderHost(); return true;

    case 'acct-refresh':
      void refreshMe(); return true;

    case 'acct-password': {
      const val = (id: string): string => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
      const oldPassword = val('acct-pw-old'), newPassword = val('acct-pw-new');
      const problem = !oldPassword || !newPassword ? 'fill in your current and new password'
        : newPassword !== val('acct-pw-again') ? 'the new passwords do not match' : '';
      if (problem) { pwMsg = { text: problem, ok: false }; renderScreen(); return true; }
      void post('/api/auth/password', { oldPassword, newPassword }).then(r => {
        pwMsg = r.ok ? { text: 'Password changed.', ok: true } : { text: r.error ?? 'that did not work', ok: false };
        renderScreen();
      }).catch(() => { pwMsg = { text: 'could not reach the server', ok: false }; renderScreen(); });
      return true;
    }

    case 'acct-favorite': {
      const el = btn.dataset['el'] || null;
      // a refusal or no server used to be an unhandled rejection and no word
      // on the page: the picker just did not move (test/997)
      void post('/api/me/favorite', { element: el }).then(r => {
        favMsg = r.ok ? '' : (r.error ?? 'that did not work');
        if (r.ok) void refreshMe(); else renderScreen();
      }).catch(() => { favMsg = 'could not reach the server'; renderScreen(); });
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

    /* ── BL-28: a signed-out seat signs up straight after its game, and the
     * ticket the server handed it makes that game the first on the profile ── */
    case 'pg-signup': {
      const name = (document.getElementById('pg-su-user') as HTMLInputElement | null)?.value.trim() ?? '';
      const pw = (document.getElementById('pg-su-pass') as HTMLInputElement | null)?.value ?? '';
      const errBox = document.getElementById('pg-su-err');
      const claim = pendingSignupClaim();
      void (async () => {
        try {
          const body = await post<{ token?: string; me?: Me; claimed?: number }>('/api/auth/register',
            { username: name, password: pw, ...(claim ? { claim: claim.ticket } : {}) });
          if (body.ok && body.token && body.me) {
            localStorage.setItem(TOKEN_KEY, body.token);
            localStorage.setItem('algoName', body.me.username);
            me = body.me;
            if (claim) signedUpWith = { ticket: claim.ticket, claimed: !!body.claimed };
            forgetSignupClaim();
            // in a game the host repaint is a no-op, so the form is swapped
            // here (as pg-claim does); the next board paint agrees with it
            const form = document.getElementById('pg-su-form');
            if (form) form.outerHTML = signupNoteHtml(body.claimed ? 'claimed' : 'lapsed');
            rerenderHost();
          } else if (errBox) {
            errBox.textContent = body.error ?? 'that did not work';
          }
        } catch {
          if (errBox) errBox.textContent = 'could not reach the server';
        }
      })();
      return true;
    }

    // ── BL-39: Discord linking ──
    case 'acct-discord-link':
      void (async () => {
        try {
          const body = await post('/api/link/discord/code', {}) as
            { ok: boolean; code?: string; expiresAt?: number; error?: string };
          if (body.ok && body.code && body.expiresAt) {
            linkCode = { code: body.code, expiresAt: body.expiresAt };
            linkMsg = '';
          } else {
            linkMsg = body.error ?? 'could not get a code';
          }
        } catch { linkMsg = 'could not reach the server'; }
        renderScreen();
      })();
      return true;

    case 'acct-discord-unlink':
      void (async () => {
        // as Link Discord: a refusal or no server says so on the card (test/997)
        try {
          const body = await post('/api/link/discord/unlink', {}) as
            { ok: boolean; me?: Me; error?: string };
          if (body.ok && body.me) { me = body.me; linkCode = null; linkMsg = ''; }
          else linkMsg = body.error ?? 'could not unlink';
        } catch { linkMsg = 'could not reach the server'; }
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
      // ⚠ 'decks' was once missing from a hand-written list here, so the decks
      // tab rendered the stats page. Checked against the list the tabs are
      // DRAWN from (pages/profile.ts PROFILE_TABS); an old name maps across.
      tab = profileTabFor(btn.dataset['tab']);
      friendMsg = '';
      renderScreen();
      if (tab === 'players') loadBoard();
      return true;
    }

    case 'acct-ladder-mode': {
      const m = btn.dataset['mode'];
      if (m === 'constructed' || m === 'draft' || m === 'all') board = m;
      if (board === 'all') { leaders = null; leadersFailed = false; }
      else { ladderMode = board; ladder = null; }
      renderScreen();
      loadBoard();
      return true;
    }

    case 'acct-pref': {
      const name = btn.dataset['pref'];
      if (isPrefName(name)) setPref(name, btn.dataset['v'] ?? '');
      renderScreen();
      return true;
    }

    /* a guest names the account from Settings: the post-game claim (pg-claim
     * above), from the profile. A rename and a password, nothing moves. */
    case 'acct-claim': {
      const val = (id: string): string => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
      const username = val('acct-claim-name').trim(), password = val('acct-claim-pass');
      if (!username || !password) { claimMsg = 'a username and a password, please'; renderScreen(); return true; }
      void post<{ token?: string; me?: Me }>('/api/auth/claim', { username, password }).then(r => {
        if (r.ok && r.token && r.me) {
          localStorage.setItem(TOKEN_KEY, r.token);
          localStorage.setItem('algoName', r.me.username);
          me = r.me; claimMsg = '';
        } else claimMsg = r.error ?? 'that did not work';
        renderScreen();
      }).catch(() => { claimMsg = 'could not reach the server'; renderScreen(); });
      return true;
    }

    case 'acct-friend-add': {
      // the board's Add carries the name; the box under "Add a friend" is typed
      const input = document.getElementById('a-friend') as HTMLInputElement | null;
      const username = (btn.dataset['name'] ?? input?.value ?? '').trim();
      if (!username) return true;
      void post<{ me?: Me; friends?: boolean }>('/api/friends/request', { username }).then(r => {
        friendMsg = r.ok
          ? (r.friends ? `you and ${username} are now friends` : `request sent to ${username}`)
          : (r.error ?? 'that did not work');
        if (r.me) me = r.me;
        renderScreen();
        if (board === 'all') void loadLeaders();
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
