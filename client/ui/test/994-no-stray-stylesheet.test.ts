/* 994 · NO STRAY STYLESHEET (design-system Phase 5)
 *
 * The client's CSS is the pieces under ui/styles/, in the order styles/index.css
 * gives (920 holds that list to the disk). Everything else would be CSS the
 * cascade does not know about:
 *
 *   §1  no `style.css` anywhere in the client — the old single stylesheet, or a
 *       new one started beside the pieces (920 §6 watches only ui/style.css)
 *   §2  no `.css` file under ui/ or storybook/ outside ui/styles/, except the
 *       generated, gitignored ui/bundle.css (and Storybook's own build output)
 *   §3  no client module injects a `<style>` of its own — legal.ts did until
 *       2026-11-03, invisible to every guard and to the cascade order. ALLOW
 *       names the one left, with its reason.
 *
 * File names are matched with regexes, not spelled as strings: 910 forbids a
 * test to name a stylesheet path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { REPO_ROOT, STORYBOOK_DIR, UI_DIR } from '../../engine/scripts/paths.mjs';

const CLIENT = join(REPO_ROOT, 'client');
const STYLES = join(UI_DIR, 'styles');
const SKIP = new Set(['node_modules', 'storybook-static', '.git']);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (SKIP.has(e.name)) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}

const OLD_SINGLE = /^style\.css$/;
const IS_CSS = /\.css$/;
const BUNDLE = /^bundle\.css$/;
/** a `<style>` element made in code, or written as markup */
const INJECTS = /createElement\(\s*['"`]style['"`]\s*\)|<style[\s>]/;

/** modules allowed to inject a `<style>`, with the reason */
const ALLOW: Record<string, string> = {
  'sandbox.ts': 'the test-mode panel (out of the design system\'s scope, docs/23); it carries its own CSS so a headless '
    + 'document without the pieces still gets it, and 275 asserts it installs',
};

/** the client's own modules: ui/**.ts, without the tests */
const uiModules = (): string[] => files(UI_DIR)
  .filter(f => f.endsWith('.ts') && !relative(UI_DIR, f).startsWith(`test${sep}`));

test('§0 non-vacuity: the walk reaches the pieces and the modules; the detectors work', () => {
  const css = files(UI_DIR).filter(f => IS_CSS.test(f));
  assert.ok(css.filter(f => f.startsWith(STYLES + sep)).length >= 60, 'the walk does not reach ui/styles/');
  assert.ok(uiModules().length >= 120, 'the walk does not reach the ui modules');
  assert.ok(INJECTS.test("const s = document.createElement('style');"));
  assert.ok(INJECTS.test('head.insertAdjacentHTML(\'beforeend\', `<style id="x">a{}</style>`);'));
  assert.ok(!INJECTS.test("const styled = el.style; el.setAttribute('style', s);"));
  assert.ok(OLD_SINGLE.test('style' + '.css') && !OLD_SINGLE.test('board-style' + '.css'));
});

test('§1 no style.css anywhere in the client', () => {
  const found = files(CLIENT).filter(f => OLD_SINGLE.test(f.split(sep).pop()!)).map(f => relative(REPO_ROOT, f));
  assert.deepEqual(found, [],
    'a single stylesheet is back. Nothing loads it: the CSS is the pieces under client/ui/styles/, listed in '
    + 'styles/index.css. Move its rules into the piece where they belong');
});

test('§2 every .css under ui/ and storybook/ is a piece under ui/styles/ (or the generated bundle)', () => {
  const stray = [...files(UI_DIR), ...files(STORYBOOK_DIR)]
    .filter(f => IS_CSS.test(f))
    .filter(f => !f.startsWith(STYLES + sep))
    .filter(f => !(BUNDLE.test(relative(UI_DIR, f))))
    .map(f => relative(REPO_ROOT, f));
  assert.deepEqual(stray, [],
    'a stylesheet outside ui/styles/: make it a piece there and @import it in styles/index.css at its place in the cascade');
});

test('§3 no client module injects a <style> (outside ALLOW)', () => {
  const bad = uiModules()
    .filter(f => INJECTS.test(readFileSync(f, 'utf8')))
    .map(f => relative(UI_DIR, f))
    .filter(f => !(f in ALLOW));
  assert.deepEqual(bad, [],
    'these modules write their own <style>: move the CSS into a piece under ui/styles/ (legal.ts did, 2026-11-03: '
    + 'pages/48-legal.css)');
  for (const f of Object.keys(ALLOW)) {
    assert.ok(INJECTS.test(readFileSync(join(UI_DIR, f), 'utf8')), `${f} no longer injects a <style> — drop it from ALLOW`);
  }
});
