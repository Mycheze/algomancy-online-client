/**
 * The playtest report ledger has to be true, or it is worse than nothing.
 *
 * `playtest-ledger.ts` claims, report by report, what is fixed and which test
 * keeps it fixed. These assertions make those claims checkable:
 *
 *  1. every report has an entry, and the ids are the stable issues.jsonl order
 *  2. a report marked FIXED names at least one guard
 *  3. every named guard is a test that EXISTS and can actually fail
 *  4. anything not fixed explains itself
 *
 * (3) is the one that matters. The Tempest Wrangler report was fixed in round
 * 7 with a test file and came back verbatim two days later; the Harbinger
 * report sat dead for two days behind a `{todo:true}` that could never fail.
 * Naming a guard that does not exist — or that is a todo — is exactly how both
 * of those looked handled while being broken, so both are hard failures here.
 *
 * ── THE ONE MANUAL STEP ───────────────────────────────────────────────────
 *
 * (1) used to be `assert.equal(LEDGER.length, 75)` — a hardcoded number. That
 * number is a claim about a file this repo could not see: the reports are
 * appended to `var/issues.jsonl` ON THE GAME SERVER, and that file is not in
 * git. So the assertion could only ever fail when somebody had ALREADY
 * noticed the new reports and gone to bump it, which is the one moment you do
 * not need a test. Eleven reports landed on 2026-08-22 and the suite stayed
 * green through all of them.
 *
 * `ledgers/playtest-issues.snapshot.jsonl` is a committed copy of
 * that server file, and (1) now checks the ledger against it row by row. The
 * snapshot cannot refresh itself — the server is a different machine — so the
 * step a human still has to do, from `client/`, is:
 *
 *     npm run reports
 *
 * which is one word for
 *
 *     scp benshomeserver.local:/home/bena/Documents/Algomancy/var/issues.jsonl \
 *         ledgers/playtest-issues.snapshot.jsonl
 *
 * Do that whenever you sit down to work through reports. Anything new the copy
 * brings down turns this file red until the ledger has an entry for it, which
 * is the whole point: the reports and the repo can no longer drift silently,
 * they can only drift for as long as it takes someone to run one command.
 *
 * ⚠ THAT IS THE WHOLE INTAKE LOOP, AND IT HAS ALREADY FAILED ONCE. Until R275
 * the command above said `client/server/issues.jsonl` — where the file lived
 * before the 2026-08-30 reorg moved all runtime state to `var/`. scp fetched
 * nothing, the snapshot stayed at 135 rows for three rounds, and twelve owner
 * reports (four of them engine-level) were invisible to a suite that was
 * green: (1) below only compares the ledger to the SNAPSHOT, so a ledger and a
 * snapshot that are both behind the server agree perfectly. Nothing offline
 * can see the twelve missing rows. What is checkable is that the recovery
 * instruction still names the real file, and `255-refresh-command.test.ts`
 * asserts exactly that — every remote path written down in this repo has to be
 * one `scripts/paths.mjs` names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER, type LedgerEntry } from '../../ledgers/playtest-ledger.ts';
import { ISSUES_JSONL, ISSUES_SNAPSHOT, remote } from '../scripts/paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..');

/** cache each guard file's source once — several entries share a file */
const sources = new Map<string, string | null>();
function sourceOf(rel: string): string | null {
  if (!sources.has(rel)) {
    // a guard may live in engine/test/, ui/test/ or server/test/ (the latter
    // two since 2026-09-03, when the ui- and server-only tests went home), or
    // be named with its package prefix
    const candidates = rel.startsWith('server/') || rel.startsWith('ui/')
      ? [path.resolve(ENGINE, '..', rel)]
      : [HERE, path.resolve(ENGINE, '..', 'ui', 'test'), path.resolve(ENGINE, '..', 'server', 'test')]
        .map(d => path.join(d, rel));
    const found = candidates.find(p => fs.existsSync(p));
    sources.set(rel, found ? fs.readFileSync(found, 'utf8') : null);
  }
  return sources.get(rel)!;
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
    else if (c === "'" || c === '"' || c === '`') {          // skip over literals
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    }
  }
  const body = src.slice(open, i);
  return [...body.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(m => m[2]!);
}

/**
 * The named things in a test file that can fail.
 *
 * Two conventions live in this repo and both have to be understood, or the
 * ledger would reject perfectly good server guards: `engine/test/` uses
 * node:test `test('title', …)`, while `server/` uses its own
 * `ok(condition, 'label')` assertion helper and runs as a plain script.
 *
 * ⚠ WHICH CONVENTION APPLIES IS DECIDED BY THE FILE, and that is the whole
 * point. This used to harvest `ok(` from EVERY file — and `assert.ok(` matches
 * it. So an assertion MESSAGE buried inside some unrelated test satisfied a
 * guard reference, and the ledger could then claim a report was held down by a
 * "test" that has no name of its own and cannot be run, found or deleted
 * independently of whatever test it happens to sit inside. Exactly one
 * engine-side reference was resolving that way when this was tightened (#10,
 * pointing at the `assert.ok` message 'declining is illegal here' instead of
 * at the test around it); every other one was a server file, where it is the
 * house convention and stays supported.
 */
function testTitles(rel: string, src: string): { title: string; todo: boolean }[] {
  const out: { title: string; todo: boolean }[] = [];
  for (const m of src.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1([^)]*)/g)) {
    out.push({ title: m[2]!, todo: /todo\s*:\s*true/.test(m[3] ?? '') });
  }
  // server style: the label is the last string literal in the ok(…) call, and
  // several are template strings spanning lines, so take them all
  if (rel.startsWith('server/')) {
    for (const m of src.matchAll(/\bok\(/g)) {
      for (const s of callStrings(src, m.index)) out.push({ title: s, todo: false });
    }
  }
  return out;
}

const needsNote: LedgerEntry['status'][] = ['live', 'partial', 'by-design', 'wontfix'];

/** One row of var/issues.jsonl, exactly as the 🐛 button writes it. */
interface IssueRow {
  ts: string;
  room: string;
  seat: number | null;
  note: string;
  actionIndex: number | null;
}

const SNAPSHOT = ISSUES_SNAPSHOT;
const SNAPSHOT_REL = path.basename(SNAPSHOT);
/**
 * The refresh command, repeated in every failure message that needs it.
 *
 * Both halves are DERIVED — `npm run reports` from the package script that
 * exists, the scp from the path constants — because the hand-written version
 * of this string is what broke (see the header). 255 keeps them honest.
 */
const REFRESH =
  'npm --prefix client run reports\n'
  + `      (i.e. scp ${remote(ISSUES_JSONL)} client/ledgers/${SNAPSHOT_REL})`;

function snapshotRows(): IssueRow[] {
  assert.ok(fs.existsSync(SNAPSHOT),
    `${SNAPSHOT_REL} is missing. It is the committed copy of the game server's `
    + `var/issues.jsonl and the ledger is checked against it. Fetch it:\n    ${REFRESH}`);
  const text = fs.readFileSync(SNAPSHOT, 'utf8');
  return text.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      try { return JSON.parse(line) as IssueRow; }
      catch { throw new Error(`${SNAPSHOT_REL} line ${i + 1} is not JSON — re-fetch it:\n    ${REFRESH}`); }
    });
}

test('every playtest report has a ledger entry, in issues.jsonl order', () => {
  // Reports live in var/issues.jsonl ON THE GAME SERVER and that file is
  // not in git, so for a long time this assertion was a hardcoded count —
  // which is a number a human has to already know is wrong before it can go
  // red. It never once caught an incoming report; eleven arrived on
  // 2026-08-22 and nothing failed.
  //
  // The snapshot beside this file is the committed copy, and the ledger is now
  // checked against IT: same length, same order, same room, same day. The id
  // of a report IS its line index in that file, oldest first (the oldest row
  // predates the id field entirely), which is what makes the pairing possible
  // at all.
  //
  // What is deliberately NOT compared is the report TEXT. `LedgerEntry.report`
  // is the raw note trimmed to its essence — typos left alone but rambling cut,
  // and occasionally two notes about one thing merged into one sentence — so a
  // string comparison would fail on every entry and force the ledger to become
  // a second, worse copy of the snapshot. The snapshot IS the verbatim record;
  // the ledger is the reading of it. Room and date are enough to prove the two
  // are talking about the same report.
  const rows = snapshotRows();

  rows.forEach((row, i) => {
    const e = LEDGER[i];
    assert.ok(e,
      `report #${i} (${row.room}, ${row.ts.slice(0, 10)}) is in ${SNAPSHOT_REL} and has NO ledger `
      + `entry.\n  note: ${JSON.stringify(row.note)}\n`
      + `  Add an entry with id ${i} to ledgers/playtest-ledger.ts — status 'live' with a note `
      + 'saying what you found is the honest starting point.');
    assert.equal(e!.id, i,
      `ledger entry at index ${i} claims id ${e!.id} — ids are the issues.jsonl line index and `
      + 'must stay in order');
    assert.equal(e!.room, row.room,
      `ledger #${i} says room ${e!.room}, but ${SNAPSHOT_REL} line ${i + 1} says ${row.room} — `
      + 'the entries have drifted out of line with the reports (an entry inserted or deleted in '
      + 'the middle, rather than appended)');
    assert.equal(e!.date, row.ts.slice(0, 10),
      `ledger #${i} (${e!.room}) is dated ${e!.date}, but the report was filed `
      + `${row.ts.slice(0, 10)} (${row.ts})`);
  });

  assert.ok(LEDGER.length <= rows.length,
    `the ledger has ${LEDGER.length} entries but ${SNAPSHOT_REL} only has ${rows.length} reports. `
    + 'Either an entry was invented, or — far more likely — the snapshot is stale and the server '
    + `has reports it does not. Re-fetch it and re-run:\n    ${REFRESH}`);

  const seen = new Set<number>();
  for (const e of LEDGER) {
    assert.ok(!seen.has(e.id), `duplicate ledger id ${e.id}`);
    seen.add(e.id);
  }
});

test('a report marked FIXED names at least one guard', () => {
  const unguarded = LEDGER.filter(e => e.status === 'fixed' && !(e.guards?.length));
  assert.deepEqual(unguarded.map(e => `#${e.id} ${e.room}`), [],
    'these are marked fixed but name no test. If you cannot name a test that would fail when '
    + 'the bug returns, the honest status is "partial" or "live" with a note — that is the whole '
    + 'lesson of reports #10 and #28');
});

test('every guard a ledger entry names is a real test that can fail', () => {
  const problems: string[] = [];
  for (const e of LEDGER) {
    for (const ref of e.guards ?? []) {
      const [file, needle] = ref.split('::');
      assert.ok(file && needle, `malformed guard reference "${ref}" on report #${e.id}`);
      const src = sourceOf(file!);
      if (src === null) { problems.push(`#${e.id}: no such test file "${file}"`); continue; }
      const titles = testTitles(file!, src);
      const hits = titles.filter(t => t.title.includes(needle!));
      if (!hits.length) {
        problems.push(`#${e.id}: no test in ${file} has a name containing "${needle}"`);
        continue;
      }
      // A needle that matches SEVERAL tests pins none of them. #43 used to cite
      // `50-ui-inspect.test.ts::X`, which matched TWELVE titles — every
      // X-on-stack test in that file could have been deleted and this stayed
      // green, because one unrelated survivor ("the shortfall is held until it
      // is EXPLAINED…") still contained an X. A guard reference has to name the
      // test it means; where a report really is held down by a family, the
      // family is listed, one entry each.
      if (hits.length > 1) {
        problems.push(`#${e.id}: "${needle}" matches ${hits.length} tests in ${file} `
          + `(${hits.map(t => JSON.stringify(t.title)).join(', ')}) — a substring that matches `
          + 'several pins none of them. Name the one this report is about, or list each of them '
          + 'as its own guard.');
        continue;
      }
      // A {todo:true} test never fails, so it guards nothing. This is exactly
      // how the Harbinger report (#28) looked tracked for two days while the
      // card was completely dead.
      if (hits.every(t => t.todo)) {
        problems.push(`#${e.id}: every match for "${needle}" in ${file} is {todo:true} — `
          + 'a todo cannot fail, so it is not a guard');
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('anything not fixed explains itself, and a by-design divergence cites its source', () => {
  const missing = LEDGER
    .filter(e => needsNote.includes(e.status) && !e.note?.trim())
    .map(e => `#${e.id} (${e.status})`);
  assert.deepEqual(missing, [], 'these need a note saying why');

  // 'by-design' means we are telling the owner his report was wrong. That is
  // only acceptable with a citation he can check.
  const uncited = LEDGER
    .filter(e => e.status === 'by-design')
    .filter(e => !/\bR\d+|Manual|ruling|oracle|printed/i.test(e.note ?? ''))
    .map(e => `#${e.id}`);
  assert.deepEqual(uncited, [],
    'a by-design entry overrides a playtest report, so it must cite the rule, Manual page or '
    + 'ruling that justifies it');
});

test('the ledger reports honestly on how much is still open', () => {
  // Not a threshold — a visible tally, so the open count is impossible to lose
  // track of and shows up in every test run.
  const by = (s: LedgerEntry['status']) => LEDGER.filter(e => e.status === s).length;
  const open = by('live') + by('partial');
  assert.ok(open <= LEDGER.length, 'sanity');
  console.log(`    playtest ledger: ${by('fixed')} fixed · ${by('live')} live · `
    + `${by('partial')} partial · ${by('by-design')} by-design · ${by('wontfix')} wontfix`);

  // And the one fact about the SNAPSHOT that this machine can actually state.
  //
  // It is not a staleness check and must never be dressed up as one: how old
  // the newest report is says nothing about whether the server has newer ones,
  // because a quiet fortnight and a three-round-stale copy look identical from
  // here. Printing the age is worth doing anyway — "newest report: 9 days ago"
  // in front of somebody sitting down to triage is the prompt that the missing
  // twelve never got. The check itself is `npm run reports`; there is no
  // offline substitute for it, and 255 guards the command rather than pretend.
  const rows = snapshotRows();
  const newest = rows.at(-1)!.ts;
  const days = Math.floor((Date.now() - Date.parse(newest)) / 86_400_000);
  console.log(`    snapshot: ${rows.length} reports, newest ${newest.slice(0, 10)} `
    + `(${days}d ago). This repo cannot see the server — refresh with: npm run reports`);
});
