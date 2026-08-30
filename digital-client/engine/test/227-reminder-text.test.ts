/* R248 / report #118 — THE REMINDER A PLAYER READS.
 *
 * Bena, room YFUE, 2026-08-28: *"the reminders in the 'Rules' page and under
 * units is too verbose and includes R references, which aren't known outside
 * this digital client. Instead, the reminder text should match the exact
 * reminder text provided by the game. Piercing is 'edited', for example."*
 *
 * Three separate things were true when that was written, and only the middle
 * one was in the brief:
 *
 *   · ui/cardpanel.ts printed the `ruling` FIELD — "R13, R103, R114, printed"
 *     — under every pinned card in the browser.
 *   · the rows really are edited, {Piercing} deliberately so (R13/R103/R114
 *     generalise the attribute off the combat column onto all damage).
 *   · AND the {Haste} row carried "(R224)" and "(R236)" IN ITS OWN PROSE.
 *     That is the one the report actually names, because {Haste} is a
 *     MECHANICS row: ui/main.ts renders it under units through `glossaryHits`,
 *     and no field-level fix reaches a number a human typed into a sentence.
 *
 * So a guard that watches `cardpanel.ts` line 90 would have closed the report
 * while leaving on screen the exact string the report quotes. This file
 * watches the OUTPUT instead — every string on every exported row, and the
 * whole rendered panel for every card in the pool — and derives the set of
 * modules that could leak the field rather than listing the ones anybody
 * remembered.
 *
 * The other half of R248 (the printed reminder is shown verbatim, and the
 * generalisation is preserved rather than deleted) lives in
 * 177-glossary-conformance §7, next to the checks it has to stay honest with.
 * What is here instead is the INDEPENDENT DERIVATION: 177 reads types.ts's
 * `Attr` union, ui/glossary.ts reads the pool's own `attrs` arrays, and this
 * file reads the registry through `getCard`. Three mechanisms, per docs/13
 * §7.2 — a second look through the first channel is not a second channel.
 *
 * Seeds: none — pure data and pure string rendering.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import '../src/index.ts';   // R214: the WHOLE pool — registry.ts alone is 494 of 495
import {
  AUTHORED_GLOSSARY, GLOSSARY, LIBRARY_REMINDERS, MANUAL_REMINDERS, PRINTED_REMINDERS, glossaryHits,
  type GlossEntry,
} from '../ui/glossary.ts';
import { allRows } from '../ui/cardindex.ts';
import { cardPanelHtml, glossaryFor } from '../ui/cardpanel.ts';

const UI = fileURLToPath(new URL('../ui/', import.meta.url));

/** an R-number as a reader would see one: R13, R224, and not "R" alone */
const R_NUMBER = /\bR\d+\b/;

/* ════════════════════════════════════════════════════════════════════════
 * 1. NO PLAYER-FACING STRING CARRIES AN R-NUMBER
 * ════════════════════════════════════════════════════════════════════════
 *
 * Derived over the ROW, not over a list of fields. A renderer can only print
 * what is on the object, so sweeping every string-valued property covers
 * ui/main.ts's `glossRow` (label/term/text), ui/cardpanel.ts's `glossaryFor`
 * (those plus `rule`) and any prose field a later round adds, without this
 * file knowing any of them exist. `ruling` is an array and `re` is a RegExp,
 * so both fall out of the sweep on their own — which is the point: the
 * citations stay, and §2 is what stops them being rendered. */

function proseOf(e: GlossEntry): { field: string; value: string }[] {
  return Object.entries(e)
    .filter((kv): kv is [string, string] => typeof kv[1] === 'string')
    .map(([field, value]) => ({ field, value }));
}

const leaks = (rows: readonly GlossEntry[]): string[] =>
  rows.flatMap(e => proseOf(e)
    .filter(f => R_NUMBER.test(f.value))
    .map(f => `{${e.term}}.${f.field}: ${R_NUMBER.exec(f.value)![0]} in "${f.value}"`));

test('R248: no string a renderer can reach off a glossary row carries an R-number', () => {
  assert.deepEqual(leaks(GLOSSARY), [],
    'an R-number means nothing outside this repository (report #118). Citations belong in '
    + '`ruling`, which no renderer prints and 177 still resolves.');
  // the authored table too — it is the source the exported rows are built
  // from, so a number typed in there would arrive on screen the moment the
  // pool stopped printing a reminder for that term.
  assert.deepEqual(leaks(AUTHORED_GLOSSARY), []);
  assert.ok(GLOSSARY.length > 40, `only ${GLOSSARY.length} rows swept — the table is not loading`);
});

test('POSITIVE CONTROL: the R-number sweep names the row and the field it found', () => {
  // the real bug, restored: the {Haste} row as it read before R248.
  const haste = GLOSSARY.find(e => e.term === 'Haste');
  assert.ok(haste, 'the glossary has lost its Haste row');
  const broken: GlossEntry = {
    ...haste,
    text: 'The step ALWAYS happens (R224), whether or not anybody can act in it.',
  };
  const found = leaks([broken]);
  assert.equal(found.length, 1, `nothing fired on the pre-R248 Haste row: ${JSON.stringify(found)}`);
  assert.match(found[0]!, /\{Haste\}\.text: R224/);
  // and a number hidden in a field nobody thought about — the sweep is over
  // the object, so a new prose field is covered the day it is added
  assert.equal(leaks([{ term: 'Made Up', text: 'fine', rule: 'see R99 for why' }]).length, 1);
  assert.match(leaks([{ term: 'Made Up', text: 'fine', rule: 'see R99' }])[0]!, /\.rule: R99/);
});

/* ════════════════════════════════════════════════════════════════════════
 * 2. THE `ruling` FIELD IS MACHINERY AND NEVER RENDERS
 * ════════════════════════════════════════════════════════════════════════
 *
 * §1 cannot see this one: `ruling` is an array of citations, so a renderer
 * that joins it prints R-numbers that are on no string field of any row. That
 * is exactly what ui/cardpanel.ts did.
 *
 * Derived over the DIRECTORY. The consumers are whichever ui modules import
 * the glossary — today ui/main.ts, ui/cardpanel.ts and ui/cardlinks.ts, and
 * the point of computing that rather than writing it down is that a fourth one
 * is covered on the day it is written. `ui/scenario.ts` has a `ruling` textarea
 * of its own and is correctly out of scope: it does not import this table. */

/**
 * The source with its COMMENTARY removed.
 *
 * Necessary, and it was discovered the hard way: the fix to ui/cardpanel.ts
 * explains itself by quoting the line it deleted, so a raw scan convicted the
 * file for saying what it no longer does. Only block comments and lines that
 * OPEN with `//` or a JSDoc `*` are stripped — a trailing `//` is left alone
 * rather than risk cutting a `'https://…'` out of real code, which fails in
 * the safe direction (a trailing comment mentioning the field turns this red,
 * and someone reads the line).
 */
const codeOf = (src: string): string => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').filter(l => !/^\s*(?:\/\/|\*)/.test(l)).join('\n');

function uiSources(): { file: string; src: string }[] {
  return readdirSync(UI)
    .filter(f => f.endsWith('.ts'))
    .map(file => ({ file, src: codeOf(readFileSync(UI + file, 'utf8')) }));
}

const glossaryConsumers = (): { file: string; src: string }[] =>
  uiSources().filter(f => f.file !== 'glossary.ts' && /from '\.\/glossary\.ts'/.test(f.src));

/** a member access on the citations array, in any of the spellings that have
 * actually shipped: `g.ruling`, `e.ruling?.length`, `{ ruling }` destructuring */
const RENDERS_CITATIONS = /\.ruling\b|[{,]\s*ruling\s*[,}]/;

test('R248: no module that imports the glossary touches its citation field', () => {
  const consumers = glossaryConsumers();
  assert.ok(consumers.length >= 3,
    `only found ${consumers.length} ui modules importing the glossary — the directory scan is `
    + 'broken, not the client');
  const bad = consumers.filter(f => RENDERS_CITATIONS.test(f.src)).map(f => f.file);
  assert.deepEqual(bad, [],
    'ui/cardpanel.ts printed `g.ruling.join(", ")` under every pinned card — "R13, R103, R114, '
    + 'printed" — which is report #118. The field is how 177 proves a citation still resolves; '
    + 'it is not copy, and nothing that draws a screen may read it.');
  assert.ok(consumers.some(f => f.file === 'main.ts'), 'main.ts must be in scope — it draws the ? overlay');
  assert.ok(consumers.some(f => f.file === 'cardpanel.ts'), 'cardpanel.ts must be in scope');
});

test('POSITIVE CONTROL: the citation-render scan fires on the line that shipped', () => {
  // the comment strip first: it must take the explanation out and leave the
  // code in, or §2 is either blind or permanently red
  assert.equal(codeOf('/** prints `g.ruling.join()` */\nconst x = 1;').includes('ruling'), false);
  assert.equal(codeOf('  // was: g.ruling\n  const y = 2;').includes('ruling'), false);
  assert.ok(codeOf('const s = e.ruling; // gone').includes('e.ruling'),
    'the strip ate real code — it may only remove commentary');
  for (const shipped of [
    "g.ruling?.length ? ` <span class=\"dim\">${esc(g.ruling.join(', '))}</span>` : ''",
    'const { term, ruling } = entry;',
    '${e.ruling.join(", ")}',
  ]) {
    assert.ok(RENDERS_CITATIONS.test(shipped), `nothing fired on: ${shipped}`);
  }
  // and it does not fire on the citations being DECLARED, which is the whole
  // reason the field exists
  assert.equal(RENDERS_CITATIONS.test("{ term: 'Flying', ruling: ['printed'], text: '…' }"), false);
});

/* ════════════════════════════════════════════════════════════════════════
 * 3. THE RENDERED PANEL, over the whole pool
 * ════════════════════════════════════════════════════════════════════════
 *
 * §1 and §2 are about the data and the modules. This is the output: every card
 * the browser can pin, rendered, swept. It is the check that would have gone
 * red on the report without anybody having worked out WHY the number was
 * getting through. */

test('R248: rendering every card in the pool leaks no R-number', () => {
  const rows = allRows();
  assert.ok(rows.length > 450, `only ${rows.length} rows — the index is not loading`);
  let withGlossary = 0;
  const bad: string[] = [];
  // R257: DERIVED, not a floor somebody typed. `owed` is every card this
  // panel has a reason to explain something on — read off the card, not off a
  // memory of how many there were. The number it used to carry (`> 200`
  // against a then-current 373) was slack enough that the panel could have
  // dropped EVERY attribute row and stayed green, which is exactly what
  // CT-129 turned out to be: the type-line-only filter drew nothing for
  // {Balanced} on Brough and nothing for {Rot} on any of the fifteen cards
  // that name it, and this sweep — the only whole-pool run of the panel —
  // did not move.
  const owed = rows.filter(r => glossaryHits([r.type, r.text]).length > 0);
  const silent: string[] = [];
  for (const r of rows) {
    const html = cardPanelHtml(r.name, { close: 'cards-unfocus' });
    if (!html) { bad.push(`${r.name}: the panel rendered nothing`); continue; }
    if (glossaryFor(r)) withGlossary++;
    else if (glossaryHits([r.type, r.text]).length) silent.push(r.name);
    const hit = R_NUMBER.exec(html);
    if (hit) bad.push(`${r.name}: the pinned panel prints "${hit[0]}"`);
  }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} cards leak an R-number`);
  // the sweep is not vacuous: every card whose type line or text box names a
  // glossary term really does draw a reminder block, so a panel that silently
  // stopped rendering them cannot read as green
  assert.ok(owed.length > 300,
    `only ${owed.length} of ${rows.length} cards name a glossary term at all — the pool or the `
    + 'glossary is not loading, so nothing below proves anything');
  assert.deepEqual(silent.slice(0, 12), [],
    `${silent.length} cards name a glossary term and drew no reminder block — the glossary is `
    + 'not reaching the panel, so the sweep above proves nothing');
  assert.ok(withGlossary >= owed.length,
    `${withGlossary} cards drew a reminder block but ${owed.length} are owed one`);
});

test('POSITIVE CONTROL: the rendered sweep catches a citation put back on the panel', () => {
  // exactly the shipped line, rebuilt here rather than re-enabled in the
  // source — the check under test is the sweep, and it must see this.
  const e = GLOSSARY.find(g => g.term === 'Piercing');
  assert.ok(e, 'the glossary has lost its Piercing row');
  const asItShipped = `<div><b>${e.term}</b> — ${e.text} `
    + `<span class="dim">${(e.ruling ?? []).join(', ')}</span></div>`;
  const hit = R_NUMBER.exec(asItShipped);
  assert.ok(hit, 'the sweep cannot see the very markup report #118 is about');
  assert.equal(hit[0], 'R13', `{Piercing} cites ${(e.ruling ?? []).join(', ')}`);
});

/* ════════════════════════════════════════════════════════════════════════
 * 4. THE PRINTED REMINDER, derived through a THIRD channel
 * ════════════════════════════════════════════════════════════════════════
 *
 * ui/glossary.ts scans printed.json and takes its attribute universe from the
 * cards' own `attrs`/`augmentAttrs` arrays. 177 scans printed.json and takes
 * its universe from types.ts's `Attr` union. This reads the REGISTRY —
 * `allCardNames()` + `getCard` — which is the data as the running client sees
 * it, after every batch module has had its say. If a card is registered whose
 * printed row the JSON does not carry, or vice versa, the three disagree and
 * one of them is lying about what the game prints. */

function remindersViaRegistry(): Map<string, Set<string>> {
  const attrs = new Set<string>();
  for (const name of allCardNames()) {
    const def = getCard(name);
    for (const a of def.attrs ?? []) attrs.add(a);
    for (const a of def.augmentAttrs ?? []) attrs.add(a);
  }
  assert.ok(attrs.size > 20, `only ${attrs.size} attributes in the registry — the scrape is broken`);
  const out = new Map<string, Set<string>>();
  // R267: the pool writes reminders TWO ways, and this channel has to know both
  // or it will disagree with the JSON channel for a reason that is not about
  // the pool. (A) the span names the attribute. (B) the keyword is printed as
  // the ability and the span explains it without repeating the word — "Glimpse
  // 1 {i}(Reveal the top card ...)". For (B) the term universe is every
  // GLOSSARY term, not just `attrs`: {Glimpse} is a keyword action, not an
  // attribute, and could never have appeared in `attrs` at all.
  const terms = GLOSSARY.map(e => e.term);
  for (const name of allCardNames()) {
    const text = getCard(name).text ?? '';
    for (const m of text.matchAll(/\{i\}\(([^)]*)\)/g)) {
      const tidy = (x: string) => x.replace(/\{\/n\}/g, ' ').replace(/\s+/g, ' ').trim();
      const span = tidy(m[1] ?? '');
      let hit = false;
      for (const a of attrs) {
        if (!new RegExp(`\\b${a}\\b`, 'i').test(span)) continue;
        (out.get(a) ?? out.set(a, new Set()).get(a)!).add(span);
        hit = true;
      }
      if (hit) continue;                              // convention A owns it
      // convention B: the NEAREST glossary term in the lead owns the span.
      // Shib prints "[4] Ambush [Battle]{/n}{i}(Damage dealt by a blessed
      // source ...)" — without "nearest", {Ambush} claims a blessed sentence.
      const lead = tidy(text.slice(0, m.index));
      let near: { term: string; end: number } | null = null;
      for (const t of terms) {
        for (const h of lead.matchAll(new RegExp(`\\b${t}\\b`, 'gi'))) {
          const end = h.index + t.length;
          if (!near || end > near.end) near = { term: t, end };
        }
      }
      if (!near || lead.length - near.end > 30) continue;
      if (!PRINTED_REMINDERS.has(near.term)) continue;   // a REJECTED candidate; 245 pins the split
      (out.get(near.term) ?? out.set(near.term, new Set()).get(near.term)!).add(span);
    }
  }
  return out;
}

test('R248: the registry agrees with the glossary about which attributes the game explains', () => {
  const viaRegistry = remindersViaRegistry();
  assert.ok(viaRegistry.size >= 12,
    `only ${viaRegistry.size} attributes carry a printed reminder — the registry scrape is broken`);
  assert.deepEqual([...PRINTED_REMINDERS.keys()].sort(), [...viaRegistry.keys()].sort(),
    'the JSON channel and the registry channel disagree about which attributes the pool prints a '
    + 'reminder for — one of them is reading a pool the other cannot see');
  // and the ten the header of ui/glossary.ts is about must stay OUT of it: for
  // those the authored row is the only statement of the rule this repo has,
  // and a reminder appearing for one of them is a real event, not noise.
  const silent = ['Evasive', 'Sneaky', 'Alluring', 'Tough', 'Vulnerable',
    'Feeble', 'Resonant', 'Thieving', 'Reaping', 'Unaware'];
  assert.deepEqual(silent.filter(a => viaRegistry.has(a)), [],
    'a card now prints a reminder for an attribute that had none. That is not a failure — it '
    + 'means the printed text is the spec for it now, and 156-reaping-and-formation should be '
    + 'reading the card instead of ui/glossary.ts.');
});

test('R248: an attribute never has two different printed reminders to choose between', () => {
  // `asShown` takes the first bucket entry. That is only safe while there is
  // exactly one — otherwise which reminder a player sees depends on the order
  // of keys in a generated JSON file, which is not a rules decision anybody
  // made.
  const many = [...PRINTED_REMINDERS]
    .filter(([, list]) => list.length > 1)
    .map(([term, list]) => `{${term}}: ${list.map(r => `${r.card} says "${r.text}"`).join(' / ')}`);
  assert.deepEqual(many, [],
    'two cards print different reminders for the same attribute. Pick which one the client shows '
    + 'deliberately — do not let printed.json key order pick it.');
});

test('R248/R252: a row no channel reminds a player about keeps its full authored rule', () => {
  // the failure this whole design is guarding against: shortening a row to a
  // reminder that does not exist would leave a player with nothing, and R184
  // was decided by reading one of these.
  //
  // ⚠ DERIVED, not enumerated — and it was a list of fourteen until R252.
  // Report #119 added the Algomancy Manual as a second source, which supplied
  // sentences for {Burst}, {Virus} and {Ambush}; a written-down list would have
  // had to be edited to stay true, and an edit to a list like this is
  // indistinguishable from an edit that quietly drops a row out of the check.
  // Asking the two channels directly cannot go stale, and it happens to widen
  // the sweep from those fourteen to every silent row in the table.
  const authored = new Map(AUTHORED_GLOSSARY.map(e => [e.term, e.text]));
  const silent = GLOSSARY.filter(e => !PRINTED_REMINDERS.has(e.term)
    && !MANUAL_REMINDERS.has(e.term) && !LIBRARY_REMINDERS.has(e.term));   // R267

  // not vacuous, and the rows R206/CT-80 is actually about are in it by name:
  // for these the glossary row is the repo's ONLY statement of the rule.
  //
  // ⚠ R267 — AND THIS LIST IS THE ENUMERATED HALF OF A CHECK WHOSE COMMENT
  // ABOVE BOASTS OF BEING DERIVED. {Unstable} was in it, and was wrong: two
  // cards print a reminder for it and always did. The derived half was fine;
  // the hand-typed positive control is what went stale. It went stale in the
  // HONEST direction — it failed loudly the moment the scan improved — which
  // is the only reason a hard-typed control is tolerable here at all.
  for (const term of ['Evasive', 'Sneaky', 'Alluring', 'Tough', 'Vulnerable',
    'Feeble', 'Resonant', 'Thieving', 'Reaping', 'Unaware']) {
    assert.ok(silent.some(e => e.term === term),
      `{${term}} is no longer silent — some channel now reminds a player about it. That is not a `
      + 'failure, but it means the printed or manual sentence is the spec for it now, and this '
      + 'row is no longer the only statement of the rule this repo has.');
  }
  assert.ok(silent.length >= 17, `only ${silent.length} silent rows — the derivation is broken`);

  for (const e of silent) {
    assert.equal(e.rule, undefined,
      `{${e.term}} has no reminder in any channel, so nothing displaced its text`);
    assert.equal(e.text, authored.get(e.term),
      `{${e.term}} lost its authored sentence, and there is no game sentence to have replaced it`);
    assert.equal(e.printedOn, undefined);
    assert.equal(e.manualOn, undefined);
  }
});

test('R248: Piercing shows the sentence the card prints and keeps the one it does not', () => {
  // the report's own example, end to end. The printed reminder is what a
  // player reads; R13/R103/R114's generalisation off the combat column — a
  // piercing BLOCKER, non-combat damage — is what the repo still states.
  const e = GLOSSARY.find(g => g.term === 'Piercing');
  assert.ok(e, 'the glossary has lost its Piercing row');
  assert.equal(e.text, "Excess damage from piercing sources is dealt to the recipient's controller.");
  assert.equal(e.printedOn, 'Protective Adaptations');
  assert.match(e.rule ?? '', /non-combat damage/i, 'R103 generalised piercing off the column');
  assert.match(e.rule ?? '', /blocker/i, 'R114: a piercing blocker pierces into the attacking player');
});
