/* BL-38 §3 — THE REPLAY SERVER: the same board, from either end of the log.
 *
 * `ui/replayserver.ts` is the third implementation of the `openSocket` seam,
 * after the real server and `ui/solo.ts`. It holds a saved log and a cursor and
 * pushes the board at the cursor as a `watching` frame, which means the whole
 * board renderer draws a replay without knowing it is one.
 *
 * Three things can go wrong here and only one of them is obvious.
 *
 * THE CHECKPOINTS. Stepping back rewinds to the nearest checkpoint and walks
 * forward, because replaying from zero on every ◀ is quadratic in the log. That
 * is an optimisation over a pure function, which is the classic place for a
 * board to come back subtly different — a missed `structuredClone`, a segment
 * snapshot that kept a reference, an events array truncated to the wrong
 * length. §1 and §2 compare against the only thing worth comparing against: a
 * fresh server that only ever went forwards.
 *
 * THE PERSPECTIVE. Bena asked for "what I saw while playing", which is not the
 * same as "the board minus their hand" — the hidden simultaneous steps were
 * frozen while you were inside them, and a replay that quietly unfroze them
 * would narrate, in the log, the deployment you could not see while making
 * yours. §3–§5.
 *
 * THE MESSAGE TYPE. `watching` and `update` are not interchangeable: an
 * `update` goes through pace.ts's one-second hold, so a replay asking for three
 * actions a second would get one. §6 is a one-line assertion standing in for a
 * bug that would present as "the speed control does nothing".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzGame } from '../../engine/test/fuzz.ts';
import { ReplayServer, type ReplayFile } from '../replayserver.ts';

/* ── a real game to replay ───────────────────────────────────────────── */

const FUZZ = fuzzGame(11, 260);
const FILE: ReplayFile = {
  seed: 11,
  mode: 'shared',
  names: ['Alice', 'Bob'],
  actions: FUZZ.actions,
};

assert.ok(FILE.actions.length > 80, `wanted a long log, got ${FILE.actions.length}`);

/**
 * The latest action at which BOTH seats are holding something.
 *
 * SEARCHED, never pinned. A pinned index is the classic way a suite here goes
 * red for no reason: one added legal action re-rolls every fuzz walk, and a
 * moment that had two full hands becomes a moment that has one. The assertions
 * below are about redaction, not about action 40, so they should not be able to
 * fail because the walk moved. (The non-vacuity guard is what caught this — the
 * first draft pinned 40, and at 40 seat 1 is empty-handed.)
 */
function bothHandsAt(): number {
  const probe = new ReplayServer(FILE, 0, true);
  let best = -1;
  for (let n = 0; n <= FILE.actions.length; n++) {
    probe.seek(n);
    const p = (probe.view() as unknown as { players: { hand: string[] }[] }).players;
    if (p[0]!.hand.length > 0 && p[1]!.hand.length > 0) best = n;
  }
  assert.ok(best > 0, 'no moment in this game has both seats holding cards');
  return best;
}

/** a server that has only ever gone forwards — the reference for §1/§2 */
function walkedTo(n: number, omniscient = true): ReplayServer {
  const s = new ReplayServer(FILE, 0, omniscient);
  for (let i = 0; i < n; i++) s.step();
  return s;
}

const board = (s: ReplayServer): string => JSON.stringify(s.view());

/* ══ the checkpoints ══════════════════════════════════════════════════ */

test('BL-38 §1 seeking forward lands where walking forward lands', () => {
  for (const n of [0, 1, 24, 25, 26, 50, 77, FILE.actions.length]) {
    const seek = new ReplayServer(FILE, 0, true);
    seek.seek(n);
    assert.equal(seek.at, n);
    assert.equal(board(seek), board(walkedTo(n)), `seek(${n}) differs from ${n} steps`);
  }
});

test('BL-38 §2 stepping BACK reconstructs the board exactly', () => {
  const s = new ReplayServer(FILE, 0, true);
  s.seek(FILE.actions.length);

  // walk all the way back one action at a time, checking every board on the
  // way — this is the path a held-down ◀ takes, and the one the checkpoints
  // are an optimisation of
  for (let n = FILE.actions.length - 1; n >= 0; n--) {
    s.seek(n);
    assert.equal(s.at, n);
    assert.equal(board(s), board(walkedTo(n)),
      `after rewinding to ${n} the board is not the board at ${n}`);
  }

  // …and forward again, to catch a rewind that corrupted the state it left
  for (const n of [13, 40, 61, 99]) {
    if (n > FILE.actions.length) continue;
    s.seek(n);
    assert.equal(board(s), board(walkedTo(n)), `re-seek to ${n} after a full rewind`);
  }
});

test('BL-38 §2b the log rewinds with the board', () => {
  const s = new ReplayServer(FILE, 0, true);
  s.seek(60);
  const long = s.log().length;
  s.seek(20);
  const short = s.log().length;
  assert.ok(short < long, 'a rewound replay still narrating the future has not rewound');
  assert.deepEqual(s.log(), walkedTo(20).log(),
    'the events array was truncated to the wrong length');
});

/* ══ perspective ══════════════════════════════════════════════════════ */

test('BL-38 §3 from a seat, the other hand is backs; omniscient, it is cards', () => {
  const at = bothHandsAt();
  const mine = new ReplayServer(FILE, 0, false);
  const all = new ReplayServer(FILE, 0, true);
  mine.seek(at); all.seek(at);

  const hidden = (v: unknown, seat: 0 | 1): string[] =>
    (v as { players: { hand: string[] }[] }).players[seat]!.hand;

  assert.ok(hidden(mine.view(), 1).length > 0, 'non-vacuous: they are holding something');
  assert.ok(hidden(mine.view(), 1).every(c => c === '__HIDDEN__'),
    'seat 0 can read seat 1\'s hand — the replay is not showing what seat 0 saw');
  assert.ok(hidden(mine.view(), 0).some(c => c !== '__HIDDEN__'),
    '…and their own hand came back face-up');
  assert.ok(hidden(all.view(), 1).some(c => c !== '__HIDDEN__'),
    'the eye toggle did not open the other hand');
});

test('BL-38 §4 the toggle is live — the same server answers both ways', () => {
  const s = new ReplayServer(FILE, 0, false);
  s.seek(bothHandsAt());
  const seatView = board(s);
  s.omniscient = true;
  const allView = board(s);
  assert.notEqual(seatView, allView, 'flipping the toggle changed nothing');
  s.omniscient = false;
  assert.equal(board(s), seatView, 'and flipping it back did not come home');
});

test('BL-38 §5 a seat\'s log is redacted; omniscient is every line', () => {
  const mine = new ReplayServer(FILE, 0, false);
  const all = new ReplayServer(FILE, 0, true);
  mine.seek(FILE.actions.length); all.seek(FILE.actions.length);
  assert.ok(all.log().length >= mine.log().length,
    'a seat cannot see MORE than an omniscient watcher');
  assert.notDeepEqual(all.log(), mine.log(),
    'non-vacuous: the two logs must actually differ somewhere in a real game');
});

/* ══ the wire ═════════════════════════════════════════════════════════ */

test('BL-38 §6 frames are `watching`, never `update` — pace.ts holds an update for a second', async () => {
  const s = new ReplayServer(FILE, 0, false);
  const seen: string[] = [];
  const sock = s.socket();
  sock.onmessage = ev => { seen.push((JSON.parse(ev.data) as { t: string }).t); };
  sock.send(JSON.stringify({ t: 'watch' }));
  s.seek(10);
  s.seek(11);
  await new Promise(r => queueMicrotask(() => queueMicrotask(() => r(null))));
  assert.ok(seen.length >= 2, `nothing was delivered (${seen.length} frames)`);
  assert.ok(seen.every(t => t === 'watching'),
    'an `update` frame goes through pace.ts\'s PACE_MS hold, so a replay asking '
    + 'for 3 actions a second would be served one. The speed control would '
    + 'silently do nothing.');
});

test('BL-38 §7 a client action is ignored — there is nothing to act on', () => {
  const s = new ReplayServer(FILE, 0, false);
  s.seek(10);
  const before = board(s);
  s.receive(JSON.stringify({ t: 'action', action: FILE.actions[0] }));
  assert.equal(board(s), before, 'a replay accepted a move');
  assert.equal(s.at, 10);
});

test('BL-38 §8 a scenario room is refused by name, not dealt a plain board', () => {
  assert.throws(
    () => new ReplayServer({ ...FILE, scenario: 'some-scenario' }, 0, true),
    /scenario/,
    'dealing a plain board under a log written for a scenario reports every '
    + 'action as a divergence — the exact false answer R200 exists to prevent',
  );
});
