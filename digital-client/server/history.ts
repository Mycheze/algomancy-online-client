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
import { summarizeGame, type GameRecord } from './stats.ts';

/** The saved-room fields we care about, beyond what stats.ts already reads. */
interface SavedRoom extends GameRecord {
  /** account id per seat, written by rooms.ts once accounts existed */
  users?: [string | null, string | null];
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
    names,
    seats: summary.seats,
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
  actions: GameRecord['actions']; decks: GameRecord['decks'];
}): ImportedRow {
  const row = importGame(
    {
      seed: room.seed, mode: room.mode, els: room.els, names: room.names,
      actions: room.actions, decks: room.decks, users: room.users,
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
    if (!raw.actions?.length) { report.skipped++; continue; }   // an empty room is not a game
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
