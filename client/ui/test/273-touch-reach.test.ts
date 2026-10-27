/* 2026-09-05 — THE FIRST DAY ON AN iPAD. The owner played on the hosted site
 * from a tablet and *"it worked remarkably well"*, with three things a finger
 * could not do that a mouse could:
 *
 *   1. the long-hover box came up half a second after a tap and sat on top of
 *      the play menu the same tap had opened. (main.ts pointerCanHover — the
 *      dwell is armed only after a pointer event of type mouse. The driver
 *      dispatches no pointer events at all, so nothing ever builds
 *      `#hovertip` there, and that half is proven in a browser, not here — see test/199 for
 *      why.)
 *   2. there was no right-click, so no card menu and no table menu. The card
 *      menu was ALSO drawn in the focus rail under the card's text (one
 *      list, cardMenuItems, offered from both places) — since board round 8,
 *      when the rail went, under the read a tap opens; the table menu is
 *      ALSO behind a ☰ button on the toolbar.
 *   3. the action bar — Pass, Confirm, every decision — moved from the sticky
 *      top strip to its own grid row at the bottom of the table's column.
 *
 * §1 and §2 are what the driver can see of 2 and 3. §3 reads main.ts, because
 * the read's zoom is never laid out in the driver: the claim that the finger's
 * menu and the right-click cannot drift is a claim about them sharing one
 * function (test/714 has the press, and Chrome proved the whole gesture).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { boardMenuEntries } from '../inspect.ts';
import { client } from './ui-driver.ts';
import { spawn, toDeployment } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();
const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');

function menuLabels(html: string): string[] {
  assert.ok(html.includes('class="menu"'), 'no menu opened');
  return [...html.matchAll(/data-btn="menuitem" data-i="\d+">([\s\S]*?)<\/button>/g)]
    .map(m => m[1]!.replace(/<[^>]*>/g, '').trim());
}

function board(seed: number): { h: Harness; A: Seat } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  spawn(h, A, 'Good Whale');
  return { h, A };
}

test('§1 the ☰ table button is on the rail and opens exactly the bare-table menu', () => {
  const { h, A } = board(27300);
  ui.join(h.state as GameState, A, legalActions(h.state, A) as Action[]);
  assert.ok(ui.has({ btn: 'tablemenu' }), 'the rail has no ☰ table button');
  const viaButton = menuLabels(ui.click({ btn: 'tablemenu' }));
  const want = boardMenuEntries(h.state as GameState, A).map(e => e.label);
  assert.deepEqual(viaButton, want,
    'the button IS a right-click on bare table: same entries, same order, nothing added');
  ui.click({ btn: 'menuclose' });
  const viaRightClick = menuLabels(ui.rightClick({ act: 'player', p: A }));
  assert.deepEqual(viaButton, viaRightClick, 'and the two never drift');
});

test('§2 the action bar is at the bottom of the table column, not in the sticky top strip', () => {
  const { h, A } = board(27301);
  const html = ui.join(h.state as GameState, A, legalActions(h.state, A) as Action[]);
  const top = /<div class="stickytop">([\s\S]*?)<\/div>\s*\$?[\s\S]*?<div class="actionbar">/.exec(html);
  assert.ok(top, 'the board has a .stickytop followed by an .actionbar');
  const sticky = html.slice(html.indexOf('class="stickytop"'), html.indexOf('class="actionbar"'));
  assert.ok(!sticky.includes('class="promptbar'), 'no prompt bar is left in the sticky top strip');
  const bar = html.slice(html.indexOf('class="actionbar"'));
  assert.ok(/class="promptbar/.test(bar), 'the prompt bar is inside .actionbar');
  // and the row is in the TABLE's column: it comes after .main closes and
  // before the toolbar (.side) opens, which is where the grid puts it (style.css #app.board)
  assert.ok(html.indexOf('class="actionbar"') > html.indexOf('class="main"'), 'after the table');
  assert.ok(html.indexOf('class="actionbar"') < html.indexOf('class="side toolbar"'), 'before the toolbar');
});

test('§3 the finger\'s card menu and the right-click menu are one list (cardMenuItems)', () => {
  // board round 8: the rail that drew the card menu under a tapped card is
  // gone; the menu hangs under a tap's READ instead (main.ts readMenuHtml)
  const fn = (name: string): string => new RegExp(`function ${name}[\\s\\S]*?\\n}`).exec(MAIN)?.[0] ?? '';
  assert.ok(fn('cardMenuForEl').includes('cardMenuItems('), 'the read\'s menu is built from cardMenuItems');
  assert.ok(fn('hangReadMenu').includes('cardMenuForEl('), 'hung under the read from that one list');
  const ctx = MAIN.slice(MAIN.indexOf("document.addEventListener('contextmenu'"));
  const handler = ctx.slice(0, ctx.indexOf('\n});') + 4);
  assert.ok(handler.includes('cardMenuItems('), 'the contextmenu handler opens cardMenuItems');
  assert.ok(!handler.includes('details, attributes & rulings'),
    'the handler no longer spells its own entries — that is how the two lists would drift');
  // an entry pressed under the read runs the very item, by index, as menuitem does
  assert.match(MAIN, /const i = hit\.dataset\['zmi'\];\n\s*if \(i !== undefined\) \{ readMenuItems\[Number\(i\)\]\?\.go\(\); render\(\); return; \}/,
    'data-zmi indexes the read\'s list exactly as menuitem indexes ui.menu.items');
  // a finger reaches it: a hand / cache card's tap reads WITH the menu, and so
  // does a tap on any card that moved nothing (the old rail fill)
  assert.match(fn('tapOnlyReads'), /menuRead\(el,/, 'a hand or cache card\'s tap-read carries the menu');
  assert.match(MAIN, /if \(pointerCanHover\(\)\) return;[\s\S]{0,200}menuRead\(document\.elementFromPoint\(at\.x, at\.y\), at\)/,
    'a tap that did nothing else reads the card with its menu (and a mouse click reads nothing: it has the zoom and the right-click)');
});

/* Board round 8 (owner, 2026-10-27): two new hover windows — a player's piles
 * off their name, the phase in words off the phase icons (ui/infotip.ts) —
 * and the house rule that nothing is hover-only. Each target is ALSO a
 * `data-btn`, and a tap pins the window the hover shows (a second tap drops
 * it). The window is a layer beside #app, which the driver paints too. */
test('§4 the name\'s counts and the phase caption are a tap away, not only a hover', () => {
  const { h, A } = board(27302);
  const html = ui.join(h.state as GameState, A, legalActions(h.state, A) as Action[]);
  for (const p of [0, 1]) {
    assert.match(html, new RegExp(`<span class="lname" data-tip="counts" data-btn="infotip" data-p="${p}"`), `seat ${p}'s name is a tap target`);
  }
  assert.match(html, /<div class="phicons[^"]*" data-tip="phase" data-btn="infotip"/, 'the phase icons are a tap target');
  const counts = ui.click({ tip: 'counts', p: 1 - A });
  assert.match(counts, /<div class="tiphead">[\s\S]*<th>hand<\/th>[\s\S]*<th>deck[\s\S]*<th>recycle pile<\/th>[\s\S]*<th>bin<\/th>[\s\S]*<th>cache<\/th>/,
    'a tap on their name: hand, deck, recycle pile, bin and cache as numbers');
  const phase = ui.click({ tip: 'phase' });
  assert.match(phase, /<div class="tipline">[^<]*Turn \d+/, 'a tap on the phase icons: the step in words, with the turn');
  assert.doesNotMatch(phase, /class="tiphead"/, 'one window at a time');
  assert.doesNotMatch(ui.click({ tip: 'phase' }), /class="tipline"/, 'a second tap drops it');
});
