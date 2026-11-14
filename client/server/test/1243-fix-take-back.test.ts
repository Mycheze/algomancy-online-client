/* BL-76 — "NOT A BUG! JUST TAKING SOMETHING BACK." ON THE SERVER.
 *
 * The owner, 2026-11-13, on the triage of four take-backs in one game: "the
 * players, now, are most often using the Propose a fix feature to fix the
 * game. It's a casual game among a chill community and there are no stakes,
 * so people generally are okay with some taksie backsies. Instead, we should
 * add a checkbox below the 'Reason' that just allows them to say 'Not a bug!
 * Just taking something back.' That would help us sort reports more easily
 * and stop players from having to type 'oops' or 'aoiehf' in the reason box."
 *
 *   §1 a ticked proposal needs no reason; an unticked one still does, and
 *      only a literal `true` ticks it
 *   §2 the other seat is shown the mark with the fix it names
 *   §3 the agreed fix keeps the mark in the game's record — edit and rewind
 *   §4 the report a run files: all take-backs → a take-back row, not a bug;
 *      one ordinary fix in the run keeps it a bug report
 *
 * Seeds 124300-124399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forcedAction, hiddenSegment } from '../../engine/src/apply.ts';
import type { Action, Seat } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';
import { fixReportFields, TAKE_BACK_NOTE, type FiledFix } from '../report-fields.ts';

process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-1243-'));
type Rooms = typeof import('../rooms.ts');
const R = await (import(`../rooms.ts?r1243=${Math.random()}`) as Promise<Rooms>);

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

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

/** the plain player 485 uses: enough to reach a battle window */
function game(code: string, seed: number): Room {
  const room = R.createRoom(code, seed, ['Ann', 'Bo'], 'shared');
  const recycled = new Set<string>();
  const pick = (seat: Seat): Action | null => {
    const legal = R.legalInRoom(room, seat);
    const key = `${room.state.turn}:${seat}`;
    const rec = legal.find(a => a.type === 'recycleForResource');
    if (rec && !recycled.has(key)) { recycled.add(key); return rec; }
    return legal.find(a => a.type === 'activateResource')
      ?? (room.state.phase === 'deploy' ? legal.find(a => a.type === 'playCard') : undefined)
      ?? legal.find(a => ['decide', 'donePlanning', 'doneHaste', 'declareBlocks', 'passPriority', 'doneDeploying'].includes(a.type))
      ?? legal.filter(a => a.type === 'declareAttack').at(-1) ?? null;
  };
  const at = (r: Room): boolean => r.state.phase === 'battle' && hiddenSegment(r.state) === null
    && !r.state.decision && r.state.priority !== null;
  for (let i = 0; i < 400 && !at(room); i++) {
    const a = pick(0) ?? pick(1);
    assert.ok(a, `the drive stuck at ${room.state.phase}`);
    tick(room, a!);
  }
  assert.ok(at(room), 'fixture: a battle window');
  room.sockets = [{} as never, {} as never];   // both chairs filled (never written to)
  return room;
}

test('1243 §1 a ticked take-back needs no reason; an unticked fix still does', () => {
  const room = game('TB1', 124300);
  const P = room.state.priority as Seat;
  const draw = { kind: 'drawCards', target: P, n: 1 };
  assert.match((R.proposeFix(room, P, { edit: draw, reason: '' }) as { why: string }).why, /say what went wrong/,
    'negative control: no box, no reason, no fix');
  assert.match((R.proposeFix(room, P, { edit: draw, reason: '', takeBack: 'yes' }) as { why: string }).why, /say what went wrong/,
    'only a literal true ticks the box');
  assert.deepEqual(R.proposeFix(room, P, { edit: draw, reason: '', takeBack: true }), { ok: true });
  assert.equal(room.proposal!.takeBack, true);
  assert.equal(room.proposal!.reason, '');
});

test('1243 §2 the other seat is shown the take-back mark with the fix it names', () => {
  const room = game('TB2', 124301);
  const P = room.state.priority as Seat;
  assert.deepEqual(R.proposeFix(room, P, { edit: { kind: 'drawCards', target: P, n: 1 }, reason: 'misclick', takeBack: true }), { ok: true });
  const seen = R.fixInfo(room, other(P))!.proposal!;
  assert.equal(seen.takeBack, true);
  assert.match(seen.what, /draws 1 card/, 'it still says what is being taken back');
  assert.equal(seen.reason, 'misclick', 'and the reason, when one was typed anyway');
  R.dropProposal(room);
  assert.deepEqual(R.proposeFix(room, P, { edit: { kind: 'drawCards', target: P, n: 1 }, reason: 'my draw was skipped' }), { ok: true });
  assert.equal('takeBack' in R.fixInfo(room, other(P))!.proposal!, false, 'an ordinary fix carries no mark');
});

test('1243 §3 a take-back rewind keeps the mark in the game record', () => {
  const room = game('TB3', 124302);
  const P = room.state.priority as Seat;
  const opt = R.rewindOptions(room, P)[0];
  assert.ok(opt, 'fixture: something to rewind');
  assert.deepEqual(R.proposeFix(room, P, { rewind: opt!.to, reason: '', takeBack: true }), { ok: true });
  const ans = R.answerFix(room, other(P), 'accept', room.proposal!.id);
  assert.ok(ans.ok);
  const out = R.rewindRoom(room, ans.ok ? ans.proposal : null!, other(P));
  assert.ok(out.ok, out.ok ? '' : out.why);
  assert.equal(room.amendments.at(-1)!.takeBack, true);
});

const fix = (over: Partial<FiledFix> = {}): FiledFix =>
  ({ kind: 'rewind', what: 'back to before Ann played Good Whale', reason: '', seat: 0, by: 1, takeBack: true, ...over });

test('1243 §4 a run of take-backs files a take-back row, not a bug report', () => {
  const one = fixReportFields({ from: 2, at: 17, fixes: [fix()] });
  assert.equal(one.kind, 'other', 'not filed as a bug');
  assert.equal(one.severity, null);
  assert.equal(one.fix!.takeBack, true);
  assert.equal(one.note, `[Take-back] back to before Ann played Good Whale. ${TAKE_BACK_NOTE}.`);
  assert.doesNotMatch(one.note, /What went wrong/);
  assert.equal(one.actionIndex, 17);
  assert.equal(one.fix!.amendment, 2);
  const said = fixReportFields({ from: 0, at: 5, fixes: [fix({ reason: 'misclick' }), fix({ what: 'back to the start of the step' })] });
  assert.equal(said.fix!.takeBack, true);
  assert.equal(said.fix!.run, 2);
  assert.equal(said.note, `[Take-back] back to before Ann played Good Whale. ${TAKE_BACK_NOTE}: misclick\n`
    + `[and then] back to the start of the step. ${TAKE_BACK_NOTE}.`);
});

test('1243 §4b one ordinary fix in the run keeps it a bug report', () => {
  const plain = fixReportFields({ from: 0, at: 5, fixes: [fix({ takeBack: undefined, reason: 'my draw did not trigger' })] });
  assert.equal(plain.kind, 'bug');
  assert.equal('takeBack' in plain.fix!, false);
  assert.equal(plain.note, '[Agreed fix] back to before Ann played Good Whale. What went wrong: my draw did not trigger');
  const mixed = fixReportFields({ from: 0, at: 5, fixes: [fix(), fix({ takeBack: undefined, reason: 'the attack skipped my block' })] });
  assert.equal(mixed.kind, 'bug');
  assert.equal('takeBack' in mixed.fix!, false);
  assert.match(mixed.note, /^\[Agreed fix\] .*Not a bug, just taking something back\.\n\[and then\] .*What went wrong: the attack skipped my block$/);
});
