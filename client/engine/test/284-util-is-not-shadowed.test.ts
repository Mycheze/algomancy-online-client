/* 284 · A TEST FILE MAY NOT REDECLARE WHAT test/util.ts EXPORTS
 *
 * util.ts's `withE` absorbs the events a white-box call produced back into the
 * harness (see its docstring — that is the whole point of it). Seven test
 * files imported util.ts and then declared their own `withE` above it. Five
 * were byte-for-byte copies from before `absorb` existed, so every event they
 * produced went nowhere; a later assertion over `h.log` or `h.events` in one
 * of those files would have been measuring air. None was, yet — a loaded gun,
 * not a firing one, exactly as 197 says of the absorb copies it hunts by
 * SHAPE. This one hunts by NAME: a top-level declaration in any test
 * directory whose name util.ts exports is a shadow, and fails here.
 *
 * A variant that differs on purpose is allowed — under a name that says so
 * (`withEUnsettled`, `withERaw`). The rule is "do not hide a difference
 * behind the shared name", not "never write a helper". And it applies to
 * files that IMPORT util.ts: a redeclaration next to the import is the
 * shadow. A file that imports nothing from util.ts and writes its own `give`
 * (217-reveal-rows, 203-reveal-escapes-the-hidden-hold) is a reimplementation
 * — worth folding, not a trap, and not this file's business.
 *
 * §0 reach: util.ts exports enough to be worth guarding, and the scan opens
 *    every test directory (engine/, ui/, server/), not just this one.
 * §1 the lint.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..', '..');
const DIRS = ['engine/test', 'ui/test', 'server/test'].map(d => path.join(CLIENT, d));

const UTIL = fs.readFileSync(path.join(HERE, 'util.ts'), 'utf8');
const EXPORTS = [...UTIL.matchAll(/^export (?:async )?(?:function|const|let) (\w+)/gm)].map(m => m[1]!);

const files = DIRS.flatMap(d => fs.readdirSync(d).filter(f => f.endsWith('.ts') && f !== 'util.ts').map(f => path.join(d, f)));

test('§0 reach: util.ts exports a real helper set, and every test directory is opened', () => {
  assert.ok(EXPORTS.length >= 15, `only ${EXPORTS.length} exports read from util.ts — the regex has gone blind`);
  assert.ok(EXPORTS.includes('withE') && EXPORTS.includes('absorb'), 'withE and absorb must be among them');
  for (const d of DIRS) assert.ok(fs.existsSync(d), `${d} is missing — the scan would be partial`);
  assert.ok(files.length > 200, `only ${files.length} test files found across the three directories`);
});

test('§1 no test file declares a top-level helper under a name util.ts already exports', () => {
  const shadows: string[] = [];
  const decl = new RegExp(`^(?:export )?(?:async )?(?:function|const|let) (${EXPORTS.join('|')})\\b`, 'gm');
  let importers = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (!/from '(?:\.\.\/)*(?:engine\/test\/|\.\/)util\.ts'/.test(src)) continue;
    importers++;
    for (const m of src.matchAll(decl)) shadows.push(`${path.relative(CLIENT, f)}: ${m[1]}`);
  }
  assert.ok(importers > 150, `only ${importers} files import util.ts — the import regex has gone blind`);
  assert.deepEqual(shadows, [],
    'these files redeclare a helper util.ts exports — import it, or rename the local one to say how it differs:\n  ' + shadows.join('\n  '));
});
