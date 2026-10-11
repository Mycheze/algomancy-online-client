/* Report #203 (HPTR, 2026-10-11) — THE LIFE TOTAL WAITS FOR THE BEAT.
 *
 * The owner: "The lifegain and sound effect from Iyngstra happen before the
 * effect visually hits the stack, which just feels a bit weird."
 *
 * What happened: a unit spawns, Iyngstra triggers, the trigger goes on the
 * stack and resolves with nobody able to answer it — all inside ONE server
 * update. The client replays the trigger as a beat on the visual stack
 * (ui/flash.ts), and since 2026-10-03 the unit a beat made waits off the
 * board until the beat ends (test/359). The life it made did not: the total,
 * its flash and its cue (ui/main.ts soundPass) all moved at the click, a
 * second or two before the trigger they came from had even reached the strip.
 *
 * Now a life change inside a beat's resolution is that beat's result too
 * (ui/flash.ts `lifeResults` / `heldLife`): held off the number, the flash and
 * the cue until the beat ends, on the beat's own clock. A life change no beat
 * caused — a cost, combat damage — is shown at once, exactly as before.
 *
 * §1 is the pure half, on the real Iyngstra batch. §2 drives the real client
 * (test/ui-driver.ts) with a test clock and a recording <audio>, and reads the
 * number on screen and the cues played.
 *
 * Seeds 44500-44599.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { EngineEvent, GameState, Seat } from '../../engine/src/types.ts';
import { viewFor } from '../../server/view.ts';
import { give, giveResources, spawn, toDeployment, withE } from '../../engine/test/util.ts';
import { beatCensus, flashItems, heldLife, lifeResults, queueFlashes, shownLife } from '../flash.ts';
import { census } from '../motion.ts';
import type { Slot } from '../motion.ts';
import { client } from './ui-driver.ts';

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
after(() => { Date.now = realNow; });

/** every cue the page played, by name (ui/audio.ts's <audio> path — the only
 * one node has) */
const PLAYED: string[] = [];
(globalThis as Record<string, unknown>)['Audio'] = class {
  preload = ''; volume = 1; currentTime = 0; src: string;
  constructor(src: string) { this.src = src; }
  load(): void {}
  play(): Promise<void> { PLAYED.push(/sfx\/(\w+)\./.exec(this.src)?.[1] ?? this.src); return Promise.resolve(); }
};

const bornSince = (prev: GameState, next: GameState): Slot[] => {
  const had = new Set(census(prev).slots.map(s => s.key));
  return census(next).slots.filter(s => !had.has(s.key));
};

/** HPTR's moment: Iyngstra in play, and another ally deployed beside it */
function iyngstra(seed = 44501): { h: Harness; seat: Seat; before: GameState; events: EngineEvent[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  spawn(h, seat, 'Iyngstra');
  giveResources(h, seat, 'earth', 6);
  const idx = give(h, seat, 'Rampart Guardian');
  const before = structuredClone(h.state);
  const events = h.do({ type: 'playCard', seat, handIndex: idx });
  return { h, seat, before, events };
}

/* ── §1 the pure half ───────────────────────────────────────────────────── */

test('§1a the Iyngstra trigger beat carries the life it gained, and nothing else does', () => {
  const { h, seat, before, events } = iyngstra();
  const gained = h.state.players[seat]!.life - before.players[seat]!.life;
  assert.ok(gained > 0, 'the fixture is the real thing: Iyngstra gained life');
  const trig = flashItems(events).find(i => i.kind === 'triggered' && i.card === 'Iyngstra');
  assert.ok(trig, 'and the trigger had a beat');
  assert.deepEqual(lifeResults(events, trig!), [{ seat, delta: gained }]);

  const q = queueFlashes([], events, 0, new Map(), bornSince(before, h.state));
  const beat = q.find(f => f.item.id === trig!.id)!;
  assert.deepEqual(beat.life, [{ seat, delta: gained }]);
  assert.ok(q.filter(f => f !== beat).every(f => !f.life), 'the unit play itself moved no life');
});

test('§1b the life is held while the beat waits or shows, and comes back the moment it ends', () => {
  const { h, before, events } = iyngstra();
  const q = queueFlashes([], events, 0, new Map(), bornSince(before, h.state));
  const beat = q.find(f => f.life)!;
  const life = h.state.players.map(p => p.life);
  const was = before.players.map(p => p.life);
  assert.deepEqual(shownLife(life, heldLife(q, 0)), was, 'at the click the table still shows the old total');
  assert.deepEqual(shownLife(life, heldLife(q, beat.until - 1)), was, 'and all through the beat');
  assert.deepEqual(shownLife(life, heldLife(q, beat.until)), life, 'the beat ends: the new total');
});

test('§1b2 the identity row pulse reads the shown life, so it waits for the beat too', () => {
  // ui/motion.ts diffCensus pulses the player row when its slot's sig changes;
  // a sig read off the state would pulse at the click, before the beat
  const { h, seat, before, events } = iyngstra();
  const q = queueFlashes([], events, 0, new Map(), bornSince(before, h.state));
  const beat = q.find(f => f.life)!;
  const sigAt = (now: number): string | undefined =>
    beatCensus(census(h.state), [], q, now, true, () => undefined).slots.find(s => s.key === `p${seat}`)?.sig;
  const was = census(before).slots.find(s => s.key === `p${seat}`)?.sig;
  const now = census(h.state).slots.find(s => s.key === `p${seat}`)?.sig;
  assert.notEqual(was, now, 'the fixture moved the sig');
  assert.equal(sigAt(0), was, 'at the click the row has nothing to pulse');
  assert.equal(sigAt(beat.until - 1), was, 'nor all through the beat');
  assert.equal(sigAt(beat.until), now, 'the beat ends: the row pulses with the number');
});

test('§1c a life change after the window closes is not held by the beat before it', () => {
  // the same batch, and then something no resolution spans — a phase line —
  // and a life loss after it (rot at the start of a step, say)
  const { h, seat, before, events } = iyngstra();
  const trig = flashItems(events).find(i => i.kind === 'triggered')!;
  const tail: EngineEvent[] = [
    { type: 'phase', msg: 'Battle phase.' },
    { type: 'lifeLost', msg: 'loses 2 life.', data: { seat, n: 2, why: 'rot' } },
  ];
  const gained = h.state.players[seat]!.life - before.players[seat]!.life;
  assert.deepEqual(lifeResults([...events, ...tail], trig), [{ seat, delta: gained }],
    'the loss after the phase line belongs to no beat');
});

test('§1d a resync holds no life back, whatever beats it carries', () => {
  const { events } = iyngstra();
  const q = queueFlashes([], events, 0, new Map(), [], false);
  assert.ok(q.length > 0 && q.every(f => !f.life), 'a wholesale arrival: the number on screen was never the old one');
});

/* ── §2 the real client ─────────────────────────────────────────────────── */

const ui = await client();

/** the life total drawn in seat `p`'s pill */
const lifeOn = (p: Seat): number => {
  const html = ui.html();
  const at = html.indexOf(`data-animzone="life:${p}"`);
  assert.notEqual(at, -1, `seat ${p} has no life pill`);
  const m = /<span class="lifenum">(-?\d+)<\/span>/.exec(html.slice(at));
  assert.ok(m, 'the pill carries its total');
  return Number(m![1]);
};
/** the clock moves on to `t` and every repaint the client booked runs */
const at = (t: number): void => { clock = t; ui.tick(); ui.tick(); };

test('§2a the Iyngstra life gain, its number and its sound, wait until the trigger beat resolves', () => {
  const { h, seat, before, events } = iyngstra(44502);
  const was = before.players[seat]!.life, now = h.state.players[seat]!.life;
  assert.ok(now > was);
  const t0 = clock = realNow() + 10_000_000;
  ui.join(viewFor(before, seat), seat, legalActions(before, seat));
  PLAYED.length = 0;
  ui.update(viewFor(h.state, seat), legalActions(h.state, seat), { events });
  assert.equal(lifeOn(seat), was, 'at the click the total has not moved — the trigger is not even on the stack yet');
  assert.ok(!PLAYED.includes('lifeup'), 'and nothing was heard');

  // the trigger's beat: CR D6.7 puts the unit play first and the trigger a tempo
  // step behind it, so its end is the latest `until` in the batch
  const q = queueFlashes([], events, t0, new Map(), bornSince(before, h.state));
  const beat = q.find(f => f.life)!;
  at(beat.until - 1);
  assert.equal(lifeOn(seat), was, 'all the while the trigger is on the stack');
  assert.ok(!PLAYED.includes('lifeup'));
  at(beat.until + 1);
  assert.equal(lifeOn(seat), now, 'the trigger resolves: the total moves');
  assert.equal(PLAYED.filter(c => c === 'lifeup').length, 1, 'and is heard, once');
});

test('§2b a life change with no beat behind it (a cost) is shown and heard at once', () => {
  const h = new Harness(44503);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const before = structuredClone(h.state);
  const n = h.events.length;
  withE(h, e => e.loseLife(seat, 3, 'a cost'));
  const events = h.events.slice(n);
  assert.ok(!events.some(e => e.type === 'stackFlash'), 'the fixture has no beat in it');
  clock = realNow() + 20_000_000;
  ui.join(viewFor(before, seat), seat, legalActions(before, seat));
  PLAYED.length = 0;
  ui.update(viewFor(h.state, seat), legalActions(h.state, seat), { events });
  assert.equal(lifeOn(seat), before.players[seat]!.life - 3, 'the total moved with the update');
  assert.equal(PLAYED.filter(c => c === 'lifedown').length, 1, 'and was heard with it');
});

test('§2c with motion switched off there are no beats, so the Iyngstra life gain is not delayed', () => {
  const { h, seat, before, events } = iyngstra(44504);
  localStorage.setItem('algoMotion', '0');
  try {
    clock = realNow() + 30_000_000;
    ui.join(viewFor(before, seat), seat, legalActions(before, seat));
    PLAYED.length = 0;
    ui.update(viewFor(h.state, seat), legalActions(h.state, seat), { events });
    assert.equal(lifeOn(seat), h.state.players[seat]!.life, 'shown at once');
    assert.equal(PLAYED.filter(c => c === 'lifeup').length, 1, 'and heard at once');
  } finally {
    localStorage.removeItem('algoMotion');
  }
});
