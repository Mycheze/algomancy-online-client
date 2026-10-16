/* BL-47 — "UNDO LAST PICK" IN AN ORDERED BURST IS ONE SERVER UNDO, AND THE
 * SERVER TAKES IT.
 *
 * The owner, relayed from Discord 2026-10-16: "there should be a way to
 * visually see what order you're chosing and then a way to undo that or cancel
 * and restart." For a {Burst} the client's "↶ Undo last pick" sends exactly
 * one `undo` (ui/test/358 §4). This file proves the other half: in BATTLE —
 * where undo is otherwise refused — the server accepts that one undo while the
 * ordered cast is still the caster's own pre-commit chain (CR D4.2: a cast not
 * yet on the stack may be cancelled; CR 803.5d: the caster orders the burst),
 * and it takes back exactly one step: the last pick, or the last aim.
 *
 * The board is built by LOGGED actions in a test-mode room (an undo rebuilds
 * from the log): Flame Juggle ("Create three Fireball 1.") cast in deployment,
 * then the next battle, where its caster holds priority with three tokens.
 *
 * Seed 48301: a battle where seat 0's tokens are castable (other seeds put the
 * battle in another region; the fixture asserts what it needs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forcedAction, legalActions } from '../../engine/src/apply.ts';
import type { Action, EntityId, Seat } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';

process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-483-'));
const R = await import('../rooms.ts');

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

/** read through a call, so an assertion on one step does not narrow the next */
const susOf = (room: Room): Room['state']['suspension'] => room.state.suspension;
const phaseOf = (room: Room): string => room.state.phase;
/** how many tokens a burstPick question has behind it, or null when none is open */
const aimedOf = (room: Room): number | null => {
  const sus = room.state.suspension;
  return sus?.type === 'burstPick' ? sus.aimed.length : null;
};

const tokens = (room: Room, seat: Seat): EntityId[] => Object.values(room.state.entities)
  .filter(e => e.kind === 'spellToken' && e.controller === seat).map(e => e.id);

/** a battle in which seat 0 holds priority with three Fireball 1 at home */
function burstBattle(code: string, seed: number): Room {
  const room = R.createRoom(code, seed, ['Rashi', 'Bena'], 'shared', undefined, undefined, 'sandbox');
  for (const s of [0, 1] as Seat[]) tick(room, { type: 'sandboxSpawn', seat: s, card: 'Good Whale', to: 'play' });
  tick(room, { type: 'sandboxSpawn', seat: 0, card: 'Flame Juggle', to: 'hand' });
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    if (room.state.hasteDone && !room.state.hasteDone[s]) tick(room, { type: 'doneHaste', seat: s });
  }
  for (let g = 0; g < 4 && phaseOf(room) === 'battle' && room.state.battle; g++) {
    tick(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  }
  assert.equal(phaseOf(room), 'deploy', 'the first battle is skipped');
  tick(room, { type: 'sandboxResources', seat: 0, pool: { fire: 3 } });
  tick(room, { type: 'playCard', seat: 0, handIndex: room.state.players[0]!.hand.indexOf('Flame Juggle') });
  for (let g = 0; g < 6 && room.state.decision; g++) {
    tick(room, { type: 'decide', seat: room.state.decision.seat, choice: 0 });
  }
  assert.equal(tokens(room, 0).length, 3, 'Flame Juggle made three Fireballs');
  // on to the next battle: every "done" the step offers, whoever offers it
  for (let g = 0; g < 12 && phaseOf(room) !== 'battle'; g++) {
    const a = ([0, 1] as Seat[]).flatMap(s => legalActions(room.state, s)).find(x => /^done/.test(x.type));
    if (!a) break;
    tick(room, a);
  }
  assert.equal(phaseOf(room), 'battle', 'the next battle');
  const att = room.state.battle!.attacker;
  const whale = Object.values(room.state.entities).find(e => e.card === 'Good Whale' && e.controller === att)!;
  tick(room, { type: 'declareAttack', seat: att, columns: [[whale.id]] });
  for (let g = 0; g < 6 && room.state.priority !== null && room.state.priority !== 0; g++) {
    tick(room, { type: 'passPriority', seat: room.state.priority });
  }
  assert.equal(room.state.priority, 0, 'the tokens’ controller holds priority');
  assert.equal(tokens(room, 0).length, 3, 'with all three tokens still in play');
  return room;
}

/** cast the burst as ORDERED — the token named by a castSpellToken the engine
 * itself offers, so the region is always one it can be cast in */
function castOrdered(room: Room): void {
  const offer = legalActions(room.state, 0).find(a => a.type === 'castSpellToken');
  assert.ok(offer && offer.type === 'castSpellToken', 'a token is castable');
  tick(room, { ...offer, ordered: true });
}

test('BL-47 one undo takes back the last pick of an ordered burst, and only that', () => {
  const room = burstBattle('B483A', 48301);
  castOrdered(room);
  assert.equal(susOf(room)?.type, 'burstPick', 'which resolves first?');
  tick(room, { type: 'decide', seat: 0, choice: 1 });
  assert.equal(susOf(room)?.type, 'cast', 'picked: now it is aimed');
  const before = room.actions.length;

  const out = R.undoForSeat(room, 0);
  assert.deepEqual(out, { ok: true }, 'the server takes the undo in battle');
  assert.equal(room.actions.length, before - 1, 'exactly one action came off the log');
  assert.equal(susOf(room)?.type, 'burstPick', 'back at "which resolves first?"');
  assert.equal(aimedOf(room), 0, 'with nothing picked');
  assert.equal(room.state.stack.length, 0, 'and nothing went on the stack');
});

test('BL-47 one undo takes back the last aim, leaving the earlier pick standing', () => {
  const room = burstBattle('B483B', 48301);
  castOrdered(room);
  tick(room, { type: 'decide', seat: 0, choice: 0 });             // #1 picked
  const aim = room.state.decision!;
  assert.equal(susOf(room)?.type, 'cast');
  tick(room, { type: 'decide', seat: 0, choice: aim.options.findIndex(o => o.value && typeof o.value === 'object' && 'player' in o.value) });
  assert.equal(susOf(room)?.type, 'burstPick', '#1 aimed: which resolves second?');
  assert.equal(aimedOf(room), 1);

  assert.deepEqual(R.undoForSeat(room, 0), { ok: true });
  assert.equal(susOf(room)?.type, 'cast', 'back to aiming #1');
  const sus = susOf(room);
  assert.ok(sus?.type === 'cast' && sus.item.burstRest, 'still inside the same burst');
  assert.equal(sus?.type === 'cast' && sus.item.burstRest!.aimed.length, 0, 'with #1 the one being aimed');
});

test('BL-47 the opponent cannot reach into the burst with an undo', () => {
  const room = burstBattle('B483C', 48301);
  castOrdered(room);
  tick(room, { type: 'decide', seat: 0, choice: 1 });
  const log = JSON.stringify(room.actions);
  const out = R.undoForSeat(room, 1);
  assert.equal(out.ok, false, 'refused');
  assert.equal(JSON.stringify(room.actions), log, 'and the log is untouched');
});
