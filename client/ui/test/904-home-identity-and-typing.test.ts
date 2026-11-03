/* The home screen: no "signed out" flash, and typing survives a repaint.
 *
 * Both found 2026-11-02 in a browser:
 *
 *  1. A signed-in player reloading the page saw "Playing signed out — nothing
 *     is recorded. Log in / Sign up" until /api/me answered (55ms on
 *     localhost, 300ms on a 300ms link): barHtml() drew signed-out whenever
 *     `me` was null, including while the stored token was still being checked.
 *     account.ts now has `resolving` from initAccounts until refreshMe
 *     settles, and the bar says "Signing in…" meanwhile; the home header
 *     holds back the "Your name" box for the same moment.
 *  2. The home screen is repainted whole by things the player did not do (the
 *     queue count, a friend coming online). One queue poll emptied the name,
 *     room-code, deck-link and paste boxes and dropped the focus. The home
 *     paint carries their text and the caret across (HOME_TYPED, caretIn,
 *     restoreCaret — caretIn is the board's snapshotViewport capture, shared,
 *     not a fifth copy).
 *
 * account.ts paints into the DOM and main.ts boots on import, so this reads
 * the source. Since the design-system round (2026-11-03) the home screen is
 * pages/home.ts (homeView/homeHtml/paintHome), the deck import is
 * pages/deckpicker.ts and caretIn is pages/caret.ts, shared with main.ts's
 * board; the assertions below are the same ones, read from there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const acct = read('account.ts');
// the identity bar's markup is ui/pages/signin.ts since the design-system round (2026-11-03)
const signin = read('pages/signin.ts');
const main = read('main.ts');
const home = read('pages/home.ts');
const picker = read('pages/deckpicker.ts');
const fn = (src: string, head: string): string => {
  const i = src.indexOf(head);
  assert.ok(i >= 0, `positive control: ${head}`);
  return src.slice(i, src.indexOf('\n}\n', i));
};

test('a token being checked is drawn as signing in, not as signed out', () => {
  assert.match(fn(acct, 'export function barHtml'), /identityBarHtml\(identityBarView\(me, resolving\)\)/, 'the bar is handed `resolving`');
  const bar = fn(signin, 'export function identityBarHtml');
  const busy = bar.indexOf('if (!me && v.resolving)');
  assert.ok(busy > 0 && busy < bar.indexOf('Playing signed out'), 'the resolving case comes first');
  assert.match(bar, /Signing in…/);
  assert.match(fn(acct, 'export function initAccounts'), /if \(token\(\)\) \{ resolving = true; void refreshMe\(\); \}/);
  const refresh = fn(acct, 'async function refreshMe');
  assert.equal((refresh.match(/resolving = false;/g) ?? []).length, 2, 'cleared on a 401 and on every other way out');
  assert.ok(refresh.lastIndexOf('resolving = false;') < refresh.lastIndexOf('repaint();'), 'before the repaint that shows the answer');
  assert.match(fn(home, 'export function homeView'), /nameBox: user \|\| acct\.resolvingUser\(\) \? null : name,/, 'no "Your name" box while it resolves');
  // new home layout, docs/24, 2026-11-03: the name box sits in the Play card's foot (playHtml, which homeHtml draws)
  assert.match(fn(home, 'function playHtml'), /\$\{v\.nameBox === null\s*\? ''/, '…and homeHtml draws none for a null nameBox');
  assert.match(fn(home, 'export function homeHtml'), /playHtml\(v\)/, 'positive control: homeHtml draws the Play card');
});

test('the home paint carries the typed boxes and the caret across its repaint', () => {
  const body = fn(home, 'export function paintHome');
  const paint = body.indexOf('app.innerHTML = homeHtml(homeView(st));');
  assert.ok(paint > 0, 'positive control: the paint');
  const before = body.slice(0, paint), after = body.slice(paint);
  assert.match(before, /const typed = HOME_TYPED\.map/, 'read before');
  assert.match(before, /const caret = caretIn\(HOME_CARET\);/);
  assert.match(after, /HOME_TYPED\.forEach\(\(id, i\) => \{[^}]*box\.value = typed\[i\]!/, 'written back after');
  assert.match(after, /restoreCaret\(caret\);/);
  for (const id of ['h-name', 'h-code', 'h-deckurl', 'h-decktext']) {
    assert.match(home, new RegExp(`const HOME_TYPED = \\[[^\\]]*'${id}'`), `${id} is carried`);
    assert.match(home + picker, new RegExp(`id="${id}"`), `${id} is drawn (positive control)`);
  }
});

test('the caret capture is the board\'s, shared — not another copy', () => {
  assert.match(fn(main, 'function snapshotViewport'), /const keepFocus = caretIn\(\['judge-q', 'num-entry', 'dec-search', 'rules-q'\]\);/);
  assert.match(main, /import \{ caretIn, type CaretSnap \} from '\.\/pages\/caret\.ts';/, 'the board imports the one copy');
  assert.match(home, /import \{ caretIn, restoreCaret \} from '\.\/caret\.ts';/, 'and so does the home screen');
  assert.doesNotMatch(main + home, /\nfunction caretIn\(/, 'no second copy of it');
});

test('a deck that imported cleanly empties its link/list box (it is not carried back by HOME_TYPED)', () => {
  const body = fn(picker, 'export function importDeck(');
  const at = body.indexOf('chooseDeck(r.deck)');
  assert.ok(at > 0, 'positive control: the import keeps the deck');
  const ok = body.slice(at);
  assert.match(ok, /\['h-deckurl', 'h-decktext'\][\s\S]*?\.value = ''[\s\S]*?rerender\(\)/,
    'after chooseDeck, both import boxes are emptied before the repaint');
});
