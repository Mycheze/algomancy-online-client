/* THE TAKE-BACK INSIDE A HIDDEN SIMULTANEOUS SEGMENT (run: node test-undo-segment.ts).
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT test-hidden.ts
 *
 * Two owner reports, one day apart, about the same thing:
 *
 *   #37 (UZRG, 2026-08-21) "Planning should be like deployment, entirely
 *       divorced from what your opponent is doing. But right now, you can't
 *       take back making the wrong resource or recycling the wrong card if
 *       your opponent does something (which shouldn't matter)…"
 *   #76 (WEHH, 2026-08-22) "Despite Deployment being entirely separate from
 *       the opponent, I can't take back some things and get the error: '✗ your
 *       opponent has already acted on top of that one — it cannot be taken
 *       back now'. What they do doesn't matter during deployment, so I should
 *       always be able to."
 *
 * #37 was marked FIXED. Its two guards are `test-new-features.ts::recycle was
 * untouched` and `test-hidden.ts::freeze is captured at room creation`, and
 * NEITHER COULD EVER HAVE FAILED ON THE BEHAVIOUR #76 DESCRIBES: both drive
 * the resource step with `recycleForResource`, which allocates no entity id
 * and draws no RNG, so `segTouched` is false for it and the splice gate the
 * report is about is never reached at all. #37's fix built the three hidden
 * segments — which decide WHICH of your actions an undo looks at. It did not
 * touch the splice gate — which decides whether the undo MAY GO. The second
 * half stayed as it was for every action that allocates an entity id, which is
 * every deployment play, so the report came back one day later.
 *
 * So this file pins the REPORTED SHAPE, and only the reported shape:
 *
 *   seat 0 acts during deployment → seat 1 acts during deployment WITH A
 *   PAYLOAD (a real play, not the bare `doneDeploying` the old gate already
 *   exempted) → seat 0's own last action must still be undoable, and seat 1's
 *   position must come out of the rebuild untouched.
 *
 * plus the one case that must still be refused, so the gate cannot be widened
 * away by accident, plus the same shape in the resource step (#37 says in so
 * many words that planning is meant to behave like deployment).
 *
 * IT DRIVES `undoForSeat` — the actual production decision, moved out of
 * main.ts's WebSocket handler for exactly this reason. A decision that only
 * exists inside a socket handler can only be reached by playing a whole game
 * over a socket, which is a test nobody writes; that is the history above.
 *
 * NOTE ON SETUP. The positive cases play a REAL game with only legal actions
 * and no state injection, because an undo is a rebuild from `seed + actions`
 * and an injected resource or card is in neither — a room set up by hand
 * cannot be rebuilt, so every undo in it is refused for the wrong reason
 * (test-forensics.ts says the same thing about its own §4). The two negative
 * cases DO inject, and may: they assert a refusal that is decided by
 * `spliceable()` before any rebuild happens, and the log they check is the
 * one they wrote.
 */
import { rmSync } from 'node:fs';
import type { Action, GameState, Seat } from '../engine/src/types.ts';
import { apply, forcedAction, legalActions } from '../engine/src/apply.ts';
import { gameFile } from './test-util.ts';
import {
  applyToRoom, createRoom, openSegment, segmentKey, spliceable, undoActionAt, undoForSeat,
  type Room,
} from './rooms.ts';

let failures = 0;
const ok = (cond: unknown, label: string): void => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
};
const codes: string[] = [];
const room$ = (code: string, seed: number): Room => { codes.push(code); return createRoom(code, seed); };

/** apply + drain forced steps + reconcile the segment, exactly like main.ts */
function actOn(room: Room, a: Action): void {
  const wasKey = room.segKey;
  applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    applyToRoom(room, f);
  }
  if (wasKey !== segmentKey(room.state)) openSegment(room);
}

/** answer any pending decision, so a play lands finished rather than half-cast */
function drain(room: Room): void {
  for (let g = 0; g < 20 && room.state.decision; g++) {
    const d = room.state.decision;
    actOn(room, { type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
  }
}

const first = (room: Room, seat: Seat, type: Action['type']): Action | undefined =>
  legalActions(room.state, seat).find(a => a.type === type);

/**
 * The first legal play that RESOLVES on its own, leaving no decision pending.
 *
 * A play that suspends on a choice is two actions in the log (the play, then
 * the `decide`), and a single-step undo of such a pair takes the `decide` —
 * stranding the cast, which the rebuild correctly refuses. That is a real and
 * separate mechanism (the client's cast-cancel chains one undo per state,
 * docs/07), and mixing it into these cases would test it instead of the gate.
 */
function cleanPlay(room: Room, seat: Seat): Action | undefined {
  for (const a of legalActions(room.state, seat)) {
    if (a.type !== 'playCard') continue;
    try { if (!apply(room.state, a).state.decision) return a; } catch { /* next */ }
  }
  return undefined;
}

/**
 * A room parked in a REAL deployment step where both seats have a legal play,
 * reached by legal actions only. Seeds are tried in order and the first that
 * gets there wins, so the file keeps working when the card pool moves under
 * it — a hard-coded seed that stops reaching deployment is a test that
 * silently stops testing.
 */
const SEEDS = [100016, 100020, 100023, 100030, 100039, 100015, 100027, 100021,
  100026, 100036, 100009, 100029, 100032];

function deployingRoom(code: string): Room {
  for (const seed of SEEDS) {
    const room = room$(code, seed);
    try {
      for (let turn = 0; turn < 6; turn++) {
        for (const s of [0, 1] as Seat[]) {
          const r = first(room, s, 'recycleForResource');
          if (r) actOn(room, r);
          for (let k = 0; k < 4; k++) {
            const v = first(room, s, 'activateResource');
            if (v) actOn(room, v);
          }
        }
        for (const s of [0, 1] as Seat[]) {
          const d = first(room, s, 'donePlanning'); if (d) actOn(room, d);
        }
        for (const s of [0, 1] as Seat[]) {
          const d = first(room, s, 'doneHaste'); if (d) actOn(room, d);
        }
        for (let g = 0; room.state.phase === 'battle' && g < 60; g++) {
          if (room.state.decision) { drain(room); continue; }
          let did = false;
          for (const s of [0, 1] as Seat[]) {
            const d = legalActions(room.state, s).find(a => a.type === 'passPriority'
              || a.type === 'declareAttack' || a.type === 'declareBlocks');
            if (d) { actOn(room, d); did = true; }
          }
          if (!did) break;
        }
        if (room.state.phase === 'deploy' && !room.state.decision
          && cleanPlay(room, 0) && cleanPlay(room, 1)) return room;
        for (const s of [0, 1] as Seat[]) {
          const d = first(room, s, 'doneDeploying'); if (d) actOn(room, d);
        }
      }
    } catch { /* this seed's game went somewhere unusable — try the next */ }
    rmSync(gameFile(code), { force: true });
  }
  throw new Error('no seed reached a deployment both seats can play into');
}

/**
 * Everything about ONE seat's position that is theirs: their private zones and
 * every card they have on the board, by NAME rather than by entity id — the
 * undo renumbers ids on purpose, and a test that reads ids would fail on the
 * renumbering rather than on the damage.
 */
function positionOf(s: GameState, seat: Seat): string {
  const p = s.players[seat]!;
  return JSON.stringify({
    hand: [...p.hand].sort(),
    bin: [...p.bin].sort(),
    life: p.life,
    resources: p.resources.map(r => `${r.kind}:${r.state}`).sort(),
    board: Object.values(s.entities).filter(e => e.controller === seat)
      .map(e => `${e.card}/${e.kind}`).sort(),
  });
}

// ══ 1. THE REPORTED SHAPE (#76) ═══════════════════════════════════════
//
// Deployment. Seat 0 deploys. Seat 1 deploys — a real play with a payload,
// which is what the old gate refused on. Seat 0's own play must still come
// back, and seat 1's position must be exactly what it was.
{
  const room = deployingRoom('UND1');
  console.log('\n[#76: the opponent deploying does not take your undo away]');
  ok(room.segKey === 'deploy', 'the deploy segment is open');

  const myHandWas = [...room.state.players[0]!.hand].sort().join(',');
  actOn(room, cleanPlay(room, 0)!);
  drain(room);
  const myPlay = room.actions.length - 1;
  ok(room.state.players[0]!.hand.length < myHandWas.split(',').length, 'seat 0 played a card');

  actOn(room, cleanPlay(room, 1)!);
  drain(room);
  const theirs = room.actions.slice(myPlay + 1);
  ok(theirs.length > 0 && theirs.every(a => a.seat === 1),
    'seat 1 acted after seat 0, inside the same hidden segment');
  ok(theirs.some(a => a.type === 'playCard'),
    'and it carries a PAYLOAD — not the bare doneDeploying the old gate exempted');
  ok(room.segTouched[myPlay] === true,
    "seat 0's play moved the id clock, which is what used to make it unspliceable");
  ok(spliceable(room, myPlay, 0),
    'the cheap id screen lets it through: seat 1 named no id seat 0 allocated');

  const theirPositionWas = positionOf(room.state, 1);
  const out = undoForSeat(room, 0);
  ok(out.ok, `seat 0's own deployment play is still undoable (${out.ok ? 'accepted' : out.why})`);
  ok([...room.state.players[0]!.hand].sort().join(',') === myHandWas,
    "and the undo really put seat 0's card back in hand");
  ok(positionOf(room.state, 1) === theirPositionWas,
    "while seat 1's whole position came through the rebuild untouched");
  ok(room.actions.length === myPlay + theirs.length,
    'exactly one action left the log');
  ok(room.actions.slice(myPlay).every(a => a.seat === 1),
    "and it was seat 0's, not seat 1's");
  ok(room.segKey === 'deploy' && room.segSnapshot !== null,
    'the rebuild left the deploy segment open');
}

// ══ 2. …and the other way round ═══════════════════════════════════════
//
// The report is symmetric: whichever of you deployed first must be able to
// take it back. Under the old gate the FIRST mover was the one who lost the
// undo, which is the half a player notices.
{
  const room = deployingRoom('UND2');
  console.log('\n[#76: symmetric — the first mover is the one who used to lose it]');
  const handWas = [...room.state.players[1]!.hand].sort().join(',');
  actOn(room, cleanPlay(room, 1)!);
  drain(room);
  const theirPlay = room.actions.length - 1;
  actOn(room, cleanPlay(room, 0)!);
  drain(room);
  ok(room.actions.length > theirPlay + 1 && room.actions[theirPlay + 1]!.seat === 0,
    'seat 0 moved second, with a payload');
  const oppWas = positionOf(room.state, 0);
  const out = undoForSeat(room, 1);
  ok(out.ok, `seat 1 (who moved first) can still take theirs back (${out.ok ? 'accepted' : out.why})`);
  ok([...room.state.players[1]!.hand].sort().join(',') === handWas, 'their card is back in hand');
  ok(positionOf(room.state, 0) === oppWas, "and seat 0's position is untouched");
}

// ══ 3. THE NEGATIVE — the one residual case, and nothing wider ════════
//
// The hazard is not "the opponent acted". It is "a later action NAMES an
// entity id that the splice would renumber". Seat 1 mods their own unit, so
// the log now carries `hostId: <an id above seat 0's floor>`; splicing seat
// 0's play shifts it, and the log is replayed VERBATIM. Refused — and the
// refusal must say THAT rather than blaming the opponent for existing.
//
// (Injected setup is fine here: the refusal is decided by `spliceable()`
// before any rebuild runs, and what is asserted afterwards is that the log
// this test wrote is still exactly the log this test wrote.)
{
  const room = room$('UND3', 616161);
  console.log('\n[the residual case: a later move that NAMES a renumbered id]');
  actOn(room, { type: 'donePlanning', seat: 0 });
  actOn(room, { type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    for (let i = 0; i < 4; i++) room.state.players[s]!.resources.push({ kind: 'fire', state: 'open' });
    room.state.players[s]!.hand.push('Ignis Sprite');
  }
  actOn(room, { type: 'playCard', seat: 0, handIndex: room.state.players[0]!.hand.length - 1 });
  const myPlay = room.actions.length - 1;
  actOn(room, { type: 'playCard', seat: 1, handIndex: room.state.players[1]!.hand.length - 1 });
  ok(spliceable(room, myPlay, 0), 'with only their play on top of it, the splice is allowed');

  const theirUnit = Object.values(room.state.entities)
    .find(e => e.controller === 1 && e.kind === 'unit')!.id;
  room.state.players[1]!.hand.push('Animated Spark');
  actOn(room, { type: 'augment', seat: 1, from: 'hand',
    index: room.state.players[1]!.hand.length - 1, hostId: theirUnit });
  ok(room.actions[room.actions.length - 1]!.type === 'augment', 'seat 1 mods their own unit');
  ok(!spliceable(room, myPlay, 0),
    `and now that the log NAMES entity ${theirUnit}, the splice is refused`);

  const before = JSON.stringify(room.actions);
  const out = undoForSeat(room, 0);
  ok(!out.ok, 'the undo is refused');
  ok(!out.ok && /renumber/.test(out.why),
    `the refusal names the real reason (${out.ok ? '' : out.why})`);
  ok(!out.ok && !/opponent has already acted/.test(out.why),
    'and the reported error text is gone for good');
  ok(JSON.stringify(room.actions) === before, 'the log is exactly as it was');
  ok(Object.values(room.state.entities).some(e => e.controller === 0 && e.kind === 'unit'),
    "and seat 0's unit is still on the board");
}

// ══ 4. the gate is about the ID, not about who acted ══════════════════
//
// Same board, but the mod is on seat 0's OWN unit. It still names an id above
// seat 1's floor, so seat 1 is still refused — the opponent's identity is not
// what the gate is made of, and neither is whose action carries the reference.
{
  const room = room$('UND4', 717171);
  console.log('\n[the id is the reason, not who acted]');
  actOn(room, { type: 'donePlanning', seat: 0 });
  actOn(room, { type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    for (let i = 0; i < 4; i++) room.state.players[s]!.resources.push({ kind: 'fire', state: 'open' });
    room.state.players[s]!.hand.push('Ignis Sprite');
  }
  actOn(room, { type: 'playCard', seat: 1, handIndex: room.state.players[1]!.hand.length - 1 });
  const theirPlay = room.actions.length - 1;
  actOn(room, { type: 'playCard', seat: 0, handIndex: room.state.players[0]!.hand.length - 1 });
  const myUnit = Object.values(room.state.entities)
    .find(e => e.controller === 0 && e.kind === 'unit')!.id;
  room.state.players[0]!.hand.push('Animated Spark');
  actOn(room, { type: 'augment', seat: 0, from: 'hand',
    index: room.state.players[0]!.hand.length - 1, hostId: myUnit });
  ok(!spliceable(room, theirPlay, 1),
    'seat 1 cannot splice under a mod that names an id above their floor…');
  const out = undoForSeat(room, 1);
  ok(!out.ok && /renumber/.test(out.why), '…and undoForSeat refuses it with that reason');
  // the mod itself is the tail, so it names nothing later and is still its
  // own author's to take back — the gate is narrow, not sticky
  ok(spliceable(room, room.actions.length - 1, 0),
    'the tail action, naming nothing after it, is still spliceable');
}

// ══ 5. #37's other half: PLANNING is the same segment, so it is fixed too ══
//
// "Planning should be like deployment" — and it is, because none of this knows
// which phase it is looking at: `segmentKey` returns 'plan' / 'haste' /
// 'deploy' and `undoForSeat` reads the SEGMENT, never the phase.
{
  const room = room$('UND5', 818181);
  console.log("\n[#37: planning is the same segment, and the same rule]");
  ok(room.segKey === 'plan', 'a fresh room opens inside the plan segment');
  const handWas = room.state.players[0]!.hand.length;
  actOn(room, { type: 'recycleForResource', seat: 0, handIndex: 0, element: room.state.elements[0]! });
  actOn(room, { type: 'recycleForResource', seat: 1, handIndex: 0, element: room.state.elements[0]! });
  const theirsWas = positionOf(room.state, 1);
  const out = undoForSeat(room, 0);
  ok(out.ok, `seat 0's recycle survives seat 1 recycling on top of it (${out.ok ? 'accepted' : out.why})`);
  ok(room.state.players[0]!.hand.length === handWas, 'the card came back');
  ok(positionOf(room.state, 1) === theirsWas, "and the opponent's own recycle was untouched");
  ok(room.actions.length === 1 && room.actions[0]!.seat === 1,
    "one action left the log, and it was seat 0's");
}

// ══ 6. THE OTHER RESIDUAL CASE: still legal, but no longer the same ═══
//
// The id route is only one of the three ways a splice reaches a later action.
// The second is the action's EFFECT: take it out and every zone it touched is
// different, so a later index names something else — and stays perfectly legal
// while doing it. That is silent corruption, it is worse than any refusal, and
// the rebuild cannot see it, because the rebuild only notices actions that
// become ILLEGAL.
//
// Built out of two recycles and an activation, which is as ordinary as the
// resource step gets:
//
//   1. recycle hand[0] (a fire resource lands at slot n)
//   2. recycle hand[0] AGAIN — a different card now, and a water resource
//      lands at slot n+1
//   3. activate slot n — the fire one
//
// Splice (1) and nothing becomes illegal. (2) still recycles "hand[0]" and (3)
// still activates "slot n" — but hand[0] is now the card (1) took, and slot n
// now holds the water resource. Two of the player's own decisions quietly
// became different decisions. `spliceable()` cannot see any of it: recycling
// allocates no entity id, so the cheap screen passes it. The measurement is
// what catches it.
{
  const room = room$('UND7', 555111);
  console.log('\n[still legal, but no longer the same — measured, not predicted]');
  const els = room.state.elements;
  const slot = room.state.players[0]!.resources.length;
  actOn(room, { type: 'recycleForResource', seat: 0, handIndex: 0, element: els[0]! });
  const firstRecycle = room.actions.length - 1;
  actOn(room, { type: 'recycleForResource', seat: 0, handIndex: 0, element: els[1]! });
  actOn(room, { type: 'activateResource', seat: 0, index: slot });
  ok(room.state.players[0]!.resources[slot]!.kind === els[0],
    `the activated slot holds the ${els[0]} resource the first recycle made`);
  ok(room.state.players[0]!.resources[slot]!.state === 'open', 'and it is the one that got flipped');

  ok(room.segTouched[firstRecycle] === false,
    'the recycle moved neither the id clock nor the RNG stream…');
  ok(spliceable(room, firstRecycle, 0),
    '…so the cheap id screen has nothing to say about it');

  const before = JSON.stringify(room.actions);
  const refused = undoActionAt(room, firstRecycle);
  ok(refused.length > 0, 'and yet the undo is refused');
  ok(refused.every(r => r.kind === 'changed'),
    'as CHANGED, not lost — nothing became illegal, which is the whole point');
  ok(refused.some(r => r.type === 'recycleForResource'),
    'the second recycle is named: it would have taken a different card');
  ok(refused.some(r => r.type === 'activateResource'),
    'and so is the activation: it would have flipped a different resource');
  ok(JSON.stringify(room.actions) === before, 'the log was rolled back exactly');
  ok(room.state.players[0]!.resources[slot]!.kind === els[0]
    && room.state.players[0]!.resources[slot]!.state === 'open',
    'and so was the state — the roll-back is a rebuild, not a patch');
}

// ══ 7. the barrier still closes the window ════════════════════════════
//
// Widening the gate must not widen the WINDOW: once both seats have pressed
// done, the segment closes and that step's decisions lock.
{
  const room = deployingRoom('UND6');
  console.log('\n[the barrier still closes the take-back window]');
  actOn(room, cleanPlay(room, 0)!);
  drain(room);
  actOn(room, { type: 'doneDeploying', seat: 0 });
  const stillMine = undoForSeat(room, 0);
  ok(stillMine.ok, 'your own done-flag is inside the segment and comes back off');
  actOn(room, { type: 'doneDeploying', seat: 0 });
  actOn(room, { type: 'doneDeploying', seat: 1 });
  drain(room);
  ok(room.state.turn > 2 || room.state.phase !== 'deploy', 'both done → the turn moved on');
  const shut = undoForSeat(room, 0);
  ok(!shut.ok, 'and the deployment is no longer reachable');
  ok(!shut.ok && /nothing of yours this step|undo only works/.test(shut.why),
    `the window is what closed it, not the gate (${shut.ok ? '' : shut.why})`);
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
for (const c of codes) rmSync(gameFile(c), { force: true });
process.exit(failures ? 1 : 0);
