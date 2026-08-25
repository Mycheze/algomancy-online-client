/* THE SERVER SUITE — one command that runs every server test, and a ledger
 * that fails when a test file exists but nothing runs it.
 *
 * Why this file exists: server/ has had thirteen assertive test files for
 * months and package.json had `start` and `test-drive`. Nothing ran the rest.
 * The guard for the UZRG playtest report — the owner's "you can't take back
 * making the wrong resource if your opponent does something" — lives in
 * test-new-features.ts under a heading that says so, and had never been run
 * by any command. A guard nobody runs does not guard anything.
 *
 * The server tests are not node:test files and are not being converted: each
 * one spawns the REAL server and drives it over real WebSockets, which is the
 * point of them, and each is still runnable on its own (`node test-clock.ts`)
 * the way it always was. This file is the runner — one node:test case per
 * script, asserting it exits 0 — so the engine's `node --test` convention and
 * the server's spawn-the-real-thing convention can both stay as they are.
 *
 * Everything runs SEQUENTIALLY (node:test runs a file's top-level tests one
 * at a time) against a per-file throwaway ALGO_GAMES_DIR and
 * ALGO_ACCOUNTS_FILE. That matters: server/games/ and server/accounts/ are
 * live data on the deploy box, and `npm test` has to be safe to run there.
 *
 * There is no `test:integration` split. Eleven of the thirteen bind a port,
 * so splitting on "binds a port" would leave `npm test` running two files and
 * reintroduce exactly the problem this fixes. The whole suite is ~35s.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 180_000;

/** Every test script `npm test` runs, with what it is the guard for. */
const SUITE: { file: string; covers: string }[] = [
  { file: 'test-hidden.ts',
    covers: 'hidden simultaneous segments in-process: freeze / holdback / reveal / undo for the resource step, the haste step and deployment' },
  { file: 'test-undo-segment.ts',
    covers: 'ledger #76/#37: the take-back inside a hidden segment — undo walks all the way back to the start of the phase with the opponent acting throughout, the splice renumbers the surviving log rather than refusing, and the measurement still catches a move that would change meaning' },
  { file: 'test-forensics.ts',
    covers: 'saved logs as a forensic record: replay onto a changed engine, the skip cascade, fork records, undo never eating a move' },
  { file: 'test-drive.ts',
    covers: 'the M2 core: redaction as a running invariant on every pushed view, event redaction, seat authority, reconnect resync' },
  { file: 'test-new-features.ts',
    covers: 'join / rename / seat takeover / undo — and THE UZRG REPORT: the resource step is hidden and your undo survives the opponent acting' },
  { file: 'test-concede.ts',
    covers: 'R65 concede: a real Action, reaches the opponent, decides the game, is stamped into the saved room, refused when not yours' },
  { file: 'test-trio.ts', covers: 'element trio over the wire: creation, persistence, joiners inherit it, junk sanitises' },
  { file: 'test-building.ts', covers: 'the live formation relay: never a game action, never logged, dropped on a real action' },
  { file: 'test-draft.ts', covers: 'live-draft rooms: pack redaction, draftCommit, pack passing, undo, persistence' },
  { file: 'test-constructed.ts', covers: 'constructed rooms: default/imported decks, the waiting room, per-seat decks, bottoming, persistence' },
  { file: 'test-lobby.ts', covers: 'the draft lobby: trio methods, and a draft room dealing no cards until both players lock in' },
  { file: 'test-clock.ts', covers: 'chess clock, POST /api/report to issues.jsonl, and draft packInfo' },
  { file: 'test-accounts.ts', covers: 'accounts: the stat fold, achievements, friends, passwords, claiming past games, and the seat/account binding over a socket' },
  { file: 'test-postgame.ts', covers: 'the post-game payload and the rematch handshake, from a saved decided game' },
  { file: 'test-view-snapshot.ts',
    covers: "R85: the suspension's rollback snapshot — a whole unredacted GameState — never reaches a client, not even the seat whose decision it is" },
  { file: 'test-concurrency.ts',
    covers: "R150/CT-32 (playtest #98): one seat's pending decision inside a hidden simultaneous segment must not freeze the other seat's deployment — the diagnosis (apply.ts's global decision gate), legalForSeat's narrow un-gating, the deferral round trip, its bounds, and the privacy properties it must not break" },
  { file: 'test-formation-decision.ts',
    covers: "BL-24: both formation asks (R75 resolve-time, R29 cast-time) reach the asked seat intact over viewFor + legalActions as kind 'formationSlot', with the decide answers offered, and redact to nothing for the opponent" },
];

/** Files that match the test-file naming but are NOT test scripts. Each needs
 * a reason, and the ledger below fails if one stops being true. */
const NOT_A_TEST: { file: string; reason: string }[] = [
  { file: 'test-util.ts', reason: 'shared helper (mintRoom / freePort / gameFile) — exports only, no assertions, no main' },
];

/** Run one test script to completion; resolve with its exit code and output. */
function runScript(file: string): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    // a throwaway games dir, accounts file and issues file per script:
    // server/games/, server/accounts/ and server/issues.jsonl are all live
    // data on the deploy box. issues.jsonl is the one with no other copy
    // anywhere — every playtest report the owner has ever filed — so it gets
    // the same treatment rather than being protected by a save-and-restore
    // inside the one test that writes to it.
    const scratch = mkdtempSync(join(tmpdir(), 'algo-suite-'));
    const child = spawn(process.execPath, [join(HERE, file)], {
      cwd: HERE,
      env: {
        ...process.env,
        ALGO_GAMES_DIR: join(scratch, 'games'),
        ALGO_ACCOUNTS_FILE: join(scratch, 'accounts.json'),
        ALGO_ISSUES_FILE: join(scratch, 'issues.jsonl'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => {
      out += `\n[suite] no exit after ${TIMEOUT_MS / 1000}s — killed\n`;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.on('exit', code => {
      clearTimeout(timer);
      rmSync(scratch, { recursive: true, force: true });
      resolve({ code: code ?? -1, out });
    });
  });
}

for (const { file, covers } of SUITE) {
  test(`${file} — ${covers}`, async () => {
    const { code, out } = await runScript(file);
    // the scripts print their own ✓/✗ lines; surface them only when it matters
    assert.equal(code, 0, `${file} exited ${code}\n${out}`);
  });
}

// ── THE LEDGER ───────────────────────────────────────────────────────────
// The deeper failure was not that one test rotted — it was that a whole
// directory of tests could sit unrun for months and nothing said a word. So:
// every test-shaped file on disk is either in SUITE (and therefore runs) or
// in NOT_A_TEST with a reason, and this fails both ways round — an unlisted
// file, and a listed file that no longer exists.

test('ledger: every test file in server/ is run by npm test, or says why not', () => {
  const onDisk = readdirSync(HERE)
    .filter(f => (/^test-.*\.ts$/.test(f) || /\.test\.ts$/.test(f)) && f !== 'suite.test.ts')
    .sort();
  const listed = [...SUITE.map(e => e.file), ...NOT_A_TEST.map(e => e.file)].sort();

  const unlisted = onDisk.filter(f => !listed.includes(f));
  assert.deepEqual(unlisted, [],
    `test files nothing runs — add them to SUITE in suite.test.ts (or to NOT_A_TEST with a reason):\n  ${unlisted.join('\n  ')}`);

  const missing = listed.filter(f => !onDisk.includes(f));
  assert.deepEqual(missing, [],
    `ledger entries for files that no longer exist — drop them:\n  ${missing.join('\n  ')}`);

  // no duplicates, and the two lists must not overlap
  assert.equal(new Set(listed).size, listed.length, 'a file is listed twice in the ledger');
});

test('ledger: package.json still points npm test at this file', () => {
  const pkg = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')) as
    { scripts?: Record<string, string> };
  const script = pkg.scripts?.['test'] ?? '';
  assert.match(script, /suite\.test\.ts/,
    `server/package.json's "test" script is "${script}" — it no longer runs suite.test.ts, so the ledger above guards nothing`);
});
