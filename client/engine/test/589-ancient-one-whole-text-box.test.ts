/**
 * CR 710.7 / report 271 — "ANCIENT ONE IS WAY MORE BROKEN THAN THAT" (Tomzy).
 * Six more ways the Ancient One had less than "all abilities of adjacent
 * allies", each measured on the code before the fix and each settled by a
 * source:
 *
 *  1. It listened on a HAND-KEPT list of 18 events, seven behind the pool:
 *     'combatFaceDamage' (Bloodwind Revenant, Amphivore — the designer's own
 *     example), 'trashed', 'lifeGained', 'tokenCreated' … A neighbour's
 *     trigger on any of them was never borrowed. The list is now read off
 *     the pool; the sweep below holds it there.
 *  2. Two Ancient Ones side by side: the second skipped the first outright,
 *     so it borrowed nothing through it. The designer: "they would both have
 *     all the abilities of any creature adjacent to either of them."
 *  3. Text a neighbour was GRANTED (Reforge the Dead) was never borrowed. The
 *     designer: "You could get up to 4 tokens when an Ancient One dies with
 *     Reforge the Dead in play, since it copies the ability from each
 *     adjacent unit."
 *  4. Its own death: by the time "when I die" is announced the Ancient One is
 *     out of the formation grid, so it had no neighbours and every borrowed
 *     "when I die" was silent. The allies it stood beside now ride the death
 *     event (CR 714.9).
 *  5. It borrowed ZONE text — "if I am in your bin" — from a neighbour in
 *     play, which CR 400.5 says never works there (fireEvent's own scan
 *     already refused it).
 *  6. It lent the text of an ally that had LOST its abilities (Suppression
 *     Field): the card says "all abilities of adjacent allies", and such an
 *     ally has none (CR 712.2).
 *
 * Seeds 58900-58999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { EventType, Seat } from '../src/types.ts';
import { effStats, ent, finishBattle, pass, spawn, toDeployment, toNextBattle, unitsOf, withE } from './util.ts';

test('CR 710.7 / report 271: the Ancient One listens on every event a triggered ability in the pool listens on from play', () => {
  const ao = getCard('Ancient One').augmentText!.find(a => a.type === 'triggered')!;
  const heard = new Set<EventType>(ao.type === 'triggered' ? ao.events : []);
  const missing: string[] = [];
  for (const n of allCardNames()) {
    const d = getCard(n);
    for (const ab of [...d.abilities ?? [], ...d.augmentText ?? []]) {
      if (ab.type !== 'triggered' || ab.zone) continue;
      for (const t of ab.events) if (!heard.has(t)) missing.push(`${n}: ${t}`);
    }
  }
  assert.deepEqual(missing, [], 'an adjacent ally with one of these could not lend it');
});

test('CR 710.7 / report 271: two adjacent Ancient Ones both have the abilities of a unit adjacent to either (the designer)', () => {
  const h = new Harness(58900);
  toDeployment(h);
  const A = h.state.initiative;
  const far = spawn(h, A, 'Ancient One');
  const near = spawn(h, A, 'Ancient One');
  const echo = spawn(h, A, 'Echo of Despair');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[far], [near], [echo]] });
  finishBattle(h);
  assert.equal(unitsOf(h, A).filter(u => u.token && u.card === 'Ancient One').length, 2,
    'the far Ancient One borrows the Echo through the near one: two Ancient One copies');
  assert.equal(unitsOf(h, A).filter(u => u.token && u.card === 'Echo of Despair').length, 1, 'and the Echo copies itself');
  void far;
});

test('CR 710.7 / report 271: a static reaches through two adjacent Ancient Ones, once each', () => {
  const h = new Harness(58901);
  toDeployment(h);
  const A = h.state.initiative;
  const far = spawn(h, A, 'Ancient One');
  const near = spawn(h, A, 'Ancient One');
  const elder = spawn(h, A, 'Glowhaven Elder');            // "[Augment] your OTHER units gain +1/+1"
  const bystander = spawn(h, A, 'Unit Token');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[far], [near], [elder], [bystander]] });
  assert.deepEqual(effStats(h, bystander), [4, 4], 'the Elder, the near Ancient One and the far one: +3/+3');
  finishBattle(h);
  void far; void near;
});

test('CR 109.8, 710.7 / report 271: an Ancient One dying with Reforge the Dead on it and two neighbours makes three Robots (the designer)', () => {
  const h = new Harness(58902);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const left = spawn(h, A, 'Good Whale');
  const ancient = spawn(h, A, 'Ancient One');
  const right = spawn(h, A, 'Good Whale');
  const blocker = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[left], [ancient], [right]] });
  withE(h, e => {
    for (const id of [left, ancient, right]) {
      e.grantText(e.s.entities[id]!, { card: 'Reforge the Dead', via: 'ability', index: 0, text: 'When I die, create a Robot 3.', from: 'Reforge the Dead' });
    }
  });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [blocker] } });
  finishBattle(h);
  assert.equal(ent(h, ancient), undefined, 'the Ancient One died to its blocker');
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Robot').length, 3,
    'its own granted line and each neighbour\'s: "up to 4 tokens … it copies the ability from each adjacent unit"');
});

test('CR 714.9, 710.7 / report 271: a dying Ancient One has the when-I-die text of the allies it stood beside', () => {
  const h = new Harness(58903);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const left = spawn(h, A, 'A Pile of Rubbish');           // "[Augment] When I die, draw a card."
  const ancient = spawn(h, A, 'Ancient One');
  const right = spawn(h, A, 'A Pile of Rubbish');
  const blocker = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[left], [ancient], [right]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [blocker] } });
  const before = h.state.players[A]!.hand.length;
  finishBattle(h);
  assert.equal(ent(h, ancient), undefined, 'the Ancient One died to its blocker');
  assert.equal(h.log.filter(l => l.startsWith('Ancient One (as A Pile of Rubbish)')).length, 2, 'one borrowed line per neighbour');
  assert.ok(h.state.players[A]!.hand.length >= before + 2, 'and both drew');
});

test('CR 400.5 / report 271: an Ancient One does not borrow the bin text of a neighbour in play', () => {
  const h = new Harness(58904);
  toDeployment(h);
  const A = h.state.initiative;
  const dread = spawn(h, A, 'Lurking Dread');              // "If I am in your bin, after combat, …"
  const ancient = spawn(h, A, 'Ancient One');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dread], [ancient]] });
  finishBattle(h);
  assert.ok(!h.log.some(l => l.startsWith('Ancient One (as Lurking Dread)')),
    'the Lurking Dread is in play, so its bin text does not exist to be borrowed');
});

test('CR 712.2, 710.7 / report 271: an ally that has lost its abilities lends none — static and triggered', () => {
  const h = new Harness(58905);
  toDeployment(h);
  const A = h.state.initiative;
  const elder = spawn(h, A, 'Glowhaven Elder');            // "[Augment] your OTHER units gain +1/+1"
  const ancient = spawn(h, A, 'Ancient One');
  const echo = spawn(h, A, 'Echo of Despair');
  const bystander = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[elder], [ancient], [echo], [bystander]] });
  assert.deepEqual(effStats(h, bystander), [3, 3], 'the rig: the Elder and the Ancient One copy of it');
  withE(h, e => {
    e.suppress(e.s.entities[elder]!, 'Suppression Field', { attrs: true, abilities: true });
    e.suppress(e.s.entities[echo]!, 'Suppression Field', { attrs: true, abilities: true });
  });
  assert.deepEqual(effStats(h, bystander), [1, 1], 'the Elder has no abilities, so the Ancient One borrows none');
  finishBattle(h);
  assert.equal(unitsOf(h, A).filter(u => u.token && u.card === 'Ancient One').length, 0,
    'nor the stripped Echo copy-of-me line');
  void ancient;
});
