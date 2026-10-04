/* 366 — #191: THE CLOCK LIVES IN THE OPTIONS, NOT IN A ROW OF ITS OWN.
 *
 * Owner: "The clock setting should be in the custom rules area, not taking up
 * space up above." His settled choice: the clock goes inside Custom rules on
 * the Live draft card AND into a matching small closed "Options" fold on the
 * Constructed card, both sharing the one `algoClockMs` setting, and the row
 * above the cards goes.
 *
 * The hard constraint is the one a careless move breaks silently: a custom
 * rules game COUNTS TOWARD NOTHING, so the clock must not make a game custom.
 * It sits inside the panel as markup the home screen hands in; it never
 * reaches the rules object, `createPayload`, or the "— none set" summary.
 *
 * Driven, not read: the home screen is painted by the real ui/main.ts with no
 * room in the URL, and the chips are clicked through its real handler.
 *
 * Titles carry no apostrophes: ledger guards cite them by substring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
const { home } = await import('./ui-driver.ts');
const crp = await import('../customrulespanel.ts');
const ui = home();

/** the markup of the first element opening with `open`, up to its matching close */
function block(html: string, open: RegExp, tag: string): string {
  const m = open.exec(html);
  if (!m) return '';
  let depth = 0;
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  re.lastIndex = m.index;
  for (let t = re.exec(html); t; t = re.exec(html)) {
    depth += t[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(m.index, t.index + t[0].length);
  }
  return html.slice(m.index);
}
const draftPanel = (h: string): string => block(h, /<details class="customrules"/, 'details');
const consOptions = (h: string): string => block(h, /<details class="fixedtrio homeoptions"/, 'details');
const homegrid = (h: string): string => block(h, /<div class="homegrid"/, 'div');
const onChip = (h: string): string | null => /class="elchip on"\s+data-btn="clockpick" data-ms="([^"]+)"/.exec(h)?.[1] ?? null;
const summary = (h: string): string => /<summary>([^]*?)<\/summary>/.exec(h)?.[1] ?? '';

test('366 the clock chips sit inside the draft custom rules and the constructed options, not above the cards', () => {
  const html = ui.html();
  assert.match(html, /class="homepage"/, 'positive control: the home screen really was painted');
  const grid = homegrid(html);
  assert.ok(grid, 'no homegrid on the home screen');
  // every clock chip on the page is inside the card grid — none in a row above it
  const all = [...html.matchAll(/data-btn="clockpick"/g)].length;
  const inGrid = [...grid.matchAll(/data-btn="clockpick"/g)].length;
  assert.ok(all > 0, 'no clock picker on the home screen at all');
  assert.equal(inGrid, all, 'a clock chip is drawn outside the cards — the row above them is back');

  const panel = draftPanel(html);
  const opts = consOptions(html);
  assert.match(panel, /data-clockpick="draft"/, 'the Live draft custom rules panel has no clock');
  assert.match(opts, /data-clockpick="constructed"/, 'the Constructed card has no Options fold with the clock in it');
  assert.equal(all, [...panel.matchAll(/data-btn="clockpick"/g)].length + [...opts.matchAll(/data-btn="clockpick"/g)].length,
    'a clock chip is somewhere other than the two folds');
  // both folds start closed — the owner said small and out of the way
  assert.match(panel, /^<details class="customrules" data-customrules >/, 'Custom rules must start closed');
  assert.match(opts, /^<details class="fixedtrio homeoptions" data-homeoptions >/, 'Options must start closed');
});

test('366 changing the clock does not make the game custom', () => {
  assert.equal(crp.createPayload(null), null, 'positive control: an untouched panel sends nothing');
  ui.click({ btn: 'clockpick', ms: '0', clockfor: 'draft' });
  assert.equal(localStorage.getItem('algoClockMs'), '0', 'the click did not reach the clock handler');
  assert.equal(crp.createPayload(null), null,
    'turning the clock off made the draft send custom rules — a custom game counts toward nothing');
  assert.equal(crp.activeRules(), null);
  assert.equal(crp.verdict(null).rules, null);
  const html = ui.html();
  const s = summary(draftPanel(html));
  assert.match(s, /none set/, `the Custom rules summary reflects the clock: ${s}`);
  assert.doesNotMatch(s, /clock|⏱|Off/i, `the Custom rules summary mentions the clock: ${s}`);
  assert.match(html, /data-btn="newgame" data-mode="draft"[^>]*>\s*New live draft/,
    'the Create button calls it a custom live draft');
  ui.click({ btn: 'clockpick', ms: 'auto' });
});

test('366 both pickers read and write the one clock setting', () => {
  ui.click({ btn: 'clockpick', ms: 'auto' });
  assert.equal(localStorage.getItem('algoClockMs'), null, 'Default removes the key');
  let html = ui.html();
  assert.equal(onChip(draftPanel(html)), 'auto');
  assert.equal(onChip(consOptions(html)), 'auto');

  // picked from the DRAFT panel, shown in the constructed fold too
  const sixty = String(60 * 60_000);
  ui.click({ btn: 'clockpick', ms: sixty, clockfor: 'draft' });
  html = ui.html();
  assert.equal(localStorage.getItem('algoClockMs'), sixty);
  assert.equal(onChip(draftPanel(html)), sixty);
  assert.equal(onChip(consOptions(html)), sixty, 'the constructed fold shows a different clock from the draft panel');
  assert.match(summary(consOptions(html)), /clock 60m/, 'the closed Options fold does not say which clock is set');

  // picked from the CONSTRUCTED fold, shown in the draft panel too
  ui.click({ btn: 'clockpick', ms: '0', clockfor: 'constructed' });
  html = ui.html();
  assert.equal(onChip(draftPanel(html)), '0');
  assert.equal(onChip(consOptions(html)), '0');
  assert.match(summary(consOptions(html)), /clock off/);
  ui.click({ btn: 'clockpick', ms: 'auto', clockfor: 'constructed' });
  assert.equal(localStorage.getItem('algoClockMs'), null, 'Default from the constructed fold removes the key too');
  assert.match(summary(consOptions(ui.html())), /clock 45m/, 'Default on the constructed card is 45 minutes');
});
