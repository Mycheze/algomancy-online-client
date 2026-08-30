/* R182 / CARD-TODO #56 — WHAT A LEDGER GUARD ACTUALLY DRIVES, MEASURED.
 *
 * ── THE TICKET, AND THE ANSWER
 *
 * `test/playtest-ledger.ts` holds the owner's own bug reports; a `fixed` entry
 * must cite `guards: ['<file>::<substring of a test name>']`.
 * `83-card-todo.test.ts` and `70-playtest-ledger.test.ts` check that the guard
 * NAMES A REAL TEST THAT CAN FAIL. Neither can check that the guard could ever
 * have FAILED ON THE BEHAVIOUR IN THE REPORT, and an audit of all 312 guard
 * references found four entries where it could not, all one shape:
 *
 *     a guard that unit-tests the LAST HOP with a hand-built input,
 *     for a report about the WHOLE CHAIN.
 *
 * `stackItemX(xItem({ event: dmgEvent(2) }))` proves the reader reads an event
 * that is ALREADY ATTACHED. The player's complaint (#45) was that nothing
 * reached them attached to anything.
 *
 * CARD-TODO #56 asked for a MECHANICAL SCREEN over that: classify each guard's
 * test body by what it drives — a real `Harness`, the `ui-driver`, a whole-pool
 * sweep, a pure function on a hand-built fixture, a source-text regex, a server
 * script — and require a report describing A SYMPTOM THE PLAYER SAW to cite at
 * least one guard that drives the real thing.
 *
 * ⚠ **THAT SCREEN CANNOT BE BUILT, AND THIS FILE IS THE MEASUREMENT THAT SAYS
 * SO.** The classifier is here, it works, and its verdicts are pinned below.
 * They are unambiguous:
 *
 *   the four the audit caught, in their PRE-R173 state
 *     #43 pure     #45 pure     #53 pure     #18 harness
 *
 *   the six the ticket names as CORRECTLY pure
 *     #22 pure     #26 pure     #82 pure     #94 pure     #100 pure
 *     #77 harness, source, uidriver
 *
 * Three of the four blind entries are cited by nothing but pure tests — and so
 * are five of the six correct ones. **The two populations are the same shape.**
 * Any rule of the form "a symptom report must cite a guard that drives the real
 * thing" flags #22, #26, #82, #94 and #100 alongside #43, #45 and #53, and
 * still misses #18 entirely, because #18's blind guard set drives a real
 * `Harness` and then asserts a rules fact — `legalActions(state, D) === []` —
 * that was just as true before the fix as after it.
 *
 * The whole population is small enough to look at: of 96 fixed reports, exactly
 * seven are cited by nothing but pure tests (#22 #26 #36 #38 #82 #94 #100), and
 * five of those seven are on the ticket's own "correctly pure" list.
 *
 * WHY, in one line: the fact that separates them is *"is the pure function
 * under test the ROOT CAUSE?"* — and that fact is nowhere in the repo in
 * machine-readable form. #22's `publishCols` test IS the fix (compacting the
 * holes out of the column array was the bug). #45's `stackItemX` test is a
 * correct test of a correct reader that was never the bug. Same shape, same
 * imports, same fixture style, opposite verdicts. A screen keyed on shape can
 * only guess, and a guessing screen over 96 closed reports is the second-worst
 * artefact in this repo, after one that cannot fail (149-strip-code's lesson,
 * learned the same way: its first cut guessed at "looks like English" and
 * flagged two import continuation lines).
 *
 * ── SO WHAT IS SHIPPED
 *
 *  1. THE INSTRUMENT, and proof it is not blind (§1-§3). The classifier is
 *     worth having whether or not a rule rests on it, and the next person to
 *     audit the ledger should not have to write it again.
 *  2. THE NEGATIVE RESULT, PINNED (§4). The pre-R173 guard lists are inlined
 *     from `git show ae439ac~1` and asserted to be shape-indistinguishable from
 *     the known-correct six. If that ever stops being true — if somebody finds
 *     a property the four have and the six do not — this test FAILS and says to
 *     go and build the screen. That is the falsifiable form of "it cannot be
 *     done", and it is the only honest one.
 *  3. THE ONE RULE THE SHAPE CAN CARRY (§5), stated with exactly how much less
 *     it is than what was asked: an entry closed against NOTHING BUT pure tests
 *     is the population where every automatic check in this repo is silent, so
 *     it must at least carry a `note`. Measured against the four: it would have
 *     caught #43 and #45 (both closed with no note at all) and not #53 or #18.
 *     Two of four is not the screen; it is a ratchet on the way the four
 *     ENTERED the ledger, and it is what is actually available.
 *
 * ⚠ §5 IS NOT A DENYLIST OF "BAD" TEST SHAPES. Being on the pure-only list is
 * not a fault — five of the seven entries on it are cited by the ticket itself
 * as correct. It says only: nothing automatic can speak for this entry, so the
 * human who closed it has to have left something behind.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER, type LedgerEntry } from '../../ledgers/playtest-ledger.ts';
import { stripCode } from '../../ledgers/card-todo.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..');

/** a guard may live in engine/test/… or in the sibling server/… suite */
function sourceOf(rel: string): string | null {
  const full = rel.startsWith('server/') ? path.resolve(ENGINE, '..', rel) : path.join(HERE, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

// ── §1. the instrument ────────────────────────────────────────────────

/**
 * The balanced-brace block starting at the first `{` at or after `from`.
 *
 * ⚠ FEED THIS THE STRIPPED TEXT. Run it over raw source and it goes blind the
 * way `stripCode` itself went blind twice (see 149-strip-code): an apostrophe
 * inside a comment — `// … on the attacker's screen` — opens a "string" that
 * closes thousands of characters later, and the "body" of one small test runs
 * to the end of the file. That is not hypothetical; it is what the first cut of
 * this classifier did, and it credited a pure `publishCols` test with driving a
 * Harness, a ui-driver and a source read, because all three appear further down
 * 55-ui-formation.test.ts. §2 pins it.
 */
function blockAt(src: string, from: number): { text: string; end: number } {
  const open = src.indexOf('{', from);
  if (open < 0) return { text: '', end: from };
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) break; }
    else if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    }
  }
  return { text: src.slice(open, i + 1), end: i + 1 };
}

/** the BODY of a function or arrow whose name ends at `from`.
 *
 * ⚠ Not simply "the next block". `function tombFixture(seed: number): { h: E;
 * A: Seat } { … }` has TWO brace blocks after the name and the first is the
 * RETURN TYPE — taking it credited 146-report-guards' fixture with driving
 * nothing at all, and the helper expansion that whole classifier rests on
 * silently stopped working. So: step over the parameter list, then over any
 * block that is immediately followed by another one. */
function bodyOf(src: string, from: number): string {
  let i = src.indexOf('(', from);
  if (i < 0) return '';
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (!depth) { i++; break; } }
    else if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    }
  }
  for (let k = 0; k < 4; k++) {
    const b = blockAt(src, i);
    if (!b.text) return '';
    if (/^\s*\{/.test(src.slice(b.end))) { i = b.end; continue; }   // that was a type
    return b.text;
  }
  return '';
}

/** every string literal inside the balanced call that starts at `from` — the
 * server suite's `ok(cond, 'label')` convention, lifted from 83-card-todo. */
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
 * Every `test('title', …)` in a file, with its body.
 *
 * Titles come off the RAW text and bodies off the STRIPPED text. That is not a
 * shortcut: `stripCode` BLANKS rather than deletes (149-strip-code's first
 * invariant), so the two share offsets exactly — which is the only reason a
 * title found in one can index into the other.
 */
function testsIn(raw: string, stripped: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  for (const m of raw.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    out.push({ title: m[2]!, body: blockAt(stripped, m.index + m[0].length).text });
  }
  return out;
}

/** top-level helpers, so a test that calls `tombFixture(5921)` is credited with
 * what `tombFixture` does. Three levels deep: 146's fixtures nest. */
function helpersIn(stripped: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of stripped.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
    out.set(m[1]!, bodyOf(stripped, m.index + m[0].length));
  }
  for (const m of stripped.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm)) {
    out.set(m[1]!, bodyOf(stripped, m.index + m[0].length - 1));
  }
  return out;
}

/** identifiers bound to a file read (`const MAIN = readFileSync(…)`) — using
 * one is reading SOURCE TEXT, however the assertion is phrased */
function sourceConstsIn(stripped: string): Set<string> {
  const out = new Set<string>();
  for (const m of stripped.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=[^;]*readFileSync/gm)) {
    out.add(m[1]!);
  }
  return out;
}

type Drive = 'harness' | 'uidriver' | 'view' | 'sweep' | 'source' | 'server' | 'pure';

const SIGNALS: [RegExp, Drive][] = [
  // a real game: the engine builds the state the assertion reads
  [/\bnew Harness\s*\(|\bcreateGame\s*\(|\bdrillCard\s*\(|\bfuzzGame\s*\(|\btoDeployment\s*\(|\btoNextBattle\s*\(/, 'harness'],
  // the real client, through test/ui-driver.ts
  [/\bui\.(join|update|click|html|has|send)\s*\(|\bclient\s*\(\s*\)/, 'uidriver'],
  // what the SEAT is actually served, not the raw state
  [/\bviewFor\s*\(/, 'view'],
  // a whole-pool / whole-ledger sweep
  [/\ballCardNames\s*\(|\bCARD_TODO\b|\bCARD_LEDGER\b|\bLEDGER\b|\bDECK_LIST\b/, 'sweep'],
  [/\breadFileSync\b/, 'source'],
];

/** what the named test in the named file drives. One entry per matching test —
 * a needle that matches two tests yields two verdicts. */
function whatItDrives(file: string, needle: string): { title: string; drives: Drive[] }[] {
  const raw = sourceOf(file);
  if (raw === null) return [];
  // the server suite is a plain script with its own `ok(cond, 'label')`
  // convention and no test bodies to read. It runs a real room against a real
  // server, so "what it drives" is settled without reading it.
  if (file.startsWith('server/')) {
    const titles: string[] = [];
    for (const m of raw.matchAll(/\bok\s*\(/g)) {
      for (const t of callStrings(raw, m.index)) if (t.includes(needle)) titles.push(t);
    }
    return titles.map(title => ({ title, drives: ['server'] as Drive[] }));
  }
  const stripped = stripCode(raw);
  const helpers = helpersIn(stripped);
  const srcConsts = sourceConstsIn(stripped);
  return testsIn(raw, stripped).filter(t => t.title.includes(needle)).map(t => {
    let text = t.body;
    const used = new Set<string>();
    for (let depth = 0; depth < 3; depth++) {
      let grew = false;
      for (const [name, body] of helpers) {
        if (used.has(name)) continue;
        if (new RegExp(`\\b${name}\\s*\\(`).test(text)) { used.add(name); text += `\n${body}`; grew = true; }
      }
      if (!grew) break;
    }
    const drives: Drive[] = [];
    for (const [re, kind] of SIGNALS) if (re.test(text)) drives.push(kind);
    for (const c of srcConsts) {
      if (new RegExp(`\\b${c}\\b`).test(text) && !drives.includes('source')) drives.push('source');
    }
    return { title: t.title, drives: drives.length ? drives : ['pure' as Drive] };
  });
}

/** every drive kind across an entry's whole guard list */
function drivesOf(guards: string[]): { kinds: Set<Drive>; resolved: number } {
  const kinds = new Set<Drive>();
  let resolved = 0;
  for (const g of guards) {
    const [file, needle] = g.split('::');
    if (!file || !needle) continue;
    for (const hit of whatItDrives(file, needle)) {
      resolved++;
      for (const d of hit.drives) kinds.add(d);
    }
  }
  return { kinds, resolved };
}

const fixed = LEDGER.filter(e => e.status === 'fixed');

// ── §2. the instrument is not blind ───────────────────────────────────
//
// 149-strip-code's rule, applied to this checker: ask "what would this look
// like if it were blind?" and then measure it. A blind classifier here reports
// a rich set of drives for everything and the census reads healthy.

test('a comment apostrophe does not run a test body away (the blindness this classifier had)', () => {
  const raw = [
    "test('small', () => {",
    "  // the exact shape of the attacker's screen",
    '  assert.equal(1, 1);',
    '});',
    "test('big', () => {",
    '  const h = new Harness(1);',
    '  assert.ok(h);',
    '});',
  ].join('\n');
  const stripped = stripCode(raw);
  const [small, big] = testsIn(raw, stripped);
  assert.ok(small && big, 'both tests are found');
  assert.ok(!/Harness/.test(small.body),
    "the first test's body swallowed the second. That is the failure this classifier actually "
    + "had: brace-matching the RAW text, where the apostrophe in \"attacker's\" opens a string "
    + 'that never closes on that line — so a pure test was credited with driving a Harness that '
    + 'belongs to a test further down the file.');
  assert.ok(/Harness/.test(big.body), 'and the second still has its own');
});

test('the real case that exposed it: 55-ui-formation\'s publishCols test is small and pure', () => {
  // The concrete instance. Read raw, this body came back 24 660 characters long
  // — the whole rest of the file — and classified as harness+uidriver+source.
  const raw = sourceOf('55-ui-formation.test.ts')!;
  const t = testsIn(raw, stripCode(raw)).find(x => x.title.includes('hole keeps its lane'))!;
  assert.ok(t, 'the test is there');
  assert.ok(t.body.length < 1500, `the body is ${t.body.length} characters — it ran away again`);
  assert.deepEqual(whatItDrives('55-ui-formation.test.ts', 'hole keeps its lane')[0]!.drives, ['pure'],
    'and it is what it is: a pure test of publishCols on a hand-built column array');
});

// ── §3. the instrument can tell the two shapes apart ──────────────────

test('a driven guard reads as driven, and a pure one reads as pure', () => {
  // The control case, so "everything is pure" cannot be how this file passes.
  // 146-report-guards was written (R173) precisely to drive the real producer,
  // and its fixtures build a Harness and read viewFor — through a helper, which
  // is what the helper expansion exists for.
  const driven = whatItDrives('146-report-guards.test.ts', '#45 Awoken Tomb');
  assert.equal(driven.length, 1, 'the needle resolves to one test');
  assert.ok(driven[0]!.drives.includes('harness'), 'it builds a real game…');
  assert.ok(driven[0]!.drives.includes('view'), '…and reads it through the responder\'s view');

  const pure = whatItDrives('50-ui-inspect.test.ts', "a triggered ability's X is the amount its event carried");
  assert.equal(pure.length, 1);
  assert.deepEqual(pure[0]!.drives, ['pure'],
    'and the guard #45 used to be closed against is a pure read of a hand-built StackItem');

  const client = whatItDrives('86-ui-block-refusal.test.ts', 'never reaches the wire at all');
  assert.ok(client[0]!.drives.includes('uidriver'), 'and a real-client test reads as one');
  assert.ok(client[0]!.drives.includes('harness'), '(it feeds the client a real engine state)');
});

test('every guard reference in the ledger resolves to something this classifier can read', () => {
  // The reach measurement. A needle this file cannot resolve is a hole in every
  // number below it, so it is an assertion rather than a footnote — including
  // the server suite, whose `ok(cond, 'label')` convention has no test bodies
  // at all and would otherwise vanish silently (four entries do: #37, #47, #76,
  // #98).
  const unresolved: string[] = [];
  let refs = 0;
  for (const e of LEDGER) {
    for (const g of e.guards ?? []) {
      refs++;
      const [file, needle] = g.split('::');
      if (!file || !needle) { unresolved.push(`#${e.id}: malformed "${g}"`); continue; }
      if (!whatItDrives(file, needle).length) unresolved.push(`#${e.id}: ${g}`);
    }
  }
  assert.ok(refs > 250, `only ${refs} guard references scanned — this file has lost its reach`);
  assert.deepEqual(unresolved, [],
    `guard references this classifier cannot read, so every census below is wrong by that much:`
    + `\n  ${unresolved.join('\n  ')}`);
});

// ── §4. THE FINDING: shape does not separate the two populations ──────

/**
 * The guard lists the four audited entries carried BEFORE R173 repaired them,
 * verbatim from `git show ae439ac~1:digital-client/engine/test/playtest-ledger.ts`.
 * (That is the path AT THAT COMMIT — the directory was renamed to client/ and
 * the ledgers moved out of engine/test/ on 2026-08-30. History keeps the old
 * names, so a rewritten path here would simply return nothing.)
 * Inlined rather than read from git: a test that shells out to git is a test
 * that fails in a worktree, a shallow clone or a detached checkout, and the
 * point of these four is that they never change again.
 */
const PRE_R173: Record<number, string[]> = {
  18: ['53-playtest-round7.test.ts::a seat with a decision pending against the OTHER seat',
    '50-ui-inspect.test.ts::waiting'],
  43: ['50-ui-inspect.test.ts::stackItemX keeps the two X',
    '50-ui-inspect.test.ts::the stack card',
    '50-ui-inspect.test.ts::a spent part'],
  45: ["50-ui-inspect.test.ts::a triggered ability's X is the amount its event carried"],
  53: ['56-ui-flash.test.ts::combat batch is cut at the seams',
    '56-ui-flash.test.ts::three beats'],
};

/** the entries CARD-TODO #56 names as correctly closed against pure tests */
const CORRECTLY_PURE = [22, 26, 77, 82, 94, 100];

test('CARD-TODO #56: the four blind entries are not distinguishable by SHAPE from the six correct ones', () => {
  const pureOnly = (kinds: Set<Drive>): boolean => kinds.size === 1 && kinds.has('pure');

  const blind = Object.entries(PRE_R173).map(([id, guards]) => {
    const { kinds, resolved } = drivesOf(guards);
    assert.ok(resolved > 0, `#${id}: its pre-R173 guards no longer resolve — the reconstruction has rotted`);
    return { id: Number(id), kinds, pureOnly: pureOnly(kinds) };
  });
  const correct = CORRECTLY_PURE.map(id => {
    const e = LEDGER.find(x => x.id === id)!;
    const { kinds, resolved } = drivesOf(e.guards ?? []);
    assert.ok(resolved > 0, `#${id}: its guards no longer resolve`);
    return { id, kinds, pureOnly: pureOnly(kinds) };
  });

  console.log('    PRE-R173 (the four the audit caught):');
  for (const b of blind) console.log(`      #${b.id}  ${[...b.kinds].sort().join(', ')}`);
  console.log('    the six CARD-TODO #56 calls correctly pure:');
  for (const c of correct) console.log(`      #${c.id}  ${[...c.kinds].sort().join(', ')}`);

  // 1. the shape the ticket wanted to key on is present on BOTH sides
  const blindPure = blind.filter(b => b.pureOnly).map(b => `#${b.id}`);
  const correctPure = correct.filter(c => c.pureOnly).map(c => `#${c.id}`);
  assert.ok(blindPure.length > 0, 'some of the blind four are cited by nothing but pure tests');
  assert.ok(correctPure.length > 0,
    'and so are some of the six the ticket calls CORRECT — which is the whole finding. If this '
    + 'ever fails, the two populations have become separable and the screen CARD-TODO #56 asked '
    + 'for is worth building after all.');
  assert.deepEqual(blindPure.sort(), ['#43', '#45', '#53']);
  assert.deepEqual(correctPure.sort(), ['#100', '#22', '#26', '#82', '#94']);

  // 2. and the one blind entry that is NOT pure-only defeats the rule from the
  //    other side: #18 was held down by a test that builds a real Harness and
  //    then asserts `legalActions(state, D) === []` — a rules fact that was
  //    just as true before the fix. "Drives the real thing" is not "could have
  //    failed on the report".
  const eighteen = blind.find(b => b.id === 18)!;
  assert.ok(eighteen.kinds.has('harness'),
    "#18's pre-R173 guards include a real-Harness test, so a 'must drive the real thing' rule "
    + 'lets the entry through — it misses one of the four cases that motivated it outright.');
  assert.ok(!eighteen.kinds.has('uidriver') && !eighteen.kinds.has('view'),
    '(the fix was a branch in ui/main.ts::promptHtml, and nothing cited ever painted a bar)');
});

// ── §5. the one rule the shape CAN carry ──────────────────────────────

/**
 * Entries closed against NOTHING BUT pure tests, where a `note` is missing.
 *
 * Being pure-only is not a fault — five of the seven entries in that population
 * are named by CARD-TODO #56 itself as correct. What is a fault is being in the
 * population that every automatic check is silent about AND leaving nothing
 * behind: no note, no mutation, no record that anybody asked whether the guard
 * could fail. #43 and #45 entered the ledger in exactly that state and stayed
 * there for three days.
 *
 * These two predate the rule. Named individually rather than counted, and each
 * fails the moment it stops being true — the 68-target-conformance house rule.
 */
const NOTELESS_PURE: Record<number, string> = {
  36: 'Closed 2026-08-21 against 50-ui-inspect::Primordial Coalescence (pure) and '
    + "65-effect-conformance::every token an effect creates is declared (a whole-pool sweep whose "
    + 'DRIVE lives at module scope and in a different test, so a body-level classifier reads it as '
    + 'pure — a real limit of this instrument, named rather than tuned away). The second guard is '
    + 'in fact the strong one: R182 made that pass deterministic over all 431 EffectDefs, so it '
    + 'now observes Primordial Coalescence creating its token on every run.',
  38: 'Closed 2026-08-21 against two 63-card-art sweeps over the art manifest. The reported bug WAS '
    + 'the name mapping those sweeps read, so a pure test of it is the right test — but no note '
    + 'records that anyone checked, which is the whole of what this rule asks for.',
};

test('an entry closed against nothing but pure tests leaves something behind', () => {
  // ⚠ WHAT THIS IS AND IS NOT. It is NOT the screen CARD-TODO #56 asked for —
  // §4 measured why that one cannot exist. It is the ratchet that is actually
  // available, and its power is known exactly: applied to the four the audit
  // caught, it would have flagged #43 and #45 (both closed with no note at all)
  // and NOT #53 (which had one) or #18 (not pure-only). Two of four.
  const problems: string[] = [];
  for (const e of fixed) {
    const { kinds, resolved } = drivesOf(e.guards ?? []);
    if (!resolved) continue;                       // §3 already fails on those
    if (!(kinds.size === 1 && kinds.has('pure'))) continue;
    if (e.note) continue;
    if (e.id in NOTELESS_PURE) continue;
    problems.push(`#${e.id} (${e.room}): ${e.report.slice(0, 70)}`);
  }
  assert.deepEqual(problems, [],
    'these reports are closed against nothing but pure tests of hand-built fixtures, and carry no '
    + `note:\n  ${problems.join('\n  ')}\n\n`
    + 'That is the population where 70-playtest-ledger and 83-card-todo have nothing to say — they '
    + 'prove the guard exists, never that it could have failed on the report. A pure test is often '
    + 'exactly right (it is right for #22, #26, #82, #94 and #100). What is needed is the record '
    + 'that somebody checked: break the reported behaviour on purpose, watch the cited guard, and '
    + 'put what happened in `note`.');
});

test('the noteless-pure exemptions are still needed, and still name a real entry', () => {
  const stale: string[] = [];
  for (const [id, why] of Object.entries(NOTELESS_PURE)) {
    assert.ok(why.length > 80, `#${id}: an exemption needs a reason, not a shrug`);
    const e = LEDGER.find(x => x.id === Number(id));
    if (!e) { stale.push(`#${id}: no such report any more`); continue; }
    if (e.status !== 'fixed') { stale.push(`#${id} is no longer 'fixed' — drop the exemption`); continue; }
    if (e.note) { stale.push(`#${id} carries a note now — drop the exemption`); continue; }
    const { kinds } = drivesOf(e.guards ?? []);
    if (!(kinds.size === 1 && kinds.has('pure'))) {
      stale.push(`#${id} cites a guard that drives something now (${[...kinds].join(', ')}) — drop the exemption`);
    }
  }
  assert.deepEqual(stale, [], `exemptions that have outlived their reason:\n  ${stale.join('\n  ')}`);
});

// ── the census, printed on every run ──────────────────────────────────

test('the census of what the ledger\'s guards actually drive', () => {
  const tally = new Map<string, LedgerEntry[]>();
  let refs = 0;
  for (const e of fixed) {
    const { kinds, resolved } = drivesOf(e.guards ?? []);
    refs += resolved;
    const key = [...kinds].sort().join(',') || '—';
    (tally.get(key) ?? tally.set(key, []).get(key)!).push(e);
  }
  console.log(`    ${fixed.length} reports marked fixed, ${refs} guard references resolved`);
  for (const [key, es] of [...tally].sort((a, z) => z[1].length - a[1].length)) {
    console.log(`      ${String(es.length).padStart(3)}  ${key}`
      + (es.length <= 10 ? `   ${es.map(e => `#${e.id}`).join(' ')}` : ''));
  }
  assert.ok(refs > 250, `only ${refs} references resolved — the census has lost its reach`);
  assert.equal([...tally.values()].reduce((n, es) => n + es.length, 0), fixed.length,
    'every fixed entry is in exactly one bucket');
});
