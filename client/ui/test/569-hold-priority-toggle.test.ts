/* CR 703.2a / CT-253 — THE CLIENT'S HALF OF KEEPING PRIORITY.
 *
 * The owner, 2026-10-22: "auto-pass, hold to keep". After you act the game
 * passes priority on as it always has, unless you hold Ctrl (full control,
 * CT-183) or turn the hold toggle on — then the action the client sends asks
 * to keep priority (`holdPriority: true`). The toggle is the tablet's way in.
 *
 * Driven through the real client (test/ui-driver.ts): the toggle is the bar's
 * own button, Ctrl is the real key through main.ts's listener, and what is
 * asserted is what went out on the wire.
 *
 * Seeds 56900-56949.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { give, giveResources, pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();
const STORE = (globalThis as unknown as { localStorage: Storage }).localStorage;
STORE.setItem('algoAutopass', '0');

/** the defender holds the attack window with a Fireball in hand */
function window(seed: number): { s: GameState; D: Seat; i: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Oorblak');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  assert.equal(h.state.priority, D, 'fixture: the defender has priority');
  giveResources(h, D, 'fire', 3);
  const i = give(h, D, 'Fireball');
  return { s: h.state, D, i };
}

/** show the window, click the Fireball, and return the first action sent */
function playIt(seed: number): Action {
  const { s, D, i } = window(seed);
  ui.join(viewFor(s, D), D, legalActions(s, D));
  ui.sent();
  mouse({ act: 'hand', p: D, i });
  ui.click({ act: 'hand', p: D, i });
  const all = ui.actions();
  // [59] one intent per state: a refusal lifts the client's send latch, so the
  // next fixture (which reaches the same action count) is live again
  ui.push({ t: 'error', msg: 'released by the test' });
  const sent = all.filter(a => a.type === 'playCard');
  assert.equal(sent.length, 1, `fixture: the click played the card (sent ${JSON.stringify(all)})`);
  return sent[0]!;
}

/** a mouse's press, so the next click is a mouse click again after a tap
 * (ui/touch.ts reads the last pointer's type) */
const mouse = (want: Record<string, string | number>): void => {
  ui.pointer('pointerdown', want, { pointerType: 'mouse', pointerId: 2, isPrimary: true });
};

const toggleOn = (): boolean => /data-btn="holdprio"[^>]*aria-pressed="true"/.test(ui.html());

test('CR 703.2a / CT-253: with the toggle off and no Ctrl, a play goes out as it always did', () => {
  const a = playIt(56900);
  assert.equal(a.holdPriority, undefined, 'no ask — priority passes on after the play, as before');
});

test('CR 703.2a / CT-253: the hold toggle sits beside Pass and a tap turns it on', () => {
  const { s, D } = window(56901);
  ui.join(viewFor(s, D), D, legalActions(s, D));
  assert.ok(ui.has({ btn: 'holdprio' }), 'the toggle is on the priority bar');
  assert.equal(toggleOn(), false, 'and starts off');
  ui.tap({ btn: 'holdprio' });   // a finger, not a key: a tablet has no Ctrl
  assert.equal(toggleOn(), true, 'one tap turns it on');
  assert.deepEqual(ui.actions(), [], 'and the tap itself sends nothing');
  const a = playIt(56902);
  assert.equal(a.holdPriority, true, 'with it on, the play asks to keep priority');
  const w = window(56907);
  ui.join(viewFor(w.s, w.D), w.D, legalActions(w.s, w.D));
  mouse({ btn: 'holdprio' });
  ui.click({ btn: 'holdprio' });
  assert.equal(toggleOn(), false, 'and it turns off again');
  assert.equal(playIt(56903).holdPriority, undefined, 'off: no ask');
});

test('CR 703.2a / CT-253: holding Ctrl asks too, and letting go stops asking', () => {
  const w = window(56908);
  ui.join(viewFor(w.s, w.D), w.D, legalActions(w.s, w.D));
  ui.key('Control');
  assert.match(ui.html(), /Hold priority: on \(Ctrl\)/, 'the toggle reads on while Ctrl is down, and says why');
  const a = playIt(56904);
  assert.equal(a.holdPriority, true, 'Ctrl held: the play asks to keep priority');
  ui.key('Control', { up: true });
  assert.equal(playIt(56905).holdPriority, undefined, 'released: no ask');
});

test('CR 703.2a / CT-253: a pass never carries the ask', () => {
  const { s, D } = window(56906);
  ui.join(viewFor(s, D), D, legalActions(s, D));
  mouse({ btn: 'holdprio' });
  ui.click({ btn: 'holdprio' });
  ui.sent();
  ui.click({ btn: 'pass' });
  const sent = ui.actions();
  ui.push({ t: 'error', msg: 'released by the test' });
  ui.join(viewFor(s, D), D, legalActions(s, D));
  mouse({ btn: 'holdprio' });
  ui.click({ btn: 'holdprio' });   // leave it off for whoever runs next
  assert.equal(toggleOn(), false);
  assert.deepEqual(sent, [{ type: 'passPriority', seat: D }], 'a battle pass is just a pass');
});

test('CR 507.5 / CT-253: in deployment nothing asks to hold — no toggle, and Ctrl adds nothing', () => {
  // The owner, 2026-10-22: "you CANNOT hold priority during Deployment." The
  // engine refuses the ask there (568), so the client must never send it.
  const w = window(56909);
  ui.join(viewFor(w.s, w.D), w.D, legalActions(w.s, w.D));
  mouse({ btn: 'holdprio' });
  ui.click({ btn: 'holdprio' });
  assert.equal(toggleOn(), true, 'fixture: the toggle is on, from a battle');

  const h = new Harness(56910);
  toDeployment(h);
  assert.equal(h.state.phase, 'deploy', 'fixture: deployment');
  const seat = h.state.initiative;
  giveResources(h, seat, 'wood', 6);
  const i = give(h, seat, 'Prickly Protector');
  ui.key('Control');
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  assert.equal(ui.has({ btn: 'holdprio' }), false, 'the deployment bar offers no hold');
  ui.sent();
  mouse({ act: 'hand', p: seat, i });
  ui.click({ act: 'hand', p: seat, i });
  const sent = ui.actions();
  ui.key('Control', { up: true });
  ui.push({ t: 'error', msg: 'released by the test' });
  const play = sent.find(a => a.type === 'playCard');
  assert.ok(play, `fixture: the click played the card (sent ${JSON.stringify(sent)})`);
  assert.equal(play!.holdPriority, undefined, 'toggle on and Ctrl held, and still no ask in deployment');

  // leave the toggle off for whoever runs next
  const v = window(56911);
  ui.join(viewFor(v.s, v.D), v.D, legalActions(v.s, v.D));
  mouse({ btn: 'holdprio' });
  ui.click({ btn: 'holdprio' });
  assert.equal(toggleOn(), false);
});
