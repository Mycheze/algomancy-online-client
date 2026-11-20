/* Every `var(--name)` without a fallback names a custom property something defines.
 *
 * A var() naming nothing makes its declaration invalid at computed-value time:
 * the property falls back to inherited-or-initial, and nothing warns:
 * `font-size: var(--text-18)` on a scale with no 18 draws the parent's size.
 *
 * Defined = a `--name:` declaration in the stylesheet, or in a ui source's
 * markup or CSS string (`style="--k:3"`), or a `setProperty('--name', …)`.
 * A var() with a fallback is the author saying the name may be absent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readStyles } from './read-styles.ts';
import { UI_COMPONENTS_DIR, UI_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const tsIn = (dir: string): { file: string; text: string }[] =>
  readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => ({ file: join(dir, f).slice(UI_DIR.length + 1), text: readFileSync(join(dir, f), 'utf8') }));

const sources = [
  { file: 'styles/', text: stripComments(readStyles()) },
  ...[UI_DIR, UI_PAGES_DIR, UI_COMPONENTS_DIR].flatMap(tsIn),
];

/** the custom properties `texts` define */
function definedIn(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(/(--[\w-]+)\s*:/g)) out.add(m[1]!);
    for (const m of t.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) out.add(m[1]!);
  }
  return out;
}

/** `file:name` for every fallback-less var() in `srcs` whose name `defined` lacks */
function undefinedUses(srcs: readonly { file: string; text: string }[], defined: Set<string>): string[] {
  const out: string[] = [];
  for (const { file, text } of srcs) {
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) if (!defined.has(m[1]!)) out.push(`${file}: ${m[1]}`);
  }
  return out;
}

const defined = definedIn(sources.map(s => s.text));
const uses = sources.reduce((n, s) => n + [...s.text.matchAll(/var\(\s*--[\w-]+\s*\)/g)].length, 0);

test('there are var() uses and definitions to check (positive control)', () => {
  assert.ok(uses > 1000, `${uses} fallback-less var() uses`);
  assert.ok(defined.has('--text-22') && defined.has('--color-accent'), 'the tokens are read');
});

test('the check finds a size the scale never defined', () => {
  const probe = [{ file: 'a probe rule', text: '.x { font-size: var(--text-18); color: var(--nope, red); }' }];
  assert.deepEqual(undefinedUses(probe, defined), ['a probe rule: --text-18'], 'a var() with a fallback is left alone');
});

test('every fallback-less var() in the client names a defined custom property', () => {
  assert.deepEqual(undefinedUses(sources, defined), [], 'the declaration is dropped at computed time');
});

test('the builder title steps down to 18px on a tablet', () => {
  const css = stripComments(readStyles());
  const tablet = css.match(/@media \(max-width: 1100px\) \{\s*\.ttpage \.frametop \.ui-icon-button__label[^}]*\}\s*\.tttitlebtn \{([^}]*)\}/)?.[1] ?? '';
  assert.match(tablet, /font-size:\s*18px/);
});
