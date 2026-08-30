/* R154 / CT-44 — THE SEAT-AWARE DECISION GATE, IN THE ENGINE.
 *
 * Playtest #98 (SMVJ, action 238): *"Rashi's start of combat (doing all her
 * Wraith triggers) doesn't need to take away from what I'm doing in
 * Deployment."*
 *
 * R150 (CT-32) fixed that entirely in server/rooms.ts, on the belief that the
 * engine had to stay a pure reducer with a global decision gate. Which left
 * everything that calls `apply()` directly still frozen — HOTSEAT, and the
 * `Harness` this whole test suite is written on. That is what this file is
 * about, and why it is an engine test rather than a server one: the fix has to
 * be reachable without a socket, or a hotseat game and 130-odd test files go on
 * playing by the old rule.
 *
 * THE RULE, in one sentence: *a decision belonging to another seat stops you
 * only where the engine cannot prove it is none of your business — outside a
 * hidden simultaneous segment, or where answering it will rewind the world
 * past anything you did.*
 *
 * §1  THE FIX. A real start-of-deployment Wraith pile, driven from a Harness.
 *     Both halves together: OFFERED, and ACCEPTED. Either alone is the
 *     half-fix R150's own notes warn about — a screen full of refusals.
 * §2  THE CLOBBER. `GameState.decision` is ONE SLOT and `E.suspend` writes it
 *     unconditionally, so a permissive gate on its own lets seat B's action
 *     destroy seat A's open question. Trading a freeze for lost state is the
 *     worse trade, so this asserts the question SURVIVES.
 * §3  THE REWIND. ⚠ The hazard CT-44 did not know about, and the reason the
 *     server's deferral queue is not redundant: a 'resolve' suspension carries
 *     an R85 whole-GameState snapshot, and answering it does `this.s = snap`.
 *     Anything the other seat landed in that window would be ERASED. So that
 *     one case keeps the full gate.
 * §4  THE NEGATIVE CONTROLS. Battle is sequential; your own question is still
 *     yours to answer. Widen the gate by accident and these go red.
 * §5  THE INVARIANT THAT MAKES §2 SAFE AT ALL — apply() is pure over a clone,
 *     so a draft may be discarded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import {
  apply, decisionBlocks, hiddenSegment, legalActions, IllegalAction,
} from '../src/apply.ts';
import { registerSynthetic } from '../src/cards/dsl.ts';
import type { Action, GameState, Seat } from '../src/types.ts';
import { give, spawn } from './util.ts';

/* ── fixtures ────────────────────────────────────────────────────────── */

/** Turn 1 through planning and the haste step into the battle phase, with
 * `n` Wraiths on `seat`'s side. Deliberately NOT `toDeployment`: the Wraiths
 * have to be in play BEFORE deployment opens, or their start-of-deployment
 * triggers never fire and the fixture proves nothing. */
function withWraiths(seat: Seat, n: number): Harness {
  const h = new Harness(424242);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    if (h.state.hasteDone && !h.state.hasteDone[s]) h.do({ type: 'doneHaste', seat: s });
  }
  for (let i = 0; i < n; i++) spawn(h, seat, 'Wraith');
  // skip both battle rounds into deployment, where the pile fires
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') {
    h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  }
  return h;
}

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const kinds = (as: readonly Action[]): string[] => [...new Set(as.map(a => a.type))].sort();

/** A deployment spell that RESOLVES HALFWAY and then asks — the only way to
 * raise a snapshot-carrying 'resolve' suspension inside deployment, since no
 * printed deployment card does it today. Same shape server/test-view-snapshot
 * registers for R85. */
const HALTS = 'R154 Gate Halt';
registerSynthetic({
  name: HALTS, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 1 life, then ask.',
}, {
  spellEffect: {
    run: (g, ctx) => {
      g.gainLife(ctx.controller, 1, HALTS);
      ctx.choose('halt', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: `${HALTS}: carry on?`, options: [{ label: 'yes', value: 0 }],
      });
    },
  },
});

/** A deployment spell that asks NOTHING: it resolves straight through and
 * therefore reaches `settle()`, which is what §1's trigger-pile test needs to
 * exercise. (`doneDeploying` never calls settle, so it cannot reach the
 * guard.) Free, so no resource fixture can drift out from under it. */
const QUIET = 'R154 Quiet';
registerSynthetic({
  name: QUIET, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 1 life.',
}, {
  spellEffect: { run: (g, ctx) => { g.gainLife(ctx.controller, 1, QUIET); } },
});

/** A BATTLE-timed spell that asks its question in the CAST window (R57 modes),
 * i.e. the same suspension kind §1's Wraith pile raises. §4's control needs
 * that: if the battle-phase test used a mid-resolution suspension instead it
 * would pass for the wrong reason, blocked by the rewind rule rather than by
 * the phase rule, and deleting the phase rule would leave it green. */
const BATTLE_ASKS = 'R154 Battle Ask';
registerSynthetic({
  name: BATTLE_ASKS, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'battle', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Choose a half. [Battle]',
}, {
  spellEffect: {
    modes: {
      key: 'mode',
      prompt: () => `${BATTLE_ASKS}: which half?`,
      options: () => [{ label: 'left', value: 'l' }, { label: 'right', value: 'r' }],
    },
    run: () => { /* the question is the whole point; the answer does nothing */ },
  },
});

/* ═══ §1 THE FIX — offered AND accepted ═══════════════════════════════ */

test('R154 §1: a Wraith pile suspends its own seat, not the other one', () => {
  const h = withWraiths(1, 3);
  // the fixture is the real thing, not a stub: assert it before asserting on it
  assert.equal(h.state.phase, 'deploy');
  assert.equal(hiddenSegment(h.state), 'deploy', 'deployment is a hidden simultaneous segment');
  assert.equal(h.state.decision?.seat, 1, 'seat 1 is being asked about their own trigger pile');
  assert.ok(h.state.triggerQueue.length > 0, 'and more of the pile is still queued behind it');
  assert.equal(h.state.suspension?.type, 'cast',
    'a cast-time suspension — the trigger is being AIMED, nothing has resolved yet');

  // half one: OFFERED. This is the list the client's "Waiting for X…" bar was
  // drawn from, and it used to be empty.
  const legal = legalActions(h.state, 0);
  assert.ok(legal.length > 0, 'seat 0 is offered actions while seat 1 is mid-pile');
  assert.ok(legal.some(a => a.type === 'doneDeploying'),
    'including finishing their own deployment');

  // half two: ACCEPTED. Offering an action that then gets refused is the exact
  // half-fix R150's notes warn about, so `apply()` has to be driven for real.
  h.do({ type: 'doneDeploying', seat: 0 });
  assert.equal(h.state.deployDone?.[0], true, 'seat 0 really is done deploying');
  assert.equal(h.state.decision?.seat, 1, "and seat 1 is still being asked, undisturbed");
  assert.ok(h.state.triggerQueue.length > 0, 'with their pile still queued behind it');

  // and the pile finishes normally afterwards
  while (h.state.decision) {
    const d = h.state.decision;
    h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
  }
  assert.equal(h.state.decision, null, 'the pile drains once its owner answers');
});

test('R154 §1: every kind of action seat 0 had is still theirs', () => {
  const h = withWraiths(1, 3);
  const seat: Seat = 0;
  // what seat 0 would have been offered with nothing pending at all
  const blind = legalActions({ ...h.state, decision: null, suspension: null }, seat);
  assert.deepEqual(kinds(legalActions(h.state, seat)), kinds(blind),
    "the opponent's question changes nothing about what this seat may do");
});

test('R154 §1: seat 0 acting does not drain seat 1\'s trigger pile for them', () => {
  // The other half of "undisturbed", and the one that needed an engine change
  // of its own. Almost every action ends in `settle()`, and `settle()` used to
  // reach `processTriggerQueue` unconditionally — because before R154 nothing
  // could run at all while a decision was open, so it was never entered with
  // the slot full. Let the other seat act and it would build, aim and resolve
  // the ASKING seat's triggers on the acting seat's tick, and re-enter
  // `suspend` while doing it.
  const h = withWraiths(1, 3);
  const asked = h.state.decision!;
  const queued = structuredClone(h.state.triggerQueue);
  assert.ok(queued.length > 0 && queued.every(t => t.controller === 1),
    'the pile waiting behind seat 1\'s question is entirely seat 1\'s');

  // a play, not a done: `doPlayCard` ends in settle(), `doDoneDeploying` does
  // not, so only this shape reaches the guard
  const idx = give(h, 0, QUIET);
  const life0 = h.state.players[0]!.life;
  assert.ok(legalActions(h.state, 0).some(a => a.type === 'playCard' && a.handIndex === idx),
    'seat 0 is offered it');
  h.do({ type: 'playCard', seat: 0, handIndex: idx });
  assert.equal(h.state.players[0]!.life, life0 + 1, 'and it really resolved for seat 0');

  assert.deepEqual(h.state.decision, asked, "seat 1's question is untouched");
  assert.deepEqual(h.state.triggerQueue.filter(t => t.controller === 1), queued,
    'and so is every trigger still queued behind it — nobody resolved seat 1\'s pile '
    + 'while seat 1 was in the middle of being asked about it');
  assert.equal(h.state.stack.length, 0, 'nothing of theirs reached the stack either');
});

/* ═══ §2 THE CLOBBER — one slot, and it is not up for grabs ═══════════ */

test('R154 §2: seat 0 may not overwrite seat 1\'s open decision', () => {
  const h = withWraiths(1, 3);
  const asked = h.state.decision!;
  assert.equal(asked.seat, 1);

  // seat 0 plays something that will raise a decision of its OWN. Nothing at
  // the gate can predict that — whether a play suspends depends on the card,
  // its targets and the board — so the engine has to catch it after the fact.
  give(h, 0, HALTS);
  const mine: Action = { type: 'playCard', seat: 0, handIndex: h.state.players[0]!.hand.length - 1 };
  assert.ok(legalActions(h.state, 0).some(
    a => a.type === 'playCard' && a.handIndex === mine.handIndex,
  ), 'it is on seat 0\'s menu');

  const before = structuredClone(h.state);
  let err: unknown;
  try { h.do(mine); } catch (e) { err = e; }

  assert.ok(err instanceof IllegalAction, 'it is refused, not silently applied');
  assert.equal((err as IllegalAction).disturbs, true,
    'and flagged `disturbs`, so a caller with a queue parks it instead of relaying a refusal');
  assert.deepEqual(h.state.decision, asked,
    "SEAT 1'S DECISION SURVIVES — same id, same options, same seat");
  assert.equal(h.state.suspension?.type, before.suspension?.type,
    'and so does the suspension that carries its private answer machinery');
  assert.deepEqual(h.state, before,
    'in fact NOTHING moved: the whole draft was discarded, life, hand and all');

  // the decision is still answerable, which is the property that actually
  // matters — a clobbered one would leave seat 1 stuck forever
  h.do({ type: 'decide', seat: 1, choice: 0 });
  assert.notDeepEqual(h.state.decision, asked, 'seat 1 answers it as if nothing had happened');
});

/* ═══ §3 THE REWIND — R85's snapshot, and why the queue survives ══════ */

test('R154 §3: a mid-resolution suspension still blocks the other seat', () => {
  const h = withWraiths(1, 0);
  assert.equal(h.state.phase, 'deploy');
  assert.equal(h.state.decision, null, 'no Wraiths, so deployment opens quietly');

  give(h, 1, HALTS);
  h.do({ type: 'playCard', seat: 1, handIndex: h.state.players[1]!.hand.length - 1 });
  const sus = h.state.suspension as { type: string; snapshot?: GameState };
  assert.equal(sus.type, 'resolve', 'seat 1 stopped HALFWAY through a resolution');
  assert.ok(sus.snapshot, 'carrying an R85 snapshot of the whole GameState');

  // THE REASON. `E.resumeResolve` does `this.s = snapshot`, carrying forward
  // only actionCount, decisionHigh and the seat names — so a deploy seat 0
  // landed in this window would be erased after they had watched it happen.
  assert.equal(sus.snapshot!.deployDone?.[0], false,
    'and that snapshot was taken BEFORE seat 0 could have done anything');

  assert.ok(decisionBlocks(h.state, 0), 'so the gate stays shut for seat 0');
  assert.equal(legalActions(h.state, 0).length, 0,
    'the engine offers seat 0 nothing — it will not promise what it cannot keep');
  assert.throws(() => h.do({ type: 'doneDeploying', seat: 0 }), IllegalAction,
    'and refuses the action. server/rooms.ts PARKS it here; that queue is not redundant.');

  // once answered, the world is back at the part boundary and seat 0 is free
  h.do({ type: 'decide', seat: 1, choice: 0 });
  assert.equal(h.state.decision, null);
  h.do({ type: 'doneDeploying', seat: 0 });
  assert.equal(h.state.deployDone?.[0] ?? true, true, 'seat 0 acts the moment it is safe');
});

/* ═══ §4 NEGATIVE CONTROLS ════════════════════════════════════════════ */

test('R154 §4: in BATTLE the gate refuses the non-owning seat, exactly as before', () => {
  const h = withWraiths(1, 3);
  // the SAME state, moved into the battle phase: only the phase differs, so a
  // difference in verdict can only be the segment rule
  const inBattle: GameState = { ...structuredClone(h.state), phase: 'battle' };
  assert.equal(hiddenSegment(inBattle), null, 'battle is not a hidden simultaneous segment');
  assert.equal(inBattle.decision?.seat, 1);

  assert.ok(decisionBlocks(inBattle, 0),
    'THE CONTROL: priority in battle is sequential, and an opponent mid-resolution '
    + 'genuinely does hold the game');
  assert.equal(legalActions(inBattle, 0).length, 0, 'so seat 0 is offered nothing');
  assert.throws(() => apply(inBattle, { type: 'passPriority', seat: 0 }),
    (e: unknown) => e instanceof IllegalAction && /decision is pending/.test(e.message),
    'and refused by name');
});

test('R154 §4: a REAL battle decision blocks the other seat', () => {
  // not a hand-edited phase: a genuine battle, a genuine priority window, and
  // a genuine CAST-time suspension — the same suspension kind §1 lets straight
  // through in deployment, so the only thing that can differ here is the phase
  const h = new Harness(424242);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    if (h.state.hasteDone && !h.state.hasteDone[s]) h.do({ type: 'doneHaste', seat: s });
  }
  assert.equal(h.state.phase, 'battle');
  const atk = h.state.battle!.attacker;
  h.do({ type: 'declareAttack', seat: atk, columns: [[spawn(h, atk, 'Wraith')]] });
  assert.equal(h.state.battle!.step, 'attackWindow');
  const caster = h.state.priority!;   // a real priority window is open
  const idle = other(caster);
  h.do({ type: 'playCard', seat: caster, handIndex: give(h, caster, BATTLE_ASKS) });

  assert.equal(h.state.phase, 'battle');
  assert.equal(h.state.decision?.seat, caster, 'the priority seat is mid-cast in battle');
  assert.equal(h.state.suspension?.type, 'cast', 'on a cast-time suspension, as in §1');
  assert.equal(hiddenSegment(h.state), null, 'and battle is no hidden segment');

  assert.ok(decisionBlocks(h.state, idle), 'so the other seat IS blocked');
  assert.equal(legalActions(h.state, idle).length, 0, 'offered nothing');
  assert.throws(() => h.do({ type: 'passPriority', seat: idle }),
    (e: unknown) => e instanceof IllegalAction && /decision is pending/.test(e.message),
    'and refused by the decision gate itself, not by some later check that happens to say no');
});

test('R154 §4: your own question still gates your own input', () => {
  const h = withWraiths(1, 3);
  const owner = h.state.decision!.seat;
  assert.ok(decisionBlocks(h.state, owner), 'the seat being asked is still blocked');
  assert.ok(legalActions(h.state, owner).every(a => a.type === 'decide'),
    'and offered nothing but answers');
  assert.throws(() => h.do({ type: 'doneDeploying', seat: owner }), IllegalAction,
    'R65: only `decide` and `concede` get past your own question');
});

test('R154 §4: concede is always reachable, from either seat', () => {
  for (const seat of [0, 1] as Seat[]) {
    const h = withWraiths(1, 3);
    assert.equal(h.state.decision?.seat, 1);
    h.do({ type: 'concede', seat });
    assert.equal(h.state.phase, 'gameover', `seat ${seat} may always stop (R65)`);
  }
});

/* ═══ §5 WHY §2 IS SOUND ══════════════════════════════════════════════ */

test('R154 §5: apply() never mutates its input, so a draft may be discarded', () => {
  const h = withWraiths(1, 3);
  const frozen = structuredClone(h.state);
  give(h, 0, HALTS);
  const snap = structuredClone(h.state);
  try {
    apply(h.state, { type: 'playCard', seat: 0, handIndex: h.state.players[0]!.hand.length - 1 });
  } catch { /* the refusal is §2's business */ }
  assert.deepEqual(h.state, snap,
    'the caller keeps the state it passed in — which is the ONLY reason the disturbance '
    + 'check may be made AFTER the action has run rather than predicted before it');
  assert.deepEqual(frozen.decision, h.state.decision);
});
