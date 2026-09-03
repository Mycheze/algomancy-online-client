/* R235 (owner ruling, 2026-08-28) — A REVEAL INSIDE A HIDDEN SIMULTANEOUS
 * STEP IS PUBLIC **IMMEDIATELY**. "The card says REVEAL."
 *
 * ── WHAT WAS TRUE BEFORE THIS FILE
 *
 * R188 (round 27, 159-glimpse-reveal-visibility.test.ts) proved end to end
 * that a Glimpse reveal reaches the other seat through every redaction hop —
 * `visibleToSeat`, `redactEvent`, `redactLog`, `viewFor` — and then found the
 * one place it does not arrive: a reveal that happens INSIDE a hidden
 * simultaneous segment (the resource step, the haste step, deployment).
 * `server/rooms.ts` parks the opponent's copy of every event such a step
 * produces in `heldEvents` until the barrier, and the hold was ALL-OR-NOTHING
 * per segment. `Oracle of Foretelling` is `timing: deploy`, so every single
 * Oracle reveal was in that case: five card names, revealed by a card that
 * prints the word REVEAL, silent to the opponent until deployment ended.
 *
 * The owner ruled: immediately. So the hold gains a per-event exemption
 * (`rooms.ts::escapesHold`), and this file is the guard on both halves of it.
 *
 * ── ⚠ WHY THE SECOND HALF IS THE HARD ONE
 *
 * An exemption that is too WIDE is not a smaller bug than no exemption — it is
 * a bigger one, because it leaks the hidden step itself, which is a deliberate
 * information rule (docs/03) and not an engine accident. The reveal is public;
 * the fact that a card resolved inside a hidden step is not. So every §1
 * assertion here has a §2 twin: the opponent CAN see the reveal mid-step, and
 * the opponent still CANNOT see the play, the resolution, the cache or the
 * spawn that surrounded it. **§2 is the half that catches an over-wide
 * exemption, and it is the half that would be missing if this file had been
 * written from the ruling alone.**
 *
 * ── ⚠ AND WHY NOTHING HERE READS `h.log` OR HAND-BUILDS AN EVENT
 *
 * docs/13 §7.4 / R203: `Harness.absorb()` flattens every event into one
 * seatless log, so a secrecy assertion written against it reads the same
 * whether the information is shared or not — two genuine leaks survived 153
 * test files that way. There is no Harness in this file at all. Every claim is
 * made against a real `Room` driven through `applyToRoom`, and read back
 * through the exact three compositions `server/main.ts` puts on the wire:
 *
 *     sendUpdate   → viewFor(state, seat, room.segSnapshot)
 *                  + events.filter(visibleToSeat).map(redactEvent)
 *     visibleLog   → redactLog(events not held for seat, seat, names)
 *     sendReveal   → the seat's own held queue, at the barrier
 *
 * §4 keeps that honest with a source guard: the two lines of `main.ts` this
 * file re-composes are asserted to still BE those lines, so §1 cannot quietly
 * become a test of a helper nothing calls.
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
import { redactEvent, redactLog, viewFor, visibleToSeat } from '../view.ts';
// type-only, so it is erased: the RUNTIME import of rooms.ts has to wait until
// ALGO_GAMES_DIR below is set.
import type { Room } from '../rooms.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..');

// rooms.ts PERSISTS every room it touches to ALGO_GAMES_DIR (server/games by
// default, which on the deploy box is live data). Point it at a throwaway
// before the module is loaded — hence the dynamic import below, which is the
// only reason this file has one.
process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-203-'));
const {
  applyToRoom, createRoom, escapesHold, openSegment, segmentKey, unheldFor,
} = await import('../rooms.ts');

const NAMES: [string, string] = ['Player 1', 'Player 2'];
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const deckOf = (s: GameState, seat: Seat): CardName[] => s.decks?.[seat] ?? s.sharedDeck;

/** What one tick of `main.ts`'s action handler puts on each seat's wire.
 * `reveal` is non-null only on the tick that closed a hidden segment. */
interface Tick {
  /** the actor's own events (never held from them) */
  toActor: EngineEvent[];
  /** what the OPPONENT is sent live — R235: oppEvents + whatever escaped */
  toOpp: EngineEvent[];
  /** the barrier's reveal for each seat, when this tick closed a segment */
  reveal: [EngineEvent[], EngineEvent[]] | null;
}

/**
 * Apply one action to a room exactly the way `server/main.ts` does: apply,
 * drain the forced steps, then either stay inside the segment (each seat gets
 * their own events, plus anything not held from them — R235) or close it and
 * flush each seat's held queue as the reveal.
 *
 * This is `test-hidden.ts::actOn` plus the wire split; it invents nothing —
 * `applyToRoom`, `segmentKey`, `openSegment` and `unheldFor` are rooms.ts's
 * own exports, and §4 asserts main.ts still composes them this way.
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
    return { toActor: events, toOpp: unheldFor(room, opp, events), reveal: null };
  }
  const held: [EngineEvent[], EngineEvent[]] = [[], []];
  if (wasKey !== null) {
    held[0] = room.heldEvents[0].filter(e => !events.includes(e));
    held[1] = room.heldEvents[1].filter(e => !events.includes(e));
  }
  openSegment(room);
  return {
    toActor: events,
    toOpp: wasKey === nowKey ? unheldFor(room, opp, events) : events,
    reveal: wasKey !== null ? held : null,
  };
}

/** `sendUpdate`'s event filter, for `seat`. */
const onWire = (evs: EngineEvent[], seat: Seat): EngineEvent[] =>
  evs.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, NAMES));

/** the log lines a batch would add to `seat`'s screen */
const linesOf = (evs: EngineEvent[], seat: Seat): string[] =>
  onWire(evs, seat).filter(e => e.msg).map(e => e.msg);

/** `main.ts::visibleLog` — the whole log as `seat` may currently read it (the
 * resync channel: a reconnect, a rejoin, the push after an undo). */
const visibleLog = (room: Room, seat: Seat): string[] =>
  redactLog(unheldFor(room, seat, room.events), seat, NAMES);

/** both seats done planning, both done hasting, both battle rounds skipped on
 * an empty board — the room is in the hidden `deploy` segment. */
function toDeployment(room: Room): void {
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  toBattle(room);
  if (room.state.battle) tick(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  if (room.state.phase === 'battle' && room.state.battle) {
    tick(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  }
}

/** close the haste step (R228 opens it unconditionally) */
function toBattle(room: Room): void {
  for (const seat of [0, 1] as Seat[]) {
    if (room.state.hasteDone && !room.state.hasteDone[seat]) tick(room, { type: 'doneHaste', seat });
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

// ══ §1  THE REVEAL ESCAPES — the R188 case, ruled ═══════════════════════
//
// Oracle of Foretelling, `timing: deploy`, glimpsing 5 inside the hidden
// deployment segment: the exact situation R188 proved was silent.

test('R235 §1: the opponent is sent the Glimpse reveal LIVE, inside the hidden deploy segment', () => {
  const room = createRoom('R235A', 20301, [...NAMES]);
  toDeployment(room);
  assert.equal(room.segKey, 'deploy', 'the room is inside the hidden deployment segment');
  const A = room.state.deployPlayer! as Seat, D = other(A);

  giveResources(room, A, 'water', 3);
  const revealed = deckOf(room.state, A).slice(0, 5);   // read BEFORE it resolves
  const t = tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Oracle of Foretelling') });

  assert.equal(room.segKey, 'deploy', 'and it is still inside it afterwards — nothing has been revealed at a barrier');

  const glimpsed = onWire(t.toOpp, D).filter(e => e.type === 'glimpsed');
  assert.equal(glimpsed.length, 1, 'the non-deploying seat receives the reveal on this very tick');
  for (const name of revealed) {
    assert.ok(glimpsed[0]!.msg.includes(name), `the reveal the opponent receives names ${name}`);
  }
  assert.deepEqual(glimpsed[0]!.data?.['cards'], revealed,
    '…and carries the revealed cards as data, in revealed order');

  // the resync channel says the same: a reconnect mid-deployment does not
  // un-reveal what was revealed.
  assert.ok(visibleLog(room, D).some(l => revealed.every(n => l.includes(n))),
    'and a full log resync mid-segment still carries the reveal to that seat');
});

test('R235 §1: the reveal line stands on its own — it names the glimpser and every card', () => {
  // The exemption is the `glimpsed` event and NOTHING ELSE, so the line the
  // opponent gets arrives with no framing around it. That is only acceptable
  // because the line is self-contained BY CONSTRUCTION (engine.ts::glimpse
  // writes `<player> glimpses N: <names> — …`), which is what this asserts.
  // If a future edit to that message drops the player name, the reveal becomes
  // the orphan line the ruling was warned about and this reddens.
  const room = createRoom('R235B', 20302, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveResources(room, A, 'water', 3);
  const revealed = deckOf(room.state, A).slice(0, 5);
  const t = tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Oracle of Foretelling') });

  const lines = linesOf(t.toOpp, D);
  assert.equal(lines.length, 1, 'exactly one line reaches the opponent: the reveal');
  assert.ok(lines[0]!.startsWith(`${NAMES[A]} glimpses`),
    'and it says WHO revealed, so it is a sentence rather than a bare list of card names');
  for (const name of revealed) assert.ok(lines[0]!.includes(name), `it lists ${name}`);
});

// ══ §2  …AND THE HIDDEN STEP IS STILL HIDDEN ═══════════════════════════
//
// The half that catches an over-wide exemption.

test('R235 §2: the play, the resolution, the cache and the spawn around it are still held', () => {
  const room = createRoom('R235C', 20303, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveResources(room, A, 'water', 3);
  const revealed = deckOf(room.state, A).slice(0, 5);
  const t = tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Oracle of Foretelling') });

  // the actor's own tick carries the whole story…
  const mine = t.toActor.map(e => e.type);
  assert.ok(mine.includes('spellPlayed') && mine.includes('resolved') && mine.includes('glimpsed'),
    'the glimpser sees the play, the resolution and the reveal');

  // …the opponent's carries the reveal and nothing else.
  assert.deepEqual(t.toOpp.map(e => e.type), ['glimpsed'],
    'ONE event escapes the hold, and it is the reveal');
  const oppLog = visibleLog(room, D);
  assert.ok(!oppLog.some(l => l.includes('plays Oracle of Foretelling')),
    'the opponent is NOT told a card was played inside the hidden step');
  assert.ok(!oppLog.some(l => l.startsWith('Resolving Oracle of Foretelling')),
    'nor that it resolved — a reveal is public, a hidden step is not');

  // the STATE channel is untouched by all of this: the opponent's half of the
  // segment is still served from the freeze.
  const vD = viewFor(room.state, D, room.segSnapshot);
  assert.equal(vD.decision, null, "the glimpser's choose-one decision is not shown to the opponent");
  assert.deepEqual(vD.stack.filter(it => it.controller === A), [],
    "the resolving Oracle is not on the opponent's stack (R144)");

  // answer it: which of the five was CACHED is part of the hidden step too.
  const t2 = tick(room, { type: 'decide', seat: A, choice: 1 });
  assert.deepEqual(t2.toOpp, [], 'the choice itself leaks nothing at all');
  assert.ok(!visibleLog(room, D).some(l => l.includes('caches')),
    'and WHICH card was cached stays hidden until the barrier (R41 is a claim about the cache, not about the step)');
  assert.deepEqual(viewFor(room.state, D, room.segSnapshot).players[A]!.cache ?? [], [],
    "…in the state channel too: the opponent's view of the cache is still the freeze");
  assert.ok(!Object.values(viewFor(room.state, D, room.segSnapshot).entities)
    .some(e => e.controller === A && e.card === 'Oracle of Foretelling'),
    'and the Oracle unit itself has not appeared on the opponent\'s board');
  void revealed;
});

test('R235 §2: the barrier still delivers everything the hold kept — and does not repeat the reveal', () => {
  const room = createRoom('R235D', 20304, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveResources(room, A, 'water', 3);
  const revealed = deckOf(room.state, A).slice(0, 5);
  tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Oracle of Foretelling') });
  tick(room, { type: 'decide', seat: A, choice: 1 });

  tick(room, { type: 'doneDeploying', seat: A });
  const close = tick(room, { type: 'doneDeploying', seat: D });
  assert.ok(close.reveal, 'the second done-flag closed the segment');
  const toD = close.reveal![D]!;

  assert.ok(toD.some(e => e.type === 'spellPlayed' && e.msg.includes('Oracle of Foretelling')),
    'at the barrier the opponent finally learns WHAT was played');
  assert.ok(toD.some(e => e.type === 'cached' && e.msg.includes(revealed[1]!)),
    '…and which card was cached');
  assert.equal(toD.filter(e => e.type === 'glimpsed').length, 0,
    'and the reveal is NOT repeated — they were shown it when it happened');
  assert.equal(visibleLog(room, D).filter(l => l.includes(`${NAMES[A]} glimpses`)).length, 1,
    'so the finished log holds exactly one reveal line, not two');
});

// ══ §3  IT IS A RULE ABOUT EVENTS, NOT ABOUT ORACLE ════════════════════

test('R235 §3: the same exemption applies in the HASTE segment (Seer of Empty Spaces)', () => {
  const room = createRoom('R235E', 20305, [...NAMES]);
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  assert.equal(room.segKey, 'haste', 'the haste step is its own hidden segment');
  const A: Seat = 1, D: Seat = 0;
  giveResources(room, A, 'light', 3);
  const top = deckOf(room.state, A)[0]!;
  const t = tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Seer of Empty Spaces') });

  assert.equal(room.segKey, 'haste', 'still inside the haste step');
  assert.deepEqual(t.toOpp.map(e => e.type), ['glimpsed'],
    "the spawn trigger's Glimpse 1 escapes the haste hold, alone");
  assert.ok(t.toOpp[0]!.msg.includes(top), 'and names the card it revealed');
  const oppLog = visibleLog(room, D);
  assert.ok(!oppLog.some(l => l.includes('spawns Seer of Empty Spaces')),
    'the opponent is not told a unit landed in the haste step');
  assert.ok(!Object.values(viewFor(room.state, D, room.segSnapshot).entities)
    .some(e => e.controller === A), "nor shown it on the opponent's board");
});

test('R235 §3: a hidden step with NO reveal in it leaks nothing (the negative control)', () => {
  const room = createRoom('R235F', 20306, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveResources(room, A, 'fire', 1);
  const before = visibleLog(room, D).length;
  const t = tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Ignis Sprite') });

  assert.ok(t.toActor.length > 0, 'the play really produced events');
  assert.deepEqual(t.toOpp, [], 'and not one of them reaches the opponent');
  assert.equal(visibleLog(room, D).length, before,
    "the opponent's log did not move at all — the hold is intact for everything but a reveal");
  assert.ok(room.heldEvents[D]!.length >= t.toActor.filter(e => e.msg).length,
    'every one of them is parked for the barrier instead');
});

test('R235 §3: `glimpsed` is the ONLY exemption, measured over what these steps actually emit', () => {
  // Derived, not enumerated: drive the two hidden steps above, collect every
  // event type they produced, and assert escapesHold() says yes to exactly
  // one of them. Widening the set without a ruling reddens this.
  const seen = new Set<string>();
  const room = createRoom('R235G', 20307, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat;
  giveResources(room, A, 'water', 3);
  giveResources(room, A, 'fire', 1);
  for (const e of tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Oracle of Foretelling') }).toActor) seen.add(e.type);
  for (const e of tick(room, { type: 'decide', seat: A, choice: 0 }).toActor) seen.add(e.type);
  for (const e of tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Ignis Sprite') }).toActor) seen.add(e.type);

  assert.ok(seen.size >= 8, `the sample is broad enough to mean something (saw ${seen.size} event types)`);
  const escaping = [...seen].filter(t => escapesHold({ type: t, msg: '', data: {} } as EngineEvent));
  assert.deepEqual(escaping, ['glimpsed'],
    'of everything a hidden step emits, only the reveal is public immediately');
});

// ══ §4  THE COMPOSITIONS ABOVE ARE THE ONES main.ts USES ═══════════════

test('R235 §4: server/main.ts really sends the un-held events to the opponent mid-segment', () => {
  // §1's live claim is only worth something if `sendUpdate(room, other(...))`
  // in production carries `unheldFor(...)`. This file cannot import main.ts
  // (it boots a server), so the composition is read off its source. It is the
  // one hop between rooms.ts and the wire that no test can call.
  const src = readFileSync(join(SERVER, 'main.ts'), 'utf8');
  assert.match(src, /sendUpdate\(room, other\(conn\.seat\), \[\.\.\.oppEvents, \.\.\.unheldFor\(room, other\(conn\.seat\), events\)\]\)/,
    "main.ts's mid-segment update to the opponent carries whatever this room did not hold from them");
  assert.match(src, /const held = new Set\(room\.heldEvents\[seat\]\);\n\s*return redactLog\(room\.events\.filter\(e => !held\.has\(e\)\), seat, room\.names\);/,
    'and visibleLog is still "the whole history minus what is held for you", which is what this file re-composes');
});

test('R235 §4: the seat channel can tell the two seats apart (the positive control)', () => {
  // docs/13 §7.4: an observation channel needs a control proving it can SEE.
  // If `visibleLog`/`unheldFor` ever degraded to "everything", §2 would pass
  // for the wrong reason; this is the assertion that would not.
  const room = createRoom('R235H', 20308, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveResources(room, A, 'fire', 1);
  tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Ignis Sprite') });
  const mine = visibleLog(room, A), theirs = visibleLog(room, D);
  assert.ok(mine.length > theirs.length,
    'the two seats are served DIFFERENT logs inside a hidden segment');
  assert.ok(mine.some(l => l.includes('Ignis Sprite')) && !theirs.some(l => l.includes('Ignis Sprite')),
    'and the difference is exactly the hidden step');
});
