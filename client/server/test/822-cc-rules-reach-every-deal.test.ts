/* docs/22 §3.1, Risk 2 — EVERY DEAL OF A SAVED ROOM PASSES ITS `rules`.
 *
 * A CC game's rules are part of its deal (sequential steps; games 2-3's chosen
 * initiative). A deal site that forgets them re-deals game 2 under the house
 * rules with the ROLLED initiative: a different game, replayed as if it were
 * the one played, and nothing else would notice. This is the only net, in the
 * shape of test-custom-rules.ts's scan for `custom?.deal`.
 *
 *   §1 every fresh() / rebuild() in rooms.ts passes `rules`, and dealScenario
 *      hands it to createGame
 *   §2 EVERY deal call in server/ and ui/ is classified: a site that deals a
 *      saved room (must pass rules), or one that never deals a CC room (its
 *      reason written down). A new deal site fails here until somebody decides.
 *   §3 the room-file dealers owned by later workstreams (W4: stats, the card
 *      ledger, replay-room, the probe; W6: the replay viewer) are listed as
 *      PENDING, and the list cannot rot: a pending site that now passes rules
 *      fails until it is taken off it
 *   §4 a room restored from its file is re-dealt with its rules: the chosen
 *      initiative survives, and an unreadable `rules` refuses the restore
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ccFixture } from './cc-match-fixture.ts';

const CLIENT = join(import.meta.dirname, '..', '..');
const SRC = (f: string): string => readFileSync(join(CLIENT, f), 'utf8');

/** every call `name(...)` in `src` that is code, not a comment or the definition */
function callsOf(src: string, name: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(new RegExp(`(?<![.\\w])${name}\\(`, 'g'))) {
    const start = m.index!;
    const lineStart = src.lastIndexOf('\n', start) + 1;
    const before = src.slice(lineStart, start);
    if (/^\s*(\*|\/\/|\/\*)/.test(before) || /function\s+$/.test(before) || /`[^`]*$/.test(before) || /\/\/.*$/.test(before)) continue;
    let depth = 0, i = start + name.length;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    out.push(src.slice(start, i + 1));
  }
  return out;
}
const DEALS = ['createGame', 'dealScenario', 'fresh', 'rebuild', 'replay'];
const passesRules = (call: string): boolean => /\brules\b/.test(call);

/** files that deal a SAVED ROOM (a CC game among them) — each call must pass rules */
const ROOM_DEALERS = ['server/rooms.ts', 'server/scenarios.ts', 'server/stats.ts', 'server/cardledger.ts',
  'server/replay-room.ts', 'server/replay-probe.ts', 'ui/replayserver.ts'];
/** room-file dealers not yet threaded, and whose job it is (docs/22 §7) */
const PENDING: Record<string, string> = {
  'server/stats.ts': 'W4', 'server/cardledger.ts': 'W4', 'server/replay-room.ts': 'W4',
  'server/replay-probe.ts': 'W4',
};
/** files that deal, but never a CC room — and why */
const NEVER_CC: Record<string, string> = {
  'server/challenge-solve.ts': 'a weekly challenge: a solo constructed deal of its own',
  'server/simulate.ts': 'the board simulator: a filler deal',
  'ui/questions.ts': 'the question board: a fixed shared-mode deal',
  'ui/main.ts': 'NO_GAME, the placeholder before a room exists',
};

test('§1 rooms.ts passes rules at every fresh() and rebuild(); dealScenario hands it on', () => {
  const rooms = SRC('server/rooms.ts');
  const calls = [...callsOf(rooms, 'fresh'), ...callsOf(rooms, 'rebuild')];
  assert.ok(calls.length >= 10, `non-vacuous: ${calls.length} calls`);
  for (const call of calls) assert.ok(passesRules(call), `rooms.ts forgets rules: ${call.replace(/\s+/g, ' ').slice(0, 120)}`);
  const sc = callsOf(SRC('server/scenarios.ts'), 'createGame');
  assert.equal(sc.length, 1);
  assert.ok(passesRules(sc[0]!), 'dealScenario passes rules to createGame');
});

test('§2-§3 every deal site in server/ and ui/ is classified, and the pending list is honest', () => {
  const found = new Set<string>();
  for (const dir of ['server', 'ui']) {
    for (const f of readdirSync(join(CLIENT, dir)).filter(x => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      const file = `${dir}/${f}`;
      const src = SRC(file);
      const calls = DEALS.flatMap(n => callsOf(src, n))
        // replay() is the engine's; an unrelated `replay(` (a method, a local) is not a deal
        .filter(c => !/^replay\(/.test(c) || /\bseed\b|\.seed\b/.test(c))
        .filter(c => !/^(fresh|rebuild)\(/.test(c) || file === 'server/rooms.ts');
      if (!calls.length) continue;
      found.add(file);
      if (ROOM_DEALERS.includes(file)) {
        const missing = calls.filter(c => !passesRules(c));
        if (PENDING[file]) {
          assert.ok(missing.length > 0, `${file} now passes rules everywhere — take it off PENDING (${PENDING[file]} did it)`);
        } else {
          assert.deepEqual(missing, [], `${file} deals a saved room without its rules`);
        }
        continue;
      }
      assert.ok(NEVER_CC[file], `${file} deals a game (${calls[0]!.replace(/\s+/g, ' ').slice(0, 80)}) — classify it: a saved-room dealer must pass rules`);
    }
  }
  // the lists name only files that really deal, so neither can go stale
  for (const f of [...ROOM_DEALERS, ...Object.keys(NEVER_CC)]) assert.ok(found.has(f), `${f} is listed but deals nothing — take it off`);
});

test('§4 a restore re-deals with the saved rules, and refuses rules it cannot read', async () => {
  const F = await ccFixture('t822');
  const { R, M } = F;
  const { room, m } = F.start(3);
  F.concede(room, 0);
  const g2 = F.current(m);
  F.seatUp(g2, 0, 1);
  M.matchSeatJoined(g2);
  const init = room.state.initiative === 0 ? 1 : 0;   // the opposite of game 1's roll, so the override is visible
  M.matchOp(g2, 1, 'ready', { ready: true });
  M.matchOp(g2, 0, 'ready', { ready: true, initiative: init });
  assert.equal(g2.state.initiative, init);
  const file = join(F.DIR, 'games', `${g2.code}.json`);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(raw.rules, { sequential: true, initiative: init }, 'the rules are saved beside the seed');
  assert.deepEqual(raw.match, { id: m.id, game: 2 });
  const fresh = await import(`../rooms.ts?r822=${Math.random()}`) as typeof R;
  fresh.restoreRooms();
  const back = fresh.getRoom(g2.code)!;
  assert.equal(back.state.sequential, true, 'restored as a CC game');
  assert.equal(back.state.initiative, init, 'with the chosen initiative, not the roll');
  assert.deepEqual(back.match, { id: m.id, game: 2 });
  // unreadable rules: refused, never a standard game
  writeFileSync(file, JSON.stringify({ ...raw, rules: { sequential: true, initiative: 0, mystery: 1 } }));
  const again = await import(`../rooms.ts?r822b=${Math.random()}`) as typeof R;
  again.restoreRooms();
  assert.equal(again.getRoom(g2.code), undefined, 'refused rather than re-dealt under the house rules');
  assert.throws(() => R.restoreRules({ sequential: true }, 'draft'), /cannot read/, 'CC rules belong to constructed only');
});
