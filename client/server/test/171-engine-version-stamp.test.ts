/* R200 / CT-66 — VERSION THE SAVED GAMES AGAINST THE ENGINE THAT MADE THEM.
 *
 * The corpus is the project's primary forensic evidence and it is rotting. 20
 * of the 22 saved games diverge on replay; the median replayable prefix is
 * about 30%; a saved game survives roughly three hours of rules work. Every
 * one of those divergences was chased and every one is a DELIBERATE rules
 * change. None is a regression and none is corruption. **The logs are sound;
 * the reader moved** — and a log with no version on it cannot say so.
 *
 * The parts, and what each is guarded by here:
 *
 *   §1  A file says which engine recorded which stretch of it, and a FORKED
 *       file says it more than once. One stamp per file is not enough: a fork
 *       is two games in one file recorded against two engines.
 *   §2  A file that can never be replayed at all is a VERDICT, not a crash and
 *       not a divergence. GAXG and HDGG have been counted as divergences by
 *       every sweep ever run over the corpus; they cannot be fixed by any
 *       amount of rules work, because they never recorded their own deal.
 *   §3  A STALE COPY DOES NOT ERROR — IT REASSURES. A truncated 104-action
 *       copy of a 375-action game reported "✓ FAITHFUL" three times over
 *       several hours, because a prefix of a good log is a good log. Nothing
 *       inside the file can catch that. Only the file it was copied from can.
 *   §4  THE DELTA, which is the part that matters. One replay can only report
 *       a REFUSAL, and a refusal is an UPPER BOUND on the divergence — the
 *       rules move, the action stays legal and quietly means something else,
 *       and the engine only notices actions later. With the recorded commit in
 *       the file there is a reference to diff against, and the divergence can
 *       be MEASURED instead of bounded.
 *
 * ── WHAT THIS FILE MEASURED THAT THE BRIEF DID NOT ────────────────────
 *
 * The first DIFFERENCE is not the finding either. Two engines can part and
 * come back: SMVJ's boards differ from action [99] (a stale `passes` counter
 * the newer engine zeroes), agree again from [111], and only part for good at
 * [120]. Leading with [99] swaps a divergence point measured LATE for one
 * measured EARLY, which is not an improvement. The finding is the index after
 * which they NEVER agree again, and a difference that heals is reported as a
 * rules change the log survived.
 *
 * ⚠ HONEST LIMIT. Versioning only helps from here forward. Every game already
 * on disk was recorded before `engineVersion` existed and can never be given
 * one after the fact; unit tests remain the right answer for those. What this
 * buys is that no game recorded from now on joins them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action, Element } from '../../engine/src/types.ts';
import { fuzzGame } from '../../engine/test/fuzz.ts';
import {
  EXIT, analyze, crossCheck, delta, reportLines, unreplayableLines, unreplayableReason,
  versionsOf, type RoomFile,
} from '../replay-room.ts';
import { probe, signature } from '../replay-probe.ts';
import { UNKNOWN_VERSION, isEngineVersion, repoDir } from '../engine-version.ts';
import { apply, createGame } from '../../engine/src/apply.ts';

/* ── fixtures ────────────────────────────────────────────────────────── */

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

/** a scratch dir of our own, named so nobody else's sweep collides with it */
function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'r27-ct66-'));
}

/** the commit this checkout is sitting on — the reference a game saved TODAY
 * would be stamped with */
function headSha(): string {
  return execFileSync('git', ['-C', repoDir(), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

/**
 * A commit far enough back that the rules have demonstrably moved since.
 *
 * Named rather than computed, because the test below asserts that this diff
 * FINDS something — a silently-chosen commit that happened to change nothing
 * would leave the whole §4 block passing vacuously. If this one ever stops
 * differing the assertion says so out loud instead of going quietly green.
 */
const OLD_ENGINE = 'f1c9957e49723f34674d9bd30021fc2fa2469876';

/** a complete, self-consistent room file, with whatever stamps we ask for */
function roomFile(actions: Action[], versions?: RoomFile['versions']): RoomFile {
  return {
    seed: 7, mode: 'shared', names: ['A', 'B'], actions,
    ...(versions ? { versions } : {}),
  } as RoomFile;
}

let cachedLog: Action[] | null = null;
/** a long, rich, faithful game log grown from the fuzzer — long enough that a
 * rules change lands somewhere inside it */
function longLog(): Action[] {
  if (!cachedLog) cachedLog = fuzzGame(7, 400).actions;
  return cachedLog;
}

/* ═══ §1 — the stamp, and why one is not enough ═══════════════════════ */

test('R200: an unstamped file says so, and says what to do about it — it does not guess a commit', () => {
  const v = versionsOf(roomFile([]));
  assert.equal(v.reference, null, 'a file with no `versions` must NOT be given a reference engine');
  assert.equal(v.stamps.length, 0);
  assert.match(v.why ?? '', /no `versions` stamp/,
    'the reason has to name the missing field, not blame the engine');
  assert.match(v.why ?? '', /--at/, 'and it has to name the escape hatch');
});

test('R200: a forked file is two games against two engines, and the segments say where the join is', () => {
  const actions = new Array(50).fill({ type: 'donePlanning', seat: 0 }) as Action[];
  const v = versionsOf(roomFile(actions, [
    { at: '2026-08-01T00:00:00Z', sha: SHA_A, from: 0 },
    { at: '2026-08-20T00:00:00Z', sha: SHA_B, from: 30 },
  ]));
  assert.deepEqual(v.segments, [
    { from: 0, to: 30, sha: SHA_A },
    { from: 30, to: 50, sha: SHA_B },
  ], 'each stamp covers up to the next one, and the last runs to the end of the log');

  // ⚠ THE REFERENCE IS THE LAST STAMP, NOT THE FIRST. A forked file was
  // rebuilt from action 0 by the LAST engine to restore it — that rebuild is
  // the board the players were sitting in. Replaying at the FIRST stamp
  // reproduces a real game, but not the one this file ends with.
  assert.equal(v.reference, SHA_B, 'the reference engine is the LAST stamp');
  assert.notEqual(v.reference, SHA_A, 'and specifically NOT the first — that is the pre-fork game');
});

test('R200: a fork whose own engineVersion contradicts the stamp covering it is INCONSISTENT', () => {
  const actions = new Array(50).fill({ type: 'donePlanning', seat: 0 }) as Action[];
  const file = roomFile(actions, [
    { at: '2026-08-01T00:00:00Z', sha: SHA_A, from: 0 },
    { at: '2026-08-20T00:00:00Z', sha: SHA_B, from: 30 },
  ]);
  file.forks = [{ at: '2026-08-20T00:00:00Z', logged: 30, lost: [], turn: 3, phase: 'planning', engineVersion: SHA_A }];
  const bad = versionsOf(file);
  assert.equal(bad.inconsistent.length, 1,
    'a fork that names a different engine from the stamp covering it is a contradiction, not a detail');

  // the control: the same file with the fork naming the RIGHT engine
  file.forks[0]!.engineVersion = SHA_B;
  assert.deepEqual(versionsOf(file).inconsistent, [],
    'and a consistent pair must not be flagged, or the check is noise');
});

test('R200: an "unknown" stamp is not a commit, and is refused as a reference rather than looked up', () => {
  const v = versionsOf(roomFile([], [{ at: '', sha: UNKNOWN_VERSION, from: 0 }]));
  assert.equal(v.reference, null, 'a deploy with no git stamps "unknown" — it must not be treated as a SHA');
  assert.match(v.why ?? '', /not a commit/);
  assert.equal(isEngineVersion(UNKNOWN_VERSION), false);
  assert.equal(isEngineVersion(SHA_A), true);
  assert.equal(isEngineVersion(SHA_A.slice(0, 7)), false,
    'an abbreviated SHA is ambiguous over the life of a repo, so the field demands the full name');
});

/* ═══ §2 — permanently unreplayable is NOT a divergence ═══════════════ */

test('R200: a draft file with no recorded trio is UNREPLAYABLE, not diverged — GAXG and HDGG stop being counted', () => {
  const dead = { seed: 1, mode: 'draft' as const, names: ['A', 'B'] as [string, string], actions: [] };
  const why = unreplayableReason(dead);
  assert.ok(why, 'a draft file with no `els` records nothing about what deal it was played from');
  assert.match(why!, /GAXG/, 'and the message names the two files, because that is the next question');
  assert.match(why!, /HDGG/);

  const r = unreplayableLines('GAXG.json', dead, why!);
  assert.equal(r.exit, EXIT.unreplayable,
    'its own exit code, so a corpus sweep can EXCLUDE it instead of counting it as a divergence');
  assert.notEqual(r.exit, EXIT.diverged);
  const text = r.lines.join('\n');
  assert.match(text, /NOT a divergence/);
  assert.match(text, /Exclude it from any count/);

  // the control — a draft file that DOES record its trio must be replayed, not
  // classified away. A refusal that fires on everything protects nothing.
  assert.equal(
    unreplayableReason({ seed: 1, mode: 'draft', els: ['fire', 'water', 'earth'] as Element[], names: ['A', 'B'], actions: [] }),
    null);
  assert.equal(unreplayableReason(roomFile([])), null, 'and a shared game is always replayable');
});

/* ═══ §3 — a stale copy does not error, it reassures ══════════════════ */

test('R200: a truncated copy of a game is caught by the canonical file, and refused rather than replayed', () => {
  const dir = scratch();
  const copyDir = scratch();
  const prev = process.env['ALGO_GAMES_DIR'];
  try {
    process.env['ALGO_GAMES_DIR'] = dir;
    const full = longLog();
    writeFileSync(join(dir, 'STALE.json'), JSON.stringify(roomFile(full)));

    // the copy somebody fetched hours ago, before the game got interesting
    const copy = join(copyDir, 'STALE.json');
    const truncated = roomFile(full.slice(0, 104));
    writeFileSync(copy, JSON.stringify(truncated));

    const check = crossCheck(copy, truncated);
    assert.equal(check.verdict, 'stale');
    assert.match(check.note, /104 actions/, 'it has to say how short the copy is');
    assert.match(check.note, new RegExp(String(full.length)), 'and how long the real one is');

    // and the verdict must outrank a clean replay: this file replays perfectly,
    // which is the entire problem with it
    const an = analyze(truncated);
    assert.equal(an.divergedAt, null, 'a prefix of a good log replays clean — that is why it reassured');
    const rep = reportLines(copy, truncated, an, { source: check });
    assert.equal(rep.exit, EXIT.staleCopy,
      'a ✓ FAITHFUL drawn from the wrong file must not exit 0');
    assert.match(rep.lines.join('\n'), /NOT THE CANONICAL FILE/);

    // THE CONTROL: the same copy, untruncated, must come back clean — or the
    // check above is just "any copy is refused", which would be useless.
    const same = roomFile(full);
    writeFileSync(copy, JSON.stringify(same));
    assert.equal(crossCheck(copy, same).verdict, 'same');
  } finally {
    if (prev === undefined) delete process.env['ALGO_GAMES_DIR']; else process.env['ALGO_GAMES_DIR'] = prev;
    rmSync(dir, { recursive: true, force: true });
    rmSync(copyDir, { recursive: true, force: true });
  }
});

test('R200: when there is no canonical copy to check against, a FAITHFUL verdict says it could not be checked', () => {
  const dir = scratch();
  const prev = process.env['ALGO_GAMES_DIR'];
  try {
    process.env['ALGO_GAMES_DIR'] = join(dir, 'nothing-here');
    const file = roomFile(longLog().slice(0, 104));
    const check = crossCheck(join(dir, 'SOMEWHERE.json'), file);
    assert.equal(check.verdict, 'unchecked');

    const text = reportLines(join(dir, 'SOMEWHERE.json'), file, analyze(file), { source: check }).lines.join('\n');
    assert.match(text, /✓ FAITHFUL/, 'the replay itself really is clean');
    assert.match(text, /could not be checked against a canonical copy/i,
      'but silence next to a ✓ reads as "verified", and this file was never verified');
    assert.match(text, /A truncated copy passes this test/);
  } finally {
    if (prev === undefined) delete process.env['ALGO_GAMES_DIR']; else process.env['ALGO_GAMES_DIR'] = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ═══ §4 — the signature: what a diff is allowed to notice ════════════ */

/**
 * A board with things actually ON it.
 *
 * ⚠ THE FIRST VERSION OF THIS FIXTURE WAS THE DEAL, and the deal has ZERO
 * entities — so the renumbering test below mutated an empty map, the
 * signatures matched for the one reason that has nothing to do with what is
 * being tested, and the red-check refused to go red. The fixture was wrong,
 * not the claim. Anything asserting a property of `entities` has to be handed
 * a state that has some.
 */
function playedBoard(): ReturnType<typeof createGame>['state'] {
  let { state } = createGame(7, ['A', 'B'], 'shared');
  for (const a of longLog()) {
    try { state = apply(state, a).state; } catch { /* the fuzz log is faithful; be tolerant anyway */ }
    if (Object.keys(state.entities).length >= 2) return state;
  }
  throw new Error('the fuzz log never put two entities on the board at once — this fixture is blind');
}

test('R200: the state signature ignores entity IDs — two engines numbering the same board differently is not a rules change', () => {
  const state = playedBoard();
  assert.ok(Object.keys(state.entities).length >= 2,
    'the fixture must have entities to renumber, or this passes for the wrong reason');
  const before = signature(state);
  // renumber every entity and bump the id clock, changing nothing a player
  // could point at
  const renumbered = JSON.parse(JSON.stringify(state)) as typeof state;
  renumbered.nextId += 1000;
  renumbered.entities = Object.fromEntries(
    Object.entries(renumbered.entities).map(([k, e]) => [String(Number(k) + 1000), { ...e, id: e.id + 1000 }]),
  );
  assert.notEqual(JSON.stringify(renumbered.entities), JSON.stringify(state.entities),
    'and the mutation must actually have changed something');
  assert.equal(signature(renumbered), before,
    'ids are the classic false positive: a diff that fires on renumbering fires on every file');
});

test('R200: the state signature notices a DIFFERENT CARD in a zone of the same size — the failure a count sails past', () => {
  const { state } = createGame(7, ['A', 'B'], 'shared');
  const before = signature(state);
  const swapped = JSON.parse(JSON.stringify(state)) as typeof state;
  const hand = swapped.players[0]!.hand;
  assert.ok(hand.length >= 2, 'the fixture needs a hand to swap inside of');
  [hand[0], hand[1]] = [hand[1]!, hand[0]!];
  assert.notEqual(signature(swapped), before,
    'an action that stays legal while drawing a different card is the whole failure this ticket is about');
});

/* ═══ §5 — the delta, end to end ══════════════════════════════════════ */

test('R200: a game saved today replays IDENTICALLY at the engine it was recorded on — stamp, worktree, probe and diff, end to end', async () => {
  const dir = scratch();
  try {
    const sha = headSha();
    const file = join(dir, 'TODAY.json');
    const raw = roomFile(longLog(), [{ at: new Date().toISOString(), sha, from: 0 }]);
    writeFileSync(file, JSON.stringify(raw));

    assert.equal(versionsOf(raw).reference, sha, 'the file names the engine to go and get');
    const d = await delta(file, raw, sha);
    assert.equal(d.error, null, `the reference replay must run: ${d.error}`);
    assert.ok(d.ok);
    assert.equal(d.firstDiff, null,
      'the same log on the same commit must produce the same board at every single action');
    assert.equal(d.partedAt, null);
    assert.deepEqual(d.refRefusals, [],
      'and the engine that recorded a game refuses nothing in it — that is what "recorded against" means');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R200: against an OLDER engine the tool NAMES what changed, and measures the divergence instead of bounding it', async () => {
  const dir = scratch();
  try {
    const file = join(dir, 'THEN.json');
    const raw = roomFile(longLog(), [{ at: '2026-08-23T00:00:00Z', sha: OLD_ENGINE, from: 0 }]);
    writeFileSync(file, JSON.stringify(raw));

    const d = await delta(file, raw, OLD_ENGINE);
    assert.equal(d.error, null, `the reference worktree must spin up: ${d.error}`);
    assert.ok(d.partedAt !== null,
      `the rules must actually have moved between ${OLD_ENGINE.slice(0, 10)} and HEAD for this fixture, or `
      + 'this whole test passes vacuously. If this fires, the fuzz log has drifted or the commit is too '
      + 'recent — pick an older OLD_ENGINE rather than deleting the assertion.');
    assert.ok(d.refSig && d.headSig, 'and it must be able to SAY what changed, not merely that something did');
    assert.notEqual(d.refSig, d.headSig);

    // §the finding is the difference that STICKS. A difference that healed is
    // a rules change this log survived, and starting an investigation at it
    // replaces a point measured late with one measured early.
    assert.ok(d.healed.length > 0,
      'this fixture is chosen because it contains BOTH kinds — a healed difference (the '
      + '"Counter Theif" -> "Counter Thief" rename, which changes one card name and nothing else) '
      + 'and one that sticks. If it stops containing both, the distinction below is untested.');
    assert.ok(d.firstDiff! < d.partedAt!,
      'the first difference is EARLIER than the parting — which is exactly why leading with it would be wrong');

    // and the report leads with the parting, not with the first difference
    const text = reportLines(file, raw, analyze(raw), { delta: d }).lines.join('\n');
    assert.match(text, /THE BOARDS PART FOR GOOD AT ACTION \[\d+\]/);
    assert.match(text, new RegExp(`PART FOR GOOD AT ACTION \\[${d.atAction}\\]`));
    assert.match(text, /HEALED/, 'and it still reports the healed differences, as changes the log survived');
    assert.match(text, /an investigation that starts at the first one starts in the wrong place/);
    assert.match(text, /what changed where they part \(recorded → HEAD\)/,
      'the diff must be PRINTED — a computed delta nobody prints is not a report');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R200: a refusal index is reported as an UPPER BOUND when nothing has measured the real one', async () => {
  // A log with one action corrupted into an illegal one: the current engine
  // refuses it, and with no reference engine that refusal index is all there
  // is. The report must not present it as a measurement.
  const actions = longLog().slice(0, 60).map(a => ({ ...a })) as Action[];
  const victim = actions.findIndex(a => a.type === 'donePlanning');
  assert.ok(victim > 0, 'the fixture needs an action to corrupt');
  actions[victim] = { type: 'activateResource', seat: actions[victim]!.seat, index: 99 } as Action;
  const raw = roomFile(actions);
  const an = analyze(raw);
  assert.ok(an.divergedAt, 'the corrupted action must actually be refused, or this proves nothing');

  const bounded = reportLines('X.json', raw, an, {}).lines.join('\n');
  assert.match(bounded, /UPPER BOUND, not a measurement/);
  assert.match(bounded, /--as-recorded/, 'and it must say how to get a measurement instead');

  // and once a measurement EXISTS and is earlier, the report says the refusal
  // index is late and where to start instead
  const measured = reportLines('X.json', raw, an, {
    delta: {
      sha: SHA_A, ok: true, error: null, firstDiff: 3, partedAt: 3, atAction: 2, healed: [],
      refSig: 'a', headSig: 'b', refSigFirst: null, headSigFirst: null,
      refRefusals: [], headRefusals: [],
    },
  }).lines.join('\n');
  assert.match(measured, /AND THIS INDEX IS LATE/);
  assert.match(measured, /Start at \[2\]/);
  assert.doesNotMatch(measured, /UPPER BOUND, not a measurement/,
    'once it has been measured the tool must stop hedging');
});

test('R200: the probe reports refusals rather than stopping at the first one — a diff needs the whole run', async () => {
  const actions = longLog().slice(0, 60).map(a => ({ ...a })) as Action[];
  const victim = actions.findIndex(a => a.type === 'donePlanning');
  actions[victim] = { type: 'activateResource', seat: actions[victim]!.seat, index: 99 } as Action;
  const p = await probe({ seed: 7, mode: 'shared', names: ['A', 'B'], actions });
  assert.ok(p.ok);
  assert.equal(p.sigs.length, actions.length + 1,
    'one signature per action plus the deal — a refused action repeats the previous board, which is the truth');
  assert.ok(p.refusals.length > 0);
  // ⚠ NOT `refusals.length > 1`: a probe that gave up at the first refusal and
  // then recorded every later action as refused would satisfy that too. What
  // has to be true is that it went on APPLYING — that actions after the first
  // refusal still landed and still moved the board.
  const first = p.refusals[0]!.i;
  const later = p.sigs.slice(first + 2);
  // ⚠ `k > 0` is load-bearing: at k=0 `later[-1]` is undefined and any string
  // is !== undefined, so without it this passes for every possible input —
  // which is exactly how it stayed green under a probe that had been broken on
  // purpose.
  assert.ok(later.some((sig, k) => k > 0 && sig !== later[k - 1]),
    'the board must keep moving after the first refusal — a diff needs the whole run, not a prefix');
  assert.ok(p.refusals.length < actions.length - first,
    'and most actions after the refusal must still have been ACCEPTED, not swept into the refusal list');
});
