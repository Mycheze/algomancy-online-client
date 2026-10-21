/* THE TABLETOP'S PILES, AT REST — `piles` on a saved deck (server/collection.ts;
 * the spec is the deck-table v2 round's §4.1).
 *
 * The one commitment every case here serves: AN ARRANGEMENT NEVER CHANGES THE
 * DECK. Piles say where cards sit; `cards` says which cards there are. So the
 * store clamps the piles to `cards` on every write — including a write that
 * sent `cards` alone — and drops what names no card of the deck, but it never
 * FILLS a pile (that has layout opinions; ui/deckarrange.ts reconciles on
 * read, 534).
 *
 *   §1  piles round-trip through updateDeck; `piles: null` clears them
 *   §2  a card not in the deck is dropped; surplus copies come off the LAST
 *       pile holding them; a deficit is left alone
 *   §3  `cards` sent alone re-clamps the stored piles
 *   §4  the public view never carries them; `take` copies none; an own
 *       duplicate copies them
 *   §5  the caps: 30 piles, 40-char names, ids, aliases, `auto` and `named`
 *   §6  the v1 records `sortMoves` and `view` are gone: sent, never stored
 *   §7  a deck without the field reads exactly as before — nothing migrated
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ⚠ THROWAWAY STATE before any import: accounts.ts captures its store path at
 * module scope, and var/ is live data (see 312's header for why it is these
 * variables and not ALGO_VAR_DIR). */
const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-533-'));
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');
process.env['ALGO_GAMES_DIR'] = join(SCRATCH, 'games');

const { loadAccounts, register } = await import('../accounts.ts');
const {
  collectionView, createDeck, decksOf, duplicateDeck, updateDeck, MAX_PILES,
} = await import('../collection.ts');
const { sharedDeck, sourceDeck } = await import('../publicdecks.ts');
const { DECK_LIST } = await import('../../engine/src/cards/registry.ts');

loadAccounts();
const who = (name: string) => {
  const r = register(name, 'a good password');
  if (!r.ok) throw new Error(r.error);
  return r.account;
};
const me = who('Arranger');
const other = who('Onlooker');

const [A, B, C, D, E] = DECK_LIST as [string, string, string, string, string];
/** a deck: two of A, one of B and C — D and E are not in it */
const CARDS = [A, A, B, C];

function freshDeck(account = me, cards = CARDS) {
  const r = createDeck(account, { name: `t ${Math.random()}`, cards });
  if (!r.ok) throw new Error(r.error);
  return r.deck;
}
const reread = (id: string, account = me) => decksOf(account).find(d => d.id === id)!;

/* ══ §1 round trip ═════════════════════════════════════════════════════ */

test('§1 piles round-trip through updateDeck and the collection view; null clears them', () => {
  const d = freshDeck();
  const piles = [
    { id: 'p1', name: 'Early', cards: [A, B], auto: 'cost:2' },
    { id: 'p2', name: 'Late', cards: [A, C], named: true as const },
  ];
  const r = updateDeck(me, d.id, { piles });
  assert.ok(r.ok);
  const back = reread(d.id);
  assert.deepEqual(back.piles, piles);
  assert.deepEqual(back.cards, CARDS, 'the deck itself is untouched');
  assert.deepEqual(collectionView(me).find(x => x.id === d.id)!.piles, piles, 'the owner\'s view carries them');
  // applied ONLY when sent
  updateDeck(me, d.id, { name: 'renamed' });
  assert.deepEqual(reread(d.id).piles, piles, 'a rename leaves the piles');
  updateDeck(me, d.id, { piles: null });
  assert.ok(!('piles' in reread(d.id)), 'null clears them, to ABSENT');
  updateDeck(me, d.id, { piles: [] });
  assert.ok(!('piles' in reread(d.id)), 'and so does an empty list');
});

/* ══ §2 the clamp ══════════════════════════════════════════════════════ */

test('§2 ⭐ a pile card not in the deck (or not a card) is dropped silently', () => {
  const d = freshDeck();
  updateDeck(me, d.id, { piles: [{ id: 'p1', name: 'x', cards: [A, D, 'Not A Card', B, E] }] });
  assert.deepEqual(reread(d.id).piles, [{ id: 'p1', name: 'x', cards: [A, B] }]);
});

test('§2 ⭐ surplus copies come off the LAST pile holding them; a deficit is not filled', () => {
  const d = freshDeck();
  // three A across the piles, the deck holds two; C is in no pile (a deficit)
  updateDeck(me, d.id, { piles: [
    { id: 'p1', name: 'one', cards: [A, B] },
    { id: 'p2', name: 'two', cards: [A] },
    { id: 'p3', name: 'three', cards: [A, B] },
  ] });
  const piles = reread(d.id).piles!;
  assert.deepEqual(piles.map(p => p.cards), [[A, B], [A], []],
    'the third A and the second B (surplus) leave the last pile; the empty pile is kept');
  assert.ok(!piles.some(p => p.cards.includes(C)), 'the missing C is NOT filled in server-side');
});

/* ══ §3 cards alone re-clamps ══════════════════════════════════════════ */

test('§3 ⭐ sending `cards` alone re-clamps the stored piles', () => {
  const d = freshDeck();
  updateDeck(me, d.id, { piles: [{ id: 'p1', name: 'a', cards: [A, A, B] }, { id: 'p2', name: 'b', cards: [C] }] });
  // an older client (or another device) cuts B and one A, and sends only the list
  updateDeck(me, d.id, { cards: [A, C] });
  const back = reread(d.id);
  assert.deepEqual(back.cards, [A, C]);
  assert.deepEqual(back.piles!.map(p => p.cards), [[A], [C]], 'no pile holds a phantom copy');
  // and the card coming back is NOT filled in — reconcile on read places it
  updateDeck(me, d.id, { cards: [A, B, C] });
  assert.deepEqual(reread(d.id).piles!.map(p => p.cards), [[A], [C]]);
});

/* ══ §4 who sees and who copies ════════════════════════════════════════ */

test('§4 ⭐ the public view never carries piles, and `take` copies none', () => {
  const d = freshDeck(other);
  updateDeck(other, d.id, { visibility: 'public', piles: [{ id: 'p1', name: 'secret plan', cards: [...CARDS] }] });
  const pub = sharedDeck(d.id)!;
  assert.ok(pub, 'the deck is shared');
  assert.ok(!('piles' in pub), 'the public view has no piles');
  assert.ok(!JSON.stringify(pub).includes('secret plan'), 'nothing of the arrangement leaks by another name');

  // /api/decks/take is duplicateDeck(account, id, sourceDeck(id)) — the route, verbatim
  const taken = duplicateDeck(me, d.id, sourceDeck(d.id)!);
  assert.ok(taken.ok);
  assert.ok(!('piles' in taken.deck), 'a taken copy has no piles');
  assert.deepEqual(taken.deck.cards, CARDS, 'but it has the cards');
  const route = readFileSync(new URL('../api-decks.ts', import.meta.url), 'utf8');
  assert.match(route, /duplicateDeck\(account, id, src\)/, 'the take route still passes the source');
});

test('§4 ⭐ duplicating your OWN deck copies the piles', () => {
  const d = freshDeck();
  const piles = [{ id: 'p1', name: 'mine', cards: [A, B] }, { id: 'p2', name: 'more', cards: [A, C] }];
  updateDeck(me, d.id, { piles });
  const dup = duplicateDeck(me, d.id);
  assert.ok(dup.ok);
  const back = reread(dup.deck.id);
  assert.deepEqual(back.piles, piles);
  back.piles![0]!.cards.push(C);
  assert.deepEqual(reread(d.id).piles, piles, 'a COPY: editing the duplicate\'s piles leaves the original');
});

/* ══ §5 caps ═══════════════════════════════════════════════════════════ */

test('§5 caps: 30 piles, 40-character names, ids made good', () => {
  const d = freshDeck();
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `pile ${i}`, cards: [] as string[] }));
  updateDeck(me, d.id, { piles: many });
  assert.equal(MAX_PILES, 30);
  assert.equal(reread(d.id).piles!.length, 30);

  updateDeck(me, d.id, { piles: [
    { id: 'ok-1', name: '  ' + 'n'.repeat(50) + '  ', cards: [] },
    { id: 'ok-1', name: '', cards: [] },                         // duplicate id, blank name
    { id: 'has space', name: 'b', cards: [] },                   // malformed id
    { id: 'x'.repeat(17), name: 'c', cards: [] },                // over 16
    'not a pile',
  ] });
  const p = reread(d.id).piles!;
  assert.equal(p.length, 4, 'a non-object pile is dropped');
  assert.equal(p[0]!.name, 'n'.repeat(40), 'trimmed, then cut to 40');
  assert.equal(p[1]!.name, 'Pile', 'a blank name reads "Pile"');
  const ids = p.map(x => x.id);
  assert.equal(new Set(ids).size, 4, 'every id unique');
  assert.ok(ids.every(id => /^[A-Za-z0-9_-]{1,16}$/.test(id)), `every id well formed: ${ids}`);
  assert.equal(ids[0], 'ok-1', 'a good id is kept as sent');
});

test('§5 `auto` is kept only from its alphabet, `named` only as true; names are canonicalised', () => {
  const d = freshDeck();
  updateDeck(me, d.id, { piles: [
    { id: 'a', name: 'a', cards: [], auto: 'element:fire/wood', named: true },
    { id: 'b', name: 'b', cards: [], auto: 'cost <script>', named: 'yes' },
    { id: 'c', name: 'c', cards: [], auto: 'x'.repeat(25), named: false },
  ] });
  assert.deepEqual(reread(d.id).piles, [
    { id: 'a', name: 'a', cards: [], auto: 'element:fire/wood', named: true },
    { id: 'b', name: 'b', cards: [] },
    { id: 'c', name: 'c', cards: [] },
  ]);

  // the alias: "Counter Theif" is how the card is PRINTED (registry.ts registerAlias)
  const NOW = 'Counter Thief';
  const OLD = 'Counter Theif';
  assert.ok(DECK_LIST.includes(NOW));
  const d2 = freshDeck(me, [NOW, NOW, A]);
  updateDeck(me, d2.id, { piles: [{ id: 'p1', name: 'x', cards: [OLD, OLD, OLD, A] }] });
  assert.deepEqual(reread(d2.id).piles![0]!.cards, [NOW, NOW, A], 'respelled, then clamped to the two the deck holds');
});

/* ══ §6 the v1 records are gone ════════════════════════════════════════ */

test('§6 ⭐ `sortMoves` and `view` are gone: sending them is ignored and they are never stored', () => {
  const d = freshDeck();
  const r = updateDeck(me, d.id, {
    piles: [{ id: 'p1', name: 'x', cards: [A] }],
    sortMoves: { type: { [A]: { row: 'spells', col: '3' } } }, view: 'freeform',
  } as never);
  assert.ok(r.ok, 'an old client sending them is not refused');
  const back = reread(d.id);
  assert.ok(!('sortMoves' in back) && !('view' in back), 'neither is stored');
  assert.deepEqual(back.piles, [{ id: 'p1', name: 'x', cards: [A] }], 'the piles beside them still land');
  for (const f of ['collection.ts', 'api-decks.ts']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    assert.doesNotMatch(src, /sortMoves|SortMoves|\bview\b\s*\?:|b\['view'\]/, `${f} reads no v1 record`);
  }
});

/* ══ §7 no migration ═══════════════════════════════════════════════════ */

test('§7 a deck without the field reads exactly as before — nothing is added on read or on other edits', () => {
  const d = freshDeck();
  const keys = (o: object) => Object.keys(o).sort();
  assert.ok(!keys(reread(d.id)).includes('piles'), 'a new deck has no piles');
  collectionView(me);
  updateDeck(me, d.id, { name: 'still plain', cards: [A, B], maybe: [C], description: 'x' });
  assert.ok(!('piles' in reread(d.id)), 'an ordinary edit adds no piles');
  // and a deck stored before the field existed (a raw record) reads unchanged
  const raw = { id: 'old1', name: 'old', cards: [A, A], maybe: [], cover: A, author: 'you', createdAt: '', updatedAt: '' };
  const acct = { id: 'u-raw', decks: [structuredClone(raw)] };
  assert.deepEqual(decksOf(acct as never)[0], raw);
});
