/* BL-18 — FULL CONTROL, ROW FOUR: THE FORCED-ACTION DRAIN THAT IS OURS.
 *
 * ⚠ THE ENTRY SAYS THE FOURTH ROW IS THE SERVER'S. IT IS ONLY HALF THE
 * SERVER'S, and BL-18's own note says so in passing without drawing the
 * conclusion: `forcedAction()` "lives in apply.ts but is drained by the SERVER
 * and the hotseat act(), never by the engine". The client-side drain lived in
 * ui/main.ts's `act()` — so one of the two drain sites could be switched off
 * with the rest of the client half, and was.
 *
 * ⚠ 2026-09-23: that client-side drain is GONE, with the hotseat mode whose
 * local-apply arm it lived in. There is one drain site now, the server's, and
 * this file reaches it through `local()` — a server in ui-driver.ts serving
 * both seats over the ordinary net path. What is under test did not move.
 *
 * The other is `server/main.ts::drainForced`, and it is untouched: the round
 * brief routes any server edit through the lane that owns it. So a NETWORK
 * game under full control still has an empty board attacking by itself; a
 * HOTSEAT one does not. 272 §5 keeps a census of both sites so a third cannot
 * appear unnoticed.
 *
 * WHY THE SWITCH IS AT THE DRAIN AND NOT IN `forcedAction()`. The entry
 * records the answer as history rather than as taste: engine-side auto-skip
 * was tried once, broke 242 scripted tests, and was reverted. `forcedAction`
 * is a pure question about a state ("does this board owe a step nobody can
 * choose about?") and 242 tests rely on the answer. What full control changes
 * is whether anybody ANSWERS it for you.
 *
 * ── WHAT AN EMPTY BOARD DOES BY ITSELF
 *
 * With nothing in play there is no attack to declare and no block to make, so
 * the engine offers `declareAttack` with no columns as the only legal action
 * and the drain takes it — eight steps in a row if that is what it takes. The
 * player never sees the window. Under full control they do, and the board sits
 * there until they click, which is the entry's second doneWhen line: "stopped
 * at every window where you have any legal action, including ones with a
 * single option."
 *
 * §1 the negative control: with the switch OFF the board still drains itself
 * §2 with it ON the drain stops and the window is handed over
 *
 * HOW THE CLIENT IS DRIVEN: test/ui-driver.ts in HOTSEAT mode — no socket,
 * main.ts's own Harness, clicks through main.ts's own handlers. A process gets
 * one ui/main.ts, which is why this is a file of its own and not a section of
 * 272 (144 does the same for the same reason).
 *
 * Seeds 27300-27399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { forcedAction, legalActions } from '../src/apply.ts';
import type { GameState, Seat } from '../src/types.ts';
import { skipHasteStep } from './util.ts';

// ⚠ set BEFORE the driver is imported, and imported dynamically — a static
// import is hoisted and would start the ONLINE client instead (see 144).
const { local } = await import('../../ui/test/ui-driver.ts');
const ui = local();

/**
 * CT-183 — FULL CONTROL IS A KEY YOU HOLD, and this file used to set a
 * localStorage flag. The owner (questions-round36 Q5): *"when you're holding
 * control, you will be given every single stop … When you let go, it goes
 * right back to the way it was."* Everything §1 and §2 measure survived that
 * change unaltered — the machinery was right and only the trigger was wrong —
 * so this helper is the whole diff.
 */
const setFull = (on: boolean): void => { ui.key('Control', on ? {} : { up: true }); };

/**
 * An empty board at the top of a battle: nobody has anything in play, so the
 * only legal action either seat has is to declare an attack with no columns —
 * a window with exactly one option, which is the shape the drain exists for
 * and the shape doneWhen line 2 names.
 */
function emptyBattle(seed: number): { s: GameState; seat: Seat } {
  const h = new Harness(seed);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  const seat = h.state.battle!.attacker;
  const legal = legalActions(h.state, seat).map(a => a.type);
  assert.deepEqual(legal, ['declareAttack'],
    `fixture: an empty board owes exactly one action, got ${legal.join(',') || 'none'}`);
  assert.notEqual(forcedAction(h.state), null,
    'fixture: the engine really does call this a forced step — otherwise there is no drain to '
    + 'switch off and both sections below are about nothing');
  return { s: h.state, seat };
}

/** how far the board got: the battle step it is sitting in, or 'over' */
const stepOf = (s: GameState): string => s.battle?.step ?? `no battle (${s.phase})`;

/* ══ §1 — the negative control ═════════════════════════════════════════ */

test('BL-18 §1 with full control OFF an empty board still steps itself along', () => {
  // doneWhen line 4 again, on the row the entry did not think was ours.
  setFull(false);
  const { s } = emptyBattle(27300);
  ui.show(s);
  ui.click({ btn: 'skipattack' });
  const after = ui.state();
  assert.equal(forcedAction(after), null,
    `the board stopped owing forced steps... it is still at ${stepOf(after)} and the drain did `
    + 'not run. With the switch OFF nothing about current behaviour may change, and this is the '
    + 'behaviour: an empty board attacks and blocks by itself.');
});

/* ══ §2 — with it on, the window is handed over ════════════════════════ */

test('BL-18 §2 with full control ON the drain stops and the player is left the window', () => {
  setFull(true);
  const { s, seat } = emptyBattle(27301);
  ui.show(s);
  const before = ui.state().actionCount;
  ui.click({ btn: 'skipattack' });
  const after = ui.state();

  // ⚠ NOT the battle STEP: the attacker's empty declaration leaves the board
  // in the same step, owing the DEFENDER's. What has to have happened is that
  // the player's own click landed — full control stops the client acting FOR
  // you, it does not stop you acting.
  assert.ok(after.actionCount > before,
    `the declared attack itself did not go through (still at ${stepOf(after)}) — full control `
    + 'must stop the client acting FOR you, not stop you acting');
  assert.notEqual(forcedAction(after), null,
    'the board drained itself anyway. Full control means "stop at every window where you have '
    + 'any legal action, including ones with a single option" — and a forced step is exactly a '
    + 'window with one option.');
  assert.ok(legalActions(after, seat).length > 0 || legalActions(after, (1 - seat) as Seat).length > 0,
    'and somebody is being asked for it, rather than the board having stopped dead');

  // ⚠ THE ANTI-DEADLOCK CHECK, and the reason this is a feature rather than a
  // hang: taking the drain away is only safe if the client OFFERS the window
  // it stopped answering. It does — the same prompt and the same buttons the
  // player would get with units on the board.
  const html = ui.html();
  assert.ok(ui.has({ btn: 'skipattack' }) || ui.has({ btn: 'confirmattack' }),
    'full control stopped the drain and left the player nothing to click — that is not full '
    + 'control, that is a hang');
  assert.match(html, /class="promptbar/,
    'and the prompt bar is telling them it is their move');
});

test('BL-18 §2 …and switching it back off lets the same board drain again', () => {
  // the round trip, so "it stopped" cannot be a board that was never going to
  // move: the identical fixture, the identical click, the opposite setting
  setFull(true);
  const { s } = emptyBattle(27302);
  ui.show(s);
  ui.click({ btn: 'skipattack' });
  assert.notEqual(forcedAction(ui.state()), null, 'held, as §2 says');

  setFull(false);
  const { s: s2 } = emptyBattle(27302);
  ui.show(s2);
  ui.click({ btn: 'skipattack' });
  assert.equal(forcedAction(ui.state()), null,
    'the same board with the switch off did NOT drain — then §2 was measuring something other '
    + 'than the switch');
});
