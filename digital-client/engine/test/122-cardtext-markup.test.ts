/**
 * R134 — the card-text markup formatter, and why it went unseen.
 *
 * Playtest report #91 (ANBB, 2026-08-24) said only "Beyond, Codex Incarnate has
 * a typo in its text". It was not a typo in the DATA — the transcription
 * matches the card art word for word. It was the RENDERER: `{g}` marks the one
 * keyword that follows it (the printed cards colour that word), and the
 * formatter had no case for it, so it fell through the "unknown {token} bares
 * its word" branch and emitted a literal "g". The player read
 * "Your units are ginverted."
 *
 * NINE cards print `{g}`, so nine cards were affected — the report named one
 * because that is the one the owner happened to be looking at.
 *
 * Pulling that thread found a second, larger one: the pool writes reminder text
 * as `{i}(…)` and almost never closes it with `{/i}`, so the `<i>` ran to the
 * end of the text box. That is invisible where the reminder is the last thing
 * on the card — which is most of them, and why it survived — but SEVEN cards
 * print real rules text AFTER a reminder, and had it silently italicised as
 * though it were flavour.
 *
 * WHY THERE WAS NO TEST BEFORE: `iconizeText` lived inside `ui/main.ts`, which
 * runs DOM code on import, so no test could reach it — the same shape as the
 * undo decision that lived in a socket handler (see the playtest-loop notes)
 * and `optionPingId` before BL-24 lifted it. It lives in `ui/cardtext.ts` now
 * for exactly that reason. Suspect any rendering decision that only exists
 * inside the client entry point.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  augmentClause, dropOriginMarker, entityTextBox, iconizeText, printedTextBox,
} from '../ui/cardtext.ts';
import { ent, finishBattle, pass, spawn, toDeployment, toNextBattle } from './util.ts';

const textOf = (n: string): string => getCard(n).text ?? '';
const q = (h: Harness): E => new E(h.state);

test('R134: {g} renders the keyword it marks, never a literal "g"', () => {
  const out = iconizeText(textOf('Beyond, Codex Incarnate'));
  assert.ok(out.includes('<span class="kw kw-g">inverted</span>'),
    'the marked keyword is styled, which is what the printed card does');
  assert.ok(!/\bginverted\b/.test(out),
    'the report: the player read "Your units are ginverted."');
  assert.ok(!out.includes('{g}'), 'and the marker itself is consumed');
});

test('R134: no card in the pool renders a stray marker word', () => {
  // the general form of the bug, over the whole pool rather than the one card
  // that got reported. A new {token} nobody taught the formatter about shows up
  // here as its own bare body glued to the following word.
  const bad: string[] = [];
  for (const name of allCardNames()) {
    const raw = textOf(name);
    if (!raw) continue;
    const out = iconizeText(raw);
    if (/\{[^}]*\}/.test(out)) bad.push(`${name}: unconsumed markup in "${out.slice(0, 60)}"`);
    // a bare marker letter fused onto the next word: "ginverted", "gdeadly"
    for (const m of raw.matchAll(/\{([a-z])\}([A-Za-z][A-Za-z-]*)/g)) {
      // the whole following WORD, so a marker letter that happens to form a
      // common digraph with the next letter ("{i}to" -> "it") is not a hit
      if (out.includes(m[1]! + m[2]!)) bad.push(`${name}: "{${m[1]}}" rendered as a literal "${m[1]}"`);
    }
  }
  assert.deepEqual(bad, [], 'every {token} must be consumed by the formatter');
});

test('R134: an unclosed {i} reminder does not italicise the rules text after it', () => {
  // Godray prints its reminder FIRST and its rules text second — the case that
  // makes the missing {/i} visible. Before R134 the whole card was italic.
  const out = iconizeText(textOf('Godray'));
  const close = out.indexOf('</i>');
  assert.ok(close > 0, 'the reminder closes its italic');
  assert.ok(out.slice(close).includes('damage to any target'),
    'and the rules text sits OUTSIDE it, upright like the printed card');
});

test('R134: every card emits balanced italics', () => {
  const unbalanced: string[] = [];
  for (const name of allCardNames()) {
    const out = iconizeText(textOf(name));
    const opens = (out.match(/<i>/g) ?? []).length;
    const shuts = (out.match(/<\/i>/g) ?? []).length;
    if (opens !== shuts) unbalanced.push(`${name}: ${opens} <i> vs ${shuts} </i>`);
  }
  assert.deepEqual(unbalanced, [],
    'an unclosed <i> leaks out of the text box and italicises whatever the '
    + 'client paints next — 76 cards printed one before R134');
});

test('R134: a card that closes its own italic is left alone', () => {
  // the balancer must not double-close, or the extra </i> leaks the other way
  const out = iconizeText('Text {i}(a reminder){/i} and more text.');
  assert.equal((out.match(/<i>/g) ?? []).length, 1);
  assert.equal((out.match(/<\/i>/g) ?? []).length, 1);
  assert.ok(out.endsWith('and more text.'));
});

test('R134: the formatter still does its original job — icons, pips and breaks', () => {
  // the regression guard for the lift out of main.ts: these are the cases that
  // were already working and must not have moved with the code.
  const aug = iconizeText('[Augment] Everything is {g}deadly.');
  assert.ok(aug.includes('Icons/augment.webp'), '[Augment] is still an icon');
  assert.ok(iconizeText('{Battle} unit').includes('Icons/battle.webp'), '{Battle} is still an icon');
  assert.ok(iconizeText('a{/n}b').includes('<br>'), '{/n} is still a line break');
  assert.ok(iconizeText('{Swift} unit').includes('Swift'), 'an unknown {attr} still bares its word');
  assert.ok(iconizeText('[weird] thing').includes('[weird]'), 'an unknown [token] keeps its brackets');
  assert.ok(iconizeText('<script>').includes('&lt;script&gt;'), 'and it still escapes first');
});

/* ── R135: the three cosmetic bugs in the text BOX ────────────────────
 *
 * Reported verbatim (2026-08-24, Bena): "When looking at a cards text, it
 * duplicates icons. For example, an augmented thing will show the :augment:
 * icon twice, once on each line. It also doesn't show unstable anywhere. And
 * when a :once: per turn activated/triggered ability is depleted, it's nice
 * that it greys it out, but it also duplicates the text, making it really
 * long and uses the wrong icon [Switch1] rather than [Once]."
 *
 * Two of the three are the box repeating something it has already said; the
 * third is the box failing to say the one thing only it can. R134 lifted the
 * FORMATTER out of main.ts so it could be tested; these reach one level up, at
 * the composed box, because that is where the repetition is decided. Seeds
 * 12200-12299.
 */

test('R135: an augment line does not repeat the [Augment] icon its own tag shows', () => {
  const h = new Harness(12200);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  {
    const e = q(h);
    // "[Augment] Whenever another unit dies, put a +1/+1 counter on me."
    e.attachMod(ent(h, host)!, 'Refuse Reclaimer', A, 'augment');
    e.settle();
  }
  const donated = entityTextBox(q(h), ent(h, host)!).lines.find(l => l.origin === 'augment')!;
  assert.ok(donated, 'the donated clause is still its own line');
  assert.ok(donated.text.includes('+1/+1 counter'), `and still says what it does: ${donated.text}`);
  // ui/main.ts renders LINE_TAG.augment — the augment ICON — beside this text,
  // so a marker at the head of the text is the SECOND one on the same line
  assert.ok(!/\[augment\]/i.test(donated.text),
    `the tag already carries the symbol: ${donated.text}`);
  assert.ok(!iconizeText(donated.text).includes('Icons/augment.webp'),
    'so the rendered line paints the augment icon zero times, not once more');
});

test('R135: no augment-donating card in the pool leads its clause with the marker', () => {
  // the general form: every text-box [Augment] in the pool is sliced by
  // augmentClause and then rendered under the augment tag
  const bad: string[] = [];
  for (const name of allCardNames()) {
    const clause = augmentClause(name);
    if (!clause) continue;
    if (/^\[augment\]/i.test(dropOriginMarker(clause))) bad.push(name);
  }
  assert.deepEqual(bad, [], 'a donated clause never opens with the icon its tag already shows');
  // and the marker is only ever dropped from the FRONT — one mid-sentence
  // separates a graft's cause from its effect and is the card's own punctuation
  assert.equal(dropOriginMarker('When I spawn, [Switch] Create a Fireball 1.'),
    'When I spawn, [Switch] Create a Fireball 1.');
});

test('R135: an Unstable card says so — the printed marker and the acquired kind', () => {
  // (a) printed on the type line: report #89's two cards, off the table
  const printedBox = printedTextBox('Aberrant Statweaver');
  assert.ok(printedBox.state.some(s => /Unstable/.test(s)),
    `a printed-{Unstable} card says so: ${JSON.stringify(printedBox.state)}`);
  assert.ok(printedBox.state.some(s => /erased instead of binned/.test(s)),
    'and says what that MEANS, which is the part a player needs');
  assert.deepEqual(printedTextBox('Ignis Sprite').state, [],
    'a card that is not Unstable says nothing — this is not a banner on every box');

  // (b) the acquired kind, which is the common one: a modded card is Unstable
  //     by the Manual's blanket rule (p.35), and nothing printed says it
  const h = new Harness(12201);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  const before = entityTextBox(q(h), ent(h, host)!);
  assert.ok(!before.state.some(s => /Unstable/.test(s)), 'unmodded: nothing to say');
  {
    const e = q(h);
    e.attachMod(ent(h, host)!, 'Refuse Reclaimer', A, 'augment');
    e.settle();
  }
  const after = entityTextBox(q(h), ent(h, host)!);
  assert.ok(after.state.some(s => /Unstable/.test(s)),
    `sliding a mod under it made it Unstable: ${JSON.stringify(after.state)}`);
  assert.ok(after.state.some(s => /modded/.test(s)),
    'and the box says WHY, because the four ways in expire differently');
  // the box may never re-derive the rule — the union lives in E.isUnstable
  assert.equal(q(h).isUnstable(ent(h, host)!), true);
});

test('R135: a spent once-per-turn ability is one short [Once] note, not its text again', () => {
  const h = new Harness(12202);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  // "After combat, [Switch1] Put a +1/+1 counter on each of your units."
  const se = spawn(h, A, 'Synaptic Energizer');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[se]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  pass(h); pass(h);                                   // the bounded trigger resolves
  const box = entityTextBox(q(h), ent(h, se)!);
  const note = box.lines.find(l => l.origin === 'note')!;
  assert.ok(note, 'the spent budget is still on the box');
  assert.equal(note.active, false, 'and still greys out — the owner asked to keep that');

  // the wrong icon: [Switch1] is the bounded-GRAFT symbol; the note is about
  // the BUDGET, and the budget symbol is [Once]
  assert.ok(note.text.includes('[Once]'), `tagged [Once]: ${note.text}`);
  assert.ok(!/\[switch1\]/i.test(note.text), `not [Switch1]: ${note.text}`);
  assert.ok(iconizeText(note.text).includes('Icons/once.webp'), 'and it renders as the once icon');

  // the duplication: the note used to restate the ability's label, which is a
  // paraphrase of the printed clause sitting directly above it
  assert.ok(!/counter on each of your units/i.test(note.text),
    `the note does not say the ability's text a second time: ${note.text}`);
  assert.ok(note.text.length < 40, `and it is SHORT — "really long" was the report: ${note.text}`);

  // ⚠ and the printed line above it keeps its own [Switch1], which is a real
  // token on 118 cards. Only the note's tag moved.
  const printed = box.lines.find(l => l.origin === 'printed')!;
  assert.ok(printed.text.includes('[Switch1]'), 'the printed card still reads as printed');
  assert.ok(iconizeText(printed.text).includes('Icons/bounded_graft.webp'),
    '[Switch1] in printed text is still the bounded-graft icon');
  finishBattle(h);
});
