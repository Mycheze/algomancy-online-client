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
 *     See the port-flake fix / CT-85 below — this replaced freePort(), which was the flake.
 *   - gamesDir(): saved rooms live in server/games/, which on the deploy box
 *     is LIVE DATA. rooms.ts already honours ALGO_GAMES_DIR; the tests that
 *     read a saved room back hard-coded server/games/ and so ignored it.
 *     Reading the dir through here lets the runner point the whole suite at a
 *     throwaway directory.
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
 * The port-flake fix / CT-85. There used to be a `freePort()` here. It bound :0, read the
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

/** The environment spawnServer() gives main.ts. `env` is the caller's.
 *
 * The live state (statepaths.ts) defaults to this process's scratch directory
 * — UNDER process.env and the caller's env, so suite.test.ts's per-script
 * directories and a test's own paths still win; see scratchVarDir() for why,
 * and why it is one directory per process.
 *
 * ALGO_LEAGUE_FILE is a fresh throwaway per spawn, OVER process.env: the
 * league's tick moves a live season on by itself, so a test server must never
 * load the real one — even from a script run by hand, outside suite.test.ts.
 * The weekly challenges' sweep likewise WRITES var/challenges/weeks.json
 * whenever a week has closed, so it gets a throwaway directory too. */
export function serverEnv(env: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...scratchStateEnv(),
    ...process.env,
    ALGO_LEAGUE_FILE: join(tmpdir(), `algo-league-${process.pid}-${Math.random().toString(36).slice(2)}.json`),
    ALGO_CHALLENGES_DIR: join(tmpdir(), `algo-challenges-${process.pid}-${Math.random().toString(36).slice(2)}`),
    // docs/22: a Competitive match a test makes is written to a throwaway too
    ALGO_MATCHES_DIR: join(tmpdir(), `algo-matches-${process.pid}-${Math.random().toString(36).slice(2)}`),
    // docs/25: and a cube event, whose 1 s sweep writes its file on every pick
    ALGO_CUBE_DIR: join(tmpdir(), `algo-cube-${process.pid}-${Math.random().toString(36).slice(2)}`),
    ...env, PORT: '0',
  };
}

/** Boot main.ts on an OS-assigned port and resolve once it is listening.
 *
 * `env` is merged over process.env, so a caller can point this server at its
 * own ALGO_GAMES_DIR / ALGO_ACCOUNTS_FILE / ALGO_ISSUES_FILE. Do NOT pass
 * PORT: the point of this helper is that the child chooses. */
export function spawnServer(env: Record<string, string> = {}): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(HERE, '..', 'main.ts')], {
      cwd: join(HERE, '..'),
      env: serverEnv(env),
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

/** THE SPAWNED SERVER NEVER SEES THE LIVE STATE UNLESS A TEST ASKS FOR IT.
 *
 * statepaths.ts falls back to var/ — on the deploy box, the live games, the
 * account store, the reports and the owner's verdicts. spawnServer() used to
 * throw away only the league, the challenges and the matches, so a test that
 * passed no paths (768, run as a unit test, outside suite.test.ts's per-script
 * directories) booted against var/: it RESTORED every saved room before it
 * listened, and could write to the accounts. On the steward's box on
 * 2026-11-06 that was six fetched games, one a 600-action crowded board — 22 s
 * per boot idle, past the 60 s deadline under the gate's load, and the triage
 * branch went red on a test that had nothing to do with it.
 *
 * ONE directory per process, not per spawn: a test that restarts its server
 * (test-postgame, test-clock) must find its rooms again, and gamesDir() below
 * must name the directory the server is writing. */
let scratchVar: string | undefined;
export function scratchVarDir(): string {
  if (scratchVar === undefined) {
    scratchVar = join(tmpdir(), `algo-testvar-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(scratchVar, { recursive: true });
  }
  return scratchVar;
}

/** Every statepaths.ts variable that names live data, pointed at the scratch
 * directory. (ALGO_REPORT_RUNS_FILE follows ALGO_ISSUES_FILE by itself; the
 * league, challenges and matches get their own throwaways in spawnServer.) */
export function scratchStateEnv(): Record<string, string> {
  const d = scratchVarDir();
  return {
    ALGO_GAMES_DIR: join(d, 'games'),
    ALGO_ACCOUNTS_FILE: join(d, 'accounts', 'accounts.json'),
    ALGO_ISSUES_FILE: join(d, 'issues.jsonl'),
    ALGO_VERDICTS_FILE: join(d, 'verdicts.jsonl'),
    ALGO_REPORT_MARKS_FILE: join(d, 'report-marks.jsonl'),
    ALGO_CR_COMMENTS_FILE: join(d, 'cr-comments.jsonl'),
    ALGO_JUDGE_FLAGS_FILE: join(d, 'judge-flags.jsonl'),
    ALGO_OG_CACHE_DIR: join(d, 'og-cache'),
  };
}

/** Where saved rooms land — the directory a spawnServer() with no
 * ALGO_GAMES_DIR of its own writes to, so a test that reads a room file back
 * finds it wherever the run put it. (It used to fall back to server/games/,
 * where nothing has been written since the state moved to var/.) */
export function gamesDir(): string {
  return process.env['ALGO_GAMES_DIR'] ?? scratchStateEnv()['ALGO_GAMES_DIR']!;
}

/** Path of one saved room file. */
export function gameFile(code: string): string {
  return join(gamesDir(), `${code}.json`);
}

/* ── CT-511: waiting on the EVENT, not on a guess at how long it takes ────
 *
 * A test that sleeps 300ms and then reads what the server wrote is right on
 * an idle box and wrong on a loaded one (test 486 read the report journal,
 * which dispute.ts appends ASYNCHRONOUSLY, that way). The deadline here is a
 * failure line, not a wait: the probe passes the moment the thing is true.
 * Same reasoning, and the same override shape, as STARTUP_MS above. */
const WAIT_MS = Number(process.env['ALGO_TEST_WAIT_MS'] ?? 30_000);

/** Poll `probe` until it returns something truthy, and return that. Throws
 * `what` (with the deadline) if it never does. Use it for "the server has
 * written X"; a check that something was NOT written still needs a wait. */
export async function eventually<T>(probe: () => T, what: string, ms = WAIT_MS): Promise<NonNullable<T>> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = probe();
    if (v) return v as NonNullable<T>;
    if (Date.now() >= deadline) throw new Error(`gave up after ${ms}ms waiting for: ${what}`);
    await new Promise(r => setTimeout(r, 25));
  }
}

/** Resolve when the socket is open; REJECT if it errors or closes first.
 * Waiting on 'open' alone hangs the file for ever when the connection fails,
 * which is a hang with no line saying why (CT-511: test 615 hung once). */
export function opened(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((res, rej) => {
    if (ws.readyState !== WebSocket.CONNECTING) { rej(new Error('the socket is already closed')); return; }
    ws.addEventListener('open', () => res(), { once: true });
    ws.addEventListener('error', () => rej(new Error('the socket failed to open')), { once: true });
    ws.addEventListener('close', ev => rej(new Error(`the socket closed before it opened (${(ev as CloseEvent).code})`)), { once: true });
  });
}
