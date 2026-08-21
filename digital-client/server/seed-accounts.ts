/* Import the games in server/games/ into the account record.
 *
 *   node seed-accounts.ts                          # sync anything new
 *   node seed-accounts.ts --alias "Player 2=Rashi" # fix a pre-name-box seat
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
import { copyFileSync } from 'node:fs';
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

// A dry run must not touch the real file, and the sync persists on its own —
// so point the whole store at a throwaway copy rather than suppressing writes.
loadAccounts();
if (dry) {
  const scratch = join(tmpdir(), `algo-accounts-dry-${process.pid}.json`);
  try { copyFileSync(accountsFilePath(), scratch); } catch { /* no store yet */ }
  useAccountsFile(scratch);
}

console.log(`seeding from ${gamesDir}\n`);
const report = syncGamesDir(gamesDir, { aliases, force });

for (const { code, game, isNew } of report.rows) {
  const outcome = game.finished ? `${game.names[game.winner ?? 0]} won` : 'unfinished';
  console.log(`  ${code}  ${game.mode.padEnd(11)} ${game.els.join('+').padEnd(20)} ` +
    `turn ${String(game.turns).padStart(2)}  ${game.names.join(' vs ').padEnd(18)} ${outcome}` +
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
    console.log(`  ${a.username}: ${p.games} games, ${p.wins}W-${p.losses}L ` +
      `(${p.unfinished} unfinished), ${Object.keys(a.achievements).length} achievements`);
  }
}

if (dry) {
  console.log(`\n--dry: the real store at ${REAL_STORE} was not touched.`);
} else {
  saveAccounts();
  console.log(`\nwritten to ${accountsFilePath()}`);
}
