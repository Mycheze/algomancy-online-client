/* Shared helpers for the server integration tests.
 *
 * They each spawn the real server and drive it over raw WebSockets (no test
 * framework, on purpose), and each used to invent its own room code — which
 * worked only while joining was get-or-create. Creating a room is now the
 * privilege of a code the server minted (rooms.ts), so a test that wants a
 * room asks for one exactly the way the New-game button does.
 *
 * Two more helpers exist because the suite now runs unattended from
 * `npm test` (suite.test.ts) rather than one file at a time by hand:
 *
 *   - freePort(): the tests used to guess `8500 + random(400)` and hope. On a
 *     busy machine that is a coin flip, and a suite that runs on every change
 *     must not flake — so ask the OS for a port nobody holds.
 *   - gamesDir(): saved rooms live in server/games/, which on the deploy box
 *     is LIVE DATA. rooms.ts already honours ALGO_GAMES_DIR; the tests that
 *     read a saved room back hard-coded server/games/ and so ignored it.
 *     Reading the dir through here lets the runner point the whole suite at a
 *     throwaway directory.
 */
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Ask the server for a fresh room code, reserved and ready to be created. */
export async function mintRoom(port: number): Promise<string> {
  const res = await fetch(`http://localhost:${port}/api/new`);
  if (!res.ok) throw new Error(`/api/new failed: ${res.status}`);
  const { code } = await res.json() as { code: string };
  if (!code) throw new Error('/api/new returned no code');
  return code;
}

/** A port the OS says is free right now. Bind :0, read the number back, let
 * it go — a tiny race with anything else grabbing it in the same millisecond,
 * but a far smaller one than picking at random out of a 400-wide range that
 * three other test files also pick out of. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no port'))));
    });
  });
}

/** Where saved rooms land — the same resolution rooms.ts and main.ts use, so
 * a test that reads a room file back finds it wherever the run put it. */
export function gamesDir(): string {
  return process.env['ALGO_GAMES_DIR'] ?? join(HERE, 'games');
}

/** Path of one saved room file. */
export function gameFile(code: string): string {
  return join(gamesDir(), `${code}.json`);
}
