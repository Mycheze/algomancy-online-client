/* Pins a server under test to a fixed clock and fixed randomness. Loaded with
 * NODE_OPTIONS="--import <this file>" (ui-fixture.ts fixtureEnv does it), so
 * no server module changes; used by the UI screenshot tool (ui-shots.mjs).
 *
 *  · ALGO_FIXED_NOW (an ISO instant): `Date` starts there and then runs at
 *    real speed. It runs on rather than standing still because the server's
 *    brakes, offer timeouts and sweeps all measure Date.now() differences, and
 *    a clock that never moved would hold every brake shut for ever. What has to
 *    be stable is the DATE a stamp lands on, and a few seconds of drift from a
 *    fixed start moves no day, week boundary or league phase.
 *  · ALGO_FIXED_RANDOM (an integer seed): Math.random and crypto.randomInt
 *    become a seeded generator, so the Nth room code minted (main.ts, from
 *    randomInt) and the Nth room seed (rooms.ts, from Math.random) are the
 *    same on every run that mints them in the same order — a waiting room
 *    shows its code, and a photograph of it must not change between runs.
 *    Session tokens and password salts (randomBytes) are left alone.
 *
 * Either variable unset or unparseable: that half does nothing.
 */
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';

const Real = Date;
const base = Real.parse(process.env.ALGO_FIXED_NOW ?? '');
if (Number.isFinite(base)) {
  const t0 = Real.now();
  const now = () => base + (Real.now() - t0);
  class FixedDate extends Real {
    constructor(...args) {
      if (args.length === 0) super(now());
      else super(...args);
    }
    static now() { return now(); }
  }
  // `Date()` called without `new` returns a string, as the real one does
  globalThis.Date = new Proxy(FixedDate, {
    apply() { return new FixedDate().toString(); },
  });
}

const seed = Number.parseInt(process.env.ALGO_FIXED_RANDOM ?? '', 10);
if (Number.isFinite(seed)) {
  // xorshift32 — plenty for codes and seeds, and the same in every run
  let s = (seed >>> 0) || 0x9e3779b9;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  Math.random = next;
  const realRandomInt = crypto.randomInt;
  crypto.randomInt = function randomInt(min, max, cb) {
    if (typeof max !== 'number') { cb = max; max = min; min = 0; }
    if (typeof cb === 'function') return realRandomInt.call(crypto, min, max, cb);
    return min + Math.floor(next() * (max - min));
  };
  // a named `import { randomInt } from 'node:crypto'` reads the ESM facade
  syncBuiltinESMExports();
}
