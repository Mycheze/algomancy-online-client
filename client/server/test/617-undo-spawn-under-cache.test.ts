/* 617 — CT-199: UNDOING A SPAWN IS NOT REFUSED BECAUSE THE OPPONENT CACHED A CARD AFTER IT.
 *
 * In a hidden step you make a play that allocates entity ids (any spawn), then
 * your opponent caches a card (a glimpse). Taking your play back was refused
 * with "taking that back would change what a move made after it refers to":
 * the reference key of their move writes the cached card whole, `uid` and all,
 * and a cached card's uid comes off the same id clock the spawn ticked — so the
 * splice moved it by exactly the block of ids the spawn had allocated, and the
 * comparison read that as their move meaning something else. Nothing about
 * their move had changed.
 *
 * The fix compares the old keys with their cache uids renumbered the way the
 * splice renumbers entity ids (rooms.ts `renumberRefUids`). Nothing written to
 * a file changes: the keys on disk keep the uid, which the card ledger and the
 * restore's drift check read.
 *
 *   §1  the case the ticket names: spawn, their glimpse caches a card, undo — allowed,
 *       and their cached card comes through the splice as the same card
 *   §2  only the uids the splice moved are forgiven: one inside the spliced
 *       block (a card the taken-back move itself cached) or below it is left
 *       as written, so the compare still sees a card that no longer exists
 *
 * Board: test 374's deployment sandbox (Lilbot + Ignis Sprites), seeds 61700-61799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forcedAction } from '../../engine/src/apply.ts';
import type { Action, CardName, EntityId, Seat } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-617-'));
process.env['ALGO_GAMES_DIR'] = DIR;
type Rooms = typeof import('../rooms.ts');
const R = await import(`../rooms.ts?r617=${Math.random()}`) as Rooms;
const { SEEN_REFUSAL } = await import('../seen.ts');

const NAMES: [string, string] = ['Rashi', 'Bena'];

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

const lilbotOf = (room: Room, seat: Seat): EntityId =>
  Object.values(room.state.entities).find(e => e.card === 'Lilbot' && e.controller === seat)!.id;

/** the hidden deployment step, both seats with a Lilbot, sprites in hand and fire */
function deploying(code: string, seed: number): { room: Room; P: Seat; O: Seat } {
  const room = R.createRoom(code, seed, [...NAMES], 'shared', undefined, undefined, 'sandbox');
  for (const s of [0, 1] as Seat[]) {
    tick(room, { type: 'sandboxSpawn', seat: s, card: 'Lilbot', to: 'play' });
    for (let k = 0; k < 3; k++) tick(room, { type: 'sandboxSpawn', seat: s, card: 'Ignis Sprite', to: 'hand' });
  }
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    if (room.state.hasteDone && !room.state.hasteDone[s]) tick(room, { type: 'doneHaste', seat: s });
  }
  for (let g = 0; g < 4 && room.state.phase === 'battle' && room.state.battle; g++) {
    tick(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  }
  assert.equal(room.segKey, 'deploy', 'the room is inside the hidden deployment step');
  for (const s of [0, 1] as Seat[]) tick(room, { type: 'sandboxResources', seat: s, pool: { fire: 3 } });
  const P = room.state.deployPlayer as Seat;
  return { room, P, O: P === 0 ? 1 : 0 };
}

const spawnSprite = (room: Room, seat: Seat): void => {
  const i = room.state.players[seat]!.hand.indexOf('Ignis Sprite');
  assert.ok(i >= 0, 'an Ignis Sprite in hand');
  tick(room, { type: 'playCard', seat, handIndex: i });
};

/** Lilbot's Glimpse 2, paid by discarding; caches option `pick` */
function glimpseAndCache(room: Room, seat: Seat, pick: number): CardName[] {
  tick(room, { type: 'activateAbility', seat, entityId: lilbotOf(room, seat), abilityIndex: 0, via: 'augment' });
  const cost = room.state.decision!;
  tick(room, { type: 'decide', seat, choice: cost.options.findIndex(o => o.label.startsWith('Discard')) });
  const ask = room.state.decision!;
  assert.ok(ask && ask.seat === seat && /Glimpse 2/.test(ask.prompt), 'the Glimpse 2 question is open');
  const top = ask.options.map(o => o.card!);
  tick(room, { type: 'decide', seat, choice: pick });
  return top;
}

test('CR D4.1a / CT-199: undoing your spawn is allowed after the opponent cached a card off the shared deck', () => {
  const { room, P, O } = deploying('R617A', 61701);
  const idsBefore = room.state.nextId;
  spawnSprite(room, P);
  assert.ok(room.state.nextId > idsBefore, 'the spawn allocated ids — the case the ticket is about');
  const top = glimpseAndCache(room, O, 0);
  const cached = room.state.players[O]!.cache!.at(-1)!;
  assert.equal(cached.card, top[0], 'they cached the card they chose');
  assert.equal(typeof cached.uid, 'number', 'the cached card carries a uid off the id clock');

  const n = room.actions.length;
  assert.deepEqual(R.undoForSeat(room, P), { ok: true },
    'their move is unchanged by your take-back, so your take-back is allowed');
  assert.equal(room.actions.length, n - 1, 'your spawn left the log');
  assert.ok(!Object.values(room.state.entities).some(e => e.card === 'Ignis Sprite' && e.controller === P),
    'and your sprite left the board');
  const after = room.state.players[O]!.cache!.at(-1)!;
  assert.equal(after.card, top[0], 'their cached card came through the splice as the same card');
  assert.notEqual(after.uid, cached.uid, 'under a uid the splice moved — the very shift that used to refuse it');
  assert.deepEqual(R.undoForSeat(room, O), { ok: false, why: SEEN_REFUSAL }, 'while they stay locked by their own peek');
});

test('CT-199: only the uids the splice moved are forgiven — a card the taken-back move cached still differs', () => {
  // ids [40, 43) were the spliced action's: a uid above the block moves down
  // by three, exactly as an entity id does; one inside it names a card that
  // no longer exists and is left as it was, so the compare still refuses
  const ref = 'decide|glimpse|2|Ignis Sprite/Ignis Sprite|+1c:{"card":"Ignis Sprite","uid":50,"playableUntilTurn":2}';
  assert.equal(R.renumberRefUids(ref, 40, 43),
    'decide|glimpse|2|Ignis Sprite/Ignis Sprite|+1c:{"card":"Ignis Sprite","uid":47,"playableUntilTurn":2}');
  assert.equal(R.renumberRefUids(ref.replace('"uid":50', '"uid":41'), 40, 43), ref.replace('"uid":50', '"uid":41'),
    'a uid the spliced action allocated is not renumbered');
  assert.equal(R.renumberRefUids(ref.replace('"uid":50', '"uid":12'), 40, 43), ref.replace('"uid":50', '"uid":12'),
    'nor one from before it');
  assert.equal(R.renumberRefUids('playCard|0:"Lilbot"|-|-1h:Lilbot', 40, 43), 'playCard|0:"Lilbot"|-|-1h:Lilbot',
    'a key with no cached card is untouched');
});
