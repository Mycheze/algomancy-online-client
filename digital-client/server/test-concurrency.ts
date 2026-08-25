/* R150+R154 / CT-32+CT-44 — ONE SEAT'S TRIGGERS MUST NOT FREEZE THE OTHER
 * SEAT'S DEPLOYMENT. (run: node test-concurrency.ts — no sockets, no port.)
 *
 * Playtest #98 (SMVJ, action 238): *"Rashi's start of combat (doing all her
 * Wraith triggers) doesn't need to take away from what I'm doing in
 * Deployment."*
 *
 * ⚠ THE MECHANISM IS NOT THE PRESENTATION LAYER — not a modal, not an
 * animation await, not a disabled input keyed on `state.resolving`. It is the
 * rules layer, and §0 below states it by name before anything else runs.
 *
 * HISTORY, because the two halves of this fix are a year apart in reasoning
 * and the second one corrects the first:
 *
 *  R150 (CT-32) put BOTH halves in the server, on the belief that the engine
 *  had to stay a single pure reducer with a global decision gate:
 *      legalForSeat    what a seat is OFFERED   (a shadow with decision nulled)
 *      arrivalVerdict  what happens to what they SEND (parked, not refused)
 *  It worked over the wire and left hotseat — and the `Harness` the whole
 *  engine suite is written on — frozen exactly as before, because they call
 *  `apply()` directly. That is CARD-TODO #44.
 *
 *  R154 moved the RULE into the engine (`decisionBlocks` in apply.ts) and left
 *  the server holding only what a rule cannot do: a QUEUE. §0 and §3 are the
 *  two halves of that split, and §3's scenario had to change — the case the
 *  queue still exists for is not the one R150 wrote it around.
 *
 * Everything asserted here is a pure function or a room driven in-process, so
 * none of it needs a whole game played over a socket to reach — which is this
 * repo's own documented root cause for the bug the owner had to report twice.
 *
 * Two real scenarios, and the difference between them is the whole point:
 *   ASKS  seat 1 plays Floral Singularity — a cast-time 'cast' suspension,
 *         structurally what R144's start-of-deployment Wraith pile creates
 *         (verified: that pile raises a 'cast'/electricPath suspension too).
 *         NOTHING is rewound when it is answered, so R154 lets the other seat
 *         act straight through it.
 *   HALTS seat 1 plays 'R154 Halt' — a resolution that stops HALFWAY, i.e. a
 *         'resolve' suspension carrying an R85 `snapshot` of the whole
 *         GameState. Answering it does `this.s = snapshot`, so anything the
 *         OTHER seat landed meanwhile is erased. That one is still gated, and
 *         is the reason the deferral queue is not redundant.
 */
import { rmSync } from 'node:fs';
import type { Action } from '../engine/src/types.ts';
import {
  apply, decisionBlocks, forcedAction, legalActions, IllegalAction,
} from '../engine/src/apply.ts';
import { registerSynthetic } from '../engine/src/cards/dsl.ts';
import { viewFor } from './view.ts';
import { gameFile } from './test-util.ts';
import {
  applyToRoom, arrivalVerdict, createRoom, deferAction, deferrableRefusal, legalForSeat,
  MAX_DEFERRED, openSegment, segmentKey, takeDeferred, type Room,
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

/** seat 1 plays a card that suspends on a CAST-TIME decision of their own —
 * nothing has resolved, so nothing is rewound when they answer */
const ASKS = 'Floral Singularity';
function seat1Asks(room: Room): void {
  for (const kind of ['wood', 'wood', 'metal'] as const) {
    room.state.players[1]!.resources.push({ kind, state: 'open' });
  }
  room.state.players[1]!.hand.push(ASKS);
  actOn(room, { type: 'playCard', seat: 1, handIndex: room.state.players[1]!.hand.length - 1 });
}

/* A deployment resolution that stops HALFWAY — the shape R154 still gates.
 * A suspension throws past `endResolving`, so the marker survives it; no
 * printed deployment card does that today, so this is the same synthetic
 * test-view-snapshot.ts already registers for R85: a deploy spell that does
 * something and THEN asks. Registered at module scope so §3, §4 and §6 all
 * reach it. */
const HALTS = 'R154 Halt';
registerSynthetic({
  name: HALTS, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 1 life, then ask.',
}, {
  spellEffect: {
    run: (g, ctx) => {
      g.gainLife(ctx.controller, 1, HALTS);
      ctx.choose('halt', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: `${HALTS}: carry on?`, options: [{ label: 'yes', value: 0 }],
      });
    },
  },
});
function seat1Halts(room: Room): void {
  room.state.players[1]!.hand.push(HALTS);
  actOn(room, { type: 'playCard', seat: 1, handIndex: room.state.players[1]!.hand.length - 1 });
}

const types = (as: readonly Action[]): string[] => [...new Set(as.map(a => a.type))].sort();

// ══ 0. THE DIAGNOSIS, AND THE INVARIANT THAT REPLACED IT ══════════════
//
// R150 asserted the two engine lines that blocked, BY NAME, so the diagnosis
// was recorded as a live test rather than a comment. R154 fixed those very
// lines, so what is recorded here now is the pair of properties they were
// replaced BY — same two places, same names, opposite verdicts. Deleting the
// section would have thrown away the only executable record of what the bug
// actually was.
//
//   apply.ts legalActions()  opened `if (s.decision) return
//                            legalDecisionActions(e, seat)`, and
//                            legalDecisionActions returns [] when the decision
//                            is not yours. THE EMPTY LIST the client's
//                            "Waiting for X…" bar was drawn from.
//   apply.ts dispatch()      opened `if (e.s.decision && type !== 'decide' &&
//                            type !== 'concede') e.illegal(...)`. THE REFUSAL
//                            that made un-gating the UI alone useless.
//
// Both now route through `decisionBlocks`, which asks WHOSE question it is and
// WHERE the game is standing.
{
  console.log('\n[§0 the two engine lines that used to block, restated]');
  const room = inDeployment('CNC0');
  ok(room.state.phase === 'deploy' && room.segKey === 'deploy',
    'both seats are inside the hidden simultaneous deployment segment');
  const before = legalActions(room.state, 0);
  ok(before.some(a => a.type === 'doneDeploying'),
    'and with nothing pending, seat 0 has deployment options');

  seat1Asks(room);
  ok(room.state.decision?.seat === 1, `${ASKS} suspended on a decision belonging to seat 1`);
  ok(room.state.suspension?.type === 'cast',
    'a CAST-time suspension: nothing has resolved, so answering it rewinds nothing');

  ok(!decisionBlocks(room.state, 0),
    'THE RULE: seat 1\'s question does not block seat 0 — not their question, and the game '
    + 'is standing inside a hidden simultaneous segment where by construction both seats act '
    + 'at once and neither can see the other');
  ok(decisionBlocks(room.state, 1),
    '…while it does still block seat 1, whose question it is');

  ok(types(legalActions(room.state, 0)).join() === types(before).join(),
    'FIX, half one: legalActions itself now hands seat 0 the same kinds of action it did a '
    + 'moment earlier, with no help from the server. This is the line the empty list came from.');

  let refused = '';
  try { apply(room.state, { type: 'doneDeploying', seat: 0 }); } catch (err) {
    if (err instanceof IllegalAction) refused = err.message;
  }
  ok(refused === '',
    `FIX, half two: and dispatch() accepts it${refused ? ` — but it said "${refused}"` : ''}. `
    + 'Offering an action the reducer then refuses is the exact half-fix R150 warned about, '
    + 'so the two must be asserted together, here, in this order.');

  // …and the OTHER two places the same two lines still say what they always did
  ok(decisionBlocks({ ...room.state, phase: 'battle' }, 0),
    'NEGATIVE, place one: move the same state into battle and the block is back. Priority '
    + 'there is sequential and an opponent mid-resolution really does hold the game.');
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

// ══ 3. WHAT THE QUEUE IS STILL FOR ════════════════════════════════════
//
// ⚠ CT-44's own fix text said: *"Then the server's compensation becomes
// redundant and should be deleted in the same change."* IT IS NOT, and this
// section is why — the mechanism is neither a lock nor a race but R85's
// rollback.
//
// A 'resolve' suspension carries `snapshot: GameState`, taken at the effect
// PART BOUNDARY, and `E.resumeResolve` does `this.s = snapshot`, carrying
// forward only actionCount, decisionHigh and the seat names. So an action the
// OTHER seat lands between the question and the answer is not merely
// reordered — it is UNDONE, silently, after they have already seen it happen.
// A freeze traded for lost state is the worse trade, so the engine keeps
// refusing here, and the queue is what turns that refusal into a delay.
//
// R150's original §3 drove this with a CAST suspension, which R154 now lets
// through outright; the scenario had to move to the shape that still needs it.
{
  console.log('\n[§3 the one case the engine still refuses — parked, then landed]');
  const room = inDeployment('CNC3');
  const life0 = room.state.players[0]!.life;
  seat1Halts(room);
  ok(room.state.suspension?.type === 'resolve'
    && !!(room.state.suspension as { snapshot?: unknown }).snapshot,
    'seat 1 is suspended MID-RESOLUTION, on a suspension carrying a whole-GameState snapshot');
  ok(decisionBlocks(room.state, 0),
    'THE VERDICT: the engine still blocks seat 0 here — R85 would rewind anything they did');
  const nActions = room.actions.length;

  const mine: Action = { type: 'doneDeploying', seat: 0 };
  ok(arrivalVerdict(room.state, mine, room.segKey, 0) === 'defer',
    'so seat 0\'s deploy action is DEFERRED, not refused');
  ok(legalForSeat(room.state, 0, room.segKey).some(a => a.type === 'doneDeploying'),
    '…and OFFERED all the same: the server may promise what the engine will not do yet, '
    + 'because it has a queue to make the promise good');
  deferAction(room, mine);
  ok(room.actions.length === nActions,
    'nothing has been applied yet — and nothing has entered the action log, so a saved '
    + 'game is still exactly the game that was played');
  ok(takeDeferred(room).length === 0,
    'and it does not drain while the decision is still open (it would just hit the gate)');
  ok(room.deferred[0]!.length === 1, 'it is still parked');

  // seat 1 answers their own question — and the rollback happens right here
  actOn(room, { type: 'decide', seat: 1, choice: 0 });
  ok(room.state.decision === null, "seat 1's resolution finished on one answer");
  ok(room.state.players[0]!.life === life0,
    'seat 0 is untouched by the rewind (they were kept out of the window, which is the point)');
  const freed = takeDeferred(room);
  ok(freed.length === 1 && freed[0]?.type === 'doneDeploying',
    'with the decision closed, the parked action is released');
  if (freed[0]) actOn(room, freed[0]);
  ok(room.state.deployDone?.[0] === true || room.state.phase !== 'deploy',
    'and it LANDS — seat 0 is done deploying, having clicked while seat 1 was mid-resolution');
  ok(room.deferred[0]!.length === 0 && room.deferred[1]!.length === 0,
    'the queues are empty again');
}

// ══ 3b. …AND WHAT IT IS NO LONGER FOR ═════════════════════════════════
//
// The narrowing is the user-visible half of R154: against a twelve-trigger
// pile, R150 had the other player's every click queue up and land in a burst
// thirty seconds later, which is still #98's complaint one layer along.
{
  console.log('\n[§3b the cast-time case no longer waits at all]');
  const room = inDeployment('CNC3B');
  seat1Asks(room);
  const mine: Action = { type: 'doneDeploying', seat: 0 };
  ok(arrivalVerdict(room.state, mine, room.segKey, 0) === 'apply',
    'nothing is parked when the engine will take it: applied on arrival, not on the answer');
  const n = room.actions.length;
  actOn(room, mine);
  ok(room.actions.length > n && room.state.deployDone?.[0] === true,
    'it is in the log and it landed, while seat 1 is still being asked');
  ok(room.state.decision?.seat === 1 && room.state.suspension?.type === 'cast',
    'and seat 1\'s question is exactly where it was — untouched, not re-raised, not lost');
}

// ══ 4. THE QUEUE IS BOUNDED, AND NEVER SWALLOWS THE TWO ESCAPES ═══════
{
  console.log('\n[§4 bounds and escapes]');
  const room = inDeployment('CNC4');
  seat1Halts(room);
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

// ══ 4b. THE SECOND DOOR ONTO THE QUEUE ════════════════════════════════
//
// Whether an action raises a decision of its own cannot be known before it
// runs, so `arrivalVerdict` cannot forecast the clobber case and must not try.
// The engine discovers it on the way out, discards the draft whole, and flags
// the refusal; `deferrableRefusal` routes it into the same queue.
{
  console.log('\n[§4b a refusal the engine could only discover after the fact]');
  const room = inDeployment('CNC4B');
  seat1Asks(room);
  // seat 0 plays a card that will raise a decision of ITS own — the clobber
  room.state.players[0]!.hand.push(HALTS);
  const mine: Action = {
    type: 'playCard', seat: 0, handIndex: room.state.players[0]!.hand.length - 1,
  };
  ok(arrivalVerdict(room.state, mine, room.segKey, 0) === 'apply',
    'the verdict on arrival is "apply" — nothing here can tell that it will suspend');
  let caught: unknown;
  try { applyToRoom(room, mine); } catch (err) { caught = err; }
  ok(caught instanceof IllegalAction && (caught as IllegalAction).disturbs === true,
    'but the engine refuses it, flagged as a disturbance rather than a player error');
  ok(room.state.decision?.seat === 1 && room.state.suspension?.type === 'cast',
    "THE CLOBBER, NOT HAPPENING: seat 1's decision is still the open one — the draft that "
    + "overwrote it was thrown away, not returned");
  ok(deferrableRefusal(room, mine, caught),
    'and the room recognises it as parkable, so the player is told "waiting", not "illegal"');
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
// Reaching it needs a resolution that stops HALFWAY — the `HALTS` synthetic
// registered at the top of this file, which is also §3's scenario.
{
  console.log('\n[§6 a deployment resolution does not announce itself]');
  const room = inDeployment('CNC6');
  seat1Halts(room);

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
