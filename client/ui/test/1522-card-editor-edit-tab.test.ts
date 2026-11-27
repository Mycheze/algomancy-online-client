/* 1522 — the card editor's Edit tab, drawn from made-up views with no DOM (pages/cardeditor.ts).
 *
 * §0 no DOM; the frame with `cepage` last, the two tabs in the toolbar, Back by where it came from
 * §1 the refusal and the empty page
 * §2 the form: his notation, a unit's type as Unit with no Creature, power and toughness only on a
 *    unit, complexity only Simple or Complex, values never trimmed
 * §3 a read-only card shows why and no form; an edit in progress shows its commands and status
 * §4 drawn with components only: no hand-written ui- class, no colour literal
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardEditorHtml, type CardEditorView, type EditDetail } from '../pages/cardeditor.ts';
import { editorFields, type OracleRow } from '../cardnotation.ts';

const UNIT: OracleRow = {
  name: 'Murkstalker', power: '2', toughness: '2', cost: 'ld', total_cost: '2', type: 'Cosmic Horror Unit',
  text: 'When you trash another card,  [Switch1] Each opponent loses 1 life and you gain [1d].', image: 'images_out/Stable/murk3.png',
  complexity: 'Complex', factions: ['light', 'dark'], Deck: 'Light & Dark (Light/Dark)',
};
const SPELL: OracleRow = {
  name: 'Firebolt', power: '', toughness: '', cost: 'r', total_cost: '1', type: '{Battle} Spell',
  text: 'Deal 3 damage.', image: 'bolt.png', complexity: 'Common', factions: ['fire'], Deck: 'Fire',
};

function view(row: OracleRow | null, over: Partial<CardEditorView> = {}): CardEditorView {
  return {
    access: true, tab: 'edit', backLabel: 'Home', isAdmin: false, discordLinked: true,
    chrome: { signedIn: true, alerts: 0 }, query: '', picks: [], card: row?.name ?? null, isLoading: false, busy: false,
    row: row ? { card: row.name, row, rowHash: 'h', readOnly: null, open: null } : null,
    scanUrl: row ? `/data/cards/${row.name}.webp` : null, fields: row ? editorFields(row) : {}, current: null, errorMsg: '',
    edits: null, whenOf: {}, detail: null, pictures: { before: null, after: null }, ...over,
  };
}
const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);
const valueOf = (html: string, id: string): string | undefined =>
  new RegExp(`id="${id}"[^>]*value="([^"]*)"`).exec(html)?.[1] ?? new RegExp(`value="([^"]*)"[^>]*id="${id}"`).exec(html)?.[1];

test('1522 §0 the frame, its tabs and the way back', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  const html = cardEditorHtml(view(UNIT));
  assert.match(html, /^<div class="ui-app-shell ui-app-shell--contained ui-app-shell--fill apppage cepage">/);
  assert.match(html, /<h1 class="frametitle">Card editor<\/h1>/);
  assert.match(html, /data-btn="ce-tab"[^>]*data-tab="edit">Edit</);
  assert.match(html, /data-btn="ce-tab"[^>]*data-tab="mine">My edits</);
  assert.match(html, /data-btn="ce-close"[\s\S]*?<span class="ui-icon-button__label">Home<\/span>/);
  assert.match(cardEditorHtml(view(UNIT, { backLabel: 'Cards' })), /data-btn="ce-close"[\s\S]*?<span class="ui-icon-button__label">Cards<\/span>/,
    'opened from the card browser, Back says where it goes');
  assert.match(html, /<div class="cemain" data-scroll="ce-edit">/, 'the form scrolls by itself, never the page');
});

test('1522 §1 a stranger is told the page is not theirs; with no card, the picker', () => {
  const refused = cardEditorHtml(view(null, { access: false }));
  assert.match(refused, /This page is for the card designers\./);
  assert.doesNotMatch(refused, /ce-tab|ce-submit|ce-q/);
  const empty = cardEditorHtml(view(null));
  assert.match(empty, /<input id="ce-q"/);
  assert.match(empty, /Find a card to edit\./);
  assert.doesNotMatch(empty, /ce-submit/);
  const picking = cardEditorHtml(view(null, { query: 'murk', picks: ['Murkstalker', 'Murk Lord'] }));
  assert.deepEqual(btns(picking).filter(b => b === 'ce-pick').length, 2);
  assert.match(picking, /data-btn="ce-pick" data-card="Murk Lord">Murk Lord</);
});

test('1522 §2 the form is in his notation and keeps every space', () => {
  const html = cardEditorHtml(view(UNIT));
  assert.equal(valueOf(html, 'ce-f-cost'), 'wk', 'light and dark are w and k on screen');
  assert.equal(valueOf(html, 'ce-f-total-cost'), '2');
  assert.equal(valueOf(html, 'ce-f-power'), '2');
  assert.equal(valueOf(html, 'ce-f-toughness'), '2');
  assert.equal(valueOf(html, 'ce-f-type'), 'Unit — Cosmic Horror');
  assert.doesNotMatch(html, /Creature/, 'Creature is never on screen');
  assert.match(html, /<textarea[^>]*id="ce-f-text"[^>]*>When you trash another card, {2}\[Switch1\] Each opponent loses 1 life and you gain \[1k\]\.<\/textarea>/,
    'the double space survives and the text pips are his');
  assert.equal(valueOf(html, 'ce-f-image'), 'images_out/Stable/murk3.png');
  for (const f of ['cost', 'total cost', 'power', 'toughness', 'type', 'text', 'image']) {
    assert.match(html, new RegExp(`data-ce-field="${f}"`), `${f} is wired`);
  }
  assert.deepEqual([...html.matchAll(/data-btn="ce-complexity"[^>]*data-value="(\w+)"/g)].map(m => m[1]), ['Simple', 'Complex']);
  assert.match(html, /<button class="[^"]* on" data-btn="ce-complexity" type="button" data-value="Complex" aria-pressed="true">/, 'his choice pressed');
  assert.match(html, /<img class="cescan" data-zoom src="\/data\/cards\/Murkstalker\.webp"/, 'the scan as it is now, zoomable');
  for (const b of ['ce-close', 'ce-tab', 'ce-complexity', 'ce-submit']) assert.ok(btns(html).includes(b), `${b} is drawn`);
  // a spell: no power or toughness, and Common is neither choice
  const spell = cardEditorHtml(view(SPELL));
  assert.doesNotMatch(spell, /ce-f-power|ce-f-toughness/);
  assert.equal(valueOf(spell, 'ce-f-type'), '{Battle} Spell');
  assert.doesNotMatch(spell, /data-btn="ce-complexity"[^>]*aria-pressed="true"/, 'no complexity pressed for Common');
  // typed values are drawn exactly as typed
  const typed = cardEditorHtml(view(UNIT, { fields: { ...editorFields(UNIT), type: '  Unit —  Cosmic Horror ' } }));
  assert.equal(valueOf(typed, 'ce-f-type'), '  Unit —  Cosmic Horror ');
});

test('1522 §3 read-only says why; an edit in progress replaces the form with its commands', () => {
  const ro = cardEditorHtml(view(UNIT, { row: { card: UNIT.name, row: UNIT, rowHash: 'h', readOnly: "this card's type line isn't understood yet", open: null } }));
  assert.match(ro, /Read-only: this card's type line isn't understood yet\./);
  assert.doesNotMatch(ro, /ce-submit|data-ce-field/);
  const edit: EditDetail = {
    id: 'ce-20261127-murkstalker-7f3a', card: 'Murkstalker', by: { name: 'Caleb' }, createdAt: '2026-11-27T10:00:00Z',
    summary: 'cost 2 → 3, power 2 → 3', road: 'fast', status: 'submitted', note: null, edit: { 'total cost': '3', power: '3' }, diff: [], why: [],
    commands: [{ text: '$modify murkstalker|total cost|3', field: 'total cost', posted: null, answered: false },
      { text: '$modify murkstalker|power|3', field: 'power', posted: null, answered: false }],
    pictures: { before: false, after: false },
  };
  const html = cardEditorHtml(view(UNIT, { current: edit }));
  assert.doesNotMatch(html, /data-ce-field|ce-submit/, 'no form while the edit is open');
  assert.match(html, /Post these in #card-changes, one message each:/);
  assert.match(html, /<code class="cecmdtext">\$modify murkstalker\|total cost\|3<\/code>/);
  assert.equal(btns(html).filter(b => b === 'ce-copy').length, 2, 'a Copy per command');
  for (const b of ['ce-copyall', 'ce-cancel']) assert.ok(btns(html).includes(b), `${b} is drawn`);
  assert.deepEqual([...html.matchAll(/<li class="cestep cestep--(\w+)"[^>]*>([^<]+)</g)].map(m => `${m[1]}:${m[2]}`),
    ['now:Submitted', 'todo:Waiting for FriendlyBot', 'todo:Applying', 'todo:Live']);
  // posted and answered: no Cancel, the marks, the server note
  const moving = cardEditorHtml(view(UNIT, { current: { ...edit, status: 'waiting', note: "FriendlyBot hasn't answered: is it running? Post the command again.",
    commands: [{ ...edit.commands[0]!, posted: edit.commands[0]!.text, answered: true }, { ...edit.commands[1]!, posted: edit.commands[1]!.text }] } }));
  assert.doesNotMatch(moving, /ce-cancel/, 'once a command is posted the edit cannot be cancelled');
  assert.match(moving, /cestep--done"[^>]*>Submitted<[\s\S]*cestep--now" aria-current="step">Waiting for FriendlyBot</);
  assert.match(moving, /FriendlyBot hasn't answered: is it running\? Post the command again\./);
  assert.match(moving, />Done</);
  assert.match(moving, />Posted</);
  // the steward road names its own third step
  const steward = cardEditorHtml(view(UNIT, { current: { ...edit, road: 'steward', status: 'steward', note: 'queued for the steward: the text changed' } }));
  assert.match(steward, /cestep--now" aria-current="step">Queued for the steward</);
  assert.ok(btns(steward).includes('ce-again'), 'a card handed on can be edited again');
  // a refusal from the server is said
  assert.match(cardEditorHtml(view(UNIT, { errorMsg: 'Murkstalker has an edit in progress.' })), /Murkstalker has an edit in progress\./);
});

test('1522 §4 drawn with the components: no hand-written ui- class, no colour literal', () => {
  const src = readFileSync(new URL('../pages/cardeditor.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /class="[^"]*(?<![\w-])ui-[a-z]/, 'a ui- class written by hand');
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b(?![-\w])|rgba?\(|hsla?\(/, 'a colour literal');
});
