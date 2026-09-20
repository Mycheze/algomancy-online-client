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
 * AND THEN THE FIRST FIX WAS STILL TOO NARROW. It stopped refusing "your
 * opponent acted" and started refusing "a later move names a unit this splice
 * would renumber", which is a smaller set but still not the right question.
 * The owner, 2026-08-23:
 *
 *   "I'm not sure what this means. In deployment and planning, you're 'alone'
 *    in a world that no one else can see. So you should be perfectly allowed
 *    to undo everything, up to the beginning of that phase (unless there is
 *    anything that triggers at the beginning/end of those phases such as
 *    paying debt or 'at the beginning of deployment'), but you can back up
 *    choosing their targets / to the point when they're on the stack (if
 *    applicable). I don't understand your question otherwise."
 *
 * He is right, and the gate had been answering a question about NUMBERING
 * rather than about the game. `nextId` is one global clock, so splicing shifts
 * every id above it and the log — replayed verbatim — goes on naming numbers
 * that moved. That is our bookkeeping, and the player was being charged for
 * it. `undoActionAt` now REPAIRS the numbering and uses the reference-key
 * measurement as the PROOF that the repair was one.
 *
 * SO THIS FILE PINS THE TARGET BEHAVIOUR:
 *
 *   §1/§2  the reported shape, both ways round — you act, the opponent acts
 *          with a real payload, your action still comes back.
 *   §3     the case the first fix refused: the opponent deploys AND MODS,
 *          so the log names an id your splice moves. Now accepted, their
 *          position byte-identical, and the logged `hostId` renumbered.
 *   §4     the residue, and why a hidden segment cannot reach it.
 *   §4b    the WALK: undo repeatedly, all the way to the start of the
 *          segment, with the opponent acting throughout.
 *   §4c    the FLOOR: what the phase itself started is not yours to take back.
 *   §4d    a pending cast walks back like anything else.
 *   §5-§7  planning is the same segment; the measurement still catches a
 *          genuine conflict; the barrier still closes the window.
 *
 * IT DRIVES `undoForSeat` — the actual production decision, moved out of
 * main.ts's WebSocket handler for exactly this reason. A decision that only
 * exists inside a socket handler can only be reached by playing a whole game
 * over a socket, which is a test nobody writes; that is the history above.
 *
 * NOTE ON SETUP. Anything asserting an ACCEPTED undo plays a REAL game with
 * only legal actions and no state injection, because an undo is a rebuild from
 * `seed + actions` and an injected resource or card is in neither — a room set
 * up by hand cannot be rebuilt, so every undo in it would be refused for the
 * wrong reason (test-forensics.ts says the same about its own §4). Only §4,
 * which asserts a refusal decided before any rebuild runs, injects.
 */
import { rmSync } from 'node:fs';
import type { Action, ActivateVia, GameState, Seat } from '../../engine/src/types.ts';
import { apply, forcedAction, legalActions } from '../../engine/src/apply.ts';
import { gameFile } from './test-util.ts';
import {
  applyToRoom, createRoom, openSegment, renumberAction, segmentFloor, segmentKey, spliceable,
  undoActionAt, undoForSeat, type Room,
} from '../rooms.ts';

let failures = 0;
const ok = (cond: unknown, label: string): void => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
};
const codes: string[] = [];
const room$ = (code: string, seed: number): Room => { codes.push(code); return createRoom(code, seed); };

/**
 * R228: the haste step is ALWAYS offered, so `donePlanning` from both seats
 * lands in it rather than sailing past it. Nothing auto-closes it — an
 * automatic `doneHaste` would broadcast that the seat had no haste play, which
 * is the side channel R224 deleted — so a section that is about deployment
 * says so in both seats' names. Same shape as `engine/test/util.ts`'s
 * `skipHasteStep`.
 */
function passHaste(room: Room): void {
  for (const seat of [0, 1] as Seat[]) {
    if (room.state.hasteDone && !room.state.hasteDone[seat]) actOn(room, { type: 'doneHaste', seat });
  }
}

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

/** every entity id an action names — a test-local mirror of rooms.ts's own
 * `entityRefs`, kept here so the sweep below reads the payload rather than
 * trusting the module it is checking. */
function entityIdsOf(a: Action): number[] {
  switch (a.type) {
    case 'castSpellToken': return [a.entityId];
    // R181: only a `{ mod }` via names an id. `{ face }` (R63's granted-face
    // channel) is also an object and has no `.mod`; the old `typeof === 'object'`
    // test read `undefined` out of one and reported it as a referenced id.
    case 'activateAbility':
      return typeof a.via === 'object' && a.via !== null && 'mod' in a.via
        ? [a.entityId, a.via.mod] : [a.entityId];
    case 'augment': return a.hostId === undefined ? [] : [a.hostId];
    case 'graft': return [a.hostId];
    case 'declareAttack': return [...a.columns.flat(), ...(a.spellTokens ?? [])];
    case 'declareBlocks':
      return [...Object.values(a.blocks).flat(), ...(a.send ?? []), ...(a.spellTokens ?? [])];
    default: return [];
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

function walkToDeployment(room: Room, turns = 6): boolean {
  for (let turn = 0; turn < turns; turn++) {
    for (const s of [0, 1] as Seat[]) {
      const r = first(room, s, 'recycleForResource');
      if (r) actOn(room, r);
      for (let k = 0; k < 4; k++) {
        const v = first(room, s, 'activateResource');
        if (v) actOn(room, v);
      }
    }
    for (const s of [0, 1] as Seat[]) { const d = first(room, s, 'donePlanning'); if (d) actOn(room, d); }
    for (const s of [0, 1] as Seat[]) { const d = first(room, s, 'doneHaste'); if (d) actOn(room, d); }
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
      && cleanPlay(room, 0) && cleanPlay(room, 1)) return true;
    for (const s of [0, 1] as Seat[]) {
      const d = first(room, s, 'doneDeploying'); if (d) actOn(room, d);
    }
  }
  return false;
}

function deployingRoom(code: string): Room {
  for (const seed of SEEDS) {
    const room = room$(code, seed);
    try {
      if (walkToDeployment(room)) return room;
    } catch { /* this seed's game went somewhere unusable — try the next */ }
    rmSync(gameFile(code), { force: true });
  }
  throw new Error('no seed reached a deployment both seats can play into');
}

/** the seeds whose deployment lets seat 1 deploy AND THEN MOD what they
 * deployed — the sequence the first fix refused (see §3) */
const MOD_SEEDS = [400027, 400015, 400020];

/**
 * A REAL deployment in which seat 0 has played, seat 1 has played, and seat 1
 * has modded their own new unit — so the log carries a `hostId` naming an
 * entity that splicing seat 0's play renumbers. No injection: this has to be
 * a log that rebuilds, because the whole question is what the rebuild does.
 */
function deployPlayModRoom(code: string): { room: Room; myPlay: number; augAt: number } {
  for (const seed of MOD_SEEDS) {
    const room = room$(code, seed);
    try {
      for (let turn = 0; turn < 9; turn++) {
        for (const s of [0, 1] as Seat[]) {
          const r = first(room, s, 'recycleForResource');
          if (r) actOn(room, r);
          for (let k = 0; k < 4; k++) {
            const v = first(room, s, 'activateResource');
            if (v) actOn(room, v);
          }
        }
        for (const s of [0, 1] as Seat[]) { const d = first(room, s, 'donePlanning'); if (d) actOn(room, d); }
        for (const s of [0, 1] as Seat[]) { const d = first(room, s, 'doneHaste'); if (d) actOn(room, d); }
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
        if (room.state.phase === 'deploy' && !room.state.decision) {
          const p0 = cleanPlay(room, 0);
          if (p0) {
            actOn(room, p0); drain(room);
            const myPlay = room.actions.length - 1;
            const p1 = cleanPlay(room, 1);
            if (p1) {
              actOn(room, p1); drain(room);
              const aug = legalActions(room.state, 1).find(a => a.type === 'augment'
                && a.hostId !== undefined && room.state.entities[a.hostId]?.controller === 1);
              if (aug) {
                actOn(room, aug); drain(room);
                return { room, myPlay, augAt: room.actions.length - 1 };
              }
            }
            break;                      // this seed got there and could not mod
          }
        }
        for (const s of [0, 1] as Seat[]) { const d = first(room, s, 'doneDeploying'); if (d) actOn(room, d); }
      }
    } catch { /* try the next seed */ }
    rmSync(gameFile(code), { force: true });
  }
  throw new Error('no seed reached a deployment where seat 1 could deploy and then mod');
}

/**
 * A REAL deployment in which one seat has just played a card that SUSPENDED on
 * a choice — the "you can back up choosing their targets" case. Returns the
 * position that play should unwind to, or null if no seed reached one.
 */
function suspendingDeployRoom(code: string):
{ room: Room; seat: Seat; before: string; oppBefore: string } | null {
  for (const seed of SEEDS) {
    const room = room$(code, seed);
    try {
      const built = walkToDeployment(room);
      if (built) {
        for (const seat of [0, 1] as Seat[]) {
          const play = legalActions(room.state, seat).find(a => {
            if (a.type !== 'playCard') return false;
            try { return !!apply(room.state, a).state.decision; } catch { return false; }
          });
          if (!play) continue;
          const before = positionOf(room.state, seat);
          const oppBefore = positionOf(room.state, (1 - seat) as Seat);
          actOn(room, play);
          if (room.state.decision) return { room, seat, before, oppBefore };
          return null;
        }
      }
    } catch { /* try the next seed */ }
    rmSync(gameFile(code), { force: true });
  }
  return null;
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

// ══ 3. THE CASE THAT USED TO BE REFUSED, AND IS NOW ACCEPTED ══════════
//
// THE OWNER, 2026-08-23, on the first fix still refusing a narrow case:
//
//   "In deployment and planning, you're 'alone' in a world that no one else
//    can see. So you should be perfectly allowed to undo everything, up to
//    the beginning of that phase."
//
// The narrow case was this one: seat 1 deploys a unit and mods it, so the log
// carries `hostId: <an id above seat 0's floor>`. Splicing seat 0's play
// shifts every id above it down, and the log replays VERBATIM — so the mod
// went on naming a unit number that no longer existed and the undo died on
// "no such unit". That was never a fact about the game; it was a fact about
// our numbering. `undoActionAt` now renumbers the surviving log and PROVES
// the renumbering was right by re-measuring every reference key.
//
// A real game, not an injected board: the whole question is what the rebuild
// does, so the log has to be one that rebuilds.
{
  const { room, myPlay, augAt } = deployPlayModRoom('UND3');
  console.log('\n[the case that used to be refused — a mod naming a renumbered unit]');
  const aug = room.actions[augAt] as Extract<Action, { type: 'augment' }>;
  ok(aug.type === 'augment' && aug.seat === 1, 'seat 1 deployed a unit and modded it');
  const namedId = aug.hostId!;
  const lo = room.segIdFloor[myPlay]!;
  ok(namedId >= lo,
    `the mod names entity ${namedId}, which sits above seat 0's floor ${lo} — the splice moves it`);
  ok(spliceable(room, myPlay, 0),
    'and that is no longer a refusal: a renumbering is bookkeeping, not a conflict');

  const theirPositionWas = positionOf(room.state, 1);
  const out = undoForSeat(room, 0);
  ok(out.ok, `seat 0's play comes back out (${out.ok ? 'accepted' : out.why})`);
  ok(positionOf(room.state, 1) === theirPositionWas,
    "and seat 1's whole position — the modded unit included — is byte-identical");

  // the structural proof that a REPAIR happened rather than a coincidence:
  // the logged action now names the same unit under its new number
  const after = room.actions[augAt - 1] as Extract<Action, { type: 'augment' }>;
  ok(after && after.type === 'augment', 'the mod is still in the log, one slot earlier');
  ok(after.hostId !== namedId, `and its hostId was renumbered (${namedId} → ${after.hostId})`);
  const host = room.state.entities[after.hostId!];
  ok(!!host && host.controller === 1,
    'pointing at a unit that exists and is still seat 1\'s');
  ok(Object.values(room.state.entities).some(e => e.kind === 'mod' && e.controller === 1),
    'and the mod is still on the board');
}

// ══ 4. THE RESIDUE — and why a hidden segment cannot reach it ═════════
//
// One thing a renumbering cannot repair: an action naming an entity the
// SPLICED action created. Those ids do not move, they cease to exist, and
// there is no number to rewrite them to. Un-playing the unit a later move is
// about means dropping that move, and we refuse instead.
//
// It is asserted here at the primitive (`undoActionAt`'s own gate), because
// inside a hidden segment IT CANNOT HAPPEN — the second half of this block
// shows the engine itself making it unreachable.
{
  const room = room$('UND4', 717171);
  console.log('\n[the residue: a later move about the very unit being un-played]');
  actOn(room, { type: 'donePlanning', seat: 0 });
  actOn(room, { type: 'donePlanning', seat: 1 });
  passHaste(room);                      // R228 — this section is about DEPLOYMENT
  for (const s of [0, 1] as Seat[]) {
    for (let i = 0; i < 4; i++) room.state.players[s]!.resources.push({ kind: 'fire', state: 'open' });
  }
  room.state.players[0]!.hand.push('Ignis Sprite');
  actOn(room, { type: 'playCard', seat: 0, handIndex: room.state.players[0]!.hand.length - 1 });
  const myPlay = room.actions.length - 1;
  const myUnit = Object.values(room.state.entities)
    .find(e => e.controller === 0 && e.kind === 'unit')!.id;
  room.state.players[0]!.hand.push('Animated Spark');
  actOn(room, { type: 'augment', seat: 0, from: 'hand',
    index: room.state.players[0]!.hand.length - 1, hostId: myUnit });
  ok(!spliceable(room, myPlay, 0),
    `entity ${myUnit} is what that play CREATED, so the later mod cannot be renumbered onto anything`);
  const before = JSON.stringify(room.actions);
  const refused = undoActionAt(room, myPlay);
  ok(refused.length > 0, 'and the splice is refused');
  ok(JSON.stringify(room.actions) === before, 'leaving the log exactly as it was');

  // …and the reason a PLAYER never meets this inside a hidden segment: the
  // only actions that can name someone else's unit are mods, and the engine
  // will not let a mod cross regions. A unit deployed behind the screen
  // stands in its own controller's region, so the opponent cannot name it —
  // which is the same fact as "you're alone in a world no one else can see".
  room.state.players[1]!.hand.push('Chitin Shredder');
  let refusedByEngine = '';
  try {
    actOn(room, { type: 'augment', seat: 1, from: 'hand',
      index: room.state.players[1]!.hand.length - 1, hostId: myUnit });
  } catch (err) { refusedByEngine = err instanceof Error ? err.message : String(err); }
  ok(refusedByEngine !== '',
    `the opponent cannot even name a unit deployed behind the screen (${refusedByEngine})`);
  ok(!legalActions(room.state, 1).some(a => entityIdsOf(a).includes(myUnit)),
    'and legalActions never offers seat 1 anything that names it');
}

// ══ 4b. THE WALK: all the way back to the start of the segment ════════
//
// *"You should be perfectly allowed to undo everything, up to the beginning of
// that phase."* Pressing undo repeatedly must get there, with the opponent
// acting throughout, and must stop exactly at the floor.
//
// Driven in the resource step, where a player really does stack up several
// small decisions in one segment — and where #37 said in so many words that
// planning should behave like deployment.
{
  const room = room$('UND8', 909090);
  console.log('\n[the full walk back to the start of the segment]');
  ok(room.segKey === 'plan' && segmentFloor(room) === room.segStartIndex,
    'the segment is open and its floor is its start (no start-of-phase trigger here)');
  const move = (s: Seat): Action | undefined =>
    legalActions(room.state, s).find(a => a.type === 'recycleForResource' || a.type === 'activateResource');
  let mine = 0;
  for (let k = 0; k < 4; k++) {
    const a0 = move(0); if (!a0) break;
    actOn(room, a0); mine++;
    const a1 = move(1); if (a1) actOn(room, a1);        // the opponent, all the way through
  }
  ok(mine >= 3, `seat 0 stacked up ${mine} decisions in one segment`);
  const theirs = room.actions.filter(a => a.seat === 1).length;
  ok(theirs >= 3, `and the opponent made ${theirs} of their own, interleaved`);

  const theirPositionWas = positionOf(room.state, 1);
  let steps = 0, disturbed = 0;
  for (;;) {
    const out = undoForSeat(room, 0);
    if (!out.ok) {
      ok(/nothing of yours this step|start of the phase/.test(out.why),
        `the walk ends by running out, not by being refused (${out.why})`);
      break;
    }
    steps++;
    if (positionOf(room.state, 1) !== theirPositionWas) disturbed++;
    if (steps > 30) break;                              // a walk that never ends is a bug
  }
  ok(steps === mine, `every one of seat 0's ${mine} actions came back out (${steps} undos)`);
  ok(disturbed === 0, "and the opponent's position was byte-identical after every single step");
  ok(room.actions.slice(segmentFloor(room)).filter(a => a.seat === 0).length === 0,
    'nothing of seat 0 is left in the segment');
  ok(room.actions.filter(a => a.seat === 1).length === theirs,
    'while every one of the opponent\'s actions is still in the log');
  ok(room.segKey === 'plan' && room.state.turn === 1,
    'and the walk stopped inside the phase — it never crossed the boundary');
}

// ══ 4b-ii. THE SAME WALK, IN DEPLOYMENT — the reported phase ═════════
//
// Deployment is where the report was filed, so the walk is driven there too:
// seat 0 plays, seat 1 plays, seat 0 presses done, seat 1 plays again. Then
// seat 0 walks their whole step back — the done-flag and the play — with the
// opponent's position byte-identical at every step.
{
  const room = deployingRoom('UNDB');
  console.log('\n[the same walk, in deployment]');
  ok(room.segKey === 'deploy', 'a real deployment segment');
  const floor = segmentFloor(room);

  actOn(room, cleanPlay(room, 0)!); drain(room);
  const p1a = cleanPlay(room, 1); if (p1a) { actOn(room, p1a); drain(room); }
  actOn(room, { type: 'doneDeploying', seat: 0 });
  const p1b = cleanPlay(room, 1); if (p1b) { actOn(room, p1b); drain(room); }

  const mine = room.actions.slice(floor).filter(a => a.seat === 0).length;
  const theirs = room.actions.slice(floor).filter(a => a.seat === 1).length;
  ok(mine >= 2, `seat 0 has ${mine} actions in the deployment segment`);
  ok(theirs >= 1, `and the opponent acted ${theirs} time(s) among them`);
  ok(room.state.deployDone?.[0] === true, 'seat 0 has pressed done');

  const theirPositionWas = positionOf(room.state, 1);
  let steps = 0, disturbed = 0;
  for (;;) {
    const out = undoForSeat(room, 0);
    if (!out.ok) {
      ok(/nothing of yours this step|start of the phase/.test(out.why),
        `the walk ends by running out, not by being refused (${out.why})`);
      break;
    }
    steps++;
    if (positionOf(room.state, 1) !== theirPositionWas) disturbed++;
    if (steps > 30) break;
  }
  ok(steps === mine, `all ${mine} of seat 0's deployment actions came back out`);
  ok(disturbed === 0, "and the opponent's position never moved");
  ok(!room.state.deployDone?.[0], 'the done-flag came off with them');
  ok(room.actions.slice(segmentFloor(room)).filter(a => a.seat === 0).length === 0,
    'nothing of seat 0 is left in the deployment');
  ok(room.actions.slice(floor).filter(a => a.seat === 1).length === theirs,
    "while every one of the opponent's hidden moves is still in the log");
  ok(room.segKey === 'deploy', 'and the walk never crossed out of deployment');
}

// ══ 4c. THE FLOOR: a start-of-phase trigger is not yours to take back ═
//
// *"…up to the beginning of that phase (unless there is anything that triggers
// at the beginning/end of those phases such as paying debt or 'at the
// beginning of deployment')."*
//
// Most of that machinery never reaches the log — debt is paid inside the
// barrier that ends the resource step, rot damage inside the one that opens
// deployment — so it is already below `segStartIndex`. The exception is a
// start-of-phase trigger that ASKS something: the segment opens with the
// suspension standing and the `decide` answering it lands at `segStartIndex`.
// `segmentFloor` is what lifts the floor over it.
//
// Asserted as the pure derivation it is: the cards that trigger this way
// (Scholar of the Void, Prediction Prophet) are rare enough that no seed sweep
// reaches one, and the rule is about the SHAPE of the log, not about a card.
{
  const room = room$('UND9', 424242);
  console.log('\n[the floor sits above whatever the phase itself started]');
  actOn(room, { type: 'donePlanning', seat: 0 });
  actOn(room, { type: 'donePlanning', seat: 1 });
  ok(room.segKey === 'haste', 'R228: the haste segment comes first, unconditionally');
  passHaste(room);
  ok(room.segKey === 'deploy', 'a deployment segment');
  const start = room.segStartIndex;
  ok(!room.segSnapshot?.decision, 'this one opened with nothing pending…');
  ok(segmentFloor(room) === start, '…so its floor is simply its start');

  // now the shape a start-of-deployment "you may…" leaves behind: the segment
  // opens mid-suspension, and the answer to it is the log's first entry
  room.segSnapshot!.decision = {
    id: 1, seat: 0, kind: 'payOrDecline', prompt: 'At the start of deployment, you may…', options: [],
  };
  room.actions.push({ type: 'decide', seat: 0, choice: 0 });
  room.actions.push({ type: 'decide', seat: 0, choice: 0 });
  ok(segmentFloor(room) === start + 2,
    'the leading run of answers to it is below the floor — the phase started, not the player');
  room.actions.push({ type: 'doneDeploying', seat: 0 });
  room.actions.push({ type: 'decide', seat: 0, choice: 0 });
  ok(segmentFloor(room) === start + 2,
    'and the run ends at the first action that is not one of them — a later decide is the player\'s own');
  const out = undoForSeat(room, 0);
  ok(!out.ok || room.actions.length > start + 2, 'the walk can never reach below that floor');
}

// ══ 4d. A PENDING CAST: back out of the targeting, and out of the play ═
//
// The owner's parenthetical is a requirement of its own: *"…but you can back
// up choosing their targets / to the point when they're on the stack (if
// applicable)."*
//
// Outside a segment that is the `castChain` branch of `undoForSeat`, and it is
// narrow on purpose — it only opens for a PRE-COMMIT cast of your own
// (`sus.type === 'cast'`, `item.kind !== 'triggered'`). INSIDE a segment none
// of that is consulted: the walk simply takes your last action, whatever the
// engine happens to be suspended on, because while your decision pends nobody
// else may act and the tail is provably yours. So the floor for a pending cast
// is the same floor as for everything else — `segmentFloor` — and you can back
// out of the choice AND of the play that raised it.
{
  const found = suspendingDeployRoom('UNDA');
  console.log('\n[a pending cast walks back like anything else]');
  if (!found) {
    ok(false, 'no seed reached a deployment play that suspends on a choice');
  } else {
    const { room, seat, before, oppBefore } = found;
    ok(!!room.state.decision, 'the play suspended: a choice is pending');
    ok(room.state.decision!.seat === seat, 'and it is the playing seat that owes it');
    const sus = room.state.suspension!;
    ok(sus.type === 'cast', `the suspension is a cast (${sus.type})`);
    // the narrow outside-a-segment branch would NOT have opened for this one —
    // which is exactly why the segment must not defer to it
    const wouldCastChain = sus.type === 'cast' && sus.item.kind !== 'triggered';
    ok(room.segKey !== null, 'but we are inside a hidden segment');

    const out = undoForSeat(room, seat);
    ok(out.ok, `the pending cast is walkable back (${out.ok ? 'accepted' : out.why})`
      + `${wouldCastChain ? '' : ' — and the castChain branch would have refused this one'}`);
    ok(!room.state.decision, 'the choice is gone with it');
    ok(positionOf(room.state, seat) === before,
      'the position is exactly what it was before the card left hand');
    ok(positionOf(room.state, (1 - seat) as Seat) === oppBefore,
      "and the opponent's is untouched");
  }
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
  // #76's actual words: "✗ your opponent has already acted on top of that one
  // — it cannot be taken back now". No refusal this server can produce may
  // ever say that again, whatever the reason for the refusal is.
  ok(!shut.ok && !/opponent has already acted/.test(shut.why),
    'and the reported error text is gone for good');
}

// ══ 8. R181: a `via: { face }` activation survives its own renumbering ═══
//
// `ActivateVia` has three shapes: the string 'augment', `{ mod }` (activate
// through a mod sitting on the unit) and `{ face }` (activate through a
// granted face's text — R63, and R118's "an activateAbility carrying via:{face}
// replays byte for byte"). `renumberAction` tested `typeof via === 'object'`
// and rewrote `via.mod`, which was written when `{ mod }` was the only OBJECT
// shape. On a `{ face }` activation `.mod` is `undefined`, `undefined < hi` is
// false, so `one()` set moved and returned `undefined - shift` = NaN — and the
// spread wrote `{ mod: NaN }` OVER the face. The action stopped saying which
// ability it was even for.
//
// It is asserted on the pure function rather than through a game because that
// is the only place the corruption is visible: once the rebuild has replayed a
// mangled activation and the engine has refused it, it is indistinguishable
// from any other refusal, and the undo is simply declined for a reason nobody
// can trace. This is exactly the class the reference-key measurement above
// cannot see — the payload was destroyed BEFORE it was measured.
{
  console.log('\n[R181: renumbering does not eat a via:{face}]');
  type Activate = Extract<Action, { type: 'activateAbility' }>;
  const at = (via: ActivateVia): Activate =>
    ({ type: 'activateAbility', seat: 0, entityId: 40, abilityIndex: 0, via });

  const face = renumberAction(at({ face: 'Omniwield Evoker' }), 30, 33) as Activate;
  ok(face.entityId === 37, `the entity id still moves down by the spliced block (${face.entityId})`);
  ok(JSON.stringify(face.via) === JSON.stringify({ face: 'Omniwield Evoker' }),
    `and the face is carried through untouched (${JSON.stringify(face.via)})`);

  const faceText = renumberAction(at({ face: 'Debt Blep', text: 'augment' }), 30, 33) as Activate;
  ok(JSON.stringify(faceText.via) === JSON.stringify({ face: 'Debt Blep', text: 'augment' }),
    `so is which of the face's texts it was reached through (${JSON.stringify(faceText.via)})`);

  const mod = renumberAction(at({ mod: 41 }), 30, 33) as Activate;
  ok(JSON.stringify(mod.via) === JSON.stringify({ mod: 38 }),
    `a { mod } via — the one that really does name an id — still renumbers (${JSON.stringify(mod.via)})`);

  const aug = renumberAction(at('augment'), 30, 33) as Activate;
  ok(aug.via === 'augment', `and the bare 'augment' string is left alone (${String(aug.via)})`);

  // the ids BELOW the splice must not move at all, or the repair would be
  // renumbering things the splice never touched
  const below = renumberAction(
    { type: 'activateAbility', seat: 0, entityId: 12, abilityIndex: 0, via: { face: 'Omniwield Evoker' } },
    30, 33) as Activate;
  ok(below.entityId === 12 && JSON.stringify(below.via) === JSON.stringify({ face: 'Omniwield Evoker' }),
    'an activation that predates the splice comes back completely unchanged');
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
for (const c of codes) rmSync(gameFile(c), { force: true });
process.exit(failures ? 1 : 0);
