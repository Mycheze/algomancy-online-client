/* Accounts: username + password, a lifetime stat sheet, achievements, friends.
 *
 * Deliberately small. This server exists so two people can play Algomancy from
 * two cities; an account here is a name to hang your stats on, not an identity
 * system. So: no email, no reset flow, no roles, no rate limiter beyond the
 * one below. What IS taken seriously is that a password is never stored or
 * logged in the clear — scrypt with a per-user salt, compared in constant
 * time — because people reuse passwords even on a LAN toy.
 *
 * Storage is one JSON file (server/accounts/accounts.json) rewritten on every
 * change. At two users and a few hundred games that is free, and it means the
 * whole store can be read, diffed and hand-fixed with a text editor.
 *
 * Sessions live in the same file so a server restart does not log everyone out
 * (this box restarts on every deploy — see run-server.sh).
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CardName, Element, GameMode, Seat } from '../engine/src/types.ts';
import type { CollectionDeck } from './collection.ts';
import { ELEMENTS, favoriteElement, zeroElements, type GameSummary, type SeatStats } from './stats.ts';
import { evaluateAchievements, type AchievementState } from './achievements.ts';
import type { PublicDeckView } from './publicdecks.ts';
import { accountsFile } from './statepaths.ts';

// ALGO_ACCOUNTS_FILE keeps the tests (which spawn the real server) off the
// real store — there is exactly one accounts file and it holds passwords
const DATA_FILE = accountsFile();
const DATA_DIR = dirname(DATA_FILE);

// ── the shape of a player ─────────────────────────────────────────────

/** Everything we count. Every field is a plain number/record so merging a
 * game into a profile is addition and nothing else — no derived state to keep
 * in sync, and a profile can always be REBUILT from the game log (see
 * rebuildProfiles). */
export interface Profile {
  games: number;
  wins: number;
  losses: number;
  /**
   * Games whose result we do not know. Almost always a game played on an older
   * engine whose log no longer replays to its ending (GameSummary.skipped) —
   * NOT a game anybody abandoned. Games played since the server started
   * stamping the winner at game over cannot land here.
   */
  unresolved: number;
  byMode: Record<GameMode, number>;
  /** games in which this element was in your pool */
  byElement: Record<Element, number>;
  /** element weight of every card you have played (hybrids split ½/½) —
   * "favorite element" is the argmax of this */
  cardElements: Record<Element, number>;
  recycled: Record<Element, number>;
  cards: Record<CardName, number>;
  unitsPlayed: number;
  spellsPlayed: number;
  tokensCast: number;
  modsApplied: number;
  cardsDrafted: number;
  resourcesActivated: number;
  abilitiesActivated: number;
  attacksDeclared: number;
  unitsAttackedWith: number;
  damageDealt: number;
  lifeLost: number;
  unitsLost: number;
  unitsKilled: number;
  turnsPlayed: number;
  longestGameTurns: number;
  /** per-game highlights, counted at fold time because a profile is only ever
   * a sum and cannot look back at an individual game */
  flawlessWins: number;
  closeWins: number;
  /** win streak: current, and the best ever reached */
  streak: number;
  bestStreak: number;
  /** head-to-head, keyed by the opponent's account id */
  opponents: Record<string, { games: number; wins: number; losses: number }>;
  firstPlayed: string | null;
  lastPlayed: string | null;
}

export interface Account {
  id: string;
  /** as typed at signup — the display name */
  username: string;
  /** lowercased username: the uniqueness key and what login matches on */
  key: string;
  salt: string;
  hash: string;
  createdAt: string;
  profile: Profile;
  /** achievement id → ISO timestamp it was unlocked */
  achievements: Record<string, string>;
  /** account ids, mutual by construction */
  friends: string[];
  /** friend requests: ids who asked me / ids I asked */
  incoming: string[];
  outgoing: string[];
  /** game codes already folded in — makes recording idempotent, which matters
   * because a finished game can be un-finished by an undo and finish again */
  recorded: string[];
  /**
   * The saved deck collection (collection.ts). Optional and lazily seeded:
   * `undefined` is an account that has never opened the decks page and gets
   * the five starters on its next visit; `[]` is somebody who deleted them
   * all, which nothing here second-guesses.
   */
  decks?: CollectionDeck[];
}

interface Session { token: string; userId: string; createdAt: string; lastSeen: string }

interface Store {
  version: 1;
  accounts: Account[];
  sessions: Session[];
  /** every game we have folded into a profile, newest last — the match
   * history, and the raw material for rebuilding profiles from scratch */
  history: RecordedGame[];
}

/** A game as it enters the record: the summary plus who the seats belonged to. */
export interface RecordedGame {
  code: string;
  playedAt: string;
  recordedAt: string;
  mode: GameMode;
  els: Element[];
  finished: boolean;
  winner: Seat | null;
  turns: number;
  /** the current engine could not replay this game to its end — its stats are
   * a floor, not a total, and its result is unknown unless somebody stamped it */
  diverged: boolean;
  /** account id per seat (null = a seat nobody was logged in on) */
  users: [string | null, string | null];
  /**
   * Constructed: the COLLECTION deck id each seat brought (collection.ts), so
   * a deck's win/loss record can be folded out of this history the same way a
   * profile is. Absent on every draft/shared game, on a seat that was not
   * logged in, and on every game played before decks had ids — see
   * deckRecords(), which counts only what it can attribute.
   */
  deckIds?: [string | null, string | null];
  names: [string, string];
  seats: [SeatStats, SeatStats];
}

export const emptyProfile = (): Profile => ({
  games: 0, wins: 0, losses: 0, unresolved: 0,
  byMode: { shared: 0, draft: 0, constructed: 0 },
  byElement: zeroElements(), cardElements: zeroElements(), recycled: zeroElements(),
  cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardsDrafted: 0, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, turnsPlayed: 0, longestGameTurns: 0,
  flawlessWins: 0, closeWins: 0, streak: 0, bestStreak: 0, opponents: {}, firstPlayed: null, lastPlayed: null,
});

// ── the store ─────────────────────────────────────────────────────────

let store: Store = { version: 1, accounts: [], sessions: [], history: [] };
let dataFile = DATA_FILE;
let dataDir = DATA_DIR;

/** Load the store from disk. Safe to call twice (tests do). */
export function loadAccounts(): void {
  try {
    const raw = JSON.parse(readFileSync(dataFile, 'utf8')) as Partial<Store>;
    store = {
      version: 1,
      accounts: (raw.accounts ?? []).map(a => ({
        ...a,
        // additive fields: an account written by an older build must still load
        profile: { ...emptyProfile(), ...a.profile },
        achievements: a.achievements ?? {},
        friends: a.friends ?? [], incoming: a.incoming ?? [], outgoing: a.outgoing ?? [],
        recorded: a.recorded ?? [],
      })) as Account[],
      sessions: raw.sessions ?? [],
      history: raw.history ?? [],
    };
  } catch {
    store = { version: 1, accounts: [], sessions: [], history: [] };
  }
}

/** Point the store at a different file (tests only — keeps them off the real
 * accounts file). Returns a restore function. */
export function useAccountsFile(path: string): () => void {
  const prev = { file: dataFile, dir: dataDir };
  dataFile = path;
  dataDir = dirname(path);
  loadAccounts();
  return () => { dataFile = prev.file; dataDir = prev.dir; loadAccounts(); };
}

/** Write through a temp file + rename: a crash mid-write must not leave a
 * half-written accounts file, because there is no backup and no way to
 * re-derive a password hash. */
function persist(): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    const tmp = `${dataFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 1));
    renameSync(tmp, dataFile);
  } catch (err) {
    console.error('[accounts] could not persist:', err);
  }
}

/** where the store currently lives (the dry-run seeder copies it aside) */
export const accountsFilePath = (): string => dataFile;

export const allAccounts = (): Account[] => store.accounts;
export const gameHistory = (): RecordedGame[] => store.history;
export const accountById = (id: string | null | undefined): Account | undefined =>
  id ? store.accounts.find(a => a.id === id) : undefined;
export const accountByName = (name: string): Account | undefined =>
  store.accounts.find(a => a.key === name.trim().toLowerCase());

// ── passwords ─────────────────────────────────────────────────────────

const hashPassword = (password: string, salt: string): string =>
  scryptSync(password, salt, 64).toString('hex');

function passwordMatches(account: Account, password: string): boolean {
  const got = Buffer.from(hashPassword(password, account.salt), 'hex');
  const want = Buffer.from(account.hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Usernames are what your opponent sees and what friend requests are typed
 * against, so keep them boring: letters, digits, and a couple of separators. */
export function usernameProblem(username: string): string | null {
  const u = username.trim();
  if (u.length < 2) return 'a username needs at least 2 characters';
  if (u.length > 20) return 'a username can be at most 20 characters';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(u)) {
    return 'a username can use letters, digits, spaces, and _ . - (and must start with a letter or digit)';
  }
  if (accountByName(u)) return 'that username is taken';
  return null;
}

export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string' || password.length < 6) return 'a password needs at least 6 characters';
  if (password.length > 200) return 'that password is unreasonably long';
  return null;
}

export type AuthResult = { ok: true; token: string; account: Account } | { ok: false; error: string };

export function register(username: string, password: string): AuthResult {
  const uProblem = usernameProblem(username);
  if (uProblem) return { ok: false, error: uProblem };
  const pProblem = passwordProblem(password);
  if (pProblem) return { ok: false, error: pProblem };
  const salt = randomBytes(16).toString('hex');
  const account: Account = {
    id: randomUUID(),
    username: username.trim(),
    key: username.trim().toLowerCase(),
    salt,
    hash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
    profile: emptyProfile(),
    achievements: {},
    friends: [], incoming: [], outgoing: [], recorded: [],
  };
  store.accounts.push(account);
  // Seeded games are stored with the seat NAMES the players typed and no
  // account behind them. Registering under one of those names claims them —
  // which is how Ben and Rashi walk into their first login with the eight
  // games they had already played sitting in their profile. On a two-person
  // LAN server "whoever registers the name is that player" is the right trade;
  // on anything public it would not be.
  const claimed = claimSeats(account);
  const token = newSession(account.id);
  persist();
  if (claimed) console.log(`[accounts] ${account.username} claimed ${claimed} past game(s)`);
  console.log(`[accounts] registered ${account.username}`);
  return { ok: true, token, account };
}

/** A failed login is deliberately slow-ish (scrypt) and says the same thing
 * whether the user exists or not. */
export function login(username: string, password: string): AuthResult {
  const account = accountByName(String(username ?? ''));
  if (!account || !passwordMatches(account, String(password ?? ''))) {
    return { ok: false, error: 'wrong username or password' };
  }
  const token = newSession(account.id);
  persist();
  return { ok: true, token, account };
}

export function changePassword(account: Account, oldPassword: string, newPassword: string): { ok: boolean; error?: string } {
  if (!passwordMatches(account, oldPassword)) return { ok: false, error: 'that is not your current password' };
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };
  account.salt = randomBytes(16).toString('hex');
  account.hash = hashPassword(newPassword, account.salt);
  persist();
  return { ok: true };
}

// ── sessions ──────────────────────────────────────────────────────────

/** Sessions never expire on their own — this is a two-person LAN server and
 * being logged out mid-draft would be worse than the risk. They are dropped
 * on logout, and capped so a login loop cannot grow the file forever. */
const SESSION_CAP = 200;

function newSession(userId: string): string {
  const token = randomBytes(24).toString('hex');
  const now = new Date().toISOString();
  store.sessions.push({ token, userId, createdAt: now, lastSeen: now });
  if (store.sessions.length > SESSION_CAP) store.sessions.splice(0, store.sessions.length - SESSION_CAP);
  return token;
}

/** The account a token belongs to, or undefined. Touches lastSeen but does
 * NOT persist for that alone — a read on every websocket message must not
 * write the accounts file. */
export function accountForToken(token: string | null | undefined): Account | undefined {
  if (!token) return undefined;
  const s = store.sessions.find(x => x.token === token);
  if (!s) return undefined;
  s.lastSeen = new Date().toISOString();
  return accountById(s.userId);
}

export function logout(token: string): void {
  const i = store.sessions.findIndex(s => s.token === token);
  if (i >= 0) { store.sessions.splice(i, 1); persist(); }
}

// ── friends ───────────────────────────────────────────────────────────

const dedupe = (xs: string[]): string[] => [...new Set(xs)];

/** Ask someone to be friends. If they already asked YOU, this accepts instead
 * — two people both hitting "add friend" should end up friends, not deadlocked
 * on two pending requests. */
export function requestFriend(me: Account, targetName: string): { ok: boolean; error?: string; friends?: boolean } {
  const them = accountByName(targetName);
  if (!them) return { ok: false, error: `no player called "${targetName}"` };
  if (them.id === me.id) return { ok: false, error: 'you are already your own best friend' };
  if (me.friends.includes(them.id)) return { ok: false, error: `you and ${them.username} are already friends` };
  if (me.incoming.includes(them.id)) {
    acceptFriend(me, them.id);
    return { ok: true, friends: true };
  }
  if (me.outgoing.includes(them.id)) return { ok: false, error: `you already asked ${them.username}` };
  me.outgoing = dedupe([...me.outgoing, them.id]);
  them.incoming = dedupe([...them.incoming, me.id]);
  persist();
  return { ok: true, friends: false };
}

export function acceptFriend(me: Account, theirId: string): { ok: boolean; error?: string } {
  const them = accountById(theirId);
  if (!them) return { ok: false, error: 'that player is gone' };
  if (!me.incoming.includes(them.id)) return { ok: false, error: 'they have not asked you' };
  me.incoming = me.incoming.filter(id => id !== them.id);
  them.outgoing = them.outgoing.filter(id => id !== me.id);
  me.friends = dedupe([...me.friends, them.id]);
  them.friends = dedupe([...them.friends, me.id]);
  persist();
  return { ok: true };
}

/** Turn down a request, cancel one you sent, or unfriend — all the same edit,
 * so one endpoint covers all three and the UI never has to guess which. */
export function removeFriend(me: Account, theirId: string): { ok: boolean; error?: string } {
  const them = accountById(theirId);
  if (!them) return { ok: false, error: 'that player is gone' };
  me.friends = me.friends.filter(id => id !== them.id);
  me.incoming = me.incoming.filter(id => id !== them.id);
  me.outgoing = me.outgoing.filter(id => id !== them.id);
  them.friends = them.friends.filter(id => id !== me.id);
  them.incoming = them.incoming.filter(id => id !== me.id);
  them.outgoing = them.outgoing.filter(id => id !== me.id);
  persist();
  return { ok: true };
}

// ── recording games ───────────────────────────────────────────────────

const addInto = (into: Record<string, number>, from: Record<string, number>): void => {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
};

/** Fold one seat of one game into one profile. Pure addition plus the two
 * order-dependent bits (streaks and first/last played). */
function foldSeat(profile: Profile, game: RecordedGame, seat: Seat): void {
  const s = game.seats[seat]!;
  const oppId = game.users[seat === 0 ? 1 : 0];
  profile.games++;
  profile.byMode[game.mode] = (profile.byMode[game.mode] ?? 0) + 1;
  for (const el of game.els) profile.byElement[el]++;
  addInto(profile.cardElements, s.cardElements);
  addInto(profile.recycled, s.recycled);
  addInto(profile.cards, s.cards);
  profile.unitsPlayed += s.unitsPlayed;
  profile.spellsPlayed += s.spellsPlayed;
  profile.tokensCast += s.tokensCast;
  profile.modsApplied += s.modsApplied;
  profile.cardsDrafted += s.cardsDrafted;
  profile.resourcesActivated += s.resourcesActivated;
  profile.abilitiesActivated += s.abilitiesActivated;
  profile.attacksDeclared += s.attacksDeclared;
  profile.unitsAttackedWith += s.unitsAttackedWith;
  profile.damageDealt += s.damageDealt;
  profile.lifeLost += s.lifeLost;
  profile.unitsLost += s.unitsLost;
  profile.unitsKilled += s.unitsKilled;
  profile.turnsPlayed += game.turns;
  profile.longestGameTurns = Math.max(profile.longestGameTurns, game.turns);

  if (!game.finished) {
    profile.unresolved++;
    // a result we cannot read breaks no streak: it says nothing about winning
  } else if (s.won) {
    profile.wins++;
    profile.streak = profile.streak >= 0 ? profile.streak + 1 : 1;
    profile.bestStreak = Math.max(profile.bestStreak, profile.streak);
    // Only from a game the engine can still replay end to end. A diverged
    // replay stops early — often before any combat — so "lost no life" and
    // "won on 4 life" would be artefacts of where the log gave out rather
    // than anything that happened at the table.
    if (!game.diverged) {
      if (s.lifeLost === 0) profile.flawlessWins++;
      if (s.lifeLeft > 0 && s.lifeLeft <= 5) profile.closeWins++;
    }
  } else {
    profile.losses++;
    profile.streak = 0;
  }

  if (oppId) {
    const h = profile.opponents[oppId] ?? { games: 0, wins: 0, losses: 0 };
    h.games++;
    if (game.finished && s.won) h.wins++;
    else if (game.finished) h.losses++;
    profile.opponents[oppId] = h;
  }

  if (!profile.firstPlayed || game.playedAt < profile.firstPlayed) profile.firstPlayed = game.playedAt;
  if (!profile.lastPlayed || game.playedAt > profile.lastPlayed) profile.lastPlayed = game.playedAt;
}

/** What a recorded game unlocked, per account — the server pushes this to the
 * players so the client can celebrate. */
export interface RecordOutcome {
  game: RecordedGame;
  unlocked: { userId: string; achievements: AchievementState[] }[];
  /** false when the game was already in the record (idempotent no-op) */
  recorded: boolean;
}

/**
 * Record a finished (or abandoned) game against whichever seats were logged
 * in. Idempotent by game code: recording the same code twice is a no-op, so
 * a re-finish after an undo, a double call, or a re-run of the seeder cannot
 * inflate anybody's stats.
 */
export function recordGame(summary: GameSummary, users: [string | null, string | null]): RecordOutcome {
  const accounts: [Account | undefined, Account | undefined] = [accountById(users[0]), accountById(users[1])];
  const game: RecordedGame = {
    code: summary.code,
    playedAt: summary.playedAt,
    recordedAt: new Date().toISOString(),
    mode: summary.mode,
    els: summary.els,
    finished: summary.finished,
    winner: summary.winner,
    turns: summary.turns,
    diverged: summary.skipped > 0,
    users: [accounts[0]?.id ?? null, accounts[1]?.id ?? null],
    names: [summary.seats[0].name, summary.seats[1].name],
    seats: summary.seats,
  };
  const unlocked: { userId: string; achievements: AchievementState[] }[] = [];
  let any = false;
  for (const seat of [0, 1] as Seat[]) {
    const account = accounts[seat];
    if (!account) continue;
    if (account.recorded.includes(game.code)) continue;
    account.recorded.push(game.code);
    foldSeat(account.profile, game, seat);
    unlocked.push({ userId: account.id, achievements: refreshAchievements(account) });
    any = true;
  }
  if (any) {
    // one history row per game, even when both seats were logged in
    if (!store.history.some(g => g.code === game.code)) store.history.push(game);
    persist();
    console.log(`[accounts] recorded ${game.code} (${game.names.join(' vs ')})${game.finished ? `, ${game.names[game.winner ?? 0]} won` : ', unfinished'}`);
  }
  return { game, unlocked, recorded: any };
}

/** Re-evaluate achievements, stamping newly-earned ones with now(). Returns
 * only what was JUST unlocked. Unlocks are sticky: an achievement never
 * un-earns, even if a rebuild changes the numbers under it. */
export function refreshAchievements(account: Account): AchievementState[] {
  const states = evaluateAchievements(account.profile, account);
  const fresh: AchievementState[] = [];
  const now = new Date().toISOString();
  for (const st of states) {
    if (st.earned && !account.achievements[st.id]) {
      account.achievements[st.id] = now;
      fresh.push(st);
    }
  }
  return fresh;
}

/**
 * Throw away every profile and rebuild it from `history`, oldest game first.
 * The escape hatch for the whole design: because a profile is a pure fold over
 * the game record, changing how a stat is counted (or adding one) never means
 * hand-editing anyone's numbers — reseed the history and rebuild.
 */
export function rebuildProfiles(): void {
  for (const a of store.accounts) {
    a.profile = emptyProfile();
    a.recorded = [];
  }
  const games = [...store.history].sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  for (const game of games) {
    for (const seat of [0, 1] as Seat[]) {
      const account = accountById(game.users[seat]);
      if (!account || account.recorded.includes(game.code)) continue;
      account.recorded.push(game.code);
      foldSeat(account.profile, game, seat);
    }
  }
  for (const a of store.accounts) refreshAchievements(a);
  persist();
}

/**
 * Attach unclaimed history seats that were played under this account's name,
 * then rebuild so the fold happens in game order (streaks depend on it).
 * Returns how many seats were claimed.
 */
export function claimSeats(account: Account): number {
  let claimed = 0;
  for (const game of store.history) {
    for (const seat of [0, 1] as Seat[]) {
      if (game.users[seat]) continue;
      if ((game.names[seat] ?? '').trim().toLowerCase() !== account.key) continue;
      game.users[seat] = account.id;
      claimed++;
    }
  }
  if (claimed) rebuildProfiles();
  return claimed;
}

/** Add a game straight to the history without folding it (the seeder uses
 * this, then rebuilds — that way seeding is order-independent). */
export function stashHistory(game: RecordedGame): boolean {
  const i = store.history.findIndex(g => g.code === game.code);
  if (i >= 0) { store.history[i] = game; return false; }
  store.history.push(game);
  return true;
}

export const saveAccounts = persist;

// ── views for the client ──────────────────────────────────────────────

/** What anybody may see about an account: the stat sheet, no secrets. */
export interface PublicView {
  id: string;
  username: string;
  createdAt: string;
  favoriteElement: Element | null;
  profile: Profile;
  topCards: { card: CardName; n: number }[];
  earned: number;
  opponents: { id: string; username: string; games: number; wins: number; losses: number }[];
  /** the decks this account has PUBLISHED. Public only — an unlisted deck is
   * reachable by its link and by nothing else, which is the whole difference
   * between the two shared states. Filled in by the route (api-accounts.ts),
   * not here: publicdecks.ts reads collections, collections live on accounts,
   * and importing it here would close that ring. */
  decks?: PublicDeckView[];
}

/** A friend or requester as they appear in a list. */
export interface FriendView {
  id: string; username: string; online: boolean; games: number; wins: number;
  favoriteElement: Element | null; lastPlayed: string | null;
}

/** Everything the owner of an account may see about themselves. */
export function privateView(account: Account, online: (id: string) => boolean): PublicView & {
  achievements: (AchievementState & { earnedAt: string | null })[];
  friends: FriendView[]; incoming: FriendView[]; outgoing: FriendView[];
  history: MatchRow[];
} {
  return {
    ...publicView(account),
    achievements: evaluateAchievements(account.profile, account).map(a => ({
      ...a, earnedAt: account.achievements[a.id] ?? null,
    })),
    friends: account.friends.map(id => friendView(id, online)).filter((f): f is FriendView => !!f),
    incoming: account.incoming.map(id => friendView(id, online)).filter((f): f is FriendView => !!f),
    outgoing: account.outgoing.map(id => friendView(id, online)).filter((f): f is FriendView => !!f),
    history: recentGames(account.id, 25),
  };
}

export function publicView(account: Account): PublicView {
  const p = account.profile;
  return {
    id: account.id,
    username: account.username,
    createdAt: account.createdAt,
    favoriteElement: favoriteElement(p.cardElements),
    profile: p,
    topCards: Object.entries(p.cards).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([card, n]) => ({ card, n })),
    earned: Object.keys(account.achievements).length,
    opponents: Object.entries(p.opponents).map(([id, h]) => ({
      id, username: accountById(id)?.username ?? 'someone', ...h,
    })).sort((a, b) => b.games - a.games),
  };
}

function friendView(id: string, online: (id: string) => boolean): FriendView | null {
  const a = accountById(id);
  if (!a) return null;
  return {
    id: a.id, username: a.username, online: online(a.id),
    games: a.profile.games, wins: a.profile.wins,
    favoriteElement: favoriteElement(a.profile.cardElements),
    lastPlayed: a.profile.lastPlayed,
  };
}

/** One row of the match history, from the point of view of one account. */
export interface MatchRow {
  code: string; playedAt: string; mode: GameMode; els: Element[]; turns: number;
  /** the collection deck this seat brought, if any — what the decks page
   * filters on to show "your games with this deck" */
  deckId: string | null;
  finished: boolean; diverged: boolean; result: 'win' | 'loss' | 'unknown';
  opponent: string; opponentId: string | null;
  life: [number, number];
  unitsPlayed: number; spellsPlayed: number; damageDealt: number;
  favoriteElement: Element | null;
}

/** The match history rows an account appears in, newest first. */
export function recentGames(userId: string, limit = 25): MatchRow[] {
  return [...store.history]
    .filter(g => g.users[0] === userId || g.users[1] === userId)
    .sort((a, b) => b.playedAt.localeCompare(a.playedAt))
    .slice(0, limit)
    .map(g => {
      const seat: Seat = g.users[0] === userId ? 0 : 1;
      const me = g.seats[seat]!, them = g.seats[seat === 0 ? 1 : 0]!;
      return {
        code: g.code, playedAt: g.playedAt, mode: g.mode, els: g.els, turns: g.turns,
        deckId: g.deckIds?.[seat] ?? null,
        finished: g.finished, diverged: !!g.diverged,
        result: (!g.finished ? 'unknown' : me.won ? 'win' : 'loss') as MatchRow['result'],
        opponent: g.names[seat === 0 ? 1 : 0],
        opponentId: g.users[seat === 0 ? 1 : 0],
        life: [me.lifeLeft, them.lifeLeft],
        unitsPlayed: me.unitsPlayed, spellsPlayed: me.spellsPlayed,
        damageDealt: me.damageDealt,
        favoriteElement: favoriteElement(me.cardElements),
      };
    });
}

export interface LeaderRow {
  id: string; username: string; online: boolean; games: number; wins: number;
  losses: number; streak: number; bestStreak: number;
  favoriteElement: Element | null; earned: number; lastPlayed: string | null;
}

/** The head-to-head board: everybody, ranked. With two players this is a
 * scoreboard; with five it is still the right screen. */
export function leaderboard(online: (id: string) => boolean): LeaderRow[] {
  return store.accounts
    .map(a => ({
      id: a.id, username: a.username, online: online(a.id),
      games: a.profile.games, wins: a.profile.wins, losses: a.profile.losses,
      streak: a.profile.streak, bestStreak: a.profile.bestStreak,
      favoriteElement: favoriteElement(a.profile.cardElements),
      earned: Object.keys(a.achievements).length,
      lastPlayed: a.profile.lastPlayed,
    }))
    .sort((a, b) => b.wins - a.wins || b.games - a.games || a.username.localeCompare(b.username));
}

export { ELEMENTS };
