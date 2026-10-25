/**
 * CR 708.4a — Automaton of Abundance and Cosmic Conspirator on one creation:
 * the creator orders them.
 *
 * Nyar's report (Token Gesture, 2026-10-25T08:18:40.711Z, action 73): the
 * engine always applied the Conspirator first — a fact of where each hook sat
 * in the code (the Conspirator per token as it was created, the Automaton at
 * the end of the resolving part) — and never asked. And because the
 * Automaton's copies were made later, the Conspirator was offered them as new
 * creations, applying twice to one creation.
 *
 * Sources: Caleb Gannon, rules-questions 2026-02-23: "generally as the owner of
 * all the replacement effects, you can choose the order you'd like to apply
 * them in"; 2025-04-22: "you have to choose which order to apply replacement
 * effects"; 2025-11-25: "the tldr is replacement effects only apply once onto
 * an effect"; 2024-12-06 on the Conspirator: "Ie, it's a 1 for 1 exchange".
 * The owner, 2026-10-25 (Q2): with the Automaton first, the Conspirator may
 * exchange "each one" of the Robots.
 *
 * RED before: no order question at all (the Conspirator was asked straight
 * away), the Conspirator was offered the Automaton's copy after a keep, and
 * Nyar's Manufacture could never give more than three Fireballs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { DUMMY_DECK, challengeDeal } from '../src/challenge.ts';
import type { Action, Decision, EngineEvent, EntityId, Seat } from '../src/types.ts';
import { give, giveResources, pick, spawn, toDeployment, tokensOf, unitsOf } from './util.ts';

const FIX = new URL('./fixtures/', import.meta.url);

/** A deploys `cards`, then casts `spell` (in deployment it resolves at once) */
function cast(seed: number, cards: string[], spell: string, res: [string, number]) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  const ids = cards.map(c => spawn(h, A, c));
  giveResources(h, A, res[0] as never, res[1]);
  const at = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, spell) });
  return { h, A, ids, at };
}

const isOrder = (d: Decision | null): boolean => !!d && /which applies (first|next)\?$/.test(d.prompt);

/** answer the order question by clicking the unit `id` */
function first(h: Harness, id: EntityId): void {
  const dec = h.state.decision!;
  assert.ok(isOrder(dec), `an order question is open: ${dec.prompt}`);
  const i = dec.options.findIndex(o => (o.value as { unit?: number }).unit === id);
  assert.ok(i >= 0, `unit ${id} is a choice: ${dec.options.map(o => o.label).join(' | ')}`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

const kinds = (h: Harness, A: Seat): string[] => [
  ...unitsOf(h, A).filter(u => u.token).map(u => `${u.card} ${u.counters}`),
  ...tokensOf(h, A).filter(t => t.kind === 'spellToken').map(t => `${t.card} ${t.x}`),
].sort();

test('CR 708.4a: Automaton of Abundance and Cosmic Conspirator, the creator is asked which applies first', () => {
  const { h, A, ids: [aoa, cc] } = cast(69711, ['Automaton of Abundance', 'Cosmic Conspirator'], 'Self-Assembly', ['metal', 2]);
  const dec = h.state.decision;
  assert.ok(dec, 'a question is open');
  assert.equal(dec!.seat, A, 'the creator');
  assert.equal(dec!.prompt, 'Creating a Robot 2 — which applies first?');
  assert.deepEqual(dec!.options.map(o => o.label), ['Swap first Cosmic Conspirator', 'Copy first Automaton of Abundance']);
  assert.deepEqual(dec!.options.map(o => (o.value as { unit: number }).unit).sort(), [aoa, cc].sort(),
    'each choice names its unit on the board');
});

test('CR 708.4a: Automaton first, both Robots are offered to Cosmic Conspirator', () => {
  const { h, A, ids: [aoa], at } = cast(69712, ['Automaton of Abundance', 'Cosmic Conspirator'], 'Self-Assembly', ['metal', 2]);
  first(h, aoa!);
  assert.equal(h.state.decision?.prompt, 'Cosmic Conspirator: create a token of another type instead of the Robot 2?');
  pick(h, 'Fireball');
  assert.equal(h.state.decision?.prompt, 'Cosmic Conspirator: create a token of another type instead of the copy of the Robot 2?',
    'the copy is offered too, and named as the copy');
  pick(h, 'Poison');
  assert.equal(h.state.decision, null);
  assert.deepEqual(kinds(h, A), ['Fireball 2', 'Poison 2'], 'two tokens, both exchanged, no Robot');
  const log = h.events.slice(at).map(e => e.msg);
  assert.ok(log.some(m => /^Player \d applies Automaton of Abundance first\.$/.test(m)), 'the order is in the log');
  assert.ok(log.some(m => /Automaton of Abundance: the creation is replaced — 1 more token\(s\) \(Robot\)/.test(m)));
});

test('CR 708.4a: Conspirator first and a Fireball chosen, Automaton no longer applies', () => {
  const { h, A, ids: [, cc], at } = cast(69713, ['Automaton of Abundance', 'Cosmic Conspirator'], 'Self-Assembly', ['metal', 2]);
  first(h, cc!);
  pick(h, 'Fireball');
  assert.equal(h.state.decision, null, 'nothing more to ask');
  assert.deepEqual(kinds(h, A), ['Fireball 2'], 'a Fireball is not a unit token: no copy');
  assert.ok(!h.events.slice(at).some(e => /Automaton of Abundance: the creation is replaced/.test(e.msg)));
});

test('CR 708.4: Conspirator first and the Robot kept, the copy is not offered to Conspirator again', () => {
  const { h, A, ids: [, cc] } = cast(69714, ['Automaton of Abundance', 'Cosmic Conspirator'], 'Self-Assembly', ['metal', 2]);
  first(h, cc!);
  pick(h, 'keep');
  assert.equal(h.state.decision, null, 'the Conspirator has applied to this creation: not asked about the copy');
  assert.deepEqual(kinds(h, A), ['Robot 2', 'Robot 2'], 'the Robot and its copy');
});

test('CR 708.4a: one order question per creation batch (Manufacture asks once)', () => {
  const { h, A, ids: [aoa] } = cast(69715, ['Automaton of Abundance', 'Cosmic Conspirator'], 'Manufacture', ['metal', 6]);
  first(h, aoa!);
  const asked: string[] = [];
  while (h.state.decision) {
    assert.ok(!isOrder(h.state.decision), `asked the order again: ${h.state.decision.prompt}`);
    asked.push(h.state.decision.prompt.replace('Cosmic Conspirator: create a token of another type instead of the ', ''));
    pick(h, 'Fireball');
  }
  assert.deepEqual(asked, ['Robot 3?', 'copy of the Robot 3?', 'Robot 2?', 'copy of the Robot 2?', 'Robot 1?', 'copy of the Robot 1?']);
  assert.deepEqual(kinds(h, A), ['Fireball 1', 'Fireball 1', 'Fireball 2', 'Fireball 2', 'Fireball 3', 'Fireball 3']);
});

test('CR 708.4a: two Automatons and a Conspirator, asked again after the first Automaton applies', () => {
  const { h, A, ids: [a1, a2] } = cast(69716,
    ['Automaton of Abundance', 'Automaton of Abundance', 'Cosmic Conspirator'], 'Self-Assembly', ['metal', 2]);
  first(h, a1!);
  assert.equal(h.state.decision?.prompt, 'Creating a Robot 2 and a copy — which applies next?',
    'how many Automatons go before the Conspirator is the choice');
  first(h, a2!);
  let n = 0;
  while (h.state.decision) { assert.ok(!isOrder(h.state.decision)); pick(h, 'Crystal'); n++; }
  assert.equal(n, 3, '1 token -> 2 tokens -> 3 tokens, each offered to the Conspirator');
  assert.deepEqual(kinds(h, A), ['Crystal 2', 'Crystal 2', 'Crystal 2']);
});

test('CR 708.4a: Biotoxicity Poisons with both cards, no order question', () => {
  const { h, A } = cast(69717, ['Automaton of Abundance', 'Cosmic Conspirator'], 'Biotoxicity', ['wood', 2]);
  const seen: string[] = [];
  while (h.state.decision) {
    assert.ok(!isOrder(h.state.decision), 'the Automaton cannot apply to a Poison: nothing to order');
    seen.push(h.state.decision.prompt);
    pick(h, seen.length === 1 ? 'Robot' : 'keep');
  }
  assert.equal(seen.length, 3, 'one Conspirator question per Poison');
  // the Conspirator made the first a Robot: the Automaton, re-tested, copies it
  assert.deepEqual(kinds(h, A), ['Poison 1', 'Poison 1', 'Robot 1', 'Robot 1']);
});

test('CR 708.4a: Automaton alone and Conspirator alone ask nothing new', () => {
  // The event streams below were recorded on master 82307f7a, before the
  // token family moved onto the seam: one card of the two plays exactly as it did.
  const want = JSON.parse(readFileSync(new URL('697-one-replacement-events.master-82307f7a.json', FIX), 'utf8')) as
    Record<string, { log: EngineEvent[]; decision: string | null }>;
  const run = (seed: number, cards: string[], spell: string, res: [string, number], answers: string[]) => {
    const { h, at } = cast(seed, cards, spell, res);
    for (const a of answers) pick(h, a);
    return { log: h.events.slice(at), decision: h.state.decision?.prompt ?? null };
  };
  const got = {
    aoaManufacture: run(69701, ['Automaton of Abundance'], 'Manufacture', ['metal', 6], []),
    twoAoaSelfAssembly: run(69702, ['Automaton of Abundance', 'Automaton of Abundance'], 'Self-Assembly', ['metal', 2], []),
    ccManufacture: run(69703, ['Cosmic Conspirator'], 'Manufacture', ['metal', 6], ['Fireball', 'keep', 'Poison']),
    ccBiotoxicity: run(69704, ['Cosmic Conspirator'], 'Biotoxicity', ['wood', 2], ['Robot', 'Crystal', 'keep']),
    aoaBiotoxicity: run(69705, ['Automaton of Abundance'], 'Biotoxicity', ['wood', 2], []),
  };
  assert.deepEqual(JSON.parse(JSON.stringify(got)), want);
});

/** Nyar's Token Gesture run, replayed to the Evoker activation (action 70) */
function nyar(): { h: Harness } {
  const row = JSON.parse(readFileSync(new URL('697-nyar-token-gesture-run.json', FIX), 'utf8')) as
    { run: { def: { seed: number } & Record<string, unknown>; deck: string[]; actions: Action[] } };
  const { def, deck, actions } = row.run;
  const h = new Harness(def.seed, ['Challenger', 'Dummy'], 'constructed', undefined,
    [[...deck], [...DUMMY_DECK]], undefined, challengeDeal({ ...def, blurb: '' } as never));
  for (const a of actions.slice(0, 70)) h.do(a);
  return { h };
}

test('CR 708.4a: Nyar run, Automaton first and every Robot a Fireball, Manufacture gives six Fireballs', () => {
  const { h } = nyar();
  const at = h.events.length;
  const dec = h.state.decision!;
  assert.equal(dec.prompt, 'Creating a Robot 3 — which applies first?', 'the question that was never asked');
  const aoa = dec.options.findIndex(o => /^Copy first Automaton of Abundance/.test(o.label));
  h.do({ type: 'decide', seat: 0, choice: aoa });
  const made: string[] = [];
  let guard = 0;
  while (h.state.decision && guard++ < 40) {
    const d = h.state.decision;
    if (isOrder(d)) {
      h.do({ type: 'decide', seat: 0, choice: d.options.findIndex(o => /^Copy first/.test(o.label)) });
      continue;
    }
    h.do({ type: 'decide', seat: 0, choice: d.options.findIndex(o => o.value === 'Fireball') });
  }
  for (const e of h.events.slice(at)) {
    const m = /^Challenger creates a (Fireball \d)\.$/.exec(e.msg);
    if (m) made.push(m[1]!);
  }
  assert.deepEqual(made.slice(0, 6), ['Fireball 3', 'Fireball 2', 'Fireball 1', 'Fireball 3', 'Fireball 2', 'Fireball 1'],
    'Manufacture: three Robots, each copied, all six exchanged (the engine allowed three)');
  assert.equal(made.length, 10, 'and Arcane Echo and Construct Overseer one Robot each, each copied in its own part');
});
