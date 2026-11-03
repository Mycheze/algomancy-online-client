/* 1020 — THE HOME SCREEN HIDES THE PILL, THE BELL AND THE FOOTER; NOTHING ELSE
 * DOES (new home, docs/24, 2026-11-03).
 *
 * The new home's toolbar carries a Report button (`data-report="open"`) and
 * an Alerts button (`data-inbox="bell"`, with the unread count), and its
 * bottom bar carries the legal footer's content behind a button. So on the
 * home only, the floating Report pill, the floating bell and `#legalfoot` are
 * hidden — read off #app's markup (`#app > .homepage`), never a class the
 * router sets — and nothing they leave behind adds height: the pill-clear body
 * padding and the footer's `100dvh - 128px` floor stop at the home. The list
 * the Alerts button opens and the invite popups still show there, hung from
 * the top right under the toolbar. Every other page is unchanged.
 *
 * §1 the three are hidden under `:root:has(#app > .homepage)` / `#app:has(> .homepage) +`, and
 *    no rule anywhere hides them unconditionally
 * §2 the list and the popups move to the top on the home, and only there
 * §3 nothing adds height on the home: the pill-clear and the footer floor exclude it
 * §4 the report still names the new root "home" (pageOf reads the LAST class)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles } from './read-styles.ts';
import { pageOf } from '../report.ts';

const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
/** every rule as [selector, body] */
const rules = (): Array<[string, string]> => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1]!.trim(), m[2]!]);
const ON_HOME = ':root:has(#app > .homepage)';

test('1020 §0 positive control: the rules are read', () => {
  assert.ok(rules().length > 500, 'the stylesheet was not reached');
  assert.ok(rules().some(([sel]) => sel === '.reportfab'), 'the pill has its own rule');
});

test('1020 §1 on the home, and only there, the pill, the bell and the footer are hidden', () => {
  const hiding = rules().filter(([, body]) => /\bdisplay:\s*none\b/.test(body));
  const hides = (el: RegExp): string[] => hiding.flatMap(([sel]) => sel.split(',').map(s => s.trim()).filter(s => el.test(s)));
  assert.deepEqual(hides(/\.reportfab\b/), [`${ON_HOME} #reportlayer > .reportfab`]);
  assert.deepEqual(hides(/\.inboxbell\b/), [`${ON_HOME} #inboxlayer > .inboxbell`]);
  assert.deepEqual(hides(/#legalfoot\b(?!:not)/), ['#app:has(> .homepage) + #legalfoot']);
  // the list and the popups are not hidden anywhere: the Alerts button opens the list on the home too
  assert.deepEqual(hides(/\.inboxlist|\.invitepops/), []);
});

test('1020 §2 the bell\'s list and the popups hang from the top right on the home', () => {
  const top = rules().filter(([sel]) => sel.startsWith(ON_HOME) && /\.inboxlist|\.invitepops/.test(sel));
  assert.equal(top.length, 1, 'one rule moves them');
  assert.match(top[0]![0], /#inboxlayer > \.inboxlist,\s*:root:has\(#app > \.homepage\) #inboxlayer > \.invitepops/);
  assert.match(top[0]![1], /top: 72px; bottom: auto;/);
  // everywhere else they stay at the bottom right, over the pill
  assert.match(css, /\.inboxlist, \.invitepops \{ position: fixed; right: 18px; bottom: 62px;/);
});

test('1020 §3 nothing adds height on the home', () => {
  // the pill-clear: both rules that set or read it stop at the home
  const clear = rules().filter(([sel, body]) => /--report-pill-clear/.test(body) && sel.includes('.reportfab'));
  assert.equal(clear.length, 2, 'the variable and the body padding');
  for (const [sel] of clear) assert.ok(sel.includes(':not(:has(#app > .homepage))'), `${sel} reaches the home`);
  // the footer's floor: every rule that sets the 128px floor excludes the home
  const floor = rules().filter(([, body]) => /min-height: calc\(100dvh - 128px\)/.test(body));
  assert.ok(floor.length >= 1, 'positive control: the floor is there for the other pages');
  for (const [sel] of floor) {
    assert.ok(sel.includes(':not(:has(> .homepage))'), `${sel} reaches the home's root`);
    assert.doesNotMatch(sel.replaceAll(':not(:has(> .homepage))', ''), /\.homepage/, `${sel} puts the floor on the home`);
  }
});

test('1020 §4 the report names the new home root "home"', () => {
  assert.equal(pageOf('<div class="ui-app-shell homepage">…'), 'home', 'homepage must stay the LAST class');
  assert.equal(pageOf('<div class="homepage ui-app-shell">…'), 'ui-app-shell', 'the order is what it reads');
});
