/* 974 — THE CUSTOM RULES PANEL AND THE SINGLE CARD PICKER, DRAWN WITHOUT A PAGE
 * (design-system round, 2026-11-03).
 *
 * Both left their modules for pages/customrules.ts and pages/singlecard.ts as
 * view → pure html; the modules keep the state, the clicks and the in-place
 * typing patches, and their drawn fragments (suggestions, the pool line) come
 * in through the view. Driven here with made-up views, no DOM.
 *
 * The custom rules were one panel in a sheet until 2026-11-03; the owner had
 * them taken apart (only the numbers stay in a sheet), so these are its pieces:
 * §1 standard: Mode on Standard, Simple off, the filter one tap away, no ban chips, every knob at its default
 * §2 with rules: Beginner on, Simple on, a changed knob, a stepper at its bound, a ban chip, the reset live
 * §3 the typing fragments land in their patch targets (the ids wirePanel patches)
 * §4 the single card picker: nothing picked; a card picked, its scan and the no-units warning
 * §5 text is escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEAL_DEFAULTS } from '../../engine/src/draftdeal.ts';
import { bansHtml, cardsHtml, gameValuesHtml, modeHtml, poolLineHtml, type CustomRulesView } from '../pages/customrules.ts';
import { singleCardPickerHtml, type SingleCardPickerView } from '../pages/singlecard.ts';
import type { CustomRules } from '../customrules.ts';

const STANDARD = { ...DEAL_DEFAULTS, simpleOnly: false, query: '', bans: [], preset: null } as unknown as CustomRules;
function rview(over: Partial<CustomRulesView> = {}): CustomRulesView {
  return {
    active: null, rules: STANDARD, summary: [], values: [], beginner: false, advancedOpen: false, banDraft: '',
    deckCount: 528, simpleCount: 300, suggestions: '<!--SLOT:sugg-->', queryNote: 'Same syntax as the 🔍 Cards page.',
    pool: '<!--SLOT:pool-->',
    ...over,
  };
}
function pview(over: Partial<SingleCardPickerView> = {}): SingleCardPickerView {
  return { card: null, art: '', makesUnits: true, copies: 30, draft: '', suggestions: '<!--SLOT:sugg-->', deckCount: 528, ...over };
}
const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);

/** every custom-rules piece, as the Draft tab and the Game values sheet draw them */
const customRulesHtml = (v: CustomRulesView): string =>
  [modeHtml(v), cardsHtml(v), bansHtml(v), poolLineHtml(v), gameValuesHtml(v)].join('\n');

test('974 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  assert.match(customRulesHtml(rview()), /data-btn="cr-step"/);
});

test('974 §1 standard', () => {
  const html = customRulesHtml(rview());
  assert.match(modeHtml(rview()), /class="ui-segmented__option on" data-btn="cr-beginner"[^>]*data-value="standard"[^>]*data-on="0">Standard</);
  assert.match(html, /data-btn="cr-beginner"[^>]*title="[^"]*Quick Start[^"]*" data-on="1">Beginner</);
  assert.match(html, /class="[^"]*crsimple" data-btn="cr-simple" type="button" aria-pressed="false" title="silver-symbol cards only · 300 of 528"/);
  assert.match(html, /data-btn="cr-advanced"[^>]*aria-expanded="false">Card filter…</, 'the filter is one tap away');
  assert.doesNotMatch(html, /id="cr-query"/, 'and its box is not drawn yet');
  assert.doesNotMatch(html, /class="crchip"/, 'no bans');
  assert.doesNotMatch(html, /crknob changed/, 'every knob at its default');
  assert.match(html, /data-btn="cr-values" type="button" disabled>Back to the standard values/);
  for (const b of ['cr-beginner', 'cr-simple', 'cr-step', 'cr-advanced']) assert.ok(btns(html).includes(b), b);
});

test('974 §2 with rules: Beginner, a changed knob, a bound, a ban chip', () => {
  const rules = { ...STANDARD, packSize: 15, simpleOnly: true, bans: ['Ignis Sprite'] } as CustomRules;
  const html = customRulesHtml(rview({ active: rules, rules, beginner: true, values: ['Packs of 15'], summary: ['Packs of 15', 'Simple cards only'] }));
  assert.match(html, /class="ui-segmented__option on" data-btn="cr-beginner"[^>]*data-value="beginner"/);
  assert.match(html, /<div class="crknob changed"><span>Pack size<\/span>/);
  assert.match(html, /data-knob="packSize" data-d="1" disabled/, 'the + stops at the top');
  assert.match(html, /ui-toggle on crsimple" data-btn="cr-simple" type="button" aria-pressed="true"/);
  assert.match(html, /<span class="crchip">Ignis Sprite <button data-btn="cr-unban" data-name="Ignis Sprite"/);
  assert.match(html, /data-btn="cr-values" type="button">Back to the standard values/, 'a value is changed: the reset is live');
});

test('974 §3 the typing fragments in their patch targets', () => {
  const html = customRulesHtml(rview({ advancedOpen: true }));
  assert.match(html, /<span id="cr-bansugg" class="crsugg"><!--SLOT:sugg--><\/span>/);
  assert.match(html, /<div id="cr-pool" class="crpool"><!--SLOT:pool--><\/div>/);
  assert.match(html, /<div id="cr-querynote" class="dim">Same syntax as the 🔍 Cards page\.<\/div>/);
  assert.match(html, /<input id="cr-query" /);
  // a filter in force keeps its box, and offers no button to hide it
  const set = { ...STANDARD, query: 'x' } as CustomRules;
  assert.doesNotMatch(cardsHtml(rview({ rules: set, advancedOpen: true })), /cr-advanced/);
});

test('974 §4 the single card picker', () => {
  const none = singleCardPickerHtml(pview());
  assert.match(none, /no card picked yet/);
  assert.match(none, /<input id="sc-q" aria-label="Find a card" placeholder="find a card…"/);
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
  // (the values summary is drawn by the home page — 960 escapes it)
  const html = customRulesHtml(rview({ active: rules, rules, advancedOpen: true, banDraft: '"<', queryNote: '<n>' }));
  assert.doesNotMatch(html, /<x>|<n>/);
  for (const t of ['&lt;x&gt;', '&lt;n&gt;', '<span class="crchip">&lt;b&gt;']) assert.ok(html.includes(t), t);
  assert.match(html, /value="&quot;&lt;"/);
  assert.match(singleCardPickerHtml(pview({ card: '<c>', draft: '"' })), /&lt;c&gt;[\s\S]*value="&quot;"/);
});
