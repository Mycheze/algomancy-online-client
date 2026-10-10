/**
 * Comprehensive rules, unit U24 (Annex D part 2: digital play conventions —
 * display, reveal, tutorial, modes, deckbuilding) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U24
 * (data/comprehensive-rules/build/probes/U24/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U24.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 *
 * Annex D is about the client and the server as much as the engine, so some of
 * these drive server/rooms.ts in-process (against a throwaway ALGO_GAMES_DIR,
 * no port bound), the rating folds in server/, or the tutorial deal in ui/,
 * the way neighbouring engine tests do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { apply, checkSingleDeck, forcedAction, legalActions, makesUnits } from '../src/apply.ts';
import { E } from '../src/engine.ts';
import { DECK_LIST, createsOf } from '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { Action, CardName, EngineEvent, GameState, Seat } from '../src/types.ts';
import { playbackFrames, redactEvent, redactLog, viewFor, visibleToSeat } from '../../server/view.ts';
import type { HeldFrame, SegmentClose } from '../../server/view.ts';
import { foldRatings, START_RATING } from '../../server/rating.ts';
import { foldCardLadder } from '../../server/cardladder.ts';
import { concessionWeight, EARLY_K_SCALE, WALKOVER_PENALTY } from '../../server/concession.ts';
import { METHOD_LABELS, methodBlurbs, TRIO_METHODS } from '../../server/trio.ts';
import { dealScenario, isScenarioId, passiveMove, SANDBOX_ID, YOU } from '../../server/scenarios.ts';
import { CONSTRUCT, fallbackMove } from '../../ui/bot.ts';
import { TUTORIAL_DEAL } from '../../ui/learn.ts';
import { assignSplitIndex, assignSplitStepper, assignSplitSubmit } from '../../ui/inspect.ts';
import type { AssignStateLike } from '../../ui/inspect.ts';
import { finishBattle, give, giveResources, logFor, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
// type-only, so it is erased: the runtime import of rooms.ts has to wait until
// ALGO_GAMES_DIR below is set (rooms.ts persists every room it touches).
import type { Room } from '../../server/rooms.ts';

process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-435-'));
const {
  applyToRoom, createRoom, openSegment, roomElementCount, roomLobby, roomWaiting, segmentKey, setRoomDeck, unheldFor,
} = await import('../../server/rooms.ts');

const NAMES: [string, string] = ['Player 1', 'Player 2'];
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/* ── reveal: hidden simultaneous steps, driven through a real Room ─────── */

const deckOf = (s: GameState, seat: Seat): CardName[] => s.decks?.[seat] ?? s.sharedDeck;
const onWire = (evs: EngineEvent[], seat: Seat) => evs.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, NAMES));

/** apply one action plus any forced follow-ups; open a new segment when the step changed */
function tick(room: Room, a: Action): { toActor: EngineEvent[]; toOpp: EngineEvent[]; closed: boolean; held?: [EngineEvent[], EngineEvent[]] } {
  const wasKey = room.segKey;
  const events = applyToRoom(room, a);
  for (let g = 0; g < 8; g++) { const f = forcedAction(room.state); if (!f) break; events.push(...applyToRoom(room, f)); }
  const nowKey = segmentKey(room.state);
  if (wasKey === nowKey && wasKey !== null) return { toActor: events, toOpp: unheldFor(room, other(a.seat), events), closed: false };
  const held: [EngineEvent[], EngineEvent[]] = [[...room.heldEvents[0]], [...room.heldEvents[1]]];
  openSegment(room);
  return { toActor: events, toOpp: events, closed: wasKey !== null, held };
}
const visibleLog = (room: Room, seat: Seat) => redactLog(unheldFor(room, seat, room.events), seat, NAMES);
function roomToDeployment(room: Room): void {
  tick(room, { type: 'donePlanning', seat: 0 }); tick(room, { type: 'donePlanning', seat: 1 });
  for (const seat of [0, 1] as Seat[]) if (room.state.hasteDone && !room.state.hasteDone[seat]) tick(room, { type: 'doneHaste', seat });
  for (let g = 0; g < 2 && room.state.phase === 'battle' && room.state.battle; g++)
    tick(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
}
const giveRes = (room: Room, seat: Seat, kind: string, n: number) => { for (let i = 0; i < n; i++) room.state.players[seat]!.resources.push({ kind, state: 'open' } as never); };
const giveCard = (room: Room, seat: Seat, name: CardName) => { room.state.players[seat]!.hand.push(name); return room.state.players[seat]!.hand.length - 1; };

test('cr:annexd.reveal.glimpse.own — the glimpser is sent their own revealed cards on the glimpsing action, and the opponent is sent nothing', () => {
  const room = createRoom('U24A', 24201, [...NAMES]);
  roomToDeployment(room);
  assert.equal(room.segKey, 'deploy');
  const A = room.state.deployPlayer! as Seat;
  giveRes(room, A, 'water', 3);
  const revealed = deckOf(room.state, A).slice(0, 5);
  const t = tick(room, { type: 'playCard', seat: A, handIndex: giveCard(room, A, 'Oracle of Foretelling' as CardName) });
  const mine = onWire(t.toActor, A).filter(e => e.type === 'glimpsed');
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0]!.data?.['cards'], revealed, 'the actor wire carries the top five cards');
  assert.deepEqual(t.toOpp, [], 'the opponent wire is empty');
});

test('cr:annexd.reveal.glimpse.once — the barrier delivers the glimpse to the other player once, and the log holds one line', () => {
  const room = createRoom('U24C', 24203, [...NAMES]);
  roomToDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveRes(room, A, 'water', 3);
  tick(room, { type: 'playCard', seat: A, handIndex: giveCard(room, A, 'Oracle of Foretelling' as CardName) });
  tick(room, { type: 'decide', seat: A, choice: 1 });
  assert.equal(visibleLog(room, D).filter(l => l.includes(`${NAMES[A]} glimpses`)).length, 0, 'nothing before the barrier');
  tick(room, { type: 'doneDeploying', seat: A });
  const c = tick(room, { type: 'doneDeploying', seat: D });
  assert.ok(c.closed);
  assert.equal(c.held![D]!.filter(e => e.type === 'glimpsed').length, 1, 'the held queue carries one glimpse');
  assert.equal(room.events.filter(e => e.type === 'glimpsed').length, 1, 'the room history holds it once');
  assert.equal(visibleLog(room, D).filter(l => l.includes(`${NAMES[A]} glimpses`)).length, 1, 'the opponent log holds one line');
});

test('cr:annexd.reveal.hidden-steps.frozen — resource step: whether the other player is done is shown live while the step is open', () => {
  const room = createRoom('U24P', 24301, [...NAMES]);
  assert.equal(room.segKey !== null, true, 'the resource step is a hidden segment');
  tick(room, { type: 'donePlanning', seat: 0 });
  assert.equal(room.state.phase, 'planning', 'still in the step');
  const v = viewFor(room.state, 1, room.segSnapshot);
  assert.equal(v.planningDone?.[0], true, 'seat 1 sees seat 0 finished, live through the freeze');
});

test('cr:annexd.reveal.hidden-steps.frozen — haste step: the readiness of the other player is hidden while it is open, your own is not', () => {
  const room = createRoom('U24H', 24302, [...NAMES]);
  tick(room, { type: 'donePlanning', seat: 0 }); tick(room, { type: 'donePlanning', seat: 1 });
  assert.ok(room.state.hasteDone, 'the haste step is open');
  tick(room, { type: 'doneHaste', seat: 0 });
  assert.equal(room.state.hasteDone?.[0], true, 'seat 0 really is ready');
  assert.equal(viewFor(room.state, 1, room.segSnapshot).hasteDone?.[0], false, 'seat 1 is served seat 0 as not ready');
  assert.equal(viewFor(room.state, 0, room.segSnapshot).hasteDone?.[0], true, 'seat 0 sees its own readiness');
});

test('cr:annexd.reveal.hidden-steps.frozen — deployment: the units of the other player are served as the step began', () => {
  const room = createRoom('U24D', 24303, [...NAMES]);
  roomToDeployment(room);
  assert.equal(room.segKey, 'deploy');
  const A = room.state.deployPlayer! as Seat, D = other(A);
  const count = (ents: Record<string, { controller: Seat }>) => Object.values(ents).filter(e => e.controller === A).length;
  const before = count(viewFor(room.state, D, room.segSnapshot).entities as never);
  giveRes(room, A, 'earth', 6);
  const liveBefore = count(room.state.entities as never);
  tick(room, { type: 'playCard', seat: A, handIndex: giveCard(room, A, 'Bumblecrab' as CardName) });
  for (let g = 0; g < 4 && room.state.decision?.seat === A; g++) tick(room, { type: 'decide', seat: A, choice: 0 });
  assert.ok(count(room.state.entities as never) > liveBefore, 'non-vacuous: A really put a unit on the board');
  assert.equal(count(viewFor(room.state, D, room.segSnapshot).entities as never), before, 'D still sees the step-open board');
});

test('cr:annexd.reveal.pending-choice — inside a hidden step the other player is not told a question is pending; outside it they would be', () => {
  const room = createRoom('U24Q', 24304, [...NAMES]);
  roomToDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveRes(room, A, 'water', 3);
  tick(room, { type: 'playCard', seat: A, handIndex: giveCard(room, A, 'Oracle of Foretelling' as CardName) });
  assert.equal(room.state.decision?.seat, A, 'non-vacuous: A owes an answer');
  const frozen = viewFor(room.state, D, room.segSnapshot);
  assert.equal(frozen.decision, null);
  assert.equal(frozen.pendingAsk, undefined, 'inside the step: not even the fact is served');
  const unfrozen = viewFor(room.state, D, null);
  assert.equal(unfrozen.pendingAsk?.seat, A, 'control: with no freeze the fact is served');
});

/* ── modes: concession weights, folded over saved-game rows ─────────────── */

let rowN = 0;
const row = (over: Record<string, unknown>) => ({
  code: `U24-${++rowN}`, playedAt: '2026-10-01T00:00:00Z', mode: 'constructed' as const, finished: true,
  winner: 0 as Seat, users: ['alice', 'bob'] as [string, string], rated: true, ...over,
});

test('cr:annexd.modes.concession.walkover — a rated walkover costs the conceder 5, pays the winner nothing, and counts as no rated game', () => {
  assert.equal(WALKOVER_PENALTY, 5);
  const t = foldRatings([row({ concession: { seat: 1, turn: 1 } })] as never);
  assert.equal(t.get('bob')!.constructed.rating, START_RATING - 5, 'conceder -5');
  assert.equal(t.get('alice')!.constructed.rating, START_RATING, 'the winner gains nothing');
  assert.equal(t.get('alice')!.constructed.games, 0, 'not a rated game for the count');
  assert.equal(t.get('bob')!.constructed.games, 0);
});

test('cr:annexd.modes.concession.early — a rated turn-2 concession moves ratings by half of what a full game moves them, and still counts', () => {
  assert.equal(concessionWeight({ concession: { seat: 1, turn: 2 } }), 'early');
  assert.equal(EARLY_K_SCALE, 0.5);
  const full = foldRatings([row({ concession: { seat: 1, turn: 3 } })] as never);
  const early = foldRatings([row({ concession: { seat: 1, turn: 2 } })] as never);
  const dFull = full.get('alice')!.constructed.rating - START_RATING;
  const dEarly = early.get('alice')!.constructed.rating - START_RATING;
  assert.equal(dFull, 20);
  assert.equal(dEarly, 10, 'half the movement');
  assert.equal(early.get('alice')!.constructed.games, 1, 'it does count as a rated game');
});

test('cr:annexd.modes.concession.normal — a turn-3 concession moves ratings exactly as a game won outright does', () => {
  const conceded = foldRatings([row({ concession: { seat: 1, turn: 3 } })] as never);
  const outright = foldRatings([row({})] as never);
  assert.equal(conceded.get('alice')!.constructed.rating - START_RATING, 20, 'a full K exchange');
  for (const u of ['alice', 'bob']) {
    assert.equal(conceded.get(u)!.constructed.rating, outright.get(u)!.constructed.rating, `${u}: same rating as an outright result`);
    assert.equal(conceded.get(u)!.constructed.games, outright.get(u)!.constructed.games, `${u}: same game count`);
  }
});

test('cr:annexd.modes.concession.rated-only — an unrated walkover moves nobody', () => {
  const t = foldRatings([row({ rated: false, concession: { seat: 1, turn: 1 } })] as never);
  assert.equal(t.get('bob'), undefined);
  assert.equal(t.get('alice'), undefined);
});

/* ── modes: Single Card Duel ─────────────────────────────────────────────── */

const unitCards = DECK_LIST.filter(n => getCard(n).kind === 'unit');

/** drive both seats with the most passive legal move until `until` holds */
function drive(h: Harness, until: () => boolean, cap = 400): void {
  for (let i = 0; i < cap && !until(); i++) {
    let moved = false;
    for (const seat of [0, 1] as Seat[]) {
      const a = fallbackMove(legalActions(h.state, seat)) as Action | undefined;
      if (a) { h.do(a); moved = true; break; }
    }
    if (!moved) break;
  }
}

test('cr:annexd.modes.single-card-duel — a deck of 30 copies of one card is a single-card deck, 29 is not, and two such decks make a duel', () => {
  const a = unitCards[0]!, b = unitCards[1]!;
  assert.equal(checkSingleDeck(Array(30).fill(a)).ok, true, '30 copies is a single-card deck');
  assert.equal(checkSingleDeck(Array(29).fill(a)).ok, false, '29 copies is not');
  const h = new Harness(24001, undefined, 'constructed', undefined,
    [Array(30).fill(a) as CardName[], Array(30).fill(b) as CardName[]]);
  assert.equal(h.state.singleCard, true, 'two 30-copy decks make a duel');
});

test('cr:annexd.modes.single-card-duel.draw — a duel has no bottom step, turn 1 starts on six cards, and turn 2 draws a flat 2', () => {
  const a = unitCards[0]!, b = unitCards[1]!;
  const h = new Harness(24001, undefined, 'constructed', undefined,
    [Array(30).fill(a) as CardName[], Array(30).fill(b) as CardName[]]);
  assert.equal(h.state.singleCard, true);
  assert.equal(h.state.turn, 1);
  for (const p of h.state.players) assert.equal(p.hand.length, 6, 'opening 4 + the turn-1 draw of 2');
  assert.ok(!h.state.bottomDone, 'no draw-4/bottom-2 step is open');
  // control: an ordinary constructed game opens the bottom step
  const c = new Harness(24001, undefined, 'constructed', undefined, [DECK_LIST.slice(0, 30), DECK_LIST.slice(30, 60)]);
  assert.ok(c.state.bottomDone, 'control: ordinary constructed opens the bottom step');
  const evStart = h.events.length;
  drive(h, () => h.state.turn >= 2);
  assert.equal(h.state.turn, 2, 'reached turn 2');
  assert.ok(!h.state.bottomDone, 'still no bottom step on turn 2');
  const draws = h.events.slice(evStart).filter(e => e.type === 'draw');
  for (const seat of [0, 1]) {
    const mine = draws.filter(e => (e.data as { seat: number }).seat === seat);
    assert.equal(mine.length, 1, `seat ${seat} draws once on turn 2`);
    assert.equal((mine[0]!.data as { n: number }).n, 2, `seat ${seat} draws exactly 2`);
  }
});

test('cr:annexd.modes.single-card-duel.makes-units — unit cards and declared unit-token creators make units; a plain spell does not', () => {
  assert.equal(makesUnits(unitCards[0]!), true);
  const creator = DECK_LIST.find(n => getCard(n).kind === 'spell' && createsOf(n).includes('Unit Token' as CardName));
  assert.ok(creator, 'a spell that declares a Unit Token exists');
  assert.equal(makesUnits(creator), true);
  const plain = DECK_LIST.find(n => getCard(n).kind === 'spell' && createsOf(n).length === 0 && !/unit token/i.test(String(getCard(n).text ?? '')));
  assert.ok(plain);
  assert.equal(makesUnits(plain), false);
});

const duel = (over: Record<string, unknown>) => row({ single: ['A', 'B'], ...over });

test('cr:annexd.modes.single-card-duel.ladder — mirrors and walkovers do not rate cards, and an early concession counts at half weight', () => {
  const t = foldCardLadder([duel({ single: ['A', 'A'] }), duel({ concession: { seat: 1, turn: 1 } })] as never);
  assert.equal(t.get('A')!.mirrors, 1);
  assert.equal(t.get('A')!.games, 0, 'neither the mirror nor the walkover is a ladder game');
  assert.equal(t.get('B'), undefined, 'the walkover put nothing on the ladder');
  const e = foldCardLadder([duel({ concession: { seat: 1, turn: 2 } })] as never);
  assert.equal(e.get('A')!.rating - START_RATING, 10, 'half of the full-game 20');
});

test('cr:annexd.modes.single-card-duel.records — a duel moves no player rating', () => {
  assert.equal(foldRatings([duel({})] as never).size, 0);
});

/* ── modes: Learn to Play ─────────────────────────────────────────────────── */

test('cr:annexd.modes.learn-to-play.deal — the learner starts with no hand, and the turn-1 draw of 2 is the whole starting hand', () => {
  assert.equal(TUTORIAL_DEAL.openingHand[0], 0);
  assert.equal(TUTORIAL_DEAL.drawPerTurn[0], 2);
  const pool = DECK_LIST.filter(n => getCard(n).kind === 'unit' && (getCard(n).factions ?? []).join() === 'fire');
  const learner = Array.from({ length: 30 }, (_, i) => pool[i % pool.length]!);
  const h = new Harness(24101, ['Learner', 'Tutorial Bot'], 'constructed', undefined,
    [learner, Array(40).fill(CONSTRUCT)], undefined, TUTORIAL_DEAL);
  assert.equal(h.state.turn, 1);
  assert.ok(!h.state.bottomDone, 'no bottom step');
  assert.equal(h.state.players[0]!.hand.length, 2, 'the learner holds exactly 2 cards on turn 1');
});

/* ── reveal: the tester pass (one test per rule that had no executed demonstration) ── */

type Recap = ReturnType<typeof playbackFrames>;
interface RecapTick { toActor: EngineEvent[]; toOpp: EngineEvent[]; wasKey: string | null; closed: boolean; held?: [EngineEvent[], EngineEvent[]]; playback?: [Recap, Recap] | null }
/** `tick`, plus the recap each seat is played at a close, built the way server/main.ts builds it */
function tickRecap(room: Room, a: Action): RecapTick {
  const wasKey = room.segKey;
  const events = applyToRoom(room, a);
  for (let g = 0; g < 8; g++) { const f = forcedAction(room.state); if (!f) break; events.push(...applyToRoom(room, f)); }
  const nowKey = segmentKey(room.state);
  if (wasKey === nowKey && wasKey !== null) return { toActor: events, toOpp: unheldFor(room, other(a.seat), events), wasKey, closed: false };
  const held: [EngineEvent[], EngineEvent[]] = [
    room.heldEvents[0].filter(e => !events.includes(e)), room.heldEvents[1].filter(e => !events.includes(e))];
  const frames: [HeldFrame[], HeldFrame[]] = room.heldFrames;
  const close: SegmentClose | null = room.closing;
  openSegment(room);
  const pb = (seat: Seat): Recap => playbackFrames({ seat, held: frames[seat]!, tail: events, close: close!, redact: evs => onWire(evs, seat) });
  return {
    toActor: events, toOpp: events, wasKey, closed: wasKey !== null, held,
    playback: wasKey !== null && close && wasKey !== 'plan' ? [pb(0), pb(1)] : null,
  };
}

/** a room in its second turn, in the battle where `A` attacks with one unit token, `A` holding priority */
function roomToAttack(code: string, seed: number): { room: Room; A: Seat; D: Seat } {
  const room = createRoom(code, seed, [...NAMES]);
  roomToDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  const tok = spawn({ state: room.state } as Harness, A, 'Unit Token');
  tick(room, { type: 'doneDeploying', seat: A }); tick(room, { type: 'doneDeploying', seat: D });
  tick(room, { type: 'donePlanning', seat: 0 }); tick(room, { type: 'donePlanning', seat: 1 });
  for (const seat of [0, 1] as Seat[]) if (room.state.hasteDone && !room.state.hasteDone[seat]) tick(room, { type: 'doneHaste', seat });
  for (let g = 0; g < 2 && room.state.phase === 'battle' && room.state.battle && room.state.battle.attacker !== A; g++)
    tick(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  assert.equal(room.state.phase, 'battle');
  assert.equal(room.state.battle?.attacker, A);
  tick(room, { type: 'declareAttack', seat: A, columns: [[tok]] });
  if (room.state.priority === D) applyToRoom(room, { type: 'passPriority', seat: D });
  assert.equal(room.state.priority, A);
  return { room, A, D };
}

test('cr:annexd.reveal.hidden-steps — the resource step, the haste step and deployment are hidden: both may act, the other is sent nothing, the end reveals it all, and haste and deployment are played back', () => {
  const room = createRoom('U24S', 24401, [...NAMES]);
  // the resource step
  assert.equal(room.segKey, 'plan', 'the resource step is a hidden step');
  for (const seat of [0, 1] as Seat[]) assert.ok(legalActions(room.state, seat).length > 0, `seat ${seat} may act in the resource step`);
  const p = tickRecap(room, legalActions(room.state, 0).find(a => a.type === 'recycleForResource')!);
  assert.ok(p.toActor.length > 0, 'non-vacuous: the recycle made events');
  assert.deepEqual(p.toOpp, [], 'resource step: the other player is sent nothing');
  tickRecap(room, { type: 'donePlanning', seat: 0 });
  const pc = tickRecap(room, { type: 'donePlanning', seat: 1 });
  assert.ok(pc.closed && pc.wasKey === 'plan');
  assert.ok(p.toActor.every(e => pc.held![1]!.includes(e)), 'resource step: the end of the step reveals what seat 0 did');
  assert.equal(pc.playback, null, 'the resource step is not played back in a recap');
  // the haste step
  assert.equal(room.segKey, 'haste', 'the haste step is a hidden step');
  for (const seat of [0, 1] as Seat[]) assert.ok(legalActions(room.state, seat).length > 0, `seat ${seat} may act in the haste step`);
  const H: Seat = 1;
  giveRes(room, H, 'light', 3);
  const h1 = tickRecap(room, { type: 'playCard', seat: H, handIndex: giveCard(room, H, 'Seer of Empty Spaces' as CardName) });
  assert.ok(h1.toActor.length > 0);
  assert.deepEqual(h1.toOpp, [], 'haste step: the other player is sent nothing');
  tickRecap(room, { type: 'doneHaste', seat: H });
  const hc = tickRecap(room, { type: 'doneHaste', seat: other(H) });
  assert.ok(hc.closed && hc.wasKey === 'haste');
  assert.ok(h1.toActor.every(e => hc.held![other(H)]!.includes(e)), 'haste step: the end of the step reveals all of it');
  assert.ok(hc.playback![other(H)]!.frames.some(f => f.events.some(e => e.msg.includes('Seer of Empty Spaces'))),
    'haste step: it is played back in the recap');
  // deployment
  for (let g = 0; g < 2 && room.state.phase === 'battle' && room.state.battle; g++)
    tickRecap(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  assert.equal(room.segKey, 'deploy', 'deployment is a hidden step');
  for (const seat of [0, 1] as Seat[]) assert.ok(legalActions(room.state, seat).length > 0, `seat ${seat} may act in deployment`);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveRes(room, A, 'fire', 1);
  const d1 = tickRecap(room, { type: 'playCard', seat: A, handIndex: giveCard(room, A, 'Ignis Sprite' as CardName) });
  assert.ok(d1.toActor.length > 0);
  assert.deepEqual(d1.toOpp, [], 'deployment: the other player is sent nothing');
  tickRecap(room, { type: 'doneDeploying', seat: A });
  const dc = tickRecap(room, { type: 'doneDeploying', seat: D });
  assert.ok(dc.closed && dc.wasKey === 'deploy');
  assert.ok(d1.toActor.every(e => dc.held![D]!.includes(e)), 'deployment: the end of the step reveals all of it');
  assert.ok(dc.playback![D]!.frames.some(f => f.events.some(e => e.msg.includes('Ignis Sprite'))),
    'deployment: it is played back in the recap');
});

test('cr:annexd.reveal.hidden-steps.counts — in deployment and in the haste step the shared deck and recycle counts are served as the step opened, to both players, until the reveal', () => {
  const room = createRoom('U24K', 24402, [...NAMES]);
  roomToDeployment(room);
  assert.equal(room.segKey, 'deploy');
  const A = room.state.deployPlayer! as Seat, D = other(A);
  const served = (r: Room, seat: Seat) => { const v = viewFor(r.state, seat, r.segSnapshot); return { deck: v.sharedDeck.length, recycled: v.sharedRecycled?.length ?? 0 }; };
  const live = (r: Room) => ({ deck: r.state.sharedDeck.length, recycled: r.state.sharedRecycled?.length ?? 0 });
  const start = live(room);
  giveRes(room, A, 'water', 3);
  tick(room, { type: 'playCard', seat: A, handIndex: giveCard(room, A, 'Oracle of Foretelling' as CardName) });
  tick(room, { type: 'decide', seat: A, choice: 0 });
  assert.notDeepEqual(live(room), start, 'non-vacuous: the glimpse really moved the shared piles');
  assert.deepEqual(served(room, D), start, 'deployment: the other player is served the opening counts');
  assert.deepEqual(served(room, A), start, 'deployment: and so is the player whose own play moved them');
  tick(room, { type: 'doneDeploying', seat: A });
  tick(room, { type: 'doneDeploying', seat: D });
  assert.deepEqual(served(room, D), live(room), 'at the reveal both see the real counts');
  assert.deepEqual(served(room, A), live(room));

  const r2 = createRoom('U24L', 24403, [...NAMES]);
  tick(r2, { type: 'donePlanning', seat: 0 }); tick(r2, { type: 'donePlanning', seat: 1 });
  assert.equal(r2.segKey, 'haste');
  const H: Seat = 1;
  const s2 = live(r2);
  giveRes(r2, H, 'light', 3);
  tick(r2, { type: 'playCard', seat: H, handIndex: giveCard(r2, H, 'Seer of Empty Spaces' as CardName) });
  for (let g = 0; g < 4 && r2.state.decision?.seat === H; g++) tick(r2, { type: 'decide', seat: H, choice: 0 });
  assert.notDeepEqual(live(r2), s2, 'non-vacuous: the haste play really moved the shared deck');
  assert.deepEqual(served(r2, other(H)), s2, 'haste step: the other player is served the opening counts');
  assert.deepEqual(served(r2, H), s2, 'haste step: and so is the player who moved them');
});

test('cr:annexd.reveal.hidden-steps.battle — nothing is held in battle: every event of a battle play reaches the other player as it happens', () => {
  const { room, A, D } = roomToAttack('U24B', 24404);
  assert.equal(segmentKey(room.state), null, 'battle is not a hidden step');
  giveRes(room, A, 'metal', 2);
  const all: EngineEvent[] = [];
  const act = (a: Action) => {
    const evs = applyToRoom(room, a);
    all.push(...evs);
    assert.deepEqual(unheldFor(room, D, evs), evs, `${a.type}: nothing of it is held from the other player`);
  };
  act({ type: 'playCard', seat: A, handIndex: giveCard(room, A, 'Foretell' as CardName) });
  const revealed = deckOf(room.state, A).slice(0, 1);
  act({ type: 'passPriority', seat: room.state.priority! });
  act({ type: 'passPriority', seat: room.state.priority! });
  assert.deepEqual(room.heldEvents[D], [], 'the hold is empty');
  assert.ok(onWire(all, D).some(e => e.msg.includes('Foretell')), 'the play is on the other player wire');
  const g = onWire(all, D).filter(e => e.type === 'glimpsed');
  assert.equal(g.length, 1, 'and so is its reveal');
  assert.deepEqual(g[0]!.data?.['cards'], revealed);
  assert.ok(visibleLog(room, D).some(l => revealed.every(n => l.includes(n))), 'and the other player log already has it');
});

test('cr:annexd.reveal.glimpse — a glimpse in deployment reaches the other player only at the reveal, in the recap frame of the play that glimpsed', () => {
  const room = createRoom('U24G', 24405, [...NAMES]);
  roomToDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveRes(room, A, 'water', 3);
  const revealed = deckOf(room.state, A).slice(0, 5);
  const t = tickRecap(room, { type: 'playCard', seat: A, handIndex: giveCard(room, A, 'Oracle of Foretelling' as CardName) });
  tickRecap(room, { type: 'decide', seat: A, choice: 1 });
  assert.ok(t.toActor.some(e => e.type === 'glimpsed'), 'non-vacuous: it glimpsed');
  assert.deepEqual(t.toOpp, [], 'not when it happens');
  for (const n of revealed) assert.ok(!visibleLog(room, D).some(l => l.includes(n)), `nor on a resync (${n})`);
  tickRecap(room, { type: 'doneDeploying', seat: A });
  const c = tickRecap(room, { type: 'doneDeploying', seat: D });
  const g = onWire(c.held![D]!, D).filter(e => e.type === 'glimpsed');
  assert.equal(g.length, 1, 'the reveal carries it, once');
  assert.deepEqual(g[0]!.data?.['cards'], revealed);
  const pb = c.playback![D]!;
  const frames = pb.frames.filter(f => f.events.some(e => e.type === 'glimpsed'));
  assert.equal(frames.length, 1, 'it plays in one recap frame');
  assert.ok(frames[0]!.events.some(e => e.msg.includes('Oracle of Foretelling')), 'the frame of the play that glimpsed');
  const cachedAt = pb.frames.findIndex(x => x.events.some(e => e.type === 'cached'));
  assert.ok(cachedAt > pb.frames.indexOf(frames[0]!), 'in order: before the later cache answer');
});

test('cr:annexd.reveal.glimpse.public — the cards a battle glimpse reveals are sent to every player, and the cached card stays public', () => {
  const { room, A, D } = roomToAttack('U24F', 24406);
  giveRes(room, A, 'metal', 2);
  const all: EngineEvent[] = [];
  all.push(...applyToRoom(room, { type: 'playCard', seat: A, handIndex: giveCard(room, A, 'Foretell' as CardName) }));
  const revealed = deckOf(room.state, A).slice(0, 1);
  all.push(...applyToRoom(room, { type: 'passPriority', seat: room.state.priority! }));
  all.push(...applyToRoom(room, { type: 'passPriority', seat: room.state.priority! }));
  for (const seat of [A, D]) {
    const g = onWire(all, seat).filter(e => e.type === 'glimpsed');
    assert.equal(g.length, 1, `seat ${seat} is sent the reveal`);
    assert.ok(revealed.every(n => g[0]!.msg.includes(n)), `seat ${seat} is told the revealed card`);
  }
  assert.deepEqual(viewFor(room.state, D, null).players[A]!.cache?.map(c => c.card), revealed, 'the other player sees it in the cache');
});

test('cr:annexd.reveal.resolving.battle-only — outside battle the other player is served nothing of an item resolving while its controller is asked; in battle they are', () => {
  const room = createRoom('U24R', 24407, [...NAMES]);
  roomToDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveRes(room, A, 'water', 3);
  tick(room, { type: 'playCard', seat: A, handIndex: giveCard(room, A, 'Oracle of Foretelling' as CardName) });
  assert.equal(room.state.decision?.seat, A, 'non-vacuous: the Oracle is mid-resolution, asking its controller');
  assert.equal(room.state.resolving ?? null, null, 'the engine does not publish it outside battle');
  const vD = viewFor(room.state, D, room.segSnapshot);
  assert.equal(vD.resolving ?? null, null, 'the other player: no resolving item');
  assert.equal(vD.decision, null, 'no question');
  assert.equal(vD.pendingAsk, undefined, 'not even that one is pending');
  assert.deepEqual(vD.stack.filter(it => it.controller === A), [], 'and nothing of it on the stack');
  assert.equal(viewFor(room.state, A, room.segSnapshot).decision?.seat, A, 'its controller still sees the question');
  // control: the same kind of question in battle is shown
  const b = roomToAttack('U24T', 24408);
  giveRes(b.room, b.A, 'water', 3);
  applyToRoom(b.room, { type: 'playCard', seat: b.A, handIndex: giveCard(b.room, b.A, 'Premonition' as CardName) });
  applyToRoom(b.room, { type: 'passPriority', seat: b.room.state.priority! });
  applyToRoom(b.room, { type: 'passPriority', seat: b.room.state.priority! });
  assert.equal(b.room.state.decision?.seat, b.A);
  assert.equal(viewFor(b.room.state, b.D, null).resolving?.card, 'Premonition', 'control: in battle the other player is shown the resolving item');
});

test('cr:annexd.reveal.hidden-names — a card entering the hand of the other player is sent as a count, never by name', () => {
  const h = new Harness(24409);
  drive(h, () => h.state.turn >= 3);
  assert.ok(h.state.turn >= 3, 'reached turn 3');
  const entered = h.events.filter(e => e.type === 'handEntered');
  assert.ok(entered.length >= 4, `non-vacuous: real draws seen (${entered.length})`);
  for (const ev of entered) {
    const owner = ev.data!['seat'] as Seat, cards = ev.data!['cards'] as string[];
    const r = redactEvent(ev, other(owner), NAMES);
    assert.equal(r.data?.['n'], cards.length, 'the count is sent');
    const blob = JSON.stringify(r.data) + r.msg;
    for (const c of cards) assert.ok(!blob.includes(c), `${c} is not named to the other player`);
    assert.deepEqual(redactEvent(ev, owner, NAMES).data?.['cards'], cards, 'control: the owner is told');
  }
  const e = new E(h.state);
  const before = e.events.length;
  e.toHand(1, ['Rampart Guardian', 'Retribution Thing'] as CardName[], 'bin');
  const ev = e.events.slice(before).find(x => x.type === 'handEntered')!;
  const r = redactEvent(ev, 0, NAMES);
  assert.equal(r.data?.['n'], 2, 'from the bin too: the count');
  assert.ok(!JSON.stringify(r).includes('Rampart Guardian') && !JSON.stringify(r).includes('Retribution Thing'), 'and no name');
});

// The rule's other case, a look at the looker's OWN hand, is where the engine
// differs (F-U24-5: no line reaches the other player at all), so this demonstrates
// the case the engine agrees with and the finding carries the rest.
test('cr:annexd.reveal.hidden-names.look-at — Thought Extraction aimed at the other hand: the cards are named in the looker log only, and the other log says only that the hand was looked at', () => {
  const h = new Harness(24413);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'dark', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // Good Whale is discarded (into the public bin, where naming it is right);
  // Shard Sprite stays in the hand and is the secret
  h.state.players[D]!.hand = ['Good Whale', 'Shard Sprite'] as CardName[];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Thought Extraction') });
  pick(h, { player: D });
  pass(h); pass(h);
  pick(h, 0);
  assert.ok(h.state.players[D]!.bin.includes('Good Whale'), 'control: the spell resolved and discarded');
  assert.ok(logFor(h, A).some(l => l.includes('Shard Sprite') && l.includes('Good Whale')), 'the looker is told the cards seen');
  assert.deepEqual(logFor(h, D).filter(l => l.includes('Shard Sprite')), [], 'no line the other player receives names the card left in the hand');
  assert.ok(logFor(h, D).some(l => l.includes('looks at')), 'the other player is told that the hand was looked at');
  finishBattle(h);
});

test('cr:annexd.reveal.hidden-names.moved-card — Bripp: the recycled card is named to its chooser only, and the table is told a card moved', () => {
  const h = new Harness(24411);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = other(A);
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Bripp') });
  pick(h, { player: D });
  h.state.players[D]!.hand = ['Good Whale', 'Shard Sprite'] as CardName[];
  pass(h); pass(h);
  pick(h, 0);
  assert.ok(logFor(h, A).some(l => l.includes('Bripp recycles Good Whale')), 'the chooser is told which card');
  assert.ok(!logFor(h, D).some(l => l.includes('Good Whale')), 'no line the other player receives names it');
  assert.ok(logFor(h, D).some(l => /Bripp recycles a card from/.test(l)), 'the other player is told that a card moved');
  finishBattle(h);
});

test('cr:annexd.reveal.public-zones.deck-elements — in constructed, the deck elements of both players are in the view each player is sent', () => {
  const mono = (el: string) => DECK_LIST.filter(n => (getCard(n).factions ?? []).join() === el).slice(0, 15);
  const deck = (xs: CardName[]) => xs.flatMap(x => [x, x]);
  const h = new Harness(24412, undefined, 'constructed', undefined, [deck(mono('fire')), deck(mono('water'))]);
  for (const viewer of [0, 1] as Seat[]) {
    assert.deepEqual(viewFor(h.state, viewer, null).deckElements, [['fire'], ['water']], `seat ${viewer} is sent both`);
  }
});

test('cr:annexd.confirm.dials.damage-split — the dealing player is asked about one victim at a time with the remainder shown, and the client accepts every amount the engine offers', () => {
  const h = new Harness(24413);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const big = spawn(h, A, 'Rune Channeler');                  // 4/3
  const g = new E(h.state);
  const [b1, b2] = [0, 1].map(() => g.spawnUnit(D, 'Unit Token', g.homeRegion(D), { token: true, tokenStats: [1, 1] }).id);
  g.settle();
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[big]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1!, b2!] } });
  const mark = h.events.length;
  pass(h); pass(h);
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'assignDamage');
  assert.equal(dec.seat, A, 'the dealing player is asked');
  assert.match(dec.prompt, /how much of 4 to Unit Token\?/, 'about one victim, with what is left to assign');
  const v = assignSplitStepper(dec, h.state as unknown as AssignStateLike, 1);
  assert.deepEqual(v.rows.map(r => r.state), ['active', 'behind'], 'one victim is being asked; the other waits');
  assert.equal(v.remaining, 3, 'the client shows the remainder');
  const amounts = dec.options.flatMap(o => typeof o.value === 'number' ? [o.value] : []);
  assert.deepEqual([v.min, v.max], [Math.min(...amounts), Math.max(...amounts)], 'the dial spans exactly what the engine offers');
  for (const n of amounts) {
    const s = assignSplitSubmit(dec, n);
    assert.ok(s.ok, `${n} is accepted by the client`);
    assert.equal(dec.options[s.index]!.value, n, `and sent as the engine option ${n}`);
    assert.equal(dec.options[assignSplitIndex(dec, n)]!.value, n);
  }
  h.do({ type: 'decide', seat: A, choice: assignSplitSubmit(dec, 1).index });
  assert.equal(h.state.decision, null, 'the last victim is not asked');
  const hits = h.events.slice(mark).filter(e => e.type === 'damage').map(e => [e.data!['unit'], e.data!['n']]);
  assert.deepEqual(hits.filter(([u]) => u === b2).map(([, n]) => n), [3], 'the back unit gets the rest');
});

/* ── modes: what the lobby and the tester gate say, run off the real server source ── */

// server/main.ts boots a server on import, so the two functions these rules
// rest on are read out of it, type-stripped, and run with the real rooms.ts
// and trio.ts behind them. No copy of either function lives in this file.
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN_SRC = readFileSync(join(HERE, '..', '..', 'server', 'main.ts'), 'utf8');
const UI_MAIN_SRC = readFileSync(join(HERE, '..', '..', 'ui', 'main.ts'), 'utf8');
function mainFnSource(name: string): string {
  const start = MAIN_SRC.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `server/main.ts declares ${name}`);
  const end = MAIN_SRC.indexOf('\n}\n', start);
  return stripTypeScriptTypes(MAIN_SRC.slice(start, end + 3));
}
function mainFn<T>(names: string[], deps: Record<string, unknown>): T {
  const src = names.map(mainFnSource).join('\n');
  return new Function(...Object.keys(deps), `${src}\nreturn ${names.at(-1)};`)(...Object.values(deps)) as T;
}
type Waiting = { have: [boolean, boolean]; single?: true; drawn?: { mine: string; theirs: string } } | undefined;
const waitingInfo = mainFn<(room: Room, seat: Seat) => Waiting>(['waitingInfo'], {
  roomWaiting, roomLobby, roomElementCount, methodBlurbs, TRIO_METHODS, METHOD_LABELS, other,
  customInfo: () => { throw new Error('no custom rules in these rooms'); },
});
const thirty = (n: CardName): CardName[] => Array(30).fill(n);

test('cr:annexd.modes.single-card-duel.blind — before the game the other player is told only that a card is picked, never which', () => {
  const X = DECK_LIST.find(n => getCard(n).kind === 'unit')!;
  const room = createRoom('U24W', 24420, ['Ann', 'Bob'], 'constructed', undefined, thirty(X), undefined, null, undefined, true);
  assert.equal(room.single, true);
  assert.equal(setRoomDeck(room, 0, thirty(X)), false, 'one card in: no game yet');
  assert.ok(roomWaiting(room));
  const toB = waitingInfo(room, 1)!;
  assert.deepEqual(toB.have, [true, false], 'the other player is told that the first has picked');
  assert.equal(toB.drawn, undefined);
  assert.ok(!JSON.stringify(toB).includes(X), 'and the payload names no card');
  assert.match(MAIN_SRC, /const waiting = waitingInfo\(room, seat\);\n\s*if \(waiting\) \{\n\s*sendToSeat\(room, seat, seatMsg\('update', \{ waiting, peers: peersOf\(room\), names: room\.names \}\)\);\n\s*return;/,
    'while waiting, that payload is all an update carries');
});

test('cr:annexd.modes.single-card-duel.no-units — two cards that make no unit deal no game: both are told both cards, nothing is recorded, and both pick again', async () => {
  const SPELL = DECK_LIST.find(n => getCard(n).kind === 'spell' && !createsOf(n).length)!;
  const SPELL2 = DECK_LIST.find(n => n !== SPELL && getCard(n).kind === 'spell' && !createsOf(n).length)!;
  assert.ok(!makesUnits(SPELL) && !makesUnits(SPELL2), 'non-vacuous: neither makes a unit');
  const room = createRoom('U24N', 24421, ['Ann', 'Bob'], 'constructed', undefined, thirty(SPELL), undefined, null, undefined, true);
  setRoomDeck(room, 0, thirty(SPELL));
  assert.equal(setRoomDeck(room, 1, thirty(SPELL2)), false, 'no game is dealt');
  assert.ok(roomWaiting(room));
  assert.deepEqual(room.actions, []);
  assert.deepEqual(room.decks, [null, null], 'both picks are cleared');
  const w0 = waitingInfo(room, 0)!, w1 = waitingInfo(room, 1)!;
  assert.deepEqual(w0.drawn, { mine: SPELL, theirs: SPELL2 }, 'seat 0 is told both cards');
  assert.deepEqual(w1.drawn, { mine: SPELL2, theirs: SPELL }, 'seat 1 is told both cards');
  assert.deepEqual([w0.have, w1.have], [[false, false], [false, false]], 'both are asked to pick again');
  assert.match(UI_MAIN_SRC, /\$\{w\.drawn \? `<div class="lobbypanel scdraw">[\s\S]{0,400}Neither ever makes a unit/,
    'and the client says why');
  const scratch = mkdtempSync(join(tmpdir(), 'algo-435n-'));
  process.env['ALGO_ACCOUNTS_FILE'] = join(scratch, 'accounts.json');
  const { syncGamesDir } = await import('../../server/history.ts');
  assert.ok(!syncGamesDir(process.env['ALGO_GAMES_DIR']!).rows.some(r => r.game.code === 'U24N'), 'nothing is recorded');
});

test('cr:annexd.modes.scenarios — a scenario deals its declared board, and a finished scenario room is folded into no record', async () => {
  const SEED = 216216216, N: [string, string] = ['You', 'Tester Bot'];
  const ELS = ['fire', 'earth', 'light'] as GameState['elements'];
  const deal = (id?: string) => dealScenario(SEED, N, 'shared', ELS, undefined, id);
  const sc = deal('lithoghul-donated');
  assert.notEqual(JSON.stringify(sc.state.entities), JSON.stringify(deal().state.entities), 'the scenario board is its own');
  let s = sc.state;
  const actions: Action[] = [];
  const step = (a: Action): void => { actions.push(a); s = apply(s, a).state; };
  const host = Object.values(s.entities).find(e => e.card === 'Towering Colossus')!;
  step(legalActions(s, YOU).find(a => a.type === 'augment' && (a as Action & { hostId?: number }).hostId === host.id)!);
  for (let i = 0; i < 3 && s.stack.length; i++) { const m = passiveMove(legalActions(s, (s.priority ?? YOU) as Seat)); if (!m) break; step(m); }
  step({ type: 'playCard', seat: YOU, handIndex: s.players[YOU]!.hand.indexOf('Luminous Arc' as CardName) } as Action);
  step({ type: 'decide', seat: YOU, choice: s.decision!.options.findIndex(o => (o.value as { unit?: number }).unit === host.id) } as Action);
  for (let i = 0; i < 6 && s.stack.length; i++) { const m = passiveMove(legalActions(s, (s.priority ?? YOU) as Seat)); if (!m) break; step(m); }
  const scratch = mkdtempSync(join(tmpdir(), 'algo-435s-'));
  process.env['ALGO_ACCOUNTS_FILE'] = join(scratch, 'accounts.json');
  const games = join(scratch, 'games');
  mkdirSync(games, { recursive: true });
  const common = { seed: SEED, mode: 'shared', els: ELS, names: N, actions, winner: 0 };
  writeFileSync(join(games, 'SCEN.json'), JSON.stringify({ ...common, scenario: 'lithoghul-donated' }));
  writeFileSync(join(games, 'REAL.json'), JSON.stringify(common));
  const { syncGamesDir } = await import('../../server/history.ts');
  assert.deepEqual(syncGamesDir(games).rows.map(r => r.game.code).sort(), ['REAL'],
    'the same finished game is recorded without the scenario field and not with it');
});

test('cr:annexd.modes.scenarios.gated — with no tester token every request is refused, and the only scenario deal sits behind that check', () => {
  const allowed = (token: string) => mainFn<(req: { headers: Record<string, string> }, url: URL) => boolean>(
    ['sameToken', 'testerAllowed'], { TESTER_TOKEN: token });
  const req = (h?: string): { headers: Record<string, string> } => ({ headers: h === undefined ? {} : { 'x-algo-tester': h } });
  const off = allowed('');
  assert.equal(off(req('anything'), new URL('http://x/api/scenario/open?token=anything')), false, 'unconfigured: refused');
  assert.equal(off(req(''), new URL('http://x/api/scenario/open')), false, 'unconfigured: an empty token is refused too');
  const on = allowed('s3cret');
  assert.equal(on(req('s3cret'), new URL('http://x/api/scenario/open')), true, 'control: configured and matched');
  assert.equal(on(req(), new URL('http://x/api/scenario/open?token=s3cret')), true);
  assert.equal(on(req('wrong!'), new URL('http://x/api/scenario/open')), false, 'configured, wrong token: refused');
  const block = MAIN_SRC.indexOf("if (path.startsWith('/api/scenario/')) {");
  assert.ok(block > 0);
  assert.match(MAIN_SRC.slice(block, block + 200), /^if \(path\.startsWith\('\/api\/scenario\/'\)\) \{\n\s*if \(!testerAllowed\(req, url\)\) \{\n\s*res\.writeHead\(404/,
    'the scenario routes answer 404 before anything else');
  const blockEnd = MAIN_SRC.indexOf("return res.end('not found');\n  }", block);
  assert.ok(blockEnd > block);
  const dealing = [...MAIN_SRC.matchAll(/createRoom\(([^;]*?)\);/g)]
    .filter(m => !['SANDBOX_ID', 'undefined', undefined].includes(m[1]!.replace(/\[[^\]]*\]/g, 'ARR').split(',')[6]?.trim()));
  assert.ok(dealing.length >= 1, 'non-vacuous: the scenario deal is found');
  for (const m of dealing) assert.ok(m.index! > block && m.index! < blockEnd, `createRoom(${m[1]}) sits inside the gated block`);
  assert.equal(isScenarioId(SANDBOX_ID), false, 'the open sandbox is not a scenario');
});
