/* R286 / CT-184 — DEPLOYMENT HAS A STACK, AND IT IS ONE STACK PER PLAYER.
 *
 * The owner, 2026-09-01, ruling on a question round 36 raised and could not
 * answer:
 *
 *   "It does get the stack. But it's an isolated stack just for the person in
 *    that region. No one else cares about it or interacts with it. The two
 *    players are, essentially, playing different games during deployment.
 *    Normally, you auto let your spells resolve since battle spells can't be
 *    played in deployment anyway and triggers happen automatically. So it's
 *    very rare to matter, which is why I've never noticed before that it's not
 *    using the stack. But it does need to."
 *
 * ⚠ THE OBVIOUS REPAIR WAS TRIED FIRST AND FAILED, AND THAT MEASUREMENT IS
 * WHY THIS FILE IS SHAPED THE WAY IT IS. Routing the play through the
 * deployment stack was attempted during CT-176 and reverted: `settle()` would
 * not drain while ANY decision was open — the R154 gate, the single line
 * `if (this.s.decision) return;` — and deployment is SIMULTANEOUS, so one
 * seat's pending question froze the other seat's play. On saved game DQVZ,
 * Ben's Eldritch Dreamtender waited behind Rashi's Floral Singularity X
 * question and spawned in the wrong order; 14 engine tests went red, R154's
 * own two among them.
 *
 * The revert was right and its reasoning was incomplete. The branch did not
 * fail because deployment plays belong off the stack. It failed because it
 * used **THE** stack — one shared object behind one shared gate — where the
 * rule is one stack **per player**. R154's "a pending question stops the
 * world" is correct in battle, where both seats are in the same game, and
 * wrong in deployment, where by this ruling they are not.
 *
 *  §1  THE HOLD IS SEAT-AWARE. The half that had to land first. Seat 1 is
 *      mid-question; seat 0 plays; seat 0's play RESOLVES, and nothing of
 *      seat 1's moves. Break the seat-awareness and §1 strands the play on a
 *      stack instead of freezing the seat — a different symptom, same bug.
 *  §2  TWO STACKS, NOT ONE ARRAY. The white-box half: `settleDeploySeat`
 *      resolves the acting seat's TOPMOST item, which is not the array's top
 *      when the other seat has items interleaved above it. With the positive
 *      control — drive the same state as the other seat and the other item is
 *      the one that goes.
 *  §3  THE PLAY IS AN ITEM. R286's point 1, and what CT-176 could only paper
 *      over: the copy sits ABOVE the original and therefore resolves FIRST
 *      (RAQ, "above original spell effect").
 *  §4  THE NEGATIVE CONTROLS. Battle is unchanged — the gate there is the
 *      rule working. And the isolation is DEPLOYMENT-ONLY: widen it by
 *      accident and these go red.
 *
 * Seeds 27600-27699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { hiddenSegment, legalActions } from '../src/apply.ts';
import { registerSynthetic } from '../src/cards/dsl.ts';
import type { GameState, Seat, StackItem } from '../src/types.ts';
import { effStats, give, giveResources, pick, spawn, toDeployment } from './util.ts';

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** A deployment spell that asks nothing and gains a life — the smallest thing
 * that reaches `settle()` at all. (`doneDeploying` never calls settle, so it
 * cannot exercise the gate; R154's own file makes the same point.) */
const QUIET = 'R286 Quiet';
registerSynthetic({
  name: QUIET, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 1 life.',
}, {
  spellEffect: { run: (g, ctx) => { g.gainLife(ctx.controller, 1, QUIET); } },
});

/** Turn 1 into deployment with `n` Wraiths on `seat` — their start-of-
 * deployment pile is what leaves that seat mid-question with more queued
 * behind it. Deliberately not `toDeployment`: the Wraiths must be in play
 * BEFORE deployment opens or nothing fires. (R154's `withWraiths`, which this
 * is a copy of on purpose — the two files must be able to disagree.) */
function withWraiths(seat: Seat, n: number): Harness {
  const h = new Harness(27600);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    if (h.state.hasteDone && !h.state.hasteDone[s]) h.do({ type: 'doneHaste', seat: s });
  }
  for (let i = 0; i < n; i++) spawn(h, seat, 'Wraith');
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') {
    h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  }
  return h;
}

/** a bare stack item, enough for `settle()` to pick it up and resolve it away */
const item = (id: number, controller: Seat): StackItem => ({
  id, kind: 'triggered', label: `item ${id}`, controller, region: 0,
  negated: false, parts: [],
});

/* ═══ §1 THE HOLD IS SEAT-AWARE ══════════════════════════════════════ */

test('R286 §1: seat 1 is mid-question and seat 0\'s deployment play still RESOLVES', () => {
  const h = withWraiths(1, 3);
  assert.equal(h.state.phase, 'deploy');
  assert.equal(hiddenSegment(h.state), 'deploy', 'deployment is a hidden simultaneous segment');
  assert.equal(h.state.decision?.seat, 1, 'seat 1 is being asked about their own trigger pile');
  const asked = structuredClone(h.state.decision!);

  const idx = give(h, 0, QUIET);
  const life0 = h.state.players[0]!.life;
  assert.ok(legalActions(h.state, 0).some(a => a.type === 'playCard' && a.handIndex === idx),
    'R154 already offers it');
  h.do({ type: 'playCard', seat: 0, handIndex: idx });

  assert.equal(h.state.players[0]!.life, life0 + 1,
    'IT RESOLVED. This is the whole ticket: the play now goes on a stack, and a stack '
    + 'that only drains when nobody anywhere has a question open would have stranded it');
  assert.deepEqual(h.state.decision, asked, "and seat 1's question is untouched");
  assert.equal(h.state.stack.filter(i => i.controller === 0).length, 0,
    'nothing of seat 0\'s is left standing on it');
});

test('R286 §1: the play really went ON a stack — it did not skip one', () => {
  const h = withWraiths(1, 3);
  const idx = give(h, 0, QUIET);
  const evs = h.do({ type: 'playCard', seat: 0, handIndex: idx });
  const pushed = evs.filter(e => e.type === 'stackPushed' && e.data?.['controller'] === 0);
  assert.equal(pushed.length, 1,
    'R286 point 1: a deployment play is committed with `push`, not `resolve` — if this '
    + 'is 0 the branch has been put back and §1 above is passing for the old reason');
  assert.ok(evs.some(e => e.type === 'resolved'), 'and then resolved, in the same action');
});

test('R286 §1: seat 0 acting does not build, aim or resolve seat 1\'s held triggers', () => {
  // R154's rule, unchanged. R286 narrows the SCOPE of the hold from "everyone"
  // to "the seat being asked" and must not narrow it any further than that.
  const h = withWraiths(1, 3);
  const queued = structuredClone(h.state.triggerQueue);
  assert.ok(queued.length > 0 && queued.every(t => t.controller === 1),
    'the pile behind seat 1\'s question is entirely seat 1\'s');

  h.do({ type: 'playCard', seat: 0, handIndex: give(h, 0, QUIET) });

  assert.deepEqual(h.state.triggerQueue.filter(t => t.controller === 1), queued,
    'every one of them is still queued, in the same order');
  assert.equal(h.state.stack.filter(i => i.controller === 1).length, 0,
    'and none of them reached a stack on somebody else\'s tick');
});

/* ═══ §2 TWO STACKS, NOT ONE ARRAY ═══════════════════════════════════ */

/** Drive `settle()` as `actor` over a state with both seats' items on the
 * stack — the white-box seam, because no printed card can arrange this shape
 * from the outside today (a deployment stack drains before an action can end,
 * so the only way two seats' items coexist on it is the very isolation this
 * is measuring). */
function settleAs(state: GameState, actor: Seat, stack: StackItem[]): StackItem[] {
  const e = new E(structuredClone(state));
  e.acting = actor;
  e.s.stack = stack.map(i => ({ ...i }));
  e.settle();
  return e.s.stack;
}

test('R286 §2: the acting seat\'s TOPMOST item resolves — not the array\'s top', () => {
  const h = withWraiths(1, 3);
  assert.equal(h.state.decision?.seat, 1, 'seat 1 holds the open question');
  // seat 1's item is ABOVE seat 0's in the one array. Under a plain `pop()`
  // seat 0's tick would resolve seat 1's item, which is the shared-object bug
  // this ruling is about.
  const left = settleAs(h.state, 0, [item(9001, 0), item(9002, 1)]);
  assert.deepEqual(left.map(i => i.id), [9002],
    'seat 0 resolved SEAT 0\'S item and left seat 1\'s where it stood');
});

test('R286 §2 CONTROL: put the question on the OTHER seat and the other item is the one that goes', () => {
  const h = withWraiths(1, 3);
  // the mirror image of §2: seat 0 is the one being asked, seat 1 is the one
  // acting. Same array, same order, opposite answer — which is what makes §2
  // a measurement of the filter rather than of `pop()` agreeing by accident.
  const state = structuredClone(h.state);
  state.decision!.seat = 0;
  state.triggerQueue = [];   // seat 1's Wraith pile is not what is under test here
  const left = settleAs(state, 1, [item(9001, 0), item(9002, 1)]);
  assert.deepEqual(left.map(i => i.id), [9001],
    'seat 1 resolved seat 1\'s item — the one on TOP this time — and left seat 0\'s. '
    + 'Without this control §2 would pass on an engine that always took the bottom item');
});

test('R286 §2: with no acting seat at all, the pre-R286 hold is exactly what happens', () => {
  const h = withWraiths(1, 3);
  const e = new E(structuredClone(h.state));
  // `E.acting` is null for every call that is not an action — game creation, a
  // test poking settle() directly. Nothing may drain there.
  assert.equal(e.acting, null, 'the default really is null');
  e.s.stack = [item(9001, 0), item(9002, 1)];
  e.settle();
  assert.deepEqual(e.s.stack.map(i => i.id), [9001, 9002],
    'both items stand: an engine that cannot tell whose turn of the crank it is '
    + 'holds for any question at all, which is where R154 left it');
});

/* ═══ §3 THE PLAY IS AN ITEM — the copy sits above it ════════════════ */

test('R286 §3: the copy resolves BEFORE the original, because there is finally an original to sit above', () => {
  const h = new Harness(27610);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const repl = spawn(h, A, 'Earthbound Replicator');
  giveResources(h, A, 'wood', 2);
  const idx = give(h, A, 'Overbloom');

  h.do({ type: 'playCard', seat: A, handIndex: idx });
  pick(h, { unit: repl });          // "[Switch1] Target unit gains +7/+7"
  pick(h, false);                   // keep what the original declared

  const order = h.events.filter(e => e.type === 'resolved').map(e => String(e.msg));
  const copyAt = order.findIndex(m => m.includes('Overbloom (copy)'));
  const origAt = order.findIndex(m => m.includes('Overbloom') && !m.includes('(copy)'));
  assert.ok(copyAt >= 0 && origAt >= 0, `both resolutions are logged: ${order.join(' | ')}`);
  assert.ok(copyAt < origAt,
    'RAQ: "Copy is new spell effect on stack", "above original spell effect". Before R286 '
    + 'the deployment play resolved where it stood and the copy could only follow it — the '
    + 'divergence round 36 recorded and could not fix without a stack');
  assert.deepEqual(effStats(h, repl), [15, 17], 'and both landed: +7/+7 twice');
});

/* ═══ §4 NEGATIVE CONTROLS ══════════════════════════════════════════ */

test('R286 §4: in BATTLE the hold is exactly what it was — a question stops the world', () => {
  const h = withWraiths(1, 3);
  const state = structuredClone(h.state);
  state.phase = 'battle';
  assert.equal(hiddenSegment(state), null, 'battle is not a hidden simultaneous segment');
  const left = settleAs(state, 0, [item(9001, 0), item(9002, 1)]);
  assert.deepEqual(left.map(i => i.id), [9001, 9002],
    'nothing drained. In battle priority is sequential and the opponent mid-resolution '
    + 'genuinely does hold the game; R154 is the rule working, not a bug');
});

test('R286 §4: your OWN question still stops you, in deployment as everywhere else', () => {
  const h = withWraiths(1, 3);
  const left = settleAs(h.state, 1, [item(9001, 0), item(9002, 1)]);
  assert.deepEqual(left.map(i => i.id), [9001, 9002],
    'seat 1 is the seat being asked, so seat 1 drains nothing — R154 rule 1, untouched');
});

test('R286 §4: with NO question open the shared drain is what runs, seat filter and all', () => {
  const h = withWraiths(1, 3);
  const state = structuredClone(h.state);
  state.decision = null;
  state.suspension = null;
  state.triggerQueue = [];
  const left = settleAs(state, 0, [item(9001, 0), item(9002, 1)]);
  assert.deepEqual(left, [],
    'both drain, top down, exactly as R144(a) has always drained the deployment stack — '
    + 'the isolation is a branch for the blocked case, not a new default');
  assert.equal(other(0), 1, 'sanity: the fixture helper is the one this file defines');
});
