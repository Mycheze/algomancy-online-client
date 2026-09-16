/* BL-16 — the operator dashboard (run: node test-admin.ts).
 *
 * Two halves, the shape test-collection.ts uses:
 *
 *   1. In-process: the admin flag and its last-admin guard, and the triage
 *      journal — append-only, last-write-wins, forgiving of a file somebody
 *      hand-edited on the box.
 *   2. Integration: the HTTP gate, against a real server.
 *
 * §2 IS THE LOAD-BEARING HALF, and it is here rather than in the UI because
 * the claim is about the SERVER. BL-16's doneWhen says it outright —
 * *"Everything on the page is refused to non-admins, server-side, not just
 * hidden in the UI"* — and a dashboard whose protection is a hidden button is
 * not protected at all. So every route is asked four ways: signed out, signed
 * in as an ordinary player, holding a token that is not a token, and finally
 * as an admin. The first three must be INDISTINGUISHABLE from a path this
 * server does not serve, which means 404 and an empty body — not 403, not a
 * JSON error naming the field they lack.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-admin-test-'));
const STORE = join(SCRATCH, 'accounts.json');
const GAMES = join(SCRATCH, 'games');
const ISSUES = join(SCRATCH, 'issues.jsonl');
const MARKS = join(SCRATCH, 'report-marks.jsonl');
process.env['ALGO_ACCOUNTS_FILE'] = STORE;
process.env['ALGO_GAMES_DIR'] = GAMES;
process.env['ALGO_ISSUES_FILE'] = ISSUES;
process.env['ALGO_REPORT_MARKS_FILE'] = MARKS;

const { loadAccounts, register, setAdmin, admins } = await import('./accounts.ts');
const { marks, setMark, reportRows, accountRows } = await import('./admin.ts');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

/* ══ §1 — the flag, in process ═══════════════════════════════════════ */

console.log('\n[the admin flag]');
loadAccounts();
function make(name: string) {
  const r = register(name, 'a-long-enough-password');
  if (!r.ok) throw new Error(`could not register ${name}: ${r.error}`);
  return r.account;
}
const ben = make('Bena');
const other = make('Karanda');
make('Gember');

ok(!ben.admin && !other.admin, 'nobody is an admin by registering — there is no self-service path');
setAdmin(ben, true);
ok(ben.admin === true && admins().length === 1, 'the bootstrap grants the first one');

let refused = '';
try { setAdmin(ben, false); } catch (e) { refused = e instanceof Error ? e.message : String(e); }
ok(/last admin/.test(refused),
  'and refuses to remove the LAST one — a deploy with no admin can only be repaired over SSH, '
  + 'which is the thing the flag exists to avoid');
ok(ben.admin === true, 'the refusal left the flag alone rather than half-applying it');

setAdmin(other, true);
ok(admins().length === 2, 'a second admin can be granted');
setAdmin(ben, false);
ok(!ben.admin && admins().length === 1, 'and now the first one CAN step down — the guard is about the last, not the first');
setAdmin(ben, true);

/* ══ §1b — the triage journal ════════════════════════════════════════ */

console.log('\n[the triage journal]');
ok(marks().size === 0, 'no file yet reads as nothing triaged, not as an error');
setMark(3, 'real', 'Bena');
setMark(7, 'not', 'Bena');
ok(marks().get(3)?.mark === 'real' && marks().get(7)?.mark === 'not', 'two marks land');
setMark(3, 'not', 'Karanda');
ok(marks().get(3)?.mark === 'not' && marks().get(3)?.by === 'Karanda',
  'changing your mind is a NEW LINE and the last one wins');
ok(readFileSync(MARKS, 'utf8').trim().split('\n').length === 3,
  'the journal appended rather than rewrote — it is a record of what was thought and when');
setMark(3, null, 'Bena');
ok(!marks().has(3),
  'a clear REMOVES the entry rather than storing a null, so a cleared report is '
  + 'indistinguishable from one never marked');
ok(marks().get(7)?.mark === 'not', 'and clearing one leaves the others alone');

writeFileSync(MARKS, readFileSync(MARKS, 'utf8') + 'not json at all\n{"id":-2,"mark":"real"}\n');
ok(marks().get(7)?.mark === 'not',
  'a corrupt line and a nonsense id are skipped, not fatal — this is a journal an operator '
  + 'may well have hand-edited on the box');

/* ══ §1c — the report join ═══════════════════════════════════════════ */

console.log('\n[reports joined to the ledger]');
writeFileSync(ISSUES, [
  JSON.stringify({ ts: '2026-09-01T00:00:00Z', room: 'AAAA', seat: 0, note: 'row zero', actionIndex: 1 }),
  JSON.stringify({ ts: '2026-09-02T00:00:00Z', room: 'BBBB', seat: 1, note: 'row one', actionIndex: 2 }),
].join('\n') + '\n');
const rows = reportRows();
ok(rows.length === 2, 'both rows parse');
ok(rows[0]!.id === 1 && rows[1]!.id === 0,
  'newest first, and the id is the LINE INDEX — the same number fetch-reports.mjs and the '
  + 'ledger key on, or a mark would point at the wrong report');
ok(rows.every(r => 'status' in r && 'guards' in r),
  'every row carries the ledger columns, even when the ledger has no entry for it');
ok(accountRows().length === 3 && accountRows().every(a => !('hash' in a) && !('salt' in a)),
  'the account rows carry no password material — the shape is a projection, not a spread');

/* ══ §1d — a game row's seat names ═══════════════════════════════════ */

console.log('\n[game rows name whoever sat there]');
{
  const { gameRows } = await import('./admin.ts');
  // ⚠ IN-PROCESS ONLY, AND DELIBERATELY NOT PERSISTED. These two rows are
  // hand-built to exercise the name fallback and are not full game records;
  // saving them would hand the server spawned in §2 a history it then folds
  // profiles out of at boot, and the whole integration half falls over on a
  // fixture that was never meant to leave this block.
  const { stashHistory } = await import('./accounts.ts');
  const base = {
    playedAt: '2026-09-15T12:00:00Z', recordedAt: '2026-09-15T12:00:00Z',
    mode: 'shared' as const, els: [], finished: true, winner: 0 as const, turns: 6,
    diverged: false, deckIds: undefined,
  };
  stashHistory({
    ...base, code: 'LIVE', names: ['StaleName', 'Karanda'],
    users: [ben.id, null],
  } as never);
  stashHistory({
    ...base, code: 'GONE', names: ['Someone', 'SomeoneElse'],
    users: ['an-id-from-another-deployment', null],
  } as never);
  const rows = new Map(gameRows().map(r => [r.code, r]));

  const live = rows.get('LIVE')!;
  ok(live.players[0] === 'Bena' && live.known[0],
    'a seat with a LIVE account shows that account\'s CURRENT username, not the stale one '
    + 'recorded at the time — somebody who renamed must not read as a stranger');
  ok(live.players[1] === 'Karanda' && !live.known[1],
    'and a signed-out seat falls back to the name it was played under, marked as not an account');

  const gone = rows.get('GONE')!;
  // ⚠ THIS IS THE ONE REAL DATA CAUGHT. The fallback used to be null, and the
  // page printed "(guest) vs (guest)" and "(guest) won" — for a game whose
  // players' names were sitting unread in the same record. Found by driving
  // the dashboard against two REAL imported games, where every account id
  // belongs to another deployment and resolves to nothing here.
  ok(gone.players[0] === 'Someone' && gone.players[1] === 'SomeoneElse',
    'an id that resolves to nothing falls back to the RECORDED name, never to "(guest)"');
  ok(!gone.known[0] && !gone.known[1], 'and both are marked as not current accounts');
  ok(gameRows().every(r => r.players.every(n => typeof n === 'string' && n.length > 0)),
    'no row can show an empty seat name — the page has nothing sensible to print for one');
}

/* ══ §2 — the HTTP gate ══════════════════════════════════════════════ */

console.log('\n[the gate: 404 to everyone else]');
const server = await spawnServer({
  ALGO_ACCOUNTS_FILE: STORE, ALGO_GAMES_DIR: GAMES,
  ALGO_ISSUES_FILE: ISSUES, ALGO_REPORT_MARKS_FILE: MARKS,
});
const PORT = server.port;
const url = (p: string): string => `http://localhost:${PORT}${p}`;

async function login(name: string): Promise<string> {
  const res = await fetch(url('/api/auth/login'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: name, password: 'a-long-enough-password' }),
  });
  const body = await res.json() as { ok: boolean; token?: string };
  if (!body.ok || !body.token) throw new Error(`could not log in as ${name}`);
  return body.token;
}

const READS = ['/api/admin/overview', '/api/admin/accounts', '/api/admin/reports',
  '/api/admin/games', '/api/admin/rooms'];
const WRITES: [string, unknown][] = [
  ['/api/admin/mark', { id: 0, mark: 'real' }],
  ['/api/admin/setbadge', { name: 'Karanda', judge: 3 }],
  ['/api/admin/setadmin', { name: 'Karanda', admin: true }],
];

try {
  const adminToken = await login('Bena');
  const plainToken = await login('Gember');

  for (const [label, headers] of [
    ['signed out', {} as Record<string, string>],
    ['an ordinary player', { authorization: `Bearer ${plainToken}` }],
    ['a junk token', { authorization: 'Bearer not-a-real-token-at-all' }],
  ] as [string, Record<string, string>][]) {
    let worst = '';
    for (const p of READS) {
      const res = await fetch(url(p), { headers });
      const body = await res.text();
      if (res.status !== 404 || body !== 'not found') worst = `${p} → ${res.status} ${body.slice(0, 40)}`;
    }
    for (const [p, payload] of WRITES) {
      const res = await fetch(url(p), {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.text();
      if (res.status !== 404 || body !== 'not found') worst = `${p} → ${res.status} ${body.slice(0, 40)}`;
    }
    ok(!worst, `${label}: every admin route answers a bare 404, byte-identical to an unserved `
      + `path${worst ? ` — got ${worst}` : ''}`);
  }

  console.log('\n[the gate: an admin gets through]');
  const auth = { authorization: `Bearer ${adminToken}` };
  const ov = await (await fetch(url('/api/admin/overview'), { headers: auth })).json() as
    { ok: boolean; me: string; admins: number; reports: { total: number } };
  ok(ov.ok && ov.me === 'Bena', 'the overview names who is asking');
  ok(ov.reports.total === 2, 'and counts the reports it can see');

  for (const p of READS) {
    const res = await fetch(url(p), { headers: auth });
    ok(res.status === 200, `${p} answers an admin`);
  }

  console.log('\n[writes]');
  const marked = await (await fetch(url('/api/admin/mark'), {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 0, mark: 'real' }),
  })).json() as { ok: boolean; row: { by: string; mark: string } };
  ok(marked.ok && marked.row.mark === 'real' && marked.row.by === 'Bena',
    'a mark is stamped with the admin who set it, off the token and never off the body');

  const badged = await (await fetch(url('/api/admin/setbadge'), {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Karanda', judge: 2 }),
  })).json() as { ok: boolean; badge: { judge?: number } | null };
  ok(badged.ok && badged.badge?.judge === 2, 'an admin can set a judge level from the browser');

  const flagged = await (await fetch(url('/api/admin/setadmin'), {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Karanda', admin: true }),
  })).json() as { ok: boolean; admins: number };
  ok(flagged.ok && flagged.admins >= 2, 'and grant the admin flag itself');

  // THE ONE THAT MUST COME BACK AS A REASON RATHER THAN A 404: the last-admin
  // guard is something the operator can act on ("grant somebody else first"),
  // so it is the one refusal this surface explains.
  await fetch(url('/api/admin/setadmin'), {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Karanda', admin: false }),
  });
  const last = await (await fetch(url('/api/admin/setadmin'), {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Bena', admin: false }),
  })).json() as { ok: boolean; error?: string };
  ok(last.ok === false && /last admin/.test(last.error ?? ''),
    'revoking the last admin is refused WITH A REASON — the one thing here an operator can fix');

  console.log('\n[the bootstrap route]');
  const noToken = await fetch(url('/api/admin/grant'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Gember' }),
  });
  ok(noToken.status === 404,
    'the bootstrap 404s without the tester token, even to an admin — this deploy sets none, '
    + 'so the route does not exist at all');
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nALL PASS');
