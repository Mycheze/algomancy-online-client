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
 * (this box restarts on every deploy — see deploy/algomancy-game.service).
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CardName, Element, GameMode, Seat } from '../engine/src/types.ts';
import type { CollectionDeck } from './collection.ts';
import { ELEMENTS, favoriteElement, zeroElements, type GameSummary, type SeatStats } from './stats.ts';
import { evaluateAchievements, type AchievementState } from './achievements.ts';
import {
  foldRatings, PUBLIC_AFTER, RATED_MODES, START_RATING,
  type RatedMode, type RatingTable,
} from './rating.ts';
import type { PublicDeckView } from './publicdecks.ts';
import { accountsFile } from './statepaths.ts';
// R290: a conceded game weighs by the turn it was conceded on. The fold below
// reads the stamp through this one function; the thresholds live over there.
import { concessionWeight, type Concession, type ConcessionWeight } from './concession.ts';
import { rulesSummary, type CustomRules } from '../ui/customrules.ts';

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

  /**
   * More of the same (BL-31). Two shapes, and only two:
   *   `bestX`  — Math.max over games: "the most you ever did at once". These
   *              give the achievements UI honest progress ("63 / 100").
   *   `xWins`  — a count of games where something was true. Goal 1.
   *
   * ⚠ RETROACTIVITY LIMIT. These read `SeatStats` fields that did not exist
   * when older games were summarized, so a game already in the record scores
   * 0 on them until `seed-accounts.ts --force` re-summarizes it from the
   * saved log. Every read below is `?? 0` for exactly that reason: an old
   * history row is MISSING these, not zeroed. Unlocks are sticky, so a
   * backfill can only ever add badges.
   */
  bestGraftParts: number;
  bestSingleHit: number;
  bestCombatDamage: number;
  biggestUnit: number;
  mostUnitsInPlay: number;
  mostResources: number;
  mostCardsInHand: number;
  bestSameSpell: number;
  /** most enemy units destroyed in one game */
  bestUnitsKilled: number;
  /** most of your own units lost in a game you still WON */
  bestUnitsLostInAWin: number;
  /** most distinct elements you played cards from in a game you won */
  bestElementsInAWin: number;
  /** wins with a qualifying shape — see foldSeat for each one's conditions */
  pacifistWins: number;
  asceticWins: number;
  deckedWins: number;
  monoWins: number;
  comebackWins: number;
  blitzWins: number;
  /** win streak: current, and the best ever reached */
  streak: number;
  bestStreak: number;

  /**
   * BL-02 — Elo, per format, and how many rated games are behind it.
   *
   * ⚠ THE ONLY TWO FIELDS ON THIS INTERFACE THAT `foldSeat` DOES NOT WRITE.
   * Everything else here is addition on one account; a rating needs both
   * players at once, so it is written by rebuildProfiles() out of
   * rating.ts's pairwise fold instead. See the header of rating.ts — the
   * split is the point, not an accident of where the code ended up.
   *
   * `ratedGames` is not derivable from `byMode`: only the matchmaker's games
   * are rated, and byMode counts every game in the format.
   */
  rating: Record<RatedMode, number>;
  ratedGames: Record<RatedMode, number>;
  /** head-to-head, keyed by the opponent's account id */
  opponents: Record<string, { games: number; wins: number; losses: number }>;
  firstPlayed: string | null;
  lastPlayed: string | null;
}

/** the favourite element every view shows: the one chosen, else the one
 * played most (stats.ts favoriteElement over the profile's card elements) */
export const favoriteOf = (a: Account): Element | null =>
  a.favorite ?? favoriteElement(a.profile.cardElements);

/** choose (an element) or clear (anything else) the favourite. Returns what
 * the account now shows. */
export function setFavorite(account: Account, el: unknown): Element | null {
  if (typeof el === 'string' && (ELEMENTS as string[]).includes(el)) account.favorite = el as Element;
  else delete account.favorite;
  persist();
  return favoriteOf(account);
}

/** see `Account.badge` */
export interface AccountBadge {
  owner?: true;
  judge?: 1 | 2 | 3;
  /** when it was last set — ISO */
  since: string;
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

  /** External identities this account has proved it owns.
   *
   * ⚠ TOP-LEVEL, NOT ON `profile`. `rebuildProfiles()` does
   * `a.profile = emptyProfile()` and `recordLiveGame` calls it on EVERY
   * finished game, so anything living on the profile is erased the first time
   * somebody plays. Here it survives, and `loadAccounts`'s `{...a}` spread
   * carries it through a restart without needing a migration.
   *
   * A wrapper rather than a bare `discordId` so the next provider — or BL-17's
   * judge badges — does not add another top-level field.
   *
   * Nothing writes this yet; the link flow is BL-39. The queue events in
   * hooks.ts already read it so the shape is fixed before there are rows. */
  linked?: { discord?: { id: string; username: string; linkedAt: string } };

  /**
   * BL-17, first slice — a TRUST MARK set by hand: the site's owner ("me"),
   * and/or a judge level. Nothing grants one by playing; only the tester-token
   * route (`POST /api/admin/badge`, `deploy/badge.sh` on the box) writes it,
   * and it is TOP-LEVEL for the same reason `linked` is — `rebuildProfiles`
   * replaces `profile` on every finished game. It is copied onto every report
   * the account files (report-fields.ts `ReportedBy`), which is what it is
   * for: the owner, 2026-09-05, triaging the first live game's reports, asked
   * to know "what kind of account left the report". Shown on the profile.
   * The review queue, in-game badge and report ORDERING are still BL-17.
   */
  badge?: AccountBadge;

  /**
   * BL-16 — THE ADMIN FLAG, and it is deliberately NOT the judge badge.
   *
   * The owner, 2026-08-25, asked the question and answered it in one
   * sentence: *"Ben is an admin and L1 judge. He will set the other accounts
   * when anyone else maybe ends up joining."* He puts himself at judge L1
   * while holding admin, which settles it outright — the two are independent
   * axes. A judge is a trusted voice on rules; an admin can change other
   * people's accounts. Neither implies the other, and a future L3 judge with
   * no operator access must stay possible.
   *
   * Top-level for the same reason `badge`, `linked` and `favorite` are:
   * `rebuildProfiles` replaces `profile` on every finished game.
   *
   * ⚠ NEVER GRANTED BY PLAYING, AND NEVER SELF-SERVICE. Two ways in, both
   * deliberate: the tester-token route (`deploy/admin.sh` on the box), which
   * is the BOOTSTRAP because the first admin has nobody to grant it, and an
   * existing admin granting it from the dashboard. `setAdmin` refuses to
   * clear the last one — a deploy with no admin can only be repaired by
   * SSHing to the box, and the flag exists so that is not necessary.
   */
  admin?: true;

  /**
   * The element the player CHOSE as their favourite (owner, 2026-09-05:
   * "Allow them to override and choose their favorite in the account stats
   * tab"). Absent means "whatever I have played most" — `favoriteOf` below is
   * the one reader, so every view (own, public, friend row, leaderboard)
   * agrees. Top-level for the same reason `linked` and `badge` are:
   * `rebuildProfiles` replaces `profile` on every finished game. A history
   * row's per-game favourite is a different fact and is not this.
   */
  favorite?: Element;

  /**
   * A GUEST: a real account with a real rating that nobody has claimed yet.
   *
   * The owner's call — "just assume it's going to be a fresh account starting
   * at 1000 elo. After the game, they can make an account and that game is
   * added to their ledger." So this is not a separate kind of player with its
   * own rules: it is an ordinary account with a generated name and no usable
   * password, and every rating, stat and history path treats it as one. That
   * is what makes claiming it afterwards free — the finished game already
   * points at this id, so `claimGuest` sets a name and a password and there is
   * nothing to migrate.
   *
   * ⚠ Excluded from the public leaderboard while it is still unclaimed: a
   * ladder row nobody can log in as is noise, and it would sit there for ever.
   */
  provisional?: boolean;
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
  /**
   * BL-37 — HOW LONG THE MATCH TOOK, in ms of live table time.
   *
   * The owner asked for this to "track average game length and tune the
   * clocks", and the history is where an average can be taken. ⚠ ABSENT, NOT
   * ZERO, when it is unknown: every game played before 2026-09-01 has no such
   * number, and a 0 folded into an average would drag it toward nothing while
   * looking like data. Anything reading this must skip the games that do not
   * carry it and say how many it skipped.
   */
  matchMs?: number;
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
  /**
   * BL-02 — this game was made by the MATCHMAKER, so it moves ratings.
   *
   * Absent on every game played before the queue existed and on every game
   * started from a shared room code, which is the same thing as `false` and
   * is stored that way so no existing history row grows a field. See
   * rating.ts (1) for why a link game is deliberately not rated.
   */
  rated?: boolean;
  /**
   * R290 — IF a concede decided this game: who conceded, on which game turn.
   * Stamped by the room when the concede landed and copied here by
   * history.ts; never derived from the replay. `concessionWeight(game)` turns
   * it into walkover / early / normal, and every fold that cares asks that
   * function rather than reading the turn. Absent on every game that did
   * not end in a concession and on every row recorded before 2026-09-05,
   * which folds as `normal` — exactly as it always did.
   */
  concession?: Concession;
  /**
   * BL-43 — this game was played with CUSTOM RULES (the rules as chosen, for the
   * history tag). The owner's call: "Record, tag, exclude" — the row is in the
   * match history and counts toward no profile total, achievement, deck record
   * or rating. Absent on every standard game.
   */
  custom?: CustomRules;
  /**
   * R298 — a SINGLE CARD DUEL, and the card each seat played ([seat0, seat1]).
   * Recorded and tagged exactly like `custom`: in the match history, in no
   * profile total, achievement, deck record or player rating. It is what the
   * card ladder is folded from (cardladder.ts). Absent on every other game.
   */
  single?: [CardName, CardName];
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
  // BL-02: an account that has never played a rated game still HAS a rating —
  // it is 1000 with 0 games behind it, which is a fact rather than a blank
  rating: { constructed: START_RATING, draft: START_RATING },
  ratedGames: { constructed: 0, draft: 0 },
  bestGraftParts: 0, bestSingleHit: 0, bestCombatDamage: 0, biggestUnit: 0,
  mostUnitsInPlay: 0, mostResources: 0, mostCardsInHand: 0, bestSameSpell: 0,
  bestUnitsKilled: 0, bestUnitsLostInAWin: 0, bestElementsInAWin: 0,
  pacifistWins: 0, asceticWins: 0, deckedWins: 0, monoWins: 0, comebackWins: 0, blitzWins: 0,
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

/** A short, unmistakably temporary name. Not chosen by the player: they pick a
 * real one when they claim the account, and letting them type one now would
 * mean a guest could squat a name they never come back to own. */
function guestName(): string {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let tail = '';
  for (let i = 0; i < 4; i++) tail += A[Math.floor(Math.random() * A.length)];
  const name = `Guest-${tail}`;
  return accountByName(name) ? guestName() : name;
}

/**
 * Start playing without signing up. Returns a session exactly like register()
 * does, so every downstream path — the WS join, the queue, stats — sees an
 * ordinary account and needs no guest-shaped special case.
 */
export function registerGuest(): AuthResult {
  const salt = randomBytes(16).toString('hex');
  const account: Account = {
    id: randomUUID(),
    username: guestName(),
    key: '',                 // filled below; keeps the shape honest
    // ⚠ A HASH NO PASSWORD CAN PRODUCE, rather than an empty one. An empty
    // or absent hash is one `if` away from being a login that always succeeds.
    // This used to scrypt a random password to get one — 100 ms of this
    // thread per guest, for a password nobody would ever type, on a route
    // anybody can call. `guest:` is not hex, so passwordMatches decodes it to
    // zero bytes and the length check fails before the comparison; claimGuest
    // replaces it with a real hash when the person picks a password.
    salt,
    hash: `guest:${randomBytes(32).toString('hex')}`,
    createdAt: new Date().toISOString(),
    profile: emptyProfile(),
    achievements: {},
    friends: [], incoming: [], outgoing: [], recorded: [],
    provisional: true,
  };
  account.key = account.username.toLowerCase();
  store.accounts.push(account);
  const token = newSession(account.id);
  persist();
  console.log(`[accounts] guest ${account.username}`);
  return { ok: true, token, account };
}

/**
 * Turn a guest into a real account: a name they choose and a password they
 * know. Everything they did as a guest is already theirs, because it was
 * always the same account id.
 */
export function claimGuest(account: Account, username: string, password: string): AuthResult {
  if (!account.provisional) return { ok: false, error: 'that account is already yours' };
  const uProblem = usernameProblem(username);
  if (uProblem) return { ok: false, error: uProblem };
  const pProblem = passwordProblem(password);
  if (pProblem) return { ok: false, error: pProblem };
  const salt = randomBytes(16).toString('hex');
  account.username = username.trim();
  account.key = username.trim().toLowerCase();
  account.salt = salt;
  account.hash = hashPassword(password, salt);
  delete account.provisional;
  // …and any older seeded game recorded under that NAME comes along too, the
  // same way it would for a fresh registration.
  const claimed = claimSeats(account);
  persist();
  console.log(`[accounts] guest became ${account.username}`
    + (claimed ? ` (claimed ${claimed} past game(s))` : ''));
  return { ok: true, token: newSession(account.id), account };
}

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

/** Sessions never expire on their own — being logged out mid-draft would be
 * worse than the risk. They are dropped on logout, and capped so a login loop
 * cannot grow the file forever.
 *
 * ⚠ CAPPED PER USER, NOT GLOBALLY. The cap used to be 200 across everybody,
 * oldest first — so two hundred anonymous guest sign-ups evicted every real
 * session on the box, which on an open port is a logout-everyone button. A
 * person keeps their newest ten; the global ceiling is only a backstop. */
const SESSIONS_PER_USER = 10;
const SESSION_CAP = 5000;

function newSession(userId: string): string {
  const token = randomBytes(24).toString('hex');
  const now = new Date().toISOString();
  store.sessions.push({ token, userId, createdAt: now, lastSeen: now });
  let mine = store.sessions.filter(s => s.userId === userId).length;
  if (mine > SESSIONS_PER_USER) {
    store.sessions = store.sessions.filter(s => s.userId !== userId || --mine < SESSIONS_PER_USER);
  }
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
  // R290: a WALKOVER — conceded on turn 1 — "shouldn't really be a game", and
  // it is not one here: it touches nothing on either player's profile. Not
  // games, not wins or losses, not the streak, not first/last played, not a
  // single counter an achievement reads. The row stays in the history (the
  // match history tab labels it) and rating.ts docks the conceder; that is
  // the whole of what it does. The exit is HERE, before the first increment,
  // so a new counter added below cannot forget to skip it.
  const weight = concessionWeight(game);
  if (weight === 'walkover') return;
  // BL-43: a custom-rules game likewise touches nothing — same exit, same reason
  // it sits above the first increment
  if (game.custom) return;
  // R298: and so does a single card duel — it rates the CARDS, not the players
  if (game.single) return;
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

  // ── the per-game highs (BL-31) ──
  // `?? 0` everywhere: a history row written before these existed is MISSING
  // them, and `undefined` would turn every Math.max below into NaN for good.
  const most = (have: number, got: number | undefined): number => Math.max(have, got ?? 0);
  profile.bestGraftParts = most(profile.bestGraftParts, s.bestGraftParts);
  profile.bestSingleHit = most(profile.bestSingleHit, s.bestSingleHit);
  profile.bestCombatDamage = most(profile.bestCombatDamage, s.bestCombatDamage);
  profile.biggestUnit = most(profile.biggestUnit, s.biggestUnit);
  profile.mostUnitsInPlay = most(profile.mostUnitsInPlay, s.mostUnitsInPlay);
  profile.mostResources = most(profile.mostResources, s.mostResources);
  profile.mostCardsInHand = most(profile.mostCardsInHand, s.mostCardsInHand);
  profile.bestSameSpell = most(profile.bestSameSpell, s.bestSameSpell);
  profile.bestUnitsKilled = most(profile.bestUnitsKilled, s.unitsKilled);

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
      /**
       * R290: an EARLY concession (turn 2) is a win for the record but "not
       * really a full game", so the feats a game that barely happened would
       * hand out for free are withheld from it. Four are gated on `full`:
       *   Blitz     "win by turn 5"            — a turn count, the named case
       *   Ascetic   "past turn 3, ≤3 resources" — a turn count (its own
       *              `turns > 3` already refuses turn 2; gated anyway so the
       *              rule reads in one place if that condition ever moves)
       *   Untouched "lost no life"             — trivially true before combat
       *   Pacifist  "no combat damage"         — same
       * The rest of this block is left alone: Close Call, Last Card and
       * Comeback need a board state a two-turn game cannot reach, Monochrome
       * has its own five-card floor, and the maxima (elements in a win, units
       * lost in a win) can only be made SMALLER by a short game.
       */
      const full = weight === 'normal';
      if (full && s.lifeLost === 0) profile.flawlessWins++;
      if (s.lifeLeft > 0 && s.lifeLeft <= 5) profile.closeWins++;

      // Every win-shaped highlight lives under this same `!game.diverged`
      // guard, and for the same reason the two above do: a diverged replay
      // stops early, often before combat ever happens, so it would hand out
      // "won without dealing combat damage" and "won on three resources" for
      // free to games that simply stopped being readable.
      const elementsPlayed = ELEMENTS.filter(e => (s.cardElements[e] ?? 0) > 0).length;
      profile.bestElementsInAWin = Math.max(profile.bestElementsInAWin, elementsPlayed);
      // Monochrome needs a floor on how much you played, or it fires on a win
      // where you put down one card: "exactly one element" is trivially true
      // of somebody who barely played, and the badge is meant to say you
      // committed to an element, not that you did nothing.
      if (elementsPlayed === 1 && s.unitsPlayed + s.spellsPlayed >= 5) profile.monoWins++;
      profile.bestUnitsLostInAWin = Math.max(profile.bestUnitsLostInAWin, s.unitsLost);

      if (full && game.turns > 0 && game.turns <= 5) profile.blitzWins++;

      /**
       * ⚠ The four below are the ones where LOW is what qualifies — no combat
       * damage, few resources, an empty deck, low life. On a history row
       * written before these counters existed the field is `undefined`, and
       * `?? 0` would read that as "zero resources left, zero cards in deck"
       * and hand every old game all four badges at once. So the whole block
       * is gated on the row actually HAVING been summarized by the code that
       * fills them in. Old rows score nothing here until `--force` re-reads
       * their log, which is the retroactivity limit stated on Profile.
       */
      if (s.combatDamageDealt !== undefined) {
        if (full && s.combatDamageDealt === 0) profile.pacifistWins++;
        // the parenthesis in "3 or fewer resources (which is longer than 3
        // turns)" is a CONDITION, settled by the owner 2026-08-30: the game
        // has to have actually run, so a freak turn-3 win does not qualify
        if (full && (s.resourcesLeft ?? Infinity) <= 3 && game.turns > 3) profile.asceticWins++;
        if ((s.deckLeft ?? Infinity) === 0) profile.deckedWins++;
        // "after dropping to 5 life or less" has to mean you CAME BACK, or
        // it is just Close Call with extra steps: the same win at 4 life
        // would earn both. So the low ebb has to be behind you by the end.
        if ((s.lowestLife ?? Infinity) <= 5 && s.lifeLeft > 5) profile.comebackWins++;
      }
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
  applyRatings();
  for (const a of store.accounts) refreshAchievements(a);
  persist();
}

/**
 * BL-02 — write the Elo fold onto the profiles.
 *
 * A SECOND PASS over the same history, and it has to be: `foldSeat` above
 * walks one account at a time, and a rating cannot be computed one account at
 * a time (rating.ts (2)). Running it here rather than inside the loop also
 * means the two passes cannot disagree about which games counted — they read
 * the same `store.history`.
 *
 * Accounts with no rated game are not in the table and keep the 1000/0 that
 * `emptyProfile()` already gave them.
 */
function applyRatings(): void {
  const table: RatingTable = foldRatings(store.history);
  for (const a of store.accounts) {
    const stand = table.get(a.id);
    if (!stand) continue;
    for (const mode of RATED_MODES) {
      a.profile.rating[mode] = stand[mode].rating;
      a.profile.ratedGames[mode] = stand[mode].games;
    }
  }
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
  /** BL-17: the trust mark, if any — public, it is a badge */
  badge: AccountBadge | null;
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
  discord: string | null;
  provisional?: true;
  favoritePicked: Element | null;
} {
  return {
    ...publicView(account),
    /* ⚠ PRIVATE VIEW ONLY, never publicView(). /api/player?name= is
     * unauthenticated, and somebody's Discord handle is not something a
     * stranger gets by typing their username into a box. The bot reads the id
     * through the token-gated /api/bot/profile instead. */
    discord: account.linked?.discord?.username ?? null,
    /** BL-42: still an unnamed guest? The post-game screen offers to keep it. */
    provisional: account.provisional === true ? true : undefined,
    /** the favourite the player CHOSE, or null when it is the one played most */
    favoritePicked: account.favorite ?? null,
    achievements: evaluateAchievements(account.profile, account).map(a => ({
      ...a, earnedAt: account.achievements[a.id] ?? null,
    })),
    friends: account.friends.map(id => friendView(id, online)).filter((f): f is FriendView => !!f),
    incoming: account.incoming.map(id => friendView(id, online)).filter((f): f is FriendView => !!f),
    outgoing: account.outgoing.map(id => friendView(id, online)).filter((f): f is FriendView => !!f),
    history: recentGames(account.id, 25),
  };
}

/**
 * Set or clear an account's trust mark (BL-17 first slice). `owner: true`
 * marks the site's owner; `judge` 1–3 sets a level, anything else clears it.
 * Neither → the field is removed. Returns what the account now carries.
 * Only the tester-token admin route calls this: there is no in-client way
 * to grant a badge, by design ("Only an admin can grant or revoke a badge").
 */
export function setBadge(account: Account, want: { owner?: unknown; judge?: unknown }): AccountBadge | null {
  const badge: AccountBadge = { since: new Date().toISOString() };
  if (want.owner === true) badge.owner = true;
  if (want.judge === 1 || want.judge === 2 || want.judge === 3) badge.judge = want.judge;
  if (badge.owner || badge.judge) account.badge = badge;
  else delete account.badge;
  persist();
  return account.badge ?? null;
}

/**
 * BL-16: grant or revoke the admin flag. Returns the flag the account now
 * carries, or throws when the change would leave the deploy with no admin
 * at all.
 *
 * ⚠ THE LAST-ADMIN GUARD IS THE WHOLE OF THE SAFETY HERE. The dashboard is
 * the only in-browser way to grant the flag, and it is refused to anyone who
 * does not already hold it — so an admin who revokes themselves while being
 * the only one locks every remaining route behind a token that lives on the
 * box. That is recoverable (deploy/admin.sh) and it is exactly the SSH the
 * flag exists to avoid, so it is refused instead. Revoking the second-to-last
 * admin is fine; revoking the last is not.
 */
export function setAdmin(account: Account, want: boolean): boolean {
  if (!want && account.admin) {
    const others = store.accounts.filter(a => a.admin && a.id !== account.id);
    if (!others.length) {
      throw new Error('refusing to remove the last admin — grant another one first');
    }
  }
  if (want) account.admin = true;
  else delete account.admin;
  persist();
  return account.admin === true;
}

/** Every account holding the admin flag. Used by the last-admin guard above
 *  and by the dashboard, which says how many there are. */
export const admins = (): Account[] => store.accounts.filter(a => a.admin);

export function publicView(account: Account): PublicView {
  const p = account.profile;
  return {
    id: account.id,
    username: account.username,
    createdAt: account.createdAt,
    favoriteElement: favoriteOf(account),
    profile: p,
    topCards: Object.entries(p.cards).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([card, n]) => ({ card, n })),
    earned: Object.keys(account.achievements).length,
    badge: account.badge ?? null,
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
    favoriteElement: favoriteOf(a),
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
  /**
   * R290: present only when a concede decided the game. `weight` is computed
   * HERE (concessionWeight) rather than by the client, so the thresholds stay
   * in one file; `mine` says whether this account was the one who conceded.
   * A `walkover` row is in the history and counted nowhere — the tab says so.
   */
  concession?: { turn: number; weight: ConcessionWeight; mine: boolean };
  /** BL-43: present only for a custom-rules game — its rules as summary lines */
  custom?: string[];
  /** R298: present only for a single card duel — [your card, theirs] */
  single?: [CardName, CardName];
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
        ...(g.concession
          ? { concession: { turn: g.concession.turn, weight: concessionWeight(g), mine: g.concession.seat === seat } }
          : {}),
        ...(g.custom ? { custom: rulesSummary(g.custom) } : {}),
        ...(g.single ? { single: [g.single[seat], g.single[seat === 0 ? 1 : 0]] as [CardName, CardName] } : {}),
      };
    });
}

export interface LeaderRow {
  id: string; username: string; online: boolean; games: number; wins: number;
  losses: number; streak: number; bestStreak: number;
  favoriteElement: Element | null; earned: number; lastPlayed: string | null;
  /** BL-02: the rating in the format this board is showing, and how many
   * rated games are behind it. `listed` is false while that count is under
   * PUBLIC_AFTER — the row still exists so a player can find THEMSELVES. */
  rating: number;
  ratedGames: number;
  listed: boolean;
}

/**
 * The head-to-head board: everybody, ranked.
 *
 * `mode` picks which board. Without one this is the old wins-ordered
 * scoreboard, unchanged — the friends tab still wants that, and so does
 * test-accounts.ts. With one it is the BL-02 ladder for that format, ordered
 * by rating, and it includes rows that are not publicly listable: filtering
 * those out is the CALLER's job (api-accounts.ts), because a player has to be
 * able to see their own position before they are listed, and a rank computed
 * over a filtered list would be a different, smaller number.
 */
export function leaderboard(online: (id: string) => boolean, mode?: RatedMode): LeaderRow[] {
  const rows = store.accounts.map(a => {
    const rating = mode ? a.profile.rating[mode] : START_RATING;
    const ratedGames = mode ? a.profile.ratedGames[mode] : 0;
    return {
      id: a.id, username: a.username, online: online(a.id),
      games: a.profile.games, wins: a.profile.wins, losses: a.profile.losses,
      streak: a.profile.streak, bestStreak: a.profile.bestStreak,
      favoriteElement: favoriteOf(a),
      earned: Object.keys(a.achievements).length,
      lastPlayed: a.profile.lastPlayed,
      rating, ratedGames,
      // an unclaimed guest is a row nobody can ever log in as
      listed: ratedGames >= PUBLIC_AFTER && !a.provisional,
    };
  });
  if (!mode) {
    // the wins scoreboard is what the friends tab shows as "Everyone here";
    // an unclaimed guest is nobody you can befriend (owner, 2026-09-05)
    const guest = new Set(store.accounts.filter(a => a.provisional).map(a => a.id));
    return rows.filter(r => !guest.has(r.id))
      .sort((a, b) => b.wins - a.wins || b.games - a.games || a.username.localeCompare(b.username));
  }
  // The ladder. Anybody with no rated game in this format is not on it at
  // all — an untouched 1000 is not a standing, and seeding the board with
  // every registered account at the same number would bury the players who
  // have actually played.
  return rows
    .filter(r => r.ratedGames > 0)
    .sort((a, b) => b.rating - a.rating || b.ratedGames - a.ratedGames || a.username.localeCompare(b.username));
}

export { ELEMENTS };
