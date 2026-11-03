/* 1026 — MATCHMAKING ON THE NEW HOME: THE CARD'S GLANCE (docs/24, 2026-11-03).
 *
 * pages/queue.ts queueGlanceHtml draws the Matchmaking card's body from
 * queueStripView: who is around (lit while anybody is) and the open games
 * with their own `queue-join-open` Join buttons. The card itself is the
 * home's `queue-open` button, so there is no "Find a game" here. No DOM.
 *
 * §1 somebody around: the count lit, a Join per open game
 * §2 nobody: the count dim, no list; no counts yet: "checking"
 * §3 no queue-open in it; names escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueGlanceHtml } from '../pages/queue.ts';
import { countsSummary } from '../queue.ts';

const OPEN = [
  { id: 'g1', username: 'Rashi', mode: 'draft' as const, ranked: true, rating: 1490, waitedMs: 42_000 },
  { id: 'g2', username: 'Cy', mode: 'constructed' as const, ranked: false, rating: 1400, waitedMs: 130_000 },
];

test('1026 §1 somebody around: lit, with a Join per open game', () => {
  const counts = { total: 2, byMode: { constructed: 1, draft: 1 } };
  const html = queueGlanceHtml({ counts, openGames: OPEN });
  assert.match(html, /^<div class="qglance">/);
  assert.ok(html.includes(`<span class="qglcount live">${countsSummary(counts)}</span>`));
  assert.deepEqual([...html.matchAll(/data-btn="queue-join-open" data-id="([^"]*)"/g)].map(m => m[1]), ['g1', 'g2']);
  assert.match(html, /<span class="qopenwho">Rashi<\/span>/);
});

test('1026 §2 nobody around, and no answer yet', () => {
  const none = queueGlanceHtml({ counts: { total: 0, byMode: { constructed: 0, draft: 0 } }, openGames: [] });
  assert.match(none, /<span class="qglcount">/, 'nobody: not lit');
  assert.doesNotMatch(none, /qopen|<button/);
  assert.ok(queueGlanceHtml({ counts: null, openGames: [] }).includes(`<span class="qglcount">${countsSummary(null)}</span>`));
});

test('1026 §3 the card is the way in, not a button inside it; names escaped', () => {
  const html = queueGlanceHtml({ counts: { total: 1, byMode: { constructed: 0, draft: 1 } }, openGames: [{ ...OPEN[0]!, username: 'R<b>ash</b>', id: 'x"y' }] });
  assert.doesNotMatch(html, /queue-open"/, 'no Find a game: the home draws queue-open on the card');
  assert.match(html, /R&lt;b&gt;ash&lt;\/b&gt;/);
  assert.match(html, /data-id="x&quot;y"/);
});
