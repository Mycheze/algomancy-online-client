/* 712 — THE TOOLBAR (board round 8, plan §P4; owner and invi, 2026-10-27:
 * the 250px rail "mostly repeats what hover zoom already does better").
 *
 * The regions board's right column is a strip of icons, 50px at every width.
 * What it must keep from the rail it replaced:
 *
 * §1  it is the board's right column, and the rail's viewer, head and drawer
 *     are gone (reading a card is the zoom, or a finger's read — test/714)
 * §2  every button the rail had, with the SAME data-btn (test/75 and every
 *     test that clicks one), an icon with its words in its hover title — and
 *     each one does its job by a mouse's click AND a finger's tap
 * §3  the toggles are behind ⋯, and each is reachable once it is open
 * §4  the clocks: theirs over yours, the running one lit, short (m:ss, 1h05),
 *     and their words a tap away
 * §5  the room: one icon, its presence dot — "offline" said in words — the
 *     watchers counted, the details in its window (hover, or a tap)
 * §6  the game's chips and the pass-through stop have a home on it
 * §7  the stylesheet: one 50px column at every width, the scrim, the pick
 *     dialog and the reveal notice keyed to it; the windows open beside it
 *
 * Driven through the real client (test/ui-driver.ts). The driver lays nothing
 * out: hit-testing every button, the popovers' boxes and the windows beside
 * the strip were checked in headless Chrome at 1920x1080, 1344x768, 1024x768
 * (touch), 800x600, 700x900 and 1280x500 — every button the element under
 * its own centre, 0 repaints at idle, 1 per click.
 *
 * Seeds 71200-71299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { besideBox } from '../infotip.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const read = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const CSS = read('../style.css');

/** the toolbar's markup in `html` */
function strip(html: string): string {
  const at = html.indexOf('<div class="side toolbar">');
  assert.ok(at >= 0, 'the board has a toolbar');
  const end = html.indexOf('<div class="handdock', at);
  return html.slice(at, end > at ? end : undefined);
}

function deploy(seed: number): { s: GameState; me: Seat; legal: Action[] } {
  const h = new Harness(seed, ['Ann', 'Bo']);
  toDeployment(h);
  const me = 0 as Seat;
  spawn(h, me, 'Good Whale');
  return { s: h.state as GameState, me, legal: legalActions(h.state, me) as Action[] };
}

/** a press of the given kind, then the click: a finger's tap, or a mouse */
function press(how: 'click' | 'tap', want: Record<string, string | number>): string {
  if (how === 'tap') return ui.tap(want);
  ui.pointer('pointerdown', want, { pointerType: 'mouse', pointerId: 2, isPrimary: true });
  return ui.click(want);
}

test('§1 the right column is the toolbar; the rail\'s viewer, head and card menu are gone', () => {
  const { s, me, legal } = deploy(71200);
  const html = ui.join(s, me, legal);
  const bar = strip(html);
  assert.ok(html.indexOf('class="actionbar"') < html.indexOf('<div class="side toolbar">'), 'after the action bar, as the rail was');
  for (const gone of ['id="preview"', 'class="sidehead"', 'class="sidebtns', 'class="railmenu"', 'data-btn="railitem"', 'class="railchips"']) {
    assert.ok(!html.includes(gone), `${gone} is gone from the regions board`);
  }
  assert.doesNotMatch(bar, /class="scnpanel"/, 'no scenario panel in an ordinary room');
});

test('§2 every button: its data-btn, an icon, its words in a title — and a click or a tap does its job', () => {
  for (const how of ['click', 'tap'] as const) {
    const { s, me, legal } = deploy(how === 'click' ? 71201 : 71202);
    const bar = strip(ui.join(s, me, legal));
    for (const b of ['tablemenu', 'reportopen', 'judgeopen', 'helpopen', 'settingsmenu']) {
      const m = new RegExp(`<button data-btn="${b}"[^>]*title="([^"]+)"[^>]*>([^<]*)</button>`).exec(bar);
      assert.ok(m, `${b} is on the toolbar with a title`);
      assert.ok(m[1]!.length >= 4, `${b}'s title says something: "${m[1]}"`);
      assert.ok([...m[2]!.trim()].length <= 2, `${b} is an icon, not words: "${m[2]}"`);
    }
    // ☰ table: exactly the bare-table menu
    assert.match(press(how, { btn: 'tablemenu' }), /class="menu"/, `${how}: ☰ opens the table menu`);
    ui.click({ btn: 'menuclose' });
    // ⚖ the judge, ? the rules — dialogs, each closed by Escape
    assert.match(press(how, { btn: 'judgeopen' }), /id="judge-q"/, `${how}: ⚖ opens the judge`);
    ui.key('Escape');
    assert.match(press(how, { btn: 'helpopen' }), /id="rules-list"/, `${how}: ? opens the rules`);
    ui.key('Escape');
    // 📝 the report form, a layer beside the board (ui/report.ts)
    assert.ok(press(how, { btn: 'reportopen' }).includes('data-report="close"'), `${how}: 📝 opens the report form`);
    ui.click({ report: 'close' });
    // ⋯ more: the popover opens, and shuts again
    assert.match(strip(press(how, { btn: 'settingsmenu' })), /<div class="setgroup tbpop open">/, `${how}: ⋯ opens the toggles`);
    assert.doesNotMatch(strip(press(how, { btn: 'settingsmenu' })), /setgroup tbpop open/, `${how}: and ⋯ again shuts them`);
  }
});

test('§3 the toggles live behind ⋯ and each one works from there', () => {
  const { s, me, legal } = deploy(71203);
  const shut = strip(ui.join(s, me, legal));
  const group = (b: string): string => b.slice(b.indexOf('<div class="setgroup'), b.indexOf('</div>', b.indexOf('<div class="setgroup')));
  for (const t of ['autopasstoggle', 'bluffhastetoggle', 'motiontoggle', 'layouttoggle', 'soundtoggle']) {
    assert.ok(group(shut).includes(`data-btn="${t}"`), `${t} is in the ⋯ popover`);
  }
  assert.ok(group(shut).includes('data-chip="fullcontrol"'), 'the full-control readout too');
  const open = strip(ui.click({ btn: 'settingsmenu' }));
  const before = /data-btn="motiontoggle"[^>]*>✨ motion: (on|off)/.exec(open)?.[1];
  assert.ok(before, 'the motion toggle says its state');
  const after = /data-btn="motiontoggle"[^>]*>✨ motion: (on|off)/.exec(strip(ui.click({ btn: 'motiontoggle' })))?.[1];
  assert.notEqual(after, before, 'a toggle flips from inside the popover');
  ui.click({ btn: 'motiontoggle' });
  assert.match(strip(ui.html()), /setgroup tbpop open/, 'and the popover stays open while you set things');
  ui.click({ btn: 'settingsmenu' });
});

test('§4 the clocks: theirs over yours, the running one lit, short — and their window a tap away', () => {
  const { s, me, legal } = deploy(71204);
  ui.join(s, me, legal);
  const at = Date.now();
  const bar = strip(ui.update(s, legal, { clock: { ms: [65_000, 3_900_000], running: [false, true], at, start: 3_600_000 } }));
  const cells = [...bar.matchAll(/<span class="clocktime (opp|you)([^"]*)" data-clkseat="(\d)" data-short="1">([^<]*)<\/span>/g)];
  assert.deepEqual(cells.map(c => c[1]), ['opp', 'you'], 'theirs on top, yours under it — as the board stacks the seats');
  assert.deepEqual(cells.map(c => Number(c[3])), [1, 0], 'each names its seat for the 1s ticker');
  assert.equal(cells[0]![4], '1h05', 'an hour and more: 1h05, never a "1:05" that reads as minutes');
  assert.equal(cells[1]![4], '1:05', 'under an hour: m:ss');
  assert.match(cells[0]![2]!, /\brun\b/, 'the running clock is lit');
  assert.doesNotMatch(cells[1]![2]!, /\brun\b/);
  const tip = ui.tap({ tip: 'clocks' });
  assert.match(tip, /<div class="tiphead">⏱ chess clocks<\/div>/, 'a tap on the clocks opens their window');
  assert.match(tip, /<tr class="tiprun"><th>Bo<\/th><td>1:0[45]:\d\d<\/td><\/tr><tr><th>you<\/th><td>1:05<\/td><\/tr>/,
    'whose is whose, in full, the running one marked');
  ui.tap({ tip: 'clocks' });
});

test('§5 the room: one icon, presence on it ("offline" in words), the watchers, the details in its window', () => {
  const { s, me, legal } = deploy(71205);
  ui.join(s, me, legal);
  const on = strip(ui.html());
  assert.match(on, /<button class="tbstat" data-tip="room" data-btn="infotip" aria-label="room UIDRIVER">ⓘ<span class="liveslot" id="presenceslot"><span class="presence on"/,
    'the room is an icon, the presence dot on it');
  const off = strip(ui.update(s, legal, { peers: [true, false], watchers: 2 }));
  assert.match(off, /<span class="presence off"[^>]*>●<span class="tbsub">offline<\/span><\/span>/, 'offline is said in words, not only a colour');
  assert.match(off, /<span class="tbcount">2<\/span>/, 'the watchers, counted on the icon');
  assert.match(CSS, /\.toolbar > \.tbstat:has\(\.presence\.off\) \{ border-color: var\(--danger\);/, 'and the whole button turns red');
  // hover and tap open the same window (ui/infotip.ts); here, a tap
  const tip = ui.tap({ tip: 'room' });
  assert.match(tip, /<div class="tiphead">ⓘ room UIDRIVER<\/div>/);
  assert.match(tip, /👁 2 watching — they see both hands/);
  assert.match(tip, /<div class="tipline tipwarn">● opponent offline<\/div>/);
  assert.doesNotMatch(ui.tap({ tip: 'room' }), /class="tiphead">ⓘ/, 'a second tap drops it');
});

test('§6 the pass-through stop is on the toolbar, lit, and stops it', () => {
  const h = new Harness(71206, ['Ann', 'Bo']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const u = spawn(h, A, 'The Foretold');
  spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[u]] });
  for (let g = 0; g < 20 && h.state.stack.length; g++) pass(h);
  ui.join(h.state as GameState, A, legalActions(h.state, A) as Action[]);
  assert.doesNotMatch(strip(ui.html()), /data-btn="passallstop"/, 'nothing to stop yet');
  const bar = strip(ui.click({ btn: 'passall' }));
  const stop = /<button class="passallchip" data-btn="passallstop"\s+title="([^"]+)">⏩<span class="tbsub">stop<\/span><\/button>/.exec(bar);
  assert.ok(stop, 'Pass all armed: the stop is on the toolbar, an icon with "stop" under it');
  assert.match(stop[1]!, /passing until the next phase.*Click to stop\./, 'its title says what is armed and how it ends');
  assert.doesNotMatch(strip(ui.tap({ btn: 'passallstop' })), /data-btn="passallstop"/, 'a tap stops it');
});

test('§6 the game\'s chips: a badge whose window names them', () => {
  const h = new Harness(71207, ['Ann', 'Bo'], 'draft');
  const s = h.state as GameState;
  assert.ok(s.elements.length > 0, 'the fixture is a live draft');
  const bar = strip(ui.join(s, 0, legalActions(s, 0) as Action[]));
  const badge = /<button class="tbgame" data-tip="game" data-btn="infotip"[^>]*><span class="tbels">([\s\S]*?)<\/span><\/button>/.exec(bar);
  assert.ok(badge, 'a draft\'s elements are a badge on the toolbar');
  assert.equal((badge[1]!.match(/class="elicon/g) ?? []).length, s.elements.length, 'one icon per element');
  const tip = ui.tap({ tip: 'game' });
  for (const el of s.elements) assert.ok(tip.includes(el), `its window names ${el}`);
  ui.tap({ tip: 'game' });
});

test('§7 the stylesheet: one 50px column at every width, and what was keyed to the old rail follows it', () => {
  assert.match(CSS, /^#app\.board\.v2 \{ grid-template-columns: minmax\(0, 1fr\) 50px; \}/m);
  for (const m of CSS.matchAll(/^\s*(?:@media[^{]*\{\s*)?#app\.board\.v2 \{ grid-template-columns: ([^;]+);/gm)) {
    assert.equal(m[1], 'minmax(0, 1fr) 50px', `no width gives the regions board another rail: ${m[0].trim()}`);
  }
  // the dialog scrim stops at the strip (test/368 resolves it at every width)
  assert.match(CSS, /#app\.board\.v2 \.overlay\.mainonly \{ right: calc\(max\(0px, \(100vw - 1500px\) \/ 2\) \+ 52px\); \}/);
  // the pick dialog's rail rule at every width (test/673)
  assert.match(CSS, /^#app\.board\.pickup > \.side \{ position: relative; z-index: 59; \}/m);
  // the reveal notice is a row of the table column at every width
  assert.match(CSS, /^#app\.board\.v2 > \.glimpsenotice \{ grid-column: 1; grid-row: 2; \}/m);
  // the popovers open to the strip's left, above the board and under every dialog
  assert.match(CSS, /\.toolbar \.tbpop \{ position: absolute; right: calc\(100% \+ 4px\); z-index: 59;/);
  // the strip is not offset by the old rail's sticky `top`
  assert.match(CSS, /#app\.board\.v2 > \.toolbar \{[^}]*position: relative; top: auto;/);
});

test('§7 a toolbar window opens beside the strip, level with its button, inside the window', () => {
  const view = { w: 1344, h: 768 };
  const box = { width: 150, height: 56 };
  const mid = besideBox({ top: 300, height: 40 }, 1292, box, view);
  assert.equal(mid.left, 1292 - 6 - 150, 'to the strip\'s left, never on it');
  assert.equal(mid.top + box.height / 2, 320, 'level with the button\'s middle');
  assert.equal(besideBox({ top: 2, height: 40 }, 1292, box, view).top, 4, 'kept inside at the top');
  assert.equal(besideBox({ top: 740, height: 26 }, 1292, box, view).top, 768 - 56 - 4, 'and at the bottom');
});
