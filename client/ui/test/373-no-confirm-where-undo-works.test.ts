/* Report #194 (2026-10-04) — NO "YES, ACTIVATE" WHERE UNDO WORKS.
 *
 * The owner: "During deployment (or any phase that allows undo), we should
 * not ask for 'confirmation' when activating abilities. The 'Yes, activate'
 * is supposed to just prevent people from accidentally activating abilities
 * during combat, but doing it during Deployment doesn't make sense."
 *
 * The bar (ui/main.ts take() → needsConfirm) guards an activation that spends
 * something you cannot get back and will not stop to ask for a target
 * (ui/inspect.ts activationNeedsConfirm, which stays phase-blind and pure).
 * It was asked in every phase. Now ui/undo.ts undoAvailable — the very test
 * that shows the ↶ undo button — skips it: planning, haste and deployment
 * activate on the click, and battle still asks.
 *
 * Driven on the real client (test/ui-driver.ts), with the click a player
 * makes: on the unit itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { ent, pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, EntityId, GameState, Seat } from '../../engine/src/types.ts';
import { activationNeedsConfirm } from '../inspect.ts';
import { undoAvailable } from '../undo.ts';
import { client } from './ui-driver.ts';

const ui = await client();

type Activate = Extract<Action, { type: 'activateAbility' }>;
/** "Sacrifice me: recall up to one target cached card" — with an empty cache
 * nothing will stop to ask, so the click alone would sacrifice it: the trap
 * the bar exists for (engine/test/50-ui-inspect) */
const CARD = 'Prismatic Observer';

function activation(s: GameState, seat: Seat, id: EntityId): Activate {
  const a = legalActions(s, seat).find((x): x is Activate => x.type === 'activateAbility' && x.entityId === id);
  assert.ok(a, `${CARD}'s ability is legal for seat ${seat} in ${s.phase}`);
  assert.equal(activationNeedsConfirm(new E(s), s.entities[id]!, a), true,
    'the pure gate still says this activation is irreversible and untargeted — or the test proves nothing');
  return a;
}

function show(s: GameState, seat: Seat): void {
  ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  ui.sent();   // forget the join's own traffic
}

test('in deployment, an irreversible ability activates on the click — undo is the safety net, not a bar', () => {
  const h = new Harness(37301, ['Ann', 'Bo']);
  toDeployment(h);
  const me = h.state.deployPlayer!;
  const obs = spawn(h, me, CARD);
  const a = activation(h.state, me, obs);
  assert.equal(undoAvailable(h.state, { spectating: false }), true, 'deployment is a step undo works in');
  show(h.state, me);
  assert.ok(ui.has({ btn: 'undo' }), 'the ↶ undo button is on the rail');
  ui.click({ act: 'unit', id: obs });
  assert.ok(!ui.has({ btn: 'actconfirm' }), 'no "Yes, activate" bar in deployment');
  assert.deepEqual(ui.actions(), [a], 'the click sends the activation itself');
});

test('in battle, the same ability still asks "Yes, activate" — nothing there is undone', () => {
  const h = new Harness(37302, ['Ann', 'Bo']);
  toDeployment(h);
  const obsBySeat = ([0, 1] as const).map(seat => spawn(h, seat, CARD));
  toNextBattle(h);
  // walk to a window where one seat holds priority with the observer usable
  let seat: Seat | null = null;
  for (let guard = 0; guard < 20 && h.state.phase === 'battle'; guard++) {
    const p = h.state.priority;
    if (p != null && legalActions(h.state, p).some(x => x.type === 'activateAbility' && x.entityId === obsBySeat[p])) { seat = p; break; }
    const atk = h.state.battle?.attacker;
    // a real attack (an empty one would skip the battle and its windows)
    const declare = atk != null && h.state.priority == null
      ? legalActions(h.state, atk).find(x => x.type === 'declareAttack' && x.columns.length > 0) : undefined;
    if (declare) h.do(declare); else if (p != null) pass(h); else break;
  }
  assert.ok(seat !== null && h.state.phase === 'battle', 'reached a battle window where the observer can be activated');
  const obs = obsBySeat[seat]!;
  assert.ok(ent(h, obs), 'the observer is still in play');
  const a = activation(h.state, seat, obs);
  assert.equal(undoAvailable(h.state, { spectating: false }), false, 'battle is not a step undo works in');
  show(h.state, seat);
  assert.ok(!ui.has({ btn: 'undo' }), 'and there is no ↶ undo button to say otherwise');
  ui.click({ act: 'unit', id: obs });
  assert.ok(ui.has({ btn: 'actconfirm' }), 'the "Yes, activate" bar is up');
  assert.deepEqual(ui.actions(), [], 'nothing is sent until it is answered');
  ui.click({ btn: 'actconfirm' });
  assert.deepEqual(ui.actions(), [a], 'and "Yes, activate" sends it');
});

test('one answer for the undo button and the bar: ui/undo.ts', () => {
  const src = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  assert.match(src, /const canUndo = undoAvailable\(h\.state, NET\);/, 'the ↶ button asks ui/undo.ts');
  assert.match(src, /function needsConfirm\([^)]*\): boolean \{\n(?:\s*\/\/.*\n)*\s*if \(undoAvailable\(h\.state, NET\)\) return false;/,
    'and so does the "Yes, activate" bar, before anything else');
  // a spectator, a replay and the ?demo board have no undo — and so keep the bar
  const h = new Harness(37303, ['Ann', 'Bo']);
  assert.equal(h.state.phase, 'planning');
  assert.equal(undoAvailable(h.state, { spectating: false }), true, 'planning (and its haste step) is undone too');
  toDeployment(h);
  assert.equal(undoAvailable(h.state, null), false, 'no connection');
  assert.equal(undoAvailable(h.state, { spectating: true }), false, 'a spectator');
});
