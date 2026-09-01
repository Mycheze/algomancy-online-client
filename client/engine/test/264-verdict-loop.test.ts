/*
 * 264 · A VERDICT IS A REPORT, AND IT NEEDED THE SAME LOCK
 *
 * R285. The scenario tester (docs/14) exists so the owner — the rules
 * authority — can judge a card by playing it, and docs/14 §6 states the
 * obligation in one sentence: a `broken` or `slightly off` verdict becomes a
 * `card-todo.ts` entry with the scenario attached, and the same scenario
 * becomes the failing test that proves the fix.
 *
 * Nothing enforced it. `83-card-todo.test.ts` §4 already asserts that every
 * `live` playtest REPORT is carried into `card-todo.ts` — that guard is the
 * only reason a report cannot be dropped on the floor, and it was written
 * after two reports were. The verdict half of the same loop had no such
 * assertion and, until round 36, no committed file to assert over: the raw
 * verdicts landed in gitignored `var/`, and `scripts/fetch-reports.mjs` said
 * out loud why that was thought to be fine — "the transcription in
 * ledgers/unreached.ts is read by a human".
 *
 * ⚠ WHAT THAT COST, MEASURED. The owner marked **Vengeance `broken`** on
 * 2026-08-27 (scenario `vengeance-taxes-their-play`, room YNBP, action 4).
 * Nothing in the repo answered it: no todo entry, no ruling in
 * digital-rules.md after that date, no test, no commit. It sat for five days
 * across three rounds and two full ledger sweeps while `card-todo.ts` reported
 * 9 open items and none of them was this.
 *
 * Being read by a human is not a guard. This file is the guard.
 *
 * ⚠ AND THE FIRST THING THE GUARD DID WAS FILE A TICKET FOR A VERDICT THE
 * OWNER HAD ALREADY WITHDRAWN. CT-177 was raised off that `broken` row. The
 * card was correct — the ten Vengeance tests in `45-hybrids-ld-b.test.ts`
 * already held both readings the scenario names, and room YNBP replays
 * faithfully at HEAD showing the clause firing exactly as predicted. The
 * reason is in this same file, on its LAST line: at 13:23:16Z, twenty minutes
 * after the `broken` one, the owner filed `works` on the same scenario and the
 * same room, with a note beginning *"CORRECTION — supersedes the
 * 2026-08-27T13:03:14Z broken verdict on this same room. That verdict was a
 * misread: Sudden Bloom was taken for a targeted card, so the sacrifice prompt
 * was read as a targeting prompt."*
 *
 * `ROWS.filter(r => r.verdict !== 'works')` cannot see that, and neither could
 * the sweep that produced CT-177. **A verdicts file is a JOURNAL, not a set of
 * facts** — the same thing `playtest-ledger.ts`'s header says about reports
 * #90 and #114, where the owner retracted twenty-nine minutes later. §1a is
 * that rule, and §0 keeps it from becoming dead code.
 *
 *   §0  non-vacuity — the snapshot is really read, and really has verdicts
 *       in it. A guard over an empty set passes forever, which is exactly how
 *       this one could have shipped meaning nothing.
 *   §1  every non-`works` verdict names a card the pool has
 *   §1a supersession — a later verdict on the same scenario AND room retires
 *       an earlier one, because that is the owner's own retraction convention
 *   §2  every non-`works` verdict has a `card-todo.ts` entry naming that card
 *   §3  the committed snapshot has not fallen behind the transcription in
 *       ledgers/unreached.ts, which is the other reader of the same file
 *
 * ⚠ WHAT THIS DOES NOT DO, and 255 says the same thing about its own subject:
 * it cannot tell you the snapshot is stale. Only `npm run reports` talks to
 * the deploy box. If a verdict goes missing again, run that — do not add a
 * cleverer assertion here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import { CARD_TODO } from '../../ledgers/card-todo.ts';
import { WITNESSED } from '../../ledgers/unreached.ts';
import { VERDICTS_SNAPSHOT } from '../scripts/paths.mjs';

interface VerdictRow {
  ts: string;
  scenario: string;
  card: string;
  verdict: string;
  room?: string;
  actionIndex?: number;
}

const ROWS: VerdictRow[] = readFileSync(VERDICTS_SNAPSHOT, 'utf8')
  .split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as VerdictRow);

/**
 * THE LIVE VERDICT for each board the owner judged.
 *
 * Keyed on scenario AND room, and newest-`ts` wins. That is the owner's own
 * convention, quoted verbatim in his correction: *"supersedes the … broken
 * verdict **on this same room**"*. A re-run in a DIFFERENT room is a fresh
 * judgement on a fresh board and retires nothing — which is why Slag Spewer's
 * `slightly-off` (room RYDP, 2026-08-26) still stands on its own and was
 * answered on its own (CT-86 / R219), even though the same scenario came back
 * `works` in room EWZQ a day later.
 */
const LIVE = new Map<string, VerdictRow>();
for (const r of [...ROWS].sort((a, z) => a.ts.localeCompare(z.ts))) {
  LIVE.set(`${r.scenario}\u0000${r.room ?? ''}`, r);
}

/** the verdicts that oblige somebody to do something — every LIVE one that is
 * not `works`. Reading the raw rows instead is what filed CT-177 against a
 * card the owner had already cleared. */
const OPEN_VERDICTS = [...LIVE.values()].filter(r => r.verdict !== 'works');

/** the rows a later verdict on the same board has retired */
const SUPERSEDED = ROWS.filter(r => LIVE.get(`${r.scenario}\u0000${r.room ?? ''}`) !== r);

// ── §0 non-vacuity ──────────────────────────────────────────────────────

test('§0 the snapshot is really read, and this guard really has something to check', () => {
  assert.ok(ROWS.length >= 30,
    `only ${ROWS.length} verdict rows — the snapshot looks truncated, and a guard over an `
    + 'empty file passes forever. That is the failure mode this file was written against.');
  assert.ok(OPEN_VERDICTS.length > 0,
    'no non-`works` verdicts at all. If that is genuinely true the loop has nothing to hold, '
    + 'but it was not true when this was written: 3 of the 30 rows are not `works`, and 2 of '
    + 'those 3 are still LIVE (§1a retires the third — Vengeance, withdrawn by the owner '
    + 'twenty minutes later on the same room). Check the snapshot first.');
  // and the rows are shaped the way the rest of the file assumes
  for (const r of ROWS) {
    assert.ok(typeof r.card === 'string' && r.card, `row has no card: ${JSON.stringify(r)}`);
    assert.ok(typeof r.scenario === 'string' && r.scenario,
      `row has no scenario: ${JSON.stringify(r)}`);
  }
});

// ── §1 a verdict names a real card ──────────────────────────────────────

test('§1a a later verdict on the same scenario AND room retires the earlier one', () => {
  // NON-VACUITY FIRST. A supersession rule with nothing to supersede is dead
  // code that silently stops meaning anything, and this one had a job on the
  // day it was written: without it, `OPEN_VERDICTS` carries a `broken` row the
  // owner withdrew twenty minutes later, and CT-177 is what that costs.
  assert.ok(SUPERSEDED.length > 0,
    'no verdict in the snapshot is superseded by a later one on the same board. If that is '
    + 'genuinely true the rule below is inert — but it was not true when this was written '
    + '(Vengeance, room YNBP), so check the snapshot before deleting anything.');

  for (const r of SUPERSEDED) {
    const live = LIVE.get(`${r.scenario}\u0000${r.room ?? ''}`)!;
    assert.ok(live.ts > r.ts, 'the surviving row must be the LATER one, not merely the last read');
    assert.equal(live.room ?? '', r.room ?? '', 'and the same board');
  }

  // The one this file exists to remember. Named, because the next reader will
  // find CT-177 in card-todo.ts marked `done` against a card that was never
  // broken, and this is the sentence that explains why it was ever opened.
  const veng = ROWS.filter(r => r.scenario === 'vengeance-taxes-their-play');
  assert.ok(veng.length >= 2, 'the Vengeance pair is the worked example of this rule');
  const [first, last] = [veng[0]!, veng[veng.length - 1]!];
  assert.equal(first.verdict, 'broken', 'judged broken at 13:03Z…');
  assert.equal(last.verdict, 'works', '…and cleared by the same owner, on the same room, at 13:23Z');
  assert.ok(!OPEN_VERDICTS.includes(first),
    'so it must NOT be counted as an open verdict. A guard that reads a journal as a set of '
    + 'facts manufactures work out of retractions — the exact failure playtest-ledger.ts '
    + 'records for reports #90 and #114.');
});


test('§1 every verdict names a card this pool actually has', () => {
  const unknown: string[] = [];
  for (const r of ROWS) {
    try { getCard(r.card); } catch { unknown.push(`${r.scenario} judged "${r.card}"`); }
  }
  assert.deepEqual(unknown, [],
    'a verdict naming a card the registry does not have is a verdict nothing can act on');
});

// ── §2 THE LOCK — a verdict that is not `works` has a ticket ────────────

test('§2 every non-`works` verdict is carried into card-todo.ts, by card', () => {
  // Matched by CARD, not by scenario id: docs/14 §6 says the scenario is
  // "attached", and a ticket may well be filed before anyone thinks to record
  // which scenario produced it — but the card is the thing both sides always
  // know. Deliberately loose in that one direction and strict everywhere else.
  const ticketed = new Set<string>();
  for (const e of CARD_TODO) for (const c of e.cards ?? []) ticketed.add(c);

  const dropped = OPEN_VERDICTS
    .filter(r => !ticketed.has(r.card))
    .map(r => `${r.ts.slice(0, 10)} ${r.card} — "${r.verdict}" in scenario `
      + `${r.scenario}${r.room ? ` (room ${r.room}, action ${r.actionIndex})` : ''} `
      + 'has no card-todo.ts entry');

  assert.deepEqual(dropped, [],
    'owner verdicts with nothing tracking them:\n  ' + dropped.join('\n  ')
    + '\n\ndocs/14 §6: a `broken` or `slightly off` verdict becomes a card-todo entry with '
    + 'the scenario attached. This assertion is what makes that a rule rather than an '
    + 'intention — it is the same lock 83-card-todo.test.ts §4 puts on playtest reports, '
    + 'and it exists because Vengeance went five days without one.');
});

// ── §3 the two readers of this file agree ───────────────────────────────

test('§3 the committed snapshot and the WITNESSED transcription describe the same file', () => {
  // `unreached.ts` WITNESSED is a hand transcription of the same verdicts, and
  // it is the reason the snapshot was thought unnecessary. Two copies of one
  // fact rot apart; this is the cheapest possible check that they have not.
  const inSnapshot = new Set(ROWS.map(r => r.card));
  const missing = Object.keys(WITNESSED).filter(c => !inSnapshot.has(c));
  assert.deepEqual(missing, [],
    'unreached.ts claims a witness for cards the verdict snapshot has no row for:\n  '
    + missing.join('\n  ')
    + '\n\nEither the transcription invented one or the snapshot is behind the box. '
    + 'Run `npm run reports` before assuming the second.');
});
