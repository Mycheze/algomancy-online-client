/* Getting played games into the account record.
 *
 * The saved rooms in server/games/ ARE the match history — they hold the seed,
 * the action log, the names, and (since accounts) the account id per seat. So
 * rather than maintain a second ledger that can drift, everything funnels
 * through here: summarize a saved game, stash it, rebuild the profiles.
 *
 * That has one very useful consequence. Most of our games never reach a
 * winner — we stop when someone has to go — and a "record it when it ends"
 * design would count almost nothing. Syncing the directory instead counts
 * every game that was actually played, and an abandoned game simply lands in
 * the record as `finished: false`.
 *
 * Idempotent throughout: a game code is replaced in place, never appended
 * twice, and profiles are recomputed from the whole history rather than
 * incremented, so re-syncing after a change to how a stat is counted updates
 * the numbers instead of doubling them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  accountByName, allAccounts, claimSeats, gameHistory, rebuildProfiles,
  saveAccounts, stashHistory, type RecordedGame,
} from './accounts.ts';
import { MIN_GAME_ACTIONS, summarizeGame, type GameRecord } from './stats.ts';
import { concessionWeight, sanitizeConcession, type Concession } from './concession.ts';
import { singleCardsOf } from './cardladder.ts';
import { sanitizeCustomRules, STANDARD_RULES, type CustomRules } from '../ui/customrules.ts';

/** The saved-room fields we care about, beyond what stats.ts already reads. */
interface SavedRoom extends GameRecord {
  /** R290: who conceded, on which turn — stamped by rooms.ts when a concede
   * decided the game. Absent on every other game. See RecordedGame.concession. */
  concession?: Concession;
  /** account id per seat, written by rooms.ts once accounts existed */
  users?: [string | null, string | null];
  /** constructed: the collection deck id per seat (rooms.ts, additive) —
   * what a deck's win/loss record is folded out of */
  deckIds?: [string | null, string | null];
  /** BL-37: how long the match ran, in ms of live table time. Absent in every
   * file written before the timer existed — see RecordedGame.matchMs. */
  matchMs?: number;
  /** BL-02: the matchmaker made this room, so it moves ratings. Absent on
   * every room made from a code — see RecordedGame.rated. */
  rated?: boolean;
  /** R298: a single card duel — the cards are `decks[seat][0]` */
  single?: boolean;
  // `winner`, the result stamped at the time, comes from GameRecord — it is
  // what keeps an old game's outcome readable after the rules have moved
}

export interface ImportOptions {
  /** rewrite a seat name before recording (lowercased key → replacement) */
  aliases?: Map<string, string>;
  /** re-summarize even when the saved file has not changed since last time */
  force?: boolean;
}

export interface ImportedRow {
  code: string;
  game: RecordedGame;
  isNew: boolean;
}

/**
 * Summarize one saved room and put it in the history. Does NOT rebuild
 * profiles — callers batch that, because rebuilding is a fold over the whole
 * history and doing it per game would be quadratic.
 */
export function importGame(raw: SavedRoom, code: string, playedAt: string, opts: ImportOptions = {}): ImportedRow {
  const alias = (name: string): string =>
    opts.aliases?.get(name.trim().toLowerCase()) ?? name;
  const names: [string, string] = [
    alias(raw.names?.[0] ?? 'Player 1'),
    alias(raw.names?.[1] ?? 'Player 2'),
  ];
  const summary = summarizeGame({ ...raw, code, names, playedAt });
  const previous = gameHistory().find(g => g.code === code);
  const game: RecordedGame = {
    code,
    playedAt,
    recordedAt: new Date().toISOString(),
    mode: summary.mode,
    els: summary.els,
    finished: summary.finished,
    winner: summary.winner,
    turns: summary.turns,
    diverged: summary.skipped > 0,
    // BL-37: how long the match took. Omitted entirely when the saved file
    // does not carry one — every game before the timer existed, and every
    // hand-seeded fixture. See RecordedGame.matchMs for why absent beats 0.
    ...(typeof raw.matchMs === 'number' && raw.matchMs > 0 ? { matchMs: raw.matchMs } : {}),
    // Seat ownership, best source first: what the room recorded while it was
    // being played, then a previous import's answer (which may have been
    // claimed by a registration since), then a name match. A seat nobody was
    // logged in on stays null and can still be claimed later.
    users: [0, 1].map(i => {
      const seat = i as 0 | 1;
      return raw.users?.[seat]
        ?? previous?.users[seat]
        ?? accountByName(names[seat])?.id
        ?? null;
    }) as [string | null, string | null],
    // Which saved deck each seat brought. Same "best source first" shape as
    // `users`, and the same reason: a re-import must not lose an attribution
    // the live room recorded. Omitted entirely when neither seat had one, so
    // no draft or shared game grows a field of nulls.
    ...(raw.deckIds?.[0] || raw.deckIds?.[1] || previous?.deckIds?.[0] || previous?.deckIds?.[1]
      ? { deckIds: [
          raw.deckIds?.[0] ?? previous?.deckIds?.[0] ?? null,
          raw.deckIds?.[1] ?? previous?.deckIds?.[1] ?? null,
        ] as [string | null, string | null] }
      : {}),
    names,
    seats: summary.seats,
    // BL-02: only a matchmade game is rated, and the flag comes from the
    // SAVED FILE rather than from anything derivable. ⚠ `previous` is the
    // fallback for the same reason `users` has one: a re-import must not
    // quietly un-rate a game whose file predates a field. Omitted when false
    // so no existing history row grows one.
    ...(raw.rated ?? previous?.rated ? { rated: true } : {}),
    // R290: the concession stamp, same "best source first" shape and the same
    // reason — a re-import must not turn a walkover back into a full loss.
    // Omitted when there is none, so no existing row grows a field.
    ...((): { concession?: Concession } => {
      const c = sanitizeConcession(raw.concession) ?? previous?.concession;
      return c ? { concession: c } : {};
    })(),
    // BL-43: a custom game is recorded and TAGGED — shown in the match history
    // and counted by no fold (foldSeat, isRated, matchLengths, the deck and
    // lineage records and the trio history all skip it). The rules only: the
    // deal stays in the room file, where the summary above read it.
    ...(raw.custom ? { custom: sanitizeCustomRules(raw.custom.rules) ?? { ...STANDARD_RULES, bans: [] } as CustomRules } : {}),
    // R298: a single card duel, tagged with its two cards — read off the saved
    // decks through the same helper the live room uses, so they cannot disagree.
    // A single-card file whose decks are unreadable is still TAGGED (with no
    // cards the ladder can read), never recorded as an ordinary constructed game.
    ...(raw.single ? { single: singleCardsOf(raw.decks) ?? ['', ''] as [string, string] } : {}),
  };
  const isNew = stashHistory(game);
  return { code, game, isNew };
}

/**
 * Record one game straight from a live room (the game just ended), rather than
 * from its file on disk. Same path as the directory sync — summarize, stash,
 * rebuild — so a game recorded live and the same game re-imported later come
 * out identical.
 */
export function recordLiveGame(room: {
  code: string; seed: number; mode: GameRecord['mode']; els: GameRecord['els'];
  names: [string, string]; users: [string | null, string | null];
  winner?: GameRecord['winner'];
  actions: GameRecord['actions']; decks: GameRecord['decks'];
  deckIds?: [string | null, string | null];
  scenario?: string;
  /** BL-37: the room's own match clock, so a game recorded LIVE carries the
   * same number the file would have carried if it were re-imported later. */
  matchMs?: number;
  /** BL-02: same idea — a matchmade game recorded live must be rated without
   * waiting for its file to be re-read at the next boot. */
  rated?: boolean;
  /** R290: and the concession stamp, for the same reason. */
  concession?: Concession;
  /** BL-43: the custom rules and their deal, so the summary deals the game that was played */
  custom?: { rules: unknown; deal: unknown };
  /** R298: a single card duel */
  single?: true;
}): ImportedRow {
  const row = importGame(
    {
      seed: room.seed, mode: room.mode, els: room.els, names: room.names,
      actions: room.actions, decks: room.decks, users: room.users,
      // constructed: which saved deck each seat brought (collection.ts)
      deckIds: room.deckIds,
      // R216: carried so the replay inside summarizeGame deals the same board
      // the game was played on. (A scenario room is normally filtered out
      // before it gets here — see the guard in syncGamesDir and main.ts's
      // recordFinishedGame — but a record that reaches the fold must still
      // describe the game that happened.)
      scenario: room.scenario,
      // the room stamped this when the game was decided — do not re-derive it
      winner: room.winner,
      // BL-37: measured, never derived — see Room.matchMs
      matchMs: room.matchMs,
      // BL-02: stamped by the matchmaker at room creation — see Room.rated
      rated: room.rated,
      // R290: stamped by applyToRoom when the concede landed — see Room.concession
      concession: room.concession,
      // BL-43: the deal this game was dealt from, and the rules it was chosen as
      ...(room.custom ? { custom: room.custom } : {}),
      // R298: the tag, so a live-recorded duel reaches the card ladder at once
      ...(room.single ? { single: true } : {}),
    } as SavedRoom,
    room.code,
    new Date().toISOString(),
  );
  for (const a of allAccounts()) claimSeats(a);
  rebuildProfiles();
  saveAccounts();
  return row;
}

export interface SyncReport {
  added: number;
  updated: number;
  skipped: number;
  rows: ImportedRow[];
}

/**
 * BL-37 — HOW LONG A GAME TAKES HERE, over every game that measured it.
 *
 * The whole reason the owner asked for a match clock: *"saved with the game to
 * track average game length and tune the clocks."* A bank is a guess until
 * there are numbers behind it, and this is the number.
 *
 * ⚠ `n` IS PART OF THE ANSWER, NOT DECORATION. Every game before 2026-09-01
 * carries no `matchMs` at all, so this is an average over the games that
 * measured themselves and nothing else — quoting the mean without saying how
 * many games are behind it is how "the average game is 12 minutes" gets said
 * about a sample of one. A caller with `n === 0` has no answer and must say so
 * rather than print `0m`.
 *
 * The median is carried beside the mean because match length is exactly the
 * shape that has outliers: one game left open over a lunch break moves a mean
 * of six games by ten minutes and moves the median not at all.
 */
export function matchLengths(games: readonly RecordedGame[]): {
  n: number; total: number; mean: number; median: number; longest: number;
} {
  // R290: a game conceded on turn 1 or 2 is not a full game, and "how long
  // does a game take here" is a question about full games — a minute-long
  // walkover folded into the mean is the same class of lie as a 0. The
  // fast-game exclusion the owner asked for, applied to the one length stat.
  // BL-43: and a custom-rules game says nothing about how long a game here takes
  // R298: nor does thirty copies of one card
  const ms = games.filter(g => concessionWeight(g) === 'normal' && !g.custom && !g.single)
    .map(g => g.matchMs).filter((m): m is number => typeof m === 'number' && m > 0)
    .sort((a, b) => a - b);
  if (!ms.length) return { n: 0, total: 0, mean: 0, median: 0, longest: 0 };
  const total = ms.reduce((a, b) => a + b, 0);
  const mid = Math.floor(ms.length / 2);
  return {
    n: ms.length,
    total,
    mean: Math.round(total / ms.length),
    median: ms.length % 2 ? ms[mid]! : Math.round((ms[mid - 1]! + ms[mid]!) / 2),
    longest: ms[ms.length - 1]!,
  };
}

/**
 * Sync a whole games directory into the history and rebuild every profile.
 *
 * A game whose file has not been written since we last recorded it is skipped
 * (each summarize is a full replay — ~30ms for a real game, which adds up
 * across a growing archive at every server start). `force` re-reads everything,
 * which is what you want after changing how a stat is counted.
 */
export function syncGamesDir(dir: string, opts: ImportOptions = {}): SyncReport {
  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  } catch {
    return { added: 0, updated: 0, skipped: 0, rows: [] };
  }
  const report: SyncReport = { added: 0, updated: 0, skipped: 0, rows: [] };
  for (const f of files) {
    const code = f.replace(/\.json$/, '');
    const path = join(dir, f);
    let raw: SavedRoom;
    let playedAt: string;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as SavedRoom;
      // the file's last write is the game's last move — the best "when was
      // this played" we have, and it is what makes the skip check below work
      playedAt = statSync(path).mtime.toISOString();
    } catch (err) {
      console.warn(`[history] ${code}: unreadable — ${err instanceof Error ? err.message : err}`);
      report.skipped++;
      continue;
    }
    // R216: a scenario room is a TEST FIXTURE, not a game. It has a dealt
    // board, a scripted opponent and a purpose, and folding it into somebody's
    // win/loss record would make the tester quietly rewrite the stats it is
    // supposed to be checking. Skipped here, at the one place every saved file
    // enters the history.
    if (raw.scenario) {
      report.skipped++;
      continue;
    }
    // a room somebody opened and left is not a game — and the test reads the
    // RAW log, so a diverged replay can never demote a real game to one
    if ((raw.actions?.length ?? 0) < MIN_GAME_ACTIONS && raw.winner == null) {
      report.skipped++;
      continue;
    }
    const known = gameHistory().find(g => g.code === code);
    if (!opts.force && known && known.playedAt === playedAt) { report.skipped++; continue; }
    const row = importGame(raw, code, playedAt, opts);
    report.rows.push(row);
    if (row.isNew) report.added++; else report.updated++;
  }
  if (report.added || report.updated) {
    for (const a of allAccounts()) claimSeats(a);
    rebuildProfiles();
    saveAccounts();
  }
  return report;
}
