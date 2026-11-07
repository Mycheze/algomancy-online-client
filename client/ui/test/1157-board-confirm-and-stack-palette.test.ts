/*
 * 1157 · THE BOARD'S LAST TWO OLD-PALETTE COLOURS (BL-58)
 *
 * The Manual's palette (owner 2026-11-03) moved the client onto role tokens,
 * and moved `button.primary` from green to the filled orange. The board is
 * exempt from 921's ratchet (it keeps its own colours), and two of its rules
 * were literals written to match the OLD palette, so nothing moved them:
 *
 *   §1  `button.commitbtn` — the "That's enough — X = …" confirm on a cost
 *       ramp, filled green (#3c5a2f / #5b8747 / #476b37) "because green
 *       already means 'this is the affirmative one' on button.primary". It
 *       did, until that morning. Now it was the one green confirm on a table
 *       whose every other confirm is orange. It must paint what
 *       button.primary paints, through the same tokens.
 *   §2  the stack window (`.stackboard.live`), floating over the table on a
 *       slate-navy gradient (rgba(24,30,38) → rgba(16,20,26)) — a seam on
 *       the purple. Its background must be a palette surface token.
 *
 * Both read the served stylesheet (read-styles.ts) and resolve the tokens, so
 * they also fail if a token is later redefined away from the role.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { colourLiterals, declarations } from '../scripts/css-scan.mjs';
import { readStyles, resolveTokens } from './read-styles.ts';

const CSS = readStyles();

/** every declaration of `prop` (or its shorthand) on a rule whose selector is exactly `sel`, in cascade order */
function valuesOf(css: string, sel: string, props: string[]): { prop: string; value: string }[] {
  const { decls } = declarations(css);
  return decls
    .filter((d: { selector: string; prop: string; at: string[] }) => d.selector === sel && d.at.length === 0 && props.includes(d.prop))
    .map((d: { prop: string; start: number; end: number }) => ({ prop: d.prop, value: css.slice(d.start, d.end).trim() }));
}
/** the computed-by-cascade value of one longhand: the last declaration wins */
function lastOf(css: string, sel: string, prop: string): string | undefined {
  const all = valuesOf(css, sel, [prop]);
  return all.length ? resolveTokens(all[all.length - 1]!.value, CSS).replace(/\s+/g, ' ') : undefined;
}
/** the border colour a rule sets: border-color, or the colour word of a `border:` shorthand */
function borderColourOf(css: string, sel: string): string | undefined {
  const all = valuesOf(css, sel, ['border', 'border-color']);
  if (!all.length) return undefined;
  const last = all[all.length - 1]!;
  const v = resolveTokens(last.value, CSS).trim();
  return last.prop === 'border-color' ? v : v.split(/\s+/).pop();
}

/** the palette's surfaces, resolved — what a floating panel may sit on */
const SURFACES = ['--color-bg', '--color-surface-sunken', '--color-surface', '--color-surface-raised', '--color-surface-overlay']
  .map(t => resolveTokens(`var(${t})`, CSS));

/** the stack window's background, if it is a palette surface; else why not */
function stackBackgroundFault(css: string): string | null {
  const bg = valuesOf(css, '.stackboard.live', ['background', 'background-color']);
  if (!bg.length) return 'the stack window sets no background';
  const raw = bg[bg.length - 1]!.value;
  const lits = colourLiterals(`.x { background: ${raw}; }`).map(l => l.literal);
  if (lits.length) return `a colour literal, not a palette token: ${lits.join(', ')}`;
  const v = resolveTokens(raw, CSS).trim();
  return SURFACES.includes(v) ? null : `resolves to ${v}, which is no palette surface`;
}

test('§0 POSITIVE CONTROL: the old navy gradient and the old green are what these checks reject', () => {
  const oldStack = '.stackboard.live { background: linear-gradient(180deg, rgba(24,30,38,.96), rgba(16,20,26,.96)); }';
  assert.match(stackBackgroundFault(oldStack) ?? '', /colour literal.*rgba\(24,30,38/);
  const oldCommit = 'button.commitbtn { background: #3c5a2f; border: 1px solid #5b8747; color: var(--text); }';
  assert.equal(lastOf(oldCommit, 'button.commitbtn', 'background'), '#3c5a2f');
  assert.notEqual(lastOf(oldCommit, 'button.commitbtn', 'background'), lastOf(CSS, 'button.primary', 'background'));
  assert.ok(SURFACES.length === 5 && SURFACES.every(s => /^(#|rgba?\()/.test(s)), `surfaces did not resolve: ${SURFACES}`);
});

test('§1 the commit button paints exactly what button.primary paints — background, border and ink', () => {
  const primary = {
    background: lastOf(CSS, 'button.primary', 'background'),
    border: borderColourOf(CSS, 'button.primary'),
    color: lastOf(CSS, 'button.primary', 'color'),
  };
  assert.ok(primary.background && primary.border && primary.color, `button.primary is not where it was: ${JSON.stringify(primary)}`);
  const commit = {
    background: lastOf(CSS, 'button.commitbtn', 'background'),
    border: borderColourOf(CSS, 'button.commitbtn'),
    color: lastOf(CSS, 'button.commitbtn', 'color'),
  };
  assert.deepEqual(commit, primary, 'the cost ramp\'s commit button is not the table\'s primary confirm');
});

test('§1 the commit button\'s hover is the confirm hover, and no rule of it holds a colour literal', () => {
  const hover = 'button.commitbtn:hover:not(:disabled)';
  assert.equal(lastOf(CSS, hover, 'background'), resolveTokens('var(--color-confirm-hover)', CSS));
  assert.equal(borderColourOf(CSS, hover), resolveTokens('var(--color-confirm-border)', CSS),
    'hovered, it keeps its own border, as button.primary does');
  const { decls } = declarations(CSS);
  const lits = decls
    .filter((d: { selector: string }) => /\bbutton\.commitbtn\b/.test(d.selector))
    .flatMap((d: { selector: string; prop: string; start: number; end: number }) =>
      colourLiterals(`.x { ${d.prop}: ${CSS.slice(d.start, d.end)}; }`).map(l => `${d.selector} { ${d.prop}: ${l.literal} }`));
  assert.deepEqual(lits, [], 'the commit button holds a colour literal — use the confirm tokens');
});

test('§2 the stack window sits on a palette surface, not the old navy', () => {
  assert.equal(stackBackgroundFault(CSS), null);
});
