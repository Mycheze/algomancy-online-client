/* ROUND 35 / R282 — A TYPE-LINE ATTRIBUTE IS RULES TEXT, AND THE BOX SAID IT
 * HAD NONE.
 *
 * I asked the owner whether four cards with an EMPTY oracle text — Whispering
 * Mantid, Slink, Crumbling Ancient, Tempest Wrangler — should have a printed
 * reminder added as an override. His answer, 2026-08-30, verbatim:
 *
 *   "That's cause they're attributes in the type line, not abilities.
 *    Attributes should show up in that place too. Maybe that's the root of
 *    this issue"
 *
 * So the transcription is RIGHT: those cards have no ability text at all, and
 * their whole rules content is a marker on the TYPE LINE. What was wrong is
 * the client. `ui/cardtext.ts` builds the box out of the card's `text`, that
 * text is empty, and `ui/main.ts` then drew the words "no rules text" over a
 * card whose printed marker is the only thing it does.
 *
 * ⚠ THE SUBJECT SET IS DERIVED FROM printed.json AT RUN TIME, in every test
 * below, and it is 22 cards rather than the four the report named. Nothing
 * here types a card name into an assertion it could pass without: a card
 * shipped tomorrow whose whole text box is a type-line attribute joins the
 * guard the day it lands, and a card that grows a text box leaves it.
 *
 * ⚠ EVERY TEST STATES ITS NON-VACUITY FIRST. The failure this is built against
 * is a box that renders nothing, which satisfies "does not say it twice"
 * forever — so each test asserts the card really carries the attribute and
 * really has no ability text BEFORE it asserts what the box says.
 *
 * ⚠ AND THE REMINDER IS NEVER COPIED INTO THIS FILE. `ui/glossary.ts` is a
 * rules document whose rows are corrected on their own schedule (fifteen of
 * them were wrong at once — see its header, R206), so every expectation below
 * reads the sentence back out of `GLOSSARY` at run time. A test carrying its
 * own copy of a reminder would go red for a CORRECTION, which is the opposite
 * of a guard.
 *
 * Seeds 6210-6219.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import '../../engine/src/index.ts';                 // R214: the WHOLE pool, not registry.ts alone
import { attrReminders, entityTextBox, printedTextBox } from '../cardtext.ts';
import { GLOSSARY } from '../glossary.ts';
import { cardPanelHtml, glossaryFor } from '../cardpanel.ts';
import { rowFor } from '../cardindex.ts';
import { ent, spawn, toDeployment } from '../../engine/test/util.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface Printed {
  name: string;
  text?: string;
  type?: string;
  attrs?: string[];
  prophecy?: unknown;
  kind?: string;
}

/** printed.json itself — the generated pool, read off disk rather than through
 * the registry, so nothing about import order can change what this test is
 * about. (`109-attr-channel-conformance.test.ts` reads it the same way.) */
function printedPool(): Printed[] {
  const raw = JSON.parse(
    fs.readFileSync(path.join(HERE, '..', '..', 'engine', 'src', 'cards', 'printed.json'), 'utf8')) as
    Printed[] | Record<string, Printed>;
  return Array.isArray(raw) ? raw : Object.values(raw);
}

/**
 * THE SUBJECTS: a card whose printed text box is empty and whose rules content
 * is therefore entirely on the type line.
 *
 * The prophecy carve-out is R279's, not a special case of mine: the extractor
 * splits a printed banner OUT of `text` into `CardDef.prophecy`, so The
 * Foretold reads as "no printed text" here while its box is in fact full. R279
 * already puts that line back.
 */
const subjects = (): Printed[] => printedPool().filter(c =>
  !(c.text ?? '').trim() && !c.prophecy && (c.attrs ?? []).length > 0);

/** the same question asked of a card with a text box — the complement, used as
 * the "this fix does not spray reminders over the whole pool" control */
const speakers = (): Printed[] => printedPool().filter(c => (c.text ?? '').trim().length > 0);

/** the sentence a player is shown for one term, read from the glossary now */
const reminderFor = (term: string): string | undefined =>
  GLOSSARY.find(g => g.term === term)?.text;

/* ════════════════════════════════════════════════════════════════════════
 * 0. THE DERIVATION — is this reading the pool, or a memory of it?
 * ════════════════════════════════════════════════════════════════════════ */

test('the cards with no ability text and a type-line attribute are found by scanning the pool', () => {
  const found = subjects();
  assert.ok(found.length >= 15,
    `only ${found.length} cards have an empty printed text box and a type-line attribute — `
    + 'printed.json is not loading, or the pool changed shape, and every test below is vacuous');

  for (const c of found) {
    // non-vacuity, card by card: it really has the attribute, and really has
    // no ability text for the attribute to be redundant with
    assert.equal((c.text ?? '').trim(), '', `${c.name}: the subject set admitted a card WITH text`);
    assert.ok((c.attrs ?? []).length > 0, `${c.name}: the subject set admitted a card with no attrs`);
    for (const a of c.attrs!) {
      assert.match(c.type ?? '', new RegExp(`\\{${a}\\}`, 'i'),
        `${c.name}: {${a}} is claimed as an attribute and is not on the printed type line — `
        + 'the whole premise of this ruling is that the marker lives there');
      assert.ok(reminderFor(a),
        `${c.name}: the glossary has no row for {${a}}, so the box has nothing to say about it`);
    }
    // and the registry agrees with the file, which is the second channel
    assert.deepEqual(getCard(c.name).attrs ?? [], c.attrs,
      `${c.name}: printed.json and the card registry disagree about the attributes`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * 1. THE BOX — off the table
 * ════════════════════════════════════════════════════════════════════════ */

test('R282: a card whose only rules content is a type-line attribute stops saying no rules text', () => {
  const found = subjects();
  assert.ok(found.length >= 15, 'non-vacuity: there are subjects to check');

  const silent: string[] = [];
  for (const c of found) {
    // ui/main.ts textBoxHtml: an EMPTY `lines` is exactly what draws the words
    // "no rules text" over the card. That string is the report.
    if (!printedTextBox(c.name).lines.length) silent.push(c.name);
  }
  assert.deepEqual(silent.slice(0, 12), [],
    `${silent.length} cards render an empty text box — ui/main.ts draws "no rules text" over `
    + 'every one of them, and each has a printed attribute that IS its rules text');
});

test('R282: the box prints the marker and the reminder the glossary states for it', () => {
  const found = subjects();
  assert.ok(found.length >= 15, 'non-vacuity: there are subjects to check');

  for (const c of found) {
    const box = printedTextBox(c.name);
    const whole = box.lines.map(l => l.text).join('\n');
    for (const a of c.attrs!) {
      const reminder = reminderFor(a)!;
      assert.ok(whole.includes(a),
        `${c.name}: the box never names {${a}}, so the reminder under it belongs to nothing`);
      assert.ok(whole.includes(reminder),
        `${c.name}: the box does not carry the {${a}} reminder VERBATIM. It must be read out of `
        + 'ui/glossary.ts at render time, never copied — the rows are corrected on their own '
        + 'schedule and a copy would keep teaching the withdrawn one');
    }
    // it is the PRINTED card, not a modification of it: ui/main.ts drops the
    // origin tag only for a single unmodified printed line, and a box that
    // claims to be modified wears a "current text" badge it has not earned
    assert.equal(box.modified, false, `${c.name}: an unplayed card is not a modified one`);
    for (const l of box.lines) {
      assert.equal(l.origin, 'printed',
        `${c.name}: a type-line attribute is printed on the card — no other origin fits, and `
        + 'ui/main.ts LINE_TAG is a Record over LineOrigin that would not survive a new one');
    }
  }
});

test('R282: a card with no attribute and no text still says nothing, and the guard does not reach it', () => {
  // THE CONTROL. Tidal Menace is a genuine vanilla: no text, no attributes,
  // nothing to explain. A fix that made every empty box say something would
  // pass every test above and be wrong here.
  const vanilla = printedPool().filter(c =>
    !(c.text ?? '').trim() && !c.prophecy && !(c.attrs ?? []).length);
  assert.ok(vanilla.length >= 1,
    'no card in the pool is a true vanilla — this control is measuring nothing');
  for (const c of vanilla) {
    assert.deepEqual(attrReminders(c.name), [],
      `${c.name}: it has no attributes, so there is no reminder to print`);
    assert.deepEqual(printedTextBox(c.name).lines, [],
      `${c.name}: it really does have no rules text, and the box should keep saying so`);
  }
});

test('R282: a card that prints its own text box is left exactly as it was', () => {
  // The other half of the same worry, and the reason this is scoped to boxes
  // that are otherwise EMPTY. Report #118 was the owner saying the reminders
  // under a unit are already too verbose; a reminder line added to every card
  // with an attribute would re-open it on several hundred cards at once.
  const talking = speakers();
  assert.ok(talking.length > 400,
    `only ${talking.length} cards print any text — the pool is not loading`);
  const withAttrs = talking.filter(c => (c.attrs ?? []).length > 0);
  assert.ok(withAttrs.length > 25,
    `only ${withAttrs.length} talking cards carry an attribute — this control is vacuous`);
  const noisy = withAttrs.filter(c => attrReminders(c.name).length > 0);
  assert.deepEqual(noisy.slice(0, 12), [],
    `${noisy.length} cards print their own text box AND got an attribute reminder bolted on. `
    + 'The box already speaks for them; the attribute row and the glossary block explain the '
    + 'marker.');
});

/* ════════════════════════════════════════════════════════════════════════
 * 2. THE BOX — on the table (the in-game surfaces)
 * ════════════════════════════════════════════════════════════════════════ */

test('R282: the same line is there for a live unit on the board, which is the hover box', () => {
  const found = subjects().filter(c => c.kind === 'unit');
  assert.ok(found.length >= 15, `only ${found.length} subjects are units`);
  const name = found[0]!.name;
  const attr = found[0]!.attrs![0]!;

  const h = new Harness(6210);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const id = spawn(h, seat, name);

  // non-vacuity: the unit is really in play and really has the attribute
  const u = ent(h, id);
  assert.ok(u, `${name} is not on the board`);
  const e = new E(h.state);
  assert.ok(e.ownAttrs(u!).has(attr),
    `${name} is in play without {${attr}} — the engine and the type line disagree`);

  const box = entityTextBox(e, u!);
  assert.ok(box.attrs.some(a => a.attr === attr),
    `${name}: the attribute row is where R271 and R279 put a printed marker; it must still be there`);
  assert.ok(box.lines.length > 0,
    `${name}: the long-hover tooltip and the focus viewer render this box with NO glossary block `
    + 'beneath them — an empty box there is a card that looks blank on the table');
  assert.ok(box.lines.some(l => l.text.includes(reminderFor(attr)!)),
    `${name}: the live box does not carry the {${attr}} reminder`);
});

test('R282: the printed box and the live box say the same thing about an untouched unit', () => {
  // ui/cardtext.ts exists so that "a card does not change shape as it hits the
  // table". Two entry points, one answer.
  const name = subjects().filter(c => c.kind === 'unit')[0]!.name;
  const h = new Harness(6211);
  toDeployment(h);
  const id = spawn(h, h.state.deployPlayer!, name);
  const u = ent(h, id)!;
  const live = entityTextBox(new E(h.state), u).lines.map(l => l.text);
  const printed = printedTextBox(name).lines.map(l => l.text);
  assert.ok(printed.length > 0, 'non-vacuity: the printed box has lines to compare');
  assert.deepEqual(live, printed,
    `${name}: an unmodified unit reads differently on the table than it does in hand`);
});

/* ════════════════════════════════════════════════════════════════════════
 * 3. CT-164 / R279 — ONE STATEMENT, NOT TWO
 * ════════════════════════════════════════════════════════════════════════ */

test('R282: the browser panel states the reminder once, not once in the box and once under it', () => {
  // The owner, report #149: "the text is often redundant." The pinned panel
  // draws the text box and then a glossary block underneath it, and the
  // glossary block has ALWAYS drawn a row for a type-line attribute (R257).
  // Putting the same sentence in the box above it is exactly the shape he
  // reported — so the row gives way to the box, and keeps only what the box
  // does not say (`rule`, the repository's fuller statement, where there is
  // one).
  const found = subjects();
  assert.ok(found.length >= 15, 'non-vacuity: there are subjects to check');

  const doubled: string[] = [];
  for (const c of found) {
    const r = rowFor(c.name);
    if (!r) continue;
    // non-vacuity for THIS check: the panel really does render, and the
    // glossary block really does have a row for this term to begin with
    const html = cardPanelHtml(c.name, { close: 'cards-unfocus' });
    assert.ok(html, `${c.name}: the panel rendered nothing`);
    for (const a of c.attrs!) {
      const frag = fragment(reminderFor(a)!);
      assert.ok(frag.length >= 20,
        `${c.name}: the {${a}} reminder yields only "${frag}" as a searchable fragment — too `
        + 'short to tell one row from another, so counting it proves nothing');
      assert.ok(glossaryFor(r).includes(a),
        `${c.name}: the browser has never explained {${a}} at all — this check is measuring `
        + 'the wrong thing');
      const n = count(html, frag);
      assert.ok(n >= 1, `${c.name}: the panel stopped explaining {${a}} altogether`);
      if (n > 1) doubled.push(`${c.name}: {${a}} × ${n}`);
    }
  }
  assert.deepEqual(doubled.slice(0, 12), [],
    `${doubled.length} attribute reminders are printed TWICE in one pinned panel — once in the `
    + 'text box and once in the glossary block under it. That is report #149 exactly.');
});

test('R282: the rendered panel still explains every term the in-game inspector does', () => {
  // 236-browser-glossary-reach reads `glossaryFor(r)` alone. Once the box
  // carries a reminder the panel can be complete while that function is not,
  // so the same invariant is re-asserted here over the MARKUP the panel
  // actually emits — otherwise the dedupe above could quietly delete a row
  // and 236 would stay green.
  const short: string[] = [];
  let subjectsSeen = 0;
  for (const c of printedPool()) {
    const attrs = (c.attrs ?? []).filter(a => GLOSSARY.some(g => g.term === a));
    if (!attrs.length) continue;
    if (!rowFor(c.name)) continue;
    subjectsSeen++;
    const html = cardPanelHtml(c.name, { close: 'cards-unfocus' });
    const missing = attrs.filter(a => !html.includes(a));
    if (missing.length) short.push(`${c.name}: ${missing.join(', ')}`);
  }
  assert.ok(subjectsSeen > 40,
    `only ${subjectsSeen} cards carry a glossary attribute — the index or the pool is not loading`);
  assert.deepEqual(short.slice(0, 12), [],
    `${short.length} cards name an attribute the pinned panel does not mention anywhere`);
});

/** how many times `needle` occurs in `hay` */
function count(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

/**
 * The part of a reminder that reaches the markup UNCHANGED — its longest
 * leading run of plain prose.
 *
 * The panel escapes and then iconizes, so a reminder containing `&`, a quote,
 * an apostrophe or a `{Keyword}` does not appear in the HTML in its source
 * spelling and searching for the whole sentence would silently find nothing —
 * which is a duplication check that can never fail. Cutting at the first
 * character either pass could touch gives a fragment that is in the markup
 * verbatim if the sentence is there at all, and the length assertion at the
 * call site is what stops a short one from matching by accident.
 */
function fragment(s: string): string {
  return (s.split(/[{}[\]&<>"']/)[0] ?? '').trim();
}
