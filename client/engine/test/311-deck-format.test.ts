/* THE DECK FILE FORMAT — ui/deckformat.ts, and the importer that reads it.
 *
 * engine/test/188 already proves the TEXT export round-trips through the real
 * importer. This is the same discipline applied to the richer format, and the
 * reason it is a separate file is that the text export and the deck file make
 * different promises: the text one promises the card list survives, and this
 * one promises the DECK survives — the description, the cover, the shelf, the
 * attribution, the link it came from.
 *
 * §1 ⭐ a deck round-trips as a file, metadata included, through the REAL
 *    importer — the thing 188 does for the list, done for everything else
 * §2 the format's own shape: what a writer emits, what a reader tolerates
 * §3 ⭐ the paste box takes either format, and never guesses wrong
 * §4 ⭐ algomancer.cc's own deck payload imports as a deck
 * §5 ⭐ nothing derived is in the file at all
 * §6 ⭐ a deck file cannot publish itself — visibility does not transfer
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DECK_FORMAT, DECK_FORMAT_VERSION, buildDeckFile, deckFileText, entriesOf,
  expandEntries, looksLikeDeckFile, parseDeckFile,
} from '../../ui/deckformat.ts';
import { importDeckFile, importDeckPaste, importDeckText, defaultDecks } from '../../server/decks.ts';

const copies = (name: string, n: number): string[] => Array.from({ length: n }, () => name);

/** a deck with every optional field filled, so a round trip has something to
 * lose. The cards are a real default deck, which is what makes it importable. */
const richDeck = () => {
  const base = defaultDecks()[0]!;
  return {
    id: 'deck-1234',
    name: base.name,
    cards: base.cards,
    maybe: ['Rune Channeler'],
    cover: base.cards[base.cards.length - 1]!,
    author: 'aramsunat',
    description: '## The plan\n\nDrain them out, then **swing**. See [the two-drop](Ignis Sprite).',
    url: 'https://www.algomancer.cc/decks/6a0ad201656c0c0c9b916b93',
    visibility: 'public' as const,
    createdAt: '2026-05-18T08:46:57.327Z',
    updatedAt: '2026-09-18T20:44:26.996Z',
    record: { games: 9, wins: 6, losses: 3 },
  };
};

/* ══ §1 — the round trip, against the real importer ════════════════════ */

test('§1 ⭐ a deck exported as a file imports back as the same deck', () => {
  const d = richDeck();
  const back = importDeckFile(deckFileText(buildDeckFile(d, { origin: 'https://algomancy.online' })));

  assert.deepEqual(back.problems, [], 'a deck this build scripts must import cleanly');
  assert.deepEqual([...back.cards].sort(), [...d.cards].sort(), 'the list');
  assert.equal(back.name, d.name, 'the name');
  assert.equal(back.description, d.description, 'THE DESCRIPTION — the field the text export drops');
  assert.equal(back.cover, d.cover, 'the cover card');
  assert.deepEqual(back.maybe, d.maybe, 'the maybeboard');
  assert.equal(back.author, d.author, 'who built it');
  assert.equal(back.url, d.url, 'where it came from');
});

test('§1b every bundled deck survives the round trip', () => {
  for (const deck of defaultDecks()) {
    const file = buildDeckFile({ name: deck.name, cards: deck.cards, author: deck.author, ...(deck.url ? { url: deck.url } : {}) });
    const back = importDeckFile(deckFileText(file));
    assert.deepEqual(back.problems, [], `${deck.name}: does not import cleanly`);
    assert.deepEqual([...back.cards].sort(), [...deck.cards].sort(), deck.name);
  }
});

test('§1c a pair is one entry with a quantity, not two entries', () => {
  const entries = entriesOf([...copies('Ignis Sprite', 2), 'Rune Channeler']);
  assert.equal(entries.filter(e => e.name === 'Ignis Sprite').length, 1);
  assert.equal(entries.find(e => e.name === 'Ignis Sprite')?.quantity, 2);
  assert.equal(expandEntries(entries).length, 3, 'and expands back to three cards');
});

/* ══ §2 — the shape ════════════════════════════════════════════════════ */

test('§2 a written file carries the format tag and version', () => {
  const file = buildDeckFile({ name: 'x', cards: copies('Ignis Sprite', 2) });
  assert.equal(file.format, DECK_FORMAT);
  assert.equal(file.version, DECK_FORMAT_VERSION);
  assert.ok(file.exportedAt, 'and says when it was written');
  assert.equal(file.generator?.app, 'algomancy.online');
});

test('§2b nothing absent is written as a blank', () => {
  // a bare deck must not export `description: ""` — an importer applying that
  // would blank the description of whatever it was pasted over
  const file = buildDeckFile({ name: 'x', cards: copies('Ignis Sprite', 2) });
  for (const k of ['description', 'author', 'source', 'visibility', 'id', 'url', 'maybe', 'record']) {
    assert.ok(!(k in file), `${k} should be absent, not empty`);
  }
});

test('§2c the absolute URLs need an origin, and are left out without one', () => {
  const bare = buildDeckFile({ name: 'x', cards: copies('Ignis Sprite', 2), id: 'abc' });
  assert.ok(!bare.url && !bare.coverImage, 'no origin, no absolute link — never a relative one');
  const full = buildDeckFile({ name: 'x', cards: copies('Ignis Sprite', 2), id: 'abc' },
    { origin: 'https://algomancy.online/' });
  assert.equal(full.url, 'https://algomancy.online/?deck=abc');
  assert.match(full.coverImage ?? '', /^https:\/\/algomancy\.online\/data\/cards\/.+\.(jpg|png|jpeg)$/i);
});

test('§2d a reader tolerates a bare string entry, a missing quantity and a newer version', () => {
  const r = parseDeckFile(JSON.stringify({
    format: DECK_FORMAT, version: 99, name: 'loose',
    cards: ['Ignis Sprite', { name: 'Rune Channeler' }, { name: 'Ignis Sprite', quantity: 1 }],
    somethingFromTheFuture: { nested: true },
  }));
  assert.ok(r.ok);
  assert.equal(expandEntries(r.file.cards).length, 3);
  assert.equal(r.notes.length, 1, 'the version gap is reported, not fatal');
  assert.match(r.notes[0]!, /version 99/);
});

test('§2e …but somebody else\'s format is refused rather than half-read', () => {
  const r = parseDeckFile(JSON.stringify({ format: 'mtg-deck', name: 'x', cards: ['Island'] }));
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /mtg-deck/);
});

test('§2f a file with no cards is an error, not an empty deck', () => {
  for (const bad of ['{}', '{"cards":[]}', '[]', 'not json at all']) {
    assert.equal(parseDeckFile(bad).ok, false, bad);
  }
});

/* ══ §3 — one paste box, two formats ═══════════════════════════════════ */

test('§3 ⭐ the paste box reads a card list and a deck file, and tells them apart', () => {
  const deck = defaultDecks()[0]!;
  const asFile = deckFileText(buildDeckFile({ name: deck.name, cards: deck.cards }));
  const asList = deck.cards.map(c => `1 ${c}`).join('\n');

  assert.ok(looksLikeDeckFile(asFile) && !looksLikeDeckFile(asList));
  assert.deepEqual([...importDeckPaste(asFile).cards].sort(), [...deck.cards].sort());
  assert.deepEqual([...importDeckPaste(asList).cards].sort(), [...deck.cards].sort());
});

test('§3b broken JSON says the JSON is broken — it is not fed to the list parser', () => {
  // the failure this prevents: thirty "unknown card: \"name\":" lines, and no
  // word anywhere about the missing brace that actually caused it
  assert.throws(() => importDeckPaste('{"format":"algomancy-deck","cards":['), /JSON/);
});

/* ══ §4 — algomancer.cc's own payload ══════════════════════════════════ */

test('§4 ⭐ algomancer.cc\'s deck API response imports as a deck', () => {
  // the shape of a real /api/decks/<id> answer, trimmed to what we read
  const payload = {
    deck: {
      _id: '6a0ad201656c0c0c9b916b93',
      name: 'Single-Box Battle Deck - Fire v1.1.0',
      description: 'Single-box deck focusing on Fire.',
      cards: [{ cardId: 'ignis-sprite', quantity: 2 }, { cardId: 'rune-channeler', quantity: 1 }],
      sideboard: [{ cardId: 'ignis-sprite', quantity: 1 }],
      isPublic: true,
    },
    cards: [
      { id: 'ignis-sprite', name: 'Ignis Sprite' },
      { id: 'rune-channeler', name: 'Rune Channeler' },
    ],
    user: { username: 'aramsunat' },
  };
  const info = importDeckFile(JSON.stringify(payload));
  assert.deepEqual([...info.cards].sort(), [...copies('Ignis Sprite', 2), 'Rune Channeler'].sort());
  assert.equal(info.description, 'Single-box deck focusing on Fire.');
  assert.equal(info.author, 'aramsunat', 'their builder is credited');
  assert.deepEqual(info.maybe, ['Ignis Sprite'], 'their sideboard is our maybeboard');
  assert.equal(info.url, 'https://www.algomancer.cc/decks/6a0ad201656c0c0c9b916b93',
    'the deck id becomes the deck page it came from');
});

test('§4b an unmapped slug still resolves, because the slug IS the name', () => {
  // no cards[] mapping at all — "ignis-sprite" normalises to the same key the
  // pool is indexed by, which is why the importer needs no slug table
  const info = importDeckFile(JSON.stringify({
    deck: { name: 'slugs only', cards: [{ cardId: 'ignis-sprite', quantity: 2 }] },
  }));
  assert.deepEqual(info.cards, copies('Ignis Sprite', 2));
});

/* ══ §5 — nothing derived ══════════════════════════════════════════════ */

test('§5 ⭐ a written file restates nothing that `cards` already says', () => {
  const file = buildDeckFile(richDeck(), { origin: 'https://algomancy.online' });

  /* The v1 draft carried a `stats` block — curve, element share, affinity
   * ceiling, legality — and it was cut before shipping: every one of those is
   * a pure function of `cards`, so a file carrying them is a file that can
   * contradict itself. This is the rule stated as a test rather than only in
   * a header, because the next person to want a cheap link preview will reach
   * for exactly this. Derive it; do not ship it. */
  const DERIVED = ['stats', 'curve', 'elements', 'maxAffinity', 'avgMana',
    'total', 'units', 'spells', 'legal', 'problems', 'xCards', 'affinityFloor'];
  for (const k of DERIVED) {
    assert.ok(!(k in (file as unknown as Record<string, unknown>)),
      `\`${k}\` is computable from the card list — it does not belong in the file`);
  }
  // the whole serialized file, so a nested block cannot smuggle one back in
  const text = deckFileText(file);
  for (const k of ['"stats"', '"curve"', '"maxAffinity"', '"avgMana"', '"legal"']) {
    assert.ok(!text.includes(k), `${k} appears in the serialized file`);
  }
  assert.ok(text.length < 4000, `a 30-card deck file is ${text.length} bytes — the stats block was half of it`);
  // …while the things that are NOT derivable from a card list stay
  assert.equal(file.record?.wins, 6, 'a record cannot be recomputed from thirty card names');
  assert.ok(file.coverImage, 'nor can the URL of this deploy\'s scans');
});

test('§5b an unknown block in a file is ignored, not refused', () => {
  // …which is also what happens to a `stats` block written by an older build
  // of this client, or by somebody who kept theirs
  const deck = defaultDecks()[0]!;
  const file = buildDeckFile({ name: deck.name, cards: deck.cards });
  const withStats = { ...file, stats: { total: 2, legal: false }, whatever: [1, 2, 3] };
  const back = importDeckFile(JSON.stringify(withStats));
  assert.equal(back.cards.length, deck.cards.length);
  assert.deepEqual(back.problems, [], 'the list is legal, whatever else the file says');
});

/* ══ §6 — a deck file cannot publish itself ════════════════════════════ */

test('§6 ⭐ visibility and the record do not cross the import boundary', () => {
  const info = importDeckFile(deckFileText(buildDeckFile(richDeck())));
  // DeckInfo has no visibility and no record field at all, which is the
  // strongest form of "it does not transfer" available: there is nowhere to
  // put it. api-decks.ts then creates the deck with the server's own default.
  assert.ok(!('visibility' in info), 'a pasted file must not decide who may see the deck');
  assert.ok(!('record' in info), 'nor bring a win rate it did not earn here');
});

test('§6b a cover naming a card that is not in the list is dropped', () => {
  const deck = defaultDecks()[0]!;
  const file = { ...buildDeckFile({ name: deck.name, cards: deck.cards }), cover: 'Rune Channeler' };
  const back = importDeckFile(JSON.stringify(file));
  if (!deck.cards.includes('Rune Channeler')) {
    assert.equal(back.cover, undefined, 'a deck must not wear art it does not play');
  }
});

/* ══ the two exports stay different things ═════════════════════════════ */

test('the text export is still the text export — this format did not replace it', () => {
  const deck = defaultDecks()[0]!;
  const list = deck.cards.map(c => `1 ${c}`).join('\n');
  assert.deepEqual([...importDeckText(list).cards].sort(), [...deck.cards].sort());
});
