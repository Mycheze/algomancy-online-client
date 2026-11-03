/* 950 · ui/components/status.ts — an error is an alert, the rest a status */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_TONES, statusMessage } from '../components/status.ts';

test('every tone; error is an alert; note (today\'s .deckmsg) is the default', () => {
  for (const tone of STATUS_TONES) {
    assert.match(statusMessage({ text: 'x', tone }), new RegExp(`^<div class="ui-status ui-status--${tone}" role="${tone === 'error' ? 'alert' : 'status'}">x</div>$`));
  }
  assert.match(statusMessage({ text: 'saved' }), /ui-status--note/);
});

test('boxed, escaping, pass-through', () => {
  const html = statusMessage({ text: 'bad <name>', tone: 'error', boxed: true, dataBtn: 'm', className: 'deckmsg' });
  assert.equal(html, '<div class="ui-status ui-status--error ui-status--boxed deckmsg" data-btn="m" role="alert">bad &lt;name&gt;</div>');
});

test('tag p: a paragraph, same classes and role (the home and waiting-room error line)', () => {
  assert.equal(statusMessage({ tag: 'p', className: 'deckmsg', text: 'no <room>' }),
    '<p class="ui-status ui-status--note deckmsg" role="status">no &lt;room&gt;</p>');
  assert.match(statusMessage({ text: 'x' }), /^<div /, 'div is the default');
});
