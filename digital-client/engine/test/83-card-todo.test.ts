/**
 * THE CARD TODO HAS TO BE TRUE, OR IT IS WORSE THAN NOTHING.
 *
 * `card-todo.ts` is the tickable list of everything known to be wrong with the
 * cards. A list like that has exactly one failure mode — it rots, quietly, and
 * then it is a comment again. This repo has been burned by that twice already
 * (the PARKED notes that outlived the primitive they were waiting for, and
 * Harbinger of Immolation's `{ todo: true }` placeholder that could never
 * fail), so the assertions here run in BOTH directions:
 *
 *  1. Every OPEN item is still broken. Each entry carries a `proof` that
 *     returns true while the bug is present; when someone fixes it the proof
 *     goes false and this file FAILS, naming the item to tick off. A fix
 *     therefore cannot land without the list being updated.
 *  2. Every DONE item is really done — its proof must NOT still hold, AND it
 *     names a real test that would fail if the bug came back. Without that
 *     second half "done" is a commit message: `playtest-ledger.ts` learned
 *     this from reports #10 and #28 and runs the identical rule.
 *  3. Every entry is well-formed, and the ones that carry no proof say how a
 *     human checks them instead.
 *  4. The items lifted from owner bug reports still match the playtest ledger.
 *  5. A tally, printed on every run, so the number cannot be ignored.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import { CARD_TODO, type TodoEntry } from './card-todo.ts';
import { LEDGER as PLAYTEST_LEDGER } from './playtest-ledger.ts';
import { CARD_LEDGER } from './card-ledger.ts';

const open = CARD_TODO.filter(e => e.status === 'open');
const done = CARD_TODO.filter(e => e.status === 'done');

/** run a proof without letting a throw masquerade as "fixed" */
function holds(e: TodoEntry): { ok: boolean; err?: string } {
  if (!e.proof) return { ok: true };
  try { return { ok: e.proof() }; } catch (err) { return { ok: false, err: (err as Error).message }; }
}

// ── 1. every open item is STILL BROKEN ──────────────────────────────────

test('every open todo item is still broken — tick it off when it is fixed', () => {
  const fixed: string[] = [];
  for (const e of open) {
    const r = holds(e);
    if (r.err) {
      fixed.push(`CT-${e.id} "${e.title}": its proof THREW (${r.err}) — the proof itself is `
        + 'broken, or the code it reads has moved. Repair the proof or close the item.');
    } else if (!r.ok) {
      fixed.push(`CT-${e.id} "${e.title}": the proof no longer holds — this looks FIXED. `
        + "Set status: 'done' (and delete any exemption that named it: SILENT_KNOWN in "
        + '81-card-drill, the Piercing assertion in 82-attr-interactions, …).');
    }
  }
  assert.deepEqual(fixed, [],
    'todo items that appear to have been fixed without being ticked off:\n  ' + fixed.join('\n  '));
});

// ── 2. and every closed item really is closed ───────────────────────────

test('every item marked done is really done', () => {
  const notDone: string[] = [];
  for (const e of done) {
    if (holds(e).ok && e.proof) {
      notDone.push(`CT-${e.id} "${e.title}" is marked done but its proof still holds — it is not fixed`);
    }
  }
  assert.deepEqual(notDone, []);
});

// ── 2b. and it names something that would CATCH the regression ──────────
//
// Copied deliberately from 70-playtest-ledger.test.ts rather than shared: the
// two ledgers are allowed to drift apart, and a helper shared between them
// would quietly couple their formats. The rule is the same one, though, and
// so is the reason for it — a fix whose only record is a status flag is
// indistinguishable from a fix that was never made.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..');

/** a guard may live in engine/test/… or in the sibling server/… suite */
function sourceOf(rel: string): string | null {
  const full = rel.startsWith('server/')
    ? path.resolve(ENGINE, '..', rel)
    : path.join(HERE, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

/** every string literal inside the call that starts at `src[from]`'s open paren */
function callStrings(src: string, from: number): string[] {
  const open = src.indexOf('(', from);
  if (open < 0) return [];
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (!depth) break; }
    else if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    }
  }
  return [...src.slice(open, i).matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(m => m[2]!);
}

/**
 * The named things in a file that can fail. TWO conventions live in this repo
 * and both have to be understood, or a perfectly good server guard is
 * rejected: `engine/test/` uses node:test `test('title', …)`, while `server/`
 * uses its own `ok(condition, 'label')` helper and runs as a plain script.
 * Lifted from 70-playtest-ledger.test.ts, which learned it the same way.
 */
function testTitles(src: string): { title: string; todo: boolean }[] {
  const out: { title: string; todo: boolean }[] = [];
  for (const m of src.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1([^)]*)/g)) {
    out.push({ title: m[2]!, todo: /todo\s*:\s*true/.test(m[3] ?? '') });
  }
  for (const m of src.matchAll(/\bok\(/g)) {
    for (const t of callStrings(src, m.index)) out.push({ title: t, todo: false });
  }
  return out;
}

test('an item marked done names at least one test that keeps it fixed', () => {
  const unguarded = done.filter(e => !(e.guards?.length)).map(e => `CT-${e.id} "${e.title}"`);
  assert.deepEqual(unguarded, [],
    'these are marked done but name no guard. If you cannot name a test that would fail when '
    + 'the bug returns, it is not done — leave it open with a note saying what is missing. '
    + 'A `proof` going false only says the OLD shape is gone; a guard says the NEW behaviour '
    + 'is pinned, and they are not the same claim.');
});

test('every guard a todo item names is a real test that can fail', () => {
  const problems: string[] = [];
  for (const e of CARD_TODO) {
    for (const ref of e.guards ?? []) {
      const [file, needle] = ref.split('::');
      if (!file || !needle) { problems.push(`CT-${e.id}: malformed guard "${ref}"`); continue; }
      const src = sourceOf(file);
      if (src === null) { problems.push(`CT-${e.id}: no such test file "${file}"`); continue; }
      const hits = testTitles(src).filter(t => t.title.includes(needle));
      if (!hits.length) {
        problems.push(`CT-${e.id}: no test in ${file} has a name containing "${needle}"`);
        continue;
      }
      // A {todo:true} test never fails, so it guards nothing.
      if (hits.every(t => t.todo)) {
        problems.push(`CT-${e.id}: every match for "${needle}" in ${file} is {todo:true} — `
          + 'a todo cannot fail, so it is not a guard');
      }
    }
  }
  assert.deepEqual(problems, []);
});

// ── 3. well-formedness ──────────────────────────────────────────────────

test('every todo entry is well-formed and names something real', () => {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const e of CARD_TODO) {
    if (seen.has(e.id)) problems.push(`CT-${e.id}: duplicate id`);
    seen.add(e.id);
    if (e.title.trim().length < 20) problems.push(`CT-${e.id}: the title has to say what is wrong`);
    // the detail is what someone reads a month from now instead of re-deriving
    // the bug, so it has to carry the printed clause or the owner's words
    if (e.detail.trim().length < 120) problems.push(`CT-${e.id}: "detail" must quote the printed clause or the report`);
    if (e.evidence.trim().length < 20) problems.push(`CT-${e.id}: "evidence" must say how this was found`);
    if (e.fix.trim().length < 30) problems.push(`CT-${e.id}: "fix" needs a starting point, not a shrug`);
    // an item with no machine check is the kind that rots — it must at least
    // tell a human how to confirm it
    if (!e.proof && !e.verify?.trim()) {
      problems.push(`CT-${e.id}: no proof and no "verify" — nothing can ever re-check this`);
    }
    for (const c of e.cards ?? []) {
      try { getCard(c); } catch { problems.push(`CT-${e.id}: names unknown card "${c}"`); }
    }
  }
  assert.deepEqual(problems, []);
});

// ── 4. the report-derived items match the ledger ────────────────────────

test('every unanswered owner report is carried into the todo list, and none is invented', () => {
  const liveReports = PLAYTEST_LEDGER.filter(r => r.status === 'live' || r.status === 'partial');
  const carried = new Set(CARD_TODO.filter(e => e.reportId !== undefined).map(e => e.reportId!));

  const dropped = liveReports.filter(r => !carried.has(r.id))
    .map(r => `report #${r.id} (${r.room}) is still ${r.status} and has no todo entry`);
  assert.deepEqual(dropped, [],
    'unanswered reports missing from the todo list:\n  ' + dropped.join('\n  ')
    + '\n\nThis is the assertion that makes "including unanswered user reports" true rather '
    + 'than a claim: a report that goes live and is not carried here fails the suite.');

  // The two ledgers have to move TOGETHER, in both directions. An OPEN todo
  // item citing a report the playtest ledger already calls fixed means one of
  // the two is lying; a DONE item still citing a `live` report means the same
  // thing the other way round. Either way the pair is checked, never one.
  const disagree: string[] = [];
  for (const e of CARD_TODO) {
    if (e.reportId === undefined) continue;
    const r = PLAYTEST_LEDGER.find(x => x.id === e.reportId);
    if (!r) { disagree.push(`CT-${e.id} cites report #${e.reportId}, which does not exist`); continue; }
    const reportOpen = r.status === 'live' || r.status === 'partial';
    if (e.status === 'open' && !reportOpen) {
      disagree.push(`CT-${e.id} is open but report #${r.id} is '${r.status}' — close the todo item too`);
    }
    if (e.status === 'done' && reportOpen) {
      disagree.push(`CT-${e.id} is done but report #${r.id} is still '${r.status}' — `
        + 'update playtest-ledger.ts in the same change, with the guards that keep it fixed');
    }
  }
  assert.deepEqual(disagree, []);
});

// ── 5. the tally ────────────────────────────────────────────────────────

test('the todo list reports honestly on how much is open', () => {
  const by = (k: TodoEntry['severity']) => open.filter(e => e.severity === k).length;
  const area = (k: TodoEntry['area']) => open.filter(e => e.area === k).length;
  const unproven = open.filter(e => !e.proof).length;
  console.log(
    `    CARD TODO: ${open.length} open · ${done.length} done — `
    + `${by('blocker')} blocker / ${by('major')} major / ${by('minor')} minor`);
  console.log(
    `    by area: ${area('card')} card · ${area('attribute')} attribute · ${area('engine')} engine `
    + `· ${area('client')} client · ${area('coverage')} coverage`);
  console.log(
    `    ${open.length - unproven} of ${open.length} are machine-checked; ${unproven} rely on a `
    + 'human following "verify"');
  // Read LIVE, never hardcoded. This line said "28" for exactly one day before
  // R104 deleted five entries, which is the whole failure mode this file exists
  // to prevent — a number in a comment is a claim about the repo on the day it
  // was typed.
  console.log(
    `    (card-ledger.ts separately tracks ${CARD_LEDGER.length} more cards with a dead `
    + 'printed clause — see CT-8)');
  assert.ok(open.length + done.length === CARD_TODO.length, 'sanity');
});
