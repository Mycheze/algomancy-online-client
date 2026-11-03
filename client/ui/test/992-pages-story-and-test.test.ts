/* 992 · EVERY PAGE HAS A STORY AND A DOM-FREE TEST (design-system Phase 5)
 *
 * A page module under ui/pages/ that exports a `…Html` renderer is only worth
 * the split if it can be looked at and checked without the client: so each one
 * must be IMPORTED by
 *   - a story under client/storybook/stories/ (where the owner iterates the
 *     design, from made-up views), and
 *   - a test under ui/test/ that needs no DOM: it does not drive the client
 *     (test/ui-driver.ts), import main.ts, or plant a document/window.
 * A module whose exports include no `…Html` (pages/caret.ts) is not a page.
 *
 *   §0  non-vacuity: the pages, stories and tests are found, and the import and
 *       DOM detectors catch what they should
 *   §1  each page module is imported by a story
 *   §2  each page module is imported by a DOM-free test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { STORYBOOK_STORIES_DIR, UI_PAGES_DIR, UI_TEST_DIR } from '../../engine/scripts/paths.mjs';

const walk = (dir: string, keep: (f: string) => boolean): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = join(dir, e.name);
  return e.isDirectory() ? walk(p, keep) : keep(e.name) ? [p] : [];
});

/** the page modules: a .ts under ui/pages/ exporting a function or const named …Html */
function pages(): string[] {
  return readdirSync(UI_PAGES_DIR).filter(f => f.endsWith('.ts'))
    .filter(f => /^export (?:function|const) [A-Za-z]+Html\b/m.test(readFileSync(join(UI_PAGES_DIR, f), 'utf8')))
    .map(f => basename(f, '.ts')).sort();
}

/** `from '../pages/x.ts'`, `from '../../ui/pages/x.ts'`, `import('../pages/x.ts')` — not a path read as text */
const importsPage = (src: string, page: string): boolean =>
  new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*)['"](?:\\.\\.?/)+(?:ui/)?pages/${page}\\.ts['"]`).test(src);

const DOM = /ui-driver(?:\.ts)?['"]|(?:\bfrom\s*|\bimport\s*\(?\s*)['"][./]*main\.ts['"]|\bglobalThis\b[^;\n]*?\.(?:document|window)\s*=|\b(?:jsdom|linkedom|happy-dom)\b/;
const domFree = (src: string): boolean => !DOM.test(src);

const stories = (): Array<[string, string]> =>
  walk(STORYBOOK_STORIES_DIR, f => f.endsWith('.ts')).map(f => [f, readFileSync(f, 'utf8')]);
const tests = (): Array<[string, string]> =>
  walk(UI_TEST_DIR, f => f.endsWith('.test.ts')).map(f => [f, readFileSync(f, 'utf8')]);

test('§0 non-vacuity: pages, stories and tests found; the detectors work', () => {
  const ps = pages();
  assert.ok(ps.length >= 20, `only ${ps.length} page modules found under ${UI_PAGES_DIR}`);
  for (const p of ['home', 'league', 'admin', 'profile']) assert.ok(ps.includes(p), `pages/${p}.ts is not seen as a page`);
  assert.ok(!ps.includes('caret'), 'caret.ts exports no …Html and is not a page');
  assert.ok(stories().length >= 30 && tests().length >= 150, 'the story or test trees are not being reached');

  assert.ok(importsPage("import { homeHtml } from '../pages/home.ts';", 'home'));
  assert.ok(importsPage("import { homeHtml } from '../../ui/pages/home.ts';", 'home'));
  assert.ok(importsPage("const { x } = await import('../pages/home.ts');", 'home'));
  assert.ok(!importsPage("readFileSync(new URL('../pages/home.ts', import.meta.url))", 'home'), 'a source read is not an import');
  assert.ok(!importsPage("import { x } from '../pages/homey.ts';", 'home'));

  assert.ok(!domFree("import { home } from './ui-driver.ts';"));
  assert.ok(!domFree("(globalThis as any).document = fake;"));
  assert.ok(!domFree("import '../main.ts';"));
  assert.ok(domFree("import { homeHtml } from '../pages/home.ts';"));
});

test('§1 every page module is imported by a story', () => {
  const ss = stories();
  const missing = pages().filter(p => !ss.some(([, src]) => importsPage(src, p)));
  assert.deepEqual(missing, [],
    'these ui/pages/ modules have no story: add client/storybook/stories/pages/<page>.stories.ts rendering its …Html '
    + 'from made-up views (stories/pages/_page.ts has the frame)');
});

test('§2 every page module is imported by a DOM-free test', () => {
  const ts = tests().filter(([, src]) => domFree(src));
  const missing = pages().filter(p => !ts.some(([, src]) => importsPage(src, p)));
  assert.deepEqual(missing, [],
    'these ui/pages/ modules have no DOM-free test: add ui/test/<n>-page-<page>-html.test.ts that imports the page '
    + 'and renders its …Html from made-up views (960–962 are the pattern)');
});
