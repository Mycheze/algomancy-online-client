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
import { allCardNames, getCard } from '../src/cards/dsl.ts';

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

// ── CARD-TODO #21: bounded+zone has a real budget holder now (R124) ──────
//
// R51 dispatches a zone trigger through `E.standIn`, a detached entity with a
// THROWAWAY `budgets: {}` — so this census used to assert that NO ability was
// both `bounded` and zone-dispatched: a [once] written onto the ghost bounded
// nothing, and the honest fix while zero cards needed the combination was to
// keep it out of the pool.
//
// R124 answered the design question the old census was holding open ("what is
// a per-card budget (R9) for a card that is not in play?"): PER SEAT PER CARD
// NAME, in `GameState.zoneBudgets` — real, serialized state, written by
// composeParts' stand-in branch, refunded by refundPart's (R113), cleared by
// startTurn beside the Entity.budgets wipe. A bin holds bare names, not
// instances, so the name in that seat's zone IS the card as far as the rules
// can see — the same reading R51 already used to give three copies one firing.
//
// WHY THE CHANGED PREMISE IS STILL HONEST: the old test's claim was "the
// ghost budget is a silent lie, so the shape is banned". The ghost budget is
// gone — a bounded zone firing reserves in real state, and the BEHAVIOUR is
// pinned by the Rotling tests in 43-dark-c (bounds once per turn, R113
// refund on decline, survives a JSON round-trip, wiped by startTurn). What
// this census still holds is the POPULATION: per-seat-per-name is a design
// decision with a written rationale (R124), not a universal truth about every
// printed text — so a new bounded+zone ability must arrive HERE, be checked
// against that rationale, and be added deliberately rather than slipping in
// because the combination stopped failing.
test('no ability is both bounded and zone-dispatched without a real budget holder — the population is enumerated (CARD-TODO #21/R124)', () => {
  const found: string[] = [];
  for (const name of allCardNames()) {
    const def = getCard(name);
    for (const ab of [...(def.abilities ?? []), ...(def.augmentText ?? [])]) {
      const a = ab as { bounded?: boolean; zone?: string };
      if (a.bounded && a.zone) found.push(`${name} (zone '${a.zone}')`);
    }
  }
  assert.deepEqual(found.sort(), ["Rotling (zone 'bin')"],
    'a bounded ability dispatched from a zone keeps its [once] in GameState.zoneBudgets, '
    + 'per (seat, card name), per turn — R124 / CARD-TODO #21. That is a design decision '
    + "with a rationale, not a default: check the new card's printed text against it "
    + '(is per-seat-per-name what IT means?), then add it to this list on purpose.');
});
