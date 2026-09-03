/*
 * 255 · A WRITTEN-DOWN REMOTE PATH IS A CLAIM, AND CLAIMS ROT
 *
 * R275. The owner's 🐛 button appends to `var/issues.jsonl` on the deploy box.
 * The repo sees those reports only through a committed copy,
 * `ledgers/playtest-issues.snapshot.jsonl`, and the only thing that refreshes
 * that copy is a command a human runs. That command lived as an scp literal in
 * the header and failure messages of 70-playtest-ledger.test.ts.
 *
 * The 2026-08-30 reorg moved every mutable file to `var/`. The literal still
 * said `client/server/issues.jsonl`. So the one documented repair for a stale
 * snapshot fetched nothing — and did it quietly, at the start of a session,
 * when nobody reads the output of a step they think of as bookkeeping. Three
 * rounds later the snapshot was 135 rows and the server had 147: twelve owner
 * reports, four of them engine-level, that nothing in the repo knew existed
 * while the ledger reported "0 live" and the suite was green.
 *
 * Nothing offline could have seen those twelve rows, and this file does not
 * pretend otherwise — 70 compares the ledger to the SNAPSHOT, so a ledger and
 * a snapshot both behind the server agree perfectly, and no amount of testing
 * on this machine can reach a file on another one. What IS checkable, and what
 * actually broke, is narrower and mechanical:
 *
 *   §0  non-vacuity — the scan really reads files and really finds references
 *   §1  every `<deploy host>:<path>` written anywhere in this repo names a
 *       file scripts/paths.mjs names. A remote path nothing derives is a copy
 *       of a fact, and this is the copy that rotted.
 *   §2  paths.mjs and server/statepaths.ts agree about where those files are.
 *       Two modules answer this question — the engine may not import the
 *       server, so they cannot be collapsed — and a disagreement between them
 *       is the same defect one move further along.
 *   §3  the one-word refresh (`npm run reports`) still exists and still points
 *       at a script that is there.
 *
 * ⚠ WHAT THIS DOES NOT DO. It cannot tell you the snapshot is stale. Only
 * `npm run reports` can, because only it talks to the server. If you are here
 * because reports went missing again, the answer is to run that, not to add a
 * cleverer assertion here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  DEPLOY_HOST, DEPLOY_ROOT, GAMES_DIR, ISSUES_JSONL, ISSUES_SNAPSHOT, REPO_ROOT,
  VAR_DIR, VERDICTS_JSONL, remote,
} from '../../engine/scripts/paths.mjs';
import { gamesDir, issuesFile, verdictsFile } from '../statepaths.ts';

/* ── the corpus ───────────────────────────────────────────────────────────
 * Everything a human might read an instruction out of: source, scripts, docs
 * and READMEs. Not data/ (528 scans and a 12 MB oracle file), not var/, not
 * node_modules, not .git. */
const SKIP = new Set(['node_modules', '.git', 'var', 'data', 'dist', '.venv', '__pycache__']);
const EXT = new Set(['.ts', '.mjs', '.js', '.json', '.md', '.sh', '.html', '.py']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

const FILES = walk(REPO_ROOT);

/** `<host>:/absolute/path` as it would be typed into scp, anywhere in a file */
const REMOTE_RE = new RegExp(
  `${DEPLOY_HOST.replace(/\./g, '\\.')}:(\\/[^\\s'"\`\\\\]+)`, 'g');

interface Ref { file: string; line: number; text: string }

function references(): Ref[] {
  const out: Ref[] = [];
  for (const file of FILES) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes(DEPLOY_HOST)) continue;
    src.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(REMOTE_RE)) {
        out.push({ file: path.relative(REPO_ROOT, file), line: i + 1, text: m[0]! });
      }
    });
  }
  return out;
}

/** every remote file this repo has a canonical constant for */
const CANONICAL: Record<string, string> = {
  ISSUES_JSONL: remote(ISSUES_JSONL),
  VERDICTS_JSONL: remote(VERDICTS_JSONL),
};

/**
 * Canonical DIRECTORIES: anything below one is fine.
 *
 * `var/games/` is the reason this is not a files-only check — a saved room is
 * fetched by room code (`…/var/games/ERJZ.json`), so the file names are data,
 * not constants. The directory is the fact that can rot; the room code cannot.
 */
const CANONICAL_DIRS: Record<string, string> = {
  GAMES_DIR: `${remote(GAMES_DIR)}/`,
};

/* ════════════════════════════════════════════════════════════════════════
 * 0. NON-VACUITY
 * ════════════════════════════════════════════════════════════════════════ */

test('§0 POSITIVE CONTROL: the scan reads real files and the remote pattern really matches', () => {
  assert.ok(FILES.length > 300,
    `the walk found only ${FILES.length} files — it has gone blind, and §1 below would then `
    + 'pass by quantifying over nothing');
  assert.ok(FILES.some(f => f.endsWith(path.join('engine', 'test', '70-playtest-ledger.test.ts'))),
    'the walk did not reach 70-playtest-ledger.test.ts, which is the file the refresh command '
    + 'lives in — the corpus is wrong, not clean');

  // the pattern itself: it must match a real reference, and must NOT match the
  // host with a port on it (http://<host>:5000 is not an scp path)
  const sample = `scp ${CANONICAL['ISSUES_JSONL']} snapshot.jsonl`;
  assert.deepEqual([...sample.matchAll(REMOTE_RE)].map(m => m[0]), [CANONICAL['ISSUES_JSONL']]);
  assert.deepEqual([...`http://${DEPLOY_HOST}:5000/`.matchAll(REMOTE_RE)].map(m => m[0]), []);
});

test('§0 POSITIVE CONTROL: the refresh command is written down somewhere findable', () => {
  const refs = references();
  assert.ok(refs.length > 0,
    `no ${DEPLOY_HOST}:<path> reference anywhere in the repo. Either the fetch instruction was `
    + 'deleted — in which case the intake loop has no documented repair at all and R275 has '
    + 'regressed — or the scan is broken. Both need a human.');
  assert.ok(refs.some(r => r.file.includes('70-playtest-ledger')),
    'no remote path in 70-playtest-ledger.test.ts. That file IS the snapshot guard; the command '
    + `that refreshes the snapshot belongs in it. Found instead: ${JSON.stringify(refs)}`);
});

/* ════════════════════════════════════════════════════════════════════════
 * 1. THE DEFECT ITSELF
 * ════════════════════════════════════════════════════════════════════════ */

test('§1 every remote path written down in this repo is one the path constants name', () => {
  const known = new Set(Object.values(CANONICAL));
  const dirs = Object.values(CANONICAL_DIRS);
  const wrong = references()
    .filter(r => !known.has(r.text) && !dirs.some(d => r.text.startsWith(d)));

  assert.deepEqual(wrong.map(r => `${r.file}:${r.line}  ${r.text}`), [],
    'these are hand-written remote paths that no constant in engine/scripts/paths.mjs names.\n'
    + 'A path typed into prose cannot be moved by a refactor, and this is exactly how the '
    + 'issues.jsonl fetch broke: the reorg moved the file to var/ and the instruction kept '
    + 'pointing at client/server/.\n'
    + 'Fix by spelling it the way paths.mjs does — one of:\n'
    + Object.entries({ ...CANONICAL, ...CANONICAL_DIRS })
      .map(([k, v]) => `    ${k} = ${v}`).join('\n')
    + '\nIf it is a file with no constant yet, add one to paths.mjs and to CANONICAL here, so '
    + 'the next move takes the instruction with it.');
});

/* ════════════════════════════════════════════════════════════════════════
 * 2. THE TWO MODULES THAT ANSWER THIS QUESTION AGREE
 * ════════════════════════════════════════════════════════════════════════ */

test('§2 paths.mjs and server statepaths.ts resolve the same runtime files', () => {
  // statepaths reads its env var on every call, and the suite sets these when
  // it wants a throwaway directory — the DEFAULT is what is being compared.
  const saved = { i: process.env['ALGO_ISSUES_FILE'], v: process.env['ALGO_VERDICTS_FILE'] };
  delete process.env['ALGO_ISSUES_FILE'];
  delete process.env['ALGO_VERDICTS_FILE'];
  try {
    // positive control: the import resolved to the real server module, not to
    // something that returns a harmless empty string
    assert.ok(issuesFile().startsWith(VAR_DIR),
      `server/statepaths.ts put issues.jsonl at ${issuesFile()}, outside ${VAR_DIR} — `
      + 'the comparison below would be meaningless');

    assert.equal(path.resolve(ISSUES_JSONL), path.resolve(issuesFile()),
      'engine/scripts/paths.mjs and server/statepaths.ts disagree about where the playtest '
      + 'reports live. The fetch script writes from one and the server writes to the other, so '
      + 'one of them is fetching a file nobody writes.');
    assert.equal(path.resolve(VERDICTS_JSONL), path.resolve(verdictsFile()),
      'same, for the scenario tester verdict log');
    assert.equal(path.resolve(GAMES_DIR), path.resolve(gamesDir()),
      'same, for the saved rooms a playtest report is replayed from');
  } finally {
    if (saved.i !== undefined) process.env['ALGO_ISSUES_FILE'] = saved.i;
    if (saved.v !== undefined) process.env['ALGO_VERDICTS_FILE'] = saved.v;
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * 3. THE ONE-WORD REFRESH IS REALLY THERE
 * ════════════════════════════════════════════════════════════════════════ */

test('§3 npm run reports exists and points at a script that exists', () => {
  const pkgPath = path.join(REPO_ROOT, 'client', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
  const cmd = pkg.scripts?.['reports'];
  assert.ok(cmd,
    'client/package.json has no `reports` script. It is the only thing that can actually see '
    + 'the deploy box, and every failure message in 70-playtest-ledger.test.ts tells the reader '
    + 'to run it.');

  const named = /(\S+\.mjs)/.exec(cmd!);
  assert.ok(named, `the reports script does not name a .mjs file: ${cmd}`);
  const script = path.join(REPO_ROOT, 'client', named![1]!);
  assert.ok(fs.existsSync(script), `client/package.json runs ${named![1]}, which does not exist`);

  // it must derive its remote paths rather than spell them — the whole point
  const src = fs.readFileSync(script, 'utf8');
  assert.ok(/from '\.\/paths\.mjs'/.test(src),
    `${named![1]} does not import ./paths.mjs, so its remote paths are hand-written and can rot `
    + 'the same way the scp line did');
});

test('§3 the snapshot the ledger is checked against is the one the fetch writes', () => {
  assert.ok(fs.existsSync(ISSUES_SNAPSHOT),
    `${ISSUES_SNAPSHOT} is missing — the committed copy of the reports is gone`);
  assert.equal(path.basename(ISSUES_SNAPSHOT), 'playtest-issues.snapshot.jsonl');
  assert.equal(path.dirname(ISSUES_SNAPSHOT), path.join(REPO_ROOT, 'client', 'ledgers'));
  assert.ok(DEPLOY_ROOT.startsWith('/'), 'the deploy root must be absolute for scp');
});

/* ════════════════════════════════════════════════════════════════════════
 * 4. THE TYPE DECLARATIONS ARE A SECOND COPY OF §1's FACT
 *
 * R285. `scripts/paths.mjs` is plain JS, so the TypeScript side reads it
 * through a HAND-WRITTEN `paths.d.mts` sitting beside it. That file is a copy
 * of the module's shape, maintained by remembering to — which is the precise
 * arrangement §1 exists because of, one directory along.
 *
 * It fails narrowly and confusingly: the constant works everywhere JS runs it
 * (the script, `node --test`) and is invisible only to `tsc`, so a change lands
 * green in the two places an author checks and reddens later in `npm run
 * check`, pointing at the consumer rather than at the copy. That is what
 * happened when VERDICTS_SNAPSHOT was added.
 *
 * Derived, not typed: read both files and compare the export names.
 * ════════════════════════════════════════════════════════════════════════ */

test('§4 paths.d.mts declares exactly what paths.mjs exports', () => {
  const dir = path.join(REPO_ROOT, 'client', 'engine', 'scripts');
  const names = (file: string, re: RegExp): string[] => {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const out: string[] = [];
    for (const m of src.matchAll(re)) out.push(m[1]!);
    return out.sort();
  };
  // `export const X` / `export function X` in either file
  const impl = names('paths.mjs', /^export (?:const|function)\s+([A-Za-z_$][\w$]*)/gm);
  const decl = names('paths.d.mts', /^export (?:declare )?(?:const|function)\s+([A-Za-z_$][\w$]*)/gm);

  assert.ok(impl.length >= 10,
    `only ${impl.length} exports found in paths.mjs — the scan is not reading the file, and a `
    + 'comparison of two empty lists agrees perfectly');

  assert.deepEqual(decl, impl,
    'paths.d.mts and paths.mjs disagree about what the module exports.\n'
    + `  only in paths.mjs   (invisible to tsc): ${impl.filter(n => !decl.includes(n)).join(', ') || '—'}\n`
    + `  only in paths.d.mts (declared, absent): ${decl.filter(n => !impl.includes(n)).join(', ') || '—'}\n`
    + 'The .d.mts is a hand-kept copy of the module shape. Add the line, do not delete the '
    + 'constant.');
});
