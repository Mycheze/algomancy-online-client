/**
 * CT-437 — CR 708.4a, 708.9: in ONE creation (an effect, grafts included) the
 * order the creator chose between Automaton of Abundance and Cosmic
 * Conspirator holds for the whole creation, not just for the token it was
 * asked at.
 *
 * CR 708.9: "All the tokens one resolution of one effect creates are created
 * together, including the tokens created by the parts it has from grafted
 * cards." CR 708.4a: the replacements apply "one at a time … to the event as
 * the earlier ones left it … one that has applied does not apply again".
 *
 * So with the Automaton chosen first, it has applied to the whole creation —
 * Poisons included, which it ignores (they are spell tokens). A Poison the
 * Conspirator then turns into a Robot is the Conspirator's change, made AFTER
 * the Automaton applied: the Automaton does not apply again, and it is not
 * copied. With the Conspirator chosen first, the Robot it makes is there
 * when the Automaton applies, and is copied.
 *
 * The engine creates tokens one call at a time, so the Poison is a later
 * call in the same creation; it used to re-test the Automaton after the swap
 * as if nothing had been decided, and copied the new Robot either way.
 *
 * RED before: Automaton first, the swapped Robot 1 still got a copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import type { Decision, EntityId, Seat } from '../src/types.ts';
import { give, giveResources, pick, spawn, toDeployment, tokensOf, unitsOf } from './util.ts';

const isOrder = (d: Decision | null): boolean => !!d && /which applies (first|next)\?$/.test(d.prompt);

/** an Evoker grafted with Biotoxicity, then Self-Assembly (each at position 0,
 *  so Self-Assembly's Robot X is created first, then the three Poisons) */
function evoker(seed: number, extra: string[] = []) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  const ids = ['Automaton of Abundance', ...extra, 'Cosmic Conspirator'].map(c => spawn(h, A, c));
  const ev = spawn(h, A, 'Omniwield Evoker');
  giveResources(h, A, 'metal', 30);
  giveResources(h, A, 'wood', 10);
  for (const g of ['Biotoxicity', 'Self-Assembly']) {
    h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, g), hostId: ev, position: 0 });
  }
  h.do({ type: 'activateAbility', seat: A, entityId: ev, abilityIndex: 0 });
  return { h, A, ids };
}

function first(h: Harness, id: EntityId): void {
  const dec = h.state.decision!;
  assert.ok(isOrder(dec), `an order question is open: ${dec?.prompt}`);
  const i = dec.options.findIndex(o => (o.value as { unit?: number }).unit === id);
  assert.ok(i >= 0, `unit ${id} is a choice: ${dec.options.map(o => o.label).join(' | ')}`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

/** answer every Conspirator question: the first Poison becomes a Robot, all else is kept */
function answerAll(h: Harness): string[] {
  const asked: string[] = [];
  let swapped = false;
  while (h.state.decision) {
    const p = h.state.decision.prompt;
    assert.ok(!isOrder(h.state.decision), `asked the order again: ${p}`);
    asked.push(p.replace('Cosmic Conspirator: create a token of another type instead of the ', ''));
    if (!swapped && /the Poison 1\?$/.test(p)) { swapped = true; pick(h, 'Robot'); } else pick(h, 'keep');
  }
  return asked;
}

const kinds = (h: Harness, A: Seat): string[] => [
  ...unitsOf(h, A).filter(u => u.token).map(u => `${u.card} ${u.counters}`),
  ...tokensOf(h, A).filter(t => t.kind === 'spellToken').map(t => `${t.card} ${t.x}`),
].sort();

test('CR 708.9 / CT-437: Automaton first at the Robot, a later Poison the Conspirator turns into a Robot is not copied', () => {
  const { h, A, ids: [aoa] } = evoker(113901);
  first(h, aoa!);
  const asked = answerAll(h);
  assert.equal(asked.filter(a => /Poison/.test(a)).length, 3, 'each Poison is offered to the Conspirator');
  const toks = kinds(h, A);
  const robotX = toks.filter(t => /^Robot /.test(t) && t !== 'Robot 1');
  assert.equal(robotX.length, 2, `the Robot X and its copy: ${toks.join(', ')}`);
  assert.deepEqual(toks.filter(t => t === 'Robot 1'), ['Robot 1'],
    'the Poison turned Robot 1 after the Automaton applied to the creation: no copy');
  assert.deepEqual(toks.filter(t => /^Poison/.test(t)), ['Poison 1', 'Poison 1']);
});

test('CR 708.9 / CT-437: Conspirator first, the Robot it makes of a later Poison is copied', () => {
  const { h, A, ids: [, cc] } = evoker(113902);
  first(h, cc!);
  answerAll(h);
  const toks = kinds(h, A);
  assert.deepEqual(toks.filter(t => t === 'Robot 1'), ['Robot 1', 'Robot 1'],
    `the Conspirator applied before the Automaton: its Robot is copied (${toks.join(', ')})`);
});

test('CR 708.4a / CT-437: two Automatons, one before the Conspirator and one after — only the later one copies the swapped Robot', () => {
  const { h, A, ids: [a1, a2] } = evoker(113903, ['Automaton of Abundance']);
  first(h, a1!);
  // the second question: the other Automaton, or the Conspirator, next
  const cc = h.state.decision!.options
    .map(o => (o.value as { unit?: number }).unit)
    .find(u => u !== a2);
  first(h, cc as EntityId);
  answerAll(h);
  const toks = kinds(h, A);
  assert.deepEqual(toks.filter(t => t === 'Robot 1'), ['Robot 1', 'Robot 1'],
    `the second Automaton applied after the Conspirator: one copy, from it alone (${toks.join(', ')})`);
});
