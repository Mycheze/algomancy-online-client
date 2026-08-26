/* Playtest round 7 — the rules glossary and the scan behind the inspector's
 * "Referenced rules" section (ui/glossary.ts).
 *
 * Bena: "when viewing the rulings and/or information about a card, all
 * referenced keywords should have their reminder text right there to see."
 *
 * The scan is a regex sweep over the card's text, its mods and its rulings, so
 * the thing worth testing is precision: a keyword mentioned in any of its real
 * spellings must be found, and a keyword that is ALSO an ordinary English word
 * must not fire on the ordinary use. Riftwalker's "Switch my position with
 * another target ally" is the verb, not the graft marker, and a reminder about
 * grafting there would be actively misleading.
 *
 * Seeds: none — this file is pure data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import '../src/index.ts';   // R214: the WHOLE pool — registry.ts alone is 494 of 495
import {
  EXPANSION_GUIDE, GLOSSARY, KEYWORDS, MECHANICS, glossaryHits, matcherFor,
} from '../ui/glossary.ts';

const terms = (texts: string[], skip?: string[]): string[] =>
  glossaryHits(texts, skip ? { skip } : {}).map(e => e.term);

/* ── the table itself ──────────────────────────────────────────────────── */

test('the glossary is the three sections, with no duplicate headings', () => {
  assert.deepEqual(GLOSSARY, [...KEYWORDS, ...EXPANSION_GUIDE, ...MECHANICS]);
  const seen = new Set<string>();
  for (const e of GLOSSARY) {
    assert.ok(!seen.has(e.term), `duplicate glossary term ${e.term}`);
    seen.add(e.term);
    assert.ok(e.text.trim().length > 10, `${e.term} needs real reminder text`);
  }
});

test('every attribute printed on a real card has reminder text', () => {
  // the inspector falls back to "see the rules reference" for an attribute it
  // cannot explain — this is the guard that says a new attribute must arrive
  // with its reminder text
  const known = new Set(GLOSSARY.map(e => e.term));
  const missing = new Set<string>();
  for (const name of DECK_LIST) {
    let attrs: readonly string[];
    try { attrs = getCard(name).attrs; } catch { continue; }
    for (const a of attrs) if (!known.has(a)) missing.add(a);
  }
  assert.deepEqual([...missing], [], 'attributes with no glossary entry');
});

/* ── the keys, against the engine's own vocabulary ─────────────────────────
 *
 * A glossary entry can silently contradict the engine — which is exactly how
 * {Alluring} came to teach a rule (R76) that had been replaced (R84) and how
 * {Pure} went on saying "not implemented" for two days after R61 implemented
 * it. The KEYS can be checked cheaply, and are, in both directions below.
 *
 * The TEXT cannot be checked automatically: no machine can read "its column
 * can only be blocked by a column with Flying" and tell you whether the engine
 * agrees. The few sentences that a ruling has already caught out are pinned by
 * name at the bottom of this file; everything else is on the author.
 *
 * ⚠ THAT LAST PARAGRAPH IS NOW ONLY HALF TRUE (R206 / CT-76, 2026-08-26), and
 * it was quoted in the ticket as the statement of the gap. It cost FIFTEEN
 * wrong rows out of 43 — five of them on a list that said they had already
 * been checked — so `177-glossary-conformance.test.ts` takes two bites out of
 * "everything else is on the author":
 *   · every row now carries `ruling`, and its citations must RESOLVE to a
 *     `## R<n>` in digital-rules.md that is not withdrawn/superseded/narrowed;
 *   · for the 15 attributes that carry a PRINTED reminder, the row is compared
 *     against the card's own words, derived from printed.json.
 * What is still on the author is the prose of the rows that have neither —
 * 177 names that set (`Evasive`, `Resonant`) rather than leaving it implied. */

const TYPES = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');

/** the `Attr` union in src/types.ts, read as text — it is a TYPE, so there is
 * no runtime value of it to import */
function attrUnion(): string[] {
  const at = TYPES.indexOf('export type Attr =');
  assert.notEqual(at, -1, 'src/types.ts no longer declares `export type Attr`');
  const decl = TYPES.slice(at, TYPES.indexOf(';', at));
  const names = [...decl.matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]!);
  assert.ok(names.length > 20, `only parsed ${names.length} attributes — the parse is broken`);
  return names;
}

/** the KEYWORDS headings that are not attributes: printed markers with a flag
 * of their own on the card definition, plus the one pure rules concept */
const CARD_FLAGS: Record<string, 'burst' | 'virus' | 'ambush'> = {
  Burst: 'burst', Virus: 'virus', Ambush: 'ambush',
};
const RULES_CONCEPTS = ['Unstable'];   // R69: what having mods does to a card

test('every attribute the ENGINE knows has reminder text, printed or not', () => {
  // stronger than the pool sweep above: an attribute added to the union with
  // no card yet still reaches the inspector through a granted attrs list
  const known = new Set(GLOSSARY.map(e => e.term));
  assert.deepEqual(attrUnion().filter(a => !known.has(a)), [],
    'attributes in src/types.ts with no glossary entry');
});

test('every keyword heading is an attribute, a printed marker, or a named rule', () => {
  // the other direction: a heading nothing in the engine answers to is a
  // reminder for a rule the game does not have — a typo, or a rename that
  // only got done on one side.
  const attrs = new Set(attrUnion());
  for (const e of KEYWORDS) {
    const ok = attrs.has(e.term) || e.term in CARD_FLAGS || RULES_CONCEPTS.includes(e.term);
    assert.ok(ok, `KEYWORDS has "${e.term}", which is not an Attr or a known marker`);
  }
  // …and the markers are real: each is a flag some card sets. allCardNames,
  // not DECK_LIST — every {Burst} card in the game is a spell TOKEN, and
  // tokens are not deck cards.
  for (const [term, flag] of Object.entries(CARD_FLAGS)) {
    const printed = allCardNames().some(n => {
      try { return !!(getCard(n) as unknown as Record<string, unknown>)[flag]; } catch { return false; }
    });
    assert.ok(printed, `no card sets \`${flag}\` — is "${term}" still a thing?`);
  }
});

test('every glossary heading is a word the game actually says', () => {
  // the widest cheap check for the other two sections, which have no engine
  // enum to match against: the term (or one of its spellings) has to appear in
  // the printed corpus. Prismite is the one exception — a resource card, not a
  // deck card, so it is nowhere in DECK_LIST.
  const hay: string[] = [];
  for (const n of DECK_LIST) {
    try { const c = getCard(n); hay.push(n, c.type, c.text ?? ''); } catch { /* not a card */ }
  }
  const corpus = hay.join('\n');
  assert.ok(corpus.length > 10000, 'the pool actually loaded');
  const RESOURCES = ['Prismite'];
  for (const e of GLOSSARY) {
    if (RESOURCES.includes(e.term)) continue;
    assert.ok(matcherFor(e).test(corpus), `"${e.term}" matches nothing in the printed pool`);
  }
});

/* ── the sentences a ruling has already caught out ─────────────────────── */

const entry = (term: string) => {
  const e = GLOSSARY.find(g => g.term === term);
  assert.ok(e, `no glossary entry for ${term}`);
  return e!.text;
};

test('R84: Alluring TARGETS one enemy unit — it does not conscript every blocker', () => {
  // it taught R76's invented rule ("Defenders that are able to block it must
  // block it") for as long as R76 stood, and for a day after it was replaced
  const t = entry('Alluring');
  assert.match(t, /target/i, 'the whole attribute is that it targets');
  assert.match(t, /one enemy unit/i, 'and it is ONE enemy unit, not the defence');
  assert.match(t, /stack/i, 'from the stack — which is why it can be answered');
  assert.match(t, /block/i, 'the lured unit must block that column if able');
  assert.doesNotMatch(t, /defenders/i, 'the superseded wording is back');
});

test('R79: the Virus and Augment entries admit a spell on the stack is a host', () => {
  assert.match(entry('Virus'), /stack/i,
    'a virus may be augmented onto a spell on the stack (Caleb 2025-04-06)');
  assert.match(entry('Augment'), /stack/i, 'and the mechanic entry has to say so too');
  assert.match(entry('Augment'), /attributes only|only the attributes/i,
    'a spell takes the type-line attributes and nothing else (Caleb 2025-04-24)');
});

test('R81: Burst groups by NAME, not by "every burst token you control"', () => {
  assert.match(entry('Burst'), /same name/i);
});

test('R69/R79: Unstable is a BIN replacement, and a virused spell is Unstable', () => {
  const t = entry('Unstable');
  assert.match(t, /bin/i, 'it replaces the bin, not the death');
  assert.match(t, /spell/i, 'R79: a spell carrying a virus is a modded card too');
});

test('R61: Pure no longer claims to be unimplemented', () => {
  const t = entry('Pure');
  assert.match(t, /combat/i, 'R61 implemented it at the combat choke points');
  assert.doesNotMatch(t, /parked with the attribute-suppression layer/i,
    'that was the reason it was unimplemented, and it stopped being true at R61');
});

/* ── matching ──────────────────────────────────────────────────────────── */

test('a term is found in the spellings the cards and rulings use', () => {
  assert.deepEqual(terms(['This unit gains {Deadly} until regroup.']), ['Deadly']);
  assert.deepEqual(terms(['A card that is trashed does not resolve.']), ['Trash']);
  assert.deepEqual(terms(['It may be prophesied from your bin.']), ['Prophecy']);
  assert.deepEqual(terms(['Cached cards are public.']), ['Cache']);
});

test('word boundaries: a term never fires inside a longer word', () => {
  assert.deepEqual(terms(['Rotate the formation to protect your flyers.']), [],
    '"Rotate"/"protect" must not read as Rot');
  assert.deepEqual(terms(['Rot 2.']), ['Rot']);
});

test('[once] is the bounded marker; "once per turn" as prose is not', () => {
  assert.deepEqual(terms(['[Augment][once] [one]: do a thing.']), ['Augment', 'Once']);
  assert.deepEqual(terms(['You may do this once each turn.']), [],
    'plain English "once" must not claim to be the keyword');
});

test('graft matches its marker, not the English verb "switch"', () => {
  assert.deepEqual(terms(['[Switch1] Glimpse 1.']), ['Glimpse', 'Graft'],
    'the bracketed marker IS the keyword');
  assert.deepEqual(terms(['Switch my position with another target ally.']), [],
    'Riftwalker’s switch is the verb — a graft reminder here would mislead');
  assert.deepEqual(terms(['A grafted mod joins the cause.']), ['Graft']);
});

test('the battle MARKER counts, written either way; the word does not', () => {
  // the corpus writes it both ways — {Battle} on a type line, [Battle] in a
  // text box (Good Whale). Missing one half is how this shipped broken once.
  assert.deepEqual(terms(['{Battle} Cosmic Spell']), ['Battle']);
  // R142 collapsed the double space this used to copy verbatim from Good
  // Whale's printed text; the glossary never cared, but the literal should
  // still be what the card actually says.
  assert.deepEqual(terms(['[Battle] Ambush [4bb]']), ['Ambush', 'Battle']);
  assert.deepEqual(terms(['During the battle, units in that battle may block.']), [],
    'half the rulings corpus says "battle" — it cannot mean the marker every time');
});

test('real printed text: Good Whale explains both its markers', () => {
  const c = getCard('Good Whale');
  assert.deepEqual(glossaryHits([c.type, c.text], { skip: c.attrs }).map(e => e.term),
    ['Ambush', 'Battle'], 'the ⚔ on the card is a rule, and it gets a reminder');
});

/* ── what the inspector actually asks for ──────────────────────────────── */

test('the card’s own attributes are skipped — they have their own section', () => {
  const texts = ['{Flying} Unit', 'Target unit gains {Deadly} until regroup.'];
  assert.deepEqual(terms(texts), ['Flying', 'Deadly']);
  assert.deepEqual(terms(texts, ['Flying']), ['Deadly'],
    'Flying is already listed above as this unit’s attribute');
});

test('hits come back in glossary order, deduped across all the texts given', () => {
  // Augment (a MECHANIC) sorts after Deadly (a KEYWORD) whatever order the
  // texts arrive in, and naming a term twice yields one row
  const hits = terms(['[Augment] gains {Deadly}', 'and {Deadly} again', 'Rot 1']);
  assert.deepEqual(hits, ['Deadly', 'Rot', 'Augment']);
});

test('no text, no rows', () => {
  assert.deepEqual(terms([]), []);
  assert.deepEqual(glossaryHits([undefined, null, '']), []);
});

test('real cards: the scan explains what they mention and nothing else', () => {
  const scan = (name: string): string[] => {
    const c = getCard(name);
    return glossaryHits([c.type, c.text], { skip: c.attrs }).map(e => e.term);
  };
  assert.deepEqual(scan('Riftwalker'), ['Virus', 'Augment', 'Once'],
    'its "Switch my position" is the verb, so no Graft row');
  assert.deepEqual(scan('Foretell'), ['Cache', 'Glimpse', 'Graft', 'Battle']);
});

test('the scan stays quiet enough to read', () => {
  // a wall of reminder rows is as unreadable as none: check the whole pool
  let worst = 0, total = 0, n = 0;
  for (const name of DECK_LIST) {
    let c;
    try { c = getCard(name); } catch { continue; }
    const k = glossaryHits([c.type, c.text], { skip: c.attrs }).length;
    worst = Math.max(worst, k); total += k; n++;
  }
  assert.ok(n > 100, 'the pool actually loaded');
  assert.ok(worst <= 8, `no card should reference more than 8 rules (worst: ${worst})`);
  assert.ok(total / n < 3, `mean rows per card should stay small (got ${(total / n).toFixed(2)})`);
});

test('every entry compiles to a usable matcher', () => {
  for (const e of GLOSSARY) {
    const re = matcherFor(e);
    assert.ok(re instanceof RegExp, `${e.term} has no matcher`);
    assert.ok(re.flags.includes('i'), `${e.term}'s matcher must be case-insensitive`);
  }
});

// R214 — this file sweeps the whole pool, and `cards/registry.ts` registers
// only 494 of the 495 cards (`Alluring Attribute` is registered by apply.ts).
// The shared floor and its rationale live in test/180-pool-sight.test.ts.
test('R214: this sweep sees the whole card pool', () => {
  const n = allCardNames().length;
  assert.ok(n >= 495 && allCardNames().includes('Alluring Attribute'),
    `this sweep sees ${n} cards, not the full 495 — it reaches src/cards/registry.ts but not `
    + 'src/apply.ts. Import ../src/index.ts. See test/180-pool-sight.test.ts.');
});
