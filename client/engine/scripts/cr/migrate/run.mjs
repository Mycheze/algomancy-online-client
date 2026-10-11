/* THE CR-ONLY MIGRATION, re-runnable from a clean checkout.
 *
 *   node client/engine/scripts/cr/migrate/run.mjs [--dry-run [--keep]] [--step <s>[,<s>…]] [--decisions <dir>]
 *
 * Master moves while this branch waits, so nothing here is a hand-made diff to
 * rebase: on fresh master, run this and commit what it writes. Steps, in order:
 *
 *   score    rmap + census + score → build/cites.json, from the REGISTER-ERA tree
 *   absorb   owner provenance into the records; scope; provenance wording (absorb.mjs)
 *   recite   R-citations → CR numbers / pointers / words; bindings follow titles (recite.mjs)
 *   hand     the hand-written edits (check/extract/render, the reworked tests, …):
 *            hand/manifest.json names each file and the blob it was written against;
 *            each is 3-way merged (`git merge-file`) onto the current file, so a
 *            master edit elsewhere in the file survives and a clash stops the run
 *   render   cr:render, so the generated document matches the absorbed records
 *   delete   ONLY when named with --step: deletes the register, DIGITAL_RULES,
 *            classification.json, supersession.json, and merges the docs edits
 *            (hand/manifest.json entries with "step": "delete"). Then render again.
 *
 * Without --step every step but `delete` runs. --dry-run does it all in a scratch
 * worktree at HEAD (the tooling must be committed), writes the diff to
 * build/migrate/dry.diff and a summary to build/migrate/dry-summary.json, and
 * removes the worktree unless --keep (its path is printed; tests can run there).
 *
 *   node run.mjs capture <path>… --from <dir>   record hand edits: copy <dir>/<path> into
 *                                               hand/files/, base = HEAD:<path> here
 *   node run.mjs capture --delete <path>…        record a deletion (hand step)
 *   add --step-of delete to either to file the entry under the delete step. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, realpathSync, copyFileSync, unlinkSync, lstatSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, CR_BUILD_DIR } from '../../paths.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const HAND = join(HERE, 'hand');
const MANIFEST = join(HAND, 'manifest.json');
const STEPS = ['score', 'absorb', 'recite', 'hand', 'render'];
const MIGRATE_REL = relative(REPO_ROOT, HERE);
/** what the delete step removes outright (beyond its manifest entries) */
export const DELETE_PATHS = ['client/docs/digital-rules.md', 'data/comprehensive-rules/classification.json', 'data/comprehensive-rules/supersession.json'];
/** links a scratch worktree needs to run the scripts and tests */
const LINKS = ['client/engine/node_modules', 'client/server/node_modules', 'client/ui/node_modules', 'client/ledgers/node_modules', '.venv'];

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const git = (args, cwd = REPO_ROOT, opts = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
const readManifest = () => (existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { _doc: '', files: {} });

/* ── hand: 3-way merge of each recorded edit onto the current file ── */
export function applyHand(root, step) {
  const man = readManifest();
  const out = { merged: [], deleted: [], conflicts: [], missingBase: [] };
  for (const [path, e] of Object.entries(man.files).sort()) {
    if ((e.step ?? 'hand') !== step) continue;
    const abs = join(root, path);
    if (e.op === 'delete') { if (existsSync(abs)) { unlinkSync(abs); out.deleted.push(path); } continue; }
    const theirs = join(HAND, 'files', path);
    if (e.op === 'add' || !e.base) { mkdirSync(dirname(abs), { recursive: true }); copyFileSync(theirs, abs); out.merged.push(path); continue; }
    let base;
    try { base = git(['cat-file', 'blob', e.base], root); } catch { out.missingBase.push(path); continue; }
    if (!existsSync(abs)) { out.conflicts.push(`${path}: the file is gone`); continue; }
    const tmp = join(root, CR_BUILD_DIR.slice(REPO_ROOT.length + 1), 'migrate', 'merge');
    mkdirSync(tmp, { recursive: true });
    const b = join(tmp, 'base'), c = join(tmp, 'current');
    writeFileSync(b, base); copyFileSync(abs, c);
    const r = spawnSync('git', ['merge-file', '-p', '-L', 'current', '-L', 'base', '-L', 'hand', c, b, theirs], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
    if (r.status !== 0) { out.conflicts.push(`${path}: ${r.status} conflict(s)`); continue; }
    writeFileSync(abs, r.stdout);
    out.merged.push(path);
  }
  return out;
}

/* ── capture: record hand edits ── */
function capture() {
  const man = readManifest();
  const from = arg('--from');
  const step = arg('--step-of') ?? 'hand';
  const del = process.argv.includes('--delete');
  const paths = process.argv.slice(3).filter((p, i, a) => !p.startsWith('--') && !['--from', '--step-of'].includes(a[i - 1]));
  for (const p of paths) {
    let base = null;
    try { base = git(['rev-parse', `HEAD:${p}`]).trim(); } catch { base = null; }
    if (del) { man.files[p] = { op: 'delete', step, base }; continue; }
    const src = join(resolve(from), p);
    const dst = join(HAND, 'files', p);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    man.files[p] = { op: base ? 'merge' : 'add', step, base };
  }
  man._doc = 'Hand-written edits the migration applies (run.mjs step hand / delete). base = the blob each edit was written against; the edit is 3-way merged onto the current file.';
  mkdirSync(HAND, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(man, null, 1) + '\n');
  console.log(`captured ${paths.length} path(s) into ${relative(REPO_ROOT, HAND)}`);
}

/* ── run the steps in a tree (this process's REPO_ROOT, or a scratch worktree via a child) ── */
async function runSteps(steps, { decisionsDir } = {}) {
  const log = {};
  const t0 = Date.now();
  const time = (k) => { log[k] = { ...(log[k] ?? {}), ms: Date.now() - t0 }; };
  let cites = null;
  if (steps.includes('score')) {
    if (!existsSync(join(REPO_ROOT, 'client/docs/digital-rules.md'))) throw new Error('score needs the register: this tree is already migrated');
    const { score, CITES_JSON } = await import('./score.mjs');
    const { out, frozen } = score({});
    cites = { summary: { frozen }, rows: out };
    mkdirSync(CR_BUILD_DIR, { recursive: true });
    writeFileSync(CITES_JSON, JSON.stringify(cites) + '\n');
    log.score = { rows: out.length, frozen };
    time('score');
  }
  if (steps.includes('absorb')) {
    const { absorb } = await import('./absorb.mjs');
    const r = absorb({});
    log.absorb = { ...r, changedFiles: r.changedFiles.length, bareDropped: r.bareDropped };
    time('absorb');
  }
  if (steps.includes('recite')) {
    const { recite, loadDecisions } = await import('./recite.mjs');
    const { CITES_JSON } = await import('./score.mjs');
    cites ??= JSON.parse(readFileSync(CITES_JSON, 'utf8'));
    const { report } = recite({ cites, decisions: loadDecisions(decisionsDir) });
    log.recite = report;
    time('recite');
  }
  if (steps.includes('hand')) { log.hand = applyHand(REPO_ROOT, 'hand'); time('hand'); if (log.hand.conflicts.length || log.hand.missingBase.length) throw Object.assign(new Error(`hand step: ${JSON.stringify(log.hand)}`), { log }); }
  if (steps.includes('delete')) {
    for (const p of DELETE_PATHS) if (existsSync(join(REPO_ROOT, p))) unlinkSync(join(REPO_ROOT, p));
    log.delete = applyHand(REPO_ROOT, 'delete');
    if (log.delete.conflicts.length) throw Object.assign(new Error(`delete step: ${JSON.stringify(log.delete)}`), { log });
    time('delete');
  }
  if (steps.includes('render') || steps.includes('delete')) {
    const r = spawnSync(process.execPath, [join(REPO_ROOT, 'client/engine/scripts/cr/render.mjs')], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
    log.render = { status: r.status, out: (r.stdout + r.stderr).trim().split('\n').slice(-5) };
    time('render');
  }
  return log;
}

function stepsOf() {
  const s = arg('--step');
  if (!s) return STEPS;
  const want = s.split(',');
  for (const w of want) if (![...STEPS, 'delete'].includes(w)) throw new Error(`unknown step ${w}`);
  return want;
}

async function dryRun() {
  const status = git(['status', '--porcelain', '--', MIGRATE_REL]).trim();
  if (status) console.warn(`⚠ uncommitted changes under ${MIGRATE_REL} are NOT in the dry run (it runs HEAD):\n${status}`);
  const dir = arg('--dir') ?? join(REPO_ROOT, '.claude', 'worktrees', 'cr-migrate-dry');
  if (existsSync(dir)) { try { git(['worktree', 'remove', '--force', dir]); } catch { rmSync(dir, { recursive: true, force: true }); git(['worktree', 'prune']); } }
  git(['worktree', 'add', '--detach', dir, 'HEAD']);
  for (const l of LINKS) {
    const src = join(REPO_ROOT, l);
    if (!existsSync(src)) continue;
    const dst = join(dir, l);
    if (existsSync(dst)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    symlinkSync(realpathSync(src), dst);
  }
  const args = [join(dir, MIGRATE_REL, 'run.mjs'), '--in-place'];
  if (arg('--step')) args.push('--step', arg('--step'));
  if (arg('--decisions')) args.push('--decisions', resolve(arg('--decisions')));
  const r = spawnSync(process.execPath, args, { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 1 << 30 });
  const outDir = join(CR_BUILD_DIR, 'migrate');
  mkdirSync(outDir, { recursive: true });
  const logPath = join(dir, 'data/comprehensive-rules/build/migrate/run-log.json');
  if (existsSync(logPath)) copyFileSync(logPath, join(outDir, 'dry-log.json'));
  git(['add', '-A', '.'], dir);
  const diff = git(['diff', '--cached', 'HEAD'], dir);
  writeFileSync(join(outDir, 'dry.diff'), diff);
  const stat = git(['diff', '--cached', '--shortstat', 'HEAD'], dir).trim();
  git(['reset', '-q'], dir);
  const summary = { status: r.status, stat, dir, diff: join(outDir, 'dry.diff'), log: join(outDir, 'dry-log.json') };
  writeFileSync(join(outDir, 'dry-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  console.log(r.stdout.trim());
  console.log(JSON.stringify(summary, null, 1));
  if (!process.argv.includes('--keep')) { git(['worktree', 'remove', '--force', dir]); }
  process.exit(r.status ?? 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'capture') capture();
  else if (process.argv.includes('--dry-run')) await dryRun();
  else {
    const steps = stepsOf();
    const dDir = arg('--decisions') ? resolve(arg('--decisions')) : undefined;
    let log, code = 0;
    try { log = await runSteps(steps, { decisionsDir: dDir }); }
    catch (e) { log = e.log ?? {}; log.error = String(e.stack ?? e); code = 1; }
    const outDir = join(CR_BUILD_DIR, 'migrate');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'run-log.json'), JSON.stringify(log, null, 1) + '\n');
    const brief = Object.fromEntries(Object.entries(log).map(([k, v]) => [k, k === 'recite' ? {
      byKind: v.byKind, leave: v.leave?.length, dropUnapplied: v.dropUnapplied?.length, rewordUnapplied: v.rewordUnapplied?.length,
      titles: v.titles, bindings: { rewritten: v.bindings?.rewritten, unresolved: v.bindings?.unresolved?.length }, files: v.files, notFound: v.notFound,
    } : k === 'absorb' ? { recordsWithRulings: v.recordsWithRulings, ownerEntries: v.ownerEntries, scopeMissing: v.scopeMissing, unknownIds: v.unknownIds, bareDropped: v.bareDropped?.length } : v]));
    console.log(JSON.stringify(brief, null, 1));
    process.exit(code);
  }
}
