/* 329 — TABLETS, FOLDABLES AND DRAG TO PLAY (owner, 2026-09-27: "optimize the
 * client for use on mobile devices that have large-ish screens — an iPad or
 * foldable phone", and "integrate dragging as an option for playing cards and
 * building formations").
 *
 * The gestures themselves are pointer events, which test/ui-driver.ts never
 * dispatches. They were proved in headless Chrome with REAL CDP input — mouse
 * at 1280×800, emulated touch at 884×1104: a long press opens the peek above
 * the finger and its lift plays nothing; a drag in planning opens the recycle
 * menu at the drop point; a drag in deployment plays the card; a unit dragged
 * to a slot, to the back row, back onto the field; a press that moves less than
 * the slop is still a click. What is pinned HERE is every decision those
 * gestures rest on, and the one structural promise that keeps a drag from ever
 * doing more than a click: every drop is a click route.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { moveInBuild, rowsOf } from '../formation.ts';
import { peekBox, PEEK_W } from '../zoom.ts';
import type { EntityId } from '../../engine/src/types.ts';

const read = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const MAIN = read('../main.ts');
const CSS = read('../style.css');
const HTML = read('../index.html');
const e = (n: number): EntityId => n as EntityId;

test('§1 the page lays out at the device width (a foldable is not a 980px desktop shrunk to fit)', () => {
  assert.match(HTML, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('§2 moveInBuild: slot to slot is the click pair, in one step', () => {
  // front → back of its own column: the column holds just it, now at the back
  const back = moveInBuild([[e(1)]], [], e(1), 0, 1, true)!;
  assert.deepEqual(rowsOf(back.columns[0], back.backOnly), [undefined, e(1)]);
  // onto the front of an occupied column: the sitting unit goes back (dropIntoRow)
  const push = moveInBuild([[e(1)], [e(2)]], [], e(1), 1, 0, true)!;
  assert.deepEqual(push.columns, [[e(1), e(2)]], 'column 1 emptied and dropped; 1 in front of 2');
});

test('§2b the emptied column goes AFTER the drop, so the column let go over is the one it lands in', () => {
  // three columns, the lone unit of column 0 dragged to column 2: take-out-
  // then-compact would have slid column 2 to index 1 and landed it in the
  // wrong column
  const m = moveInBuild([[e(1)], [e(2)], [e(3)]], [], e(1), 2, 1, true)!;
  assert.deepEqual(m.columns, [[e(2)], [e(3), e(1)]]);
  // …and the builder's spare column (index = length) takes it too
  const n = moveInBuild([[e(1), e(4)], [e(2)]], [], e(1), 2, 0, true)!;
  assert.deepEqual(n.columns.map(c => c.length), [1, 1, 1]);
  assert.deepEqual(n.columns[2], [e(1)]);
});

test('§2c a block build keeps its holes (the index is the attacker\'s column)', () => {
  const m = moveInBuild([[e(1)], [], [e(3)]], [], e(1), 1, 0, false)!;
  assert.deepEqual(m.columns, [[], [e(1)], [e(3)]]);
});

test('§2d a full column refuses the move and the build is untouched', () => {
  const before = [[e(1)], [e(2), e(3)]];
  assert.equal(moveInBuild(before, [], e(1), 1, 0, true), null);
  // its own column is never "full" of itself
  assert.ok(moveInBuild([[e(1), e(2)]], [], e(1), 0, 1, true));
});

const VIEW = { w: 884, h: 1104 };

test('§3 the peek goes clear of the finger: above it from the hand dock', () => {
  const card = { left: 20, top: 960, width: 74, height: 104 };
  const at = { x: 55, y: 1010 };
  const b = peekBox(card, VIEW, at)!;
  assert.ok(b.top + b.height <= at.y, 'entirely above the touch point');
  assert.ok(b.left >= 8 && b.left + b.width <= VIEW.w - 8, 'inside the screen');
  assert.equal(Math.round(b.width), PEEK_W, 'full peek width when the band holds it');
});

test('§3b below the finger near the top, beside it when neither band holds it, and nothing for a big card', () => {
  const top = peekBox({ left: 400, top: 20, width: 60, height: 84 }, VIEW, { x: 430, y: 60 })!;
  assert.ok(top.top >= 60, 'below the finger');
  // a short landscape screen, the finger in the middle
  const land = { w: 1180, h: 500 };
  const mid = peekBox({ left: 560, top: 220, width: 60, height: 84 }, land, { x: 590, y: 250 })!;
  assert.ok(mid.top >= 8 && mid.top + mid.height <= land.h - 8, 'inside the screen vertically');
  assert.ok(mid.left >= 590 || mid.left + mid.width <= 590, 'beside the finger, not under it');
  assert.equal(peekBox({ left: 0, top: 0, width: 330, height: 460 }, VIEW, { x: 100, y: 100 }), null);
});

/** the drag plans: from their banner to the next section */
function dragSection(): string {
  const a = MAIN.indexOf('── DRAG TO PLAY (2026-09-27)');
  const b = MAIN.indexOf('function resetFormation(): void {', a);
  assert.ok(a > 0 && b > a, 'the drag plans live in one section of main.ts');
  return MAIN.slice(a, b);
}

test('§4 EVERY DROP IS A CLICK ROUTE: the plans send nothing themselves', () => {
  const src = dragSection();
  // the functions the clicks call are the only way a drop acts
  for (const fn of ['handleHandClick(', 'handleCacheClick(', 'handleAction(', 'applyMod(', 'dropCarried(', 'moveInBuild(', 'takeOutOfBuild(']) {
    assert.ok(src.includes(fn), `a drop reaches ${fn.slice(0, -1)}`);
  }
  assert.ok(!/\bact\(\s*\{/.test(src), 'no drop builds an action of its own');
  assert.ok(!/NET!?\??\.do\(/.test(src), 'no drop talks to the server');
});

test('§5 the board is not repainted under a card in the air', () => {
  const body = MAIN.slice(MAIN.indexOf('function render(): void {'));
  const first = body.slice(0, body.indexOf('painting = true'));
  assert.match(first, /if \(dragActive\(\)\) \{ dragPaintPending = true; return; \}/,
    'render() defers to the end of the drag, before it paints anything');
  assert.match(MAIN, /ended: \(\) => \{ if \(dragPaintPending\) render\(\); \}/, 'and paints it when the drag lets go');
});

test('§6 a finger gets the keyboard hints hidden and bigger targets; a card scan starts no browser gesture', () => {
  assert.match(CSS, /html\.touch \.mouseonly, html\.touch \.kh \{ display: none; \}/);
  assert.match(CSS, /html\.touch \.actionbar button[\s\S]*?min-height: 36px/);
  assert.match(CSS, /\.card img, \.rescard img, \.stackcard img, #cardzoom img \{ -webkit-user-drag: none; -webkit-touch-callout: none; \}/);
  // every "(enter)" / "(esc)" / "(space)" a button prints is inside a .kh span
  const bare = [...MAIN.matchAll(/[^>]\((?:enter|esc|space)\)(?=\s*<\/button>|<\/button>|'|`)/g)];
  assert.deepEqual(bare.map(m => m[0]), [], 'no keyboard hint outside a .kh span');
});

test('§7 the toolbar: icons, the toggles behind "more"; the reminders can be hidden; no drawer at any width', () => {
  // owner, 2026-09-27: on a tablet the rail was ☰ 📝 ↶ as icons and "more";
  // board round 8 made the regions board's rail a 50px toolbar of icons at
  // EVERY width (main.ts toolbarHtml; test/712 drives it). Every toggle waits
  // in the "more" popover; rules and the judge are tools, so they stay out.
  const bar = /function toolbarHtml[\s\S]*?\n}/.exec(MAIN)?.[0] ?? '';
  const group = bar.slice(bar.indexOf('<div class="setgroup'), bar.indexOf('${NET && scnPop'));
  for (const b of ['autopasstoggle', 'bluffhastetoggle', 'motiontoggle', 'soundtoggle']) {
    assert.ok(group.includes(`data-btn="${b}"`), `${b} is behind "more"`);
  }
  // the ▦ board toggle went with the classic board (board round 8)
  assert.ok(!bar.includes('data-btn="layouttoggle"'), 'no board toggle');
  assert.ok(group.includes('data-chip="fullcontrol"'), 'the full-control chip too');
  for (const b of ['tablemenu', 'reportopen', 'undo', 'helpopen', 'judgeopen']) {
    const at = bar.indexOf(`data-btn="${b}"`);
    assert.ok(at >= 0 && !group.includes(`data-btn="${b}"`), `${b} stays on the strip`);
    assert.match(bar.slice(at, bar.indexOf('</button>', at)), / title="[^"]{6,}">[^<]{1,2}$/, `${b} is an icon with its words in a title`);
  }
  assert.match(bar, /data-btn="settingsmenu"[^>]*title="more: /, 'the button is called "more"');
  // the popover is hidden until open — at every width, on a mouse or a finger
  assert.match(CSS, /#app\.board\.v2 > \.toolbar \.setgroup\.tbpop \{ display: none;/);
  assert.match(CSS, /#app\.board\.v2 > \.toolbar \.setgroup\.tbpop\.open \{ display: flex; \}/);
  assert.match(CSS, /html\.touch \.remind, html\.touch \.remindrow:not\(:has\(b\)\) \{ display: none; \}/);
  // the owner (2026-09-28) cut most of the how-to sentences outright; the
  // short ones left (haste, planning, the attack builder, the draft) are marked
  assert.ok((MAIN.match(/class="remind"/g) ?? []).length >= 4, 'the prompt bars\' how-to phrases are marked');
  // the narrow board's rail drawer (2026-09-27) is gone: a 50px strip fits at every size
  assert.match(CSS, /#app\.board\.v2 \{ grid-template-columns: minmax\(0, 1fr\) 50px; \}/);
  assert.doesNotMatch(CSS, /railopen|#app\.board\.v2::(before|after)/, 'no drawer, no ☰ tab, no scrim pseudo-element');
  assert.doesNotMatch(read('../touch.ts'), /railopen/, 'and nothing in touch.ts opens one');
});

test('§8 the draft and the draw are a dialog that hides to show the board, and Enter still confirms them', () => {
  // the panels are painted only inside the dialog, never into the board's flow
  const tpl = MAIN.slice(MAIN.indexOf('$app.innerHTML = `'));
  assert.ok(!/^\s*\$\{draftPanelHtml\(\)\}$/m.test(tpl) && !/^\s*\$\{bottomPanelHtml\(\)\}$/m.test(tpl),
    'the pick panels are not slots of the board any more');
  assert.match(tpl, /\$\{pickOpen\(\) \? pickModalHtml\(\) : ''\}/, 'they are one dialog');
  assert.match(MAIN, /function pickModalHtml[\s\S]*?class="overlay pickover"[\s\S]*?data-btn="pickhide"[\s\S]*?draftPanelHtml\(\)\}\$\{bottomPanelHtml\(\)\}/);
  assert.match(MAIN, /if \(pickOpen\(\)\) \{ pickHidden = true; return true; \}/, 'Escape / a tap outside only HIDES it');
  assert.match(MAIN, /data-btn="pickshow"/, 'and the action bar has the way back');
  // Enter: blocked behind other dialogs, but the pick dialog alone IS the action
  assert.match(MAIN, /if \(overlayUp && !\(pickOpen\(\) && !ui\.menu && !document\.querySelector\('\.overlay:not\(\.pickover\)'\)\)\) return;/);
});
