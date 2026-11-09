/* 970 — THE MATCHMAKING QUEUE, DRAWN WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * The queue screen and the home strip left ui/queue.ts for pages/queue.ts as
 * view → pure html. Driven here with made-up views, no DOM.
 *
 * §1 the picker: draft and constructed (the deck picker slot), the blocker, signed out
 * §2 searching: ranked shows the band and the wait; a direct challenge shows no band
 * §3 an offer: Accept with the seconds left; once accepted, waiting with Cancel
 * §4 the home strip: the count, and each open game as a Join button
 * §5 names, errors and room ids are escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueHtml, queueStripHtml, type QueueView } from '../pages/queue.ts';

function view(over: Partial<QueueView> = {}): QueueView {
  return {
    counts: { total: 0, byMode: { constructed: 0, draft: 0 } },
    error: '', pickMode: 'draft', pickRanked: true, signedIn: true, blocker: null, rating: 1512,
    deckPicker: '<!--SLOT:deckPicker-->', searching: null, offer: null, chrome: { signedIn: true, alerts: 0 },
    ...over,
  };
}
const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);

test('970 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  // the app frame (pages/frame.ts, 2026-11-04), the page's class last (287)
  assert.match(queueHtml(view()), /^<div class="ui-app-shell ui-app-shell--contained apppage queuescreen">/);
});

test('970 §1 the picker: formats, who you play, Find a game; the deck picker only for constructed', () => {
  const draft = queueHtml(view());
  for (const b of ['queue-home', 'queue-mode', 'queue-ranked', 'queue-go']) assert.ok(btns(draft).includes(b), b);
  // the format is a segmented control in a setting row since 2026-11-04
  assert.match(draft, /<div class="ui-setting-row__label">Format<\/div>/);
  assert.match(draft, /<button class="ui-segmented__option" data-btn="queue-mode" type="button" data-value="constructed" aria-pressed="false" data-mode="constructed">Constructed<\/button><button class="ui-segmented__option on" data-btn="queue-mode" type="button" data-value="draft" aria-pressed="true" data-mode="draft">Live draft/);
  assert.match(draft, /nobody waiting — be the first/);
  assert.match(draft, /near your rating · 1512/);
  assert.match(draft, /Find a live draft game<\/button>/);
  assert.doesNotMatch(draft, /SLOT:deckPicker/, 'no deck picker for a draft');
  assert.doesNotMatch(draft, /data-btn="queue-go" disabled/);

  const blocked = queueHtml(view({ pickMode: 'constructed', blocker: 'pick one of your decks first' }));
  assert.match(blocked, /<div class="qdeck"><!--SLOT:deckPicker--><\/div>/);
  assert.match(blocked, /class="ui-status ui-status--note" role="status">pick one of your decks first</);
  assert.match(blocked, /data-btn="queue-go" disabled>\s*Find a game<\/button>/);

  const out = queueHtml(view({ signedIn: false, rating: null }));
  assert.match(out, /Signed out you can still play by room code/);
  assert.match(out, /near your rating — the search widens/);
});

test('970 §2 searching: the band and the wait, and a direct challenge shows no band', () => {
  const s = { mode: 'draft' as const, ranked: true, since: 0, band: 150, waited: 75_000 };
  const ranked = queueHtml(view({ searching: s }));
  assert.match(ranked, /Searching for a live draft game…/);
  assert.match(ranked, /±150 · <span data-qwait>1:15<\/span>/);
  assert.match(ranked, /the search widens the longer you wait/);
  assert.deepEqual(btns(ranked), ['queue-home', 'queue-cancel'], 'only Stop: no picker while searching');
  assert.match(queueHtml(view({ searching: { ...s, band: null } })), /anyone · <span data-qwait>[\s\S]*wide open now/);

  const vs = queueHtml(view({ searching: { ...s, vs: 'g1', vsName: 'Rashi' } }));
  assert.match(vs, /Joining Rashi's game…/, 'the name takes a possessive (docs/23-ui-inventory/05 §18.13)');
  assert.match(queueHtml(view({ searching: { ...s, vs: 'g1', vsName: null } })), /Joining their game…/,
    'no name: the pronoun, which is already possessive');
  assert.doesNotMatch(vs, /±150/, 'a direct challenge ignores the band, so it must not show one');
  assert.match(vs, />Stop<\/button>/);
});

test('970 §3 an offer: Accept counts down; accepted, it waits with Cancel', () => {
  const o = { opponent: 'Rashi', opponentRating: 1490, mode: 'constructed' as const, accepted: false, expiresIn: 9000, left: 9 };
  const fresh = queueHtml(view({ offer: o }));
  assert.match(fresh, /<h3>Match found<\/h3>/);
  assert.match(fresh, /class="cta primary qaccept" data-btn="queue-accept">Accept <span class="qcount" data-qleft>9<\/span>/);
  assert.match(fresh, /data-btn="queue-decline">Decline</);
  const waiting = queueHtml(view({ offer: { ...o, accepted: true, left: 4 } }));
  assert.match(waiting, /Waiting for Rashi… <b data-qleft>4<\/b>/);
  assert.match(waiting, /data-btn="queue-decline">Cancel</);
  assert.doesNotMatch(waiting, /queue-accept/);
});

test('970 §4 the home strip: the count, and each open game is a Join', () => {
  assert.doesNotMatch(queueStripHtml({ counts: null, openGames: [] }), /qopen/, 'no list when nobody is waiting');
  assert.match(queueStripHtml({ counts: null, openGames: [] }), /checking…/);
  const strip = queueStripHtml({
    counts: { total: 2, byMode: { constructed: 1, draft: 1 } },
    openGames: [{ id: 'g1', username: 'Rashi', mode: 'draft', ranked: true, rating: 1490, waitedMs: 61_000 }],
  });
  assert.match(strip, /class="qstripcount live">2 waiting · Constructed 1 · Live draft 1</);
  assert.match(strip, /data-btn="queue-open">Find a game</);
  assert.match(strip, /<span class="qopenwhat">Live draft · ranked · 1490<\/span>/);
  assert.match(strip, /data-btn="queue-join-open" data-id="g1"/);
});

test('970 §5 names, errors and ids are escaped', () => {
  assert.match(queueHtml(view({ error: 'no <b>' })), /no &lt;b&gt;/);
  const o = { opponent: '<Eve>', opponentRating: 1, mode: 'draft' as const, accepted: true, expiresIn: 1, left: 1 };
  assert.doesNotMatch(queueHtml(view({ offer: o })), /<Eve>/);
  const strip = queueStripHtml({ counts: null, openGames: [{ id: '"x', username: '<i>', mode: 'draft', ranked: false, rating: 0, waitedMs: 0 }] });
  assert.match(strip, /&lt;i&gt;/);
  assert.match(strip, /data-id="&quot;x"/);
});
