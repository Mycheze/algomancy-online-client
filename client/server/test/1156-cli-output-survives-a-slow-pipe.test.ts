/* 1156 — CT-511: A REPLAY TOOL'S OUTPUT REACHES A SLOW READER WHOLE.
 *
 * Test 594 failed with two copies running at once: replay-report-run.ts exited
 * 0 and its game log stopped at action 58 of 60, the summary after it gone.
 * The tools printed with console.log and then called process.exit(). Into a
 * pipe, console.log writes what the pipe will take and QUEUES the rest, and
 * process.exit() drops that queue. A reader that keeps up never sees it; a
 * loaded box, a `| head`, or a test runner busy elsewhere does, and the tool
 * still says it succeeded. replay-room.ts had the same last line, and the
 * night worker reads every replay it makes through a pipe.
 *
 * Here the reader holds its end shut while the tool prints a long `--log`
 * (far more than a pipe holds), then reads it all: the tool's closing lines
 * must be there, and the exit code with them. With process.exit() back, the
 * tool dies with most of its log still queued.
 *
 * Seeds 115600-115699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forcedAction } from '../../engine/src/apply.ts';
import type { Action, Seat } from '../../engine/src/types.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-1156-'));
process.env['ALGO_GAMES_DIR'] = DIR;
test.after(() => rmSync(DIR, { recursive: true, force: true }));
const R = await import('../rooms.ts');
const TOOL = fileURLToPath(new URL('../replay-room.ts', import.meta.url));

/** a long, quiet game: both seats take the first plain step offered and never
 * attack, so it runs until the decks do (about 1900 actions, 240 turns) */
function longGame(code: string, seed: number, actions: number): string {
  const room = R.createRoom(code, seed, ['Ann', 'Bo'], 'shared');
  const PLAIN = ['decide', 'donePlanning', 'doneHaste', 'declareBlocks', 'passPriority', 'doneDeploying'];
  const pick = (s: Seat): Action | undefined => {
    const legal = R.legalInRoom(room, s);
    return legal.find(a => a.type === 'activateResource')
      ?? (room.state.phase === 'deploy' ? legal.find(a => a.type === 'playCard') : undefined)
      ?? legal.find(a => PLAIN.includes(a.type))
      ?? legal.find(a => a.type === 'declareAttack');
  };
  while (room.actions.length < actions && room.state.phase !== 'gameover') {
    const f = forcedAction(room.state);
    const a = f ?? pick(0) ?? pick(1);
    assert.ok(a, `the drive stuck at ${room.state.phase}`);
    R.applyToRoom(room, a);
  }
  return join(DIR, `${code}.json`);
}

/** run `args` with stdout written to a FILE: a file write is synchronous, so
 * nothing can be left queued at exit — this is the whole output, the reference */
function toAFile(args: string[]): { code: number | null; out: string } {
  const path = join(DIR, `out-${Math.random().toString(36).slice(2)}.txt`);
  const fd = openSync(path, 'w');
  try {
    const r = spawnSync(process.execPath, args, { stdio: ['ignore', fd, 'pipe'] });
    return { code: r.status, out: readFileSync(path, 'utf8') };
  } finally { closeSync(fd); }
}

/** run `args` through a pipe this side does not read until the tool has had
 * `holdMs` to print everything; then read it all */
function throughAShutPipe(args: string[], holdMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let code: number | null = null;
    child.stdout.pause();
    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.on('error', fail);
    child.on('exit', c => { code = c; });
    const t = setTimeout(() => child.stdout.resume(), holdMs);
    child.on('close', () => { clearTimeout(t); done({ code, out: Buffer.concat(chunks).toString('utf8') }); });
  });
}

test('CT-511: replay-room --log read through a slow pipe arrives whole, verdict and all', async () => {
  const file = longGame('SP1156', 115600, 3000);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { actions: unknown[] };
  assert.ok(raw.actions.length >= 1500, `fixture: a long game on file (${raw.actions.length} actions)`);

  const whole = toAFile([TOOL, file, '--log']);
  assert.ok(whole.out.length > 96 * 1024,
    `fixture: the log is far more than a pipe holds (${whole.out.length} bytes)`);
  const tail = whole.out.trimEnd().split('\n').at(-1)!;

  // shut until the tool has long finished printing, as a loaded reader is
  const slow = await throughAShutPipe([TOOL, file, '--log'], 4000);
  assert.equal(slow.out.length, whole.out.length,
    `the slow reader got ${slow.out.length} of ${whole.out.length} bytes — the tool exited with its output still queued`);
  assert.equal(slow.out.trimEnd().split('\n').at(-1), tail, 'and the same last line');
  assert.equal(slow.code, whole.code, 'and the same exit code');
});
