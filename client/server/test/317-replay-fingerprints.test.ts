/* BL-38 §1 — THE BOARD FINGERPRINT, AND WHY IT IS A RECORD AND NOT A DERIVATION.
 *
 * A saved game is `seed` + an action log. Everything else about it — what each
 * action meant, which ids it allocated, what the board looked like afterwards —
 * has always been recovered by replaying the log on whatever engine happens to
 * be asking. That works exactly as long as the engine has not moved.
 *
 * It has moved, repeatedly, and the failure it produces is SILENT. Room KAWJ
 * (2026-09-16, R295) replayed 253 of 253 actions, refused nothing, reported
 * ✓ FAITHFUL, and arrived at a different final life total: R295 had added a
 * priority window, and the log's old `passPriority` actions were consumed by
 * the new window instead of the one they were taken for. Nothing DERIVED from
 * the log can see that, because the log is not the thing that changed. A
 * refusal count is an upper bound on a divergence and KAWJ's upper bound was
 * zero.
 *
 * So `rooms.ts` now writes down what the board looked like after each action,
 * as the action is applied, by the engine applying it. The viewer BL-38 builds
 * compares its own replay against that record and can name the exact index at
 * which it stopped being the same game.
 *
 * The whole value of that rests on ONE property, and it is the property a
 * future maintainer is most likely to optimise away, because every other
 * per-action array in `Room` behaves the opposite way:
 *
 *   ⚠ A RECORDED FINGERPRINT IS NEVER RECOMPUTED.
 *
 * `assignRebuild` replaces `segRefs`, `segTouched` and `segIdFloor` wholesale
 * on every rebuild — that is correct, they are derivations. Doing the same to
 * `sigs` would overwrite the record with today's answer at precisely the moment
 * the two disagree, which is the moment the record exists for, and it would do
 * it without printing anything. §3 is the guard that fails if anybody ever
 * does, and it is deliberately written as "the file's value wins even when the
 * file's value is nonsense", because a test that only checks agreement cannot
 * tell a preserved record from a recomputed one.
 *
 *   §1  a played game records one fingerprint per action, and persists them
 *   §2  the record round-trips a restore unchanged
 *   §3  a RECORDED entry beats the rebuilding engine's own answer
 *   §4  a pre-BL-38 file is filled in, not rejected, and stays aligned
 *   §5  an undo rewrites the tail and keeps the prefix
 *   §6  a mismatch names the FIRST index that differs — the thing a refusal
 *       count could not have told you
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legalActions } from '../../engine/src/apply.ts';
import type { Room } from '../rooms.ts';

/** A games dir of our own. The suite has to be safe to run on the deploy box,
 * where var/games is live — statepaths.ts reads the env var on every call for
 * exactly this reason, so setting it before the import is enough. */
function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'bl38-sigs-'));
}

/**
 * A fresh copy of rooms.ts pointed at `dir`.
 *
 * Imported through a cache-busting query so that each case gets its own room
 * registry: `restoreRooms()` populates a module-level Map, and a second call in
 * the same module would find the room already there and tell us nothing about
 * what came off disk.
 */
async function roomsAt(dir: string): Promise<typeof import('../rooms.ts')> {
  process.env['ALGO_GAMES_DIR'] = dir;
  return import(`../rooms.ts?bl38=${Math.random()}`) as Promise<typeof import('../rooms.ts')>;
}

/** Walk a real game forward, taking the first legal action each time. Any
 * sequence of real actions will do — what is under test is the bookkeeping. */
function play(mod: typeof import('../rooms.ts'), room: Room, n: number): void {
  for (let i = 0; i < n; i++) {
    if (room.state.winner !== null) return;
    const legal = [...legalActions(room.state, 0), ...legalActions(room.state, 1)];
    if (!legal.length) return;
    mod.applyToRoom(room, legal[0]!);
  }
}

const FINGERPRINT = /^[0-9a-f]{16}$/;

test('BL-38 §1 a played game records one fingerprint per action, and writes them down', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const room = mod.createRoom('SIG1', 4242, ['A', 'B'], 'shared');
    play(mod, room, 60);

    assert.ok(room.actions.length >= 20, `wanted a real game, got ${room.actions.length} actions`);
    assert.equal(room.sigs.length, room.actions.length,
      'the record is indexed BY ACTION — a length that does not match cannot be');
    for (const [i, s] of room.sigs.entries()) {
      assert.match(s, FINGERPRINT, `sigs[${i}] is not a fingerprint`);
    }

    const file = JSON.parse(readFileSync(join(dir, 'SIG1.json'), 'utf8')) as { sigs?: string[]; actions: unknown[] };
    assert.equal(file.sigs?.length, file.actions.length,
      'persisted, and persisted whole — a partial record that reads as a complete one is worse than none');
    assert.deepEqual(file.sigs, room.sigs);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('BL-38 §2 the record round-trips a restore unchanged', async () => {
  const dir = scratch();
  try {
    const one = await roomsAt(dir);
    const room = one.createRoom('SIG2', 909, ['A', 'B'], 'shared');
    play(one, room, 50);
    const recorded = [...room.sigs];

    const two = await roomsAt(dir);
    two.restoreRooms();
    const back = two.getRoom('SIG2');
    assert.ok(back, 'the room did not come back off disk at all');
    assert.deepEqual(back.sigs, recorded,
      'a restore re-derives everything else about the log and must leave this alone');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('BL-38 §3 a RECORDED fingerprint beats the rebuilding engine — this is the whole feature', async () => {
  const dir = scratch();
  try {
    const one = await roomsAt(dir);
    const room = one.createRoom('SIG3', 31337, ['A', 'B'], 'shared');
    play(one, room, 40);
    const path = join(dir, 'SIG3.json');
    const file = JSON.parse(readFileSync(path, 'utf8')) as { sigs: string[] };

    // Stand in for "the rules moved since this game": the file says one thing
    // about action [10] and this engine's replay says another. A value no
    // engine would ever produce is used on purpose — it cannot be arrived at
    // by accident, so a pass here can only mean the file's value was KEPT.
    const TAMPERED = 'deadbeefdeadbeef';
    const engineWouldSay = file.sigs[10]!;
    assert.notEqual(engineWouldSay, TAMPERED);
    file.sigs[10] = TAMPERED;
    writeFileSync(path, JSON.stringify(file));

    const two = await roomsAt(dir);
    two.restoreRooms();
    const back = two.getRoom('SIG3')!;
    assert.equal(back.sigs[10], TAMPERED,
      'the restore recomputed a recorded fingerprint. That silently destroys the only '
      + 'evidence a saved game carries about the game it actually was, at the exact '
      + 'moment the evidence starts to matter. See Room.sigs.');
    assert.deepEqual(back.sigs.slice(11), file.sigs.slice(11),
      'and it must not have disturbed anything after it either');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('BL-38 §4 a file that predates the record gets EMPTY slots, never invented ones', async () => {
  // ⚠ THE FAILURE THIS GUARDS IS THE ONE THAT WOULD HAVE SHIPPED.
  //
  // The first version of `sanitizeSigs` filled a gap with the rebuilding
  // engine's own answer. That is the best guess available and on an unmoved
  // engine it is even right — and it is then PERSISTED, so the file ends up
  // carrying a full set of fingerprints computed after the fact. The next
  // replay compares today's answer against today's answer, matches, and
  // reports `as-recorded`: "this is the game that was played", about a game
  // nothing ever verified.
  //
  // Every live room on the deploy box predates this field, and the restart
  // that ships it restores all of them — so the feature would have begun
  // lying on the very deploy that introduced it.
  const dir = scratch();
  try {
    const one = await roomsAt(dir);
    const room = one.createRoom('SIG4', 5150, ['A', 'B'], 'shared');
    play(one, room, 40);
    const path = join(dir, 'SIG4.json');
    const file = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const invented = [...(file['sigs'] as string[])];

    // every game played before BL-38 landed looks like this
    delete file['sigs'];
    writeFileSync(path, JSON.stringify(file));

    const two = await roomsAt(dir);
    two.restoreRooms();
    const back = two.getRoom('SIG4')!;
    assert.equal(back.sigs.length, back.actions.length,
      'an array that cannot be indexed by action is not a record of anything');
    assert.ok(back.sigs.every(x => x === ''),
      'the restore INVENTED fingerprints for a game that never recorded any. On this '
      + 'engine they are even correct, which is exactly why it is dangerous: they get '
      + 'persisted, and the next replay reads them back as a record and says as-recorded.');
    assert.notDeepEqual(back.sigs, invented, 'non-vacuous: there really was an answer to invent');

    // …and the file must not gain a record it never had
    const after = JSON.parse(readFileSync(path, 'utf8')) as { sigs?: string[] };
    assert.ok(!after.sigs || after.sigs.every(x => !x),
      'the restore wrote fabricated fingerprints back to disk');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('BL-38 §5 an undo rewrites the tail and keeps the prefix', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const room = mod.createRoom('SIG5', 8080, ['A', 'B'], 'shared');
    play(mod, room, 40);
    const before = [...room.sigs];
    const n = room.actions.length;

    // find something the undo gate will actually let go of
    let undone = -1;
    for (let i = n - 1; i >= 0 && undone < 0; i--) {
      if (mod.undoActionAt(room, i).length === 0) undone = i;
    }
    assert.ok(undone >= 0, 'no action in this game could be undone — the case is untested');

    assert.equal(room.sigs.length, room.actions.length, 'still indexed by action after a splice');
    assert.deepEqual(room.sigs.slice(0, undone), before.slice(0, undone),
      'the actions BEFORE the splice were applied to boards that did not move, '
      + 'so their record is still true and must survive');
    for (const s of room.sigs.slice(undone)) assert.match(s, FINGERPRINT);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('BL-38 §6 a mismatch names the FIRST index that differs', async () => {
  const dir = scratch();
  try {
    const one = await roomsAt(dir);
    const room = one.createRoom('SIG6', 6161, ['A', 'B'], 'shared');
    play(one, room, 40);
    const recorded = [...room.sigs];

    // Two entries differ. The finding is the FIRST one: from there on the
    // replay is running a board the recorded game never had, so a later
    // difference is cascade and not a second finding — the same rule
    // replay-room.ts's §R169 report is built on.
    const replayed = [...recorded];
    replayed[12] = 'f'.repeat(16);
    replayed[30] = 'e'.repeat(16);

    let parted = -1;
    for (let i = 0; i < recorded.length && parted < 0; i++) {
      if (recorded[i] && replayed[i] !== recorded[i]) parted = i;
    }
    assert.equal(parted, 12);
    assert.notEqual(parted, 30, 'reporting the LAST difference would point past the cause');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
