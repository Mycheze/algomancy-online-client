/* GRIDXLAN — THE BONESCULPTOR'S TWIN (CR 707.10, the CT-255 fix applied again).
 *
 * "[Augment] If your hand is empty, you may play one unit from your bin during
 * deployment."
 *
 * It was a free bounded ACTIVATED ability whose resolution asked which unit,
 * and the unit it raised was put into play with no play event at all. It is a
 * standing permission now: with an empty hand, each unit card in the bin is an
 * ordinary `playFromBin` in deployment, once per deployment per Gridxlan. "One
 * unit" is ANY unit — Gridxlan prints no "with no abilities".
 *
 * Seeds 55900-55949.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import type { Action, Seat } from '../src/types.ts';
import { getCard } from '../src/cards/dsl.ts';
import { giveResources, spawn, toDeployment, unitsOf, withE } from './util.ts';

type BinPlay = Extract<Action, { type: 'playFromBin' }>;
const binPlays = (h: Harness, seat: Seat): BinPlay[] =>
  legalActions(h.state, seat).filter((a): a is BinPlay => a.type === 'playFromBin');
const offered = (h: Harness, seat: Seat): string[] =>
  binPlays(h, seat).map(a => h.state.players[seat]!.bin[a.binIndex]!);

function setup(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const p = h.state.deployPlayer! as Seat;
  const grid = spawn(h, p, 'Gridxlan');
  h.state.players[p]!.hand.length = 0;                   // the printed condition
  // a vanilla, a unit WITH abilities, and a spell
  h.state.players[p]!.bin.push('Curio Drifter', 'Ignis Sprite', 'Channeled Boon');
  giveResources(h, p, 'water', 2);
  giveResources(h, p, 'fire', 4);
  return { h, p, grid };
}

test('CR 707.10: Gridxlan has no activated ability, and with an empty hand it offers ANY unit in the bin as a play', () => {
  assert.equal((getCard('Gridxlan').augmentText ?? []).filter(a => a.type === 'activated').length, 0,
    'the permission is not an ability: nothing to activate');
  const { h, p, grid } = setup(55900);
  assert.ok(!legalActions(h.state, p).some(a => a.type === 'activateAbility' && a.entityId === grid),
    'no activateAbility is offered for it');
  const o = offered(h, p);
  assert.ok(o.includes('Curio Drifter'), 'a vanilla unit is offered');
  assert.ok(o.includes('Ignis Sprite'), '"one unit" is any unit — a unit with abilities is offered too');
  assert.ok(!o.includes('Channeled Boon'), 'a spell is not a unit');
});

test('CR 707.10: Gridxlan offers nothing while its controller holds a card', () => {
  const { h, p } = setup(55901);
  h.state.players[p]!.hand.push('Curio Drifter');
  assert.deepEqual(binPlays(h, p), [], '"If your hand is empty" — it is not');
});

test('CR 707.10 / CR 301.9: the unit Gridxlan lets you play is PLAYED, paid for, and only one per deployment', () => {
  const { h, p } = setup(55902);
  const mark = h.events.length;
  const play = binPlays(h, p).find(a => h.state.players[p]!.bin[a.binIndex] === 'Ignis Sprite');
  assert.ok(play, 'offered');
  h.do(play);
  assert.equal(h.state.decision, null, 'nothing is asked — choosing the card IS the action');
  const evs = h.events.slice(mark);
  assert.ok(!evs.some(e => (e.type === 'resolved' || e.type === 'stackPushed') && /Gridxlan/.test(e.msg)),
    'no Gridxlan item ever went on the stack');
  assert.ok(unitsOf(h, p).some(u => u.card === 'Ignis Sprite'), 'the unit is in play');
  const played = evs.find(e => e.type === 'cardPlayed' && e.data?.['card'] === 'Ignis Sprite');
  assert.ok(played, 'it was PLAYED — the wide play event fired (the activated version put it into play in silence)');
  assert.equal(played.data?.['from'], 'bin', 'from the bin');
  assert.deepEqual(binPlays(h, p), [], 'one unit per deployment: the Drifter is not offered now');
});

test('CR 707.10: as an augment mod, Gridxlan grants the permission to its host controller', () => {
  const h = new Harness(55903);
  toDeployment(h);
  const p = h.state.deployPlayer! as Seat;
  const host = spawn(h, p, 'Unit Token');
  withE(h, e => { e.attachMod(e.entity(host)!, 'Gridxlan', p, 'augment'); });
  h.state.players[p]!.hand.length = 0;
  h.state.players[p]!.bin.push('Curio Drifter');
  giveResources(h, p, 'water', 1);
  assert.deepEqual(offered(h, p), ['Curio Drifter'], 'the donated [Augment] box grants it from the host');
});

test('CR 707.10: with a Bonesculptor and a Gridxlan up, a vanilla spends the narrower grant first', () => {
  const { h, p } = setup(55904);
  spawn(h, p, 'The Bonesculptor');
  // the vanilla is reachable by both grants; Ignis Sprite only by Gridxlan's
  h.do(binPlays(h, p).find(a => h.state.players[p]!.bin[a.binIndex] === 'Curio Drifter')!);
  assert.deepEqual(offered(h, p), ['Ignis Sprite'],
    'the Drifter was charged to The Bonesculptor, so Gridxlan can still play the unit only it reaches');
  h.do(binPlays(h, p)[0]!);
  assert.deepEqual(binPlays(h, p), [], 'and then both grants are spent');
});
