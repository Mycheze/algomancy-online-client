/* Owner's note, 2026-09-28 — SAME-SOURCE TRIGGERS RESOLVE THREE A SECOND.
 *
 *   "QoL: When a stack of triggers from the same source are auto-resolving,
 *    they can resolve 3x per second, rather than just the 1 as normal. This
 *    just makes those moments when something triggers 9 times go slightly
 *    faster."
 *
 * The client spaces a resolution in three places, and all three take the run
 * tempo (PACE_SAME_SOURCE_MS = PACE_MS / 3) when, and only when, the two things
 * being spaced share a `sourceId`:
 *
 *   §1 ui/flash.ts queueFlashes — between flashed items of one group
 *   §2 ui/pace.ts pace()        — between held updates (the caller asks
 *                                  `sameSourceTop` of the view before)
 *   §3 ui/main.ts sendAutoPass  — before the automatic pass
 *
 * Items with no `sourceId` (spells, cards played) are never "the same source",
 * so every mixed or unsourced sequence keeps the one-second tempo that R242
 * (test/218) pins. Nothing a player must answer is held (pace.ts `holdable`),
 * so nothing a player answers gets faster.
 *
 * And the other half of the same round's note on Pass all — the wire message
 * that stops the clock — is pinned at the client end in §4 (the server end is
 * server/e2e/test-passall-clock.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOLD_MS, STAGGER_MS, queueFlashes } from '../flash.ts';
import {
  PACE_MS, PACE_SAME_SOURCE_MS, emptyPace, pace, paceDue, sameSource, sameSourceTop,
} from '../pace.ts';
import type { EngineEvent, StackItem } from '../../engine/src/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = join(HERE, '..');

const item = (id: number, sourceId?: number): StackItem => ({
  id, kind: 'triggered', label: `item ${id}`, controller: 0, region: 0, negated: false, parts: [],
  ...(sourceId !== undefined ? { sourceId } : {}),
});
const flashEv = (id: number, sourceId?: number): EngineEvent =>
  ({ type: 'stackFlash', msg: '', data: { item: item(id, sourceId) } });
const triggeredEv = (): EngineEvent => ({ type: 'triggered', msg: 'a trigger goes on the queue.' });

/** n triggers queued together and drained together (one R189 group) */
const batch = (sources: (number | undefined)[]): EngineEvent[] => [
  ...sources.map(() => triggeredEv()),
  ...sources.map((src, i) => flashEv(i + 1, src)),
];

test('§0 the run tempo is a third of the one tempo, derived and not typed', () => {
  assert.equal(PACE_SAME_SOURCE_MS, Math.round(PACE_MS / 3));
  assert.equal(PACE_SAME_SOURCE_MS, 333);
  const src = readFileSync(join(UI, 'pace.ts'), 'utf8');
  assert.match(src, /export const PACE_SAME_SOURCE_MS = Math\.round\(PACE_MS \/ 3\);/);
  // the three R242 knobs are untouched
  assert.equal(PACE_MS, 1000);
  assert.equal(STAGGER_MS, PACE_MS);
});

test('§0b "same source" needs a source: no sourceId is never a match, even with itself', () => {
  assert.equal(sameSource(item(1, 7), item(2, 7)), true);
  assert.equal(sameSource(item(1, 7), item(2, 8)), false);
  assert.equal(sameSource(item(1), item(2)), false);
  assert.equal(sameSource(item(1), item(1)), false);
  assert.equal(sameSource(item(1, 7), undefined), false);
});

/* ══ §1 flashed items ═══════════════════════════════════════════════════ */

test('§1a nine same-source flashes drain in about three seconds, not nine', () => {
  const q = queueFlashes([], batch(Array(9).fill(42)), 0);
  assert.equal(q.length, 9);
  assert.deepEqual(q.map(f => f.at), Array(9).fill(0), 'still one arrival: "all at once"');
  const departures = q.map(f => f.until);
  const gaps = departures.slice(1).map((u, i) => u - departures[i]!);
  assert.deepEqual(gaps, Array(8).fill(PACE_SAME_SOURCE_MS), 'three a second');
  const drain = departures[8]! - departures[0]!;
  assert.ok(drain < 3000, `the run drains in ${drain}ms`);
  assert.equal(departures[8], HOLD_MS + 8 * PACE_SAME_SOURCE_MS,
    'the last leaves at 3.9s; at the one tempo it left at 9.2s');
  // the next thing after the run waits for it, at the ordinary beat
  const q2 = queueFlashes([], [...batch(Array(9).fill(42)), triggeredEv(), flashEv(99)], 0);
  assert.equal(q2.find(f => f.item.id === 99)!.at, 8 * PACE_SAME_SOURCE_MS + STAGGER_MS);
});

test('§1b mixed sources keep the one-second spacing', () => {
  const q = queueFlashes([], batch([1, 2, 3, 4]), 0);
  assert.deepEqual(q.map(f => f.until), [0, 1, 2, 3].map(i => HOLD_MS + i * STAGGER_MS));
  const next = queueFlashes([], [...batch([1, 2, 3, 4]), triggeredEv(), flashEv(99)], 0);
  assert.equal(next.find(f => f.item.id === 99)!.at, 4 * STAGGER_MS, 'R242 §2e unchanged');
});

test('§1c items with no sourceId keep the one-second spacing', () => {
  const q = queueFlashes([], batch([undefined, undefined, undefined]), 0);
  assert.deepEqual(q.map(f => f.until), [0, 1, 2].map(i => HOLD_MS + i * STAGGER_MS));
});

test('§1d only CONSECUTIVE same-source items speed up', () => {
  // A A B A: the A→A step is a run; A→B and B→A are not
  const q = queueFlashes([], batch([5, 5, 6, 5]), 0);
  const u = q.map(f => f.until);
  assert.deepEqual(u.slice(1).map((x, i) => x - u[i]!), [PACE_SAME_SOURCE_MS, STAGGER_MS, STAGGER_MS]);
});

/* ══ §2 held updates ════════════════════════════════════════════════════ */

test('§2a sameSourceTop: the top two items (the END of the array) share a source', () => {
  assert.equal(sameSourceTop([item(1, 9), item(2, 3), item(3, 3)]), true);
  assert.equal(sameSourceTop([item(1, 3), item(2, 3), item(3, 9)]), false, 'the top is last');
  assert.equal(sameSourceTop([item(1, 3)]), false, 'a lone trigger is not a run');
  assert.equal(sameSourceTop([item(1), item(2)]), false, 'no source, no run');
  assert.equal(sameSourceTop([]), false);
  assert.equal(sameSourceTop(undefined), false);
});

test('§2b nine held same-source resolutions surface three a second', () => {
  const T0 = 50_000;
  let q = emptyPace<string>();
  // the stack before each update: 9, 8, … items from source 4
  for (let i = 0; i < 9; i++) {
    const before = Array.from({ length: 9 - i }, (_, k) => item(k + 1, 4));
    const gap = sameSourceTop(before) ? PACE_SAME_SOURCE_MS : PACE_MS;
    q = pace(q, `u${i}`, T0, true, gap);
  }
  const at = q.queue.map(p => p.at - T0);
  // the first surfaces at once (pace never delays a session's first arrival);
  // seven run steps follow at three a second, and the step whose view holds
  // the run's LAST item is an ordinary beat again
  assert.deepEqual(at, [...Array.from({ length: 8 }, (_, i) => i * PACE_SAME_SOURCE_MS),
    7 * PACE_SAME_SOURCE_MS + PACE_MS]);
  assert.ok(at[7]! < 3000, `eight of nine have surfaced by ${at[7]}ms (one tempo: 7000ms)`);
  assert.equal(paceDue(q, T0 + 3000).out.length, 8);
});

test('§2c the default gap is the one tempo, and a non-held update is never spaced', () => {
  const q = pace(pace(emptyPace<string>(), 'a', 0, true), 'b', 0, true);
  assert.deepEqual(q.queue.map(p => p.at), [0, PACE_MS]);
  const urgent = pace(q, 'c', 0, false, PACE_SAME_SOURCE_MS);
  assert.deepEqual(urgent.queue.map(p => p.at), [0, 0, 0], 'surfacing is still a flush');
});

/* ══ §3 the wiring in ui/main.ts (which a test cannot import) ═════════════ */

const MAIN = readFileSync(join(UI, 'main.ts'), 'utf8');
const fn = (name: string): string => {
  const i = MAIN.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} is in ui/main.ts`);
  return MAIN.slice(i, MAIN.indexOf('\n}\n', i));
};

test('§3a the update gate asks sameSourceTop of the view before, and only for a held update', () => {
  assert.match(MAIN, /const gap = hold && sameSourceTop\(before\?\.stack\) \? PACE_SAME_SOURCE_MS : PACE_MS;/);
  assert.match(MAIN, /this\.paced = pace\(this\.paced, m, Date\.now\(\), hold, gap\);/);
});

test('§3b sendAutoPass waits the run tempo before the pass that resolves a run', () => {
  assert.match(fn('sendAutoPass'),
    /rest \+ \(sameSourceTop\(h\.state\.stack\) \? PACE_SAME_SOURCE_MS : STAGGER_MS\)/);
});

/* ══ §4 Pass all reaches the wire (the clock half of the round) ══════════ */

test('§4 every arm and every disarm tells the server', () => {
  // arming: BEFORE the pass that follows it, so the clock is already stopped
  assert.match(fn('armPass'), /syncPassAll\(\);/);
  // the release list (plan.disarm) and full control
  assert.match(fn('planAutoPass'), /plan\.disarm\) ui\.passMode = null;[\s\S]*syncPassAll\(\);/);
  assert.match(fn('setFullControl'), /ui\.passMode = null;[\s\S]*syncPassAll\(\);/);
  // the ✕ stop
  assert.match(MAIN, /passallstop: \(\) => \{ ui\.passMode = null; cancelAutoPass\(\); syncPassAll\(\); \}/);
  // the arm rides whole, and a join forgets it (the server drops it there too)
  assert.match(MAIN, /t: 'passall', on: true, \.\.\.arm/);
  assert.match(MAIN, /this\.sentPassAll = '';\s+\/\/ the server dropped the standing pass on this join/);
  // a pass says which view it answered, so a late one can be recognised
  assert.match(MAIN, /a\.type === 'passPriority' && this\.state \? \{ at: this\.state\.actionCount \}/);
});
