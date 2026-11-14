/* 1244 — AN ELEMENT'S CLASS NAME PAINTS ONLY WHAT IT WAS WRITTEN FOR (BL-10,
 * 2026-11-14; docs/23-ui-inventory/04 §L.2: "`.el-fire … .el-dark {background:
 * var(--…)}` from Card Stats paints the Learn menu's element buttons").
 *
 * Learn to Play's menu (2026-09-18) draws its seven element buttons as
 * `learnel el-<element>`. Card Stats (2026-09-27) then wrote `.el-fire {
 * background: var(--fire) }` and six more, bare, for the bars of its Elements
 * table — and from that day every Learn button was a solid block of its
 * element's colour: the label is 2.2:1 on Metal and 3.0:1 on Water (10.5:1 on
 * the plain button), and the picked one's orange on Fire's red. The
 * accessible mode's ring for those bars landed on
 * the buttons too. Nothing looked: the Learn menu's test reads its markup, card
 * stats' its own page, and neither the stylesheet as a whole.
 *
 * §1 the census: no rule names `.el-<element>` without another class beside it
 *    in the same compound — a bare element name is a class any page may carry
 * §2 the Learn menu, rendered: no rule whose subject is made only of a Learn
 *    element button's own classes gives it a background
 * §3 positive control: the card stats bars are still filled, each its element's colour
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles } from './read-styles.ts';
import { learnMenuHtml, learnMenuView } from '../pages/learn.ts';
import { LEARN_ELEMENTS } from '../lessondeck.ts';

const ELEMENTS = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];
const EL_CLASS = new RegExp(`\\.el-(?:${ELEMENTS.join('|')})(?![\\w-])`);

/** every rule as [selector, body], comments out; an @media's prelude is cut off its first rule */
const rules: [string, string][] = [];
for (const m of readStyles().replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const head = m[1]!.replace(/^[\s\S]*@media[^{]*$/, '').trim();
  for (const sel of head.split(',')) if (sel.trim()) rules.push([sel.trim().replace(/\s+/g, ' '), m[2]!]);
}
/** a selector that is ONE compound — `button.x.on`, `.a.b:hover` — with its pseudo-classes
 * dropped; null for anything with a combinator or an attribute test, which is scoped to
 * something the Learn menu is not inside (or not) and is §1's business, not §2's */
const lone = (sel: string): { tag: string; classes: string[] } | null => {
  if (/[\s>+~\[]/.test(sel)) return null;
  const bare = sel.replace(/::?[\w-]+(\([^)]*\))?/g, '');
  return { tag: /^[a-z*]+/.exec(bare)?.[0] ?? '', classes: (bare.match(/\.[\w-]+/g) ?? []).map(c => c.slice(1)) };
};
const classesOf = (compound: string): string[] => (compound.match(/\.[\w-]+/g) ?? []).map(c => c.slice(1));

test('1244 §1 no rule names an element class (.el-fire …) on its own', () => {
  const named = rules.filter(([sel]) => EL_CLASS.test(sel));
  assert.ok(named.length >= 14, `only ${named.length} rules name an .el-<element> class — the parse is reading nothing`);
  const bare = named
    .filter(([sel]) => sel.split(/[\s>+~]+/).some(part => EL_CLASS.test(part) && classesOf(part).length < 2))
    .map(([sel]) => sel);
  assert.deepEqual(bare, [], 'an .el-<element> class with no owner class beside it paints every element of that name — the Learn menu has seven');
});

test('1244 §2 the Learn menu\'s element buttons get no background from another page\'s rules', () => {
  const html = learnMenuHtml(learnMenuView(null, 'metal'));
  const buttons = [...html.matchAll(/<button class="(learnel [^"]*)"/g)].map(m => m[1]!.split(/\s+/).filter(Boolean));
  assert.equal(buttons.length, LEARN_ELEMENTS.length, 'positive control: every element button is drawn');
  assert.ok(buttons.some(cls => cls.includes('el-metal') && cls.includes('on')), 'positive control: Metal is drawn, and picked');
  for (const cls of buttons) {
    // a rule that is only classes this button carries, on a button or on anything (a bare
    // `button` rule, the base look, names no class and is not counted)
    const painting = rules
      .filter(([sel, body]) => {
        const c = lone(sel);
        return !!c && ['', '*', 'button'].includes(c.tag) && c.classes.length > 0
          && c.classes.every(k => cls.includes(k)) && /(^|;)\s*background(-color)?\s*:/.test(body);
      })
      .map(([sel]) => sel);
    assert.deepEqual(painting, [], `the ${cls.join('.')} button is painted by a rule written for something else`);
  }
});

test('1244 §3 positive control: card stats\' element bars are still filled with their element\'s colour', () => {
  for (const el of ELEMENTS) {
    const hit = rules.find(([sel]) => sel === `.csbarfill.el-${el}`);
    assert.ok(hit, `.csbarfill.el-${el} has a rule`);
    assert.match(hit![1], new RegExp(`background:\\s*var\\(--${el}\\)`), `.csbarfill.el-${el} is filled with --${el}`);
  }
});
