/* Replay a saved game file through the CURRENT engine and report how
 * faithfully it reproduces — the review/verification tool for game logs.
 *
 *   node replay-room.ts games/SMVJ.json           # summary + verdict
 *   node replay-room.ts games/SMVJ.json --log     # + the full annotated event log
 *   node replay-room.ts games/SMVJ.json --as-recorded          # + the DELTA (R200)
 *   node replay-room.ts games/SMVJ.json --as-recorded --at <sha>
 *   node replay-room.ts games/SMVJ.json --json    # one line, for a corpus sweep
 *
 * Exit codes, so a sweep can classify without parsing prose: 0 faithful,
 * 2 diverged, 3 inconsistent, 4 PERMANENTLY unreplayable (excluded, not
 * counted), 5 this is a stale copy of the file — see `EXIT` at the bottom.
 *
 * A room file is a CLAIM: seed + actions reproduces this game. Replay is
 * deterministic (the engine is pure — no Math.random, no Date.now), so the
 * claim is checkable, and this is the thing that checks it.
 *
 * There are two completely different reasons a replay can come up short, and
 * telling them apart is the whole point of this tool:
 *
 *   ENGINE DRIFT   the rules changed since the game was played, so the current
 *                  engine refuses moves that were legal at the time. Expected
 *                  after a rules commit. The FILE is fine; it is a true record
 *                  of a game this engine would no longer allow.
 *
 *   FORK           the server restarted mid-game onto a changed engine, could
 *                  not replay part of the log, rebuilt the game without those
 *                  actions, and play then CONTINUED from the rebuilt board.
 *                  The log is two different games end to end. rooms.ts records
 *                  this in the file as it happens (`forks`), so it is a fact
 *                  stated by the file rather than something you have to infer
 *                  from a pile of rejections.
 *
 * Before `forks` existed the two presented identically — a heap of skips —
 * which is exactly how playtest game UZRG came to reject 79 of its 276 actions
 * with nobody noticing for weeks.
 *
 * ── R169 / CT-45: A SKIP COUNT IS NOT A REPORT ────────────────────────
 *
 * This tool used to lead with "141 actions logged, 126 replayed, 15 skipped",
 * which reads as a 89%-faithful replay with a handful of independent hiccups.
 * On ANBB it was nothing of the kind. Action [125] is a `decide` the engine can
 * no longer accept; the decision it was meant to answer therefore stays open
 * forever, and `apply()` refuses EVERY later action by EITHER seat with "a
 * decision is pending for Ben". Fourteen of those fifteen "skips" are one
 * failure wearing fourteen hats. The orchestrator read them as fourteen
 * findings and briefed an agent on thirteen of them; all thirteen were phantom.
 *
 * So the shape of the report is now:
 *
 *   1. the FIRST action this engine refused — index, type, seat, reason. That
 *      is the DIVERGENCE POINT, and it is the only refusal in the file that is
 *      evidence about anything on its own.
 *   2. everything after it, stated as cascade. From the divergence point on,
 *      the replay is running a board the logged game never had, so a later
 *      refusal is not a second finding and a later SUCCESS is not a second
 *      confirmation.
 *   3. the WEDGE, when there is one, proved rather than guessed: a run of
 *      consecutive refusals all standing under the same still-open decision.
 *      That is a total replay loss, not a partial one.
 *
 * The count is still printed. It is never printed alone.
 *
 * ── R200 / CT-66: A REFUSAL IS AN UPPER BOUND, NOT A MEASUREMENT ──────
 *
 * Everything above still only reports the first REFUSAL, and that is where the
 * engine finally NOTICED — not where the rules moved. A rules change lands at
 * action [k]; the action still applies, legally, and now means something else;
 * the boards drift apart in silence; several actions later something becomes
 * illegal and gets reported as "the divergence". On ANBB the gap is 93 actions.
 * "Fix [125] and re-run" is advice about a board the logged game stopped having
 * a third of the way through.
 *
 * One replay cannot do better, because it has nothing to compare against. So
 * the room file now records the commit each stretch of it was played under
 * (`versions`, R200), `--as-recorded` checks that commit out into a throwaway
 * detached worktree and runs the same probe there, and the tool reports the
 * DELTA between the two runs. Three things follow, and all three are the point:
 *
 *   · the divergence is MEASURED rather than bounded;
 *   · a difference that HEALS is separated from one that STICKS — SMVJ's
 *     boards part at [99], rejoin at [111], and only part for good at [120],
 *     so leading with the first difference is its own kind of wrong;
 *   · a log that replays clean can still be a different game (GYSR).
 *
 * Two smaller failures fixed alongside, both of which made the corpus look
 * worse than it is: a STALE COPY of a game file does not error, it reassures
 * (a truncated 104-action copy of a 375-action game reported ✓ FAITHFUL three
 * times), so the tool cross-checks against the canonical games dir; and a file
 * that can never be replayed at all (GAXG, HDGG — no recorded trio) used to
 * reach the CLI as an uncaught throw and be counted as a divergence.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, existsSync, mkdtempSync, readFileSync as readFile, rmSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { Action, CardName, Element, EngineEvent, GameMode, Seat } from '../engine/src/types.ts';
import { apply, checkDeck, createGame, sanitizeTrio, IllegalAction } from '../engine/src/apply.ts';
// R216 — a scenario room's board is part of its DEAL, not of its log. This
// file is the second of the four deal sites scenarios.ts's header lists, and
// it is the one that matters most: without this import the R200 divergence
// diff would report every scenario game as diverging from action 0, which is
// the exact failure mode R200 exists to remove.
import { dealScenario } from './scenarios.ts';
import { UNKNOWN_VERSION, isEngineVersion, repoDir } from './engine-version.ts';
import { digest, probe, type ProbeRefusal } from './replay-probe.ts';

/**
 * `Fork` / `LostAction` are the shapes `server/rooms.ts` WRITES into a saved
 * game. Until R181 they were restated here, structurally, because `rooms.ts`
 * pulls in `ws` and the whole socket layer and importing even a TYPE from it
 * dragged that into any project checking this analysis — engine/test/143
 * imports this file, and its `tsc` went from clean to 7 errors.
 *
 * The restatement was rot-prone in the one way that matters: a RENAME in
 * `rooms.ts` would leave this file compiling happily against a field the disk
 * no longer carries, the fork block below would stop printing, and
 * `unexplained` would go quietly empty — the opposite of loud. So the shapes
 * moved to `./types.ts`, which imports only engine types, declares no values,
 * and therefore can never pull `ws` in. Both sides now name the same interface
 * and a rename is a compile error on both.
 *
 * This file still reads every field defensively: its input is a FILE, and an
 * old one may predate any of them.
 */
import type { Fork, LostAction, VersionStamp } from './types.ts';

/** the shape a game file has to have for this tool to say anything about it */
export interface RoomFile {
  seed: number; mode?: GameMode; els?: Element[]; names?: [string, string]; actions: Action[];
  winner?: number | null; forks?: Fork[];
  decks?: [CardName[] | null, CardName[] | null];
  /** R200: which engine recorded which stretch of this log. Absent in every
   * file written before R200 — see versionsOf(). */
  versions?: VersionStamp[];
  /** R216: the scenario this room was dealt with. Absent on every ordinary
   * game; present means the deal was not a plain `createGame`. */
  scenario?: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * One logged action the current engine refused, plus the two facts that make
 * a cascade provable rather than assumed:
 *   `pending`  the decision standing when it was refused (JSON, or null).
 *              Two refusals under the SAME standing decision are one wedge.
 *   `unanswerable`  the engine said this answer can never be accepted at all
 *              (`IllegalAction.unanswerable`), not merely that it is wrong
 *              right now. That is a divergence with no way back.
 */
export interface Refusal extends LostAction {
  pending: string | null;
  unanswerable: boolean;
}

export interface Analysis {
  events: EngineEvent[];
  state: ReturnType<typeof createGame>['state'];
  refusals: Refusal[];
  /** refusals the file's own `forks` block already accounts for */
  declaredLost: LostAction[];
  /** declared forks this engine can no longer reproduce */
  unexplained: number[];
  /** refusals beyond what the file admits to */
  extra: Refusal[];
  /** the FIRST refusal this file does not already declare — the divergence
   * point. Null means the replay never diverged. */
  divergedAt: Refusal | null;
  /** the consecutive refusals immediately after `divergedAt` that stand under
   * the very same unanswered decision. Cascade, provably. */
  cascade: Refusal[];
  /** true when `cascade` runs to the end of the log (or to the point the game
   * ended): from `divergedAt` on, nothing either seat logged was ever legal
   * again. A total replay loss. */
  wedged: boolean;
  /** the first index after the cascade that DID replay, if any */
  resumedAt: number | null;
}

const CLI = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

/** constructed games are dealt from the two saved decks — replaying one
 * without them is not a replay of the same game at all */
/**
 * The two constructed decks, or `undefined` for a non-constructed game.
 *
 * ⚠ THIS USED TO SUBSTITUTE ONE SEAT'S DECK FOR THE OTHER'S, SILENTLY. The old
 * body was `const a = ok[0].ok ? ok[0].cards : ok[1].ok ? ok[1].cards : null`
 * — so a deck that failed `checkDeck` was replaced by the OPPONENT'S, with no
 * warning, and the tool went on to replay a game nobody had ever played. It
 * threw only when BOTH decks were bad.
 *
 * That is the worst possible failure for a forensics tool: this repo settles
 * playtest reports by replaying saved games, so a quietly-wrong deck produces a
 * confident wrong answer about a real bug. And it was one rename away from
 * firing — `checkDeck` rejects unknown card names, and commit 3063f2b renamed
 * "Counter Theif" to "Counter Thief". Any stored deck holding the old spelling
 * would have made all eight constructed logs replay with BOTH SEATS ON ONE
 * DECK, reported not as "this file's deck no longer validates" but as a mystery
 * divergence somewhere in the midgame. (All eight validate at HEAD today, so
 * this was a live hazard rather than a live bug.)
 *
 * Now it names the seat and the reason and refuses. A replay that cannot be
 * trusted must not run.
 */
function decksOf(raw: RoomFile, mode: GameMode): [CardName[], CardName[]] | undefined {
  if (mode !== 'constructed') return undefined;
  const checked = [0, 1].map(s => checkDeck(raw.decks?.[s as 0 | 1]));
  const bad = checked
    .map((c, s) => (c.ok ? null : `seat ${s}: ${c.error}`))
    .filter((m): m is string => m !== null);
  if (bad.length) {
    throw new Error(
      `constructed game file has an unusable deck, so it cannot be replayed:\n  ${bad.join('\n  ')}\n`
      + '  (Refusing rather than substituting the other seat\'s deck — a replay of the wrong\n'
      + '   game is worse than no replay, because it answers confidently.)');
  }
  return [(checked[0] as { cards: CardName[] }).cards, (checked[1] as { cards: CardName[] }).cards];
}

/**
 * The recorded element trio, refusing the silent default.
 *
 * `sanitizeTrio(undefined)` returns `DRAFT_TRIO`, which is right for STARTING a
 * game and wrong for replaying one: a draft file with no recorded trio gets a
 * completely different deal, and the tool reports the result as engine drift.
 * Two files in the corpus are like this (GAXG and HDGG, both saved before
 * a890788 "Live draft: choose the three elements together"), and GAXG dies at
 * action [10] with "not an element of this game" — a message that blames the
 * engine for a missing field.
 */
function trioOf(raw: RoomFile, mode: GameMode): Element[] {
  if (mode === 'draft' && !Array.isArray(raw.els)) {
    throw new Error(
      'this draft game recorded no element trio (`els` is absent), so its deal cannot be\n'
      + '  reproduced — sanitizeTrio would substitute the default and replay a different game.\n'
      + '  Files saved before the live-draft change (a890788) are in this state and are\n'
      + '  permanently unreplayable; they are not evidence about anything.');
  }
  return sanitizeTrio(raw.els);
}

/* ══ R200 §1 — PERMANENTLY UNREPLAYABLE IS NOT A DIVERGENCE ═══════════
 *
 * `trioOf` and `decksOf` above THROW on a file whose deal cannot be
 * reproduced, which is right — a replay that cannot be trusted must not run.
 * But a throw out of `analyze()` reached the CLI as an uncaught exception: a
 * stack trace, exit code 1, and nothing a sweep over the corpus could tell
 * apart from the tool crashing.
 *
 * So these two files got COUNTED. "20 of 22 games diverge" includes GAXG and
 * HDGG, which do not diverge and never will: they were saved before a890788
 * recorded the element trio, so there is no fact anywhere about what deal they
 * were played from. They are not evidence about the engine, they are not
 * evidence about a regression, and every sweep that counts them makes the
 * corpus look worse than it is by two whole games.
 *
 * Detected STRUCTURALLY (the field is absent) rather than from a list of
 * codes, so a third such file classifies itself. The two known ones are named
 * in the message because "which games are these?" is the next question anybody
 * asks.
 */
export function unreplayableReason(raw: RoomFile): string | null {
  const mode = raw.mode ?? 'shared';
  if (mode === 'draft' && !Array.isArray(raw.els)) {
    return 'no recorded element trio (`els` is absent), so the deal cannot be reproduced.\n'
      + '    Saved before a890788 "Live draft: choose the three elements together". The two\n'
      + '    files in this state are GAXG and HDGG. They are PERMANENTLY unreplayable and\n'
      + '    must not be counted as divergences: nothing about the engine can be inferred\n'
      + '    from them, then or now.';
  }
  if (mode === 'constructed') {
    const bad = [0, 1]
      .map(s => ({ s, c: checkDeck(raw.decks?.[s as 0 | 1]) }))
      .filter(x => !x.c.ok);
    if (bad.length === 2) {
      return `neither seat's deck validates (${bad.map(b => `seat ${b.s}: ${(b.c as { error: string }).error}`).join('; ')}),\n`
        + '    so there is no deal to reproduce.';
    }
  }
  return null;
}

/* ══ R200 §2 — WHICH ENGINE RECORDED WHICH STRETCH ════════════════════ */

/** One stretch of the log and the engine it was recorded against. */
export interface VersionSegment { from: number; to: number; sha: string }

export interface VersionInfo {
  stamps: VersionStamp[];
  segments: VersionSegment[];
  /** the SHA `--as-recorded` should replay at, or null with `why` */
  reference: string | null;
  why: string | null;
  /** a fork whose own `engineVersion` disagrees with the stamp covering it */
  inconsistent: string[];
}

/**
 * Read the file's version ledger, and work out which commit a faithful replay
 * of it belongs at.
 *
 * ⚠ THE REFERENCE IS THE **LAST** STAMP, NOT THE FIRST, and that is not
 * obvious. A forked file was rebuilt from action 0 by the LAST engine to
 * restore it — that rebuild is the board the players were actually sitting in
 * when they played the tail, and it is the run the file is a record of.
 * Replaying the whole log at the FIRST stamp would reproduce the game as it
 * was before the fork, which is a real game but not the one this file ends
 * with.
 *
 * The segments are still reported in full, because a file spanning three
 * engines is a fact about the file that the reader has to be told before they
 * trust any single-commit replay of it.
 */
export function versionsOf(raw: RoomFile): VersionInfo {
  const stamps: VersionStamp[] = (Array.isArray(raw.versions) ? raw.versions : [])
    .filter(v => v && typeof v.sha === 'string' && typeof v.from === 'number');
  const n = raw.actions.length;
  const segments = stamps.map((v, i) => ({
    from: v.from, to: (stamps[i + 1]?.from ?? n), sha: v.sha,
  }));
  const last = stamps[stamps.length - 1];

  // a fork restates the SHA that refused its actions; the stamp covering that
  // point must agree, or one of the two has been edited
  const inconsistent: string[] = [];
  for (const f of Array.isArray(raw.forks) ? raw.forks : []) {
    if (!f.engineVersion) continue;
    // ⚠ THE BOUNDARY IS SHARED. `recordFork` and the version stamp are written
    // by the SAME restore, so a fork's `logged` and its stamp's `from` are the
    // same number — and that number is the START of the new engine's stretch,
    // not the end of the old one's. Matching on `from <= logged <= to` picks
    // the segment that just ENDED and calls every honest pair a contradiction.
    const seg = segments.find(g => g.from === f.logged)
      ?? segments.find(g => f.logged >= g.from && f.logged < g.to)
      ?? segments[segments.length - 1];
    if (seg && seg.sha !== f.engineVersion) {
      inconsistent.push(`fork at ${f.at} names ${f.engineVersion.slice(0, 10)} but the stamp covering `
        + `action ${f.logged} names ${seg.sha.slice(0, 10)}`);
    }
  }

  let reference: string | null = null;
  let why: string | null = null;
  if (!last) {
    why = 'this file carries no `versions` stamp at all. Every game recorded before R200 is\n'
      + '    in this state, and versioning cannot reach back: the commit it was played on was\n'
      + '    never written down. Pass --at <sha> if you know it from elsewhere (a deploy log,\n'
      + '    the file mtime against `git log`), or accept that this file is only ever\n'
      + '    replayable against HEAD.';
  } else if (last.sha === UNKNOWN_VERSION || !isEngineVersion(last.sha)) {
    why = `the last stamp says "${last.sha}", which is not a commit. The recording server could\n`
      + '    not consult git (a tarball deploy, no .git). Pass --at <sha> if you know it.';
  } else {
    reference = last.sha;
  }
  return { stamps, segments, reference, why, inconsistent };
}

/* ══ R200 §3 — A STALE COPY DOES NOT ERROR, IT REASSURES ══════════════
 *
 * A truncated 104-action copy of a 375-action game replayed "✓ FAITHFUL"
 * three times over several hours, because it stopped before the interesting
 * part. Nothing was wrong with the copy: it is a valid prefix of a valid game
 * and it is internally consistent, so no check INSIDE the file can ever catch
 * it. The only thing that can is the file it was copied from.
 *
 * So: if a game with this basename exists in the canonical games directory and
 * is not the same file, compare them and say so. A shorter copy is REFUSED
 * outright — it is the exact failure above, and the whole cost of that failure
 * was that the tool answered confidently.
 *
 * When there is no canonical copy to check against (someone's scratch dir on a
 * laptop, which is most uses) the tool says THAT, rather than staying silent
 * and letting "no warning" read as "verified".
 */
export interface SourceCheck { verdict: 'same' | 'stale' | 'differs' | 'unchecked'; note: string }

export function crossCheck(file: string, raw: RoomFile): SourceCheck {
  const canonDir = process.env['ALGO_GAMES_DIR'] ?? join(HERE, 'games');
  const canon = join(canonDir, basename(file));
  let sameFile = false;
  try { sameFile = resolve(canon) === resolve(file) || statSync(canon).ino === statSync(file).ino; } catch { /* no canon */ }
  if (sameFile) {
    return { verdict: 'same', note: `this IS the canonical file (${canon})` };
  }
  if (!existsSync(canon)) {
    return {
      verdict: 'unchecked',
      note: `no canonical copy at ${canon}, so this file's freshness could NOT be checked.\n`
        + '    A stale copy of a game replays perfectly and says nothing — it just stops early.\n'
        + '    Re-fetch from the server before trusting a verdict drawn from it.',
    };
  }
  let there: RoomFile;
  try { there = JSON.parse(readFile(canon, 'utf8')) as RoomFile; } catch (err) {
    return { verdict: 'unchecked', note: `canonical copy at ${canon} would not parse: ${err instanceof Error ? err.message : err}` };
  }
  const mine = raw.actions.length;
  const theirs = Array.isArray(there.actions) ? there.actions.length : 0;
  if (theirs > mine) {
    return {
      verdict: 'stale',
      note: `STALE COPY. This file has ${mine} actions; the canonical ${canon} has ${theirs}.\n`
        + `    You are replaying the first ${mine} actions of a ${theirs}-action game, and a prefix\n`
        + '    replays clean right up to wherever it was cut — which is how a truncated copy of a\n'
        + '    375-action game reported "✓ FAITHFUL" three times running. Re-fetch and re-run.',
    };
  }
  if (JSON.stringify(there.actions) !== JSON.stringify(raw.actions)) {
    return {
      verdict: 'differs',
      note: `this copy has ${mine} actions and the canonical ${canon} has ${theirs}, and the logs\n`
        + '    are not the same. One of them is not the game you think it is.',
    };
  }
  return { verdict: 'same', note: `action log matches the canonical ${canon} (${mine} actions)` };
}

/* ══ R200 §4 — THE DELTA BETWEEN TWO ENGINES ══════════════════════════
 *
 * The thing the tool could not do. One replay can only report a REFUSAL, and a
 * refusal is an upper bound on the divergence: the rules move at action [k],
 * the action still applies but now means something else, the boards drift in
 * silence, and several actions later something finally becomes illegal. The
 * refusal index is measured LATE — by up to six actions in every case anyone
 * has checked by hand — so "fix [121] and re-run" sends you to the wrong
 * action.
 *
 * With the recorded commit in the file, there IS something to diff against.
 * Check that commit out into a throwaway detached worktree, run the same probe
 * there, and compare the per-action board signatures. The first index where
 * they disagree is the divergence, and printing the two signatures side by
 * side says WHAT changed rather than merely that something did.
 */
export interface Delta {
  sha: string;
  ok: boolean;
  error: string | null;
  /** index into the signature array (0 = the deal) where the two engines first
   * disagree AT ALL; null = they agree the whole way through */
  firstDiff: number | null;
  /**
   * The index they never agree again after — the last index at which the two
   * boards match, plus one. **This is the finding**, and it is not the same
   * number as `firstDiff`.
   *
   * Measured, not assumed. SMVJ's two engines disagree from signature 100
   * (a stale `passes` counter the newer engine zeroes) and then AGREE AGAIN
   * from 112 to 120 before parting for good at 121. Leading with 100 would
   * have sent an investigation to action [99] — a benign bookkeeping change,
   * twenty-one actions upstream of the thing that actually broke the game.
   *
   * A difference that HEALS is a rules change the log survived; a difference
   * that STICKS is the one that cost the replay. Both are worth printing.
   * Only the second is the divergence.
   */
  partedAt: number | null;
  /** the ACTION that parted them (-1 means the DEAL itself already differs) */
  atAction: number | null;
  /** runs of indices that differed and then reconverged: [from, to] inclusive */
  healed: [number, number][];
  refSig: string | null;
  headSig: string | null;
  /** the signature pair at `firstDiff`, when that is not `partedAt` */
  refSigFirst: string | null;
  headSigFirst: string | null;
  refRefusals: ProbeRefusal[];
  headRefusals: ProbeRefusal[];
}

/**
 * Check `sha` out into a throwaway detached worktree, run `fn` against it, and
 * take it down again.
 *
 * ⚠ THE REMOVAL IS SCOPED TO THE EXACT PATH THIS FUNCTION CREATED. Fifteen
 * agents and several other sessions keep long-lived worktrees of this repo;
 * anything wider than an exact-path remove — a prune, a glob, a `worktree
 * remove` on a name — is a real hazard that has already destroyed somebody's
 * work once.
 */
function withWorktree<T>(sha: string, fn: (dir: string) => T): T {
  const repo = repoDir();
  try {
    execFileSync('git', ['-C', repo, 'rev-parse', '--verify', `${sha}^{commit}`],
      { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch {
    throw new Error(`this repo has no commit ${sha}. The file names an engine this checkout\n`
      + '  cannot reach — fetch it, or replay against HEAD only.');
  }
  const dir = mkdtempSync(join(tmpdir(), `algo-asrecorded-${sha.slice(0, 8)}-`));
  // mkdtemp already created it; `git worktree add` insists on making its own
  rmSync(dir, { recursive: true, force: true });
  execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', dir, sha],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    return fn(dir);
  } finally {
    try {
      execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', dir],
        { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch { /* fall through to the directory removal */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Replay this file at the engine it was recorded against, and diff.
 *
 * The probe is COPIED INTO the old worktree rather than run from HEAD. That is
 * the whole trick: `replay-probe.ts` imports `../engine/src/apply.ts` by
 * relative path, so the copy that lands in the checkout of commit X binds to
 * commit X's engine, while the identical file here binds to HEAD's. Same
 * signature code on both ends — which is required, because a diff between two
 * different signature functions measures the functions, not the engines.
 */
export async function delta(file: string, raw: RoomFile, sha: string): Promise<Delta> {
  const here = await probe(raw as never);
  const blank: Delta = {
    sha, ok: false, error: null, firstDiff: null, partedAt: null, atAction: null,
    healed: [], refSig: null, headSig: null, refSigFirst: null, headSigFirst: null,
    refRefusals: [], headRefusals: here.refusals,
  };
  const probeSrc = join(HERE, 'replay-probe.ts');
  type Found = {
    first: number | null; parted: number | null; healed: [number, number][];
    refSig: string | null; refSigFirst: string | null; refusals: ProbeRefusal[];
  };
  type Ref = { fail: string } | Found;
  const out = withWorktree<Ref>(sha, (dir): Ref => {
    /* ⚠ THE CLIENT DIRECTORY HAS BEEN CALLED TWO THINGS, AND THIS TOOL READS
     * HISTORY. It was `digital-client/` until the 2026-08-30 reorg and `client/`
     * after, so a commit older than that has the old name and always will —
     * renaming a directory does not rewrite the commits that used it. Probing
     * only the current name silently reduces this tool's reach to "engines
     * newer than the rename", which is the opposite of what it is for: the
     * whole point is replaying a game at an engine OLD enough to have drifted.
     * Try both, newest name first. */
    const dest = ['client', 'digital-client']
      .map(d => join(dir, d, 'server', 'replay-probe.ts'))
      .find(c => existsSync(dirname(c)));
    if (dest === undefined) {
      return { fail: `commit ${sha.slice(0, 10)} has neither client/server/ nor digital-client/server/` };
    }
    copyFileSync(probeSrc, dest);
    const run = (args: string[]): { code: number | null; json: unknown; err: string } => {
      const r = spawnSync(process.execPath, [dest, resolve(file), ...args],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      let json: unknown = null;
      try { json = JSON.parse(r.stdout ?? ''); } catch { /* reported below */ }
      return { code: r.status, json, err: (r.stderr ?? '').trim() };
    };
    const first = run([]);
    if (!first.json) {
      return { fail: `the probe would not run at ${sha.slice(0, 10)}: ${first.err.split('\n').slice(-3).join(' ') || 'no output'}` };
    }
    const p = first.json as { ok: boolean; error?: string; hashes: string[]; refusals: ProbeRefusal[] };
    if (!p.ok) return { fail: `that engine cannot build this game: ${p.error ?? 'unknown'}` };

    const mine = here.sigs.map(digest);
    const n = Math.min(mine.length, p.hashes.length);
    const same = (i: number): boolean => mine[i] === p.hashes[i];

    let firstDiffAt: number | null = null;
    let lastAgree = -1;
    for (let i = 0; i < n; i++) {
      if (same(i)) lastAgree = i;
      else if (firstDiffAt === null) firstDiffAt = i;
    }
    if (firstDiffAt === null && mine.length !== p.hashes.length) firstDiffAt = n;
    // they part for good after the last index they still agree on. When they
    // agree right to the end there is no parting, whatever happened in between.
    const parted = lastAgree === n - 1 ? null : Math.max(lastAgree + 1, firstDiffAt ?? 0);

    // every run that differed and then came BACK — the changes this log
    // absorbed rather than the one that ended it
    const healed: [number, number][] = [];
    let runStart = -1;
    for (let i = 0; i < n; i++) {
      if (!same(i)) { if (runStart < 0) runStart = i; continue; }
      if (runStart >= 0) { healed.push([runStart, i - 1]); runStart = -1; }
    }

    const sigAt = (i: number | null): string | null => {
      if (i === null || i >= p.hashes.length) return null;
      const q = run(['--at', String(i)]).json as { sig?: string } | null;
      return q?.sig ?? null;
    };
    return {
      first: firstDiffAt, parted, healed,
      refSig: sigAt(parted),
      refSigFirst: firstDiffAt !== null && firstDiffAt !== parted ? sigAt(firstDiffAt) : null,
      refusals: p.refusals,
    };
  });

  if ('fail' in out) return { ...blank, error: out.fail };
  return {
    ...blank, ok: true,
    firstDiff: out.first,
    partedAt: out.parted,
    atAction: out.parted === null ? null : out.parted - 1,
    healed: out.healed,
    refSig: out.refSig,
    headSig: out.parted === null ? null : (here.sigs[out.parted] ?? null),
    refSigFirst: out.refSigFirst,
    headSigFirst: out.first !== null && out.first !== out.parted ? (here.sigs[out.first] ?? null) : null,
    refRefusals: out.refusals,
  };
}

function runOnce(raw: RoomFile): Pick<Analysis, 'events' | 'state' | 'refusals'> {
  const names = raw.names ?? ['Player 1', 'Player 2'];
  const mode = raw.mode ?? 'shared';
  let { state, events } = dealScenario(raw.seed, names, mode, trioOf(raw, mode), decksOf(raw, mode), raw.scenario);
  const all = [...events];
  const refusals: Refusal[] = [];
  raw.actions.forEach((a, i) => {
    try {
      const r = apply(state, a);
      state = r.state;
      all.push(...r.events);
    } catch (err) {
      if (!(err instanceof IllegalAction)) throw err;
      // `apply` is pure over a clone, so `state` is untouched by a refusal —
      // the decision recorded here is the one that was standing at the time,
      // which is exactly what makes the cascade test below sound.
      refusals.push({
        i, type: a.type, seat: a.seat as Seat, why: err.message,
        pending: state.decision ? JSON.stringify(state.decision) : null,
        unanswerable: err.unanswerable === true,
      });
    }
  });
  return { events: all, state, refusals };
}

/**
 * Replay the file and work out WHERE it stopped being a replay.
 *
 * The cascade test is deliberately structural rather than message-matching: a
 * refusal counts as cascade when the decision standing over it is byte-for-byte
 * the decision that was standing when the divergence happened. Nothing has
 * answered it in between, so the engine is not being asked a new question — it
 * is being asked the same one again, and its refusal carries no new
 * information. That catches a wedge from ANY cause, including ones that do not
 * exist yet, where matching on "a decision is pending for X" would not.
 */
export function analyze(raw: RoomFile): Analysis {
  const a = runOnce(raw);
  const declared: Fork[] = Array.isArray(raw.forks) ? raw.forks : [];
  const declaredLost = declared.flatMap(f => f.lost ?? []);
  // R191: a fork's list is no longer all refusals. A `kind: 'changed'` entry
  // says the OPPOSITE of a refusal — that action replayed fine and came to
  // mean something else — so it must not join `declaredIdx`, which exists to
  // answer "the file says this index does not replay". Counting one there
  // would make every drifted action `unexplained` (this engine accepts it, as
  // the file already said it would) and exit 3 on a file that is telling the
  // exact truth.
  const declaredIdx = new Set(declaredLost.filter(l => l.kind !== 'changed').map(l => l.i));
  const todayIdx = new Set(a.refusals.map(l => l.i));
  const unexplained = [...declaredIdx].filter(i => !todayIdx.has(i));
  const extra = a.refusals.filter(l => !declaredIdx.has(l.i));

  const divergedAt = extra[0] ?? null;
  const byIndex = new Map(a.refusals.map(r => [r.i, r]));
  const cascade: Refusal[] = [];
  if (divergedAt && divergedAt.pending !== null) {
    for (let i = divergedAt.i + 1; i < raw.actions.length; i++) {
      const r = byIndex.get(i);
      if (!r || r.pending !== divergedAt.pending) break;
      cascade.push(r);
    }
  }
  const after = divergedAt ? divergedAt.i + 1 + cascade.length : raw.actions.length;
  const resumedAt = divergedAt && after < raw.actions.length ? after : null;
  // a wedge that runs to the last logged action, or to the one action that can
  // always end a game under an open question (R65: concede is exempt from the
  // decision gate on purpose), is a total loss of the rest of the log
  const wedged = cascade.length > 0
    && (resumedAt === null || raw.actions[resumedAt]!.type === 'concede');

  return { ...a, declaredLost, unexplained, extra, divergedAt, cascade, wedged, resumedAt };
}

/** the report, as lines. Exported so a test can read what the tool SAYS,
 * not merely what it computes — the misreading CT-45 is about happened in
 * the prose, not in the numbers. */
export function reportLines(file: string, raw: RoomFile, an: Analysis, opts: {
  showLog?: boolean; deterministic?: boolean;
  /** R200: what the canonical copy of this game says about this one */
  source?: SourceCheck;
  /** R200: which engine recorded which stretch */
  versions?: VersionInfo;
  /** R200: the diff against the engine this game was recorded on */
  delta?: Delta;
} = {}): { lines: string[]; exit: number } {
  const out: string[] = [];
  const say = (s: string): void => { out.push(s); };
  const names = raw.names ?? ['Player 1', 'Player 2'];
  const mode = raw.mode ?? 'shared';
  const els = sanitizeTrio(raw.els);
  const n = raw.actions.length;
  const d = an.divergedAt;

  say(`\n═ ${file}`);
  say(`  mode ${mode}${mode === 'draft' ? ` · trio ${els.join('+')}` : ''} · seed ${raw.seed} · ${names.join(' vs ')}`);
  // CT-45: the count NEVER stands on its own line. Whatever else this says, it
  // says on the same breath whether the replay is still a replay.
  say(`  ${n} actions logged · ${n - an.refusals.length} replayed · ${an.refusals.length} refused`
    + (d
      ? `\n  ⛔ DIVERGES at action [${d.i}]`
        + (an.cascade.length
          ? ` — everything after it is CASCADE, and ${an.cascade.length} of those`
            + `\n     refusal${an.cascade.length === 1 ? ' is' : 's are'} that one failure wearing `
            + `${an.cascade.length === 1 ? 'a second hat' : 'many hats'}. Read the verdict, not the count.`
          : ' — everything after it is CASCADE, not separate\n     findings. Read the verdict, not the count.')
      : an.refusals.length
        ? '\n  (every refusal is a fork this file declares — see below)'
        : '\n  ✓ no divergence'));
  if (opts.deterministic !== undefined) {
    say(`  determinism: ${opts.deterministic ? 'OK (two runs identical)' : '⚠ DIVERGED — engine bug, report this'}`);
  }

  // ── R200: is this even the right copy of the file? ───────────────────
  // Printed HIGH, before anything anyone might act on. A stale copy makes
  // every line below it a confident statement about a game that is not the
  // one being investigated, and the whole cost of that failure last time was
  // that nothing looked wrong.
  if (opts.source) {
    const mark = opts.source.verdict === 'same' ? '✓'
      : opts.source.verdict === 'unchecked' ? '·' : '⛔';
    say(`  ${mark} source: ${opts.source.note}`);
  }

  // ── R200: which engine recorded this, and can we go and get it? ──────
  if (opts.versions) {
    const v = opts.versions;
    if (!v.stamps.length) {
      say('  · engine: UNSTAMPED — this file does not say what engine recorded it.');
    } else {
      say(`  · engine: ${v.segments.map(g => `[${g.from}..${g.to}) ${g.sha.slice(0, 10)}`).join('  ')}`
        + (v.segments.length > 1
          ? `\n    (${v.segments.length} engines — this file is ${v.segments.length} games end to end, `
            + 'and no single commit replays all of it)'
          : ''));
    }
    for (const bad of v.inconsistent) say(`  ⛔ INCONSISTENT STAMPS: ${bad}`);
  }

  if (opts.showLog) {
    say('\n── game log ──');
    for (const ev of an.events) say('  ' + ev.msg);
  }

  const s = an.state;
  say('\n── final position ──');
  if (d) {
    say(`  ⚠ NOT the position the logged game reached — the replay left that`);
    say(`    board at action [${d.i}]. This is where THIS run ended up.`);
  }
  say(`  turn ${s.turn} · phase ${s.phase}${s.winner !== null ? ` · WINNER: ${names[s.winner]}` : ''}`);
  s.players.forEach(p => say(
    `  ${p.name}: ${p.life} life · ${p.hand.length} in hand · ${p.bin.length} in bin · ${p.resources.length} resources`));
  const units = Object.values(s.entities).filter(e => e.kind === 'unit');
  say(`  units in play: ${units.map(u => `${u.card} (${names[u.controller]})`).join(', ') || 'none'}`);

  // ── what the file says about itself ──────────────────────────────────
  const declared: Fork[] = Array.isArray(raw.forks) ? raw.forks : [];
  if (declared.length) {
    say('\n── this file declares that it FORKED ──');
    say('  The server restarted mid-game onto an engine that could not replay');
    say('  part of the log, rebuilt the game without those actions, and play');
    say('  continued from there. The log below is not one game end to end.');
    for (const f of declared) {
      say(`  · ${f.at}: ${f.lost.length} of ${f.logged} actions could not be replayed;`);
      say(`      the game resumed at turn ${f.turn} ${f.phase}`);
      const byType = new Map<string, number>();
      for (const l of f.lost) byType.set(l.type, (byType.get(l.type) ?? 0) + 1);
      say(`      lost: ${[...byType].map(([t, k]) => `${k}× ${t}`).join(', ')}`);
      say(`      first at action ${f.lost[0]?.i} — "${f.lost[0]?.why}"`);
    }
  }

  // ── R200: the DELTA — the only thing that can name the real divergence ──
  //
  // Printed BEFORE the verdict, and it outranks it. The verdict below is built
  // from refusals, and a refusal is an upper bound: it is where the engine
  // finally noticed, not where the rules moved. When there is a reference
  // engine to diff against, the diff is the finding and the refusal is a
  // symptom of it.
  if (opts.delta) {
    const dl = opts.delta;
    say('\n── as recorded ──');
    say(`  reference engine: ${dl.sha.slice(0, 10)}`);
    if (!dl.ok) {
      say(`  ⛔ could not replay there — ${dl.error}`);
      say('    Without a reference engine this report can only name the first REFUSAL,');
      say('    which is an UPPER BOUND on the divergence and nothing more.');
    } else if (dl.firstDiff === null) {
      say('  ✓ IDENTICAL. Every board in this log is byte-for-byte the same on the');
      say('    engine that recorded it and on HEAD. Nothing between those two commits');
      say('    changed anything this game touches.');
      if (an.refusals.length) {
        say(`    ⚠ …and yet ${an.refusals.length} action(s) were refused. Two engines agreeing on every`);
        say('      board while one of them refuses actions is not a rules change — check the');
        say('      file for hand edits before reading anything else here.');
      }
    } else {
      /**
       * The two signature texts, as a line-by-line -/+.
       *
       * A signature line listing everything in play runs past 900 characters,
       * and printing both copies of it to show that ONE unit changed hands
       * buries the finding in its own evidence. So a long line made of ` | `
       * parts is diffed as a SET: only the parts that actually differ are
       * printed. Whole-line for everything else, because a short line is its
       * own best diff.
       */
      const sideBySide = (refSig: string | null, headSig: string | null, label: string): void => {
        if (!refSig || !headSig) return;
        const a = refSig.split('\n');
        const b = headSig.split('\n');
        say(`    ── what changed${label} (recorded → HEAD) ──`);
        let shown = 0;
        for (let i = 0; i < Math.max(a.length, b.length) && shown < 8; i++) {
          const x = a[i] ?? '(absent)';
          const y = b[i] ?? '(absent)';
          if (x === y) continue;
          shown++;
          if (x.length > 160 && x.includes(' | ') && y.includes(' | ')) {
            const xs = x.trim().split(' | ');
            const ys = y.trim().split(' | ');
            const gone = xs.filter(t => !ys.includes(t));
            const came = ys.filter(t => !xs.includes(t));
            for (const t of gone.slice(0, 4)) say(`      - ${t}`);
            for (const t of came.slice(0, 4)) say(`      + ${t}`);
            if (!gone.length && !came.length) say('      (same contents, different order)');
            continue;
          }
          say(`      - ${x.trim()}`);
          say(`      + ${y.trim()}`);
        }
        if (!shown) say('      (the two signatures differ only in whitespace — report this)');
      };

      // ⚠ THE FIRST DIFFERENCE IS NOT THE FINDING EITHER. Some rules changes
      // move a board and the log then absorbs them — the two runs come back
      // together a few actions later and the game carries on. What ends a
      // replay is the difference that STICKS, and the two are routinely tens
      // of actions apart. Leading with the first one would have replaced a
      // divergence point that is measured LATE with one that is measured
      // EARLY, which is not an improvement.
      if (dl.healed.length) {
        say(`  · ${dl.healed.length} earlier difference(s) HEALED — the two engines parted and came back:`);
        for (const [from, to] of dl.healed.slice(0, 4)) {
          // signature index i is the board AFTER action i-1, so index 0 is the
          // DEAL and has no action to name
          say(`      ${from === 0 ? 'the DEAL and actions [0..' + (to - 1) + ']' : `actions [${from - 1}..${to - 1}]`}`
            + ` differed, then agreed again at [${to - 1}]`);
        }
        if (dl.healed.length > 4) say(`      … and ${dl.healed.length - 4} more`);
        say('    These are rules changes this log SURVIVED. They are not what broke it, and');
        say('    an investigation that starts at the first one starts in the wrong place.');
        if (dl.refSigFirst) sideBySide(dl.refSigFirst, dl.headSigFirst, ' at the FIRST (healed) difference');
      }

      if (dl.partedAt === null) {
        say('  ✓ AND THEY END IN THE SAME PLACE. Every difference above healed; the final');
        say('    board is identical on both engines. This log survived every rules change');
        say('    between those two commits.');
      } else {
        const k = dl.atAction!;
        say(`  ⛔ THE BOARDS PART FOR GOOD AT ACTION [${k < 0 ? 'the DEAL' : k}] — and never agree again.`);
        if (k < 0) {
          say('    The two engines disagree before a single logged action has run: the DEAL');
          say('    itself is different. Nothing in the log is comparable — this is a change to');
          say('    the deck, the shuffle or the opening, and every later difference follows.');
        }
        if (an.divergedAt) {
          const late = an.divergedAt.i - k;
          say(`    The first REFUSAL is at [${an.divergedAt.i}]${late > 0 ? `, ${late} action(s) LATER` : ''}.`
            + (late > 0 ? ' That number is a symptom.' : ''));
          if (late > 0) {
            say(`    Action [${k}] still applied — legally — and meant something else. The boards`);
            say(`    drifted apart in silence for ${late} action(s) before the engine noticed. Fixing`);
            say(`    [${an.divergedAt.i}] would have told you nothing.`);
          }
        } else {
          say('    Nothing in this log was refused at HEAD, so a one-sided replay would have');
          say('    reported it ✓ FAITHFUL. It is not: the boards differ, quietly, from here on.');
        }
        sideBySide(dl.refSig, dl.headSig, ' where they part');
      }
      // ⚠ IS THIS EVEN THE RIGHT REFERENCE? A file replayed at the engine that
      // recorded it should be refused NOTHING beyond the losses it already
      // declares — that is what "recorded against" means. Refusals on the
      // reference side are therefore evidence about the SHA, not about the
      // rules, and saying so is the difference between "the rules changed at
      // [135]" and "you pointed --at at the wrong commit".
      if (dl.refRefusals.length) {
        const declaredIdx = new Set(an.declaredLost.map(l => l.i));
        const undeclared = dl.refRefusals.filter(r => !declaredIdx.has(r.i));
        if (undeclared.length) {
          say(`    ⚠ THE REFERENCE ENGINE REFUSED ${undeclared.length} OF THESE ACTIONS TOO (first at `
            + `[${undeclared[0]!.i}]).`);
          say('      A log replayed on the engine that recorded it refuses nothing it does not');
          say(`      already declare. So ${dl.sha.slice(0, 10)} is probably NOT that engine — either --at`);
          say('      names the wrong commit, or the file\'s own stamp is wrong. Everything above');
          say('      is a diff between two engines, but not between THEN and NOW.');
        } else {
          say(`    For reference: the recording engine refused ${dl.refRefusals.length} action(s) as well,`);
          say('    every one of them a loss this file already declares. Consistent.');
        }
      }
    }
  }

  // ── the verdict ──────────────────────────────────────────────────────
  say('\n── verdict ──');

  function listRefusals(list: Refusal[], limit = 20): void {
    for (const sk of list.slice(0, limit)) {
      const tag = d && sk.i > d.i ? '  (cascade)' : '';
      say(`  [${sk.i}] ${sk.type} (seat ${sk.seat})${tag}\n      → ${sk.why}`);
    }
    if (list.length > limit) say(`  … and ${list.length - limit} more`);
  }

  /** the block CT-45 exists to make impossible to skim past */
  function divergence(dv: Refusal): void {
    say(`  ⛔ DIVERGENCE at action [${dv.i}] — ${dv.type} (seat ${dv.seat}, ${names[dv.seat]})`);
    say(`       → ${dv.why}`);
    say('    THIS IS THE ONLY REFUSAL IN THIS FILE THAT IS EVIDENCE ON ITS OWN.');
    say('    From here on the replay is running a board the logged game never');
    say('    had, so every later refusal is CASCADE and every later success is');
    say('    coincidence. Do not count them, and do not file them.');
    if (dv.unanswerable) {
      say('    The engine reports this answer as UNANSWERABLE: not "wrong now"');
      say('    but "no reply of this shape can ever be accepted for the question');
      say('    now pending". The log and the engine disagree about what was');
      say('    being asked, so this is the whole finding.');
    }
    if (an.cascade.length) {
      const last = an.cascade[an.cascade.length - 1]!;
      say(`    ⛔ WEDGED: the decision open at [${dv.i}] (${names[JSON.parse(dv.pending!).seat]}: `
        + `"${JSON.parse(dv.pending!).prompt}")`);
      say(`       is still unanswered at [${last.i}]. All ${an.cascade.length} action(s) from`);
      say(`       [${an.cascade[0]!.i}] to [${last.i}] were refused under that same standing`);
      say('       question — ONE failure, not ' + an.cascade.length + '.');
      if (an.wedged) {
        say('       It never clears: this is a TOTAL loss of the log from');
        say(`       [${dv.i}] onward, reported above as ${an.refusals.length} refusals.`);
      } else if (an.resumedAt !== null) {
        say(`       Action [${an.resumedAt}] replayed again, but on a board that`);
        say('       had already parted company with the log.');
      }
    }
    // R200: a refusal index is an UPPER BOUND. Say so whenever nothing has
    // measured the real one — "fix [121]" sent six investigations to the
    // wrong action, because [121] is where the engine NOTICED, not where the
    // rules moved.
    const measured = opts.delta?.ok === true && opts.delta.atAction !== null
      ? opts.delta.atAction : null;
    if (measured !== null && measured < dv.i) {
      say(`    ⚠ AND THIS INDEX IS LATE. The diff above measured the real divergence at`);
      say(`      [${measured}]; [${dv.i}] is only where it finally became illegal. Start at [${measured}].`);
    } else if (measured === null) {
      say(`    Fix [${dv.i}] and re-run before drawing any conclusion from the rest —`);
      say('    and note that this index is an UPPER BOUND, not a measurement. Nothing');
      say('    here diffed against the engine that recorded the game, so an action');
      say('    that stayed legal while meaning something else is invisible to it.');
      say('    Re-run with --as-recorded to measure it instead of bounding it.');
    } else {
      say(`    Fix [${dv.i}] and re-run before drawing any conclusion from the rest.`);
    }
  }

  let exit = 0;

  if (an.unexplained.length) {
    // The file claims actions could not be replayed that THIS engine accepts.
    // Nothing the server does can produce that: it means the engine moved back
    // under the file (a rules commit reverted), or the file has been edited.
    say('  ⚠ INCONSISTENT — the file declares forks this engine cannot reproduce.');
    say(`    ${an.unexplained.length} action(s) recorded as unreplayable now replay fine:`);
    say(`    indices ${an.unexplained.slice(0, 20).join(', ')}${an.unexplained.length > 20 ? ' …' : ''}`);
    say('    Either a rules change was reverted (re-check the fork against the');
    say('    engine it was recorded on) or this file has been hand-edited.');
    exit = 3;
  } else if (declared.length && !an.extra.length) {
    say('  ⚠ FORKED, and the file\'s own account of itself checks out.');
    say(`    Every one of the ${an.refusals.length} refusals above is a fork this file already`);
    say('    declares. Not a server bug: the game was interrupted by a rules');
    say('    change and rebuilt. Read the two halves as separate games.');
    exit = 2;
  } else if (declared.length && d) {
    say('  ⚠ FORKED, and the engine has drifted FURTHER since.');
    say(`    ${an.declaredLost.length} refusal(s) are declared forks. Beyond those:`);
    divergence(d);
    say(`    the ${an.extra.length} undeclared refusal(s):`);
    listRefusals(an.extra);
    exit = 2;
  } else if (d) {
    say('  ⚠ ENGINE DRIFT — the current engine refuses a move that was legal');
    say('    when this game was played. The FILE is fine: it is a true record');
    say('    of the game, and the rules have changed under it since. Expected');
    say('    after a rules commit; a surprise otherwise, and then this log has');
    say('    found you a regression.');
    divergence(d);
    say(`    all ${an.refusals.length} refusal(s), in order:`);
    listRefusals(an.refusals);
    exit = 2;
  } else {
    say('  ✓ FAITHFUL — every logged action replays cleanly under the current');
    say('    engine, and the file declares no forks. seed + actions reproduces');
    say('    this game exactly.');
    // R200: FAITHFUL is the verdict a stale copy produces. A 104-action
    // truncation of a 375-action game reported this three times over several
    // hours and reassured everybody, because a prefix of a good log IS a good
    // log — it just stops before the interesting part. So a ✓ that could not
    // be cross-checked has to say that it could not be cross-checked.
    if (opts.source?.verdict === 'unchecked') {
      say('    ⚠ …of THIS FILE. It could not be checked against a canonical copy (see');
      say('      the source line above), so "every logged action" means every action');
      say('      THIS file happens to hold. A truncated copy passes this test.');
    }
  }

  // R200: a stale or mismatched copy outranks every verdict above it. Nothing
  // computed from the wrong file is worth acting on, so the exit code says so
  // even when the replay itself was clean.
  if (opts.source && (opts.source.verdict === 'stale' || opts.source.verdict === 'differs')) {
    say('');
    say('  ⛔ AND THIS IS NOT THE CANONICAL FILE. Everything above describes the copy');
    say('     you passed in, not the game on the server. Re-fetch before acting on it.');
    exit = 5;
  }

  if (opts.deterministic === false) exit = 3;
  return { lines: out, exit };
}

/**
 * R200 §1 — the report for a file that can never be replayed, as a VERDICT
 * rather than as a stack trace.
 *
 * Separate from `reportLines` because there is no `Analysis` to report: the
 * game could not be built at all. Exit code 4, its own, so a sweep over the
 * corpus can EXCLUDE these instead of counting them as divergences — which is
 * what "20 of 22 games diverge" has been doing to GAXG and HDGG.
 */
export function unreplayableLines(file: string, raw: RoomFile, reason: string): { lines: string[]; exit: number } {
  const names = raw.names ?? ['Player 1', 'Player 2'];
  return {
    lines: [
      `\n\u2550 ${file}`,
      `  mode ${raw.mode ?? 'shared'} \u00b7 seed ${raw.seed} \u00b7 ${names.join(' vs ')} \u00b7 ${raw.actions.length} actions logged`,
      '',
      '\u2500\u2500 verdict \u2500\u2500',
      '  \u2298 UNREPLAYABLE, PERMANENTLY \u2014 and therefore NOT a divergence.',
      `    ${reason}`,
      '',
      '    This is not engine drift and it is not a regression. There is no engine,',
      '    past or present, on which this file replays, because the file does not',
      '    record enough to say what game it was. Exclude it from any count of how',
      '    faithfully the corpus replays: including it makes the engine look worse',
      '    than it is and can never be fixed by any amount of rules work.',
    ],
    exit: 4,
  };
}

/** exit codes, named — a corpus sweep classifies on these */
export const EXIT = {
  faithful: 0, usage: 1, diverged: 2, inconsistent: 3, unreplayable: 4, staleCopy: 5,
} as const;

if (CLI) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node replay-room.ts games/<CODE>.json [--log] [--as-recorded [--at <sha>]] [--json]');
    process.exit(EXIT.usage);
  }
  const raw = JSON.parse(readFileSync(file, 'utf8')) as RoomFile;
  const source = crossCheck(file, raw);
  const versions = versionsOf(raw);

  // R200 §1 — classify before replaying. A file whose deal cannot be
  // reproduced used to reach here as an uncaught throw: a stack trace, exit 1,
  // indistinguishable from the tool being broken, and counted as a divergence
  // by every sweep that has ever run over the corpus.
  const dead = unreplayableReason(raw);
  if (dead) {
    const r = unreplayableLines(file, raw, dead);
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ file, verdict: 'unreplayable', reason: dead.split('\n')[0] }));
    } else {
      for (const line of r.lines) console.log(line);
      console.log(`  ${source.verdict === 'same' ? '✓' : '·'} source: ${source.note}`);
    }
    process.exit(r.exit);
  }

  const an = analyze(raw);
  const b = analyze(raw);   // determinism double-check
  const deterministic = JSON.stringify(an.state) === JSON.stringify(b.state);

  // R200 §4 — the diff, when asked for and when the file says where to look.
  let dl: Delta | undefined;
  if (process.argv.includes('--as-recorded')) {
    const atFlag = process.argv.indexOf('--at');
    const sha = atFlag >= 0 ? process.argv[atFlag + 1] : versions.reference;
    if (!sha) {
      console.error(`\n⛔ --as-recorded needs a commit to replay at, and ${basename(file)} does not name one:\n`
        + `    ${versions.why}\n`);
      process.exit(EXIT.usage);
    }
    dl = await delta(file, raw, sha);
  }

  const r = reportLines(file, raw, an, {
    showLog: process.argv.includes('--log'), deterministic, source, versions, delta: dl,
  });
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      file,
      verdict: r.exit === EXIT.faithful ? 'faithful' : r.exit === EXIT.staleCopy ? 'stale-copy'
        : r.exit === EXIT.inconsistent ? 'inconsistent' : 'diverged',
      logged: raw.actions.length,
      replayed: raw.actions.length - an.refusals.length,
      refused: an.refusals.length,
      firstRefusal: an.divergedAt?.i ?? null,
      measuredDivergence: dl?.ok ? dl.atAction : null,
      engines: versions.segments,
      source: source.verdict,
    }));
  } else {
    for (const line of r.lines) console.log(line);
  }
  process.exit(r.exit);
}
