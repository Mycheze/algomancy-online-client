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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER, type LedgerEntry } from './playtest-ledger.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..');

/** cache each guard file's source once — several entries share a file */
const sources = new Map<string, string | null>();
function sourceOf(rel: string): string | null {
  if (!sources.has(rel)) {
    // a guard may live in engine/test/… or in the sibling server/… suite
    const candidates = rel.startsWith('server/')
      ? [path.resolve(ENGINE, '..', rel)]
      : [path.join(HERE, rel)];
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
 */
function testTitles(src: string): { title: string; todo: boolean }[] {
  const out: { title: string; todo: boolean }[] = [];
  for (const m of src.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1([^)]*)/g)) {
    out.push({ title: m[2]!, todo: /todo\s*:\s*true/.test(m[3] ?? '') });
  }
  // server style: the label is the last string literal in the ok(…) call, and
  // several are template strings spanning lines, so take them all
  for (const m of src.matchAll(/\bok\(/g)) {
    for (const s of callStrings(src, m.index)) out.push({ title: s, todo: false });
  }
  return out;
}

const needsNote: LedgerEntry['status'][] = ['live', 'partial', 'by-design', 'wontfix'];

test('every playtest report has a ledger entry, in issues.jsonl order', () => {
  // Reports live in server/issues.jsonl, which is NOT in git — that is half of
  // why they used to evaporate. The ledger is the committed copy, so the count
  // is pinned here: when new reports come in, this number moves in the same
  // commit that adds the entries, and a report cannot be quietly dropped.
  const EXPECTED = 64;
  assert.equal(LEDGER.length, EXPECTED,
    `the ledger has ${LEDGER.length} entries but ${EXPECTED} reports have been filed — `
    + 'add the missing entries (and bump EXPECTED in the same commit)');
  LEDGER.forEach((e, i) => assert.equal(e.id, i,
    `ledger entry ${i} claims id ${e.id} — ids are the issues.jsonl index and must stay in order`));
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
      const titles = testTitles(src);
      const hits = titles.filter(t => t.title.includes(needle!));
      if (!hits.length) {
        problems.push(`#${e.id}: no test in ${file} has a name containing "${needle}"`);
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
});
