/* R312 — SEEING HIDDEN CARDS ENDS YOUR UNDO.
 *
 * The owner, 2026-10-04: an action that showed you hidden cards cannot be
 * taken back, nor anything before it — "once you've seen the cards, it
 * stands". The hole: Lilbot ("[Augment] [once] Discard a card or sacrifice
 * another nontoken unit: Glimpse 2") activated in deployment shows the top two
 * cards of the deck, and an undo put them back where the seed keeps them —
 * a free peek, repeatable.
 *
 * What this file pins, every board built by LOGGED actions (a test-mode
 * sandbox deal, BL-06) so that a restore rebuilds exactly the same game:
 *
 *   §1  the glimpse itself cannot be undone, with words a player understands
 *   §2  an undo made BEFORE the glimpse happened still works
 *   §3  a plain spawn after the glimpse is undoable back to — not past — it
 *   §4  the lock survives a restart (the measurement is re-taken on restore)
 *   §5  your opponent's glimpse of the SHARED deck does not lock YOUR undo
 *   §6  measured, not listed: a spawn trigger's Glimpse 1 in the haste step
 *       locks the same way, and the plain plays around it do not
 *
 * Seeds: 37400-37499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forcedAction } from '../../engine/src/apply.ts';
import type { Action, CardName, EntityId, Seat } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';

// rooms.ts persists every room to ALGO_GAMES_DIR — a throwaway, set before the
// module loads; §4 imports a SECOND copy of the module over the same directory,
// which is what a restarted server is.
const DIR = mkdtempSync(join(tmpdir(), 'algo-374-'));
process.env['ALGO_GAMES_DIR'] = DIR;
type Rooms = typeof import('../rooms.ts');
const fresh = (): Promise<Rooms> => import(`../rooms.ts?r374=${Math.random()}`) as Promise<Rooms>;
const R = await fresh();
const { SEEN_REFUSAL } = await import('../seen.ts');

const NAMES: [string, string] = ['Rashi', 'Bena'];

/** one tick of main.ts: apply, drain the forced steps, reopen a closed segment */
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

const lilbotOf = (room: Room, seat: Seat): EntityId =>
  Object.values(room.state.entities).find(e => e.card === 'Lilbot' && e.controller === seat)!.id;

const handIndex = (room: Room, seat: Seat, card: CardName): number => {
  const i = room.state.players[seat]!.hand.indexOf(card);
  assert.ok(i >= 0, `${card} is in seat ${seat}'s hand`);
  return i;
};

/**
 * A sandbox room in the hidden DEPLOYMENT step: both seats have a Lilbot on
 * the board, three Ignis Sprites in hand and fire to cast them — all of it
 * through the four test-mode actions, so it is in the log.
 */
function deploying(mod: Rooms, code: string, seed: number): { room: Room; P: Seat; O: Seat } {
  const room = mod.createRoom(code, seed, [...NAMES], 'shared', undefined, undefined, 'sandbox');
  for (const s of [0, 1] as Seat[]) {
    tick(mod, room, { type: 'sandboxSpawn', seat: s, card: 'Lilbot', to: 'play' });
    for (let k = 0; k < 3; k++) tick(mod, room, { type: 'sandboxSpawn', seat: s, card: 'Ignis Sprite', to: 'hand' });
  }
  tick(mod, room, { type: 'donePlanning', seat: 0 });
  tick(mod, room, { type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    if (room.state.hasteDone && !room.state.hasteDone[s]) tick(mod, room, { type: 'doneHaste', seat: s });
  }
  for (let g = 0; g < 4 && room.state.phase === 'battle' && room.state.battle; g++) {
    tick(mod, room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  }
  assert.equal(room.segKey, 'deploy', 'the room is inside the hidden deployment step');
  for (const s of [0, 1] as Seat[]) tick(mod, room, { type: 'sandboxResources', seat: s, pool: { fire: 3 } });
  const P = room.state.deployPlayer as Seat;
  return { room, P, O: P === 0 ? 1 : 0 };
}

const spawnSprite = (mod: Rooms, room: Room, seat: Seat): void =>
  tick(mod, room, { type: 'playCard', seat, handIndex: handIndex(room, seat, 'Ignis Sprite') });

/** activate Lilbot and pay by discarding — after which the Glimpse 2 question
 * is open, showing the top two cards of the deck */
function glimpse(mod: Rooms, room: Room, seat: Seat): CardName[] {
  tick(mod, room, { type: 'activateAbility', seat, entityId: lilbotOf(room, seat), abilityIndex: 0, via: 'augment' });
  const cost = room.state.decision!;
  tick(mod, room, { type: 'decide', seat, choice: cost.options.findIndex(o => o.label.startsWith('Discard')) });
  const ask = room.state.decision!;
  assert.ok(ask && ask.seat === seat && /Glimpse 2/.test(ask.prompt), 'the Glimpse 2 question is open');
  return ask.options.map(o => o.card!);
}

test('R312 §1: a Glimpse in deployment cannot be undone — "you\'ve seen those cards"', () => {
  const { room, P } = deploying(R, 'R312A', 37401);
  const top = glimpse(R, room, P);
  assert.equal(top.length, 2, 'two cards shown');

  const log = JSON.stringify(room.actions);
  const out = R.undoForSeat(room, P);
  assert.deepEqual(out, { ok: false, why: SEEN_REFUSAL }, 'undo is refused while the question is open');
  assert.match(SEEN_REFUSAL, /seen those cards/, 'in words a player understands');
  assert.equal(JSON.stringify(room.actions), log, 'and nothing left the log');

  tick(R, room, { type: 'decide', seat: P, choice: 0 });
  assert.equal(room.state.players[P]!.cache?.at(-1)?.card, top[0], 'the chosen card is cached');
  assert.deepEqual(R.undoForSeat(room, P), { ok: false, why: SEEN_REFUSAL },
    'answering the glimpse does not reopen it: that answer is after the reveal, and so is the reveal');
});

test('R312 §2: an undo of an earlier play BEFORE any glimpse still works', () => {
  const { room, P } = deploying(R, 'R312B', 37402);
  const hand = room.state.players[P]!.hand.length;
  spawnSprite(R, room, P);
  assert.equal(room.state.players[P]!.hand.length, hand - 1, 'the sprite was played');
  assert.deepEqual(R.undoForSeat(room, P), { ok: true }, 'nothing hidden was shown, so it comes back');
  assert.equal(room.state.players[P]!.hand.length, hand, 'the sprite is back in hand');
  // …and the glimpse that follows locks from where it happens
  spawnSprite(R, room, P);
  glimpse(R, room, P);
  assert.deepEqual(R.undoForSeat(room, P), { ok: false, why: SEEN_REFUSAL });
});

test('R312 §3: a plain spawn after the glimpse is undoable back to the glimpse, and not past it', () => {
  const { room, P } = deploying(R, 'R312C', 37403);
  spawnSprite(R, room, P);                 // before the glimpse: will be locked behind it
  glimpse(R, room, P);
  tick(R, room, { type: 'decide', seat: P, choice: 1 });
  const atGlimpse = room.actions.length;
  spawnSprite(R, room, P);                 // after the glimpse: free
  assert.equal(room.actions.length, atGlimpse + 1);

  assert.deepEqual(R.undoForSeat(room, P), { ok: true }, 'the spawn after the glimpse comes back');
  assert.equal(room.actions.length, atGlimpse, 'exactly that one action left the log');
  assert.deepEqual(R.undoForSeat(room, P), { ok: false, why: SEEN_REFUSAL },
    'the next undo would take back the glimpse — refused');
  assert.equal(room.actions.length, atGlimpse, 'and the glimpse, and the spawn before it, stand');
});

test('R312 §4: the lock survives a restart — a restored room measures it again', async () => {
  const { room, P } = deploying(R, 'R312D', 37404);
  glimpse(R, room, P);
  tick(R, room, { type: 'decide', seat: P, choice: 0 });
  spawnSprite(R, room, P);
  const n = room.actions.length;

  const R2 = await fresh();                // a new process, the same games directory
  R2.restoreRooms();
  const back = R2.getRoom('R312D')!;
  assert.ok(back, 'the room came back off disk');
  assert.equal(back.actions.length, n, 'with the whole log');
  assert.equal(back.segKey, 'deploy', 'still inside the deployment step');
  assert.equal(back.lost.length, 0, 'replayed without refusing anything');
  assert.deepEqual(R2.undoForSeat(back, P), { ok: true }, 'the spawn after the glimpse is still undoable');
  assert.deepEqual(R2.undoForSeat(back, P), { ok: false, why: SEEN_REFUSAL },
    'and the glimpse is still locked — the floor was rebuilt, not forgotten');
});

test("R312 §5: the opponent's glimpse of the SHARED deck does not lock your undo", () => {
  const { room, P, O } = deploying(R, 'R312E', 37405);
  assert.equal(room.state.mode, 'shared', 'one deck for both seats');
  // yours, before their peek: deploying() ends on each seat setting its mana.
  // (An action that allocates no id, on purpose — an id-allocating play has a
  // refusal of its own here that is not this rule: the cached card's `uid`
  // comes off the id clock and sits in their move's reference key.)
  const mine = room.actions.length - 1;
  assert.equal(room.actions[mine]!.seat, P);
  const top = glimpse(R, room, O);         // their peek at the deck you share
  tick(R, room, { type: 'decide', seat: O, choice: 0 });

  const seen = room.segSeen.slice(room.segStartIndex);
  assert.ok(seen.some(s => typeof s[O] === 'string'), 'the room recorded that THEY saw hidden cards');
  assert.ok(!seen.some(s => typeof s[P] === 'string'), 'and that you saw none — you were shown nothing');

  const n = room.actions.length;
  assert.deepEqual(R.undoForSeat(room, P), { ok: true },
    'a peek you did not see does not stop you taking back your own move');
  assert.equal(room.actions.length, n - 1, 'your move left the log');
  assert.ok(room.actions.slice(mine).every(a => a.seat === O), 'and only theirs follow where it was');
  assert.equal(room.state.players[O]!.cache?.at(-1)?.card, top[0],
    'and their glimpse came through the splice exactly as they saw it');
  assert.deepEqual(R.undoForSeat(room, O), { ok: false, why: SEEN_REFUSAL }, 'while THEY stay locked');
});

test('R312 §6: measured, not listed — a spawn trigger\'s Glimpse 1 in the haste step locks too', () => {
  const room = R.createRoom('R312F', 37406, [...NAMES], 'shared', undefined, undefined, 'sandbox');
  const S: Seat = 0;
  tick(R, room, { type: 'sandboxSpawn', seat: S, card: 'Seer of Empty Spaces', to: 'hand' });
  tick(R, room, { type: 'sandboxSpawn', seat: S, card: 'Seer of Empty Spaces', to: 'hand' });
  tick(R, room, { type: 'donePlanning', seat: 0 });
  tick(R, room, { type: 'donePlanning', seat: 1 });
  assert.equal(room.segKey, 'haste', 'the hidden haste step is open');
  tick(R, room, { type: 'sandboxResources', seat: S, pool: { light: 3 } });
  assert.deepEqual(R.undoForSeat(room, S), { ok: true }, 'setting mana shows nothing hidden');
  tick(R, room, { type: 'sandboxResources', seat: S, pool: { light: 3 } });

  const top = room.state.sharedDeck[0];
  tick(R, room, { type: 'playCard', seat: S, handIndex: handIndex(room, S, 'Seer of Empty Spaces') });
  assert.equal(room.segKey, 'haste', 'still inside the haste step');
  assert.equal(room.state.players[S]!.cache?.at(-1)?.card, top, 'the spawn trigger glimpsed (and cached) the top card');
  assert.deepEqual(R.undoForSeat(room, S), { ok: false, why: SEEN_REFUSAL },
    'no Lilbot, no question, no "glimpse" anywhere in the undo code — and still locked');
});

test('R312 §7: Learn to Play applies the same floor — a turn\'s draw ends the undo of the turn before', async () => {
  // ui/solo.ts's undo has no phase gate (it truncates, it never splices), so
  // the floor is all it has — and it comes from the same server/seen.ts.
  await import('../../engine/src/cards/registry.ts');
  const { DECK_LIST } = await import('../../engine/src/cards/registry.ts');
  const { getCard } = await import('../../engine/src/cards/dsl.ts');
  const { CONSTRUCT, fallbackMove, tutorialBotV1 } = await import('../../ui/bot.ts');
  const { SoloServer, LEARNER } = await import('../../ui/solo.ts');
  const fire = DECK_LIST.filter(n => getCard(n).kind === 'unit' && (getCard(n).factions ?? []).join() === 'fire');
  const s = new SoloServer({
    seed: 37407,
    names: ['Learner', 'Tutorial Bot'],
    decks: [Array.from({ length: 30 }, (_, i) => fire[(i * 7) % fire.length]!) as CardName[], Array(40).fill(CONSTRUCT)],
    lesson: {
      openingHand: [4, 1], drawPerTurn: [2, 1], stacked: [false, false],
      shardsPerTurn: [0, 1], firstShardTurn: 1, shardState: 'open',
      prismites: [2, 0], startingLife: [30, 30],
    },
  }, tutorialBotV1());
  const msgs: { t: string; msg?: string; legal?: Action[] }[] = [];
  const sock = s.socket();
  sock.deliver = (m: Record<string, unknown>) => { msgs.push(JSON.parse(JSON.stringify(m)) as typeof msgs[number]); };
  s.receive(JSON.stringify({ t: 'join' }));
  const legal = (): Action[] => [...msgs].reverse().find(m => m.legal)!.legal!;

  // the learner plays passively until the second turn's draw has happened
  for (let i = 0; i < 200 && s.state.turn < 2; i++) s.act(fallbackMove(legal())!);
  assert.equal(s.state.turn, 2, 'turn 2 has begun — and with it the learner\'s draw');
  const errors = (): string[] => msgs.filter(m => m.t === 'error').map(m => m.msg!);
  const before = s.save.actions.length;
  s.receive(JSON.stringify({ t: 'undo' }));
  assert.deepEqual(errors(), [SEEN_REFUSAL], 'taking back the turn that drew you two cards is refused');
  assert.equal(s.save.actions.length, before, 'and nothing was taken back');

  // a move after the draw that shows nothing hidden is still undoable
  const quiet = legal().find(a => a.seat === LEARNER && (a.type === 'recycleForResource' || a.type === 'activateResource'));
  assert.ok(quiet, 'non-vacuous: the learner has a resource move to make');
  s.act(quiet);
  const n = s.save.actions.length;
  s.receive(JSON.stringify({ t: 'undo' }));
  assert.equal(errors().length, 1, 'no new refusal');
  assert.ok(s.save.actions.length < n, 'the resource move was taken back');
});
