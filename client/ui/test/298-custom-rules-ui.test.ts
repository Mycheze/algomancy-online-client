/* BL-43 — custom rules in the browser: the home-screen panel, the lobby, the
 * match history, the prompt and the help.
 *
 * The owner's picture was Smash Bros Brawl: a normal game says nothing, and
 * the settings are there for whoever goes looking. So §1 is that untouched
 * rules send NOTHING — a standard game is the same plain GET /api/new it
 * always was — and only then what they send once something changes.
 *
 * Since 2026-11-03 the panel is taken apart (owner: the modal "should only be
 * reserved for changing the default 'value settings'"): Mode, Cards and
 * Banned are rows of the home's Draft tab and the numbers a Game values sheet
 * (pages/customrules.ts). The markup pins below follow the pieces; what is
 * SENT is unchanged and is what §1–§5 hold to.
 *
 * Titles carry no apostrophes: ledger guards cite them by substring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPayload, elementCount, handlePanelButton, verdict } from '../customrulespanel.ts';
import { bansHtml, cardsHtml, customRulesView, gameValuesHtml, modeHtml, poolLineHtml } from '../pages/customrules.ts';
import { lobbyHtml as drawLobby, lobbyView, type LobbyArgs } from '../pages/lobby.ts';
import { customTag, historyRowsHtml, type MatchRow } from '../account.ts';
import { RULES_SECTIONS } from '../rules.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

// the rules' markup is pages/customrules.ts's pieces (2026-11-03): all of them, in the Draft tab's order
const panelHtml = (fixed: readonly string[] | null): string => {
  const v = customRulesView(fixed);
  return [modeHtml(v), cardsHtml(v), bansHtml(v), poolLineHtml(v), gameValuesHtml(v)].join('\n');
};
const click = (b: string, data: Record<string, string> = {}): boolean =>
  handlePanelButton(b, { dataset: data } as unknown as HTMLElement);
const reset = (): void => { click('cr-preset', { preset: 'standard' }); };

// §1 runs FIRST and clicks nothing: the module's untouched state
test('BL-43 ui §1 untouched rules are the standard game and send nothing', () => {
  const html = panelHtml(null);
  assert.match(html, /class="ui-segmented__option on" data-btn="cr-beginner"[^>]*data-on="0">Standard</, 'Mode reads Standard');
  assert.equal(createPayload(null), null, 'a standard game is a plain GET — no rules are sent');
  assert.equal(verdict(null).rules, null);
  assert.equal(elementCount(), 3);
});

test('BL-43 ui §2 the Beginner preset sends two elements, simple cards and packs of 5', () => {
  reset();
  assert.ok(click('cr-preset', { preset: 'beginner' }));
  const payload = createPayload(['wood', 'fire']);
  assert.ok(payload);
  assert.equal(payload.rules.elements, 2);
  assert.equal(payload.rules.packSize, 5);
  assert.equal(payload.rules.simpleOnly, true);
  assert.deepEqual(payload.els, ['fire', 'wood'], 'the fixed pair, canonical order');
  assert.equal(elementCount(), 2, 'the home screen fixed pick now wants two');
  assert.equal(verdict(['fire', 'wood']).error, undefined);
  const html = panelHtml(['fire', 'wood']);
  assert.match(html, /class="ui-segmented__option on" data-btn="cr-beginner"[^>]*data-on="1">Beginner</, 'Mode reads Beginner');
  assert.match(html, /ui-toggle on crsimple"/, 'Simple cards only shows as on');
  assert.match(html, /<div class="crknob changed"><span>Pack size <i class="crchanged"[\s\S]*?<b>5<\/b>/);
  reset();
  assert.equal(createPayload(null), null, 'Back to standard sends nothing again');
});

test('BL-43 ui §3 Simple cards only is its own control, apart from the advanced filter', () => {
  reset();
  const html = panelHtml(null);
  const simple = html.indexOf('data-btn="cr-simple"');
  const advanced = html.indexOf('data-btn="cr-advanced"');
  assert.ok(simple > 0 && advanced > simple, 'the toggle is drawn, and before the card filter');
  click('cr-advanced');
  const open = panelHtml(null);
  const box = open.indexOf('class="cradvanced"');
  assert.ok(box > 0, 'positive control: the card filter box opened');
  assert.ok(!open.slice(box).includes('cr-simple'), 'the toggle is not inside the filter');
  click('cr-advanced');
  click('cr-simple');
  assert.equal(createPayload(null)?.rules.simpleOnly, true);
  assert.equal(createPayload(null)?.rules.query, '', 'turning it on writes no card filter');
  reset();
});

test('BL-43 ui §4 steppers move a knob, stop at its bounds, and a refused pool says why', () => {
  reset();
  click('cr-step', { knob: 'packSize', d: '-1' });
  assert.equal(createPayload(null)?.rules.packSize, 9);
  for (let i = 0; i < 20; i++) click('cr-step', { knob: 'packSize', d: '1' });
  assert.equal(createPayload(null)?.rules.packSize, 15, 'clamped at the top');
  assert.match(panelHtml(null), /data-knob="packSize" data-d="1" disabled/);
  click('cr-step', { knob: 'elements', d: '-1' });
  click('cr-simple');
  const v = verdict(null);
  assert.ok(v.error, 'two elements, simple cards, packs of 15 is refused');
  assert.match(panelHtml(null), /class="crbad">✗/);
  reset();
});

test('BL-43 ui §5 a banned card is a removable chip', () => {
  reset();
  const name = 'Not A Card';
  click('cr-ban', { name });
  assert.equal(createPayload(null), null, 'an unknown name bans nothing');
  const real = DECK_LIST[0]!;
  click('cr-ban', { name: real });
  assert.deepEqual(createPayload(null)?.rules.bans, [real]);
  assert.match(panelHtml(null), new RegExp(`data-btn="cr-unban" data-name="${real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  click('cr-unban', { name: real });
  assert.equal(createPayload(null), null);
});

// the lobby's markup is pages/lobby.ts since the design-system round (2026-11-03)
const lobbyHtml = (a: LobbyArgs): string => drawLobby(lobbyView(a));
const LOBBY: LobbyArgs = {
  lobby: { method: 'pick-one', count: 2, methods: [{ id: 'pick-one', label: 'One each', blurb: 'b' }], locked: [false, false], mine: {} },
  seat: 0, names: ['Ann', 'Bob'], peers: [true, true], room: 'ABCD', link: 'http://x/?ws=1&room=ABCD&seat=1&mode=draft',
};

test('BL-43 ui §6 the lobby shows both seats the rules, and a pair lobby talks about a pair', () => {
  const html = lobbyHtml({ ...LOBBY, custom: { summary: ['2 elements', 'Packs of 5'], excluded: 192 } });
  // the room's kind is the app frame's toolbar title since 2026-11-04 (pages/lobby.ts roomFrameHtml)
  assert.match(html, /<h1 class="frametitle">Custom live draft<small>room/);
  assert.match(html, /class="lobbycustom"/);
  assert.match(html, /<li>Packs of 5<\/li>/);
  assert.match(html, /192 cards left out/);
  assert.match(html, /How should the pair be chosen\?/);
  const plain = lobbyHtml({ ...LOBBY, lobby: { ...LOBBY.lobby, count: undefined } });
  assert.ok(!plain.includes('lobbycustom'), 'a standard lobby has no rules panel');
  assert.match(plain, /How should the trio be chosen\?/);
});

const row = (extra: Partial<MatchRow> = {}): MatchRow => ({
  code: 'ABCD', playedAt: '2026-09-14T12:00:00.000Z', mode: 'draft', els: ['fire', 'wood'], turns: 6,
  deckId: null, finished: true, diverged: false, result: 'win', opponent: 'Bob', opponentId: null,
  life: [12, 0], unitsPlayed: 3, spellsPlayed: 2, damageDealt: 30, favoriteElement: 'fire', ...extra,
});

test('BL-43 ui §7 a custom row in the match history says it was not counted', () => {
  assert.equal(customTag(row()), '');
  const tagged = historyRowsHtml([row({ custom: ['2 elements', 'Simple cards only'] })]);
  assert.match(tagged, /custom · not counted/);
  assert.match(tagged, /2 elements · Simple cards only/);
  assert.ok(!historyRowsHtml([row()]).includes('custom'), 'a standard row carries no tag');
});

test('BL-43 ui §8 the draft prompt names the real pack size and no share link carries rules', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  assert.match(main, /leave exactly \$\{s\.draftDeal\?\.packSize \?\? 10\} cards/);
  assert.ok(!/leave exactly 10 cards/.test(main), 'no prompt still says 10');
  const links = [...main.matchAll(/\?ws=1&room=[^`'"]*/g)].map(m => m[0]);
  assert.ok(links.length >= 3, `non-vacuous: ${links.length} room links found`);
  for (const link of links) assert.ok(!/rules|custom/.test(link), `a room link carries rules: ${link}`);
});

test('BL-43 ui §9 the rules help has a Custom rules entry', () => {
  const formats = RULES_SECTIONS.find(s => s.id === 'formats');
  const entry = formats?.entries.find(e => e.title === 'Custom rules');
  assert.ok(entry, 'Drafting and formats lists Custom rules');
  assert.match(String(entry.body), /Beginner/);
  assert.match(String(entry.body), /counts toward no stats/);
});
