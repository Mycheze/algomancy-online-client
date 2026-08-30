/* R242 — ONE TEMPO FOR THE WHOLE CLIENT, AND A CASCADE YOU CAN FOLLOW.
 *
 * The owner, 2026-08-29:
 *
 *   "Sometimes, when no players have more actions they can take, the game
 *    instantly resolves everything and it's impossible to follow. Even during
 *    times like that, there should be a max speed. We should see all the
 *    triggers go onto the stack (in the right order, all at once) and then
 *    slowly resolve. Think about it from a human's perspective, especially
 *    someone who's learning the game and wants to see how things generally
 *    work and follow along."
 *
 * ── ⚠ THIS IS THE SECOND TIME, AND THAT IS THE INTERESTING PART ───────
 *
 * Report #94 (SMVJ) already asked: *"We need a 'max speed' that the gamestate
 * can resolve/put things onto the stack […] at a max speed of 1 thing per
 * second."* R150 built `ui/pace.ts` for it and it works — it throttles
 * updates BETWEEN server batches at exactly that.
 *
 * It could never reach the case being complained about. A cascade nobody can
 * respond to is not several batches: `engine.ts::settle()` drains the whole
 * stack inside ONE action (R144(a) — outside battle there are no priority
 * windows) and `pumpCombatDamage` runs Swift → normal → Sluggish in one loop.
 * The client gets ONE update, `pace.ts` has nothing to space, and the only
 * thing still pacing was `ui/flash.ts` — at STAGGER_MS = 280ms, three and a
 * half times faster than the ceiling the same owner had already asked for,
 * and capped so that it stopped pacing entirely 2.2 seconds in.
 *
 * **Two queues pacing one table, holding two different opinions about how fast
 * a human reads, and the faster one owned exactly the case the slower one
 * could not reach.** §1 is the claim that there is now one opinion, derived
 * rather than restated, so the two cannot drift apart again.
 *
 * ── AND THE SHAPE, WHICH IS THE OTHER HALF OF THE SENTENCE ────────────
 *
 * "all at once, AND THEN slowly resolve" is two requirements. R189 already
 * delivered the first: a batch that is simultaneous in the rules shares an
 * arrival. It also made the items share a DEPARTURE, so three simultaneous
 * triggers appeared together and then vanished together — the resolution, the
 * thing a person learning the game is trying to watch, was never shown at all.
 * §2 is one arrival and N departures.
 *
 * Seeds 21800-21899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOLD_MS, MAX_LEAD_MS, STAGGER_MS,
  flushBeats, flushFlashes, heldLines, pendingFlashes, queueBeats, queueFlashes, visibleFlashes,
} from '../ui/flash.ts';
import { PACE_MAX_HELD, PACE_MS } from '../ui/pace.ts';
import type { BeatStage } from '../ui/flash.ts';
import type { EngineEvent, StackItem } from '../src/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = join(HERE, '..', 'ui');

const item = (id: number, kind: StackItem['kind'] = 'triggered'): StackItem => ({
  id, kind, label: `item ${id}`, controller: 0, region: 0, negated: false, parts: [],
});
const flashEv = (id: number, kind: StackItem['kind'] = 'triggered'): EngineEvent =>
  ({ type: 'stackFlash', msg: '', data: { item: item(id, kind) } });
const triggeredEv = (): EngineEvent => ({ type: 'triggered', msg: 'a trigger goes on the queue.' });

/* ══ §1 one tempo, derived ═══════════════════════════════════════════════ */

test('§1a the beat tempo IS the client-wide ceiling — not a second opinion about it', () => {
  assert.equal(STAGGER_MS, PACE_MS,
    'ui/pace.ts declares itself the home of the interval ("the interval is not to be spelled out '
    + 'anywhere else"); ui/flash.ts was the place that spelled it out again, at 280ms');
  assert.equal(PACE_MS, 1000, 'and the owner\'s own number, from report #94: 1 thing per second');
});

test('§1b the lag bound is counted in BEATS, not in a wall-clock wall', () => {
  // It was a flat 2200ms. Once a beat is a full second that binds after TWO of
  // them and hands a long cascade straight back to the instant resolution this
  // whole change exists to prevent — so the bound has to scale with the tempo.
  assert.equal(MAX_LEAD_MS, PACE_MS * PACE_MAX_HELD);
  assert.ok(MAX_LEAD_MS / STAGGER_MS >= 8,
    `a cascade must get at least 8 paced beats before the bound collapses it, got `
    + `${MAX_LEAD_MS / STAGGER_MS}`);
});

test('§1c a beat is still on screen when its successor lands', () => {
  // or a cascade flickers — one thing vanishing, a gap, the next appearing —
  // instead of handing over
  assert.ok(HOLD_MS >= STAGGER_MS, `HOLD_MS ${HOLD_MS} must cover the gap ${STAGGER_MS}`);
});

test('§1d neither number is written down twice — asserted against the source', () => {
  const flash = readFileSync(join(UI, 'flash.ts'), 'utf8');
  assert.match(flash, /export const STAGGER_MS = PACE_MS;/, 'derived, not typed');
  assert.match(flash, /export const MAX_LEAD_MS = PACE_MS \* PACE_MAX_HELD;/);
  // the specific regression: a literal millisecond count re-entering this file
  const literals = [...flash.matchAll(/^export const \w+_MS = (\d+);/gm)].map(m => m[1]);
  assert.deepEqual(literals, [String(HOLD_MS)],
    'HOLD_MS is a real independent knob (how long one beat is READABLE for). Any OTHER bare '
    + 'millisecond constant here is a second opinion about the tempo, which is the bug.');
});

/* ══ §2 all at once, and THEN slowly resolve ═════════════════════════════ */

/** three triggers queued together and drained together — R189's own shape */
const simultaneous = (): EngineEvent[] => [
  triggeredEv(), triggeredEv(), triggeredEv(),
  flashEv(1), flashEv(2), flashEv(3),
];

test('§2a "all at once": a simultaneous batch shares ONE arrival', () => {
  const q = queueFlashes([], simultaneous(), 0);
  assert.equal(q.length, 3);
  assert.deepEqual(q.map(f => f.at), [0, 0, 0],
    'R189: a batch that is simultaneous in the rules must LOOK simultaneous');
  assert.equal(visibleFlashes(q, 0).length, 3, 'the whole stack is on screen at once');
});

test('§2b "and then slowly resolve": they leave ONE AT A TIME, at the tempo', () => {
  const q = queueFlashes([], simultaneous(), 0);
  assert.deepEqual(q.map(f => f.until), [HOLD_MS, HOLD_MS + STAGGER_MS, HOLD_MS + STAGGER_MS * 2],
    'they used to share a departure too — appearing together and vanishing together, which '
    + 'never showed the resolution at all');
  // the stack visibly drains, which is the thing being asked for
  assert.equal(visibleFlashes(q, 0).length, 3);
  assert.equal(visibleFlashes(q, HOLD_MS).length, 2, 'the first has resolved');
  assert.equal(visibleFlashes(q, HOLD_MS + STAGGER_MS).length, 1);
  assert.equal(visibleFlashes(q, HOLD_MS + STAGGER_MS * 2).length, 0, 'the stack is empty');
});

test('§2c they leave in RESOLUTION order', () => {
  // `stackFlash` fires AT the resolution, so event order is resolution order —
  // the first flashed is the first resolved and must be the first to go
  const q = queueFlashes([], simultaneous(), 0);
  const order = q.slice().sort((a, z) => a.until - z.until).map(f => f.item.id);
  assert.deepEqual(order, [1, 2, 3]);
});

test('§2d a cascade of SEPARATE things is a sequence, one per tempo-step', () => {
  // not a trigger batch: three unrelated flashes, so three groups
  const q = queueFlashes([], [flashEv(1, 'spell'), flashEv(2, 'spell'), flashEv(3, 'spell')], 0);
  assert.deepEqual(q.map(f => f.at), [0, STAGGER_MS, STAGGER_MS * 2]);
});

test('§2e the next group waits for this one to finish draining', () => {
  const q = queueFlashes([], [...simultaneous(), triggeredEv(), flashEv(9)], 0);
  const late = q.find(f => f.item.id === 9)!;
  assert.equal(late.at, STAGGER_MS * 3,
    'three items drained one step apart, THEN the next beat — otherwise the two groups overlap '
    + 'and the sequence reads as a pile again');
});

/* ══ §3 the case the ceiling could not previously reach ══════════════════ */

test('§3a a long cascade is paced, not collapsed into two beats', () => {
  // the measured shape of the complaint: one action, many things to follow
  const events: EngineEvent[] = [];
  for (let i = 1; i <= 10; i++) events.push(flashEv(i, 'spell'));
  const q = queueFlashes([], events, 0);
  assert.equal(q.length, 10, 'nothing is dropped');
  const spread = Math.max(...q.map(f => f.at));
  assert.ok(spread >= PACE_MS * 8,
    `ten things must take at least eight seconds of screen time, got ${spread}ms. Under the old `
    + 'constants the whole cascade was over inside MAX_LEAD_MS = 2200ms, which is the '
    + '"impossible to follow" being reported.');
  // and still bounded — the ceiling is a floor on readability, not a licence
  // to drift arbitrarily far behind the board
  for (const f of q) assert.ok(f.at <= MAX_LEAD_MS, `${f.at} <= ${MAX_LEAD_MS}`);
});

test('§3b the narrative beats of a combat step are paced at the same tempo', () => {
  const stages: BeatStage[] = [
    { kind: 'strike', lines: 2, keys: [] },
    { kind: 'fallout', lines: 2, keys: [] },
    { kind: 'strike', lines: 2, keys: [] },
    { kind: 'after', lines: 1, keys: [] },
  ];
  const beats = queueBeats(stages, 0);
  const gaps = beats.slice(1).map((b, i) => b.at - beats[i]!.at);
  for (const g of gaps) {
    assert.ok(g >= PACE_MS, `a combat stage must get at least the tempo, got ${g}ms`);
  }
  assert.ok(beats[beats.length - 1]!.at >= PACE_MS * 3,
    'the whole step used to be squeezed into MAX_LEAD_MS = 2200ms whatever its length');
});

/* ══ §4 the escape hatch, which now has to exist ═════════════════════════ */

test('§4a skipping drops the pending flashes — the board is already live', () => {
  const q = queueFlashes([], simultaneous(), 0);
  assert.ok(pendingFlashes(q, 0) >= 0);
  assert.deepEqual(flushFlashes(), [], 'a beat is a replay for the eye, never a state');
});

test('§4b skipping RELEASES the beats rather than dropping them', () => {
  // ⚠ the difference matters: a beat is holding back real LOG LINES, so
  // dropping the queue would drop the story
  const beats = queueBeats([
    { kind: 'strike', lines: 3, keys: [] },
    { kind: 'fallout', lines: 4, keys: [] },
    { kind: 'after', lines: 2, keys: [] },
  ], 0);
  assert.ok(heldLines(beats, 0) > 0, 'positive control: lines really are being held');
  const flushed = flushBeats(beats, 0);
  assert.equal(heldLines(flushed, 0), 0, 'every line is told');
  assert.equal(flushed.length, beats.length, 'and no stage was thrown away');
  assert.deepEqual(flushed.map(b => b.lines), beats.map(b => b.lines));
});

test('§4c pendingFlashes counts what is still to come, so the chip can offer itself', () => {
  const q = queueFlashes([], [flashEv(1, 'spell'), flashEv(2, 'spell'), flashEv(3, 'spell')], 0);
  assert.equal(pendingFlashes(q, 0), 2, 'two have not arrived yet');
  assert.equal(pendingFlashes(q, STAGGER_MS * 2), 0, 'the cascade is spent');
});

test('§4d the client really wires all three queues into one skip', () => {
  // Before R242 the ⏭ chip counted `heldUpdates()` alone and `paceskip` called
  // only `flushPace()`. That was defensible while a cascade emptied itself
  // inside 2.2s; it is not now, and a ceiling the player cannot opt out of is
  // a wait rather than a courtesy.
  const src = readFileSync(join(UI, 'main.ts'), 'utf8');
  assert.match(src, /function pacedAhead\(\): number \{[\s\S]*?heldUpdates\(\)[\s\S]*?pendingFlashes\([\s\S]*?heldLines\(/,
    'the count covers the update queue, the flash queue and the beat queue');
  assert.match(src, /function skipPacing\(\): void \{[\s\S]*?flushFlashes\(\)[\s\S]*?flushBeats\([\s\S]*?flushPace\(\)/,
    'and so does the skip');
  assert.match(src, /paceskip: \(\) => \{ skipPacing\(\); \}/, 'the chip is wired to it');
  assert.match(src, /if \(overlayUp \|\| !pacedAhead\(\)\) return;[\s\S]{0,120}skipPacing\(\);/,
    'and so is the S key — it used to gate on heldUpdates(), which is empty during a cascade');
});
