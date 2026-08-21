/* Import the games in server/games/ into the account record.
 *
 *   node seed-accounts.ts                          # sync anything new
 *   node seed-accounts.ts --alias "Player 2=Rashi" # fix a pre-name-box seat
 *   node seed-accounts.ts --result AGBP=Ben        # stamp who won an old game
 *   node seed-accounts.ts --result all=Ben         # ...or all of them at once
 *   node seed-accounts.ts --force                  # re-summarize every game
 *   node seed-accounts.ts --dry                    # report, write nothing
 *
 * The server does this at every start too (main.ts). This CLI exists for the
 * two things a boot sync deliberately does not do: aliasing an old seat name,
 * and forcing a full re-summarize after a change to how a stat is counted.
 *
 * Games whose seats belong to nobody are stored with the NAMES that were typed
 * at the time; registering under one of those names claims them (accounts.ts
 * claimSeats). So this can run before anybody has signed up, which is the
 * point — Ben and Rashi log in for the first time with their history already
 * in place.
 */
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accountsFilePath, allAccounts, gameHistory, loadAccounts, saveAccounts, useAccountsFile,
} from './accounts.ts';
import { syncGamesDir } from './history.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dry = argv.includes('--dry');
const force = argv.includes('--force') || dry;   // a dry run should show everything
const gamesDir = flag('dir') ?? join(HERE, 'games');
/** captured before a dry run redirects the store, for the closing message */
const REAL_STORE = join(HERE, 'accounts', 'accounts.json');

/** `--alias "Player 2=Rashi"`, repeatable. */
const aliases = new Map<string, string>();
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--alias') continue;
  const [from, to] = String(argv[i + 1] ?? '').split('=');
  if (from && to) aliases.set(from.trim().toLowerCase(), to.trim());
}
const alias0 = (name: string): string => aliases.get(name.trim().toLowerCase()) ?? name;

/**
 * `--result CODE=Ben` / `--result CODE=0` / `--result all=Ben`, repeatable.
 *
 * Writes the winner INTO the saved game file, where it becomes the
 * authoritative result (stats.ts GameRecord.winner). This exists because the
 * eight games we had played all predate the winner stamp, and five of them no
 * longer replay to their ending on the current engine — the log describes a
 * board the rules have since changed out from under it. Rather than let those
 * five read as "unfinished" forever, the person who was there says who won.
 *
 * The server stamps its own games from now on, so this is a one-off tool for
 * history, not part of the normal flow.
 */
const results = new Map<string, string>();
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--result') continue;
  const [code, who] = String(argv[i + 1] ?? '').split('=');
  if (code && who) results.set(code.trim().toUpperCase(), who.trim());
}

/** Resolve "Ben" / "0" / "1" against a game's seat names, then write it in.
 * Returns a line to print, or null when there was nothing to do. */
function stampResult(code: string, who: string): string | null {
  const path = join(gamesDir, `${code}.json`);
  let raw: { names?: [string, string]; winner?: number | null };
  try { raw = JSON.parse(readFileSync(path, 'utf8')) as typeof raw; }
  catch { return `  ${code}: no such saved game`; }
  const names = [alias0(raw.names?.[0] ?? 'Player 1'), alias0(raw.names?.[1] ?? 'Player 2')];
  const seat = who === '0' ? 0 : who === '1' ? 1
    : names.findIndex(n => n.trim().toLowerCase() === who.toLowerCase());
  if (seat !== 0 && seat !== 1) {
    return `  ${code}: "${who}" is not one of ${names.map(n => `"${n}"`).join(' / ')}`;
  }
  if (raw.winner === seat) return null;   // already stamped that way
  if (dry) return `  ${code}: would stamp ${names[seat]} (seat ${seat}) as the winner`;
  writeFileSync(path, JSON.stringify({ ...raw, winner: seat }));
  return `  ${code}: stamped ${names[seat]} (seat ${seat}) as the winner`;
}

// A dry run must not touch the real file, and the sync persists on its own —
// so point the whole store at a throwaway copy rather than suppressing writes.
loadAccounts();
if (dry) {
  const scratch = join(tmpdir(), `algo-accounts-dry-${process.pid}.json`);
  try { copyFileSync(accountsFilePath(), scratch); } catch { /* no store yet */ }
  useAccountsFile(scratch);
}

// stamp results first: the sync below reads them straight back out
if (results.size) {
  console.log('stamping results');
  const codes = results.has('ALL')
    ? readdirSync(gamesDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
    : [...results.keys()];
  for (const code of codes) {
    const who = results.get(code) ?? results.get('ALL')!;
    const line = stampResult(code, who);
    if (line) console.log(line);
  }
  console.log('');
}

console.log(`seeding from ${gamesDir}\n`);
// a stamped result changes a game's outcome without changing its file's role
// in the skip check, so always re-summarize when one was applied
const report = syncGamesDir(gamesDir, { aliases, force: force || results.size > 0 });

for (const { code, game, isNew } of report.rows) {
  const outcome = game.finished ? `${game.names[game.winner ?? 0]} won` : 'result unknown';
  console.log(`  ${code}  ${game.mode.padEnd(11)} ${game.els.join('+').padEnd(20)} ` +
    `turn ${String(game.turns).padStart(2)}  ${game.names.join(' vs ').padEnd(18)} ` +
    `${outcome}${game.diverged ? ' ⚠ replay diverged — partial stats' : ''}` +
    `${isNew ? '' : '  (updated)'}`);
}

console.log(`\n${report.added} added, ${report.updated} updated, ${report.skipped} skipped — ` +
  `history holds ${gameHistory().length} game(s)`);

const accounts = allAccounts();
if (!accounts.length) {
  const names = [...new Set(gameHistory().flatMap(g => g.names))];
  console.log(`\nno accounts yet. Register as one of ${names.map(n => `"${n}"`).join(' / ')} ` +
    'and that account claims its games automatically.');
} else {
  console.log('');
  for (const a of accounts) {
    const p = a.profile;
    console.log(`  ${a.username}: ${p.games} games, ${p.wins}W-${p.losses}L` +
      `${p.unresolved ? `, ${p.unresolved} with no known result` : ''}, ` +
      `${Object.keys(a.achievements).length} achievements`);
  }
}

if (dry) {
  console.log(`\n--dry: the real store at ${REAL_STORE} was not touched.`);
} else {
  saveAccounts();
  console.log(`\nwritten to ${accountsFilePath()}`);
}
