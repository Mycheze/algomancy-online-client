/* 974 — THE CUSTOM RULES PANEL AND THE SINGLE CARD PICKER, DRAWN WITHOUT A PAGE
 * (design-system round, 2026-11-03).
 *
 * Both left their modules for pages/customrules.ts and pages/singlecard.ts as
 * view → pure html; the modules keep the state, the clicks and the in-place
 * typing patches, and their drawn fragments (suggestions, the pool line) come
 * in through the view. Driven here with made-up views, no DOM.
 *
 * §1 the panel closed and standard: none set, Back to standard disabled, every knob at its default
 * §2 the panel open with rules: the summary, a changed knob, a stepper at its bound, a banned chip
 * §3 the extra (the clock picker) and the typing fragments land where they did
 * §4 the single card picker: nothing picked; a card picked, its scan and the no-units warning
 * §5 text is escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEAL_DEFAULTS } from '../../engine/src/draftdeal.ts';
import { customRulesHtml, type CustomRulesView } from '../pages/customrules.ts';
import { singleCardPickerHtml, type SingleCardPickerView } from '../pages/singlecard.ts';
import type { CustomRules } from '../customrules.ts';

const STANDARD = { ...DEAL_DEFAULTS, simpleOnly: false, query: '', bans: [], preset: null } as unknown as CustomRules;
function rview(over: Partial<CustomRulesView> = {}): CustomRulesView {
  return {
    open: false, active: null, rules: STANDARD, summary: [], advancedOpen: false, banDraft: '',
    deckCount: 528, simpleCount: 300, suggestions: '<!--SLOT:sugg-->', queryNote: 'Same syntax as the 🔍 Cards page.',
    pool: '<!--SLOT:pool-->', extra: '<!--SLOT:clock-->',
    ...over,
  };
}
function pview(over: Partial<SingleCardPickerView> = {}): SingleCardPickerView {
  return { card: null, art: '', makesUnits: true, copies: 30, draft: '', suggestions: '<!--SLOT:sugg-->', deckCount: 528, ...over };
}
const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);

test('974 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  assert.match(customRulesHtml(rview()), /^<details class="customrules" data-customrules >/);
});

test('974 §1 closed and standard', () => {
  const html = customRulesHtml(rview());
  assert.match(html, /Custom rules <span class="dim">— none set<\/span>/);
  assert.match(html, /data-btn="cr-preset" type="button" title="[^"]*Quick Start[^"]*" data-preset="beginner">🌱 Beginner/);
  assert.match(html, /data-btn="cr-preset" type="button" disabled data-preset="standard">Back to standard/);
  assert.doesNotMatch(html, /crknob changed/, 'every knob at its default');
  assert.match(html, /silver-symbol cards · 300 of 528/);
  assert.match(html, /<span class="dim">none<\/span>/, 'no bans');
  for (const b of ['cr-preset', 'cr-simple', 'cr-step']) assert.ok(btns(html).includes(b), b);
});

test('974 §2 open with rules: the summary, a changed knob, a bound, a ban chip', () => {
  const rules = { ...STANDARD, packSize: 15, simpleOnly: true, bans: ['Ignis Sprite'] } as CustomRules;
  const html = customRulesHtml(rview({ open: true, active: rules, rules, summary: ['Packs of 15', 'Simple cards only'] }));
  assert.match(html, /data-customrules open>/);
  assert.match(html, /Custom rules · <b>Packs of 15 · Simple cards only<\/b>/);
  assert.match(html, /<div class="crknob changed"><span>Pack size<\/span>/);
  assert.match(html, /data-knob="packSize" data-d="1" disabled/, 'the + stops at the top');
  assert.match(html, /class="crsimple on" data-btn="cr-simple" aria-pressed="true"/);
  assert.match(html, /<span class="crchip">Ignis Sprite <button data-btn="cr-unban" data-name="Ignis Sprite"/);
  assert.doesNotMatch(html, /disabled data-preset="standard"/, 'rules are set: Back to standard is live');
});

test('974 §3 the clock picker on top; the typing fragments in their patch targets', () => {
  const html = customRulesHtml(rview({ advancedOpen: true }));
  assert.ok(html.indexOf('<!--SLOT:clock-->') < html.indexOf('class="crpresets"'), 'the clock is above the presets');
  assert.match(html, /<div id="cr-bansugg" class="crsugg"><!--SLOT:sugg--><\/div>/);
  assert.match(html, /<div id="cr-pool" class="crpool"><!--SLOT:pool--><\/div>/);
  assert.match(html, /<div id="cr-querynote" class="dim">Same syntax as the 🔍 Cards page\.<\/div>/);
  assert.match(html, /<details class="cradvanced" open>/);
});

test('974 §4 the single card picker', () => {
  const none = singleCardPickerHtml(pview());
  assert.match(none, /no card picked yet/);
  assert.match(none, /<input id="sc-q" placeholder="find a card…"/);
  assert.match(none, /class="ui-button ui-button--icon" data-btn="sc-random" type="button" title="any card at random — any of the 528" aria-label="[^"]+">🎲</);
  assert.match(none, /<div id="sc-sugg" class="crsugg"><!--SLOT:sugg--><\/div>/);
  const picked = singleCardPickerHtml(pview({ card: 'Ignis Sprite', art: '<!--SLOT:art-->' }));
  assert.match(picked, /<span class="scart" data-prev="Ignis Sprite"><!--SLOT:art--><\/span>/);
  assert.match(picked, /<b>Ignis Sprite<\/b><span class="dim">× 30<\/span>/);
  assert.doesNotMatch(picked, /scwarn/);
  assert.match(singleCardPickerHtml(pview({ card: 'Some Spell', makesUnits: false })), /class="scwarn"[^>]*>makes no units/);
});

test('974 §5 text is escaped', () => {
  const rules = { ...STANDARD, query: '"><x>', bans: ['<b>'] } as CustomRules;
  const html = customRulesHtml(rview({ active: rules, rules, summary: ['<s>'], banDraft: '"<', queryNote: '<n>' }));
  assert.doesNotMatch(html, /<x>|<s>|<n>/);
  for (const t of ['&lt;x&gt;', '&lt;s&gt;', '&lt;n&gt;', '<span class="crchip">&lt;b&gt;']) assert.ok(html.includes(t), t);
  assert.match(html, /value="&quot;&lt;"/);
  assert.match(singleCardPickerHtml(pview({ card: '<c>', draft: '"' })), /&lt;c&gt;[\s\S]*value="&quot;"/);
});
