/* docs/22 §2.3, §3.1 — A SAVED CC GAME REPLAYS AS THE GAME THAT WAS PLAYED.
 *
 * A CC game's rules are part of its deal: sequential steps, and in games 2-3
 * the initiative the previous game's loser CHOSE. Every reader that re-deals a
 * saved room — the stats summary, the card ledger, replay-room, the replay
 * probe — must deal it with them, or game 2 is re-dealt with the ROLLED
 * initiative: another game, replayed as if it were this one. Test 822 scans
 * the call sites; this file runs them on a real game 2 whose chosen
 * initiative is the opposite of its seed's roll.
 *
 *   §1 ⭐ the card ledger's replay verifies against the recorded fingerprints
 *      to the end, and its opening says who had the initiative
 *   §2 ⭐ replay-room's analysis reproduces every recorded fingerprint
 *   §3 ⭐ the replay probe deals the same board (the same fingerprints), and
 *      refuses rules it cannot read rather than deal the house-rules game
 *   §4 ⭐ the stats summary replays it whole, and a file whose rules this build
 *      cannot read is summarized as unplayable, never as a standard game
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CardName, Seat } from '../../engine/src/types.ts';
import { createGame, legalActions } from '../../engine/src/apply.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t827');
const WALK = 40;
const CL = await import('../cardledger.ts');
const RR = await import('../replay-room.ts');
const P = await import('../replay-probe.ts');
const ST = await import('../stats.ts');
test.after(() => rmSync(F.DIR, { recursive: true, force: true }));

// game 1, then game 2 with the initiative the roll would NOT have given
const { room: G1, m } = F.start(3);
F.concede(G1, 0);
const G2 = F.current(m);
F.seatUp(G2, 0, 1);
F.M.matchSeatJoined(G2);
const mains = [m.current[0]!.main, m.current[1]!.main] as [CardName[], CardName[]];
const ROLL = createGame(G2.seed, G2.names, 'constructed', G2.els, mains).state.initiative;
const CHOSEN: Seat = ROLL === 0 ? 1 : 0;
// the chooser (game 1's loser, seat 0) readies with the choice
F.M.matchOp(G2, 1, 'ready', { ready: true });
F.M.matchOp(G2, 0, 'ready', { ready: true, initiative: CHOSEN });
// a real stretch of game: 40 actions, the initiative player's last legal one
// first — the sequential steps and the battle all hang on who has the
// initiative, so the same log dealt with the roll is refused along the way
for (let k = 0; k < WALK && G2.state.winner === null; k++) {
  const seat = ([G2.state.initiative, G2.state.initiative === 0 ? 1 : 0] as Seat[])
    .find(s => legalActions(G2.state, s).some(a => a.type !== 'concede'));
  if (seat === undefined) break;
  const options = legalActions(G2.state, seat).filter(a => a.type !== 'concede');
  F.R.applyToRoom(G2, options[options.length - 1]!);
}
if (G2.state.winner === null) F.concede(G2, 1);
else F.M.matchGameDecided(G2);
const RAW = JSON.parse(readFileSync(join(F.DIR, 'games', `${G2.code}.json`), 'utf8')) as Record<string, unknown> & {
  seed: number; actions: unknown[]; sigs: string[]; rules: unknown;
};
const N = RAW.actions.length;

test('§0 the game is the one this file needs', () => {
  assert.equal(G2.state.initiative, CHOSEN, 'game 2 was dealt with the chosen initiative');
  assert.notEqual(CHOSEN, ROLL, 'which is NOT what its seed rolls (so a deal without the rules is another game)');
  assert.deepEqual(RAW.rules, { sequential: true, initiative: CHOSEN }, 'its file carries the rules');
  assert.ok(N > WALK / 2 && RAW.sigs.length === N && RAW.sigs.every(Boolean), `a real log with a fingerprint per action (${N})`);
  // non-vacuous: dealt with the roll, this log is another game
  const plain = ST.summarizeGame({ ...RAW, rules: undefined, code: G2.code } as never);
  assert.ok(plain.skipped > 0, `dealt WITHOUT its rules the log is refused along the way (${plain.skipped} of ${N})`);
});

test('§1 ⭐ the card ledger replay verifies to the end and opens with the chosen initiative', () => {
  // without the live record, the ledger has to replay the file and check it
  const { cardLog: _l, cardOpen: _o, ...replayOnly } = RAW;
  const r = CL.ledgerForFile(replayOnly as never);
  assert.equal(r.audit.source, 'replay-sigs', `⭐ verified by the fingerprints: ${r.audit.why}`);
  assert.equal(r.audit.validUpTo, N);
  assert.equal(r.ledger.init, CHOSEN, 'the opening says who had the initiative');
  const bad = CL.ledgerForFile({ ...replayOnly, rules: { sequential: true, initiative: 7 } } as never);
  assert.notEqual(bad.audit.source, 'replay-sigs', 'unreadable rules are not dealt as a standard game');
});

test('§2 ⭐ replay-room reproduces every recorded fingerprint', () => {
  const an = RR.analyze(RAW as never);
  assert.equal(an.refusals.length, 0);
  assert.deepEqual(an.sigs, RAW.sigs, '⭐ the replay is the game that was played');
  assert.equal(an.state.initiative, CHOSEN);
  assert.ok(RR.unreplayableReason({ ...RAW, rules: { sequential: false } } as never),
    'a file whose rules this build cannot read is unreplayable, not a divergence');
});

test('§3 ⭐ the replay probe deals the same board, and refuses rules it cannot read', async () => {
  const r = await P.probe(RAW as never);
  assert.equal(r.ok, true, r.error ?? "");
  assert.deepEqual(r.sigs.slice(1).map(P.digest), RAW.sigs, '⭐ the same fingerprints, action by action');
  const bad = await P.probe({ ...RAW, rules: { sequential: true, mystery: 1 } } as never);
  assert.equal(bad.ok, false);
  assert.match(bad.error ?? '', /cannot read/);
});

test('§4 ⭐ the stats summary replays it whole; unreadable rules are unplayable', () => {
  const s = ST.summarizeGame({ ...RAW, code: G2.code } as never);
  assert.equal(s.skipped, 0, '⭐ every action applied: the game that was played');
  assert.equal(s.finished, true);
  assert.equal(s.winner, G2.winner ?? F.R.decidedWinner(G2));
  const bad = ST.summarizeGame({ ...RAW, code: G2.code, rules: { sequential: true, initiative: 'x' } } as never);
  assert.equal(bad.skipped, N, 'nothing dealt: the summary refuses rather than replay another game');
  assert.equal(bad.finished, false);
});
