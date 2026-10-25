/* 679 — WHAT INSIDE A HIDDEN STEP IS PUBLIC (CT-377, finding F-U23-9).
 *
 * server/rewind-cuts.ts marks each action of the open hidden step `hidden`
 * unless its type is in PUBLIC_IN_HIDDEN, and server/rooms.ts rewindPlans
 * refuses a cut inside the step that takes back any of the OTHER seat's hidden
 * actions. The comment beside the set said it was the done-flags "all but
 * haste's"; the set is donePlanning, doneDeploying and amend, and the
 * rewindPlans comment said a cut inside the step takes back "only this seat's
 * own actions". CR D4.5d (redrafted for CT-325) settles which is meant:
 *
 *   "Inside a hidden step, a point within the step is offered only if it
 *    takes back none of the other player's hidden actions there (their public
 *    ones, such as finishing planning or deployment, may be taken back)"
 *
 * and CR D4.5c: an agreed edit "is shown to both players at once". This file
 * MEASURES the set against what the other seat is really served
 * (server/view.ts viewFor, with the step's frozen half) and pins it:
 *
 *   public   donePlanning  — planningDone is served live
 *            doneDeploying — deployDone is served live
 *            amend         — an agreed fix is shown to both at once (CR D4.5c)
 *   hidden   doneHaste     — hasteDone is redacted for the other seat
 *            draftCommit, bottomCards — their done-flags are served live
 *              (draftDone measured below; bottomDone by view.ts's own rule),
 *              but the action is the private pick itself, so it stays hidden:
 *              a cut inside the step does not take back the other seat's pick
 *              (the start of the step may)
 *            everything else a seat does in the step (recycle, activate, play)
 *
 * Seeds 67900-67999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness } from '../../engine/src/harness.ts';
import { forcedAction, legalActions } from '../../engine/src/apply.ts';
import { skipHasteStep } from '../../engine/test/util.ts';
import type { Action, GameState } from '../../engine/src/types.ts';
import { describe } from '../rewind-cuts.ts';
import { viewFor } from '../view.ts';
import type { Room } from '../rooms.ts';

process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-679-'));
const R = await import('../rooms.ts');

const PUBLIC = ['donePlanning', 'doneDeploying', 'amend'];
const HIDDEN = ['doneHaste', 'draftCommit', 'bottomCards', 'recycleForResource', 'activateResource',
  'exchangePrismite', 'playCard', 'playCached', 'activateAbility', 'decide', 'prophesy', 'augment', 'graft'];

test('CR D4.5d / CT-377: the set, pinned: done planning, done deploying and an agreed fix are public inside a hidden step', () => {
  const s = new Harness(67900).state;
  for (const type of PUBLIC) {
    assert.equal(describe({ type, seat: 0 } as unknown as Action, s, 0, true).hidden, false, `${type} is public`);
  }
  for (const type of HIDDEN) {
    assert.equal(describe({ type, seat: 0 } as unknown as Action, s, 0, true).hidden, true, `${type} stays hidden`);
  }
  // outside a hidden step nothing is hidden at all
  assert.equal(describe({ type: 'playCard', seat: 0, handIndex: 0 }, s, 0, false).hidden, false);
});

/** seat 0 finishes the step it is in; the board seat 1 is served, with the
 * step's frozen half as the server keeps it */
function servedAfter(s: GameState, done: Action): { live: GameState; seen: GameState } {
  const frozen = structuredClone(s);
  const h = new Harness(1);
  h.state = structuredClone(s);
  h.do(done);
  return { live: h.state, seen: viewFor(h.state, 1, frozen, 1) as GameState };
}

test('CR D4.5d / CT-377: measured, the other seat is served done planning and done deploying live, and done haste redacted', () => {
  const h = new Harness(67901);
  assert.equal(h.state.phase, 'planning');
  const plan = servedAfter(h.state, { type: 'donePlanning', seat: 0 });
  assert.equal(plan.live.planningDone[0], true, 'fixture: seat 0 is done planning');
  assert.equal(plan.seen.planningDone[0], true, 'seat 1 sees it: donePlanning is public');

  // the haste step: done haste is the one redacted done-flag
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  for (let g = 0; g < 8; g++) { const f = forcedAction(h.state); if (!f) break; h.do(f); }
  if (h.state.hasteDone) {
    const haste = servedAfter(h.state, { type: 'doneHaste', seat: 0 });
    assert.equal(haste.live.hasteDone?.[0], true, 'fixture: seat 0 is done with haste');
    assert.equal(haste.seen.hasteDone?.[0], false, 'seat 1 is not told: doneHaste stays hidden');
  } else assert.fail('fixture: the haste step opened');

  // a draft pick: its done-flag is served live too — the action stays hidden
  // because it is the pick itself (see the header)
  const d = new Harness(67904, ['Ann', 'Bo'], 'draft');
  const pickA = legalActions(d.state, 0).find(x => x.type === 'draftCommit');
  assert.ok(pickA && d.state.draftDone, 'fixture: the draft step is open');
  const draft = servedAfter(d.state, pickA);
  assert.equal(draft.live.draftDone?.[0], true, 'fixture: seat 0 has drafted');
  assert.equal(draft.seen.draftDone?.[0], true, 'seat 1 sees that it has, not what');

  skipHasteStep(h);
  const phase = (): string => h.state.phase;   // the loop moves it; no narrowing
  for (let g = 0; g < 40 && phase() !== 'deploy'; g++) {
    const f = forcedAction(h.state);
    const a = f ?? legalActions(h.state, h.state.priority ?? 0).find(x => x.type === 'passPriority' || x.type === 'declareAttack' || x.type === 'declareBlocks' || x.type === 'decide')
      ?? legalActions(h.state, 1).find(x => x.type === 'passPriority' || x.type === 'declareAttack' || x.type === 'declareBlocks' || x.type === 'decide');
    if (!a) break;
    h.do(a);
  }
  assert.equal(phase(), 'deploy', 'fixture: reached deployment');
  const dep = servedAfter(h.state, { type: 'doneDeploying', seat: 0 });
  assert.equal(dep.live.deployDone?.[0], true, 'fixture: seat 0 is done deploying');
  assert.equal(dep.seen.deployDone?.[0], true, 'seat 1 sees it: doneDeploying is public');
});

/** one tick of main.ts: apply, drain the forced steps, reopen a closed segment */
function tick(room: Room, a: Action): void {
  const was = room.segKey;
  R.applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    R.applyToRoom(room, f);
  }
  if (R.segmentKey(room.state) !== was) R.openSegment(room);
}

test('CR D4.5d / CT-377: a cut inside the hidden step may take back the other seat done planning, never their recycle', () => {
  const room = R.createRoom('P79A', 67902, ['Ann', 'Bo'], 'shared');
  room.sockets = [{} as never, {} as never];
  tick(room, R.legalInRoom(room, 0).find(a => a.type === 'recycleForResource')!);
  tick(room, { type: 'donePlanning', seat: 1 });
  assert.equal(room.segKey, 'plan', 'fixture: still the hidden planning step');
  // a point WITHIN the step (not its start, which may take anything back)
  const within = R.rewindPlans(room, 0).filter(p => p.kind === 'before' && p.to === 1);
  assert.equal(within.length, 1, 'a cut inside the step, just before their done planning, is on offer (CR D4.5d)');
  assert.deepEqual(within[0]!.items.map(x => [x.seat, x.word, x.hidden]), [[1, 'done planning', false]],
    'and it takes back exactly that, which they were shown');

  const room2 = R.createRoom('P79B', 67903, ['Ann', 'Bo'], 'shared');
  room2.sockets = [{} as never, {} as never];
  tick(room2, R.legalInRoom(room2, 1).find(a => a.type === 'recycleForResource')!);
  tick(room2, R.legalInRoom(room2, 0).find(a => a.type === 'recycleForResource')!);
  const inside = R.rewindPlans(room2, 0).filter(p => p.kind === 'before');
  assert.ok(inside.length, 'seat 0 may take back its own recycle');
  assert.ok(inside.every(p => !p.items.some(x => x.seat === 1)), 'and no cut inside the step takes back their hidden recycle');
});
