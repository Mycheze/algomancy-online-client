/* BL-17, first slice — the trust mark, and the report that carries it
 * (run: node test-badge.ts).
 *
 * The owner, 2026-09-05, working the first live game's reports: "check what
 * kind of account left the report. mycheze should be set to 'me' (owner) and
 * 'judge level 1'." A report row said which SEAT filed it and nothing about
 * the person. Now:
 *
 *   §1 POST /api/admin/badge is 404 without the tester token, and 404 with
 *      the wrong one — the same fail-closed shape as the scenario tester
 *   §2 with the token it sets {owner, judge} on a named account, /api/player
 *      and /api/me both show it, and a clear removes it
 *   §3 a report filed with that account's session carries `by` = the account
 *      AND its mark; a signed-out report carries `by: null`
 *   §4 the stamp is a SNAPSHOT: revoking the badge afterwards does not change
 *      what the row said
 *   §5 the row must not trust the body: a `by` typed into the request is
 *      ignored, and a wrong bearer is a signed-out report, not a 401
 *
 * Its own accounts file and issues file in a scratch dir, like test-report.ts.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer } from './test-util.ts';
import type { IssueRow } from './report-fields.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-badge-test-'));
const ISSUES = join(SCRATCH, 'issues.jsonl');
const TOKEN = 'tester-secret-for-the-badge-test';

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const server = await spawnServer({
  ALGO_ISSUES_FILE: ISSUES, ALGO_GAMES_DIR: join(SCRATCH, 'games'),
  ALGO_ACCOUNTS_FILE: join(SCRATCH, 'accounts.json'), ALGO_TESTER_TOKEN: TOKEN,
});
const base = `http://localhost:${server.port}`;
type J = Record<string, unknown>;
async function call(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: J }> {
  const res = await fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: J = {};
  try { json = JSON.parse(text) as J; } catch { json = { raw: text }; }
  return { status: res.status, json };
}
const get = async (path: string, headers: Record<string, string> = {}): Promise<J> =>
  (await fetch(base + path, { headers })).json() as Promise<J>;
const rows = (): IssueRow[] => readFileSync(ISSUES, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as IssueRow);

try {
  const reg = await call('/api/auth/register', { username: 'mycheze', password: 'hunter22' });
  eq(reg.json['ok'], true, 'fixture: an account');
  const session = String(reg.json['token']);
  const bearer = { authorization: `Bearer ${session}` };

  console.log('\n[§1 the gate]');
  const noTok = await call('/api/admin/badge', { name: 'mycheze', owner: true });
  eq(noTok.status, 404, 'no tester token → 404, not 401/403');
  const badTok = await call('/api/admin/badge', { name: 'mycheze', owner: true }, { 'x-algo-tester': 'nope' });
  eq(badTok.status, 404, 'wrong token → 404');
  eq((await get('/api/player?name=mycheze') as { player: J })['player']['badge'], null, 'and nothing was set');
  const noName = await call('/api/admin/badge', { name: 'nobody' }, { 'x-algo-tester': TOKEN });
  eq(noName.status, 404, 'an unknown account is a 404 with a reason');

  console.log('\n[§2 set, shown, cleared]');
  const set = await call('/api/admin/badge', { name: 'mycheze', owner: true, judge: 1 }, { 'x-algo-tester': TOKEN });
  eq(set.status, 200, 'set');
  const badge = set.json['badge'] as J;
  eq(badge['owner'], true, 'owner');
  eq(badge['judge'], 1, 'judge L1');
  ok(typeof badge['since'] === 'string', 'stamped with when');
  const pub = (await get('/api/player?name=mycheze') as { player: J })['player']['badge'] as J;
  eq(pub['owner'], true, '/api/player shows the owner mark');
  eq(pub['judge'], 1, '/api/player shows the judge level');
  const mine = (await get('/api/me', bearer) as { me: J })['me']['badge'] as J;
  eq(mine['judge'], 1, '/api/me shows it too');
  const bogus = await call('/api/admin/badge', { name: 'mycheze', owner: 'yes', judge: 7 }, { 'x-algo-tester': TOKEN });
  eq(bogus.json['badge'], null, 'owner:"yes" and judge:7 are neither — the badge is cleared, never garbage');
  const j2 = await call('/api/admin/badge', { name: 'mycheze', judge: 2 }, { 'x-algo-tester': TOKEN });
  eq((j2.json['badge'] as J)['owner'], undefined, 'a judge-only mark has no owner flag');
  await call('/api/admin/badge', { name: 'mycheze', owner: true, judge: 1 }, { 'x-algo-tester': TOKEN });

  console.log('\n[§3 the report carries who filed it]');
  const r1 = await call('/api/report', { room: 'VNNW', seat: 0, note: 'signed in', kind: 'ux', severity: 'medium' }, bearer);
  eq(r1.status, 200, 'accepted');
  const by = rows()[0]!.by!;
  eq(by.name, 'mycheze', 'the name');
  eq(by.id, reg.json['me'] && (reg.json['me'] as J)['id'], 'the account id');
  eq(by.owner, true, 'the owner mark');
  eq(by.judge, 1, 'the judge level');
  const r2 = await call('/api/report', { room: 'VNNW', seat: 1, note: 'signed out', kind: 'bug', severity: 'minor' });
  eq(r2.status, 200, 'a signed-out report is still accepted');
  eq(rows()[1]!.by, null, 'and says so: by = null, not absent');

  console.log('\n[§4 the stamp is a snapshot]');
  await call('/api/admin/badge', { name: 'mycheze' }, { 'x-algo-tester': TOKEN });   // revoke
  eq((await get('/api/player?name=mycheze') as { player: J })['player']['badge'], null, 'revoked');
  eq(rows()[0]!.by!.owner, true, 'the earlier row still says owner');
  const r3 = await call('/api/report', { room: 'VNNW', seat: 0, note: 'after revoke', kind: 'other' }, bearer);
  eq(r3.status, 200, 'accepted');
  const by3 = rows()[2]!.by!;
  eq(by3.name, 'mycheze', 'still credited to the account');
  eq(by3.owner, undefined, 'but with no mark now');

  console.log('\n[§5 the body cannot forge it]');
  const forged = await call('/api/report', {
    room: 'VNNW', seat: 0, note: 'forged', kind: 'bug', severity: 'gamebreaking',
    by: { id: 'x', name: 'Caleb', owner: true, judge: 3 },
  });
  eq(forged.status, 200, 'accepted');
  eq(rows()[3]!.by, null, 'a `by` typed into the body is ignored — signed out is signed out');
  const wrong = await call('/api/report', { room: 'VNNW', seat: 0, note: 'stale session', kind: 'other' },
    { authorization: 'Bearer not-a-session' });
  eq(wrong.status, 200, 'a wrong bearer is still a logged report (the note is the part that cannot be reconstructed)');
  eq(rows()[4]!.by, null, '…filed as signed out');
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
