/* R176 — `stripCode` can SEE. Measured, not assumed.
 *
 * WHY THIS FILE EXISTS
 *
 * `stripCode` (test/stripcode.ts) is the one place this repo strips TypeScript
 * for reading, and a dozen sweeps rest on it: card-todo's own checks,
 * 90-coverage-census, 142-static-conformance, 147-comment-conformance,
 * 71-card-ledger, 85-silent-branches. **It has now gone blind twice**, and both
 * times every sweep built on it stayed green while it was blind:
 *
 *   1. (round 24) No notion of a REGEX LITERAL. `engine.ts:175` is
 *      `.replace(/[[\]().,;:!?'"]/g, ' ')` — the lone `'` in that character
 *      class opened a "string" that closed thousands of lines later, inverting
 *      quote parity for the rest of the file. engine.ts 8901 -> 3773 lines,
 *      dsl.ts 1894 -> 704, 30 card files damaged, all three `bin.push` sites
 *      gone. Fixed by BLANKING rather than deleting, plus an end-of-line
 *      resync for every state that cannot legally span a newline.
 *
 *   2. (round 26, this file) The `'line'` state had NO BRANCH OF ITS OWN and
 *      fell through to the regex arm, where an unescaped `/` outside a
 *      character class does `st = 'code'` — so **a line comment ended at its
 *      first slash** and its tail came back as code. `+1/+1`, `ll/2`, `and/or`
 *      and every file path make that near-universal: 927 line-comment lines
 *      across the 28 batch files leaked, plus 86 in engine.ts. A leaked
 *      backtick then opened a TEMPLATE-LITERAL state, which may legally span
 *      newlines, and the desync swallowed real code: **ten `card()`
 *      definitions vanished** from batch-hybrids-ld-c.ts and batch-light-a.ts.
 *
 * Neither was found by a sweep. Both were found by a human or an agent saying
 * *"my sweep says clean and I don't believe it."* That is how a defect in a
 * VERIFIER announces itself — never directly — so the fix is not to be more
 * careful, it is to MEASURE THE VERIFIER. Hence this file.
 *
 * The general rule, worth applying to any checker in this repo: ask *"what
 * would this look like if it were blind?"* and then go and measure it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCode } from './stripcode.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');
const SETS = path.join(SRC, 'cards', 'sets');
const setFiles = fs.readdirSync(SETS).filter(f => f.endsWith('.ts'));

/* ── 1. the two invariants the round-24 fix bought, kept explicit ───────── */

test('stripCode BLANKS rather than deletes — every line survives, at its own number', () => {
  // Callers print `file:${n + 1}` off the stripped text, so a dropped line
  // silently renames every finding after it.
  for (const f of ['engine.ts', 'cards/dsl.ts']) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert.equal(stripCode(src).split('\n').length, src.split('\n').length,
      `${f}: stripCode changed the line count — this is failure mode 1, the one that took `
      + 'engine.ts from 8901 lines to 3773 and left every sweep on it green.');
  }
  for (const f of setFiles) {
    const src = fs.readFileSync(path.join(SETS, f), 'utf8');
    assert.equal(stripCode(src).split('\n').length, src.split('\n').length, `${f}: line count moved`);
  }
});

test('a misjudged delimiter costs ONE LINE, never the rest of the file', () => {
  // The resync rule: only a block comment and a template literal may legally
  // span a newline, so every other state ends at '\n'. Feed it something
  // genuinely ambiguous and check the damage is bounded.
  const src = [
    "const ratio = a / b;   // it's a division, not a regex",
    'const alive = 1;',
    'const alsoAlive = 2;',
  ].join('\n');
  const out = stripCode(src).split('\n');
  assert.match(out[1]!, /alive/, 'the line after an ambiguous quote must survive intact');
  assert.match(out[2]!, /alsoAlive/, 'and so must the one after that');
});

/* ── 2. failure mode 2, directly ────────────────────────────────────────── */

test('a line comment ends at the NEWLINE, not at its first slash', () => {
  const out = stripCode('// a comment with a / slash then {x:1}');
  assert.ok(!out.includes('{x:1}'),
    'the tail of a line comment leaked back as code. This is failure mode 2: the `line` state '
    + 'fell through to the regex arm, where `/` ends the state. Card comments are FULL of '
    + 'slashes (+1/+1, ll/2, and/or, every file path), so this leaked ~1000 lines of English '
    + 'into the code view of a dozen sweeps.');
  assert.equal(out.trim(), '', 'a line comment must blank completely');
});

test('a backtick inside a line comment does not open a template literal', () => {
  // This is the half that ate real code: `tpl` may legally span newlines, so a
  // leaked backtick desynced the parser until the next one — however far away.
  const out = stripCode('// use `foo` and `bar` here\nconst after = 2;\nconst later = 3;').split('\n');
  assert.match(out[1]!, /after/, 'the line after a backticked comment must survive');
  assert.match(out[2]!, /later/, 'and the one after that — an unterminated `tpl` runs on forever');
});

/* ── 3. THE REACH MEASUREMENT — the test that would have caught both ───── */

test('every card() definition in the pool is VISIBLE in the stripped view', () => {
  // The blunt, whole-pool measurement. Both failure modes showed up here and
  // in nothing else: mode 2 hid ten card() definitions in two files while all
  // nine sweeps resting on stripCode reported clean.
  const lost: string[] = [];
  let raw = 0, seen = 0;
  for (const f of setFiles) {
    const src = fs.readFileSync(path.join(SETS, f), 'utf8');
    const a = (src.match(/^card\(/gm) ?? []).length;
    const b = (stripCode(src).match(/^card\(/gm) ?? []).length;
    raw += a; seen += b;
    if (a !== b) lost.push(`${f}: ${a} defined, ${b} visible (LOST ${a - b})`);
  }
  assert.ok(raw > 400, `only ${raw} card() definitions found — the scan itself has lost its reach`);
  assert.deepEqual(lost, [],
    `stripCode cannot see part of the card pool, so every sweep built on it is reading a `
    + `truncated file and reporting clean:\n  ${lost.join('\n  ')}`);
  assert.equal(seen, raw);
});

test('a line that is nothing but a line comment blanks completely, pool-wide', () => {
  // EXACT, not a heuristic. My first version of this test guessed at "looks
  // like English" and flagged two IMPORT CONTINUATION LINES — real code —
  // which is the second-worst artefact in this repo after a test that cannot
  // fail. So: take the lines whose SOURCE is unambiguously a whole-line
  // comment, and require the stripped line to be pure whitespace. No judgement
  // about what prose looks like is needed, and there is nothing to tune.
  //
  // This is the precise shape of failure mode 2: `// grants +1/+1 to allies`
  // came back as `             +1 to allies`.
  const leaks: string[] = [];
  let checked = 0;
  for (const f of [...setFiles.map(x => path.join(SETS, x)), path.join(SRC, 'engine.ts')]) {
    const src = fs.readFileSync(f, 'utf8');
    const out = stripCode(src).split('\n');
    src.split('\n').forEach((line, i) => {
      if (!/^\s*\/\//.test(line)) return;      // not a whole-line comment
      checked++;
      if (out[i]!.trim() !== '') {
        leaks.push(`${path.basename(f)}:${i + 1}  kept "${out[i]!.trim().slice(0, 60)}"`);
      }
    });
  }
  assert.ok(checked > 2000,
    `only ${checked} whole-line comments scanned — this test has lost its reach and would pass `
    + 'vacuously');
  assert.deepEqual(leaks.slice(0, 15), [],
    `${leaks.length} of ${checked} whole-line comments leaked text into the code view. Every `
    + `sweep resting on stripCode is reading English as TypeScript on those lines:\n  `
    + leaks.slice(0, 15).join('\n  '));
});
