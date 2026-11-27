/* WHERE THE LIVE DATA LIVES.
 *
 * Everything this server writes and keeps — saved rooms, the account store,
 * playtest reports, the owner's card verdicts, the boot log — is RUNTIME STATE.
 * None of it is source, none of it is committed, and losing any of it loses
 * something no rebuild can recreate: the account store alone is every
 * password hash, every session token and everybody's stats.
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));   // <repo>/client/server

/** the checkout's own var/, gitignored in full: varDir()'s DEFAULT, and the
 * live data on the deploy box. Compare against it; never build a state path
 * from it, or ALGO_VAR_DIR stops moving that path. */
export const VAR_DIR = join(HERE, '..', '..', 'var');

/** every mutable thing the deployment owns — the base every getter below
 * defaults under, so ALGO_VAR_DIR moves them all and a per-file variable
 * still wins for its one file. Same variable, default and meaning as
 * bot/paths.py var_dir(): empty is unset, and a relative value is relative
 * to the process's working directory. */
export function varDir(): string {   // a function, not `const … =>`: it names no file (ui test 267)
  const v = process.env['ALGO_VAR_DIR'];
  return v ? resolve(v) : VAR_DIR;
}

/** saved rooms, one JSON per room code — replay with replay-room.ts */
export const gamesDir = (): string => process.env['ALGO_GAMES_DIR'] ?? join(varDir(), 'games');

/** the account store: password hashes, session tokens, every player's stats */
export const accountsFile = (): string =>
  process.env['ALGO_ACCOUNTS_FILE'] ?? join(varDir(), 'accounts', 'accounts.json');

/** the match history, one JSON line per write of a row (accounts.ts) */
export const historyFile = (): string => historyBeside(accountsFile());
/** named after its account file, so every override of that file moves it too */
export function historyBeside(accounts = accountsFile()): string { return accounts.replace(/(\.json)?$/, '.history.jsonl'); }

/** playtest reports from the in-game 🐛 button, stamped with room + action */
export const issuesFile = (): string => process.env['ALGO_ISSUES_FILE'] ?? join(varDir(), 'issues.jsonl');

/**
 * Report round 2026-10-23 — the RUN a report from a solo room was filed on (a
 * Weekly Challenge run, a Learn to Play game: rooms that live in the browser,
 * so no saved game exists to replay). One JSON line per report, keyed by the
 * issues row's `ts` (report-run.ts says why it may never go INTO that row).
 * Beside the journal by default, so every override of ALGO_ISSUES_FILE — the
 * tests, `npm run dev`, the prod mirror — takes its runs with it.
 */
export const reportRunsFile = (): string =>
  process.env['ALGO_REPORT_RUNS_FILE'] ?? join(dirname(issuesFile()), 'report-runs.jsonl');

/** the scenario tester's verdicts — the owner's judgements, and the only copy */
export const verdictsFile = (): string => process.env['ALGO_VERDICTS_FILE'] ?? join(varDir(), 'verdicts.jsonl');

/**
 * BL-16 — the admin's TRIAGE MARKS on playtest reports, one JSON line each.
 *
 * ⚠ A SEPARATE FILE, AND IT MAY NEVER BE FOLDED INTO issues.jsonl. A report's
 * id IS its line index in that journal — `fetch-reports.mjs` and
 * `70-playtest-ledger.test.ts` both key on it, and the shrink/merge guard is
 * built on the assumption that the file only ever grows by appending. Marking
 * a report by rewriting its line would renumber nothing and risk everything.
 * So a mark is a row over HERE that names the report it is about.
 *
 * Append-only and last-write-wins per report id, which makes changing your
 * mind a new line rather than an edit, and makes the file replayable.
 */
export const reportMarksFile = (): string =>
  process.env['ALGO_REPORT_MARKS_FILE'] ?? join(varDir(), 'report-marks.jsonl');

/**
 * The league (docs/20-league.md): every season — its entrants, weekly
 * pairings, match results — and the OUTBOX of Discord messages the bot has
 * not yet confirmed sending. One file, rewritten atomically: a handful of
 * seasons of a few dozen players is small, and one file is one thing to back
 * up and one thing to restore.
 */
export const leagueFile = (): string => process.env['ALGO_LEAGUE_FILE'] ?? join(varDir(), 'league.json');

/**
 * The rules review page's comments (api-crreview.ts, crreview.ts): one JSON
 * line per add, edit, resolve, reopen or delete, append-only and last write
 * wins per comment — so a deleted comment's text stays in the file. Each row
 * carries the author's account id; the page is never sent it.
 */
export const crCommentsFile = (): string => process.env['ALGO_CR_COMMENTS_FILE'] ?? join(varDir(), 'cr-comments.jsonl');

/**
 * BL-17 — the judges' flags on the rules bot's answers (api-judge-review.ts):
 * one JSON line per flag, unflag or resolve, append-only, folded last write
 * wins per (answer, judge). A flag row carries a COPY of the question and the
 * answer, so a flagged answer stays in the queue after it has scrolled out of
 * the bot's log window, and after the bot's own log is gone. Each row carries
 * the judge's account id; the page is never sent it.
 */
export const judgeFlagsFile = (): string => process.env['ALGO_JUDGE_FLAGS_FILE'] ?? join(varDir(), 'judge-flags.jsonl');

/**
 * Weekly challenges (docs/21-weekly-challenges.md, challenge-store.ts): a
 * directory of two files. `runs.jsonl` is every run anybody submitted —
 * account id and name, the ordered deck, the whole action log, the score the
 * server worked out — append-only, one line each, a score stamped once and
 * never recomputed. `weeks.json` is the frozen result of each closed week
 * (the top ten of each leaderboard), rewritten atomically.
 */
export const challengesDir = (): string => process.env['ALGO_CHALLENGES_DIR'] ?? join(varDir(), 'challenges');
/** Competitive Constructed matches (docs/22 §2.2, server/match-store.ts): one
 * JSON file per match, `<id>.json`, written atomically. Each game of a match
 * is an ordinary room file under gamesDir(); this holds what lasts between
 * them — the score, the sideboard configurations, the clocks, the pause. */
export const matchesDir = (): string => process.env['ALGO_MATCHES_DIR'] ?? join(varDir(), 'matches');
/** cube draft events (docs/25, server/cube-store.ts): one JSON file per event,
 * `<CODE>.json`, written atomically — its players, the pod draft as it stands,
 * the drafted pools and submitted decks, the pairings and results, and the
 * bell's notes. Each match it opens is an ordinary match under matchesDir(). */
export const cubeDir = (): string => process.env['ALGO_CUBE_DIR'] ?? join(varDir(), 'cube');
/** the drawn link-preview pictures (a deck's fan, server/main.ts /og/deck/).
 * A cache: every file is rebuilt from the deck on a miss, so losing it costs
 * one Python run per deck and nothing else. */
export const ogCacheDir = (): string => process.env['ALGO_OG_CACHE_DIR'] ?? join(varDir(), 'og-cache');
/** the card editor's requests (cardedit.ts): `<id>.json` and its pictures in
 * `<id>/`, written by this server only; `<id>.runner.jsonl`, appended only by
 * the home box's runner over ssh (cardedit-runner-row.ts); and `index.json`,
 * the edits ready for the runner, rewritten on every change. */
export const cardEditsDir = (): string => process.env['ALGO_CARD_EDITS_DIR'] ?? join(varDir(), 'card-edits');
