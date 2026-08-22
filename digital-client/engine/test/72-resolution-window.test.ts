/* R85 — what the table can SEE while a resolution is waiting on somebody.
 *
 * Playtest UFAB, 2026-08-22: *"During the resolution of Insidious Invitation,
 * I should have seen what my opponent played during the resolution and what
 * they paid. That's the whole point of 'Starting with you'. I couldn't see
 * anything until I declined to put something into play."*
 *
 * It was never a delivery bug. `ctx.choose` is not a coroutine — it throws,
 * and the part is replayed from the top with the recorded answers — and the
 * rollback to the part boundary used to happen the instant it threw. So at the
 * moment the second player was asked their half of "starting with you", the
 * first player's unit was not in play, the draw had not happened and the event
 * log was empty: the server had nothing to send because the information did
 * not exist.
 *
 * The rollback now happens on RESUME instead. These tests hold BOTH halves
 * down: the partly-resolved world must be visible while the question is open,
 * and the replay must not narrate any of it twice.
 *
 * Seeds 7200-7299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { apply, replay } from '../src/apply.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import type { GameState, Seat } from '../src/types.ts';
import { finishBattle, spawn, toDeployment, toNextBattle, unitsOf } from './util.ts';

const openMana = (s: GameState, seat: Seat): number =>
  s.players[seat]!.resources.filter(r => r.state === 'open').length;

const lines = (h: Harness, needle: string): number =>
  h.log.filter(l => l.includes(needle)).length;

// ── the report ─────────────────────────────────────────────────────────

test('R85 Insidious Invitation: at the OPPONENT’s prompt, the caster’s play is already on the table', () => {
  const h = new Harness(7201, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  giveWater(h, A, 5);                                       // spell b/1 + Echo of Despair b/4
  giveWater(h, D, 2);                                       // Hooba-Pon bb/2
  toNextBattle(h, A);
  h.state.players[A]!.hand = ['Insidious Invitation', 'Echo of Despair'];
  h.state.players[D]!.hand = ['Hooba-Pon'];
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: 0 });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  const toTheCaster = h.do({ type: 'passPriority', seat: h.state.priority! });

  // ── the FIRST question. "Draw a card" is printed before the invitations,
  // so it must already have happened where the caster can see it.
  assert.equal(h.state.decision!.seat, A, 'caster is invited first');
  assert.equal(h.state.players[A]!.hand.length, 2,
    'the draw has HAPPENED — Echo plus the card just drawn (the spell has left the hand)');
  assert.ok(toTheCaster.some(e => e.type === 'draw'),
    'and it was narrated in the same breath as the question');

  const paidBefore = openMana(h.state, A);
  const events = answer(h, 'Echo of Despair');

  // ── the SECOND question: everything the caster just did is public.
  assert.equal(h.state.decision!.seat, D, 'the opponent is asked next');
  assert.ok(unitsOf(h, A).some(u => u.card === 'Echo of Despair'),
    'THE REPORT: the caster’s unit is in play while the opponent is being asked');
  assert.equal(openMana(h.state, A), paidBefore - 4,
    '…and what they PAID for it is visible too (Echo of Despair is b/4)');
  assert.equal(h.state.players[A]!.hand.length, 1, 'the card left their hand');
  assert.ok(events.some(e => e.type === 'spawned' && e.data?.['card'] === 'Echo of Despair'),
    'the spawn was published with the opponent’s prompt, not held until the end');

  // ── and the resolution still finishes exactly as it always did.
  answer(h, 'Hooba-Pon');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Hooba-Pon'), 'D played theirs too');
  assert.equal(openMana(h.state, A), 0, 'A paid 1 + 4');
  assert.equal(openMana(h.state, D), 0, 'D paid 2');
  finishBattle(h);
});

test('R85 Insidious Invitation: the replay narrates nothing twice', () => {
  const h = new Harness(7202, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  giveWater(h, A, 5);
  giveWater(h, D, 2);
  toNextBattle(h, A);
  h.state.players[A]!.hand = ['Insidious Invitation', 'Echo of Despair'];
  h.state.players[D]!.hand = ['Hooba-Pon'];
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  const from = h.log.length;
  h.do({ type: 'playCard', seat: A, handIndex: 0 });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  answer(h, 'Echo of Despair');
  answer(h, 'Hooba-Pon');

  // The part ran three times over (once per suspension plus the finish) and
  // re-emitted its whole prefix each time. Exactly one of each line survives.
  assert.equal(lines(h, 'spawns Echo of Despair'), 1, 'the caster’s unit spawned once in the log');
  assert.equal(lines(h, 'spawns Hooba-Pon'), 1, 'the opponent’s did too');
  assert.equal(h.logTypes.slice(from).filter(t => t === 'draw').length, 1,
    'and the spell\u2019s own draw is narrated once');
  finishBattle(h);
});

// ── the CLASS, not the card ────────────────────────────────────────────
//
// A synthetic three-step resolution: narrate, ask, narrate, ask, narrate. Any
// multi-step effect (a glimpse chain, an electric path, a per-seat loop) has
// this shape, and the guarantee is the same for all of them.

const stepper: Printed = {
  name: 'Test Stepper', cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 1 life, ask, gain 2 life, ask, gain 4 life.',
};
registerSynthetic(stepper, {
  spellEffect: {
    run: (g, ctx) => {
      g.gainLife(ctx.controller, 1, 'Test Stepper step 1');
      ctx.choose('step1', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: 'Test Stepper: first question', options: [{ label: 'go on', value: 0 }],
      });
      g.gainLife(ctx.controller, 2, 'Test Stepper step 2');
      ctx.choose('step2', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: 'Test Stepper: second question', options: [{ label: 'go on', value: 0 }],
      });
      g.gainLife(ctx.controller, 4, 'Test Stepper step 3');
    },
  },
});

test('R85 a multi-step resolution shows each step as it is reached, and each step once', () => {
  const h = new Harness(7203, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const life0 = h.state.players[A]!.life;
  h.state.players[A]!.hand.push('Test Stepper');
  const first = h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.length - 1 });

  assert.equal(h.state.players[A]!.life, life0 + 1, 'step 1 has happened by the first question');
  assert.equal(first.filter(e => e.type === 'lifeGained').length, 1, 'and it was narrated once');

  const second = h.do({ type: 'decide', seat: A, choice: 0 });
  assert.equal(h.state.players[A]!.life, life0 + 3, 'step 2 has happened by the second question');
  assert.equal(second.filter(e => e.type === 'lifeGained').length, 1,
    'the replay re-ran step 1 but did not narrate it again');

  const third = h.do({ type: 'decide', seat: A, choice: 0 });
  assert.equal(h.state.players[A]!.life, life0 + 7, 'and the whole effect resolved exactly once');
  assert.equal(third.filter(e => e.type === 'lifeGained').length, 1, 'step 3, once');
  assert.equal(h.log.filter(l => l.includes('Test Stepper step')).length, 3,
    'three steps, three lines, no doubles');
});

test('R85 the mid-resolution board is a PREVIEW: only decide and concede are legal on it', () => {
  const h = new Harness(7204, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  h.state.players[A]!.hand.push('Test Stepper');
  h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.length - 1 });
  assert.ok(h.state.decision, 'a decision is pending on the half-resolved board');

  // apply()'s dispatch gate: nothing can be BUILT on a preview, by either seat.
  for (const seat of [A, D] as Seat[]) {
    for (const a of h.legal(seat)) {
      assert.ok(a.type === 'decide' || a.type === 'concede',
        `${a.type} must not be offered while a resolution is suspended`);
    }
  }
  assert.throws(() => h.do({ type: 'doneDeploying', seat: D }), /decision is pending/,
    'and the reducer refuses one even if a client sends it anyway');
  h.do({ type: 'decide', seat: A, choice: 0 });
  h.do({ type: 'decide', seat: A, choice: 0 });
});

test('R85 the suspension’s rollback snapshot never reaches the state twice over', () => {
  const h = new Harness(7205, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  h.state.players[A]!.hand.push('Test Stepper');
  h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.length - 1 });
  const sus = h.state.suspension!;
  assert.equal(sus.type, 'resolve');
  const snap = sus.type === 'resolve' ? sus.snapshot : undefined;
  assert.ok(snap, 'the rollback state rides on the suspension');
  assert.equal(snap!.suspension, null, 'and carries no suspension of its own — no nesting');
  assert.equal(snap!.decision, null, 'nor a decision');
  h.do({ type: 'decide', seat: A, choice: 0 });
  h.do({ type: 'decide', seat: A, choice: 0 });
  assert.equal(h.state.suspension, null, 'and it is gone once the resolution finishes');
});

test('R85 chained questions get chained decision ids (the rewind must not reuse one)', () => {
  const h = new Harness(7206, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  h.state.players[A]!.hand.push('Test Stepper');
  h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.length - 1 });
  const first = h.state.decision!.id;
  h.do({ type: 'decide', seat: A, choice: 0 });
  const second = h.state.decision!.id;
  assert.ok(second > first,
    `a NEW question must carry a new id (ui/sfx.ts reads it as one) — got ${first} then ${second}`);
  h.do({ type: 'decide', seat: A, choice: 0 });
});

// ── the replay path (saved games) ──────────────────────────────────────

test('R85 seed + actions still reproduces a game that suspended mid-resolution', () => {
  const h = new Harness(7207, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  h.state.players[A]!.hand.push('Test Stepper');
  // the hand was doctored, so replay from the state we actually started the
  // action log against rather than from createGame
  const start = structuredClone(h.state);
  const acts = [
    { type: 'playCard' as const, seat: A, handIndex: h.state.players[A]!.hand.length - 1 },
    { type: 'decide' as const, seat: A, choice: 0 },
    { type: 'decide' as const, seat: A, choice: 0 },
  ];
  for (const a of acts) h.do(a);

  let s = start;
  for (const a of acts) s = apply(s, a).state;
  assert.deepEqual(s.players.map(p => p.life), h.state.players.map(p => p.life),
    'replaying the same actions from the same state lands on the same board');
  assert.equal(s.suspension, null, 'and finishes, rather than stranding mid-resolution');
});

test('R85 a whole game replays byte-for-byte through a mid-resolution suspension', () => {
  const h = new Harness(7208, ['Ben', 'Rashi']);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  const r = replay(7208, h.actions, ['Ben', 'Rashi']);
  assert.deepEqual(r.state, h.state, 'the replay path is untouched by R85');
});

// ── a pre-R85 suspension (an old saved state, mid-resolution) ──────────

test('R85 a suspension with no snapshot still resumes — old saved states load', () => {
  const h = new Harness(7209, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  h.state.players[A]!.hand.push('Test Stepper');
  h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.length - 1 });
  const life = h.state.players[A]!.life;
  // exactly what a state serialized before R85 looks like: the world already
  // rolled back to the part boundary, and no snapshot on the suspension
  const sus = h.state.suspension!;
  assert.equal(sus.type, 'resolve');
  if (sus.type === 'resolve') {
    h.state = sus.snapshot!;
    h.state.suspension = { ...sus, snapshot: undefined };
    h.state.decision = { id: 1, seat: A, kind: 'payOrDecline', prompt: 'x', options: [{ label: 'go on', value: 0 }] };
    h.state.resolving = sus.item;
  }
  assert.equal(h.state.players[A]!.life, life - 1, 'the old shape had step 1 rolled back');
  h.do({ type: 'decide', seat: A, choice: 0 });
  h.do({ type: 'decide', seat: A, choice: 0 });
  assert.equal(h.state.players[A]!.life, life + 6, 'and it resolves in full from there');
});

// ── local helpers ──────────────────────────────────────────────────────

function giveWater(h: Harness, seat: Seat, n: number): void {
  for (let i = 0; i < n; i++) h.state.players[seat]!.resources.push({ kind: 'water', state: 'open' });
}

/** answer the pending Insidious Invitation prompt by card NAME */
function answer(h: Harness, card: string): ReturnType<Harness['do']> {
  const dec = h.state.decision!;
  const idx = dec.options.findIndex(o => o.label === card);
  assert.notEqual(idx, -1, `${card} is on the menu`);
  return h.do({ type: 'decide', seat: dec.seat, choice: idx });
}
