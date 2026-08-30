/* ROUND 35 / R279 — WHAT A CARD SAYS ABOUT ITSELF.
 *
 * Four owner reports from room ZSPG, 2026-08-30, all landing on one surface:
 * the card-text box (ui/cardtext.ts) and the two glossary consumers that read
 * beside it (ui/glossary.ts, ui/cardpanel.ts).
 *
 *   #148 / CT-163  "The Everywhere doesn't show the named card in its textbox
 *                  (like in the right panel or on the hover box)"
 *   #153 / CT-168  "The Everywhere's named card stuff … needs to apply to
 *                  anything it's modding as well"
 *   #149 / CT-164  "the text is often redundant. For example, when the
 *                  abilities are turned off, there's a red banner …, then the
 *                  text is crossed out and then there's another thing under
 *                  it, saying it has its abilities switched off by XYZ"
 *   #150 / CT-165  "Cards with prophecy should have what that means in their
 *                  rulings and reminder text area"
 *
 * ⚠ EVERY SUBJECT SET IS DERIVED FROM printed.json AT RUN TIME. No test below
 * names the card it is about in an assertion it could pass without: the
 * naming-clause matcher, the prophecy-banner set and the redundancy census are
 * all re-scanned out of the pool, so a card added tomorrow joins the guard
 * instead of ageing it out (docs/13 §7.2, and the standing house rule).
 *
 * ⚠ EVERY TEST STATES ITS NON-VACUITY FIRST. The failure mode these guards are
 * built against is a box that renders nothing at all, which would satisfy
 * "does not say it twice" forever. So each one asserts the STATE really is set
 * and the box really is rendering BEFORE it asserts what the box says.
 *
 * Seeds 5900-5999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import '../src/index.ts';                 // R214: the WHOLE pool, not registry.ts alone
import {
  NAMED_CARD_RE, entityTextBox, namedCardOf, printedTextBox, prophecyBanner,
} from '../../ui/cardtext.ts';
import { GLOSSARY } from '../../ui/glossary.ts';
import { glossaryFor, cardPanelHtml } from '../../ui/cardpanel.ts';
import { rowFor } from '../../ui/cardindex.ts';
import type { Seat } from '../src/types.ts';
import { ent, give, giveResources, pick, skipHasteStep, spawn, toDeployment } from './util.ts';

const q = (h: Harness): E => new E(h.state);

/** deployment → the next turn's END-OF-HASTE decision, where the naming
 * happens. Lifted from 38-light-a.test.ts's `toNaming`, for the same reason it
 * exists there: R50 fires 'endOfHaste' inside a settle() window that may
 * suspend, so the usual toNextBattle() plumbing walks past the decision. */
function toNaming(h: Harness, attacker?: Seat): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  if (attacker !== undefined) h.state.initiative = attacker;
  h.do({ type: 'donePlanning', seat: 0 });
  if (!h.state.decision) h.do({ type: 'donePlanning', seat: 1 });
  if (!h.state.decision) skipHasteStep(h);
}

/* ════════════════════════════════════════════════════════════════════════
 * 0. THE DERIVATION ITSELF — is it reading the pool, or a card name?
 * ════════════════════════════════════════════════════════════════════════ */

/** every card whose PRINTED text carries the naming clause, scanned fresh */
const namingCards = (): string[] =>
  allCardNames().filter(n => {
    try { return NAMED_CARD_RE.test(getCard(n).text ?? ''); } catch { return false; }
  });

/** every card the pool prints a PROPHECY BANNER on, scanned fresh */
const bannerCards = (): string[] =>
  allCardNames().filter(n => {
    try { return !!getCard(n).prophecy; } catch { return false; }
  });

test('the naming clause is found by scanning the pool, not by naming a card', () => {
  const found = namingCards();
  assert.ok(found.length >= 1,
    'no card in the pool prints a "my last named card" clause — the matcher has gone stale, '
    + 'or the pool has, and either way the substitution below is testing nothing');
  for (const n of found) {
    assert.match(getCard(n).text, /named card/i,
      `${n} matched the naming matcher without printing the phrase — the matcher is too wide`);
  }
});

test('every card with a prophecy banner is found the same way', () => {
  const found = bannerCards();
  assert.ok(found.length >= 5,
    `only ${found.length} cards carry a printed prophecy banner — printed.json is not loaded`);
  for (const n of found) {
    const p = getCard(n).prophecy!;
    assert.equal(typeof p.mana, 'number', `${n}: the banner cost is structured data`);
    assert.ok(p.condition.length > 0, `${n}: the banner condition is structured data`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * 1. CT-163 / #148 — the named card, on the namer
 * ════════════════════════════════════════════════════════════════════════ */

test('CT-163: the box of the card that named says WHICH card it named', () => {
  const h = new Harness(5901);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const ev = spawn(h, A, 'The Everywhere');
  spawn(h, A, 'Triskaidekaphage');
  toNaming(h, A);
  pick(h, 'Triskaidekaphage');

  // ── non-vacuity, first: the memory really is set, and the box really is
  //    rendering the clause that talks about it
  const self = ent(h, ev)!;
  assert.equal(self.named, 'Triskaidekaphage',
    'the naming is remembered on the anchor — without this the rest proves nothing');
  const box = entityTextBox(q(h), self);
  assert.ok(box.lines.length > 0, 'the box has lines at all');
  assert.ok(box.lines.some(l => /loses all abilities/i.test(l.text)),
    'the naming clause is in the box — that is the line the named card belongs on');

  // ── and now the report
  assert.equal(namedCardOf(q(h), self), 'Triskaidekaphage',
    'one derivation answers "which card did this entity name"');
  assert.ok(box.lines.some(l => l.text.includes('Triskaidekaphage')),
    `#148: the named card is readable nowhere in the box:\n${
      box.lines.map(l => `  [${l.origin}] ${l.text}`).join('\n')}`);
  // and it did not become a SECOND line pretending to be printed text (R252):
  // the value is substituted into the clause the pool already prints
  assert.ok(!box.lines.some(l => /^named/i.test(l.text)),
    'the named card is substituted into the printed clause, not authored as a new sentence');
});

test('CT-163: with nothing named, the printed clause stands exactly as printed', () => {
  const h = new Harness(5902);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const ev = spawn(h, A, 'The Everywhere');
  spawn(h, A, 'Triskaidekaphage');
  toNaming(h, A);
  pick(h, '');                                    // "name no card"

  const self = ent(h, ev)!;
  assert.equal(self.named, '', 'the release really was taken');
  assert.equal(namedCardOf(q(h), self), undefined, 'a released naming names nothing');
  const box = entityTextBox(q(h), self);
  assert.ok(box.lines.some(l => /my last named card/i.test(l.text)),
    'the printed variable is left alone when there is no value to print');
});

/* ════════════════════════════════════════════════════════════════════════
 * 2. CT-168 / #153 — the same fact on the HOST it is modding
 * ════════════════════════════════════════════════════════════════════════ */

test('CT-168: the host wearing it as an augment says the named card too', () => {
  const h = new Harness(5903);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  spawn(h, A, 'Triskaidekaphage');
  giveResources(h, A, 'light', 4);
  h.do({
    type: 'augment', seat: A, from: 'hand',
    index: give(h, A, 'The Everywhere'), hostId: host,
  });
  toNaming(h, A);
  pick(h, 'Triskaidekaphage');

  // ── non-vacuity: the mod is really on, the memory is really on the HOST
  //    (E.queueTrigger stamps sourceId: host.id), and R268's donated box is
  //    really being rendered on the host
  const u = ent(h, host)!;
  assert.equal(u.mods.length, 1, 'the augment really is applied');
  assert.equal(u.named, 'Triskaidekaphage',
    'the memory lives on the HOST for donated text — that is the anchor');
  const box = entityTextBox(q(h), u);
  assert.ok(box.lines.some(l => l.origin === 'augment' && /loses all abilities/i.test(l.text)),
    'R268: the donated [Augment] box is on the host, which is where the clause is');

  // ── the report
  assert.ok(box.lines.some(l => l.text.includes('Triskaidekaphage')),
    `#153: the host does not say what its augment named:\n${
      box.lines.map(l => `  [${l.origin}] ${l.text}`).join('\n')}`);

  // and the MOD's own box answers the same, through the same derivation —
  // one lookup, two consumers, not two lookups
  const mod = ent(h, u.mods[0]!)!;
  assert.equal(mod.named, undefined, 'the mod itself holds no memory; the anchor does');
  assert.equal(namedCardOf(q(h), mod), 'Triskaidekaphage',
    'a mod resolves its anchor, so the mod strip and the host cannot disagree');
});

/* ════════════════════════════════════════════════════════════════════════
 * 3. CT-164 / #149 — one fact, said once
 * ════════════════════════════════════════════════════════════════════════ */

test('CT-164: a switched-off unit states the suppression once, not three times', () => {
  const h = new Harness(5904);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'The Everywhere');
  const victim = spawn(h, A, 'Triskaidekaphage');
  toNaming(h, A);
  pick(h, 'Triskaidekaphage');

  // ── non-vacuity: it really is switched off, the banner really names the
  //    culprit, and the lines really are struck through
  const u = ent(h, victim)!;
  assert.ok(h.q.abilitiesSuppressed(u), 'the silence really bit');
  const box = entityTextBox(q(h), u);
  assert.equal(box.suppressed.abilities, true, 'statement 1: the red banner');
  assert.deepEqual(box.suppressed.by, ['The Everywhere'], 'and it names the culprit');
  assert.ok(box.lines.length > 0 && box.lines.some(l => !l.active),
    'statement 2: the printed text is struck through');

  // ── statement 3 is the one the owner asked to lose
  const restated = box.lines.filter(l => /loses all (abilities|attributes)/i.test(l.text));
  assert.deepEqual(restated.map(l => `[${l.origin}] ${l.text}`), [],
    '#149: the box says "switched off by The Everywhere" a third time, under the '
    + 'banner and the strikethrough that already said it');
});

test('CT-164: a projected ATTRIBUTE is on the attribute row, not restated as a line', () => {
  const h = new Harness(5905);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Rotspore Herald');              // [Augment] box: everything here is Deadly
  const other = spawn(h, A, 'Unit Token');

  // ── non-vacuity: the projection really lands, and the attribute row really
  //    carries it WITH its source, which is what makes the line redundant
  const u = ent(h, other)!;
  assert.ok(h.q.ownAttrs(u).has('Deadly'), 'the grant really reaches it');
  const box = entityTextBox(q(h), u);
  const chip = box.attrs.find(a => a.attr === 'Deadly');
  assert.ok(chip, 'statement 1: the attribute row carries {Deadly}');
  assert.equal(chip.origin, 'static', 'attributed to a projection');
  assert.equal(chip.from, 'Rotspore Herald', 'and it names the source, on the chip');

  // ── statement 2, the same fact as a synthesized line
  const restated = box.lines.filter(l => l.origin === 'static' && /gains \{Deadly\}/i.test(l.text));
  assert.deepEqual(restated.map(l => l.text), [],
    '#149 (the class): "gains {Deadly}." restates the attribute chip directly above it, '
    + 'in every render mode — the hover box draws the attribute row too');
});

test('CT-164: the STAT arithmetic is not deduplicated — compact mode hides it', () => {
  // The boundary of the rule above, asserted so it cannot creep. A +N/+N from
  // a projection is stated by `statBreakdown.parts` — which ui/main.ts's
  // `textBoxHtml` DROPS in `compact`, the long-hover tooltip's mode. So the
  // static line is the only per-source attribution the hover box has, and it
  // stays.
  const h = new Harness(5906);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Rotspore Herald');
  const other = spawn(h, A, 'Unit Token');
  const box = entityTextBox(q(h), ent(h, other)!);
  const bits = box.lines.filter(l => l.origin === 'static');
  for (const l of bits) {
    assert.ok(!/loses all|gains \{/i.test(l.text),
      `a static line kept a bit another row already states: ${l.text}`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * 4. CT-165 / #150 — prophecy, where a player reads a card
 * ════════════════════════════════════════════════════════════════════════ */

test('CT-165: the printed prophecy banner is IN the box, on every card that prints one', () => {
  const cards = bannerCards();

  // ── non-vacuity: today the banner is STRIPPED out of `text` by the
  //    extractor, so at least one of these cards has no printed text at all
  //    and its box is empty. That is the report.
  assert.ok(cards.some(n => !(getCard(n).text ?? '').trim()),
    'no banner card has an empty text box — the extractor no longer strips the banner, '
    + 'and this guard is measuring the wrong thing');

  for (const n of cards) {
    const p = getCard(n).prophecy!;
    const banner = prophecyBanner(n);
    assert.ok(banner, `${n}: no banner reconstructed`);
    assert.ok(banner.includes(p.condition),
      `${n}: the banner must carry the pool's own condition verbatim, not a paraphrase`);
    assert.ok(banner.includes(`[${p.mana}]`),
      `${n}: the banner must carry the pool's own cost`);
    const box = printedTextBox(n);
    assert.ok(box.lines.some(l => l.text.includes(banner)),
      `#150: ${n} prints "${banner}" beneath its title and the box says nothing about it`);
  }
});

test('CT-165: a prophecy card reaches the {Prophecy} reminder in the in-game inspector', () => {
  // ui/main.ts's inspector builds its reminder rows two ways: `box.attrs` gets
  // a glossary row each, and `glossaryHits([type, text])` covers the rest with
  // the attributes SKIPPED. The banner is not in `text` and never was, so the
  // scan cannot see it — the marker has to arrive on the box the way R271
  // brought {Unstable} there.
  const row = GLOSSARY.find(g => g.term === 'Prophecy');
  assert.ok(row, 'the glossary has a {Prophecy} row to reach');
  assert.ok(row.text.length > 40, 'and it is a real reminder, not a stub');

  for (const n of bannerCards()) {
    const box = printedTextBox(n);
    assert.ok(box.attrs.some(a => a.attr === 'Prophecy'),
      `#150: ${n} carries a printed prophecy banner and the inspector has no row for it`);
  }
});

test('CT-165: a card WITHOUT a banner never claims the marker', () => {
  const without = allCardNames().filter(n => {
    try { return !getCard(n).prophecy; } catch { return false; }
  });
  assert.ok(without.length > 400, 'the pool is loaded');
  const wrong = without.filter(n => printedTextBox(n).attrs.some(a => a.attr === 'Prophecy'));
  assert.deepEqual(wrong, [], 'the marker is derived from the printed banner and nothing else');
});

test('CT-164 + CT-165: the browser panel does not state prophecy twice', () => {
  // The card browser already draws the {Prophecy} glossary row for these seven
  // cards, off `CardRow.keywords` (R257). The panel ALSO printed an authored
  // one-liner directly above it — the same redundancy class as #149, in the
  // same round's other report.
  const n = bannerCards()[0]!;
  const r = rowFor(n)!;
  assert.ok(glossaryFor(r).includes('Prophecy'),
    'non-vacuity: the browser really does draw the {Prophecy} row for a banner card');
  const html = cardPanelHtml(n, { close: 'x' });
  assert.ok(!/a cheaper alternative cost/i.test(html),
    '#149 (the class): an authored prophecy sentence sat directly above the glossary row '
    + 'that says the same thing at length');
  assert.ok(html.includes('Prophecy'), 'and prophecy is still explained');
});
