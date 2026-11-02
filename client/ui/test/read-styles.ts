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
 */
import { STYLES_DIR } from '../../engine/scripts/paths.mjs';
import { concatStyles } from '../scripts/styles.mjs';

/** the client's whole stylesheet, as text, exactly as the browser is served it */
export function readStyles(): string {
  return concatStyles(STYLES_DIR);
}
