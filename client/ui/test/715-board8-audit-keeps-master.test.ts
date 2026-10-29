/* BOARD ROUND 8 — THE AUDIT (owner, 2026-10-27, at the second review: "Why
 * are opponent's units on the wrong side of the board? Why did you undo a
 * bunch of UI stuff that I didn't mention?"). The round may change only what
 * the owner asked for; everything else looks as it did before the round.
 * This pins the things the first pass changed without being asked, put
 * back:
 *
 * §1 their In Play packs from the RIGHT edge — mine rotated 180°, as their
 *    In Play stood in the right half before the round — their token corner
 *    at the left
 * §2 the name and life, the opponent's card backs and the hand count are the
 *    old block's sizes, not "a notch smaller"
 * §3 the bin's and cache's label is the plain zone label — beside the
 *    thumbs on a wide line, above them on a narrow one — never a pill laid
 *    on the cards, and an empty one is not a dashed box
 * §4 the resources are the old 30px cards, the mana AFTER them on one line
 *    with the activations ("6 mana open · 2 activations") on a wide line
 * §5 a battle band's numbers are the old ones (BAND 80 / 44), and an idle
 *    battle block collapses only outside a battle
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';
import { BAND } from '../layout.ts';
import { client } from './ui-driver.ts';

const read = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const CSS = read('../style.css');
const ui = await client();
const paint = (s: GameState, seat: Seat = 0): string => ui.join(s, seat, legalActions(s, seat));

/** the rule for exactly this selector, at the top level of the sheet */
const rule = (sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`).exec(CSS);
  assert.ok(m, `no rule for ${sel}`);
  return m[1]!;
};

test('§1 their In Play starts at the seam, their token corner at the left', () => {
  // owner, 2026-10-29: their units hugged the far edge and were easy to miss —
  // they start where their side of the board begins (ui/layout.ts theirLead)
  // and fill rightward; the lead before the first card gives way as the row grows
  assert.match(rule('.lplay.theirs .regionmain .zone'), /justify-content: flex-start;/);
  assert.match(rule('.lplay.theirs .regionmain .zone > :first-child'), /margin-left: var\(--lead, 0px\);/);
  const layout = readFileSync(new URL('../layout.ts', import.meta.url), 'utf8');
  assert.match(layout, /Math\.max\(0, Math\.min\(Math\.round\(sr\.left - zr\.left - padL\), Math\.floor\(room - row\)\)\)/,
    'the lead is the distance to the seam, but never more than the row leaves free');
  assert.match(rule('.lplay.theirs'), /flex-direction: row-reverse;/);
  assert.doesNotMatch(rule('.lplay .regionmain .zone'), /justify-content/, 'mine still packs from the left');
});

test('§2 the identity pieces keep the old block\'s sizes', () => {
  assert.match(rule('.linfo .life'), /padding: 3px 12px;/);
  assert.match(rule('.linfo .lifenum'), /font-size: 19px;/);
  assert.match(rule('.linfo .miniback'), /width: 20px; height: 28px; margin-right: -12px;/);
  assert.equal(rule('.linfo .handcount').trim(), 'font-size: 14px; white-space: nowrap;');
});

test('§3 the bin\'s and cache\'s label is the plain zone label, not a pill on the cards', () => {
  const both = rule('.linfo .regionbin > .zonelabel, .linfo .regioncache > .zonelabel');
  assert.doesNotMatch(both, /position: absolute|background|border-radius/);
  assert.doesNotMatch(CSS, /\.cempty[^{]*\{[^}]*dashed/, 'an empty cache is not a dashed box');
  assert.doesNotMatch(CSS, /\.regionbin:has\(\.binempty\)[^{]*\{[^}]*dashed/, 'nor an empty bin');
  // beside the thumbs on a wide line, above them on a narrow one
  assert.match(rule('.linfo .regionbin, .linfo .regioncache'), /grid-template-areas: "lbl fan" "hint fan";/);
  assert.match(CSS, /@container \(max-width: 1100px\) \{[^@]*grid-template-areas: "lbl" "fan" "hint";/);
});

test('§4 the resources: 30px cards, the mana after them, the activations on its line', () => {
  assert.match(CSS, /\n\.linfo \.lres \{ --rcw: 30px; \}/);
  assert.match(rule('.linfo .lresrow'), /gap: 4px 10px;/);
  assert.doesNotMatch(rule('.linfo .lresrow .resmana'), /order/, 'after the resources on a wide line');
  assert.match(rule('.linfo .lresrow .resgroup.wake > .rescard'), /width: calc\(var\(--rcw\) \+ 4px\);/, 'a wake card 4px over the rest, as 34 over 30');
  const h = new Harness(71501);
  const html = paint(structuredClone(h.state));
  const at = html.indexOf('<div class="linfo mine');
  const mana = /<span class="resmana">([\s\S]*?)<\/span>\s*<\/span>/.exec(html.slice(at))?.[1] ?? '';
  const text = mana.replace(/<[^>]+>/g, '');
  assert.match(text, /^\d+ mana open · \d+ activations$/, `one line, as before: "${text}"`);
});

test('§5 the battle bands keep the old numbers; an idle block collapses only outside a battle', () => {
  assert.deepEqual({ ...BAND }, { want: 80, least: 44 });
  assert.match(CSS, /\n\.lboard\.idle \.lfight\.idle \{ padding: 0; min-height: 0; \}/);
  assert.doesNotMatch(CSS, /\n\.lfight\.idle \{ padding: 0; min-height: 0; \}/);
});
