/**
 * EVERY ELEMENT A CARD NAMES IS ONE OF ITS OWN — the whole-pool guard.
 *
 * Owner, 2026-09-20, on being shown that Reap the Due did nothing:
 *
 *     "We should check that all cards that reference elements in their oracle
 *      text at least match their actual 'card identity'. No cards use colors
 *      in their oracle text that isn't part of their casting affinity. So Reap
 *      the Due would have been caught and fixed."
 *
 * ── WHAT IT COST TO NOT HAVE THIS ────────────────────────────────────
 *
 * `AlgomancyCards-OracleText.json` transcribes Reap the Due — a MONO-LIGHT
 * card, cost `l`, faction light — as "…gains debt equal to twice your [d]".
 * The scan shows the same gold light pip in the text box as in the cost. The
 * engine implemented the transcription faithfully (`affinity(controller,
 * 'dark')`), so cast from a light deck the amount was `2 × 0`: the payment was
 * free, the dialogue never opened, and the card did nothing whatever — no
 * debt, and no erase either. It reached players and came back as a Discord
 * report ("reap the due did not assign debt").
 *
 * It was the ONLY violation in the pool, which is exactly why a sweep finds it
 * instantly and reading cards one at a time never did. Every other
 * affinity-scaling card names its own element — Exhume [d]/dark,
 * All-Consuming Blaze [r]/fire, Premonition [b]/water, Accumulated Nucleation
 * [e]/earth, Self-Assembly [m]/metal, Sylvan Sprouting [g]/wood — and before
 * the correction `[l]` appeared on NO card at all. Light was the one element
 * with no affinity card, because its only one had been mistyped as dark. That
 * absence was visible in a one-line census for months.
 *
 * ── WHY §2 IS HERE, AND NOT DECORATION ───────────────────────────────
 *
 * §1 can only see elements written as PIPS. If a card said "twice your dark
 * affinity" in prose, §1 would pass it blind and the guard would be a guard
 * with a hole in it. §2 closes that: it proves the pool never names an element
 * in words, so the pip scan is COMPLETE rather than partial. It currently
 * matches nothing, and that is the point — the day it starts matching, §1 has
 * stopped being sufficient and both need rewriting together.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
// side-effecting, and load-bearing for a POOL SWEEP: registry.ts registers two
// synthetics and apply.ts the third, so a registry-only import is shown 494 of
// 495 cards. A sweep that silently misses one card is the thing this file is
// against. R209; `147-comment-conformance` §3 checks it for every sweeping file.
import '../src/apply.ts';
import { allCardNames, getCard, ELEMENT_OF_PIP } from '../src/cards/dsl.ts';

/** the whole pool, and it must BE the whole pool */
const POOL_FLOOR = 495;

/** letters that are elements; `[x]`, `[one]`, `[two]`, `[zero]` and `[once]`
 * are generic mana and markers, and are none of this test's business */
const PIP_LETTERS = Object.keys(ELEMENT_OF_PIP);
const ELEMENTS = [...new Set(Object.values(ELEMENT_OF_PIP))];

/** A card's CASTING IDENTITY: the elements in its cost, plus the factions the
 * extractor derived. Deliberately the union — a hybrid's cost carries both
 * letters, and a card whose faction is broader than its pips should not be
 * failed for naming its own faction. */
function identityOf(name: string): Set<string> {
  const c = getCard(name);
  const out = new Set<string>(c.factions ?? []);
  for (const ch of c.cost ?? '') {
    const el = ELEMENT_OF_PIP[ch];
    if (el) out.add(el);
  }
  return out;
}

const pipsIn = (text: string): string[] =>
  [...text.matchAll(/\[([a-zA-Z]+)\]/g)]
    .map(m => m[1]!)
    .filter(p => PIP_LETTERS.includes(p));

test('§1 every element pip in a card\'s text is an element of that card', () => {
  const violations: string[] = [];
  let checked = 0, cards = 0;
  for (const name of allCardNames()) {
    const text = getCard(name).text ?? '';
    const pips = [...new Set(pipsIn(text))];
    if (!pips.length) continue;
    cards++;
    const identity = identityOf(name);
    for (const pip of pips) {
      checked++;
      const el = ELEMENT_OF_PIP[pip]!;
      if (identity.has(el)) continue;
      violations.push(
        `  ${name}: text names [${pip}] (${el}), but its identity is `
        + `{${[...identity].sort().join(', ')}} — cost "${getCard(name).cost ?? ''}"\n`
        + `    ${text}`);
    }
  }
  console.log(`    ${checked} element pip(s) across ${cards} of ${allCardNames().length} card(s), all inside their own identity`);
  assert.ok(allCardNames().length >= POOL_FLOOR,
    `the sweep saw ${allCardNames().length} cards, not the full ${POOL_FLOOR} — it is `
    + 'reading a partial registry and a violation could hide in the part it cannot see');
  assert.equal(violations.length, 0,
    'a card names an element it cannot cast — which is a TRANSCRIPTION error until the '
    + 'owner rules otherwise, and the correction belongs in printed-overrides.mjs, never '
    + 'in the oracle file:\n' + violations.join('\n'));
  assert.ok(checked > 0, 'the scan found no pips at all — it has stopped reading the pool');
});

test('§2 elements are named with PIPS ONLY, so §1 has nothing to miss', () => {
  const prose: string[] = [];
  for (const name of allCardNames()) {
    const text = getCard(name).text ?? '';
    for (const el of ELEMENTS) {
      if (new RegExp(`\\b${el}\\b`, 'i').test(text)) prose.push(`  ${name}: "${el}" — ${text.slice(0, 90)}`);
    }
  }
  assert.equal(prose.length, 0,
    'a card names an element in WORDS. §1 only reads pips, so it can no longer promise '
    + 'that every element a card names is its own — teach §1 to read prose, or rule that '
    + 'this card is an exception:\n' + prose.join('\n'));
});
