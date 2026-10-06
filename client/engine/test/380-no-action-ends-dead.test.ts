/* R313 — no action ends with a dead unit standing.
 *
 * Report #197 (room SGSZ, action 98): Dreadspawn Horror ("[Augment] I gain
 * -1/-1 for each card in your hand") went to 2/0 on the turn's draw and stood
 * through the draft and planning step. The draw happens in `startTurn`, which
 * runs at the foot of a settle pass — after that pass's death check — and no
 * planning action settles again. `apply()` now ends every completed action at a
 * full safe point whenever a unit is lethal. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { effStats, ent, giveResources, spawn, toDeployment } from './util.ts';

/** seat 0 controls a Dreadspawn Horror with exactly `hand` cards in hand */
function dreadspawnWithHand(hand: number): { h: Harness; id: number } {
  const h = new Harness(4242);
  h.state.players[0]!.hand = h.state.players[0]!.hand.slice(0, hand);
  const id = spawn(h, 0, 'Dreadspawn Horror');
  return { h, id };
}

test('R313: the turn draw that takes Dreadspawn Horror to 0 defense kills it at the turn flip', () => {
  const { h, id } = dreadspawnWithHand(3);
  assert.deepEqual(effStats(h, id), [4, 2], '7/5 with three cards in hand');
  toDeployment(h);
  assert.ok(ent(h, id), 'still alive going into deployment');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // the turn flips; shared mode draws 2
  assert.equal(h.state.phase, 'planning');
  assert.equal(h.state.players[0]!.hand.length, 5);
  assert.equal(ent(h, id), undefined,
    'a 2/0 Dreadspawn Horror survived the turn flip — the death check never ran after the draw');
  assert.ok(h.log.some(l => /Dreadspawn Horror dies/.test(l)));
});

test('R313: a planning action that does not settle still ends with the dead unit gone', () => {
  // The backstop is general, not a turn-flip patch: make the unit lethal behind
  // the reducer's back, then take an action (activating a resource) whose own
  // handler never reaches settle().
  const { h, id } = dreadspawnWithHand(3);
  h.state.players[0]!.hand.push('Dreadspawn Horror', 'Dreadspawn Horror');   // 5 cards → 2/0
  assert.ok(ent(h, id), 'nothing has checked yet');
  giveResources(h, 0, 'water', 1, 'dormant');
  h.do({ type: 'activateResource', seat: 0, index: h.state.players[0]!.resources.length - 1 });
  assert.equal(ent(h, id), undefined, 'the action ended with a 2/0 unit standing');
});

test('R313: an action with nothing lethal on the board runs no extra safe point', () => {
  const { h, id } = dreadspawnWithHand(2);   // 5/3
  giveResources(h, 0, 'water', 1, 'dormant');
  const before = h.log.length;
  h.do({ type: 'activateResource', seat: 0, index: h.state.players[0]!.resources.length - 1 });
  assert.ok(ent(h, id));
  assert.deepEqual(h.log.slice(before).filter(l => l.trim()), ['Player 1 activates a water resource.']);
});

// ── constructed: the draw phase is one step (draw 4, bottom 2) ──────────────
// Owner, 2026-10-06: "when you draw 4 discard 2 in constructed … it won't die.
// It'll likely become -2/-2 smaller than during deployment since you do net
// cards." The draw and the bottoming are two actions; the check sees the NET.

import { DECK_LIST } from '../src/cards/registry.ts';

function constructedDreadspawn(hand: number): { h: Harness; id: number } {
  const h = new Harness(4243, undefined, 'constructed', undefined, [DECK_LIST.slice(0, 30), DECK_LIST.slice(30, 60)]);
  for (const seat of [0, 1] as const) {
    if (h.state.bottomDone && !h.state.bottomDone[seat]) {
      h.do({ type: 'bottomCards', seat, handIndices: [0, 1].slice(0, Math.min(2, h.state.players[seat]!.hand.length)) });
    }
  }
  h.state.players[0]!.hand = h.state.players[0]!.hand.slice(0, hand);
  const id = spawn(h, 0, 'Dreadspawn Horror');
  toDeployment(h);
  return { h, id };
}

function flipTurn(h: Harness): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
}

test('R313 constructed: drawing 4 does not kill before the 2 go back — 1 card in hand ends a 4/2', () => {
  const { h, id } = constructedDreadspawn(1);
  assert.deepEqual(effStats(h, id), [6, 4]);
  flipTurn(h);
  assert.equal(h.state.players[0]!.hand.length, 5, 'drew 4');
  assert.ok(ent(h, id), 'died on the draw of 4, before its controller bottomed 2');
  h.do({ type: 'bottomCards', seat: 0, handIndices: [0, 1] });
  assert.ok(ent(h, id));
  assert.deepEqual(effStats(h, id), [4, 2]);
});

test('R313 constructed: 3 cards in hand nets to 5 — it dies once its controller has bottomed', () => {
  const { h, id } = constructedDreadspawn(3);
  flipTurn(h);
  assert.ok(ent(h, id), 'still mid draw phase');
  h.do({ type: 'bottomCards', seat: 0, handIndices: [0, 1] });
  assert.equal(h.state.players[0]!.hand.length, 5);
  assert.equal(ent(h, id), undefined, 'a 2/0 survived the end of its controller\'s draw phase');
});

// ── draft: the hand↔pack merge is one action, so its 13-card moment is never judged

function draftAll(h: Harness): void {
  for (const seat of [0, 1] as const) {
    if (h.state.draftDone && !h.state.draftDone[seat]) {
      const hand = h.state.players[seat]!.hand.length, pack = h.state.packs[seat]!.length;
      h.do({ type: 'draftCommit', seat, packIndices: Array.from({ length: pack }, (_, i) => hand + i) });
    }
  }
}

test('R313 draft: 1 card in hand, then the turn draw and the draft — a 4/2 that lives', () => {
  const h = new Harness(4244, undefined, 'draft');
  draftAll(h);
  h.state.players[0]!.hand = h.state.players[0]!.hand.slice(0, 1);
  const id = spawn(h, 0, 'Dreadspawn Horror');
  assert.deepEqual(effStats(h, id), [6, 4]);
  toDeployment(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // draws 2: 1 → 3
  draftAll(h);                                                      // hand + pack, 10 back: still 3
  assert.equal(h.state.players[0]!.hand.length, 3);
  assert.ok(ent(h, id));
  assert.deepEqual(effStats(h, id), [4, 2]);
});
