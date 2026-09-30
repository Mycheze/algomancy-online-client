/* CT-182 — THE SERVER DOES NOT PASS FOR A SEAT WHOSE REPORT DIALOG IS OPEN.
 *
 * The owner, 2026-09-30: a standing auto-pass HOLDS while the 📝 Report dialog
 * is open (that dialog only). The client stops its own passes (ui/test/353);
 * this is the other half. Since the standing pass reached the server
 * (2026-09-28) the server keeps a copy of the arm and passes for the seat by
 * itself once it has sat in a window for PASS_ALL_BACKSTOP_MS
 * (main.ts `sweepPassAll` ← rooms.ts `passAllDue`). A player typing a report
 * about THIS moment would have the moment passed out from under them by the
 * server even with a client that held perfectly.
 *
 * Driven in-process on a real Room, through the same functions the sweep and
 * the `reporthold` message call. The room's state is a pass-only battle
 * window built through the engine.
 *
 * §1 armed and held: nothing is due, the arm is kept, and the seat is billed
 * §2 released: the arm resumes, with a fresh window (2s from the release,
 *    not from when the window first opened)
 * §3 nothing reaches the action log
 * §4 the wire: the message, the join, and a disconnect clear or set it
 *
 * Seeds 35300-35399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Seat } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// rooms.ts persists every room it touches: point it at a throwaway first
process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-353b-'));
const {
  createRoom, clockRunning, passAllDue, setPassAll, setReportHold, settleClock, PASS_ALL_BACKSTOP_MS,
} = await import('../rooms.ts');

/** a room whose state is a battle window where `seat` may only pass, both
 * seats "connected", the arm up */
function armedRoom(seed: number): { room: Room; seat: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Oorblak');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  e.player(0).hand = []; e.player(1).hand = [];
  e.settle();
  const seat = h.state.priority as Seat;
  assert.deepEqual(legalActions(h.state, seat).map(a => a.type), ['passPriority'], 'fixture: a pass-only window');
  const room = createRoom(`R${seed}`, seed);
  room.state = h.state;
  // matchRunning wants both chairs filled; the sockets are never written to here
  room.sockets = [{} as never, {} as never];
  setPassAll(room, seat, { mode: 'all', armedPhase: h.state.phase, armedItems: [], armedOpts: [] });
  settleClock(room);
  return { room, seat };
}
const later = (): number => Date.now() + PASS_ALL_BACKSTOP_MS + 50;

test('CT-182 server positive control: an armed seat is passed for after the backstop', () => {
  const { room, seat } = armedRoom(35300);
  assert.equal(clockRunning(room)[seat], false, 'armed, the seat is not billed for the window');
  assert.equal(passAllDue(room, later()), seat,
    'the backstop is due for the armed seat — if this is not, every "not due" below is vacuous');
});

test('CT-182 server a seat with the report dialog open is not passed for, keeps its arm, and is billed', () => {
  const { room, seat } = armedRoom(35301);
  const logged = room.actions.length;
  assert.equal(setReportHold(room, seat, true), true, 'the hold is new');
  settleClock(room);
  assert.equal(passAllDue(room, later()), null,
    'the server would pass for a seat whose player is typing a report about this very window');
  assert.equal(passAllDue(room, Date.now() + 10 * 60_000), null, 'however long the dialog stays open');
  assert.ok(room.passAll[seat], 'the arm is KEPT while held — closing the dialog resumes it');
  assert.equal(clockRunning(room)[seat], true,
    'while held the seat is billed: the table is waiting on a person, not on an arm');
  assert.equal(room.actions.length, logged, 'and nothing entered the action log');
});

test('CT-182 server releasing the hold resumes the arm with a fresh window', () => {
  const { room, seat } = armedRoom(35302);
  setReportHold(room, seat, true);
  settleClock(room);
  assert.equal(setReportHold(room, seat, false), true);
  settleClock(room);
  assert.equal(clockRunning(room)[seat], false, 'released: the arm answers the window again, unbilled');
  assert.equal(passAllDue(room, Date.now()), null,
    'not passed the instant the dialog closes — the backstop counts from the release');
  assert.equal(passAllDue(room, later()), seat, 'and passes once the backstop has run from the release');
  assert.equal(setReportHold(room, seat, false), false, 'a second release changes nothing');
});

test('CT-182 server the hold rides the wire as soft state: its message, the join, and the disconnect', () => {
  const MAIN = readFileSync(join(HERE, '../main.ts'), 'utf8');
  const handler = /if \(msg\.t === 'reporthold'\) \{([\s\S]*?)\n    \}/.exec(MAIN)?.[1] ?? '';
  assert.match(handler, /setReportHold\(conn\.room, conn\.seat, msg\.on === true\)/, 'the message sets it');
  assert.doesNotMatch(handler, /landAction|applyToRoom|room\.actions/,
    'the hold is not a game action: nothing in its handler may reach the log or a replay');
  assert.match(MAIN, /setReportHold\(room, seat, msg\.hold === true\)/,
    'a join re-asserts it (the client sends hold while its dialog is open) or clears it');
  const close = /ws\.on\('close', \(\) => \{([\s\S]*?)\n  \}\);/.exec(MAIN)?.[1] ?? '';
  assert.match(close, /setReportHold\(conn\.room, conn\.seat, false\)/,
    'a disconnect clears it, so an empty chair holds nothing');
});
