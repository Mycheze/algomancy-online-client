/*
 * 921 · NO NEW COLOUR LITERAL OUTSIDE tokens.css — a ratchet
 *
 * The design-system round (client/docs/23-design-system.md) gave the client
 * its colours as ROLES in `ui/styles/tokens.css` — --color-surface,
 * --color-text-muted, --color-danger, … — and Phase 1b's codemod
 * (ui/scripts/tokenize-styles.mjs) replaced every literal in base.css, pages/
 * and shared/ that was exactly one of them. What is left are the literals
 * that are NOT a token yet: near-misses waiting for the owner's snap list,
 * tints, one-offs. Each later round removes some. This file makes sure none
 * come back: a piece may hold at most the colour literals it held when its
 * count was last banked below, and the count may only go DOWN.
 *
 *   §0  non-vacuity — the counter finds every spelling and passes what is
 *       not a colour; the corpus is the real stylesheet
 *   §1  no piece in scope has more colour literals than ALLOW says
 *   §2  ALLOW names only pieces that exist and are in scope
 *   §3  a design token is defined once, on :root in tokens.css, and nowhere
 *       else — a scoped redefinition would make var() paint something else
 *       under it, which is what made the codemod's swap safe
 *
 * IN SCOPE: base.css, pages/**, shared/**. EXEMPT: board/** (the game board
 * is out of the design system's scope; it reads the tokens but keeps its own
 * colours) and tokens.css (where the literals belong).
 *
 * YOU ADDED A COLOUR AND THIS FAILED. Use a token: `var(--color-…)` from
 * tokens.css. If no role fits, the colour is a design decision — add the role
 * to tokens.css (named for what it is FOR, not what it looks like) rather than
 * raising the number here.
 *
 * YOU REMOVED SOME. The run logs the piece and its new count; lower ALLOW to
 * it so nobody can spend them again.
 *
 * Pieces are named WITHOUT their cascade number or extension (`pages/decks`
 * for `pages/23-decks.css`): a re-split may renumber them, and a bare name is
 * not a stylesheet path (910 holds those to read-styles.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { colourLiterals, declarations } from '../scripts/css-scan.mjs';
import { readStylePieces } from './read-styles.ts';

/** colour literals per piece, banked 2026-11-02 after the Phase 1b codemod and its snap (1b-ii), and again
 *  2026-11-03 after the Manual's palette (ui/test/1030) moved the gold, green and felt onto the roles. May only go down. */
const ALLOW: Record<string, number> = {
  'pages/joinscreen': 2,
  'shared/element-chips': 8,
  'pages/draft-lobby': 2,
  'pages/postgame': 1,
  'pages/decks': 4,
  'pages/tabletop': 10,
  'pages/deckstrip-curve-affinity': 4,
  'pages/queue': 3,
  'pages/admin': 12,
  'pages/learn': 16,
  'pages/cardstats': 3,
  'shared/touch': 2,
  'shared/drag': 3,
  // moved out of board/ (exempt) in the design-system round, 2026-11-03: the report pill's,
  // the bell's and the bell list's shadows, which no --shadow-* step equals. Not new colours.
  'shared/report-and-inbox': 4,
  'pages/crreview': 9,
  'pages/challenge': 1,
};

/** `pages/23-decks.css` → `pages/decks` */
const nameOf = (piece: string): string => piece.replace(/(^|\/)\d+-/, '$1').replace(/\.css$/, '');
const inScope = (piece: string): boolean => nameOf(piece) === 'base' || /^(pages|shared)\//.test(piece);
const isTokens = (piece: string): boolean => nameOf(piece) === 'tokens';

const pieces = readStylePieces();
const scoped = pieces.filter(p => inScope(p.piece));

/* ════════════════════════════════════════════════════════════════════════
 * 0. NON-VACUITY
 * ════════════════════════════════════════════════════════════════════════ */

test('§0 POSITIVE CONTROL: the counter finds every spelling of a colour, in values only', () => {
  const planted = [
    '#app .x:hover { color: #fff; background: #1a2b3c; border-color: #abcd; }',
    '.y { box-shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 0 0 1px rgb(10 20 30 / 50%); }',
    '.z { color: hsl(10 50% 50%); outline-color: white; fill: oklch(70% .1 200); }',
    '.w { color: var(--warn, #e8b64c); }',
  ].join('\n');
  assert.deepEqual(colourLiterals(planted).map(l => l.literal),
    ['#fff', '#1a2b3c', '#abcd', 'rgba(0, 0, 0, .5)', 'rgb(10 20 30 / 50%)', 'hsl(10 50% 50%)', 'white', 'oklch(70% .1 200)', '#e8b64c']);
});

test('§0 NEGATIVE CONTROL: an id selector, a comment, a string, a token and a url are not colour literals', () => {
  const clean = [
    '#add, #fed .bead { color: var(--color-text); }   /* was #d6dde6, and red */',
    '.q::before { content: "#fff white"; background: url(icons/white.svg); }',
    '.r { border: 1px solid var(--color-border); transition: color .2s; }',
  ].join('\n');
  assert.deepEqual(colourLiterals(clean), []);
});

test('§0 the corpus is the real stylesheet, with the board exempt and pages in scope', () => {
  assert.ok(pieces.length >= 40, `only ${pieces.length} pieces`);
  assert.ok(scoped.length >= 20, `only ${scoped.length} pieces in scope`);
  assert.ok(scoped.some(p => nameOf(p.piece) === 'base'), 'base.css is not in scope');
  assert.ok(!scoped.some(p => p.piece.startsWith('board/')), 'a board piece is in scope');
  const board = pieces.filter(p => p.piece.startsWith('board/')).reduce((n, p) => n + colourLiterals(p.text).length, 0);
  assert.ok(board > 200, `only ${board} colour literals on the board — the counter has gone blind (the board keeps its own)`);
  const tokens = pieces.find(p => isTokens(p.piece));
  assert.ok(tokens && /--color-bg\s*:/.test(tokens.text), 'tokens.css holds no role tokens');
});

/* ════════════════════════════════════════════════════════════════════════
 * 1–2. THE RATCHET
 * ════════════════════════════════════════════════════════════════════════ */

test('§1 no piece holds more colour literals than it did — use a token from tokens.css', () => {
  const over: string[] = [];
  const under: string[] = [];
  for (const { piece, text } of scoped) {
    const found = colourLiterals(text);
    const allowed = ALLOW[nameOf(piece)] ?? 0;
    if (found.length > allowed) {
      over.push(`${piece}: ${found.length} colour literals, allowed ${allowed}:\n`
        + found.map(l => `      ${l.selector} { ${l.prop}: …${l.literal}… }`).join('\n'));
    } else if (found.length < allowed) {
      under.push(`${nameOf(piece)}: ${found.length} (ALLOW says ${allowed})`);
    }
  }
  assert.deepEqual(over, [],
    'a colour literal was added outside tokens.css. Use a role token — var(--color-…) from ui/styles/tokens.css. '
    + 'If no role fits, add one THERE (named for what it is for), not a literal here:\n  ' + over.join('\n  '));
  if (under.length) console.log(`    921: fewer colour literals than banked — lower ALLOW to bank them:\n      ${under.join('\n      ')}`);
});

test('§2 ALLOW names only pieces that exist and are in scope', () => {
  const names = new Set(scoped.map(p => nameOf(p.piece)));
  const stale = Object.keys(ALLOW).filter(n => !names.has(n));
  assert.deepEqual(stale, [], 'ALLOW names pieces that are not in base.css / pages/ / shared/ (renamed? moved to board/?)');
});

/* ════════════════════════════════════════════════════════════════════════
 * 3. ONE DEFINITION PER TOKEN
 * ════════════════════════════════════════════════════════════════════════ */

const TOKEN = /^--(color|text|space|radius|shadow|font|z|dur|ease)-/;

test('§3 every design token is defined once, on :root in tokens.css, and nowhere else', () => {
  const tokens = pieces.find(p => isTokens(p.piece))!;
  const defs = declarations(tokens.text).decls.filter(d => TOKEN.test(d.prop));
  assert.ok(defs.length >= 60, `only ${defs.length} design tokens in tokens.css`);
  assert.deepEqual(defs.filter(d => d.selector !== ':root').map(d => `${d.selector} { ${d.prop} }`), [],
    'a design token in tokens.css outside :root');
  const seen = new Set<string>();
  const twice = defs.filter(d => (seen.has(d.prop) ? true : (seen.add(d.prop), false))).map(d => d.prop);
  assert.deepEqual(twice, [], 'a design token defined twice in tokens.css');
  const elsewhere: string[] = [];
  for (const { piece, text } of pieces) {
    if (isTokens(piece)) continue;
    for (const d of declarations(text).decls) {
      if (!TOKEN.test(d.prop)) continue;
      // the rules page's document carries its renderer's own mono stack on .crdoc; --font-mono
      // is not swapped in by the codemod, so nothing outside .crdoc reads it differently
      if (d.prop === '--font-mono' && /^\.crdoc$/.test(d.selector)) continue;
      elsewhere.push(`${piece}: ${d.selector} { ${d.prop} }`);
    }
  }
  assert.deepEqual(elsewhere, [],
    'a design token is redefined in a scope: every var() under that selector now paints something else. '
    + 'That is a theme — a decision, not a fix:\n  ' + elsewhere.join('\n  '));
});
