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
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { allCardNames, getCard } from '../../engine/src/cards/dsl.ts';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import {
  augmentClause, dropOriginMarker, entityTextBox, iconizeText, modalHalves,
  narrowToMode, printedTextBox,
} from '../cardtext.ts';
import { ent, finishBattle, pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { ORACLE_JSON } from '../../engine/scripts/paths.mjs';
// @ts-expect-error — a .mjs build script, deliberately not part of the TS
// graph (161-printed-text-overrides.test.ts imports it the same way)
import { PRINTED_OVERRIDES } from '../../engine/scripts/printed-overrides.mjs';

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
  assert.ok(aug.includes('data/icons/augment.webp'), '[Augment] is still an icon');
  assert.ok(iconizeText('{Battle} unit').includes('data/icons/battle.webp'), '{Battle} is still an icon');
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
  assert.ok(!iconizeText(donated.text).includes('data/icons/augment.webp'),
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

/* ⚠ R271 MOVED WHERE THIS IS SAID, NOT WHETHER IT IS SAID.
 *
 * R135 put {Unstable} in `box.state` — the footnote row — because the word is
 * not in the engine's `Attr` union. Report #143 (QJEY, 2026-08-30): *"Instead
 * of putting Unstable reminder text at the bottom of a card […] put it in it's
 * attribute line."* So the assertions below moved from `state` to `attrs`, and
 * the "says what that MEANS" half moved with it: an attribute row is looked up
 * in the glossary, whose {Unstable} sentence is the POOL's own printed
 * reminder (R267), and 251 §5c is what holds that end. R135's actual rule —
 * SAY SO, AND SAY WHICH WAY IN — is unchanged and still asserted here.
 */
test('R135 + R271: an Unstable card says so — the printed marker and the acquired kind', () => {
  // (a) printed on the type line: report #89's two cards, off the table
  const printedBox = printedTextBox('Aberrant Statweaver');
  assert.ok(printedBox.attrs.some(a => a.attr === 'Unstable' && a.origin === 'printed'),
    `a printed-{Unstable} card says so, on its attribute line: ${JSON.stringify(printedBox.attrs)}`);
  assert.ok(!printedBox.state.some(s => /Unstable/.test(s)),
    'and only there — #143: not also in a footnote at the bottom of the card');
  assert.deepEqual(printedTextBox('Ignis Sprite').attrs.filter(a => a.attr === 'Unstable'), [],
    'a card that is not Unstable says nothing — this is not a banner on every box');

  // (b) the acquired kind, which is the common one: a modded card is Unstable
  //     by the Manual's blanket rule (p.35), and nothing printed says it
  const h = new Harness(12201);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  const before = entityTextBox(q(h), ent(h, host)!);
  assert.ok(!before.attrs.some(a => a.attr === 'Unstable'), 'unmodded: nothing to say');
  {
    const e = q(h);
    e.attachMod(ent(h, host)!, 'Refuse Reclaimer', A, 'augment');
    e.settle();
  }
  const after = entityTextBox(q(h), ent(h, host)!);
  const row = after.attrs.find(a => a.attr === 'Unstable');
  assert.ok(row, `sliding a mod under it made it Unstable: ${JSON.stringify(after.attrs)}`);
  assert.equal(row!.origin, 'augment',
    'and the box says WHY, because the four ways in expire differently — the ORIGIN '
    + 'carries it now, in the same vocabulary every other acquired attribute uses');
  // the box may never re-derive the rule — the union lives in E.isUnstable
  assert.equal(q(h).isUnstable(ent(h, host)!), true);
});

/* ⚠ R249 SUPERSEDED ONE HALF OF THIS TEST. R135 asserted two separate things
 * about the spent-budget note: it is SHORT (it does not restate the ability's
 * label), and it is tagged `[Once]` ALWAYS. The first still stands and is
 * asserted below. The second was overturned by the owner re-reporting the same
 * bug with the sides swapped — the marker now follows the ability's own
 * printed clause, and lives in test/228-spent-marker.test.ts. */
test('R135: a spent once-per-turn ability is one short note, not its text again', () => {
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

  // R249: the marker is whichever one THIS ability prints. Synaptic Energizer
  // prints [Switch1], so its note wears [Switch1]. Which marker goes on which
  // card is test/228's whole subject; here we only pin that the note carries
  // exactly one budget marker and nothing else got attached to it.
  const markers = note.text.match(/\[(?:once|switch1)\]/gi) ?? [];
  assert.equal(markers.length, 1, `exactly one budget marker: ${note.text}`);

  // the duplication: the note used to restate the ability's label, which is a
  // paraphrase of the printed clause sitting directly above it
  assert.ok(!/counter on each of your units/i.test(note.text),
    `the note does not say the ability's text a second time: ${note.text}`);
  assert.ok(note.text.length < 40, `and it is SHORT — "really long" was the report: ${note.text}`);

  // ⚠ and the printed line above it keeps its own [Switch1], which is a real
  // token on 118 cards — untouched by R135 and by R249.
  const printed = box.lines.find(l => l.origin === 'printed')!;
  assert.ok(printed.text.includes('[Switch1]'), 'the printed card still reads as printed');
  assert.ok(iconizeText(printed.text).includes('data/icons/bounded_graft.webp'),
    '[Switch1] in printed text is still the bounded-graft icon');
  finishBattle(h);
});

// ── R141: a cost written as bare digits ─────────────────────────────────
//
// Owner, 2026-08-24: "an icon we're NOT using anywhere is the [1] or [2] icon
// for paying costs on cards." Half right, and the half that was wrong is the
// interesting half: data/icons/cost_0..9 and cost_x WERE reached — but only through
// the spelled-out spelling. The pool writes the same amount two ways, `[two]`
// on 24 cards and `[2]` on 12, and only the first drew an icon. The second
// failed COST_TOKEN_RE (which demands a pip letter) and fell through to
// "unknown [token]: untouched", printing a literal "[2]".

test('R141: a cost written as bare digits draws the cost icon, not a literal "[2]"', () => {
  const out = iconizeText('When I am trashed, you may pay [2].');
  assert.ok(out.includes('data/icons/cost_2.webp'), `the [2] is the cost icon: ${out}`);
  assert.ok(!/\[2\]/.test(out), 'the report: the player read a literal "[2]"');
});

test('R141: the two spellings of one amount render identically', () => {
  // [1] and [one] are the same cost; nothing about the card says which
  // spelling the transcriber happened to use, so the box must not care.
  for (const [digit, word] of [['[1]', '[one]'], ['[2]', '[two]'], ['[3]', '[three]']]) {
    assert.equal(iconizeText(digit!), iconizeText(word!),
      `${digit} and ${word} are the same cost and must render the same`);
  }
});

test('R141: no card in the pool prints a bare-digit cost token as text', () => {
  // the general form, over the whole pool — the same shape as R134's sweep.
  // A new amount spelling nobody taught the formatter shows up here.
  const bad: string[] = [];
  for (const name of allCardNames()) {
    for (const raw of [getCard(name).text ?? '', getCard(name).type ?? '']) {
      if (!raw) continue;
      const out = iconizeText(raw);
      for (const m of out.matchAll(/\[([0-9]+)\]/g)) {
        bad.push(`${name}: "[${m[1]}]" survived as text`);
      }
    }
  }
  assert.deepEqual(bad, [], `bare-digit costs left unrendered:\n${bad.join('\n')}`);
});

/* ── R142: none of Caleb's formatting markup may EVER reach a player ─────
 *
 * Owner, room SMVJ 2026-08-24 (report #102): "UI thing: All the text on cards
 * still includes things that are only for the engine to see (like {i} or / or
 * some other 'markup' notes)". And on what the markup IS: "It's pure engine
 * markup used by some system Caleb uses to format cards better. {i} makes the
 * next word italic, {g} puts it into gold colored text, etc. I'm not sure what
 * the / does, tho."
 *
 * The `/` is `/[…]`: a bracket the PRINTED card draws as its own boxed panel,
 * on 13 cards. R134 and R141 each closed one marker; this closes the last one
 * and then nails the whole family shut with a sweep, because the lesson of both
 * earlier rulings is that a marker nobody taught the formatter about does not
 * announce itself — it renders as its own source text and waits for someone to
 * happen to look at that card.
 *
 * ⚠ THREE FAMILIES OF BRACE TOKEN, and only ONE of them is markup:
 *   1. FORMATTING — {i} {/i} {i1} {g} {p} {/n}, and `/[`. Never visible.
 *   2. KEYWORDS   — {Battle} {Virus} {Haste} {Flying} … ~30 of them. ALWAYS
 *      visible, as an icon where one exists and as the bare word where none
 *      does. Only six have icon assets; the other two dozen correctly bare
 *      their word, and that is not a bug to "fix" by inventing icons.
 *   3. STAT NOTATION — not a token at all, but `X/X`, `+1/+1`, `-1/-1` share
 *      the slash with family 1 and outnumber `/[` several times over.
 */

/** what a PLAYER actually reads: the rendered HTML with its tags taken off */
const asPlayerReads = (html: string): string => html.replace(/<[^>]*>/g, '');

test('R142: the /[…] box drops the slash and the brackets and keeps the words', () => {
  // a COST box — the printed card draws the cost panel, then the colon
  const cost = iconizeText('[Switch1] /[Sacrifice a unit]: Draw a card.');
  assert.ok(!cost.includes('/['), `the report: the player read a literal "/[": ${cost}`);
  assert.ok(cost.includes('<span class="costbox">Sacrifice a unit</span>'),
    `the bracket keeps its grouping as markup, not as punctuation: ${cost}`);
  assert.equal(asPlayerReads(cost), ' Sacrifice a unit: Draw a card.',
    'and what is left reads as English');

  // a MODE box — the same marker, a different job (six of the thirteen)
  const mode = iconizeText('Double the /[power {i1}or defense] of target unit.');
  assert.ok(!mode.includes('/['), `Burgeon's modal box: ${mode}`);
  assert.equal(asPlayerReads(mode), 'Double the power or defense of target unit.');
});

test('R142: a stat slash is NOT markup — X/X and +1/+1 survive untouched', () => {
  // THE TRAP. `/` is stat notation on far more cards than print `/[`, so the
  // markup rule is anchored to the slash being glued to a `[`.
  for (const raw of [
    'Create an X/X unit.',
    'Put a +1/+1 counter on each of your units.',
    'Each unit gets -1/-1 until regroup.',
    'I become base 4/4 and gain +2/+0.',
  ]) {
    assert.equal(asPlayerReads(iconizeText(raw)), raw, `stat notation must not move: ${raw}`);
  }
  // and the two live side by side on one card without interfering
  const both = iconizeText('[Switch1] /[Remove X +1/+1 counters from allies]: I deal X damage.');
  assert.ok(both.includes('+1/+1'), `Discharge keeps its counters: ${both}`);
  assert.ok(!both.includes('/['), both);
});

test('R142: {i1} does not eat the space beside the word it italicises', () => {
  // Wither and Bloom prints "…on each enemy or{i1} put a{/n} +1/+1…" — the
  // marker's only separator from the NEXT word sits after it, and a bare `\s*`
  // swallowed it, so the box read "each enemy orput a".
  const read = asPlayerReads(iconizeText(textOf('Wither and Bloom')));
  assert.ok(!/orput/.test(read), `two words jammed together: ${read}`);
  assert.ok(/enemy or put a/.test(read), `the space survives the marker: ${read}`);
  // the other side of the marker is the other half of the same bug
  assert.ok(/units or your units/.test(asPlayerReads(iconizeText(textOf('Floral Singularity')))),
    'and "units {i1}or your" keeps the space that sits BEFORE the marker');
  // no card in the pool loses a space to {i1}. Checked POSITIVELY — "does the
  // rendered text still have these two words with a space between them" — not
  // by hunting for the jammed digraph, which false-positives the moment the
  // pair happens to occur elsewhere ("power {i1}or" looks for "ro", and
  // "regroup" has one; the same trap R134's sweep hit with "{i}to" -> "it").
  const jammed: string[] = [];
  for (const name of allCardNames()) {
    const raw = textOf(name);
    if (!raw.includes('{i1}')) continue;
    const read = asPlayerReads(iconizeText(raw));
    for (const re of [/([A-Za-z]+)\{i1\}[ \t]([A-Za-z]+)/g, /([A-Za-z]+)[ \t]\{i1\}([A-Za-z]+)/g]) {
      for (const m of raw.matchAll(re)) {
        if (!read.includes(`${m[1]} ${m[2]}`)) jammed.push(`${name}: "${m[1]} ${m[2]}" -> "${read.slice(0, 80)}"`);
      }
    }
  }
  assert.deepEqual(jammed, [], 'a marker that vanishes but takes a space with it is still visible');
});

test('R142: {/n} inside an unrecognised bracket is still a line break', () => {
  // R134 CLAIMED formatting is resolved globally, before the icon pass, so a
  // marker nested inside a bracket the icon pass does not recognise is still
  // reached. Verified here rather than assumed: the claim held, and the /[…]
  // span must not become the thing that breaks it.
  assert.ok(iconizeText('a /[b{/n}c] d').includes('<span class="costbox">b<br>c</span>'),
    'a break nested in the costbox still breaks, and rides INSIDE the box');
  assert.ok(iconizeText('a [unknownthing{/n}x] b').includes('<br>'),
    'and inside a bracket that stays a bracket');
  assert.ok(iconizeText(textOf('Wither and Bloom')).includes('<br>'),
    'which is what the reported card needs — its {/n} sits inside its /[…]');
  // ⚠ the card BOX is the one place it is deliberately not a break: `clean()`
  // collapses {/n} to a space because it is a mid-WORD wrap in the scans
  // ("be- {/n}comes"), never a clause separator, and the box reflows.
  assert.ok(!printedTextBox('Wither and Bloom').lines[0]!.text.includes('{/n}'),
    'clean() has already consumed it before the box renders');
});

test('R142: no card in the pool renders engine markup to a player', () => {
  // THE SWEEP, and the deliverable that makes this stay fixed. Over the WHOLE
  // pool, for `text` AND the `type` line (R134's sweep covered only `text`),
  // as the player reads it — tags off, because a marker hiding in an alt=""
  // is not what anyone is complaining about.
  const FORBIDDEN: [string, RegExp][] = [
    ['{i}', /\{i\}/], ['{/i}', /\{\/i\}/], ['{i1}', /\{i1\}/],
    ['{g}', /\{g\}/], ['{p}', /\{p\}/], ['{/n}', /\{\/n\}/],
    ['/[', /\/\[/],
    // the general form: ANY brace token the formatter did not consume, which
    // is how the next unknown marker announces itself instead of shipping
    ['an unconsumed {token}', /\{[^{}]*\}/],
  ];
  const bad: string[] = [];
  for (const name of allCardNames()) {
    for (const field of ['text', 'type'] as const) {
      const raw = field === 'text' ? textOf(name) : getCard(name).type ?? '';
      if (!raw) continue;
      const read = asPlayerReads(iconizeText(raw));
      for (const [label, re] of FORBIDDEN) {
        if (re.test(read)) bad.push(`${name} (${field}): ${label} reached the player — "${read.slice(0, 90)}"`);
      }
    }
  }
  assert.deepEqual(bad, [], `engine markup on the table:\n${bad.join('\n')}`);
});

test('R142: the sweep covers the composed box, not just the raw card text', () => {
  // ui/main.ts calls iconizeText from ~25 sites — ability labels, glossary and
  // help rows, decision hints, the log, ui/markdown.ts — plus the full and
  // compact text boxes. Every one of them funnels through this one function,
  // which is WHY the fix is one function; this walks the box path (clean() +
  // graft/augment slicing + dropOriginMarker) to prove the slicing does not
  // reassemble something the formatter then fails to consume.
  const bad: string[] = [];
  for (const name of allCardNames()) {
    const box = printedTextBox(name);
    for (const s of [box.typeLine, ...box.lines.map(l => l.text)]) {
      if (!s) continue;
      const read = asPlayerReads(iconizeText(s));
      if (/\{[^{}]*\}|\/\[/.test(read)) bad.push(`${name}: "${read.slice(0, 90)}"`);
    }
  }
  assert.deepEqual(bad, [], `markup in a rendered text box:\n${bad.join('\n')}`);
});

test('R142: the keyword family is NOT suppressed — it keeps showing', () => {
  // The other half of the rule, and the easy way to "pass" the sweep wrongly:
  // {Battle} (136 uses), {Virus} (63), {Haste} (21) and ~30 more are card
  // CONTENT, not markup. Six have icon assets; the rest correctly bare their
  // word, which is not a bug.
  assert.ok(iconizeText('{Battle} Elemental Spell').includes('data/icons/battle.webp'));
  assert.ok(iconizeText('as if it had {Haste}.').includes('data/icons/haste.webp'));
  for (const kw of ['Piercing', 'Blessed', 'Deadly', 'Unstable', 'Tough', 'Unaware', 'Inverted']) {
    assert.equal(asPlayerReads(iconizeText(`I am {${kw}}.`)), `I am ${kw}.`,
      'a keyword with no icon asset bares its word — it must never be suppressed');
  }
});

/* ── R142 half two: the EXTRACTOR's layout artifacts ─────────────────────
 *
 * printed.json is GENERATED from Caleb's oracle file, so these are guarded on
 * the emitted data rather than fixed in it — a hand edit would be wiped by the
 * next regeneration, which is the quiet lie the card ledger exists to stop.
 */

test('R142: no printed card carries a hyphenation artifact from its own art', () => {
  // Four cards lost the {/n} that went with their soft hyphen in transcription
  // and were left reading "adja- cent" / "oppo- nent".
  const bad: string[] = [];
  for (const name of allCardNames()) {
    const c = getCard(name);
    for (const [field, s] of [['text', c.text ?? ''], ['type', c.type ?? '']] as const) {
      // hyphen + space + LOWERCASE letter, and no {/n} in between: never
      // legitimate in this pool (every -1/-1 has a digit after the hyphen,
      // every compound is closed, and the prophecy banner uses an em-dash)
      for (const m of s.matchAll(/[A-Za-z]-[ \t]+[a-z]/g)) bad.push(`${name} (${field}): "${m[0]}"`);
    }
  }
  assert.deepEqual(bad, [], `broken words in the printed data:\n${bad.join('\n')}`);
  assert.ok(getCard('Flamebreath Initiate').text.includes('allies adjacent to me'));
  assert.ok(getCard('Ghord').text.includes('Each opponent sacrifices'));
  // and the form that KEEPS its marker is deliberately untouched: {/n} is the
  // line separator the extractor's banner parser splits on
  assert.ok(getCard('Formless').text.includes('be- {/n}comes'),
    'a soft hyphen that still has its line break stays for clean() to join');
});

test('R142: printed text and type lines carry no whitespace runs', () => {
  const bad: string[] = [];
  for (const name of allCardNames()) {
    const c = getCard(name);
    for (const [field, s] of [['text', c.text ?? ''], ['type', c.type ?? '']] as const) {
      if (/\s\s/.test(s)) bad.push(`${name} (${field}): double space in "${s.slice(0, 70)}"`);
      if (s !== s.trim()) bad.push(`${name} (${field}): untrimmed "${s.slice(0, 40)}"`);
    }
  }
  assert.deepEqual(bad, [], `49 card texts and one type line had these:\n${bad.join('\n')}`);
});

test('R142: the extractor changes LAYOUT, never a designer\'s words', () => {
  // Linked Extinction used to read "Sacrifce a unit". The owner corrected it
  // AT SOURCE on 2026-08-24 ("that's a typo in the backend"), so the old
  // single-card record of that decision is gone — but the invariant it stood
  // for is the valuable half, and it is generalised here.
  //
  // normalisePrinted() may collapse whitespace and rejoin a hyphen the card
  // LAYOUT broke across a line. It may never alter a word. So: strip every
  // space and hyphen from the oracle text and from what we generated, and the
  // two must be character-identical. A fuzzy spellfix quietly added to the
  // extractor changes a letter and fails here, naming the card it touched.
  const oracle = JSON.parse(readFileSync(ORACLE_JSON, 'utf8')) as
    Record<string, Array<{ name?: string; text?: string; type?: string }>>;
  const canon = (v: string): string => v.replace(/\s+/g, '').replace(/-/g, '');

  /**
   * R162: the NAMED type-line overrides, and the only holes in this net.
   *
   * `scripts/extract-printed.mjs` grew a `TYPE_OVERRIDES` table — keyed by card
   * name, one entry per correction, asserting the source still says what it
   * claims — precisely because `normalisePrinted`'s own comment demands that
   * shape ("a named one-entry override, never a fuzzy spellfix"). R190 moved
   * that table to `scripts/printed-overrides.mjs` as `PRINTED_OVERRIDES` and
   * made it field-general (`type` | `text`); the entries are unchanged, and
   * `161-printed-text-overrides.test.ts` checks them from the other side.
   * These are
   * word changes, so they belong here rather than in the layout rules above,
   * and each carries its reason.
   *
   * ⚠ Interdiction Rift used to be named here as a card that deliberately did
   * NOT need an entry, on the grounds that its defect was "adding the missing
   * space after `{Battle}`", which is pure layout and invisible to `canon()`.
   * That reading was half wrong and R240 records why: the owner ruled the card
   * is "{Battle} Cosmic Spell" and the `AI` was never a subtype, which makes it
   * a word change after all. It is still not in this table — because the
   * correction landed AT SOURCE, so the oracle file and printed.json now agree
   * and there is nothing for `canon()` to catch. `test/209-interdiction-rift-
   * type-line.test.ts` pins that agreement from both sides.
   *
   * The list is asserted to be EXACTLY right below (88-replacement-conformance's
   * rule), so an entry that stops being needed — because Caleb corrects the
   * source, say — fails just as loudly as a new unexplained word change.
   */
  /**
   * ⚠ DERIVED FROM `PRINTED_OVERRIDES`, not restated.
   *
   * This was a hand-written copy of that table — the same two cards, the same
   * two `to` values, the same two reasons, typed twice. It survived because
   * the table had exactly two rows for months; CT-132 added four more and the
   * copy went stale the moment they landed, which is the whole argument
   * against keeping it. `scripts/printed-overrides.mjs` IS the declared list
   * of known-wrong upstream printed data, and every reason lives there in
   * `why`, so this reads it rather than remembering it.
   *
   * Nothing about what this test CHECKS has changed. It still asks a question
   * printed-overrides.mjs cannot answer for itself — does printed.json differ
   * from the oracle file anywhere the table does not declare? — and the
   * `used` assertion below still fails as loudly for an entry that has
   * stopped changing anything as for an undeclared word change.
   */
  const WORD_OVERRIDES: Record<string, { to: string; why: string }> =
    Object.fromEntries(PRINTED_OVERRIDES.map(
      (o: { card: string; field: string; to: string; why: string }) =>
        [`${o.card} (${o.field})`, { to: o.to, why: o.why }]));

  const drift: string[] = [];
  const used = new Set<string>();
  for (const rows of Object.values(oracle)) {
    for (const row of rows) {
      if (!row?.name) continue;
      let card;
      try { card = getCard(row.name); } catch { continue; }   // not in the playable pool
      for (const field of ['text', 'type'] as const) {
        const src = row[field];
        if (typeof src !== 'string') continue;
        const got = (card[field] ?? '') as string;
        // the extractor deliberately STRIPS a leading metadata segment — the
        // prophecy / "Discard me" / "[Gain 4 debt]" line — because those are
        // parsed into structured fields instead of left in the text. So what
        // we keep must be a SUFFIX of the source, which still catches any
        // altered letter inside the text that was retained.
        if (!canon(src).endsWith(canon(got))) {
          const key = `${row.name} (${field})`;
          const ex = WORD_OVERRIDES[key];
          if (ex && ex.to === got) { used.add(key); continue; }
          drift.push(`${row.name} (${field}):\n    oracle: ${src}\n    ours:   ${got}`);
        }
      }
    }
  }
  assert.deepEqual(drift, [],
    `the extractor altered words, not just layout:\n${drift.join('\n')}`);
  // and every exemption is still EARNING its place — a stale one is as loud as
  // an unexplained change, because it means nobody noticed the source moved
  assert.deepEqual([...used].sort(), Object.keys(WORD_OVERRIDES).sort(),
    'a named override no longer changes anything: delete it, or its `to` has drifted');
});

/* ── R284: the printed bracket, drawn the way the printed card draws it ────
 *
 * Owner, 2026-09-01, on seeing Void Memory's "[unit *or* spell]" rendered as
 * ONE panel: *"I think that the OR should be outside the box and it should be
 * two boxes, one around each mode. And then, when it's put onto the stack, the
 * non chosen mode vanishes, making the card read how it will function."*
 *
 * One box around both alternatives says the whole clause is a single thing,
 * which is the opposite of what a mode is. Two boxes with the "or" between
 * them say what the card says.
 *
 * The three properties below are each a way the previous rendering was wrong:
 * one box where there should be two, LITERAL BRACKETS on the eight cards whose
 * upstream transcription omits the `/` marker, and a stack item still offering
 * a choice it made two windows ago.
 */

/** the pool's printed brackets, by the rule ui/cardtext.ts uses: a bracket the
 * icon pass does not recognise. Derived, never listed — the census that says
 * 21 today is the thing most likely to be stale tomorrow. */
function printedBrackets(name: string): string[] {
  const raw = textOf(name);
  const out: string[] = [];
  for (const m of raw.matchAll(/\/?\[([^\[\]]+)\]/g)) {
    const body = m[1]!;
    // recognised markers render as an icon and are not printed brackets
    if (!/\s/.test(body) && !m[0]!.startsWith('/')) continue;
    out.push(body);
  }
  return out;
}

test('R284: a MODAL bracket draws two boxes with the "or" outside them', () => {
  const html = iconizeText(textOf('Void Memory'));
  assert.match(html, /<span class="costbox">unit<\/span> <i>or<\/i> <span class="costbox">spell<\/span>/,
    `the owner's ask, on the card it was asked about: ${html}`);
  assert.equal((html.match(/costbox/g) ?? []).length, 2, 'exactly two boxes');
  // and the words the player reads are unchanged — this is presentation only
  assert.match(asPlayerReads(html), /discards a unit or spell if/);
});

test('R284: a COST bracket still draws exactly one box', () => {
  // the other half of R157 §21's taxonomy, and the thing two boxes must not
  // happen to. No cost bracket in the pool contains the word "or".
  for (const name of ['Immolate', 'Discharge', 'Trench Stalker', 'Necromantic Rebuke']) {
    const html = iconizeText(textOf(name));
    assert.equal((html.match(/costbox/g) ?? []).length, 1,
      `${name} is an additional cost, not a mode: ${html}`);
  }
});

test('R284: every printed bracket in the pool is a box — the `/` marker is not the gate', () => {
  // Eight of the pool's printed brackets carry no `/` upstream (Arbiter of
  // Armistice, Darkblast, Flesh Tithe, Necromantic Rebuke, Retribution Thing,
  // Siphon Life, Trench Stalker, Vengeance), and before R284 those eight — two
  // of them MODAL — printed literal square brackets at the table while their
  // thirteen siblings printed boxes. The transcription marker is upstream
  // noise; whether the body is prose is the fact.
  const bare: string[] = [];
  let seen = 0;
  for (const name of allCardNames()) {
    const brs = printedBrackets(name);
    if (!brs.length) continue;
    seen += brs.length;
    const html = iconizeText(textOf(name));
    for (const body of brs) {
      const words = body.replace(/\{[^{}]*\}/g, ' ').trim().split(/\s+/)[0]!;
      if (!html.includes('costbox')) bare.push(`${name}: "${body}" drew no box`);
      else if (new RegExp(`\\[[^\\]]*${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(asPlayerReads(html))) {
        bare.push(`${name}: "${body}" still reads with its brackets — ${asPlayerReads(html)}`);
      }
    }
  }
  assert.ok(seen >= 20, `the census found only ${seen} printed brackets — has the pool changed?`);
  assert.deepEqual(bare, [], `printed brackets still reaching the player as punctuation:\n${bare.join('\n')}`);
});

test('R284: an unrecognised ONE-WORD bracket still announces itself', () => {
  // The safety valve R134 and R141 both cost us a shipped card to learn. The
  // discriminator is whitespace, and it cannot be traded away for the boxes.
  assert.ok(iconizeText('[weird] thing').includes('[weird]'),
    'a marker nobody taught the formatter about must stay loud');
  assert.ok(!iconizeText('[weird] thing').includes('costbox'), 'and must not be dressed as prose');
});

test('R284: {i1} italicises the word it is GLUED to, on either side', () => {
  // R142 kept the space and still italicised the word AFTER the marker, so
  // Wither and Bloom's "enemy or{i1} put" emphasised "put". All four {i1} in
  // the pool are a modal "or", and now all four render as one.
  for (const name of ['Burgeon', 'Transmutide Enigma', 'Void Memory', 'Wither and Bloom']) {
    assert.ok(!textOf(name).includes('{i1}') || iconizeText(textOf(name)).includes('<i>or</i>'),
      `${name}: the marker belongs to the "or" — ${iconizeText(textOf(name))}`);
  }
});

test('R284: modalHalves splits a mode and refuses a cost', () => {
  // one regex reads the marker BEFORE formatting resolves it and the <i> tag
  // after, because narrowToMode runs on raw text and iconizeText on formatted.
  assert.deepEqual(modalHalves('unit {i1}or spell'), ['unit', 'spell']);
  assert.deepEqual(modalHalves('power <i>or</i> defense'), ['power', 'defense']);
  assert.deepEqual(modalHalves('gains or loses'), ['gains', 'loses']);
  assert.equal(modalHalves('Sacrifice a unit'), null);
  assert.equal(modalHalves('Remove X +1/+1 counters from allies'), null);
  assert.equal(modalHalves('Erase X cards from your bin'), null);
});

test('R284: narrowToMode drops the half that was not chosen, and skips [Switch1]', () => {
  const t = textOf('Void Memory');
  assert.match(asPlayerReads(iconizeText(narrowToMode(t, 0))), /discards a unit if/);
  assert.match(asPlayerReads(iconizeText(narrowToMode(t, 1))), /discards a spell if/);
  // the FIRST bracket on this card is [Switch1] and it is not a half of
  // anything — narrowing must walk past it, not eat it.
  assert.ok(iconizeText(narrowToMode(t, 0)).includes('<img'), 'the [Switch1] icon survives');
  // a clause with no modal bracket at all comes back untouched
  assert.equal(narrowToMode('Draw a card.', 0), 'Draw a card.');
});
