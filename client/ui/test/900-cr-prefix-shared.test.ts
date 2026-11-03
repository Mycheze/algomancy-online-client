/* Two features share the `cr` prefix — the rules review page (crreview.ts,
 * crlayer.ts) and the home screen's Custom rules panel (customrulespanel.ts) —
 * and twice one swallowed the other. Part 1: the BUTTON names. Part 2: the
 * CLASS `.crchip`.
 *
 * ── 1. the `cr-` button prefix: the review page may only claim what it draws
 *
 * Two features spell their buttons `cr-…`: the rules review page (crreview.ts,
 * cr-close, cr-tab, …) and the home screen's Custom rules panel
 * (customrulespanel.ts, cr-ban, cr-step, cr-simple, …). main.ts hands a click
 * to crreview.handleButton BEFORE the panel's handler, and that function used
 * to end its switch with `default: return true` — so it claimed every cr-
 * button, and from 2026-10-10 to 2026-11-02 not one button of the Custom
 * rules panel did anything in a real browser. test/298 never noticed: it calls
 * the panel's handler directly and never goes through the dispatch.
 *
 * So: every data-btn the panel draws must be REFUSED by crreview's handler
 * (it returns false, and main.ts goes on to the panel), and the panel's own
 * handler must still take each of them.
 *
 * ── 2. The banned-card chip and the rules review's selection chip are two classes.
 *
 * Both used to be `.crchip`: the Custom rules panel's banned cards
 * (customrulespanel.ts) and the "💬 Comment" chip the rules review page floats
 * at the end of a text selection (crlayer.ts). The second rule is
 * `position: fixed`, and it applied to both — so every banned card was drawn
 * in one fixed spot, on top of each other and over the ban box. The selection
 * chip is `.crselchip` now; `.crchip` is the panel's alone and stays in flow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStyles } from './read-styles.ts';

import { handleButton as reviewHandles } from '../crreview.ts';
import { handlePanelButton } from '../customrulespanel.ts';

// the panel's module and its page (pages/customrules.ts, its markup since the
// design-system round, 2026-11-03); a button() component names its data-btn as `dataBtn: '…'`
const panelSrc = readFileSync(new URL('../customrulespanel.ts', import.meta.url), 'utf8')
  + readFileSync(new URL('../pages/customrules.ts', import.meta.url), 'utf8');
const panelButtons = [...new Set([...panelSrc.matchAll(/(?:data-btn="|dataBtn: ')(cr-[\w-]+)["']/g)].map(m => m[1]!))];

const stub = (btn: string, data: Record<string, string> = {}): HTMLElement =>
  ({ dataset: { btn, ...data } }) as unknown as HTMLElement;

test('the Custom rules panel draws cr- buttons (positive control)', () => {
  for (const b of ['cr-ban', 'cr-unban', 'cr-step', 'cr-simple', 'cr-preset']) {
    assert.ok(panelButtons.includes(b), `the panel draws ${b}`);
  }
});

test('the rules review handler refuses every button the Custom rules panel draws', () => {
  for (const b of panelButtons) {
    assert.equal(reviewHandles(stub(b)), false, `crreview.handleButton swallowed the panel's ${b}`);
  }
});

test('and refuses any cr- name it does not draw', () => {
  assert.equal(reviewHandles(stub('cr-nothing-draws-this')), false);
});

test('the panel itself still takes each of its buttons', () => {
  for (const b of panelButtons) {
    const data: Record<string, string> = b === 'cr-step' ? { knob: 'packSize', d: '1' } : b === 'cr-preset' ? { preset: 'standard' } : { name: 'Abduct' };
    assert.equal(handlePanelButton(b, stub(b, data)), true, `the panel does not handle ${b}`);
  }
  handlePanelButton('cr-preset', stub('cr-preset', { preset: 'standard' }));
});

// ── 2. the chip class ──

const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
const src = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
/** the declarations of every rule whose selector list names exactly this class */
const rulesFor = (cls: string): string[] =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(m => m[1]!.split(',').some(s => new RegExp(`\\.${cls}(?![\\w-])`).test(s.trim()) && !/\s/.test(s.trim().replace(/:.*$/, ''))))
    .map(m => m[2]!);

test('the Custom rules panel draws its banned cards as .crchip', () => {
  assert.match(src('pages/customrules.ts'), /<span class="crchip">/);   // its markup since 2026-11-03
  assert.ok(rulesFor('crchip').length >= 1, 'positive control: the panel chip has a rule');
});

test('no .crchip rule takes the chip out of the flow', () => {
  for (const body of rulesFor('crchip')) assert.doesNotMatch(body, /position\s*:\s*(fixed|absolute)/, body.trim());
});

test('the rules review selection chip is its own class, and that one is fixed', () => {
  assert.match(src('crlayer.ts'), /<button class="crselchip" data-crl="chip"/);
  assert.doesNotMatch(src('crlayer.ts'), /class="crchip"/);
  assert.ok(rulesFor('crselchip').some(b => /position\s*:\s*fixed/.test(b)));
});
