/* 366 — #191: THE CLOCK IS A ROOM SETTING, NOT A ROW OF ITS OWN — AND NEVER A CUSTOM RULE.
 *
 * Owner, #191: "The clock setting should be in the custom rules area, not
 * taking up space up above." Until 2026-11-03 it sat inside Custom rules on the
 * Live draft card and in a small closed "Options" fold on the Constructed card.
 *
 * New home layout, docs/24, 2026-11-03: the Play card's settings are rows
 * (Clock, Elements, Custom rules… for a draft; Format, Clock, Deck for
 * constructed), so the clock is the Clock ROW of whichever tab is showing and
 * Custom rules is a sheet of its own without it (the decisions record,
 * var/records/ds-round-2026-11-03-home-decisions.md). It still takes no space
 * above the card, and both tabs still share the one `algoClockMs` setting.
 *
 * The hard constraint is the one a careless move breaks silently: a custom
 * rules game COUNTS TOWARD NOTHING, so the clock must not make a game custom.
 * It never reaches the rules object, `createPayload`, or the rules summary.
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
const playCard = (h: string): string => block(h, /<section class="homeplay"/, 'section');
const clockRow = (h: string): string => block(h, /<div class="clockpick clockpick--seg"/, 'div');
const onChip = (h: string): string | null =>
  /class="ui-segmented__option on" data-btn="clockpick" type="button" data-value="([^"]+)"/.exec(h)?.[1] ?? null;
const rulesRow = (h: string): string => /<span class="homerulessum">([^]*?)<\/span>\s*<button/.exec(h)?.[1] ?? '';

test('366 the clock chips are the Play card Clock row, and Custom rules has none', () => {
  let html = ui.html();
  assert.match(html, /class="ui-app-shell homepage"/, 'positive control: the home screen really was painted');
  const play = playCard(html);
  assert.ok(play, 'no Play card on the home screen');
  const all = [...html.matchAll(/data-btn="clockpick"/g)].length;
  assert.equal(all, 4, 'Default, Off, 45m and 60m — once');
  assert.equal([...play.matchAll(/data-btn="clockpick"/g)].length, all, 'a clock chip is drawn outside the Play card');
  assert.match(clockRow(play), /data-clockpick="draft"/, 'the Draft tab draws the draft clock');
  assert.match(play, /<div class="homerowlabel">Clock<\/div>/, 'under its own label');

  // the Custom rules sheet: the rules, and no clock
  html = ui.click({ btn: 'home-sheet', sheet: 'rules' });
  const sheet = block(html, /<div class="ui-sheet /, 'div');
  assert.match(sheet, /data-customrules/, 'positive control: the Custom rules sheet opened');
  assert.doesNotMatch(sheet, /data-btn="clockpick"/, 'the clock is back inside Custom rules');
  ui.click({ btn: 'home-sheet-close' });

  // the Constructed tab draws its own, and only its own
  html = ui.click({ btn: 'home-mode', mode: 'constructed' });
  assert.match(clockRow(playCard(html)), /data-clockpick="constructed"/);
  assert.equal([...html.matchAll(/data-btn="clockpick"/g)].length, 4);
  ui.click({ btn: 'home-mode', mode: 'draft' });
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
  const s = rulesRow(html);
  assert.match(s, /None/, `the Custom rules row reflects the clock: ${s}`);
  assert.doesNotMatch(s, /clock|⏱|Off/i, `the Custom rules row mentions the clock: ${s}`);
  assert.match(html, /data-btn="newgame" type="button" data-mode="draft">Create room</,
    'the Create button calls it a custom room');
  ui.click({ btn: 'clockpick', ms: 'auto' });
});

test('366 both tabs read and write the one clock setting', () => {
  ui.click({ btn: 'clockpick', ms: 'auto' });
  assert.equal(localStorage.getItem('algoClockMs'), null, 'Default removes the key');
  let html = ui.html();
  assert.equal(onChip(clockRow(html)), 'auto');
  assert.match(clockRow(html), /60m each/, 'Default on a draft is 60 minutes');

  // picked on the DRAFT tab, shown on the Constructed tab too
  const sixty = String(60 * 60_000);
  ui.click({ btn: 'clockpick', ms: sixty, clockfor: 'draft' });
  assert.equal(localStorage.getItem('algoClockMs'), sixty);
  assert.equal(onChip(clockRow(ui.html())), sixty);
  html = ui.click({ btn: 'home-mode', mode: 'constructed' });
  assert.equal(onChip(clockRow(html)), sixty, 'the Constructed tab shows a different clock from the Draft tab');

  // picked on the CONSTRUCTED tab, shown on the Draft tab too
  ui.click({ btn: 'clockpick', ms: '0', clockfor: 'constructed' });
  assert.match(clockRow(ui.html()), /no clock — nobody can lose on time/);
  html = ui.click({ btn: 'home-mode', mode: 'draft' });
  assert.equal(onChip(clockRow(html)), '0');
  ui.click({ btn: 'home-mode', mode: 'constructed' });
  ui.click({ btn: 'clockpick', ms: 'auto', clockfor: 'constructed' });
  assert.equal(localStorage.getItem('algoClockMs'), null, 'Default from the Constructed tab removes the key too');
  assert.match(clockRow(ui.html()), /45m each/, 'Default on the Constructed tab is 45 minutes');
  ui.click({ btn: 'home-mode', mode: 'draft' });
});
