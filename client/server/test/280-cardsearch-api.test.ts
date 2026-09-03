/* BL-41 — THE CARD QUERY LANGUAGE, SERVED OVER HTTP.
 *
 * server/api-cardsearch.ts wraps ui/cardsearch.ts so a reader that is not the
 * browser — the Discord bot, which is Python and cannot import the parser —
 * asks the SAME grammar the card page asks. The language itself already has a
 * guard (210-cardsearch.test.ts, 32 tests). This file covers only the seam:
 * what the projection promises a caller, and the two numbers it is easiest to
 * conflate.
 *
 * §1 the projection is complete — every field a card embed prints is there
 * §2 ⭐ THE ART URL IS COMPOSED ONCE. CardRow.image is a bare filename; the
 *    server serves /data/cards/<file>. A consumer that re-derives that path is
 *    the second place it lives, and ui/assets.ts's ART_BASE is already a
 *    relative string whose depth is load-bearing twice.
 * §3 ⭐ TOTAL IS NOT THE SLICE. SearchResult.total's own docstring warns that
 *    a caller which slices must not report the slice. This endpoint is the
 *    FIRST caller that slices, so the warning finally has something to fail.
 * §4 the tolerant parser's guesses survive the trip — a bot that answered
 *    `o:"draw a ca` without saying it closed the quote would be lying
 *    about what it searched
 * §5 the implicit class:card is reported AND defeatable
 * §6 limit is clamped at both ends
 *
 * Pure: no server is spawned, because the payload builder is a pure function
 * on purpose.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardSearchPayload, clampLimit, DEFAULT_LIMIT, MAX_LIMIT,
} from '../api-cardsearch.ts';

/* ══ §1 — the projection carries what a card embed prints ══════════════ */

test('BL-41 §1 every field an embed needs comes back, for a known card', () => {
  const r = cardSearchPayload('name:"Aberrant Populace"', { limit: 5 });
  assert.equal(r.ok, true);
  const c = r.cards.find(x => x.name === 'Aberrant Populace');
  assert.ok(c, 'the card the query names is in the answer');

  // A non-empty type line, a cost, an element and rules text are what
  // separates a usable embed from a name in a box.
  assert.ok(c.type.length > 0, 'type line');
  assert.equal(c.supertype, 'Unit');
  assert.deepEqual(c.elements, ['fire']);
  assert.equal(c.cost, 'rr');
  assert.equal(c.mana, 2);
  assert.equal(c.isX, false);
  assert.equal(typeof c.pow, 'number');
  assert.equal(typeof c.tou, 'number');
  assert.ok(c.text.length > 0, 'rules text');
  assert.equal(c.cls, 'card');
  assert.ok(c.set.length > 0, 'the printed deck it ships in');
  assert.equal(c.hasArt, true);

  // …and the whole payload says what it did.
  assert.equal(typeof r.total, 'number');
  assert.equal(typeof r.returned, 'number');
  assert.equal(typeof r.implicitCards, 'boolean');
  assert.ok(Array.isArray(r.errors));
  assert.equal(r.query, 'name:"Aberrant Populace"', 'the query is echoed as asked');
});

/* ══ §2 — the art URL, composed exactly once ═══════════════════════════ */

test('BL-41 §2 art is the served URL and image is the bare filename', () => {
  const r = cardSearchPayload('el:fire', { limit: 25 });
  assert.ok(r.cards.length > 0, 'non-vacuous');
  for (const c of r.cards) {
    // The bare filename must stay bare: a consumer that wants the file on disk
    // (bot/cards.py already resolves <Name-With-Hyphens>.jpg) reads this one.
    assert.ok(!c.image.includes('/'), `image is a bare filename: ${c.image}`);
    assert.ok(c.image.endsWith('.jpg'), `image is a jpg: ${c.image}`);
    // …and the URL is the server's own route, built here and nowhere else.
    assert.equal(c.art, '/data/cards/' + c.image);
  }
});

/* ══ §3 — total is the match count, returned is the slice ══════════════ */

test('BL-41 §3 ⭐ total reports every match, not the page that came back', () => {
  const wide = cardSearchPayload('el:fire', { limit: 3 });
  assert.equal(wide.returned, 3, 'the slice is honoured');
  assert.ok(wide.cards.length === 3);
  // The bug this exists for: returning rows.length as `total`, so a bot says
  // "3 cards match" when 55 do and the reader never widens the query.
  assert.ok(wide.total > wide.returned, `total ${wide.total} > returned ${wide.returned}`);

  // And the count does not move when only the limit does.
  const narrow = cardSearchPayload('el:fire', { limit: 1 });
  assert.equal(narrow.total, wide.total, 'total is independent of limit');
  assert.equal(narrow.returned, 1);
});

/* ══ §4 — the parser's guesses reach the caller ════════════════════════ */

test('BL-41 §4 an unclosed quote still answers, and says it was closed', () => {
  const r = cardSearchPayload('o:"draw a ca', { limit: 5 });
  // Tolerant: the bar re-runs per keystroke, so a half-typed query answers.
  assert.ok(r.total > 0, 'it still searched');
  // …but it must not answer SILENTLY, or the caller reports a different
  // question than the one it was asked.
  assert.ok(r.errors.length > 0, 'the guess is reported');
  assert.equal(typeof r.errors[0]!.at, 'number');
  assert.match(r.errors[0]!.message, /quote/i);

  // A clean query carries no errors, so the field means something.
  assert.deepEqual(cardSearchPayload('el:fire', { limit: 1 }).errors, []);
});

/* ══ §5 — the implicit class:card ══════════════════════════════════════ */

test('BL-41 §5 the implicit narrowing is reported and can be turned off', () => {
  const on = cardSearchPayload('el:fire mana<=3', { limit: 1 });
  assert.equal(on.implicitCards, true, 'a query with no opinion about class gets the default');

  const off = cardSearchPayload('el:fire mana<=3', { limit: 1, implicit: false });
  assert.equal(off.implicitCards, false);
  // Turning it off can only ADD rows — tokens, markers, resources.
  assert.ok(off.total > on.total, `implicit=false widens: ${off.total} > ${on.total}`);

  // A query that mentions class itself is already explicit, so nothing is added.
  const said = cardSearchPayload('class:token', { limit: 1 });
  assert.equal(said.implicitCards, false, 'the query had an opinion; do not override it');
});

/* ══ §6 — limit is clamped at both ends ════════════════════════════════ */

test('BL-41 §6 limit is clamped, and a missing one is the default', () => {
  assert.equal(clampLimit(null), DEFAULT_LIMIT);
  assert.equal(clampLimit(''), DEFAULT_LIMIT);
  assert.equal(clampLimit('not a number'), DEFAULT_LIMIT);
  assert.equal(clampLimit('0'), 1, 'below the floor');
  assert.equal(clampLimit('-9'), 1);
  assert.equal(clampLimit('9999'), MAX_LIMIT, 'above the cap');
  assert.equal(clampLimit('7'), 7);
  assert.equal(clampLimit('7.9'), 7, 'truncated, not rounded');

  // The cap is real, not advisory: an open port must not be asked for every
  // row in the index. (`class:all` is the spelling that means everything —
  // `class:*` is not a wildcard, it is a value no card has, and it matches
  // nothing at all.)
  const huge = cardSearchPayload('class:all', { limit: 9999 });
  assert.ok(huge.returned <= MAX_LIMIT, `returned ${huge.returned} <= ${MAX_LIMIT}`);
  assert.ok(huge.total > MAX_LIMIT, 'and there really were more to give');
});
