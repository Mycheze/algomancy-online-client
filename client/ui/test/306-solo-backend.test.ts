/* R297 — ui/solo.ts: the in-browser room the Learn to Play game runs in.
 *
 * The claims are about what reaches the LEARNER, read off the messages the
 * room actually pushes — never off its internals:
 *
 *   §1 the bot's hand and deck never appear by name in any push
 *   §2 inside a hidden step the bot's moves are frozen out of the view and the
 *      live events, and arrive in the reveal when the step closes
 *   §3 the bot acts in its own push, after the learner's
 *   §4 a save replays to the same game; undo takes back the learner's last move
 *
 * Seeds 30600-30699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import type { Action, CardName, EngineEvent, GameState } from '../../engine/src/types.ts';
import { CONSTRUCT, fallbackMove, tutorialBotV1 } from '../bot.ts';
import { SoloServer, type SoloDeal } from '../solo.ts';

const fire = DECK_LIST.filter(n => getCard(n).kind === 'unit' && (getCard(n).factions ?? []).join() === 'fire');
const DEAL = (seed: number): SoloDeal => ({
  seed,
  names: ['Learner', 'Tutorial Bot'],
  decks: [Array.from({ length: 30 }, (_, i) => fire[i % fire.length]!) as CardName[], Array(40).fill(CONSTRUCT)],
  lesson: {
    openingHand: [4, 1], drawPerTurn: [2, 1], stacked: [false, false],
    shardsPerTurn: [0, 1], firstShardTurn: 1, shardState: 'open',
    prismites: [2, 0], startingLife: [30, 30],
  },
});

interface Msg { t: string; view?: GameState; legal?: Action[]; events?: EngineEvent[]; reveal?: EngineEvent[]; step?: string; log?: string[] }

/** A room plus everything it has pushed, delivered synchronously. */
function room(seed: number): { s: SoloServer; msgs: Msg[] } {
  const s = new SoloServer(DEAL(seed), tutorialBotV1());
  const msgs: Msg[] = [];
  const sock = s.socket();
  sock.deliver = (m: Record<string, unknown>) => { msgs.push(JSON.parse(JSON.stringify(m)) as Msg); };
  s.receive(JSON.stringify({ t: 'join' }));
  return { s, msgs };
}

/** the learner passes through the game with the most passive move each time */
function step(s: SoloServer, msgs: Msg[]): boolean {
  const last = [...msgs].reverse().find(m => m.legal)!;
  const a = fallbackMove(last.legal!);
  if (!a || s.state.phase === 'gameover') return false;
  s.act(a);
  return true;
}

const namesBot = (m: Msg): boolean => JSON.stringify(m).includes(CONSTRUCT);

test('§1 the bot\'s hand and deck never reach the learner by name', () => {
  const { s, msgs } = room(30600);
  for (let i = 0; i < 400 && s.state.turn <= 4 && step(s, msgs); i++) { /* play */ }
  assert.ok(s.state.turn >= 3, 'non-vacuous: the game ran several turns');
  assert.ok(Object.values(s.state.entities).some(e => e.controller === 1), 'non-vacuous: the bot did deploy');
  for (const m of msgs) {
    if (!m.view) continue;
    assert.ok(m.view.players[1]!.hand.every(n => n !== CONSTRUCT), 'the bot\'s hand is card backs');
    assert.ok(!(m.view.decks?.[1] ?? []).includes(CONSTRUCT), 'the bot\'s deck is not listed');
  }
  // the hand and the deck are what must be hidden; a Construct the bot CASTS is public once revealed
  for (const m of msgs) {
    for (const e of m.events ?? []) {
      if (e.type === 'handEntered' && e.data?.['seat'] === 1) assert.equal(e.data?.['cards'], undefined, 'a bot draw names no card');
    }
  }
});

test('§2 inside deployment the bot\'s cast is frozen out, and revealed when the step closes', () => {
  const { s, msgs } = room(30601);
  // walk to turn 2's deployment (the bot casts every deployment)
  for (let i = 0; i < 400 && !(s.state.turn === 2 && s.state.phase === 'deploy'); i++) step(s, msgs);
  assert.equal(s.state.phase, 'deploy', 'reached a deployment');
  const botUnitsNow = Object.values(s.state.entities).filter(e => e.controller === 1 && e.card === 'Unit Token').length;
  const shown = [...msgs].reverse().find(m => m.view)!;
  const shownBotUnits = Object.values(shown.view!.entities).filter(e => e.controller === 1 && e.card === 'Unit Token').length;
  assert.ok(botUnitsNow > shownBotUnits, `non-vacuous: the bot deployed (${botUnitsNow}) and the learner's view is frozen (${shownBotUnits})`);
  const before = msgs.length;
  for (let i = 0; i < 50 && s.state.phase === 'deploy' && s.state.turn === 2; i++) step(s, msgs);
  const during = msgs.slice(0, before);
  const since = msgs.slice(before);
  const reveal = since.find(m => m.reveal?.length);
  assert.ok(reveal, 'the close of deployment carried a reveal');
  assert.equal(reveal!.step, 'deploy');
  assert.ok(namesBot(reveal!), 'and the reveal names the Construct the bot cast');
  const castLine = reveal!.reveal!.find(e => e.msg.includes(CONSTRUCT))!;
  assert.ok(!during.some(m => (m.events ?? []).some(e => e.msg === castLine.msg && e.data?.['turn'] === castLine.data?.['turn'])
    && m !== reveal), 'the cast line did not travel before the reveal');
});

test('§3 every learner action is answered, and the bot answers in a push of its own', () => {
  const { s, msgs } = room(30602);
  let split = 0;
  for (let i = 0; i < 300 && s.state.turn <= 3; i++) {
    const n = msgs.length;
    const botMovesBefore = s.save.by.filter(b => b === 'B').length;
    if (!step(s, msgs)) break;
    const pushed = msgs.slice(n);
    assert.ok(pushed.length >= 1, 'the learner is always answered');
    const botMoved = s.save.by.filter(b => b === 'B').length > botMovesBefore;
    if (botMoved) {
      assert.equal(pushed.length, 2, 'the bot\'s moves ride a second push, paced as the opponent\'s');
      split++;
    } else {
      assert.equal(pushed.length, 1);
    }
  }
  assert.ok(split >= 3, `non-vacuous: the bot answered several times (${split})`);
});

test('§4 a save replays to the same game, and undo takes back the learner\'s last move', () => {
  const { s, msgs } = room(30603);
  for (let i = 0; i < 60; i++) step(s, msgs);
  const again = new SoloServer(s.deal, tutorialBotV1(), s.save);
  assert.deepEqual(again.state, s.state, 'replayed from the save');

  const beforeCount = s.save.by.filter(b => b === 'L').length;
  s.undo();
  assert.equal(s.save.by.filter(b => b === 'L').length, beforeCount - 1, 'one learner action fewer');
  const pushed = msgs[msgs.length - 1]!;
  assert.ok(pushed.log && pushed.view, 'undo pushes a full resync');
});

test('§5 full control: the room never answers a forced step of the learner\'s while it is on', () => {
  const on = new SoloServer(DEAL(30604), tutorialBotV1());
  const msgs: Msg[] = [];
  const sock = on.socket();
  sock.deliver = m => { msgs.push(JSON.parse(JSON.stringify(m)) as Msg); };
  on.receive(JSON.stringify({ t: 'join', on: true }));
  for (let i = 0; i < 200 && on.state.phase !== 'battle'; i++) step(on, msgs);
  // turn 1's battle: the learner has initiative and no units, so the empty
  // attack is forced — and with full control on it is left for them to send
  assert.equal(on.state.phase, 'battle', 'reached the battle');
  assert.ok(!on.save.by.some((b, i) => b === 'F' && on.save.actions[i]!.seat === 0), 'no forced step was taken for the learner');
  const off = room(30604);
  for (let i = 0; i < 200 && off.s.state.turn < 2; i++) step(off.s, off.msgs);
  assert.ok(off.s.save.by.some((b, i) => b === 'F' && off.s.save.actions[i]!.seat === 0), 'positive control: with it off, one was');
});

test('§6 a refused bot move never leaves the game with nobody to move', () => {
  // a policy that always asks for something the engine refuses
  const broken = { id: 'broken', name: 'Broken', choose: (_s: unknown, seat: 0 | 1) => ({ type: 'bottomCards', seat, handIndices: [0, 1] }) as never };
  const stuck: string[] = [];
  const s = new SoloServer(DEAL(30605), broken, undefined, { onBotStuck: w => stuck.push(w) });
  const msgs: Msg[] = [];
  const sock = s.socket();
  sock.deliver = m => { msgs.push(JSON.parse(JSON.stringify(m)) as Msg); };
  s.receive(JSON.stringify({ t: 'join' }));
  for (let i = 0; i < 300 && s.state.turn <= 3 && step(s, msgs); i++) { /* play */ }
  assert.ok(stuck.length > 0, 'non-vacuous: the bot really was refused (and it was reported)');
  assert.ok(s.state.turn > 3, `the game went on regardless (turn ${s.state.turn})`);
});

test('§7 messages cross on microtasks, not timers (a background tab throttles timers)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../solo.ts', import.meta.url), 'utf8');
  const sock = src.slice(src.indexOf('export class SoloSocket'));
  assert.doesNotMatch(sock, /setTimeout/);
  assert.match(sock, /queueMicrotask/);
});
