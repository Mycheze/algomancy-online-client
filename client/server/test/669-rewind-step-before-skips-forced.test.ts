/* 669 — CT-376: "THE START OF THE STEP BEFORE" NEVER LANDS ON A FORCED ACTION.
 *
 * rewindPlans offered the start of the step before as a cut at that step's
 * first log index, without the forced-action check the "before <action>" cuts
 * get (CR D4.5d: "an action the game took for a player is neither counted nor
 * a place to stop"). On turn 1 both boards are empty, so both attack
 * declarations are forced; in the deploy step after them the step before was
 * the counterattack declaration, the cut landed just before that forced
 * empty declaration, main.ts's drain took it again at once, and the option
 * really ended at the start of the CURRENT step (found on seed 48593).
 *
 * The test SEARCHES for the shape — a board whose current step began right
 * after a forced action — rather than pinning a seed, since a legal action
 * added anywhere re-rolls a greedy drive.
 *
 * Seeds 66900-66999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forcedAction, replay } from '../../engine/src/apply.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';
import type { CutPlan } from '../rewind-cuts.ts';

process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-669-'));
const R = await import('../rooms.ts');

const NAMES: [string, string] = ['Ann', 'Bo'];

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

/** 485's plain player: one recycle a turn, every activation and unit, the passive answer to the rest */
function greedy(room: Room, seat: Seat, recycled: Set<string>): Action | null {
  const legal = R.legalInRoom(room, seat);
  const key = `${room.state.turn}:${seat}`;
  const rec = legal.find(a => a.type === 'recycleForResource');
  if (rec && !recycled.has(key)) { recycled.add(key); return rec; }
  return legal.find(a => a.type === 'activateResource')
    ?? (room.state.phase === 'deploy' ? legal.find(a => a.type === 'playCard') : undefined)
    ?? legal.find(a => ['decide', 'donePlanning', 'doneHaste', 'declareBlocks', 'passPriority', 'doneDeploying'].includes(a.type))
    ?? legal.filter(a => a.type === 'declareAttack').at(-1) ?? null;
}

const boardAt = (room: Room, i: number): GameState =>
  replay(room.seed, room.actions.slice(0, i), [...NAMES], 'shared').state;
/** is log action `i` one the game took for a player (the board owed it)? */
const forcedAt = (room: Room, i: number): boolean => {
  const f = forcedAction(boardAt(room, i));
  return f !== null && JSON.stringify(f) === JSON.stringify(room.actions[i]);
};
/** where a cut to `to` really ends: the drain re-takes every forced action owed there */
const landing = (room: Room, to: number): number => {
  let j = to;
  while (j < room.actions.length && forcedAt(room, j)) j++;
  return j;
};
const startPlan = (plans: CutPlan[]): CutPlan | undefined =>
  plans.find(p => p.kind === 'start' || p.alsoStart === 'this step');
const prevPlan = (plans: CutPlan[]): CutPlan | undefined =>
  plans.find(p => p.kind === 'prev' || (p.alsoStart !== undefined && p.alsoStart !== 'this step'));

test('CR D4.5d / CT-376: the start of the step before skips a forced action and never collapses onto the current step', () => {
  let seen = 0;
  for (let seed = 66900; seed < 66910 && seen < 3; seed++) {
    const room = R.createRoom(`F${seed}`, seed, [...NAMES], 'shared');
    room.sockets = [{} as never, {} as never];
    const recycled = new Set<string>();
    for (let n = 0; n < 60 && room.state.phase !== 'gameover'; n++) {
      const a = greedy(room, 0, recycled) ?? greedy(room, 1, recycled);
      if (!a) break;
      tick(room, a);
      const plans = R.rewindPlans(room, 0);
      const here = startPlan(plans)?.to;
      // the shape: this step began right after an action the game took
      if (here === undefined || here < 1 || !forcedAt(room, here - 1)) continue;
      seen++;
      const prev = prevPlan(plans);
      const at = `seed ${seed}, ${room.actions.length} actions, this step from ${here}`;
      assert.ok(prev, `${at}: a step before is offered (the game has steps a player stood in)`);
      assert.equal(forcedAt(room, prev!.to), false,
        `${at}: the step-before cut (${prev!.to}) is just before a forced action, which re-takes itself at once`);
      assert.ok(landing(room, prev!.to) < here,
        `${at}: the step-before cut lands at ${landing(room, prev!.to)}, inside the current step`);
      const label = R.rewindOptions(room, 0).find(o => o.to === prev!.to)?.label ?? '';
      assert.match(label, /the start of/, `${at}: and it is still named as the start of a step (${label})`);
      break;
    }
  }
  assert.ok(seen >= 3, `the shape was found in ${seen} games (wanted 3)`);
});
