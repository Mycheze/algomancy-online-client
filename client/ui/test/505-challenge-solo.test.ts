/* docs/21 — a weekly challenge RUN in the page (ui/challengerun.ts over the
 * generalised ui/solo.ts), driven through ui/main.ts at `?challenge=play`.
 *
 *   §1 the page boots into the board with the meter layer, off the saved run
 *   §2 the dummy is strict: every one of its moves is `dummyMove`, so the log
 *      the browser would upload is the log the server accepts — verifyRun
 *      agrees with the meter on the score, action for action
 *   §3 reaching the goal raises the complete panel: the score, Export, Retry,
 *      and (signed out) the sign-in prompt with the run kept in this browser
 *   §4 signed in, the run is POSTed as {challengeId, deck, actions} and the
 *      reply's new bests and its rank on each board are shown
 *   §5 a saved run resumes to the same game; undo takes the goal back
 *   §6 Learn to Play's room is the room it was: no hook, no change (a
 *      refused bot move still falls back); only a STRICT room waits
 *
 * Seeds 50500-50599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import type { Action, GameState } from '../../engine/src/types.ts';
import type { ChallengeDef } from '../../engine/src/challenge.ts';

const DEF: ChallengeDef = { id: 'c505', week: '2026-10-18', title: 'Tiny', blurb: '', goal: { kind: 'unitsPlayed', n: 1 }, seed: 50500, par: 3 };
const SPARK = DECK_LIST.find(n => { const c = getCard(n); return c.kind === 'unit' && c.mana === 1 && c.timing === 'deploy' && (c.factions ?? []).join() === 'fire' && c.cost.length <= 1; })!;
const DECK = Array.from({ length: 12 }, () => SPARK);

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = `?challenge=play&id=${DEF.id}`;
g['__UI_DRIVER_STORE'] = { algoChallengeRun: JSON.stringify({ v: 1, def: DEF, deck: DECK, actions: [], by: [] }) };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/challenge/run') return { status: 200, json: async () => ({ ok: true, runId: 'r1', score: {}, improved: true, newBest: ['fastest', 'purest'], ranks: { fastest: 1, leanest: 3, purest: 2, overall: 2 } }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const chrun = await import('../challengerun.ts');
const { SoloServer } = await import('../solo.ts');
const { verifyRun } = await import('../../engine/src/challenge.ts');
const { fallbackMove, tutorialBotV1, CONSTRUCT } = await import('../bot.ts');

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/** a player that reaches "play one unit": recycle once a turn, turn the
 * resources on, play the first card offered */
function playerMove(legal: Action[], state: GameState, mem: { t?: number }): Action {
  const play = legal.find(a => a.type === 'playCard');
  if (play) return play;
  const rec = legal.find(a => a.type === 'recycleForResource');
  if (rec && mem.t !== state.turn) { mem.t = state.turn; return rec; }
  const on = legal.find(a => a.type === 'activateResource' || a.type === 'exchangePrismite');
  if (on) return on;
  return fallbackMove(legal) ?? legal[0]!;
}
function playToGoal(run: InstanceType<typeof chrun.ChallengeRun>): void {
  const mem: { t?: number } = {};
  for (let i = 0; i < 200 && !run.done && !run.failed; i++) run.server.act(playerMove(run.server.legal(), run.state, mem));
}

test('§1 the run page boots into the board with the meter', async () => {
  const ui = home();
  await flush();
  const run = chrun.currentRun();
  assert.ok(run, 'the saved run was picked up');
  assert.equal(run.def.id, DEF.id);
  const html = ui.html();
  assert.match(html, /class="chmeter"/);
  const strip = html.slice(html.indexOf('class="stickytop"'), html.indexOf('id="shareslot"'));
  assert.match(strip, /class="chmeter"/, 'the meter is a row of the sticky strip, so it covers nothing');
  assert.match(html, /Units played 0 \/ 1 · turn 1 · cards 0/);
  assert.match(html, /data-chal="giveup"/);
  assert.match(html, /data-chal="rewind"/);
  assert.match(html, /🧩 Tiny/, 'the board says which challenge this is');
});

test('§2 the dummy is strict, so the uploaded log is the log the server accepts', () => {
  const run = chrun.currentRun()!;
  playToGoal(run);
  assert.ok(run.done, 'non-vacuous: the goal was met');
  const actions = run.actions();
  const dummy = actions.filter(a => a.seat === 1);
  assert.ok(dummy.length > 0, 'non-vacuous: the dummy moved');
  const v = verifyRun(DEF, DECK, actions);
  assert.ok(v.ok, `the server would accept it: ${v.ok ? '' : v.error}`);
  assert.deepEqual(v.score, run.done.score, 'the panel shows the score the server will stamp');
  assert.equal(v.actions.length, actions.length, 'cut at the action that met the goal');
});

test('§3 the goal raises the complete panel; signed out, the run is kept', () => {
  const ui = home();
  const run = chrun.currentRun()!;
  const html = ui.html();
  assert.match(html, /Goal met/);
  for (const k of ['Turns', 'Cards', 'Elements']) {
    assert.match(html, new RegExp(`<div class="statval">${run.done!.score[k.toLowerCase() as 'turns']}</div><div class="statlab">${k}</div>`), `${k} as a stat cell`);
  }
  assert.ok(html.indexOf('>Turns<') < html.indexOf('>Cards<'), 'turns first: the hardest to cut');
  assert.doesNotMatch(html, /Skill/, 'no Skill: the boards rank the three numbers (owner, 2026-10-23)');
  assert.doesNotMatch(html, /Extra copies/, 'no extra copies, no cell for them');
  assert.match(html, /data-chal="export"/);
  assert.match(html, /data-chal="retry"/);
  assert.match(html, /data-chal="signin"/, 'a guest is asked to sign in');
  const kept = chrun.doneRuns();
  assert.equal(kept.length, 1, 'the run is kept in this browser');
  assert.deepEqual(kept[0]!.actions, run.actions());
  assert.equal(chrun.loadRun(), null, 'the run in progress is cleared once finished');
  ui.click({ chal: 'signin' });
  assert.equal((g['location'] as { search: string }).search, '?challenge=1&signin=1', 'Sign in goes to the sign-in form, over the challenge page');
});

test('§4 signed in, the run is posted and the reply shown', async () => {
  localStorage.setItem('algoToken', 'tok');
  const calls: { url: string; body: unknown }[] = [];
  const was = g['fetch'];
  g['fetch'] = async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return (was as (u: string) => Promise<unknown>)(url);
  };
  try {
    const run = new chrun.ChallengeRun(chrun.freshRun(DEF, DECK));
    playToGoal(run);
    await flush();
    const post = calls.find(c => c.url === '/api/challenge/run');
    assert.ok(post, 'posted');
    assert.deepEqual(post.body, { challengeId: DEF.id, deck: DECK, actions: run.actions() });
    assert.equal(run.submit.s, 'done');
    const html = chrun.layerHtml(run);
    assert.match(html, /New best: fastest, purest\. #1 fastest · #3 leanest · #2 purest · #2 overall\./);
  } finally {
    localStorage.removeItem('algoToken');
    g['fetch'] = was;
  }
});

test('§5 a saved run resumes to the same game, and undo takes the goal back', () => {
  const a = new chrun.ChallengeRun(chrun.freshRun(DEF, DECK));
  const mem: { t?: number } = {};
  for (let i = 0; i < 6; i++) a.server.act(playerMove(a.server.legal(), a.state, mem));
  const saved = chrun.loadRun()!;
  assert.ok(saved.actions.length > 6, 'the log is saved after every change');
  const b = new chrun.ChallengeRun(saved);
  assert.deepEqual(b.state, a.state, 'replayed to the same game');
  assert.equal(b.meterText(), a.meterText());
  playToGoal(b);
  assert.ok(b.done);
  b.server.undo();
  assert.equal(b.metAt, null, 'the goal is not met any more');
  assert.equal(b.done, null);
  assert.match(b.meterText(), /Units played 0 \/ 1/);
});

test('§6 Learn to Play keeps its room: a refused bot move still falls back, a strict one waits', () => {
  const fire = DECK_LIST.filter(n => getCard(n).kind === 'unit' && (getCard(n).factions ?? []).join() === 'fire');
  const deal = {
    seed: 50590, names: ['Learner', 'Tutorial Bot'] as [string, string],
    decks: [Array.from({ length: 30 }, (_, i) => fire[i % fire.length]!), Array(40).fill(CONSTRUCT)] as [string[], string[]],
    lesson: { openingHand: [4, 1] as [number, number], drawPerTurn: [2, 1] as [number, number], stacked: [false, false] as [boolean, boolean],
      shardsPerTurn: [0, 1] as [number, number], firstShardTurn: 1, shardState: 'open' as const, prismites: [2, 0] as [number, number], startingLife: [30, 30] as [number, number] },
  };
  // a bot whose every move is refused: Learn to Play's room reports it and falls back
  const stuck: string[] = [];
  const liar = { id: 'liar', name: 'Liar', choose: (_s: GameState, seat: 0 | 1) => ({ type: 'playCard', seat, handIndex: 99 }) as Action };
  const s = new SoloServer(deal, liar as never, undefined, { onBotStuck: why => stuck.push(why) });
  for (let i = 0; i < 40 && s.state.phase !== 'gameover' && s.state.turn < 3; i++) s.act(fallbackMove(s.legal())!);
  assert.ok(stuck.length > 0, 'non-vacuous: the bot was refused');
  assert.ok(s.state.turn >= 2, 'and the game went on: the room fell back');
  // the strict room, given the same liar, waits instead of moving for it
  const strict = new SoloServer(deal, liar as never, undefined, { strictBot: true, onBotStuck: why => stuck.push(`strict ${why}`) });
  for (let i = 0; i < 40 && strict.state.turn < 3; i++) { const l = strict.legal(); if (!l.length) break; strict.act(fallbackMove(l)!); }
  assert.ok(!stuck.some(w => w.startsWith('strict')), 'a strict room never falls back');
  assert.equal(strict.save.actions.filter(x => x.seat === 1).length, 0, 'a refused policy makes no move at all, not even a forced one');
  // the tutorial bot itself is unchanged in the default room
  const t = new SoloServer(deal, tutorialBotV1());
  assert.ok(t.state, 'deals');
});
