/* Report #323 — THE BROWSER TELLS THE SERVER ITS AUTO-PASS TOGGLE.
 *
 * The client half of server/test/1242: the server can only stop the clock for
 * the windows the toggle answers if it hears the toggle. Until 2026-11-13 the
 * toggle never left the browser, so the pass-only windows it answered were
 * billed to the seat for the client's whole pace hold and stagger.
 *
 * §1 a join with the toggle on sends it, once, before the pass it causes
 * §2 turning it off sends the off; nothing is sent for a client that never had it on
 *
 * Seeds 124250-124299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const STORE = (globalThis as unknown as { localStorage: Storage }).localStorage;

function passOnlyWindow(seed: number): { s: GameState; seat: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Oorblak');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  e.player(0).hand = []; e.player(1).hand = [];
  e.settle();
  const seat = h.state.priority as Seat;
  assert.deepEqual(legalActions(h.state, seat).map(a => a.type), ['passPriority'], 'fixture: a pass-only window');
  return { s: h.state, seat };
}
const autos = (sent: Record<string, unknown>[]): unknown[] =>
  sent.filter(m => m['t'] === 'autopass').map(m => ({ pref: m['pref'], yields: m['yields'] }));

test('§1 a join with the toggle on tells the server, once, before the pass it makes', () => {
  STORE.setItem('algoAutopass', '1');
  const { s, seat } = passOnlyWindow(124250);
  ui.sent();
  ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  ui.tick();
  const sent = ui.sent();
  assert.deepEqual(autos(sent), [{ pref: true, yields: [] }], 'the toggle reached the wire exactly once');
  const iAuto = sent.findIndex(m => m['t'] === 'autopass');
  const iPass = sent.findIndex(m => m['t'] === 'action');
  assert.ok(iPass > iAuto, `the toggle went out before the pass it caused (autopass at ${iAuto}, pass at ${iPass})`);
});

test('§2 turning it off sends the off; a client that never had it on sends nothing', () => {
  STORE.setItem('algoAutopass', '1');
  const { s, seat } = passOnlyWindow(124251);
  ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  ui.tick(); ui.sent();
  STORE.setItem('algoAutopass', '0');
  const later = structuredClone(s);
  later.actionCount += 2;
  ui.update(viewFor(later, seat), legalActions(later, seat));
  ui.tick();
  assert.deepEqual(autos(ui.sent()), [{ pref: false, yields: [] }], 'the server heard the toggle go off');
  // a fresh join with it off: the server already assumes off, so nothing goes out
  const { s: s2, seat: seat2 } = passOnlyWindow(124252);
  ui.join(viewFor(s2, seat2), seat2, legalActions(s2, seat2));
  ui.tick();
  assert.deepEqual(autos(ui.sent()), [], 'nothing to say, nothing sent');
});
