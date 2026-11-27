/* The replay viewer's changed-cards note (replaybar.ts cardsChangedNoteHtml).
 *
 * A replay draws today's cards, and its verdict cannot see a numbers change,
 * so the bar names the cards in the game printed differently since it was
 * played. Nothing for no change or for "can't tell"; one sentence for one card;
 * a short list, capped, for many. Drawn with the status component, so it
 * carries no colour of its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardsChangedNoteHtml } from '../replaybar.ts';
import { readStyles } from './read-styles.ts';

const text = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, '\'');

test('replay note: nothing when no card changed, or when the stamp cannot tell', () => {
  assert.equal(cardsChangedNoteHtml([]), '');
  assert.equal(cardsChangedNoteHtml('cant-tell'), '');
  assert.equal(cardsChangedNoteHtml(undefined), '');
});

test('replay note: one card is one sentence naming what changed', () => {
  const html = cardsChangedNoteHtml([{ card: 'Murkstalker', fields: ['cost', 'text'] }]);
  assert.match(html, /class="ui-status ui-status--info replaynote"/);
  assert.match(html, /role="status"/);
  assert.equal(text(html), 'Played before Murkstalker changed (cost, text). This replay shows today’s card.');
});

test('replay note: a renamed card is named as it was played, and a removed one says so', () => {
  assert.equal(text(cardsChangedNoteHtml([{ card: 'Consuming Mass', was: 'Grim Bargain', fields: ['name'] }])),
    'Played before Grim Bargain became Consuming Mass. This replay shows today’s card.');
  assert.equal(text(cardsChangedNoteHtml([{ card: 'Oodvick', was: 'Its Dark Bubb', fields: ['name', 'power'] }])),
    'Played before Its Dark Bubb became Oodvick (power). This replay shows today’s card.');
  assert.equal(text(cardsChangedNoteHtml([{ card: 'Gone Card', fields: ['removed'] }])),
    'Played before Gone Card was removed. This replay shows today’s card.');
});

test('replay note: many cards are listed compactly, three named and the rest counted', () => {
  const two = cardsChangedNoteHtml([
    { card: 'Murkstalker', fields: ['cost'] },
    { card: 'Seer of Empty Spaces', fields: ['cost', 'art'] },
  ]);
  assert.equal(text(two),
    'Played before 2 of its cards changed: Murkstalker (cost), Seer of Empty Spaces (cost, art). This replay shows today’s cards.');
  const five = cardsChangedNoteHtml([
    { card: 'A', fields: ['cost'] }, { card: 'B', fields: ['power'] }, { card: 'C', fields: ['text'] },
    { card: 'D', fields: ['art'] }, { card: 'New E', was: 'E', fields: ['name'] },
  ]);
  assert.match(text(five), /^Played before 5 of its cards changed: A \(cost\), B \(power\), C \(text\) and 2 more\./);
  assert.match(five, /title="A \(cost\), B \(power\), C \(text\), D \(art\), E \(now New E\)"/,
    'the whole list is a hover away');
});

test('replay note: a card name is escaped', () => {
  const html = cardsChangedNoteHtml([{ card: '<b>X</b>', fields: ['cost'] }]);
  assert.doesNotMatch(html, /<b>/);
});

test('replay note: its one style rule is in the replay bar piece, with no colour of its own', () => {
  const css = readStyles();
  const rule = /\.replaynote\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the note has its margin rule');
  assert.doesNotMatch(rule[1]!, /color|#[0-9a-f]{3}/i, 'the status component colours it');
});
