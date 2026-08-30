/* Ports of prototype test sections 1-3: setup & planning, deployment casting
 * & spawn triggers, affinity gating. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { E } from '../src/engine.ts';
import { IllegalAction, legalActions } from '../src/apply.ts';
import { giveResources, toDeployment, tokensOf, unitsOf } from './util.ts';

test('setup & planning', () => {
  const h = new Harness(1);
  assert.equal(h.state.players[0]!.hand.length, 7, 'p0 drew 5 + 2');
  assert.equal(h.state.players[1]!.hand.length, 7, 'p1 drew 5 + 2');
  assert.equal(h.state.sharedDeck.length, DECK_LIST.length * 2 - 14, 'shared deck shrank by 14');
  assert.ok(h.state.players.every(p =>
    p.resources.length === 2 && p.resources.every(r => r.kind === 'prismite' && r.state === 'dormant')),
    'two DORMANT prismites each (Manual: they start dormant)');

  const before = h.state.players[0]!.hand.length;
  const deckBefore = h.state.sharedDeck.length;
  h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' });
  assert.equal(h.state.players[0]!.hand.length, before - 1, 'recycle: hand -1');
  assert.equal(h.state.sharedDeck.length, deckBefore + 1, 'recycle: deck +1');
  assert.equal(h.state.players[0]!.resources[2]!.state, 'dormant', 'resource enters dormant');

  const e = new E(h.state);
  assert.equal(e.affinity(0, 'fire'), 0, 'dormant gives no affinity; prismites give none either');
  h.do({ type: 'activateResource', seat: 0, index: 2 });
  assert.equal(new E(h.state).affinity(0, 'fire'), 1, 'activated gives affinity');

  h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' });
  h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'water' });
  h.do({ type: 'activateResource', seat: 0, index: 3 });
  assert.throws(() => h.do({ type: 'activateResource', seat: 0, index: 4 }), IllegalAction,
    'max 2 activations per turn');
  assert.equal(h.state.players[0]!.activationsLeft, 0);
});

test('deployment: casting, spawn triggers, spell tokens', () => {
  const h = new Harness(2);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  h.state.players[p]!.hand = ['Ignis Sprite', 'Flame Juggle', 'Jelly'];
  giveResources(h, p, 'fire', 3);

  assert.throws(() => h.do({ type: 'playCard', seat: p, handIndex: 2 }), IllegalAction,
    'battle-timed Jelly not deployable');
  const manaBefore = new E(h.state).openMana(p);
  h.do({ type: 'playCard', seat: p, handIndex: 0 });   // Ignis Sprite
  const units = unitsOf(h, p);
  assert.equal(units.length, 1);
  assert.equal(units[0]!.card, 'Ignis Sprite', 'Ignis Sprite spawned');
  assert.equal(new E(h.state).openMana(p), manaBefore - 1, 'mana paid');
  assert.equal(tokensOf(h, p).length, 1, 'spawn trigger made a Fireball');
  assert.equal(tokensOf(h, p)[0]!.x, 1, 'Fireball 1');

  h.do({ type: 'playCard', seat: p, handIndex: 0 });   // Flame Juggle
  assert.equal(tokensOf(h, p).length, 4, 'Flame Juggle created 3 more Fireballs');
  assert.ok(h.state.players[p]!.bin.includes('Flame Juggle'), 'Flame Juggle in bin');
});

test('battle-timed Fireball is NOT castable during deployment (real timing rule)', () => {
  const h = new Harness(21);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  h.state.players[p]!.hand = ['Flame Juggle'];
  giveResources(h, p, 'fire', 2);
  h.do({ type: 'playCard', seat: p, handIndex: 0 });
  const tok = tokensOf(h, p)[0]!;
  assert.throws(() => h.do({ type: 'castSpellToken', seat: p, entityId: tok.id }), IllegalAction,
    'Fireball is {Battle}: deployment casting was a prototype simplification');
  assert.ok(!legalActions(h.state, p).some(a => a.type === 'castSpellToken'),
    'legalActions agrees');
});

test('affinity gating: prismites are NOT wild', () => {
  const h = new Harness(3);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  h.state.players[p]!.hand = ['Dreadwave Devourer'];   // cost bb, 6 mana
  giveResources(h, p, 'fire', 6);
  h.state.players[p]!.resources.forEach(r => { if (r.kind === 'prismite') r.state = 'open'; });
  assert.equal(new E(h.state).canPayCard(p, 'Dreadwave Devourer'), false,
    '6 fire + 2 ACTIVE prismites still fail bb — prismites give no affinity (R17)');
  giveResources(h, p, 'water', 2);
  assert.equal(new E(h.state).canPayCard(p, 'Dreadwave Devourer'), true,
    '2 real water resources meet bb');
});

test('R17/prismites: dormant start, no affinity, planning exchange into any element', () => {
  const h = new Harness(31);
  const p = 0;
  // turn 1 planning: activate both starting prismites (the typical line)
  h.do({ type: 'activateResource', seat: p, index: 0 });
  h.do({ type: 'activateResource', seat: p, index: 1 });
  assert.equal(h.state.players[p]!.activationsLeft, 0, 'activations spent on the prismites');
  assert.equal(new E(h.state).openMana(p), 2, 'active prismites ARE expendable for mana');
  assert.equal(new E(h.state).affinity(p, 'fire'), 0, 'but grant no affinity');

  // exchange one for fire — "pick your two starting resources for free"
  assert.ok(legalActions(h.state, p).some(a => a.type === 'exchangePrismite'),
    'exchange offered for active prismites');
  h.do({ type: 'exchangePrismite', seat: p, index: 0, element: 'fire' });
  assert.equal(h.state.players[p]!.resources[0]!.kind, 'fire', 'prismite became a fire resource');
  assert.equal(h.state.players[p]!.resources[0]!.state, 'open', 'exchange keeps the state');
  assert.equal(new E(h.state).affinity(p, 'fire'), 1, 'now it grants affinity');

  // a dormant prismite cannot be exchanged (Manual: ACTIVE prismites may be)
  h.state.players[p]!.resources.push({ kind: 'prismite', state: 'dormant' });
  assert.throws(() => h.do({ type: 'exchangePrismite', seat: p, index: 2, element: 'water' }),
    IllegalAction, 'dormant prismites cannot be exchanged');
  assert.ok(!legalActions(h.state, p).some(a => a.type === 'exchangePrismite' && a.index === 2),
    'legalActions agrees');
});
