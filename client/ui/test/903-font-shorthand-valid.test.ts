/* No `font:` shorthand mixes a CSS-wide keyword with other values.
 *
 * `font: 700 19px/1.2 inherit` reads like "these, in the inherited family",
 * but `inherit` (like `initial`, `unset`, `revert`) is only valid as the WHOLE
 * value. Mixed with anything it makes the declaration invalid, the browser
 * drops it, and the element falls back to whatever is left — for an <input>
 * that is the user agent's 13.33px Arial. Four rules did this for months
 * (found 2026-11-02): the deck page's title (meant 700 19px, drawn 400 13px),
 * the How-to-play search box, the card browser's list names (lost their bold)
 * and the lesson judge box. Spell the family as `font-family: inherit` and the
 * rest as longhands.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles, resolveTokens } from './read-styles.ts';

const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
const fonts = [...css.matchAll(/(?<![\w-])font\s*:\s*([^;}]+)/g)].map(m => m[1]!.trim());

test('the stylesheet has font shorthands to check (positive control)', () => {
  assert.ok(fonts.length > 10, `${fonts.length} found`);
});

test('a CSS-wide keyword in a font shorthand stands alone', () => {
  const bad = fonts.filter(v => /\b(inherit|initial|unset|revert(-layer)?)\b/.test(v) && !/^(inherit|initial|unset|revert(-layer)?)(\s*!important)?$/.test(v));
  assert.deepEqual(bad, [], 'invalid: the browser drops the whole declaration');
});

test('the four rules that had it say what they meant', () => {
  // through resolveTokens: since the design tokens a size may be spelled `var(--text-13)`; what the
  // rule MEANS is the size it computes to, and a token whose value moved still fails here
  const body = (sel: string): string => resolveTokens(css.match(new RegExp(`(?:^|\\})\\s*${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '', css);
  assert.match(body('.deckname'), /font-weight: 700; font-size: 19px; line-height: 1\.2/);
  assert.match(body('.rulesq'), /font-family: inherit; font-size: 14px; line-height: 1\.4/);
  assert.match(body('.cbrowname'), /font-weight: 600; font-size: 13px; line-height: 1\.3/);
  assert.match(body('.ljask input'), /font-family: inherit; font-size: 14px; line-height: 1\.4/);
});
