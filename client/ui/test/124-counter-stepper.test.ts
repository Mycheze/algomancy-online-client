/* BL-25 / R139 — the counter-removal prompt says what to click, and carries a
 * quantity.
 *
 * The owner, verbatim: "It's actually okay, it's just not clear that it wants
 * you to click the unit. It needs to say that. Plus maybe a counter with
 * up/down arrows would be nice too or an 'All' button which jumps the count to
 * the max (without auto submitting) for cases where there are a ton of
 * counters."
 *
 * Three things are pinned here, in the order they were wrong:
 *
 *  1. THE PROMPT. It named the cost ("remove X +1/+1 counters from allies") and
 *     never the action, while the only affordance was a row of ally scans. The
 *     engine says it now, so the log and every client get it — not just the one
 *     client that happens to draw a hint.
 *
 *  2. THE QUANTITY. One counter per click was the whole complaint, and the
 *     obvious client-side fix — send the same decision n times — is unsound
 *     across a network: `decide` carries an option INDEX, and the engine
 *     rebuilds the menu between every one. So the amount lives IN the option
 *     (`{counterFrom: id, n: k}`) and one click pays k.
 *
 *  3. THE MAX. It comes from the engine (`E.counterPickMax` → `counterPool`),
 *     never from the UI counting pips. `counterPool` is the whole ALLY pool
 *     while a pick names ONE unit, so a client tallying board state would offer
 *     to strip four counters off a unit holding two — and would have had to
 *     re-decide R130's "all counters count as counters" to do even that.
 *
 * main.ts runs DOM code on import and no test can reach it (R134, R136), so
 * the stepper's clamp/max/All judgement lives in ui/inspect.ts and is tested
 * there. Both engine paths that ask about a quantity of counters are exercised
 * with real games: the `removeCounters` CAST COST (Discharge, from allies;
 * Soul Reaver, an activated ability from itself) and an EFFECT that removes
 * counters and asks how many (Chombot).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import type { Decision, EntityId, Seat } from '../../engine/src/types.ts';
import {
  COUNTER_AMOUNT_HINT, COUNTER_CLICK_HINT, clampCounterCount, counterAmountIndex,
  counterPickIndex, counterPickUnits, counterStepper, counterStepperCount,
} from '../inspect.ts';
import type { CounterDecisionLike } from '../inspect.ts';
import {
  ent, effStats, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
} from '../../engine/test/util.ts';

/* ── the pure judgement (ui/inspect.ts) ────────────────────────────────── */

/** the menu the engine builds for one ally holding `n` counters */
const pickMenu = (unit: number, n: number, counterMax?: number): CounterDecisionLike => ({
  prompt: 'Discharge: remove X +1/+1 counters from allies (X = 0 so far) — additional cost',
  options: [
    { label: `a unit — has ${n} counters`, value: { counterFrom: unit }, card: 'Unit Token' },
    ...Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({
      label: `Take ${i + 2} counters off a unit`, value: { counterFrom: unit, n: i + 2 },
    })),
  ],
  ...(counterMax === undefined ? {} : { counterMax }),
});

test('the stepper clamps at 1 and at the max the engine gave it', () => {
  const dec = pickMenu(7, 6, 6);
  assert.equal(counterStepper(dec, 1).count, 1, 'one is the floor');
  assert.equal(counterStepper(dec, 0).count, 1, 'zero counters removed is not a pick');
  assert.equal(counterStepper(dec, -4).count, 1);
  assert.equal(counterStepper(dec, 4).count, 4, 'in range, untouched');
  assert.equal(counterStepper(dec, 6).count, 6, 'the max is reachable');
  assert.equal(counterStepper(dec, 99).count, 6, 'and is the ceiling');
  assert.equal(counterStepper(dec, NaN).count, 1, 'a non-number falls to the floor');
  // and the arrows say so, so the bar can grey them
  assert.deepEqual([counterStepper(dec, 1).canDown, counterStepper(dec, 1).canUp], [false, true]);
  assert.deepEqual([counterStepper(dec, 6).canDown, counterStepper(dec, 6).canUp], [true, false]);
});

test('the max is the engine\'s counterMax, not the UI\'s own count of the menu', () => {
  // a "[Remove 2]" cost over a unit holding six would cap its menu at two; if
  // the client re-derived the max from anything but the engine it would offer
  // six and the sixth click would be refused
  const dec = pickMenu(7, 6, 2);
  assert.equal(counterStepper(dec, 99).max, 2, 'the engine\'s ceiling wins');
  assert.equal(counterStepperCount(dec, 1, 'all').count, 2);
});

test('"All" sets the count to the max and does NOT submit', () => {
  const dec = pickMenu(7, 9, 9);
  const all = counterStepperCount(dec, 1, 'all');
  assert.equal(all.count, 9, 'jumps straight to the max');
  assert.equal(all.submit, false, 'the owner: "without auto submitting"');
  // the point of not submitting: the decision is still open and the player can
  // still walk it back down before spending nine counters
  assert.equal(counterStepperCount(dec, all.count, 'down').count, 8);
  assert.equal(counterStepperCount(dec, 9, 'up').count, 9, 'and + cannot push past it');
  assert.equal(counterStepperCount(dec, 1, 'down').count, 1, 'nor − below one');
});

test('a click sends the biggest amount the clicked unit can actually give', () => {
  // two allies, uneven: 3 counters on #7, 2 on #8 — the count dialled in for
  // one is wrong for the other, and refusing the click would be the trap
  const dec: CounterDecisionLike = {
    prompt: 'x — click a unit to take counters off it',
    options: [
      { label: 'A', value: { counterFrom: 7 }, card: 'Unit Token' },
      { label: 'A2', value: { counterFrom: 7, n: 2 } },
      { label: 'A3', value: { counterFrom: 7, n: 3 } },
      { label: 'B', value: { counterFrom: 8 }, card: 'Unit Token' },
      { label: 'B2', value: { counterFrom: 8, n: 2 } },
      { label: 'stop', value: { doneCost: true } },
    ],
    counterMax: 3,
  };
  assert.equal(counterPickIndex(dec, 7 as EntityId, 3), 2, 'three off the unit that has three');
  assert.equal(counterPickIndex(dec, 8 as EntityId, 3), 4, 'the same click takes two off the one that has two');
  assert.equal(counterPickIndex(dec, 7 as EntityId, 1), 0, 'one counter is the bare {counterFrom} option');
  assert.equal(counterPickIndex(dec, 99 as EntityId, 1), -1, 'a unit not on the menu is not clickable');
  assert.deepEqual(counterPickUnits(dec), [7, 8], 'one scan per unit, not one per counter');
});

test('the hint is said exactly once — the bar stays quiet when the prompt already said it', () => {
  const said = pickMenu(7, 3, 3);
  assert.equal(counterStepper(said, 1).hint, COUNTER_CLICK_HINT,
    'a prompt that does not say it gets the instruction');
  const also = { ...said, prompt: `${said.prompt} — ${COUNTER_CLICK_HINT}` };
  assert.equal(counterStepper(also, 1).hint, '', 'and one that does is not made to say it twice');
});

test('an ordinary decision gets no stepper at all', () => {
  assert.equal(counterStepper(null, 1).mode, 'none');
  assert.equal(counterStepper({ prompt: 'choose X', options: [
    { label: '0', value: 0 }, { label: '1', value: 1 }, { label: '2', value: 2 },
  ] }, 1).mode, 'none', 'bare numbers with no counterMax are an X menu, not counters');
  assert.equal(counterStepper({ prompt: 'target', options: [
    { label: 'a', value: { unit: 3 } },
  ] }, 1).mode, 'none');
});

test('an effect that asks HOW MANY counters gets the stepper too', () => {
  // Chombot's shape: the unit is already fixed by the effect's targets, so the
  // options are bare amounts and "Move none" is a real answer
  const dec: CounterDecisionLike = {
    prompt: 'Chombot: move how many counters from Unit Token onto Unit Token?',
    options: [
      { label: 'Move none', value: 0 },
      { label: 'Move 1 +1/+1 counter(s)', value: 1 },
      { label: 'Move 2 +1/+1 counter(s)', value: 2 },
    ],
    counterMax: 2,
  };
  const v = counterStepper(dec, 1);
  assert.equal(v.mode, 'amount');
  assert.deepEqual([v.min, v.max], [0, 2], 'declining is inside the range here');
  assert.equal(v.hint, COUNTER_AMOUNT_HINT);
  assert.equal(counterStepperCount(dec, 1, 'all').count, 2);
  assert.equal(counterStepperCount(dec, 1, 'all').submit, false);
  assert.equal(counterStepperCount(dec, 0, 'down').count, 0, 'clamped at the floor the menu offers');
  assert.equal(counterAmountIndex(dec, 2), 2, 'the confirm sends the option that IS the count');
  assert.equal(counterAmountIndex(dec, 5), -1);
});

test('clampCounterCount is total — every out-of-range input lands in range', () => {
  assert.equal(clampCounterCount(3, 1, 5), 3);
  assert.equal(clampCounterCount(3.9, 1, 5), 3, 'floored, never rounded up past the max');
  assert.equal(clampCounterCount(-1, 1, 5), 1);
  assert.equal(clampCounterCount(9, 1, 5), 5);
  assert.equal(clampCounterCount(3, 1, 0), 1, 'an empty range collapses to its floor');
  assert.equal(clampCounterCount(Infinity, 0, 4), 0);
});

/* ── the cost path, in a real game (Discharge — from allies) ───────────── */

/** the pending decision, as the client sees it */
const dec = (h: Harness): Decision => h.state.decision!;

test('R139: the Discharge cost prompt tells you to click a unit', () => {
  const h = new Harness(13901);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ally = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Unit Token');
  h.state.entities[ally]!.counters = 4;
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Discharge') });

  assert.match(dec(h).prompt, /click a unit/i,
    'the affordance is stated, not left to be discovered');
  assert.match(dec(h).prompt, /remove X \+1\/\+1 counters from allies/,
    'and the cost is still named — the instruction is added, not swapped in');
});

test('R139: the stepper max is counterPool(), asked of the engine', () => {
  const h = new Harness(13902);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ally = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Unit Token');
  h.state.entities[ally]!.counters = 5;
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Discharge') });

  const e = new E(h.state);
  // the cost is asked in the item's region, which for a {Battle} spell cast
  // during an attack is the battle region the ally is standing in
  const pool = e.counterPool(A, ent(h, ally)!.region, 'allies');
  assert.equal(pool, 5, 'one ally, five counters');
  assert.equal(dec(h).counterMax, pool, 'the decision carries the engine\'s own number');
  assert.equal(counterStepper(dec(h), 99).max, pool, 'and the UI never invents its own');
  // …and the menu the engine built agrees with it, so the two cannot drift
  assert.equal(counterPickIndex(dec(h), ally, 99) >= 0, true);
  assert.deepEqual(counterPickUnits(dec(h)), [ally], 'still one scan for the one ally');
});

test('R139: one click pays several counters, and X is what was taken', () => {
  const h = new Harness(13903);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ally = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Lurking Slimebeast');       // 8/3 — survives to be measured
  h.state.entities[ally]!.counters = 4;
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Discharge') });

  // "All" would dial 4; take 3, to prove the count is the player's and not the
  // maximum by default
  const three = counterPickIndex(dec(h), ally, counterStepper(dec(h), 3).count);
  h.do({ type: 'decide', seat: A, choice: three });
  assert.equal(ent(h, ally)!.counters, 1, 'three came off in ONE decision');
  pick(h, { doneCost: true });
  pick(h, { unit: victim });
  assert.equal(h.state.stack[0]!.parts[0]!.costPaid!.x, 3, 'X = the counters actually removed');
  pass(h); pass(h);
  assert.equal(ent(h, victim), undefined, '3 damage killed the 8/3 — the spell is that big');
  finishBattle(h);
});

test('R139: "All" is reachable — the whole pool in one click closes the cost', () => {
  const h = new Harness(13904);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ally = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Lurking Slimebeast');
  h.state.entities[ally]!.counters = 6;
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Discharge') });

  const all = counterStepperCount(dec(h), 1, 'all');
  assert.equal(all.count, 6);
  h.do({ type: 'decide', seat: A, choice: counterPickIndex(dec(h), ally, all.count) });
  assert.equal(ent(h, ally)!.counters, 0, 'six off in one click');
  // the pool is empty, so the variable cost closed itself: no "that's enough"
  pick(h, { unit: victim });
  assert.equal(h.state.stack[0]!.parts[0]!.costPaid!.x, 6, 'X = 6');
  finishBattle(h);
});

test('R139: the pick max is the biggest SINGLE stack, not the whole ally pool', () => {
  // R130 says all counters count as counters; that is not licence to pretend a
  // pool spread over two allies can be taken in one pick. It cannot — a pick
  // names one unit.
  const h = new Harness(13905);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const a1 = spawn(h, A, 'Unit Token');
  const a2 = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Unit Token');
  h.state.entities[a1]!.counters = 2;
  h.state.entities[a2]!.counters = 2;
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Discharge') });

  const e = new E(h.state);
  assert.equal(e.counterPool(A, ent(h, a1)!.region, 'allies'), 4, 'four counters are payable in all');
  assert.equal(dec(h).counterMax, 2, 'but no ONE pick can take more than two');
  assert.equal(counterPickIndex(dec(h), a1, 9), counterPickIndex(dec(h), a1, 2),
    'and asking for more gets what the unit has');
  // left mid-payment on purpose: this test is about the ceiling the menu was
  // built with, and closing the cost out would only re-ask it a size smaller
});

/* ── the cost path from an ACTIVATED ABILITY (Soul Reaver — from me) ───── */

test('R139: an activated ability\'s counter cost gets the same prompt and max', () => {
  const h = new Harness(13906);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const sr = spawn(h, A, 'Soul Reaver');                    // 2/3
  h.state.entities[sr]!.counters = 3;
  const slime = spawn(h, D, 'Lurking Slimebeast');          // 8/3
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sr]] });
  h.do({ type: 'activateAbility', seat: A, entityId: sr, abilityIndex: 0, via: 'augment' });

  assert.match(dec(h).prompt, /click a unit/i, 'the ability path says it too');
  const e = new E(h.state);
  assert.equal(dec(h).counterMax, e.counterPool(A, ent(h, sr)!.region, 'self', sr),
    '"from me" is one unit, so the pool IS the pick max');
  assert.equal(dec(h).counterMax, 3);

  h.do({ type: 'decide', seat: A, choice: counterPickIndex(dec(h), sr, counterStepperCount(dec(h), 1, 'all').count) });
  assert.equal(ent(h, sr)!.counters, 0, 'all three, one click');
  assert.deepEqual(effStats(h, sr), [2, 3], 'back to the printed 2/3');
  pick(h, { unit: slime });
  pass(h); pass(h);
  assert.equal(ent(h, slime), undefined, 'X = 3 damage killed the 8/3');
  finishBattle(h);
});

/* ── the EFFECT path (Chombot — "move up to two counters") ─────────────── */

test('R139: an effect that removes counters carries its own ceiling', () => {
  const h = new Harness(13907);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const chom = spawn(h, D, 'Chombot');                      // 1/5
  const src = spawn(h, D, 'Unit Token');
  const dst = spawn(h, D, 'Unit Token');
  h.state.entities[src]!.counters = 3;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [chom] } });
  pick(h, { unit: src });
  pick(h, { unit: dst });
  pass(h); pass(h);                                         // resolve the trigger

  assert.equal(dec(h).counterMax, 2, '"up to two", however many the source holds');
  const v = counterStepper(dec(h), 99);
  assert.equal(v.mode, 'amount', 'this path asks HOW MANY, not WHICH UNIT');
  assert.equal(v.count, 2, 'clamped to the effect\'s own ceiling');
  assert.equal(counterStepperCount(dec(h), 1, 'all').submit, false, 'All still does not submit');

  h.do({ type: 'decide', seat: D, choice: counterAmountIndex(dec(h), 2) });
  assert.equal(ent(h, src)!.counters, 1, 'two moved off');
  assert.equal(ent(h, dst)!.counters, 2, 'and onto the other');
  finishBattle(h);
});
