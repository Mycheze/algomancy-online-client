/* WEEKLY CHALLENGES — fingerprint runs verified BEFORE fingerprints were kept.
 *
 *   node server/challenge-sigs-backfill.ts --runs <runs.jsonl> --engine-root <checkout> --out <sigs.jsonl>
 *        [--engine <40-hex sha>]
 *
 * A run's fingerprints (challenge-sigs.ts) say what its game WAS, so only the
 * engine that verified it can produce them — today's engine would fingerprint
 * today's game and bless it. So this runs the run's own engine: `--engine-root`
 * is a checkout of the commit the runs are stamped with (a detached git
 * worktree), and the engine, the deal and the calendar are all imported from
 * THERE. Only the signature projection is this tree's — the one the server
 * compares with (replay-probe.ts; the same rule replay-room.ts follows).
 *
 * It is careful in three ways, each of which a wrong answer here would cost
 * a player a truthful Watch:
 *
 *   · it fingerprints only runs STAMPED with the checkout's engine (its
 *     `git rev-parse HEAD`, or `--engine` for a checkout without .git). A run
 *     recorded on another engine is skipped and named, never guessed at.
 *   · the checkout must REPRODUCE the run — verifyRun accepts the stored log,
 *     meets the goal at its last action and scores what was stamped. If not,
 *     this is not that run's engine, and nothing is written for it.
 *   · IDEMPOTENT: a run that already has a line in `--out` is skipped, and
 *     each line is appended as soon as it is computed — so it can be re-run on
 *     a fresher runs.jsonl, or after an interruption, and only adds.
 *
 * `--out` is in the server's own format (var/challenges/sigs.jsonl), so its
 * lines can be appended to the box's file as they stand. Exit 0 when every
 * run was fingerprinted or skipped as already done / another engine; 1 when
 * any run the checkout should have reproduced did not; 2 on a usage error.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChallengeDef, RunScore } from '../engine/src/challenge.ts';
import { parseSigsIndex, sameScore, walkRun, type WalkEngine } from './challenge-sigs.ts';

export interface BackfillReport {
  engine: string;
  written: string[];
  already: string[];
  otherEngine: { runId: string; engine: string }[];
  failed: { runId: string; why: string }[];
}

const isSha = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);

/** the commit a checkout is at, or null */
function headOf(root: string): string | null {
  try {
    const sha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return isSha(sha) ? sha : null;
  } catch { return null; }
}

/** The checkout's engine, its deal and its calendar — never this tree's. */
async function loadCheckout(root: string): Promise<{ eng: WalkEngine; calendar: readonly ChallengeDef[] }> {
  const imp = (p: string): Promise<Record<string, unknown>> => import(pathToFileURL(join(root, 'client', p)).href) as Promise<Record<string, unknown>>;
  const ch = await imp('engine/src/challenge.ts');
  const ap = await imp('engine/src/apply.ts');
  const cal = await imp('server/challenges.ts');
  const eng = {
    verifyRun: ch['verifyRun'], checkChallengeDeck: ch['checkChallengeDeck'], challengeDeal: ch['challengeDeal'],
    DUMMY_DECK: ch['DUMMY_DECK'], createGame: ap['createGame'], apply: ap['apply'],
  };
  for (const [k, v] of Object.entries(eng)) if (v === undefined) throw new Error(`the checkout at ${root} has no ${k}`);
  return { eng: eng as unknown as WalkEngine, calendar: cal['CHALLENGES'] as ChallengeDef[] };
}

interface RunLine { runId: string; challengeId: string; engine: string; deck: unknown; actions: unknown[]; score: RunScore }

export async function backfill(o: { runs: string; root: string; out: string; engine?: string; log?: (s: string) => void }): Promise<BackfillReport> {
  const log = o.log ?? ((s: string) => console.log(s));
  const root = resolve(o.root);
  const engine = o.engine ?? headOf(root);
  if (!isSha(engine)) throw new Error(`cannot tell which engine ${root} is — pass --engine <40-hex sha>`);
  const done = new Set(existsSync(o.out) ? parseSigsIndex(readFileSync(o.out)).keys() : []);
  const rows: RunLine[] = [];
  readFileSync(o.runs, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try { rows.push(JSON.parse(line) as RunLine); }
    catch { log(`line ${i + 1} of ${o.runs} is not JSON; skipped`); }
  });
  const report: BackfillReport = { engine, written: [], already: [], otherEngine: [], failed: [] };
  const todo = rows.filter(r => {
    if (done.has(r.runId)) { report.already.push(r.runId); return false; }
    if (r.engine !== engine) { report.otherEngine.push({ runId: r.runId, engine: String(r.engine) }); return false; }
    return true;
  });
  if (!todo.length) return report;
  const { eng, calendar } = await loadCheckout(root);
  // a run sent twice is ONE line: the first line for a run wins on read, so a
  // second would be dead weight
  const seen = new Set<string>();
  for (const r of todo) {
    if (seen.has(r.runId)) continue;
    seen.add(r.runId);
    const def = calendar.find(c => c.id === r.challengeId);
    if (!def) { report.failed.push({ runId: r.runId, why: `the checkout's calendar has no challenge ${r.challengeId}` }); continue; }
    const t0 = Date.now();
    let w;
    try {
      w = walkRun(eng, def, r.deck, Array.isArray(r.actions) ? r.actions : [], { full: false });
    } catch (err) {
      report.failed.push({ runId: r.runId, why: `the walk threw: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    const v = w.verify;
    const why = !v.ok ? `does not verify on this checkout: ${v.error}`
      : v.n !== r.actions.length ? `meets the goal at action ${v.n - 1}, not at the stored log's last (${r.actions.length - 1})`
      : !sameScore(r.score, v.score) ? `scores ${JSON.stringify(v.score)}, stamped ${JSON.stringify(r.score)}`
      : w.sigs.length !== r.actions.length || !w.sigs.every(Boolean) ? 'the walk did not fingerprint every action'
      : null;
    if (why) { report.failed.push({ runId: r.runId, why: `${why} — is this the engine it was recorded on?` }); continue; }
    appendFileSync(o.out, `${JSON.stringify({ runId: r.runId, engine, sigs: w.sigs })}\n`);
    report.written.push(r.runId);
    log(`${r.runId}  ${r.actions.length} actions  fingerprinted (${Date.now() - t0} ms)`);
  }
  return report;
}

const CLI = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (CLI) {
  const arg = (k: string): string | undefined => {
    const i = process.argv.indexOf(k);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const runs = arg('--runs'), root = arg('--engine-root'), out = arg('--out'), engine = arg('--engine');
  if (!runs || !root || !out) {
    console.error('usage: node server/challenge-sigs-backfill.ts --runs <runs.jsonl> --engine-root <checkout> --out <sigs.jsonl> [--engine <sha>]');
    process.exitCode = 2;
  } else {
    try {
      const r = await backfill({ runs, root, out, ...(engine ? { engine } : {}) });
      console.log(`engine ${r.engine}: ${r.written.length} fingerprinted, ${r.already.length} already, `
        + `${r.otherEngine.length} recorded on another engine, ${r.failed.length} failed`);
      for (const x of r.otherEngine) console.log(`  other engine: ${x.runId} (${x.engine})`);
      for (const x of r.failed) console.log(`  FAILED: ${x.runId}: ${x.why}`);
      process.exitCode = r.failed.length ? 1 : 0;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    }
  }
}
