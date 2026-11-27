/* 1524 — the card editor's My edits tab, drawn from made-up views with no DOM.
 *
 * §1 one list: card · what changed · status chip · when, and the author only for an admin
 * §2 a row opens its detail: the before and after pictures side by side, the commands as posted,
 *    the status and the server's note
 * §3 nothing yet, and still loading
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardEditorHtml, type CardEditorView, type EditDetail, type EditSummary } from '../pages/cardeditor.ts';

const A: EditSummary = { id: 'ce-20261127-murkstalker-7f3a', card: 'Murkstalker', by: { name: 'Caleb' }, createdAt: '2026-11-27T10:00:00Z',
  summary: 'cost 2 → 3', road: 'fast', status: 'applying', note: 'testing' };
const B: EditSummary = { id: 'ce-20261126-firebolt-01ab', card: 'Firebolt', by: { name: 'Dee' }, createdAt: '2026-11-26T10:00:00Z',
  summary: 'text', road: 'steward', status: 'steward', note: 'queued for the steward: the text changed' };
const C: EditSummary = { ...A, id: 'ce-20261120-murkstalker-0000', status: 'live', note: null, summary: 'art' };
const D: EditSummary = { ...B, id: 'ce-20261119-firebolt-1111', status: 'cancelled', note: null };

const DETAIL: EditDetail = {
  ...B, edit: { text: 'Deal 4 damage.' }, diff: [{ field: 'text', from: 'Deal 3 damage.', to: 'Deal 4 damage.' }], why: ['the text changed'],
  commands: [{ text: '$modify firebolt|text|Deal 4 damage.', field: 'text', posted: '$modify firebolt|text|Deal 4  damage.', answered: true }],
  pictures: { before: true, after: true },
};

function view(over: Partial<CardEditorView> = {}): CardEditorView {
  return {
    access: true, tab: 'mine', backLabel: 'Home', isAdmin: false, discordLinked: true, chrome: { signedIn: true, alerts: 0 },
    query: '', picks: [], card: null, isLoading: false, busy: false, row: null, scanUrl: null, fields: {}, current: null,
    errorMsg: '', edits: [A, B, C, D], whenOf: { [A.id]: '27 Nov, 10:00', [B.id]: '26 Nov, 10:00' }, detail: null,
    pictures: { before: null, after: null }, ...over,
  };
}
const rows = (html: string): string[] => [...html.matchAll(/data-btn="ce-row" data-id="([^"]+)"/g)].map(m => m[1]!);

test('1524 §1 one list, a row per edit, newest first as the server sent them', () => {
  const html = cardEditorHtml(view());
  assert.match(html, /data-btn="ce-tab"[^>]*aria-pressed="true" data-tab="mine">My edits</);
  assert.match(html, /<div class="framelist celist" data-scroll="ce-mine">/, 'one surface that scrolls by itself');
  assert.deepEqual(rows(html), [A.id, B.id, C.id, D.id]);
  assert.match(html, /<b class="cerowcard">Murkstalker<\/b>\s*<span class="cerowwhat">cost 2 → 3<\/span>/);
  for (const [word, tone] of [['Applying', 'accent'], ['Queued for the steward', 'warning'], ['Live', 'success'], ['Cancelled', 'neutral']]) {
    assert.match(html, new RegExp(`<span class="ui-chip ui-chip--${tone} ui-chip--pill">${word}</span>`), `${word} chip`);
  }
  assert.match(html, /<span class="cerowwhen">27 Nov, 10:00<\/span>/);
  assert.doesNotMatch(html, /Caleb|Dee/, 'a designer sees no author names');
  assert.match(cardEditorHtml(view({ isAdmin: true })), /<span class="cerowwhen">27 Nov, 10:00 · Caleb<\/span>/, 'an admin sees who');
  assert.match(html, /Pick an edit to see it\./);
});

test('1524 §2 the opened edit: its pictures side by side, the commands as posted, the status', () => {
  const html = cardEditorHtml(view({ detail: DETAIL, pictures: { before: 'blob:before', after: 'blob:after' }, whenOf: { [B.id]: '26 Nov, 10:00' } }));
  assert.match(html, /<button type="button" class="cerowbtn on" data-btn="ce-row" data-id="ce-20261126-firebolt-01ab" aria-pressed="true">/);
  assert.match(html, /<div class="cepics"><figure class="cepic"><img src="blob:before" alt="Before">[\s\S]*?<figure class="cepic"><img src="blob:after" alt="After">/);
  assert.match(html, /<code class="cecmdtext">\$modify firebolt\|text\|Deal 4 {2}damage\.<\/code>/, 'the command as he posted it');
  assert.doesNotMatch(html, /data-btn="ce-copy"/, 'nothing to copy in the record');
  assert.match(html, /cestep--now" aria-current="step">Queued for the steward</);
  assert.match(html, /<p class="cenote">queued for the steward: the text changed<\/p>/);
  assert.match(html, /<div class="cedetail" data-scroll="ce-detail-ce-20261126-firebolt-01ab">/);
  const none = cardEditorHtml(view({ detail: { ...DETAIL, pictures: { before: false, after: false } } }));
  assert.equal((none.match(/No picture yet/g) ?? []).length, 2);
});

test('1524 §3 no edits yet, and the list loading', () => {
  assert.match(cardEditorHtml(view({ edits: [] })), /No edits yet\./);
  assert.match(cardEditorHtml(view({ edits: null })), /<p class="framenote">loading…<\/p>/);
  assert.match(cardEditorHtml(view({ errorMsg: 'Could not reach the server.' })), /Could not reach the server\./);
});
