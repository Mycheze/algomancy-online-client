/* 1623 — the parts of the Edit tab that follow his typing (pages/cardeditor.ts cardEditorPartHtml):
 * the road line, the pips and the preview.
 *
 * §1 the road line is the server's: the same functions of ui/cardnotation.ts the submit route runs
 * §2 a problem the server would refuse is said, and the button stays off; so does an unlinked Discord
 * §3 the preview is the game's renderer, fed our notation: his w and k draw as light and dark
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardEditorPartHtml, liveRoad, type CardEditorView } from '../pages/cardeditor.ts';
import { changedFields, diffRow, editorFields, oracleValues, road, validateEdit, type EditorFields, type OracleRow } from '../cardnotation.ts';

const ROW: OracleRow = {
  name: 'Murkstalker', power: '2', toughness: '2', cost: 'ld', total_cost: '2', type: 'Cosmic Horror Unit',
  text: 'When you trash another card, [Switch1] Each opponent loses 1 life.', image: 'murk.png',
  complexity: 'Complex', factions: ['light', 'dark'], Deck: 'Light & Dark (Light/Dark)',
};

function view(fields: EditorFields, over: Partial<CardEditorView> = {}): CardEditorView {
  return {
    access: true, tab: 'edit', backLabel: 'Home', isAdmin: false, discordLinked: true, chrome: { signedIn: true, alerts: 0 },
    query: '', picks: [], card: ROW.name, isLoading: false, busy: false,
    row: { card: ROW.name, row: ROW, rowHash: 'h', readOnly: null, open: null }, scanUrl: null,
    fields: { ...editorFields(ROW), ...fields }, current: null, errorMsg: '', edits: null, whenOf: {}, detail: null,
    pictures: { before: null, after: null }, ...over,
  };
}
const roadPart = (f: EditorFields, over: Partial<CardEditorView> = {}): string => cardEditorPartHtml(view(f, over), 'road');
const submitOn = (html: string): boolean => !/data-btn="ce-submit" type="button" disabled/.test(html);

test('1623 §1 the road line runs the server functions on what is on screen', () => {
  for (const f of [{ 'total cost': '3' }, { power: '3', toughness: '1' }, { cost: 'w' }, { image: 'new.png' },
    { text: 'Each opponent loses 2 life.' }, { type: 'Unit — Cosmic Horror Elder' }, { complexity: 'Simple' }] as EditorFields[]) {
    const screen = { ...editorFields(ROW), ...f };
    const server = road(diffRow(ROW, oracleValues(changedFields(ROW, screen))));
    const page = liveRoad(ROW, screen);
    assert.deepEqual([page.road, page.why], [server.road, server.why], JSON.stringify(f));
    assert.deepEqual(page.problems, validateEdit(ROW, screen));
  }
  const fast = roadPart({ 'total cost': '3' });
  assert.match(fast, /<p class="ceroadline ">Live after the tests pass\.<\/p>/);
  assert.ok(submitOn(fast), 'a numbers edit may be sent');
  const steward = roadPart({ text: 'Each opponent loses 2 life.' });
  assert.match(steward, /<p class="ceroadline cesteward">Goes to the steward: the text changed\.<\/p>/);
  assert.ok(submitOn(steward), 'a text edit may be sent, down the other road');
  assert.match(roadPart({}), /Nothing changed\./);
  assert.ok(!submitOn(roadPart({})), 'nothing to send');
});

test('1623 §2 a refusal is said before he presses anything', () => {
  const pipe = roadPart({ text: 'a | b' });
  assert.match(pipe, /<p class="ceroadline cebad">Text can(?:'|&#39;)t contain \|\.<\/p>/);
  assert.ok(!submitOn(pipe));
  assert.match(roadPart({ power: 'two' }), /Power must be a number or X\./);
  const unlinked = roadPart({ 'total cost': '3' }, { discordLinked: false });
  assert.match(unlinked, /Link your Discord on your profile first/);
  assert.ok(!submitOn(unlinked), 'the bot could not match his posts');
  assert.match(roadPart({ 'total cost': '3' }, { busy: true }), /data-btn="ce-submit" type="button" disabled>Sending…</);
});

test('1623 §3 the preview and the pips are the game renderer, in our notation', () => {
  const preview = cardEditorPartHtml(view({ text: 'Pay [1wk]: you gain {g}deadly.{/n}Then draw.' }), 'preview');
  assert.match(preview, /src="\/data\/icons\/cost_1\.webp"[^>]*><img class="txticon" src="\/data\/icons\/light\.webp"[^>]*><img class="txticon" src="\/data\/icons\/dark\.webp"/,
    'his w and k are drawn as light and dark');
  assert.match(preview, /<span class="kw kw-g">deadly<\/span>/);
  assert.match(preview, /<br>Then draw\./, 'a break after a sentence is kept, as the game keeps it');
  assert.doesNotMatch(preview, /\[1wk\]|\{g\}/, 'no markup reaches the preview');
  const pips = cardEditorPartHtml(view({ 'total cost': '3', cost: 'wwr' }), 'pips');
  assert.deepEqual([...pips.matchAll(/icons\/(\w+)\.webp/g)].map(m => m[1]), ['cost_3', 'light', 'light', 'fire']);
  assert.equal(cardEditorPartHtml(view({ 'total cost': '', cost: 'zz' }), 'pips'), '', 'nothing drawn for letters that are not pips');
  assert.equal(cardEditorPartHtml(view({}), 'picks'), '', 'no picks with an empty box');
});
