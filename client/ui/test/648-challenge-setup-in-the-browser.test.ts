/* 648 — WEEKLY CHALLENGE: A ROW'S SETUP AND A GOAL THAT CAN FAIL, IN THE BROWSER
 * (ui/challengerun.ts; engine/src/challenge.ts setup, runFailed).
 *
 * A row's `setup` (the dummy's starting life, an emblem) is part of the deal:
 * the browser must deal it exactly as the server's verifyRun will, and a bug
 * report must carry it, or the run replays as a different game. One and Done
 * (a 60-life dummy, oneShot) is the first goal that can FAIL a run while the
 * game goes on: the browser must stop it and say why, as verifyRun refuses it.
 *
 *   §1 the browser deals the row's setup: the dummy on 60 life
 *   §2 a hit the dummy lives through: the run is failed, the panel says why,
 *      and the server's verifyRun refuses the same log at the same action
 *   §3 the report attachment carries the setup
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import type { Action, CardName, GameState } from '../../engine/src/types.ts';
import type { ChallengeDef } from '../../engine/src/challenge.ts';

const DEF: ChallengeDef = { id: 'c648', week: '2026-12-06', title: 'One', blurb: '', goal: { kind: 'oneShot' }, seed: 64800, par: 3, setup: { dummyLife: 60 } };
const DECK: CardName[] = Array.from({ length: 12 }, () => 'Crumbling Ancient');

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = {};
await import('./ui-driver.ts');
const chrun = await import('../challengerun.ts');
const { verifyRun, DUMMY } = await import('../../engine/src/challenge.ts');
const { fallbackMove } = await import('../bot.ts');

/** play the Ancients, open earth, attack with one unit whenever there is one */
function playerMove(legal: Action[], state: GameState, mem: { t?: number }): Action {
  const play = legal.find(a => a.type === 'playCard');
  if (play) return play;
  const atk = legal.find(a => a.type === 'declareAttack' && a.columns.length === 1);
  if (atk) return atk;
  const rec = legal.find(a => a.type === 'recycleForResource' && a.element === 'earth');
  if (rec && mem.t !== state.turn && state.turn > 1) { mem.t = state.turn; return rec; }
  const on = legal.find(a => a.type === 'activateResource' || (a.type === 'exchangePrismite' && a.element === 'earth'));
  if (on) return on;
  return fallbackMove(legal) ?? legal[0]!;
}

const run = new chrun.ChallengeRun(chrun.freshRun(DEF, DECK));

test('§1 the browser deals the row setup: the dummy starts on 60', () => {
  assert.equal(run.state.players[DUMMY]!.life, 60);
});

test('§2 a hit the dummy lives through fails the run, in the browser and on the server', () => {
  const mem: { t?: number } = {};
  for (let i = 0; i < 400 && !run.done && !run.failed; i++) run.server.act(playerMove(run.server.legal(), run.state, mem));
  assert.equal(run.failed, true, 'the run is failed');
  assert.equal(run.done, null);
  assert.ok(run.state.phase !== 'gameover' && run.state.players[DUMMY]!.life < 60, 'while the game goes on');
  assert.match(chrun.layerHtml(run), /Run failed/);
  assert.match(chrun.layerHtml(run), /lost life and lived/, 'and the panel says why');
  const v = verifyRun(DEF, DECK, run.server.save.actions);
  assert.ok(!v.ok && /lost life and lived/.test(v.error), 'the server refuses the same log');
});

test('§3 a report from the run carries the setup', () => {
  const att = chrun.reportAttachment(run);
  assert.deepEqual(att.def.setup, { dummyLife: 60 });
});
