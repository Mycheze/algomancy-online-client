/*
 * 920 · THE STYLESHEET IS ITS PIECES, IN ONE ORDER
 *
 * Since the design-system round's Phase 1a (2026-11-02) the client's CSS is
 * not one file. It is the pieces under `client/ui/styles/` — tokens.css,
 * base.css, board/, pages/, shared/ — and `styles/index.css` lists them, one
 * `@import` each, in the order that IS the cascade: the old style.css grew as
 * a changelog of overrides, and the split (ui/scripts/split-styles.mjs) kept
 * every line where it was. The build writes `bundle.css` as their byte-for-byte
 * concatenation in that order; the tests read the same text through
 * readStyles(). Three ways for that to go quietly wrong, and this file fails
 * on each:
 *
 *   §1  readStyles() is the pieces, read one by one, concatenated in order —
 *       what the tests see is what the build serves
 *   §2  every piece the order file lists exists, once; every `.css` under
 *       styles/ is listed — a piece nobody imports is CSS that never reaches
 *       the page, and the build refuses it too
 *   §3  the order file holds only comments and @import lines, and its parser
 *       refuses anything else (the controls show it does)
 *   §4  every piece ends at a line end, so concatenation never glues the last
 *       line of one piece to the first of the next
 *   §5  the page links bundle.css; the build writes it; git ignores it
 *   §6  the old single file is gone. A branch cut before the split that still
 *       edits it merges as a modify/delete conflict — and resolving that by
 *       keeping it would leave CSS edits in a file nothing loads. Move them
 *       into the piece they belong to (or re-run the split on that file).
 *
 * The one test besides read-styles.ts allowed to look at the layout on disk
 * (910 §2 names it).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { STYLES_DIR, STYLES_INDEX, UI_DIR } from '../../engine/scripts/paths.mjs';
import { parseOrder, stylesOrder } from '../scripts/styles.mjs';
import { readStyles } from './read-styles.ts';

/** every `.css` under styles/, walked here rather than through styles.mjs */
function onDisk(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.css')) out.push(relative(STYLES_DIR, p).split(sep).join('/'));
    }
  };
  walk(STYLES_DIR);
  return out.filter(p => join(STYLES_DIR, p) !== STYLES_INDEX).sort();
}

const order = stylesOrder();

test('§1 readStyles() is the listed pieces, read one by one, concatenated in order', () => {
  assert.ok(order.length >= 40, `only ${order.length} pieces listed — this is not the split stylesheet`);
  const byHand = order.map(p => readFileSync(join(STYLES_DIR, p), 'utf8')).join('');
  const css = readStyles();
  assert.ok(css.length > 100_000, `readStyles() returned ${css.length} characters`);
  assert.equal(css, byHand, 'readStyles() is not the pieces concatenated in styles/index.css order');
  assert.ok(order[0]!.startsWith('tokens.') && /^:root \{/m.test(readFileSync(join(STYLES_DIR, order[0]!), 'utf8')),
    'the first piece is not the tokens — the cascade starts somewhere else');
});

test('§2 every listed piece exists, once; every piece on disk is listed', () => {
  assert.equal(new Set(order).size, order.length, 'a piece is listed twice');
  const missing = order.filter(p => !existsSync(join(STYLES_DIR, p)));
  assert.deepEqual(missing, [], `styles/index.css lists pieces that do not exist: ${missing.join(', ')}`);
  const listed = new Set(order);
  const stray = onDisk().filter(p => !listed.has(p));
  assert.deepEqual(stray, [],
    `these .css files under styles/ are in no @import line of styles/index.css, so they never reach the page: ${stray.join(', ')}`);
  assert.equal(onDisk().length, order.length);
});

test('§3 the order file is only comments and @import lines — and the parser refuses anything else', () => {
  const text = readFileSync(STYLES_INDEX, 'utf8');
  assert.deepEqual(parseOrder(text), order);
  const ok = '/* c */\n@import "a.css";\n@import "board/01-b.css";\n';
  assert.deepEqual(parseOrder(ok), ['a.css', 'board/01-b.css'], 'the parser rejects a well-formed order file');
  const refused: Array<[string, RegExp]> = [
    ['@import "a.css";\n.rule { color: red; }\n', /not an @import line/],
    ['@import "a.css";\n@import "a.css";\n', /listed twice/],
    ['@import "../a.css";\n', /inside styles/],
    ["@import 'a.css';\n", /not an @import line/],
    ['/* nothing */\n', /no pieces/],
  ];
  for (const [src, why] of refused) assert.throws(() => parseOrder(src), why, `parseOrder accepted: ${JSON.stringify(src)}`);
});

test('§4 every piece is whole lines: non-empty, and ending in a newline', () => {
  for (const p of order) {
    const t = readFileSync(join(STYLES_DIR, p), 'utf8');
    assert.ok(t.length > 0, `${p} is empty`);
    assert.ok(t.endsWith('\n'), `${p} does not end with a newline — its last line would run into the next piece's first`);
  }
});

test('§5 the page links bundle.css; the build writes it; git ignores it', () => {
  const html = readFileSync(join(UI_DIR, 'index.html'), 'utf8');
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
  assert.deepEqual(links, ['bundle' + '.css'], `index.html links ${JSON.stringify(links)}`);
  const pkg = JSON.parse(readFileSync(join(UI_DIR, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.match(pkg.scripts.build ?? '', /^node scripts\/build-css\.mjs && /, 'npm run build no longer writes bundle.css');
  const ignore = readFileSync(join(UI_DIR, '.gitignore'), 'utf8').split('\n').map(l => l.trim());
  assert.ok(ignore.includes('bundle' + '.css'), 'bundle.css is generated and must be gitignored, like bundle.js');
});

test('§6 the old single stylesheet is gone', () => {
  const old = join(UI_DIR, 'style') + '.css';
  assert.ok(!existsSync(old),
    'client/ui/style.css is back — nothing loads it since the split. A pre-split branch merged it in? '
    + 'Move its new lines into the piece under styles/ where they sat, then delete it.');
});
