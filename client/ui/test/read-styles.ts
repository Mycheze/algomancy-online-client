/*
 * THE ONE WAY A TEST READS THE STYLESHEET.
 *
 * Some three dozen tests, in ui/test and engine/test, assert on the client's
 * CSS as TEXT: they regex a rule out of it, resolve a width, check that a class
 * is painted at all. Every one of them used to open `ui/style.css` for itself,
 * in five different spellings (`new URL('../style.css', …)`, `join(UI, …)`,
 * a local `read('style.css')`, …). That is fine while the stylesheet is one
 * file and fatal the day it is not: split it and three dozen tests go red, or
 * worse, go on passing against a stale file.
 *
 * So the stylesheet's LAYOUT ON DISK is known here and nowhere else.
 *
 * SINCE THE SPLIT (design-system Phase 1a, 2026-11-02) the stylesheet is the
 * pieces under `client/ui/styles/` (STYLES_DIR in engine/scripts/paths.mjs),
 * and readStyles() returns them concatenated in `styles/index.css` order —
 * through ui/scripts/styles.mjs, the same code the build writes bundle.css
 * with, so the text a test sees is byte for byte the file the browser is
 * served. It reads the SOURCES, not bundle.css: the bundle is gitignored and
 * absent in a fresh clone, and a test must not need a build to run. The
 * callers' regexes assume one text in source order with the comments still
 * in — both stay true.
 *
 * ui/test/910-styles-read-through-helper.test.ts fails on any test that reads
 * the stylesheet without coming through here; ui/test/920 holds the order
 * file, the pieces on disk and this function to one another.
 *
 * Three readers: readStyles() (the whole text — what nearly every test
 * wants), readStylePieces() (the same text per piece, for a guard about where
 * a thing is written) and resolveTokens() (a rule body with the design tokens
 * substituted, for a test that asserts a value a token now holds).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STYLES_DIR } from '../../engine/scripts/paths.mjs';
import { concatStyles, stylesOrder } from '../scripts/styles.mjs';

/** the client's whole stylesheet, as text, exactly as the browser is served it */
export function readStyles(): string {
  return concatStyles(STYLES_DIR);
}

/**
 * The same stylesheet, piece by piece, in cascade order: `{ piece, text }`
 * where `piece` is the path under styles/ (`pages/23-decks.css`). For a guard
 * that is about WHERE something is written — ui/test/921 counts colour
 * literals per piece — not for asserting on a rule, which is readStyles().
 */
export function readStylePieces(): { piece: string; text: string }[] {
  return stylesOrder(STYLES_DIR).map(piece => ({ piece, text: readFileSync(join(STYLES_DIR, piece), 'utf8') }));
}

/**
 * `text` with every `var(--name)` that a `:root` rule of the stylesheet
 * defines replaced by its value, recursively. Since the design-system tokens
 * (Phase 1b, 2026-11) a value the CSS used to spell as a literal may be spelled
 * as the token holding it — `font-size: var(--text-13)` where it said
 * `font-size: 13px`. A test asserting the VALUE resolves the rule body through
 * this first, so it checks what the browser computes and still fails if the
 * token's value moves. A var() with a fallback, or one :root does not define
 * (a runtime variable), is left as it is.
 */
export function resolveTokens(text: string, css: string = readStyles()): string {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const root = new Map<string, string>();
  for (const block of bare.matchAll(/(?:^|\})\s*:root\s*\{([^}]*)\}/g)) {
    for (const d of block[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
      if (!root.has(d[1]!)) root.set(d[1]!, d[2]!.trim());
    }
  }
  let out = text;
  for (let depth = 0; depth < 8; depth++) {
    const next = out.replace(/var\((--[\w-]+)\)/g, (m, name: string) => root.get(name) ?? m);
    if (next === out) return out;
    out = next;
  }
  throw new Error(`resolveTokens: var() nesting too deep in ${text.slice(0, 80)}`);
}
