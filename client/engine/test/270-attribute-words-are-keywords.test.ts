/* CT-132 — THE SAME WORD WAS A KEYWORD ON ONE CARD AND GREY PROSE ON ANOTHER.
 *
 * `ui/cardtext.ts` turns `{g}word` into a coloured keyword span. Twelve cards
 * name an attribute they do not carry on their TYPE LINE — they grant it,
 * usually until regroup — and eight of them tagged it while four did not. So
 * Rotspore Herald's "[Augment] Everything is {g}deadly." was coloured and
 * Brough's "[Augment] Everything is balanced." — the same sentence — was not,
 * which reads as though the two words mean different kinds of thing.
 *
 * Fixed in the oracle file, because that is where the defect is: `{g}` is a marker in the printed text, and the whole
 * point of it is that the renderer does not need to know which words are
 * keywords. A special case in `cardtext.ts` for these four would have been the
 * same bug wearing a fix.
 *
 * ⚠ THE SUBJECT SET IS DERIVED FROM printed.json AT RUN TIME. Nothing here
 * types the four card names into an assertion that could pass without them:
 * §1 computes every card whose RULES text names an `Attr` it does not carry on
 * its type line, and §2 asserts the marker is on all of them. The thirteenth
 * card is covered the day it is written, and a card that stops granting an
 * attribute leaves the guard on its own. A guard written for four names would
 * go stale the first time somebody adds a fifth — which is exactly how this
 * inconsistency got to twelve cards without anybody noticing.
 *
 * ⚠ REMINDER TEXT IS DELIBERATELY EXCLUDED, and getting that wrong is how the
 * first derivation of this list came out at sixteen instead of four. The
 * bare "flying" inside Nimbus Eel's "{i}(Only flying units can block flying
 * units.)" is PROSE ABOUT the keyword, not a use of it, and it is untagged on
 * all eight cards that do tag the rules occurrence. So the scan blanks every
 * `{i}(…)` span before looking. §3 pins that as its own property, because it
 * is the half of the rule a future edit is most likely to get backwards.
 *
 * Seeds: none — this is a pure data scan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import PRINTED from '../src/cards/printed.json' with { type: 'json' };
import type { Attr } from '../src/types.ts';

/** Every `Attr` in the union, as the type line spells them. Restated here as a
 *  typed literal so a new attribute added to `types.ts` and NOT added here is
 *  a compile error rather than a silently narrower scan — see the assertion
 *  under §0, which is what actually enforces it. */
const ATTRS: readonly Attr[] = [
  'Flying', 'Deadly', 'Swift', 'Sluggish', 'Tough', 'Balanced',
  'Inverted', 'Unaware', 'Powerful', 'Vulnerable', 'Feeble', 'Evasive',
  'Sneaky', 'Alluring', 'Piercing', 'Electric', 'Poisonous', 'Resonant',
  'Thieving', 'Reaping',
  'Blessed', 'Afflicting', 'Lethal', 'Pure', 'Modular',
];

interface Row {
  name: string; type: string; text: string;
  attrs?: string[]; augmentAttrs?: string[];
}
const POOL = Object.values(PRINTED as unknown as Record<string, Row>);

/**
 * The card's text with every `{i}(…)` reminder blanked out (same length, so
 * indices still line up with the original). Reminder text explains a keyword
 * rather than using it, and is bare on every card in the pool.
 */
const rulesTextOf = (text: string): string =>
  text.replace(/\{i\}\([^)]*\)/g, m => ' '.repeat(m.length));

/** Attributes this card carries on its type line (so naming one in its text is
 *  a reference to its own printed marker, not a grant). */
const carried = (c: Row): Set<string> =>
  new Set([...(c.attrs ?? []), ...(c.augmentAttrs ?? [])].map(a => a.toLowerCase()));

interface Hit { card: string; attr: Attr; tagged: boolean; ctx: string }

/** Every occurrence, in RULES text, of an attribute the card does not carry. */
function scan(): Hit[] {
  const out: Hit[] = [];
  for (const c of POOL) {
    const rules = rulesTextOf(c.text ?? '');
    const has = carried(c);
    for (const attr of ATTRS) {
      if (has.has(attr.toLowerCase())) continue;
      const re = new RegExp(`(\\{g\\})?\\b(${attr})\\b`, 'gi');
      let m: RegExpExecArray | null;
      while ((m = re.exec(rules)) !== null) {
        out.push({
          card: c.name, attr, tagged: !!m[1],
          ctx: rules.slice(Math.max(0, m.index - 30), m.index + m[0].length + 4).trim(),
        });
      }
    }
  }
  return out;
}

const HITS = scan();
const label = (h: Hit): string => `${h.card} — "${h.attr}" in «${h.ctx}»`;

// ── §0: the scan is not vacuous, and it covers the whole Attr union ──────

test('CT-132 §0 the ATTRS list this scan uses is the whole Attr union', () => {
  // The failure mode this exists for: somebody adds an attribute to types.ts,
  // a card grants it in prose without the marker, and the scan below never
  // looks for it — so the guard passes while the bug it guards against is on
  // a card. A missing entry cannot be a type error (the array is only
  // *assignable* to Attr[]), so it is asserted against the type-line data.
  const onTypeLines = new Set<string>();
  for (const c of POOL) for (const a of carried(c)) onTypeLines.add(a.toLowerCase());
  const known = new Set(ATTRS.map(a => a.toLowerCase()));
  const missing = [...onTypeLines].filter(a => !known.has(a)).sort();
  assert.deepEqual(missing, [],
    'attributes appear on type lines in printed.json that this file\'s ATTRS list does not '
    + 'name, so the scan below is blind to them. Add them (they are the Attr union in '
    + `src/types.ts): ${missing.join(', ')}`);
});

test('CT-132 §0 the scan finds real occurrences — it is not passing on an empty set', () => {
  // Every assertion below is "…and all of them are tagged", which an empty
  // list satisfies forever. This is the non-vacuity statement.
  assert.ok(HITS.length >= 8,
    `the scan found ${HITS.length} attribute words in rules text; it found 12 when CT-132 was `
    + 'written, and a sudden collapse means the scan broke, not that the pool changed');
  const cards = new Set(HITS.map(h => h.card));
  assert.ok(cards.size >= 8, `across ${cards.size} distinct cards`);
});

// ── §1: THE RULE ────────────────────────────────────────────────────────

test('CT-132 §1 every attribute a card GRANTS in its rules text is marked with {g}', () => {
  // THE WHOLE TICKET, in one derived assertion. Not "these four are fixed" —
  // "no card in the pool names an attribute it does not carry without marking
  // it", which is a property the pool either has or does not, forever.
  const bare = HITS.filter(h => !h.tagged).map(label).sort();
  assert.deepEqual(bare, [],
    'these cards name an attribute they do not carry on their type line, WITHOUT the {g} '
    + 'keyword marker — so it renders as grey prose while the same word on another card '
    + 'renders as a coloured keyword.\n\n'
    + 'Add the {g} marker in data/cards/AlgomancyCards-OracleText.json and re-run '
    + '`npm run extract`. Do NOT special-case the card in a renderer.\n\n  '
    + bare.join('\n  '));
});

test('CT-132 §1 the four cards the ticket named are in the scan\'s subject set', () => {
  // The one place names are allowed: proving the DERIVED set actually reaches
  // the reported cards. If a future refactor narrowed the scan so that Brough
  // fell out of it, §1 above would go green for the wrong reason.
  const cards = new Set(HITS.map(h => h.card));
  for (const name of ['Brough', 'Blob of the Dark Order', 'Inexorable Miasma',
    'Unrelenting Horror']) {
    assert.ok(cards.has(name),
      `${name} is no longer reached by the scan — §1 would pass without checking it`);
  }
});

// ── §2: the control — the eight that were always right ──────────────────

test('CT-132 §2 the cards that already marked it are untouched, marker and all', () => {
  // The eight tagged cards are the evidence that {g} is the pool's own
  // convention rather than something this ticket invented, and they must stay
  // tagged: a "fix" that stripped every marker would satisfy nothing above
  // except by making the two halves consistently wrong.
  const tagged = HITS.filter(h => h.tagged);
  assert.ok(tagged.length >= 8,
    `only ${tagged.length} tagged occurrences remain; there were 8 before CT-132 and 12 after, `
    + 'so a drop means markers were removed rather than added');
  for (const name of ['Rotspore Herald', 'Emberflame Enlightener', 'Envoy of Lightning']) {
    assert.ok(tagged.some(h => h.card === name),
      `${name} lost its {g} marker — it is one of the eight that were always right`);
  }
});

test('CT-132 §2 Brough and Rotspore Herald now read the same way', () => {
  // The pair that made the inconsistency visible: the SAME SENTENCE, one
  // coloured and one not. Stated as a symmetry rather than as two literals, so
  // it cannot be satisfied by a change to only one of them.
  const box = (n: string): string => POOL.find(c => c.name === n)!.text;
  const brough = box('Brough'), rot = box('Rotspore Herald');
  assert.match(brough, /Everything is \{g\}balanced\./);
  assert.match(rot, /Everything is \{g\}deadly\./);
  assert.equal(
    brough.replace(/\{g\}balanced/, 'X').slice(0, 24),
    rot.replace(/\{g\}deadly/, 'X').slice(0, 24),
    'the two sentences no longer have the same shape, so this pair has stopped being the '
    + 'comparison that made CT-132 visible');
});

// ── §3: reminder text stays prose ───────────────────────────────────────

test('CT-132 §3 the word inside a {i}(…) reminder is NOT marked — it is prose about the keyword', () => {
  // The half of the rule most likely to be got backwards by a well-meaning
  // "tag every attribute word" edit. Nimbus Eel's reminder explains what
  // flying does; colouring the word there would make the reminder look like a
  // second grant. Derived: every reminder in the pool, not a named list.
  const offenders: string[] = [];
  for (const c of POOL) {
    for (const rem of (c.text ?? '').match(/\{i\}\([^)]*\)/g) ?? []) {
      if (/\{g\}/.test(rem)) offenders.push(`${c.name}: ${rem}`);
    }
  }
  assert.deepEqual(offenders, [],
    `reminder text carries a {g} marker. Reminder text is prose ABOUT a keyword, not a use of `
    + `it, and it is bare on every card that marks the rules occurrence:\n  ${offenders.join('\n  ')}`);
  // …and non-vacuous: there really are reminders naming attributes
  const reminders = POOL.flatMap(c => (c.text ?? '').match(/\{i\}\([^)]*\)/g) ?? []);
  assert.ok(reminders.some(r => ATTRS.some(a => new RegExp(`\\b${a}\\b`, 'i').test(r))),
    'no reminder in the pool names an attribute, so the assertion above checked nothing');
});
