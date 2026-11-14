/* 1042 — THE CUSTOM RULES ON THE DRAFT TAB, DRIVEN (owner, 2026-11-03: "Bring
 * as many things out of the Custom Rules modal as possible. It should only be
 * reserved for changing the default 'value settings' (life, hand/pack size,
 * etc). And 'beginner mode' should be an easier to reach toggle on the start a
 * room panel.").
 *
 * The home screen is painted by the real ui/main.ts and clicked through its
 * real handler; the Create button's request is read off a stubbed fetch.
 *
 * §1 Beginner is one click on the Alternate modes row (the Mode row until
 *    2026-11-14): it sends exactly the Beginner
 *    rules with Fire + Wood fixed, the Elements row shows the pair picked now,
 *    and the row says what Beginner is
 * §2 a ban on top of Beginner keeps it Beginner (derived from the rules, not
 *    remembered); Standard, from Beginner, is the standard game again — a
 *    plain GET, the elements chosen in the room
 * §3 Standard clicked while already Standard changes nothing (a ban list is
 *    not wiped by a click on the option already showing)
 * §4 the Game values sheet holds the numbers only: no ban, filter, Simple or
 *    Mode control in it; those are on the tab, and its reset touches the
 *    numbers alone
 *
 * Titles carry no apostrophes: ledger guards cite them by substring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
/** every request the page makes, and the answer /api/new gives */
const asked: { url: string; init?: { method?: string; body?: string } }[] = [];
g['__UI_DRIVER_FETCH'] = (url: string, init?: { method?: string; body?: string }) => {
  asked.push({ url, init });
  if (url === '/api/new') return Promise.resolve({ ok: true, json: async () => ({ code: 'NEWR' }) });
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const crp = await import('../customrulespanel.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

/** click Create room and read what it asked /api/new for */
async function create(html: string): Promise<{ method: string; body: Record<string, unknown> | null; search: string }> {
  asked.length = 0;
  const fixed = /data-btn="newgame"[^>]*data-els="1"/.test(html);
  ui.click({ btn: 'newgame', mode: 'draft', ...(fixed ? { els: '1' } : {}) });
  await flush();
  const req = asked.find(a => a.url === '/api/new');
  assert.ok(req, 'Create room asked nothing of /api/new');
  return {
    method: req.init?.method ?? 'GET', body: req.init?.body ? JSON.parse(req.init.body) as Record<string, unknown> : null,
    search: String((g['location'] as { search: string }).search),
  };
}
const modeOn = (h: string): string | null => /data-btn="cr-beginner"[^>]*aria-pressed="true"[^>]*data-on="(\d)"/.exec(h)?.[1] ?? null;
const sheetOf = (h: string): string => h.slice(h.indexOf('<div class="ui-sheet '));
/** ban a card the way a player does: type its name in the Banned box, click the suggestion */
function ban(card: string): string {
  ui.type('cr-ban', card);
  // the suggestions are patched in place while typing (the driver's page does
  // not see an in-place patch); a repaint draws them from the same draft —
  // here the Clock row's Default, which is already on
  ui.click({ btn: 'clockpick', ms: 'auto', clockfor: 'draft' });
  return ui.click({ btn: 'cr-ban', name: card });
}

test('1042 §1 Beginner is one click and sends the Beginner rules with Fire and Wood', async () => {
  let html = ui.html();
  assert.equal(modeOn(html), '0', 'positive control: a first visit is Standard');
  const plain = await create(html);
  assert.equal(plain.method, 'GET', 'positive control: a standard game is a plain GET');
  html = ui.click({ btn: 'cr-beginner', on: '1' });
  assert.equal(modeOn(html), '1', 'Alternate modes reads Beginner');
  assert.match(html, /<span class="homemodehint">The rulebook’s Quick Start: 2 elements, packs of 5, simple cards only\.<\/span>/);
  assert.match(html, /data-btn="home-els"[^>]*aria-pressed="true"[^>]*data-pick="now"/, 'the elements are picked now');
  assert.match(html, /class="elchip fire on"/);
  assert.match(html, /class="elchip wood on"/);
  // Cards, Banned and Game values are behind More settings (2026-11-14), which says they changed
  assert.doesNotMatch(html, /crsimple/, 'positive control: More settings starts shut');
  assert.match(html, /data-btn="home-more"[^>]*>[^]*?>3 changed<\/span><\/button>/, 'shut, it says three settings changed');
  html = ui.click({ btn: 'home-more' });
  assert.match(html, /ui-toggle on crsimple"/, 'Simple cards only is on');
  assert.match(html, /<b>2 elements · Packs of 5<\/b>/, 'the Game values row says what changed');
  const sent = await create(html);
  assert.equal(sent.method, 'POST');
  const rules = sent.body?.['rules'] as Record<string, unknown>;
  assert.equal(rules['elements'], 2);
  assert.equal(rules['packSize'], 5);
  assert.equal(rules['simpleOnly'], true);
  assert.deepEqual(rules['bans'], []);
  assert.deepEqual(sent.body?.['els'], ['fire', 'wood']);
  assert.match(sent.search, /&els=fire%2Cwood/, 'the room is opened with the pair');
});

test('1042 §2 a ban keeps Beginner; Standard from Beginner is the standard game again', async () => {
  const card = DECK_LIST[0]!;
  let html = ban(card);
  assert.equal(modeOn(html), '1', 'a ban on top of Beginner is still Beginner');
  assert.match(html, new RegExp(`<span class="crchip">${card.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} <button data-btn="cr-unban"`), 'the ban is a chip on the tab');
  html = ui.click({ btn: 'cr-beginner', on: '0' });
  assert.equal(modeOn(html), '0');
  assert.equal(crp.activeRules(), null, 'Standard is the standard game: nothing set');
  assert.match(html, /data-btn="home-els"[^>]*aria-pressed="true"[^>]*data-pick="room"/, 'the elements are chosen in the room again');
  assert.match(html, /<span class="dim">Standard values<\/span>/);
  assert.equal((await create(ui.html())).method, 'GET', 'a plain GET again');
});

test('1042 §3 Standard clicked while Standard keeps the bans', () => {
  const card = DECK_LIST[1]!;
  ban(card);
  assert.deepEqual(crp.activeRules()?.bans, [card], 'positive control: banned');
  const html = ui.click({ btn: 'cr-beginner', on: '0' });
  assert.deepEqual(crp.activeRules()?.bans, [card], 'the click on the Standard already showing wiped the bans');
  assert.equal(modeOn(html), '0');
  ui.click({ btn: 'cr-unban', name: card });
  assert.equal(crp.activeRules(), null);
});

test('1042 §4 the Game values sheet holds the numbers only, and its reset touches only them', () => {
  ui.click({ btn: 'cr-simple' });
  ui.click({ btn: 'cr-advanced' });
  let html = ui.click({ btn: 'home-sheet', sheet: 'rules' });
  const sheet = sheetOf(html);
  assert.match(sheet, /<h2[^>]*>Game values<\/h2>/, 'retitled for what it holds');
  assert.equal((sheet.match(/data-btn="cr-step"/g) ?? []).length, 10, 'five values, − and + each');
  for (const not of ['cr-ban', 'cr-unban', 'cr-query', 'cr-simple', 'cr-beginner', 'cr-advanced', 'cr-preset', 'clockpick']) {
    assert.ok(!sheet.includes(`"${not}"`), `${not} is in the Game values sheet`);
  }
  const tab = html.slice(0, html.indexOf('<div class="ui-sheet '));
  for (const id of ['cr-ban', 'cr-query']) assert.match(tab, new RegExp(`id="${id}"`), `#${id} is on the Draft tab`);
  html = ui.click({ btn: 'cr-step', knob: 'startingLife', d: '-1' });
  assert.equal(crp.activeRules()?.startingLife, 25);
  assert.match(html, /<b>Life 25<\/b>/);
  ui.click({ btn: 'cr-values' });
  assert.equal(crp.activeRules()?.startingLife, 30, 'the values are back to the standard ones');
  assert.equal(crp.activeRules()?.simpleOnly, true, 'and Simple cards only was left alone');
  ui.click({ btn: 'cr-simple' });
  ui.click({ btn: 'cr-advanced' });
  ui.click({ btn: 'home-sheet-close' });
  assert.equal(crp.activeRules(), null);
});
