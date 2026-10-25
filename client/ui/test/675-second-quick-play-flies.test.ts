/* CT-384 — IN A QUICK RUN OF PLAYS, THE SECOND CARD FLIES FROM THE HAND TOO.
 *
 * Measured in headless Chrome (review board playback-deploy, seat 1 deploying
 * Ephemeral Skywalker then Sparkwraith 250ms apart, every frame sampled):
 * the first card flew hand → stack window → board; the second, whose beat
 * waits a second behind the first, shrank out where it stood in the hand at
 * the click, and its stack card dropped in from nothing at its turn. After:
 * no fade at the hand; at its turn a ghost leaves the hand's rect for the
 * stack window, the stack card hidden until it lands (the same at 600ms).
 *
 * ui/beatflight.ts waitingFlights is the rewrite of one paint's motion that
 * does it; these drive it with the moves ui/motion.ts produces.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { waitingFlights, type Parked } from '../beatflight.ts';
import { HIDDEN_CARD, type Motion, type Move } from '../motion.ts';
import type { Flash } from '../flash.ts';
import type { StackItem } from '../../engine/src/types.ts';

const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');

const rect = (left: number, top: number): DOMRect =>
  ({ left, top, width: 92, height: 128, right: left + 92, bottom: top + 128, x: left, y: top }) as unknown as DOMRect;
const beat = (id: number, card: string, controller: 0 | 1, at: number): Flash =>
  ({ item: { id, card, controller, kind: 'unit' } as unknown as StackItem, at, until: at + 1200 });
const leave = (card: string, seat: 0 | 1, k = 0): Move =>
  ({ card, seat, from: `h${seat}:${card}#${k}`, fromAnchor: `@hand:${seat}`, to: null, toAnchor: null, kind: 'leave' });
const enter = (card: string, seat: 0 | 1, id: number): Move =>
  ({ card, seat, from: null, fromAnchor: null, to: `s${id}`, toAnchor: '@stack', kind: 'enter' });
const motion = (...moves: Move[]): Motion => ({ moves, pulses: [] });

test('CR D6.7 / CT-384: the second play leaves the hand without a fade while its beat waits, then flies from there at its turn', () => {
  const parked: Parked = new Map();
  const queue = [beat(1, 'Ephemeral Skywalker', 1, 1000), beat(2, 'Sparkwraith', 1, 2000)];
  // the paint the second play lands at: the first beat is showing, the second waits
  const frameA = new Map([['h1:Sparkwraith#0', rect(85, 754)]]);
  const a = waitingFlights(frameA, motion(leave('Sparkwraith', 1)), queue, 1300, parked);
  assert.deepEqual(a.moves, [], 'no shrink-out at the hand: the card is waiting for its beat');
  assert.ok(parked.has('s2'), 'parked against the waiting beat');

  // the paint its beat starts at: the stack card is born with nothing to pair with
  const frameB = new Map<string, DOMRect>();
  const b = waitingFlights(frameB, motion(enter('Sparkwraith', 1, 2)), queue, 2000, parked);
  assert.equal(b.moves.length, 1);
  const mv = b.moves[0]!;
  assert.equal(mv.kind, 'move', 'a flight, not a drop-in');
  assert.equal(mv.to, 's2');
  assert.deepEqual(frameB.get(mv.from!), rect(85, 754), 'from where the card stood in the hand');
  assert.equal(parked.size, 0, 'and the park is spent');
});

test('CT-384: a leave with no waiting beat for that card is left alone', () => {
  const parked: Parked = new Map();
  const frame = new Map([['h1:Sparkwraith#0', rect(85, 754)], ['h1:Bubb#0', rect(10, 754)]]);
  const showing = [beat(2, 'Sparkwraith', 1, 1000)];
  assert.equal(waitingFlights(frame, motion(leave('Sparkwraith', 1)), showing, 1500, parked).moves.length, 1,
    'its beat is already on the strip — the ordinary pairing owns that card');
  assert.equal(waitingFlights(frame, motion(leave('Bubb', 1)), [beat(3, 'Sparkwraith', 1, 2000)], 1500, parked).moves.length, 1,
    'another card waiting is no reason to park this one');
  assert.equal(waitingFlights(frame, motion(leave('Sparkwraith', 1)), [beat(4, 'Sparkwraith', 0, 2000)], 1500, parked).moves.length, 1,
    'nor is the other seat waiting with the same card');
  assert.equal(parked.size, 0);
});

test('CT-384: the opponent hidden hand card parks against their waiting beat, and a park outlives nothing', () => {
  const parked: Parked = new Map();
  const frame = new Map([['h0:__HIDDEN__#3', rect(300, 20)]]);
  const queue = [beat(7, 'Sparkwraith', 0, 2000)];
  assert.deepEqual(waitingFlights(frame, motion(leave(HIDDEN_CARD, 0, 3)), queue, 1500, parked).moves, []);
  assert.ok(parked.has('s7'));
  // its beat came and went without a stack card being born (say, a skipped paint)
  waitingFlights(new Map(), motion(), queue, 3300, parked);
  assert.equal(parked.size, 0, 'dropped once the beat is over');
});

test('CT-384 wiring: every paint motion goes through waitingFlights before it is played', () => {
  assert.match(MAIN, /playMotion\(frame, waitingFlights\(frame, diffCensus\(before, after\), flashQueue, Date\.now\(\), parkedFlights\)\)/);
});
