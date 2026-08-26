/*
 * 153 · THE TYPECHECKER'S REACH
 *
 * R181 / CARD-TODO #59, #60.
 *
 * `digital-client/server/` had no `tsconfig.json`. Not a lax one — none at
 * all. `npm run check` at the client root read
 *
 *     npm --prefix engine run check && npm --prefix server test && ...
 *
 * and every human who read that line saw three projects being checked. What
 * the middle one actually did was run `node --test suite.test.ts`, which
 * type-strips and never type-CHECKS. Nine type errors had accumulated behind
 * that gap, one of which (`renumberAction` reading `.mod` off a `{ face }`
 * activation) wrote `{ mod: NaN }` over an action's payload during an undo.
 *
 * The same shape produced #60: `engine/tsconfig.json` had `strict` but not
 * `noUnusedLocals`, so `batch-light-a::payLife` sat there with zero call sites
 * and a doc comment confidently describing a life-cost model that all three
 * life-cost cards had abandoned rulings ago.
 *
 * Both are the same failure, and it is not "the code was wrong". It is that
 * THE REACH OF THE CHECK SHRANK AND NOTHING SAID SO. A directory appeared
 * outside every `include`; a flag was never turned on; a `check` script named
 * a project without typechecking it. Each is invisible in a green suite,
 * because a check that does not run cannot fail.
 *
 * So this file asserts the reach itself, never the result:
 *
 *   §1  every .ts file in the client is inside some tsconfig project — a NEW
 *       top-level directory fails HERE, on the day it is added, instead of
 *       going unchecked for months;
 *   §2  the root `check` script actually invokes each of those projects'
 *       typechecks — read out of package.json, followed through the npm
 *       script graph, never assumed;
 *   §3  the load-bearing flags are on in every config, asserted one at a time
 *       with the reason each exists, so turning one off fails loudly and by
 *       name.
 *
 * §1 and §3 ask the COMPILER what a config covers (`tsc --showConfig` resolves
 * `include`/`exclude` into an explicit file list and normalises every flag)
 * rather than reimplementing glob matching here. A checker that answers from
 * its own reimplementation of the thing it is checking is how `stripCode` went
 * blind; asking the real tool is the version with no second opinion to drift.
 *
 * Every assertion below is also guarded against going VACUOUS — a walk that
 * finds no files, a config list that comes back empty, and a script graph that
 * resolves to nothing all fail rather than pass trivially.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..');
const CLIENT = path.resolve(ENGINE, '..');
const TSC = path.join(ENGINE, 'node_modules', '.bin', 'tsc');

/** Directories that hold no source: dependencies, VCS, and the server's
 * runtime data (`games/`, `accounts/` — both .gitignored, neither .ts).
 *
 * ── R210 (CT-83): WHY A WALKER CONFIG IS ON AN EXEMPTION-LIST TICKET ────
 *
 * CT-83 listed this among the tables with no staleness assertion and flagged
 * it as "walker config, not a waiver — argue whether it belongs at all".
 *
 * It belongs, and it is the most dangerous kind. An exemption list at least
 * NAMES what it waives: `DEAD_EXEMPT` says "printedCost is dead and here is
 * why", so the thing waived is visible in the source even while unchecked.
 * A skipped DIRECTORY is invisible in both directions — nothing in this file's
 * output mentions it, and §1's verdict ("every .ts file in the client is
 * covered by some tsconfig project") is quantified over a corpus this set
 * defines. Add one wrong name here and §1 goes on passing while meaning
 * strictly less, which is R181's failure — THE REACH OF THE CHECK SHRANK AND
 * NOTHING SAID SO — reproduced inside the file written to prevent it.
 *
 * So each name is treated as the claim it is: "no source we own lives under
 * here". That is re-derived from git on every run, below.
 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'games', 'accounts', 'dist', 'coverage']);

function walk(dir: string, onFile: (p: string) => void): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(path.join(dir, e.name), onFile);
    } else if (e.isFile()) {
      onFile(path.join(dir, e.name));
    }
  }
}

const rel = (p: string): string => path.relative(CLIENT, p);

/** every .ts file the client owns, and every directory one of them sits in */
function sourceInventory(): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  walk(CLIENT, p => { if (p.endsWith('.ts')) files.push(p); });
  files.sort();
  return { files, dirs: [...new Set(files.map(f => path.dirname(f)))].sort() };
}

/** every tsconfig.json the client owns */
function configs(): string[] {
  const out: string[] = [];
  walk(CLIENT, p => { if (path.basename(p) === 'tsconfig.json') out.push(p); });
  return out.sort();
}

interface Resolved {
  /** absolute path of the tsconfig */
  config: string;
  /** the project directory (where `tsc` with no -p would pick this up) */
  dir: string;
  /** compilerOptions as the COMPILER resolved them, not as written */
  options: Record<string, unknown>;
  /** every file this project includes, absolute */
  files: string[];
}

/** Ask tsc itself what a config resolves to. `--showConfig` expands
 * `include`/`exclude` into a literal `files` array and normalises defaults,
 * so this reads the project the way the compiler will, comments and globs and
 * inherited defaults included. */
function resolveConfig(config: string): Resolved {
  const dir = path.dirname(config);
  let raw: string;
  try {
    raw = execFileSync(TSC, ['-p', dir, '--showConfig'], { encoding: 'utf8' });
  } catch (err) {
    assert.fail(`tsc could not read ${rel(config)} — the project does not load at all:\n${
      err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = JSON.parse(raw) as { compilerOptions?: Record<string, unknown>; files?: string[] };
  return {
    config,
    dir,
    options: parsed.compilerOptions ?? {},
    files: (parsed.files ?? []).map(f => path.resolve(dir, f)),
  };
}

// ─────────────── §0 · the corpus every section below is quantified over ────

test('§0 R210: every SKIP_DIRS name still hides no source we own', () => {
  // The staleness assertion CT-83 asked for, in the only form that means
  // anything for a corpus definition: ask GIT what source the repo tracks, and
  // require that none of it is behind a name this walk refuses to enter.
  //
  // git rather than the filesystem on purpose. `games/` and `accounts/` are
  // .gitignored runtime data and `node_modules/` is vendored — walking them to
  // prove they hold no .ts costs seconds and proves the wrong thing anyway
  // (a stray build artefact is not source we own). What matters is whether a
  // TRACKED .ts file has ended up somewhere this file will never look.
  const tracked = execFileSync('git', ['ls-files', '-z', '--', '*.ts', '*.mts', '*.cts'],
    { cwd: CLIENT, encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.ok(tracked.length > 200,
    `git lists only ${tracked.length} tracked .ts files under ${CLIENT} — the query has gone `
    + 'blind and the check below would pass over nothing');

  const hidden: string[] = [];
  for (const tracked1 of tracked) {
    const seg = tracked1.split('/').slice(0, -1).find(d => SKIP_DIRS.has(d));
    if (seg) hidden.push(`${tracked1} — behind SKIP_DIRS entry '${seg}'`);
  }
  assert.deepEqual(hidden, [],
    'these TRACKED TypeScript files sit behind a directory name this file refuses to walk, so '
    + '§1 cannot see them and will report "every .ts file is covered" without having looked:\n  '
    + hidden.join('\n  ')
    + '\n\nEither the file is in the wrong place, or the SKIP_DIRS entry is. Do not resolve '
    + 'this by adding the path to a tsconfig — §1 would then pass for the wrong reason.');

  // The two entries that are not a claim about this repo at all — without them
  // the walk descends into vendored code and .git objects and never finishes.
  for (const required of ['node_modules', '.git']) {
    assert.ok(SKIP_DIRS.has(required),
      `SKIP_DIRS has lost '${required}'. That is not an exemption, it is what stops the walk `
      + 'inventorying tens of thousands of vendored files as "source the client owns".');
  }
});

// ────────────────────────── §1 · nothing outside a project ──────────────────

test('§1 every .ts file in the client is covered by some tsconfig project', () => {
  const { files, dirs } = sourceInventory();
  const cfgs = configs().map(resolveConfig);

  // ── non-vacuity: a walk or a config list that came back empty would make
  // every assertion below pass by finding nothing to check.
  assert.ok(cfgs.length >= 3,
    `only ${cfgs.length} tsconfig.json found under ${CLIENT} — the config walk has gone blind`);
  assert.ok(dirs.length >= 5,
    `only ${dirs.length} directories with .ts files found — the source walk has gone blind`);
  assert.ok(files.length >= 200,
    `only ${files.length} .ts files found — the source walk has gone blind`);

  const covered = new Set<string>(cfgs.flatMap(c => c.files));
  assert.ok(covered.size >= 200,
    `the ${cfgs.length} configs together claim only ${covered.size} files — `
    + 'their `include` globs have gone blind, so §1 would pass by covering nothing');

  const orphans = files.filter(f => !covered.has(f));
  const byDir = new Map<string, number>();
  for (const o of orphans) byDir.set(path.dirname(o), (byDir.get(path.dirname(o)) ?? 0) + 1);

  assert.deepEqual([...byDir.keys()].map(rel).sort(), [],
    'These directories hold .ts files that NO tsconfig.json includes, so nothing\n'
    + 'typechecks them. This is exactly how server/ went unchecked: the code was\n'
    + 'imported, tested and deployed, and `tsc` had simply never been pointed at it.\n'
    + 'Either add the directory to an existing `include`, or give it its own\n'
    + 'tsconfig.json AND wire it into the root `check` script (§2 checks that).\n\n'
    + [...byDir].map(([d, n]) => `  ${rel(d)}  (${n} file${n === 1 ? '' : 's'})`).join('\n')
    + `\n\nProjects that DO exist: ${cfgs.map(c => rel(c.dir) || '.').join(', ')}`);
});

// ────────────────────── §2 · the root check actually runs them ──────────────

/**
 * Flatten an npm script into the leaf shell commands it eventually runs, by
 * following `npm run` / `npm --prefix <dir> run` / `npm test` through the
 * package.json graph. Each leaf is tagged with the directory it runs IN,
 * because that is what decides which tsconfig.json a bare `tsc` picks up.
 */
function leafCommands(dir: string, script: string, seen = new Set<string>()): { dir: string; cmd: string }[] {
  const key = `${dir}::${script}`;
  if (seen.has(key)) return [];
  seen.add(key);

  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
  const body = pkg.scripts?.[script];
  if (body === undefined) return [];

  const out: { dir: string; cmd: string }[] = [];
  for (const seg of body.split(/&&|\|\||;/).map(s => s.trim()).filter(Boolean)) {
    const prefixed = /^npm\s+--prefix\s+(\S+)\s+(?:run\s+)?(\S+)/.exec(seg);
    const local = /^npm\s+(?:run\s+)?(\S+)/.exec(seg);
    if (prefixed) out.push(...leafCommands(path.resolve(dir, prefixed[1]!), prefixed[2]!, seen));
    else if (local) out.push(...leafCommands(dir, local[1]!, seen));
    else out.push({ dir, cmd: seg });
  }
  return out;
}

/** a command that will actually run the TypeScript compiler */
const RUNS_TSC = /(?:^|[\/\s])tsc(?:\s|$)/;

test('§2 the root `check` script invokes every tsconfig project', () => {
  const cfgs = configs().map(c => path.dirname(c));
  assert.ok(cfgs.length >= 3, `only ${cfgs.length} tsconfig.json found — the config walk has gone blind`);

  const leaves = leafCommands(CLIENT, 'check');
  assert.ok(leaves.length >= 3,
    `the root \`check\` script flattened to ${leaves.length} commands — either it is gone `
    + 'from digital-client/package.json or the script-graph walk stopped following npm run');

  // which project directory each tsc invocation checks: an explicit `-p <dir>`
  // wins, otherwise it is the directory the command runs in
  const checked = new Set<string>();
  for (const { dir, cmd } of leaves) {
    if (!RUNS_TSC.test(cmd)) continue;
    const p = /(?:-p|--project)\s+(\S+)/.exec(cmd);
    checked.add(p ? path.resolve(dir, p[1]!) : dir);
  }
  assert.ok(checked.size >= 1,
    'the root `check` script runs no tsc at all — it flattened to:\n'
    + leaves.map(l => `  (${rel(l.dir) || '.'}) ${l.cmd}`).join('\n'));

  const missed = cfgs.filter(d => !checked.has(d));
  assert.deepEqual(missed.map(d => rel(d) || '.').sort(), [],
    'These projects have a tsconfig.json that the root `check` never runs, so\n'
    + 'they are configured to be checked and then not checked — which is worse\n'
    + 'than having no config, because the config is what everyone reads as proof.\n'
    + '(server/ spent months here: root `check` said `npm --prefix server test`,\n'
    + 'and `node --test` type-STRIPS. It does not typecheck.)\n\n'
    + `  unchecked: ${missed.map(d => rel(d) || '.').join(', ')}\n`
    + `  checked:   ${[...checked].map(d => rel(d) || '.').sort().join(', ')}\n\n`
    + 'The root `check` flattens to:\n'
    + leaves.map(l => `  (${rel(l.dir) || '.'}) ${l.cmd}`).join('\n'));
});

// ────────────────────── §3 · the load-bearing flags, by name ────────────────

/**
 * One flag per entry, with the incident that argues for it. Named
 * individually and asserted individually on purpose: `deepEqual` on a whole
 * options object would fail with a diff nobody can act on, and would also
 * couple this test to every unrelated option. A flag turned off here should
 * name itself and say what it was protecting.
 */
const REQUIRED_FLAGS: { flag: string; why: string }[] = [
  {
    flag: 'strict',
    why: 'the baseline. Without it `null`/`undefined` are assignable everywhere and '
       + 'every parameter without an annotation is silently `any` — the server\'s '
       + 'socket callbacks were exactly that until R181 gave them a config.',
  },
  {
    flag: 'noUnusedLocals',
    why: 'CARD-TODO #60. `batch-light-a::payLife` had zero call sites and a doc '
       + 'comment asserting "pay n life as a COST at resolution", which all three '
       + 'life-cost cards had moved away from rulings earlier. A dead function was '
       + 'the file\'s most confident WRONG statement about how those cards work. '
       + '(It does not cover exported dead code — tsc ignores exports — which is '
       + 'why 147 §4\'s call-site sweep exists alongside it. Keep both.)',
  },
  {
    flag: 'noUncheckedIndexedAccess',
    why: 'the engine indexes tuples and records by seat, region and column '
       + 'constantly, and `Seat` is declared as `number`. Without this, every one '
       + 'of those reads claims to be total when it is not.',
  },
];

test('§3 every tsconfig has the load-bearing compiler flags on', () => {
  const cfgs = configs().map(resolveConfig);
  assert.ok(cfgs.length >= 3, `only ${cfgs.length} tsconfig.json found — the config walk has gone blind`);
  assert.ok(REQUIRED_FLAGS.length >= 3, 'REQUIRED_FLAGS has been emptied — §3 would assert nothing');

  for (const c of cfgs) {
    // guard against a config that resolved to nothing at all: an empty options
    // object would make every flag below read as "missing", but an options
    // object tsc could not produce is a different failure and should say so
    assert.ok(Object.keys(c.options).length >= 5,
      `tsc resolved ${rel(c.config)} to only ${Object.keys(c.options).length} options — `
      + 'the config did not load, so §3 is not measuring anything');

    for (const { flag, why } of REQUIRED_FLAGS) {
      assert.equal(c.options[flag], true,
        `${rel(c.config)} does not have \`${flag}\` on.\n\n${why}\n\n`
        + 'Every project under digital-client/ is checked to the same standard on\n'
        + 'purpose: a flag that is on in one config and off in another means code\n'
        + 'moved between them changes meaning, and "it typechecks" stops being one\n'
        + 'claim. Turn it back on and fix what it finds, or make the case in\n'
        + 'docs/digital-rules.md and change this list — but do not let the two\n'
        + 'drift silently.');
    }
  }
});
