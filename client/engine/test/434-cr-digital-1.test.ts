/**
 * Comprehensive rules, unit U23 (Annex D part 1: digital play conventions —
 * priority, auto-pass, clocks, undo, recap) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U23
 * (data/comprehensive-rules/build/probes/U23/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U23.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 *
 * Annex D is about the client and the server as much as the engine, so some of
 * these drive server/rooms.ts (against a throwaway ALGO_GAMES_DIR) or the real
 * ui/main.ts through ui/test/ui-driver.ts, the way neighbouring engine tests do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness } from '../src/harness.ts';
import { apply, createGame, forcedAction, hiddenSegment, legalActions } from '../src/apply.ts';
import { E } from '../src/engine.ts';
import { effectByKey, getCard, mixedAllegiance, registerSynthetic } from '../src/cards/dsl.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import type { Action, CardName, EngineEvent, EntityId, GameState, Seat } from '../src/types.ts';
import { give, giveResources, pass, skipHasteStep, spawn, toDeployment, toNextBattle } from './util.ts';
import { HIDDEN_CARD, playbackFrames, redactEvent, viewFor, visibleToSeat } from '../../server/view.ts';
import type { HeldFrame, SegmentClose } from '../../server/view.ts';
import { sawHidden, seenBy } from '../../server/seen.ts';
import { summarizeGame } from '../../server/stats.ts';
import { isRated } from '../../server/rating.ts';
import { passEndsBattlePhase } from '../../ui/passrelease.ts';
import { client } from '../../ui/test/ui-driver.ts';
// type-only, so it is erased: the runtime import of rooms.ts has to wait until
// ALGO_GAMES_DIR below is set (rooms.ts persists every room it touches).
import type { Room } from '../../server/rooms.ts';

type Rooms = typeof import('../../server/rooms.ts');
process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-434-'));
const R: Rooms = await import('../../server/rooms.ts');
const { SEEN_REFUSAL } = await import('../../server/seen.ts');

/** a fresh rooms.ts module (its own room table), so one test's sweep never sees another's rooms */
let freshN = 0;
const freshRooms = async (): Promise<Rooms> => {
  process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-434-'));
  return await import(`../../server/rooms.ts?cr434=${++freshN}`) as Rooms;
};

const MIN = 60_000, HOUR = 60 * MIN;
const NAMES: [string, string] = ['A', 'B'];

/* ── the client never decides for the player ────────────────────────────── */

function toBattle(h: Harness, initiative: Seat): void {
  h.state.initiative = initiative;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
}

test('cr:annexd.general.player-decides.forced — an empty attacker has its empty declare forced; an attacker holding a unit does not', () => {
  const h = new Harness(23002);
  toBattle(h, 0);
  assert.deepEqual(forcedAction(h.state), { type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  const h2 = new Harness(23003);
  spawn(h2, 0, 'Ignis Sprite');
  toBattle(h2, 0);
  assert.equal(forcedAction(h2.state), null, 'declaring with a unit is a real choice');
});

test('cr:annexd.general.player-decides.forced.lone-counterattacker — the engine still asks a lone sent counterattacker with no token to declare (engine differs)', () => {
  const h = new Harness(23001);
  const it: Seat = 0, nit: Seat = 1;
  const atk = spawn(h, it, 'Ignis Sprite');
  const ctr = spawn(h, nit, 'Ignis Sprite');
  toBattle(h, it);
  h.do({ type: 'declareAttack', seat: it, columns: [[atk]] });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'declareBlocks', seat: nit, blocks: {}, send: [ctr] } as Action);
  let g = 20;
  while (h.state.phase === 'battle' && h.state.battle?.round === 1 && g-- > 0) {
    h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  const b = h.state.battle!;
  assert.equal(b.round, 2);
  assert.equal(b.step, 'declare');
  assert.equal(b.attacker, nit);
  assert.deepEqual(b.attackerPool, [ctr]);
  assert.equal(forcedAction(h.state), null, 'the engine does not auto-form the lone counterattacker');
  const decl = legalActions(h.state, nit).filter(a => a.type === 'declareAttack') as Extract<Action, { type: 'declareAttack' }>[];
  assert.ok(decl.some(a => a.columns.length === 0), 'declining is offered');
  assert.ok(decl.some(a => a.columns.length === 1), 'attacking with it is offered');
});

/** Divine Foresight ("target opponent") cast by the defender in battle: one legal target */
function loneTargetCast(): Harness {
  const h = new Harness(99231);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, D, 'light', 6);
  give(h, D, 'Divine Foresight');
  pass(h);
  assert.equal(h.state.priority, D);
  const play = legalActions(h.state, D).find(a =>
    a.type === 'playCard' && h.state.players[D]!.hand[a.handIndex] === 'Divine Foresight');
  assert.ok(play, 'Divine Foresight is castable');
  h.do(play!);
  return h;
}

test('cr:annexd.general.player-decides.forced-target — a target with exactly one legal candidate is still a decision put to the caster', () => {
  const h = loneTargetCast();
  const D = (1 - h.state.initiative) as Seat;
  const dec = h.state.decision;
  assert.ok(dec, 'a target decision is open');
  assert.equal(dec!.seat, D);
  assert.equal(dec!.options.length, 1, 'exactly one legal candidate');
  assert.equal(forcedAction(h.state), null, 'and no forced action answers it');
});

test('cr:annexd.general.player-decides.forced — a lone legal target is not a forced action', () => {
  const h = loneTargetCast();
  assert.equal(h.state.decision?.options.length, 1);
  assert.equal(forcedAction(h.state), null);
});

/* ── the ally-misclick family ───────────────────────────────────────────── */

test('cr:annexd.auto-pass.misclick-confirm.family — the family derived from target slots over the whole pool is exactly Fight and Squish', () => {
  const fam = new Set<string>();
  for (const name of new Set(DECK_LIST)) {
    let def;
    try { def = getCard(name); } catch { continue; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const key of [def.spellEffect, ...(def.abilities ?? []).map((a: any) => a.effect)]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eff: any = key ? (typeof key === 'string' ? effectByKey(key) : key) : null;
      const spec = eff?.targets;
      if (!spec) continue;
      const counted = spec.count === 'X' ? (spec.slots?.length ?? 1) : (spec.count ?? 1);
      if (mixedAllegiance(spec, counted + (spec.extraSlots ?? 0))) fam.add(name);
    }
  }
  assert.deepEqual([...fam].sort(), ['Fight', 'Squish']);
  assert.ok(!fam.has('Organic Exchange'), 'Organic Exchange does not ask');
});

/* ── clocks ─────────────────────────────────────────────────────────────── */

test('cr:annexd.clocks.running.simultaneous — in planning and the haste step both seats are waited on, and a seat that has finished has no legal action left', () => {
  const h = new Harness(99232);
  assert.ok(legalActions(h.state, 0).length > 0 && legalActions(h.state, 1).length > 0, 'both are waited on in planning');
  h.do({ type: 'donePlanning', seat: 0 });
  assert.equal(h.state.phase, 'planning', 'still the same step');
  assert.equal(legalActions(h.state, 0).length, 0, 'seat 0 finished: nothing left to wait on it for');
  assert.ok(legalActions(h.state, 1).length > 0, 'seat 1 is still waited on');
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(legalActions(h.state, 0).length > 0 && legalActions(h.state, 1).length > 0, 'both are waited on in the haste step');
  h.do({ type: 'doneHaste', seat: 0 });
  assert.equal(legalActions(h.state, 0).length, 0, 'seat 0 done with haste: nothing left to wait on it for');
  assert.ok(legalActions(h.state, 1).length > 0);
});

test('cr:annexd.clocks.running.simultaneous — in deployment both seats are waited on, and a seat that is done deploying has no legal action left', () => {
  const h = new Harness(99233);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  assert.ok(legalActions(h.state, 0).length > 0 && legalActions(h.state, 1).length > 0, 'both deploy at once');
  h.do({ type: 'doneDeploying', seat: P });
  assert.equal(legalActions(h.state, P).length, 0, 'the finished seat is not waited on');
});

/** play n legal actions (never a concession) into a room */
function playN(mod: Rooms, room: Room, n: number): void {
  for (let i = 0; i < n; i++) {
    const legal: Action[] = [...legalActions(room.state, 0), ...legalActions(room.state, 1)].filter(a => a.type !== 'concede');
    mod.applyToRoom(room, legal[0]!);
  }
}

test('cr:annexd.clocks.idle-rooms — an empty room with four actions closes after an hour without a move, one with five after twelve hours', async () => {
  const mod = await freshRooms();
  const a = mod.createRoom('UIDA', 11, [...NAMES], 'draft', ['fire', 'water', 'earth']);
  playN(mod, a, 4);
  const now = Date.now();
  a.unattendedSince = now - 10 * MIN;
  a.lastActionAt = now - 59 * MIN;
  assert.deepEqual(mod.sweepIdleRooms(now), [], '59 minutes: stays');
  a.lastActionAt = now - 61 * MIN;
  assert.deepEqual(mod.sweepIdleRooms(now), ['UIDA'], '61 minutes: closed');
  const b = mod.createRoom('UIDB', 21, [...NAMES], 'draft', ['fire', 'water', 'earth']);
  playN(mod, b, 5);
  b.unattendedSince = now - 10 * MIN;
  b.lastActionAt = now - 11 * HOUR;
  assert.deepEqual(mod.sweepIdleRooms(now), [], 'five actions, 11 hours: stays');
  b.lastActionAt = now - 12 * HOUR;
  assert.deepEqual(mod.sweepIdleRooms(now), ['UIDB'], 'five actions, 12 hours: closed');
});

test('cr:annexd.clocks.idle-rooms — a room nobody moves in stays open while a seat is connected, and an empty one closes only after the reconnect grace', async () => {
  const mod = await freshRooms();
  const r = mod.createRoom('UIDC', 31, [...NAMES], 'draft');
  const now = Date.now();
  r.lastActionAt = now - 3 * 24 * HOUR;
  r.sockets[0] = {} as Room['sockets'][0];
  assert.deepEqual(mod.sweepIdleRooms(now + 30 * MIN), [], 'three idle days, but a tab is open: stays');
  r.sockets[0] = null;
  assert.deepEqual(mod.sweepIdleRooms(now), [], 'first empty tick: grace');
  assert.equal(mod.RECONNECT_GRACE_MS, 5 * MIN, 'the grace is five minutes');
  assert.deepEqual(mod.sweepIdleRooms(now + mod.RECONNECT_GRACE_MS), ['UIDC']);
});

/* ── undo: seen cards ───────────────────────────────────────────────────── */

/** one tick of the server's action handler: apply, drain the forced steps, reopen a closed segment */
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

/** a sandbox room inside the hidden deployment step: each seat has a Lilbot in play and fire to spend */
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

test('cr:annexd.undo.seen-cards.only-seer — the opponent glimpsing the shared deck leaves my undo free, and locks theirs', () => {
  const { room, P, O } = deploying('U23E', 37405);
  assert.equal(room.state.mode, 'shared');
  assert.equal(room.actions[room.actions.length - 1]!.seat, P, 'my action is the last one in the log');
  // the opponent activates Lilbot, pays by discarding, and is shown the top two cards
  tick(room, { type: 'activateAbility', seat: O, entityId: lilbotOf(room, O), abilityIndex: 0, via: 'augment' });
  const cost = room.state.decision!;
  tick(room, { type: 'decide', seat: O, choice: cost.options.findIndex(o => o.label.startsWith('Discard')) });
  const ask = room.state.decision!;
  assert.ok(ask && ask.seat === O && /Glimpse 2/.test(ask.prompt), 'the Glimpse 2 question is open');
  tick(room, { type: 'decide', seat: O, choice: 0 });
  assert.deepEqual(R.undoForSeat(room, P), { ok: true });
  assert.deepEqual(R.undoForSeat(room, O), { ok: false, why: SEEN_REFUSAL });
});

/* ── recap playback ─────────────────────────────────────────────────────── */

// the playback timers read the clock: hold it still
const clock = Date.now();
Date.now = () => clock;
const ui = await client();
const SEAT: Seat = 0;
const rh = new Harness(38391);
const rv = viewFor(rh.state, SEAT);
const rlegal = legalActions(rh.state, SEAT);
const frame = (kind: 'opp' | 'tail', msg: string) => ({ view: rv, events: [{ type: 'info', msg }], kind });
const fiveFrames = () => [frame('opp', 'a'), frame('opp', 'b'), frame('opp', 'c'), frame('tail', 'd'), frame('tail', 'e')];
/** the play bar as "<step>/<of> <button label>", or "live" when no playback is shown */
const bar = (): string => {
  const html = ui.html();
  if (!/promptbar playbar/.test(html)) return 'live';
  const step = /class="playstep">(\d+\/\d+)</.exec(html)?.[1] ?? '?';
  const btn = /data-btn="playskip"[^>]*>(Continue|Skip)/.exec(html)?.[1] ?? '?';
  return `${step} ${btn}`;
};
ui.join(rv, SEAT, rlegal);
ui.sent();

test('cr:annexd.recap.skip.in-playback — the S key skips to the next stop, not the live board, and on a stop it continues', () => {
  ui.push({ t: 'update', view: rv, legal: rlegal, step: 'deploy', events: [], frames: fiveFrames() });
  assert.equal(bar(), '1/5 Skip');
  ui.key('s');
  assert.equal(bar(), '3/5 Continue', 'S jumps to the stop, not the live board');
  ui.key('s');
  assert.equal(bar(), '4/5 Skip', 'S on a stop continues');
  ui.key('s');
  assert.equal(bar(), '5/5 Continue');
  ui.key('s');
  assert.equal(bar(), 'live');
});

test('cr:annexd.recap.skip.in-playback — the Skip button on the play bar skips to the next stop, and on a stop it continues', () => {
  ui.push({ t: 'update', view: rv, legal: rlegal, step: 'deploy', events: [], frames: fiveFrames() });
  assert.equal(bar(), '1/5 Skip');
  ui.click({ btn: 'playskip' });
  assert.equal(bar(), '3/5 Continue', 'the button jumps to the stop, not the live board');
  ui.click({ btn: 'playskip' });
  assert.equal(bar(), '4/5 Skip');
  ui.click({ btn: 'playskip' });
  ui.click({ btn: 'playskip' });
  assert.equal(bar(), 'live');
});

/* ══ Tester additions (every behavioural rule of the unit gets a demonstration) ══ */

// rooms.ts's own directory, captured at load (before any test moves the env var)
const R_DIR = process.env['ALGO_GAMES_DIR']!;
const otherSeat = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** a fresh rooms.ts module, and the directory it persists to */
const freshRoomsAt = async (): Promise<{ mod: Rooms; dir: string }> => {
  const dir = mkdtempSync(join(tmpdir(), 'algo-434-'));
  process.env['ALGO_GAMES_DIR'] = dir;
  return { mod: await import(`../../server/rooms.ts?cr434=${++freshN}`) as Rooms, dir };
};

/** one tick of main.ts in module `mod`, returning the playback raw material taken before openSegment clears it */
function tickIn(mod: Rooms, room: Room, a: Action): { events: EngineEvent[]; closed: boolean; frames: [HeldFrame[], HeldFrame[]]; close: SegmentClose | null } {
  const wasKey = room.segKey;
  const events = mod.applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    events.push(...mod.applyToRoom(room, f));
  }
  if (mod.segmentKey(room.state) === wasKey) return { events, closed: false, frames: [[], []], close: null };
  const frames = room.heldFrames, close = room.closing;
  mod.openSegment(room);
  return { events, closed: wasKey !== null, frames, close };
}
const onWire = (evs: EngineEvent[], seat: Seat): EngineEvent[] =>
  evs.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, [...NAMES]));
const roomGive = (room: Room, seat: Seat, name: CardName): number => {
  room.state.players[seat]!.hand.push(name);
  return room.state.players[seat]!.hand.length - 1;
};
const roomMana = (room: Room, seat: Seat): void => {
  for (const kind of ['fire', 'water', 'wood', 'metal', 'earth', 'light', 'dark']) {
    for (let i = 0; i < 8; i++) room.state.players[seat]!.resources.push({ kind, state: 'open' } as never);
  }
};
/** a plain room driven to its hidden deployment step */
function roomToDeploy(mod: Rooms, room: Room): void {
  tickIn(mod, room, { type: 'donePlanning', seat: 0 });
  tickIn(mod, room, { type: 'donePlanning', seat: 1 });
  for (const seat of [0, 1] as Seat[]) {
    if (room.state.hasteDone && !room.state.hasteDone[seat]) tickIn(mod, room, { type: 'doneHaste', seat });
  }
  for (let g = 0; g < 4 && room.state.phase === 'battle' && room.state.battle; g++) {
    tickIn(mod, room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  }
}
const cardsOf = (s: { entities: Record<number, { card: string; controller: Seat }> }, seat: Seat, card: string): number =>
  Object.values(s.entities).filter(e => e.card === card && e.controller === seat).length;

/** a seeded fuzz walk: every state visited, with the actions that left it */
function walk(seeds: number[], steps: number, visit: (s: GameState, i: number) => void): void {
  for (const seed of seeds) {
    let { state } = createGame(seed);
    for (let i = 0; i < steps && state.phase !== 'gameover'; i++) {
      visit(state, i);
      const all = [...legalActions(state, 0), ...legalActions(state, 1)].filter(a => a.type !== 'concede');
      if (!all.length) break;
      state = apply(state, all[(i * 7919 + seed) % all.length]!).state;
    }
  }
}

/* ── the client never decides for the player ────────────────────────────── */

test('cr:annexd.general.player-decides — every action answered for a player is the only move either seat has, so no real choice is ever taken', () => {
  let forced = 0;
  walk([23201, 23202, 23203], 500, s => {
    const f = forcedAction(s);
    if (!f) return;
    forced++;
    const mine = legalActions(s, f.seat).filter(a => a.type !== 'concede');
    const theirs = legalActions(s, otherSeat(f.seat)).filter(a => a.type !== 'concede');
    assert.deepEqual(mine, [f], 'the forced action is the seat only legal move');
    assert.deepEqual(theirs, [], 'and the other seat has none');
  });
  assert.ok(forced > 20, `positive control: the walk met forced steps (${forced})`);
});

test('cr:annexd.general.player-decides.unoffered — every option the engine offers is accepted when taken; none is shown and then refused', () => {
  let tried = 0;
  walk([23211, 23212, 23213], 400, (s, i) => {
    if (i % 4) return;
    for (const a of [...legalActions(s, 0), ...legalActions(s, 1)].filter(x => x.type !== 'concede').slice(0, 15)) {
      assert.doesNotThrow(() => apply(s, a), `offered and then refused: ${JSON.stringify(a)}`);
      tried++;
    }
  });
  assert.ok(tried > 500, `positive control: ${tried} offered options were taken`);
});

/** a Wraith (and `others` Lithoghuls) for seat 0, carried into deployment, where its trigger aims */
function wraithInDeployment(others: number): Harness {
  const h = new Harness(23101);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) if (h.state.hasteDone && !h.state.hasteDone[s]) h.do({ type: 'doneHaste', seat: s });
  spawn(h, 0, 'Wraith');
  for (let i = 0; i < others; i++) spawn(h, 0, 'Lithoghul');
  for (let g = 0; g < 2 && h.state.phase === 'battle'; g++) h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(h.state.phase, 'deploy');
  return h;
}

test('cr:annexd.general.player-decides.one-subject — a lone Wraith aims at its only ally without asking; with a second ally the player is asked', () => {
  const lone = wraithInDeployment(0);
  assert.equal(lone.state.decision, null, 'one candidate: nothing is asked');
  const w = Object.values(lone.state.entities).find(e => e.card === 'Wraith')!;
  assert.equal(w.counters, -1, 'and the -1/-1 counter went on that one candidate');
  const two = wraithInDeployment(1);
  assert.equal(two.state.decision?.seat, 0, 'two candidates: the controller is asked');
  assert.equal((two.state.suspension as { stage?: string } | null)?.stage, 'subject', 'the question is the ability subject, as it goes on the stack');
  assert.equal(two.state.decision!.options.length, 2);
  assert.equal(forcedAction(two.state), null, 'and nothing answers it for them');
});

test('cr:annexd.general.player-decides.default-first — the elective damage split leads with the default share, and nothing picks it for the player', () => {
  const h = new Harness(23121);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = otherSeat(A);
  const tok = (seat: Seat, p: number, t: number): EntityId => {
    const g = new E(h.state);
    const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
    g.settle();
    return u.id;
  };
  const atk = tok(A, 8, 20);
  const b1 = tok(D, 1, 3), b2 = tok(D, 1, 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  pass(h); pass(h);
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'assignDamage', 'the split is asked');
  assert.equal(dec.seat, A);
  assert.match(dec.options[0]!.label, /^default — share front-to-back/, 'the usual answer is offered first');
  assert.ok(dec.options.length > 1, 'and it is one option among several');
  assert.equal(forcedAction(h.state), null, 'no automatic action answers the question');
});

/* ── hidden simultaneous segments ───────────────────────────────────────── */

test('cr:annexd.general.hidden-segment — the resource step, the haste step and deployment are hidden simultaneous segments; battle is not', () => {
  const h = new Harness(23131);
  assert.equal(h.state.phase, 'planning');
  assert.equal(hiddenSegment(h.state), 'plan', 'the resource step');
  assert.ok(legalActions(h.state, 0).length && legalActions(h.state, 1).length, 'both act at once');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.equal(hiddenSegment(h.state), 'haste', 'the haste step');
  assert.ok(legalActions(h.state, 0).length && legalActions(h.state, 1).length, 'both act at once');
  h.do({ type: 'doneHaste', seat: 0 });
  h.do({ type: 'doneHaste', seat: 1 });
  assert.equal(h.state.phase, 'battle');
  assert.equal(hiddenSegment(h.state), null, 'battle');
  for (let g = 0; g < 2 && h.state.phase === 'battle'; g++) h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(hiddenSegment(h.state), 'deploy', 'deployment');
  assert.ok(legalActions(h.state, 0).length && legalActions(h.state, 1).length, 'both act at once');
});

test('cr:annexd.general.hidden-segment — inside the haste step neither seat sees the other play until both are done', () => {
  const room = R.createRoom('U23HS', 23132, [...NAMES]);
  tickIn(R, room, { type: 'donePlanning', seat: 0 });
  tickIn(R, room, { type: 'donePlanning', seat: 1 });
  assert.equal(room.segKey, 'haste');
  roomMana(room, 0);
  tickIn(R, room, { type: 'playCard', seat: 0, handIndex: roomGive(room, 0, 'Cinder Scuttler') });
  const theirView = viewFor(room.state, 1, room.segSnapshot);
  assert.equal(cardsOf(theirView, 0, 'Cinder Scuttler'), 0, 'the opponent does not see the play');
  assert.equal(cardsOf(viewFor(room.state, 0, room.segSnapshot), 0, 'Cinder Scuttler'), 1, 'the player sees their own');
  assert.ok(room.heldEvents[1]!.length > 0, 'its events are held from the opponent');
  tickIn(R, room, { type: 'doneHaste', seat: 0 });
  const t = tickIn(R, room, { type: 'doneHaste', seat: 1 });
  assert.ok(t.closed, 'both done: the step ends');
  assert.equal(cardsOf(viewFor(room.state, 1, room.segSnapshot), 0, 'Cinder Scuttler'), 1, 'and now the opponent sees it');
});

test('cr:annexd.general.hidden-segment.redaction — the engine state holds the hidden play; only the server per-seat view leaves it out', () => {
  const room = R.createRoom('U23HR', 23133, [...NAMES]);
  roomToDeploy(R, room);
  assert.equal(room.segKey, 'deploy');
  const A = room.state.deployPlayer as Seat, D = otherSeat(A);
  roomMana(room, A);
  tickIn(R, room, { type: 'playCard', seat: A, handIndex: roomGive(room, A, 'Good Whale') });
  assert.equal(cardsOf(room.state, A, 'Good Whale'), 1, 'the engine own state has it, unhidden');
  assert.equal(hiddenSegment(room.state), 'deploy', 'mid-step');
  const v = viewFor(room.state, D, room.segSnapshot);
  assert.equal(cardsOf(v, A, 'Good Whale'), 0, 'the opponent view does not');
  assert.ok(v.players[A]!.hand.every(c => c === HIDDEN_CARD), 'and hands are hidden the same way, by the view');
});

test('cr:annexd.general.hidden-segment.barrier — the step ends only when every player is done, and then each is played back what the other did', () => {
  const room = R.createRoom('U23HB', 23134, [...NAMES]);
  roomToDeploy(R, room);
  const A = room.state.deployPlayer as Seat, D = otherSeat(A);
  roomMana(room, A); roomMana(room, D);
  tickIn(R, room, { type: 'playCard', seat: A, handIndex: roomGive(room, A, 'Good Whale') });
  tickIn(R, room, { type: 'playCard', seat: D, handIndex: roomGive(room, D, 'Bubb') });
  const a = tickIn(R, room, { type: 'doneDeploying', seat: A });
  assert.equal(a.closed, false, 'one player done: no barrier yet');
  assert.equal(room.segKey, 'deploy');
  const t = tickIn(R, room, { type: 'doneDeploying', seat: D });
  assert.ok(t.closed && t.close, 'every player done: the barrier');
  const forD = playbackFrames({ seat: D, held: t.frames[D]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, D) });
  const forA = playbackFrames({ seat: A, held: t.frames[A]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, A) });
  assert.ok(forD.frames.some(f => f.kind === 'opp' && cardsOf(f.view, A, 'Good Whale') === 1), 'D is shown the Whale A played');
  assert.ok(forA.frames.some(f => f.kind === 'opp' && cardsOf(f.view, D, 'Bubb') === 1), 'A is shown the Bubb D played');
});

test('cr:annexd.general.hidden-segment.battle-open — in battle nothing is held: a cast is on the opponent view and in their events at once', () => {
  const room = R.createRoom('U23BO', 23135, [...NAMES], 'shared', undefined, undefined, 'sandbox');
  const A = room.state.initiative as Seat, D = otherSeat(A);
  tick(room, { type: 'sandboxSpawn', seat: A, card: 'Lithoghul', to: 'play' });
  tick(room, { type: 'sandboxSpawn', seat: D, card: 'Divine Foresight', to: 'hand' });
  tick(room, { type: 'sandboxResources', seat: D, pool: { light: 6 } });
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) if (room.state.hasteDone && !room.state.hasteDone[s]) tick(room, { type: 'doneHaste', seat: s });
  assert.equal(room.state.phase, 'battle');
  assert.equal(room.segKey, null, 'battle is not a hidden segment');
  const lith = Object.values(room.state.entities).find(e => e.card === 'Lithoghul')!.id;
  tick(room, { type: 'declareAttack', seat: A, columns: [[lith]] });
  for (let g = 0; g < 4 && room.state.priority !== D; g++) tick(room, { type: 'passPriority', seat: room.state.priority! });
  const idx = room.state.players[D]!.hand.indexOf('Divine Foresight');
  const evs = R.applyToRoom(room, { type: 'playCard', seat: D, handIndex: idx });
  while (room.state.decision?.seat === D) evs.push(...R.applyToRoom(room, { type: 'decide', seat: D, choice: 0 }));
  assert.ok(room.state.stack.some(i => i.label.includes('Divine Foresight')), 'the spell is on the stack');
  const v = viewFor(room.state, A, room.segSnapshot);
  assert.ok(v.stack.some(i => i.label.includes('Divine Foresight')), 'and on the opponent view, live');
  assert.deepEqual(R.unheldFor(room, A, evs), evs, 'none of its events is held from the opponent');
  assert.deepEqual(room.heldEvents, [[], []]);
});

/* ── passing ───────────────────────────────────────────────────────────── */

test('cr:annexd.auto-pass.pass-buttons.pass — Pass sends one pass and arms nothing: the next window the seat holds is left to them', () => {
  const STORE = (globalThis as unknown as { localStorage: Storage }).localStorage;
  STORE.setItem('algoAutopass', '0');
  const h = new Harness(99231);
  toDeployment(h);
  const A = h.state.initiative, D = otherSeat(A);
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, D, 'light', 6);
  give(h, D, 'Divine Foresight');
  pass(h);
  assert.equal(h.state.priority, D);
  assert.ok(legalActions(h.state, D).some(a => a.type === 'playCard'), 'a real window: D could cast');
  ui.join(viewFor(h.state, D), D, legalActions(h.state, D));
  ui.sent();
  ui.click({ btn: 'pass' });
  ui.tick();
  assert.deepEqual(ui.actions(), [{ type: 'passPriority', seat: D }], 'exactly one pass');
  h.do({ type: 'passPriority', seat: D });
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  for (let g = 0; g < 4 && h.state.priority !== D; g++) pass(h);
  assert.equal(h.state.priority, D, 'a later window comes back to D');
  ui.update(viewFor(h.state, D), legalActions(h.state, D));
  ui.tick();
  assert.deepEqual(ui.actions(), [], 'nothing is sent for them in it');
  assert.equal(ui.has({ btn: 'passallstop' }), false, 'and no standing pass was armed');
});

test('cr:annexd.auto-pass.haste-ready.server-never — nothing finishes the haste step for a seat: no forced action, and the room drain leaves both seats to ready', () => {
  const room = R.createRoom('U23HN', 23141, [...NAMES]);
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  assert.equal(room.segKey, 'haste');
  assert.deepEqual(room.state.hasteDone, [false, false], 'after the room own drain, neither seat is done');
  assert.equal(forcedAction(room.state), null, 'and nothing is owed');
  tick(room, { type: 'doneHaste', seat: 0 });
  assert.deepEqual(room.state.hasteDone, [true, false], 'the other seat is still not readied for them');
  assert.equal(room.segKey, 'haste');
});

test('cr:annexd.auto-pass.regroup-confirm.card-ended — the pass under Temporal Rift does not read as ending the battle, yet the regroup announcement still fires when the Rift ends it', () => {
  const h = new Harness(23151);
  toDeployment(h);
  const A = h.state.initiative, D = otherSeat(A);
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'water', 2);
  giveResources(h, D, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const g = new E(h.state);
  g.createSpellToken(D, 'Fireball', 2, g.homeRegion(D));
  h.state = g.s;
  pass(h);
  assert.equal(h.state.priority, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Temporal Rift') });
  assert.ok(h.state.battle, 'the battle is still on while the Rift waits');
  const passer = h.state.priority as Seat;
  assert.equal(passEndsBattlePhase(h.state, passer), false, 'no warning: the pass that resolves the Rift is not known to end the battle');
  const mark = h.events.length;
  pass(h); pass(h);
  assert.equal(h.state.battle, null, 'the card ended the battle');
  assert.ok(h.events.slice(mark).some(e => e.type === 'erased' && /loses 1 unused spell token\(s\) to regroup/.test(e.msg)),
    'and the announcement of the lost token was made all the same');
});

/* ── clocks ─────────────────────────────────────────────────────────────── */

test('cr:annexd.clocks.running — a clock runs only for a seat the game is waiting on, and only while both players are connected', () => {
  const room = R.createRoom('U23CR', 23161, [...NAMES]);
  room.sockets = [{} as never, null];
  R.settleClock(room);
  assert.deepEqual(room.clockRun, [false, false], 'one player connected: no clock runs');
  room.sockets = [{} as never, {} as never];
  R.settleClock(room);
  assert.deepEqual(room.clockRun, [true, true], 'both connected, both waited on in planning');
  tick(room, { type: 'donePlanning', seat: 0 });
  assert.deepEqual(room.clockRun, [false, true], 'a seat that is done is not waited on');
  const before = room.clockMs[0];
  room.clockStamp -= 4000;
  R.settleClock(room);
  assert.equal(room.clockMs[0], before, 'and loses no time');
  assert.equal(room.clockMs[1], R.CLOCK_START_MS - 4000, 'while the seat still deciding does');
});

const ARM_ALL = { mode: 'all' as const, armedPhase: 'battle' as const, armedItems: [], armedOpts: [] };

test('cr:annexd.clocks.running.standing-pass — the armed seat is not billed in the window its pass answers, the other seat neither, and the backstop pass after the delay goes in the log', () => {
  const room = R.createRoom('U23SP', 23162, [...NAMES], 'shared', undefined, undefined, 'sandbox');
  const A = room.state.initiative as Seat, D = otherSeat(A);
  tick(room, { type: 'sandboxSpawn', seat: A, card: 'Lithoghul', to: 'play' });
  tick(room, { type: 'sandboxSpawn', seat: D, card: 'Bubb', to: 'play' });
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) if (room.state.hasteDone && !room.state.hasteDone[s]) tick(room, { type: 'doneHaste', seat: s });
  const lith = Object.values(room.state.entities).find(e => e.card === 'Lithoghul')!.id;
  tick(room, { type: 'declareAttack', seat: A, columns: [[lith]] });
  room.sockets = [{} as never, {} as never];
  const P = room.state.priority as Seat;
  R.settleClock(room);
  assert.equal(room.clockRun[P], true, 'positive control: the seat with priority is billed');
  assert.equal(room.clockRun[otherSeat(P)], false, 'the seat without it has nothing to do and is not');
  assert.equal(R.setPassAll(room, P, ARM_ALL), true);
  R.settleClock(room);
  assert.deepEqual(room.clockRun, [false, false], 'armed: nobody is billed for the window the pass answers');
  const now = Date.now();
  assert.equal(R.passAllDue(room, now), null, 'the client gets its chance first');
  assert.equal(R.passAllDue(room, now + R.PASS_ALL_BACKSTOP_MS), P, 'after the backstop delay the server passes for them');
  const n = room.actions.length;
  R.applyToRoom(room, { type: 'passPriority', seat: P });
  assert.deepEqual(room.actions[n], { type: 'passPriority', seat: P }, 'a pass in the log like any other');
  const src = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
  assert.match(src, /const seat = passAllDue\(room, now\);[\s\S]{0,200}landAction\(room, seat, \{ type: 'passPriority', seat \}\)/,
    'and the server sweep sends it through the same door as a player action');
  // a real choice is billed however the seat is armed: D must declare blocks
  for (let g = 0; g < 4 && room.state.battle?.step !== 'blocks'; g++) tick(room, { type: 'passPriority', seat: room.state.priority! });
  assert.equal(room.state.battle?.step, 'blocks');
  R.setPassAll(room, D, ARM_ALL);
  R.settleClock(room);
  assert.equal(room.clockRun[D], true, 'declaring blocks is a choice, billed even with a standing pass set');
});

test('cr:annexd.clocks.out-of-time — a seat whose clock runs out loses with no move made, and the log says they ran out of time', () => {
  const room = R.createRoom('U23OT', 23163, [...NAMES]);
  room.sockets = [{} as never, {} as never];
  R.settleClock(room);
  assert.deepEqual(room.clockRun, [true, true]);
  room.clockMs[0] = 500;
  room.clockStamp -= 1000;
  const n = room.actions.length;
  const out = R.expireOnTime(room);
  assert.equal(out?.loser, 0, 'seat 0 is out of time');
  assert.equal(R.decidedWinner(room), 1, 'and loses the game');
  assert.equal(room.actions.length, n, 'nobody acted');
  assert.ok(out!.events.some(e => /A ran out of time\. B wins\./.test(e.msg)), 'the log says so');
});

test('cr:annexd.clocks.idle-rooms.kept-open — a watcher keeps an idle game open, and an empty one is closed only after the reconnect grace', async () => {
  const mod = await freshRooms();
  const r = mod.createRoom('UIDW', 41, [...NAMES], 'draft');
  const now = Date.now();
  r.lastActionAt = now - 3 * 24 * HOUR;
  r.watchers.add({} as never);
  assert.deepEqual(mod.sweepIdleRooms(now), [], 'three idle days with somebody watching: stays');
  r.watchers.clear();
  assert.deepEqual(mod.sweepIdleRooms(now), [], 'empty: the first tick only starts the grace');
  assert.deepEqual(mod.sweepIdleRooms(now + mod.RECONNECT_GRACE_MS - 1000), [], 'inside the grace: stays');
  assert.deepEqual(mod.sweepIdleRooms(now + mod.RECONNECT_GRACE_MS), ['UIDW'], 'grace over: closed');
});

test('cr:annexd.clocks.idle-rooms.no-result — a game closed for being idle has no winner, is not rated and is recorded as unfinished', async () => {
  const { mod, dir } = await freshRoomsAt();
  const room = mod.createMatch({ userId: 'u-a', username: 'Ann' }, { userId: 'u-b', username: 'Bo' }, 'draft', 'UIDN');
  assert.equal(room.rated, true, 'positive control: a rated room');
  const now = Date.now();
  room.lastActionAt = now - 2 * HOUR;
  room.unattendedSince = now - 10 * MIN;
  assert.deepEqual(mod.sweepIdleRooms(now), ['UIDN']);
  const f = JSON.parse(readFileSync(join(dir, 'UIDN.json'), 'utf8')) as Parameters<typeof summarizeGame>[0] & { rated?: boolean; users: [string, string] };
  assert.equal(f.winner, null, 'no winner');
  const s = summarizeGame({ ...f, code: 'UIDN', playedAt: new Date(now).toISOString() });
  assert.equal(s.finished, false, 'recorded as unfinished');
  assert.equal(s.winner, null);
  assert.equal(isRated({ code: 'UIDN', playedAt: '', mode: s.mode, finished: s.finished, winner: s.winner, users: f.users, rated: true }),
    false, 'and not rated');
});

/* ── undo ───────────────────────────────────────────────────────────────── */

const spriteIdx = (room: Room, seat: Seat): number => room.state.players[seat]!.hand.indexOf('Ignis Sprite');

test('cr:annexd.undo.hidden-step — inside deployment a player undoes their own actions one at a time, back to the start of the step and no further', () => {
  const { room, P } = deploying('U23U1', 23171);
  const start = room.segStartIndex;
  tick(room, { type: 'playCard', seat: P, handIndex: spriteIdx(room, P) });
  tick(room, { type: 'playCard', seat: P, handIndex: spriteIdx(room, P) });
  const n = room.actions.length;
  assert.deepEqual(R.undoForSeat(room, P), { ok: true });
  assert.equal(room.actions.length, n - 1, 'one action at a time');
  assert.equal(cardsOf(room.state, P, 'Ignis Sprite'), 1);
  assert.deepEqual(R.undoForSeat(room, P), { ok: true });
  assert.equal(cardsOf(room.state, P, 'Ignis Sprite'), 0, 'both plays taken back');
  let g = 10;
  while (g-- > 0 && R.undoForSeat(room, P).ok) { /* walk back */ }
  assert.ok(room.actions.length >= start, 'never past the start of the step');
  assert.deepEqual(R.undoForSeat(room, P), { ok: false, why: 'nothing to undo — nothing of yours this step' });
});

test('cr:annexd.undo.hidden-step.opponent — the opponent acting in the same step does not stop my undo', () => {
  const { room, P, O } = deploying('U23U2', 23172);
  tick(room, { type: 'playCard', seat: P, handIndex: spriteIdx(room, P) });
  tick(room, { type: 'playCard', seat: O, handIndex: spriteIdx(room, O) });
  assert.equal(room.actions[room.actions.length - 1]!.seat, O, 'their move is the last one');
  assert.deepEqual(R.undoForSeat(room, P), { ok: true }, 'my play still comes back');
  assert.equal(cardsOf(room.state, P, 'Ignis Sprite'), 0);
  assert.equal(cardsOf(room.state, O, 'Ignis Sprite'), 1, 'and theirs stands');
});

test('cr:annexd.undo.hidden-step.floor — an undo stops at what the step did as it began: the answer to a start-of-deployment trigger cannot be taken back', () => {
  const room = R.createRoom('U23U3', 23173, [...NAMES], 'shared', undefined, undefined, 'sandbox');
  tick(room, { type: 'sandboxSpawn', seat: 0, card: 'Wraith', to: 'play' });
  tick(room, { type: 'sandboxSpawn', seat: 0, card: 'Lithoghul', to: 'play' });
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) if (room.state.hasteDone && !room.state.hasteDone[s]) tick(room, { type: 'doneHaste', seat: s });
  for (let g = 0; g < 4 && room.state.phase === 'battle' && room.state.battle; g++) {
    tick(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  }
  assert.equal(room.segKey, 'deploy');
  assert.equal(room.state.decision?.seat, 0, 'the step began by asking about the Wraith trigger');
  tick(room, { type: 'decide', seat: 0, choice: 1 });
  tick(room, { type: 'sandboxResources', seat: 0, pool: { fire: 2 } });
  assert.deepEqual(R.undoForSeat(room, 0), { ok: true }, 'a move after the start comes back');
  assert.deepEqual(R.undoForSeat(room, 0), { ok: false, why: 'that is the start of the phase — its triggers cannot be taken back' },
    'the trigger answer is the start of the step, and stands');
});

/** a sandbox room in battle: A attacks with a Lithoghul; D holds two Fireball 1 tokens (Molten Riftbreaker) and a Divine Foresight, with priority */
function castWindow(code: string, seed: number): { room: Room; A: Seat; D: Seat } {
  const room = R.createRoom(code, seed, [...NAMES], 'shared', undefined, undefined, 'sandbox');
  const A = room.state.initiative as Seat, D = otherSeat(A);
  tick(room, { type: 'sandboxSpawn', seat: A, card: 'Lithoghul', to: 'play' });
  tick(room, { type: 'sandboxSpawn', seat: D, card: 'Molten Riftbreaker', to: 'play' });
  tick(room, { type: 'sandboxSpawn', seat: D, card: 'Divine Foresight', to: 'hand' });
  tick(room, { type: 'sandboxResources', seat: D, pool: { light: 6 } });
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) if (room.state.hasteDone && !room.state.hasteDone[s]) tick(room, { type: 'doneHaste', seat: s });
  const lith = Object.values(room.state.entities).find(e => e.card === 'Lithoghul')!.id;
  tick(room, { type: 'declareAttack', seat: A, columns: [[lith]] });
  for (let g = 0; g < 4 && room.state.priority !== D; g++) tick(room, { type: 'passPriority', seat: room.state.priority! });
  assert.equal(room.state.priority, D);
  return { room, A, D };
}

test('cr:annexd.undo.cast-cancel — a cast still choosing its targets is cancelled: the card is back in hand and nothing went on the stack', () => {
  const { room, D } = castWindow('U23CC', 23174);
  const n = room.actions.length;
  const hand = room.state.players[D]!.hand.length;
  tick(room, { type: 'playCard', seat: D, handIndex: room.state.players[D]!.hand.indexOf('Divine Foresight') });
  assert.equal(room.state.decision?.seat, D, 'the cast is waiting on its target');
  assert.equal(room.state.stack.length, 0, 'not yet on the stack');
  assert.deepEqual(R.undoForSeat(room, D), { ok: true }, 'cancelled');
  assert.equal(room.actions.length, n);
  assert.equal(room.state.players[D]!.hand.length, hand, 'the card is back in hand');
  assert.equal(room.state.decision, null);
});

test('cr:annexd.undo.cast-cancel — a Burst group is cancelled whole: after one token is ordered and aimed, the undos take back the whole group', () => {
  const { room, A, D } = castWindow('U23CB', 23175);
  const n = room.actions.length;
  const fbs = Object.values(room.state.entities).filter(e => e.kind === 'spellToken' && e.controller === D).map(e => e.id);
  assert.equal(fbs.length, 2, 'two Fireball tokens');
  tick(room, { type: 'castSpellToken', seat: D, entityId: fbs[0]!, ordered: true });
  assert.equal(room.state.suspension?.type, 'burstPick', 'the group asks its order');
  const pickIdx = room.state.decision!.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ unit: fbs[1] }));
  tick(room, { type: 'decide', seat: D, choice: pickIdx });
  const aim = room.state.decision!.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ player: A }));
  tick(room, { type: 'decide', seat: D, choice: aim });
  assert.ok(room.state.decision && room.state.stack.length === 0, 'mid-group, and still nothing on the stack');
  let undos = 0;
  while (room.state.decision?.seat === D && undos < 6) { assert.deepEqual(R.undoForSeat(room, D), { ok: true }); undos++; }
  assert.equal(undos, 3, 'every step of the group came back');
  assert.equal(room.actions.length, n, 'the whole cast is gone from the log');
  assert.equal(room.state.stack.length, 0);
  assert.equal(Object.values(room.state.entities).filter(e => e.kind === 'spellToken' && e.controller === D).length, 2,
    'both tokens are still in play, uncast');
});

/** activate Lilbot, pay by discarding: the Glimpse 2 question is then open */
function lilbotGlimpse(room: Room, seat: Seat): void {
  tick(room, { type: 'activateAbility', seat, entityId: lilbotOf(room, seat), abilityIndex: 0, via: 'augment' });
  const cost = room.state.decision!;
  tick(room, { type: 'decide', seat, choice: cost.options.findIndex(o => o.label.startsWith('Discard')) });
  assert.ok(/Glimpse 2/.test(room.state.decision?.prompt ?? ''), 'the Glimpse 2 question is open');
}

test('cr:annexd.undo.seen-cards — a glimpse cannot be undone, and neither can the play made before it', () => {
  const { room, P } = deploying('U23S1', 23176);
  tick(room, { type: 'playCard', seat: P, handIndex: spriteIdx(room, P) });
  lilbotGlimpse(room, P);
  const n = room.actions.length;
  assert.deepEqual(R.undoForSeat(room, P), { ok: false, why: SEEN_REFUSAL }, 'the glimpse stands');
  assert.equal(room.actions.length, n, 'nothing left the log');
  assert.equal(cardsOf(room.state, P, 'Ignis Sprite'), 1, 'and the earlier play stands with it');
});

test('cr:annexd.undo.seen-cards.after — a move after the glimpse is undone back to just after it, and no further', () => {
  const { room, P } = deploying('U23S2', 23177);
  lilbotGlimpse(room, P);
  tick(room, { type: 'decide', seat: P, choice: 0 });
  const at = room.actions.length;
  tick(room, { type: 'playCard', seat: P, handIndex: spriteIdx(room, P) });
  assert.deepEqual(R.undoForSeat(room, P), { ok: true }, 'the later move comes back');
  assert.equal(room.actions.length, at, 'back to just after the glimpse');
  assert.deepEqual(R.undoForSeat(room, P), { ok: false, why: SEEN_REFUSAL });
});

test('cr:annexd.undo.seen-cards.message — the refusal reads: you have seen those cards and that cannot be taken back', () => {
  const { room, P } = deploying('U23S3', 23178);
  lilbotGlimpse(room, P);
  const out = R.undoForSeat(room, P);
  assert.equal(out.ok, false);
  assert.equal((out as { why: string }).why, "you've seen those cards — that can't be taken back");
});

/** a deployment spell that moves the shared deck top card to the bottom, showing nobody anything */
const BOTTOM = 'CR434 Bottom the Top';
registerSynthetic({
  name: BOTTOM, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Put the top card of the deck on the bottom of the deck.',
}, {
  spellEffect: { run: (g) => { const d = g.s.sharedDeck; if (d.length > 1) d.push(d.shift()!); } },
});

test('cr:annexd.undo.seen-cards.opponent-shown — my undo is refused when it would change the cards the opponent has since been shown', () => {
  const { room, P, O } = deploying('U23S4', 23179);
  tick(room, { type: 'sandboxSpawn', seat: P, card: BOTTOM, to: 'hand' });
  tick(room, { type: 'playCard', seat: P, handIndex: room.state.players[P]!.hand.indexOf(BOTTOM) });
  const mine = room.actions.length - 1;
  lilbotGlimpse(room, O);
  const n = room.actions.length;
  const out = R.undoForSeat(room, P);
  assert.equal(out.ok, false, 'refused');
  assert.notEqual((out as { why: string }).why, SEEN_REFUSAL, 'not because I saw anything');
  assert.equal(room.actions.length, n, 'nothing left the log');
  const lost = R.undoActionAt(room, mine);
  assert.ok(lost.some(l => /already shown/.test(l.why ?? '')), 'the reason: it would change cards already shown');
  assert.equal(room.actions.length, n);
  // positive control: the same play with nobody shown anything since comes back
  const c = deploying('U23S5', 23180);
  tick(c.room, { type: 'sandboxSpawn', seat: c.P, card: BOTTOM, to: 'hand' });
  tick(c.room, { type: 'playCard', seat: c.P, handIndex: c.room.state.players[c.P]!.hand.indexOf(BOTTOM) });
  assert.deepEqual(R.undoForSeat(c.room, c.P), { ok: true });
});

const ctx = (frozen: GameState | null, holding: boolean) => ({ frozen, holding, names: [...NAMES] });
const seen = (before: GameState, a: Action, c = ctx(null, true)): ReturnType<typeof seenBy> => {
  const r = apply(before, a);
  return seenBy(before, a, r.state, r.events, c);
};

test('cr:annexd.undo.seen-cards.measured — a glimpse, a draw and a look at a hand show hidden cards; a play from hand, a recycle and a bottom-of-deck do not; a deck of one card shows nothing', () => {
  // a glimpse
  const h = new Harness(23181);
  toDeployment(h);
  const P = h.state.deployPlayer as Seat;
  spawn(h, P, 'Lilbot');
  give(h, P, 'Ignis Sprite'); give(h, P, 'Ignis Sprite');
  giveResources(h, P, 'fire', 3);
  const lil = Object.values(h.state.entities).find(e => e.card === 'Lilbot')!.id;
  h.do({ type: 'activateAbility', seat: P, entityId: lil, abilityIndex: 0, via: 'augment' } as Action);
  const pay: Action = { type: 'decide', seat: P, choice: h.state.decision!.options.findIndex(o => o.label.startsWith('Discard')) };
  const beforeGlimpse = structuredClone(h.state);
  assert.ok(sawHidden(seen(beforeGlimpse, pay), P), 'a glimpse counts');
  // a single-card deck: the same glimpse shows nothing hidden
  const one = structuredClone(beforeGlimpse);
  one.sharedDeck = one.sharedDeck.map(() => 'Ignis Sprite');
  assert.equal(sawHidden(seen(one, pay), P), false, 'every card the same: nothing locks');
  // a play from hand, and a bottom-of-deck
  const h2 = new Harness(23182);
  toDeployment(h2);
  const Q = h2.state.deployPlayer as Seat;
  giveResources(h2, Q, 'fire', 3);
  const play: Action = { type: 'playCard', seat: Q, handIndex: give(h2, Q, 'Ignis Sprite') };
  assert.equal(sawHidden(seen(h2.state, play), Q), false, 'playing a card from hand does not count');
  const bottom: Action = { type: 'playCard', seat: Q, handIndex: give(h2, Q, BOTTOM) };
  assert.equal(sawHidden(seen(h2.state, bottom), Q), false, 'putting a card on the bottom of the deck does not count');
  // a draw: the turn start that closes deployment
  const close = new Harness(23183);
  toDeployment(close);
  close.do({ type: 'doneDeploying', seat: close.state.deployPlayer! });
  const last: Action = { type: 'doneDeploying', seat: close.state.deployPlayer! };
  const drawn = seen(close.state, last, ctx(null, false));
  assert.ok(sawHidden(drawn, 0) && sawHidden(drawn, 1), 'the next turn draw counts');
  // a recycle in the resource step
  const r = new Harness(23184);
  const rec = legalActions(r.state, 0).find(a => a.type === 'recycleForResource');
  assert.ok(rec, 'fixture: a recycle is on offer');
  assert.equal(sawHidden(seen(r.state, rec!, ctx(structuredClone(r.state), true)), 0), false, 'recycling does not count');
  // a look at a hand: Divine Foresight resolving
  const df = loneTargetCast();
  const D = otherSeat(df.state.initiative);
  df.do({ type: 'decide', seat: D, choice: 0 });
  let look = false;
  for (let g = 0; g < 4 && !look && df.state.priority !== null; g++) {
    const a: Action = { type: 'passPriority', seat: df.state.priority };
    look = sawHidden(seen(df.state, a, ctx(null, false)), D);
    df.do(a);
  }
  assert.ok(look, 'looking at the opponent hand counts');
});

test('cr:annexd.undo.seen-cards.restart — the lock survives a server restart and an undo', async () => {
  const { room, P } = deploying('U23S6', 23185);
  lilbotGlimpse(room, P);
  tick(room, { type: 'decide', seat: P, choice: 0 });
  tick(room, { type: 'playCard', seat: P, handIndex: spriteIdx(room, P) });
  tick(room, { type: 'playCard', seat: P, handIndex: spriteIdx(room, P) });
  assert.deepEqual(R.undoForSeat(room, P), { ok: true }, 'an undo after the glimpse');
  const n = room.actions.length;
  process.env['ALGO_GAMES_DIR'] = R_DIR;
  const R2 = await import(`../../server/rooms.ts?cr434restart=${++freshN}`) as Rooms;
  R2.restoreRooms();
  const back = R2.getRoom('U23S6')!;
  assert.ok(back, 'the room came back off disk');
  assert.equal(back.actions.length, n);
  assert.deepEqual(R2.undoForSeat(back, P), { ok: true }, 'the move after the glimpse is still undoable');
  assert.deepEqual(R2.undoForSeat(back, P), { ok: false, why: SEEN_REFUSAL }, 'and the glimpse is still locked after the restart');
});

test('cr:annexd.undo.learn-to-play — in Learn to Play a turn draw ends the undo of what came before, later moves undo in any phase, and a rewind to a turn start is not refused', async () => {
  const { CONSTRUCT, fallbackMove, tutorialBotV1 } = await import('../../ui/bot.ts');
  const { SoloServer, LEARNER } = await import('../../ui/solo.ts');
  const fire = DECK_LIST.filter(n => getCard(n).kind === 'unit' && (getCard(n).factions ?? []).join() === 'fire');
  const s = new SoloServer({
    seed: 23186,
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
  const errors = (): string[] => msgs.filter(m => m.t === 'error').map(m => m.msg!);
  for (let i = 0; i < 200 && s.state.turn < 2; i++) s.act(fallbackMove(legal())!);
  assert.equal(s.state.turn, 2);
  const before = s.save.actions.length;
  s.receive(JSON.stringify({ t: 'undo' }));
  assert.deepEqual(errors(), [SEEN_REFUSAL], 'the draw ends the undo of the turn before');
  assert.equal(s.save.actions.length, before);
  // into battle, and undo a move there
  let battleMove: Action | undefined;
  for (let i = 0; i < 200 && !battleMove; i++) {
    if (s.state.phase === 'battle') battleMove = legal().find(a => a.seat === LEARNER && a.type !== 'concede');
    if (!battleMove) s.act(fallbackMove(legal())!);
  }
  assert.ok(battleMove, 'fixture: the learner has a battle move');
  s.act(battleMove!);
  const n = s.save.actions.length;
  const errs = errors().length;
  s.receive(JSON.stringify({ t: 'undo' }));
  assert.equal(errors().length, errs, 'no refusal');
  assert.ok(s.save.actions.length < n, 'a battle move is taken back');
  // a rewind to the start of turn 1 is a fresh attempt, not an undo: the lock does not refuse it
  s.rewindToTurn(1);
  assert.equal(errors().length, errs, 'not refused');
  assert.equal(s.state.turn, 1, 'back at the start of turn 1');
});

/* ── the recap ──────────────────────────────────────────────────────────── */

test('cr:annexd.recap.what — when deployment ends each player is played back the other moves, one frame per move, in the order they were made', () => {
  const room = R.createRoom('U23RW', 23191, [...NAMES]);
  roomToDeploy(R, room);
  const A = room.state.deployPlayer as Seat, D = otherSeat(A);
  roomMana(room, A);
  tickIn(R, room, { type: 'playCard', seat: A, handIndex: roomGive(room, A, 'Bubb') });
  tickIn(R, room, { type: 'playCard', seat: A, handIndex: roomGive(room, A, 'Good Whale') });
  tickIn(R, room, { type: 'doneDeploying', seat: A });
  const t = tickIn(R, room, { type: 'doneDeploying', seat: D });
  const pb = playbackFrames({ seat: D, held: t.frames[D]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, D) });
  const opp = pb.frames.filter(f => f.kind === 'opp');
  assert.equal(opp.length, 2, 'one frame per move');
  assert.equal(cardsOf(opp[0]!.view, A, 'Bubb'), 1);
  assert.equal(cardsOf(opp[0]!.view, A, 'Good Whale'), 0, 'the first frame is the first move');
  assert.equal(cardsOf(opp[1]!.view, A, 'Good Whale'), 1, 'the second frame the second');
});

test('cr:annexd.recap.what — the haste step closes into a playback the same way', () => {
  const room = R.createRoom('U23RH', 23192, [...NAMES]);
  tickIn(R, room, { type: 'donePlanning', seat: 0 });
  tickIn(R, room, { type: 'donePlanning', seat: 1 });
  assert.equal(room.segKey, 'haste');
  roomMana(room, 0);
  tickIn(R, room, { type: 'playCard', seat: 0, handIndex: roomGive(room, 0, 'Cinder Scuttler') });
  tickIn(R, room, { type: 'doneHaste', seat: 0 });
  const t = tickIn(R, room, { type: 'doneHaste', seat: 1 });
  const pb = playbackFrames({ seat: 1, held: t.frames[1]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, 1) });
  const opp = pb.frames.filter(f => f.kind === 'opp');
  assert.equal(opp.length, 1);
  assert.equal(cardsOf(opp[0]!.view, 0, 'Cinder Scuttler'), 1);
});

test('cr:annexd.recap.what.no-effect — a game played with recap frames is the same game, action for action', () => {
  let { state } = createGame(36001);
  let frames = 0;
  for (let i = 0; i < 400 && state.phase !== 'gameover'; i++) {
    const seat: Seat = state.decision ? state.decision.seat : (legalActions(state, 0).length ? 0 : 1);
    const acts = legalActions(state, seat).filter(a => a.type !== 'concede');
    if (!acts.length) break;
    const a = acts[(i * 7919 + 36001) % acts.length]!;
    const plain = apply(state, a);
    const watched = apply(state, a, { frames: true });
    assert.deepEqual(watched.state, plain.state, `action ${i}: the board differs with frames on`);
    assert.deepEqual(watched.events, plain.events, `action ${i}: the events differ`);
    frames += watched.frames?.length ?? 0;
    state = plain.state;
  }
  assert.ok(frames > 0, 'positive control: frames were made');
});

test('cr:annexd.recap.what.opponent-frame — a frame shows their move on their side, their hand face down, and my side as I left it', () => {
  const room = R.createRoom('U23RO', 23194, [...NAMES]);
  roomToDeploy(R, room);
  const A = room.state.deployPlayer as Seat, D = otherSeat(A);
  roomMana(room, A); roomMana(room, D);
  roomGive(room, A, 'Hooba-God');
  tickIn(R, room, { type: 'playCard', seat: A, handIndex: roomGive(room, A, 'Good Whale') });
  tickIn(R, room, { type: 'playCard', seat: D, handIndex: roomGive(room, D, 'Bubb') });
  tickIn(R, room, { type: 'doneDeploying', seat: A });
  const t = tickIn(R, room, { type: 'doneDeploying', seat: D });
  const pb = playbackFrames({ seat: D, held: t.frames[D]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, D) });
  const v = pb.frames.find(f => f.kind === 'opp')!.view;
  assert.equal(cardsOf(v, A, 'Good Whale'), 1, 'their move, on their side');
  assert.ok(v.players[A]!.hand.every(c => c === HIDDEN_CARD), 'their hand face down');
  assert.ok(!JSON.stringify(v).includes('Hooba-God'), 'nothing in it names a card still in their hand');
  assert.equal(cardsOf(v, D, 'Bubb'), 1, 'my side as I left it, my own Bubb included');
});

test('cr:annexd.recap.what.nothing-to-show — a move that changes nothing on the board gets no frame, and its log line is kept', () => {
  const room = R.createRoom('U23RN', 23195, [...NAMES]);
  roomToDeploy(R, room);
  const A = room.state.deployPlayer as Seat, D = otherSeat(A);
  tickIn(R, room, { type: 'doneDeploying', seat: A });
  const t = tickIn(R, room, { type: 'doneDeploying', seat: D });
  const pb = playbackFrames({ seat: D, held: t.frames[D]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, D) });
  assert.equal(pb.frames.filter(f => f.kind === 'opp').length, 0, 'done deploying is not a frame');
  const told = [...pb.frames.flatMap(f => f.events), ...pb.rest].map(e => e.msg);
  assert.ok(told.some(m => /is done deploying/.test(m)), 'its line still reaches the log');
});

test('cr:annexd.recap.what.end-of-turn — the end of turn plays as one frame per trigger, in order', () => {
  const room = R.createRoom('U23RE', 23196, [...NAMES]);
  roomToDeploy(R, room);
  const A = room.state.deployPlayer as Seat, D = otherSeat(A);
  roomMana(room, A); roomMana(room, D);
  tickIn(R, room, { type: 'playCard', seat: A, handIndex: roomGive(room, A, 'Harbinger of Immolation') });
  tickIn(R, room, { type: 'playCard', seat: D, handIndex: roomGive(room, D, 'Cosmic Devourer') });
  tickIn(R, room, { type: 'doneDeploying', seat: A });
  const t = tickIn(R, room, { type: 'doneDeploying', seat: D });
  assert.equal(t.close!.frames.length, 2, 'two end-of-turn triggers, two frames');
  const ats = t.close!.frames.map(f => f.at);
  assert.deepEqual([...ats].sort((x, y) => x - y), ats, 'in the order they resolved');
  const pb = playbackFrames({ seat: D, held: t.frames[D]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, D) });
  const tail = pb.frames.filter(f => f.kind === 'tail');
  assert.equal(tail.length, 2);
  assert.ok(tail.every(f => f.events.some(e => e.type === 'resolved')), 'each holds the resolution it shows');
});

test('cr:annexd.recap.what.resource-step — the resource step close is sent whole in one update, with no playback', () => {
  const src = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(playback && step !== 'plan'\) \{/, 'only a haste or deployment close is played back');
  assert.match(src, /sendToSeat\(room, seat, seatMsg\('update', \{\n\s*step,\n\s*\.\.\.baseView\(room, seat\),\n\s*reveal: redact\(revealEvents\),/,
    'a resource-step close goes out as one update carrying its reveal');
  assert.match(src, /if \(close && wasKey !== 'plan'\) \{/, 'and nobody is held off the clock to watch it');
  // the room side: the resource step closes on the second done, and that same action opens the haste step
  const room = R.createRoom('U23RR', 23197, [...NAMES]);
  assert.equal(room.segKey, 'plan');
  tickIn(R, room, { type: 'donePlanning', seat: 0 });
  const t = tickIn(R, room, { type: 'donePlanning', seat: 1 });
  assert.ok(t.closed, 'one action closes it');
  assert.equal(room.segKey, 'haste');
});

test('cr:annexd.recap.what.undo — undoing a move inside the step takes its frame with it and keeps the others', () => {
  const room = R.createRoom('U23RU', 36051, [...NAMES], 'shared', undefined, undefined, 'playback-deploy');
  assert.equal(room.state.phase, 'deploy');
  const OPP: Seat = 1, YOU: Seat = 0;
  const hand = () => room.state.players[OPP]!.hand;
  tickIn(R, room, { type: 'playCard', seat: OPP, handIndex: hand().indexOf('Sparkwraith') });
  tickIn(R, room, { type: 'playCard', seat: OPP, handIndex: hand().indexOf('Ephemeral Skywalker') });
  assert.equal(room.heldFrames[YOU]!.length, 2);
  assert.deepEqual(R.undoForSeat(room, OPP), { ok: true });
  assert.equal(room.heldFrames[YOU]!.length, 1, 'the undone move frame is gone');
  assert.equal(cardsOf(room.heldFrames[YOU]![0]!.state, OPP, 'Sparkwraith'), 1, 'the other frame is kept');
  assert.equal(cardsOf(room.heldFrames[YOU]![0]!.state, OPP, 'Ephemeral Skywalker'), 0);
});

test('cr:annexd.general.not-rules — the pacing conventions change no legality: a standing pass, a playback hold and full control leave the offered actions equal to the engine, and an action offered during the opponent decision is legal by the engine once it closes', () => {
  const room = R.createRoom('U23NR', 23198, [...NAMES], 'shared', undefined, undefined, 'sandbox');
  const A = room.state.initiative as Seat;
  tick(room, { type: 'sandboxSpawn', seat: A, card: 'Lithoghul', to: 'play' });
  tick(room, { type: 'sandboxSpawn', seat: otherSeat(A), card: 'Bubb', to: 'play' });
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) if (room.state.hasteDone && !room.state.hasteDone[s]) tick(room, { type: 'doneHaste', seat: s });
  const lith = Object.values(room.state.entities).find(e => e.card === 'Lithoghul')!.id;
  tick(room, { type: 'declareAttack', seat: A, columns: [[lith]] });
  const P = room.state.priority as Seat;
  const engine = (s: Seat) => JSON.stringify(legalActions(room.state, s));
  const offered = (s: Seat) => JSON.stringify(R.legalInRoom(room, s));
  assert.equal(offered(P), engine(P), 'positive control: the room offers what the engine allows');
  room.sockets = [{} as never, {} as never];
  R.setPassAll(room, P, ARM_ALL);
  R.setWatchHold(room, otherSeat(P), Date.now() + 60_000);
  R.settleClock(room);
  for (const s of [0, 1] as Seat[]) assert.equal(offered(s), engine(s), `seat ${s}: a standing pass or a playback hold changes nothing offered`);
  R.setPassAll(room, P, null);
  R.setFullControl(room, P, true);
  for (const s of [0, 1] as Seat[]) assert.equal(offered(s), engine(s), `seat ${s}: full control changes nothing offered`);
  // the concurrency convention: seat 1 deploys while seat 0 answers its Wraith trigger
  const h = wraithInDeployment(1);
  assert.equal(h.state.decision?.seat, 0);
  const early = R.legalForSeat(h.state, 1, 'deploy').filter(a => a.type !== 'concede');
  assert.ok(early.length > 0, 'the server offers seat 1 its own deployment moves meanwhile');
  h.do({ type: 'decide', seat: 0, choice: 0 });
  const later = legalActions(h.state, 1).map(a => JSON.stringify(a));
  for (const a of early) assert.ok(later.includes(JSON.stringify(a)), `offered early, legal by the engine once the decision closes: ${JSON.stringify(a)}`);
});

test('cr:annexd.clocks.running.playback — a seat watching a recap is off the clock until it is done or the hold lapses, and acting ends the hold', () => {
  const room = R.createRoom('U23CP', 23199, [...NAMES]);
  room.sockets = [{} as never, {} as never];
  R.settleClock(room);
  assert.deepEqual(room.clockRun, [true, true], 'positive control: planning bills both seats');
  R.setWatchHold(room, 0, Date.now() + 60_000);
  R.settleClock(room);
  assert.deepEqual(room.clockRun, [false, true], 'the watching seat is not billed');
  const before = room.clockMs[0];
  room.clockStamp -= 5000;
  R.settleClock(room);
  assert.equal(room.clockMs[0], before, 'and loses nothing while it watches');
  R.setWatchHold(room, 0, null);
  R.settleClock(room);
  assert.deepEqual(room.clockRun, [true, true], 'done watching: back on the clock');
  R.setWatchHold(room, 1, Date.now() - 1);
  R.settleClock(room);
  assert.equal(room.watchHold[1], null, 'a hold past its deadline lapses');
  assert.deepEqual(room.clockRun, [true, true]);
  const src = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
  assert.match(src, /function landAction[\s\S]{0,200}setWatchHold\(room, seat, null\)/, 'acting ends the hold');
});
