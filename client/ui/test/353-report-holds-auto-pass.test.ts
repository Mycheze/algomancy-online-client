/* CT-182 — A STANDING AUTO-PASS HOLDS WHILE THE REPORT DIALOG IS OPEN.
 *
 * The entry: "auto-pass keeps firing while a modal is open, including the
 * bug-report dialog you opened to report the moment it is passing through."
 * It was filed as a DECISION, not a defect (auto-pass is a standing
 * arrangement whose point is that you need not watch), and the owner decided
 * on 2026-09-30: it HOLDS while the 📝 Report dialog is open — that dialog
 * only, not the rules reference or the judge.
 *
 * The client half, through the real client (test/ui-driver.ts). The server's
 * copy of a standing pass is held by the `reporthold` message asserted here
 * and proven in server/test/353b-report-hold.test.ts.
 *
 * §1 negative control: with the dialog shut the preference passes
 * §2 open, nothing passes — the preference, a pass already scheduled, Pass all
 * §3 closing re-decides: one pass goes out for the window still in front of
 *    you, and none for a window that has gone
 * §4 the rules reference does not hold (the owner's "report dialog only")
 *
 * Seeds 35300-35399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const STORE = (globalThis as unknown as { localStorage: Storage }).localStorage;

/** a battle window in which this seat's only legal action is to pass (as 272) */
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
const show = (s: GameState, seat: Seat): string => ui.join(viewFor(s, seat), seat, legalActions(s, seat));
const holds = (): unknown[] => ui.sent().filter(m => m['t'] === 'reporthold').map(m => m['on']);
const passes = (seat: Seat): Action[] => [{ type: 'passPriority', seat }];
function openReport(): void {
  if (ui.has({ report: 'close' })) ui.click({ report: 'close' });
  ui.click({ btn: 'reportopen' });
  assert.ok(ui.has({ report: 'close' }), 'fixture: the report dialog is open');
}

test('CT-182 negative control: with the report dialog shut the auto-pass preference passes', () => {
  STORE.setItem('algoAutopass', '1');
  const { s, seat } = passOnlyWindow(35300);
  ui.sent();
  show(s, seat);
  ui.tick();
  assert.deepEqual(ui.actions(), passes(seat),
    'the preference did not pass with the dialog shut, so every "nothing was sent" below would be vacuous');
});

test('CT-182 with the report dialog open nothing passes for you, and closing it passes once', () => {
  STORE.setItem('algoAutopass', '1');
  const { s, seat } = passOnlyWindow(35301);
  const first = passOnlyWindow(35302);
  show(first.s, first.seat);           // a board to open the dialog from
  ui.tick(); ui.sent();
  openReport();
  assert.deepEqual(holds(), [true], 'the server is told the seat is held (its own copy of an arm would pass)');
  show(s, seat);
  ui.tick();
  assert.deepEqual(ui.actions(), [],
    'the client passed while the report dialog was open — the player is reporting THIS moment');
  ui.click({ report: 'close' });
  assert.deepEqual(holds(), [false], 'closing releases the server too');
  ui.tick();
  assert.deepEqual(ui.actions(), passes(seat), 'closing re-decides: the window is still there, so it passes, once');
  ui.tick();
  assert.deepEqual(ui.actions(), [], 'and only once');
});

test('CT-182 a pass already scheduled when the dialog opens is held, then re-decided on close', () => {
  STORE.setItem('algoAutopass', '1');
  const { s, seat } = passOnlyWindow(35303);
  ui.sent();
  show(s, seat);                       // the staggered send is booked, not yet fired
  openReport();
  ui.tick();
  assert.deepEqual(ui.actions(), [], 'the booked pass went out under the open dialog');
  ui.click({ report: 'close' });
  ui.tick();
  assert.deepEqual(ui.actions(), passes(seat),
    'the held window was never passed after the dialog closed — the latch was not freed');
});

test('CT-182 Pass all is kept, not dropped, while the dialog holds it', () => {
  STORE.setItem('algoAutopass', '0');
  const { s, seat } = passOnlyWindow(35304);
  show(s, seat);
  ui.click({ btn: 'passall' });
  ui.tick(); ui.sent();
  assert.ok(ui.has({ btn: 'passallstop' }), 'fixture: Pass all is armed');
  openReport();
  // the next window of the same battle, as the echo of the opponent's pass
  // would bring it (a new actionCount — a fresh window for the arm)
  const next = structuredClone(s);
  next.actionCount += 2;
  ui.update(viewFor(next, seat), legalActions(next, seat));
  ui.tick();
  assert.deepEqual(ui.actions(), [], 'Pass all passed under the open report dialog');
  assert.ok(ui.has({ btn: 'passallstop' }), 'and the arm is still up — held, not cancelled');
  ui.click({ report: 'close' });
  ui.tick();
  assert.deepEqual(ui.actions(), passes(seat), 'closing the dialog lets the standing pass answer the window');
});

test('CT-182 a window that moved on while the dialog was open is not passed on close', () => {
  STORE.setItem('algoAutopass', '1');
  const { s, seat } = passOnlyWindow(35305);
  ui.sent();
  openReport();
  show(s, seat);
  ui.tick();
  // the opponent's view: priority is not ours any more
  const gone = structuredClone(s);
  gone.priority = (1 - seat) as Seat;
  gone.actionCount += 1;
  ui.update(viewFor(gone, seat), legalActions(gone, seat));
  ui.click({ report: 'close' });
  ui.tick();
  assert.deepEqual(ui.actions(), [], 're-decided against the state as it is, not replayed from when it opened');
});

test('CT-182 the rules reference does not hold auto-pass: the report dialog only', () => {
  STORE.setItem('algoAutopass', '1');
  if (ui.has({ report: 'close' })) ui.click({ report: 'close' });
  const { s, seat } = passOnlyWindow(35306);
  ui.sent();
  show(s, seat);                       // (a join shuts every board panel, so the window comes first)
  ui.click({ btn: 'helpopen' });
  assert.ok(ui.has({ btn: 'helpclose' }), 'fixture: the rules reference is open');
  ui.tick();
  assert.deepEqual(ui.actions(), passes(seat),
    'the owner held auto-pass for the report dialog alone, not for every panel');
  // …and a window that ARRIVES while it is open is passed too
  const next = structuredClone(s);
  next.actionCount += 2;
  ui.update(viewFor(next, seat), legalActions(next, seat));
  ui.tick();
  assert.deepEqual(ui.actions(), passes(seat), 'a new window under the rules reference is passed as before');
  ui.click({ btn: 'helpclose' });
});
