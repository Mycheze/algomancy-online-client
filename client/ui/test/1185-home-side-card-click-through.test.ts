/* CT-543 — report #352 (mycheze, home, 2026-11-08, ux):
 *
 *   "The header text on the League and Challenge and Matchmaking is an
 *    unclickable row. It's weird and the whole card should be able to be
 *    clicked"
 *
 * Each of the three cards beside Play opens its page from a stretched,
 * transparent button (`.homesideopen`, pages/home.ts sideCardHtml, inset 0).
 * The home's art layer (styles/pages/54-home-art.css) lifts the card's other
 * children, the title strip and the body's glass, to z-index 1 so the words
 * draw over the painting. That lift also put them over the button: a click on
 * the title or the text landed on an <h2> or a <div> with no handler, and only
 * the gaps between them opened the page.
 *
 * Now the lifted children take no pointer events (the click falls through to
 * the button under them) and a real control inside them, Matchmaking's Join
 * on an open game, takes its own clicks back.
 *
 * Read as text through readStyles() (test 910): there is no browser on the
 * box to hit-test with.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles } from './read-styles.ts';
import { queueGlanceHtml } from '../pages/queue.ts';

/** every rule in the stylesheet as [selector, body], @media blocks flattened */
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

const pe = (body: string): string | null => /pointer-events:\s*([a-z-]+)/.exec(body)?.[1] ?? null;
const LIFT = '.homeside > :not(.homeart):not(.homesideopen)';

test("the lifted title and body of a home side card let a click through to the card's own button", () => {
  const all = rules(readStyles());
  const lift = all.filter(([sel]) => sel.split(',').map(s => s.trim()).includes(LIFT));
  assert.ok(lift.length, 'the rule that lifts the words over the painting is still there');
  for (const [, body] of lift) {
    assert.match(body, /z-index:\s*1/, 'it lifts them above the stretched button');
    assert.equal(pe(body), 'none', 'and so must not take the click the button is there for');
  }
  // nothing gives the title or the body (or the card's children as such) their pointer back
  for (const [sel, body] of all) {
    if (pe(body) === null || pe(body) === 'none') continue;
    for (const one of sel.split(',').map(s => s.trim())) {
      assert.ok(!/(\.homesidetitle|\.homesidebody|\.homesideempty|^\.homeside > :not\(\.homeart\):not\(\.homesideopen\))$/.test(one),
        `"${one}" hands pointer events back to the card's words`);
    }
  }
});

test('a Join button inside the Matchmaking card still takes its own click', () => {
  const html = queueGlanceHtml({ counts: null, openGames: [
    { id: 'g1', username: 'Gember', mode: 'draft', ranked: false, rating: 0, waitedMs: 30_000 } as never,
  ] });
  assert.match(html, /<button class="qopenjoin" data-btn="queue-join-open"/, 'the glance draws Join as a <button>');
  const back = rules(readStyles()).filter(([sel, body]) => pe(body) === 'auto'
    && sel.split(',').some(s => s.trim().startsWith(LIFT) && /\bbutton\b/.test(s)));
  assert.ok(back.length, 'a button inside the lifted children has pointer-events: auto again');
});
