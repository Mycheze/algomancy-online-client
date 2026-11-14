/* 1339 — THE END OF AN EVENT (docs/25 §10), DOM-free: the final standings; a called-off event;
 * a code that names nothing; the socket gone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeHtml } from '../pages/cube.ts';
import { eventView, pageView, tagOf } from './cube-fixture.ts';

test('1339 the end, and the other ways an event page can stand', () => {
  const done = cubeHtml(pageView({ event: eventView('done') }));
  assert.match(done, /🏆 Ann/);
  assert.match(done, /<th[^>]*>Points<\/th>/);
  assert.match(done, /data-scroll="cube-done"/);
  assert.doesNotMatch(done, /data-btn="cube-tab"/, 'no tabs once it is over');
  assert.equal(tagOf(done, 'cube-play'), '');

  const off = cubeHtml(pageView({ event: eventView('cancelled') }));
  assert.match(off, /The host called this event off\./);
  assert.ok(tagOf(off, 'cube-back'));

  const none = cubeHtml(pageView({ event: null }));
  assert.match(none, /No event here/);
  assert.match(cubeHtml(pageView({ event: null, loading: true })), /Loading…/);

  const offline = cubeHtml(pageView({ event: eventView('lobby'), online: false }));
  assert.match(offline, /Reconnecting…/);
  assert.doesNotMatch(cubeHtml(pageView({ event: eventView('lobby') })), /Reconnecting/);

  const said = cubeHtml(pageView({ event: eventView('lobby'), msg: 'the table is full', msgTone: 'error' }));
  assert.match(said, /role="alert"[^>]*>[^<]*the table is full|the table is full/);
});
