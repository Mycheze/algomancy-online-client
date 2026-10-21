/* CT-326 — replay-room.ts REBUILDS A REWOUND BRANCH.
 *
 * An agreed rewind cuts the log (rooms.ts rewindRoom); what it took back lives
 * only in the game file's `amendments[k].removed`, and a report filed on the
 * board it took back names an `actionIndex` that is not in the final log. The
 * 2026-10-21 round's 36 rewinds were triaged by hand-written scripts; these
 * are those scripts, in the tool, proved on a game rewound here three times:
 *
 *   §1 the log each fix was proposed on, walked back last to first, is the
 *      log the room really had at that moment
 *   §2 each cut is named with whose action and its card, re-applies cleanly,
 *      and carries its triage flags: (b) the redo repeated the cut, (c) the
 *      reason says something, (d) a plain report in the same run — and a fix
 *      on the very board the last one left is marked as the same run
 *   §3 --report rebuilds the board a fix row was filed on, by the row's fix
 *      index or (older rows) by its time, with every fix of its run
 *   §4 flag (a) reads a real fizzle off the engine's events
 *   §5 the CLI: --branch and --report <ts> <actionIndex>
 *
 * Seeds 52500-52599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { forcedAction, hiddenSegment, legalActions, replay } from '../../engine/src/apply.ts';
import { Harness } from '../../engine/src/harness.ts';
import type { Action, EngineEvent, Seat } from '../../engine/src/types.ts';
import { give, giveResources, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Proposal, Room } from '../rooms.ts';
import type { IssueRow } from '../report-fields.ts';
import { boardLine, branchFixes, isFizzle, preFixLogs, reportBranchLines, type RoomFile } from '../replay-room.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-525-'));
process.env['ALGO_GAMES_DIR'] = DIR;
const R = await import('../rooms.ts');
const NAMES: [string, string] = ['Ann', 'Bo'];
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const CODE = 'BR525';
const SEED = 52500;

function tick(room: Room, a: Action): void {
  const was = room.segKey;
  R.applyToRoom(room, a);
  drain(room);
  if (R.segmentKey(room.state) !== was) R.openSegment(room);
}
function drain(room: Room): void {
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    R.applyToRoom(room, f);
  }
}
const recycled = new Set<string>();
function greedy(room: Room, seat: Seat): Action | null {
  const legal = R.legalInRoom(room, seat);
  const key = `${room.state.turn}:${seat}`;
  const rec = legal.find(a => a.type === 'recycleForResource');
  if (rec && !recycled.has(key)) { recycled.add(key); return rec; }
  return legal.find(a => a.type === 'activateResource')
    ?? (room.state.phase === 'deploy' ? legal.find(a => a.type === 'playCard') : undefined)
    ?? legal.find(a => ['decide', 'donePlanning', 'doneHaste', 'declareBlocks', 'passPriority', 'doneDeploying'].includes(a.type))
    ?? legal.filter(a => a.type === 'declareAttack').at(-1) ?? null;
}
function drive(room: Room, until: (r: Room) => boolean, max = 400): void {
  for (let i = 0; i < max && !until(room); i++) {
    const a = greedy(room, 0) ?? greedy(room, 1);
    assert.ok(a, `the drive stuck at ${room.state.phase}`);
    tick(room, a!);
  }
  assert.ok(until(room), 'the drive reached its goal');
}
const battleWindow = (r: Room): boolean =>
  r.state.phase === 'battle' && hiddenSegment(r.state) === null && !r.state.decision && r.state.priority !== null;

/** an agreed rewind, as main.ts carries one out */
function rewind(room: Room, to: number, reason: string): void {
  const P = (room.state.priority ?? 0) as Seat;
  const p: Proposal = { id: 1, seat: P, kind: 'rewind', to, what: `back to ${to}`, reason, at: room.actions.length, expires: Date.now() + 60_000 };
  const out = R.rewindRoom(room, p, other(P));
  assert.ok(out.ok, out.ok ? '' : out.why);
  drain(room);
}
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/* the game: three rewinds — a cut that is then replayed move for move, a cut
 * with a reason, and a second cut straight after it (the same run) */
const room = R.createRoom(CODE, SEED, [...NAMES], 'shared');
drive(room, r => battleWindow(r) && r.actions.length > 40);
const logs: Action[][] = [];
logs.push([...room.actions]);
const cut0 = room.actions.length - 3;
rewind(room, cut0, 'oops');
await sleep(5);
const removed0 = room.amendments[0]!.removed!;
// the redo repeats the cut, move for move (a forced step re-applied itself)
removed0.forEach((a, j) => { if (JSON.stringify(room.actions[cut0 + j]) !== JSON.stringify(a)) tick(room, a); });
assert.deepEqual(room.actions.slice(cut0, cut0 + removed0.length), removed0, 'fixture: the redo is the cut');
drive(room, r => battleWindow(r) && r.actions.length > logs[0]!.length + 6);
logs.push([...room.actions]);
rewind(room, room.actions.length - 2, 'the attack skipped my block');
await sleep(5);
logs.push([...room.actions]);
rewind(room, room.actions.length - 1, 'oops2');
drive(room, r => r.actions.length > logs[2]!.length + 4);
const FILE = join(DIR, `${CODE}.json`);
const raw = JSON.parse(readFileSync(FILE, 'utf8')) as RoomFile;
// the three were agreed within milliseconds here; at a table they are minutes
// apart, which is what flag (d)'s window is about — so the file says so
{
  const t0 = Date.parse(raw.amendments![0]!.when);
  [0, 20 * 60_000, 20 * 60_000 + 20_000].forEach((d, k) => { raw.amendments![k]!.when = new Date(t0 + d).toISOString(); });
  writeFileSync(FILE, JSON.stringify(raw));
}

/* ── §1 ─────────────────────────────────────────────────────────────── */

test('§1 the log each fix was proposed on is the log the room had then', () => {
  assert.equal(raw.amendments!.length, 3, 'fixture: three rewinds on file');
  const pre = preFixLogs(raw);
  for (let k = 0; k < 3; k++) assert.deepEqual(pre[k], logs[k], `fix ${k}: the log rebuilt from the file is the log it was proposed on`);
});

/* ── §2 ─────────────────────────────────────────────────────────────── */

test('§2 each cut is named and re-applies, and the triage flags read the run', () => {
  const t1 = Date.parse(raw.amendments![1]!.when);
  const issues: IssueRow[] = [
    { ts: new Date(t1 + 30_000).toISOString(), room: CODE, seat: 0, note: 'the block was skipped', actionIndex: 3 },
    { ts: new Date(t1 + 3_600_000).toISOString(), room: CODE, seat: 0, note: 'much later', actionIndex: 3 },
    { ts: new Date(t1 + 30_000).toISOString(), room: 'ZZZZ', seat: 0, note: 'another room', actionIndex: 3 },
    { ts: new Date(t1 + 10).toISOString(), room: CODE, seat: 0, note: '[Agreed fix] …', actionIndex: 3, fix: { kind: 'rewind', what: 'x', agreedBy: 1 } },
  ];
  const all = branchFixes(raw, issues, CODE);
  assert.equal(all.length, 3);
  for (const b of all) {
    const f = b.fix;
    const before = replay(SEED, logs[b.k]!.slice(0, f.at), [...NAMES], 'shared').state;
    assert.equal(b.board, boardLine(before), `fix ${b.k}: the board at the cut`);
    assert.equal(b.cut.length, f.removed!.length, `fix ${b.k}: every cut action re-applied (${b.cut.map(c => c.refused).join(',')})`);
    let s = before;
    f.removed!.forEach((a, j) => {
      const c = b.cut[j]!;
      assert.ok(c.text.startsWith(`[${f.at + j}] ${NAMES[a.seat as Seat]}'s `), `fix ${b.k}: "${c.text}" says whose action`);
      assert.equal(c.refused, undefined);
      const card = a.type === 'playCard' ? s.players[a.seat as Seat]!.hand[a.handIndex]
        : a.type === 'activateAbility' || a.type === 'castSpellToken' ? s.entities[a.entityId]?.card : undefined;
      if (card) assert.ok(c.text.includes(card), `fix ${b.k}: "${c.text}" names ${card}`);
      s = replay(SEED, logs[b.k]!.slice(0, f.at + j + 1), [...NAMES], 'shared').state;
    });
  }
  const [f0, f1, f2] = all as [typeof all[0], typeof all[0], typeof all[0]];
  assert.equal(f0.flags.repeats, removed0.length, '(b) the redo repeated every cut choice');
  assert.equal(f0.flags.content, false, '(c) "oops" says nothing');
  assert.equal(f1.flags.content, true, '(c) a reason that says something');
  assert.equal(f1.continues, false, 'fix 1 came after moves');
  assert.equal(f2.continues, true, 'fix 2 is on the very board fix 1 left: the same run');
  assert.equal(f1.redo.length, 0, 'fix 1: nothing was played before fix 2 (the next fix came first)');
  assert.deepEqual(f1.flags.plain.map(r => r.note), ['the block was skipped'], '(d) the plain report of that run, and only it');
  assert.deepEqual(f0.flags.plain, [], '(d) none for a run with no plain report near it');
});

/* ── §3 ─────────────────────────────────────────────────────────────── */

test('§3 --report rebuilds the board a fix row was filed on, with its run', () => {
  const am = raw.amendments!;
  const at1 = logs[1]!.length;
  // a row filed by this round's code: the fix index and the run length
  const row = { ts: new Date(Date.parse(am[1]!.when) + 5).toISOString(), room: CODE, seat: 0, note: '[Agreed fix] …', actionIndex: at1,
    fix: { kind: 'rewind' as const, what: am[1]!.what, agreedBy: 1, amendment: 1, run: 2 } };
  const text = reportBranchLines(FILE, raw, row).join('\n');
  assert.match(text, /on the log fix 1 was proposed on/);
  assert.ok(text.includes(`board at ${at1}: ${boardLine(replay(SEED, logs[1]!, [...NAMES], 'shared').state)}`), 'the board it was filed on');
  assert.match(text, /── fix 1: rewind/);
  assert.match(text, /── fix 2 \(continues the fix before — same run\)/, 'and every fix of its run');
  // an older row: no index, matched by its time and words
  const old = { ts: new Date(Date.parse(am[0]!.when) + 5).toISOString(), room: CODE, seat: 0, note: '[Agreed fix] …', actionIndex: logs[0]!.length,
    fix: { kind: 'rewind' as const, what: am[0]!.what, agreedBy: 1 } };
  assert.match(reportBranchLines(FILE, raw, old).join('\n'), /on the log fix 0 was proposed on/);
  // a plain report filed before any fix: the branch fix 0 cut
  const plain = { ts: new Date(Date.parse(am[0]!.when) - 1000).toISOString(), room: CODE, seat: 0, note: 'x', actionIndex: logs[0]!.length - 1 };
  assert.match(reportBranchLines(FILE, raw, plain).join('\n'), /on the branch fix 0 cut/);
});

/* ── §4 ─────────────────────────────────────────────────────────────── */

test('§4 flag (a) reads a fizzle off the engine events', () => {
  const h = new Harness(52501, ['Ann', 'Bo']);
  toDeployment(h);
  const A = h.state.initiative;
  spawn(h, A, 'Good Whale');
  spawn(h, other(A), 'Dune Drifter');
  toNextBattle(h, A);
  h.do(legalActions(h.state, A).filter(a => a.type === 'declareAttack').at(-1)!);
  for (let g = 0; g < 10 && h.state.priority === null; g++) { const f = forcedAction(h.state); if (!f) break; h.do(f); }
  const me = h.state.priority as Seat, them = other(me);
  give(h, me, 'Flame of History'); give(h, them, 'Arc Lightning');
  giveResources(h, me, 'fire', 4); giveResources(h, them, 'fire', 6);
  const play = (who: Seat, card: string): void => {
    h.do(legalActions(h.state, who).find(a => a.type === 'playCard' && h.state.players[who]!.hand[a.handIndex] === card)!);
    const d = h.state.decision!;
    h.do({ type: 'decide', seat: d.seat, choice: d.options.findIndex(o => o.label.startsWith('Dune Drifter')) });
  };
  play(me, 'Flame of History');     // aimed at the Drifter…
  play(them, 'Arc Lightning');      // …which dies first
  const events: EngineEvent[] = [];
  for (let g = 0; g < 6 && h.state.stack.length; g++) events.push(...h.do({ type: 'passPriority', seat: h.state.priority as Seat }));
  assert.ok(events.some(isFizzle), `the Flame fizzles (${events.map(e => e.msg).join(' | ')})`);
  assert.ok(!events.filter(e => e.type !== 'fizzled').slice(0, 3).some(isFizzle), 'and a resolving spell is not one');
});

/* ── §5 ─────────────────────────────────────────────────────────────── */

test('§5 the CLI: --branch and --report', () => {
  const tool = fileURLToPath(new URL('../replay-room.ts', import.meta.url));
  const issues = join(DIR, 'issues.jsonl');
  writeFileSync(issues, '');
  const run = (...args: string[]): { code: number | null; out: string } => {
    const r = spawnSync(process.execPath, [tool, FILE, ...args, '--issues', issues], { encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const b = run('--branch');
  assert.equal(b.code, 0, b.out);
  assert.match(b.out, /3 agreed fix\(es\)/);
  assert.match(b.out, /taken back \(\d+\):\n {5}\[\d+\] (Ann|Bo)'s /, 'each cut action named');
  assert.match(b.out, /\(b\) the redo repeats every cut choice/);
  const at0 = logs[0]!.length;
  const r = run('--report', new Date(Date.parse(raw.amendments![0]!.when) - 1000).toISOString(), String(at0 - 1));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`board at ${at0 - 1}: turn \\d+`));
});
