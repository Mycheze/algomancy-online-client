/*
 * 910 · EVERY TEST READS THE STYLESHEET THROUGH readStyles()
 *
 * Three dozen tests assert on the client's CSS as text. Until 2026-11-02 each
 * opened `ui/style.css` for itself, in five spellings, which made the
 * stylesheet's layout on disk load-bearing in three dozen places at once: split
 * it into `ui/styles/*.css` (the design-system round's Phase 1) and every one of
 * them breaks, or reads a file that is no longer what the browser gets.
 *
 * Now there is one reader, `ui/test/read-styles.ts`, and one place that knows
 * the layout: STYLES_DIR in engine/scripts/paths.mjs (since the Phase 1a split,
 * 2026-11-02, the pieces under `ui/styles/`; STYLE_CSS, the single file, before
 * it), concatenated by ui/scripts/styles.mjs. This file keeps it that way: it
 * fails on any test, harness or ledger that names a stylesheet path itself.
 *
 *   §0  non-vacuity — the corpus is the real one, the readers are in it, and
 *       the detector catches every spelling the old readers used
 *   §1  no file but read-styles.ts names a `.css` path as a string
 *   §2  no file but read-styles.ts reaches the stylesheet's paths or
 *       ui/scripts/styles.mjs
 *
 * 920, the guard of the split's layout, is out of the corpus like the helper:
 * checking the order file against the disk is its job.
 *
 * WHAT IT DOES NOT SEE. A path built by concatenation ('style' + '.css'), and
 * the HTTP fetch of `/bundle.css` in server/e2e/test-malformed.ts, which asks
 * the SERVER for the file rather than reading the disk (a template with
 * `${PORT}` in it, so the detector passes over it). That one is about what
 * the server serves; the split changes it separately.
 *
 * Prose is exempt: comments that start a line are stripped before the scan, and
 * a ledger's `touches: [...]` list names files a change touched, not files it
 * reads. A string like 'style.css has no rule for x' is not a path (it has a
 * space in it) and never matched.
 *
 * ⚠ §0 IS NOT DECORATION. "No file matches" is also what an empty corpus, or a
 * detector that matches nothing, would say. Never delete a control to go green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import {
  ENGINE_TEST_DIR, LEDGERS_DIR, REPO_ROOT, SERVER_E2E_DIR, SERVER_TEST_DIR, UI_TEST_DIR,
} from '../../engine/scripts/paths.mjs';
import { readStyles } from './read-styles.ts';

const HELPER = join(UI_TEST_DIR, 'read-styles.ts');
const SELF = join(UI_TEST_DIR, '910-styles-read-through-helper.test.ts');
/** the split's own guard: it checks the order file against the disk, so it
 *  has to look at the layout readStyles() hides — out of the corpus, like
 *  the helper itself */
const LAYOUT_GUARD = join(UI_TEST_DIR, '920-styles-split-order.test.ts');

/** every code file under the four test trees, the e2e scripts and the ledgers */
function corpus(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mts|mjs|js)$/.test(e.name)) out.push(p);
    }
  };
  for (const d of [ENGINE_TEST_DIR, UI_TEST_DIR, SERVER_TEST_DIR, SERVER_E2E_DIR, LEDGERS_DIR]) walk(d);
  return out.filter(p => p !== HELPER && p !== SELF && p !== LAYOUT_GUARD).sort();
}

/** the text with line-leading comments and ledger `touches` lists removed */
function code(src: string): string {
  return src
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\btouches:\s*\[[^\]]*\]/g, '');
}

/** a string literal that is, whole, a path to a stylesheet: 'style.css',
 *  '../style.css', `styles/board.css`, "bundle.css" */
const CSS_PATH = /(['"`])(?:[\w.-]*\/)*[\w.-]+\.css\1/g;

const cssPaths = (src: string): string[] => code(src).match(CSS_PATH) ?? [];

const rel = (p: string): string => relative(REPO_ROOT, p);

/* ════════════════════════════════════════════════════════════════════════
 * 0. NON-VACUITY
 * ════════════════════════════════════════════════════════════════════════ */

test('§0 POSITIVE CONTROL: the corpus is the real test tree and the readers are in it', () => {
  const files = corpus();
  assert.ok(files.length > 500, `only ${files.length} files scanned — the walk is not reaching the test trees`);
  for (const known of ['247-asset-paths.test.ts', 'ui-driver.ts', '70-playtest-round15.test.ts', 'test-malformed.ts', 'backlog.ts']) {
    assert.ok(files.some(f => basename(f) === known), `${known} is not in the corpus`);
  }
  const readers = files.filter(f => /from '(?:\.\/|\.\.\/\.\.\/ui\/test\/)read-styles\.ts'/.test(readFileSync(f, 'utf8')));
  assert.ok(readers.length >= 30, `only ${readers.length} files import readStyles() — the switch-over is not what this file guards`);
  assert.ok(readers.some(f => f.startsWith(ENGINE_TEST_DIR)), 'no engine test reads through the helper — the cross-tree import is not being seen');
});

test('§0 POSITIVE CONTROL: the detector catches every spelling the old readers used, and passes prose', () => {
  const caught = [
    "const CSS = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8');",
    "const CSS = readFileSync(new URL('../../ui/style.css', import.meta.url), 'utf8');",
    "const CSS = readFileSync(join(REPO_ROOT, 'client', 'ui', 'style.css'), 'utf8');",
    "const CSS = read('../style.css');",
    "const css = src(\"style.css\");",
    'const css = readFileSync(`styles/board.css`, "utf8");',
    "const css = readFileSync(join(UI, 'bundle.css'), 'utf8');",
  ];
  for (const s of caught) assert.equal(cssPaths(s).length, 1, `the detector misses: ${s}`);
  const passed = [
    "assert.ok(m, `ui/style.css has no rule for \\`${sel}\\``);",
    "  // the grid puts it there (see 'style.css')",
    "/** resolved out of '../style.css' */",
    "    touches: [\n      'client/ui/style.css',\n    ],",
    'await fetch(`http://localhost:${PORT}/style.css`);',
  ];
  for (const s of passed) assert.deepEqual(cssPaths(s), [], `the detector flags prose: ${s}`);
});

test('§0 POSITIVE CONTROL: readStyles() returns the stylesheet', () => {
  const css = readStyles();
  assert.ok(css.length > 10_000, `readStyles() returned ${css.length} characters`);
  assert.match(css, /#app\.board\b[^{]*\{/, 'the stylesheet has no #app.board rule — this is not the client\'s CSS');
});

/* ════════════════════════════════════════════════════════════════════════
 * 1–2. THE GUARD
 * ════════════════════════════════════════════════════════════════════════ */

test('§1 no test, harness or ledger names a stylesheet path — they call readStyles()', () => {
  const bad = corpus()
    .map(f => [rel(f), cssPaths(readFileSync(f, 'utf8'))] as const)
    .filter(([, hits]) => hits.length > 0);
  assert.deepEqual(bad, [],
    'these files name a .css path themselves. Read the stylesheet with readStyles() from '
    + 'ui/test/read-styles.ts (engine tests: ../../ui/test/read-styles.ts) — it is the one place '
    + 'that knows how the stylesheet is laid out on disk:\n'
    + bad.map(([f, hits]) => `  ${f}: ${hits.join(', ')}`).join('\n'));
});

/** the names that reach the stylesheet's files: its paths in paths.mjs (the
 *  old single file's too, should it come back) and the concatenating module */
const LAYOUT = /\b(?:STYLE_CSS|STYLES_DIR|STYLES_INDEX|BUNDLE_CSS)\b|scripts\/styles\.mjs/;

test('§2 only read-styles.ts (and 920, the split\'s guard) reaches the stylesheet\'s files', () => {
  const bad = corpus().filter(f => LAYOUT.test(code(readFileSync(f, 'utf8')))).map(rel);
  assert.deepEqual(bad, [], `these files reach the stylesheet's files directly; call readStyles() instead: ${bad.join(', ')}`);
  assert.match(readFileSync(HELPER, 'utf8'), /\bSTYLES_DIR\b/, 'read-styles.ts no longer reads STYLES_DIR — update §2 to name what it reads now');
  assert.ok(LAYOUT.test("import { concatStyles } from '../scripts/styles.mjs';"), 'the §2 detector misses an import of the concatenating module');
});
