/* R233 / CT-102 — docs/13-assessment.md QUOTES NUMBERS. NOTHING RE-READ THEM.
 *
 * ── WHAT HAPPENED ─────────────────────────────────────────────────────
 *
 * On 2026-08-26 `docs/13-assessment.md` §3 read:
 *
 *     BOARD 25 · CHOICE 5 · VOCAB 3 · EXTRACT 2 · REGION 1 · EVENTLESS 1
 *     "38 claims across 37 cards"
 *
 * On 2026-08-28 the suite printed `37 across 36`, with no EVENTLESS bucket at
 * all. The document had been wrong for two days. R219 (7864bb8) moved a claim
 * underneath it and nothing said a word.
 *
 * ── WHY THIS ONE IS DIFFERENT FROM EVERY OTHER §5 ENTRY ───────────────
 *
 * Every other blindness catalogued in docs/13 §5 is an INSTRUMENT THAT WENT
 * BLIND — `stripCode` losing 5,128 lines to a stray quote, `Harness.absorb`
 * making every secrecy test unfalsifiable, a dead-code sweep that could not
 * match an identifier containing `$`. This is not that. **The instrument was
 * correct and printing correctly.** Nobody read it.
 *
 * And the stale paragraph sits DIRECTLY BELOW a warning box which says this
 * exact line was got wrong three times in one day, and ends:
 *
 *     "The tally the suite prints has been right every single time.
 *      Quote it; do not re-derive it."
 *
 * Nobody re-derived it. It was copied once and never re-read. **A warning box
 * is not a control.** That is the finding, and this file is the control.
 *
 * ── WHAT THIS GUARDS, AND WHAT IT DELIBERATELY DOES NOT ───────────────
 *
 * GUARDED: the UNREACHED card count and the full precondition partition — the
 * numbers that actually drifted, including the vanishing EVENTLESS bucket.
 * They are read from `UNREACHED` AT RUNTIME via `Object.keys`, never scraped
 * from a source file. That is a deliberate choice with a scar behind it: the
 * first version of the scenario queue regexed `UNREACHED` out of a test file
 * and read 32 keys where the object has 37, because five card names are
 * single words written as bare JS identifiers. Two independent scrapes agreed
 * on 32 — they shared the assumption, not the answer.
 *
 * NOT GUARDED, and said out loud rather than left to be discovered: the
 * `393 / 439` and `279 / 316` promise counts in §1② and §3. Those come from a
 * whole-pool drill (~491 cards × 3 boards) and cannot be obtained without
 * paying for that run, which `84-card-semantics` already pays once. Reproducing
 * it here would double the suite's most expensive minute to check a document.
 * So this file covers the partition and `84` remains the only source of the
 * promise counts. ⚠ IF THOSE DRIFT AGAIN, THIS FILE WILL NOT CATCH IT.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { UNREACHED } from '../../ledgers/unreached.ts';

const DOC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', '13-assessment.md');

/** the partition, derived exactly the way 84-card-semantics derives it */
function partitionOf(u: Record<string, string>): Map<string, number> {
  const opener = (why: string): string => /^([A-Z]+)/.exec(why)?.[1] ?? '??';
  const m = new Map<string, number>();
  for (const why of Object.values(u)) {
    const k = opener(why);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** pull `BOARD 25 · CHOICE 5 · …` out of the document */
function quotedPartition(text: string): Map<string, number> | null {
  const line = /\*\*((?:[A-Z]+ \d+(?: · )?)+)\.?\*\*/.exec(text);
  if (!line) return null;
  const m = new Map<string, number>();
  for (const [, k, n] of line[1]!.matchAll(/([A-Z]+) (\d+)/g)) m.set(k!, Number(n));
  return m;
}

test('CT-102 POSITIVE CONTROL: the reader can see, and can tell right from wrong', () => {
  // ⚠ THE HALF THAT MATTERS. A doc-scrape that silently matches NOTHING passes
  // every comparison it is asked to make, and docs/13 §5 is a catalogue of
  // exactly that shape. So prove the parser finds a partition, and prove it
  // would notice a wrong one — before trusting it about the real document.
  const good = quotedPartition('the partition is **BOARD 25 · CHOICE 5 · REGION 1.**');
  assert.ok(good, 'the parser could not read a partition it was handed verbatim');
  assert.deepEqual([...good].sort(), [['BOARD', 25], ['CHOICE', 5], ['REGION', 1]].sort());

  const stale = quotedPartition('**BOARD 25 · CHOICE 5 · REGION 1 · EVENTLESS 1.**');
  assert.notDeepEqual([...stale!].sort(), [...good].sort(),
    'the parser cannot tell a stale partition from a current one — it would have passed '
    + 'through the exact EVENTLESS drift this file exists to catch');

  assert.equal(quotedPartition('there is no partition in this sentence'), null,
    'the parser invented a partition out of prose, so a document that stopped quoting the '
    + 'tally at all would read as agreeing with it');
});

test('CT-102: docs/13 quotes the CURRENT precondition partition, not a remembered one', () => {
  const text = readFileSync(DOC, 'utf8');
  const quoted = quotedPartition(text);
  assert.ok(quoted, 'docs/13-assessment.md no longer quotes a `BOARD n · CHOICE n · …` '
    + 'partition anywhere. Either it stopped citing the tally — in which case delete this '
    + 'test deliberately — or the format changed and this reader has gone blind, which is '
    + 'the failure it was written to prevent. Do not assume the second.');

  const live = partitionOf(UNREACHED);
  assert.deepEqual(
    [...quoted].sort((a, b) => a[0].localeCompare(b[0])),
    [...live].sort((a, b) => a[0].localeCompare(b[0])),
    'docs/13-assessment.md quotes a precondition partition that is no longer true.\n'
    + `  document: ${[...quoted].map(([k, n]) => `${k} ${n}`).join(' · ')}\n`
    + `  live     : ${[...live].map(([k, n]) => `${k} ${n}`).join(' · ')}\n\n`
    + 'The suite is right and the document is stale — that has been the direction every '
    + 'single time. Update the document; do not "fix" UNREACHED to match it.');
});

test('CT-102: docs/13 quotes the CURRENT unreached CARD count', () => {
  const text = readFileSync(DOC, 'utf8');
  // "37 claims across 36 cards" — the second number is the card count, and
  // switching the two units silently is the specific mistake this line has
  // made twice before (84-card-semantics says so in its own comment).
  const m = /\*\*(\d+) claims across (\d+) cards\*\*/.exec(text);
  assert.ok(m, 'docs/13-assessment.md no longer carries an "N claims across M cards" line. '
    + 'If that was deliberate, delete this test deliberately too — but a reader that quietly '
    + 'finds nothing is how this class of bug survives.');
  assert.equal(Number(m[2]), Object.keys(UNREACHED).length,
    `docs/13 says ${m![2]} cards; UNREACHED holds ${Object.keys(UNREACHED).length} at runtime. `
    + '⚠ Read Object.keys() and not a scrape: five UNREACHED keys are bare JS identifiers, '
    + 'and a regex over the source once reported 32 where the object had 37.');
  assert.ok(Number(m[1]) >= Number(m[2]),
    `docs/13 says ${m![1]} claims across ${m![2]} cards. A card can carry more than one `
    + 'unobserved claim, so claims >= cards always. These two units have been swapped in '
    + 'this document before.');
});
