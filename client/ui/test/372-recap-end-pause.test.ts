/* Report #193 (2026-10-04) — THE RECAP PAUSES BEFORE IT HANDS OVER.
 *
 * The owner: "The deployment recap/replay should have a slightly longer delay
 * before going right to the next turn and putting the drawn cards/pack on
 * screen. Just to make it easier to follow and process."
 *
 * A playback (ui/main.ts playbackSteps) is its frames and then the real update
 * — the next turn's draw, or the draft pack. Every gap was one tempo per stack
 * beat of the step before, the hand-over included, so the pack landed one
 * second after the last frame, same as any frame. Now the hand-over waits
 * PLAYBACK_END_MS (ui/pace.ts playbackGapsOf), and the frames keep their pace.
 *
 * The server holds the watching seat's clock with a backstop budget
 * (server/playback-budget.ts). A budget shorter than the client's schedule
 * would start the clock while the seat is still watching, so the budget is
 * built from the same constants and checked against the same frames here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PACE_MS, PACE_SAME_SOURCE_MS, PLAYBACK_END_MS, playbackGapsOf } from '../pace.ts';
import { flashBatches } from '../flash.ts';
import { playbackBudget, PLAYBACK_MAX_MS, PLAYBACK_SLACK_MS } from '../../server/playback-budget.ts';
import type { EngineEvent, StackItem } from '../../engine/src/types.ts';

let nextId = 1;
const item = (card: string, extra: Partial<StackItem> = {}): StackItem =>
  ({ id: nextId++, kind: 'spellToken', card, label: card, controller: 1, region: 0, negated: false, parts: [], ...extra });
const flash = (it: StackItem): EngineEvent => ({ type: 'stackFlash', msg: '', data: { item: it } });
/** one step's events: `n` separate plays (n stack beats), or nothing */
const beatsOf = (n: number, card = 'Fireball'): EngineEvent[] =>
  Array.from({ length: n }, (_, k) => flash(item(`${card} ${k}`)));
/** the gaps the client books for these steps (the last is the real update) */
const gaps = (steps: readonly EngineEvent[][]): number[] => playbackGapsOf(steps.map(e => flashBatches(e)));

test('the hand-over to the next turn waits PLAYBACK_END_MS, longer than a frame', () => {
  assert.ok(PLAYBACK_END_MS > PACE_MS, 'a longer pause than the plain tempo — the report');
  assert.equal(PLAYBACK_END_MS, 2 * PACE_MS, 'derived from the one tempo, not typed');
  // frames with no stack beats (a unit played, a resource) and the update
  const g = gaps([[], [], [], []]);
  assert.equal(g[g.length - 1], PLAYBACK_END_MS, 'the gap before the real update is the end pause');
  // a last frame with exactly one beat: still just the end pause
  assert.equal(gaps([[], beatsOf(1), []]).at(-1), PLAYBACK_END_MS);
});

test('a last frame with several stack beats tells them all, then pauses', () => {
  // three beats: the second and third come a tempo apart, and only after the
  // third does the end pause start — otherwise the pack would land mid-story
  assert.equal(gaps([[], beatsOf(3), []]).at(-1), 2 * PACE_MS + PLAYBACK_END_MS);
});

test('the frames before the hand-over keep their pace', () => {
  // one tempo per beat of the step before, a tempo for a quiet step
  assert.deepEqual(gaps([[], beatsOf(2), [], beatsOf(1), []]).slice(0, -1), [0, PACE_MS, 2 * PACE_MS, PACE_MS]);
  // a run of copies of one card at the same-source tempo
  const copy = (): EngineEvent[] => [flash(item('Bubb'))];
  assert.deepEqual(gaps([copy(), copy(), copy(), []]), [0, PACE_SAME_SOURCE_MS, PACE_SAME_SOURCE_MS, PLAYBACK_END_MS],
    'copies go three a second — but the hand-over after them still pauses');
  // a playback of nothing but the update: shown at once
  assert.deepEqual(gaps([[]]), [0]);
});

test('every playback goes through the one gap rule: live, watch-again and Learn to Play', () => {
  const ui = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  assert.match(ui, /function playbackGaps\(steps: readonly NetMsg\[\]\): number\[\] \{\n\s*return playbackGapsOf\(/,
    'ui/main.ts playbackGaps is ui/pace.ts playbackGapsOf over the steps\' stack beats');
  const uses = ui.match(/paceSequence\(this\.paced, steps, (playbackGaps\(steps\)|gaps), Date\.now\(\)\)/g) ?? [];
  assert.equal(uses.length, 2, 'the live playback (which Learn to Play also sends) and "watch again"');
  assert.match(ui, /const gaps = playbackGaps\(steps\);/, '"watch again" books its gaps with the same rule');
});

test('the server\'s clock-hold budget outlasts the client\'s schedule, end pause included', () => {
  const server = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
  assert.match(server, /import \{ playbackBudget, PLAYBACK_MAX_MS \} from '\.\/playback-budget\.ts';/,
    'server/main.ts holds the clock with the shared budget');
  assert.doesNotMatch(server, /function playbackBudget/, 'and keeps no copy of its own to drift');
  // seeded walk over playbacks of 1–12 frames, 0–3 beats each, some copies
  let seed = 3721;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  for (let trial = 0; trial < 300; trial++) {
    const frames = Array.from({ length: 1 + rnd(12) }, () => ({
      events: rnd(4) === 0 ? [flash(item('Bubb'))] : beatsOf(rnd(4)),
    }));
    const steps = [...frames.map(f => f.events), [] as EngineEvent[]];   // the frames, then the update
    const client = gaps(steps).reduce((a, b) => a + b, 0);
    const budget = playbackBudget(frames);
    if (budget === PLAYBACK_MAX_MS) continue;   // the cap: a backstop, not a schedule
    assert.ok(budget >= client + PLAYBACK_SLACK_MS,
      `${frames.length} frames: the server holds the clock ${budget} ms, the client plays for ${client} ms — `
      + `the backstop must outlast it by its whole slack`);
  }
});
