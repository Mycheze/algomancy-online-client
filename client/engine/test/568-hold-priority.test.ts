/* CR 703.2a / CT-253 — KEEPING PRIORITY AFTER YOU ACT.
 *
 * The Manual (p.30), CR 703.2a: "A player who uses priority to take an action
 * may keep priority and take further actions." The owner, 2026-10-22: follow
 * the Manual — and keep today's flow as the default ("auto-pass, hold to
 * keep"): the client passes for you after you act unless you hold Ctrl or turn
 * the hold toggle on.
 *
 * So the ask is a property OF THE ACTION (`holdPriority: true`, types.ts
 * HoldPriorityAsk). Without it nothing changes, which is what keeps every
 * saved game replaying as it was; with it the actor's own push leaves priority
 * with the actor.
 *
 * Seeds 56800-56899 (the fuzz walk's from 56850 up).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { apply, createGame, legalActions, HOLD_PRIORITY_ACTIONS, withHoldPriority, IllegalAction } from '../src/apply.ts';
import { rngNext } from '../src/rng.ts';
import { checkInvariants } from './fuzz.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Action, GameState, Seat } from '../src/types.ts';

/** the 272 §4 fixture: the defender holds the attack window, with four wood */
function window(seed: number): { h: Harness; A: Seat; D: Seat; wall: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Oorblak');
  const wall = spawn(h, D, 'Prickly Protector');
  giveResources(h, D, 'wood', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  assert.equal(h.state.priority, D, 'fixture: the defender holds the window');
  return { h, A, D, wall };
}

test('CR 703.2a / CT-253: without the ask a cast still hands priority to the opponent', () => {
  // the negative control, and the replay promise: an action logged without the
  // field does exactly what it always did
  const { h, A, D, wall } = window(56800);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Phytochemical Protection') });
  pick(h, { unit: wall });
  assert.equal(h.state.stack.length, 1);
  assert.equal(h.state.priority, A, 'no ask: the opponent responds first, as before');
  assert.equal(h.state.holdPriority, undefined, 'and nothing is left in the state');
});

test('CR 703.2a / CT-253: a cast that asks keeps priority with the caster, across its target pick', () => {
  const { h, A, D, wall } = window(56801);
  // the ask rides on the PLAY; the target is picked by a plain decide, and the
  // hold has to survive that suspension
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Phytochemical Protection'), holdPriority: true });
  assert.equal(h.state.holdPriority, D, 'the ask is carried while the cast waits on its target');
  pick(h, { unit: wall });
  assert.equal(h.state.stack.length, 1, 'the spell is on the stack');
  assert.equal(h.state.priority, D, 'and the caster still has priority');
  assert.equal(h.state.holdPriority, undefined, 'the ask ended with the action');
  assert.equal(h.state.passes, 0);
  assert.ok(legalActions(h.state, D).some(a => a.type === 'passPriority'), 'the holder may pass');
  assert.deepEqual(legalActions(h.state, A), [], 'the opponent may not act yet');
  void A;
});

test('CR 703.2a / CT-253: the holder stacks a second action before the opponent gets a look, then CR 703.2b', () => {
  const { h, A, D, wall } = window(56802);
  const first = give(h, D, 'Phytochemical Protection');
  h.do({ type: 'playCard', seat: D, handIndex: first, holdPriority: true });
  pick(h, { unit: wall });
  const second = give(h, D, 'Phytochemical Protection');
  h.do({ type: 'playCard', seat: D, handIndex: second });   // no ask this time
  pick(h, { unit: wall });
  assert.equal(h.state.stack.length, 2, 'both spells are on the stack with no look in between');
  assert.equal(h.state.priority, A, 'the second cast did not ask, so the opponent responds now');
  // CR 703.2b / 703.3c: two passes in succession resolve the top item only
  h.do({ type: 'passPriority', seat: A });
  assert.equal(h.state.priority, D);
  h.do({ type: 'passPriority', seat: D });
  assert.equal(h.state.stack.length, 1, 'two passes resolved the top item, not both');
});

test('CR 703.2a / CT-253: a spell token Burst that asks puts every token on and keeps priority', () => {
  const h = new Harness(56807);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  const e = new E(h.state);
  const t1 = e.createSpellToken(D, 'Fireball', 1, region);
  e.createSpellToken(D, 'Fireball', 1, region);
  h.state = e.s;
  pass(h);
  h.do({ type: 'castSpellToken', seat: D, entityId: t1.id, holdPriority: true });
  while (h.state.decision) pick(h, { player: A });
  assert.equal(h.state.stack.filter(i => i.card === 'Fireball').length, 2, 'both tokens went on');
  assert.equal(h.state.priority, D, 'and the caster kept priority through the whole burst');
});

test('CR 703.2a / CT-253: a holder who passes hands the window over, and the item waits for both passes', () => {
  const { h, A, D, wall } = window(56803);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Phytochemical Protection'), holdPriority: true });
  pick(h, { unit: wall });
  h.do({ type: 'passPriority', seat: D });
  assert.equal(h.state.priority, A, 'passing after acting gives the opponent priority (CR 703.2b)');
  assert.equal(h.state.stack.length, 1, 'one pass resolves nothing');
  h.do({ type: 'passPriority', seat: A });
  assert.equal(h.state.stack.length, 0, 'both passed in succession: it resolves');
});

test('CR 703.2a / CT-253: the ask may come on the decide that completes the cast', () => {
  // Ctrl pressed only for the target click: the decide that lands the push asks
  const { h, D, wall } = window(56804);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Phytochemical Protection') });
  const dec = h.state.decision!;
  const i = dec.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ unit: wall }));
  h.do({ type: 'decide', seat: dec.seat, choice: i, holdPriority: true });
  assert.equal(h.state.priority, D, 'the decide that pushed it asked, so the caster keeps priority');
});

test('CR 703.2a / CT-253: the ask is refused on an action that cannot push anything', () => {
  const { h, D } = window(56805);
  for (const a of [
    { type: 'passPriority', seat: D, holdPriority: true },
    { type: 'concede', seat: D, holdPriority: true },
  ] as Action[]) {
    assert.throws(() => apply(h.state, a), IllegalAction, `${a.type} cannot keep priority`);
  }
  assert.throws(() => apply(h.state, { type: 'playCard', seat: D, handIndex: 0, holdPriority: 1 as unknown as true }),
    IllegalAction, 'only `true` is an ask');
});

test('CR 507.5 / CT-253: in deployment the ask changes nothing at all', () => {
  // nobody holds priority on a deployment stack (CR 507.5, 703.7), so a play
  // that asks must leave exactly the state a play that does not ask leaves
  const h = new Harness(56806);
  toDeployment(h);
  const A = h.state.initiative;
  giveResources(h, A, 'wood', 6);
  const idx = give(h, A, 'Prickly Protector');
  const plain = apply(h.state, { type: 'playCard', seat: A, handIndex: idx });
  const asked = apply(h.state, { type: 'playCard', seat: A, handIndex: idx, holdPriority: true });
  assert.equal(JSON.stringify(asked.state), JSON.stringify(plain.state), 'identical state either way');
});

test('CR 703.2a / CT-253: withHoldPriority adds the ask only where it can mean something', () => {
  assert.deepEqual(withHoldPriority({ type: 'passPriority', seat: 0 }), { type: 'passPriority', seat: 0 });
  assert.deepEqual(withHoldPriority({ type: 'playCard', seat: 1, handIndex: 2 }),
    { type: 'playCard', seat: 1, handIndex: 2, holdPriority: true });
});

/* ── the list is MEASURED, not trusted ─────────────────────────────────────
 *
 * A dedicated fuzz walk (its own seeds and RNG, so the shared fuzzer's seeded
 * walks are untouched). Every legal action is applied as listed; every one
 * whose type may carry the ask carries it on a coin flip. After each:
 *   · a refused ask would be "legalActions lied" — the field must never turn a
 *     legal action illegal;
 *   · an action that put its actor's own non-trigger item on a battle stack
 *     must be of a type in HOLD_PRIORITY_ACTIONS (the derivation: a type that
 *     pushes and is missing from the set is a play nobody can hold after);
 *   · with the ask, priority stays with the actor; without it, it goes to the
 *     other seat, exactly as before.
 */
test('CR 703.2a / CT-253: every action that pushes its own item in battle can carry the ask, and honours it', () => {
  const pushedBy = new Map<string, number>();
  let held = 0, unheld = 0;
  // seeds picked (by a scratch survey of 56850-56899) for reaching playCard,
  // playCached, playFromBin, activateAbility, augment and decide pushes cheaply
  for (const seed of [56854, 56861, 56874, 56877, 56891]) {
    let rng = (seed * 2654435761) >>> 0;
    const rand = (): number => { const [v, next] = rngNext(rng); rng = next; return v; };
    let { state } = createGame(seed);
    for (let i = 0; i < 1500 && state.phase !== 'gameover'; i++) {
      checkInvariants(state);
      const legal: Action[] = [];
      for (const seat of [0, 1] as Seat[]) legal.push(...legalActions(state, seat));
      if (!legal.length) break;
      let a = legal[Math.floor(rand() * legal.length)]!;
      const ask = HOLD_PRIORITY_ACTIONS.has(a.type) && rand() < 0.5;
      if (ask) a = withHoldPriority(a);
      const before: GameState = state;
      let after: GameState;
      try { after = apply(state, a).state; } catch (err) {
        if (err instanceof IllegalAction && err.disturbs) continue;   // CR D2.1d, as fuzz.ts
        throw new Error(`legalActions lied with the ask ${ask}: ${JSON.stringify(a)}: ${(err as Error).message} (seed ${seed}, action ${i})`);
      }
      state = after;
      if (before.phase !== 'battle' || after.phase !== 'battle' || after.decision) continue;
      const old = new Set(before.stack.map(it => it.id));
      const mine = after.stack.filter(it => !old.has(it.id) && it.kind !== 'triggered' && it.controller === a.seat);
      // a resolution reopens the window with the initiative player (CR 703.3a):
      // only a push with nothing resolved in between is a push "after acting"
      if (!mine.length || after.stack.length < before.stack.length || after.priority === null) continue;
      if (before.stack.some(it => !after.stack.some(x => x.id === it.id))) continue;
      pushedBy.set(a.type, (pushedBy.get(a.type) ?? 0) + 1);
      // the ask may have come on the play this decide completes (carried in state)
      const asked = ask || before.holdPriority === a.seat;
      assert.ok(HOLD_PRIORITY_ACTIONS.has(a.type),
        `${a.type} pushed its actor's own item but cannot carry the ask — add it to HOLD_PRIORITY_ACTIONS`);
      if (asked) { held++; assert.equal(after.priority, a.seat, `the ask was honoured (seed ${seed}, action ${i}, ${a.type})`); }
      else { unheld++; assert.equal(after.priority, 1 - a.seat, `no ask: as before (seed ${seed}, action ${i}, ${a.type})`); }
      assert.equal(after.holdPriority, undefined, 'the ask never outlives its action');
    }
  }
  assert.ok(held > 0 && unheld > 0, `both branches are exercised (held ${held}, unheld ${unheld}; by type ${JSON.stringify([...pushedBy])})`);
});
