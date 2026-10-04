/* R310 (owner ruling, 2026-10-04, report #192) — A GLIMPSE INSIDE A HIDDEN
 * SIMULTANEOUS STEP WAITS FOR THE REVEAL. It reverses R235.
 *
 * The owner: "Glimpse cards shouldn't be shown to an opponent *during*
 * Deployment. They should be a part of the recap only."
 *
 * ── WHAT THIS FILE USED TO PIN, AND WHY IT WAS RENAMED
 *
 * Until R310 this file was `203-reveal-escapes-the-hidden-hold.test.ts`, the
 * guard on R235: `server/rooms.ts` parks the opponent's copy of every event a
 * hidden step (the resource step, the haste step, deployment) produces in
 * `heldEvents` until the barrier, and R235 gave that hold a one-entry
 * exemption — `glimpsed`, "the card says REVEAL" — so an `Oracle of
 * Foretelling`'s Glimpse 5 reached the other seat on the tick it happened,
 * popped their glimpse notice mid-deployment, and for that very reason was
 * MISSING from the recap (the playback is built from the held queue). R310
 * deletes the exemption (`escapesHold` is gone from view.ts and from all three
 * hidden-step runners). The name said the opposite of the rule, so it moved.
 *
 * ── THE FOUR CLAIMS
 *
 *   §1 HELD: inside a hidden step the opponent is sent NOTHING of a glimpse —
 *      not the event, not a log line on a resync, not a moving deck count.
 *      The glimpser still gets their own reveal live.
 *   §2 FLUSHED ONCE, AT THE BARRIER: the close carries it exactly once, and the
 *      finished log and a reconnect's log hold exactly one reveal line.
 *   §3 IN THE PLAYBACK FRAME of the action that made it — the frame the client
 *      pops its card notice on (ui/test/371-glimpse-in-the-recap.test.ts) —
 *      and in no other frame and not in the trailing events.
 *   §4 NOTHING ESCAPES: measured over every event type these steps emit, not
 *      a list of types somebody remembered; plus the source guard that keeps
 *      the main.ts compositions this file re-builds honest.
 *
 * Battle is unchanged and is not here: nothing is held in battle, so a battle
 * glimpse is instant (159-glimpse-reveal-visibility.test.ts, Premonition).
 *
 * ── ⚠ WHY NOTHING HERE READS `h.log` OR HAND-BUILDS AN EVENT
 *
 * docs/13 §7.4 / R203: `Harness.absorb()` flattens every event into one
 * seatless log, so a secrecy assertion written against it reads the same
 * whether the information is shared or not. There is no Harness in this file.
 * Every claim is made against a real `Room` driven through `applyToRoom`, and
 * read back through the exact compositions `server/main.ts` puts on the wire:
 *
 *     sendUpdate   → viewFor(state, seat, room.segSnapshot)
 *                  + events.filter(visibleToSeat).map(redactEvent)
 *     visibleLog   → redactLog(events not held for seat, seat, names)
 *     sendReveal   → playbackFrames(held frames, tail, close) at the barrier
 *
 * Seeds: 20300-20399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forcedAction } from '../../engine/src/apply.ts';
import type { Action, CardName, EngineEvent, GameState, Seat } from '../../engine/src/types.ts';
import { playbackFrames, redactEvent, redactLog, viewFor, visibleToSeat } from '../view.ts';
import type { HeldFrame, PlaybackFrame, SegmentClose } from '../view.ts';
// type-only, so it is erased: the RUNTIME import of rooms.ts has to wait until
// ALGO_GAMES_DIR below is set.
import type { Room } from '../rooms.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..');
const UI = join(HERE, '..', '..', 'ui');

// rooms.ts PERSISTS every room it touches to ALGO_GAMES_DIR (server/games by
// default, which on the deploy box is live data). Point it at a throwaway
// before the module is loaded — hence the dynamic import below.
process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-203-'));
const {
  applyToRoom, createRoom, openSegment, segmentKey, unheldFor,
} = await import('../rooms.ts');

const NAMES: [string, string] = ['Player 1', 'Player 2'];
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const deckOf = (s: GameState, seat: Seat): CardName[] => s.decks?.[seat] ?? s.sharedDeck;

/** What one tick of `main.ts`'s action handler puts on each seat's wire. */
interface Tick {
  /** the actor's own events (never held from them) */
  toActor: EngineEvent[];
  /** what the OPPONENT is sent live, mid-step: oppEvents + whatever was not held */
  toOpp: EngineEvent[];
  /** the barrier's held queue for each seat, when this tick closed a segment */
  reveal: [EngineEvent[], EngineEvent[]] | null;
  /** …and the playback, per seat, exactly as main.ts sendReveal builds it */
  playback: [ReturnType<typeof playbackFrames>, ReturnType<typeof playbackFrames>] | null;
}

/** `sendUpdate`'s event filter, for `seat`. */
const onWire = (evs: EngineEvent[], seat: Seat): EngineEvent[] =>
  evs.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, NAMES));

/**
 * Apply one action to a room exactly the way `server/main.ts` does: apply,
 * drain the forced steps, then either stay inside the segment (each seat gets
 * their own events, plus whatever was not held from them) or close it — the
 * held queue and the held frames are taken BEFORE openSegment() clears them,
 * and turned into each seat's playback by the one builder main.ts uses.
 */
function tick(room: Room, a: Action): Tick {
  const wasKey = room.segKey;
  const events = applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    events.push(...applyToRoom(room, f));
  }
  const opp = other(a.seat);
  const nowKey = segmentKey(room.state);
  if (wasKey === nowKey && wasKey !== null) {
    return { toActor: events, toOpp: unheldFor(room, opp, events), reveal: null, playback: null };
  }
  const held: [EngineEvent[], EngineEvent[]] = [[], []];
  if (wasKey !== null) {
    held[0] = room.heldEvents[0].filter(e => !events.includes(e));
    held[1] = room.heldEvents[1].filter(e => !events.includes(e));
  }
  const frames: [HeldFrame[], HeldFrame[]] = room.heldFrames;
  const close: SegmentClose | null = room.closing;
  openSegment(room);
  const pb = (seat: Seat) => playbackFrames({
    seat, held: frames[seat]!, tail: events, close: close!, redact: evs => onWire(evs, seat),
  });
  return {
    toActor: events,
    toOpp: wasKey === nowKey ? unheldFor(room, opp, events) : events,
    reveal: wasKey !== null ? held : null,
    playback: wasKey !== null && close && wasKey !== 'plan' ? [pb(0), pb(1)] : null,
  };
}

/** `main.ts::visibleLog` — the whole log as `seat` may currently read it (the
 * resync channel: a reconnect, a rejoin, the push after an undo). */
const visibleLog = (room: Room, seat: Seat): string[] =>
  redactLog(unheldFor(room, seat, room.events), seat, NAMES);

/** both seats done planning, both done hasting, both battle rounds skipped on
 * an empty board — the room is in the hidden `deploy` segment. */
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

const giveResources = (room: Room, seat: Seat, kind: string, n: number): void => {
  for (let i = 0; i < n; i++) {
    room.state.players[seat]!.resources.push({ kind, state: 'open' } as never);
  }
};

/** put a card in hand, return its index */
const give = (room: Room, seat: Seat, name: CardName): number => {
  room.state.players[seat]!.hand.push(name);
  return room.state.players[seat]!.hand.length - 1;
};

/** a deployment room with the deploying seat's Oracle of Foretelling resolved
 * (and its cache-one answered), the step still open */
function oracleInDeployment(code: string, seed: number) {
  const room = createRoom(code, seed, [...NAMES]);
  toDeployment(room);
  assert.equal(room.segKey, 'deploy', 'the room is inside the hidden deployment segment');
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveResources(room, A, 'water', 3);
  const revealed = deckOf(room.state, A).slice(0, 5);   // read BEFORE it resolves
  const play = tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Oracle of Foretelling') });
  const choose = tick(room, { type: 'decide', seat: A, choice: 1 });
  assert.equal(room.segKey, 'deploy', 'and it is still inside it afterwards');
  return { room, A, D, revealed, play, choose };
}

/** close the open deployment: the deploying seat finishes first, the other closes it */
const closeDeployment = (room: Room, A: Seat, D: Seat): Tick => {
  tick(room, { type: 'doneDeploying', seat: A });
  const close = tick(room, { type: 'doneDeploying', seat: D });
  assert.ok(close.reveal, 'the second done-flag closed the segment');
  return close;
};

const reveals = (evs: readonly EngineEvent[]) => evs.filter(e => e.type === 'glimpsed');

// ══ §1  HELD — nothing of the glimpse reaches the opponent mid-step ═══════

test('R310 §1: inside deployment the opponent is sent nothing of a Glimpse — live or on a resync', () => {
  const { room, A, D, revealed, play, choose } = oracleInDeployment('R310A', 20301);

  assert.deepEqual(play.toOpp, [], 'the Oracle tick sends the opponent nothing at all — the reveal included');
  assert.deepEqual(choose.toOpp, [], 'nor does the cache-one answer');
  assert.ok(room.heldEvents[D]!.some(e => e.type === 'glimpsed'),
    'the reveal is parked for the barrier with the rest of the step');
  assert.ok(!visibleLog(room, D).some(l => l.includes(`${NAMES[A]} glimpses`)),
    'a reconnect mid-deployment is not told the reveal either');
  for (const name of revealed) {
    assert.ok(!visibleLog(room, D).some(l => l.includes(name)),
      `the opponent's log names none of the revealed cards (${name})`);
  }

  // the glimpser's own reveal is their own action, live as ever
  const mine = reveals(onWire(play.toActor, A));
  assert.equal(mine.length, 1, 'the glimpser is sent their own reveal on the tick it happens');
  assert.deepEqual(mine[0]!.data?.['cards'], revealed, '…carrying the revealed cards in order');
});

test('R310 §1: the haste step holds a Glimpse the same way (Seer of Empty Spaces)', () => {
  const room = createRoom('R310B', 20302, [...NAMES]);
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  assert.equal(room.segKey, 'haste', 'the haste step is its own hidden segment');
  const A: Seat = 1, D: Seat = 0;
  giveResources(room, A, 'light', 3);
  const top = deckOf(room.state, A)[0]!;
  const t = tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Seer of Empty Spaces') });

  assert.equal(room.segKey, 'haste', 'still inside the haste step');
  assert.ok(reveals(t.toActor).length === 1, 'non-vacuous: the spawn trigger really did glimpse');
  assert.deepEqual(t.toOpp, [], 'and the opponent is sent none of it');
  assert.ok(!visibleLog(room, D).some(l => l.includes(top)), 'not even on a resync');

  tick(room, { type: 'doneHaste', seat: A });
  const close = tick(room, { type: 'doneHaste', seat: D });
  assert.ok(close.reveal, 'the haste step closed');
  const frames = close.playback![D]!.frames.filter(f => reveals(f.events).length);
  assert.equal(frames.length, 1, 'and the reveal plays in exactly one frame of the haste recap');
  assert.ok(reveals(frames[0]!.events)[0]!.msg.includes(top), 'naming the card it revealed');
});

test('R310 §1: the shared deck and recycle counts do not move under a hidden Glimpse', () => {
  // The count-only copy of the same leak: Glimpse 5 takes five off the shared
  // deck and recycles four. Served live, the opponent's deck counter ticks
  // down mid-deployment and says "they glimpsed" without the event.
  const room = createRoom('R310C', 20303, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  const count = (seat: Seat) => {
    const v = viewFor(room.state, seat, room.segSnapshot);
    return { deck: v.sharedDeck.length, recycled: v.sharedRecycled?.length ?? 0 };
  };
  const live = () => ({ deck: room.state.sharedDeck.length, recycled: room.state.sharedRecycled?.length ?? 0 });
  const start = live();
  assert.deepEqual(count(D), start, 'the counts the step opens on');
  giveResources(room, A, 'water', 3);
  tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Oracle of Foretelling') });
  tick(room, { type: 'decide', seat: A, choice: 0 });
  assert.notDeepEqual(live(), start, 'non-vacuous: the glimpse really moved the shared piles');
  assert.deepEqual(count(D), start, "the opponent's view still shows the counts the step opened on");
  assert.deepEqual(count(A), start, '…and so does the glimpser\'s (one shape for both seats, so the redaction is no tell)');
  const close = closeDeployment(room, A, D);
  void close;
  assert.deepEqual(count(D), live(), 'after the barrier both seats see the real counts');
  assert.deepEqual(count(A), live());
});

// ══ §2  FLUSHED EXACTLY ONCE, AT THE BARRIER ═════════════════════════════

test('R310 §2: the barrier delivers the reveal exactly once, and the finished log holds it once', () => {
  const { room, A, D, revealed } = oracleInDeployment('R310D', 20304);
  const close = closeDeployment(room, A, D);
  const toD = close.reveal![D]!;

  assert.equal(reveals(toD).length, 1, 'the held queue the barrier flushes carries the reveal, once');
  assert.deepEqual(reveals(toD)[0]!.data?.['cards'], revealed, '…with every revealed card');
  assert.ok(toD.some(e => e.type === 'spellPlayed' && e.msg.includes('Oracle of Foretelling')),
    'beside what was played');
  assert.ok(toD.some(e => e.type === 'cached' && e.msg.includes(revealed[1]!)), '…and which card was cached');
  assert.equal(reveals(close.toActor).length, 0, 'the closing action itself repeats nothing');
  assert.equal(room.events.filter(e => e.type === 'glimpsed').length, 1,
    'the room history holds one glimpse event — held, never duplicated');
  assert.equal(visibleLog(room, D).filter(l => l.includes(`${NAMES[A]} glimpses`)).length, 1,
    "the opponent's reconnect log after the barrier holds exactly one reveal line");
  assert.equal(visibleLog(room, A).filter(l => l.includes(`${NAMES[A]} glimpses`)).length, 1,
    "and the glimpser's holds exactly one too");
});

// ══ §3  IN THE PLAYBACK FRAME OF THE ACTION THAT MADE IT ═════════════════

test('R310 §3: the reveal plays in the recap, in the frame of the Oracle play, and nowhere else', () => {
  const { room, A, D, revealed } = oracleInDeployment('R310E', 20305);
  const close = closeDeployment(room, A, D);
  const pb = close.playback![D]!;

  const withReveal = pb.frames.filter(f => reveals(f.events).length);
  assert.equal(withReveal.length, 1, 'exactly one frame of the opponent\'s recap carries the reveal');
  const f: PlaybackFrame = withReveal[0]!;
  assert.equal(f.kind, 'opp', 'it is one of the opponent\'s moves, not the end of turn');
  assert.ok(f.events.some(e => e.type === 'spellPlayed' && e.msg.includes('Oracle of Foretelling')),
    'and it is the frame of the action that glimpsed — the Oracle play itself');
  assert.equal(reveals(f.events).length, 1, 'once in that frame');
  assert.deepEqual(reveals(f.events)[0]!.data?.['cards'], revealed,
    'carrying the cards the client\'s notice shows');
  assert.equal(reveals(pb.rest).length, 0, 'and not again in the events after the last frame');
  // the order: the reveal frame comes before the frame that caches one of them
  const at = pb.frames.indexOf(f);
  const cachedAt = pb.frames.findIndex(x => x.events.some(e => e.type === 'cached'));
  assert.ok(cachedAt > at, 'the cache-one answer is its own later frame — the recap tells it in order');

  // the glimpser watches no recap of their own move
  assert.equal(close.playback![A]!.frames.filter(x => reveals(x.events).length).length, 0,
    "the glimpser's playback (the other seat's moves) does not replay their own reveal");
});

// ══ §4  NOTHING ESCAPES THE HOLD ═════════════════════════════════════════

test('R310 §4: of everything a hidden step emits, nothing reaches the other seat before the barrier', () => {
  // Derived, not enumerated: drive the hidden steps, collect every event type
  // the actor's ticks produced, and assert not one of them went to the
  // opponent live. An exemption — R235's, or any other — reddens this.
  const seen = new Set<string>();
  const leaked: string[] = [];
  const room = createRoom('R310F', 20306, [...NAMES]);
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  const H: Seat = 1;
  giveResources(room, H, 'light', 3);
  const note = (t: Tick) => {
    for (const e of t.toActor) seen.add(e.type);
    for (const e of t.toOpp) leaked.push(e.type);
  };
  note(tick(room, { type: 'playCard', seat: H, handIndex: give(room, H, 'Seer of Empty Spaces') }));
  for (const seat of [0, 1] as Seat[]) {
    if (room.state.hasteDone && !room.state.hasteDone[seat]) tick(room, { type: 'doneHaste', seat });
  }
  for (let g = 0; g < 2 && room.state.phase === 'battle' && room.state.battle; g++) {
    tick(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  }
  assert.equal(room.segKey, 'deploy');
  const A = room.state.deployPlayer! as Seat;
  giveResources(room, A, 'water', 3);
  giveResources(room, A, 'fire', 1);
  note(tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Oracle of Foretelling') }));
  note(tick(room, { type: 'decide', seat: A, choice: 0 }));
  note(tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Ignis Sprite') }));

  assert.ok(seen.has('glimpsed'), 'non-vacuous: the sample includes reveals');
  assert.ok(seen.size >= 8, `the sample is broad enough to mean something (saw ${seen.size} event types)`);
  assert.deepEqual(leaked, [], 'not one event of a hidden step reached the other seat live');
});

test('R310 §4: a hidden step with no reveal in it leaks nothing either (the negative control)', () => {
  const room = createRoom('R310G', 20307, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveResources(room, A, 'fire', 1);
  const before = visibleLog(room, D).length;
  const t = tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Ignis Sprite') });
  assert.ok(t.toActor.length > 0, 'the play really produced events');
  assert.deepEqual(t.toOpp, [], 'and not one of them reaches the opponent');
  assert.equal(visibleLog(room, D).length, before, "the opponent's log did not move at all");
});

test('R310 §4: the seat channel can tell the two seats apart (the positive control)', () => {
  // docs/13 §7.4: an observation channel needs a control proving it can SEE.
  // If `visibleLog`/`unheldFor` ever degraded to "nothing", §1 would pass for
  // the wrong reason; this is the assertion that would not.
  const { room, A, D } = oracleInDeployment('R310H', 20308);
  const mine = visibleLog(room, A), theirs = visibleLog(room, D);
  assert.ok(mine.length > theirs.length, 'the two seats are served DIFFERENT logs inside a hidden segment');
  assert.ok(mine.some(l => l.includes(`${NAMES[A]} glimpses`)) && !theirs.some(l => l.includes(`${NAMES[A]} glimpses`)),
    'and the difference includes the reveal');
});

test('R310 §4: main.ts composes the wire the way this file re-builds it, and no runner filters the hold', () => {
  // This file cannot import main.ts (it boots a server), so the compositions
  // it re-builds are read off its source: the one hop between rooms.ts and the
  // wire that no test can call.
  const src = readFileSync(join(SERVER, 'main.ts'), 'utf8');
  assert.match(src, /sendUpdate\(room, other\(seat\), \[\.\.\.oppEvents, \.\.\.unheldFor\(room, other\(seat\), events\)\]\)/,
    "main.ts's mid-segment update to the opponent carries only what this room did not hold from them");
  assert.match(src, /const held = new Set\(room\.heldEvents\[seat\]\);\n\s*return redactLog\(room\.events\.filter\(e => !held\.has\(e\)\), seat, room\.names\);/,
    'visibleLog is still "the whole history minus what is held for you"');
  assert.match(src, /playbackFrames\(\{ seat, held: playback\.held, tail: tailEvents, close: playback\.close, redact \}\)/,
    'and sendReveal builds the recap with the same builder §3 calls');
  // R310: the exemption is gone from every hidden-step runner — the room, Learn
  // to Play and the replay viewer — and from view.ts, where it lived. A new
  // spelling of it would be caught by §4's measurement for the room; this is
  // the cheap net for the two in-browser runners, which run no Room.
  for (const [file, text] of [
    ['server/view.ts', readFileSync(join(SERVER, 'view.ts'), 'utf8')],
    ['server/rooms.ts', readFileSync(join(SERVER, 'rooms.ts'), 'utf8')],
    ['ui/solo.ts', readFileSync(join(UI, 'solo.ts'), 'utf8')],
    ['ui/replayserver.ts', readFileSync(join(UI, 'replayserver.ts'), 'utf8')],
  ] as const) {
    assert.doesNotMatch(text, /escapesHold\s*\(|PUBLIC_INSIDE_HIDDEN_SEGMENT\s*[:=]/,
      `${file} has no exemption from the hidden hold (R310 reversed R235)`);
  }
});
