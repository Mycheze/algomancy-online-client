/* THE RESTART FORK FALSE ALARM — R191's keys must survive a new process.
 *
 * R191 writes, per action, a REFERENCE KEY (what the action pointed at when it
 * was taken) and a restore compares it with what the same action means after
 * the rebuild: a difference is a game that "was restored onto changed rules".
 * The key names an entity by the action that created it — and that action was
 * named by `tagOf`, a counter that starts at 1 in every server process and
 * counts in whatever order the process meets actions. So every restart read
 * every unit made mid-game as a different unit, recorded a fork and posted
 * "restored onto changed rules" into live games that had not changed at all
 * (game ZDAY 2026-09-23; game KEMX at the 07:42 restart on 2026-10-04, saved
 * keys `t76#1`).
 *
 * The fix keeps the tags for what they are right for — comparing two rebuilds
 * inside ONE process across an undo splice — and persists a second key with
 * the creating action named by its POSITION in the log (`posRefs`), which is
 * what a restore now compares. This file:
 *
 *   §1  the same saved game restored ALONE in a new process: no drift
 *   §2  …and restored after two other rooms in the same process: no drift
 *       (each with the proof that the tag keys DID move, so the old
 *       comparison would have forked)
 *   §3  a genuinely re-pointed action is still caught
 *   §4  a file with only the old `refs` is not compared at all
 *
 * The game is built from logged test-mode actions (BL-06 sandbox): a Lilbot is
 * summoned mid-game and a later activation names it, which is exactly the
 * reference the tags got wrong.
 *
 * Seeds: 37500-37599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forcedAction } from '../../engine/src/apply.ts';
import type { Action, EntityId, Seat } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';

type Rooms = typeof import('../rooms.ts');
/** a server process over `dir`: a fresh copy of the module, so a fresh tag
 * counter, reading ALGO_GAMES_DIR as it loads */
async function processAt(dir: string): Promise<Rooms> {
  process.env['ALGO_GAMES_DIR'] = dir;
  return import(`../rooms.ts?r375=${Math.random()}`) as Promise<Rooms>;
}
const scratch = (): string => mkdtempSync(join(tmpdir(), 'algo-375-'));

function tick(mod: Rooms, room: Room, a: Action): void {
  const was = room.segKey;
  mod.applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    mod.applyToRoom(room, f);
  }
  if (mod.segmentKey(room.state) !== was) mod.openSegment(room);
}

interface Played { code: string; activation: number; lilbots: EntityId[] }

/**
 * Play a game into deployment in which seat P activates a Lilbot that was
 * SUMMONED mid-game (so its key names "the entity action k created"), and
 * answer the glimpse. Two Lilbots each, so §3 has another unit to re-point to.
 */
function play(mod: Rooms, code: string, seed: number): Played {
  const room = mod.createRoom(code, seed, ['Rashi', 'Bena'], 'shared', undefined, undefined, 'sandbox');
  for (const s of [0, 1] as Seat[]) {
    tick(mod, room, { type: 'sandboxSpawn', seat: s, card: 'Lilbot', to: 'play' });
    tick(mod, room, { type: 'sandboxSpawn', seat: s, card: 'Lilbot', to: 'play' });
    for (let k = 0; k < 2; k++) tick(mod, room, { type: 'sandboxSpawn', seat: s, card: 'Ignis Sprite', to: 'hand' });
  }
  tick(mod, room, { type: 'donePlanning', seat: 0 });
  tick(mod, room, { type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    if (room.state.hasteDone && !room.state.hasteDone[s]) tick(mod, room, { type: 'doneHaste', seat: s });
  }
  for (let g = 0; g < 4 && room.state.phase === 'battle' && room.state.battle; g++) {
    tick(mod, room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  }
  assert.equal(room.segKey, 'deploy', 'premise: the game reached deployment');
  const P = room.state.deployPlayer as Seat;
  const lilbots = Object.values(room.state.entities)
    .filter(e => e.card === 'Lilbot' && e.controller === P).map(e => e.id).sort((a, b) => a - b);
  assert.equal(lilbots.length, 2);
  tick(mod, room, { type: 'activateAbility', seat: P, entityId: lilbots[0]!, abilityIndex: 0, via: 'augment' });
  const activation = room.actions.length - 1;
  tick(mod, room, { type: 'decide', seat: P, choice: room.state.decision!.options.findIndex(o => o.label.startsWith('Discard')) });
  tick(mod, room, { type: 'decide', seat: P, choice: 0 });
  return { code, activation, lilbots };
}

interface SavedFile { actions: Action[]; refs?: string[]; posRefs?: string[]; forks?: unknown[] }
const readGame = (dir: string, code: string): SavedFile =>
  JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')) as SavedFile;

/** The writing process: other rooms first (so its tags are not the ones a
 * fresh process would hand out), then the game under test. Returns its dir. */
async function written(seed: number): Promise<{ dir: string; game: Played }> {
  const dir = scratch();
  const A = await processAt(dir);
  play(A, 'QQQ0', seed + 50);              // an earlier game in the same process…
  unlinkSync(join(dir, 'QQQ0.json'));      // …that is over and gone by the restart
  const game = play(A, 'ZZZ1', seed);
  const file = readGame(dir, 'ZZZ1');
  assert.equal(file.posRefs?.length, file.actions.length, 'the file records one position key per action');
  assert.match(file.posRefs![game.activation]!, /^activateAbility\|\d+#0\|/,
    'premise: the activation names a unit by the position of the action that summoned it');
  return { dir, game };
}

function assertClean(back: Room | undefined, file: SavedFile, game: Played): void {
  assert.ok(back, 'the room came back');
  assert.equal(back.lost.length, 0, 'nothing refused');
  assert.notEqual(back.segRefs[game.activation], file.refs![game.activation],
    'premise: the process-local tag key DID move (the old comparison would have forked here)');
  assert.equal(back.segPosRefs[game.activation], file.posRefs![game.activation], 'the position key did not');
  assert.deepEqual(back.drifted, [], 'no action reported as changed');
  assert.equal(back.forks.length, 0, 'no fork recorded');
  assert.ok(!back.events.some(e => /refer to something else|changed rules/.test(e.msg)),
    'and nobody is told the game was restored onto changed rules');
}

test('F §1: a saved game restored ALONE in a new process reports no drift', async () => {
  const { dir, game } = await written(37501);
  const file = readGame(dir, 'ZZZ1');
  const B = await processAt(dir);
  B.restoreRooms();
  assertClean(B.getRoom('ZZZ1'), file, game);
});

test('F §2: …and restored after two other rooms in the same process, no drift either', async () => {
  const { dir, game } = await written(37502);
  const file = readGame(dir, 'ZZZ1');
  // two other games, written by yet another process, are restored FIRST
  const others = scratch();
  const X = await processAt(others);
  play(X, 'AAA1', 37511);
  play(X, 'AAA2', 37512);
  const C = await processAt(others);
  C.restoreRooms();
  assert.ok(C.getRoom('AAA1') && C.getRoom('AAA2'), 'premise: the two other rooms are restored');
  copyFileSync(join(dir, 'ZZZ1.json'), join(others, 'ZZZ1.json'));
  C.restoreRooms();                        // the same process, later in its life
  assertClean(C.getRoom('ZZZ1'), file, game);
});

test('F §3: an action genuinely re-pointed at another unit is still reported', async () => {
  const { dir, game } = await written(37503);
  const file = readGame(dir, 'ZZZ1');
  const act = file.actions[game.activation] as Extract<Action, { type: 'activateAbility' }>;
  assert.equal(act.entityId, game.lilbots[0]);
  act.entityId = game.lilbots[1]!;         // the same ability, on the OTHER Lilbot
  writeFileSync(join(dir, 'ZZZ1.json'), JSON.stringify(file));
  const B = await processAt(dir);
  B.restoreRooms();
  const back = B.getRoom('ZZZ1')!;
  assert.equal(back.lost.length, 0, 'premise: the re-pointed action still replays (it is drift, not a refusal)');
  assert.ok(back.drifted.some(l => l.i === game.activation && l.kind === 'changed'),
    'the activation is reported as now meaning something else');
  assert.equal(back.forks.length, 1, 'and the file records the fork');
});

test('F §4: a file with only the old `refs` is not compared — silence, not a fork', async () => {
  const { dir, game } = await written(37504);
  const file = readGame(dir, 'ZZZ1');
  delete file.posRefs;                     // a file written before the field existed…
  const act = file.actions[game.activation] as Extract<Action, { type: 'activateAbility' }>;
  act.entityId = game.lilbots[1]!;         // …even one that really did drift
  writeFileSync(join(dir, 'ZZZ1.json'), JSON.stringify(file));
  const B = await processAt(dir);
  B.restoreRooms();
  const back = B.getRoom('ZZZ1')!;
  assert.ok(Array.isArray(file.refs), 'premise: the old keys are still in the file');
  assert.deepEqual(back.drifted, [], 'its process-local keys are not evidence of anything');
  assert.equal(back.forks.length, 0, 'so no fork is invented');
  assert.equal(back.segPosRefs.length, back.actions.length,
    'and the room holds position keys of its own, for the next write to record');
});
