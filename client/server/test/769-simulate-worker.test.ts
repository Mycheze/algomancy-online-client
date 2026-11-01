/* /api/bot/simulate — THE WORKER: OFF THE MAIN THREAD, KILLED ON TIME, NEVER A QUEUE.
 *
 * simulate-worker.ts copies challenge-worker.ts's pattern with a chat
 * answer's numbers: one lazy worker, 2 s wall clock (kill and replace), a
 * 256 MB heap, at most 4 waiting, and "busy" past that.
 *
 * §1 a job runs in the worker and comes back whole; the clock starts only
 *    once the worker has booted (the first job does not pay for the import)
 * §2 ⭐ a job past the wall clock is answered "took longer than…", its
 *    worker is killed, and the NEXT job gets a fresh worker and a real answer
 * §3 ⭐ more than 4 waiting → busy, at once, and the rest still answer
 * §4 the numbers are the design's numbers
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOT_TIMEOUT_MS, JOB_TIMEOUT_MS, MAX_QUEUED, WORKER_HEAP_MB,
  setJobTimeoutForTests, simulateInWorker, simulatorStats, stopSimulator, warmSimulator,
} from '../simulate-worker.ts';

const SPEC = {
  you: { hand: ['Luminous Arc'], play: ['The Foretold'], resources: { fire: 3 } },
  opponent: { play: ['Towering Colossus'] },
  attack: [['you.0']],
  steps: [{ do: 'play', card: 'Luminous Arc', targets: ['opponent.0'] }],
};

after(async () => { await stopSimulator(); });

test('§1 a job runs in the worker and comes back whole', async () => {
  warmSimulator();
  assert.equal(simulatorStats().alive, true, 'warming starts a worker');
  const r = await simulateInWorker(SPEC, 'deadbeef');
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.engine, 'deadbeef', 'the main thread\'s engine stamp rides along');
  assert.equal(r.final.units.find(u => u.ref === 'opponent.0')!.damage, 6);
  assert.equal(simulatorStats().spawned, 1, 'warm + job = one worker');
  const again = await simulateInWorker({ you: { hand: ['Luminos Arc'] } }, 'deadbeef');
  assert.equal(again.ok, false, 'a refusal comes back as a result, not a throw');
});

test('§2 ⭐ past the wall clock: killed, answered, and replaced', async () => {
  const before = simulatorStats().spawned;
  setJobTimeoutForTests(1);   // an ordinary simulation now overruns
  try {
    const r = await simulateInWorker(SPEC, 'x');
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /took longer than 0\.001 s and was stopped/);
    assert.equal(r.limit, 'time');
    assert.equal(simulatorStats().alive, false, 'the overrunning worker is gone');
  } finally {
    setJobTimeoutForTests(JOB_TIMEOUT_MS);
  }
  const next = await simulateInWorker(SPEC, 'x');
  assert.equal(next.ok, true, `the next job gets a fresh worker: ${JSON.stringify(next)}`);
  assert.equal(simulatorStats().spawned, before + 1, 'exactly one replacement');
});

test('§3 ⭐ more than 4 waiting → busy at once; the rest answer', async () => {
  const jobs = Array.from({ length: MAX_QUEUED + 3 }, () => simulateInWorker(SPEC, 'x'));
  const out = await Promise.all(jobs);
  const busy = out.filter(r => !r.ok && r.busy);
  const ok = out.filter(r => r.ok);
  assert.ok(busy.length >= 2, `at least two of ${jobs.length} were refused busy (got ${busy.length})`);
  assert.equal(busy.length + ok.length, jobs.length, 'every other job got a real answer');
  for (const b of busy) assert.match(b.ok ? '' : b.error, /^busy/);
  assert.equal(simulatorStats().queued, 0);
});

test('§4 the design\'s numbers', () => {
  assert.equal(JOB_TIMEOUT_MS, 2000);
  assert.equal(MAX_QUEUED, 4);
  assert.equal(WORKER_HEAP_MB, 256);
  assert.ok(BOOT_TIMEOUT_MS > JOB_TIMEOUT_MS, 'booting has its own, longer, deadline');
});
