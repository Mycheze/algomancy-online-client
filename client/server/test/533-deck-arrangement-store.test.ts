/* THE DECK TABLE'S ARRANGEMENT, AT REST — `piles`, `sortMoves` and `view` on a
 * saved deck (server/collection.ts; the spec is the deck-table round's §5).
 *
 * The one commitment every case here serves: AN ARRANGEMENT NEVER CHANGES THE
 * DECK. Piles and moves say where cards sit; `cards` says which cards there
 * are. So the store clamps both records to `cards` on every write — including
 * a write that sent `cards` alone — and drops what names no card of the deck,
 * but it never FILLS a pile (that has layout opinions; ui/deckarrange.ts
 * reconciles on read, 534).
 *
 *   §1  piles, sortMoves and view round-trip through updateDeck
 *   §2  piles: a card not in the deck is dropped; surplus copies come off the
 *       LAST pile holding them; a deficit is left alone
 *   §3  sortMoves: unknown split keys, names not in the deck and malformed
 *       cells are dropped
 *   §4  `cards` sent alone re-clamps BOTH stored records
 *   §5  the public view never carries them; `take` copies none; an own
 *       duplicate copies all three
 *   §6  the caps: 30 piles, 40-char names, 300 moves a split, ids, aliases
 *   §7  a deck without the fields reads exactly as before — nothing migrated
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

test('§1 piles, sortMoves and view round-trip through updateDeck and the collection view', () => {
  const d = freshDeck();
  const piles = [
    { id: 'p1', name: 'Early', cards: [A, B], auto: 'units' },
    { id: 'p2', name: 'Late', cards: [A, C] },
  ];
  const sortMoves = { type: { [B]: { row: 'spells', col: '3' } }, element: { [C]: { row: 'fire/wood', col: 'X' } } };
  const r = updateDeck(me, d.id, { piles, sortMoves, view: 'freeform' });
  assert.ok(r.ok);
  const back = reread(d.id);
  assert.deepEqual(back.piles, piles);
  assert.deepEqual(back.sortMoves, sortMoves);
  assert.equal(back.view, 'freeform');
  assert.deepEqual(back.cards, CARDS, 'the deck itself is untouched');
  const v = collectionView(me).find(x => x.id === d.id)!;
  assert.deepEqual(v.piles, piles, 'the owner\'s view carries them');
  assert.deepEqual(v.sortMoves, sortMoves);
  assert.equal(v.view, 'freeform');
  // view: anything other than freeform is sorted
  updateDeck(me, d.id, { view: 'stacked' });
  assert.equal(reread(d.id).view, 'sorted');
  // each record is applied ONLY when sent
  updateDeck(me, d.id, { name: 'renamed' });
  assert.deepEqual(reread(d.id).piles, piles, 'a rename leaves the piles');
  assert.deepEqual(reread(d.id).sortMoves, sortMoves, 'and the moves');
  // null clears
  updateDeck(me, d.id, { piles: null, sortMoves: null });
  assert.ok(!('piles' in reread(d.id)) && !('sortMoves' in reread(d.id)), 'null clears both, to ABSENT');
});

/* ══ §2 piles clamp ════════════════════════════════════════════════════ */

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

/* ══ §3 sortMoves clamp ════════════════════════════════════════════════ */

test('§3 ⭐ sortMoves: unknown split keys, names not in the deck and malformed cells are dropped', () => {
  const d = freshDeck();
  updateDeck(me, d.id, { sortMoves: {
    cost: { [A]: { row: 'units', col: '2' } },                // not a split the table offers
    type: {
      [A]: { row: 'units', col: '5' },                        // kept
      [D]: { row: 'units', col: '1' },                        // not in the deck
      'Not A Card': { row: 'units', col: '1' },               // not a card
      [B]: { row: 'units <script>', col: '1' },               // a row outside the alphabet
      [C]: { row: 'units', col: 7 },                          // a column that is not a string
    },
    element: { [B]: { row: 'x'.repeat(25), col: '1' } },      // over 24 characters
    flat: { [C]: 'all' },                                     // not a cell at all
  } });
  assert.deepEqual(reread(d.id).sortMoves, { type: { [A]: { row: 'units', col: '5' } } },
    'only the one well-formed move of a deck card survives; the empty splits go');
  updateDeck(me, d.id, { sortMoves: { type: { [D]: { row: 'units', col: '1' } } } });
  assert.ok(!('sortMoves' in reread(d.id)), 'a record left with nothing is ABSENT, not {}');
});

/* ══ §4 cards alone re-clamps ══════════════════════════════════════════ */

test('§4 ⭐ sending `cards` alone re-clamps the stored piles AND moves — a cut name loses its move', () => {
  const d = freshDeck();
  updateDeck(me, d.id, {
    piles: [{ id: 'p1', name: 'a', cards: [A, A, B] }, { id: 'p2', name: 'b', cards: [C] }],
    sortMoves: { type: { [B]: { row: 'spells', col: '1' }, [C]: { row: 'units', col: '9' } } },
  });
  // an older client (or another device) cuts B and one A, and sends only the list
  updateDeck(me, d.id, { cards: [A, C] });
  const back = reread(d.id);
  assert.deepEqual(back.cards, [A, C]);
  assert.deepEqual(back.piles!.map(p => p.cards), [[A], [C]], 'no pile holds a phantom copy');
  assert.deepEqual(back.sortMoves, { type: { [C]: { row: 'units', col: '9' } } }, 'B\'s move went with B');
  // and the card coming BACK does not bring its old move with it
  updateDeck(me, d.id, { cards: [A, B, C] });
  assert.ok(!(B in (reread(d.id).sortMoves?.type ?? {})), 'a returning card is auto-sorted');
});

/* ══ §5 who sees and who copies ════════════════════════════════════════ */

test('§5 ⭐ the public view never carries piles/sortMoves/view, and `take` copies none of them', () => {
  const d = freshDeck(other);
  updateDeck(other, d.id, {
    visibility: 'public',
    piles: [{ id: 'p1', name: 'secret plan', cards: [...CARDS] }],
    sortMoves: { flat: { [A]: { row: 'all', col: '9' } } },
    view: 'freeform',
  });
  const pub = sharedDeck(d.id)!;
  assert.ok(pub, 'the deck is shared');
  for (const k of ['piles', 'sortMoves', 'view']) assert.ok(!(k in pub), `the public view has no ${k}`);
  assert.ok(!JSON.stringify(pub).includes('secret plan'), 'nothing of the arrangement leaks by another name');

  // /api/decks/take is duplicateDeck(account, id, sourceDeck(id)) — the route, verbatim
  const taken = duplicateDeck(me, d.id, sourceDeck(d.id)!);
  assert.ok(taken.ok);
  for (const k of ['piles', 'sortMoves', 'view']) assert.ok(!(k in taken.deck), `a taken copy has no ${k}`);
  assert.deepEqual(taken.deck.cards, CARDS, 'but it has the cards');
  const route = readFileSync(new URL('../api-decks.ts', import.meta.url), 'utf8');
  assert.match(route, /duplicateDeck\(account, id, src\)/, 'the take route still passes the source');
});

test('§5 ⭐ duplicating your OWN deck copies all three', () => {
  const d = freshDeck();
  const piles = [{ id: 'p1', name: 'mine', cards: [A, B] }, { id: 'p2', name: 'more', cards: [A, C] }];
  const sortMoves = { type: { [A]: { row: 'spells', col: '4' } } };
  updateDeck(me, d.id, { piles, sortMoves, view: 'freeform' });
  const dup = duplicateDeck(me, d.id);
  assert.ok(dup.ok);
  const back = reread(dup.deck.id);
  assert.deepEqual(back.piles, piles);
  assert.deepEqual(back.sortMoves, sortMoves);
  assert.equal(back.view, 'freeform');
  back.piles![0]!.cards.push(C);
  assert.deepEqual(reread(d.id).piles, piles, 'a COPY: editing the duplicate\'s piles leaves the original');
});

/* ══ §6 caps ═══════════════════════════════════════════════════════════ */

test('§6 caps: 30 piles, 40-character names, ids made good', () => {
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

test('§6 caps: at most 300 moves a split, and names are canonicalised', () => {
  const pool = DECK_LIST.slice(0, 300);
  const d = freshDeck(me, pool);
  assert.equal(reread(d.id).cards.length, 300);
  const big: Record<string, { row: string; col: string }> = {};
  for (const n of DECK_LIST.slice(0, 320)) big[n] = { row: 'all', col: '1' };
  updateDeck(me, d.id, { sortMoves: { flat: big } });
  assert.equal(Object.keys(reread(d.id).sortMoves!.flat!).length, 300);
  // the cap bounds the WORK, so it counts what was sent, not what survived:
  // 300 entries of nonsense and the 301st real move is never looked at
  const junk: Record<string, { row: string; col: string }> = {};
  for (let i = 0; i < 300; i++) junk[`junk ${i}`] = { row: 'all', col: '1' };
  junk[pool[0]!] = { row: 'all', col: '1' };
  updateDeck(me, d.id, { sortMoves: { flat: junk } });
  assert.ok(!('sortMoves' in reread(d.id)), 'entry 301 is past the cap');

  // the alias: "Counter Theif" is how the card is PRINTED (registry.ts registerAlias)
  const NOW = 'Counter Thief';
  const OLD = 'Counter Theif';
  assert.ok(DECK_LIST.includes(NOW));
  const d2 = freshDeck(me, [NOW, NOW, A]);
  updateDeck(me, d2.id, {
    piles: [{ id: 'p1', name: 'x', cards: [OLD, OLD, OLD, A] }],
    sortMoves: { type: { [OLD]: { row: 'spells', col: '1' } } },
  });
  const back = reread(d2.id);
  assert.deepEqual(back.piles![0]!.cards, [NOW, NOW, A], 'respelled, then clamped to the two the deck holds');
  assert.deepEqual(Object.keys(back.sortMoves!.type!), [NOW]);
});

/* ══ §7 no migration ═══════════════════════════════════════════════════ */

test('§7 a deck without the fields reads exactly as before — nothing is added on read or on other edits', () => {
  const d = freshDeck();
  const keys = (o: object) => Object.keys(o).sort();
  const before = keys(reread(d.id));
  for (const k of ['piles', 'sortMoves', 'view']) assert.ok(!before.includes(k), `a new deck has no ${k}`);
  collectionView(me);
  updateDeck(me, d.id, { name: 'still plain', cards: [A, B], maybe: [C], description: 'x' });
  const after = reread(d.id);
  for (const k of ['piles', 'sortMoves', 'view']) assert.ok(!(k in after), `an ordinary edit adds no ${k}`);
  // and a deck stored before the fields existed (a raw record) reads unchanged
  const raw = { id: 'old1', name: 'old', cards: [A, A], maybe: [], cover: A, author: 'you', createdAt: '', updatedAt: '' };
  const acct = { id: 'u-raw', decks: [structuredClone(raw)] };
  assert.deepEqual(decksOf(acct as never)[0], raw);
});
