/* RUN ON THE DEPLOY BOX, NEVER HERE — fetch-prod-mirror.mjs pipes this file to
 * `ssh algomancy-vps node - <accounts.json>` so the secrets in the account
 * store never cross the wire. Reads the store, prints a copy with an ALLOWLIST
 * of fields per account and no sessions. Plain node, no imports from the repo:
 * the box may be on a different commit than the machine sending it.
 *
 * Kept: what the stats and the pages read (id, username, profile, the history,
 * decks, badges). Dropped: `salt` and `hash` (the password), every session
 * token, `linked` (a Discord id), and the friends lists — none of it is a
 * statistic, and none of it belongs on a laptop. */
import { existsSync, readFileSync } from 'node:fs';

const [file, historyFile] = process.argv.slice(2);
if (!file) { console.error('usage: node sanitize-accounts.mjs <accounts.json> [<history.jsonl>]'); process.exit(2); }
const store = JSON.parse(readFileSync(file, 'utf8'));
// a history file beside the store is sent inside it, the last line per code winning (past the last newline is a torn append)
const lines = historyFile && existsSync(historyFile) ? readFileSync(historyFile, 'utf8').split('\n').slice(0, -1).map(l => JSON.parse(l)) : null;
if (lines) store.history = [...new Map(lines.map(g => [g.code, g])).values()];
const KEEP = ['id', 'username', 'key', 'createdAt', 'profile', 'achievements', 'recorded',
  'decks', 'provisional', 'badge', 'favorite', 'admin'];
const accounts = (store.accounts ?? []).map(a => Object.fromEntries(KEEP.filter(k => k in a).map(k => [k, a[k]])));
process.stdout.write(JSON.stringify({ ...store, accounts, sessions: [] }));
