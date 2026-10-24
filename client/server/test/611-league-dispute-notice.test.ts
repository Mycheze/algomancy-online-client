/* 611 — A DISPUTED LEAGUE GAME TELLS THE ORGANIZERS (CT-339, BL-48).
 *
 * A dispute flags the match on the organizer's view and in the season log
 * (520 §5). Until CT-339 nothing TOLD anybody: no bell line, no Discord
 * message, so a dispute waited until somebody happened to open the match.
 * It now writes one outbox row per organizer (an admin account), which is
 * the same row every other league message is — the bell reads it
 * (notesFor), the bot DMs it (/api/league/bot/outbox).
 *
 *   §1 ⭐ a dispute through the real fileDispute leaves a 'dispute' row for
 *      each organizer, naming who, against whom, the game and what they said;
 *      it is in that organizer's bell and in the bot's pending outbox
 *   §2 the player who filed it is not told about their own dispute, even
 *      when they are an organizer; a dispute that flags no match sends nothing
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Seat } from '../../engine/src/types.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-611-'));
process.env['ALGO_GAMES_DIR'] = join(DIR, 'games');
process.env['ALGO_ISSUES_FILE'] = join(DIR, 'issues.jsonl');
const R = await import('../rooms.ts');
const A = await import('../accounts.ts');
const L = await import('../league-store.ts');
const { fileDispute } = await import('../dispute.ts');
const { GRID_LEN } = await import('../league.ts');

const restoreAccounts = A.useAccountsFile(join(DIR, 'accounts.json'));
const restoreLeague = L.useLeagueFile(join(DIR, 'league.json'));
test.after(() => { restoreLeague(); restoreAccounts(); rmSync(DIR, { recursive: true, force: true }); });

for (const n of ['Ann611', 'Bo611', 'Org611', 'Org611b']) assert.ok(A.register(n, 'correct horse battery').ok);
const ann = A.accountByName('Ann611')!, bo = A.accountByName('Bo611')!;
const org = A.accountByName('Org611')!, org2 = A.accountByName('Org611b')!;
A.setAdmin(org, true); A.setAdmin(org2, true);

const OPEN = Date.parse('2026-10-04T09:00:00Z'), WEEK1 = Date.parse('2026-10-11T07:00:00Z'), HOUR = 3_600_000;
assert.ok(L.createSeason({ id: 'dp611', name: 'Test 611', signupOpens: new Date(OPEN).toISOString(), start: new Date(WEEK1).toISOString(), weeks: 3, perWeek: 2, auto: false, hidden: false }, OPEN - HOUR).ok);
const season = L.seasonById('dp611')!;
L.advance(season, OPEN);
const grid = new Array<string>(GRID_LEN).fill('1').join('');
for (const a of [ann, bo, org]) { A.setLeagueAvailability(a, 'Europe/London', grid); A.setLeagueContact(a, `${a.username}_dc`); L.joinSeason(season, a, OPEN + 1); }

/** a sign-up week match between `x` and `y`, settled by room `code` in `winner`'s favour */
function settled(x: typeof ann, y: typeof ann, code: string, seed: number, winner: typeof ann): { room: import('../rooms.ts').Room; match: string } {
  const ch = L.challenge(season, x, y.id, OPEN + HOUR);
  assert.ok(ch.ok, ch.ok ? '' : ch.error);
  const match = ch.ok ? ch.match : '';
  const room = R.createRoom(code, seed, [x.username, y.username]);
  R.setSeatUser(room, 0, x.id); R.setSeatUser(room, 1, y.id);
  const loser: Seat = winner === x ? 1 : 0;
  R.applyToRoom(room, { type: 'concede', seat: loser });
  room.league = { season: 'dp611', match };
  assert.ok(L.recordPlayed(match, winner.id, code, OPEN + 2 * HOUR), 'fixture: the room settled the match');
  return { room, match };
}

const disputeRows = (to: string) => L.outboxRows().filter(r => r.to === to && r.kind === 'dispute');

test('§1 BL-48 / CT-339: a disputed league game sends every organizer a bell line and a Discord message', async () => {
  const { room, match } = settled(ann, bo, 'D611A', 61100, bo);
  const r = await fileDispute(room, 0, 'Bo won off a bugged trigger', OPEN + 3 * HOUR);
  assert.ok(r.ok && r.row.dispute?.league === match, 'fixture: the dispute flagged the league match');
  for (const o of [org, org2]) {
    const rows = disputeRows(o.id);
    assert.equal(rows.length, 1, `⭐ ${o.username} was sent nothing about the dispute`);
    const d = rows[0]!.data as Record<string, any>;
    assert.equal(rows[0]!.season, 'dp611');
    assert.deepEqual([d['by']?.name, d['opponent']?.name, d['code'], d['match']], ['Ann611', 'Bo611', 'D611A', match]);
    assert.match(String(d['note']), /bugged trigger/, 'with what they said');
    assert.deepEqual(d['ids'], [ann.id, bo.id], 'both players are named, so the bot can mention them');
    const bell = L.notesFor(o.id, OPEN + 4 * HOUR).filter(n => n.kind === 'dispute');
    assert.equal(bell.length, 1, `⭐ ${o.username}'s bell does not have it`);
    assert.equal(bell[0]!.read, false);
    assert.ok(L.pendingOutbox(500).some(p => p.id === rows[0]!.id), 'and the bot has it to send');
  }
  assert.equal(disputeRows(ann.id).length + disputeRows(bo.id).length, 0, 'the players are not sent the organizer notice');
});

test('§2 the one who filed it is not told, even as an organizer; a dispute that flags no match sends nothing', async () => {
  const before = L.outboxRows().filter(r => r.kind === 'dispute').length;
  const [mine, theirs] = [disputeRows(org.id).length, disputeRows(org2.id).length];
  const { room } = settled(org, bo, 'D611B', 61101, bo);
  assert.ok((await fileDispute(room, 0, 'the organizer disputes his own game', OPEN + 5 * HOUR)).ok);
  assert.equal(disputeRows(org.id).length, mine, 'the organizer who filed it hears nothing of it');
  assert.equal(disputeRows(org2.id).length, theirs + 1, 'the other organizer does');
  // a friendly in a league room after the match is settled flags nothing, so it tells nobody
  const friendly = R.createRoom('D611C', 61102, ['Ann611', 'Bo611']);
  R.setSeatUser(friendly, 0, ann.id); R.setSeatUser(friendly, 1, bo.id);
  R.applyToRoom(friendly, { type: 'concede', seat: 0 });
  friendly.league = { season: 'dp611', match: room.league!.match };
  const f = await fileDispute(friendly, 0, 'a friendly', OPEN + 6 * HOUR);
  assert.ok(f.ok && f.row.dispute?.league === undefined);
  assert.equal(L.outboxRows().filter(r => r.kind === 'dispute').length, before + 1, 'one new row in this test, to the other organizer');
});
