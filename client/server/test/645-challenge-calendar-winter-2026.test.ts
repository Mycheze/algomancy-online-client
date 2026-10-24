/* WEEKLY CHALLENGES — the weeks from 15 Nov 2026 (server/challenges.ts,
 * docs/21). Test 506 replays every row's reference run and pins its score;
 * this holds what 506 does not look at:
 *
 * §1 the calendar: The Parade is off it (its run parked where the gate does
 *    not replay it), the eight new weeks follow Counting Up a week at a time
 *    from Sun 15 Nov, and 12 Grafts of Christmas is the week of Sun 20 Dec
 * §2 each reference run does what its goal says, read off the boards it
 *    plays: the full graft ladder 1..12; the One and Done dummy dies from 60 in
 *    the one action that took its life; the Own Goal dummy wins while its own
 *    trigger resolves; the Spending Spree player opens more than two
 *    resources in one planning step (the emblem used)
 * §3 a bug report filed from any new week keeps its goal AND its setup —
 *    report-run.ts rebuilds both, and a run re-dealt without its setup would
 *    be a different game
 * §4 the admin Challenges tab row carries the setup
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../../engine/src/cards/registry.ts';
import { apply, createGame } from '../../engine/src/apply.ts';
import {
  DUMMY, DUMMY_DECK, PLAYER, challengeDeal, foldRun, newRun, verifyRun, type ChallengeDef, type RunAcc,
} from '../../engine/src/challenge.ts';
import type { Action, CardName, EngineEvent, GameState } from '../../engine/src/types.ts';
import { CHALLENGES, REFERENCE_RUNS_DIR, WEEK_MS, challengeById, weekWindow } from '../challenges.ts';
import { sanitizeReportRun } from '../report-run.ts';
import { adminChallenges, resetReferenceRuns, settleReferenceRuns } from '../admin-challenges.ts';
import { stopChallengeWorker } from '../challenge-worker.ts';

test.after(async () => { await settleReferenceRuns(); resetReferenceRuns(); await stopChallengeWorker(); });

const NEW = ['2026-11-15-set', '2026-11-22-draw', '2026-11-29-owngoal', '2026-12-06-oneshot',
  '2026-12-13-health', '2026-12-20-grafts', '2026-12-27-spree', '2027-01-03-stack'];

const ref = (id: string) => JSON.parse(readFileSync(join(REFERENCE_RUNS_DIR, `${id}.json`), 'utf8')) as { deck: CardName[]; actions: Action[] };

/** walk a row's reference run as verifyRun cuts it: each step's board, events and fold */
function walk(id: string): { def: ChallengeDef; steps: { before: GameState; a: Action; after: GameState; events: EngineEvent[]; acc: RunAcc }[] } {
  const def = challengeById(id)!;
  const r = ref(id);
  const v = verifyRun(def, r.deck, r.actions);
  assert.ok(v.ok, v.ok ? '' : `${id}: ${v.error}`);
  let s = createGame(def.seed, ['Challenger', 'Dummy'], 'constructed', undefined, [r.deck, [...DUMMY_DECK]], undefined, challengeDeal(def)).state;
  let acc = newRun(def.goal, r.deck);
  const steps = [];
  for (const a of v.actions) {
    const x = apply(s, a);
    acc = foldRun(acc, s, a, x.state, x.events);
    steps.push({ before: s, a, after: x.state, events: x.events, acc });
    s = x.state;
  }
  return { def, steps };
}

test('§1 The Parade is parked, and the eight new weeks run from Sun 15 Nov with the grafts on 20 Dec', () => {
  assert.equal(challengeById('2026-11-22-parade'), null, 'off the calendar');
  assert.ok(existsSync(join(REFERENCE_RUNS_DIR, 'parked', '2026-11-22-parade.json')), 'its run kept for later');
  assert.ok(!existsSync(join(REFERENCE_RUNS_DIR, '2026-11-22-parade.json')), 'and not where the gate replays');
  const i = CHALLENGES.findIndex(c => c.id === '2026-11-15-counters');
  const rows = CHALLENGES.slice(i + 1);
  assert.deepEqual(rows.map(c => c.id), NEW);
  let prev = weekWindow(CHALLENGES[i]!);
  for (const c of rows) {
    const w = weekWindow(c);
    assert.equal(w.opens, prev.closes, `${c.id} opens as the week before closes`);
    assert.equal(w.closes - w.opens, WEEK_MS);
    prev = w;
  }
  assert.equal(new Date(weekWindow(rows[0]!).opens).toISOString(), '2026-11-15T07:00:00.000Z');
  assert.equal(challengeById('2026-12-20-grafts')!.week, '2026-12-20', 'Christmas week');
  for (const c of rows) assert.ok(!/one game|course of/i.test(c.blurb), `${c.id}: the challenge is the game`);
});

test('§2 each reference run does what its goal says', () => {
  // the full ladder
  const grafts = walk('2026-12-20-grafts');
  assert.deepEqual(grafts.steps.at(-1)!.acc.graftSizes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  // One and Done: untouched at 60 until the one action that kills it
  const one = walk('2026-12-06-oneshot');
  const kill = one.steps.at(-1)!;
  assert.equal(kill.before.players[DUMMY]!.life, 60);
  assert.ok(kill.after.players[DUMMY]!.life <= 0 && kill.after.winner === PLAYER);
  assert.equal(kill.events.filter(e => e.type === 'lifeLost' && (e.data as { seat?: number }).seat === DUMMY).length, 1, 'one blow');
  assert.ok(one.steps.slice(0, -1).every(x => x.after.players[DUMMY]!.life === 60), 'never touched before');
  // Own Goal: the dummy wins, while an item it controls resolves
  const own = walk('2026-11-29-owngoal');
  const end = own.steps.at(-1)!;
  assert.equal(end.after.winner, DUMMY);
  assert.equal(end.acc.ended, 'dummyWon');
  // Spending Spree: the emblem is used — more than two activations in one planning step
  const spree = walk('2026-12-27-spree');
  const perTurn = new Map<number, number>();
  for (const x of spree.steps) if (x.a.type === 'activateResource' && x.a.seat === PLAYER) perTurn.set(x.before.turn, (perTurn.get(x.before.turn) ?? 0) + 1);
  assert.ok(Math.max(...perTurn.values()) > 2, `activations per turn: ${[...perTurn.values()].join(' ')}`);
  assert.ok((spree.steps.at(-1)!.acc.manaSpent ?? 0) >= 50);
});

test('§3 a report from a new week keeps its goal and its setup', () => {
  for (const id of NEW) {
    const def = challengeById(id)!;
    const r = ref(id);
    const out = sanitizeReportRun({
      kind: 'challenge',
      def: { id: def.id, week: def.week, title: def.title, goal: def.goal, seed: def.seed, par: def.par, ...(def.setup ? { setup: def.setup } : {}) },
      deck: r.deck, actions: r.actions, at: 10,
    });
    assert.ok(out.ok, out.ok ? '' : `${id}: refused (${out.why})`);
    assert.ok(out.run.kind === 'challenge');
    assert.deepEqual(out.run.def.goal, def.goal, `${id}: goal`);
    assert.deepEqual(out.run.def.setup, def.setup, `${id}: setup`);
    // and the deal it re-creates is the row's
    assert.deepEqual(challengeDeal({ ...def, ...out.run.def, blurb: '' }), challengeDeal(def));
  }
});

test('§4 the admin Challenges tab row carries the setup', async () => {
  const rows = (await adminChallenges(Date.parse('2026-11-20T00:00:00Z'), CHALLENGES, 0)).rows;
  assert.deepEqual(rows.find(r => r.id === '2026-12-06-oneshot')!.setup, { dummyLife: 60 });
  assert.deepEqual(rows.find(r => r.id === '2026-12-27-spree')!.setup, { emblem: 'anyActivations' });
  assert.equal(rows.find(r => r.id === '2026-11-15-set')!.setup, undefined);
});
