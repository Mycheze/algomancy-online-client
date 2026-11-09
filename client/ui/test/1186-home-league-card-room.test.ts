/* CT-544 — report #353 (mycheze, home, 2026-11-08, ux):
 *
 *   "On the League box, there needs to be a bit more spacing between the
 *    \"current standings\" and the bottom of the box. Right now, it
 *    immediatly ends at the bottom of the box and it's hard to read"
 *
 * The three cards beside Play share the column's height by flex share alone
 * (styles/pages/06-home.css: `.homeside { flex: 1 1 0; min-height: 0;
 * overflow: hidden }`), and the glass inside (`.homesidebody`) is
 * `min-height: 0; overflow: hidden` too. On a window short enough that the
 * League card's share is less than its words (name, phase, week track,
 * status, match, the standings, the next date), the glass shrank under them
 * and clipped: the standings ran into its bottom edge and the line under
 * them vanished. Its bottom padding was also only 6px.
 *
 * Now the League and Challenge cards, whose glances are a fixed handful of
 * lines, are never smaller than their content (`min-height: min-content`;
 * a short window scrolls instead), and the glass keeps 12px under its last
 * line. Matchmaking is left as it was: its list of open games has no fixed
 * length.
 *
 * Read as text through readStyles() (test 910): there is no browser on the
 * box to lay the page out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles } from './read-styles.ts';

/** every rule in the stylesheet as [selector, body], in cascade order, @media blocks flattened */
function rules(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const text = css.replace(/\/\*[^]*?\*\//g, '');
  const walk = (s: string): void => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) return;
      const head = s.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (head.startsWith('@')) walk(body); else out.push([head.replace(/\s+/g, ' '), body]);
      i = j;
    }
  };
  walk(text);
  return out;
}

const selectors = (sel: string): string[] => sel.split(',').map(s => s.trim());
const TOKENS: Record<string, number> = { '--space-1': 2, '--space-2': 4, '--space-3': 6, '--space-4': 8, '--space-5': 12, '--space-6': 16, '--space-7': 24 };
const px = (v: string): number => {
  const m = /^var\((--space-\d)\)$/.exec(v.trim());
  if (m?.[1]) return TOKENS[m[1]] ?? NaN;
  const n = /^(\d+(?:\.\d+)?)px$/.exec(v.trim());
  return n?.[1] ? Number(n[1]) : v.trim() === '0' ? 0 : NaN;
};
/** the bottom of a `padding:` shorthand (1–4 values) */
const padBottom = (vals: string[]): number => px(vals[vals.length === 1 ? 0 : 2] ?? vals[0] ?? "");

test("the home page's League card is never squeezed below its words, so the standings are not clipped", () => {
  const all = rules(readStyles());
  for (const card of ['.homeside--league', '.homeside--challenge']) {
    // the last min-height any rule gives this card, or the card in general
    let last: string | null = null;
    for (const [sel, body] of all) {
      if (!selectors(sel).some(s => s === card || s === '.homeside')) continue;
      const m = /(?:^|;|\s)min-height:\s*([^;]+)/.exec(body);
      if (m?.[1]) last = m[1].trim();
    }
    assert.ok(last === 'min-content' || last === 'fit-content' || last === 'max-content',
      `${card} ends the cascade with min-height ${last}: its flex share can squeeze its glass and clip the last lines`);
  }
});

test("the League card's glass keeps room under its last line", () => {
  const all = rules(readStyles());
  let bottom = NaN;
  for (const [sel, body] of all) {
    if (!selectors(sel).some(s => s === '.homeside .homesidebody' || s === '.homesidebody')) continue;
    const short = /(?:^|;|\s)padding:\s*([^;]+)/.exec(body);
    if (short?.[1]) bottom = padBottom(short[1].trim().split(/\s+/));
    const long = /padding-bottom:\s*([^;]+)/.exec(body);
    if (long?.[1]) bottom = px(long[1]);
  }
  assert.ok(bottom >= 10, `the glass's bottom padding is ${bottom}px: the standings sit right on its edge`);
});
