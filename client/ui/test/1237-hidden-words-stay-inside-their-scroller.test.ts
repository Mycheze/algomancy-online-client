/* 1237 · WORDS ONLY A SCREEN READER SAYS CANNOT STRETCH THE PAGE (report #387, CT-562, 2026-11-12)
 *
 * mycheze, on the profile's Players tab: "there's a scroll wheel on the page
 * itself … it's also possible to scroll beyond the footer". The profile is a
 * fill frame: only its lists scroll. That morning every row of those lists had
 * gained a `.srname` span (", online now" / ", offline", test 1233), and
 * `.srname` was `position: absolute` with no inset — so each sat at its
 * row's place, and its containing block was the page itself (nothing between
 * the row and the root is positioned). An overflow clips only the boxes whose
 * containing block is inside it (CSS 2.2 §11.1.1), so the spans of the rows
 * scrolled below a list's bottom escaped the list and the shell and made the
 * document as tall as the whole list.
 *
 * The fix is the class, not the page: `.srname` is pinned to its containing
 * block's corner (`top: 0; left: 0`), where a 1px box can never reach past
 * the content around it, on any page and in any scroller.
 *
 *   §1 .srname is absolute AND pinned top-left, and no other rule moves it back
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles } from './read-styles.ts';

const CSS = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');

/** the bodies of every rule whose selector list names `.srname` */
function srnameRules(): string[] {
  const out: string[] = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/\.srname(?![\w-])/.test(m[1] ?? "")) out.push(m[2] ?? "");
  }
  return out;
}

const decl = (body: string, prop: string): string | null => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body);
  return m ? (m[1] ?? "").trim() : null;
};

test('§1 .srname is absolute and pinned to its containing block\'s corner, so a row scrolled out of sight cannot stretch the page', () => {
  const rules = srnameRules();
  assert.equal(rules.length, 1, `one .srname rule in the stylesheet, found ${rules.length}`);
  const body = rules[0] ?? "";
  assert.equal(decl(body, 'position'), 'absolute');
  assert.equal(decl(body, 'top'), '0', '.srname needs top: 0 — without it the span sits at its row, below the list, and the document grows to reach it');
  assert.equal(decl(body, 'left'), '0', '.srname needs left: 0');
});
