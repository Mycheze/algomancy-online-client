/* 612 — WEEKLY CHALLENGE: THE ACTION THAT MEETS THE GOAL AND ENDS THE GAME (CT-353).
 *
 * The browser (ui/challengerun.ts) sets metAt the moment the goal is met and
 * calls a run failed only when metAt is still null at game over, so a
 * goal-meeting action that also ended the game read "Goal met" and was
 * submitted. The server's verifyRun (engine/src/challenge.ts) judged the game
 * over FIRST and refused it, "even if the goal was met by the very action that
 * ended it" — a 422 that Try again could never get past.
 *
 * docs/21 ends the run "at the first action after which the goal is met" and
 * does not separate the two cases, so the permissive reading is taken: it
 * counts, on both sides.
 *
 * No current goal comes near killing a 99-life dummy, so the game over is
 * SIMULATED: one real scripted run reaches its goal, and then the board after
 * that same action is marked game over — in the browser's live state, and in
 * verifyRun's walk through its `onStep` hook, which sees the board after each
 * action before it is judged.
 *
 *   §1 ⭐ read in both: the browser says Goal met and not failed, and the
 *      server accepts the same log with the same score
 *   §2 a game that ends one action BEFORE the goal is still refused, with
 *      the index, and the browser calls that run failed
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import type { Action, GameState } from '../../engine/src/types.ts';
import type { ChallengeDef } from '../../engine/src/challenge.ts';

const DEF: ChallengeDef = { id: 'c612', week: '2026-10-25', title: 'Tiny', blurb: '', goal: { kind: 'unitsPlayed', n: 1 }, seed: 61200, par: 3 };
const SPARK = DECK_LIST.find(n => { const c = getCard(n); return c.kind === 'unit' && c.mana === 1 && c.timing === 'deploy' && (c.factions ?? []).join() === 'fire' && c.cost.length <= 1; })!;
const DECK = Array.from({ length: 12 }, () => SPARK);

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = {};
await import('./ui-driver.ts');
const chrun = await import('../challengerun.ts');
const { verifyRun, PLAYER } = await import('../../engine/src/challenge.ts');
const { fallbackMove } = await import('../bot.ts');

/** the 505 player: recycle once a turn, turn the resources on, play the first card offered */
function playerMove(legal: Action[], state: GameState, mem: { t?: number }): Action {
  const play = legal.find(a => a.type === 'playCard');
  if (play) return play;
  const rec = legal.find(a => a.type === 'recycleForResource');
  if (rec && mem.t !== state.turn) { mem.t = state.turn; return rec; }
  const on = legal.find(a => a.type === 'activateResource' || a.type === 'exchangePrismite');
  if (on) return on;
  return fallbackMove(legal) ?? legal[0]!;
}

/** mark a board as a finished game, as the engine's own ending does */
const endGame = (s: GameState): void => { s.phase = 'gameover'; s.winner = PLAYER; };

const run = new chrun.ChallengeRun(chrun.freshRun(DEF, DECK));
const mem: { t?: number } = {};
for (let i = 0; i < 200 && !run.done && !run.failed; i++) run.server.act(playerMove(run.server.legal(), run.state, mem));
assert.ok(run.done && run.metAt !== null, 'fixture: the scripted run met its goal');
const LOG = run.actions();
const MET = LOG.length - 1;   // the index of the action that met the goal
const clean = verifyRun(DEF, DECK, LOG);
assert.ok(clean.ok, 'fixture: the server accepts the run as it was played');

test('§1 CT-353: a goal met by the action that ends the game counts, in the browser and on the server', () => {
  endGame(run.state);
  assert.equal(run.failed, false, 'the browser does not call it failed');
  assert.match(chrun.layerHtml(run), /Goal met/, 'and shows the complete panel');
  const v = verifyRun(DEF, DECK, LOG, { onStep: (i, after) => { if (i === MET) endGame(after); } });
  assert.ok(v.ok, `⭐ the server refuses what the browser submitted: ${v.ok ? '' : v.error}`);
  assert.deepEqual(v.score, clean.ok && clean.score, 'with the score the run would have had anyway');
  assert.deepEqual(v.score, run.done!.score, 'which is the score the browser showed');
  assert.equal(v.actions.length, LOG.length);
});

test('§2 CT-353: a game that ends one action before the goal is still a failed run, on both sides', () => {
  const v = verifyRun(DEF, DECK, LOG, { onStep: (i, after) => { if (i === MET - 1) endGame(after); } });
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.at, MET - 1);
  assert.match(!v.ok ? v.error : '', /ended before the goal was met/);
  const early = new chrun.ChallengeRun(chrun.freshRun(DEF, DECK));
  const m2: { t?: number } = {};
  for (let i = 0; i < 200 && early.server.save.actions.length < MET; i++) early.server.act(playerMove(early.server.legal(), early.state, m2));
  assert.equal(early.metAt, null, 'fixture: one short of the goal');
  endGame(early.state);
  assert.equal(early.failed, true, 'the browser calls it failed');
});
