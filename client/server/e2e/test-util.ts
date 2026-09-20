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
 *   - spawnServer(): boots the real server and tells you what port it got.
 *     See R204 / CT-85 below — this replaced freePort(), which was the flake.
 *   - gamesDir(): saved rooms live in server/games/, which on the deploy box
 *     is LIVE DATA. rooms.ts already honours ALGO_GAMES_DIR; the tests that
 *     read a saved room back hard-coded server/games/ and so ignored it.
 *     Reading the dir through here lets the runner point the whole suite at a
 *     throwaway directory.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
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

/* ── booting the server under test ──────────────────────────────────────
 *
 * R204 / CT-85. There used to be a `freePort()` here. It bound :0, read the
 * assigned number back, CLOSED the socket, and returned the bare number; the
 * caller then spawned main.ts with PORT=<that number>. Between the close and
 * the child's bind, the port belongs to nobody, and anything else on the box
 * may take it — which is exactly what happened when a dozen agents each ran
 * this suite at once. The docstring called that "a tiny race". Under real
 * concurrency it is not tiny: it is the whole bug, and it surfaced as
 * ECONNREFUSED (the child died on EADDRINUSE) in a *different* test each run.
 *
 * The window closes only if the process that will USE the port is the one
 * that binds it. So: spawn main.ts with PORT=0, let the OS assign, and read
 * the number back out of the server's own ready line. Nobody ever holds a
 * port they are not listening on.
 *
 * The same call also fixes the second half of the flake. The old shape was
 * copy-pasted into eleven files, and the copies had drifted: most waited for
 * the ready line, one (test-building.ts) just slept 1200ms and hoped, and one
 * (test-postgame.ts) forgot to reject when the child died, so a bind failure
 * showed up 15 seconds later as a bare timeout with no cause. One helper, one
 * behaviour: wait for the real line, fail loudly with the child's output when
 * the child dies, and hold the deadline in one place.
 */

/** stdio is ['ignore','pipe','pipe'] below, so: no stdin, both outputs piped. */
type ServerProc = ChildProcessByStdio<null, Readable, Readable>;

/** A running server under test. `port` is what the OS actually gave it. */
export interface ServerHandle {
  proc: ServerProc;
  port: number;
  /** Kill it and wait for the exit, so a restart cannot overlap the old one. */
  stop(): Promise<void>;
}

/** How long to wait for the ready line. Generous on purpose: this deadline is
 * measured on a machine that may be running fifteen other agents, and a
 * too-tight startup deadline is the same class of bug as the port race — a
 * number that is fine on an idle box and wrong under load. Override with
 * ALGO_TEST_STARTUP_MS if you are debugging a genuinely stuck boot. */
const STARTUP_MS = Number(process.env['ALGO_TEST_STARTUP_MS'] ?? 60_000);

/** Boot main.ts on an OS-assigned port and resolve once it is listening.
 *
 * `env` is merged over process.env, so a caller can point this server at its
 * own ALGO_GAMES_DIR / ALGO_ACCOUNTS_FILE / ALGO_ISSUES_FILE. Do NOT pass
 * PORT: the point of this helper is that the child chooses. */
export function spawnServer(env: Record<string, string> = {}): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(HERE, '..', 'main.ts')], {
      cwd: join(HERE, '..'),
      env: { ...process.env, ...env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as ServerProc;

    // buffered, because the ready line can arrive split across chunks and
    // because the child's output is the only evidence when it dies early
    let out = '';
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => finish(() => {
      proc.kill('SIGKILL');
      reject(new Error(`server did not start within ${STARTUP_MS}ms\n${out}`));
    }), STARTUP_MS);

    const onData = (d: Buffer): void => {
      if (settled) return;   // don't accumulate the whole run's chatter
      out += String(d);
      // main.ts prints "Algomancy server on http://localhost:<port>"
      const m = /Algomancy server on http:\/\/localhost:(\d+)/.exec(out);
      if (!m) return;
      const port = Number(m[1]);
      finish(() => resolve({
        proc,
        port,
        stop: () => new Promise<void>(res => {
          if (proc.exitCode !== null || proc.signalCode !== null) return res();
          proc.once('exit', () => res());
          proc.kill();
        }),
      }));
    };
    proc.stdout.on('data', onData);
    // stderr was `inherit` in the eleven hand-rolled copies of this; keep it
    // visible (a server stack trace is the thing you want when a test hangs)
    // and also capture it before startup, so `server died on startup` says why
    proc.stderr.on('data', (d: Buffer) => {
      if (!settled) out += String(d);
      process.stderr.write(d);
    });
    proc.on('error', err => finish(() => reject(err)));
    proc.on('exit', code => finish(() => {
      reject(new Error(`server died on startup (exit ${code})\n${out}`));
    }));
  });
}

/** Where saved rooms land — the same resolution rooms.ts and main.ts use, so
 * a test that reads a room file back finds it wherever the run put it. */
export function gamesDir(): string {
  return process.env['ALGO_GAMES_DIR'] ?? join(HERE, '..', 'games');
}

/** Path of one saved room file. */
export function gameFile(code: string): string {
  return join(gamesDir(), `${code}.json`);
}
