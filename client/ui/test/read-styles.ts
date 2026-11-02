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
 *   TODAY      it is one file, `client/ui/style.css` (STYLE_CSS in
 *              engine/scripts/paths.mjs), and readStyles() returns its bytes
 *              exactly as readFileSync would.
 *   THE SPLIT  when style.css becomes several files under `client/ui/styles/`
 *              that esbuild bundles into a gitignored `bundle.css`, change the
 *              BODY OF readStyles() ONLY — return the concatenation of the
 *              styles/ files in the bundle's import order (read the order off
 *              the entry file, never a hand-kept list), name the directory in
 *              paths.mjs beside STYLE_CSS, and every reader follows. Read the
 *              SOURCES, not bundle.css: the bundle is gitignored and absent
 *              in a fresh clone, and a test must not need a build to run.
 *              The callers' regexes assume one text in source order with the
 *              comments still in — keep both true.
 *
 * ui/test/910-styles-read-through-helper.test.ts fails on any test that reads
 * the stylesheet without coming through here.
 */
import { readFileSync } from 'node:fs';

import { STYLE_CSS } from '../../engine/scripts/paths.mjs';

/** the client's whole stylesheet, as text, exactly as the browser is served it */
export function readStyles(): string {
  return readFileSync(STYLE_CSS, 'utf8');
}
