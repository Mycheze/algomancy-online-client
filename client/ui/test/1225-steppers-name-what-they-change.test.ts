/* 1225 · A − / + STEPPER SAYS WHAT IT CHANGES (BL-10, 2026-11-11)
 *
 * The inventory listed it (docs/23-ui-inventory/01 §4 S15): "`.crknob` −/+
 * have `aria-label="fewer"/"more"` without the knob's name". The Game values
 * sheet is a column of five such pairs (Elements, Pack size, Opening hand,
 * Draws per turn, Starting life), so a screen reader read ten buttons as
 * "fewer", "more", "fewer", "more" … and nothing said which number each one
 * moved. The card-stats page's "min games" pair was the same. 1206 could not
 * see it: it asks only that a symbol button HAS a name, and "fewer" is one.
 * The sandbox's mana pair was already right ("One less Fire").
 *
 * The rule: a button whose whole content is − or + (or a minus/plus glyph)
 * has an aria-label with a word in it other than the bare direction words,
 * or a `${…}` that supplies one.
 *
 *   §0  non-vacuity: the detector tells the cases apart, and the steppers are reached
 *   §1  every stepper the client's source writes names what it changes
 *   §2  the Game values sheet and the card-stats page say it, rendered
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UI_COMPONENTS_DIR, UI_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';
import { gameValuesHtml, customRulesView } from '../pages/customrules.ts';

const TPL = String.raw`\$\{(?:[^{}]|\{[^{}]*\})*\}`;
const BUTTON = new RegExp(String.raw`<button\b((?:${TPL}|[^>$]|\$(?!\{))*)>((?:${TPL}|[^$<]|<(?!/button>)|\$(?!\{))*)</button>`, 'g');
const STEP_GLYPH = /^\s*(?:[−+\-–]|&minus;|&plus;|&#8722;)\s*$/;
const BARE = new Set(['fewer', 'more', 'less', 'one', 'minus', 'plus', 'up', 'down', 'increase', 'decrease', 'lower', 'raise']);

/** the opening tag of every − / + button in `markup` whose spoken name does not say what it changes */
function vague(markup: string): string[] {
  const out: string[] = [];
  for (const m of markup.matchAll(BUTTON)) {
    if (!STEP_GLYPH.test(m[2]!)) continue;
    const label = m[1]!.match(new RegExp(String.raw`\baria-label="((?:${TPL}|[^"$]|\$(?!\{))*)"`))?.[1] ?? '';
    if (new RegExp(TPL).test(label)) continue;
    const words = label.toLowerCase().match(/\p{L}+/gu) ?? [];
    if (words.some(w => !BARE.has(w))) continue;
    out.push(`<button${m[1]!.replace(/\s+/g, ' ').slice(0, 100)}>${m[2]!.trim()}`);
  }
  return out;
}

const SOURCES = (): Array<[string, string]> => {
  const read = (dir: string, prefix: string): Array<[string, string]> => readdirSync(dir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map(f => [`${prefix}${f}`, readFileSync(join(dir, f), 'utf8')] as [string, string]);
  return [...read(UI_DIR, ''), ...read(UI_PAGES_DIR, 'pages/'), ...read(UI_COMPONENTS_DIR, 'components/')]
    .map(([f, s]) => [f, s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]);
};

test('§0 non-vacuity: the detector tells the cases apart, and the steppers are reached', () => {
  assert.equal(vague('<button data-d="-1" aria-label="fewer">−</button>').length, 1, 'a bare direction');
  assert.equal(vague('<button aria-label="one more">+</button>').length, 1, 'still only a direction');
  assert.equal(vague('<button>+</button>').length, 1, 'no name at all');
  assert.deepEqual(vague('<button aria-label="Pack size: one less">−</button>'), []);
  assert.deepEqual(vague('<button aria-label="One more ${esc(k)}">+</button>'), [], 'a templated subject');
  assert.deepEqual(vague('<button aria-label="fewer">Fewer cards</button>'), [], 'not a stepper glyph');
  const steppers = SOURCES().reduce((n, [, s]) =>
    n + [...s.matchAll(BUTTON)].filter(m => STEP_GLYPH.test(m[2]!)).length, 0);
  assert.ok(steppers >= 6, `the census found only ${steppers} − / + buttons in the source`);
});

test('§1 every − / + stepper in the client source names what it changes', () => {
  const bad = SOURCES().flatMap(([f, src]) => vague(src).map(c => `${f}: ${c}`));
  assert.deepEqual(bad, [],
    'a − / + button is named only by its direction ("fewer", "more"); a screen reader cannot tell which number it moves. '
    + 'Put the number\'s name in its aria-label, e.g. "Pack size: one less"');
});

test('§2 the Game values sheet and the card-stats stepper say which number they move', async () => {
  const sheet = gameValuesHtml(customRulesView(null));
  for (const name of ['Elements', 'Pack size', 'Opening hand', 'Draws per turn', 'Starting life']) {
    assert.match(sheet, new RegExp(`aria-label="${name}: one less">−</button>`), `${name}'s − says so`);
    assert.match(sheet, new RegExp(`aria-label="${name}: one more">\\+</button>`), `${name}'s + says so`);
  }
  assert.deepEqual(vague(sheet), []);
  const stats = readFileSync(join(UI_PAGES_DIR, 'cardstats.ts'), 'utf8');
  assert.match(stats, /aria-label="Min games: one less">−/);
  assert.match(stats, /aria-label="Min games: one more">\+/);
});
