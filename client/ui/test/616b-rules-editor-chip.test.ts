/* 616b — CT-276, the page half: the review page draws the "system" chip on
 * the Rules editor's replies and on no account's comment. The server half
 * (the reserved name, and `system` set by id) is server/test/616. This lives
 * in ui/test because ui/crreview.ts is DOM-typed and the server project does
 * not typecheck against the DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentHtml } from '../crreview.ts';
import type { CrComment } from '../crtypes.ts';

const comment = (id: string, by: CrComment['by']): CrComment => ({
  id, target: 'rule:100.1', parent: null, anchor: null, body: 'text', by, at: '2026-10-24T00:00:00.000Z',
  mine: false, canEdit: false, canResolve: false,
});

test('CT-276: the review page draws the system chip on the Rules editor reply and on no account comment', () => {
  const real = commentHtml(comment('c1', { name: 'Rules editor', system: true }));
  const fake = commentHtml(comment('c2', { name: 'Rules editor' }));
  assert.match(real, /class="crchipx crsys"[^>]*>system</, 'the system author is drawn with the chip');
  assert.doesNotMatch(fake, /crsys/, 'an account that shares its name is not');
});
