/* 996 · THE MAPS NAME EVERY PIECE (design-system Phase 5)
 *
 * The next person finds their way by three READMEs. They rot silently: a page
 * moves into ui/pages/ and the table still says it is in its old module. So:
 *
 *   §1  ui/pages/README.md's "What is here now" table has a row for every
 *       ui/pages/*.ts, and names no file that is not there
 *   §2  ui/components/README.md's table has a row for every component file
 *       (not index.ts, not the `_` helpers), and names none that is gone
 *   §3  ui/README.md links both READMEs and the order file, and names every
 *       Phase 5 guard by number with a test file behind it
 *   §4  the repo's CLAUDE.md "Where things are" lists the four directories
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, UI_COMPONENTS_DIR, UI_DIR, UI_PAGES_DIR, UI_TEST_DIR } from '../../engine/scripts/paths.mjs';

/** the rows of the first markdown table after `heading`, as their first cell */
function firstCells(md: string, heading: string): string[] {
  const at = md.indexOf(heading);
  assert.ok(at >= 0, `no "${heading}" in the README`);
  const lines = md.slice(at).split('\n').slice(1);
  const start = lines.findIndex(l => l.startsWith('|'));
  const out: string[] = [];
  for (const l of lines.slice(start + 2)) {
    if (!l.startsWith('|')) break;
    out.push((l.split('|')[1] ?? '').trim());
  }
  return out;
}

/** `` `home.ts` `` → home.ts; anything else as it is */
const fileOf = (cell: string): string => (/`([\w.-]+\.ts)`/.exec(cell)?.[1] ?? cell);

test('§1 pages/README.md names every page module, and only those', () => {
  const md = readFileSync(join(UI_PAGES_DIR, 'README.md'), 'utf8');
  const named = firstCells(md, '## What is here now').map(fileOf);
  const onDisk = readdirSync(UI_PAGES_DIR).filter(f => f.endsWith('.ts')).sort();
  assert.ok(onDisk.length >= 20 && named.length >= 20, 'the table or the directory is not being read');
  assert.deepEqual(onDisk.filter(f => !named.includes(f)), [],
    'ui/pages/ has modules the README\'s "What is here now" table does not name — add a row (file, exports, what, where its state lives)');
  assert.deepEqual(named.filter(f => !onDisk.includes(f)), [], 'the README names page modules that are not in ui/pages/');
});

test('§2 components/README.md names every component, and only those', () => {
  const md = readFileSync(join(UI_COMPONENTS_DIR, 'README.md'), 'utf8');
  const files = [...md.matchAll(/^\| [^|]+ \| `([\w-]+\.ts)` \|/gm)].map(m => m[1]!);
  const onDisk = readdirSync(UI_COMPONENTS_DIR).filter(f => f.endsWith('.ts') && f !== 'index.ts' && !f.startsWith('_')).sort();
  assert.ok(onDisk.length >= 13, 'the components directory is not being read');
  assert.deepEqual(onDisk.filter(f => !files.includes(f)), [], 'components the README\'s table does not list — add a row with its variants');
  assert.deepEqual(files.filter(f => !onDisk.includes(f)), [], 'the README lists components that are gone');
});

test('§3 ui/README.md points at the maps and names the guards', () => {
  const md = readFileSync(join(UI_DIR, 'README.md'), 'utf8');
  for (const link of ['pages/README.md', 'components/README.md', '../storybook/README.md']) {
    assert.ok(md.includes(`(${link})`), `ui/README.md does not link ${link}`);
    assert.ok(existsSync(join(UI_DIR, link)), `ui/README.md links ${link}, which does not exist`);
  }
  // the order file and the tokens (regexes, not path strings: 910; 920 holds them to the disk)
  assert.match(md, /\(styles\/index\.css\)/, 'ui/README.md does not link the order file');
  assert.match(md, /\(styles\/tokens\.css\)/, 'ui/README.md does not link the tokens');
  const tests = readdirSync(UI_TEST_DIR);
  for (const n of ['920', '921', '925', '940', '962', '992', '993', '994', '995', '996']) {
    assert.match(md, new RegExp(`\\b${n}\\b`), `ui/README.md's guard list does not name ${n}`);
    assert.ok(tests.some(f => f.startsWith(`${n}-`)), `ui/README.md names guard ${n}, but there is no ui/test/${n}-*.test.ts`);
  }
});

test('§4 CLAUDE.md lists the design system\'s directories', () => {
  const md = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  const where = md.slice(md.indexOf('## Where things are'), md.indexOf('## Paths are named once'));
  for (const dir of ['client/ui/styles/', 'client/ui/pages/', 'client/ui/components/', 'client/storybook/']) {
    assert.match(where, new RegExp(`^${dir.replace(/\//g, '\\/')}\\s`, 'm'), `CLAUDE.md "Where things are" has no line for ${dir}`);
  }
});
