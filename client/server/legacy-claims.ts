/* BL-28 — the claims already in the store that only a NAME made.
 *
 *   node legacy-claims.ts                                   # report, write nothing
 *   node legacy-claims.ts --drop before-account --write     # unbind those, rebuild
 *   node legacy-claims.ts --drop after-account --write
 *   node legacy-claims.ts --drop all --write
 *   node legacy-claims.ts --store <accounts.json> --dir <games dir>   # a copy, not var/
 *
 * Until BL-28 a seat nobody was signed in on was bound to whichever account
 * owned the name typed into it: at registration (claimSeats), after every
 * finished game, at every boot, and inside every import. That code is gone,
 * but what it already bound is still in the history — `importGame` keeps a
 * previous row's `users`, so nothing changes until somebody decides. This is
 * where the decision is applied, once, by hand (doneWhen 4: "decided
 * explicitly and written down, not left to whatever the code happens to do").
 *
 * A NAME CLAIM is a history seat that names an account while the saved room
 * says nobody was signed in on it (`users[seat]` null or absent in the file),
 * and that was not bound by a sign-up ticket (`signedUp`). Split by when the
 * account was made:
 *   before-account  the game was played before the account existed — the
 *                   registration sweep (the LAN-era case: "Ben and Rashi log
 *                   in with their eight games in place"), or a signed-out
 *                   game followed by a sign-up minutes later
 *   after-account   the account already existed and somebody played signed
 *                   out under its name — its owner on another device, or a
 *                   stranger (the hole BL-28 closed)
 * A row whose room file is missing cannot be judged and is only counted.
 *
 * The default is to change NOTHING: without --write this only reports.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
// the store override must be in place before accounts.ts reads its path
const storeArg = flag('store');
if (storeArg) process.env['ALGO_ACCOUNTS_FILE'] = storeArg;

const { allAccounts, gameHistory, loadAccounts, rebuildProfiles, saveAccounts, accountsFilePath } =
  await import('./accounts.ts');
const { gamesDir } = await import('./statepaths.ts');

type Kind = 'before-account' | 'after-account';
const drop = flag('drop') as Kind | 'all' | undefined;
if (drop && !['all', 'before-account', 'after-account'].includes(drop)) {
  console.error(`--drop takes all, before-account or after-account (got ${drop})`);
  process.exit(2);
}
const write = argv.includes('--write');
const dir = flag('dir') ?? gamesDir();

loadAccounts();
const byId = new Map(allAccounts().map(a => [a.id, a]));
interface Hit { code: string; seat: 0 | 1; account: string; kind: Kind; playedAt: string; typed: string }
const hits: Hit[] = [];
let unjudged = 0;
for (const g of gameHistory()) {
  const file = join(dir, `${g.code}.json`);
  const raw = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8')) as { users?: (string | null)[] } : null;
  for (const seat of [0, 1] as const) {
    const id = g.users[seat];
    if (!id) continue;
    if (!raw) { unjudged++; continue; }
    if (raw.users?.[seat]) continue;                  // the room bound it
    if (g.signedUp?.includes(seat)) continue;         // a sign-up ticket bound it
    const a = byId.get(id);
    const kind: Kind = a && g.playedAt < a.createdAt ? 'before-account' : 'after-account';
    hits.push({ code: g.code, seat, account: a?.username ?? id, kind, playedAt: g.playedAt, typed: g.names[seat] });
  }
}

console.log(`store ${accountsFilePath()}\ngames ${dir}`);
console.log(`${gameHistory().length} games in the history; ${hits.length} seat(s) bound by a name alone`
  + (unjudged ? `; ${unjudged} bound seat(s) whose room file is missing (not judged)` : ''));
const per = new Map<string, Record<Kind, Hit[]>>();
for (const h of hits) {
  const row = per.get(h.account) ?? { 'before-account': [], 'after-account': [] };
  row[h.kind].push(h);
  per.set(h.account, row);
}
for (const [name, row] of [...per].sort((x, y) => x[0].localeCompare(y[0]))) {
  console.log(`  ${name}: ${row['before-account'].length} before the account existed, `
    + `${row['after-account'].length} after`);
  for (const h of [...row['before-account'], ...row['after-account']]) {
    console.log(`    ${h.code} seat ${h.seat} ${h.playedAt.slice(0, 16)} typed "${h.typed}" (${h.kind})`);
  }
}

if (!drop) process.exit(0);
const chosen = hits.filter(h => drop === 'all' || h.kind === drop);
if (!write) {
  console.log(`--drop ${drop} would unbind ${chosen.length} seat(s); add --write to do it`);
  process.exit(0);
}
for (const h of chosen) {
  const g = gameHistory().find(x => x.code === h.code)!;
  g.users[h.seat] = null;
}
rebuildProfiles();
saveAccounts();
console.log(`unbound ${chosen.length} seat(s) and rebuilt every profile`);
