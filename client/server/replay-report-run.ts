/* Replay the game a report from a SOLO ROOM was filed on — a Weekly Challenge
 * run or a Learn to Play game — to the action the reporter was at, and print
 * the log. replay-room.ts is the same tool for a server room; a solo room has
 * no room file, so its report carries the game itself (report-run.ts) and
 * `npm run reports` brings it down to var/report-runs.jsonl.
 *
 *   node client/server/replay-report-run.ts <ts>            the report filed at <ts> (a unique prefix will do)
 *   node client/server/replay-report-run.ts <file.json>     a run from a file: a report-runs.jsonl row,
 *                                                           a bare run, or a challenge export /
 *                                                           reference run {challengeId, deck, actions}
 *      --at <n>         stop after n actions instead of where the reporter was
 *      --quiet          no log, just where the game stands
 *      --runs <file>    the runs journal (default: var/report-runs.jsonl, statepaths.ts)
 *      --issues <file>  the report journal the note is read from (default: the
 *                       committed snapshot, then var/issues.jsonl)
 *
 * Exit 0: every action up to the index replayed. 2: the engine refused one —
 * the first refusal is the divergence and the board printed is where THIS
 * engine got to, not the reporter's. 1: usage.
 *
 * The deal is the one the BROWSER dealt (the run carries the challenge as it
 * was then; a calendar row may move before its week opens), and the names are
 * the game's own where the run has them. A challenge's dummy moves are checked
 * against `dummyMove` as the server's verifier checks them — a mismatch there
 * means the engine has moved since the run was played.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Action, EngineEvent, GameState } from '../engine/src/types.ts';
import { Harness } from '../engine/src/harness.ts';
import { IllegalAction, legalActions } from '../engine/src/apply.ts';
import {
  DUMMY, DUMMY_DECK, challengeDeal, dummyMove, foldRun, newRun, progress, progressLabel, scoreRun,
  type RunAcc,
} from '../engine/src/challenge.ts';
import { challengeById } from './challenges.ts';
import { describe as describeAction, itemText } from './rewind-cuts.ts';
import { boardLine } from './replay-room.ts';
import { parseReportRuns, sanitizeReportRun, type ReportRun, type ReportRunRow } from './report-run.ts';
import type { IssueRow } from './report-fields.ts';
import { issuesFile, reportRunsFile } from './statepaths.ts';

/** the committed report snapshot — resolved from here, as admin.ts does */
const ISSUES_SNAPSHOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'ledgers', 'playtest-issues.snapshot.jsonl');

export const EXIT = { replayed: 0, usage: 1, refused: 2 } as const;

export interface RunReplay {
  /** the board after the last action replayed */
  state: GameState;
  /** every event, from the deal on */
  events: EngineEvent[];
  /** per action replayed: its index, the board before it, the events it made */
  steps: { i: number; before: GameState; action: Action; events: EngineEvent[] }[];
  /** where the replay stopped */
  at: number;
  /** the first action the engine refused, if any (the replay stops there) */
  refused: { i: number; why: string } | null;
  /** a challenge's dummy actions that are not `dummyMove` on this engine */
  dummyDrift: number[];
  /** a challenge's goal progress at `at` */
  acc: RunAcc | null;
  names: [string, string];
}

/** Rebuild `run` to action `at` (default: where the reporter was). */
export function replayRun(run: ReportRun, at: number = run.at): RunReplay {
  const n = Math.max(0, Math.min(at, run.actions.length));
  let h: Harness;
  let names: [string, string];
  let acc: RunAcc | null = null;
  if (run.kind === 'challenge') {
    names = ['Challenger', 'Dummy'];
    h = new Harness(run.def.seed, names, 'constructed', undefined, [[...run.deck], [...DUMMY_DECK]], undefined, challengeDeal({ ...run.def, blurb: '' }));
    acc = newRun(run.def.goal, run.deck);
  } else {
    names = run.deal.names;
    h = new Harness(run.deal.seed, names, 'constructed', undefined, [[...run.deal.decks[0]], [...run.deal.decks[1]]], undefined, run.deal.lesson);
  }
  const steps: RunReplay['steps'] = [];
  const dummyDrift: number[] = [];
  let refused: RunReplay['refused'] = null;
  for (let i = 0; i < n; i++) {
    const a = run.actions[i]!;
    const before = h.state;
    if (run.kind === 'challenge' && a.seat === DUMMY) {
      const legal = legalActions(before, DUMMY);
      let want: Action | null = null;
      try { want = legal.length ? dummyMove(before, legal) : null; } catch { want = null; }
      if (!want || JSON.stringify(want) !== JSON.stringify(a)) dummyDrift.push(i);
    }
    let evs: EngineEvent[];
    try {
      evs = h.do(a);
    } catch (err) {
      if (!(err instanceof IllegalAction)) throw err;
      refused = { i, why: err.message };
      break;
    }
    if (acc) acc = foldRun(acc, before, a, h.state, evs);
    steps.push({ i, before, action: a, events: evs });
  }
  return { state: h.state, events: h.events, steps, at: refused ? refused.i : n, refused, dummyDrift, acc, names };
}

/** the report's printout: what it is, the log (unless `quiet`), and where the game stands */
export function runLines(row: ReportRunRow, opts: { at?: number; quiet?: boolean; issue?: { id: number | null; row: IssueRow } | null } = {}): { lines: string[]; exit: number } {
  const run = row.run;
  const L: string[] = [];
  const at = opts.at ?? run.at;
  if (run.kind === 'challenge') {
    const cal = challengeById(run.def.id);
    L.push(`═ challenge run ${run.def.id} "${run.def.title}" · seed ${run.def.seed} · deck of ${run.deck.length} · ${run.actions.length} actions logged`);
    if (!cal) L.push('  · not on the calendar this checkout has — replayed from the challenge as the browser had it');
    else if (cal.seed !== run.def.seed || JSON.stringify(cal.goal) !== JSON.stringify(run.def.goal)) {
      L.push(`  ⚠ the calendar's row differs (seed ${cal.seed}, goal ${JSON.stringify(cal.goal)}) — replayed from the browser's`);
    }
  } else {
    L.push(`═ Learn to Play game · seed ${run.deal.seed} · ${run.deal.names.join(' vs ')} · ${run.actions.length} actions logged`);
  }
  if (row.ts) L.push(`  report ${row.ts}${opts.issue ? `${opts.issue.id !== null ? ` (#${opts.issue.id})` : ''} [${opts.issue.row.kind ?? '?'}${opts.issue.row.severity ? '/' + opts.issue.row.severity : ''}]: "${String(opts.issue.row.note ?? '').replace(/\s+/g, ' ').slice(0, 300)}"` : ''}`);
  L.push(`  replaying to action ${Math.min(at, run.actions.length)}${at === run.at ? ' (where the reporter was)' : ` (the reporter was at ${run.at})`}`);

  const r = replayRun(run, at);
  if (!opts.quiet) {
    L.push('', '── game log ──');
    const firstAction = new Set(r.steps.flatMap(s => s.events));
    for (const ev of r.events) if (!firstAction.has(ev) && ev.msg) L.push(`  ${ev.msg}`);   // the deal's own lines
    for (const s of r.steps) {
      L.push(`[${s.i}] ${itemText(describeAction(s.action, s.before, s.i, false), 'record', r.names) ?? s.action.type}`);
      for (const ev of s.events) if (ev.msg) L.push(`    ${ev.msg}`);
    }
  }
  L.push('', '── where it stands ──');
  if (r.refused) {
    L.push(`  ⛔ action [${r.refused.i}] (${run.actions[r.refused.i]!.type}, seat ${run.actions[r.refused.i]!.seat}) REFUSED: ${r.refused.why}`);
    L.push('    This engine is not the one the run was played on. The board below is where THIS replay got to.');
  } else {
    L.push(`  ✓ all ${r.at} actions replayed`);
  }
  if (r.dummyDrift.length) {
    L.push(`  ⚠ ${r.dummyDrift.length} dummy move(s) are not this engine's dummyMove (first [${r.dummyDrift[0]}]) — the server would refuse this log now`);
  }
  L.push(`  board: ${boardLine(r.state)}`);
  r.state.players.forEach(p => L.push(
    `  ${p.name}: ${p.life} life · ${p.hand.length} in hand · ${p.bin.length} in bin · ${p.resources.length} resources`));
  const units = Object.values(r.state.entities).filter(e => e && e.kind === 'unit');
  const tally = new Map<string, number>();
  for (const u of units) { const k = `${u.card} (${r.names[u.controller]})`; tally.set(k, (tally.get(k) ?? 0) + 1); }
  L.push(`  units in play: ${units.length ? `${units.length} — ${[...tally].map(([k, c]) => (c > 1 ? `${c}× ${k}` : k)).join(', ')}` : 'none'}`);
  if (r.acc && run.kind === 'challenge') {
    const p = progress(r.acc);
    const sc = scoreRun(r.acc, run.def.par);
    L.push(`  goal: ${progressLabel(run.def.goal)} ${Math.min(p.value, p.target)} / ${p.target}${p.met ? ' — MET' : ''} · cards ${sc.cards} · elements ${sc.elements} · turn ${r.state.turn}`);
  }
  if (r.at > 0) {
    const last = r.steps.slice(-4).map(s => `[${s.i}] ${itemText(describeAction(s.action, s.before, s.i, false), 'record', r.names) ?? s.action.type}`);
    L.push(`  last actions: ${last.join(' ; ')}`);
  }
  return { lines: L, exit: r.refused ? EXIT.refused : EXIT.replayed };
}

/** A run from a file: a report-runs.jsonl row, a bare run, or a challenge
 * export / reference run `{challengeId, deck, actions}` (the calendar's row) */
export function runFromFile(json: unknown): ReportRunRow | string {
  const o = json as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return 'not a run';
  let raw: unknown = o;
  let ts = '';
  if (typeof o['ts'] === 'string' && o['run']) { ts = o['ts']; raw = o['run']; }
  else if (!o['kind'] && typeof o['challengeId'] === 'string') {
    const def = challengeById(o['challengeId']);
    if (!def) return `no challenge ${o['challengeId']} on this calendar`;
    const actions = Array.isArray(o['actions']) ? o['actions'] : [];
    raw = { kind: 'challenge', def, deck: o['deck'], actions, at: actions.length };
  }
  const r = sanitizeReportRun(raw);
  return r.ok ? { ts, run: r.run } : `not a run: ${r.why}`;
}

/** the issues row filed at `ts`, and its id in the committed snapshot */
function issueFor(ts: string, file: string | undefined): { id: number | null; row: IssueRow } | null {
  for (const [path, isSnap] of file ? [[file, false] as const] : [[ISSUES_SNAPSHOT, true] as const, [issuesFile(), false] as const]) {
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
    for (let i = 0; i < lines.length; i++) {
      try {
        const row = JSON.parse(lines[i]!) as IssueRow;
        if (row.ts === ts) return { id: isSnap ? i : null, row };
      } catch { /* a torn line */ }
    }
  }
  return null;
}

const CLI = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (CLI) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const valued = new Set(['--at', '--runs', '--issues']);
  const what = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));
  if (!what) {
    console.error('usage: node client/server/replay-report-run.ts <report ts | file.json> [--at <n>] [--quiet] [--runs <file>] [--issues <file>]');
    process.exit(EXIT.usage);
  }
  let row: ReportRunRow;
  if (existsSync(what) && !/^\d{4}-\d\d-\d\dT/.test(what)) {
    const got = runFromFile(JSON.parse(readFileSync(what, 'utf8')));
    if (typeof got === 'string') { console.error(`${what}: ${got}`); process.exit(EXIT.usage); }
    row = got;
  } else {
    const file = flag('--runs') ?? reportRunsFile();
    if (!existsSync(file)) {
      console.error(`no runs journal at ${file} — \`npm --prefix client run reports\` brings it down`);
      process.exit(EXIT.usage);
    }
    const hits = parseReportRuns(readFileSync(file, 'utf8')).filter(r => r.ts === what || r.ts.startsWith(what));
    const exact = hits.filter(r => r.ts === what);
    const pick = exact.length ? exact : hits;
    if (pick.length !== 1) {
      console.error(pick.length ? `${pick.length} runs match ${what}: ${pick.map(r => r.ts).join(', ')}` : `no run for a report at ${what} in ${file}`);
      process.exit(EXIT.usage);
    }
    // the journal is untrusted input like the request it came from
    const s = sanitizeReportRun(pick[0]!.run);
    if (!s.ok) { console.error(`the run at ${what} is not a run: ${s.why}`); process.exit(EXIT.usage); }
    row = { ts: pick[0]!.ts, run: s.run };
  }
  const atRaw = flag('--at');
  if (atRaw !== undefined && !/^\d+$/.test(atRaw)) { console.error('--at takes an action count'); process.exit(EXIT.usage); }
  const out = runLines(row, {
    ...(atRaw !== undefined ? { at: Number(atRaw) } : {}),
    quiet: args.includes('--quiet'),
    issue: row.ts ? issueFor(row.ts, flag('--issues')) : null,
  });
  for (const line of out.lines) console.log(line);
  process.exit(out.exit);
}
