/* 685 — ON TOUCH, THE BIN'S USE BUTTON WORKS ON THE FIRST TAP AFTER A READ
 * (CT-411; the one-tap case 646 could not see).
 *
 * CT-381 (test 646) made a tap on a bin card only READ it (report #201) and put
 * a button under each usable card in the bin dialog (`data-btn="binuse"`) as the
 * finger's route to use it. A tap's read holds the zoom up after the finger
 * lifts, and ui/touch.ts eats the click of the NEXT tap so that putting the
 * zoom away never acts on what is under it. CT-408 exempted the board's own
 * button (`tapgo`) and nothing else, so the bin's button, tapped while its
 * card was being read (the natural order: read it, then use it), only put the
 * zoom away; the card was played on the second tap. Measured in headless
 * Chrome with a real CDP finger on 2026-10-25: tap the card, tap Play, nothing
 * sent; tap Play again, playFromBin sent.
 *
 * The suites lay nothing out, so a read's zoom never goes up in the ui-driver
 * (384's header) and 646's tap on binuse passed with or without the bug. What
 * is pinned here is the lift's decision, touch.ts `liftSwallows`, against the
 * button the real client draws in the bin dialog.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { liftSwallows, USE_AFTER_READ } from '../touch.ts';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const ui = await client();
const me = 0 as Seat;

/** an element with these attributes whose `closest` honours a selector list of
 * bare `[name="value"]` / `[name]` selectors, the only kind touch.ts asks */
function el(attrs: Record<string, string>): Element {
  const one = (s: string): boolean => {
    const m = /^\[([a-zA-Z-]+)(?:="([^"]*)")?\]$/.exec(s.trim());
    if (!m) throw new Error(`fake closest cannot read ${s}`);
    return m[2] === undefined ? attrs[m[1]!] !== undefined : attrs[m[1]!] === m[2];
  };
  return { closest: (sel: string) => (sel.split(',').some(one) ? {} : null) } as unknown as Element;
}

/** the attributes of the first `<button>` in `html` carrying data-btn=`btn` */
function buttonAttrs(html: string, btn: string): Record<string, string> {
  const tag = new RegExp(`<button[^>]*data-btn="${btn}"[^>]*>`).exec(html)?.[0];
  assert.ok(tag, `a ${btn} button is drawn`);
  return Object.fromEntries([...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(m => [m[1]!, m[2]!]));
}

function battleWithABinCard(seed: number): GameState {
  const h = new Harness(seed);
  toDeployment(h);
  spawn(h, me, 'Hooba-Nan');
  toNextBattle(h, me);
  const s = structuredClone(h.state);
  s.players[me]!.bin = ['Fireball'];
  return s;
}

test('CR 405.9 / CT-411: with a read up, a tap on the use button the bin dialog draws is that button, not a put-away', () => {
  const PLAY: Action[] = [{ type: 'playFromBin', seat: me, binIndex: 0 }];
  ui.join(battleWithABinCard(68501), me, PLAY);
  ui.pointer('pointerdown', { btn: 'binopen', p: me }, { pointerType: 'mouse', pointerId: 2, isPrimary: true });
  const html = ui.click({ btn: 'binopen', p: me });
  const use = el(buttonAttrs(html, 'binuse'));
  assert.equal(liftSwallows(true, 'pointerup', false, use), false,
    'its click goes through on the first tap, and the lift puts the read away as it does');
  // the board button CT-408 exempted is still exempt
  assert.equal(liftSwallows(true, 'pointerup', false, el({ 'data-btn': 'tapgo' })), false);
});

test('CR 405.9 / CT-411: the control, with a read up any other tap is eaten, in the bin dialog too', () => {
  const others: Record<string, string>[] = [{ 'data-btn': 'binclose' }, { 'data-act': 'bin', 'data-p': '0', 'data-i': '0' }, { 'data-btn': 'pass' }, {}];
  for (const other of others) {
    assert.equal(liftSwallows(true, 'pointerup', false, el(other)), true, `a tap on ${JSON.stringify(other)} only puts the read away`);
  }
  assert.equal(liftSwallows(true, 'pointerup', false, null), true);
  // a tap on the zoom own button was acted on by the lift itself: its click is eaten even over a use button
  assert.equal(liftSwallows(true, 'pointerup', true, el({ 'data-btn': 'binuse' })), true);
});

test('CT-411: with no read up nothing is eaten, and a cancelled gesture eats nothing', () => {
  assert.equal(liftSwallows(false, 'pointerup', false, el({ 'data-btn': 'binclose' })), false);
  assert.equal(liftSwallows(true, 'pointercancel', false, el({ 'data-btn': 'binclose' })), false);
  assert.match(USE_AFTER_READ, /binuse/);
});

test('CT-411 wiring: the lift handler asks liftSwallows and nothing else decides the swallow', () => {
  const src = readFileSync(join(UI, 'touch.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const lift = /const lift = \(e: PointerEvent\): void => \{([\s\S]*?)\n {2}\};/.exec(src)?.[1] ?? '';
  assert.match(lift, /if \(liftSwallows\(was, e\.type, go, e\.target as Element \| null\)\) swallowNextClick\(\);/);
  assert.equal(lift.match(/swallowNextClick/g)?.length, 1, 'one swallow, through the decision');
});
