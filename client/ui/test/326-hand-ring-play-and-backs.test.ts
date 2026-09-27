/* 326 — THE HAND, READ LIKE THE GAME (owner, 2026-09-27).
 *
 * *"Double green border around cards in hand"* · *"Incorrect use of 'cast' on
 * cards in hand. Cards are generally 'played'"* · *"Use the official card back
 * image for cards in hand and any face down card scenarios"*.
 *
 * §1  one ring: no usable card draws a doubled outline, on the table or in
 *     the zoom (the ⑂ chip is what says "the click will ask")
 * §2  the offer chip says play, never cast
 * §3  every face-down card — the opponent's hand, a hidden hand card, a card
 *     flying out of it, a lesson figure — wears data/cards/Cardback.jpg, and
 *     main.ts is what hands the stylesheet its URL
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handOfferBadge } from '../inspect.ts';

const read = (f: string): string => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
const CSS = read('style.css');
const MAIN = read('main.ts');

test('§1 no doubled ring on a usable card', () => {
  assert.doesNotMatch(CSS, /outline-style:\s*double/, 'no rule draws a double outline');
  assert.doesNotMatch(CSS, /\.playable\.multi\s*\{[^}]*outline/, 'a multi card\'s ring is the plain one');
});

test('§2 the chip says play', () => {
  for (const kinds of [['cast', 'augment'], ['cast', 'graft'], ['cast', 'augment', 'graft']] as const) {
    const b = handOfferBadge([...kinds])!;
    assert.match(b.t, /\bplay\b/);
    assert.doesNotMatch(`${b.t} ${b.title}`, /\bcast\b/i);
  }
  assert.doesNotMatch(handOfferBadge(['augment'])!.title!, /\bcast\b/i);
});

test('§3 every face-down card wears the official back', () => {
  for (const sel of ['.card.back', '.miniback', '.animghost.back', '.lfigback']) {
    const esc = sel.replace(/\./g, '\\.');
    const rule = new RegExp(`(?:^|\\n)${esc} \\{[^}]*\\}`).exec(CSS)?.[0] ?? '';
    assert.match(rule, /var\(--cardback/, `${sel} draws the back image`);
  }
  assert.match(MAIN, /setProperty\('--cardback', `url\("\$\{new URL\(art\('Cardback'\)/, 'main.ts sets the URL, absolute');
});
