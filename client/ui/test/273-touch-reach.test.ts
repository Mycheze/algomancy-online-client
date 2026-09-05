/* 2026-09-05 — THE FIRST DAY ON AN iPAD. The owner played on the hosted site
 * from a tablet and *"it worked remarkably well"*, with three things a finger
 * could not do that a mouse could:
 *
 *   1. the long-hover box came up half a second after a tap and sat on top of
 *      the play menu the same tap had opened. (main.ts pointerCanHover — the
 *      dwell is armed only after a pointer event of type mouse. The driver
 *      dispatches no pointer events at all and has `hovertip` in its ABSENT
 *      set, so that half is proven in a browser, not here — see test/199 for
 *      why.)
 *   2. there was no right-click, so no card menu and no table menu. The card
 *      menu is now ALSO drawn in the focus rail under the card's text (one
 *      list, cardMenuItems, offered from both places); the table menu is
 *      ALSO behind a ☰ button at the top of the rail.
 *   3. the action bar — Pass, Confirm, every decision — moved from the sticky
 *      top strip to its own grid row at the bottom of the table's column.
 *
 * §1 and §2 are what the driver can see of 2 and 3. §3 reads main.ts, because
 * the rail (`#preview`) is ABSENT to the driver: the claim that the rail and
 * the right-click cannot drift is a claim about them sharing one function.
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
  // before .side opens, which is where the grid puts it (style.css #app.board)
  assert.ok(html.indexOf('class="actionbar"') > html.indexOf('class="main"'), 'after the table');
  assert.ok(html.indexOf('class="actionbar"') < html.indexOf('class="side"'), 'before the rail');
});

test('§3 the rail menu and the right-click menu are one list (cardMenuItems)', () => {
  const calls = [...MAIN.matchAll(/\bcardMenuItems\(/g)].length;
  assert.ok(calls >= 3, `cardMenuItems is defined once and called from the contextmenu handler AND railMenuHtml (saw ${calls} occurrences)`);
  const rail = /function railMenuHtml[\s\S]*?\n}/.exec(MAIN)?.[0] ?? '';
  assert.ok(rail.includes('cardMenuItems('), 'railMenuHtml builds its buttons from cardMenuItems');
  const ctx = MAIN.slice(MAIN.indexOf("document.addEventListener('contextmenu'"));
  const handler = ctx.slice(0, ctx.indexOf('\n});') + 4);
  assert.ok(handler.includes('cardMenuItems('), 'the contextmenu handler opens cardMenuItems');
  assert.ok(!handler.includes('details, attributes & rulings'),
    'the handler no longer spells its own entries — that is how the two lists would drift');
  // the rail's buttons dispatch through the same table as the menu's
  assert.ok(/railitem: btn => \{ railItems\[Number\(btn\.dataset\['i'\]\)\]\?\.go\(\); \}/.test(MAIN),
    'data-btn="railitem" indexes the rail list exactly as menuitem indexes ui.menu.items');
});
