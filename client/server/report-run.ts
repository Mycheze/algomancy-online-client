/* A REPORT FILED FROM A ROOM WITH NO SERVER ROOM — the run it was filed on.
 *
 * Report round 2026-10-23. A Weekly Challenge run and a Learn to Play game are
 * solo rooms that live in the browser (ui/solo.ts): the server never sees the
 * game, so a report filed from one used to arrive as `room: ''` and the note
 * alone — while the whole game, deal plus action log, sat in the reporter's
 * localStorage. One reporter wrote "in the attached state…", believing it had
 * been sent. Now the form sends it, and this file is the server's half: what
 * such an attachment may be, and where it is kept.
 *
 * ⚠ IT IS NOT WRITTEN INTO issues.jsonl, and that is a hard constraint, not a
 * taste. A row there is parsed by fetch-reports.mjs, 70-playtest-ledger and
 * the admin page, a report's id is its line index in the committed snapshot,
 * and the snapshot is committed — a 100 KB action log on a row would make the
 * journal a different kind of file. So the row carries a small POINTER
 * (`IssueRow.solo`: the kind, the action index, the challenge id), and the run
 * itself is one line of `report-runs.jsonl` beside the journal, keyed by the
 * row's `ts` — the report's honest identity in every copy of the journal (see
 * admin.ts MarkRow). `replay-report-run.ts` rebuilds the moment from it, and
 * `npm run reports` brings the file down with the journal.
 *
 * It is untrusted input like everything else the browser sends: shape-checked
 * here, size-capped, and a bad attachment never costs the note — the row is
 * still written, saying the attachment was refused and why.
 */
import type { Action, CardName } from '../engine/src/types.ts';
import type { ChallengeDef, Goal } from '../engine/src/challenge.ts';
import { sanitizeLessonDeal, type LessonDeal } from '../engine/src/lessondeal.ts';
import type { SoloPointer } from './report-fields.ts';

/** the attachment's JSON may be at most this large; /api/report's body cap is
 * this plus room for the note */
export const MAX_RUN_BYTES = 512 * 1024;
/** the same ceiling a challenge upload has (api-challenge.ts MAX_ACTIONS) */
export const MAX_RUN_ACTIONS = 20_000;
/** attachments one address may file an hour — the note is still logged past it */
export const RUNS_PER_HOUR = 30;

const MAX_DECK = 200;
const MAX_NAME = 80;

/** a Weekly Challenge run, as the browser held it (ui/challengerun.ts RunRecord) */
export interface ChallengeReportRun {
  kind: 'challenge';
  /** the challenge as the browser dealt it — the calendar row may have moved since */
  def: Pick<ChallengeDef, 'id' | 'week' | 'title' | 'goal' | 'seed' | 'par'>;
  /** the ordered deck, index 0 on top */
  deck: CardName[];
  /** the room's whole log, both seats, from the bare deal */
  actions: Action[];
  /** where the reporter was: the log's length when the form was opened */
  at: number;
}

/** a Learn to Play game (ui/learn.ts — the SoloSave's deal and log) */
export interface LearnReportRun {
  kind: 'learn';
  deal: { seed: number; names: [string, string]; decks: [CardName[], CardName[]]; lesson: LessonDeal };
  actions: Action[];
  at: number;
}

export type ReportRun = ChallengeReportRun | LearnReportRun;

/** one line of report-runs.jsonl: the report's `ts` and its run */
export interface ReportRunRow { ts: string; run: ReportRun }

/** what the issues row says about it — small, so the journal stays a journal */
export type { SoloPointer };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cardList(v: unknown): CardName[] | null {
  if (!Array.isArray(v) || v.length > MAX_DECK) return null;
  return v.every(c => typeof c === 'string' && c.length > 0 && c.length <= MAX_NAME) ? v as CardName[] : null;
}

function actionList(v: unknown): Action[] | string {
  if (!Array.isArray(v)) return 'the actions are not a list';
  if (v.length > MAX_RUN_ACTIONS) return `more than ${MAX_RUN_ACTIONS} actions`;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    if (!isObj(a) || typeof a['type'] !== 'string' || a['type'].length > 40 || (a['seat'] !== 0 && a['seat'] !== 1)) {
      return `action ${i} is not an action`;
    }
  }
  return v as Action[];
}

const GOALS = new Set<Goal['kind']>(['unitsInPlay', 'spellTokens', 'unitSize', 'counters', 'unitsPlayed']);

function goalOf(v: unknown): Goal | null {
  if (!isObj(v) || !GOALS.has(v['kind'] as Goal['kind'])) return null;
  if (v['kind'] === 'unitSize') return isNum(v['p']) && isNum(v['t']) ? { kind: 'unitSize', p: v['p'], t: v['t'] } : null;
  return isNum(v['n']) ? { kind: v['kind'] as Exclude<Goal['kind'], 'unitSize'>, n: v['n'] } as Goal : null;
}

const shortStr = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Check what the browser sent and keep only the fields a replay reads, rebuilt
 * from scratch (never the object as sent). `{ok: false}` says why, in a few
 * words the row can carry.
 */
export function sanitizeReportRun(v: unknown): { ok: true; run: ReportRun } | { ok: false; why: string } {
  if (!isObj(v)) return { ok: false, why: 'not an object' };
  let size: number;
  try { size = JSON.stringify(v).length; } catch { return { ok: false, why: 'not JSON' }; }
  if (size > MAX_RUN_BYTES) return { ok: false, why: `too large (${size} bytes)` };
  const actions = actionList(v['actions']);
  if (typeof actions === 'string') return { ok: false, why: actions };
  const at = v['at'];
  if (!isNum(at) || !Number.isInteger(at) || at < 0 || at > actions.length) return { ok: false, why: 'the action index is not in the log' };

  if (v['kind'] === 'challenge') {
    const d = v['def'];
    const deck = cardList(v['deck']);
    if (!isObj(d)) return { ok: false, why: 'no challenge' };
    const id = shortStr(d['id'], 64);
    const goal = goalOf(d['goal']);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || !goal || !isNum(d['seed']) || !isNum(d['par'])) return { ok: false, why: 'not a challenge' };
    if (!deck || !deck.length) return { ok: false, why: 'not a deck' };
    return {
      ok: true,
      run: {
        kind: 'challenge',
        def: { id, week: shortStr(d['week'], 16), title: shortStr(d['title'], 120), goal, seed: d['seed'], par: d['par'] },
        deck: [...deck], actions, at,
      },
    };
  }

  if (v['kind'] === 'learn') {
    const d = v['deal'];
    if (!isObj(d) || !isNum(d['seed'])) return { ok: false, why: 'not a deal' };
    const names = d['names'];
    const decks = d['decks'];
    if (!Array.isArray(names) || names.length !== 2 || !names.every(n => typeof n === 'string')) return { ok: false, why: 'not a deal' };
    if (!Array.isArray(decks) || decks.length !== 2) return { ok: false, why: 'not a deal' };
    const d0 = cardList(decks[0]), d1 = cardList(decks[1]);
    const lesson = sanitizeLessonDeal(d['lesson']);
    if (!d0 || !d1 || !lesson) return { ok: false, why: 'not a deal' };
    return {
      ok: true,
      run: {
        kind: 'learn',
        deal: { seed: d['seed'], names: [shortStr(names[0], 40), shortStr(names[1], 40)], decks: [[...d0], [...d1]], lesson },
        actions, at,
      },
    };
  }
  return { ok: false, why: 'not a challenge run or a Learn to Play game' };
}

/** the row's pointer to a stored run */
export function pointerOf(run: ReportRun): SoloPointer {
  return run.kind === 'challenge'
    ? { kind: 'challenge', at: run.at, challengeId: run.def.id }
    : { kind: 'learn', at: run.at };
}

/** every row of a report-runs.jsonl text; an unreadable line is skipped */
export function parseReportRuns(text: string): ReportRunRow[] {
  const out: ReportRunRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as ReportRunRow;
      if (typeof r.ts === 'string' && isObj(r.run)) out.push(r);
    } catch { /* a torn line is a line we do not have */ }
  }
  return out;
}

/**
 * Keep the run a report was filed with: sanitize it, append it to `file` under
 * the report's `ts`, and return the pointer the issues row carries. Never
 * throws — a refused or unwritable run is a `{refused}` pointer, and the
 * report is filed regardless (the note is the part nothing can rebuild).
 */
export async function storeReportRun(file: string, ts: string, raw: unknown): Promise<SoloPointer> {
  const r = sanitizeReportRun(raw);
  if (!r.ok) return { refused: r.why };
  try {
    const { appendFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify({ ts, run: r.run } satisfies ReportRunRow) + '\n');
  } catch (err) {
    console.error('[report] could not keep the run:', err);
    return { refused: 'could not be stored' };
  }
  return pointerOf(r.run);
}
