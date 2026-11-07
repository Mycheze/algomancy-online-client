/* THE STYLESHEET, PUT BACK TOGETHER — the one implementation.
 *
 * The client's CSS lives in pieces under `client/ui/styles/` (STYLES_DIR) and
 * the browser gets ONE file, `client/ui/bundle.css`, which is those pieces
 * concatenated byte for byte, no separator, in the order `styles/index.css`
 * lists them. Two things need that concatenation and both come here:
 *
 *   ui/scripts/build-css.mjs   writes bundle.css (part of `npm run build`)
 *   ui/test/read-styles.ts     readStyles(), what every CSS-reading test sees
 *
 * WHY NOT esbuild. esbuild's CSS bundler re-prints the CSS: comments go,
 * whitespace changes, colours are shortened. Tests regex the stylesheet as
 * text with its comments in, and the split of the old style.css (2026-11-02)
 * was proved by `cmp` against it — both need the bytes left alone.
 *
 * THE ORDER FILE. `styles/index.css` is real CSS — a browser could load it —
 * but it may hold only comments and `@import "<relative path>";` lines, one
 * per piece. Anything else is an error, because anything else would be CSS
 * that the concatenation silently drops. ORDER IS THE CASCADE: the stylesheet
 * grew as a changelog of overrides, so a piece moved above a rule it
 * overrides changes the page. */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { STYLES_DIR, STYLES_INDEX } from '../../engine/scripts/paths.mjs';

/** parse an order file's text into its piece paths (relative to the styles dir) */
export function parseOrder(text) {
  const body = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const pieces = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const m = /^@import\s+"([\w./-]+\.css)";$/.exec(line);
    if (!m) throw new Error(`styles/index.css: not an @import line: ${JSON.stringify(line)}`);
    const p = m[1];
    if (p.startsWith('/') || p.split('/').includes('..') || p === 'index.css') {
      throw new Error(`styles/index.css: ${p} must be a piece inside styles/`);
    }
    if (pieces.includes(p)) throw new Error(`styles/index.css: ${p} is listed twice`);
    pieces.push(p);
  }
  if (pieces.length === 0) throw new Error('styles/index.css lists no pieces');
  return pieces;
}

/** the pieces, in cascade order, as paths relative to `dir` */
export function stylesOrder(dir = STYLES_DIR) {
  return parseOrder(readFileSync(dir === STYLES_DIR ? STYLES_INDEX : join(dir, 'index.css'), 'utf8'));
}

/** every `.css` file under `dir` except the order file, relative, `/`-separated, sorted */
export function stylesOnDisk(dir = STYLES_DIR) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.css')) out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.filter(p => p !== 'index.css').sort();
}

/** the whole stylesheet: every piece, in order, concatenated with nothing between */
export function concatStyles(dir = STYLES_DIR) {
  return stylesOrder(dir).map(p => readFileSync(join(dir, p), 'utf8')).join('');
}
