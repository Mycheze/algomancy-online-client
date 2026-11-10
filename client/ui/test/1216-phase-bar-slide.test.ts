/* 1216 — THE PHASE BAR'S SLIDE (owner, 2026-11-10).
 *
 * The lit step shows its name, and the box slides to the next step, the next
 * icon covering the old name as its own name opens.
 *
 *   §1 the slide: where it starts and ends is exactly the resting bar, and
 *      mid-slide it is the owner's sketch — both names part-open inside one box
 *   §2 the end of the turn runs backwards, leading with the left edge
 *   §3 the resting bar needs no script: the names are markup, opened by CSS
 *
 * No test here can watch it move; the frames are what is pinned.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slideFrame } from '../phaseslide.ts';
import { readStyles } from './read-styles.ts';

const MAIN = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'main.ts'), 'utf8');
const G = { words: [50, 34, 38, 38, 48, 42], icon: 24, gap: 2 };
const PLAN = 0, HASTE = 1, BATTLE = 2, DEPLOY = 5;

/** the resting box on step `i` */
function rest(i: number): { left: number; width: number } {
  return { left: i * (G.icon + G.gap), width: G.icon + G.words[i]! };
}

test('§1 the slide starts on the old step and ends on the new one, exactly', () => {
  const a = slideFrame(HASTE, BATTLE, 0, G);
  assert.deepEqual({ left: a.left, width: a.width }, rest(HASTE));
  assert.deepEqual(a.slots, [0, 34, 0, 0, 0, 0]);
  assert.deepEqual(a.lit, [0, 1, 0, 0, 0, 0]);
  const z = slideFrame(HASTE, BATTLE, 1, G);
  assert.deepEqual({ left: z.left, width: z.width }, rest(BATTLE));
  assert.deepEqual(z.slots, [0, 0, 38, 0, 0, 0]);
  assert.deepEqual(z.lit, [0, 0, 1, 0, 0, 0]);
});

test('§1 halfway, one box holds both half-open names: the sketch', () => {
  const f = slideFrame(HASTE, BATTLE, .5, G);
  assert.equal(f.slots[HASTE], 17);
  assert.equal(f.slots[BATTLE], 19);
  assert.equal(f.left, G.icon + G.gap, 'the trailing edge has not left the old icon');
  const newRight = (G.icon + G.gap) * 2 + 17 + G.icon + 19;
  assert.ok(f.width > newRight - f.left - 5 && f.width <= newRight - f.left, 'the leading edge has nearly reached the new box\'s right');
  assert.equal(f.lit[HASTE], 1, 'the old step is still lit');
  assert.ok(f.lit[BATTLE]! > .9, 'the new step already is');
});

test('§1 icons past the new step hold still when the two names are the same width', () => {
  const g = { ...G, words: [40, 40, 40, 40, 40, 40] };
  const x = (t: number): number => {
    const f = slideFrame(HASTE, BATTLE, t, g);
    return f.slots.slice(0, 3).reduce((a, s) => a + s, 0);
  };
  for (const t of [0, .25, .5, .75, 1]) assert.equal(x(t), 40);
});

test('§2 Deploy to Planning runs backwards: the left edge leads', () => {
  const f = slideFrame(DEPLOY, PLAN, .5, G);
  assert.equal(f.left + f.width > rest(DEPLOY).left, true, 'the right edge is still on Deploy');
  assert.ok(f.left < 3, 'the left edge has all but reached Planning');
  const z = slideFrame(DEPLOY, PLAN, 1, G);
  assert.deepEqual({ left: z.left, width: z.width }, rest(PLAN));
});

test('§3 the name at rest is markup and CSS, one word per step, never a script', () => {
  const body = MAIN.slice(MAIN.indexOf('function phaseIconsHtml'), MAIN.indexOf('function battleStepIndex'));
  assert.match(body, /<span class="phword" aria-hidden="true"><span>\$\{st\.word\}<\/span><\/span>/);
  for (const w of ['Draft', 'Planning', 'Haste', 'Battle', 'Regroup', 'Deploy']) assert.match(body, new RegExp(`word: '${w}'`));
  const CSS = readStyles();
  assert.match(CSS, /\.phicons \.phword \{[^}]*width: 0;[^}]*overflow: hidden;/);
  assert.match(CSS, /\.phicons \.phi\.cur \.phword \{ width: auto; \}/);
});

/* §4 (owner, 2026-11-10: "There should be an equal number of empty pixels from
 * the left of the icon as there are from the right of the last letter. Keep
 * things centered and tight"). The lit box was 3px + the artwork's own margin
 * on the left, a flat 8px on the right. Each icon's clear left margin, from
 * its file under data/icons/ (125-unit viewBox at 18px, so × 18/125): */
const INK: Record<string, number> = {
  draft: 1.6,    // draft.svg: the outlined card's rect at x=16, stroke 10 → ink from 11
  plan: 2.7,     // planning.svg: the clipboard's body at x=19
  haste: 0,      // haste.webp: the chevrons' alpha starts at column 0
  battle1: 2, battle2: 2,  // battle.webp: alpha from column 14
  regroup: .4,   // regroup.svg: the arrowhead at x=5, stroke 5 → ink from 2.5
  deploy: 2,     // deploy.svg: the base bar at x=14
};

test('§4 the lit box is as empty right of the name as left of the icon', () => {
  const CSS = readStyles();
  const px = (re: RegExp): number => { const m = CSS.match(re); assert.ok(m, `no ${re}`); return parseFloat(m![1]!); };
  const cell = px(/\.phicons \.phic \{[^}]*?\bwidth: ([\d.]+)px/);
  const img = px(/\.phicons \.phi img \{ width: ([\d.]+)px/);
  const pad = CSS.match(/\.phicons \.phword > span \{[^}]*padding-right: calc\(([\d.]+)px \+ var\(--phink, 0px\)\)/);
  assert.ok(pad, 'the name\'s right padding is the icon\'s inset plus its artwork\'s margin');
  assert.equal(parseFloat(pad![1]!), (cell - img) / 2, 'the fixed part is the image\'s inset in its cell');
  const body = MAIN.slice(MAIN.indexOf('function phaseIconsHtml'), MAIN.indexOf('function battleStepIndex'));
  const keys = [...body.matchAll(/key: '(\w+)'/g)].map(m => m[1]!);
  assert.deepEqual(keys.slice().sort(), Object.keys(INK).sort(), 'every step is measured');
  for (const k of keys) {
    const m = CSS.match(new RegExp(`\\.phicons \\.phi\\.${k}\\b[^{]*\\{ --phink: ([\\d.]+)px; \\}`))
      ?? CSS.match(new RegExp(`\\.phi\\.${k}\\b[^{]*\\{ --phink: ([\\d.]+)px; \\}`));
    assert.equal(m ? parseFloat(m[1]!) : 0, INK[k], `${k}: the right margin matches the icon's clear left margin`);
  }
});
