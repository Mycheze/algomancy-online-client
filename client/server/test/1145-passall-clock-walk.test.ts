/* CT-523 / report #323 — WHICH WINDOWS A SEAT ON PASS ALL IS BILLED FOR.
 *
 * The owner, report #323 (room SHXD, 2026-11-03): *"When 'all passing' your
 * clock still ticks down and it shouldn't."* His standing order, 2026-09-28:
 * *"When a player is 'Pass all'ed, their timer should never go down."*
 *
 * What the server does today (CR D3.2b): the armed seat is unbilled in every
 * PRIORITY WINDOW the arm is answering, and billed for every real choice the
 * game asks of it while the arm stands — a block or attack declaration, a
 * target, a "you may pay". SHXD replayed through rooms.ts with an 'all' arm
 * taken at each seat's first pass of the battle: every pass window of both
 * seats ran no clock; the only billed states under the arm were declareBlocks,
 * declareAttack (round 2), decide/targets and decide/payOrDecline.
 *
 * §2 IS THE OWNER'S CALL. Asked (report #323) whether a declaration or a
 * decision made while Pass all is on should be unbilled too, he answered
 * (Discord, 2026-11-05): *"No, the clock should only tick down when there's an
 * action for you to take. When you're holding up the game. … It should ONLY
 * tick down when you have to do something, anything, in order for the game to
 * progress."* A block declaration is something you have to do, so it is
 * billed; a window Pass all answers is not. CR D3.2b carries the call.
 *
 * Driven in-process on a real Room, as 353b is. Seeds 114400-114499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness } from '../../engine/src/harness.ts';
import { forcedAction } from '../../engine/src/apply.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, Seat } from '../../engine/src/types.ts';
import { inPassWindow, optionKeys } from '../../ui/passrelease.ts';
import type { Room } from '../rooms.ts';

process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-1145-'));
const { createRoom, applyToRoom, legalInRoom, setPassAll, settleClock } = await import('../rooms.ts');

interface Seen { step: string; passWindow: boolean; billed: boolean; armed: boolean }

/** A battle where the armed seat D defends against two attackers: D presses
 * Pass all at its first priority window, then every window plays out the way
 * the client and the backstop would play it. Records D's clock at every state. */
function walk(seed: number): { seen: Seen[]; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative;
  const D = (1 - A) as Seat;
  const atk = [spawn(h, A, 'Oorblak'), spawn(h, A, 'Oorblak')];
  spawn(h, D, 'Oorblak');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk[0]!], [atk[1]!]] });
  const room: Room = createRoom(`W${seed}`, seed);
  room.state = h.state;
  room.sockets = [{} as never, {} as never];
  settleClock(room);
  const seen: Seen[] = [];
  for (let g = 0; g < 60 && room.state.phase === 'battle'; g++) {
    const s = room.state;
    const legal = legalInRoom(room, D);
    const pw = inPassWindow(s, D, legal);
    if (pw && !room.passAll[D]) {
      // the click: the arm (ui/battle.ts armSnapshot's fields) reaches the
      // server before the pass it goes with
      setPassAll(room, D, { mode: 'all', armedPhase: s.phase, armedItems: s.stack.map(it => it.id), armedOpts: optionKeys(s, legal) });
      settleClock(room);
    }
    seen.push({
      step: s.decision ? `decide:${s.decision.kind}` : s.battle?.step ?? s.phase,
      passWindow: pw, billed: room.clockRun[D] === true, armed: !!room.passAll[D],
    });
    let a: Action;
    if (s.priority !== null && !s.decision) a = { type: 'passPriority', seat: s.priority };
    else if (s.battle?.step === 'blocks' && s.battle.defender === D) a = { type: 'declareBlocks', seat: D, blocks: {} } as Action;
    else a = forcedAction(s) ?? (() => { throw new Error(`fixture: no move at ${seen.at(-1)!.step}`); })();
    applyToRoom(room, a);
    settleClock(room);
  }
  return { seen, D };
}

test('CT-523 §1 a seat on Pass all runs no clock in any priority window of the battle', () => {
  const { seen } = walk(114400);
  const armedWindows = seen.filter(x => x.armed && x.passWindow);
  assert.ok(armedWindows.length >= 3, `fixture: several armed pass windows (saw ${armedWindows.length})`);
  for (const x of armedWindows) assert.equal(x.billed, false, `billed in a pass window the arm answers (${x.step})`);
  const before = seen.find(x => x.passWindow && !x.armed);
  assert.equal(before, undefined, 'the arm went up at the first window, so no window is unarmed');
});

test('CT-523 §2 the block declaration under Pass all is billed — the owner: the clock runs while you have to do something', () => {
  const { seen, D } = walk(114401);
  const blocks = seen.find(x => x.step === 'blocks');
  assert.ok(blocks, `fixture: D (seat ${D}) is asked to declare blocks`);
  assert.equal(blocks.armed, true, 'the arm stands through the declaration (it is not a pass window, so nothing releases it)');
  assert.equal(blocks.passWindow, false);
  // CR D3.2b "A real choice is billed even while a standing pass is set." —
  // the owner's call of 2026-11-05 (header).
  assert.equal(blocks.billed, true, 'declaring blocks is billed even with Pass all on');
});
