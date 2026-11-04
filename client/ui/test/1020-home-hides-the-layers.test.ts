/* 1020 — THE HOME SCREEN HIDES THE PILL, THE BELL AND THE FOOTER; NOTHING ELSE
 * DOES (new home, docs/24, 2026-11-03) — EXCEPT THE PAGES IN THE APP FRAME
 * (2026-11-04): every page pages/frame.ts draws has the same toolbar, so its
 * root carries the home's mark, `.apppage`, and the rules below read that.
 * "The home" in this file means "a page whose root is .apppage".
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
 * §1 the three are hidden on the home (the pill and the bell only while no layer — How to play,
 *    Learn to Play, a legal page — is up over it and covering the toolbar), and nowhere else
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
/** on the home, with no layer (help, Learn to Play, a legal page) up over it */
/** a selector list split at its top-level commas (not the ones inside `:has(a, b)`) */
function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(list.slice(from, i).trim()); from = i + 1; }
  }
  return [...out, list.slice(from).trim()];
}
const ON_HOME = ':root:has(#app > .apppage):not(:has(#helplayer > *, #learnmenu > *, #legalover))';

test('1020 §0 positive control: the rules are read', () => {
  assert.ok(rules().length > 500, 'the stylesheet was not reached');
  assert.ok(rules().some(([sel]) => sel === '.reportfab'), 'the pill has its own rule');
});

test('1020 §1 on the home, and only there, the pill, the bell and the footer are hidden', () => {
  const hiding = rules().filter(([, body]) => /\bdisplay:\s*none\b/.test(body));
  const hides = (el: RegExp): string[] => hiding.flatMap(([sel]) => selectors(sel).filter(s => el.test(s)));
  assert.deepEqual(hides(/\.reportfab\b/), [`${ON_HOME} #reportlayer > .reportfab`]);
  assert.deepEqual(hides(/\.inboxbell\b/), [`${ON_HOME} #inboxlayer > .inboxbell`]);
  assert.deepEqual(hides(/#legalfoot\b(?!:not)/), ['#app:has(> .apppage) + #legalfoot']);
  // the list and the popups are not hidden anywhere: the Alerts button opens the list on the home too
  assert.deepEqual(hides(/\.inboxlist|\.invitepops/), []);
});

test('1020 §2 the bell\'s list and the popups hang from the top right on the home', () => {
  const top = rules().filter(([sel]) => sel.startsWith(ON_HOME) && /\.inboxlist|\.invitepops/.test(sel));
  assert.equal(top.length, 1, 'one rule moves them');
  assert.deepEqual(selectors(top[0]![0]), [`${ON_HOME} #inboxlayer > .inboxlist`, `${ON_HOME} #inboxlayer > .invitepops`]);
  assert.match(top[0]![1], /top: 72px; bottom: auto;/);
  // everywhere else they stay at the bottom right, over the pill
  assert.match(css, /\.inboxlist, \.invitepops \{ position: fixed; right: 18px; bottom: 62px;/);
});

test('1020 §3 nothing adds height on the home', () => {
  // the pill-clear: both rules that set or read it stop at the home
  const clear = rules().filter(([sel, body]) => /--report-pill-clear/.test(body) && sel.includes('.reportfab'));
  assert.equal(clear.length, 2, 'the variable and the body padding');
  for (const [sel] of clear) assert.ok(sel.includes(':not(:has(#app > .apppage))'), `${sel} reaches the home`);
  // the footer's floor: every rule that sets the 128px floor excludes the home
  const floor = rules().filter(([, body]) => /min-height: calc\(100dvh - 128px\)/.test(body));
  assert.ok(floor.length >= 1, 'positive control: the floor is there for the other pages');
  for (const [sel] of floor) {
    assert.ok(sel.includes(':not(:has(> .apppage))'), `${sel} reaches the home's root`);
    assert.doesNotMatch(sel.replaceAll(':not(:has(> .apppage))', ''), /\.apppage|\.homepage/, `${sel} puts the floor on the home`);
  }
});

test('1020 §4 the report names the new home root "home"', () => {
  assert.equal(pageOf('<div class="ui-app-shell homepage">…'), 'home', 'homepage must stay the LAST class');
  assert.equal(pageOf('<div class="homepage ui-app-shell">…'), 'ui-app-shell', 'the order is what it reads');
});

test('1020 §5 the home and every page in the frame carry the mark; the page\'s own class stays last', async () => {
  const { frameHtml } = await import('../pages/frame.ts');
  const html = frameHtml({ page: 'cbpage', title: 'Cards', back: { dataBtn: 'cards-close', label: 'Home' },
    chrome: { signedIn: true, alerts: 3 }, mainHtml: '' });
  assert.match(html, /^<div class="ui-app-shell ui-app-shell--contained apppage cbpage">/);
  assert.equal(pageOf(html), 'cb', 'the report still names the page by its own class');
  // …and the frame's toolbar has what the hidden layers were: Report and Alerts
  assert.match(html, /data-report="open"/);
  assert.match(html, /data-inbox="bell"/);
  // signed out there is no bell, and nothing is drawn in its place
  assert.doesNotMatch(frameHtml({ page: 'x', title: 'X', back: { dataBtn: 'b', label: 'Home' }, chrome: { signedIn: false, alerts: 0 }, mainHtml: '' }),
    /data-inbox/);
});
