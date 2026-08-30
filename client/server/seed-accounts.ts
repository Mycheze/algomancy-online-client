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

/**
 * Write an alias and/or a result INTO one saved game file.
 *
 * Both edits go to the file rather than being applied on the way past,
 * because a sync re-reads the file whenever it has changed and would
 * otherwise undo them — the rename in particular is not a display
 * preference, it is the correct name for a seat that was saved before the
 * name box existed. Returns the lines to print.
 */
function fixUpGame(code: string, who: string | null): string[] {
  const path = join(gamesDir, `${code}.json`);
  let raw: { names?: [string, string]; winner?: number | null };
  try { raw = JSON.parse(readFileSync(path, 'utf8')) as typeof raw; }
  catch { return [`  ${code}: no such saved game`]; }

  const out: string[] = [];
  const was: [string, string] = [raw.names?.[0] ?? 'Player 1', raw.names?.[1] ?? 'Player 2'];
  const names: [string, string] = [alias0(was[0]), alias0(was[1])];
  const next = { ...raw, names };
  if (names[0] !== was[0] || names[1] !== was[1]) {
    out.push(`  ${code}: ${dry ? 'would rename' : 'renamed'} ${was.join(' / ')} → ${names.join(' / ')}`);
  }

  if (who !== null) {
    const seat = who === '0' ? 0 : who === '1' ? 1
      : names.findIndex(n => n.trim().toLowerCase() === who.toLowerCase());
    if (seat !== 0 && seat !== 1) {
      out.push(`  ${code}: "${who}" is not one of ${names.map(n => `"${n}"`).join(' / ')}`);
    } else if (raw.winner !== seat) {
      next.winner = seat;
      out.push(`  ${code}: ${dry ? 'would stamp' : 'stamped'} ${names[seat]} (seat ${seat}) as the winner`);
    }
  }

  if (out.length && !dry) writeFileSync(path, JSON.stringify(next));
  return out;
}

// A dry run must not touch the real file, and the sync persists on its own —
// so point the whole store at a throwaway copy rather than suppressing writes.
loadAccounts();
if (dry) {
  const scratch = join(tmpdir(), `algo-accounts-dry-${process.pid}.json`);
  try { copyFileSync(accountsFilePath(), scratch); } catch { /* no store yet */ }
  useAccountsFile(scratch);
}

// fix up the saved files first: the sync below reads them straight back out
let fixed = 0;
if (aliases.size || results.size) {
  const all = (): string[] => {
    try { return readdirSync(gamesDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')); }
    catch { return []; }
  };
  const codes = aliases.size || results.has('ALL')
    ? all()
    : [...results.keys()];
  const lines: string[] = [];
  for (const code of codes) {
    lines.push(...fixUpGame(code, results.get(code) ?? results.get('ALL') ?? null));
  }
  fixed = lines.length;
  if (lines.length) console.log(`fixing up saved games\n${lines.join('\n')}\n`);
}

console.log(`seeding from ${gamesDir}\n`);
// a fixup changes a game's content without changing its file's role in the
// skip check, so always re-summarize when one was applied
const report = syncGamesDir(gamesDir, { aliases, force: force || fixed > 0 });

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
