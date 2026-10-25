/* CR 703.7 — THE DEPLOYMENT STACK WORKS EXACTLY AS THE BATTLE STACK DOES.
 *
 * The owner, 2026-10-25, on invi's report that "the ordering of triggers and
 * abilities is not correct" in deployment:
 *
 *   "The stack needs to function exactly identically to battle. The only
 *    difference is that players do not get priority to put anything new onto
 *    the stack unless its empty."
 *
 * Deployment plays already went on the stack (CR 507.5; test file
 * 276-deployment-stack).
 * Two deployment actions still did not: an ACTIVATION and a SPELL TOKEN cast
 * were committed with `'resolve'`, so the item resolved inside the action,
 * before anything it had triggered was put on the stack. Room ZAKG
 * (2026-10-24, turn 5): invi's Lilbot sacrificed Seer of Empty Spaces, and
 * Lilbot's Glimpse 2 resolved before Seer's death trigger — the reverse of the
 * same activation in battle, where the trigger sits on top and goes first.
 *
 * The guard is a COMPARISON, not a remembered order: the same scenario is run
 * in battle and in deployment and the two resolution orders must agree. The
 * absolute order is asserted as well, so a change that broke both phases the
 * same way still goes red.
 *
 * Seeds 65000-65099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { registerSynthetic } from '../src/cards/dsl.ts';
import type { Seat } from '../src/types.ts';
import { skipHasteStep, spawn, toDeployment, withE } from './util.ts';

/** answer every open question with its first option (an ordering in printed order) */
function answerAll(h: Harness): void {
  for (let guard = 0; h.state.decision && guard < 20; guard++) {
    const d = h.state.decision;
    h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, k) => k) : 0 });
  }
}

/** drain a battle stack by passing, answering whatever it asks on the way */
function drainBattle(h: Harness): void {
  for (let guard = 0; h.state.stack.length && guard < 20; guard++) {
    answerAll(h);
    if (!h.state.stack.length || h.state.priority === null) break;
    h.do({ type: 'passPriority', seat: h.state.priority });
  }
  answerAll(h);
}

/** the "Resolving X" lines from log index `from` on, as card names */
const resolved = (h: Harness, from: number): string[] =>
  h.log.slice(from).flatMap(l => /^\s*Resolving ([^:]+):/.exec(l)?.[1] ?? []);

/** deployment, the deploying seat's home cleared, an empty hand (so Lilbot's
 * "discard a card or sacrifice another nontoken unit" can only sacrifice),
 * and Lilbot + Seer in play. Both are spawned a deployment BEFORE the one that
 * is used, because Seer's [Switch1] is once per turn and its spawn spends it. */
function lilbotAndSeer(seed: number): { h: Harness; A: Seat; lilbot: number; seer: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  withE(h, e => { for (const u of e.unitsOf(A, e.homeRegion(A))) e.destroy(u, 'is deleted'); });
  h.state.players[A]!.hand = [];
  const lilbot = spawn(h, A, 'Lilbot');
  const seer = spawn(h, A, 'Seer of Empty Spaces');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = A;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  return { h, A, lilbot, seer };
}

function lilbotInBattle(): string[] {
  const { h, A, lilbot, seer } = lilbotAndSeer(65000);
  assert.equal(h.state.phase, 'battle');
  // both attack, so Seer stands in the battle's region and can pay the cost
  h.do({ type: 'declareAttack', seat: A, columns: [[lilbot, seer]] });
  assert.equal(h.state.priority, A, 'the attacker holds priority in the attack window');
  h.state.players[A]!.hand = [];
  const n = h.log.length;
  h.do({ type: 'activateAbility', seat: A, entityId: lilbot, abilityIndex: 0, via: 'augment' });
  answerAll(h);
  drainBattle(h);
  return resolved(h, n);
}

function lilbotInDeployment(): string[] {
  const { h, A, lilbot } = lilbotAndSeer(65001);
  // let the battle phase pass with nobody attacking
  for (let guard = 0; h.state.phase === 'battle' && guard < 6; guard++) {
    h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  }
  assert.equal(h.state.phase, 'deploy');
  assert.equal(h.state.deployPlayer, A);
  h.state.players[A]!.hand = [];
  const n = h.log.length;
  h.do({ type: 'activateAbility', seat: A, entityId: lilbot, abilityIndex: 0, via: 'augment' });
  answerAll(h);
  return resolved(h, n);
}

test('CR 703.7: Lilbot sacrificing Seer of Empty Spaces resolves in the SAME order in deployment as in battle', () => {
  const battle = lilbotInBattle();
  const deploy = lilbotInDeployment();
  assert.deepEqual(battle, ['Seer of Empty Spaces', 'Lilbot'],
    'battle: the death trigger the cost caused sits above the ability and resolves first');
  assert.deepEqual(deploy, battle, 'deployment resolves the same stack the same way');
});

// ── a spell token cast in deployment ──────────────────────────────────────

const TOKEN = 'T650 Deploy Token';
const EAR = 'T650 Spell Ear';
const base = { cost: '', mana: 0, attrs: [], virus: false, burst: false, augmentAttrs: [], image: '' };
// no spell token in the pool is castable in deployment, so the branch is reached
// with a synthetic one; its effect is a log line and nothing else
registerSynthetic({
  ...base, name: TOKEN, power: 0, toughness: 0, type: 'Test Spell Token', kind: 'spellToken',
  timing: 'deploy', text: 'Say so.',
}, {
  spellEffect: { run: g => { g.ev('info', `${TOKEN} says so.`); } },
});
registerSynthetic({
  ...base, name: EAR, power: 1, toughness: 1, type: 'Test Unit', kind: 'unit', timing: 'deploy',
  text: 'Whenever you play a spell, say so.',
}, {
  abilities: [{
    type: 'triggered', events: ['spellPlayed'], label: 'a spell was played',
    when: (_g, self, ev) => ev.data?.['seat'] === self.controller,
    effect: { run: g => { g.ev('info', `${EAR} heard it.`); } },
  }],
});

test('CR 703.7: a spell token cast in deployment goes ON the stack, so the trigger its cast caused resolves first', () => {
  const h = new Harness(65002);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, EAR);
  const tok = new E(h.state).createSpellToken(A, TOKEN, 0, new E(h.state).homeRegion(A));
  const n = h.log.length;
  const events = h.events.length;
  h.do({ type: 'castSpellToken', seat: A, entityId: tok.id });
  answerAll(h);
  assert.deepEqual(resolved(h, n), [EAR, `${TOKEN} 0`],'the cast trigger is above the token and goes first, as in battle');
  assert.ok(h.events.slice(events).some(ev => ev.type === 'stackPushed' && ev.data?.['controller'] === A),
    'the token really was pushed — it did not resolve off the stack');
  assert.equal(h.state.stack.length, 0, 'and the deployment stack drained itself');
});
