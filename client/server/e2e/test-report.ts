/* T6 — /api/report carries the form's two choices, and stores what it can
 * make sense of (run: node test-report.ts).
 *
 * The owner's ask (polish round 2026-09-05): the 🐛 button becomes a form —
 * a type (bug / UX-UI issue / feature request / other), a severity (minor /
 * medium / game breaking), then the note. The server's half of that is two
 * fields on the issues.jsonl row, validated against report-fields.ts.
 *
 *   §1 a well-formed report lands with kind + severity on the row, and the
 *      row still has everything it had before (ts, room, seat, note,
 *      actionIndex) — the readers of this file predate the form.
 *   §2 a bad value is COERCED, not refused: an unknown kind is 'other', an
 *      unknown severity is null, and the note is still logged. The note is
 *      the part that cannot be reconstructed; a 400 over a typo'd enum would
 *      throw it away.
 *   §3 the old body shape — no kind, no severity, i.e. a tab that loaded the
 *      client before the deploy — is accepted the same way.
 *   §4 an oversize kind (a 5 KB string where an enum goes) is 'other' and the
 *      row is one line: the brake on the note's length still holds.
 *
 * Its own ALGO_ISSUES_FILE in a scratch dir: var/issues.jsonl is the owner's
 * live data and this test appends four rows.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer } from './test-util.ts';
import { REPORT_KINDS, REPORT_SEVERITIES, reportKind, reportSeverity, type IssueRow } from '../report-fields.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-report-test-'));
const ISSUES = join(SCRATCH, 'issues.jsonl');
const GAMES = join(SCRATCH, 'games');
const STORE = join(SCRATCH, 'accounts.json');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

// ── 0. the coercions as values, before any socket ─────────────────────

console.log('\n[report-fields: the one list]');
for (const k of REPORT_KINDS) eq(reportKind(k), k, `kind '${k}' is itself`);
for (const s of REPORT_SEVERITIES) eq(reportSeverity(s), s, `severity '${s}' is itself`);
eq(reportKind('crash'), 'other', 'an unknown kind is other');
eq(reportKind(undefined), 'other', 'a missing kind is other');
eq(reportKind(['bug']), 'other', 'a non-string kind is other (String([...]) must not sneak through)');
eq(reportSeverity('critical'), null, 'an unknown severity is null');
eq(reportSeverity(undefined), null, 'a missing severity is null');
eq(reportSeverity(''), null, 'an empty severity is null');

// ── the real server ───────────────────────────────────────────────────

const server = await spawnServer({ ALGO_ISSUES_FILE: ISSUES, ALGO_GAMES_DIR: GAMES, ALGO_ACCOUNTS_FILE: STORE });
const base = `http://localhost:${server.port}`;
const post = async (body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
  const res = await fetch(base + '/api/report', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
};
const rows = (): IssueRow[] => readFileSync(ISSUES, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as IssueRow);

try {
  console.log('\n[§1 a well-formed report]');
  const a = await post({ room: 'abcd', seat: 1, note: 'the stack vanished\nafter undo', kind: 'bug', severity: 'gamebreaking' });
  eq(a.status, 200, 'accepted');
  eq(a.json['ok'], true, 'ok');
  let all = rows();
  eq(all.length, 1, 'one row');
  const r1 = all[0]!;
  eq(r1.kind, 'bug', 'kind stored');
  eq(r1.severity, 'gamebreaking', 'severity stored');
  eq(r1.room, 'ABCD', 'room upper-cased as before');
  eq(r1.seat, 1, 'seat as before');
  eq(r1.note, 'the stack vanished\nafter undo', 'note verbatim as before');
  eq(r1.actionIndex, null, 'unknown room: actionIndex null as before');
  ok(typeof r1.ts === 'string' && !Number.isNaN(Date.parse(r1.ts)), 'ts is a date as before');
  eq(r1.by, null, 'BL-17: a signed-out report says by = null (test-badge.ts has the signed-in half)');

  console.log('\n[§2 a bad value is coerced, and the note survives]');
  const b = await post({ room: 'ABCD', seat: 0, note: 'typo in the enum', kind: 'crash', severity: 'critical' });
  eq(b.status, 200, 'still 200 — never a refusal over the enum');
  all = rows();
  eq(all.length, 2, 'the row landed');
  eq(all[1]!.kind, 'other', 'unknown kind → other');
  eq(all[1]!.severity, null, 'unknown severity → null');
  eq(all[1]!.note, 'typo in the enum', 'the note is the part that matters, and it is there');

  console.log('\n[§3 the pre-form body shape]');
  const c = await post({ room: 'ABCD', seat: 0, note: 'from a tab that never reloaded' });
  eq(c.status, 200, 'accepted');
  all = rows();
  eq(all[2]!.kind, 'other', 'no kind → other');
  eq(all[2]!.severity, null, 'no severity → null');

  console.log('\n[§4 an oversize enum is still one clean row]');
  const d = await post({ room: 'ABCD', seat: 0, note: 'x', kind: 'b'.repeat(5000), severity: { deep: true } });
  eq(d.status, 200, 'accepted');
  const text = readFileSync(ISSUES, 'utf8');
  eq(text.split('\n').filter(l => l.trim()).length, 4, 'four rows, one line each');
  all = rows();
  eq(all[3]!.kind, 'other', 'a 5 KB kind is other, not stored');
  eq(all[3]!.severity, null, 'an object severity is null');
  ok(!text.includes('bbbbbbbbbb'), 'the oversize value was not written anywhere');

  console.log('\n[a feature request carries no severity even if the client sends one]');
  // the CLIENT drops it; the server stores what is valid. This pins the
  // contract as-is so a change to it is a decision, not a drift: the row
  // says what was sent, and the reader decides what a severity on a feature
  // request means.
  const e = await post({ room: 'ABCD', seat: 0, note: 'wish', kind: 'feature', severity: 'minor' });
  eq(e.status, 200, 'accepted');
  eq(rows()[4]!.severity, 'minor', 'the server stores a valid severity regardless of kind (the client is the one that hides it)');
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
