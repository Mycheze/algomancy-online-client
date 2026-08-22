/* Direct-drive test of the HIDDEN SIMULTANEOUS SEGMENT machinery
 * (run: node test-hidden.ts). No sockets: drives rooms.ts + view.ts the way
 * main.ts does and checks the freeze / holdback / reveal / undo bookkeeping
 * for all three segments — the resource step, the haste step, deployment.
 *
 * Was test-deploy.ts, when deployment was the only hidden step. */
import { rmSync } from 'node:fs';
import type { Action, EngineEvent, GameState, Seat } from '../engine/src/types.ts';
import { apply, createGame, forcedAction } from '../engine/src/apply.ts';
import { viewFor } from './view.ts';
import { gameFile } from './test-util.ts';
import {
  applyToRoom, createRoom, openSegment, segmentKey, spliceable, undoActionAt,
  type Room, type SegKey,
} from './rooms.ts';

let failures = 0;
const ok = (cond: unknown, label: string): void => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
};
const codes: string[] = [];
const room$ = (code: string, seed: number): Room => { codes.push(code); return createRoom(code, seed); };

/** every reveal the drive below would have put on the wire */
interface Reveal { step: SegKey; to: Seat; reveal: EngineEvent[] }
const reveals: Reveal[] = [];

/** apply + drain forced steps + reconcile the segment, exactly like main.ts */
function actOn(room: Room, a: Action): void {
  const wasKey = room.segKey;
  const events = applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    events.push(...applyToRoom(room, f));
  }
  const nowKey = segmentKey(room.state);
  if (wasKey === nowKey) return;
  const opp = (a.seat === 0 ? 1 : 0) as Seat;
  const theirs = wasKey ? room.heldEvents[opp]!.filter(e => !events.includes(e)) : [];
  const mine = wasKey ? room.heldEvents[a.seat]!.filter(e => !events.includes(e)) : [];
  openSegment(room);
  if (wasKey) {
    reveals.push({ step: wasKey, to: a.seat, reveal: mine });
    reveals.push({ step: wasKey, to: opp, reveal: theirs });
  }
}

// ══ 1. the resource step is a hidden segment ══════════════════════════
{
  const room = room$('HID1', 909090);
  const act = (a: Action): void => actOn(room, a);

  console.log('\n[the plan segment opens at turn 1, before any action]');
  ok(room.segKey === 'plan', "a fresh room is already inside the 'plan' segment");
  ok(room.segSnapshot !== null, 'the resource-step freeze is captured at room creation');
  ok(room.segStartIndex === 0, 'the segment starts at action 0 (turn 1 has no preceding action)');

  console.log('\n[a rename after the snapshot still reaches the opponent]');
  // renameSeat writes outside the action log, so it never reaches the freeze —
  // viewFor must carry the LIVE name over the frozen player slot
  room.names[1] = 'Rashi';
  room.state.players[1]!.name = 'Rashi';
  ok(viewFor(room.state, 0, room.segSnapshot).players[1]!.name === 'Rashi',
    'the live name wins over the frozen (placeholder-named) player slot');

  console.log('\n[hidden resource decisions]');
  const frozenHand = viewFor(room.state, 0, room.segSnapshot).players[1]!.hand.length;
  const frozenRes = viewFor(room.state, 0, room.segSnapshot).players[1]!.resources.length;
  const frozenDeck = viewFor(room.state, 0, room.segSnapshot).sharedDeck.length;
  act({ type: 'recycleForResource', seat: 1, handIndex: 0, element: room.state.elements[0]! });
  const v0 = viewFor(room.state, 0, room.segSnapshot);
  ok(room.state.players[1]!.resources.length === frozenRes + 1,
    'the resource really exists in the authoritative state');
  ok(v0.players[1]!.resources.length === frozenRes,
    "seat 0's view still shows the opponent's resources as of the step's start");
  ok(v0.players[1]!.hand.length === frozenHand,
    "seat 0 still sees the opponent's hand size as of the step's start");
  ok(v0.sharedDeck.length === frozenDeck,
    'the shared deck count does not leak the opponent recycling into it');
  ok(viewFor(room.state, 1, room.segSnapshot).players[1]!.resources.length === frozenRes + 1,
    'seat 1 sees their own new resource');
  ok(room.heldEvents[0].length > 0 && room.heldEvents[1].length === 0,
    "the recycle's events are held back from seat 0 only");

  console.log('\n[your opponent acting no longer takes your undo away]');
  // seat 1 recycled at index 0; seat 0 now recycles on top of it. THE REPORT:
  // "you can't take back making the wrong resource ... if your opponent does
  // something (which shouldn't matter)".
  act({ type: 'recycleForResource', seat: 0, handIndex: 0, element: room.state.elements[0]! });
  ok(room.actions.length === 2 && room.actions[1]!.seat === 0,
    'the opponent acted after you, inside the same segment');
  let mine = room.actions.length - 1;
  while (mine >= room.segStartIndex && room.actions[mine]!.seat !== 1) mine--;
  ok(mine === 0, 'the splice finds YOUR most recent action inside the segment');
  ok(room.segTouched[0] === false && room.segTouched[1] === false,
    'resource-step actions move neither the id clock nor the RNG stream');
  ok(spliceable(room, mine, 1), 'so the splice is allowed even though the opponent acted');
  undoActionAt(room, mine);
  ok(room.state.players[1]!.resources.length === frozenRes, "the undo took back seat 1's resource");
  ok(room.state.players[0]!.resources.length === frozenRes + 1, "seat 0's own recycle survived the rebuild");
  ok(room.segKey === 'plan' && room.segSnapshot !== null, 'the rebuild restored the plan segment');
  ok(room.segStartIndex === 0, 'and its start index');

  console.log('\n[the reveal at the barrier]');
  act({ type: 'recycleForResource', seat: 1, handIndex: 0, element: room.state.elements[0]! });
  const heldFor0 = room.heldEvents[0].length;
  ok(heldFor0 > 0, 'events held for seat 0 before the reveal');
  reveals.length = 0;
  act({ type: 'donePlanning', seat: 0 });
  ok(reveals.length === 0, 'one player finishing does not open the screen');
  act({ type: 'donePlanning', seat: 1 });
  ok(reveals.length === 2, 'both done → a reveal for each seat');
  ok(reveals.every(r => r.step === 'plan'), "the reveal is stamped step:'plan'");
  const to0 = reveals.find(r => r.to === 0)!;
  ok(to0.reveal.some(e => e.type === 'recycle'), "seat 0's reveal carries the opponent's recycle");
  ok(reveals.find(r => r.to === 1)!.reveal
    .filter(e => e.type === 'recycle').every(e => e.data?.['seat'] === 0),
    'each seat is shown only the OTHER one’s hidden moves');
  const after0 = viewFor(room.state, 0, room.segSnapshot);
  ok(after0.players[1]!.resources.length === frozenRes + 1,
    'after the reveal seat 0 sees the opponent’s resources');
  ok(room.segKey !== 'plan', 'the resource step is over');
}

// ══ 2. deployment, as before ══════════════════════════════════════════
{
  const room = room$('HID2', 424242);
  const act = (a: Action): void => actOn(room, a);

  console.log('\n[into deployment]');
  act({ type: 'donePlanning', seat: 0 });
  act({ type: 'donePlanning', seat: 1 });
  // empty boards: the forced drain walks the whole battle by itself
  ok(room.state.phase === 'deploy', 'forced actions drained the empty battle into deploy');
  ok(room.segKey === 'deploy', "the segment key followed it to 'deploy'");
  ok(room.segSnapshot !== null, 'deploy snapshot captured');
  ok(room.segStartIndex === room.actions.length, 'deploy segment starts after the drained battle');

  console.log('\n[hidden deployment]');
  // give seat 1 something to deploy (test-only state injection)
  room.state.players[1]!.resources.push({ kind: 'fire', state: 'open' });
  room.state.players[1]!.hand.push('Ignis Sprite');
  const handSize0Sees = viewFor(room.state, 0, room.segSnapshot).players[1]!.hand.length;
  act({ type: 'playCard', seat: 1, handIndex: room.state.players[1]!.hand.length - 1 });

  // (Ignis Sprite's spawn trigger also makes a Fireball token — both are seat 1's)
  const unitIds = Object.values(room.state.entities).filter(e => e.controller === 1 && e.kind === 'unit').map(e => e.id);
  ok(unitIds.length === 1, 'the unit really exists in the authoritative state');
  const v0 = viewFor(room.state, 0, room.segSnapshot);
  ok(!Object.values(v0.entities).some(e => e.controller === 1),
    "seat 0's view hides the opponent's freshly deployed unit");
  ok(v0.players[1]!.hand.length === handSize0Sees,
    "seat 0 still sees the opponent's hand size as of deploy start");
  const v1 = viewFor(room.state, 1, room.segSnapshot);
  ok(Object.values(v1.entities).some(e => e.controller === 1),
    'seat 1 sees their own deployed unit');
  ok(room.heldEvents[0].length > 0 && room.heldEvents[1].length === 0,
    "the play's events are held back from seat 0 only");

  console.log('\n[undo a hidden deploy action]');
  act({ type: 'doneDeploying', seat: 0 });   // seat 0 finishes first
  // seat 1's play is NOT the last action overall — the segment splice handles it
  const myLast = (() => {
    let i = room.actions.length - 1;
    while (i >= room.segStartIndex && room.actions[i]!.seat !== 1) i--;
    return i;
  })();
  ok(room.actions[myLast]!.type === 'playCard', 'found seat 1 play inside the deploy segment');
  ok(room.segTouched[myLast] === true, 'the play DID move the id clock');
  ok(spliceable(room, myLast, 1),
    'a bare done-flag on top of it is renumber-immune, so the undo still stands');
  undoActionAt(room, myLast);
  ok(!Object.values(room.state.entities).some(e => e.controller === 1), 'undo removed the unit');
  ok(room.state.deployDone?.[0] === true, "seat 0's earlier done-flag survived the splice rebuild");
  ok(room.segSnapshot !== null, 'rebuild restored the deploy snapshot');
  ok(room.segKey === 'deploy', 'and its key');

  console.log('\n[reveal, and the deploy → plan re-snapshot]');
  // replay the play, then finish deployment on both sides
  room.state.players[1]!.resources.push({ kind: 'fire', state: 'open' });
  room.state.players[1]!.hand.push('Ignis Sprite');
  act({ type: 'playCard', seat: 1, handIndex: room.state.players[1]!.hand.length - 1 });
  ok(room.heldEvents[0].length > 0, 'events held for seat 0 before the reveal');
  reveals.length = 0;
  act({ type: 'doneDeploying', seat: 1 });
  ok(room.state.phase === 'planning' && room.state.turn === 2, 'both done → next turn');
  ok(reveals.length === 2 && reveals.every(r => r.step === 'deploy'),
    "the close is stamped step:'deploy'");
  ok(reveals.find(r => r.to === 0)!.reveal.length > 0, "seat 0's reveal is not empty");
  const v0After = viewFor(room.state, 0, room.segSnapshot);
  ok(Object.values(v0After.entities).some(e => e.controller === 1),
    'after the reveal seat 0 sees the deployed unit');
  // doneDeploying → endTurn → startTurn all land on ONE action, so the deploy
  // segment closes and the next turn's plan segment opens on the same action
  ok(room.segKey === 'plan', "the very same action re-opened the next turn's 'plan' segment");
  ok(room.segStartIndex === room.actions.length, 'the new segment starts after it');
  ok(room.segSnapshot?.turn === 2, 'and its freeze is of turn 2, not of the deployment');
  ok(room.heldEvents[0].length === 0 && room.heldEvents[1].length === 0,
    'the held queues were emptied by the close');
}

// ══ 3. the haste step is its own segment, between the other two ═══════
{
  const room = room$('HID4', 606060);
  const act = (a: Action): void => actOn(room, a);
  console.log('\n[the haste step is a segment of its own]');
  // seat 1 alone can haste (Cinder Scuttler, [r]) — the step opens for them
  for (let i = 0; i < 3; i++) room.state.players[1]!.resources.push({ kind: 'fire', state: 'open' });
  room.state.players[1]!.hand.push('Cinder Scuttler');
  reveals.length = 0;
  act({ type: 'donePlanning', seat: 0 });
  act({ type: 'donePlanning', seat: 1 });
  ok(room.segKey === 'haste', "both done planning → the 'haste' segment opens");
  ok(reveals.length === 2 && reveals.every(r => r.step === 'plan'),
    "and the resource step closes with its own step:'plan' reveal");
  ok(room.segStartIndex === room.actions.length, 'the haste segment starts after the barrier');
  ok(room.heldEvents[0].length === 0 && room.heldEvents[1].length === 0,
    'with empty held queues');

  const frozenUnits = Object.values(viewFor(room.state, 0, room.segSnapshot).entities)
    .filter(e => e.controller === 1).length;
  act({ type: 'playCard', seat: 1, handIndex: room.state.players[1]!.hand.length - 1 });
  ok(Object.values(room.state.entities).some(e => e.controller === 1 && e.kind === 'unit'),
    'the haste unit really landed');
  ok(Object.values(viewFor(room.state, 0, room.segSnapshot).entities)
    .filter(e => e.controller === 1).length === frozenUnits,
    'seat 0 does not see it while the haste step is still open');
  ok(room.heldEvents[0].length > 0, 'its events are held for seat 0');

  reveals.length = 0;
  act({ type: 'doneHaste', seat: 1 });
  ok(reveals.length === 2 && reveals.every(r => r.step === 'haste'),
    "the haste step closes with step:'haste'");
  ok(reveals.find(r => r.to === 0)!.reveal.length > 0, "seat 0's haste reveal is not empty");
  ok(Object.values(viewFor(room.state, 0, room.segSnapshot).entities)
    .some(e => e.controller === 1 && e.kind === 'unit'),
    'and afterwards seat 0 sees the unit');
  // battle is public, so no segment is open there — the unit that just landed
  // means somebody has a real attack to declare, and the drain stops
  ok(room.segKey === null && room.state.phase === 'battle',
    'and battle, which is public, opens no segment at all');
}

// ══ 4. the segTouched gate: refusing rather than silently reordering ══
{
  const room = room$('HID3', 313131);
  const act = (a: Action): void => actOn(room, a);
  console.log('\n[the id/RNG splice gate]');
  act({ type: 'donePlanning', seat: 0 });
  act({ type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    room.state.players[s]!.resources.push({ kind: 'fire', state: 'open' });
    room.state.players[s]!.hand.push('Ignis Sprite');
  }
  act({ type: 'playCard', seat: 1, handIndex: room.state.players[1]!.hand.length - 1 });
  const theirPlay = room.actions.length - 1;
  act({ type: 'playCard', seat: 0, handIndex: room.state.players[0]!.hand.length - 1 });
  ok(room.segTouched[theirPlay] === true, "seat 1's play moved the id clock");
  ok(!spliceable(room, theirPlay, 1),
    "it cannot be spliced out from under the opponent's own play — that would " +
    "renumber their unit and silently drop anything referring to it");
  // and the opponent's play, being last, is still theirs to take back
  ok(spliceable(room, room.actions.length - 1, 0), 'the later play is still spliceable by its own author');
}

// ══ 5. resource-step actions COMMUTE ══════════════════════════════════
//
// The claim the whole 'plan' segment rests on: two seats' resource decisions
// are independent, so the order they happen to arrive in cannot change the
// game. Verified directly rather than argued: same seed, interleaved two ways.
{
  console.log('\n[resource-step actions commute]');
  const els = ['fire', 'water', 'earth'] as const;
  const build = (order: Action[]): { state: GameState; moved: boolean } => {
    let s = createGame(777123, ['A', 'B'], 'shared', [...els] as never).state;
    let moved = false;
    for (const a of order) {
      const before = s;
      s = apply(s, a).state;
      if (before.nextId !== s.nextId || before.rngState !== s.rngState) moved = true;
    }
    return { state: s, moved };
  };
  const A1: Action = { type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' };
  const B1: Action = { type: 'recycleForResource', seat: 1, handIndex: 0, element: 'water' };
  const A2: Action = { type: 'activateResource', seat: 0, index: 0 };
  const B2: Action = { type: 'activateResource', seat: 1, index: 1 };

  const one = build([A1, B1, A2, B2]);
  const two = build([B1, A1, A2, B2]);
  const three = build([A1, A2, B1, B2]);
  ok(!one.moved && !two.moved && !three.moved,
    'no resource-step action moves nextId or rngState (so segTouched is always false there)');

  // the shared deck is the one exception, and a harmless one: recycles land on
  // its BOTTOM, so interleaving orders the bottom differently. Nothing can
  // observe that short of exhausting the deck, which cannot happen inside a
  // segment. Everything else must be identical.
  const norm = (s: GameState): string =>
    JSON.stringify({ ...s, sharedDeck: [...s.sharedDeck].sort() });
  ok(norm(one.state) === norm(two.state), '[A,B,A,B] and [B,A,A,B] reach the same state');
  ok(norm(one.state) === norm(three.state), '[A,B,A,B] and [A,A,B,B] reach the same state');
  ok(one.state.sharedDeck.length === two.state.sharedDeck.length
    && one.state.sharedDeck.slice(0, -2).join() === two.state.sharedDeck.slice(0, -2).join(),
    'and the deck differs only in the order of the two cards on its bottom');
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
for (const c of codes) rmSync(gameFile(c), { force: true });
process.exit(failures ? 1 : 0);
