/* R150 / CT-32 — ONE SEAT'S TRIGGERS MUST NOT FREEZE THE OTHER SEAT'S
 * DEPLOYMENT. (run: node test-concurrency.ts — no sockets, no port.)
 *
 * Playtest #98 (SMVJ, action 238): *"Rashi's start of combat (doing all her
 * Wraith triggers) doesn't need to take away from what I'm doing in
 * Deployment."*
 *
 * ⚠ THE MECHANISM IS NOT THE PRESENTATION LAYER, and §0 below proves it before
 * anything else runs. The engine is one pure reducer over one state, and
 * `apply()` opens with a GLOBAL decision gate that refuses every non-decide
 * action from EITHER seat, while `legalActions()` hands the seat that does not
 * own the decision an EMPTY list. The client's "Waiting for X…" bar is a
 * faithful drawing of that empty list — un-gating the UI on its own would only
 * turn a frozen screen into a screen full of refusals. So the fix is in the
 * server, in two halves that must ship together (rooms.ts):
 *
 *    legalForSeat    what a seat is OFFERED
 *    arrivalVerdict  what happens to what they SEND
 *
 * Everything asserted here is a pure function or a room driven in-process, so
 * none of it needs a whole game played over a socket to reach — which is this
 * repo's own documented root cause for the bug the owner had to report twice.
 *
 * The scenario is real, not stubbed: seat 1 plays Floral Singularity during
 * deployment, which suspends on a genuine engine `payOrDecline` decision —
 * structurally the same "one seat is mid-question inside a hidden simultaneous
 * segment" that R144's start-of-deployment Wraith pile creates.
 */
import { rmSync } from 'node:fs';
import type { Action } from '../engine/src/types.ts';
import { apply, forcedAction, legalActions, IllegalAction } from '../engine/src/apply.ts';
import { registerSynthetic } from '../engine/src/cards/dsl.ts';
import { viewFor } from './view.ts';
import { gameFile } from './test-util.ts';
import {
  applyToRoom, arrivalVerdict, createRoom, deferAction, legalForSeat, MAX_DEFERRED,
  openSegment, segmentKey, takeDeferred, type Room,
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

/** a room parked in turn-1 deployment, both seats still to act */
function inDeployment(code: string): Room {
  const room = room$(code, 424242);
  actOn(room, { type: 'donePlanning', seat: 0 });
  actOn(room, { type: 'donePlanning', seat: 1 });
  return room;
}

/** seat 1 plays a card that suspends on a decision of their own */
const ASKS = 'Floral Singularity';
function seat1Asks(room: Room): void {
  for (const kind of ['wood', 'wood', 'metal'] as const) {
    room.state.players[1]!.resources.push({ kind, state: 'open' });
  }
  room.state.players[1]!.hand.push(ASKS);
  actOn(room, { type: 'playCard', seat: 1, handIndex: room.state.players[1]!.hand.length - 1 });
}

const types = (as: readonly Action[]): string[] => [...new Set(as.map(a => a.type))].sort();

// ══ 0. THE DIAGNOSIS — what actually blocks ═══════════════════════════
//
// Not a modal, not an animation await, not a disabled input keyed on
// `state.resolving`. The rules layer, by name.
{
  console.log('\n[§0 the blocking mechanism, stated]');
  const room = inDeployment('CNC0');
  ok(room.state.phase === 'deploy' && room.segKey === 'deploy',
    'both seats are inside the hidden simultaneous deployment segment');
  ok(legalActions(room.state, 0).some(a => a.type === 'doneDeploying'),
    'and with nothing pending, seat 0 has deployment options');

  seat1Asks(room);
  ok(room.state.decision?.seat === 1, `${ASKS} suspended on a decision belonging to seat 1`);

  ok(legalActions(room.state, 0).length === 0,
    'THE BUG, half one: the engine hands seat 0 an EMPTY legal list — apply.ts legalActions '
    + 'opens `if (s.decision) return legalDecisionActions(...)`, which returns [] for the '
    + 'seat that does not own it. The client\'s "Waiting for…" bar is drawn off exactly this.');

  let refused = '';
  try { apply(room.state, { type: 'doneDeploying', seat: 0 }); } catch (err) {
    if (err instanceof IllegalAction) refused = err.message;
  }
  ok(/decision is pending/.test(refused),
    `THE BUG, half two: and it refuses the action too — "${refused}" (apply.ts's global gate). `
    + 'So the UI cannot be un-gated on its own.');
}

// ══ 1. THE DEPLOY-INPUT GATE (test 4) ═════════════════════════════════
{
  console.log('\n[§1 the opponent owns a decision — my deploy input stays open]');
  const room = inDeployment('CNC1');
  const before = legalForSeat(room.state, 0, room.segKey);
  seat1Asks(room);
  ok(room.state.decision?.seat === 1, 'the pending decision is the OPPONENT\'s');

  const after = legalForSeat(room.state, 0, room.segKey);
  ok(after.length > 0,
    'seat 0 is still offered actions while seat 1 is mid-question — the whole of #98');
  ok(after.some(a => a.type === 'doneDeploying'),
    'including finishing their own deployment');
  ok(types(after).join() === types(before).join(),
    'and it is the SAME set of action kinds they had a moment earlier: the opponent\'s '
    + 'question changed nothing about what seat 0 may do');
}

// ══ 2. NEGATIVE CONTROLS (test 5) ═════════════════════════════════════
//
// The un-gating is narrow on purpose. Widen it by accident and these fail.
{
  console.log('\n[§2 when the block is right, it is still there]');
  const room = inDeployment('CNC2');
  seat1Asks(room);

  const mine = legalForSeat(room.state, 1, room.segKey);
  ok(mine.every(a => a.type === 'decide'),
    'the seat whose decision it IS is offered nothing but answers — their own question '
    + 'still gates their own input, exactly as before');
  ok(JSON.stringify(mine) === JSON.stringify(legalActions(room.state, 1)),
    'byte-for-byte what the engine would have offered them');

  ok(arrivalVerdict(room.state, { type: 'doneDeploying', seat: 1 }, room.segKey, 0) === 'refuse',
    'and an action from that seat is NOT parked — it is left to the engine\'s refusal');

  ok(JSON.stringify(legalForSeat(room.state, 0, null))
    === JSON.stringify(legalActions(room.state, 0)),
    'OUTSIDE a hidden segment (segKey null = battle) legalForSeat is legalActions exactly — '
    + 'battle priority is sequential and an opponent mid-resolution really does hold the game');
  ok(arrivalVerdict(room.state, { type: 'passPriority', seat: 0 }, null, 0) === 'refuse',
    'so nothing is deferred in battle either');

  const clean = inDeployment('CNC2B');
  ok(arrivalVerdict(clean.state, { type: 'doneDeploying', seat: 0 }, clean.segKey, 0) === 'apply',
    'and with no decision open at all, an action is simply applied');
}

// ══ 3. THE DEFERRAL ROUND TRIP ════════════════════════════════════════
//
// Offering the action is only half a fix: the engine would still refuse it.
// It is PARKED, and lands the moment the opponent's question closes.
{
  console.log('\n[§3 what I send while they are asked: parked, then landed]');
  const room = inDeployment('CNC3');
  seat1Asks(room);
  const nActions = room.actions.length;

  const mine: Action = { type: 'doneDeploying', seat: 0 };
  ok(arrivalVerdict(room.state, mine, room.segKey, 0) === 'defer',
    'seat 0\'s deploy action is DEFERRED, not refused');
  deferAction(room, mine);
  ok(room.actions.length === nActions,
    'nothing has been applied yet — and nothing has entered the action log, so a saved '
    + 'game is still exactly the game that was played');
  ok(takeDeferred(room).length === 0,
    'and it does not drain while the decision is still open (it would just hit the gate)');
  ok(room.deferred[0]!.length === 1, 'it is still parked');

  // seat 1 answers their own question
  actOn(room, { type: 'decide', seat: 1, choice: 0 });
  ok(room.state.decision === null || room.state.decision.seat === 1,
    'the payOrDecline chain is seat 1\'s alone');

  ok(room.state.decision === null, "seat 1's decision chain closed on one answer");
  const freed = takeDeferred(room);
  ok(freed.length === 1 && freed[0]?.type === 'doneDeploying',
    'with the decision closed, the parked action is released');
  if (freed[0]) actOn(room, freed[0]);
  ok(room.state.deployDone?.[0] === true || room.state.phase !== 'deploy',
    'and it LANDS — seat 0 is done deploying, having clicked while seat 1 was mid-trigger');
  ok(room.deferred[0]!.length === 0 && room.deferred[1]!.length === 0,
    'the queues are empty again');
}

// ══ 4. THE QUEUE IS BOUNDED, AND NEVER SWALLOWS THE TWO ESCAPES ═══════
{
  console.log('\n[§4 bounds and escapes]');
  const room = inDeployment('CNC4');
  seat1Asks(room);
  const mine: Action = { type: 'doneDeploying', seat: 0 };
  ok(arrivalVerdict(room.state, mine, room.segKey, MAX_DEFERRED - 1) === 'defer',
    `up to ${MAX_DEFERRED} parked actions per seat`);
  ok(arrivalVerdict(room.state, mine, room.segKey, MAX_DEFERRED) === 'refuse',
    'past the cap it is refused rather than queued — a human sends a handful, a firehose '
    + 'is a client fault');

  ok(arrivalVerdict(room.state, { type: 'decide', seat: 1, choice: 0 }, room.segKey, 0) === 'apply',
    'a decide is NEVER parked: it is the very thing that closes the decision');
  ok(arrivalVerdict(room.state, { type: 'concede', seat: 0 }, room.segKey, 0) === 'apply',
    'and a concede is never parked either (R65: it must always be reachable)');
}

// ══ 5. NOTHING LEAKS (test 6) ═════════════════════════════════════════
//
// The freeze exists so that a hidden simultaneous segment tells you nothing
// about what your opponent is doing. Un-gating seat 0's INPUT must not un-gate
// their INFORMATION.
{
  console.log('\n[§5 the privacy properties are untouched]');
  const room = inDeployment('CNC5');
  // seat 0's published options BEFORE the opponent has done anything at all
  const blind = legalForSeat(room.state, 0, room.segKey);
  seat1Asks(room);

  ok(room.state.decision?.seat === 1, 'seat 1 is mid-question in the authoritative state');
  ok(viewFor(room.state, 0, room.segSnapshot).decision === null,
    "viewFor still nulls a decision that is not yours — seat 0 cannot see the question");
  ok(viewFor(room.state, 0, room.segSnapshot).suspension === null,
    'nor the suspension carrying its private options');

  ok(!Object.values(viewFor(room.state, 0, room.segSnapshot).entities).some(e => e.controller === 1)
    || Object.values(room.state.entities).every(e => e.controller !== 1),
    "and seat 0's view of the opponent's board is still served from the segment freeze");

  // THE SHARP ONE: seat 0's published list must not depend on whether seat 1
  // has a question open, or the un-gating would itself be the leak.
  const seeing = legalForSeat(room.state, 0, room.segKey);
  ok(JSON.stringify(seeing) === JSON.stringify(blind),
    'seat 0\'s legal list is IDENTICAL to the one they had before seat 1 played anything — '
    + 'so nothing about the opponent\'s question is inferable from it');
}

// ══ 6. `s.resolving` IS STILL A BATTLE-PHASE PUBLICATION ══════════════
//
// R78's `E.beginResolving` sets `s.resolving` only in the battle phase, and
// `viewFor` does NOT redact the field — the two together are what stops a
// hidden simultaneous segment from announcing "I am mid-something". R150 makes
// the OTHER seat's screen live during exactly that window, so this property is
// now load-bearing in a way it was not before, and gets its own guard.
//
// Reaching it needs a resolution that stops HALFWAY (a suspension throws past
// `endResolving`, so the marker survives it). No printed deployment card does
// that today, so this uses the same synthetic shape test-view-snapshot.ts
// already registers for R85 — a deploy spell that does something and then asks.
registerSynthetic({
  name: 'R150 Halt', cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 1 life, then ask.',
}, {
  spellEffect: {
    run: (g, ctx) => {
      g.gainLife(ctx.controller, 1, 'R150 Halt');
      ctx.choose('halt', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: 'R150 Halt: carry on?', options: [{ label: 'yes', value: 0 }],
      });
    },
  },
});
{
  console.log('\n[§6 a deployment resolution does not announce itself]');
  const room = inDeployment('CNC6');
  room.state.players[1]!.hand.push('R150 Halt');
  actOn(room, { type: 'playCard', seat: 1, handIndex: room.state.players[1]!.hand.length - 1 });

  ok(room.state.suspension?.type === 'resolve' && room.state.decision?.seat === 1,
    'seat 1 really is suspended MID-RESOLUTION inside the deployment segment');
  ok(room.state.resolving === null,
    'THE PROPERTY: `s.resolving` is not published outside battle. viewFor does not redact '
    + 'this field, so the engine gate is the only thing between a hidden segment and "your '
    + 'opponent is mid-something". ⚠ It is THREE gates, not one — E.beginResolving, '
    + "resolveParts' PartChoice catch, and E.suspend — and it is the LAST of those that "
    + 'this scenario exercises: beginResolving alone can be removed and this still passes.');
  ok(viewFor(room.state, 0, room.segSnapshot).resolving === null,
    'and so seat 0\'s view carries nothing about it either');

  // …and R150's own un-gating must not become the leak the gate prevents
  ok(legalForSeat(room.state, 0, room.segKey).some(a => a.type === 'doneDeploying'),
    'while seat 0 goes on deploying, none the wiser');
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
for (const c of codes) rmSync(gameFile(c), { force: true });
process.exit(failures ? 1 : 0);
