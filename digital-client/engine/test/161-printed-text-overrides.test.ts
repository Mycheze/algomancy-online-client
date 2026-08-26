/**
 * R190 — the reminder text a player actually READS about Glimpse, and the one
 * declared list of known-wrong upstream printed data.
 *
 * Playtest report #106 (GYSR, action 154): *"The reminder text for Glimpsing is
 * wrong — it does not mention that the other cards not chosen are recycled."*
 *
 * ⚠ THE TRIAGE OF THAT REPORT WAS WRONG, AND THIS FILE IS WHERE THAT IS PINNED
 * DOWN. Both the ledger note and CARD-TODO #73 recorded it as an upstream data
 * error — "Oracle of Foretelling reads … and stops" — and routed it to
 * `AlgomancyCards-OracleText.json`, out of this repo's reach. It is not. The
 * four cards that Glimpse more than one card print "Recycle the rest." in the
 * oracle file, in the generated `printed.json`, and on the card face; §1 below
 * asserts that per card so the claim cannot be made again without failing.
 *
 * What the player was reading is `ui/glossary.ts`'s **Glimpse** entry, which
 * the card inspector prints under every card whose text mentions Glimpse
 * ("all referenced keywords should have their reminder text right there to
 * see", Bena 2026-08-20). That entry still described R45 as it read BEFORE the
 * 2026-08-19 correction — "cache them", all N, no recycle — so the panel
 * contradicted itself: the printed box said "cache one … Recycle the rest" and
 * the reminder directly beneath it said the opposite. §2 pins the entry to what
 * `E.glimpse` does.
 *
 * §3 is the part that generalises. There ARE real upstream errors (three type
 * lines), and they live in `scripts/printed-overrides.mjs` as a single declared
 * table so the list is a readable artifact rather than folklore. The property
 * that matters is that an override which STOPS being needed fails loudly: this
 * repo has repeatedly been bitten by exemption lists that outlived their cause,
 * and a silent no-op the day Caleb corrects his file is exactly that failure
 * mode. §3 checks every entry against the live oracle file, and §4 provokes the
 * stale case to prove the check can fire.
 *
 * Seeds: none — this file is pure data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getCard } from '../src/cards/dsl.ts';
// side-effecting: importing the registry is what REGISTERS the pool, so
// getCard resolves. Without it every card here is "Unknown card".
import '../src/cards/registry.ts';
import { GLOSSARY, glossaryHits } from '../ui/glossary.ts';
// @ts-expect-error — a .mjs build script, deliberately not part of the TS graph
import { PRINTED_OVERRIDES, StaleOverrideError, applyOverride } from '../scripts/printed-overrides.mjs';

interface Override {
  card: string;
  field: 'type' | 'text';
  from: string;
  to: string;
  since: string;
  by: string;
  why: string;
}
const OVERRIDES = PRINTED_OVERRIDES as Override[];

const HERE = dirname(fileURLToPath(import.meta.url));
const ORACLE = JSON.parse(readFileSync(
  join(HERE, '..', '..', '..', 'AlgomancyCards', 'AlgomancyCards-OracleText.json'), 'utf8'),
) as Record<string, Array<{ type?: string; text?: string }>>;

/** the extractor's own `normalisePrinted`, which runs BEFORE an override does,
 * so the `from` values are recorded in normalised form and must be compared
 * that way (scripts/extract-printed.mjs, R142) */
const normalisePrinted = (s: string): string =>
  s.replace(/([A-Za-z])-[ \t]+([a-z])/g, '$1$2').replace(/[ \t]+/g, ' ').trim();

/* ── §1 · the printed reminders — per card, all five ───────────────────── */

/**
 * The five cards CARD-TODO #73 names. Four of them Glimpse more than one card
 * and print the recycle clause; Foretell Glimpses exactly ONE, where there is
 * no "rest" to recycle and the reminder correctly does not claim there is.
 * That asymmetry is R45's own reading — "the N=1 cards read 'reveal the top
 * card and cache it' only because the two readings coincide there" — so it is
 * asserted rather than papered over.
 */
const GLIMPSE_CARDS: { name: string; recycles: boolean }[] = [
  { name: 'Oracle of Foretelling', recycles: true },
  { name: 'Premonition', recycles: true },
  { name: 'Celestial Purge', recycles: true },
  { name: 'Dematerialize', recycles: true },
  { name: 'Foretell', recycles: false },
];

for (const { name, recycles } of GLIMPSE_CARDS) {
  test(`§1 ${name}'s printed reminder ${recycles ? 'names the recycle' : 'glimpses one, so there is no rest to recycle'}`, () => {
    const printed = getCard(name).text ?? '';
    assert.match(printed, /Glimpse/i, `${name} should print a Glimpse reminder at all`);
    if (recycles) {
      assert.match(printed, /cache one/i,
        `${name} should print "cache one" — R45 as corrected 2026-08-19`);
      assert.match(printed, /Recycle the rest/i,
        `${name}'s printed text is where report #106 said the omission was. It is NOT there:\n`
        + `  ${printed}\n`
        + 'If this ever fails, the oracle file really has lost the clause and the fix is a '
        + 'text entry in scripts/printed-overrides.mjs plus a message to Caleb.');
    } else {
      assert.doesNotMatch(printed, /Recycle the rest/i,
        'Foretell is Glimpse 1: one card is revealed and cached, so nothing is left over');
      assert.match(printed, /cache it/i, 'the N=1 reading, R45');
    }
  });
}

test('§1 the four N>1 reminders say cache-ONE-and-recycle, matching E.glimpse', () => {
  // one assertion over the group, so a single card quietly drifting out of the
  // family is visible next to the other three rather than only in its own test
  const said = GLIMPSE_CARDS.filter(c => c.recycles).map(c => {
    const t = getCard(c.name).text ?? '';
    return `${c.name}: cacheOne=${/cache one/i.test(t)} recycle=${/Recycle the rest/i.test(t)}`;
  });
  assert.deepEqual(said, [
    'Oracle of Foretelling: cacheOne=true recycle=true',
    'Premonition: cacheOne=true recycle=true',
    'Celestial Purge: cacheOne=true recycle=true',
    'Dematerialize: cacheOne=true recycle=true',
  ]);
});

/* ── §2 · the reminder the inspector actually prints ───────────────────── */

const glimpseEntry = (): { term: string; text: string } => {
  const e = GLOSSARY.find(g => g.term === 'Glimpse');
  assert.ok(e, 'the glossary has lost its Glimpse entry');
  return e;
};

test('§2 the Glimpse glossary reminder names the recycle and the bottom of the deck', () => {
  const { text } = glimpseEntry();
  assert.match(text, /recycled to the bottom of your deck/i,
    'report #106: "it does not mention that the other cards not chosen are recycled". '
    + 'E.glimpse calls recycleToBottom on every revealed card but the one kept, so the '
    + 'reminder has to say both that they are recycled and where they go.');
  assert.match(text, /\bONE\b/,
    'R45 as corrected 2026-08-19 caches exactly one, not all N');
  assert.doesNotMatch(text, /cache them/i,
    'the pre-correction wording ("cache them", all N) is what shipped in report #106');
});

test('§2 the Glimpse reminder keeps the three limits R45 puts on the cached card', () => {
  const { text } = glimpseEntry();
  assert.match(text, /ignoring affinity/i, 'Caleb 2024-10-28');
  assert.match(text, /paying its mana/i, 'Caleb 2023-08-13');
  assert.match(text, /timing/i, 'Caleb 2025-12-28 — printed timing still applies');
});

test('§2 the Recycle reminder no longer denies what the Glimpse one now says', () => {
  // the two rows print TOGETHER on the four N>1 cards, because those cards'
  // text says both words. The Recycle entry used to read "the card is gone for
  // the rest of the game", which is the one thing recycling never does:
  // apply.ts's doRecycle calls e.recycleToBottom(seat, card) before it pushes
  // the dormant resource, and the Rulebook glosses the word inline as "putting
  // it on the bottom of the deck".
  const e = GLOSSARY.find(g => g.term === 'Recycle');
  assert.ok(e, 'the glossary has lost its Recycle entry');
  assert.match(e.text, /bottom of/i, 'recycling puts the card on the bottom of the deck');
  assert.doesNotMatch(e.text, /gone for the rest of the game/i);
});

for (const { name } of GLIMPSE_CARDS) {
  test(`§2 ${name}'s inspector panel offers the corrected Glimpse reminder`, () => {
    // exactly what ui/main.ts asks for: the type line and the printed text,
    // minus the card's own attributes
    const c = getCard(name);
    const hits = glossaryHits([c.type, c.text], { skip: c.attrs });
    const glimpse = hits.find(h => h.term === 'Glimpse');
    assert.ok(glimpse, `${name} says Glimpse, so the panel must explain Glimpse`);
    assert.match(glimpse.text, /recycled to the bottom of your deck/i);
    // and the row that sits beside it on the N>1 cards must agree
    const recycle = hits.find(h => h.term === 'Recycle');
    if (recycle) assert.doesNotMatch(recycle.text, /gone for the rest of the game/i);
  });
}

/* ── §3 · the declared upstream-error table ────────────────────────────── */

test('§3 every override entry is fully declared: card, field, from, to, since, by, why', () => {
  assert.ok(OVERRIDES.length > 0, 'the table has gone empty — if that is real, delete this file');
  for (const o of OVERRIDES) {
    for (const k of ['card', 'field', 'from', 'to', 'since', 'by', 'why'] as const) {
      assert.equal(typeof o[k], 'string', `${o.card}: ${k} must be a string`);
      assert.ok(o[k].length > 0, `${o.card}: ${k} is empty`);
    }
    assert.ok(o.field === 'type' || o.field === 'text', `${o.card}: unknown field ${o.field}`);
    assert.notEqual(o.from, o.to, `${o.card}: an override that changes nothing is not an override`);
    assert.match(o.since, /^\d{4}-\d{2}-\d{2}$/, `${o.card}: since must be a date`);
    assert.ok(o.why.length > 60,
      `${o.card}: "why" is the whole value of this table — one line of argument, not a label`);
  }
});

for (const o of OVERRIDES) {
  test(`§3 the upstream value for ${o.card} (${o.field}) still matches what the override records`, () => {
    const entry = ORACLE[o.card]?.[0];
    assert.ok(entry, `${o.card} is not in AlgomancyCards-OracleText.json at all`);
    const upstream = normalisePrinted(String(entry[o.field] ?? ''));
    assert.equal(upstream, o.from,
      `The override for ${o.card} (${o.field}) is STALE.\n`
      + `  it records upstream as: ${JSON.stringify(o.from)}\n`
      + `  the oracle file now has: ${JSON.stringify(upstream)}\n`
      + 'If Caleb has corrected the source, DELETE the entry from '
      + 'scripts/printed-overrides.mjs — do not update `from` to make this pass. '
      + 'An exemption that outlives its cause is the defect this assertion exists to stop.');
    // and the override is still doing something: the corrected value is not
    // what upstream already says
    assert.notEqual(upstream, o.to, `${o.card} (${o.field}) upstream already reads the corrected value`);
  });
}

test('§3 the corrected value is what printed.json actually carries', () => {
  for (const o of OVERRIDES) {
    const got = o.field === 'type' ? getCard(o.card).type : getCard(o.card).text;
    assert.equal(got, o.to,
      `${o.card} (${o.field}) should be the override's corrected value in printed.json — `
      + 'run `npm run extract` in engine/');
  }
});

/* ── §4 · the check can fire ───────────────────────────────────────────── */

test('§4 an override whose upstream has been fixed FAILS instead of applying', () => {
  const o = OVERRIDES[0]!;
  // the ordinary case: upstream still wrong, the correction is applied
  assert.equal(applyOverride(o.card, o.field, o.from), o.to);
  // Caleb fixes it at source: the upstream value arrives already corrected.
  // A table that silently returned it unchanged would leave a stale entry here
  // forever, which is exactly how this repo has been bitten before.
  assert.throws(() => applyOverride(o.card, o.field, o.to), StaleOverrideError,
    `applyOverride must reject a corrected upstream value for ${o.card}`);
  // any other drift fails too, not just the corrected form
  assert.throws(() => applyOverride(o.card, o.field, `${o.from} (retypeset)`), StaleOverrideError);
  // and the message has to name the card, or the build failure is unreadable
  try {
    applyOverride(o.card, o.field, o.to);
    assert.fail('unreachable');
  } catch (err) {
    assert.match(String((err as Error).message), new RegExp(o.card));
  }
});

test('§4 a card with no override is passed through untouched', () => {
  const untouched = 'Glimpse 5 {i}(Reveal the top five cards of the deck…)';
  assert.equal(applyOverride('Oracle of Foretelling', 'text', untouched), untouched,
    'no Glimpse card needs an override: the printed data is right (§1)');
  assert.equal(applyOverride('Arbiter of Armistice', 'text', untouched), untouched,
    'the Arbiter override is on its TYPE line only — its text must pass through');
});
