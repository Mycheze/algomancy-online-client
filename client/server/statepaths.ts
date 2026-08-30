/* WHERE THE LIVE DATA LIVES.
 *
 * Everything this server writes and keeps — saved rooms, the account store,
 * playtest reports, the owner's card verdicts, the boot log — is RUNTIME STATE.
 * None of it is source, none of it is committed, and losing any of it loses
 * something no rebuild can recreate: accounts.json alone is every password
 * hash, every session token and everybody's stats.
 *
 * It used to sit inside server/ next to the code, which made `git status` a
 * poor guide to what was safe to delete and made an 11 MB user-data file the
 * largest thing in the source tree. It now lives in var/ at the repo root,
 * gitignored as a whole, so the rule is simply: nothing under var/ is ever
 * committed, and nothing outside it is ever written to at runtime.
 *
 * ⚠ EACH GETTER READS ITS ENV VAR ON EVERY CALL, AND THAT IS DELIBERATE.
 * The tests point the server at throwaway directories — `npm test` has to be
 * safe to run on the deploy box, where these files are live. Some set the
 * variable before importing (test-lobby, test-collection, and every spawned
 * server via test-util's spawnServer); but 171-engine-version-stamp,
 * 186-scenario-library and 217-reveal-rows set it IN-PROCESS and then call in,
 * so a value captured at import time would ignore them and the suite would
 * read — or worse, write — the real data. Call these, do not cache them at
 * module scope unless you are reproducing the import-time behaviour on purpose
 * (main.ts and rooms.ts do exactly that, and always have).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));   // <repo>/client/server

/** every mutable thing the deployment owns; gitignored in full */
export const VAR_DIR = join(HERE, '..', '..', 'var');

/** saved rooms, one JSON per room code — replay with replay-room.ts */
export const gamesDir = (): string => process.env['ALGO_GAMES_DIR'] ?? join(VAR_DIR, 'games');

/** the account store: password hashes, session tokens, every player's stats */
export const accountsFile = (): string =>
  process.env['ALGO_ACCOUNTS_FILE'] ?? join(VAR_DIR, 'accounts', 'accounts.json');

/** playtest reports from the in-game 🐛 button, stamped with room + action */
export const issuesFile = (): string => process.env['ALGO_ISSUES_FILE'] ?? join(VAR_DIR, 'issues.jsonl');

/** the scenario tester's verdicts — the owner's judgements, and the only copy */
export const verdictsFile = (): string => process.env['ALGO_VERDICTS_FILE'] ?? join(VAR_DIR, 'verdicts.jsonl');
