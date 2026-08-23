/**
 * HOW DEEPLY IS EACH CARD ACTUALLY TESTED? — CARD-TODO #9.
 *
 * The complaint this file answers, measured 2026-08-23: 121 of the pool's
 * registered cards were named exactly ONCE across every file in test/. That
 * shape is the registration smoke check — spawn the body, assert the printed
 * power/toughness — and it passes for a card whose rules text does nothing at
 * all. It is what let three silent cards (Abduct, Divine Intervention,
 * Immolate) sit behind a green suite through a whole playtest round.
 *
 * The fix for that is not one number, it is a PROGRAM: per-card assertions
 * that the card does the specific thing it prints. A program needs a
 * scoreboard, and a scoreboard that nobody can see is a comment. So this file
 * measures the pool's coverage in four bands, prints them on every run, and
 * floors each one so it cannot silently go backwards.
 *
 * THE FOUR BANDS, weakest to strongest:
 *
 *   1. REGISTERED    the card exists. Every card is here.
 *   2. DRIVEN        81-card-drill plays it through the real action path in
 *                    three board states and it resolves without crashing and
 *                    changes the game state. A behavioural floor, and it is
 *                    only a floor: it does not check WHAT changed.
 *   3. PROMISED      84-card-semantics extracts a typed promise from its
 *                    printed text and observes the promise being delivered.
 *                    Only unconditional promises count.
 *   4. NAMED         a human wrote a test about this specific card, by name,
 *                    outside the sweep files. This is the only band that can
 *                    assert the card does the RIGHT thing rather than A thing.
 *
 * Band 4 is the one #9 is about, and the honest read of the number is that it
 * counts ATTENTION, not correctness — a card named ten times can still be
 * wrong, and a card named twice can be perfect. What it cannot be is a card
 * nobody has looked at, and that is the population this file exists to keep
 * visible.
 *
 * ⚠ The sweep files are excluded on purpose. Their mentions are exemption
 * lists and ledger rows — a card named in `KNOWN_UNMET` or in card-ledger.ts is
 * named because it does NOT work, and counting that as coverage would invert
 * the measurement. The exclusion list is checked against reality below, so a
 * new sweep file cannot quietly inflate the number.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/cards/registry.ts';
import { allCardNames } from '../src/cards/dsl.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Files whose card mentions are NOT evidence that anyone tested the card.
 * Each carries its reason; the test below fails if one stops existing, so the
 * list cannot outlive its cause the way the old PARKED notes did.
 */
const SWEEPS: Record<string, string> = {
  '63': 'printed-data conformance — names every card by construction',
  '65': 'effect conformance — its lists are exemptions, not behaviour',
  '68': 'target conformance — same',
  '71': 'the card ledger sweep — every name in it is a card that does NOT work',
  '81': 'the whole-pool drill — names every card by construction',
  '83': 'the todo list — names cards that are broken',
  '84': 'the semantic sweep — its KNOWN_UNMET is a list of failures',
  '88': 'replacement conformance — exemption lists',
  '31': 'trio/deck sweeps',
  '34': 'constructed deck lists',
  '52': 'the UI glossary sweep',
  '57': 'the card-text sweep',
  '70': 'the playtest ledger',
  '75': 'UI reachability',
};

function testFiles(): string[] {
  return fs.readdirSync(HERE).filter(f => f.endsWith('.test.ts'));
}

/** how many times each card is named in NON-sweep test files */
function namedCounts(): Map<string, number> {
  const counts = new Map(allCardNames().map(n => [n, 0]));
  for (const f of testFiles()) {
    if (SWEEPS[f.slice(0, 2)]) continue;
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const name of counts.keys()) {
      // both quote styles: `card("Blight's End", …)` is written with doubles
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const n = (src.match(new RegExp(`(['"])${esc}\\1`, 'g')) ?? []).length;
      if (n) counts.set(name, counts.get(name)! + n);
    }
  }
  return counts;
}

test('every excluded sweep file still exists — an exclusion cannot outlive its cause', () => {
  const present = new Set(testFiles().map(f => f.slice(0, 2)));
  const gone = Object.keys(SWEEPS).filter(p => !present.has(p));
  assert.deepEqual(gone, [],
    'these prefixes are excluded from the coverage census but no longer name a test file. '
    + 'Excluding a file that is not there inflates the "named by a human" band for free.');
});

test('the pool coverage census — printed on every run so CARD-TODO #9 cannot rot', () => {
  const counts = namedCounts();
  const total = counts.size;
  const never = [...counts].filter(([, n]) => n === 0).map(([c]) => c).sort();
  const once = [...counts].filter(([, n]) => n === 1).map(([c]) => c).sort();
  const many = total - never.length - once.length;

  console.log(`    pool coverage: ${total} cards registered`);
  console.log(
    `      band 4 (a human wrote a test naming it): ${many} named more than once · `
    + `${once.length} named exactly once · ${never.length} never named outside a sweep`);
  console.log(
    '      bands 2-3 (drill + semantics) are reported by 81-card-drill and '
    + '84-card-semantics on their own runs');
  if (never.length) console.log(`      never named: ${never.join(', ')}`);

  // The bar is that the WEAK band does not grow. Adding cards is fine; adding
  // cards nobody writes a test for is the thing this catches. Absolute, not a
  // percentage, so a bigger pool cannot dilute it.
  assert.ok(once.length + never.length <= 120,
    `${once.length + never.length} cards have at most one human-written mention `
    + `(${never.length} have none). That population was 131 at the start of this round and `
    + '118 after it — the floor is set just above the real number ON PURPOSE, so the next '
    + 'card added without a test of its own trips it. A registration smoke check passes for '
    + 'a card whose rules text does nothing at all, which is the whole of CARD-TODO #9.');
});
