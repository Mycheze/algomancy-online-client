/* R281 / CT-171 — WHAT EACH GLOSSARY ROW RESTS ON, and the leg that was missing.
 *
 * ── THE DEFECT THIS FILE EXISTS FOR ───────────────────────────────────
 *
 * `ui/glossary.ts` holds one plain-English reminder per keyword and the card
 * inspector prints it. For a keyword the pool never prints a reminder for,
 * R206 says it in its own words: the row is "the only statement of the rule
 * this repository has."
 *
 * R206 then states its own method in one line: **"All 43 rows were read against
 * the engine."** For a row whose keyword prints a reminder that is safe — R206
 * rule 1 is "printed text wins". For a row with no printed reminder the
 * reference was THE IMPLEMENTATION, so where the engine was wrong the row was
 * corrected INTO agreement with the bug.
 *
 * That is not hypothetical. The {Prophecy} row's last sentence was rewritten to
 * match `engine.ts::cachedTiming`, and `cachedTiming` was the defect that lost
 * the owner a game on 2026-08-30 (R277: it gated a fulfilled prophecy to its
 * [Haste] marker instead of the printed timing, contradicting R42 while citing
 * R42 as its authority). The rules document and the engine agreed, both were
 * wrong, and the agreement is what made it look settled.
 *
 * ⚠ AND THE MECHANISM IS LIVE, NOT HISTORICAL. `177-glossary-conformance`
 * carries six tests shaped "the engine does X, so the row must say X" — each
 * regexes the ENGINE SOURCE and the ROW and requires them to agree. They are
 * useful DRIFT detectors and they stay. What they are not is evidence about the
 * rules: engine↔row agreement is coherence, and their failure messages say
 * "re-read R<n>" while nothing checks the ruling at all.
 *
 * ── WHAT THIS FILE ADDS: THE THIRD LEG ────────────────────────────────
 *
 * §1 derives what every row RESTS on, from data, and pins the set that rests on
 *    nothing but this repo's own rulings — the population where the laundering
 *    above is possible at all.
 * §2 is the missing leg. Every ruling a rulings-only row cites must NAME that
 *    row's term. A citation that never mentions the keyword is doing no work,
 *    and that is exactly how the failure looks from outside: {Once} cited R9,
 *    which is three lines about control change and says nothing about once per
 *    turn; {Unaware} cited R19, which is about application ORDER and flags its
 *    own content as "⚠ Engine call … the engine's reading". Both were found by
 *    this check and removed.
 *
 * It is a weak check on purpose. It cannot read a sentence and tell you the
 * ruling means it — nothing here can. What it CAN do is refuse a citation that
 * was attached to make a row look sourced, which is the shape R42 had on
 * `cachedTiming` and the shape R9 had on {Once}.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUTHORED_GLOSSARY, PRINTED_REMINDERS, MANUAL_REMINDERS, LIBRARY_REMINDERS,
} from '../../ui/glossary.ts';

const DOC = readFileSync(new URL('../../docs/digital-rules.md', import.meta.url), 'utf8');

/** every `## R<n>` section body, keyed by number */
function sections(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^## (R\d+)\b[^\n]*\n/gm;
  let m: RegExpExecArray | null, last: string | null = null, from = 0;
  while ((m = re.exec(DOC))) {
    if (last) out.set(last, DOC.slice(from, m.index));
    last = m[1]!; from = re.lastIndex;
  }
  if (last) out.set(last, DOC.slice(from));
  return out;
}

const nonEmpty = (v: unknown): boolean =>
  v == null ? false : Array.isArray(v) ? v.length > 0 : true;

const DOCUMENTS = ['Manual', 'Rulebook', 'CardLibrary', 'docs/08'] as const;

type Basis = 'printed' | 'document' | 'rulings-only';
function basisOf(term: string, cites: readonly string[]): Basis {
  if (nonEmpty(PRINTED_REMINDERS.get(term)) || cites.includes('printed')) return 'printed';
  if (nonEmpty(MANUAL_REMINDERS.get(term)) || nonEmpty(LIBRARY_REMINDERS.get(term))
    || cites.some(c => (DOCUMENTS as readonly string[]).includes(c))) return 'document';
  return 'rulings-only';
}

/**
 * The rows that rest on nothing but this repo's own rulings, DERIVED above and
 * pinned here by name. Not decoration: a row LEAVING this list means the game
 * itself started speaking for it, and a row JOINING it means a row that used to
 * have an outside witness has lost one and nobody noticed.
 *
 * Audited row by row against the cited rulings on 2026-08-30 (R281). What that
 * pass found, so the next reader knows what "audited" bought: {Prismite} told
 * players a prismite gives "1 affinity of every element at once", which is the
 * exact wild-affinity reading R17 exists to abolish — the client would have
 * refused a play this row said was legal. {Once} was cited to R9, which says
 * none of it. {Cache} was cited to R51, which supports no clause in it.
 * {Unaware} stated an unimplemented gap as a rule. {Debt} was clean.
 */
const RULINGS_ONLY = new Set([
  'Sneaky', 'Alluring', 'Vulnerable', 'Thieving', 'Reaping', 'Unaware',
  'Debt', 'Cache', 'Prophecy', 'Trash', 'Graft', 'Once', 'Prismite',
]);

test('R281 §0 POSITIVE CONTROL: the three channels and the register all loaded', () => {
  assert.ok(AUTHORED_GLOSSARY.length > 30, `only ${AUTHORED_GLOSSARY.length} rows`);
  assert.ok(PRINTED_REMINDERS.size > 10, `printed scrape found ${PRINTED_REMINDERS.size} terms`);
  assert.ok(MANUAL_REMINDERS.size > 0 && LIBRARY_REMINDERS.size > 0,
    'the manual and card-library channels are both live');
  const secs = sections();
  assert.ok(secs.size > 200, `the register parsed ${secs.size} sections`);
  assert.ok(secs.get('R42')?.includes('normal TIMING still applies'),
    'positive control: R42 is readable and still says what R277 rested on');
});

test('R281 §1 every row declares what it rests on, and the rulings-only set is the pinned one', () => {
  const found = new Set<string>();
  const tally: Record<Basis, number> = { printed: 0, document: 0, 'rulings-only': 0 };
  for (const r of AUTHORED_GLOSSARY) {
    const cites = r.ruling ?? [];
    assert.ok(cites.length, `${r.term}: no source at all — every row must say what it rests on`);
    const b = basisOf(r.term, cites);
    tally[b]++;
    if (b === 'rulings-only') found.add(r.term);
  }
  // non-vacuity FIRST: all three buckets must be populated, or the split proves nothing
  assert.ok(tally.printed > 0 && tally.document > 0 && tally['rulings-only'] > 0,
    `the basis split collapsed: ${JSON.stringify(tally)}`);
  assert.deepEqual([...found].sort(), [...RULINGS_ONLY].sort(),
    'the set of rows resting on nothing but this repo\'s own rulings has changed. A row that '
    + 'JOINED it lost an outside witness; a row that LEFT it gained one. Either way it needs '
    + 'auditing against the rulings it cites before the list is edited — see R281/CT-171.');
});

test('R281 §2 every ruling a rulings-only row cites NAMES that row term', () => {
  const secs = sections();
  const problems: string[] = [];
  let checked = 0;
  for (const r of AUTHORED_GLOSSARY) {
    if (!RULINGS_ONLY.has(r.term)) continue;
    const terms = [r.term, ...(r.alt ?? [])];
    for (const c of r.ruling ?? []) {
      if (!/^R\d+$/.test(c)) continue;
      const body = secs.get(c);
      if (!body) { problems.push(`${r.term}: cites ${c}, which has no section`); continue; }
      checked++;
      const named = terms.some(t =>
        new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(body));
      if (!named) {
        problems.push(`${r.term}: cites ${c}, and ${c} never names ${r.term} — a citation that `
          + 'does not mention the keyword is doing no work for this row');
      }
    }
  }
  // non-vacuity FIRST: the loop must really have read sections
  assert.ok(checked > 15, `only ${checked} citations were examined — the scan went blind`);
  assert.deepEqual(problems, []);
});
