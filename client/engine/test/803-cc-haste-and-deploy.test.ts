/* Competitive Constructed (doc 22 §3.2) — the haste step and deployment.
 *
 * CR 501.4: the haste step is taken first by the initiative player and then by
 * the non-initiative player. CR 507.3: the printed rules have the initiative
 * team deploy first. In CC both hold as printed (the house rule, Annex D1.5,
 * runs them at once and hidden); one predicate per step (E.hasting,
 * E.deploying) is read by the reducer and by legalActions alike.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { legalActions } from '../src/apply.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import type { Action, Seat } from '../src/types.ts';
import { ccDecks, ccGame, ccToDeploy, ccToHaste, gateDisagreements, refused, types } from './cc-walk.ts';
import { give, giveResources } from './util.ts';

const agree = (h: Harness, where: string): void => assert.deepEqual(gateDisagreements(h.state), [], where);
const ELEMENTS = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'] as const;
const rich = (h: Harness, seat: Seat): void => { for (const el of ELEMENTS) giveResources(h, seat, el, 4); };

/** a haste card the house-rules twin of this board offers `seat` to play */
function hastePlay(h: Harness, seat: Seat): Action {
  for (const n of DECK_LIST) {
    if (getCard(n).timing !== 'haste') continue;
    const i = give(h, seat, n);
    const twin = structuredClone(h.state);
    delete twin.sequential;
    const play = legalActions(twin, seat);
    const found = play.find(a => a.type === 'playCard' && a.handIndex === i);
    if (found) return found;
    h.state.players[seat]!.hand.splice(i, 1);
  }
  throw new Error('no haste card is playable here');
}

test('CC haste step: the initiative player first, then the non-initiative player', () => {
  for (const int of [0, 1] as Seat[]) {
    const nit = 1 - int;
    const h = ccToHaste(ccGame(int));
    rich(h, nit);
    const early = hastePlay(h, nit);
    assert.deepEqual(h.legal(nit), [], 'the NIT watches the INT haste step');
    assert.ok(h.legal(int).some(a => a.type === 'doneHaste'));
    refused(h, { type: 'doneHaste', seat: nit }, /initiative player takes the haste step first/);
    refused(h, early, /not your haste step/);
    agree(h, 'INT haste step');
    h.do({ type: 'doneHaste', seat: int });
    assert.equal(h.state.phase, 'planning', 'still the haste step');
    assert.deepEqual(h.legal(int), []);
    assert.ok(h.legal(nit).some(a => JSON.stringify(a) === JSON.stringify(early)), 'now the NIT may play it');
    agree(h, 'NIT haste step');
    h.do({ type: 'doneHaste', seat: nit });
    assert.equal(h.state.phase, 'battle');
  }
});

test('CC deployment: only the initiative player deploys, then the other, and the log says so', () => {
  for (const int of [0, 1] as Seat[]) {
    const nit = 1 - int;
    const h = ccToDeploy(ccGame(int));
    const names = ['Ann', 'Bob'];
    assert.ok(h.log.includes(`Deployment: ${names[int]} deploys first, then ${names[nit]}.`), 'the CC phase line');
    assert.ok(!h.log.some(l => /deploy at the same time/.test(l)), 'not the house-rule line');
    rich(h, nit);
    const unit = give(h, nit, 'Bloatfiend');
    assert.deepEqual(h.legal(nit), [], 'the NIT watches the INT deploy');
    refused(h, { type: 'playCard', seat: nit, handIndex: unit }, /not your deployment/);
    refused(h, { type: 'doneDeploying', seat: nit }, /not your deployment/);
    agree(h, 'INT deploying');
    h.do({ type: 'doneDeploying', seat: int });
    assert.equal(h.state.deployPlayer, nit);
    assert.deepEqual(h.legal(int), []);
    assert.ok(h.legal(nit).some(a => a.type === 'playCard' && a.handIndex === unit), 'now the NIT deploys');
    agree(h, 'NIT deploying');
    h.do({ type: 'playCard', seat: nit, handIndex: unit });
    h.do({ type: 'doneDeploying', seat: nit });
    assert.equal(h.state.turn, 2);
    assert.equal(h.state.initiative, nit, 'the initiative passes as ever');
    assert.deepEqual(types(h.legal(int)), ['bottomCards'], 'and turn 2 bottoms at once again');
    assert.deepEqual(types(h.legal(nit)), ['bottomCards']);
  }
});

test('CC deployment: a house-rules game still deploys at once, with the old line', () => {
  const h = new Harness(42, ['Ann', 'Bob'], 'constructed', undefined, ccDecks());
  for (const seat of [0, 1] as Seat[]) h.do({ type: 'bottomCards', seat, handIndices: [0, 1] });
  for (const seat of [0, 1] as Seat[]) h.do({ type: 'donePlanning', seat });
  for (const seat of [0, 1] as Seat[]) h.do({ type: 'doneHaste', seat });
  while (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.ok(h.log.includes('Deployment: both players deploy at the same time — moves are revealed when everyone is done.'));
  const nit = 1 - h.state.initiative;
  assert.ok(h.legal(nit).some(a => a.type === 'doneDeploying'), 'the NIT may deploy at once');
});
