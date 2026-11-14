/* Cube draft §4: the clocks, and advance() running the overdue past in time order
 * (docs/25-cube-draft.md §1, §4).
 *
 * §1 a bot picks BOT_DELAY_MS after its pack became current; a human's clock is msPerCard × cards
 * §2 a human who times out gets the reserved card; with none reserved, choose(seat)
 * §3 ⭐ TIME ORDER — a bot pick at t=1000 hands a pack to a waiting human whose clock starts at
 *    1000, not at `now`; one late advance() therefore times that human out inside the same call
 * §4 ⭐ one advance() far in the future == ticking at every nextWake() == ticking every 333 ms
 *    (off the event grid, so every sweep runs late):
 *    the same picks, the same clocks (what a server restart or a slow sweep must not change)
 * §5 a new pack round opens at the moment the last one ended, every clock from then
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOT_DELAY_MS, advance, draftView, nextWake, pick, reserve, seatOf, startDraft } from '../cube-draft.ts';
import type { DraftState } from '../cube-types.ts';

const POOL = Array.from({ length: 200 }, (_, i) => `card${i}`);
/** a stand-in heuristic: the last card of the pack */
const last = (d: DraftState) => (seat: number): string => d.seats[seat]!.queue[0]!.at(-1)!;

/** one human ("h") at a table of bots */
function table(bots: number, seed: number, packSize = 5, ms = 1000): { d: DraftState; h: number } {
  const seats = [{ user: 'h', name: 'Human' }, ...Array.from({ length: bots }, (_, i) => ({ user: null, name: `Bot ${i + 1}` }))];
  const d = startDraft(seats, POOL, 3, packSize, seed, 0, ms);
  return { d, h: seatOf(d, 'h') };
}

test('cube §1 bots after a second, humans after msPerCard × cards', () => {
  const { d, h } = table(3, 1);
  assert.equal(nextWake(d), BOT_DELAY_MS);
  assert.equal(advance(d, BOT_DELAY_MS - 1, last(d)), false, 'nothing is due yet');
  assert.equal(draftView(d, h, 0, null).deadline, 5 * 1000);
  assert.equal(seatOf(d, 'nobody'), -1);
});

test('cube §2 a timeout takes the reserved card, else the suggestion', () => {
  const { d, h } = table(1, 2);
  const pack = [...d.seats[h]!.queue[0]!];
  const chosen: number[] = [];
  const choose = (seat: number): string => { chosen.push(seat); return d.seats[seat]!.queue[0]!.at(-1)!; };
  assert.ok(reserve(d, h, pack[1]!).ok);
  assert.equal(draftView(d, h, 0, null).reserved, pack[1]);
  advance(d, 5000, choose);
  assert.equal(d.seats[h]!.picks[0], pack[1], 'the reserved card, at the deadline');
  assert.ok(!chosen.includes(h), 'choose() is not asked when a card is reserved');
  assert.equal(d.seats[h]!.reserved, null, 'a pick clears the reservation');
  // no reservation: the human's next timeout asks choose()
  const next = [...d.seats[h]!.queue[0]!];
  while (d.seats[h]!.picks.length < 2) advance(d, nextWake(d)!, choose);
  assert.ok(chosen.includes(h));
  assert.equal(d.seats[h]!.picks[1], next.at(-1));
});

test('cube §3 a bot\'s pass starts the human\'s clock at the bot\'s pick time', () => {
  // two seats: the human picks at once, so the bot then holds both packs
  const { d, h } = table(1, 3);
  const b = 1 - h;
  assert.ok(pick(d, h, d.seats[h]!.queue[0]![0]!, 0).ok);
  assert.equal(d.seats[h]!.queue.length, 0);
  // the bot picks at 1000 and passes its 4 cards to the human: clock 1000 + 4 × 1000
  advance(d, 1000, last(d));
  assert.equal(d.seats[h]!.since, 1000);
  assert.equal(draftView(d, h, 1000, null).deadline, 5000);
  assert.equal(d.seats[b]!.since, 1000, 'the bot\'s waiting pack is current from 1000 too');
  // now from the same start, but the server sleeps until 5000 before its next sweep
  const late = table(1, 3).d;
  assert.ok(pick(late, h, late.seats[h]!.queue[0]![0]!, 0).ok);
  const at: [number, number][] = [];
  advance(late, 5000, seat => { at.push([seat, nextWake(late)!]); return late.seats[seat]!.queue[0]!.at(-1)!; });
  assert.deepEqual(at.slice(0, 2), [[b, 1000], [b, 2000]], 'the bot picks at 1000 and again at 2000');
  assert.ok(at.some(([s, t]) => s === h && t === 5000), 'the human times out at 1000 + 4 s, inside the same call');
  assert.equal(late.seats[h]!.picks.length, 2);
  for (let i = 1; i < at.length; i++) assert.ok(at[i]![1] >= at[i - 1]![1], 'events run in time order');
});

function finish(d: DraftState, how: 'once' | 'wake' | 'tick'): number[][] {
  const times: number[][] = d.seats.map(() => []);
  const choose = (seat: number): string => { times[seat]!.push(nextWake(d)!); return d.seats[seat]!.queue[0]!.at(-1)!; };
  if (how === 'once') advance(d, 1e12, choose);
  else if (how === 'wake') for (let t = nextWake(d); t != null; t = nextWake(d)) advance(d, t, choose);
  else for (let t = 0; !d.done; t += 333) advance(d, t, choose);
  return times;
}

test('cube §4 one late advance equals ticking at every wake, and every 333 ms', () => {
  for (const seed of [4, 5, 6]) {
    const runs = (['once', 'wake', 'tick'] as const).map(how => {
      const { d } = table(5, seed, 7, 500);
      // the human never clicks: every one of their picks is a timeout, interleaved with the bots'
      const times = finish(d, how);
      return { picks: d.seats.map(s => s.picks), times, done: d.done };
    });
    assert.ok(runs.every(r => r.done));
    assert.deepEqual(runs[1], runs[0], `seed ${seed}: per-wake ticking`);
    assert.deepEqual(runs[2], runs[0], `seed ${seed}: late 333 ms sweeps`);
  }
});

test('cube §5 the next round opens when the last pack empties, its clocks from then', () => {
  const { d: e, h } = table(2, 7);
  let ended = -1;
  const roundOf = (x: DraftState): number => x.round;
  for (let t = nextWake(e); t != null && roundOf(e) === 0; t = nextWake(e)) {
    advance(e, t, seat => e.seats[seat]!.queue[0]!.at(-1)!);
    if (roundOf(e) === 1) ended = t;
  }
  assert.ok(ended > 0);
  assert.ok(e.seats.every(s => s.since === ended && s.queue.length === 1 && s.queue[0]!.length === 5));
  assert.equal(draftView(e, h, ended, null).deadline, ended + 5 * 1000);
  assert.equal(draftView(e, h, ended, null).pickNo, 1);
  assert.equal(draftView(e, h, ended, null).direction, 'right');
});
