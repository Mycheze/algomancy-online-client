/* R238 — ZEPHYRZOA HEARS A HIT THAT COST NO LIFE.
 *
 * ── WHY THIS FILE EXISTS, AND IT IS NOT A HAPPY REASON ────────────────
 *
 * R238 ruled (the owner, 2026-08-28) that a REPLACED combat hit was still
 * dealt: "blightsea pollup says it deals damage as, so its still damage. Just
 * not as life." Nine cards were migrated from `lifeLost` to the new
 * `combatFaceDamage` event. **Zephyrzoa was the tenth and was left behind**,
 * because its card file belonged to another agent that round.
 *
 * When the orchestrator made that one-line migration and then BROKE IT BACK to
 * `lifeLost` to check the guard, **nothing in the entire suite noticed.** The
 * fix was real and completely unguarded — the exact shape `playtest-ledger.ts`
 * opens with (Harbinger of Immolation looked tracked for two days behind a
 * placeholder that could never fail). A fix nothing can see regress is a commit
 * message, not a fix.
 *
 * ── WHAT MAKES THE OLD BEHAVIOUR INVISIBLE ────────────────────────────
 *
 * `Blightsea Polyp` prints "[Augment] Columns deal combat damage to players as
 * 1 rot" — the hit lands, the defender takes rot, and **their life does not
 * change**. So no `lifeLost` is emitted at all. A Zephyrzoa listening on
 * `lifeLost` is therefore SILENTLY BLIND to every face hit while a Polyp is
 * out: not wrong once, wrong for the whole game, and saying nothing about it.
 *
 * That is why the assertion below is on the FULL consequence (bin recalled AND
 * self erased) rather than on the event: an event assertion would pass on a
 * card that heard the hit and then did nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { ent, finishBattle, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Seat } from '../src/types.ts';

/** drain whatever the combat pump raised until the stack is empty */
function settle(h: Harness): void {
  let guard = 60;
  while (guard-- > 0) {
    if (h.state.decision) { h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); continue; }
    if (h.state.stack.length) { pass(h); continue; }
    break;
  }
}

test('R238: Zephyrzoa fires on a hit that was REPLACED and cost no life', () => {
  const h = new Harness(5380);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;

  const zep = spawn(h, A, 'Zephyrzoa');        // 1/1, its own [Augment] is live
  const ally = spawn(h, A, 'Unit Token');      // 1/1 — the column needs power
  // ⚠ ON THE DEFENDER'S SIDE, and that is not incidental. The R38 hook is
  // REGION-scoped (`a.region === info.region`), not seat-scoped — the printed
  // text says "columns" with no owner. A Polyp left standing at home is in the
  // wrong region and replaces nothing, which is exactly how the first draft of
  // this test measured nothing while looking correct.
  spawn(h, D, 'Blightsea Polyp');

  toNextBattle(h, A);
  for (const p of h.state.players) { p.bin.length = 0; p.hand.length = 0; }
  h.state.players[A]!.bin.push('Gublin', 'Shib');
  const life0 = h.state.players[D]!.life;

  h.do({ type: 'declareAttack', seat: A, columns: [[zep, ally]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  settle(h);

  // 1. THE REPLACEMENT REALLY HAPPENED. Without this the test would pass on a
  //    board where the Polyp did nothing and the hit was an ordinary one — it
  //    would then be measuring nothing at all.
  assert.equal(h.state.players[D]!.life, life0,
    'the Polyp replaced the face hit, so no life was lost — if this fails the '
    + 'replacement did not fire and the rest of this test proves nothing');

  // 2. AND ZEPHYRZOA STILL HEARD IT. Under the pre-R238 `lifeLost` subscription
  //    both of these fail, because no lifeLost event is emitted on this board.
  assert.deepEqual(h.state.players[A]!.hand.slice().sort(), ['Gublin', 'Shib'],
    'R238: the hit was DEALT, so Zephyrzoa recalled the whole bin');
  assert.equal(ent(h, zep), undefined,
    'R238: and erased itself — the full printed consequence, not just the trigger');

  finishBattle(h);
});

test('R238 CONTROL: the same column with no Polyp still costs life, and still fires', () => {
  // The negative half. A guard that only ever sees the replaced case cannot
  // tell "hears replaced hits" from "hears nothing but happens to pass", and a
  // migration that broke the ORDINARY path would sail through the test above.
  const h = new Harness(5381);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;

  const zep = spawn(h, A, 'Zephyrzoa');
  const ally = spawn(h, A, 'Unit Token');

  toNextBattle(h, A);
  for (const p of h.state.players) { p.bin.length = 0; p.hand.length = 0; }
  h.state.players[A]!.bin.push('Gublin');
  const life0 = h.state.players[D]!.life;

  h.do({ type: 'declareAttack', seat: A, columns: [[zep, ally]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  settle(h);

  assert.ok(h.state.players[D]!.life < life0,
    'no Polyp, so this hit really did cost life — the ordinary path');
  assert.deepEqual(h.state.players[A]!.hand, ['Gublin'],
    'and Zephyrzoa fires on it exactly as it always did');
  assert.equal(ent(h, zep), undefined, 'and erases itself');

  finishBattle(h);
});
