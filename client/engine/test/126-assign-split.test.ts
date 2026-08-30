/* CT-34 / R149 — the R120 elective damage-split TICKER.
 *
 * Owner report #100, room SMVJ: "The damage distribution UI is terrible and
 * confusing. Better would to have a ticker counter thing on each unit that you
 * click up/down and they always are forced to sum to the amount of damage you
 * have."
 *
 * The mechanic is R120 and is untouched — the split stays elective, because
 * "never decide for the player". What changed is the affordance: a per-victim
 * ticker with the column and the running remainder around it, replacing the
 * flat wall of "1 to X / 2 to X / 3 to X / 4 to X" buttons.
 *
 * ⚠ WHAT THE BRIEF FOR THIS TICKET GOT WRONG, and the reason these tests are
 * shaped the way they are. The report (and the ticket) assume ONE decision
 * carrying all N victims, which the client would answer with N tickers summing
 * to a fixed total. The engine does not raise that decision and never has:
 * `E.electionWalk` asks ONE VICTIM AT A TIME, front-to-back, and each question
 * is a single scalar — "how much of `remaining` to <this unit>?" — whose menu
 * is exactly [share .. remaining]. The sum is therefore forced BY CONSTRUCTION
 * upstream of any client: an over- or under-allocation is not refused, it is
 * not representable. So these tests check the two things a client can actually
 * get wrong — that the dial never leaves the menu the engine sent, and that a
 * raw allocation from outside the menu is reported rather than silently
 * reinterpreted — plus test (4), which pins the client's value shape to the
 * engine's real emitted options. Test (4) is the one that would have caught
 * BL-25.
 *
 * Test (5) is the negative control: BL-25/R139's counter stepper now runs on
 * the shared `quantityStepper` core this change factored out, and must be
 * byte-for-byte the control it was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Seat } from '../src/types.ts';
import { pass, spawn, toDeployment, toNextBattle } from './util.ts';
import {
  assignSplitIndex, assignSplitRows, assignSplitStep, assignSplitStepper, assignSplitSubmit,
  assignSplitVictims, ASSIGN_SPLIT_HINT,
  clampQuantity, counterStepper, counterStepperCount, quantityStepper, stepQuantity,
} from '../ui/inspect.ts';
import type { AssignDecisionLike, AssignStateLike } from '../ui/inspect.ts';

/** a hand-built elective-split menu: the one-click default, then every legal
 * amount [lo..hi] — the exact shape `electionWalk` builds */
function menu(card: string, lo: number, hi: number): AssignDecisionLike {
  const options: { label: string; value: unknown }[] = [
    { label: 'default — share front-to-back', value: 'default' },
  ];
  for (let a = lo; a <= hi; a++) {
    const tag = a === lo ? ' (lethal)' : a === hi ? ' (everything)' : '';
    options.push({ label: `${a} to ${card}${tag}`, value: a });
  }
  return {
    kind: 'assignDamage',
    prompt: `Ox: assign combat damage — how much of ${hi} to ${card}? `
      + '(units in front must be assigned lethal before any goes behind them)',
    options,
  };
}

/** the option index whose value IS `n` — what the client's index must agree with */
function whereValue(dec: AssignDecisionLike, n: unknown): number {
  return dec.options.findIndex(o => o.value === n);
}

/** the PIN1 board of 100-elective-assign: a 4/3 attacker blocked by 1/1 + 1/1,
 * paused on the attacker's real elective-split question */
function overkillBoard(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const big = spawn(h, A, 'Rune Channeler');       // 4/3, no attributes
  const g = new E(h.state);
  const b1 = g.spawnUnit(D, 'Unit Token', g.homeRegion(D), { token: true, tokenStats: [1, 1] }).id;
  const b2 = g.spawnUnit(D, 'Unit Token', g.homeRegion(D), { token: true, tokenStats: [1, 1] }).id;
  g.settle();
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[big]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  const mark = h.events.length;
  pass(h); pass(h);   // into combat damage — the election suspends the sub-step
  return { h, A, D, big, b1, b2, mark };
}

// ───────────────────────────────────────────────────────────────────────────

test('R149 (1): the total is forced — under and over allocations are refused, with the remainder said out loud', () => {
  const dec = menu('Ox', 2, 4);   // 4 damage left; the front unit is owed 2

  // UNDER: less than the unit in front is owed. R120's one rule — a unit in
  // front must be assigned lethal before any damage goes behind it — so 1 is
  // not a split the engine will take, and the client must not send it.
  const under = assignSplitSubmit(dec, 1);
  assert.equal(under.ok, false, 'an under-allocation is refused');
  assert.equal(under.index, -1, 'and produces NO option index, so nothing can be sent');
  assert.equal(under.remaining, 3, 'the remainder is reported: 3 of the 4 still unassigned');
  assert.match(under.why, /at least 2/, 'and the refusal names the floor');
  assert.match(under.why, /1 short/, 'and how far short the allocation is');

  // OVER: more damage than the strike has to give.
  const over = assignSplitSubmit(dec, 6);
  assert.equal(over.ok, false, 'an over-allocation is refused');
  assert.equal(over.index, -1, 'and likewise produces no option index');
  assert.equal(over.remaining, -2, 'the remainder goes NEGATIVE — the overspend, reported');
  assert.match(over.why, /only 4 left/, 'and the refusal names what is actually available');

  // and exactly on the total is fine, remainder zero
  const all = assignSplitSubmit(dec, 4);
  assert.equal(all.ok, true, 'spending everything on this unit is legal (R120: overkill the front)');
  assert.equal(all.remaining, 0, 'nothing left behind it');
  assert.equal(all.index, whereValue(dec, 4));

  // and in between, the remainder is what the units behind are competing for
  const mid = assignSplitSubmit(dec, 3);
  assert.equal(mid.ok, true);
  assert.equal(mid.remaining, 1, '3 here leaves 1 for behind');
  assert.equal(mid.index, whereValue(dec, 3));

  // the view carries the same arithmetic for the bar to draw
  const v = assignSplitStepper(dec, null, 3);
  assert.equal(v.mode, 'assign');
  assert.deepEqual([v.total, v.assigned, v.remaining], [4, 3, 1],
    'total / assigned / remaining are the running sum the bar shows');
});

test('R149 (2): the ticker clamps to what THIS victim can take — the BL-25 carry-over trap', () => {
  const dec = menu('Ox', 2, 4);
  assert.equal(assignSplitStepper(dec, null, 9).count, 4, 'above the ceiling lands on the ceiling');
  assert.equal(assignSplitStepper(dec, null, 4).count, 4, 'the ceiling itself is reachable');
  assert.equal(assignSplitStepper(dec, null, 3).count, 3, 'in range, untouched');
  assert.equal(assignSplitStepper(dec, null, 1).count, 2, 'below the floor lands on the floor');
  assert.equal(assignSplitStepper(dec, null, 0).count, 2);
  assert.equal(assignSplitStepper(dec, null, NaN).count, 2, 'a non-number falls to the floor');
  assert.deepEqual(
    [assignSplitStepper(dec, null, 2).canDown, assignSplitStepper(dec, null, 2).canUp],
    [false, true], 'at the floor, − is dead');
  assert.deepEqual(
    [assignSplitStepper(dec, null, 4).canDown, assignSplitStepper(dec, null, 4).canUp],
    [true, false], 'at the ceiling, + is dead');

  // THE TRAP, and the reason the clamp is on render and not on submit: the
  // dial is one stored number that outlives a single question. A 4 dialled for
  // a strike with 4 to give must not still read 4 over a menu that caps at 2 —
  // the player would read 4, click confirm, and be given 2.
  const narrow = menu('Sparrow', 1, 2);
  assert.equal(assignSplitStepper(narrow, null, 4).count, 2,
    'a stale 4 is shown as 2 the instant the narrower question paints');
  assert.equal(assignSplitIndex(narrow, 4), whereValue(narrow, 2),
    'and clamps DOWNWARDS to the largest legal amount, exactly like counterPickIndex');
  assert.equal(assignSplitIndex(narrow, 0), -1,
    'but never rounds UP past the lethal floor — that would be deciding for the player');

  // the range is the ENGINE'S: nothing here recomputes a victim's share from
  // board state (printed-vs-effective defense, {Vulnerable} doubling, the
  // {Deadly} floor of 1 — four rulings a client must not re-decide)
  const deadly = menu('Wight', 1, 7);   // a {Deadly} floor of 1 against a 5-defense unit
  assert.deepEqual([deadly.options.length, assignSplitStepper(deadly, null, 99).min,
    assignSplitStepper(deadly, null, 99).max], [8, 1, 7],
  'min and max are read off the option VALUES the engine emitted, nothing else');

  // a decision that is not an elective split gets no ticker at all — a bare
  // number option is otherwise just a payload (an X amount, a hand index,
  // R75's formation slot), which is the namespace collision BL-25 died on
  assert.equal(assignSplitStepper(null, null, 1).mode, 'none');
  assert.equal(assignSplitStepper({ ...dec, kind: 'targets' }, null, 3).mode, 'none',
    'the ENGINE\'s decision kind is the gate, never a guess at the value shape');
  assert.equal(assignSplitStepper({ kind: 'assignDamage', prompt: 'x', options: [
    { label: 'no', value: 'default' }] }, null, 1).mode, 'none', 'and a menu with no amounts is not a ticker');
});

test('R149 (3): "All" jumps to everything-left and does NOT submit', () => {
  const dec = menu('Ox', 2, 4);
  const all = assignSplitStep(dec, null, 2, 'all');
  assert.equal(all.count, 4, 'All sets the dial to everything the strike has left');
  assert.equal(all.submit, false,
    'and does not answer the decision — assigning combat damage is irreversible, '
    + 'so the number is read before it is spent (R139\'s ruling, in the type)');
  assert.equal(assignSplitStep(dec, null, 4, 'all').count, 4, 'All is idempotent');
  assert.equal(assignSplitStepper(dec, null, 4).canAll, false, 'and is dead once it would move nothing');
  assert.equal(assignSplitStepper(dec, null, 2).canAll, true);

  // − and + are the same promise
  assert.deepEqual(assignSplitStep(dec, null, 2, 'up'), { count: 3, submit: false });
  assert.deepEqual(assignSplitStep(dec, null, 3, 'down'), { count: 2, submit: false });
  assert.deepEqual(assignSplitStep(dec, null, 4, 'up'), { count: 4, submit: false },
    '+ cannot push past the ceiling');
  assert.deepEqual(assignSplitStep(dec, null, 2, 'down'), { count: 2, submit: false },
    'nor − below the floor');
  assert.deepEqual(assignSplitStep(null, null, 7, 'all'), { count: 7, submit: false },
    'and over a decision with no ticker, the dial is left exactly as it was');
});

test('R149 (4): the ticker\'s option values are the ones the ENGINE really emits for an elective split', () => {
  const { h, A, b1, b2, mark } = overkillBoard(12001);
  const dec = h.state.decision;
  assert.ok(dec, 'the 4/3 into 1/1+1/1 board really does raise an elective split');
  assert.equal(dec!.kind, 'assignDamage');
  assert.equal(dec!.seat, A, 'the side DEALING assigns');

  // ── THE BL-25 ASSERTION ─────────────────────────────────────────────────
  // BL-25 was a decision naming its unit `{counterFrom: id}` while the click
  // handler only matched `{unit: id}` — the affordance existed and was simply
  // unreachable, and no test caught it because every test hand-wrote the
  // payload the handler expected. So this asserts against the REAL decision.
  const v = assignSplitStepper(dec!, h.state, 1);
  assert.equal(v.mode, 'assign', 'the client recognises the engine\'s real decision as a split');
  const engineAmounts = dec!.options.flatMap(o => typeof o.value === 'number' ? [o.value] : []);
  assert.deepEqual(engineAmounts, [1, 2, 3, 4],
    'the engine offers every legal amount [share .. remaining] as a bare number');
  assert.deepEqual([v.min, v.max], [1, 4], 'and the ticker\'s range IS that list');
  assert.equal(v.total, 4, 'the strike\'s whole pool');
  for (const n of engineAmounts) {
    const i = assignSplitIndex(dec!, n);
    assert.ok(i >= 0, `the ticker at ${n} finds a real option index`);
    assert.equal(dec!.options[i]!.value, n,
      `and it is the option whose value IS ${n} — the client's payload shape matches the engine's`);
  }
  assert.equal(v.defaultIndex, dec!.options.findIndex(o => o.value === 'default'),
    'the one-click default is found by its own value, not by its prose');
  assert.equal(v.hint, ASSIGN_SPLIT_HINT,
    'and the engine\'s prompt does not already carry the ticker\'s instruction');

  // the victim column is derived from the SUSPENSION KEY and the battle, not
  // parsed out of the prompt — and it must be the units the engine is walking
  assert.deepEqual(assignSplitVictims(h.state as unknown as AssignStateLike), [b1, b2],
    'the attacker\'s victims are that column\'s blockers, front-to-back');
  assert.deepEqual(v.rows.map(r => [r.unit, r.state, r.amount]),
    [[b1, 'active', 1], [b2, 'behind', 0]],
    'the front blocker is the one being asked; the back one is still waiting');
  assert.equal(assignSplitStepper(dec!, h.state, 4).rows[0]!.amount, 4,
    'and the active row tracks the dial');

  // ── and it actually drives the game ─────────────────────────────────────
  const sub = assignSplitSubmit(dec!, assignSplitStepper(dec!, h.state, 99).count);
  assert.equal(sub.ok, true);
  assert.equal(sub.remaining, 0, 'All leaves nothing for the unit behind');
  h.do({ type: 'decide', seat: dec!.seat, choice: sub.index });
  assert.equal(h.state.decision, null, 'one question settles a two-victim column');
  const hits = h.events.slice(mark).filter(e => e.type === 'damage')
    .map(e => [e.data!['unit'] as number, e.data!['n'] as number] as [number, number]);
  assert.deepEqual(hits.filter(([u]) => u === b1).map(([, n]) => n), [4],
    'all 4 landed on the front blocker — the elected split, sent through the ticker');
  assert.deepEqual(hits.filter(([u]) => u === b2), [],
    'and the back blocker was assigned nothing, which is R120\'s whole point');
});

test('R149 (4b): a strike whose earlier victims are already answered shows them LOCKED', () => {
  // The engine cannot produce this today — a column is [front, back?], so a
  // two-victim strike asks exactly one question and `picks` is always empty at
  // ask time. The row states exist because AssignPlan.picks is a LIST, and if
  // a column ever holds three the bar must show what the front two were given
  // rather than silently dropping them. Hand-built, and labelled as such.
  const dec = menu('Ox', 1, 3);
  const s: AssignStateLike = {
    suspension: { type: 'combatAssign', key: 'normal:atk:0' },
    battle: {
      columns: [[10]], blocks: { 0: [20, 21, 22] },
      assignPlans: { 'normal:atk:0': { picks: [2] } },
    },
    entities: { 10: { card: 'Rune Channeler' }, 20: { card: 'Sparrow' }, 21: { card: 'Ox' }, 22: { card: 'Elk' } },
  };
  const v = assignSplitStepper(dec, s, 2);
  assert.deepEqual(v.rows.map(r => [r.card, r.state, r.amount]),
    [['Sparrow', 'locked', 2], ['Ox', 'active', 2], ['Elk', 'behind', 0]]);
  assert.deepEqual([v.total, v.assigned, v.remaining], [5, 4, 1],
    'the locked 2 counts toward the strike\'s total, and 1 is left for the unit behind');

  // and the rows DEGRADE rather than lie: a derived column that does not agree
  // with the menu the engine sent is not drawn at all (a second BL-25 would be
  // a bar of scans naming the wrong units)
  const wrong = { ...s, entities: { ...s.entities, 21: { card: 'Badger' } } };
  assert.deepEqual(assignSplitRows(dec, wrong, 2), [],
    'the active victim\'s card must appear in the menu\'s own labels, or no rows are drawn');
  assert.equal(assignSplitStepper(dec, wrong, 2).count, 2,
    'but the ticker itself still works — the dial never depends on the rows');
  assert.deepEqual(assignSplitRows(dec, null, 2), [], 'and no state at all is simply no rows');
  assert.equal(assignSplitVictims({ suspension: null, entities: {} }), null,
    'no combatAssign suspension, no victims');
});

test('R149 (5): NEGATIVE CONTROL — BL-25/R139\'s counter stepper is unchanged on the shared core', () => {
  // counterStepper now builds its view from quantityStepper/stepQuantity
  // instead of its own clamp and its own arrow gates. These are the BL-25
  // assertions verbatim: if the generalisation moved anything, they go red.
  const dec = {
    prompt: 'Remove +1/+1 counters from allies',
    options: [
      { label: 'take 1 from Ox', value: { counterFrom: 7 } },
      { label: 'take 2 from Ox', value: { counterFrom: 7, n: 2 } },
      { label: 'take 1 from Elk', value: { counterFrom: 8 } },
    ],
    counterMax: 6,
  };
  assert.equal(counterStepper(dec, 1).count, 1, 'one is the floor');
  assert.equal(counterStepper(dec, 0).count, 1, 'zero counters removed is not a pick');
  assert.equal(counterStepper(dec, 4).count, 4, 'in range, untouched');
  assert.equal(counterStepper(dec, 99).count, 6, 'the engine\'s counterMax is the ceiling');
  assert.equal(counterStepper(dec, NaN).count, 1, 'a non-number falls to the floor');
  assert.equal(counterStepper(dec, 1).mode, 'pick');
  assert.deepEqual([counterStepper(dec, 1).canDown, counterStepper(dec, 1).canUp], [false, true]);
  assert.deepEqual([counterStepper(dec, 6).canDown, counterStepper(dec, 6).canUp], [true, false]);
  assert.equal(counterStepper(dec, 6).canAll, false);
  assert.deepEqual(counterStepperCount(dec, 1, 'all'), { count: 6, submit: false },
    'All still jumps to the max WITHOUT submitting');
  assert.equal(counterStepperCount(dec, 6, 'up').count, 6, '+ cannot push past the ceiling');
  assert.equal(counterStepperCount(dec, 1, 'down').count, 1, 'nor − below one');
  assert.equal(counterStepper(null, 1).mode, 'none');

  // the 'amount' shape (an effect asking HOW MANY) is likewise untouched
  const amt = { prompt: 'move up to two counters', options: [
    { label: '0', value: 0 }, { label: '1', value: 1 }, { label: '2', value: 2 }], counterMax: 2 };
  assert.deepEqual([counterStepper(amt, 9).mode, counterStepper(amt, 9).min, counterStepper(amt, 9).max],
    ['amount', 0, 2]);
  assert.equal(counterStepper(amt, -3).count, 0, 'the floor here is the menu\'s own smallest amount');

  // and the shared core itself, since two controls now depend on it
  assert.equal(clampQuantity(5, 1, 3), 3);
  assert.equal(clampQuantity(-5, 1, 3), 1);
  assert.equal(clampQuantity(NaN, 2, 9), 2);
  assert.equal(clampQuantity(4, 3, 1), 3, 'an inverted range collapses to its floor');
  assert.deepEqual(quantityStepper(2, 1, 4),
    { count: 2, min: 1, max: 4, canDown: true, canUp: true, canAll: true });
  assert.deepEqual(stepQuantity(quantityStepper(2, 1, 4), 'all'), { count: 4, submit: false });
});
