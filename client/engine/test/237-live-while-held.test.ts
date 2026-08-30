/* R258 / CT-123 — WHAT STAYS LIVE WHILE R150's THROTTLE IS HOLDING.
 *
 * R150 holds an update the player cannot act on. A held update releases
 * nothing, so `pumpPace` renders nothing, so NOTHING on screen changes — which
 * is the feature for the board and was a bug for two things that are not the
 * board:
 *
 *   · the ⏭ "catching up (n) — skip" chip, the only VISIBLE way out of the
 *     pacing, absent exactly while the thing it offers to skip is happening;
 *   · the opponent's presence, which is truth about the SESSION. A disconnect
 *     arrives as an ordinary `update` and was therefore throttled like game
 *     news, up to PACE_MAX_HELD × PACE_MS = 12s behind the truth.
 *
 * THE TRAP THIS FILE EXISTS TO KEEP SHUT. CT-123 says a repaint here "must
 * draw the chip WITHOUT drawing the held state behind it", and the naive
 * reading of that is about STALENESS. Staleness is not the hazard: an
 * un-holdable update flushes the queue before anything paints, so a repaint
 * during a hold can only repaint the state already on screen. The hazard is
 * that `render()` is not a paint — it runs gcStaleUi(), planAutoPass(),
 * maybeCancelChain(), publishBuilding(), and at the end `runAutoPass()`, which
 * SENDS AN ACTION TO THE SERVER. So §2 below asserts the shape rather than the
 * symptom: a held update must move `ui.html()` and must leave `ui.raw()` — the
 * markup render() wrote — byte-identical. Anybody who "fixes" this by calling
 * render() reddens that immediately.
 *
 * §1 the chip, on the real client over the real wire
 * §2 the R150 invariant: the live slots moved and nothing else did
 * §3 presence, the same class, one level deeper (the hold gate never saw it)
 * §4 the measured band, replayed against the real pace.ts arithmetic
 *
 * Seeds 23700-23799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { viewFor } from '../../server/view.ts';
import {
  PACE_MS, emptyPace, pace, paceDue, paceHeld, paceWake, type PaceQueue,
} from '../../ui/pace.ts';
import { client } from './ui-driver.ts';
import type { GameState, Seat } from '../src/types.ts';

/** the real client, driven — see test/ui-driver.ts */
const ui = await client();
const SEAT: Seat = 0;

/**
 * A plain opening board this seat is looking at.
 *
 * ⚠ THE THROTTLE IS DRAINED FIRST, and a `joined` does not do it: `resetUi()`
 * drops the UI state and leaves `this.paced` alone. Without this, whatever the
 * previous test left holding is released by the first un-holdable update of
 * THIS one — carrying its `peers` and its board with it — and a guard below
 * goes green on the previous test's data. (It did, before this comment.)
 */
function board(seed: number): GameState {
  if (ui.has({ btn: 'paceskip' })) ui.click({ btn: 'paceskip' });
  const h = new Harness(seed);
  ui.join(viewFor(h.state, SEAT), SEAT, legalActions(h.state, SEAT));
  return h.state;
}

/** the same board, a few turns on — something the screen can be asked about */
const at = (s: GameState, turn: number): GameState => ({ ...structuredClone(s), turn });

/** does the board say it is turn `n`? */
const showsTurn = (html: string, n: number): boolean => new RegExp(`Turn ${n}\\D`).test(html);

/**
 * An update the throttle may NOT hold: it offers the player something to do.
 * R150 flushes on one of these, so it leaves the queue empty AND the release
 * floor at now — which is what makes the next arrival deterministically held,
 * whatever any earlier test in this file left behind.
 */
function live(s: GameState): string {
  const legal = legalActions(s, SEAT);
  assert.ok(legal.length, 'fixture: this seat really is being offered something');
  return ui.update(viewFor(s, SEAT), legal);
}

/** An update the throttle MAY hold: nothing legal, nothing asked of this seat
 * — `holdable()`'s `legal === 0` limb, which is the quietest of the three. */
const held = (s: GameState, extra: Record<string, unknown> = {}): string =>
  ui.update(viewFor(s, SEAT), [], extra);

/* ══ §1 — the chip is on screen while the throttle is holding ══════════ */

test('R258 the skip chip is on screen while the throttle is holding it back', () => {
  const s = board(23700);
  live(s);
  assert.equal(ui.has({ btn: 'paceskip' }), false,
    'positive control: with nothing held the chip is correctly absent');

  const html = held(at(s, 7));
  assert.ok(ui.has({ btn: 'paceskip' }),
    'the one visible way OUT of the pacing is on screen while the pacing is happening');
  assert.match(html, /catching up \(1\)/, 'and it says how much there is to skip');
});

test('R258 the held count is re-read at every arrival, not only at a release', () => {
  // The count used to be sampled inside render(), which only runs when
  // something was RELEASED — so it was late by up to PACE_MS and a systematic
  // undercount: every arrival after the one that painted was invisible.
  const s = board(23701);
  live(s);
  for (const [i, turn] of [7, 8, 9].entries()) {
    held(at(s, turn));
    assert.match(ui.html(), new RegExp(`catching up \\(${i + 1}\\)`),
      'the arrival itself moved the count, with no release in between');
  }
});

test('R258 the chip drawn during the hold really drains the throttle', () => {
  const s = board(23702);
  live(s);
  held(at(s, 7));
  const html = ui.click({ btn: 'paceskip' });
  assert.ok(showsTurn(html, 7), 'the skip released the state that was being held');
  assert.equal(ui.has({ btn: 'paceskip' }), false, 'and the chip took itself off again');
});

/* ══ §2 — the R150 invariant: a paint, not a render ════════════════════ */

test('R258 a held update moves the live slots and NOTHING else on the board', () => {
  const s = board(23703);
  const before = live(s);
  assert.ok(showsTurn(before, 1), 'positive control: the board says which turn it is');
  ui.sent();                       // forget the join / echo traffic
  const rawBefore = ui.raw(), htmlBefore = ui.html(), rendersBefore = ui.renders();

  const after = held(at(s, 7));
  assert.equal(ui.renders(), rendersBefore,
    'the whole-page render did not RUN — a held update is a paint, not a policy pass');
  assert.equal(ui.raw(), rawBefore,
    'and everything R150 is entitled to freeze is byte-identical');
  assert.notEqual(after, htmlBefore,
    'positive control: the live slots DID change — otherwise this guard is about nothing');
  assert.ok(showsTurn(after, 1), 'the player is still looking at the state they were looking at');
  assert.equal(showsTurn(after, 7), false, 'the held state has not jumped onto the screen');
  assert.deepEqual(ui.actions(), [], 'and the paint put nothing on the wire');
});

/* ══ §3 — presence: the same class, one level deeper ═══════════════════ */

test('R258 a disconnect that arrives while the throttle is holding is on screen at once', () => {
  // ⚠ ROOT CAUSE, and why this is not a second copy of §1: holdable() never
  // consulted `peers` at all, so a disconnect notice was eligible to wait like
  // any other quiet update. It is not game news — nobody acts on it and it is
  // true the moment it arrives — so it is applied ahead of the hold gate and
  // painted by the same slot patcher.
  const s = board(23704);
  live(s);
  assert.match(ui.html(), /opponent connected/, 'positive control: they start out present');
  const rendersBefore = ui.renders();

  held(at(s, 7), { peers: [true, false] });
  assert.match(ui.html(), /opponent offline/,
    'presence is session truth, not something the throttle may sit on');
  assert.equal(ui.renders(), rendersBefore,
    'and it got there without a render — the board is still frozen');
  assert.equal(showsTurn(ui.html(), 7), false, 'which is to say: the held state is still held');
});

test('R258 a disconnect is not queued behind the backlog it arrived into', () => {
  // THE MAGNITUDE, which is why this half is not cosmetic. A held update is
  // spaced PACE_MS behind the one before it, so a disconnect that lands on a
  // backlog waits for the WHOLE backlog — bounded only by PACE_MAX_HELD, i.e.
  // twelve seconds of "opponent connected" after they had gone.
  const s = board(23705);
  live(s);
  const deep = 5;
  for (let i = 0; i < deep; i++) held(at(s, 10 + i));
  assert.match(ui.html(), new RegExp(`catching up \\(${deep}\\)`),
    'positive control: there is a real backlog for the notice to be stuck behind');

  held(at(s, 20), { peers: [true, false] });
  assert.match(ui.html(), /opponent offline/,
    `the sixth message is ${deep} releases from the screen; its presence reading is not`);
  assert.equal(showsTurn(ui.html(), 20), false,
    'while the STATE it carried is still, correctly, held');
});

/* ══ §4 — the band, replayed against the real arithmetic ═══════════════ */

/**
 * ui/main.ts's drain, on a virtual clock, over `n` holdable arrivals `gap`
 * apart. Returns what a RELEASE-ONLY paint seam would have managed —
 * `paints` and, of those, how many had a non-zero count to show — plus the
 * milliseconds during which something was held with no paint at all, and what
 * an ARRIVAL-driven seam (this ruling's) draws instead.
 *
 * This is a characterisation of ui/pace.ts, not a guard on ui/main.ts: it is
 * here because the band is the whole reason CT-123 is not cosmetic, and a
 * number in a comment rots. It carries its own positive control below.
 */
function drain(gap: number, n: number): { paints: number; withChip: number; blindMs: number; onArrival: number } {
  let q: PaceQueue<number> = emptyPace<number>();
  let now = 0, timer: number | null = null, blindMs = 0;
  let paints = 0, withChip = 0, onArrival = 0;
  const arrivals = Array.from({ length: n }, (_, i) => i * gap);
  const end = arrivals[n - 1]! + PACE_MS * (n + 2);
  let next = 0;
  const pump = (arrival: boolean): void => {
    const { out, rest } = paceDue(q, now);
    q = rest;
    if (out.length) { paints++; if (paceHeld(q, now) > 0) withChip++; }
    // the fix: the slot is patched whether or not anything was released
    if (paceHeld(q, now) > 0 && (arrival || out.length)) onArrival++;
    const wake = paceWake(q, now);
    timer = wake === null ? null : wake;
  };
  while (now < end) {
    const to = Math.min(next < n ? arrivals[next]! : Infinity, timer ?? Infinity, end);
    if (paceHeld(q, now) > 0) blindMs += to - now;
    now = to;
    if (next < n && arrivals[next]! <= now) { q = pace(q, next++, now, true); pump(true); continue; }
    if (timer !== null && timer <= now) { timer = null; pump(false); continue; }
    break;
  }
  return { paints, withChip, blindMs, onArrival };
}

test('R258 at a one-second arrival gap a release-only chip is drawn zero times', () => {
  // R150 documents the real arrival pattern as "a few hundred ms apart"; the
  // band that fails outright runs from about PACE_MS/2 up to PACE_MS.
  const worst = drain(Math.round(PACE_MS * 0.9), 10);
  assert.ok(worst.blindMs >= PACE_MS,
    'positive control: the throttle really is holding something, for seconds');
  assert.equal(worst.withChip, 0,
    'every release lands on an empty queue, so a render-only chip has nothing to draw — ever');
  assert.ok(worst.onArrival > 0, 'an arrival-driven slot has the chip on screen in the same run');

  // and the instrument is not stuck on zero: a burst is the case the chip was
  // written for, and it does draw there
  const burst = drain(1, 10);
  assert.ok(burst.withChip > 0,
    'positive control on the measurement itself — it can report a drawn chip');
  assert.ok(burst.blindMs > PACE_MS,
    'though even a burst spends seconds holding with nothing repainting');
});
