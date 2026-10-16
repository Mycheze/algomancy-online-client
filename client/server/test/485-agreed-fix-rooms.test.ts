/* BL-46 — AGREED FIXES IN THE ROOM: the proposal, the rewind, the undo, the file.
 *
 * The owner, 2026-10-16: "Assuming both players agree, it doesn't change
 * anything in the game. it'll only be used to solve broken engine/game
 * issues." And on rewinds: "Rewinding a whole step or two seems fine to me.
 * Either say 'up to 5 actions' or 'restart this step'."
 *
 * Driven in-process on real Rooms (server/rooms.ts), every board built by
 * LOGGED actions so a restore rebuilds exactly the same game:
 *
 *   §1 an accepted edit lands as a logged amend action and is recorded
 *   §2 the per-seat undo cannot walk back past an agreed fix
 *   §3 a rewind cuts the log and every claim about the cut actions — the
 *      fingerprints, the card facts, the standing passes, the parked
 *      actions, the formation being built
 *   §4 rewind options: never a cut at a forced step, at most five actions,
 *      and the start of the step
 *   §5 the proposal: both clocks stop, it lapses, an action ends it, a
 *      decline cools the proposer down, and the rooms that take no fixes
 *   §6 a fixed game survives a restart and replays FAITHFUL, sigs and all
 *   §7 inside a hidden step: shown to both seats at once, on the frozen half
 *      too; an undo passes it only when it would mean the same; a planning
 *      and a deploy fix survive a restart FAITHFUL
 *
 * Seeds 48500-48599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forcedAction, hiddenSegment, replay } from '../../engine/src/apply.ts';
import type { Action, Seat } from '../../engine/src/types.ts';
import type { Proposal, Room } from '../rooms.ts';
import { digest, signature } from '../replay-probe.ts';
import { analyze, reportLines, type RoomFile } from '../replay-room.ts';
import { viewFor } from '../view.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-485-'));
process.env['ALGO_GAMES_DIR'] = DIR;
type Rooms = typeof import('../rooms.ts');
const fresh = (): Promise<Rooms> => import(`../rooms.ts?r485=${Math.random()}`) as Promise<Rooms>;
const R = await fresh();

const NAMES: [string, string] = ['Ann', 'Bo'];
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const sig = (room: Room): string => digest(signature(room.state));

/** one tick of main.ts: apply, drain the forced steps, reopen a closed segment */
function tick(mod: Rooms, room: Room, a: Action): void {
  const was = room.segKey;
  mod.applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    mod.applyToRoom(room, f);
  }
  if (mod.segmentKey(room.state) !== was) mod.openSegment(room);
}

/** a plain player: one recycle a turn, every activation, every unit it can
 * deploy, and the passive answer to everything else — enough to reach battle */
function greedy(mod: Rooms, room: Room, seat: Seat, recycled: Set<string>): Action | null {
  const legal = mod.legalInRoom(room, seat);
  const key = `${room.state.turn}:${seat}`;
  const rec = legal.find(a => a.type === 'recycleForResource');
  if (rec && !recycled.has(key)) { recycled.add(key); return rec; }
  return legal.find(a => a.type === 'activateResource')
    ?? (room.state.phase === 'deploy' ? legal.find(a => a.type === 'playCard') : undefined)
    ?? legal.find(a => ['decide', 'donePlanning', 'doneHaste', 'declareBlocks', 'passPriority', 'doneDeploying'].includes(a.type))
    ?? legal.filter(a => a.type === 'declareAttack').at(-1) ?? null;
}

function drive(mod: Rooms, room: Room, until: (r: Room) => boolean, max = 400): void {
  const recycled = new Set<string>();
  for (let i = 0; i < max && !until(room); i++) {
    const a = greedy(mod, room, 0, recycled) ?? greedy(mod, room, 1, recycled);
    assert.ok(a, `the drive stuck at ${room.state.phase}`);
    tick(mod, room, a!);
  }
  assert.ok(until(room), 'the drive reached its goal');
}

/** a battle window: public, nobody asked anything, somebody holding priority */
const battleWindow = (r: Room): boolean =>
  r.state.phase === 'battle' && hiddenSegment(r.state) === null && !r.state.decision && r.state.priority !== null;

function game(code: string, seed: number): Room {
  const room = R.createRoom(code, seed, [...NAMES], 'shared');
  drive(R, room, battleWindow);
  return room;
}

/** both chairs filled, as far as the room can tell (the sockets are never written to) */
const live = (room: Room): void => { room.sockets = [{} as never, {} as never]; };

/** what main.ts's accept path does with an agreed edit */
function acceptEdit(room: Room, p: Proposal, by: Seat): void {
  const at = room.actions.length;
  tick(R, room, { type: 'amend', seat: p.seat, by, edit: p.edit! });
  R.recordAmendment(room, { kind: 'edit', at, seat: p.seat, by, what: p.what, reason: p.reason, when: new Date().toISOString(), edit: p.edit! });
}

/* ── §1 ─────────────────────────────────────────────────────────────── */

test('§1 an accepted edit lands as a logged amend action and is recorded', () => {
  const room = game('FX1', 48500);
  live(room);
  const P = room.state.priority as Seat;
  const hand = room.state.players[P]!.hand.length;
  const out = R.proposeFix(room, P, { edit: { kind: 'drawCards', target: P, n: 1 }, reason: 'my draw did not happen' });
  assert.deepEqual(out, { ok: true });
  const ans = R.answerFix(room, other(P), 'accept', room.proposal!.id);
  assert.ok(ans.ok);
  acceptEdit(room, ans.ok ? ans.proposal : null!, other(P));
  const last = room.actions.at(-1)!;
  assert.equal(last.type, 'amend', 'the fix is in the log');
  assert.deepEqual(last, { type: 'amend', seat: P, by: other(P), edit: { kind: 'drawCards', target: P, n: 1 } });
  assert.equal(room.state.players[P]!.hand.length, hand + 1);
  assert.equal(room.amendments.length, 1);
  assert.equal(room.amendments[0]!.at, room.actions.length - 1);
  assert.equal(room.amendments[0]!.reason, 'my draw did not happen');
  assert.equal(R.amendFloor(room), -1, 'an edit sets no hard floor: it is guarded by measurement (§7)');
});

/* ── §2 ─────────────────────────────────────────────────────────────── */

/** turn 1 planning: seat 0 recycles, seat 1 recycles, seat 0 acts again */
function threeInPlanning(code: string): Room {
  const room = R.createRoom(code, 48510, [...NAMES], 'shared');
  const first = (s: Seat, t: Action['type']): Action => R.legalInRoom(room, s).find(a => a.type === t)!;
  tick(R, room, first(0, 'recycleForResource'));
  tick(R, room, first(1, 'recycleForResource'));
  const second = R.legalInRoom(room, 0).find(a => a.type === 'activateResource') ?? first(0, 'donePlanning');
  tick(R, room, second);
  assert.equal(room.actions.length, 3, 'fixture: three actions in the open planning step');
  assert.equal(room.segKey, 'plan');
  return room;
}

test('§2 the per-seat undo cannot walk back past an agreed fix', () => {
  // the control: with no fix, seat 0's two undos walk back to its recycle
  const control = threeInPlanning('FX2A');
  assert.deepEqual(R.undoForSeat(control, 0), { ok: true });
  assert.deepEqual(R.undoForSeat(control, 0), { ok: true }, 'control: the walk really reaches the recycle');
  assert.equal(control.actions.length, 1);

  // the same three actions, and an agreed rewind of the last one
  const room = threeInPlanning('FX2B');
  const out = R.rewindRoom(room, { id: 1, seat: 1, kind: 'rewind', to: 2, what: 'take back the last action', reason: 'misclick', at: 3, expires: Date.now() + 60_000 }, 0);
  assert.ok(out.ok);
  assert.equal(room.actions.length, 2);
  const undo = R.undoForSeat(room, 0);
  assert.deepEqual(undo, { ok: false, why: R.FIX_UNDO_REFUSAL },
    'seat 0 cannot take back its recycle on its own: both players agreed to the board the rewind left');
  assert.equal(room.actions.length, 2, 'and nothing moved');
});

/* ── §3 ─────────────────────────────────────────────────────────────── */

test('§3 a rewind cuts the log and every claim about the cut actions', () => {
  const room = game('FX3', 48520);
  const before = [...room.actions];
  const sigs = [...room.sigs];
  const opts = R.rewindOptions(room);
  assert.ok(opts.length >= 2, `rewinds are on offer (${opts.map(o => o.label).join(' | ')})`);
  const pick = opts.find(o => /the start of/.test(o.label)) ?? opts.at(-1)!;
  // the soft state a rewind must not carry onto the rebuilt board
  room.passAll[0] = { mode: 'all', armedPhase: 'battle', armedItems: [], armedOpts: [] };
  room.passAllCovered[1] = { at: room.state.actionCount, len: room.actions.length };
  room.deferred[1] = [{ type: 'passPriority', seat: 1 }];
  room.building[0] = { cols: [[1]], send: [] };
  room.watchHold[1] = Date.now() + 5000;
  room.versions.push({ at: new Date().toISOString(), sha: 'later', from: room.actions.length - 1 });
  const p: Proposal = { id: 9, seat: 0, kind: 'rewind', to: pick.to, what: pick.label, reason: 'the attack skipped my block', at: before.length, expires: Date.now() + 60_000 };
  const out = R.rewindRoom(room, p, 1);
  assert.ok(out.ok, out.ok ? '' : out.why);
  assert.equal(room.actions.length, pick.to);
  assert.deepEqual(room.actions, before.slice(0, pick.to));
  assert.deepEqual(room.amendments.at(-1)!.removed, before.slice(pick.to), 'the actions taken back are archived on the room');
  assert.deepEqual(room.sigs, sigs.slice(0, pick.to), 'the fingerprints of the cut actions go with them');
  assert.equal(room.cardLog.length, pick.to);
  assert.equal(room.segPosRefs.length, pick.to);
  assert.deepEqual(room.passAll, [null, null], 'the standing passes are dropped');
  assert.deepEqual(room.passAllCovered, [null, null]);
  assert.deepEqual(room.deferred, [[], []], 'the parked actions are dropped');
  assert.deepEqual(room.building, [null, null], 'the formation being built is dropped');
  assert.deepEqual(room.watchHold, [null, null]);
  assert.ok(room.versions.every(v => v.from <= pick.to), 'no version stamp points past the end of the log');
  assert.equal(room.versions.at(-1)!.sha, 'later', '…and what follows is still credited to the engine recording it');
  const rebuilt = replay(48520, before.slice(0, pick.to), [...NAMES], 'shared').state;
  assert.equal(sig(room), digest(signature(rebuilt)), 'the board is exactly the prefix replayed');
});

/* ── §4 ─────────────────────────────────────────────────────────────── */

test('§4 rewind options: never a cut at a forced step, at most five actions, and the start of the step', () => {
  const room = game('FX4', 48530);
  const forcedAt = (r: Room): boolean[] => r.actions.map((a, i) => {
    const s = replay(48530, r.actions.slice(0, i), [...NAMES], 'shared').state;
    const f = forcedAction(s);
    return f !== null && JSON.stringify(f) === JSON.stringify(a);
  });
  // on into a battle window with a FORCED step among the last few actions (an
  // empty side's declaration) — the cut a naive "last N actions" would make
  drive(R, room, r => battleWindow(r) && r.actions.length > 50 && forcedAt(r).slice(-4).some(Boolean));
  const forced = forcedAt(room);
  assert.ok(forced.slice(-4).some(Boolean), 'fixture: a forced step among the last four actions');
  const opts = R.rewindOptions(room);
  for (const o of opts) {
    assert.equal(forced[o.to], false, `"${o.label}" cuts at a forced step (index ${o.to}) — it would re-apply itself at once`);
    assert.ok(o.to < room.actions.length);
  }
  const steps = opts.filter(o => o.label.startsWith('Take back'));
  assert.ok(steps.length >= 1 && steps.length <= 5, `between one and five action rewinds (${steps.length})`);
  assert.equal(new Set(opts.map(o => o.to)).size, opts.length, 'no two options land on the same board');
  // the owner's other shape, "restart this step": offered at the first battle
  // window of a fresh game, merged into "the last N" where the two coincide
  const fresh1 = game('FX4B', 48531);
  const o2 = R.rewindOptions(fresh1);
  assert.ok(o2.some(o => /the start of/.test(o.label)), `the start of a step is offered (${o2.map(o => o.label).join(' | ')})`);
});

/* ── §5 ─────────────────────────────────────────────────────────────── */

test('§5 a proposal stops both clocks, lapses after a minute, and ends on any action', () => {
  const room = game('FX5', 48540);
  live(room);
  R.settleClock(room);
  assert.ok(R.clockRunning(room).some(Boolean), 'fixture: somebody is on the clock');
  const P = room.state.priority as Seat;
  const draw = { kind: 'drawCards', target: P, n: 1 };
  assert.match((R.proposeFix(room, P, { edit: draw, reason: '' }) as { why: string }).why, /say what went wrong/);
  assert.deepEqual(R.proposeFix(room, P, { edit: draw, reason: 'the draw was skipped' }), { ok: true });
  assert.deepEqual(R.clockRunning(room), [false, false], 'owner: both clocks pause while a proposal is open');
  assert.match(R.fixInfo(room, other(P))!.proposal!.what, /draws 1 card/);
  assert.match((R.proposeFix(room, other(P), { edit: draw, reason: 'again' }) as { why: string }).why, /already waiting/);
  assert.match((R.answerFix(room, P, 'accept', room.proposal!.id) as { why: string }).why, /other player answers/);
  // lapses
  const now = Date.now();
  assert.equal(R.proposalExpired(room, now + 30_000), false);
  assert.equal(R.proposalExpired(room, now + R.FIX_PROPOSAL_MS + 1000), true, 'gone after a minute');
  assert.equal(room.proposal, null);
  assert.ok(R.clockRunning(room).some(Boolean), 'and the clocks run again');
  // ends on any action
  assert.deepEqual(R.proposeFix(room, P, { edit: draw, reason: 'the draw was skipped' }), { ok: true });
  tick(R, room, { type: 'passPriority', seat: room.state.priority as Seat });
  assert.equal(room.proposal, null, 'an action landed: the proposal was about a board that is gone');
});

test('§5 a decline cools the proposer down; a withdraw does not', () => {
  const room = game('FX5B', 48541);
  live(room);
  const P = room.state.priority as Seat;
  const life = { kind: 'life', target: other(P), life: 9 };
  assert.deepEqual(R.proposeFix(room, P, { edit: life, reason: 'the lifelink did not count' }), { ok: true });
  assert.ok(R.answerFix(room, P, 'cancel', room.proposal!.id).ok, 'the proposer may withdraw');
  assert.deepEqual(R.proposeFix(room, P, { edit: life, reason: 'the lifelink did not count' }), { ok: true }, 'no cooldown after a withdraw');
  assert.ok(R.answerFix(room, other(P), 'decline', room.proposal!.id).ok);
  const t = Date.now();
  assert.match((R.proposeFix(room, P, { edit: life, reason: 'please' }, t) as { why: string }).why, /declined — wait/);
  assert.deepEqual(R.proposeFix(room, P, { edit: life, reason: 'please' }, t + R.FIX_COOLDOWN_MS + 10), { ok: true });
});

test('§5 edits and rewinds both work in a hidden step; some rooms take no fixes', () => {
  const room = R.createRoom('FX5C', 48542, [...NAMES], 'shared');
  live(room);
  const first = R.legalInRoom(room, 0).find(a => a.type === 'recycleForResource')!;
  tick(R, room, first);
  assert.equal(room.segKey, 'plan', 'fixture: the hidden planning step');
  assert.equal(R.editTiming(room), null, 'owner, 2026-10-16: edits are allowed in the hidden steps too');
  assert.deepEqual(R.proposeFix(room, 0, { edit: { kind: 'drawCards', target: 0, n: 1 }, reason: 'draw missed' }), { ok: true });
  assert.ok(R.answerFix(room, 0, 'cancel', room.proposal!.id).ok);
  const opts = R.rewindOptions(room);
  assert.ok(opts.length, 'a rewind is on offer in the hidden step');
  assert.deepEqual(R.proposeFix(room, 1, { rewind: opts[0]!.to, reason: 'they misclicked' }), { ok: true }, 'owner: "a rewind any time"');
  // the opponent gone: nobody to agree
  const gone = R.createRoom('FX5D', 48543, [...NAMES], 'shared');
  gone.sockets = [{} as never, null];
  tick(R, gone, R.legalInRoom(gone, 0).find(a => a.type === 'recycleForResource')!);
  assert.match((R.proposeFix(gone, 0, { rewind: R.rewindOptions(gone)[0]!.to, reason: 'x x x' }) as { why: string }).why, /not here to agree/);
  // test mode and a scenario: two people agreeing is the whole of the safety
  const sandbox = R.createRoom('FX5E', 48544, [...NAMES], 'shared', undefined, undefined, 'sandbox');
  assert.match(R.fixesRefusal(sandbox)!, /test mode/);
  assert.equal(R.fixInfo(sandbox, 0), undefined, 'and its pushes say nothing about fixes');
});

/* ── §6 ─────────────────────────────────────────────────────────────── */

test('§6 a fixed game survives a restart and replays FAITHFUL, sigs and all', async () => {
  const room = game('FX6', 48550);
  live(room);
  const P = room.state.priority as Seat;
  assert.deepEqual(R.proposeFix(room, P, { edit: { kind: 'drawCards', target: P, n: 2 }, reason: 'two draws were skipped' }), { ok: true });
  const ans = R.answerFix(room, other(P), 'accept', room.proposal!.id);
  acceptEdit(room, ans.ok ? ans.proposal : null!, other(P));
  drive(R, room, r => r.actions.length >= room.amendments[0]!.at + 6);
  const opt = R.rewindOptions(room)[0]!;
  assert.deepEqual(R.proposeFix(room, other(P), { rewind: opt.to, reason: 'a misclick' }), { ok: true });
  const ans2 = R.answerFix(room, P, 'accept', room.proposal!.id);
  assert.ok(ans2.ok && R.rewindRoom(room, ans2.proposal, P).ok);
  drive(R, room, r => r.actions.length >= opt.to + 4);
  const want = { actions: JSON.stringify(room.actions), sig: sig(room), amendments: JSON.stringify(room.amendments) };

  // a restarted server: a second copy of the module over the same directory
  const R2 = await fresh();
  R2.restoreRooms();
  const back = R2.getRoom('FX6')!;
  assert.ok(back, 'restored');
  assert.equal(JSON.stringify(back.actions), want.actions);
  assert.equal(sig(back), want.sig, 'the same board');
  assert.equal(JSON.stringify(back.amendments), want.amendments, 'the fixes, the reasons and the archived rewind');
  assert.deepEqual(back.lost, [], 'nothing refused');
  assert.deepEqual(back.drifted, [], 'nothing changed meaning');
  assert.equal(back.frozen, null);

  // and the forensic tool agrees, fingerprint by fingerprint
  const raw = JSON.parse(readFileSync(join(DIR, 'FX6.json'), 'utf8')) as RoomFile;
  const an = analyze(raw);
  assert.deepEqual(an.refusals, []);
  assert.equal(raw.sigs!.length, raw.actions.length);
  assert.deepEqual(an.sigs, raw.sigs, 'every recorded fingerprint matches the replay');
  const text = reportLines('FX6.json', raw, an).lines.join('\n');
  assert.match(text, /FAITHFUL/);
  assert.match(text, /agreed fixes \(2\)/);
  assert.match(text, /taken back \(\d+\)/, 'the rewind prints what it took back');
  assert.match(text, /what went wrong: two draws were skipped/);
});

test('§6 a rematch starts with no fixes', () => {
  const room = game('FX7', 48560);
  room.amendments.push({ kind: 'edit', at: 0, seat: 0, by: 1, what: 'x', reason: 'y', when: '' });
  const next = R.createRematch(room, 'FX7R');
  assert.deepEqual(next.amendments, []);
  assert.equal(next.proposal, null);
});

/* ── §7 inside a hidden step ───────────────────────────────────────── */
//
// The owner, 2026-10-16, lifting the first version's refusal: edits work in
// the hidden planning / haste / deploy steps too — a fix is public and agreed
// by both players. So it must reach BOTH seats at once (never held for the
// barrier), show on the frozen half each seat is shown of the other, stay
// standing against the per-seat undo, and survive a restart.


/** what `seat` is shown right now */
const shownTo = (room: Room, seat: Seat): string => JSON.stringify(viewFor(room.state, seat, room.segSnapshot));
const fixEvent = (evs: readonly { data?: Record<string, unknown> }[]): boolean => evs.some(e => e.data?.['amend'] !== undefined);

/** turn 1 planning: both seats recycle their FIRST card behind the screen */
function planning(code: string, seed: number): Room {
  const room = R.createRoom(code, seed, [...NAMES], 'shared');
  live(room);
  for (const seat of [0, 1] as Seat[]) {
    const rec = R.legalInRoom(room, seat).find(a => a.type === 'recycleForResource' && a.handIndex === 0)!;
    tick(R, room, rec);
  }
  assert.equal(room.segKey, 'plan');
  return room;
}

test('§7 a fix in the hidden planning step reaches both seats at once and shows on the frozen half', () => {
  const room = planning('FX8', 48570);
  const hand0 = room.state.players[0]!.hand;
  const card = hand0[0]!;
  const frozenHand = room.segSnapshot!.players[0]!.hand.length;
  const frozenRes = room.segSnapshot!.players[0]!.resources.length;
  assert.ok(room.state.players[0]!.resources.length > frozenRes, 'fixture: seat 0 made a resource behind the screen');
  assert.equal(JSON.parse(shownTo(room, 1)).players[0].resources.length, frozenRes, 'fixture: which seat 1 cannot see');
  assert.deepEqual(R.proposeFix(room, 0, { edit: { kind: 'move', from: 'hand', index: 0, card, to: 'bin' }, reason: 'the discard did not happen' }), { ok: true });
  const ans = R.answerFix(room, 1, 'accept', room.proposal!.id);
  acceptEdit(room, ans.ok ? ans.proposal : null!, 1);
  assert.equal(room.segKey, 'plan', 'still inside the hidden step');
  const seen = JSON.parse(shownTo(room, 1));
  assert.ok(seen.players[0].bin.includes(card), 'seat 1 sees the card seat 0 moved to the bin — now, not at the barrier');
  assert.equal(seen.players[0].hand.length, frozenHand - 1, 'and the hand it is shown is one card smaller');
  assert.equal(seen.players[0].resources.length, frozenRes, 'while seat 0 own hidden recycle stays hidden');
  assert.ok(!fixEvent(room.heldEvents[1]!), 'the fix is not held for the barrier');
  assert.ok(!fixEvent(room.heldEvents[0]!));
  assert.ok(fixEvent(room.events), 'its line is in the log, for both');
});

test('§7 in the step, an undo passes a fix only when the fix would mean the same', () => {
  const room = planning('FX9', 48571);
  const hand0 = room.state.players[0]!.hand;
  assert.notEqual(hand0[0], room.segSnapshot!.players[0]!.hand[0], 'fixture: the recycled first card differs from the new first card');
  assert.deepEqual(R.proposeFix(room, 0, { edit: { kind: 'move', from: 'hand', index: 0, card: hand0[0]!, to: 'bin' }, reason: 'a discard went missing' }), { ok: true });
  const ans = R.answerFix(room, 1, 'accept', room.proposal!.id);
  acceptEdit(room, ans.ok ? ans.proposal : null!, 1);
  const len = room.actions.length;
  // seat 0's own recycle came before the fix, and un-recycling it would put a
  // different card at the hand index the fix names: refused, by measurement
  assert.deepEqual(R.undoForSeat(room, 0), { ok: false, why: 'taking that back would change an agreed fix — it cannot be undone now' });
  assert.equal(room.actions.length, len);
  // seat 1's recycle touched nothing the fix names: the other seat is not frozen by it
  assert.deepEqual(R.undoForSeat(room, 1), { ok: true }, 'the other seat may still take back its own move');
  assert.equal(room.actions.length, len - 1);
  assert.equal(room.actions.at(-1)!.type, 'amend', 'and the fix itself is never the thing taken back');
  assert.ok(JSON.parse(shownTo(room, 1)).players[0].bin.length >= 1, 'the rebuilt frozen board still shows the fix');
});

test('§7 a fix in the hidden deploy step, and both hidden-step fixes survive a restart FAITHFUL', async () => {
  // a mid-planning fix…
  const plan = planning('FXA', 48572);
  assert.deepEqual(R.proposeFix(plan, 1, { edit: { kind: 'drawCards', target: 1, n: 1 }, reason: 'the turn draw was skipped' }), { ok: true });
  const a1 = R.answerFix(plan, 0, 'accept', plan.proposal!.id);
  acceptEdit(plan, a1.ok ? a1.proposal : null!, 0);
  const planShown = [shownTo(plan, 0), shownTo(plan, 1)];
  // …and a mid-deploy one: a unit taken off the board while its owner deploys
  const dep = game('FXB', 48573);
  drive(R, dep, r => r.segKey === 'deploy' && Object.values(r.state.entities).some(e => e.kind === 'unit'));
  live(dep);
  const u = Object.values(dep.state.entities).find(e => e.kind === 'unit')!;
  const owner = u.controller as Seat, P = other(owner);
  const handBefore = JSON.parse(shownTo(dep, P)).players[owner].hand.length;
  assert.deepEqual(R.proposeFix(dep, P, { edit: { kind: 'unit', id: u.id, card: u.card, to: 'hand' }, reason: 'it should have died' }), { ok: true });
  const a2 = R.answerFix(dep, owner, 'accept', dep.proposal!.id);
  acceptEdit(dep, a2.ok ? a2.proposal : null!, owner);
  assert.equal(dep.segKey, 'deploy');
  const seenByP = JSON.parse(shownTo(dep, P));
  assert.ok(!Object.values(seenByP.entities as Record<string, { id: number }>).some(e => e.id === u.id), 'the proposer sees the unit gone from the frozen half');
  assert.equal(seenByP.players[owner].hand.length, handBefore + 1, 'and its card back in its owner hand');
  const depShown = [shownTo(dep, 0), shownTo(dep, 1)];

  const R2 = await fresh();
  R2.restoreRooms();
  for (const [code, room, shown] of [['FXA', plan, planShown], ['FXB', dep, depShown]] as const) {
    const back = R2.getRoom(code)!;
    assert.equal(sig(back), sig(room), `${code}: the same board after a restart`);
    assert.deepEqual(back.lost, [], `${code}: nothing refused`);
    assert.deepEqual(back.drifted, [], `${code}: nothing changed meaning`);
    assert.deepEqual([shownTo(back, 0), shownTo(back, 1)], [...shown], `${code}: each seat is shown exactly what it was shown before`);
    const raw = JSON.parse(readFileSync(join(DIR, `${code}.json`), 'utf8')) as RoomFile;
    const an = analyze(raw);
    assert.deepEqual(an.refusals, []);
    assert.deepEqual(an.sigs, raw.sigs, `${code}: every recorded fingerprint matches`);
    assert.match(reportLines(`${code}.json`, raw, an).lines.join('\n'), /FAITHFUL/);
  }
});
