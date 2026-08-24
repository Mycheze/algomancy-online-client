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
import { iconizeText } from '../ui/cardtext.ts';

const textOf = (n: string): string => getCard(n).text ?? '';

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
