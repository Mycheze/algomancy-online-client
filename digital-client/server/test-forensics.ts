/* Are the saved game logs a reliable forensic record? (run: node test-forensics.ts)
 *
 * The playtest loop reviews bugs by replaying server/games/<CODE>.json. That
 * only works if the file's claim — seed + actions reproduces this game — is
 * either true or says why not. Game UZRG rejected 79 of its 276 actions when
 * replayed on the engine it was played on, and nothing in the file explained
 * it.
 *
 * This drives the whole failure: a live room restored onto a changed engine,
 * the cascade one skip causes, the fork record that now marks it, and the
 * guarantee that an undo can never quietly cost somebody a move.
 *
 * Runs against a throwaway ALGO_GAMES_DIR — it never touches real games.
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(tmpdir(), `algo-forensics-${process.pid}`);
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
process.env['ALGO_GAMES_DIR'] = DIR;

const { apply, createGame, forcedAction, legalActions, sanitizeTrio, IllegalAction } =
  await import('../engine/src/apply.ts');
const { applyToRoom, createRoom, getRoom, restoreRooms, undoActionAt } = await import('./rooms.ts');
import type { Action, GameState } from '../engine/src/types.ts';
import type { Room } from './rooms.ts';

let failures = 0;
const ok = (cond: unknown, label: string): void => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
};

const SEED = 424242;
const NAMES: [string, string] = ['Player 1', 'Player 2'];
const FILE = join(DIR, 'FORK.json');

/** apply + drain forced steps, exactly like main.ts */
function act(room: Room, a: Action): void {
  applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    applyToRoom(room, f);
  }
}

/** the mundane move for whichever step we are in */
function mundane(state: GameState, seat: 0 | 1): Action | null {
  const L = legalActions(state, seat);
  return L.find(x => x.type === 'recycleForResource')
    ?? L.find(x => x.type === 'activateResource')
    ?? L.find(x => x.type === 'donePlanning') ?? L.find(x => x.type === 'doneHaste')
    ?? L.find(x => x.type === 'declareAttack') ?? L.find(x => x.type === 'declareBlocks')
    ?? L.find(x => x.type === 'passPriority') ?? L.find(x => x.type === 'doneDeploying') ?? null;
}

/** replay a log from scratch the way replay-room.ts does */
function replay(actions: Action[]): { skips: number[]; state: GameState } {
  let st = createGame(SEED, NAMES, 'shared', sanitizeTrio(undefined)).state;
  const skips: number[] = [];
  actions.forEach((a, i) => {
    try { st = apply(st, a).state; }
    catch (err) { if (err instanceof IllegalAction) skips.push(i); else throw err; }
  });
  return { skips, state: st };
}

// ══ 1. a clean game is a faithful record ══════════════════════════════
console.log('\n[a clean log is a true record]');
const room = createRoom('FORK', SEED);
for (let i = 0; i < 200 && room.actions.length < 60; i++) {
  const a = mundane(room.state, 0) ?? mundane(room.state, 1);
  if (!a) break;
  act(room, a);
}
ok(room.actions.length >= 60, `played a clean game (${room.actions.length} actions, turn ${room.state.turn})`);
ok(replay(room.actions).skips.length === 0, 'every logged action replays');
ok(room.forks.length === 0 && room.lost.length === 0, 'and the room declares no fork');
ok(!('forks' in JSON.parse(readFileSync(FILE, 'utf8'))), 'the file carries no fork field');
const cleanTurn = room.state.turn, cleanLen = room.actions.length;

// ══ 2. a rules change under a LIVE room: the cascade ══════════════════
console.log('\n[a rules change under a live room]');
// simulate one action becoming illegal — which is all an engine change looks
// like from rebuild()'s side: apply() throws IllegalAction at some index
const raw = JSON.parse(readFileSync(FILE, 'utf8')) as { actions: Action[] };
const victim = raw.actions.findIndex(a => a.type === 'donePlanning');
raw.actions[victim] = { type: 'activateResource', seat: raw.actions[victim]!.seat, index: 99 };
writeFileSync(FILE, JSON.stringify(raw));
const cascade = replay(raw.actions).skips.length;
ok(cascade > 1, `ONE action becoming illegal cascades into ${cascade} of ${cleanLen} rejections`);

console.log('\n[the restore records the fork instead of degrading quietly]');
restoreRooms();
const r2 = getRoom('FORK')!;
ok(!!r2, 'the live game SURVIVED the restart — it is not lost, which is the point');
ok(r2.actions.length === cleanLen, 'nothing was pruned: the log is still the whole record');
ok(r2.lost.length === cascade, `the room knows it lost ${r2.lost.length} actions`);
ok(r2.state.turn < cleanTurn, `and that the game rolled back (turn ${cleanTurn} → ${r2.state.turn})`);
ok(r2.forks.length === 1, 'exactly one fork was recorded');
ok(r2.forks[0]!.lost.length === cascade && r2.forks[0]!.turn === r2.state.turn,
  'the fork records what was lost and where the game resumed');
ok(typeof r2.forks[0]!.at === 'string' && !Number.isNaN(Date.parse(r2.forks[0]!.at)),
  'stamped with when it happened');
const saved = JSON.parse(readFileSync(FILE, 'utf8')) as { forks?: unknown[] };
ok(Array.isArray(saved.forks) && saved.forks.length === 1, 'and it is in the FILE, not just in memory');
ok(r2.events.some(e => /could not be fully restored/.test(e.msg)),
  'the players are told, in the game log they can actually see');

console.log('\n[play continues, and the boundary is marked]');
const next = mundane(r2.state, 0) ?? mundane(r2.state, 1);
ok(!!next, 'the rebuilt board is playable');
if (next) {
  act(r2, next);
  ok(r2.actions.length === cleanLen + 1, 'the new action was accepted and logged');
  const after = JSON.parse(readFileSync(FILE, 'utf8')) as { actions: Action[]; forks: unknown[] };
  ok(after.actions.length === cleanLen + 1 && after.forks.length === 1,
    'the file holds both halves AND the record of where they join');
}

console.log('\n[restarting again does not invent a second fork]');
restoreRooms();
const r3 = getRoom('FORK')!;
ok(r3.forks.length === 1, 'the same loss under the same engine is ONE fork, not one per boot');

// ══ 3. a FINISHED game is left alone ══════════════════════════════════
console.log('\n[a finished game is read-only forensics, not a fork]');
// (the ~650 "replay skipped" warnings on a real boot are these; recording a
// fork for each would rewrite hundreds of settled files every restart)
const done = createRoom('DONE', SEED);
act(done, { type: 'concede', seat: 1 });
const doneRaw = JSON.parse(readFileSync(join(DIR, 'DONE.json'), 'utf8')) as { actions: Action[] };
doneRaw.actions.unshift({ type: 'activateResource', seat: 0, index: 99 });
writeFileSync(join(DIR, 'DONE.json'), JSON.stringify(doneRaw));
restoreRooms();
const d2 = getRoom('DONE')!;
ok(d2.lost.length > 0, 'its log does not fully replay');
ok(d2.forks.length === 0, 'but no fork is recorded — nobody is going to play into it');
ok(!('forks' in (JSON.parse(readFileSync(join(DIR, 'DONE.json'), 'utf8')) as object)),
  'and its file was not rewritten');

// ══ 4. an undo can never silently cost somebody a move ════════════════
console.log('\n[undo measures, and rolls itself back]');
const u = createRoom('UNDO', SEED);
act(u, { type: 'donePlanning', seat: 0 });
act(u, { type: 'donePlanning', seat: 1 });
for (const s of [0, 1] as const) {
  u.state.players[s]!.resources.push({ kind: 'fire', state: 'open' });
  u.state.players[s]!.resources.push({ kind: 'fire', state: 'open' });
  u.state.players[s]!.hand.push('Ignis Sprite');
}
act(u, { type: 'playCard', seat: 1, handIndex: u.state.players[1]!.hand.length - 1 });
const theirPlay = u.actions.length - 1;
act(u, { type: 'playCard', seat: 0, handIndex: u.state.players[0]!.hand.length - 1 });
const myUnit = Object.values(u.state.entities).find(e => e.controller === 0 && e.kind === 'unit')!;
act(u, { type: 'doneDeploying', seat: 0 });
act(u, { type: 'doneDeploying', seat: 1 });
act(u, { type: 'donePlanning', seat: 0 });
act(u, { type: 'donePlanning', seat: 1 });
// an action that names an ENTITY ID — the thing a renumbering breaks
const attack: Action = { type: 'declareAttack', seat: 0, columns: [[myUnit.id]] };
let attacked = false;
try { act(u, attack); attacked = true; } catch { /* not seat 0's declare */ }
ok(attacked, `logged an action naming entity ${myUnit.id} (${myUnit.card})`);
if (attacked) {
  // (the state itself cannot be compared here: this room was set up with
  // test-only injections that are not in the action log, so a rebuild can
  // never reproduce it. The log is what the roll-back has to protect, and the
  // clean-room case below checks state restoration properly.)
  const beforeLog = JSON.stringify(u.actions);
  const refused = undoActionAt(u, theirPlay);
  ok(refused.length > 0,
    'undoing an earlier play that would renumber it is REFUSED, not silently taken');
  ok(JSON.stringify(u.actions) === beforeLog,
    'and the log is put back exactly as it was — nothing was spliced out');
  ok(u.actions[theirPlay]!.type === 'playCard', 'the action it tried to remove is still there');
  ok(u.forks.length === 0, 'no fork: nothing was lost, because nothing was dropped');
}

// ══ 5. an ordinary undo keeps the log a true record ═══════════════════
console.log('\n[an accepted undo leaves a replayable log]');
const c = createRoom('CLEAN', SEED);
for (let i = 0; i < 40 && c.actions.length < 12; i++) {
  const a = mundane(c.state, 0) ?? mundane(c.state, 1);
  if (!a) break;
  act(c, a);
}
const beforeLen = c.actions.length;
const beforeState = JSON.stringify(c.state);
const accepted = undoActionAt(c, beforeLen - 1);
ok(accepted.length === 0, 'undoing the tail is accepted');
ok(c.actions.length === beforeLen - 1, 'the action left the log');
ok(JSON.stringify(c.state) !== beforeState, 'and the state moved back with it');
ok(replay(c.actions).skips.length === 0, 'the log still replays with zero skips');
ok(c.lost.length === 0 && c.forks.length === 0, 'and the room is still fork-free');

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
rmSync(DIR, { recursive: true, force: true });
void HERE;
process.exit(failures ? 1 : 0);
