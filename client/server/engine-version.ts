/* R200 — WHICH ENGINE WAS THIS GAME RECORDED AGAINST?
 *
 * A saved game is a CLAIM: seed + actions reproduces this game. The claim was
 * true when it was written and is checked by an engine that has moved since,
 * so a replay months later reports the difference as if the FILE were at
 * fault. It is not: 20 of the 22 games in the corpus diverge, every single
 * divergence traced back to a DELIBERATE rules change, and none of them is a
 * regression. The logs are sound; the reader moved.
 *
 * A log with no version on it cannot say that for itself. So every room file
 * now carries the commit the engine was at when each stretch of it was
 * recorded, and `replay-room.ts --as-recorded` can check out that commit and
 * replay there — which turns "this file diverges" back into the question it
 * was always meant to be: *what changed between then and now?*
 *
 * ── how the version is resolved, and why in that order ────────────────
 *
 *   1. `ALGO_ENGINE_VERSION`, if set. Two reasons, both real. A deploy from a
 *      tarball or a container has no `.git` and would otherwise stamp every
 *      game 'unknown'; and a test needs to be able to say "pretend this game
 *      was recorded at deadbeef" without inventing commits.
 *   2. `git rev-parse HEAD` in the repo this file lives in.
 *   3. `'unknown'` — never a throw and never a guess. A missing stamp is a
 *      file that cannot be replayed --as-recorded, which is exactly what it
 *      is, and is strictly better than a WRONG stamp: a wrong SHA sends the
 *      replay to a worktree that is not the engine this game was played on
 *      and reports the resulting mess as a rules change.
 *
 * ⚠ THE STAMP IS NOT AUTHENTICATION. It says what the process believed it was
 * running, and a dirty working tree stamps its base commit. That is fine for
 * what this is for — locating the rules as of a moment — and it is why the
 * tool always REPORTS the SHA it used rather than silently trusting it.
 *
 * This module deliberately imports nothing from `rooms.ts` and pulls in no
 * `ws`: `replay-room.ts` reads it, `engine/test/171` reads it through that,
 * and R181 is the story of what happens when the server's socket layer leaks
 * into the engine's typecheck.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The sentinel a file carries when the engine could not name itself. Not a
 * SHA and never treated as one — `--as-recorded` refuses it by name. */
export const UNKNOWN_VERSION = 'unknown';

/** A full 40-char git object name. Deliberately strict: an abbreviated SHA is
 * ambiguous across the repo's lifetime, and this field's whole job is to be
 * resolvable years later. */
export function isEngineVersion(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);
}

let cached: string | null = null;

/**
 * The commit this engine is running at, resolved once per process.
 *
 * Cached because it is stamped on every room creation and every restore, and
 * because it CANNOT change under a running process: the code is already
 * loaded. Re-reading it per call would let a `git checkout` in another window
 * stamp two halves of one game with two SHAs neither of which ran.
 */
export function engineVersion(): string {
  if (cached !== null) return cached;
  const forced = process.env['ALGO_ENGINE_VERSION'];
  if (forced) { cached = forced; return cached; }
  try {
    const sha = execFileSync('git', ['-C', HERE, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    cached = isEngineVersion(sha) ? sha : UNKNOWN_VERSION;
  } catch {
    cached = UNKNOWN_VERSION;   // no git, no .git dir, shallow copy — all fine
  }
  return cached;
}

/** Testing seam: forget the cached answer so a test can change the env and
 * ask again. Never called by the server. */
export function resetEngineVersionCache(): void { cached = null; }

/** Where the repo lives, for `git worktree add` — the directory `git` should
 * be run in to reach this checkout's history. */
export function repoDir(): string { return join(HERE, '..', '..'); }
