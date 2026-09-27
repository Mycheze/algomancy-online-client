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
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node sanitize-accounts.mjs <accounts.json>'); process.exit(2); }
const store = JSON.parse(readFileSync(file, 'utf8'));
const KEEP = ['id', 'username', 'key', 'createdAt', 'profile', 'achievements', 'recorded',
  'decks', 'provisional', 'badge', 'favorite', 'admin'];
const accounts = (store.accounts ?? []).map(a => Object.fromEntries(KEEP.filter(k => k in a).map(k => [k, a[k]])));
process.stdout.write(JSON.stringify({ ...store, accounts, sessions: [] }));
