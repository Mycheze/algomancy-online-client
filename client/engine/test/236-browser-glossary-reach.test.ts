/* R257 / CT-129 + CT-130 — THE CARD BROWSER SHOWS THE RULES THE CARD NAMES.
 *
 * Bena, answering Q7 of docs/questions-round31.md, about Brough:
 *
 *   *"Not all cards are done properly anyway: Brough … `[Augment] Everything
 *   is balanced. (The power and defense of balanced units are equal to the
 *   greater of the two.)` … Balanced isn't actually in the text here."*
 *   … *"Rot cards also don't have rules text yet."*
 *
 * Two reports, one defect. `ui/cardpanel.ts`'s `glossaryFor` picked its rows
 * with `r.attrs.includes(g.term) || r.keywords.includes(...)`, and BOTH of
 * those are the TYPE LINE — `keywords` is `attrs` + `augmentAttrs` +
 * `mechanicsOf()`, and `mechanicsOf` is a fixed nine-item list off booleans
 * and two bracket regexes. Nothing in that path has ever read the text box.
 * So:
 *
 *   · Brough carries `attrs: []` and grants {Balanced} as a static FROM ITS
 *     TEXT. The browser drew "Augment" and nothing else. The in-game
 *     inspector, which scans the text (`ui/main.ts` -> `glossaryHits`), drew
 *     "Balanced, Augment". Two glossary paths, and the browser had the wrong
 *     one.
 *   · {Rot} is a PLAYER counter (R38), not an attribute, so no card can EVER
 *     carry it on a type line. Fifteen cards talk about rot; the browser
 *     explained it on none of them. Ten glossary rows in total — Rot, Cache,
 *     Glimpse, Trash, Battle, Haste, Once, Recycle, Shard, Prismite — were
 *     unreachable in the browser for exactly this reason.
 *
 * WHAT THIS FILE ASSERTS, and why it is derived rather than typed
 * (docs/13-assessment.md §7.2): the subject set is computed from printed data
 * every time it runs — no card in the report below is named in an assertion.
 * The load-bearing statement is that the BROWSER PANEL AND THE IN-GAME
 * INSPECTOR AGREE. That is the machine-checkable form of this whole bug: the
 * client had two glossary paths and one of them was blind, and any future
 * divergence between the surface you read mid-turn and the surface you open
 * BECAUSE you want to look something up is the same bug again.
 *
 * TWO CHANNELS, DIFFERENT MECHANISMS. §2 builds its subject set twice — once
 * from the REGISTRY (`getCard` over `allCardNames()`, the data as the running
 * client sees it, matched with the glossary's own `matcherFor`) and once from
 * RAW `printed.json` parsed with a plain word-boundary regex and no engine
 * loaded at all. A scrape that reads less than it should is this repository's
 * recurring blindness, and two readings that share a premise are one piece of
 * evidence.
 *
 * Seeds: none — pure data and pure string rendering.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import '../src/index.ts';   // R214: the WHOLE pool — registry.ts alone is 494 of 495
import { GLOSSARY, KEYWORDS, glossaryHits, matcherFor, type GlossEntry } from '../../ui/glossary.ts';
import { allRows, rowFor, type CardRow } from '../../ui/cardindex.ts';
import { glossaryFor } from '../../ui/cardpanel.ts';
import { iconizeText } from '../../ui/cardtext.ts';

const rows = allRows();

/** the heading `glossaryFor` prints for one entry — the rendered string, not
 * the term, so this reads the OUTPUT and not the filter that chose it */
const headingOf = (g: GlossEntry): string => `<b>${iconizeText(g.label ?? g.term)}</b>`;

/** which glossary rows the browser panel actually draws for a card, read back
 * out of the markup it emits */
function panelTerms(r: CardRow): Set<string> {
  const html = glossaryFor(r);
  return new Set(GLOSSARY.filter(g => html.includes(headingOf(g))).map(g => g.term));
}

/** what `ui/main.ts`'s inspector draws for the same card, built the way it
 * builds it: the box's own attributes in their own section, then
 * `glossaryHits` over the type line and the text box with those skipped. */
function inspectorTerms(name: string): Set<string> | null {
  let c;
  try { c = getCard(name); } catch { return null; }
  const attrs: string[] = [...(c.attrs ?? [])];
  return new Set([
    ...attrs.filter(a => GLOSSARY.some(g => g.term === a)),
    ...glossaryHits([c.type, c.text], { skip: attrs }).map(e => e.term),
  ]);
}

/* ════════════════════════════════════════════════════════════════════════
 * 1. THE TWO SURFACES AGREE
 * ════════════════════════════════════════════════════════════════════════ */

test('CT-129: the browser panel never explains less than the in-game inspector', () => {
  const short: string[] = [];
  let subjects = 0;
  for (const r of rows) {
    const want = inspectorTerms(r.name);
    if (!want || !want.size) continue;
    subjects++;
    const got = panelTerms(r);
    const missing = [...want].filter(t => !got.has(t));
    if (missing.length) short.push(`${r.name}: browser is missing ${missing.join(', ')}`);
  }
  // the positive control for THIS check: a subject set of zero would pass it
  // forever and look identical to one that works
  assert.ok(subjects > 300,
    `only ${subjects} of ${rows.length} cards reference a rule at all — the pool, the index or `
    + 'the glossary is not loading, so agreeing about nothing is not evidence');
  assert.deepEqual(short.slice(0, 12), [],
    `${short.length} cards are explained in the game and not in the browser. The panel picked `
    + 'its rows off the TYPE LINE (r.attrs / r.keywords); the inspector scans the text box. '
    + 'Brough grants {Balanced} from its text and the browser drew only Augment — CT-129.');
});

/** the historical filter, and STILL half of the live one: the terms a card's
 * TYPE LINE yields. `r.attrs` plus `r.keywords`, which is `attrs` +
 * `augmentAttrs` + `mechanicsOf()`. */
const typeLineTerms = (r: CardRow): Set<string> => new Set(GLOSSARY
  .filter(g => r.attrs.includes(g.term) || r.keywords.includes(g.term.toLowerCase()))
  .map(g => g.term));

test('R257: the panel is a UNION — the text scan is added to the type line, never swapped for it', () => {
  // WHY THIS EXISTS. The obvious reading of R257 is "the text path covers
  // everything, so drop the type-line filter" — and it does not.
  // `mechanicsOf()` sets its flags off BOOLEANS on the printed row, and a
  // boolean does not have to put its word in the text box: {Prophecy} and
  // {Debt} both reach cards whose printed text never says either word. A pure
  // replacement therefore passes every other check in this file while quietly
  // losing rows, which is the same class of regression CT-129 was.
  //
  // Nothing is enumerated here. The subject set is whatever the type line
  // yields that the text scan does not, recomputed from printed data every
  // run, so a `mechanicsOf` flag added next round is covered the day it lands.
  const lost: string[] = [];
  const onlyOnTheLine: string[] = [];
  for (const r of rows) {
    const line = typeLineTerms(r);
    if (!line.size) continue;
    const fromText = new Set(glossaryHits([r.type, r.text]).map(g => g.term));
    const got = panelTerms(r);
    for (const t of line) {
      if (!got.has(t)) lost.push(`${r.name}: browser dropped ${t}`);
      if (!fromText.has(t)) onlyOnTheLine.push(`${r.name} — ${t}`);
    }
  }
  // the teeth. If this ever reaches zero the check above is still true and no
  // longer proves anything, and whoever emptied it should be told so rather
  // than inheriting a green test that cannot fail.
  assert.ok(onlyOnTheLine.length > 0,
    'no card in the pool now carries a glossary term on its type line that its text box does '
    + 'not also name, so this check can no longer tell a union from a replacement. That is a '
    + 'change in the DATA, not a pass: re-derive the guard before trusting it.');
  assert.deepEqual(lost.slice(0, 12), [],
    `${lost.length} card/term pairs the type line yields no longer draw a row. The panel must `
    + 'UNION glossaryHits with the attrs/keywords filter, not replace it: '
    + `${onlyOnTheLine.length} pairs (${onlyOnTheLine.slice(0, 4).join('; ')}…) reach the panel `
    + 'off a boolean with the word nowhere in the printed text.');
});

test('CT-130: every glossary row is reachable somewhere in the card browser', () => {
  // Rot, Cache, Glimpse, Trash, Battle, Haste, Once, Recycle, Shard and
  // Prismite were ten rows no card in the browser could ever draw, because
  // none of them is an attribute and the panel only read the type line. A row
  // the player can never be shown is a row that may as well not be written.
  const drawn = new Set<string>();
  for (const r of rows) for (const t of panelTerms(r)) drawn.add(t);
  assert.ok(GLOSSARY.length > 40, `only ${GLOSSARY.length} glossary rows — the table is not loading`);
  assert.deepEqual(GLOSSARY.filter(g => !drawn.has(g.term)).map(g => g.term), [],
    'these glossary rows are unreachable in the card browser: no card in the pool draws them, so '
    + 'the sentence is written and never shown');
});

/* ════════════════════════════════════════════════════════════════════════
 * 2. THE ATTRIBUTE A CARD GRANTS FROM ITS TEXT BOX — TWO CHANNELS
 * ════════════════════════════════════════════════════════════════════════ */

const PRINTED = JSON.parse(readFileSync(
  fileURLToPath(new URL('../src/cards/printed.json', import.meta.url)), 'utf8'),
) as Record<string, { name: string; type: string; text?: string; attrs?: string[]; augmentAttrs?: string[] }>;

/** `name — Term` for every card whose TEXT names an attribute its TYPE LINE
 * does not carry. Built from the registry, using the glossary's own matcher. */
function grantedInTextViaRegistry(): Set<string> {
  const out = new Set<string>();
  for (const name of allCardNames()) {
    let c;
    try { c = getCard(name); } catch { continue; }
    const line = new Set<string>([...(c.attrs ?? []), ...(c.augmentAttrs ?? [])]);
    for (const g of KEYWORDS) {
      if (!line.has(g.term) && matcherFor(g).test(c.text ?? '')) out.add(`${name} — ${g.term}`);
    }
  }
  return out;
}

/** the same set, read from raw printed.json with a plain word-boundary regex
 * and no engine, no glossary matcher, no card index — a DIFFERENT MECHANISM,
 * so agreement is evidence rather than an echo */
function grantedInTextViaJson(): Set<string> {
  const terms = KEYWORDS.map(g => g.term);
  const out = new Set<string>();
  for (const c of Object.values(PRINTED)) {
    const line = new Set<string>([...(c.attrs ?? []), ...(c.augmentAttrs ?? [])]);
    for (const t of terms) {
      if (!line.has(t) && new RegExp(`\\b${t}\\b`, 'i').test(c.text ?? '')) out.add(`${c.name} — ${t}`);
    }
  }
  return out;
}

test('the two channels agree about which cards name an attribute they do not carry', () => {
  const a = grantedInTextViaRegistry(), b = grantedInTextViaJson();
  assert.ok(b.size > 10, `printed.json yielded only ${b.size} pairs — the scrape read less than it should`);
  // printed.json is the SOURCE; the registry is that plus the synthetic faces
  // the oracle file does not carry, so the registry may only ever be a
  // superset, and every extra must be a name printed.json has never heard of.
  assert.deepEqual([...b].filter(x => !a.has(x)), [],
    'printed.json names a card/attribute pair the running registry does not — one of the two '
    + 'readings is broken, and they no longer corroborate each other');
  const extra = [...a].filter(x => !b.has(x));
  assert.deepEqual(extra.filter(x => PRINTED[x.split(' — ')[0]!] !== undefined), [],
    `the registry found ${extra.length} extra pairs on cards printed.json DOES carry — the two `
    + 'scans disagree about the same data');
});

test('CT-129: an attribute a card grants from its text box gets a reminder row', () => {
  const subjects = [...grantedInTextViaRegistry()];
  assert.ok(subjects.length > 10,
    `only ${subjects.length} cards name an attribute off their type line — the scan is broken, `
    + 'not the pool; a check with an empty subject set passes forever');
  const bad: string[] = [];
  for (const pair of subjects) {
    const [name, term] = pair.split(' — ') as [string, string];
    const r = rowFor(name);
    if (!r) { bad.push(`${pair}: no browser row at all`); continue; }
    if (!panelTerms(r).has(term)) bad.push(`${pair}: the pinned panel says nothing about it`);
  }
  assert.deepEqual(bad.slice(0, 12), [],
    `${bad.length} cards grant an attribute in their rules text and the browser explains none of `
    + 'it. Brough prints the pool ONLY {Balanced} reminder and the browser showed that sentence '
    + 'on Child of Aether while refusing to show it on Brough.');
});

test('CT-130: rot is explained on every card that mentions it', () => {
  const rot = GLOSSARY.find(g => g.term === 'Rot');
  assert.ok(rot, 'the glossary has lost its Rot row');
  const re = matcherFor(rot);
  const subjects = rows.filter(r => re.test(r.text) || re.test(r.type));
  assert.ok(subjects.length > 10,
    `only ${subjects.length} cards mention rot — the index is not loading, and a check over an `
    + 'empty set is indistinguishable from one that works');
  const bad = subjects.filter(r => !panelTerms(r).has('Rot')).map(r => r.name);
  assert.deepEqual(bad.slice(0, 12), [],
    `${bad.length} cards talk about rot and the browser never says what rot is. Rot is a counter `
    + 'on the PLAYER (R38), so it can never appear on a type line — which is precisely why the '
    + 'type-line filter drew it zero times.');
});

/* ════════════════════════════════════════════════════════════════════════
 * 3. POSITIVE CONTROLS
 * ════════════════════════════════════════════════════════════════════════ */

test('POSITIVE CONTROL: the filter that shipped fails every check in this file', () => {
  // the exact line as it stood before R257, rebuilt here rather than
  // re-enabled in the source. If the checks above cannot see this, they are
  // decoration.
  const asItShipped = (r: CardRow): Set<string> => new Set(GLOSSARY
    .filter(g => r.attrs.includes(g.term) || r.keywords.includes(g.term.toLowerCase()))
    .map(g => g.term));

  const short = rows.filter(r => {
    const want = inspectorTerms(r.name);
    if (!want) return false;
    const got = asItShipped(r);
    return [...want].some(t => !got.has(t));
  });
  assert.ok(short.length > 100,
    `the old filter only fell short on ${short.length} cards — §1 cannot be measuring what it `
    + 'claims to measure');

  const granted = [...grantedInTextViaRegistry()].filter(pair => {
    const [name, term] = pair.split(' — ') as [string, string];
    const r = rowFor(name);
    return r ? !asItShipped(r).has(term) : false;
  });
  assert.ok(granted.length >= 12,
    `the old filter hid only ${granted.length} granted attributes — §2 is not seeing CT-129`);

  const rotRe = matcherFor(GLOSSARY.find(g => g.term === 'Rot')!);
  const rotSeen = rows.filter(r => rotRe.test(r.text) && asItShipped(r).has('Rot'));
  assert.equal(rotSeen.length, 0,
    'the old filter is drawing a Rot row, so CT-130 was never the bug this file describes');

  const drawn = new Set<string>();
  for (const r of rows) for (const t of asItShipped(r)) drawn.add(t);
  const unreachable = GLOSSARY.filter(g => !drawn.has(g.term)).map(g => g.term);
  assert.ok(unreachable.length >= 10,
    `the old filter left only ${unreachable.length} rows unreachable — the reachability check is `
    + 'weaker than the bug it is named for');
});

test('POSITIVE CONTROL: swapping the type line out for the text scan is convicted too', () => {
  // The OTHER wrong panel, and the one a reader is likelier to write than the
  // one that shipped: keep the text scan, drop `r.attrs`/`r.keywords`. It
  // passes every check in this file except the union guard, so the union guard
  // has to be able to see it — otherwise the reasoning is only in a comment.
  const pureReplacement = (r: CardRow): Set<string> =>
    new Set(glossaryHits([r.type, r.text]).map(g => g.term));

  const lost: string[] = [];
  for (const r of rows) {
    const got = pureReplacement(r);
    for (const t of typeLineTerms(r)) if (!got.has(t)) lost.push(`${r.name} — ${t}`);
  }
  assert.ok(lost.length > 0,
    'dropping the type-line path costs nothing measurable, so the union guard above is '
    + 'decoration — check the data, not the test');
  // and it is invisible to the checks that catch the shipped filter: the
  // inspector scans the same two strings, so a replacement agrees with it
  // perfectly while losing rows the inspector never had.
  const short = rows.filter(r => {
    const want = inspectorTerms(r.name);
    if (!want) return false;
    const got = pureReplacement(r);
    return [...want].some(t => !got.has(t));
  });
  assert.deepEqual(short.map(r => r.name).slice(0, 6), [],
    'a pure replacement is supposed to satisfy the inspector-agreement check — if it does not, '
    + 'the two surfaces are being built from different inputs and this file has drifted');
});

test('the reminder block stays quiet enough to read', () => {
  // ui/glossary.ts's own budget (52-ui-glossary §"the scan stays quiet enough
  // to read") is the readability contract, and this panel is the surface that
  // now renders the widest set. The switch roughly doubles the rows drawn
  // across the pool, so the budget has to be checked HERE and not inferred.
  let worst = 0, total = 0, worstCard = '';
  for (const r of rows) {
    const k = panelTerms(r).size;
    if (k > worst) { worst = k; worstCard = r.name; }
    total += k;
  }
  assert.ok(rows.length > 450, `only ${rows.length} rows — the index is not loading`);
  assert.ok(worst <= 8, `no pinned card should draw more than 8 reminder rows (worst: ${worst}, ${worstCard})`);
  assert.ok(total / rows.length < 3,
    `mean reminder rows per card should stay small (got ${(total / rows.length).toFixed(2)})`);
});
