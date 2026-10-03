/* 2026-10-03 — THE PLAYBACK: a hidden step, played back a board at a time.
 *
 * The owner, of the "Your opponent's deployment" modal: "it's really hard to
 * parse and sorta unclear. I've basically started just ignoring it and then
 * looking at their board and what changed … the better idea might just be to
 * 'replay' their board, one action at a time, like a little movie." And of the
 * end of turn that follows in the same breath: make it "happen more
 * slowly/clearly so that it's easy to track and follow".
 *
 * The server half is pinned here: the engine's frames (E.frames, rules-inert),
 * the room's bookkeeping (heldFrames / closing), and the one builder both the
 * room and Learn to Play send through (server/view.ts playbackFrames). That
 * every event goes out exactly once is engine/test/217 §3b; the client half,
 * which needs a browser, is the stack rig's (tools/stackrig twoseat.sh).
 *
 * Seeds 36000-36099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, createGame, forcedAction, legalActions } from '../../engine/src/apply.ts';
import type { Action, CardName, EngineEvent, Seat } from '../../engine/src/types.ts';
import { HIDDEN_CARD, playbackFrames, redactEvent, visibleToSeat } from '../view.ts';
import type { HeldFrame, SegmentClose } from '../view.ts';
import type { Room } from '../rooms.ts';

// rooms.ts persists every room it touches — point it at a throwaway first
process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-360-'));
const { applyToRoom, clockRunning, createRoom, openSegment, segmentKey, setWatchHold, settleClock, undoActionAt, watchHoldExpired } = await import('../rooms.ts');

const NAMES: [string, string] = ['Player 1', 'Player 2'];
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const onWire = (evs: EngineEvent[], seat: Seat): EngineEvent[] =>
  evs.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, NAMES));

/** one tick of main.ts's action handler, and the playback's raw material as
 * main.ts takes it — before openSegment() clears it */
function tick(room: Room, a: Action): { events: EngineEvent[]; closed: boolean; frames: [HeldFrame[], HeldFrame[]]; close: SegmentClose | null } {
  const wasKey = room.segKey;
  const events = applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    events.push(...applyToRoom(room, f));
  }
  if (segmentKey(room.state) === wasKey) return { events, closed: false, frames: [[], []], close: null };
  const frames = room.heldFrames, close = room.closing;
  openSegment(room);
  return { events, closed: wasKey !== null, frames, close };
}
function toDeployment(room: Room): void {
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  for (const seat of [0, 1] as Seat[]) {
    if (room.state.hasteDone && !room.state.hasteDone[seat]) tick(room, { type: 'doneHaste', seat });
  }
  for (let g = 0; g < 2 && room.state.phase === 'battle' && room.state.battle; g++) {
    tick(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  }
}
const give = (room: Room, seat: Seat, name: CardName): number => {
  room.state.players[seat]!.hand.push(name);
  return room.state.players[seat]!.hand.length - 1;
};
const giveEverything = (room: Room, seat: Seat): void => {
  for (const kind of ['fire', 'water', 'wood', 'metal', 'earth', 'light', 'dark']) {
    for (let i = 0; i < 8; i++) room.state.players[seat]!.resources.push({ kind, state: 'open' } as never);
  }
};

/* ── §1 the engine's frames are observation only ─────────────────────── */

test('§1 a game with frames is the same game without them, action for action', () => {
  for (const seed of [36001, 36002, 36003]) {
    let { state } = createGame(seed);
    let framesSeen = 0;
    for (let i = 0; i < 400 && state.phase !== 'gameover'; i++) {
      const seat: Seat = state.decision ? state.decision.seat : (legalActions(state, 0).length ? 0 : 1);
      const acts = legalActions(state, seat).filter(a => a.type !== 'concede');
      if (!acts.length) break;
      const a = acts[(i * 7919 + seed) % acts.length]!;
      let plain, watched;
      try { plain = apply(state, a); } catch { break; }
      watched = apply(state, a, { frames: true });
      assert.deepEqual(watched.state, plain.state, `seed ${seed} action ${i}: the board differs with frames on`);
      assert.deepEqual(watched.events, plain.events, `seed ${seed} action ${i}: the events differ with frames on`);
      assert.equal(plain.frames, undefined, 'and nobody gets frames who did not ask');
      framesSeen += watched.frames?.length ?? 0;
      state = plain.state;
    }
    assert.ok(framesSeen > 0, `positive control: seed ${seed}'s game resolved something worth a frame`);
  }
});

/* ── §2 the end of turn, one resolution at a time ────────────────────── */

test('§2 the end of turn is a frame per trigger, and the frames cut its events in order', () => {
  const room = createRoom('PB360', 36011, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveEverything(room, A); giveEverything(room, D);
  tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Harbinger of Immolation') });
  tick(room, { type: 'playCard', seat: D, handIndex: give(room, D, 'Cosmic Devourer') });
  tick(room, { type: 'doneDeploying', seat: A });
  const t = tick(room, { type: 'doneDeploying', seat: D });
  assert.ok(t.closed && t.close, 'the step closed, and the action that closed it was recorded');
  assert.equal(t.close!.frames.length, 2, 'two end-of-turn triggers: two frames');
  const ats = t.close!.frames.map(f => f.at);
  assert.deepEqual([...ats].sort((x, y) => x - y), ats, 'in the order they happened');
  // each frame is the board its resolution LEFT: a Fireball in the first or
  // the second, a Wraith in the other — and neither is on the board before
  const cards = (s: { entities: Record<number, { card: string }> }) => Object.values(s.entities).map(e => e.card);
  assert.ok(!cards(t.close!.before).includes('Wraith') && !cards(t.close!.before).includes('Fireball'));
  const last = t.close!.frames[1]!.state;
  assert.ok(cards(last).includes('Wraith') && cards(last).includes('Fireball'), 'both have landed by the last frame');
  assert.notDeepEqual(cards(t.close!.frames[0]!.state), cards(last), 'and the first shows only one of them');
  // the playback for D: their own Devourer's Wraith and A's Fireball, each its own frame
  const pb = playbackFrames({ seat: D, held: t.frames[D]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, D) });
  const tail = pb.frames.filter(f => f.kind === 'tail');
  assert.equal(tail.length, 2);
  assert.ok(tail.every(f => f.events.some(e => e.type === 'resolved')), 'each tail frame holds the resolution it shows');
  assert.ok(pb.rest.some(e => e.type === 'turn'), 'the next turn\'s start comes after the last frame, on the update itself');
});

/* ── §3 a frame says nothing the freeze did not already hide ─────────── */

test('§3 an opponent frame: their move on their half, their hand still face down, your half as you left it', () => {
  const room = createRoom('PB361', 36021, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveEverything(room, A); giveEverything(room, D);
  give(room, A, 'Hooba-God');   // stays in A's hand: no frame may name it
  tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Good Whale') });
  tick(room, { type: 'playCard', seat: D, handIndex: give(room, D, 'Bubb') });
  tick(room, { type: 'doneDeploying', seat: A });
  const t = tick(room, { type: 'doneDeploying', seat: D });
  const pb = playbackFrames({ seat: D, held: t.frames[D]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, D) });
  const opp = pb.frames.filter(f => f.kind === 'opp');
  assert.equal(opp.length, 1, 'one move of A\'s worth showing (their "done" is not a step)');
  const v = opp[0]!.view;
  assert.ok(v.players[A]!.hand.every(c => c === HIDDEN_CARD), 'A\'s hand is backs');
  assert.ok(!JSON.stringify(opp[0]).includes('Hooba-God'), 'and nothing anywhere in the frame names a card still in it');
  assert.ok(Object.values(v.entities).some(e => e.card === 'Good Whale' && e.controller === A), 'A\'s Whale is on A\'s side');
  assert.ok(Object.values(v.entities).some(e => e.card === 'Bubb' && e.controller === D),
    'and D\'s own half is the board D left — Bubb included — not the board at the step\'s start');
  assert.equal(v.decision, null);
  assert.equal(v.seed, 0, 'redacted like every view: no seed to rebuild the deck from');
  // A sees D's Bubb the same way, and never A's own move as a frame
  const pbA = playbackFrames({ seat: A, held: t.frames[A]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, A) });
  const oppA = pbA.frames.filter(f => f.kind === 'opp');
  assert.equal(oppA.length, 1);
  assert.ok(Object.values(oppA[0]!.view.entities).some(e => e.card === 'Bubb' && e.controller === D));
  assert.ok(!oppA.some(f => f.events.some(e => e.msg?.includes('Good Whale'))), 'A is not played back A\'s own move');
});

/* ── §4 / §5 what is and is not a step ───────────────────────────────── */

test('§4 a move with nothing to show is not a step — and its line is not lost', () => {
  const room = createRoom('PB362', 36031, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  tick(room, { type: 'doneDeploying', seat: A });
  const t = tick(room, { type: 'doneDeploying', seat: D });
  assert.equal(t.frames[D]!.length, 1, 'the room did hold A\'s "done" (it has a line)');
  const pb = playbackFrames({ seat: D, held: t.frames[D]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, D) });
  assert.equal(pb.frames.filter(f => f.kind === 'opp').length, 0, 'but "is done deploying" moves nothing: no frame');
  const told = [...pb.frames.flatMap(f => f.events), ...pb.rest].map(e => e.msg);
  assert.ok(told.some(m => /is done deploying/.test(m)), 'its line still reaches the log, with what follows it');
});

test('§5 the action that closes the step is the tail\'s, never a frame of the closer\'s opponent', () => {
  const room = createRoom('PB363', 36041, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveEverything(room, D);
  tick(room, { type: 'doneDeploying', seat: A });
  tick(room, { type: 'playCard', seat: D, handIndex: give(room, D, 'Bubb') });
  const t = tick(room, { type: 'doneDeploying', seat: D });
  assert.equal(t.frames[A]!.length, 1, 'A is played back D\'s Bubb…');
  assert.ok(t.frames[A]!.every(f => !f.events.some(e => /is done deploying/.test(e.msg ?? '') && e === t.close!.events[0])),
    '…and not D\'s closing "done", which is public after the barrier');
  assert.ok(t.close!.events.length > 0 && t.events.includes(t.close!.events[0]!), 'the closing action\'s events open the tail');
});

/* ── §6 an undo inside the step rebuilds the frames ──────────────────── */

test('§6 undoing a move inside the step takes its frame with it, and keeps the others', () => {
  // a SCENARIO board, because an undo replays the log from the deal: a card
  // pushed into a hand by a test is not in the log, and would not come back
  const room = createRoom('PB364', 36051, [...NAMES], 'shared', undefined, undefined, 'playback-deploy');
  assert.equal(room.state.phase, 'deploy');
  const OPP: Seat = 1, YOU: Seat = 0;
  const hand = () => room.state.players[OPP]!.hand;
  tick(room, { type: 'playCard', seat: OPP, handIndex: hand().indexOf('Sparkwraith') });
  tick(room, { type: 'playCard', seat: OPP, handIndex: hand().indexOf('Ephemeral Skywalker') });
  assert.equal(room.heldFrames[YOU]!.length, 2, 'two moves of theirs, two frames for you');
  const lost = undoActionAt(room, room.actions.length - 1);
  assert.deepEqual(lost, [], 'positive control: the undo really happened');
  assert.equal(room.heldFrames[YOU]!.length, 1, 'the Skywalker\'s frame went with the Skywalker');
  assert.ok(Object.values(room.heldFrames[YOU]![0]!.state.entities).some(e => e.card === 'Sparkwraith'),
    'the Sparkwraith frame is rebuilt, not dropped');
  assert.equal(room.closing, null);
});

/* ── §7 the haste step plays back too ────────────────────────────────── */

test('§7 a haste step closes into frames the same way', () => {
  const room = createRoom('PB365', 36061, [...NAMES]);
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  assert.equal(room.segKey, 'haste', 'positive control: the haste step is open (R228)');
  const A: Seat = 0, D: Seat = 1;
  giveEverything(room, A);
  tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Cinder Scuttler') });
  tick(room, { type: 'doneHaste', seat: A });
  const t = tick(room, { type: 'doneHaste', seat: D });
  assert.ok(t.closed && t.close, 'the haste step closed on D\'s ready');
  const pb = playbackFrames({ seat: D, held: t.frames[D]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, D) });
  const opp = pb.frames.filter(f => f.kind === 'opp');
  assert.equal(opp.length, 1, 'A\'s Scuttler is a frame');
  assert.ok(Object.values(opp[0]!.view.entities).some(e => e.card === 'Cinder Scuttler' && e.controller === A));
});

/* ── §8 the clock does not run while you watch ───────────────────────── */

test('§8 a seat watching a playback is off the clock until it is done, or the hold lapses', () => {
  // the owner: "the clock should NOT be running. The idea is to only tick down
  // when you could actually be making decisions and are 'taking' time from
  // the game."
  const room = createRoom('PB366', 36071, [...NAMES]);
  room.sockets = [{} as never, {} as never];   // both connected: the clock is live
  settleClock(room);
  assert.deepEqual(room.clockRun, [true, true], 'positive control: planning bills both seats');
  const now = Date.now();
  setWatchHold(room, 0, now + 60_000);
  settleClock(room);
  assert.deepEqual(clockRunning(room), [false, true], 'the seat watching its playback is not billed; the other still is');
  const before = room.clockMs[0];
  room.clockStamp -= 5_000;            // five seconds pass
  settleClock(room);
  assert.equal(room.clockMs[0], before, '…and loses nothing while it watches');
  // done: the client says so (main.ts 'playbackdone' → setWatchHold null)
  setWatchHold(room, 0, null);
  settleClock(room);
  assert.deepEqual(room.clockRun, [true, true], 'back on the clock the moment it is over');
  // a client that never says so: the hold lapses at its deadline
  setWatchHold(room, 1, Date.now() - 1);
  assert.equal(watchHoldExpired(room, Date.now()), true, 'the sweep sees it is due');
  settleClock(room);
  assert.equal(room.watchHold[1], null, 'settling lapses it');
  assert.deepEqual(room.clockRun, [true, true], 'and the seat is billed again — a silent client cannot freeze a bank');
});

test('§8b the server holds the clock when it sends a playback, and lets go when told or when the seat acts', () => {
  const src = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(setWatchHold\(room, seat, pb\.frames\.length \? Date\.now\(\) \+ playbackBudget\(pb\.frames\) : null\)\) settleClock\(room\);\n\s*sendToSeat/,
    'set as the playback is sent, before the snapshot riding that update is built');
  assert.match(src, /if \(msg\.t === 'playbackdone'\)[\s\S]{0,200}setWatchHold\(conn\.room, conn\.seat, null\)/, 'released when the client says it is done');
  assert.match(src, /function landAction[\s\S]{0,200}setWatchHold\(room, seat, null\)/, 'and when the seat acts');
  const ui = readFileSync(new URL('../../ui/main.ts', import.meta.url), 'utf8');
  assert.match(ui, /this\.ws\.send\(JSON\.stringify\(\{ t: 'playbackdone' \}\)\)/, 'the client does say it is done');
});
