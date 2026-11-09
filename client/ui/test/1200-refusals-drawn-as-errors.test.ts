/* 1200 · A REFUSAL OUTSIDE THE GAME IS DRAWN AS AN ERROR, NOT IN THE GOLD OF A NOTE
 * (BL-10, the visual polish pass, 2026-11-09).
 *
 * The design-system round (2026-11-03) moved every page's message line onto
 * the status component "under today's look": the `note` tone, which is the old
 * `.deckmsg` gold. On these screens that line only ever holds a failure — the
 * server refused the room, "disconnected from the server — reconnecting…",
 * "could not reach the server", a wrong password, an invite that did not go —
 * and gold is the colour the same screens use for a success ("loaded X", the
 * headline). So a refusal read like good news (inventory 05 §18: "Errors and
 * successes share .deckmsg gold"). The queue, the profile and the admin page
 * already drew theirs red; these seven sites were left:
 *
 *   home's Play card · the Constructed and Single Card Duel waiting rooms ·
 *   the match room and its sideboard bar · the sign-in screen · the
 *   waiting rooms' "Invite a friend" panel
 *
 *   §1 each of those modules draws its failure line with the error tone
 *      (red, role="alert", read out at once), and no page writes the raw
 *      `<p class="deckmsg">` any more
 *   §2 the CSS: nothing gives `.pageerr` a colour of its own, so the error
 *      tone's red is what shows; `.deckmsg` (still the gold of a note) is not
 *      on any error line
 *
 * The rendered markup is pinned beside each page's own tests (960, 961, 973,
 * 977, 978). No browser runs here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStyles } from './read-styles.ts';
import { statusMessage } from '../components/index.ts';

const page = (f: string): string => readFileSync(new URL(`../pages/${f}`, import.meta.url), 'utf8');
const ERR = (text: string): RegExp =>
  new RegExp(`statusMessage\\(\\{ tag: 'p', tone: 'error', className: 'pageerr', text: ${text.replace(/\./g, '\\.')} \\}\\)`, 'g');

const SITES: readonly [file: string, text: string, count: number][] = [
  ['home.ts', 'v.error', 1],
  ['waiting.ts', 'v.error', 2],      // Constructed, Single Card Duel
  ['match.ts', 'v.error', 2],        // the room, the sideboard bar
  ['signin.ts', 'authMsg', 1],
  ['inbox.ts', 'v.msg', 1],          // the rooms' "Invite a friend" panel
];

test('§0 positive control: the error tone is red and read out; the note tone is not', () => {
  assert.equal(statusMessage({ tag: 'p', tone: 'error', className: 'pageerr', text: 'x' }),
    '<p class="ui-status ui-status--error pageerr" role="alert">x</p>');
  assert.doesNotMatch(statusMessage({ tag: 'p', className: 'deckmsg', text: 'x' }), /--error|alert/);
});

test('§1 every failure line on those screens uses the error tone', () => {
  for (const [file, text, count] of SITES) {
    const src = page(file);
    assert.equal([...src.matchAll(ERR(text))].length, count, `${file}: ${count} error line(s) drawing ${text}`);
    assert.doesNotMatch(src, new RegExp(`className: 'deckmsg', text: ${text.replace(/\./g, '\\.')}\\b`),
      `${file}: ${text} is never drawn in the note's gold`);
  }
  for (const file of ['home.ts', 'waiting.ts', 'match.ts', 'signin.ts', 'inbox.ts', 'deckpicker.ts']) {
    assert.doesNotMatch(page(file), /<p class="deckmsg">/, `${file}: no hand-written gold message line`);
  }
});

test('§2 the CSS lets the error red show', () => {
  const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.match(css, /\.ui-status--error\s*\{[^}]*color:\s*var\(--color-danger\)/, 'positive control: the tone is red');
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/\.pageerr\b/.test(m[1]!)) {
      assert.doesNotMatch(m[2]!, /(^|[;\s])color\s*:/, `no rule colours .pageerr: ${m[1]!.trim()}`);
    }
  }
  // the two places that pull the line tight still do, under its new name
  assert.match(css, /\.homeplayfoot \.pageerr\s*\{\s*margin:\s*0;?\s*\}/);
  assert.match(css, /\.ccsbbar \.pageerr\s*\{\s*margin:\s*0;?\s*\}/);
});
